# ruff: noqa: E402
import json
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

from tests.backend.utils import (
    _work_intermarc,
    _adaptation_zone,
    _records_to_csv_bytes,
    controlled_value_intermarc,
)


API_BASE = "http://localhost:8000"
APP_BASE = "http://localhost:5173"
HAS_ADAPT_ARK = "ark:/cv/hasAdapt"
IS_ADAPT_OF_ARK = "ark:/cv/isAdaptOf"


def _build_dataset() -> str:
    dataset_title = f"originality-swap-playwright-{uuid4().hex[:8]}"
    rows = [
        {
            "id": "w1",
            "type": "Oeuvre",
            "intermarc": _work_intermarc(
                "ark:/12148/w1",
                "Original Work",
                [
                    _adaptation_zone("ark:/12148/w2", qualifier=HAS_ADAPT_ARK),
                    _adaptation_zone("ark:/12148/w3", qualifier=HAS_ADAPT_ARK),
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

    payload = _records_to_csv_bytes(rows)
    resp = requests.post(
        f"{API_BASE}/api/datasets",
        files={"file": ("dataset.csv", payload, "text/csv")},
        data={"title": dataset_title},
        timeout=10,
    )
    if not resp.ok:
        pytest.skip(f"Dataset creation failed: {resp.status_code}")
    return resp.json()["dataset"]["id"]


@pytest.mark.e2e
def test_originality_swap_from_context_menu(page):
    try:
        requests.get(f"{API_BASE}/api/datasets", timeout=5).raise_for_status()
    except Exception:
        pytest.skip("Backend API not reachable")

    dataset_id = _build_dataset()

    page.goto(f"{APP_BASE}/{dataset_id}", wait_until="networkidle")
    page.wait_for_selector('[data-work-id="w1"]')

    page.locator('[data-work-id="w1"].cluster-header-row').first.click(button='right')
    menu = page.locator('.workspace-context-menu')
    expect(menu).to_be_visible()
    menu.get_by_role('menuitem', name=re.compile('originalit', re.IGNORECASE)).click()

    page.locator('[data-work-id="w4"].cluster-header-row').first.click(button='right')
    menu = page.locator('.workspace-context-menu')
    expect(menu).to_be_visible()
    menu.get_by_role('menuitem', name=re.compile('Enter l\'originalit|originality', re.IGNORECASE)).click()

    page.get_by_role('button', name=re.compile('Confirmer|Confirm', re.IGNORECASE)).click()
    expect(page.locator('.toast-message').last).to_contain_text(re.compile('Originalit', re.IGNORECASE))

    resp = requests.get(f"{API_BASE}/api/datasets/{dataset_id}/records", timeout=10)
    resp.raise_for_status()
    records = {rec["id"]: rec for rec in resp.json()["records"]}

    def _targets(zones, qualifier):
        return {
            sz.get("valeur")
            for z in zones
            if z.get("code") == "552" and any(sub.get("valeur") == qualifier for sub in z.get("sousZones", []) if sub.get("code") == "552$q")
            for sz in z.get("sousZones", [])
            if sz.get("code") == "552$3"
        }

    w4_zones = json.loads(records["w4"]["intermarc"])["zones"]
    assert {"ark:/12148/w2", "ark:/12148/w3"} <= _targets(w4_zones, HAS_ADAPT_ARK)

    w2_zones = json.loads(records["w2"]["intermarc"])["zones"]
    w3_zones = json.loads(records["w3"]["intermarc"])["zones"]
    assert _targets(w2_zones, IS_ADAPT_OF_ARK) == {"ark:/12148/w4"}
    assert _targets(w3_zones, IS_ADAPT_OF_ARK) == {"ark:/12148/w4"}
