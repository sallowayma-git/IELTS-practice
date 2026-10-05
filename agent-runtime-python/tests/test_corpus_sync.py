"""Tests for M5-02 corpus_sync against a fake host bridge.

The fake bridge serves manifest + paginated export_chunks responses exactly as
the Rust host would. No canonical SQLite, no network.
"""

from __future__ import annotations

import sys
import time
import tempfile
import sqlite3
import unittest
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from ielts_agent.retrieval import (
    CorpusChunk,
    IndexStore,
    Sensitivity,
    SourceKind,
    sync_corpus,
)


class FakeHostBridge:
    """Serves manifest + paginated chunks. Records calls for assertions."""

    def __init__(
        self,
        manifest: dict[str, Any],
        pages: list[list[dict[str, Any]]],
    ) -> None:
        self._manifest = manifest
        self._pages = pages
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def invoke(
        self,
        method: str,
        params: dict[str, Any],
        *,
        trace_id: str,
        deadline_ms: int,
        started_at: float,
    ) -> dict[str, Any]:
        self.calls.append((method, dict(params)))
        if method == "retrieval.corpus_manifest":
            return dict(self._manifest)
        if method == "retrieval.export_chunks":
            cursor = params["query"].get("cursor")
            index = int(cursor) if cursor is not None else 0
            if index >= len(self._pages):
                return _page([], None)
            page = self._pages[index]
            next_cursor = str(index + 1) if index + 1 < len(self._pages) else None
            return _page(page, next_cursor)
        raise AssertionError(f"unexpected host method: {method}")


def _chunk(chunk_id: str, content_hash: str = "h1") -> dict[str, Any]:
    return {
        "chunkId": chunk_id, "sourceKind": "reading_asset",
        "sourceId": chunk_id.split(":")[1], "sourceVersion": 1,
        "activity": "reading", "contentHash": content_hash,
        "sensitivity": "normal", "text": f"text for {chunk_id}",
        "updatedAt": "2026-08-15T00:00:00Z",
    }


def _manifest(count: int) -> dict[str, Any]:
    return {"schemaVersion": 1, "chunkingVersion": 1,
            "generatedAt": "2026-08-15T00:00:00Z", "assetCount": count,
            "chunkCount": count, "sourceKinds": ["reading_asset", "writing_topic"]}


def _page(chunks, cursor):
    return {"schemaVersion": 1, "chunkingVersion": 1,
            "generatedAt": "2026-08-15T00:00:00Z", "chunks": chunks,
            "nextCursor": cursor, "truncated": cursor is not None}


