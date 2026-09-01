"""M7-08 bounded capacity constants for the daily-dream path.

Hard ceilings are centralized here so no caller can silently bypass the
bounded envelope. The orchestrator applies these to truncate input, reject
excess proposals, cap the LLM token budget, and bound retries. Failure is
fail-closed (M7-08): when capacity is exceeded, input is truncated and the
run continues with a bounded subset; when the host call fails entirely, the
orchestrator returns a fallback result rather than raising.
"""

from __future__ import annotations

from .types import DreamCapacity


# M7-08 hard ceilings. These are the upper bounds; runtime overrides may lower
# them but never raise them (DreamCapacity re-validates the range).
MAX_INPUT_OBSERVATIONS = 200
MAX_ACTIVE_CANDIDATES = 50
MAX_OUTPUT_CANDIDATES = 10
MAX_TOKEN_BUDGET = 4000
MAX_LLM_RETRIES = 1

# Lower bounds for token budget (a useful prompt needs at least this headroom).
MIN_TOKEN_BUDGET = 256


def default_capacity() -> DreamCapacity:
    """The default M7-08 capacity envelope."""
    return DreamCapacity(
        maxInputObservations=MAX_INPUT_OBSERVATIONS,
        maxActiveCandidates=MAX_ACTIVE_CANDIDATES,
        maxOutputCandidates=MAX_OUTPUT_CANDIDATES,
        maxTokenBudget=MAX_TOKEN_BUDGET,
        maxLlmRetries=MAX_LLM_RETRIES,
    )


def truncate_observations(
    observation_ids: list[str], limit: int
) -> list[str]:
    """Bound the input observation list to ``limit`` (M7-08).

    Truncation preserves the most-recent-first ordering the host already
    applies. This is the only mutation the orchestrator performs on input.
    """
    if limit < 0:
        raise ValueError("observation limit must be non-negative")
    return list(observation_ids[:limit])


def truncate_proposals(
    proposals: list, limit: int
) -> list:
    """Bound the output proposal list to ``limit`` (M7-08).

    Excess proposals are rejected (dropped) — the host dream.run_daily
    authority re-validates the bound. We never silently promote past the cap.
    """
    if limit < 0:
        raise ValueError("proposal limit must be non-negative")
    return list(proposals[:limit])


__all__ = [
    "MAX_ACTIVE_CANDIDATES",
    "MAX_INPUT_OBSERVATIONS",
    "MAX_LLM_RETRIES",
    "MAX_OUTPUT_CANDIDATES",
    "MAX_TOKEN_BUDGET",
    "MIN_TOKEN_BUDGET",
    "default_capacity",
    "truncate_observations",
    "truncate_proposals",
]
