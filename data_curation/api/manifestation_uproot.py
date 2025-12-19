from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List, Optional, Sequence, Set

from .pg import controlled_repo, entities_repo
from .pg.curation_tx import dataset_transaction, update_entity_record
from .anchor_swap import _clone_zone
from ..models import Entity, Intermarc, SousZone, Zone


@dataclass
class ManifestationUprootResult:
    updated_records: List[dict[str, str]]
    previous_expression_arks: Set[str]
    next_expression_arks: Set[str]
    previous_work_arks: Set[str]
    next_work_arks: Set[str]


def _work_arks_for_expression_arks(
    conn, dataset_id: str, expression_arks: Iterable[str]
) -> Set[str]:
    work_arks: Set[str] = set()
    for expr_ark in expression_arks:
        row_ent = entities_repo.get_by_ark(dataset_id, expr_ark, conn=conn)
        if not row_ent:
            continue
        _, expr_entity = row_ent
        work_arks.update(_expression_work_arks(expr_entity))
    return work_arks


def _expression_work_arks(expr: Entity) -> List[str]:
    vals = expr.intermarc.get_subfield_values("140", "3")
    if vals:
        return vals
    return expr.intermarc.get_subfield_values("750", "3")


def _manifestation_expression_arks(manifestation: Entity) -> List[str]:
    return manifestation.intermarc.get_subfield_values("740", "3")


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
    partial_requested: bool = False,
) -> ManifestationUprootResult:
    with dataset_transaction(dataset_id) as conn:
        manifest_row = entities_repo.get_by_record_id(dataset_id, manifestation_id, for_update=True, conn=conn)
        if not manifest_row:
            raise ValueError(f"Record not found: {manifestation_id}")
        _, manifestation = manifest_row
        kind = manifestation.type_entite.strip().lower()
        if not kind.startswith("manifestation"):
            raise ValueError("Le déracinage est réservé aux manifestations.")

        target_entity: Optional[Entity] = None
        target_ark = (target_expression_ark or "").strip()
        if target_expression_id:
            target_row = entities_repo.get_by_record_id(dataset_id, target_expression_id, for_update=True, conn=conn)
            if not target_row:
                raise ValueError(f"Record not found: {target_expression_id}")
            _, target_entity = target_row
            target_norm = target_entity.type_entite.strip().lower()
            if not target_norm.startswith("expression"):
                raise ValueError("Impossible : la cible n'est pas une expression.")
            target_ark = target_entity.ark() or target_ark

        if not target_ark:
            raise ValueError("ARK de l'expression cible manquant.")

        previous_expr_arks = set(_manifestation_expression_arks(manifestation))
        previous_work_arks = _work_arks_for_expression_arks(conn, dataset_id, previous_expr_arks)

        wants_partial = partial_requested or bool(partial_ark)
        if wants_partial and not partial_ark:
            partial_ark = controlled_repo.get_controlled_ark_by_label(dataset_id, "Partiellement", conn=conn) or "Partiellement"

        next_intermarc = _rewrite_manifestation_links(
            manifestation.intermarc, detach=detach_arks, target_ark=target_ark, partial_ark=partial_ark
        )

        if next_intermarc.to_json_string() == manifestation.intermarc.to_json_string():
            raise ValueError("Aucun changement détecté dans les liens 740$3.")

        update_entity_record(
            dataset_id,
            record_id=manifestation.id_entitelrm,
            type_raw=manifestation.type_entite,
            intermarc=next_intermarc,
            conn=conn,
        )

        updated_records = [
            {
                "id": manifestation.id_entitelrm,
                "type": manifestation.type_entite,
                "ark": manifestation.ark(),
                "intermarc": next_intermarc.to_json_string(),
            }
        ]

        next_expr_arks = set(next_intermarc.get_subfield_values("740", "3"))
        next_work_arks = _work_arks_for_expression_arks(conn, dataset_id, next_expr_arks)

        return ManifestationUprootResult(
            updated_records=updated_records,
            previous_expression_arks=previous_expr_arks,
            next_expression_arks=next_expr_arks,
            previous_work_arks=previous_work_arks,
            next_work_arks=next_work_arks,
        )
