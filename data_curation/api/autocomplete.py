from __future__ import annotations

import json
import threading
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Set

from data_curation.models import Entity
from data_curation.api.db_shared import fold_diacritics

DATA_DIR = Path(__file__).parent
COMPLETION_LIMIT = 40
EXCLUDED_AUTOCOMPLETE_TYPES = {"oeuvre", "expression", "manifestation"}


# --- Lightweight label helpers (duplicated to avoid import cycles) ----------------


def _normalize_type(value: str) -> str:
    norm = fold_diacritics((value or "").strip()).lower()
    if norm in {"œuvre", "oeuvre", "work"}:
        return "oeuvre"
    if norm.startswith("expression"):
        return "expression"
    if norm.startswith("manifestation"):
        return "manifestation"
    if norm in {"personne", "identité publique de personne", "identite publique de personne"}:
        return "personne"
    if norm in {"collectivite", "collectivité", "collective"}:
        return "collectivite"
    if "famille" in norm:
        return "famille"
    if "valeur controlee" in norm or "valeur contrôlée" in norm:
        return "valeur controlee"
    return norm or value


def _zone_text(entity: Entity, zone_code: str) -> Optional[str]:
    for zone in entity.intermarc.get_zone(zone_code):
        parts = [sub.valeur.strip() for sub in zone.sousZones if isinstance(sub.valeur, str) and sub.valeur.strip()]
        if parts:
            return " ".join(parts)
    return None


def _title_of(entity: Entity) -> Optional[str]:
    return _zone_text(entity, "150")


def _manifestation_title(entity: Entity) -> Optional[str]:
    return _zone_text(entity, "245")


def _agent_primary_label(entity: Entity) -> str:
    segments: List[str] = []
    for zone in entity.intermarc.get_zone("150"):
        for sub in zone.sousZones:
            if sub.code in {"150$a", "150$m", "150$e"} and isinstance(sub.valeur, str):
                value = sub.valeur.strip()
                if value:
                    segments.append(value)
    if segments:
        return " ".join(segments)
    return _title_of(entity) or entity.id_entitelrm


def _extract_controlled_value_label(entity: Optional[Entity]) -> Optional[str]:
    if not entity:
        return None
    for zone in entity.intermarc.get_zone("169"):
        label = next((sub.valeur for sub in zone.sousZones if sub.code == "169$a"), None)
        if label and isinstance(label, str) and label.strip():
            return label.strip()
    return None


@lru_cache
def _load_controlled_lists() -> dict:
    path = DATA_DIR / "controlled_lists.json"
    with path.open("r", encoding="utf-8") as fp:
        raw = json.load(fp)

    def _normalize_label(value: str) -> str:
        normalized = unicodedata.normalize("NFKC", value or "")
        normalized = " ".join(normalized.split())
        return normalized.lower().strip()

    label_lookup: Dict[str, List[str]] = {}
    for list_name, values in raw.get("CONTROLLED_LIST_VALUES", {}).items():
        for label in values or []:
            key = _normalize_label(label)
            if not key:
                continue
            current = label_lookup.setdefault(key, [])
            if list_name not in current:
                current.append(list_name)

    return {
        "subfield_lists": raw.get("CONTROLLED_SUBFIELD_LISTS", {}),
        "wildcard_lists": raw.get("CONTROLLED_SUBFIELD_WILDCARDS", {}),
        "label_lookup": label_lookup,
    }


@lru_cache
def _load_rule_data() -> dict:
    path = DATA_DIR / "autocomplete_rules.json"
    with path.open("r", encoding="utf-8") as fp:
        return json.load(fp)


def _normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value or "")
    stripped = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    return stripped.lower().strip()


def _normalize_subfield_code(raw: str) -> str:
    trimmed = (raw or "").strip()
    if not trimmed:
        return ""
    if "$" not in trimmed:
        return trimmed.upper()
    zone, rest = trimmed.split("$", 1)
    return f"{zone.upper()}${rest}"


@lru_cache
def _allowed_kinds_map() -> Dict[str, Set[str]]:
    data = _load_rule_data()
    all_kinds: List[str] = data.get("all_autocomplete_entity_kinds", [])

    def register(codes: Iterable[str], kinds: Iterable[str], mapping: Dict[str, Set[str]]):
        for raw in codes:
            normalized = _normalize_subfield_code(raw)
            if not normalized:
                continue
            mapping.setdefault(normalized, set()).update(kinds)

    mapping: Dict[str, Set[str]] = {}
    register(data.get("COLLECTIVE_CODES", []), ["collective"], mapping)
    register(data.get("PERSON_CODES", []), ["person"], mapping)
    register(data.get("FAMILY_CODES", []), ["family"], mapping)
    register(data.get("DEWEY_CODES", []), ["deweyConcept"], mapping)
    register(data.get("CONCEPT_CODES", []), ["concept"], mapping)
    register(data.get("EVENT_CODES", []), ["event"], mapping)
    register(data.get("GENRE_FORM_CODES", []), ["genreForm"], mapping)
    register(data.get("TIME_LAPSE_CODES", []), ["timeLapse"], mapping)
    register(data.get("PLACE_CODES", []), ["place"], mapping)
    register(data.get("BRAND_CODES", []), ["brand"], mapping)

    excluded = {"controlledValue", "work", "expression", "manifestation"}
    allowed_general = [kind for kind in all_kinds if kind not in excluded]
    register(data.get("RESTRICTED_GENERAL_CODES", []), allowed_general, mapping)
    return mapping


