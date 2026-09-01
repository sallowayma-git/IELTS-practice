#!/usr/bin/env python3
"""Phase 10 static gate for the shipping Tauri 2 application.

This gate deliberately ignores the retired root HTML/Electron/Fastify host.
It verifies the only shipping path: Vue build -> Tauri frontendDist -> Rust
workspace, plus source reading-data integrity while that migration is active.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
REPORT = ROOT / "developer/tests/e2e/reports/static-ci-report.json"

for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass


def run_command(name: str, command: list[str], cwd: Path = ROOT) -> dict[str, Any]:
    environment = os.environ.copy()
    environment["PYTHONUTF8"] = "1"
    environment["PYTHONIOENCODING"] = "utf-8"
    try:
        completed = subprocess.run(
            command,
            cwd=cwd,
            env=environment,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=300,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"name": name, "status": "fail", "detail": str(exc)}

    output = "\n".join(part.strip() for part in (completed.stdout, completed.stderr) if part.strip())
    return {
        "name": name,
        "status": "pass" if completed.returncode == 0 else "fail",
        "exitCode": completed.returncode,
        "detail": output[-4000:],
    }


def check_tauri_contract() -> dict[str, Any]:
    config_path = ROOT / "src-tauri/tauri.conf.json"
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {"name": "Tauri shipping contract", "status": "fail", "detail": str(exc)}

    build = config.get("build") or {}
    failures: list[str] = []
    if build.get("frontendDist") != "../dist/writing":
        failures.append("frontendDist must be ../dist/writing")
    if not str(build.get("beforeBuildCommand") or "").startswith("npm --prefix apps/writing-vue"):
        failures.append("beforeBuildCommand must build apps/writing-vue")
    capabilities = ((config.get("app") or {}).get("security") or {}).get("capabilities")
    if capabilities != ["main"]:
        failures.append("shipping window must only receive the main capability")

    capability_dir = ROOT / "src-tauri/capabilities"
    capability_files = sorted(path.name for path in capability_dir.glob("*.json"))
    if capability_files != ["main.json"]:
        failures.append(f"unexpected capability files: {capability_files}")

    bundle = config.get("bundle") or {}
    if bundle.get("createUpdaterArtifacts") is not False:
        failures.append("base config must disable updater artifacts; release overlay enables them")
    if ((bundle.get("windows") or {}).get("allowDowngrades")) is not False:
        failures.append("Windows installers must reject version downgrades")
    resources = bundle.get("resources") or {}
    writing_catalog_source = "../assets/generated/writing-topics"
    if resources.get(writing_catalog_source) != "writing-topics":
        failures.append("bundled writing catalog must be mapped to the writing-topics resource directory")
    writing_catalog = ROOT / "assets/generated/writing-topics/bc-task2-2024-12_2025-01.catalog.json"
    if not writing_catalog.is_file():
        failures.append("bundled writing catalog source file is missing")
    for icon in bundle.get("icon") or []:
        if not (ROOT / "src-tauri" / icon).is_file():
            failures.append(f"bundle icon does not exist: {icon}")

    updater = (config.get("plugins") or {}).get("updater") or {}
    if set(updater).difference({"endpoints", "pubkey", "windows"}):
        failures.append("updater config contains non-Tauri fields")
    if updater.get("endpoints") or updater.get("pubkey"):
        failures.append("base updater config must be unconfigured; release overlay injects public inputs")

    cargo_toml = (ROOT / "src-tauri/Cargo.toml").read_text(encoding="utf-8")
    rust_shell = (ROOT / "src-tauri/src/lib.rs").read_text(encoding="utf-8")
    for needle in ("seed_builtin_writing_catalog", "bc-task2-2024-12_2025-01.catalog.json"):
        if needle not in rust_shell:
            failures.append(f"native startup does not seed the bundled writing catalog ({needle})")
    for plugin in ("tauri-plugin-fs", "tauri-plugin-process"):
        if plugin in cargo_toml:
            failures.append(f"unused privileged plugin dependency remains: {plugin}")
    for plugin in ("tauri_plugin_fs", "tauri_plugin_process"):
        if plugin in rust_shell:
            failures.append(f"unused privileged plugin registration remains: {plugin}")
    if "tauri-plugin-shell" not in cargo_toml or "tauri_plugin_shell" not in rust_shell:
        failures.append("M3 host-owned sidecar requires the Rust-only shell plugin")
    capability_text = "\n".join(
        path.read_text(encoding="utf-8")
        for path in (ROOT / "src-tauri/capabilities").glob("*.json")
    )
    if "shell:" in capability_text:
        failures.append("WebView capabilities must not expose shell permissions")
    diagnostics = (ROOT / "src-tauri/src/commands/diagnostics.rs").read_text(encoding="utf-8")
    for command in ("install_update", "restart_after_update"):
        if command not in diagnostics or command not in rust_shell:
            failures.append(f"native updater command is not registered: {command}")
    evaluating_page = (ROOT / "apps/writing-vue/src/views/EvaluatingPage.vue").read_text(encoding="utf-8")
    if "Math.random" in evaluating_page:
        failures.append("evaluation progress animation must not use random timing")
    serialized = json.dumps(config).lower()
    for retired in ("electron", "fastify", "file://"):
        if retired in serialized:
            failures.append(f"retired host reference in tauri.conf.json: {retired}")

    return {
        "name": "Tauri shipping contract",
        "status": "fail" if failures else "pass",
        "detail": failures or "Tauri-only host, least privilege, and release-overlay contract verified",
    }


def check_required_sources() -> dict[str, Any]:
    required = [
        ROOT / "apps/writing-vue/package.json",
        ROOT / "apps/writing-vue/src/main.js",
        ROOT / "src-tauri/Cargo.toml",
        ROOT / "src-tauri/src/main.rs",
        ROOT / "crates/ielts-domain/Cargo.toml",
        ROOT / "crates/ielts-db/Cargo.toml",
    ]
    missing = [str(path.relative_to(ROOT)) for path in required if not path.is_file()]
    return {
        "name": "Shipping source layout",
        "status": "fail" if missing else "pass",
        "detail": {"missing": missing},
    }


def main() -> int:
    checks = [
        check_required_sources(),
        check_tauri_contract(),
        run_command(
            "Current document drift",
            [sys.executable, "developer/tests/ci/check_doc_drift.py"],
        ),
        run_command("Vue typecheck", ["npm.cmd", "--prefix", "apps/writing-vue", "run", "typecheck"]),
        run_command(
            "Reading payload contract",
            ["node", "developer/tests/js/readingAssetPayloadShape.test.mjs"],
        ),
        run_command(
            "Reading drag keyboard behavior",
            ["node", "developer/tests/js/readingDragSelection.test.mjs"],
        ),
        run_command(
            "Reading highlight core",
            ["node", "developer/tests/js/readingHighlightCore.test.mjs"],
        ),
        run_command(
            "Reading mode flow core",
            ["node", "developer/tests/js/readingModeFlowCore.test.mjs"],
        ),
        run_command(
            "Reading mode idempotency",
            ["node", "developer/tests/js/modeIdempotency.test.mjs"],
        ),
        run_command(
            "Reading Library truth contract",
            ["node", "developer/tests/js/practiceReadingCore10.test.js"],
        ),
        run_command(
            "History view-model contract",
            ["node", "developer/tests/js/historyViewModel.test.mjs"],
        ),
        run_command(
            "Writing source-mode contract",
            ["node", "developer/tests/js/writingMode.test.mjs"],
        ),
        run_command(
            "Tauri Vue shell contract",
            ["node", "developer/tests/js/practiceVueShell.test.js"],
        ),
        run_command(
            "Phase 10 release contract",
            [sys.executable, "developer/tests/ci/release_contract_test.py"],
        ),
        run_command("Vue production build", ["npm.cmd", "--prefix", "apps/writing-vue", "run", "build"]),
        run_command("Rust workspace check", ["cargo", "check", "--workspace", "--locked"]),
        run_command(
            "Rust cognitive runtime contract",
            ["cargo", "test", "-p", "ielts-practice-tauri", "--lib", "cognitive_runtime"],
        ),
        run_command(
            "Rust memory proposal validator",
            ["cargo", "test", "-p", "ielts-application", "--lib", "memory"],
        ),
        run_command(
            "Rust memory proposal wire contract",
            ["cargo", "test", "-p", "ielts-application", "--test", "memory_proposal_contract"],
        ),
        run_command(
            "Rust memory application service contract",
            ["cargo", "test", "-p", "ielts-application", "--test", "memory_service_contract"],
        ),
        run_command(
            "Rust data-truth regressions",
            [
                "cargo",
                "test",
                "-p",
                "ielts-db",
                "--test",
                "phase4_history_settings",
                "--test",
                "phase5_writing_eval",
                "--test",
                "phase8_annotations_coach",
                "--test",
                "learning_events",
                "--test",
                "backup_full_roundtrip",
                "--test",
                "history_retention",
                "--test",
                "reading_archive_transaction",
                "--test",
                "learning_observations",
                "--test",
                "cognitive_read",
                "--test",
                "memory_profile_core",
                "--test",
                "learner_model",
                # Round-3 audit remediation (2026-08-31): these three suites
                # carry the regression tests for the fixes landed in that pass
                # and were outside every gate until now.
                #   consolidation    — M8 weekly-dream validator: byte bound,
                #                      injection/secret/inference-domain
                #                      guards, per-owner support scoping, and
                #                      the stale-sweep COALESCE predicate that
                #                      otherwise archives a pattern the day it
                #                      is written.
                #   prompt_skill     — M11 rollback gate: an actor is required
                #                      and reinstatement is constrained to
                #                      status='rollback', so rollback can no
                #                      longer activate a never-evaluated draft.
                #   context_snapshot — M5-08 snapshot identity: two identical
                #                      renders must both persist, and one id
                #                      must never be written twice.
                "--test",
                "consolidation",
                "--test",
                "prompt_skill",
                "--test",
                "context_snapshot",
            ],
        ),
        run_command(
            "Rust M4 domain learner contract",
            ["cargo", "test", "-p", "ielts-domain", "--locked", "--offline"],
        ),
        run_command(
            "Rust M4 application learner contract",
            ["cargo", "test", "-p", "ielts-application", "--lib", "learner", "--locked", "--offline"],
        ),
        run_command(
            "AI configuration security",
            [sys.executable, "developer/tests/ci/check_ai_config_security.py"],
        ),
        run_command(
            "Reading source data integrity",
            [sys.executable, "developer/tests/ci/check_reading_data_integrity.py"],
        ),
        run_command(
            "Python cognitive protocol",
            [
                sys.executable,
                "-m",
                "unittest",
                "discover",
                "-s",
                "agent-runtime-python/tests",
                "-p",
                "test_*.py",
            ],
        ),
        run_command(
            "M3 contract boundary",
            [sys.executable, "developer/tests/ci/check_m3_contracts.py"],
        ),
        run_command(
            "M4 learner model contract",
            [sys.executable, "developer/tests/ci/check_m4_contracts.py"],
        ),
    ]
    passed = all(check["status"] == "pass" for check in checks)
    report = {
        "schemaVersion": 2,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "scope": "tauri-vue-shipping-baseline",
        "status": "pass" if passed else "fail",
        "summary": {
            "total": len(checks),
            "passed": sum(check["status"] == "pass" for check in checks),
            "failed": sum(check["status"] == "fail" for check in checks),
        },
        "checks": checks,
        "excludedRetiredHosts": ["Electron", "Fastify", "root index.html", "file:// E2E host"],
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