class CorpusSyncTests(unittest.TestCase):
    def setUp(self) -> None:
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.store = IndexStore(Path(temp.name) / "sync.db")
        self.addCleanup(self.store.close)

    def test_full_sync_adds_all_chunks(self) -> None:
        bridge = FakeHostBridge(
            manifest=_manifest(3),
            pages=[
                [_chunk("reading:a:v1:0"), _chunk("reading:b:v1:0")],
                [_chunk("reading:c:v1:0")],
            ],
        )
        result = sync_corpus(
            bridge,
            self.store,
            trace_id="t1",
            deadline_ms=5000,
            page_limit=2,
        )
        self.assertEqual(result.status, "ok")
        self.assertEqual(result.added, 3)
        self.assertEqual(self.store.chunk_count(), 3)
        row = self.store.open().execute("SELECT * FROM chunks LIMIT 1").fetchone()
        self.assertEqual(row["source_kind"], "curated")
        self.assertEqual(row["source_version"], "1")
        self.assertEqual(row["sensitivity"], "internal")
        self.assertEqual(bridge.calls[1][1], {"query": {"limit": 2, "cursor": None}})

    def test_content_hash_drift_marks_update_not_add(self) -> None:
        bridge = FakeHostBridge(
            manifest=_manifest(1),
            pages=[[_chunk("reading:a:v1:0", content_hash="h1")]],
        )
        sync_corpus(bridge, self.store, trace_id="t1", deadline_ms=5000)
        # Second sync with changed content_hash should update, not add.
        bridge2 = FakeHostBridge(
            manifest=_manifest(1),
            pages=[[_chunk("reading:a:v1:0", content_hash="h2")]],
        )
        result = sync_corpus(bridge2, self.store, trace_id="t2", deadline_ms=5000)
        self.assertEqual(result.added, 0)
        self.assertEqual(result.updated, 1)
        self.assertEqual(self.store.chunk_count(), 1)

    def test_prune_removes_evicted_chunks(self) -> None:
        bridge = FakeHostBridge(
            manifest=_manifest(2),
            pages=[[_chunk("reading:a:v1:0"), _chunk("reading:b:v1:0")]],
        )
        sync_corpus(bridge, self.store, trace_id="t1", deadline_ms=5000)
        # Canonical evicts chunk b; only a remains.
        bridge2 = FakeHostBridge(
            manifest=_manifest(1),
            pages=[[_chunk("reading:a:v1:0")]],
        )
        result = sync_corpus(bridge2, self.store, trace_id="t2", deadline_ms=5000)
        self.assertEqual(result.removed, 1)
        self.assertEqual(self.store.chunk_count(), 1)

    def test_sync_run_audited(self) -> None:
        bridge = FakeHostBridge(
            manifest=_manifest(1),
            pages=[[_chunk("reading:a:v1:0")]],
        )
        sync_corpus(bridge, self.store, trace_id="t1", deadline_ms=5000)
        runs = self.store.sync_runs()
        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0]["status"], "ok")
        self.assertEqual(runs[0]["chunks_added"], 1)
        self.assertIsInstance(runs[0]["started_at"], float)
        self.assertEqual(runs[0]["corpus_version"], "schema-1:chunking-1")

    def test_host_error_records_failed_run(self) -> None:
        bridge = FakeHostBridge(
            manifest=_manifest(1),
            pages=[],
        )
        # Sabotage: claim 1 chunk but serve nothing + bad cursor handling.
        result = sync_corpus(bridge, self.store, trace_id="t1", deadline_ms=5000)
        self.assertEqual(result.status, "error")
        self.assertEqual(result.added, 0)
        self.assertEqual(self.store.sync_runs()[0]["status"], "error")

    def test_invalid_manifest_is_audited(self):
        result = sync_corpus(FakeHostBridge({"corpus_version": "fake"}, []),
                             self.store, trace_id="t", deadline_ms=5000)
        self.assertEqual(result.status, "error")
        self.assertEqual(self.store.sync_runs()[0]["status"], "error")

    def test_second_page_failure_preserves_all_old_index_rows(self):
        sync_corpus(FakeHostBridge(_manifest(1), [[_chunk("reading:a:v1:0")]]),
                    self.store, trace_id="t", deadline_ms=5000)
        conn = self.store.open()
        conn.execute("INSERT INTO embeddings(chunk_id, vector) VALUES (?, ?)",
                     ("reading:a:v1:0", b"old-vector"))
        conn.commit()
        before = {table: [tuple(row) for row in conn.execute(f"SELECT * FROM {table}")]
                  for table in ("chunks", "fts_chunks", "embeddings")}
        invalid = _chunk("reading:b:v1:0")
        invalid["sourceVersion"] = "1"  # Rust wire is integer, not coercible.
        result = sync_corpus(FakeHostBridge(_manifest(2), [
            [_chunk("reading:a:v1:0", "new")], [invalid]]), self.store,
            trace_id="t", deadline_ms=5000, page_limit=1)
        self.assertEqual(result.status, "error")
        for table, rows in before.items():
            self.assertEqual([tuple(row) for row in conn.execute(f"SELECT * FROM {table}")], rows)
        self.assertEqual(self.store.sync_runs()[-1]["chunks_updated"], 0)

    def test_count_mismatch_does_not_prune(self):
        sync_corpus(FakeHostBridge(_manifest(1), [[_chunk("reading:a:v1:0")]]),
                    self.store, trace_id="t", deadline_ms=5000)
        result = sync_corpus(FakeHostBridge(_manifest(2), [[]]), self.store,
                             trace_id="t", deadline_ms=5000)
        self.assertEqual(result.status, "error")
        self.assertEqual(self.store.chunk_count(), 1)

    def test_savepoint_commit_failure_rolls_back_before_error_audit(self):
        sync_corpus(FakeHostBridge(_manifest(1), [[_chunk("reading:a:v1:0")]]),
                    self.store, trace_id="t", deadline_ms=5000)
        conn = self.store.open()
        conn.execute("INSERT INTO embeddings(chunk_id,vector) VALUES (?,?)", ("reading:a:v1:0", b"old"))
        conn.commit()
        before = {table: [tuple(row) for row in conn.execute(f"SELECT * FROM {table}")]
                  for table in ("chunks", "fts_chunks", "embeddings")}
        denied = []
        def deny_first_release(action, argument, *_):
            if action == sqlite3.SQLITE_SAVEPOINT and argument == "RELEASE" and not denied:
                denied.append(True)
                return sqlite3.SQLITE_DENY
            return sqlite3.SQLITE_OK
        conn.set_authorizer(deny_first_release)
        self.addCleanup(conn.set_authorizer, None)
        result = sync_corpus(FakeHostBridge(_manifest(1), [[_chunk("reading:a:v1:0", "new")]]),
                             self.store, trace_id="t", deadline_ms=5000)
        self.assertTrue(denied)
        self.assertEqual(result.status, "error")
        self.assertFalse(conn.in_transaction)
        for table, rows in before.items():
            self.assertEqual([tuple(row) for row in conn.execute(f"SELECT * FROM {table}")], rows)
        self.assertEqual(self.store.sync_runs()[-1]["status"], "error")

    def test_changed_empty_text_invalidates_fts_and_embeddings(self):
        sync_corpus(FakeHostBridge(_manifest(1), [[_chunk("reading:a:v1:0")]]),
                    self.store, trace_id="t", deadline_ms=5000)
        conn = self.store.open()
        conn.execute("INSERT INTO embeddings(chunk_id) VALUES ('reading:a:v1:0')")
        conn.commit()
        chunk = _chunk("reading:a:v1:0", "new")
        chunk["text"] = ""
        result = sync_corpus(FakeHostBridge(_manifest(1), [[chunk]]), self.store,
                             trace_id="t", deadline_ms=5000)
        self.assertEqual(result.status, "ok")
        for table in ("fts_chunks", "embeddings"):
            self.assertEqual(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0], 0)

    def test_duplicate_ids_and_cursor_cycle_are_rejected(self):
        bridge = FakeHostBridge(_manifest(2), [[_chunk("reading:a:v1:0")],
                                              [_chunk("reading:a:v1:0")]])
        result = sync_corpus(bridge, self.store, trace_id="t", deadline_ms=5000, page_limit=1)
        self.assertEqual(result.status, "error")
        self.assertEqual(self.store.chunk_count(), 0)
        class CycleBridge(FakeHostBridge):
            def invoke(self, method, params, **kwargs):
                if method == "retrieval.export_chunks":
                    cursor = params["query"]["cursor"]
                    return _page([_chunk("reading:a:v1:0" if cursor is None else "reading:b:v1:0")], "same")
                return super().invoke(method, params, **kwargs)
        result = sync_corpus(CycleBridge(_manifest(3), []), self.store,
                             trace_id="t", deadline_ms=5000, page_limit=1)
        self.assertEqual(result.status, "error")
        self.assertIn("progress", result.detail)
        self.assertEqual(self.store.chunk_count(), 0)


if __name__ == "__main__":
    unittest.main()
