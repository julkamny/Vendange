# ruff: noqa: E402
import sys
from pathlib import Path
from uuid import uuid4

# Ensure root is in path
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data_curation.api import db, datasets
from data_curation.api.pg import workspace_repo
from .utils import (
    create_zone,
    controlled_value_intermarc,
    _cluster_zone,
    _work_intermarc,
)


def _build_dataset(records, name: str | None = None) -> str:
    """Create a dataset and ingest the given records."""
    import csv
    import io

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["id_entitelrm", "type_entite", "intermarc"])
    for row in records:
        writer.writerow([row["id"], row["type"], row["intermarc"]])
    dataset_id = f"{name or 'work-sorting'}-{uuid4().hex[:8]}"
    datasets.ensure_dataset(dataset_id, title=name or "work-sorting")
    db.ingest_csv(buffer.getvalue().encode("utf-8"), dataset_id)
    return dataset_id


def _relation_zone(field_code: str, qualifier_ark: str, target_ark: str):
    """Create a relation zone with qualifier + target ARK."""
    return create_zone(field_code, [("q", qualifier_ark, None), ("3", target_ark, None)])


def test_workspace_work_ordering_interleaves_relations_and_clusters():
    cv_part_ark = "ark:/12148/cv-part"
    cv_adapt_ark = "ark:/12148/cv-adapt"
    controlled = [
        {
            "id": "cv-part",
            "type": "Valeur controlee",
            "intermarc": controlled_value_intermarc(cv_part_ark, "Est une partie de"),
        },
        {
            "id": "cv-adapt",
            "type": "Valeur controlee",
            "intermarc": controlled_value_intermarc(cv_adapt_ark, "Est une adaptation de"),
        },
    ]

    w_parent_ark = "ark:/12148/w-parent"
    w_child_ark = "ark:/12148/w-child"
    w_adapt_parent_ark = "ark:/12148/w-adapt-parent"
    w_dual_ark = "ark:/12148/w-dual"
    w_cluster_ark = "ark:/12148/w-cluster"
    w_member_a_ark = "ark:/12148/w-member-a"
    w_member_b_ark = "ark:/12148/w-member-b"
    w_solo_ark = "ark:/12148/w-solo"

    works = [
        {"id": "wparent", "type": "Oeuvre", "intermarc": _work_intermarc(w_parent_ark, "B Parent")},
        {
            "id": "wchild",
            "type": "Oeuvre",
            "intermarc": _work_intermarc(
                w_child_ark,
                "A Child",
                extra_zones=[_relation_zone("501", cv_part_ark, w_parent_ark)],
            ),
        },
        {"id": "wadaptparent", "type": "Oeuvre", "intermarc": _work_intermarc(w_adapt_parent_ark, "C Adapt Parent")},
        {
            "id": "wdual",
            "type": "Oeuvre",
            "intermarc": _work_intermarc(
                w_dual_ark,
                "D Dual",
                extra_zones=[
                    _relation_zone("501", cv_part_ark, w_parent_ark),
                    _relation_zone("552", cv_adapt_ark, w_adapt_parent_ark),
                ],
            ),
        },
        {
            "id": "wcluster",
            "type": "Oeuvre",
            "intermarc": _work_intermarc(
                w_cluster_ark,
                "E Cluster",
                extra_zones=[
                    _cluster_zone(w_member_a_ark),
                    _cluster_zone(w_member_b_ark),
                    _relation_zone("552", cv_adapt_ark, w_adapt_parent_ark),
                ],
            ),
        },
        {"id": "wmembera", "type": "Oeuvre", "intermarc": _work_intermarc(w_member_a_ark, "E Member A")},
        {"id": "wmemberb", "type": "Oeuvre", "intermarc": _work_intermarc(w_member_b_ark, "E Member B")},
        {"id": "wsolo", "type": "Oeuvre", "intermarc": _work_intermarc(w_solo_ark, "F Solo")},
    ]

    dataset_id = _build_dataset(controlled + works, name="work-sorting")
    response = workspace_repo.list_works(dataset_id)

    ordered = [(entry.kind, entry.id) for entry in response.ordered_work_entries]
    assert ordered == [
        ("unclustered", "wparent"),
        ("unclustered", "wchild"),
        ("unclustered", "wdual"),
        ("unclustered", "wadaptparent"),
        ("cluster", "wcluster"),
        ("unclustered", "wsolo"),
    ]
    assert len({entry.id for entry in response.ordered_work_entries}) == len(response.ordered_work_entries)

    cluster = next(cluster for cluster in response.clusters if cluster.anchor_id == "wcluster")
    member_titles = [item.title for item in cluster.items if item.title]
    assert member_titles == ["E Member A", "E Member B"]
