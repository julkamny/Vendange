#!/usr/bin/env python3
"""
Build a reduced Oxigraph dataset by matching works whose 150 field contains a
given string, then optionally walking to expressions, manifestations and agents.
Controlled-value records referenced by any selected entity are always pulled in.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence

from pyoxigraph import Literal, NamedNode, Store

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

from data_curation.api import datasets

# --- Constants ----------------------------------------------------------------

VF_ROOT = "https://vendange.bnf.fr/"
REL_ARK_PREFIX = VF_ROOT + "relation_ark/"

CLASS_WORK = NamedNode(VF_ROOT + "class/Work")
CLASS_EXPRESSION = NamedNode(VF_ROOT + "class/Expression")
CLASS_MANIFESTATION = NamedNode(VF_ROOT + "class/Manifestation")
CLASS_PUBLIC_ID = NamedNode(VF_ROOT + "class/PublicIdentity")
CLASS_COLLECTIVE = NamedNode(VF_ROOT + "class/Collective")
CLASS_FAMILY = NamedNode(VF_ROOT + "class/Family")
CLASS_CONTROLLED_VALUE = NamedNode(VF_ROOT + "class/ControlledValue")
CLASS_DEWEY = NamedNode(VF_ROOT + "class/DeweyConcept")
CLASS_BRAND = NamedNode(VF_ROOT + "class/Brand")

HAS_FIELD = NamedNode(VF_ROOT + "hasField")
FIELD_CODE = NamedNode(VF_ROOT + "fieldCode")
HAS_SUBFIELD = NamedNode(VF_ROOT + "hasSubfield")
SUBFIELD_VALUE = NamedNode(VF_ROOT + "subfieldValue")
PROPERTY_ARK = NamedNode(VF_ROOT + "property/ark")
PROPERTY_TYPE_RAW = NamedNode(VF_ROOT + "property/type_raw")
REL_EXPR_TO_WORK = NamedNode(VF_ROOT + "relation/750s3")
REL_MAN_TO_EXPR = NamedNode(VF_ROOT + "relation/740s3")


# --- Data containers ----------------------------------------------------------

@dataclass(frozen=True)
class EntityHit:
    """Keep the essentials of a matched record so we can copy its graph."""

    iri: NamedNode
    graph: NamedNode
    ark: str | None
    kind: str


# --- Helpers ------------------------------------------------------------------

def escape_literal(value: str) -> str:
    """Encode a Python string as a SPARQL-safe literal (double-quoted JSON)."""
    return json.dumps(value)


def resolve_dataset_path(dataset: str) -> Path:
    """Accept a dataset id or path; always return the RocksDB directory."""
    candidate = Path(dataset)
    if candidate.is_dir():
        return candidate
    datasets.ensure_root()
    candidate = datasets.dataset_directory(dataset)
    if candidate.exists():
        return candidate
    root = Path(__file__).resolve().parent.parent / "data_curation" / "api" / "datasets"
    return root / dataset


def slugify(text: str, max_len: int = 40) -> str:
    """Compact human text into a filesystem-friendly slug."""
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower())
    slug = slug.strip("-")
    return slug[:max_len] or "slice"


def open_output_store(path: Path, overwrite: bool) -> Store:
    """Create a writable Store at path, clearing any previous content if asked."""
    if path.exists():
        if not overwrite:
            raise SystemExit(f"Output store '{path}' already exists (use --overwrite to replace).")
        shutil.rmtree(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    return Store(str(path))


def run_query(store: Store, query: str) -> list[object]:
    """Execute SPARQL and return result rows as QuerySolution objects."""
    try:
        result = list(store.query(query))
    except Exception as exc:  # pragma: no cover
        raise SystemExit(f"SPARQL failure: {exc}") from exc
    return result


def build_values(name: str, nodes: Iterable[NamedNode]) -> str:
    """Render a SPARQL VALUES clause for IRIs; return empty string when none."""
    items = list(nodes)
    if not items:
        return ""
    iris = " ".join(f"<{n.value}>" for n in items)
    return f"VALUES ?{name} {{ {iris} }}\n"


def build_literal_values(name: str, values: Iterable[str]) -> str:
    """Render a VALUES clause for string literals (quoted & escaped)."""
    vals = list(values)
    if not vals:
        return ""
    joined = " ".join(escape_literal(v) for v in vals)
    return f"VALUES ?{name} {{ {joined} }}\n"


def get_optional(row, name: str):
    """Return a binding if present, else None (pyoxigraph QuerySolution lacks .get())."""
    try:
        return row[name]
    except KeyError:
        return None


# --- Selection steps ----------------------------------------------------------

def find_works(store: Store, needle: str) -> list[EntityHit]:
    """Locate works whose 150 subfields mention the needle (case-insensitive)."""
    query = f"""
