from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from ielts_agent.dream.journal_enrichment import (
    JournalEnricher,
    EnrichmentInput,
    EnrichmentResult,
    _redact_private,
)
from ielts_agent.dream.types import (
    CAPABILITY_MODEL_INVOKE,
    CAPABILITY_VERSION_MODEL_INVOKE,
    JournalEnrichment,
    JournalFacts,
)
from ielts_agent.protocol import ProtocolError


def _facts(**overrides: object) -> JournalFacts:
    base: dict[str, object] = {
        "journalDate": "2026-08-16",
        "attemptsCount": 4,
        "coachFeedbackCount": 3,
        "timeSpentMs": 24000,
        "sourceHash": "sha-abc123",
        "todayObservationIds": ["obs-1", "obs-2"],
    }
    base.update(overrides)
    return JournalFacts.model_validate(base)


class FakeModelBridge:
    """In-memory host bridge returning canned model.invoke content."""

    def __init__(
        self,
        *,
        model_content: str | None = None,
        fail_methods: frozenset[str] | None = None,
    ) -> None:
        self.calls: list[tuple[str, dict]] = []
        self._model_content = (
            '{"title":"Today","summary":"Topics A","openHypotheses":["h1"]}'
            if model_content is None
            else model_content
        )
        self._fail_methods = fail_methods or frozenset()

    def invoke(
        self,
        method: str,
        params: dict,
        *,
        trace_id: str,
        deadline_ms: int,
        started_at: float,
    ) -> dict:
        self.calls.append((method, dict(params)))
        if method in self._fail_methods:
            raise ProtocolError("host_error", f"simulated failure for {method}", retryable=False)
        if method == CAPABILITY_MODEL_INVOKE:
            return {"content": self._model_content}
        raise ProtocolError("method_not_found", f"unhandled fake method {method}")


def _caps() -> dict[str, str]:
    return {CAPABILITY_MODEL_INVOKE: CAPABILITY_VERSION_MODEL_INVOKE}


