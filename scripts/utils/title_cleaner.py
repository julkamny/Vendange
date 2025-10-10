from __future__ import annotations

import logging
import re
import unicodedata
import os
import tempfile
from functools import lru_cache
from io import StringIO
from pathlib import Path
from typing import Dict, List, Sequence, Tuple, TYPE_CHECKING

import spacy
from spacy import displacy
from spacy.language import Language
from spacy.tokens import Doc, Span, Token
from spacy.symbols import agent, appos, NOUN, nmod, PROPN, VERB

from rich import box
from rich.console import Console, Group
from rich.markdown import Markdown
from rich.panel import Panel
from rich.pretty import Pretty
from rich.syntax import Syntax
from rich.table import Table

from scripts.matching.triggers import RESP_TERMS_ILL
from scripts.utils.text_norm import build_folded_with_map, normalize_for_match

if TYPE_CHECKING:  # pragma: no cover - import only for static type checking
    from scripts.models import Entity


LOGGER = logging.getLogger(__name__)

for noisy in (
    "markdown_it",
    "markdown_it.main",
    "markdown_it.rules_block",
    "markdown_it.rules_inline",
):
    logging.getLogger(noisy).setLevel(logging.WARNING)

# Pre-compute lowercase variants once to simplify matching.
RESP_TERMS_ILL_NORM = {term.lower().strip(".") for term in RESP_TERMS_ILL}
RESP_TERMS_ILL_FOLDED = {
    "".join(ch for ch in unicodedata.normalize("NFKD", term.lower()) if not unicodedata.combining(ch))
    for term in RESP_TERMS_ILL
}

# Token categories we aggressively trim when expanding Gram groups.
LEFT_STRIPPABLE_POS = {"ADP", "DET", "SCONJ", "CCONJ", "PART"}
LEFT_STRIPPABLE_LOWER = {"par", "de", "des", "du", "d", "avec", "et"}
RIGHT_STRIPPABLE_POS = {"ADP", "DET", "SCONJ", "CCONJ", "PART"}
RIGHT_STRIPPABLE_LOWER = {"et", "ou", "avec"}
BOUNDARY_PUNCT = {",", ";", ":", "-", "–", "—", "|"}

DEBUGGER_ENV = "TITLE_MATCH_DEBUGGER"


@lru_cache(maxsize=1)
def get_nlp() -> Language:
    """Return cached spaCy model; loading once avoids the heavy startup cost."""
    model_name = "fr_dep_news_trf"
    LOGGER.debug("Loading spaCy model '%s'", model_name)
    return spacy.load(model_name)

def _render_dependency_graph(doc: Doc, context: str) -> Path | None:
    if not LOGGER.isEnabledFor(logging.DEBUG):
        return None

    html = displacy.render(doc, style="dep", options={"compact": True, "add_lemma": False})
    with tempfile.NamedTemporaryFile("w", delete=False, suffix=".html", encoding="utf-8") as tmp:
        tmp.write("<html><head><meta charset='utf-8'></head><body>")
        tmp.write(f"<h2>{context}</h2>")
        tmp.write(html)
        tmp.write("</body></html>")
        tmp_path = Path(tmp.name).resolve()

    return tmp_path


def _merge_ranges(ranges: List[Tuple[int, int]]) -> List[Tuple[int, int]]:
    if not ranges:
        return []
    ranges.sort()
    merged: List[Tuple[int, int]] = []
    cur_start, cur_end = ranges[0]
    for start, end in ranges[1:]:
        if start <= cur_end:
            cur_end = max(cur_end, end)
        else:
            merged.append((cur_start, cur_end))
            cur_start, cur_end = start, end
    merged.append((cur_start, cur_end))
    return merged


def _span_char_bounds(doc: Doc, start_token: int, end_token: int) -> Tuple[int, int]:
    # Expand left to swallow spaces and punctuation coupled with the phrase.
    while start_token > 0:
        token = doc[start_token - 1]
        if token.is_space:
            start_token -= 1
            continue
        if token.text in BOUNDARY_PUNCT:
            start_token -= 1
            continue
        break

    # Expand right the same way.
    while end_token < len(doc):
        token = doc[end_token]
        if token.is_space:
            end_token += 1
            continue
        if token.text in BOUNDARY_PUNCT:
            LOGGER.debug("Expanding span over boundary punctuation: %s (%s)", token.text, token.pos_)
            end_token += 1
            continue
        break

    span = doc[start_token:end_token]
    return span.start_char, span.end_char


