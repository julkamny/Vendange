"""HTTP client for Ontop SPARQL endpoint."""

from __future__ import annotations

import os
from typing import Tuple

import httpx

DEFAULT_ENDPOINT = "http://localhost:8080/sparql"


class OntopError(Exception):
    pass


def _endpoint_url() -> str:
    return os.getenv("ONTOP_ENDPOINT_URL", DEFAULT_ENDPOINT)


def execute_select(query: str, *, timeout_seconds: int = 60) -> Tuple[list[str], list[dict[str, str | None]]]:
    """Execute a SELECT query against Ontop and return columns + rows (as dicts keyed by column)."""
    endpoint = _endpoint_url()
    try:
        resp = httpx.post(
            endpoint,
            data={"query": query},
            headers={"Accept": "application/sparql-results+json"},
            timeout=timeout_seconds,
        )
    except Exception as exc:
        raise OntopError(f"Ontop request failed: {exc}") from exc
    if resp.status_code >= 400:
        raise OntopError(f"Ontop error {resp.status_code}: {resp.text}")
    payload = resp.json()
    head = payload.get("head", {})
    cols = head.get("vars", [])
    rows: list[dict[str, str | None]] = []
    for binding in payload.get("results", {}).get("bindings", []):
        row: dict[str, str | None] = {}
        for col in cols:
            cell = binding.get(col)
            row[col] = cell.get("value") if cell else None
        rows.append(row)
    return cols, rows
