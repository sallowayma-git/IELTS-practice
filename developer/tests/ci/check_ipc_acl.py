#!/usr/bin/env python3
"""Guard: the webview may call exactly the app commands the shipped frontend uses.

build.rs declares every command in lib.rs `generate_handler![...]` to Tauri's
app ACL, so a command runs only when capabilities/main.json allows it. This
check keeps that allow-list in step with the code:

* every registered command the Vue frontend names must be allowed (otherwise
  the product call is denied at runtime);
* every allowed command must be registered and named by the frontend (a
  diagnostic, rebuild or developer-tools command stays host-only);
* deleted M10/M11 commands must stay unregistered.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
LIB_RS = ROOT / "src-tauri/src/lib.rs"
CAPABILITY = ROOT / "src-tauri/capabilities/main.json"
FRONTEND = ROOT / "apps/writing-vue/src"
FRONTEND_SUFFIXES = {".js", ".mjs", ".ts", ".vue"}
DELETED_COMMANDS = {
    "eval_run_case", "prompt_approve_candidate", "prompt_promote_candidate",
    "prompt_rollback", "prompt_list_versions", "prompt_get_active",
    "prompt_propose_candidate", "skill_list_versions", "teaching_strategy_select",
    "teaching_strategy_promote_candidate", "teaching_strategy_user_state",
}


def registered_commands() -> dict[str, str]:
    """Command name -> the cfg attribute guarding it ('' when ungated)."""
    text = LIB_RS.read_text(encoding="utf-8")
    start = text.index("generate_handler![")
    end = text.index("])", start)
    commands: dict[str, str] = {}
    cfg = ""
    for line in text[start:end].splitlines()[1:]:
        line = line.strip()
        if line.startswith("//"):
            continue
        if line.startswith("#[cfg"):
            cfg = line
        elif "::" in line:
            commands[line.rstrip(",").rsplit("::", 1)[1]] = cfg
            cfg = ""
    if not commands:
        raise SystemExit("could not parse generate_handler! from lib.rs")
    return commands


def frontend_literals() -> set[str]:
    literals: set[str] = set()
    for path in FRONTEND.rglob("*"):
        if path.suffix in FRONTEND_SUFFIXES:
            text = path.read_text(encoding="utf-8", errors="replace")
            literals |= set(re.findall(r"""['"`]([a-z][a-z0-9_]*)['"`]""", text))
    return literals


def allowed_commands() -> set[str]:
    permissions = json.loads(CAPABILITY.read_text(encoding="utf-8"))["permissions"]
    allowed = set()
    for permission in permissions:
        identifier = permission if isinstance(permission, str) else permission["identifier"]
        if ":" in identifier:
            continue  # core:/plugin permissions, not app commands
        if not identifier.startswith("allow-"):
            raise SystemExit(f"unexpected app permission in main.json: {identifier}")
        allowed.add(identifier.removeprefix("allow-"))
    return allowed


def main() -> int:
    registered = registered_commands()
    slugs = {name.replace("_", "-"): name for name in registered}
    used = set(registered) & frontend_literals()
    allowed = allowed_commands()
    failures = []
    for slug in sorted(allowed - slugs.keys()):
        failures.append(f"main.json allows unregistered command allow-{slug}")
    allowed_names = {slugs[slug] for slug in allowed & slugs.keys()}
    for name in sorted(used - allowed_names):
        failures.append(f"frontend calls {name} but main.json does not allow it")
    for name in sorted(allowed_names - used):
        failures.append(f"main.json allows {name}, which the frontend never calls")
    for name in sorted(allowed_names):
        if "developer-tools" in registered[name]:
            failures.append(f"main.json allows developer-tools command {name}")
    for name in sorted(DELETED_COMMANDS & registered.keys()):
        failures.append(f"deleted command {name} is registered again")
    for failure in failures:
        print(f"FAIL {failure}")
    if failures:
        return 1
    print(f"IPC ACL OK: {len(allowed_names)} of {len(registered)} commands reachable from the webview")
    return 0


if __name__ == "__main__":
    sys.exit(main())
