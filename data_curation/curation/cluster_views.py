from __future__ import annotations

import unicodedata
from collections import defaultdict
from typing import Dict, List, Optional, Sequence, Set, Tuple

from data_curation.api import db
from data_curation.api.schemas import (
    AgentCluster,
    AgentClusterItem,
    AgentListRow,
    CountStats,
    EntitySummary,
    ExpressionAnchorGroupView,
    ExpressionClusterItemView,
    ExpressionItemView,
    ManifestationItemView,
    MediaKind,
    RecordPayload,
    RelationshipStats,
    WorkCluster,
    WorkClusterItem,
    WorkListRow,
    WorkspaceAgentsResponse,
    WorkspaceWorksResponse,
)
from data_curation.models import Entity

CLUSTER_SCRIPT_NOTE = "Clusterisation script"
CLUSTER_MANUAL_NOTE = "Clusterisation manuelle"

GENERAL_RELATIONSHIP_CODES: Dict[str, Tuple[str, ...]] = {
    "oeuvre": (
        "500",
        "501",
        "506",
        "509",
        "50N",
        "54T",
        "550",
        "551",
        "552",
        "553",
        "554",
        "555",
        "556",
        "557",
        "559",
        "55A",
        "55B",
        "55C",
        "55E",
        "55F",
        "55M",
        "55P",
        "55R",
        "55S",
        "55Z",
    ),
    "expression": ("501", "506", "509", "50N", "540", "541", "542", "543", "544", "547", "54C", "54P", "54T"),
    "manifestation": ("501", "506", "509", "50N", "530", "531", "532", "533", "534", "535", "536", "537", "538", "53M"),
}


MEDIA_MAP: Dict[str, Tuple[str, str]] = {
    "texte": ("📖", "Texte"),
    "texte note": ("📝", "Texte noté"),
    "image fixe": ("🖼️", "Image fixe"),
    "image animee": ("🎬", "Image animée"),
    "parole enoncee": ("🗣️", "Parole énoncée"),
    "musique": ("🎵", "Musique"),
    "musique executee": ("🎶", "Musique exécutée"),
    "musique notee": ("🎼", "Musique notée"),
    "expression performative": ("🎭", "Expression performative"),
}

AGGREGATE_LABEL_NORM = "agregat editorial"
AGGREGATE_KIND = MediaKind(kind_code=AGGREGATE_LABEL_NORM, emoji="🧺", label="Agrégat éditorial")


def _normalize_type(value: str) -> str:
    norm = (value or "").strip().lower()
    if norm in {"œuvre", "oeuvre", "work"}:
        return "oeuvre"
    if norm.startswith("expression"):
        return "expression"
    if norm.startswith("manifestation"):
        return "manifestation"
    if "identite publique de personne" in norm or "personne" == norm:
        return "personne"
    if "collectivite" in norm:
        return "collectivite"
    if "famille" in norm:
        return "famille"
    return norm or value


def _zone_text(entity: Entity, zone_code: str) -> Optional[str]:
    for zone in entity.intermarc.get_zone(zone_code):
        parts = [sub.valeur.strip() for sub in zone.sousZones if isinstance(sub.valeur, str) and sub.valeur.strip()]
        if parts:
            return " ".join(parts)
    return None


def _title_of(entity: Entity) -> Optional[str]:
    return _zone_text(entity, "150")


def _manifestation_title(entity: Entity) -> Optional[str]:
    return _zone_text(entity, "245")


def _expression_work_arks(expr: Entity) -> List[str]:
    vals = expr.intermarc.get_subfield_values("140", "3")
    if vals:
        return vals
    return expr.intermarc.get_subfield_values("750", "3")


def _manifestation_expression_arks(manifestation: Entity) -> List[str]:
    return manifestation.intermarc.get_subfield_values("740", "3")


