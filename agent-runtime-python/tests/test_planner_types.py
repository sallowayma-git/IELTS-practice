"""M12-04 Study Planner pydantic type contracts (Slice 2 / Python side).

Verifies the closed/frozen/strict/camelCase/deny-unknown-field contracts for
the planner wire types. No host bridge, no canonical DB.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

import pydantic

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from ielts_agent.planner.types import (
    PLANNER_INPUT_SCHEMA_VERSION,
    REQUIRED_STUDY_PLANNER_HOST_CAPABILITIES,
    SKILL_PROBE_KINDS,
    STUDY_PLAN_PROPOSAL_SCHEMA_VERSION,
    PlannerInput,
    QuestionKind,
    SkillProbe,
    SkillProbeKind,
    SkillReviewNeed,
    SkillStateView,
    StudyPlanItem,
    StudyPlanProposal,
)


def _need(
    *,
    skill_key: str = "reading.tfng",
    priority: float = 0.8,
    preferred_probe: SkillProbeKind = SkillProbeKind.CONTRASTIVE_PAIR,
    due_at: str = "2026-08-16T00:00:00Z",
    avoid_asset_ids: list[str] | None = None,
    reason_codes: list[str] | None = None,
) -> SkillReviewNeed:
    return SkillReviewNeed(
        skillKey=skill_key,
        priority=priority,
        priorityBand="high",
        dueAt=due_at,
        preferredProbe=preferred_probe,
        avoidAssetIds=avoid_asset_ids if avoid_asset_ids is not None else [],
        reasonCodes=reason_codes if reason_codes is not None else [],
        uncertaintyBand="high",
        masteryMean=0.3,
        evidenceCount=4,
    )


def _probe(*, skill_key: str = "reading.tfng") -> SkillProbe:
    return SkillProbe(
        skillKey=skill_key,
        probeKind=SkillProbeKind.CONTRASTIVE_PAIR,
        avoidAssetIds=["asset-1"],
        reasonCodes=["overdue"],
    )


def _item(
    *,
    item_id: str = "item-1-reading.tfng",
    estimated_minutes: int = 15,
    skill_key: str = "reading.tfng",
) -> StudyPlanItem:
    return StudyPlanItem(
        itemId=item_id,
        skillProbe=_probe(skill_key=skill_key),
        whyText="schedule:skill=reading.tfng;priority=0.800",
        estimatedMinutes=estimated_minutes,
        questionKind=QuestionKind.READING_TFNG,
    )


class SkillProbeKindTests(unittest.TestCase):
    def test_exactly_five_probe_kinds(self) -> None:
        self.assertEqual(
            {kind.value for kind in SkillProbeKind},
            {
                "novel_item",
                "same_item_retention",
                "contrastive_pair",
                "coach_micro_drill",
                "writing_rewrite",
            },
        )

    def test_skill_probe_kinds_set_matches_enum(self) -> None:
        self.assertEqual(
            SKILL_PROBE_KINDS,
            {kind.value for kind in SkillProbeKind},
        )


class SkillProbeTests(unittest.TestCase):
    def test_camel_case_alias_roundtrip(self) -> None:
        probe = SkillProbe.model_validate(
            {
                "skillKey": "reading.tfng",
                "probeKind": "contrastive_pair",
                "avoidAssetIds": ["asset-1", "asset-2"],
                "reasonCodes": ["overdue"],
            }
        )
        self.assertEqual(probe.skill_key, "reading.tfng")
        self.assertEqual(probe.probe_kind, SkillProbeKind.CONTRASTIVE_PAIR)
        self.assertEqual(probe.avoid_asset_ids, ["asset-1", "asset-2"])
        self.assertEqual(probe.reason_codes, ["overdue"])

    def test_deny_unknown_fields(self) -> None:
        with self.assertRaises(pydantic.ValidationError):
            SkillProbe.model_validate(
                {"skillKey": "reading.tfng", "probeKind": "novel_item", "extra": 1}
            )

    def test_frozen(self) -> None:
        probe = _probe()
        with self.assertRaises(pydantic.ValidationError):
            probe.skill_key = "other"  # type: ignore[misc]

    def test_duplicate_avoid_asset_ids_rejected(self) -> None:
        with self.assertRaises(pydantic.ValidationError):
            SkillProbe.model_validate(
                {
                    "skillKey": "reading.tfng",
                    "probeKind": "novel_item",
                    "avoidAssetIds": ["asset-1", "asset-1"],
                }
            )

    def test_empty_avoid_asset_id_rejected(self) -> None:
        with self.assertRaises(pydantic.ValidationError):
            SkillProbe.model_validate(
                {
                    "skillKey": "reading.tfng",
                    "probeKind": "novel_item",
                    "avoidAssetIds": [""],
                }
            )

    def test_to_wire_camel_case(self) -> None:
        probe = _probe()
        wire = probe.to_wire()
        self.assertEqual(wire["skillKey"], "reading.tfng")
        self.assertEqual(wire["probeKind"], "contrastive_pair")
        self.assertEqual(wire["avoidAssetIds"], ["asset-1"])
        self.assertEqual(wire["reasonCodes"], ["overdue"])

    def test_never_carries_exact_question_id(self) -> None:
        # M12-05: a skill probe targets a skill, never a memorised question id.
        # The model has NO field for an original asset/question id to repeat.
        fields = set(SkillProbe.model_fields.keys())
        self.assertNotIn("assetId", fields)
        self.assertNotIn("questionId", fields)
        self.assertNotIn("originalAssetId", fields)


class StudyPlanItemTests(unittest.TestCase):
    def test_camel_case_alias_and_schema_version(self) -> None:
        item = StudyPlanItem.model_validate(
            {
                "itemId": "item-1",
                "skillProbe": {
                    "skillKey": "reading.tfng",
                    "probeKind": "contrastive_pair",
                    "avoidAssetIds": [],
                    "reasonCodes": [],
                },
                "whyText": "because",
                "estimatedMinutes": 20,
                "questionKind": "reading_tfng",
            }
        )
        self.assertEqual(item.schema_version, STUDY_PLAN_PROPOSAL_SCHEMA_VERSION)
        self.assertEqual(item.item_id, "item-1")
        self.assertEqual(item.estimated_minutes, 20)

    def test_estimated_minutes_bounds(self) -> None:
        with self.assertRaises(pydantic.ValidationError):
            _item(estimated_minutes=0)
        with self.assertRaises(pydantic.ValidationError):
            _item(estimated_minutes=241)

    def test_deny_unknown_fields(self) -> None:
        with self.assertRaises(pydantic.ValidationError):
            StudyPlanItem.model_validate(
                {
                    "itemId": "item-1",
                    "skillProbe": {
                        "skillKey": "reading.tfng",
                        "probeKind": "novel_item",
                        "avoidAssetIds": [],
                        "reasonCodes": [],
                    },
                    "whyText": "because",
                    "estimatedMinutes": 10,
                    "questionKind": "reading_tfng",
                    "bonus": True,
                }
            )

    def test_to_wire_shape(self) -> None:
        wire = _item().to_wire()
        self.assertEqual(wire["schemaVersion"], STUDY_PLAN_PROPOSAL_SCHEMA_VERSION)
        self.assertEqual(wire["itemId"], "item-1-reading.tfng")
        self.assertEqual(wire["estimatedMinutes"], 15)
        self.assertEqual(wire["questionKind"], "reading_tfng")
        self.assertIn("skillProbe", wire)


class StudyPlanProposalTests(unittest.TestCase):
    def test_zero_item_proposal_is_valid_not_fallback(self) -> None:
        # M12-04: a 0-item proposal is a legitimate "no practice today" result.
        proposal = StudyPlanProposal(
            planId="",
            userGoal="prepare for IELTS",
            items=[],
            totalEstimatedMinutes=0,
            fallbackReason=None,
        )
        self.assertEqual(proposal.items, [])
        self.assertIsNone(proposal.fallback_reason)

    def test_fallback_proposal_must_not_carry_items_or_plan_id(self) -> None:
        with self.assertRaises(pydantic.ValidationError):
            StudyPlanProposal(
                planId="plan-1",
                userGoal="goal",
                items=[],
                totalEstimatedMinutes=0,
                fallbackReason="host_down",
            )
        with self.assertRaises(pydantic.ValidationError):
            StudyPlanProposal(
                planId="",
                userGoal="goal",
                items=[_item()],
                totalEstimatedMinutes=15,
                fallbackReason="host_down",
            )

    def test_total_must_equal_sum_of_items(self) -> None:
        with self.assertRaises(pydantic.ValidationError):
            StudyPlanProposal(
                planId="plan-1",
                userGoal="goal",
                items=[_item(estimated_minutes=15)],
                totalEstimatedMinutes=99,
                fallbackReason=None,
            )

    def test_total_recomputed_consistently_when_valid(self) -> None:
        proposal = StudyPlanProposal(
            planId="plan-1",
            userGoal="goal",
            items=[_item(estimated_minutes=15), _item(item_id="item-2", estimated_minutes=25)],
            totalEstimatedMinutes=40,
            fallbackReason=None,
        )
        self.assertEqual(proposal.total_estimated_minutes, 40)

    def test_duplicate_item_ids_rejected(self) -> None:
        with self.assertRaises(pydantic.ValidationError):
            StudyPlanProposal(
                planId="plan-1",
                userGoal="goal",
                items=[_item(item_id="dup"), _item(item_id="dup", estimated_minutes=20)],
                totalEstimatedMinutes=35,
                fallbackReason=None,
            )

    def test_deny_unknown_fields(self) -> None:
        with self.assertRaises(pydantic.ValidationError):
            StudyPlanProposal.model_validate(
                {
                    "planId": "",
                    "userGoal": "goal",
                    "items": [],
                    "totalEstimatedMinutes": 0,
                    "fallbackReason": None,
                    "extra": 1,
                }
            )

    def test_frozen(self) -> None:
        proposal = StudyPlanProposal(
            planId="",
            userGoal="goal",
            items=[],
            totalEstimatedMinutes=0,
            fallbackReason=None,
        )
        with self.assertRaises(pydantic.ValidationError):
            proposal.plan_id = "plan-1"  # type: ignore[misc]

    def test_to_wire_shape(self) -> None:
        proposal = StudyPlanProposal(
            planId="plan-1",
            userGoal="goal",
            items=[_item()],
            totalEstimatedMinutes=15,
            fallbackReason=None,
        )
        wire = proposal.to_wire()
        self.assertEqual(wire["planId"], "plan-1")
        self.assertEqual(wire["totalEstimatedMinutes"], 15)
        self.assertEqual(len(wire["items"]), 1)
        self.assertIsNone(wire["fallbackReason"])


class PlannerInputTests(unittest.TestCase):
    def test_defaults_and_schema_version(self) -> None:
        planner_input = PlannerInput(
            traceId="trace-1",
            userGoal="prepare for IELTS",
            availableMinutes=60,
        )
        self.assertEqual(planner_input.schema_version, PLANNER_INPUT_SCHEMA_VERSION)
        self.assertEqual(planner_input.skill_review_needs, [])
        self.assertEqual(planner_input.learner_uncertainty, {})
        self.assertEqual(planner_input.recent_workload_minutes, 0)
        self.assertEqual(planner_input.user_preferences, {})
        self.assertEqual(planner_input.target_date, "")
        self.assertEqual(planner_input.plan_date, "")

    def test_camel_case_aliases(self) -> None:
        planner_input = PlannerInput.model_validate(
            {
                "traceId": "trace-1",
                "userGoal": "goal",
                "availableMinutes": 45,
                "skillReviewNeeds": [
                    {
                        "skillKey": "reading.tfng",
                        "priority": 0.9,
                        "priorityBand": "high",
                        "dueAt": "2026-08-16T00:00:00Z",
                        "preferredProbe": "contrastive_pair",
                        "avoidAssetIds": ["a1"],
                        "reasonCodes": ["overdue"],
                        "uncertaintyBand": "high",
                        "masteryMean": 0.3,
                        "evidenceCount": 4,
                    }
                ],
                "learnerUncertainty": {"reading.tfng": 0.8},
                "recentWorkloadMinutes": 120,
                "userPreferences": {"max_session_minutes": 20},
                "targetDate": "2026-09-01",
                "planDate": "2026-08-16",
            }
        )
        self.assertEqual(len(planner_input.skill_review_needs), 1)
        self.assertEqual(planner_input.skill_review_needs[0].skill_key, "reading.tfng")
        self.assertEqual(planner_input.learner_uncertainty, {"reading.tfng": 0.8})
        self.assertEqual(planner_input.target_date, "2026-09-01")

    def test_duplicate_skill_keys_in_needs_rejected(self) -> None:
        with self.assertRaises(pydantic.ValidationError):
            PlannerInput.model_validate(
                {
                    "traceId": "trace-1",
                    "userGoal": "goal",
                    "availableMinutes": 60,
                    "skillReviewNeeds": [
                        _need(skill_key="reading.tfng").model_dump(by_alias=True),
                        _need(skill_key="reading.tfng", priority=0.5).model_dump(by_alias=True),
                    ],
                }
            )

    def test_uncertainty_out_of_range_rejected(self) -> None:
        with self.assertRaises(pydantic.ValidationError):
            PlannerInput.model_validate(
                {
                    "traceId": "trace-1",
                    "userGoal": "goal",
                    "availableMinutes": 60,
                    "learnerUncertainty": {"reading.tfng": 1.5},
                }
            )

    def test_available_minutes_bounds(self) -> None:
        with self.assertRaises(pydantic.ValidationError):
            PlannerInput(traceId="t", userGoal="g", availableMinutes=-1)
        with self.assertRaises(pydantic.ValidationError):
            PlannerInput(traceId="t", userGoal="g", availableMinutes=721)

    def test_deny_unknown_fields(self) -> None:
        with self.assertRaises(pydantic.ValidationError):
            PlannerInput.model_validate(
                {
                    "traceId": "t",
                    "userGoal": "g",
                    "availableMinutes": 60,
                    "surprise": True,
                }
            )

    def test_frozen(self) -> None:
        planner_input = PlannerInput(traceId="t", userGoal="g", availableMinutes=60)
        with self.assertRaises(pydantic.ValidationError):
            planner_input.available_minutes = 99  # type: ignore[misc]


class SkillReviewNeedTests(unittest.TestCase):
    def test_camel_case_parse(self) -> None:
        need = _need()
        self.assertEqual(need.skill_key, "reading.tfng")
        self.assertEqual(need.preferred_probe, SkillProbeKind.CONTRASTIVE_PAIR)
        self.assertEqual(need.priority_band, "high")

    def test_priority_must_be_non_negative(self) -> None:
        with self.assertRaises(pydantic.ValidationError):
            SkillReviewNeed.model_validate(
                {
                    "skillKey": "reading.tfng",
                    "priority": -0.1,
                    "priorityBand": "high",
                    "dueAt": "2026-08-16T00:00:00Z",
                    "preferredProbe": "novel_item",
                }
            )


class SkillStateViewTests(unittest.TestCase):
    def test_defaults_and_bounds(self) -> None:
        view = SkillStateView.model_validate(
            {
                "skillKey": "writing.task2",
                "masteryMean": 0.4,
                "uncertainty": 0.7,
                "uncertaintyBand": "high",
                "evidenceCount": 3,
            }
        )
        self.assertEqual(view.skill_key, "writing.task2")
        self.assertEqual(view.uncertainty, 0.7)


class CapabilityPinsTests(unittest.TestCase):
    def test_required_capabilities_pins_study_plan_create_v1(self) -> None:
        # The planner only REQUIRES study_plan.create to persist (M12-06).
        # The learner/memory reads are best-effort enrichment.
        self.assertEqual(
            REQUIRED_STUDY_PLANNER_HOST_CAPABILITIES,
            {"study_plan.create": "1"},
        )

    def test_schema_versions_are_v1(self) -> None:
        self.assertEqual(STUDY_PLAN_PROPOSAL_SCHEMA_VERSION, 1)
        self.assertEqual(PLANNER_INPUT_SCHEMA_VERSION, 1)


if __name__ == "__main__":
    unittest.main()
