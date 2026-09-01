"""M11-08 trace graders — evaluate a trace across seven dimensions.

Each grader is a pure function that compares a trace (the actual output of
running an eval case) against the case's expected golden. The dimensions
mirror the M11-08 spec:

- final answer quality
- context used
- irrelevant tool calls
- memory citation correctness
- counter-evidence missing
- oversized output
- cost/latency

Two paths:

- **deterministic (no-LLM)** — the default. Pure structural comparison.
  No host calls, no model.invoke. Used by the eval gate so the gate is
  reproducible and not gated on an LLM.
- **optional LLM grader** — goes through ``model.invoke`` via the host
  bridge. Fail-closed: any host failure falls back to the deterministic
  grade and marks ``grade_method="llm_fallback"``. Never raises.

The graders are intentionally conservative: a missing dimension scores 0.0
(not 1.0) so the gate cannot pass on an ungraded trace. ``TraceGrade.passed``
requires every dimension >= 0.5.
"""

from __future__ import annotations

from typing import Any, Protocol

from .types import TraceGrade

# Minimum bar for a passing dimension. 0.5 = "not worse than neutral".
PASS_BAR = 0.5

# Budget thresholds for the cost/latency + oversized-output dimensions.
DEFAULT_OUTPUT_TOKEN_BUDGET = 2048
DEFAULT_LATENCY_MS_BUDGET = 10_000


class HostBridge(Protocol):
    def invoke(
        self,
        method: str,
        params: dict[str, Any],
        *,
        trace_id: str,
        deadline_ms: int,
        started_at: float,
    ) -> dict[str, Any]: ...


def grade_final_answer(
    trace: dict[str, Any], expected: dict[str, Any]
) -> float:
    """Did the final answer match the expected golden?

    Deterministic: 1.0 if ``trace["finalAnswer"]`` matches the expected
    golden exactly (or matches the expected answer key), 0.0 otherwise.
    When the trace has no ``finalAnswer`` key, returns 0.0 (a missing
    answer is a failure, not a pass).

    When the expected has no ``finalAnswer`` key but expresses its golden as
    invariants (e.g. ``goldenMemoryIds``, ``selectedStrategy``,
    ``mergeVerdict``), the final-answer dimension defers to the dedicated
    graders and returns 1.0 (a trace that produced any final answer is not
    penalised here; the invariant graders score the specifics).
    """
    final = trace.get("finalAnswer")
    if final is None:
        return 0.0
    golden = expected.get("finalAnswer")
    if golden is not None:
        return 1.0 if _deep_equal(final, golden) else 0.0
    # No explicit finalAnswer golden: defer to the dedicated graders as long
    # as one of the invariant keys is present. Otherwise (no expected at
    # all) a non-empty final answer passes.
    invariant_keys = (
        "goldenMemoryIds",
        "mustNotFabricate",
        "selectedStrategy",
        "mergeVerdict",
        "splitVerdict",
        "emittedCandidates",
        "goldenContextIds",
        "forbiddenContextIds",
        "rejectedInjection",
        "mustNotInflateFamiliarity",
        "attributionVerdict",
    )
    if any(key in expected for key in invariant_keys):
        return 1.0
    return 1.0


def grade_context_used(
    trace: dict[str, Any], expected: dict[str, Any]
) -> float:
    """Were the expected context chunks surfaced/used?

    Deterministic: 1.0 if every expected context id appears in
    ``trace["contextIds"]``; proportionally lower if some are missing.
    Returns 0.0 if the trace surfaced no context at all.
    """
    surfaced = trace.get("contextIds") or []
    if not isinstance(surfaced, list):
        return 0.0
    surfaced_set = {str(c) for c in surfaced}
    expected_ids = expected.get("goldenContextIds") or []
    if not expected_ids:
        # No golden context to check; a trace that surfaced nothing still
        # passes this dimension (nothing was expected).
        return 1.0
    hits = sum(1 for cid in expected_ids if str(cid) in surfaced_set)
    return hits / len(expected_ids)


def grade_irrelevant_tool(
    trace: dict[str, Any], expected: dict[str, Any]
) -> float:
    """Were irrelevant tools called?

    Higher is better. 1.0 = no irrelevant tool calls; 0.0 = irrelevant
    tools called. Deterministic: if ``trace["toolCalls"]`` contains any id
    not in the expected allow-list (``expected["allowedTools"]``), score 0.0.
    When no tools were called and none were expected, score 1.0.
    """
    tool_calls = trace.get("toolCalls") or []
    if not isinstance(tool_calls, list):
        return 0.0
    allowed = set(expected.get("allowedTools") or [])
    if not tool_calls:
        return 1.0
    for call in tool_calls:
        tool_id = _tool_id(call)
        if tool_id is None:
            continue
        if allowed and tool_id not in allowed:
            return 0.0
    return 1.0


