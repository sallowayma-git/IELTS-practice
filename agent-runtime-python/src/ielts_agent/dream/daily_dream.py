"""M7-06 Daily Dream orchestrator (Slice 2 / Python side).

Reads ONLY today-scoped bounded facts via the Rust host gateway
(``journal.build_daily``), produces a bounded set of consolidation proposals
(REINFORCE / REFINE / IMPROVE / REGRESS / CONTRADICT / NOOP), and submits them
via ``dream.run_daily`` — Rust is the job authority and the only writer of
active memory.

M7-06 scope: today observations + today memory candidates + active memory
relevant subset + explicit corrections + learner delta. The orchestrator
NEVER scans the full user history.

M7-08 capacity: input observations, active candidates considered, output
proposals, token budget, and LLM retries are all bounded and fail-closed.
Host failure → fallback result, never a fatal exception.

No active-memory write bypass: the orchestrator only emits candidate
proposals for the Rust authority to persist; it never writes active memory
directly.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Protocol

from .capacity import (
    MAX_INPUT_OBSERVATIONS,
    default_capacity,
    truncate_observations,
    truncate_proposals,
)
from .types import (
    CAPABILITY_DREAM_RUN_DAILY,
    CAPABILITY_JOURNAL_BUILD_DAILY,
    DAILY_DREAM_SCHEMA_VERSION,
    REQUIRED_DAILY_DREAM_HOST_CAPABILITIES,
    DailyDreamResult,
    DreamCapacity,
    DreamProposal,
    DreamProposalKind,
    JournalFacts,
)


DEFAULT_COGNITIVE_DEADLINE_MS = 15_000


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
class DreamRunInput:
    """Frozen input snapshot for one daily-dream run (M7-06 bounded scope)."""

    trace_id: str
    day: str  # ISO date string, e.g. "2026-08-16"
    available_host_capabilities: dict[str, str] = field(default_factory=dict)
    capacity: DreamCapacity = field(default_factory=default_capacity)


class DailyDreamOrchestrator:
    """M7-06 daily-dream orchestrator (Python side, fail-closed).

    Constructed with a host bridge and a set of required host capabilities.
    If a required capability is missing or a host call fails, the orchestrator
    returns a fallback result instead of raising — the Rust journal
    deterministic version still completes and the dream run is marked failed,
    per M7-08.
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
            required_capabilities or REQUIRED_DAILY_DREAM_HOST_CAPABILITIES
        )
        self._deadline_ms = cognitive_deadline_ms

    def run_daily(self, run_input: DreamRunInput) -> DailyDreamResult:
        """Run one daily-dream consolidation pass.

        Never raises — any failure becomes a non-fatal fallback result with a
        ``fallback_reason``. The caller (Rust) marks the dream run failed and
        schedules a retry; the journal deterministic version is unaffected.
        """
        started = time.monotonic()
        try:
            self._check_capabilities(run_input.available_host_capabilities)

            facts = self._fetch_journal_facts(run_input, started=started)
            proposals = self._build_proposals(facts, run_input.capacity)
            return self._submit_proposals(
                run_input, proposals, started=started
            )
        except _Fallback as fallback:
            return DailyDreamResult(
                run_id="",
                accepted=0,
                rejected=0,
                failed=0,
                fallback_reason=fallback.reason,
            )
        except Exception as error:  # pragma: no cover - last-resort boundary
            return DailyDreamResult(
                run_id="",
                accepted=0,
                rejected=0,
                failed=0,
                fallback_reason=f"unexpected_error:{type(error).__name__}",
            )

    def _check_capabilities(self, available: dict[str, str]) -> None:
        if not available:
            raise _Fallback("host_capabilities_unavailable")
        for capability, version in self._required.items():
            if available.get(capability) != version:
                raise _Fallback(
                    f"capability_mismatch:{capability}:expected:{version}:got:{available.get(capability)}"
                )

    def _fetch_journal_facts(
        self, run_input: DreamRunInput, *, started: float
    ) -> JournalFacts:
        """Fetch today's bounded facts via ``journal.build_daily`` (M7-06).

        The host returns ONLY today-scoped facts — today observations, today
        memory candidates, active memory relevant subset, explicit
        corrections, and learner delta. The orchestrator never scans the
        full history and never opens the canonical DB.
        """
        try:
            result = self._bridge.invoke(
                CAPABILITY_JOURNAL_BUILD_DAILY,
                {"day": run_input.day},
                trace_id=run_input.trace_id,
                deadline_ms=self._deadline_ms,
                started_at=started,
            )
        except Exception as error:
            raise _Fallback(
                f"journal_build_daily_unavailable:{type(error).__name__}"
            ) from error
        if not isinstance(result, dict):
            raise _Fallback("journal_build_daily_invalid_shape")
        try:
            return JournalFacts.model_validate(result)
        except Exception as error:
            raise _Fallback(f"journal_facts_invalid:{type(error).__name__}") from error

    def _build_proposals(
        self, facts: JournalFacts, capacity: DreamCapacity
    ) -> list[DreamProposal]:
        """Produce a bounded set of consolidation proposals (M7-07).

        Deterministic, no-LLM consolidation pass. For each today observation
        that maps to an existing active memory, emit a REINFORCE proposal
        (observation re-confirms the memory). For observations that contradict
        a known memory (carried via explicit corrections in the facts), emit a
        CONTRADICT proposal. Where the facts flag a learner delta regression on
        a memory-backed skill, emit a REGRESS proposal. Excess proposals are
        truncated to the output capacity — the host re-validates the bound.

        New cross-domain higher-order patterns are deferred to M8 Weekly Dream.
        """
        # Bound the input observations (M7-08).
        bounded_observation_ids = truncate_observations(
            list(facts.today_observation_ids),
            min(capacity.max_input_observations, MAX_INPUT_OBSERVATIONS),
        )

        # Memory changes observed today are the consolidation targets. Each
        # change carries a memory_id + change_kind; we map change_kind to a
        # proposal kind where a direct mapping exists.
        proposals: list[DreamProposal] = []
        seen_targets: set[str] = set()

        # Map memory change kinds to proposal kinds (deterministic, no weights).
        kind_map: dict[str, DreamProposalKind] = {
            "reinforced": DreamProposalKind.REINFORCE,
            "improved": DreamProposalKind.IMPROVE,
            "regressed": DreamProposalKind.REGRESS,
            "contradicted": DreamProposalKind.CONTRADICT,
            "refined": DreamProposalKind.REFINE,
        }

        # Active candidates: the bounded set of memory mutations observed
        # today (identity-bearing events; the counts projection is display
        # only).
        active_changes = truncate_observations(
            list(facts.memory_events), capacity.max_active_candidates
        )

        # Pair each memory change with the first today observation as evidence
        # (M7-06: today observations only). The host already bounded the
        # observation list to today's scope.
        for change in active_changes:
            if len(proposals) >= capacity.max_output_candidates:
                break
            target_id = change.memory_id
            if target_id in seen_targets:
                continue
            seen_targets.add(target_id)
            evidence = _first_evidence_for_memory(change.memory_id, bounded_observation_ids, facts)
            if not evidence:
                # No today evidence grounds this consolidation — skip rather
                # than emit an ungrounded proposal (M7-07: proposals require
                # evidence; NOOP is reserved for "nothing to consolidate").
                continue
            kind = kind_map.get(
                change.change_kind.casefold(), DreamProposalKind.REINFORCE
            )
            # REFINE requires a revised statement. The deterministic path does
            # not have an LLM-authored rewrite, so it carries a bounded
            # structural statement derived only from the factual change_kind
            # and target id — never an invented numeric fact or profile.
            proposed_statement: str | None = None
            if kind is DreamProposalKind.REFINE:
                proposed_statement = (
                    f"Refine memory {target_id} per today {change.change_kind} "
                    f"observation {evidence[0]}."
                )
            proposals.append(
                DreamProposal(
                    kind=kind,
                    targetMemoryId=target_id,
                    proposedStatement=proposed_statement,
                    evidenceObservationIds=evidence,
                    rationale=f"today consolidation: {change.change_kind}",
                )
            )

        # If nothing consolidated today, emit a single NOOP (M7-07).
        if not proposals:
            proposals.append(DreamProposal(kind=DreamProposalKind.NOOP))

        return truncate_proposals(proposals, capacity.max_output_candidates)

    def _submit_proposals(
        self,
        run_input: DreamRunInput,
        proposals: list[DreamProposal],
        *,
        started: float,
    ) -> DailyDreamResult:
        """Submit proposals to the Rust ``dream.run_daily`` authority (M7-08).

        The host persists candidates only — never writes active memory
        directly. Host failure → fallback result (fail-closed), never fatal.
        """
        try:
            result = self._bridge.invoke(
                CAPABILITY_DREAM_RUN_DAILY,
                {
                    "day": run_input.day,
                    "proposals": [proposal.to_wire() for proposal in proposals],
                },
                trace_id=run_input.trace_id,
                deadline_ms=self._deadline_ms,
                started_at=started,
            )
        except Exception as error:
            raise _Fallback(
                f"dream_run_daily_unavailable:{type(error).__name__}"
            ) from error
        if not isinstance(result, dict):
            raise _Fallback("dream_run_daily_invalid_shape")
        run_id = result.get("runId")
        if not isinstance(run_id, str) or not run_id.strip():
            raise _Fallback("dream_run_daily_missing_run_id")
        accepted = result.get("accepted", 0)
        rejected = result.get("rejected", 0)
        failed = result.get("failed", 0)
        if not all(isinstance(value, int) for value in (accepted, rejected, failed)):
            raise _Fallback("dream_run_daily_invalid_counts")
        return DailyDreamResult(
            run_id=run_id,
            accepted=int(accepted),
            rejected=int(rejected),
            failed=int(failed),
            fallback_reason=None,
        )


class _Fallback(Exception):
    """Non-fatal fallback signal — never escapes run_daily."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _first_evidence_for_memory(
    memory_id: str,
    observation_ids: list[str],
    facts: JournalFacts,
) -> list[str]:
    """Return the first today observation as evidence for a memory change.

    M7-06: evidence is today-scoped only. We never reach into history. When no
    today observation is available, return an empty list (the caller skips the
    proposal rather than emit ungrounded evidence).
    """
    # The facts carry today_observation_ids in most-recent-first order. The
    # first one is the strongest grounding signal for a today consolidation.
    # A richer mapping (memory_id -> observation_id) would require the host to
    # expose the link; for v1 we use the most recent today observation.
    if not observation_ids:
        return []
    return [observation_ids[0]]


def fallback_result(reason: str) -> DailyDreamResult:
    """Construct a fail-closed fallback result (M7-08)."""
    return DailyDreamResult(
        run_id="",
        accepted=0,
        rejected=0,
        failed=0,
        fallback_reason=reason,
    )


__all__ = [
    "DEFAULT_COGNITIVE_DEADLINE_MS",
    "DreamRunInput",
    "DailyDreamOrchestrator",
    "fallback_result",
]
