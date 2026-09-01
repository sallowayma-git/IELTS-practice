"""M11 Prompt/Skill Eval-driven Evolution — typed contracts (Python Slice 2).

These pydantic models are the wire/audit boundary for the M11 evaluation
orchestration. They carry structured provenance for candidate proposals,
eval cases, and trace grades without ever touching the canonical SQLite DB
or provider secrets — all persistence happens through the Rust host gateway.

Boundary rules enforced here (M11 plan §9040-9200):

- **Soul is stable (M11-01).** Nothing in this package edits Soul. Online
  self-modifying prompt is forbidden (M11-06) — the agent-tool blacklist is
  enforced on the Rust side; Python only orchestrates the controlled
  engineering candidate lifecycle.
- **Candidate lifecycle is gated (M11-05).** ``propose → offline eval →
  holdout → shadow → manual approval → promote → rollback available``. Rust
  owns the release gate; Python owns experiment/eval orchestration. A
  candidate cannot skip eval (no ``promote`` without a passing eval run).
  Holdout cases never enter prompt generation context.
- **Trace graders (M11-08).** A :class:`TraceGrade` grades: final answer
  quality, context used, irrelevant tool calls, memory citation correctness,
  counter-evidence missing, oversized output, cost/latency. Deterministic
  graders run without an LLM; an optional LLM grader goes through
  ``model.invoke`` and fails closed.
- **Version pinning.** Every eval case carries the prompt version id and
  skill version id it pins; eval run results record the pinned versions in
  the trace so audits can answer the DoD questions.
- **Closed models.** Every pydantic model here is frozen, strict, and
  rejects unknown fields. No silent drift.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

EVAL_CASE_SCHEMA_VERSION = 1
EVAL_RUN_RESULT_SCHEMA_VERSION = 1
CANDIDATE_PROPOSAL_SCHEMA_VERSION = 1
TRACE_GRADE_SCHEMA_VERSION = 1

# Host capability pins for the M11 evolution authority (Rust Slice 1).
# Versions are pinned to "1" so a handshake mismatch forces a clean fallback
# rather than silent drift. Python calls these through host_bridge.invoke.
CAPABILITY_PROMPT_LIST_VERSIONS = "prompt.list_versions"
CAPABILITY_PROMPT_GET_ACTIVE = "prompt.get_active"
CAPABILITY_PROMPT_PROPOSE_CANDIDATE = "prompt.propose_candidate"
CAPABILITY_PROMPT_PROMOTE_CANDIDATE = "prompt.promote_candidate"
CAPABILITY_PROMPT_ROLLBACK = "prompt.rollback"
CAPABILITY_EVAL_RUN_CASE = "eval.run_case"
CAPABILITY_SKILL_LIST_VERSIONS = "skill.list_versions"

CAPABILITY_VERSION_PROMPT_LIST_VERSIONS = "1"
CAPABILITY_VERSION_PROMPT_GET_ACTIVE = "1"
CAPABILITY_VERSION_PROMPT_PROPOSE_CANDIDATE = "1"
CAPABILITY_VERSION_PROMPT_PROMOTE_CANDIDATE = "1"
CAPABILITY_VERSION_PROMPT_ROLLBACK = "1"
CAPABILITY_VERSION_EVAL_RUN_CASE = "1"
CAPABILITY_VERSION_SKILL_LIST_VERSIONS = "1"

# Round-3 audit (A2): promote / rollback / eval.run_case are NOT listed here.
# The Rust host no longer serves them to the runtime, because each one is an
# authority operation: promotion and rollback activate or reverse a live
# version, and eval.run_case persists caller-supplied `passed` gradings and
# advances a candidate to `eval_passed`, which is the sole precondition for
# approval. The runtime may propose; the host decides. Keeping them in the
# required set would make every orchestrator call fail its capability check.
REQUIRED_EVAL_HOST_CAPABILITIES: dict[str, str] = {
    CAPABILITY_PROMPT_LIST_VERSIONS: CAPABILITY_VERSION_PROMPT_LIST_VERSIONS,
    CAPABILITY_PROMPT_GET_ACTIVE: CAPABILITY_VERSION_PROMPT_GET_ACTIVE,
    CAPABILITY_PROMPT_PROPOSE_CANDIDATE: CAPABILITY_VERSION_PROMPT_PROPOSE_CANDIDATE,
    CAPABILITY_SKILL_LIST_VERSIONS: CAPABILITY_VERSION_SKILL_LIST_VERSIONS,
}

# Capabilities the host deliberately withholds from the runtime. Kept as an
# explicit, testable set so a future edit that re-adds one to the required map
# fails loudly instead of silently degrading every eval call to a fallback.
HOST_ONLY_CAPABILITIES: frozenset[str] = frozenset(
    {
        CAPABILITY_PROMPT_PROMOTE_CANDIDATE,
        CAPABILITY_PROMPT_ROLLBACK,
        CAPABILITY_EVAL_RUN_CASE,
    }
)

# M11-04 eval dataset taxonomy (exactly eight case kinds). Frozen so adding a
# ninth is an explicit schema change, not silent drift.
EVAL_CASE_KINDS: frozenset[str] = frozenset(
    {
        "memory_extraction_goldens",
        "false_merge_split",
        "consolidation_zero",
        "context_selection",
        "coach_personalization",
        "prompt_injection",
        "repeated_familiarity",
        "strategy_outcome",
    }
)


class EvalCaseKind(StrEnum):
    """M11-04 the eight frozen eval case categories."""

    MEMORY_EXTRACTION_GOLDENS = "memory_extraction_goldens"
    FALSE_MERGE_SPLIT = "false_merge_split"
    CONSOLIDATION_ZERO = "consolidation_zero"
    CONTEXT_SELECTION = "context_selection"
    COACH_PERSONALIZATION = "coach_personalization"
    PROMPT_INJECTION = "prompt_injection"
    REPEATED_FAMILIARITY = "repeated_familiarity"
    STRATEGY_OUTCOME = "strategy_outcome"


class CandidateTargetKind(StrEnum):
    """What a candidate proposal targets: a prompt module version or a
    skill definition version."""

    PROMPT = "prompt"
    SKILL = "skill"


class _ClosedModel(BaseModel):
    """Closed, frozen, strict base. No extras survive validation."""

    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


class EvalCase(_ClosedModel):
    """One frozen eval case from the M11-04 dataset.

    A case is identified by ``case_id`` and belongs to one of the eight
    :class:`EvalCaseKind` categories. It carries the frozen input, the
    expected golden output (or expected invariants), the prompt module /
    skill version it pins, and an optional ``holdout`` flag.

    Holdout cases (``holdout=True``) NEVER enter prompt generation context
    (M11-05): they are the held-out set used only for the final gated eval,
    never for generating candidate prompts. The orchestrator enforces this
    by refusing to feed holdout case inputs into any prompt-context path.
    """

    schema_version: int = Field(
        default=EVAL_CASE_SCHEMA_VERSION, alias="schemaVersion"
    )
    case_id: str = Field(alias="caseId", min_length=1, max_length=160)
    case_kind: EvalCaseKind = Field(alias="caseKind")
    # The module this case exercises (one of the M11-02 prompt modules, or a
    # skill flow id from M11-03). Free-form here; the catalog is owned by Rust.
    module: str = Field(min_length=1, max_length=64)
    # The frozen input payload. Opaque to the runner; the grader interprets
    # it. Kept as a dict so the case set can evolve without a model churn.
    input: dict[str, Any] = Field(default_factory=dict)
    # The expected golden output / invariants. Opaque dict; graders compare.
    expected: dict[str, Any] = Field(default_factory=dict)
    # The pinned prompt version id this case was authored against. Required
    # so a re-run pins the exact version in the trace (M11-08).
    prompt_version_id: str = Field(
        alias="promptVersionId", min_length=1, max_length=160
    )
    # The pinned skill version id (may be the same across cases). Required
    # so the trace records the skill version (M11-08).
    skill_version_id: str = Field(
        alias="skillVersionId", min_length=1, max_length=160
    )
    # Holdout flag. Holdout cases never enter prompt generation context.
    holdout: bool = Field(default=False)

    @model_validator(mode="after")
    def _case_kind_in_taxonomy(self) -> EvalCase:
        if self.case_kind.value not in EVAL_CASE_KINDS:
            raise ValueError(
                f"caseKind {self.case_kind.value!r} is not in the M11-04 taxonomy"
            )
        return self

    def to_wire(self) -> dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "caseId": self.case_id,
            "caseKind": self.case_kind.value,
            "module": self.module,
            "input": dict(self.input),
            "expected": dict(self.expected),
            "promptVersionId": self.prompt_version_id,
            "skillVersionId": self.skill_version_id,
            "holdout": self.holdout,
        }


class EvalRunResult(_ClosedModel):
    """The result of one eval run (one or more eval cases against one
    candidate version).

    ``run_id`` is the canonical id assigned by the Rust authority
    (``eval.run_case``). ``passed_count`` / ``failed_count`` are the
    deterministic grader tallies. ``metrics`` carries the aggregate
    grader dimensions. ``no_user_visible_side_effect`` marks a shadow run
    (M11-05): shadow runs MUST NOT produce any user-visible side effect.
    """

    schema_version: int = Field(
        default=EVAL_RUN_RESULT_SCHEMA_VERSION, alias="schemaVersion"
    )
    run_id: str = Field(alias="runId", min_length=1, max_length=160)
    target_kind: CandidateTargetKind = Field(alias="targetKind")
    target_version_id: str = Field(
        alias="targetVersionId", min_length=1, max_length=160
    )
    passed_count: int = Field(default=0, ge=0, alias="passedCount")
    failed_count: int = Field(default=0, ge=0, alias="failedCount")
    metrics: dict[str, float] = Field(default_factory=dict)
    # The pinned prompt/skill versions recorded in the trace (M11-08).
    prompt_version_id: str = Field(
        alias="promptVersionId", min_length=1, max_length=160
    )
    skill_version_id: str = Field(
        alias="skillVersionId", min_length=1, max_length=160
    )
    # True for a shadow run. Shadow runs have no user-visible side effect.
    no_user_visible_side_effect: bool = Field(
        default=False, alias="noUserVisibleSideEffect"
    )
    # Non-fatal fallback flag. True when the host failed and the runner
    # produced a local fallback result (fail-closed) instead of raising.
    fallback: bool = Field(default=False)
    fallback_reason: str | None = Field(
        default=None, alias="fallbackReason", max_length=256
    )

    @property
    def passed(self) -> bool:
        """An eval run passes only when at least one case ran, all passed,
        and the run is not a fallback."""
        if self.fallback:
            return False
        return (
            self.failed_count == 0
            and self.passed_count > 0
        )

    def to_wire(self) -> dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "runId": self.run_id,
            "targetKind": self.target_kind.value,
            "targetVersionId": self.target_version_id,
            "passedCount": self.passed_count,
            "failedCount": self.failed_count,
            "metrics": dict(self.metrics),
            "promptVersionId": self.prompt_version_id,
            "skillVersionId": self.skill_version_id,
            "noUserVisibleSideEffect": self.no_user_visible_side_effect,
            "fallback": self.fallback,
            "fallbackReason": self.fallback_reason,
        }


class CandidateProposal(_ClosedModel):
    """A proposed candidate patch/spec for a prompt module version or a skill
    definition version (M11-05 propose step).

    The orchestrator submits this to ``prompt.propose_candidate`` (or, for
    skill candidates, the skill equivalent on the Rust side). Rust assigns
    the canonical ``candidate_version_id``; Python only proposes. The
    ``proposal_json`` is the opaque candidate spec (e.g. a prompt body diff
    or a skill flow spec) — Rust is the authority that validates and
    stores it.
    """

    schema_version: int = Field(
        default=CANDIDATE_PROPOSAL_SCHEMA_VERSION, alias="schemaVersion"
    )
    target_kind: CandidateTargetKind = Field(alias="targetKind")
    target_version_id: str = Field(
        alias="targetVersionId", min_length=1, max_length=160
    )
    # The base version this candidate proposes against (the currently-active
    # version id for the module/skill). Required for rollback (M11-05).
    base_version_id: str = Field(
        alias="baseVersionId", min_length=1, max_length=160
    )
    # Opaque candidate spec. Rust validates/stores; Python never interprets.
    proposal_json: dict[str, Any] = Field(alias="proposalJson")
    # Human-readable rationale: who proposed, based on what problem. Feeds
    # the DoD "who proposed / based on what problem" questions.
    rationale: str = Field(min_length=1, max_length=4 * 1024)

    def to_wire(self) -> dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "targetKind": self.target_kind.value,
            "targetVersionId": self.target_version_id,
            "baseVersionId": self.base_version_id,
            "proposalJson": dict(self.proposal_json),
            "rationale": self.rationale,
        }


class TraceGrade(_ClosedModel):
    """M11-08 trace grader output for one eval case.

    Each dimension is a float in [0.0, 1.0] where 1.0 = perfect. Dimensions:

    - ``final_answer_quality``: did the final answer match the expected golden?
    - ``context_used``: were the expected context chunks surfaced/used?
    - ``irrelevant_tool``: were irrelevant tools called? (1.0 = no irrelevant
      tool calls; 0.0 = irrelevant tools called). Higher is better.
    - ``memory_citation``: were memory citations correct (supported, not
      fabricated)? Higher is better.
    - ``counter_evidence``: did the trace surface counter-evidence rather
      than omit it? Higher is better (1.0 = counter-evidence surfaced when
      required; missing it → 0.0).
    - ``oversized_output``: was the tool/model output oversized? 1.0 = within
      budget; 0.0 = oversized. Higher is better.
    - ``cost_latency``: cost/latency efficiency. 1.0 = within budget;
      0.0 = over budget. Higher is better.

    ``grade_method`` records which grader path produced this grade
    (``deterministic`` or ``llm``). LLM-graded traces fail closed: a host
    failure produces a deterministic fallback grade, never a fatal raise.
    """

    schema_version: int = Field(
        default=TRACE_GRADE_SCHEMA_VERSION, alias="schemaVersion"
    )
    case_id: str = Field(alias="caseId", min_length=1, max_length=160)
    final_answer_quality: float = Field(
        default=0.0, ge=0.0, le=1.0, alias="finalAnswerQuality"
    )
    context_used: float = Field(
        default=0.0, ge=0.0, le=1.0, alias="contextUsed"
    )
    irrelevant_tool: float = Field(
        default=0.0, ge=0.0, le=1.0, alias="irrelevantTool"
    )
    memory_citation: float = Field(
        default=0.0, ge=0.0, le=1.0, alias="memoryCitation"
    )
    counter_evidence: float = Field(
        default=0.0, ge=0.0, le=1.0, alias="counterEvidence"
    )
    oversized_output: float = Field(
        default=0.0, ge=0.0, le=1.0, alias="oversizedOutput"
    )
    cost_latency: float = Field(
        default=0.0, ge=0.0, le=1.0, alias="costLatency"
    )
    grade_method: str = Field(
        default="deterministic", alias="gradeMethod", max_length=32
    )
    notes: str | None = Field(default=None, max_length=4 * 1024)

    @property
    def passed(self) -> bool:
        """A trace passes when every dimension meets the minimum bar (0.5).
        The minimum bar is intentionally conservative: 0.5 means "not worse
        than neutral". Candidate promotion requires passing all eval cases,
        so a single failing dimension fails the case."""
        return all(
            getattr(self, dim) >= 0.5
            for dim in (
                "final_answer_quality",
                "context_used",
                "irrelevant_tool",
                "memory_citation",
                "counter_evidence",
                "oversized_output",
                "cost_latency",
            )
        )

    def to_wire(self) -> dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "caseId": self.case_id,
            "finalAnswerQuality": self.final_answer_quality,
            "contextUsed": self.context_used,
            "irrelevantTool": self.irrelevant_tool,
            "memoryCitation": self.memory_citation,
            "counterEvidence": self.counter_evidence,
            "oversizedOutput": self.oversized_output,
            "costLatency": self.cost_latency,
            "gradeMethod": self.grade_method,
            "notes": self.notes,
        }


__all__ = [
    "CANDIDATE_PROPOSAL_SCHEMA_VERSION",
    "CAPABILITY_EVAL_RUN_CASE",
    "CAPABILITY_PROMPT_GET_ACTIVE",
    "CAPABILITY_PROMPT_LIST_VERSIONS",
    "CAPABILITY_PROMPT_PROPOSE_CANDIDATE",
    "CAPABILITY_PROMPT_PROMOTE_CANDIDATE",
    "CAPABILITY_PROMPT_ROLLBACK",
    "CAPABILITY_SKILL_LIST_VERSIONS",
    "CAPABILITY_VERSION_EVAL_RUN_CASE",
    "CAPABILITY_VERSION_PROMPT_GET_ACTIVE",
    "CAPABILITY_VERSION_PROMPT_LIST_VERSIONS",
    "CAPABILITY_VERSION_PROMPT_PROPOSE_CANDIDATE",
    "CAPABILITY_VERSION_PROMPT_PROMOTE_CANDIDATE",
    "CAPABILITY_VERSION_PROMPT_ROLLBACK",
    "CAPABILITY_VERSION_SKILL_LIST_VERSIONS",
    "CandidateProposal",
    "CandidateTargetKind",
    "EVAL_CASE_KINDS",
    "EVAL_CASE_SCHEMA_VERSION",
    "EVAL_RUN_RESULT_SCHEMA_VERSION",
    "EvalCase",
    "EvalCaseKind",
    "EvalRunResult",
    "REQUIRED_EVAL_HOST_CAPABILITIES",
    "TRACE_GRADE_SCHEMA_VERSION",
    "TraceGrade",
]
