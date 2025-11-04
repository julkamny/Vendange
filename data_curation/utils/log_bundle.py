from __future__ import annotations

import html
import logging
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, TextIO


LOG_TEXT_FORMAT = "%(asctime)s | %(levelname)s | %(name)s | %(message)s"
_CURRENT_BUNDLE: ContextVar["LogBundle | None"] = ContextVar("_CURRENT_LOG_BUNDLE", default=None)


@dataclass
class _LogArtifact:
    identifier: str
    context: str
    relative_path: Path
    absolute_path: Path
    svg_markup: str
    string_variants: tuple[str, ...]


class LogBundle:
    """Collect log records and related artefacts for a single curation run."""

    def __init__(
        self,
        *,
        run_id: str,
        directory: Path,
        text_path: Path,
        html_path: Path,
        assets_path: Path,
    ) -> None:
        self.run_id = run_id
        self.directory = directory
        self.text_path = text_path
        self.html_path = html_path
        self.assets_path = assets_path
        self.assets_path.mkdir(parents=True, exist_ok=True)
        self._text_stream: Optional[TextIO] = None
        self._records: List[dict[str, Optional[str]]] = []
        self._artifacts: Dict[str, _LogArtifact] = {}
        self._finalized = False
        self._created_at = datetime.now(timezone.utc)

    # ------------------------------------------------------------------ context
    def open_text_stream(self) -> TextIO:
        if self._text_stream is None or self._text_stream.closed:
            self.text_path.parent.mkdir(parents=True, exist_ok=True)
            self._text_stream = self.text_path.open("w", encoding="utf-8")
        return self._text_stream

    def close_text_stream(self) -> None:
        if self._text_stream and not self._text_stream.closed:
            self._text_stream.close()

    # ------------------------------------------------------------------ capture
    def add_record(
        self,
        *,
        timestamp: str,
        level: str,
        logger_name: str,
        message: str,
        exception: Optional[str],
    ) -> None:
        self._records.append(
            {
                "timestamp": timestamp,
                "level": level,
                "logger": logger_name,
                "message": message,
                "exception": exception,
            }
        )

    def register_dependency_graph(self, *, context: str, svg_markup: str) -> Path:
        identifier = f"dep-{len(self._artifacts) + 1:03d}"
        relative_path = Path("assets") / f"{identifier}.html"
        absolute_path = (self.directory / relative_path).resolve()
        absolute_path.parent.mkdir(parents=True, exist_ok=True)
        page_markup = (
            "<!DOCTYPE html><html lang='fr'><head><meta charset='utf-8' />"
            f"<title>{html.escape(context)}</title></head><body>"
            f"<h2>{html.escape(context)}</h2>"
            f"{svg_markup}</body></html>"
        )
        absolute_path.write_text(page_markup, encoding="utf-8")
        variants = (str(relative_path), str(absolute_path))
        self._artifacts[str(relative_path)] = _LogArtifact(
            identifier=identifier,
            context=context,
            relative_path=relative_path,
            absolute_path=absolute_path,
            svg_markup=svg_markup,
            string_variants=variants,
        )
        return relative_path

    # ---------------------------------------------------------------- finalize
    def finalize(self) -> None:
        if self._finalized:
            return
        self.close_text_stream()
        self._write_html_report()
        self._finalized = True

    # ---------------------------------------------------------------- internal
    def _write_html_report(self) -> None:
        self.html_path.parent.mkdir(parents=True, exist_ok=True)
        html_content = self._render_html()
        self.html_path.write_text(html_content, encoding="utf-8")

    def _render_html(self) -> str:
        title = f"Vendange log – {self.run_id}"
        generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S %Z")
        lines: List[str] = [
            "<!DOCTYPE html>",
            "<html lang='fr'>",
            "<head>",
            f"<meta charset='utf-8' />",
            f"<title>{html.escape(title)}</title>",
            "<style>",
            self._css(),
            "</style>",
            "</head>",
            "<body>",
            "<header class='log-header'>",
            f"<h1>{html.escape(title)}</h1>",
            f"<p>Généré le {html.escape(generated_at)}.</p>",
            f"<p>Version texte&nbsp;: <code>{html.escape(self.text_path.name)}</code></p>",
            "</header>",
            "<main class='log-entries'>",
        ]
        for index, record in enumerate(self._records, start=1):
            lines.extend(self._render_record(index, record))
        lines.append("</main>")
        if self._artifacts:
            lines.append("<footer class='log-footer'>")
            lines.append("<h2>Références des arbres de dépendances</h2>")
            lines.append("<ul>")
            for artifact in self._artifacts.values():
                lines.append(
                    f"<li><code>{html.escape(str(artifact.relative_path))}</code> – {html.escape(artifact.context)}</li>"
                )
            lines.append("</ul>")
            lines.append("</footer>")
        lines.append("</body></html>")
        return "\n".join(lines)

    def _render_record(self, index: int, record: dict[str, Optional[str]]) -> List[str]:
        attachments = self._artifacts_for_message(record.get("message") or "")
        css_level = (record.get("level") or "INFO").lower()
        timestamp = html.escape(record.get("timestamp") or "")
        logger_name = html.escape(record.get("logger") or "")
        message_html = self._format_message_html(record.get("message") or "", attachments)
        block: List[str] = [
            f"<article class='log-entry log-entry--{css_level}' id='log-{index}'>",
            "<header>",
            f"<span class='log-entry__time'>{timestamp}</span>",
            f"<span class='log-entry__level'>{html.escape(record.get('level') or '')}</span>",
            f"<span class='log-entry__logger'>{logger_name}</span>",
            "</header>",
            f"<p class='log-entry__message'>{message_html}</p>",
        ]
        if record.get("exception"):
            block.append("<pre class='log-entry__exception'>")
            block.append(html.escape(record["exception"]))  # type: ignore[index]
            block.append("</pre>")
        for attachment in attachments:
            block.extend(
                [
                    f"<details class='log-entry__attachment' id='{attachment.identifier}'>",
                    f"<summary>Arbre de dépendances – {html.escape(attachment.context)} "
                    f"(<code>{html.escape(str(attachment.relative_path))}</code> · "
                    f"<a href='{attachment.relative_path.as_posix()}' target='_blank' rel='noopener'>ouvrir</a>)</summary>",
                    "<div class='log-entry__attachment__content'>",
                    attachment.svg_markup,
                    "</div>",
                    "</details>",
                ]
            )
        block.append("</article>")
        return block

    def _artifacts_for_message(self, message: str) -> List[_LogArtifact]:
        if not message:
            return []
        matches: List[_LogArtifact] = []
        for artifact in self._artifacts.values():
            if any(variant in message for variant in artifact.string_variants):
                matches.append(artifact)
        return matches

    def _format_message_html(self, message: str, attachments: Iterable[_LogArtifact]) -> str:
        rendered = html.escape(message).replace("\n", "<br/>")
        for attachment in attachments:
            for variant in attachment.string_variants:
                escaped_variant = html.escape(variant)
                anchor = (
                    f"<a href='#{attachment.identifier}' class='log-entry__attachment-link'>"
                    f"{escaped_variant}</a>"
                )
                if escaped_variant in rendered:
                    rendered = rendered.replace(escaped_variant, anchor, 1)
        return rendered

    @staticmethod
    def _css() -> str:
        return """
:root {
  color-scheme: dark;
  font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
  background-color: #0d1117;
  color: #e6edf3;
}
body {
  margin: 0;
  padding: 2rem;
  line-height: 1.45;
}
a {
  color: #79c0ff;
}
code {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  background: rgba(110, 118, 129, 0.15);
  padding: 0.1rem 0.3rem;
  border-radius: 0.35rem;
}
.log-header {
  margin-bottom: 2rem;
}
.log-header h1 {
  margin: 0 0 0.5rem;
  font-size: 1.8rem;
}
.log-entries {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.log-entry {
  border-left: 4px solid #79c0ff;
  padding: 0.75rem 1rem;
  background: rgba(33, 38, 45, 0.9);
  border-radius: 0.75rem;
  box-shadow: 0 12px 32px rgba(2, 6, 23, 0.35);
}
.log-entry header {
  display: flex;
  gap: 0.75rem;
  font-size: 0.85rem;
  opacity: 0.85;
}
.log-entry__message {
  margin: 0.75rem 0 0;
  font-size: 0.95rem;
  white-space: pre-wrap;
}
.log-entry__exception {
  margin: 0.75rem 0 0;
  padding: 0.75rem;
  border-radius: 0.5rem;
  background: rgba(197, 89, 89, 0.15);
  color: #ffa198;
  overflow-x: auto;
}
.log-entry__attachment {
  margin-top: 0.75rem;
  border-radius: 0.6rem;
  background: rgba(56, 189, 248, 0.08);
  padding: 0.5rem 0.75rem;
}
.log-entry__attachment summary {
  cursor: pointer;
  font-weight: 600;
}
.log-entry__attachment__content {
  margin-top: 0.75rem;
  background: #0b1220;
  padding: 0.75rem;
  border-radius: 0.5rem;
  overflow-x: auto;
}
.log-entry__attachment__content svg {
  width: 100%;
  height: auto;
}
.log-entry--info { border-color: #1f6feb; }
.log-entry--debug { border-color: #a89bff; }
.log-entry--warning { border-color: #f2cc60; }
.log-entry--error { border-color: #ff8080; }
.log-entry__attachment-link {
  font-weight: 600;
}
.log-footer {
  margin-top: 2.5rem;
  border-top: 1px solid rgba(110, 118, 129, 0.3);
  padding-top: 1.5rem;
}
.log-footer ul {
  margin: 0.75rem 0 0;
  padding-left: 1.25rem;
}
"""


# ---------------------------------------------------------------- context helpers
def activate_log_bundle(bundle: LogBundle):
    return _CURRENT_BUNDLE.set(bundle)


def get_current_log_bundle() -> Optional[LogBundle]:
    return _CURRENT_BUNDLE.get()


def reset_log_bundle(token) -> None:
    try:
        _CURRENT_BUNDLE.reset(token)
    except LookupError:
        pass
