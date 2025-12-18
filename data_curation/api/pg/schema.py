"""Schema management helpers for the Postgres migration (P1).

Public entrypoints:
- ensure_schema(): create core tables and indexes
- create_dataset_partitions(dataset_id): add list partitions for a dataset
- drop_dataset_partitions(dataset_id): remove partitions for a dataset
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

from psycopg import sql

from data_curation.api.pg.session import db_session

LOGGER = logging.getLogger(__name__)

SCHEMA_PATH = Path(__file__).resolve().parents[3] / "db" / "schema.sql"
VIEWS_PATH = Path(__file__).resolve().parents[3] / "db" / "views.sql"

PARTITIONED_TABLES: tuple[str, ...] = (
    "entity",
    "rel_edge",
    "entity_label",
    "cluster",
    "cluster_workflow_state",
    "fts",
    "field",
    "subfield",
)


def _partition_name(table: str, dataset_id: str) -> str:
    """Generate a safe partition table name."""
    slug = re.sub(r"[^a-zA-Z0-9]", "_", dataset_id).lower()[:48]
    return f"{table}_p_{slug or 'dataset'}"


def _execute_sql_file(conn, path: Path) -> None:
    sql_text = path.read_text()
    conn.execute(sql_text)


def ensure_schema() -> None:
    """Create base tables and indexes if they don't exist."""
    with db_session() as conn:
        LOGGER.info("Applying base schema from %s", SCHEMA_PATH)
        _execute_sql_file(conn, SCHEMA_PATH)
        if VIEWS_PATH.exists():
            LOGGER.info("Applying views from %s", VIEWS_PATH)
            _execute_sql_file(conn, VIEWS_PATH)
        conn.commit()


def _create_partition(conn, parent: str, dataset_id: str) -> None:
    partition = sql.Identifier(_partition_name(parent, dataset_id))
    stmt = sql.SQL(
        "CREATE TABLE IF NOT EXISTS {partition} PARTITION OF {parent} FOR VALUES IN ({dataset_id})"
    ).format(
        partition=partition,
        parent=sql.Identifier(parent),
        dataset_id=sql.Literal(dataset_id),
    )
    conn.execute(stmt)


def create_dataset_partitions(dataset_id: str) -> None:
    """Create list partitions for all partitioned tables."""
    with db_session() as conn:
        LOGGER.info("Creating partitions for dataset %s", dataset_id)
        for table in PARTITIONED_TABLES:
            _create_partition(conn, table, dataset_id)
        conn.commit()


def _drop_partition(conn, parent: str, dataset_id: str) -> None:
    partition = sql.Identifier(_partition_name(parent, dataset_id))
    stmt = sql.SQL("DROP TABLE IF EXISTS {partition} CASCADE").format(partition=partition)
    conn.execute(stmt)


def drop_dataset_partitions(dataset_id: str) -> None:
    """Drop partitions for a dataset."""
    with db_session() as conn:
        LOGGER.info("Dropping partitions for dataset %s", dataset_id)
        for table in PARTITIONED_TABLES:
            _drop_partition(conn, table, dataset_id)
        conn.commit()


def _cli() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Manage Vendange Postgres schema")
    parser.add_argument("--dataset", help="Dataset id for partition operations")
    parser.add_argument(
        "command",
        choices=["ensure-schema", "create-partitions", "drop-partitions"],
        help="Action to perform",
    )
    args = parser.parse_args()

    if args.command == "ensure-schema":
        ensure_schema()
    elif args.command == "create-partitions":
        if not args.dataset:
            parser.error("--dataset is required for create-partitions")
        create_dataset_partitions(args.dataset)
    elif args.command == "drop-partitions":
        if not args.dataset:
            parser.error("--dataset is required for drop-partitions")
        drop_dataset_partitions(args.dataset)


if __name__ == "__main__":  # pragma: no cover - manual CLI usage
    _cli()
