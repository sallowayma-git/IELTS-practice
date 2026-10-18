from __future__ import annotations

import io
import sys
import unittest
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from ielts_agent.framing import FrameError, encode_frame, read_frame
from ielts_agent.protocol import PROTOCOL_VERSION, SUPPORTED_CAPABILITIES
from ielts_agent.runtime import RuntimeServer, serve


def request(method: str, params: dict | None = None, *, request_id: str = "req-1", deadline: int = 1000) -> dict:
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "requestId": request_id,
        "traceId": "trace-1",
        "deadlineMs": deadline,
        "method": method,
        "params": params or {},
    }


class FramingTests(unittest.TestCase):
    def test_partial_and_coalesced_frames(self) -> None:
        payload = encode_frame({"one": 1}) + encode_frame({"two": 2})
        stream = io.BytesIO()
        for chunk_start in range(0, len(payload), 3):
            stream.write(payload[chunk_start : chunk_start + 3])
        stream.seek(0)
        self.assertEqual(read_frame(stream), {"one": 1})
        self.assertEqual(read_frame(stream), {"two": 2})
        self.assertIsNone(read_frame(stream))

    def test_oversize_and_malformed_frames_fail_closed(self) -> None:
        with self.assertRaises(FrameError):
            encode_frame({"payload": "x" * 32}, max_frame_bytes=16)
        with self.assertRaises(FrameError):
            read_frame(io.BytesIO(b"\x00\x00\x00\x05abcde"))


class RuntimeTests(unittest.TestCase):
    def test_checked_in_handshake_fixture_matches_runtime_schema(self) -> None:
        root = Path(__file__).parents[2]
        fixture = json.loads(
            (root / "schemas/cognitive_protocol/fixtures/v1/handshake-request.json").read_text(
                encoding="utf-8"
            )
        )
        schema = json.loads(
            (root / "schemas/cognitive_protocol/runtime.schema.json").read_text(encoding="utf-8")
        )
        response = RuntimeServer(build_id="fixture-build").handle(fixture)
        self.assertTrue(response["ok"])
        self.assertEqual(set(response["result"]), set(schema["properties"]))
        self.assertEqual(response["result"]["capabilities"]["memory.candidates.generate"], "1")
        self.assertEqual(
            response["result"]["requiredHostCapabilities"],
            {"model.invoke": "1", "tool.invoke": "1"},
        )

    def test_handshake_health_capability_mismatch_and_shutdown(self) -> None:
        server = RuntimeServer(build_id="test-build")
        health_before = server.handle(request("runtime.health"))
        self.assertFalse(health_before["ok"])
        handshake = server.handle(
            request(
                "runtime.handshake",
                {
                    "hostProtocolVersion": 1,
                    "requestedCapabilities": ["runtime.health"],
                    "hostCapabilities": {"model.invoke": "1", "tool.invoke": "1"},
                },
            )
        )
        self.assertTrue(handshake["ok"])
        self.assertEqual(handshake["result"]["buildId"], "test-build")
        self.assertEqual(
            handshake["result"]["capabilities"],
            {
                "dream.weekly": "1",
                "memory.candidates.generate": "1",
                "planner.study_plan": "1",
                "runtime.health": "1",
                "runtime.shutdown": "1",
            },
        )
        self.assertEqual(
            handshake["result"]["requiredHostCapabilities"],
            {"model.invoke": "1", "tool.invoke": "1"},
        )
        mismatch = server.handle(
            request("runtime.handshake", {
                "hostProtocolVersion": 1,
                "requestedCapabilities": ["model.embed"],
                "hostCapabilities": {"model.invoke": "1", "tool.invoke": "1"},
            }) )
        self.assertEqual(mismatch["error"]["code"], "capability_mismatch")
        missing_host = RuntimeServer().handle(
            request("runtime.handshake", {"hostProtocolVersion": 1})
        )
        self.assertEqual(missing_host["error"]["code"], "host_capability_mismatch")
        health = server.handle(request("runtime.health"))
        self.assertEqual(health["result"]["state"], "ready")
        shutdown = server.handle(request("runtime.shutdown"))
        self.assertEqual(shutdown["result"]["state"], "stopped")

    def test_expired_deadline_fails_closed(self) -> None:
        server = RuntimeServer()
        expired = server.handle(request("runtime.handshake", {"hostProtocolVersion": 1}, deadline=0))
        self.assertEqual(expired["error"]["code"], "deadline_exceeded")

    def test_stdout_contains_only_protocol_frames(self) -> None:
        incoming = encode_frame(request("runtime.handshake", {
            "hostProtocolVersion": 1,
            "hostCapabilities": {"model.invoke": "1", "tool.invoke": "1"},
        }))
        incoming += encode_frame(request("runtime.health", request_id="health-1"))
        incoming += encode_frame(request("runtime.shutdown", request_id="shutdown-1"))
        output = io.BytesIO()
        serve(io.BytesIO(incoming), output, build_id="test-build")
        output.seek(0)
        responses = [read_frame(output), read_frame(output), read_frame(output)]
        self.assertTrue(all(isinstance(response, dict) for response in responses))
        self.assertTrue(all(response["protocolVersion"] == 1 for response in responses))
        self.assertEqual(responses[-1]["result"]["state"], "stopped")

    def test_runtime_source_has_no_canonical_truth_access(self) -> None:
        source_root = Path(__file__).parents[1] / "src"
        # The cognitive runtime core (memory/protocol/runtime/host_bridge) must
        # never touch SQLite, keyring, or canonical DB paths. The M12 planner
        # package is a Python orchestration package (never canonical truth) — it
        # is excluded from this core-runtime scan but audited separately below.
        # Docstrings that say "never touches sqlite3" would otherwise trip a
        # naive substring scan, so orchestration packages are excluded.
        forbidden_in_core = ("sqlite3", "keyring", "v2.db", "Tauri internal")
        planner_dir = source_root / "ielts_agent" / "planner"
        core_sources: list[str] = []
        planner_sources: list[str] = []
        for path in source_root.rglob("*.py"):
            text = path.read_text(encoding="utf-8")
            if planner_dir in path.parents:
                planner_sources.append(text)
            else:
                core_sources.append(text)
        core_source = "\n".join(core_sources)
        for forbidden in forbidden_in_core:
            self.assertNotIn(forbidden, core_source)
        # The planner package must never reference credentials, the canonical
        # IELTS DB, or keyring.
        planner_source = "\n".join(planner_sources)
        for forbidden in ("keyring", "v2.db", "Tauri internal", "import credentials", "os.environ[", "getpass"):
            self.assertNotIn(forbidden, planner_source)


