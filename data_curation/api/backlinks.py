from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, Sequence, Set

from data_curation.models import Entity


def normalize_ark_value(raw: Any) -> str | None:
    """Return a lowercase ARK string if the value looks like an ARK, else None."""

    if not isinstance(raw, str):
        return None
    trimmed = raw.strip()
    if not trimmed:
        return None
    lowered = trimmed.lower()
    if not lowered.startswith("ark:/"):
        return None
    return lowered


def build_backlink_index(entities: Sequence[Entity]) -> Dict[str, Dict[str, Set[str]]]:
    """Build a target → {source_id → {zone_code}} index for ARK backlinks."""

    index: Dict[str, Dict[str, Set[str]]] = defaultdict(lambda: defaultdict(set))

    for entity in entities:
        source_id = entity.id_entitelrm
        for zone in entity.intermarc.zones:
            zone_code = zone.code
            for sub in zone.sousZones:
                normalized = normalize_ark_value(sub.valeur)
                if not normalized:
                    continue
                index[normalized][source_id].add(zone_code)

    return index
