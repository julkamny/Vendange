#!/usr/bin/env python3
"""
Named-graphs only (no default graph):
  - Count matching ?entity vf:hasField ?field quads where the same named graph
    has ?field vf:fieldCode ?code in CODES.
  - Sum all quads with matched fields as SUBJECT (same named graph).
  - Count subfield blank nodes attached via vf:hasSubfield (same named graph).
  - Sum all quads with those matched subfields as SUBJECT (same named graph).

No deduping of fields (per user request).
Print progress every N matched fields.

Requires: pyoxigraph >= 0.5
    pip install pyoxigraph

Usage:

python data_curation/graph_exploration/count_named_only.py \
  --store data_curation/api/datasets/current-exportcsv \
  --codes 90F 990 907 90H 901 991 \
  --progress-every 1000 \
  --per-code
"""

from __future__ import annotations
import argparse
import sys
from collections import Counter
from typing import Iterable, Set

from pyoxigraph import (
    Store,
    NamedNode,
    DefaultGraph,
    BlankNode,
    Literal,
    Quad,
)

VF = "https://vendange.bnf.fr/"
HAS_FIELD = NamedNode(VF + "hasField")
FIELD_CODE = NamedNode(VF + "fieldCode")
HAS_SUBFIELD = NamedNode(VF + "hasSubfield")

DEFAULT_CODES = ["90F", "990", "907", "90H", "901", "991"]


def iter_all_hasfield_any_graph(store: Store) -> Iterable[Quad]:
    """Iterate all quads ?s vf:hasField ?field across ALL graphs."""
    # graph=None means any graph (default + named). We'll filter out default.
    return store.quads_for_pattern(None, HAS_FIELD, None, None)


def field_code_in_named(store: Store, field: BlankNode, graph_name) -> str | None:
    """
    Return code if (field, vf:fieldCode, ?code) exists in the SAME named graph
    and code ∈ code_set; else None.
    """
    for q in store.quads_for_pattern(field, FIELD_CODE, None, graph_name):
        o = q.object
        if isinstance(o, Literal):
            return o.value  # caller checks membership
    return None


def count_subject_quads_in_graph(store: Store, subj, graph_name) -> int:
    """Count quads where subj is subject in the given named graph."""
    return sum(1 for _ in store.quads_for_pattern(subj, None, None, graph_name))


def iter_subfields_in_graph(store: Store, field: BlankNode, graph_name) -> Iterable[BlankNode]:
    """Yield subfield blank nodes via vf:hasSubfield in the given named graph."""
    for q in store.quads_for_pattern(field, HAS_SUBFIELD, None, graph_name):
        if isinstance(q.object, BlankNode):
            yield q.object


def main() -> None:
    ap = argparse.ArgumentParser(description="Count field-attributable quads in named graphs (no default).")
    ap.add_argument("--store", required=True, help="Path to Oxigraph store directory (same as --location for oxigraph-cli).")
    ap.add_argument("--codes", nargs="+", default=DEFAULT_CODES, help="Field codes to include (default: %(default)s).")
    ap.add_argument("--progress-every", type=int, default=1000, help="Print progress every N matched fields (default: %(default)s).")
    ap.add_argument("--per-code", action="store_true", help="Also print a per-code breakdown at the end.")
    args = ap.parse_args()

    store = Store.read_only(args.store)
    code_set = set(args.codes)

    matching_hasField_quads = 0
    field_subject_quads_total = 0
    subfield_blank_nodes_total = 0
    subfield_subject_quads_total = 0

    per_code_link_quads = Counter()
    per_code_field_subject_quads = Counter()
    per_code_subfield_nodes = Counter()
    per_code_subfield_subject_quads = Counter()

    for q in iter_all_hasfield_any_graph(store):
        # Get graph attribute compatibly across pyoxigraph versions
        g = getattr(q, "graph", None)
        if g is None:
            g = getattr(q, "graph_name", None)
        # If the quad has no graph information, skip it
        if g is None:
            continue
        # Only named graphs; skip default
        if isinstance(g, DefaultGraph):
            continue

        field = q.object
        if not isinstance(field, BlankNode):
            continue

        # Check code in the SAME named graph
        code = field_code_in_named(store, field, g)
        if code is None or code not in code_set:
            continue

        # One matched hasField link in a named graph
        matching_hasField_quads += 1
        if args.per_code:
            per_code_link_quads[code] += 1

        # All quads where FIELD is the subject (same named graph)
        field_subject_quads = count_subject_quads_in_graph(store, field, g)
        field_subject_quads_total += field_subject_quads
        if args.per_code:
            per_code_field_subject_quads[code] += field_subject_quads

        # Subfields + their subject quads (same named graph)
        subfields_this_field = 0
        subfield_subject_quads_this_field = 0
        for s in iter_subfields_in_graph(store, field, g):
            subfields_this_field += 1
            subfield_subject_quads_this_field += count_subject_quads_in_graph(store, s, g)

        subfield_blank_nodes_total += subfields_this_field
        subfield_subject_quads_total += subfield_subject_quads_this_field

        if args.per_code:
            per_code_subfield_nodes[code] += subfields_this_field
            per_code_subfield_subject_quads[code] += subfield_subject_quads_this_field

        # Progress
        if args.progress_every > 0 and matching_hasField_quads % args.progress_every == 0:
            print(
                f"[progress] matched_fields={matching_hasField_quads} "
                f"field_subject_quads={field_subject_quads_total} "
                f"subfield_blank_nodes={subfield_blank_nodes_total} "
                f"subfield_subject_quads={subfield_subject_quads_total}",
                file=sys.stderr,
                flush=True,
            )

    # Final summary
    print("RESULTS (named graphs only)")
    print(f"matching_hasField_quads\t{matching_hasField_quads}")
    print(f"field_subject_quads\t{field_subject_quads_total}")
    print(f"subfield_blank_nodes\t{subfield_blank_nodes_total}")
    print(f"subfield_subject_quads\t{subfield_subject_quads_total}")

    if args.per_code:
        print("\nPER-CODE BREAKDOWN (named graphs)")
        print("code\tlink_quads\tfield_subject_quads\tsubfield_blank_nodes\tsubfield_subject_quads")
        for code in sorted(code_set):
            print(
                f"{code}\t"
                f"{per_code_link_quads[code]}\t"
                f"{per_code_field_subject_quads[code]}\t"
                f"{per_code_subfield_nodes[code]}\t"
                f"{per_code_subfield_subject_quads[code]}"
            )


if __name__ == "__main__":
    main()