class DreamDispatchBridge:
    """In-memory host bridge for the dream.weekly / planner.study_plan dispatch."""

    def __init__(self, *, fail_methods: frozenset[str] | None = None) -> None:
        self.calls: list[tuple[str, dict]] = []
        self._fail_methods = fail_methods or frozenset()

    def invoke(self, method: str, params: dict, *, trace_id: str, deadline_ms: int, started_at: float) -> dict:
        self.calls.append((method, dict(params)))
        if method in self._fail_methods:
            raise RuntimeError(f"simulated failure for {method}")
        if method == "study_plan.create":
            return {"planId": "plan-1", "accepted": 1, "rejected": 0}
        if method == "learning.weekly_pack":
            return {
                "schemaVersion": 2,
                "observationCount": 12,
                "header": {},
                "lines": [{"ids": ["obs-a"], "date": "2026-10-05", "kind": "miss", "text": "P1 q14 [tfng] answered FALSE -> key TRUE"}],
                "memories": [],
                "preferences": [],
                "blocks": [{"id": "accuracy", "kind": "accuracy", "data": {"correct": 9, "answered": 12}}],
            }
        if method == "model.invoke":
            return {"content": json.dumps({
                "title": "判断题需要留意", "sentences": {"accuracy": "P1 第 14 题选错"},
                "mutations": [{
                    "action": "ADD", "namespace": "strategy", "canonicalKey": "strategy.reading.tfng_boundary",
                    "scope": {"type": "activity", "key": "reading"}, "statement": "判断题容易混淆 False 与 Not Given。",
                    "evidenceObservationIds": ["obs-a"],
                }],
            })}
        if method == "dream.run_weekly":
            return {"runId": "weekly-run-1", "validated": 1, "rejected": 0, "accepted": 1}
        if method == "learning.learner_skill_state":
            return {
                "needs": [
                    {
                        "skillKey": "writing.task2",
                        "priority": 0.8,
                        "priorityBand": "high",
                        "dueAt": "2026-08-16T00:00:00Z",
                        "preferredProbe": "writing_rewrite",
                        "avoidAssetIds": [],
                        "reasonCodes": [],
                    }
                ],
                "uncertainty": {"writing.task2": 0.6},
            }
        raise RuntimeError(f"unhandled fake method {method}")


