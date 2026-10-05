"""Python-first cognitive runtime bootstrap.

The bootstrap owns no canonical IELTS data. It only negotiates a bounded
framed protocol; facts and mutations remain Rust host capabilities.
"""

from .protocol import PROTOCOL_VERSION, RuntimeMetadata
from .coach import (
    CoachShadowResult,
    PythonPersonalizedCoach,
    select_strategy,
)
from .dream import (
    JournalEnricher,
    WeeklyDreamInput,
    WeeklyDreamOrchestrator,
)

__all__ = [
    "PROTOCOL_VERSION",
    "RuntimeMetadata",
    "CoachShadowResult",
    "PythonPersonalizedCoach",
    "select_strategy",
    "JournalEnricher",
    "WeeklyDreamInput",
    "WeeklyDreamOrchestrator",
]
