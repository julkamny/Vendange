"""Lookups for controlled values stored in Postgres."""

from __future__ import annotations

from typing import Optional

from data_curation.api.pg.session import db_session


def get_controlled_ark_by_label(dataset_id: str, label: str, *, conn=None) -> Optional[str]:
    """Return the ARK of a controlled value entity matching the given label."""
    if not label:
        return None
    if conn is None:
        with db_session() as conn:
            row = conn.execute(
                """
                SELECT e.ark
                FROM entity e
                JOIN entity_label el USING (dataset_id, entity_id)
                WHERE e.dataset_id=%s
                  AND el.label=%s
                  AND e.type_norm='valeur controlee'
                LIMIT 1
                """,
                (dataset_id, label),
            ).fetchone()
    else:
        row = conn.execute(
            """
            SELECT e.ark
            FROM entity e
            JOIN entity_label el USING (dataset_id, entity_id)
            WHERE e.dataset_id=%s
              AND el.label=%s
              AND e.type_norm='valeur controlee'
            LIMIT 1
            """,
            (dataset_id, label),
        ).fetchone()
    return row["ark"] if row and row.get("ark") else None
