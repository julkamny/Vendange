"""Transactional primitives for curation operations (P4).

Provides a dataset-scoped advisory lock and a single primitive to write an
entity record while recomputing hybrid projections. All curation endpoints
should reuse these helpers to keep locking + projection refresh logic
consistent.
"""

from __future__ import annotations

import json
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Iterable, List, Optional, Sequence

from psycopg.types.json import Json

from data_curation.api.db_shared import canonical_type_key, relation_predicate
from data_curation.api.pg import projections
from data_curation.api.pg.datasets_repo import touch as touch_dataset_row
from data_curation.api.pg.session import db_session, statement_timeout
from data_curation.models import Intermarc


@dataclass
class UpdatedEntity:
    entity_id: int
    record_id: str
    ark: Optional[str]
    type_raw: str
    type_norm: str
    intermarc: Intermarc

    def as_payload(self) -> dict[str, str]:
        return {
            "id": self.record_id,
            "type": self.type_raw,
            "ark": self.ark,
            "intermarc": self.intermarc.to_json_string(),
        }


def _extract_ark(intermarc: Intermarc) -> Optional[str]:
    for zone in intermarc.get_zone("001"):
        for sub in zone.sousZones:
            if sub.code == "001$a" and sub.valeur:
                trimmed = str(sub.valeur).strip()
                if trimmed:
                    return trimmed
    return None


@contextmanager
def dataset_transaction(dataset_id: str, *, timeout_ms: int = 15_000):
    """Open a DB session + transaction guarded by a dataset-scoped advisory lock."""
    with db_session() as conn, conn.transaction():
        conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (dataset_id,))
        with statement_timeout(conn, timeout_ms):
            yield conn


def _resolve_entity_ids_by_ark(conn, dataset_id: str, arks: Sequence[str]) -> dict[str, int]:
    if not arks:
        return {}
    rows = conn.execute(
        "SELECT ark, entity_id FROM entity WHERE dataset_id=%s AND ark = ANY(%s)",
        (dataset_id, list({a for a in arks if a})),
    ).fetchall()
    return {row["ark"]: row["entity_id"] for row in rows if row.get("ark")}


