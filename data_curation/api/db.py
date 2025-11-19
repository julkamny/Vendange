"""Oxigraph-based ingestion and SPARQL query helpers for the Vendange search API."""

from __future__ import annotations

import csv
import io
import json
import shutil
import sys
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple
from urllib.parse import quote

from pyoxigraph import BlankNode, DefaultGraph, Literal, NamedNode, QuerySolution, QuerySolutions, Quad, Store

from . import datasets
from ..models import Entity, Intermarc, Zone, SousZone
from ..utils.text_norm import fold_diacritics

csv.field_size_limit(sys.maxsize)

_STORE_LOCK = threading.RLock()
_STORE_CACHE: dict[str, Store] = {}

RDF_TYPE = NamedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type")
XSD_NS = "http://www.w3.org/2001/XMLSchema#"
XSD_BOOLEAN = NamedNode(f"{XSD_NS}boolean")
XSD_INTEGER_TYPES = {
    f"{XSD_NS}integer",
    f"{XSD_NS}int",
    f"{XSD_NS}long",
    f"{XSD_NS}short",
    f"{XSD_NS}byte",
    f"{XSD_NS}nonNegativeInteger",
    f"{XSD_NS}positiveInteger",
    f"{XSD_NS}nonPositiveInteger",
    f"{XSD_NS}negativeInteger",
    f"{XSD_NS}unsignedLong",
    f"{XSD_NS}unsignedInt",
    f"{XSD_NS}unsignedShort",
    f"{XSD_NS}unsignedByte",
}
XSD_DECIMAL_TYPES = {
    f"{XSD_NS}decimal",
    f"{XSD_NS}double",
    f"{XSD_NS}float",
}

BASE_ENTITY_NS = "https://vendange.bnf.fr/entity/"
BASE_GRAPH_NS = "https://vendange.bnf.fr/graph/"
FIELD_NS = "https://vendange.bnf.fr/field/"
RELATION_NS = "https://vendange.bnf.fr/relation/"
RELATION_ARK_NS = "https://vendange.bnf.fr/relation_ark/"
PROPERTY_NS = "https://vendange.bnf.fr/property/"
CLASS_NS = "https://vendange.bnf.fr/class/"
HAS_FIELD = NamedNode("https://vendange.bnf.fr/hasField")
HAS_SUBFIELD = NamedNode("https://vendange.bnf.fr/hasSubfield")
FIELD_CODE_PROP = NamedNode("https://vendange.bnf.fr/fieldCode")
FIELD_COMPACT_VALUE_PROP = NamedNode("https://vendange.bnf.fr/fieldCompactValue")
SUBFIELD_CODE_PROP = NamedNode("https://vendange.bnf.fr/subfieldCode")
SUBFIELD_VALUE_PROP = NamedNode("https://vendange.bnf.fr/subfieldValue")
AFFECTED_BY_CURATION_PROP = NamedNode("https://vendange.bnf.fr/property/affectedByCuration")
META_GRAPH = NamedNode(f"{BASE_GRAPH_NS}metadata")
META_DATASET = NamedNode(f"{BASE_ENTITY_NS}dataset")
PROP_ARK = NamedNode(f"{PROPERTY_NS}ark")
PROP_RECORD_ID = NamedNode(f"{PROPERTY_NS}record_id")
PROP_TYPE_RAW = NamedNode(f"{PROPERTY_NS}type_raw")
PROP_DATASET_LABEL = NamedNode(f"{PROPERTY_NS}dataset_label")
PROP_SOURCE_DATASET = NamedNode(f"{PROPERTY_NS}source_dataset")

TYPE_CLASS_MAP = {
    "oeuvre": NamedNode(f"{CLASS_NS}Work"),
    "expression": NamedNode(f"{CLASS_NS}Expression"),
    "manifestation": NamedNode(f"{CLASS_NS}Manifestation"),
    "identite publique de personne": NamedNode(f"{CLASS_NS}PublicIdentity"),
    "collectivite": NamedNode(f"{CLASS_NS}Collective"),
    "valeur controlee": NamedNode(f"{CLASS_NS}ControlledValue"),
    "concept dewey": NamedNode(f"{CLASS_NS}DeweyConcept"),
    "concept": NamedNode(f"{CLASS_NS}Concept"),
    "evenement": NamedNode(f"{CLASS_NS}Event"),
    "genre / forme": NamedNode(f"{CLASS_NS}GenreForm"),
    "laps de temps": NamedNode(f"{CLASS_NS}TimeLapse"),
    "lieu": NamedNode(f"{CLASS_NS}Place"),
    "marque": NamedNode(f"{CLASS_NS}Brand"),
    "famille": NamedNode(f"{CLASS_NS}Family"),
}
DEFAULT_ENTITY_CLASS = NamedNode(f"{CLASS_NS}Entity")
COMPACT_FIELD_CODES = {"990", "907", "90H", "901", "991"}
FIELD_BNODE_PREFIX = "b"


