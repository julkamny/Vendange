from __future__ import annotations

import json
from typing import Dict, List, Sequence

from pyoxigraph import BlankNode, Literal, NamedNode, QuerySolution, QuerySolutions, Store

from .db_shared import (
    AFFECTED_BY_CURATION_PROP,
    FIELD_CODE_PROP,
    FIELD_COMPACT_VALUE_PROP,
    HAS_FIELD,
    HAS_SUBFIELD,
    PROP_RECORD_ID,
    PROP_TYPE_RAW,
    XSD_BOOLEAN,
    XSD_DECIMAL_TYPES,
    XSD_INTEGER_TYPES,
    SUBFIELD_CODE_PROP,
    SUBFIELD_VALUE_PROP,
    field_sort_key,
    literal_first_value,
    record_graph,
    record_id_from_subject,
    subfield_sort_key,
    unsanitize_subfield_code,
)
from .db_store import _STORE_LOCK, directory_size, get_store_locked
from . import datasets
from ..models import Entity


def run_sparql_query(dataset_id: str, query: str) -> tuple[List[str], List[dict[str, object]]]:
    statement = query.strip()
    if not statement:
        raise ValueError("SPARQL query cannot be empty")

    keyword = _leading_query_keyword(statement)
    if keyword.lower() != "select":
        raise ValueError("Only SPARQL SELECT queries are supported")

    with _STORE_LOCK:
        store = get_store_locked(dataset_id)
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


def _load_record_from_store(store: Store, subject: NamedNode, graph: NamedNode) -> Entity:
    fields = []
    for quad in store.quads_for_pattern(subject, HAS_FIELD, None, None):
        field = quad.object
        fields.append(field)
    record_id_for_sort = record_id_from_subject(subject.value)
    fields = sorted(fields, key=lambda node: field_sort_key(record_id_for_sort, node))
    zones = []
    for field in fields:
        code = literal_first_value(store, field, FIELD_CODE_PROP, None) or ""
        affected_by_curation = literal_first_value(store, field, AFFECTED_BY_CURATION_PROP, None)
        compact_value = literal_first_value(store, field, FIELD_COMPACT_VALUE_PROP, None)
        zone_subs = []
        if compact_value:
            try:
                payload = json.loads(compact_value)
                if isinstance(payload, dict):
                    for entry in payload.get("sousZones", []) or []:
                        zone_subs.append(
                            {
                                "code": entry.get("code", ""),
                                "valeur": entry.get("valeur", ""),
                                **(
                                    {"affectedByCuration": entry.get("affectedByCuration")}
                                    if entry.get("affectedByCuration")
                                    else {}
                                ),
                            }
                        )
                    affected_by_curation = payload.get("affectedByCuration", affected_by_curation) or affected_by_curation
            except Exception:
                pass
        if not zone_subs:
            subfields = []
            for sub_quad in store.quads_for_pattern(field, HAS_SUBFIELD, None, None):
                sub = sub_quad.object
                subfields.append(sub)
            subfields = sorted(subfields, key=subfield_sort_key)
            for sub in subfields:
                sub_code = literal_first_value(store, sub, SUBFIELD_CODE_PROP, None) or ""
                sub_val = literal_first_value(store, sub, SUBFIELD_VALUE_PROP, None) or ""
                sub_aff = literal_first_value(store, sub, AFFECTED_BY_CURATION_PROP, None)
                zone_subs.append(
                    {
                        "code": unsanitize_subfield_code(sub_code),
                        "valeur": sub_val,
                        **({"affectedByCuration": sub_aff} if sub_aff else {}),
                    }
                )
        zones.append(
            {
                "code": code,
                "sousZones": zone_subs,
                **({"fieldCompactValue": compact_value} if compact_value is not None else {}),
                **({"affectedByCuration": affected_by_curation} if affected_by_curation else {}),
            }
        )
    data = {"zones": zones}
    intermarc_json = json.dumps(data, ensure_ascii=False)
    type_raw = literal_first_value(store, subject, PROP_TYPE_RAW, graph) or ""
    record_id_val = literal_first_value(store, subject, PROP_RECORD_ID, graph) or record_id_from_subject(subject.value)
    return Entity(record_id_val, type_raw, intermarc_json)


def _record_subjects(store: Store) -> dict[str, tuple[NamedNode, NamedNode]]:
    mapping: dict[str, tuple[NamedNode, NamedNode]] = {}
    for quad in store.quads_for_pattern(None, PROP_RECORD_ID, None, None):
        if isinstance(quad.subject, NamedNode) and isinstance(quad.object, Literal):
            graph_name = getattr(quad, "graph_name", None)
            if isinstance(graph_name, NamedNode):
                mapping[quad.object.value] = (quad.subject, graph_name)
            else:
                mapping[quad.object.value] = (quad.subject, record_graph(quad.object.value))
    return mapping


def load_records(dataset_id: str) -> List[dict[str, object]]:
    with _STORE_LOCK:
        store = get_store_locked(dataset_id)
        subjects = _record_subjects(store)
        records = []
        for record_id, (subject, graph) in subjects.items():
            intermarc = _load_record_from_store(store, subject, graph)
            records.append(
                {
                    "id": record_id,
                    "type": intermarc.type_entite,
                    "ark": intermarc.ark(),
                    "intermarc": intermarc.intermarc_raw,
                }
            )
    return records


def load_entities(dataset_id: str) -> list[Entity]:
    with _STORE_LOCK:
        store = get_store_locked(dataset_id)
        subjects = _record_subjects(store)
        entities = []
        for record_id, (subject, graph) in subjects.items():
            entity = _load_record_from_store(store, subject, graph)
            entities.append(entity)
    return entities


def dataset_stats(dataset_id: str) -> Dict[str, int]:
    directory = datasets.dataset_directory(dataset_id)
    size = directory_size(directory)
    with _STORE_LOCK:
        store = get_store_locked(dataset_id)
        entity_count = sum(1 for _ in store.quads_for_pattern(None, PROP_RECORD_ID, None, None))
        quad_count = len(store)
    return {"size_bytes": size, "entity_count": entity_count, "quad_count": quad_count}


def compact_dataset(dataset_id: str) -> None:
    with _STORE_LOCK:
        store = get_store_locked(dataset_id)
        store.compact()