def allowed_kinds_for_subfield(subfield_code: Optional[str]) -> Optional[List[str]]:
    if not subfield_code:
        return None
    mapping = _allowed_kinds_map()
    normalized = _normalize_subfield_code(subfield_code)
    if not normalized:
        return None
    allowed = mapping.get(normalized)
    if not allowed:
        return None
    return list(allowed)


def _controlled_lists_for_subfield(subfield_code: Optional[str]) -> List[str]:
    if not subfield_code:
        return []
    data = _load_controlled_lists()
    normalized = subfield_code.strip()
    if not normalized:
        return []
    direct = data["subfield_lists"].get(normalized)
    if direct:
        return list(direct)
    idx = normalized.find("$")
    if idx != -1:
        wildcard = normalized[idx:]
        wildcard_lists = data["wildcard_lists"].get(wildcard)
        if wildcard_lists:
            return list(wildcard_lists)
    return []


def _controlled_lists_for_label(label: str) -> List[str]:
    lookup = _load_controlled_lists()["label_lookup"]
    normalized = unicodedata.normalize("NFKC", label or "")
    normalized = " ".join(normalized.split()).lower().strip()
    return lookup.get(normalized, [])


def _infer_kind(type_raw: str) -> str:
    data = _load_rule_data()
    mapping: Dict[str, str] = data.get("type_kind_map", {})
    key = fold_diacritics((type_raw or "").strip()).lower()
    return mapping.get(key, "other")


def _display_label(entity: Entity) -> Optional[str]:
    norm = _normalize_type(entity.type_entite)
    if norm in {"personne", "collectivite", "famille"}:
        return _agent_primary_label(entity)
    if norm == "manifestation":
        return _manifestation_title(entity)
    if norm == "valeur controlee":
        return _extract_controlled_value_label(entity)
    return _title_of(entity)


@dataclass
class AutocompleteSuggestion:
    ark: str
    label: str
    label_normalized: str
    type: str
    kind: str
    controlled_lists: List[str]

    @property
    def is_controlled(self) -> bool:
        return self.kind == "controlledValue"

    def compact(self) -> dict[str, str]:
        return {"ark": self.ark, "label": self.label, "type": self.type}


def _build_suggestion_index(entities: Sequence[Entity]) -> List[AutocompleteSuggestion]:
    seen: Set[str] = set()
    suggestions: List[AutocompleteSuggestion] = []
    for ent in entities:
        ark = (ent.ark() or "").strip()
        if not ark or ark in seen:
            continue
        norm_type = _normalize_type(ent.type_entite)
        if norm_type in EXCLUDED_AUTOCOMPLETE_TYPES:
            continue
        label = _display_label(ent) or ent.id_entitelrm
        if not label:
            continue
        kind = _infer_kind(ent.type_entite)
        controlled_lists: List[str] = []
        if kind == "controlledValue":
            controlled_lists = _controlled_lists_for_label(label)
        suggestions.append(
            AutocompleteSuggestion(
                ark=ark,
                label=label,
                label_normalized=_normalize_text(label),
                type=ent.type_entite,
                kind=kind,
                controlled_lists=controlled_lists,
            )
        )
        seen.add(ark)
    suggestions.sort(key=lambda s: s.label.lower())
    return suggestions


@dataclass
class _AutocompleteCacheEntry:
    updated_at: str
    suggestions: List[AutocompleteSuggestion]


_AUTOCOMPLETE_CACHE: Dict[str, _AutocompleteCacheEntry] = {}
_AUTOCOMPLETE_CACHE_LOCK = threading.RLock()


def _get_index(dataset_id: str, updated_at: str, entities: Sequence[Entity]) -> List[AutocompleteSuggestion]:
    with _AUTOCOMPLETE_CACHE_LOCK:
        entry = _AUTOCOMPLETE_CACHE.get(dataset_id)
        if entry and entry.updated_at == updated_at:
            return entry.suggestions

    suggestions = _build_suggestion_index(entities)
    with _AUTOCOMPLETE_CACHE_LOCK:
        _AUTOCOMPLETE_CACHE[dataset_id] = _AutocompleteCacheEntry(updated_at=updated_at, suggestions=suggestions)
    return suggestions


def autocomplete_entities(
    dataset_id: str,
    updated_at: str,
    entities: Sequence[Entity],
    subfield_code: str,
    query: str = "",
) -> List[dict[str, str]]:
    subfield = (subfield_code or "").strip()
    if not subfield:
        return []

    allowed_kinds = allowed_kinds_for_subfield(subfield)
    allowed_lists = _controlled_lists_for_subfield(subfield)
    if not allowed_kinds and not allowed_lists:
        return []

    normalized_query = _normalize_text(query or "")
    allowed_kind_set = set(allowed_kinds) if allowed_kinds else None
    allowed_list_set = set(allowed_lists) if allowed_lists else None

    index = _get_index(dataset_id, updated_at, entities)
    results: List[dict[str, str]] = []

    for suggestion in index:
        if allowed_kind_set is not None:
            if suggestion.kind not in allowed_kind_set:
                continue
        elif not suggestion.is_controlled:
            continue

        if suggestion.is_controlled:
            if not allowed_list_set:
                continue
            if not any(entry in allowed_list_set for entry in suggestion.controlled_lists):
                continue

        if normalized_query and not suggestion.label_normalized.startswith(normalized_query):
            continue

        results.append(suggestion.compact())
        if len(results) >= COMPLETION_LIMIT:
            break

    return results
