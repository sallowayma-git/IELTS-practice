"""M11-08 trace grader tests — deterministic (no-LLM path) assertions."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from ielts_agent.eval.graders import (
    DEFAULT_LATENCY_MS_BUDGET,
    DEFAULT_OUTPUT_TOKEN_BUDGET,
    grade_context_used,
    grade_cost_latency,
    grade_counter_evidence,
    grade_final_answer,
    grade_irrelevant_tool,
    grade_memory_citation,
    grade_oversized_output,
    grade_trace,
)


class FinalAnswerGraderTests(unittest.TestCase):
    def test_exact_match_passes(self) -> None:
        trace = {"finalAnswer": "Not Given"}
        expected = {"finalAnswer": "Not Given"}
        self.assertEqual(grade_final_answer(trace, expected), 1.0)

    def test_mismatch_fails(self) -> None:
        trace = {"finalAnswer": "False"}
        expected = {"finalAnswer": "Not Given"}
        self.assertEqual(grade_final_answer(trace, expected), 0.0)

    def test_missing_final_answer_fails(self) -> None:
        trace = {}
        expected = {"finalAnswer": "Not Given"}
        self.assertEqual(grade_final_answer(trace, expected), 0.0)

    def test_bool_not_equal_to_int(self) -> None:
        """1 and True must not be conflated (Python's True == 1 pitfall)."""
        trace = {"finalAnswer": True}
        expected = {"finalAnswer": 1}
        self.assertEqual(grade_final_answer(trace, expected), 0.0)


class ContextUsedGraderTests(unittest.TestCase):
    def test_all_expected_surfaced(self) -> None:
        trace = {"contextIds": ["ctx-1", "ctx-2"]}
        expected = {"goldenContextIds": ["ctx-1", "ctx-2"]}
        self.assertEqual(grade_context_used(trace, expected), 1.0)

    def test_partial_match_proportional(self) -> None:
        trace = {"contextIds": ["ctx-1"]}
        expected = {"goldenContextIds": ["ctx-1", "ctx-2"]}
        self.assertEqual(grade_context_used(trace, expected), 0.5)

    def test_no_context_surfaced_when_expected_fails(self) -> None:
        trace = {"contextIds": []}
        expected = {"goldenContextIds": ["ctx-1"]}
        self.assertEqual(grade_context_used(trace, expected), 0.0)

    def test_no_expected_context_passes(self) -> None:
        trace = {"contextIds": []}
        expected = {}
        self.assertEqual(grade_context_used(trace, expected), 1.0)


class IrrelevantToolGraderTests(unittest.TestCase):
    def test_no_tools_called_passes(self) -> None:
        trace = {"toolCalls": []}
        expected = {"allowedTools": ["tool-a"]}
        self.assertEqual(grade_irrelevant_tool(trace, expected), 1.0)

    def test_only_allowed_tools_passes(self) -> None:
        trace = {"toolCalls": ["tool-a"]}
        expected = {"allowedTools": ["tool-a"]}
        self.assertEqual(grade_irrelevant_tool(trace, expected), 1.0)

    def test_irrelevant_tool_fails(self) -> None:
        trace = {"toolCalls": ["tool-a", "tool-bad"]}
        expected = {"allowedTools": ["tool-a"]}
        self.assertEqual(grade_irrelevant_tool(trace, expected), 0.0)

    def test_tool_call_dict_with_tool_id(self) -> None:
        trace = {"toolCalls": [{"toolId": "tool-a"}]}
        expected = {"allowedTools": ["tool-a"]}
        self.assertEqual(grade_irrelevant_tool(trace, expected), 1.0)


class MemoryCitationGraderTests(unittest.TestCase):
    def test_all_citations_supported(self) -> None:
        trace = {"citedMemoryIds": ["mem-1", "mem-2"]}
        expected = {"goldenMemoryIds": ["mem-1", "mem-2"]}
        self.assertEqual(grade_memory_citation(trace, expected), 1.0)

    def test_forbidden_citation_fails(self) -> None:
        trace = {"citedMemoryIds": ["mem-1", "mem-bad"]}
        expected = {
            "goldenMemoryIds": ["mem-1"],
            "mustNotFabricate": ["mem-bad"],
        }
        self.assertEqual(grade_memory_citation(trace, expected), 0.0)

    def test_unsupported_citation_fails(self) -> None:
        trace = {"citedMemoryIds": ["mem-1", "mem-fabricated"]}
        expected = {"goldenMemoryIds": ["mem-1"]}
        self.assertEqual(grade_memory_citation(trace, expected), 0.0)

    def test_no_citations_when_required_fails(self) -> None:
        trace = {"citedMemoryIds": []}
        expected = {"goldenMemoryIds": ["mem-1"]}
        self.assertEqual(grade_memory_citation(trace, expected), 0.0)

    def test_no_citations_when_not_required_passes(self) -> None:
        trace = {"citedMemoryIds": []}
        expected = {}
        self.assertEqual(grade_memory_citation(trace, expected), 1.0)


class CounterEvidenceGraderTests(unittest.TestCase):
    def test_not_required_passes(self) -> None:
        trace = {}
        expected = {}
        self.assertEqual(grade_counter_evidence(trace, expected), 1.0)

    def test_required_and_surfaced_passes(self) -> None:
        trace = {"counterEvidenceSurfaced": True}
        expected = {"requiresCounterEvidence": True}
        self.assertEqual(grade_counter_evidence(trace, expected), 1.0)

    def test_required_but_omitted_fails(self) -> None:
        trace = {}
        expected = {"requiresCounterEvidence": True}
        self.assertEqual(grade_counter_evidence(trace, expected), 0.0)


class OversizedOutputGraderTests(unittest.TestCase):
    def test_within_budget_passes(self) -> None:
        trace = {"outputTokens": 1024}
        expected = {}
        self.assertEqual(
            grade_oversized_output(trace, expected), 1.0
        )

    def test_over_budget_fails(self) -> None:
        trace = {"outputTokens": DEFAULT_OUTPUT_TOKEN_BUDGET + 1}
        expected = {}
        self.assertEqual(grade_oversized_output(trace, expected), 0.0)

    def test_per_case_budget_override(self) -> None:
        trace = {"outputTokens": 600}
        expected = {"outputTokenBudget": 512}
        self.assertEqual(grade_oversized_output(trace, expected), 0.0)

    def test_missing_token_count_does_not_fail(self) -> None:
        trace = {}
        expected = {}
        self.assertEqual(grade_oversized_output(trace, expected), 1.0)


class CostLatencyGraderTests(unittest.TestCase):
    def test_within_budget_passes(self) -> None:
        trace = {"latencyMs": 1000}
        expected = {}
        self.assertEqual(grade_cost_latency(trace, expected), 1.0)

    def test_over_budget_fails(self) -> None:
        trace = {"latencyMs": DEFAULT_LATENCY_MS_BUDGET + 1}
        expected = {}
        self.assertEqual(grade_cost_latency(trace, expected), 0.0)

    def test_per_case_latency_override(self) -> None:
        trace = {"latencyMs": 600}
        expected = {"latencyBudgetMs": 500}
        self.assertEqual(grade_cost_latency(trace, expected), 0.0)

    def test_missing_latency_does_not_fail(self) -> None:
        trace = {}
        expected = {}
        self.assertEqual(grade_cost_latency(trace, expected), 1.0)


class GradeTraceTests(unittest.TestCase):
    """The composite grader exercises every dimension on the no-LLM path."""

    def test_perfect_trace_passes(self) -> None:
        trace = {
            "finalAnswer": "Not Given",
            "contextIds": ["ctx-1"],
            "toolCalls": ["tool-a"],
            "citedMemoryIds": ["mem-1"],
            "counterEvidenceSurfaced": True,
            "outputTokens": 100,
            "latencyMs": 100,
        }
        expected = {
            "finalAnswer": "Not Given",
            "goldenContextIds": ["ctx-1"],
            "allowedTools": ["tool-a"],
            "goldenMemoryIds": ["mem-1"],
            "requiresCounterEvidence": True,
        }
        grade = grade_trace(
            case_id="c1", trace=trace, expected=expected
        )
        self.assertTrue(grade.passed)
        self.assertEqual(grade.grade_method, "deterministic")

    def test_failing_dimension_fails(self) -> None:
        trace = {
            "finalAnswer": "False",  # wrong
            "contextIds": ["ctx-1"],
            "toolCalls": ["tool-a"],
            "citedMemoryIds": ["mem-1"],
        }
        expected = {
            "finalAnswer": "Not Given",
            "goldenContextIds": ["ctx-1"],
            "allowedTools": ["tool-a"],
            "goldenMemoryIds": ["mem-1"],
        }
        grade = grade_trace(
            case_id="c1", trace=trace, expected=expected
        )
        self.assertFalse(grade.passed)
        self.assertEqual(grade.final_answer_quality, 0.0)

    def test_grade_method_is_deterministic_by_default(self) -> None:
        grade = grade_trace(case_id="c1", trace={}, expected={})
        self.assertEqual(grade.grade_method, "deterministic")

    def test_llm_path_fail_closed_on_host_error(self) -> None:
        """When use_llm=True but the bridge raises, the grader falls back
        to the deterministic grade (fail-closed, never raises)."""

        class _ExplodingBridge:
            def invoke(self, *args, **kwargs):
                raise RuntimeError("model.invoke unavailable")

        trace = {"finalAnswer": "Not Given"}
        expected = {"finalAnswer": "Not Given"}
        grade = grade_trace(
            case_id="c1",
            trace=trace,
            expected=expected,
            bridge=_ExplodingBridge(),
            trace_id="t1",
            use_llm=True,
        )
        self.assertEqual(grade.grade_method, "llm_fallback")
        self.assertEqual(grade.final_answer_quality, 1.0)

    def test_llm_path_uses_host_score(self) -> None:
        class _StubBridge:
            def invoke(self, method, params, *, trace_id, deadline_ms, started_at):
                assert method == "model.invoke"
                return {"score": 0.8}

        grade = grade_trace(
            case_id="c1",
            trace={"finalAnswer": "x"},
            expected={"finalAnswer": "y"},
            bridge=_StubBridge(),
            trace_id="t1",
            use_llm=True,
        )
        self.assertEqual(grade.grade_method, "llm")
        self.assertEqual(grade.final_answer_quality, 0.8)


if __name__ == "__main__":
    unittest.main()
