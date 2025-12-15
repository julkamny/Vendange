"""SQL-backed workspace queries (works, agents, records, backlinks)."""

from __future__ import annotations

import json
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from data_curation.api.db_shared import RELATION_NS, looks_like_ark
from data_curation.api.pg.session import db_session, statement_timeout
from data_curation.api.schemas import (
    BacklinkItem,
    BacklinksPayload,
    RecordPayload,
    WorkCluster,
    WorkClusterItem,
    WorkspaceAgentsResponse,
    WorkspaceWorksResponse,
    WorkListRow,
    AgentListRow,
)


WORK_LINK_PREDICATE = f"{RELATION_NS}750s3"
MANIFESTATION_LINK_PREDICATE = f"{RELATION_NS}740s3"


def _record_id_expr() -> str:
    return "record_id"


def _title_expr() -> str:
    return "el.label"


def _iter_subfields(record: Dict[str, Any]) -> Iterable[Tuple[str, str, Any]]:
    for zone in record.get("zones", []):
        code = zone.get("code", "")
        for sub in zone.get("sousZones", []):
            yield code, sub.get("code", ""), sub.get("valeur")


TITLE_LABELS = {
    "150$a": "Titre",
    "150$u": "Sous-titre",
    "150$m": "Complément",
    "150$e": "Mention",
    "245$a": "Titre",
}


def _title_segments(record: Optional[Dict[str, Any]], preferred_zone: str = "150") -> List[TitleSegment]:
    if not record:
        return []
    segments: List[TitleSegment] = []
    for zone_code, sub_code, value in _iter_subfields(record):
        if zone_code != preferred_zone:
            continue
        if not isinstance(value, str) or not value.strip():
            continue
        label = TITLE_LABELS.get(sub_code, sub_code)
        segments.append(TitleSegment(code=sub_code, label=label, value=value.strip()))
    return segments


def _collect_ark_labels(dataset_id: str, record: Dict[str, Any]) -> Dict[str, str]:
    arks: set[str] = set()
    for _, _, value in _iter_subfields(record):
        if isinstance(value, str) and looks_like_ark(value.strip()):
            arks.add(value.strip())
    if not arks:
        return {}
    with db_session() as conn, statement_timeout(conn, 3000):
        rows = conn.execute(
            """
            SELECT e.ark, el.label
            FROM entity e
            LEFT JOIN entity_label el USING (dataset_id, entity_id)
            WHERE e.dataset_id=%s AND e.ark = ANY(%s)
            """,
            (dataset_id, list(arks)),
        ).fetchall()
    labels = {ark: ark for ark in arks}
    for row in rows:
        labels[row["ark"]] = row.get("label") or row["ark"]
    return labels


def _fetch_entities_by_ark(dataset_id: str, arks: Sequence[str]) -> Dict[str, Dict[str, Any]]:
    if not arks:
        return {}
    with db_session() as conn, statement_timeout(conn, 5000):
        rows = conn.execute(
            """
            SELECT e.ark, e.entity_id, e.record_id, e.type_norm, e.record, el.label, el.sort_key
            FROM entity e
            LEFT JOIN entity_label el USING (dataset_id, entity_id)
            WHERE e.dataset_id=%s AND e.ark = ANY(%s)
            """,
            (dataset_id, list(arks)),
        ).fetchall()
    return {row["ark"]: dict(row) for row in rows}


def _build_entity_title(entity_row: Dict[str, Any]) -> Tuple[str, List[TitleSegment]]:
    record = entity_row.get("record") or {}
    segments = _title_segments(record, preferred_zone="150")
    title = entity_row.get("label") or next((seg.value for seg in segments), None) or entity_row.get("ark")
    return title, segments


def _entity_id(entity_row: Dict[str, Any]) -> Optional[str]:
    return entity_row.get("record_id") or (str(entity_row.get("entity_id")) if entity_row.get("entity_id") else None)


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


def get_work_cluster(dataset_id: str, anchor_key: str) -> Optional[WorkCluster]:
    """Return a WorkCluster for the given anchor (record id, ark, or entity_id)."""
    anchor = get_entity_by_key(dataset_id, anchor_key)
    if not anchor:
        return None
    if (anchor.get("type_norm") or "").lower() != "oeuvre":
        return None
    anchor_ark = anchor.get("ark")
    anchor_title = anchor.get("label")
    items: List[WorkClusterItem] = []
    if anchor_ark:
        with db_session() as conn, statement_timeout(conn, 3000):
            rows = conn.execute(
                """
                SELECT c.member_ark, c.note, e.record_id, el.label
                FROM cluster c
                LEFT JOIN entity e ON e.dataset_id=c.dataset_id AND e.ark=c.member_ark
                LEFT JOIN entity_label el ON el.dataset_id=e.dataset_id AND el.entity_id=e.entity_id
                WHERE c.dataset_id=%s AND c.anchor_ark=%s
                """,
                (dataset_id, anchor_ark),
            ).fetchall()
        for row in rows:
            items.append(
                WorkClusterItem(
                    ark=row["member_ark"],
                    id=row.get("record_id"),
                    title=row.get("label") or row.get("member_ark"),
                    title_segments=[],
                    accepted=True,
                    origin=row.get("note") or "manual",
                )
            )
    return WorkCluster(
        anchor_id=anchor["record_id"] or str(anchor["entity_id"]),
        anchor_ark=anchor_ark,
        anchor_title=anchor_title,
        anchor_title_segments=[],
        anchor_summary=None,
        items=items,
        expression_groups=[],
        independent_expressions=[],
    )


def json_dumps(obj: Any) -> str:
    import json

    return json.dumps(obj, ensure_ascii=False)