def _expand_hit_span(doc: Doc, span: Span) -> Tuple[int, int]:
    """
    Expand a matched spaCy Span to a broader span covering its syntactic head (when appropriate)
    and the head's subtree, returning character offsets for that expanded region.
    Determining a "start token" for expansion:
        * If span.root.dep == nmod and span.root.head.pos == NOUN, the head noun is chosen.
        E.g. "par Mme la Comtesse de Ségur", hit span "Comtesse de Ségur"
        * Otherwise the span root is chosen.
    """
    
    root = span.root

    def _has_case_adp(tok: Token) -> bool:
        for child in tok.children:
            if child.pos_ == "ADP" and child.dep_ == "case":
                return True
        return False
    
    def _is_agent(tok: Token) -> bool:
        return tok.dep_ == agent and tok.head.pos_ == VERB

    # If the root itself governs a case-marking ADP, prefer the root.
    if _has_case_adp(root):
        # Special case: if the root is an agent attached to a verb, climb to the verb.
        if _is_agent(root):
            start = root.head
        else:
            start = root
    # If the span root is the sentence root (head of itself), keep it.
    elif root == root.head:
        start = root
    elif root.dep in {nmod, appos} and root.head.pos in {NOUN, PROPN}:
        cur = root.head
        start = root  # default fallback
        while True:
            if _has_case_adp(cur):
                start = cur
                break
            # stop if we've reached the sentence root or cannot continue climbing
            if cur.head == cur:
                start = cur
                break
            # stop if we've reached an agent attached to a verb
            if _is_agent(cur):
                start = cur.head
                break
            if not (cur.dep in {nmod, appos} and cur.head.pos in {NOUN, PROPN}):
                start = cur
                break
            cur = cur.head
    else:
        start = root

    tokens = {start.i}
    LOGGER.debug("Expanding hit span '%s' around token '%s'", span.text, start.text)
    
    for token in start.subtree:
        tokens.add(token.i)
    for token in span:
        tokens.add(token.i)

    start_token = min(tokens)
    end_token = max(tokens) + 1
    return _span_char_bounds(doc, start_token, end_token)


def _collect_person_ranges(doc: Doc, spans: Sequence[Tuple[int, int]]) -> List[Tuple[int, int]]:
    ranges: List[Tuple[int, int]] = []
    for start, end in spans:
        if start >= end:
            continue
        spacy_span = doc.char_span(start, end, alignment_mode="expand")
        if spacy_span is None:
            LOGGER.debug("spaCy failed to align span (%s, %s) in title '%s'", start, end, doc.text)
            continue
        ranges.append(_expand_hit_span(doc, spacy_span))
    return ranges


def _token_matches_ill_term(token: Token) -> bool:
    lower = token.text.lower().strip(".")
    if lower in RESP_TERMS_ILL_NORM:
        return True
    lemma = token.lemma_.lower().strip(".")
    return lemma in RESP_TERMS_ILL_NORM


def _collect_illustration_ranges(doc: Doc) -> List[Tuple[int, int]]:
    ranges: List[Tuple[int, int]] = []
    for token in doc:
        if not _token_matches_ill_term(token):
            continue
        start = token.i
        # Attempt to locate the governing preposition ("avec", "par", "de"...).
        for left in token.lefts:
            if left.pos_ in LEFT_STRIPPABLE_POS or left.lower_ in LEFT_STRIPPABLE_LOWER:
                start = min(start, left.i)
        # Grow left-wise across contiguous strippable tokens.
        while start > 0:
            prev = doc[start - 1]
            if prev.is_space or prev.text in BOUNDARY_PUNCT:
                start -= 1
            else:
                break

        end = token.i + 1
        # Continue while tokens belong to the subtree or are responsibility complements.
        frontier = {token.i}
        for child in token.subtree:
            frontier.add(child.i)
            LOGGER.debug("Including illustration subtree token '%s' under '%s'", child.text, token.text)
        for right in token.rights:
            if right.pos_ in RIGHT_STRIPPABLE_POS or right.lower_ in RIGHT_STRIPPABLE_LOWER:
                frontier.add(right.i)
        while end < len(doc) and end in frontier:
            LOGGER.debug(
                "Extending illustration span at token %s (%s)",
                doc[end].text,
                doc[end].dep_,
            )
            frontier.add(end)
            end += 1

        ranges.append(_span_char_bounds(doc, start, end))
    return ranges


def contains_illustration_trigger(title: str) -> bool:
    folded = unicodedata.normalize("NFKD", title.lower())
    folded = "".join(ch for ch in folded if not unicodedata.combining(ch))
    return any(term in folded for term in RESP_TERMS_ILL_FOLDED)


