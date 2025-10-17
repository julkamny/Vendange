# scripts/authority/nes_service.py
from __future__ import annotations
from typing import Dict, List

import re

from scripts.models import Entity
from .sru_client import get_person_variants
from .nes_store import NESStore


HONORIFIC_ABBREVIATIONS: Dict[str, List[str]] = {
    "madame": ["Mme"],
    "monsieur": ["M.", "Mr"],
    "mademoiselle": ["Mlle"],
    "monseigneur": ["Mgr"],
    "comtesse": ["Ctesse"],
    "comte": ["Cte"],
    "marquise": ["Mqe"],
    "marquis": ["Mq"],
    "docteur": ["Dr"],
    "professeur": ["Pr"],
    "capitaine": ["Cne"],
    "lieutenant": ["Lt"],
    "general": ["Gal"],
    "général": ["Gal"],
    "baron": ["Bn"],
    "baronne": ["Bne"],
    "commandant": ["Cdt"],
}


def _normalize_heading_value(value: str) -> str:
    return " ".join(str(value or "").replace("\u200b", " ").split()).strip(" ,;:")


def _variants_from_entity(entity: Entity) -> List[str]:
    variants: List[str] = []

    for tag in ("100", "400"):
        for zone in entity.intermarc.get_zone(tag):
            a_values = [
                _normalize_heading_value(sz.valeur)
                for sz in zone.sousZones
                if sz.code == f"{tag}$a" and sz.valeur
            ]
            m_values = [
                _normalize_heading_value(sz.valeur)
                for sz in zone.sousZones
                if sz.code == f"{tag}$m" and sz.valeur
            ]

            for a_val in a_values:
                if not a_val:
                    continue
                variants.append(a_val)
                for m_val in m_values:
                    if not m_val:
                        continue
                    variants.append(f"{a_val} {m_val}".strip())
                    variants.append(f"{m_val} {a_val}".strip())

    seen: Dict[str, None] = {}
    for v in variants:
        if v:
            seen.setdefault(v, None)

    return _augment_with_abbreviations(list(seen.keys()))


def _augment_with_abbreviations(variants: List[str]) -> List[str]:
    augmented = set(variants)
    for variant in list(augmented):
        lowered = variant.lower()
        for term, replacements in HONORIFIC_ABBREVIATIONS.items():
            if term in lowered:
                pattern = re.compile(rf"\b{re.escape(term)}\b", re.IGNORECASE)
                for replacement in replacements:
                    augmented.add(pattern.sub(replacement, variant))
    return list(augmented)

class NameExpansionService:
    """
    Resolve person name variants, preferring local CSV records (100/400) before SRU.
    """

    def __init__(
        self,
        store: NESStore | None = None,
        local_entities_by_ark: Dict[str, Entity] | None = None,
    ):
        self.store = store or NESStore()
        self.local_entities_by_ark = local_entities_by_ark or {}

    def _variants_from_local(self, ark: str) -> List[str]:
        entity = self.local_entities_by_ark.get(ark)
        if not entity:
            return []
        return _variants_from_entity(entity)

    def ensure_variants(self, ark: str) -> List[str]:
        local_variants = self._variants_from_local(ark)
        if local_variants:
            self.store.put_variants(ark, local_variants)
            return self.store.get_variants(ark)

        if not self.store.has_ark(ark):
            variants = [
                " ".join(str(v).split())
                for v in get_person_variants(ark)
                if str(v).strip()
            ]
            self.store.put_variants(ark, variants)

        return self.store.get_variants(ark)
