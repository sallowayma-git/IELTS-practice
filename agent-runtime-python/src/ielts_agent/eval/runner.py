"""M11-05 candidate lifecycle orchestrator (Python Slice 2).

Owns the **experiment/eval orchestration** that turns a candidate proposal
into a locally graded eval run and (on success) a shadow run. Rust (Slice 1)
is the release gate; Python only proposes and orchestrates. The orchestrator
never opens the canonical SQLite, never holds provider secrets, and all
prompt/skill access goes through the host gateway (``host_bridge.invoke``).

Round-3 audit (A2) narrowed this boundary. The host no longer serves
``prompt.promote_candidate``, ``prompt.rollback`` or ``eval.run_case`` to the
runtime, because each is an authority operation and ``eval.run_case`` in
particular let the runtime author the pass/fail evidence that gated its own
approval. Consequently :meth:`promote_candidate` and
:meth:`rollback_candidate` always refuse, and eval grades produced here are
local audit output only — never promotion evidence. A real eval gate must
compute its verdict inside the Rust authority, as M10's strategy-candidate
evaluator does.

Hard rules enforced here (M11 plan §9040-9200):

- **candidate cannot skip eval (M11-05).** A candidate that has not passed
  a full eval run is never promoted. Since the runtime can no longer record
  eval evidence at all, :meth:`promote_candidate` refuses unconditionally;
  the surviving gate is the Rust/UI promotion path.
- **holdout never enters prompt generation context (M11-05).** The runner
  partitions the frozen case set on the holdout flag. Holdout cases are
  only ever passed to the gated eval runner, never to any prompt-context
  path. :meth:`prompt_generation_cases` returns only non-holdout cases.
- **shadow has no user-visible side effect (M11-05).** Shadow runs are
  marked ``no_user_visible_side_effect=True`` and are recorded via the host
  gateway as shadow (never as a live promotion). A shadow run result never
  reaches a user.
- **rollback exact (M11-05).** Rollback restores precisely the pre-candidate
  version. It is now a host-only operation; :meth:`rollback_candidate`
  refuses so the runtime cannot reverse a live version without approval.
- **prompt/skill version pinned in trace (M11-08).** Every eval run result
  records the pinned prompt_version_id and skill_version_id.
- **evaluation data isolation.** Each eval run is scoped to one candidate
  version; cases do not leak across candidates.
- **no-LLM path + fail-closed.** Deterministic graders run by default
  (no ``model.invoke``). Host failure → ``fallback_result`` (non-fatal);
  the runner never raises from a host call.
- **M11-06 forbidden.** The orchestrator never offers an
  ``update_system_prompt`` / ``edit_soul`` / ``install_unreviewed_skill``
  path. Those agent tools are blacklisted on the Rust side; Python never
  calls them.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Protocol

from .cases import frozen_eval_cases, holdout_cases, non_holdout_cases
from .graders import grade_trace
from .types import (
    CAPABILITY_PROMPT_GET_ACTIVE,
    CAPABILITY_PROMPT_PROPOSE_CANDIDATE,
    REQUIRED_EVAL_HOST_CAPABILITIES,
    CandidateProposal,
    CandidateTargetKind,
    EvalCase,
    EvalRunResult,
)

DEFAULT_COGNITIVE_DEADLINE_MS = 8_000

# M11-06 agent-tool blacklist. The orchestrator refuses to invoke any of
# these methods. They are forbidden online self-modifying-prompt tools.
FORBIDDEN_AGENT_TOOLS: frozenset[str] = frozenset(
    {
        "update_system_prompt",
        "edit_soul",
        "install_unreviewed_skill",
    }
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
class EvalRunInput:
    """Frozen input for one gated eval run against a candidate version.

    The runner evaluates ``cases`` (already partitioned: non-holdout for
    candidate-improvement eval, holdout for the final gated eval) against
    the candidate version id. ``shadow`` marks a shadow run (no user-visible
    side effect). ``base_version_id`` is the pre-candidate version, required
    for exact rollback.
    """

    trace_id: str
    target_kind: CandidateTargetKind
    target_version_id: str
    base_version_id: str
    cases: tuple[EvalCase, ...]
    shadow: bool = False
    # The pinned prompt/skill versions for this run (recorded in the trace).
    prompt_version_id: str = ""
    skill_version_id: str = ""
    # The traces to grade, keyed by case_id. In a real run the host produces
    # these; for tests/the no-LLM path the caller supplies them directly so
    # the grader is deterministic without a live model.
    traces: dict[str, dict[str, Any]] = field(default_factory=dict)


class EvalOrchestrator:
    """M11 candidate lifecycle orchestrator (Python side, fail-closed).

    Constructed with a host bridge and the set of required host capabilities.
    If a required capability is missing or a host call fails, the
    orchestrator returns a non-fatal fallback result instead of raising —
    the Rust authority remains the release gate. Python owns eval
    orchestration only.
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
            required_capabilities or REQUIRED_EVAL_HOST_CAPABILITIES
        )
        self._deadline_ms = cognitive_deadline_ms
        # Eval evidence registry (in-memory, per-orchestrator). Maps a
        # candidate version id to its passing eval run id. A candidate
        # cannot be promoted without an entry here. The Rust authority is
        # the final gate, but Python refuses to issue the promote call
        # without local eval evidence (candidate cannot skip eval).
        self._eval_evidence: dict[str, str] = {}

    # --- M11-05: holdout isolation --------------------------------------

    def prompt_generation_cases(self) -> tuple[EvalCase, ...]:
        """Return ONLY non-holdout cases.

        Holdout cases NEVER enter prompt generation context (M11-05). Any
        code path that feeds cases into prompt generation must call this,
        never :meth:`frozen_eval_cases` directly.
        """
        return non_holdout_cases()

    def gated_eval_cases(self) -> tuple[EvalCase, ...]:
        """Return the full frozen case set for the gated eval.

        The gated eval (the final eval before promotion) runs against ALL
        cases including holdout. Holdout cases are only ever consumed here,
        never in prompt generation.
        """
        return frozen_eval_cases()

    def holdout_cases(self) -> tuple[EvalCase, ...]:
        """Return only the holdout cases (for audit / isolation checks)."""
        return holdout_cases()

    # --- M11-05: propose -------------------------------------------------

    def propose_candidate(
        self,
        proposal: CandidateProposal,
        *,
        trace_id: str,
        available_host_capabilities: dict[str, str] | None = None,
    ) -> str | None:
        """Submit a candidate proposal via ``prompt.propose_candidate``.

        Returns the candidate version id assigned by the Rust authority, or
        None on non-fatal fallback. The orchestrator never assigns its own
        version id — Rust is the authority. Never raises.
        """
        started = time.monotonic()
        try:
            self._check_capabilities(available_host_capabilities or {})
            result = self._bridge.invoke(
                CAPABILITY_PROMPT_PROPOSE_CANDIDATE,
                {"proposal": proposal.to_wire()},
                trace_id=trace_id,
                deadline_ms=self._deadline_ms,
                started_at=started,
            )
            if not isinstance(result, dict):
                return None
            candidate_id = result.get("candidateVersionId")
            if not isinstance(candidate_id, str) or not candidate_id.strip():
                return None
            return candidate_id
        except _Fallback:
            return None
        except Exception:  # pragma: no cover - last-resort boundary
            return None

    # --- M11-05: offline eval -------------------------------------------

    def run_eval(
        self,
        run_input: EvalRunInput,
        *,
        available_host_capabilities: dict[str, str] | None = None,
    ) -> EvalRunResult:
        """Run the gated eval against a candidate version.

        Grades each case trace with the deterministic grader (no-LLM path by
        default). Records the run via ``eval.run_case`` (fail-closed: host
        failure → fallback result, non-fatal). Shadow runs are marked
        ``no_user_visible_side_effect=True``. On success (all cases pass),
        records the eval evidence so :meth:`promote_candidate` will accept
        the candidate.

        Never raises.
        """
        started = time.monotonic()
        try:
            self._check_capabilities(available_host_capabilities or {})
            return self._run_eval(run_input, started=started)
        except _Fallback as fallback:
            return _fallback_run_result(run_input, fallback.reason)
        except Exception as error:  # pragma: no cover - last-resort boundary
            return _fallback_run_result(
                run_input, f"unexpected_error:{type(error).__name__}"
            )

    def _run_eval(
        self, run_input: EvalRunInput, *, started: float
    ) -> EvalRunResult:
        cases = run_input.cases
        traces = run_input.traces

        # Pin the prompt/skill versions into the trace (M11-08). Prefer the
        # run input's explicit pin; fall back to the first case's pin.
        prompt_version_id = run_input.prompt_version_id or (
            cases[0].prompt_version_id if cases else ""
        )
        skill_version_id = run_input.skill_version_id or (
            cases[0].skill_version_id if cases else ""
        )

        passed = 0
        failed = 0
        metrics: dict[str, float] = {}

        per_case_grades: list[float] = []
        for case in cases:
            trace = traces.get(case.case_id, {})
            grade = grade_trace(
                case_id=case.case_id,
                trace=trace,
                expected=case.expected,
            )
            if grade.passed:
                passed += 1
            else:
                failed += 1
            per_case_grades.append(grade.final_answer_quality)

        # Aggregate metric: mean final-answer quality across cases.
        if per_case_grades:
            metrics["finalAnswerQualityMean"] = round(
                sum(per_case_grades) / len(per_case_grades), 4
            )
        metrics["passRate"] = (
            round(passed / len(cases), 4) if cases else 0.0
        )

        # Round-3 audit (A2): the host no longer accepts runtime-authored eval
        # verdicts. `eval.run_case` persisted these caller-supplied pass/fail
        # counts AND advanced the candidate to `eval_passed`, which is the sole
        # precondition for approval — so the runtime could author the very
        # evidence the human gate reviews. The grades below remain valid local
        # audit output, but they are NOT eval evidence and cannot unlock a
        # promotion. A real eval gate must compute its verdict inside the Rust
        # authority, the way M10's strategy-candidate evaluator does.
        run_id = f"eval-run-{run_input.target_version_id}-{int(started * 1000)}"
        recorded = False

        run_result = EvalRunResult(
            runId=run_id,
            targetKind=run_input.target_kind,
            targetVersionId=run_input.target_version_id,
            passedCount=passed,
            failedCount=failed,
            metrics=metrics,
            promptVersionId=prompt_version_id,
            skillVersionId=skill_version_id,
            noUserVisibleSideEffect=run_input.shadow,
            fallback=not recorded,
            fallbackReason=None if recorded else "eval_run_case_not_recorded",
        )

        # Record eval evidence locally so promote_candidate accepts this
        # candidate. Only a PASSING run counts as evidence.
        if run_result.passed:
            self._eval_evidence[run_input.target_version_id] = run_id

        return run_result

    # --- M11-05: shadow (no user-visible side effect) -------------------

    def run_shadow(
        self,
        run_input: EvalRunInput,
        *,
        available_host_capabilities: dict[str, str] | None = None,
    ) -> EvalRunResult:
        """Run a shadow eval against a candidate version.

        A shadow run is identical to a normal eval run but marked
        ``no_user_visible_side_effect=True``. It NEVER reaches a user. The
        host gateway records it as a shadow run (never as a live promotion).
        """
        shadow_input = EvalRunInput(
            trace_id=run_input.trace_id,
            target_kind=run_input.target_kind,
            target_version_id=run_input.target_version_id,
            base_version_id=run_input.base_version_id,
            cases=run_input.cases,
            shadow=True,
            prompt_version_id=run_input.prompt_version_id,
            skill_version_id=run_input.skill_version_id,
            traces=run_input.traces,
        )
        return self.run_eval(
            shadow_input,
            available_host_capabilities=available_host_capabilities,
        )

    # --- M11-05: promote (candidate cannot skip eval) -------------------

    def promote_candidate(
        self,
        *,
        target_kind: CandidateTargetKind,
        target_version_id: str,
        eval_run_id: str,
        trace_id: str,
        available_host_capabilities: dict[str, str] | None = None,
    ) -> bool:
        """Always refuses: promotion is a host-only authority operation.

        Round-3 audit (A2). Activating a prompt/skill version is an authority
        decision, so the host stopped serving ``prompt.promote_candidate`` to
        the runtime. This method is kept — rather than deleted — so any caller
        keeps its signature and gets an explicit, auditable refusal instead of
        an opaque transport error. Promotion happens through the Tauri command
        path, where the approval gate and audit trail live.

        Always returns False. Never raises.
        """
        del target_kind, target_version_id, eval_run_id, trace_id
        del available_host_capabilities
        return False

    # --- M11-05: rollback exact -----------------------------------------

    def rollback_candidate(
        self,
        *,
        target_kind: CandidateTargetKind,
        target_version_id: str,
        base_version_id: str,
        trace_id: str,
        available_host_capabilities: dict[str, str] | None = None,
    ) -> bool:
        """Always refuses: rollback is a host-only authority operation.

        Round-3 audit (A2). Reversing a live version is the same class of
        authority as activating one, and it had no approval gate at all, so the
        host stopped serving ``prompt.rollback`` to the runtime. Kept as an
        explicit refusal for the same reason as :meth:`promote_candidate`.
        Rollback happens through the Tauri command path.

        Always returns False. Never raises.
        """
        del target_kind, target_version_id, base_version_id, trace_id
        del available_host_capabilities
        return False

    # --- M11-08: version pinning audit ----------------------------------

    def get_active_versions(
        self,
        *,
        module: str,
        trace_id: str,
        available_host_capabilities: dict[str, str] | None = None,
    ) -> dict[str, str]:
        """Fetch the active prompt/skill versions for a module via
        ``prompt.get_active``. Returns an empty dict on fallback. Never
        raises."""
        started = time.monotonic()
        try:
            self._check_capabilities(available_host_capabilities or {})
            result = self._bridge.invoke(
                CAPABILITY_PROMPT_GET_ACTIVE,
                {"module": module},
                trace_id=trace_id,
                deadline_ms=self._deadline_ms,
                started_at=started,
            )
            if not isinstance(result, dict):
                return {}
            versions: dict[str, str] = {}
            for key in ("promptVersionId", "skillVersionId"):
                value = result.get(key)
                if isinstance(value, str) and value:
                    versions[key] = value
            return versions
        except _Fallback:
            return {}
        except Exception:  # pragma: no cover - last-resort boundary
            return {}

    # --- M11-06: forbidden tool guard ----------------------------------

    def is_forbidden_agent_tool(self, method: str) -> bool:
        """M11-06: refuse to invoke any forbidden online self-modifying
        prompt tool. The orchestrator never calls these; this guard is an
        explicit check for audit/test."""
        return method in FORBIDDEN_AGENT_TOOLS

    # --- internal -------------------------------------------------------

    def _check_capabilities(self, available: dict[str, str]) -> None:
        if not available:
            raise _Fallback("host_capabilities_unavailable")
        for capability, version in self._required.items():
            if available.get(capability) != version:
                raise _Fallback(
                    f"capability_mismatch:{capability}:expected:{version}:"
                    f"got:{available.get(capability)}"
                )

    # test/audit hook
    def _has_eval_evidence(self, target_version_id: str) -> bool:
        return target_version_id in self._eval_evidence


