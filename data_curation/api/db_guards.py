from __future__ import annotations

from pyoxigraph import Literal, QuerySolutions, Store

from .db_ingest import _extract_ark
from .db_shared import (
    AFFECTED_BY_CURATION_PROP,
    FIELD_CODE_PROP,
    HAS_FIELD,
    HAS_SUBFIELD,
    SUBFIELD_CODE_PROP,
    SUBFIELD_VALUE_PROP,
    record_graph,
)
from .db_store import load_ark_index
from ..models import Intermarc
from ..utils.text_norm import fold_diacritics


CLUSTER_NOTE_VALUES = {"Clusterisation manuelle", "Clusterisation script"}
CLUSTER_NOTE_VALUES_LOWER = {val.lower() for val in CLUSTER_NOTE_VALUES}
CURATED_FLAGS = {"manual", "created"}
_CLUSTER_NOTE_LIST = ",".join(f'"{val}"' for val in CLUSTER_NOTE_VALUES_LOWER)
CLUSTER_NOTE_FILTER = f"FILTER(lcase(str(?note)) IN ({_CLUSTER_NOTE_LIST}))"

def _is_agent_type(type_raw: str) -> bool:
    normalized = fold_diacritics(type_raw).strip().lower()
    return normalized in {"identite publique de personne", "collectivite", "famille"}


def _is_work_type(type_raw: str) -> bool:
    normalized = fold_diacritics(type_raw).strip().lower()
    return normalized in {"work","œuvre", "oeuvre"}


def _is_expression_type(type_raw: str) -> bool:
    normalized = fold_diacritics(type_raw).strip().lower()
    return normalized.startswith("expression")


def _extract_cluster_targets(intermarc: Intermarc) -> set[str]:
    targets: set[str] = set()
    for zone in intermarc.get_zone("90F"):
        note = next((sz.valeur for sz in zone.sousZones if sz.code == "90F$q"), None)
        if not note or note.strip().lower() not in CLUSTER_NOTE_VALUES_LOWER:
            continue
        target = next((sz.valeur for sz in zone.sousZones if sz.code == "90F$3"), None)
        if target:
            targets.add(str(target).strip())
    return targets


def _has_curated_cluster_note(store: Store, target_graph: str) -> bool:
    """
    Return True when the graph contains a 90F note (manual or script) whose field
    or subfield is curated (affectedByCuration manual/created).
    """
    query = f"""
    SELECT ?aff
    WHERE {{
      GRAPH <{target_graph}> {{
        ?rec <{HAS_FIELD.value}> ?field .
        ?field <{FIELD_CODE_PROP.value}> "90F" .
        ?field <{HAS_SUBFIELD.value}> ?subQ .
        ?subQ <{SUBFIELD_CODE_PROP.value}> "90Fsq" .
        ?subQ <{SUBFIELD_VALUE_PROP.value}> ?note .
        {CLUSTER_NOTE_FILTER}
        OPTIONAL {{ ?field <{AFFECTED_BY_CURATION_PROP.value}> ?aff }}
        OPTIONAL {{ ?subQ <{AFFECTED_BY_CURATION_PROP.value}> ?aff }}
      }}
    }}
    """
    solutions = store.query(query)
    if not isinstance(solutions, QuerySolutions):
        return False
    for solution in solutions:
        try:
            aff = solution["aff"]
        except (KeyError, TypeError):
            aff = None
        if isinstance(aff, Literal) and aff.value.lower() in CURATED_FLAGS:
            return True
    return False


def _is_agent_anchor(store: Store, ark_index: dict[str, str], target_ark: str) -> bool:
    target_id = ark_index.get(target_ark)
    if not target_id:
        return False
    return _has_curated_cluster_note(store, record_graph(target_id).value)


