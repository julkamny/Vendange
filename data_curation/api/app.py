"""FastAPI application exposing Vendange search endpoints."""

from __future__ import annotations

import asyncio
import contextlib
import io
import json
import logging
import shutil
import zipfile
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional
import threading

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from data_curation.api import autocomplete as autocomplete_service
from data_curation.api import db, datasets
from data_curation.api.schemas import BacklinksPayload, RecordPayload, WorkCluster, WorkspaceAgentsResponse, WorkspaceWorksResponse
from data_curation.curation.cluster_views import AgentViewBuilder, WorkspaceViewBuilder
from data_curation.api.datasets import DatasetMetadata
from data_curation.curation.pipeline import (
    run_cluster_operation,
    run_cluster_with_expression_operation,
)
from data_curation.api.manifestation_uproot import ManifestationUprootResult, uproot_manifestation
from data_curation.utils.log_bundle import LOG_TEXT_FORMAT, LogBundle, activate_log_bundle, reset_log_bundle
from data_curation.models import Entity


LOGGER = logging.getLogger(__name__)


class UpdateRecordPayload(BaseModel):
    record_id: str = Field(..., alias="id")
    type_raw: str = Field(..., alias="type")
    intermarc_json: str = Field(..., alias="intermarc")


class SparqlQueryPayload(BaseModel):
    query: str


class ClusterRequest(BaseModel):
    include_expressions: bool = Field(False, alias="includeExpressions")


class DatasetTitlePayload(BaseModel):
    title: str


class AnchorSwapPayload(BaseModel):
    anchor_id: str = Field(..., alias="anchorId")
    target_id: str = Field(..., alias="targetId")


class OriginalitySwapPayload(BaseModel):
    original_id: str = Field(..., alias="originalId")
    target_id: str = Field(..., alias="targetId")

class ManualClusterPayload(BaseModel):
    anchor_id: str = Field(..., alias="anchorId")
    target_id: Optional[str] = Field(None, alias="targetId")
    target_ark: Optional[str] = Field(None, alias="targetArk")
    accepted: bool = True


class ManifestationUprootPayload(BaseModel):
    manifestation_id: str = Field(..., alias="manifestationId")
    target_expression_id: Optional[str] = Field(None, alias="targetExpressionId")
    target_expression_ark: Optional[str] = Field(None, alias="targetExpressionArk")
    detach_arks: List[str] = Field(default_factory=list, alias="detachArks")
    partial_ark: Optional[str] = Field(None, alias="partialArk")
    partial: Optional[bool] = Field(False, alias="partial")


class AutocompleteRequest(BaseModel):
    zone: Optional[str] = None
    subfield: Optional[str] = None
    query: str = ""


class AutocompleteSuggestion(BaseModel):
    ark: str
    label: str
    type: str


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    db.initialize_storage()
    yield

