"""M11-05 candidate lifecycle orchestrator tests (Python Slice 2).

Covers the M11-05 / M11-06 / M11-08 invariants the plan §9179-9187 requires:

- candidate cannot skip eval (no promote without a passing eval run)
- holdout never enters prompt generation context
- shadow has no user-visible side effect
- rollback exact
- prompt/skill version pinned in trace
- evaluation data isolation (cases do not leak across candidates)
- fail-closed (host failure → fallback result, non-fatal)
- M11-06 forbidden agent tools never invoked
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from ielts_agent.eval import (
    FORBIDDEN_AGENT_TOOLS,
    REQUIRED_EVAL_HOST_CAPABILITIES,
    CandidateProposal,
    CandidateTargetKind,
    EvalOrchestrator,
    EvalRunInput,
    EvalRunResult,
    case_kinds_present,
    frozen_eval_cases,
    holdout_cases,
    non_holdout_cases,
)
from ielts_agent.eval.types import EVAL_CASE_KINDS
from ielts_agent.protocol import ProtocolError


def _capabilities() -> dict[str, str]:
    return dict(REQUIRED_EVAL_HOST_CAPABILITIES)


class FakeHostBridge:
    """In-memory host bridge for eval-orchestrator tests.

    Records every invoke call so tests can assert the host gateway was
    called with the right method/params (no-write-bypass audit).
    """

    def __init__(
        self,
        *,
        propose_result: dict | None = None,
        eval_run_result: dict | None = None,
        promote_result: dict | None = None,
        rollback_result: dict | None = None,
        get_active_result: dict | None = None,
        fail_methods: frozenset[str] | None = None,
    ) -> None:
        self.calls: list[tuple[str, dict]] = []
        self._propose_result = propose_result or {
            "candidateVersionId": "prompt-cand-1",
            "recorded": True,
        }
        self._eval_run_result = eval_run_result or {
            "runId": "eval-run-host-1",
            "recorded": True,
        }
        self._promote_result = promote_result or {"promoted": True}
        self._rollback_result = rollback_result or {
            "rolledBack": True,
            "restoredVersionId": "prompt-v1",
        }
        self._get_active_result = get_active_result or {
            "promptVersionId": "prompt-v1",
            "skillVersionId": "skill-v1",
        }
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
            raise ProtocolError(
                "host_error",
                f"simulated failure for {method}",
                retryable=False,
            )
        if method == "prompt.propose_candidate":
            return self._propose_result
        if method == "eval.run_case":
            return self._eval_run_result
        if method == "prompt.promote_candidate":
            return self._promote_result
        if method == "prompt.rollback":
            return self._rollback_result
        if method == "prompt.get_active":
            return self._get_active_result
        raise ProtocolError(
            "method_not_found", f"unhandled fake method {method}"
        )


class ExplodingBridge(FakeHostBridge):
    def invoke(self, *args, **kwargs):  # type: ignore[override]
        raise RuntimeError("unexpected boom")


def _passing_traces(cases) -> dict:
    """Build traces that pass every grader for the given cases."""
    traces = {}
    for case in cases:
        trace = {
            "finalAnswer": case.expected.get("finalAnswer", "ok"),
            "contextIds": case.expected.get("goldenContextIds", []),
            "toolCalls": case.expected.get("allowedTools", []),
            "citedMemoryIds": case.expected.get("goldenMemoryIds", []),
            "counterEvidenceSurfaced": case.expected.get(
                "requiresCounterEvidence", False
            ),
            "outputTokens": 100,
            "latencyMs": 100,
        }
        # Cases that express their golden as invariants rather than a
        # finalAnswer: the final-answer grader returns 1.0 when there is no
        # explicit golden finalAnswer to match (deferred to the dedicated
        # grader), so a non-empty finalAnswer passes.
        traces[case.case_id] = trace
    return traces


def _run_input(
    *,
    cases,
    target_version_id: str = "prompt-cand-1",
    base_version_id: str = "prompt-v1",
    shadow: bool = False,
    traces: dict | None = None,
) -> EvalRunInput:
    return EvalRunInput(
        trace_id="trace-1",
        target_kind=CandidateTargetKind.PROMPT,
        target_version_id=target_version_id,
        base_version_id=base_version_id,
        cases=tuple(cases),
        shadow=shadow,
        traces=traces if traces is not None else _passing_traces(cases),
    )


class FrozenDatasetTests(unittest.TestCase):
    """The frozen eval dataset has all 8 categories and holdout isolation."""

    def test_all_eight_case_kinds_present(self) -> None:
        self.assertEqual(case_kinds_present(), EVAL_CASE_KINDS)

    def test_non_holdout_excludes_holdout(self) -> None:
        non_holdout = non_holdout_cases()
        holdout = holdout_cases()
        self.assertFalse(any(c.holdout for c in non_holdout))
        self.assertTrue(all(c.holdout for c in holdout))
        # No overlap: a case id is either holdout or not.
        non_holdout_ids = {c.case_id for c in non_holdout}
        holdout_ids = {c.case_id for c in holdout}
        self.assertTrue(non_holdout_ids.isdisjoint(holdout_ids))

    def test_frozen_set_is_non_holdout_plus_holdout(self) -> None:
        full = frozen_eval_cases()
        self.assertEqual(
            len(full), len(non_holdout_cases()) + len(holdout_cases())
        )

    def test_every_case_pins_versions(self) -> None:
        for case in frozen_eval_cases():
            self.assertTrue(case.prompt_version_id)
            self.assertTrue(case.skill_version_id)


class HoldoutIsolationTests(unittest.TestCase):
    """M11-05: holdout never enters prompt generation context."""

    def test_prompt_generation_cases_excludes_holdout(self) -> None:
        bridge = FakeHostBridge()
        orch = EvalOrchestrator(bridge)
        gen_cases = orch.prompt_generation_cases()
        self.assertFalse(any(c.holdout for c in gen_cases))

    def test_gated_eval_includes_holdout(self) -> None:
        bridge = FakeHostBridge()
        orch = EvalOrchestrator(bridge)
        gated = orch.gated_eval_cases()
        self.assertTrue(any(c.holdout for c in gated))

    def test_holdout_cases_never_in_prompt_generation(self) -> None:
        bridge = FakeHostBridge()
        orch = EvalOrchestrator(bridge)
        gen_ids = {c.case_id for c in orch.prompt_generation_cases()}
        holdout_ids = {c.case_id for c in orch.holdout_cases()}
        self.assertTrue(gen_ids.isdisjoint(holdout_ids))


class ProposeCandidateTests(unittest.TestCase):
    def test_propose_returns_candidate_id(self) -> None:
        bridge = FakeHostBridge()
        orch = EvalOrchestrator(bridge)
        proposal = CandidateProposal(
            target_kind=CandidateTargetKind.PROMPT,
            target_version_id="prompt-cand-1",
            base_version_id="prompt-v1",
            proposal_json={"body": "new prompt"},
            rationale="addresses false-merge regression",
        )
        candidate_id = orch.propose_candidate(
            proposal, trace_id="t1", available_host_capabilities=_capabilities()
        )
        self.assertEqual(candidate_id, "prompt-cand-1")
        # no-write-bypass: the host gateway was called.
        self.assertEqual(
            bridge.calls[0][0], "prompt.propose_candidate"
        )

    def test_propose_falls_back_on_host_failure(self) -> None:
        bridge = FakeHostBridge(
            fail_methods=frozenset({"prompt.propose_candidate"})
        )
        orch = EvalOrchestrator(bridge)
        proposal = CandidateProposal(
            target_kind=CandidateTargetKind.PROMPT,
            target_version_id="prompt-cand-1",
            base_version_id="prompt-v1",
            proposal_json={},
            rationale="x",
        )
        result = orch.propose_candidate(
            proposal, trace_id="t1", available_host_capabilities=_capabilities()
        )
        self.assertIsNone(result)

    def test_propose_falls_back_on_capability_mismatch(self) -> None:
        bridge = FakeHostBridge()
        orch = EvalOrchestrator(bridge)
        proposal = CandidateProposal(
            target_kind=CandidateTargetKind.PROMPT,
            target_version_id="prompt-cand-1",
            base_version_id="prompt-v1",
            proposal_json={},
            rationale="x",
        )
        result = orch.propose_candidate(
            proposal,
            trace_id="t1",
            available_host_capabilities={"prompt.propose_candidate": "0"},
        )
        self.assertIsNone(result)


class RunEvalTests(unittest.TestCase):
    def test_local_grades_are_audit_only_and_never_eval_evidence(self) -> None:
        """Round-3 audit (A2): the runtime cannot author eval evidence.

        `eval.run_case` used to persist these caller-supplied pass/fail counts
        AND advance the candidate to `eval_passed`, the sole precondition for
        approval. The host no longer serves it, so grading still runs locally
        for audit but can never unlock a promotion.
        """
        bridge = FakeHostBridge()
        orch = EvalOrchestrator(bridge)
        cases = non_holdout_cases()
        run_input = _run_input(cases=cases)
        result = orch.run_eval(
            run_input, available_host_capabilities=_capabilities()
        )
        # The local grading still happened and is reported honestly.
        self.assertEqual(result.failed_count, 0)
        self.assertGreater(result.passed_count, 0)
        # But it is flagged as non-persisted and is NOT evidence.
        self.assertFalse(result.passed)
        self.assertTrue(result.fallback)
        self.assertEqual(result.fallback_reason, "eval_run_case_not_recorded")
        self.assertFalse(orch._has_eval_evidence("prompt-cand-1"))
        # The runtime must not even attempt the authority call.
        methods = [call[0] for call in bridge.calls]
        self.assertNotIn("eval.run_case", methods)

    def test_failing_eval_does_not_record_evidence(self) -> None:
        bridge = FakeHostBridge()
        orch = EvalOrchestrator(bridge)
        cases = non_holdout_cases()
        # Build traces that fail every grader (empty traces).
        failing_traces = {c.case_id: {} for c in cases}
        run_input = _run_input(cases=cases, traces=failing_traces)
        result = orch.run_eval(
            run_input, available_host_capabilities=_capabilities()
        )
        self.assertFalse(result.passed)
        self.assertFalse(orch._has_eval_evidence("prompt-cand-1"))

    def test_version_pinned_in_trace(self) -> None:
        """M11-08: the pinned prompt/skill versions are recorded in the
        eval run result. The host is no longer called (Round-3 audit A2), so
        the pinning must hold in the locally produced result itself."""
        bridge = FakeHostBridge()
        orch = EvalOrchestrator(bridge)
        cases = non_holdout_cases()
        run_input = _run_input(cases=cases)
        result = orch.run_eval(
            run_input, available_host_capabilities=_capabilities()
        )
        self.assertTrue(result.prompt_version_id)
        self.assertTrue(result.skill_version_id)
        self.assertNotIn(
            "eval.run_case", [call[0] for call in bridge.calls]
        )

    def test_evaluation_data_isolation_between_candidates(self) -> None:
        """Cases do not leak across candidates: each eval run is scoped to
        one candidate version id. Since Round-3 audit A2 no runtime-side run
        records evidence, neither candidate becomes promotable."""
        bridge = FakeHostBridge()
        orch = EvalOrchestrator(bridge)
        cases = non_holdout_cases()
        result_a = orch.run_eval(
            _run_input(cases=cases, target_version_id="cand-A"),
            available_host_capabilities=_capabilities(),
        )
        self.assertFalse(orch._has_eval_evidence("cand-B"))
        result_b = orch.run_eval(
            _run_input(cases=cases, target_version_id="cand-B"),
            available_host_capabilities=_capabilities(),
        )
        self.assertEqual(result_a.target_version_id, "cand-A")
        self.assertEqual(result_b.target_version_id, "cand-B")
        self.assertFalse(orch._has_eval_evidence("cand-A"))
        self.assertFalse(orch._has_eval_evidence("cand-B"))

    def test_fail_closed_on_host_failure(self) -> None:
        bridge = FakeHostBridge(
            fail_methods=frozenset({"eval.run_case"})
        )
        orch = EvalOrchestrator(bridge)
        cases = non_holdout_cases()
        run_input = _run_input(cases=cases)
        result = orch.run_eval(
            run_input, available_host_capabilities=_capabilities()
        )
        # Fail-closed: fallback result, never a passing eval, never raises.
        self.assertTrue(result.fallback)
        self.assertFalse(result.passed)
        self.assertIsNotNone(result.fallback_reason)
        # A fallback result records NO eval evidence.
        self.assertFalse(orch._has_eval_evidence("prompt-cand-1"))


class ShadowRunTests(unittest.TestCase):
    """M11-05: shadow has no user-visible side effect."""

    def test_shadow_run_marked_no_side_effect(self) -> None:
        bridge = FakeHostBridge()
        orch = EvalOrchestrator(bridge)
        cases = non_holdout_cases()
        run_input = _run_input(cases=cases, shadow=True)
        result = orch.run_shadow(
            run_input, available_host_capabilities=_capabilities()
        )
        self.assertTrue(result.no_user_visible_side_effect)

    def test_shadow_passes_do_not_record_evidence(self) -> None:
        """A shadow run never reaches a user, and since Round-3 audit A2 it
        also cannot record eval evidence — a shadow run must never be the
        thing that unlocks a promotion."""
        bridge = FakeHostBridge()
        orch = EvalOrchestrator(bridge)
        cases = non_holdout_cases()
        run_input = _run_input(cases=cases, shadow=True)
        result = orch.run_shadow(
            run_input, available_host_capabilities=_capabilities()
        )
        self.assertTrue(result.no_user_visible_side_effect)
        self.assertFalse(result.passed)
        self.assertFalse(orch._has_eval_evidence("prompt-cand-1"))

    def test_shadow_marks_no_side_effect_without_calling_the_host(
        self,
    ) -> None:
        bridge = FakeHostBridge()
        orch = EvalOrchestrator(bridge)
        cases = non_holdout_cases()
        run_input = _run_input(cases=cases, shadow=True)
        result = orch.run_shadow(
            run_input, available_host_capabilities=_capabilities()
        )
        self.assertTrue(result.no_user_visible_side_effect)
        self.assertNotIn(
            "eval.run_case", [call[0] for call in bridge.calls]
        )


class CandidateCannotSkipEvalTests(unittest.TestCase):
    """M11-05: a candidate cannot be promoted without a passing eval run."""

    def test_promote_refused_without_eval_evidence(self) -> None:
        bridge = FakeHostBridge()
        orch = EvalOrchestrator(bridge)
        # No eval run was ever recorded for this candidate.
        promoted = orch.promote_candidate(
            target_kind=CandidateTargetKind.PROMPT,
            target_version_id="prompt-cand-1",
            eval_run_id="eval-run-1",
            trace_id="t1",
            available_host_capabilities=_capabilities(),
        )
        self.assertFalse(promoted)
        # The host gateway was NEVER called (Python refused to issue it).
        promote_calls = [
            call for call in bridge.calls
            if call[0] == "prompt.promote_candidate"
        ]
        self.assertEqual(promote_calls, [])

    def test_promote_refused_with_wrong_eval_run_id(self) -> None:
        bridge = FakeHostBridge()
        orch = EvalOrchestrator(bridge)
        cases = non_holdout_cases()
        orch.run_eval(
            _run_input(cases=cases),
            available_host_capabilities=_capabilities(),
        )
        # The recorded run id (from the fake host) is "eval-run-host-1".
        # Supply a wrong id → refusal.
        promoted = orch.promote_candidate(
            target_kind=CandidateTargetKind.PROMPT,
            target_version_id="prompt-cand-1",
            eval_run_id="wrong-run-id",
            trace_id="t1",
            available_host_capabilities=_capabilities(),
        )
        self.assertFalse(promoted)

    def test_promote_refused_even_after_a_locally_passing_eval(self) -> None:
        """Round-3 audit (A2): promotion is host-only.

        Previously a locally graded pass was sufficient for the runtime to
        issue the promote call. Grading locally and then promoting on the
        strength of your own grade is exactly the authority the sidecar must
        not hold, so the call is refused unconditionally and never reaches the
        host.
        """
        bridge = FakeHostBridge()
        orch = EvalOrchestrator(bridge)
        cases = non_holdout_cases()
        result = orch.run_eval(
            _run_input(cases=cases),
            available_host_capabilities=_capabilities(),
        )
        self.assertEqual(result.failed_count, 0)
        promoted = orch.promote_candidate(
            target_kind=CandidateTargetKind.PROMPT,
            target_version_id="prompt-cand-1",
            eval_run_id=result.run_id,
            trace_id="t1",
            available_host_capabilities=_capabilities(),
        )
        self.assertFalse(promoted)
        promote_calls = [
            call for call in bridge.calls
            if call[0] == "prompt.promote_candidate"
        ]
        self.assertEqual(promote_calls, [])

    def test_promote_refused_after_failing_eval(self) -> None:
        bridge = FakeHostBridge()
        orch = EvalOrchestrator(bridge)
        cases = non_holdout_cases()
        failing_traces = {c.case_id: {} for c in cases}
        result = orch.run_eval(
            _run_input(cases=cases, traces=failing_traces),
            available_host_capabilities=_capabilities(),
        )
        self.assertFalse(result.passed)
        promoted = orch.promote_candidate(
            target_kind=CandidateTargetKind.PROMPT,
            target_version_id="prompt-cand-1",
            eval_run_id=result.run_id,
            trace_id="t1",
            available_host_capabilities=_capabilities(),
        )
        self.assertFalse(promoted)


class RollbackIsHostOnlyTests(unittest.TestCase):
    """Round-3 audit (A2): rollback is a host-only authority operation.

    Reversing a live version is the same class of authority as activating one,
    and on the sidecar path it had no approval gate at all. The runtime now
    refuses unconditionally and never issues the call.
    """

    def test_rollback_is_refused_and_never_reaches_the_host(self) -> None:
        bridge = FakeHostBridge()
        orch = EvalOrchestrator(bridge)
        rolled = orch.rollback_candidate(
            target_kind=CandidateTargetKind.PROMPT,
            target_version_id="prompt-cand-1",
            base_version_id="prompt-v1",
            trace_id="t1",
            available_host_capabilities=_capabilities(),
        )
        self.assertFalse(rolled)
        self.assertEqual(
            [call for call in bridge.calls if call[0] == "prompt.rollback"],
            [],
        )

    def test_rollback_refuses_even_when_a_host_would_answer(self) -> None:
        """A cooperative host answer must not change the refusal — the gate is
        on the runtime side too, so a future host regression cannot re-open it
        silently."""
        bridge = FakeHostBridge(
            rollback_result={
                "rolledBack": True,
                "restoredVersionId": "prompt-v1",
            }
        )
        orch = EvalOrchestrator(bridge)
        rolled = orch.rollback_candidate(
            target_kind=CandidateTargetKind.PROMPT,
            target_version_id="prompt-cand-1",
            base_version_id="prompt-v1",
            trace_id="t1",
            available_host_capabilities=_capabilities(),
        )
        self.assertFalse(rolled)


class ForbiddenAgentToolsTests(unittest.TestCase):
    """M11-06: forbidden online self-modifying prompt tools."""

    def test_forbidden_tools_blacklist(self) -> None:
        self.assertEqual(
            FORBIDDEN_AGENT_TOOLS,
            frozenset(
                {
                    "update_system_prompt",
                    "edit_soul",
                    "install_unreviewed_skill",
                }
            ),
        )

    def test_is_forbidden_agent_tool(self) -> None:
        bridge = FakeHostBridge()
        orch = EvalOrchestrator(bridge)
        for tool in FORBIDDEN_AGENT_TOOLS:
            self.assertTrue(orch.is_forbidden_agent_tool(tool))
        self.assertFalse(orch.is_forbidden_agent_tool("prompt.propose_candidate"))


class FullLifecycleTests(unittest.TestCase):
    """The runtime-side lifecycle: propose → eval → shadow, then it stops.

    Round-3 audit (A2) cut promote and rollback out of the runtime's reach, so
    the runtime's own lifecycle ends at a graded, explicitly non-authoritative
    shadow result. Activation is a host/UI decision.
    """

    def test_runtime_lifecycle_ends_before_activation(self) -> None:
        bridge = FakeHostBridge()
        orch = EvalOrchestrator(bridge)
        cases = non_holdout_cases()

        # 1. propose — still the runtime's job.
        proposal = CandidateProposal(
            target_kind=CandidateTargetKind.PROMPT,
            target_version_id="prompt-cand-1",
            base_version_id="prompt-v1",
            proposal_json={"body": "improved prompt"},
            rationale="addresses false-merge regression",
        )
        candidate_id = orch.propose_candidate(
            proposal, trace_id="t1", available_host_capabilities=_capabilities()
        )
        self.assertEqual(candidate_id, "prompt-cand-1")

        # 2. offline eval (non-holdout cases only) — graded locally, and
        #    explicitly not promotion evidence.
        eval_result = orch.run_eval(
            _run_input(cases=cases, target_version_id=candidate_id),
            available_host_capabilities=_capabilities(),
        )
        self.assertEqual(eval_result.failed_count, 0)
        self.assertFalse(eval_result.passed)

        # 3. shadow run (no user-visible side effect)
        shadow_result = orch.run_shadow(
            _run_input(
                cases=cases,
                target_version_id=candidate_id,
                shadow=True,
            ),
            available_host_capabilities=_capabilities(),
        )
        self.assertTrue(shadow_result.no_user_visible_side_effect)

        # 4. promote — refused; the runtime cannot activate its own candidate.
        promoted = orch.promote_candidate(
            target_kind=CandidateTargetKind.PROMPT,
            target_version_id=candidate_id,
            eval_run_id=shadow_result.run_id,
            trace_id="t1",
            available_host_capabilities=_capabilities(),
        )
        self.assertFalse(promoted)

        # 5. rollback — likewise refused.
        rolled = orch.rollback_candidate(
            target_kind=CandidateTargetKind.PROMPT,
            target_version_id=candidate_id,
            base_version_id="prompt-v1",
            trace_id="t1",
            available_host_capabilities=_capabilities(),
        )
        self.assertFalse(rolled)

        # No authority call was ever issued.
        attempted = {call[0] for call in bridge.calls}
        self.assertNotIn("prompt.promote_candidate", attempted)
        self.assertNotIn("prompt.rollback", attempted)
        self.assertNotIn("eval.run_case", attempted)

    def test_lifecycle_blocked_when_eval_skipped(self) -> None:
        """A candidate that skips eval cannot be promoted, even if the
        host gateway would otherwise accept it."""
        bridge = FakeHostBridge()
        orch = EvalOrchestrator(bridge)
        candidate_id = orch.propose_candidate(
            CandidateProposal(
                target_kind=CandidateTargetKind.PROMPT,
                target_version_id="prompt-cand-1",
                base_version_id="prompt-v1",
                proposal_json={},
                rationale="x",
            ),
            trace_id="t1",
            available_host_capabilities=_capabilities(),
        )
        # SKIP eval → promote refused.
        promoted = orch.promote_candidate(
            target_kind=CandidateTargetKind.PROMPT,
            target_version_id=candidate_id,
            eval_run_id="eval-run-host-1",
            trace_id="t1",
            available_host_capabilities=_capabilities(),
        )
        self.assertFalse(promoted)


class ExplodingBridgeTests(unittest.TestCase):
    """Even a totally broken host bridge never raises (last-resort boundary)."""

    def test_run_eval_never_raises(self) -> None:
        orch = EvalOrchestrator(ExplodingBridge())
        result = orch.run_eval(
            _run_input(cases=non_holdout_cases()),
            available_host_capabilities=_capabilities(),
        )
        self.assertTrue(result.fallback)
        self.assertFalse(result.passed)

    def test_promote_never_raises(self) -> None:
        orch = EvalOrchestrator(ExplodingBridge())
        # Seed eval evidence so we reach the host call path.
        # (We cannot, with an exploding bridge, so promote returns False
        # without raising.)
        promoted = orch.promote_candidate(
            target_kind=CandidateTargetKind.PROMPT,
            target_version_id="prompt-cand-1",
            eval_run_id="eval-run-1",
            trace_id="t1",
            available_host_capabilities=_capabilities(),
        )
        self.assertFalse(promoted)

    def test_propose_never_raises(self) -> None:
        orch = EvalOrchestrator(ExplodingBridge())
        result = orch.propose_candidate(
            CandidateProposal(
                target_kind=CandidateTargetKind.PROMPT,
                target_version_id="prompt-cand-1",
                base_version_id="prompt-v1",
                proposal_json={},
                rationale="x",
            ),
            trace_id="t1",
            available_host_capabilities=_capabilities(),
        )
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
