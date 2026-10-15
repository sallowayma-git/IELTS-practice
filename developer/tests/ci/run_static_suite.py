#!/usr/bin/env python3
"""Phase 10 static gate for the shipping Tauri 2 application.

This gate deliberately ignores the retired root HTML/Electron/Fastify host.
It verifies the only shipping path: Vue build -> Tauri frontendDist -> Rust
workspace, plus source reading-data integrity while that migration is active.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
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
    retries = 0
    while True:
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
        linker_busy = (
            sys.platform == "win32"
            and command[0] == "cargo" and "test" in command
            and re.search(r"LNK1104:[^\r\n]*[\\/]target[\\/]debug[\\/]deps[\\/][^\r\n]+\.exe", completed.stderr)
        )
        if completed.returncode == 0 or not linker_busy or retries == 2:
            break
        retries += 1
        time.sleep(1)

    output = "\n".join(part.strip() for part in (completed.stdout, completed.stderr) if part.strip())
    if retries:
        output += f"\nWindows test executable linker LNK1104 retries: {retries}"
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
    ecdict_source = "../assets/wordlists/ecdict_reading.bundle.js"
    if resources.get(ecdict_source) != "wordlists/ecdict_reading.bundle.js":
        failures.append("bundled ECDICT dictionary must ship as wordlists/ecdict_reading.bundle.js (dictionary_lookup reads it)")
    if not (ROOT / "assets/wordlists/ecdict_reading.bundle.js").is_file():
        failures.append("bundled ECDICT dictionary source file is missing")
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
    # M10 teaching-strategy and M11 prompt/skill commands are engineering
    # surfaces: registered only behind `developer-tools`, never called by the UI.
    handler_lines = rust_shell[rust_shell.index("generate_handler!["):].splitlines()
    gated = [index for index, line in enumerate(handler_lines)
             if "commands::teaching_strategy::" in line or "commands::prompt_skill::" in line]
    if not gated:
        failures.append("M10/M11 commands are no longer listed in the handler; update this gate")
    for index in gated:
        if 'feature = "developer-tools"' not in handler_lines[index - 1]:
            failures.append(f"M10/M11 command is not gated by developer-tools: {handler_lines[index].strip()}")
    command_names = re.findall(r"commands::(?:teaching_strategy|prompt_skill)::(\w+)", "\n".join(handler_lines))
    for source in (ROOT / "apps/writing-vue/src").rglob("*"):
        if source.suffix not in {".js", ".ts", ".vue", ".mjs"} or not source.is_file():
            continue
        text = source.read_text(encoding="utf-8")
        for name in command_names:
            if name in text:
                failures.append(f"frontend references developer-only command {name}: {source.relative_to(ROOT)}")
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
            "Reading asset list boundary",
            ["node", "developer/tests/js/readingAssetList.test.mjs"],
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
        run_command("Memory evidence navigation contract", ["node", "developer/tests/js/memoryEvidence.test.mjs"]),
        run_command("Agent console durable state contract", ["node", "developer/tests/js/agentConsoleState.test.mjs"]),
        run_command("Notebook prose composition", ["node", "developer/tests/js/notebookCompose.test.mjs"]),
        run_command("Notebook phrasing bank", ["node", "developer/tests/js/notebookPhrasing.test.mjs"]),
        run_command("Notebook weekly report", ["node", "developer/tests/js/notebookWeekly.test.mjs"]),
        run_command("Reading Coach hydration contract", ["node", "developer/tests/js/readingCoachHydration.test.mjs"]),
        run_command("Reading AI review is opt-in", ["node", "developer/tests/js/readingReviewOptIn.test.mjs"]),
        run_command("Coach feedback / re-ask contract", ["node", "developer/tests/js/coachFeedbackContract.test.mjs"]),
        run_command("Vue production build", ["npm.cmd", "--prefix", "apps/writing-vue", "run", "build"]),
        run_command("Rust workspace check", ["cargo", "check", "--workspace", "--locked"]),
        run_command(
            "Rust cognitive runtime contract",
            # Includes fixed workspace fallback/junction/grant boundaries as
            # well as runtime authority. Do not leave host security un-gated.
            ["cargo", "test", "-p", "ielts-practice-tauri", "--lib"],
        ),
        run_command(
            "Rust developer-tools build (M10/M11 commands, memory generation)",
            ["cargo", "check", "-p", "ielts-practice-tauri", "--features", "developer-tools", "--tests", "--locked"],
        ),
        run_command(
            "E2E harness: packaged receipts and WebDriver/WebView2 matching",
            [sys.executable, "-m", "unittest", "test_packaged_receipts", "test_webdriver_select"],
            cwd=ROOT / "developer/tests/e2e",
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
                "memory_supersede_identity",
                "--test",
                "learner_model",
                # Round-3 audit remediation (2026-08-31): these three suites
                # carry the regression tests for the fixes landed in that pass
                # and were outside every gate until now.
                #   consolidation    — M8 memory lifecycle: user feedback and
                #                      the stale sweep archive (never delete)
                #                      and propagate to dependent supports.
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
                "--test",
                "corpus_export",
                # Startup recovery must survive duplicate windows and must
                # not reset terminal retry budgets on every reboot.
                "--test",
                "background_jobs",
            ],
        ),
        run_command(
            "Rust M5 canonical context materialization",
            ["cargo", "test", "-p", "ielts-application", "--test", "context_materialization", "--locked", "--offline"],
        ),
        run_command(
            "Rust in-flight model cancellation",
            ["cargo", "test", "-p", "ielts-application", "--lib", "agent::", "--locked", "--offline"],
        ),
        run_command(
            "Rust M7–M12 phase repairs",
            ["cargo", "test", "-p", "ielts-db", "--test", "journal", "--test", "journal_lifecycle", "--test", "agent_thread", "--test", "teaching_strategy", "--test", "backup_release_history", "--test", "reading_asset_revision", "--locked", "--offline"],
        ),
        run_command(
            "Rust canonical Coach evidence",
            ["cargo", "test", "-p", "ielts-application", "--test", "coach_canonical", "--locked", "--offline"],
        ),
        run_command(
            "Rust Coach prompt cache layout and chunked history",
            ["cargo", "test", "-p", "ielts-application", "--lib", "coach::", "--locked", "--offline"],
        ),
        run_command(
            "Rust weekly dream receipts, weekly report blocks and input pack",
            ["cargo", "test", "-p", "ielts-db", "--test", "weekly_digest", "--test", "weekly_pack", "--test", "weekly_report_store", "--test", "weekly_report_facts", "--locked", "--offline"],
        ),
        run_command(
            "Rust weekly report block skills and narrative whitelist",
            ["cargo", "test", "-p", "ielts-db", "-p", "ielts-domain", "--lib", "weekly_report", "--locked", "--offline"],
        ),
        run_command(
            "Rust weekly dream host path (pack, gate, retry predicate)",
            ["cargo", "test", "-p", "ielts-practice-tauri", "--lib", "commands::journal", "--locked", "--offline"],
        ),
        run_command(
            "Rust production Coach trace and daily job receipts",
            ["cargo", "test", "-p", "ielts-db", "--test", "coach_trace", "--test", "background_jobs", "--locked", "--offline"],
        ),
        run_command(
            "Rust automatic Daily worker",
            ["cargo", "test", "-p", "ielts-practice-tauri", "--lib", "app::daily_worker", "--locked", "--offline"],
        ),
        run_command(
            "Rust data isolation and delete safety",
            ["cargo", "test", "-p", "ielts-db", "--test", "data_safety", "--locked", "--offline"],
        ),
        run_command(
            "Rust Coach v0 authority",
            ["cargo", "test", "-p", "ielts-db", "--test", "coach_feedback", "--locked", "--offline"],
        ),
        run_command(
            "Rust Coach feedback legacy authority",
            ["cargo", "test", "-p", "ielts-db", "--lib", "coach_feedback", "--locked", "--offline"],
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
            "Native reading resource checksums",
            [sys.executable, "developer/tests/ci/verify_reading_resources.py"],
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
        run_command(
            "Frontend mock contract (commands, skill keys, enums vs Rust)",
            [sys.executable, "developer/tests/ci/check_mock_contracts.py"],
        ),
        run_command(
            "Learner skill label contract",
            ["node", "developer/tests/js/learnerSkillLabels.test.mjs"],
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
