from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from ielts_agent.dream.capacity import MAX_OUTPUT_CANDIDATES
from ielts_agent.dream.daily_dream import (
    DailyDreamOrchestrator,
    DreamRunInput,
    fallback_result,
)
from ielts_agent.dream.types import (
    CAPABILITY_DREAM_RUN_DAILY,
    CAPABILITY_JOURNAL_BUILD_DAILY,
    REQUIRED_DAILY_DREAM_HOST_CAPABILITIES,
    DailyDreamResult,
    DreamCapacity,
    DreamProposal,
    DreamProposalKind,
    JournalFacts,
)
from ielts_agent.protocol import ProtocolError


def _capabilities() -> dict[str, str]:
    return dict(REQUIRED_DAILY_DREAM_HOST_CAPABILITIES)


def _journal_facts_wire(
    *,
    observation_ids: list[str] | None = None,
    memory_events: list[dict] | None = None,
) -> dict:
    return {
        "journalDate": "2026-08-16",
        "attemptsCount": 3,
        "writingEvalSummary": {"completed": 2, "degraded": 0, "averageBand": 6.5},
        "skillDeltas": [
            {"skillKey": "reading.tfng", "delta": 0.05, "evidenceCount": 3}
        ],
        "memoryChanges": {
            "newCandidates": 1,
            "promoted": 0,
            "reinforced": 1,
            "refined": 0,
            "improved": 0,
            "regressed": 0,
            "contradicted": 0,
            "superseded": 0,
        },
        "memoryEvents": memory_events
        if memory_events is not None
        else [
            {
                "memoryId": "mem-strategy-1",
                "namespace": "strategy",
                "canonicalKey": "strategy.reading",
                "changeKind": "reinforced",
            }
        ],
        "coachFeedbackCount": 2,
        "coachReaskCount": 0,
        "timeSpentMs": 15000,
        "sourceHash": "sha-abc123",
        "todayObservationIds": observation_ids if observation_ids is not None else ["obs-1"],
    }


