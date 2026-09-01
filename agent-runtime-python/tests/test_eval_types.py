"""M11 eval types tests — pydantic validation, case_kind 8 enum, holdout flag."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from pydantic import ValidationError

from ielts_agent.eval.types import (
    CANDIDATE_PROPOSAL_SCHEMA_VERSION,
    EVAL_CASE_KINDS,
    EVAL_CASE_SCHEMA_VERSION,
    EVAL_RUN_RESULT_SCHEMA_VERSION,
    HOST_ONLY_CAPABILITIES,
    REQUIRED_EVAL_HOST_CAPABILITIES,
    TRACE_GRADE_SCHEMA_VERSION,
    CandidateProposal,
    CandidateTargetKind,
    EvalCase,
    EvalCaseKind,
    EvalRunResult,
    TraceGrade,
)


class EvalCaseKindTests(unittest.TestCase):
    """M11-04: the case_kind taxonomy is closed at exactly eight values."""

    def test_case_kind_has_exactly_eight_values(self) -> None:
        self.assertEqual(len(EvalCaseKind), 8)
        self.assertEqual(
            {k.value for k in EvalCaseKind},
            {
                "memory_extraction_goldens",
                "false_merge_split",
                "consolidation_zero",
                "context_selection",
                "coach_personalization",
                "prompt_injection",
                "repeated_familiarity",
                "strategy_outcome",
            },
        )

    def test_eval_case_kinds_frozenset_matches_enum(self) -> None:
        self.assertEqual(EVAL_CASE_KINDS, {k.value for k in EvalCaseKind})


class EvalCaseTests(unittest.TestCase):
    """EvalCase pydantic validation + holdout flag."""

    def _valid_payload(self, **overrides) -> dict:
        payload = {
            "caseId": "m11-test-01",
            "caseKind": "memory_extraction_goldens",
            "module": "memory_extract",
            "input": {"transcript": "x"},
            "expected": {"goldenMemoryIds": ["mem-1"]},
            "promptVersionId": "prompt-v1",
            "skillVersionId": "skill-v1",
            "holdout": False,
        }
        payload.update(overrides)
        return payload

    def test_valid_case_parses(self) -> None:
        case = EvalCase.model_validate(self._valid_payload())
        self.assertEqual(case.case_id, "m11-test-01")
        self.assertEqual(case.case_kind, EvalCaseKind.MEMORY_EXTRACTION_GOLDENS)
        self.assertFalse(case.holdout)
        self.assertEqual(case.schema_version, EVAL_CASE_SCHEMA_VERSION)

    def test_holdout_flag_round_trips(self) -> None:
        case = EvalCase.model_validate(self._valid_payload(holdout=True))
        self.assertTrue(case.holdout)
        wire = case.to_wire()
        self.assertTrue(wire["holdout"])

    def test_rejects_unknown_case_kind(self) -> None:
        with self.assertRaises(ValidationError):
            EvalCase.model_validate(
                self._valid_payload(caseKind="totally_made_up")
            )

    def test_rejects_unknown_field(self) -> None:
        payload = self._valid_payload()
        payload["extraSurprise"] = "no"
        with self.assertRaises(ValidationError):
            EvalCase.model_validate(payload)

    def test_is_frozen(self) -> None:
        case = EvalCase.model_validate(self._valid_payload())
        with self.assertRaises(ValidationError):
            case.case_id = "mutated"  # type: ignore[misc]

    def test_to_wire_camel_case(self) -> None:
        case = EvalCase.model_validate(self._valid_payload())
        wire = case.to_wire()
        self.assertIn("caseId", wire)
        self.assertIn("caseKind", wire)
        self.assertIn("promptVersionId", wire)
        self.assertIn("skillVersionId", wire)
        self.assertNotIn("case_id", wire)

    def test_rejects_blank_version_ids(self) -> None:
        with self.assertRaises(ValidationError):
            EvalCase.model_validate(
                self._valid_payload(promptVersionId="")
            )
        with self.assertRaises(ValidationError):
            EvalCase.model_validate(
                self._valid_payload(skillVersionId="")
            )


class EvalRunResultTests(unittest.TestCase):
    """EvalRunResult validation + passed property + fallback semantics."""

    def _valid_payload(self, **overrides) -> dict:
        payload = {
            "runId": "run-1",
            "targetKind": "prompt",
            "targetVersionId": "prompt-cand-1",
            "passedCount": 8,
            "failedCount": 0,
            "metrics": {"passRate": 1.0},
            "promptVersionId": "prompt-v1",
            "skillVersionId": "skill-v1",
            "noUserVisibleSideEffect": False,
        }
        payload.update(overrides)
        return payload

    def test_valid_result_parses(self) -> None:
        result = EvalRunResult.model_validate(self._valid_payload())
        self.assertTrue(result.passed)
        self.assertEqual(result.schema_version, EVAL_RUN_RESULT_SCHEMA_VERSION)

    def test_passed_false_when_failed_count_positive(self) -> None:
        result = EvalRunResult.model_validate(
            self._valid_payload(failedCount=1)
        )
        self.assertFalse(result.passed)

    def test_passed_false_when_zero_cases_ran(self) -> None:
        result = EvalRunResult.model_validate(
            self._valid_payload(passedCount=0, failedCount=0)
        )
        self.assertFalse(result.passed)

    def test_passed_false_on_fallback(self) -> None:
        """A fallback result never counts as a passing eval (fail-closed:
        a host failure can never accidentally promote a candidate)."""
        result = EvalRunResult.model_validate(
            self._valid_payload(fallback=True, fallbackReason="host_down")
        )
        self.assertFalse(result.passed)

    def test_to_wire_camel_case(self) -> None:
        result = EvalRunResult.model_validate(self._valid_payload())
        wire = result.to_wire()
        self.assertIn("runId", wire)
        self.assertIn("targetKind", wire)
        self.assertIn("noUserVisibleSideEffect", wire)
        self.assertNotIn("run_id", wire)


class CandidateProposalTests(unittest.TestCase):
    """CandidateProposal validation + target_kind enum."""

    def test_valid_proposal_parses(self) -> None:
        proposal = CandidateProposal.model_validate(
            {
                "targetKind": "prompt",
                "targetVersionId": "prompt-cand-1",
                "baseVersionId": "prompt-v1",
                "proposalJson": {"body": "new prompt"},
                "rationale": "addresses false-merge regression",
            }
        )
        self.assertEqual(proposal.target_kind, CandidateTargetKind.PROMPT)
        self.assertEqual(
            proposal.schema_version, CANDIDATE_PROPOSAL_SCHEMA_VERSION
        )

    def test_skill_target_kind(self) -> None:
        proposal = CandidateProposal.model_validate(
            {
                "targetKind": "skill",
                "targetVersionId": "skill-cand-1",
                "baseVersionId": "skill-v1",
                "proposalJson": {"flow": "x"},
                "rationale": "refines evidence extraction",
            }
        )
        self.assertEqual(proposal.target_kind, CandidateTargetKind.SKILL)

    def test_rejects_unknown_target_kind(self) -> None:
        with self.assertRaises(ValidationError):
            CandidateProposal.model_validate(
                {
                    "targetKind": "soul",  # forbidden
                    "targetVersionId": "x",
                    "baseVersionId": "y",
                    "proposalJson": {},
                    "rationale": "z",
                }
            )

    def test_rejects_unknown_field(self) -> None:
        with self.assertRaises(ValidationError):
            CandidateProposal.model_validate(
                {
                    "targetKind": "prompt",
                    "targetVersionId": "x",
                    "baseVersionId": "y",
                    "proposalJson": {},
                    "rationale": "z",
                    "extra": "no",
                }
            )


class TraceGradeTests(unittest.TestCase):
    """TraceGrade validation + passed property + dimension clamping."""

    def test_valid_grade_parses(self) -> None:
        grade = TraceGrade.model_validate(
            {
                "caseId": "c1",
                "finalAnswerQuality": 1.0,
                "contextUsed": 1.0,
                "irrelevantTool": 1.0,
                "memoryCitation": 1.0,
                "counterEvidence": 1.0,
                "oversizedOutput": 1.0,
                "costLatency": 1.0,
                "gradeMethod": "deterministic",
            }
        )
        self.assertTrue(grade.passed)
        self.assertEqual(grade.schema_version, TRACE_GRADE_SCHEMA_VERSION)

    def test_passed_false_when_any_dimension_below_bar(self) -> None:
        grade = TraceGrade.model_validate(
            {
                "caseId": "c1",
                "finalAnswerQuality": 0.4,
                "contextUsed": 1.0,
                "irrelevantTool": 1.0,
                "memoryCitation": 1.0,
                "counterEvidence": 1.0,
                "oversizedOutput": 1.0,
                "costLatency": 1.0,
            }
        )
        self.assertFalse(grade.passed)

    def test_dimension_clamped_to_unit_interval(self) -> None:
        with self.assertRaises(ValidationError):
            TraceGrade.model_validate(
                {"caseId": "c1", "finalAnswerQuality": 1.5}
            )
        with self.assertRaises(ValidationError):
            TraceGrade.model_validate(
                {"caseId": "c1", "finalAnswerQuality": -0.1}
            )

    def test_to_wire_camel_case(self) -> None:
        grade = TraceGrade.model_validate({"caseId": "c1"})
        wire = grade.to_wire()
        self.assertIn("finalAnswerQuality", wire)
        self.assertIn("irrelevantTool", wire)
        self.assertIn("counterEvidence", wire)
        self.assertIn("costLatency", wire)


class CapabilityPinsTests(unittest.TestCase):
    """The host capability pins are all version "1" and the required set
    covers every M11 Slice-1 capability."""

    def test_all_capabilities_pinned_to_v1(self) -> None:
        for version in REQUIRED_EVAL_HOST_CAPABILITIES.values():
            self.assertEqual(version, "1")

    def test_required_capabilities_cover_slice1_read_and_propose_methods(
        self,
    ) -> None:
        """Round-3 audit (A2): the runtime requires only read + propose.

        Promotion, rollback and eval-verdict recording are authority
        operations the host no longer serves, so requiring them here would
        make every orchestrator call fail its capability check.
        """
        expected = {
            "prompt.list_versions",
            "prompt.get_active",
            "prompt.propose_candidate",
            "skill.list_versions",
        }
        self.assertEqual(
            set(REQUIRED_EVAL_HOST_CAPABILITIES.keys()), expected
        )

    def test_authority_capabilities_are_not_required_by_the_runtime(
        self,
    ) -> None:
        """Round-3 audit (A2): these must never re-enter the required set."""
        self.assertEqual(
            HOST_ONLY_CAPABILITIES,
            frozenset(
                {
                    "prompt.promote_candidate",
                    "prompt.rollback",
                    "eval.run_case",
                }
            ),
        )
        for capability in HOST_ONLY_CAPABILITIES:
            self.assertNotIn(capability, REQUIRED_EVAL_HOST_CAPABILITIES)


if __name__ == "__main__":
    unittest.main()
