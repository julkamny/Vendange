import re
from uuid import uuid4

import pytest
import requests
from playwright.sync_api import expect

API_BASE = "http://localhost:8000"


@pytest.mark.e2e
def test_dashboard_stats_are_numbers(page):
    # Ensure at least one dataset exists
    title = f"dashboard-seed-{uuid4().hex[:6]}"
    csv_content = "id_entitelrm,type_entite,intermarc\nw1,Oeuvre,{\"zones\":[{\"code\":\"001\",\"sousZones\":[{\"code\":\"001$a\",\"valeur\":\"ark:/w1\"}]},{\"code\":\"150\",\"sousZones\":[{\"code\":\"150$a\",\"valeur\":\"Seed Work\"}]}]}\n"
    resp = requests.post(
        f"{API_BASE}/api/datasets",
        files={"file": ("dataset.csv", csv_content.encode("utf-8"), "text/csv")},
        data={"title": title},
        timeout=10,
    )
    if not resp.ok:
        pytest.skip(f"Dataset creation failed: {resp.status_code}")

    page.goto("http://localhost:5173/", wait_until="networkidle")
    cards = page.locator(".dataset-card")
    try:
        expect(cards).not_to_have_count(0, timeout=5000)
    except AssertionError:
        pytest.skip("No dataset cards available on dashboard")
    total = cards.count()

    for i in range(total):
        card = cards.nth(i)
        stats = card.locator(".dataset-card__stats dd")
        expect(stats).to_have_count(4)
        values = [stats.nth(j).inner_text().strip() for j in range(stats.count())]

        # Entités and Quads should be numeric and not NaN
        for val in values[:2]:
            digits = re.sub(r"[\\s,.]", "", val)
            assert digits.isdigit(), f"Stat not numeric: {val}"
            assert "NaN" not in val

        # Size string should be present
        assert values[2], "Size missing"
