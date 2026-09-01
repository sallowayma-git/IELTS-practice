from __future__ import annotations

import ast
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from ielts_agent.memory_proposals import (
    MAX_MEMORY_EVIDENCE_IDS,
    MAX_MEMORY_KEY_BYTES,
    MAX_MEMORY_PROPOSALS,
    MAX_MEMORY_STATEMENT_BYTES,
    MemoryProposalAction,
    MemoryProposalParseError,
    parse_memory_proposal_batch,
)


REPOSITORY_ROOT = Path(__file__).parents[2]
FIXTURE_ROOT = REPOSITORY_ROOT / "schemas" / "memory_proposal" / "fixtures" / "v1"
MODULE_PATH = Path(__file__).parents[1] / "src" / "ielts_agent" / "memory_proposals.py"


def batch(proposals: list[dict], *, schema_version: object = 1) -> str:
    return json.dumps(
        {"schemaVersion": schema_version, "proposals": proposals},
        ensure_ascii=False,
    )


def add_proposal(**updates: object) -> dict:
    proposal: dict[str, object] = {
        "action": "ADD",
        "namespace": "strategy",
        "canonicalKey": "strategy.reading.local_evidence",
        "scope": {"type": "activity", "key": "reading"},
        "statement": "Confirm local evidence before committing.",
        "evidenceObservationIds": ["obs-reading-1"],
    }
    proposal.update(updates)
    return proposal


def target_proposal(action: str = "REINFORCE", **updates: object) -> dict:
    proposal: dict[str, object] = {
        "action": action,
        "targetMemoryId": "mem-strategy-reading-1",
        "evidenceObservationIds": ["obs-reading-1"],
    }
    proposal.update(updates)
    return proposal


