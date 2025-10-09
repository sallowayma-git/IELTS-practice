#!/usr/bin/env python3
"""Static test aggregation for the IELTS practice app.

This module verifies the presence and basic structure of the
static end-to-end harness and HTML regression tests.  It is designed to be
invoked locally or inside CI before changes are merged.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import List, Tuple

REPO_ROOT = Path(__file__).resolve().parents[3]


class _HTMLDoctypeParser(HTMLParser):
    """Detects a <!DOCTYPE html> declaration in a HTML document."""

    def __init__(self) -> None:
        super().__init__()
        self.has_doctype = False

    def handle_decl(self, decl: str) -> None:  # pragma: no cover - html.parser API
        if decl.lower().strip() == "doctype html":
            self.has_doctype = True


def _check_html_doctype(path: Path) -> Tuple[bool, str]:
    try:
        parser = _HTMLDoctypeParser()
        parser.feed(path.read_text(encoding="utf-8"))
        parser.close()
    except Exception as exc:  # pragma: no cover - defensive guard
        return False, f"无法解析 HTML：{exc}"
    return parser.has_doctype, "检测到 <!DOCTYPE html>" if parser.has_doctype else "缺少 <!DOCTYPE html>"


def _check_contains(path: Path, snippet: str) -> Tuple[bool, str]:
    try:
        text = path.read_text(encoding="utf-8")
    except Exception as exc:  # pragma: no cover - defensive guard
        return False, f"读取失败：{exc}"
    present = snippet in text
    return present, ("已包含片段" if present else f"缺少片段：{snippet}")


def _format_result(name: str, passed: bool, detail: str) -> dict:
    return {
        "name": name,
        "status": "pass" if passed else "fail",
        "detail": detail,
    }


def _ensure_exists(path: Path) -> Tuple[bool, str]:
    exists = path.exists()
    return exists, ("已找到" if exists else "文件缺失")


def run_checks() -> Tuple[List[dict], bool]:
    results: List[dict] = []
    all_passed = True

    # Core entry point presence
    index_file = REPO_ROOT / "index.html"
    passed, detail = _ensure_exists(index_file)
    results.append(_format_result("index.html 存在性", passed, detail))
    all_passed &= passed

    # Static regression harnesses should start with a doctype for consistent rendering
    static_html_files = sorted((REPO_ROOT / "developer" / "tests").glob("*.html"))
    for html_path in static_html_files:
        passed, detail = _check_html_doctype(html_path)
        results.append(_format_result(f"{html_path.name} Doctype", passed, detail))
        all_passed &= passed

    # End-to-end runner integrity checks
    e2e_runner = REPO_ROOT / "developer" / "tests" / "e2e" / "app-e2e-runner.html"
    passed, detail = _ensure_exists(e2e_runner)
    results.append(_format_result("E2E runner 文件存在性", passed, detail))
    all_passed &= passed

    if passed:
        runner_checks = {
            "包含 app-frame iframe": 'id="app-frame"',
            "声明 sandbox 权限": 'sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups"',
        }
        for label, snippet in runner_checks.items():
            check_passed, check_detail = _check_contains(e2e_runner, snippet)
            results.append(_format_result(f"E2E runner: {label}", check_passed, check_detail))
            all_passed &= check_passed

        required_scripts = [
            REPO_ROOT / "developer" / "tests" / "js" / "e2e" / name
            for name in ("indexSnapshot.js", "bootstrapAppFrame.js", "appE2ETest.js")
        ]
        for script_path in required_scripts:
            script_passed, script_detail = _ensure_exists(script_path)
            results.append(_format_result(f"E2E 依赖 {script_path.name}", script_passed, script_detail))
            all_passed &= script_passed

    return results, all_passed


def main() -> int:
    results, all_passed = run_checks()

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "status": "pass" if all_passed else "fail",
        "results": results,
    }

    report_dir = REPO_ROOT / "developer" / "tests" / "e2e" / "reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / "static-ci-report.json"
    report_text = json.dumps(report, ensure_ascii=False, indent=2)
    report_path.write_text(report_text + "\n", encoding="utf-8")

    print(report_text)
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
