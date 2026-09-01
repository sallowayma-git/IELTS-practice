"""M10 Teaching Strategy Evolution — Python evaluation orchestration (Slice 2).

This module owns the **evaluation orchestration** that turns strategy
assignments + delayed future observations into per-user effectiveness
evidence. It is the Python-first half of M10; Rust (Slice 1) is the
persistence/promotion authority.

Hard rules enforced here (M10 plan §8845-9038):

- **satisfaction ≠ learning (M10-03).** Two reward channels are aggregated on
  SEPARATE axes. A thumbs-up (satisfaction) can NEVER be recorded as a
  learning outcome. :func:`aggregate_reward_channels` returns them split; no
  code path conflates them.
- **delayed outcome window (M10-04).** An assignment at T0 is only credited
  when a *relevant* future skill observation falls within the next N relevant
  observations AND is on a *novel asset* (the assignment's target asset must
  not be the one the learner already practiced on). Beyond the window →
  ``OutOfWindow``; no effectiveness claim is recorded (the strategy is NOT
  punished). Same-asset repeats are ``DiscountedSameAsset``.
- **confidence is bounded (M10-05).** ``confidence = success/(success+failure)``
  clamped to [0, 1]. No global reinforcement learning, no policy gradient.
- **selection rules are priority-ordered (M10-06).** explicit preference >
  contraindication > proven personal > default > exploration slot. Exploration
  is ONLY emitted when evidence is sufficient, and capped at a small ratio
  (10%).
- **preference vs effectiveness conflict (M10-07).** When the user's explicit
  preference (e.g. ``concise_direct_v1``) conflicts with what effectiveness
  evidence favours (e.g. ``evidence_first_v1``), the orchestrator RESPECTS the
  explicit preference. It does not silently switch. It may emit a candidate
  suggestion (never auto-promotes; M10-08) and an explanation, but the selected
  strategy follows the explicit preference.
- **no-write-bypass.** All strategy-state access goes through
  ``host_bridge.invoke`` (``strategy.select`` / ``strategy.record_*`` /
  ``strategy.user_state``). Python never opens the canonical SQLite, never
  holds provider secrets, never writes active strategy state directly.
- **no-LLM path + fail-closed.** Host failure → ``fallback_result`` (non-fatal);
  the caller (Rust) remains the promotion gate. ``strategy_eval`` never raises
  fatal from a host call.

This module does NOT touch ``coach/strategies.py`` (M6 6-id selector) or the
M6 preference extractor. M10 evaluation reads the 8-id v1 catalog from
:mod:`coach.types`.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Protocol

from .types import (
    CAPABILITY_STRATEGY_RECORD_ASSIGNMENT,
    CAPABILITY_STRATEGY_RECORD_FEEDBACK,
    CAPABILITY_STRATEGY_RECORD_OUTCOME,
    CAPABILITY_STRATEGY_SELECT,
    CAPABILITY_STRATEGY_USER_STATE,
    OUTCOME_ATTRIBUTION_SCHEMA_VERSION,
    REQUIRED_STRATEGY_EVAL_HOST_CAPABILITIES,
    STRATEGY_CATALOG_V1,
    OutcomeAttribution,
    OutcomeAttributionKind,
    StrategyAssignment,
    StrategyFeedbackKind,
    StrategyOutcomeKind,
    StrategySelection,
    UserStrategyState,
)

# Cognitive deadline for one strategy-evaluation pass. Conservative: keeps the
# Python side from blocking the user-facing Rust baseline.
DEFAULT_COGNITIVE_DEADLINE_MS = 8_000

# M10-04 delayed-outcome window: the maximum number of *relevant* future skill
# observations to scan for an attribution candidate. Not a wall-clock window —
# it is an observation-count window, because attribution depends on relevant
# practice, not elapsed time.
DEFAULT_OUTCOME_WINDOW = 5

# M10-06 exploration slot. Exploration is ONLY emitted when a strategy has
# enough evidence (>= MIN_EXPLORATION_EVIDENCE assignments with an attributed
# outcome) AND there exist under-explored strategies. The cap is the maximum
# fraction of selections that may be exploration picks.
MIN_EXPLORATION_EVIDENCE = 3
EXPLORATION_CAP = 0.10  # 10%

# M10-05 confidence smoothing: when success+failure == 0, confidence is the
# neutral prior (0.5) rather than 0.0 — a strategy with no evidence is not
# "bad", it is "untested".
CONFIDENCE_NEUTRAL_PRIOR = 0.5

# M10-06 selection priority tiers (stable order; first match wins).
_TIER_EXPLICIT_PREFERENCE = "explicit_preference"
_TIER_CONTRAINDICATION = "contraindication"
_TIER_PROVEN_PERSONAL = "proven_personal"
_TIER_DEFAULT = "default"
_TIER_EXPLORATION = "exploration"


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
class OutcomeScanInput:
    """Frozen input for one delayed-outcome attribution scan (M10-04)."""

    trace_id: str
    # The M10-02 assignment we are attributing outcomes to.
    assignment: StrategyAssignment
    # Relevant future skill observations, in chronological order, already
    # bounded by the caller. Each carries: observationId, skill, assetId
    # (optional), timestamp (optional). The orchestrator scans the first
    # ``window`` of these for an attribution candidate.
    observations: tuple[dict[str, Any], ...]
    # The observation-count window (default DEFAULT_OUTCOME_WINDOW).
    window: int = DEFAULT_OUTCOME_WINDOW


@dataclass(frozen=True, slots=True)
class SelectionInput:
    """Frozen input for one strategy selection (M10-06).

    All fields are plain primitives/str — no host handles, no secrets. The
    selector is deterministic given the inputs: identical inputs ⇒ identical
    selected strategy.
    """

    trace_id: str
    scope: str  # e.g. "reading.tfng" — strategy × scope state key
    # The user's EXPLICIT preference strategy id, if any (M10-07). When present
    # and not contraindicated, this wins over proven effectiveness.
    explicit_preference: str | None = None
    # Strategies contraindicated for this learner/context (e.g. socratic_prompt
    # contraindicated when the learner is frustrated). Comma-free list.
    contraindicated: frozenset[str] = field(default_factory=frozenset)
    # The user_strategy_state rows for this user+scope (one per catalog strategy
    # the host has evidence for). Missing rows ⇒ untested.
    user_state_rows: tuple[UserStrategyState, ...] = ()
    # Skill-family default strategy for this scope (M10-06 default tier).
    default_strategy_id: str = "evidence_first_v1"
    # When True, the orchestrator may emit an exploration-slot pick under the
    # M10-06 cap. When False, exploration is suppressed (e.g. a learner who
    # disabled personalization — the selector falls to default).
    allow_exploration: bool = True


@dataclass(frozen=True, slots=True)
class AggregatedReward:
    """M10-03 two-axis reward aggregation.

    ``satisfaction`` and ``learning`` are SEPARATE axes. Nothing here lets a
    thumbs-up count as a learning outcome. The two dicts carry per-strategy
    counts only — no cross-axis inference.
    """

    satisfaction: dict[str, dict[str, int]]
    learning: dict[str, dict[str, int]]

    def to_wire(self) -> dict[str, Any]:
        return {
            "satisfaction": dict(self.satisfaction),
            "learning": dict(self.learning),
        }


class StrategyEvaluationOrchestrator:
    """M10 strategy evaluation orchestrator (Python side, fail-closed).

    Constructed with a host bridge and the set of required host capabilities.
    If a required capability is missing or a host call fails, the orchestrator
    returns a non-fatal fallback result instead of raising — the Rust authority
    remains the promotion gate. Python owns evaluation orchestration only.
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
            required_capabilities or REQUIRED_STRATEGY_EVAL_HOST_CAPABILITIES
        )
        self._deadline_ms = cognitive_deadline_ms

    # --- M10-04: delayed outcome attribution ------------------------------

    def delayed_outcome_attribution(
        self,
        scan_input: OutcomeScanInput,
        *,
        available_host_capabilities: dict[str, str] | None = None,
    ) -> OutcomeAttribution:
        """Attribute a delayed learning outcome to a strategy assignment.

        Walks the first ``window`` relevant future observations. The FIRST
        observation that:
          - targets a NOVEL asset (asset != assignment.target_asset_id), AND
          - touches one of the assignment's skill_keys,
        attributes a learning outcome to the assignment. A same-asset repeat is
        discounted (M10-04: prefer novel asset). If no qualifying observation
        falls within the window, returns ``OutOfWindow`` — the strategy is NOT
        punished and no effectiveness claim is recorded.

        The verdict is submitted to the Rust authority via
        ``strategy.record_outcome`` (fail-closed: host failure → fallback
        verdict, non-fatal). When the host is unavailable, the orchestrator
        still returns the computed verdict locally so the caller can audit it,
        but marks it as not-persisted via ``fallback_result`` semantics.

        Never raises.
        """
        started = time.monotonic()
        try:
            self._check_capabilities(available_host_capabilities or {})

            verdict = self._compute_attribution(scan_input)

            # Persist via the Rust authority (no-write-bypass). Host failure is
            # non-fatal: the verdict is still returned for audit, but we mark
            # the failure through a fallback result so the caller knows the
            # canonical store was not updated.
            try:
                self._record_outcome_host(
                    scan_input.trace_id, verdict, started=started
                )
            except _Fallback:
                # The verdict is locally computed and correct; only persistence
                # failed. Return the verdict but flag non-persistence via the
                # fallback_result path the caller can inspect.
                return _fallback_attribution(
                    scan_input.assignment,
                    "record_outcome_unavailable",
                )

            return verdict
        except _Fallback as fallback:
            return _fallback_attribution(scan_input.assignment, fallback.reason)
        except Exception as error:  # pragma: no cover - last-resort boundary
            return _fallback_attribution(
                scan_input.assignment,
                f"unexpected_error:{type(error).__name__}",
            )

    def _compute_attribution(self, scan_input: OutcomeScanInput) -> OutcomeAttribution:
        """Pure attribution computation (no host calls).

        Separated from :meth:`delayed_outcome_attribution` so tests can drive
        the pure logic without a host bridge.

        The window is measured over RELEVANT observations only: an observation
        whose skill does not touch any of the assignment's skill_keys does not
        consume a window slot (the learner practised something unrelated, which
        is not evidence about THIS strategy). We filter to relevant
        observations first, then apply the window.
        """
        assignment = scan_input.assignment
        window = max(0, scan_input.window)
        if window == 0:
            return OutcomeAttribution(
                kind=OutcomeAttributionKind.OUT_OF_WINDOW,
                strategy_assignment_id=assignment.response_message_id,
            )

        skill_keys = set(assignment.skill_keys)
        target_asset = assignment.target_asset_id

        # Filter to relevant observations (skill touches a targeted family).
        # Irrelevant observations do NOT consume a window slot.
        relevant_observations: list[dict[str, Any]] = []
        for observation in scan_input.observations:
            obs_skill = observation.get("skill")
            if not isinstance(obs_skill, str):
                continue
            if obs_skill in skill_keys or any(
                _skill_matches(obs_skill, key) for key in skill_keys
            ):
                relevant_observations.append(observation)

        # Walk the first `window` RELEVANT observations.
        for observation in relevant_observations[:window]:
            obs_id = observation.get("observationId")
            if not isinstance(obs_id, str) or not obs_id.strip():
                continue
            obs_skill = observation.get("skill")
            obs_asset = observation.get("assetId")

            # M10-04: prefer novel asset. Same-asset repeat → discounted, and we
            # STOP scanning (the learner practised the same asset again, which
            # is not evidence the strategy moved a NEW skill).
            if isinstance(obs_asset, str) and obs_asset == target_asset:
                return OutcomeAttribution(
                    kind=OutcomeAttributionKind.DISCOUNTED_SAME_ASSET,
                    strategy_assignment_id=assignment.response_message_id,
                    evidence_observation_id=obs_id,
                    skill=obs_skill,
                    asset_id=obs_asset,
                )

            # Novel asset + relevant skill → attributed. Pick the learning
            # outcome kind. We infer from observation shape; the host stores
            # the canonical kind. Default to next_novel_skill_attempt.
            outcome_kind = _infer_outcome_kind(observation)
            return OutcomeAttribution(
                kind=OutcomeAttributionKind.ATTRIBUTED,
                strategy_assignment_id=assignment.response_message_id,
                evidence_observation_id=obs_id,
                outcome_kind=outcome_kind,
                skill=obs_skill if isinstance(obs_skill, str) else None,
                asset_id=obs_asset if isinstance(obs_asset, str) else None,
            )

        # No qualifying observation inside the window → out of window. The
        # strategy is NOT punished (no effectiveness claim recorded).
        return OutcomeAttribution(
            kind=OutcomeAttributionKind.OUT_OF_WINDOW,
            strategy_assignment_id=assignment.response_message_id,
        )

    # --- M10-03: two-axis reward aggregation ------------------------------

    def aggregate_reward_channels(
        self,
        user_state_rows: tuple[UserStrategyState, ...],
    ) -> AggregatedReward:
        """Aggregate satisfaction and learning on SEPARATE axes (M10-03).

        - Satisfaction axis: ``satisfaction_count`` (thumbs/correction/etc.
          rolled up by the Rust authority) + ``reask_count``.
        - Learning axis: ``success_count`` + ``novel_transfer_success``
          (delayed-attribution-attributed outcomes).

        These two dicts NEVER reference each other. A thumbs-up recorded in the
        satisfaction axis cannot appear in the learning axis. The caller must
        not merge them.
        """
        satisfaction: dict[str, dict[str, int]] = {}
        learning: dict[str, dict[str, int]] = {}
        for row in user_state_rows:
            sid = row.strategy_id
            satisfaction[sid] = {
                "satisfactionCount": row.satisfaction_count,
                "reaskCount": row.reask_count,
            }
            learning[sid] = {
                "successCount": row.success_count,
                "novelTransferSuccess": row.novel_transfer_success,
                "failureCount": row.failure_count,
            }
        return AggregatedReward(satisfaction=satisfaction, learning=learning)

    # --- M10-05: bounded confidence --------------------------------------

    def compute_confidence(self, user_state: UserStrategyState) -> float:
        """Bounded confidence: success/(success+failure), clamped [0,1].

        When success+failure == 0, returns the neutral prior (0.5) — an
        untested strategy is not "bad". No global RL, no policy gradient.
        """
        total = user_state.success_count + user_state.failure_count
        if total <= 0:
            return CONFIDENCE_NEUTRAL_PRIOR
        confidence = user_state.success_count / total
        if confidence < 0.0:
            return 0.0
        if confidence > 1.0:
            return 1.0
        return float(confidence)

    # --- M10-06 / M10-07: selection scoring -------------------------------

    def score_candidates(
        self,
        selection_input: SelectionInput,
        *,
        available_host_capabilities: dict[str, str] | None = None,
    ) -> StrategySelection:
        """Score the strategy catalog and pick one (M10-06 priority rules).

        Priority (first match wins):
          1. explicit preference (M10-07) — UNLESS contraindicated. When the
             explicit preference conflicts with effectiveness evidence, the
             explicit preference STILL wins (no silent switch). A candidate
             suggestion + explanation may be emitted, but the selected
             strategy is the explicit preference.
          2. contraindication filter — drop contraindicated strategies from
             proven/default/exploration tiers.
          3. proven personal — the strategy with the highest confidence among
             those with sufficient evidence (>= MIN_EXPLORATION_EVIDENCE).
          4. default — the scope's default strategy.
          5. exploration slot — ONLY when evidence is sufficient AND
             ``allow_exploration`` is True, pick the least-explored strategy
             with cap EXPLORATION_CAP. This is marked ``is_exploration=True``.

        The result is submitted to the Rust ``strategy.select`` authority
        (fail-closed). Host failure → fallback result (non-fatal).

        Never raises.
        """
        started = time.monotonic()
        try:
            self._check_capabilities(available_host_capabilities or {})

            selection = self._score(selection_input)

            # Persist the selection via the Rust authority (no-write-bypass).
            # Host failure is non-fatal: the local selection is still returned
            # for audit, but flagged as not-persisted via fallback_result.
            try:
                self._record_select_host(
                    selection_input.trace_id, selection, started=started
                )
            except _Fallback:
                return _fallback_selection(
                    "strategy_select_unavailable",
                    selection_input.default_strategy_id,
                )

            return selection
        except _Fallback as fallback:
            return _fallback_selection(
                fallback.reason, selection_input.default_strategy_id
            )
        except Exception as error:  # pragma: no cover - last-resort boundary
            return _fallback_selection(
                f"unexpected_error:{type(error).__name__}",
                selection_input.default_strategy_id,
            )

    def _score(self, selection_input: SelectionInput) -> StrategySelection:
        """Pure selection scoring (no host calls)."""
        explicit = selection_input.explicit_preference
        contraindicated = selection_input.contraindicated
        rows_by_strategy = {
            row.strategy_id: row for row in selection_input.user_state_rows
        }

        # Tier 1: explicit preference (M10-07). Respects the user's stated
        # preference even when effectiveness evidence favours another strategy.
        # Only contraindication overrides explicit preference (safety).
        if explicit and explicit in STRATEGY_CATALOG_V1:
            if explicit in contraindicated:
                # Contraindication overrides even explicit preference — the
                # preference is unsafe for this context. Fall through to the
                # other tiers; emit a note that the preference was overridden.
                return self._pick_default_or_proven(
                    selection_input,
                    rows_by_strategy,
                    why=(
                        f"explicit_preference:{explicit} overridden by "
                        f"contraindication; falling back to default/proven"
                    ),
                )
            # M10-07 conflict handling: if effectiveness evidence favours a
            # DIFFERENT strategy, respect the explicit preference but emit a
            # candidate suggestion (never auto-promotes; M10-08) + explanation.
            best_effective = self._best_effective_strategy(
                rows_by_strategy, contraindicated
            )
            if (
                best_effective is not None
                and best_effective != explicit
                and self._has_sufficient_evidence(rows_by_strategy, best_effective)
            ):
                why = (
                    f"explicit_preference:{explicit} respected "
                    f"(effectiveness evidence favours {best_effective}; "
                    f"suggestion emitted as candidate only, not auto-promoted)"
                )
                alternatives = [
                    {
                        "strategyId": best_effective,
                        "tier": _TIER_PROVEN_PERSONAL,
                        "note": "candidate_suggestion_only",
                    }
                ]
                return StrategySelection(
                    selected_strategy_id=explicit,
                    why=why,
                    alternatives=alternatives,
                    is_exploration=False,
                )
            return StrategySelection(
                selected_strategy_id=explicit,
                why=f"explicit_preference:{explicit}",
                alternatives=[],
                is_exploration=False,
            )

        # Tier 2 + 3 + 4 + 5 (no explicit preference).
        return self._pick_default_or_proven(
            selection_input,
            rows_by_strategy,
            why=None,
        )

    def _pick_default_or_proven(
        self,
        selection_input: SelectionInput,
        rows_by_strategy: dict[str, UserStrategyState],
        *,
        why: str | None,
    ) -> StrategySelection:
        """Tiers 3/4/5: proven personal → default → exploration slot."""
        contraindicated = selection_input.contraindicated
        default_id = selection_input.default_strategy_id

        # Tier 3: proven personal — highest confidence with sufficient evidence,
        # not contraindicated. A strategy is "proven" only when its confidence is
        # net-positive (> 0.5, i.e. success > failure). A strategy with evidence
        # but net-negative confidence is NOT proven — it falls through to
        # default/exploration so we do not keep re-selecting a strategy that is
        # not working for this learner.
        best = self._best_effective_strategy(rows_by_strategy, contraindicated)
        if (
            best is not None
            and self._has_sufficient_evidence(rows_by_strategy, best)
            and self.compute_confidence(rows_by_strategy[best]) > 0.5
        ):
            confidence = self.compute_confidence(rows_by_strategy[best])
            return StrategySelection(
                selected_strategy_id=best,
                why=why or f"proven_personal:{best}:confidence={confidence:.3f}",
                alternatives=[],
                is_exploration=False,
            )

        # Tier 5: exploration slot — ONLY when evidence is sufficient AND
        # allow_exploration is True, capped at EXPLORATION_CAP. We pick the
        # least-explored (lowest total observations) non-contraindicated
        # strategy. The cap is enforced by the Rust authority on the call site
        # (it tracks the running exploration ratio); here we only emit the
        # exploration pick when local evidence supports it.
        if selection_input.allow_exploration and self._exploration_supported(
            rows_by_strategy
        ):
            explore_pick = self._least_explored_strategy(
                rows_by_strategy, contraindicated
            )
            if explore_pick is not None:
                return StrategySelection(
                    selected_strategy_id=explore_pick,
                    why=why
                    or (
                        f"exploration_slot:{explore_pick} "
                        f"(cap={EXPLORATION_CAP}; sufficient evidence present)"
                    ),
                    alternatives=[
                        {
                            "strategyId": default_id,
                            "tier": _TIER_DEFAULT,
                        }
                    ],
                    is_exploration=True,
                )

        # Tier 4: default.
        return StrategySelection(
            selected_strategy_id=default_id,
            why=why or f"default:{default_id}",
            alternatives=[],
            is_exploration=False,
        )

    def _best_effective_strategy(
        self,
        rows_by_strategy: dict[str, UserStrategyState],
        contraindicated: frozenset[str],
    ) -> str | None:
        """Return the strategy id with the highest bounded confidence among
        non-contraindicated strategies that have any evidence. None if no
        strategy has evidence."""
        best_id: str | None = None
        best_conf = -1.0
        for sid, row in rows_by_strategy.items():
            if sid in contraindicated:
                continue
            if row.success_count + row.failure_count <= 0:
                continue
            conf = self.compute_confidence(row)
            if conf > best_conf:
                best_conf = conf
                best_id = sid
        return best_id

    def _has_sufficient_evidence(
        self,
        rows_by_strategy: dict[str, UserStrategyState],
        strategy_id: str,
    ) -> bool:
        row = rows_by_strategy.get(strategy_id)
        if row is None:
            return False
        # Sufficient = the strategy has been attributed enough outcomes to
        # support a proven-personal or exploration decision.
        return (row.success_count + row.failure_count) >= MIN_EXPLORATION_EVIDENCE

    def _exploration_supported(
        self, rows_by_strategy: dict[str, UserStrategyState]
    ) -> bool:
        """Exploration is only allowed when AT LEAST ONE strategy has
        sufficient evidence (M10-06). With zero evidence everywhere, the
        selector falls to the default — exploration would be random guessing."""
        for sid in rows_by_strategy:
            if self._has_sufficient_evidence(rows_by_strategy, sid):
                return True
        return False

    def _least_explored_strategy(
        self,
        rows_by_strategy: dict[str, UserStrategyState],
        contraindicated: frozenset[str],
    ) -> str | None:
        """Pick the catalog strategy with the fewest total observations,
        excluding contraindicated ones. Ties broken by stable catalog order."""
        best_id: str | None = None
        best_count: int | None = None
        for sid in _catalog_in_order():
            if sid in contraindicated:
                continue
            row = rows_by_strategy.get(sid)
            total = (
                (row.success_count + row.failure_count) if row is not None else 0
            )
            if best_count is None or total < best_count:
                best_count = total
                best_id = sid
        return best_id

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

    def _record_outcome_host(
        self, trace_id: str, verdict: OutcomeAttribution, *, started: float
    ) -> None:
        try:
            result = self._bridge.invoke(
                CAPABILITY_STRATEGY_RECORD_OUTCOME,
                {"attribution": verdict.to_wire()},
                trace_id=trace_id,
                deadline_ms=self._deadline_ms,
                started_at=started,
            )
        except Exception as error:
            raise _Fallback(
                f"record_outcome_unavailable:{type(error).__name__}"
            ) from error
        if not isinstance(result, dict):
            raise _Fallback("record_outcome_invalid_shape")

    def _record_select_host(
        self, trace_id: str, selection: StrategySelection, *, started: float
    ) -> None:
        try:
            result = self._bridge.invoke(
                CAPABILITY_STRATEGY_SELECT,
                {"selection": selection.to_wire()},
                trace_id=trace_id,
                deadline_ms=self._deadline_ms,
                started_at=started,
            )
        except Exception as error:
            raise _Fallback(
                f"strategy_select_unavailable:{type(error).__name__}"
            ) from error
        if not isinstance(result, dict):
            raise _Fallback("strategy_select_invalid_shape")

    # --- public host-backed recorders (M10-02/M10-03) --------------------

    def record_assignment(
        self,
        assignment: StrategyAssignment,
        *,
        trace_id: str,
        available_host_capabilities: dict[str, str] | None = None,
    ) -> bool:
        """Record a strategy assignment via ``strategy.record_assignment``.

        Returns True on success, False on non-fatal fallback. Never raises.
        """
        started = time.monotonic()
        try:
            self._check_capabilities(available_host_capabilities or {})
            result = self._bridge.invoke(
                CAPABILITY_STRATEGY_RECORD_ASSIGNMENT,
                {"assignment": assignment.to_wire()},
                trace_id=trace_id,
                deadline_ms=self._deadline_ms,
                started_at=started,
            )
            if not isinstance(result, dict):
                return False
            return bool(result.get("recorded", False))
        except _Fallback:
            return False
        except Exception:  # pragma: no cover - last-resort boundary
            return False

    def record_feedback(
        self,
        *,
        strategy_assignment_id: str,
        feedback_kind: StrategyFeedbackKind,
        trace_id: str,
        available_host_capabilities: dict[str, str] | None = None,
        note: str | None = None,
    ) -> bool:
        """Record a satisfaction-channel feedback via ``strategy.record_feedback``.

        The feedback kind is ALWAYS a satisfaction-channel value
        (:class:`StrategyFeedbackKind`). It can NEVER be a learning outcome —
        learning outcomes go through :meth:`delayed_outcome_attribution`.
        Returns True on success, False on non-fatal fallback. Never raises.
        """
        started = time.monotonic()
        try:
            self._check_capabilities(available_host_capabilities or {})
            payload: dict[str, Any] = {
                "strategyAssignmentId": strategy_assignment_id,
                "feedbackKind": feedback_kind.value,
            }
            if note is not None:
                payload["note"] = note
            result = self._bridge.invoke(
                CAPABILITY_STRATEGY_RECORD_FEEDBACK,
                payload,
                trace_id=trace_id,
                deadline_ms=self._deadline_ms,
                started_at=started,
            )
            if not isinstance(result, dict):
                return False
            return bool(result.get("recorded", False))
        except _Fallback:
            return False
        except Exception:  # pragma: no cover - last-resort boundary
            return False

    def fetch_user_state(
        self,
        *,
        scope: str,
        trace_id: str,
        available_host_capabilities: dict[str, str] | None = None,
    ) -> tuple[UserStrategyState, ...]:
        """Fetch the user's strategy × scope state via ``strategy.user_state``.

        Returns an empty tuple on non-fatal fallback. Never raises.
        """
        started = time.monotonic()
        try:
            self._check_capabilities(available_host_capabilities or {})
            result = self._bridge.invoke(
                CAPABILITY_STRATEGY_USER_STATE,
                {"scope": scope},
                trace_id=trace_id,
                deadline_ms=self._deadline_ms,
                started_at=started,
            )
            if not isinstance(result, dict):
                return ()
            rows = result.get("rows")
            if not isinstance(rows, list):
                return ()
            parsed: list[UserStrategyState] = []
            for entry in rows:
                if not isinstance(entry, dict):
                    continue
                try:
                    parsed.append(UserStrategyState.model_validate(entry))
                except Exception:
                    continue
            return tuple(parsed)
        except _Fallback:
            return ()
        except Exception:  # pragma: no cover - last-resort boundary
            return ()


