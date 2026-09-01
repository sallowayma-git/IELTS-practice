from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from pydantic import ValidationError

from ielts_agent.dream.types import (
    CAPABILITY_DREAM_RUN_WEEKLY,
    CAPABILITY_MEMORY_CANDIDATE_POOL,
    FORBIDDEN_PATTERN_KINDS,
    PATTERN_KINDS,
    PatternKind,
    REQUIRED_WEEKLY_DREAM_HOST_CAPABILITIES,
    WeeklyDreamResult,
    WeeklyPatternProposal,
)
from ielts_agent.dream.weekly import (
    DEFAULT_COGNITIVE_DEADLINE_MS,
    MAX_RAW_PATTERNS,
    MIN_CANDIDATE_POOL,
    MIN_SUPPORTING_MEMORY_IDS,
    WeeklyDreamInput,
    WeeklyDreamOrchestrator,
    fallback_result,
)
from ielts_agent.protocol import ProtocolError


def _capabilities(extra: dict[str, str] | None = None) -> dict[str, str]:
    caps = dict(REQUIRED_WEEKLY_DREAM_HOST_CAPABILITIES)
    caps["model.invoke"] = "1"
    if extra:
        caps.update(extra)
    return caps


def _candidate_pool(count: int = 6) -> list[dict]:
    return [
        {
            "memoryId": f"mem-{i}",
            "summary": f"candidate memory summary {i} for skill reading.tfng",
            "scope": "strategy" if i % 2 == 0 else "behavior",
        }
        for i in range(count)
    ]


def _candidate_pool_wire(count: int = 6) -> dict:
    return {"candidates": _candidate_pool(count)}


def _llm_pattern(
    *,
    statement: str = "Learner defaults to skimming when under time pressure across reading and writing.",
    supporting_ids: list[str] | None = None,
    pattern_kind: str = "cross_skill_strategy",
    confidence: float = 0.78,
) -> dict:
    if supporting_ids is None:
        supporting_ids = ["mem-0", "mem-1", "mem-2"]
    return {
        "statement": statement,
        "supportingMemoryIds": supporting_ids,
        "patternKind": pattern_kind,
        "confidenceProposal": confidence,
    }


def _llm_content(patterns: list[dict]) -> str:
    return json.dumps({"patterns": patterns})


def _dream_result_wire(
    *,
    run_id: str = "weekly-run-1",
    validated: int = 1,
    rejected: int = 0,
    accepted: int = 1,
) -> dict:
    return {
        "runId": run_id,
        "validated": validated,
        "rejected": rejected,
        "accepted": accepted,
    }


class FakeHostBridge:
    """In-memory host bridge for weekly-dream tests."""

    def __init__(
        self,
        *,
        candidate_pool: dict | None = None,
        llm_patterns: list[dict] | None = None,
        dream_result: dict | None = None,
        fail_methods: frozenset[str] | None = None,
        llm_content_override: str | None = None,
    ) -> None:
        self.calls: list[tuple[str, dict]] = []
        self._candidate_pool = candidate_pool or _candidate_pool_wire()
        self._llm_patterns = llm_patterns if llm_patterns is not None else [_llm_pattern()]
        self._dream_result = dream_result or _dream_result_wire()
        self._fail_methods = fail_methods or frozenset()
        self._llm_content_override = llm_content_override

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
        if method == CAPABILITY_MEMORY_CANDIDATE_POOL:
            return self._candidate_pool
        if method == "model.invoke":
            if self._llm_content_override is not None:
                return {"content": self._llm_content_override}
            return {"content": _llm_content(self._llm_patterns)}
        if method == CAPABILITY_DREAM_RUN_WEEKLY:
            return self._dream_result
        raise ProtocolError("method_not_found", f"unhandled fake method {method}")


