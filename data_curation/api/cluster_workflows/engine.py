"""Reusable cluster workflow toggle engine.

This module provides a generic "toggle workflow on anchor" workflow runner, so
we can later plug similar workflows for expressions and agents without
copy/pasting transaction + state handling logic.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Protocol

from data_curation.api.pg import cluster_workflow_repo, entities_repo
from data_curation.api.pg.curation_tx import dataset_transaction, update_entity_record
from data_curation.models import Entity, Intermarc


@dataclass(frozen=True)
class ClusterAnchorContext:
    entity: Entity
    ark: str


class ClusterWorkflowHandler(Protocol):
    """A pluggable workflow that can be applied/removed on a cluster anchor."""

    name: str

    def apply(self, anchor: ClusterAnchorContext, members: List[Entity]) -> Intermarc: ...

    def remove(self, anchor_intermarc: Intermarc) -> Intermarc: ...


def _cluster_members_by_anchor_ark(conn, dataset_id: str, anchor_ark: str) -> list[str]:
    rows = conn.execute(
        "SELECT member_ark FROM cluster WHERE dataset_id=%s AND anchor_ark=%s",
        (dataset_id, anchor_ark),
    ).fetchall()
    return [row["member_ark"] for row in rows if row.get("member_ark")]


def toggle_work_cluster_workflow(
    dataset_id: str,
    *,
    anchor_record_id: str,
    handler: ClusterWorkflowHandler,
) -> List[dict[str, str]]:
    """Toggle a workflow on a work cluster anchor record.

    - First call applies the workflow and marks it applied in DB.
    - Second call removes workflow-tagged content and marks it not applied.
    """
    with dataset_transaction(dataset_id) as conn:
        anchor_row_entity = entities_repo.get_by_record_id(
            dataset_id,
            anchor_record_id,
            for_update=True,
            conn=conn,
        )
        if not anchor_row_entity:
            raise ValueError(f"Record not found: {anchor_record_id}")
        _, anchor_entity = anchor_row_entity

        anchor_ark = anchor_entity.ark()
        if not anchor_ark:
            raise ValueError("Ancre sans ARK : workflow impossible.")

        applied = cluster_workflow_repo.get_any_applied(
            dataset_id,
            anchor_ark,
            workflow_name=handler.name,
            conn=conn,
        )

        if applied:
            next_intermarc = handler.remove(anchor_entity.intermarc)
            cluster_workflow_repo.set_workflow_applied(
                dataset_id,
                anchor_ark=anchor_ark,
                workflow_name=handler.name,
                applied=False,
                conn=conn,
            )
        else:
            member_arks = _cluster_members_by_anchor_ark(conn, dataset_id, anchor_ark)
            if not member_arks:
                raise ValueError("Aucune œuvre en grappe : greffe impossible.")
            member_rows = entities_repo.get_many_by_arks(
                dataset_id,
                member_arks,
                for_update=True,
                conn=conn,
            )
            members: List[Entity] = []
            for ark in member_arks:
                row_entity = member_rows.get(ark)
                if not row_entity:
                    continue
                _, entity = row_entity
                members.append(entity)

            next_intermarc = handler.apply(
                ClusterAnchorContext(entity=anchor_entity, ark=anchor_ark),
                members,
            )
            cluster_workflow_repo.set_workflow_applied(
                dataset_id,
                anchor_ark=anchor_ark,
                workflow_name=handler.name,
                applied=True,
                conn=conn,
            )

        updated_anchor = update_entity_record(
            dataset_id,
            record_id=anchor_entity.id_entitelrm,
            type_raw=anchor_entity.type_entite,
            intermarc=next_intermarc,
            conn=conn,
        ).as_payload()

        return [updated_anchor]
