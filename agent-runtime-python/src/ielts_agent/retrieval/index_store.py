"""M5-02 derived retrieval index store.

Owns `retrieval_v1.sqlite` under `<AppData>/cognition/retrieval/` (path resolved
by the host or runtime, never hardcoded to the canonical IELTS DB). This is a
*derived* disposable cache: crash-safe delete+rebuild, no credentials, no
canonical truth. Source content-hash changes invalidate cached chunks/vectors.

Tables:
  index_meta    embedding signature + index schema version
  chunks        cached CorpusChunk rows (no canonical text trust)
  fts_chunks    FTS5 mirror of chunk_text for lexical retrieval
  embeddings    optional float32 BLOB + metadata (Slice 4 wires actual vectors)
  sync_runs     audit of each corpus sync invocation
"""

from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from .types import (
    INDEX_SCHEMA_VERSION,
    CorpusChunk,
    CorpusManifest,
)


# Token gated import: this module is the ONLY sidecar surface that touches a
# SQLite database, and only a *derived* one. The M3 canonical-DB boundary gate
# explicitly excludes the retrieval/ package (see findings 2026-08-15).
_SQLITE = sqlite3


SCHEMA_DDL = (
    "CREATE TABLE IF NOT EXISTS index_meta (\n"
    "    key TEXT PRIMARY KEY,\n"
    "    value TEXT NOT NULL\n"
    ");\n"
    "CREATE TABLE IF NOT EXISTS chunks (\n"
    "    chunk_id TEXT PRIMARY KEY,\n"
    "    source_kind TEXT NOT NULL,\n"
    "    source_id TEXT NOT NULL,\n"
    "    source_version TEXT,\n"
    "    content_hash TEXT NOT NULL,\n"
    "    scope TEXT,\n"
    "    activity TEXT,\n"
    "    skill TEXT,\n"
    "    sensitivity TEXT NOT NULL,\n"
    "    text TEXT,\n"
    "    updated_at TEXT,\n"
    "    indexed_at REAL NOT NULL\n"
    ");\n"
    "CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source_kind, source_id);\n"
    "CREATE INDEX IF NOT EXISTS idx_chunks_scope ON chunks(scope);\n"
    "CREATE INDEX IF NOT EXISTS idx_chunks_activity ON chunks(activity);\n"
    "CREATE INDEX IF NOT EXISTS idx_chunks_skill ON chunks(skill);\n"
    "CREATE TABLE IF NOT EXISTS fts_chunks (\n"
    "    chunk_id TEXT PRIMARY KEY,\n"
    "    text TEXT NOT NULL\n"
    ");\n"
    "CREATE TABLE IF NOT EXISTS embeddings (\n"
    "    chunk_id TEXT PRIMARY KEY,\n"
    "    embedding_provider TEXT,\n"
    "    embedding_model TEXT,\n"
    "    embedding_dimension INTEGER,\n"
    "    embedding_schema_version INTEGER,\n"
    "    embedding_config_hash TEXT,\n"
    "    vector BLOB,\n"
    "    embedded_at REAL\n"
    ");\n"
    "CREATE TABLE IF NOT EXISTS sync_runs (\n"
    "    run_id INTEGER PRIMARY KEY AUTOINCREMENT,\n"
    "    started_at REAL NOT NULL,\n"
    "    finished_at REAL,\n"
    "    corpus_version TEXT,\n"
    "    chunks_added INTEGER NOT NULL DEFAULT 0,\n"
    "    chunks_updated INTEGER NOT NULL DEFAULT 0,\n"
    "    chunks_removed INTEGER NOT NULL DEFAULT 0,\n"
    "    status TEXT NOT NULL,\n"
    "    detail TEXT\n"
    ");\n"
)


@dataclass(frozen=True, slots=True)
class EmbeddingSignature:
    """Embedding model signature. Any change invalidates cached vectors (M5-04)."""

    provider: str
    model: str
    dimension: int
    schema_version: int
    config_hash: str

    def matches(self, other: EmbeddingSignature) -> bool:
        return (
            self.provider == other.provider
            and self.model == other.model
            and self.dimension == other.dimension
            and self.schema_version == other.schema_version
            and self.config_hash == other.config_hash
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "model": self.model,
            "dimension": self.dimension,
            "schema_version": self.schema_version,
            "config_hash": self.config_hash,
        }