class WeeklyDreamTypesTests(unittest.TestCase):
    def test_pattern_kind_enum_has_exactly_five_values(self) -> None:
        self.assertEqual(
            {kind.value for kind in PatternKind},
            {
                "cross_skill_strategy",
                "metacognitive_pattern",
                "behavior_pattern",
                "stable_learning_preference",
                "recurrent_language_pattern",
            },
        )

    def test_pattern_kinds_frozenset_matches_enum(self) -> None:
        self.assertEqual(PATTERN_KINDS, frozenset(kind.value for kind in PatternKind))

    def test_forbidden_pattern_kinds_excludes_diagnostics(self) -> None:
        self.assertIn("medical", FORBIDDEN_PATTERN_KINDS)
        self.assertIn("personality", FORBIDDEN_PATTERN_KINDS)
        self.assertIn("intelligence", FORBIDDEN_PATTERN_KINDS)
        self.assertIn("mental_health", FORBIDDEN_PATTERN_KINDS)
        self.assertTrue(FORBIDDEN_PATTERN_KINDS.isdisjoint(PATTERN_KINDS))

    def test_proposal_requires_stable_mem_ids(self) -> None:
        with self.assertRaises(ValidationError):
            WeeklyPatternProposal.model_validate(
                {
                    "statement": "s",
                    "supportingMemoryIds": ["not-mem", "mem-1", "mem-2"],
                    "patternKind": "cross_skill_strategy",
                }
            )

    def test_proposal_rejects_duplicate_supports(self) -> None:
        with self.assertRaises(ValidationError):
            WeeklyPatternProposal.model_validate(
                {
                    "statement": "s",
                    "supportingMemoryIds": ["mem-1", "mem-1", "mem-2"],
                    "patternKind": "cross_skill_strategy",
                }
            )

    def test_proposal_rejects_forbidden_kind(self) -> None:
        with self.assertRaises(ValidationError):
            WeeklyPatternProposal.model_validate(
                {
                    "statement": "s",
                    "supportingMemoryIds": ["mem-1", "mem-2", "mem-3"],
                    "patternKind": "medical",
                }
            )

    def test_proposal_rejects_unknown_kind(self) -> None:
        with self.assertRaises(ValidationError):
            WeeklyPatternProposal.model_validate(
                {
                    "statement": "s",
                    "supportingMemoryIds": ["mem-1", "mem-2", "mem-3"],
                    "patternKind": "totally_made_up",
                }
            )

    def test_proposal_confidence_bounded(self) -> None:
        with self.assertRaises(ValidationError):
            WeeklyPatternProposal.model_validate(
                {
                    "statement": "s",
                    "supportingMemoryIds": ["mem-1", "mem-2", "mem-3"],
                    "patternKind": "behavior_pattern",
                    "confidenceProposal": 1.5,
                }
            )

    def test_proposal_to_wire_roundtrip(self) -> None:
        proposal = WeeklyPatternProposal.model_validate(
            {
                "statement": "cross-scope pattern",
                "supportingMemoryIds": ["mem-1", "mem-2", "mem-3"],
                "patternKind": "metacognitive_pattern",
                "confidenceProposal": 0.6,
            }
        )
        wire = proposal.to_wire()
        self.assertEqual(wire["patternKind"], "metacognitive_pattern")
        self.assertEqual(wire["supportingMemoryIds"], ["mem-1", "mem-2", "mem-3"])
        self.assertEqual(wire["confidenceProposal"], 0.6)

    def test_result_requires_run_id_when_not_fallback(self) -> None:
        with self.assertRaises(ValidationError):
            WeeklyDreamResult.model_validate(
                {"runId": "", "validated": 1, "rejected": 0, "accepted": 1}
            )

    def test_result_fallback(self) -> None:
        result = WeeklyDreamResult.model_validate(
            {"runId": "", "fallbackReason": "host_down"}
        )
        self.assertEqual(result.run_id, "")
        self.assertEqual(result.fallback_reason, "host_down")

    def test_result_fallback_must_not_carry_counts(self) -> None:
        with self.assertRaises(ValidationError):
            WeeklyDreamResult.model_validate(
                {"runId": "", "validated": 1, "fallbackReason": "host_down"}
            )

    def test_result_to_wire(self) -> None:
        result = WeeklyDreamResult.model_validate(
            {"runId": "run-1", "validated": 2, "rejected": 1, "accepted": 1}
        )
        wire = result.to_wire()
        self.assertEqual(wire["runId"], "run-1")
        self.assertEqual(wire["validated"], 2)


