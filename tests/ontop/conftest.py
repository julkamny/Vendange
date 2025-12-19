#! /usr/bin/env python
# ruff: noqa: E402
from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator, cast
from urllib.parse import urlparse
from uuid import uuid4

import psycopg
import pytest
from psycopg.rows import dict_row

# Ensure repo root is in path (mirrors other test suites).
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data_curation.api import db, datasets
from data_curation.api.ontop import inject as ontop_inject
from data_curation.api.pg.pool import close_pool
from data_curation.api.pg.schema import ensure_schema
from data_curation.api.pg.datasets_repo import delete_dataset


DEFAULT_POSTGRES_DSN = "postgresql://vendange:vendange@localhost:55432/vendange"


def _postgres_dsn() -> str:
    return os.getenv("POSTGRES_DSN", DEFAULT_POSTGRES_DSN)


def _conn_available(dsn: str) -> bool:
    try:
        psycopg.connect(dsn, connect_timeout=2).close()
        return True
    except Exception:
        return False


@pytest.fixture(scope="session")
def pg_dsn() -> str:
    return _postgres_dsn()


@pytest.fixture(scope="session", autouse=True)
def _require_postgres(pg_dsn: str):
    if not _conn_available(pg_dsn):
        pytest.skip("Postgres not reachable for Ontop tests", allow_module_level=True)


def _ontop_available() -> bool:
    return bool(os.getenv("ONTOP_ENDPOINT_URL") or os.getenv("ONTOP_CLI") or shutil.which("ontop"))


@pytest.fixture(scope="session", autouse=True)
def _require_ontop():
    if not _ontop_available():
        pytest.skip(
            "Ontop not configured for tests (set ONTOP_ENDPOINT_URL or ONTOP_CLI / install `ontop` in PATH)",
            allow_module_level=True,
        )


@pytest.fixture(scope="session", autouse=True)
def _ensure_schema(pg_dsn: str):
    os.environ["POSTGRES_DSN"] = pg_dsn
    ensure_schema()
    yield
    close_pool()


@pytest.fixture(scope="session")
def ontop_dataset_id(pg_dsn: str) -> Iterator[str]:
    os.environ["POSTGRES_DSN"] = pg_dsn
    dataset_id = f"ontop-pristine-{uuid4().hex[:8]}"
    datasets.ensure_dataset(dataset_id, title="Ontop test dataset (pristine)")
    csv_path = ROOT / "sample_data" / "current_export_pristine.csv"
    db.ingest_csv(csv_path.read_bytes(), dataset_id, dataset_label=str(csv_path.name))
    yield dataset_id
    delete_dataset(dataset_id)
    close_pool()


@pytest.fixture(scope="session")
def tiny_dataset_id(pg_dsn: str) -> Iterator[str]:
    """Small dataset used for dataset-scoping / isolation assertions."""
    os.environ["POSTGRES_DSN"] = pg_dsn
    dataset_id = f"ontop-tiny-{uuid4().hex[:8]}"
    datasets.ensure_dataset(dataset_id, title="Ontop test dataset (tiny)")
    csv_bytes = (
        "id_entitelrm;type_entite;intermarc\n"
        "w1;Oeuvre;{\"zones\":[{\"code\":\"001\",\"sousZones\":[{\"code\":\"001$a\",\"valeur\":\"ark:/tiny-w1\"}]},{\"code\":\"150\",\"sousZones\":[{\"code\":\"150$a\",\"valeur\":\"Tiny work\"}]}]}\n"
    ).encode("utf-8")
    db.ingest_csv(csv_bytes, dataset_id, dataset_label="tiny.csv")
    yield dataset_id
    delete_dataset(dataset_id)
    close_pool()


def _pick_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _jdbc_from_postgres_dsn(dsn: str) -> tuple[str, str, str]:
    parsed = urlparse(dsn)
    if parsed.scheme not in ("postgres", "postgresql"):
        raise ValueError(f"Unsupported POSTGRES_DSN scheme: {parsed.scheme}")
    host = parsed.hostname or "localhost"
    port = parsed.port or 5432
    db_name = (parsed.path or "").lstrip("/") or "postgres"
    user = parsed.username or ""
    password = parsed.password or ""
    jdbc_url = f"jdbc:postgresql://{host}:{port}/{db_name}"
    return jdbc_url, user, password


