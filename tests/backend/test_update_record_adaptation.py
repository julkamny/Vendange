# ruff: noqa: E402
import json
import sys
from pathlib import Path
from uuid import uuid4

# Ensure repo root importable
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data_curation.api import db, datasets
from data_curation.api.pg import controlled_repo
from .utils import (
    _records_to_csv_bytes,
    _work_intermarc,
    controlled_value_intermarc,
    create_intermarc_json,
    create_zone,
)


def _find_zone(intermarc_json: str, code: str):
    data = json.loads(intermarc_json)
    return [z for z in data.get("zones", []) if z.get("code") == code]


def test_update_record_adds_reciprocal_adaptation_links():
    dataset_id = f"adaptation-links-{uuid4().hex[:8]}"
    datasets.ensure_dataset(dataset_id, title="adaptation links")

    records = [
        {"id": "cv-adapt", "type": "Valeur contrôlée", "intermarc": controlled_value_intermarc("ark:/cv/adapt", "A pour adaptation")},
        {
            "id": "cv-is-adapt",
            "type": "Valeur contrôlée",
            "intermarc": controlled_value_intermarc("ark:/cv/is-adapt", "Est une adaptation de"),
        },
        {"id": "w1", "type": "Oeuvre", "intermarc": _work_intermarc("ark:/w1", "Original")},
        {"id": "w2", "type": "Oeuvre", "intermarc": _work_intermarc("ark:/w2", "Adaptation")},
    ]
    db.ingest_csv(_records_to_csv_bytes(records), dataset_id)

    has_adapt = controlled_repo.get_controlled_ark_by_label(dataset_id, "A pour adaptation")
    is_adapt_of = controlled_repo.get_controlled_ark_by_label(dataset_id, "Est une adaptation de")
    assert has_adapt and is_adapt_of

    payload = create_intermarc_json(
        [
            create_zone("001", [("a", "ark:/w2", None)]),
            create_zone("150", [("a", "Adaptation", None)]),
            create_zone("552", [("q", is_adapt_of, None), ("3", "ark:/w1", None)]),
        ]
    )

    updates = db.update_record(dataset_id, "w2", type_raw="Oeuvre", intermarc_json=payload)
    assert any(u["id"] == "w1" for u in updates)

    w2 = next(rec for rec in db.load_records(dataset_id) if rec["id"] == "w2")
    zones_w2 = _find_zone(w2["intermarc"], "552")
    assert zones_w2 and zones_w2[0]["sousZones"][0]["code"] == "552$q"
    assert zones_w2[0]["sousZones"][0].get("affectedByCuration") == "manual"

    w1 = next(rec for rec in db.load_records(dataset_id) if rec["id"] == "w1")
    zones_w1 = _find_zone(w1["intermarc"], "552")
    assert any(sz.get("valeur") == "ark:/w2" for z in zones_w1 for sz in z.get("sousZones", []))
    assert zones_w1[0].get("affectedByCuration") == "manual"


def test_update_record_removes_reciprocal_adaptation_links():
    dataset_id = f"adaptation-links-{uuid4().hex[:8]}"
    datasets.ensure_dataset(dataset_id, title="adaptation links removal")

    records = [
        {"id": "cv-adapt", "type": "Valeur contrôlée", "intermarc": controlled_value_intermarc("ark:/cv/adapt", "A pour adaptation")},
        {
            "id": "cv-is-adapt",
            "type": "Valeur contrôlée",
            "intermarc": controlled_value_intermarc("ark:/cv/is-adapt", "Est une adaptation de"),
        },
        {
            "id": "w1",
            "type": "Oeuvre",
            "intermarc": create_intermarc_json(
                [
                    create_zone("001", [("a", "ark:/w1", None)]),
                    create_zone("150", [("a", "Original", None)]),
                    create_zone("552", [("q", "ark:/cv/adapt", "created"), ("3", "ark:/w2", "created")], "created"),
                ]
            ),
        },
        {
            "id": "w2",
            "type": "Oeuvre",
            "intermarc": create_intermarc_json(
                [
                    create_zone("001", [("a", "ark:/w2", None)]),
                    create_zone("150", [("a", "Adaptation", None)]),
                    create_zone("552", [("q", "ark:/cv/is-adapt", "created"), ("3", "ark:/w1", "created")], "created"),
                ]
            ),
        },
    ]
    db.ingest_csv(_records_to_csv_bytes(records), dataset_id)

    payload = create_intermarc_json(
        [
            create_zone("001", [("a", "ark:/w2", None)]),
            create_zone("150", [("a", "Adaptation", None)]),
        ]
    )

    updates = db.update_record(dataset_id, "w2", type_raw="Oeuvre", intermarc_json=payload)
    assert any(u["id"] == "w1" for u in updates)

    w1 = next(rec for rec in db.load_records(dataset_id) if rec["id"] == "w1")
    zones_w1 = _find_zone(w1["intermarc"], "552")
    assert zones_w1 == []

    w2 = next(rec for rec in db.load_records(dataset_id) if rec["id"] == "w2")
    zones_w2 = _find_zone(w2["intermarc"], "552")
    assert zones_w2 == []