def _refresh_projections(conn, dataset_id: str, entity_id: int, parsed: projections.ParsedRecord) -> None:
    """Clear + recompute projections for a single entity."""
    conn.execute("DELETE FROM entity_label WHERE dataset_id=%s AND entity_id=%s", (dataset_id, entity_id))
    conn.execute("DELETE FROM rel_edge WHERE dataset_id=%s AND src_entity_id=%s", (dataset_id, entity_id))
    conn.execute("DELETE FROM cluster WHERE dataset_id=%s AND anchor_entity_id=%s", (dataset_id, entity_id))
    conn.execute("DELETE FROM fts WHERE dataset_id=%s AND entity_id=%s", (dataset_id, entity_id))
    conn.execute("DELETE FROM field WHERE dataset_id=%s AND entity_id=%s", (dataset_id, entity_id))
    conn.execute("DELETE FROM subfield WHERE dataset_id=%s AND entity_id=%s", (dataset_id, entity_id))

    label, sort_key = projections.compute_label(parsed)
    conn.execute(
        """
        INSERT INTO entity_label (dataset_id, entity_id, label, sort_key, type_norm)
        VALUES (%s,%s,%s,%s,%s)
        """,
        (dataset_id, entity_id, label, sort_key, parsed.type_norm),
    )

    edges = projections.extract_edges(parsed)
    clusters = projections.extract_cluster_memberships(parsed, entity_id)

    tgt_lookup = _resolve_entity_ids_by_ark(
        conn,
        dataset_id,
        [edge["tgt_ark"] for edge in edges] + [row["member_ark"] for row in clusters],
    )

    if edges:
        values: List[tuple] = []
        seen = set()
        for edge in edges:
            key = (edge["relation_code"], edge["tgt_ark"])
            if key in seen:
                continue
            seen.add(key)
            values.append(
                (
                    dataset_id,
                    entity_id,
                    relation_predicate(edge["relation_code"]),
                    edge["tgt_ark"],
                    tgt_lookup.get(edge["tgt_ark"]),
                )
            )
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO rel_edge (dataset_id, src_entity_id, predicate_iri, tgt_ark, tgt_entity_id) VALUES (%s,%s,%s,%s,%s)",
                values,
            )

    if clusters:
        values = []
        seen = set()
        for row in clusters:
            key = (row["member_ark"], row.get("note"))
            if key in seen:
                continue
            seen.add(key)
            values.append(
                (
                    dataset_id,
                    entity_id,
                    parsed.ark or "",
                    row["member_ark"],
                    tgt_lookup.get(row["member_ark"]),
                    row.get("note"),
                )
            )
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO cluster (dataset_id, anchor_entity_id, anchor_ark, member_ark, member_entity_id, note)
                VALUES (%s,%s,%s,%s,%s,%s)
                """,
                values,
            )

    conn.execute(
        "INSERT INTO fts (dataset_id, entity_id, document) VALUES (%s,%s,to_tsvector('simple', %s))",
        (dataset_id, entity_id, projections.compute_fts(parsed, label)),
    )

    fields = projections.extract_field_rows(parsed)
    if fields:
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO field (dataset_id, entity_id, field_idx, tag) VALUES (%s,%s,%s,%s)",
                [(dataset_id, entity_id, field_idx, tag) for field_idx, tag in fields],
            )

    subfields = projections.extract_subfield_rows(parsed)
    if subfields:
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO subfield (dataset_id, entity_id, field_idx, sub_idx, code_raw, code_norm, value) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                [
                    (dataset_id, entity_id, field_idx, sub_idx, code_raw, code_norm, value)
                    for field_idx, sub_idx, code_raw, code_norm, value in subfields
                ],
            )


def update_entity_record(
    dataset_id: str,
    *,
    record_id: str,
    type_raw: str,
    intermarc: Intermarc,
    conn=None,
) -> UpdatedEntity:
    """Upsert a single entity row and refresh its projections atomically."""
    intermarc_json = intermarc.to_json_string()
    ark = _extract_ark(intermarc)
    parsed = projections.ParsedRecord(
        record_id=record_id,
        type_raw=type_raw,
        type_norm=canonical_type_key(type_raw),
        ark=ark,
        intermarc=intermarc,
        intermarc_raw=intermarc_json,
    )

    def _do_upsert(db_conn):
        row = db_conn.execute(
            "SELECT entity_id FROM entity WHERE dataset_id=%s AND record_id=%s FOR UPDATE",
            (dataset_id, record_id),
        ).fetchone()
        if row:
            entity_id = row["entity_id"]
            db_conn.execute(
                """
                UPDATE entity
                SET ark=%s, type_raw=%s, type_norm=%s, record=%s, updated_at=now()
                WHERE dataset_id=%s AND entity_id=%s
                """,
                (ark, type_raw, parsed.type_norm, Json(json.loads(intermarc_json)), dataset_id, entity_id),
            )
        else:
            res = db_conn.execute(
                """
                INSERT INTO entity (dataset_id, record_id, ark, type_raw, type_norm, record)
                VALUES (%s,%s,%s,%s,%s,%s)
                RETURNING entity_id
                """,
                (dataset_id, record_id, ark, type_raw, parsed.type_norm, Json(json.loads(intermarc_json))),
            ).fetchone()
            entity_id = res["entity_id"]

        _refresh_projections(db_conn, dataset_id, entity_id, parsed)
        return entity_id

    if conn is None:
        with dataset_transaction(dataset_id) as locked:
            entity_id = _do_upsert(locked)
    else:
        entity_id = _do_upsert(conn)

    touch_dataset_row(dataset_id)
    return UpdatedEntity(
        entity_id=entity_id,
        record_id=record_id,
        ark=ark,
        type_raw=type_raw,
        type_norm=parsed.type_norm,
        intermarc=intermarc,
    )


def update_entities_batch(
    dataset_id: str,
    updates: Iterable[tuple[str, str, Intermarc]],
) -> List[UpdatedEntity]:
    """Apply multiple updates under a single dataset lock (helper for bulk ops)."""
    updated: List[UpdatedEntity] = []
    with dataset_transaction(dataset_id) as conn:
        for record_id, type_raw, intermarc in updates:
            updated.append(
                update_entity_record(
                    dataset_id,
                    record_id=record_id,
                    type_raw=type_raw,
                    intermarc=intermarc,
                    conn=conn,
                )
            )
    return updated
