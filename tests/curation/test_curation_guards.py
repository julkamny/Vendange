import os
import threading

import psycopg
import pytest

from data_curation.api.pg.schema import ensure_schema
from data_curation.api.pg.datasets_repo import create_dataset, delete_dataset
from data_curation.api.pg.curation_tx import dataset_transaction, update_entity_record
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