def _ensure_unique_agent_clusters(store: Store, anchor_id: str, intermarc: Intermarc) -> None:
    new_targets = _extract_cluster_targets(intermarc)
    if not new_targets:
        return

    # Check if the anchor itself is already a member of another cluster
    anchor_ark = _extract_ark(intermarc)
    if anchor_ark:
        query_is_member = f"""
        SELECT ?parent
        WHERE {{
          GRAPH ?g {{
            ?parent <{HAS_FIELD.value}> ?field .
            ?field <{FIELD_CODE_PROP.value}> "90F" .
            ?field <{HAS_SUBFIELD.value}> ?subQ .
            ?subQ <{SUBFIELD_CODE_PROP.value}> "90Fsq" .
            ?subQ <{SUBFIELD_VALUE_PROP.value}> ?note .
            {CLUSTER_NOTE_FILTER}
            ?field <{HAS_SUBFIELD.value}> ?subT .
            ?subT <{SUBFIELD_CODE_PROP.value}> "90Fs3" .
            ?subT <{SUBFIELD_VALUE_PROP.value}> "{anchor_ark}" .
          }}
        }}
        """
        solutions_member = store.query(query_is_member)
        if isinstance(solutions_member, QuerySolutions):
            for sol in solutions_member:
                try:
                    parent = sol["parent"]
                except (KeyError, TypeError):
                    parent = None
                if parent:
                    parent_iri = parent.value
                    parent_id = parent_iri.split("/")[-1]
                    if parent_id != anchor_id:
                        raise ValueError(f"Impossible d'enregistrer : l'agent {anchor_ark} est deja rattache au cluster de {parent_id}.")

    query = f"""
    SELECT ?anchor ?target
    WHERE {{
      GRAPH ?g {{
        ?anchor <{HAS_FIELD.value}> ?field .
        ?field <{FIELD_CODE_PROP.value}> "90F" .
        ?field <{HAS_SUBFIELD.value}> ?subQ .
        ?subQ <{SUBFIELD_CODE_PROP.value}> "90Fsq" .
        ?subQ <{SUBFIELD_VALUE_PROP.value}> ?note .
        {CLUSTER_NOTE_FILTER}
        ?field <{HAS_SUBFIELD.value}> ?subT .
        ?subT <{SUBFIELD_CODE_PROP.value}> "90Fs3" .
        ?subT <{SUBFIELD_VALUE_PROP.value}> ?target .
      }}
    }}
    """

    existing: dict[str, str] = {}
    solutions = store.query(query)
    if not isinstance(solutions, QuerySolutions):
        raise ValueError("Manual cluster query did not return a SELECT result set")
    for solution in solutions:
        try:
            anchor_node = solution["anchor"]
        except (KeyError, TypeError):
            anchor_node = None
        try:
            target_node = solution["target"]
        except (KeyError, TypeError):
            target_node = None
        if not anchor_node or not target_node:
            continue
        anchor_iri = getattr(anchor_node, "value", None)
        target_value = getattr(target_node, "value", None)
        if not anchor_iri or not target_value:
            continue
        anchor_record_id = anchor_iri.split("/")[-1] if anchor_iri else None
        existing.setdefault(target_value, anchor_record_id)

    ark_index = load_ark_index(store)

    for target in new_targets:
        anchor = existing.get(target)
        if anchor and anchor != anchor_id:
            raise ValueError(
                f"Impossible d'enregistrer : l'agent {target} est deja rattache au cluster de {anchor}."
            )
        if _is_agent_anchor(store, ark_index, target):
            raise ValueError(
                f"Impossible d'enregistrer : l'agent {target} est deja ancre d'un cluster."
            )


def _extract_work_cluster_targets(intermarc: Intermarc) -> set[str]:
    return _extract_cluster_targets(intermarc)


def _current_work_cluster_targets(store: Store, anchor_id: str) -> set[str]:
    graph = record_graph(anchor_id)
    query = f"""
    SELECT ?target
    WHERE {{
      GRAPH <{graph.value}> {{
        ?rec <{HAS_FIELD.value}> ?field .
        ?field <{FIELD_CODE_PROP.value}> "90F" .
        ?field <{HAS_SUBFIELD.value}> ?subQ .
        ?subQ <{SUBFIELD_CODE_PROP.value}> "90Fsq" .
        ?subQ <{SUBFIELD_VALUE_PROP.value}> ?note .
        {CLUSTER_NOTE_FILTER}
        ?field <{HAS_SUBFIELD.value}> ?subT .
        ?subT <{SUBFIELD_CODE_PROP.value}> "90Fs3" .
        ?subT <{SUBFIELD_VALUE_PROP.value}> ?target .
      }}
    }}
    """
    solutions = store.query(query)
    targets: set[str] = set()
    if isinstance(solutions, QuerySolutions):
        for sol in solutions:
            try:
                target = sol["target"]
            except (KeyError, TypeError):
                target = None
            if isinstance(target, Literal):
                targets.add(target.value)
    return targets