def clean_title_text(
    title: str,
    person_spans: Sequence[Tuple[int, int]] | None = None,
    remove_illustration_groups: bool = True,
) -> str:
    """Return a title stripped of responsibility phrases detected via spaCy."""

    if not title:
        return ""

    should_process = bool(person_spans) or remove_illustration_groups
    if not should_process:
        return title

    model = get_nlp()
    doc = model(title)
    graph_path = _render_dependency_graph(doc, f"Title: {title}")

    ranges: List[Tuple[int, int]] = []
    if person_spans:
        ranges.extend(_collect_person_ranges(doc, person_spans))
    if remove_illustration_groups:
        ranges.extend(_collect_illustration_ranges(doc))

    merged = _merge_ranges(ranges)

    cleaned = title
    removed_chunks: List[str] = []
    if merged:
        cleaned_parts: List[str] = []
        cursor = 0
        for start, end in merged:
            start = max(cursor, start)
            cleaned_parts.append(title[cursor:start])
            removed_chunks.append(title[start:end])
            cursor = max(cursor, end)
        cleaned_parts.append(title[cursor:])

        cleaned = "".join(cleaned_parts)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()

    if LOGGER.isEnabledFor(logging.DEBUG):
        LOGGER.debug(
            "\n%s",
            _render_cleaning_summary(
                original=title,
                cleaned=cleaned,
                removed_chunks=removed_chunks,
                dependency_path=graph_path,
            ),
        )

    return cleaned


def normalize_title_for_clustering(title: str) -> str:
    """Heavily normalize a title so cluster grouping can ignore minute variants."""
    if not title:
        return ""

    title = title.strip()

    # Drop leading article when it immediately precedes a pipe, so
    # "La |Bible" and "|Bible" collapse to the same key.
    drop_pipe_article = re.compile(r"^(un|une|le|la|les)\s*\|\s*(.*)$", re.IGNORECASE)
    match = drop_pipe_article.match(title)
    if match:
        title = match.group(2)

    # Remove pipes altogether before accent stripping.
    title = title.replace("|", " ")

    # Replace any punctuation character with a space to keep word boundaries stable.
    title = "".join(" " if unicodedata.category(ch).startswith("P") else ch for ch in title)

    # Remove accents and lowercase.
    nfkd = unicodedata.normalize("NFKD", title)
    title = "".join(ch for ch in nfkd if not unicodedata.combining(ch))
    title = title.lower()

    # Collapse spaces.
    title = " ".join(title.split())
    return title


def normalize_and_clean_title(
    title: str,
    person_spans: Sequence[Tuple[int, int]] | None = None,
    remove_illustration_groups: bool = True,
) -> str:
    """Convenience helper: clean with spaCy, then apply cluster normalization."""
    cleaned = clean_title_text(title, person_spans=person_spans, remove_illustration_groups=remove_illustration_groups)
    return normalize_title_for_clustering(cleaned)


def _export_rich(content: Panel | Table | Markdown | Syntax | Group | Pretty) -> str:
    buffer = StringIO()
    console = Console(
        file=buffer,
        record=True,
        width=120,
        highlight=True,
        soft_wrap=True,
        force_terminal=True,
    )
    console.print(content)
    rendered = console.export_text(clear=True)
    return rendered


def _render_variant_debug(context: str, title: str, ark2variants: Dict[str, Sequence[str]]) -> str:
    total_variants = sum(len(v) for v in ark2variants.values())
    syntax = Syntax(title, "markdown", theme="monokai", word_wrap=True)

    variant_table = Table(
        title="Variant Inventory",
        header_style="bold magenta",
        show_lines=True,
        box=box.SIMPLE_HEAVY,
    )
    variant_table.add_column("ARK", style="bold cyan", no_wrap=True)
    variant_table.add_column("Variant", style="bold green")
    variant_table.add_column("Normalized", style="white" )

    for ark, variants in ark2variants.items():
        for variant in variants:
            variant_table.add_row(
                f"[cyan]{ark}[/]",
                f"[green]{variant}[/]",
                f"[white]{normalize_for_match(variant)}[/]",
            )

    summary = Markdown(
        f"### 🔎 Matching context: `{context}`\n"
        f"*Variants prepared:* **{total_variants}** across **{len(ark2variants)}** ARKs."
    )

    pretty_map = Panel(
        Pretty(ark2variants, expand_all=True),
        title="Raw variant map",
        border_style="bright_black",
    )

    composite = Panel(
        Group(
            summary,
            Panel(syntax, title="Title under inspection", border_style="cyan"),
            variant_table,
            pretty_map,
        ),
        title="✨ Match Preparation",
        border_style="bright_magenta",
    )
    return _export_rich(composite)


