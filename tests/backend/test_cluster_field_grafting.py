# ruff: noqa: E402
"""Backend end-to-end tests for `clusterFieldGrafting` (works clusters).

Test matrix (knotty rules):

| Area | Scenario | Expected outcome |
|------|----------|------------------|
| 040  | Same `$q`, one field is strict superset and compatible | Keep most complete 040; only one is inserted |
| 150/450 | Same core (ignoring `$L/$E/$T`), different MMD-LET values, no anchor 450 | Keep representative with most LET; if tie and LET differ -> highest NNB |
| 680 | Anchor has no 680; multiple works with 680 | Copy 680 from highest-NNB work; other Dewey-distinct 680 -> 999 with origin NNB meta |
| 96X | k>3 works with 96X; one chain appears in 4 works, another in 3 | Keep chain with freq>3 as 96X; move others to 999 |
| Lock | After graft applied | Manual add/remove + anchor swap blocked; originality swap allowed |
| Ungraft | Second click | Remove all and only `affectedByCuration=="clusterFieldGrafting"` zones/subfields |
"""

import json
import re
import sys
from pathlib import Path
from uuid import uuid4

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data_curation.api import db, datasets
from data_curation.api.db_guards import CLUSTER_WORKFLOW_LOCKED_MESSAGE
from data_curation.models import Intermarc
from .utils import (
    _adaptation_zone,
    _cluster_zone,
    _records_to_csv_bytes,
    controlled_value_intermarc,
    create_zone,
)


HAS_ADAPT_ARK = "ark:/cv/hasAdapt"
IS_ADAPT_OF_ARK = "ark:/cv/isAdaptOf"


def _zones(intermarc_json: str):
    return json.loads(intermarc_json).get("zones", [])


def _find_zones(zones, code: str):
    return [z for z in zones if z.get("code") == code]


def _has_flagged_content(intermarc: Intermarc, flag: str) -> bool:
    for z in intermarc.zones:
        if z.affected_by_curation == flag:
            return True
        if any(sz.affected_by_curation == flag for sz in z.sousZones):
            return True
    return False


