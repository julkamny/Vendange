from __future__ import annotations

import csv
import io
import json
import sys
from typing import Iterable, List, Optional, Sequence

from pyoxigraph import Literal, NamedNode, Quad

from . import datasets
from .db_shared import (
    AFFECTED_BY_CURATION_PROP,
    COMPACT_FIELD_CODES,
    FIELD_COMPACT_VALUE_PROP,
    FIELD_CODE_PROP,
    FieldRow,
    HAS_FIELD,
    HAS_SUBFIELD,
    IngestionStats,
    Intermarc,
    META_GRAPH,
    META_DATASET,
    PROP_ARK,
    PROP_RECORD_ID,
    PROP_DATASET_LABEL,
    PROP_SOURCE_DATASET,
    PROP_TYPE_RAW,
    ParsedRecord,
    RDF_TYPE,
    SUBFIELD_CODE_PROP,
    SUBFIELD_VALUE_PROP,
    SubfieldRow,
    EdgeRow,
    class_for_type,
    emit_quads,
    field_blank_node,
    looks_like_ark,
    record_graph,
    record_iri,
    relation_ark_predicate,
    relation_predicate,
    sanitize_subfield_code,
    subfield_blank_node,
)
from .db_store import _STORE_LOCK, get_store_locked, reset_dataset_store

csv.field_size_limit(sys.maxsize)


def _normalize_header_name(value: str) -> str:
    cleaned = (
        value.replace("\ufeff", "")
        .replace("\"", "")
        .translate({code: None for code in range(32)})
    )
    return cleaned.strip().lower()


def _guess_delimiter(text: str) -> str:
    first_line = text.splitlines()[0] if text else ""
    semi = first_line.count(";")
    comma = first_line.count(",")
    if semi == 0 and comma == 0:
        return ";"
    return ";" if semi >= comma else ","


def _build_header_lookup(headers: Sequence[str]) -> dict[str, int]:
    lookup: dict[str, int] = {}
    for idx, header in enumerate(headers):
        normalized = _normalize_header_name(header)
        if not normalized or normalized in lookup:
            continue
        lookup[normalized] = idx
    return lookup


def _extract_ark(intermarc: Intermarc) -> Optional[str]:
    for zone in intermarc.get_zone("001"):
        for sub in zone.sousZones:
            if sub.code == "001$a" and sub.valeur:
                trimmed = str(sub.valeur).strip()
                if trimmed:
                    return trimmed
    return None


def _parse_csv_bytes(data: bytes) -> List[ParsedRecord]:
    text = data.decode("utf-8-sig")
    reader = csv.reader(io.StringIO(text), delimiter=_guess_delimiter(text), quotechar='"')
    rows = list(reader)
    if not rows:
        return []

    headers = rows[0]
    header_lookup = _build_header_lookup(headers)
    try:
        id_idx = header_lookup["id_entitelrm"]
        type_idx = header_lookup["type_entite"]
        inter_idx = header_lookup["intermarc"]
    except KeyError as exc:  # pragma: no cover - defensive guard
        available = ", ".join(sorted(header_lookup.keys())) or "none"
        raise ValueError(f"Missing expected column in CSV: {exc}. Available: {available}") from exc

    parsed: List[ParsedRecord] = []
    for row in rows[1:]:
        if len(row) <= max(id_idx, type_idx, inter_idx):
            continue
        record_id = row[id_idx].strip()
        type_raw = row[type_idx].strip()
        intermarc_raw = row[inter_idx]
        if not record_id or not intermarc_raw:
            continue
        try:
            intermarc = Intermarc.from_json_string(intermarc_raw)
        except json.JSONDecodeError:
            continue
        ark = _extract_ark(intermarc)
        parsed.append(
            ParsedRecord(
                id=record_id,
                type_raw=type_raw,
                ark=ark,
                intermarc_raw=intermarc_raw,
                intermarc=intermarc,
            )
        )
    return parsed


def _extract_rows(record: ParsedRecord) -> tuple[List[FieldRow], List[EdgeRow]]:
    fields: List[FieldRow] = []
    edges: List[EdgeRow] = []
    for zone_index, zone in enumerate(record.intermarc.zones):
        zone_code = zone.code or ""
        normalized_code = zone_code.strip().upper()
        field_node = field_blank_node(record.id, zone_index)
        subfields: List[SubfieldRow] = []
        for sub_index, sub in enumerate(zone.sousZones):
            raw_code = sub.code or ""
            code = sanitize_subfield_code(raw_code)
            sub_node = subfield_blank_node(record.id, zone_index, sub_index)
            if not sub.valeur:
                continue
            subfields.append(
                SubfieldRow(
                    node=sub_node,
                    code=code,
                    raw_code=raw_code,
                    value=str(sub.valeur),
                    affected_by_curation=sub.affected_by_curation,
                )
            )
            if not looks_like_ark(str(sub.valeur)):
                continue
            if sub.code and "$3" in sub.code:
                edges.append(
                    EdgeRow(
                        src_id=record.id,
                        relation_code=sub.code,
                        dst_ark=str(sub.valeur),
                        dst_id=None,
                    )
                )
        compact_value: Optional[str] = None
        is_compact = normalized_code in COMPACT_FIELD_CODES
        if is_compact:
            compact_value = zone.field_compact_value
        fields.append(
            FieldRow(
                node=field_node,
                code=zone_code,
                subfields=subfields,
                compact_value=compact_value,
                affected_by_curation=zone.affected_by_curation,
            )
        )
    return fields, edges


