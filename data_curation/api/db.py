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
from typing import Iterable, List, Optional, Sequence
from urllib.parse import quote

from pyoxigraph import (
    BlankNode,
    DefaultGraph,
    Literal,
    NamedNode,
    QuerySolution,
    QuerySolutions,
    Quad,
    Store,
)

from ..models import Intermarc
from ..utils.text_norm import fold_diacritics

csv.field_size_limit(sys.maxsize)

STORE_DIR = Path(__file__).resolve().parent / "vendange_store"
LEGACY_SQLITE_PATH = Path(__file__).resolve().parent / "vendange.sqlite"

_STORE_LOCK = threading.RLock()
_STORE: Store | None = None

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
XSD_INTEGER = NamedNode(f"{XSD_NS}integer")

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
FIELD_INDEX_PROP = NamedNode("https://vendange.bnf.fr/fieldIndex")
SUBFIELD_CODE_PROP = NamedNode("https://vendange.bnf.fr/subfieldCode")
SUBFIELD_INDEX_PROP = NamedNode("https://vendange.bnf.fr/subfieldIndex")
SUBFIELD_VALUE_PROP = NamedNode("https://vendange.bnf.fr/subfieldValue")
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
    "marque": NamedNode(f"{CLASS_NS}Brand"),
    "famille": NamedNode(f"{CLASS_NS}Family"),
}
DEFAULT_ENTITY_CLASS = NamedNode(f"{CLASS_NS}Entity")


@dataclass
class ParsedRecord:
    id: str
    type_raw: str
    ark: Optional[str]
    intermarc_raw: str
    intermarc: Intermarc


@dataclass
class SubfieldRow:
    node: BlankNode
    code: str
    raw_code: str
    index: int
    value: str


@dataclass
class FieldRow:
    node: BlankNode
    code: str
    index: int
    subfields: List[SubfieldRow]


@dataclass
class EdgeRow:
    src_id: str
    relation_code: str
    dst_ark: str
    dst_id: Optional[str]


def initialize_storage() -> None:
    """Ensure the Oxigraph store directory exists and is ready for use."""

    with _STORE_LOCK:
        global _STORE
        if LEGACY_SQLITE_PATH.exists():
            LEGACY_SQLITE_PATH.unlink()
        if _STORE is None:
            STORE_DIR.mkdir(parents=True, exist_ok=True)
            _STORE = Store(str(STORE_DIR))


def reset_storage() -> None:
    """Drop the current store contents and recreate an empty Oxigraph store."""

    with _STORE_LOCK:
        global _STORE
        if _STORE is not None:
            _STORE.flush()
            _STORE = None
        if STORE_DIR.exists():
            shutil.rmtree(STORE_DIR)
        STORE_DIR.mkdir(parents=True, exist_ok=True)
        _STORE = Store(str(STORE_DIR))


def _get_store_locked() -> Store:
    global _STORE
    if _STORE is None:
        _STORE = Store(str(STORE_DIR))
    return _STORE


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


def _emit_quads(
    subject: NamedNode,
    predicate: NamedNode,
    obj: object,
    graph: Optional[NamedNode],
    *,
    include_default: bool = True,
) -> Iterable[Quad]:
    if include_default:
        yield Quad(subject, predicate, obj)
    if graph is not None:
        yield Quad(subject, predicate, obj, graph)


def _canonical_type_key(value: str) -> str:
    return fold_diacritics(value or "").lower().strip()


def _class_for_type(value: str) -> NamedNode:
    return TYPE_CLASS_MAP.get(_canonical_type_key(value), DEFAULT_ENTITY_CLASS)


def _looks_like_ark(value: str) -> bool:
    return value.startswith("ark:/")


def _sanitize_subfield_code(code: str) -> str:
    return (code or "").replace("$", "s")


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
        field_node = BlankNode(f"{record.id}:f:{zone_index}")
        subfields: List[SubfieldRow] = []
        for sub_index, sub in enumerate(zone.sousZones):
            raw_code = sub.code or ""
            sanitized_code = _sanitize_subfield_code(raw_code)
            raw_value = str(sub.valeur) if sub.valeur is not None else ""
            sub_node = BlankNode(f"{record.id}:f:{zone_index}:s:{sub_index}")
            subfields.append(
                SubfieldRow(
                    node=sub_node,
                    code=sanitized_code,
                    raw_code=raw_code,
                    index=sub_index,
                    value=raw_value,
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
                index=zone_index,
                subfields=subfields,
            )
        )
    return fields, edges


def ingest_csv(content: bytes, *, dataset_label: Optional[str] = None) -> int:
    """Ingest the provided CSV content into the Oxigraph store.

    Returns the number of records stored.
    """

    records = _parse_csv_bytes(content)
    with _STORE_LOCK:
        reset_storage()
        if not records:
            return 0

        ark_to_id = {record.ark: record.id for record in records if record.ark}
        store = _get_store_locked()
        quads = _build_dataset_quads(records, ark_to_id, dataset_label)
        store.bulk_extend(quads)
        store.flush()
    return len(records)


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
        yield from _emit_quads(
            field.node,
            FIELD_INDEX_PROP,
            Literal(str(field.index), datatype=XSD_INTEGER),
            graph,
        )
        for sub in field.subfields:
            yield from _emit_quads(field.node, HAS_SUBFIELD, sub.node, graph)
            if sub.code:
                yield from _emit_quads(sub.node, SUBFIELD_CODE_PROP, Literal(sub.code), graph)
            yield from _emit_quads(
                sub.node,
                SUBFIELD_INDEX_PROP,
                Literal(str(sub.index), datatype=XSD_INTEGER),
                graph,
            )
            if sub.value:
                yield from _emit_quads(sub.node, SUBFIELD_VALUE_PROP, Literal(sub.value), graph)

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


def update_record(record_id: str, *, type_raw: str, intermarc_json: str) -> None:
    """Update a single record graph with fresh data."""

    initialize_storage()
    record = _build_record_from_payload(record_id, type_raw, intermarc_json)

    with _STORE_LOCK:
        store = _get_store_locked()
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
        store.clear_graph(graph)
        quads = list(_build_record_quads(record, ark_index))
        if quads:
            store.extend(quads)
        store.flush()


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


def run_sparql_query(query: str) -> tuple[List[str], List[dict[str, object]]]:
    """Execute a read-only SPARQL SELECT query and return column names with JSON-friendly rows."""

    initialize_storage()
    statement = query.strip()
    if not statement:
        raise ValueError("SPARQL query cannot be empty")

    keyword = _leading_query_keyword(statement)
    if keyword.lower() != "select":
        raise ValueError("Only SPARQL SELECT queries are supported")

    with _STORE_LOCK:
        store = _get_store_locked()
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
