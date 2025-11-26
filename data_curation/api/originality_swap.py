from __future__ import annotations

from typing import Dict, List, Optional, Set

from .anchor_swap import _clone_intermarc, _clone_zone, _manual_adaptation_zone
from .db_ingest import _build_record_from_payload, _build_record_quads
from .db_query import _load_record_from_store, _record_subjects
from .db_shared import get_controlled_ark
from .db_store import _STORE_LOCK, clear_record_graph, get_store_locked, load_ark_index
from . import datasets
from ..models import Entity, Intermarc, SousZone, Zone


def _has_manual_or_created_flag(zone: Zone) -> bool:
    flags = [zone.affected_by_curation] if zone.affected_by_curation else []
    for sub in zone.sousZones:
        if sub.affected_by_curation:
            flags.append(sub.affected_by_curation)
    return any(str(flag).lower() in {"manual", "created"} for flag in flags)


def _collect_adaptation_targets(zone: Zone, *, qualifier_ark: str) -> Optional[str]:
    if zone.code != "552":
        return None
    if qualifier_ark not in zone.subfield_values("552$q"):
        return None
    if not _has_manual_or_created_flag(zone):
        return None
    return next((sub.valeur for sub in zone.sousZones if sub.code == "552$3"), None)


def _retarget_adaptation_backlinks(
    entity: Entity, *, qualifier_ark: str, previous_original: str, new_original: str
) -> Entity:
    has_link_to_new = False
    updated = False
    zones: List[Zone] = []

    for zone in entity.intermarc.zones:
        if zone.code != "552":
            zones.append(_clone_zone(zone))
            continue

        q_matches = qualifier_ark in zone.subfield_values("552$q")
        sub3 = next((s for s in zone.sousZones if s.code == "552$3"), None)
        if not q_matches or not sub3:
            zones.append(_clone_zone(zone))
            continue

        clone = _clone_zone(zone)
        if sub3.valeur == previous_original:
            for sub in clone.sousZones:
                if sub.code == "552$3" and sub.valeur == previous_original:
                    sub.valeur = new_original
                if sub.code in {"552$3", "552$q"}:
                    sub.affected_by_curation = "manual"
            clone.affected_by_curation = "manual"
            updated = True
            has_link_to_new = True
            zones.append(clone)
            continue

        if sub3.valeur == new_original:
            for sub in clone.sousZones:
                if sub.code in {"552$3", "552$q"}:
                    sub.affected_by_curation = "manual"
            clone.affected_by_curation = "manual"
            has_link_to_new = True
            zones.append(clone)
            continue

        zones.append(clone)

    if not has_link_to_new:
        zones.append(
            Zone(
                code="552",
                affected_by_curation="manual",
                sousZones=[
                    SousZone(code="552$3", valeur=new_original, affected_by_curation="manual"),
                    SousZone(code="552$q", valeur=qualifier_ark, affected_by_curation="manual"),
                ],
            )
        )
        updated = True

    if not updated:
        return entity

    return entity.clone_with_new_intermarc(Intermarc(zones=zones))


