from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from pydantic import ValidationError

from ielts_agent.dream import weekly as weekly_module
from ielts_agent.dream.types import (
    CAPABILITY_DREAM_RUN_WEEKLY,
    CAPABILITY_LEARNING_WEEKLY_PACK,
    REQUIRED_WEEKLY_DREAM_HOST_CAPABILITIES,
    WEEKLY_MUTATION_ACTIONS,
    WeeklyNarrative,
    WeeklyDreamResult,
)
from ielts_agent.dream.weekly import (
    DEFAULT_COGNITIVE_DEADLINE_MS,
    MAX_MUTATIONS,
    MIN_OBSERVATIONS,
    MODEL_MAX_ATTEMPTS,
    MODEL_RETRY_BACKOFF_SECONDS,
    WEEKLY_MODEL_MAX_TOKENS,
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
    """A v3 pack as the host builds it: lines, blocks, facts, soul and persona."""
    return {
        "schemaVersion": 3,
        "window": {"start": "2026-10-03T00:00:00Z", "end": "2026-10-10T00:00:00Z"},
        "observationCount": observations,
        "header": {"reading": {"missedAcrossPassages": ["tfng (2 passages)"]}},
        "omitted": 2,
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
        "blocks": [
            {"id": "volume", "kind": "volume",
             "data": {"readingAttempts": 4, "writingEssays": 2, "activeDays": 3}},
            {"id": "question_types", "kind": "question_types",
             "data": {"types": [{"qtype": "tfng", "label": "判断题", "wrong": 4,
                                 "answered": 8, "assetIds": ["p1", "p2"]}]}},
        ],
        "facts": {
            "volume.reading": {"value": 4, "label": "本周阅读篇数", "format": "number", "source": "volume"},
            "qtype.tfng.wrong": {"value": 4, "label": "「判断题」错题数", "format": "number",
                                 "source": "question_types", "provenance": {"assetIds": ["p1", "p2"]}},
            "accuracy.rate": {"value": 0.75, "label": "本周正确率", "format": "percent",
                              "source": "accuracy"},
        },
        "soul": {"soul.address": "你", "soul.tone": "平衡", "soul.targetBand": 7.0},
        "persona": "你是长期陪练的老师，认真读这周的答案后，给学生写一封简短周记。",
        "previousDigest": {"title": "上周先核对题干", "body": ["上周建议先读题干。"]},
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
        "title": "判断题要慢一点",
        "body": ["这周完成了 {{f:volume.reading}} 篇阅读。", "样本还不多，先看判断题。"],
        "changes": [{"text": "重做后改对了一道题。"}],
        "nextSteps": [{"text": "再做两套判断题。",
                       "target": {"type": "kind", "key": "reading.tfng"}}],
        "strengths": [{"text": "完成了阅读练习。"}],
        "weaknesses": [{"text": "判断题仍然出错。"}],
    }
    digest.update(overrides)
    return digest


def _answer(
    digest: dict | None = None,
    mutations: list | None = None,
    edits: list | None = None,
) -> str:
    return json.dumps({
        "digest": _digest() if digest is None else digest,
        "profileEdits": [] if edits is None else edits,
        "mutations": [_add()] if mutations is None else mutations,
    })


_EMPTY_DIGEST = {
    "title": "",
    "body": [],
    "changes": [],
    "nextSteps": [],
    "strengths": [],
    "weaknesses": [],
}
_CLEAN_PREFLIGHT = {"usable": True, "needsRepair": False, "droppedSentences": 0, "violations": []}


def _dream_result_wire(*, run_id: str = "weekly-run-1", validated: int = 1, rejected: int = 0, accepted: int = 1) -> dict:
    return {"runId": run_id, "validated": validated, "rejected": rejected, "accepted": accepted}


class FakeHostBridge:
    """In-memory host bridge for weekly-dream tests.

    ``contents`` scripts the model replies in order; when it is exhausted the
    last ``content`` keeps answering. ``validate_reports`` scripts the write-free
    preflight; the default report is clean.
    """

    def __init__(
        self,
        *,
        pack: dict | None = None,
        content: str | None = None,
        contents: list[str] | None = None,
        dream_result: dict | None = None,
        validate_reports: list[dict] | None = None,
        fail_methods: frozenset[str] | None = None,
        fail_submissions: bool = False,
    ) -> None:
        self.calls: list[tuple[str, dict]] = []
        self._pack = pack if pack is not None else _pack()
        self._content = content if content is not None else _answer()
        self._contents = list(contents) if contents is not None else None
        self._validate_reports = list(validate_reports) if validate_reports is not None else None
        self._dream_result = dream_result or _dream_result_wire()
        self._fail_methods = fail_methods or frozenset()
        self._fail_submissions = fail_submissions

    def invoke(self, method: str, params: dict, *, trace_id: str, deadline_ms: int, started_at: float) -> dict:
        self.calls.append((method, dict(params)))
        if method in self._fail_methods or (
            method == CAPABILITY_DREAM_RUN_WEEKLY
            and self._fail_submissions
            and not params.get("validateOnly")
        ):
            raise ProtocolError("host_error", f"simulated failure for {method}", retryable=False)
        if method == CAPABILITY_LEARNING_WEEKLY_PACK:
            return self._pack
        if method == "model.invoke":
            if self._contents:
                return {"content": self._contents.pop(0)}
            return {"content": self._content}
        if method == CAPABILITY_DREAM_RUN_WEEKLY:
            if params.get("validateOnly"):
                if self._validate_reports:
                    return self._validate_reports.pop(0)
                return dict(_CLEAN_PREFLIGHT)
            return self._dream_result
        raise ProtocolError("method_not_found", f"unhandled fake method {method}")

    def methods(self) -> list[str]:
        return [method for method, _ in self.calls]

    def model_calls(self) -> int:
        return self.methods().count("model.invoke")

    def preflights(self) -> list[dict]:
        return [params for method, params in self.calls
                if method == CAPABILITY_DREAM_RUN_WEEKLY and params.get("validateOnly")]

    def submitted(self) -> dict:
        """The real submission, never the validateOnly preflight."""
        submissions = [params for method, params in self.calls
                       if method == CAPABILITY_DREAM_RUN_WEEKLY and not params.get("validateOnly")]
        return submissions[-1]


def _run(bridge: FakeHostBridge, **kwargs):
    return WeeklyDreamOrchestrator(bridge, **kwargs).run_weekly(
        WeeklyDreamInput(trace_id="trace-1", window="2026-W41", available_host_capabilities=_capabilities())
    )


class WeeklyDreamTypesTests(unittest.TestCase):
    def test_mutation_actions_are_exactly_new_reinforce_supersede_archive(self) -> None:
        self.assertEqual(WEEKLY_MUTATION_ACTIONS, frozenset({"ADD", "REINFORCE", "SUPERSEDE", "ARCHIVE"}))

    def test_the_digest_has_exactly_six_fields_after_normalization(self) -> None:
        narrative = WeeklyNarrative.model_validate({
            "title": " 本周 ",
            "body": ["读了 {{f:volume.reading}} 篇。"],
            "nextSteps": [{"text": "再做两套题。", "target": {"type": "kind", "key": "reading.tfng"}}],
        })
        self.assertEqual(narrative.to_wire(), {
            "title": "本周",
            "body": ["读了 {{f:volume.reading}} 篇。"],
            "changes": [],
            "nextSteps": [{"text": "再做两套题。", "target": {"type": "kind", "key": "reading.tfng"}}],
            "strengths": [],
            "weaknesses": [],
        })
        self.assertEqual(WeeklyNarrative().to_wire(), _EMPTY_DIGEST)
        # There is no per-block sentence field left anywhere in the contract.
        self.assertNotIn("sentences", WeeklyNarrative.model_fields)

    def test_the_digest_is_closed_and_bounded(self) -> None:
        for bad in (
            {"title": "x" * 17},
            {"body": ["a"] * 4},
            {"changes": [{"text": "a"}] * 5},
            {"nextSteps": [{"text": "a"}] * 5},
            {"nextSteps": [{"text": "a", "target": {"type": "route", "key": "x"}}]},
            {"nextSteps": [{"text": "a", "target": {"type": "kind", "key": ""}}]},
            {"nextSteps": [{"text": ""}]},
            {"sentences": {"volume": "旧格式"}},
            {"bogus": []},
        ):
            with self.subTest(bad=bad), self.assertRaises(ValidationError):
                WeeklyNarrative.model_validate(bad)

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
    def test_the_model_call_is_followed_by_one_write_free_preflight_and_one_submission(self) -> None:
        bridge = FakeHostBridge()
        result = _run(bridge)
        self.assertIsNone(result.fallback_reason)
        self.assertEqual((result.run_id, result.validated, result.accepted), ("weekly-run-1", 1, 1))
        self.assertEqual(bridge.methods(), [
            CAPABILITY_LEARNING_WEEKLY_PACK,
            "model.invoke",
            CAPABILITY_DREAM_RUN_WEEKLY,
            CAPABILITY_DREAM_RUN_WEEKLY,
        ])
        preflight = bridge.preflights()[0]
        self.assertEqual(preflight, {
            "window": "2026-W41",
            "digest": _digest(),
            "validateOnly": True,
        })
        # The real submission is the one write; it carries the six-field digest,
        # the edits and the mutations, never a second narrative shape.
        submitted = bridge.submitted()
        self.assertEqual(submitted["window"], "2026-W41")
        self.assertEqual(submitted["digest"], _digest())
        self.assertEqual(set(submitted["digest"]), {
            "title", "body", "changes", "nextSteps", "strengths", "weaknesses",
        })
        self.assertEqual(submitted["mutations"], [_add()])
        self.assertEqual(submitted["profileEdits"], [])
        self.assertEqual((submitted["modelAvailable"], submitted["droppedMutations"]), (True, 0))

    def test_the_prompt_carries_facts_soul_persona_blocks_and_previous_digest(self) -> None:
        bridge = FakeHostBridge()
        _run(bridge)
        request = bridge.calls[1][1]["request"]
        self.assertEqual(request["maxTokens"], 2_500)
        self.assertEqual(WEEKLY_MODEL_MAX_TOKENS, 2_500)
        self.assertEqual(request["temperature"], 0.6)
        system, user = (message["content"] for message in request["messages"])
        self.assertEqual(json.loads(user)["pack"], _pack())
        for needed in (
            _pack()["persona"],
            "pack.facts",
            "pack.blocks",
            "soul.address",
            "soul.tone",
            "previousDigest",
            "{{f:ID}}",
            "{{q:ID}}",
            "never quote source text",
            "Never write a literal digit",
            "nextSteps is the only group where a Chinese count may appear without a fact",
            "two DIFFERENT assets",
            "samples are small",
            "Do not flatter",
            "UNTRUSTED DATA",
            "profileEdits",
            "soul.companionNotes",
            "soul.toneSuggestion",
            "ASKUSER" if False else "the host owns askUser",
            "ARCHIVE",
        ):
            self.assertIn(needed, system)
        self.assertNotIn("sentences", system)
        self.assertNotIn("sentences", user)

    def test_the_per_block_sentence_path_is_gone(self) -> None:
        for removed in ("_build_narrative", "_build_system_prompt_v2", "_build_digest_v2",
                        "_build_system_prompt_no_facts"):
            self.assertFalse(hasattr(weekly_module, removed), removed)
        self.assertNotIn("sentences", _digest())

    def test_a_host_violation_list_triggers_exactly_one_repair_call(self) -> None:
        rejected = _digest(body=["这周做了三次阅读练习。"])
        repaired = _digest(body=["这周完成了 {{f:volume.reading}} 篇阅读。"])
        bridge = FakeHostBridge(
            contents=[_answer(digest=rejected), _answer(digest=repaired)],
            validate_reports=[
                {"usable": False, "needsRepair": True, "droppedSentences": 1,
                 "violations": [{"path": "body/0", "sentence": 0, "code": "literal_chinese_count"}]},
                {"usable": True, "needsRepair": False, "droppedSentences": 0, "violations": []},
            ],
        )
        self.assertIsNone(_run(bridge).fallback_reason)
        self.assertEqual(bridge.model_calls(), 2)
        self.assertEqual(len(bridge.preflights()), 2)
        repair_message = bridge.calls[3][1]["request"]["messages"][-1]["content"]
        self.assertIn("Repair the previous digest", repair_message)
        self.assertIn("literal_chinese_count", repair_message)
        self.assertIn('"previousDigest"', repair_message)
        self.assertIn("这周做了三次阅读练习。", repair_message)
        self.assertEqual(bridge.submitted()["digest"]["body"], ["这周完成了 {{f:volume.reading}} 篇阅读。"])

    def test_a_second_bad_preflight_is_submitted_as_is_not_looped(self) -> None:
        first = _digest(body=["这周做了三次阅读练习。"])
        second = _digest(body=["这周又做了三次阅读练习。"])
        bridge = FakeHostBridge(
            contents=[_answer(digest=first), _answer(digest=second)],
            validate_reports=[
                {"usable": False, "needsRepair": True, "droppedSentences": 1, "violations": []},
                {"usable": False, "needsRepair": True, "droppedSentences": 1, "violations": []},
            ],
        )
        self.assertIsNone(_run(bridge).fallback_reason)
        self.assertEqual(bridge.model_calls(), 2, "one repair only")
        self.assertEqual(len(bridge.preflights()), 2)
        self.assertEqual(bridge.submitted()["digest"]["body"], second["body"])

    def test_an_unusable_body_gets_one_repair_without_sentence_violations(self) -> None:
        missing_body = _digest()
        del missing_body["body"]
        report = {"usable": False, "needsRepair": False, "droppedSentences": 0, "violations": []}
        for digest in (_digest(body=[]), missing_body, _digest(body=[" ", "\n\t"])):
            with self.subTest(digest=digest):
                bridge = FakeHostBridge(
                    contents=[_answer(digest=digest), _answer()],
                    validate_reports=[report, dict(_CLEAN_PREFLIGHT)],
                )
                sleeps: list[float] = []
                self.assertIsNone(_run(bridge, sleep=sleeps.append).fallback_reason)
                self.assertEqual(bridge.model_calls(), 2)
                self.assertEqual(len(bridge.preflights()), 2)
                self.assertEqual(sleeps, [], "repair must not incur retry backoff")
                repair_message = bridge.calls[3][1]["request"]["messages"][-1]["content"]
                repair_payload = json.loads(repair_message[repair_message.index("{"):])
                self.assertEqual(repair_payload["validation"], report)
                self.assertEqual(repair_payload["previousDigest"]["body"], [])
                self.assertEqual(bridge.submitted()["digest"], _digest())

    def test_an_unusable_repaired_digest_is_submitted_without_another_repair(self) -> None:
        report = {"usable": False, "needsRepair": False, "droppedSentences": 0, "violations": []}
        bridge = FakeHostBridge(
            content=_answer(digest=_digest(body=[])),
            validate_reports=[report, report],
        )
        self.assertIsNone(_run(bridge).fallback_reason)
        self.assertEqual(bridge.model_calls(), 2, "unusable output still gets only one repair")
        self.assertEqual(len(bridge.preflights()), 2)
        self.assertEqual(bridge.submitted()["digest"]["body"], [])

    def test_an_unusable_digest_cannot_repair_after_the_model_budget_is_spent(self) -> None:
        bridge = ScriptedModelBridge([
            _transient(), "invalid JSON", _answer(digest=_digest(body=[])), _answer(),
        ])
        bridge.set_validate_reports([
            {"usable": False, "needsRepair": False, "droppedSentences": 0, "violations": []},
        ])
        sleeps: list[float] = []
        self.assertIsNone(_run(bridge, sleep=sleeps.append).fallback_reason)
        self.assertEqual(bridge.model_calls(), MODEL_MAX_ATTEMPTS)
        self.assertEqual(sleeps, [2.0, 5.0])
        self.assertEqual(len(bridge.preflights()), 1)
        self.assertEqual(bridge.submitted()["digest"]["body"], [])
        self.assertEqual(len([params for method, params in bridge.calls
                              if method == CAPABILITY_DREAM_RUN_WEEKLY and not params.get("validateOnly")]), 1)

    def test_total_model_calls_never_exceed_three(self) -> None:
        # A retryable provider failure, then a digest the host sends back once,
        # then its repair: three calls is the whole budget.
        bridge = ScriptedModelBridge([
            _transient(),
            _answer(digest=_digest(body=["这周做了三次阅读练习。"])),
            _answer(digest=_digest(body=["这周完成了 {{f:volume.reading}} 篇阅读。"])),
        ])
        bridge.set_validate_reports([
            {"usable": False, "needsRepair": True, "droppedSentences": 1, "violations": []},
            {"usable": True, "needsRepair": False, "droppedSentences": 0, "violations": []},
        ])
        sleeps: list[float] = []
        result = _WeeklyDreamOrchestrator(bridge, sleep=sleeps.append).run_weekly(
            WeeklyDreamInput(trace_id="t", window="2026-W41", available_host_capabilities=_capabilities()))
        self.assertIsNone(result.fallback_reason)
        self.assertEqual(bridge.model_calls(), MODEL_MAX_ATTEMPTS)
        self.assertEqual(sleeps, [2.0], "one backoff before the retry, none before the repair")

    def test_chinese_counts_are_accepted_in_next_steps(self) -> None:
        # The host's validator is the authority (its Rust test proves the
        # exception); Python must pass the group through untouched.
        digest = _digest(nextSteps=[{"text": "再做两套判断题。"}])
        bridge = FakeHostBridge(content=_answer(digest=digest))
        self.assertIsNone(_run(bridge).fallback_reason)
        self.assertEqual(bridge.model_calls(), 1)
        self.assertEqual(bridge.submitted()["digest"]["nextSteps"], [{"text": "再做两套判断题。"}])

    def test_model_unavailable_submits_a_model_free_result_without_prose(self) -> None:
        bridge = FakeHostBridge()
        caps = dict(REQUIRED_WEEKLY_DREAM_HOST_CAPABILITIES)  # no model.invoke
        result = WeeklyDreamOrchestrator(bridge).run_weekly(
            WeeklyDreamInput(trace_id="t", window="2026-W41", available_host_capabilities=caps))
        self.assertIsNone(result.fallback_reason)
        self.assertNotIn("model.invoke", bridge.methods())
        submitted = bridge.submitted()
        self.assertFalse(submitted["modelAvailable"])
        self.assertEqual(submitted["digest"], _EMPTY_DIGEST)
        self.assertEqual(submitted["mutations"], [])
        self.assertEqual(submitted["profileEdits"], [])

    def test_too_little_evidence_skips_the_model_and_submits_no_narrative(self) -> None:
        bridge = FakeHostBridge(pack=_pack(MIN_OBSERVATIONS - 1))
        result = _run(bridge)
        self.assertIsNone(result.fallback_reason)
        self.assertEqual(bridge.methods(), [CAPABILITY_LEARNING_WEEKLY_PACK, CAPABILITY_DREAM_RUN_WEEKLY])
        submitted = bridge.submitted()
        self.assertFalse(submitted["modelAvailable"])
        self.assertEqual(submitted["digest"], _EMPTY_DIGEST)
        # Exactly at the threshold the model is called.
        bridge = FakeHostBridge(pack=_pack(MIN_OBSERVATIONS))
        _run(bridge)
        self.assertIn("model.invoke", bridge.methods())

    def test_soul_profile_edits_are_bounded_and_submitted_for_the_host(self) -> None:
        edits = [
            {"key": "soul.companionNotes", "value": "先核对题干再作答。",
             "evidenceIds": ["qtype.tfng.wrong", "accuracy.rate"], "reason": "判断题在两次练习里都错。"},
            {"key": "soul.toneSuggestion", "value": "直接",
             "evidenceIds": ["qtype.tfng.wrong"], "reason": "用户偏好直接反馈。"},
            {"key": "soul.address", "value": "您", "evidenceIds": ["qtype.tfng.wrong"], "reason": "越权"},
            "not an edit",
        ]
        bridge = FakeHostBridge(content=_answer(edits=edits, mutations=[]))
        self.assertIsNone(_run(bridge).fallback_reason)
        self.assertEqual(bridge.submitted()["profileEdits"], edits[:2])

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
        self.assertEqual(bridge.submitted()["droppedMutations"], 5)

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
        digest = {
            "title": "字" * 40,
            "body": [" spaced   out ", "", 5, None, "extra", "extra", "extra"],
            "changes": [" short line ", "", 5, None, "one", "two"],
            "nextSteps": {"not": "a list"},
            "strengths": "not a list",
            "weaknesses": [{"text": "  "}, {"text": "还需要核对。"},
                           {"text": "b", "target": {"type": "route", "key": "x"}}],
            "schemaVersion": 2,
        }
        bridge = FakeHostBridge(content=_answer(digest=digest, mutations=[]))
        _run(bridge)
        sent = bridge.submitted()["digest"]
        self.assertEqual(sent["title"], "字" * 16)
        self.assertEqual(sent["body"], ["spaced out", "extra", "extra"])
        self.assertEqual(sent["changes"], [{"text": "short line"}, {"text": "one"}, {"text": "two"}])
        self.assertEqual(sent["nextSteps"], [])
        self.assertEqual(sent["strengths"], [])
        self.assertEqual(sent["weaknesses"], [{"text": "还需要核对。"}, {"text": "b"}])
        self.assertEqual(list(sent), ["title", "body", "changes", "nextSteps", "strengths", "weaknesses"])

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
        bridge = FakeHostBridge(fail_submissions=True)
        self.assertIn("dream_run_weekly_unavailable", _run(bridge).fallback_reason)
        self.assertEqual(len(bridge.preflights()), 1)

    def test_a_failing_preflight_is_fail_closed_not_another_model_call(self) -> None:
        bridge = FakeHostBridge(fail_methods=frozenset({CAPABILITY_DREAM_RUN_WEEKLY}))
        result = _run(bridge)
        self.assertIn("weekly_validation_unavailable", result.fallback_reason)
        self.assertEqual(bridge.model_calls(), 1)
        self.assertEqual(len(bridge.preflights()), 1)
        self.assertEqual(len([params for method, params in bridge.calls
                              if method == CAPABILITY_DREAM_RUN_WEEKLY
                              and not params.get("validateOnly")]), 0)

    def test_the_model_failing_is_a_fallback_not_an_empty_success(self) -> None:
        bridge = FakeHostBridge(fail_methods=frozenset({"model.invoke"}))
        result = _run(bridge)
        self.assertIn("model_invoke_failed", result.fallback_reason)
        self.assertFalse(bridge.preflights())
        self.assertFalse(any(not params.get("validateOnly")
                             for method, params in bridge.calls
                             if method == CAPABILITY_DREAM_RUN_WEEKLY))

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
        self.assertEqual(len(bridge.preflights()), 1)
        self.assertEqual(len([params for method, params in bridge.calls
                              if method == CAPABILITY_DREAM_RUN_WEEKLY and not params.get("validateOnly")]), 1)
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

    def set_validate_reports(self, reports: list[dict]) -> None:
        self._validate_reports = list(reports)

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
        return any(method == CAPABILITY_DREAM_RUN_WEEKLY and not params.get("validateOnly")
                   for method, params in bridge.calls)

    def test_constants(self) -> None:
        self.assertEqual(MODEL_MAX_ATTEMPTS, 3)
        self.assertEqual(MODEL_RETRY_BACKOFF_SECONDS, (2.0, 5.0))

    def test_first_call_success_makes_one_call_and_never_sleeps(self) -> None:
        result, bridge, sleeps = self._run([_answer()])
        self.assertIsNone(result.fallback_reason)
        self.assertEqual((bridge.model_calls(), sleeps), (1, []))

    def test_a_transient_provider_error_is_retried_with_backoff(self) -> None:
        result, bridge, sleeps = self._run([_transient(), _answer()])
        self.assertIsNone(result.fallback_reason)
        self.assertEqual(bridge.model_calls(), 2)
        self.assertEqual(sleeps, [2.0])
        self.assertTrue(self._submitted(bridge))

    def test_malformed_output_is_retried_in_every_shape(self) -> None:
        for bad in ("not json at all", "", "{}", '{"digest": null}', '{"digest": []}',
                    '{"digest": {}, "mutations": {}}', '{"digest": {}, "profileEdits": {}}',
                    "[1]", "[]", '{"patterns": []}', {"content": None}, {"nothing": "here"},
                    {"content": "   "}):
            with self.subTest(bad=bad):
                result, bridge, sleeps = self._run([bad, bad, _answer()])
                self.assertIsNone(result.fallback_reason)
                self.assertEqual((bridge.model_calls(), sleeps), (3, [2.0, 5.0]))

    def test_the_attempt_is_bounded_to_three_calls_then_fails_closed(self) -> None:
        result, bridge, sleeps = self._run(["nope", "still nope", "never json"])
        self.assertEqual(result.fallback_reason, "model_output_invalid_json")
        self.assertEqual((bridge.model_calls(), sleeps), (3, [2.0, 5.0]))
        self.assertFalse(self._submitted(bridge), "a failed attempt submits nothing")
        # The extra scripted answers must be untouched: the loop never makes a fourth call.
        result, bridge, _ = self._run([_transient()] * 3 + [_answer()])
        self.assertIn("model_invoke_failed:ProtocolError", result.fallback_reason)
        self.assertEqual(bridge.model_calls(), 3)

    def test_provider_errors_and_bad_output_share_one_budget(self) -> None:
        result, bridge, sleeps = self._run([_transient(), "garbage", _transient()])
        self.assertTrue(result.fallback_reason)
        self.assertEqual((bridge.model_calls(), sleeps), (3, [2.0, 5.0]))

    def test_unfixable_failures_are_not_retried(self) -> None:
        for error in (
            ProtocolError("host_request_failed", "AI provider returned HTTP 401: bad key", retryable=False),
            ProtocolError("deadline_exceeded", "cognitive request deadline expired", retryable=True),
            RuntimeError("unexpected"),
        ):
            with self.subTest(error=error):
                result, bridge, sleeps = self._run([error, _answer()])
                self.assertTrue(result.fallback_reason)
                self.assertEqual((bridge.model_calls(), sleeps), (1, []))

    def test_no_retry_is_started_without_time_for_it(self) -> None:
        # 4 s of budget cannot hold a 2 s pause plus a 5 s attempt.
        result, bridge, sleeps = self._run(["garbage", _answer()], cognitive_deadline_ms=4_000)
        self.assertEqual(result.fallback_reason, "model_output_invalid_json")
        self.assertEqual((bridge.model_calls(), sleeps), (1, []))

    def test_every_retry_carries_the_same_bounded_request(self) -> None:
        _, bridge, _ = self._run(["garbage", "garbage", _answer()])
        requests = [params["request"] for method, params in bridge.calls if method == "model.invoke"]
        self.assertEqual(len(requests), 3)
        self.assertTrue(all(request == requests[0] for request in requests))
        self.assertEqual(requests[0]["maxTokens"], 2_500)
        self.assertEqual(requests[0]["temperature"], 0.6)


if __name__ == "__main__":
    unittest.main()
