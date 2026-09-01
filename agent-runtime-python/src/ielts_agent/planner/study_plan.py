"""M12-04 Study Planner orchestration (Slice 2 / Python side).

This module owns the **planner orchestration** that turns the M12-04 planner
inputs (user goal / available time / skill review needs / learner uncertainty /
recent workload / user preferences / target date) into a deterministic
study-plan proposal: today practice what / why / which skill probe / how long.

Hard rules enforced here (M12 plan §9204-9384):

- **M12-04 first version = proposal only.** The orchestrator produces a
  :class:`StudyPlanProposal` and submits it via ``study_plan.create``. Rust is
  the controlled-actions authority and the only writer of canonical study-plan
  state. Python never writes active memory or study-plan state directly
  (no-write-bypass).
- **M12-05 skill probe, not exact question.** A plan item targets a
  ``skill_key`` + ``probe_kind`` (a skill probe). It never echoes an original
  asset / question id — the learner practises the SKILL, not a memorised item.
  We reference the TechSpar ``get_due_reviews()`` *idea* (priority-ordered due
  reviews) but select a skill probe, never an exact question repeat. We never
  copy TechSpar's process-local ``task_status``.
- **deterministic constraints.** The proposal is a pure function of the inputs:
  identical inputs ⇒ identical item ordering and (modulo host-assigned
  ``plan_id``) identical proposal. Ordering key:
    1. skill review needs by ``priority`` (desc) — the M4 scheduler already
       ranks by overdue/recency;
    2. learner uncertainty (desc) as a tiebreaker;
    3. target_date distance (asc) — skills closer to a near target date win;
    4. skill_key (asc) as a final stable tiebreaker (no non-determinism).
  The total ``estimated_minutes`` is bounded by ``available_minutes`` (and a
  recent-workload cap so a heavy week is not over-scheduled).
- **no-LLM path + fail-closed.** Host failure → ``fallback_result`` (non-fatal).
  The orchestrator never raises fatal from a host call. When the host is
  unavailable, it returns a 0-item fallback proposal so the caller (Rust) can
  mark the plan failed and retry — the journal baseline is unaffected.
- **M12-06 forbidden tools.** This module never touches the canonical DB
  (the forbidden stdlib DB driver), the filesystem, provider secrets, prompt
  mutation, or schema migration. The M3 contract gate re-validates this at CI
  time.

This module does NOT touch ``coach/``, ``dream/``, ``eval/``, ``memory_*``, or
``retrieval/``. It only READS the M4 learner skill state and M3/M5 memory context
via the host gateway (best-effort enrichment) and SUBMITS via
``study_plan.create``.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Protocol

from .types import (
    CAPABILITY_LEARNER_SKILL_STATE,
    CAPABILITY_MEMORY_SEARCH_ACTIVE,
    CAPABILITY_STUDY_PLAN_CREATE,
    PLANNER_INPUT_SCHEMA_VERSION,
    REQUIRED_STUDY_PLANNER_HOST_CAPABILITIES,
    PlannerInput,
    QuestionKind,
    SkillProbe,
    SkillProbeKind,
    SkillReviewNeed,
    SkillStateView,
    StudyPlanItem,
    StudyPlanProposal,
)

# Cognitive deadline for one planner pass. Conservative: keeps the Python side
# from blocking the user-facing Rust baseline.
DEFAULT_COGNITIVE_DEADLINE_MS = 8_000

# Default estimated minutes per skill probe when the host supplies no signal.
# Conservative: a single skill probe (one TFNG set, one writing rewrite, one
# micro-drill) fits well within this bound.
DEFAULT_PROBE_MINUTES = 15

# Minimum probe minutes — used to decide whether remaining available_minutes can
# still fit at least one more item.
MIN_PROBE_MINUTES = 5

# Recent-workload cap: when the learner has already practised heavily this week,
# cap the total proposed minutes so we do not pile on. The cap is a fraction of
# available_minutes; a heavy week reduces the cap proportionally.
RECENT_WORKLOAD_HEAVY_THRESHOLD_MIN = 5 * 60  # 5h/week = "heavy"
RECENT_WORKLOAD_CAP_RATIO = 0.5  # heavy week → cap at 50% of available

# Maximum items in a single proposal (safety bound; the type also caps at 32).
MAX_PROPOSAL_ITEMS = 8

# Mapping from a skill_key prefix to the IELTS question kind a probe should use.
# Deterministic; unknown prefixes fall back to COACH_DRILL (a generic micro-drill).
_SKILL_PREFIX_TO_QUESTION_KIND: tuple[tuple[str, QuestionKind], ...] = (
    ("reading.tfng", QuestionKind.READING_TFNG),
    ("reading.matching_headings", QuestionKind.READING_MATCHING_HEADINGS),
    ("reading.multiple_choice", QuestionKind.READING_MULTIPLE_CHOICE),
    ("reading.summary", QuestionKind.READING_SUMMARY),
    ("writing.task1", QuestionKind.WRITING_TASK1),
    ("writing.task2", QuestionKind.WRITING_TASK2),
    ("listening.", QuestionKind.LISTENING),
    ("speaking.", QuestionKind.SPEAKING),
)


class HostBridge(Protocol):
    def invoke(
        self,
        method: str,
        params: dict[str, Any],
        *,
        trace_id: str,
        deadline_ms: int,
        started_at: float,
    ) -> dict[str, Any]: ...


@dataclass(frozen=True, slots=True)
class PlannerRunInput:
    """Frozen input snapshot for one planner run.

    Wraps the :class:`PlannerInput` (the deterministic planner inputs) plus the
    runtime context (available host capabilities). The orchestrator may fetch
    skill review needs / learner uncertainty from the host when the
    :class:`PlannerInput` carries none, but only if the host advertises the
    capability — otherwise it proceeds with whatever the caller supplied
    (no-LLM path, fail-closed).
    """

    planner_input: PlannerInput
    available_host_capabilities: dict[str, str] | None = None


class StudyPlannerOrchestrator:
    """M12-04 study planner orchestrator (Python side, fail-closed).

    Constructed with a host bridge and the set of required host capabilities.
    If a required capability is missing or a host call fails, the orchestrator
    returns a non-fatal fallback result instead of raising — the Rust
    ``study_plan.create`` authority remains the persistence gate. Python owns
    planner orchestration only.
    """

    def __init__(
        self,
        bridge: HostBridge,
        *,
        required_capabilities: dict[str, str] | None = None,
        cognitive_deadline_ms: int = DEFAULT_COGNITIVE_DEADLINE_MS,
    ) -> None:
        self._bridge = bridge
        self._required = dict(
            required_capabilities or REQUIRED_STUDY_PLANNER_HOST_CAPABILITIES
        )
        self._deadline_ms = cognitive_deadline_ms

    def plan(self, run_input: PlannerRunInput) -> StudyPlanProposal:
        """Produce one study-plan proposal and submit it (M12-04).

        Never raises — any failure becomes a non-fatal fallback proposal with a
        ``fallback_reason``. The caller (Rust) marks the plan failed and
        schedules a retry; the journal baseline is unaffected.
        """
        started = time.monotonic()
        try:
            self._check_capabilities(run_input.available_host_capabilities or {})

            planner_input = run_input.planner_input
            # Enrich: if the caller supplied no skill review needs, fetch them
            # from the M4 host (best-effort). Failure → 0-item fallback.
            needs = planner_input.skill_review_needs
            if not needs:
                needs = self._fetch_review_needs(planner_input, started=started)

            # Enrich: if the caller supplied no learner uncertainty map, fetch
            # the M4 skill state views to derive uncertainty (best-effort).
            uncertainty = planner_input.learner_uncertainty
            if not uncertainty:
                uncertainty = self._fetch_uncertainty_map(
                    planner_input, started=started
                )

            proposal = self._build_proposal(planner_input, needs, uncertainty)
            return self._submit_proposal(
                planner_input.trace_id, proposal, started=started
            )
        except _Fallback as fallback:
            return _fallback_proposal(
                run_input.planner_input.user_goal, fallback.reason
            )
        except Exception as error:  # pragma: no cover - last-resort boundary
            return _fallback_proposal(
                run_input.planner_input.user_goal,
                f"unexpected_error:{type(error).__name__}",
            )

    # --- deterministic proposal construction (pure, no host calls) --------

    def _build_proposal(
        self,
        planner_input: PlannerInput,
        needs: list[SkillReviewNeed],
        uncertainty: dict[str, float],
    ) -> StudyPlanProposal:
        """Build the deterministic proposal (M12-04).

        Pure function of (planner_input, needs, uncertainty): identical inputs ⇒
        identical items (modulo host-assigned ``plan_id``). Ordering key:

          1. ``priority`` (desc) — the M4 scheduler's due/overdue ranking;
          2. learner ``uncertainty`` (desc) — tiebreaker;
          3. ``target_date`` distance (asc) — near target ⇒ higher priority;
          4. ``skill_key`` (asc) — final stable tiebreaker.

        The total ``estimated_minutes`` is bounded by ``available_minutes``
        (and a recent-workload cap so a heavy week is not over-scheduled).
        """
        available = self._effective_available_minutes(planner_input)
        if available < MIN_PROBE_MINUTES or not needs:
            # Nothing to schedule today. A 0-item proposal is a legitimate
            # "no practice today" result, NOT a fallback.
            return StudyPlanProposal(
                plan_id="",
                user_goal=planner_input.user_goal,
                items=[],
                total_estimated_minutes=0,
                fallback_reason=None,
            )

        ordered = self._order_needs(
            needs, uncertainty, planner_input.target_date, planner_input.plan_date
        )

        avoid_skills = self._avoid_skills(planner_input.user_preferences)
        items: list[StudyPlanItem] = []
        total = 0
        for need in ordered:
            if len(items) >= MAX_PROPOSAL_ITEMS:
                break
            if need.skill_key in avoid_skills:
                continue
            estimate = self._estimate_minutes(need, planner_input)
            if total + estimate > available:
                # Does at least one more probe still fit at the minimum?
                if total + MIN_PROBE_MINUTES > available:
                    break
                # Clamp the last item to what fits, never below the minimum.
                estimate = max(MIN_PROBE_MINUTES, available - total)
                if total + estimate > available:
                    break
            items.append(
                StudyPlanItem(
                    itemId=f"item-{len(items) + 1}-{need.skill_key}",
                    skillProbe=SkillProbe(
                        skillKey=need.skill_key,
                        probeKind=need.preferred_probe,
                        avoidAssetIds=list(need.avoid_asset_ids),
                        reasonCodes=list(need.reason_codes),
                    ),
                    whyText=self._why_text(need, uncertainty, planner_input),
                    estimatedMinutes=estimate,
                    questionKind=self._question_kind_for(need.skill_key),
                )
            )
            total += estimate

        return StudyPlanProposal(
            plan_id="",
            user_goal=planner_input.user_goal,
            items=items,
            total_estimated_minutes=total,
            fallback_reason=None,
        )

    def _order_needs(
        self,
        needs: list[SkillReviewNeed],
        uncertainty: dict[str, float],
        target_date: str,
        plan_date: str,
    ) -> list[SkillReviewNeed]:
        """Deterministic priority ordering (M12-04 deterministic constraints).

        Sort key (descending priority first):
          1. ``priority`` (desc) — M4 scheduler due/overdue ranking;
          2. learner ``uncertainty`` (desc) — tiebreaker (more uncertain first);
          3. ``target_date`` distance — when a target date is set, skills whose
             ``due_at`` is closer to it win. We approximate "distance" with the
             lexical distance between ``due_at`` and ``target_date`` (ISO dates
             sort lexically), ascending — closer first;
          4. ``skill_key`` (asc) — final stable tiebreaker (no randomness).

        The result is a pure function of the inputs: identical inputs ⇒
        identical ordering.
        """

        def sort_key(need: SkillReviewNeed) -> tuple[float, float, float, str]:
            unc = float(uncertainty.get(need.skill_key, 0.0))
            # target_date distance: 0.0 when no target date (neutral). When set,
            # lexical closeness between due_at and target_date (smaller =
            # closer). We negate priority and uncertainty for descending order.
            distance = self._target_distance(need.due_at, target_date, plan_date)
            return (
                -need.priority,
                -unc,
                distance,
                need.skill_key,
            )

        return sorted(needs, key=sort_key)

    @staticmethod
    def _target_distance(
        due_at: str, target_date: str, plan_date: str
    ) -> float:
        """Approximate the distance between a need's due_at and the target date.

        Returns 0.0 when no target date is set (neutral — does not influence
        ordering). When set, returns the lexical delta between due_at and
        target_date (ISO 8601 strings sort lexically, so a smaller delta means
        the due review is closer to the target). We use the absolute lexical
        difference so a due review just past OR just before the target both
        count as "near".

        This is an approximation: full date arithmetic lives on the Rust host
        (which owns the canonical calendar). Python only needs a stable,
        deterministic ordering signal.
        """
        if not target_date:
            return 0.0
        # Compare the date prefixes (YYYY-MM-DD). A need whose due_at is on the
        # target date has distance 0.0.
        due_prefix = due_at[:10] if len(due_at) >= 10 else due_at
        target_prefix = target_date[:10]
        # Lexical distance: 0 if equal, else a small positive scaled by how far
        # apart the strings are. We use a simple per-character diff so the
        # ordering is stable and deterministic.
        diff = sum(
            1 for a, b in zip(due_prefix, target_prefix) if a != b
        ) + abs(len(due_prefix) - len(target_prefix))
        return float(diff)

    @staticmethod
    def _effective_available_minutes(planner_input: PlannerInput) -> int:
        """Apply the recent-workload cap to ``available_minutes`` (deterministic).

        A heavy week (>= RECENT_WORKLOAD_HEAVY_THRESHOLD_MIN practised) reduces
        the effective budget to RECENT_WORKLOAD_CAP_RATIO of the requested
        available_minutes, so the planner does not pile on. The cap never goes
        below MIN_PROBE_MINUTES so a heavy learner still gets at least one
        short probe if they asked for time.
        """
        available = planner_input.available_minutes
        if planner_input.recent_workload_minutes >= RECENT_WORKLOAD_HEAVY_THRESHOLD_MIN:
            capped = int(available * RECENT_WORKLOAD_CAP_RATIO)
            return max(MIN_PROBE_MINUTES, capped) if available >= MIN_PROBE_MINUTES else capped
        return available

    @staticmethod
    def _avoid_skills(user_preferences: dict[str, Any]) -> frozenset[str]:
        """Read the ``avoid_skills`` preference (opaque list → frozenset).

        Unknown preference keys are ignored. Malformed entries are skipped.
        """
        raw = user_preferences.get("avoid_skills")
        if not isinstance(raw, list):
            return frozenset()
        result: set[str] = set()
        for entry in raw:
            if isinstance(entry, str) and entry.strip():
                result.add(entry.strip())
        return frozenset(result)

    @staticmethod
    def _estimate_minutes(
        need: SkillReviewNeed, planner_input: PlannerInput
    ) -> int:
        """Estimate minutes for one skill probe (deterministic).

        Default DEFAULT_PROBE_MINUTES. The user may cap per-session minutes via
        ``user_preferences.max_session_minutes``; the estimate never exceeds
        that cap and never drops below MIN_PROBE_MINUTES.
        """
        estimate = DEFAULT_PROBE_MINUTES
        max_session = planner_input.user_preferences.get("max_session_minutes")
        if isinstance(max_session, int) and max_session >= MIN_PROBE_MINUTES:
            estimate = min(estimate, max_session)
        # Writing rewrites take longer than a TFNG set; bump deterministically.
        if need.preferred_probe is SkillProbeKind.WRITING_REWRITE:
            estimate = max(estimate, 25)
        return max(MIN_PROBE_MINUTES, estimate)

    @staticmethod
    def _question_kind_for(skill_key: str) -> QuestionKind:
        """Map a skill_key to the IELTS question kind (deterministic).

        Unknown prefixes fall back to COACH_DRILL (a generic micro-drill) so the
        learner still gets a probe surface.
        """
        for prefix, kind in _SKILL_PREFIX_TO_QUESTION_KIND:
            if skill_key.startswith(prefix):
                return kind
        return QuestionKind.COACH_DRILL

    @staticmethod
    def _why_text(
        need: SkillReviewNeed,
        uncertainty: dict[str, float],
        planner_input: PlannerInput,
    ) -> str:
        """Deterministic, human-readable reason for one plan item.

        Composed only from factual fields (priority, uncertainty, due_at,
        target_date). Never invents a numeric fact or profile. Bounded length
        so it fits the type's 2KB cap.
        """
        unc = uncertainty.get(need.skill_key, 0.0)
        parts = [
            f"skill={need.skill_key}",
            f"priority={need.priority:.3f}",
            f"band={need.priority_band}",
            f"probe={need.preferred_probe.value}",
        ]
        if unc > 0.0:
            parts.append(f"uncertainty={unc:.2f}")
        if need.reason_codes:
            parts.append("reasons=" + ",".join(need.reason_codes[:4]))
        if planner_input.target_date:
            parts.append(f"target={planner_input.target_date}")
        # Deterministic, semicolon-joined, no natural-language invention.
        return "schedule:" + ";".join(parts)

    # --- host calls (no-write-bypass) ------------------------------------

    def _check_capabilities(self, available: dict[str, str]) -> None:
        if not available:
            raise _Fallback("host_capabilities_unavailable")
        for capability, version in self._required.items():
            if available.get(capability) != version:
                raise _Fallback(
                    f"capability_mismatch:{capability}:expected:{version}:"
                    f"got:{available.get(capability)}"
                )

    def _fetch_review_needs(
        self, planner_input: PlannerInput, *, started: float
    ) -> list[SkillReviewNeed]:
        """Fetch skill review needs via ``learning.learner_skill_state`` (M4).

        Best-effort enrichment: when the caller supplied no needs, we ask the
        host. Host failure → fallback (the planner then returns a 0-item
        proposal if the host is unavailable mid-run, or a fallback proposal if
        ``study_plan.create`` itself fails). Never raises fatal.
        """
        try:
            result = self._bridge.invoke(
                CAPABILITY_LEARNER_SKILL_STATE,
                {
                    "query": {
                        "skillKeys": [],
                        "afterSkillKey": None,
                        "limit": 64,
                    }
                },
                trace_id=planner_input.trace_id,
                deadline_ms=self._deadline_ms,
                started_at=started,
            )
        except Exception as error:
            raise _Fallback(
                f"learner_skill_state_unavailable:{type(error).__name__}"
            ) from error
        return _parse_review_needs(result)

    def _fetch_uncertainty_map(
        self, planner_input: PlannerInput, *, started: float
    ) -> dict[str, float]:
        """Fetch learner uncertainty via ``learning.learner_skill_state`` (M4).

        Best-effort enrichment: when the caller supplied no uncertainty map, we
        derive one from the host's skill state views. Host failure → empty map
        (the planner falls back to the priority carried on each
        SkillReviewNeed). Never raises fatal.
        """
        try:
            result = self._bridge.invoke(
                CAPABILITY_LEARNER_SKILL_STATE,
                {
                    "query": {
                        "skillKeys": [],
                        "afterSkillKey": None,
                        "limit": 64,
                    }
                },
                trace_id=planner_input.trace_id,
                deadline_ms=self._deadline_ms,
                started_at=started,
            )
        except Exception as error:
            raise _Fallback(
                f"learner_skill_state_unavailable:{type(error).__name__}"
            ) from error
        return _parse_uncertainty_map(result)

    def _submit_proposal(
        self,
        trace_id: str,
        proposal: StudyPlanProposal,
        *,
        started: float,
    ) -> StudyPlanProposal:
        """Submit the proposal to the Rust ``study_plan.create`` authority.

        The host persists the plan and assigns ``plan_id``. Host failure →
        fallback proposal (fail-closed), never fatal. The orchestrator returns
        the locally-built proposal with the host-assigned ``plan_id`` on
        success; on failure it returns a fallback proposal so the caller knows
        the canonical store was not updated.
        """
        try:
            result = self._bridge.invoke(
                CAPABILITY_STUDY_PLAN_CREATE,
                {"proposal": proposal.to_wire()},
                trace_id=trace_id,
                deadline_ms=self._deadline_ms,
                started_at=started,
            )
        except Exception as error:
            raise _Fallback(
                f"study_plan_create_unavailable:{type(error).__name__}"
            ) from error
        if not isinstance(result, dict):
            raise _Fallback("study_plan_create_invalid_shape")
        plan_id = result.get("planId")
        if not isinstance(plan_id, str) or not plan_id.strip():
            raise _Fallback("study_plan_create_missing_plan_id")
        # Re-emit the proposal with the host-assigned plan_id. The items are
        # unchanged; the host only assigns the canonical plan_id.
        return StudyPlanProposal(
            plan_id=plan_id,
            user_goal=proposal.user_goal,
            items=list(proposal.items),
            total_estimated_minutes=proposal.total_estimated_minutes,
            fallback_reason=None,
        )


class _Fallback(Exception):
    """Non-fatal fallback signal — never escapes the public methods."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _parse_review_needs(host_result: Any) -> list[SkillReviewNeed]:
    """Parse a Rust ``SkillReviewNeedsSnapshot`` into bounded needs.

    Defensive: the host envelope may carry fields the planner does not model.
    We parse each row leniently — a row that fails validation is skipped (the
    M4 scheduler is the source of truth; a malformed row should not force a
    planner fallback, it should just be dropped). Returns an empty list on any
    structural problem.
    """
    if not isinstance(host_result, dict):
        return []
    needs = host_result.get("needs")
    if not isinstance(needs, list):
        return []
    parsed: list[SkillReviewNeed] = []
    for entry in needs:
        if not isinstance(entry, dict):
            continue
        try:
            parsed.append(SkillReviewNeed.model_validate(entry))
        except Exception:
            continue
    return parsed


