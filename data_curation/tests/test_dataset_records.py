import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data_curation.api import db, datasets  # noqa: E402

pytest_plugins = ["data_curation.tests.test_cluster_guards"]


def test_dataset_stats_and_records_have_intermarc(dataset_builder):
    dataset_id = dataset_builder("records-visible")

    stats = db.dataset_stats(dataset_id)
    assert stats["entity_count"] >= 12
    assert stats["quad_count"] > stats["entity_count"]
    assert stats["size_bytes"] > 0

    records = db.load_records(dataset_id)
    assert len(records) >= 12
    sample = records[0]
    # intermarc should be valid JSON with zones present
    payload = json.loads(sample["intermarc"])
    assert "zones" in payload and len(payload["zones"]) > 0

    # Keep dataset on disk for inspection
    assert datasets.dataset_directory(dataset_id).exists()
