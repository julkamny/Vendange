"""Projection helpers for the Postgres hybrid model."""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

import json

from data_curation.api.db_shared import looks_like_ark, sanitize_subfield_code
from data_curation.api.entity_labels import normalize_type
from data_curation.api.pg.record_labeling import build_label_from_record
from data_curation.models import Intermarc
from data_curation.utils.text_norm import fold_diacritics


@dataclass
class ParsedRecord:
    record_id: str
    type_raw: str
    type_norm: str
    ark: Optional[str]
    intermarc: Intermarc
    intermarc_raw: str


def compute_label(parsed: ParsedRecord) -> tuple[str, Optional[str]]:
    label: Optional[str] = None
    type_norm = normalize_type(parsed.type_raw)
    try:
        record = json.loads(parsed.intermarc_raw)
    except Exception:
        record = {"zones": []}
    label = build_label_from_record(type_raw=parsed.type_raw, type_norm=type_norm, record=record)
    label = label or parsed.ark or parsed.record_id
    sort_key = fold_diacritics(label).lower() if label else None
    return label, sort_key


def extract_edges(parsed: ParsedRecord) -> List[dict]:
    edges: List[dict] = []
    for zone in parsed.intermarc.zones:
        for sub in zone.sousZones:
            code = sub.code or ""
            if ("$3" not in code and "$0" not in code) or not sub.valeur:
                continue
            val = str(sub.valeur).strip()
            if not looks_like_ark(val):
                continue
            edges.append(
                {
                    "relation_code": sanitize_subfield_code(code),
                    "tgt_ark": val,
                }
            )
    return edges


def extract_cluster_memberships(parsed: ParsedRecord, anchor_entity_id: int) -> List[dict]:
    rows: List[dict] = []
    anchor_ark = parsed.ark
    if not anchor_ark:
        return rows
    for zone in parsed.intermarc.get_zone("90F"):
        target = next((s.valeur for s in zone.sousZones if s.code == "90F$3"), None)
        note = next((s.valeur for s in zone.sousZones if s.code == "90F$q"), None)
        if target and isinstance(target, str):
            rows.append(
                {
                    "anchor_entity_id": anchor_entity_id,
                    "anchor_ark": anchor_ark,
                    "member_ark": target.strip(),
                    "note": note.strip() if isinstance(note, str) else None,
                }
            )
    return rows


def compute_fts(parsed: ParsedRecord, label: str) -> str:
    pieces = [label]
    if parsed.ark:
        pieces.append(parsed.ark)
    pieces.append(parsed.type_norm)
    try:
        obj = json.loads(parsed.intermarc_raw)
        pieces.append(json.dumps(obj, ensure_ascii=False))
    except Exception:
        pieces.append(parsed.intermarc_raw)
    return " ".join(pieces)


def extract_field_rows(parsed: ParsedRecord) -> list[tuple[int, str]]:
    """Extract (field_idx, tag) pairs from the Intermarc model.

    field_idx and sub_idx are 1-based to match the legacy JSON view ordinality,
    keeping the Ontop IRIs stable: vend:field/{dataset}/{entity}/{field_idx}.
    """

    rows: list[tuple[int, str]] = []
    for field_idx, zone in enumerate(parsed.intermarc.zones, start=1):
        if not zone.code:
            continue
        rows.append((field_idx, zone.code))
    return rows


def extract_subfield_rows(parsed: ParsedRecord) -> list[tuple[int, int, str, str, str]]:
    """Extract (field_idx, sub_idx, code_raw, code_norm, value) rows for Ontop."""

    rows: list[tuple[int, int, str, str, str]] = []
    for field_idx, zone in enumerate(parsed.intermarc.zones, start=1):
        if not zone.code:
            continue
        for sub_idx, sub in enumerate(zone.sousZones, start=1):
            code_raw = sub.code or ""
            if not code_raw:
                continue
            value = "" if sub.valeur is None else str(sub.valeur)
            rows.append((field_idx, sub_idx, code_raw, sanitize_subfield_code(code_raw), value))
    return rows
