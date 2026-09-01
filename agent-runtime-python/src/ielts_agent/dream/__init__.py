"""M7 Daily Journal + Daily Dream v1 + M8 Weekly Dream (Slice 2 / Python orchestration).

This package owns the Python daily-dream orchestration, journal enrichment,
and weekly cross-scope pattern discovery:

- :mod:`types` — M7-03/M7-07/M7-08/M8-01/M8-02/M8-05 pydantic contracts
  (JournalFacts, DreamProposal, DailyDreamResult, DreamCapacity,
  JournalEnrichment, WeeklyPatternProposal, WeeklyDreamResult, PatternKind).
- :mod:`capacity` — M7-08 bounded capacity constants + truncation helpers.
- :mod:`daily_dream` — M7-06 daily-dream orchestrator (today-scoped facts
  via the host gateway, bounded proposals, fail-closed submission to the
  Rust ``dream.run_daily`` authority).
- :mod:`journal_enrichment` — M7-04 LLM journal enrichment (title/summary/
  open hypotheses only; numeric facts immutable; private memory redaction;
  deterministic no-LLM path).
- :mod:`weekly` — M8-01 weekly-dream orchestrator (cross-scope pattern
  discovery; stable memory IDs to the LLM; four pattern gates; M8-05 kind
  taxonomy; fail-closed submission to the Rust ``dream.run_weekly`` authority).

The package never touches the canonical SQLite DB or provider secrets. All
facts, memory, and model access goes through the Rust host gateway. The
orchestrators only emit candidate proposals for the Rust authority to
persist — they never write active memory directly (M7/M8 no-write-bypass).
"""

from __future__ import annotations

from .capacity import (
    MAX_ACTIVE_CANDIDATES,
    MAX_INPUT_OBSERVATIONS,
    MAX_LLM_RETRIES,
    MAX_OUTPUT_CANDIDATES,
    MAX_TOKEN_BUDGET,
    MIN_TOKEN_BUDGET,
    default_capacity,
    truncate_observations,
    truncate_proposals,
)
from .daily_dream import (
    DEFAULT_COGNITIVE_DEADLINE_MS as DAILY_DREAM_DEFAULT_DEADLINE_MS,
    DailyDreamOrchestrator,
    DreamRunInput,
    fallback_result,
)
from .journal_enrichment import (
    DEFAULT_COGNITIVE_DEADLINE_MS as ENRICHMENT_DEFAULT_DEADLINE_MS,
    EnrichmentInput,
    EnrichmentResult,
    JournalEnricher,
)
from .types import (
    CAPABILITY_DREAM_RUN_DAILY,
    CAPABILITY_DREAM_RUN_WEEKLY,
    CAPABILITY_JOURNAL_BUILD_DAILY,
    CAPABILITY_LEARNING_EVIDENCE_BY_IDS,
    CAPABILITY_LEARNER_SKILL_STATE,
    CAPABILITY_MEMORY_CANDIDATE_POOL,
    CAPABILITY_MEMORY_SEARCH_ACTIVE,
    CAPABILITY_MODEL_INVOKE,
    CAPABILITY_VERSION_DREAM_RUN_DAILY,
    CAPABILITY_VERSION_DREAM_RUN_WEEKLY,
    CAPABILITY_VERSION_JOURNAL_BUILD_DAILY,
    CAPABILITY_VERSION_LEARNING_EVIDENCE_BY_IDS,
    CAPABILITY_VERSION_LEARNER_SKILL_STATE,
    CAPABILITY_VERSION_MEMORY_CANDIDATE_POOL,
    CAPABILITY_VERSION_MEMORY_SEARCH_ACTIVE,
    CAPABILITY_VERSION_MODEL_INVOKE,
    DAILY_DREAM_SCHEMA_VERSION,
    DREAM_PROPOSAL_KINDS,
    FORBIDDEN_PATTERN_KINDS,
    JOURNAL_FACTS_SCHEMA_VERSION,
    PATTERN_KINDS,
    REQUIRED_DAILY_DREAM_HOST_CAPABILITIES,
    REQUIRED_WEEKLY_DREAM_HOST_CAPABILITIES,
    WEEKLY_DREAM_SCHEMA_VERSION,
    DailyDreamResult,
    DreamCapacity,
    DreamProposal,
    DreamProposalKind,
    JournalEnrichment,
    JournalFacts,
    JournalMemoryEvent,
    MemoryChangeSummary,
    PatternKind,
    SkillDelta,
    WeeklyDreamResult,
    WeeklyPatternProposal,
    WritingEvalSummary,
)
from .weekly import (
    DEFAULT_COGNITIVE_DEADLINE_MS as WEEKLY_DREAM_DEFAULT_DEADLINE_MS,
    MAX_RAW_PATTERNS,
    MIN_CANDIDATE_POOL,
    MIN_SUPPORTING_MEMORY_IDS,
    WeeklyDreamInput,
    WeeklyDreamOrchestrator,
    fallback_result as weekly_fallback_result,
)

