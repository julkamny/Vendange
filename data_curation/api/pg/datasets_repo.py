"""Dataset registry backed by Postgres.

Responsibilities:
- list/get/create/delete dataset metadata
- maintain updated_at (touch) and title updates
- manage per-dataset partitions via schema helpers
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List, Optional

from data_curation.api.pg.schema import create_dataset_partitions, drop_dataset_partitions
from data_curation.api.pg.session import db_session

LOGGER = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def list_datasets() -> List[dict]:
    with db_session() as conn:
        rows = conn.execute(
            "SELECT id, title, created_at, updated_at, source_filename, last_clustered_at FROM dataset ORDER BY created_at"
        ).fetchall()
    return [dict(row) for row in rows]


def get_dataset(dataset_id: str) -> dict:
    with db_session() as conn:
        row = conn.execute(
            "SELECT id, title, created_at, updated_at, source_filename, last_clustered_at FROM dataset WHERE id=%s",
            (dataset_id,),
        ).fetchone()
    if not row:
        raise KeyError(f"Dataset not found: {dataset_id}")
    return dict(row)


def create_dataset(dataset_id: str, title: str, source_filename: Optional[str] = None) -> dict:
    now = _now()
    with db_session() as conn:
        conn.execute(
            """
            INSERT INTO dataset (id, title, created_at, updated_at, source_filename)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (dataset_id, title, now, now, source_filename),
        )
        conn.commit()
    create_dataset_partitions(dataset_id)
    return get_dataset(dataset_id)


def update_title(dataset_id: str, title: str) -> dict:
    now = _now()
    with db_session() as conn:
        result = conn.execute(
            "UPDATE dataset SET title=%s, updated_at=%s WHERE id=%s RETURNING id, title, created_at, updated_at, source_filename, last_clustered_at",
            (title, now, dataset_id),
        ).fetchone()
        conn.commit()
    if not result:
        raise KeyError(f"Dataset not found: {dataset_id}")
    return dict(result)


def touch(dataset_id: str) -> None:
    with db_session() as conn:
        conn.execute("UPDATE dataset SET updated_at=%s WHERE id=%s", (_now(), dataset_id))
        conn.commit()


def delete_dataset(dataset_id: str) -> None:
    with db_session() as conn:
        conn.execute("DELETE FROM dataset WHERE id=%s", (dataset_id,))
        conn.commit()
    drop_dataset_partitions(dataset_id)
