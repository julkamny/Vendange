"""CSV → Postgres ingest pipeline."""

from __future__ import annotations

import csv
import io
import json
from typing import List, Optional, Sequence, Tuple

from psycopg import sql
from psycopg.types.json import Json

from data_curation.api.db_shared import IngestionStats, canonical_type_key, relation_predicate
from data_curation.api.pg import projections
from data_curation.api.pg import datasets_repo
from data_curation.api.pg.session import db_session, statement_timeout
from data_curation.models import Intermarc

# Parsing helpers (duplicated from legacy ingest to avoid pyoxigraph dependency)


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


def _extract_ark(intermarc: Intermarc) -> Optional[str]:
    for zone in intermarc.get_zone("001"):
        for sub in zone.sousZones:
            if sub.code == "001$a" and sub.valeur:
                trimmed = str(sub.valeur).strip()
                if trimmed:
                    return trimmed
    return None


def _parse_csv_bytes(data: bytes) -> List[projections.ParsedRecord]:
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

    parsed: List[projections.ParsedRecord] = []
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
            projections.ParsedRecord(
                record_id=record_id,
                type_raw=type_raw,
                type_norm=canonical_type_key(type_raw),
                ark=ark,
                intermarc=intermarc,
                intermarc_raw=intermarc_raw,
            )
        )
    return parsed


def _clear_dataset(conn, dataset_id: str) -> None:
    for table in ("rel_edge", "entity_label", "cluster", "fts", "subfield", "field", "entity"):
        conn.execute(sql.SQL("DELETE FROM {tbl} WHERE dataset_id=%s").format(tbl=sql.Identifier(table)), (dataset_id,))


