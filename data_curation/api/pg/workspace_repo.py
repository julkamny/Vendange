"""SQL-backed workspace queries (works, agents, records, backlinks)."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Tuple

from data_curation.api.db_shared import RELATION_NS
from data_curation.api.pg.session import db_session, statement_timeout
from data_curation.api.schemas import (
    AgentCluster,
    AgentClusterItem,
    AgentListRow,
    BacklinkItem,
    BacklinksPayload,
    CountStats,
    EntitySummary,
    ExpressionAnchorGroupView,
    ExpressionClusterItemView,
    ExpressionItemView,
    ManifestationItemView,
    RecordPayload,
    TitleSegment,
    WorkCluster,
    WorkClusterItem,
    WorkListRow,
    WorkspaceAgentsResponse,
    WorkspaceWorksResponse,
)
from data_curation.api.pg.ark_labeling_repo import resolve_ark_label_map_for_records
from data_curation.api.pg.record_labeling import build_title_segments
from data_curation.api.pg.record_labeling import build_label_from_record


WORK_LINK_PREDICATE = f"{RELATION_NS}750s3"


def _record_id_expr() -> str:
    return "record_id"

def _title_zone_for_type(type_norm: str) -> str:
    norm = (type_norm or "").lower()
    if norm == "manifestation":
        return "245"
    if norm in {"personne", "identite publique de personne", "identité publique de personne"}:
        return "100"
    if norm in {"collectivite", "famille"}:
        return {"collectivite": "110", "famille": "120"}[norm]
    return "150"


def _allowed_title_subfields(type_norm: str) -> Optional[set[str]]:
    norm = (type_norm or "").lower()
    if norm in {"personne", "identite publique de personne", "identité publique de personne"}:
        return {"100$a", "100$m", "100$e"}
    if norm == "collectivite":
        return {"110$a", "110$q"}
    if norm == "famille":
        return {"120$a", "120$m", "120$e"}
    return None


def _strip_pipes_in_title(type_norm: str) -> bool:
    return (type_norm or "").lower() in {"personne", "identite publique de personne", "identité publique de personne", "collectivite", "famille"}


AGENT_TYPE_NORMS = ("identite publique de personne", "personne", "collectivite", "famille")


def _label_from_record(type_norm: str, record: Any, *, fallback: str) -> str:
    if isinstance(record, dict):
        label = build_label_from_record(type_raw=type_norm, type_norm=type_norm, record=record)
        if label:
            return label
    return fallback


def _counts_for_work_arks(dataset_id: str, work_arks: List[str]) -> Tuple[Dict[str, int], Dict[str, int]]:
    """Return (expressions_count_by_work_ark, manifestations_count_by_work_ark)."""
    if not work_arks:
        return {}, {}
    expr_counts: Dict[str, int] = {}
    manif_counts: Dict[str, int] = {}
    with db_session() as conn, statement_timeout(conn, 5000):
        expr_rows = conn.execute(
            """
            SELECT tgt_ark AS work_ark, count(*) AS cnt
            FROM rel_edge
            WHERE dataset_id=%s AND predicate_iri=%s AND tgt_ark = ANY(%s)
            GROUP BY tgt_ark
            """,
            (dataset_id, WORK_LINK_PREDICATE, work_arks),
        ).fetchall()
        for row in expr_rows:
            expr_counts[row["work_ark"]] = row["cnt"]

        manif_rows = conn.execute(
            """
            SELECT wrel.tgt_ark AS work_ark, count(DISTINCT mrel.src_entity_id) AS cnt
            FROM rel_edge mrel
            JOIN entity expr ON expr.dataset_id = mrel.dataset_id AND expr.ark = mrel.tgt_ark
            JOIN rel_edge wrel ON wrel.dataset_id = expr.dataset_id AND wrel.src_entity_id = expr.entity_id AND wrel.predicate_iri = %s
            WHERE mrel.dataset_id=%s AND mrel.predicate_iri=%s AND wrel.tgt_ark = ANY(%s)
            GROUP BY wrel.tgt_ark
            """,
            (WORK_LINK_PREDICATE, dataset_id, f"{RELATION_NS}740s3", work_arks),
        ).fetchall()
        for row in manif_rows:
            manif_counts[row["work_ark"]] = row["cnt"]
    return expr_counts, manif_counts


def _manifestations_by_expression(dataset_id: str, expression_arks: List[str]) -> Dict[str, List[ManifestationItemView]]:
    """Return manifestation view lists keyed by expression ark."""
    if not expression_arks:
        return {}
    with db_session() as conn, statement_timeout(conn, 5000):
        rows = conn.execute(
            """
            SELECT m.entity_id,
                   m.record_id,
                   m.ark,
                   m.record,
                   el.label,
                   rel.tgt_ark AS expression_ark
            FROM rel_edge rel
            JOIN entity m ON m.dataset_id = rel.dataset_id AND m.entity_id = rel.src_entity_id
            LEFT JOIN entity_label el ON el.dataset_id = m.dataset_id AND el.entity_id = m.entity_id
            WHERE rel.dataset_id = %s
              AND rel.predicate_iri = %s
              AND rel.tgt_ark = ANY(%s)
              AND m.type_norm = 'manifestation'
            """,
            (dataset_id, f"{RELATION_NS}740s3", expression_arks),
        ).fetchall()
    by_expr: Dict[str, List[ManifestationItemView]] = {}
    for row in rows:
        expr_ark = row["expression_ark"]
        title = row.get("label") or row.get("ark") or str(row.get("record_id") or row.get("entity_id"))
        man_view = ManifestationItemView(
            id=row["record_id"] or str(row["entity_id"]),
            ark=row.get("ark"),
            title=title,
            expression_ark=expr_ark,
            expression_id=None,
            original_expression_ark=None,
            summary=None,
        )
        by_expr.setdefault(expr_ark, []).append(man_view)
    return by_expr


def _build_entity_title(dataset_id: str, entity_row: Dict[str, Any]) -> Tuple[str, List[TitleSegment]]:
    record = entity_row.get("record") or {}
    type_norm = entity_row.get("type_norm") or ""
    zone = _title_zone_for_type(type_norm)
    allowed = _allowed_title_subfields(type_norm)
    labels = resolve_ark_label_map_for_records(dataset_id, [record]) if record else {}
    segments = build_title_segments(
        record,
        zone_code=zone,
        ark_labels=labels,
        allowed_subfields=allowed,
        strip_pipes=_strip_pipes_in_title(type_norm),
    )
    title = entity_row.get("label") or " ".join(seg.value for seg in segments) or entity_row.get("ark") or ""
    return title, segments


def list_works(dataset_id: str, limit: int = 200, offset: int = 0) -> WorkspaceWorksResponse:
    # Fetch clusters (anchor + members) first
    cluster_rows: List[dict] = []
    with db_session() as conn, statement_timeout(conn, 5000):
        cluster_rows = conn.execute(
            """
            SELECT c.anchor_ark,
                   c.member_ark,
                   c.note,
                   a.record_id   AS anchor_record_id,
                   a.entity_id   AS anchor_entity_id,
                   a.record      AS anchor_record,
                   la.label      AS anchor_label,
                   la.sort_key   AS anchor_sort_key,
                   m.record_id   AS member_record_id,
                   m.entity_id   AS member_entity_id,
                   m.record      AS member_record,
                   lm.label      AS member_label
            FROM cluster c
            LEFT JOIN entity a ON a.dataset_id = c.dataset_id AND a.ark = c.anchor_ark
            LEFT JOIN entity_label la ON la.dataset_id = c.dataset_id AND la.entity_id = a.entity_id
            LEFT JOIN entity m ON m.dataset_id = c.dataset_id AND m.ark = c.member_ark
            LEFT JOIN entity_label lm ON lm.dataset_id = c.dataset_id AND lm.entity_id = m.entity_id
            WHERE c.dataset_id = %s AND la.type_norm = 'oeuvre'
            ORDER BY
                COALESCE(
                    (
                        SELECT replace(sub->>'valeur', '|', '')
                        FROM jsonb_array_elements(a.record->'zones') z
                        JOIN LATERAL jsonb_array_elements(COALESCE(z->'sousZones', '[]'::jsonb)) sub ON true
                        WHERE z->>'code' = '150' AND sub->>'code' = '150$a'
                        LIMIT 1
                    ),
                    la.sort_key
                ) NULLS LAST,
                c.anchor_ark
            LIMIT %s OFFSET %s
            """,
            (dataset_id, limit, offset),
        ).fetchall()

    clusters: dict[str, WorkCluster] = {}
    page_ark_labels = resolve_ark_label_map_for_records(
        dataset_id,
        [row.get("anchor_record") for row in cluster_rows] + [row.get("member_record") for row in cluster_rows],
        zone_codes={"150"},
    )

    for row in cluster_rows:
        anchor_id = row["anchor_record_id"] or str(row["anchor_entity_id"]) if row["anchor_entity_id"] else row["anchor_ark"]
        if not anchor_id:
            continue
        cluster = clusters.get(anchor_id)
        if not cluster:
            anchor_entity = {
                "record": row.get("anchor_record"),
                "label": row.get("anchor_label"),
                "ark": row.get("anchor_ark"),
                "record_id": row.get("anchor_record_id"),
                "entity_id": row.get("anchor_entity_id"),
                "type_norm": "oeuvre",
            }
            anchor_record = anchor_entity.get("record") if isinstance(anchor_entity.get("record"), dict) else {}
            anchor_segments = build_title_segments(anchor_record, zone_code="150", ark_labels=page_ark_labels)
            anchor_title = row.get("anchor_label") or " ".join(seg.value for seg in anchor_segments) or row.get("anchor_ark") or anchor_id
            cluster = WorkCluster(
                anchor_id=anchor_id,
                anchor_ark=row["anchor_ark"],
                anchor_title=anchor_title,
                anchor_title_segments=anchor_segments,
                anchor_summary=None,
                items=[],
                expression_groups=[],
                independent_expressions=[],
            )
            clusters[anchor_id] = cluster

        # member row
        member_entity = {
            "record": row.get("member_record"),
            "label": row.get("member_label"),
            "ark": row.get("member_ark"),
            "record_id": row.get("member_record_id"),
            "entity_id": row.get("member_entity_id"),
            "type_norm": "oeuvre",
        }
        member_record = member_entity.get("record") if isinstance(member_entity.get("record"), dict) else {}
        member_segments = build_title_segments(member_record, zone_code="150", ark_labels=page_ark_labels)
        member_title = row.get("member_label") or " ".join(seg.value for seg in member_segments) or row.get("member_ark") or ""
        cluster.items.append(
            WorkClusterItem(
                ark=row["member_ark"],
                id=row.get("member_record_id") or (str(row.get("member_entity_id")) if row.get("member_entity_id") else None),
                title=member_title,
                title_segments=member_segments,
                accepted=True,
                date=None,
                origin=row.get("note") or "manual",
                summary=None,
            )
        )

    # Compute summary counts for anchors and members
    work_arks = [row["anchor_ark"] for row in cluster_rows if row.get("anchor_ark")] + [
        row["member_ark"] for row in cluster_rows if row.get("member_ark")
    ]
    expr_counts, manif_counts = _counts_for_work_arks(dataset_id, work_arks)
    for cluster in clusters.values():
        if cluster.anchor_ark:
            cluster.anchor_summary = EntitySummary(
                counts=CountStats(
                    expressions=expr_counts.get(cluster.anchor_ark, 0),
                    manifestations=manif_counts.get(cluster.anchor_ark, 0),
                )
            )
        for item in cluster.items:
            if item.ark:
                item.summary = EntitySummary(
                    counts=CountStats(
                        expressions=expr_counts.get(item.ark, 0),
                        manifestations=manif_counts.get(item.ark, 0),
                    )
                )

    # Fetch unclustered works (those not appearing in cluster table as anchor)
    anchor_arks = [row["anchor_ark"] for row in cluster_rows if row.get("anchor_ark")]
    query = """
        SELECT e.entity_id, {record_id} as record_id, e.ark, el.label, el.sort_key, el.type_norm, e.record
        FROM entity e
        JOIN entity_label el USING (dataset_id, entity_id)
        WHERE e.dataset_id=%s AND el.type_norm='oeuvre' AND (e.ark IS NULL OR e.ark <> ALL(%s))
        ORDER BY
            COALESCE(
                (
                    SELECT replace(sub->>'valeur', '|', '')
                    FROM jsonb_array_elements(e.record->'zones') z
                    JOIN LATERAL jsonb_array_elements(COALESCE(z->'sousZones', '[]'::jsonb)) sub ON true
                    WHERE z->>'code' = '150' AND sub->>'code' = '150$a'
                    LIMIT 1
                ),
                el.sort_key
            ) NULLS LAST
        LIMIT %s OFFSET %s
    """.format(record_id=_record_id_expr())
    with db_session() as conn, statement_timeout(conn, 5000):
        rows = conn.execute(query, (dataset_id, anchor_arks or ["{}"], limit, offset)).fetchall()
    unc_arks = [row["ark"] for row in rows if row.get("ark")]
    expr_unc, manif_unc = _counts_for_work_arks(dataset_id, unc_arks)
    unclustered = []
    page_ark_labels.update(
        resolve_ark_label_map_for_records(dataset_id, [row.get("record") for row in rows], zone_codes={"150"})
    )
    for row in rows:
        ark = row["ark"]
        rec = row.get("record") if isinstance(row.get("record"), dict) else {}
        unclustered.append(
            WorkListRow(
                id=row["record_id"] or str(row["entity_id"]),
                ark=ark,
                title=row["label"],
                title_segments=build_title_segments(rec, zone_code="150", ark_labels=page_ark_labels),
                type_norm=row["type_norm"],
                summary=EntitySummary(
                    counts=CountStats(
                        expressions=expr_unc.get(ark, 0),
                        manifestations=manif_unc.get(ark, 0),
                    )
                )
                if ark
                else None,
            )
        )
    return WorkspaceWorksResponse(clusters=list(clusters.values()), unclustered_works=unclustered)


def list_agents(dataset_id: str, limit: int = 200, offset: int = 0) -> WorkspaceAgentsResponse:
    cluster_rows: List[dict] = []
    with db_session() as conn, statement_timeout(conn, 5000):
        cluster_rows = conn.execute(
            """
            SELECT c.anchor_ark,
                   c.member_ark,
                   c.note,
                   a.record_id   AS anchor_record_id,
                   a.entity_id   AS anchor_entity_id,
                   a.record      AS anchor_record,
                   la.label      AS anchor_label,
                   la.sort_key   AS anchor_sort_key,
                   la.type_norm  AS anchor_type_norm,
                   m.record_id   AS member_record_id,
                   m.entity_id   AS member_entity_id,
                   m.record      AS member_record,
                   lm.label      AS member_label,
                   lm.type_norm  AS member_type_norm
            FROM cluster c
            LEFT JOIN entity a ON a.dataset_id = c.dataset_id AND a.ark = c.anchor_ark
            LEFT JOIN entity_label la ON la.dataset_id = c.dataset_id AND la.entity_id = a.entity_id
            LEFT JOIN entity m ON m.dataset_id = c.dataset_id AND m.ark = c.member_ark
            LEFT JOIN entity_label lm ON lm.dataset_id = c.dataset_id AND lm.entity_id = m.entity_id
            WHERE c.dataset_id = %s AND la.type_norm = ANY(%s)
            ORDER BY la.sort_key NULLS LAST, c.anchor_ark
            LIMIT %s OFFSET %s
            """,
            (dataset_id, list(AGENT_TYPE_NORMS), limit, offset),
        ).fetchall()

    clusters: dict[str, AgentCluster] = {}
    page_ark_labels = resolve_ark_label_map_for_records(
        dataset_id,
        [row.get("anchor_record") for row in cluster_rows] + [row.get("member_record") for row in cluster_rows],
        zone_codes={"100", "110", "120"},
    )
    for row in cluster_rows:
        anchor_id = row["anchor_record_id"] or str(row["anchor_entity_id"]) if row["anchor_entity_id"] else row["anchor_ark"]
        if not anchor_id:
            continue
        cluster = clusters.get(anchor_id)
        if not cluster:
            anchor_entity = {
                "record": row.get("anchor_record"),
                "label": row.get("anchor_label"),
                "ark": row.get("anchor_ark"),
                "record_id": row.get("anchor_record_id"),
                "entity_id": row.get("anchor_entity_id"),
                "type_norm": row.get("anchor_type_norm") or "",
            }
            type_norm = anchor_entity.get("type_norm") or ""
            zone = _title_zone_for_type(type_norm)
            allowed = _allowed_title_subfields(type_norm)
            strip_pipes = _strip_pipes_in_title(type_norm)
            anchor_title_segments = build_title_segments(
                anchor_entity.get("record") if isinstance(anchor_entity.get("record"), dict) else {},
                zone_code=zone,
                ark_labels=page_ark_labels,
                allowed_subfields=allowed,
                strip_pipes=strip_pipes,
            )
            cluster = AgentCluster(
                anchor_id=anchor_id,
                anchor_ark=row.get("anchor_ark"),
                anchor_label=_label_from_record(
                    type_norm,
                    anchor_entity.get("record"),
                    fallback=row.get("anchor_label") or row.get("anchor_ark") or anchor_id,
                ),
                anchor_type_norm=row.get("anchor_type_norm"),
                anchor_title_segments=anchor_title_segments,
                sort_key=row.get("anchor_sort_key"),
                items=[],
            )
            clusters[anchor_id] = cluster
        member_entity = {
            "record": row.get("member_record"),
            "label": row.get("member_label"),
            "ark": row.get("member_ark"),
            "record_id": row.get("member_record_id"),
            "entity_id": row.get("member_entity_id"),
            "type_norm": row.get("member_type_norm") or "",
        }
        type_norm = member_entity.get("type_norm") or ""
        zone = _title_zone_for_type(type_norm)
        allowed = _allowed_title_subfields(type_norm)
        strip_pipes = _strip_pipes_in_title(type_norm)
        cluster.items.append(
            AgentClusterItem(
                ark=row["member_ark"],
                id=row.get("member_record_id")
                or (str(row.get("member_entity_id")) if row.get("member_entity_id") else None),
                label=_label_from_record(
                    type_norm,
                    member_entity.get("record"),
                    fallback=row.get("member_label") or row.get("member_ark") or "",
                ),
                origin=row.get("note") or "manual",
                type_norm=row.get("member_type_norm"),
                accepted=True,
                title_segments=build_title_segments(
                    member_entity.get("record") if isinstance(member_entity.get("record"), dict) else {},
                    zone_code=zone,
                    ark_labels=page_ark_labels,
                    allowed_subfields=allowed,
                    strip_pipes=strip_pipes,
                ),
                sort_key=row.get("anchor_sort_key"),
            )
        )

    anchor_arks = [row["anchor_ark"] for row in cluster_rows if row.get("anchor_ark")]
    query = """
        SELECT e.entity_id, {record_id} as record_id, e.ark, el.label, el.sort_key, el.type_norm, e.record
        FROM entity e
        JOIN entity_label el USING (dataset_id, entity_id)
        WHERE e.dataset_id=%s AND el.type_norm = ANY(%s) AND (e.ark IS NULL OR e.ark <> ALL(%s))
        ORDER BY el.sort_key NULLS LAST
        LIMIT %s OFFSET %s
    """.format(record_id=_record_id_expr())
    with db_session() as conn, statement_timeout(conn, 5000):
        rows = conn.execute(query, (dataset_id, list(AGENT_TYPE_NORMS), anchor_arks or ['{}'], limit, offset)).fetchall()
    unclustered = [
        AgentListRow(
            id=row["record_id"] or str(row["entity_id"]),
            ark=row["ark"],
            label=_label_from_record(
                row.get("type_norm") or "",
                row.get("record"),
                fallback=row.get("label") or row.get("ark") or row.get("record_id") or str(row.get("entity_id") or ""),
            ),
            type_norm=row["type_norm"],
            title_segments=build_title_segments(
                row.get("record") if isinstance(row.get("record"), dict) else {},
                zone_code=_title_zone_for_type(row.get("type_norm") or ""),
                ark_labels=page_ark_labels,
                allowed_subfields=_allowed_title_subfields(row.get("type_norm") or ""),
                strip_pipes=_strip_pipes_in_title(row.get("type_norm") or ""),
            ),
            sort_key=row["sort_key"],
        )
        for row in rows
    ]
    return WorkspaceAgentsResponse(clusters=list(clusters.values()), unclustered_agents=unclustered)


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
    ark_labels = resolve_ark_label_map_for_records(dataset_id, [row.get("record") or {}])
    return RecordPayload(
        id=row["record_id"] or str(row["entity_id"]),
        type=row.get("type_norm") or "",
        ark=row.get("ark"),
        intermarc=json_dumps(row["record"]),
        ark_labels=ark_labels,
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
    """Return a WorkCluster for the given work (record id, ark, or entity_id).

    Mirrors the legacy behavior: when expanding a work that belongs to a work cluster,
    expressions are aggregated over *all* works in that cluster.
    """

    requested = get_entity_by_key(dataset_id, anchor_key)
    if not requested:
        return None
    if (requested.get("type_norm") or "").lower() != "oeuvre":
        return None

    requested_ark = requested.get("ark")
    cluster_anchor_ark = requested_ark
    if requested_ark:
        with db_session() as conn, statement_timeout(conn, 3000):
            row = conn.execute(
                """
                SELECT anchor_ark
                FROM cluster
                WHERE dataset_id=%s AND member_ark=%s
                LIMIT 1
                """,
                (dataset_id, requested_ark),
            ).fetchone()
        if row and row.get("anchor_ark"):
            cluster_anchor_ark = row["anchor_ark"]

    anchor = requested
    if cluster_anchor_ark and cluster_anchor_ark != requested_ark:
        with db_session() as conn, statement_timeout(conn, 3000):
            row = conn.execute(
                """
                SELECT e.entity_id, {record_id} as record_id, e.ark, el.label, el.type_norm, e.record
                FROM entity e
                LEFT JOIN entity_label el USING (dataset_id, entity_id)
                WHERE e.dataset_id=%s AND e.ark=%s
                LIMIT 1
                """.format(record_id=_record_id_expr()),
                (dataset_id, cluster_anchor_ark),
            ).fetchone()
        if row:
            anchor = dict(row)

    anchor_ark = anchor.get("ark")
    anchor_title = anchor.get("label")
    anchor_record = anchor.get("record") or {}
    # Resolve ARK labels for the anchor title in one shot.
    anchor_labels = resolve_ark_label_map_for_records(dataset_id, [anchor_record]) if isinstance(anchor_record, dict) else {}
    anchor_title_segments = build_title_segments(anchor_record, zone_code="150", ark_labels=anchor_labels)

    items: List[WorkClusterItem] = []
    member_entities: Dict[str, Dict[str, Any]] = {}
    if anchor_ark:
        with db_session() as conn, statement_timeout(conn, 3000):
            rows = conn.execute(
                """
                SELECT c.member_ark, c.note, e.record_id, e.entity_id, e.record, el.label
                FROM cluster c
                LEFT JOIN entity e ON e.dataset_id=c.dataset_id AND e.ark=c.member_ark
                LEFT JOIN entity_label el ON el.dataset_id=e.dataset_id AND el.entity_id=e.entity_id
                WHERE c.dataset_id=%s AND c.anchor_ark=%s
                """,
                (dataset_id, anchor_ark),
            ).fetchall()
        for row in rows:
            member_entities[row["member_ark"]] = dict(row)
            member_record = row.get("record") if isinstance(row.get("record"), dict) else {}
            member_segments = build_title_segments(
                member_record,
                zone_code="150",
                ark_labels=resolve_ark_label_map_for_records(dataset_id, [member_record]),
            )
            member_title = row.get("label") or " ".join(seg.value for seg in member_segments) or row.get("member_ark") or ""
            items.append(
                WorkClusterItem(
                    ark=row["member_ark"],
                    id=row.get("record_id") or (str(row.get("entity_id")) if row.get("entity_id") else None),
                    title=member_title,
                    title_segments=member_segments,
                    accepted=True,
                    origin=row.get("note") or "manual",
                )
            )

    cluster_work_arks = [anchor_ark] + [item.ark for item in items if item.ark] if anchor_ark else []
    work_id_by_ark: Dict[str, str] = {}
    if anchor_ark:
        work_id_by_ark[anchor_ark] = anchor.get("record_id") or str(anchor.get("entity_id") or "")
    for item in items:
        if item.ark and item.id:
            work_id_by_ark[item.ark] = item.id

    # Build expression groups: expressions that reference any work in the cluster (750$3)
    expression_groups: List[ExpressionAnchorGroupView] = []
    independent_expressions: List[ExpressionItemView] = []
    if cluster_work_arks:
        with db_session() as conn, statement_timeout(conn, 5000):
            expr_rows = conn.execute(
                """
                SELECT e.entity_id,
                       e.ark,
                       e.record_id,
                       e.record,
                       el.label,
                       el.sort_key,
                       rel.tgt_ark AS work_ark
                FROM rel_edge rel
                JOIN entity e ON e.dataset_id = rel.dataset_id AND e.entity_id = rel.src_entity_id
                JOIN entity_label el ON el.dataset_id = e.dataset_id AND el.entity_id = e.entity_id
                WHERE rel.dataset_id = %s
                  AND rel.predicate_iri = %s
                  AND rel.tgt_ark = ANY(%s)
                  AND e.type_norm = 'expression'
                ORDER BY e.entity_id,
                         CASE WHEN rel.tgt_ark = %s THEN 0 ELSE 1 END,
                         rel.tgt_ark
                """,
                (dataset_id, WORK_LINK_PREDICATE, cluster_work_arks, anchor_ark or ""),
            ).fetchall()

        # Prefer the first work_ark for an expression (ordering above prioritizes the anchor work).
        expressions_by_ark: Dict[str, Dict[str, Any]] = {}
        ordered_expr_rows: List[Dict[str, Any]] = []
        for row in expr_rows:
            ark = row.get("ark")
            if not ark or ark in expressions_by_ark:
                continue
            payload = dict(row)
            expressions_by_ark[ark] = payload
            ordered_expr_rows.append(payload)
        manifestations_map = _manifestations_by_expression(dataset_id, list(expressions_by_ark.keys()))

        cluster_rows: List[dict] = []
        if expressions_by_ark:
            with db_session() as conn, statement_timeout(conn, 5000):
                cluster_rows = conn.execute(
                    """
                    SELECT c.anchor_ark,
                           c.member_ark,
                           c.note,
                           ea.entity_id   AS anchor_entity_id,
                           ea.record_id   AS anchor_record_id,
                           ea.record      AS anchor_record,
                           ela.label      AS anchor_label,
                           em.entity_id   AS member_entity_id,
                           em.record_id   AS member_record_id,
                           em.record      AS member_record,
                           elm.label      AS member_label
                    FROM cluster c
                    LEFT JOIN entity ea ON ea.dataset_id = c.dataset_id AND ea.ark = c.anchor_ark
                    LEFT JOIN entity_label ela ON ela.dataset_id = c.dataset_id AND ela.entity_id = ea.entity_id
                    LEFT JOIN entity em ON em.dataset_id = c.dataset_id AND em.ark = c.member_ark
                    LEFT JOIN entity_label elm ON elm.dataset_id = c.dataset_id AND elm.entity_id = em.entity_id
                    WHERE c.dataset_id = %s AND c.anchor_ark = ANY(%s)
                    """,
                    (dataset_id, list(expressions_by_ark.keys())),
                ).fetchall()

        clustered_by: Dict[str, str] = {}
        clustered_by_anchor: Dict[str, List[ExpressionClusterItemView]] = {}
        for row in cluster_rows:
            anchor_ark_row = row.get("anchor_ark")
            member_ark = row.get("member_ark")
            if anchor_ark_row and member_ark:
                clustered_by.setdefault(member_ark, anchor_ark_row)
            anchor_expr = expressions_by_ark.get(anchor_ark_row)
            if not anchor_expr:
                continue
            member_entity = {
                "record": row.get("member_record"),
                "label": row.get("member_label"),
                "ark": row.get("member_ark"),
                "record_id": row.get("member_record_id"),
                "entity_id": row.get("member_entity_id"),
            }
            member_title = row.get("member_label") or row.get("member_ark")
            clustered_by_anchor.setdefault(anchor_ark_row, []).append(
                ExpressionClusterItemView(
                    anchor_expression_id=anchor_expr.get("record_id")
                    or (str(anchor_expr.get("entity_id")) if anchor_expr.get("entity_id") else ""),
                    id=member_entity.get("record_id")
                    or (str(member_entity.get("entity_id")) if member_entity.get("entity_id") else None),
                    ark=member_entity.get("ark"),
                    title=member_title,
                    work_ark=expressions_by_ark.get(member_entity.get("ark") or "", {}).get("work_ark"),
                    work_id=work_id_by_ark.get(
                        expressions_by_ark.get(member_entity.get("ark") or "", {}).get("work_ark") or ""
                    ),
                    manifestations=[],
                    accepted=True,
                    origin=row.get("note") or "manual",
                    summary=None,
                )
            )

        used_expr_arks: set[str] = set()

        for expr in ordered_expr_rows:
            expr_entity = {
                "record": expr.get("record"),
                "label": expr.get("label"),
                "ark": expr.get("ark"),
                "record_id": expr.get("record_id"),
                "entity_id": expr.get("entity_id"),
                "type_norm": "expression",
            }
            expr_title, _ = _build_entity_title(dataset_id, expr_entity)
            expr_id = expr.get("record_id") or str(expr.get("entity_id"))
            expr_ark = expr.get("ark")
            expr_work_ark = expr.get("work_ark")
            if expr_ark and expr_ark in clustered_by and clustered_by.get(expr_ark) != expr_ark:
                # Expression is clustered under another anchor; avoid duplicating it at this level.
                continue
            view = ExpressionItemView(
                id=expr_id,
                ark=expr_ark,
                title=expr_title,
                work_ark=expr_work_ark,
                work_id=work_id_by_ark.get(expr_work_ark or ""),
                manifestations=manifestations_map.get(expr_ark, []) if expr_ark else [],
                summary=None,
            )

            clustered = clustered_by_anchor.get(expr_ark or "", [])
            should_anchor = bool(clustered) or (expr_work_ark == anchor_ark)
            if should_anchor:
                for c in clustered:
                    if c.ark:
                        c.manifestations = manifestations_map.get(c.ark, [])
                expression_groups.append(ExpressionAnchorGroupView(anchor=view, clustered=clustered))
                if expr_ark:
                    used_expr_arks.add(expr_ark)
                for c in clustered:
                    if c.ark:
                        used_expr_arks.add(c.ark)

        for expr in ordered_expr_rows:
            expr_ark = expr.get("ark")
            if not expr_ark or expr_ark in used_expr_arks:
                continue
            if expr_ark in clustered_by and clustered_by.get(expr_ark) != expr_ark:
                continue
            expr_entity = {
                "record": expr.get("record"),
                "label": expr.get("label"),
                "ark": expr_ark,
                "record_id": expr.get("record_id"),
                "entity_id": expr.get("entity_id"),
                "type_norm": "expression",
            }
            expr_title, _ = _build_entity_title(dataset_id, expr_entity)
            expr_id = expr.get("record_id") or str(expr.get("entity_id"))
            expr_work_ark = expr.get("work_ark")
            independent_expressions.append(
                ExpressionItemView(
                    id=expr_id,
                    ark=expr_ark,
                    title=expr_title,
                    work_ark=expr_work_ark,
                    work_id=work_id_by_ark.get(expr_work_ark or ""),
                    manifestations=manifestations_map.get(expr_ark, []),
                    summary=None,
                )
            )

    # summaries for anchor and clustered works
    expr_counts, manif_counts = _counts_for_work_arks(dataset_id, [ark for ark in cluster_work_arks if ark])

    anchor_summary = (
        EntitySummary(
            counts=CountStats(
                expressions=expr_counts.get(anchor_ark, 0),
                manifestations=manif_counts.get(anchor_ark, 0),
            )
        )
        if anchor_ark
        else None
    )
    for item in items:
        if item.ark:
            item.summary = EntitySummary(
                counts=CountStats(
                    expressions=expr_counts.get(item.ark, 0),
                    manifestations=manif_counts.get(item.ark, 0),
                )
            )

    return WorkCluster(
        anchor_id=anchor["record_id"] or str(anchor["entity_id"]),
        anchor_ark=anchor_ark,
        anchor_title=anchor_title,
        anchor_title_segments=anchor_title_segments,
        anchor_summary=anchor_summary,
        items=items,
        expression_groups=expression_groups,
        independent_expressions=independent_expressions,
    )


def json_dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False)
