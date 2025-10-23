from __future__ import annotations

from typing import Dict, Mapping

from data_curation.utils.text_norm import normalize_for_match


ORIGINAL_AUTHOR_CANONICAL_KEY = "original_author"


def build_canonical_relator_lookup(controlled_lookup: Mapping[str, str | None]) -> Dict[str, str]:
    canonical: Dict[str, str] = {}
    for label, ark in controlled_lookup.items():
        if not ark:
            continue
        normalized_label = normalize_for_match(label)
        if not normalized_label:
            continue
        if (
            "auteur du texte" in normalized_label
            or "autrice du texte" in normalized_label
            or "oeuvre source" in normalized_label
            or "œuvre source" in normalized_label
        ):
            canonical[ark] = ORIGINAL_AUTHOR_CANONICAL_KEY
    return canonical


def canonical_relator(relator: str | None, lookup: Mapping[str, str]) -> str | None:
    if not relator:
        return None
    return lookup.get(relator, relator)


__all__ = [
    "ORIGINAL_AUTHOR_CANONICAL_KEY",
    "build_canonical_relator_lookup",
    "canonical_relator",
]
