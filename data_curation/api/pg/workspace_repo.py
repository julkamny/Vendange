"""SQL-backed workspace queries (works, agents, records, backlinks)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from data_curation.api.db_shared import RELATION_NS
from data_curation.api.pg.session import db_session, statement_timeout
from data_curation.api.schemas import (
    BacklinkItem,
    BacklinksPayload,
    RecordPayload,
    WorkspaceAgentsResponse,
    WorkspaceWorksResponse,
    WorkListRow,
    AgentListRow,
)


def _record_id_expr() -> str:
    return "record_id"


def _title_expr() -> str:
    return "el.label"


def list_works(dataset_id: str, limit: int = 200, offset: int = 0) -> WorkspaceWorksResponse:
    query = """
        SELECT e.entity_id, {record_id} as record_id, e.ark, el.label, el.sort_key, el.type_norm
        FROM entity e
        JOIN entity_label el USING (dataset_id, entity_id)
        WHERE e.dataset_id=%s AND el.type_norm='oeuvre'
        ORDER BY el.sort_key NULLS LAST
        LIMIT %s OFFSET %s
    """.format(record_id=_record_id_expr())
    with db_session() as conn, statement_timeout(conn, 5000):
        rows = conn.execute(query, (dataset_id, limit, offset)).fetchall()
    unclustered = [
        WorkListRow(
            id=row["record_id"] or str(row["entity_id"]),
            ark=row["ark"],
            title=row["label"],
            title_segments=[],
            type_norm=row["type_norm"],
            summary=None,
        )
        for row in rows
    ]
    return WorkspaceWorksResponse(clusters=[], unclustered_works=unclustered)


def list_agents(dataset_id: str, limit: int = 200, offset: int = 0) -> WorkspaceAgentsResponse:
    query = """
        SELECT e.entity_id, {record_id} as record_id, e.ark, el.label, el.sort_key, el.type_norm
        FROM entity e
        JOIN entity_label el USING (dataset_id, entity_id)
        WHERE e.dataset_id=%s AND el.type_norm IN ('personne','collectivite','famille')
        ORDER BY el.sort_key NULLS LAST
        LIMIT %s OFFSET %s
    """.format(record_id=_record_id_expr())
    with db_session() as conn, statement_timeout(conn, 5000):
        rows = conn.execute(query, (dataset_id, limit, offset)).fetchall()
    unclustered = [
        AgentListRow(
            id=row["record_id"] or str(row["entity_id"]),
            ark=row["ark"],
            label=row["label"],
            type_norm=row["type_norm"],
            title_segments=[],
            sort_key=row["sort_key"],
        )
        for row in rows
    ]
    return WorkspaceAgentsResponse(clusters=[], unclustered_agents=unclustered)


def get_entity_by_key(dataset_id: str, key: str) -> Optional[Dict[str, Any]]:
    """Accept entity_id (int) or ark string or record id."""
    with db_session() as conn, statement_timeout(conn, 5000):
        row = conn.execute(
            f"""
            SELECT e.entity_id, { _record_id_expr() } as record_id, e.ark, el.label, el.type_norm, e.record
            FROM entity e
            LEFT JOIN entity_label el USING (dataset_id, entity_id)
            WHERE e.dataset_id=%s AND (
                e.ark = %s OR
                { _record_id_expr() } = %s OR
                e.entity_id::text = %s
            )
            LIMIT 1
            """,
            (dataset_id, key, key, key),
        ).fetchone()
    if not row:
        return None
    return dict(row)


def record_payload(dataset_id: str, key: str) -> Optional[RecordPayload]:
    row = get_entity_by_key(dataset_id, key)
    if not row:
        return None
    return RecordPayload(
        id=row["record_id"] or str(row["entity_id"]),
        type=row.get("type_norm") or "",
        ark=row.get("ark"),
        intermarc=json_dumps(row["record"]),
        ark_labels={},  # placeholder; can be filled later
    )


def _predicate_to_field(predicate_iri: str) -> str:
    if predicate_iri.startswith(RELATION_NS):
        return predicate_iri[len(RELATION_NS) :]
    return predicate_iri


def get_backlinks(dataset_id: str, key: str) -> Optional[BacklinksPayload]:
    target = get_entity_by_key(dataset_id, key)
    if not target:
        return None
    ark = target.get("ark")
    if not ark:
        return BacklinksPayload(target_id=target["record_id"], target_ark=None, backlinks=[])
    with db_session() as conn, statement_timeout(conn, 5000):
        rows = conn.execute(
            """
            SELECT e.entity_id, e.ark, el.label, el.type_norm, re.predicate_iri, re.tgt_ark, e.record
            FROM rel_edge re
            JOIN entity e ON e.dataset_id=re.dataset_id AND e.entity_id=re.src_entity_id
            LEFT JOIN entity_label el ON el.dataset_id=e.dataset_id AND el.entity_id=e.entity_id
            WHERE re.dataset_id=%s AND re.tgt_ark=%s
            """,
            (dataset_id, ark),
        ).fetchall()
    backlinks: List[BacklinkItem] = []
    for row in rows:
        field_code = _predicate_to_field(row["predicate_iri"])
        record_id = row["record"].get("id_entitelrm") if isinstance(row["record"], dict) else None
        backlinks.append(
            BacklinkItem(
                id=record_id or str(row["entity_id"]),
                ark=row.get("ark"),
                type=row.get("type_norm") or "",
                type_norm=row.get("type_norm"),
                title=row.get("label"),
                title_segments=[],
                fields=[field_code],
            )
        )
    return BacklinksPayload(
        target_id=target["record_id"] or str(target["entity_id"]),
        target_ark=ark,
        backlinks=backlinks,
    )


def json_dumps(obj: Any) -> str:
    import json

    return json.dumps(obj, ensure_ascii=False)
