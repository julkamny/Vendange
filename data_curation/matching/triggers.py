# scripts/matching/triggers.py
from __future__ import annotations

# Déclencheurs "responsabilité" (normalisés, sans diacritiques, minuscules)
RESP_TERMS_ILL = {
    "illustre", "illustree", "illustrations", "ill.", "illustr.",
    "vignettes", "images",
    "gravures", "dessins", "photographies", "lithographies", "lith.", "couverture", "couv."
}

_TIRE_BASE = "tiré"
_TIRE_SUFFIXES = ("", "e", "s", "es")

_RESP_TERMS_ADAPT_AGENT_BASE = {"adapt.", "adaptation"}
_RESP_TERMS_ADAPT_AGENT_TIRE = {f"{_TIRE_BASE}{suffix}" for suffix in _TIRE_SUFFIXES}

RESP_TERMS_ADAPT_AGENT_SUBTREE = _RESP_TERMS_ADAPT_AGENT_BASE | _RESP_TERMS_ADAPT_AGENT_TIRE

RESP_TERMS_ADAPT_HEAD_SUBTREE = {
    "d'après",
}

RESP_TERMS_ADAPT = RESP_TERMS_ADAPT_AGENT_SUBTREE | RESP_TERMS_ADAPT_HEAD_SUBTREE

RESP_TERMS_TRAD = {
    "traduit", "traduction",
}

RESP_TERMS_INTRO = {
    "presente", "preface", "introduction",
}

RESP_TERMS_AUGM = {
    "edite", "edition", "commentaire", "accompagne", "suivi"
}

RESP_TERMS = (
    RESP_TERMS_ILL
    | RESP_TERMS_ADAPT
    | RESP_TERMS_TRAD
    | RESP_TERMS_INTRO
    | RESP_TERMS_AUGM
)

# Séparateurs forts de segments (titre | responsabilités, etc.)
SEPARATORS = {"|", ":", ";", "—", "–", "-", ".", "…"}
