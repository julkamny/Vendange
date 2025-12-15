from __future__ import annotations

import json
from dataclasses import asdict
from typing import Iterable, List, Sequence, Tuple

from data_curation.api.pg.curation_tx import dataset_transaction, update_entity_record
from data_curation.api.pg.entities_repo import iter_entities
from data_curation.curation.operations import (
    ClusterResult,
    ExpressionClusterResult,
    cluster_expressions_by_051_and_041,
    cluster_works_by_title_responsibilities,
)
from data_curation.models import Entity
from data_curation.utils.text_norm import fold_diacritics


def _canonical_type(value: str) -> str:
    return fold_diacritics((value or "").strip().lower())


def _is_work(entity: Entity) -> bool:
    return _canonical_type(entity.type_entite) == "oeuvre"


def _is_expression(entity: Entity) -> bool:
    return _canonical_type(entity.type_entite).startswith("expression")


def _persist_entities(dataset_id: str, entities: Iterable[Entity]) -> None:
    seen: set[str] = set()
    updates: List[Tuple[str, str, str]] = []
    for entity in entities:
        if entity.id_entitelrm in seen:
            continue
        updates.append((entity.id_entitelrm, entity.type_entite, entity.intermarc.to_json_string()))
        seen.add(entity.id_entitelrm)
    if not updates:
        return
    with dataset_transaction(dataset_id) as conn:
        for rec_id, type_raw, intermarc_json in updates:
            update_entity_record(
                dataset_id,
                record_id=rec_id,
                type_raw=type_raw,
                intermarc=Entity(rec_id, type_raw, intermarc_json).intermarc,
                conn=conn,
            )


def _dump_json(path: str, payload: Sequence[object]) -> None:
    with open(path, "w", encoding="utf-8") as jf:
        json.dump(payload, jf, ensure_ascii=False, indent=2)


def run_cluster_operation(
    *,
    dataset_id: str,
    clusters_json: str | None = None,
) -> List[ClusterResult]:
    entities = list(iter_entities(dataset_id))
    works = [e for e in entities if _is_work(e)]
    updated_works, clusters = cluster_works_by_title_responsibilities(dataset_id, works, entities)

    _persist_entities(dataset_id, updated_works)

    if clusters_json:
        _dump_json(clusters_json, [asdict(c) for c in clusters])

    return clusters


def run_cluster_with_expression_operation(
    *,
    dataset_id: str,
    works_json: str | None = None,
    expressions_json: str | None = None,
) -> Tuple[List[ClusterResult], List[ExpressionClusterResult]]:
    entities = list(iter_entities(dataset_id))
    works = [e for e in entities if _is_work(e)]
    expressions = [e for e in entities if _is_expression(e)]

    updated_works, work_clusters = cluster_works_by_title_responsibilities(dataset_id, works, entities)
    _persist_entities(dataset_id, updated_works)

    updated_expressions, expression_clusters = cluster_expressions_by_051_and_041(expressions, work_clusters)
    _persist_entities(dataset_id, updated_expressions)

    if works_json:
        _dump_json(works_json, [asdict(c) for c in work_clusters])
    if expressions_json:
        _dump_json(expressions_json, [asdict(c) for c in expression_clusters])

    return work_clusters, expression_clusters