@dataclass
class ParsedRecord:
    id: str
    type_raw: str
    ark: Optional[str]
    intermarc_raw: str
    intermarc: Intermarc


@dataclass
class IngestionStats:
    records: int
    quads: int


@dataclass
class SubfieldRow:
    node: BlankNode
    code: str
    raw_code: str
    value: str
    affected_by_curation: Optional[str] = None


@dataclass
class FieldRow:
    node: BlankNode
    code: str
    subfields: List[SubfieldRow]
    compact_value: Optional[str] = None
    affected_by_curation: Optional[str] = None


@dataclass
class EdgeRow:
    src_id: str
    relation_code: str
    dst_ark: str
    dst_id: Optional[str]


def initialize_storage() -> None:
    """Ensure the datasets root directory exists."""

    datasets.ensure_root()


def _dataset_store_path(dataset_id: str) -> Path:
    return datasets.dataset_directory(dataset_id)


def close_dataset(dataset_id: str) -> None:
    """Flush and drop the cached store for the given dataset."""

    with _STORE_LOCK:
        store = _STORE_CACHE.pop(dataset_id, None)
        if store is not None:
            store.flush()


def _get_store_locked(dataset_id: str) -> Store:
    store = _STORE_CACHE.get(dataset_id)
    if store is None:
        path = _dataset_store_path(dataset_id)
        path.mkdir(parents=True, exist_ok=True)
        store = Store(str(path))
        _STORE_CACHE[dataset_id] = store
    return store


def _record_iri(record_id: str) -> NamedNode:
    return NamedNode(f"{BASE_ENTITY_NS}{quote(record_id, safe='')}")


def _record_graph(record_id: str) -> NamedNode:
    return NamedNode(f"{BASE_GRAPH_NS}{quote(record_id, safe='')}")


def _field_predicate(code: str) -> NamedNode:
    return NamedNode(f"{FIELD_NS}{quote(code, safe='$')}")


def _relation_predicate(code: str) -> NamedNode:
    return NamedNode(f"{RELATION_NS}{quote(code, safe='')}")


def _relation_ark_predicate(code: str) -> NamedNode:
    return NamedNode(f"{RELATION_ARK_NS}{quote(code, safe='')}")


def _field_sort_key(record_id: str, node: BlankNode) -> tuple[int, str]:
    value = node.value
    prefix = f"{FIELD_BNODE_PREFIX}{record_id}-f-"
    if value.startswith(prefix):
        remainder = value[len(prefix) :]
        segment = remainder.split("-", 1)[0]
        try:
            return int(segment), value
        except ValueError:
            pass
    return sys.maxsize, value


def _subfield_sort_key(node: BlankNode) -> tuple[int, str]:
    value = node.value
    marker = "-s-"
    if marker in value:
        suffix = value.rsplit(marker, 1)[1]
        segment = suffix.split("-", 1)[0]
        try:
            return int(segment), value
        except ValueError:
            pass
    return sys.maxsize, value


def _field_blank_node(record_id: str, field_index: int) -> BlankNode:
    identifier = f"{FIELD_BNODE_PREFIX}{record_id}-f-{field_index}"
    return BlankNode(identifier)


def _subfield_blank_node(record_id: str, field_index: int, sub_index: int) -> BlankNode:
    identifier = f"{FIELD_BNODE_PREFIX}{record_id}-f-{field_index}-s-{sub_index}"
    return BlankNode(identifier)


def _emit_quads(
    subject: NamedNode | BlankNode,
    predicate: NamedNode,
    obj: object,
    graph: NamedNode,
) -> Iterable[Quad]:
    yield Quad(subject, predicate, obj, graph)


def _canonical_type_key(value: str) -> str:
    return fold_diacritics(value or "").lower().strip()


