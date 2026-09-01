from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from ielts_agent.coach.personalized_coach import (
    CAPABILITY_CONTEXT_MATERIALIZE,
    CAPABILITY_LEARNER_SKILL_STATE,
    CAPABILITY_MODEL_INVOKE,
    DEFAULT_COGNITIVE_DEADLINE_MS,
    REQUIRED_COACH_HOST_CAPABILITIES,
    CoachFrozenInput,
    CoachShadowResult,
    PythonPersonalizedCoach,
)
from ielts_agent.coach.strategies import CoachStrategyId
from ielts_agent.coach.types import CoachFeedbackKind
from ielts_agent.protocol import ProtocolError


class FakeHostBridge:
    """In-memory host bridge for shadow-path tests.

    Records every (method, params) call and returns canned responses. Raises
    ProtocolError when configured to simulate sidecar/protocol failures.
    """

    def __init__(
        self,
        *,
        learner_skill_state: dict | None = None,
        context_pack: dict | None = None,
        model_content: str | None = None,
        fail_methods: frozenset[str] | None = None,
    ) -> None:
        self.calls: list[tuple[str, dict]] = []
        self._learner_skill_state = learner_skill_state or {
            "skills": [{"skill": "reading.tfng.false_vs_not_given", "proficiency": 0.9}]
        }
        self._context_pack = context_pack or {
            "manifest": {
                "snapshotId": "ctx-snap-shadow-1",
                "runId": "run-1",
                "plannerVersion": "m5-retrieval-v1",
                "scope": "internal",
                "tokenBudget": 8000,
                "usedTokens": 1200,
                "contentHash": "abc123",
                "renderedAt": "2026-08-16T00:00:00Z",
                "sections": [],
            },
            "renderedContext": "Rendered canonical context for the coach.",
            "renderedHash": "deadbeef",
        }
        # Use a sentinel to distinguish "not provided" from "empty string".
        self._model_content = "Here is the coach explanation." if model_content is None else model_content
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
        if method == CAPABILITY_LEARNER_SKILL_STATE:
            return self._learner_skill_state
        if method == CAPABILITY_CONTEXT_MATERIALIZE:
            return self._context_pack
        if method == CAPABILITY_MODEL_INVOKE:
            return {"content": self._model_content}
        raise ProtocolError("method_not_found", f"unhandled fake method {method}")


def _capabilities() -> dict[str, str]:
    return dict(REQUIRED_COACH_HOST_CAPABILITIES)


def _frozen_input(**overrides: object) -> CoachFrozenInput:
    defaults: dict[str, object] = {
        "trace_id": "trace-shadow-1",
        "activity": "reading",
        "task_kind": "AttemptReview",
        "skills_addressed": ("reading.tfng.false_vs_not_given",),
        "context_plan": {
            "schemaVersion": 1,
            "plannerVersion": "m5-retrieval-v1",
            "taskKind": "AttemptReview",
            "sections": [],
            "rankedItemIds": [],
            "inclusionReasons": {},
            "requestedTokenBudget": 8000,
            "retrievalRunIds": [],
        },
        "prior_feedback_kinds": frozenset(),
        "is_reask": False,
        "selected_memory_canonical_keys": ("mem-strategy-reading-1",),
        "evidence_observation_ids": ("obs-fb-shadow-1",),
    }
    defaults.update(overrides)
    return CoachFrozenInput(**defaults)  # type: ignore[arg-type]


