"""M5 Python-first retrieval engine (clean-room, derived-only).

Owns the disposable derived retrieval index. Never opens the canonical IELTS
SQLite, never holds provider secrets, never makes direct network requests.
Canonical truth, authorization, final materialization and trace stay in Rust.
"""

from __future__ import annotations

from .context_planner import (
    DEFAULT_BUDGET_RATIOS,
    SECTION_PRIORITY,
    ContextTaskInput,
    build_context_plan,
    rewrite_query,
)
from .corpus_sync import (
    DEFAULT_PAGE_LIMIT,
    SyncResult,
    export_chunks_page,
    fetch_manifest,
    sync_corpus,
)
from .embeddings import (
    CAPABILITY_MODEL_EMBED_BATCH,
    CAPABILITY_VERSION_MODEL_EMBED_BATCH,
    EmbedBatchResult,
    assert_signature_compatible,
    embed_batch,
    install_signature,
)
from .fusion import (
    RRF_K,
    SALIENCE_HALF_LIFE_SECONDS,
    apply_diversity,
    apply_time_decay,
    finalize_candidates,
    reciprocal_rank_fusion,
)
from .index_store import EmbeddingSignature, IndexStore, SCHEMA_DDL
from .lexical import (
    build_fts_query,
    exact_lookup,
    filter_by_scope,
    lexical_search,
    normalize_query,
)
from .planner import RetrievalRunConfig, RetrievalResult, run_retrieval
from .rerank import DEFAULT_RERANK_TOP_K, rerank_candidates
from .types import (
    CAPABILITY_CONTEXT_MATERIALIZE,
    CAPABILITY_CORPUS_MANIFEST,
    CAPABILITY_EXPORT_CHUNKS,
    CAPABILITY_FETCH_CHUNKS,
    CONTEXT_PLAN_SCHEMA_VERSION,
    CONTEXT_PLANNER_VERSION,
    INDEX_SCHEMA_VERSION,
    REQUIRED_RETRIEVAL_HOST_CAPABILITIES,
    ContextPlan,
    ContextSection,
    ContextSectionPlan,
    CorpusChunk,
    CorpusManifest,
    FusionScore,
    RetrievalCandidate,
    RetrievalQuery,
    Sensitivity,
    SourceKind,
)

__all__ = [
    # types
    "CAPABILITY_CONTEXT_MATERIALIZE",
    "CAPABILITY_CORPUS_MANIFEST",
    "CAPABILITY_EXPORT_CHUNKS",
    "CAPABILITY_FETCH_CHUNKS",
    "CONTEXT_PLAN_SCHEMA_VERSION",
    "CONTEXT_PLANNER_VERSION",
    "INDEX_SCHEMA_VERSION",
    "REQUIRED_RETRIEVAL_HOST_CAPABILITIES",
    "ContextPlan",
    "ContextSection",
    "ContextSectionPlan",
    "CorpusChunk",
    "CorpusManifest",
    "FusionScore",
    "RetrievalCandidate",
    "RetrievalQuery",
    "Sensitivity",
    "SourceKind",
    # index
    "EmbeddingSignature",
    "IndexStore",
    "SCHEMA_DDL",
    # sync
    "DEFAULT_PAGE_LIMIT",
    "SyncResult",
    "export_chunks_page",
    "fetch_manifest",
    "sync_corpus",
    # lexical
    "build_fts_query",
    "exact_lookup",
    "filter_by_scope",
    "lexical_search",
    "normalize_query",
    # fusion
    "RRF_K",
    "SALIENCE_HALF_LIFE_SECONDS",
    "apply_diversity",
    "apply_time_decay",
    "finalize_candidates",
    "reciprocal_rank_fusion",
    # rerank
    "DEFAULT_RERANK_TOP_K",
    "rerank_candidates",
    # planner
    "RetrievalRunConfig",
    "RetrievalResult",
    "run_retrieval",
    # context planner
    "DEFAULT_BUDGET_RATIOS",
    "SECTION_PRIORITY",
    "ContextTaskInput",
    "build_context_plan",
    "rewrite_query",
    # embeddings (signature contract only; Slice 4 wires vectors)
    "CAPABILITY_MODEL_EMBED_BATCH",
    "CAPABILITY_VERSION_MODEL_EMBED_BATCH",
    "EmbedBatchResult",
    "assert_signature_compatible",
    "embed_batch",
    "install_signature",
]
