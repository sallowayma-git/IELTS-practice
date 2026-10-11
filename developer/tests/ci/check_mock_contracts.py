#!/usr/bin/env python3
"""Guard: frontend test mocks may only use values the Rust backend can emit.

Mocked Tauri commands, skill keys, probe kinds, priority bands, reason codes and
reading-asset categories are parsed from the Rust host, crates and migrations,
then every literal in developer/tests/{e2e,js} is checked against that truth.
A mock that invents a command or enum value fails here instead of passing
silently in visual/e2e runs.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SCAN_DIRS = (ROOT / "developer/tests/e2e", ROOT / "developer/tests/js")
SCAN_SUFFIXES = {".py", ".js", ".mjs"}
RUST_DIRS = (ROOT / "src-tauri/src", ROOT / "crates")
MIGRATIONS = ROOT / "crates/ielts-db/migrations"

# Deliberate negatives: fixtures that exercise raw-identifier fallbacks, not
# backend mocks. Each entry must say why it is allowed.
SKILL_KEY_ALLOWLIST = {
    ("notebookPhrasing.test.mjs", "writing.new_criterion"): "deliberate ASCII-label fallback: a real label would not exercise bracketing",
    ("notebookPhrasing.test.mjs", "writing.task1"): "deliberate all-ASCII list fixture for bracketing",
    ("notebookPhrasing.test.mjs", "writing.band_single"): "notebook phrasing variant id, not a skill key",
    ("learnerSkillLabels.test.mjs", "reading.tfng.new_probe_kind"): "deliberate unknown sub-skill fallback (label humanising)",
    ("learnerSkillLabels.test.mjs", "writing.new_criterion"): "deliberate unknown writing criterion fallback (label humanising)",
}
# Wire keys are camelCase; these snake_case names are the pre-cutover shapes.
# The lookahead skips Python annotations such as `attempt_id: str` in signatures.
FORBIDDEN_WIRE_KEYS = re.compile(
    r"(?:['\"](?:config_name|default_model|is_enabled|is_default|has_secret|is_active|"
    r"skill_probe|pending_verification|source_class|attempt_id|submitted_at)['\"]|"
    r"\b(?:config_name|default_model|is_enabled|is_default|has_secret|is_active|"
    r"skill_probe|pending_verification|source_class|attempt_id|submitted_at))\s*:(?!\s*(?:str|int|bool|dict|list|float|Path|Optional)\b)"
)
READING_CATEGORY_LOWER = re.compile(r"""category['"]?\s*:\s*['"](p[123])['"]""")
COMMAND_PATTERNS = (
    re.compile(r"""command\s*===?\s*['"]([a-z][a-z0-9_]*)['"]"""),
    re.compile(r"""\binvoke\w*\(\s*['"]([a-z][a-z0-9_]*)['"]"""),
    re.compile(r"""invoke_data\(\s*\w+\s*,\s*['"]([a-z][a-z0-9_]*)['"]"""),
    re.compile(r"""case\s+['"]([a-z][a-z0-9_]*)['"]\s*:"""),
)
SKILL_KEY = re.compile(r"""['"]((?:reading|writing)\.[a-z][a-z0-9_.]*)['"]""")
PROBE_KIND = re.compile(r"""probeKind['"]?\s*:\s*['"]([a-z_]+)['"]""")
PRIORITY_BAND = re.compile(r"""priority(?:Band|_band)['"]?\s*:\s*['"]([a-z]+)['"]""")
REASON_LIST = re.compile(r"""(?:reasonCodes|reason_codes|REASON_CODES)\b[^\[\n]*\[([^\]]*)\]""")
STRING_LITERAL = re.compile(r"""['"]([a-z][a-z0-9_]*)['"]""")


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def rel(path: Path) -> str:
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def registered_commands() -> set[str]:
    text = read(ROOT / "src-tauri/src/lib.rs")
    start = text.index("generate_handler![")
    end = text.index("\n        ])", start)
    names = set()
    for line in text[start:end].splitlines():
        match = re.match(r"^\s*(?:[A-Za-z_]\w*::)+([a-z_][a-z0-9_]*),?\s*$", line)
        if match:
            names.add(match.group(1))
    if not names:
        raise SystemExit("could not parse generate_handler! command list from lib.rs")
    return names


def skill_catalog() -> set[str]:
    keys: set[str] = set()
    for path in MIGRATIONS.glob("*.sql"):
        text = read(path)
        for match in re.finditer(r"INSERT\s+(?:OR\s+\w+\s+)?INTO\s+skill_catalog\b.*?;", text, re.S):
            keys.update(re.findall(r"""\('((?:reading|writing)\.[a-z0-9_.]+)'""", match.group(0)))
    if not keys:
        raise SystemExit("no skill_catalog rows found in migrations")
    return keys


