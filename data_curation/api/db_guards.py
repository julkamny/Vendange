from __future__ import annotations

from typing import Iterable, Set

from data_curation.utils.text_norm import fold_diacritics
from data_curation.models import Intermarc

CLUSTER_NOTE_VALUES = {"Clusterisation manuelle", "Clusterisation script"}
CLUSTER_NOTE_VALUES_LOWER = {val.lower() for val in CLUSTER_NOTE_VALUES}


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
    _ensure_unique_clusters(conn, dataset_id, anchor_ark, _extract_cluster_targets(intermarc))


def _ensure_unique_expression_clusters(conn, dataset_id: str, anchor_ark: str, intermarc: Intermarc) -> None:
    _ensure_unique_clusters(conn, dataset_id, anchor_ark, _extract_cluster_targets(intermarc))


def _extract_work_cluster_targets(intermarc: Intermarc) -> set[str]:
    return _extract_cluster_targets(intermarc)


def _extract_expression_cluster_targets(intermarc: Intermarc) -> set[str]:
    return _extract_cluster_targets(intermarc)


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
