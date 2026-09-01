from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from ielts_agent.memory_extractor import MemoryCandidateInput, extract_memory_candidates
from ielts_agent.runtime import RuntimeServer


def candidate_input() -> dict:
    return {
        "observations": [
            {
                "id": "obs-exact-key",
                "namespace": "strategy",
                "activity": "reading",
                "normalizedLabel": "local evidence",
                "statement": "Check local evidence.",
                "canonicalKey": "strategy.reading.local_evidence",
            },
            {
                "id": "obs-exact-label",
                "namespace": "strategy",
                "activity": "reading",
                "normalizedLabel": "  LOCAL   EVIDENCE ",
                "statement": "Same exact normalized label.",
            },
            {
                "id": "obs-new",
                "namespace": "metacognition",
                "activity": "reading",
                "normalizedLabel": "Premature Confidence",
                "statement": "May commit with premature confidence.",
            },
        ],
        "activeMemory": [
            {
                "id": "mem-existing",
                "namespace": "strategy",
                "canonicalKey": "strategy.reading.local_evidence",
                "normalizedLabel": "local evidence",
                "scope": {"type": "activity", "key": "reading"},
            }
        ],
        "explicitPreferences": [
            {
                "preferenceKey": "teaching.explanation_style",
                "scope": "global",
                "value": "example_first",
            }
        ],
        "taskScope": {"type": "activity", "key": "reading"},
        "maxCandidates": 4,
    }


class MemoryExtractorTests(unittest.TestCase):
    def test_generate_calls_bounded_tool_then_model_on_one_trace(self) -> None:
        calls: list[tuple[str, dict, str, int]] = []

        class Bridge:
            def invoke(self, method, params, *, trace_id, deadline_ms, started_at):
                calls.append((method, params, trace_id, deadline_ms))
                if method == "tool.invoke":
                    return {"input": candidate_input()}
                return {
                    "content": "{bad json",
                    "model": "fake-model",
                    "latencyMs": 1,
                    "usage": {"inputTokens": 10, "outputTokens": 5},
                    "providerRequestId": "provider-request",
                }

        server = RuntimeServer(build_id="test", host_bridge=Bridge())
        handshake = server.handle(
            {
                "protocolVersion": 1,
                "requestId": "request-handshake",
                "traceId": "trace-handshake",
                "deadlineMs": 1000,
                "method": "runtime.handshake",
                "params": {
                    "hostProtocolVersion": 1,
                    "requestedCapabilities": ["memory.candidates.generate"],
                    "hostCapabilities": {"model.invoke": "1", "tool.invoke": "1"},
                },
            }
        )
        self.assertTrue(handshake["ok"])
        response = server.handle(
            {
                "protocolVersion": 1,
                "requestId": "request-generate",
                "traceId": "trace-generate",
                "deadlineMs": 1000,
                "method": "memory.candidates.generate",
                "params": {"maxCandidates": 4},
            }
        )
        self.assertTrue(response["ok"])
        self.assertTrue(response["result"]["fallbackUsed"])
        self.assertEqual([call[0] for call in calls], ["tool.invoke", "model.invoke"])
        self.assertTrue(all(call[2] == "trace-generate" for call in calls))
        self.assertEqual(calls[0][1]["name"], "memory.candidate_input")
        model_request = calls[1][1]["request"]
        self.assertEqual(model_request["temperature"], 0.0)
        self.assertEqual([item["role"] for item in model_request["messages"]], ["system", "user"])

    def test_malformed_json_uses_exact_key_label_then_pending_add_fallback(self) -> None:
        bounded = MemoryCandidateInput.model_validate(candidate_input())
        batch, fallback_used = extract_memory_candidates(bounded, "{bad json")
        self.assertTrue(fallback_used)
        self.assertEqual(
            [proposal.to_wire()["action"] for proposal in batch.proposals],
            ["REINFORCE", "ADD"],
        )
        self.assertEqual(batch.proposals[0].to_wire()["targetMemoryId"], "mem-existing")
        self.assertEqual(
            batch.proposals[1].to_wire()["canonicalKey"],
            "metacognition.reading.premature_confidence",
        )
        self.assertEqual(
            batch.proposals[1].to_wire()["evidenceObservationIds"], ["obs-new"]
        )

    def test_model_cannot_reference_ids_outside_bounded_input(self) -> None:
        bounded = MemoryCandidateInput.model_validate(candidate_input())
        model_output = json.dumps(
            {
                "schemaVersion": 1,
                "proposals": [
                    {
                        "action": "REINFORCE",
                        "targetMemoryId": "mem-outside",
                        "evidenceObservationIds": ["obs-outside"],
                    }
                ],
            }
        )
        batch, fallback_used = extract_memory_candidates(bounded, model_output)
        self.assertTrue(fallback_used)
        self.assertEqual(batch.proposals[0].to_wire()["targetMemoryId"], "mem-existing")

    def test_valid_model_output_is_preserved_and_bounded(self) -> None:
        raw = candidate_input()
        raw["maxCandidates"] = 1
        bounded = MemoryCandidateInput.model_validate(raw)
        model_output = json.dumps(
            {
                "schemaVersion": 1,
                "proposals": [
                    {
                        "action": "ADD",
                        "namespace": "metacognition",
                        "canonicalKey": "metacognition.reading.first",
                        "scope": {"type": "activity", "key": "reading"},
                        "statement": "First.",
                        "evidenceObservationIds": ["obs-new"],
                    },
                    {"action": "NOOP"},
                ],
            }
        )
        batch, fallback_used = extract_memory_candidates(bounded, model_output)
        self.assertFalse(fallback_used)
        self.assertEqual(len(batch.proposals), 1)

    def test_input_is_closed_unique_and_scope_bounded(self) -> None:
        raw = candidate_input()
        raw["extra"] = True
        with self.assertRaises(ValidationError):
            MemoryCandidateInput.model_validate(raw)
        raw = candidate_input()
        raw["observations"][0]["activity"] = "writing"
        with self.assertRaises(ValidationError):
            MemoryCandidateInput.model_validate(raw)

    def test_runtime_method_requires_handshake_and_returns_fallback_marker(self) -> None:
        server = RuntimeServer(build_id="test")
        handshake = server.handle(
            {
                "protocolVersion": 1,
                "requestId": "request-handshake",
                "traceId": "trace-handshake",
                "deadlineMs": 1000,
                "method": "runtime.handshake",
                "params": {
                    "hostProtocolVersion": 1,
                    "requestedCapabilities": ["memory.candidates.extract"],
                    "hostCapabilities": {"model.invoke": "1", "tool.invoke": "1"},
                },
            }
        )
        self.assertTrue(handshake["ok"])
        response = server.handle(
            {
                "protocolVersion": 1,
                "requestId": "request-extract",
                "traceId": "trace-extract",
                "deadlineMs": 1000,
                "method": "memory.candidates.extract",
                "params": {"input": candidate_input(), "modelOutput": "bad"},
            }
        )
        self.assertTrue(response["ok"])
        self.assertTrue(response["result"]["fallbackUsed"])
        self.assertEqual(response["result"]["batch"]["schemaVersion"], 1)


if __name__ == "__main__":
    unittest.main()