def _class_for_type(value: str) -> NamedNode:
    return TYPE_CLASS_MAP.get(_canonical_type_key(value), DEFAULT_ENTITY_CLASS)


def _looks_like_ark(value: str) -> bool:
    return value.startswith("ark:/")


def _sanitize_subfield_code(code: str) -> str:
    return (code or "").replace("$", "s")


def _unsanitize_subfield_code(code: str) -> str:
    if not code:
        return code
    idx = code.find("s")
    if idx == -1:
        return code
    return f"{code[:idx]}${code[idx + 1:]}"


def _literal_first_value(
    store: Store,
    subject: object,
    predicate: NamedNode,
    graph: NamedNode | DefaultGraph | None = None,
) -> Optional[str]:
    for quad in store.quads_for_pattern(subject, predicate, None, graph):
        obj = quad.object
        if isinstance(obj, Literal):
            return obj.value
    return None


def _reset_dataset_store(dataset_id: str) -> None:
    close_dataset(dataset_id)
    path = _dataset_store_path(dataset_id)
    if path.exists():
        for child in path.iterdir():
            if child.name == "logs":
                continue
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()
    else:
        path.mkdir(parents=True, exist_ok=True)


def _directory_size(path: Path) -> int:
    if not path.exists():
        return 0
    total = 0
    for child in path.rglob("*"):
        if child.is_file() and "logs" not in child.parts:
            total += child.stat().st_size
    return total


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


def _extract_ark(intermarc: Intermarc) -> Optional[str]:
    for zone in intermarc.get_zone("001"):
        for sub in zone.sousZones:
            if sub.code == "001$a" and sub.valeur:
                trimmed = str(sub.valeur).strip()
                if trimmed:
                    return trimmed
    return None


def _extract_rows(record: ParsedRecord) -> tuple[List[FieldRow], List[EdgeRow]]:
    fields: List[FieldRow] = []
    edges: List[EdgeRow] = []
    for zone_index, zone in enumerate(record.intermarc.zones):
        zone_code = zone.code or ""
        normalized_code = zone_code.strip().upper()
        field_node = _field_blank_node(record.id, zone_index)
        subfields: List[SubfieldRow] = []
        compact_value: Optional[str] = None
        is_compact = normalized_code in COMPACT_FIELD_CODES
        if is_compact:
            compact_value = json.dumps(zone.to_dict(), ensure_ascii=False)
        for sub_index, sub in enumerate(zone.sousZones):
            raw_code = sub.code or ""
            sanitized_code = _sanitize_subfield_code(raw_code)
            raw_value = str(sub.valeur) if sub.valeur is not None else ""
            if not is_compact:
                sub_node = _subfield_blank_node(record.id, zone_index, sub_index)
                subfields.append(
                    SubfieldRow(
                        node=sub_node,
                        code=sanitized_code,
                        raw_code=raw_code,
                        value=raw_value,
                        affected_by_curation=sub.affected_by_curation,
                    )
                )
            if raw_code.endswith("$3") and _looks_like_ark(raw_value.strip()):
                edges.append(
                    EdgeRow(
                        src_id=record.id,
                        relation_code=_sanitize_subfield_code(raw_code),
                        dst_ark=raw_value.strip(),
                        dst_id=None,
                    )
                )
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


def ingest_csv(
    content: bytes,
    dataset_id: str,
    *,
    dataset_label: Optional[str] = None,
) -> IngestionStats:
    """Ingest the provided CSV content into the Oxigraph store for the given dataset."""

    records = _parse_csv_bytes(content)
    with _STORE_LOCK:
        _reset_dataset_store(dataset_id)
        if not records:
            return IngestionStats(records=0, quads=0)

        ark_to_id = {record.ark: record.id for record in records if record.ark}
        store = _get_store_locked(dataset_id)
        quads = list(_build_dataset_quads(records, ark_to_id, dataset_label))
        store.bulk_extend(quads)
        store.flush()
    datasets.touch_dataset(dataset_id)
    return IngestionStats(records=len(records), quads=len(quads))


def _build_dataset_quads(
    records: Sequence[ParsedRecord],
    ark_to_id: dict[str | None, str],
    dataset_label: Optional[str],
) -> Iterable[Quad]:
    for record in records:
        yield from _build_record_quads(record, ark_to_id)
    if dataset_label:
        yield from _emit_quads(META_DATASET, PROP_DATASET_LABEL, Literal(dataset_label), META_GRAPH)


