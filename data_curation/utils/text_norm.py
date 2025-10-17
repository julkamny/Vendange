# scripts/utils/text_norm.py
from __future__ import annotations
import unicodedata
import re
from typing import Tuple

_WHITES = re.compile(r"\s+")
_PUNCT_TO_SPACE = re.compile(r"[^\w']+", flags=re.UNICODE)  # on garde lettres, chiffres et apostrophes

def fold_diacritics(s: str) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    # cas particuliers utiles
    s = s.replace("œ", "oe").replace("Œ", "oe")
    return s

def normalize_for_match(s: str) -> str:
    """
    - retire diacritiques
    - met en minuscules
    - remplace ponctuation par espaces (on garde apostrophes)
    - compacte les espaces
    """
    s = fold_diacritics(s).lower()
    s = _PUNCT_TO_SPACE.sub(" ", s)
    s = _WHITES.sub(" ", s).strip()
    return s

def build_folded_with_map(s: str) -> Tuple[str, list[int]]:
    """
    Retourne (texte_normalisé, map_positions) pour approx extraire un snippet du texte original.
    map_positions[i] = index du caractère original correspondant au i-ème caractère du texte normalisé.
    NB: simplifié (œ->oe induit deux chars mappés au même index).
    """
    mapping = []
    out_chars = []
    for idx, ch in enumerate(s):
        base = fold_diacritics(ch)
        if not base:
            continue
        for k, bch in enumerate(base):
            out_chars.append(bch.lower())
            mapping.append(idx)
    norm = "".join(out_chars)
    norm = _WHITES.sub(" ", _PUNCT_TO_SPACE.sub(" ", norm)).strip()
    # Recalcule mapping après la normalisation ponctuation/espaces
    # (approximation : on ne remappe que par longueur égale, sinon best-effort)
    # Ici on simplifie: on recalcule via alignement greedy
    remap = []
    i = 0
    j = 0
    raw = "".join(out_chars)
    raw = _PUNCT_TO_SPACE.sub(" ", raw)
    raw = raw.strip()
    while i < len(raw) and j < len(norm):
        if raw[i] == norm[j]:
            remap.append(mapping[i])
            i += 1
            j += 1
        else:
            i += 1
    # pad si besoin
    while len(remap) < len(norm):
        remap.append(remap[-1] if remap else 0)
    return norm, remap

def word_tokens(s: str) -> list[str]:
    return [t for t in normalize_for_match(s).split(" ") if t]
