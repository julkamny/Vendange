from __future__ import annotations

import logging
import threading
import unicodedata
import uuid
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Literal, Optional
from urllib.parse import quote

import os

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pyoxigraph import BlankNode, Literal as OxLiteral, NamedNode, Quad, Store

LOGGER = logging.getLogger(__name__)

SEARCH_NS = "https://data.vendange/search#"
ENTITY_NS = f"{SEARCH_NS}entity/"

CLASSES = {
    "Work": f"{SEARCH_NS}Work",
    "Expression": f"{SEARCH_NS}Expression",
    "Manifestation": f"{SEARCH_NS}Manifestation",
    "Agent": f"{SEARCH_NS}Agent",
    "Collective": f"{SEARCH_NS}Collective",
    "Brand": f"{SEARCH_NS}Brand",
    "Concept": f"{SEARCH_NS}Concept",
    "Controlled": f"{SEARCH_NS}Controlled",
    "Field": f"{SEARCH_NS}Field",
    "Subfield": f"{SEARCH_NS}Subfield",
    "Relationship": f"{SEARCH_NS}Relationship",
}

PREDICATES = {
    "type": "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
    "label": "http://www.w3.org/2000/01/rdf-schema#label",
    "ark": f"{SEARCH_NS}ark",
    "typeNorm": f"{SEARCH_NS}typeNorm",
    "hasField": f"{SEARCH_NS}hasField",
    "zoneCode": f"{SEARCH_NS}zoneCode",
    "fieldIndex": f"{SEARCH_NS}fieldIndex",
    "hasSubfield": f"{SEARCH_NS}hasSubfield",
    "belongsTo": f"{SEARCH_NS}belongsTo",
    "subfieldCode": f"{SEARCH_NS}subfieldCode",
    "subfieldIndex": f"{SEARCH_NS}subfieldIndex",
    "subfieldValue": f"{SEARCH_NS}value",
    "subfieldValueNormalized": f"{SEARCH_NS}valueNormalized",
    "subfieldArk": f"{SEARCH_NS}valueArk",
    "referencesEntity": f"{SEARCH_NS}references",
    "fieldPredicatePrefix": f"{SEARCH_NS}field/",
    "normalizedSuffix": "/normalized",
    "hasExpression": f"{SEARCH_NS}hasExpression",
    "hasExpressionArk": f"{SEARCH_NS}hasExpressionArk",
    "hasManifestation": f"{SEARCH_NS}hasManifestation",
    "hasManifestationArk": f"{SEARCH_NS}hasManifestationArk",
    "hasWork": f"{SEARCH_NS}hasWork",
    "hasWorkArk": f"{SEARCH_NS}hasWorkArk",
    "relatedTo": f"{SEARCH_NS}relatedTo",
    "relatedToArk": f"{SEARCH_NS}relatedToArk",
    "relationshipZone": f"{SEARCH_NS}relationshipZone",
    "hasRelationship": f"{SEARCH_NS}hasRelationship",
    "relationshipTarget": f"{SEARCH_NS}relationshipTarget",
    "hasAgent": f"{SEARCH_NS}hasAgent",
    "hasAgentArk": f"{SEARCH_NS}hasAgentArk",
    "agentZone": f"{SEARCH_NS}agentZone",
    "agentSubfield": f"{SEARCH_NS}agentSubfield",
}

GENERAL_RELATIONSHIP_CODES: Dict[str, List[str]] = {
    "oeuvre": [
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
    ],
    "expression": ["501", "506", "509", "50N", "540", "541", "542", "543", "544", "547", "54C", "54P", "54T"],
    "manifestation": ["501", "506", "509", "50N", "530", "531", "532", "533", "534", "535", "536", "537", "538", "53M"],
}

AGENT_ZONE_CODES = {"700", "701", "702", "710", "711", "712"}
AGENT_REFERENCE_SUBCODES = {"0", "3"}

BuildProgressPhase = Literal["indexing", "building"]
JobStatusLiteral = Literal["building", "ready", "error"]


class SousZoneModel(BaseModel):
    code: str
    valeur: Optional[str] = None


class ZoneModel(BaseModel):
    code: str
    sous_zones: List[SousZoneModel] = Field(default_factory=list, alias="sousZones")


class IntermarcModel(BaseModel):
    zones: List[ZoneModel] = Field(default_factory=list)


