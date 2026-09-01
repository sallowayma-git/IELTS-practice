"""M5-03 retrieval pipeline orchestration.

Executes the fixed pipeline order from the engineering plan:

  1. exact stable-ID / entity lookup
  2. scope + activity + skill filters
  3. Python SQLite FTS5 lexical retrieval
  4. provider embedding cosine (only if embeddings present + enabled)
  5. Reciprocal Rank Fusion / deterministic weighted fusion
  6. optional LLM rerank through Rust Model Gateway
  7. ContextPlan selection (delegated to context_planner)

Each stage returns candidates carrying inclusion reasons. Fusion merges them
deterministically; the planner then allocates them into a ContextPlan. No
provider calls unless the caller explicitly enables rerank/embeddings.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from typing import Any, Protocol

from . import fusion, lexical
from .embeddings import EmbedBatchResult
from .index_store import IndexStore
from .rerank import rerank_candidates
from .types import RetrievalCandidate, RetrievalQuery


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


@dataclass(frozen=True, slots=True)
class RetrievalRunConfig:
    """Toggles for the pipeline. Defaults keep retrieval deterministic/offline."""

    enable_embeddings: bool = False   # M5-04; Slice 4 wires actual vectors
    enable_rerank: bool = False        # M5-05; only via eval-gated flag
    max_per_source: int = 3            # diversity cap


@dataclass(frozen=True, slots=True)
class RetrievalResult:
    run_id: str
    candidates: list[RetrievalCandidate]
    fusion_scores: list[fusion.FusionScore]
    elapsed_ms: int
    stages_used: list[str]


def run_retrieval(
    store: IndexStore,
    query: RetrievalQuery,
    *,
    config: RetrievalRunConfig | None = None,
    bridge: HostBridge | None = None,
    trace_id: str | None = None,
    deadline_ms: int = 30000,
) -> RetrievalResult:
    """Run the full retrieval pipeline against the derived index.

    The bridge is only required when rerank or embeddings are enabled. With the
    default config (both off) the pipeline is fully offline and deterministic.
    """
    cfg = config or RetrievalRunConfig()
    run_id = f"rr-{uuid.uuid4().hex[:12]}"
    started = time.monotonic()
    trace = trace_id or run_id
    stages: list[str] = []

    # Step 1: exact stable-ID lookup (highest trust, no scoring).
    exact = lexical.exact_lookup(store, query)
    stages.append("exact_lookup")

    # Step 2+3: scope-filtered FTS5 lexical retrieval.
    lexical_hits = lexical.lexical_search(store, query)
    stages.append("lexical_fts5")
    lexical_filtered = lexical.filter_by_scope(store, query, lexical_hits)
    stages.append("scope_filter")

    # Step 4: embedding cosine — only if a signature exists and caller opts in.
    # The signature is installed by the host gateway response (or a config layer)
    # and persisted in the derived index. Without a signature there is no model
    # identity to match cached vectors against, so embeddings are skipped. This
    # keeps the path available without changing default behaviour: embeddings are
    # off by default, and even when enabled they no-op until a provider endpoint
    # is wired on the Rust side (M5-11 eval gate decides that).
    embedding_hits: list[RetrievalCandidate] = []
    if cfg.enable_embeddings:
        signature = store.embedding_signature()
        if signature is None:
            stages.append("embedding_skipped_no_signature")
        elif bridge is None:
            stages.append("embedding_skipped_no_bridge")
        else:
            try:
                from .embeddings import embed_batch  # local import avoids cycle
                batch = embed_batch(
                    bridge,
                    [query.raw_text],
                    signature=signature,
                    trace_id=trace,
                    deadline_ms=deadline_ms,
                )
                embedding_hits = _embedding_cosine(store, batch, query)
                stages.append("embedding_cosine")
            except Exception:  # noqa: BLE001 — host not_supported/transport failure
                # Fail-closed at the embeddings layer: a provider error (including
                # the default `embedding_not_supported` until a real endpoint is
                # wired) demotes to lexical-only. We never silently fabricate
                # vectors. The planner proceeds with lexical + exact fusion.
                stages.append("embedding_skipped_host_error")

    # Step 5: RRF fusion of [exact, lexical, embedding].
    ranked_lists = [exact, lexical_filtered, embedding_hits]
    scores = fusion.reciprocal_rank_fusion(ranked_lists)
    stages.append("rrf_fusion")
    scores = fusion.apply_time_decay(store, scores)
    stages.append("time_decay")
    scores = fusion.apply_diversity(scores, max_per_source=cfg.max_per_source)
    stages.append("diversity")

    candidates = fusion.finalize_candidates(scores, top_k=query.top_k)

    # Step 6: optional LLM rerank through the host Model Gateway.
    if cfg.enable_rerank and bridge is not None:
        candidates = rerank_candidates(
            bridge,
            query.raw_text,
            candidates,
            trace_id=trace,
            deadline_ms=deadline_ms,
            enabled=True,
        )
        stages.append("rerank_llm")

    elapsed_ms = int((time.monotonic() - started) * 1000)
    return RetrievalResult(
        run_id=run_id,
        candidates=candidates,
        fusion_scores=scores,
        elapsed_ms=elapsed_ms,
        stages_used=stages,
    )


def _embedding_cosine(
    store: IndexStore,
    batch: EmbedBatchResult,
    query: RetrievalQuery,
) -> list[RetrievalCandidate]:
    """Score cached vectors against the query vector via cosine similarity.

    Reads float32 vectors from the derived `embeddings` table. The table is only
    populated once a provider endpoint is wired and the M5-11 eval gate opts in;
    until then it is empty and this returns no candidates. Vectors whose
    declared dimension does not match the batch dimension are skipped so a stale
    model can never silently match (signature reconciliation wipes them, but we
    defend in depth).
    """
    import struct

    conn = store.open()
    rows = conn.execute(
        "SELECT chunk_id, vector, embedding_dimension FROM embeddings"
    ).fetchall()
    if not rows:
        return []
    query_vector = batch.vectors[0] if batch.vectors else []
    dimension = batch.dimension
    if len(query_vector) != dimension:
        return []
    scored: list[tuple[float, str]] = []
    for row in rows:
        blob = row["vector"]
        if blob is None:
            continue
        stored_dim = row["embedding_dimension"]
        if stored_dim != dimension:
            continue
        count = len(blob) // 4
        if count != dimension:
            continue
        stored = list(struct.unpack(f"<{dimension}f", blob))
        similarity = _cosine(query_vector, stored)
        scored.append((similarity, row["chunk_id"]))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    limit = query.top_k
    candidates: list[RetrievalCandidate] = []
    for position, (similarity, chunk_id) in enumerate(scored[:limit]):
        candidates.append(
            RetrievalCandidate(
                chunk_id=chunk_id,
                score=min(1.0, max(0.0, similarity)),
                inclusion_reasons=[f"embedding:cosine:rank{position}"],
            )
        )
    return candidates


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(y * y for y in b) ** 0.5
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


__all__ = [
    "RetrievalRunConfig",
    "RetrievalResult",
    "run_retrieval",
]
