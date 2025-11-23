import json

import pytest
from playwright.sync_api import expect


@pytest.mark.e2e
def test_intermarc_visible_via_slug_navigation(page):
    # Open first dataset from dashboard
    page.goto("http://localhost:5173/", wait_until="networkidle")
    open_buttons = page.locator("text=Ouvrir l'inspection")
    assert open_buttons.count() > 0, "No dataset available to open"
    open_buttons.first.click()

    # Wait for navigation into inspection
    expect(page).to_have_url(r"http://localhost:5173/.+")
    slug = page.url.rstrip("/").split("/")[-1]
    assert slug, "Slug missing after navigation"

    # Verify intermarc content via API (same store the UI uses)
    records = page.evaluate(
        """async (slug) => {
            const res = await fetch(`http://localhost:8000/api/datasets/${slug}/records`);
            if (!res.ok) throw new Error('records fetch failed');
            const data = await res.json();
            return data.records;
        }""",
        slug,
    )
    assert len(records) > 0, "No records returned for dataset"
    sample = records[0]
    intermarc = json.loads(sample["intermarc"])
    assert intermarc.get("zones"), "Intermarc zones empty"
    # 001$a should carry ark and must not be blank
    zone001 = next((z for z in intermarc["zones"] if z.get("code") == "001"), None)
    assert zone001, "Zone 001 missing"
    val_001a = next((sz.get("valeur") for sz in zone001.get("sousZones", []) if sz.get("code") == "001$a"), "")
    assert val_001a and isinstance(val_001a, str), "001$a missing or empty"

    # Quick UI sanity: Intermarc panel renders some content
    expect(page.locator("text=001$a")).to_be_visible()
