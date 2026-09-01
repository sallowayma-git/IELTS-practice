"""M5-02/M5-07 typed retrieval + context plan models.

Pure data contracts. No canonical DB access, no provider secrets. Every chunk
carries stable source lineage (source_kind/source_id/source_version/chunk_id) so
predicted/observed trust can be separated downstream. The ContextPlan only emits
stable IDs + inclusion reasons; the Rust Materializer re-fetches canonical text
and re-authorizes before any model.invoke.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


# Planner + index version pins. Bumped only on wire-breaking change.
CONTEXT_PLAN_SCHEMA_VERSION = 1
CONTEXT_PLANNER_VERSION = "m5-retrieval-v1"
INDEX_SCHEMA_VERSION = 1

# Host capability placeholders. The Rust agent will publish final version strings
# and we align these constants in a follow-up; for now they gate readiness.
CAPABILITY_CORPUS_MANIFEST = "retrieval.corpus_manifest"
CAPABILITY_EXPORT_CHUNKS = "retrieval.export_chunks"
CAPABILITY_FETCH_CHUNKS = "retrieval.fetch_chunks"
CAPABILITY_CONTEXT_MATERIALIZE = "context.materialize"
CAPABILITY_MODEL_EMBED_BATCH = "model.embed.batch"

# Capability version placeholders (Rust agent owns the real versions).
CAPABILITY_VERSION_CORPUS_MANIFEST = "1"
CAPABILITY_VERSION_EXPORT_CHUNKS = "1"
CAPABILITY_VERSION_FETCH_CHUNKS = "1"
CAPABILITY_VERSION_CONTEXT_MATERIALIZE = "1"
CAPABILITY_VERSION_MODEL_EMBED_BATCH = "1"

# Required host capabilities for the retrieval pipeline to function.
REQUIRED_RETRIEVAL_HOST_CAPABILITIES: dict[str, str] = {
    CAPABILITY_CORPUS_MANIFEST: CAPABILITY_VERSION_CORPUS_MANIFEST,
    CAPABILITY_EXPORT_CHUNKS: CAPABILITY_VERSION_EXPORT_CHUNKS,
    CAPABILITY_FETCH_CHUNKS: CAPABILITY_VERSION_FETCH_CHUNKS,
    CAPABILITY_CONTEXT_MATERIALIZE: CAPABILITY_VERSION_CONTEXT_MATERIALIZE,
}


class _StrictModel(BaseModel):
    """Closed, frozen, strict base. No extras survive validation."""

    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


class SourceKind(StrEnum):
    """Canonical provenance of a chunk. Drives source-trust separation."""

    OBSERVED = "observed"          # learner-generated evidence (sessions/attempts)
    INFERRED = "inferred"          # agent-predicted, never mixed with observed
    CURATED = "curated"            # Rust-authored reference material
    SYSTEM = "system"             # soul/policy/seed reference


class Sensitivity(StrEnum):
    """Authorization tier the Rust materializer re-checks."""

    PUBLIC = "public"
    INTERNAL = "internal"
    RESTRICTED = "restricted"
    PRIVATE = "private"


class ContextSection(StrEnum):
    """Fixed ContextPlan section taxonomy (M5-07). Rust injects SOUL_POLICY."""

    SOUL_POLICY = "SOUL_POLICY"
    CURRENT_TASK = "CURRENT_TASK"
    EXPLICIT_USER = "EXPLICIT_USER"
    LEARNER_STATE = "LEARNER_STATE"
    ACTIVE_MEMORY = "ACTIVE_MEMORY"
    RECENT_RELEVANT_EVIDENCE = "RECENT_RELEVANT_EVIDENCE"
    RETRIEVED_CORPUS = "RETRIEVED_CORPUS"
    RECENT_JOURNAL = "RECENT_JOURNAL"
    TOOL_RESERVE = "TOOL_RESERVE"


class CorpusChunk(_StrictModel):
    """A single derived chunk cached from Rust canonical export (M5-01).

    `text` is only populated when the host authorized the export call; the
    materializer never trusts this field and re-fetches canonical text by ID.
    """

    chunk_id: str = Field(min_length=1, max_length=160)
    source_kind: SourceKind
    source_id: str = Field(min_length=1, max_length=160)
    source_version: str | None = Field(default=None, max_length=64)
    content_hash: str = Field(min_length=1, max_length=128)
    scope: str | None = Field(default=None, max_length=64)
    activity: str | None = Field(default=None, max_length=32)
    skill: str | None = Field(default=None, max_length=64)
    sensitivity: Sensitivity
    text: str | None = Field(default=None)
    updated_at: str | None = Field(default=None, max_length=40)

    @field_validator("chunk_id", "source_id", "content_hash")
    @classmethod
    def _no_whitespace_only(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be empty/whitespace")
        return value


class CorpusManifest(_StrictModel):
    """Manifest of the canonical corpus (M5-01). Used to drive sync."""

    corpus_version: str = Field(min_length=1, max_length=64)
    chunk_count: int = Field(ge=0)
    export_cursor: str | None = Field(default=None)
    exported_at: str | None = Field(default=None, max_length=40)
    capabilities: dict[str, str] = Field(default_factory=dict)

    @field_validator("chunk_count")
    @classmethod
    def _non_negative_int(cls, value: int) -> int:
        if value < 0:
            raise ValueError("chunk_count must be non-negative")
        return value


class RetrievalQuery(_StrictModel):
    """Normalized retrieval query entering the pipeline (M5-03/M5-05)."""

    raw_text: str = Field(min_length=1)
    normalized_text: str = Field(min_length=1)
    task_kind: str = Field(min_length=1, max_length=64)
    scope: str | None = Field(default=None, max_length=64)
    activity: str | None = Field(default=None, max_length=32)
    skill: str | None = Field(default=None, max_length=64)
    exact_ids: list[str] = Field(default_factory=list)
    top_k: int = Field(default=10, ge=1, le=64)

    @field_validator("exact_ids")
    @classmethod
    def _unique_ids(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("exact_ids must be unique")
        for identifier in value:
            if not identifier.strip():
                raise ValueError("exact_ids must not contain empty values")
        return list(value)


class RetrievalCandidate(_StrictModel):
    """A fused/ranked candidate carrying inclusion lineage."""

    chunk_id: str = Field(min_length=1, max_length=160)
    score: float = Field(ge=0.0, le=1.0)
    inclusion_reasons: list[str] = Field(min_length=1)
    source_kind: SourceKind | None = None
    source_id: str | None = None
    sensitivity: Sensitivity | None = None

    @field_validator("inclusion_reasons")
    @classmethod
    def _non_empty_reasons(cls, value: list[str]) -> list[str]:
        if not value or any(not reason.strip() for reason in value):
            raise ValueError("inclusion_reasons must be non-empty strings")
        return list(value)


class FusionScore(_StrictModel):
    """Deterministic fusion breakdown for a single candidate (M5-10 trace)."""

    chunk_id: str = Field(min_length=1, max_length=160)
    lexical_rank: int | None = None
    embedding_rank: int | None = None
    exact_rank: int | None = None
    rrf_score: float = Field(ge=0.0)
    salience: float = Field(default=0.0, ge=0.0, le=1.0)
    time_decay: float = Field(default=1.0, ge=0.0, le=1.0)
    final_score: float = Field(ge=0.0, le=1.0)
    inclusion_reasons: list[str] = Field(min_length=1)


class ContextSectionPlan(_StrictModel):
    """A single section allocation in the ContextPlan."""

    section: ContextSection
    item_ids: list[str] = Field(default_factory=list)
    requested_token_budget: int = Field(default=0, ge=0)
    inclusion_reasons: list[str] = Field(default_factory=list)

    @field_validator("item_ids")
    @classmethod
    def _unique_section_items(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("item_ids must be unique within a section")
        return list(value)


class ContextPlan(_StrictModel):
    """M5-07 typed context plan. Python emits IDs + reasons, never prompt text.

    The Rust Materializer re-validates every `ranked_item_ids` entry against
    canonical truth, re-authorizes sensitivity/scope, re-fetches text, injects
    the immutable Soul/policy section, and enforces the hard token ceiling.
    """

    schema_version: int = Field(default=CONTEXT_PLAN_SCHEMA_VERSION)
    planner_version: str = Field(default=CONTEXT_PLANNER_VERSION)
    task_kind: str = Field(min_length=1, max_length=64)
    sections: list[ContextSectionPlan] = Field(min_length=1)
    ranked_item_ids: list[str] = Field(default_factory=list)
    inclusion_reasons: dict[str, list[str]] = Field(default_factory=dict)
    requested_token_budget: int = Field(ge=0)
    retrieval_run_ids: list[str] = Field(default_factory=list)

    @field_validator("ranked_item_ids")
    @classmethod
    def _unique_ranked(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("ranked_item_ids must be unique")
        return list(value)

    @field_validator("retrieval_run_ids")
    @classmethod
    def _unique_runs(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("retrieval_run_ids must be unique")
        return list(value)

    @field_validator("sections")
    @classmethod
    def _unique_sections(cls, value: list[ContextSectionPlan]) -> list[ContextSectionPlan]:
        seen: set[str] = set()
        for section in value:
            if section.section.value in seen:
                raise ValueError(f"duplicate section: {section.section.value}")
            seen.add(section.section.value)
        return list(value)

    def to_wire(self) -> dict[str, Any]:
        """Wire-serialization for the Rust materializer reverse-RPC call."""
        return {
            "schemaVersion": self.schema_version,
            "plannerVersion": self.planner_version,
            "taskKind": self.task_kind,
            "sections": [section.model_dump(by_alias=False, mode="json") for section in self.sections],
            "rankedItemIds": list(self.ranked_item_ids),
            "inclusionReasons": {
                key: list(values) for key, values in self.inclusion_reasons.items()
            },
            "requestedTokenBudget": self.requested_token_budget,
            "retrievalRunIds": list(self.retrieval_run_ids),
        }


__all__ = [
    "CAPABILITY_CONTEXT_MATERIALIZE",
    "CAPABILITY_CORPUS_MANIFEST",
    "CAPABILITY_EXPORT_CHUNKS",
    "CAPABILITY_FETCH_CHUNKS",
    "CAPABILITY_MODEL_EMBED_BATCH",
    "CAPABILITY_VERSION_CONTEXT_MATERIALIZE",
    "CAPABILITY_VERSION_CORPUS_MANIFEST",
    "CAPABILITY_VERSION_EXPORT_CHUNKS",
    "CAPABILITY_VERSION_FETCH_CHUNKS",
    "CAPABILITY_VERSION_MODEL_EMBED_BATCH",
    "CONTEXT_PLAN_SCHEMA_VERSION",
    "CONTEXT_PLANNER_VERSION",
    "INDEX_SCHEMA_VERSION",
    "REQUIRED_RETRIEVAL_HOST_CAPABILITIES",
    "ContextPlan",
    "ContextSection",
    "ContextSectionPlan",
    "CorpusChunk",
    "CorpusManifest",
    "FusionScore",
    "RetrievalCandidate",
    "RetrievalQuery",
    "Sensitivity",
    "SourceKind",
]
