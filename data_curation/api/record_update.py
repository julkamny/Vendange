from __future__ import annotations

from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from . import datasets
from .anchor_swap import _manual_adaptation_zone
from .db_guards import (
    _ensure_unique_expression_clusters,
    _ensure_unique_manual_agent_clusters,
    _ensure_unique_work_clusters,
    _extract_expression_cluster_targets,
    _extract_work_cluster_targets,
    _is_agent_type,
    _is_expression_type,
    _is_work_type,
)
from .db_ingest import _build_record_from_payload, _build_record_quads
from .db_query import _load_record_from_store, _record_subjects
from .db_shared import get_controlled_ark
from .db_store import _STORE_LOCK, clear_record_graph, get_store_locked, load_ark_index
from .manual_cluster import _add_cluster_target, _remove_cluster_target
from .manifestation_uproot import _rewrite_manifestation_links
from ..models import Entity, Intermarc, SousZone, Zone


def _zone_signature(zone: Zone) -> Tuple[str, Optional[str], Tuple[Tuple[str, str], ...]]:
    """Signature ignoring curation flags."""
    return (
        zone.code,
        zone.field_compact_value,
        tuple((sub.code, sub.valeur) for sub in zone.sousZones),
    )


def _clone_zone_preserve(zone: Zone) -> Zone:
    return Zone(
        code=zone.code,
        field_compact_value=zone.field_compact_value,
        affected_by_curation=zone.affected_by_curation,
        sousZones=[
            SousZone(code=sub.code, valeur=sub.valeur, affected_by_curation=sub.affected_by_curation)
            for sub in zone.sousZones
        ],
    )


def _merge_zone(new_zone: Zone, previous: Optional[Zone]) -> Zone:
    """Keep previous curation flags when unchanged, mark manual when altered."""
    if previous and _zone_signature(previous) == _zone_signature(new_zone):
        return _clone_zone_preserve(previous)

    prior_subs = list(previous.sousZones) if previous else []
    merged_subs: List[SousZone] = []
    for sub in new_zone.sousZones:
        matched = next((s for s in prior_subs if s.code == sub.code and s.valeur == sub.valeur), None)
        merged_subs.append(
            SousZone(
                code=sub.code,
                valeur=sub.valeur,
                affected_by_curation=(matched.affected_by_curation if matched and matched.affected_by_curation else "manual"),
            )
        )

    zone_flag = "manual"
    if previous and previous.affected_by_curation:
        zone_flag = previous.affected_by_curation

    return Zone(
        code=new_zone.code,
        field_compact_value=new_zone.field_compact_value,
        sousZones=merged_subs,
        affected_by_curation=zone_flag,
    )


def _build_adaptation_lookup(
    intermarc: Intermarc, qualifiers: Sequence[str]
) -> Dict[Tuple[str, str], Zone]:
    lookup: Dict[Tuple[str, str], Zone] = {}
    for zone in intermarc.get_zone("552"):
        qual = next((s.valeur for s in zone.sousZones if s.code == "552$q" and s.valeur in qualifiers), None)
        target = next((s.valeur for s in zone.sousZones if s.code == "552$3"), None)
        if qual and target:
            lookup[(qual, target)] = zone
    return lookup


def _remove_adaptation_link(entity: Entity, qualifier: str, target_ark: str) -> Optional[Entity]:
    changed = False
    next_zones: List[Zone] = []
    for zone in entity.intermarc.zones:
        if zone.code != "552":
            next_zones.append(_clone_zone_preserve(zone))
            continue
        q_match = qualifier in zone.subfield_values("552$q")
        target_match = target_ark in zone.subfield_values("552$3")
        if q_match and target_match:
            changed = True
            continue
        next_zones.append(_clone_zone_preserve(zone))
    if not changed:
        return None
    return entity.clone_with_new_intermarc(Intermarc(zones=next_zones))


def _ensure_adaptation_link(entity: Entity, qualifier: str, target_ark: str) -> Optional[Entity]:
    if not qualifier:
        return None
    for zone in entity.intermarc.get_zone("552"):
        if qualifier not in zone.subfield_values("552$q"):
            continue
        if target_ark in zone.subfield_values("552$3"):
            return None
    next_zones = [_clone_zone_preserve(z) for z in entity.intermarc.zones]
    next_zones.append(_manual_adaptation_zone(target_ark, qualifier))
    return entity.clone_with_new_intermarc(Intermarc(zones=next_zones))