def ingest_csv(dataset_id: str, csv_bytes: bytes, *, dataset_label: Optional[str] = None) -> IngestionStats:
    # Validate dataset exists
    try:
        datasets_repo.get_dataset(dataset_id)
    except KeyError as exc:
        raise ValueError(f"Dataset {dataset_id} is not registered") from exc

    records = _parse_csv_bytes(csv_bytes)
    if not records:
        return IngestionStats(records=0, quads=0)

    label_rows: List[Tuple[str, int, str, Optional[str], str]] = []
    edge_rows: List[Tuple[str, int, str, str, Optional[int]]] = []
    cluster_rows: List[Tuple[str, int, str, str, Optional[int], Optional[str]]] = []
    fts_rows: List[Tuple[str, int, str]] = []
    field_rows: List[Tuple[str, int, int, str]] = []
    subfield_rows: List[Tuple[str, int, int, int, str, str, str]] = []

    with db_session() as conn, conn.transaction():
        with statement_timeout(conn, 120_000):
            _clear_dataset(conn, dataset_id)

            entity_values = [
                (
                    dataset_id,
                    rec.record_id,
                    rec.ark,
                    rec.type_raw,
                    rec.type_norm,
                    Json(json.loads(rec.intermarc_raw)),
                    Json(json.loads(rec.intermarc_raw)),
                )
                for rec in records
            ]
            inserted_ids: List[int] = []
            ark_lookup: dict[str, int] = {}
            for chunk_start in range(0, len(entity_values), 500):
                chunk = entity_values[chunk_start : chunk_start + 500]
                values_clause = sql.SQL(",").join([sql.SQL("(%s,%s,%s,%s,%s,%s,%s)")] * len(chunk))
                query = sql.SQL(
                    """
                    INSERT INTO entity (dataset_id, record_id, ark, type_raw, type_norm, record, original_record)
                    VALUES {values}
                    RETURNING entity_id, ark
                    """
                ).format(values=values_clause)
                result = conn.execute(query, tuple(val for row in chunk for val in row)).fetchall()
                for row in result:
                    entity_id = row["entity_id"]
                    inserted_ids.append(entity_id)
                    ark = row.get("ark")
                    if ark:
                        ark_lookup[str(ark)] = entity_id

            for idx, entity_id in enumerate(inserted_ids):
                rec = records[idx]
                label, sort_key = projections.compute_label(rec)
                label_rows.append((dataset_id, entity_id, label, sort_key, rec.type_norm))

                for edge in projections.extract_edges(rec):
                    predicate_iri = relation_predicate(edge["relation_code"])
                    edge_rows.append((dataset_id, entity_id, predicate_iri, edge["tgt_ark"], ark_lookup.get(edge["tgt_ark"])))

                cluster_rows.extend(
                    [
                        (
                            dataset_id,
                            entity_id,
                            rec.ark or "",
                            row_data["member_ark"],
                            ark_lookup.get(row_data["member_ark"]),
                            row_data["note"],
                        )
                        for row_data in projections.extract_cluster_memberships(rec, entity_id)
                    ]
                )

                fts_rows.append((dataset_id, entity_id, projections.compute_fts(rec, label)))

                for field_idx, tag in projections.extract_field_rows(rec):
                    field_rows.append((dataset_id, entity_id, field_idx, tag))

                for field_idx, sub_idx, code_raw, code_norm, value in projections.extract_subfield_rows(rec):
                    subfield_rows.append((dataset_id, entity_id, field_idx, sub_idx, code_raw, code_norm, value))

            if label_rows:
                for chunk_start in range(0, len(label_rows), 1000):
                    chunk = label_rows[chunk_start : chunk_start + 1000]
                    with conn.cursor() as cur:
                        cur.executemany(
                            "INSERT INTO entity_label (dataset_id, entity_id, label, sort_key, type_norm) VALUES (%s,%s,%s,%s,%s)",
                            chunk,
                        )

            if edge_rows:
                edge_rows = list({row for row in edge_rows})
                for chunk_start in range(0, len(edge_rows), 1000):
                    chunk = edge_rows[chunk_start : chunk_start + 1000]
                    with conn.cursor() as cur:
                        cur.executemany(
                            "INSERT INTO rel_edge (dataset_id, src_entity_id, predicate_iri, tgt_ark, tgt_entity_id) VALUES (%s,%s,%s,%s,%s)",
                            chunk,
                        )

            if cluster_rows:
                cluster_rows = list({row for row in cluster_rows})
                for chunk_start in range(0, len(cluster_rows), 1000):
                    chunk = cluster_rows[chunk_start : chunk_start + 1000]
                    with conn.cursor() as cur:
                        cur.executemany(
                            "INSERT INTO cluster (dataset_id, anchor_entity_id, anchor_ark, member_ark, member_entity_id, note) VALUES (%s,%s,%s,%s,%s,%s)",
                            chunk,
                        )

            if fts_rows:
                for chunk_start in range(0, len(fts_rows), 1000):
                    chunk = fts_rows[chunk_start : chunk_start + 1000]
                    with conn.cursor() as cur:
                        cur.executemany(
                            "INSERT INTO fts (dataset_id, entity_id, document) VALUES (%s,%s,to_tsvector('simple', %s))",
                            chunk,
                        )

            if field_rows:
                for chunk_start in range(0, len(field_rows), 2000):
                    chunk = field_rows[chunk_start : chunk_start + 2000]
                    with conn.cursor() as cur:
                        cur.executemany(
                            "INSERT INTO field (dataset_id, entity_id, field_idx, tag) VALUES (%s,%s,%s,%s)",
                            chunk,
                        )

            if subfield_rows:
                for chunk_start in range(0, len(subfield_rows), 4000):
                    chunk = subfield_rows[chunk_start : chunk_start + 4000]
                    with conn.cursor() as cur:
                        cur.executemany(
                            "INSERT INTO subfield (dataset_id, entity_id, field_idx, sub_idx, code_raw, code_norm, value) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                            chunk,
                        )

    datasets_repo.touch(dataset_id)
    return IngestionStats(records=len(records), quads=len(records))
