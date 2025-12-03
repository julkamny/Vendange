from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Sequence, Set

from .db_ingest import _build_record_from_payload, _build_record_quads
from .db_query import _load_record_from_store, _record_subjects
from .db_store import _STORE_LOCK, clear_record_graph, get_store_locked, load_ark_index
from . import datasets
from .anchor_swap import _clone_zone
from ..models import Entity, Intermarc, SousZone, Zone
from data_curation.curation.cluster_views import _expression_work_arks, _manifestation_expression_arks


@dataclass
class ManifestationUprootResult:
    updated_records: List[dict[str, str]]
    previous_expression_arks: Set[str]
    next_expression_arks: Set[str]
    previous_work_arks: Set[str]
    next_work_arks: Set[str]


def _work_arks_for_expression_arks(
    store, ark_index: dict[str, str], expression_arks: Sequence[str]
) -> Set[str]:
    work_arks: Set[str] = set()
    subjects = _record_subjects(store)
    for expr_ark in expression_arks:
        expr_id = ark_index.get(expr_ark)
        if not expr_id or expr_id not in subjects:
            continue
        expr_entity = _load_record_from_store(store, *subjects[expr_id])
        work_arks.update(_expression_work_arks(expr_entity))
    return work_arks


def _rewrite_manifestation_links(
    intermarc: Intermarc, *, detach: Sequence[str], target_ark: str, partial_ark: Optional[str]
) -> Intermarc:
    detach_set = {entry.strip() for entry in detach if entry and entry.strip()}
    next_zones = []
    for zone in intermarc.zones:
        if zone.code != "740":
            next_zones.append(_clone_zone(zone))
            continue
        has_detach = any(
            sub.code == "740$3" and str(sub.valeur).strip() in detach_set for sub in zone.sousZones
        )
        if has_detach:
            continue
        next_zones.append(_clone_zone(zone))

    already_linked = any(
        zone.code == "740"
        and any(sub.code == "740$3" and str(sub.valeur).strip() == target_ark for sub in zone.sousZones)
        for zone in next_zones
    )
    if not already_linked:
        new_subfields = [SousZone(code="740$3", valeur=target_ark, affected_by_curation="manual")]
        if partial_ark and partial_ark.strip():
            new_subfields.append(SousZone(code="740$q", valeur=partial_ark.strip(), affected_by_curation="manual"))
        next_zones.append(Zone(code="740", sousZones=new_subfields, affected_by_curation="manual"))

    return Intermarc(zones=next_zones)


def uproot_manifestation(
    dataset_id: str,
    *,
    manifestation_id: str,
    target_expression_id: Optional[str],
    target_expression_ark: Optional[str],
    detach_arks: Sequence[str],
    partial_ark: Optional[str],
) -> ManifestationUprootResult:
    with _STORE_LOCK:
        store = get_store_locked(dataset_id)
        subjects = _record_subjects(store)
        if manifestation_id not in subjects:
            raise ValueError(f"Record not found: {manifestation_id}")

        manifestation = _load_record_from_store(store, *subjects[manifestation_id])
        kind = manifestation.type_entite.strip().lower()
        if not kind.startswith("manifestation"):
            raise ValueError("Le déracinage est réservé aux manifestations.")

        ark_index = load_ark_index(store)

        target_entity: Optional[Entity] = None
        target_ark = (target_expression_ark or "").strip()
        if target_expression_id:
            if target_expression_id not in subjects:
                raise ValueError(f"Record not found: {target_expression_id}")
            target_entity = _load_record_from_store(store, *subjects[target_expression_id])
            target_norm = target_entity.type_entite.strip().lower()
            if not target_norm.startswith("expression"):
                raise ValueError("Impossible : la cible n'est pas une expression.")
            target_ark = target_entity.ark() or target_ark

        if not target_ark:
            raise ValueError("ARK de l'expression cible manquant.")

        previous_expr_arks = set(_manifestation_expression_arks(manifestation))
        previous_work_arks = _work_arks_for_expression_arks(store, ark_index, previous_expr_arks)

        next_intermarc = _rewrite_manifestation_links(
            manifestation.intermarc, detach=detach_arks, target_ark=target_ark, partial_ark=partial_ark
        )

        if next_intermarc.to_json_string() == manifestation.intermarc.to_json_string():
            raise ValueError("Aucun changement détecté dans les liens 740$3.")

        clear_record_graph(store, manifestation_id)

        manifestation_ark = manifestation.ark()
        if manifestation_ark:
            ark_index.setdefault(manifestation_ark, manifestation_id)
        if target_entity:
            target_entity_ark = target_entity.ark()
            if target_entity_ark:
                ark_index.setdefault(target_entity_ark, target_entity.id_entitelrm)

        record = _build_record_from_payload(
            manifestation.id_entitelrm, manifestation.type_entite, next_intermarc.to_json_string()
        )
        quads = list(_build_record_quads(record, ark_index))
        if quads:
            store.extend(quads)
            store.flush()

        datasets.touch_dataset(dataset_id)

        updated_records = [
            {
                "id": manifestation.id_entitelrm,
                "type": manifestation.type_entite,
                "ark": manifestation_ark,
                "intermarc": next_intermarc.to_json_string(),
            }
        ]

        next_expr_arks = set(next_intermarc.get_subfield_values("740", "3"))
        next_work_arks = _work_arks_for_expression_arks(store, ark_index, next_expr_arks)

        return ManifestationUprootResult(
            updated_records=updated_records,
            previous_expression_arks=previous_expr_arks,
            next_expression_arks=next_expr_arks,
            previous_work_arks=previous_work_arks,
            next_work_arks=next_work_arks,
        )
