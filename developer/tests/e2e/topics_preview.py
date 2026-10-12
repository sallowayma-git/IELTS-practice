#!/usr/bin/env python3
"""Screenshot the Topics page (route /topics) from the dev build, plus layout metrics.

    python developer/tests/e2e/topics_preview.py

Starts the Vite dev server on port 4181, mocks the writing-topic Tauri commands
with an init script (DEV only, test side, never shipped), and captures:

    reports/topics-dev.png          list view, 1440x900
    reports/topics-dev-1024.png     list view, 1024x768
    reports/topics-dialog-dev.png   editor dialog open, 1440x900

It also checks, and prints as JSON:
  - every button in one topic row shares a height, and all rows match;
  - the list region scrolls while the toolbar stays put;
  - the page itself does not scroll and has no horizontal overflow.
"""
from __future__ import annotations

import json
import sys

from playwright.sync_api import sync_playwright

from design_system_preview import REPORTS, start_dev_server, stop_process, wait_for_server
from reading_suite_selector_visual_check import install_tauri_mock

PORT = 4181
BASE_URL = f"http://127.0.0.1:{PORT}"
ROUTE = "/#/topics"

CATEGORIES = {
    "task1": ["bar_chart", "pie_chart", "line_chart", "flow_chart", "map", "table", "process", "mixed"],
    "task2": ["education", "technology", "society", "environment", "health", "culture", "government", "economy"],
}

PROMPTS = [
    "Some people believe that university students should be required to study a broad range of subjects. Others think they should specialise early. Discuss both views and give your own opinion.",
    "Many cities are struggling with traffic congestion. What are the causes of this problem, and what measures could governments take to solve it?",
    "Some argue that technology has made people more isolated, while others say it brings people closer together. Discuss both views.",
    "The chart shows the percentage of households with internet access in four countries between 2005 and 2020. Summarise the information by selecting and reporting the main features.",
    "The pie charts compare how energy was produced in two countries in 1990 and 2015. Summarise the information and make comparisons where relevant.",
    "The table gives data on tourist arrivals and average spending in five European cities. Summarise the key features and report the main trends.",
    "Governments should invest more money in public health than in new roads. To what extent do you agree or disagree?",
    "The diagram illustrates the process of recycling plastic bottles, from collection to the production of new packaging. Describe the stages.",
    "Some people think that the best way to reduce pollution is to tax companies. Others believe individuals should change their habits. Discuss both views.",
    "The map shows the changes to a town centre between 2000 and 2020. Describe the main changes that took place.",
]


