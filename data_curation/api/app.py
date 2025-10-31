"""FastAPI application exposing Vendange search endpoints."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from dataclasses import asdict
from typing import Any, AsyncIterator, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from data_curation.api import db
from data_curation.curation.pipeline import (
    run_cluster_operation,
    run_cluster_with_expression_operation,
)


LOGGER = logging.getLogger(__name__)


class UpdateRecordPayload(BaseModel):
    record_id: str = Field(..., alias="id")
    type_raw: str = Field(..., alias="type")
    intermarc_json: str = Field(..., alias="intermarc")


class SparqlQueryPayload(BaseModel):
    query: str


class ClusterRequest(BaseModel):
    include_expressions: bool = Field(False, alias="includeExpressions")


app = FastAPI(title="Vendange Search API")

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
    """Forward log records from background curation jobs to an asyncio queue."""

    def __init__(self, queue: asyncio.Queue[Optional[dict[str, Any]]], loop: asyncio.AbstractEventLoop) -> None:
        super().__init__(level=logging.INFO)
        self.queue = queue
        self.loop = loop
        self.setFormatter(logging.Formatter("%(message)s"))

    def emit(self, record: logging.LogRecord) -> None:
        if not record.name.startswith("data_curation"):
            return
        message = self.format(record)
        payload = {
            "event": "log",
            "data": {
                "level": record.levelname,
                "logger": record.name,
                "message": message,
            },
        }
        self.loop.call_soon_threadsafe(self.queue.put_nowait, payload)


def _format_sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _run_cluster_job(
    include_expressions: bool,
    loop: asyncio.AbstractEventLoop,
    queue: asyncio.Queue[Optional[dict[str, Any]]],
) -> None:
    try:
        LOGGER.info("Starting clustering job (include_expressions=%s)", include_expressions)
        if include_expressions:
            work_clusters, expression_clusters = run_cluster_with_expression_operation()
            LOGGER.info(
                "Work clusters created: %s • expression clusters: %s",
                len(work_clusters),
                len(expression_clusters),
            )
            payload = {
                "workClusters": [asdict(cluster) for cluster in work_clusters],
                "expressionClusters": [asdict(cluster) for cluster in expression_clusters],
            }
        else:
            work_clusters = run_cluster_operation()
            LOGGER.info("Work clusters created: %s", len(work_clusters))
            payload = {"workClusters": [asdict(cluster) for cluster in work_clusters]}

        LOGGER.info("Clustering job completed")
        loop.call_soon_threadsafe(
            queue.put_nowait,
            {
                "event": "result",
                "data": payload,
            },
        )
    except Exception as exc:  # pragma: no cover - defensive safety net
        LOGGER.exception("Clustering job failed")
        loop.call_soon_threadsafe(
            queue.put_nowait,
            {
                "event": "error",
                "data": {"message": str(exc)},
            },
        )
    finally:
        loop.call_soon_threadsafe(queue.put_nowait, None)


async def _cluster_stream(include_expressions: bool) -> AsyncIterator[str]:
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[Optional[dict[str, Any]]] = asyncio.Queue()
    handler = _QueueLogHandler(queue, loop)
    root_logger = logging.getLogger()
    root_logger.addHandler(handler)
    worker = asyncio.create_task(asyncio.to_thread(_run_cluster_job, include_expressions, loop, queue))
    try:
        while True:
            item = await queue.get()
            if item is None:
                break
            yield _format_sse(item["event"], item["data"])
    finally:
        root_logger.removeHandler(handler)
        if not worker.done():
            worker.cancel()
        with contextlib.suppress(Exception):
            await worker
@app.on_event("startup")
def ensure_schema() -> None:
    db.initialize_storage()


@app.post("/api/upload")
async def upload_dataset(dataset: str = Form("curated"), file: UploadFile = File(...)) -> dict[str, int]:
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file uploaded")
    try:
        count = db.ingest_csv(content, dataset_label=dataset)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"records": count}


@app.post("/api/update_record")
async def update_record(payload: UpdateRecordPayload) -> dict[str, str]:
    try:
        db.update_record(payload.record_id, type_raw=payload.type_raw, intermarc_json=payload.intermarc_json)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok"}


@app.post("/api/query")
async def execute_query(payload: SparqlQueryPayload) -> dict[str, object]:
    if not payload.query.strip():
        raise HTTPException(status_code=400, detail="SPARQL query cannot be empty")
    try:
        columns, rows = db.run_sparql_query(payload.query)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive guard for runtime SPARQL errors
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"columns": columns, "rows": rows}


@app.post("/api/curation/cluster")
async def trigger_cluster(payload: ClusterRequest) -> StreamingResponse:
    stream = _cluster_stream(payload.include_expressions)
    return StreamingResponse(stream, media_type="text/event-stream")
