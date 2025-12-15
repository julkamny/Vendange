"""Dataset scoping and SELECT-only enforcement for SPARQL queries."""

from __future__ import annotations

import re

SELECT_ONLY_FORBIDDEN = ("construct", "describe", "insert", "delete", "update", "clear", "load", "create", "drop")

PREFIX = "PREFIX vend: <http://vendange.bnf.fr/ontology#>\n"


def assert_select_only(query: str) -> None:
    lowered = query.lower()
    if any(word in lowered for word in SELECT_ONLY_FORBIDDEN):
        raise ValueError("Only SELECT queries are allowed")


def inject_dataset_filter(query: str, dataset_id: str) -> str:
    """Inject a dataset filter by adding a VALUES binding and a triple."""
    assert_select_only(query)
    q = query.strip()
    if not q.lower().startswith("prefix"):
        q = PREFIX + q
    # Add VALUES clause to pin ?datasetId
    if "VALUES ?datasetId" in q or "VALUES (?datasetId)" in q:
        return q
    injection = f"VALUES (?datasetId) {{ (\"{dataset_id}\") }}\n"
    # Place injection after the first WHERE {
    match = re.search(r"WHERE\s*{", q, flags=re.IGNORECASE)
    if match:
        idx = match.end()
        return q[:idx] + "\n  " + injection + q[idx:]
    return injection + q
