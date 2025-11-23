import csv
import io
import json
import sys
from pathlib import Path
from uuid import uuid4

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data_curation.api import db, datasets  # noqa: E402


def _zone(code: str, subfields, affected: str | None = None):
    zone = {"code": code, "sousZones": []}
    if affected:
        zone["affectedByCuration"] = affected
    for suffix, value, sub_aff in subfields:
        entry = {"code": f"{code}${suffix}", "valeur": value}
        if sub_aff:
            entry["affectedByCuration"] = sub_aff
        zone["sousZones"].append(entry)
    return zone


WORKS = {
    "w1": {"ark": "ark:/12148/w1", "title": "Work One"},
    "w2": {"ark": "ark:/12148/w2", "title": "Work Two"},
    "w3": {"ark": "ark:/12148/w3", "title": "Work Three"},
    "w4": {"ark": "ark:/12148/w4", "title": "Work Four"},
}

EXPRESSIONS = {
    "e1": {"ark": "ark:/12148/e1", "parent": WORKS["w1"]["ark"], "m": "mode-1", "f": "form-1"},
    "e2": {"ark": "ark:/12148/e2", "parent": WORKS["w2"]["ark"], "m": "mode-2", "f": "form-2"},
    "e3": {"ark": "ark:/12148/e3", "parent": WORKS["w3"]["ark"], "m": "mode-3", "f": "form-3"},
    "e4": {"ark": "ark:/12148/e4", "parent": WORKS["w4"]["ark"], "m": "mode-4", "f": "form-4"},
}

MANIFESTATIONS = {
    "m1": {"ark": "ark:/12148/m1", "expression": EXPRESSIONS["e1"]["ark"], "title": "Manifestation One"},
    "m2": {"ark": "ark:/12148/m2", "expression": EXPRESSIONS["e2"]["ark"], "title": "Manifestation Two"},
    "m3": {"ark": "ark:/12148/m3", "expression": EXPRESSIONS["e3"]["ark"], "title": "Manifestation Three"},
    "m4": {"ark": "ark:/12148/m4", "expression": EXPRESSIONS["e4"]["ark"], "title": "Manifestation Four"},
}


def _work_intermarc(work_id: str, extra_zones=None) -> str:
    info = WORKS[work_id]
    zones = [
        _zone("001", [("a", info["ark"], None)]),
        _zone("150", [("a", info["title"], None)]),
    ]
    zones.extend(extra_zones or [])
    return json.dumps({"zones": zones}, ensure_ascii=False)


def _expression_intermarc(expr_id: str, extra_zones=None) -> str:
    info = EXPRESSIONS[expr_id]
    zones = [
        _zone("001", [("a", info["ark"], None)]),
        _zone("140", [("m", info["m"], None), ("f", info["f"], None), ("3", info["parent"], None)]),
        _zone("750", [("3", info["parent"], None)]),
    ]
    zones.extend(extra_zones or [])
    return json.dumps({"zones": zones}, ensure_ascii=False)


def _manifestation_intermarc(manif_id: str) -> str:
    info = MANIFESTATIONS[manif_id]
    zones = [
        _zone("001", [("a", info["ark"], None)]),
        _zone("245", [("a", info["title"], None)]),
        _zone("740", [("3", info["expression"], None)]),
    ]
    return json.dumps({"zones": zones}, ensure_ascii=False)


def _cluster_zone(note: str, target: str, *, target_suffix: str | None = None, affected: str | None = None):
    suffix = target_suffix or ("a" if note.lower().strip() == "clusterisation script" else "3")
    return _zone("90F", [("q", note, affected), (suffix, target, affected)], affected)


def _base_records():
    rows = []
    for wid in WORKS:
        rows.append({"id": wid, "type": "Oeuvre", "intermarc": _work_intermarc(wid)})
    for eid in EXPRESSIONS:
        rows.append({"id": eid, "type": "Expression", "intermarc": _expression_intermarc(eid)})
    for mid in MANIFESTATIONS:
        rows.append({"id": mid, "type": "Manifestation", "intermarc": _manifestation_intermarc(mid)})
    return rows


def _records_to_csv_bytes(records) -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["id_entitelrm", "type_entite", "intermarc"])
    for row in records:
        writer.writerow([row["id"], row["type"], row["intermarc"]])
    return buffer.getvalue().encode("utf-8")


@pytest.fixture
def dataset_builder():
    base = _base_records()

    def _build(name_prefix: str) -> str:
        dataset_id = f"{name_prefix}-{uuid4().hex[:8]}"
        datasets.ensure_dataset(dataset_id, title=f"guards {name_prefix}")
        db.ingest_csv(_records_to_csv_bytes(base), dataset_id)
        return dataset_id

    return _build


