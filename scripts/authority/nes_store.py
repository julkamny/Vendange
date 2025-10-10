# scripts/authority/nes_store.py
from __future__ import annotations
import sqlite3
from typing import Iterable, List, Optional
from pathlib import Path
import time

class NESStore:
    """
    KV-store SQLite très simple :
      - table person(ark PRIMARY KEY, fetched_at)
      - table variant(ark, variant TEXT, UNIQUE(ark, variant))
    """
    def __init__(self, db_path: str = ".nes_cache.sqlite"):
        self.db_path = db_path
        self._ensure_schema()

    def _conn(self) -> sqlite3.Connection:
        return sqlite3.connect(self.db_path)

    def _ensure_schema(self) -> None:
        Path(self.db_path).touch(exist_ok=True)
        with self._conn() as c:
            c.execute("""CREATE TABLE IF NOT EXISTS person(
                ark TEXT PRIMARY KEY,
                fetched_at REAL
            )""")
            c.execute("""CREATE TABLE IF NOT EXISTS variant(
                ark TEXT,
                variant TEXT,
                UNIQUE(ark, variant)
            )""")

    def has_ark(self, ark: str) -> bool:
        with self._conn() as c:
            row = c.execute("SELECT 1 FROM person WHERE ark=?", (ark,)).fetchone()
            return row is not None

    def put_variants(self, ark: str, variants: Iterable[str]) -> None:
        now = time.time()
        with self._conn() as c:
            c.execute("INSERT OR REPLACE INTO person(ark, fetched_at) VALUES(?,?)", (ark, now))
            c.executemany("INSERT OR IGNORE INTO variant(ark, variant) VALUES(?,?)", [(ark, v) for v in variants])

    def get_variants(self, ark: str) -> List[str]:
        with self._conn() as c:
            rows = c.execute("SELECT variant FROM variant WHERE ark=? ORDER BY rowid ASC", (ark,)).fetchall()
        # print(*[r[0] for r in rows], sep="\n")
        return [r[0] for r in rows]
