"""Tests for M5-04 embedding host gateway wiring (Slice 4).

Verifies `embed_batch` calls `model.embed.batch` through the host bridge, parses
the response into vectors bound to the signature, and fail-closes on host error
or a malformed response. Embeddings stay off by default — these tests exercise
the wired path only, never the default retrieval pipeline.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from ielts_agent.retrieval.embeddings import (
    CAPABILITY_MODEL_EMBED_BATCH,
    EmbedBatchResult,
    embed_batch,
)
from ielts_agent.retrieval.index_store import EmbeddingSignature


class _FakeBridge:
    """Records the last invoke call and returns a canned result."""

    def __init__(self, result: dict[str, Any] | None, error: Exception | None = None) -> None:
        self._result = result
        self._error = error
        self.last_method: str | None = None
        self.last_params: dict[str, Any] | None = None

    def invoke(
        self,
        method: str,
        params: dict[str, Any],
        *,
        trace_id: str,
        deadline_ms: int,
        started_at: float,
    ) -> dict[str, Any]:
        self.last_method = method
        self.last_params = params
        if self._error is not None:
            raise self._error
        assert self._result is not None
        return self._result


def _signature() -> EmbeddingSignature:
    return EmbeddingSignature(
        provider="openai",
        model="text-embedding-3-small",
        dimension=4,
        schema_version=1,
        config_hash="cfg-1",
    )


class EmbedBatchTests(unittest.TestCase):
    def test_invokes_model_embed_batch_capability(self) -> None:
        bridge = _FakeBridge(
            {
                "requestId": "req-1",
                "model": "text-embedding-3-small",
                "dimension": 4,
                "vectors": [[0.1, 0.2, 0.3, 0.4], [0.5, 0.6, 0.7, 0.8]],
                "usage": {"inputTokens": 12, "outputTokens": 0},
                "latencyMs": 9,
                "providerRequestId": "prov-1",
            }
        )
        result = embed_batch(
            bridge,
            ["hello", "world"],
            signature=_signature(),
            trace_id="trace-1",
            deadline_ms=1000,
        )
        self.assertEqual(bridge.last_method, CAPABILITY_MODEL_EMBED_BATCH)
        assert bridge.last_params is not None
        self.assertEqual(bridge.last_params["request"]["texts"], ["hello", "world"])
        self.assertIsInstance(result, EmbedBatchResult)
        self.assertEqual(result.request_id, "req-1")
        self.assertEqual(result.dimension, 4)
        self.assertEqual(len(result.vectors), 2)
        self.assertEqual(result.vectors[0], [0.1, 0.2, 0.3, 0.4])
        self.assertEqual(result.signature.model, "text-embedding-3-small")
        self.assertEqual(result.usage["inputTokens"], 12)

    def test_rejects_empty_texts(self) -> None:
        bridge = _FakeBridge({})
        with self.assertRaises(ValueError):
            embed_batch(
                bridge,
                [],
                signature=_signature(),
                trace_id="trace-1",
                deadline_ms=1000,
            )

    def test_fail_closed_on_host_error(self) -> None:
        bridge = _FakeBridge(None, error=RuntimeError("embedding_not_supported"))
        with self.assertRaises(RuntimeError):
            embed_batch(
                bridge,
                ["hello"],
                signature=_signature(),
                trace_id="trace-1",
                deadline_ms=1000,
            )

    def test_rejects_dimension_mismatch(self) -> None:
        bridge = _FakeBridge(
            {
                "requestId": "req-2",
                "model": "text-embedding-3-small",
                "dimension": 4,
                "vectors": [[0.1, 0.2, 0.3]],  # length 3 != declared 4
            }
        )
        with self.assertRaises(ValueError):
            embed_batch(
                bridge,
                ["hello"],
                signature=_signature(),
                trace_id="trace-1",
                deadline_ms=1000,
            )

    def test_rejects_missing_vectors(self) -> None:
        bridge = _FakeBridge(
            {
                "requestId": "req-3",
                "model": "text-embedding-3-small",
                "dimension": 4,
            }
        )
        with self.assertRaises(ValueError):
            embed_batch(
                bridge,
                ["hello"],
                signature=_signature(),
                trace_id="trace-1",
                deadline_ms=1000,
            )


if __name__ == "__main__":
    unittest.main()