def _expressions_of_work(store: Store, work_ark: str) -> list[tuple[str, str]]:
    query = f"""
    SELECT ?expr ?ark
    WHERE {{
      GRAPH ?g {{
        ?expr <{HAS_FIELD.value}> ?field750 .
        ?field750 <{FIELD_CODE_PROP.value}> "750" .
        ?field750 <{HAS_SUBFIELD.value}> ?sub3 .
        ?sub3 <{SUBFIELD_CODE_PROP.value}> "750s3" .
        ?sub3 <{SUBFIELD_VALUE_PROP.value}> "{work_ark}" .

        ?expr <{HAS_FIELD.value}> ?field001 .
        ?field001 <{FIELD_CODE_PROP.value}> "001" .
        ?field001 <{HAS_SUBFIELD.value}> ?subArk .
        ?subArk <{SUBFIELD_CODE_PROP.value}> "001sa" .
        ?subArk <{SUBFIELD_VALUE_PROP.value}> ?ark .
      }}
    }}
    """
    expressions: list[tuple[str, str]] = []
    solutions = store.query(query)
    if isinstance(solutions, QuerySolutions):
        for sol in solutions:
            try:
                expr_node = sol["expr"]
            except (KeyError, TypeError):
                expr_node = None
            try:
                ark_node = sol["ark"]
            except (KeyError, TypeError):
                ark_node = None
            expr_iri = getattr(expr_node, "value", None)
            ark_val = getattr(ark_node, "value", None) if isinstance(ark_node, Literal) else None
            if expr_iri and ark_val:
                expressions.append((expr_iri.split("/")[-1], ark_val))
    return expressions


def _expression_cross_work_clusters(
    store: Store, ark_index: dict[str, str], expr_id: str, expr_ark: str, work_ark: str
) -> bool:
    member_query = f"""
    SELECT ?anchorParent
    WHERE {{
      GRAPH ?g {{
        ?anchor <{HAS_FIELD.value}> ?field .
        ?field <{FIELD_CODE_PROP.value}> "90F" .
        ?field <{HAS_SUBFIELD.value}> ?subQ .
        ?subQ <{SUBFIELD_CODE_PROP.value}> "90Fsq" .
        ?subQ <{SUBFIELD_VALUE_PROP.value}> ?note .
        {CLUSTER_NOTE_FILTER}
        ?field <{HAS_SUBFIELD.value}> ?subT .
        ?subT <{SUBFIELD_CODE_PROP.value}> "90Fs3" .
        ?subT <{SUBFIELD_VALUE_PROP.value}> "{expr_ark}" .

        ?anchor <{HAS_FIELD.value}> ?field750 .
        ?field750 <{FIELD_CODE_PROP.value}> "750" .
        ?field750 <{HAS_SUBFIELD.value}> ?subParent .
        ?subParent <{SUBFIELD_CODE_PROP.value}> "750s3" .
        ?subParent <{SUBFIELD_VALUE_PROP.value}> ?anchorParent .
      }}
    }}
    """
    solutions_member = store.query(member_query)
    if isinstance(solutions_member, QuerySolutions):
        for sol in solutions_member:
            try:
                parent_node = sol["anchorParent"]
            except (KeyError, TypeError):
                parent_node = None
            if isinstance(parent_node, Literal) and parent_node.value != work_ark:
                return True

    # Anchor case: expression of the work anchoring other expressions from different works
    target_query = f"""
    SELECT ?target
    WHERE {{
      GRAPH <{record_graph(expr_id).value}> {{
        ?rec <{HAS_FIELD.value}> ?field .
        ?field <{FIELD_CODE_PROP.value}> "90F" .
        ?field <{HAS_SUBFIELD.value}> ?subQ .
        ?subQ <{SUBFIELD_CODE_PROP.value}> "90Fsq" .
        ?subQ <{SUBFIELD_VALUE_PROP.value}> ?note .
        {CLUSTER_NOTE_FILTER}
        ?field <{HAS_SUBFIELD.value}> ?subT .
        ?subT <{SUBFIELD_CODE_PROP.value}> "90Fs3" .
        ?subT <{SUBFIELD_VALUE_PROP.value}> ?target .
      }}
    }}
    """
    solutions_targets = store.query(target_query)
    if isinstance(solutions_targets, QuerySolutions):
        for sol in solutions_targets:
            try:
                target_node = sol["target"]
            except (KeyError, TypeError):
                target_node = None
            target_ark = getattr(target_node, "value", None) if isinstance(target_node, Literal) else None
            if not target_ark:
                continue
            target_id = ark_index.get(target_ark)
            if not target_id:
                continue
            target_parents = _expression_parents(store, target_id)
            for parent in target_parents:
                if parent != work_ark:
                    return True

    return False


