from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from pydantic import ValidationError

from ielts_agent.dream.types import (
    JOURNAL_FACTS_SCHEMA_VERSION,
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
