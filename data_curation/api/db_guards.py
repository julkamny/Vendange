from __future__ import annotations

from pyoxigraph import Literal, QuerySolutions, Store

from .db_ingest import _build_record_from_payload, _build_record_quads, _extract_ark
from .db_shared import (
    AFFECTED_BY_CURATION_PROP,
    FIELD_CODE_PROP,
    HAS_FIELD,
    HAS_SUBFIELD,
    SUBFIELD_CODE_PROP,
    SUBFIELD_VALUE_PROP,
    record_graph,
)
from .db_store import _STORE_LOCK, clear_record_graph, get_store_locked, load_ark_index
from . import datasets
from ..models import Intermarc
from ..utils.text_norm import fold_diacritics

def _is_agent_type(type_raw: str) -> bool:
    normalized = fold_diacritics(type_raw).strip().lower()
    return normalized in {"identite publique de personne", "collectivite", "famille"}


def _is_work_type(type_raw: str) -> bool:
    normalized = fold_diacritics(type_raw).strip().lower()
    return normalized in {"work","œuvre", "oeuvre"}


def _is_expression_type(type_raw: str) -> bool:
    normalized = fold_diacritics(type_raw).strip().lower()
    return normalized.startswith("expression")


def _extract_manual_agent_targets(intermarc: Intermarc) -> set[str]:
    targets: set[str] = set()
    for zone in intermarc.get_zone("90F"):
        note = next((sz.valeur for sz in zone.sousZones if sz.code == "90F$q"), None)
        if not note or note.strip().lower() != "clusterisation manuelle":
            continue
        target = next((sz.valeur for sz in zone.sousZones if sz.code == "90F$3"), None)
        if target:
            targets.add(str(target).strip())
    return targets


