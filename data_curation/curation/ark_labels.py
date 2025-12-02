from __future__ import annotations

import json
import unicodedata
from typing import Dict, List, Optional, Set

from data_curation.models import Entity, Intermarc, SousZone, Zone


ARK_PREFIX = "ark:/"


def _normalize_type_name(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value or "")
    normalized = normalized.encode("ascii", "ignore").decode("ascii")
    return normalized.lower().strip()


def _subzones(zone: Zone) -> List[SousZone]:
    if zone.sousZones:
        return zone.sousZones
    if not zone.field_compact_value:
        return []
    try:
        payload = json.loads(zone.field_compact_value)
    except Exception:
        return []
    raw_sous_zones = payload.get("sousZones")
    if not isinstance(raw_sous_zones, list):
        return []
    result: List[SousZone] = []
    for raw in raw_sous_zones:
        if not isinstance(raw, dict):
            continue
        code = str(raw.get("code", ""))
        valeur_raw = raw.get("valeur")
        valeur = "" if valeur_raw is None else str(valeur_raw)
        affected = raw.get("affectedByCuration")
        result.append(SousZone(code=code, valeur=valeur, affected_by_curation=affected))
    return result


def _first_sub_value(intermarc: Intermarc, zone_code: str, sub_code: str) -> Optional[str]:
    for zone in intermarc.get_zone(zone_code):
        for sub in _subzones(zone):
            if sub.code != sub_code:
                continue
            value = str(sub.valeur or "").strip()
            if value:
                return value
    return None


def _lookup_by_ark(ark: str, lookup: Dict[str, Entity]) -> Optional[Entity]:
    if not ark:
        return None
    return lookup.get(ark) or lookup.get(ark.lower())


def build_label_from_entity(
    entity: Entity,
    lookup_by_ark: Dict[str, Entity],
    cache: Optional[Dict[str, str]] = None,
) -> Optional[str]:
    """
    Build a human label for an entity using its Intermarc fields.
    Mirrors the frontend buildLabelFromIntermarc helper.
    """

    if cache is None:
        cache = {}
    if entity.id_entitelrm in cache:
        return cache[entity.id_entitelrm]

    intermarc = entity.intermarc
    type_norm = _normalize_type_name(entity.type_entite)
    label: Optional[str] = None

    if type_norm == "oeuvre":
        label = _first_sub_value(intermarc, "150", "150$a") or _first_sub_value(intermarc, "001", "001$a")
    elif type_norm == "identite publique de personne":
        parts = [
            _first_sub_value(intermarc, "100", "100$a"),
            _first_sub_value(intermarc, "100", "100$m"),
            _first_sub_value(intermarc, "100", "100$d"),
        ]
        label = " ".join([p for p in parts if p])
    elif type_norm == "collectivite":
        main = _first_sub_value(intermarc, "110", "110$a")
        qualifier = _first_sub_value(intermarc, "110", "110$q")
        label = f"{main} — {qualifier}" if main and qualifier else main
    elif type_norm == "manifestation":
        label = _first_sub_value(intermarc, "245", "245$a")
    elif type_norm == "expression":
        zone_140 = next(iter(intermarc.get_zone("140")), None)
        if zone_140:
            parts: List[str] = []
            for sub in _subzones(zone_140):
                value = str(sub.valeur or "").strip()
                if not value:
                    continue
                if sub.code == "140$3":
                    referenced = _lookup_by_ark(value, lookup_by_ark)
                    resolved = build_label_from_entity(referenced, lookup_by_ark, cache) if referenced else None
                    value = resolved or value
                parts.append(value)
            if parts:
                label = " — ".join(parts)
        if not label:
            label = _first_sub_value(intermarc, "150", "150$a") or _first_sub_value(intermarc, "245", "245$a")
    elif type_norm == "valeur controlee":
        label = _first_sub_value(intermarc, "169", "169$a")
    elif type_norm == "marque":
        label = _first_sub_value(intermarc, "163", "163$a")
    elif type_norm == "famille":
        parts = [
            _first_sub_value(intermarc, "120", "120$a"),
            _first_sub_value(intermarc, "120", "120$m"),
            _first_sub_value(intermarc, "120", "120$e"),
        ]
        label = " ".join([p for p in parts if p])
    elif type_norm == "concept dewey":
        main = _first_sub_value(intermarc, "186", "186$i")
        subtitle = _first_sub_value(intermarc, "186", "186$a")
        if main and subtitle:
            label = f"{main} — {subtitle}"
        else:
            label = main or subtitle

    if label:
        cache[entity.id_entitelrm] = label
    return label


def collect_arks(intermarc: Intermarc) -> Set[str]:
    arks: Set[str] = set()
    for zone in intermarc.zones:
        for sub in _subzones(zone):
            value = str(sub.valeur or "").strip()
            if value.startswith(ARK_PREFIX):
                arks.add(value)
    return arks


def build_ark_label_map(entity: Entity, lookup_by_ark: Dict[str, Entity]) -> Dict[str, str]:
    cache: Dict[str, str] = {}
    labels: Dict[str, str] = {}
    for ark in collect_arks(entity.intermarc):
        target = _lookup_by_ark(ark, lookup_by_ark)
        if not target:
            continue
        label = build_label_from_entity(target, lookup_by_ark, cache)
        if label:
            labels[ark] = label
    return labels
