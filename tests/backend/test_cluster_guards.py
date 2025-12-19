# ruff: noqa: E402
import json
import pytest
import sys
from pathlib import Path

# Ensure root is in path
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data_curation.api import db
from .utils import (
    _work_intermarc as base_work_intermarc,
    _expression_intermarc as base_expression_intermarc,
    _cluster_zone,
    WORKS, EXPRESSIONS
)

# Wrappers to keep test code concise and matching original structure
def _work_intermarc(work_id: str, extra_zones=None) -> str:
    info = WORKS[work_id]
    return base_work_intermarc(info["ark"], info["title"], extra_zones)

def _expression_intermarc(expr_id: str, extra_zones=None) -> str:
    info = EXPRESSIONS[expr_id]
    return base_expression_intermarc(info["ark"], info["parent"], info["m"], info["f"], extra_zones)

def test_work_target_already_clustered(dataset_builder):
    dataset_id = dataset_builder("work-target-in-other-cluster")
    intermarc_anchor = _work_intermarc("w1", [_cluster_zone(WORKS["w2"]["ark"], note="Clusterisation script")])
    db.update_record(dataset_id, "w1", type_raw="Oeuvre", intermarc_json=intermarc_anchor)

    conflicting = _work_intermarc("w3", [_cluster_zone(WORKS["w2"]["ark"], note="Clusterisation script")])
    with pytest.raises(ValueError):
        db.update_record(dataset_id, "w3", type_raw="Oeuvre", intermarc_json=conflicting)


def test_work_target_is_anchor(dataset_builder):
    dataset_id = dataset_builder("work-target-is-anchor")
    anchor_flagged = _work_intermarc(
        "w2",
        [
            _cluster_zone(WORKS["w3"]["ark"], note="Clusterisation manuelle", affected="manual"),
        ],
    )
    db.update_record(dataset_id, "w2", type_raw="Oeuvre", intermarc_json=anchor_flagged)

    attempt = _work_intermarc("w1", [_cluster_zone(WORKS["w2"]["ark"], note="Clusterisation script")])
    with pytest.raises(ValueError):
        db.update_record(dataset_id, "w1", type_raw="Oeuvre", intermarc_json=attempt)


def test_expression_parent_mismatch(dataset_builder):
    dataset_id = dataset_builder("expression-parent-mismatch")
    bad_cluster = _expression_intermarc("e1", [_cluster_zone(EXPRESSIONS["e3"]["ark"], note="Clusterisation script")])
    with pytest.raises(ValueError):
        db.update_record(dataset_id, "e1", type_raw="Expression", intermarc_json=bad_cluster)


def test_expression_parents_clustered_allows_cross_work(dataset_builder):
    dataset_id = dataset_builder("expression-parents-clustered")
    cluster_works = _work_intermarc("w1", [_cluster_zone(WORKS["w2"]["ark"], note="Clusterisation script")])
    db.update_record(dataset_id, "w1", type_raw="Oeuvre", intermarc_json=cluster_works)

    valid_cluster = _expression_intermarc("e1", [_cluster_zone(EXPRESSIONS["e2"]["ark"], note="Clusterisation script")])
    db.update_record(dataset_id, "e1", type_raw="Expression", intermarc_json=valid_cluster)


def test_expression_anchor_already_clustered_cannot_become_anchor(dataset_builder):
    dataset_id = dataset_builder("expression-anchor-member")
    clustered_parents = _work_intermarc("w1", [_cluster_zone(WORKS["w2"]["ark"], note="Clusterisation script")])
    db.update_record(dataset_id, "w1", type_raw="Oeuvre", intermarc_json=clustered_parents)

    anchor = _expression_intermarc("e1", [_cluster_zone(EXPRESSIONS["e2"]["ark"], note="Clusterisation script")])
    db.update_record(dataset_id, "e1", type_raw="Expression", intermarc_json=anchor)

    promote_member = _expression_intermarc("e2", [_cluster_zone(EXPRESSIONS["e3"]["ark"], note="Clusterisation script")])
    with pytest.raises(ValueError):
        db.update_record(dataset_id, "e2", type_raw="Expression", intermarc_json=promote_member)


def test_expression_target_is_anchor(dataset_builder):
    dataset_id = dataset_builder("expression-target-anchor")
    clustered_parents = _work_intermarc("w3", [_cluster_zone(WORKS["w4"]["ark"], note="Clusterisation script")])
    db.update_record(dataset_id, "w3", type_raw="Oeuvre", intermarc_json=clustered_parents)

    protected_target = _expression_intermarc(
        "e3",
        [_cluster_zone(EXPRESSIONS["e4"]["ark"], note="Clusterisation manuelle", affected="manual")],
    )
    db.update_record(dataset_id, "e3", type_raw="Expression", intermarc_json=protected_target)

    attempt = _expression_intermarc("e1", [_cluster_zone(EXPRESSIONS["e3"]["ark"], note="Clusterisation script")])
    with pytest.raises(ValueError):
        db.update_record(dataset_id, "e1", type_raw="Expression", intermarc_json=attempt)


def test_expression_target_unknown_rejected(dataset_builder):
    dataset_id = dataset_builder("expression-target-unknown")
    attempt = _expression_intermarc("e1", [_cluster_zone("ark:/12148/unknown", note="Clusterisation script")])
    with pytest.raises(ValueError):
        db.update_record(dataset_id, "e1", type_raw="Expression", intermarc_json=attempt)


def test_work_removal_blocked_when_expressions_clustered_elsewhere(dataset_builder):
    dataset_id = dataset_builder("work-removal-guard")

    # Cluster works w1 (anchor) + w2 so expression clustering across them is allowed
    work_cluster = _work_intermarc("w1", [_cluster_zone(WORKS["w2"]["ark"], note="Clusterisation script")])
    db.update_record(dataset_id, "w1", type_raw="Oeuvre", intermarc_json=work_cluster)

    # Expression of w1 anchors a cluster that includes an expression of w2
    expression_cluster = _expression_intermarc("e1", [_cluster_zone(EXPRESSIONS["e2"]["ark"], note="Clusterisation script")])
    db.update_record(dataset_id, "e1", type_raw="Expression", intermarc_json=expression_cluster)

    # Removing w2 from the work cluster should be blocked because e2 is clustered under e1 (different work)
    removal_attempt = _work_intermarc("w1")
    with pytest.raises(ValueError):
        db.update_record(dataset_id, "w1", type_raw="Oeuvre", intermarc_json=removal_attempt)

    # Ensure cluster is still present
    w1_record = next(rec for rec in db.load_records(dataset_id) if rec["id"] == "w1")
    zones = [z for z in json.loads(w1_record["intermarc"]).get("zones", []) if z.get("code") == "90F"]
    assert zones
