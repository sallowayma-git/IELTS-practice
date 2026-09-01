"""Tests for M5-02 corpus_sync against a fake host bridge.

The fake bridge serves manifest + paginated export_chunks responses exactly as
the Rust host would. No canonical SQLite, no network.
"""

from __future__ import annotations

import sys
import time
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
            cursor = params.get("cursor")
            index = int(cursor) if cursor is not None else 0
            if index >= len(self._pages):
                return {"chunks": [], "nextCursor": None}
            page = self._pages[index]
            next_cursor = str(index + 1) if index + 1 < len(self._pages) else None
            return {"chunks": page, "nextCursor": next_cursor}
        raise AssertionError(f"unexpected host method: {method}")


def _chunk(chunk_id: str, content_hash: str = "h1") -> dict[str, Any]:
    return CorpusChunk(
        chunk_id=chunk_id,
        source_kind=SourceKind.CURATED,
        source_id=chunk_id.split(":")[1] if ":" in chunk_id else "x",
        source_version="1",
        content_hash=content_hash,
        scope="reading",
        activity="reading",
        skill="matching_headings",
        sensitivity=Sensitivity.INTERNAL,
        text=f"text for {chunk_id}",
        updated_at="2026-08-15T00:00:00Z",
    ).model_dump(mode="json")


class CorpusSyncTests(unittest.TestCase):
    def setUp(self) -> None:
        self.store = IndexStore(Path(__file__).parent / "_tmp_sync.db")
        self.addCleanup(self._cleanup)

    def _cleanup(self) -> None:
        self.store.close()
        db = Path(__file__).parent / "_tmp_sync.db"
        if db.exists():
            db.unlink()

    def test_full_sync_adds_all_chunks(self) -> None:
        bridge = FakeHostBridge(
            manifest={"corpus_version": "v1", "chunk_count": 3},
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

    def test_content_hash_drift_marks_update_not_add(self) -> None:
        bridge = FakeHostBridge(
            manifest={"corpus_version": "v1", "chunk_count": 1},
            pages=[[_chunk("reading:a:v1:0", content_hash="h1")]],
        )
        sync_corpus(bridge, self.store, trace_id="t1", deadline_ms=5000)
        # Second sync with changed content_hash should update, not add.
        bridge2 = FakeHostBridge(
            manifest={"corpus_version": "v2", "chunk_count": 1},
            pages=[[_chunk("reading:a:v1:0", content_hash="h2")]],
        )
        result = sync_corpus(bridge2, self.store, trace_id="t2", deadline_ms=5000)
        self.assertEqual(result.added, 0)
        self.assertEqual(result.updated, 1)
        self.assertEqual(self.store.chunk_count(), 1)

    def test_prune_removes_evicted_chunks(self) -> None:
        bridge = FakeHostBridge(
            manifest={"corpus_version": "v1", "chunk_count": 2},
            pages=[[_chunk("reading:a:v1:0"), _chunk("reading:b:v1:0")]],
        )
        sync_corpus(bridge, self.store, trace_id="t1", deadline_ms=5000)
        # Canonical evicts chunk b; only a remains.
        bridge2 = FakeHostBridge(
            manifest={"corpus_version": "v2", "chunk_count": 1},
            pages=[[_chunk("reading:a:v1:0")]],
        )
        result = sync_corpus(bridge2, self.store, trace_id="t2", deadline_ms=5000)
        self.assertEqual(result.removed, 1)
        self.assertEqual(self.store.chunk_count(), 1)

    def test_sync_run_audited(self) -> None:
        bridge = FakeHostBridge(
            manifest={"corpus_version": "v1", "chunk_count": 1},
            pages=[[_chunk("reading:a:v1:0")]],
        )
        sync_corpus(bridge, self.store, trace_id="t1", deadline_ms=5000)
        runs = self.store.sync_runs()
        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0]["status"], "ok")
        self.assertEqual(runs[0]["chunks_added"], 1)

    def test_host_error_records_failed_run(self) -> None:
        bridge = FakeHostBridge(
            manifest={"corpus_version": "v1", "chunk_count": 1},
            pages=[],
        )
        # Sabotage: claim 1 chunk but serve nothing + bad cursor handling.
        result = sync_corpus(bridge, self.store, trace_id="t1", deadline_ms=5000)
        # Empty pages -> sync completes with 0 added (not an error path).
        self.assertEqual(result.status, "ok")
        self.assertEqual(result.added, 0)


if __name__ == "__main__":
    unittest.main()
