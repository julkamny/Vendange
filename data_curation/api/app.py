"""FastAPI application exposing Vendange search endpoints."""

from __future__ import annotations

import asyncio
import contextlib
import io
import json
import logging
import shutil
import zipfile
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator, List, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from data_curation.api import db, datasets
from data_curation.api.datasets import DatasetMetadata
from data_curation.curation.pipeline import (
    run_cluster_operation,
    run_cluster_with_expression_operation,
)
from data_curation.utils.log_bundle import LOG_TEXT_FORMAT, LogBundle, activate_log_bundle, reset_log_bundle


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


@app.post("/api/datasets/{dataset_id}/update_record")
async def update_record(dataset_id: str, payload: UpdateRecordPayload) -> dict[str, str]:
    _ensure_dataset(dataset_id)
    try:
        db.update_record(dataset_id, payload.record_id, type_raw=payload.type_raw, intermarc_json=payload.intermarc_json)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok"}


@app.post("/api/datasets/{dataset_id}/swap_anchor")
def swap_anchor(dataset_id: str, payload: AnchorSwapPayload) -> dict[str, object]:
    _ensure_dataset(dataset_id)
    try:
        updated = db.swap_cluster_anchor(dataset_id, anchor_id=payload.anchor_id, target_id=payload.target_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"updatedRecords": updated}


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


@app.get("/api/datasets/{dataset_id}/records")
def list_dataset_records(dataset_id: str) -> dict[str, object]:
    meta = _ensure_dataset(dataset_id)
    records = db.load_records(dataset_id)
    return {
        "dataset": _serialize_dataset(meta),
        "records": [
            {
                "id": record["id"],
                "type": record["type"],
                "ark": record.get("ark"),
                "intermarc": record["intermarc"],
            }
            for record in records
        ],
    }
