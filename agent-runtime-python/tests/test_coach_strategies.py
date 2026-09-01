from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from ielts_agent.coach.strategies import (
    STRATEGY_CATALOG,
    CoachStrategyId,
    StrategyDescriptor,
    StrategySelectionInput,
    catalog,
    get_descriptor,
    is_known_strategy,
    select_strategy,
)
from ielts_agent.coach.types import CoachFeedbackKind


# The exact frozen catalog from the engineering plan §M6-09. Adding a strategy
# requires a deliberate catalog bump — this test fails closed if it drifts.
EXPECTED_STRATEGY_IDS = frozenset(
    {
        "evidence_first_v1",
        "example_first_v1",
        "step_by_step_v1",
        "contrastive_v1",
        "socratic_prompt_v1",
        "concise_direct_v1",
    }
)


class StrategyCatalogTests(unittest.TestCase):
    def test_catalog_is_fixed_and_complete(self) -> None:
        ids = {descriptor.strategy_id for descriptor in catalog()}
        self.assertEqual(ids, EXPECTED_STRATEGY_IDS)

    def test_catalog_order_is_stable(self) -> None:
        # The catalog tuple order is the deterministic selection priority. A
        # reorder changes selection behavior, so it must be intentional.
        ordered = tuple(descriptor.strategy_id for descriptor in catalog())
        self.assertEqual(ordered, STRATEGY_CATALOG)

    def test_every_catalog_entry_has_descriptor_and_heuristic(self) -> None:
        for strategy_id in CoachStrategyId:
            descriptor = get_descriptor(strategy_id)
            self.assertIsInstance(descriptor, StrategyDescriptor)
            self.assertEqual(descriptor.strategy_id, strategy_id)
            # Selection heuristic fields are populated (never empty-description).
            self.assertTrue(descriptor.description.strip())
            self.assertIsInstance(descriptor.boosting_feedback, frozenset)
            self.assertIsInstance(descriptor.default_skill_prefixes, frozenset)

    def test_unknown_strategy_id_rejected(self) -> None:
        # The LLM cannot invent a strategy id. This is the closed-catalog gate.
        self.assertFalse(is_known_strategy("invented_strategy_v1"))
        self.assertFalse(is_known_strategy("evidence_first_v2"))
        self.assertFalse(is_known_strategy(""))
        # A raw string that is not a catalog member cannot become a StrategyId.
        with self.assertRaises(ValueError):
            CoachStrategyId("invented_strategy_v1")
        # Known ids resolve to their descriptor.
        descriptor = get_descriptor(CoachStrategyId.EVIDENCE_FIRST)
        self.assertEqual(descriptor.strategy_id, CoachStrategyId.EVIDENCE_FIRST)

    def test_known_strategy_id_accepted(self) -> None:
        for strategy_id in EXPECTED_STRATEGY_IDS:
            self.assertTrue(is_known_strategy(strategy_id))

    def test_no_learned_weights_exist(self) -> None:
        # M6 only selects + records. There must be NO weight field, score field,
        # or learned parameter on the descriptor — that is M10's job.
        for descriptor in catalog():
            self.assertFalse(
                hasattr(descriptor, "weight"),
                "M6 descriptors must not carry learned weights (M10 concern)",
            )
            self.assertFalse(
                hasattr(descriptor, "score"),
                "M6 descriptors must not carry learned scores (M10 concern)",
            )


