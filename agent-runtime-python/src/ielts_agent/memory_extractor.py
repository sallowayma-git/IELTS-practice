"""Bounded M3 candidate input and deterministic no-embedding fallback."""

from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from .memory_proposals import (
    MEMORY_PROPOSAL_SCHEMA_VERSION,
    MAX_MEMORY_PROPOSALS,
    Activity,
    ActivityScope,
    AddProposal,
    MemoryNamespace,
    MemoryProposal,
    MemoryProposalAction,
    MemoryProposalBatch,
    MemoryProposalParseError,
    TargetProposal,
    parse_memory_proposal_batch,
)

MAX_CANDIDATE_OBSERVATIONS = 200
MAX_ACTIVE_MEMORY = 128
MAX_EXPLICIT_PREFERENCES = 100
MAX_SUMMARY_BYTES = 4 * 1024
_SLUG = re.compile(r"[^a-z0-9]+")
_Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class ClosedModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True, populate_by_name=True)


class CandidateScope(ClosedModel):
    type: Literal["activity"]
    key: Literal["reading", "writing"]


class ObservationSummary(ClosedModel):
    id: _Text
    namespace: Literal["knowledge", "language", "strategy", "behavior", "metacognition", "preference", "goal"]
    activity: Literal["reading", "writing"]
    normalized_label: _Text = Field(alias="normalizedLabel")
    statement: _Text
    canonical_key: str | None = Field(default=None, alias="canonicalKey")

    @field_validator("id")
    @classmethod
    def stable_observation_id(cls, value: str) -> str:
        if not value.startswith("obs-"):
            raise ValueError("observation ID must be a stable obs-* identifier")
        return value

    @field_validator("statement")
    @classmethod
    def bounded_statement(cls, value: str) -> str:
        _bounded_utf8(value, MAX_SUMMARY_BYTES, "statement")
        return value


class ActiveMemorySummary(ClosedModel):
    id: _Text
    namespace: Literal["knowledge", "language", "strategy", "behavior", "metacognition", "preference", "goal"]
    canonical_key: _Text = Field(alias="canonicalKey")
    normalized_label: _Text = Field(alias="normalizedLabel")
    scope: CandidateScope

    @field_validator("id")
    @classmethod
    def stable_memory_id(cls, value: str) -> str:
        if not value.startswith("mem-"):
            raise ValueError("memory ID must be a stable mem-* identifier")
        return value


class ExplicitPreferenceSummary(ClosedModel):
    preference_key: _Text = Field(alias="preferenceKey")
    scope: _Text
    value: object


class MemoryCandidateInput(ClosedModel):
    observations: list[ObservationSummary] = Field(max_length=MAX_CANDIDATE_OBSERVATIONS)
    active_memory: list[ActiveMemorySummary] = Field(alias="activeMemory", max_length=MAX_ACTIVE_MEMORY)
    explicit_preferences: list[ExplicitPreferenceSummary] = Field(
        alias="explicitPreferences", max_length=MAX_EXPLICIT_PREFERENCES
    )
    task_scope: CandidateScope = Field(alias="taskScope")
    max_candidates: int = Field(alias="maxCandidates", ge=1, le=MAX_MEMORY_PROPOSALS)

    @model_validator(mode="after")
    def same_activity_and_unique_ids(self) -> "MemoryCandidateInput":
        ids = [observation.id for observation in self.observations]
        if len(ids) != len(set(ids)):
            raise ValueError("observation IDs must be unique")
        if any(observation.activity != self.task_scope.key for observation in self.observations):
            raise ValueError("all observations must match taskScope")
        return self


def extract_memory_candidates(
    candidate_input: MemoryCandidateInput,
    model_output: str,
) -> tuple[MemoryProposalBatch, bool]:
    """Return strict model proposals or a deterministic exact-match fallback.

    The boolean is true only when malformed/unsafe model output forced fallback.
    Rust still revalidates every returned ID and persists only pending candidates.
    """

    try:
        batch = parse_memory_proposal_batch(model_output)
        _validate_against_input(batch, candidate_input)
        return _truncate(batch, candidate_input.max_candidates), False
    except (MemoryProposalParseError, ValueError):
        return deterministic_fallback(candidate_input), True


def deterministic_fallback(candidate_input: MemoryCandidateInput) -> MemoryProposalBatch:
    by_key = {memory.canonical_key: memory for memory in candidate_input.active_memory}
    by_label = {
        (memory.scope.key, _normalize_label(memory.normalized_label)): memory
        for memory in candidate_input.active_memory
    }
    proposals: list[MemoryProposal] = []
    seen_slots: set[str] = set()
    for observation in candidate_input.observations:
        if len(proposals) >= candidate_input.max_candidates:
            break
        target = None
        if observation.canonical_key:
            target = by_key.get(observation.canonical_key)
        if target is None:
            target = by_label.get(
                (observation.activity, _normalize_label(observation.normalized_label))
            )
        if target is not None:
            slot = f"memory:{target.id}"
            if slot in seen_slots:
                continue
            seen_slots.add(slot)
            proposals.append(
                TargetProposal(
                    action=MemoryProposalAction.REINFORCE,
                    target_memory_id=target.id,
                    evidence_observation_ids=(observation.id,),
                )
            )
            continue
        namespace = MemoryNamespace(observation.namespace)
        canonical_key = observation.canonical_key or _emergent_key(observation)
        slot = f"key:{canonical_key}"
        if slot in seen_slots:
            continue
        seen_slots.add(slot)
        proposals.append(
            AddProposal(
                namespace=namespace,
                canonical_key=canonical_key,
                scope=ActivityScope(key=Activity(observation.activity)),
                statement=observation.statement,
                evidence_observation_ids=(observation.id,),
            )
        )
    return MemoryProposalBatch(
        schema_version=MEMORY_PROPOSAL_SCHEMA_VERSION,
        proposals=tuple(proposals),
    )


def _validate_against_input(
    batch: MemoryProposalBatch,
    candidate_input: MemoryCandidateInput,
) -> None:
    observation_ids = {item.id for item in candidate_input.observations}
    memory_ids = {item.id for item in candidate_input.active_memory}
    for proposal in batch.proposals:
        wire = proposal.to_wire()
        evidence_ids = set(wire.get("evidenceObservationIds", []))
        if not evidence_ids.issubset(observation_ids):
            raise ValueError("model proposal references observation outside bounded input")
        target_id = wire.get("targetMemoryId")
        if target_id is not None and target_id not in memory_ids:
            raise ValueError("model proposal references memory outside bounded input")


def _truncate(batch: MemoryProposalBatch, limit: int) -> MemoryProposalBatch:
    return MemoryProposalBatch(batch.schema_version, batch.proposals[:limit])


def _emergent_key(observation: ObservationSummary) -> str:
    label = _normalize_label(observation.normalized_label)
    slug = _SLUG.sub("_", label).strip("_") or "candidate"
    return f"{observation.namespace}.{observation.activity}.{slug}"


def _normalize_label(value: str) -> str:
    return " ".join(value.casefold().split())


def _bounded_utf8(value: str, maximum: int, field: str) -> None:
    if len(value.encode("utf-8")) > maximum:
        raise ValueError(f"{field} exceeds {maximum} UTF-8 bytes")
