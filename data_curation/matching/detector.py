# scripts/matching/detector.py
from __future__ import annotations
import logging
from dataclasses import dataclass
from typing import Dict, List, Tuple, Iterable, Optional
from scripts.utils.text_norm import normalize_for_match, build_folded_with_map
from .triggers import RESP_TERMS, SEPARATORS

LOGGER = logging.getLogger(__name__)

@dataclass
class Hit:
    ark: str
    variant: str         # variante qui a matché (forme brute)
    score: float
    start: int           # index approx dans le texte original (best-effort)
    end: int
    snippet: str

def _neighbors(norm_text: str, span: Tuple[int, int], window: int = 30) -> str:
    a, b = span
    a = max(0, a - window)
    b = min(len(norm_text), b + window)
    return norm_text[a:b]

def _context_score(norm_title: str, span: Tuple[int, int]) -> float:
    """
    Scorage simple:
      +0.50 si présence d’un séparateur 'fort' à proximité
      +0.30 si terme de responsabilité à proximité
      +0.15 si le match est très proche du début de chaîne
      clamp 0..1
    """
    score = 0.0
    ctx = _neighbors(norm_title, span, window=32)

    if any(sep in ctx for sep in SEPARATORS):
        score += 0.50
    if any(term in ctx for term in RESP_TERMS):
        score += 0.30
    if span[0] <= 5:  # tout début
        score += 0.15

    return min(1.0, score)

def detect_in_title(title_raw: str, ark2variants: Dict[str, Iterable[str]], tau_hi: float = 0.85, tau_lo: float = 0.65) -> Tuple[List[Hit], List[Hit]]:
    """
    Détection par "exact-substring" sur texte normalisé (pas de distance d'édition).
    Retourne (haute_confiance, moyenne_confiance).
    """
    if not title_raw:
        return [], []
    norm_title, pos_map = build_folded_with_map(title_raw)
    hi: List[Hit] = []
    mid: List[Hit] = []

    for ark, variants in ark2variants.items():
        # On normalise les variantes une fois
        normalized_variants = []
        for v in variants:
            nv = normalize_for_match(v)
            # filtres anti-ambiguïtés basiques: >= 2 tokens utiles
            if len([t for t in nv.split(" ") if t and t not in {"de", "la", "le", "les", "du", "des", "d"}]) >= 2:
                normalized_variants.append((v, nv))

        for variant_raw, nv in normalized_variants:
            start = 0
            while True:
                idx = norm_title.find(nv, start)
                if idx < 0:
                    break
                span_norm = (idx, idx + len(nv))
                score = _context_score(norm_title, span_norm)
                # mapping approx vers texte original
                start_orig = pos_map[min(span_norm[0], len(pos_map)-1)]
                end_orig = pos_map[min(span_norm[1]-1, len(pos_map)-1)] + 1
                snippet = title_raw[max(0, start_orig-40): min(len(title_raw), end_orig+40)]
                hit = Hit(
                    ark=ark, variant=variant_raw, score=score,
                    start=start_orig, end=end_orig, snippet=snippet
                )
                LOGGER.debug("Detected responsibility hit: %s", hit)
                if score >= tau_hi:
                    hi.append(hit)
                elif score >= tau_lo:
                    mid.append(hit)
                start = idx + len(nv)
    return hi, mid
