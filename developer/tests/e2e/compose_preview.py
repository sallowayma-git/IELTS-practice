#!/usr/bin/env python3
"""Screenshot the writing Compose page (/writing) and the Evaluating wait page.

    python developer/tests/e2e/compose_preview.py

Starts the Vite dev server on port 4183 (same helpers as design_system_preview.py),
mocks the writing Tauri commands in the page with an init script (DEV only, test
side, never shipped), and captures into reports/:

    compose-dev.png            empty compose, 1440x900
    compose-typed-dev.png      compose with a ~280 word essay, 1440x900
    compose-dev-1024.png       compose with the essay, 1024x768
    evaluating-dev.png         evaluating wait page, 1440x900
    evaluating-dev-t0/t1/t2.png  three frames 700ms apart, normal motion, so the
                               typewriter and cursor animation can be seen running

Evaluating runs with normal motion on purpose: prefers-reduced-motion would
skip the typewriter. The printed JSON reports the typed essay length and the
number of visible characters per frame, so a frozen animation shows up as a
number that does not change.
"""
from __future__ import annotations

import json
import sys

from playwright.sync_api import sync_playwright

from design_system_preview import REPORTS, start_dev_server, stop_process, wait_for_server

PORT = 4183
BASE_URL = f"http://127.0.0.1:{PORT}"

ESSAY_SENTENCES = [
    "Some people believe that the best way to reduce traffic congestion in large cities is to build more roads, while others argue that public transport deserves most of the investment.",
    "In my view, expanding road capacity offers only a temporary remedy, because new lanes quickly attract additional drivers and the original congestion returns within a few years.",
    "The first reason is that a reliable metro network allows commuters to travel quickly regardless of the weather or the time of day.",
    "Furthermore, buses and trams can carry far more passengers per hour than private cars, so they use limited urban space far more efficiently.",
    "Cities that have invested heavily in rail systems, such as Tokyo and Singapore, show that residents will readily leave their cars at home when alternatives are fast and affordable.",
    "Critics often point out that such projects are expensive and take many years to complete, which is a fair concern for governments with limited budgets.",
    "However, the long-term economic benefits, including shorter journey times, lower pollution and higher property values near stations, usually outweigh the initial cost.",
    "Road building also tends to encourage urban sprawl, pushing homes and workplaces further apart and making every trip longer for everyone.",
    "A balanced strategy would therefore prioritise public transport while managing private vehicle use through congestion charges and dedicated bus lanes.",
    "Such measures would give people genuine choice, and over time they would reshape travel habits in ways that road expansion alone never could.",
    "In conclusion, although new roads may bring short-term relief, sustained investment in public transport is the more effective answer to urban congestion.",
    "For these reasons, I believe public transport should receive the greater share of funding.",
]
TOPIC_TEXT = (
    "Some people think that the best way to solve traffic congestion in big cities is to build more roads. "
    "Others believe that public transport should be the main priority. Discuss both views and give your opinion."
)
ESSAY = " ".join(ESSAY_SENTENCES)
EVAL_DRAFT = {
    "taskType": "task2",
    "mode": "freeform",
    "assetId": None,
    "promptSnapshot": TOPIC_TEXT,
    "contentText": ESSAY,
    "wordCount": len(ESSAY.split()),
}
EVAL_EVENTS = [
    {"sequence": 1, "eventType": "stage", "payload": {"stage": "preparing", "message": "正在准备评测..."}},
    {"sequence": 2, "eventType": "log", "payload": {"message": "已读取作文草稿，共 %d 词" % len(ESSAY.split())}},
    {"sequence": 3, "eventType": "stage", "payload": {"stage": "scoring", "message": "正在按 IELTS 标准逐项评分"}},
    {"sequence": 4, "eventType": "log", "payload": {"message": "任务回应与连贯性分析中"}},
]

MOCK_SCRIPT = """
(() => {
  const draft = __DRAFT__;
  const events = __EVENTS__;
  window.__TAURI__ = window.__TAURI__ || {};
  window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
  window.__TAURI__.core = {
    invoke: async (command, args) => {
      if (command === 'writing_get_draft') return { ok: true, data: draft };
      if (command === 'writing_get_evaluation') return { ok: true, data: { id: 'eval-preview-1', status: 'running', taskType: 'task2' } };
      if (command === 'writing_list_evaluation_events') {
        const after = Number(args?.afterSequence || 0);
        return { ok: true, data: events.filter((e) => e.sequence > after) };
      }
      if (command === 'list_settings') return { ok: true, data: [] };
      if (command === 'ai_list_configs') return { ok: true, data: [] };
      if (command === 'get_app_info') return { name: 'ielts-practice', version: '0.1.0', tauriVersion: '2', productName: 'IELTS Practice', host: 'tauri' };
      return { ok: true, data: null };
    }
  };
})();
"""

TYPEWRITER_SAMPLE = """
() => {
  const text = document.querySelector('.typewriter-content');
  const cursor = document.querySelector('.cursor-blink');
  return {
    chars: text ? text.textContent.replace(/\\s+$/, '').length : -1,
    cursorOpacity: cursor ? getComputedStyle(cursor).opacity : null,
    progress: document.querySelector('.progress-figure span')?.textContent || null,
  };
}
"""

