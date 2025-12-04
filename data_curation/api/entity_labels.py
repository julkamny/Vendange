from __future__ import annotations

from typing import List, Optional

from data_curation.api.db_shared import fold_diacritics
from data_curation.models import Entity


def normalize_type(value: str) -> str:
    norm = fold_diacritics((value or "").strip()).lower()
    if norm in {"œuvre", "oeuvre", "work"}:
        return "oeuvre"
    if norm.startswith("expression"):
        return "expression"
    if norm.startswith("manifestation"):
        return "manifestation"
    if norm in {"personne", "identite publique de personne", "identité publique de personne"}:
        return "personne"
    if norm in {"collectivite", "collectivité", "collective"}:
        return "collectivite"
    if "famille" in norm:
        return "famille"
    if "valeur controlee" in norm or "valeur contrôlée" in norm:
        return "valeur controlee"
    return norm or value


def _zone_text(entity: Entity, zone_code: str) -> Optional[str]:
    for zone in entity.intermarc.get_zone(zone_code):
        parts = [sub.valeur.strip() for sub in zone.sousZones if isinstance(sub.valeur, str) and sub.valeur.strip()]
        if parts:
            return " ".join(parts)
    return None


def title_of(entity: Entity) -> Optional[str]:
    return _zone_text(entity, "150")


def manifestation_title(entity: Entity) -> Optional[str]:
    return _zone_text(entity, "245")


def extract_controlled_value_label(entity: Optional[Entity]) -> Optional[str]:
    if not entity:
        return None
    for zone in entity.intermarc.get_zone("169"):
        label = next((sub.valeur for sub in zone.sousZones if sub.code == "169$a"), None)
        if label and isinstance(label, str) and label.strip():
            return label.strip()
    return None


def agent_primary_label(entity: Entity) -> str:
    allowed = {"150$a", "150$m", "150$e"}
    for zone in entity.intermarc.get_zone("150"):
        parts: List[str] = []
        for sub in zone.sousZones:
            if sub.code in allowed and isinstance(sub.valeur, str):
                val = sub.valeur.strip().replace("|", "")
                if val:
                    parts.append(val)
        if parts:
            return " ".join(parts)
    return title_of(entity) or entity.id_entitelrm