def _render_cleaning_summary(
    *,
    original: str,
    cleaned: str,
    removed_chunks: Sequence[str],
    dependency_path: Path | None,
) -> str:
    original_syntax = Syntax(original or "", "markdown", theme="monokai", word_wrap=True)
    cleaned_syntax = Syntax(cleaned or "", "markdown", theme="monokai", word_wrap=True)

    comparison_panel = Panel(
        Group(
            Markdown("#### Before"),
            original_syntax,
            Markdown("#### After"),
            cleaned_syntax,
        ),
        title="Before → After",
        border_style="cyan",
    )

    if removed_chunks:
        removals_table = Table(
            "#",
            "Removed segment",
            box=box.MINIMAL_DOUBLE_HEAD,
            header_style="bold red",
            show_lines=True,
        )
        for idx, chunk in enumerate(removed_chunks, 1):
            display = chunk.strip() or "␣ (whitespace)"
            removals_table.add_row(str(idx), f"[bold red]{display}[/]")
        removals_panel = Panel(
            removals_table,
            title="Segments removed",
            border_style="red",
        )
    else:
        removals_panel = Panel(
            Markdown("_No segments removed during cleaning._"),
            border_style="green",
        )

    link_lines = []
    if dependency_path:
        link_lines.append(f"- [View dependency graph](file://{dependency_path})")
    link_lines.append(
        f"- Words removed: **{len(removed_chunks)}**"
    )

    footer = Panel(
        Markdown("\n".join(link_lines)),
        border_style="bright_black",
    )

    composite = Panel(
        Group(
            Markdown("### 🍇 Title cleansing report"),
            comparison_panel,
            removals_panel,
            footer,
        ),
        border_style="magenta",
    )

    return _export_rich(composite)


def match_variants_in_title(title: str, variants: Sequence[str]) -> List[Tuple[int, int]]:
    """Return spans in the original title that match any of the provided variants."""

    if not title or not variants:
        return []

    folded_title, pos_map = build_folded_with_map(title)
    spans: List[Tuple[int, int]] = []
    seen: set[Tuple[int, int]] = set()

    for variant in variants:
        normalized_variant = normalize_for_match(variant)
        if not normalized_variant:
            continue

        start = 0
        while True:
            idx = folded_title.find(normalized_variant, start)
            if idx < 0:
                break

            end_idx = idx + len(normalized_variant) - 1
            start_orig = pos_map[idx]
            end_orig = pos_map[min(end_idx, len(pos_map) - 1)] + 1
            span = (start_orig, end_orig)
            if span not in seen:
                seen.add(span)
                spans.append(span)
            start = idx + len(normalized_variant)

    spans.sort()
    return spans


def debug_match_targets(context: str, title: str, ark2variants: Dict[str, Sequence[str]]) -> None:
    """Emit detailed debug info and optional debugger breakpoints for variant matching."""

    if not ark2variants:
        return

    # if LOGGER.isEnabledFor(logging.DEBUG):
        # LOGGER.debug("\n%s", _render_variant_debug(context, title, ark2variants))

    if os.getenv(DEBUGGER_ENV):
        import pdb

        LOGGER.debug("[%s] Entering debugger because %s is set", context, DEBUGGER_ENV)
        pdb.set_trace()


__all__ = [
    "clean_title_text",
    "debug_match_targets",
    "get_nlp",
    "match_variants_in_title",
    "normalize_and_clean_title",
    "normalize_title_for_clustering",
    "contains_illustration_trigger",
]


def extract_responsible_person_arks(ent: "Entity") -> List[str]:
    """Return unique responsibility ARKs referenced by the entity."""

    arks: List[str] = []
    for zone_code in ("700", "701", "702", "710", "711", "712"):
        for zone in ent.intermarc.get_zone(zone_code):
            for subfield in zone.sousZones:
                value = (subfield.valeur or "").strip()
                if not value:
                    continue
                if subfield.code in {f"{zone_code}$3", f"{zone_code}$0"}:
                    if "ark:/12148/" in value:
                        idx = value.find("ark:/12148/")
                        cleaned = value[idx:].split()[0].rstrip(").,;")
                        arks.append(cleaned)
                elif "ark:/12148/" in value:
                    idx = value.find("ark:/12148/")
                    cleaned = value[idx:].split()[0].rstrip(").,;")
                    arks.append(cleaned)

    deduped: List[str] = []
    seen = set()
    for ark in arks:
        if ark not in seen:
            seen.add(ark)
            deduped.append(ark)
    return deduped


__all__.extend(["extract_responsible_person_arks"])