app = FastAPI(title="Vendange Search API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


class _QueueLogHandler(logging.Handler):
    """Forward log records from background curation jobs to an asyncio queue and file."""

    def __init__(
        self,
        dataset_id: str,
        queue: asyncio.Queue[Optional[dict[str, Any]]],
        loop: asyncio.AbstractEventLoop,
        bundle: LogBundle,
    ) -> None:
        super().__init__(level=logging.DEBUG)
        self.dataset_id = dataset_id
        self.queue = queue
        self.loop = loop
        self.bundle = bundle
        self.log_file = bundle.text_path
        self._file_stream = bundle.open_text_stream()
        self._file_formatter = logging.Formatter(LOG_TEXT_FORMAT, "%Y-%m-%d %H:%M:%S")

    def emit(self, record: logging.LogRecord) -> None:
        if not record.name.startswith("data_curation"):
            return
        try:
            message = record.getMessage()
        except Exception:  # pragma: no cover - safety net
            message = str(record.msg)

        timestamp = datetime.fromtimestamp(record.created, timezone.utc).isoformat()
        file_line = self._file_formatter.format(record)
        self._file_stream.write(f"{file_line}\n")
        self._file_stream.flush()

        exception_text: Optional[str] = None
        if record.exc_info:
            exception_text = self._file_formatter.formatException(record.exc_info)
        elif record.exc_text:
            exception_text = record.exc_text
        self.bundle.add_record(
            timestamp=timestamp,
            level=record.levelname,
            logger_name=record.name,
            message=message,
            exception=exception_text,
        )
        payload = {
            "event": "log",
            "data": {
                "datasetId": self.dataset_id,
                "level": record.levelname,
                "logger": record.name,
                "message": message,
                "timestamp": timestamp,
                "logFile": self.bundle.run_id,
                "logUrl": f"/api/datasets/{self.dataset_id}/cluster/logs/{self.bundle.run_id}",
            },
        }
        if exception_text:
            payload["data"]["exception"] = exception_text
        self.loop.call_soon_threadsafe(self.queue.put_nowait, payload)

    def close(self) -> None:  # pragma: no cover - defensive cleanup
        try:
            self._file_stream.close()
            self.bundle.close_text_stream()
        finally:
            super().close()


def _format_sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _run_cluster_job(
    dataset_id: str,
    include_expressions: bool,
    loop: asyncio.AbstractEventLoop,
    queue: asyncio.Queue[Optional[dict[str, Any]]],
    bundle: LogBundle,
) -> None:
    log_name = bundle.run_id
    log_endpoint = f"/api/datasets/{dataset_id}/cluster/logs/{log_name}"
    try:
        LOGGER.info("Starting clustering job for dataset %s (include_expressions=%s)", dataset_id, include_expressions)
        if include_expressions:
            work_clusters, expression_clusters = run_cluster_with_expression_operation(dataset_id=dataset_id)
            LOGGER.info(
                "Dataset %s → work clusters: %s • expression clusters: %s",
                dataset_id,
                len(work_clusters),
                len(expression_clusters),
            )
            payload = {
                "workClusters": [asdict(cluster) for cluster in work_clusters],
                "expressionClusters": [asdict(cluster) for cluster in expression_clusters],
            }
        else:
            work_clusters = run_cluster_operation(dataset_id=dataset_id)
            LOGGER.info("Dataset %s → work clusters created: %s", dataset_id, len(work_clusters))
            payload = {"workClusters": [asdict(cluster) for cluster in work_clusters]}

        datasets.mark_clustered(dataset_id)
        meta = datasets.get_dataset(dataset_id)
        LOGGER.info("Clustering job completed for dataset %s", dataset_id)
        loop.call_soon_threadsafe(
            queue.put_nowait,
            {
                "event": "result",
                "data": {
                    "datasetId": dataset_id,
                    "lastClusteredAt": meta.last_clustered_at,
                    "logFile": log_name,
                    "logUrl": log_endpoint,
                    **payload,
                },
            },
        )
    except Exception as exc:  # pragma: no cover - defensive safety net
        LOGGER.exception("Clustering job failed for dataset %s", dataset_id)
        loop.call_soon_threadsafe(
            queue.put_nowait,
            {
                "event": "error",
                "data": {
                    "datasetId": dataset_id,
                    "message": str(exc),
                    "logFile": log_name,
                    "logUrl": log_endpoint,
                },
            },
        )
    finally:
        try:
            bundle.finalize()
        except Exception:  # pragma: no cover - defensive logging
            LOGGER.exception("Failed to finalize log bundle for dataset %s", dataset_id)
        else:
            LOGGER.info("Log bundle archived at %s", bundle.html_path)
        loop.call_soon_threadsafe(queue.put_nowait, None)


async def _cluster_stream(dataset_id: str, include_expressions: bool) -> AsyncIterator[str]:
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[Optional[dict[str, Any]]] = asyncio.Queue()
    bundle_info = datasets.create_dataset_log_bundle(dataset_id, prefix="cluster")
    bundle = LogBundle(
        run_id=bundle_info.run_id,
        directory=bundle_info.directory,
        text_path=bundle_info.text_path,
        html_path=bundle_info.html_path,
        assets_path=bundle_info.assets_path,
    )
    token = activate_log_bundle(bundle)
    handler = _QueueLogHandler(dataset_id, queue, loop, bundle)
    root_logger = logging.getLogger()
    previous_level = root_logger.level
    root_logger.addHandler(handler)
    if previous_level > logging.DEBUG:
        root_logger.setLevel(logging.DEBUG)
    worker = asyncio.create_task(asyncio.to_thread(_run_cluster_job, dataset_id, include_expressions, loop, queue, bundle))
    try:
        while True:
            item = await queue.get()
            if item is None:
                break
            yield _format_sse(item["event"], item["data"])
    except asyncio.CancelledError:  # pragma: no cover - cancelled by client
        pass
    finally:
        root_logger.removeHandler(handler)
        root_logger.setLevel(previous_level)
        handler.close()
        if not worker.done():
            worker.cancel()
        with contextlib.suppress(Exception):
            await worker
        reset_log_bundle(token)


def _build_log_bundle_response(bundle: datasets.DatasetLogBundle) -> Response:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for file_path in bundle.directory.rglob("*"):
            if file_path.is_file():
                arcname = Path(bundle.run_id) / file_path.relative_to(bundle.directory)
                archive.write(file_path, arcname)
    buffer.seek(0)
    headers = {
        "Content-Disposition": f'attachment; filename="{bundle.run_id}.zip"',
        "Cache-Control": "no-cache",
    }
    return Response(content=buffer.getvalue(), media_type="application/zip", headers=headers)



def _ensure_dataset(dataset_id: str) -> DatasetMetadata:
    try:
        return datasets.get_dataset(dataset_id)
    except KeyError as exc:  # pragma: no cover - defensive guard
        raise HTTPException(status_code=404, detail=f"Dataset not found: {dataset_id}") from exc


def _serialize_dataset(meta: DatasetMetadata) -> dict[str, Any]:
    stats = db.dataset_stats(meta.id)
    return {
        "id": meta.id,
        "title": meta.title,
        "createdAt": meta.created_at,
        "updatedAt": meta.updated_at,
        "sourceFilename": meta.source_filename,
        "lastClusteredAt": meta.last_clustered_at,
        "stats": {
            "entityCount": stats.get("entity_count", 0),
            "quadCount": stats.get("quad_count", 0),
            "sizeBytes": stats.get("size_bytes", 0),
        },
    }


# WorkspaceViewBuilder cache --------------------------------------------------


@dataclass
class _WorkspaceCacheEntry:
    builder: WorkspaceViewBuilder
    updated_at: str


_WORKSPACE_CACHE: Dict[str, _WorkspaceCacheEntry] = {}
_WORKSPACE_CACHE_LOCK = threading.RLock()


def _invalidate_workspace_cache(dataset_id: str) -> None:
    with _WORKSPACE_CACHE_LOCK:
        _WORKSPACE_CACHE.pop(dataset_id, None)


def _get_workspace_builder(dataset_id: str) -> WorkspaceViewBuilder:
    meta = _ensure_dataset(dataset_id)
    updated_at = meta.updated_at
    with _WORKSPACE_CACHE_LOCK:
        entry = _WORKSPACE_CACHE.get(dataset_id)
        if entry and entry.updated_at == updated_at:
            return entry.builder

    builder = WorkspaceViewBuilder.from_dataset(dataset_id)
    with _WORKSPACE_CACHE_LOCK:
        _WORKSPACE_CACHE[dataset_id] = _WorkspaceCacheEntry(builder=builder, updated_at=updated_at)
    return builder


def _apply_workspace_updates(dataset_id: str, updated_records: List[dict[str, str]]) -> Optional[WorkspaceViewBuilder]:
    if not updated_records:
        _invalidate_workspace_cache(dataset_id)
        return None

    with _WORKSPACE_CACHE_LOCK:
        entry = _WORKSPACE_CACHE.get(dataset_id)

    if not entry:
        return None

    entities = [Entity(item["id"], item["type"], item["intermarc"]) for item in updated_records]
    entry.builder.replace_entities(entities)
    # Refresh cache timestamp to latest dataset update after db.touch_dataset
    meta = datasets.get_dataset(dataset_id)
    with _WORKSPACE_CACHE_LOCK:
        _WORKSPACE_CACHE[dataset_id] = _WorkspaceCacheEntry(builder=entry.builder, updated_at=meta.updated_at)

    return entry.builder


@app.get("/api/datasets")
def list_datasets() -> dict[str, List[dict[str, Any]]]:
    metas = datasets.list_datasets()
    summaries = [_serialize_dataset(meta) for meta in metas]
    return {"datasets": summaries}


@app.post("/api/datasets")
async def create_dataset(title: str = Form(None), file: UploadFile = File(...)) -> dict[str, Any]:
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file uploaded")

    chosen_title = title.strip() if title else file.filename
    meta = datasets.create_dataset_entry(chosen_title, file.filename)
    try:
        db.ingest_csv(content, meta.id, dataset_label=chosen_title)
    except Exception as exc:  # pragma: no cover - defensive cleanup
        db.close_dataset(meta.id)
        datasets.delete_dataset_entry(meta.id)
        dataset_dir = datasets.dataset_directory(meta.id)
        if dataset_dir.exists():
            shutil.rmtree(dataset_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    refreshed = _ensure_dataset(meta.id)
    return {"dataset": _serialize_dataset(refreshed)}


@app.get("/api/datasets/{dataset_id}")
def fetch_dataset(dataset_id: str) -> dict[str, Any]:
    meta = _ensure_dataset(dataset_id)
    return {"dataset": _serialize_dataset(meta)}


@app.patch("/api/datasets/{dataset_id}")
def rename_dataset(dataset_id: str, payload: DatasetTitlePayload) -> dict[str, Any]:
    try:
        meta = datasets.update_dataset_title(dataset_id, payload.title)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Dataset not found: {dataset_id}") from exc
    return {"dataset": _serialize_dataset(meta)}


@app.delete("/api/datasets/{dataset_id}", status_code=204)
def delete_dataset(dataset_id: str) -> None:
    _ensure_dataset(dataset_id)
    db.close_dataset(dataset_id)
    dataset_dir = datasets.dataset_directory(dataset_id)
    if dataset_dir.exists():
        shutil.rmtree(dataset_dir, ignore_errors=True)
    datasets.delete_dataset_entry(dataset_id)
    _invalidate_workspace_cache(dataset_id)


@app.post("/api/datasets/{dataset_id}/update_record")
async def update_record(dataset_id: str, payload: UpdateRecordPayload) -> dict[str, object]:
    _ensure_dataset(dataset_id)
    try:
        updated = db.update_record(dataset_id, payload.record_id, type_raw=payload.type_raw, intermarc_json=payload.intermarc_json)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    builder = _apply_workspace_updates(dataset_id, updated) or _get_workspace_builder(dataset_id)
    clusters = builder.build_work_clusters()
    affected_arks = {rec.get("ark") for rec in updated if rec.get("ark")}
    updated_clusters = [
        cluster
        for cluster in clusters
        if (cluster.anchor_ark and cluster.anchor_ark in affected_arks)
        or any(item.ark in affected_arks for item in cluster.items)
    ]
    updated_work_rows = []
    for ark in affected_arks:
        if not ark:
            continue
        row = builder.work_row_for_ark(ark)
        if row:
            updated_work_rows.append(row)
    return {
        "updatedRecords": updated,
        "updatedClusters": updated_clusters,
        "removedClusterIds": [],
        "updatedWorkRows": updated_work_rows,
    }


@app.post("/api/datasets/{dataset_id}/swap_anchor")
def swap_anchor(dataset_id: str, payload: AnchorSwapPayload) -> dict[str, object]:
    _ensure_dataset(dataset_id)
    try:
        updated = db.swap_cluster_anchor(dataset_id, anchor_id=payload.anchor_id, target_id=payload.target_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    builder = _apply_workspace_updates(dataset_id, updated) or _get_workspace_builder(dataset_id)
    clusters = builder.build_work_clusters()
    affected_arks = {rec.get("ark") for rec in updated if rec.get("ark")}
    updated_clusters = [
        cluster
        for cluster in clusters
        if (cluster.anchor_ark and cluster.anchor_ark in affected_arks)
        or any(item.ark in affected_arks for item in cluster.items)
    ]
    updated_work_rows = []
    for ark in affected_arks:
        if not ark:
            continue
        row = builder.work_row_for_ark(ark)
        if row:
            updated_work_rows.append(row)
    return {
        "updatedRecords": updated,
        "updatedClusters": updated_clusters,
        "removedClusterIds": [],
        "updatedWorkRows": updated_work_rows,
    }


@app.post("/api/datasets/{dataset_id}/swap_originality")
def swap_originality(dataset_id: str, payload: OriginalitySwapPayload) -> dict[str, object]:
    _ensure_dataset(dataset_id)
    try:
        updated = db.swap_work_originality(
            dataset_id,
            original_id=payload.original_id,
            target_id=payload.target_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    builder = _apply_workspace_updates(dataset_id, updated) or _get_workspace_builder(dataset_id)
    clusters = builder.build_work_clusters()
    affected_arks = {rec.get("ark") for rec in updated if rec.get("ark")}
    updated_clusters = [
        cluster
        for cluster in clusters
        if (cluster.anchor_ark and cluster.anchor_ark in affected_arks)
        or any(item.ark in affected_arks for item in cluster.items)
    ]
    updated_work_rows = []
    for ark in affected_arks:
        if not ark:
            continue
        row = builder.work_row_for_ark(ark)
        if row:
            updated_work_rows.append(row)
    return {
        "updatedRecords": updated,
        "updatedClusters": updated_clusters,
        "removedClusterIds": [],
        "updatedWorkRows": updated_work_rows,
    }


@app.post("/api/datasets/{dataset_id}/manual_cluster")
def manual_cluster(dataset_id: str, payload: ManualClusterPayload) -> dict[str, object]:
    _ensure_dataset(dataset_id)
    try:
        updated = db.update_manual_cluster(
            dataset_id,
            anchor_id=payload.anchor_id,
            target_id=payload.target_id,
            target_ark=payload.target_ark,
            accepted=payload.accepted,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    builder = _apply_workspace_updates(dataset_id, updated) or _get_workspace_builder(dataset_id)
    clusters = builder.build_work_clusters()

    affected_ids = {item.get("id") for item in updated if item.get("id")}
    affected_arks = {item.get("ark") for item in updated if item.get("ark")}
    if payload.target_ark:
        affected_arks.add(payload.target_ark)

    def _cluster_matches(cluster: WorkCluster) -> bool:
        if cluster.anchor_id in affected_ids or (cluster.anchor_ark and cluster.anchor_ark in affected_arks):
            return True
        for item in cluster.items:
            if (item.id and item.id in affected_ids) or (item.ark and item.ark in affected_arks):
                return True
        for group in cluster.expression_groups:
            if (group.anchor.id in affected_ids) or (group.anchor.ark and group.anchor.ark in affected_arks):
                return True
            for expr in group.clustered:
                if (expr.id and expr.id in affected_ids) or (expr.ark and expr.ark in affected_arks):
                    return True
        for expr in cluster.independent_expressions:
            if (expr.id and expr.id in affected_ids) or (expr.ark and expr.ark in affected_arks):
                return True
        return False

    updated_clusters = [cluster for cluster in clusters if _cluster_matches(cluster)]
    removed_cluster_ids: List[str] = []
    if payload.accepted is False and not any(c.anchor_id == payload.anchor_id for c in clusters):
        removed_cluster_ids.append(payload.anchor_id)

    updated_work_rows = []
    for ark in affected_arks:
        if not ark:
            continue
        row = builder.work_row_for_ark(ark)
        if row:
            updated_work_rows.append(row)

    return {
        "updatedRecords": updated,
        "updatedClusters": updated_clusters,
        "removedClusterIds": removed_cluster_ids,
        "updatedWorkRows": updated_work_rows,
    }


@app.post("/api/datasets/{dataset_id}/manifestations/uproot")
def uproot_manifestation_endpoint(dataset_id: str, payload: ManifestationUprootPayload) -> dict[str, object]:
    _ensure_dataset(dataset_id)
    try:
        result: ManifestationUprootResult = uproot_manifestation(
            dataset_id,
            manifestation_id=payload.manifestation_id,
            target_expression_id=payload.target_expression_id,
            target_expression_ark=payload.target_expression_ark,
            detach_arks=payload.detach_arks,
            partial_ark=payload.partial_ark,
            partial_requested=bool(payload.partial or payload.partial_ark),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    builder = _apply_workspace_updates(dataset_id, result.updated_records) or _get_workspace_builder(dataset_id)
    clusters = builder.build_work_clusters()

    related_work_arks = result.previous_work_arks | result.next_work_arks

    def _cluster_matches(cluster: WorkCluster) -> bool:
        if cluster.anchor_ark and cluster.anchor_ark in related_work_arks:
            return True
        return any(item.ark in related_work_arks for item in cluster.items)

    updated_clusters = [cluster for cluster in clusters if _cluster_matches(cluster)]

    updated_work_rows = []
    for ark in related_work_arks:
        if not ark:
            continue
        row = builder.work_row_for_ark(ark)
        if row:
            updated_work_rows.append(row)

    return {
        "updatedRecords": result.updated_records,
        "updatedClusters": updated_clusters,
        "removedClusterIds": [],
        "updatedWorkRows": updated_work_rows,
    }


@app.post("/api/datasets/{dataset_id}/query")
async def execute_query(dataset_id: str, payload: SparqlQueryPayload) -> dict[str, object]:
    if not payload.query.strip():
        raise HTTPException(status_code=400, detail="SPARQL query cannot be empty")
    _ensure_dataset(dataset_id)
    try:
        columns, rows = db.run_sparql_query(dataset_id, payload.query)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive guard for runtime SPARQL errors
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"columns": columns, "rows": rows}


@app.post("/api/datasets/{dataset_id}/cluster")
async def trigger_cluster(dataset_id: str, payload: ClusterRequest) -> StreamingResponse:
    _ensure_dataset(dataset_id)
    stream = _cluster_stream(dataset_id, payload.include_expressions)
    headers = {
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(stream, media_type="text/event-stream", headers=headers)


@app.get("/api/datasets/{dataset_id}/cluster/logs/latest")
def download_latest_cluster_log(dataset_id: str) -> Response:
    _ensure_dataset(dataset_id)
    bundle = datasets.latest_dataset_log_bundle(dataset_id, prefix="cluster")
    if not bundle:
        raise HTTPException(status_code=404, detail="No cluster logs available for this dataset.")
    return _build_log_bundle_response(bundle)


@app.get("/api/datasets/{dataset_id}/cluster/logs/{log_name}")
def download_cluster_log(dataset_id: str, log_name: str) -> Response:
    _ensure_dataset(dataset_id)
    if Path(log_name).name != log_name:
        raise HTTPException(status_code=400, detail="Invalid log identifier.")
    try:
        bundle = datasets.load_dataset_log_bundle(dataset_id, log_name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Requested log file not found.")
    return _build_log_bundle_response(bundle)


@app.get("/api/datasets/{dataset_id}/workspace/works", response_model=WorkspaceWorksResponse)
def workspace_works(dataset_id: str) -> WorkspaceWorksResponse:
    _ensure_dataset(dataset_id)
    builder = _get_workspace_builder(dataset_id)
    return builder.workspace_works_payload()


@app.get("/api/datasets/{dataset_id}/workspace/work/{anchor_key:path}", response_model=WorkCluster)
def workspace_work(dataset_id: str, anchor_key: str) -> WorkCluster:
    _ensure_dataset(dataset_id)
    builder = _get_workspace_builder(dataset_id)
    cluster = builder.cluster_for_anchor(anchor_key)
    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found for the requested anchor.")
    return cluster


@app.get("/api/datasets/{dataset_id}/workspace/agents", response_model=WorkspaceAgentsResponse)
def workspace_agents(dataset_id: str) -> WorkspaceAgentsResponse:
    _ensure_dataset(dataset_id)
    workspace = _get_workspace_builder(dataset_id)
    builder = AgentViewBuilder.from_workspace(workspace)
    return builder.workspace_agents_payload()


@app.get("/api/datasets/{dataset_id}/workspace/record/{record_key:path}", response_model=RecordPayload)
def workspace_record(dataset_id: str, record_key: str) -> RecordPayload:
    _ensure_dataset(dataset_id)
    builder = _get_workspace_builder(dataset_id)
    record = builder.record_payload_for_key(record_key)
    if not record:
        raise HTTPException(status_code=404, detail="Record not found for the requested identifier.")
    return record


@app.get("/api/datasets/{dataset_id}/workspace/backlinks/{record_key:path}", response_model=BacklinksPayload)
def workspace_backlinks(dataset_id: str, record_key: str) -> BacklinksPayload:
    _ensure_dataset(dataset_id)
    builder = _get_workspace_builder(dataset_id)
    payload = builder.backlinks_payload_for_key(record_key)
    if not payload:
        raise HTTPException(status_code=404, detail="Record not found for the requested identifier.")
    return payload


@app.post("/api/datasets/{dataset_id}/autocomplete/entities")
def dataset_autocomplete_entities(dataset_id: str, payload: AutocompleteRequest) -> dict[str, List[AutocompleteSuggestion]]:
    meta = _ensure_dataset(dataset_id)
    builder = _get_workspace_builder(dataset_id)
    target_code = payload.subfield or payload.zone or ""
    suggestions = autocomplete_service.autocomplete_entities(
        dataset_id=dataset_id,
        updated_at=meta.updated_at,
        entities=builder.entities,
        subfield_code=target_code,
        query=payload.query or "",
    )
    return {"suggestions": suggestions}