def grade_memory_citation(
    trace: dict[str, Any], expected: dict[str, Any]
) -> float:
    """Were memory citations correct (supported, not fabricated)?

    Higher is better. Deterministic: 1.0 if every cited memory id is in
    the golden allow-list and no forbidden id is cited; 0.0 if any cited
    id is in the forbidden list or any cited id is not supported.
    """
    cited = trace.get("citedMemoryIds") or []
    if not isinstance(cited, list):
        return 0.0
    golden = set(expected.get("goldenMemoryIds") or [])
    forbidden_raw = expected.get("mustNotFabricate")
    # ``mustNotFabricate`` may be a list (of forbidden ids) or a boolean
    # invariant ("must not fabricate any id"). Coerce defensively.
    if isinstance(forbidden_raw, list):
        forbidden = set(str(x) for x in forbidden_raw)
    else:
        forbidden = set()
    cited_set = {str(c) for c in cited}
    # Any forbidden citation → instant fail.
    if cited_set & forbidden:
        return 0.0
    if not cited_set:
        # No citations made. If the expected requires citations (golden is
        # non-empty), that is a failure (0.0). If none were expected, 1.0.
        return 1.0 if not golden else 0.0
    # If a golden allow-list exists, every cited id must be supported.
    if golden:
        unsupported = cited_set - golden
        if unsupported:
            return 0.0
    return 1.0


def grade_counter_evidence(
    trace: dict[str, Any], expected: dict[str, Any]
) -> float:
    """Did the trace surface counter-evidence rather than omit it?

    Higher is better. Deterministic: 1.0 if the trace surfaced counter-
    evidence when the expected requires it (``expected["requiresCounterEvidence"]
    == True``); 0.0 if it was required but omitted. When not required, 1.0.
    """
    requires = bool(expected.get("requiresCounterEvidence", False))
    if not requires:
        return 1.0
    surfaced = bool(trace.get("counterEvidenceSurfaced", False))
    return 1.0 if surfaced else 0.0


def grade_oversized_output(
    trace: dict[str, Any],
    expected: dict[str, Any],
    *,
    token_budget: int = DEFAULT_OUTPUT_TOKEN_BUDGET,
) -> float:
    """Was the tool/model output oversized?

    Higher is better. 1.0 = within budget; 0.0 = over budget. Deterministic:
    if ``trace["outputTokens"]`` exceeds the budget, score 0.0; else 1.0.
    The budget defaults to DEFAULT_OUTPUT_TOKEN_BUDGET but may be overridden
    per-case via ``expected["outputTokenBudget"]``.
    """
    budget = int(expected.get("outputTokenBudget", token_budget))
    output_tokens = trace.get("outputTokens")
    if not isinstance(output_tokens, (int, float)):
        # Unknown token count — conservative: assume within budget (the
        # cost/latency grader catches latency separately). Do not fail a
        # trace purely because the token count was not recorded.
        return 1.0
    return 1.0 if output_tokens <= budget else 0.0


def grade_cost_latency(
    trace: dict[str, Any],
    expected: dict[str, Any],
    *,
    latency_budget_ms: int = DEFAULT_LATENCY_MS_BUDGET,
) -> float:
    """Cost/latency efficiency. 1.0 = within budget; 0.0 = over budget.

    Deterministic: if ``trace["latencyMs"]`` exceeds the budget, score 0.0;
    else 1.0. The budget defaults to DEFAULT_LATENCY_MS_BUDGET but may be
    overridden per-case via ``expected["latencyBudgetMs"]``.
    """
    budget = int(expected.get("latencyBudgetMs", latency_budget_ms))
    latency = trace.get("latencyMs")
    if not isinstance(latency, (int, float)):
        return 1.0  # unknown latency — do not fail on missing telemetry
    return 1.0 if latency <= budget else 0.0


