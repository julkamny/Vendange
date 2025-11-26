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
    create_zone,
    create_intermarc_json,
    _cluster_zone,
)

def _agent_intermarc(ark: str, name: str, *, name_a: str | None = None, name_m: str | None = None, extra_zones=None) -> str:
    zones = [
        create_zone("001", [("a", ark, None)]),
        create_zone("200", [("a", name, None)]),
        create_zone("100", [
            ("a", name_a or name, None),
            ("m", name_m or f"{name}-m", None),
        ]),
    ]
    if extra_zones:
        zones.extend(extra_zones)
    return create_intermarc_json(zones)

def _build_dataset(records, name: str | None = None):
    import csv
    import io

    def _records_to_csv_bytes(records) -> bytes:
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(["id_entitelrm", "type_entite", "intermarc"])
        for row in records:
            writer.writerow([row["id"], row["type"], row["intermarc"]])
        return buffer.getvalue().encode("utf-8")

    suffix = uuid4().hex[:8]
    dataset_id = f"{name}-{suffix}" if name else f"agent-clustering-{suffix}"
    datasets.ensure_dataset(dataset_id, title=name)
    db.ingest_csv(_records_to_csv_bytes(records), dataset_id)
    return dataset_id

def test_agent_clustering_lifecycle():
    # 1. Spawn four agents
    agents = [
        {
            "id": "a1",
            "type": "Identite publique de personne",
            "intermarc": _agent_intermarc(
                "ark:/12148/a1",
                "Agent One",
                name_a="Pierre",
                name_m="Dupont",
            ),
        },
        {
            "id": "a2",
            "type": "Identite publique de personne",
            "intermarc": _agent_intermarc(
                "ark:/12148/a2",
                "Agent Two",
                name_a="Isabelle",
                name_m="Palinot",
            ),
        },
        {
            "id": "a3",
            "type": "Identite publique de personne",
            "intermarc": _agent_intermarc(
                "ark:/12148/a3",
                "Agent Three",
                name_a="Louis",
                name_m="Mercier",
            ),
        },
        {
            "id": "a4",
            "type": "Identite publique de personne",
            "intermarc": _agent_intermarc(
                "ark:/12148/a4",
                "Agent Four",
                name_a="Amelie",
                name_m="Girard",
            ),
        },
    ]
    dataset_id = _build_dataset(agents, "agent-lifecycle")

    # 2. Cluster A2, A3, A4 under A1 (A1 is anchor)
    # We update A1 to include 90F fields pointing to A2, A3, A4
    cluster_zones = [
        _cluster_zone("ark:/12148/a2"),
        _cluster_zone("ark:/12148/a3"),
        _cluster_zone("ark:/12148/a4"),
    ]
    a1_clustered = _agent_intermarc("ark:/12148/a1", "Agent One", extra_zones=cluster_zones)
    db.update_record(dataset_id, "a1", type_raw="Identite publique de personne", intermarc_json=a1_clustered)

    # Verify A1 has 3 targets
    records = {rec["id"]: rec for rec in db.load_records(dataset_id)}
    a1_im = json.loads(records["a1"]["intermarc"])
    targets_a1 = {
        sz.get("valeur")
        for z in a1_im["zones"]
        if z.get("code") == "90F"
        for sz in z.get("sousZones", [])
        if sz.get("code") in {"90F$3", "90F$a"}
    }
    assert targets_a1 == {"ark:/12148/a2", "ark:/12148/a3", "ark:/12148/a4"}

    # 3. Remove W2 (A2) from cluster
    # We update A1 to remove A2 from 90F
    cluster_zones_minus_a2 = [
        _cluster_zone("ark:/12148/a3"),
        _cluster_zone("ark:/12148/a4"),
    ]
    a1_minus_a2 = _agent_intermarc("ark:/12148/a1", "Agent One", extra_zones=cluster_zones_minus_a2)
    db.update_record(dataset_id, "a1", type_raw="Identite publique de personne", intermarc_json=a1_minus_a2)

    # Verify A1 has A3, A4
    records = {rec["id"]: rec for rec in db.load_records(dataset_id)}
    a1_im = json.loads(records["a1"]["intermarc"])
    targets_a1 = {
        sz.get("valeur")
        for z in a1_im["zones"]
        if z.get("code") == "90F"
        for sz in z.get("sousZones", [])
        if sz.get("code") in {"90F$3", "90F$a"}
    }
    assert targets_a1 == {"ark:/12148/a3", "ark:/12148/a4"}

    # 4. Remove W3 (A3) from cluster
    cluster_zones_minus_a3 = [
        _cluster_zone("ark:/12148/a4"),
    ]
    a1_minus_a3 = _agent_intermarc("ark:/12148/a1", "Agent One", extra_zones=cluster_zones_minus_a3)
    db.update_record(dataset_id, "a1", type_raw="Identite publique de personne", intermarc_json=a1_minus_a3)

    # Verify A1 has only A4
    records = {rec["id"]: rec for rec in db.load_records(dataset_id)}
    a1_im = json.loads(records["a1"]["intermarc"])
    targets_a1 = {
        sz.get("valeur")
        for z in a1_im["zones"]
        if z.get("code") == "90F"
        for sz in z.get("sousZones", [])
        if sz.get("code") in {"90F$3", "90F$a"}
    }
    assert targets_a1 == {"ark:/12148/a4"}

    # 5. Cluster A3 under A2 (A2 is anchor)
    # A2 and A3 are currently free.
    cluster_zones_a2 = [
        _cluster_zone("ark:/12148/a3"),
    ]
    a2_clustered = _agent_intermarc("ark:/12148/a2", "Agent Two", extra_zones=cluster_zones_a2)
    db.update_record(dataset_id, "a2", type_raw="Identite publique de personne", intermarc_json=a2_clustered)

    # Verify two clusters: A1->A4 and A2->A3
    records = {rec["id"]: rec for rec in db.load_records(dataset_id)}
    
    # Check A1 -> A4
    a1_im = json.loads(records["a1"]["intermarc"])
    targets_a1 = {
        sz.get("valeur")
        for z in a1_im["zones"]
        if z.get("code") == "90F"
        for sz in z.get("sousZones", [])
        if sz.get("code") in {"90F$3", "90F$a"}
    }
    assert targets_a1 == {"ark:/12148/a4"}

    # Check A2 -> A3
    a2_im = json.loads(records["a2"]["intermarc"])
    targets_a2 = {
        sz.get("valeur")
        for z in a2_im["zones"]
        if z.get("code") == "90F"
        for sz in z.get("sousZones", [])
        if sz.get("code") in {"90F$3", "90F$a"}
    }
    assert targets_a2 == {"ark:/12148/a3"}

