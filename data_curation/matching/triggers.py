# scripts/matching/triggers.py
from __future__ import annotations

# Déclencheurs "responsabilité" (normalisés, sans diacritiques, minuscules)
RESP_TERMS_ILL = {
    "illustre", "illustree", "illustrations", "ill.", "illustr.",
    "vignettes", "images",
    "gravures", "dessins", "photographies", "lithographies", "lith.", "couverture", "couv."
}

RESP_TERMS_ADAPT = {
    "d'après", "adapt.", "adaptation", "tiré"
}

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
