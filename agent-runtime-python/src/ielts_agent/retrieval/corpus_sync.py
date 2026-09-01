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
) -> CorpusManifest:
    started = time.monotonic()
    result = bridge.invoke(
        CAPABILITY_CORPUS_MANIFEST,
        {},
        trace_id=trace_id,
        deadline_ms=deadline_ms,
        started_at=started,
    )
    return CorpusManifest.model_validate(result)


def _parse_chunk(raw: dict[str, Any]) -> CorpusChunk:
    return CorpusChunk.model_validate(raw)


def export_chunks_page(
    bridge: HostBridge,
    *,
    cursor: str | None,
    limit: int,
    trace_id: str,
    deadline_ms: int,
) -> tuple[list[CorpusChunk], str | None]:
    started = time.monotonic()
    params: dict[str, Any] = {"limit": limit}
    if cursor is not None:
        params["cursor"] = cursor
    result = bridge.invoke(
        CAPABILITY_EXPORT_CHUNKS,
        params,
        trace_id=trace_id,
        deadline_ms=deadline_ms,
        started_at=started,
    )
    raw_chunks = result.get("chunks")
    if not isinstance(raw_chunks, list):
        raise ValueError("host export_chunks result missing 'chunks' array")
    chunks = [_parse_chunk(item) for item in raw_chunks]
    next_cursor = result.get("nextCursor")
    if next_cursor is not None and not isinstance(next_cursor, str):
        raise ValueError("host export_chunks nextCursor must be a string or absent")
    return chunks, next_cursor


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
    manifest = fetch_manifest(bridge, trace_id=trace_id, deadline_ms=deadline_ms)
    run_id = store.begin_sync_run(manifest)
    try:
        known = store.known_chunk_hashes()
        added = updated = removed = 0
        seen: set[str] = set()
        cursor: str | None = manifest.export_cursor
        while True:
            chunks, next_cursor = export_chunks_page(
                bridge,
                cursor=cursor,
                limit=page_limit,
                trace_id=trace_id,
                deadline_ms=deadline_ms,
            )
            for chunk in chunks:
                seen.add(chunk.chunk_id)
                prior_hash = known.get(chunk.chunk_id)
                if prior_hash is None:
                    store.upsert_chunk(chunk)
                    added += 1
                elif prior_hash != chunk.content_hash:
                    store.upsert_chunk(chunk)
                    updated += 1
            cursor = next_cursor
            if cursor is None:
                break
        removed = store.prune_to(seen)
        store.finish_sync_run(
            run_id,
            status="ok",
            added=added,
            updated=updated,
            removed=removed,
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
        )
        return SyncResult(
            run_id=run_id,
            added=0,
            updated=0,
            removed=0,
            corpus_version=manifest.corpus_version,
            status="error",
            detail=str(error),
        )


__all__ = ["DEFAULT_PAGE_LIMIT", "HostBridge", "SyncResult", "export_chunks_page", "fetch_manifest", "sync_corpus"]