def test_cluster_with_already_clustered_member_is_forbidden():
    # 1. Spawn agents A1, A2, A3
    agents = [
        {
            "id": "a1",
            "type": "Identite publique de personne",
            "intermarc": _agent_intermarc("ark:/12148/a1", "Agent One"),
        },
        {
            "id": "a2",
            "type": "Identite publique de personne",
            "intermarc": _agent_intermarc("ark:/12148/a2", "Agent Two"),
        },
        {
            "id": "a3",
            "type": "Identite publique de personne",
            "intermarc": _agent_intermarc("ark:/12148/a3", "Agent Three"),
        },
    ]
    dataset_id = _build_dataset(agents, "agent-nested-cluster-fail")

    # 2. Cluster A2 under A1
    a1_clustered = _agent_intermarc("ark:/12148/a1", "Agent One", extra_zones=[_cluster_zone("ark:/12148/a2")])
    db.update_record(dataset_id, "a1", type_raw="Identite publique de personne", intermarc_json=a1_clustered)

    # 3. Try to cluster A3 under A2
    # This would make A2 an anchor for A3, while A2 is a member of A1
    a2_as_anchor = _agent_intermarc("ark:/12148/a2", "Agent Two", extra_zones=[_cluster_zone("ark:/12148/a3")])
    
    import pytest
    with pytest.raises(ValueError, match="est deja rattache au cluster"):
        db.update_record(dataset_id, "a2", type_raw="Identite publique de personne", intermarc_json=a2_as_anchor)
