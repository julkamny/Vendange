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
    BacklinkItem,
    BacklinksPayload,
    TitleSegment,
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
from data_curation.curation.backlinks import build_backlink_index, normalize_ark_value
from data_curation.curation.ark_labels import build_ark_label_map
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
    if norm in {"personne", "identité publique de personne", "identite publique de personne"}:
        return "personne"
    if norm in {"collectivite", "collectivité", "collective"}:
        return "collectivite"
    if "famille" in norm:
        return "famille"
    return norm or value


def _agent_zone_code(norm_type: str) -> Optional[str]:
    if norm_type == "personne":
        return "100"
    if norm_type == "collectivite":
        return "110"
    if norm_type == "famille":
        return "120"
    return None


def _agent_title_segments(entity: Entity) -> List[TitleSegment]:
    norm = _normalize_type(entity.type_entite)
    zone_code = _agent_zone_code(norm)
    if not zone_code:
        return []
    zones = entity.intermarc.get_zone(zone_code)
    if not zones:
        return []
    zone = zones[0]
    allowed = {f"{zone_code}$a", f"{zone_code}$m", f"{zone_code}$e"}
    segments: List[TitleSegment] = []
    for sub in zone.sousZones:
        if sub.code not in allowed or not isinstance(sub.valeur, str):
            continue
        value = sub.valeur.strip()
        if not value:
            continue
        segments.append(
            TitleSegment(
                code=sub.code,
                label=_segment_label(sub.code),
                value=_strip_pipes(value),
            )
        )
    return segments


def _agent_primary_label(entity: Entity) -> str:
    segments = _agent_title_segments(entity)
    if segments:
        return " ".join(seg.value for seg in segments if seg.value)
    return _title_of(entity) or entity.id_entitelrm


def _agent_sort_value(entity: Entity) -> str:
    norm = _normalize_type(entity.type_entite)
    zone_code = _agent_zone_code(norm)
    if zone_code:
        for zone in entity.intermarc.get_zone(zone_code):
            for sub in zone.sousZones:
                if sub.code == f"{zone_code}$a" and isinstance(sub.valeur, str) and sub.valeur.strip():
                    return _strip_pipes(sub.valeur)
    return _agent_primary_label(entity)


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


def _cluster_targets(entity: Entity) -> List[Tuple[str, Optional[str], str]]:
    targets: List[Tuple[str, Optional[str], str]] = []
    for zone in entity.intermarc.get_zone("90F"):
        note = next((sub.valeur for sub in zone.sousZones if sub.code == "90F$q"), None)
        origin = "manual" if note == CLUSTER_MANUAL_NOTE else "script" if note == CLUSTER_SCRIPT_NOTE else None
        if not origin:
            continue
        target_val = next((sub.valeur for sub in zone.sousZones if sub.code == "90F$3"), None)
        target = str(target_val).strip() if target_val else ""
        if not target:
            continue
        date = next((sub.valeur for sub in zone.sousZones if sub.code == "90F$d"), None)
        targets.append((target, date, origin))
    return targets


def _expression_cluster_targets(expr: Entity) -> List[Tuple[str, Optional[str], str]]:
    return _cluster_targets(expr)


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


def _strip_pipes(value: str) -> str:
    return value.replace("|", "")


def _segment_label(sub_code: str) -> str:
    if "$" in sub_code:
        suffix = sub_code.split("$", 1)[1]
        return suffix.upper() or sub_code
    return sub_code.upper()


def _work_title_segments(entity: Entity, lookup_by_ark: Dict[str, Entity]) -> List[Dict[str, str]]:
    segments: List[Dict[str, str]] = []
    zone = entity.intermarc.get_zone("150")
    if not zone:
        return segments
    labels = build_ark_label_map(entity, lookup_by_ark)
    for sub in zone[0].sousZones:
        raw_value = str(sub.valeur or "").strip()
        if not raw_value:
            continue
        value = labels.get(raw_value) if raw_value.lower().startswith("ark:/") else raw_value
        segment: Dict[str, str] = {
            "code": sub.code,
            "label": _segment_label(sub.code),
            "value": value or raw_value,
        }
        if raw_value.lower().startswith("ark:/"):
            segment["ark"] = raw_value
        segments.append(segment)
    return segments


