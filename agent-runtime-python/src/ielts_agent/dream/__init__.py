"""The M8 Weekly Dream (Python orchestration).

The daily journal is deterministic and built by the Rust host; the daily path
makes no proposals (all memory consolidation is the weekly pass). This package
owns the weekly pass (digest prose and memory mutations):

- :mod:`types` — M7-03/M8 pydantic contracts
  (JournalFacts, JournalEnrichment, WeeklyDigest, WeeklyDreamResult).
- :mod:`weekly` — the weekly-dream orchestrator: ONE model call over the
  host-built pack of the learner's practice records produces both the digest
  prose and the memory mutations; every mutation must cite ids of that pack;
  fail-closed submission to the Rust ``dream.run_weekly`` authority.

The package never touches the canonical SQLite DB or provider secrets. All
facts, memory, and model access goes through the Rust host gateway. The weekly
orchestrator only proposes mutations for the Rust authority to validate and
apply — it never writes memory directly (M8 no-write-bypass).
"""

from __future__ import annotations

from .types import (
    CAPABILITY_DREAM_RUN_WEEKLY,
    CAPABILITY_LEARNING_EVIDENCE_BY_IDS,
    CAPABILITY_LEARNER_SKILL_STATE,
    CAPABILITY_LEARNING_WEEKLY_PACK,
    CAPABILITY_MEMORY_SEARCH_ACTIVE,
    CAPABILITY_MODEL_INVOKE,
    CAPABILITY_VERSION_DREAM_RUN_WEEKLY,
    CAPABILITY_VERSION_LEARNING_EVIDENCE_BY_IDS,
    CAPABILITY_VERSION_LEARNER_SKILL_STATE,
    CAPABILITY_VERSION_LEARNING_WEEKLY_PACK,
    CAPABILITY_VERSION_MEMORY_SEARCH_ACTIVE,
    CAPABILITY_VERSION_MODEL_INVOKE,
    JOURNAL_FACTS_SCHEMA_VERSION,
    MEMORY_ACTIVITIES,
    MEMORY_NAMESPACES,
    REQUIRED_WEEKLY_DREAM_HOST_CAPABILITIES,
    WEEKLY_DREAM_SCHEMA_VERSION,
    WEEKLY_MUTATION_ACTIONS,
    WEEKLY_MUTATION_FIELDS,
    JournalEnrichment,
    JournalFacts,
    JournalMemoryEvent,
    MemoryChangeSummary,
    SkillDelta,
    WeeklyDigest,
    WeeklyDreamResult,
    WritingEvalSummary,
)
from .weekly import (
    DEFAULT_COGNITIVE_DEADLINE_MS as WEEKLY_DREAM_DEFAULT_DEADLINE_MS,
    MAX_MUTATIONS,
    MIN_OBSERVATIONS,
    WeeklyDreamInput,
    WeeklyDreamOrchestrator,
    fallback_result as weekly_fallback_result,
)

__all__ = [
    # capabilities
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
    # schemas
    "JOURNAL_FACTS_SCHEMA_VERSION",
    "MEMORY_ACTIVITIES",
    "MEMORY_NAMESPACES",
    "REQUIRED_WEEKLY_DREAM_HOST_CAPABILITIES",
    "WEEKLY_DREAM_SCHEMA_VERSION",
    "WEEKLY_MUTATION_ACTIONS",
    "WEEKLY_MUTATION_FIELDS",
    # weekly dream
    "WEEKLY_DREAM_DEFAULT_DEADLINE_MS",
    "MAX_MUTATIONS",
    "MIN_OBSERVATIONS",
    "WeeklyDreamInput",
    "WeeklyDreamOrchestrator",
    "weekly_fallback_result",
    # types
    "JournalEnrichment",
    "JournalFacts",
    "JournalMemoryEvent",
    "MemoryChangeSummary",
    "SkillDelta",
    "WeeklyDigest",
    "WeeklyDreamResult",
    "WritingEvalSummary",
]
