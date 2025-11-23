import csv
import io
import json
import sys
from pathlib import Path
from uuid import uuid4

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


def _records_to_csv_bytes(records) -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["id_entitelrm", "type_entite", "intermarc"])
    for row in records:
        writer.writerow([row["id"], row["type"], row["intermarc"]])
    return buffer.getvalue().encode("utf-8")


HAS_ADAPT_ARK = "ark:/cv/hasAdapt"
IS_ADAPT_OF_ARK = "ark:/cv/isAdaptOf"


def _work_intermarc(ark: str, title: str, extra_zones=None):
    zones = [
        _zone("001", [("a", ark, None)]),
        _zone("150", [("a", title, None)]),
    ]
    zones.extend(extra_zones or [])
    return json.dumps({"zones": zones}, ensure_ascii=False)


def _expression_intermarc(ark: str, parent: str, mode: str = "mode", form: str = "form", extra_zones=None):
    zones = [
        _zone("001", [("a", ark, None)]),
        _zone("140", [("m", mode, None), ("f", form, None), ("3", parent, None)]),
        _zone("750", [("3", parent, None)]),
    ]
    zones.extend(extra_zones or [])
    return json.dumps({"zones": zones}, ensure_ascii=False)


def _controlled_value(ark: str, label: str):
    zones = [
        _zone("001", [("a", ark, None)]),
        _zone("169", [("a", label, None)]),
    ]
    return json.dumps({"zones": zones}, ensure_ascii=False)


def _cluster_zone(target: str, *, note: str = "Clusterisation manuelle", affected: str = "created"):
    suffix = "a" if note.strip().lower() == "clusterisation script" else "3"
    return _zone("90F", [("q", note, affected), (suffix, target, affected)], affected)


def _adaptation_zone(target: str, *, qualifier: str, affected: str = "created"):
    return _zone("552", [("q", qualifier, affected), ("3", target, affected)], affected)


def _build_dataset(records, name: str | None = None):
    dataset_id = name or f"anchor-swap-{uuid4().hex[:8]}"
    datasets.ensure_dataset(dataset_id, title=dataset_id)
    db.ingest_csv(_records_to_csv_bytes(records), dataset_id)
    return dataset_id


def test_work_anchor_swap_moves_cluster_and_adaptations():
    records = [
        {"id": "w1", "type": "Oeuvre", "intermarc": _work_intermarc("ark:/12148/w1", "Work One")},
        {"id": "w2", "type": "Oeuvre", "intermarc": _work_intermarc("ark:/12148/w2", "Work Two")},
        {"id": "w3", "type": "Oeuvre", "intermarc": _work_intermarc("ark:/12148/w3", "Work Three")},
        {
            "id": "w4",
            "type": "Oeuvre",
            "intermarc": _work_intermarc(
                "ark:/12148/w4",
                "Work Four",
                [_adaptation_zone("ark:/12148/w1", qualifier=IS_ADAPT_OF_ARK)],
            ),
        },
        {"id": "cv1", "type": "Valeur contrôlée", "intermarc": _controlled_value(HAS_ADAPT_ARK, "A pour adaptation")},
        {"id": "cv2", "type": "Valeur contrôlée", "intermarc": _controlled_value(IS_ADAPT_OF_ARK, "Est une adaptation de")},
    ]
    dataset_id = _build_dataset(records, "anchor-swap-work-adapt")

    anchor_extra = [
        _cluster_zone("ark:/12148/w2"),
        _cluster_zone("ark:/12148/w3"),
        _adaptation_zone("ark:/12148/w4", qualifier=HAS_ADAPT_ARK),
    ]
    anchor_im = _work_intermarc("ark:/12148/w1", "Work One", anchor_extra)
    db.update_record(dataset_id, "w1", type_raw="Oeuvre", intermarc_json=anchor_im)

    updated = db.swap_cluster_anchor(dataset_id, anchor_id="w1", target_id="w2")
    updated_ids = {entry["id"] for entry in updated}
    assert {"w1", "w2", "w4"} <= updated_ids

    records_after = {rec["id"]: rec for rec in db.load_records(dataset_id)}
    w1_im = json.loads(records_after["w1"]["intermarc"])
    w2_im = json.loads(records_after["w2"]["intermarc"])
    w4_im = json.loads(records_after["w4"]["intermarc"])

    w1_90f = [z for z in w1_im["zones"] if z.get("code") == "90F" and z.get("affectedByCuration")]
    assert not w1_90f, "Former anchor should no longer carry curated 90F fields"

    targets = {
        next((sz["valeur"] for sz in z["sousZones"] if sz["code"] in {"90F$3", "90F$a"}), None)
        for z in w2_im["zones"]
        if z.get("code") == "90F"
    }
    assert "ark:/12148/w1" in targets and "ark:/12148/w3" in targets
    for z in w2_im["zones"]:
        if z.get("code") != "90F":
            continue
        assert z.get("affectedByCuration") == "manual"
        note = next((sz.get("valeur") for sz in z["sousZones"] if sz.get("code") == "90F$q"), None)
        assert note == "Clusterisation manuelle"

    w2_552 = [z for z in w2_im["zones"] if z.get("code") == "552"]
    assert any(sz.get("valeur") == HAS_ADAPT_ARK for z in w2_552 for sz in z["sousZones"] if sz.get("code") == "552$q")

    backlinks = [
        sz.get("valeur")
        for z in w4_im["zones"]
        if z.get("code") == "552"
        for sz in z.get("sousZones", [])
        if sz.get("code") == "552$3"
    ]
    assert "ark:/12148/w2" in backlinks