@dataclass(frozen=True)
class OntopEndpoint:
    sparql_url: str
    process: subprocess.Popen[str] | None
    workdir: Path

    def stop(self) -> None:
        if not self.process:
            return
        self.process.terminate()
        try:
            self.process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=15)


def _wait_for_endpoint(url: str, *, timeout_s: int = 60) -> None:
    import httpx

    deadline = time.time() + timeout_s
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            resp = httpx.post(
                url,
                data={"query": "SELECT (1 AS ?one) WHERE { } LIMIT 1"},
                headers={"Accept": "application/sparql-results+json"},
                timeout=5,
            )
            if resp.status_code < 500:
                return
        except Exception as exc:  # pragma: no cover
            last_error = exc
        time.sleep(0.5)
    raise RuntimeError(f"Ontop endpoint not ready at {url}: {last_error}")


@pytest.fixture(scope="session")
def ontop_endpoint(pg_dsn: str) -> Iterator[OntopEndpoint]:
    """Start (or reuse) an Ontop SPARQL endpoint backed by the current Postgres DSN."""
    configured = os.getenv("ONTOP_ENDPOINT_URL")
    if configured:
        yield OntopEndpoint(sparql_url=configured, process=None, workdir=Path("."))
        return

    ontop_cmd = os.getenv("ONTOP_CLI") or shutil.which("ontop")
    if not ontop_cmd:
        pytest.skip("Ontop CLI not found (set ONTOP_CLI or install `ontop` in PATH)")

    assert ontop_cmd is not None
    try:
        subprocess.run(
            [ontop_cmd, "help"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=10,
            check=True,
        )
    except Exception as exc:
        pytest.skip(f"Ontop CLI not runnable ({ontop_cmd}): {exc}")

    port = _pick_free_port()
    sparql_url = f"http://127.0.0.1:{port}/sparql"
    jdbc_url, user, password = _jdbc_from_postgres_dsn(pg_dsn)

    with tempfile.TemporaryDirectory(prefix="ontop-test-") as tmp:
        tmpdir = Path(tmp)
        mapping_path = tmpdir / "mapping.obda"
        mapping_path.write_text((ROOT / "ontop" / "mapping.obda").read_text())

        ontology_path = tmpdir / "ontology.ttl"
        ontology_path.write_text((ROOT / "ontop" / "ontology.ttl").read_text())

        properties_path = tmpdir / "ontop.properties"
        properties_path.write_text(
            "\n".join(
                [
                    f"ontologyFile={ontology_path}",
                    f"mappingFile={mapping_path}",
                    f"jdbc.url={jdbc_url}",
                    f"jdbc.user={user}",
                    f"jdbc.password={password}",
                    "jdbc.driver=org.postgresql.Driver",
                    f"port={port}",
                    "enable-ontologyAnnotations=true",
                    "enable-validation=false",
                ]
            )
            + "\n"
        )

        log_path = tmpdir / "ontop.log"
        log_file = log_path.open("w", encoding="utf-8")
        proc = subprocess.Popen(
            [
                ontop_cmd,
                "endpoint",
                "-m",
                str(mapping_path),
                "-t",
                str(ontology_path),
                "-p",
                str(properties_path),
                "--port",
                str(port),
            ],
            cwd=str(tmpdir),
            stdout=log_file,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
        )
        endpoint = OntopEndpoint(sparql_url=sparql_url, process=proc, workdir=tmpdir)
        try:
            try:
                _wait_for_endpoint(sparql_url, timeout_s=90)
            except Exception:
                try:
                    log_file.flush()
                    tail = log_path.read_text(encoding="utf-8").splitlines()[-40:]
                    tail_text = "\n".join(tail)
                except Exception:
                    tail_text = "<unable to read ontop.log>"
                raise RuntimeError(f"Ontop failed to start. ontop.log tail:\n{tail_text}") from None
            yield endpoint
        finally:
            endpoint.stop()
            log_file.close()


@pytest.fixture(scope="session")
def pg_conn(pg_dsn: str) -> Iterator[psycopg.Connection]:
    conn = psycopg.connect(pg_dsn, row_factory=cast(Any, dict_row), autocommit=True)
    try:
        yield conn
    finally:
        conn.close()


@pytest.fixture(scope="session")
def inject():
    return ontop_inject.inject_dataset_filter
