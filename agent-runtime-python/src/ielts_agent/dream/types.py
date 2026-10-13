"""Journal and weekly-dream typed contracts (Python side).

Pure pydantic data contracts. No canonical DB access, no provider secrets, no
host bridge. The daily journal is a deterministic summary built by the Rust
host: there is no daily dream and no daily proposal. The weekly orchestrator
reads the host-built weekly pack (the learner's practice records of the window)
and submits one narrative (title + a sentence per report block) plus memory mutations via ``dream.run_weekly`` — Rust is
the authority.

Conventions mirror :mod:`ielts_agent.retrieval.types`:

- ``_StrictModel`` base: closed, frozen, strict, camelCase wire aliases,
  ``extra="forbid"`` so no unexpected field survives validation.
- Stable IDs only (``obs-*`` / ``mem-*``); no array indexes as identity.
- Bounds are re-checked here where a field shape admits a bounded range.
"""

from __future__ import annotations

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
CAPABILITY_LEARNING_WEEKLY_PACK = "learning.weekly_pack"

CAPABILITY_VERSION_DREAM_RUN_WEEKLY = "1"
CAPABILITY_VERSION_LEARNING_WEEKLY_PACK = "1"

# Required host capabilities for the weekly-dream orchestration path. The
# learning.weekly_pack capability returns the bounded record-level pack of the
# window (one compact line per practice event, each carrying the obs-* ids a
# mutation may cite, plus the active memories); dream.run_weekly validates the
# narrative and the mutations on the Rust authority.
REQUIRED_WEEKLY_DREAM_HOST_CAPABILITIES: dict[str, str] = {
    CAPABILITY_DREAM_RUN_WEEKLY: CAPABILITY_VERSION_DREAM_RUN_WEEKLY,
    CAPABILITY_LEARNING_WEEKLY_PACK: CAPABILITY_VERSION_LEARNING_WEEKLY_PACK,
}

# M8 weekly-dream schema version. Bumped only on wire-breaking change.
WEEKLY_DREAM_SCHEMA_VERSION = 2


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


# The memory mutations a weekly pass may propose (new / reinforce / supersede /
# archive), in the wire shape every cognitive proposal uses. Rust re-validates.
WEEKLY_MUTATION_ACTIONS: frozenset[str] = frozenset({"ADD", "REINFORCE", "SUPERSEDE", "ARCHIVE"})

# Fields each mutation may carry, and nothing else survives to the host.
WEEKLY_MUTATION_FIELDS: dict[str, frozenset[str]] = {
    "ADD": frozenset({"namespace", "canonicalKey", "scope", "statement", "evidenceObservationIds"}),
    "REINFORCE": frozenset({"targetMemoryId", "evidenceObservationIds"}),
    "SUPERSEDE": frozenset(
        {"targetMemoryId", "namespace", "canonicalKey", "scope", "proposedStatement", "evidenceObservationIds"}
    ),
    "ARCHIVE": frozenset({"targetMemoryId", "evidenceObservationIds"}),
}

MEMORY_NAMESPACES: frozenset[str] = frozenset(
    {"knowledge", "language", "strategy", "behavior", "metacognition", "preference", "goal"}
)
MEMORY_ACTIVITIES: frozenset[str] = frozenset({"reading", "writing"})


# Bounds the host re-validates on a weekly narrative.
WEEKLY_TITLE_MAX_CHARS = 40
WEEKLY_SENTENCE_MAX_CHARS = 120


class WeeklyNarrative(_StrictModel):
    """The model's words on one weekly report: a title and one sentence per block.

    ``title`` names the week's main point; ``sentences`` maps a report block id
    (volume, accuracy, ...) to one plain Chinese sentence interpreting that
    block. Every number on the page lives in the host-computed block data; the
    host refuses a sentence citing any number not in its block, and bounds and
    filters everything again.
    """

    title: str = Field(default="", max_length=WEEKLY_TITLE_MAX_CHARS)
    sentences: dict[str, str] = Field(default_factory=dict)

    @field_validator("title")
    @classmethod
    def _plain_title(cls, value: str) -> str:
        return value.strip()

    @field_validator("sentences")
    @classmethod
    def _plain_sentences(cls, value: dict[str, str]) -> dict[str, str]:
        for block_id, sentence in value.items():
            if not block_id or not sentence.strip() or len(sentence) > WEEKLY_SENTENCE_MAX_CHARS:
                raise ValueError(
                    f"sentences must be non-empty strings of at most {WEEKLY_SENTENCE_MAX_CHARS} characters"
                )
        return {block_id: value[block_id].strip() for block_id in sorted(value)}

    def to_wire(self) -> dict[str, Any]:
        return {"title": self.title, "sentences": dict(self.sentences)}


class WeeklyDreamResult(_StrictModel):
    """Outcome of a single weekly-dream run (M8-01).

    ``run_id`` comes from the Rust ``dream.run_weekly`` authority. When the
    host call fails (fail-closed), the orchestrator returns a fallback result
    with ``run_id=""`` and a non-empty ``fallback_reason`` — it never raises
    fatal. An empty result (nothing worth saying, no mutation) is a success,
    not a fallback (M8-01: better nothing than a wrong claim).
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
    "CAPABILITY_LEARNING_WEEKLY_PACK",
    "CAPABILITY_MEMORY_SEARCH_ACTIVE",
    "CAPABILITY_MODEL_INVOKE",
    "CAPABILITY_VERSION_DREAM_RUN_WEEKLY",
    "CAPABILITY_VERSION_LEARNING_EVIDENCE_BY_IDS",
    "CAPABILITY_VERSION_LEARNER_SKILL_STATE",
    "CAPABILITY_VERSION_LEARNING_WEEKLY_PACK",
    "CAPABILITY_VERSION_MEMORY_SEARCH_ACTIVE",
    "CAPABILITY_VERSION_MODEL_INVOKE",
    "JOURNAL_FACTS_SCHEMA_VERSION",
    "MEMORY_ACTIVITIES",
    "MEMORY_NAMESPACES",
    "REQUIRED_WEEKLY_DREAM_HOST_CAPABILITIES",
    "WEEKLY_DREAM_SCHEMA_VERSION",
    "WEEKLY_MUTATION_ACTIONS",
    "WEEKLY_MUTATION_FIELDS",
    "WEEKLY_SENTENCE_MAX_CHARS",
    "WEEKLY_TITLE_MAX_CHARS",
    "JournalEnrichment",
    "JournalFacts",
    "JournalMemoryEvent",
    "MemoryChangeSummary",
    "SkillDelta",
    "WeeklyNarrative",
    "WeeklyDreamResult",
    "WritingEvalSummary",
]
