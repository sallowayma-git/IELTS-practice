"""M5-05 optional LLM rerank through the Rust Model Gateway.

Disabled by default. The retrieval eval gate (M5-11) must prove lexical+fusion
insufficient before rerank is enabled in production. When enabled, every model
call goes through `host_bridge.invoke("model.invoke")` — Python never holds the
provider secret and never makes a direct network request.

Clean-room: TechSpa `vector_memory.py:search_memory` re-ranks via LLM in-process
(R2). We instead route through the Rust Model Gateway so usage/latency/trace and
credentials stay host-owned, matching the v1.3 runtime ownership table.
"""

from __future__ import annotations

import time
from typing import Any, Protocol

from .types import RetrievalCandidate


class HostBridge(Protocol):
    def invoke(
        self,
        method: str,
        params: dict[str, Any],
        *,
        trace_id: str,
        deadline_ms: int,
        started_at: float,
    ) -> dict[str, Any]: ...


DEFAULT_RERANK_TOP_K = 20
RERANK_MODEL_CAPABILITY_VERSION = "1"  # host owns model.invoke version; align via handshake


def rerank_candidates(
    bridge: HostBridge,
    query_text: str,
    candidates: list[RetrievalCandidate],
    *,
    trace_id: str,
    deadline_ms: int,
    top_k: int = DEFAULT_RERANK_TOP_K,
    enabled: bool = False,
) -> list[RetrievalCandidate]:
    """Optionally rerank fused candidates with an LLM pass-through.

    When `enabled=False` (default), candidates are returned unchanged in their
    fused order — this keeps retrieval deterministic and provider-free unless
    the eval gate explicitly opts in.

    When enabled, the host is asked to rerank; on any host error we fail back to
    the fused order (never silently drop candidates) and tag the reason.
    """
    if not candidates:
        return []
    if not enabled:
        return candidates[: max(0, top_k)]
    capped = candidates[: max(0, top_k)]
    payload = {
        "query": query_text,
        "candidates": [
            {
                "chunkId": candidate.chunk_id,
                "score": candidate.score,
                "reasons": list(candidate.inclusion_reasons),
            }
            for candidate in capped
        ],
    }
    started = time.monotonic()
    try:
        result = bridge.invoke(
            "model.invoke",
            {
                "task": "rerank",
                "payload": payload,
            },
            trace_id=trace_id,
            deadline_ms=deadline_ms,
            started_at=started,
        )
    except Exception:
        # Provider/transport failure must not corrupt the candidate set. We
        # surface the original fused order and record a fallback reason so the
        # trace shows rerank was attempted-but-failed, not silently skipped.
        return [
            candidate.model_copy(
                update={
                    "inclusion_reasons": [*candidate.inclusion_reasons, "rerank:fallback"]
                }
            )
            for candidate in capped
        ]
    return _apply_rerank_result(capped, result)


def _apply_rerank_result(
    candidates: list[RetrievalCandidate], result: dict[str, Any]
) -> list[RetrievalCandidate]:
    ordering = result.get("ordering")
    if not isinstance(ordering, list):
        return candidates
    by_id = {candidate.chunk_id: candidate for candidate in candidates}
    reranked: list[RetrievalCandidate] = []
    consumed: set[str] = set()
    for entry in ordering:
        cid = entry.get("chunkId") if isinstance(entry, dict) else None
        if not isinstance(cid, str) or cid not in by_id or cid in consumed:
            continue
        original = by_id[cid]
        reranked.append(
            original.model_copy(
                update={"inclusion_reasons": [*original.inclusion_reasons, "rerank:llm"]}
            )
        )
        consumed.add(cid)
    # Append any candidates the host did not order, preserving fused order.
    for candidate in candidates:
        if candidate.chunk_id not in consumed:
            reranked.append(candidate)
    return reranked


__all__ = ["DEFAULT_RERANK_TOP_K", "rerank_candidates"]
