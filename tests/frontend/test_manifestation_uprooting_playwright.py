import csv
import io
import json
import re
from uuid import uuid4

import pytest
import requests
from playwright.sync_api import expect

API_BASE = "http://localhost:8000"
APP_BASE = "http://localhost:5173"


def _zone(code: str, subs):
    return {"code": code, "sousZones": subs}


def _work_im(ark: str, title: str):
    zones = [
        _zone("001", [{"code": "001$a", "valeur": ark}]),
        _zone("150", [{"code": "150$a", "valeur": title}]),
    ]
    return json.dumps({"zones": zones}, ensure_ascii=False)


def _expr_im(ark: str, parent_work_ark: str):
    zones = [
        _zone("001", [{"code": "001$a", "valeur": ark}]),
        _zone("140", [{"code": "140$m", "valeur": "m"}, {"code": "140$3", "valeur": parent_work_ark}]),
        _zone("750", [{"code": "750$3", "valeur": parent_work_ark}]),
    ]
    return json.dumps({"zones": zones}, ensure_ascii=False)


def _mani_im(ark: str, expressions: list[str]):
    zones = [
        _zone("001", [{"code": "001$a", "valeur": ark}]),
        _zone("245", [{"code": "245$a", "valeur": "Manifestation M1"}]),
    ]
    for expr in expressions:
        zones.append(_zone("740", [{"code": "740$3", "valeur": expr}]))
    return json.dumps({"zones": zones}, ensure_ascii=False)


def _build_dataset() -> str:
    dataset_title = f"uproot-playwright-{uuid4().hex[:8]}"
    rows = [
        {"id": "w1", "type": "Oeuvre", "intermarc": _work_im("ark:/w1", "Work One")},
        {"id": "e1", "type": "Expression", "intermarc": _expr_im("ark:/e1", "ark:/w1")},
        {"id": "e2", "type": "Expression", "intermarc": _expr_im("ark:/e2", "ark:/w1")},
        {"id": "e3", "type": "Expression", "intermarc": _expr_im("ark:/e3", "ark:/w1")},
        {"id": "m1", "type": "Manifestation", "intermarc": _mani_im("ark:/m1", ["ark:/e1", "ark:/e2"])},
    ]

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["id_entitelrm", "type_entite", "intermarc"])
    for row in rows:
        writer.writerow([row["id"], row["type"], row["intermarc"]])

    resp = requests.post(
        f"{API_BASE}/api/datasets",
        files={"file": ("dataset.csv", buf.getvalue().encode("utf-8"), "text/csv")},
        data={"title": dataset_title},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()["dataset"]["id"]


@pytest.mark.e2e
def test_manifestation_uproot_and_attach_across_tabs(page):
    try:
        requests.get(f"{API_BASE}/api/datasets", timeout=5).raise_for_status()
    except Exception:
        pytest.skip("Backend API not reachable")

    dataset_id = _build_dataset()

    page.goto(f"{APP_BASE}/{dataset_id}", wait_until="networkidle")
    page.wait_for_selector('[data-work-id="w1"]')
    page.wait_for_selector('.cluster-header-row')

    # Open expressions view (works whether clustered or not)
    buttons = page.locator('.cluster-open-expressions')
    if buttons.count() > 0:
        buttons.first.click()
    else:
        page.evaluate(
            "(() => { const el = document.querySelector('[data-work-id=\"w1\"] .cluster-header'); if (el) el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); })();"
        )
    page.wait_for_selector('[data-expression-id]', timeout=60000)
    page.wait_for_selector('[data-expression-id="e1"]', timeout=60000)

    # Open manifestations view and prepare uprooting on the manifestation
    page.locator('[data-expression-id="e1"].expression-anchor').dblclick()
    page.wait_for_selector('[data-manifestation-id="m1"]')
    page.locator('[data-expression-id="e1"] [data-manifestation-id="m1"]').click(button="right")
    menu = page.locator('.workspace-context-menu')
    expect(menu).to_be_visible()
    menu.get_by_role('menuitem', name=re.compile('déracinage|uproot', re.IGNORECASE)).click()

    # Add a new workspace tab (pending selection should persist)
    page.locator('.workspace-add-toggle').click()
    page.locator('.workspace-add-menu [role="menuitem"]').first.click()
    page.wait_for_selector('[data-work-id="w1"]')
    page.wait_for_selector('.cluster-header-row')
    buttons = page.locator('.cluster-open-expressions')
    if buttons.count() > 0:
        buttons.first.click()
    else:
        page.evaluate(
            "(() => { const el = document.querySelector('[data-work-id=\"w1\"] .cluster-header'); if (el) el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); })();"
        )
    page.wait_for_selector('[data-expression-id]', timeout=60000)
    page.wait_for_selector('[data-expression-id="e3"]', timeout=60000)

    # Attach the prepared manifestation to expression e3
    page.locator('[data-expression-id="e3"]').first.click(button="right")
    menu = page.locator('.workspace-context-menu')
    expect(menu).to_be_visible()
    menu.get_by_role('menuitem', name=re.compile('Attach|Rattacher', re.IGNORECASE)).click()
    modal = page.locator('.modal')
    expect(modal).to_be_visible()
    checkboxes = modal.locator('input[type="checkbox"]')
    expect(checkboxes).to_have_count(2)
    modal.get_by_role('button', name=re.compile('Confirmer|Confirm', re.IGNORECASE)).click()
    modal.wait_for(state='detached')

    # Open manifestations for e3 and verify placement
    page.locator('[data-expression-id="e3"]').first.dblclick()
    page.wait_for_selector('[data-manifestation-id="m1"]')
    expect(page.locator('[data-manifestation-id="m1"][data-expression-id="e3"]')).to_be_visible()
    expect(page.locator('[data-manifestation-id="m1"][data-expression-id="e1"]')).to_have_count(0)
    expect(page.locator('[data-manifestation-id="m1"][data-expression-id="e2"]')).to_have_count(0)

    # Verify intermarc now points only to e3
    links = page.evaluate(
        """async (datasetId) => {
            const res = await fetch(`http://localhost:8000/api/datasets/${datasetId}/records`);
            const data = await res.json();
            const record = data.records.find((r) => r.id === 'm1');
            const im = JSON.parse(record.intermarc);
            const targets = [];
            for (const zone of im.zones) {
              if (zone.code !== '740') continue;
              for (const sub of zone.sousZones || []) {
                if (sub.code === '740$3') targets.push(sub.valeur);
              }
            }
            return targets;
        }""",
        dataset_id,
    )
    assert links == ["ark:/e3"]
