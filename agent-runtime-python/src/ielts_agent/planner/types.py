"""M12-04 Study Planner typed contracts (Slice 2 / Python side).

Pure pydantic data contracts. No canonical DB access, no provider secrets, no
host bridge. The :class:`StudyPlannerOrchestrator` reads bounded learner/memory
facts via the Rust host gateway (``learning.learner_skill_state`` /
``memory.search_active`` + M5 retrieval context), produces a deterministic
study-plan proposal (today practice what / why / which skill probe / how long),
and submits it via ``study_plan.create`` — Rust is the controlled-actions
authority and the only writer of canonical study-plan state.

Conventions mirror :mod:`ielts_agent.dream.types` and
:mod:`ielts_agent.coach.types`:

- ``_StrictModel`` base: closed, frozen, strict, camelCase wire aliases,
  ``extra="forbid"`` so no unexpected field survives validation.
- Stable IDs only; no array indexes as identity.
- ``to_wire()`` emits the camelCase payload the Rust host expects.

Boundary rules enforced here (M12 plan §9204-9384):

- **M12-05 skill probe, not exact question.** A :class:`StudyPlanItem` targets a
  ``skill_key`` + ``probe_kind`` (a skill probe), never a specific asset /
  question id from history. The planner reuses the Rust-host
  ``SkillReviewNeed.preferred_probe`` taxonomy but never echoes an original
  question id — the learner practises the SKILL, not a memorised item.
- **M12-04 first version = proposal only.** ``StudyPlanProposal`` is a
  proposal; the Rust ``study_plan.create`` authority persists it. Python never
  writes canonical study-plan state directly (no-write-bypass).
- **M12-06 forbidden tools.** This module never touches the canonical DB
  (the forbidden stdlib DB driver), the filesystem, provider secrets, prompt
  mutation, or schema migration. The M3 contract gate re-validates this at CI
  time.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


# Schema + capability version pins. Bumped only on wire-breaking change.
STUDY_PLAN_PROPOSAL_SCHEMA_VERSION = 1
PLANNER_INPUT_SCHEMA_VERSION = 1

# Host capabilities the planner relies on. The M4 learner-state and M3/M5 memory
# reads already exist on the Rust host. ``study_plan.create`` is the M12-06
# controlled-actions authority the Rust Slice 1 will expose; we pin version "1"
# so a handshake mismatch forces a clean fallback rather than silent drift.
CAPABILITY_LEARNER_SKILL_STATE = "learning.learner_skill_state"
CAPABILITY_MEMORY_SEARCH_ACTIVE = "memory.search_active"
CAPABILITY_CONTEXT_MATERIALIZE = "context.materialize"
CAPABILITY_STUDY_PLAN_CREATE = "study_plan.create"

CAPABILITY_VERSION_LEARNER_SKILL_STATE = "1"
CAPABILITY_VERSION_MEMORY_SEARCH_ACTIVE = "1"
CAPABILITY_VERSION_CONTEXT_MATERIALIZE = "1"
CAPABILITY_VERSION_STUDY_PLAN_CREATE = "1"

# Required host capabilities for the planner orchestration path. The planner
# only NEEDS ``study_plan.create`` to persist its proposal — the learner/memory
# reads are best-effort enrichment (a planner can produce a 0-item proposal when
# they are unavailable, fail-closed). The orchestrator advertises the full set
# so a capability mismatch surfaces early; the host may omit the read-only reads
# without forcing a fallback (see ``StudyPlannerOrchestrator``).
REQUIRED_STUDY_PLANNER_HOST_CAPABILITIES: dict[str, str] = {
    CAPABILITY_STUDY_PLAN_CREATE: CAPABILITY_VERSION_STUDY_PLAN_CREATE,
}


class _StrictModel(BaseModel):
    """Closed, frozen, strict base. No extras survive validation."""

    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        populate_by_name=True,
    )


class _HostViewModel(BaseModel):
    """Frozen base for a BOUNDED READ of a row the Rust host owns.

    Identical to :class:`_StrictModel` except that unknown keys are ignored
    instead of rejected, and that difference is load-bearing.

    These models describe only the handful of fields the planner needs out of a
    much wider canonical row. Under ``extra="forbid"`` every such row failed
    validation, and the callers skip a row that fails
    (``study_plan._parse_review_needs`` / ``_parse_uncertainty_map`` both
    ``except Exception: continue``) — so the entire M4 scheduler output was
    dropped in silence and the planner always saw zero review needs and an empty
    uncertainty map. Nothing errored; the plans were simply wrong.

    ``extra="forbid"`` remains correct for anything INBOUND from an untrusted
    source, which is what :class:`_StrictModel` guards. The direction here is the
    opposite: the host is the authority, these rows are derived views it
    produced, and a field the host adds later is not an attack — dropping the
    row over it is the bug. Tolerating unknown keys also means a host schema bump
    no longer silently degrades the planner, which is what the field docs already
    claimed happened.
    """

    model_config = ConfigDict(
        extra="ignore",
        frozen=True,
        populate_by_name=True,
    )


class SkillProbeKind(StrEnum):
    """M12-05 skill-probe taxonomy.

    Mirrors the Rust :class:`SkillReviewProbe` enum
    (``novel_item`` / ``same_item_retention`` / ``contrastive_pair`` /
    ``coach_micro_drill`` / ``writing_rewrite``). A skill probe targets a SKILL,
    never a specific asset or question id — the learner practises the skill via
    a fresh probe, not a memorised repeat of an original question (M12-05).
    """

    NOVEL_ITEM = "novel_item"
    SAME_ITEM_RETENTION = "same_item_retention"
    CONTRASTIVE_PAIR = "contrastive_pair"
    COACH_MICRO_DRILL = "coach_micro_drill"
    WRITING_REWRITE = "writing_rewrite"


# The fixed set of allowed probe kinds (M12-05). Exposed as a frozenset for the
# orchestrator's allow-list check and for asserting the enum stays at exactly
# five values.
SKILL_PROBE_KINDS: frozenset[str] = frozenset(kind.value for kind in SkillProbeKind)


class QuestionKind(StrEnum):
    """The high-level IELTS question kind a plan item drills.

    Used to pick the probe activity surface. Kept separate from
    :class:`SkillProbeKind` because one probe kind can apply to several
    question kinds (e.g. ``contrastive_pair`` for TFNG or matching headings).
    """

    READING_TFNG = "reading_tfng"
    READING_MATCHING_HEADINGS = "reading_matching_headings"
    READING_MULTIPLE_CHOICE = "reading_multiple_choice"
    READING_SUMMARY = "reading_summary"
    WRITING_TASK1 = "writing_task1"
    WRITING_TASK2 = "writing_task2"
    LISTENING = "listening"
    SPEAKING = "speaking"
    COACH_DRILL = "coach_drill"


class SkillProbe(_StrictModel):
    """M12-05 skill probe descriptor.

    Targets a ``skill_key`` with a ``probe_kind``. Never carries an original
    asset / question id — the learner practises the skill via a fresh probe, not
    a repeat of a memorised item (M12-05). ``avoid_asset_ids`` (sourced from the
    Rust ``SkillReviewNeed.avoid_asset_ids``) lets the host steer the probe
    away from already-seen assets WITHOUT the planner picking a specific asset.
    """

    skill_key: str = Field(min_length=1, max_length=64, alias="skillKey")
    probe_kind: SkillProbeKind = Field(alias="probeKind")
    # Optional assets to AVOID (so the host picks a novel probe surface). Never
    # an asset to REPEAT — that would violate M12-05.
    avoid_asset_ids: list[str] = Field(
        default_factory=list, alias="avoidAssetIds", max_length=32
    )
    # Optional reason codes carried from the Rust SkillReviewNeed (audit trail).
    reason_codes: list[str] = Field(
        default_factory=list, alias="reasonCodes", max_length=16
    )

    @field_validator("avoid_asset_ids", "reason_codes")
    @classmethod
    def _unique_and_non_empty(cls, value: list[str]) -> list[str]:
        seen: set[str] = set()
        for identifier in value:
            if not isinstance(identifier, str) or not identifier.strip():
                raise ValueError("lists must contain non-empty strings")
            if identifier in seen:
                raise ValueError("list entries must be unique")
            seen.add(identifier)
        return list(value)

    def to_wire(self) -> dict[str, Any]:
        return {
            "skillKey": self.skill_key,
            "probeKind": self.probe_kind.value,
            "avoidAssetIds": list(self.avoid_asset_ids),
            "reasonCodes": list(self.reason_codes),
        }


class StudyPlanItem(_StrictModel):
    """A single item in a study-plan proposal (M12-04).

    Answers the four proposal questions for one skill:
      - 今天练什么  → ``skill_probe`` (the skill + probe kind)
      - 为什么      → ``why_text`` (deterministic reason)
      - 用什么题型 → ``question_kind`` (the activity surface)
      - 预计多久   → ``estimated_minutes``
    """

    schema_version: int = Field(
        default=STUDY_PLAN_PROPOSAL_SCHEMA_VERSION, alias="schemaVersion"
    )
    item_id: str = Field(min_length=1, max_length=64, alias="itemId")
    skill_probe: SkillProbe = Field(alias="skillProbe")
    why_text: str = Field(alias="whyText", min_length=1, max_length=2 * 1024)
    estimated_minutes: int = Field(
        alias="estimatedMinutes", ge=1, le=240
    )
    question_kind: QuestionKind = Field(alias="questionKind")

    def to_wire(self) -> dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "itemId": self.item_id,
            "skillProbe": self.skill_probe.to_wire(),
            "whyText": self.why_text,
            "estimatedMinutes": self.estimated_minutes,
            "questionKind": self.question_kind.value,
        }


class StudyPlanProposal(_StrictModel):
    """M12-04 study-plan proposal (first version: proposal only).

    ``plan_id`` is assigned by the Rust ``study_plan.create`` authority on
    persistence. When the host call fails (fail-closed), the orchestrator
    returns a fallback proposal with ``plan_id=""`` and a non-empty
    ``fallback_reason`` — it never raises fatal. A 0-item proposal (empty
    ``items``) is a legitimate "nothing to schedule today" result, NOT a
    fallback (M12-04: deterministic constraints may yield zero items when
    available time is exhausted or no skill review needs are due).
    """

    schema_version: int = Field(
        default=STUDY_PLAN_PROPOSAL_SCHEMA_VERSION, alias="schemaVersion"
    )
    plan_id: str = Field(default="", max_length=64, alias="planId")
    user_goal: str = Field(alias="userGoal", min_length=1, max_length=2 * 1024)
    items: list[StudyPlanItem] = Field(default_factory=list, max_length=32)
    total_estimated_minutes: int = Field(
        default=0, ge=0, le=720, alias="totalEstimatedMinutes"
    )
    fallback_reason: str | None = Field(
        default=None, alias="fallbackReason", max_length=2 * 1024
    )

    @field_validator("items")
    @classmethod
    def _unique_item_ids(cls, value: list[StudyPlanItem]) -> list[StudyPlanItem]:
        seen: set[str] = set()
        for item in value:
            if item.item_id in seen:
                raise ValueError("plan item ids must be unique")
            seen.add(item.item_id)
        return list(value)

    @model_validator(mode="after")
    def _fallback_or_run(self) -> StudyPlanProposal:
        # Recompute the total from items so a caller cannot lie about it.
        computed = sum(item.estimated_minutes for item in self.items)
        if computed != self.total_estimated_minutes:
            raise ValueError(
                "totalEstimatedMinutes must equal the sum of item estimated minutes"
            )
        if self.fallback_reason:
            # Fallback path: no authoritative plan_id, no items.
            if self.plan_id:
                raise ValueError("fallback proposals must not carry a planId")
            if self.items:
                raise ValueError("fallback proposals must not carry items")
            if self.total_estimated_minutes:
                raise ValueError("fallback proposals must not carry minutes")
            return self
        if self.total_estimated_minutes > 0 and not self.items:
            raise ValueError("non-zero minutes require at least one item")
        return self

    def to_wire(self) -> dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "planId": self.plan_id,
            "userGoal": self.user_goal,
            "items": [item.to_wire() for item in self.items],
            "totalEstimatedMinutes": self.total_estimated_minutes,
            "fallbackReason": self.fallback_reason,
        }


class SkillReviewNeed(_HostViewModel):
    """Bounded view of one Rust ``SkillReviewNeed`` row (M4 scheduler).

    Read via ``learning.learner_skill_state`` (the host returns a
    ``SkillReviewNeedsSnapshot``). Python never writes this directly — the Rust
    scheduler is the source of truth. Only the fields the planner needs are
    modelled here; the snapshot envelope is parsed loosely (extra fields the
    host adds are ignored at the row-parse boundary so a host schema bump does
    not force a planner fallback — see ``study_plan._parse_review_needs``).
    """

    skill_key: str = Field(min_length=1, max_length=64, alias="skillKey")
    priority: float = Field(ge=0.0)
    priority_band: str = Field(min_length=1, max_length=32, alias="priorityBand")
    due_at: str = Field(min_length=1, max_length=40, alias="dueAt")
    preferred_probe: SkillProbeKind = Field(alias="preferredProbe")
    avoid_asset_ids: list[str] = Field(
        default_factory=list, alias="avoidAssetIds", max_length=32
    )
    reason_codes: list[str] = Field(
        default_factory=list, alias="reasonCodes", max_length=16
    )
    uncertainty_band: str = Field(
        default="medium", min_length=1, max_length=32, alias="uncertaintyBand"
    )
    mastery_mean: float = Field(default=0.0, ge=0.0, le=1.0, alias="masteryMean")
    evidence_count: int = Field(default=0, ge=0, alias="evidenceCount")


class SkillStateView(_HostViewModel):
    """Bounded view of one Rust ``SkillStateView`` row (M4 model).

    Read via ``learning.learner_skill_state``. Only the fields the planner
    needs (uncertainty + mastery for ordering) are modelled here.
    """

    skill_key: str = Field(min_length=1, max_length=64, alias="skillKey")
    mastery_mean: float = Field(default=0.0, ge=0.0, le=1.0, alias="masteryMean")
    uncertainty: float = Field(default=0.0, ge=0.0, le=1.0, alias="uncertainty")
    uncertainty_band: str = Field(
        default="medium", min_length=1, max_length=32, alias="uncertaintyBand"
    )
    evidence_count: int = Field(default=0, ge=0, alias="evidenceCount")


class PlannerInput(_StrictModel):
    """M12-04 planner input snapshot (frozen, deterministic).

    All fields are plain primitives/str — no host handles, no secrets. The
    planner is deterministic given the inputs: identical inputs ⇒ identical
    proposal (modulo host-assigned plan_id). The caller (Rust) assembles this
    from the thread context + user preferences; Python never reaches into the
    canonical DB to fill it.
    """

    schema_version: int = Field(
        default=PLANNER_INPUT_SCHEMA_VERSION, alias="schemaVersion"
    )
    trace_id: str = Field(min_length=1, max_length=160, alias="traceId")
    user_goal: str = Field(alias="userGoal", min_length=1, max_length=2 * 1024)
    available_minutes: int = Field(
        alias="availableMinutes", ge=0, le=720
    )
    # Skill review needs supplied directly by the caller (already fetched from
    # the Rust host). When empty, the planner may fetch them via
    # ``learning.learner_skill_state`` if the host advertises it.
    skill_review_needs: list[SkillReviewNeed] = Field(
        default_factory=list, alias="skillReviewNeeds", max_length=64
    )
    # Learner uncertainty per skill (0..1). Higher = more uncertain = higher
    # priority when target_date is near. May be empty; the planner falls back
    # to the priority carried on each SkillReviewNeed.
    learner_uncertainty: dict[str, float] = Field(
        default_factory=dict, alias="learnerUncertainty"
    )
    # Recent workload signal: minutes practised in the last N days. Used to
    # avoid over-scheduling on a heavy day (deterministic cap).
    recent_workload_minutes: int = Field(
        default=0, ge=0, le=4 * 60 * 7, alias="recentWorkloadMinutes"
    )
    # User preferences (opaque key→value). The planner only reads
    # ``preferred_activity`` / ``max_session_minutes`` / ``avoid_skills``
    # from this dict; unknown keys are ignored (the caller vouches for them).
    user_preferences: dict[str, Any] = Field(
        default_factory=dict, alias="userPreferences"
    )
    # ISO date the learner is targeting (e.g. an exam date). When present,
    # skills closer to the target date get higher priority. Empty string =
    # no target date (long-term practice).
    target_date: str = Field(default="", max_length=40, alias="targetDate")
    # ISO date the plan is for ("today"). Used to compute target_date distance.
    plan_date: str = Field(default="", max_length=40, alias="planDate")

    @field_validator("learner_uncertainty")
    @classmethod
    def _bounded_uncertainty(cls, value: dict[str, float]) -> dict[str, float]:
        for skill, uncertainty in value.items():
            if not isinstance(skill, str) or not skill.strip():
                raise ValueError("uncertainty keys must be non-empty skill strings")
            if not isinstance(uncertainty, (int, float)):
                raise ValueError("uncertainty values must be numbers")
            if uncertainty < 0.0 or uncertainty > 1.0:
                raise ValueError("uncertainty values must be in [0.0, 1.0]")
        return dict(value)

    @field_validator("skill_review_needs")
    @classmethod
    def _unique_skill_keys(cls, value: list[SkillReviewNeed]) -> list[SkillReviewNeed]:
        seen: set[str] = set()
        for need in value:
            if need.skill_key in seen:
                raise ValueError("skill review needs must have unique skillKeys")
            seen.add(need.skill_key)
        return list(value)


__all__ = [
    "CAPABILITY_CONTEXT_MATERIALIZE",
    "CAPABILITY_LEARNER_SKILL_STATE",
    "CAPABILITY_MEMORY_SEARCH_ACTIVE",
    "CAPABILITY_STUDY_PLAN_CREATE",
    "CAPABILITY_VERSION_CONTEXT_MATERIALIZE",
    "CAPABILITY_VERSION_LEARNER_SKILL_STATE",
    "CAPABILITY_VERSION_MEMORY_SEARCH_ACTIVE",
    "CAPABILITY_VERSION_STUDY_PLAN_CREATE",
    "PLANNER_INPUT_SCHEMA_VERSION",
    "REQUIRED_STUDY_PLANNER_HOST_CAPABILITIES",
    "STUDY_PLAN_PROPOSAL_SCHEMA_VERSION",
    "PlannerInput",
    "QuestionKind",
    "SKILL_PROBE_KINDS",
    "SkillProbe",
    "SkillProbeKind",
    "SkillReviewNeed",
    "SkillStateView",
    "StudyPlanItem",
    "StudyPlanProposal",
]