__all__ = [
    # capabilities
    "CAPABILITY_DREAM_RUN_DAILY",
    "CAPABILITY_DREAM_RUN_WEEKLY",
    "CAPABILITY_JOURNAL_BUILD_DAILY",
    "CAPABILITY_LEARNING_EVIDENCE_BY_IDS",
    "CAPABILITY_LEARNER_SKILL_STATE",
    "CAPABILITY_MEMORY_CANDIDATE_POOL",
    "CAPABILITY_MEMORY_SEARCH_ACTIVE",
    "CAPABILITY_MODEL_INVOKE",
    "CAPABILITY_VERSION_DREAM_RUN_DAILY",
    "CAPABILITY_VERSION_DREAM_RUN_WEEKLY",
    "CAPABILITY_VERSION_JOURNAL_BUILD_DAILY",
    "CAPABILITY_VERSION_LEARNING_EVIDENCE_BY_IDS",
    "CAPABILITY_VERSION_LEARNER_SKILL_STATE",
    "CAPABILITY_VERSION_MEMORY_CANDIDATE_POOL",
    "CAPABILITY_VERSION_MEMORY_SEARCH_ACTIVE",
    "CAPABILITY_VERSION_MODEL_INVOKE",
    # schemas
    "DAILY_DREAM_SCHEMA_VERSION",
    "DREAM_PROPOSAL_KINDS",
    "FORBIDDEN_PATTERN_KINDS",
    "JOURNAL_FACTS_SCHEMA_VERSION",
    "PATTERN_KINDS",
    "REQUIRED_DAILY_DREAM_HOST_CAPABILITIES",
    "REQUIRED_WEEKLY_DREAM_HOST_CAPABILITIES",
    "WEEKLY_DREAM_SCHEMA_VERSION",
    # capacity
    "MAX_ACTIVE_CANDIDATES",
    "MAX_INPUT_OBSERVATIONS",
    "MAX_LLM_RETRIES",
    "MAX_OUTPUT_CANDIDATES",
    "MAX_TOKEN_BUDGET",
    "MIN_TOKEN_BUDGET",
    "default_capacity",
    "truncate_observations",
    "truncate_proposals",
    # daily dream
    "DAILY_DREAM_DEFAULT_DEADLINE_MS",
    "DailyDreamOrchestrator",
    "DreamRunInput",
    "fallback_result",
    # enrichment
    "ENRICHMENT_DEFAULT_DEADLINE_MS",
    "EnrichmentInput",
    "EnrichmentResult",
    "JournalEnricher",
    # weekly dream
    "WEEKLY_DREAM_DEFAULT_DEADLINE_MS",
    "MAX_RAW_PATTERNS",
    "MIN_CANDIDATE_POOL",
    "MIN_SUPPORTING_MEMORY_IDS",
    "WeeklyDreamInput",
    "WeeklyDreamOrchestrator",
    "weekly_fallback_result",
    # types
    "DailyDreamResult",
    "DreamCapacity",
    "DreamProposal",
    "DreamProposalKind",
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
