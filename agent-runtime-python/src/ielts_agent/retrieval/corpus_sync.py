"""M5-02 corpus sync — pull canonical chunks into the derived index.

Drives `retrieval.corpus_manifest` + `retrieval.export_chunks(cursor, limit)`
through the generic host bridge `invoke`. Never opens the canonical IELTS DB.
Source content-hash changes invalidate the derived chunk row + its FTS mirror.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Protocol

from .index_store import IndexStore
from .corpus_wire import HostCorpusManifest, HostCorpusPage
from .types import (
    CAPABILITY_CORPUS_MANIFEST,
    CAPABILITY_EXPORT_CHUNKS,
    CorpusChunk,
    CorpusManifest,
)


DEFAULT_PAGE_LIMIT = 200


class HostBridge(Protocol):
    """Minimal host bridge surface this module depends on."""

    def invoke(
        self,
        method: str,
        params: dict[str, Any],
        *,
        trace_id: str,
        deadline_ms: int,
        started_at: float,
    ) -> dict[str, Any]: ...


@dataclass(frozen=True, slots=True)
class SyncResult:
    run_id: int
    added: int
    updated: int
    removed: int
    corpus_version: str
    status: str
    detail: str | None = None


def fetch_manifest(
    bridge: HostBridge,
    *,
    trace_id: str,
    deadline_ms: int,
    started_at: float | None = None,
) -> CorpusManifest:
    started = time.monotonic() if started_at is None else started_at
    result = bridge.invoke(
        CAPABILITY_CORPUS_MANIFEST,
        {},
        trace_id=trace_id,
        deadline_ms=deadline_ms,
        started_at=started,
    )
    return HostCorpusManifest.model_validate(result).to_index()


def export_chunks_page(
    bridge: HostBridge,
    *,
    cursor: str | None,
    limit: int,
    trace_id: str,
    deadline_ms: int,
    started_at: float | None = None,
) -> tuple[list[CorpusChunk], str | None]:
    started = time.monotonic() if started_at is None else started_at
    if not 1 <= limit <= 500:
        raise ValueError("corpus page limit must be between 1 and 500")
    params: dict[str, Any] = {"query": {"limit": limit, "cursor": cursor}}
    result = bridge.invoke(
        CAPABILITY_EXPORT_CHUNKS,
        params,
        trace_id=trace_id,
        deadline_ms=deadline_ms,
        started_at=started,
    )
    page = HostCorpusPage.model_validate(result)
    if page.truncated != (page.next_cursor is not None):
        raise ValueError("corpus pagination cursor/truncated mismatch")
    if len(page.chunks) > limit or page.next_cursor == "":
        raise ValueError("invalid corpus page size or cursor")
    return [chunk.to_index() for chunk in page.chunks], page.next_cursor


def sync_corpus(
    bridge: HostBridge,
    store: IndexStore,
    *,
    trace_id: str,
    deadline_ms: int,
    page_limit: int = DEFAULT_PAGE_LIMIT,
) -> SyncResult:
    """Full or incremental sync of canonical chunks into the derived index.

    Incremental: chunks whose `content_hash` changed are upserted (invalidating
    cached embeddings). Chunks present in canonical but absent locally are added.
    Chunks absent from canonical are pruned (source evicted them).
    """
    started = time.monotonic()
    manifest: CorpusManifest | None = None
    run_id = store.begin_sync_run(None)
    try:
        manifest = fetch_manifest(bridge, trace_id=trace_id, deadline_ms=deadline_ms, started_at=started)
        with store.atomic_sync():
            known = store.known_chunk_hashes()
            added = updated = 0
            seen: set[str] = set()
            cursors: set[str] = set()
            cursor: str | None = None
            while True:
                if (time.monotonic() - started) * 1000 >= deadline_ms:
                    raise TimeoutError("corpus sync deadline exceeded")
                chunks, next_cursor = export_chunks_page(
                    bridge, cursor=cursor, limit=page_limit, trace_id=trace_id,
                    deadline_ms=deadline_ms, started_at=started,
                )
                for chunk in chunks:
                    if chunk.chunk_id in seen:
                        raise ValueError("duplicate corpus chunk ID")
                    seen.add(chunk.chunk_id)
                    prior_hash = known.get(chunk.chunk_id)
                    if prior_hash is None:
                        store.upsert_chunk(chunk)
                        added += 1
                    elif prior_hash != chunk.content_hash:
                        store.upsert_chunk(chunk)
                        updated += 1
                if len(seen) > manifest.chunk_count:
                    raise ValueError("corpus export count exceeds manifest")
                if next_cursor is None:
                    break
                if not chunks or next_cursor in cursors:
                    raise ValueError("corpus pagination made no progress")
                cursors.add(next_cursor)
                cursor = next_cursor
            if len(seen) != manifest.chunk_count:
                raise ValueError("corpus export count differs from manifest; refusing prune")
            removed = store.prune_to(seen)
        store.finish_sync_run(
            run_id,
            status="ok",
            added=added,
            updated=updated,
            removed=removed,
            corpus_version=manifest.corpus_version,
        )
        return SyncResult(
            run_id=run_id,
            added=added,
            updated=updated,
            removed=removed,
            corpus_version=manifest.corpus_version,
            status="ok",
        )
    except Exception as error:  # noqa: BLE001 — sync failure is audited, not fatal
        store.finish_sync_run(
            run_id,
            status="error",
            added=0,
            updated=0,
            removed=0,
            detail=str(error),
            corpus_version=manifest.corpus_version if manifest else None,
        )
        return SyncResult(
            run_id=run_id,
            added=0,
            updated=0,
            removed=0,
            corpus_version=manifest.corpus_version if manifest else "unknown",
            status="error",
            detail=str(error),
        )


__all__ = ["DEFAULT_PAGE_LIMIT", "HostBridge", "SyncResult", "export_chunks_page", "fetch_manifest", "sync_corpus"]
