"""M5-04 embedding signature + invalidation + host gateway wiring.

Python never holds the provider secret. Embeddings are requested through the
Rust host gateway (`model.embed.batch`, wired in Slice 4). This module owns the
*signature* contract: any change to provider/model/dimension/schema/config
invalidates every cached vector so stale vectors can never silently match.

Clean-room from TechSpa `vector_memory.py:rebuild_index_from_profile` (R2) and
`routers/settings.py` embedding-model-change (R1): we keep the invalidate-on-
signature-drift idea but drive it from canonical Rust truth, not a mutable
profile.json. The plan forbids defaulting to vectorization, so `embed_batch` is
only called when a caller explicitly enables embeddings AND a provider
endpoint is wired on the Rust side. If the host reports `embedding_not_supported`
we fail closed — the planner decides whether to fall back to lexical, not here.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Protocol

from .index_store import EmbeddingSignature, IndexStore


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


# Capability + version placeholders. Slice 4 aligns these with the Rust host's
# declared `model.embed.batch` capability version.
CAPABILITY_MODEL_EMBED_BATCH = "model.embed.batch"
CAPABILITY_VERSION_MODEL_EMBED_BATCH = "1"


@dataclass(frozen=True, slots=True)
class EmbedBatchResult:
    """Result of an embedding batch request. Slice 4 populates vectors."""

    request_id: str
    dimension: int
    vectors: list[list[float]]
    signature: EmbeddingSignature
    usage: dict[str, Any]


def assert_signature_compatible(
    store: IndexStore,
    desired: EmbeddingSignature,
) -> bool:
    """Return True iff the cached embedding signature matches `desired`.

    On mismatch the caller is responsible for invalidating + rebuilding. We do
    not auto-wipe here so callers can decide whether to rebuild or error out.
    """
    cached = store.embedding_signature()
    if cached is None:
        return False
    return cached.matches(desired)


def install_signature(store: IndexStore, signature: EmbeddingSignature) -> None:
    """Persist the embedding signature, invalidating all cached vectors.

    `IndexStore.set_embedding_signature` wipes the embeddings table on any
    change — stale vectors can never survive a model swap.
    """
    store.set_embedding_signature(signature)


def embed_batch(
    bridge: HostBridge,
    texts: list[str],
    *,
    signature: EmbeddingSignature,
    trace_id: str,
    deadline_ms: int,
) -> EmbedBatchResult:
    """Request embeddings through the Rust Model Gateway.

    Calls `model.embed.batch` on the host and returns the vectors bound to the
    caller's `signature`. Signature reconciliation against the derived index is
    the caller's responsibility (it owns the IndexStore): before calling, the
    planner uses `assert_signature_compatible` + `install_signature` so any
    provider/model/dimension drift wipes cached vectors before they can mismatch.

    Fail-closed: any host error (including `embedding_not_supported`, which the
    Rust `AiRuntime` returns by default until a real provider endpoint is wired)
    propagates to the caller. We never silently fall back to lexical retrieval
    here — that is a planner-level decision, not an embeddings-layer concern.
    """
    if not texts:
        raise ValueError("embed_batch requires at least one text")

    started = time.monotonic()
    result = bridge.invoke(
        CAPABILITY_MODEL_EMBED_BATCH,
        {"request": {"texts": list(texts)}},
        trace_id=trace_id,
        deadline_ms=deadline_ms,
        started_at=started,
    )
    return _parse_embed_result(result, signature)


def _parse_embed_result(
    result: dict[str, Any],
    signature: EmbeddingSignature,
) -> EmbedBatchResult:
    """Validate the host embedding response and bind it to the signature."""
    request_id = result.get("requestId")
    if not isinstance(request_id, str) or not request_id:
        raise ValueError("host embed result missing 'requestId'")
    model = result.get("model")
    if not isinstance(model, str) or not model:
        raise ValueError("host embed result missing 'model'")
    dimension = result.get("dimension")
    if not isinstance(dimension, int) or dimension <= 0:
        raise ValueError("host embed result missing positive 'dimension'")
    raw_vectors = result.get("vectors")
    if not isinstance(raw_vectors, list):
        raise ValueError("host embed result missing 'vectors' array")
    vectors: list[list[float]] = []
    for entry in raw_vectors:
        if not isinstance(entry, list):
            raise ValueError("host embed result vectors must be lists")
        vector = [float(value) for value in entry]
        if len(vector) != dimension:
            raise ValueError(
                f"host embed vector length {len(vector)} != declared dimension {dimension}"
            )
        vectors.append(vector)
    usage = result.get("usage") if isinstance(result.get("usage"), dict) else {}
    return EmbedBatchResult(
        request_id=request_id,
        dimension=dimension,
        vectors=vectors,
        signature=signature,
        usage=usage,
    )


__all__ = [
    "CAPABILITY_MODEL_EMBED_BATCH",
    "CAPABILITY_VERSION_MODEL_EMBED_BATCH",
    "EmbedBatchResult",
    "assert_signature_compatible",
    "embed_batch",
    "install_signature",
]
