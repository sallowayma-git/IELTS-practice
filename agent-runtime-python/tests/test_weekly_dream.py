from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from pydantic import ValidationError

from ielts_agent.dream.types import (
    CAPABILITY_DREAM_RUN_WEEKLY,
    CAPABILITY_LEARNING_WEEKLY_PACK,
    REQUIRED_WEEKLY_DREAM_HOST_CAPABILITIES,
    WEEKLY_MUTATION_ACTIONS,
    WeeklyDigest,
    WeeklyDreamResult,
)
from ielts_agent.dream.weekly import (
    DEFAULT_COGNITIVE_DEADLINE_MS,
    MAX_MUTATIONS,
    MIN_OBSERVATIONS,
    MODEL_MAX_ATTEMPTS,
    MODEL_RETRY_BACKOFF_SECONDS,
    WeeklyDreamInput,
    WeeklyDreamOrchestrator as _WeeklyDreamOrchestrator,
    fallback_result,
)
from ielts_agent.protocol import ProtocolError


def WeeklyDreamOrchestrator(bridge, **kwargs):  # noqa: N802 - keeps the class-style call sites
    """The production orchestrator, except that backoff never really sleeps."""
    kwargs.setdefault("sleep", lambda seconds: None)
    return _WeeklyDreamOrchestrator(bridge, **kwargs)


def _capabilities(extra: dict[str, str] | None = None) -> dict[str, str]:
    caps = dict(REQUIRED_WEEKLY_DREAM_HOST_CAPABILITIES)
    caps["model.invoke"] = "1"
    if extra:
        caps.update(extra)
    return caps


def _pack(observations: int = 14) -> dict:
    """A pack as the host builds it: record lines with citable ids, and memories."""
    return {
        "schemaVersion": 2,
        "window": {"start": "2026-10-03T00:00:00Z", "end": "2026-10-10T00:00:00Z"},
        "observationCount": observations,
        "header": {"reading": {"missedAcrossPassages": ["tfng (2 passages)"]}},
        "lines": [
            {"ids": ["obs-a1"], "date": "2026-10-04", "kind": "miss",
             "text": "P1 q14 [tfng] answered FALSE -> key TRUE"},
            {"ids": ["obs-b1"], "date": "2026-10-06", "kind": "miss",
             "text": "P2 q3 [tfng] answered NOT GIVEN -> key FALSE"},
            {"ids": ["obs-r1", "obs-r2"], "date": "2026-10-07", "kind": "redo",
             "text": 'redo P1 "Passage P1": fixed 1 of 2 earlier misses; still wrong q16'},
            {"date": "2026-10-08", "kind": "coach", "text": "coach on an attempt: feedback too_long"},
        ],
        "memories": [
            {"memoryId": "mem-1", "namespace": "strategy", "scope": "activity:reading",
             "canonicalKey": "strategy.reading.stem_first", "statement": "先读题干。", "version": 2},
        ],
        "preferences": [{"key": "explanation_language", "scope": "global", "value": '"zh"'}],
    }


def _add(**overrides) -> dict:
    mutation = {
        "action": "ADD", "namespace": "strategy", "canonicalKey": "strategy.reading.tfng_boundary",
        "scope": {"type": "activity", "key": "reading"},
        "statement": "判断题里容易把 False 与 Not Given 混为一谈。",
        "evidenceObservationIds": ["obs-a1", "obs-b1"],
    }
    mutation.update(overrides)
    return mutation


def _digest(**overrides) -> dict:
    digest = {
        "observations": ["P1 第 14 题和 P2 第 3 题都在判断题上选错"],
        "changes": ["重做 P1 后修正了一道错题，第 16 题仍然错"],
        "nextPractice": ["换一篇文章再练判断题"],
    }
    digest.update(overrides)
    return digest


def _answer(digest: dict | None = None, mutations: list | None = None) -> str:
    return json.dumps({"digest": _digest() if digest is None else digest,
                       "mutations": [_add()] if mutations is None else mutations})


def _dream_result_wire(*, run_id: str = "weekly-run-1", validated: int = 1, rejected: int = 0, accepted: int = 1) -> dict:
    return {"runId": run_id, "validated": validated, "rejected": rejected, "accepted": accepted}