PREFIX vf: <{VF_ROOT}>
SELECT DISTINCT ?work ?g ?ark
WHERE {{
  GRAPH ?g {{
    ?work a <{CLASS_WORK.value}> ;
          <{HAS_FIELD.value}> ?field .
    ?field <{FIELD_CODE.value}> "150" ;
           <{HAS_SUBFIELD.value}> ?sub .
    ?sub <{SUBFIELD_VALUE.value}> ?val .
    OPTIONAL {{ ?work <{PROPERTY_ARK.value}> ?ark }}
    FILTER regex(?val, {escape_literal(needle)}, "i")
  }}
}}
"""
    hits: list[EntityHit] = []
    for row in run_query(store, query):
        ark = get_optional(row, "ark")
        hits.append(EntityHit(row["work"], row["g"], ark.value if ark else None, "work"))
    return hits


def find_expressions(store: Store, works: Sequence[EntityHit]) -> list[EntityHit]:
    """Grab expressions pointing to the selected works via 750s3 (IRI or literal)."""
    work_nodes = {hit.iri for hit in works}
    work_arks = {hit.ark for hit in works if hit.ark}
    iri_values = build_values("work", work_nodes)
    ark_values = build_literal_values("wark", work_arks)
    union_parts = []
    if iri_values:
        union_parts.append(f"{{ ?expr <{REL_EXPR_TO_WORK.value}> ?work .\n  {iri_values}}}")
    if ark_values:
        union_parts.append(
            f"{{ ?expr <{REL_ARK_PREFIX}750s3> ?wark .\n  {ark_values}}}"
        )
    if not union_parts:
        return []
    query = f"""
PREFIX vf: <{VF_ROOT}>
SELECT DISTINCT ?expr ?g ?ark
WHERE {{
  GRAPH ?g {{
    ?expr a <{CLASS_EXPRESSION.value}> .
    {' UNION '.join(union_parts)}
    OPTIONAL {{ ?expr <{PROPERTY_ARK.value}> ?ark }}
  }}
}}
"""
    hits: list[EntityHit] = []
    for row in run_query(store, query):
        ark = get_optional(row, "ark")
        hits.append(EntityHit(row["expr"], row["g"], ark.value if ark else None, "expression"))
    return hits


def find_manifestations(store: Store, expressions: Sequence[EntityHit]) -> list[EntityHit]:
    """Grab manifestations pointing to the selected expressions via 740s3."""
    expr_nodes = {hit.iri for hit in expressions}
    expr_arks = {hit.ark for hit in expressions if hit.ark}
    iri_values = build_values("expr", expr_nodes)
    ark_values = build_literal_values("eark", expr_arks)
    union_parts = []
    if iri_values:
        union_parts.append(f"{{ ?man <{REL_MAN_TO_EXPR.value}> ?expr .\n  {iri_values}}}")
    if ark_values:
        union_parts.append(f"{{ ?man <{REL_ARK_PREFIX}740s3> ?eark .\n  {ark_values}}}")
    if not union_parts:
        return []
    query = f"""
