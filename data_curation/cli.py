# scripts/cli.py
from __future__ import annotations

import argparse
import atexit
import logging
import shutil
import tempfile
from pathlib import Path

from rich.console import Console
from rich.logging import RichHandler
from rich.theme import Theme

from data_curation.api import db, datasets as dataset_registry
from data_curation.curation.pipeline import run_cluster_operation, run_cluster_with_expression_operation

LOGGER = logging.getLogger("scripts.cli")
RICH_THEME = Theme({
    "logging.level.debug": "dim cyan",
    "logging.level.info": "bold green",
    "logging.level.warning": "bold yellow",
    "logging.level.error": "bold red",
})
RICH_CONSOLE = Console(theme=RICH_THEME, highlight=True, soft_wrap=True)
_TEMP_FIXTURES: list[Path] = []


def _cleanup_temp_fixtures() -> None:
    for path in _TEMP_FIXTURES:
        try:
            path.unlink(missing_ok=True)  # type: ignore[attr-defined]
        except AttributeError:
            # Python <3.11 fallback
            if path.exists():
                path.unlink()


atexit.register(_cleanup_temp_fixtures)


def _configure_logging(verbosity: int) -> None:
    """Configure logging once based on CLI verbosity."""

    level = logging.WARNING
    if verbosity >= 2:
        level = logging.DEBUG
    elif verbosity == 1:
        level = logging.INFO

    handler = RichHandler(
        console=RICH_CONSOLE,
        markup=True,
        rich_tracebacks=True,
        show_time=False,
        show_path=False,
    )

    logging.basicConfig(
        level=level,
        format="%(message)s",
        handlers=[handler],
        force=True,
    )
    logging.getLogger("spacy").setLevel(max(logging.WARNING, level))
    for noisy in (
        "markdown_it",
        "markdown_it.main",
        "markdown_it.rules_block",
        "markdown_it.rules_inline",
    ):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def _apply_input_fixture(input_path: str | Path, fixture: str | None) -> Path:
    original_path = Path(input_path)
    if not fixture:
        return original_path

    fixture_slug = fixture.strip().lower().replace(" ", "_")
    fixture_path = Path("data") / f"test_{fixture_slug}.csv"
    if not fixture_path.exists():
        raise FileNotFoundError(f"Fixture CSV not found: {fixture_path}")

    suffix = original_path.suffix or ".csv"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, prefix="vendange_fixture_") as tmp:
        temp_path = Path(tmp.name)

    shutil.copy2(fixture_path, temp_path)
    _TEMP_FIXTURES.append(temp_path)

    LOGGER.info(
        "[bold yellow]Loaded fixture[/]: [link=file://%s]%s[/link] → [link=file://%s]%s[/link]",
        fixture_path,
        fixture_path.name,
        temp_path,
        temp_path.name,
    )

    return temp_path


def _ingest_csv(path: Path, dataset_id: str, dataset_label: str | None) -> None:
    LOGGER.info(
        "[bold blue]Loading dataset[/]: [link=file://%s]%s[/link]%s",
        path,
        path.name,
        f" (label: {dataset_label})" if dataset_label else "",
    )
    content = path.read_bytes()
    stats = db.ingest_csv(content, dataset_id, dataset_label=dataset_label)
    LOGGER.info(
        "[bold green]Store updated[/]: %s records, %s quads",
        stats.records,
        stats.quads,
    )

def main() -> None:
    parser = argparse.ArgumentParser(description="WEM trees curation CLI")
    parser.add_argument(
        "-v",
        "--verbose",
        action="count",
        default=0,
        help="Increase logging verbosity (use -vv for debug output)",
    )

    fixture_parent = argparse.ArgumentParser(add_help=False)
    fixture_parent.add_argument(
        "--mock",
        "--test",
        dest="fixture",
        metavar="NAME",
        help="Load fixture data/test_NAME.csv instead of the provided CSV before ingestion",
    )

    ingest_parent = argparse.ArgumentParser(add_help=False)
    ingest_parent.add_argument(
        "--csv",
        dest="csv",
        help="Optional CSV to ingest into the Oxigraph store before running the command",
    )
    ingest_parent.add_argument(
        "--dataset-label",
        dest="dataset_label",
        help="Dataset label recorded alongside the ingestion metadata",
    )
    ingest_parent.add_argument(
        "--dataset",
        required=True,
        help="Identifier of the dataset to operate on",
    )

    sub = parser.add_subparsers(dest="cmd", required=True)

    p_cluster = sub.add_parser(
        "cluster",
        help="Run clustering operation on works and persist results into the store",
        parents=[fixture_parent, ingest_parent],
    )
    p_cluster.add_argument("--clusters-json", required=False, help="Optional path to write clusters summary JSON")

    p_cluster_expr = sub.add_parser(
        "cluster-with-expressions",
        help="Run clustering on works and propagate to expressions, persisting into the store",
        parents=[fixture_parent, ingest_parent],
    )
    p_cluster_expr.add_argument(
        "--work-clusters-json",
        required=False,
        help="Optional path to write works clusters summary JSON",
    )
    p_cluster_expr.add_argument(
        "--expression-clusters-json",
        required=False,
        help="Optional path to write expressions clusters summary JSON",
    )

    args = parser.parse_args()

    _configure_logging(args.verbose)

    csv_source = getattr(args, "csv", None)
    dataset_label = getattr(args, "dataset_label", None)
    dataset_input = getattr(args, "dataset")
    dataset_meta = dataset_registry.ensure_dataset(dataset_input, title=dataset_label or dataset_input)
    dataset_id = dataset_meta.id
    if dataset_id != dataset_input:
        LOGGER.info("[bold yellow]Dataset identifier normalised[/]: %s → %s", dataset_input, dataset_id)

    if csv_source:
        csv_path = Path(csv_source)
        if getattr(args, "fixture", None):
            csv_path = _apply_input_fixture(csv_source, args.fixture)
        label = dataset_label or dataset_meta.title
        _ingest_csv(csv_path, dataset_id, label)

    if args.cmd == "cluster":
        clusters = run_cluster_operation(dataset_id=dataset_id, clusters_json=args.clusters_json)
        LOGGER.info("[bold green]Clusters created:[/] %s", len(clusters))
        for c in clusters:
            LOGGER.info(
                "  [dim]-[/] Anchor [cyan]%s[/] ← [bold]%s[/] work%s",
                c.anchor_id,
                len(c.clustered_ids),
                "s" if len(c.clustered_ids) != 1 else "",
            )

    elif args.cmd == "cluster-with-expressions":
        work_clusters, expression_clusters = run_cluster_with_expression_operation(
            dataset_id=dataset_id,
            works_json=args.work_clusters_json,
            expressions_json=args.expression_clusters_json,
        )
        LOGGER.info("[bold green]Work clusters created:[/] %s", len(work_clusters))
        for c in work_clusters:
            LOGGER.info(
                "  [dim]-[/] Anchor [cyan]%s[/] ← [bold]%s[/] work%s",
                c.anchor_id,
                len(c.clustered_ids),
                "s" if len(c.clustered_ids) != 1 else "",
            )
        LOGGER.info("[bold green]Expression clusters created:[/] %s", len(expression_clusters))
        for ec in expression_clusters:
            LOGGER.info(
                "  [dim]-[/] Anchor expression [cyan]%s[/] ← [bold]%s[/] expression%s",
                ec.anchor_expression_id,
                len(ec.clustered_expression_ids),
                "s" if len(ec.clustered_expression_ids) != 1 else "",
            )

if __name__ == "__main__":
    main()