class FakeHostBridge:
    """In-memory host bridge for weekly-dream tests."""

    def __init__(
        self,
        *,
        pack: dict | None = None,
        content: str | None = None,
        dream_result: dict | None = None,
        fail_methods: frozenset[str] | None = None,
    ) -> None:
        self.calls: list[tuple[str, dict]] = []
        self._pack = pack if pack is not None else _pack()
        self._content = content if content is not None else _answer()
        self._dream_result = dream_result or _dream_result_wire()
        self._fail_methods = fail_methods or frozenset()

    def invoke(self, method: str, params: dict, *, trace_id: str, deadline_ms: int, started_at: float) -> dict:
        self.calls.append((method, dict(params)))
        if method in self._fail_methods:
            raise ProtocolError("host_error", f"simulated failure for {method}", retryable=False)
        if method == CAPABILITY_LEARNING_WEEKLY_PACK:
            return self._pack
        if method == "model.invoke":
            return {"content": self._content}
        if method == CAPABILITY_DREAM_RUN_WEEKLY:
            return self._dream_result
        raise ProtocolError("method_not_found", f"unhandled fake method {method}")

    def methods(self) -> list[str]:
        return [method for method, _ in self.calls]

    def submitted(self) -> dict:
        return next(params for method, params in self.calls if method == CAPABILITY_DREAM_RUN_WEEKLY)


def _run(bridge: FakeHostBridge, **kwargs):
    return WeeklyDreamOrchestrator(bridge, **kwargs).run_weekly(
        WeeklyDreamInput(trace_id="trace-1", window="2026-W41", available_host_capabilities=_capabilities())
    )


class WeeklyDreamTypesTests(unittest.TestCase):
    def test_mutation_actions_are_exactly_new_reinforce_supersede_archive(self) -> None:
        self.assertEqual(WEEKLY_MUTATION_ACTIONS, frozenset({"ADD", "REINFORCE", "SUPERSEDE", "ARCHIVE"}))

    def test_digest_is_closed_bounded_and_plain(self) -> None:
        digest = WeeklyDigest.model_validate({"observations": ["a"], "nextPractice": ["b"]})
        self.assertEqual(digest.to_wire(), {"observations": ["a"], "changes": [], "nextPractice": ["b"]})
        for bad in ({"observations": [""]}, {"changes": ["x" * 401]}, {"observations": ["a"] * 7}, {"bogus": []}):
            with self.assertRaises(ValidationError):
                WeeklyDigest.model_validate(bad)

    def test_result_requires_run_id_when_not_fallback(self) -> None:
        with self.assertRaises(ValidationError):
            WeeklyDreamResult(run_id="", validated=0, rejected=0, accepted=0, fallback_reason=None)

    def test_result_fallback(self) -> None:
        result = WeeklyDreamResult(run_id="", validated=0, rejected=0, accepted=0, fallback_reason="x")
        self.assertEqual(result.fallback_reason, "x")

    def test_result_fallback_must_not_carry_counts(self) -> None:
        with self.assertRaises(ValidationError):
            WeeklyDreamResult(run_id="", validated=1, rejected=0, accepted=0, fallback_reason="x")

    def test_result_to_wire(self) -> None:
        result = WeeklyDreamResult(run_id="r", validated=2, rejected=1, accepted=2)
        self.assertEqual(result.to_wire(), {"runId": "r", "validated": 2, "rejected": 1, "accepted": 2, "fallbackReason": None})


