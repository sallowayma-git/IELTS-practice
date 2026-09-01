from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from pydantic import ValidationError

from ielts_agent.dream.capacity import (
    MAX_ACTIVE_CANDIDATES,
    MAX_INPUT_OBSERVATIONS,
    MAX_LLM_RETRIES,
    MAX_OUTPUT_CANDIDATES,
    MAX_TOKEN_BUDGET,
    default_capacity,
)
from ielts_agent.dream.types import (
    DAILY_DREAM_SCHEMA_VERSION,
    DREAM_PROPOSAL_KINDS,
    JOURNAL_FACTS_SCHEMA_VERSION,
    DailyDreamResult,
    DreamCapacity,
    DreamProposal,
    DreamProposalKind,
    JournalEnrichment,
    JournalFacts,
    JournalMemoryEvent,
    MemoryChangeSummary,
    SkillDelta,
    WritingEvalSummary,
)


def _journal_facts(**overrides: object) -> JournalFacts:
    base: dict[str, object] = {
        "journalDate": "2026-08-16",
        "attemptsCount": 3,
        "sourceHash": "sha-abc123",
    }
    base.update(overrides)
    return JournalFacts.model_validate(base)


class DreamProposalKindTests(unittest.TestCase):
    def test_kind_enum_has_exactly_six_values(self) -> None:
        self.assertEqual(
            {kind.value for kind in DreamProposalKind},
            {
                "REINFORCE",
                "REFINE",
                "IMPROVE",
                "REGRESS",
                "CONTRADICT",
                "NOOP",
            },
        )

    def test_kinds_frozenset_matches_enum(self) -> None:
        self.assertEqual(
            DREAM_PROPOSAL_KINDS,
            frozenset(kind.value for kind in DreamProposalKind),
        )

    def test_unknown_kind_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            DreamProposal.model_validate({"kind": "WEEKLY"})


class JournalFactsTests(unittest.TestCase):
    def test_defaults_and_schema_version(self) -> None:
        facts = _journal_facts()
        self.assertEqual(facts.schema_version, JOURNAL_FACTS_SCHEMA_VERSION)
        self.assertEqual(facts.attempts_count, 3)
        self.assertEqual(facts.coach_feedback_count, 0)
        self.assertEqual(facts.time_spent_ms, 0)

    def test_deny_unknown_fields(self) -> None:
        with self.assertRaises(ValidationError):
            JournalFacts.model_validate(
                {"journalDate": "2026-08-16", "sourceHash": "h", "bogus": 1}
            )

    def test_frozen(self) -> None:
        facts = _journal_facts()
        with self.assertRaises(ValidationError):
            facts.attempts_count = 99  # type: ignore[misc]

    def test_observation_ids_must_be_stable_obs(self) -> None:
        with self.assertRaises(ValidationError):
            JournalFacts.model_validate(
                {
                    "journalDate": "2026-08-16",
                    "sourceHash": "h",
                    "todayObservationIds": ["not-obs-1"],
                }
            )

    def test_observation_ids_unique(self) -> None:
        with self.assertRaises(ValidationError):
            JournalFacts.model_validate(
                {
                    "journalDate": "2026-08-16",
                    "sourceHash": "h",
                    "todayObservationIds": ["obs-1", "obs-1"],
                }
            )

    def test_facts_json_stable_canonical(self) -> None:
        facts = _journal_facts()
        json_a = facts.facts_json()
        json_b = facts.facts_json()
        self.assertEqual(json_a, json_b)
        # Canonical: sorted keys, no whitespace.
        self.assertNotIn(" ", json_a.replace(" ", ""))

    def test_skill_delta_bounded(self) -> None:
        delta = SkillDelta(skillKey="reading.tfng", delta=0.1, evidenceCount=3)
        self.assertEqual(delta.skill_key, "reading.tfng")
        self.assertEqual(delta.evidence_count, 3)
        with self.assertRaises(ValidationError):
            SkillDelta(skillKey="s", delta=2.0)
        with self.assertRaises(ValidationError):
            SkillDelta(skillKey="s", delta=0.1, evidenceCount=-1)

    def test_writing_eval_summary(self) -> None:
        summary = WritingEvalSummary(completed=2, degraded=0, averageBand=6.5)
        self.assertEqual(summary.completed, 2)
        with self.assertRaises(ValidationError):
            WritingEvalSummary(completed=2, degraded=0, averageBand=11.0)

    def test_memory_change_summary_counts(self) -> None:
        counts = MemoryChangeSummary.model_validate(
            {"newCandidates": 2, "reinforced": 1, "superseded": 3}
        )
        self.assertEqual(counts.new_candidates, 2)
        self.assertEqual(counts.reinforced, 1)
        self.assertEqual(counts.superseded, 3)
        self.assertEqual(counts.promoted, 0)
        with self.assertRaises(ValidationError):
            MemoryChangeSummary(reinforced=-1)

    def test_memory_event_shape(self) -> None:
        event = JournalMemoryEvent.model_validate(
            {
                "memoryId": "mem-1",
                "namespace": "strategy",
                "canonicalKey": "strategy.reading",
                "changeKind": "reinforced",
            }
        )
        self.assertEqual(event.memory_id, "mem-1")
        self.assertEqual(event.change_kind, "reinforced")
        with self.assertRaises(ValidationError):
            JournalMemoryEvent.model_validate(
                {
                    "memoryId": "",
                    "namespace": "strategy",
                    "canonicalKey": "k",
                    "changeKind": "reinforced",
                }
            )

    def test_journal_facts_memory_events_wire(self) -> None:
        facts = JournalFacts.model_validate(
            {
                "journalDate": "2026-08-16",
                "sourceHash": "sha-abc123",
                "memoryChanges": {"reinforced": 1},
                "memoryEvents": [
                    {
                        "memoryId": "mem-1",
                        "namespace": "strategy",
                        "canonicalKey": "strategy.reading",
                        "changeKind": "reinforced",
                    }
                ],
            }
        )
        self.assertEqual(len(facts.memory_events), 1)
        self.assertEqual(facts.memory_change_counts.reinforced, 1)
        # Unknown wire fields stay forbidden (strict contract guard).
        with self.assertRaises(ValidationError):
            JournalFacts.model_validate(
                {
                    "journalDate": "2026-08-16",
                    "sourceHash": "sha-abc123",
                    "memoryEvents": [],
                    "bogusField": 1,
                }
            )