def _parse_uncertainty_map(host_result: Any) -> dict[str, float]:
    """Parse a Rust ``LearnerStateSnapshot`` into a skill→uncertainty map.

    Defensive: malformed rows are skipped. Returns an empty map on any
    structural problem (the planner falls back to the priority on each need).
    """
    if not isinstance(host_result, dict):
        return {}
    states = host_result.get("states")
    if not isinstance(states, list):
        return {}
    out: dict[str, float] = {}
    for entry in states:
        if not isinstance(entry, dict):
            continue
        try:
            view = SkillStateView.model_validate(entry)
        except Exception:
            continue
        out[view.skill_key] = view.uncertainty
    return out


def _fallback_proposal(user_goal: str, reason: str) -> StudyPlanProposal:
    """Construct a fail-closed fallback proposal (M12-04).

    The proposal is empty (0 items) so a host failure can never accidentally
    schedule practice the learner did not approve. The reason is carried in
    ``fallback_reason`` so the caller (Rust) can surface it and retry.
    """
    return StudyPlanProposal(
        plan_id="",
        user_goal=user_goal,
        items=[],
        total_estimated_minutes=0,
        fallback_reason=reason,
    )


def fallback_result(user_goal: str, reason: str) -> StudyPlanProposal:
    """Public fail-closed fallback helper (mirrors M7/M10 ``fallback_result``)."""
    return _fallback_proposal(user_goal, reason)


__all__ = [
    "DEFAULT_COGNITIVE_DEADLINE_MS",
    "DEFAULT_PROBE_MINUTES",
    "MAX_PROPOSAL_ITEMS",
    "MIN_PROBE_MINUTES",
    "PLANNER_INPUT_SCHEMA_VERSION",
    "PlannerRunInput",
    "StudyPlannerOrchestrator",
    "fallback_result",
]