class WeeklyDreamOrchestratorTests(unittest.TestCase):
    def test_one_model_call_over_the_pack_writes_digest_and_mutations(self) -> None:
        bridge = FakeHostBridge()
        result = _run(bridge)
        self.assertIsNone(result.fallback_reason)
        self.assertEqual((result.run_id, result.validated, result.accepted), ("weekly-run-1", 1, 1))
        self.assertEqual(bridge.methods(), [CAPABILITY_LEARNING_WEEKLY_PACK, "model.invoke", CAPABILITY_DREAM_RUN_WEEKLY])
        # The window is the host's opaque token, sent back unchanged on the host reads and the submission.
        self.assertEqual(bridge.calls[0][1], {"window": "2026-W41"})
        submitted = bridge.submitted()
        self.assertEqual(submitted["window"], "2026-W41")
        self.assertEqual(submitted["digest"], _digest())
        self.assertEqual(submitted["mutations"], [_add()])

    def test_the_model_sees_the_pack_verbatim_and_a_bounded_request(self) -> None:
        bridge = FakeHostBridge()
        _run(bridge)
        request = bridge.calls[1][1]["request"]
        self.assertEqual(request["maxTokens"], 1_500)
        self.assertEqual(request["temperature"], 0.0)
        system, user = (message["content"] for message in request["messages"])
        payload = json.loads(user)
        self.assertEqual(payload["pack"], _pack())
        for needed in ("lines[].ids", "Simplified Chinese", "untrusted data", "ARCHIVE", "repeated misses"):
            self.assertIn(needed, system)
        self.assertNotIn("passage text", user)

    def test_a_mutation_must_cite_ids_of_the_pack(self) -> None:
        mutations = [
            _add(evidenceObservationIds=["obs-forged"]),
            _add(evidenceObservationIds=["obs-a1", "obs-forged"]),
            _add(evidenceObservationIds=[]),
            _add(evidenceObservationIds=["obs-a1", "obs-a1"]),
            _add(evidenceObservationIds="obs-a1"),
            {"action": "REINFORCE", "targetMemoryId": "mem-1", "evidenceObservationIds": ["obs-r1"]},
        ]
        bridge = FakeHostBridge(content=_answer(mutations=mutations))
        _run(bridge)
        self.assertEqual([m["action"] for m in bridge.submitted()["mutations"]], ["REINFORCE"])

    def test_a_mutation_may_only_target_memories_of_the_pack(self) -> None:
        mutations = [
            {"action": "REINFORCE", "targetMemoryId": "mem-other", "evidenceObservationIds": ["obs-a1"]},
            {"action": "ARCHIVE", "targetMemoryId": ["mem-1"], "evidenceObservationIds": ["obs-a1"]},
            {"action": "ARCHIVE", "targetMemoryId": "mem-1", "evidenceObservationIds": ["obs-r2"]},
            {"action": "SUPERSEDE", "targetMemoryId": "mem-1", "namespace": "strategy",
             "canonicalKey": "strategy.reading.stem_first_v2", "scope": {"type": "activity", "key": "reading"},
             "proposedStatement": "先读题干，再找定位词。", "evidenceObservationIds": ["obs-a1"]},
        ]
        bridge = FakeHostBridge(content=_answer(mutations=mutations))
        _run(bridge)
        self.assertEqual([m["action"] for m in bridge.submitted()["mutations"]], ["ARCHIVE", "SUPERSEDE"])

    def test_unknown_actions_extra_fields_and_bad_shapes_are_dropped(self) -> None:
        mutations = [
            _add(action="REFINE"),
            _add(action="regress"),
            {**_add(), "confidence": 0.99},
            _add(namespace="astrology", canonicalKey="astrology.reading.x"),
            _add(canonicalKey="strategy.Reading.Caps"),
            _add(canonicalKey="language.reading.wrong_namespace"),
            _add(scope={"type": "activity", "key": "listening"}),
            _add(scope={"type": "global", "key": "reading"}),
            _add(scope={"type": "activity", "key": ["reading"]}),
            _add(statement=""),
            _add(statement="长" * 301),
            "not a dict",
            None,
            _add(),
        ]
        bridge = FakeHostBridge(content=_answer(mutations=mutations))
        _run(bridge)
        self.assertEqual(bridge.submitted()["mutations"], [_add()])

    def test_mutations_are_bounded(self) -> None:
        many = [_add(canonicalKey=f"strategy.reading.k{i}") for i in range(MAX_MUTATIONS + 5)]
        bridge = FakeHostBridge(content=_answer(mutations=many))
        _run(bridge)
        self.assertEqual(len(bridge.submitted()["mutations"]), MAX_MUTATIONS)

    def test_the_digest_is_cleaned_and_bounded_before_submission(self) -> None:
        digest = {"observations": [" spaced   out ", "", 5, None] + ["x"] * 10, "changes": "not a list",
                  "nextPractice": ["长" * 500]}
        bridge = FakeHostBridge(content=_answer(digest=digest, mutations=[]))
        _run(bridge)
        sent = bridge.submitted()["digest"]
        self.assertEqual(sent["observations"][0], "spaced out")
        self.assertEqual(len(sent["observations"]), 6)
        self.assertEqual(sent["changes"], [])
        self.assertEqual(len(sent["nextPractice"][0]), 240)

    def test_too_little_evidence_skips_the_model_and_still_records_the_run(self) -> None:
        bridge = FakeHostBridge(pack=_pack(MIN_OBSERVATIONS - 1))
        result = _run(bridge)
        self.assertIsNone(result.fallback_reason)
        self.assertEqual(bridge.methods(), [CAPABILITY_LEARNING_WEEKLY_PACK, CAPABILITY_DREAM_RUN_WEEKLY])
        self.assertEqual(bridge.submitted()["mutations"], [])
        self.assertEqual(bridge.submitted()["digest"], {"observations": [], "changes": [], "nextPractice": []})
        # Exactly at the threshold the model is called.
        bridge = FakeHostBridge(pack=_pack(MIN_OBSERVATIONS))
        _run(bridge)
        self.assertIn("model.invoke", bridge.methods())

    def test_no_model_path_yields_an_empty_success(self) -> None:
        bridge = FakeHostBridge()
        caps = dict(REQUIRED_WEEKLY_DREAM_HOST_CAPABILITIES)
        result = WeeklyDreamOrchestrator(bridge).run_weekly(
            WeeklyDreamInput(trace_id="t", window="2026-W41", available_host_capabilities=caps))
        self.assertIsNone(result.fallback_reason)
        self.assertNotIn("model.invoke", bridge.methods())
        self.assertEqual(bridge.submitted()["mutations"], [])

    def test_an_empty_answer_is_a_success(self) -> None:
        for empty in ('{"digest":{"observations":[],"changes":[],"nextPractice":[]},"mutations":[]}',
                      '{"mutations":[]}', '{"digest":{}}'):
            with self.subTest(empty=empty):
                bridge = FakeHostBridge(content=empty)
                result = _run(bridge)
                self.assertIsNone(result.fallback_reason)
                self.assertEqual(bridge.methods().count("model.invoke"), 1)
                self.assertEqual(bridge.submitted()["mutations"], [])

    def test_fail_closed_pack_failure(self) -> None:
        bridge = FakeHostBridge(fail_methods=frozenset({CAPABILITY_LEARNING_WEEKLY_PACK}))
        result = _run(bridge)
        self.assertIn("weekly_pack_unavailable", result.fallback_reason)
        self.assertEqual(result.run_id, "")
        self.assertEqual(bridge.methods(), [CAPABILITY_LEARNING_WEEKLY_PACK])

    def test_invalid_packs_are_a_fallback(self) -> None:
        for pack, reason in (
            ([], "weekly_pack_invalid_shape"),
            ({"lines": [], "memories": []}, "weekly_pack_missing_observation_count"),
            ({"observationCount": True, "lines": [], "memories": []}, "weekly_pack_missing_observation_count"),
            ({"observationCount": 9, "memories": []}, "weekly_pack_missing_lines"),
            ({"observationCount": 9, "lines": []}, "weekly_pack_missing_lines"),
        ):
            with self.subTest(pack=pack):
                bridge = FakeHostBridge(pack=pack)
                self.assertEqual(_run(bridge).fallback_reason, reason)
                self.assertNotIn("model.invoke", bridge.methods())

    def test_fail_closed_submission_failure(self) -> None:
        bridge = FakeHostBridge(fail_methods=frozenset({CAPABILITY_DREAM_RUN_WEEKLY}))
        self.assertIn("dream_run_weekly_unavailable", _run(bridge).fallback_reason)

    def test_the_model_failing_is_a_fallback_not_an_empty_success(self) -> None:
        bridge = FakeHostBridge(fail_methods=frozenset({"model.invoke"}))
        result = _run(bridge)
        self.assertIn("model_invoke_failed", result.fallback_reason)
        self.assertNotIn(CAPABILITY_DREAM_RUN_WEEKLY, bridge.methods())

    def test_missing_capabilities_fallback(self) -> None:
        bridge = FakeHostBridge()
        result = WeeklyDreamOrchestrator(bridge).run_weekly(
            WeeklyDreamInput(trace_id="t", window="w", available_host_capabilities={"model.invoke": "1"}))
        self.assertIn("capability_mismatch", result.fallback_reason)
        self.assertEqual(bridge.calls, [])
        empty = WeeklyDreamOrchestrator(bridge).run_weekly(WeeklyDreamInput(trace_id="t", window="w"))
        self.assertEqual(empty.fallback_reason, "host_capabilities_unavailable")

    def test_capability_version_mismatch_fallback(self) -> None:
        caps = _capabilities()
        caps[CAPABILITY_LEARNING_WEEKLY_PACK] = "9"
        bridge = FakeHostBridge()
        result = WeeklyDreamOrchestrator(bridge).run_weekly(
            WeeklyDreamInput(trace_id="t", window="w", available_host_capabilities=caps))
        self.assertIn("capability_mismatch", result.fallback_reason)

    def test_the_weekly_pass_reads_one_pack_and_writes_only_through_the_host_authority(self) -> None:
        bridge = FakeHostBridge()
        _run(bridge)
        self.assertEqual(set(bridge.methods()), {CAPABILITY_LEARNING_WEEKLY_PACK, "model.invoke", CAPABILITY_DREAM_RUN_WEEKLY})
        self.assertEqual(set(REQUIRED_WEEKLY_DREAM_HOST_CAPABILITIES), {CAPABILITY_LEARNING_WEEKLY_PACK, CAPABILITY_DREAM_RUN_WEEKLY})

    def test_dream_result_shapes_fail_closed(self) -> None:
        for wire, reason in (
            ({"validated": 1, "rejected": 0, "accepted": 1}, "dream_run_weekly_missing_run_id"),
            ({"runId": "r", "validated": "1", "rejected": 0, "accepted": 0}, "dream_run_weekly_invalid_counts"),
        ):
            with self.subTest(wire=wire):
                self.assertEqual(_run(FakeHostBridge(dream_result=wire)).fallback_reason, reason)

    def test_never_raises_fatal_on_unexpected_error(self) -> None:
        class Exploding(FakeHostBridge):
            def invoke(self, method, params, **kwargs):  # type: ignore[override]
                if method == "model.invoke":
                    raise ValueError("boom")
                return super().invoke(method, params, **kwargs)

        result = _run(Exploding())
        self.assertTrue(result.fallback_reason)

    def test_constants(self) -> None:
        self.assertEqual(DEFAULT_COGNITIVE_DEADLINE_MS, 400_000)
        self.assertEqual(MIN_OBSERVATIONS, 8)
        self.assertEqual(fallback_result("why").fallback_reason, "why")


