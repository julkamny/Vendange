"""Facade exposing Oxigraph storage helpers for the Vendange API.

This module delegates to smaller modules:
- db_store: low-level store/cache helpers
- db_ingest: CSV ingestion and record quad builders
- db_guards: clustering guardrails and record updates
- db_query: SPARQL queries and read helpers
"""

from __future__ import annotations

from .db_store import (
    _STORE_LOCK,
    close_dataset,
    dataset_store_path,
    directory_size,
    get_store_locked,
    initialize_storage,
    reset_dataset_store,
)
from .db_ingest import ingest_csv as ingest_csv_oxigraph
from .anchor_swap import swap_cluster_anchor
from .originality_swap import swap_work_originality
from .manual_cluster import update_manual_cluster
from .record_update import update_record
from .db_query import compact_dataset, dataset_stats, load_entities, load_records, run_sparql_query
from .pg.ingest import ingest_csv as ingest_csv_postgres
from .pg.datasets_repo import touch as touch_dataset_row

__all__ = [
    "initialize_storage",
    "close_dataset",
    "dataset_store_path",
    "reset_dataset_store",
    "directory_size",
    "ingest_csv",
    "update_record",
    "run_sparql_query",
    "load_records",
    "load_entities",
    "dataset_stats",
    "compact_dataset",
    "swap_cluster_anchor",
    "swap_work_originality",
    "update_manual_cluster",
    "_STORE_LOCK",
    "get_store_locked",
]


def ingest_csv(content: bytes, dataset_id: str, *, dataset_label: str | None = None):
    """Dual-ingest: keep Oxigraph for legacy paths while seeding Postgres."""
    stats_pg = ingest_csv_postgres(dataset_id, content, dataset_label=dataset_label)
    ingest_csv_oxigraph(content, dataset_id, dataset_label=dataset_label)
    touch_dataset_row(dataset_id)
    return stats_pg
