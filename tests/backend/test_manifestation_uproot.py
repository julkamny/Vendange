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
from data_curation.curation.operations import _build_controlled_value_lookup

from .utils import (
    _expression_intermarc,
    _manifestation_intermarc,
    _records_to_csv_bytes,
    _work_intermarc,
    create_intermarc_json,
    create_zone,
)


def _rewrite_manifestation_links(intermarc_json: str, *, remove: list[str], add: str, partial_ark: str | None = None) -> str:
    payload = json.loads(intermarc_json)
    next_zones = []
    for zone in payload.get("zones", []):
        if zone.get("code") != "740":
            next_zones.append(zone)
            continue
        remaining = [
            sz
            for sz in zone.get("sousZones", [])
            if not (sz.get("code") == "740$3" and sz.get("valeur") in remove)
        ]
        if remaining:
            next_zones.append({**zone, "sousZones": remaining})
    new_zone = {
        "code": "740",
        "sousZones": [{"code": "740$3", "valeur": add}],
    }
    if partial_ark:
        new_zone["sousZones"].append({"code": "740$q", "valeur": partial_ark})
    next_zones.append(new_zone)
    return json.dumps({"zones": next_zones}, ensure_ascii=False)


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

    lookup = _build_controlled_value_lookup(db.load_entities(dataset_id))
    partial_ark = lookup.get("Partiellement")
    assert partial_ark, "Expected controlled value for 'Partiellement'"

    current = next(rec for rec in db.load_records(dataset_id) if rec["id"] == "m1")
    rewritten = _rewrite_manifestation_links(
        current["intermarc"], remove=["ark:/e1", "ark:/e2"], add="ark:/e3", partial_ark=partial_ark
    )
    db.update_record(dataset_id, "m1", type_raw="Manifestation", intermarc_json=rewritten)

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