def _work_expressions_linked_to_other_work_clusters(store: Store, ark_index: dict[str, str], work_ark: str) -> bool:
    for expr_id, expr_ark in _expressions_of_work(store, work_ark):
        if _expression_cross_work_clusters(store, ark_index, expr_id, expr_ark, work_ark):
            return True
    return False


def _is_work_anchor(store: Store, ark_index: dict[str, str], target_ark: str) -> bool:
    target_id = ark_index.get(target_ark)
    if not target_id:
        return False
    return _has_curated_cluster_note(store, record_graph(target_id).value)


def _ensure_unique_work_clusters(store: Store, anchor_id: str, intermarc: Intermarc) -> None:
    new_targets = _extract_work_cluster_targets(intermarc)

    ark_index = load_ark_index(store)
    previous_targets = _current_work_cluster_targets(store, anchor_id)
    removed_targets = previous_targets - new_targets
    for removed in removed_targets:
        if _work_expressions_linked_to_other_work_clusters(store, ark_index, removed):
            raise ValueError(
                f"Impossible de retirer l'oeuvre {removed} du cluster : une de ses expressions est deja rattachee a un cluster d'expressions d'une autre oeuvre."
            )

    if not new_targets:
        return

    query = f"""
    SELECT ?anchor ?target
    WHERE {{
      GRAPH ?g {{
        ?anchor <{HAS_FIELD.value}> ?field .
        ?field <{FIELD_CODE_PROP.value}> "90F" .
        ?field <{HAS_SUBFIELD.value}> ?subQ .
        ?subQ <{SUBFIELD_CODE_PROP.value}> "90Fsq" .
        ?subQ <{SUBFIELD_VALUE_PROP.value}> ?note .
        {CLUSTER_NOTE_FILTER}
        ?field <{HAS_SUBFIELD.value}> ?subT .
        ?subT <{SUBFIELD_CODE_PROP.value}> ?codeTarget .
        FILTER(?codeTarget = "90Fs3")
        ?subT <{SUBFIELD_VALUE_PROP.value}> ?target .
      }}
    }}
    """

    existing: dict[str, str] = {}
    solutions = store.query(query)
    if not isinstance(solutions, QuerySolutions):
        raise ValueError("Manual cluster query did not return a SELECT result set")
    for solution in solutions:
        try:
            anchor_node = solution["anchor"]
        except (KeyError, TypeError):
            anchor_node = None
        try:
            target_node = solution["target"]
        except (KeyError, TypeError):
            target_node = None
        if not anchor_node or not target_node:
            continue
        anchor_iri = getattr(anchor_node, "value", None)
        target_value = getattr(target_node, "value", None)
        if not anchor_iri or not target_value:
            continue
        anchor_record_id = anchor_iri.split("/")[-1] if anchor_iri else None
        existing.setdefault(target_value, anchor_record_id)

    for target in new_targets:
        anchor = existing.get(target)
        if anchor and anchor != anchor_id:
            raise ValueError(
                f"Impossible d'enregistrer : l'oeuvre {target} est deja rattachee au cluster de {anchor}."
            )
        if _is_work_anchor(store, ark_index, target):
            raise ValueError(
                f"Impossible d'enregistrer : l'oeuvre {target} est deja ancre d'un cluster."
            )


def _extract_expression_cluster_targets(intermarc: Intermarc) -> set[str]:
    return _extract_cluster_targets(intermarc)