def _build_record_quads(record: ParsedRecord, ark_to_id: dict[str | None, str]) -> Iterable[Quad]:
    subject = record_iri(record.id)
    graph = record_graph(record.id)
    entity_class = class_for_type(record.type_raw)

    yield from emit_quads(subject, RDF_TYPE, entity_class, graph)
    yield from emit_quads(subject, PROP_RECORD_ID, Literal(record.id), graph)
    if record.type_raw:
        yield from emit_quads(subject, PROP_TYPE_RAW, Literal(record.type_raw), graph)
    if record.ark:
        yield from emit_quads(subject, PROP_ARK, Literal(record.ark), graph)
        yield from emit_quads(subject, PROP_SOURCE_DATASET, META_DATASET, graph)

    fields, edges = _extract_rows(record)
    for field in fields:
        yield from emit_quads(subject, HAS_FIELD, field.node, graph)
        if field.code:
            yield from emit_quads(field.node, FIELD_CODE_PROP, Literal(field.code), graph)
        if field.compact_value is not None:
            yield from emit_quads(field.node, FIELD_COMPACT_VALUE_PROP, Literal(field.compact_value), graph)
        if field.affected_by_curation:
            yield from emit_quads(
                field.node,
                AFFECTED_BY_CURATION_PROP,
                Literal(field.affected_by_curation),
                graph,
            )
        if field.compact_value is None:
            for sub in field.subfields:
                yield from emit_quads(field.node, HAS_SUBFIELD, sub.node, graph)
                if sub.code:
                    yield from emit_quads(sub.node, SUBFIELD_CODE_PROP, Literal(sub.code), graph)
                if sub.value:
                    yield from emit_quads(sub.node, SUBFIELD_VALUE_PROP, Literal(sub.value), graph)
                if sub.affected_by_curation:
                    yield from emit_quads(
                        sub.node,
                        AFFECTED_BY_CURATION_PROP,
                        Literal(sub.affected_by_curation),
                        graph,
                    )

    for edge in edges:
        target_id = edge.dst_id or ark_to_id.get(edge.dst_ark)
        target_node = None
        if target_id:
            target_node = record_iri(target_id)
        elif edge.dst_ark:
            target_node = NamedNode(edge.dst_ark)
        if target_node is not None:
            yield from emit_quads(subject, relation_predicate(edge.relation_code), target_node, graph)
        if edge.dst_ark:
            yield from emit_quads(subject, relation_ark_predicate(edge.relation_code), Literal(edge.dst_ark), graph)


def _build_dataset_quads(
    records: Sequence[ParsedRecord],
    ark_to_id: dict[str | None, str],
    dataset_label: Optional[str],
) -> Iterable[Quad]:
    for record in records:
        yield from _build_record_quads(record, ark_to_id)
    if dataset_label:
        yield from emit_quads(META_DATASET, PROP_DATASET_LABEL, Literal(dataset_label), META_GRAPH)


def _build_record_from_payload(record_id: str, type_raw: str, intermarc_json: str) -> ParsedRecord:
    intermarc = Intermarc.from_json_string(intermarc_json)
    return ParsedRecord(
        id=record_id,
        type_raw=type_raw,
        ark=_extract_ark(intermarc),
        intermarc_raw=intermarc_json,
        intermarc=intermarc,
    )


def ingest_csv(
    content: bytes,
    dataset_id: str,
    *,
    dataset_label: Optional[str] = None,
) -> IngestionStats:
    records = _parse_csv_bytes(content)
    with _STORE_LOCK:
        reset_dataset_store(dataset_id)
        if not records:
            return IngestionStats(records=0, quads=0)

        ark_to_id = {record.ark: record.id for record in records if record.ark}
        store = get_store_locked(dataset_id)
        quads = list(_build_dataset_quads(records, ark_to_id, dataset_label))
        store.bulk_extend(quads)
        store.flush()
    datasets.touch_dataset(dataset_id)
    return IngestionStats(records=len(records), quads=len(quads))