def _is_manual_anchor(store: Store, ark_index: dict[str, str], target_ark: str) -> bool:
    target_id = ark_index.get(target_ark)
    if not target_id:
        return False
    query = f"""
    SELECT ?field ?aff
    WHERE {{
      GRAPH <{record_graph(target_id).value}> {{
        ?rec <{HAS_FIELD.value}> ?field .
        ?field <{FIELD_CODE_PROP.value}> "90F" .
        ?field <{HAS_SUBFIELD.value}> ?subQ .
        ?subQ <{SUBFIELD_CODE_PROP.value}> "90Fsq" .
        ?subQ <{SUBFIELD_VALUE_PROP.value}> "Clusterisation manuelle" .
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
        if aff and isinstance(aff, Literal):
            norm = aff.value.lower()
            if norm in {"created", "manual"}:
                return True
    return False


def _ensure_unique_manual_agent_clusters(store: Store, anchor_id: str, intermarc: Intermarc) -> None:
    new_targets = _extract_manual_agent_targets(intermarc)
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
        ?subQ <{SUBFIELD_VALUE_PROP.value}> "Clusterisation manuelle" .
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
        if _is_manual_anchor(store, ark_index, target):
            raise ValueError(
                f"Impossible d'enregistrer : l'agent {target} est deja ancre d'un cluster manuel."
            )


def _extract_work_cluster_targets(intermarc: Intermarc) -> set[str]:
    targets: set[str] = set()
    for zone in intermarc.get_zone("90F"):
        note = next((sz.valeur for sz in zone.sousZones if sz.code == "90F$q"), None)
        if not note:
            continue
        norm_note = str(note).strip().lower()
        if norm_note not in {"clusterisation manuelle", "clusterisation script"}:
            continue
        target = next((sz.valeur for sz in zone.sousZones if sz.code == "90F$3"), None)
        if target:
            targets.add(str(target).strip())
    return targets


def _is_work_anchor(store: Store, ark_index: dict[str, str], target_ark: str) -> bool:
    target_id = ark_index.get(target_ark)
    if not target_id:
        return False
    query = f"""
    SELECT ?aff
    WHERE {{
      GRAPH <{record_graph(target_id).value}> {{
        ?rec <{HAS_FIELD.value}> ?field .
        ?field <{FIELD_CODE_PROP.value}> "90F" .
        ?field <{HAS_SUBFIELD.value}> ?subQ .
        ?subQ <{SUBFIELD_CODE_PROP.value}> "90Fsq" .
        ?subQ <{SUBFIELD_VALUE_PROP.value}> ?note .
        FILTER(?note = "Clusterisation manuelle" || ?note = "Clusterisation script")
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
        if aff and isinstance(aff, Literal):
            norm = aff.value.lower()
            if norm in {"created", "manual"}:
                return True
    return False


def _ensure_unique_work_clusters(store: Store, anchor_id: str, intermarc: Intermarc) -> None:
    new_targets = _extract_work_cluster_targets(intermarc)
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
        FILTER(?note = "Clusterisation manuelle" || ?note = "Clusterisation script")
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

    ark_index = load_ark_index(store)

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
    targets: set[str] = set()
    for zone in intermarc.get_zone("90F"):
        note = next((sz.valeur for sz in zone.sousZones if sz.code == "90F$q"), None)
        if not note:
            continue
        norm_note = str(note).strip().lower()
        if norm_note not in {"clusterisation manuelle", "clusterisation script"}:
            continue
        target = next((sz.valeur for sz in zone.sousZones if sz.code == "90F$3"), None)
        if target:
            targets.add(str(target).strip())
    return targets


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
    query = f"""
    SELECT ?aff
    WHERE {{
      GRAPH <{record_graph(target_id).value}> {{
        ?rec <{HAS_FIELD.value}> ?field .
        ?field <{FIELD_CODE_PROP.value}> "90F" .
        ?field <{HAS_SUBFIELD.value}> ?subQ .
        ?subQ <{SUBFIELD_CODE_PROP.value}> "90Fsq" .
        ?subQ <{SUBFIELD_VALUE_PROP.value}> ?note .
        FILTER(?note = "Clusterisation manuelle" || ?note = "Clusterisation script")
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
        if aff and isinstance(aff, Literal):
            norm = aff.value.lower()
            if norm in {"created", "manual"}:
                return True
    return False


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
        FILTER(?note1 = "Clusterisation manuelle" || ?note1 = "Clusterisation script")
        ?field1 <{HAS_SUBFIELD.value}> ?subT1 .
        ?subT1 <{SUBFIELD_CODE_PROP.value}> ?codeTarget1 .
        FILTER(?codeTarget1 = "90Fs3")
        ?subT1 <{SUBFIELD_VALUE_PROP.value}> "{work_ark_a}" .

        ?rec <{HAS_FIELD.value}> ?field2 .
        ?field2 <{FIELD_CODE_PROP.value}> "90F" .
        ?field2 <{HAS_SUBFIELD.value}> ?subQ2 .
        ?subQ2 <{SUBFIELD_CODE_PROP.value}> "90Fsq" .
        ?subQ2 <{SUBFIELD_VALUE_PROP.value}> ?note2 .
        FILTER(?note2 = "Clusterisation manuelle" || ?note2 = "Clusterisation script")
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
            FILTER(?note = "Clusterisation manuelle" || ?note = "Clusterisation script")
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
            FILTER(?note = "Clusterisation manuelle" || ?note = "Clusterisation script")
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
        FILTER(?note = "Clusterisation manuelle" || ?note = "Clusterisation script")
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


def update_record(dataset_id: str, record_id: str, *, type_raw: str, intermarc_json: str) -> None:
    record = _build_record_from_payload(record_id, type_raw, intermarc_json)

    with _STORE_LOCK:
        store = get_store_locked(dataset_id)
        if _is_agent_type(record.type_raw):
            _ensure_unique_manual_agent_clusters(store, record.id, record.intermarc)
        if _is_work_type(record.type_raw):
            _ensure_unique_work_clusters(store, record.id, record.intermarc)
        if _is_expression_type(record.type_raw):
            _ensure_unique_expression_clusters(store, record.id, record.intermarc)
        ark_index = load_ark_index(store)
        if record.ark:
            ark_index[record.ark] = record.id
        clear_record_graph(store, record.id)
        quads = list(_build_record_quads(record, ark_index))
        if quads:
            store.extend(quads)
        store.flush()
    datasets.touch_dataset(dataset_id)
