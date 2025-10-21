"""SQLite ingestion and query helpers for the Vendange search API."""

from __future__ import annotations

import csv
import io
import json
import sqlite3
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Sequence

from ..models import Intermarc
from ..utils.text_norm import fold_diacritics, normalize_for_match

DB_PATH = Path(__file__).resolve().parent / "vendange.sqlite"

_CONNECTION_LOCK = threading.Lock()


def get_connection() -> sqlite3.Connection:
    """Return a SQLite connection with a row factory suitable for JSON serialisation."""

    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def initialize_storage() -> None:
    """Ensure the database file and schema exist."""

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _CONNECTION_LOCK:
        conn = get_connection()
        try:
            _create_schema(conn)
        finally:
            conn.close()


def reset_storage() -> None:
    """Remove the existing database file to start with a clean state."""

    if DB_PATH.exists():
        DB_PATH.unlink()
    initialize_storage()


def _create_schema(conn: sqlite3.Connection) -> None:
    cursor = conn.cursor()
    cursor.executescript(
        """
        CREATE TABLE IF NOT EXISTS records (
            id TEXT PRIMARY KEY,
            type_norm TEXT,
            ark TEXT,
            intermarc_json TEXT
        );

        CREATE TABLE IF NOT EXISTS subfields (
            record_id TEXT NOT NULL,
            zone TEXT,
            sub TEXT,
            code TEXT,
            value TEXT,
            value_norm TEXT,
            is_ark INTEGER DEFAULT 0,
            FOREIGN KEY(record_id) REFERENCES records(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS edges (
            src_id TEXT NOT NULL,
            src_type TEXT,
            relation TEXT,
            dst_ark TEXT,
            dst_id TEXT,
            zone TEXT,
            sub TEXT,
            FOREIGN KEY(src_id) REFERENCES records(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS arks (
            ark TEXT PRIMARY KEY,
            record_id TEXT NOT NULL,
            FOREIGN KEY(record_id) REFERENCES records(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS metadata (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        """
    )
    cursor.executescript(
        """
        CREATE INDEX IF NOT EXISTS subfields_code_valnorm ON subfields(code, value_norm);
        CREATE INDEX IF NOT EXISTS edges_rel_src ON edges(relation, src_id);
        CREATE INDEX IF NOT EXISTS edges_rel_dst ON edges(relation, dst_ark);
        """
    )
    conn.commit()


@dataclass
class ParsedRecord:
    id: str
    type_raw: str
    type_norm: str
    ark: Optional[str]
    intermarc_raw: str
    intermarc: Intermarc


@dataclass
class SubfieldRow:
    record_id: str
    zone: str
    sub: str
    code: str
    value: str
    value_norm: str
    is_ark: int


@dataclass
class EdgeRow:
    src_id: str
    src_type: str
    relation: str
    dst_ark: str
    dst_id: Optional[str]
    zone: str
    sub: str


def _normalize_type(value: str) -> str:
    return fold_diacritics(value or "").lower().strip()


def _looks_like_ark(value: str) -> bool:
    return value.startswith("ark:/")


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
                type_norm=_normalize_type(type_raw),
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


def _split_code(zone_code: str, subfield_code: str) -> tuple[str, str, str]:
    if "$" in subfield_code:
        zone, sub = subfield_code.split("$", 1)
        return (zone or zone_code, sub, f"{zone or zone_code}${sub}")
    return zone_code, "", subfield_code or zone_code


def _extract_rows(record: ParsedRecord) -> tuple[List[SubfieldRow], List[EdgeRow]]:
    subfields: List[SubfieldRow] = []
    edges: List[EdgeRow] = []
    for zone in record.intermarc.zones:
        zone_code = zone.code or ""
        for sub in zone.sousZones:
            sub_code = sub.code or ""
            zone_value, sub_value, code_value = _split_code(zone_code, sub_code)
            raw_value = str(sub.valeur) if sub.valeur is not None else ""
            normalized_value = normalize_for_match(raw_value)
            looks_like_ark = int(_looks_like_ark(raw_value.strip()))
            subfields.append(
                SubfieldRow(
                    record_id=record.id,
                    zone=zone_value,
                    sub=sub_value,
                    code=code_value,
                    value=raw_value,
                    value_norm=normalized_value,
                    is_ark=looks_like_ark,
                )
            )
            if looks_like_ark and code_value.endswith("$3"):
                edges.append(
                    EdgeRow(
                        src_id=record.id,
                        src_type=record.type_norm,
                        relation=code_value,
                        dst_ark=raw_value.strip(),
                        dst_id=None,
                        zone=zone_value,
                        sub=sub_value,
                    )
                )
    return subfields, edges


