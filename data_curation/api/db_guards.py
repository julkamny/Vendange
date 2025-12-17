from __future__ import annotations

from typing import Dict, Iterable, Set

from data_curation.api.db_shared import RELATION_NS
from data_curation.utils.text_norm import fold_diacritics
from data_curation.models import Intermarc

CLUSTER_NOTE_VALUES = {"Clusterisation manuelle", "Clusterisation script"}
CLUSTER_NOTE_VALUES_LOWER = {val.lower() for val in CLUSTER_NOTE_VALUES}

WORK_LINK_PREDICATE = f"{RELATION_NS}750s3"


def _is_agent_type(type_raw: str) -> bool:
    normalized = fold_diacritics(type_raw or "").strip().lower()
    return normalized in {"identite publique de personne", "collectivite", "famille"}


def _is_work_type(type_raw: str) -> bool:
    normalized = fold_diacritics(type_raw or "").strip().lower()
    return normalized in {"work", "œuvre", "oeuvre"}


def _is_expression_type(type_raw: str) -> bool:
    normalized = fold_diacritics(type_raw or "").strip().lower()
    return normalized.startswith("expression")


def _extract_cluster_targets(intermarc: Intermarc) -> set[str]:
    targets: set[str] = set()
    for zone in intermarc.get_zone("90F"):
        note = next((sz.valeur for sz in zone.sousZones if sz.code == "90F$q"), None)
        if not note or note.strip().lower() not in CLUSTER_NOTE_VALUES_LOWER:
            continue
        target = next((sz.valeur for sz in zone.sousZones if sz.code == "90F$3"), None)
        if target:
            targets.add(str(target).strip())
    return targets


def _ensure_unique_agent_clusters(conn, dataset_id: str, anchor_ark: str, intermarc: Intermarc) -> None:
    _ensure_unique_clusters(conn, dataset_id, anchor_ark, _extract_cluster_targets(intermarc))


def _ensure_unique_work_clusters(conn, dataset_id: str, anchor_ark: str, intermarc: Intermarc) -> None:
    new_targets = _extract_work_cluster_targets(intermarc)
    if anchor_ark:
        previous_rows = conn.execute(
            "SELECT member_ark FROM cluster WHERE dataset_id=%s AND anchor_ark=%s",
            (dataset_id, anchor_ark),
        ).fetchall()
        previous_targets = {row["member_ark"] for row in previous_rows if row.get("member_ark")}
    else:
        previous_targets = set()

    removed_targets = previous_targets - set(new_targets)
    if removed_targets:
        remaining_works = {anchor_ark, *new_targets} - {""}
        for removed in removed_targets:
            if _work_has_expression_clusters_crossing_works(conn, dataset_id, removed, remaining_works - {removed}):
                raise ValueError(
                    f"Impossible de retirer l'oeuvre {removed} du cluster : une de ses expressions est déjà "
                    "rattachée à un cluster d'expressions d'une autre oeuvre du cluster."
                )

    _ensure_unique_clusters(conn, dataset_id, anchor_ark, new_targets)


def _ensure_unique_expression_clusters(conn, dataset_id: str, anchor_ark: str, intermarc: Intermarc) -> None:
    new_targets = _extract_expression_cluster_targets(intermarc)
    _ensure_unique_clusters(conn, dataset_id, anchor_ark, new_targets)

    # Additional guard: expressions can only be clustered when their parent works (750$3)
    # overlap, or when their parent works are clustered together.
    if not new_targets:
        return
    anchor_parents = _expression_parent_works(conn, dataset_id, anchor_ark)
    for target in new_targets:
        target_parents = _expression_parent_works(conn, dataset_id, target)
        if anchor_parents and target_parents:
            if anchor_parents.intersection(target_parents):
                continue
            if _any_parent_works_clustered(conn, dataset_id, anchor_parents, target_parents):
                continue
            raise ValueError(
                f"Impossible d'enregistrer : l'expression {target} n'a pas le même parent 750$3 "
                "ou des parents déjà en cluster que l'ancre."
            )


def _extract_work_cluster_targets(intermarc: Intermarc) -> set[str]:
    return _extract_cluster_targets(intermarc)


def _extract_expression_cluster_targets(intermarc: Intermarc) -> set[str]:
    return _extract_cluster_targets(intermarc)

def _expression_parent_works(conn, dataset_id: str, expression_ark: str) -> set[str]:
    if not expression_ark:
        return set()
    row = conn.execute(
        "SELECT entity_id FROM entity WHERE dataset_id=%s AND ark=%s AND type_norm='expression' LIMIT 1",
        (dataset_id, expression_ark),
    ).fetchone()
    if not row:
        return set()
    entity_id = row["entity_id"]
    rows = conn.execute(
        "SELECT DISTINCT tgt_ark FROM rel_edge WHERE dataset_id=%s AND src_entity_id=%s AND predicate_iri=%s",
        (dataset_id, entity_id, WORK_LINK_PREDICATE),
    ).fetchall()
    return {r["tgt_ark"] for r in rows if r.get("tgt_ark")}