def writing_criteria() -> set[str]:
    """The criterion names the backend stores as skill keys `writing.<criterion>`."""
    text = read(ROOT / "crates/ielts-db/src/teaching_strategy.rs")
    match = re.search(r"matches!\(\s*\*field,\s*((?:\"[A-Za-z]+\"\s*\|?\s*)+)\)", text)
    if not match:
        raise SystemExit("could not parse writing criterion list from teaching_strategy.rs")
    return set(re.findall(r'"([A-Za-z]+)"', match.group(1)))


def probe_kinds() -> set[str]:
    text = read(ROOT / "crates/ielts-domain/src/learner.rs")
    match = re.search(r"pub enum SkillReviewProbe\s*\{([^}]*)\}", text)
    if not match:
        raise SystemExit("could not parse SkillReviewProbe from learner.rs")
    variants = re.findall(r"\b([A-Z][A-Za-z]+)\b", match.group(1))
    return {re.sub(r"(?<!^)([A-Z])", r"_\1", name).lower() for name in variants}


def priority_bands() -> set[str]:
    text = read(ROOT / "crates/ielts-domain/src/learner.rs")
    match = re.search(r"pub fn priority_band\(.*?\n\}", text, re.S)
    if not match:
        raise SystemExit("could not parse priority_band from learner.rs")
    return set(re.findall(r'"([a-z]+)"\.into\(\)', match.group(0)))


def rust_literals() -> set[str]:
    literals: set[str] = set()
    for directory in RUST_DIRS:
        for path in directory.rglob("*.rs"):
            literals.update(re.findall(r'"([a-z][a-z0-9_]*)"', read(path)))
    for path in MIGRATIONS.glob("*.sql"):
        literals.update(re.findall(r"'([a-z][a-z0-9_]*)'", read(path)))
    return literals


def scanned_files() -> list[Path]:
    return sorted(
        path for directory in SCAN_DIRS for path in directory.rglob("*")
        if path.suffix in SCAN_SUFFIXES and "__pycache__" not in path.parts
        and path.name != Path(__file__).name
    )


def line_of(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


def check_file(path: Path, ctx: dict, failures: list[str]) -> None:
    text = read(path)
    where = rel(path)

    def fail(index: int, message: str) -> None:
        failures.append(f"{where}:{line_of(text, index)}: {message}")

    for pattern in COMMAND_PATTERNS:
        for match in pattern.finditer(text):
            if match.group(1) not in ctx["commands"]:
                fail(match.start(), f"mocked command '{match.group(1)}' is not registered in src-tauri lib.rs")

    for match in SKILL_KEY.finditer(text):
        key = match.group(1)
        if key in ctx["skills"] or key.split(".", 1)[1] in ctx["criteria"] and key.startswith("writing."):
            continue
        if (path.name, key) in SKILL_KEY_ALLOWLIST:
            continue
        fail(match.start(), f"skill key '{key}' is not in skill_catalog or the writing.<criterion> set")

    for match in PROBE_KIND.finditer(text):
        if match.group(1) not in ctx["probes"]:
            fail(match.start(), f"probeKind '{match.group(1)}' is not a SkillReviewProbe variant")

    for match in PRIORITY_BAND.finditer(text):
        if match.group(1) not in ctx["bands"]:
            fail(match.start(), f"priority band '{match.group(1)}' is not emitted by priority_band()")

    for match in REASON_LIST.finditer(text):
        for code in STRING_LITERAL.findall(match.group(1)):
            if code not in ctx["literals"]:
                fail(match.start(), f"reason code '{code}' never appears in backend source")

    for match in READING_CATEGORY_LOWER.finditer(text):
        fail(match.start(), f"reading category '{match.group(1)}' must be uppercase P1/P2/P3 (stored raw)")

    if path.suffix == ".py" and "e2e" in path.parts:
        for match in FORBIDDEN_WIRE_KEYS.finditer(text):
            fail(match.start(), f"snake_case wire key '{match.group(1)}' in a mock; the backend emits camelCase")


def main() -> int:
    ctx = {
        "commands": registered_commands(),
        "skills": skill_catalog(),
        "criteria": writing_criteria(),
        "probes": probe_kinds(),
        "bands": priority_bands(),
        "literals": rust_literals(),
    }
    failures: list[str] = []
    files = scanned_files()
    for path in files:
        check_file(path, ctx, failures)
    if failures:
        print(f"Mock contract check failed ({len(failures)} finding(s)):")
        print("\n".join(f"  {line}" for line in failures))
        return 1
    print(
        f"Mock contract check passed: {len(files)} files, "
        f"{len(ctx['commands'])} commands, {len(ctx['skills'])} catalog skills, "
        f"probes={sorted(ctx['probes'])}, bands={sorted(ctx['bands'])}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