PREFIX vf: <{VF_ROOT}>
SELECT DISTINCT ?man ?g ?ark
WHERE {{
  GRAPH ?g {{
    ?man a <{CLASS_MANIFESTATION.value}> .
    {' UNION '.join(union_parts)}
    OPTIONAL {{ ?man <{PROPERTY_ARK.value}> ?ark }}
  }}
}}
"""
    hits: list[EntityHit] = []
    for row in run_query(store, query):
        ark = get_optional(row, "ark")
        hits.append(EntityHit(row["man"], row["g"], ark.value if ark else None, "manifestation"))
    return hits


def collect_graph_refs(store: Store, entities: Iterable[EntityHit]) -> tuple[set[str], set[NamedNode]]:
    """Harvest literal ARKs and target IRIs present anywhere in the entity graphs."""
    ark_literals: set[str] = set()
    target_iris: set[NamedNode] = set()
    for hit in entities:
        graph = hit.graph or NamedNode(f"{VF_ROOT}graph/{hit.iri.value.rsplit('/', 1)[-1]}")
        for quad in store.quads_for_pattern(None, None, None, graph):
            obj = quad.object
            if isinstance(obj, Literal):
                if "ark:/" in obj.value:
                    ark_literals.add(obj.value)
            elif isinstance(obj, NamedNode):
                if obj.value.startswith(f"{VF_ROOT}entity/"):
                    target_iris.add(obj)
        # Also capture literal ARKs hanging directly off the subject (outside GRAPH clause)
        for quad in store.quads_for_pattern(hit.iri, None, None, None):
            obj = quad.object
            if isinstance(obj, Literal) and "ark:/" in obj.value:
                ark_literals.add(obj.value)
            elif isinstance(obj, NamedNode) and obj.value.startswith(f"{VF_ROOT}entity/"):
                target_iris.add(obj)
    return ark_literals, target_iris


def find_controlled_values(store: Store, arks: set[str], iris: set[NamedNode]) -> list[EntityHit]:
    """Select controlled-value-like entities whose ARK or IRI is referenced."""
    ark_values = build_literal_values("ark", arks)
    iri_values = build_values("cv", iris)
    if not ark_values and not iri_values:
        return []
    filters = []
    if ark_values:
        filters.append(f"{{ ?cv <{PROPERTY_ARK.value}> ?ark . {ark_values} }}")
    if iri_values:
        filters.append(f"{{ {iri_values} }}")
    query = f"""
PREFIX vf: <{VF_ROOT}>
SELECT DISTINCT ?cv ?g ?ark
WHERE {{
  GRAPH ?g {{
    {' UNION '.join(filters)}
    ?cv a ?type .
    VALUES ?type {{ <{CLASS_CONTROLLED_VALUE.value}> <{CLASS_DEWEY.value}> <{CLASS_BRAND.value}> }}
    OPTIONAL {{ ?cv <{PROPERTY_ARK.value}> ?ark }}
  }}
}}
"""
    hits: list[EntityHit] = []
    for row in run_query(store, query):
        ark = get_optional(row, "ark")
        hits.append(EntityHit(row["cv"], row["g"], ark.value if ark else None, "controlled"))
    return hits


def find_agents(store: Store, arks: set[str], iris: set[NamedNode]) -> list[EntityHit]:
    """Pull public identities / collectivities / families whose ARK or IRI is cited."""
    ark_values = build_literal_values("ark", arks)
    iri_values = build_values("agent", iris)
    if not ark_values and not iri_values:
        return []
    allowed_types = {"identité publique de personne", "identite publique de personne", "collectivité", "collectivite", "famille"}
    allowed_raw = ", ".join(escape_literal(t) for t in sorted(allowed_types))
    type_iris = ", ".join(
        f"<{iri}>"
        for iri in (
            CLASS_PUBLIC_ID.value,
            CLASS_COLLECTIVE.value,
            CLASS_FAMILY.value,
        )
    )
    query = f"""
