import json
import sys
import csv
import io
from pathlib import Path
from typing import List, Tuple, Optional

# Ensure root is in path for imports if running directly
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data_curation.models import Intermarc, Zone, SousZone

def create_zone(code: str, subfields: List[Tuple[str, str, Optional[str]]], affected: Optional[str] = None) -> Zone:
    sous_zones = []
    for suffix, value, sub_aff in subfields:
        sz = SousZone(code=f"{code}${suffix}", valeur=value, affected_by_curation=sub_aff)
        sous_zones.append(sz)
    return Zone(code=code, sousZones=sous_zones, affected_by_curation=affected)

def create_intermarc_json(zones: List[Zone]) -> str:
    im = Intermarc(zones=zones)
    return im.to_json_string()

def _zone(code: str, subfields: List[Tuple[str, str, Optional[str]]], affected: Optional[str] = None) -> Zone:
    """Compat helper matching old signature but returning Zone object."""
    return create_zone(code, subfields, affected)

def _work_intermarc(ark: str, title: str, extra_zones: Optional[List[Zone]] = None) -> str:
    zones = [
        create_zone("001", [("a", ark, None)]),
        create_zone("150", [("a", title, None)]),
    ]
    if extra_zones:
        zones.extend(extra_zones)
    return create_intermarc_json(zones)

def _expression_intermarc(ark: str, parent: str, mode: str = "mode", form: str = "form", extra_zones: Optional[List[Zone]] = None) -> str:
    zones = [
        create_zone("001", [("a", ark, None)]),
        create_zone("140", [("m", mode, None), ("f", form, None), ("3", parent, None)]),
        create_zone("750", [("3", parent, None)]),
    ]
    if extra_zones:
        zones.extend(extra_zones)
    return create_intermarc_json(zones)

def _manifestation_intermarc(ark: str, expression: str, title: str, extra_zones: Optional[List[Zone]] = None) -> str:
    zones = [
        create_zone("001", [("a", ark, None)]),
        create_zone("245", [("a", title, None)]),
        create_zone("740", [("3", expression, None)]),
    ]
    if extra_zones:
        zones.extend(extra_zones)
    return create_intermarc_json(zones)

def _cluster_zone(target: str, *, note: str = "Clusterisation manuelle", affected: str = "created", target_suffix: Optional[str] = None) -> Zone:
    suffix = target_suffix or ("a" if note.strip().lower() == "clusterisation script" else "3")
    return create_zone("90F", [("q", note, affected), (suffix, target, affected)], affected)

def _adaptation_zone(target: str, *, qualifier: str, affected: str = "created") -> Zone:
    return create_zone("552", [("q", qualifier, affected), ("3", target, affected)], affected)

def _records_to_csv_bytes(records) -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["id_entitelrm", "type_entite", "intermarc"])
    for row in records:
        writer.writerow([row["id"], row["type"], row["intermarc"]])
    return buffer.getvalue().encode("utf-8")

# Constants
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
