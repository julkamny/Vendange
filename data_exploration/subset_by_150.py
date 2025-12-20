#!/usr/bin/env python3
"""
Create a Postgres-backed subset by matching works whose 150 field contains a
needle (regex), then optionally walking to expressions, manifestations and
agents. Controlled-value records referenced by any selected entity are pulled in.
"""
from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Iterator, Sequence

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

from data_curation.api import datasets  # noqa: E402
from data_curation.api.db_shared import RELATION_NS, looks_like_ark  # noqa: E402
from data_curation.api.pg.session import db_session, statement_timeout  # noqa: E402
from data_curation.api.pg.workspace_repo import AGENT_TYPE_NORMS  # noqa: E402


# --- Constants ----------------------------------------------------------------

REL_EXPR_TO_WORK = f"{RELATION_NS}750s3"
REL_MAN_TO_EXPR = f"{RELATION_NS}740s3"

CONTROLLED_TYPE_NORMS = ("valeur controlee", "concept dewey", "marque")

CHUNK_SIZE = 5000


# --- Data containers ----------------------------------------------------------

@dataclass(frozen=True)
class EntityHit:
    """Minimal entity metadata for subset selection and copying."""

    entity_id: int
    ark: str | None
    type_norm: str


# --- Helpers ------------------------------------------------------------------

def chunked(items: Sequence, size: int = CHUNK_SIZE) -> Iterator[list]:
    """Yield fixed-size chunks from a sequence."""
    for idx in range(0, len(items), size):
        yield list(items[idx : idx + size])


def slugify(text: str, max_len: int = 40) -> str:
    """Compact human text into a filesystem-friendly slug."""
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower())
    slug = slug.strip("-")
    return slug[:max_len] or "slice"


def ensure_dataset_exists(dataset_id: str) -> None:
    """Fail fast if the dataset id is unknown in Postgres."""
    try:
        datasets.get_dataset(dataset_id)
    except KeyError as exc:
        raise SystemExit(f"Dataset '{dataset_id}' not found in Postgres.") from exc


def output_dataset_ready(output_id: str, title: str, *, overwrite: bool) -> tuple[str, Path]:
    """Create or reuse the output dataset; clear rows when overwriting."""
    meta = datasets.ensure_dataset(output_id, title=title)
    output_dir = datasets.dataset_directory(meta.id)

    with db_session() as conn, conn.transaction():
        with statement_timeout(conn, 30_000):
            existing = conn.execute(
                "SELECT 1 FROM entity WHERE dataset_id=%s LIMIT 1",
                (meta.id,),
            ).fetchone()
            if existing and not overwrite:
                raise SystemExit(
                    f"Output dataset '{meta.id}' already has data (use --overwrite to replace)."
                )
            if existing and overwrite:
                _clear_dataset_rows(conn, meta.id)
    return meta.id, output_dir


def _clear_dataset_rows(conn, dataset_id: str) -> None:
    """Remove all rows for a dataset across the projection tables."""
    for table in ("rel_edge", "entity_label", "cluster", "fts", "subfield", "field", "entity"):
        conn.execute(f"DELETE FROM {table} WHERE dataset_id=%s", (dataset_id,))


# --- Selection steps ----------------------------------------------------------

def find_works(conn, dataset_id: str, needle: str) -> list[EntityHit]:
    """Locate works whose 150 subfields mention the needle (regex, case-insensitive)."""
    rows = conn.execute(
        """
        SELECT DISTINCT e.entity_id, e.ark, e.type_norm
        FROM entity e
        JOIN field f ON f.dataset_id = e.dataset_id AND f.entity_id = e.entity_id
        JOIN subfield s ON s.dataset_id = e.dataset_id AND s.entity_id = e.entity_id AND s.field_idx = f.field_idx
        WHERE e.dataset_id = %s
          AND e.type_norm = 'oeuvre'
          AND f.tag = '150'
          AND s.value ~* %s
        """,
        (dataset_id, needle),
    ).fetchall()
    return [EntityHit(row["entity_id"], row.get("ark"), row.get("type_norm") or "") for row in rows]