class WeeklyDreamOrchestratorTests(unittest.TestCase):
    def test_fetches_pool_then_llm_then_submits_patterns(self) -> None:
        bridge = FakeHostBridge()
        orchestrator = WeeklyDreamOrchestrator(bridge)
        result = orchestrator.run_weekly(
            WeeklyDreamInput(
                trace_id="trace-1",
                window="2026-W33",
                available_host_capabilities=_capabilities(),
            )
        )
        self.assertIsInstance(result, WeeklyDreamResult)
        self.assertEqual(result.run_id, "weekly-run-1")
        self.assertEqual(result.validated, 1)
        self.assertEqual(result.accepted, 1)
        self.assertIsNone(result.fallback_reason)
        methods = [call[0] for call in bridge.calls]
        self.assertEqual(
            methods,
            [
                CAPABILITY_MEMORY_CANDIDATE_POOL,
                "model.invoke",
                CAPABILITY_DREAM_RUN_WEEKLY,
            ],
        )

    def test_llm_receives_stable_memory_ids_not_indexes(self) -> None:
        """M8-02: the LLM prompt carries stable mem-* IDs, never array indexes."""
        bridge = FakeHostBridge()
        orchestrator = WeeklyDreamOrchestrator(bridge)
        orchestrator.run_weekly(
            WeeklyDreamInput(
                trace_id="trace-1",
                window="2026-W33",
                available_host_capabilities=_capabilities(),
            )
        )
        model_call = next(
            call for call in bridge.calls if call[0] == "model.invoke"
        )
        user_content = model_call[1]["request"]["messages"][1]["content"]
        parsed = json.loads(user_content)
        evidence = parsed["evidence"]
        self.assertTrue(evidence)
        for entry in evidence:
            self.assertIn("memoryId", entry)
            self.assertTrue(entry["memoryId"].startswith("mem-"))
        # No "index"/"idx" field name appears anywhere in the evidence shape.
        for entry in evidence:
            for key in entry:
                self.assertNotIn("index", key.lower())
                self.assertNotIn("idx", key.lower())

    def test_pattern_kind_medical_rejected(self) -> None:
        """M8-05: medical/personality/intelligence/mental-health forbidden."""
        bridge = FakeHostBridge(
            llm_patterns=[
                _llm_pattern(
                    statement="Learner has anxiety disorder affecting performance.",
                    supporting_ids=["mem-0", "mem-1", "mem-2"],
                    pattern_kind="medical",
                ),
                _llm_pattern(
                    statement="Learner is an introvert.",
                    supporting_ids=["mem-0", "mem-3", "mem-4"],
                    pattern_kind="personality",
                ),
            ]
        )
        orchestrator = WeeklyDreamOrchestrator(bridge)
        orchestrator.run_weekly(
            WeeklyDreamInput(
                trace_id="trace-1",
                window="2026-W33",
                available_host_capabilities=_capabilities(),
            )
        )
        dream_call = bridge.calls[-1]
        self.assertEqual(dream_call[0], CAPABILITY_DREAM_RUN_WEEKLY)
        patterns = dream_call[1]["patterns"]
        self.assertEqual(len(patterns), 0)

    def test_below_min_support_yields_zero_patterns(self) -> None:
        """M8-01: < min supporting IDs → pattern dropped → zero patterns."""
        bridge = FakeHostBridge(
            llm_patterns=[
                _llm_pattern(supporting_ids=["mem-0", "mem-1"]),  # only 2
            ]
        )
        orchestrator = WeeklyDreamOrchestrator(bridge)
        result = orchestrator.run_weekly(
            WeeklyDreamInput(
                trace_id="trace-1",
                window="2026-W33",
                available_host_capabilities=_capabilities(),
            )
        )
        self.assertIsNone(result.fallback_reason)
        dream_call = bridge.calls[-1]
        self.assertEqual(dream_call[1]["patterns"], [])

    def test_below_min_candidate_pool_skips_llm(self) -> None:
        """M8-03: below the minimum candidate pool floor, skip the LLM call."""
        bridge = FakeHostBridge(candidate_pool=_candidate_pool_wire(count=3))
        orchestrator = WeeklyDreamOrchestrator(bridge)
        result = orchestrator.run_weekly(
            WeeklyDreamInput(
                trace_id="trace-1",
                window="2026-W33",
                available_host_capabilities=_capabilities(),
            )
        )
        # Zero-pattern success: still submits an empty batch (run recorded).
        self.assertIsNone(result.fallback_reason)
        self.assertEqual(result.run_id, "weekly-run-1")
        methods = [call[0] for call in bridge.calls]
        # No model.invoke call when pool is below floor.
        self.assertNotIn("model.invoke", methods)
        self.assertEqual(
            methods,
            [CAPABILITY_MEMORY_CANDIDATE_POOL, CAPABILITY_DREAM_RUN_WEEKLY],
        )

    def test_no_llm_path_yields_zero_pattern_success(self) -> None:
        """No model.invoke capability → zero-pattern success, not fatal."""
        caps = dict(REQUIRED_WEEKLY_DREAM_HOST_CAPABILITIES)
        # model.invoke intentionally absent.
        bridge = FakeHostBridge()
        orchestrator = WeeklyDreamOrchestrator(bridge)
        result = orchestrator.run_weekly(
            WeeklyDreamInput(
                trace_id="trace-1",
                window="2026-W33",
                available_host_capabilities=caps,
            )
        )
        self.assertIsNone(result.fallback_reason)
        self.assertEqual(result.run_id, "weekly-run-1")
        self.assertEqual(result.accepted, 1)
        methods = [call[0] for call in bridge.calls]
        self.assertNotIn("model.invoke", methods)

    def test_fail_closed_candidate_pool_failure(self) -> None:
        """Host failure on memory.candidate_pool → fallback, not fatal."""
        bridge = FakeHostBridge(
            fail_methods=frozenset({CAPABILITY_MEMORY_CANDIDATE_POOL})
        )
        orchestrator = WeeklyDreamOrchestrator(bridge)
        result = orchestrator.run_weekly(
            WeeklyDreamInput(
                trace_id="trace-1",
                window="2026-W33",
                available_host_capabilities=_capabilities(),
            )
        )
        self.assertTrue(result.fallback_reason)
        self.assertIn("candidate_pool_unavailable", result.fallback_reason)
        self.assertEqual(result.run_id, "")
        self.assertEqual(result.accepted, 0)

    def test_fail_closed_dream_submission_failure(self) -> None:
        """Host failure on dream.run_weekly → fallback, not fatal."""
        bridge = FakeHostBridge(
            fail_methods=frozenset({CAPABILITY_DREAM_RUN_WEEKLY})
        )
        orchestrator = WeeklyDreamOrchestrator(bridge)
        result = orchestrator.run_weekly(
            WeeklyDreamInput(
                trace_id="trace-1",
                window="2026-W33",
                available_host_capabilities=_capabilities(),
            )
        )
        self.assertTrue(result.fallback_reason)
        self.assertIn("dream_run_weekly_unavailable", result.fallback_reason)
        self.assertEqual(result.run_id, "")

    def test_fail_closed_llm_failure_yields_zero_patterns(self) -> None:
        """model.invoke failure → zero-pattern path (no fatal), not fallback."""
        bridge = FakeHostBridge(
            fail_methods=frozenset({"model.invoke"}),
            dream_result=_dream_result_wire(validated=0, rejected=0, accepted=0),
        )
        orchestrator = WeeklyDreamOrchestrator(bridge)
        result = orchestrator.run_weekly(
            WeeklyDreamInput(
                trace_id="trace-1",
                window="2026-W33",
                available_host_capabilities=_capabilities(),
            )
        )
        # LLM failure → zero patterns submitted → success (not fallback).
        self.assertIsNone(result.fallback_reason)
        self.assertEqual(result.run_id, "weekly-run-1")
        self.assertEqual(result.accepted, 0)
        dream_call = bridge.calls[-1]
        self.assertEqual(dream_call[1]["patterns"], [])

    def test_missing_capabilities_fallback(self) -> None:
        bridge = FakeHostBridge()
        orchestrator = WeeklyDreamOrchestrator(bridge)
        result = orchestrator.run_weekly(
            WeeklyDreamInput(
                trace_id="trace-1",
                window="2026-W33",
                available_host_capabilities={},
            )
        )
        self.assertTrue(result.fallback_reason)
        self.assertIn("host_capabilities_unavailable", result.fallback_reason)
        self.assertEqual(bridge.calls, [])

    def test_capability_version_mismatch_fallback(self) -> None:
        bridge = FakeHostBridge()
        orchestrator = WeeklyDreamOrchestrator(bridge)
        mismatched = _capabilities()
        mismatched[CAPABILITY_DREAM_RUN_WEEKLY] = "2"
        result = orchestrator.run_weekly(
            WeeklyDreamInput(
                trace_id="trace-1",
                window="2026-W33",
                available_host_capabilities=mismatched,
            )
        )
        self.assertTrue(result.fallback_reason)
        self.assertIn("capability_mismatch", result.fallback_reason)

    def test_no_active_memory_write_bypass(self) -> None:
        """The orchestrator only emits candidate patterns; never writes active
        memory directly (M8 no-write-bypass)."""
        bridge = FakeHostBridge()
        orchestrator = WeeklyDreamOrchestrator(bridge)
        orchestrator.run_weekly(
            WeeklyDreamInput(
                trace_id="trace-1",
                window="2026-W33",
                available_host_capabilities=_capabilities(),
            )
        )
        methods = [call[0] for call in bridge.calls]
        self.assertNotIn("memory.promote", methods)
        self.assertNotIn("memory.write", methods)
        self.assertNotIn("memory.upsert", methods)
        # The dream.run_weekly payload carries patterns only.
        dream_call = bridge.calls[-1]
        self.assertEqual(dream_call[0], CAPABILITY_DREAM_RUN_WEEKLY)
        self.assertIn("patterns", dream_call[1])
        for pattern in dream_call[1]["patterns"]:
            self.assertIn("statement", pattern)
            self.assertIn("supportingMemoryIds", pattern)

    def test_hallucinated_evidence_id_rejected(self) -> None:
        """M8-02: a supporting ID not in the pool is dropped (hallucinated)."""
        bridge = FakeHostBridge(
            llm_patterns=[
                _llm_pattern(
                    supporting_ids=["mem-0", "mem-1", "mem-hallucinated"],
                ),
            ]
        )
        orchestrator = WeeklyDreamOrchestrator(bridge)
        orchestrator.run_weekly(
            WeeklyDreamInput(
                trace_id="trace-1",
                window="2026-W33",
                available_host_capabilities=_capabilities(),
            )
        )
        dream_call = bridge.calls[-1]
        self.assertEqual(dream_call[1]["patterns"], [])

    def test_malformed_llm_output_yields_zero_patterns(self) -> None:
        """Parse failure → zero-pattern success, not fatal."""
        bridge = FakeHostBridge(llm_content_override="not valid json {{{")
        orchestrator = WeeklyDreamOrchestrator(bridge)
        result = orchestrator.run_weekly(
            WeeklyDreamInput(
                trace_id="trace-1",
                window="2026-W33",
                available_host_capabilities=_capabilities(),
            )
        )
        self.assertIsNone(result.fallback_reason)
        dream_call = bridge.calls[-1]
        self.assertEqual(dream_call[1]["patterns"], [])

    def test_empty_llm_patterns_yields_zero_pattern_success(self) -> None:
        """M8-01: empty LLM output is a success, not a fallback."""
        bridge = FakeHostBridge(llm_patterns=[])
        orchestrator = WeeklyDreamOrchestrator(bridge)
        result = orchestrator.run_weekly(
            WeeklyDreamInput(
                trace_id="trace-1",
                window="2026-W33",
                available_host_capabilities=_capabilities(),
            )
        )
        self.assertIsNone(result.fallback_reason)
        dream_call = bridge.calls[-1]
        self.assertEqual(dream_call[1]["patterns"], [])

    def test_raw_patterns_truncated_to_max(self) -> None:
        """Raw LLM patterns beyond MAX_RAW_PATTERNS are truncated."""
        many = [
            _llm_pattern(
                statement=f"pattern {i}",
                supporting_ids=[f"mem-{i}", f"mem-{i+1}", f"mem-{i+2}"],
            )
            for i in range(MAX_RAW_PATTERNS + 5)
        ]
        # Ensure enough unique pool IDs exist for the supporting IDs.
        pool = _candidate_pool(count=MAX_RAW_PATTERNS + 7)
        bridge = FakeHostBridge(
            candidate_pool={"candidates": pool},
            llm_patterns=many,
        )
        orchestrator = WeeklyDreamOrchestrator(bridge)
        orchestrator.run_weekly(
            WeeklyDreamInput(
                trace_id="trace-1",
                window="2026-W33",
                available_host_capabilities=_capabilities(),
            )
        )
        dream_call = bridge.calls[-1]
        self.assertLessEqual(len(dream_call[1]["patterns"]), MAX_RAW_PATTERNS)

    def test_candidate_pool_entry_bad_id_fallback(self) -> None:
        """A non mem-* id in the pool → fail-closed fallback."""
        bridge = FakeHostBridge(
            candidate_pool={"candidates": [{"memoryId": "not-mem", "summary": "x"}]}
        )
        orchestrator = WeeklyDreamOrchestrator(bridge)
        result = orchestrator.run_weekly(
            WeeklyDreamInput(
                trace_id="trace-1",
                window="2026-W33",
                available_host_capabilities=_capabilities(),
            )
        )
        self.assertTrue(result.fallback_reason)
        self.assertIn("candidate_pool_entry_bad_id", result.fallback_reason)

    def test_candidate_pool_missing_candidates_fallback(self) -> None:
        bridge = FakeHostBridge(candidate_pool={"notCandidates": []})
        orchestrator = WeeklyDreamOrchestrator(bridge)
        result = orchestrator.run_weekly(
            WeeklyDreamInput(
                trace_id="trace-1",
                window="2026-W33",
                available_host_capabilities=_capabilities(),
            )
        )
        self.assertTrue(result.fallback_reason)
        self.assertIn("candidate_pool_missing_candidates", result.fallback_reason)

    def test_dream_result_missing_run_id_fallback(self) -> None:
        bridge = FakeHostBridge(dream_result={"validated": 1, "rejected": 0, "accepted": 1})
        orchestrator = WeeklyDreamOrchestrator(bridge)
        result = orchestrator.run_weekly(
            WeeklyDreamInput(
                trace_id="trace-1",
                window="2026-W33",
                available_host_capabilities=_capabilities(),
            )
        )
        self.assertTrue(result.fallback_reason)
        self.assertIn("dream_run_weekly_missing_run_id", result.fallback_reason)

    def test_dream_result_invalid_counts_fallback(self) -> None:
        bridge = FakeHostBridge(
            dream_result={"runId": "r1", "validated": "x", "rejected": 0, "accepted": 0}
        )
        orchestrator = WeeklyDreamOrchestrator(bridge)
        result = orchestrator.run_weekly(
            WeeklyDreamInput(
                trace_id="trace-1",
                window="2026-W33",
                available_host_capabilities=_capabilities(),
            )
        )
        self.assertTrue(result.fallback_reason)
        self.assertIn("dream_run_weekly_invalid_counts", result.fallback_reason)

    def test_fallback_result_helper(self) -> None:
        result = fallback_result("manual")
        self.assertEqual(result.run_id, "")
        self.assertEqual(result.fallback_reason, "manual")

    def test_never_raises_fatal_on_unexpected_error(self) -> None:
        class ExplodingBridge(FakeHostBridge):
            def invoke(self, *args, **kwargs):  # type: ignore[override]
                raise RuntimeError("unexpected boom")

        orchestrator = WeeklyDreamOrchestrator(ExplodingBridge())
        result = orchestrator.run_weekly(
            WeeklyDreamInput(
                trace_id="trace-1",
                window="2026-W33",
                available_host_capabilities=_capabilities(),
            )
        )
        # The load-bearing assertion: run_weekly returns a fallback result,
        # never raises. The host RuntimeError surfaces as a candidate_pool
        # fallback (the first host call after the capability gate).
        self.assertTrue(result.fallback_reason)
        self.assertIn("candidate_pool_unavailable", result.fallback_reason)
        self.assertEqual(result.run_id, "")

    def test_default_deadline_constant(self) -> None:
        self.assertEqual(DEFAULT_COGNITIVE_DEADLINE_MS, 20_000)

    def test_min_threshold_constants(self) -> None:
        self.assertEqual(MIN_CANDIDATE_POOL, 6)
        self.assertEqual(MIN_SUPPORTING_MEMORY_IDS, 3)

    def test_predicted_only_not_promoted(self) -> None:
        """M8-10: the orchestrator never promotes predicted-only memories.

        The candidate pool is sourced from the Rust host, which is responsible
        for excluding predicted-only entries. Here we verify the orchestrator
        does not itself attempt to add predicted memories to the submitted
        patterns — it only echoes LLM-chosen IDs that exist in the pool.
        """
        pool = _candidate_pool(count=6)
        # The pool contains no predicted entries; the LLM tries to reference
        # a fabricated "mem-predicted" that is not in the pool.
        bridge = FakeHostBridge(
            candidate_pool={"candidates": pool},
            llm_patterns=[
                _llm_pattern(supporting_ids=["mem-0", "mem-1", "mem-predicted"]),
            ],
        )
        orchestrator = WeeklyDreamOrchestrator(bridge)
        orchestrator.run_weekly(
            WeeklyDreamInput(
                trace_id="trace-1",
                window="2026-W33",
                available_host_capabilities=_capabilities(),
            )
        )
        dream_call = bridge.calls[-1]
        for pattern in dream_call[1]["patterns"]:
            for identifier in pattern["supportingMemoryIds"]:
                self.assertNotIn("predicted", identifier)


if __name__ == "__main__":
    unittest.main()
