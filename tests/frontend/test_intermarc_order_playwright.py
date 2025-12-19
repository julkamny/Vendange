# ruff: noqa: E402
import re
import sys
from pathlib import Path
from uuid import uuid4

import pytest
import requests
from playwright.sync_api import expect

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tests.backend.utils import create_intermarc_json, create_zone, _records_to_csv_bytes  # noqa: E402

API_BASE = "http://localhost:8000"
APP_BASE = "http://localhost:5173"
WORK_ID = "w-order"


def _build_dataset() -> str:
    dataset_title = f"intermarc-order-{uuid4().hex[:8]}"

    alternating_subfields = []
    for idx in range(10):
        alternating_subfields.append(("a", f"Main part {idx + 1:02d}", None))
        alternating_subfields.append(("b", f"Subtitle {idx + 1:02d}", None))

    zones = [
        create_zone("001", [("a", "ark:/order-work", None)]),
        create_zone("010", [("a", "isbn-010", None)]),
        create_zone("015", [("a", "dep-legal", None)]),
        create_zone("051", [("a", "zone-051", None)]),
        create_zone("150", [("a", "Intermarc Ordering Fixture", None)]),
        create_zone("245", alternating_subfields),
        create_zone("609", [("a", "zone-609", None)]),
        create_zone("610", [("a", "zone-610", None)]),
        create_zone("627", [("a", "zone-627", None)]),
        create_zone("62J", [("a", "zone-62J", None)]),
        create_zone("62T", [("a", "zone-62T", None)]),
        create_zone("690", [("a", "zone-690", None)]),
        create_zone("700", [("3", "ark:/agent-order", None), ("4", "Auteur du texte", None)]),
        create_zone("901", [("a", "storage-901", None)]),
        create_zone(
            "907",
            [
                ("a", "storage-907", None),
                ("b", "storage-907-b", None),
            ],
        ),
        create_zone(
            "991",
            [
                ("o", "GEA", None),
                ("aa", "ark:/12148/cb100002441q", None),
                ("ab", "907", None),
                ("a", "00142621X", None),
                ("b", "ATU", None),
            ],
        ),
        create_zone("909", [("a", "zone-909", None)]),
        create_zone("90F", [("q", "Clusterisation script", "script"), ("3", "ark:/target-work", "script")], affected="script"),
        create_zone("981", [("a", "zone-981", None)]),
    ]

    payload = _records_to_csv_bytes(
        [
          {
            "id": WORK_ID,
            "type": "Oeuvre",
            "intermarc": create_intermarc_json(zones),
          }
        ]
    )

    resp = requests.post(
        f"{API_BASE}/api/datasets",
        files={"file": ("dataset.csv", payload, "text/csv")},
        data={"title": dataset_title},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()["dataset"]["id"]


@pytest.mark.e2e
def test_intermarc_field_and_subfield_order(page):
    try:
        requests.get(f"{API_BASE}/api/datasets", timeout=20).raise_for_status()
    except Exception:
        pytest.skip("Backend API not reachable")

    dataset_id = _build_dataset()

    page.goto(f"{APP_BASE}/{dataset_id}", wait_until="networkidle")
    page.wait_for_selector(f'[data-work-id="{WORK_ID}"]')
    page.locator(f'[data-work-id="{WORK_ID}"] .cluster-header').click()
    page.wait_for_selector('.intermarc-view .cm-content')
    expect(page.locator('.intermarc-view .cm-content')).to_contain_text("245 $a")

    intermarc_text = page.locator('.intermarc-view .cm-content').inner_text()
    lines = [line.strip() for line in intermarc_text.split('\n') if line.strip()]
    codes = [line.split(' ', 1)[0] for line in lines]

    expected_codes = [
        "001",
        "010",
        "015",
        "051",
        "150",
        "245",
        "609",
        "610",
        "627",
        "62J",
        "62T",
        "690",
        "700",
        "901",
        "907",
        "991",
        "909",
        "90F",
        "981",
    ]

    assert codes == expected_codes

    line_245 = next((line for line in lines if line.startswith("245 ")), "")
    assert line_245, "245 line missing from intermarc view"
    subfields = re.findall(r"\$[0-9A-Za-z]+", line_245)
    expected_subfields = ["$a" if idx % 2 == 0 else "$b" for idx in range(20)]
    assert subfields == expected_subfields

    assert any(line.startswith("901 ") and "storage-901" in line for line in lines)
    assert any(line.startswith("907 ") and "storage-907" in line for line in lines)

    line_991 = next((line for line in lines if line.startswith("991 ")), "")
    assert line_991, "991 line missing from intermarc view"
    sub_991 = re.findall(r"\$[0-9A-Za-z]+", line_991)
    assert sub_991 == ["$o", "$aa", "$ab", "$a", "$b"]
    assert all(value in line_991 for value in ["GEA", "ark:/12148/cb100002441q", "907", "00142621X", "ATU"])