def _find_related_entities(
    conn,
    dataset_id: str,
    predicate_iri: str,
    target_ids: Sequence[int],
    target_arks: Sequence[str],
    type_norm: str,
) -> list[EntityHit]:
    """Follow rel_edge predicate to fetch entities of a given type_norm."""
    if not target_ids and not target_arks:
        return []

    hits: dict[int, EntityHit] = {}
    id_chunks = list(chunked(list(target_ids))) or [None]
    ark_chunks = list(chunked(list(target_arks))) or [None]

    for id_chunk in id_chunks:
        for ark_chunk in ark_chunks:
            conditions = []
            params: list = [dataset_id, predicate_iri]
            if id_chunk:
                conditions.append("rel.tgt_entity_id = ANY(%s)")
                params.append(id_chunk)
            if ark_chunk:
                conditions.append("rel.tgt_ark = ANY(%s)")
                params.append(ark_chunk)
            if not conditions:
                continue
            params.append(type_norm)
            query = f"""
                SELECT DISTINCT e.entity_id, e.ark, e.type_norm
                FROM rel_edge rel
                JOIN entity e ON e.dataset_id = rel.dataset_id AND e.entity_id = rel.src_entity_id
                WHERE rel.dataset_id = %s
                  AND rel.predicate_iri = %s
                  AND ({' OR '.join(conditions)})
                  AND e.type_norm = %s
            """
            rows = conn.execute(query, tuple(params)).fetchall()
            for row in rows:
                hit = EntityHit(row["entity_id"], row.get("ark"), row.get("type_norm") or "")
                hits[hit.entity_id] = hit
    return list(hits.values())


def find_expressions(conn, dataset_id: str, works: Sequence[EntityHit]) -> list[EntityHit]:
    """Grab expressions pointing to the selected works via 750s3."""
    work_ids = [hit.entity_id for hit in works]
    work_arks = [hit.ark for hit in works if hit.ark]
    return _find_related_entities(conn, dataset_id, REL_EXPR_TO_WORK, work_ids, work_arks, "expression")


def find_manifestations(conn, dataset_id: str, expressions: Sequence[EntityHit]) -> list[EntityHit]:
    """Grab manifestations pointing to the selected expressions via 740s3."""
    expr_ids = [hit.entity_id for hit in expressions]
    expr_arks = [hit.ark for hit in expressions if hit.ark]
    return _find_related_entities(conn, dataset_id, REL_MAN_TO_EXPR, expr_ids, expr_arks, "manifestation")


def collect_referenced_arks(conn, dataset_id: str, entity_ids: Sequence[int]) -> set[str]:
    """Extract ARK literals referenced in subfields or rel_edge for the entities."""
    if not entity_ids:
        return set()
    arks: set[str] = set()
    for chunk in chunked(list(entity_ids)):
        sub_rows = conn.execute(
            """
            SELECT DISTINCT value
            FROM subfield
            WHERE dataset_id=%s
              AND entity_id = ANY(%s)
              AND value LIKE %s
            """,
            (dataset_id, chunk, "ark:/%"),
        ).fetchall()
        for row in sub_rows:
            value = row.get("value")
            if isinstance(value, str) and looks_like_ark(value.strip()):
                arks.add(value.strip())

        edge_rows = conn.execute(
            """
            SELECT DISTINCT tgt_ark
            FROM rel_edge
            WHERE dataset_id=%s
              AND src_entity_id = ANY(%s)
              AND tgt_ark <> ''
            """,
            (dataset_id, chunk),
        ).fetchall()
        for row in edge_rows:
            value = row.get("tgt_ark")
            if isinstance(value, str) and looks_like_ark(value.strip()):
                arks.add(value.strip())
    return arks