class ScriptedModelBridge(FakeHostBridge):
    """Serves ``model.invoke`` from a script: each entry is the next reply
    (a content string, a raw dict result) or an exception to raise."""

    def __init__(self, script: list) -> None:
        super().__init__()
        self._script = list(script)

    @property
    def model_calls(self) -> int:
        return sum(1 for method, _ in self.calls if method == "model.invoke")

    def invoke(self, method, params, **kwargs):  # type: ignore[override]
        if method != "model.invoke":
            return super().invoke(method, params, **kwargs)
        self.calls.append((method, dict(params)))
        step = self._script.pop(0)
        if isinstance(step, Exception):
            raise step
        return step if isinstance(step, dict) else {"content": step}


def _transient() -> ProtocolError:
    return ProtocolError("host_request_failed", "AI provider returned HTTP 503", retryable=True)


class WeeklyRetryTests(unittest.TestCase):
    """One attempt = at most MODEL_MAX_ATTEMPTS model calls, with backoff."""

    def _run(self, script, **kwargs):
        sleeps: list[float] = []
        bridge = ScriptedModelBridge(script)
        orchestrator = _WeeklyDreamOrchestrator(bridge, sleep=sleeps.append, **kwargs)
        result = orchestrator.run_weekly(
            WeeklyDreamInput(trace_id="t", window="2026-W41", available_host_capabilities=_capabilities()))
        return result, bridge, sleeps

    def _submitted(self, bridge: ScriptedModelBridge) -> bool:
        return CAPABILITY_DREAM_RUN_WEEKLY in bridge.methods()

    def test_constants(self) -> None:
        self.assertEqual(MODEL_MAX_ATTEMPTS, 3)
        self.assertEqual(MODEL_RETRY_BACKOFF_SECONDS, (2.0, 5.0))

    def test_first_call_success_makes_one_call_and_never_sleeps(self) -> None:
        result, bridge, sleeps = self._run([_answer()])
        self.assertIsNone(result.fallback_reason)
        self.assertEqual((bridge.model_calls, sleeps), (1, []))

    def test_a_transient_provider_error_is_retried_with_backoff(self) -> None:
        result, bridge, sleeps = self._run([_transient(), _answer()])
        self.assertIsNone(result.fallback_reason)
        self.assertEqual(bridge.model_calls, 2)
        self.assertEqual(sleeps, [2.0])
        self.assertTrue(self._submitted(bridge))

    def test_malformed_output_is_retried_in_every_shape(self) -> None:
        for bad in ("not json at all", "", "{}", '{"digest": null}', '{"digest": []}', '{"mutations": {}}',
                    "[1]", "[]", '{"patterns": []}', {"content": None}, {"nothing": "here"}, {"content": "   "}):
            with self.subTest(bad=bad):
                result, bridge, sleeps = self._run([bad, bad, _answer()])
                self.assertIsNone(result.fallback_reason)
                self.assertEqual((bridge.model_calls, sleeps), (3, [2.0, 5.0]))

    def test_the_attempt_is_bounded_to_three_calls_then_fails_closed(self) -> None:
        result, bridge, sleeps = self._run(["nope", "still nope", "never json"])
        self.assertEqual(result.fallback_reason, "model_output_invalid_json")
        self.assertEqual((bridge.model_calls, sleeps), (3, [2.0, 5.0]))
        self.assertFalse(self._submitted(bridge), "a failed attempt submits nothing")
        # The extra scripted answers must be untouched: the loop never makes a fourth call.
        result, bridge, _ = self._run([_transient()] * 3 + [_answer()])
        self.assertIn("model_invoke_failed:ProtocolError", result.fallback_reason)
        self.assertEqual(bridge.model_calls, 3)

    def test_provider_errors_and_bad_output_share_one_budget(self) -> None:
        result, bridge, sleeps = self._run([_transient(), "garbage", _transient()])
        self.assertTrue(result.fallback_reason)
        self.assertEqual((bridge.model_calls, sleeps), (3, [2.0, 5.0]))

    def test_a_genuine_empty_result_is_a_success_and_never_retried(self) -> None:
        result, bridge, sleeps = self._run(['{"digest":{},"mutations":[]}'])
        self.assertIsNone(result.fallback_reason)
        self.assertEqual((bridge.model_calls, sleeps), (1, []))
        self.assertEqual(bridge.submitted()["mutations"], [])

    def test_unfixable_failures_are_not_retried(self) -> None:
        for error in (
            ProtocolError("host_request_failed", "AI provider returned HTTP 401: bad key", retryable=False),
            ProtocolError("deadline_exceeded", "cognitive request deadline expired", retryable=True),
            RuntimeError("unexpected"),
        ):
            with self.subTest(error=error):
                result, bridge, sleeps = self._run([error, _answer()])
                self.assertTrue(result.fallback_reason)
                self.assertEqual((bridge.model_calls, sleeps), (1, []))

    def test_no_retry_is_started_without_time_for_it(self) -> None:
        # 4 s of budget cannot hold a 2 s pause plus a 5 s attempt.
        result, bridge, sleeps = self._run(["garbage", _answer()], cognitive_deadline_ms=4_000)
        self.assertEqual(result.fallback_reason, "model_output_invalid_json")
        self.assertEqual((bridge.model_calls, sleeps), (1, []))

    def test_every_retry_carries_the_same_bounded_request(self) -> None:
        _, bridge, _ = self._run(["garbage", "garbage", _answer()])
        requests = [params["request"] for method, params in bridge.calls if method == "model.invoke"]
        self.assertEqual(len(requests), 3)
        self.assertTrue(all(request == requests[0] for request in requests))
        self.assertEqual(requests[0]["maxTokens"], 1_500)


if __name__ == "__main__":
    unittest.main()
