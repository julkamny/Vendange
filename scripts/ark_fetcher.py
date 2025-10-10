"""Utilities to extract ARK identifiers from CSV exports and fetch their metadata.

This module is designed to be imported from a Jupyter notebook so that the entire
workflow can run inside the notebook environment on a machine with network
access to the Noemi service.
"""

from __future__ import annotations

import csv
import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Iterator, Sequence

DEFAULT_PATTERN = r"ark:/[0-9]+/[A-Za-z0-9]+"
DEFAULT_API_HOST = "https://pfc3noemi-ihm.bnf.fr/service"
DEFAULT_ENDPOINT = "entity/ark"
HEADERS = {"Accept": "application/json", "Content-Type": "application/json"}

try:
    import requests  # type: ignore
except ImportError:  # pragma: no cover - optional dependency
    requests = None  # type: ignore

try:  # pragma: no cover - optional dependency
    import urllib.request
    import urllib.error
except ImportError as exc:  # pragma: no cover - should exist in stdlib
    raise RuntimeError("urllib is required") from exc


@dataclass
class FetchOutcome:
    """Result of fetching metadata for a single ARK identifier."""

    ark: str
    http_code: str
    result_path: Path | None
    cached: bool
    error: str | None = None


def _iter_strings(node: Any) -> Iterator[str]:
    """Yield string values recursively from a JSON-like structure."""
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for value in node.values():
            yield from _iter_strings(value)
    elif isinstance(node, (list, tuple)):
        for item in node:
            yield from _iter_strings(item)


def _extract_from_payload(payload: Any, pattern: re.Pattern[str]) -> Iterator[str]:
    for value in _iter_strings(payload):
        yield from pattern.findall(value)


def dedupe_preserving_order(values: Iterable[str]) -> list[str]:
    """Return unique values while preserving the first occurrence order."""
    seen: dict[str, None] = {}
    result: list[str] = []
    for raw in values:
        if raw is None:
            continue
        normalised = raw.strip()
        if not normalised or normalised in seen:
            continue
        seen[normalised] = None
        result.append(normalised)
    return result


def extract_unique_arks_from_csv(
    csv_path: str | Path,
    *,
    column: str = "intermarc",
    encoding: str = "utf-8",
    pattern: str = DEFAULT_PATTERN,
    case_sensitive: bool = False,
    allow_invalid_json: bool = False,
) -> list[str]:
    """Extract unique ARK identifiers from the JSON payload stored in a CSV column."""

    csv_path = Path(csv_path)
    if not csv_path.is_file():
        raise FileNotFoundError(f"CSV file not found: {csv_path}")

    regex_flags = 0 if case_sensitive else re.IGNORECASE
    compiled = re.compile(pattern, regex_flags)

    collected: list[str] = []
    with csv_path.open(newline="", encoding=encoding) as handle:
        reader = csv.DictReader(handle, delimiter=";", quotechar='"')
        if column not in (reader.fieldnames or []):
            raise KeyError(
                f"Column '{column}' not present in CSV header. Columns: {reader.fieldnames}"
            )

        for row in reader:
            raw = row.get(column)
            if not raw:
                continue
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                if allow_invalid_json:
                    continue
                raise
            collected.extend(_extract_from_payload(payload, compiled))
    return dedupe_preserving_order(collected)


def load_ark_list(path: str | Path) -> list[str]:
    """Load ARK identifiers from a newline-delimited text file."""
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"ARK list not found: {path}")
    return dedupe_preserving_order(line.rstrip("\r\n") for line in path.read_text(encoding="utf-8").splitlines())