def find_entities_by_arks(
    conn,
    dataset_id: str,
    arks: Iterable[str],
    type_norms: Sequence[str],
) -> list[EntityHit]:
    """Resolve entities by ARK and type_norm membership."""
    ark_list = [ark for ark in arks if ark]
    if not ark_list:
        return []
    hits: dict[int, EntityHit] = {}
    for chunk in chunked(ark_list):
        rows = conn.execute(
            """
            SELECT entity_id, ark, type_norm
            FROM entity
            WHERE dataset_id=%s
              AND ark = ANY(%s)
              AND type_norm = ANY(%s)
            """,
            (dataset_id, chunk, list(type_norms)),
        ).fetchall()
        for row in rows:
            hit = EntityHit(row["entity_id"], row.get("ark"), row.get("type_norm") or "")
            hits[hit.entity_id] = hit
    return list(hits.values())


# --- Copying ------------------------------------------------------------------

def _copy_by_entity_ids(
    conn,
    table: str,
    columns: str,
    entity_column: str,
    src_dataset: str,
    dest_dataset: str,
    entity_ids: Sequence[int],
) -> int:
    """Copy rows from a table filtered by entity ids; return rows inserted."""
    if not entity_ids:
        return 0
    written = 0
    for chunk in chunked(list(entity_ids)):
        result = conn.execute(
            f"""
            INSERT INTO {table} (dataset_id, {columns})
            SELECT %s, {columns}
            FROM {table}
            WHERE dataset_id = %s
              AND {entity_column} = ANY(%s)
            """,
            (dest_dataset, src_dataset, chunk),
        )
        written += result.rowcount or 0
    return written


def copy_entities(
    conn,
    src_dataset: str,
    dest_dataset: str,
    entity_ids: Sequence[int],
) -> int:
    """Copy entity rows while keeping entity_id stable across datasets."""
    if not entity_ids:
        return 0
    written = 0
    for chunk in chunked(list(entity_ids)):
        result = conn.execute(
            """
            INSERT INTO entity (dataset_id, entity_id, record_id, ark, type_raw, type_norm, record, original_record, updated_at)
            SELECT %s, entity_id, record_id, ark, type_raw, type_norm, record, original_record, updated_at
            FROM entity
            WHERE dataset_id = %s
              AND entity_id = ANY(%s)
            """,
            (dest_dataset, src_dataset, chunk),
        )
        written += result.rowcount or 0
    return written


def copy_rel_edges(
    conn,
    src_dataset: str,
    dest_dataset: str,
    entity_ids: Sequence[int],
) -> int:
    """Copy rel_edge rows for selected source entities."""
    if not entity_ids:
        return 0
    written = 0
    for chunk in chunked(list(entity_ids)):
        result = conn.execute(
            """
            INSERT INTO rel_edge (dataset_id, src_entity_id, predicate_iri, tgt_ark, tgt_entity_id)
            SELECT %s, src_entity_id, predicate_iri, tgt_ark, tgt_entity_id
            FROM rel_edge
            WHERE dataset_id = %s
              AND src_entity_id = ANY(%s)
            """,
            (dest_dataset, src_dataset, chunk),
        )
        written += result.rowcount or 0
    return written


def copy_clusters(
    conn,
    src_dataset: str,
    dest_dataset: str,
    entity_ids: Sequence[int],
    anchor_arks: Sequence[str],
) -> int:
    """Copy cluster rows for anchors included in the subset."""
    if not entity_ids and not anchor_arks:
        return 0
    result = conn.execute(
        """
        INSERT INTO cluster (dataset_id, anchor_entity_id, anchor_ark, member_entity_id, member_ark, note)
        SELECT %s, anchor_entity_id, anchor_ark, member_entity_id, member_ark, note
        FROM cluster
        WHERE dataset_id = %s
          AND (anchor_entity_id = ANY(%s) OR anchor_ark = ANY(%s))
        """,
        (dest_dataset, src_dataset, list(entity_ids), list(anchor_arks)),
    )
    return result.rowcount or 0


