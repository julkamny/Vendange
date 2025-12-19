"""Record-driven label and title-segment builders for the Postgres workspace layer.

This module mirrors the behavior of the legacy `cluster_views.py` title segmentation
and the entity label rules in `data_curation/api/ark_labels.py`, but operates on the
JSON records stored in Postgres (dicts) to avoid relying on precomputed projections.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from data_curation.api.db_shared import looks_like_ark
from data_curation.api.schemas import TitleSegment


ARK_PREFIX = "ark:/"


def _normalize_type_name(value: str) -> str:
    """Normalize a raw Intermarc entity type for comparisons (accent/ligature tolerant)."""

    normalized = (value or "").replace("œ", "oe").replace("Œ", "oe")
    normalized = unicodedata.normalize("NFD", normalized)
    normalized = normalized.encode("ascii", "ignore").decode("ascii")
    return normalized.lower().strip()


def _subfield_code(raw: str) -> str:
    """Return the subfield suffix (Intermarc `$` or Oxigraph `s` encodings)."""

    if "$" in raw:
        return raw.split("$", 1)[1]
    match = re.match(r"^[0-9A-Za-z]+s(.+)$", raw or "")
    if match:
        return match.group(1)
    return raw


def _segment_label(sub_code: str) -> str:
    """Legacy chip label: `$a` -> `A`, `150sa` -> `A`."""

    if "$" in sub_code:
        suffix = sub_code.split("$", 1)[1]
        return (suffix or sub_code).upper()
    match = re.match(r"^[0-9A-Za-z]+s(.+)$", sub_code or "")
    if match:
        return (match.group(1) or sub_code).upper()
    return (sub_code or "").upper()


def _iter_zones(record: Dict[str, Any]) -> Iterable[Dict[str, Any]]:
    zones = record.get("zones", [])
    if isinstance(zones, list):
        for zone in zones:
            if isinstance(zone, dict):
                yield zone


def _subzones(zone: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Return subzones, supporting compact JSON payloads."""

    raw = zone.get("sousZones")
    if isinstance(raw, list) and raw:
        return [s for s in raw if isinstance(s, dict)]
    compact = zone.get("fieldCompactValue")
    if not compact:
        return []
    try:
        payload = json.loads(compact)
    except Exception:
        return []
    raw_compact = payload.get("sousZones")
    if not isinstance(raw_compact, list):
        return []
    return [s for s in raw_compact if isinstance(s, dict)]


def iter_record_subfields(record: Dict[str, Any]) -> Iterable[Tuple[str, str, Any]]:
    """Yield (zone_code, sub_code, value) tuples from a Postgres JSON record."""

    for zone in _iter_zones(record):
        zone_code = str(zone.get("code", "") or "")
        for sub in _subzones(zone):
            yield zone_code, str(sub.get("code", "") or ""), sub.get("valeur")


def collect_arks(record: Dict[str, Any], *, zone_codes: Optional[Set[str]] = None) -> Set[str]:
    """Collect all ARK strings from the record (optionally restricted to specific zones)."""

    arks: Set[str] = set()
    for zone_code, _, value in iter_record_subfields(record):
        if zone_codes is not None and zone_code not in zone_codes:
            continue
        if isinstance(value, str):
            trimmed = value.strip()
            if looks_like_ark(trimmed):
                arks.add(trimmed)
    return arks


def _first_sub_value(record: Dict[str, Any], zone_code: str, sub_code: str) -> Optional[str]:
    for zc, sc, value in iter_record_subfields(record):
        if zc != zone_code or sc != sub_code:
            continue
        if not isinstance(value, str):
            continue
        trimmed = value.strip()
        if trimmed:
            return trimmed
    return None


def build_title_segments(
    record: Optional[Dict[str, Any]],
    *,
    zone_code: str,
    ark_labels: Optional[Dict[str, str]] = None,
    allowed_subfields: Optional[Set[str]] = None,
    strip_pipes: bool = False,
) -> List[TitleSegment]:
    """Build segmented title chips for a given zone, resolving ARK values to labels."""

    if not record:
        return []
    segments: List[TitleSegment] = []
    for zc, sc, value in iter_record_subfields(record):
        if zc != zone_code:
            continue
        if allowed_subfields is not None and sc not in allowed_subfields:
            continue
        if not isinstance(value, str):
            continue
        raw = value.strip()
        if not raw:
            continue
        shown = raw
        tooltip_ark: Optional[str] = None
        if looks_like_ark(raw):
            tooltip_ark = raw
            if ark_labels:
                mapped = ark_labels.get(raw) or ark_labels.get(raw.lower())
                if mapped:
                    shown = mapped
        if strip_pipes:
            shown = shown.replace("|", "")
        segments.append(TitleSegment(code=sc, label=_segment_label(sc), value=shown, ark=tooltip_ark))
    return segments


def build_expression_title_segments(
    record: Optional[Dict[str, Any]],
    *,
    ark_labels: Optional[Dict[str, str]] = None,
) -> List[TitleSegment]:
    """Build expression title chips from 140, with the 140$3 label first."""

    if not record:
        return []
    zone_140 = next((z for z in _iter_zones(record) if str(z.get("code")) == "140"), None)
    if not zone_140:
        return []

    parent_segment: Optional[TitleSegment] = None
    modifier_segments: List[TitleSegment] = []
    for sub in _subzones(zone_140):
        raw_code = str(sub.get("code", "") or "")
        code = _subfield_code(raw_code)
        if code == "9":
            continue
        value = str(sub.get("valeur", "") or "").strip()
        if not value:
            continue
        if code == "3" and parent_segment is None:
            shown = value
            if ark_labels:
                mapped = ark_labels.get(value) or ark_labels.get(value.lower())
                if mapped:
                    shown = mapped
            parent_segment = TitleSegment(
                code=raw_code,
                label=_segment_label(raw_code),
                value=shown,
                ark=value if looks_like_ark(value) else None,
            )
            continue
        modifier_segments.append(
            TitleSegment(
                code=raw_code,
                label=_segment_label(raw_code),
                value=value,
                ark=value if looks_like_ark(value) else None,
            )
        )

    segments: List[TitleSegment] = []
    if parent_segment:
        segments.append(parent_segment)
    segments.extend(modifier_segments)
    return segments