def _build_record_quads(record: ParsedRecord, ark_to_id: dict[str | None, str]) -> Iterable[Quad]:
    subject = _record_iri(record.id)
    graph = _record_graph(record.id)
    entity_class = _class_for_type(record.type_raw)

    yield from _emit_quads(subject, RDF_TYPE, entity_class, graph)
    yield from _emit_quads(subject, PROP_RECORD_ID, Literal(record.id), graph)
    if record.type_raw:
        yield from _emit_quads(subject, PROP_TYPE_RAW, Literal(record.type_raw), graph)
    if record.ark:
        yield from _emit_quads(subject, PROP_ARK, Literal(record.ark), graph)
        yield from _emit_quads(subject, PROP_SOURCE_DATASET, META_DATASET, graph)

    fields, edges = _extract_rows(record)
    for field in fields:
        yield from _emit_quads(subject, HAS_FIELD, field.node, graph)
        if field.code:
            yield from _emit_quads(field.node, FIELD_CODE_PROP, Literal(field.code), graph)
        if field.compact_value is not None:
            yield from _emit_quads(field.node, FIELD_COMPACT_VALUE_PROP, Literal(field.compact_value), graph)
        if field.affected_by_curation:
            yield from _emit_quads(
                field.node,
                AFFECTED_BY_CURATION_PROP,
                Literal(field.affected_by_curation),
                graph,
            )
        if field.compact_value is None:
            for sub in field.subfields:
                yield from _emit_quads(field.node, HAS_SUBFIELD, sub.node, graph)
                if sub.code:
                    yield from _emit_quads(sub.node, SUBFIELD_CODE_PROP, Literal(sub.code), graph)
                if sub.value:
                    yield from _emit_quads(sub.node, SUBFIELD_VALUE_PROP, Literal(sub.value), graph)
                if sub.affected_by_curation:
                    yield from _emit_quads(
                        sub.node,
                        AFFECTED_BY_CURATION_PROP,
                        Literal(sub.affected_by_curation),
                        graph,
                    )

    for edge in edges:
        target_id = edge.dst_id or ark_to_id.get(edge.dst_ark)
        target_node: Optional[NamedNode] = None
        if target_id:
            target_node = _record_iri(target_id)
        elif edge.dst_ark:
            target_node = NamedNode(edge.dst_ark)
        if target_node is not None:
            yield from _emit_quads(subject, _relation_predicate(edge.relation_code), target_node, graph)
        if edge.dst_ark:
            yield from _emit_quads(subject, _relation_ark_predicate(edge.relation_code), Literal(edge.dst_ark), graph)


def _build_record_from_payload(record_id: str, type_raw: str, intermarc_json: str) -> ParsedRecord:
    intermarc = Intermarc.from_json_string(intermarc_json)
    return ParsedRecord(
        id=record_id,
        type_raw=type_raw,
        ark=_extract_ark(intermarc),
        intermarc_raw=intermarc_json,
        intermarc=intermarc,
    )


def update_record(dataset_id: str, record_id: str, *, type_raw: str, intermarc_json: str) -> None:
    """Update a single record graph with fresh data."""

    record = _build_record_from_payload(record_id, type_raw, intermarc_json)

    with _STORE_LOCK:
        store = _get_store_locked(dataset_id)
        ark_index = _load_ark_index(store)
        if record.ark:
            ark_index[record.ark] = record.id
        subject = _record_iri(record.id)
        graph = _record_graph(record.id)
        existing_default = list(store.quads_for_pattern(subject, None, None, None))
        for quad in existing_default:
            graph_name = getattr(quad, "graph_name", None)
            if graph_name is None or isinstance(graph_name, DefaultGraph):
                store.remove(quad)
        # Rebuild the whole named graph to keep blank node identifiers in sync with field order.
        store.clear_graph(graph)
        quads = list(_build_record_quads(record, ark_index))
        if quads:
            store.extend(quads)
        store.flush()
    datasets.touch_dataset(dataset_id)


def _load_ark_index(store: Store) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for quad in store.quads_for_pattern(None, PROP_ARK, None, None):
        if isinstance(quad.subject, NamedNode) and isinstance(quad.object, Literal):
            mapping[quad.object.value] = _record_id_from_subject(quad.subject.value)
    return mapping


