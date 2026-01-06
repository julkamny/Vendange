"""Helpers to compute relationship + media badges from Postgres JSON records."""

from __future__ import annotations

import unicodedata
from typing import Dict, Iterable, List, Mapping, Optional, Sequence, Set

from data_curation.api.db_shared import relation_predicate, sanitize_subfield_code
from data_curation.api.pg.record_labeling import iter_record_subfields
from data_curation.api.pg.session import db_session, statement_timeout
from data_curation.api.schemas import CountStats, EntitySummary, MediaKind, RelationshipStats


GENERAL_RELATIONSHIP_CODES: Dict[str, Sequence[str]] = {
    "oeuvre": (
        "500",
        "501",
        "506",
        "509",
        "50N",
        "54T",
        "550",
        "551",
        "552",
        "553",
        "554",
        "555",
        "556",
        "557",
        "559",
        "55A",
        "55B",
        "55C",
        "55E",
        "55F",
        "55M",
        "55P",
        "55R",
        "55S",
        "55Z",
    ),
    "expression": ("501", "506", "509", "50N", "540", "541", "542", "543", "544", "547", "54C", "54P", "54T"),
    "manifestation": ("501", "506", "509", "50N", "530", "531", "532", "533", "534", "535", "536", "537", "538", "53M"),
}

MEDIA_MAP: Dict[str, Dict[str, str]] = {
    "texte": {"emoji": "📖", "label": "Texte"},
    "texte note": {"emoji": "📝", "label": "Texte noté"},
    "image fixe": {"emoji": "🖼️", "label": "Image fixe"},
    "image animee": {"emoji": "🎬", "label": "Image animée"},
    "parole enoncee": {"emoji": "🗣️", "label": "Parole énoncée"},
    "musique": {"emoji": "🎵", "label": "Musique"},
    "musique executee": {"emoji": "🎶", "label": "Musique exécutée"},
    "musique notee": {"emoji": "🎼", "label": "Musique notée"},
    "expression performative": {"emoji": "🎭", "label": "Expression performative"},
}


def _normalize_label(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value or "")
    normalized = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    return normalized.lower().strip()


AGGREGATE_CONTROLLED_LABEL = _normalize_label("agrégat éditorial")
AGGREGATE_MEDIA_KIND = {"emoji": "🧺", "label": "Agrégat éditorial"}
AGENT_FIELD_CODES: Set[str] = {"700", "701", "702", "710", "711", "712"}


def _first_controlled_label(record: Optional[dict]) -> Optional[str]:
    if not record:
        return None
    for zone_code, sub_code, value in iter_record_subfields(record):
        if zone_code != "169" or sub_code != "169$a":
            continue
        if isinstance(value, str):
            trimmed = value.strip()
            if trimmed:
                return trimmed
    return None


def count_general_relationships(record: Optional[dict], type_norm: str) -> int:
    """Count distinct 5XX `$3` targets for the given record type."""
    if not record or not type_norm:
        return 0
    codes = GENERAL_RELATIONSHIP_CODES.get(type_norm.lower())
    if not codes:
        return 0
    related: Set[str] = set()
    for zone_code, sub_code, value in iter_record_subfields(record):
        if zone_code not in codes:
            continue
        if sub_code not in {f"{zone_code}$3", f"{zone_code}s3"}:
            continue
        if not isinstance(value, str):
            continue
        trimmed = value.strip()
        if trimmed:
            related.add(trimmed)
    return len(related)


def count_agent_links(record: Optional[dict]) -> int:
    """Count distinct agent $3 targets across 7XX fields."""
    if not record:
        return 0
    related: Set[str] = set()
    for zone_code, sub_code, value in iter_record_subfields(record):
        if zone_code not in AGENT_FIELD_CODES:
            continue
        if sub_code not in {f"{zone_code}$3", f"{zone_code}s3"}:
            continue
        if not isinstance(value, str):
            continue
        trimmed = value.strip()
        if trimmed:
            related.add(trimmed)
    return len(related)


def collect_media_reference_arks(records: Iterable[Optional[dict]]) -> Set[str]:
    """Collect ARKs from 051$a and 010$g to resolve media kinds."""
    arks: Set[str] = set()
    for record in records:
        if not record:
            continue
        for zone_code, sub_code, value in iter_record_subfields(record):
            if zone_code == "051" and sub_code == "051$a":
                if isinstance(value, str) and value.strip():
                    arks.add(value.strip())
            elif zone_code == "010" and sub_code == "010$g":
                if isinstance(value, str) and value.strip():
                    arks.add(value.strip())
    return arks


