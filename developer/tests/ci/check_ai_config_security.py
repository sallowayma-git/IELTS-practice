#!/usr/bin/env python3
"""Static security contract for the Rust-owned AI configuration boundary."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
VUE_ROOT = ROOT / "apps/writing-vue/src"
AI_COMMANDS_RUST = ROOT / "src-tauri/src/commands/ai.rs"
AI_CONFIG_RUST = ROOT / "src-tauri/src/ai/config.rs"
AI_SETTINGS_RUST = ROOT / "crates/ielts-db/src/settings/mod.rs"
WRITING_RUST = ROOT / "src-tauri/src/commands/writing.rs"
TAURI_LIB = ROOT / "src-tauri/src/lib.rs"
CLIENT = ROOT / "apps/writing-vue/src/api/client.js"
SETTINGS_REPOSITORY = ROOT / "apps/writing-vue/src/api/settings-repository.js"
FIXTURE = ROOT / "developer/tests/fixtures/legacy-provider-configs.json"

RUNTIME_KEYS = ("provider", "baseUrl", "model", "secretName", "timeoutSeconds")
AI_COMMANDS = (
    "ai_list_configs",
    "ai_upsert_config",
    "ai_delete_config",
    "ai_set_default_config",
    "ai_test_provider",
)


def fail(message: str, failures: list[str]) -> None:
    failures.append(message)


def shipping_sources() -> list[Path]:
    suffixes = {".js", ".ts", ".vue", ".cjs", ".mjs"}
    return [path for path in VUE_ROOT.rglob("*") if path.is_file() and path.suffix in suffixes]


def check_no_web_storage_secret(failures: list[str]) -> None:
    storage = re.compile(r"(?:localStorage|sessionStorage)", re.IGNORECASE)
    secret = re.compile(r"api[_-]?key|apikey|secret|password|bearer", re.IGNORECASE)
    for path in shipping_sources():
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        for index, line in enumerate(lines):
            if not storage.search(line):
                continue
            window = "\n".join(lines[max(0, index - 3) : index + 4])
            if secret.search(window):
                fail(f"{path.relative_to(ROOT)}:{index + 1}: secret material near Web Storage", failures)


def check_rust_owned_crud(failures: list[str]) -> None:
    client = CLIENT.read_text(encoding="utf-8", errors="replace")
    repository = SETTINGS_REPOSITORY.read_text(encoding="utf-8", errors="replace")
    for command in AI_COMMANDS[:-1]:
        if command not in repository:
            fail(f"frontend provider CRUD does not invoke Rust command {command}", failures)
    provider_block = re.search(r"export const configs\s*=\s*\{(?P<body>.*?)\n\}", client, re.DOTALL)
    if provider_block and re.search(r"(?:readKvList|writeKv|deleteKv)\(['\"]provider_configs", provider_block.group("body")):
        fail("frontend provider CRUD still persists provider_configs through generic SQLite settings", failures)

    if re.search(r"(?:writeKv|upsertSetting)[^\n]*(?:api_key|apiKey)", client + repository):
        fail("frontend persists plaintext API key through generic settings storage", failures)


def check_runtime_contract(failures: list[str]) -> None:
    commands = AI_COMMANDS_RUST.read_text(encoding="utf-8", errors="replace")
    config = AI_CONFIG_RUST.read_text(encoding="utf-8", errors="replace")
    settings = AI_SETTINGS_RUST.read_text(encoding="utf-8", errors="replace")
    client = CLIENT.read_text(encoding="utf-8", errors="replace")
    repository = SETTINGS_REPOSITORY.read_text(encoding="utf-8", errors="replace")
    registered = TAURI_LIB.read_text(encoding="utf-8", errors="replace")
    for key in RUNTIME_KEYS:
        if f'"{key}"' not in settings:
            fail(f"Rust AI runtime mirror owner is missing key {key}", failures)
    if "fn write_ai_runtime_value" not in settings:
        fail("Rust AI runtime mirror has no dedicated settings writer", failures)
    if "pub fn reconcile_default_ai_config" not in settings:
        fail("Rust AI settings owner does not reconcile the persisted default", failures)
    if "reconcile_default_ai_config_with_secret_availability" not in settings:
        fail("Rust AI settings owner does not distinguish a local vault key from a secret reference", failures)
    has_vault_reconciliation = (
        "fn reconcile_default_ai_config_with_vault" in config
        or "fn reconcile_default_ai_config_with_refs" in config
    )
    if not has_vault_reconciliation or "list_ai_configs_with_vault" not in commands:
        fail("Rust AI adapter does not reconcile the active configuration against the local vault", failures)
    if "list_ai_configs_with_secret_availability" not in config:
        fail("Rust AI adapter exposes backup-restored secret references as usable configs", failures)
    if "config_id: String" not in commands or "load_runtime_for_config(&db, &vault, &config_id)" not in commands:
        fail("AI provider test does not target the user-selected configuration", failures)
    if "testAiProvider(configId)" not in repository or "async test(id)" not in client:
        fail("frontend provider test does not forward its selected configuration id", failures)
    writing = WRITING_RUST.read_text(encoding="utf-8", errors="replace")
    if "load_provider_config(&db, &vault)" not in writing:
        fail("writing evaluation does not preflight the local vault before provider work", failures)
    start_command = re.search(
        r"pub async fn writing_start_evaluation\b.*?\n}\n",
        writing,
        re.DOTALL,
    )
    if not start_command or "load_provider_config(&db, &vault)" not in start_command.group(0):
        fail("writing evaluation can start without a local-vault provider preflight", failures)
    submit_command = re.search(
        r"pub fn writing_submit_attempt\b.*?\n}\n",
        writing,
        re.DOTALL,
    )
    if not submit_command:
        fail("writing durable submit command is missing", failures)
    elif "load_provider_config(&db, &vault)" in submit_command.group(0) or "AppVault" in submit_command.group(0):
        fail("writing submit is incorrectly coupled to the local AI provider", failures)
    for command in AI_COMMANDS:
        if f"commands::ai::{command}" not in registered:
            fail(f"Tauri invoke handler does not register {command}", failures)


def check_legacy_fixture(failures: list[str]) -> None:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    legacy = fixture.get("legacy") or []
    expected = fixture.get("expectedRuntimeSettings") or {}
    forbidden = set(fixture.get("forbiddenPersistedKeys") or [])
    if not legacy or not any("api_key" in row for row in legacy):
        fail("legacy provider fixture must contain a plaintext api_key regression sample", failures)
    if set(RUNTIME_KEYS) != set(expected):
        fail("legacy provider fixture must map exactly to the complete Rust runtime key set", failures)
    leaked = forbidden.intersection(expected)
    if leaked:
        fail(f"legacy migration expectation persists forbidden keys: {sorted(leaked)}", failures)


def main() -> int:
    failures: list[str] = []
    check_no_web_storage_secret(failures)
    check_rust_owned_crud(failures)
    check_runtime_contract(failures)
    check_legacy_fixture(failures)
    if failures:
        print("AI configuration security gate failed:")
        for item in failures:
            print(f"- {item}")
        return 1
    print("AI configuration security gate passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
