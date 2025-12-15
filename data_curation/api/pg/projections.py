"""Projection helpers for the Postgres hybrid model."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import List, Optional

from data_curation.api.db_shared import looks_like_ark, sanitize_subfield_code
from data_curation.api.entity_labels import agent_primary_label, manifestation_title, normalize_type, title_of
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


def _entity_view(parsed: ParsedRecord):
    class _View:
        def __init__(self, p: ParsedRecord) -> None:
            self.id_entitelrm = p.record_id
            self.type_entite = p.type_raw
            self.intermarc = p.intermarc

    return _View(parsed)


def compute_label(parsed: ParsedRecord) -> tuple[str, Optional[str]]:
    view = _entity_view(parsed)
    label: Optional[str] = None
    type_norm = normalize_type(parsed.type_raw)
    if type_norm in {"oeuvre", "expression"}:
        label = title_of(view)
    elif type_norm == "manifestation":
        label = manifestation_title(view)
    elif type_norm in {"personne", "collectivite", "famille"}:
        label = agent_primary_label(view)
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
