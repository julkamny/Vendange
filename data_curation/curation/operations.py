from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Dict, List, Tuple, Set
from datetime import date

from scripts.authority.nes_service import NameExpansionService
from scripts.models import Entity, Intermarc, Zone, SousZone
from scripts.utils.title_cleaner import (
    clean_title_text,
    contains_illustration_trigger,
    debug_match_targets,
    extract_responsible_person_arks,
    match_variants_in_title,
    normalize_title_for_clustering,
)


LOGGER = logging.getLogger(__name__)

@dataclass
class ClusterResult:
    anchor_id: str
    anchor_ark: str
    clustered_ids: List[str]
    clustered_arks: List[str]


@dataclass
class ExpressionClusterResult:
    anchor_expression_id: str
    anchor_expression_ark: str
    anchor_work_id: str
    anchor_work_ark: str
    clustered_expression_ids: List[str] = field(default_factory=list)
    clustered_expression_arks: List[str] = field(default_factory=list)


def _clone_intermarc(intermarc: Intermarc) -> Intermarc:
    """Create a fresh copy of an intermarc structure to avoid mutating originals."""
    return Intermarc(
        zones=[
            Zone(code=z.code, sousZones=[SousZone(code=sz.code, valeur=sz.valeur) for sz in z.sousZones])
            for z in intermarc.zones
        ]
    )


def _expression_work_arks(expr: Entity) -> List[str]:
    """Return referenced work ARKs for an expression entity."""
    arks = expr.intermarc.get_subfield_values("140", "3")
    if arks:
        return arks
    return expr.intermarc.get_subfield_values("750", "3")


def _expression_signature(expr: Entity) -> Set[Tuple[str, str]]:
    """Compute the set of (051$a, 041$a) signature pairs for an expression."""
    vals_051 = expr.intermarc.get_subfield_values("051", "a")
    vals_041 = expr.intermarc.get_subfield_values("041", "a")
    if not vals_051 or not vals_041:
        return set()
    return {(v051, v041) for v051 in vals_051 for v041 in vals_041}


def _existing_cluster_targets(intermarc: Intermarc) -> Set[str]:
    """Return ARKs already linked via a 90F zone emitted by the clusterisation script."""
    targets: Set[str] = set()
    for zone in intermarc.get_zone("90F"):
        note = next((sz.valeur for sz in zone.sousZones if sz.code == "90F$q"), None)
        if not note or note.lower() != "clusterisation script":
            continue
        ark = next((sz.valeur for sz in zone.sousZones if sz.code == "90F$a"), None)
        if ark:
            targets.add(ark)
    return targets


def _normalized_title_key(entity: Entity, nes: NameExpansionService) -> str:
    """Return the normalized title used as a clustering key."""

    title = entity.title_main() or ""
    if not title:
        return ""

    person_spans: List[Tuple[int, int]] = []
    person_arks = extract_responsible_person_arks(entity)
    ark2variants: Dict[str, List[str]] = {}
    if person_arks:
        for ark in person_arks:
            variants = nes.ensure_variants(ark)
            if variants:
                ark2variants[ark] = variants

    debug_match_targets(entity.id_entitelrm, title, ark2variants)

    if ark2variants:
        variant_strings = [variant for variants in ark2variants.values() for variant in variants]
        person_spans = match_variants_in_title(title, variant_strings)

    cleaned = clean_title_text(
        title,
        person_spans=person_spans,
        remove_illustration_groups=contains_illustration_trigger(title),
    )
    normalized = normalize_title_for_clustering(cleaned)

    if cleaned != title:
        LOGGER.info(
            "[%s] Cleaned title for clustering -> '%s' (normalized: '%s')",
            entity.id_entitelrm,
            cleaned,
            normalized,
        )
    else:
        LOGGER.debug(
            "[%s] Title unchanged during clustering cleanup (normalized: '%s')",
            entity.id_entitelrm,
            normalized,
        )

    return normalized


