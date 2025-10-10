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

from scripts.curation.pipeline import run_cluster_operation, run_cluster_with_expression_operation
from scripts.pipeline_title_contamination import run_title_contamination_detection


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
        help="Load fixture data/test_NAME.csv into the provided input path before running the command",
    )

    sub = parser.add_subparsers(dest="cmd", required=True)

    # EXISTANT
    p_cluster = sub.add_parser("cluster", help="Run clustering operation on works", parents=[fixture_parent])
    p_cluster.add_argument("--input", required=True, help="Path to input CSV")
    p_cluster.add_argument("--output", required=True, help="Path to output CSV (curated)")
    p_cluster.add_argument("--clusters-json", required=False, help="Optional path to write clusters summary JSON")

    p_cluster_expr = sub.add_parser(
        "cluster-with-expressions",
        help="Run clustering on works and propagate to expressions",
        parents=[fixture_parent],
    )
    p_cluster_expr.add_argument("--input", required=True, help="Path to input CSV")
    p_cluster_expr.add_argument("--output", required=True, help="Path to output CSV (curated)")
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

    # NOUVEAU
    p_detect = sub.add_parser(
        "detect-contamination",
        help="Detect titles contaminated with author names",
        parents=[fixture_parent],
    )
    p_detect.add_argument("--input", required=True, help="Path to input CSV")
    p_detect.add_argument("--out-json", required=True, help="Where to write detections JSON")
    p_detect.add_argument("--tau-hi", type=float, default=0.85, help="High-confidence threshold")
    p_detect.add_argument("--tau-lo", type=float, default=0.65, help="Medium-confidence threshold")

    args = parser.parse_args()

    _configure_logging(args.verbose)

    input_path = Path(args.input)
    if getattr(args, "fixture", None):
        input_path = _apply_input_fixture(args.input, args.fixture)

    if args.cmd == "cluster":
        clusters = run_cluster_operation(str(input_path), args.output, args.clusters_json)
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
            str(input_path),
            args.output,
            args.work_clusters_json,
            args.expression_clusters_json,
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

    elif args.cmd == "detect-contamination":
        recs = run_title_contamination_detection(str(input_path), args.out_json, tau_hi=args.tau_hi, tau_lo=args.tau_lo)
        LOGGER.info("[bold green]Detections written:[/] %s", len(recs))

if __name__ == "__main__":
    main()
