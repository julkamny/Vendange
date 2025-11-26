from __future__ import annotations

from typing import List, Optional, Sequence, Set, Tuple

from pyoxigraph import Literal, Store

from .db_ingest import _build_record_from_payload, _build_record_quads
from .db_query import _load_record_from_store, _record_subjects
from .db_shared import (
    FIELD_CODE_PROP,
    HAS_FIELD,
    HAS_SUBFIELD,
    PROP_ARK,
    PROP_TYPE_RAW,
    SUBFIELD_CODE_PROP,
    SUBFIELD_VALUE_PROP,
    get_controlled_ark,
    literal_first_value,
)
from .db_store import _STORE_LOCK, clear_record_graph, get_store_locked, load_ark_index
from . import datasets
from ..models import Entity, Intermarc, SousZone, Zone


def _clone_zone(zone: Zone) -> Zone:
    return Zone(
        code=zone.code,
        sousZones=[
            SousZone(code=sub.code, valeur=sub.valeur, affected_by_curation=sub.affected_by_curation)
            for sub in zone.sousZones
        ],
        affected_by_curation=zone.affected_by_curation,
    )


def _clone_intermarc(intermarc: Intermarc, *, skip: Optional[Set[int]] = None) -> Intermarc:
    skip = skip or set()
    return Intermarc(zones=[_clone_zone(zone) for idx, zone in enumerate(intermarc.zones) if idx not in skip])


def _has_curation_flag(zone: Zone) -> bool:
    if zone.affected_by_curation:
        return True
    return any(sub.affected_by_curation for sub in zone.sousZones)


def _extract_cluster_target(zone: Zone) -> Optional[str]:
    target = next((sub.valeur for sub in zone.sousZones if sub.code in {"90F$3", "90F$a"}), None)
    return target or None


def _manual_cluster_zone(target: str, extras: Sequence[SousZone] = ()) -> Zone:
    extra_subs = [SousZone(code=sub.code, valeur=sub.valeur, affected_by_curation="manual") for sub in extras]
    return Zone(
        code="90F",
        affected_by_curation="manual",
        sousZones=[
            SousZone(code="90F$3", valeur=target, affected_by_curation="manual"),
            SousZone(code="90F$q", valeur="Clusterisation manuelle", affected_by_curation="manual"),
            *extra_subs,
        ],
    )


def _manual_adaptation_zone(target: str, qualifier_ark: str) -> Zone:
    return Zone(
        code="552",
        affected_by_curation="manual",
        sousZones=[
            SousZone(code="552$3", valeur=target, affected_by_curation="manual"),
            SousZone(code="552$q", valeur=qualifier_ark, affected_by_curation="manual"),
        ],
    )


def _update_adaptation_backlinks(
    entity: Entity, *, previous_anchor: str, new_anchor: str, qualifier_ark: Optional[str]
) -> Entity:
    if not qualifier_ark:
        return entity

    updated = False
    zones: List[Zone] = []
    for zone in entity.intermarc.zones:
        if zone.code != "552":
            zones.append(_clone_zone(zone))
            continue

        q_match = qualifier_ark in zone.subfield_values("552$q")
        targets = [sub for sub in zone.sousZones if sub.code == "552$3" and sub.valeur == previous_anchor]
        if not q_match or not targets:
            zones.append(_clone_zone(zone))
            continue

        clone = _clone_zone(zone)
        for sub in clone.sousZones:
            if sub.code == "552$3" and sub.valeur == previous_anchor:
                sub.valeur = new_anchor
                if not sub.affected_by_curation:
                    sub.affected_by_curation = "manual"
                clone.affected_by_curation = clone.affected_by_curation or "manual"
                updated = True
        zones.append(clone)

    if not updated:
        return entity

    return entity.clone_with_new_intermarc(Intermarc(zones=zones))


def _rewrite_cluster_fields(
    anchor: Entity,
    target: Entity,
    *,
    link_has_adaptation_ark: Optional[str],
) -> Tuple[Entity, Entity, List[str]]:
    anchor_ark = anchor.ark() or ""
    target_ark = target.ark() or ""

    cluster_indices_to_remove: Set[int] = set()
    cluster_zones_to_transfer: List[Zone] = []
    adaptation_indices_to_remove: Set[int] = set()
    adaptation_targets: List[str] = []

    for idx, zone in enumerate(anchor.intermarc.zones):
        if zone.code == "90F":
            note = next((sub.valeur for sub in zone.sousZones if sub.code == "90F$q"), None)
            if not note or note not in {"Clusterisation manuelle", "Clusterisation script"}:
                continue
            if not _has_curation_flag(zone):
                continue
            cluster_indices_to_remove.add(idx)
            cluster_zones_to_transfer.append(zone)
            continue
        if zone.code == "552" and _has_curation_flag(zone) and link_has_adaptation_ark in zone.subfield_values("552$q"):
            adaptation_indices_to_remove.add(idx)
            target_val = next((sub.valeur for sub in zone.sousZones if sub.code == "552$3"), None)
            if target_val and target_val != target_ark:
                adaptation_targets.append(target_val)

    cleaned_anchor = _clone_intermarc(anchor.intermarc, skip=cluster_indices_to_remove | adaptation_indices_to_remove)

    existing_targets = {
        t for z in target.intermarc.get_zone("90F") if z.sousZones for t in [_extract_cluster_target(z)] if t
    }

    new_target_zones = [_clone_zone(z) for z in target.intermarc.zones]
    for zone in cluster_zones_to_transfer:
        target_value = _extract_cluster_target(zone)
        if not target_value:
            continue
        new_target_value = anchor_ark if target_value == target_ark else target_value
        if new_target_value in existing_targets:
            continue

        other_subs = [
            sub
            for sub in zone.sousZones
            if sub.code not in {"90F$q", "90F$a", "90F$3"}
        ]
        new_target_zones.append(_manual_cluster_zone(new_target_value, other_subs))
        existing_targets.add(new_target_value)

    if link_has_adaptation_ark and adaptation_targets:
        for adaptation_target in adaptation_targets:
            new_target_zones.append(_manual_adaptation_zone(adaptation_target, link_has_adaptation_ark))

    updated_anchor = anchor.clone_with_new_intermarc(cleaned_anchor)
    updated_target = target.clone_with_new_intermarc(Intermarc(zones=new_target_zones))

    return updated_anchor, updated_target, adaptation_targets


