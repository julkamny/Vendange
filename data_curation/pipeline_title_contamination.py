# scripts/pipeline_title_contamination.py
from __future__ import annotations
import logging
from dataclasses import dataclass, asdict
from typing import Dict, List
import json

from scripts.models import Entity  # réutilise vos classes
from scripts.curation.pipeline import read_csv_entities  # I/O CSV existant
from scripts.authority.nes_service import NameExpansionService
from scripts.matching.detector import detect_in_title, Hit
from scripts.utils.title_cleaner import (
    clean_title_text,
    contains_illustration_trigger,
    debug_match_targets,
    extract_responsible_person_arks,
    match_variants_in_title,
)

LOGGER = logging.getLogger(__name__)


@dataclass
class DetectionRecord:
    id_entitelrm: str
    work_ark: str | None
    title: str | None
    cleaned_title: str
    author_ark: str
    matched_variant: str
    score: float
    snippet: str
    confidence: str  # "high" / "medium"

def run_title_contamination_detection(input_csv: str, out_json: str, tau_hi: float = 0.85, tau_lo: float = 0.65) -> List[DetectionRecord]:
    entities, _dataset = read_csv_entities(input_csv)
    works = [e for e in entities if e.type_entite.strip().lower() in {"œuvre", "oeuvre", "oeuvre"}]

    ark_index = {
        ark: entity
        for entity in entities
        if (ark := entity.ark())
    }

    nes = NameExpansionService(local_entities_by_ark=ark_index)

    results: List[DetectionRecord] = []

    for e in works:
        title = e.title_main()
        if not title:
            continue
        person_arks = extract_responsible_person_arks(e)
        if not person_arks:
            continue
        ark2variants: Dict[str, List[str]] = {}
        for a in person_arks:
            variants = nes.ensure_variants(a)
            if variants:
                ark2variants[a] = variants

        debug_match_targets(e.id_entitelrm, title, ark2variants)

        hi, mid = detect_in_title(title, ark2variants, tau_hi=tau_hi, tau_lo=tau_lo)

        variant_strings = [v for variants in ark2variants.values() for v in variants]
        person_spans = match_variants_in_title(title, variant_strings)
        remove_illustrations = contains_illustration_trigger(title)
        cleaned_title = clean_title_text(
            title,
            person_spans=person_spans,
            remove_illustration_groups=remove_illustrations,
        )

        if cleaned_title != title:
            LOGGER.info(
                "[%s] Cleaned title -> '%s'",
                e.id_entitelrm,
                cleaned_title,
            )
        else:
            LOGGER.debug("[%s] Title unchanged after cleaning", e.id_entitelrm)

        def to_rec(hit: Hit, conf: str) -> DetectionRecord:
            return DetectionRecord(
                id_entitelrm=e.id_entitelrm,
                work_ark=e.ark(),
                title=title,
                cleaned_title=cleaned_title,
                author_ark=hit.ark,
                matched_variant=hit.variant,
                score=round(hit.score, 3),
                snippet=hit.snippet,
                confidence=conf,
            )

        results.extend(to_rec(h, "high") for h in hi)
        results.extend(to_rec(h, "medium") for h in mid)

    # Ecriture JSON
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump([asdict(r) for r in results], f, ensure_ascii=False, indent=2)

    return results
