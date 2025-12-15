"""Shared constants and lightweight helpers for Postgres-backed Vendange."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
from urllib.parse import quote

from ..utils.text_norm import fold_diacritics as _fold

BASE_ENTITY_NS = "https://vendange.bnf.fr/entity/"
RELATION_NS = "https://vendange.bnf.fr/relation/"


@dataclass
class IngestionStats:
    records: int
    quads: int


def canonical_type_key(value: str) -> str:
    return _fold(value or "").lower().strip()


def fold_diacritics(value: str) -> str:
    """Alias to keep existing imports working."""
    return _fold(value)


def looks_like_ark(value: str) -> bool:
    return value.startswith("ark:/")


def sanitize_subfield_code(code: str) -> str:
    return (code or "").replace("$", "s")


def relation_predicate(code: str) -> str:
    return f"{RELATION_NS}{quote(code, safe='')}"
