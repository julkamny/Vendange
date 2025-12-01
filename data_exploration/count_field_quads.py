#!/usr/bin/env python3
"""
Named-graphs only (no default graph):
  - Count matching ?entity vf:hasField ?field quads where the same named graph
    has ?field vf:fieldCode ?code ∈ --fieldCodes.
  - Sum all quads with matched fields as SUBJECT (same named graph).
  - Count subfield blank nodes attached via vf:hasSubfield (same named graph).
  - If --subfieldCodes provided, only count those subfields (per matching field);
    otherwise, count *all* subfields.
  - Sum all quads with those matched subfields as SUBJECT (same named graph).
  - If --print-subfield-value <FIELD+SUBFIELD> provided (e.g. 90Fsa),
    print the OBJECT(s) of quads with (subject == that subfield blank node,
    predicate == vf:subfieldValue) for every occurrence found.

No deduping of fields (per user request).
Print progress every N matched fields.

Requires: pyoxigraph >= 0.5
    pip install pyoxigraph

Example:
python data_exploration/count_field_quads.py \
  --store data_curation/api/datasets/current-exportcsv \
  --fieldCodes 90F 990 907 90H 901 991 \
  --subfieldCodes 90Fsa 907sb 90hz \
  --progress-every 1000 \
  --per-code \
  --print-subfield-value 90Fsa
"""
from __future__ import annotations

import argparse
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Iterable, Optional

try:
    # pyoxigraph >= 0.5
    from pyoxigraph import Store, Quad, NamedNode, BlankNode, Literal
except Exception:  # pragma: no cover
    print("This script requires 'pyoxigraph' (>=0.5). Run `pip install pyoxigraph`.", file=sys.stderr)
    raise

# --- Vocabulary (BNF Vendange) ---
VF = "https://vendange.bnf.fr/"
HAS_FIELD = NamedNode(VF + "hasField")
HAS_SUBFIELD = NamedNode(VF + "hasSubfield")

FIELD_CODE = NamedNode(VF + "fieldCode")
FIELD_COMPACT_VALUE = NamedNode(VF + "fieldCompactValue")

SUBFIELD_CODE = NamedNode(VF + "subfieldCode")
SUBFIELD_VALUE = NamedNode(VF + "subfieldValue")


# --- Helpers ---

def open_store(path: str) -> Store:
    """Open an Oxigraph Store from a RocksDB directory."""
    try:
        return Store.open(path)
    except Exception as e:
        print(f"Failed to open store at '{path}': {e}", file=sys.stderr)
        raise


def iter_quads(store: Store, s=None, p=None, o=None, g=None) -> Iterable[Quad]:
    """Thin wrapper to keep types quiet and be explicit."""
    return store.quads_for_pattern(s, p, o, g)


def field_code_in_named(store: Store, field: BlankNode, graph_name) -> Optional[str]:
    """Return the field code literal value for (field vf:fieldCode ?code) in the SAME named graph, else None."""
    for q in iter_quads(store, field, FIELD_CODE, None, graph_name):
        o = q.object
        if isinstance(o, Literal):
            return o.value
    return None


def subfield_code_in_named(store: Store, subfield: BlankNode, graph_name) -> Optional[str]:
    """Return the subfield code literal value for (subfield vf:subfieldCode ?code) in the SAME named graph, else None."""
    for q in iter_quads(store, subfield, SUBFIELD_CODE, None, graph_name):
        o = q.object
        if isinstance(o, Literal):
            return o.value
    return None


def count_subject_quads_in_graph(store: Store, subj, graph_name) -> int:
    """Count quads where subj is the subject in the given named graph."""
    return sum(1 for _ in iter_quads(store, subj, None, None, graph_name))


def parse_subfield_tokens(tokens):
    """
    Parse tokens like ["90Fsa", "907sb", "90hz"] into a mapping:
        {"90F": {"sa"}, "907": {"sb"}, "90H": {"z"}}
    Assumes field code is ALWAYS the first 3 characters. Field code is upcased.
    Subfield code is whatever remains (case-preserved). Invalid tokens are ignored.
    """
    mapping = defaultdict(set)
    if not tokens:
        return mapping
    for t in tokens:
        if not isinstance(t, str):
            continue
        t = t.strip()
        if len(t) < 4:
            # Need 3 chars for field + >=1 char for subfield
            continue
        field = t[:3].upper()
        sub = t[3:]
        if not sub:
            continue
        mapping[field].add(sub)
    return mapping


def repr_node(n) -> str:
    """Pretty print a node for tabular output (literals as lexical; others via str())."""
    if isinstance(n, Literal):
        return n.value
    return str(n)


