from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import List, Tuple, Dict
import csv
import sys

csv.field_size_limit(sys.maxsize) # Huge fields in csv caused error ```_csv.Error: field larger than field limit (131072)```

from ..models import Entity
from scripts.curation.operations import (
    cluster_works_by_title_responsibilities,
    cluster_expressions_by_051_and_041,
    ClusterResult,
    ExpressionClusterResult,
)


@dataclass
class DataSet:
    headers: List[str]
    rows: List[List[str]]


def read_csv_entities(path: str) -> Tuple[List[Entity], DataSet]:
    entities: List[Entity] = []
    with open(path, "r", encoding="utf-8", newline="") as f:
        reader = csv.reader(f, delimiter=";", quotechar='"')
        rows = list(reader)
    if not rows:
        return [], DataSet(headers=[], rows=[])
    headers = rows[0]
    # Map header names to indices, tolerate slight variations
    header_map = {h.strip(): i for i, h in enumerate(headers)}
    def idx(name: str) -> int:
        # Names might be quoted in the file already parsed; try both exact and without quotes
        if name in header_map:
            return header_map[name]
        if name.strip('"') in header_map:
            return header_map[name.strip('"')]
        # fallback: case-insensitive match
        for k, v in header_map.items():
            if k.strip('"').lower() == name.strip('"').lower():
                return v
        raise KeyError(f"Missing column: {name}")

    id_idx = idx("id_entitelrm")
    typ_idx = idx("type_entite")
    int_idx = idx("intermarc")

    for row in rows[1:]:
        if len(row) <= max(id_idx, typ_idx, int_idx):
            continue
        e = Entity(id_entitelrm=row[id_idx], type_entite=row[typ_idx], intermarc_raw=row[int_idx])
        entities.append(e)

    return entities, DataSet(headers=headers, rows=rows)


def write_csv_entities(path: str, dataset: DataSet, entities: List[Entity]) -> None:
    # Rebuild rows: replace any row whose id matches entities list with updated intermarc string
    id_to_entity = {e.id_entitelrm: e for e in entities}
    headers = dataset.headers
    header_map = {h.strip(): i for i, h in enumerate(headers)}
    def idx(name: str) -> int:
        if name in header_map:
            return header_map[name]
        if name.strip('"') in header_map:
            return header_map[name.strip('"')]
        for k, v in header_map.items():
            if k.strip('"').lower() == name.strip('"').lower():
                return v
        raise KeyError(f"Missing column: {name}")

    id_idx = idx("id_entitelrm")
    int_idx = idx("intermarc")

    rows_out = []
    rows_out.append(headers)
    for row in dataset.rows[1:]:
        if not row:
            continue
        rid = row[id_idx]
        if rid in id_to_entity:
            new_row = list(row)
            new_row[int_idx] = id_to_entity[rid].intermarc.to_json_string()
            rows_out.append(new_row)
        else:
            rows_out.append(row)

    with open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f, delimiter=";", quotechar='"', lineterminator='\n')
        writer.writerows(rows_out)


def run_cluster_operation(input_csv: str, output_csv: str, clusters_json: str | None = None) -> List[ClusterResult]:
    entities, dataset = read_csv_entities(input_csv)
    # Only works are considered for this operation
    works = [e for e in entities if e.type_entite.strip().lower() in {"œuvre", "oeuvre", "oeuvre"}]
    updated_works, clusters = cluster_works_by_title_responsibilities(works, entities)

    # Merge updated works back into full entity list
    id_to_updated = {e.id_entitelrm: e for e in updated_works}
    merged_entities: List[Entity] = []
    for e in entities:
        merged_entities.append(id_to_updated.get(e.id_entitelrm, e))

    write_csv_entities(output_csv, dataset, merged_entities)

    if clusters_json:
        import json
        with open(clusters_json, "w", encoding="utf-8") as jf:
            json.dump([c.__dict__ for c in clusters], jf, ensure_ascii=False, indent=2)

    return clusters


def run_cluster_with_expression_operation(
    input_csv: str,
    output_csv: str,
    works_json: str | None = None,
    expressions_json: str | None = None,
) -> Tuple[List[ClusterResult], List[ExpressionClusterResult]]:
    entities, dataset = read_csv_entities(input_csv)

    works = [e for e in entities if e.type_entite.strip().lower() in {"œuvre", "oeuvre", "oeuvre"}]
    expressions = [e for e in entities if e.type_entite.strip().lower() == "expression"]

    updated_works, work_clusters = cluster_works_by_title_responsibilities(works, entities)
    updated_expressions, expression_clusters = cluster_expressions_by_051_and_041(expressions, work_clusters)

    id_to_updated: Dict[str, Entity] = {}
    id_to_updated.update({e.id_entitelrm: e for e in updated_works})
    id_to_updated.update({e.id_entitelrm: e for e in updated_expressions})

    merged_entities: List[Entity] = []
    for e in entities:
        merged_entities.append(id_to_updated.get(e.id_entitelrm, e))

    write_csv_entities(output_csv, dataset, merged_entities)

    if works_json or expressions_json:
        import json

    if works_json:
        with open(works_json, "w", encoding="utf-8") as jf:
            json.dump([asdict(c) for c in work_clusters], jf, ensure_ascii=False, indent=2)

    if expressions_json:
        with open(expressions_json, "w", encoding="utf-8") as jf:
            json.dump([asdict(c) for c in expression_clusters], jf, ensure_ascii=False, indent=2)

    return work_clusters, expression_clusters
