# scripts/cli.py
from __future__ import annotations

import argparse
import atexit
import logging
import re
import shutil
import tempfile
from pathlib import Path
from datetime import datetime, timezone

from rich.console import Console
from rich.logging import RichHandler
from rich.theme import Theme

from data_curation.api import db, datasets as dataset_registry
from data_curation.curation.pipeline import run_cluster_operation, run_cluster_with_expression_operation
from data_curation.utils.log_bundle import LOG_TEXT_FORMAT, LogBundle, activate_log_bundle, reset_log_bundle

LOGGER = logging.getLogger("scripts.cli")
RICH_THEME = Theme({
    "logging.level.debug": "dim cyan",
    "logging.level.info": "bold green",
    "logging.level.warning": "bold yellow",
    "logging.level.error": "bold red",
})
RICH_CONSOLE = Console(theme=RICH_THEME, highlight=True, soft_wrap=True)
_TEMP_FIXTURES: list[Path] = []
_MARKUP_TAG_RE = re.compile(r"\[[^\]]+\]")
FILE_LOG_FORMAT = LOG_TEXT_FORMAT


def _cleanup_temp_fixtures() -> None:
    for path in _TEMP_FIXTURES:
        try:
            path.unlink(missing_ok=True)  # type: ignore[attr-defined]
        except AttributeError:
            # Python <3.11 fallback
            if path.exists():
                path.unlink()


atexit.register(_cleanup_temp_fixtures)


def _verbosity_to_level(verbosity: int) -> int:
    if verbosity >= 2:
        return logging.DEBUG
    if verbosity == 1:
        return logging.INFO
    return logging.WARNING


class PlainLogFormatter(logging.Formatter):
    """Formatter that removes Rich-style markup from log messages."""

    def format(self, record: logging.LogRecord) -> str:
        rendered = super().format(record)
        return _MARKUP_TAG_RE.sub("", rendered)


class _BundledFileHandler(logging.Handler):
    """Write logs to the bundle text file while capturing structured entries."""

    def __init__(self, bundle: LogBundle, level: int) -> None:
        super().__init__(level=level)
        self.bundle = bundle
        self._formatter = PlainLogFormatter(FILE_LOG_FORMAT, "%Y-%m-%d %H:%M:%S")
        self._stream = bundle.open_text_stream()

    def emit(self, record: logging.LogRecord) -> None:
        if not record.name.startswith("data_curation"):
            return
        try:
            message = record.getMessage()
        except Exception:  # pragma: no cover - defensive
            message = str(record.msg)
        timestamp = datetime.fromtimestamp(record.created, timezone.utc).isoformat()
        line = self._formatter.format(record)
        self._stream.write(f"{line}\n")
        self._stream.flush()
        exception_text: str | None = None
        if record.exc_info:
            exception_text = self._formatter.formatException(record.exc_info)
        elif record.exc_text:
            exception_text = record.exc_text
        self.bundle.add_record(
            timestamp=timestamp,
            level=record.levelname,
            logger_name=record.name,
            message=message,
            exception=exception_text,
        )

    def close(self) -> None:  # pragma: no cover - defensive cleanup
        try:
            if not self._stream.closed:
                self._stream.close()
            self.bundle.close_text_stream()
        finally:
            super().close()


def _configure_logging(verbosity: int) -> None:
    """Configure logging once based on CLI verbosity."""

    level = _verbosity_to_level(verbosity)

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


def _install_file_logging(bundle: LogBundle, verbosity: int) -> logging.Handler:
    """Attach a file-backed handler that also feeds the log bundle."""

    handler = _BundledFileHandler(bundle, level=_verbosity_to_level(verbosity))
    root_logger = logging.getLogger()
    root_logger.addHandler(handler)
    if root_logger.level > handler.level:
        root_logger.setLevel(handler.level)
    return handler


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
    bundle: LogBundle | None = None
    bundle_token = None
    file_handler: logging.Handler | None = None
    bundle_ready = False
    try:
        bundle_info = dataset_registry.create_dataset_log_bundle(dataset_id, prefix="cli")
    except OSError as exc:
        RICH_CONSOLE.print(f"[bold red]Impossible de préparer le dossier de logs[/]: {exc}")
    else:
        bundle = LogBundle(
            run_id=bundle_info.run_id,
            directory=bundle_info.directory,
            text_path=bundle_info.text_path,
            html_path=bundle_info.html_path,
            assets_path=bundle_info.assets_path,
        )
        bundle_token = activate_log_bundle(bundle)
        try:
            file_handler = _install_file_logging(bundle, args.verbose)
        except OSError as exc:
            RICH_CONSOLE.print(f"[bold red]Impossible d'activer la journalisation fichier[/]: {exc}")
        else:
            RICH_CONSOLE.print(f"[dim cyan]Journal CLI enregistré dans[/] [link=file://{bundle.text_path}]{bundle.text_path}[/link]")
    if dataset_id != dataset_input:
        LOGGER.info("[bold yellow]Dataset identifier normalised[/]: %s → %s", dataset_input, dataset_id)

    try:
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
            dataset_registry.mark_clustered(dataset_id)

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
            dataset_registry.mark_clustered(dataset_id)

        if bundle:
            LOGGER.info("Command logs archived at %s", bundle.text_path)
    finally:
        root_logger = logging.getLogger()
        if bundle:
            try:
                bundle.finalize()
            except Exception:
                LOGGER.exception("Failed to finalize CLI log bundle")
            else:
                bundle_ready = True
                LOGGER.info("HTML log bundle available at %s", bundle.html_path)
        if file_handler:
            root_logger.removeHandler(file_handler)
            file_handler.close()
        if bundle_token:
            reset_log_bundle(bundle_token)
        if bundle and bundle_ready:
            RICH_CONSOLE.print(
                f"[dim cyan]Journal HTML disponible[/] [link=file://{bundle.html_path}]{bundle.html_path}[/link]"
            )

if __name__ == "__main__":
    main()
