#!/usr/bin/env python3
"""Cold-boot regression: imported legacy reading records must mark Browse cards.

Legacy (v1) records carry no library provenance. After importing them and
reloading, opening Browse directly (without visiting Practice) must already
show every completed article.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[3]
URL = (ROOT / "index.html").as_uri()
SEEDED = 6


async def wait_ready(page) -> None:
    await page.wait_for_function("() => window.app?.isInitialized === true", timeout=60000)


async def main() -> None:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await (await browser.new_context()).new_page()
        page.set_default_timeout(30000)
        errors: list[str] = []
        page.on("pageerror", lambda err: errors.append(str(err)))

        await page.goto(URL, wait_until="load")
        await wait_ready(page)
        seeded = await page.evaluate(
            """async (count) => {
              const exams = (window.__READING_EXAM_INDEX__ || []).slice(0, count);
              const records = exams.map((exam, index) => ({
                id: 'legacy-cold-' + index, sessionId: 'legacy-cold-' + index,
                examId: exam.id, title: exam.title, type: 'reading',
                correctAnswers: 9, totalQuestions: 13,
                completedAt: new Date(Date.UTC(2026, 8, 1 + index)).toISOString(),
                metadata: { examId: exam.id, examTitle: exam.title, type: 'reading' }
              }));
              const plan = await AppData.backups.previewImport(JSON.stringify({ practice_records: records }), {});
              await AppData.backups.commitImport(plan.id, { confirmDestructive: true });
              return exams.map((exam) => exam.id);
            }""",
            SEEDED,
        )
        assert len(seeded) == SEEDED, seeded

        await page.reload(wait_until="load")
        await wait_ready(page)
        await page.evaluate("async () => { try { await LicenseModal.accept(); } catch (_) {} }")
        await page.evaluate("() => document.querySelector(\"nav.main-nav button[data-view='browse']\")?.click()")
        await page.wait_for_function(
            """(ids) => typeof window.getBrowseLearningStatus === 'function'
                && (window.__READING_EXAM_INDEX__ || [])
                    .filter((exam) => ids.includes(exam.id))
                    .every((exam) => window.getBrowseLearningStatus({ ...exam, type: 'reading' }))""",
            arg=seeded,
            timeout=20000,
        )
        visible = await page.evaluate(
            """(ids) => {
              const cards = [...document.querySelectorAll('#browse-view .exam-item')];
              const seededCards = cards.filter((card) => ids.includes(card.querySelector('[data-exam-id]')?.dataset.examId));
              return { seeded: seededCards.length, dotted: seededCards.filter((card) => card.querySelector('.completion-dot')).length };
            }""",
            seeded,
        )
        print(json.dumps({"seeded": seeded, "visible": visible, "errors": errors}, ensure_ascii=False))
        assert visible["seeded"] == visible["dotted"], visible
        assert not errors, errors
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
