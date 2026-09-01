"""M5-05 query rewrite + M5-07 typed ContextPlan emission.

The ContextPlanner takes a raw user task + retrieval results and emits a
`ContextPlan` of stable IDs + inclusion reasons. It NEVER emits prompt text —
the Rust ContextMaterializer re-validates every ID, re-authorizes sensitivity,
re-fetches canonical text, injects Soul/policy, and enforces the token ceiling.

Budget allocation follows the plan's priority order:
  CURRENT_TASK > SOUL > explicit user > verified learner/memory > retrieved
  evidence > journal

This module is intentionally free of host calls (the planner operates on already
retrieved candidates). It only needs the retrieval run output + token budget.
"""

from __future__ import annotations

from dataclasses import dataclass

from .types import (
    CONTEXT_PLAN_SCHEMA_VERSION,
    CONTEXT_PLANNER_VERSION,
    ContextPlan,
    ContextSection,
    ContextSectionPlan,
    RetrievalCandidate,
    RetrievalQuery,
)
from .planner import RetrievalResult


# M5-09 initial budget ratios (must sum to 1.0). Tunable, not load-bearing for
# correctness — Rust enforces the hard ceiling regardless of what Python asks for.
DEFAULT_BUDGET_RATIOS: dict[ContextSection, float] = {
    ContextSection.SOUL_POLICY: 0.12,
    ContextSection.CURRENT_TASK: 0.32,
    ContextSection.EXPLICIT_USER: 0.06,
    ContextSection.LEARNER_STATE: 0.16,
    ContextSection.ACTIVE_MEMORY: 0.10,
    ContextSection.RECENT_RELEVANT_EVIDENCE: 0.08,
    ContextSection.RETRIEVED_CORPUS: 0.08,
    ContextSection.RECENT_JOURNAL: 0.0,
    ContextSection.TOOL_RESERVE: 0.08,
    # Note: RECENT_JOURNAL defaults to 0 (M7+ owns it); its 0.08 reallocates to
    # CURRENT_TASK until the journal feed exists. Kept as a section so the Rust
    # side never has to special-case its absence.
}

assert abs(sum(DEFAULT_BUDGET_RATIOS.values()) - 1.0) < 1e-9, "budget ratios must sum to 1.0"

# Per-section ordering priority for truncation when over budget (M5-09).
SECTION_PRIORITY: tuple[ContextSection, ...] = (
    ContextSection.CURRENT_TASK,
    ContextSection.SOUL_POLICY,
    ContextSection.EXPLICIT_USER,
    ContextSection.LEARNER_STATE,
    ContextSection.ACTIVE_MEMORY,
    ContextSection.RECENT_RELEVANT_EVIDENCE,
    ContextSection.RETRIEVED_CORPUS,
    ContextSection.RECENT_JOURNAL,
    ContextSection.TOOL_RESERVE,
)


@dataclass(frozen=True, slots=True)
class ContextTaskInput:
    """The task envelope the planner needs beyond the retrieval query itself."""

    task_kind: str
    current_task_item_ids: list[str]          # stable IDs for the current task body
    explicit_user_item_ids: list[str] | None = None
    learner_state_item_ids: list[str] | None = None
    active_memory_item_ids: list[str] | None = None
    recent_evidence_item_ids: list[str] | None = None
    journal_item_ids: list[str] | None = None
    tool_reserve_item_ids: list[str] | None = None


def rewrite_query(raw_text: str, *, task_kind: str) -> RetrievalQuery:
    """M5-05: normalize + task-aware query construction.

    Synonym/expansion is intentionally minimal here; the plan forbids defaulting
    to vectorizing everything, and over-eager expansion hurts precision. We
    normalize, keep the task_kind, and let the pipeline filter by scope.
    """
    from .lexical import normalize_query  # local import avoids cycle
    normalized = normalize_query(raw_text)
    return RetrievalQuery(
        raw_text=raw_text,
        normalized_text=normalized,
        task_kind=task_kind,
    )


