#!/usr/bin/env python3
"""Check current ADR/gate/index references against the shipping tree.

The v1.3 task book is intentionally excluded: it is a frozen historical
contract and its stale references are evidence, not a current build failure.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
DOC_ROOT = ROOT / "developer/docs"
MIGRATION_RE = re.compile(r"(?<!\d)(\d{4}_[a-z0-9_]+\.sql)(?![a-z0-9_])")
LOCAL_LINK_RE = re.compile(r"\]\((?!https?://|#)([^)#]+\.md)(?:#[^)]+)?\)")
CODE_TOKEN_RE = re.compile(r"`([a-z][a-z0-9_]{2,})`")
COMMAND_CONTEXT_RE = re.compile(
    r"tauri\s+commands?|reverse-rpc|invoke_handler|command\s+registry|command\s+surface",
    re.IGNORECASE,
)
COMMAND_PREFIXES = (
    "agent_",
    "ai_",
    "annotation_",
    "backup_",
    "coach_",
    "consolidation_",
    "context_",
    "corpus_",
    "dictionary_",
    "dream_",
    "endless_",
    "eval_",
    "history_",
    "journal_",
    "learner_",
    "learning_",
    "memory_",
    "prompt_",
    "reading_",
    "skill_",
    "study_plan_",
    "suite_",
    "teaching_strategy_",
    "vocab_",
    "writing_",
)


def current_documents() -> list[Path]:
    paths = set(DOC_ROOT.glob("ADR-*.md"))
    paths.update(DOC_ROOT.glob("*_STAGE_GATE_REPORT.md"))
    index = DOC_ROOT / "INDEX.md"
    if index.is_file():
        paths.add(index)
    return sorted(paths)


def registered_commands() -> set[str]:
    source = (ROOT / "src-tauri/src/lib.rs").read_text(encoding="utf-8")
    handler_start = source.find("tauri::generate_handler![")
    handler = source[handler_start:] if handler_start >= 0 else ""
    return set(re.findall(r"commands::(?:[A-Za-z0-9_]+::)*([a-z][A-Za-z0-9_]*)", handler))


def main() -> int:
    failures: list[str] = []
    documents = current_documents()
    commands = registered_commands()

    for path in documents:
        relative = path.relative_to(ROOT).as_posix()
        try:
            text = path.read_text(encoding="utf-8")
        except OSError as exc:
            failures.append(f"{relative}: cannot read: {exc}")
            continue

        for migration in sorted(set(MIGRATION_RE.findall(text))):
            if not (ROOT / "crates/ielts-db/migrations" / migration).is_file():
                failures.append(f"{relative}: missing migration reference {migration}")

        for link in LOCAL_LINK_RE.findall(text):
            if not (path.parent / link).resolve().is_file():
                failures.append(f"{relative}: missing local document link {link}")

        for line in text.splitlines():
            if not COMMAND_CONTEXT_RE.search(line):
                continue
            for token in CODE_TOKEN_RE.findall(line):
                if token.startswith(COMMAND_PREFIXES) and token not in commands:
                    failures.append(f"{relative}: unregistered Tauri command {token}")

    if failures:
        print("Document drift check failed:", file=sys.stderr)
        print("\n".join(f"- {failure}" for failure in failures), file=sys.stderr)
        return 1

    print(f"Document drift check passed ({len(documents)} current documents checked)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
