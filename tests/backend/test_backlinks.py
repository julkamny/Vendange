import sys
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data_curation.api import db, datasets  # noqa: E402
from data_curation.curation.cluster_views import WorkspaceViewBuilder  # noqa: E402
from tests.backend.utils import (  # noqa: E402
    EXPRESSIONS,
    MANIFESTATIONS,
    WORKS,
    _expression_intermarc,
    _manifestation_intermarc,
    _records_to_csv_bytes,
    _work_intermarc,
    create_intermarc_json,
    create_zone,
)


def _base_records():
    rows = []
    for wid, info in WORKS.items():
        rows.append({"id": wid, "type": "Oeuvre", "intermarc": _work_intermarc(info["ark"], info["title"])})
    for eid, info in EXPRESSIONS.items():
        rows.append(
            {"id": eid, "type": "Expression", "intermarc": _expression_intermarc(info["ark"], info["parent"], info["m"], info["f"])}
        )
    for mid, info in MANIFESTATIONS.items():
        rows.append(
            {"id": mid, "type": "Manifestation", "intermarc": _manifestation_intermarc(info["ark"], info["expression"], info["title"])}
        )
    return rows


def _build_dataset(records):
    dataset_id = f"backlinks-{uuid4().hex[:8]}"
    datasets.ensure_dataset(dataset_id, title="backlinks")
    db.ingest_csv(_records_to_csv_bytes(records), dataset_id)
    return dataset_id


def test_backlinks_across_wem_entities():
    dataset_id = _build_dataset(_base_records())
    builder = WorkspaceViewBuilder.from_dataset(dataset_id)

    payload = builder.backlinks_payload_for_key("ark:/12148/w1")
    assert payload is not None
    assert payload.target_id == "w1"
    assert len(payload.backlinks) == 1

    entry = payload.backlinks[0]
    assert entry.id == "e1"
    assert set(entry.fields) == {"140", "750"}

    expression_payload = builder.backlinks_payload_for_key("ark:/12148/e1")
    assert expression_payload is not None
    assert len(expression_payload.backlinks) == 1
    assert expression_payload.backlinks[0].id == "m1"
    assert expression_payload.backlinks[0].fields == ["740"]


def test_backlinks_include_agents():
    agent_ark = "ark:/12148/a1"
    agent_zone = create_zone("150", [("a", "Agent One", None)])
    agent_record = {
        "id": "a1",
        "type": "Identite publique de personne",
        "intermarc": create_intermarc_json([create_zone("001", [("a", agent_ark, None)]), agent_zone]),
    }

    work_zone = create_zone("700", [("3", agent_ark, None)])
    linked_work = {"id": "wa", "type": "Oeuvre", "intermarc": _work_intermarc("ark:/12148/wa", "Linked Work", [work_zone])}

    records = _base_records() + [agent_record, linked_work]
    dataset_id = _build_dataset(records)
    builder = WorkspaceViewBuilder.from_dataset(dataset_id)

    payload = builder.backlinks_payload_for_key(agent_ark)
    assert payload is not None
    assert payload.target_id == "a1"
    assert len(payload.backlinks) == 1
    assert payload.backlinks[0].id == "wa"
    assert payload.backlinks[0].fields == ["700"]
