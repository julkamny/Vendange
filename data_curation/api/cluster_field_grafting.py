"""Cluster field grafting workflow toggle (works clusters).

Public entrypoint used by API/DB facade.
"""

from __future__ import annotations

from typing import List

from data_curation.api.cluster_workflows.engine import toggle_work_cluster_workflow
from data_curation.api.cluster_workflows.work_cluster_field_grafting import (
    WorkClusterFieldGraftingWorkflow,
)


def toggle_cluster_field_grafting(dataset_id: str, *, anchor_id: str) -> List[dict[str, str]]:
    """Toggle `clusterFieldGrafting` on the given work cluster anchor."""
    return toggle_work_cluster_workflow(
        dataset_id,
        anchor_record_id=anchor_id,
        handler=WorkClusterFieldGraftingWorkflow(),
    )

