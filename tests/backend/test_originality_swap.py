# ruff: noqa: E402
import json
import sys
from pathlib import Path
from uuid import uuid4

# Ensure root is in path
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data_curation.api import db, datasets
from .utils import (
    _work_intermarc,
    _adaptation_zone,
    _records_to_csv_bytes,
    controlled_value_intermarc,
    create_zone,
)


HAS_ADAPT_ARK = "ark:/cv/hasAdapt"
IS_ADAPT_OF_ARK = "ark:/cv/isAdaptOf"


def _build_dataset():
    dataset_id = f"originality-swap-{uuid4().hex[:8]}"
    records = [
        {
            "id": "w1",
            "type": "Oeuvre",
            "intermarc": _work_intermarc(
                "ark:/12148/w1",
                "Original Work",
                [
                    _adaptation_zone("ark:/12148/w2", qualifier=HAS_ADAPT_ARK),
                    _adaptation_zone("ark:/12148/w3", qualifier=HAS_ADAPT_ARK),
                    create_zone("552", [("q", "A pour adaptation", None), ("3", "ark:/12148/w9", None)]),
                ],
            ),
        },
        {
            "id": "w2",
            "type": "Oeuvre",
            "intermarc": _work_intermarc(
                "ark:/12148/w2",
                "Adaptation One",
                [_adaptation_zone("ark:/12148/w1", qualifier=IS_ADAPT_OF_ARK)],
            ),
        },
        {
            "id": "w3",
            "type": "Oeuvre",
            "intermarc": _work_intermarc(
                "ark:/12148/w3",
                "Adaptation Two",
                [_adaptation_zone("ark:/12148/w1", qualifier=IS_ADAPT_OF_ARK)],
            ),
        },
        {"id": "w4", "type": "Oeuvre", "intermarc": _work_intermarc("ark:/12148/w4", "New Original")},
        {
            "id": "cv1",
            "type": "Valeur contrôlée",
            "intermarc": controlled_value_intermarc(HAS_ADAPT_ARK, "A pour adaptation"),
        },
        {
            "id": "cv2",
            "type": "Valeur contrôlée",
            "intermarc": controlled_value_intermarc(IS_ADAPT_OF_ARK, "Est une adaptation de"),
        },
    ]

    datasets.ensure_dataset(dataset_id, title="originality swap")
    db.ingest_csv(_records_to_csv_bytes(records), dataset_id)
    return dataset_id


def test_swap_work_originality_transfers_adaptations():
    dataset_id = _build_dataset()

    db.swap_work_originality(dataset_id, original_id="w1", target_id="w4")

    records_after = {rec["id"]: rec for rec in db.load_records(dataset_id)}
    w1 = json.loads(records_after["w1"]["intermarc"]) ["zones"]
    w2 = json.loads(records_after["w2"]["intermarc"]) ["zones"]
    w3 = json.loads(records_after["w3"]["intermarc"]) ["zones"]
    w4 = json.loads(records_after["w4"]["intermarc"]) ["zones"]

    # Former original loses curated adaptation links but keeps untouched ones
    curated_w1_552 = [
        z
        for z in w1
        if z.get("code") == "552"
        and any(sz.get("valeur") == HAS_ADAPT_ARK for sz in z.get("sousZones", []) if sz.get("code") == "552$q")
        and z.get("affectedByCuration")
    ]
    assert not curated_w1_552
    assert any(sz.get("valeur") == "ark:/12148/w9" for z in w1 for sz in z.get("sousZones", []) if z.get("code") == "552")

    # New original carries manual adaptation links to w2 and w3
    targets_on_new_original = {
        sz.get("valeur")
        for z in w4
        if z.get("code") == "552" and any(sz.get("valeur") == HAS_ADAPT_ARK for sz in z.get("sousZones", []) if sz.get("code") == "552$q")
        for sz in z.get("sousZones", [])
        if sz.get("code") == "552$3"
    }
    assert {"ark:/12148/w2", "ark:/12148/w3"} <= targets_on_new_original
    assert all(z.get("affectedByCuration") == "manual" for z in w4 if z.get("code") == "552")

    def _assert_backlink(zones):
        matches = [
            z
            for z in zones
            if z.get("code") == "552"
            and any(sz.get("valeur") == IS_ADAPT_OF_ARK for sz in z.get("sousZones", []) if sz.get("code") == "552$q")
        ]
        assert matches
        for z in matches:
            target_vals = {sz.get("valeur") for sz in z.get("sousZones", []) if sz.get("code") == "552$3"}
            assert target_vals == {"ark:/12148/w4"}
            assert z.get("affectedByCuration") == "manual"

    _assert_backlink(w2)
    _assert_backlink(w3)
