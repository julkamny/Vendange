"""Lightweight entity fetch helpers for Postgres-backed curation code."""

from __future__ import annotations

import json
from typing import Dict, Iterator, Sequence

from data_curation.models import Entity
from data_curation.api.pg.session import db_session


def _row_to_entity(row) -> Entity:
    record_json = row["record"] if isinstance(row["record"], dict) else {}
    return Entity(
        row.get("record_id") or str(row["entity_id"]),
        row.get("type_raw") or row.get("type_norm") or "",
        json.dumps(record_json, ensure_ascii=False),
    )


def get_by_record_id(dataset_id: str, record_id: str, *, for_update: bool = False, conn=None):
    sql = """
        SELECT entity_id, record_id, ark, type_raw, type_norm, record
        FROM entity
        WHERE dataset_id=%s AND record_id=%s
    """
    if for_update:
        sql += " FOR UPDATE"
    if conn is None:
        with db_session() as conn:
            row = conn.execute(sql, (dataset_id, record_id)).fetchone()
    else:
        row = conn.execute(sql, (dataset_id, record_id)).fetchone()
    if not row:
        return None
    return row, _row_to_entity(row)


def get_by_ark(dataset_id: str, ark: str, *, for_update: bool = False, conn=None):
    sql = """
        SELECT entity_id, record_id, ark, type_raw, type_norm, record
        FROM entity
        WHERE dataset_id=%s AND ark=%s
    """
    if for_update:
        sql += " FOR UPDATE"
    if conn is None:
        with db_session() as conn:
            row = conn.execute(sql, (dataset_id, ark)).fetchone()
    else:
        row = conn.execute(sql, (dataset_id, ark)).fetchone()
    if not row:
        return None
    return row, _row_to_entity(row)


def get_many_by_arks(dataset_id: str, arks: Sequence[str], *, for_update: bool = False, conn=None) -> Dict[str, tuple]:
    if not arks:
        return {}
    sql = """
        SELECT entity_id, record_id, ark, type_raw, type_norm, record
        FROM entity
        WHERE dataset_id=%s AND ark = ANY(%s)
    """
    if for_update:
        sql += " FOR UPDATE"
    params = (dataset_id, list({a for a in arks if a}))
    if conn is None:
        with db_session() as conn:
            rows = conn.execute(sql, params).fetchall()
    else:
        rows = conn.execute(sql, params).fetchall()
    return {row["ark"]: (row, _row_to_entity(row)) for row in rows if row.get("ark")}


def iter_entities(dataset_id: str, *, batch_size: int = 1000) -> Iterator[Entity]:
    """Stream entities for a dataset without loading everything in memory."""
    with db_session() as conn:
        cursor_name = f"cur_{dataset_id.replace('-', '_')}"
        with conn.cursor(name=cursor_name) as cur:
            cur.execute(
                """
                SELECT entity_id, record_id, ark, type_raw, type_norm, record
                FROM entity
                WHERE dataset_id=%s
                """,
                (dataset_id,),
            )
            while True:
                rows = cur.fetchmany(batch_size)
                if not rows:
                    break
                for row in rows:
                    yield _row_to_entity(row)
