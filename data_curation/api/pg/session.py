"""Context helpers for Postgres access."""

from __future__ import annotations

from contextlib import contextmanager
from typing import Generator, Optional

from psycopg import Connection

from .pool import get_pool


def _format_timeout(timeout_ms: int) -> str:
    return f"{int(timeout_ms)}ms"


@contextmanager
def db_session(*, statement_timeout_ms: Optional[int] = None) -> Generator[Connection, None, None]:
    """Yield a pooled connection with an optional per-session statement_timeout."""
    pool = get_pool()
    with pool.connection() as conn:
        if statement_timeout_ms is not None:
            conn.execute("SET LOCAL statement_timeout = %s", (_format_timeout(statement_timeout_ms),))
        yield conn


@contextmanager
def statement_timeout(conn: Connection, timeout_ms: int) -> Generator[None, None, None]:
    """Temporarily enforce a statement timeout within an existing transaction."""
    conn.execute("SET LOCAL statement_timeout = %s", (_format_timeout(timeout_ms),))
    yield
