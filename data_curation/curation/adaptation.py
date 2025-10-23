from __future__ import annotations

import logging
from collections import deque
from dataclasses import dataclass
from typing import Any, List, Sequence

from data_curation.matching.triggers import (
    RESP_TERMS_ADAPT_AGENT_SUBTREE,
    RESP_TERMS_ADAPT_HEAD_SUBTREE,
    RESP_TERMS_ILL,
)
from data_curation.utils.title_cleaner import match_variants_in_title
from data_curation.utils.text_norm import normalize_for_match


LOGGER = logging.getLogger(__name__)

ILLUSTRATION_TRIGGER_VARIANTS = tuple(sorted(RESP_TERMS_ILL))
ADAPTATION_TRIGGER_AGENT_NORMALIZED = {
    normalize_for_match(term) for term in RESP_TERMS_ADAPT_AGENT_SUBTREE
}
ADAPTATION_TRIGGER_HEAD_NORMALIZED = {
    normalize_for_match(term) for term in RESP_TERMS_ADAPT_HEAD_SUBTREE
}
MAX_DEP_DISTANCE = 4
ADAPTATION_CATEGORY_AGENT_SUBTREE = "agent_subtree"
ADAPTATION_CATEGORY_HEAD_SUBTREE = "head_subtree"
MAX_TRIGGER_TOKENS = 3


@dataclass(frozen=True)
class AdaptationTriggerMatch:
    span: Any
    category: str
    normalized: str


def build_trigger_spans(doc, title: str, triggers: Sequence[str]) -> List[Any]:
    spans: List[Any] = []
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


def _build_agent_spans(title: str, doc, agent_variants: Sequence[str]) -> List[Any]:
    spans: List[Any] = []
    for start, end in match_variants_in_title(title, agent_variants):
        span = doc.char_span(start, end, alignment_mode="expand")
        if span is None:
            LOGGER.debug(
                "Failed to align agent variant in '%s' (%s:%s)",
                title,
                start,
                end,
            )
            continue
        spans.append(span)
    return spans


def build_adaptation_triggers(doc, title: str) -> List[AdaptationTriggerMatch]:
    matches: List[AdaptationTriggerMatch] = []
    _ = title  # title retained for API consistency
    i = 0
    while i < len(doc):
        token = doc[i]
        if token.is_space:
            i += 1
            continue

        if not normalize_for_match(token.text):
            i += 1
            continue

        best_match: AdaptationTriggerMatch | None = None
        max_end = min(len(doc), i + MAX_TRIGGER_TOKENS)

        for end in range(i + 1, max_end + 1):
            span = doc[i:end]
            normalized = normalize_for_match(span.text)
            if not normalized:
                continue
            if normalized in ADAPTATION_TRIGGER_AGENT_NORMALIZED:
                candidate = AdaptationTriggerMatch(
                    span=span,
                    category=ADAPTATION_CATEGORY_AGENT_SUBTREE,
                    normalized=normalized,
                )
            elif normalized in ADAPTATION_TRIGGER_HEAD_NORMALIZED:
                candidate = AdaptationTriggerMatch(
                    span=span,
                    category=ADAPTATION_CATEGORY_HEAD_SUBTREE,
                    normalized=normalized,
                )
            else:
                continue

            if best_match is None or (span.end - span.start) < (best_match.span.end - best_match.span.start):
                best_match = candidate

        if best_match:
            matches.append(best_match)
            i = best_match.span.end
        else:
            i += 1
    return matches


def agent_linked_to_illustration(title: str, doc, trigger_spans: Sequence[Any], agent_variants: Sequence[str]) -> bool:
    if not trigger_spans or not agent_variants:
        return False

    agent_spans = _build_agent_spans(title, doc, agent_variants)
    if not agent_spans:
        return False

    for trigger_span in trigger_spans:
        for agent_span in agent_spans:
            if agent_span.sent != trigger_span.sent:
                continue
            distance = _dependency_distance(agent_span.root, trigger_span.root)
            if distance is not None and distance <= MAX_DEP_DISTANCE:
                LOGGER.debug(
                    "Detected illustration link between '%s' and agent span '%s'",
                    trigger_span.text,
                    agent_span.text,
                )
                return True
    return False


def agent_linked_to_adaptation(
    title: str,
    doc,
    triggers: Sequence[AdaptationTriggerMatch],
    agent_variants: Sequence[str],
) -> bool:
    if not triggers or not agent_variants:
        return False

    agent_spans = _build_agent_spans(title, doc, agent_variants)
    if not agent_spans:
        return False

    for trigger in triggers:
        trigger_span = trigger.span
        trigger_sentence = trigger_span.sent
        for agent_span in agent_spans:
            if agent_span.sent != trigger_sentence:
                continue
            agent_token_ids = {token.i for token in agent_span}
            if trigger.category == ADAPTATION_CATEGORY_AGENT_SUBTREE:
                subtree_token_ids = {token.i for token in trigger_span.root.subtree}
                if agent_token_ids & subtree_token_ids:
                    LOGGER.debug(
                        "Adaptation trigger '%s' linked to agent span '%s' via subtree",
                        trigger_span.text,
                        agent_span.text,
                    )
                    return True
            elif trigger.category == ADAPTATION_CATEGORY_HEAD_SUBTREE:
                head = trigger_span.root.head
                if head is None:
                    continue
                if head.i in agent_token_ids:
                    LOGGER.debug(
                        "Adaptation trigger '%s' directly attached to agent head '%s'",
                        trigger_span.text,
                        head.text,
                    )
                    return True
                head_subtree_ids = {token.i for token in head.subtree}
                if agent_token_ids & head_subtree_ids:
                    LOGGER.debug(
                        "Adaptation trigger '%s' linked via head subtree '%s' to agent span '%s'",
                        trigger_span.text,
                        head.text,
                        agent_span.text,
                    )
                    return True
    return False


__all__ = [
    "AdaptationTriggerMatch",
    "ILLUSTRATION_TRIGGER_VARIANTS",
    "agent_linked_to_adaptation",
    "agent_linked_to_illustration",
    "build_adaptation_triggers",
    "build_trigger_spans",
]