class RecordModel(BaseModel):
    id: str
    type_norm: str = Field(alias="typeNorm")
    ark: Optional[str] = None
    intermarc: IntermarcModel

    class Config:
        populate_by_name = True
        extra = "ignore"


class BuildRequest(BaseModel):
    records: List[RecordModel]


class BuildResponse(BaseModel):
    jobId: str


class BuildProgressResponse(BaseModel):
    phase: BuildProgressPhase
    current: int
    total: int


class SearchGraphMetadataResponse(BaseModel):
    recordNodeById: Dict[str, str]
    recordNodeByArk: Dict[str, str]


class JobStatusResponse(BaseModel):
    status: JobStatusLiteral
    progress: Optional[BuildProgressResponse] = None
    metadata: Optional[SearchGraphMetadataResponse] = None
    error: Optional[str] = None


class QueryRequest(BaseModel):
    query: str


class QueryTerm(BaseModel):
    termType: str
    value: str
    language: Optional[str] = None
    datatype: Optional[str] = None


class SelectResult(BaseModel):
    kind: Literal["select"] = "select"
    variables: List[str]
    rows: List[Dict[str, QueryTerm]]


class BooleanResult(BaseModel):
    kind: Literal["boolean"] = "boolean"
    value: bool


class ConstructResult(BaseModel):
    kind: Literal["construct"] = "construct"
    quads: List[str]


class EmptyResult(BaseModel):
    kind: Literal["empty"] = "empty"


QueryExecutionResult = SelectResult | BooleanResult | ConstructResult | EmptyResult


@dataclass
class Subfield:
    code: str
    value: Optional[str]


@dataclass
class Zone:
    code: str
    subfields: List[Subfield] = field(default_factory=list)


@dataclass
class Record:
    identifier: str
    type_norm: str
    ark: Optional[str]
    zones: List[Zone] = field(default_factory=list)


@dataclass
class BuildProgress:
    phase: BuildProgressPhase
    current: int
    total: int


@dataclass
class SearchGraphMetadata:
    record_node_by_id: Dict[str, str]
    record_node_by_ark: Dict[str, str]


@dataclass
class JobState:
    status: JobStatusLiteral = "building"
    progress: Optional[BuildProgress] = None
    metadata: Optional[SearchGraphMetadata] = None
    store: Optional[Store] = None
    error: Optional[str] = None
    last_logged_percent: Optional[int] = None


jobs: Dict[str, JobState] = {}
jobs_lock = threading.Lock()
latest_ready_job_id: Optional[str] = None


DEFAULT_ALLOWED_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
)


def _allowed_origins() -> list[str]:
    configured = os.getenv("SEARCH_API_ALLOW_ORIGINS")
    if configured:
        parsed = [origin.strip() for origin in configured.split(",") if origin.strip()]
        if parsed:
            return parsed
    return list(DEFAULT_ALLOWED_ORIGINS)


