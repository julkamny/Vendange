from uuid import uuid4

from data_curation.api import datasets, db
from data_curation.api.pg import workspace_repo
from tests.backend.utils import (
    _expression_intermarc,
    _records_to_csv_bytes,
    _work_intermarc,
    _cluster_zone,
    create_zone,
)


def test_title_segments_resolve_ark_labels_for_work_and_agents() -> None:
    dataset_id = f"pg-labeling-smoke-{uuid4().hex[:8]}"
    datasets.ensure_dataset(dataset_id, title="pg labeling smoke")

    agent_ark = "ark:/12148/cb10621283p"
    work_ark = "ark:/12148/w-resolve"
    expr_ark = "ark:/12148/e-resolve"

    agent_intermarc = _work_intermarc(
        agent_ark,
        title="should-not-be-used",
        extra_zones=[create_zone("100", [("a", "Victor Hugo", None), ("d", "1802-1885", None)])],
    )

    work_intermarc = _work_intermarc(
        work_ark,
        title="Ode",
        extra_zones=[create_zone("150", [("3", agent_ark, None)])],
    )

    expr_intermarc = _expression_intermarc(
        expr_ark,
        parent=work_ark,
        extra_zones=[create_zone("700", [("3", agent_ark, None), ("4", "Responsable de l'adaptation", None)])],
    )

    rows = [
        {"id": "a1", "type": "Identité publique de personne", "intermarc": agent_intermarc},
        {"id": "w1", "type": "Oeuvre", "intermarc": work_intermarc},
        {"id": "e1", "type": "Expression", "intermarc": expr_intermarc},
    ]
    db.ingest_csv(_records_to_csv_bytes(rows), dataset_id)

    works = workspace_repo.list_works(dataset_id, limit=50, offset=0)
    unclustered = {row.ark: row for row in works.unclustered_works if row.ark}
    assert work_ark in unclustered

    segments = unclustered[work_ark].title_segments or []
    agent_segments = [s for s in segments if s.ark == agent_ark]
    assert agent_segments, "Expected the work title segments to include the referenced agent as a resolved label"
    assert agent_segments[0].value == "Victor Hugo 1802-1885"

    expr_record = workspace_repo.record_payload(dataset_id, "e1")
    assert expr_record is not None
    assert expr_record.ark_labels.get(agent_ark) == "Victor Hugo 1802-1885"

    agents = workspace_repo.list_agents(dataset_id, limit=50, offset=0)
    found = {row.ark: row for row in agents.unclustered_agents if row.ark}
    assert agent_ark in found
    assert found[agent_ark].label == "Victor Hugo 1802-1885"


def test_work_cluster_focus_tree_down_aggregates_expressions_over_cluster_works() -> None:
    dataset_id = f"pg-work-cluster-exprs-{uuid4().hex[:8]}"
    datasets.ensure_dataset(dataset_id, title="pg work cluster exprs")

    work_a = "ark:/12148/wA"
    work_b = "ark:/12148/wB"
    expr_a = "ark:/12148/eA"
    expr_b = "ark:/12148/eB"

    rows = [
        {"id": "wA", "type": "Oeuvre", "intermarc": _work_intermarc(work_a, "Work A", extra_zones=[_cluster_zone(work_b)])},
        {"id": "wB", "type": "Oeuvre", "intermarc": _work_intermarc(work_b, "Work B")},
        {"id": "eA", "type": "Expression", "intermarc": _expression_intermarc(expr_a, parent=work_a, mode="mA", form="fA")},
        {"id": "eB", "type": "Expression", "intermarc": _expression_intermarc(expr_b, parent=work_b, mode="mB", form="fB")},
    ]
    db.ingest_csv(_records_to_csv_bytes(rows), dataset_id)

    cluster_from_anchor = workspace_repo.get_work_cluster(dataset_id, "wA")
    assert cluster_from_anchor is not None
    assert cluster_from_anchor.anchor_ark == work_a
    assert {item.ark for item in cluster_from_anchor.items} == {work_b}
    assert {group.anchor.ark for group in cluster_from_anchor.expression_groups if group.anchor.ark} == {expr_a}
    assert {expr.ark for expr in cluster_from_anchor.independent_expressions if expr.ark} == {expr_b}

    cluster_from_member = workspace_repo.get_work_cluster(dataset_id, "wB")
    assert cluster_from_member is not None
    assert cluster_from_member.anchor_ark == work_a
    assert {group.anchor.ark for group in cluster_from_member.expression_groups if group.anchor.ark} == {expr_a}
    assert {expr.ark for expr in cluster_from_member.independent_expressions if expr.ark} == {expr_b}