def _expression_parents(store: Store, record_id: str) -> set[str]:
    parents: set[str] = set()
    graph = record_graph(record_id)
    query = f"""
    SELECT ?value
    WHERE {{
      GRAPH <{graph.value}> {{
        ?rec <{HAS_FIELD.value}> ?field .
        ?field <{FIELD_CODE_PROP.value}> "750" .
        ?field <{HAS_SUBFIELD.value}> ?sub .
        ?sub <{SUBFIELD_CODE_PROP.value}> "750s3" .
        ?sub <{SUBFIELD_VALUE_PROP.value}> ?value .
      }}
    }}
    """
    solutions = store.query(query)
    if isinstance(solutions, QuerySolutions):
        for sol in solutions:
            try:
                val = sol["value"]
            except (KeyError, TypeError):
                val = None
            if isinstance(val, Literal):
                parents.add(val.value)
    return parents


def _is_expression_anchor(store: Store, ark_index: dict[str, str], target_ark: str) -> bool:
    target_id = ark_index.get(target_ark)
    if not target_id:
        return False
    return _has_curated_cluster_note(store, record_graph(target_id).value)


def _works_clustered_together(store: Store, ark_index: dict[str, str], work_ark_a: str, work_ark_b: str) -> bool:
    if work_ark_a == work_ark_b:
        return True

    combined_query = f"""
    ASK {{
      GRAPH ?g {{
        ?rec <{HAS_FIELD.value}> ?field1 .
        ?field1 <{FIELD_CODE_PROP.value}> "90F" .
        ?field1 <{HAS_SUBFIELD.value}> ?subQ1 .
        ?subQ1 <{SUBFIELD_CODE_PROP.value}> "90Fsq" .
        ?subQ1 <{SUBFIELD_VALUE_PROP.value}> ?note1 .
        FILTER(lcase(str(?note1)) IN ({_CLUSTER_NOTE_LIST}))
        ?field1 <{HAS_SUBFIELD.value}> ?subT1 .
        ?subT1 <{SUBFIELD_CODE_PROP.value}> ?codeTarget1 .
        FILTER(?codeTarget1 = "90Fs3")
        ?subT1 <{SUBFIELD_VALUE_PROP.value}> "{work_ark_a}" .

        ?rec <{HAS_FIELD.value}> ?field2 .
        ?field2 <{FIELD_CODE_PROP.value}> "90F" .
        ?field2 <{HAS_SUBFIELD.value}> ?subQ2 .
        ?subQ2 <{SUBFIELD_CODE_PROP.value}> "90Fsq" .
        ?subQ2 <{SUBFIELD_VALUE_PROP.value}> ?note2 .
        FILTER(lcase(str(?note2)) IN ({_CLUSTER_NOTE_LIST}))
        ?field2 <{HAS_SUBFIELD.value}> ?subT2 .
        ?subT2 <{SUBFIELD_CODE_PROP.value}> ?codeTarget2 .
        FILTER(?codeTarget2 = "90Fs3")
        ?subT2 <{SUBFIELD_VALUE_PROP.value}> "{work_ark_b}" .
      }}
    }}
    """
    try:
        combined_result = store.query(combined_query)
        if bool(combined_result):
            return True
    except Exception:
        pass

    id_a = ark_index.get(work_ark_a)
    id_b = ark_index.get(work_ark_b)

    if id_a:
        query_a = f"""
        ASK {{
          GRAPH <{record_graph(id_a).value}> {{
            ?rec <{HAS_FIELD.value}> ?field .
            ?field <{FIELD_CODE_PROP.value}> "90F" .
            ?field <{HAS_SUBFIELD.value}> ?subQ .
            ?subQ <{SUBFIELD_CODE_PROP.value}> "90Fsq" .
            ?subQ <{SUBFIELD_VALUE_PROP.value}> ?note .
            {CLUSTER_NOTE_FILTER}
            ?field <{HAS_SUBFIELD.value}> ?subT .
            ?subT <{SUBFIELD_CODE_PROP.value}> ?codeTarget .
            FILTER(?codeTarget = "90Fs3")
            ?subT <{SUBFIELD_VALUE_PROP.value}> "{work_ark_b}" .
          }}
        }}
        """
        try:
            result_a = store.query(query_a)
            if bool(result_a):
                return True
        except Exception:
            pass

    if id_b:
        query_b = f"""
        ASK {{
          GRAPH <{record_graph(id_b).value}> {{
            ?rec <{HAS_FIELD.value}> ?field .
            ?field <{FIELD_CODE_PROP.value}> "90F" .
            ?field <{HAS_SUBFIELD.value}> ?subQ .
            ?subQ <{SUBFIELD_CODE_PROP.value}> "90Fsq" .
            ?subQ <{SUBFIELD_VALUE_PROP.value}> ?note .
            {CLUSTER_NOTE_FILTER}
            ?field <{HAS_SUBFIELD.value}> ?subT .
            ?subT <{SUBFIELD_CODE_PROP.value}> ?codeTarget .
            FILTER(?codeTarget = "90Fs3")
            ?subT <{SUBFIELD_VALUE_PROP.value}> "{work_ark_a}" .
          }}
        }}
        """
        try:
            result_b = store.query(query_b)
            if bool(result_b):
                return True
        except Exception:
            pass

    return False


