#! /usr/bin/env python
# ruff: noqa: E402
import sys
from pathlib import Path
import os
import threading

import psycopg
import pytest

# Ensure repo root is in path (mirrors tests/backend setup)
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data_curation.api.pg.schema import ensure_schema
from data_curation.api.pg.datasets_repo import create_dataset, delete_dataset
from data_curation.api.pg.curation_tx import update_entity_record
from data_curation.api.manual_cluster import update_manual_cluster
from data_curation.models import Intermarc, Zone, SousZone


POSTGRES_DSN = os.getenv("POSTGRES_DSN", "postgresql://postgres:VendangePostgres@localhost:55432/postgres")


def _conn_available() -> bool:
    try:
        psycopg.connect(POSTGRES_DSN).close()
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _conn_available(), reason="Postgres not reachable for curation tests")


def _im(ark: str, *, cluster: str | None = None) -> Intermarc:
    zones = [Zone(code="001", sousZones=[SousZone(code="001$a", valeur=ark)])]
    if cluster:
        zones.append(
            Zone(
                code="90F",
                sousZones=[
                    SousZone(code="90F$3", valeur=cluster, affected_by_curation="manual"),
                    SousZone(code="90F$q", valeur="Clusterisation manuelle", affected_by_curation="manual"),
                ],
                affected_by_curation="manual",
            )
        )
    return Intermarc(zones=zones)

def _work(ark: str, *, cluster: str | None = None) -> Intermarc:
    return _im(ark, cluster=cluster)


def _expression(ark: str, parent_work_ark: str, *, cluster: str | None = None) -> Intermarc:
    zones = [
        Zone(code="001", sousZones=[SousZone(code="001$a", valeur=ark)]),
        Zone(code="750", sousZones=[SousZone(code="750$3", valeur=parent_work_ark)]),
    ]
    if cluster:
        zones.append(
            Zone(
                code="90F",
                sousZones=[
                    SousZone(code="90F$3", valeur=cluster, affected_by_curation="manual"),
                    SousZone(code="90F$q", valeur="Clusterisation manuelle", affected_by_curation="manual"),
                ],
                affected_by_curation="manual",
            )
        )
    return Intermarc(zones=zones)


@pytest.fixture(scope="module", autouse=True)
def setup_schema():
    ensure_schema()


@pytest.fixture
def fresh_dataset():
    dataset_id = "test_cur_guard"
    create_dataset(dataset_id, title="Test dataset")
    yield dataset_id
    delete_dataset(dataset_id)


def test_manual_cluster_uniqueness(fresh_dataset):
    ds = fresh_dataset
    # Seed anchor/targets
    update_entity_record(ds, record_id="a1", type_raw="Work", intermarc=_im("ark:/a1"))
    update_entity_record(ds, record_id="t1", type_raw="Work", intermarc=_im("ark:/t1"))
    update_entity_record(ds, record_id="a2", type_raw="Work", intermarc=_im("ark:/a2"))

    update_manual_cluster(ds, anchor_id="a1", target_id="t1", accepted=True)
    with pytest.raises(ValueError):
        update_manual_cluster(ds, anchor_id="a2", target_id="t1", accepted=True)


def test_dataset_lock_isolation(fresh_dataset):
    ds1 = fresh_dataset
    ds2 = f"{fresh_dataset}_other"
    create_dataset(ds2, title="Other")

    results: list[str] = []

    def _write(ds: str, rec: str):
        update_entity_record(ds, record_id=rec, type_raw="Work", intermarc=_im(f"ark:/{ds}-{rec}"))
        results.append(rec)

    t1 = threading.Thread(target=_write, args=(ds1, "r1"))
    t2 = threading.Thread(target=_write, args=(ds2, "r2"))
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    assert set(results) == {"r1", "r2"}
    delete_dataset(ds2)


def test_cannot_remove_work_if_expression_clusters_cross_cluster_works(fresh_dataset):
    ds = fresh_dataset
    # Works clustered together: wa anchors wb.
    update_entity_record(ds, record_id="wa", type_raw="Work", intermarc=_work("ark:/wa", cluster="ark:/wb"))
    update_entity_record(ds, record_id="wb", type_raw="Work", intermarc=_work("ark:/wb"))

    # Expressions: ea -> wa, eb -> wb. Cluster ea with eb.
    update_entity_record(ds, record_id="ea", type_raw="Expression", intermarc=_expression("ark:/ea", "ark:/wa", cluster="ark:/eb"))
    update_entity_record(ds, record_id="eb", type_raw="Expression", intermarc=_expression("ark:/eb", "ark:/wb"))

    # Removing wb from wa's cluster should be forbidden because ea (wa) is clustered with eb (wb).
    with pytest.raises(ValueError):
        update_manual_cluster(ds, anchor_id="wa", target_ark="ark:/wb", accepted=False)


def test_cannot_cluster_expressions_if_parent_works_not_clustered(fresh_dataset):
    ds = fresh_dataset
    update_entity_record(ds, record_id="w1", type_raw="Work", intermarc=_work("ark:/w1"))
    update_entity_record(ds, record_id="w2", type_raw="Work", intermarc=_work("ark:/w2"))

    update_entity_record(ds, record_id="e1", type_raw="Expression", intermarc=_expression("ark:/e1", "ark:/w1"))
    update_entity_record(ds, record_id="e2", type_raw="Expression", intermarc=_expression("ark:/e2", "ark:/w2"))

    with pytest.raises(ValueError):
        update_manual_cluster(ds, anchor_id="e1", target_id="e2", accepted=True)