def _apply_cluster_deltas(
    previous: Intermarc,
    *,
    added: Iterable[str],
    removed: Iterable[str],
    desired_notes: Dict[str, str],
) -> List[Zone]:
    working = previous
    for target in removed:
        working = _remove_cluster_target(working, target)
    for target in added:
        working = _add_cluster_target(working, target)

    # Align notes with the payload
    adjusted: List[Zone] = []
    for zone in working.get_zone("90F"):
        clone = _clone_zone_preserve(zone)
        target_val = next((s.valeur for s in clone.sousZones if s.code == "90F$3"), None)
        if target_val and target_val in desired_notes:
            for sub in clone.sousZones:
                if sub.code == "90F$q":
                    sub.valeur = desired_notes[target_val]
                sub.affected_by_curation = sub.affected_by_curation or "manual"
            clone.affected_by_curation = clone.affected_by_curation or "manual"
        adjusted.append(clone)
    return adjusted


def _apply_740_additions(
    manifestation: Entity,
    new_targets: Iterable[Tuple[str, bool]],
    *,
    partial_label: str,
) -> List[Zone]:
    next_im = manifestation.intermarc
    for target, wants_partial in new_targets:
        partial_val = partial_label if wants_partial else None
        next_im = _rewrite_manifestation_links(next_im, detach=[], target_ark=target, partial_ark=partial_val)
    return next_im.get_zone("740")


def _merge_non_special_zones(
    new_im: Intermarc, previous: Intermarc, special_codes: Sequence[str]
) -> List[Zone]:
    prev_pool: Dict[Tuple[str, Optional[str], Tuple[Tuple[str, str], ...]], List[Zone]] = {}
    for zone in previous.zones:
        if zone.code in special_codes:
            continue
        prev_pool.setdefault(_zone_signature(zone), []).append(zone)

    merged: List[Zone] = []
    for zone in new_im.zones:
        if zone.code in special_codes:
            continue
        sig = _zone_signature(zone)
        candidates = prev_pool.get(sig, [])
        prior = candidates.pop(0) if candidates else None
        merged.append(_merge_zone(zone, prior))
    return merged


