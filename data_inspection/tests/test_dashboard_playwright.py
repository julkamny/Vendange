import re

import pytest
from playwright.sync_api import expect


@pytest.mark.e2e
def test_dashboard_stats_are_numbers(page):
    page.goto("http://localhost:5173/", wait_until="networkidle")
    cards = page.locator(".dataset-card")
    total = cards.count()
    assert total > 0, "No dataset cards found on dashboard"

    for i in range(total):
        card = cards.nth(i)
        stats = card.locator(".dataset-card__stats dd")
        expect(stats).to_have_count(4)
        values = [stats.nth(j).inner_text().strip() for j in range(stats.count())]

        # Entités and Quads should be numeric and not NaN
        for val in values[:2]:
            assert re.match(r"^-?\\d[\\d\\s,.]*$", val), f"Stat not numeric: {val}"
            assert "NaN" not in val

        # Size should not be 0 MB/KB
        assert not re.match(r"^0(\\.0+)?\\s*(MB|KB)$", values[2]), f"Size unexpectedly zero: {values[2]}"
