# ruff: noqa: E402
import json
import sys
from pathlib import Path
from uuid import uuid4

# Ensure repo root is importable
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data_curation.api import db, datasets
from data_curation.api.pg import controlled_repo
from data_curation.api.manifestation_uproot import uproot_manifestation
import pytest

from .utils import (
    _expression_intermarc,
    _manifestation_intermarc,
    _records_to_csv_bytes,
    _work_intermarc,
    controlled_value_intermarc,
    create_intermarc_json,
    create_zone,
)


def test_manifestation_uproot_and_attach_updates_740_links():
    dataset_id = f"manifestation-uproot-{uuid4().hex[:8]}"
    datasets.ensure_dataset(dataset_id, title="manifestation uproot")

    rows = [
        {"id": "w1", "type": "Oeuvre", "intermarc": _work_intermarc("ark:/w1", "Work One")},
        {"id": "e1", "type": "Expression", "intermarc": _expression_intermarc("ark:/e1", "ark:/w1")},
        {"id": "e2", "type": "Expression", "intermarc": _expression_intermarc("ark:/e2", "ark:/w1")},
        {"id": "e3", "type": "Expression", "intermarc": _expression_intermarc("ark:/e3", "ark:/w1")},
        {
            "id": "m1",
            "type": "Manifestation",
            "intermarc": _manifestation_intermarc(
                "ark:/m1",
                "ark:/e1",
                "Manifestation M1",
                extra_zones=[create_zone("740", [("3", "ark:/e2", None)])],
            ),
        },
        {
            "id": "cv-partial",
            "type": "Valeur contrôlée",
            "intermarc": create_intermarc_json(
                [
                    create_zone("001", [("a", "ark:/cv/partiellement", None)]),
                    create_zone("169", [("a", "Partiellement", None)]),
                ]
            ),
        },
    ]
    db.ingest_csv(_records_to_csv_bytes(rows), dataset_id)

    partial_ark = controlled_repo.get_controlled_ark_by_label(dataset_id, "Partiellement")
    assert partial_ark, "Expected controlled value for 'Partiellement'"

    uproot_manifestation(
        dataset_id,
        manifestation_id="m1",
        target_expression_id=None,
        target_expression_ark="ark:/e3",
        detach_arks=["ark:/e1", "ark:/e2"],
        partial_ark=None,
        partial_requested=True,
    )

    stored = json.loads(next(rec for rec in db.load_records(dataset_id) if rec["id"] == "m1")["intermarc"])
    targets = [
        sz.get("valeur")
        for zone in stored.get("zones", [])
        if zone.get("code") == "740"
        for sz in zone.get("sousZones", [])
        if sz.get("code") == "740$3"
    ]

    assert targets == ["ark:/e3"]
    has_partial = any(
        sz.get("code") == "740$q" and sz.get("valeur") == partial_ark
        for zone in stored.get("zones", [])
        if zone.get("code") == "740"
        for sz in zone.get("sousZones", [])
    )
    assert has_partial


def test_update_record_rejects_740_removal():
    dataset_id = f"manifestation-uproot-{uuid4().hex[:8]}"
    datasets.ensure_dataset(dataset_id, title="manifestation uproot rejection")

    rows = [
        {"id": "w1", "type": "Oeuvre", "intermarc": _work_intermarc("ark:/w1", "Work One")},
        {"id": "e1", "type": "Expression", "intermarc": _expression_intermarc("ark:/e1", "ark:/w1")},
        {"id": "m1", "type": "Manifestation", "intermarc": _manifestation_intermarc("ark:/m1", "ark:/e1", "M1")},
    ]
    db.ingest_csv(_records_to_csv_bytes(rows), dataset_id)

    payload = create_intermarc_json(
        [
            create_zone("001", [("a", "ark:/m1", None)]),
            create_zone("245", [("a", "M1", None)]),
        ]
    )
    # drop 740 to simulate removal
    with pytest.raises(ValueError):
        db.update_record(dataset_id, "m1", type_raw="Manifestation", intermarc_json=payload)


def test_update_record_adds_740_and_keeps_existing_links():
    dataset_id = f"manifestation-uproot-{uuid4().hex[:8]}"
    datasets.ensure_dataset(dataset_id, title="manifestation uproot addition")

    rows = [
        {"id": "w1", "type": "Oeuvre", "intermarc": _work_intermarc("ark:/w1", "Work One")},
        {"id": "w2", "type": "Oeuvre", "intermarc": _work_intermarc("ark:/w2", "Work Two")},
        {"id": "e1", "type": "Expression", "intermarc": _expression_intermarc("ark:/e1", "ark:/w1")},
        {"id": "e2", "type": "Expression", "intermarc": _expression_intermarc("ark:/e2", "ark:/w2")},
        {"id": "m1", "type": "Manifestation", "intermarc": _manifestation_intermarc("ark:/m1", "ark:/e1", "M1")},
        {
            "id": "cv-partial",
            "type": "Valeur contrôlée",
            "intermarc": controlled_value_intermarc("ark:/cv/partiellement", "Partiellement"),
        },
    ]
    db.ingest_csv(_records_to_csv_bytes(rows), dataset_id)

    partial_ark = controlled_repo.get_controlled_ark_by_label(dataset_id, "Partiellement") or "Partiellement"

    payload_zones = [
        create_zone("001", [("a", "ark:/m1", None)]),
        create_zone("245", [("a", "M1", None)]),
        create_zone("740", [("3", "ark:/e1", None)]),
        create_zone("740", [("3", "ark:/e2", None), ("q", "placeholder", None)]),
    ]
    payload = create_intermarc_json(payload_zones)
    db.update_record(dataset_id, "m1", type_raw="Manifestation", intermarc_json=payload)

    stored = next(rec for rec in db.load_records(dataset_id) if rec["id"] == "m1")
    assert "ark:/e1" in stored["intermarc"]
    assert "ark:/e2" in stored["intermarc"]
    assert partial_ark in stored["intermarc"]