COMPOSE_METRICS = """
() => ({
  submitDisabled: document.querySelector('.submit-btn')?.disabled ?? null,
  submitBg: getComputedStyle(document.querySelector('.submit-btn')).backgroundColor,
  submitColor: getComputedStyle(document.querySelector('.submit-btn')).color,
  submitOpacity: getComputedStyle(document.querySelector('.submit-btn')).opacity,
  wordCount: document.querySelector('.word-status strong')?.textContent || null,
  warning: document.querySelector('.word-status strong')?.classList.contains('is-warning') ?? null,
  essayFont: getComputedStyle(document.querySelector('.essay-input')).fontFamily.slice(0, 40),
  essayBox: Math.round(document.querySelector('.essay-input').getBoundingClientRect().height),
  pageScrollWidth: document.documentElement.scrollWidth,
  viewportWidth: window.innerWidth,
})
"""


def open_page(browser, width: int, height: int, route: str):
    page = browser.new_page(viewport={"width": width, "height": height})
    page.add_init_script(MOCK_SCRIPT.replace("__DRAFT__", json.dumps(None))
                         .replace("__EVENTS__", "[]"))
    return page


def open_evaluating_page(browser, route: str):
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.add_init_script(MOCK_SCRIPT.replace("__DRAFT__", json.dumps(EVAL_DRAFT, ensure_ascii=False))
                         .replace("__EVENTS__", json.dumps(EVAL_EVENTS, ensure_ascii=False)))
    return page


def fill_compose(page) -> None:
    page.fill("#custom-topic-text", TOPIC_TEXT)
    page.fill("textarea.essay-input", ESSAY)
    page.wait_for_timeout(300)


def capture(base_url: str) -> tuple[list[str], dict]:
    errors: list[str] = []
    metrics: dict = {}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            # Empty compose, 1440x900.
            page = open_page(browser, 1440, 900, "/writing")
            page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
            page.goto(f"{base_url}/#/writing", wait_until="networkidle", timeout=60_000)
            page.wait_for_selector(".compose-page .essay-input")
            page.evaluate("document.fonts.ready.then(() => true)")
            page.wait_for_timeout(300)
            metrics["compose-empty"] = page.evaluate(COMPOSE_METRICS)
            page.screenshot(path=str(REPORTS / "compose-dev.png"))
            page.close()

            # Typed essay, 1440x900.
            page = open_page(browser, 1440, 900, "/writing")
            page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
            page.goto(f"{base_url}/#/writing", wait_until="networkidle", timeout=60_000)
            page.wait_for_selector(".compose-page .essay-input")
            fill_compose(page)
            metrics["compose-typed-1440"] = page.evaluate(COMPOSE_METRICS)
            page.screenshot(path=str(REPORTS / "compose-typed-dev.png"))
            page.close()

            # Typed essay, 1024x768.
            page = open_page(browser, 1024, 768, "/writing")
            page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
            page.goto(f"{base_url}/#/writing", wait_until="networkidle", timeout=60_000)
            page.wait_for_selector(".compose-page .essay-input")
            fill_compose(page)
            metrics["compose-typed-1024"] = page.evaluate(COMPOSE_METRICS)
            page.screenshot(path=str(REPORTS / "compose-dev-1024.png"), full_page=True)
            page.close()

            # Evaluating wait page: normal motion, typewriter running.
            page = open_evaluating_page(browser, "/evaluating/attempt-preview-1")
            page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
            page.goto(f"{base_url}/#/evaluating/attempt-preview-1", wait_until="networkidle", timeout=60_000)
            page.wait_for_selector(".typewriter-content")
            page.evaluate("document.fonts.ready.then(() => true)")
            frames = []
            for name in ("evaluating-dev-t0.png", "evaluating-dev-t1.png", "evaluating-dev-t2.png"):
                frames.append(page.evaluate(TYPEWRITER_SAMPLE))
                page.screenshot(path=str(REPORTS / name))
                page.wait_for_timeout(700)
            metrics["evaluating-frames"] = frames
            page.screenshot(path=str(REPORTS / "evaluating-dev.png"))
            page.close()
        finally:
            browser.close()
    return errors, metrics


def main() -> int:
    process = None
    try:
        process = start_dev_server(PORT)
        wait_for_server(process, BASE_URL)
        errors, metrics = capture(BASE_URL)
    except (RuntimeError, OSError) as error:
        print(f"compose preview failed: {error}", file=sys.stderr)
        return 1
    finally:
        stop_process(process)
    print(json.dumps(metrics, ensure_ascii=False, indent=1))
    for line in errors:
        print(line, file=sys.stderr)
    for name in ("compose-dev.png", "compose-typed-dev.png", "compose-dev-1024.png",
                 "evaluating-dev.png", "evaluating-dev-t0.png", "evaluating-dev-t1.png", "evaluating-dev-t2.png"):
        print(f"wrote {REPORTS / name}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
