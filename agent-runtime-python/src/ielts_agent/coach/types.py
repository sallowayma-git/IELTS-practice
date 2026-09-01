"""M6-04 / M6-10 typed coach metadata + outcome contracts.

These pydantic models are the wire/audit boundary for the Python enhanced coach
path. They carry structured provenance (M6-04) and the satisfaction/learning
outcome split (M6-10) without ever touching the canonical SQLite DB or provider
secrets — all persistence happens through the Rust host gateway.

Boundary rules enforced here:
- `CoachStrategyAssignment` is the M6-04 metadata record (strategyId + skills +
  memory IDs + context snapshot + followupType). M6 only selects + records;
  weights are M10.
- `CoachFeedback` is the M6-05 canonical interaction fact (NOT a preference).
- `ReaskLink` is the M6-06 explicit re-ask linkage (no transcript guessing).
- `CoachOutcome` keeps satisfaction and learning outcomes on separate axes so a
  thumbs-up can never be conflated with skill acquisition (M6-10).
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


COACH_STRATEGY_ASSIGNMENT_SCHEMA_VERSION = 1
COACH_OUTCOME_SCHEMA_VERSION = 1

# Stable follow-up taxonomy (M6-04). Rust persists verbatim; M10 reads it back.
_FOLLOWUP_TYPES = frozenset(
    {"explain", "drill", "summarize", "next_question", "no_followup"}
)


class CoachFollowupType(StrEnum):
    """What the coach expects the learner to do next after the explanation."""

    EXPLAIN = "explain"
    DRILL = "drill"
    SUMMARIZE = "summarize"
    NEXT_QUESTION = "next_question"
    NO_FOLLOWUP = "no_followup"


class CoachFeedbackKind(StrEnum):
    """M6-05 canonical feedback enum. Interaction fact, not a preference.

    A single `need_example` is an observation; only repeated signal + better
    later outcomes can promote a candidate preference (M6-07). This enum never
    asserts preference on its own.
    """

    THUMBS_UP = "thumbs_up"
    THUMBS_DOWN = "thumbs_down"
    TOO_LONG = "too_long"
    TOO_SHORT = "too_short"
    TOO_ABSTRACT = "too_abstract"
    NEED_EXAMPLE = "need_example"
    NEED_STEP_BY_STEP = "need_step_by_step"
    INCORRECT = "incorrect"
    NOT_RELEVANT = "not_relevant"
    REASK_SAME_QUESTION = "reask_same_question"
    STYLE_CORRECTION = "style_correction"


class CoachOutcomeKind(StrEnum):
    """M6-10 outcome split: satisfaction (interaction) vs learning (skill)."""

    SATISFACTION = "satisfaction"
    LEARNING = "learning"


class _ClosedModel(BaseModel):
    """Closed, frozen, strict base. No extras survive validation."""

    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


class CoachStrategyAssignment(_ClosedModel):
    """M6-04 structured coach response metadata (provenance for M10).

    The coach body stays natural language; this record travels alongside it so
    Rust can persist strategyId / skillsAddressed / memoryIdsUsed /
    contextSnapshotId / followupType for later outcome linkage.
    """

    schema_version: int = Field(
        default=COACH_STRATEGY_ASSIGNMENT_SCHEMA_VERSION,
        alias="schemaVersion",
    )
    strategy_id: str = Field(alias="strategyId", min_length=1, max_length=64)
    skills_addressed: list[str] = Field(
        alias="skillsAddressed", default_factory=list, max_length=32
    )
    memory_ids_used: list[str] = Field(
        alias="memoryIdsUsed", default_factory=list, max_length=64
    )
    context_snapshot_id: str = Field(
        alias="contextSnapshotId", min_length=1, max_length=160
    )
    followup_type: CoachFollowupType = Field(alias="followupType")

    @field_validator("skills_addressed", "memory_ids_used")
    @classmethod
    def _unique_ids(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("id lists must be unique")
        for identifier in value:
            if not isinstance(identifier, str) or not identifier.strip():
                raise ValueError("ids must be non-empty strings")
        return list(value)

    @model_validator(mode="after")
    def _check_followup(self) -> CoachStrategyAssignment:
        if self.followup_type.value not in _FOLLOWUP_TYPES:
            raise ValueError(f"unsupported followupType: {self.followup_type}")
        return self

    def to_wire(self) -> dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "strategyId": self.strategy_id,
            "skillsAddressed": list(self.skills_addressed),
            "memoryIdsUsed": list(self.memory_ids_used),
            "contextSnapshotId": self.context_snapshot_id,
            "followupType": self.followup_type.value,
        }


class CoachFeedback(_ClosedModel):
    """M6-05 canonical coach feedback record (interaction fact)."""

    schema_version: int = Field(
        default=COACH_STRATEGY_ASSIGNMENT_SCHEMA_VERSION, alias="schemaVersion"
    )
    feedback_kind: CoachFeedbackKind = Field(alias="feedbackKind")
    strategy_assignment_id: str | None = Field(
        alias="strategyAssignmentId", default=None, max_length=160
    )
    note: str | None = Field(default=None, max_length=4 * 1024)

    def to_wire(self) -> dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "feedbackKind": self.feedback_kind.value,
            "strategyAssignmentId": self.strategy_assignment_id,
            "note": self.note,
        }


class ReaskLink(_ClosedModel):
    """M6-06 explicit re-ask linkage (UI/service records, not transcript guess).

    A re-ask link is only created when the user re-asks the SAME question. New
    questions never establish a link, so the extractor can rely on this record
    instead of guessing from the conversation transcript.
    """

    schema_version: int = Field(
        default=COACH_STRATEGY_ASSIGNMENT_SCHEMA_VERSION, alias="schemaVersion"
    )
    parent_assistant_message_id: str = Field(
        alias="parentAssistantMessageId", min_length=1, max_length=160
    )
    new_user_message_id: str = Field(
        alias="newUserMessageId", min_length=1, max_length=160
    )
    strategy_assignment_id: str = Field(
        alias="strategyAssignmentId", min_length=1, max_length=160
    )

    def to_wire(self) -> dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "parentAssistantMessageId": self.parent_assistant_message_id,
            "newUserMessageId": self.new_user_message_id,
            "strategyAssignmentId": self.strategy_assignment_id,
        }


class CoachOutcome(_ClosedModel):
    """M6-10 outcome link. satisfaction and learning are separate axes.

    A thumbs-up (satisfaction) must NEVER be recorded as a learning outcome.
    Learning outcome only fires when a later skill observation confirms the
    targeted skill moved. The two live in different tables on the Rust side.
    """

    schema_version: int = Field(
        default=COACH_OUTCOME_SCHEMA_VERSION, alias="schemaVersion"
    )
    outcome_kind: CoachOutcomeKind = Field(alias="outcomeKind")
    strategy_assignment_id: str = Field(
        alias="strategyAssignmentId", min_length=1, max_length=160
    )
    # For satisfaction: a CoachFeedbackKind (e.g. thumbs_up). For learning: the
    # later skill observation id that confirms the skill moved.
    evidence_ref: str = Field(alias="evidenceRef", min_length=1, max_length=160)
    skill: str | None = Field(default=None, max_length=64)

    def to_wire(self) -> dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "outcomeKind": self.outcome_kind.value,
            "strategyAssignmentId": self.strategy_assignment_id,
            "evidenceRef": self.evidence_ref,
            "skill": self.skill,
        }


STRATEGY_EVAL_SCHEMA_VERSION = 1
USER_STRATEGY_STATE_SCHEMA_VERSION = 1
OUTCOME_ATTRIBUTION_SCHEMA_VERSION = 1

# M10-01 catalog: the v1 teaching-strategy catalog (8 ids). M6 keeps its own
# 6-id selector catalog (coach/strategies.py) untouched; M10 evaluation reads
# the full 8-id set because outcomes/feedback can reference any of them.
STRATEGY_CATALOG_V1: frozenset[str] = frozenset(
    {
        "evidence_first_v1",
        "example_first_v1",
        "step_by_step_v1",
        "contrastive_v1",
        "socratic_prompt_v1",
        "concise_direct_v1",
        "error_then_rule_v1",
        "rule_then_example_v1",
    }
)

# Host capability pins for the M10 strategy evolution authority (Rust Slice 1).
# Versions are pinned to "1" so a handshake mismatch forces a clean fallback
# rather than silent drift.
CAPABILITY_STRATEGY_SELECT = "strategy.select"
CAPABILITY_STRATEGY_RECORD_ASSIGNMENT = "strategy.record_assignment"
CAPABILITY_STRATEGY_RECORD_FEEDBACK = "strategy.record_feedback"
CAPABILITY_STRATEGY_RECORD_OUTCOME = "strategy.record_outcome"
CAPABILITY_STRATEGY_USER_STATE = "strategy.user_state"
CAPABILITY_VERSION_STRATEGY_SELECT = "1"
CAPABILITY_VERSION_STRATEGY_RECORD_ASSIGNMENT = "1"
CAPABILITY_VERSION_STRATEGY_RECORD_FEEDBACK = "1"
CAPABILITY_VERSION_STRATEGY_RECORD_OUTCOME = "1"
CAPABILITY_VERSION_STRATEGY_USER_STATE = "1"

REQUIRED_STRATEGY_EVAL_HOST_CAPABILITIES: dict[str, str] = {
    CAPABILITY_STRATEGY_SELECT: CAPABILITY_VERSION_STRATEGY_SELECT,
    CAPABILITY_STRATEGY_RECORD_ASSIGNMENT: CAPABILITY_VERSION_STRATEGY_RECORD_ASSIGNMENT,
    CAPABILITY_STRATEGY_RECORD_FEEDBACK: CAPABILITY_VERSION_STRATEGY_RECORD_FEEDBACK,
    CAPABILITY_STRATEGY_RECORD_OUTCOME: CAPABILITY_VERSION_STRATEGY_RECORD_OUTCOME,
    CAPABILITY_STRATEGY_USER_STATE: CAPABILITY_VERSION_STRATEGY_USER_STATE,
}


class StrategyFeedbackKind(StrEnum):
    """M10-03 satisfaction channel: interaction facts, never learning proof.

    A thumbs_up here is satisfaction evidence ONLY — it must never be recorded
    as a learning outcome (that is :class:`StrategyOutcomeKind`). The five
    values mirror the M10-03 satisfaction reward channel.
    """

    THUMBS = "thumbs"
    REASK = "reask"
    EXPLICIT_CORRECTION = "explicit_correction"
    ABANDON = "abandon"
    # Neutral satisfaction signal (no positive/negative lean). Carries no
    # learning claim; used for confidence accounting only.
    NEUTRAL = "neutral"


class StrategyOutcomeKind(StrEnum):
    """M10-03 learning channel: future skill evidence, never satisfaction.

    These fire ONLY when a later skill observation confirms the targeted
    skill moved (delayed outcome window). A thumbs-up can never produce one of
    these. The four values mirror the M10-03 learning reward channel.
    """

    NEXT_NOVEL_SKILL_ATTEMPT = "next_novel_skill_attempt"
    NEXT_WRITING_REVISION = "next_writing_revision"
    CORRECTED_REPEATED_BEHAVIOR = "corrected_repeated_behavior"
    TRANSFER_TO_ANOTHER_ASSET = "transfer_to_another_asset"


class OutcomeAttributionKind(StrEnum):
    """M10-04 delayed-outcome attribution verdict.

    - ATTRIBUTED: a relevant future observation fell inside the window on a
      novel asset (the assignment's target moved).
    - OUT_OF_WINDOW: the next relevant observation fell outside the window.
      No effectiveness claim is recorded — the strategy is NOT punished.
    - DISCOUNTED_SAME_ASSET: a later observation referenced the SAME asset the
      assignment already touched. We prefer novel-asset evidence (M10-04), so
      a same-asset repeat is discounted rather than credited.
    """

    ATTRIBUTED = "attributed"
    OUT_OF_WINDOW = "out_of_window"
    DISCOUNTED_SAME_ASSET = "discounted_same_asset"


class StrategyAssignment(_ClosedModel):
    """M10-02 strategy assignment record (provenance for delayed attribution).

    The coach records, per response: the chosen strategy, why it was chosen,
    which memory IDs grounded it, which skill keys it targeted, the context
    snapshot id, and the assistant response message id. Rust persists this via
    ``strategy.record_assignment``; M10-04 reads it back within the delayed
    outcome window.
    """

    schema_version: int = Field(
        default=STRATEGY_EVAL_SCHEMA_VERSION, alias="schemaVersion"
    )
    strategy_id: str = Field(alias="strategyId", min_length=1, max_length=64)
    why_selected: str = Field(alias="whySelected", min_length=1, max_length=2 * 1024)
    memory_ids: list[str] = Field(
        alias="memoryIds", default_factory=list, max_length=64
    )
    skill_keys: list[str] = Field(
        alias="skillKeys", default_factory=list, max_length=32
    )
    context_snapshot_id: str = Field(
        alias="contextSnapshotId", min_length=1, max_length=160
    )
    response_message_id: str = Field(
        alias="responseMessageId", min_length=1, max_length=160
    )
    # Asset the assignment targeted (e.g. a passage id, writing attempt id).
    # M10-04 prefers a NOVEL asset for outcome attribution — a repeat on the
    # same asset is discounted rather than credited as learning.
    target_asset_id: str | None = Field(
        default=None, alias="targetAssetId", max_length=160
    )

    @field_validator("strategy_id")
    @classmethod
    def _strategy_in_catalog(cls, value: str) -> str:
        if value not in STRATEGY_CATALOG_V1:
            raise ValueError(f"strategyId {value!r} is not in the M10 v1 catalog")
        return value

    @field_validator("memory_ids", "skill_keys")
    @classmethod
    def _unique_ids(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("id lists must be unique")
        for identifier in value:
            if not isinstance(identifier, str) or not identifier.strip():
                raise ValueError("ids must be non-empty strings")
        return list(value)

    def to_wire(self) -> dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "strategyId": self.strategy_id,
            "whySelected": self.why_selected,
            "memoryIds": list(self.memory_ids),
            "skillKeys": list(self.skill_keys),
            "contextSnapshotId": self.context_snapshot_id,
            "responseMessageId": self.response_message_id,
            "targetAssetId": self.target_asset_id,
        }


class UserStrategyState(_ClosedModel):
    """M10-05 user-specific strategy state (strategy × scope counts + confidence).

    Read via ``strategy.user_state``. Python never writes this directly — the
    Rust authority owns the counters. ``confidence`` is a bounded view
    (success/(success+failure), clamped 0..1) computed by the eval orchestrator
    from the raw counts; the raw counts are the source of truth.
    """

    schema_version: int = Field(
        default=USER_STRATEGY_STATE_SCHEMA_VERSION, alias="schemaVersion"
    )
    strategy_id: str = Field(alias="strategyId", min_length=1, max_length=64)
    scope: str = Field(min_length=1, max_length=64)
    success_count: int = Field(default=0, ge=0, alias="successCount")
    failure_count: int = Field(default=0, ge=0, alias="failureCount")
    satisfaction_count: int = Field(default=0, ge=0, alias="satisfactionCount")
    reask_count: int = Field(default=0, ge=0, alias="reaskCount")
    novel_transfer_success: int = Field(
        default=0, ge=0, alias="novelTransferSuccess"
    )
    last_used: str | None = Field(default=None, alias="lastUsed", max_length=40)
    # Bounded view confidence in [0.0, 1.0]. Rust may persist a stored value;
    # Python recomputes it from success/(success+failure) when it needs to.
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)

    @field_validator("strategy_id")
    @classmethod
    def _strategy_in_catalog(cls, value: str) -> str:
        if value not in STRATEGY_CATALOG_V1:
            raise ValueError(f"strategyId {value!r} is not in the M10 v1 catalog")
        return value

    def to_wire(self) -> dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "strategyId": self.strategy_id,
            "scope": self.scope,
            "successCount": self.success_count,
            "failureCount": self.failure_count,
            "satisfactionCount": self.satisfaction_count,
            "reaskCount": self.reask_count,
            "novelTransferSuccess": self.novel_transfer_success,
            "lastUsed": self.last_used,
            "confidence": self.confidence,
        }


class StrategySelection(_ClosedModel):
    """M10-06 selection result.

    The selected strategy plus the ordered alternatives the scorer considered,
    and the human-readable reason (for the DoD explainability questions).
    ``is_exploration`` marks an exploration-slot pick — only emitted when
    evidence is sufficient (M10-06 cap).
    """

    schema_version: int = Field(
        default=STRATEGY_EVAL_SCHEMA_VERSION, alias="schemaVersion"
    )
    selected_strategy_id: str = Field(
        alias="selectedStrategyId", min_length=1, max_length=64
    )
    why: str = Field(min_length=1, max_length=2 * 1024)
    alternatives: list[dict[str, Any]] = Field(default_factory=list, max_length=16)
    is_exploration: bool = Field(default=False, alias="isExploration")

    @field_validator("selected_strategy_id")
    @classmethod
    def _strategy_in_catalog(cls, value: str) -> str:
        if value not in STRATEGY_CATALOG_V1:
            raise ValueError(
                f"selectedStrategyId {value!r} is not in the M10 v1 catalog"
            )
        return value

    def to_wire(self) -> dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "selectedStrategyId": self.selected_strategy_id,
            "why": self.why,
            "alternatives": list(self.alternatives),
            "isExploration": self.is_exploration,
        }


class OutcomeAttribution(_ClosedModel):
    """M10-04 delayed-outcome attribution verdict.

    When the orchestrator scans future observations for a strategy assignment,
    it returns one of these. ``attributed=True`` only when
    :attr:`kind` is :attr:`OutcomeAttributionKind.ATTRIBUTED` AND the evidence
    was on a novel asset. Out-of-window and discounted-same-asset verdicts do
    NOT record an effectiveness claim.
    """

    schema_version: int = Field(
        default=OUTCOME_ATTRIBUTION_SCHEMA_VERSION, alias="schemaVersion"
    )
    kind: OutcomeAttributionKind
    strategy_assignment_id: str = Field(
        alias="strategyAssignmentId", min_length=1, max_length=160
    )
    # The future observation that triggered the verdict (None when out_of_window
    # and no candidate observation fell inside the window at all).
    evidence_observation_id: str | None = Field(
        default=None, alias="evidenceObservationId", max_length=160
    )
    outcome_kind: StrategyOutcomeKind | None = Field(
        default=None, alias="outcomeKind"
    )
    skill: str | None = Field(default=None, max_length=64)
    asset_id: str | None = Field(default=None, alias="assetId", max_length=160)

    @model_validator(mode="after")
    def _attributed_requires_evidence(self) -> OutcomeAttribution:
        if self.kind is OutcomeAttributionKind.ATTRIBUTED:
            if not self.evidence_observation_id:
                raise ValueError(
                    "attributed verdicts require an evidenceObservationId"
                )
            if self.outcome_kind is None:
                raise ValueError("attributed verdicts require an outcomeKind")
        else:
            # Non-attributed verdicts must NOT carry an effectiveness claim.
            if self.outcome_kind is not None:
                raise ValueError(
                    f"{self.kind.value} verdicts must not carry an outcomeKind"
                )
        return self

    @property
    def attributed(self) -> bool:
        return self.kind is OutcomeAttributionKind.ATTRIBUTED

    def to_wire(self) -> dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "kind": self.kind.value,
            "strategyAssignmentId": self.strategy_assignment_id,
            "evidenceObservationId": self.evidence_observation_id,
            "outcomeKind": self.outcome_kind.value if self.outcome_kind else None,
            "skill": self.skill,
            "assetId": self.asset_id,
        }


__all__ = [
    "CAPABILITY_STRATEGY_RECORD_ASSIGNMENT",
    "CAPABILITY_STRATEGY_RECORD_FEEDBACK",
    "CAPABILITY_STRATEGY_RECORD_OUTCOME",
    "CAPABILITY_STRATEGY_SELECT",
    "CAPABILITY_STRATEGY_USER_STATE",
    "CAPABILITY_VERSION_STRATEGY_RECORD_ASSIGNMENT",
    "CAPABILITY_VERSION_STRATEGY_RECORD_FEEDBACK",
    "CAPABILITY_VERSION_STRATEGY_RECORD_OUTCOME",
    "CAPABILITY_VERSION_STRATEGY_SELECT",
    "CAPABILITY_VERSION_STRATEGY_USER_STATE",
    "COACH_OUTCOME_SCHEMA_VERSION",
    "COACH_STRATEGY_ASSIGNMENT_SCHEMA_VERSION",
    "CoachFeedback",
    "CoachFeedbackKind",
    "CoachFollowupType",
    "CoachOutcome",
    "CoachOutcomeKind",
    "CoachStrategyAssignment",
    "OUTCOME_ATTRIBUTION_SCHEMA_VERSION",
    "OutcomeAttribution",
    "OutcomeAttributionKind",
    "REQUIRED_STRATEGY_EVAL_HOST_CAPABILITIES",
    "ReaskLink",
    "STRATEGY_CATALOG_V1",
    "STRATEGY_EVAL_SCHEMA_VERSION",
    "StrategyAssignment",
    "StrategyFeedbackKind",
    "StrategyOutcomeKind",
    "StrategySelection",
    "USER_STRATEGY_STATE_SCHEMA_VERSION",
    "UserStrategyState",
]
