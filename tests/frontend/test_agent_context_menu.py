import re

import pytest
import requests
from playwright.sync_api import expect


APP_BASE = "http://localhost:5173"
API_BASE = "http://localhost:8000"


def _ensure_dataset_available(dataset_id: str) -> bool:
    try:
        resp = requests.get(f"{API_BASE}/api/datasets/{dataset_id}/records", timeout=5)
        resp.raise_for_status()
        return True
    except Exception:
        return False


@pytest.mark.e2e
def test_agent_right_click_menu_allows_clustering(page):
    dataset_id = "agent-lifecycle"
    if not _ensure_dataset_available(dataset_id):
        pytest.skip("agent-lifecycle dataset not reachable")

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