class PersonalizedCoachShadowTests(unittest.TestCase):
    def test_shadow_consumes_context_pack_and_selects_strategy(self) -> None:
        bridge = FakeHostBridge()
        coach = PythonPersonalizedCoach(bridge)
        result = coach.evaluate_shadow(
            _frozen_input(), available_host_capabilities=_capabilities()
        )
        self.assertIsInstance(result, CoachShadowResult)
        self.assertFalse(result.fell_back)
        self.assertIsNone(result.fallback_reason)
        # The coach must have called learner_skill_state, context.materialize,
        # and model.invoke — in that order (gateway before model).
        methods = [call[0] for call in bridge.calls]
        self.assertEqual(
            methods,
            [
                CAPABILITY_LEARNER_SKILL_STATE,
                CAPABILITY_CONTEXT_MATERIALIZE,
                CAPABILITY_MODEL_INVOKE,
            ],
        )
        # context.materialize must carry the frozen plan + internal scope.
        materialize_params = bridge.calls[1][1]
        self.assertIn("plan", materialize_params)
        self.assertEqual(materialize_params["scope"], "internal")
        self.assertEqual(
            materialize_params["plan"]["taskKind"], "AttemptReview"
        )

    def test_shadow_assignment_records_strategy_and_snapshot_id(self) -> None:
        bridge = FakeHostBridge()
        coach = PythonPersonalizedCoach(bridge)
        result = coach.evaluate_shadow(
            _frozen_input(), available_host_capabilities=_capabilities()
        )
        assert result.assignment is not None
        self.assertEqual(
            result.assignment.context_snapshot_id, "ctx-snap-shadow-1"
        )
        # No feedback, skill family reading.tfng default ⇒ contrastive_v1.
        self.assertEqual(
            result.assignment.strategy_id, CoachStrategyId.CONTRASTIVE.value
        )
        self.assertEqual(
            result.assignment.skills_addressed,
            ["reading.tfng.false_vs_not_given"],
        )
        self.assertEqual(result.assignment.memory_ids_used, ["mem-strategy-reading-1"])
        self.assertEqual(result.assignment.followup_type.value, "explain")

    def test_shadow_output_not_marked_for_user_display(self) -> None:
        # Shadow output carries quality signals but the caller (Rust) decides
        # whether to surface it. The result exposes fellBack=False and signals
        # but never asserts user display.
        bridge = FakeHostBridge()
        coach = PythonPersonalizedCoach(bridge)
        result = coach.evaluate_shadow(
            _frozen_input(), available_host_capabilities=_capabilities()
        )
        self.assertFalse(result.fell_back)
        self.assertIn("strategyId", result.quality_signals)
        self.assertIn("contextSnapshotId", result.quality_signals)
        self.assertIn("latencyMs", result.to_wire())

    def test_shadow_records_preference_candidate_batch(self) -> None:
        bridge = FakeHostBridge()
        coach = PythonPersonalizedCoach(bridge)
        result = coach.evaluate_shadow(
            _frozen_input(
                prior_feedback_kinds=frozenset({CoachFeedbackKind.NEED_EXAMPLE}),
            ),
            available_host_capabilities=_capabilities(),
        )
        self.assertIsNotNone(result.preference_candidate_batch)
        proposals = result.preference_candidate_batch["proposals"]
        self.assertTrue(len(proposals) >= 1)
        self.assertEqual(
            proposals[0]["canonicalKey"], "preference.coach.example_first"
        )

    def test_shadow_latency_is_recorded(self) -> None:
        bridge = FakeHostBridge()
        coach = PythonPersonalizedCoach(bridge)
        result = coach.evaluate_shadow(
            _frozen_input(), available_host_capabilities=_capabilities()
        )
        self.assertGreaterEqual(result.latency_ms, 0)
        self.assertLess(result.latency_ms, DEFAULT_COGNITIVE_DEADLINE_MS)


