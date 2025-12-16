"""Helpers to resolve ARK → display label maps from Postgres records."""

from __future__ import annotations

from typing import Dict, Iterable, Optional, Sequence, Set

from data_curation.api.pg.record_labeling import EntityRow, collect_arks, resolve_ark_labels
from data_curation.api.pg.session import db_session, statement_timeout


def _fetch_entity_row(conn, dataset_id: str, ark: str) -> Optional[EntityRow]:
    row = conn.execute(
        """
        SELECT ark, type_raw, type_norm, record
        FROM entity
        WHERE dataset_id=%s AND ark=%s
        LIMIT 1
        """,
        (dataset_id, ark),
    ).fetchone()
    if not row:
        return None
    return EntityRow(
        ark=row["ark"],
        type_raw=row.get("type_raw") or row.get("type_norm") or "",
        type_norm=row.get("type_norm") or "",
        record=row.get("record") or {},
    )


def resolve_ark_label_map(
    dataset_id: str,
    arks: Sequence[str],
    *,
    statement_timeout_ms: int = 5000,
) -> Dict[str, str]:
    """Return a mapping for the provided ARKs (plus lowercase keys)."""

    if not arks:
        return {}
    with db_session() as conn, statement_timeout(conn, statement_timeout_ms):
        cache: Dict[str, EntityRow] = {}

        def _fetch(ark: str) -> Optional[EntityRow]:
            if ark in cache:
                return cache[ark]
            entity = _fetch_entity_row(conn, dataset_id, ark)
            if entity:
                cache[ark] = entity
            return entity

        return resolve_ark_labels(dataset_id=dataset_id, arks=arks, fetch_entity=_fetch)


def resolve_ark_label_map_for_records(
    dataset_id: str,
    records: Iterable[dict],
    *,
    zone_codes: Optional[Set[str]] = None,
    statement_timeout_ms: int = 5000,
) -> Dict[str, str]:
    """Collect ARKs from records and resolve them to display labels."""

    arks: Set[str] = set()
    for record in records:
        if isinstance(record, dict):
            arks.update(collect_arks(record, zone_codes=zone_codes))
    return resolve_ark_label_map(dataset_id, sorted(arks), statement_timeout_ms=statement_timeout_ms)

