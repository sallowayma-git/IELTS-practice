"""M6-09 fixed coach strategy catalog.

The plan forbids letting the LLM invent strategies. This module exposes a fixed
set of strategy ids + selection heuristics. M6 only SELECTS and RECORDS the
chosen strategy — it does NOT learn weights (that is M10).

Catalog (frozen):
- evidence_first_v1   : lead with observed evidence before rule statement
- example_first_v1    : lead with a concrete worked example
- step_by_step_v1     : decompose into ordered sub-steps
- contrastive_v1      : contrast the learner's mistake against the correct form
- socratic_prompt_v1  : ask a guiding question that surfaces the misconception
- concise_direct_v1   : short, direct correction with no preamble

Selection is deterministic given the inputs (learner skill state / memory /
feedback signals). Two identical inputs must always yield the same strategyId.
Heuristics are intentionally simple, rule-based, and side-effect free.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Mapping

from .types import CoachFeedbackKind


class CoachStrategyId(StrEnum):
    """Fixed M6-09 strategy catalog. No LLM-authored ids allowed."""

    EVIDENCE_FIRST = "evidence_first_v1"
    EXAMPLE_FIRST = "example_first_v1"
    STEP_BY_STEP = "step_by_step_v1"
    CONTRASTIVE = "contrastive_v1"
    SOCRATIC_PROMPT = "socratic_prompt_v1"
    CONCISE_DIRECT = "concise_direct_v1"


# Catalog freeze: the set of selectable ids must never grow at runtime. Tests
# assert equality against this tuple so a new strategy cannot slip in without a
# deliberate catalog bump.
STRATEGY_CATALOG: tuple[CoachStrategyId, ...] = (
    CoachStrategyId.EVIDENCE_FIRST,
    CoachStrategyId.EXAMPLE_FIRST,
    CoachStrategyId.STEP_BY_STEP,
    CoachStrategyId.CONTRASTIVE,
    CoachStrategyId.SOCRATIC_PROMPT,
    CoachStrategyId.CONCISE_DIRECT,
)


@dataclass(frozen=True, slots=True)
class StrategyDescriptor:
    """Static description + selection heuristic for one catalog strategy."""

    strategy_id: CoachStrategyId
    description: str
    # Ordered priority list of feedback signals that boost this strategy.
    boosting_feedback: frozenset[CoachFeedbackKind]
    # Skill-family prefixes (e.g. "reading.tfng") where this strategy is the
    # default starting point.
    default_skill_prefixes: frozenset[str]

    def matches_feedback(self, feedback_kinds: frozenset[CoachFeedbackKind]) -> bool:
        return bool(self.boosting_feedback & feedback_kinds)


# Descriptors are module-level constants — M6 does not mutate them. M10 will
# introduce learned weights on top of this same catalog, never replace it.
_CATALOG: dict[CoachStrategyId, StrategyDescriptor] = {
    CoachStrategyId.EVIDENCE_FIRST: StrategyDescriptor(
        strategy_id=CoachStrategyId.EVIDENCE_FIRST,
        description=(
            "Lead with observed learner evidence (the attempt's own data) "
            "before stating the rule, so the rule is grounded in the learner's "
            "actual performance. Also the grounded fallback when no other "
            "strategy family matches."
        ),
        boosting_feedback=frozenset({CoachFeedbackKind.TOO_ABSTRACT}),
        # No skill-family default — evidence_first is the grounded fallback.
        # A skill family must opt into a more specific strategy below.
        default_skill_prefixes=frozenset(),
    ),
    CoachStrategyId.EXAMPLE_FIRST: StrategyDescriptor(
        strategy_id=CoachStrategyId.EXAMPLE_FIRST,
        description=(
            "Lead with a concrete worked example drawn from the corpus, then "
            "generalize. Useful when the learner needs an anchor instance."
        ),
        boosting_feedback=frozenset(
            {CoachFeedbackKind.NEED_EXAMPLE, CoachFeedbackKind.REASK_SAME_QUESTION}
        ),
        default_skill_prefixes=frozenset({"writing.task1", "writing.task2"}),
    ),
    CoachStrategyId.STEP_BY_STEP: StrategyDescriptor(
        strategy_id=CoachStrategyId.STEP_BY_STEP,
        description=(
            "Decompose the skill into ordered sub-steps and walk through each. "
            "Best for multi-step procedures where skipping a step causes error."
        ),
        boosting_feedback=frozenset({CoachFeedbackKind.NEED_STEP_BY_STEP}),
        default_skill_prefixes=frozenset({"reading.matching", "writing.task1"}),
    ),
    CoachStrategyId.CONTRASTIVE: StrategyDescriptor(
        strategy_id=CoachStrategyId.CONTRASTIVE,
        description=(
            "Contrast the learner's specific mistake against the correct form, "
            "highlighting the distinguishing feature. Best for near-miss errors."
        ),
        boosting_feedback=frozenset({CoachFeedbackKind.INCORRECT}),
        default_skill_prefixes=frozenset({"reading.tfng"}),
    ),
    CoachStrategyId.SOCRATIC_PROMPT: StrategyDescriptor(
        strategy_id=CoachStrategyId.SOCRATIC_PROMPT,
        description=(
            "Ask a guiding question that surfaces the underlying misconception "
            "rather than stating the answer. Used when the learner is close."
        ),
        boosting_feedback=frozenset({CoachFeedbackKind.REASK_SAME_QUESTION}),
        default_skill_prefixes=frozenset({"reading.inference"}),
    ),
    CoachStrategyId.CONCISE_DIRECT: StrategyDescriptor(
        strategy_id=CoachStrategyId.CONCISE_DIRECT,
        description=(
            "Short, direct correction with no preamble. Used when the learner "
            "signals the explanation was too long or already understands context."
        ),
        boosting_feedback=frozenset(
            {CoachFeedbackKind.TOO_LONG, CoachFeedbackKind.NOT_RELEVANT}
        ),
        default_skill_prefixes=frozenset({"reading.detail"}),
    ),
}


def catalog() -> tuple[StrategyDescriptor, ...]:
    """Return the frozen strategy catalog in stable order."""
    return tuple(_CATALOG[sid] for sid in STRATEGY_CATALOG)


def get_descriptor(strategy_id: CoachStrategyId) -> StrategyDescriptor:
    """Fetch a descriptor by id. Unknown ids raise (catalog is closed)."""
    if strategy_id not in _CATALOG:
        raise KeyError(f"strategy {strategy_id!r} is not in the M6 catalog")
    return _CATALOG[strategy_id]


def is_known_strategy(strategy_id: str) -> bool:
    """Validate a raw id against the closed catalog (no LLM-invented ids)."""
    try:
        CoachStrategyId(strategy_id)
    except ValueError:
        return False
    return True


@dataclass(frozen=True, slots=True)
class StrategySelectionInput:
    """Deterministic inputs to strategy selection.

    All fields are plain primitives/str — no host handles, no secrets. The
    selector is pure: identical inputs ⇒ identical selected strategy.
    """

    skills_addressed: tuple[str, ...]
    # Learner skill proficiency per skill, in [0.0, 1.0]. Missing ⇒ 0.5 (mid).
    skill_proficiencies: Mapping[str, float]
    # Active memory canonical keys selected into the context (provenance only).
    memory_canonical_keys: tuple[str, ...]
    # Feedback kinds observed on PRIOR turns for this learner (M6-05 facts).
    prior_feedback_kinds: frozenset[CoachFeedbackKind]
    # True when the most recent interaction was an explicit re-ask of the same
    # question (M6-06 ReaskLink), independent of feedback_kind.
    is_reask: bool


def select_strategy(selection_input: StrategySelectionInput) -> CoachStrategyId:
    """Deterministically pick a strategy from the catalog (M6-09).

    Selection order (first match wins):
      1. explicit feedback boost — a prior feedback kind that maps to a strategy
         (e.g. NEED_EXAMPLE ⇒ example_first_v1).
      2. re-ask without a specific feedback boost ⇒ socratic_prompt_v1 (surface
         the misconception) — but only when no higher-priority feedback matched.
      3. skill-family default — the catalog default for the skill prefix.
      4. proficiency-based nudge — very low proficiency ⇒ step_by_step_v1;
         very high proficiency ⇒ concise_direct_v1.
      5. fallback — evidence_first_v1 (ground explanations in observed evidence).

    No weights are learned or stored. M6 records the choice; M10 reads it.
    """
    feedback = selection_input.prior_feedback_kinds

    # 1. Feedback-driven boost (deterministic priority order over the catalog).
    for strategy_id in STRATEGY_CATALOG:
        descriptor = _CATALOG[strategy_id]
        if descriptor.matches_feedback(feedback):
            return strategy_id

    # 2. Explicit re-ask with no other feedback signal.
    if selection_input.is_reask:
        return CoachStrategyId.SOCRATIC_PROMPT

    # 3. Skill-family default.
    for skill in selection_input.skills_addressed:
        prefix = _skill_prefix(skill)
        for strategy_id in STRATEGY_CATALOG:
            descriptor = _CATALOG[strategy_id]
            if prefix in descriptor.default_skill_prefixes:
                return strategy_id

    # 4. Proficiency nudge.
    proficiencies = [
        selection_input.skill_proficiencies.get(skill, 0.5)
        for skill in selection_input.skills_addressed
    ]
    if proficiencies:
        avg = sum(proficiencies) / len(proficiencies)
        if avg <= 0.25:
            return CoachStrategyId.STEP_BY_STEP
        if avg >= 0.85:
            return CoachStrategyId.CONCISE_DIRECT

    # 5. Grounded fallback.
    return CoachStrategyId.EVIDENCE_FIRST


def _skill_prefix(skill: str) -> str:
    """Return the skill family prefix (e.g. 'reading.tfng' from 'reading.tfng.false_vs_not_given')."""
    parts = skill.split(".")
    if len(parts) >= 2:
        return ".".join(parts[:2])
    return skill


__all__ = [
    "STRATEGY_CATALOG",
    "CoachStrategyId",
    "StrategyDescriptor",
    "StrategySelectionInput",
    "catalog",
    "get_descriptor",
    "is_known_strategy",
    "select_strategy",
]