def _work_title_a_value(entity: Optional[Entity]) -> str:
    if not entity:
        return ""
    for zone in entity.intermarc.get_zone("150"):
        for sub in zone.sousZones:
            if sub.code == "150$a" and isinstance(sub.valeur, str):
                return _strip_pipes(sub.valeur).strip()
    return ""


class WorkspaceViewBuilder:
    def __init__(self, entities: Sequence[Entity]):
        self.entities = list(entities)
        self.entity_by_id: Dict[str, Entity] = {e.id_entitelrm: e for e in entities}
        self.entity_by_ark: Dict[str, Entity] = {ark: e for e in entities if (ark := e.ark())}
        self.type_by_id: Dict[str, str] = {e.id_entitelrm: _normalize_type(e.type_entite) for e in entities}

        self.clustered_agent_arks: Set[str] = set()

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
        self.backlink_index: Dict[str, Dict[str, Set[str]]] = {}

        self._build_indices()
        self._rebuild_backlink_index()

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

        self._rebuild_backlink_index()

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
            # Remove previous clustered targets tied to this anchor so a reindex
            # can rebuild the set accurately.
            for zone in entity.intermarc.get_zone("90F"):
                note = next((sub.valeur for sub in zone.sousZones if sub.code == "90F$q"), None)
                if note not in {CLUSTER_MANUAL_NOTE, CLUSTER_SCRIPT_NOTE}:
                    continue
                target = next((sub.valeur for sub in zone.sousZones if sub.code == "90F$3"), None)
                if target:
                    self.clustered_work_arks.discard(str(target))

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

        if norm in {"personne", "collectivite", "famille"}:
            for target in _cluster_targets(entity):
                self.clustered_agent_arks.discard(target[0])

    def _index_entity(self, entity: Entity) -> None:
        entity_id = entity.id_entitelrm
        entity_ark = entity.ark()
        norm = _normalize_type(entity.type_entite)

        self.entity_by_id[entity_id] = entity
        self.type_by_id[entity_id] = norm
        if entity_ark:
            self.entity_by_ark[entity_ark] = entity

        if norm in {"personne", "collectivite", "famille"}:
            for target, _, _ in _cluster_targets(entity):
                self.clustered_agent_arks.add(str(target))

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
            if norm in {"personne", "collectivite", "famille"}:
                for target, _, _ in _cluster_targets(ent):
                    self.clustered_agent_arks.add(str(target))
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

    def _rebuild_backlink_index(self) -> None:
        self.backlink_index = build_backlink_index(self.entities)

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
    def _build_work_cluster(self, work: Entity, *, include_empty: bool = False) -> Optional[WorkCluster]:
        work_ark = work.ark() or ""
        anchor_segments = _work_title_segments(work, self.entity_by_ark)
        anchor_title = " ".join(seg["value"] for seg in anchor_segments) or _title_of(work) or work.id_entitelrm
        cluster_items: List[WorkClusterItem] = []
        seen_targets: Set[str] = set()
        for zone in work.intermarc.get_zone("90F"):
            note = next((sub.valeur for sub in zone.sousZones if sub.code == "90F$q"), None)
            origin = "manual" if note == CLUSTER_MANUAL_NOTE else "script" if note == CLUSTER_SCRIPT_NOTE else None
            if not origin:
                continue
            target = (
                next((sub.valeur for sub in zone.sousZones if sub.code == "90F$3"), None)
            )
            if not target or target in seen_targets:
                continue
            seen_targets.add(target)
            date = next((sub.valeur for sub in zone.sousZones if sub.code == "90F$d"), None)
            target_ent = self.entity_by_ark.get(str(target))
            summary = self._summary_for_ark(str(target), counts=self.work_counts.get(str(target), CountStats()))
            segments = _work_title_segments(target_ent, self.entity_by_ark) if target_ent else []
            item_title = " ".join(seg["value"] for seg in segments) if segments else (_title_of(target_ent) if target_ent else str(target))
            cluster_items.append(
                WorkClusterItem(
                    ark=str(target),
                    id=target_ent.id_entitelrm if target_ent else None,
                    title=item_title,
                    title_segments=segments,
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
        if not include_empty and not cluster_items and not has_expression_cluster:
            return None

        anchor_counts = self.work_counts.get(work_ark, CountStats())
        anchor_summary = self._summary_for_ark(work_ark, counts=anchor_counts)
        return WorkCluster(
            anchor_id=work.id_entitelrm,
            anchor_ark=work_ark or None,
            anchor_title=anchor_title,
            anchor_title_segments=anchor_segments,
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
        clusters.sort(
            key=lambda c: _sort_key(
                _strip_pipes(_work_title_a_value(self.entity_by_id.get(c.anchor_id))) or c.anchor_title or c.anchor_id
            )
        )
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
            segments = _work_title_segments(ent, self.entity_by_ark)
            title_value = " ".join(seg["value"] for seg in segments) if segments else _title_of(ent)
            row = WorkListRow(
                id=ent.id_entitelrm,
                ark=ark,
                title=title_value or ent.id_entitelrm,
                title_segments=segments,
                type_norm="oeuvre",
                summary=self._summary_for_ark(ark, counts=counts),
            )
            rows.append(row)
        rows.sort(
            key=lambda r: _sort_key(
                _strip_pipes(_work_title_a_value(self.entity_by_id.get(r.id))) or r.title or r.id
            )
        )
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
        clusters: List[AgentCluster] = []
        coverage_arks: Set[str] = set()
        coverage_ids: Set[str] = set()

        for agent in agents:
            cluster = self._build_agent_cluster(agent)
            if not cluster:
                continue
            clusters.append(cluster)
            if cluster.anchor_ark:
                coverage_arks.add(cluster.anchor_ark)
            coverage_ids.add(cluster.anchor_id)
            for item in cluster.items:
                coverage_arks.add(item.ark)
                if item.id:
                    coverage_ids.add(item.id)

        unclustered: List[AgentListRow] = []
        for ent in agents:
            ark = ent.ark()
            if ent.id_entitelrm in coverage_ids:
                continue
            if ark and ark in coverage_arks:
                continue
            sort_val = _agent_sort_value(ent)
            segments = _agent_title_segments(ent)
            unclustered.append(
                AgentListRow(
                    id=ent.id_entitelrm,
                    ark=ark,
                    label=_agent_primary_label(ent),
                    type_norm=_normalize_type(ent.type_entite),
                    title_segments=segments,
                    sort_key=_sort_key(sort_val),
                )
            )

        clusters.sort(key=lambda c: c.sort_key or _sort_key(c.anchor_label or c.anchor_id))
        unclustered.sort(key=lambda r: r.sort_key or _sort_key(r.label or r.id))
        return WorkspaceAgentsResponse(clusters=clusters, unclustered_agents=unclustered)

    def _build_agent_cluster(self, agent: Entity) -> Optional[AgentCluster]:
        norm = _normalize_type(agent.type_entite)
        if norm not in {"personne", "collectivite", "famille"}:
            return None

        anchor_ark = agent.ark()
        anchor_segments = _agent_title_segments(agent)
        anchor_sort_key = _sort_key(_agent_sort_value(agent))
        targets = _cluster_targets(agent)
        seen: Set[str] = set()
        items: List[AgentClusterItem] = []
        for target, date, origin in targets:
            if target in seen:
                continue
            seen.add(target)
            target_ent = self.entity_by_ark.get(target)
            if target_ent and _normalize_type(target_ent.type_entite) not in {"personne", "collectivite", "famille"}:
                continue
            target_segments = _agent_title_segments(target_ent) if target_ent else []
            items.append(
                AgentClusterItem(
                    ark=target,
                    id=target_ent.id_entitelrm if target_ent else None,
                    label=_agent_primary_label(target_ent) if target_ent else target,
                    origin=origin,
                    date=date,
                    type_norm=_normalize_type(target_ent.type_entite) if target_ent else None,
                    accepted=True,
                    title_segments=target_segments,
                    sort_key=_sort_key(_agent_sort_value(target_ent)) if target_ent else _sort_key(target),
                )
            )

        items.sort(key=lambda item: item.sort_key or _sort_key(item.label or item.ark))

        if not items:
            return None

        return AgentCluster(
            anchor_id=agent.id_entitelrm,
            anchor_ark=anchor_ark,
            anchor_label=_agent_primary_label(agent),
            anchor_type_norm=norm,
            anchor_title_segments=anchor_segments,
            sort_key=anchor_sort_key,
            items=items,
        )

    # Public API ---------------------------------------------------------
    def workspace_works_payload(self) -> WorkspaceWorksResponse:
        clusters = self.build_work_clusters()
        return WorkspaceWorksResponse(clusters=clusters, unclustered_works=self.build_unclustered_work_rows(clusters))

    def workspace_agents_payload(self) -> WorkspaceAgentsResponse:
        return self.build_agent_views()

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

        # Fallback: return a minimal cluster for independent works (neither anchor nor clustered).
        candidate = self.entity_by_id.get(anchor_id_or_ark) or self.entity_by_ark.get(anchor_id_or_ark)
        if candidate and _normalize_type(candidate.type_entite) == "oeuvre":
            return self._build_work_cluster(candidate, include_empty=True)
        return None

    def record_payload_for_key(self, record_key: str) -> Optional[RecordPayload]:
        trimmed = record_key.strip()
        entity = self.entity_by_id.get(trimmed)
        if not entity and trimmed in self.entity_by_ark:
            entity = self.entity_by_ark.get(trimmed)
        if not entity:
            return None
        ark_labels = build_ark_label_map(entity, self.entity_by_ark)
        return RecordPayload(
            id=entity.id_entitelrm,
            type=entity.type_entite,
            ark=entity.ark(),
            intermarc=entity.intermarc_raw,
            ark_labels=ark_labels,
        )

    def _backlink_view_for(self, entity: Entity, fields: Set[str]) -> BacklinkItem:
        norm = _normalize_type(entity.type_entite)
        title_segments: List[TitleSegment] = []
        if norm == "oeuvre":
            title_segments = _work_title_segments(entity, self.entity_by_ark)
            title_value = (
                " ".join(seg["value"] for seg in title_segments) or _title_of(entity) or entity.id_entitelrm
            )
        elif norm == "manifestation":
            title_value = _manifestation_title(entity) or entity.id_entitelrm
        else:
            title_value = _title_of(entity) or entity.id_entitelrm

        return BacklinkItem(
            id=entity.id_entitelrm,
            ark=entity.ark(),
            type=entity.type_entite,
            type_norm=norm,
            title=title_value,
            title_segments=title_segments,
            fields=sorted(fields),
        )

    def backlinks_payload_for_key(self, record_key: str) -> Optional[BacklinksPayload]:
        trimmed = (record_key or "").strip()
        if not trimmed:
            return None
        entity = self.entity_by_id.get(trimmed) or self.entity_by_ark.get(trimmed)
        if not entity:
            return None

        target_id = entity.id_entitelrm
        target_ark = entity.ark()
        normalized_target = normalize_ark_value(target_ark) if target_ark else None
        if not normalized_target:
            return BacklinksPayload(target_id=target_id, target_ark=target_ark, backlinks=[])

        sources = self.backlink_index.get(normalized_target, {})
        backlinks: List[BacklinkItem] = []
        for source_id, fields in sources.items():
            if source_id == target_id:
                continue
            source_entity = self.entity_by_id.get(source_id)
            if not source_entity:
                continue
            backlinks.append(self._backlink_view_for(source_entity, fields))

        backlinks.sort(key=lambda item: (item.type_norm or "", item.title or item.id, item.id))
        return BacklinksPayload(target_id=target_id, target_ark=target_ark, backlinks=backlinks)


class AgentViewBuilder:
    """Thin wrapper exposing only the agent workspace payload."""

    def __init__(self, workspace: WorkspaceViewBuilder):
        self.workspace = workspace

    @classmethod
    def from_dataset(cls, dataset_id: str) -> "AgentViewBuilder":
        return cls(WorkspaceViewBuilder.from_dataset(dataset_id))

    @classmethod
    def from_workspace(cls, workspace: WorkspaceViewBuilder) -> "AgentViewBuilder":
        return cls(workspace)

    def workspace_agents_payload(self) -> WorkspaceAgentsResponse:
        return self.workspace.workspace_agents_payload()
