"""M10 strategy evaluation orchestrator tests (Slice 2 / Python side)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from pydantic import ValidationError

from ielts_agent.coach.strategy_eval import (
    CONFIDENCE_NEUTRAL_PRIOR,
    DEFAULT_OUTCOME_WINDOW,
    EXPLORATION_CAP,
    MIN_EXPLORATION_EVIDENCE,
    AggregatedReward,
    OutcomeScanInput,
    SelectionInput,
    StrategyEvaluationOrchestrator,
    fallback_result,
)
from ielts_agent.coach.types import (
    CAPABILITY_STRATEGY_RECORD_ASSIGNMENT,
    CAPABILITY_STRATEGY_RECORD_FEEDBACK,
    CAPABILITY_STRATEGY_RECORD_OUTCOME,
    CAPABILITY_STRATEGY_SELECT,
    CAPABILITY_STRATEGY_USER_STATE,
    OUTCOME_ATTRIBUTION_SCHEMA_VERSION,
    OutcomeAttribution,
    OutcomeAttributionKind,
    REQUIRED_STRATEGY_EVAL_HOST_CAPABILITIES,
    STRATEGY_CATALOG_V1,
    StrategyAssignment,
    StrategyFeedbackKind,
    StrategyOutcomeKind,
    StrategySelection,
    UserStrategyState,
)
from ielts_agent.protocol import ProtocolError


def _capabilities() -> dict[str, str]:
    return dict(REQUIRED_STRATEGY_EVAL_HOST_CAPABILITIES)


def _assignment(
    *,
    strategy_id: str = "evidence_first_v1",
    target_asset_id: str | None = "asset-A",
    skill_keys: tuple[str, ...] = ("reading.tfng",),
    response_message_id: str = "msg-1",
) -> StrategyAssignment:
    return StrategyAssignment(
        strategy_id=strategy_id,
        why_selected="test assignment",
        memory_ids=["mem-1"],
        skill_keys=list(skill_keys),
        context_snapshot_id="snap-1",
        response_message_id=response_message_id,
        target_asset_id=target_asset_id,
    )


def _user_state(
    *,
    strategy_id: str,
    scope: str = "reading.tfng",
    success: int = 0,
    failure: int = 0,
    satisfaction: int = 0,
    reask: int = 0,
    novel_transfer: int = 0,
) -> UserStrategyState:
    return UserStrategyState(
        strategy_id=strategy_id,
        scope=scope,
        success_count=success,
        failure_count=failure,
        satisfaction_count=satisfaction,
        reask_count=reask,
        novel_transfer_success=novel_transfer,
    )


def _observation(
    *,
    obs_id: str = "obs-1",
    skill: str = "reading.tfng.false_vs_not_given",
    asset_id: str | None = "asset-B",
    activity: str | None = None,
) -> dict:
    obs: dict = {"observationId": obs_id, "skill": skill, "assetId": asset_id}
    if activity is not None:
        obs["activity"] = activity
    return obs


class FakeHostBridge:
    """In-memory host bridge for strategy-eval tests."""

    def __init__(
        self,
        *,
        select_result: dict | None = None,
        record_outcome_result: dict | None = None,
        record_assignment_result: dict | None = None,
        record_feedback_result: dict | None = None,
        user_state_result: dict | None = None,
        fail_methods: frozenset[str] | None = None,
    ) -> None:
        self.calls: list[tuple[str, dict]] = []
        self._select_result = select_result or {"recorded": True}
        self._record_outcome_result = record_outcome_result or {"recorded": True}
        self._record_assignment_result = record_assignment_result or {
            "recorded": True
        }
        self._record_feedback_result = record_feedback_result or {
            "recorded": True
        }
        self._user_state_result = user_state_result or {"rows": []}
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
        if method == CAPABILITY_STRATEGY_SELECT:
            return self._select_result
        if method == CAPABILITY_STRATEGY_RECORD_OUTCOME:
            return self._record_outcome_result
        if method == CAPABILITY_STRATEGY_RECORD_ASSIGNMENT:
            return self._record_assignment_result
        if method == CAPABILITY_STRATEGY_RECORD_FEEDBACK:
            return self._record_feedback_result
        if method == CAPABILITY_STRATEGY_USER_STATE:
            return self._user_state_result
        raise ProtocolError("method_not_found", f"unhandled fake method {method}")


class ExplodingBridge(FakeHostBridge):
    def invoke(self, *args, **kwargs):  # type: ignore[override]
        raise RuntimeError("unexpected boom")


class StrategyCatalogTypesTests(unittest.TestCase):
    """M10-01: the v1 catalog is closed at exactly eight ids."""

    def test_catalog_has_exactly_eight_strategies(self) -> None:
        self.assertEqual(len(STRATEGY_CATALOG_V1), 8)
        for sid in (
            "evidence_first_v1",
            "example_first_v1",
            "step_by_step_v1",
            "contrastive_v1",
            "socratic_prompt_v1",
            "concise_direct_v1",
            "error_then_rule_v1",
            "rule_then_example_v1",
        ):
            self.assertIn(sid, STRATEGY_CATALOG_V1)

    def test_feedback_kind_has_exactly_five_values(self) -> None:
        self.assertEqual(
            {k.value for k in StrategyFeedbackKind},
            {
                "thumbs",
                "reask",
                "explicit_correction",
                "abandon",
                "neutral",
            },
        )

    def test_outcome_kind_has_exactly_four_values(self) -> None:
        self.assertEqual(
            {k.value for k in StrategyOutcomeKind},
            {
                "next_novel_skill_attempt",
                "next_writing_revision",
                "corrected_repeated_behavior",
                "transfer_to_another_asset",
            },
        )

    def test_feedback_and_outcome_kinds_are_disjoint(self) -> None:
        """M10-03: satisfaction and learning axes share no value."""
        feedback_values = {k.value for k in StrategyFeedbackKind}
        outcome_values = {k.value for k in StrategyOutcomeKind}
        self.assertTrue(feedback_values.isdisjoint(outcome_values))

    def test_attribution_kind_has_exactly_three_values(self) -> None:
        self.assertEqual(
            {k.value for k in OutcomeAttributionKind},
            {"attributed", "out_of_window", "discounted_same_asset"},
        )

    def test_assignment_rejects_unknown_strategy(self) -> None:
        with self.assertRaises(ValidationError):
            StrategyAssignment.model_validate(
                {
                    "strategyId": "totally_made_up_v1",
                    "whySelected": "x",
                    "contextSnapshotId": "snap-1",
                    "responseMessageId": "msg-1",
                }
            )

    def test_assignment_accepts_all_eight_strategies(self) -> None:
        for sid in STRATEGY_CATALOG_V1:
            a = StrategyAssignment.model_validate(
                {
                    "strategyId": sid,
                    "whySelected": "why",
                    "contextSnapshotId": "snap-1",
                    "responseMessageId": "msg-1",
                }
            )
            self.assertEqual(a.strategy_id, sid)

    def test_assignment_to_wire_roundtrip(self) -> None:
        a = _assignment()
        wire = a.to_wire()
        self.assertEqual(wire["strategyId"], "evidence_first_v1")
        self.assertEqual(wire["targetAssetId"], "asset-A")
        self.assertEqual(wire["schemaVersion"], 1)

    def test_user_state_confidence_bounded_by_schema(self) -> None:
        with self.assertRaises(ValidationError):
            UserStrategyState.model_validate(
                {"strategyId": "evidence_first_v1", "scope": "s", "confidence": 1.5}
            )
        with self.assertRaises(ValidationError):
            UserStrategyState.model_validate(
                {"strategyId": "evidence_first_v1", "scope": "s", "confidence": -0.1}
            )

    def test_selection_rejects_unknown_strategy(self) -> None:
        with self.assertRaises(ValidationError):
            StrategySelection.model_validate(
                {"selectedStrategyId": "not_in_catalog", "why": "x"}
            )

    def test_attribution_attributed_requires_evidence(self) -> None:
        with self.assertRaises(ValidationError):
            OutcomeAttribution.model_validate(
                {
                    "kind": "attributed",
                    "strategyAssignmentId": "a-1",
                }
            )

    def test_attribution_non_attributed_must_not_carry_outcome_kind(self) -> None:
        with self.assertRaises(ValidationError):
            OutcomeAttribution.model_validate(
                {
                    "kind": "out_of_window",
                    "strategyAssignmentId": "a-1",
                    "outcomeKind": "next_novel_skill_attempt",
                }
            )

    def test_attribution_attributed_roundtrip(self) -> None:
        o = OutcomeAttribution.model_validate(
            {
                "kind": "attributed",
                "strategyAssignmentId": "a-1",
                "evidenceObservationId": "obs-1",
                "outcomeKind": "next_novel_skill_attempt",
                "skill": "reading.tfng",
                "assetId": "asset-B",
            }
        )
        self.assertTrue(o.attributed)
        self.assertEqual(o.outcome_kind, StrategyOutcomeKind.NEXT_NOVEL_SKILL_ATTEMPT)
        self.assertEqual(o.schema_version, OUTCOME_ATTRIBUTION_SCHEMA_VERSION)


class RewardChannelAggregationTests(unittest.TestCase):
    """M10-03: satisfaction and learning are aggregated on SEPARATE axes.

    A thumbs-up recorded on the satisfaction axis can NEVER appear on the
    learning axis. The two dicts do not reference each other.
    """

    def setUp(self) -> None:
        self.orch = StrategyEvaluationOrchestrator(FakeHostBridge())

    def test_aggregate_splits_satisfaction_and_learning(self) -> None:
        rows = (
            _user_state(
                strategy_id="evidence_first_v1",
                success=3,
                failure=1,
                satisfaction=5,
                reask=2,
                novel_transfer=1,
            ),
            _user_state(
                strategy_id="example_first_v1",
                success=1,
                failure=2,
                satisfaction=4,
                reask=0,
            ),
        )
        agg = self.orch.aggregate_reward_channels(rows)
        self.assertIsInstance(agg, AggregatedReward)
        # Satisfaction axis carries ONLY satisfaction + reask counts.
        self.assertEqual(
            agg.satisfaction["evidence_first_v1"],
            {"satisfactionCount": 5, "reaskCount": 2},
        )
        # Learning axis carries ONLY success/failure/novel_transfer.
        self.assertEqual(
            agg.learning["evidence_first_v1"],
            {
                "successCount": 3,
                "novelTransferSuccess": 1,
                "failureCount": 1,
            },
        )

    def test_thumbs_up_never_appears_in_learning_axis(self) -> None:
        """M10-03: a thumbs-up (satisfaction) cannot prove learning."""
        rows = (
            _user_state(
                strategy_id="concise_direct_v1",
                success=0,  # NO learning evidence
                failure=0,
                satisfaction=10,  # many thumbs-up
                reask=0,
            ),
        )
        agg = self.orch.aggregate_reward_channels(rows)
        # Satisfaction axis reflects the thumbs-up.
        self.assertEqual(
            agg.satisfaction["concise_direct_v1"]["satisfactionCount"], 10
        )
        # Learning axis shows ZERO success despite 10 thumbs-up.
        self.assertEqual(
            agg.learning["concise_direct_v1"]["successCount"], 0
        )
        self.assertEqual(
            agg.learning["concise_direct_v1"]["novelTransferSuccess"], 0
        )

    def test_aggregate_empty(self) -> None:
        agg = self.orch.aggregate_reward_channels(())
        self.assertEqual(agg.satisfaction, {})
        self.assertEqual(agg.learning, {})

    def test_aggregate_to_wire_has_two_axes(self) -> None:
        rows = (_user_state(strategy_id="evidence_first_v1", success=1, satisfaction=2),)
        wire = self.orch.aggregate_reward_channels(rows).to_wire()
        self.assertIn("satisfaction", wire)
        self.assertIn("learning", wire)
        # No cross-contamination: satisfaction dict has no successCount key.
        self.assertNotIn("successCount", wire["satisfaction"]["evidence_first_v1"])
        # Learning dict has no satisfactionCount key.
        self.assertNotIn("satisfactionCount", wire["learning"]["evidence_first_v1"])


class ConfidenceTests(unittest.TestCase):
    """M10-05: bounded confidence = success/(success+failure), clamped [0,1]."""

    def setUp(self) -> None:
        self.orch = StrategyEvaluationOrchestrator(FakeHostBridge())

    def test_confidence_zero_evidence_returns_neutral_prior(self) -> None:
        row = _user_state(strategy_id="evidence_first_v1")
        self.assertEqual(self.orch.compute_confidence(row), CONFIDENCE_NEUTRAL_PRIOR)
        self.assertEqual(self.orch.compute_confidence(row), 0.5)

    def test_confidence_all_success_is_one(self) -> None:
        row = _user_state(strategy_id="evidence_first_v1", success=5, failure=0)
        self.assertEqual(self.orch.compute_confidence(row), 1.0)

    def test_confidence_all_failure_is_zero(self) -> None:
        row = _user_state(strategy_id="evidence_first_v1", success=0, failure=5)
        self.assertEqual(self.orch.compute_confidence(row), 0.0)

    def test_confidence_ratio(self) -> None:
        row = _user_state(strategy_id="evidence_first_v1", success=3, failure=1)
        self.assertAlmostEqual(self.orch.compute_confidence(row), 0.75, places=3)

    def test_confidence_bounded_between_zero_and_one(self) -> None:
        """No inputs produce a confidence outside [0, 1]."""
        for success, failure in [(0, 0), (1, 0), (0, 1), (100, 1), (1, 100), (7, 3)]:
            row = _user_state(
                strategy_id="evidence_first_v1",
                success=success,
                failure=failure,
            )
            conf = self.orch.compute_confidence(row)
            self.assertGreaterEqual(conf, 0.0)
            self.assertLessEqual(conf, 1.0)

    def test_confidence_ignores_satisfaction_channel(self) -> None:
        """M10-03/05: satisfaction counts do not inflate learning confidence."""
        row = _user_state(
            strategy_id="evidence_first_v1",
            success=1,
            failure=1,
            satisfaction=100,  # many thumbs-up must not change the ratio
            reask=50,
        )
        # confidence stays 0.5 despite huge satisfaction counts.
        self.assertAlmostEqual(self.orch.compute_confidence(row), 0.5, places=3)


class DelayedOutcomeAttributionTests(unittest.TestCase):
    """M10-04: delayed outcome window, prefer novel asset, out-of-window safe."""

    def test_no_future_observation_yields_out_of_window(self) -> None:
        """No future outcome -> NO effectiveness claim (M10-04)."""
        orch = StrategyEvaluationOrchestrator(
            FakeHostBridge(), required_capabilities=None
        )
        orch._required = _capabilities()  # bypass capability gate for pure logic
        verdict = orch._compute_attribution(
            OutcomeScanInput(
                trace_id="t",
                assignment=_assignment(),
                observations=(),
                window=DEFAULT_OUTCOME_WINDOW,
            )
        )
        self.assertEqual(verdict.kind, OutcomeAttributionKind.OUT_OF_WINDOW)
        self.assertFalse(verdict.attributed)
        self.assertIsNone(verdict.outcome_kind)

    def test_observation_beyond_window_not_attributed(self) -> None:
        """A relevant observation OUTSIDE the window is not credited.

        The window counts RELEVANT observations only. We fill the window with
        relevant same-asset observations (each discounted, stopping the scan
        at the first), then place a novel-asset relevant observation just
        beyond. The first same-asset repeat already returns DISCOUNTED, so the
        novel one beyond is never reached. To test the pure out-of-window path
        we instead use relevant observations that are NEITHER same-asset nor
        novel-asset on a targeted skill — but every relevant observation either
        matches same-asset (discounted) or novel-asset (attributed). So the
        correct out-of-window test is: fewer than `window` relevant
        observations exist, but the window is sized so the one relevant
        observation is beyond it.
        """
        orch = StrategyEvaluationOrchestrator(
            FakeHostBridge(), required_capabilities=None
        )
        orch._required = _capabilities()
        # window=0 means no relevant observation is ever considered.
        verdict = orch._compute_attribution(
            OutcomeScanInput(
                trace_id="t",
                assignment=_assignment(),
                observations=(
                    _observation(
                        obs_id="obs-relevant",
                        skill="reading.tfng",
                        asset_id="asset-B",
                    ),
                ),
                window=0,
            )
        )
        self.assertEqual(verdict.kind, OutcomeAttributionKind.OUT_OF_WINDOW)

    def test_relevant_novel_observation_beyond_relevant_window_not_attributed(self) -> None:
        """When the first `window` RELEVANT observations are all same-asset
        (discounted, stopping the scan), a later novel-asset observation is
        never reached. This verifies the window bounds relevant observations."""
        orch = StrategyEvaluationOrchestrator(
            FakeHostBridge(), required_capabilities=None
        )
        orch._required = _capabilities()
        # First relevant observation is same-asset → DISCOUNTED → scan stops.
        verdict = orch._compute_attribution(
            OutcomeScanInput(
                trace_id="t",
                assignment=_assignment(target_asset_id="asset-A"),
                observations=(
                    _observation(
                        obs_id="same-1",
                        skill="reading.tfng",
                        asset_id="asset-A",
                    ),
                    _observation(
                        obs_id="novel-beyond",
                        skill="reading.tfng",
                        asset_id="asset-B",
                    ),
                ),
                window=DEFAULT_OUTCOME_WINDOW,
            )
        )
        self.assertEqual(verdict.kind, OutcomeAttributionKind.DISCOUNTED_SAME_ASSET)
        self.assertEqual(verdict.evidence_observation_id, "same-1")

    def test_novel_asset_within_window_attributed(self) -> None:
        """A relevant observation on a NOVEL asset within the window credits."""
        orch = StrategyEvaluationOrchestrator(
            FakeHostBridge(), required_capabilities=None
        )
        orch._required = _capabilities()
        verdict = orch._compute_attribution(
            OutcomeScanInput(
                trace_id="t",
                assignment=_assignment(target_asset_id="asset-A"),
                observations=(
                    _observation(
                        obs_id="obs-1",
                        skill="reading.tfng.false_vs_not_given",
                        asset_id="asset-B",  # novel
                    ),
                ),
                window=DEFAULT_OUTCOME_WINDOW,
            )
        )
        self.assertEqual(verdict.kind, OutcomeAttributionKind.ATTRIBUTED)
        self.assertTrue(verdict.attributed)
        self.assertEqual(verdict.evidence_observation_id, "obs-1")
        self.assertEqual(
            verdict.outcome_kind, StrategyOutcomeKind.NEXT_NOVEL_SKILL_ATTEMPT
        )

    def test_repeated_same_asset_discounted(self) -> None:
        """M10-04: prefer novel asset — a same-asset repeat is DISCOUNTED."""
        orch = StrategyEvaluationOrchestrator(
            FakeHostBridge(), required_capabilities=None
        )
        orch._required = _capabilities()
        verdict = orch._compute_attribution(
            OutcomeScanInput(
                trace_id="t",
                assignment=_assignment(target_asset_id="asset-A"),
                observations=(
                    _observation(
                        obs_id="obs-same",
                        skill="reading.tfng",
                        asset_id="asset-A",  # SAME asset
                    ),
                ),
                window=DEFAULT_OUTCOME_WINDOW,
            )
        )
        self.assertEqual(verdict.kind, OutcomeAttributionKind.DISCOUNTED_SAME_ASSET)
        self.assertFalse(verdict.attributed)
        # Discounted verdict carries NO effectiveness claim (no outcome_kind).
        self.assertIsNone(verdict.outcome_kind)

    def test_same_asset_discount_stops_scan(self) -> None:
        """Once a same-asset repeat is found, scanning stops — a later novel
        asset does not rescue the attribution."""
        orch = StrategyEvaluationOrchestrator(
            FakeHostBridge(), required_capabilities=None
        )
        orch._required = _capabilities()
        verdict = orch._compute_attribution(
            OutcomeScanInput(
                trace_id="t",
                assignment=_assignment(target_asset_id="asset-A"),
                observations=(
                    _observation(obs_id="same", skill="reading.tfng", asset_id="asset-A"),
                    _observation(obs_id="novel", skill="reading.tfng", asset_id="asset-B"),
                ),
                window=DEFAULT_OUTCOME_WINDOW,
            )
        )
        self.assertEqual(verdict.kind, OutcomeAttributionKind.DISCOUNTED_SAME_ASSET)
        self.assertEqual(verdict.evidence_observation_id, "same")

    def test_irrelevant_observations_do_not_consume_window(self) -> None:
        """Irrelevant skills are skipped, so a relevant novel-asset observation
        later in the tuple still credits as long as fewer than `window`
        RELEVANT observations precede it."""
        orch = StrategyEvaluationOrchestrator(
            FakeHostBridge(), required_capabilities=None
        )
        orch._required = _capabilities()
        # 10 irrelevant observations then a relevant novel one.
        irrelevant = tuple(
            _observation(obs_id=f"irr-{i}", skill="writing.task1", asset_id="asset-X")
            for i in range(10)
        )
        relevant = (
            _observation(obs_id="rel", skill="reading.tfng", asset_id="asset-B"),
        )
        verdict = orch._compute_attribution(
            OutcomeScanInput(
                trace_id="t",
                assignment=_assignment(),
                observations=irrelevant + relevant,
                window=3,
            )
        )
        self.assertEqual(verdict.kind, OutcomeAttributionKind.ATTRIBUTED)
        self.assertEqual(verdict.evidence_observation_id, "rel")

    def test_window_zero_means_out_of_window(self) -> None:
        orch = StrategyEvaluationOrchestrator(
            FakeHostBridge(), required_capabilities=None
        )
        orch._required = _capabilities()
        verdict = orch._compute_attribution(
            OutcomeScanInput(
                trace_id="t",
                assignment=_assignment(),
                observations=(_observation(),),
                window=0,
            )
        )
        self.assertEqual(verdict.kind, OutcomeAttributionKind.OUT_OF_WINDOW)

    def test_writing_activity_infers_writing_revision_kind(self) -> None:
        orch = StrategyEvaluationOrchestrator(
            FakeHostBridge(), required_capabilities=None
        )
        orch._required = _capabilities()
        verdict = orch._compute_attribution(
            OutcomeScanInput(
                trace_id="t",
                assignment=_assignment(
                    skill_keys=("writing.task2",), target_asset_id="asset-A"
                ),
                observations=(
                    _observation(
                        obs_id="obs-w",
                        skill="writing.task2",
                        asset_id="asset-C",
                        activity="writing",
                    ),
                ),
                window=DEFAULT_OUTCOME_WINDOW,
            )
        )
        self.assertEqual(verdict.kind, OutcomeAttributionKind.ATTRIBUTED)
        self.assertEqual(
            verdict.outcome_kind, StrategyOutcomeKind.NEXT_WRITING_REVISION
        )

    def test_skill_prefix_match_credits(self) -> None:
        """An observation on a sub-skill of the targeted family credits."""
        orch = StrategyEvaluationOrchestrator(
            FakeHostBridge(), required_capabilities=None
        )
        orch._required = _capabilities()
        verdict = orch._compute_attribution(
            OutcomeScanInput(
                trace_id="t",
                assignment=_assignment(
                    skill_keys=("reading.tfng",), target_asset_id="asset-A"
                ),
                observations=(
                    _observation(
                        obs_id="obs-sub",
                        skill="reading.tfng.true_vs_not_given",  # sub-skill
                        asset_id="asset-B",
                    ),
                ),
                window=DEFAULT_OUTCOME_WINDOW,
            )
        )
        self.assertEqual(verdict.kind, OutcomeAttributionKind.ATTRIBUTED)

    def test_attribution_persisted_via_record_outcome(self) -> None:
        bridge = FakeHostBridge()
        orch = StrategyEvaluationOrchestrator(bridge)
        verdict = orch.delayed_outcome_attribution(
            OutcomeScanInput(
                trace_id="t",
                assignment=_assignment(target_asset_id="asset-A"),
                observations=(
                    _observation(asset_id="asset-B"),
                ),
                window=DEFAULT_OUTCOME_WINDOW,
            ),
            available_host_capabilities=_capabilities(),
        )
        self.assertEqual(verdict.kind, OutcomeAttributionKind.ATTRIBUTED)
        methods = [call[0] for call in bridge.calls]
        self.assertEqual(methods, [CAPABILITY_STRATEGY_RECORD_OUTCOME])
        payload = bridge.calls[0][1]["attribution"]
        self.assertEqual(payload["kind"], "attributed")
        self.assertEqual(payload["strategyAssignmentId"], "msg-1")

    def test_host_failure_yields_fallback_verdict_non_fatal(self) -> None:
        """M10 fail-closed: host failure on record_outcome -> fallback verdict."""
        bridge = FakeHostBridge(
            fail_methods=frozenset({CAPABILITY_STRATEGY_RECORD_OUTCOME})
        )
        orch = StrategyEvaluationOrchestrator(bridge)
        verdict = orch.delayed_outcome_attribution(
            OutcomeScanInput(
                trace_id="t",
                assignment=_assignment(target_asset_id="asset-A"),
                observations=(_observation(asset_id="asset-B"),),
                window=DEFAULT_OUTCOME_WINDOW,
            ),
            available_host_capabilities=_capabilities(),
        )
        # Fallback verdict is OUT_OF_WINDOW (no effectiveness claim recorded).
        self.assertEqual(verdict.kind, OutcomeAttributionKind.OUT_OF_WINDOW)
        self.assertFalse(verdict.attributed)
        # Never raises fatal.
        self.assertIsInstance(verdict, OutcomeAttribution)

    def test_missing_capabilities_fallback(self) -> None:
        bridge = FakeHostBridge()
        orch = StrategyEvaluationOrchestrator(bridge)
        verdict = orch.delayed_outcome_attribution(
            OutcomeScanInput(
                trace_id="t",
                assignment=_assignment(),
                observations=(),
                window=DEFAULT_OUTCOME_WINDOW,
            ),
            available_host_capabilities={},
        )
        self.assertEqual(verdict.kind, OutcomeAttributionKind.OUT_OF_WINDOW)
        self.assertIn("fallback:", verdict.evidence_observation_id or "")

    def test_never_raises_fatal_on_unexpected_error(self) -> None:
        orch = StrategyEvaluationOrchestrator(ExplodingBridge())
        verdict = orch.delayed_outcome_attribution(
            OutcomeScanInput(
                trace_id="t",
                assignment=_assignment(),
                observations=(),
                window=DEFAULT_OUTCOME_WINDOW,
            ),
            available_host_capabilities=_capabilities(),
        )
        self.assertEqual(verdict.kind, OutcomeAttributionKind.OUT_OF_WINDOW)


class StrategySelectionTests(unittest.TestCase):
    """M10-06 priority selection + M10-07 preference vs effectiveness conflict."""

    def test_explicit_preference_wins_over_proven_effectiveness(self) -> None:
        """M10-06: explicit preference is the top tier.

        Even when a different strategy has better effectiveness evidence, the
        explicit preference wins. No silent switch (M10-07).
        """
        bridge = FakeHostBridge()
        orch = StrategyEvaluationOrchestrator(bridge)
        # evidence_first has strong effectiveness; user explicitly prefers
        # concise_direct.
        rows = (
            _user_state(
                strategy_id="evidence_first_v1",
                success=10,
                failure=1,
            ),
        )
        sel = orch._score(
            SelectionInput(
                trace_id="t",
                scope="reading.tfng",
                explicit_preference="concise_direct_v1",
                user_state_rows=rows,
                default_strategy_id="evidence_first_v1",
            )
        )
        self.assertEqual(sel.selected_strategy_id, "concise_direct_v1")
        self.assertFalse(sel.is_exploration)
        # A candidate suggestion for the effectiveness-favoured strategy is
        # emitted but NEVER auto-promoted (M10-08).
        self.assertTrue(sel.alternatives)
        self.assertEqual(sel.alternatives[0]["strategyId"], "evidence_first_v1")
        self.assertIn("candidate", sel.alternatives[0]["note"])

    def test_explicit_preference_respected_without_conflict(self) -> None:
        bridge = FakeHostBridge()
        orch = StrategyEvaluationOrchestrator(bridge)
        sel = orch._score(
            SelectionInput(
                trace_id="t",
                scope="reading.tfng",
                explicit_preference="example_first_v1",
                user_state_rows=(),
                default_strategy_id="evidence_first_v1",
            )
        )
        self.assertEqual(sel.selected_strategy_id, "example_first_v1")
        self.assertFalse(sel.is_exploration)

    def test_contraindication_overrides_explicit_preference(self) -> None:
        """Safety: contraindication overrides even an explicit preference."""
        bridge = FakeHostBridge()
        orch = StrategyEvaluationOrchestrator(bridge)
        sel = orch._score(
            SelectionInput(
                trace_id="t",
                scope="reading.tfng",
                explicit_preference="socratic_prompt_v1",
                contraindicated=frozenset({"socratic_prompt_v1"}),
                user_state_rows=(),
                default_strategy_id="evidence_first_v1",
            )
        )
        # Falls to default (no proven strategy).
        self.assertEqual(sel.selected_strategy_id, "evidence_first_v1")
        self.assertIn("overridden", sel.why)

    def test_proven_personal_strategy_wins_without_preference(self) -> None:
        """M10-06 tier 3: proven personal strategy (highest confidence)."""
        bridge = FakeHostBridge()
        orch = StrategyEvaluationOrchestrator(bridge)
        rows = (
            _user_state(strategy_id="evidence_first_v1", success=8, failure=2),
            _user_state(strategy_id="example_first_v1", success=2, failure=8),
        )
        sel = orch._score(
            SelectionInput(
                trace_id="t",
                scope="reading.tfng",
                user_state_rows=rows,
                default_strategy_id="evidence_first_v1",
            )
        )
        self.assertEqual(sel.selected_strategy_id, "evidence_first_v1")
        self.assertFalse(sel.is_exploration)
        self.assertIn("proven_personal", sel.why)

    def test_default_strategy_when_no_evidence(self) -> None:
        """M10-06 tier 4: with no evidence anywhere, fall to default."""
        bridge = FakeHostBridge()
        orch = StrategyEvaluationOrchestrator(bridge)
        sel = orch._score(
            SelectionInput(
                trace_id="t",
                scope="reading.tfng",
                user_state_rows=(),
                default_strategy_id="contrastive_v1",
            )
        )
        self.assertEqual(sel.selected_strategy_id, "contrastive_v1")
        self.assertFalse(sel.is_exploration)
        self.assertIn("default", sel.why)

    def test_exploration_only_when_evidence_sufficient(self) -> None:
        """M10-06: exploration slot is ONLY emitted when at least one strategy
        has sufficient evidence (>= MIN_EXPLORATION_EVIDENCE)."""
        bridge = FakeHostBridge()
        orch = StrategyEvaluationOrchestrator(bridge)
        # No strategy has sufficient evidence -> no exploration.
        rows = (
            _user_state(strategy_id="evidence_first_v1", success=1, failure=0),
        )
        sel = orch._score(
            SelectionInput(
                trace_id="t",
                scope="reading.tfng",
                user_state_rows=rows,
                default_strategy_id="evidence_first_v1",
                allow_exploration=True,
            )
        )
        self.assertFalse(sel.is_exploration)
        self.assertEqual(sel.selected_strategy_id, "evidence_first_v1")

    def test_exploration_picks_least_explored_when_evidence_sufficient(self) -> None:
        """M10-06: when evidence is sufficient but NO strategy is net-positive
        proven (confidence > 0.5), exploration picks the least-explored
        strategy (capped by the Rust authority at 10%)."""
        bridge = FakeHostBridge()
        orch = StrategyEvaluationOrchestrator(bridge)
        # evidence_first has sufficient evidence but net-negative confidence
        # (success=1, failure=2 -> confidence 0.33 < 0.5), so proven-personal
        # does NOT fire. example_first is the least-explored candidate.
        rows = (
            _user_state(
                strategy_id="evidence_first_v1",
                success=1,
                failure=2,  # total 3 >= MIN_EXPLORATION_EVIDENCE; confidence 0.33
            ),
            _user_state(strategy_id="example_first_v1", success=0, failure=0),
        )
        sel = orch._score(
            SelectionInput(
                trace_id="t",
                scope="reading.tfng",
                user_state_rows=rows,
                default_strategy_id="evidence_first_v1",
                allow_exploration=True,
            )
        )
        self.assertTrue(sel.is_exploration)
        # Exploration picks the least-explored non-contraindicated strategy.
        # example_first_v1 has 0 observations; it should be the exploration pick.
        self.assertEqual(sel.selected_strategy_id, "example_first_v1")

    def test_exploration_suppressed_when_disabled(self) -> None:
        """allow_exploration=False suppresses exploration even with evidence."""
        bridge = FakeHostBridge()
        orch = StrategyEvaluationOrchestrator(bridge)
        rows = (
            _user_state(
                strategy_id="evidence_first_v1",
                success=MIN_EXPLORATION_EVIDENCE,
                failure=0,
            ),
        )
        sel = orch._score(
            SelectionInput(
                trace_id="t",
                scope="reading.tfng",
                user_state_rows=rows,
                default_strategy_id="evidence_first_v1",
                allow_exploration=False,
            )
        )
        self.assertFalse(sel.is_exploration)
        # Falls to proven personal (evidence_first has high confidence).
        self.assertEqual(sel.selected_strategy_id, "evidence_first_v1")

    def test_exploration_cap_constant(self) -> None:
        self.assertEqual(EXPLORATION_CAP, 0.10)

    def test_min_exploration_evidence_constant(self) -> None:
        self.assertEqual(MIN_EXPLORATION_EVIDENCE, 3)

    def test_selection_persisted_via_strategy_select(self) -> None:
        bridge = FakeHostBridge()
        orch = StrategyEvaluationOrchestrator(bridge)
        sel = orch.score_candidates(
            SelectionInput(
                trace_id="t",
                scope="reading.tfng",
                user_state_rows=(),
                default_strategy_id="evidence_first_v1",
            ),
            available_host_capabilities=_capabilities(),
        )
        self.assertEqual(sel.selected_strategy_id, "evidence_first_v1")
        methods = [call[0] for call in bridge.calls]
        self.assertEqual(methods, [CAPABILITY_STRATEGY_SELECT])
        payload = bridge.calls[0][1]["selection"]
        self.assertEqual(payload["selectedStrategyId"], "evidence_first_v1")

    def test_selection_host_failure_yields_fallback_non_fatal(self) -> None:
        """M10 fail-closed: host failure on strategy.select -> fallback."""
        bridge = FakeHostBridge(fail_methods=frozenset({CAPABILITY_STRATEGY_SELECT}))
        orch = StrategyEvaluationOrchestrator(bridge)
        sel = orch.score_candidates(
            SelectionInput(
                trace_id="t",
                scope="reading.tfng",
                user_state_rows=(),
                default_strategy_id="contrastive_v1",
            ),
            available_host_capabilities=_capabilities(),
        )
        # Falls to default; never raises fatal.
        self.assertEqual(sel.selected_strategy_id, "contrastive_v1")
        self.assertIn("fallback", sel.why)
        self.assertFalse(sel.is_exploration)

    def test_missing_capabilities_fallback_selection(self) -> None:
        bridge = FakeHostBridge()
        orch = StrategyEvaluationOrchestrator(bridge)
        sel = orch.score_candidates(
            SelectionInput(
                trace_id="t",
                scope="reading.tfng",
                user_state_rows=(),
                default_strategy_id="evidence_first_v1",
            ),
            available_host_capabilities={},
        )
        self.assertIn("fallback", sel.why)
        self.assertEqual(sel.selected_strategy_id, "evidence_first_v1")

    def test_capability_version_mismatch_fallback(self) -> None:
        bridge = FakeHostBridge()
        orch = StrategyEvaluationOrchestrator(bridge)
        mismatched = _capabilities()
        mismatched[CAPABILITY_STRATEGY_SELECT] = "2"
        sel = orch.score_candidates(
            SelectionInput(
                trace_id="t",
                scope="reading.tfng",
                user_state_rows=(),
                default_strategy_id="evidence_first_v1",
            ),
            available_host_capabilities=mismatched,
        )
        self.assertIn("capability_mismatch", sel.why)

    def test_never_raises_fatal_on_unexpected_error_selection(self) -> None:
        orch = StrategyEvaluationOrchestrator(ExplodingBridge())
        sel = orch.score_candidates(
            SelectionInput(
                trace_id="t",
                scope="reading.tfng",
                user_state_rows=(),
                default_strategy_id="evidence_first_v1",
            ),
            available_host_capabilities=_capabilities(),
        )
        self.assertIn("fallback", sel.why)
        self.assertFalse(sel.is_exploration)


class HostRecorderTests(unittest.TestCase):
    """M10-02/M10-03: assignment/feedback/user_state host-backed recorders.

    All recorders are fail-closed (return False/empty on host failure, never
    raise). Feedback kinds are ALWAYS satisfaction-channel; learning outcomes
    go through delayed_outcome_attribution only.
    """

    def test_record_assignment_success(self) -> None:
        bridge = FakeHostBridge()
        orch = StrategyEvaluationOrchestrator(bridge)
        ok = orch.record_assignment(
            _assignment(),
            trace_id="t",
            available_host_capabilities=_capabilities(),
        )
        self.assertTrue(ok)
        self.assertEqual(bridge.calls[0][0], CAPABILITY_STRATEGY_RECORD_ASSIGNMENT)
        self.assertEqual(
            bridge.calls[0][1]["assignment"]["strategyId"], "evidence_first_v1"
        )

    def test_record_assignment_host_failure_returns_false(self) -> None:
        bridge = FakeHostBridge(
            fail_methods=frozenset({CAPABILITY_STRATEGY_RECORD_ASSIGNMENT})
        )
        orch = StrategyEvaluationOrchestrator(bridge)
        ok = orch.record_assignment(
            _assignment(),
            trace_id="t",
            available_host_capabilities=_capabilities(),
        )
        self.assertFalse(ok)

    def test_record_feedback_satisfaction_kind_only(self) -> None:
        """Feedback kinds come from StrategyFeedbackKind (satisfaction axis).

        A learning outcome kind must NEVER be passed here — type system
        enforces it (StrategyFeedbackKind and StrategyOutcomeKind are disjoint).
        """
        bridge = FakeHostBridge()
        orch = StrategyEvaluationOrchestrator(bridge)
        ok = orch.record_feedback(
            strategy_assignment_id="msg-1",
            feedback_kind=StrategyFeedbackKind.THUMBS,
            trace_id="t",
            available_host_capabilities=_capabilities(),
            note="liked it",
        )
        self.assertTrue(ok)
        payload = bridge.calls[0][1]
        self.assertEqual(payload["feedbackKind"], "thumbs")
        self.assertEqual(payload["strategyAssignmentId"], "msg-1")
        self.assertEqual(payload["note"], "liked it")

    def test_record_feedback_all_satisfaction_kinds(self) -> None:
        bridge = FakeHostBridge()
        orch = StrategyEvaluationOrchestrator(bridge)
        for kind in StrategyFeedbackKind:
            ok = orch.record_feedback(
                strategy_assignment_id="msg-1",
                feedback_kind=kind,
                trace_id="t",
                available_host_capabilities=_capabilities(),
            )
            self.assertTrue(ok, f"feedback kind {kind} should record")

    def test_record_feedback_host_failure_returns_false(self) -> None:
        bridge = FakeHostBridge(
            fail_methods=frozenset({CAPABILITY_STRATEGY_RECORD_FEEDBACK})
        )
        orch = StrategyEvaluationOrchestrator(bridge)
        ok = orch.record_feedback(
            strategy_assignment_id="msg-1",
            feedback_kind=StrategyFeedbackKind.REASK,
            trace_id="t",
            available_host_capabilities=_capabilities(),
        )
        self.assertFalse(ok)

    def test_fetch_user_state_parses_rows(self) -> None:
        bridge = FakeHostBridge(
            user_state_result={
                "rows": [
                    {
                        "strategyId": "evidence_first_v1",
                        "scope": "reading.tfng",
                        "successCount": 3,
                        "failureCount": 1,
                        "satisfactionCount": 5,
                        "reaskCount": 2,
                        "novelTransferSuccess": 1,
                        "confidence": 0.75,
                    },
                ]
            }
        )
        orch = StrategyEvaluationOrchestrator(bridge)
        rows = orch.fetch_user_state(
            scope="reading.tfng",
            trace_id="t",
            available_host_capabilities=_capabilities(),
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].strategy_id, "evidence_first_v1")
        self.assertEqual(rows[0].success_count, 3)
        self.assertEqual(rows[0].confidence, 0.75)

    def test_fetch_user_state_drops_invalid_rows(self) -> None:
        bridge = FakeHostBridge(
            user_state_result={
                "rows": [
                    {"strategyId": "not_in_catalog", "scope": "s"},
                    {"strategyId": "evidence_first_v1", "scope": "s"},
                ]
            }
        )
        orch = StrategyEvaluationOrchestrator(bridge)
        rows = orch.fetch_user_state(
            scope="s",
            trace_id="t",
            available_host_capabilities=_capabilities(),
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].strategy_id, "evidence_first_v1")

    def test_fetch_user_state_host_failure_returns_empty(self) -> None:
        bridge = FakeHostBridge(
            fail_methods=frozenset({CAPABILITY_STRATEGY_USER_STATE})
        )
        orch = StrategyEvaluationOrchestrator(bridge)
        rows = orch.fetch_user_state(
            scope="s",
            trace_id="t",
            available_host_capabilities=_capabilities(),
        )
        self.assertEqual(rows, ())

    def test_no_write_bypass(self) -> None:
        """The orchestrator never writes active memory directly (no-write-bypass).

        It only calls the strategy.* capabilities — never memory.promote,
        memory.write, or memory.upsert.
        """
        bridge = FakeHostBridge()
        orch = StrategyEvaluationOrchestrator(bridge)
        orch.record_assignment(
            _assignment(),
            trace_id="t",
            available_host_capabilities=_capabilities(),
        )
        orch.record_feedback(
            strategy_assignment_id="msg-1",
            feedback_kind=StrategyFeedbackKind.THUMBS,
            trace_id="t",
            available_host_capabilities=_capabilities(),
        )
        orch.delayed_outcome_attribution(
            OutcomeScanInput(
                trace_id="t",
                assignment=_assignment(target_asset_id="asset-A"),
                observations=(_observation(asset_id="asset-B"),),
                window=DEFAULT_OUTCOME_WINDOW,
            ),
            available_host_capabilities=_capabilities(),
        )
        orch.score_candidates(
            SelectionInput(
                trace_id="t",
                scope="reading.tfng",
                user_state_rows=(),
                default_strategy_id="evidence_first_v1",
            ),
            available_host_capabilities=_capabilities(),
        )
        methods = [call[0] for call in bridge.calls]
        for forbidden in ("memory.promote", "memory.write", "memory.upsert"):
            self.assertNotIn(forbidden, methods)
        # All calls are strategy.* capabilities.
        for method in methods:
            self.assertTrue(method.startswith("strategy."))


class FallbackResultHelperTests(unittest.TestCase):
    def test_fallback_result_returns_default_strategy(self) -> None:
        sel = fallback_result("manual")
        self.assertEqual(sel.selected_strategy_id, "evidence_first_v1")
        self.assertIn("manual", sel.why)
        self.assertFalse(sel.is_exploration)


class PreferenceVsEffectivenessConflictTests(unittest.TestCase):
    """M10-07: respect explicit preference; emit candidate suggestion only.

    The system must NOT silently switch to the effectiveness-favoured strategy.
    It respects the explicit preference, emits a candidate suggestion (never
    auto-promoted; M10-08), and explains the reasoning so the user can choose.
    """

    def test_explicit_preference_respected_when_effectiveness_differs(self) -> None:
        bridge = FakeHostBridge()
        orch = StrategyEvaluationOrchestrator(bridge)
        rows = (
            _user_state(
                strategy_id="evidence_first_v1",
                success=10,
                failure=1,
            ),
            _user_state(
                strategy_id="concise_direct_v1",
                success=0,
                failure=5,
            ),
        )
        sel = orch._score(
            SelectionInput(
                trace_id="t",
                scope="reading.tfng",
                explicit_preference="concise_direct_v1",
                user_state_rows=rows,
                default_strategy_id="evidence_first_v1",
            )
        )
        # Explicit preference wins — NO silent switch.
        self.assertEqual(sel.selected_strategy_id, "concise_direct_v1")
        # A candidate suggestion for evidence_first is emitted as an
        # alternative (candidate only, never auto-promoted).
        self.assertTrue(sel.alternatives)
        self.assertEqual(sel.alternatives[0]["strategyId"], "evidence_first_v1")
        self.assertEqual(sel.alternatives[0]["tier"], "proven_personal")
        self.assertIn("candidate", sel.alternatives[0]["note"])
        # The why explains the conflict and that the preference was respected.
        self.assertIn("respected", sel.why)
        self.assertIn("evidence_first_v1", sel.why)

    def test_no_candidate_suggestion_when_no_effectiveness_conflict(self) -> None:
        """When the explicit preference matches the effectiveness-favoured
        strategy, no candidate suggestion is emitted."""
        bridge = FakeHostBridge()
        orch = StrategyEvaluationOrchestrator(bridge)
        rows = (
            _user_state(
                strategy_id="evidence_first_v1",
                success=10,
                failure=1,
            ),
        )
        sel = orch._score(
            SelectionInput(
                trace_id="t",
                scope="reading.tfng",
                explicit_preference="evidence_first_v1",
                user_state_rows=rows,
                default_strategy_id="evidence_first_v1",
            )
        )
        self.assertEqual(sel.selected_strategy_id, "evidence_first_v1")
        self.assertEqual(sel.alternatives, [])

    def test_candidate_suggestion_never_auto_promotes(self) -> None:
        """M10-08: the candidate suggestion is marked candidate-only. The
        selected strategy is the explicit preference, not the suggestion."""
        bridge = FakeHostBridge()
        orch = StrategyEvaluationOrchestrator(bridge)
        rows = (
            _user_state(strategy_id="evidence_first_v1", success=10, failure=0),
        )
        sel = orch._score(
            SelectionInput(
                trace_id="t",
                scope="reading.tfng",
                explicit_preference="example_first_v1",
                user_state_rows=rows,
                default_strategy_id="evidence_first_v1",
            )
        )
        # Selected = explicit preference, NOT the effectiveness-favoured one.
        self.assertEqual(sel.selected_strategy_id, "example_first_v1")
        self.assertNotEqual(sel.selected_strategy_id, "evidence_first_v1")


if __name__ == "__main__":
    unittest.main()
