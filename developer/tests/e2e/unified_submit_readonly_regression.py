#!/usr/bin/env python3
"""Unified reading submit/readOnly/highlight regression (file:// compatible)."""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict

REPO_ROOT = Path(__file__).resolve().parents[3]
UNIFIED_HTML = REPO_ROOT / "assets" / "generated" / "reading-exams" / "reading-practice-unified.html"
TARGET_EXAM = "p1-low-67"

try:
    from playwright.async_api import async_playwright  # type: ignore[import-untyped]
except ModuleNotFoundError:
    venv_dir = (REPO_ROOT / ".venv").resolve()
    venv_python = REPO_ROOT / ".venv" / "bin" / "python"
    current_prefix = Path(sys.prefix).resolve()
    if venv_python.exists() and current_prefix != venv_dir:
        completed = subprocess.run([str(venv_python), str(Path(__file__).resolve())], cwd=str(REPO_ROOT))
        raise SystemExit(completed.returncode)
    raise SystemExit(json.dumps({"status": "fail", "detail": "playwright_python_missing"}, ensure_ascii=False))


async def run() -> Dict[str, Any]:
    url = f"{UNIFIED_HTML.as_uri()}?examId={TARGET_EXAM}&dataKey={TARGET_EXAM}&test_env=1"
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True, args=["--allow-file-access-from-files"])
        context = await browser.new_context()
        page = await context.new_page()
        await page.goto(url, wait_until="load")
        await page.wait_for_selector("#left", timeout=30000)
        await page.wait_for_selector("#question-groups .unified-group", timeout=30000)
        await page.wait_for_selector("#submit-btn", timeout=30000)
        await page.wait_for_timeout(600)

        await page.evaluate(
            """() => {
                const input = document.querySelector('input[type="text"], textarea');
                if (input) {
                    input.value = 'readonly_probe';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }"""
        )

        before = await page.evaluate(
            """() => {
                const left = document.getElementById('left');
                if (!left) return { count: 0, texts: [] };
                const collectTextNodes = (minLen) => {
                    const walker = document.createTreeWalker(left, NodeFilter.SHOW_TEXT);
                    const nodes = [];
                    let n = null;
                    while ((n = walker.nextNode())) {
                        const t = String(n.textContent || '').replace(/\\s+/g, ' ').trim();
                        if (t.length >= minLen) nodes.push(n);
                    }
                    return nodes;
                };
                const nodes = collectTextNodes(16);
                const wrap = (node, start, end) => {
                    if (!node) return false;
                    const raw = String(node.textContent || '');
                    if (raw.length <= end) return false;
                    const range = document.createRange();
                    range.setStart(node, start);
                    range.setEnd(node, end);
                    const span = document.createElement('span');
                    span.className = 'hl';
                    try {
                        range.surroundContents(span);
                        return true;
                    } catch (_) {
                        return false;
                    }
                };
                let seeded = 0;
                for (const node of nodes) {
                    if (seeded >= 2) break;
                    const raw = String(node.textContent || '');
                    const first = Math.max(1, raw.search(/\\S/));
                    const second = Math.min(raw.length - 1, first + 6);
                    if (wrap(node, first, second)) {
                        seeded += 1;
                    }
                }
                const items = Array.from(document.querySelectorAll('#left .hl'));
                return {
                    count: items.length,
                    texts: items.map((n) => String(n.textContent || '').trim()).filter(Boolean)
                };
            }"""
        )
        if int(before.get("count") or 0) < 2:
            raise RuntimeError(f"highlight_seed_failed:{before}")

        await page.click("#submit-btn")
        await page.wait_for_function(
            "() => !!(document.getElementById('results') && document.getElementById('results').style.display !== 'none')",
            timeout=30000,
        )

        after = await page.evaluate(
            """() => {
                const leftItems = Array.from(document.querySelectorAll('#left .hl'));
                const leftTexts = leftItems.map((n) => String(n.textContent || '').trim()).filter(Boolean);
                const input = document.querySelector('input[type="text"], textarea, input[type="radio"], input[type="checkbox"], select');
                const submit = document.getElementById('submit-btn');
                const reset = document.getElementById('reset-btn');
                const exit = document.getElementById('exit-btn');
                return {
                    leftCount: leftItems.length,
                    leftTexts,
                    readOnlyClass: document.body.classList.contains('review-readonly-mode'),
                    inputDisabled: !input || input.disabled === true,
                    submitDisabled: !!(submit && submit.disabled),
                    resetDisabled: !!(reset && reset.disabled),
                    exitVisible: !!(exit && getComputedStyle(exit).display !== 'none')
                };
            }"""
        )

        await browser.close()
        return {
            "status": "pass",
            "detail": "unified submit readonly regression passed",
            "data": {
                "before": before,
                "after": after
            }
        }


async def main() -> int:
    try:
        payload = await run()
    except Exception as error:
        print(json.dumps({
            "status": "fail",
            "detail": "unified submit readonly regression failed",
            "error": str(error)
        }, ensure_ascii=False))
        return 1

    before = payload.get("data", {}).get("before", {})
    after = payload.get("data", {}).get("after", {})
    before_count = int(before.get("count") or 0)
    before_texts = [str(v) for v in (before.get("texts") or []) if str(v).strip()]
    after_count = int(after.get("leftCount") or 0)
    after_texts = [str(v) for v in (after.get("leftTexts") or []) if str(v).strip()]

    checks = [
        (after_count >= before_count, "highlight_count_decreased"),
        (all(text in after_texts for text in before_texts), "highlight_text_not_preserved"),
        (bool(after.get("readOnlyClass")), "readonly_class_missing"),
        (bool(after.get("inputDisabled")), "input_not_disabled"),
        (bool(after.get("submitDisabled")), "submit_not_disabled"),
        (bool(after.get("resetDisabled")), "reset_not_disabled"),
        (bool(after.get("exitVisible")), "exit_not_visible"),
    ]
    failed = [name for ok, name in checks if not ok]
    if failed:
        print(json.dumps({
            "status": "fail",
            "detail": "unified submit readonly regression assertions failed",
            "failed": failed,
            "data": payload.get("data", {})
        }, ensure_ascii=False))
        return 1

    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
