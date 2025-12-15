from __future__ import annotations

import logging
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple
from datetime import date
from pathlib import Path

from data_curation.api.pg import controlled_repo, entities_repo
from data_curation.authority.nes_service import NameExpansionService
from data_curation.models import AgentResponsibility, Entity, Intermarc, Zone, SousZone
from data_curation.curation.adaptation import (
    AdaptationTriggerMatch,
    ILLUSTRATION_TRIGGER_VARIANTS,
    agent_linked_to_adaptation,
    agent_linked_to_illustration,
    build_adaptation_triggers,
    build_trigger_spans,
)
from data_curation.curation.agents import (
    build_canonical_relator_lookup,
    canonical_relator,
)
from data_curation.utils.title_cleaner import (
    clean_title_text,
    contains_adaptation_trigger,
    contains_illustration_trigger,
    debug_match_targets,
    extract_responsible_person_arks,
    get_nlp,
    match_variants_in_title,
    normalize_title_for_clustering,
    render_dependency_graph,
)
from data_curation.utils.text_norm import normalize_for_match


LOGGER = logging.getLogger(__name__)

YEAR_PATTERN = re.compile(r"\d{4}")

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

@dataclass
class ManifestationTitleContext:
    title: str
    manifestation_id: str
    manifestation_ark: Optional[str]
    doc: Any
    illustration_spans: List[Any]
    adaptation_triggers: List[AdaptationTriggerMatch]
    agent_variants: List[str]
    dependency_path: Path | None = None