def make_topics() -> list[dict]:
    topics = []
    for index in range(30):
        task = "task1" if index % 3 == 0 else "task2"
        options = CATEGORIES[task]
        prompt = PROMPTS[index % len(PROMPTS)]
        title_json = json.dumps(
            {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": prompt}]}]},
            ensure_ascii=False,
        )
        topics.append({
            "id": f"topic-{index + 1:03d}",
            "taskType": task,
            "category": options[index % len(options)],
            "difficulty": (index % 5) + 1,
            "titleJson": title_json,
            "imagePath": None,
            "isOfficial": index in (0, 7),
            "usageCount": (index * 3) % 11,
            "createdAt": "2026-09-01T00:00:00Z",
            "updatedAt": "2026-10-01T00:00:00Z",
        })
    return topics


TOPICS = make_topics()

# Wraps the base mock: answers the topic commands, delegates everything else.
TOPIC_MOCK = """
(() => {
  const topics = __TOPICS__;
  const base = window.__TAURI__.core.invoke;
  window.__TAURI__.core.invoke = async (command, args = {}) => {
    if (command === 'writing_topic_list') {
      const q = args.query || {};
      let rows = topics.filter((t) => (!q.taskType || t.taskType === q.taskType)
        && (!q.category || t.category === q.category)
        && (!q.difficulty || t.difficulty === q.difficulty)
        && (!q.search || t.titleJson.toLowerCase().includes(String(q.search).toLowerCase())));
      const offset = Number(q.offset || 0);
      const limit = Number(q.limit || 12);
      return { ok: true, data: { items: rows.slice(offset, offset + limit), total: rows.length, limit, offset } };
    }
    if (command === 'writing_topic_statistics') {
      return { ok: true, data: { total: topics.length, byTaskType: [] } };
    }
    return base(command, args);
  };
})();
""".replace("__TOPICS__", json.dumps(TOPICS, ensure_ascii=False))

ROW_METRICS = """
() => {
  const rows = [...document.querySelectorAll('.topic-manage-page .topic-card')];
  return rows.map((row) => [...row.querySelectorAll('button')]
    .map((b) => Math.round(b.getBoundingClientRect().height)));
}
"""

LAYOUT = """
() => {
  const rect = (sel) => { const n = document.querySelector(sel); return n ? n.getBoundingClientRect() : null; };
  const region = document.querySelector('.topic-manage-page .scroll-region');
  const toolbar = rect('.topic-manage-page .toolbar');
  const rail = rect('.topic-manage-page .topic-rail');
  const scroller = document.scrollingElement;
  return {
    viewport: [innerWidth, innerHeight],
    docScrollHeight: scroller.scrollHeight,
    docScrollWidth: scroller.scrollWidth,
    regionClientHeight: region ? region.clientHeight : null,
    regionScrollHeight: region ? region.scrollHeight : null,
    toolbarTop: toolbar ? Math.round(toolbar.top) : null,
    railTop: rail ? Math.round(rail.top) : null,
    railWidth: rail ? Math.round(rail.width) : null,
    cards: document.querySelectorAll('.topic-manage-page .topic-card').length,
  };
}
"""


def wait_ready(page) -> None:
    page.goto(f"{BASE_URL}{ROUTE}", wait_until="networkidle", timeout=60_000)
    page.wait_for_selector(".topic-manage-page .topic-card", timeout=30_000)
    page.evaluate("document.fonts.ready.then(() => true)")
    page.wait_for_timeout(300)


def new_page(browser, width: int, height: int, errors: list[str]):
    page = browser.new_page(viewport={"width": width, "height": height}, reduced_motion="reduce")
    page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
    install_tauri_mock(page, [])
    page.add_init_script(TOPIC_MOCK)
    return page


def capture(base_url: str) -> tuple[list[str], dict]:
    errors: list[str] = []
    metrics: dict = {}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            page = new_page(browser, 1440, 900, errors)
            wait_ready(page)
            metrics["1440x900"] = {"layout": page.evaluate(LAYOUT), "rowButtonHeights": page.evaluate(ROW_METRICS)}
            # Scrolling the list must not move the toolbar or the rail.
            before = page.evaluate(LAYOUT)
            page.evaluate("document.querySelector('.topic-manage-page .scroll-region').scrollTop = 400")
            page.wait_for_timeout(100)
            after = page.evaluate(LAYOUT)
            metrics["scrollCheck"] = {
                "scrollTopAfter": page.evaluate("document.querySelector('.topic-manage-page .scroll-region').scrollTop"),
                "toolbarTopBefore": before["toolbarTop"],
                "toolbarTopAfter": after["toolbarTop"],
                "railTopBefore": before["railTop"],
                "railTopAfter": after["railTop"],
            }
            page.evaluate("document.querySelector('.topic-manage-page .scroll-region').scrollTop = 0")
            page.wait_for_timeout(100)
            page.screenshot(path=str(REPORTS / "topics-dev.png"), full_page=True)

            page.locator(".header-actions .btn-brand").first.click()
            page.wait_for_selector(".dialog-overlay > .editor-dialog")
            page.wait_for_timeout(200)
            page.screenshot(path=str(REPORTS / "topics-dialog-dev.png"))
            page.close()

            page = new_page(browser, 1024, 768, errors)
            wait_ready(page)
            metrics["1024x768"] = {"layout": page.evaluate(LAYOUT), "rowButtonHeights": page.evaluate(ROW_METRICS)}
            page.screenshot(path=str(REPORTS / "topics-dev-1024.png"), full_page=True)
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
        print(f"topics preview failed: {error}", file=sys.stderr)
        return 1
    finally:
        stop_process(process)
    print(json.dumps(metrics, ensure_ascii=False, indent=1))
    for line in errors:
        print(line, file=sys.stderr)
    for filename in ("topics-dev.png", "topics-dev-1024.png", "topics-dialog-dev.png"):
        print(f"wrote {REPORTS / filename}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