def _ensure_unique_expression_clusters(store: Store, anchor_id: str, intermarc: Intermarc) -> None:
    new_targets = _extract_expression_cluster_targets(intermarc)
    if not new_targets:
        return

    query = f"""
    SELECT ?anchor ?target
    WHERE {{
      GRAPH ?g {{
        ?anchor <{HAS_FIELD.value}> ?field .
        ?field <{FIELD_CODE_PROP.value}> "90F" .
        ?field <{HAS_SUBFIELD.value}> ?subQ .
        ?subQ <{SUBFIELD_CODE_PROP.value}> "90Fsq" .
        ?subQ <{SUBFIELD_VALUE_PROP.value}> ?note .
        {CLUSTER_NOTE_FILTER}
        ?field <{HAS_SUBFIELD.value}> ?subT .
        ?subT <{SUBFIELD_CODE_PROP.value}> ?codeTarget .
        FILTER(?codeTarget = "90Fs3")
        ?subT <{SUBFIELD_VALUE_PROP.value}> ?target .
      }}
    }}
    """

    existing: dict[str, str] = {}
    solutions = store.query(query)
    if not isinstance(solutions, QuerySolutions):
        raise ValueError("Expression cluster query did not return a SELECT result set")
    for solution in solutions:
        try:
            anchor_node = solution["anchor"]
        except (KeyError, TypeError):
            anchor_node = None
        try:
            target_node = solution["target"]
        except (KeyError, TypeError):
            target_node = None
        if not anchor_node or not target_node:
            continue
        anchor_iri = getattr(anchor_node, "value", None)
        target_value = getattr(target_node, "value", None)
        if not anchor_iri or not target_value:
            continue
        anchor_record_id = anchor_iri.split("/")[-1] if anchor_iri else None
        existing.setdefault(target_value, anchor_record_id)

    ark_index = load_ark_index(store)
    anchor_ark = _extract_ark(intermarc)
    anchor_membership = existing.get(anchor_ark) if anchor_ark else None
    if anchor_membership and anchor_membership != anchor_id:
        raise ValueError(
            "Impossible d'enregistrer : une expression déjà rattachée à un cluster ne peut pas en devenir l'ancre."
        )
    anchor_parents = _expression_parents(store, anchor_id)

    for target in new_targets:
        anchor = existing.get(target)
        if anchor and anchor != anchor_id:
            raise ValueError(
                f"Impossible d'enregistrer : l'expression {target} est deja rattachee au cluster de {anchor}."
            )
        if _is_expression_anchor(store, ark_index, target):
            raise ValueError(
                f"Impossible d'enregistrer : l'expression {target} est deja ancre d'un cluster."
            )
        target_id = ark_index.get(target)
        if not target_id:
            raise ValueError("Impossible d'enregistrer : parent non vérifiable pour la cible.")
        target_parents = _expression_parents(store, target_id)
        parents_overlap = anchor_parents.intersection(target_parents)
        parents_clustered = False
        for parent_a in anchor_parents:
            for parent_b in target_parents:
                if _works_clustered_together(store, ark_index, parent_a, parent_b):
                    parents_clustered = True
                    break
            if parents_clustered:
                break
        if anchor_parents and target_parents and not parents_overlap and not parents_clustered:
            raise ValueError(
                f"Impossible d'enregistrer : l'expression {target} n'a pas le même parent 750$3 ou des parents déjà en cluster que l'ancre."
            )
