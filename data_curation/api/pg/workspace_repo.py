"""SQL-backed workspace queries (works, agents, records, backlinks)."""

from __future__ import annotations

import json
from typing import Any, Dict, Iterable, List, Optional, Tuple

from data_curation.api.db_shared import RELATION_NS, looks_like_ark
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


WORK_LINK_PREDICATE = f"{RELATION_NS}750s3"


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


def _record_id_expr() -> str:
    return "record_id"


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
        title, _ = _build_entity_title(
            {
                "record": row.get("record"),
                "label": row.get("label"),
                "ark": row.get("ark"),
                "record_id": row.get("record_id"),
                "entity_id": row.get("entity_id"),
            }
        )
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


def _build_entity_title(entity_row: Dict[str, Any]) -> Tuple[str, List[TitleSegment]]:
    record = entity_row.get("record") or {}
    segments = _title_segments(record, preferred_zone="150")
    title = entity_row.get("label") or next((seg.value for seg in segments), None) or entity_row.get("ark")
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
            ORDER BY la.sort_key NULLS LAST, c.anchor_ark
            LIMIT %s OFFSET %s
            """,
            (dataset_id, limit, offset),
        ).fetchall()

    clusters: dict[str, WorkCluster] = {}
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
            }
            anchor_title, anchor_segments = _build_entity_title(anchor_entity)
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
        }
        member_title, member_segments = _build_entity_title(member_entity)
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
        ORDER BY el.sort_key NULLS LAST
        LIMIT %s OFFSET %s
    """.format(record_id=_record_id_expr())
    with db_session() as conn, statement_timeout(conn, 5000):
        rows = conn.execute(query, (dataset_id, anchor_arks or ["{}"], limit, offset)).fetchall()
    unc_arks = [row["ark"] for row in rows if row.get("ark")]
    expr_unc, manif_unc = _counts_for_work_arks(dataset_id, unc_arks)
    unclustered = []
    for row in rows:
        ark = row["ark"]
        unclustered.append(
            WorkListRow(
                id=row["record_id"] or str(row["entity_id"]),
                ark=ark,
                title=row["label"],
                title_segments=_title_segments(row.get("record")),
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
            WHERE c.dataset_id = %s AND la.type_norm IN ('personne','collectivite','famille')
            ORDER BY la.sort_key NULLS LAST, c.anchor_ark
            LIMIT %s OFFSET %s
            """,
            (dataset_id, limit, offset),
        ).fetchall()

    clusters: dict[str, AgentCluster] = {}
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
            }
            anchor_title_segments = _title_segments(anchor_entity.get("record"))
            cluster = AgentCluster(
                anchor_id=anchor_id,
                anchor_ark=row.get("anchor_ark"),
                anchor_label=row.get("anchor_label") or anchor_id,
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
        }
        cluster.items.append(
            AgentClusterItem(
                ark=row["member_ark"],
                id=row.get("member_record_id")
                or (str(row.get("member_entity_id")) if row.get("member_entity_id") else None),
                label=row.get("member_label") or row.get("member_ark"),
                origin=row.get("note") or "manual",
                type_norm=row.get("member_type_norm"),
                accepted=True,
                title_segments=_title_segments(member_entity.get("record")),
                sort_key=row.get("anchor_sort_key"),
            )
        )

    anchor_arks = [row["anchor_ark"] for row in cluster_rows if row.get("anchor_ark")]
    query = """
        SELECT e.entity_id, {record_id} as record_id, e.ark, el.label, el.sort_key, el.type_norm, e.record
        FROM entity e
        JOIN entity_label el USING (dataset_id, entity_id)
        WHERE e.dataset_id=%s AND el.type_norm IN ('personne','collectivite','famille') AND (e.ark IS NULL OR e.ark <> ALL(%s))
        ORDER BY el.sort_key NULLS LAST
        LIMIT %s OFFSET %s
    """.format(record_id=_record_id_expr())
    with db_session() as conn, statement_timeout(conn, 5000):
        rows = conn.execute(query, (dataset_id, anchor_arks or ['{}'], limit, offset)).fetchall()
    unclustered = [
        AgentListRow(
            id=row["record_id"] or str(row["entity_id"]),
            ark=row["ark"],
            label=row["label"],
            type_norm=row["type_norm"],
            title_segments=_title_segments(row.get("record")),
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
    ark_labels = _collect_ark_labels(dataset_id, row.get("record") or {})
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
    """Return a WorkCluster for the given anchor (record id, ark, or entity_id)."""
    anchor = get_entity_by_key(dataset_id, anchor_key)
    if not anchor:
        return None
    if (anchor.get("type_norm") or "").lower() != "oeuvre":
        return None
    anchor_ark = anchor.get("ark")
    anchor_title = anchor.get("label")
    anchor_record = anchor.get("record") or {}
    anchor_title_segments = _title_segments(anchor_record)

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
            member_title, member_segments = _build_entity_title(dict(row))
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

    # Build expression groups: expressions that reference this work (750$3) and their clustered siblings
    expression_groups: List[ExpressionAnchorGroupView] = []
    independent_expressions: List[ExpressionItemView] = []
    if anchor_ark:
        with db_session() as conn, statement_timeout(conn, 5000):
            expr_rows = conn.execute(
                """
                SELECT e.entity_id,
                       e.ark,
                       e.record_id,
                       e.record,
                       el.label,
                       el.sort_key
                FROM rel_edge rel
                JOIN entity e ON e.dataset_id = rel.dataset_id AND e.entity_id = rel.src_entity_id
                JOIN entity_label el ON el.dataset_id = e.dataset_id AND el.entity_id = e.entity_id
                WHERE rel.dataset_id = %s
                  AND rel.predicate_iri = %s
                  AND rel.tgt_ark = %s
                  AND e.type_norm = 'expression'
                """,
                (dataset_id, WORK_LINK_PREDICATE, anchor_ark),
            ).fetchall()

        expressions_by_ark = {row["ark"]: dict(row) for row in expr_rows if row.get("ark")}
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

        clustered_by_anchor: Dict[str, List[ExpressionClusterItemView]] = {}
        for row in cluster_rows:
            anchor_ark_row = row.get("anchor_ark")
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
            member_title, _ = _build_entity_title(member_entity)
            clustered_by_anchor.setdefault(anchor_ark_row, []).append(
                ExpressionClusterItemView(
                    anchor_expression_id=anchor_expr.get("record_id")
                    or (str(anchor_expr.get("entity_id")) if anchor_expr.get("entity_id") else ""),
                    id=member_entity.get("record_id")
                    or (str(member_entity.get("entity_id")) if member_entity.get("entity_id") else None),
                    ark=member_entity.get("ark"),
                    title=member_title,
                    work_ark=anchor_ark,
                    work_id=anchor.get("record_id") or str(anchor.get("entity_id")),
                    manifestations=[],
                    accepted=True,
                    origin=row.get("note") or "manual",
                    summary=None,
                )
            )

        for expr in expr_rows:
            expr_entity = {
                "record": expr.get("record"),
                "label": expr.get("label"),
                "ark": expr.get("ark"),
                "record_id": expr.get("record_id"),
                "entity_id": expr.get("entity_id"),
            }
            expr_title, _ = _build_entity_title(expr_entity)
            expr_id = expr.get("record_id") or str(expr.get("entity_id"))
            view = ExpressionItemView(
                id=expr_id,
                ark=expr.get("ark"),
                title=expr_title,
                work_ark=anchor_ark,
                work_id=anchor.get("record_id") or str(anchor.get("entity_id")),
                manifestations=manifestations_map.get(expr.get("ark"), []),
                summary=None,
            )

            clustered = clustered_by_anchor.get(expr.get("ark") or "", [])
            if clustered:
                for c in clustered:
                    if c.ark:
                        c.manifestations = manifestations_map.get(c.ark, [])
                expression_groups.append(ExpressionAnchorGroupView(anchor=view, clustered=clustered))
            else:
                independent_expressions.append(view)

    # summaries for anchor and clustered works
    work_arks = [anchor_ark] + [item.ark for item in items if item.ark] if anchor_ark else [item.ark for item in items if item.ark]
    expr_counts, manif_counts = _counts_for_work_arks(dataset_id, [ark for ark in work_arks if ark])

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