class DreamProposalTests(unittest.TestCase):
    def test_reinforce_requires_target_and_evidence(self) -> None:
        proposal = DreamProposal.model_validate(
            {
                "kind": "REINFORCE",
                "targetMemoryId": "mem-1",
                "evidenceObservationIds": ["obs-1"],
            }
        )
        self.assertEqual(proposal.kind, DreamProposalKind.REINFORCE)

    def test_reinforce_rejects_missing_target(self) -> None:
        with self.assertRaises(ValidationError):
            DreamProposal.model_validate(
                {"kind": "REINFORCE", "evidenceObservationIds": ["obs-1"]}
            )

    def test_reinforce_rejects_missing_evidence(self) -> None:
        with self.assertRaises(ValidationError):
            DreamProposal.model_validate(
                {"kind": "REINFORCE", "targetMemoryId": "mem-1"}
            )

    def test_target_memory_id_must_be_mem(self) -> None:
        with self.assertRaises(ValidationError):
            DreamProposal.model_validate(
                {
                    "kind": "REINFORCE",
                    "targetMemoryId": "not-mem",
                    "evidenceObservationIds": ["obs-1"],
                }
            )

    def test_refine_requires_statement(self) -> None:
        with self.assertRaises(ValidationError):
            DreamProposal.model_validate(
                {
                    "kind": "REFINE",
                    "targetMemoryId": "mem-1",
                    "evidenceObservationIds": ["obs-1"],
                }
            )
        proposal = DreamProposal.model_validate(
            {
                "kind": "REFINE",
                "targetMemoryId": "mem-1",
                "proposedStatement": "refined statement",
                "evidenceObservationIds": ["obs-1"],
            }
        )
        self.assertEqual(proposal.proposed_statement, "refined statement")

    def test_noop_rejects_target_and_statement(self) -> None:
        with self.assertRaises(ValidationError):
            DreamProposal.model_validate(
                {
                    "kind": "NOOP",
                    "targetMemoryId": "mem-1",
                    "evidenceObservationIds": ["obs-1"],
                }
            )
        noop = DreamProposal.model_validate({"kind": "NOOP"})
        self.assertIsNone(noop.target_memory_id)

    def test_evidence_ids_must_be_obs(self) -> None:
        with self.assertRaises(ValidationError):
            DreamProposal.model_validate(
                {
                    "kind": "IMPROVE",
                    "targetMemoryId": "mem-1",
                    "evidenceObservationIds": ["not-obs"],
                }
            )

    def test_evidence_ids_unique(self) -> None:
        with self.assertRaises(ValidationError):
            DreamProposal.model_validate(
                {
                    "kind": "REGRESS",
                    "targetMemoryId": "mem-1",
                    "evidenceObservationIds": ["obs-1", "obs-1"],
                }
            )

    def test_to_wire_roundtrip(self) -> None:
        proposal = DreamProposal.model_validate(
            {
                "kind": "CONTRADICT",
                "targetMemoryId": "mem-1",
                "evidenceObservationIds": ["obs-1", "obs-2"],
                "rationale": "contradicts prior",
            }
        )
        wire = proposal.to_wire()
        self.assertEqual(wire["kind"], "CONTRADICT")
        self.assertEqual(wire["targetMemoryId"], "mem-1")
        self.assertEqual(wire["evidenceObservationIds"], ["obs-1", "obs-2"])


