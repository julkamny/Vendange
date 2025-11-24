import pytest
import sys
from pathlib import Path
from uuid import uuid4

# Ensure root is in path
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data_curation.api import db, datasets
from .utils import (
    WORKS, EXPRESSIONS, MANIFESTATIONS,
    _work_intermarc, _expression_intermarc, _manifestation_intermarc,
    _records_to_csv_bytes
)

def _base_records():
    rows = []
    for wid, info in WORKS.items():
        rows.append({"id": wid, "type": "Oeuvre", "intermarc": _work_intermarc(info["ark"], info["title"])})
    for eid, info in EXPRESSIONS.items():
        rows.append({"id": eid, "type": "Expression", "intermarc": _expression_intermarc(info["ark"], info["parent"], info["m"], info["f"])})
    for mid, info in MANIFESTATIONS.items():
        rows.append({"id": mid, "type": "Manifestation", "intermarc": _manifestation_intermarc(info["ark"], info["expression"], info["title"])})
    return rows

@pytest.fixture
def dataset_builder():
    base = _base_records()

    def _build(name_prefix: str) -> str:
        dataset_id = f"{name_prefix}-{uuid4().hex[:8]}"
        datasets.ensure_dataset(dataset_id, title=f"guards {name_prefix}")
        db.ingest_csv(_records_to_csv_bytes(base), dataset_id)
        return dataset_id

    return _build