def build_context_plan(
    task: ContextTaskInput,
    retrieval: RetrievalResult,
    *,
    total_token_budget: int,
    budget_ratios: dict[ContextSection, float] | None = None,
) -> ContextPlan:
    """Allocate retrieval + task IDs into a typed ContextPlan.

    Rust owns SOUL_POLICY — Python leaves its item_ids empty and only declares a
    requested budget so the materializer knows the reservation. Everything else
    is filled from task input + retrieval candidates.
    """
    ratios = budget_ratios or DEFAULT_BUDGET_RATIOS

    # Map retrieved candidates into the RETRIEVED_CORPUS section, preserving
    # fused order. RECENT_RELEVANT_EVIDENCE also draws from retrieval but is
    # expected to come from the task input (e.g. same-attempt evidence).
    retrieved_ids = [candidate.chunk_id for candidate in retrieval.candidates]

    section_items: dict[ContextSection, list[str]] = {
        ContextSection.SOUL_POLICY: [],  # Rust injects; Python never fills this
        ContextSection.CURRENT_TASK: list(task.current_task_item_ids),
        ContextSection.EXPLICIT_USER: list(task.explicit_user_item_ids or []),
        ContextSection.LEARNER_STATE: list(task.learner_state_item_ids or []),
        ContextSection.ACTIVE_MEMORY: list(task.active_memory_item_ids or []),
        ContextSection.RECENT_RELEVANT_EVIDENCE: list(task.recent_evidence_item_ids or []),
        ContextSection.RETRIEVED_CORPUS: retrieved_ids,
        ContextSection.RECENT_JOURNAL: list(task.journal_item_ids or []),
        ContextSection.TOOL_RESERVE: list(task.tool_reserve_item_ids or []),
    }

    sections: list[ContextSectionPlan] = []
    inclusion_reasons: dict[str, list[str]] = {}
    ranked: list[str] = []

    for section in SECTION_PRIORITY:
        items = section_items.get(section, [])
        budget = max(0, int(total_token_budget * ratios.get(section, 0.0)))
        reasons = _section_reasons(section, retrieval)
        sections.append(
            ContextSectionPlan(
                section=section,
                item_ids=list(items),
                requested_token_budget=budget,
                inclusion_reasons=reasons,
            )
        )
        for item_id in items:
            if item_id not in inclusion_reasons:
                inclusion_reasons[item_id] = [f"section:{section.value}"]
            ranked.append(item_id)

    # De-duplicate ranked while preserving first-seen order (priority order).
    seen: set[str] = set()
    deduped_ranked: list[str] = []
    for item_id in ranked:
        if item_id in seen:
            continue
        seen.add(item_id)
        deduped_ranked.append(item_id)

    # Enrich inclusion_reasons with retrieval fusion lineage.
    for candidate in retrieval.candidates:
        existing = inclusion_reasons.get(candidate.chunk_id, [])
        merged = list(dict.fromkeys([*existing, *candidate.inclusion_reasons]))
        if merged:
            inclusion_reasons[candidate.chunk_id] = merged

    return ContextPlan(
        schema_version=CONTEXT_PLAN_SCHEMA_VERSION,
        planner_version=CONTEXT_PLANNER_VERSION,
        task_kind=task.task_kind,
        sections=sections,
        ranked_item_ids=deduped_ranked,
        inclusion_reasons=inclusion_reasons,
        requested_token_budget=total_token_budget,
        retrieval_run_ids=[retrieval.run_id],
    )


def _section_reasons(
    section: ContextSection, retrieval: RetrievalResult
) -> list[str]:
    if section is ContextSection.SOUL_POLICY:
        return ["required:rust_injects_soul_policy"]
    if section is ContextSection.RETRIEVED_CORPUS:
        stages = ",".join(retrieval.stages_used) or "retrieval"
        return [f"retrieval:{stages}"]
    return [f"task_input:{section.value}"]


__all__ = [
    "DEFAULT_BUDGET_RATIOS",
    "SECTION_PRIORITY",
    "ContextTaskInput",
    "build_context_plan",
    "rewrite_query",
]
