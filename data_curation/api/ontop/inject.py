"""Dataset scoping and SELECT-only enforcement for SPARQL queries.

The frontend emits dataset-agnostic queries (no named graphs by design).
To ensure isolation, the backend injects:
- a VALUES binding for ?datasetId
- triple patterns constraining the main entity variables to the dataset
"""

from __future__ import annotations

import re

SELECT_ONLY_FORBIDDEN = ("construct", "describe", "insert", "delete", "update", "clear", "load", "create", "drop")

PREFIX = "PREFIX vend: <http://vendange.bnf.fr/ontology#>\n"

DATASET_ID_PREDICATE = "<https://vendange.bnf.fr/property/datasetId>"


def assert_select_only(query: str) -> None:
    lowered = query.lower()
    if any(word in lowered for word in SELECT_ONLY_FORBIDDEN):
        raise ValueError("Only SELECT queries are allowed")


def _entity_vars_for_scoping(query: str) -> list[str]:
    """Heuristically extract entity variables to scope by datasetId.

    Sparnatural queries consistently type their main variables (e.g. `?w a vendclass:Work`),
    so we primarily look for subjects of rdf:type / `a` triples.
    """

    match = re.search(r"WHERE\s*{", query, flags=re.IGNORECASE)
    where_block = query[match.end() :] if match else query

    typed = re.findall(r"\?(\w+)\s+(?:a|rdf:type)\s+[^.\n]+", where_block, flags=re.IGNORECASE)
    if typed:
        return _unique_preserving_order(typed)

    values_vars = re.findall(r"VALUES\s*\(\s*\?(\w+)", where_block, flags=re.IGNORECASE)
    if values_vars:
        return _unique_preserving_order(values_vars)

    subjects = re.findall(r"\?(\w+)\s+(?:<[^>]+>|\w+:\w+)\s+", where_block)
    if subjects:
        return _unique_preserving_order(subjects)

    first = re.search(r"\?(\w+)", where_block)
    return [first.group(1)] if first else []


def _unique_preserving_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def inject_dataset_filter(query: str, dataset_id: str) -> str:
    """Inject dataset scoping by binding ?datasetId and constraining entity vars."""
    assert_select_only(query)
    q = query.strip()
    if not q.lower().startswith("prefix"):
        q = PREFIX + q

    needs_values = "VALUES ?datasetId" not in q and "VALUES (?datasetId)" not in q
    needs_triples = "property/datasetId" not in q and "vendprop:datasetId" not in q

    if not needs_values and not needs_triples:
        return q

    parts: list[str] = []
    if needs_values:
        dataset_literal = f"\"{dataset_id}\"^^<http://www.w3.org/2001/XMLSchema#string>"
        parts.append(f"VALUES (?datasetId) {{ ({dataset_literal}) }}")
    if needs_triples:
        for var in _entity_vars_for_scoping(q):
            parts.append(f"?{var} {DATASET_ID_PREDICATE} ?datasetId .")

    injection = "\n  ".join(parts) + "\n"

    match = re.search(r"WHERE\s*{", q, flags=re.IGNORECASE)
    if match:
        idx = match.end()
        return q[:idx] + "\n  " + injection + q[idx:]
    return injection + q
