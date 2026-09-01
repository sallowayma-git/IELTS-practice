"""M6 Python enhanced coach lane (Slice 2).

This package owns the Python shadow-path personalized coach:
- :mod:`strategies` — the fixed M6-09 strategy catalog + deterministic selector.
- :mod:`types` — M6-04/M6-05/M6-06/M6-10 typed wire contracts.
- :mod:`preference_extractor` — M6-07 preference candidate extractor.
- :mod:`personalized_coach` — the shadow/fallback runtime (M6 Runtime Rule).

The package never touches the canonical SQLite DB or provider secrets. All
memory / learner / model access goes through the Rust host gateway.
"""

from .personalized_coach import (
    CoachFrozenInput,
    CoachShadowResult,
    PythonPersonalizedCoach,
)
from .preference_extractor import (
    PreferenceExtractorInput,
    extract_preference_candidates,
)
from .strategies import (
    STRATEGY_CATALOG,
    CoachStrategyId,
    StrategySelectionInput,
    select_strategy,
)
from .types import (
    CoachFeedback,
    CoachFeedbackKind,
    CoachFollowupType,
    CoachOutcome,
    CoachOutcomeKind,
    CoachStrategyAssignment,
    ReaskLink,
)

__all__ = [
    "STRATEGY_CATALOG",
    "CoachFeedback",
    "CoachFeedbackKind",
    "CoachFollowupType",
    "CoachFrozenInput",
    "CoachOutcome",
    "CoachOutcomeKind",
    "CoachShadowResult",
    "CoachStrategyAssignment",
    "CoachStrategyId",
    "PreferenceExtractorInput",
    "PythonPersonalizedCoach",
    "ReaskLink",
    "StrategySelectionInput",
    "extract_preference_candidates",
    "select_strategy",
]