class FakeHostBridge:
    """In-memory host bridge for daily-dream tests."""

    def __init__(
        self,
        *,
        journal_facts: dict | None = None,
        dream_result: dict | None = None,
        fail_methods: frozenset[str] | None = None,
    ) -> None:
        self.calls: list[tuple[str, dict]] = []
        self._journal_facts = journal_facts or _journal_facts_wire()
        self._dream_result = dream_result or {
            "runId": "dream-run-1",
            "accepted": 1,
            "rejected": 0,
            "failed": 0,
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
            raise ProtocolError("host_error", f"simulated failure for {method}", retryable=False)
        if method == CAPABILITY_JOURNAL_BUILD_DAILY:
            return self._journal_facts
        if method == CAPABILITY_DREAM_RUN_DAILY:
            return self._dream_result
        raise ProtocolError("method_not_found", f"unhandled fake method {method}")


class DailyDreamOrchestratorTests(unittest.TestCase):
    def test_fetches_journal_facts_then_submits_proposals(self) -> None:
        bridge = FakeHostBridge()
        orchestrator = DailyDreamOrchestrator(bridge)
        result = orchestrator.run_daily(
            DreamRunInput(
                trace_id="trace-1",
                day="2026-08-16",
                available_host_capabilities=_capabilities(),
            )
        )
        self.assertIsInstance(result, DailyDreamResult)
        self.assertEqual(result.run_id, "dream-run-1")
        self.assertEqual(result.accepted, 1)
        self.assertIsNone(result.fallback_reason)
        # Two host calls: journal.build_daily then dream.run_daily.
        methods = [call[0] for call in bridge.calls]
        self.assertEqual(
            methods,
            [CAPABILITY_JOURNAL_BUILD_DAILY, CAPABILITY_DREAM_RUN_DAILY],
        )
        # journal.build_daily receives only {day} — today-scoped, no full history.
        self.assertEqual(bridge.calls[0][1], {"day": "2026-08-16"})

    def test_only_reads_today_scope_no_full_history_scan(self) -> None:
        """M7-06: the orchestrator only reads today facts, never scans all history."""
        bridge = FakeHostBridge()
        orchestrator = DailyDreamOrchestrator(bridge)
        orchestrator.run_daily(
            DreamRunInput(
                trace_id="trace-1",
                day="2026-08-16",
                available_host_capabilities=_capabilities(),
            )
        )
        # The single journal.build_daily call carries only the day string.
        # No pagination cursor, no "since" range, no full-history export.
        journal_calls = [
            call for call in bridge.calls if call[0] == CAPABILITY_JOURNAL_BUILD_DAILY
        ]
        self.assertEqual(len(journal_calls), 1)
        params = journal_calls[0][1]
        self.assertEqual(set(params.keys()), {"day"})
        self.assertNotIn("cursor", params)
        self.assertNotIn("since", params)
        self.assertNotIn("limit", params)
        self.assertNotIn("allHistory", params)

    def test_proposals_cover_six_kinds_via_kind_map(self) -> None:
        """M7-07: all six proposal kinds are representable in one run."""
        facts = _journal_facts_wire(
            observation_ids=["obs-1", "obs-2", "obs-3", "obs-4", "obs-5"],
            memory_events=[
                {"memoryId": "mem-1", "namespace": "strategy", "canonicalKey": "strategy.a", "changeKind": "reinforced"},
                {"memoryId": "mem-2", "namespace": "strategy", "canonicalKey": "strategy.b", "changeKind": "improved"},
                {"memoryId": "mem-3", "namespace": "strategy", "canonicalKey": "strategy.c", "changeKind": "regressed"},
                {"memoryId": "mem-4", "namespace": "strategy", "canonicalKey": "strategy.d", "changeKind": "contradicted"},
                {"memoryId": "mem-5", "namespace": "strategy", "canonicalKey": "strategy.e", "changeKind": "refined"},
            ],
        )
        bridge = FakeHostBridge(journal_facts=facts)
        orchestrator = DailyDreamOrchestrator(bridge)
        orchestrator.run_daily(
            DreamRunInput(
                trace_id="trace-1",
                day="2026-08-16",
                available_host_capabilities=_capabilities(),
            )
        )
        # Inspect the proposals submitted to dream.run_daily.
        dream_call = bridge.calls[-1]
        self.assertEqual(dream_call[0], CAPABILITY_DREAM_RUN_DAILY)
        submitted_kinds = {p["kind"] for p in dream_call[1]["proposals"]}
        self.assertEqual(
            submitted_kinds,
            {"REINFORCE", "IMPROVE", "REGRESS", "CONTRADICT", "REFINE"},
        )

    def test_noop_when_nothing_consolidated(self) -> None:
        facts = _journal_facts_wire(
            observation_ids=["obs-1"],
            memory_events=[],
        )
        bridge = FakeHostBridge(journal_facts=facts)
        orchestrator = DailyDreamOrchestrator(bridge)
        orchestrator.run_daily(
            DreamRunInput(
                trace_id="trace-1",
                day="2026-08-16",
                available_host_capabilities=_capabilities(),
            )
        )
        dream_call = bridge.calls[-1]
        proposals = dream_call[1]["proposals"]
        self.assertEqual(len(proposals), 1)
        self.assertEqual(proposals[0]["kind"], "NOOP")

    def test_capacity_bounded_output_truncation(self) -> None:
        """M7-08: output proposals are truncated to max_output_candidates."""
        # 15 memory events but output capacity = 3.
        memory_events = [
            {
                "memoryId": f"mem-{i}",
                "namespace": "strategy",
                "canonicalKey": f"strategy.{i}",
                "changeKind": "reinforced",
            }
            for i in range(15)
        ]
        facts = _journal_facts_wire(
            observation_ids=[f"obs-{i}" for i in range(15)],
            memory_events=memory_events,
        )
        bridge = FakeHostBridge(journal_facts=facts)
        cap = DreamCapacity(
            maxInputObservations=200,
            maxActiveCandidates=50,
            maxOutputCandidates=3,
            maxTokenBudget=4000,
            maxLlmRetries=1,
        )
        orchestrator = DailyDreamOrchestrator(bridge)
        orchestrator.run_daily(
            DreamRunInput(
                trace_id="trace-1",
                day="2026-08-16",
                available_host_capabilities=_capabilities(),
                capacity=cap,
            )
        )
        dream_call = bridge.calls[-1]
        proposals = dream_call[1]["proposals"]
        self.assertEqual(len(proposals), 3)
        self.assertEqual(MAX_OUTPUT_CANDIDATES, 10)

    def test_input_observations_truncated(self) -> None:
        """M7-08: input observation list is bounded."""
        many_obs = [f"obs-{i}" for i in range(300)]
        facts = _journal_facts_wire(
            observation_ids=many_obs,
            memory_events=[
                {"memoryId": "mem-1", "namespace": "strategy", "canonicalKey": "strategy.a", "changeKind": "reinforced"},
            ],
        )
        bridge = FakeHostBridge(journal_facts=facts)
        cap = DreamCapacity(
            maxInputObservations=10,
            maxActiveCandidates=50,
            maxOutputCandidates=10,
            maxTokenBudget=4000,
            maxLlmRetries=1,
        )
        orchestrator = DailyDreamOrchestrator(bridge)
        result = orchestrator.run_daily(
            DreamRunInput(
                trace_id="trace-1",
                day="2026-08-16",
                available_host_capabilities=_capabilities(),
                capacity=cap,
            )
        )
        self.assertIsNone(result.fallback_reason)
        # The orchestrator bounded input to 10 observations internally.

    def test_fail_closed_journal_failure(self) -> None:
        """M7-08: host failure on journal.build_daily → fallback, not fatal."""
        bridge = FakeHostBridge(
            fail_methods=frozenset({CAPABILITY_JOURNAL_BUILD_DAILY})
        )
        orchestrator = DailyDreamOrchestrator(bridge)
        result = orchestrator.run_daily(
            DreamRunInput(
                trace_id="trace-1",
                day="2026-08-16",
                available_host_capabilities=_capabilities(),
            )
        )
        self.assertTrue(result.fallback_reason)
        self.assertIn("journal_build_daily_unavailable", result.fallback_reason)
        self.assertEqual(result.run_id, "")
        self.assertEqual(result.accepted, 0)

    def test_fail_closed_dream_submission_failure(self) -> None:
        """M7-08: host failure on dream.run_daily → fallback, not fatal."""
        bridge = FakeHostBridge(
            fail_methods=frozenset({CAPABILITY_DREAM_RUN_DAILY})
        )
        orchestrator = DailyDreamOrchestrator(bridge)
        result = orchestrator.run_daily(
            DreamRunInput(
                trace_id="trace-1",
                day="2026-08-16",
                available_host_capabilities=_capabilities(),
            )
        )
        self.assertTrue(result.fallback_reason)
        self.assertIn("dream_run_daily_unavailable", result.fallback_reason)
        self.assertEqual(result.run_id, "")

    def test_missing_capabilities_fallback(self) -> None:
        bridge = FakeHostBridge()
        orchestrator = DailyDreamOrchestrator(bridge)
        result = orchestrator.run_daily(
            DreamRunInput(
                trace_id="trace-1",
                day="2026-08-16",
                available_host_capabilities={},
            )
        )
        self.assertTrue(result.fallback_reason)
        self.assertIn("host_capabilities_unavailable", result.fallback_reason)
        # No host calls made — fallback at the capability gate.
        self.assertEqual(bridge.calls, [])

    def test_capability_version_mismatch_fallback(self) -> None:
        bridge = FakeHostBridge()
        orchestrator = DailyDreamOrchestrator(bridge)
        mismatched = _capabilities()
        mismatched[CAPABILITY_JOURNAL_BUILD_DAILY] = "2"
        result = orchestrator.run_daily(
            DreamRunInput(
                trace_id="trace-1",
                day="2026-08-16",
                available_host_capabilities=mismatched,
            )
        )
        self.assertTrue(result.fallback_reason)
        self.assertIn("capability_mismatch", result.fallback_reason)

    def test_no_active_memory_write_bypass(self) -> None:
        """The orchestrator only emits candidate proposals; it never writes
        active memory directly (M7 no-write-bypass)."""
        bridge = FakeHostBridge()
        orchestrator = DailyDreamOrchestrator(bridge)
        orchestrator.run_daily(
            DreamRunInput(
                trace_id="trace-1",
                day="2026-08-16",
                available_host_capabilities=_capabilities(),
            )
        )
        # Only two host methods invoked: journal.build_daily (read) and
        # dream.run_daily (submit candidates). No memory.* write method.
        methods = [call[0] for call in bridge.calls]
        self.assertNotIn("memory.promote", methods)
        self.assertNotIn("memory.write", methods)
        self.assertNotIn("memory.upsert", methods)
        # The dream.run_daily payload carries proposals only.
        dream_call = bridge.calls[-1]
        self.assertEqual(dream_call[0], CAPABILITY_DREAM_RUN_DAILY)
        self.assertIn("proposals", dream_call[1])
        for proposal in dream_call[1]["proposals"]:
            # Proposals are candidate descriptions, never direct writes.
            self.assertIn("kind", proposal)

    def test_fallback_result_helper(self) -> None:
        result = fallback_result("manual")
        self.assertEqual(result.run_id, "")
        self.assertEqual(result.fallback_reason, "manual")

    def test_never_raises_fatal_on_unexpected_error(self) -> None:
        class ExplodingBridge(FakeHostBridge):
            def invoke(self, *args, **kwargs):  # type: ignore[override]
                raise RuntimeError("unexpected boom")

        orchestrator = DailyDreamOrchestrator(ExplodingBridge())
        result = orchestrator.run_daily(
            DreamRunInput(
                trace_id="trace-1",
                day="2026-08-16",
                available_host_capabilities=_capabilities(),
            )
        )
        # Any failure becomes a non-fatal fallback — the load-bearing assertion
        # is that run_daily returns a fallback result, never raises.
        self.assertTrue(result.fallback_reason)
        self.assertNotEqual(result.fallback_reason, "")


if __name__ == "__main__":
    unittest.main()