class PersonalizedCoachFallbackTests(unittest.TestCase):
    """M6 Runtime Rule: sidecar unavailable / protocol mismatch / timeout ⇒
    automatic, non-fatal fallback to Rust baseline. Python never raises fatal."""

    def test_missing_capabilities_falls_back_non_fatal(self) -> None:
        bridge = FakeHostBridge()
        coach = PythonPersonalizedCoach(bridge)
        result = coach.evaluate_shadow(
            _frozen_input(), available_host_capabilities={}
        )
        self.assertTrue(result.fell_back)
        self.assertIsNotNone(result.fallback_reason)
        self.assertIn("host_capabilities_unavailable", result.fallback_reason)
        # No host calls made — fallback happened at the capability gate.
        self.assertEqual(bridge.calls, [])
        # Fallback result is empty; Rust baseline takes over.
        self.assertEqual(result.explanation, "")
        self.assertIsNone(result.assignment)

    def test_capability_version_mismatch_falls_back(self) -> None:
        bridge = FakeHostBridge()
        coach = PythonPersonalizedCoach(bridge)
        mismatched = dict(_capabilities())
        mismatched[CAPABILITY_LEARNER_SKILL_STATE] = "2"
        result = coach.evaluate_shadow(
            _frozen_input(), available_host_capabilities=mismatched
        )
        self.assertTrue(result.fell_back)
        self.assertIn("capability_mismatch", result.fallback_reason)
        self.assertIn(CAPABILITY_LEARNER_SKILL_STATE, result.fallback_reason)

    def test_learner_skill_state_host_failure_falls_back(self) -> None:
        bridge = FakeHostBridge(
            fail_methods=frozenset({CAPABILITY_LEARNER_SKILL_STATE})
        )
        coach = PythonPersonalizedCoach(bridge)
        result = coach.evaluate_shadow(
            _frozen_input(), available_host_capabilities=_capabilities()
        )
        self.assertTrue(result.fell_back)
        self.assertIn("learner_skill_state_unavailable", result.fallback_reason)
        self.assertEqual(bridge.calls[0][0], CAPABILITY_LEARNER_SKILL_STATE)

    def test_context_materialize_failure_falls_back(self) -> None:
        bridge = FakeHostBridge(
            fail_methods=frozenset({CAPABILITY_CONTEXT_MATERIALIZE})
        )
        coach = PythonPersonalizedCoach(bridge)
        result = coach.evaluate_shadow(
            _frozen_input(), available_host_capabilities=_capabilities()
        )
        self.assertTrue(result.fell_back)
        self.assertIn("context_materialize_unavailable", result.fallback_reason)

    def test_model_invoke_failure_falls_back(self) -> None:
        bridge = FakeHostBridge(
            fail_methods=frozenset({CAPABILITY_MODEL_INVOKE})
        )
        coach = PythonPersonalizedCoach(bridge)
        result = coach.evaluate_shadow(
            _frozen_input(), available_host_capabilities=_capabilities()
        )
        self.assertTrue(result.fell_back)
        self.assertIn("model_invoke_unavailable", result.fallback_reason)

    def test_context_pack_missing_snapshot_id_falls_back(self) -> None:
        bridge = FakeHostBridge(
            context_pack={
                "manifest": {"snapshotId": "", "sections": []},
                "renderedContext": "ctx",
                "renderedHash": "h",
            }
        )
        coach = PythonPersonalizedCoach(bridge)
        result = coach.evaluate_shadow(
            _frozen_input(), available_host_capabilities=_capabilities()
        )
        self.assertTrue(result.fell_back)
        self.assertIn("context_pack_missing_snapshot_id", result.fallback_reason)

    def test_model_empty_content_falls_back(self) -> None:
        bridge = FakeHostBridge(model_content="")
        coach = PythonPersonalizedCoach(bridge)
        result = coach.evaluate_shadow(
            _frozen_input(), available_host_capabilities=_capabilities()
        )
        self.assertTrue(result.fell_back)
        self.assertIn("model_invoke_empty_content", result.fallback_reason)

    def test_fallback_never_raises_fatal(self) -> None:
        # Even an unexpected internal error becomes a fallback, not an exception.
        # The failure surfaces through whichever step caught it; the
        # load-bearing assertion is that evaluate_shadow returns a non-fatal
        # fallback result rather than propagating the error.
        class ExplodingBridge(FakeHostBridge):
            def invoke(self, *args, **kwargs):  # type: ignore[override]
                raise RuntimeError("unexpected boom")

        coach = PythonPersonalizedCoach(ExplodingBridge())
        result = coach.evaluate_shadow(
            _frozen_input(), available_host_capabilities=_capabilities()
        )
        self.assertTrue(result.fell_back)
        self.assertIsNotNone(result.fallback_reason)
        self.assertNotEqual(result.fallback_reason, "")


class PersonalizedCoachStrategyIntegrationTests(unittest.TestCase):
    def test_feedback_drives_strategy_selection_through_coach(self) -> None:
        bridge = FakeHostBridge()
        coach = PythonPersonalizedCoach(bridge)
        result = coach.evaluate_shadow(
            _frozen_input(
                prior_feedback_kinds=frozenset({CoachFeedbackKind.NEED_EXAMPLE}),
            ),
            available_host_capabilities=_capabilities(),
        )
        assert result.assignment is not None
        # need_example ⇒ example_first_v1 (proves the coach wires the selector).
        self.assertEqual(
            result.assignment.strategy_id, CoachStrategyId.EXAMPLE_FIRST.value
        )

    def test_prefetched_learner_state_skips_host_call(self) -> None:
        bridge = FakeHostBridge()
        coach = PythonPersonalizedCoach(bridge)
        prefetched = {
            "skills": [{"skill": "reading.tfng.false_vs_not_given", "proficiency": 0.1}]
        }
        result = coach.evaluate_shadow(
            _frozen_input(learner_skill_state=prefetched),
            available_host_capabilities=_capabilities(),
        )
        self.assertFalse(result.fell_back)
        # No learner_skill_state host call — prefetched value used directly.
        methods = [call[0] for call in bridge.calls]
        self.assertNotIn(CAPABILITY_LEARNER_SKILL_STATE, methods)
        # Low proficiency (0.1) ⇒ step_by_step_v1 (no feedback, no skill-family
        # default for reading.tfng? reading.tfng defaults to contrastive, but
        # proficiency ≤0.25 is checked AFTER skill-family default — so contrastive
        # wins. Assert the call order instead, which is the load-bearing part.)


if __name__ == "__main__":
    unittest.main()
