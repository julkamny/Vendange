import csv
import io
import json
import re

import pytest
import requests
from playwright.sync_api import expect


API_BASE = "http://localhost:8000"
APP_BASE = "http://localhost:5173"


def _zone(code: str, subs):
    return {"code": code, "sousZones": subs}


def _cluster_zone(target: str):
    return {
        "code": "90F",
        "affectedByCuration": "created",
        "sousZones": [
            {"code": "90F$q", "valeur": "Clusterisation manuelle", "affectedByCuration": "created"},
            {"code": "90F$3", "valeur": target, "affectedByCuration": "created"},
        ],
    }


def _work_im(ark: str, title: str, extra=None) -> str:
    zones = [
        _zone("001", [{"code": "001$a", "valeur": ark}]),
        _zone("150", [{"code": "150$a", "valeur": title}]),
    ]
    zones.extend(extra or [])
    return json.dumps({"zones": zones}, ensure_ascii=False)


def _expr_im(ark: str, parent: str, extra=None) -> str:
    zones = [
        _zone("001", [{"code": "001$a", "valeur": ark}]),
        _zone("140", [{"code": "140$m", "valeur": "m"}, {"code": "140$f", "valeur": "f"}, {"code": "140$3", "valeur": parent}]),
        _zone("750", [{"code": "750$3", "valeur": parent}]),
    ]
    zones.extend(extra or [])
    return json.dumps({"zones": zones}, ensure_ascii=False)


def _build_dataset() -> str:
    rows = [
        {"id": "w1", "type": "Oeuvre", "intermarc": _work_im("ark:/w1", "Work One")},
        {"id": "w2", "type": "Oeuvre", "intermarc": _work_im("ark:/w2", "Work Two")},
        {"id": "w3", "type": "Oeuvre", "intermarc": _work_im("ark:/w3", "Work Three")},
        {"id": "w4", "type": "Oeuvre", "intermarc": _work_im("ark:/w4", "Solo Work")},
        {
            "id": "e1",
            "type": "Expression",
            "intermarc": _expr_im("ark:/e1", "ark:/w1", [_cluster_zone("ark:/e2"), _cluster_zone("ark:/e3")]),
        },
        {"id": "e2", "type": "Expression", "intermarc": _expr_im("ark:/e2", "ark:/w1")},
        {"id": "e3", "type": "Expression", "intermarc": _expr_im("ark:/e3", "ark:/w1")},
    ]

    # Make w1 the initial anchor
    rows[0]["intermarc"] = _work_im("ark:/w1", "Work One", [_cluster_zone("ark:/w2"), _cluster_zone("ark:/w3")])

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["id_entitelrm", "type_entite", "intermarc"])
    for row in rows:
        writer.writerow([row["id"], row["type"], row["intermarc"]])

    resp = requests.post(
        f"{API_BASE}/api/datasets",
        files={"file": ("dataset.csv", buf.getvalue().encode("utf-8"), "text/csv")},
        data={"title": "anchor-swap-playwright"},
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
    page.locator('[data-work-id="w4"]').click(button='right')
    expect(
        page.locator('.workspace-context-menu').get_by_role('button', name=re.compile('changement d', re.IGNORECASE))
    ).to_have_count(0)
    page.keyboard.press('Escape')

    # Prepare swap on clustered member
    page.locator('[data-work-id="w2"]').click(button='right')
    page.get_by_role('button', name=re.compile('changement d', re.IGNORECASE)).click()

    # Attempt with non-anchor should toast
    page.locator('[data-work-id="w3"]').click(button='right')
    page.get_by_role('button', name=re.compile('Effectuer', re.IGNORECASE)).click()
    expect(page.locator('.toast-message').last).to_contain_text("pas l'ancre")

    # Perform real swap with anchor w1
    page.locator('[data-work-id="w1"].cluster-header-row').click(button='right')
    page.get_by_role('button', name=re.compile('Effectuer', re.IGNORECASE)).click()
    page.get_by_role('button', name=re.compile('Confirmer', re.IGNORECASE)).click()

    page.wait_for_selector('[data-work-id="w2"].cluster-header-row')
    expect(page.locator('[data-work-id="w1"].cluster-item')).to_be_visible()

    # Open expressions panel
    page.locator('[data-work-id="w2"] .cluster-open-expressions').click()
    page.wait_for_selector('[data-expression-id="e1"]')

    # Prepare expression swap on member e2
    page.locator('[data-expression-id="e2"]').click(button='right')
    page.get_by_role('button', name=re.compile('changement d', re.IGNORECASE)).click()

    # Error when targeting non-anchor member
    page.locator('[data-expression-id="e3"]').click(button='right')
    page.get_by_role('button', name=re.compile('Effectuer', re.IGNORECASE)).click()
    expect(page.locator('.toast-message').last).to_contain_text("pas l'ancre")

    # Successful expression anchor swap
    page.locator('[data-expression-id="e1"]')
    page.locator('[data-expression-id="e1"]').click(button='right')
    page.get_by_role('button', name=re.compile('Effectuer', re.IGNORECASE)).click()
    page.get_by_role('button', name=re.compile('Confirmer', re.IGNORECASE)).click()

    page.wait_for_selector('[data-expression-id="e2"].expression-anchor')
