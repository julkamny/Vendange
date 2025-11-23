"""Shared constants, dataclasses and helpers for Oxigraph persistence."""

from __future__ import annotations

import sys
from dataclasses import dataclass
from typing import Iterable, List, Optional, Tuple
from urllib.parse import quote

from pyoxigraph import BlankNode, DefaultGraph, Literal, NamedNode, Quad

from ..models import Intermarc
from ..utils.text_norm import fold_diacritics

BASE_ENTITY_NS = "https://vendange.bnf.fr/entity/"
BASE_GRAPH_NS = "https://vendange.bnf.fr/graph/"
FIELD_NS = "https://vendange.bnf.fr/field/"
RELATION_NS = "https://vendange.bnf.fr/relation/"
RELATION_ARK_NS = "https://vendange.bnf.fr/relation_ark/"
PROPERTY_NS = "https://vendange.bnf.fr/property/"
CLASS_NS = "https://vendange.bnf.fr/class/"

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


def record_iri(record_id: str) -> NamedNode:
    return NamedNode(f"{BASE_ENTITY_NS}{quote(record_id, safe='')}")


def record_graph(record_id: str) -> NamedNode:
    return NamedNode(f"{BASE_GRAPH_NS}{quote(record_id, safe='')}")


def field_predicate(code: str) -> NamedNode:
    return NamedNode(f"{FIELD_NS}{quote(code, safe='$')}")


def relation_predicate(code: str) -> NamedNode:
    return NamedNode(f"{RELATION_NS}{quote(code, safe='')}")


def relation_ark_predicate(code: str) -> NamedNode:
    return NamedNode(f"{RELATION_ARK_NS}{quote(code, safe='')}")


def field_sort_key(record_id: str, node: BlankNode) -> Tuple[int, str]:
    marker = f"{FIELD_BNODE_PREFIX}{record_id}-f-"
    value = node.value if hasattr(node, "value") else str(node)
    if marker in value:
        suffix = value.rsplit(marker, 1)[1]
        segment = suffix.split("-", 1)[0]
        try:
            return int(segment), value
        except ValueError:
            pass
    return sys.maxsize, value


def subfield_sort_key(node: BlankNode) -> Tuple[int, str]:
    marker = f"{FIELD_BNODE_PREFIX}"
    value = node.value if hasattr(node, "value") else str(node)
    if marker in value:
        parts = value.rsplit("-s-", 1)
        if len(parts) == 2:
            try:
                return int(parts[1]), value
            except ValueError:
                pass
    return sys.maxsize, value


def field_blank_node(record_id: str, field_index: int) -> BlankNode:
    identifier = f"{FIELD_BNODE_PREFIX}{record_id}-f-{field_index}"
    return BlankNode(identifier)


def subfield_blank_node(record_id: str, field_index: int, sub_index: int) -> BlankNode:
    identifier = f"{FIELD_BNODE_PREFIX}{record_id}-f-{field_index}-s-{sub_index}"
    return BlankNode(identifier)


def emit_quads(subject: NamedNode | BlankNode, predicate: NamedNode, obj: object, graph: NamedNode) -> Iterable[Quad]:
    yield Quad(subject, predicate, obj, graph)


def canonical_type_key(value: str) -> str:
    return fold_diacritics(value or "").lower().strip()


def class_for_type(value: str) -> NamedNode:
    return TYPE_CLASS_MAP.get(canonical_type_key(value), DEFAULT_ENTITY_CLASS)


def looks_like_ark(value: str) -> bool:
    return value.startswith("ark:/")


def sanitize_subfield_code(code: str) -> str:
    return (code or "").replace("$", "s")


def unsanitize_subfield_code(code: str) -> str:
    if not code:
        return code
    idx = code.find("s")
    if idx == -1:
        return code
    return f"{code[:idx]}${code[idx + 1:]}"


def literal_first_value(
    store,
    subject: object,
    predicate: NamedNode,
    graph: NamedNode | DefaultGraph | None = None,
) -> Optional[str]:
    for quad in store.quads_for_pattern(subject, predicate, None, graph):
        obj = quad.object
        if isinstance(obj, Literal):
            return obj.value
    return None


def record_id_from_subject(subject_iri: str) -> str:
    if not subject_iri.startswith(BASE_ENTITY_NS):
        return subject_iri
    return subject_iri[len(BASE_ENTITY_NS) :]