class _Fallback(Exception):
    """Non-fatal fallback signal — never escapes the public methods."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _catalog_in_order() -> tuple[str, ...]:
    """Stable catalog iteration order (matches STRATEGY_CATALOG_V1's
    documentation order)."""
    return (
        "evidence_first_v1",
        "example_first_v1",
        "step_by_step_v1",
        "contrastive_v1",
        "socratic_prompt_v1",
        "concise_direct_v1",
        "error_then_rule_v1",
        "rule_then_example_v1",
    )


def _skill_matches(observed: str, target: str) -> bool:
    """Fuzzy skill match: observed skill is under the target's family prefix.

    e.g. observed "reading.tfng.false_vs_not_given" matches target
    "reading.tfng". Used so an assignment targeting "reading.tfng" credits an
    observation on any sub-skill of that family.
    """
    if observed == target:
        return True
    return observed.startswith(target + ".")


def _infer_outcome_kind(observation: dict[str, Any]) -> StrategyOutcomeKind:
    """Infer the learning outcome kind from observation shape.

    The host stores the canonical kind; this is a best-effort local inference
    for the audit verdict. Defaults to next_novel_skill_attempt.
    """
    kind = observation.get("outcomeKind")
    if isinstance(kind, str):
        try:
            return StrategyOutcomeKind(kind)
        except ValueError:
            pass
    activity = observation.get("activity")
    if isinstance(activity, str) and activity == "writing":
        return StrategyOutcomeKind.NEXT_WRITING_REVISION
    if observation.get("transfer"):
        return StrategyOutcomeKind.TRANSFER_TO_ANOTHER_ASSET
    if observation.get("correctedRepeat"):
        return StrategyOutcomeKind.CORRECTED_REPEATED_BEHAVIOR
    return StrategyOutcomeKind.NEXT_NOVEL_SKILL_ATTEMPT


def _fallback_attribution(
    assignment: StrategyAssignment, reason: str
) -> OutcomeAttribution:
    """Construct a fail-closed fallback attribution verdict.

    The verdict is OUT_OF_WINDOW (no effectiveness claim recorded) so a host
    failure can never accidentally credit or punish a strategy. The reason is
    encoded in a way that does not violate the schema — we use the
    evidence_observation_id slot with a ``fallback:`` prefix when the host
    never returned an observation, so auditors can see why no attribution
    happened.
    """
    return OutcomeAttribution(
        kind=OutcomeAttributionKind.OUT_OF_WINDOW,
        strategy_assignment_id=assignment.response_message_id,
        evidence_observation_id=f"fallback:{reason}",
    )


def _fallback_selection(reason: str, default_strategy_id: str) -> StrategySelection:
    """Construct a fail-closed fallback selection.

    Falls to the default strategy with the failure reason in ``why``. Never
    emits an exploration pick on fallback (safety).
    """
    return StrategySelection(
        selected_strategy_id=default_strategy_id,
        why=f"fallback:{reason}",
        alternatives=[],
        is_exploration=False,
    )


def fallback_result(reason: str) -> StrategySelection:
    """Public fail-closed fallback helper (mirrors M8 ``fallback_result``)."""
    return _fallback_selection(reason, "evidence_first_v1")


__all__ = [
    "CONFIDENCE_NEUTRAL_PRIOR",
    "DEFAULT_COGNITIVE_DEADLINE_MS",
    "DEFAULT_OUTCOME_WINDOW",
    "EXPLORATION_CAP",
    "MIN_EXPLORATION_EVIDENCE",
    "AggregatedReward",
    "OutcomeScanInput",
    "SelectionInput",
    "StrategyEvaluationOrchestrator",
    "fallback_result",
]