PREFIX vf: <{VF_ROOT}>
SELECT DISTINCT ?agent ?g ?ark
WHERE {{
  GRAPH ?g {{
    {{
      {' UNION '.join(filter(None, [f'{{ ?agent <{PROPERTY_ARK.value}> ?ark . {ark_values} }}' if ark_values else None, f'{{ {iri_values} }}' if iri_values else None]))}
    }}
    OPTIONAL {{ ?agent <{PROPERTY_TYPE_RAW.value}> ?raw }}
    OPTIONAL {{ ?agent a ?rtype }}
    FILTER(
      (bound(?raw) && LCASE(STR(?raw)) IN ({allowed_raw})) ||
      (?rtype IN ({type_iris}))
    )
  }}
}}
"""
    hits: list[EntityHit] = []
    for row in run_query(store, query):
        ark = get_optional(row, "ark")
        hits.append(EntityHit(row["agent"], row["g"], ark.value if ark else None, "agent"))
    return hits


# --- Copying ------------------------------------------------------------------

def graph_names_for_entities(store: Store, entities: Iterable[EntityHit]) -> set[NamedNode]:
    """Ensure we have the graph for every entity; fall back to quad lookup."""
    graphs: set[NamedNode] = {hit.graph for hit in entities}
    for hit in entities:
        if hit.graph:
            continue
        for quad in store.quads_for_pattern(hit.iri, None, None, None):
            if quad.graph_name is not None:
                graphs.add(quad.graph_name)
    return graphs


def copy_graphs(store: Store, dest: Store, graph_names: Iterable[NamedNode]) -> int:
    """Copy full named graphs into dest; return number of quads written."""
    written = 0
    for g in graph_names:
        for quad in store.quads_for_pattern(None, None, None, g):
            dest.add(quad)
            written += 1
    dest.flush()
    return written


# --- CLI ----------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create a dataset subset by querying works with a needle inside field 150.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("dataset", help="Dataset id or path under data_curation/api/datasets/")
    parser.add_argument("needle", help="String to search within any 150 subfield of works")
    parser.add_argument("--include-expressions", action="store_true", help="Also pull expressions pointing to the selected works (750s3)")
    parser.add_argument("--include-manifestations", action="store_true", help="Also pull manifestations pointing to the retained expressions (740s3)")
    parser.add_argument("--include-agents", action="store_true", help="Also pull agents whose ARK appears in the kept records")
    parser.add_argument("--output-id", help="Override output directory name (defaults to <dataset>-subset-<needle-slug>)")
    parser.add_argument("--overwrite", action="store_true", help="Replace the output directory if it already exists")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source_path = resolve_dataset_path(args.dataset)
    if not source_path.exists():
        raise SystemExit(f"Dataset '{source_path}' not found")

    needle_slug = slugify(args.needle)
    default_output = f"{Path(args.dataset).name}-subset-{needle_slug}"
    output_id = args.output_id or default_output

    # Register the output dataset in datasets.json and resolve its directory.
    title = f"{output_id} (150 contains '{args.needle}')"
    meta = datasets.ensure_dataset(output_id, title=title)
    output_dir = datasets.dataset_directory(meta.id)

    store = Store.read_only(str(source_path))

    works = find_works(store, args.needle)
    if not works:
        raise SystemExit("No works matched the provided needle; nothing to copy.")

    expressions: list[EntityHit] = []
    manifestations: list[EntityHit] = []
    if args.include_expressions:
        expressions = find_expressions(store, works)
    if args.include_manifestations and expressions:
        manifestations = find_manifestations(store, expressions)

    selected = works + expressions + manifestations
    referenced_arks, referenced_iris = collect_graph_refs(store, selected)

    controlled_values = find_controlled_values(store, referenced_arks, referenced_iris)
    selected += controlled_values

    agents: list[EntityHit] = []
    if args.include_agents and (referenced_arks or referenced_iris):
        agents = find_agents(store, referenced_arks, referenced_iris)
        selected += agents
        # Controlled values that appear only in agent graphs
        extra_arks, extra_iris = collect_graph_refs(store, agents)
        more_controlled = find_controlled_values(store, extra_arks, extra_iris)
        selected += [c for c in more_controlled if c.iri not in {cv.iri for cv in controlled_values}]

    graphs_to_copy = graph_names_for_entities(store, selected)
    dest = open_output_store(output_dir, args.overwrite)
    quad_count = copy_graphs(store, dest, graphs_to_copy)
    datasets.touch_dataset(meta.id)

    print(f"Subset written to registered dataset: {meta.id}")
    print(f"Path: {output_dir}")
    print(
        "Entities kept | works={w} expressions={e} manifestations={m} controlled={c} agents={a}".format(
            w=len(works),
            e=len(expressions),
            m=len(manifestations),
            c=len(controlled_values),
            a=len(agents),
        )
    )
    print(f"Named graphs copied: {len(graphs_to_copy)}  | quads written: {quad_count}")
    print("Run with uv: uv run python data_exploration/subset_by_150.py <dataset> <needle> [flags]")


if __name__ == "__main__":
    main()