def build_label_from_record(
    *,
    type_raw: str,
    type_norm: str,
    record: Dict[str, Any],
    resolve_ark_label: Optional[Callable[[str], Optional[str]]] = None,
) -> Optional[str]:
    """Compute a human label for an entity from its record.

    `resolve_ark_label` enables recursive resolution for `$3` references
    (work/expression labels), mirroring `ark_labels.build_label_from_entity`.
    """

    type_name = _normalize_type_name(type_raw) or _normalize_type_name(type_norm)

    def _resolve(ark: str) -> Optional[str]:
        if not resolve_ark_label:
            return None
        return resolve_ark_label(ark)

    if type_name == "oeuvre" or type_norm == "oeuvre":
        zones = [z for z in _iter_zones(record) if str(z.get("code")) == "150"]
        if zones:
            parts: List[str] = []
            for sub in _subzones(zones[0]):
                raw_code = str(sub.get("code", "") or "")
                code = _subfield_code(raw_code)
                if code == "9":
                    continue
                value = str(sub.get("valeur", "") or "").strip()
                if not value:
                    continue
                if code == "3":
                    resolved = _resolve(value)
                    value = resolved or value
                parts.append(value)
            if parts:
                return " ".join(parts)
        return _first_sub_value(record, "001", "001$a")

    if type_name.startswith("expression") or type_norm == "expression":
        zone_140 = next((z for z in _iter_zones(record) if str(z.get("code")) == "140"), None)
        if zone_140:
            parent_label: Optional[str] = None
            modifiers: List[str] = []
            for sub in _subzones(zone_140):
                raw_code = str(sub.get("code", "") or "")
                code = _subfield_code(raw_code)
                if code == "9":
                    continue
                value = str(sub.get("valeur", "") or "").strip()
                if not value:
                    continue
                if code == "3" and parent_label is None:
                    parent_label = _resolve(value) or value
                    continue
                modifiers.append(value)
            parts: List[str] = []
            if parent_label:
                parts.append(parent_label)
            parts.extend(modifiers)
            if parts:
                return " ".join(parts)
        return _first_sub_value(record, "150", "150$a") or _first_sub_value(record, "245", "245$a")

    if type_name in {"identite publique de personne", "identité publique de personne", "personne"} or type_norm == "personne":
        parts = [
            _first_sub_value(record, "100", "100$a"),
            _first_sub_value(record, "100", "100$m"),
            _first_sub_value(record, "100", "100$d"),
        ]
        return " ".join([p for p in parts if p]) or None

    if type_name == "collectivite" or type_name == "collectivité" or type_norm == "collectivite":
        main = _first_sub_value(record, "110", "110$a")
        qualifier = _first_sub_value(record, "110", "110$q")
        if main and qualifier:
            return f"{main} — {qualifier}"
        return main

    if "famille" in type_name or type_norm == "famille":
        parts = [
            _first_sub_value(record, "120", "120$a"),
            _first_sub_value(record, "120", "120$m"),
            _first_sub_value(record, "120", "120$e"),
        ]
        return " ".join([p for p in parts if p]) or None

    if type_name.startswith("manifestation") or type_norm == "manifestation":
        return _first_sub_value(record, "245", "245$a")

    if "valeur controlee" in type_name or "valeur contrôlée" in type_name or type_norm == "valeur controlee":
        return _first_sub_value(record, "169", "169$a")

    if type_name == "marque":
        return _first_sub_value(record, "163", "163$a")

    if type_name == "concept dewey":
        main = _first_sub_value(record, "186", "186$i")
        subtitle = _first_sub_value(record, "186", "186$a")
        if main and subtitle:
            return f"{main} — {subtitle}"
        return main or subtitle

    return None


@dataclass(frozen=True)
class EntityRow:
    """Minimal entity view for label resolution."""

    ark: str
    type_raw: str
    type_norm: str
    record: Dict[str, Any]


def resolve_ark_labels(
    *,
    dataset_id: str,
    arks: Sequence[str],
    fetch_entity: Callable[[str], Optional[EntityRow]],
) -> Dict[str, str]:
    """Resolve a set of ARKs to display labels, following `ark_labels.py` rules."""

    cache: Dict[str, str] = {}

    def _label_for(ark: str) -> Optional[str]:
        if not ark:
            return None
        key = ark
        if key in cache:
            return cache[key]
        row = fetch_entity(ark)
        if not row:
            cache[key] = ark
            return ark

        label = build_label_from_record(
            type_raw=row.type_raw,
            type_norm=row.type_norm,
            record=row.record,
            resolve_ark_label=_label_for,
        )
        cache[key] = label or ark
        return cache[key]

    labels: Dict[str, str] = {}
    for ark in arks:
        if not ark:
            continue
        label = _label_for(ark)
        if not label:
            continue
        labels[ark] = label
        lower = ark.lower()
        if lower != ark:
            labels[lower] = label
    return labels
