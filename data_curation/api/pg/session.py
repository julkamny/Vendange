"""Context helpers for Postgres access."""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator, Optional, TypeAlias, cast

from psycopg import Connection, sql

from .pool import get_pool


RowDict: TypeAlias = dict[str, Any]
DbConnection: TypeAlias = Connection[RowDict]


def _format_timeout(timeout_ms: int) -> str:
    return f"{int(timeout_ms)}ms"


def _db_session(*, statement_timeout_ms: Optional[int] = None) -> Iterator[DbConnection]:
    """Yield a pooled connection with an optional per-session statement_timeout."""
    pool = get_pool()
    with pool.connection() as conn:
        conn = cast(DbConnection, conn)
        if statement_timeout_ms is not None:
            conn.execute("SET LOCAL statement_timeout = %s", (_format_timeout(statement_timeout_ms),))
        yield conn


db_session = contextmanager(_db_session)


def _statement_timeout(conn: DbConnection, timeout_ms: int) -> Iterator[None]:
    """Temporarily enforce a statement timeout within an existing transaction."""
    conn.execute(
        sql.SQL("SET LOCAL statement_timeout = {}").format(sql.Literal(_format_timeout(timeout_ms)))
    )
    yield


statement_timeout = contextmanager(_statement_timeout)
