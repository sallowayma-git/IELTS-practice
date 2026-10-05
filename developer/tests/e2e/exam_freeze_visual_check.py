#!/usr/bin/env python3
"""Exam-route visual freeze: the CD-IELTS simulation must not drift.

The reading exam routes (practice, suite, review) are a deliberately frozen
second theme. Shell/skin redesigns must leave them pixel-identical.

    python developer/tests/e2e/exam_freeze_visual_check.py --baseline
        capture reports/exam-freeze/baseline/*.png from the current dist
    python developer/tests/e2e/exam_freeze_visual_check.py
        capture reports/exam-freeze/current/*.png and compare to baseline

Each exam route is captured twice: as a cold load, and after the Library
route has been visited first (its unscoped stylesheet stays in the document),
so leaks from shell styles into the exam are caught as well.
"""
from __future__ import annotations

import json
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
DIST = ROOT / "dist/writing"
OUT = Path(__file__).parent / "reports" / "exam-freeze"
EXAM = ROOT / "assets/generated/reading-exams/p1-high-01.js"
ASSET_ID = "p1-high-01"
SUITE_ID = "suite-freeze-1"
REVIEW_ID = "attempt-freeze-1"
VIEWPORTS = (("desktop", 1440, 900), ("tablet", 1024, 768), ("mobile", 390, 844))
ROUTES = (
    ("practice", f"/reading/{ASSET_ID}", "[data-practice-reading-page]"),
    ("review", f"/reading/{ASSET_ID}/review/{REVIEW_ID}", "[data-practice-reading-page]"),
    ("suite", f"/reading-suite/{SUITE_ID}", "[data-reading-suite-summary]"),
)

MOCK = r"""
(() => {
  const examSource = __EXAM__;
  window.__READING_EXAM_DATA__ = { register(id, data) { window.__examPayload = data; } };
  (0, eval)(examSource);
  const payload = window.__examPayload;
  const asset = {
    schemaVersion: 2, id: '__ASSET__', activity: 'reading', sourceKind: 'generated',
    title: payload.meta.title, category: payload.meta.category, frequency: 'high',
    fingerprint: 'fp-freeze', pdfOnly: false
  };
  const answers = payload.questionOrder.map((questionId, index) => ({
    questionId, answer: index % 3 === 0 ? 'x' : payload.answerKey[questionId],
    correctAnswer: payload.answerKey[questionId], isCorrect: index % 3 !== 0,
    weight: 1, marked: index === 4
  }));
  const detail = {
    summary: { id: '__REVIEW__', activity: 'reading', assetId: '__ASSET__', title: asset.title, status: 'completed' },
    attempt: {
      id: '__REVIEW__', activity: 'reading', assetId: '__ASSET__', status: 'completed',
      answers, scoreValue: 0.69, correctCount: 9, questionCount: 13, durationMs: 1112000,
      submittedAt: '2026-09-30T09:00:00Z', titleSnapshot: asset.title, annotations: []
    }
  };
  const suite = {
    sessionId: '__SUITE__', status: 'active', currentIndex: 0, flowMode: 'simulation', frequencyScope: 'all',
    aggregate: { submittedPassages: 1, totalPassages: 3, percentage: 72, correct: 18, totalQuestions: 25 },
    sequence: [
      { assetId: '__ASSET__', index: 0, category: 'P1', title: asset.title, status: 'active', sessionId: null, scoreInfo: null },
      { assetId: 'p2-x', index: 1, category: 'P2', title: 'How coastal wetlands protect cities', status: 'submitted',
        sessionId: 'attempt-x', scoreInfo: { correct: 18, totalQuestions: 25, percentage: 72 } },
      { assetId: 'p3-x', index: 2, category: 'P3', title: 'The science of long-distance memory', status: 'pending', sessionId: null, scoreInfo: null }
    ]
  };
  const data = {
    reading_list_assets: [asset],
    reading_get_asset_payload: { asset, payload },
    get_history_detail: detail,
    suite_get: suite,
    list_history: { items: [], total: 0, limit: 20, offset: 0, nextCursor: null }
  };
  window.__TAURI__ = window.__TAURI__ || {};
  window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
  window.__TAURI__.core = {
    invoke: async (command) => ({ ok: true, data: command in data ? data[command] : null })
  };
})();
"""


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def serve() -> tuple[subprocess.Popen, str]:
    port = free_port()
    process = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1", "--directory", str(DIST)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    base = f"http://127.0.0.1:{port}"
    for _ in range(80):
        try:
            urllib.request.urlopen(base, timeout=1)
            return process, base
        except OSError:
            time.sleep(0.25)
    process.kill()
    raise RuntimeError("static server did not start")


def settle(page, selector):
    page.wait_for_selector(selector)
    page.evaluate(
        """async () => {
          await document.fonts.ready;
          const finite = document.getAnimations().filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime));
          await Promise.all(finite.map(a => a.finished.catch(() => {})));
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        }"""
    )
    page.wait_for_timeout(300)