def _record_id_from_subject(subject_iri: str) -> str:
    if not subject_iri.startswith(BASE_ENTITY_NS):
        return subject_iri
    return subject_iri[len(BASE_ENTITY_NS) :]


def run_sparql_query(dataset_id: str, query: str) -> tuple[List[str], List[dict[str, object]]]:
    """Execute a read-only SPARQL SELECT query and return column names with JSON-friendly rows."""

    statement = query.strip()
    if not statement:
        raise ValueError("SPARQL query cannot be empty")

    keyword = _leading_query_keyword(statement)
    if keyword.lower() != "select":
        raise ValueError("Only SPARQL SELECT queries are supported")

    with _STORE_LOCK:
        store = _get_store_locked(dataset_id)
        solutions = store.query(statement)
        if not isinstance(solutions, QuerySolutions):
            raise ValueError("Query did not return a SELECT result set")
        variables = [var.value for var in solutions.variables]
        rows = [_convert_solution(solution, variables) for solution in solutions]
    return variables, rows


def _leading_query_keyword(statement: str) -> str:
    lowered = statement.lstrip()
    lines = lowered.splitlines()
    idx = 0
    while idx < len(lines):
        line = lines[idx].strip()
        if not line or line.startswith("#"):
            idx += 1
            continue
        if line.lower().startswith("prefix ") or line.lower().startswith("base "):
            idx += 1
            continue
        for part in line.split():
            return part
        idx += 1
    return ""


def _convert_solution(solution: QuerySolution, variables: Sequence[str]) -> dict[str, object]:
    row: dict[str, object] = {}
    for variable in variables:
        term = solution[variable]
        if term is None:
            row[variable] = None
        else:
            row[variable] = _term_to_python(term)
    return row


def _term_to_python(term: object) -> object:
    if isinstance(term, NamedNode):
        return term.value
    if isinstance(term, BlankNode):
        return f"_:{term.value}"
    if isinstance(term, Literal):
        if term.language:
            return term.value
        datatype = term.datatype.value if term.datatype else ""
        if datatype in XSD_INTEGER_TYPES:
            try:
                return int(term.value)
            except ValueError:
                return term.value
        if datatype in XSD_DECIMAL_TYPES:
            try:
                return float(term.value)
            except ValueError:
                return term.value
        if datatype == XSD_BOOLEAN.value:
            return term.value.lower() in {"true", "1"}
        return term.value
    return term


def _load_record_from_store(
    store: Store,
    record_id: str,
    subject: NamedNode,
    *,
    cached_type: Optional[str] = None,
) -> ParsedRecord:
    graph = _record_graph(record_id)
    type_raw = (
        cached_type
        if cached_type is not None
        else _literal_first_value(store, subject, PROP_TYPE_RAW, graph) or ""
    )
    ark = _literal_first_value(store, subject, PROP_ARK, graph)

    field_rows: List[tuple[tuple[int, str], Zone]] = []
    for field_quad in store.quads_for_pattern(subject, HAS_FIELD, None, graph):
        field_node = field_quad.object
        if not isinstance(field_node, BlankNode):
            continue
        code = _literal_first_value(store, field_node, FIELD_CODE_PROP, graph) or ""
        field_affected = _literal_first_value(store, field_node, AFFECTED_BY_CURATION_PROP, graph)
        compact_raw = _literal_first_value(store, field_node, FIELD_COMPACT_VALUE_PROP, graph)

        if compact_raw:
            try:
                payload = json.loads(compact_raw)
            except json.JSONDecodeError:
                payload = None
            if isinstance(payload, dict):
                zone = Zone.from_dict(payload)
                if not zone.code:
                    zone.code = code
                if field_affected and not zone.affected_by_curation:
                    zone.affected_by_curation = field_affected
            else:
                zone = Zone(code=code, sousZones=[], affected_by_curation=field_affected)
        else:
            subfield_rows: List[tuple[tuple[int, str], SousZone]] = []
            for sub_quad in store.quads_for_pattern(field_node, HAS_SUBFIELD, None, graph):
                sub_node = sub_quad.object
                if not isinstance(sub_node, BlankNode):
                    continue
                sanitized_code = _literal_first_value(store, sub_node, SUBFIELD_CODE_PROP, graph) or ""
                raw_code = _unsanitize_subfield_code(sanitized_code)
                value = _literal_first_value(store, sub_node, SUBFIELD_VALUE_PROP, graph) or ""
                sub_affected = _literal_first_value(store, sub_node, AFFECTED_BY_CURATION_PROP, graph)
                order_key = _subfield_sort_key(sub_node)
                subfield_rows.append(
                    (
                        order_key,
                        SousZone(code=raw_code, valeur=value, affected_by_curation=sub_affected),
                    )
                )
            subfield_rows.sort(key=lambda item: item[0])
            zone = Zone(
                code=code,
                sousZones=[row[1] for row in subfield_rows],
                affected_by_curation=field_affected,
            )
        field_rows.append((_field_sort_key(record_id, field_node), zone))
    field_rows.sort(key=lambda item: item[0])
    intermarc = Intermarc(zones=[row[1] for row in field_rows])
    intermarc_json = intermarc.to_json_string()

    return ParsedRecord(
        id=record_id,
        type_raw=type_raw,
        ark=ark,
        intermarc_raw=intermarc_json,
        intermarc=intermarc,
    )


