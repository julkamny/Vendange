from __future__ import annotations

import logging
from collections import Counter, defaultdict, deque
from dataclasses import dataclass, field
from typing import Dict, List, Set, Tuple
from datetime import date

from data_curation.authority.nes_service import NameExpansionService
from data_curation.models import AgentResponsibility, Entity, Intermarc, WorkGroupKey, Zone, SousZone
from data_curation.utils.title_cleaner import (
    clean_title_text,
    contains_illustration_trigger,
    debug_match_targets,
    extract_responsible_person_arks,
    get_nlp,
    match_variants_in_title,
    normalize_title_for_clustering,
)
from data_curation.matching.triggers import RESP_TERMS_ADAPT, RESP_TERMS_ILL
from data_curation.utils.text_norm import normalize_for_match


LOGGER = logging.getLogger(__name__)

ILLUSTRATION_TRIGGER_VARIANTS = tuple(sorted(RESP_TERMS_ILL))
ADAPTATION_TRIGGER_VARIANTS = tuple(sorted(RESP_TERMS_ADAPT))
ADAPTATION_TRIGGER_NORMALIZED = {normalize_for_match(term) for term in RESP_TERMS_ADAPT}
MAX_DEP_DISTANCE = 4

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


def contains_adaptation_trigger(text: str | None) -> bool:
    """Return True if the provided text contains adaptation responsibility terms."""

    if not text:
        return False
    normalized = normalize_for_match(text)
    if not normalized:
        return False
    return any(term in normalized for term in ADAPTATION_TRIGGER_NORMALIZED)


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


def _build_controlled_value_lookup(entities: List[Entity] | None) -> Dict[str, str]:
    lookup: Dict[str, str] = {}
    if not entities:
        return lookup
    for entity in entities:
        if entity.type_entite.strip().lower() != "valeur contrôlée":
            continue
        label_values = entity.intermarc.get_subfield_values("169", "a")
        ark = entity.ark()
        if not ark or not label_values:
            continue
        label = label_values[0]
        lookup.setdefault(label, ark)
    return lookup


def _build_expression_and_manifestation_index(
    entities: List[Entity] | None,
) -> Tuple[Dict[str, List[Entity]], Dict[str, List[Entity]]]:
    expressions_by_work: Dict[str, List[Entity]] = defaultdict(list)
    manifestations_by_expression: Dict[str, List[Entity]] = defaultdict(list)
    if not entities:
        return {}, {}

    for entity in entities:
        entity_type = entity.type_entite.strip().lower()
        if entity_type.startswith("expression"):
            expr_ark = entity.ark()
            if not expr_ark:
                continue
            for work_ark in _expression_work_arks(entity):
                expressions_by_work[work_ark].append(entity)
        elif entity_type.startswith("manifestation"):
            for expr_ark in entity.intermarc.get_subfield_values("740", "3"):
                manifestations_by_expression[expr_ark].append(entity)

    return dict(expressions_by_work), dict(manifestations_by_expression)


def _manifestation_titles(manifestation: Entity) -> List[str]:
    titles: List[str] = []
    for zone in manifestation.intermarc.get_zone("245"):
        parts = [sub.valeur for sub in zone.sousZones if sub.code.startswith("245$")]
        if parts:
            titles.append(" ".join(parts))
    return titles


def _build_trigger_spans(doc, title: str, triggers: Tuple[str, ...]) -> List:
    spans: List = []
    for start, end in match_variants_in_title(title, triggers):
        span = doc.char_span(start, end, alignment_mode="expand")
        if span is not None:
            spans.append(span)
    return spans


def _dependency_distance(token_a, token_b, max_distance: int = MAX_DEP_DISTANCE) -> int | None:
    if token_a == token_b:
        return 0

    queue = deque([(token_a, 0)])
    visited = {token_a}

    while queue:
        token, distance = queue.popleft()
        if distance >= max_distance:
            continue

        neighbours = list(token.children)
        head = token.head
        if head is not None and head != token:
            neighbours.append(head)

        for neighbour in neighbours:
            if neighbour in visited:
                continue
            if neighbour == token_b:
                return distance + 1
            visited.add(neighbour)
            queue.append((neighbour, distance + 1))

    return None


