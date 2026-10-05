"""Consume the production Rust learner DTO on stdin and return Python's query.

Invoked by the learner_model Rust integration suite; never ships in the app.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "agent-runtime-python" / "src"))

from ielts_agent.coach.personalized_coach import (
    CAPABILITY_LEARNER_SKILL_STATE, CoachFrozenInput, PythonPersonalizedCoach,
    _extract_proficiencies,
)
from ielts_agent.planner.study_plan import _parse_review_needs, _parse_uncertainty_map


class RustSnapshotBridge:
    def __init__(self, snapshot: dict) -> None:
        self.snapshot = snapshot
        self.params: dict = {}

    def invoke(self, method: str, params: dict, **_: object) -> dict:
        assert method == CAPABILITY_LEARNER_SKILL_STATE
        self.params = params
        return self.snapshot


def main() -> None:
    snapshot = json.load(sys.stdin)
    keys = tuple(row["skillKey"] for row in snapshot["states"])
    assert keys, "Rust fixture must contain real skill evidence"
    bridge = RustSnapshotBridge(snapshot)
    frozen = CoachFrozenInput(
        trace_id="wire-probe", activity="reading", task_kind="AttemptReview",
        skills_addressed=keys, context_plan={},
    )
    received = PythonPersonalizedCoach(bridge)._fetch_learner_skill_state(
        frozen, started=time.monotonic(),
    )
    proficiencies = _extract_proficiencies(received)
    assert proficiencies == {row["skillKey"]: row["masteryMean"] for row in snapshot["states"]}
    assert _extract_proficiencies(snapshot) == proficiencies  # prefetched path
    uncertainty = _parse_uncertainty_map(received)
    assert uncertainty == {row["skillKey"]: row["uncertainty"] for row in snapshot["states"]}
    needs = _parse_review_needs(received)
    assert [row.skill_key for row in needs] == [row["skillKey"] for row in snapshot["needs"]]
    assert all(row.avoid_asset_ids for row in needs)
    assert len(needs) == len(keys)
    print(json.dumps(bridge.params))


if __name__ == "__main__":
    main()
