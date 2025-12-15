"""Postgres/Ontop-facing facade used by the FastAPI layer."""

from __future__ import annotations

from pathlib import Path
from typing import Dict, List

from .anchor_swap import swap_cluster_anchor
from .manual_cluster import update_manual_cluster
from .originality_swap import swap_work_originality
from .pg.ingest import ingest_csv as ingest_csv_postgres
from .pg.session import db_session, statement_timeout
from .pg.schema import ensure_schema, _partition_name
from .pg.datasets_repo import touch as touch_dataset_row
from .record_update import update_record

__all__ = [
    "initialize_storage",
    "close_dataset",
    "dataset_store_path",
    "reset_dataset_store",
    "directory_size",
    "ingest_csv",
    "update_record",
    "load_records",
    "dataset_stats",
    "swap_cluster_anchor",
    "swap_work_originality",
    "update_manual_cluster",
]


# --- Legacy-compatible no-op stubs (Oxigraph removed) ---------------------------------
def initialize_storage() -> None:
    ensure_schema()


def close_dataset(dataset_id: str) -> None:  # pragma: no cover - retained for compatibility
    return None


def dataset_store_path(dataset_id: str) -> Path:  # pragma: no cover
    return Path("/tmp") / "vendange" / dataset_id


def reset_dataset_store(dataset_id: str) -> None:  # pragma: no cover
    return None


def directory_size(dataset_id: str) -> int:  # pragma: no cover
    return 0


# --- Postgres-backed operations --------------------------------------------------------
def ingest_csv(content: bytes, dataset_id: str, *, dataset_label: str | None = None):
    stats_pg = ingest_csv_postgres(dataset_id, content, dataset_label=dataset_label)
    touch_dataset_row(dataset_id)
    return stats_pg


def load_records(dataset_id: str) -> List[dict[str, object]]:
    """Return records (id/type/ark/intermarc JSON string) from Postgres."""
    with db_session() as conn, statement_timeout(conn, 5000):
        rows = conn.execute(
            "SELECT record_id, type_raw, type_norm, ark, record FROM entity WHERE dataset_id=%s",
            (dataset_id,),
        ).fetchall()
    records: List[dict[str, object]] = []
    for row in rows:
        payload = row["record"] or {}
        records.append(
            {
                "id": row["record_id"],
                "type": row.get("type_raw") or row.get("type_norm"),
                "ark": row.get("ark"),
                "intermarc": json_dumps(payload),
            }
        )
    return records


def dataset_stats(dataset_id: str) -> Dict[str, int]:
    """Approximate dataset stats using Postgres partitions."""
    with db_session() as conn, statement_timeout(conn, 5000):
        entity_count = conn.execute(
            "SELECT count(*) AS c FROM entity WHERE dataset_id=%s",
            (dataset_id,),
        ).fetchone()["c"]
        rel_count = conn.execute(
            "SELECT count(*) AS c FROM rel_edge WHERE dataset_id=%s",
            (dataset_id,),
        ).fetchone()["c"]
        cluster_count = conn.execute(
            "SELECT count(*) AS c FROM cluster WHERE dataset_id=%s",
            (dataset_id,),
        ).fetchone()["c"]

        partitions = [_partition_name(t, dataset_id) for t in ("entity", "rel_edge", "entity_label", "cluster", "fts")]
        size_bytes = 0
        for part in partitions:
            row = conn.execute(
                "SELECT coalesce(pg_total_relation_size(%s),0) AS sz",
                (part,),
            ).fetchone()
            size_bytes += row["sz"] if row else 0

    quad_count = entity_count + rel_count + cluster_count
    return {
        "entity_count": entity_count,
        "quad_count": quad_count,
        "size_bytes": size_bytes,
    }


def json_dumps(obj) -> str:
    import json

    return json.dumps(obj, ensure_ascii=False)