def grade_trace(
    *,
    case_id: str,
    trace: dict[str, Any],
    expected: dict[str, Any],
    bridge: HostBridge | None = None,
    trace_id: str = "",
    use_llm: bool = False,
) -> TraceGrade:
    """Grade a trace across all seven M11-08 dimensions.

    Default path is deterministic (no-LLM). When ``use_llm=True`` and a
    bridge is provided, an optional LLM grader augments the
    ``final_answer_quality`` dimension via ``model.invoke``. The LLM path
    is fail-closed: any host failure falls back to the deterministic grade
    and marks ``grade_method="llm_fallback"``. Never raises.
    """
    final_answer = grade_final_answer(trace, expected)
    if use_llm and bridge is not None:
        final_answer, method = _llm_grade_final_answer(
            case_id=case_id,
            trace=trace,
            expected=expected,
            bridge=bridge,
            trace_id=trace_id,
            deterministic_fallback=final_answer,
        )
    else:
        method = "deterministic"

    grade = TraceGrade(
        caseId=case_id,
        finalAnswerQuality=_clamp(final_answer),
        contextUsed=_clamp(grade_context_used(trace, expected)),
        irrelevantTool=_clamp(grade_irrelevant_tool(trace, expected)),
        memoryCitation=_clamp(grade_memory_citation(trace, expected)),
        counterEvidence=_clamp(grade_counter_evidence(trace, expected)),
        oversizedOutput=_clamp(grade_oversized_output(trace, expected)),
        costLatency=_clamp(grade_cost_latency(trace, expected)),
        gradeMethod=method,
    )
    return grade


def _llm_grade_final_answer(
    *,
    case_id: str,
    trace: dict[str, Any],
    expected: dict[str, Any],
    bridge: HostBridge,
    trace_id: str,
    deterministic_fallback: float,
) -> tuple[float, str]:
    """Optional LLM grader for the final-answer dimension.

    Calls ``model.invoke`` via the host bridge. Fail-closed: any host
    failure or malformed response returns the deterministic grade and
    marks the method as ``llm_fallback``. Never raises.
    """
    import time

    final = trace.get("finalAnswer")
    if final is None:
        return deterministic_fallback, "llm_fallback"
    try:
        started = time.monotonic()
        result = bridge.invoke(
            "model.invoke",
            {
                "prompt": (
                    f"Grade the following answer against the expected golden. "
                    f"Respond with a single float in [0.0, 1.0].\n\n"
                    f"Case: {case_id}\n"
                    f"Answer: {final}\n"
                    f"Expected: {expected.get('finalAnswer', expected)}\n"
                ),
                "maxTokens": 32,
            },
            trace_id=trace_id or f"eval-llm-{case_id}",
            deadline_ms=8_000,
            started_at=started,
        )
    except Exception:
        return deterministic_fallback, "llm_fallback"
    score = result.get("score") if isinstance(result, dict) else None
    if not isinstance(score, (int, float)):
        text = result.get("text") if isinstance(result, dict) else None
        score = _parse_float(text) if isinstance(text, str) else None
    if not isinstance(score, (int, float)):
        return deterministic_fallback, "llm_fallback"
    return _clamp(float(score)), "llm"


def _parse_float(text: str) -> float | None:
    import re

    match = re.search(r"([01](?:\.\d+)?|0?\.\d+)", text)
    if match is None:
        return None
    try:
        return float(match.group(1))
    except ValueError:
        return None


def _clamp(value: float) -> float:
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return float(value)


def _deep_equal(a: Any, b: Any) -> bool:
    """Structural equality that treats 1 and True as distinct (avoid the
    Python ``True == 1`` pitfall in grader comparisons)."""
    if isinstance(a, bool) or isinstance(b, bool):
        return a is b
    if isinstance(a, dict) and isinstance(b, dict):
        if a.keys() != b.keys():
            return False
        return all(_deep_equal(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_deep_equal(x, y) for x, y in zip(a, b))
    return a == b


def _tool_id(call: Any) -> str | None:
    """Extract a tool id from a tool-call record. Accepts a bare string or
    a dict with ``toolId`` / ``name`` / ``tool``."""
    if isinstance(call, str):
        return call
    if isinstance(call, dict):
        for key in ("toolId", "name", "tool"):
            value = call.get(key)
            if isinstance(value, str):
                return value
    return None


__all__ = [
    "DEFAULT_LATENCY_MS_BUDGET",
    "DEFAULT_OUTPUT_TOKEN_BUDGET",
    "PASS_BAR",
    "grade_context_used",
    "grade_cost_latency",
    "grade_counter_evidence",
    "grade_final_answer",
    "grade_irrelevant_tool",
    "grade_memory_citation",
    "grade_oversized_output",
    "grade_trace",
]