def fetch_controlled_value_labels(dataset_id: str, arks: Sequence[str]) -> Dict[str, str]:
    """Return a mapping of ARK -> 169$a labels for controlled values."""
    if not arks:
        return {}
    labels: Dict[str, str] = {}
    with db_session() as conn, statement_timeout(conn, 5000):
        rows = conn.execute(
            """
            SELECT ark, record
            FROM entity
            WHERE dataset_id=%s AND ark = ANY(%s)
            """,
            (dataset_id, list(arks)),
        ).fetchall()
    for row in rows:
        ark = row.get("ark")
        record = row.get("record")
        record_dict = record if isinstance(record, dict) else None
        if not ark or not record_dict:
            continue
        label = _first_controlled_label(record_dict)
        if not label:
            continue
        labels[ark] = label
        lower = ark.lower()
        if lower != ark:
            labels[lower] = label
    return labels


def _is_editorial_aggregate(record: dict, controlled_labels: Mapping[str, str]) -> bool:
    for zone_code, sub_code, value in iter_record_subfields(record):
        if zone_code != "010" or sub_code != "010$g":
            continue
        if not isinstance(value, str):
            continue
        ark = value.strip()
        if not ark:
            continue
        label = controlled_labels.get(ark) or controlled_labels.get(ark.lower())
        if not label:
            continue
        if _normalize_label(label) == AGGREGATE_CONTROLLED_LABEL:
            return True
    return False


def extract_media_kinds(record: Optional[dict], controlled_labels: Mapping[str, str]) -> List[MediaKind]:
    """Extract media kinds from 051$a (plus editorial aggregate via 010$g)."""
    if not record:
        return []
    kinds: List[MediaKind] = []
    if _is_editorial_aggregate(record, controlled_labels):
        kinds.append(
            MediaKind(
                kind_code=_normalize_label(AGGREGATE_MEDIA_KIND["label"]),
                emoji=AGGREGATE_MEDIA_KIND["emoji"],
                label=AGGREGATE_MEDIA_KIND["label"],
            )
        )
    by_emoji: Dict[str, MediaKind] = {}
    for zone_code, sub_code, value in iter_record_subfields(record):
        if zone_code != "051" or sub_code != "051$a":
            continue
        if not isinstance(value, str):
            continue
        ark = value.strip()
        if not ark:
            continue
        label = controlled_labels.get(ark) or controlled_labels.get(ark.lower())
        if not label:
            continue
        normalized = _normalize_label(label)
        definition = MEDIA_MAP.get(normalized)
        if not definition:
            continue
        if definition["emoji"] not in by_emoji:
            by_emoji[definition["emoji"]] = MediaKind(
                kind_code=normalized,
                emoji=definition["emoji"],
                label=definition["label"],
            )
    return kinds + list(by_emoji.values())


def incoming_relationship_counts(dataset_id: str, target_arks: Sequence[str]) -> Dict[str, int]:
    """Count incoming general-relationship links per target ARK."""
    if not target_arks:
        return {}
    predicates = [
        relation_predicate(sanitize_subfield_code(f"{code}$3"))
        for codes in GENERAL_RELATIONSHIP_CODES.values()
        for code in codes
    ]
    with db_session() as conn, statement_timeout(conn, 5000):
        rows = conn.execute(
            """
            SELECT tgt_ark, count(DISTINCT src_entity_id) AS cnt
            FROM rel_edge
            WHERE dataset_id=%s AND tgt_ark = ANY(%s) AND predicate_iri = ANY(%s)
            GROUP BY tgt_ark
            """,
            (dataset_id, list(target_arks), predicates),
        ).fetchall()
    return {row["tgt_ark"]: row["cnt"] for row in rows}


def build_entity_summary(
    *,
    record: Optional[dict],
    type_norm: str,
    ark: Optional[str],
    counts: Optional[CountStats],
    incoming_counts: Mapping[str, int],
    controlled_labels: Mapping[str, str],
) -> Optional[EntitySummary]:
    """Build an EntitySummary with counts + relationship/media badges when possible."""
    if not record and counts is None:
        return None
    summary_counts = counts
    if record:
        agent_count = count_agent_links(record)
        if summary_counts is None and agent_count > 0:
            summary_counts = CountStats(agents=agent_count)
        elif summary_counts is not None:
            summary_counts = CountStats(
                expressions=summary_counts.expressions,
                manifestations=summary_counts.manifestations,
                agents=agent_count,
            )
    summary = EntitySummary(counts=summary_counts)
    if record:
        summary.relationships = RelationshipStats(
            outgoing=count_general_relationships(record, type_norm),
            incoming=incoming_counts.get(ark, 0) if ark else 0,
        )
        summary.media_kinds = extract_media_kinds(record, controlled_labels)
    return summary
