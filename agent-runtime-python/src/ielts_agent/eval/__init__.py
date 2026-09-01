"""M11 Prompt/Skill Eval-driven Evolution — Python orchestration (Slice 2).

This package owns the **experiment/eval orchestration** that turns a
candidate proposal into a gated eval run and (on success) a promotion
request. It is the Python-first half of M11; Rust (Slice 1) is the
persistence/promotion authority.

Submodules:

- :mod:`types` — M11-04/M11-08 pydantic contracts (EvalCase, EvalRunResult,
  CandidateProposal, TraceGrade) + the eight-case-kind taxonomy + the host
  capability pins.
- :mod:`cases` — M11-04 frozen eval dataset (eight categories, >= 1 frozen
  case each, with holdout isolation).
- :mod:`graders` — M11-08 trace graders (deterministic no-LLM path +
  optional LLM grader via model.invoke, fail-closed).
- :mod:`runner` — M11-05 candidate lifecycle orchestrator (propose → eval
  → shadow → promote → rollback), holdout isolation, no user-visible side
  effect, version pinning, fail-closed.

Boundary rules (M11 plan §9040-9200):

- Soul is stable (M11-01). Nothing here edits Soul.
- Online self-modifying prompt is forbidden (M11-06). The agent-tool
  blacklist (update_system_prompt / edit_soul / install_unreviewed_skill)
  is enforced on the Rust side; Python never calls these.
- Candidate cannot skip eval (M11-05). Promotion requires a passing eval
  run recorded locally.
- Holdout never enters prompt generation context (M11-05).
- Shadow has no user-visible side effect (M11-05).
- Rollback exact (M11-05).
- Prompt/skill version pinned in every invocation trace (M11-08).
- The package never touches the canonical SQLite DB or provider secrets.
  All prompt/skill/eval access goes through the Rust host gateway.
"""

from __future__ import annotations

from .cases import (
    case_kinds_present,
    frozen_eval_cases,
    holdout_cases,
    non_holdout_cases,
)
from .graders import (
    DEFAULT_LATENCY_MS_BUDGET,
    DEFAULT_OUTPUT_TOKEN_BUDGET,
    PASS_BAR,
    grade_context_used,
    grade_cost_latency,
    grade_counter_evidence,
    grade_final_answer,
    grade_irrelevant_tool,
    grade_memory_citation,
    grade_oversized_output,
    grade_trace,
)
from .runner import (
    DEFAULT_COGNITIVE_DEADLINE_MS,
    FORBIDDEN_AGENT_TOOLS,
    EvalRunInput,
    EvalOrchestrator,
    fallback_result,
)
from .types import (
    CANDIDATE_PROPOSAL_SCHEMA_VERSION,
    CAPABILITY_EVAL_RUN_CASE,
    CAPABILITY_PROMPT_GET_ACTIVE,
    CAPABILITY_PROMPT_LIST_VERSIONS,
    CAPABILITY_PROMPT_PROPOSE_CANDIDATE,
    CAPABILITY_PROMPT_PROMOTE_CANDIDATE,
    CAPABILITY_PROMPT_ROLLBACK,
    CAPABILITY_SKILL_LIST_VERSIONS,
    HOST_ONLY_CAPABILITIES,
    CandidateProposal,
    CandidateTargetKind,
    EVAL_CASE_KINDS,
    EVAL_CASE_SCHEMA_VERSION,
    EVAL_RUN_RESULT_SCHEMA_VERSION,
    EvalCase,
    EvalCaseKind,
    EvalRunResult,
    REQUIRED_EVAL_HOST_CAPABILITIES,
    TRACE_GRADE_SCHEMA_VERSION,
    TraceGrade,
)

__all__ = [
    "CANDIDATE_PROPOSAL_SCHEMA_VERSION",
    "CAPABILITY_EVAL_RUN_CASE",
    "CAPABILITY_PROMPT_GET_ACTIVE",
    "CAPABILITY_PROMPT_LIST_VERSIONS",
    "CAPABILITY_PROMPT_PROPOSE_CANDIDATE",
    "CAPABILITY_PROMPT_PROMOTE_CANDIDATE",
    "CAPABILITY_PROMPT_ROLLBACK",
    "CAPABILITY_SKILL_LIST_VERSIONS",
    "HOST_ONLY_CAPABILITIES",
    "CandidateProposal",
    "CandidateTargetKind",
    "DEFAULT_COGNITIVE_DEADLINE_MS",
    "DEFAULT_LATENCY_MS_BUDGET",
    "DEFAULT_OUTPUT_TOKEN_BUDGET",
    "EVAL_CASE_KINDS",
    "EVAL_CASE_SCHEMA_VERSION",
    "EVAL_RUN_RESULT_SCHEMA_VERSION",
    "EvalCase",
    "EvalCaseKind",
    "EvalOrchestrator",
    "EvalRunInput",
    "EvalRunResult",
    "FORBIDDEN_AGENT_TOOLS",
    "PASS_BAR",
    "REQUIRED_EVAL_HOST_CAPABILITIES",
    "TRACE_GRADE_SCHEMA_VERSION",
    "TraceGrade",
    "case_kinds_present",
    "fallback_result",
    "frozen_eval_cases",
    "grade_context_used",
    "grade_cost_latency",
    "grade_counter_evidence",
    "grade_final_answer",
    "grade_irrelevant_tool",
    "grade_memory_citation",
    "grade_oversized_output",
    "grade_trace",
    "holdout_cases",
    "non_holdout_cases",
]