def save_ark_list(arks: Sequence[str], path: str | Path) -> Path:
    """Write ARK identifiers to a newline-delimited text file."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    text = "\n".join(arks)
    path.write_text(text + ("\n" if text else ""), encoding="utf-8")
    return path


def _ensure_status_log(path: Path) -> None:
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("ark\thttp_code\tresult_path\terror\n", encoding="utf-8")


def _safe_filename(ark: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", ark)


def _post_payload(url: str, payload: str, timeout: float) -> tuple[str, bytes | None, str | None]:
    """Send a POST request containing the given payload.

    Returns a tuple (status_code, response_body, error_message).
    """

    data = payload.encode("utf-8")

    if requests is not None:
        try:
            response = requests.post(url, data=data, headers=HEADERS, timeout=timeout)
            return str(response.status_code), response.content, None
        except Exception as exc:  # pragma: no cover - network errors in runtime
            return "request_error", None, str(exc)

    req = urllib.request.Request(url, data=data, headers=HEADERS, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
            return str(resp.getcode()), body, None
    except urllib.error.HTTPError as exc:  # noqa: S110 - we want the response body
        return str(exc.code), exc.read(), None
    except Exception as exc:  # pragma: no cover - network errors in runtime
        return "request_error", None, str(exc)


def fetch_ark_metadata(
    *,
    csv_path: str | Path | None = None,
    ark_list: Sequence[str] | None = None,
    ark_list_path: str | Path | None = None,
    output_dir: str | Path,
    column: str = "intermarc",
    encoding: str = "utf-8",
    pattern: str = DEFAULT_PATTERN,
    case_sensitive: bool = False,
    allow_invalid_json: bool = False,
    api_host: str = DEFAULT_API_HOST,
    endpoint: str = DEFAULT_ENDPOINT,
    sleep_seconds: float = 0.0,
    limit: int | None = None,
    force: bool = False,
    verbose: bool = False,
    timeout: float = 30.0,
) -> list[FetchOutcome]:
    """Fetch metadata for ARK identifiers.

    Parameters mirror the capabilities of the original shell workflow while being
    convenient to call from a notebook cell.
    """

    if csv_path is None and ark_list is None and ark_list_path is None:
        raise ValueError("Provide at least one of csv_path, ark_list, or ark_list_path")

    arks: list[str] = []
    source_label = None

    if ark_list is not None:
        arks.extend(dedupe_preserving_order(ark_list))
        source_label = "provided list"

    if ark_list_path is not None:
        loaded = load_ark_list(ark_list_path)
        arks = loaded if not arks else dedupe_preserving_order(arks + loaded)
        source_label = str(ark_list_path)

    if csv_path is not None:
        extracted = extract_unique_arks_from_csv(
            csv_path,
            column=column,
            encoding=encoding,
            pattern=pattern,
            case_sensitive=case_sensitive,
            allow_invalid_json=allow_invalid_json,
        )
        arks = extracted if not arks else dedupe_preserving_order(arks + extracted)
        source_label = str(csv_path)

    if not arks:
        raise ValueError("No ARK identifiers found from the provided sources")

    if limit is not None:
        if limit < 0:
            raise ValueError("limit must be non-negative")
        arks = arks[:limit]

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    ark_list_file = output_path / "ark_identifiers.txt"
    status_log = output_path / "fetch_status.tsv"
    save_ark_list(arks, ark_list_file)
    _ensure_status_log(status_log)

    api_host = api_host.rstrip("/")
    target_url = f"{api_host}/{endpoint}"

    outcomes: list[FetchOutcome] = []
    total = len(arks)
    for index, ark in enumerate(arks, start=1):
        safe_name = _safe_filename(ark)
        response_file = output_path / f"{safe_name}.json"

        if response_file.exists() and not force:
            outcomes.append(FetchOutcome(ark=ark, http_code="cached", result_path=response_file, cached=True))
            if verbose:
                print(f"[{index}/{total}] {ark} -> cached ({response_file.name})")
            continue

        if verbose:
            print(f"[{index}/{total}] Fetching {ark}")

        payload = json.dumps(ark)
        http_code, body, error = _post_payload(target_url, payload, timeout)

        if body is not None:
            response_file.write_bytes(body)
        elif response_file.exists():
            response_file.unlink()

        with status_log.open("a", encoding="utf-8") as log_handle:
            result_path_text = str(response_file) if body is not None else ""
            error_text = error or ""
            log_handle.write(f"{ark}\t{http_code}\t{result_path_text}\t{error_text}\n")

        outcomes.append(
            FetchOutcome(
                ark=ark,
                http_code=http_code,
                result_path=response_file if body is not None else None,
                cached=False,
                error=error,
            )
        )

        if sleep_seconds:
            time.sleep(sleep_seconds)

    if verbose:
        print(
            "Completed fetching %d ARK identifiers from %s. Logs available at %s"
            % (total, source_label or "provided input", status_log)
        )

    return outcomes


__all__ = [
    "DEFAULT_API_HOST",
    "DEFAULT_ENDPOINT",
    "FetchOutcome",
    "dedupe_preserving_order",
    "extract_unique_arks_from_csv",
    "fetch_ark_metadata",
    "load_ark_list",
    "save_ark_list",
]
