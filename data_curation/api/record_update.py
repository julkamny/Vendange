from __future__ import annotations

from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from .anchor_swap import _manual_adaptation_zone
from .db_guards import (
    _ensure_unique_expression_clusters,
    _ensure_unique_agent_clusters,
    _ensure_unique_work_clusters,
    _extract_expression_cluster_targets,
    _extract_work_cluster_targets,
    _is_agent_type,
    _is_expression_type,
    _is_work_type,
)
from .manual_cluster import _add_cluster_target, _remove_cluster_target
from .manifestation_uproot import _rewrite_manifestation_links
from .pg import controlled_repo, entities_repo
from .pg.curation_tx import dataset_transaction, update_entity_record
from ..models import Entity, Intermarc, SousZone, Zone


def _zone_signature(zone: Zone) -> Tuple[str, Optional[str], Tuple[Tuple[str, str], ...]]:
    """Signature ignoring curation flags."""
    return (
        zone.code,
        zone.field_compact_value,
        tuple((sub.code, sub.valeur) for sub in zone.sousZones),
    )


def _ark_from_im(intermarc: Intermarc) -> Optional[str]:
    vals = intermarc.get_subfield_values("001", "a")
    return vals[0].strip() if vals else None


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
    if previous and not new_zone.field_compact_value and previous.field_compact_value:
        new_zone = Zone(
            code=new_zone.code,
            field_compact_value=previous.field_compact_value,
            sousZones=[
                SousZone(code=sub.code, valeur=sub.valeur, affected_by_curation=sub.affected_by_curation)
                for sub in new_zone.sousZones
            ],
            affected_by_curation=new_zone.affected_by_curation,
        )
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

    def _pop_prior(zone: Zone) -> Optional[Zone]:
        sig = _zone_signature(zone)
        bucket = prev_pool.get(sig, [])
        if bucket:
            return bucket.pop(0)
        if zone.field_compact_value is None:
            fallback_sig = (zone.code, None, tuple((sub.code, sub.valeur) for sub in zone.sousZones))
            for key, bucket in prev_pool.items():
                if key[0] == fallback_sig[0] and key[2] == fallback_sig[2] and bucket:
                    return bucket.pop(0)
        return None

    for zone in new_im.zones:
        if zone.code in special_codes:
            continue
        prior = _pop_prior(zone)
        merged.append(_merge_zone(zone, prior))
    return merged


def update_record(dataset_id: str, record_id: str, *, type_raw: str, intermarc_json: str) -> List[dict[str, str]]:
    new_intermarc = Intermarc.from_json_string(intermarc_json)
    updated_payloads: List[dict[str, str]] = []

    with dataset_transaction(dataset_id) as conn:
        anchor_row_entity = entities_repo.get_by_record_id(dataset_id, record_id, for_update=True, conn=conn)
        if not anchor_row_entity:
            raise ValueError(f"Record not found: {record_id}")
        anchor_row, previous_entity = anchor_row_entity
        if not type_raw.strip():
            type_raw = anchor_row.get("type_raw") or previous_entity.type_entite
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
        has_adaptation = controlled_repo.get_controlled_ark_by_label(dataset_id, "A pour adaptation", conn=conn)
        is_adaptation_of = controlled_repo.get_controlled_ark_by_label(dataset_id, "Est une adaptation de", conn=conn)
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
            partial_label = controlled_repo.get_controlled_ark_by_label(dataset_id, "Partiellement", conn=conn) or "Partiellement"
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

        record_ark = _ark_from_im(final_intermarc)

        def _works_clustered_together(work_a: str, work_b: str) -> bool:
            rows = conn.execute(
                """
                SELECT 1 FROM cluster
                WHERE dataset_id=%s AND (
                    (anchor_ark=%s AND member_ark=%s) OR
                    (anchor_ark=%s AND member_ark=%s)
                ) LIMIT 1
                """,
                (dataset_id, work_a, work_b, work_b, work_a),
            ).fetchone()
            return bool(rows)

        # Validate cluster targets existence and parent compatibility (expressions)
        if _is_work_type(type_raw) or _is_expression_type(type_raw):
            target_arks = {sz.valeur for z in final_intermarc.get_zone("90F") for sz in z.sousZones if sz.code == "90F$3"}
            for target in target_arks:
                target_row = entities_repo.get_by_ark(dataset_id, target, for_update=True, conn=conn)
                if not target_row:
                    raise ValueError(f"Cible introuvable pour le cluster : {target}")
                _, target_ent = target_row
                if _is_expression_type(type_raw) and _is_expression_type(target_ent.type_entite):
                    anchor_parents = set(final_intermarc.get_subfield_values("140", "3") or final_intermarc.get_subfield_values("750", "3"))
                    target_parents = set(target_ent.intermarc.get_subfield_values("140", "3") or target_ent.intermarc.get_subfield_values("750", "3"))
                    if anchor_parents and target_parents and anchor_parents.isdisjoint(target_parents):
                        linked = any(_works_clustered_together(a, b) for a in anchor_parents for b in target_parents)
                        if not linked:
                            raise ValueError("La cible n'a pas le même parent (750/140).")

        # Guards after rebuild
        if _is_agent_type(type_raw):
            _ensure_unique_agent_clusters(conn, dataset_id, record_ark or "", final_intermarc)
        if _is_work_type(type_raw):
            _ensure_unique_work_clusters(conn, dataset_id, record_ark or "", final_intermarc)
        if _is_expression_type(type_raw):
            _ensure_unique_expression_clusters(conn, dataset_id, record_ark or "", final_intermarc)

        ark_cache: Dict[str, Tuple] = {}

        def _get_by_ark(ark: str):
            if ark in ark_cache:
                return ark_cache[ark]
            res = entities_repo.get_by_ark(dataset_id, ark, for_update=True, conn=conn)
            ark_cache[ark] = res
            return res

        updated_entities: Dict[str, Entity] = {}
        if added_adapt or removed_adapt:
            for qual, target in added_adapt:
                counter_qual = is_adaptation_of if qual == has_adaptation else has_adaptation
                if not counter_qual:
                    continue
                target_row_entity = _get_by_ark(target)
                if not target_row_entity:
                    raise ValueError(f"Oeuvre cible introuvable pour l'adaptation : {target}")
                _, target_entity = target_row_entity
                patched = _ensure_adaptation_link(target_entity, counter_qual, record_ark or "")
                if patched:
                    updated_entities[patched.id_entitelrm] = patched
            for qual, target in removed_adapt:
                counter_qual = is_adaptation_of if qual == has_adaptation else has_adaptation
                if not counter_qual:
                    continue
                target_row_entity = _get_by_ark(target)
                if not target_row_entity:
                    continue
                _, target_entity = target_row_entity
                patched = _remove_adaptation_link(target_entity, counter_qual, record_ark or "")
                if patched:
                    updated_entities[patched.id_entitelrm] = patched

        # Write current record + counterparts
        updated_main = update_entity_record(
            dataset_id,
            record_id=record_id,
            type_raw=type_raw,
            intermarc=final_intermarc,
            conn=conn,
        )
        updated_payloads.append(updated_main.as_payload())

        for ent in updated_entities.values():
            update_entity_record(
                dataset_id,
                record_id=ent.id_entitelrm,
                type_raw=ent.type_entite,
                intermarc=ent.intermarc,
                conn=conn,
            )
            updated_payloads.append(
                {
                    "id": ent.id_entitelrm,
                    "type": ent.type_entite,
                    "ark": ent.ark(),
                    "intermarc": ent.intermarc.to_json_string(),
                }
            )

    return updated_payloads