@dataclass
class Totals:
    link_quads: int = 0
    field_subject_quads: int = 0
    subfield_blank_nodes: int = 0
    subfield_subject_quads: int = 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Count field and subfield quads in named graphs (pyoxigraph)")
    parser.add_argument("--store", required=True, help="Path to an Oxigraph RocksDB store directory")
    parser.add_argument("--fieldCodes", nargs="+", required=True, help="Space-separated list of field codes to include (e.g. 90F 990 907 90H)")
    parser.add_argument("--subfieldCodes", nargs="*", default=None, help="Optional list like 90Fsa 907sb 90hz. If omitted, ALL subfields are counted.")
    parser.add_argument("--progress-every", type=int, default=0, help="Print progress every N matched fields (0 to disable)")
    parser.add_argument("--per-code", action="store_true", help="Print per-field-code breakdown")
    parser.add_argument("--print-subfield-value", dest="print_subfield_value", default=None,
                        help="Composite subfield token (e.g., 90Fsa). Prints objects of (subfield, vf:subfieldValue, ?o) for all matches")

    args = parser.parse_args()

    # Required field codes
    code_set = {c.upper() for c in args.fieldCodes}
    subfield_filter = parse_subfield_tokens(args.subfieldCodes) if args.subfieldCodes else {}
    wants_subfield_value = args.print_subfield_value is not None
    target_field_for_value = None
    target_sub_for_value = None
    if wants_subfield_value:
        parsed = parse_subfield_tokens([args.print_subfield_value])
        if parsed:
            target_field_for_value, subs = next(iter(parsed.items()))
            target_sub_for_value = next(iter(subs))
        else:
            print(f"WARNING: couldn't parse --print-subfield-value '{args.print_subfield_value}'. Expect e.g. 90Fsa", file=sys.stderr)

    store = Store.read_only(args.store)

    totals = Totals()
    per_code_link_quads = Counter()             # code -> int
    per_code_field_subject_quads = Counter()    # code -> int
    per_code_subfield_nodes = Counter()         # code -> int
    per_code_subfield_subject_quads = Counter() # code -> int

    printed_values = []  # collected (graph, entity, field_code, sub_code, value) for --print-subfield-value
    matched_fields = 0

    # Iterate all hasField links in any named graph
    for link in iter_quads(store, None, HAS_FIELD, None, None):
        entity = link.subject
        field = link.object
        graph_name = link.graph_name

        # Ignore default graph (we only work on named graphs)
        if graph_name is None:
            continue

        # Check field code within SAME graph
        code = field_code_in_named(store, field, graph_name)
        if code is None:
            continue
        code_up = code.upper()
        if code_up not in code_set:
            continue

        # We have a matched field occurrence
        matched_fields += 1
        totals.link_quads += 1
        per_code_link_quads[code_up] += 1

        # Count quads where the field blank node is subject (same graph)
        fq_count = count_subject_quads_in_graph(store, field, graph_name)
        totals.field_subject_quads += fq_count
        per_code_field_subject_quads[code_up] += fq_count

        # Iterate subfields of this field (same graph)
        for sf_link in iter_quads(store, field, HAS_SUBFIELD, None, graph_name):
            subf = sf_link.object
            # Subfield code in same graph
            sub_code = subfield_code_in_named(store, subf, graph_name)
            if sub_code is None:
                continue

            # Filter logic:
            # - If user specified --subfieldCodes: only count subfields that match the (field, sub_code)
            # - Else: count ALL subfields
            if subfield_filter:
                allowed = subfield_filter.get(code_up)
                if not allowed or not any(sub_code.endswith(allowed_sub_code) for allowed_sub_code in allowed):
                    continue  # not requested for this field

            # Count this subfield node
            totals.subfield_blank_nodes += 1
            per_code_subfield_nodes[code_up] += 1

            # Count quads where the subfield blank node is subject (same graph)
            sfq_count = count_subject_quads_in_graph(store, subf, graph_name)
            totals.subfield_subject_quads += sfq_count
            per_code_subfield_subject_quads[code_up] += sfq_count

            # Optional: collect subfield values for a specific requested subfield
            if wants_subfield_value and code_up == target_field_for_value and sub_code.endswith(target_sub_for_value):
                for val_q in iter_quads(store, subf, SUBFIELD_VALUE, None, graph_name):
                    obj = val_q.object
                    printed_values.append((
                        repr_node(graph_name),
                        repr_node(entity),
                        code_up,
                        sub_code,
                        repr_node(obj),
                    ))

        # Progress
        if args.progress_every and matched_fields % args.progress_every == 0:
            print(f".. matched fields: {matched_fields}", file=sys.stderr)

    # --- Output ---
    print("TOTALS (named graphs)")
    print("link_quads\tfield_subject_quads\tsubfield_blank_nodes\tsubfield_subject_quads")
    print(f"{totals.link_quads}\t{totals.field_subject_quads}\t{totals.subfield_blank_nodes}\t{totals.subfield_subject_quads}")

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

    if wants_subfield_value:
        token = args.print_subfield_value
        print(f"\nSUBFIELD VALUES for {token} (subject=subfield, predicate=vf:subfieldValue)")
        if not printed_values:
            print("<none>")
        else:
            print("graph\tentity\tfield_code\tsubfield_code\tvalue")
            for g, ent, fc, sc, val in printed_values:
                print(f"{g}\t{ent}\t{fc}\t{sc}\t{val}")


if __name__ == "__main__":
    main()