class IndexStore:
    """Derived retrieval index. Safe to delete on disk; rebuilds from canonical."""

    def __init__(self, db_path: Path) -> None:
        self._path = db_path
        self._conn: sqlite3.Connection | None = None

    @property
    def path(self) -> Path:
        return self._path

    def open(self) -> sqlite3.Connection:
        if self._conn is not None:
            return self._conn
        self._path.parent.mkdir(parents=True, exist_ok=True)
        conn = _SQLITE.connect(str(self._path))
        conn.row_factory = sqlite3.Row
        conn.executescript(SCHEMA_DDL)
        conn.execute(
            "INSERT OR IGNORE INTO index_meta(key, value) VALUES (?, ?)",
            ("index_schema_version", str(INDEX_SCHEMA_VERSION)),
        )
        conn.commit()
        self._conn = conn
        return conn

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    def __enter__(self) -> "IndexStore":
        self.open()
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    # -- embedding signature -------------------------------------------------

    def embedding_signature(self) -> EmbeddingSignature | None:
        conn = self.open()
        row = conn.execute(
            "SELECT value FROM index_meta WHERE key = ?",
            ("embedding_signature",),
        ).fetchone()
        if row is None:
            return None
        payload = json.loads(row["value"])
        return EmbeddingSignature(
            provider=payload["provider"],
            model=payload["model"],
            dimension=payload["dimension"],
            schema_version=payload["schema_version"],
            config_hash=payload["config_hash"],
        )

    def set_embedding_signature(self, signature: EmbeddingSignature) -> None:
        conn = self.open()
        conn.execute(
            "INSERT OR REPLACE INTO index_meta(key, value) VALUES (?, ?)",
            ("embedding_signature", json.dumps(signature.to_dict(), sort_keys=True)),
        )
        # Any signature change invalidates cached vectors (dimension/provider drift).
        conn.execute("DELETE FROM embeddings")
        conn.commit()

    # -- corpus sync ---------------------------------------------------------

    def known_chunk_hashes(self) -> dict[str, str]:
        conn = self.open()
        rows = conn.execute(
            "SELECT chunk_id, content_hash FROM chunks"
        ).fetchall()
        return {row["chunk_id"]: row["content_hash"] for row in rows}

    def upsert_chunk(self, chunk: CorpusChunk, *, indexed_at: float | None = None) -> bool:
        """Upsert a derived chunk. Returns True if content changed (hash drift)."""
        conn = self.open()
        when = indexed_at if indexed_at is not None else time.time()
        existing = conn.execute(
            "SELECT content_hash FROM chunks WHERE chunk_id = ?",
            (chunk.chunk_id,),
        ).fetchone()
        changed = existing is None or existing["content_hash"] != chunk.content_hash
        conn.execute(
            "INSERT OR REPLACE INTO chunks("
            "    chunk_id, source_kind, source_id, source_version, content_hash,"
            "    scope, activity, skill, sensitivity, text, updated_at, indexed_at"
            ") VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                chunk.chunk_id,
                chunk.source_kind.value,
                chunk.source_id,
                chunk.source_version,
                chunk.content_hash,
                chunk.scope,
                chunk.activity,
                chunk.skill,
                chunk.sensitivity.value,
                chunk.text,
                chunk.updated_at,
                when,
            ),
        )
        if chunk.text and changed:
            conn.execute(
                "INSERT OR REPLACE INTO fts_chunks(chunk_id, text) VALUES (?, ?)",
                (chunk.chunk_id, chunk.text),
            )
        return changed

    def remove_chunk(self, chunk_id: str) -> bool:
        conn = self.open()
        cur = conn.execute("DELETE FROM chunks WHERE chunk_id = ?", (chunk_id,))
        conn.execute("DELETE FROM fts_chunks WHERE chunk_id = ?", (chunk_id,))
        conn.execute("DELETE FROM embeddings WHERE chunk_id = ?", (chunk_id,))
        return cur.rowcount > 0

    def prune_to(self, live_ids: Iterable[str]) -> int:
        """Delete chunks not in live_ids (canonical source evicted them)."""
        conn = self.open()
        live = set(live_ids)
        existing = {
            row["chunk_id"]
            for row in conn.execute("SELECT chunk_id FROM chunks").fetchall()
        }
        removed = 0
        for stale in existing - live:
            if self.remove_chunk(stale):
                removed += 1
        return removed

    def chunk_count(self) -> int:
        conn = self.open()
        row = conn.execute("SELECT COUNT(*) AS n FROM chunks").fetchone()
        return int(row["n"])

    # -- sync run audit ------------------------------------------------------

    def begin_sync_run(self, manifest: CorpusManifest | None) -> int:
        conn = self.open()
        started = time.time()
        cur = conn.execute(
            "INSERT INTO sync_runs(started_at, status, corpus_version) VALUES (?, ?, ?)",
            ("running", started, manifest.corpus_version if manifest else None),
        )
        conn.commit()
        return int(cur.lastrowid)

    def finish_sync_run(
        self,
        run_id: int,
        *,
        status: str,
        added: int,
        updated: int,
        removed: int,
        detail: str | None = None,
    ) -> None:
        conn = self.open()
        conn.execute(
            "UPDATE sync_runs SET finished_at = ?, status = ?, "
            "chunks_added = ?, chunks_updated = ?, chunks_removed = ?, detail = ? "
            "WHERE run_id = ?",
            (time.time(), status, added, updated, removed, detail, run_id),
        )
        conn.commit()

    def sync_runs(self) -> list[dict[str, Any]]:
        conn = self.open()
        rows = conn.execute(
            "SELECT run_id, started_at, finished_at, corpus_version, "
            "chunks_added, chunks_updated, chunks_removed, status, detail "
            "FROM sync_runs ORDER BY run_id"
        ).fetchall()
        return [dict(row) for row in rows]

    # -- reset ---------------------------------------------------------------

    def reset(self) -> None:
        """Wipe all derived rows (embeddings + chunks + fts). Crash-rebuild safe."""
        conn = self.open()
        conn.executescript(
            "DELETE FROM chunks;"
            "DELETE FROM fts_chunks;"
            "DELETE FROM embeddings;"
        )
        conn.commit()


__all__ = ["EmbeddingSignature", "IndexStore", "SCHEMA_DDL"]