class StrategySelectionDeterminismTests(unittest.TestCase):
    """M6-09: selection is deterministic and rule-based. No weights learned."""

    def _base_input(self, **overrides: object) -> StrategySelectionInput:
        defaults: dict[str, object] = {
            "skills_addressed": ("reading.tfng.false_vs_not_given",),
            "skill_proficiencies": {},
            "memory_canonical_keys": (),
            "prior_feedback_kinds": frozenset(),
            "is_reask": False,
        }
        defaults.update(overrides)
        return StrategySelectionInput(**defaults)  # type: ignore[arg-type]

    def test_identical_inputs_select_identically(self) -> None:
        a = select_strategy(self._base_input())
        b = select_strategy(self._base_input())
        self.assertEqual(a, b)

    def test_feedback_boost_overrides_skill_default(self) -> None:
        # need_example ⇒ example_first_v1, even though the skill family defaults
        # to a different strategy.
        selected = select_strategy(
            self._base_input(
                prior_feedback_kinds=frozenset({CoachFeedbackKind.NEED_EXAMPLE}),
            )
        )
        self.assertEqual(selected, CoachStrategyId.EXAMPLE_FIRST)

    def test_step_by_step_feedback_selects_step_by_step(self) -> None:
        selected = select_strategy(
            self._base_input(
                prior_feedback_kinds=frozenset(
                    {CoachFeedbackKind.NEED_STEP_BY_STEP}
                ),
            )
        )
        self.assertEqual(selected, CoachStrategyId.STEP_BY_STEP)

    def test_too_long_selects_concise_direct(self) -> None:
        selected = select_strategy(
            self._base_input(
                prior_feedback_kinds=frozenset({CoachFeedbackKind.TOO_LONG}),
            )
        )
        self.assertEqual(selected, CoachStrategyId.CONCISE_DIRECT)

    def test_reask_without_other_feedback_selects_socratic(self) -> None:
        selected = select_strategy(self._base_input(is_reask=True))
        self.assertEqual(selected, CoachStrategyId.SOCRATIC_PROMPT)

    def test_feedback_beats_reask(self) -> None:
        # A specific feedback boost has higher priority than the bare re-ask path.
        selected = select_strategy(
            self._base_input(
                prior_feedback_kinds=frozenset({CoachFeedbackKind.NEED_EXAMPLE}),
                is_reask=True,
            )
        )
        self.assertEqual(selected, CoachStrategyId.EXAMPLE_FIRST)

    def test_skill_family_default_when_no_feedback(self) -> None:
        # reading.tfng ⇒ contrastive_v1 (catalog default for that family).
        selected = select_strategy(
            self._base_input(skills_addressed=("reading.tfng.false_vs_not_given",))
        )
        self.assertEqual(selected, CoachStrategyId.CONTRASTIVE)

    def test_low_proficiency_selects_step_by_step(self) -> None:
        # Use a skill whose family matches NO catalog default so the proficiency
        # nudge (avg ≤ 0.25 ⇒ step_by_step) is the deciding factor.
        selected = select_strategy(
            self._base_input(
                skills_addressed=("reading.unknown.deep",),
                skill_proficiencies={"reading.unknown.deep": 0.1},
            )
        )
        self.assertEqual(selected, CoachStrategyId.STEP_BY_STEP)

    def test_high_proficiency_selects_concise_direct(self) -> None:
        selected = select_strategy(
            self._base_input(
                skills_addressed=("reading.unknown.deep",),
                skill_proficiencies={"reading.unknown.deep": 0.95},
            )
        )
        self.assertEqual(selected, CoachStrategyId.CONCISE_DIRECT)

    def test_fallback_is_evidence_first(self) -> None:
        # No feedback, no skill-family match, mid proficiency ⇒ grounded fallback.
        selected = select_strategy(
            self._base_input(
                skills_addressed=("writing.unknown_skill",),
                skill_proficiencies={"writing.unknown_skill": 0.5},
            )
        )
        self.assertEqual(selected, CoachStrategyId.EVIDENCE_FIRST)

    def test_multiple_skills_averages_proficiency(self) -> None:
        # Two skills whose families match no default; avg = 0.3, which is > 0.25
        # and < 0.85, so neither proficiency nudge fires ⇒ grounded fallback.
        selected = select_strategy(
            self._base_input(
                skills_addressed=(
                    "reading.unknown.one",
                    "reading.unknown.two",
                ),
                skill_proficiencies={
                    "reading.unknown.one": 0.1,
                    "reading.unknown.two": 0.5,
                },
            )
        )
        self.assertEqual(selected, CoachStrategyId.EVIDENCE_FIRST)


if __name__ == "__main__":
    unittest.main()