class _Fallback(Exception):
    """Non-fatal fallback signal — never escapes the public methods."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _fallback_run_result(run_input: EvalRunInput, reason: str) -> EvalRunResult:
    """Construct a fail-closed fallback eval run result.

    A fallback result always has failed_count > 0 (so it never counts as a
    passing eval) and is marked ``fallback=True``. This ensures a host
    failure can never accidentally promote a candidate: no eval evidence is
    recorded, so :meth:`promote_candidate` refuses.
    """
    prompt_version_id = run_input.prompt_version_id or (
        run_input.cases[0].prompt_version_id if run_input.cases else ""
    )
    skill_version_id = run_input.skill_version_id or (
        run_input.cases[0].skill_version_id if run_input.cases else ""
    )
    return EvalRunResult(
        runId=f"fallback-{run_input.target_version_id}",
        targetKind=run_input.target_kind,
        targetVersionId=run_input.target_version_id,
        passedCount=0,
        failedCount=max(1, len(run_input.cases)),
        metrics={},
        promptVersionId=prompt_version_id,
        skillVersionId=skill_version_id,
        noUserVisibleSideEffect=run_input.shadow,
        fallback=True,
        fallbackReason=reason,
    )


def fallback_result(reason: str) -> EvalRunResult:
    """Public fail-closed fallback helper.

    Constructs a minimal fallback eval run result that never passes (so it
    can never be used as eval evidence for promotion).
    """
    return EvalRunResult(
        runId=f"fallback-{reason}",
        targetKind=CandidateTargetKind.PROMPT,
        targetVersionId="fallback",
        passedCount=0,
        failedCount=1,
        metrics={},
        promptVersionId="fallback",
        skillVersionId="fallback",
        noUserVisibleSideEffect=True,
        fallback=True,
        fallbackReason=reason,
    )


__all__ = [
    "DEFAULT_COGNITIVE_DEADLINE_MS",
    "FORBIDDEN_AGENT_TOOLS",
    "EvalRunInput",
    "EvalOrchestrator",
    "fallback_result",
]