def test_expression_anchor_swap_moves_cluster():
    records = [
        {"id": "w1", "type": "Oeuvre", "intermarc": _work_intermarc("ark:/12148/w1", "Work One")},
        {"id": "e1", "type": "Expression", "intermarc": _expression_intermarc("ark:/12148/e1", "ark:/12148/w1")},
        {"id": "e2", "type": "Expression", "intermarc": _expression_intermarc("ark:/12148/e2", "ark:/12148/w1")},
    ]
    dataset_id = _build_dataset(records, "anchor-swap-expression")

    anchor_im = _expression_intermarc("ark:/12148/e1", "ark:/12148/w1", extra_zones=[_cluster_zone("ark:/12148/e2")])
    db.update_record(dataset_id, "e1", type_raw="Expression", intermarc_json=anchor_im)

    db.swap_cluster_anchor(dataset_id, anchor_id="e1", target_id="e2")

    records_after = {rec["id"]: rec for rec in db.load_records(dataset_id)}
    e1_zones = json.loads(records_after["e1"]["intermarc"])["zones"]
    e2_zones = json.loads(records_after["e2"]["intermarc"])["zones"]

    assert not any(z.get("code") == "90F" for z in e1_zones)
    targets = [
        sz.get("valeur")
        for z in e2_zones
        if z.get("code") == "90F"
        for sz in z.get("sousZones", [])
        if sz.get("code") in {"90F$3", "90F$a"}
    ]
    assert "ark:/12148/e1" in targets


def test_anchor_swap_drops_self_adaptation():
    # w2 is anchor with adaptation to w4 (the target). After swap, w4 becomes anchor but must not get self adaptation.
    records = [
        {"id": "w1", "type": "Oeuvre", "intermarc": _work_intermarc("ark:/12148/w1", "Work One")},
        {"id": "w2", "type": "Oeuvre", "intermarc": _work_intermarc("ark:/12148/w2", "Work Two")},
        {"id": "w3", "type": "Oeuvre", "intermarc": _work_intermarc("ark:/12148/w3", "Work Three")},
        {"id": "w4", "type": "Oeuvre", "intermarc": _work_intermarc("ark:/12148/w4", "Work Four")},
        {"id": "cv1", "type": "Valeur contrôlée", "intermarc": _controlled_value(HAS_ADAPT_ARK, "A pour adaptation")},
        {"id": "cv2", "type": "Valeur contrôlée", "intermarc": _controlled_value(IS_ADAPT_OF_ARK, "Est une adaptation de")},
    ]
    dataset_id = _build_dataset(records, "anchor-swap-self-adapt")

    anchor_extra = [
        _cluster_zone("ark:/12148/w4"),
        _adaptation_zone("ark:/12148/w4", qualifier=HAS_ADAPT_ARK),
    ]
    anchor_im = _work_intermarc("ark:/12148/w2", "Work Two", anchor_extra)
    db.update_record(dataset_id, "w2", type_raw="Oeuvre", intermarc_json=anchor_im)

    db.swap_cluster_anchor(dataset_id, anchor_id="w2", target_id="w4")

    records_after = {rec["id"]: rec for rec in db.load_records(dataset_id)}
    w4_zones = json.loads(records_after["w4"]["intermarc"])["zones"]
    w2_zones = json.loads(records_after["w2"]["intermarc"])["zones"]

    # New anchor w4 must carry cluster links but no self adaptation
    assert any(z.get("code") == "90F" for z in w4_zones)
    for z in w4_zones:
        if z.get("code") != "552":
            continue
        target_vals = {sz.get("valeur") for sz in z.get("sousZones", []) if sz.get("code") == "552$3"}
        assert len(target_vals) == 0

    # Original anchor should have lost curated 552 links
    assert not any(
        z.get("code") == "552" and any(sz.get("valeur") == HAS_ADAPT_ARK for sz in z.get("sousZones", []) if sz.get("code") == "552$q")
        for z in w2_zones
    )
