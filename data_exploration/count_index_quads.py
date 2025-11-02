#!/usr/bin/env python3
"""
Count fieldIndex / subfieldIndex quads in *named* graphs only.

What it does
------------
- Counts quads with predicate https://vendange.bnf.fr/fieldIndex (fields)
- Counts quads with predicate https://vendange.bnf.fr/subfieldIndex (subfields)
- Restricts to named graphs (skips the default graph)
- Optional per-graph breakdown

Requires: pyoxigraph >= 0.5
    pip install pyoxigraph

Usage:
    python data_exploration/count_index_quads_named.py \
      --store data_curation/api/datasets/current-exportcsv

    # with per-graph breakdown:
    python data_exploration/count_index_quads_named.py \
      --store data_curation/api/datasets/current-exportcsv \
      --per-graph
"""

from __future__ import annotations
import argparse
from collections import Counter
from typing import Optional

from pyoxigraph import (
    Store,
    NamedNode,
    DefaultGraph,
    BlankNode,
)

VF = "https://vendange.bnf.fr/"
FIELD_INDEX = NamedNode(VF + "fieldIndex")
SUBFIELD_INDEX = NamedNode(VF + "subfieldIndex")


def quad_graph(q) -> Optional[object]:
    """
    Retrieve the graph of a quad across pyoxigraph versions.
    Returns a NamedNode/BlankNode/DefaultGraph or None if missing.
    """
    g = getattr(q, "graph", None)
    if g is None:
        g = getattr(q, "graph_name", None)
    return g


def graph_is_named(g) -> bool:
    """True if the quad graph is not the default graph."""
    return g is not None and not isinstance(g, DefaultGraph)


def graph_label(g) -> str:
    """Human-friendly label for printing graph names."""
    if g is None:
        return "(unknown)"
    if isinstance(g, NamedNode):
        return g.value
    if isinstance(g, BlankNode):
        # Represent blank graph names with _:label
        return f"_:{g.value}"
    return str(g)


def count_predicate_in_named_graphs(store: Store, predicate: NamedNode, per_graph: bool = False):
    """
    Count quads matching ?s predicate ?o in *named* graphs only.
    Optionally returns per-graph breakdown (Counter keyed by graph label).
    """
    total = 0
    pg = Counter() if per_graph else None

    for q in store.quads_for_pattern(None, predicate, None, None):
        g = quad_graph(q)
        if not graph_is_named(g):
            continue

        total += 1
        if pg is not None:
            pg[graph_label(g)] += 1

    return total, pg


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Count fieldIndex/subfieldIndex quads in named graphs (default graph excluded)."
    )
    ap.add_argument("--store", required=True, help="Path to Oxigraph store directory (same as --location for oxigraph-cli).")
    ap.add_argument("--per-graph", action="store_true", help="Also print a per-graph breakdown for each predicate.")
    args = ap.parse_args()

    store = Store.read_only(args.store)

    field_total, field_pg = count_predicate_in_named_graphs(store, FIELD_INDEX, per_graph=args.per_graph)
    subfield_total, subfield_pg = count_predicate_in_named_graphs(store, SUBFIELD_INDEX, per_graph=args.per_graph)

    print("RESULTS (named graphs only)")
    print(f"fieldIndex_quads\t{field_total}")
    print(f"subfieldIndex_quads\t{subfield_total}")

    if args.per_graph:
        print("\nPER-GRAPH BREAKDOWN (fieldIndex)")
        print("graph\tcount")
        for g, n in sorted(field_pg.items()):
            print(f"{g}\t{n}")

        print("\nPER-GRAPH BREAKDOWN (subfieldIndex)")
        print("graph\tcount")
        for g, n in sorted(subfield_pg.items()):
            print(f"{g}\t{n}")


if __name__ == "__main__":
    main()