class MemoryProposalBoundaryTests(unittest.TestCase):
    def assert_rejected(self, payload: str, code: str) -> MemoryProposalParseError:
        with self.assertRaises(MemoryProposalParseError) as raised:
            parse_memory_proposal_batch(payload)
        self.assertEqual(raised.exception.code, code)
        return raised.exception

    def test_checked_in_valid_fixtures_round_trip_without_wire_shape_drift(self) -> None:
        for fixture_path in sorted(FIXTURE_ROOT.glob("*.json")):
            with self.subTest(fixture=fixture_path.name):
                fixture = fixture_path.read_text(encoding="utf-8")
                parsed = parse_memory_proposal_batch(fixture)
                self.assertEqual(parsed.to_wire(), json.loads(fixture))

    def test_all_supported_actions_parse(self) -> None:
        proposals = [
            add_proposal(),
            target_proposal("REINFORCE"),
            {
                **target_proposal("REFINE"),
                "proposedStatement": "Refined statement.",
            },
            target_proposal("IMPROVE"),
            target_proposal("REGRESS"),
            target_proposal("CONTRADICT"),
            {
                "action": "SUPERSEDE",
                "targetMemoryId": "mem-strategy-reading-1",
                "namespace": "strategy",
                "canonicalKey": "strategy.reading.replacement",
                "scope": {"type": "activity", "key": "reading"},
                "proposedStatement": "Replacement statement.",
                "evidenceObservationIds": ["obs-reading-1"],
            },
            target_proposal("ARCHIVE"),
            {"action": "NOOP"},
        ]
        parsed = parse_memory_proposal_batch(batch(proposals))
        self.assertEqual(
            [proposal.action for proposal in parsed.proposals],
            list(MemoryProposalAction),
        )

    def test_unknown_action_fields_and_array_index_mutation_are_rejected(self) -> None:
        self.assert_rejected(batch([{"action": "DELETE"}]), "unknown_action")
        indexed = target_proposal()
        indexed.pop("targetMemoryId")
        indexed["index"] = 7
        error = self.assert_rejected(batch([indexed]), "schema_unknown_field")
        self.assertIn("index", error.message)
        self.assert_rejected(
            batch([target_proposal(extra=True)]), "schema_unknown_field"
        )
        self.assert_rejected(
            batch([target_proposal(target_memory_id="mem-legacy")]),
            "schema_unknown_field",
        )

    def test_batch_evidence_and_string_limits_are_enforced(self) -> None:
        accepted = parse_memory_proposal_batch(
            batch([{"action": "NOOP"}] * MAX_MEMORY_PROPOSALS)
        )
        self.assertEqual(len(accepted.proposals), MAX_MEMORY_PROPOSALS)
        self.assert_rejected(
            batch([{"action": "NOOP"}] * (MAX_MEMORY_PROPOSALS + 1)),
            "proposal_limit_exceeded",
        )

        evidence = [f"obs-reading-{index}" for index in range(MAX_MEMORY_EVIDENCE_IDS)]
        parse_memory_proposal_batch(
            batch([target_proposal(evidenceObservationIds=evidence)])
        )
        evidence.append("obs-reading-over-limit")
        self.assert_rejected(
            batch([target_proposal(evidenceObservationIds=evidence)]),
            "evidence_limit_exceeded",
        )
        self.assert_rejected(
            batch([target_proposal(evidenceObservationIds=["obs-reading-1", "obs-reading-1"])]),
            "duplicate_observation_id",
        )

        key_prefix = "strategy."
        boundary_key = key_prefix + "x" * (MAX_MEMORY_KEY_BYTES - len(key_prefix))
        parse_memory_proposal_batch(batch([add_proposal(canonicalKey=boundary_key)]))
        self.assert_rejected(
            batch([add_proposal(canonicalKey=boundary_key + "x")]),
            "string_limit_exceeded",
        )
        parse_memory_proposal_batch(
            batch([add_proposal(statement="x" * MAX_MEMORY_STATEMENT_BYTES)])
        )
        self.assert_rejected(
            batch([add_proposal(statement="x" * (MAX_MEMORY_STATEMENT_BYTES + 1))]),
            "string_limit_exceeded",
        )

    def test_version_ids_scope_and_camel_case_fail_closed(self) -> None:
        for version in (0, 2, "1", True):
            with self.subTest(version=version):
                self.assert_rejected(
                    batch([], schema_version=version), "unsupported_schema_version"
                )
        for proposal, code in (
            (target_proposal(targetMemoryId="memory-1"), "invalid_memory_id"),
            (
                target_proposal(evidenceObservationIds=["observation-1"]),
                "invalid_observation_id",
            ),
            (
                add_proposal(scope={"type": "activity", "key": "speaking"}),
                "invalid_scope",
            ),
            (
                add_proposal(scope={"type": "global", "key": "reading"}),
                "invalid_scope",
            ),
        ):
            with self.subTest(code=code, proposal=proposal):
                self.assert_rejected(batch([proposal]), code)
        self.assert_rejected(
            json.dumps({"schema_version": 1, "proposals": []}),
            "schema_unknown_field",
        )

    def test_malformed_duplicate_and_non_finite_json_are_rejected(self) -> None:
        for payload in (
            '{"schemaVersion":1,"proposals":[}',
            '{"schemaVersion":1,"schemaVersion":1,"proposals":[]}',
            '{"schemaVersion":NaN,"proposals":[]}',
        ):
            with self.subTest(payload=payload):
                with self.assertRaises(MemoryProposalParseError):
                    parse_memory_proposal_batch(payload)

    def test_source_imports_are_standard_library_only(self) -> None:
        tree = ast.parse(MODULE_PATH.read_text(encoding="utf-8"))
        imported_roots: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported_roots.update(alias.name.partition(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported_roots.add(node.module.partition(".")[0])
        self.assertLessEqual(
            imported_roots,
            {"__future__", "dataclasses", "enum", "json", "re", "typing"},
        )
        self.assertTrue(
            imported_roots.isdisjoint({"sqlite3", "keyring", "tauri"})
        )


if __name__ == "__main__":
    unittest.main()
