from __future__ import annotations

from typing import List, Optional, Set

from .db_ingest import _build_record_from_payload, _build_record_quads
from .db_query import _load_record_from_store, _record_subjects
from .db_store import _STORE_LOCK, clear_record_graph, get_store_locked, load_ark_index
from . import datasets
from .anchor_swap import _clone_intermarc, _clone_zone, _manual_cluster_zone
from .db_guards import (
    _ensure_unique_expression_clusters,
    _ensure_unique_work_clusters,
    _ensure_unique_manual_agent_clusters,
    _is_agent_type,
)
from ..models import Entity, Intermarc

CLUSTER_NOTES: Set[str] = {"Clusterisation manuelle", "Clusterisation script"}


def _remove_cluster_target(intermarc: Intermarc, target_ark: str) -> Intermarc:
    new_zones = []
    removed = False
    for zone in intermarc.zones:
        if zone.code != "90F":
            new_zones.append(_clone_zone(zone))
            continue
        note = next((sub.valeur for sub in zone.sousZones if sub.code == "90F$q"), None)
        target_val = next((sub.valeur for sub in zone.sousZones if sub.code == "90F$3"), None)
        if note in CLUSTER_NOTES and target_val == target_ark:
            removed = True
            continue
        new_zones.append(_clone_zone(zone))
    if not removed:
        return _clone_intermarc(intermarc)
    return Intermarc(zones=new_zones)


def _add_cluster_target(intermarc: Intermarc, target_ark: str) -> Intermarc:
    # Avoid duplicates
    for zone in intermarc.get_zone("90F"):
        note = next((sub.valeur for sub in zone.sousZones if sub.code == "90F$q"), None)
        target_val = next((sub.valeur for sub in zone.sousZones if sub.code == "90F$3"), None)
        if note in CLUSTER_NOTES and target_val == target_ark:
            return _clone_intermarc(intermarc)
    zones = [_clone_zone(z) for z in intermarc.zones]
    zones.append(_manual_cluster_zone(target_ark))
    return Intermarc(zones=zones)


def update_manual_cluster(
    dataset_id: str,
    *,
    anchor_id: str,
    target_id: Optional[str] = None,
    target_ark: Optional[str] = None,
    accepted: bool = True,
) -> List[dict[str, str]]:
    """Add or remove a clustered work/expression from an anchor.

    The anchor must be a work, expression, or agent. Addition requires ``target_id``
    so we can validate types and retrieve the ARK; removal may be driven by
    ``target_ark`` directly (as used by the checkbox UI).
    """

    with _STORE_LOCK:
        store = get_store_locked(dataset_id)
        subjects = _record_subjects(store)
        if anchor_id not in subjects:
            raise ValueError(f"Record not found: {anchor_id}")

        anchor_entity: Entity = _load_record_from_store(store, *subjects[anchor_id])
        anchor_norm = anchor_entity.type_entite.strip().lower()
        is_work = anchor_norm in {"work", "oeuvre", "œuvre"}
        is_expression = anchor_norm.startswith("expression")
        is_agent = _is_agent_type(anchor_entity.type_entite)
        if not (is_work or is_expression or is_agent):
            raise ValueError(
                "Clusterisation manuelle disponible uniquement pour les œuvres, les expressions ou les agents."
            )

        anchor_ark = anchor_entity.ark()
        if not anchor_ark:
            raise ValueError("Ancre sans ARK : impossible de clustériser.")

        ark_index = load_ark_index(store)
        target_entity: Optional[Entity] = None
        if accepted:
            if not target_id:
                raise ValueError("Target id manquant pour ajouter au cluster.")
            if target_id not in subjects:
                raise ValueError(f"Record not found: {target_id}")
            target_entity = _load_record_from_store(store, *subjects[target_id])
            target_norm = target_entity.type_entite.strip().lower()
            if is_work and target_norm not in {"work", "oeuvre", "œuvre"}:
                raise ValueError("Cible incompatible : seules les œuvres peuvent être rattachées à une œuvre.")
            if is_expression and not target_norm.startswith("expression"):
                raise ValueError(
                    "Cible incompatible : seules les expressions peuvent être rattachées à une expression."
                )
            if is_agent and not _is_agent_type(target_entity.type_entite):
                raise ValueError("Cible incompatible : seules des entités de type agent peuvent être rattachées.")
            target_ark = target_entity.ark()
            if not target_ark:
                raise ValueError("La cible doit avoir un ARK.")
            if target_ark == anchor_ark:
                raise ValueError("Impossible de clustériser une entité avec elle-même.")
        else:
            if not target_ark and target_id:
                if target_id not in subjects:
                    raise ValueError(f"Record not found: {target_id}")
                target_entity = _load_record_from_store(store, *subjects[target_id])
                target_ark = target_entity.ark()
            if not target_ark:
                raise ValueError("ARK cible manquant pour retirer du cluster.")
            if not target_entity:
                target_id_from_ark = ark_index.get(target_ark)
                if target_id_from_ark and target_id_from_ark in subjects:
                    target_entity = _load_record_from_store(store, *subjects[target_id_from_ark])

        next_intermarc = (
            _add_cluster_target(anchor_entity.intermarc, target_ark)
            if accepted
            else _remove_cluster_target(anchor_entity.intermarc, target_ark)
        )

        if next_intermarc.to_json_string() == anchor_entity.intermarc.to_json_string():
            return []

        if is_work:
            _ensure_unique_work_clusters(store, anchor_id, next_intermarc)
        elif is_expression:
            _ensure_unique_expression_clusters(store, anchor_id, next_intermarc)
        else:
            _ensure_unique_manual_agent_clusters(store, anchor_id, next_intermarc)

        clear_record_graph(store, anchor_id)

        ark_index = load_ark_index(store)
        if anchor_ark:
            ark_index.setdefault(anchor_ark, anchor_id)
        if target_entity:
            target_ark_val = target_entity.ark()
            if target_ark_val:
                ark_index.setdefault(target_ark_val, target_entity.id_entitelrm)

        record = _build_record_from_payload(anchor_entity.id_entitelrm, anchor_entity.type_entite, next_intermarc.to_json_string())
        quads = list(_build_record_quads(record, ark_index))
        if quads:
            store.extend(quads)
            store.flush()

        datasets.touch_dataset(dataset_id)

        updated_entities = [
            {
                "id": anchor_entity.id_entitelrm,
                "type": anchor_entity.type_entite,
                "ark": anchor_ark,
                "intermarc": next_intermarc.to_json_string(),
            }
        ]
        if target_entity:
            updated_entities.append(
                {
                    "id": target_entity.id_entitelrm,
                    "type": target_entity.type_entite,
                    "ark": target_entity.ark(),
                    "intermarc": target_entity.intermarc.to_json_string(),
                }
            )

        return updated_entities