# --- CLI ----------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create a Postgres dataset subset by querying works with a needle inside field 150.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("dataset", help="Dataset id registered in Postgres")
    parser.add_argument("needle", help="Regex to search within any 150 subfield of works (case-insensitive)")
    parser.add_argument("--include-expressions", action="store_true", help="Also pull expressions pointing to the selected works (750s3)")
    parser.add_argument("--include-manifestations", action="store_true", help="Also pull manifestations pointing to the retained expressions (740s3)")
    parser.add_argument("--include-agents", action="store_true", help="Also pull agents whose ARK appears in the kept records")
    parser.add_argument("--output-id", help="Override output dataset id (defaults to <dataset>-subset-<needle-slug>)")
    parser.add_argument("--overwrite", action="store_true", help="Replace the output dataset if it already has data")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    ensure_dataset_exists(args.dataset)

    needle_slug = slugify(args.needle)
    default_output = f"{args.dataset}-subset-{needle_slug}"
    output_id = args.output_id or default_output

    title = f"{output_id} (150 contains '{args.needle}')"
    output_id, output_dir = output_dataset_ready(output_id, title, overwrite=args.overwrite)

    with db_session() as conn, statement_timeout(conn, 120_000):
        works = find_works(conn, args.dataset, args.needle)
        if not works:
            raise SystemExit("No works matched the provided needle; nothing to copy.")

        expressions: list[EntityHit] = []
        manifestations: list[EntityHit] = []
        if args.include_expressions:
            expressions = find_expressions(conn, args.dataset, works)
        if args.include_manifestations and expressions:
            manifestations = find_manifestations(conn, args.dataset, expressions)

        selected: list[EntityHit] = works + expressions + manifestations
        referenced_arks = collect_referenced_arks(conn, args.dataset, [hit.entity_id for hit in selected])

        controlled_values = find_entities_by_arks(conn, args.dataset, referenced_arks, CONTROLLED_TYPE_NORMS)
        selected += controlled_values

        agents: list[EntityHit] = []
        if args.include_agents and referenced_arks:
            agents = find_entities_by_arks(conn, args.dataset, referenced_arks, AGENT_TYPE_NORMS)
            selected += agents
            extra_arks = collect_referenced_arks(conn, args.dataset, [hit.entity_id for hit in agents])
            more_controlled = find_entities_by_arks(conn, args.dataset, extra_arks, CONTROLLED_TYPE_NORMS)
            selected += [hit for hit in more_controlled if hit.entity_id not in {c.entity_id for c in controlled_values}]

    selected_ids = sorted({hit.entity_id for hit in selected})
    selected_arks = sorted({hit.ark for hit in selected if hit.ark})

    with db_session() as conn, conn.transaction():
        with statement_timeout(conn, 120_000):
            copied_entities = copy_entities(conn, args.dataset, output_id, selected_ids)
            copied_labels = _copy_by_entity_ids(
                conn,
                "entity_label",
                "entity_id, label, sort_key, type_norm",
                "entity_id",
                args.dataset,
                output_id,
                selected_ids,
            )
            copied_edges = copy_rel_edges(conn, args.dataset, output_id, selected_ids)
            copied_clusters = copy_clusters(conn, args.dataset, output_id, selected_ids, selected_arks)
            copied_fts = _copy_by_entity_ids(
                conn,
                "fts",
                "entity_id, document",
                "entity_id",
                args.dataset,
                output_id,
                selected_ids,
            )
            copied_fields = _copy_by_entity_ids(
                conn,
                "field",
                "entity_id, field_idx, tag",
                "entity_id",
                args.dataset,
                output_id,
                selected_ids,
            )
            copied_subfields = _copy_by_entity_ids(
                conn,
                "subfield",
                "entity_id, field_idx, sub_idx, code_raw, code_norm, value",
                "entity_id",
                args.dataset,
                output_id,
                selected_ids,
            )

    datasets.touch_dataset(output_id)

    print(f"Subset written to registered dataset: {output_id}")
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
    print(
        "Rows copied | entity={e} label={l} rel_edge={r} cluster={c} fts={f} field={fi} subfield={sf}".format(
            e=copied_entities,
            l=copied_labels,
            r=copied_edges,
            c=copied_clusters,
            f=copied_fts,
            fi=copied_fields,
            sf=copied_subfields,
        )
    )
    print("Run with uv: uv run python data_exploration/subset_by_150.py <dataset> <needle> [flags]")


if __name__ == "__main__":
    main()