def cluster_works_by_title_responsibilities(
    works: List[Entity],
    all_entities: List[Entity] | None = None,
) -> Tuple[List[Entity], List[ClusterResult]]:
    """
    Implements rule:
    - Consider works that share same 015$c and same 700$3
    - Clean and normalize titles
    - For each cluster (size >= 2), choose an anchor W1 (prefer the one whose title
      does not contain the suffix heuristic; else smallest id).
    - Produce a new intermarc for W1 with 1 new 90F per clustered work:
        90F$a = ARK of clustered work
        90F$q = "Clusterisation script"
        90F$d = TODAY_DATE (YYYY-MM-DD)
    Returns updated works (with anchors modified) and a list of cluster summaries.
    """

    # Group by (015$c, 700$3)
    groups: Dict[Tuple[str, str], List[Entity]] = {}
    for w in works:
        key = w.work_group_key()
        if not key:
            continue
        groups.setdefault(key, []).append(w)

    today = date.today().isoformat()
    updated: Dict[str, Entity] = {w.id_entitelrm: w for w in works}
    cluster_summaries: List[ClusterResult] = []

    ark_index = {
        ark: entity
        for entity in (all_entities or [])
        if (ark := entity.ark())
    }

    nes = NameExpansionService(local_entities_by_ark=ark_index)
    normalized_cache: Dict[str, str] = {}

    for _, members in groups.items():
        # Further split by normalized base title
        by_title: Dict[str, List[Entity]] = {}
        for w in members:
            if w.id_entitelrm not in normalized_cache:
                normalized_cache[w.id_entitelrm] = _normalized_title_key(w, nes)
                setattr(w, "_normalized_title_for_cluster", normalized_cache[w.id_entitelrm])
            base = normalized_cache[w.id_entitelrm]

            if not base:
                continue
            by_title.setdefault(base, []).append(w)

        for _, same_title_members in by_title.items():
            if len(same_title_members) < 2:
                continue

            # Choose anchor: prefer title without suffix; else smallest id
            def has_suffix(ent: Entity) -> bool:
                t = ent.title_main() or ""
                import re

                return bool(re.search(r"\b(illustrations?|vignettes?|illustré(?:e|s)?)\s+(de|par)\b", t, flags=re.IGNORECASE))

            anchor = None
            no_suffix = [e for e in same_title_members if not has_suffix(e)]
            if no_suffix:
                # If multiple, pick smallest id
                anchor = sorted(no_suffix, key=lambda e: e.id_entitelrm)[0]
            else:
                anchor = sorted(same_title_members, key=lambda e: e.id_entitelrm)[0]

            others = [e for e in same_title_members if e.id_entitelrm != anchor.id_entitelrm]
            if not others:
                continue

            # Modify anchor by adding 90F for each other
            new_inter = Intermarc(zones=[Zone(z.code, list(z.sousZones)) for z in anchor.intermarc.zones])
            for o in others:
                ark = o.ark() or ""
                z = Zone(code="90F", sousZones=[
                    SousZone(code="90F$a", valeur=ark),
                    SousZone(code="90F$q", valeur="Clusterisation script"),
                    SousZone(code="90F$d", valeur=today),
                ])
                new_inter.add_zone(z)

            updated[anchor.id_entitelrm] = anchor.clone_with_new_intermarc(new_inter)

            cluster_summaries.append(
                ClusterResult(
                    anchor_id=anchor.id_entitelrm,
                    anchor_ark=anchor.ark() or "",
                    clustered_ids=[e.id_entitelrm for e in others],
                    clustered_arks=[e.ark() or "" for e in others],
                )
            )

    # Return updated list in original order
    return [updated[w.id_entitelrm] for w in works], cluster_summaries


def cluster_expressions_by_051_and_041(
    expressions: List[Entity],
    work_clusters: List[ClusterResult],
) -> Tuple[List[Entity], List[ExpressionClusterResult]]:
    """
    For each work cluster, propagate the clustering to expressions based on matching
    (051$a, 041$a) signatures. When an expression from a clustered work shares at
    least one signature pair with an anchor expression, add a 90F zone linking it
    to the anchor expression (same payload as for works).
    """

    if not expressions or not work_clusters:
        return expressions, []

    expressions_by_work_ark: Dict[str, List[Entity]] = {}
    for expr in expressions:
        for work_ark in _expression_work_arks(expr):
            expressions_by_work_ark.setdefault(work_ark, []).append(expr)

    today = date.today().isoformat()
    updated: Dict[str, Entity] = {expr.id_entitelrm: expr for expr in expressions}
    expr_cluster_results: Dict[str, ExpressionClusterResult] = {}

    assigned_candidates: Set[str] = set()

    for cluster in work_clusters:
        anchor_ark = cluster.anchor_ark
        if not anchor_ark:
            continue
        anchor_expressions = expressions_by_work_ark.get(anchor_ark, [])
        if not anchor_expressions:
            continue

        for clustered_ark in cluster.clustered_arks:
            if not clustered_ark:
                continue
            candidate_expressions = expressions_by_work_ark.get(clustered_ark, [])
            if not candidate_expressions:
                continue

            for anchor_expr in anchor_expressions:
                anchor_signature = _expression_signature(anchor_expr)
                if not anchor_signature:
                    continue

                anchor_entity = updated[anchor_expr.id_entitelrm]
                existing_targets = _existing_cluster_targets(anchor_entity.intermarc)

                for candidate_expr in candidate_expressions:
                    if candidate_expr.id_entitelrm == anchor_expr.id_entitelrm:
                        continue

                    candidate_signature = _expression_signature(candidate_expr)
                    if not candidate_signature:
                        continue

                    if not anchor_signature.intersection(candidate_signature):
                        continue

                    candidate_ark = candidate_expr.ark() or ""
                    if not candidate_ark or candidate_ark in existing_targets or candidate_expr.id_entitelrm in assigned_candidates:
                        continue

                    new_intermarc = _clone_intermarc(anchor_entity.intermarc)
                    new_zone = Zone(
                        code="90F",
                        sousZones=[
                            SousZone(code="90F$a", valeur=candidate_ark),
                            SousZone(code="90F$q", valeur="Clusterisation script"),
                            SousZone(code="90F$d", valeur=today),
                        ],
                    )
                    new_intermarc.add_zone(new_zone)

                    anchor_entity = anchor_entity.clone_with_new_intermarc(new_intermarc)
                    updated[anchor_entity.id_entitelrm] = anchor_entity
                    existing_targets.add(candidate_ark)

                    result = expr_cluster_results.get(anchor_entity.id_entitelrm)
                    if not result:
                        result = ExpressionClusterResult(
                            anchor_expression_id=anchor_entity.id_entitelrm,
                            anchor_expression_ark=anchor_entity.ark() or "",
                            anchor_work_id=cluster.anchor_id,
                            anchor_work_ark=anchor_ark,
                        )
                        expr_cluster_results[anchor_entity.id_entitelrm] = result

                    result.clustered_expression_ids.append(candidate_expr.id_entitelrm)
                    result.clustered_expression_arks.append(candidate_ark)
                    assigned_candidates.add(candidate_expr.id_entitelrm)

    ordered = [updated[expr.id_entitelrm] for expr in expressions]
    return ordered, list(expr_cluster_results.values())
