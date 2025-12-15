"""Autocomplete backed by Postgres FTS."""

from __future__ import annotations

from typing import List

from data_curation.api.pg.session import db_session, statement_timeout
from data_curation.api.schemas import AutocompleteSuggestion


def search_entities(dataset_id: str, query: str, limit: int = 20) -> List[AutocompleteSuggestion]:
    if not query.strip():
        return []
    tsquery = " | ".join(query.strip().split())
    sql = """
        SELECT e.ark, el.label, el.type_norm
        FROM fts f
        JOIN entity e USING (dataset_id, entity_id)
        JOIN entity_label el USING (dataset_id, entity_id)
        WHERE f.dataset_id=%s AND f.document @@ plainto_tsquery('simple', %s)
        ORDER BY el.sort_key NULLS LAST
        LIMIT %s
    """
    with db_session() as conn, statement_timeout(conn, 1000):
        rows = conn.execute(sql, (dataset_id, tsquery, limit)).fetchall()
    return [
        AutocompleteSuggestion(ark=row["ark"], label=row["label"], type=row["type_norm"])
        for row in rows
        if row["ark"]
    ]