def swap_cluster_anchor(dataset_id: str, *, anchor_id: str, target_id: str) -> List[dict[str, str]]:
    with _STORE_LOCK:
        store = get_store_locked(dataset_id)
        subjects = _record_subjects(store)
        if anchor_id not in subjects:
            raise ValueError(f"Record not found: {anchor_id}")
        if target_id not in subjects:
            raise ValueError(f"Record not found: {target_id}")

        anchor_entity = _load_record_from_store(store, *subjects[anchor_id])
        target_entity = _load_record_from_store(store, *subjects[target_id])

        kind_anchor = anchor_entity.type_entite.strip().lower()
        kind_target = target_entity.type_entite.strip().lower()
        if not (kind_anchor in {"œuvre","oeuvre","work","expression"}):
            raise ValueError("Le changement d'ancre n'est possible que pour les œuvres ou les expressions.")
        if kind_anchor != kind_target:
            raise ValueError("Ancre et cible doivent être du même type.")

        anchor_ark = anchor_entity.ark()
        target_ark = target_entity.ark()
        if not anchor_ark or not target_ark:
            raise ValueError("Ancre et cible doivent avoir un ARK.")

        ark_index = load_ark_index(store)
        link_has_adaptation_ark = get_controlled_ark(store, "A pour adaptation")
        link_is_adaptation_of_ark = get_controlled_ark(store, "Est une adaptation de")

        from .db_guards import (
            _extract_work_cluster_targets,
            _extract_expression_cluster_targets,
            _is_work_anchor,
            _is_expression_anchor,
        )

        if kind_anchor in {"œuvre","oeuvre","work"}:
            cluster_targets = _extract_work_cluster_targets(anchor_entity.intermarc)
            if target_ark not in cluster_targets:
                raise ValueError("La cible n'appartient pas au cluster de l'ancre.")
            if _is_work_anchor(store, ark_index, target_ark):
                raise ValueError("Impossible : la cible est déjà ancre d'un cluster.")
        else:
            cluster_targets = _extract_expression_cluster_targets(anchor_entity.intermarc)
            if target_ark not in cluster_targets:
                raise ValueError("La cible n'appartient pas au cluster de l'ancre.")
            if _is_expression_anchor(store, ark_index, target_ark):
                raise ValueError("Impossible : la cible est déjà ancre d'un cluster.")

        updated_anchor, updated_target, adaptation_targets = _rewrite_cluster_fields(
            anchor_entity,
            target_entity,
            link_has_adaptation_ark=link_has_adaptation_ark if kind_anchor in {"œuvre","oeuvre","work"} else None,
        )

        updated_backlinks: List[Entity] = []
        if adaptation_targets and link_is_adaptation_of_ark:
            for adaptation_ark in adaptation_targets:
                adaptation_id = ark_index.get(adaptation_ark)
                if not adaptation_id or adaptation_id not in subjects:
                    raise ValueError(f"Adaptation introuvable : {adaptation_ark}")
                adaptation_entity = _load_record_from_store(store, *subjects[adaptation_id])
                if adaptation_entity.id_entitelrm == target_entity.id_entitelrm:
                    # Avoid rewriting backlinks on the new anchor itself (would create self links)
                    continue
                patched = _update_adaptation_backlinks(
                    adaptation_entity,
                    previous_anchor=anchor_ark,
                    new_anchor=target_ark,
                    qualifier_ark=link_is_adaptation_of_ark,
                )
                if patched.intermarc.to_json_string() != adaptation_entity.intermarc.to_json_string():
                    updated_backlinks.append(patched)

        # Persist changes: remove old graphs, then insert updated quads
        for rid in {anchor_id, target_id, *[ent.id_entitelrm for ent in updated_backlinks]}:
            clear_record_graph(store, rid)

        ark_index.setdefault(anchor_ark, anchor_id)
        ark_index.setdefault(target_ark, target_id)

        quads = []
        for entity in [updated_anchor, updated_target, *updated_backlinks]:
            record = _build_record_from_payload(entity.id_entitelrm, entity.type_entite, entity.intermarc.to_json_string())
            quads.extend(_build_record_quads(record, ark_index))

        if quads:
            store.extend(quads)
            store.flush()

        datasets.touch_dataset(dataset_id)

        updated_entities = [updated_anchor, updated_target, *updated_backlinks]
        return [
            {
                "id": ent.id_entitelrm,
                "type": ent.type_entite,
                "ark": ent.ark(),
                "intermarc": ent.intermarc.to_json_string(),
            }
            for ent in updated_entities
        ]
