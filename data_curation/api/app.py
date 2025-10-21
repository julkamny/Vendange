"""FastAPI application exposing Vendange search endpoints."""

from __future__ import annotations

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from data_curation.api import db


class UpdateRecordPayload(BaseModel):
    record_id: str = Field(..., alias="id")
    type_raw: str = Field(..., alias="type")
    intermarc_json: str = Field(..., alias="intermarc")


class SqlQueryPayload(BaseModel):
    sql: str


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
async def execute_query(payload: SqlQueryPayload) -> dict[str, object]:
    if not payload.sql.strip():
        raise HTTPException(status_code=400, detail="SQL query cannot be empty")
    try:
        rows = db.run_sql_query(payload.sql)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive guard for runtime SQL errors
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    columns = db.list_columns(rows)
    data = [dict(row) for row in rows]
    return {"columns": columns, "rows": data}
