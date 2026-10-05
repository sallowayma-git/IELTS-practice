"""Journal enrichment and the M8 Weekly Dream (Python orchestration).

The daily journal is deterministic and built by the Rust host; the daily path
makes no proposals (all memory consolidation is the weekly pass). This package
owns journal enrichment and weekly cross-scope pattern discovery:

- :mod:`types` — M7-03/M8-01/M8-02/M8-05 pydantic contracts
  (JournalFacts, JournalEnrichment, WeeklyPatternProposal, WeeklyDreamResult,
  PatternKind).
- :mod:`journal_enrichment` — M7-04 LLM journal enrichment (title/summary/
  open hypotheses only; numeric facts immutable; private memory redaction;
  deterministic no-LLM path).
- :mod:`weekly` — M8-01 weekly-dream orchestrator (cross-scope pattern
  discovery; stable memory IDs to the LLM; four pattern gates; M8-05 kind
  taxonomy; fail-closed submission to the Rust ``dream.run_weekly`` authority).

The package never touches the canonical SQLite DB or provider secrets. All
facts, memory, and model access goes through the Rust host gateway. The weekly
orchestrator only emits candidate patterns for the Rust authority to validate
and persist — it never writes active memory directly (M8 no-write-bypass).
"""

from __future__ import annotations

from .journal_enrichment import (
    DEFAULT_COGNITIVE_DEADLINE_MS as ENRICHMENT_DEFAULT_DEADLINE_MS,
    EnrichmentInput,
    EnrichmentResult,
    JournalEnricher,
)
from .types import (
    CAPABILITY_DREAM_RUN_WEEKLY,
    CAPABILITY_LEARNING_EVIDENCE_BY_IDS,
    CAPABILITY_LEARNER_SKILL_STATE,
    CAPABILITY_MEMORY_CANDIDATE_POOL,
    CAPABILITY_MEMORY_SEARCH_ACTIVE,
    CAPABILITY_MODEL_INVOKE,
    CAPABILITY_VERSION_DREAM_RUN_WEEKLY,
    CAPABILITY_VERSION_LEARNING_EVIDENCE_BY_IDS,
    CAPABILITY_VERSION_LEARNER_SKILL_STATE,
    CAPABILITY_VERSION_MEMORY_CANDIDATE_POOL,
    CAPABILITY_VERSION_MEMORY_SEARCH_ACTIVE,
    CAPABILITY_VERSION_MODEL_INVOKE,
    FORBIDDEN_PATTERN_KINDS,
    JOURNAL_FACTS_SCHEMA_VERSION,
    PATTERN_KINDS,
    REQUIRED_WEEKLY_DREAM_HOST_CAPABILITIES,
    WEEKLY_DREAM_SCHEMA_VERSION,
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
    # schemas
    "FORBIDDEN_PATTERN_KINDS",
    "JOURNAL_FACTS_SCHEMA_VERSION",
    "PATTERN_KINDS",
    "REQUIRED_WEEKLY_DREAM_HOST_CAPABILITIES",
    "WEEKLY_DREAM_SCHEMA_VERSION",
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
