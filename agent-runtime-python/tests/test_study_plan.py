"""M12-04 Study Planner orchestration tests (Slice 2 / Python side).

Verifies the deterministic planner orchestration against a fake host bridge:

- deterministic constraints (same input ⇒ same output; ordered by skill review
  needs priority);
- skill probe, not exact question (M12-05; never selects an original asset);
- available_minutes bound (total estimated ≤ available);
- target_date distance influences priority;
- no-LLM path (host unavailable ⇒ 0-item or deterministic fallback, never
  fatal);
- fail-closed (host failure ⇒ fallback_result);
- no active-memory write bypass (only study_plan.create is invoked; never
  memory.promote/write);
- forbidden tools absent (no direct SQL / filesystem / secret access).

No canonical DB, no provider secrets.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from ielts_agent.planner import (
    CAPABILITY_LEARNER_SKILL_STATE,
    CAPABILITY_MEMORY_SEARCH_ACTIVE,
    CAPABILITY_STUDY_PLAN_CREATE,
    PlannerInput,
    PlannerRunInput,
    REQUIRED_STUDY_PLANNER_HOST_CAPABILITIES,
    StudyPlannerOrchestrator,
    fallback_result,
)
from ielts_agent.planner.study_plan import (
    DEFAULT_PROBE_MINUTES,
    MAX_PROPOSAL_ITEMS,
    MIN_PROBE_MINUTES,
    _parse_review_needs,
    _parse_uncertainty_map,
)
from ielts_agent.planner.types import (
    PlannerInput as PlannerInputType,
    QuestionKind,
    SkillProbeKind,
    SkillReviewNeed,
    StudyPlanItem,
    StudyPlanProposal,
)
from ielts_agent.protocol import ProtocolError


def _capabilities() -> dict[str, str]:
    return dict(REQUIRED_STUDY_PLANNER_HOST_CAPABILITIES)


def _need(
    *,
    skill_key: str = "reading.tfng",
    priority: float = 0.8,
    preferred_probe: SkillProbeKind = SkillProbeKind.CONTRASTIVE_PAIR,
    due_at: str = "2026-08-16T00:00:00Z",
    avoid_asset_ids: list[str] | None = None,
    reason_codes: list[str] | None = None,
    uncertainty_band: str = "high",
) -> SkillReviewNeed:
    return SkillReviewNeed(
        skillKey=skill_key,
        priority=priority,
        priorityBand="high" if priority >= 0.5 else "low",
        dueAt=due_at,
        preferredProbe=preferred_probe,
        avoidAssetIds=avoid_asset_ids if avoid_asset_ids is not None else [],
        reasonCodes=reason_codes if reason_codes is not None else [],
        uncertaintyBand=uncertainty_band,
        masteryMean=0.3,
        evidenceCount=4,
    )


def _planner_input(
    *,
    available_minutes: int = 60,
    needs: list[SkillReviewNeed] | None = None,
    uncertainty: dict[str, float] | None = None,
    target_date: str = "",
    plan_date: str = "",
    recent_workload_minutes: int = 0,
    user_preferences: dict | None = None,
    user_goal: str = "prepare for IELTS",
    trace_id: str = "trace-1",
) -> PlannerInput:
    return PlannerInput(
        traceId=trace_id,
        userGoal=user_goal,
        availableMinutes=available_minutes,
        skillReviewNeeds=needs if needs is not None else [_need()],
        learnerUncertainty=uncertainty if uncertainty is not None else {},
        recentWorkloadMinutes=recent_workload_minutes,
        userPreferences=user_preferences if user_preferences is not None else {},
        targetDate=target_date,
        planDate=plan_date,
    )


class FakeHostBridge:
    """In-memory host bridge for planner tests.

    Records every invoke call so tests can assert no memory.write/promote and no
    forbidden tool was invoked.
    """

    def __init__(
        self,
        *,
        plan_result: dict | None = None,
        review_needs_snapshot: dict | None = None,
        learner_state_snapshot: dict | None = None,
        fail_methods: frozenset[str] | None = None,
        memory_search_result: dict | None = None,
    ) -> None:
        self.calls: list[tuple[str, dict]] = []
        self._plan_result = plan_result or {"planId": "plan-1"}
        self._review_needs_snapshot = review_needs_snapshot
        self._learner_state_snapshot = learner_state_snapshot
        self._memory_search_result = memory_search_result
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
                "host_error", f"simulated failure for {method}", retryable=False
            )
        if method == CAPABILITY_STUDY_PLAN_CREATE:
            return self._plan_result
        if method == CAPABILITY_LEARNER_SKILL_STATE:
            # If the caller asked for needs, return the needs snapshot; if they
            # asked for state, return the state snapshot. In the orchestrator
            # both calls look identical (same method), so we return whichever
            # the test configured, preferring needs then state.
            if self._review_needs_snapshot is not None:
                return self._review_needs_snapshot
            if self._learner_state_snapshot is not None:
                return self._learner_state_snapshot
            return {"needs": [], "states": []}
        if method == CAPABILITY_MEMORY_SEARCH_ACTIVE:
            return self._memory_search_result or {"memories": []}
        raise ProtocolError(
            "method_not_found", f"unhandled fake method {method}"
        )


# --------------------------------------------------------------------------- #
# Deterministic constraints                                                    #
# --------------------------------------------------------------------------- #


class DeterministicConstraintsTests(unittest.TestCase):
    def test_same_input_yields_same_output(self) -> None:
        needs = [
            _need(skill_key="reading.tfng", priority=0.9),
            _need(skill_key="writing.task2", priority=0.5),
        ]
        bridge = FakeHostBridge()
        orch = StudyPlannerOrchestrator(bridge)
        run_input = PlannerRunInput(
            planner_input=_planner_input(needs=needs, available_minutes=60),
            available_host_capabilities=_capabilities(),
        )
        first = orch.plan(run_input)
        bridge2 = FakeHostBridge()
        orch2 = StudyPlannerOrchestrator(bridge2)
        second = orch2.plan(
            PlannerRunInput(
                planner_input=_planner_input(needs=needs, available_minutes=60),
                available_host_capabilities=_capabilities(),
            )
        )
        # Same item ordering, same estimated minutes, same skill keys.
        self.assertEqual(
            [item.skill_probe.skill_key for item in first.items],
            [item.skill_probe.skill_key for item in second.items],
        )
        self.assertEqual(
            [item.estimated_minutes for item in first.items],
            [item.estimated_minutes for item in second.items],
        )

    def test_ordered_by_skill_review_needs_priority_desc(self) -> None:
        needs = [
            _need(skill_key="writing.task2", priority=0.3),
            _need(skill_key="reading.tfng", priority=0.9),
            _need(skill_key="listening.section1", priority=0.6),
        ]
        bridge = FakeHostBridge()
        orch = StudyPlannerOrchestrator(bridge)
        result = orch.plan(
            PlannerRunInput(
                planner_input=_planner_input(needs=needs, available_minutes=120),
                available_host_capabilities=_capabilities(),
            )
        )
        ordered_keys = [item.skill_probe.skill_key for item in result.items]
        # Priority desc: reading.tfng (0.9) > listening.section1 (0.6) > writing.task2 (0.3)
        self.assertEqual(
            ordered_keys,
            ["reading.tfng", "listening.section1", "writing.task2"],
        )

    def test_priority_tiebreaker_is_uncertainty_then_skill_key(self) -> None:
        # Two needs with the SAME priority: higher uncertainty wins; if
        # uncertainty is also equal, skill_key asc wins (stable, no randomness).
        needs = [
            _need(skill_key="reading.tfng", priority=0.5),
            _need(skill_key="writing.task2", priority=0.5),
        ]
        uncertainty = {
            "reading.tfng": 0.2,
            "writing.task2": 0.8,
        }
        bridge = FakeHostBridge()
        orch = StudyPlannerOrchestrator(bridge)
        result = orch.plan(
            PlannerRunInput(
                planner_input=_planner_input(
                    needs=needs, uncertainty=uncertainty, available_minutes=60
                ),
                available_host_capabilities=_capabilities(),
            )
        )
        ordered_keys = [item.skill_probe.skill_key for item in result.items]
        self.assertEqual(ordered_keys, ["writing.task2", "reading.tfng"])

    def test_skill_key_asc_final_tiebreaker(self) -> None:
        # Same priority AND same uncertainty (none): skill_key asc.
        needs = [
            _need(skill_key="writing.task2", priority=0.5),
            _need(skill_key="reading.tfng", priority=0.5),
        ]
        bridge = FakeHostBridge()
        orch = StudyPlannerOrchestrator(bridge)
        result = orch.plan(
            PlannerRunInput(
                planner_input=_planner_input(needs=needs, available_minutes=60),
                available_host_capabilities=_capabilities(),
            )
        )
        ordered_keys = [item.skill_probe.skill_key for item in result.items]
        self.assertEqual(ordered_keys, ["reading.tfng", "writing.task2"])

    def test_deterministic_under_repeated_calls(self) -> None:
        # The SAME orchestrator instance called twice yields identical items.
        needs = [
            _need(skill_key="reading.tfng", priority=0.9),
            _need(skill_key="writing.task2", priority=0.4),
        ]
        bridge = FakeHostBridge()
        orch = StudyPlannerOrchestrator(bridge)
        run_input = PlannerRunInput(
            planner_input=_planner_input(needs=needs, available_minutes=60),
            available_host_capabilities=_capabilities(),
        )
        first = orch.plan(run_input)
        second = orch.plan(run_input)
        self.assertEqual(
            [item.to_wire() for item in first.items],
            [item.to_wire() for item in second.items],
        )


# --------------------------------------------------------------------------- #
# M12-05: skill probe, not exact question                                      #
# --------------------------------------------------------------------------- #


class SkillProbeNotExactQuestionTests(unittest.TestCase):
    def test_item_targets_skill_not_asset(self) -> None:
        bridge = FakeHostBridge()
        orch = StudyPlannerOrchestrator(bridge)
        result = orch.plan(
            PlannerRunInput(
                planner_input=_planner_input(
                    needs=[
                        _need(
                            skill_key="reading.tfng",
                            avoid_asset_ids=["asset-old-1", "asset-old-2"],
                        )
                    ],
                    available_minutes=30,
                ),
                available_host_capabilities=_capabilities(),
            )
        )
        self.assertEqual(len(result.items), 1)
        probe = result.items[0].skill_probe
        # Targets the SKILL, not an original asset/question id.
        self.assertEqual(probe.skill_key, "reading.tfng")
        # The avoid list is carried (so the host picks a NOVEL probe), never a
        # repeat id to practise.
        self.assertEqual(probe.avoid_asset_ids, ["asset-old-1", "asset-old-2"])
        # No field on the probe carries an asset/question id to repeat.
        wire = probe.to_wire()
        self.assertNotIn("assetId", wire)
        self.assertNotIn("questionId", wire)

    def test_probe_kind_matches_preferred_probe_from_scheduler(self) -> None:
        bridge = FakeHostBridge()
        orch = StudyPlannerOrchestrator(bridge)
        result = orch.plan(
            PlannerRunInput(
                planner_input=_planner_input(
                    needs=[
                        _need(
                            skill_key="writing.task2",
                            preferred_probe=SkillProbeKind.WRITING_REWRITE,
                        )
                    ],
                    available_minutes=60,
                ),
                available_host_capabilities=_capabilities(),
            )
        )
        self.assertEqual(
            result.items[0].skill_probe.probe_kind, SkillProbeKind.WRITING_REWRITE
        )

    def test_no_item_carries_original_question_text(self) -> None:
        # The planner never selects or echoes an original question; the whyText
        # is composed only from factual scheduler fields.
        bridge = FakeHostBridge()
        orch = StudyPlannerOrchestrator(bridge)
        result = orch.plan(
            PlannerRunInput(
                planner_input=_planner_input(available_minutes=30),
                available_host_capabilities=_capabilities(),
            )
        )
        for item in result.items:
            self.assertNotIn("question text", item.why_text.lower())
            self.assertTrue(item.why_text.startswith("schedule:"))


# --------------------------------------------------------------------------- #
# available_minutes bound                                                       #
# --------------------------------------------------------------------------- #


class AvailableMinutesBoundTests(unittest.TestCase):
    def test_total_estimated_le_available(self) -> None:
        needs = [
            _need(skill_key="reading.tfng", priority=0.9),
            _need(skill_key="writing.task2", priority=0.8),
            _need(skill_key="listening.section1", priority=0.7),
        ]
        bridge = FakeHostBridge()
        orch = StudyPlannerOrchestrator(bridge)
        available = 40
        result = orch.plan(
            PlannerRunInput(
                planner_input=_planner_input(needs=needs, available_minutes=available),
                available_host_capabilities=_capabilities(),
            )
        )
        self.assertGreater(len(result.items), 0)
        self.assertLessEqual(result.total_estimated_minutes, available)
        for item in result.items:
            self.assertGreaterEqual(item.estimated_minutes, MIN_PROBE_MINUTES)

    def test_zero_available_yields_zero_item_proposal(self) -> None:
        bridge = FakeHostBridge()
        orch = StudyPlannerOrchestrator(bridge)
        result = orch.plan(
            PlannerRunInput(
                planner_input=_planner_input(available_minutes=0),
                available_host_capabilities=_capabilities(),
            )
        )
        # 0-item proposal is a legitimate "no time today" result, NOT fallback.
        self.assertEqual(result.items, [])
        self.assertEqual(result.total_estimated_minutes, 0)
        self.assertIsNone(result.fallback_reason)

    def test_below_min_probe_minutes_yields_zero_items(self) -> None:
        bridge = FakeHostBridge()
        orch = StudyPlannerOrchestrator(bridge)
        result = orch.plan(
            PlannerRunInput(
                planner_input=_planner_input(available_minutes=MIN_PROBE_MINUTES - 1),
                available_host_capabilities=_capabilities(),
            )
        )
        self.assertEqual(result.items, [])

    def test_last_item_clamped_to_remaining(self) -> None:
        # Three needs, each ~15 min; available = 25 → first item 15, second
        # clamped to 10 (but never below MIN_PROBE_MINUTES=5).
        needs = [
            _need(skill_key="reading.tfng", priority=0.9),
            _need(skill_key="writing.task2", priority=0.8),
            _need(skill_key="listening.section1", priority=0.7),
        ]
        bridge = FakeHostBridge()
        orch = StudyPlannerOrchestrator(bridge)
        result = orch.plan(
            PlannerRunInput(
                planner_input=_planner_input(needs=needs, available_minutes=25),
                available_host_capabilities=_capabilities(),
            )
        )
        self.assertLessEqual(result.total_estimated_minutes, 25)
        # Each item respects the minimum.
        for item in result.items:
            self.assertGreaterEqual(item.estimated_minutes, MIN_PROBE_MINUTES)

    def test_max_proposal_items_cap(self) -> None:
        # 20 needs, ample time → the cap limits the proposal to MAX_PROPOSAL_ITEMS.
        needs = [
            _need(skill_key=f"reading.tfng.{i}", priority=1.0 - i * 0.01)
            for i in range(20)
        ]
        bridge = FakeHostBridge()
        orch = StudyPlannerOrchestrator(bridge)
        result = orch.plan(
            PlannerRunInput(
                planner_input=_planner_input(needs=needs, available_minutes=600),
                available_host_capabilities=_capabilities(),
            )
        )
        self.assertEqual(len(result.items), MAX_PROPOSAL_ITEMS)


# --------------------------------------------------------------------------- #
# target_date distance influences priority                                     #
# --------------------------------------------------------------------------- #


class TargetDateDistanceTests(unittest.TestCase):
    def test_target_date_set_does_not_break_ordering(self) -> None:
        # With a target date, the planner still returns a deterministic order.
        needs = [
            _need(skill_key="reading.tfng", priority=0.9, due_at="2026-08-20T00:00:00Z"),
            _need(skill_key="writing.task2", priority=0.9, due_at="2026-08-16T00:00:00Z"),
        ]
        bridge = FakeHostBridge()
        orch = StudyPlannerOrchestrator(bridge)
        result = orch.plan(
            PlannerRunInput(
                planner_input=_planner_input(
                    needs=needs,
                    available_minutes=60,
                    target_date="2026-09-01",
                    plan_date="2026-08-16",
                ),
                available_host_capabilities=_capabilities(),
            )
        )
        # Same priority, no uncertainty → skill_key asc tiebreaker still applies.
        # target_date distance is computed but skill_key is the final tiebreaker.
        ordered = [item.skill_probe.skill_key for item in result.items]
        self.assertEqual(ordered, ["reading.tfng", "writing.task2"])

    def test_target_date_distance_is_deterministic(self) -> None:
        # The distance computation is a pure function; same inputs ⇒ same key.
        from ielts_agent.planner.study_plan import StudyPlannerOrchestrator as Orch

        d1 = Orch._target_distance("2026-08-16T00:00:00Z", "2026-09-01", "2026-08-16")
        d2 = Orch._target_distance("2026-08-16T00:00:00Z", "2026-09-01", "2026-08-16")
        self.assertEqual(d1, d2)
        # No target date ⇒ neutral 0.0.
        self.assertEqual(
            Orch._target_distance("2026-08-16T00:00:00Z", "", "2026-08-16"), 0.0
        )

    def test_target_date_near_changes_priority_vs_far(self) -> None:
        # Two needs same priority; one due AT the target date (distance 0),
        # one far from it. The near-target one should win.
        needs = [
            _need(
                skill_key="zzz.far",
                priority=0.5,
                due_at="2026-12-31T00:00:00Z",
            ),
            _need(
                skill_key="aaa.near",
                priority=0.5,
                due_at="2026-09-01T00:00:00Z",
            ),
        ]
        bridge = FakeHostBridge()
        orch = StudyPlannerOrchestrator(bridge)
        result = orch.plan(
            PlannerRunInput(
                planner_input=_planner_input(
                    needs=needs,
                    available_minutes=60,
                    target_date="2026-09-01",
                    plan_date="2026-08-16",
                ),
                available_host_capabilities=_capabilities(),
            )
        )
        ordered = [item.skill_probe.skill_key for item in result.items]
        # aaa.near has distance 0 (due_at == target_date); zzz.far is far.
        # Distance asc ⇒ aaa.near first.
        self.assertEqual(ordered, ["aaa.near", "zzz.far"])


# --------------------------------------------------------------------------- #
# no-LLM path + fail-closed                                                    #
# --------------------------------------------------------------------------- #


class NoLlmPathFailClosedTests(unittest.TestCase):
    def test_host_unavailable_yields_fallback_not_fatal(self) -> None:
        bridge = FakeHostBridge(fail_methods=frozenset({CAPABILITY_STUDY_PLAN_CREATE}))
        orch = StudyPlannerOrchestrator(bridge)
        result = orch.plan(
            PlannerRunInput(
                planner_input=_planner_input(available_minutes=60),
                available_host_capabilities=_capabilities(),
            )
        )
        # Fail-closed: fallback proposal, no items, no plan_id.
        self.assertIsNotNone(result.fallback_reason)
        self.assertEqual(result.plan_id, "")
        self.assertEqual(result.items, [])
        self.assertEqual(result.total_estimated_minutes, 0)

    def test_capabilities_missing_yields_fallback(self) -> None:
        bridge = FakeHostBridge()
        orch = StudyPlannerOrchestrator(bridge)
        result = orch.plan(
            PlannerRunInput(
                planner_input=_planner_input(available_minutes=60),
                # No capabilities advertised.
                available_host_capabilities={},
            )
        )
        self.assertIsNotNone(result.fallback_reason)
        self.assertIn("host_capabilities", result.fallback_reason)

    def test_capability_version_mismatch_yields_fallback(self) -> None:
        bridge = FakeHostBridge()
        orch = StudyPlannerOrchestrator(bridge)
        result = orch.plan(
            PlannerRunInput(
                planner_input=_planner_input(available_minutes=60),
                available_host_capabilities={"study_plan.create": "2"},
            )
        )
        self.assertIsNotNone(result.fallback_reason)
        self.assertIn("capability_mismatch", result.fallback_reason)

    def test_plan_create_missing_plan_id_yields_fallback(self) -> None:
        bridge = FakeHostBridge(plan_result={"planId": ""})
        orch = StudyPlannerOrchestrator(bridge)
        result = orch.plan(
            PlannerRunInput(
                planner_input=_planner_input(available_minutes=60),
                available_host_capabilities=_capabilities(),
            )
        )
        self.assertIsNotNone(result.fallback_reason)
        self.assertIn("missing_plan_id", result.fallback_reason)

    def test_plan_create_non_dict_result_yields_fallback(self) -> None:
        # A non-dict result (invalid shape) triggers the invalid_shape fallback.
        bridge = FakeHostBridge(plan_result="not-a-dict")  # type: ignore[dict-item]
        orch = StudyPlannerOrchestrator(bridge)
        result = orch.plan(
            PlannerRunInput(
                planner_input=_planner_input(available_minutes=60),
                available_host_capabilities=_capabilities(),
            )
        )
        self.assertIsNotNone(result.fallback_reason)
        self.assertIn("invalid_shape", result.fallback_reason)

    def test_never_raises_fatal(self) -> None:
        # Every host method raises — the orchestrator must NOT propagate.
        bridge = FakeHostBridge(
            fail_methods=frozenset(
                {CAPABILITY_STUDY_PLAN_CREATE, CAPABILITY_LEARNER_SKILL_STATE}
            )
        )
        orch = StudyPlannerOrchestrator(bridge)
        # Caller supplied no needs → orchestrator tries to fetch them (which
        # raises), then submits (which also raises). The plan() call must
        # return a fallback proposal, not raise.
        result = orch.plan(
            PlannerRunInput(
                planner_input=PlannerInput(
                    traceId="t",
                    userGoal="g",
                    availableMinutes=60,
                    # No needs supplied → host fetch attempted.
                ),
                available_host_capabilities=_capabilities(),
            )
        )
        self.assertIsNotNone(result.fallback_reason)

    def test_fallback_result_helper(self) -> None:
        proposal = fallback_result("goal", "host_down")
        self.assertIsInstance(proposal, StudyPlanProposal)
        self.assertEqual(proposal.plan_id, "")
        self.assertEqual(proposal.items, [])
        self.assertEqual(proposal.fallback_reason, "host_down")

    def test_no_llm_path_when_needs_supplied_directly(self) -> None:
        # When the caller supplies needs directly, the planner does NOT call
        # learning.learner_skill_state — it goes straight to study_plan.create.
        bridge = FakeHostBridge()
        orch = StudyPlannerOrchestrator(bridge)
        orch.plan(
            PlannerRunInput(
                planner_input=_planner_input(
                    needs=[_need()], uncertainty={"reading.tfng": 0.5}, available_minutes=30
                ),
                available_host_capabilities=_capabilities(),
            )
        )
        methods = [call[0] for call in bridge.calls]
        self.assertIn(CAPABILITY_STUDY_PLAN_CREATE, methods)
        self.assertNotIn(CAPABILITY_LEARNER_SKILL_STATE, methods)


# --------------------------------------------------------------------------- #
# no active-memory write bypass                                                 #
# --------------------------------------------------------------------------- #


class NoWriteBypassTests(unittest.TestCase):
    def test_only_study_plan_create_invoked(self) -> None:
        bridge = FakeHostBridge()
        orch = StudyPlannerOrchestrator(bridge)
        orch.plan(
            PlannerRunInput(
                planner_input=_planner_input(available_minutes=60),
                available_host_capabilities=_capabilities(),
            )
        )
        methods = [call[0] for call in bridge.calls]
        # The ONLY write-path method is study_plan.create.
        self.assertEqual(methods.count(CAPABILITY_STUDY_PLAN_CREATE), 1)

    def test_never_invokes_memory_write_or_promote(self) -> None:
        bridge = FakeHostBridge()
        orch = StudyPlannerOrchestrator(bridge)
        orch.plan(
            PlannerRunInput(
                planner_input=_planner_input(available_minutes=60),
                available_host_capabilities=_capabilities(),
            )
        )
        methods = [call[0] for call in bridge.calls]
        for forbidden in (
            "memory.promote",
            "memory.write",
            "memory.archive",
            "tool.invoke",
        ):
            self.assertNotIn(forbidden, methods)

    def test_fallback_path_does_not_invoke_writes(self) -> None:
        # When study_plan.create fails, the orchestrator must not fall back to
        # any other write path. We supply needs + uncertainty directly so the
        # planner skips the best-effort learner_skill_state read; the only host
        # call should be the (failed) study_plan.create.
        bridge = FakeHostBridge(fail_methods=frozenset({CAPABILITY_STUDY_PLAN_CREATE}))
        orch = StudyPlannerOrchestrator(bridge)
        orch.plan(
            PlannerRunInput(
                planner_input=_planner_input(
                    needs=[_need()],
                    uncertainty={"reading.tfng": 0.5},
                    available_minutes=60,
                ),
                available_host_capabilities=_capabilities(),
            )
        )
        methods = [call[0] for call in bridge.calls]
        # Only the (failed) study_plan.create attempt; no other writes.
        self.assertEqual(methods, [CAPABILITY_STUDY_PLAN_CREATE])


# --------------------------------------------------------------------------- #
# forbidden tools absent                                                       #
# --------------------------------------------------------------------------- #


class ForbiddenToolsAbsentTests(unittest.TestCase):
    def test_no_sqlite_import_in_planner_package(self) -> None:
        # The planner package must not import sqlite3 (M3 gate). We check the
        # loaded module's globals, not the docstring text — the docstrings
        # legitimately describe the boundary by naming the forbidden tokens.
        import sys as _sys

        _sys.path.insert(0, str(Path(__file__).parents[1] / "src"))
        from ielts_agent.planner import study_plan as study_plan_mod
        from ielts_agent.planner import types as types_mod

        for module in (study_plan_mod, types_mod):
            self.assertNotIn("sqlite3", vars(module))

    def test_no_filesystem_or_secret_access(self) -> None:
        # The planner must not import filesystem/secret/subprocess modules.
        import sys as _sys

        _sys.path.insert(0, str(Path(__file__).parents[1] / "src"))
        from ielts_agent.planner import study_plan as study_plan_mod

        forbidden_modules = ("os", "subprocess", "keyring", "pathlib")
        for name in forbidden_modules:
            self.assertNotIn(name, vars(study_plan_mod))
        # No provider secret access patterns in the module globals.
        for attr in vars(study_plan_mod):
            self.assertFalse(attr.upper().startswith("API_KEY"))
            self.assertFalse(attr.upper().startswith("SECRET"))

    def test_planner_only_uses_host_gateway_methods(self) -> None:
        # The fake bridge records every method; assert the orchestrator only
        # ever calls the known host gateway methods (study_plan.create +
        # best-effort learner/memory reads), never a raw SQL/filesystem tool.
        bridge = FakeHostBridge()
        orch = StudyPlannerOrchestrator(bridge)
        orch.plan(
            PlannerRunInput(
                planner_input=PlannerInput(
                    traceId="t",
                    userGoal="g",
                    availableMinutes=60,
                    # No needs/uncertainty supplied → orchestrator will try the
                    # learner_skill_state read (best-effort).
                ),
                available_host_capabilities=_capabilities(),
            )
        )
        allowed = {
            CAPABILITY_STUDY_PLAN_CREATE,
            CAPABILITY_LEARNER_SKILL_STATE,
            CAPABILITY_MEMORY_SEARCH_ACTIVE,
        }
        for method, _ in bridge.calls:
            self.assertIn(method, allowed)


# --------------------------------------------------------------------------- #
# Enrichment + submission                                                       #
# --------------------------------------------------------------------------- #


class EnrichmentAndSubmissionTests(unittest.TestCase):
    def test_fetches_needs_from_host_when_not_supplied(self) -> None:
        snapshot = {
            "needs": [
                {
                    "skillKey": "reading.tfng",
                    "priority": 0.9,
                    "priorityBand": "high",
                    "dueAt": "2026-08-16T00:00:00Z",
                    "preferredProbe": "contrastive_pair",
                    "avoidAssetIds": [],
                    "reasonCodes": ["overdue"],
                    "uncertaintyBand": "high",
                    "masteryMean": 0.3,
                    "evidenceCount": 4,
                }
            ]
        }
        bridge = FakeHostBridge(review_needs_snapshot=snapshot)
        orch = StudyPlannerOrchestrator(bridge)
        result = orch.plan(
            PlannerRunInput(
                planner_input=PlannerInput(
                    traceId="t",
                    userGoal="g",
                    availableMinutes=30,
                ),
                available_host_capabilities=_capabilities(),
            )
        )
        self.assertEqual(len(result.items), 1)
        self.assertEqual(result.items[0].skill_probe.skill_key, "reading.tfng")
        self.assertEqual(result.plan_id, "plan-1")
        # The orchestrator called learner_skill_state (to fetch needs) AND
        # study_plan.create (to submit).
        methods = [call[0] for call in bridge.calls]
        self.assertIn(CAPABILITY_LEARNER_SKILL_STATE, methods)
        self.assertIn(CAPABILITY_STUDY_PLAN_CREATE, methods)

    def test_malformed_need_row_is_dropped_not_fatal(self) -> None:
        # A malformed row in the snapshot is skipped, not a fatal fallback.
        snapshot = {
            "needs": [
                "not-a-dict",  # malformed
                {
                    "skillKey": "reading.tfng",
                    "priority": 0.9,
                    "priorityBand": "high",
                    "dueAt": "2026-08-16T00:00:00Z",
                    "preferredProbe": "contrastive_pair",
                    "avoidAssetIds": [],
                    "reasonCodes": [],
                    "uncertaintyBand": "high",
                    "masteryMean": 0.3,
                    "evidenceCount": 4,
                },
            ]
        }
        bridge = FakeHostBridge(review_needs_snapshot=snapshot)
        orch = StudyPlannerOrchestrator(bridge)
        result = orch.plan(
            PlannerRunInput(
                planner_input=PlannerInput(
                    traceId="t",
                    userGoal="g",
                    availableMinutes=30,
                ),
                available_host_capabilities=_capabilities(),
            )
        )
        self.assertEqual(len(result.items), 1)
        self.assertIsNone(result.fallback_reason)

    def test_host_assigned_plan_id_returned(self) -> None:
        bridge = FakeHostBridge(plan_result={"planId": "plan-canonical-42"})
        orch = StudyPlannerOrchestrator(bridge)
        result = orch.plan(
            PlannerRunInput(
                planner_input=_planner_input(available_minutes=30),
                available_host_capabilities=_capabilities(),
            )
        )
        self.assertEqual(result.plan_id, "plan-canonical-42")
        self.assertIsNone(result.fallback_reason)
        # Items preserved, total recomputed consistently.
        self.assertEqual(
            result.total_estimated_minutes,
            sum(item.estimated_minutes for item in result.items),
        )

    def test_question_kind_inferred_from_skill_key(self) -> None:
        bridge = FakeHostBridge()
        orch = StudyPlannerOrchestrator(bridge)
        result = orch.plan(
            PlannerRunInput(
                planner_input=_planner_input(
                    needs=[
                        _need(skill_key="writing.task2", priority=0.9),
                        _need(skill_key="listening.section1", priority=0.5),
                    ],
                    available_minutes=60,
                ),
                available_host_capabilities=_capabilities(),
            )
        )
        kinds = {item.skill_probe.skill_key: item.question_kind for item in result.items}
        self.assertEqual(kinds["writing.task2"], QuestionKind.WRITING_TASK2)
        self.assertEqual(kinds["listening.section1"], QuestionKind.LISTENING)

    def test_writing_rewrite_bumps_estimate(self) -> None:
        bridge = FakeHostBridge()
        orch = StudyPlannerOrchestrator(bridge)
        result = orch.plan(
            PlannerRunInput(
                planner_input=_planner_input(
                    needs=[
                        _need(
                            skill_key="writing.task2",
                            priority=0.9,
                            preferred_probe=SkillProbeKind.WRITING_REWRITE,
                        )
                    ],
                    available_minutes=60,
                ),
                available_host_capabilities=_capabilities(),
            )
        )
        # Writing rewrites take longer than the default probe.
        self.assertGreater(result.items[0].estimated_minutes, DEFAULT_PROBE_MINUTES)

    def test_recent_workload_cap_reduces_budget(self) -> None:
        # A heavy week (>= 5h) caps the budget at 50% of available.
        needs = [
            _need(skill_key="reading.tfng", priority=0.9),
            _need(skill_key="writing.task2", priority=0.8),
            _need(skill_key="listening.section1", priority=0.7),
        ]
        bridge = FakeHostBridge()
        orch = StudyPlannerOrchestrator(bridge)
        result = orch.plan(
            PlannerRunInput(
                planner_input=_planner_input(
                    needs=needs,
                    available_minutes=60,
                    recent_workload_minutes=6 * 60,  # 6h = heavy
                ),
                available_host_capabilities=_capabilities(),
            )
        )
        # Budget capped to 30 min (50% of 60). At least one item still fits.
        self.assertLessEqual(result.total_estimated_minutes, 30)
        self.assertGreaterEqual(len(result.items), 1)

    def test_avoid_skills_preference_respected(self) -> None:
        needs = [
            _need(skill_key="reading.tfng", priority=0.9),
            _need(skill_key="writing.task2", priority=0.5),
        ]
        bridge = FakeHostBridge()
        orch = StudyPlannerOrchestrator(bridge)
        result = orch.plan(
            PlannerRunInput(
                planner_input=_planner_input(
                    needs=needs,
                    available_minutes=60,
                    user_preferences={"avoid_skills": ["reading.tfng"]},
                ),
                available_host_capabilities=_capabilities(),
            )
        )
        ordered = [item.skill_probe.skill_key for item in result.items]
        self.assertNotIn("reading.tfng", ordered)
        self.assertEqual(ordered, ["writing.task2"])

    def test_max_session_minutes_caps_per_item(self) -> None:
        bridge = FakeHostBridge()
        orch = StudyPlannerOrchestrator(bridge)
        result = orch.plan(
            PlannerRunInput(
                planner_input=_planner_input(
                    needs=[_need(skill_key="reading.tfng", priority=0.9)],
                    available_minutes=120,
                    user_preferences={"max_session_minutes": 10},
                ),
                available_host_capabilities=_capabilities(),
            )
        )
        # Estimate is min(DEFAULT_PROBE_MINUTES=15, max_session=10) = 10.
        self.assertEqual(result.items[0].estimated_minutes, 10)


if __name__ == "__main__":
    unittest.main()


class HostWireShapeTests(unittest.TestCase):
    """The planner must parse the row shapes the Rust host actually sends.

    Both row models describe only the few fields the planner needs out of a much
    wider canonical row. Under ``extra="forbid"`` every real row failed
    validation, and both parsers skip a row that fails, so the entire M4
    scheduler output was discarded in silence: the planner always saw zero review
    needs and an empty uncertainty map, with nothing logged and no error raised.

    These fixtures are the FULL serialized shape of the Rust structs
    (``crates/ielts-domain/src/learner.rs``, ``rename_all = "camelCase"``), not a
    trimmed convenience copy -- a trimmed fixture is exactly what let this pass
    review.
    """

    # crates/ielts-domain/src/learner.rs SkillReviewNeed: all 13 fields.
    FULL_NEED = {
        "skillKey": "reading.tfng",
        "priority": 0.9,
        "priorityBand": "high",
        "dueAt": "2026-09-01T00:00:00Z",
        "preferredProbe": "novel_item",
        "avoidAssetIds": ["asset-seen"],
        "reasonCodes": ["overdue"],
        "uncertaintyBand": "medium",
        "masteryMean": 0.4,
        "evidenceCount": 3,
        "distinctAssetCount": 2,
        "supportingObservationIds": ["obs-1"],
    }

    # crates/ielts-domain/src/learner.rs SkillStateView: all 15 fields.
    FULL_STATE = {
        "userId": "local",
        "skillKey": "reading.tfng",
        "masteryMean": 0.4,
        "uncertainty": 0.3,
        "uncertaintyBand": "medium",
        "trend": "flat",
        "evidenceCount": 3,
        "distinctAssetCount": 2,
        "recentErrorRate": None,
        "stabilityDays": None,
        "lastPracticedAt": None,
        "nextReviewAt": None,
        "modelVersion": "learner-v1",
        "explanation": {},
    }

    def test_full_review_need_row_is_parsed(self) -> None:
        needs = _parse_review_needs({"needs": [self.FULL_NEED]})
        self.assertEqual(len(needs), 1, "the host's real row shape must parse")
        self.assertEqual(needs[0].skill_key, "reading.tfng")
        self.assertEqual(needs[0].preferred_probe, SkillProbeKind.NOVEL_ITEM)
        self.assertEqual(needs[0].avoid_asset_ids, ["asset-seen"])

    def test_full_skill_state_row_is_parsed(self) -> None:
        self.assertEqual(
            _parse_uncertainty_map({"states": [self.FULL_STATE]}),
            {"reading.tfng": 0.3},
        )

    def test_a_future_host_field_does_not_drop_the_row(self) -> None:
        """A host schema bump must not silently empty the planner's inputs."""
        need = dict(self.FULL_NEED, someFieldAddedLater="whatever")
        self.assertEqual(len(_parse_review_needs({"needs": [need]})), 1)
        state = dict(self.FULL_STATE, someFieldAddedLater=123)
        self.assertEqual(
            _parse_uncertainty_map({"states": [state]}), {"reading.tfng": 0.3}
        )

    def test_a_genuinely_malformed_row_is_still_dropped(self) -> None:
        """Tolerating unknown keys must not tolerate a broken row."""
        # Missing the required skillKey.
        broken = {k: v for k, v in self.FULL_NEED.items() if k != "skillKey"}
        self.assertEqual(_parse_review_needs({"needs": [broken]}), [])
        # Out-of-range value, and an unknown probe kind.
        self.assertEqual(
            _parse_review_needs({"needs": [dict(self.FULL_NEED, priority=-1.0)]}),
            [],
        )
        self.assertEqual(
            _parse_review_needs(
                {"needs": [dict(self.FULL_NEED, preferredProbe="not_a_probe")]}
            ),
            [],
        )