def _record_subjects(store: Store) -> dict[str, NamedNode]:
    subjects: dict[str, NamedNode] = {}
    for quad in store.quads_for_pattern(None, PROP_RECORD_ID, None, None):
        if not isinstance(quad.subject, NamedNode):
            continue
        if not isinstance(quad.object, Literal):
            continue
        record_id = quad.object.value
        subjects[record_id] = quad.subject
    return subjects


def load_records(
    dataset_id: str,
    *,
    types: Optional[Sequence[str]] = None,
) -> List[ParsedRecord]:
    """Return every record stored in the Oxigraph store as ParsedRecord instances."""

    requested_types: Optional[Set[str]] = None
    if types:
        requested_types = {_canonical_type_key(t) for t in types}

    with _STORE_LOCK:
        store = _get_store_locked(dataset_id)
        subjects = _record_subjects(store)
        records: List[ParsedRecord] = []
        for record_id, subject in subjects.items():
            graph = _record_graph(record_id)
            type_raw = _literal_first_value(store, subject, PROP_TYPE_RAW, graph) or ""
            if requested_types is not None and _canonical_type_key(type_raw) not in requested_types:
                continue
            record = _load_record_from_store(store, record_id, subject, cached_type=type_raw)
            records.append(record)
    return records


def load_entities(
    dataset_id: str,
    *,
    types: Optional[Sequence[str]] = None,
) -> List[Entity]:
    """Return all entities reconstructed from the Oxigraph store."""

    records = load_records(dataset_id, types=types)
    entities: List[Entity] = []
    for record in records:
        entity = Entity(record.id, record.type_raw, record.intermarc_raw)
        entity.intermarc = record.intermarc
        entities.append(entity)
    return entities


def dataset_stats(dataset_id: str) -> Dict[str, int]:
    """Return lightweight statistics describing a dataset."""

    with _STORE_LOCK:
        store = _get_store_locked(dataset_id)
        entity_count = sum(1 for _ in store.quads_for_pattern(None, PROP_RECORD_ID, None, None))
        quad_count = sum(1 for _ in store.quads_for_pattern(None, None, None, None))
    size_bytes = _directory_size(_dataset_store_path(dataset_id))
    return {
        "entityCount": entity_count,
        "quadCount": quad_count,
        "sizeBytes": size_bytes,
    }


def compact_dataset(dataset_id: str) -> None:
    """Rewrite the dataset with deterministic blank-node identifiers and compact storage."""

    records = load_records(dataset_id)
    try:
        dataset_label = datasets.get_dataset(dataset_id).title
    except KeyError:
        dataset_label = None

    ark_to_id = {record.ark: record.id for record in records if record.ark}

    with _STORE_LOCK:
        store_before = _get_store_locked(dataset_id)
        label_literal = _literal_first_value(store_before, META_DATASET, PROP_DATASET_LABEL, META_GRAPH)
        del store_before
        _reset_dataset_store(dataset_id)
        store = _get_store_locked(dataset_id)
        quads = list(_build_dataset_quads(records, ark_to_id, label_literal or dataset_label))
        if quads:
            store.bulk_extend(quads)
        store.flush()
    datasets.touch_dataset(dataset_id)