class JournalEnrichmentTests(unittest.TestCase):
    def test_llm_only_changes_title_summary_hypotheses(self) -> None:
        """M7-04: LLM may only set title/summary/openHypotheses."""
        facts = _facts()
        bridge = FakeModelBridge()
        enricher = JournalEnricher(bridge)
        result = enricher.enrich(
            EnrichmentInput(
                trace_id="trace-1",
                facts=facts,
                available_host_capabilities=_caps(),
            )
        )
        self.assertIsInstance(result, EnrichmentResult)
        self.assertTrue(result.llm_used)
        self.assertEqual(result.enrichment.title, "Today")
        self.assertEqual(result.enrichment.summary, "Topics A")
        self.assertEqual(result.enrichment.open_hypotheses, ["h1"])

    def test_facts_json_unchanged_after_enrichment(self) -> None:
        """M7-04 critical invariant: facts JSON is byte-for-byte unchanged."""
        facts = _facts()
        facts_json_before = facts.facts_json()
        bridge = FakeModelBridge()
        enricher = JournalEnricher(bridge)
        result = enricher.enrich(
            EnrichmentInput(
                trace_id="trace-1",
                facts=facts,
                available_host_capabilities=_caps(),
            )
        )
        self.assertEqual(result.facts_json, facts_json_before)
        # The model payload contains the facts read-only (no mutation channel).
        model_call = bridge.calls[0]
        user_payload = model_call[1]["request"]["messages"][1]["content"]
        payload = json.loads(user_payload)
        self.assertIn("facts", payload)
        # The returned facts_json equals the facts in the payload (read-only).
        self.assertEqual(
            json.dumps(payload["facts"], ensure_ascii=False, sort_keys=True, separators=(",", ":")),
            facts_json_before,
        )

    def test_no_llm_path_deterministic_enrichment(self) -> None:
        """M7-03/08: host unavailable → deterministic enrichment, not fatal."""
        facts = _facts()
        bridge = FakeModelBridge()
        enricher = JournalEnricher(bridge)
        result = enricher.enrich(
            EnrichmentInput(
                trace_id="trace-1",
                facts=facts,
                available_host_capabilities={},  # no model.invoke capability
            )
        )
        self.assertFalse(result.llm_used)
        self.assertEqual(result.enrichment.title, "Daily journal — 2026-08-16")
        self.assertEqual(result.enrichment.summary, "")
        self.assertEqual(result.enrichment.open_hypotheses, [])
        self.assertIsNone(result.fallback_reason)
        # No model.invoke call made.
        self.assertEqual(bridge.calls, [])

    def test_no_llm_path_on_model_failure(self) -> None:
        facts = _facts()
        bridge = FakeModelBridge(
            fail_methods=frozenset({CAPABILITY_MODEL_INVOKE})
        )
        enricher = JournalEnricher(bridge)
        result = enricher.enrich(
            EnrichmentInput(
                trace_id="trace-1",
                facts=facts,
                available_host_capabilities=_caps(),
            )
        )
        self.assertFalse(result.llm_used)
        self.assertIsNotNone(result.fallback_reason)
        self.assertIn("model_invoke_unavailable", result.fallback_reason)
        self.assertEqual(result.enrichment.title, "Daily journal — 2026-08-16")

    def test_no_llm_path_on_empty_content(self) -> None:
        facts = _facts()
        bridge = FakeModelBridge(model_content="")
        enricher = JournalEnricher(bridge)
        result = enricher.enrich(
            EnrichmentInput(
                trace_id="trace-1",
                facts=facts,
                available_host_capabilities=_caps(),
            )
        )
        self.assertFalse(result.llm_used)
        self.assertIn("model_invoke_empty_content", result.fallback_reason or "")

    def test_private_memory_redaction(self) -> None:
        """M7-04: private candidate bodies are redacted from the LLM prompt."""
        facts = _facts()
        private_candidate = {
            "memoryId": "mem-1",
            "sensitivity": "private",
            "statement": "secret learner detail",
            "canonicalKey": "preference.x",
            "namespace": "preference",
            "kind": "ADD",
            "evidenceObservationIds": ["obs-1"],
        }
        public_candidate = {
            "memoryId": "mem-2",
            "sensitivity": "public",
            "statement": "public learner detail",
            "canonicalKey": "strategy.y",
            "namespace": "strategy",
            "kind": "REINFORCE",
            "evidenceObservationIds": ["obs-2"],
        }
        bridge = FakeModelBridge()
        enricher = JournalEnricher(bridge)
        enricher.enrich(
            EnrichmentInput(
                trace_id="trace-1",
                facts=facts,
                memory_candidates=(private_candidate, public_candidate),
                available_host_capabilities=_caps(),
            )
        )
        model_call = bridge.calls[0]
        user_payload = json.loads(model_call[1]["request"]["messages"][1]["content"])
        candidates = user_payload["memoryCandidates"]
        # Private candidate: body replaced with placeholder, IDs preserved.
        private_sent = next(c for c in candidates if c.get("memoryId") == "mem-1")
        self.assertEqual(private_sent["statement"], "[redacted-private]")
        self.assertNotIn("secret learner detail", json.dumps(candidates))
        # Public candidate: body passes through.
        public_sent = next(c for c in candidates if c.get("memoryId") == "mem-2")
        self.assertEqual(public_sent["statement"], "public learner detail")

    def test_redact_private_helper_replaces_body(self) -> None:
        candidate = {
            "memoryId": "mem-1",
            "sensitivity": "private",
            "statement": "secret",
            "proposedStatement": "secret2",
            "canonicalKey": "preference.x",
            "namespace": "preference",
            "kind": "REFINE",
            "evidenceObservationIds": ["obs-1"],
            "changeKind": "refined",
        }
        redacted = _redact_private(candidate)
        self.assertEqual(redacted["statement"], "[redacted-private]")
        self.assertEqual(redacted["proposedStatement"], "[redacted-private]")
        self.assertEqual(redacted["memoryId"], "mem-1")
        self.assertEqual(redacted["sensitivity"], "private")

    def test_redact_private_passthrough_for_public(self) -> None:
        candidate = {
            "memoryId": "mem-2",
            "sensitivity": "public",
            "statement": "ok",
            "canonicalKey": "strategy.y",
        }
        redacted = _redact_private(candidate)
        self.assertEqual(redacted["statement"], "ok")

    def test_malformed_llm_output_falls_back_to_deterministic_title(self) -> None:
        facts = _facts()
        bridge = FakeModelBridge(model_content="not json at all")
        enricher = JournalEnricher(bridge)
        result = enricher.enrich(
            EnrichmentInput(
                trace_id="trace-1",
                facts=facts,
                available_host_capabilities=_caps(),
            )
        )
        # LLM was used (called) but output malformed → deterministic title.
        self.assertTrue(result.llm_used)
        self.assertEqual(result.enrichment.title, "Daily journal — 2026-08-16")
        self.assertEqual(result.enrichment.summary, "")
        self.assertEqual(result.enrichment.open_hypotheses, [])

    def test_to_wire_carries_facts_json_invariant(self) -> None:
        facts = _facts()
        bridge = FakeModelBridge()
        enricher = JournalEnricher(bridge)
        result = enricher.enrich(
            EnrichmentInput(
                trace_id="trace-1",
                facts=facts,
                available_host_capabilities=_caps(),
            )
        )
        wire = result.to_wire()
        self.assertEqual(wire["factsJson"], facts.facts_json())
        self.assertTrue(wire["llmUsed"])

    def test_hypotheses_bounded_and_deduped(self) -> None:
        facts = _facts()
        # 20 hypotheses with duplicates; only the first 16 unique survive.
        hypotheses = [f"h{i}" for i in range(20)] + ["h0", "h1"]
        bridge = FakeModelBridge(
            model_content=json.dumps(
                {"title": "T", "summary": "S", "openHypotheses": hypotheses}
            )
        )
        enricher = JournalEnricher(bridge)
        result = enricher.enrich(
            EnrichmentInput(
                trace_id="trace-1",
                facts=facts,
                available_host_capabilities=_caps(),
            )
        )
        self.assertLessEqual(len(result.enrichment.open_hypotheses), 16)
        self.assertEqual(
            len(result.enrichment.open_hypotheses),
            len(set(result.enrichment.open_hypotheses)),
        )


if __name__ == "__main__":
    unittest.main()
