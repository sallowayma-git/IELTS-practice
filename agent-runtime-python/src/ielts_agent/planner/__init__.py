"""M12-04 Study Planner package (Slice 2 / Python side).

Python owns the **planner orchestration**: it reads bounded learner/memory
facts via the Rust host gateway (M4 learner skill state + M3/M5 memory
context), produces a deterministic study-plan proposal (today practice what /
why / which skill probe / how long), and submits it via ``study_plan.create`` —
Rust is the controlled-actions authority and the only writer of canonical
study-plan state.

Hard boundaries (M12 plan §9204-9384):

- **M12-04 first version = proposal only.** No active-memory write bypass.
- **M12-05 skill probe, not exact question.** A plan item targets a skill, not
  a memorised item.
- **M12-06 forbidden tools.** This package never touches the canonical DB
  (the forbidden stdlib DB driver), the filesystem, provider secrets, prompt
  mutation, or schema migration.
- **no-LLM path + fail-closed.** Host failure → fallback proposal, never fatal.
- **M3 gate.** This package does not touch the canonical SQLite DB.
"""

from __future__ import annotations

from .study_plan import (
    DEFAULT_COGNITIVE_DEADLINE_MS,
    DEFAULT_PROBE_MINUTES,
    MAX_PROPOSAL_ITEMS,
    MIN_PROBE_MINUTES,
    PlannerRunInput,
    StudyPlannerOrchestrator,
    fallback_result,
)
from .types import (
    CAPABILITY_CONTEXT_MATERIALIZE,
    CAPABILITY_LEARNER_SKILL_STATE,
    CAPABILITY_MEMORY_SEARCH_ACTIVE,
    CAPABILITY_STUDY_PLAN_CREATE,
    CAPABILITY_VERSION_CONTEXT_MATERIALIZE,
    CAPABILITY_VERSION_LEARNER_SKILL_STATE,
    CAPABILITY_VERSION_MEMORY_SEARCH_ACTIVE,
    CAPABILITY_VERSION_STUDY_PLAN_CREATE,
    PLANNER_INPUT_SCHEMA_VERSION,
    REQUIRED_STUDY_PLANNER_HOST_CAPABILITIES,
    SKILL_PROBE_KINDS,
    STUDY_PLAN_PROPOSAL_SCHEMA_VERSION,
    PlannerInput,
    QuestionKind,
    SkillProbe,
    SkillProbeKind,
    SkillReviewNeed,
    SkillStateView,
    StudyPlanItem,
    StudyPlanProposal,
)

__all__ = [
    "CAPABILITY_CONTEXT_MATERIALIZE",
    "CAPABILITY_LEARNER_SKILL_STATE",
    "CAPABILITY_MEMORY_SEARCH_ACTIVE",
    "CAPABILITY_STUDY_PLAN_CREATE",
    "CAPABILITY_VERSION_CONTEXT_MATERIALIZE",
    "CAPABILITY_VERSION_LEARNER_SKILL_STATE",
    "CAPABILITY_VERSION_MEMORY_SEARCH_ACTIVE",
    "CAPABILITY_VERSION_STUDY_PLAN_CREATE",
    "DEFAULT_COGNITIVE_DEADLINE_MS",
    "DEFAULT_PROBE_MINUTES",
    "MAX_PROPOSAL_ITEMS",
    "MIN_PROBE_MINUTES",
    "PLANNER_INPUT_SCHEMA_VERSION",
    "PlannerInput",
    "PlannerRunInput",
    "QuestionKind",
    "REQUIRED_STUDY_PLANNER_HOST_CAPABILITIES",
    "SKILL_PROBE_KINDS",
    "STUDY_PLAN_PROPOSAL_SCHEMA_VERSION",
    "SkillProbe",
    "SkillProbeKind",
    "SkillReviewNeed",
    "SkillStateView",
    "StudyPlanItem",
    "StudyPlanProposal",
    "StudyPlannerOrchestrator",
    "fallback_result",
]