class DailyDreamResultTests(unittest.TestCase):
    def test_run_result_requires_run_id_when_not_fallback(self) -> None:
        with self.assertRaises(ValidationError):
            DailyDreamResult.model_validate(
                {"runId": "", "accepted": 1, "rejected": 0, "failed": 0}
            )

    def test_fallback_result(self) -> None:
        result = DailyDreamResult.model_validate(
            {"runId": "", "fallbackReason": "host_down"}
        )
        self.assertEqual(result.run_id, "")
        self.assertEqual(result.fallback_reason, "host_down")

    def test_fallback_must_not_carry_run_id(self) -> None:
        with self.assertRaises(ValidationError):
            DailyDreamResult.model_validate(
                {"runId": "run-1", "fallbackReason": "host_down"}
            )

    def test_to_wire(self) -> None:
        result = DailyDreamResult.model_validate(
            {"runId": "run-1", "accepted": 2, "rejected": 1, "failed": 0}
        )
        wire = result.to_wire()
        self.assertEqual(wire["runId"], "run-1")
        self.assertEqual(wire["accepted"], 2)


class DreamCapacityTests(unittest.TestCase):
    def test_default_capacity_constants(self) -> None:
        cap = default_capacity()
        self.assertEqual(cap.max_input_observations, MAX_INPUT_OBSERVATIONS)
        self.assertEqual(cap.max_active_candidates, MAX_ACTIVE_CANDIDATES)
        self.assertEqual(cap.max_output_candidates, MAX_OUTPUT_CANDIDATES)
        self.assertEqual(cap.max_token_budget, MAX_TOKEN_BUDGET)
        self.assertEqual(cap.max_llm_retries, MAX_LLM_RETRIES)

    def test_default_constants_match_spec(self) -> None:
        self.assertEqual(MAX_INPUT_OBSERVATIONS, 200)
        self.assertEqual(MAX_ACTIVE_CANDIDATES, 50)
        self.assertEqual(MAX_OUTPUT_CANDIDATES, 10)
        self.assertEqual(MAX_TOKEN_BUDGET, 4000)
        self.assertEqual(MAX_LLM_RETRIES, 1)

    def test_input_observations_bounded_at_200(self) -> None:
        with self.assertRaises(ValidationError):
            DreamCapacity.model_validate(
                {
                    "maxInputObservations": 201,
                    "maxActiveCandidates": 10,
                    "maxOutputCandidates": 5,
                    "maxTokenBudget": 1000,
                    "maxLlmRetries": 1,
                }
            )

    def test_output_candidates_bounded_at_10(self) -> None:
        with self.assertRaises(ValidationError):
            DreamCapacity.model_validate(
                {
                    "maxInputObservations": 50,
                    "maxActiveCandidates": 50,
                    "maxOutputCandidates": 11,
                    "maxTokenBudget": 1000,
                    "maxLlmRetries": 1,
                }
            )

    def test_token_budget_bounded(self) -> None:
        with self.assertRaises(ValidationError):
            DreamCapacity.model_validate(
                {
                    "maxInputObservations": 50,
                    "maxActiveCandidates": 10,
                    "maxOutputCandidates": 5,
                    "maxTokenBudget": 5000,
                    "maxLlmRetries": 1,
                }
            )

    def test_llm_retries_bounded_at_1(self) -> None:
        with self.assertRaises(ValidationError):
            DreamCapacity.model_validate(
                {
                    "maxInputObservations": 50,
                    "maxActiveCandidates": 10,
                    "maxOutputCandidates": 5,
                    "maxTokenBudget": 1000,
                    "maxLlmRetries": 2,
                }
            )

    def test_output_cannot_exceed_active(self) -> None:
        with self.assertRaises(ValidationError):
            DreamCapacity.model_validate(
                {
                    "maxInputObservations": 50,
                    "maxActiveCandidates": 5,
                    "maxOutputCandidates": 10,
                    "maxTokenBudget": 1000,
                    "maxLlmRetries": 1,
                }
            )


class JournalEnrichmentTests(unittest.TestCase):
    def test_enrichment_defaults(self) -> None:
        enrichment = JournalEnrichment(
            title="Daily journal — 2026-08-16",
            factsRef="sha-abc",
        )
        self.assertEqual(enrichment.summary, "")
        self.assertEqual(enrichment.open_hypotheses, [])
        self.assertFalse(enrichment.llm_used)

    def test_enrichment_hypotheses_non_empty(self) -> None:
        with self.assertRaises(ValidationError):
            JournalEnrichment.model_validate(
                {"title": "t", "factsRef": "r", "openHypotheses": ["", "  "]}
            )


if __name__ == "__main__":
    unittest.main()
