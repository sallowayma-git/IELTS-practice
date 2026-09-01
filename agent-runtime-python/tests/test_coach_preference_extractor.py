from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from ielts_agent.coach.preference_extractor import (
    PREFERENCE_CANDIDATE_SCHEMA_VERSION,
    PreferenceExtractorInput,
    extract_preference_candidates,
)
from ielts_agent.coach.types import (
    CoachFeedbackKind,
    CoachFollowupType,
    CoachStrategyAssignment,
    ReaskLink,
)
from ielts_agent.memory_proposals import MemoryProposalAction, MemoryNamespace


def _assignment(*, strategy_id: str = "evidence_first_v1") -> CoachStrategyAssignment:
    return CoachStrategyAssignment(
        strategyId=strategy_id,
        skillsAddressed=["reading.tfng.false_vs_not_given"],
        memoryIdsUsed=["mem-strategy-reading-1"],
        contextSnapshotId="ctx-snap-1",
        followupType=CoachFollowupType.EXPLAIN,
    )


class PreferenceExtractorCandidateTests(unittest.TestCase):
    def test_need_example_produces_example_first_candidate(self) -> None:
        batch = extract_preference_candidates(
            PreferenceExtractorInput(
                activity="reading",
                feedback_kinds=frozenset({CoachFeedbackKind.NEED_EXAMPLE}),
                strategy_assignment=_assignment(),
                evidence_observation_ids=("obs-fb-1",),
            )
        )
        self.assertEqual(batch.schema_version, PREFERENCE_CANDIDATE_SCHEMA_VERSION)
        self.assertEqual(len(batch.proposals), 1)
        proposal = batch.proposals[0]
        self.assertEqual(proposal.action, MemoryProposalAction.ADD)
        self.assertEqual(proposal.namespace, MemoryNamespace.PREFERENCE)
        self.assertEqual(proposal.canonical_key, "preference.coach.example_first")
        self.assertEqual(proposal.evidence_observation_ids, ("obs-fb-1",))
        self.assertIn("reading", proposal.scope.to_wire()["key"])

    def test_too_long_produces_concise_candidate(self) -> None:
        batch = extract_preference_candidates(
            PreferenceExtractorInput(
                activity="writing",
                feedback_kinds=frozenset({CoachFeedbackKind.TOO_LONG}),
                evidence_observation_ids=("obs-fb-2",),
            )
        )
        self.assertEqual(len(batch.proposals), 1)
        proposal = batch.proposals[0]
        self.assertEqual(proposal.canonical_key, "preference.coach.concise")
        self.assertEqual(proposal.scope.to_wire()["key"], "writing")

    def test_thumbs_up_on_strategy_emits_strategy_family_candidate(self) -> None:
        batch = extract_preference_candidates(
            PreferenceExtractorInput(
                activity="reading",
                feedback_kinds=frozenset({CoachFeedbackKind.THUMBS_UP}),
                strategy_assignment=_assignment(strategy_id="step_by_step_v1"),
                evidence_observation_ids=("obs-fb-3",),
            )
        )
        self.assertEqual(len(batch.proposals), 1)
        self.assertEqual(
            batch.proposals[0].canonical_key, "preference.coach.step_by_step"
        )

    def test_candidates_only_in_preference_namespace(self) -> None:
        # The extractor must NEVER emit into knowledge/language/strategy/etc.
        batch = extract_preference_candidates(
            PreferenceExtractorInput(
                activity="reading",
                feedback_kinds=frozenset(
                    {
                        CoachFeedbackKind.NEED_EXAMPLE,
                        CoachFeedbackKind.TOO_LONG,
                        CoachFeedbackKind.NEED_STEP_BY_STEP,
                    }
                ),
                evidence_observation_ids=("obs-fb-4",),
            )
        )
        self.assertTrue(len(batch.proposals) >= 1)
        for proposal in batch.proposals:
            self.assertEqual(proposal.namespace, MemoryNamespace.PREFERENCE)
            self.assertTrue(
                proposal.canonical_key.startswith("preference.coach."),
                f"canonical key {proposal.canonical_key} must be preference.coach.*",
            )

    def test_candidate_does_not_auto_promote_to_soul(self) -> None:
        # The candidate statement must be phrased as a CANDIDATE, never as an
        # established/preference/Soul assertion. Promotion is a separate gate.
        batch = extract_preference_candidates(
            PreferenceExtractorInput(
                activity="reading",
                feedback_kinds=frozenset({CoachFeedbackKind.NEED_EXAMPLE}),
                evidence_observation_ids=("obs-fb-5",),
            )
        )
        statement = batch.proposals[0].statement.lower()
        self.assertIn("candidate", statement)
        self.assertIn("promotion requires", statement)
        # It must NOT assert itself as an active/preference/Soul fact.
        self.assertNotIn("is now an active preference", statement)
        self.assertNotIn("promoted to soul", statement)

    def test_no_evidence_no_candidate(self) -> None:
        # An ungrounded preference is exactly the truth-coupling the plan forbids.
        # Without grounding observation ids, the extractor returns an empty batch
        # rather than emitting an ungrounded candidate. The no-feedback path works.
        batch = extract_preference_candidates(
            PreferenceExtractorInput(
                activity="reading",
                feedback_kinds=frozenset({CoachFeedbackKind.NEED_EXAMPLE}),
                evidence_observation_ids=(),
            )
        )
        self.assertEqual(batch.proposals, ())

    def test_no_feedback_no_candidate(self) -> None:
        batch = extract_preference_candidates(
            PreferenceExtractorInput(
                activity="reading",
                feedback_kinds=frozenset(),
                evidence_observation_ids=("obs-fb-6",),
            )
        )
        self.assertEqual(batch.proposals, ())

    def test_reask_link_emits_socratic_and_example_candidates(self) -> None:
        link = ReaskLink(
            parentAssistantMessageId="msg-parent-1",
            newUserMessageId="msg-user-2",
            strategyAssignmentId="assign-1",
        )
        batch = extract_preference_candidates(
            PreferenceExtractorInput(
                activity="reading",
                reask_link=link,
                evidence_observation_ids=("obs-fb-7",),
            )
        )
        families = {p.canonical_key for p in batch.proposals}
        self.assertIn("preference.coach.socratic", families)
        self.assertIn("preference.coach.example_first", families)

    def test_deterministic_output_for_identical_input(self) -> None:
        inputs = PreferenceExtractorInput(
            activity="reading",
            feedback_kinds=frozenset(
                {CoachFeedbackKind.NEED_EXAMPLE, CoachFeedbackKind.TOO_LONG}
            ),
            evidence_observation_ids=("obs-fb-8",),
        )
        a = extract_preference_candidates(inputs)
        b = extract_preference_candidates(inputs)
        self.assertEqual(a.to_wire(), b.to_wire())

    def test_invalid_activity_rejected(self) -> None:
        with self.assertRaises(ValueError):
            extract_preference_candidates(
                PreferenceExtractorInput(
                    activity="math",
                    feedback_kinds=frozenset({CoachFeedbackKind.NEED_EXAMPLE}),
                    evidence_observation_ids=("obs-fb-9",),
                )
            )

    def test_canonical_key_shape_matches_namespace_contract(self) -> None:
        # The M3 validator requires canonicalKey to begin with the namespace.
        batch = extract_preference_candidates(
            PreferenceExtractorInput(
                activity="reading",
                feedback_kinds=frozenset({CoachFeedbackKind.NEED_EXAMPLE}),
                evidence_observation_ids=("obs-fb-10",),
            )
        )
        for proposal in batch.proposals:
            self.assertTrue(
                proposal.canonical_key.startswith(f"{proposal.namespace.value}."),
                "canonicalKey must begin with the declared namespace",
            )


if __name__ == "__main__":
    unittest.main()