def test_work_target_already_clustered(dataset_builder):
    dataset_id = dataset_builder("work-target-in-other-cluster")
    intermarc_anchor = _work_intermarc("w1", [_cluster_zone("Clusterisation script", WORKS["w2"]["ark"])])
    db.update_record(dataset_id, "w1", type_raw="Oeuvre", intermarc_json=intermarc_anchor)

    conflicting = _work_intermarc("w3", [_cluster_zone("Clusterisation script", WORKS["w2"]["ark"])])
    with pytest.raises(ValueError, match="deja rattachee au cluster"):
        db.update_record(dataset_id, "w3", type_raw="Oeuvre", intermarc_json=conflicting)


def test_work_target_is_anchor(dataset_builder):
    dataset_id = dataset_builder("work-target-is-anchor")
    anchor_flagged = _work_intermarc(
        "w2",
        [
            _cluster_zone("Clusterisation manuelle", WORKS["w3"]["ark"], affected="created"),
        ],
    )
    db.update_record(dataset_id, "w2", type_raw="Oeuvre", intermarc_json=anchor_flagged)

    attempt = _work_intermarc("w1", [_cluster_zone("Clusterisation script", WORKS["w2"]["ark"])])
    with pytest.raises(ValueError, match="deja ancre d'un cluster"):
        db.update_record(dataset_id, "w1", type_raw="Oeuvre", intermarc_json=attempt)


def test_expression_parent_mismatch(dataset_builder):
    dataset_id = dataset_builder("expression-parent-mismatch")
    bad_cluster = _expression_intermarc("e1", [_cluster_zone("Clusterisation script", EXPRESSIONS["e3"]["ark"])])
    with pytest.raises(ValueError, match="n'a pas le même parent"):
        db.update_record(dataset_id, "e1", type_raw="Expression", intermarc_json=bad_cluster)


def test_expression_parents_clustered_allows_cross_work(dataset_builder):
    dataset_id = dataset_builder("expression-parents-clustered")
    cluster_works = _work_intermarc("w1", [_cluster_zone("Clusterisation script", WORKS["w2"]["ark"])])
    db.update_record(dataset_id, "w1", type_raw="Oeuvre", intermarc_json=cluster_works)

    valid_cluster = _expression_intermarc("e1", [_cluster_zone("Clusterisation script", EXPRESSIONS["e2"]["ark"])])
    db.update_record(dataset_id, "e1", type_raw="Expression", intermarc_json=valid_cluster)


def test_expression_anchor_already_clustered_cannot_become_anchor(dataset_builder):
    dataset_id = dataset_builder("expression-anchor-member")
    clustered_parents = _work_intermarc("w1", [_cluster_zone("Clusterisation script", WORKS["w2"]["ark"])])
    db.update_record(dataset_id, "w1", type_raw="Oeuvre", intermarc_json=clustered_parents)

    anchor = _expression_intermarc("e1", [_cluster_zone("Clusterisation script", EXPRESSIONS["e2"]["ark"])])
    db.update_record(dataset_id, "e1", type_raw="Expression", intermarc_json=anchor)

    promote_member = _expression_intermarc("e2", [_cluster_zone("Clusterisation script", EXPRESSIONS["e3"]["ark"])])
    with pytest.raises(ValueError, match="déjà rattachée à un cluster"):
        db.update_record(dataset_id, "e2", type_raw="Expression", intermarc_json=promote_member)


def test_expression_target_is_anchor(dataset_builder):
    dataset_id = dataset_builder("expression-target-anchor")
    clustered_parents = _work_intermarc("w3", [_cluster_zone("Clusterisation script", WORKS["w4"]["ark"])])
    db.update_record(dataset_id, "w3", type_raw="Oeuvre", intermarc_json=clustered_parents)

    protected_target = _expression_intermarc(
        "e3",
        [_cluster_zone("Clusterisation manuelle", EXPRESSIONS["e4"]["ark"], affected="created")],
    )
    db.update_record(dataset_id, "e3", type_raw="Expression", intermarc_json=protected_target)

    attempt = _expression_intermarc("e1", [_cluster_zone("Clusterisation script", EXPRESSIONS["e3"]["ark"])])
    with pytest.raises(ValueError, match="deja ancre d'un cluster"):
        db.update_record(dataset_id, "e1", type_raw="Expression", intermarc_json=attempt)


def test_expression_target_unknown_rejected(dataset_builder):
    dataset_id = dataset_builder("expression-target-unknown")
    attempt = _expression_intermarc("e1", [_cluster_zone("Clusterisation script", "ark:/12148/unknown")])
    with pytest.raises(ValueError, match="parent non vérifiable"):
        db.update_record(dataset_id, "e1", type_raw="Expression", intermarc_json=attempt)
