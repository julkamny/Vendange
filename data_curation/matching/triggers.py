# scripts/matching/triggers.py
from __future__ import annotations

_PAST_PARTICIPLE_SUFFIXES = ("", "e", "s", "es")

_ILLUSTRE_BASE = "illustré"
_ILLUSTRE_COMPLETE = {f"{_ILLUSTRE_BASE}{suffix}" for suffix in _PAST_PARTICIPLE_SUFFIXES}  

# Déclencheurs "responsabilité" (normalisés, sans diacritiques, minuscules)
RESP_TERMS_ILL = {
    "illustration", "illustrations", "ill.", "illustr.",
    "vignettes", "images",
    "gravures", "dessins", "photographies", "lithographies", "lith.", "couverture", "couv."
} | _ILLUSTRE_COMPLETE

_TIRE_BASE = "tiré"

_ADAPT_BASE = "adapté"
_ADAPT_VERB_COMPLETE = {f"{_ADAPT_BASE}{suffix}" for suffix in _PAST_PARTICIPLE_SUFFIXES}

_RESP_TERMS_ADAPT_AGENT_BASE = {"adapt.", "adaptation"}
_RESP_TERMS_ADAPT_AGENT_TIRE = {f"{_TIRE_BASE}{suffix}" for suffix in _PAST_PARTICIPLE_SUFFIXES}

RESP_TERMS_ADAPT_AGENT_SUBTREE = _RESP_TERMS_ADAPT_AGENT_BASE | _RESP_TERMS_ADAPT_AGENT_TIRE | _ADAPT_VERB_COMPLETE

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