app = FastAPI(title="Vendange Search API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _convert_records(models: Iterable[RecordModel]) -> List[Record]:
    converted: List[Record] = []
    for model in models:
        ark = model.ark.strip() if model.ark else None
        zones: List[Zone] = []
        for zone_model in model.intermarc.zones:
            subfields: List[Subfield] = []
            for sub in zone_model.sous_zones:
                raw = sub.valeur
                value = raw.strip() if isinstance(raw, str) else str(raw).strip() if raw is not None else None
                if value == "":
                    value = None
                subfields.append(Subfield(code=sub.code, value=value))
            zones.append(Zone(code=zone_model.code, subfields=subfields))
        converted.append(Record(identifier=model.id, type_norm=model.type_norm, ark=ark, zones=zones))
    return converted


def _normalize_value(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value)
    stripped = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    return stripped.lower().strip()


def _safe_encode(identifier: str) -> str:
    return quote(identifier, safe="")


def _parse_subfield_code(code: str) -> tuple[str, str]:
    if "$" not in code:
        return code, ""
    zone, sub = code.split("$", 1)
    return zone, sub


def _sanitize_segment(segment: str) -> str:
    if not segment:
        return "value"
    return "".join(ch if ch.isalnum() else "_" for ch in segment)


def _ensure_subfield_predicate(cache: Dict[str, tuple[NamedNode, NamedNode]], code: str) -> tuple[NamedNode, NamedNode]:
    cached = cache.get(code)
    if cached:
        return cached
    zone, sub = _parse_subfield_code(code)
    base = f"{PREDICATES['fieldPredicatePrefix']}{_sanitize_segment(zone)}/{_sanitize_segment(sub)}"
    value = NamedNode(base)
    normalized = NamedNode(f"{base}{PREDICATES['normalizedSuffix']}")
    cache[code] = (value, normalized)
    return value, normalized


def _class_for_record(record: Record) -> str:
    mapping = {
        "oeuvre": CLASSES["Work"],
        "work": CLASSES["Work"],
        "expression": CLASSES["Expression"],
        "manifestation": CLASSES["Manifestation"],
        "identite publique de personne": CLASSES["Agent"],
        "personne": CLASSES["Agent"],
        "collectivite": CLASSES["Collective"],
        "marque": CLASSES["Brand"],
        "concept dewey": CLASSES["Concept"],
        "valeur controlee": CLASSES["Controlled"],
    }
    normalized = record.type_norm.lower()
    return mapping.get(normalized, CLASSES["Controlled"])


def _find_zones(record: Record, code: str) -> List[Zone]:
    return [zone for zone in record.zones if zone.code == code]


def _zone_text(zone: Zone) -> str:
    parts = [sub.value for sub in zone.subfields if sub.value]
    return " ".join(parts).strip()


def _title_of(record: Record) -> Optional[str]:
    zones = _find_zones(record, "150")
    if not zones:
        return None
    text = _zone_text(zones[0])
    return text or None


def _manifestation_title(record: Record) -> Optional[str]:
    zones = _find_zones(record, "245")
    if not zones:
        return None
    text = _zone_text(zones[0])
    return text or None


def _manifestation_expression_arks(record: Record) -> List[str]:
    arks: List[str] = []
    for zone in _find_zones(record, "740"):
        for sub in zone.subfields:
            if sub.code == "740$3" and sub.value:
                arks.append(sub.value)
    return arks


def _expression_work_arks(record: Record) -> List[str]:
    arks: List[str] = []
    for zone in _find_zones(record, "140"):
        for sub in zone.subfields:
            if sub.code == "140$3" and sub.value:
                arks.append(sub.value)
    if arks:
        return arks
    for zone in _find_zones(record, "750"):
        for sub in zone.subfields:
            if sub.code == "750$3" and sub.value:
                arks.append(sub.value)
    return arks


def _extract_general_relationship_targets(record: Record) -> List[tuple[str, str]]:
    zone_codes = GENERAL_RELATIONSHIP_CODES.get(record.type_norm.lower())
    if not zone_codes:
        return []
    seen: Dict[str, tuple[str, str]] = {}
    for code in zone_codes:
        for zone in _find_zones(record, code):
            target_code = f"{code}$3"
            for sub in zone.subfields:
                if sub.code != target_code or not sub.value:
                    continue
                key = f"{code}|{sub.value}"
                if key not in seen:
                    seen[key] = (code, sub.value)
    return list(seen.values())


def _sub_code_of(raw: str) -> Optional[str]:
    if "$" not in raw:
        return None
    _, sub = raw.split("$", 1)
    return sub.lower() if sub else None


def _extract_agent_relations(record: Record) -> List[tuple[str, str, Optional[str]]]:
    relations: List[tuple[str, str, Optional[str]]] = []
    for zone in record.zones:
        if zone.code not in AGENT_ZONE_CODES:
            continue
        for sub in zone.subfields:
            sub_code = _sub_code_of(sub.code)
            if sub_code not in AGENT_REFERENCE_SUBCODES or not sub.value:
                continue
            relations.append((sub.value, zone.code, sub_code))
    return relations


def _label_for_record(record: Record) -> str:
    if record.type_norm == "manifestation":
        return _manifestation_title(record) or _title_of(record) or record.identifier
    title = _title_of(record)
    if title:
        return title
    return _manifestation_title(record) or record.identifier


def _add_string_literal(store: Store, subject: NamedNode | BlankNode, predicate: str, value: Optional[str]) -> None:
    if not value:
        return
    store.add(Quad(subject, NamedNode(predicate), OxLiteral(value)))


def _update_progress(job_id: str, progress: BuildProgress) -> bool:
    with jobs_lock:
        state = jobs.get(job_id)
        if not state or state.status != "building":
            return False
        state.progress = progress
        percent = 0
        if progress.total:
            percent = int(progress.current * 100 / progress.total)
        if state.last_logged_percent != percent:
            state.last_logged_percent = percent
            LOGGER.info(
                "Search build %s: phase=%s progress=%s/%s (%s%%)",
                job_id,
                progress.phase,
                progress.current,
                progress.total,
                percent,
            )
        return True


def _set_job_ready(job_id: str, store: Store, metadata: SearchGraphMetadata) -> bool:
    global latest_ready_job_id
    with jobs_lock:
        state = jobs.get(job_id)
        if not state:
            return False
        state.status = "ready"
        state.store = store
        state.metadata = metadata
        state.progress = None
        state.last_logged_percent = None
        state.error = None
        latest_ready_job_id = job_id
        LOGGER.info("Search build %s completed (%s records)", job_id, len(metadata.record_node_by_id))
        return True


def _set_job_error(job_id: str, message: str) -> None:
    with jobs_lock:
        state = jobs.get(job_id)
        if not state:
            return
        state.status = "error"
        state.error = message
        state.progress = None
        state.store = None
        state.metadata = None
        state.last_logged_percent = None
        LOGGER.error("Search build %s failed: %s", job_id, message)


def _job_exists(job_id: str) -> bool:
    with jobs_lock:
        return job_id in jobs


def _job_state(job_id: str) -> Optional[JobState]:
    with jobs_lock:
        return jobs.get(job_id)


def _delete_job(job_id: str) -> bool:
    global latest_ready_job_id
    with jobs_lock:
        state = jobs.pop(job_id, None)
        if not state:
            return False
        if latest_ready_job_id == job_id:
            latest_ready_job_id = None
        state.store = None
        return True


def _build_search_graph(job_id: str, records: List[Record]) -> None:
    try:
        store = Store()
        rdf_type = NamedNode(PREDICATES["type"])
        xsd_integer = NamedNode("http://www.w3.org/2001/XMLSchema#integer")

        node_by_id: Dict[str, NamedNode] = {}
        node_by_ark: Dict[str, NamedNode] = {}
        predicate_cache: Dict[str, tuple[NamedNode, NamedNode]] = {}
        by_ark: Dict[str, Record] = {}
        processed: set[str] = set()

        total_records = len(records)
        if not _update_progress(job_id, BuildProgress("indexing", 0, total_records)):
            return

        for index, record in enumerate(records, start=1):
            if not _job_exists(job_id):
                return
            if record.ark:
                by_ark[record.ark.strip().lower()] = record
            if not _update_progress(job_id, BuildProgress("indexing", index, total_records)):
                return

        def node_for_record(rec: Record) -> NamedNode:
            existing = node_by_id.get(rec.identifier)
            if existing:
                return existing
            node = NamedNode(f"{ENTITY_NS}{_safe_encode(rec.identifier)}")
            node_by_id[rec.identifier] = node
            if rec.ark:
                node_by_ark[rec.ark.strip().lower()] = node
            return node

        def ensure_target_for_ark(ark: str) -> Optional[NamedNode]:
            normalized = ark.strip().lower()
            if not normalized:
                return None
            if normalized in node_by_ark:
                return node_by_ark[normalized]
            target_record = by_ark.get(normalized)
            if not target_record:
                return None
            return node_for_record(target_record)

        for index, record in enumerate(records, start=1):
            if not _job_exists(job_id):
                return
            if record.identifier in processed:
                continue
            processed.add(record.identifier)

            node = node_for_record(record)
            store.add(Quad(node, rdf_type, NamedNode(_class_for_record(record))))
            _add_string_literal(store, node, PREDICATES["label"], _label_for_record(record))
            _add_string_literal(store, node, PREDICATES["typeNorm"], record.type_norm)
            _add_string_literal(store, node, PREDICATES["ark"], record.ark)

            for zone_index, zone in enumerate(record.zones):
                field_node = BlankNode()
                store.add(Quad(node, NamedNode(PREDICATES["hasField"]), field_node))
                store.add(Quad(field_node, rdf_type, NamedNode(CLASSES["Field"])))
                _add_string_literal(store, field_node, PREDICATES["zoneCode"], zone.code)
                store.add(Quad(field_node, NamedNode(PREDICATES["fieldIndex"]), OxLiteral(str(zone_index), datatype=xsd_integer)))
                store.add(Quad(field_node, NamedNode(PREDICATES["belongsTo"]), node))

                for sub_index, sub in enumerate(zone.subfields):
                    if not sub.value:
                        continue
                    predicate, normalized_pred = _ensure_subfield_predicate(predicate_cache, sub.code)
                    store.add(Quad(node, predicate, OxLiteral(sub.value)))
                    normalized_value = _normalize_value(sub.value)
                    if normalized_value:
                        store.add(Quad(node, normalized_pred, OxLiteral(normalized_value)))

                    subfield_node = BlankNode()
                    store.add(Quad(field_node, NamedNode(PREDICATES["hasSubfield"]), subfield_node))
                    store.add(Quad(subfield_node, rdf_type, NamedNode(CLASSES["Subfield"])))
                    store.add(Quad(subfield_node, NamedNode(PREDICATES["belongsTo"]), node))
                    _add_string_literal(store, subfield_node, PREDICATES["subfieldCode"], sub.code)
                    store.add(
                        Quad(
                            subfield_node,
                            NamedNode(PREDICATES["subfieldIndex"]),
                            OxLiteral(str(sub_index), datatype=xsd_integer),
                        )
                    )
                    _add_string_literal(store, subfield_node, PREDICATES["subfieldValue"], sub.value)
                    if normalized_value:
                        _add_string_literal(store, subfield_node, PREDICATES["subfieldValueNormalized"], normalized_value)

                    if sub.value.startswith("ark:/"):
                        _add_string_literal(store, subfield_node, PREDICATES["subfieldArk"], sub.value)
                        target = ensure_target_for_ark(sub.value)
                        if target:
                            store.add(Quad(subfield_node, NamedNode(PREDICATES["referencesEntity"]), target))

            if record.type_norm == "manifestation":
                for ark in _manifestation_expression_arks(record):
                    _add_string_literal(store, node, PREDICATES["hasExpressionArk"], ark)
                    target = ensure_target_for_ark(ark)
                    if target:
                        store.add(Quad(node, NamedNode(PREDICATES["hasExpression"]), target))
                        store.add(Quad(target, NamedNode(PREDICATES["hasManifestation"]), node))

            if record.type_norm == "expression":
                for ark in _expression_work_arks(record):
                    _add_string_literal(store, node, PREDICATES["hasWorkArk"], ark)
                    target = ensure_target_for_ark(ark)
                    if target:
                        store.add(Quad(node, NamedNode(PREDICATES["hasWork"]), target))
                        store.add(Quad(target, NamedNode(PREDICATES["hasExpression"]), node))

            for zone_code, ark in _extract_general_relationship_targets(record):
                relationship_node = BlankNode()
                store.add(Quad(node, NamedNode(PREDICATES["hasRelationship"]), relationship_node))
                store.add(Quad(relationship_node, rdf_type, NamedNode(CLASSES["Relationship"])))
                _add_string_literal(store, relationship_node, PREDICATES["relationshipZone"], zone_code)
                _add_string_literal(store, relationship_node, PREDICATES["relatedToArk"], ark)
                target = ensure_target_for_ark(ark)
                if target:
                    store.add(Quad(relationship_node, NamedNode(PREDICATES["relationshipTarget"]), target))
                    store.add(Quad(node, NamedNode(PREDICATES["relatedTo"]), target))

            for ark, zone_code, subfield in _extract_agent_relations(record):
                _add_string_literal(store, node, PREDICATES["hasAgentArk"], ark)
                _add_string_literal(store, node, PREDICATES["agentZone"], zone_code)
                if subfield:
                    _add_string_literal(store, node, PREDICATES["agentSubfield"], subfield)
                target = ensure_target_for_ark(ark)
                if target:
                    store.add(Quad(node, NamedNode(PREDICATES["hasAgent"]), target))

            if not _update_progress(job_id, BuildProgress("building", index, total_records)):
                return

        metadata = SearchGraphMetadata(
            record_node_by_id={identifier: node.value for identifier, node in node_by_id.items()},
            record_node_by_ark={ark: node.value for ark, node in node_by_ark.items()},
        )
        _set_job_ready(job_id, store, metadata)
    except Exception as exc:  # pragma: no cover - defensive
        LOGGER.exception("Unhandled exception while building search graph")
        _set_job_error(job_id, str(exc))


def _serialize_term(term) -> QueryTerm:
    from pyoxigraph import BlankNode as OxBlankNode, Literal as OxLiteralTerm, NamedNode as OxNamedNode

    if isinstance(term, OxNamedNode):
        return QueryTerm(termType="NamedNode", value=term.value)
    if isinstance(term, OxBlankNode):
        return QueryTerm(termType="BlankNode", value=term.value)
    if isinstance(term, OxLiteralTerm):
        data = QueryTerm(termType="Literal", value=term.value)
        if term.language:
            data.language = term.language
        if term.datatype:
            data.datatype = term.datatype.value
        return data
    return QueryTerm(termType=type(term).__name__, value=getattr(term, "value", str(term)))


def _convert_query_result(result) -> QueryExecutionResult:
    from pyoxigraph import QueryBoolean, QuerySolutions, QueryTriples

    if isinstance(result, QueryBoolean):
        return BooleanResult(value=bool(result))
    if isinstance(result, QuerySolutions):
        variables = [str(var)[1:] if str(var).startswith("?") else str(var) for var in result.variables]
        rows: List[Dict[str, QueryTerm]] = []
        for solution in result:
            row: Dict[str, QueryTerm] = {}
            for variable in variables:
                term = solution[variable]
                if term is not None:
                    row[variable] = _serialize_term(term)
            rows.append(row)
        return SelectResult(variables=variables, rows=rows)
    if isinstance(result, QueryTriples):
        quads = [str(triple) for triple in result]
        return ConstructResult(quads=quads)
    if isinstance(result, str):
        return ConstructResult(quads=[result])
    if isinstance(result, Iterable):
        quads = [str(item) for item in result]
        if quads:
            return ConstructResult(quads=quads)
    return EmptyResult()


@app.post("/search/build", response_model=BuildResponse)
async def start_build(request: BuildRequest, background: BackgroundTasks) -> BuildResponse:
    records = _convert_records(request.records)
    job_id = uuid.uuid4().hex
    with jobs_lock:
        jobs[job_id] = JobState(status="building", progress=BuildProgress("indexing", 0, len(records)))
    LOGGER.info("Starting search build %s (%s records)", job_id, len(records))
    background.add_task(_build_search_graph, job_id, records)
    return BuildResponse(jobId=job_id)


@app.get("/search/status/{job_id}", response_model=JobStatusResponse)
async def job_status(job_id: str) -> JobStatusResponse:
    state = _job_state(job_id)
    if not state:
        raise HTTPException(status_code=404, detail="Unknown job id")
    progress = (
        BuildProgressResponse(phase=state.progress.phase, current=state.progress.current, total=state.progress.total)
        if state.progress
        else None
    )
    metadata = (
        SearchGraphMetadataResponse(
            recordNodeById=state.metadata.record_node_by_id,
            recordNodeByArk=state.metadata.record_node_by_ark,
        )
        if state.metadata
        else None
    )
    return JobStatusResponse(status=state.status, progress=progress, metadata=metadata, error=state.error)


@app.delete("/search/job/{job_id}", status_code=204)
async def delete_job(job_id: str) -> None:
    if not _delete_job(job_id):
        raise HTTPException(status_code=404, detail="Unknown job id")
    LOGGER.info("Deleted search build %s", job_id)


@app.post("/search/query/{job_id}", response_model=QueryExecutionResult)
async def run_query(job_id: str, request: QueryRequest) -> QueryExecutionResult:
    state = _job_state(job_id)
    if not state or state.status != "ready" or not state.store:
        raise HTTPException(status_code=404, detail="Search index is not ready")
    query = request.query.strip()
    if not query:
        return EmptyResult()
    try:
        result = state.store.query(query)
    except Exception as exc:  # pragma: no cover - defensive
        LOGGER.exception("Query failed")
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _convert_query_result(result)


@app.post("/search/query", response_model=QueryExecutionResult)
async def run_query_latest(request: QueryRequest) -> QueryExecutionResult:
    if not latest_ready_job_id:
        raise HTTPException(status_code=404, detail="No completed search index")
    return await run_query(latest_ready_job_id, request)
