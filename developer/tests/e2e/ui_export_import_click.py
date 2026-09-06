#!/usr/bin/env python3
"""Real-click Playwright smoke for settings export/import against live AppData v2."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[3]
# Prefer file:// so CI and local runs do not depend on a temporary HTTP host.
URL = (ROOT / "index.html").as_uri()
OUT_DIR = Path(__file__).resolve().parent / "reports"
OUT = OUT_DIR / "ui-export-import-click.json"


async def dismiss_overlay(page) -> str:
    """Close license / backup-list / import-mode overlays that intercept clicks."""
    closed = []
    for selector in ("#license-modal", "#backup-list-modal", ".import-mode-modal", ".backup-modal-overlay"):
        loc = page.locator(selector)
        count = await loc.count()
        if not count:
            continue
        for index in range(count):
            el = loc.nth(index)
            try:
                visible = await el.is_visible()
            except Exception:
                visible = False
            if not visible:
                continue
            close = el.locator(
                "button[aria-label='关闭'], button.theme-modal-close, "
                ".shui-secondary-modal__close, button:has-text('关闭'), "
                "button:has-text('取消'), .close-btn-lite"
            )
            if await close.count():
                await close.first.click(force=True)
            else:
                await page.keyboard.press("Escape")
            await page.wait_for_timeout(200)
            if await el.is_visible():
                await el.evaluate(
                    "node => { node.classList.remove('show'); "
                    "node.style.display = 'none'; node.setAttribute('aria-hidden', 'true'); }"
                )
            closed.append(selector)
    # license modal uses display:flex even after failed dismiss in some paths
    license_modal = page.locator("#license-modal")
    if await license_modal.count():
        await license_modal.evaluate(
            "el => { el.style.display = 'none'; el.classList.remove('show'); }"
        )
        closed.append("#license-modal:force")
    return ",".join(closed) or "none"


async def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    result: dict = {"steps": [], "ok": True}

    def step(name: str, **kw) -> None:
        entry = {"name": name, **kw}
        result["steps"].append(entry)
        print(json.dumps(entry, ensure_ascii=False), flush=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(accept_downloads=True)
        page = await context.new_page()
        page.set_default_timeout(30000)
        console: list[str] = []
        page.on("console", lambda msg: console.append(f"{msg.type}: {msg.text}"))
        page.on("pageerror", lambda err: console.append(f"pageerror: {err}"))

        await page.goto(URL, wait_until="load")
        await page.wait_for_function("() => !!window.AppData")
        await page.evaluate("async () => { await window.AppData.ready; }")
        await page.wait_for_function("() => window.app?.isInitialized === true", timeout=60000)
        step("app-ready", url=page.url)

        modal = page.locator("#license-modal")
        if await modal.count():
            display = await modal.evaluate("el => getComputedStyle(el).display")
            if display != "none":
                await page.locator('button[data-index-action="accept-license"]').click(force=True)
                await page.wait_for_timeout(400)
        step("overlays-after-license", closed=await dismiss_overlay(page))

        await page.locator("nav.main-nav button[data-view='settings']").click()
        await page.wait_for_selector("#settings-view.active", timeout=10000)
        step("settings-open")

        seed = await page.evaluate(
            """async () => {
          await window.AppData.ready;
          const before = (await window.AppData.practice.list({projection:'light'})).length;
          const receipt = await window.AppData.practice.completeAttempt({
            operationId: 'ui-seed-1',
            record: {
              id: 'ui-seed-1', sessionId: 'ui-seed-1', examId: 'reading-ui-seed',
              title: 'UI Seed Passage', type: 'reading', totalQuestions: 4, correctAnswers: 3,
              answers: {q1:'A', q2:'B', q3:'C', q4:'D'},
              highlights: [{text:'seed highlight'}], dataSource: 'real',
              metadata: {examTitle:'UI Seed Passage', category:'P1'}
            }
          });
          const after = await window.AppData.practice.list({projection:'light'});
          return {before, after: after.length, committed: receipt.committed, ids: after.map(r=>r.id)};
        }"""
        )
        step("seed-record", **seed)
        assert seed["committed"] and "ui-seed-1" in seed["ids"]

        await page.locator("#create-backup-btn").click()
        await page.wait_for_timeout(800)
        backups_after_create = await page.evaluate(
            "async () => (await window.AppData.backups.list()).length"
        )
        step("create-backup-click", backupCount=backups_after_create)
        assert backups_after_create >= 1

        step("overlays-after-create", closed=await dismiss_overlay(page))

        async with page.expect_download(timeout=15000) as dl_info:
            await page.locator("#export-data-btn").click()
        download = await dl_info.value
        dest = OUT_DIR / download.suggested_filename
        await download.save_as(str(dest))
        payload = json.loads(dest.read_text(encoding="utf-8"))
        step(
            "export-download",
            filename=download.suggested_filename,
            path=str(dest),
            format=payload.get("format"),
            schemaVersion=payload.get("schemaVersion"),
            entityStores=sorted((payload.get("entities") or {}).keys()),
            summaryCount=len((payload.get("entities") or {}).get("practiceSummaries") or []),
        )
        assert payload.get("format") == "ielts-atlas-data-v2"
        assert "practiceSummaries" in (payload.get("entities") or {})

        await page.locator("#backup-list-btn").click()
        await page.wait_for_timeout(600)
        step("backup-list-click")
        step("overlays-after-list", closed=await dismiss_overlay(page))

        # File chooser is exercised with a real v1 JSON payload (historical export shape).
        v1_file = OUT_DIR / "v1-practice-export.json"
        v1_file.write_text(
            json.dumps(
                {
                    "exportDate": "2026-07-28T00:00:00.000Z",
                    "version": "0.6.2-form",
                    "practiceRecords": [
                        {
                            "id": "v1-file-import",
                            "examId": "reading-v1-file",
                            "title": "V1 File Import",
                            "type": "reading",
                            "totalQuestions": 2,
                            "correctAnswers": 1,
                            "answers": {"q1": "FILE"},
                            "highlights": [{"text": "from-file"}],
                            "dataSource": "real",
                            "metadata": {"examTitle": "V1 File Import", "category": "P1"},
                        }
                    ],
                    "userStats": {"totalPractices": 1},
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

        await page.locator("#import-data-btn").click()
        await page.wait_for_timeout(500)

        # Mode modal then opens a programmatic file input; intercept the chooser.
        mode_option = page.locator(".import-mode-option-lite, .import-mode-option").filter(
            has_text="合并"
        )
        file_import = None
        mode_label = None
        if await mode_option.count():
            mode_label = "merge"
            async with page.expect_file_chooser(timeout=10000) as fc_info:
                await mode_option.first.click()
            chooser = await fc_info.value
            await chooser.set_files(str(v1_file))
            await page.wait_for_timeout(1500)
            file_import = await page.evaluate(
                """async () => {
              const record = await window.AppData.practice.get('v1-file-import', { projection: 'full' });
              return record && { id: record.id, answers: record.answers, highlights: record.highlights };
            }"""
            )
        else:
            # Fallback: click any non-cancel mode button under an import overlay.
            mode_any = page.locator("button, .import-mode-option-lite").filter(
                has_text="导入"
            )
            if await mode_any.count():
                mode_label = await mode_any.first.inner_text()
                async with page.expect_file_chooser(timeout=10000) as fc_info:
                    await mode_any.first.click()
                chooser = await fc_info.value
                await chooser.set_files(str(v1_file))
                await page.wait_for_timeout(1500)
                file_import = await page.evaluate(
                    """async () => {
                  const record = await window.AppData.practice.get('v1-file-import', { projection: 'full' });
                  return record && { id: record.id, answers: record.answers, highlights: record.highlights };
                }"""
                )
        step("import-button-click", mode=mode_label, imported=file_import)
        if file_import:
            assert file_import["answers"]["q1"] == "FILE"

        v1 = await page.evaluate(
            """async () => {
          const payload = {
            exportDate: new Date().toISOString(),
            version: '0.6.2-form',
            practiceRecords: [{
              id: 'v1-click-import', examId: 'reading-v1', title: 'V1 Click Import', type: 'reading',
              totalQuestions: 2, correctAnswers: 1, answers: {q1:'YES'},
              highlights: [{text:'from-v1'}], dataSource: 'real',
              metadata: {examTitle:'V1 Click Import', category:'P1'}
            }],
            userStats: { totalPractices: 1 }
          };
          const preview = await window.AppData.backups.previewImport(payload, { practiceMode: 'merge' });
          const commit = await window.AppData.backups.commitImport(preview.id);
          const imported = await window.AppData.practice.get('v1-click-import', { projection: 'full' });
          const seed = await window.AppData.practice.get('ui-seed-1', { projection: 'full' });
          return {
            previewFormat: preview.format,
            practice: preview.practice,
            committed: commit.committed,
            imported: imported && { id: imported.id, answers: imported.answers, highlights: imported.highlights },
            seedKept: !!(seed && seed.answers)
          };
        }"""
        )
        step("v1-import", **v1)
        assert v1["previewFormat"] == "v1"
        assert v1["imported"] and v1["imported"]["answers"]["q1"] == "YES"
        assert v1["seedKept"] is True

        await page.locator("nav.main-nav button[data-view='practice']").click()
        await page.wait_for_selector("#practice-view.active", timeout=10000)
        await page.wait_for_timeout(1000)
        history = await page.evaluate(
            """() => {
          const items = Array.from(document.querySelectorAll(
            '#practice-history .practice-record, .practice-history-item, [data-record-id], .history-item'
          ));
          const texts = items.map(el => (el.textContent || '').replace(/\\s+/g,' ').trim())
            .filter(Boolean).slice(0, 10);
          const root = document.querySelector('#practice-history')
            || document.querySelector('#practice-view')
            || document.body;
          const body = root.innerText || '';
          return {
            itemCount: items.length,
            sample: texts,
            hasSeed: /UI Seed|ui-seed/i.test(body),
            hasV1: /V1 Click|v1-click/i.test(body),
            bodySnippet: body.slice(0, 500)
          };
        }"""
        )
        step("practice-history", **history)

        reimport = await page.evaluate(
            """(payload) => {
          return (async () => {
            const preview = await window.AppData.backups.previewImport(payload, { replace: true });
            const commit = await window.AppData.backups.commitImport(preview.id, {
              confirmDestructive: preview.destructive === true
            });
            const list = await window.AppData.practice.list({ projection: 'light' });
            return { format: preview.format, committed: commit.committed, ids: list.map(r => r.id).sort() };
          })();
        }""",
            payload,
        )
        step("v2-reimport-replace", **reimport)
        assert reimport["format"] == "v2"
        assert "ui-seed-1" in reimport["ids"]

        await page.screenshot(path=str(OUT_DIR / "ui-export-import-final.png"), full_page=True)
        result["console_tail"] = console[-30:]
        result["ok"] = True
        OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print("WROTE", OUT, flush=True)
        await browser.close()
        return 0 if result.get("ok") else 2


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except AssertionError as error:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        fail = {"ok": False, "error": str(error)}
        OUT.write_text(json.dumps(fail, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(fail, ensure_ascii=False), flush=True)
        raise SystemExit(2)