def _agent_linked_to_trigger(title: str, doc, trigger_spans: List, agent_variants: List[str]) -> bool:
    if not trigger_spans or not agent_variants:
        return False

    for start, end in match_variants_in_title(title, agent_variants):
        span = doc.char_span(start, end, alignment_mode="expand")
        if span is None:
            continue
        for trigger_span in trigger_spans:
            if span.sent != trigger_span.sent:
                continue
            distance = _dependency_distance(span.root, trigger_span.root)
            if distance is not None and distance <= MAX_DEP_DISTANCE:
                return True
    return False


def _is_subset_counter(smaller: Counter, bigger: Counter) -> bool:
    for agent_key, count in smaller.items():
        if bigger.get(agent_key, 0) < count:
            return False
    return True


def _extra_agent_entries(
    larger_agents: Tuple[AgentResponsibility, ...],
    smaller_counter: Counter,
) -> List[AgentResponsibility]:
    remaining = smaller_counter.copy()
    extras: List[AgentResponsibility] = []
    for agent in larger_agents:
        key = (agent.ark, agent.relator)
        if remaining.get(key, 0):
            remaining[key] -= 1
            continue
        extras.append(agent)
    return extras


def _ensure_relationship_zone(entity: Entity, target_ark: str, qualifier_ark: str) -> Entity:
    if not target_ark or not qualifier_ark:
        return entity

    for zone in entity.intermarc.get_zone("552"):
        has_target = any(sub.code == "552$3" and sub.valeur == target_ark for sub in zone.sousZones)
        has_qualifier = any(sub.code == "552$q" and sub.valeur == qualifier_ark for sub in zone.sousZones)
        if has_target and has_qualifier:
            return entity

    new_intermarc = _clone_intermarc(entity.intermarc)
    new_zone = Zone(
        code="552",
        sousZones=[
            SousZone(code="552$3", valeur=target_ark),
            SousZone(code="552$q", valeur=qualifier_ark),
        ],
    )
    new_intermarc.add_zone(new_zone)
    return entity.clone_with_new_intermarc(new_intermarc)

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
    """Cluster works that share the same authority identifier and compatible agents."""

    groups: Dict[str, List[Entity]] = {}
    work_keys: Dict[str, WorkGroupKey] = {}
    for work in works:
        key = work.work_group_key()
        if not key:
            continue
        groups.setdefault(key.base_identifier, []).append(work)
        work_keys[work.id_entitelrm] = key

    today = date.today().isoformat()
    updated: Dict[str, Entity] = {w.id_entitelrm: w for w in works}
    cluster_summaries: List[ClusterResult] = []
    adaptation_pairs: Set[Tuple[str, str]] = set()

    ark_index = {
        ark: entity
        for entity in (all_entities or [])
        if (ark := entity.ark())
    }

    nes = NameExpansionService(local_entities_by_ark=ark_index)
    normalized_cache: Dict[str, str] = {}
    adaptation_flag_cache: Dict[str, bool] = {}
    agent_counter_cache: Dict[str, Counter] = {}
    manifest_titles_cache: Dict[str, List[str]] = {}
    manifest_analysis_cache: Dict[str, Tuple] = {}
    agent_variants_cache: Dict[str, List[str]] = {}

    controlled_lookup = _build_controlled_value_lookup(all_entities)
    adaptation_role_ark = controlled_lookup.get("Responsable de l'adaptation")
    link_has_adaptation_ark = controlled_lookup.get("A pour adaptation")
    link_is_adaptation_of_ark = controlled_lookup.get("Est une adaptation de")

    expressions_by_work, manifestations_by_expression = _build_expression_and_manifestation_index(all_entities)

    def _normalized_title(entity: Entity) -> str:
        if entity.id_entitelrm not in normalized_cache:
            normalized_cache[entity.id_entitelrm] = _normalized_title_key(entity, nes)
            setattr(entity, "_normalized_title_for_cluster", normalized_cache[entity.id_entitelrm])
        return normalized_cache[entity.id_entitelrm]

    def _is_adaptation(entity: Entity) -> bool:
        if entity.id_entitelrm not in adaptation_flag_cache:
            adaptation_flag_cache[entity.id_entitelrm] = contains_adaptation_trigger(entity.title_main())
        return adaptation_flag_cache[entity.id_entitelrm]

    def _agent_counter(entity: Entity) -> Counter:
        if entity.id_entitelrm not in agent_counter_cache:
            key = work_keys.get(entity.id_entitelrm)
            if not key:
                agent_counter_cache[entity.id_entitelrm] = Counter()
            else:
                agent_counter_cache[entity.id_entitelrm] = Counter((a.ark, a.relator) for a in key.agents)
        return agent_counter_cache[entity.id_entitelrm]

    def _agent_variants(agent_ark: str) -> List[str]:
        if agent_ark in agent_variants_cache:
            return agent_variants_cache[agent_ark]
        variants = nes.ensure_variants(agent_ark) or []
        if not variants:
            entity = ark_index.get(agent_ark)
            if entity:
                label = entity.title_main()
                if label:
                    variants = [label]
        agent_variants_cache[agent_ark] = variants
        return variants

    def _manifestation_analyses(entity: Entity) -> List[Tuple[str, Tuple]]:
        titles = manifest_titles_cache.get(entity.id_entitelrm)
        if titles is None:
            titles = []
            work_ark = entity.ark()
            if work_ark:
                for expression in expressions_by_work.get(work_ark, []):
                    expr_ark = expression.ark()
                    if not expr_ark:
                        continue
                    for manifestation in manifestations_by_expression.get(expr_ark, []):
                        titles.extend(_manifestation_titles(manifestation))
            manifest_titles_cache[entity.id_entitelrm] = titles

        analyses: List[Tuple[str, Tuple]] = []
        for title in titles:
            if not title:
                continue
            cached = manifest_analysis_cache.get(title)
            if cached is None:
                doc = get_nlp()(title)
                ill_spans = _build_trigger_spans(doc, title, ILLUSTRATION_TRIGGER_VARIANTS)
                adapt_spans = _build_trigger_spans(doc, title, ADAPTATION_TRIGGER_VARIANTS)
                cached = (doc, ill_spans, adapt_spans)
                manifest_analysis_cache[title] = cached
            analyses.append((title, cached))
        return analyses

    def _evaluate_subset(
        smaller: Entity,
        larger: Entity,
        smaller_counter: Counter,
        larger_counter: Counter,
    ) -> Tuple[str, Entity, Entity] | None:
        key_large = work_keys.get(larger.id_entitelrm)
        if not key_large:
            return None

        extras = _extra_agent_entries(key_large.agents, smaller_counter)
        if not extras:
            return None

        unresolved = False
        for agent in extras:
            if adaptation_role_ark and agent.relator == adaptation_role_ark:
                return ("adaptation", smaller, larger)

        analyses = _manifestation_analyses(larger)

        for agent in extras:
            variants = _agent_variants(agent.ark)
            found_illustration = False
            found_adaptation = False

            for title, (doc, ill_spans, adapt_spans) in analyses:
                if not found_illustration and ill_spans and _agent_linked_to_trigger(title, doc, ill_spans, variants):
                    found_illustration = True
                if not found_adaptation and adapt_spans and _agent_linked_to_trigger(title, doc, adapt_spans, variants):
                    found_adaptation = True
                if found_illustration and found_adaptation:
                    break

            if found_adaptation:
                return ("adaptation", smaller, larger)
            if not found_illustration:
                unresolved = True

        if not unresolved and _is_adaptation(smaller) == _is_adaptation(larger):
            return ("cluster", smaller, larger)
        return None

    def _add_cluster_edges(edges: Dict[str, Set[str]], a: Entity, b: Entity) -> None:
        edges.setdefault(a.id_entitelrm, set()).add(b.id_entitelrm)
        edges.setdefault(b.id_entitelrm, set()).add(a.id_entitelrm)

    def _choose_anchor(candidates: List[Entity]) -> Entity:
        def has_suffix(ent: Entity) -> bool:
            title = ent.title_main() or ""
            return bool(
                normalize_for_match(title).find("illustr") >= 0
                or normalize_for_match(title).find("image") >= 0
            )

        without_suffix = [ent for ent in candidates if not has_suffix(ent)]
        pool = without_suffix or candidates
        return min(pool, key=lambda ent: ent.id_entitelrm)

    for members in groups.values():
        by_title: Dict[str, List[Entity]] = {}
        for work in members:
            title_key = _normalized_title(work)
            if not title_key:
                continue
            by_title.setdefault(title_key, []).append(work)

        for same_title_members in by_title.values():
            if len(same_title_members) < 2:
                continue

            cluster_edges: Dict[str, Set[str]] = {}
            for idx, left in enumerate(same_title_members):
                left_counter = _agent_counter(left)
                for right in same_title_members[idx + 1 :]:
                    right_counter = _agent_counter(right)

                    if not left_counter or not right_counter:
                        continue

                    if left_counter == right_counter:
                        if _is_adaptation(left) == _is_adaptation(right):
                            _add_cluster_edges(cluster_edges, left, right)
                        continue

                    relation: Tuple[str, Entity, Entity] | None = None
                    if _is_subset_counter(left_counter, right_counter):
                        relation = _evaluate_subset(left, right, left_counter, right_counter)
                    if relation is None and _is_subset_counter(right_counter, left_counter):
                        relation = _evaluate_subset(right, left, right_counter, left_counter)

                    if relation is None:
                        continue

                    if relation[0] == "cluster":
                        origin, target = relation[1], relation[2]
                        _add_cluster_edges(cluster_edges, origin, target)
                    elif relation[0] == "adaptation":
                        origin, adaptation = relation[1], relation[2]
                        adaptation_pairs.add((origin.id_entitelrm, adaptation.id_entitelrm))

            if not cluster_edges:
                continue

            id_to_entity = {ent.id_entitelrm: ent for ent in same_title_members}
            visited: Set[str] = set()

            for entity_id in list(cluster_edges.keys()):
                if entity_id in visited:
                    continue

                stack = [entity_id]
                component_ids: List[str] = []
                while stack:
                    current = stack.pop()
                    if current in visited:
                        continue
                    visited.add(current)
                    component_ids.append(current)
                    for neighbour in cluster_edges.get(current, set()):
                        if neighbour not in visited:
                            stack.append(neighbour)

                if len(component_ids) < 2:
                    continue

                component_entities = [id_to_entity[cid] for cid in component_ids]
                anchor = _choose_anchor(component_entities)
                others = [ent for ent in component_entities if ent.id_entitelrm != anchor.id_entitelrm]

                anchor_entity = updated[anchor.id_entitelrm]
                existing_targets = _existing_cluster_targets(anchor_entity.intermarc)
                new_inter = _clone_intermarc(anchor_entity.intermarc)
                added = False

                for other in others:
                    ark = other.ark() or ""
                    if ark and ark in existing_targets:
                        continue
                    zone = Zone(
                        code="90F",
                        sousZones=[
                            SousZone(code="90F$a", valeur=ark),
                            SousZone(code="90F$q", valeur="Clusterisation script"),
                            SousZone(code="90F$d", valeur=today),
                        ],
                    )
                    new_inter.add_zone(zone)
                    if ark:
                        existing_targets.add(ark)
                    added = True

                if not added:
                    continue

                updated_anchor = anchor_entity.clone_with_new_intermarc(new_inter)
                updated[anchor.id_entitelrm] = updated_anchor

                cluster_summaries.append(
                    ClusterResult(
                        anchor_id=anchor.id_entitelrm,
                        anchor_ark=updated_anchor.ark() or "",
                        clustered_ids=[ent.id_entitelrm for ent in others],
                        clustered_arks=[ent.ark() or "" for ent in others],
                    )
                )

    if link_has_adaptation_ark and link_is_adaptation_of_ark:
        for original_id, adaptation_id in adaptation_pairs:
            original = updated.get(original_id)
            adaptation = updated.get(adaptation_id)
            if not original or not adaptation:
                continue
            original_ark = original.ark()
            adaptation_ark = adaptation.ark()
            if not original_ark or not adaptation_ark:
                continue

            updated_original = _ensure_relationship_zone(original, adaptation_ark, link_has_adaptation_ark)
            updated_adaptation = _ensure_relationship_zone(adaptation, original_ark, link_is_adaptation_of_ark)
            updated[original_id] = updated_original
            updated[adaptation_id] = updated_adaptation

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
