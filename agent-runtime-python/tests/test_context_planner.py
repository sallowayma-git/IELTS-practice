"""Tests for M5-07 ContextPlan emission from retrieval + task input.

Asserts the plan only carries stable IDs + inclusion reasons (never prompt
text), respects section budget ratios, deduplicates ranked IDs by priority, and
leaves SOUL_POLICY empty for Rust to inject.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from ielts_agent.retrieval import (
    CONTEXT_PLAN_SCHEMA_VERSION,
    CONTEXT_PLANNER_VERSION,
    ContextSection,
    ContextTaskInput,
    RetrievalCandidate,
    RetrievalQuery,
    build_context_plan,
    run_retrieval,
)
from ielts_agent.retrieval.planner import RetrievalResult
from ielts_agent.retrieval.types import FusionScore


def _retrieval_result(ids: list[str]) -> RetrievalResult:
    candidates = [
        RetrievalCandidate(chunk_id=cid, score=0.9 - i * 0.1, inclusion_reasons=[f"lexical:{cid}"])
        for i, cid in enumerate(ids)
    ]
    scores = [
        FusionScore(chunk_id=cid, rrf_score=0.5, final_score=0.5, inclusion_reasons=["rrf"])
        for cid in ids
    ]
    return RetrievalResult(
        run_id="rr-test",
        candidates=candidates,
        fusion_scores=scores,
        elapsed_ms=5,
        stages_used=["exact_lookup", "lexical_fts5", "rrf_fusion"],
    )


class ContextPlannerTests(unittest.TestCase):
    def test_plan_contains_only_stable_ids_no_prompt_text(self) -> None:
        task = ContextTaskInput(
            task_kind="reading_review",
            current_task_item_ids=["reading:task-asset:v1:0"],
            recent_evidence_item_ids=["reading:e1:v1:0"],
        )
        retrieval = _retrieval_result(["reading:a:v1:0", "reading:b:v1:0"])
        plan = build_context_plan(task, retrieval, total_token_budget=4000)
        wire = plan.to_wire()
        # No field carries free-form prompt text; only IDs + reasons.
        for section in wire["sections"]:
            for item in section["item_ids"]:
                self.assertIsInstance(item, str)
                self.assertNotIn(" ", item)  # IDs are stable tokens, not prose
        self.assertEqual(plan.schema_version, CONTEXT_PLAN_SCHEMA_VERSION)
        self.assertEqual(plan.planner_version, CONTEXT_PLANNER_VERSION)

    def test_soul_policy_left_empty_for_rust(self) -> None:
        task = ContextTaskInput(task_kind="t", current_task_item_ids=["a"])
        plan = build_context_plan(task, _retrieval_result([]), total_token_budget=4000)
        soul = next(s for s in plan.sections if s.section is ContextSection.SOUL_POLICY)
        self.assertEqual(soul.item_ids, [])
        self.assertIn("rust", soul.inclusion_reasons[0])

    def test_ranked_ids_deduped_by_priority(self) -> None:
        # Same ID in current_task and retrieval -> appears once, current_task first.
        task = ContextTaskInput(
            task_kind="t",
            current_task_item_ids=["reading:shared:v1:0"],
        )
        retrieval = _retrieval_result(["reading:shared:v1:0", "reading:other:v1:0"])
        plan = build_context_plan(task, retrieval, total_token_budget=4000)
        self.assertEqual(plan.ranked_item_ids.count("reading:shared:v1:0"), 1)
        self.assertEqual(plan.ranked_item_ids[0], "reading:shared:v1:0")
        self.assertIn("reading:other:v1:0", plan.ranked_item_ids)

    def test_budget_ratios_sum_and_allocate(self) -> None:
        task = ContextTaskInput(task_kind="t", current_task_item_ids=["a"])
        plan = build_context_plan(task, _retrieval_result([]), total_token_budget=1000)
        total_budget = sum(s.requested_token_budget for s in plan.sections)
        self.assertEqual(total_budget, 1000)
        soul = next(s for s in plan.sections if s.section is ContextSection.SOUL_POLICY)
        self.assertGreater(soul.requested_token_budget, 0)

    def test_retrieval_reasons_merged_into_inclusion(self) -> None:
        task = ContextTaskInput(task_kind="t", current_task_item_ids=[])
        retrieval = _retrieval_result(["reading:a:v1:0"])
        plan = build_context_plan(task, retrieval, total_token_budget=4000)
        reasons = plan.inclusion_reasons.get("reading:a:v1:0", [])
        self.assertTrue(any("section" in r for r in reasons))
        self.assertTrue(any("lexical" in r or "rrf" in r for r in reasons))


if __name__ == "__main__":
    unittest.main()