def _build_dataset() -> str:
    dataset_id = f"cluster-field-grafting-{uuid4().hex[:8]}"

    anchor_ark = "ark:/12148/cb1000000010"  # nnb=100000001
    member_arks = [
        "ark:/12148/cb1000000000",  # nnb=100000000
        "ark:/12148/cb1000000020",  # nnb=100000002
        "ark:/12148/cb1000000030",  # nnb=100000003
        "ark:/12148/cb1000000040",  # nnb=100000004 (most recent)
    ]

    # Cluster linkage (90F) lives on the anchor record.
    cluster_links = [_cluster_zone(ark, affected="created") for ark in member_arks]

    anchor_zones = [
        create_zone("001", [("a", anchor_ark, None)]),
        create_zone("150", [("a", "Anchor Work", None)]),
        create_zone("041", [("a", "fre", None)]),
        create_zone("016", [("a", "keep016", None)]),
        create_zone("700", [("3", "ark:/agent/a1", None), ("4", "role1", None)]),
        create_zone("629", [("a", "base-629", None)]),
        create_zone("62T", [("a", "base-62t", None)]),
        create_zone("960", [("3", "chainA", None)]),
        create_zone("960", [("3", "chainB", None)]),
        _adaptation_zone("ark:/12148/cb2000000000", qualifier=HAS_ADAPT_ARK, affected="created"),
        *cluster_links,
    ]

    def work_record(record_id: str, ark: str, title: str, extra):
        zones = [create_zone("001", [("a", ark, None)]), create_zone("150", [("a", title, None)]), *extra]
        return {"id": record_id, "type": "Oeuvre", "intermarc": Intermarc(zones=zones).to_json_string()}

    # Members with controlled NNB ordering (via cb... arks) to exercise the "most recent" rules.
    m1 = work_record(
        "m1",
        member_arks[0],
        "Member One",
        [
            create_zone("016", [("a", "new016", None)]),
            create_zone("040", [("q", "q1", None), ("a", "x", None)]),  # partial
            create_zone("041", [("a", "eng", None)]),
            create_zone("300", [("a", "desc-1", None)]),
            create_zone("609", [("a", "topic-609", None)]),
            create_zone("685", [("a", "topic-685", None)]),
            create_zone("700", [("3", "ark:/agent/a1", None), ("4", "role2", None)]),
            create_zone("680", [("da", "D1", None), ("dg", "G1", None), ("di", "I1", None)]),
            create_zone("960", [("3", "chainA", None)]),
            create_zone("960", [("3", "chainB", None)]),
        ],
    )

    # Same 040$q but more complete (superset) -> should win over m1's partial.
    m2 = work_record(
        "m2",
        member_arks[1],
        "Member Two",
        [
            create_zone("040", [("q", "q1", None), ("a", "x", None), ("b", "y", None)]),
            create_zone("150", [("a", "AltTitle", None), ("L", "lat", None), ("E", "scr-1", None)]),
            create_zone("860", [("a", "860-older", None)]),
            create_zone("968", [("a", "m2-968", None)]),
            create_zone("960", [("3", "chainA", None)]),
            create_zone("960", [("3", "chainB", None)]),
        ],
    )

    # Same core as m2 but different LET values and higher NNB -> should win tie.
    m3 = work_record(
        "m3",
        member_arks[2],
        "Member Three",
        [
            create_zone("150", [("a", "AltTitle", None), ("L", "lat", None), ("E", "scr-2", None)]),
            create_zone("968", [("a", "m3-968", None)]),
            create_zone("960", [("3", "chainA", None)]),
        ],
    )

    # Most recent: provides anchor 680/860 choices.
    m4 = work_record(
        "m4",
        member_arks[3],
        "Member Four",
        [
            create_zone("680", [("da", "D2", None), ("dg", "G2", None), ("di", "I2", None)]),
            create_zone("860", [("a", "860-newest", None)]),
            create_zone("968", [("a", "m4-968", None)]),
            create_zone("629", [("a", "m4-629", None)]),
            create_zone("62T", [("a", "m4-62t", None)]),
            create_zone("960", [("3", "chainA", None)]),
        ],
    )

    # Adaptation targets/backlinks for originality swap.
    adapt_target = work_record(
        "wA",
        "ark:/12148/cb2000000000",
        "Adaptation Target",
        [_adaptation_zone(anchor_ark, qualifier=IS_ADAPT_OF_ARK, affected="created")],
    )
    new_original = work_record("wNew", "ark:/12148/cb3000000000", "New Original", [])

    records = [
        {"id": "a1", "type": "Oeuvre", "intermarc": Intermarc(zones=anchor_zones).to_json_string()},
        m1,
        m2,
        m3,
        m4,
        adapt_target,
        new_original,
        {"id": "cv1", "type": "Valeur contrôlée", "intermarc": controlled_value_intermarc(HAS_ADAPT_ARK, "A pour adaptation")},
        {"id": "cv2", "type": "Valeur contrôlée", "intermarc": controlled_value_intermarc(IS_ADAPT_OF_ARK, "Est une adaptation de")},
    ]

    datasets.ensure_dataset(dataset_id, title="cluster field grafting")
    db.ingest_csv(_records_to_csv_bytes(records), dataset_id)
    return dataset_id