STYLE_PROPS = (
    "display", "position", "color", "background-color", "background-image", "border-top-width",
    "border-top-style", "border-top-color", "border-bottom-width", "border-bottom-color",
    "border-left-width", "border-left-color", "border-right-width", "border-top-left-radius",
    "border-bottom-right-radius", "box-shadow", "font-family", "font-size", "font-weight",
    "line-height", "letter-spacing", "text-transform", "padding-top", "padding-left",
    "margin-top", "margin-left", "outline-style", "opacity", "gap", "text-decoration-line",
)
STYLE_SNAPSHOT = r"""props => [...document.querySelectorAll('#app *')].map((node, index) => {
  const style = getComputedStyle(node);
  const rect = node.getBoundingClientRect();
  const id = node.id ? '#' + node.id : '';
  const cls = typeof node.className === 'string' ? node.className.trim().split(/[ \t\n]+/).slice(0, 2).join('.') : '';
  return {
    key: index + ':' + node.tagName.toLowerCase() + id + (cls ? '.' + cls : ''),
    rect: [rect.x, rect.y, rect.width, rect.height].map(value => Math.round(value * 2) / 2),
    style: Object.fromEntries(props.map(prop => [prop, style.getPropertyValue(prop)]))
  };
})"""


def capture(base: str, target: Path) -> list[str]:
    target.mkdir(parents=True, exist_ok=True)
    mock = (MOCK.replace("__EXAM__", json.dumps(EXAM.read_text(encoding="utf-8")))
            .replace("__ASSET__", ASSET_ID).replace("__SUITE__", SUITE_ID).replace("__REVIEW__", REVIEW_ID))
    names = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for size, width, height in VIEWPORTS:
                for route_name, route, selector in ROUTES:
                    for entry in ("cold", "via-library"):
                        context = browser.new_context(viewport={"width": width, "height": height}, reduced_motion="reduce")
                        page = context.new_page()
                        page.clock.set_fixed_time("2026-10-01T09:00:00")
                        page.add_init_script(mock)
                        if entry == "via-library":
                            page.goto(f"{base}/#/", wait_until="networkidle")
                            settle(page, "[data-practice-reading-home]")
                            page.evaluate("route => { location.hash = route }", route)
                        else:
                            page.goto(f"{base}/#{route}", wait_until="networkidle")
                        settle(page, selector)
                        name = f"{route_name}-{size}-{entry}"
                        styles = page.evaluate(STYLE_SNAPSHOT, list(STYLE_PROPS))
                        (target / f"{name}.json").write_text(json.dumps(styles), encoding="utf-8")
                        page.screenshot(path=str(target / f"{name}.png"), full_page=False, animations="disabled",
                                        caret="hide", mask=[page.locator(".reading-timer")])
                        names.append(name)
                        context.close()
        finally:
            browser.close()
    return names


def style_drift(name: str) -> list[dict]:
    before = json.loads((OUT / "baseline" / f"{name}.json").read_text(encoding="utf-8"))
    after = json.loads((OUT / "current" / f"{name}.json").read_text(encoding="utf-8"))
    if len(before) != len(after):
        return [{"element": "*", "detail": f"element count {len(before)} -> {len(after)}"}]
    drift = []
    for left, right in zip(before, after):
        changes = {prop: [value, right["style"][prop]] for prop, value in left["style"].items()
                   if right["style"].get(prop) != value}
        if left["rect"] != right["rect"]:
            changes["rect"] = [left["rect"], right["rect"]]
        if changes or left["key"] != right["key"]:
            drift.append({"element": left["key"], "now": right["key"], "changes": changes})
    return drift


def compare(names: list[str]) -> list[dict]:
    from PIL import Image, ImageChops

    results = []
    for name in names:
        before = OUT / "baseline" / f"{name}.png"
        if not before.is_file():
            results.append({"name": name, "status": "missing-baseline"})
            continue
        left = Image.open(before).convert("RGB")
        right = Image.open(OUT / "current" / f"{name}.png").convert("RGB")
        box = ImageChops.difference(left, right).getbbox() if left.size == right.size else (0, 0, *right.size)
        drift = style_drift(name)
        if box:
            ImageChops.difference(left, right).point(lambda v: 255 if v else 0).save(OUT / "current" / f"diff-{name}.png")
        results.append({"name": name, "status": "changed" if drift else "identical",
                        "styleDrift": drift[:12], "styleDriftCount": len(drift), "pixelDiffBox": box})
    return results


def main() -> int:
    if not (DIST / "index.html").is_file():
        raise SystemExit("dist/writing is missing; run the Vue production build first")
    baseline = "--baseline" in sys.argv
    process, base = serve()
    try:
        names = capture(base, OUT / ("baseline" if baseline else "current"))
    finally:
        process.kill()
    if baseline:
        print(json.dumps({"baseline": names}, indent=2))
        return 0
    results = compare(names)
    report = {"status": "passed" if all(r["status"] == "identical" for r in results) else "failed",
              "results": results}
    (OUT / "exam-freeze-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