def swap_work_originality(dataset_id: str, *, original_id: str, target_id: str) -> List[dict[str, str]]:
    """Transfer curated adaptation links from the current original work to another work.

    Steps:
    - Gather curated 552$q="A pour adaptation" targets from the original work.
    - Point corresponding 552$q="Est une adaptation de" backlinks on those targets to the new original.
    - Remove curated 552 zones from the previous original and add manual ones to the new original.
    """

    with _STORE_LOCK:
        store = get_store_locked(dataset_id)
        subjects = _record_subjects(store)
        if original_id not in subjects:
            raise ValueError(f"Record not found: {original_id}")
        if target_id not in subjects:
            raise ValueError(f"Record not found: {target_id}")

        original_entity = _load_record_from_store(store, *subjects[original_id])
        target_entity = _load_record_from_store(store, *subjects[target_id])

        norm_orig = original_entity.type_entite.strip().lower()
        norm_target = target_entity.type_entite.strip().lower()
        if norm_orig not in {"oeuvre", "œuvre", "work"} or norm_target not in {"oeuvre", "œuvre", "work"}:
            raise ValueError("La permutation d'originalité ne concerne que les œuvres.")
        if original_entity.id_entitelrm == target_entity.id_entitelrm:
            raise ValueError("Impossible de permuter l'originalité avec la même œuvre.")

        original_ark = original_entity.ark()
        target_ark = target_entity.ark()
        if not original_ark or not target_ark:
            raise ValueError("Les œuvres doivent avoir un ARK.")

        has_adaptation_ark = get_controlled_ark(store, "A pour adaptation")
        is_adaptation_of_ark = get_controlled_ark(store, "Est une adaptation de")
        if not has_adaptation_ark or not is_adaptation_of_ark:
            raise ValueError("Valeurs contrôlées manquantes pour les liens d'adaptation.")

        # Collect curated adaptation targets to move away from the original
        removal_indices: Set[int] = set()
        adaptation_targets: List[str] = []
        for idx, zone in enumerate(original_entity.intermarc.zones):
            target = _collect_adaptation_targets(zone, qualifier_ark=has_adaptation_ark)
            if not target:
                continue
            removal_indices.add(idx)
            if target != target_ark:  # avoid self-linking the new original
                adaptation_targets.append(target)

        if not adaptation_targets:
            raise ValueError("Aucune adaptation à transférer depuis cette œuvre.")

        ark_index = load_ark_index(store)

        cleaned_original = _clone_intermarc(original_entity.intermarc, skip=removal_indices)
        updated_original = original_entity.clone_with_new_intermarc(cleaned_original)

        # Add manual adaptation links to the new original, skipping duplicates
        existing_targets: Set[str] = set()
        for zone in target_entity.intermarc.zones:
            if zone.code != "552" or has_adaptation_ark not in zone.subfield_values("552$q"):
                continue
            existing = next((s.valeur for s in zone.sousZones if s.code == "552$3"), None)
            if existing:
                existing_targets.add(existing)

        new_original_zones = [_clone_zone(z) for z in target_entity.intermarc.zones]
        for target in adaptation_targets:
            if target in existing_targets:
                continue
            new_original_zones.append(_manual_adaptation_zone(target, has_adaptation_ark))
            existing_targets.add(target)

        updated_target_original = target_entity.clone_with_new_intermarc(Intermarc(zones=new_original_zones))

        updated_entities: Dict[str, Entity] = {
            updated_original.id_entitelrm: updated_original,
            updated_target_original.id_entitelrm: updated_target_original,
        }

        # Rewrite backlinks on every adaptation target
        for adaptation_ark in adaptation_targets:
            adaptation_id = ark_index.get(adaptation_ark)
            if not adaptation_id or adaptation_id not in subjects:
                raise ValueError(f"Adaptation introuvable : {adaptation_ark}")
            adaptation_entity = _load_record_from_store(store, *subjects[adaptation_id])
            patched = _retarget_adaptation_backlinks(
                adaptation_entity,
                qualifier_ark=is_adaptation_of_ark,
                previous_original=original_ark,
                new_original=target_ark,
            )
            if patched.intermarc.to_json_string() != adaptation_entity.intermarc.to_json_string():
                updated_entities[patched.id_entitelrm] = patched

        for rid in updated_entities:
            clear_record_graph(store, rid)

        quads = []
        for ent in updated_entities.values():
            record = _build_record_from_payload(ent.id_entitelrm, ent.type_entite, ent.intermarc.to_json_string())
            quads.extend(_build_record_quads(record, ark_index))

        if quads:
            store.extend(quads)
            store.flush()

        datasets.touch_dataset(dataset_id)

        return [
            {
                "id": ent.id_entitelrm,
                "type": ent.type_entite,
                "ark": ent.ark(),
                "intermarc": ent.intermarc.to_json_string(),
            }
            for ent in updated_entities.values()
        ]