def _expression_cluster_targets(expr: Entity) -> List[Tuple[str, Optional[str], str]]:
    targets: List[Tuple[str, Optional[str], str]] = []
    for zone in expr.intermarc.get_zone("90F"):
        note = next((sub.valeur for sub in zone.sousZones if sub.code == "90F$q"), None)
        origin = "manual" if note == CLUSTER_MANUAL_NOTE else "script" if note == CLUSTER_SCRIPT_NOTE else None
        if not origin:
            continue
        target = (
            next((sub.valeur for sub in zone.sousZones if sub.code == "90F$3"), None)
            if origin == "manual"
            else next((sub.valeur for sub in zone.sousZones if sub.code == "90F$a"), None)
        )
        if not target:
            continue
        date = next((sub.valeur for sub in zone.sousZones if sub.code == "90F$d"), None)
        targets.append((target, date, origin))
    return targets


def _normalize_label(text: str) -> str:
    normalized = (
        unicodedata.normalize("NFD", text or "")
        .encode("ascii", "ignore")
        .decode("ascii")
        .lower()
        .replace("œ", "oe")
        .strip()
    )
    return normalized


def _extract_controlled_value_label(entity: Optional[Entity]) -> Optional[str]:
    if not entity:
        return None
    for zone in entity.intermarc.get_zone("169"):
        label = next((sub.valeur for sub in zone.sousZones if sub.code == "169$a"), None)
        if label and isinstance(label, str) and label.strip():
            return label.strip()
    return None


def _media_kinds(entity: Entity, lookup_by_ark: Dict[str, Entity]) -> List[MediaKind]:
    kinds: List[MediaKind] = []

    def _record_label(ark: str) -> Optional[str]:
        return _extract_controlled_value_label(lookup_by_ark.get(ark))

    def _append_from_label(label: str) -> None:
        norm = _normalize_label(label)
        mapping = MEDIA_MAP.get(norm)
        if mapping:
            emoji, friendly = mapping
            kinds.append(MediaKind(kind_code=norm, emoji=emoji, label=friendly))

    # Editorial aggregate detection via 010$g
    for zone in entity.intermarc.get_zone("010"):
        for sub in zone.sousZones:
            if sub.code != "010$g" or not sub.valeur:
                continue
            label = _record_label(str(sub.valeur))
            if label and _normalize_label(label) == AGGREGATE_LABEL_NORM:
                kinds.append(AGGREGATE_KIND)
                break

    for zone in entity.intermarc.get_zone("051"):
        for sub in zone.sousZones:
            if sub.code != "051$a" or not sub.valeur:
                continue
            label = _record_label(str(sub.valeur))
            if label:
                _append_from_label(label)

    # Deduplicate by emoji to keep payload small
    dedup: Dict[str, MediaKind] = {}
    for kind in kinds:
        if kind.emoji not in dedup:
            dedup[kind.emoji] = kind
    return list(dedup.values())


def _relationship_stats(ark: Optional[str], outgoing: Dict[str, Set[str]], incoming: Dict[str, Set[str]]) -> RelationshipStats:
    if not ark:
        return RelationshipStats()
    return RelationshipStats(outgoing=len(outgoing.get(ark, set())), incoming=len(incoming.get(ark, set())))


def _sort_key(text: str) -> str:
    return unicodedata.normalize("NFKD", text or "").casefold()


def _manual_agent_targets(entity: Entity) -> List[str]:
    targets: Set[str] = set()
    for zone in entity.intermarc.get_zone("90F"):
        note = next((sub.valeur for sub in zone.sousZones if sub.code == "90F$q"), None)
        if note and str(note).strip().lower() == CLUSTER_MANUAL_NOTE.lower():
            target = next((sub.valeur for sub in zone.sousZones if sub.code == "90F$3"), None)
            if target and isinstance(target, str) and target.strip():
                targets.add(target.strip())
    return list(targets)