def _clone_intermarc(intermarc: Intermarc) -> Intermarc:
    """Create a fresh copy of an intermarc structure to avoid mutating originals."""
    return Intermarc(
        zones=[
            Zone(
                code=z.code,
                sousZones=[
                    SousZone(code=sz.code, valeur=sz.valeur, affected_by_curation=sz.affected_by_curation)
                    for sz in z.sousZones
                ],
                affected_by_curation=z.affected_by_curation,
            )
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
        ark = next((sz.valeur for sz in zone.sousZones if sz.code == "90F$3"), None)
        if ark:
            targets.add(ark)
    return targets


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


def _is_subset_counter(smaller: Counter, bigger: Counter) -> bool:
    for agent_key, count in smaller.items():
        if bigger.get(agent_key, 0) < count:
            return False
    return True


def _extra_agent_entries(
    larger_agents: Tuple[AgentResponsibility, ...],
    smaller_counter: Counter,
    relator_lookup: Dict[str, str],
) -> List[AgentResponsibility]:
    remaining = smaller_counter.copy()
    extras: List[AgentResponsibility] = []
    for agent in larger_agents:
        key = (agent.ark, canonical_relator(agent.relator, relator_lookup))
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
            SousZone(code="552$3", valeur=target_ark, affected_by_curation="created"),
            SousZone(code="552$q", valeur=qualifier_ark, affected_by_curation="created"),
        ],
        affected_by_curation="created",
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
        remove_adaptation_groups=contains_adaptation_trigger(title),
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
    dataset_id: str,
    works: List[Entity],
    all_entities: List[Entity] | None = None,
) -> Tuple[List[Entity], List[ClusterResult]]:
    """Cluster works that share the same authority identifier and compatible agents."""

    groups: Dict[str, List[Entity]] = {}
    work_agents_map: Dict[str, Tuple[AgentResponsibility, ...]] = {}
    works_by_normalized_title: Dict[str, List[Entity]] = defaultdict(list)
    evaluated_pairs: Set[Tuple[str, str]] = set()
    anchor_ids: Set[str] = set()
    clustered_non_anchor_ids: Set[str] = set()

    for work in works:
        agents = tuple(work.work_agents())
        if agents:
            work_agents_map[work.id_entitelrm] = agents
        else:
            LOGGER.debug("[%s] Skipping work without declared agents for clustering/adaptation", work.id_entitelrm)
            work_agents_map[work.id_entitelrm] = tuple()

        key = work.work_group_key()
        base_identifier = key.base_identifier if key else None
        if base_identifier:
            groups.setdefault(base_identifier, []).append(work)

    today = date.today().isoformat()
    updated: Dict[str, Entity] = {w.id_entitelrm: w for w in works}
    cluster_summaries: List[ClusterResult] = []
    adaptation_pairs: Set[Tuple[str, str]] = set()
    adaptations_to_review: Set[str] = set()

    entity_cache: Dict[str, Entity] = {}

    def _fetch_entity_by_ark(ark: str) -> Entity | None:
        if not ark:
            return None
        if ark in entity_cache:
            return entity_cache[ark]
        row = entities_repo.get_by_ark(dataset_id, ark)
        if row:
            _, ent = row
            entity_cache[ark] = ent
            return ent
        return None

    nes = NameExpansionService(get_local_entity=_fetch_entity_by_ark)
    normalized_cache: Dict[str, str] = {}
    adaptation_flag_cache: Dict[str, bool] = {}
    agent_counter_cache: Dict[str, Counter] = {}
    manifest_titles_cache: Dict[str, List[Tuple[str, Entity]]] = {}
    manifest_analysis_cache: Dict[str, Tuple[Any, List[Any], List[AdaptationTriggerMatch], Path | None]] = {}
    agent_variants_cache: Dict[str, List[str]] = {}
    dependency_graph_logged_manifestations: Set[str] = set()
    work_oldest_year_cache: Dict[str, Optional[int]] = {}

    source_creator_label = "Créateur de l'œuvre source (Auteur du texte) / Créatrice de l'œuvre source (Autrice du texte)"
    adaptation_role_ark = controlled_repo.get_controlled_ark_by_label(dataset_id, "Responsable de l'adaptation")
    source_creator_role_ark = controlled_repo.get_controlled_ark_by_label(dataset_id, source_creator_label)
    link_has_adaptation_ark = controlled_repo.get_controlled_ark_by_label(dataset_id, "A pour adaptation")
    link_is_adaptation_of_ark = controlled_repo.get_controlled_ark_by_label(dataset_id, "Est une adaptation de")

    # Synthesize a minimal lookup for canonical relator builder
    controlled_lookup: Dict[str, str] = {}
    if source_creator_role_ark:
        controlled_lookup[source_creator_label] = source_creator_role_ark
    
    canonical_relator_lookup = build_canonical_relator_lookup(controlled_lookup)

    expressions_by_work, manifestations_by_expression = _build_expression_and_manifestation_index(all_entities)

    def _normalized_title(entity: Entity) -> str:
        if entity.id_entitelrm not in normalized_cache:
            normalized_cache[entity.id_entitelrm] = _normalized_title_key(entity, nes)
            setattr(entity, "_normalized_title_for_cluster", normalized_cache[entity.id_entitelrm])
        return normalized_cache[entity.id_entitelrm]

    def _is_adaptation(entity: Entity) -> bool:
        if entity.id_entitelrm not in adaptation_flag_cache:
            title_segments = entity.intermarc.get_subfield_values("150", "a") + entity.intermarc.get_subfield_values("150", "u")
            raw_text = " ".join(segment for segment in title_segments if segment) or ""
            flag = contains_adaptation_trigger(raw_text)
            if not flag and _has_adaptation_role(entity):
                flag = True
                LOGGER.debug(
                    "[%s] Adaptation inferred via adaptation relator in agent responsibilities",
                    entity.id_entitelrm,
                )
            if not flag and _has_source_creator_role(entity):
                flag = True
                LOGGER.debug(
                    "[%s] Adaptation inferred via source creator role in agent responsibilities",
                    entity.id_entitelrm,
                )
            adaptation_flag_cache[entity.id_entitelrm] = flag
            LOGGER.debug(
                "[%s] Adaptation status cached: %s",
                entity.id_entitelrm,
                adaptation_flag_cache[entity.id_entitelrm],
            )
        return adaptation_flag_cache[entity.id_entitelrm]

    def _agent_counter(entity: Entity) -> Counter:
        if entity.id_entitelrm not in agent_counter_cache:
            agents = work_agents_map.get(entity.id_entitelrm, tuple())
            agent_counter_cache[entity.id_entitelrm] = Counter(
                (a.ark, canonical_relator(a.relator, canonical_relator_lookup))
                for a in agents
                if a.ark
            )
            LOGGER.debug(
                "[%s] Computed agent counter with %s entries",
                entity.id_entitelrm,
                len(agent_counter_cache[entity.id_entitelrm]),
            )
        return agent_counter_cache[entity.id_entitelrm]

    def _agent_variants(agent_ark: str) -> List[str]:
        if agent_ark in agent_variants_cache:
            return agent_variants_cache[agent_ark]
        variants = nes.ensure_variants(agent_ark) or []
        if not variants:
            entity = _entity_by_ark(agent_ark)
            if entity:
                label = entity.title_main()
                if label:
                    variants = [label]
        agent_variants_cache[agent_ark] = variants
        return variants

    def _has_source_creator_role(entity: Entity) -> bool:
        if not source_creator_role_ark:
            return False
        for agent in work_agents_map.get(entity.id_entitelrm, tuple()):
            if agent.relator == source_creator_role_ark:
                return True
        return False

    def _has_adaptation_role(entity: Entity) -> bool:
        if not adaptation_role_ark:
            return False
        for agent in work_agents_map.get(entity.id_entitelrm, tuple()):
            if agent.relator == adaptation_role_ark:
                return True
        return False

    def _get_or_create_title_analysis(title: str) -> Tuple[Any, List[Any], List[AdaptationTriggerMatch], Path | None]:
        cached = manifest_analysis_cache.get(title)
        if cached is None:
            doc = get_nlp()(title)
            ill_spans = build_trigger_spans(doc, title, ILLUSTRATION_TRIGGER_VARIANTS)
            adapt_triggers = build_adaptation_triggers(doc, title)
            dependency_path = render_dependency_graph(doc, f"Manifestation: {title}") if adapt_triggers else None
            cached = (doc, ill_spans, adapt_triggers, dependency_path)
            manifest_analysis_cache[title] = cached
            LOGGER.debug("Cached manifestation title analysis for '%s' (adaptation triggers: %s)", title, bool(adapt_triggers))
        return cached

    def _manifestation_analyses(entity: Entity) -> List[ManifestationTitleContext]:
        cached_entries = manifest_titles_cache.get(entity.id_entitelrm)
        if cached_entries is None:
            cached_entries = []
            work_ark = entity.ark()
            if work_ark:
                for expression in expressions_by_work.get(work_ark, []):
                    expr_ark = expression.ark()
                    if not expr_ark:
                        continue
                    for manifestation in manifestations_by_expression.get(expr_ark, []):
                        for title in _manifestation_titles(manifestation):
                            if not title:
                                continue
                            cached_entries.append((title, manifestation))
            manifest_titles_cache[entity.id_entitelrm] = cached_entries
            LOGGER.debug(
                "[%s] Indexed %s manifestation titles for adaptation checks",
                entity.id_entitelrm,
                len(cached_entries),
            )

        analyses: List[ManifestationTitleContext] = []
        for title, manifestation in cached_entries:
            doc, ill_spans, adapt_triggers, dependency_path = _get_or_create_title_analysis(title)
            manifestation_id = manifestation.id_entitelrm
            manifestation_ark = manifestation.ark()
            if dependency_path and manifestation_id not in dependency_graph_logged_manifestations:
                dependency_graph_logged_manifestations.add(manifestation_id)
                LOGGER.debug(
                    "[%s] Dependency graph for manifestation adaptation triggers (manifestation_id=%s, ark=%s): %s",
                    entity.id_entitelrm,
                    manifestation_id,
                    manifestation_ark or "N/A",
                    dependency_path,
                )
            manifest_variants: List[str] = []
            for ark in extract_responsible_person_arks(manifestation):
                manifest_variants.extend(_agent_variants(ark))
            analyses.append(
                ManifestationTitleContext(
                    title=title,
                    manifestation_id=manifestation_id,
                    manifestation_ark=manifestation_ark,
                    doc=doc,
                    illustration_spans=ill_spans,
                    adaptation_triggers=adapt_triggers,
                    agent_variants=manifest_variants,
                    dependency_path=dependency_path,
                )
            )
        return analyses

    def _entity_by_ark(ark: str) -> Entity | None:
        if not ark:
            return None
        for ent in updated.values():
            if ent.ark() == ark:
                return ent
        cached = entity_cache.get(ark)
        if cached:
            return cached
        return _fetch_entity_by_ark(ark)

    def _extract_years(values: List[str]) -> List[int]:
        years: List[int] = []
        for value in values:
            if not value:
                continue
            for candidate in YEAR_PATTERN.findall(value):
                try:
                    years.append(int(candidate))
                except ValueError:
                    continue
        return years

    def _oldest_year_for_work(work: Entity) -> Optional[int]:
        if work.id_entitelrm in work_oldest_year_cache:
            return work_oldest_year_cache[work.id_entitelrm]

        years = _extract_years(work.intermarc.get_subfield_values("040", "d"))
        work_ark = work.ark()
        if work_ark:
            for expression in expressions_by_work.get(work_ark, []):
                expr_ark = expression.ark()
                if not expr_ark:
                    continue
                for manifestation in manifestations_by_expression.get(expr_ark, []):
                    years.extend(_extract_years(manifestation.intermarc.get_subfield_values("040", "d")))
                    years.extend(_extract_years(manifestation.intermarc.get_subfield_values("260", "d")))
                    years.extend(_extract_years(manifestation.intermarc.get_subfield_values("261", "d")))

        oldest = min(years) if years else None
        work_oldest_year_cache[work.id_entitelrm] = oldest
        return oldest

    def _prune_adaptation_origins(adaptation: Entity) -> Tuple[Entity, Set[str]]:
        if not link_is_adaptation_of_ark:
            return adaptation, set()

        grouped: Dict[str, List[Tuple[int, Zone, Entity, str]]] = defaultdict(list)
        for idx, zone in enumerate(adaptation.intermarc.zones):
            if zone.code != "552":
                continue
            if link_is_adaptation_of_ark not in zone.subfield_values("552$q"):
                continue
            target_ark = next((sz.valeur for sz in zone.sousZones if sz.code == "552$3"), "")
            if not target_ark:
                continue
            origin_entity = _entity_by_ark(target_ark)
            if not origin_entity:
                continue
            normalized = _normalized_title(origin_entity)
            if not normalized:
                continue
            grouped[normalized].append((idx, zone, origin_entity, target_ark))

        removals: Set[int] = set()
        removed_origin_arks: Set[str] = set()
        for normalized, entries in grouped.items():
            if len(entries) < 2:
                continue

            def _sort_key(entry: Tuple[int, Zone, Entity, str]) -> Tuple[int, float, str]:
                origin = entry[2]
                oldest_year = _oldest_year_for_work(origin)
                year_key = float(oldest_year) if oldest_year is not None else float("inf")
                return (
                    0 if origin.id_entitelrm in anchor_ids else 1,
                    year_key,
                    origin.id_entitelrm,
                )

            winner = min(entries, key=_sort_key)
            removed_entities: List[Entity] = []
            for entry in entries:
                if entry is winner:
                    continue
                removals.add(entry[0])
                removed_entities.append(entry[2])
                removed_origin_arks.add(entry[3])

            if removed_entities:
                LOGGER.debug(
                    "[%s] Trimmed adaptation originals sharing normalized title '%s'; kept %s (%s), removed %s",
                    adaptation.id_entitelrm,
                    normalized,
                    winner[2].id_entitelrm,
                    winner[2].ark() or "N/A",
                    ", ".join(f"{ent.id_entitelrm} ({ent.ark() or 'N/A'})" for ent in removed_entities),
                )

        if not removals:
            return adaptation, removed_origin_arks

        new_intermarc = _clone_intermarc(adaptation.intermarc)
        new_intermarc.zones = [zone for idx, zone in enumerate(new_intermarc.zones) if idx not in removals]
        return adaptation.clone_with_new_intermarc(new_intermarc), removed_origin_arks

    def _remove_adaptation_targets_from_original(original: Entity, adaptation_ark: str) -> Entity:
        if not adaptation_ark or not link_has_adaptation_ark:
            return original

        indices_to_remove: Set[int] = set()
        for idx, zone in enumerate(original.intermarc.zones):
            if zone.code != "552":
                continue
            has_target = any(sub.code == "552$3" and sub.valeur == adaptation_ark for sub in zone.sousZones)
            has_qualifier = link_has_adaptation_ark in zone.subfield_values("552$q")
            if has_target and has_qualifier:
                indices_to_remove.add(idx)

        if not indices_to_remove:
            return original

        new_intermarc = _clone_intermarc(original.intermarc)
        new_intermarc.zones = [zone for idx, zone in enumerate(new_intermarc.zones) if idx not in indices_to_remove]
        LOGGER.debug(
            "[%s] Removed %s obsolete adaptation links targeting %s",
            original.id_entitelrm,
            len(indices_to_remove),
            adaptation_ark,
        )
        return original.clone_with_new_intermarc(new_intermarc)

    for work in works:
        normalized_title = _normalized_title(work)
        if normalized_title:
            works_by_normalized_title.setdefault(normalized_title, []).append(work)

    def _entity_adaptation_signals(entity: Entity) -> bool:
        if _is_adaptation(entity):
            return True
        contexts = _manifestation_analyses(entity)
        agents = work_agents_map.get(entity.id_entitelrm, tuple())
        if not agents:
            return False
        for agent in agents:
            if not agent.ark:
                continue
            variants = _agent_variants(agent.ark)
            for analysis in contexts:
                if not analysis.adaptation_triggers:
                    continue
                combined_variants = [v for v in variants + analysis.agent_variants if v]
                if not combined_variants:
                    continue
                unique_variants = list(dict.fromkeys(combined_variants))
                if agent_linked_to_adaptation(
                    analysis.title,
                    analysis.doc,
                    analysis.adaptation_triggers,
                    unique_variants,
                ):
                    manifestation_descriptor = f"{analysis.manifestation_id} ({analysis.manifestation_ark or 'N/A'})"
                    if analysis.dependency_path:
                        LOGGER.debug(
                            "[%s] Adaptation supported by manifestation '%s' [%s] (graph: %s)",
                            entity.id_entitelrm,
                            analysis.title,
                            manifestation_descriptor,
                            analysis.dependency_path,
                        )
                    else:
                        LOGGER.debug(
                            "[%s] Adaptation supported by manifestation '%s' [%s]",
                            entity.id_entitelrm,
                            analysis.title,
                            manifestation_descriptor,
                        )
                    return True
        return False

    def _evaluate_subset(
        smaller: Entity,
        larger: Entity,
        smaller_counter: Counter,
        larger_counter: Counter,
    ) -> Tuple[str, Entity, Entity] | None:
        def _adaptation_signal_fallback() -> Tuple[str, Entity, Entity] | None:
            larger_signals = _entity_adaptation_signals(larger)
            smaller_signals = _entity_adaptation_signals(smaller)

            if larger_signals and not smaller_signals:
                LOGGER.debug(
                    "[%s → %s] Adaptation inferred via shared-agent signals",
                    smaller.id_entitelrm,
                    larger.id_entitelrm,
                )
                return ("adaptation", smaller, larger)
            if smaller_signals and not larger_signals:
                LOGGER.debug(
                    "[%s → %s] Adaptation inferred via shared-agent signals",
                    larger.id_entitelrm,
                    smaller.id_entitelrm,
                )
                return ("adaptation", larger, smaller)
            return None

        larger_agents = work_agents_map.get(larger.id_entitelrm, tuple())
        if not larger_agents:
            LOGGER.debug("[%s] No agents to evaluate subset relationship", larger.id_entitelrm)
            return None

        smaller_agents = work_agents_map.get(smaller.id_entitelrm, tuple())
        smaller_agent_arks = {agent.ark for agent in smaller_agents if agent.ark}

        if source_creator_role_ark:
            for agent in larger_agents:
                if agent.ark in smaller_agent_arks and agent.relator == source_creator_role_ark:
                    LOGGER.debug(
                        "[%s → %s] Adaptation inferred via source creator relator",
                        smaller.id_entitelrm,
                        larger.id_entitelrm,
                    )
                    return ("adaptation", smaller, larger)

        extras = _extra_agent_entries(larger_agents, smaller_counter, canonical_relator_lookup)
        if not extras:
            fallback_relation = _adaptation_signal_fallback()
            if fallback_relation:
                return fallback_relation
            LOGGER.debug(
                "[%s → %s] No extra agents found during subset evaluation",
                smaller.id_entitelrm,
                larger.id_entitelrm,
            )
            return None

        unresolved = False
        for agent in extras:
            if adaptation_role_ark and agent.relator == adaptation_role_ark:
                LOGGER.debug(
                    "[%s → %s] Adaptation inferred via dedicated adaptation relator",
                    smaller.id_entitelrm,
                    larger.id_entitelrm,
                )
                return ("adaptation", smaller, larger)

        analyses = _manifestation_analyses(larger)

        for agent in extras:
            variants = _agent_variants(agent.ark)
            found_illustration = False
            found_adaptation = False

            for analysis in analyses:
                combined_variants = [v for v in variants + analysis.agent_variants if v]
                if not combined_variants:
                    continue
                unique_variants = list(dict.fromkeys(combined_variants))
                if (
                    not found_illustration
                    and analysis.illustration_spans
                    and agent_linked_to_illustration(
                        analysis.title,
                        analysis.doc,
                        analysis.illustration_spans,
                        unique_variants,
                    )
                ):
                    found_illustration = True
                if (
                    not found_adaptation
                    and analysis.adaptation_triggers
                    and agent_linked_to_adaptation(
                        analysis.title,
                        analysis.doc,
                        analysis.adaptation_triggers,
                        unique_variants,
                    )
                ):
                    found_adaptation = True
                if found_illustration and found_adaptation:
                    break

            if found_adaptation:
                LOGGER.debug(
                    "[%s → %s] Adaptation confirmed via manifestation analysis",
                    smaller.id_entitelrm,
                    larger.id_entitelrm,
                )
                return ("adaptation", smaller, larger)
            if not found_illustration:
                unresolved = True

        fallback_relation = _adaptation_signal_fallback()
        if fallback_relation:
            return fallback_relation

        if not unresolved and _is_adaptation(smaller) == _is_adaptation(larger):
            return ("cluster", smaller, larger)
        return None

    def _evaluate_equal_agents(left: Entity, right: Entity) -> Tuple[str, Entity, Entity] | None:
        left_has_source = _has_source_creator_role(left)
        right_has_source = _has_source_creator_role(right)

        if left_has_source and not right_has_source:
            return ("adaptation", right, left)
        if right_has_source and not left_has_source:
            return ("adaptation", left, right)

        left_signals = _entity_adaptation_signals(left)
        right_signals = _entity_adaptation_signals(right)

        if left_signals and not right_signals:
            return ("adaptation", right, left)
        if right_signals and not left_signals:
            return ("adaptation", left, right)
        return None

    def _determine_relation(left: Entity, right: Entity) -> Tuple[str, Entity, Entity] | None:
        left_counter = _agent_counter(left)
        right_counter = _agent_counter(right)

        if not left_counter or not right_counter:
            LOGGER.debug(
                "[%s ↔ %s] Skipping pair without sufficient agent data",
                left.id_entitelrm,
                right.id_entitelrm,
            )
            return None

        if left_counter == right_counter:
            equal_relation = _evaluate_equal_agents(left, right)
            if equal_relation:
                return equal_relation
            if _is_adaptation(left) == _is_adaptation(right):
                LOGGER.debug(
                    "[%s ↔ %s] Identical agent counters, eligible for clustering",
                    left.id_entitelrm,
                    right.id_entitelrm,
                )
                return ("cluster", left, right)
            LOGGER.debug(
                "[%s ↔ %s] Identical agents but diverging adaptation status; skipping cluster",
                left.id_entitelrm,
                right.id_entitelrm,
            )
            return None

        relation: Tuple[str, Entity, Entity] | None = None
        if _is_subset_counter(left_counter, right_counter):
            relation = _evaluate_subset(left, right, left_counter, right_counter)
        if relation is None and _is_subset_counter(right_counter, left_counter):
            relation = _evaluate_subset(right, left, right_counter, left_counter)
        return relation

    def _record_adaptation_pair(origin: Entity, adaptation: Entity) -> None:
        nonlocal adaptation_pairs

        origin_has_source = _has_source_creator_role(origin)
        adaptation_has_source = _has_source_creator_role(adaptation)

        if origin_has_source and not adaptation_has_source:
            LOGGER.debug(
                "[%s ↔ %s] Swapping adaptation orientation due to source creator role",
                origin.id_entitelrm,
                adaptation.id_entitelrm,
            )
            origin, adaptation = adaptation, origin
            origin_has_source, adaptation_has_source = adaptation_has_source, origin_has_source
        elif origin_has_source and adaptation_has_source:
            LOGGER.debug(
                "[%s ↔ %s] Skipping adaptation link; both works reference source creator role",
                origin.id_entitelrm,
                adaptation.id_entitelrm,
            )
            return

        origin_adapt_signal = _entity_adaptation_signals(origin)
        adaptation_adapt_signal = _entity_adaptation_signals(adaptation)

        if origin_adapt_signal and not adaptation_adapt_signal:
            LOGGER.debug(
                "[%s ↔ %s] Swapping adaptation orientation based on adaptation signals",
                origin.id_entitelrm,
                adaptation.id_entitelrm,
            )
            origin, adaptation = adaptation, origin
            origin_adapt_signal, adaptation_adapt_signal = adaptation_adapt_signal, origin_adapt_signal

        if origin_adapt_signal and adaptation_adapt_signal:
            LOGGER.debug(
                "[%s ↔ %s] Skipping adaptation link; both works exhibit adaptation signals",
                origin.id_entitelrm,
                adaptation.id_entitelrm,
            )
            return

        if _has_source_creator_role(origin):
            LOGGER.debug(
                "[%s ↔ %s] Skipping adaptation link post-orientation; origin still has source creator role",
                origin.id_entitelrm,
                adaptation.id_entitelrm,
            )
            return

        adaptation_pairs.add((origin.id_entitelrm, adaptation.id_entitelrm))
        LOGGER.debug(
            "[%s ↔ %s] Recorded adaptation pair (origin=%s, adaptation=%s)",
            origin.id_entitelrm,
            adaptation.id_entitelrm,
            origin.id_entitelrm,
            adaptation.id_entitelrm,
        )

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
                for right in same_title_members[idx + 1 :]:
                    pair_key = tuple(sorted((left.id_entitelrm, right.id_entitelrm)))
                    evaluated_pairs.add(pair_key)

                    relation = _determine_relation(left, right)

                    if relation is None:
                        continue

                    if relation[0] == "cluster":
                        origin, target = relation[1], relation[2]
                        _add_cluster_edges(cluster_edges, origin, target)
                    elif relation[0] == "adaptation":
                        origin, adaptation = relation[1], relation[2]
                        LOGGER.debug(
                            "[%s → %s] Recorded adaptation pair during base identifier pass",
                            origin.id_entitelrm,
                            adaptation.id_entitelrm,
                        )
                        _record_adaptation_pair(origin, adaptation)

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

                anchor_ids.add(anchor.id_entitelrm)
                clustered_non_anchor_ids.update(ent.id_entitelrm for ent in others)

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
                            SousZone(code="90F$3", valeur=ark, affected_by_curation="created"),
                            SousZone(code="90F$q", valeur="Clusterisation script", affected_by_curation="created"),
                            SousZone(code="90F$d", valeur=today, affected_by_curation="created"),
                        ],
                        affected_by_curation="created",
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

    for normalized_title, same_title_members in works_by_normalized_title.items():
        if len(same_title_members) < 2:
            continue
        for idx, left in enumerate(same_title_members):
            for right in same_title_members[idx + 1 :]:
                pair_key = tuple(sorted((left.id_entitelrm, right.id_entitelrm)))
                if pair_key in evaluated_pairs:
                    continue
                evaluated_pairs.add(pair_key)

                relation = _determine_relation(left, right)
                if relation is None or relation[0] != "adaptation":
                    continue

                origin, adaptation = relation[1], relation[2]
                LOGGER.debug(
                    "[%s → %s] Recorded adaptation pair during normalized-title pass",
                    origin.id_entitelrm,
                    adaptation.id_entitelrm,
                )
                _record_adaptation_pair(origin, adaptation)

    if link_has_adaptation_ark and link_is_adaptation_of_ark:
        for original_id, adaptation_id in adaptation_pairs:
            if (original_id not in anchor_ids and original_id in clustered_non_anchor_ids) or (
                adaptation_id not in anchor_ids and adaptation_id in clustered_non_anchor_ids
            ):
                continue

            original = updated.get(original_id)
            adaptation = updated.get(adaptation_id)
            if not original or not adaptation:
                LOGGER.debug(
                    "[%s → %s] Skipping adaptation link: missing entity in updated map",
                    original_id,
                    adaptation_id,
                )
                continue
            original_ark = original.ark()
            adaptation_ark = adaptation.ark()
            if not original_ark or not adaptation_ark:
                LOGGER.debug(
                    "[%s → %s] Skipping adaptation link: missing ARK (%s, %s)",
                    original_id,
                    adaptation_id,
                    original_ark,
                    adaptation_ark,
                )
                continue

            updated_original = _ensure_relationship_zone(original, adaptation_ark, link_has_adaptation_ark)
            updated_adaptation = _ensure_relationship_zone(adaptation, original_ark, link_is_adaptation_of_ark)
            updated[original_id] = updated_original
            updated[adaptation_id] = updated_adaptation
            adaptations_to_review.add(adaptation_id)
            LOGGER.debug(
                "[%s ↔ %s] Applied reciprocal adaptation relationships",
                original_id,
                adaptation_id,
            )

        for adaptation_id in adaptations_to_review:
            adaptation_entity = updated.get(adaptation_id)
            if not adaptation_entity:
                continue
            adaptation_ark = adaptation_entity.ark()
            pruned_adaptation, removed_origin_arks = _prune_adaptation_origins(adaptation_entity)
            updated[adaptation_id] = pruned_adaptation
            if not adaptation_ark or not removed_origin_arks:
                continue
            for origin_ark in removed_origin_arks:
                origin_entity = _entity_by_ark(origin_ark)
                if not origin_entity:
                    continue
                cleaned_origin = _remove_adaptation_targets_from_original(origin_entity, adaptation_ark)
                updated[origin_entity.id_entitelrm] = cleaned_origin

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
                            SousZone(code="90F$3", valeur=candidate_ark, affected_by_curation="created"),
                            SousZone(code="90F$q", valeur="Clusterisation script", affected_by_curation="created"),
                            SousZone(code="90F$d", valeur=today, affected_by_curation="created"),
                        ],
                        affected_by_curation="created",
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
