"""M6-07 Coach Preference Candidate Extractor.

Turns interaction facts (M6-05 feedback, M6-06 re-ask links, M6-04 strategy
metadata, explicit user corrections, selected memory/context) into memory
proposal CANDIDATES in the `preference` namespace.

Hard rules enforced here:
- Only emits candidates. A candidate NEVER auto-promotes to a permanent Soul.
  Promotion requires repeated signal + later better outcomes (M6-07/M6-10).
- Candidates always live in the `preference` namespace with canonical keys of
  the form `preference.coach.<family>` (e.g. `preference.coach.example_first`).
- Candidates reuse the existing M3 memory proposal wire contract (AddProposal).
  They are submitted through the SAME host bridge candidate path — no new
  write path is created. Rust revalidates every ID and persists only pending
  candidates, exactly as for M3.
- Feedback is an interaction fact; one `need_example` is an observation, not a
  preference. The extractor only proposes a candidate when the signal is
  present; confidence/promotion is a separate (Rust-side) concern.
- predicted ≠ observed: candidates never assert themselves as established
  preferences. The AddProposal statement is phrased as a candidate, and Rust
  persists it pending.

The extractor is pure: given the same inputs it returns the same candidate
batch. No host calls inside — submission is the caller's job (see
:func:`submit_preference_candidates`).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..memory_proposals import (
    ActivityScope,
    AddProposal,
    MemoryProposalBatch,
    MemoryNamespace,
)
from .strategies import CoachStrategyId
from .types import CoachFeedbackKind, CoachStrategyAssignment, ReaskLink


PREFERENCE_NAMESPACE = MemoryNamespace.PREFERENCE
PREFERENCE_CANDIDATE_SCHEMA_VERSION = 1

# Fixed map from a feedback signal to the preference family it suggests. The
# extractor never invents a preference family — this table is the closed set.
_FEEDBACK_TO_PREFERENCE: dict[CoachFeedbackKind, str] = {
    CoachFeedbackKind.NEED_EXAMPLE: "preference.coach.example_first",
    CoachFeedbackKind.NEED_STEP_BY_STEP: "preference.coach.step_by_step",
    CoachFeedbackKind.TOO_LONG: "preference.coach.concise",
    CoachFeedbackKind.TOO_SHORT: "preference.coach.detailed",
    CoachFeedbackKind.TOO_ABSTRACT: "preference.coach.concrete",
    CoachFeedbackKind.NOT_RELEVANT: "preference.coach.concise",
    CoachFeedbackKind.STYLE_CORRECTION: "preference.coach.concise",
}

# Fixed map from a SELECTED strategy to the preference family it suggests when
# the learner's feedback indicates the strategy fit well (thumbs_up) or
# indicated a different strategy would fit better (the boosting families above
# already cover that). A thumbs_up on a selected strategy is weak evidence the
# learner prefers that strategy family — still only a candidate.
_STRATEGY_TO_PREFERENCE: dict[CoachStrategyId, str] = {
    CoachStrategyId.EXAMPLE_FIRST: "preference.coach.example_first",
    CoachStrategyId.STEP_BY_STEP: "preference.coach.step_by_step",
    CoachStrategyId.CONTRASTIVE: "preference.coach.contrastive",
    CoachStrategyId.SOCRATIC_PROMPT: "preference.coach.socratic",
    CoachStrategyId.CONCISE_DIRECT: "preference.coach.concise",
    CoachStrategyId.EVIDENCE_FIRST: "preference.coach.evidence_first",
}


@dataclass(frozen=True, slots=True)
class PreferenceExtractorInput:
    """Inputs to the M6-07 candidate extractor.

    All fields are interaction facts or provenance — never asserted preferences.
    """

    activity: str  # "reading" | "writing" (validated by ActivityScope)
    feedback_kinds: frozenset[CoachFeedbackKind] = field(default_factory=frozenset)
    strategy_assignment: CoachStrategyAssignment | None = None
    reask_link: ReaskLink | None = None
    explicit_user_correction: str | None = None
    # Selected memory canonical keys (provenance that the context carried these).
    selected_memory_canonical_keys: tuple[str, ...] = ()
    # Observation ids that ground the candidate (interaction + selected context).
    evidence_observation_ids: tuple[str, ...] = ()


def extract_preference_candidates(
    candidate_input: PreferenceExtractorInput,
) -> MemoryProposalBatch:
    """Produce a bounded batch of preference memory-proposal CANDIDATES.

    The batch only contains AddProposal entries in the `preference` namespace.
    Each candidate is grounded in at least one observation id (the extractor
    requires non-empty evidence so Rust never persists an ungrounded candidate).

    Determinism: identical input ⇒ identical batch (stable ordering by family).
    No candidate is promoted — Rust stores them pending.
    """
    if not candidate_input.evidence_observation_ids:
        # Without grounding evidence we must not emit a preference candidate —
        # an ungrounded preference is exactly the truth-coupling the plan
        # forbids. Return an empty batch (not an error): the no-feedback path
        # still works.
        return MemoryProposalBatch(
            schema_version=PREFERENCE_CANDIDATE_SCHEMA_VERSION,
            proposals=(),
        )

    activity = _validated_activity(candidate_input.activity)
    scope = ActivityScope(key=activity)  # type: ignore[arg-type]
    evidence = tuple(candidate_input.evidence_observation_ids)

    families: dict[str, str] = {}  # canonical_key -> candidate statement

    # 1. Feedback-driven candidates (interaction fact → candidate family).
    for feedback_kind in sorted(candidate_input.feedback_kinds, key=lambda k: k.value):
        family = _FEEDBACK_TO_PREFERENCE.get(feedback_kind)
        if family is not None and family not in families:
            families[family] = _candidate_statement(
                family, feedback_kind.value, "feedback"
            )

    # 2. Strategy-driven candidate from a thumbs_up on the selected strategy.
    if (
        candidate_input.strategy_assignment is not None
        and CoachFeedbackKind.THUMBS_UP in candidate_input.feedback_kinds
    ):
        strategy_id = CoachStrategyId(candidate_input.strategy_assignment.strategy_id)
        family = _STRATEGY_TO_PREFERENCE.get(strategy_id)
        if family is not None and family not in families:
            families[family] = _candidate_statement(
                family, strategy_id.value, "thumbs_up_on_strategy"
            )

    # 3. Re-ask of the same question ⇒ candidate for the socratic / example
    #    families (the learner needs the misconception surfaced or re-anchored).
    if candidate_input.reask_link is not None:
        for family in ("preference.coach.socratic", "preference.coach.example_first"):
            if family not in families:
                families[family] = _candidate_statement(
                    family, "reask_same_question", "reask"
                )

    # 4. Explicit user correction text is recorded as a candidate statement
    #    override ONLY when it maps to a known family. Free-form text is never
    #    stored as a preference canonical key — it stays an observation.
    if candidate_input.explicit_user_correction:
        # We do not parse free text into a new family (closed catalog). The
        # correction is already captured as an observation by the M3 path; here
        # we only add a preference.coach.* candidate if a feedback family also
        # fired. No-op otherwise.
        pass

    proposals: list[AddProposal] = []
    for canonical_key in sorted(families):
        proposals.append(
            AddProposal(
                namespace=PREFERENCE_NAMESPACE,
                canonical_key=canonical_key,
                scope=scope,
                statement=families[canonical_key],
                evidence_observation_ids=evidence,
            )
        )

    return MemoryProposalBatch(
        schema_version=PREFERENCE_CANDIDATE_SCHEMA_VERSION,
        proposals=tuple(proposals),
    )


def submit_preference_candidates(
    bridge: Any,
    *,
    batch: MemoryProposalBatch,
    trace_id: str,
    deadline_ms: int,
    started_at: float,
) -> dict[str, Any]:
    """Submit preference candidates through the EXISTING host candidate path.

    This reuses the M3 memory candidate submission capability (no new write
    path). The host revalidates every id and persists candidates as PENDING —
    promotion to active/preference Soul is a separate, Rust-owned gate.
    """
    return bridge.invoke(
        "memory.candidates.submit",
        {"batch": batch.to_wire()},
        trace_id=trace_id,
        deadline_ms=deadline_ms,
        started_at=started_at,
    )


def _candidate_statement(family: str, signal: str, signal_kind: str) -> str:
    """Phrased as a CANDIDATE, never an established preference."""
    return (
        f"Candidate preference {family} suggested by {signal_kind}={signal}. "
        "Promotion requires repeated signal plus later better outcomes."
    )


def _validated_activity(activity: str) -> Any:
    if activity not in ("reading", "writing"):
        raise ValueError(f"activity must be 'reading' or 'writing', got {activity!r}")
    from ..memory_proposals import Activity

    return Activity(activity)


__all__ = [
    "PREFERENCE_CANDIDATE_SCHEMA_VERSION",
    "PREFERENCE_NAMESPACE",
    "PreferenceExtractorInput",
    "extract_preference_candidates",
    "submit_preference_candidates",
]