class WorkspaceViewBuilder:
    def __init__(self, entities: Sequence[Entity]):
        self.entities = list(entities)
        self.entity_by_id: Dict[str, Entity] = {e.id_entitelrm: e for e in entities}
        self.entity_by_ark: Dict[str, Entity] = {ark: e for e in entities if (ark := e.ark())}
        self.type_by_id: Dict[str, str] = {e.id_entitelrm: _normalize_type(e.type_entite) for e in entities}

        self.work_id_by_ark: Dict[str, str] = {}
        self.work_title_by_ark: Dict[str, str] = {}
        self.expressions_by_work_ark: Dict[str, List[Entity]] = defaultdict(list)
        self.expressions_by_ark: Dict[str, Entity] = {}
        self.manifestations_by_expression_ark: Dict[str, List[Entity]] = defaultdict(list)
        self.clustered_work_arks: Set[str] = set()
        self.work_counts: Dict[str, CountStats] = {}

        self.relationship_outgoing: Dict[str, Set[str]] = defaultdict(set)
        self.relationship_incoming: Dict[str, Set[str]] = defaultdict(set)
        self.media_kinds_by_ark: Dict[str, List[MediaKind]] = {}

        self._build_indices()

    # -------- cache-friendly incremental updates --------
    def replace_entities(self, entities: Sequence[Entity]) -> None:
        """Update cached indices with a handful of freshly written entities.

        The builder was designed to be rebuilt wholesale; this method keeps the
        cached instance hot by swapping the changed entities in place and
        refreshing only the indices that depend on them.
        """

        work_arks_to_refresh: Set[str] = set()
        expr_arks_to_refresh: Set[str] = set()

        for entity in entities:
            existing = self.entity_by_id.get(entity.id_entitelrm)
            if existing:
                work_arks_to_refresh.update(self._work_arks_for_entity(existing))
                expr_ark = existing.ark() if _normalize_type(existing.type_entite) == "expression" else None
                if expr_ark:
                    expr_arks_to_refresh.add(expr_ark)
                self._prune_entity_indexes(existing)
                self._replace_entity_in_list(entity)
            else:
                self.entities.append(entity)

            work_arks_to_refresh.update(self._work_arks_for_entity(entity))
            expr_ark = entity.ark() if _normalize_type(entity.type_entite) == "expression" else None
            if expr_ark:
                expr_arks_to_refresh.add(expr_ark)

            self._index_entity(entity)

        for work_ark in work_arks_to_refresh:
            self._recompute_work_counts_for(work_ark)

        # When expressions move across works, refresh counts for the new parents too
        for expr_ark in expr_arks_to_refresh:
            for work_ark in self._work_arks_for_expression_ark(expr_ark):
                self._recompute_work_counts_for(work_ark)

    def _replace_entity_in_list(self, entity: Entity) -> None:
        for idx, ent in enumerate(self.entities):
            if ent.id_entitelrm == entity.id_entitelrm:
                self.entities[idx] = entity
                return

    def _work_arks_for_expression_ark(self, expr_ark: str) -> Set[str]:
        expr = self.expressions_by_ark.get(expr_ark)
        if not expr:
            return set()
        return set(_expression_work_arks(expr))

    def _work_arks_for_entity(self, entity: Entity) -> Set[str]:
        norm = _normalize_type(entity.type_entite)
        if norm == "oeuvre":
            return {entity.ark()} if entity.ark() else set()
        if norm == "expression":
            return set(_expression_work_arks(entity))
        if norm == "manifestation":
            work_arks: Set[str] = set()
            for expr_ark in _manifestation_expression_arks(entity):
                work_arks.update(self._work_arks_for_expression_ark(expr_ark))
            return work_arks
        return set()

    def _recompute_work_counts_for(self, work_ark: Optional[str]) -> None:
        if not work_ark:
            return
        exprs = self.expressions_by_work_ark.get(work_ark, [])
        manifests = 0
        for expr in exprs:
            expr_ark = expr.ark()
            if not expr_ark:
                continue
            manifests += len(self.manifestations_by_expression_ark.get(expr_ark, []))
        self.work_counts[work_ark] = CountStats(expressions=len(exprs), manifestations=manifests)

    def _collect_relationship_targets(self, entity: Entity) -> Set[str]:
        norm = _normalize_type(entity.type_entite)
        zone_codes = GENERAL_RELATIONSHIP_CODES.get(norm, ())
        targets: Set[str] = set()
        for code in zone_codes:
            for zone in entity.intermarc.get_zone(code):
                for sub in zone.sousZones:
                    if sub.code == f"{code}$3" and sub.valeur:
                        targets.add(str(sub.valeur).strip())
        return targets

    def _prune_entity_indexes(self, entity: Entity) -> None:
        entity_id = entity.id_entitelrm
        entity_ark = entity.ark()
        norm = _normalize_type(entity.type_entite)

        self.entity_by_id.pop(entity_id, None)
        self.type_by_id.pop(entity_id, None)
        if entity_ark:
            self.entity_by_ark.pop(entity_ark, None)
            self.media_kinds_by_ark.pop(entity_ark, None)

        if norm == "oeuvre" and entity_ark:
            self.work_id_by_ark.pop(entity_ark, None)
            self.work_title_by_ark.pop(entity_ark, None)
            self.clustered_work_arks.discard(entity_ark)
            self.work_counts.pop(entity_ark, None)

        if norm == "expression":
            expr_ark = entity.ark()
            if expr_ark:
                self.expressions_by_ark.pop(expr_ark, None)
            for work_ark in _expression_work_arks(entity):
                exprs = self.expressions_by_work_ark.get(work_ark)
                if exprs:
                    self.expressions_by_work_ark[work_ark] = [e for e in exprs if e.id_entitelrm != entity_id]
                    if not self.expressions_by_work_ark[work_ark]:
                        self.expressions_by_work_ark.pop(work_ark, None)

        if norm == "manifestation":
            for expr_ark in _manifestation_expression_arks(entity):
                manifests = self.manifestations_by_expression_ark.get(expr_ark)
                if manifests:
                    self.manifestations_by_expression_ark[expr_ark] = [m for m in manifests if m.id_entitelrm != entity_id]
                    if not self.manifestations_by_expression_ark[expr_ark]:
                        self.manifestations_by_expression_ark.pop(expr_ark, None)

        if entity_ark:
            old_targets = self.relationship_outgoing.pop(entity_ark, set())
            for target in old_targets:
                incoming = self.relationship_incoming.get(target)
                if incoming:
                    incoming.discard(entity_ark)
                    if not incoming:
                        self.relationship_incoming.pop(target, None)

    def _index_entity(self, entity: Entity) -> None:
        entity_id = entity.id_entitelrm
        entity_ark = entity.ark()
        norm = _normalize_type(entity.type_entite)

        self.entity_by_id[entity_id] = entity
        self.type_by_id[entity_id] = norm
        if entity_ark:
            self.entity_by_ark[entity_ark] = entity

        if norm == "oeuvre":
            if entity_ark:
                self.work_id_by_ark[entity_ark] = entity_id
                title = _title_of(entity)
                if title:
                    self.work_title_by_ark[entity_ark] = title
            for zone in entity.intermarc.get_zone("90F"):
                note = next((sub.valeur for sub in zone.sousZones if sub.code == "90F$q"), None)
                if note not in {CLUSTER_MANUAL_NOTE, CLUSTER_SCRIPT_NOTE}:
                    continue
                target = (
                    next((sub.valeur for sub in zone.sousZones if sub.code == "90F$3"), None)
                    if note == CLUSTER_MANUAL_NOTE
                    else next((sub.valeur for sub in zone.sousZones if sub.code == "90F$a"), None)
                )
                if target:
                    self.clustered_work_arks.add(str(target))

        elif norm == "expression":
            expr_ark = entity.ark()
            if expr_ark:
                self.expressions_by_ark[expr_ark] = entity
            for work_ark in _expression_work_arks(entity):
                self.expressions_by_work_ark.setdefault(work_ark, []).append(entity)

        elif norm == "manifestation":
            for expr_ark in _manifestation_expression_arks(entity):
                self.manifestations_by_expression_ark.setdefault(expr_ark, []).append(entity)

        if entity_ark:
            targets = self._collect_relationship_targets(entity)
            if targets:
                self.relationship_outgoing[entity_ark] = targets
                for target in targets:
                    self.relationship_incoming.setdefault(target, set()).add(entity_ark)

            self.media_kinds_by_ark[entity_ark] = _media_kinds(entity, self.entity_by_ark)

    @classmethod
    def from_dataset(cls, dataset_id: str) -> "WorkspaceViewBuilder":
        return cls(db.load_entities(dataset_id))

    # Index building -----------------------------------------------------
    def _build_indices(self) -> None:
        for ent in self.entities:
            norm = _normalize_type(ent.type_entite)
            ark = ent.ark()
            if norm == "oeuvre" and ark:
                self.work_id_by_ark[ark] = ent.id_entitelrm
                title = _title_of(ent)
                if title:
                    self.work_title_by_ark[ark] = title
                for zone in ent.intermarc.get_zone("90F"):
                    note = next((sub.valeur for sub in zone.sousZones if sub.code == "90F$q"), None)
                    if note not in {CLUSTER_SCRIPT_NOTE, CLUSTER_MANUAL_NOTE}:
                        continue
                    target = (
                        next((sub.valeur for sub in zone.sousZones if sub.code == "90F$3"), None)
                        if note == CLUSTER_MANUAL_NOTE
                        else next((sub.valeur for sub in zone.sousZones if sub.code == "90F$a"), None)
                    )
                    if target:
                        self.clustered_work_arks.add(str(target))

            if norm == "expression":
                expr_ark = ent.ark()
                if expr_ark:
                    self.expressions_by_ark[expr_ark] = ent
                for work_ark in _expression_work_arks(ent):
                    self.expressions_by_work_ark[work_ark].append(ent)
            elif norm == "manifestation":
                for expr_ark in _manifestation_expression_arks(ent):
                    self.manifestations_by_expression_ark[expr_ark].append(ent)

        for ent in self.entities:
            ark = ent.ark()
            if not ark:
                continue
            norm = _normalize_type(ent.type_entite)
            zone_codes = GENERAL_RELATIONSHIP_CODES.get(norm, ())
            for code in zone_codes:
                for zone in ent.intermarc.get_zone(code):
                    for sub in zone.sousZones:
                        if sub.code == f"{code}$3" and sub.valeur:
                            target = str(sub.valeur).strip()
                            if target:
                                self.relationship_outgoing[ark].add(target)
                                self.relationship_incoming[target].add(ark)

        for work_ark, exprs in self.expressions_by_work_ark.items():
            manifests = 0
            for expr in exprs:
                expr_ark = expr.ark()
                if not expr_ark:
                    continue
                manifests += len(self.manifestations_by_expression_ark.get(expr_ark, []))
            self.work_counts[work_ark] = CountStats(expressions=len(exprs), manifestations=manifests)

        for ark, entity in self.entity_by_ark.items():
            self.media_kinds_by_ark[ark] = _media_kinds(entity, self.entity_by_ark)

    # Summaries ----------------------------------------------------------
    def _summary_for_ark(self, ark: Optional[str], *, counts: Optional[CountStats] = None) -> EntitySummary:
        relationships = _relationship_stats(ark, self.relationship_outgoing, self.relationship_incoming)
        media_kinds = self.media_kinds_by_ark.get(ark or "", [])
        return EntitySummary(counts=counts, relationships=relationships, media_kinds=media_kinds)

    # Manifestations / expressions --------------------------------------
    def _manifestations_for_expression(self, expression_ark: str) -> List[ManifestationItemView]:
        items: List[ManifestationItemView] = []
        expression_entity = self.expressions_by_ark.get(expression_ark)
        expression_id = expression_entity.id_entitelrm if expression_entity else None
        for man in self.manifestations_by_expression_ark.get(expression_ark, []):
            man_ark = man.ark()
            summary = self._summary_for_ark(
                man_ark,
                counts=CountStats(expressions=0, manifestations=0),
            )
            items.append(
                ManifestationItemView(
                    id=man.id_entitelrm,
                    ark=man_ark or man.id_entitelrm,
                    title=_manifestation_title(man) or man.id_entitelrm,
                    expression_ark=expression_ark,
                    expression_id=expression_id,
                    original_expression_ark=expression_ark,
                    summary=summary,
                )
            )
        return items

    def _expression_item(self, expr: Entity) -> ExpressionItemView:
        expr_ark = expr.ark()
        work_arks = _expression_work_arks(expr)
        work_ark = work_arks[0] if work_arks else None
        work_id = self.work_id_by_ark.get(work_ark, None) if work_ark else None
        manifestations = expr_ark and self._manifestations_for_expression(expr_ark) or []
        counts = CountStats(expressions=0, manifestations=len(manifestations))
        summary = self._summary_for_ark(expr_ark, counts=counts)
        return ExpressionItemView(
            id=expr.id_entitelrm,
            ark=expr_ark or expr.id_entitelrm,
            title=_title_of(expr) or expr.id_entitelrm,
            work_ark=work_ark,
            work_id=work_id,
            manifestations=manifestations,
            summary=summary,
        )

    # Clusters -----------------------------------------------------------
    def _build_work_cluster(self, work: Entity) -> Optional[WorkCluster]:
        work_ark = work.ark() or ""
        cluster_items: List[WorkClusterItem] = []
        seen_targets: Set[str] = set()
        for zone in work.intermarc.get_zone("90F"):
            note = next((sub.valeur for sub in zone.sousZones if sub.code == "90F$q"), None)
            origin = "manual" if note == CLUSTER_MANUAL_NOTE else "script" if note == CLUSTER_SCRIPT_NOTE else None
            if not origin:
                continue
            target = (
                next((sub.valeur for sub in zone.sousZones if sub.code == "90F$3"), None)
                if origin == "manual"
                else next((sub.valeur for sub in zone.sousZones if sub.code == "90F$a"), None)
            )
            if not target or target in seen_targets:
                continue
            seen_targets.add(target)
            date = next((sub.valeur for sub in zone.sousZones if sub.code == "90F$d"), None)
            target_ent = self.entity_by_ark.get(str(target))
            summary = self._summary_for_ark(str(target))
            cluster_items.append(
                WorkClusterItem(
                    ark=str(target),
                    id=target_ent.id_entitelrm if target_ent else None,
                    title=_title_of(target_ent) if target_ent else str(target),
                    accepted=True,
                    date=date,
                    origin=origin,
                    summary=summary,
                )
            )

        is_member_only = work_ark and work_ark in self.clustered_work_arks
        if not cluster_items and is_member_only:
            return None

        cluster_work_arks = [work_ark] + [item.ark for item in cluster_items if item.ark]
        candidate_expressions: List[Entity] = []
        seen_expr_ids: Set[str] = set()
        for w_ark in cluster_work_arks:
            for expr in self.expressions_by_work_ark.get(w_ark, []):
                if expr.id_entitelrm in seen_expr_ids:
                    continue
                seen_expr_ids.add(expr.id_entitelrm)
                candidate_expressions.append(expr)

        clustered_by: Dict[str, str] = {}
        for expr in candidate_expressions:
            expr_ark = expr.ark()
            if not expr_ark:
                continue
            for target, _, _ in _expression_cluster_targets(expr):
                clustered_by.setdefault(target, expr.id_entitelrm)

        expression_groups: List[ExpressionAnchorGroupView] = []
        used_expr_arks: Set[str] = set()
        for expr in candidate_expressions:
            expr_ark = expr.ark()
            expr_work_ark = _expression_work_arks(expr)[0] if _expression_work_arks(expr) else None
            cluster_targets = _expression_cluster_targets(expr)
            is_clustered_elsewhere = expr_ark and expr_ark in clustered_by and clustered_by.get(expr_ark) != expr.id_entitelrm
            should_anchor = bool(cluster_targets) or expr_work_ark == work_ark
            if not should_anchor or is_clustered_elsewhere:
                continue

            anchor_view = self._expression_item(expr)
            clustered_items: List[ExpressionClusterItemView] = []
            for target_ark, date, origin in cluster_targets:
                target_entity = self.expressions_by_ark.get(target_ark)
                if target_entity:
                    base_view = self._expression_item(target_entity)
                else:
                    base_view = ExpressionItemView(
                        id=target_ark,
                        ark=target_ark,
                        title=target_ark,
                        work_ark=None,
                        work_id=None,
                        manifestations=[],
                        summary=self._summary_for_ark(target_ark, counts=CountStats(expressions=0, manifestations=0)),
                    )
                clustered_items.append(
                    ExpressionClusterItemView(
                        **base_view.dict(),
                        anchor_expression_id=expr.id_entitelrm,
                        accepted=True,
                        date=date,
                        origin=origin,
                    )
                )
                used_expr_arks.add(target_ark)
            used_expr_arks.add(anchor_view.ark or anchor_view.id)
            expression_groups.append(ExpressionAnchorGroupView(anchor=anchor_view, clustered=clustered_items))

        independent: List[ExpressionItemView] = []
        for expr in candidate_expressions:
            expr_ark = expr.ark()
            if expr_ark and expr_ark in used_expr_arks:
                continue
            if expr_ark and expr_ark in clustered_by and clustered_by.get(expr_ark) != expr.id_entitelrm:
                continue
            view = self._expression_item(expr)
            independent.append(view)
            if expr_ark:
                used_expr_arks.add(expr_ark)

        has_expression_cluster = any(group.clustered for group in expression_groups) or bool(independent)
        if not cluster_items and not has_expression_cluster:
            return None

        anchor_counts = self.work_counts.get(work_ark, CountStats())
        anchor_summary = self._summary_for_ark(work_ark, counts=anchor_counts)
        return WorkCluster(
            anchor_id=work.id_entitelrm,
            anchor_ark=work_ark or None,
            anchor_title=_title_of(work) or work.id_entitelrm,
            anchor_summary=anchor_summary,
            items=cluster_items,
            expression_groups=expression_groups,
            independent_expressions=independent,
        )

    def build_work_clusters(self) -> List[WorkCluster]:
        clusters: List[WorkCluster] = []
        for ent in self.entities:
            if _normalize_type(ent.type_entite) != "oeuvre":
                continue
            cluster = self._build_work_cluster(ent)
            if cluster:
                clusters.append(cluster)
        return clusters

    # Coverage / unclustered --------------------------------------------
    @staticmethod
    def _compute_coverage(clusters: Sequence[WorkCluster]) -> Dict[str, Set[str]]:
        coverage: Dict[str, Set[str]] = {
            "work_ids": set(),
            "work_arks": set(),
            "expression_ids": set(),
            "expression_arks": set(),
        }
        for cluster in clusters:
            coverage["work_ids"].add(cluster.anchor_id)
            if cluster.anchor_ark:
                coverage["work_arks"].add(cluster.anchor_ark)
            for item in cluster.items:
                if item.id:
                    coverage["work_ids"].add(item.id)
                if item.ark:
                    coverage["work_arks"].add(item.ark)
            for group in cluster.expression_groups:
                coverage["expression_ids"].add(group.anchor.id)
                if group.anchor.ark:
                    coverage["expression_arks"].add(group.anchor.ark)
                for expr in group.clustered:
                    coverage["expression_ids"].add(expr.id)
                    if expr.ark:
                        coverage["expression_arks"].add(expr.ark)
            for expr in cluster.independent_expressions:
                coverage["expression_ids"].add(expr.id)
                if expr.ark:
                    coverage["expression_arks"].add(expr.ark)
        return coverage

    def build_unclustered_work_rows(self, clusters: Sequence[WorkCluster]) -> List[WorkListRow]:
        coverage = self._compute_coverage(clusters)
        rows: List[WorkListRow] = []
        for ent in self.entities:
            if _normalize_type(ent.type_entite) != "oeuvre":
                continue
            if ent.id_entitelrm in coverage["work_ids"]:
                continue
            ark = ent.ark()
            if ark and ark in coverage["work_arks"]:
                continue
            counts = self.work_counts.get(ark or "", CountStats())
            row = WorkListRow(
                id=ent.id_entitelrm,
                ark=ark,
                title=_title_of(ent) or ent.id_entitelrm,
                type_norm="oeuvre",
                summary=self._summary_for_ark(ark, counts=counts),
            )
            rows.append(row)
        rows.sort(key=lambda r: _sort_key(r.title or r.id))
        return rows

    def work_row_for_ark(self, ark: str) -> Optional[WorkListRow]:
        entity = self.entity_by_ark.get(ark)
        if not entity or _normalize_type(entity.type_entite) != "oeuvre":
            return None
        counts = self.work_counts.get(ark, CountStats())
        return WorkListRow(
            id=entity.id_entitelrm,
            ark=ark,
            title=_title_of(entity) or entity.id_entitelrm,
            type_norm="oeuvre",
            summary=self._summary_for_ark(ark, counts=counts),
        )

    # Agent views --------------------------------------------------------
    def build_agent_views(self) -> WorkspaceAgentsResponse:
        agents: List[Entity] = [
            e for e in self.entities if _normalize_type(e.type_entite) in {"personne", "collectivite", "famille"}
        ]
        by_ark: Dict[str, Entity] = {e.ark(): e for e in agents if e.ark()}
        clusters: List[AgentCluster] = []
        coverage_arks: Set[str] = set()
        coverage_ids: Set[str] = set()
        for ent in agents:
            targets = _manual_agent_targets(ent)
            if not targets:
                continue
            items: List[AgentClusterItem] = []
            for target in targets:
                target_ent = by_ark.get(target)
                items.append(
                    AgentClusterItem(
                        ark=target,
                        id=target_ent.id_entitelrm if target_ent else None,
                        label=_title_of(target_ent) if target_ent else target,
                    )
                )
                coverage_arks.add(target)
                if target_ent:
                    coverage_ids.add(target_ent.id_entitelrm)
            clusters.append(
                AgentCluster(
                    anchor_id=ent.id_entitelrm,
                    anchor_ark=ent.ark(),
                    anchor_label=_title_of(ent) or ent.id_entitelrm,
                    items=items,
                )
            )
            coverage_arks.add(ent.ark() or "")
            coverage_ids.add(ent.id_entitelrm)

        unclustered: List[AgentListRow] = []
        for ent in agents:
            ark = ent.ark()
            if ent.id_entitelrm in coverage_ids or (ark and ark in coverage_arks):
                continue
            unclustered.append(
                AgentListRow(
                    id=ent.id_entitelrm,
                    ark=ark,
                    label=_title_of(ent) or ent.id_entitelrm,
                    type_norm=_normalize_type(ent.type_entite),
                )
            )
        unclustered.sort(key=lambda r: _sort_key(r.label or r.id))
        return WorkspaceAgentsResponse(clusters=clusters, unclustered_agents=unclustered)

    # Public API ---------------------------------------------------------
    def workspace_works_payload(self) -> WorkspaceWorksResponse:
        clusters = self.build_work_clusters()
        return WorkspaceWorksResponse(clusters=clusters, unclustered_works=self.build_unclustered_work_rows(clusters))

    def cluster_for_anchor(self, anchor_id_or_ark: str) -> Optional[WorkCluster]:
        clusters = self.build_work_clusters()
        if not anchor_id_or_ark:
            return None

        # Accept raw, URL-encoded, and loosely formatted ARKs ("ark:123" → "ark:/123").
        needles = {anchor_id_or_ark.strip()}
        from urllib.parse import unquote

        decoded = unquote(anchor_id_or_ark)
        needles.add(decoded.strip())
        if decoded.startswith("ark:") and not decoded.startswith("ark:/"):
            needles.add("ark:/" + decoded[len("ark:"):].lstrip("/"))

        for cluster in clusters:
            if cluster.anchor_id in needles or (cluster.anchor_ark and cluster.anchor_ark in needles):
                return cluster
            # Allow requests keyed by any clustered work (not only anchors).
            for item in cluster.items:
                if item.id and item.id in needles:
                    return cluster
                if item.ark and item.ark in needles:
                    return cluster
        return None

    def record_payload_for_key(self, record_key: str) -> Optional[RecordPayload]:
        trimmed = record_key.strip()
        entity = self.entity_by_id.get(trimmed)
        if not entity and trimmed in self.entity_by_ark:
            entity = self.entity_by_ark.get(trimmed)
        if not entity:
            return None
        return RecordPayload(
            id=entity.id_entitelrm,
            type=entity.type_entite,
            ark=entity.ark(),
            intermarc=entity.intermarc_raw,
        )