class DispatchTests(unittest.TestCase):
    def _handshaken_server(self, bridge) -> RuntimeServer:
        server = RuntimeServer(build_id="test-build", host_bridge=bridge)
        handshake = server.handle(
            request(
                "runtime.handshake",
                {
                    "hostProtocolVersion": 1,
                    "requestedCapabilities": ["dream.weekly", "planner.study_plan"],
                    "hostCapabilities": {
                        "model.invoke": "1",
                        "tool.invoke": "1",
                        "dream.run_weekly": "1",
                        "learning.weekly_pack": "1",
                        "learning.learner_skill_state": "1",
                        "memory.search_active": "1",
                        "study_plan.create": "1",
                    },
                },
            )
        )
        assert handshake["ok"], handshake
        return server

    def test_there_is_no_daily_dream(self) -> None:
        # The daily journal is a deterministic summary built by the host; the
        # sidecar neither advertises nor serves a daily pass.
        bridge = DreamDispatchBridge()
        server = self._handshaken_server(bridge)
        response = server.handle(request("dream.daily", {"day": "2026-08-16"}))
        self.assertFalse(response["ok"])
        self.assertEqual(bridge.calls, [])
        self.assertNotIn("dream.daily", SUPPORTED_CAPABILITIES)

    def test_dream_weekly_dispatch_makes_one_bounded_model_call(self) -> None:
        bridge = DreamDispatchBridge()
        server = self._handshaken_server(bridge)
        response = server.handle(request("dream.weekly", {"window": "2026-W40"}))
        self.assertTrue(response["ok"], response)
        result = response["result"]["result"]
        self.assertEqual(result["runId"], "weekly-run-1")
        self.assertEqual(result["accepted"], 1)
        self.assertIsNone(result["fallbackReason"])
        methods = [call[0] for call in bridge.calls]
        self.assertEqual(methods, ["learning.weekly_pack", "model.invoke", "dream.run_weekly"])
        model_request = bridge.calls[1][1]["request"]
        self.assertEqual(model_request["maxTokens"], 4000)
        self.assertEqual(bridge.calls[0][1], {"window": "2026-W40"})
        submitted = bridge.calls[2][1]
        self.assertEqual(submitted["narrative"], {"title": "判断题需要留意", "sentences": {"accuracy": "P1 第 14 题选错"}})
        self.assertEqual((submitted["modelAvailable"], submitted["droppedMutations"]), (True, 0))
        self.assertEqual(submitted["mutations"][0]["action"], "ADD")

    def test_dream_weekly_requires_exactly_window(self) -> None:
        server = self._handshaken_server(DreamDispatchBridge())
        for params in ({}, {"window": "2026-W40", "extra": 1}):
            response = server.handle(request("dream.weekly", params))
            self.assertFalse(response["ok"])
            self.assertEqual(response["error"]["code"], "schema_invalid_fields")
        response = server.handle(request("dream.weekly", {"window": ""}))
        self.assertEqual(response["error"]["code"], "schema_type_error")

    def test_dream_weekly_reports_fallback_not_fatal(self) -> None:
        bridge = DreamDispatchBridge(fail_methods=frozenset({"learning.weekly_pack"}))
        server = self._handshaken_server(bridge)
        response = server.handle(request("dream.weekly", {"window": "2026-W40"}))
        self.assertTrue(response["ok"], response)
        result = response["result"]["result"]
        self.assertEqual(result["runId"], "")
        self.assertIn("weekly_pack_unavailable", result["fallbackReason"])

    def test_planner_dispatch_submits_proposal(self) -> None:
        bridge = DreamDispatchBridge()
        server = self._handshaken_server(bridge)
        response = server.handle(
            request(
                "planner.study_plan",
                {
                    "plannerInput": {
                        "traceId": "trace-1",
                        "userGoal": "Band 7 in writing",
                        "availableMinutes": 45,
                    }
                },
            )
        )
        self.assertTrue(response["ok"], response)
        proposal = response["result"]["proposal"]
        self.assertIn("items", proposal)
        methods = [call[0] for call in bridge.calls]
        self.assertIn("study_plan.create", methods)

    def test_planner_dispatch_invalid_input_rejected(self) -> None:
        server = self._handshaken_server(DreamDispatchBridge())
        response = server.handle(
            request("planner.study_plan", {"plannerInput": {"userGoal": ""}})
        )
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "planner_input_invalid")

    def test_dream_weekly_requires_handshake(self) -> None:
        server = RuntimeServer(build_id="test-build", host_bridge=DreamDispatchBridge())
        response = server.handle(request("dream.weekly", {"window": "2026-W40"}))
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "handshake_required")

    def test_dream_weekly_without_bridge_rejected(self) -> None:
        server = RuntimeServer(build_id="test-build")
        handshake = server.handle(
            request(
                "runtime.handshake",
                {
                    "hostProtocolVersion": 1,
                    "requestedCapabilities": ["dream.weekly"],
                    "hostCapabilities": {"model.invoke": "1", "tool.invoke": "1"},
                },
            )
        )
        self.assertTrue(handshake["ok"])
        response = server.handle(request("dream.weekly", {"window": "2026-W40"}))
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "host_bridge_unavailable")


if __name__ == "__main__":
    unittest.main()
