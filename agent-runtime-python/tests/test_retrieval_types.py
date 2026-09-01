"""Tests for M5 retrieval type contracts and ContextPlan wire serialization."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from ielts_agent.retrieval import (
    CONTEXT_PLAN_SCHEMA_VERSION,
    CONTEXT_PLANNER_VERSION,
    ContextPlan,
    ContextSection,
    ContextSectionPlan,
    CorpusChunk,
    RetrievalCandidate,
    Sensitivity,
    SourceKind,
)


def _chunk(chunk_id: str = "reading:asset-1:v1:0") -> CorpusChunk:
    return CorpusChunk(
        chunk_id=chunk_id,
        source_kind=SourceKind.CURATED,
        source_id="asset-1",
        source_version="1",
        content_hash="abc123",
        scope="reading",
        activity="reading",
        skill="matching_headings",
        sensitivity=Sensitivity.INTERNAL,
        text="sample passage text",
        updated_at="2026-08-15T00:00:00Z",
    )


class CorpusChunkTests(unittest.TestCase):
    def test_rejects_whitespace_only_ids(self) -> None:
        with self.assertRaises(ValueError):
            CorpusChunk(
                chunk_id="   ",
                source_kind=SourceKind.CURATED,
                source_id="asset-1",
                content_hash="abc",
                sensitivity=Sensitivity.PUBLIC,
            )

    def test_rejects_unknown_source_kind(self) -> None:
        with self.assertRaises(ValueError):
            CorpusChunk(
                chunk_id="reading:a:v1:0",
                source_kind="predicted",  # not a valid SourceKind
                source_id="a",
                content_hash="abc",
                sensitivity=Sensitivity.PUBLIC,
            )

    def test_forbids_extra_fields(self) -> None:
        with self.assertRaises(ValueError):
            CorpusChunk(
                chunk_id="reading:a:v1:0",
                source_kind=SourceKind.OBSERVED,
                source_id="a",
                content_hash="abc",
                sensitivity=Sensitivity.PUBLIC,
                evil_injection="nope",  # type: ignore[call-arg]
            )


class RetrievalCandidateTests(unittest.TestCase):
    def test_score_bounds_enforced(self) -> None:
        with self.assertRaises(ValueError):
            RetrievalCandidate(
                chunk_id="x", score=1.5, inclusion_reasons=["r"]
            )
        with self.assertRaises(ValueError):
            RetrievalCandidate(
                chunk_id="x", score=-0.1, inclusion_reasons=["r"]
            )

    def test_inclusion_reasons_cannot_be_empty(self) -> None:
        with self.assertRaises(ValueError):
            RetrievalCandidate(chunk_id="x", score=0.5, inclusion_reasons=[])
        with self.assertRaises(ValueError):
            RetrievalCandidate(chunk_id="x", score=0.5, inclusion_reasons=["   "])


class ContextPlanWireTests(unittest.TestCase):
    def test_plan_serializes_camel_case_and_freezes(self) -> None:
        plan = ContextPlan(
            schema_version=CONTEXT_PLAN_SCHEMA_VERSION,
            planner_version=CONTEXT_PLANNER_VERSION,
            task_kind="reading_review",
            sections=[
                ContextSectionPlan(
                    section=ContextSection.CURRENT_TASK,
                    item_ids=["reading:asset-1:v1:0"],
                    requested_token_budget=1000,
                    inclusion_reasons=["task"],
                ),
                ContextSectionPlan(
                    section=ContextSection.SOUL_POLICY,
                    item_ids=[],
                    requested_token_budget=400,
                    inclusion_reasons=["required"],
                ),
            ],
            ranked_item_ids=["reading:asset-1:v1:0"],
            inclusion_reasons={"reading:asset-1:v1:0": ["task"]},
            requested_token_budget=4000,
            retrieval_run_ids=["rr-abc"],
        )
        wire = plan.to_wire()
        self.assertEqual(wire["schemaVersion"], CONTEXT_PLAN_SCHEMA_VERSION)
        self.assertEqual(wire["plannerVersion"], CONTEXT_PLANNER_VERSION)
        self.assertEqual(wire["taskKind"], "reading_review")
        self.assertEqual(wire["rankedItemIds"], ["reading:asset-1:v1:0"])
        self.assertEqual(wire["requestedTokenBudget"], 4000)
        self.assertEqual(wire["retrievalRunIds"], ["rr-abc"])
        self.assertEqual(len(wire["sections"]), 2)
        # Frozen: cannot mutate after construction.
        with self.assertRaises(Exception):
            plan.task_kind = "other"  # type: ignore[misc]

    def test_duplicate_sections_rejected(self) -> None:
        with self.assertRaises(ValueError):
            ContextPlan(
                task_kind="t",
                sections=[
                    ContextSectionPlan(section=ContextSection.CURRENT_TASK),
                    ContextSectionPlan(section=ContextSection.CURRENT_TASK),
                ],
            )

    def test_duplicate_ranked_ids_rejected(self) -> None:
        with self.assertRaises(ValueError):
            ContextPlan(
                task_kind="t",
                sections=[ContextSectionPlan(section=ContextSection.CURRENT_TASK)],
                ranked_item_ids=["a", "a"],
            )


if __name__ == "__main__":
    unittest.main()
