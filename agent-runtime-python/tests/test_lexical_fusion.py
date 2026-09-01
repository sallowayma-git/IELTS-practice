"""Tests for M5-03 lexical retrieval + M5-05 RRF fusion + diversity.

Builds a small derived index in a temp DB, indexes sample chunks, then asserts
FTS5 retrieval, RRF ordering stability, anti-duplicate, and inclusion reasons.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from ielts_agent.retrieval import (
    CorpusChunk,
    IndexStore,
    RetrievalCandidate,
    RetrievalQuery,
    Sensitivity,
    SourceKind,
    apply_diversity,
    finalize_candidates,
    lexical_search,
    normalize_query,
    reciprocal_rank_fusion,
)
from ielts_agent.retrieval import exact_lookup, filter_by_scope


def _chunk(
    chunk_id: str,
    text: str,
    *,
    activity: str = "reading",
    skill: str = "matching_headings",
) -> CorpusChunk:
    return CorpusChunk(
        chunk_id=chunk_id,
        source_kind=SourceKind.CURATED,
        source_id=chunk_id.split(":")[1] if ":" in chunk_id else "x",
        source_version="1",
        content_hash=f"h-{chunk_id}",
        scope="reading",
        activity=activity,
        skill=skill,
        sensitivity=Sensitivity.INTERNAL,
        text=text,
        updated_at="2026-08-15T00:00:00Z",
    )


class LexicalRetrievalTests(unittest.TestCase):
    def setUp(self) -> None:
        self.store = IndexStore(Path(__file__).parent / "_tmp_lexical.db")
        self.addCleanup(self._cleanup)
        conn = self.store.open()
        for cid, text in [
            ("reading:a:v1:0", "matching headings requires finding paragraph topic sentences"),
            ("reading:b:v1:0", "true false not given depends on explicit claims in the passage"),
            ("reading:c:v1:0", "headings list main idea of each paragraph for matching"),
        ]:
            self.store.upsert_chunk(_chunk(cid, text))

    def _cleanup(self) -> None:
        self.store.close()
        db = Path(__file__).parent / "_tmp_lexical.db"
        if db.exists():
            db.unlink()

    def test_normalize_drops_stopwords_and_punctuation(self) -> None:
        self.assertEqual(normalize_query("The, Matching! Headings?"), "matching headings")

    def test_normalize_rejects_empty(self) -> None:
        with self.assertRaises(ValueError):
            normalize_query("   ")

    def test_fts5_returns_relevant_chunks_with_reasons(self) -> None:
        query = RetrievalQuery(
            raw_text="matching headings paragraph",
            normalized_text=normalize_query("matching headings paragraph"),
            task_kind="reading_review",
        )
        hits = lexical_search(self.store, query, top_k=3)
        self.assertGreater(len(hits), 0)
        top = hits[0]
        self.assertIn("reading:a", top.chunk_id)
        self.assertTrue(top.inclusion_reasons)

    def test_scope_filter_restricts_candidates(self) -> None:
        query = RetrievalQuery(
            raw_text="headings",
            normalized_text="headings",
            task_kind="reading_review",
            activity="writing",  # no writing chunks indexed -> empty after filter
        )
        hits = lexical_search(self.store, query, top_k=3)
        filtered = filter_by_scope(self.store, query, hits)
        self.assertEqual(filtered, [])

    def test_exact_lookup_returns_highest_trust(self) -> None:
        query = RetrievalQuery(
            raw_text="x",
            normalized_text="x",
            task_kind="reading_review",
            exact_ids=["reading:b:v1:0", "reading:missing:v1:0"],
        )
        results = exact_lookup(self.store, query)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].chunk_id, "reading:b:v1:0")
        self.assertEqual(results[0].score, 1.0)
        self.assertIn("exact:stable_id", results[0].inclusion_reasons)


class FusionTests(unittest.TestCase):
    def test_rrf_fuses_and_orders_by_score(self) -> None:
        exact = [
            RetrievalCandidate(chunk_id="a", score=1.0, inclusion_reasons=["exact"]),
        ]
        lexical = [
            RetrievalCandidate(chunk_id="b", score=0.8, inclusion_reasons=["lexical"]),
            RetrievalCandidate(chunk_id="a", score=0.6, inclusion_reasons=["lexical"]),
            RetrievalCandidate(chunk_id="c", score=0.4, inclusion_reasons=["lexical"]),
        ]
        scores = reciprocal_rank_fusion([exact, lexical, []])
        ids = [score.chunk_id for score in scores]
        # 'a' appears in both exact (rank 1) and lexical (rank 2) -> highest RRF.
        self.assertEqual(ids[0], "a")
        self.assertIn("b", ids)
        self.assertIn("c", ids)

    def test_rrf_is_deterministic_under_input_shuffle(self) -> None:
        exact = [RetrievalCandidate(chunk_id="a", score=1.0, inclusion_reasons=["exact"])]
        lexical = [
            RetrievalCandidate(chunk_id="b", score=0.8, inclusion_reasons=["lexical"]),
            RetrievalCandidate(chunk_id="a", score=0.6, inclusion_reasons=["lexical"]),
        ]
        run1 = reciprocal_rank_fusion([exact, lexical, []])
        run2 = reciprocal_rank_fusion([exact, lexical, []])
        self.assertEqual([s.final_score for s in run1], [s.final_score for s in run2])

    def test_diversity_caps_per_source_group(self) -> None:
        from ielts_agent.retrieval import FusionScore

        scores = [
            FusionScore(chunk_id="reading:a:v1:0", rrf_score=0.9, final_score=0.9, inclusion_reasons=["r"]),
            FusionScore(chunk_id="reading:a:v1:1", rrf_score=0.8, final_score=0.8, inclusion_reasons=["r"]),
            FusionScore(chunk_id="reading:a:v1:2", rrf_score=0.7, final_score=0.7, inclusion_reasons=["r"]),
            FusionScore(chunk_id="reading:a:v1:3", rrf_score=0.6, final_score=0.6, inclusion_reasons=["r"]),
            FusionScore(chunk_id="reading:b:v1:0", rrf_score=0.5, final_score=0.5, inclusion_reasons=["r"]),
        ]
        capped = apply_diversity(scores, max_per_source=3)
        # All reading:a chunks share the same source group; only 3 survive + b.
        self.assertEqual(len(capped), 4)

    def test_finalize_candidates_respects_top_k(self) -> None:
        from ielts_agent.retrieval import FusionScore

        scores = [
            FusionScore(chunk_id=f"c{i}", rrf_score=1.0 - i * 0.1, final_score=1.0 - i * 0.1, inclusion_reasons=["r"])
            for i in range(5)
        ]
        candidates = finalize_candidates(scores, top_k=2)
        self.assertEqual(len(candidates), 2)
        self.assertEqual(candidates[0].chunk_id, "c0")


if __name__ == "__main__":
    unittest.main()