def test_cluster_field_grafting_full_workflow_and_guards():
    dataset_id = _build_dataset()

    updated = db.toggle_cluster_field_grafting(dataset_id, anchor_id="a1")
    assert updated and updated[0]["id"] == "a1"

    anchor = Intermarc.from_json_string(updated[0]["intermarc"])
    assert _has_flagged_content(anchor, "clusterFieldGrafting")

    # 040: keep most complete superset (q1/a=x/b=y).
    z040 = anchor.get_zone("040")
    assert len(z040) == 1
    subcodes = {(sz.code, sz.valeur) for sz in z040[0].sousZones}
    assert ("040$q", "q1") in subcodes
    assert ("040$a", "x") in subcodes
    assert ("040$b", "y") in subcodes

    # Simple graft: inserts a new 016 zone and flags it; leaves existing anchor 016 unflagged.
    z016 = anchor.get_zone("016")
    assert any(any(sz.code == "016$a" and sz.valeur == "keep016" for sz in z.sousZones) and z.affected_by_curation is None for z in z016)
    grafted_016 = [z for z in z016 if any(sz.code == "016$a" and sz.valeur == "new016" for sz in z.sousZones)]
    assert grafted_016 and grafted_016[0].affected_by_curation == "clusterFieldGrafting"

    # 150/450: member 150 -> anchor 450; tie broken by highest NNB for divergent LET.
    z450 = anchor.get_zone("450")
    assert any(sz.code == "450$E" and sz.valeur == "scr-2" for z in z450 for sz in z.sousZones)

    # 700 merge: adds missing $4 role2 and flags only the inserted subfield.
    z700 = anchor.get_zone("700")
    assert len(z700) == 1
    role2 = [sz for sz in z700[0].sousZones if sz.code == "700$4" and sz.valeur == "role2"]
    assert role2 and role2[0].affected_by_curation == "clusterFieldGrafting"
    role1 = [sz for sz in z700[0].sousZones if sz.code == "700$4" and sz.valeur == "role1"]
    assert role1 and role1[0].affected_by_curation is None

    # 609: presence of any 96X moves all 609 to 999; anchor ends with no 609.
    assert not anchor.get_zone("609")
    assert any(z.code == "999" and any(sz.code == "999$et" and sz.valeur == "609" for sz in z.sousZones) for z in anchor.zones)

    # 680: anchor had none -> copy from most recent work (D2/G2/I2), others -> 999 with origin NNB meta.
    z680 = anchor.get_zone("680")
    assert z680
    assert any(sz.code == "680$da" and sz.valeur == "D2" for sz in z680[0].sousZones)
    moved_680 = [
        z
        for z in anchor.get_zone("999")
        if any(sz.code == "999$et" and sz.valeur == "680" for sz in z.sousZones)
    ]
    assert moved_680
    assert any(any(sz.code == "999$n" for sz in z.sousZones) for z in moved_680)

    # 96X (k>3): keep chainA (freq=4), move chainB (freq=3) to 999.
    z960 = anchor.get_zone("960")
    assert len(z960) == 1
    assert any(sz.code == "960$3" and sz.valeur == "chainA" for sz in z960[0].sousZones)
    assert any(
        z.code == "999"
        and any(sz.code == "999$et" and sz.valeur == "960" for sz in z.sousZones)
        and any(sz.code == "999$3" and sz.valeur == "chainB" for sz in z.sousZones)
        for z in anchor.zones
    )

    # Guards: membership ops + anchor swap blocked while applied.
    with pytest.raises(ValueError, match=re.escape(CLUSTER_WORKFLOW_LOCKED_MESSAGE)):
        db.update_manual_cluster(dataset_id, anchor_id="a1", target_ark="ark:/12148/cb9999999990", accepted=True)

    with pytest.raises(ValueError, match=re.escape(CLUSTER_WORKFLOW_LOCKED_MESSAGE)):
        db.swap_cluster_anchor(dataset_id, anchor_id="a1", target_id="m1")

    # Exception: originality swap remains allowed even while locked.
    db.swap_work_originality(dataset_id, original_id="a1", target_id="wNew")

    # Ungraft: removes all workflow-tagged fields/subfields but nothing else.
    updated2 = db.toggle_cluster_field_grafting(dataset_id, anchor_id="a1")
    anchor2 = Intermarc.from_json_string(updated2[0]["intermarc"])
    assert not _has_flagged_content(anchor2, "clusterFieldGrafting")
    assert any(any(sz.code == "016$a" and sz.valeur == "keep016" for sz in z.sousZones) for z in anchor2.get_zone("016"))

    # Guards lifted after ungraft.
    removed = db.update_manual_cluster(dataset_id, anchor_id="a1", target_ark="ark:/12148/cb1000000000", accepted=False)
    assert removed