def _works_clustered_together(conn, dataset_id: str, work_ark_a: str, work_ark_b: str) -> bool:
    if not work_ark_a or not work_ark_b:
        return False
    if work_ark_a == work_ark_b:
        return True
    row = conn.execute(
        """
        SELECT 1
        FROM cluster c
        WHERE c.dataset_id=%s AND (
            (c.anchor_ark=%s AND c.member_ark=%s) OR
            (c.anchor_ark=%s AND c.member_ark=%s) OR
            EXISTS (
                SELECT 1
                FROM cluster c2
                WHERE c2.dataset_id=c.dataset_id AND c2.anchor_ark=c.anchor_ark
                  AND c.member_ark=%s AND c2.member_ark=%s
            )
        )
        LIMIT 1
        """,
        (dataset_id, work_ark_a, work_ark_b, work_ark_b, work_ark_a, work_ark_a, work_ark_b),
    ).fetchone()
    return bool(row)


def _any_parent_works_clustered(conn, dataset_id: str, parents_a: Set[str], parents_b: Set[str]) -> bool:
    for a in parents_a:
        for b in parents_b:
            if _works_clustered_together(conn, dataset_id, a, b):
                return True
    return False


def _expression_arks_by_work(conn, dataset_id: str, work_arks: Set[str]) -> Dict[str, Set[str]]:
    if not work_arks:
        return {}
    rows = conn.execute(
        """
        SELECT DISTINCT e.ark AS expr_ark, rel.tgt_ark AS work_ark
        FROM rel_edge rel
        JOIN entity e ON e.dataset_id=rel.dataset_id AND e.entity_id=rel.src_entity_id
        WHERE rel.dataset_id=%s
          AND rel.predicate_iri=%s
          AND rel.tgt_ark = ANY(%s)
          AND e.type_norm='expression'
          AND e.ark IS NOT NULL
        """,
        (dataset_id, WORK_LINK_PREDICATE, list(work_arks)),
    ).fetchall()
    by_work: Dict[str, Set[str]] = {w: set() for w in work_arks}
    for row in rows:
        by_work.setdefault(row["work_ark"], set()).add(row["expr_ark"])
    return by_work


def _work_has_expression_clusters_crossing_works(
    conn, dataset_id: str, work_ark: str, other_work_arks: Set[str]
) -> bool:
    if not work_ark or not other_work_arks:
        return False
    by_work = _expression_arks_by_work(conn, dataset_id, {work_ark, *other_work_arks})
    exprs_removed = list(by_work.get(work_ark, set()))
    exprs_other: Set[str] = set()
    for other in other_work_arks:
        exprs_other.update(by_work.get(other, set()))
    if not exprs_removed or not exprs_other:
        return False
    row = conn.execute(
        """
        SELECT 1
        FROM cluster c
        WHERE c.dataset_id=%s AND (
            (c.anchor_ark = ANY(%s) AND c.member_ark = ANY(%s)) OR
            (c.anchor_ark = ANY(%s) AND c.member_ark = ANY(%s))
        )
        LIMIT 1
        """,
        (dataset_id, exprs_removed, list(exprs_other), list(exprs_other), exprs_removed),
    ).fetchone()
    return bool(row)


def _ensure_unique_clusters(conn, dataset_id: str, anchor_ark: str, targets: Iterable[str]) -> None:
    """Prevent a member ARK from belonging to multiple anchors and stop anchor reuse."""
    target_set: Set[str] = {t for t in targets if t}
    if not target_set:
        return
    if not anchor_ark:
        raise ValueError("Ancre sans ARK : impossible de clustériser.")

    # Anchor cannot already be member of another cluster
    row = conn.execute(
        "SELECT anchor_ark FROM cluster WHERE dataset_id=%s AND member_ark=%s AND anchor_ark<>%s LIMIT 1",
        (dataset_id, anchor_ark, anchor_ark),
    ).fetchone()
    if row:
        raise ValueError(f"Impossible : l'ancre {anchor_ark} est déjà membre du cluster de {row['anchor_ark']}.")

    # Targets cannot belong to another anchor
    rows = conn.execute(
        "SELECT anchor_ark, member_ark FROM cluster WHERE dataset_id=%s AND member_ark = ANY(%s)",
        (dataset_id, list(target_set)),
    ).fetchall()
    for row in rows:
        if row["anchor_ark"] and row["anchor_ark"] != anchor_ark:
            raise ValueError(
                f"Impossible : la cible {row['member_ark']} est déjà rattachée au cluster de {row['anchor_ark']}."
            )

    # Targets cannot already be anchors themselves (avoid anchor-in-anchor)
    anchor_rows = conn.execute(
        "SELECT DISTINCT anchor_ark FROM cluster WHERE dataset_id=%s AND anchor_ark = ANY(%s)",
        (dataset_id, list(target_set)),
    ).fetchall()
    for row in anchor_rows:
        if row["anchor_ark"] and row["anchor_ark"] != anchor_ark:
            raise ValueError(
                f"Impossible : la cible {row['anchor_ark']} est déjà ancre d'un cluster."
            )


def _is_work_anchor(conn, dataset_id: str, target_ark: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM cluster WHERE dataset_id=%s AND anchor_ark=%s LIMIT 1",
        (dataset_id, target_ark),
    ).fetchone()
    return bool(row)


def _is_expression_anchor(conn, dataset_id: str, target_ark: str) -> bool:
    return _is_work_anchor(conn, dataset_id, target_ark)
