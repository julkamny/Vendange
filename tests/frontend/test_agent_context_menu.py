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

from tests.backend.utils import create_intermarc_json, create_zone, _records_to_csv_bytes


APP_BASE = "http://localhost:5173"
API_BASE = "http://localhost:8000"


def _build_dataset() -> str:
    dataset_id = f"agent-context-{uuid4().hex[:8]}"
    agents = []
    for idx in range(1, 4):
        ark = f"ark:/12148/agent{idx}"
        zones = [
            create_zone("001", [("a", ark, None)]),
            create_zone("200", [("a", f"Agent {idx}", None)]),
            create_zone("100", [("a", f"Nom {idx}", None), ("m", f"NomM {idx}", None)]),
        ]
        agents.append({"id": f"a{idx}", "type": "Identite publique de personne", "intermarc": create_intermarc_json(zones)})

    payload = _records_to_csv_bytes(agents)
    resp = requests.post(
        f"{API_BASE}/api/datasets",
        files={"file": ("dataset.csv", payload, "text/csv")},
        data={"title": dataset_id},
        timeout=10,
    )
    if not resp.ok:
        pytest.skip(f"Dataset creation failed: {resp.status_code}")
    return resp.json()["dataset"]["id"]


@pytest.mark.e2e
def test_agent_right_click_menu_allows_clustering(page):
    try:
        requests.get(f"{API_BASE}/api/datasets", timeout=5).raise_for_status()
    except Exception:
        pytest.skip("Backend API not reachable")

    dataset_id = _build_dataset()

    page.goto(f"{APP_BASE}/{dataset_id}", wait_until="networkidle")

    page.locator("button.workspace-tab.add.add-toggle.workspace-add-toggle").click()
    page.locator(
        "button.workspace-add-menu__item",
        has=page.locator("span.workspace-add-menu__label", has_text=re.compile("Agents", re.IGNORECASE)),
    ).click()

    agents = page.locator("div.entity-row.entity-row--person")
    assert agents.count() >= 2, "Expected at least two agents to be loaded"

    # First right-click opens context menu with prepare action
    agents.nth(0).click(button="right")
    menu = page.locator(".workspace-context-menu")
    expect(menu).to_be_visible()
    expect(menu.get_by_role("menuitem", name=re.compile("Préparer|prepare", re.IGNORECASE))).to_be_visible()
    menu.get_by_role("menuitem", name=re.compile("Préparer|prepare", re.IGNORECASE)).click()

    # Second right-click offers clustering with the prepared agent
    agents.nth(1).click(button="right")
    expect(menu).to_be_visible()
    expect(menu.get_by_role("menuitem", name=re.compile("Clustériser|cluster", re.IGNORECASE))).to_be_visible()

    # Dismiss menu to leave workspace clean for later tests
    page.keyboard.press("Escape")
