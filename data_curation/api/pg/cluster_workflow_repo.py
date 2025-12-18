"""Persistence helpers for cluster-scoped workflow state.

Cluster workflows are long-lived, user-triggered procedures applied to a cluster
anchor record (e.g. field grafting). Their state must be robust to manual edits
of the anchor record, so we do not infer it from record contents.
"""

from __future__ import annotations

from typing import Dict, Iterable

from data_curation.api.pg.session import db_session


def get_applied_workflows(
    dataset_id: str,
    anchor_ark: str,
    *,
    conn=None,
) -> Dict[str, bool]:
    """Return a mapping of workflow_name -> applied for a given anchor ark."""
    if not anchor_ark:
        return {}
    sql = """
        SELECT workflow_name, applied
        FROM cluster_workflow_state
        WHERE dataset_id=%s AND anchor_ark=%s
    """
    if conn is None:
        with db_session() as conn:
            rows = conn.execute(sql, (dataset_id, anchor_ark)).fetchall()
    else:
        rows = conn.execute(sql, (dataset_id, anchor_ark)).fetchall()
    return {row["workflow_name"]: bool(row["applied"]) for row in rows}


def get_any_applied(
    dataset_id: str,
    anchor_ark: str,
    *,
    workflow_name: str,
    conn=None,
) -> bool:
    """Return True if the given workflow is applied on the anchor."""
    if not anchor_ark:
        return False
    sql = """
        SELECT 1
        FROM cluster_workflow_state
        WHERE dataset_id=%s AND anchor_ark=%s AND workflow_name=%s AND applied=true
        LIMIT 1
    """
    if conn is None:
        with db_session() as conn:
            row = conn.execute(sql, (dataset_id, anchor_ark, workflow_name)).fetchone()
    else:
        row = conn.execute(sql, (dataset_id, anchor_ark, workflow_name)).fetchone()
    return bool(row)


def get_applied_by_anchor(
    dataset_id: str,
    anchor_arks: Iterable[str],
    *,
    conn=None,
) -> Dict[str, Dict[str, bool]]:
    """Return a map anchor_ark -> {workflow_name: True} for applied workflows.

    Only returns workflows currently applied (applied=true), to keep payloads small.
    """
    arks = [a for a in set(anchor_arks) if a]
    if not arks:
        return {}
    sql = """
        SELECT anchor_ark, workflow_name
        FROM cluster_workflow_state
        WHERE dataset_id=%s AND anchor_ark = ANY(%s) AND applied=true
    """
    if conn is None:
        with db_session() as conn:
            rows = conn.execute(sql, (dataset_id, arks)).fetchall()
    else:
        rows = conn.execute(sql, (dataset_id, arks)).fetchall()
    out: Dict[str, Dict[str, bool]] = {}
    for row in rows:
        out.setdefault(row["anchor_ark"], {})[row["workflow_name"]] = True
    return out


def set_workflow_applied(
    dataset_id: str,
    *,
    anchor_ark: str,
    workflow_name: str,
    applied: bool,
    conn,
) -> None:
    """Upsert workflow state for an anchor under an existing transaction."""
    if not anchor_ark:
        raise ValueError("Ancre sans ARK : état de workflow impossible.")
    conn.execute(
        """
        INSERT INTO cluster_workflow_state (dataset_id, anchor_ark, workflow_name, applied, applied_at)
        VALUES (%s,%s,%s,%s, CASE WHEN %s THEN now() ELSE NULL END)
        ON CONFLICT (dataset_id, anchor_ark, workflow_name)
        DO UPDATE SET applied=EXCLUDED.applied,
                      applied_at=EXCLUDED.applied_at
        """,
        (dataset_id, anchor_ark, workflow_name, bool(applied), bool(applied)),
    )