def ingest_csv(content: bytes, *, dataset_label: Optional[str] = None) -> int:
    """Ingest the provided CSV content into SQLite.

    Returns the number of records stored.
    """

    records = _parse_csv_bytes(content)
    reset_storage()
    if not records:
        return 0

    subfield_rows: List[SubfieldRow] = []
    edge_rows: List[EdgeRow] = []
    ark_to_id: dict[str, str] = {}
    for record in records:
        sub_rows, edge_items = _extract_rows(record)
        subfield_rows.extend(sub_rows)
        edge_rows.extend(edge_items)
        if record.ark:
            ark_to_id[record.ark] = record.id

    for edge in edge_rows:
        if edge.dst_ark:
            edge.dst_id = ark_to_id.get(edge.dst_ark)

    with _CONNECTION_LOCK:
        conn = get_connection()
        try:
            _create_schema(conn)
            cursor = conn.cursor()
            cursor.executemany(
                "INSERT INTO records(id, type_norm, ark, intermarc_json) VALUES (?, ?, ?, ?)",
                [(r.id, r.type_norm, r.ark, r.intermarc_raw) for r in records],
            )
            if subfield_rows:
                cursor.executemany(
                    """
                    INSERT INTO subfields(record_id, zone, sub, code, value, value_norm, is_ark)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            row.record_id,
                            row.zone,
                            row.sub,
                            row.code,
                            row.value,
                            row.value_norm,
                            row.is_ark,
                        )
                        for row in subfield_rows
                    ],
                )
            if edge_rows:
                cursor.executemany(
                    """
                    INSERT INTO edges(src_id, src_type, relation, dst_ark, dst_id, zone, sub)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            row.src_id,
                            row.src_type,
                            row.relation,
                            row.dst_ark,
                            row.dst_id,
                            row.zone,
                            row.sub,
                        )
                        for row in edge_rows
                    ],
                )
            if ark_to_id:
                cursor.executemany(
                    "INSERT INTO arks(ark, record_id) VALUES (?, ?)",
                    list(ark_to_id.items()),
                )
            cursor.execute("DELETE FROM metadata")
            if dataset_label:
                cursor.execute(
                    "INSERT OR REPLACE INTO metadata(key, value) VALUES (?, ?)",
                    ("dataset", dataset_label),
                )
            conn.commit()
        finally:
            conn.close()

    return len(records)


def _build_record_from_payload(
    record_id: str,
    type_raw: str,
    intermarc_json: str,
) -> ParsedRecord:
    intermarc = Intermarc.from_json_string(intermarc_json)
    return ParsedRecord(
        id=record_id,
        type_raw=type_raw,
        type_norm=_normalize_type(type_raw),
        ark=_extract_ark(intermarc),
        intermarc_raw=intermarc_json,
        intermarc=intermarc,
    )


def update_record(record_id: str, *, type_raw: str, intermarc_json: str) -> None:
    """Update a single record and its derived tables."""

    initialize_storage()
    record = _build_record_from_payload(record_id, type_raw, intermarc_json)
    subfields, edges = _extract_rows(record)

    with _CONNECTION_LOCK:
        conn = get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO records(id, type_norm, ark, intermarc_json)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    type_norm=excluded.type_norm,
                    ark=excluded.ark,
                    intermarc_json=excluded.intermarc_json
                """,
                (record.id, record.type_norm, record.ark, record.intermarc_raw),
            )
            cursor.execute("DELETE FROM subfields WHERE record_id = ?", (record.id,))
            cursor.execute("DELETE FROM edges WHERE src_id = ?", (record.id,))
            cursor.execute("DELETE FROM arks WHERE record_id = ?", (record.id,))
            if subfields:
                cursor.executemany(
                    """
                    INSERT INTO subfields(record_id, zone, sub, code, value, value_norm, is_ark)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            row.record_id,
                            row.zone,
                            row.sub,
                            row.code,
                            row.value,
                            row.value_norm,
                            row.is_ark,
                        )
                        for row in subfields
                    ],
                )
            if edges:
                ark_map = {
                    row["ark"]: row["record_id"]
                    for row in cursor.execute("SELECT ark, record_id FROM arks")
                    if row["ark"]
                }
                if record.ark:
                    ark_map[record.ark] = record.id
                cursor.executemany(
                    """
                    INSERT INTO edges(src_id, src_type, relation, dst_ark, dst_id, zone, sub)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            row.src_id,
                            row.src_type,
                            row.relation,
                            row.dst_ark,
                            ark_map.get(row.dst_ark),
                            row.zone,
                            row.sub,
                        )
                        for row in edges
                    ],
                )
            if record.ark:
                cursor.execute(
                    "INSERT OR REPLACE INTO arks(ark, record_id) VALUES (?, ?)",
                    (record.ark, record.id),
                )
            conn.commit()
        finally:
            conn.close()


def run_sql_query(sql: str) -> list[sqlite3.Row]:
    """Execute a read-only SQL query and return the resulting rows."""

    initialize_storage()
    statement = sql.strip().rstrip(";")
    lowered = statement.lstrip().lower()
    if not lowered.startswith("select") and not lowered.startswith("with"):
        raise ValueError("Only SELECT queries are allowed")

    with _CONNECTION_LOCK:
        conn = get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(statement)
            rows = cursor.fetchall()
        finally:
            conn.close()
    return rows


def list_columns(rows: Sequence[sqlite3.Row]) -> List[str]:
    """Extract column names from SQLite row objects."""

    if not rows:
        return []
    return list(rows[0].keys())
