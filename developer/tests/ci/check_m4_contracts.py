#!/usr/bin/env python3
"""Static contract checks for the M4 learner model vertical slice."""
from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def main() -> int:
    failures: list[str] = []
    migration = read("crates/ielts-db/migrations/0015_learner_model_v1.sql")
    registry = read("crates/ielts-db/src/migrate/mod.rs")
    domain = read("crates/ielts-domain/src/learner.rs")
    db = read("crates/ielts-db/src/learner.rs")
    application = read("crates/ielts-application/src/learner.rs")
    tauri = read("src-tauri/src/commands/learner.rs")
    flags = read("apps/writing-vue/src/config/feature-flags.js")
    router = read("apps/writing-vue/src/main.js")
    page = read("apps/writing-vue/src/views/LearnerModelPage.vue")

    for table in (
        "skill_catalog",
        "question_skill_map",
        "learner_skill_observations",
        "learner_skill_state",
        "skill_review_schedule",
    ):
        if f"CREATE TABLE IF NOT EXISTS {table}" not in migration:
            failures.append(f"M4 migration is missing table {table}")
    for source in ("builtin", "content_pack", "manual", "model_proposed"):
        if source not in migration:
            failures.append(f"M4 migration is missing mapping source {source}")
    if "version: 15" not in registry or "0015_learner_model_v1.sql" not in registry:
        failures.append("migration registry does not apply M4 version 15 after M3 version 14")
    if "active = 0 OR mapping_source <> 'model_proposed'" not in migration:
        failures.append("model proposals are not prevented from entering active taxonomy")

    for symbol in (
        "effective_observation_weight",
        "familiarity_weights",
        "decay_state_toward_neutral",
        "review_priority",
        "preferred_probe",
    ):
        if f"fn {symbol}" not in domain:
            failures.append(f"domain learner contract is missing {symbol}")
    if "mapping_weight" not in domain or "familiarity_weight" not in domain:
        failures.append("weighted learner observation fields are incomplete")
    for symbol in (
        "learner_model_rebuild",
        "learner_model_verify",
        "learner_state_snapshot",
        "skill_review_needs_snapshot",
    ):
        if f"fn {symbol}" not in db:
            failures.append(f"database learner projection is missing {symbol}")
    if "learner_observations" not in db or "question_skill_map" not in db:
        failures.append("M4 is not reading the M2 observation projection and question map")
    if "LearnerModelStore" not in application or "LearnerModelAdminStore" not in application:
        failures.append("application layer does not separate bounded reads from admin rebuild")

    for command in (
        "learner_model_get_state",
        "learner_model_get_review_needs",
        "learner_model_rebuild",
        "learner_model_verify",
    ):
        if command not in tauri:
            failures.append(f"Tauri learner command is missing {command}")
    if 'feature = "learner-model-v1"' not in tauri:
        failures.append("Tauri learner commands are not feature gated")
    if "learnerModelV1" not in flags or "VITE_FEATURE_LEARNER_MODEL_V1" not in flags:
        failures.append("frontend learner-model feature flag is missing")
    if "VITE_FEATURE_LEARNER_MODEL_V1,\n    false" not in flags:
        failures.append("learner-model feature flag must default to false")
    if "learnerModelV1 ?" not in router or "LearnerModelPage.vue" not in router:
        failures.append("learner-model route is not feature gated")
    if "masteryMean" in page or "uncertainty =" in page:
        failures.append("learner UI exposes false precision instead of bands/evidence")
    for field in ("evidenceCount", "distinctAssetCount", "reasonCodes", "avoidAssetIds"):
        if field not in page:
            failures.append(f"learner UI is missing explainability field {field}")

    if failures:
        print("M4 contract failures:")
        for failure in failures:
            print(f"- {failure}")
        return 1
    print("M4 learner-model contract verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
