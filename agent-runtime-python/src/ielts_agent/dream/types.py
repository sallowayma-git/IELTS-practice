"""Journal and weekly-dream typed contracts (Python side).

Pure pydantic data contracts. No canonical DB access, no provider secrets, no
host bridge. The daily journal is a deterministic summary built by the Rust
host: there is no daily dream and no daily proposal. The weekly orchestrator
reads a bounded pool via the Rust host gateway and submits patterns via
``dream.run_weekly`` — Rust is the authority.

Conventions mirror :mod:`ielts_agent.retrieval.types`:

- ``_StrictModel`` base: closed, frozen, strict, camelCase wire aliases,
  ``extra="forbid"`` so no unexpected field survives validation.
- Stable IDs only (``obs-*`` / ``mem-*``); no array indexes as identity.
- Bounds are re-checked here where a field shape admits a bounded range.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


# Schema + capability version pins. Bumped only on wire-breaking change.
JOURNAL_FACTS_SCHEMA_VERSION = 1

# Host capability placeholders. The Rust agent publishes final version strings;
# we pin to "1" so a handshake mismatch forces a clean fallback, not silent drift.
CAPABILITY_MODEL_INVOKE = "model.invoke"
CAPABILITY_MEMORY_SEARCH_ACTIVE = "memory.search_active"
CAPABILITY_LEARNING_EVIDENCE_BY_IDS = "learning.evidence_by_ids"
CAPABILITY_LEARNER_SKILL_STATE = "learning.learner_skill_state"

CAPABILITY_VERSION_MODEL_INVOKE = "1"
CAPABILITY_VERSION_MEMORY_SEARCH_ACTIVE = "1"
CAPABILITY_VERSION_LEARNING_EVIDENCE_BY_IDS = "1"
CAPABILITY_VERSION_LEARNER_SKILL_STATE = "1"

# M8 Weekly Dream host capabilities. The Rust agent publishes final version
# strings; we pin to "1" so a handshake mismatch forces a clean fallback, not
# silent drift.
CAPABILITY_DREAM_RUN_WEEKLY = "dream.run_weekly"
CAPABILITY_MEMORY_CANDIDATE_POOL = "memory.candidate_pool"

CAPABILITY_VERSION_DREAM_RUN_WEEKLY = "1"
CAPABILITY_VERSION_MEMORY_CANDIDATE_POOL = "1"

# Required host capabilities for the weekly-dream orchestration path. The
# memory.candidate_pool capability returns a bounded pool of active + pending
# observed (never predicted-only) candidate memories with stable IDs and
# summaries; dream.run_weekly re-validates supports and runs the promotion
# gate on the Rust authority.
REQUIRED_WEEKLY_DREAM_HOST_CAPABILITIES: dict[str, str] = {
    CAPABILITY_DREAM_RUN_WEEKLY: CAPABILITY_VERSION_DREAM_RUN_WEEKLY,
    CAPABILITY_MEMORY_CANDIDATE_POOL: CAPABILITY_VERSION_MEMORY_CANDIDATE_POOL,
}

# M8 weekly-dream schema version. Bumped only on wire-breaking change.
WEEKLY_DREAM_SCHEMA_VERSION = 1


class _StrictModel(BaseModel):
    """Closed, frozen, strict base. No extras survive validation."""

    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        populate_by_name=True,
    )


class SkillDelta(_StrictModel):
    """A single learner-skill proficiency change for the day (M7-03).

    Wire shape mirrors the Rust ``ielts_domain::SkillDelta`` serde projection:
    only the skill key, signed delta, and supporting-evidence count leave the
    host (private learner content is redacted before serialization).
    """

    skill_key: str = Field(min_length=1, max_length=64, alias="skillKey")
    delta: float = Field(ge=-1.0, le=1.0)
    evidence_count: int = Field(default=0, ge=0, alias="evidenceCount")


class JournalMemoryEvent(_StrictModel):
    """A single memory mutation observed today, identity-bearing (M7-06).

    Wire shape mirrors the Rust ``ielts_domain::JournalMemoryEvent``. These
    events are the consolidation targets for Dream proposals: each carries a
    stable ``mem-*`` id plus the mutation kind, never private content.
    """

    memory_id: str = Field(min_length=1, max_length=160, alias="memoryId")
    namespace: str = Field(min_length=1, max_length=32)
    canonical_key: str = Field(min_length=1, max_length=160, alias="canonicalKey")
    change_kind: str = Field(min_length=1, max_length=32, alias="changeKind")
    evidence_observation_ids: list[str] = Field(
        default_factory=list, alias="evidenceObservationIds", max_length=32
    )


class MemoryChangeSummary(_StrictModel):
    """Bounded counts of memory mutations observed today, by operation.

    Wire shape mirrors the Rust ``ielts_domain::MemoryChangeSummary`` — the
    compact human-readable projection. The identity-bearing view for Dream
    proposals is :class:`JournalMemoryEvent` (``memoryEvents``).
    """

    new_candidates: int = Field(default=0, ge=0, alias="newCandidates")
    promoted: int = Field(default=0, ge=0)
    reinforced: int = Field(default=0, ge=0)
    refined: int = Field(default=0, ge=0)
    improved: int = Field(default=0, ge=0)
    regressed: int = Field(default=0, ge=0)
    contradicted: int = Field(default=0, ge=0)
    superseded: int = Field(default=0, ge=0)


class WritingEvalSummary(_StrictModel):
    """Bounded summary of writing evaluations completed today (M7-03).

    Wire shape mirrors the Rust ``ielts_domain::WritingEvalSummary``.
    """

    completed: int = Field(default=0, ge=0)
    degraded: int = Field(default=0, ge=0)
    average_band: float | None = Field(default=None, alias="averageBand", ge=0.0, le=9.0)


class JournalFacts(_StrictModel):
    """Deterministic facts for one day (M7-03).

    Produced by the Rust ``journal.build_daily`` capability — never by the LLM.
    The LLM enrichment layer may attach a readable title/summary but MUST NOT
    mutate any field on this object (enrichment carries a separate payload).
    """

    schema_version: int = Field(default=JOURNAL_FACTS_SCHEMA_VERSION, alias="schemaVersion")
    journal_date: str = Field(min_length=1, max_length=40, alias="journalDate")
    attempts_count: int = Field(default=0, ge=0, alias="attemptsCount")
    writing_eval_summary: WritingEvalSummary | None = Field(
        default=None, alias="writingEvalSummary"
    )
    skill_deltas: list[SkillDelta] = Field(default_factory=list, alias="skillDeltas", max_length=64)
    # Compact mutation counts (human-readable projection; wire alias mirrors
    # the Rust ``JournalFacts.memory_changes`` serde key).
    memory_change_counts: MemoryChangeSummary = Field(
        default_factory=MemoryChangeSummary, alias="memoryChanges"
    )
    # Identity-bearing per-memory mutation events — the Dream consolidation
    # targets (mirrors Rust ``JournalFacts.memory_events``).
    memory_events: list[JournalMemoryEvent] = Field(
        default_factory=list, alias="memoryEvents", max_length=128
    )
    coach_feedback_count: int = Field(default=0, ge=0, alias="coachFeedbackCount")
    coach_reask_count: int = Field(default=0, ge=0, alias="coachReaskCount")
    time_spent_ms: int = Field(default=0, ge=0, alias="timeSpentMs")
    source_hash: str = Field(min_length=1, max_length=128, alias="sourceHash")
    # Bounded today-scoped observation IDs (M7-06: today only, no full history).
    today_observation_ids: list[str] = Field(
        default_factory=list, alias="todayObservationIds", max_length=512
    )

    @field_validator("today_observation_ids")
    @classmethod
    def _stable_observation_ids(cls, value: list[str]) -> list[str]:
        seen: set[str] = set()
        for identifier in value:
            if not identifier.startswith("obs-"):
                raise ValueError("todayObservationIds must be stable obs-* identifiers")
            if identifier in seen:
                raise ValueError("todayObservationIds must be unique")
            seen.add(identifier)
        return list(value)

    def facts_json(self) -> str:
        """Stable canonical JSON for invariant assertions (M7-04).

        The LLM enrichment layer must not change any byte of this payload.
        """
        import json

        return json.dumps(
            self.model_dump(by_alias=True, mode="json"),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )


class JournalEnrichment(_StrictModel):
    """LLM-authored readable projection of :class:`JournalFacts` (M7-04).

    The enrichment layer may ONLY populate ``title`` / ``summary`` /
    ``open_hypotheses``. It MUST NOT change any numeric fact, memory confidence,
    or invent a long-term profile. ``facts`` is an opaque reference handle
    (e.g. a source_hash) so the enrichment stays linked to its facts without
    re-embedding mutable numbers.
    """

    title: str = Field(min_length=1, max_length=200)
    summary: str = Field(default="", max_length=4 * 1024)
    open_hypotheses: list[str] = Field(default_factory=list, max_length=16)
    facts_ref: str = Field(min_length=1, max_length=128, alias="factsRef")
    llm_used: bool = Field(default=False, alias="llmUsed")

    @field_validator("open_hypotheses")
    @classmethod
    def _non_empty_hypotheses(cls, value: list[str]) -> list[str]:
        for item in value:
            if not isinstance(item, str) or not item.strip():
                raise ValueError("open_hypotheses must be non-empty strings")
        return list(value)


class PatternKind(StrEnum):
    """M8-05 fixed weekly-dream pattern taxonomy.

    Only these five pattern kinds are permitted. Diagnostic categories
    (medical / personality / intelligence / mental-health) are forbidden at
    the type level — a non-allowed kind cannot be constructed. The
    orchestrator re-validates the kind against :data:`PATTERN_KINDS` before
    submitting a candidate, and the Rust authority re-validates again.
    """

    CROSS_SKILL_STRATEGY = "cross_skill_strategy"
    METACOGNITIVE_PATTERN = "metacognitive_pattern"
    BEHAVIOR_PATTERN = "behavior_pattern"
    STABLE_LEARNING_PREFERENCE = "stable_learning_preference"
    RECURRENT_LANGUAGE_PATTERN = "recurrent_language_pattern"


# The fixed set of allowed pattern kinds (M8-05). Exposed as a frozenset for
# the orchestrator's allow-list check and for asserting the enum stays at
# exactly five values.
PATTERN_KINDS: frozenset[str] = frozenset(kind.value for kind in PatternKind)

# Forbidden diagnostic categories (M8-05). The orchestrator rejects any
# candidate whose ``pattern_kind`` (case-insensitive) matches one of these.
# The check is defensive: PatternKind construction already rejects unknown
# values, but this frozenset guards against a future loosening and makes the
# boundary explicit at the orchestrator boundary.
FORBIDDEN_PATTERN_KINDS: frozenset[str] = frozenset(
    {
        "medical",
        "medical_diagnosis",
        "personality",
        "personality_diagnosis",
        "intelligence",
        "intelligence_claim",
        "mental_health",
        "mental_health_inference",
    }
)


class WeeklyPatternProposal(_StrictModel):
    """A single cross-scope pattern proposal from the weekly dream (M8-01/M8-02).

    The LLM proposes a falsifiable, abstract statement that spans at least two
    independent scopes/topics, references supporting memories by stable ID
    (never array index), and carries a confidence proposal. The Rust
    ``dream.run_weekly`` authority re-validates the supports against the
    canonical DB and runs the promotion gate — Python only emits candidates.
    """

    statement: str = Field(min_length=1, max_length=512)
    supporting_memory_ids: list[str] = Field(
        min_length=1, alias="supportingMemoryIds", max_length=32
    )
    pattern_kind: PatternKind = Field(alias="patternKind")
    confidence_proposal: float = Field(
        default=0.5, alias="confidenceProposal", ge=0.0, le=1.0
    )

    @field_validator("supporting_memory_ids")
    @classmethod
    def _stable_memory_ids(cls, value: list[str]) -> list[str]:
        seen: set[str] = set()
        for identifier in value:
            if not isinstance(identifier, str) or not identifier.startswith("mem-"):
                raise ValueError(
                    "supportingMemoryIds must be stable mem-* identifiers"
                )
            if identifier in seen:
                raise ValueError("supportingMemoryIds must be unique")
            seen.add(identifier)
        return list(value)

    def to_wire(self) -> dict[str, Any]:
        return {
            "statement": self.statement,
            "supportingMemoryIds": list(self.supporting_memory_ids),
            "patternKind": self.pattern_kind.value,
            "confidenceProposal": self.confidence_proposal,
        }


class WeeklyDreamResult(_StrictModel):
    """Outcome of a single weekly-dream run (M8-01).

    ``run_id`` comes from the Rust ``dream.run_weekly`` authority. When the
    host call fails (fail-closed), the orchestrator returns a fallback result
    with ``run_id=""`` and a non-empty ``fallback_reason`` — it never raises
    fatal. Empty output (zero patterns) is a success, not a fallback
    (M8-01: better zero patterns than a wrong one).
    """

    run_id: str = Field(default="", max_length=160, alias="runId")
    validated: int = Field(default=0, ge=0)
    rejected: int = Field(default=0, ge=0)
    accepted: int = Field(default=0, ge=0)
    fallback_reason: str | None = Field(default=None, alias="fallbackReason", max_length=2 * 1024)

    @model_validator(mode="after")
    def _fallback_or_run(self) -> "WeeklyDreamResult":
        if self.fallback_reason:
            # Fallback path: no authoritative run_id, no counts.
            if self.run_id:
                raise ValueError("fallback results must not carry a runId")
            if self.validated or self.rejected or self.accepted:
                raise ValueError("fallback results must not carry counts")
            return self
        if not self.run_id:
            raise ValueError("non-fallback results require a runId")
        return self

    def to_wire(self) -> dict[str, Any]:
        return {
            "runId": self.run_id,
            "validated": self.validated,
            "rejected": self.rejected,
            "accepted": self.accepted,
            "fallbackReason": self.fallback_reason,
        }


__all__ = [
    "CAPABILITY_DREAM_RUN_WEEKLY",
    "CAPABILITY_LEARNING_EVIDENCE_BY_IDS",
    "CAPABILITY_LEARNER_SKILL_STATE",
    "CAPABILITY_MEMORY_CANDIDATE_POOL",
    "CAPABILITY_MEMORY_SEARCH_ACTIVE",
    "CAPABILITY_MODEL_INVOKE",
    "CAPABILITY_VERSION_DREAM_RUN_WEEKLY",
    "CAPABILITY_VERSION_LEARNING_EVIDENCE_BY_IDS",
    "CAPABILITY_VERSION_LEARNER_SKILL_STATE",
    "CAPABILITY_VERSION_MEMORY_CANDIDATE_POOL",
    "CAPABILITY_VERSION_MEMORY_SEARCH_ACTIVE",
    "CAPABILITY_VERSION_MODEL_INVOKE",
    "FORBIDDEN_PATTERN_KINDS",
    "JOURNAL_FACTS_SCHEMA_VERSION",
    "PATTERN_KINDS",
    "REQUIRED_WEEKLY_DREAM_HOST_CAPABILITIES",
    "WEEKLY_DREAM_SCHEMA_VERSION",
    "JournalEnrichment",
    "JournalFacts",
    "JournalMemoryEvent",
    "MemoryChangeSummary",
    "PatternKind",
    "SkillDelta",
    "WeeklyDreamResult",
    "WeeklyPatternProposal",
    "WritingEvalSummary",
]
