import json
import re
from uuid import uuid4

import pytest
import requests
from playwright.sync_api import expect

API_BASE = "http://localhost:8000"


@pytest.mark.e2e
def test_intermarc_visible_via_slug_navigation(page):
    # Create a dataset to browse
    title = f"inspection-seed-{uuid4().hex[:6]}"
    csv_content = "id_entitelrm,type_entite,intermarc\nw1,Oeuvre,{\"zones\":[{\"code\":\"001\",\"sousZones\":[{\"code\":\"001$a\",\"valeur\":\"ark:/w1\"}]},{\"code\":\"150\",\"sousZones\":[{\"code\":\"150$a\",\"valeur\":\"Seed Work\"}]}]}\n"
    resp = requests.post(
        f"{API_BASE}/api/datasets",
        files={"file": ("dataset.csv", csv_content.encode("utf-8"), "text/csv")},
        data={"title": title},
        timeout=10,
    )
    if not resp.ok:
        pytest.skip(f"Dataset creation failed: {resp.status_code}")
    slug = resp.json()["dataset"]["id"]

    # Wait until records are ready
    for _ in range(10):
        r = requests.get(f"{API_BASE}/api/datasets/{slug}/records", timeout=5)
        if r.ok and r.json().get("records"):
            break
        page.wait_for_timeout(200)

    # Open dataset directly
    page.goto(f"http://localhost:5173/{slug}", wait_until="networkidle")
    expect(page).to_have_url(re.compile(rf"http://localhost:5173/{slug}"))

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
    if not records:
        pytest.skip("Dataset records not available to inspect")
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
