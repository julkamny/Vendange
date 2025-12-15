"""Lightweight Postgres connection pool with sane defaults for local dev.

The pool is deliberately thin: it keeps configuration in environment
variables and leaves statement timeouts to `session.py` so each request
can override it when needed (see SRS §9.3).
"""

from __future__ import annotations

import logging
import os
from typing import Optional

from psycopg_pool import ConnectionPool
from psycopg.rows import dict_row

LOGGER = logging.getLogger(__name__)

DEFAULT_DSN = "postgresql://vendange:vendange@localhost:5432/vendange"

# Singleton pool initialized lazily to avoid surprising failures when Postgres
# is not running during import time.
_POOL: Optional[ConnectionPool] = None


def _configure_connection(conn) -> None:
    """Apply per-connection settings."""
    conn.row_factory = dict_row
    # Keep timestamps in UTC to avoid surprises when comparing with app datetimes.
    conn.execute("SET SESSION TIME ZONE 'UTC'")
    statement_timeout_ms = os.getenv("POSTGRES_STATEMENT_TIMEOUT_MS")
    if statement_timeout_ms:
        # Default guardrail; per-request overrides live in session.py
        conn.execute("SET SESSION statement_timeout = %s", (f"{int(statement_timeout_ms)}ms",))
    conn.commit()


def _build_pool() -> ConnectionPool:
    conninfo = os.getenv("POSTGRES_DSN", DEFAULT_DSN)
    min_size = int(os.getenv("POSTGRES_POOL_MIN_SIZE", "1"))
    max_size = int(os.getenv("POSTGRES_POOL_MAX_SIZE", "10"))
    timeout = float(os.getenv("POSTGRES_POOL_TIMEOUT", "10"))

    LOGGER.info(
        "Initializing Postgres pool (min_size=%s, max_size=%s, timeout=%ss)",
        min_size,
        max_size,
        timeout,
    )
    return ConnectionPool(
        conninfo=conninfo,
        min_size=min_size,
        max_size=max_size,
        timeout=timeout,
        configure=_configure_connection,
    )


def get_pool() -> ConnectionPool:
    """Return a process-wide connection pool, creating it on first use."""
    global _POOL
    if _POOL is None:
        _POOL = _build_pool()
    return _POOL


def ping_db() -> bool:
    """Return True if SELECT 1 succeeds, False otherwise."""
    try:
        with get_pool().connection() as conn:
            conn.execute("SELECT 1")
        return True
    except Exception:
        LOGGER.exception("Postgres ping failed")
        return False


def close_pool() -> None:
    """Close the pool (useful in tests)."""
    global _POOL
    if _POOL is not None:
        _POOL.close()
        _POOL = None
