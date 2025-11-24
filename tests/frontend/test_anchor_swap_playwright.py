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

from tests.backend.utils import (
    _cluster_zone,
    _expression_intermarc,
    _records_to_csv_bytes,
    _work_intermarc,
)

API_BASE = "http://localhost:8000"
APP_BASE = "http://localhost:5173"


def _build_dataset() -> str:
    dataset_title = f"anchor-swap-playwright-{uuid4().hex[:8]}"
    rows = [
        {"id": "w1", "type": "Oeuvre", "intermarc": _work_intermarc("ark:/w1", "Work One")},
        {"id": "w2", "type": "Oeuvre", "intermarc": _work_intermarc("ark:/w2", "Work Two")},
        {"id": "w3", "type": "Oeuvre", "intermarc": _work_intermarc("ark:/w3", "Work Three")},
        {"id": "w4", "type": "Oeuvre", "intermarc": _work_intermarc("ark:/w4", "Solo Work")},
        {
            "id": "e1",
            "type": "Expression",
            "intermarc": _expression_intermarc(
                "ark:/e1",
                "ark:/w1",
                extra_zones=[_cluster_zone("ark:/e2"), _cluster_zone("ark:/e3")],
            ),
        },
        {"id": "e2", "type": "Expression", "intermarc": _expression_intermarc("ark:/e2", "ark:/w1")},
        {"id": "e3", "type": "Expression", "intermarc": _expression_intermarc("ark:/e3", "ark:/w1")},
    ]

    # Make w1 the initial anchor
    rows[0]["intermarc"] = _work_intermarc("ark:/w1", "Work One", [_cluster_zone("ark:/w2"), _cluster_zone("ark:/w3")])

    payload = _records_to_csv_bytes(rows)

    resp = requests.post(
        f"{API_BASE}/api/datasets",
        files={"file": ("dataset.csv", payload, "text/csv")},
        data={"title": dataset_title},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()["dataset"]["id"]


@pytest.mark.e2e
def test_anchor_swap_flow(page):
    try:
        requests.get(f"{API_BASE}/api/datasets", timeout=5).raise_for_status()
    except Exception:
        pytest.skip("Backend API not reachable")

    dataset_id = _build_dataset()

    page.goto(f"{APP_BASE}/{dataset_id}", wait_until="networkidle")
    page.wait_for_selector('[data-work-id="w1"]')

    # No anchor swap action on unclustered work
    page.locator('[data-work-id="w4"].cluster-header-row').first.click(button='right')
    expect(
        page.locator('.workspace-context-menu').get_by_role('menuitem', name=re.compile('changement d', re.IGNORECASE))
    ).to_have_count(0)
    page.keyboard.press('Escape')

    # Prepare swap on clustered member
    page.locator('[data-work-id="w2"].cluster-item, [data-work-id="w2"].cluster-header-row').first.click(button='right')
    menu = page.locator('.workspace-context-menu')
    expect(menu).to_be_visible()
    menu.get_by_role('menuitem', name=re.compile('changement d', re.IGNORECASE)).click()

    # Attempt with non-anchor should toast
    page.locator('[data-work-id="w3"].cluster-item, [data-work-id="w3"].cluster-header-row').first.click(button='right')
    menu = page.locator('.workspace-context-menu')
    expect(menu).to_be_visible()
    menu.get_by_role('menuitem', name=re.compile('Effectuer', re.IGNORECASE)).click()
    expect(page.locator('.toast-message').last).to_contain_text("pas l'ancre")

    # Perform real swap with anchor w1
    page.locator('[data-work-id="w1"].cluster-header-row').first.click(button='right')
    menu = page.locator('.workspace-context-menu')
    expect(menu).to_be_visible()
    menu.get_by_role('menuitem', name=re.compile('Effectuer', re.IGNORECASE)).click()
    page.get_by_role('button', name=re.compile('Confirmer|Confirm', re.IGNORECASE)).click()

    page.wait_for_selector('[data-work-id="w2"].cluster-header-row')
    expect(page.locator('[data-work-id="w1"].cluster-item')).to_be_visible()

    # Open expressions panel
    page.locator('[data-work-id="w2"] .cluster-open-expressions').click()
    page.wait_for_selector('[data-expression-id="e1"]')

    # Prepare expression swap on member e2
    page.locator('[data-expression-id="e2"]:not(.expression-anchor)').first.click(button='right')
    menu = page.locator('.workspace-context-menu')
    expect(menu).to_be_visible()
    menu.get_by_role('menuitem', name=re.compile('changement d', re.IGNORECASE)).click()

    # Error when targeting non-anchor member
    page.locator('[data-expression-id="e3"]:not(.expression-anchor)').first.click(button='right')
    menu = page.locator('.workspace-context-menu')
    expect(menu).to_be_visible()
    menu.get_by_role('menuitem', name=re.compile('Effectuer', re.IGNORECASE)).click()
    expect(page.locator('.toast-message').last).to_contain_text("pas l'ancre")

    # Successful expression anchor swap
    page.locator('[data-expression-id="e1"]')
    page.locator('[data-expression-id="e1"].expression-anchor').first.click(button='right')
    menu = page.locator('.workspace-context-menu')
    expect(menu).to_be_visible()
    menu.get_by_role('menuitem', name=re.compile('Effectuer', re.IGNORECASE)).click()
    page.get_by_role('button', name=re.compile('Confirmer|Confirm', re.IGNORECASE)).click()

    page.wait_for_selector('[data-expression-id="e2"].expression-anchor')
