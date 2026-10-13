#!/usr/bin/env python3
"""Retired catalog IDs: records still mark the passage, duplicates are not listed,
and the reading page still opens through a retired ID."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[3]
URL = (ROOT / "index.html").as_uri()
READING = (ROOT / "assets/generated/reading-exams/reading-practice-unified.html").as_uri()


async def wait_ready(page) -> None:
    await page.wait_for_function("() => window.app?.isInitialized === true", timeout=60000)


async def main() -> None:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--allow-file-access-from-files"])
        context = await browser.new_context()
        page = await context.new_page()
        page.set_default_timeout(30000)
        errors: list[str] = []
        page.on("pageerror", lambda err: errors.append(str(err)))

        await page.goto(URL, wait_until="load")
        await wait_ready(page)
        aliases = await page.evaluate(
            """async () => {
              const aliases = { ...window.__READING_EXAM_ALIASES__ };
              const records = Object.keys(aliases).map((retired, index) => ({
                id: 'retired-' + index, sessionId: 'retired-' + index, examId: retired, type: 'reading',
                title: window.__READING_EXAM_MANIFEST__[retired].title, correctAnswers: 10, totalQuestions: 13,
                completedAt: new Date(Date.UTC(2026, 8, 1 + index)).toISOString(),
                metadata: { examId: retired, type: 'reading' }
              }));
              const plan = await AppData.backups.previewImport(JSON.stringify({ practice_records: records }), {});
              await AppData.backups.commitImport(plan.id, { confirmDestructive: true });
              return aliases;
            }"""
        )
        assert aliases, "catalog declares no retired IDs"

        await page.reload(wait_until="load")
        await wait_ready(page)
        await page.evaluate("async () => { try { await LicenseModal.accept(); } catch (_) {} }")
        await page.evaluate("() => document.querySelector(\"nav.main-nav button[data-view='browse']\")?.click()")
        current = sorted(set(aliases.values()))
        await page.wait_for_function(
            """(ids) => typeof window.getBrowseLearningStatus === 'function'
                && ids.every((id) => window.getBrowseLearningStatus({ id, type: 'reading' }))""",
            arg=current,
            timeout=20000,
        )
        listing = await page.evaluate(
            """async (retired) => {
              const index = await resolveActiveExamIndex();
              const records = await AppData.practice.list({ projection: 'light' });
              return {
                listedRetired: index.filter((exam) => retired.includes(exam.id)).map((exam) => exam.id),
                recordIds: records.map((record) => record.examId).sort()
              };
            }""",
            list(aliases),
        )
        assert listing["listedRetired"] == [], listing
        assert listing["recordIds"] == sorted(aliases.values()), listing

        reading = await context.new_page()
        reading.on("pageerror", lambda err: errors.append(str(err)))
        retired = next(iter(aliases))
        await reading.goto(f"{READING}?examId={retired}&test_env=1", wait_until="load")
        await reading.wait_for_selector("#question-groups .group")
        print(json.dumps({"aliases": aliases, "listing": listing, "opened": retired, "errors": errors}, ensure_ascii=False))
        assert not errors, errors
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