def update_record(dataset_id: str, record_id: str, *, type_raw: str, intermarc_json: str) -> List[dict[str, str]]:
    new_intermarc = Intermarc.from_json_string(intermarc_json)

    with _STORE_LOCK:
        store = get_store_locked(dataset_id)
        subjects = _record_subjects(store)
        if record_id not in subjects:
            raise ValueError(f"Record not found: {record_id}")

        previous_entity = _load_record_from_store(store, *subjects[record_id])
        if not type_raw.strip():
            type_raw = previous_entity.type_entite
        prev_im = previous_entity.intermarc

        # Guard: 750 cannot be added or removed
        prev_750 = set(prev_im.get_subfield_values("750", "3"))
        next_750 = set(new_intermarc.get_subfield_values("750", "3"))
        if prev_750 != next_750:
            raise ValueError(
                "Impossible : les zones 750 ne peuvent pas être ajoutées ou supprimées depuis cet écran."
            )

        # Guard: forbid 740 removals
        prev_740 = set(prev_im.get_subfield_values("740", "3"))
        next_740 = set(new_intermarc.get_subfield_values("740", "3"))
        removed_740 = prev_740 - next_740
        if removed_740:
            raise ValueError(
                "Suppression de 740 refusée : utilisez le menu contextuel « déraciner la manifestation » pour détacher une expression."
            )

        added_740 = next_740 - prev_740
        partial_flags: Dict[str, bool] = {}
        if added_740:
            norm_type = type_raw.strip().lower()
            if not norm_type.startswith("manifestation"):
                raise ValueError("Zones 740 réservées aux manifestations.")
            for zone in new_intermarc.get_zone("740"):
                target = next((s.valeur for s in zone.sousZones if s.code == "740$3"), None)
                if target and target in added_740:
                    has_partial = any(s.code == "740$q" and s.valeur for s in zone.sousZones)
                    partial_flags[target] = has_partial

        # Cluster deltas
        prev_clusters = (
            _extract_work_cluster_targets(prev_im)
            if _is_work_type(type_raw)
            else _extract_expression_cluster_targets(prev_im)
        )
        next_clusters = (
            _extract_work_cluster_targets(new_intermarc)
            if _is_work_type(type_raw)
            else _extract_expression_cluster_targets(new_intermarc)
        )
        removed_clusters = prev_clusters - next_clusters
        added_clusters = next_clusters - prev_clusters
        desired_notes = {}
        for zone in new_intermarc.get_zone("90F"):
            note = next((s.valeur for s in zone.sousZones if s.code == "90F$q"), None)
            target = next((s.valeur for s in zone.sousZones if s.code == "90F$3"), None)
            if note and target:
                desired_notes[target] = note

        # Adaptation links
        has_adaptation = get_controlled_ark(store, "A pour adaptation")
        is_adaptation_of = get_controlled_ark(store, "Est une adaptation de")
        qualifiers = {q for q in (has_adaptation, is_adaptation_of) if q}
        prev_adapt_lookup = _build_adaptation_lookup(prev_im, qualifiers)
        next_adapt_lookup = _build_adaptation_lookup(new_intermarc, qualifiers)
        prev_adapt = set(prev_adapt_lookup.keys())
        next_adapt = set(next_adapt_lookup.keys())
        removed_adapt = prev_adapt - next_adapt
        added_adapt = next_adapt - prev_adapt

        # Build main record intermarc
        special_codes = ("90F", "740", "750", "552")
        merged_zones: List[Zone] = _merge_non_special_zones(new_intermarc, prev_im, special_codes)

        # 90F zones
        cluster_base = Intermarc(zones=[_clone_zone_preserve(z) for z in prev_im.get_zone("90F")])
        cluster_zones = _apply_cluster_deltas(
            cluster_base, added=added_clusters, removed=removed_clusters, desired_notes=desired_notes
        )
        merged_zones.extend(cluster_zones)

        # 740 zones (attach without detach)
        if added_740:
            partial_label = get_controlled_ark(store, "Partiellement") or "Partiellement"
            added_sequence = [(target, partial_flags.get(target, False)) for target in added_740]
            updated_740 = _apply_740_additions(previous_entity, added_sequence, partial_label=partial_label)
        else:
            updated_740 = [_clone_zone_preserve(z) for z in prev_im.get_zone("740")]
        merged_zones.extend(updated_740)

        # 750 zones (unchanged)
        merged_zones.extend([_clone_zone_preserve(z) for z in prev_im.get_zone("750")])

        # 552 zones for current record
        for (qual, target), zone in next_adapt_lookup.items():
            prior = prev_adapt_lookup.get((qual, target))
            merged_zones.append(_merge_zone(zone, prior))

        final_intermarc = Intermarc(zones=merged_zones)

        # Guards after rebuild
        if _is_agent_type(type_raw):
            _ensure_unique_manual_agent_clusters(store, record_id, final_intermarc)
        if _is_work_type(type_raw):
            _ensure_unique_work_clusters(store, record_id, final_intermarc)
        if _is_expression_type(type_raw):
            _ensure_unique_expression_clusters(store, record_id, final_intermarc)

        ark_index = load_ark_index(store)
        record = _build_record_from_payload(record_id, type_raw, final_intermarc.to_json_string())
        record_ark = record.ark
        if record_ark:
            ark_index[record_ark] = record_id

        # Counterpart updates for adaptation links
        updated_entities: Dict[str, Entity] = {}
        if added_adapt or removed_adapt:
            for qual, target in added_adapt:
                counter_qual = is_adaptation_of if qual == has_adaptation else has_adaptation
                if not counter_qual:
                    continue
                target_id = ark_index.get(target)
                if not target_id or target_id not in subjects:
                    raise ValueError(f"Oeuvre cible introuvable pour l'adaptation : {target}")
                target_entity = _load_record_from_store(store, *subjects[target_id])
                patched = _ensure_adaptation_link(target_entity, counter_qual, record_ark or "")
                if patched:
                    updated_entities[patched.id_entitelrm] = patched
            for qual, target in removed_adapt:
                counter_qual = is_adaptation_of if qual == has_adaptation else has_adaptation
                if not counter_qual:
                    continue
                target_id = ark_index.get(target)
                if not target_id or target_id not in subjects:
                    continue
                target_entity = _load_record_from_store(store, *subjects[target_id])
                patched = _remove_adaptation_link(target_entity, counter_qual, record_ark or "")
                if patched:
                    updated_entities[patched.id_entitelrm] = patched

        # Write current record
        clear_record_graph(store, record_id)
        quads = list(_build_record_quads(record, ark_index))

        # Write counterpart updates
        for ent in updated_entities.values():
            clear_record_graph(store, ent.id_entitelrm)
            other_record = _build_record_from_payload(ent.id_entitelrm, ent.type_entite, ent.intermarc.to_json_string())
            quads.extend(_build_record_quads(other_record, ark_index))

        if quads:
            store.extend(quads)
            store.flush()

        datasets.touch_dataset(dataset_id)

        updated_payloads = [
            {
                "id": record.id,
                "type": record.type_raw,
                "ark": record_ark,
                "intermarc": final_intermarc.to_json_string(),
            }
        ]
        updated_payloads.extend(
            {
                "id": ent.id_entitelrm,
                "type": ent.type_entite,
                "ark": ent.ark(),
                "intermarc": ent.intermarc.to_json_string(),
            }
            for ent in updated_entities.values()
        )
        return updated_payloads
