#!/usr/bin/env python3
"""Optional dynamic library loading E2E.

This browser smoke test verifies that a user-selected arbitrary folder can be
recognized as a listening library without relying on ListeningPractice/P1-P4.
It is intentionally optional because it depends on Playwright availability.
"""

from __future__ import annotations

import asyncio
import json
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, List

REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX_URL = f"{(REPO_ROOT / 'index.html').as_uri()}?test_env=1&dynamic_library_optional=1"
REPORT_DIR = REPO_ROOT / "developer" / "tests" / "e2e" / "reports"
REPORT_FILE = REPORT_DIR / "dynamic-library-loading-optional-report.json"

try:
    from playwright.async_api import Browser, ConsoleMessage, Page, async_playwright
except ModuleNotFoundError:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_FILE.write_text(
        json.dumps(
            {
                "status": "skipped",
                "reason": "python_playwright_unavailable",
                "detail": "Install Playwright to run this optional browser smoke test.",
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"[SKIP] playwright is unavailable; report: {REPORT_FILE}")
    raise SystemExit(0)


@dataclass
class ConsoleEntry:
    page: str
    type: str
    text: str


def collect_console(page: Page, store: List[ConsoleEntry]) -> None:
    def handler(msg: ConsoleMessage) -> None:
        store.append(ConsoleEntry(page=page.url, type=msg.type, text=msg.text))

    page.on("console", handler)


async def launch_browser(playwright) -> Browser:
    try:
        return await playwright.chromium.launch(
            headless=True,
            args=["--allow-file-access-from-files"],
        )
    except Exception:
        return await playwright.chromium.launch(headless=True)


async def ensure_app_ready(page: Page) -> None:
    await page.wait_for_load_state("load")
    await page.wait_for_function(
        "() => window.app && window.app.isInitialized && window.storage && window.LibraryDiscovery && typeof window.handleLibraryUpload === 'function'",
        timeout=60000,
    )


async def dismiss_overlays(page: Page) -> None:
    await page.evaluate(
        """
        () => {
            try { localStorage.setItem('hasSeenGplLicense', 'true'); } catch (_) {}
            if (typeof window.acceptGplLicense === 'function') {
                try { window.acceptGplLicense(); } catch (_) {}
            }
            const modal = document.getElementById('license-modal');
            if (modal) modal.classList.remove('show');
        }
        """
    )


async def run_dynamic_import(page: Page) -> dict[str, Any]:
    return await page.evaluate(
        """
        async () => {
            const html = `<!doctype html>
<html>
<head><title>IELTS Listening Practice - Arbitrary Deep Import</title></head>
<body>
  <audio src="audio.mp3"></audio>
  <section>Questions 1-10</section>
  <script>
    const CONFIG_DATA = { answerKey: { text: { q1: 'accommodation' }, matching: { q2: 'B' } } };
    const App = { config: CONFIG_DATA, state: { timerSecs: 0 }, finishTest() { return CONFIG_DATA.answerKey; } };
  </script>
</body>
</html>`;

            function makeFile(path, content, type) {
                const name = path.split('/').pop();
                const file = new File([content || ''], name, { type: type || 'text/plain' });
                Object.defineProperty(file, 'webkitRelativePath', { configurable: true, value: path });
                return file;
            }

            const files = [
                makeFile('Teacher Pack/loose/nested/arbitrary-listening.html', html, 'text/html'),
                makeFile('Teacher Pack/loose/nested/audio.mp3', 'fake audio bytes', 'audio/mpeg'),
                makeFile('Teacher Pack/audio-only/ielts-listening-intro.html', '<!doctype html><title>IELTS Listening Practice - Audio Only</title><audio src="intro.mp3"></audio><section>Questions 1-10</section>', 'text/html'),
                makeFile('Teacher Pack/audio-only/intro.mp3', 'fake intro bytes', 'audio/mpeg'),
                makeFile('Teacher Pack/loose/nested/readme.html', '<!doctype html><title>plain page</title>', 'text/html')
            ];

            const beforeActive = await window.storage.get('active_exam_index_key', 'exam_index');
            const fullReport = await window.handleLibraryUpload({ type: 'listening', mode: 'full' }, files);
            const activeKey = await window.storage.get('active_exam_index_key', '');
            const configs = await window.storage.get('exam_index_configurations', []);
            const dataset = await window.storage.get(activeKey, []);
            const customRows = Array.isArray(dataset)
                ? dataset.filter(row => row && row.type === 'listening' && row.sourceKind === 'file-picker')
                : [];
            const custom = customRows[0] || null;
            const builtUrl = custom && window.ResourceCore
                ? window.ResourceCore.buildResourcePath(custom, 'html')
                : '';
            const overview = window.AppServices && window.AppServices.overviewStats
                ? window.AppServices.overviewStats.calculate(dataset)
                : null;
            const customOverview = overview && overview.listening
                ? overview.listening.find(row => row && row.category === 'Custom')
                : null;

            window.prompt = () => 'optional-dup';
            const incrementalReport = await window.handleLibraryUpload({ type: 'listening', mode: 'incremental' }, files);
            const incrementalActiveKey = await window.storage.get('active_exam_index_key', '');
            const configsAfterIncremental = await window.storage.get('exam_index_configurations', []);
            const afterDataset = await window.storage.get(incrementalActiveKey, []);
            const fullDatasetAfterIncremental = await window.storage.get(activeKey, []);
            const afterCustomRows = Array.isArray(afterDataset)
                ? afterDataset.filter(row => row && row.type === 'listening' && row.sourceKind === 'file-picker')
                : [];
            const fullConfigCustomRows = Array.isArray(fullDatasetAfterIncremental)
                ? fullDatasetAfterIncremental.filter(row => row && row.type === 'listening' && row.sourceKind === 'file-picker')
                : [];
            const reportHost = document.createElement('div');
            window.renderLibraryUploadReport(fullReport, reportHost);

            return {
                beforeActive,
                activeKey,
                incrementalActiveKey,
                configCount: Array.isArray(configs) ? configs.length : -1,
                configCountAfterIncremental: Array.isArray(configsAfterIncremental) ? configsAfterIncremental.length : -1,
                datasetCount: Array.isArray(dataset) ? dataset.length : -1,
                customRows,
                builtUrl,
                customOverview,
                fullReport,
                incrementalReport,
                renderedReportText: reportHost.textContent || '',
                afterCustomCount: afterCustomRows.length,
                fullConfigCustomCountAfterIncremental: fullConfigCustomRows.length,
                afterDatasetCount: Array.isArray(afterDataset) ? afterDataset.length : -1
            };
        }
        """
    )


async def delete_inactive_config_via_ui(page: Page, config_key: str) -> dict[str, Any]:
    before = await page.evaluate(
        """
        async (configKey) => {
            const oldHost = document.getElementById('dynamic-library-delete-test-host');
            if (oldHost) oldHost.remove();
            const host = document.createElement('div');
            host.id = 'dynamic-library-delete-test-host';
            host.style.position = 'fixed';
            host.style.left = '24px';
            host.style.top = '24px';
            host.style.width = '720px';
            host.style.maxWidth = 'calc(100vw - 48px)';
            host.style.zIndex = '3500';
            document.body.appendChild(host);
            const sentinelRecords = [{
                id: 'library-delete-sentinel',
                examId: 'reading-a',
                title: 'Sentinel Record',
                metadata: { examType: 'reading', category: 'P1' }
            }];
            await window.storage.set('practice_records', sentinelRecords);
            await window.renderLibraryConfigList({
                allowDelete: true,
                containerId: 'dynamic-library-delete-test-host'
            });
            const dataset = await window.storage.get(configKey, null);
            const pathMap = await window.storage.get('exam_path_map__' + configKey, null);
            return {
                activeKey: await window.storage.get('active_exam_index_key', ''),
                datasetExists: Array.isArray(dataset),
                pathMapExists: !!pathMap,
                records: await window.storage.get('practice_records', [])
            };
        }
        """,
        config_key,
    )

    delete_button = page.locator(
        f'#dynamic-library-delete-test-host .library-config-panel [data-config-action="delete"][data-config-key="{config_key}"]'
    ).first
    await delete_button.click()
    confirm_overlay = page.locator(".library-config-confirm-overlay")
    await confirm_overlay.wait_for(state="visible", timeout=5000)
    confirm_text = await confirm_overlay.inner_text()
    await page.locator('.library-config-confirm-overlay [data-confirm-action="confirm"]').click()
    await page.wait_for_function(
        "configKey => window.storage.get(configKey, null).then(value => value === null)",
        arg=config_key,
        timeout=10000,
    )
    await confirm_overlay.wait_for(state="detached", timeout=5000)

    after = await page.evaluate(
        """
        async (configKey) => {
            const configs = await window.storage.get('exam_index_configurations', []);
            return {
                activeKey: await window.storage.get('active_exam_index_key', ''),
                dataset: await window.storage.get(configKey, null),
                pathMap: await window.storage.get('exam_path_map__' + configKey, null),
                configStillListed: Array.isArray(configs) && configs.some(cfg => cfg && cfg.key === configKey),
                records: await window.storage.get('practice_records', []),
                panelText: (document.querySelector('#dynamic-library-delete-test-host .library-config-panel') || {}).textContent || ''
            };
        }
        """,
        config_key,
    )

    return {
        "before": before,
        "after": after,
        "confirmText": confirm_text,
    }


async def run() -> int:
    console_log: List[ConsoleEntry] = []
    report: dict[str, Any] = {
        "status": "fail",
        "indexUrl": INDEX_URL,
        "checks": {},
        "consoleErrors": [],
    }

    async with async_playwright() as playwright:
        browser = await launch_browser(playwright)
        context = await browser.new_context()
        page = await context.new_page()
        collect_console(page, console_log)

        try:
            await page.goto(INDEX_URL)
            await ensure_app_ready(page)
            await dismiss_overlays(page)

            result = await run_dynamic_import(page)
            delete_result = await delete_inactive_config_via_ui(page, result.get("activeKey") or "")
            custom_rows = result.get("customRows") or []
            assert result.get("activeKey") and result.get("activeKey") != "exam_index", "全量导入未创建新的自定义题库配置"
            assert len(custom_rows) == 1, f"应只识别一个有效听力 HTML，实际: {len(custom_rows)}"
            custom = custom_rows[0]
            assert custom.get("category") == "Custom", f"任意目录导入不应硬编码 P1-P4: {custom}"
            assert custom.get("path") == "Teacher Pack/loose/nested/", f"导入路径不正确: {custom.get('path')}"
            assert "config-answer-key" in (custom.get("detectedBy") or []), "缺少内容识别信号"
            assert str(result.get("builtUrl") or "").startswith("blob:"), f"外部上传题源未使用运行时 Blob URL: {result.get('builtUrl')}"
            assert (result.get("customOverview") or {}).get("total") == 1, "Custom 听力类别未暴露到总览统计"
            assert result.get("incrementalActiveKey") and result.get("incrementalActiveKey") != result.get("activeKey"), "增量导入应创建并激活新的配置快照"
            assert result.get("configCountAfterIncremental", 0) >= result.get("configCount", 0) + 1, "增量导入未追加新的配置记录"
            assert result.get("afterCustomCount") == 1, "增量导入同一文件应去重/更新，不应重复追加"
            assert result.get("fullConfigCustomCountAfterIncremental") == 1, "增量导入不应污染全量导入生成的旧配置"
            full_report = result.get("fullReport") or {}
            incremental_report = result.get("incrementalReport") or {}
            assert full_report.get("status") == "success", f"全量导入报告状态错误: {full_report}"
            assert full_report.get("accepted") == 1, f"全量报告识别数量错误: {full_report}"
            assert (full_report.get("runtime") or {}).get("html") == 1, f"全量报告缺少运行时 HTML 资源: {full_report}"
            assert "file-picker-session-resources" in (full_report.get("warnings") or []), "全量报告缺少 file picker 会话资源提示"
            assert (full_report.get("reasonCounts") or {}).get("missing-answer-or-scoring-path") == 1, f"全量报告缺少伪听力拒绝原因: {full_report}"
            assert "index" not in (full_report.get("merge") or {}), "导入报告不应携带完整索引"
            assert (incremental_report.get("merge") or {}).get("updated") == 1, f"增量导入应更新同一 importKey: {incremental_report}"
            rendered_text = result.get("renderedReportText") or ""
            assert "导入完成" in rendered_text and "缺少答案或评分链路" in rendered_text, f"导入报告 UI 未展示关键结果: {rendered_text}"
            assert "当前会话 Blob URL" in rendered_text, f"导入报告 UI 未展示 file:// 会话边界: {rendered_text}"
            assert (delete_result.get("before") or {}).get("datasetExists") is True, f"删除前旧配置数据集不存在: {delete_result}"
            assert (delete_result.get("before") or {}).get("pathMapExists") is True, f"删除前旧配置 path map 不存在: {delete_result}"
            assert "删除题库配置" in (delete_result.get("confirmText") or ""), f"删除配置未出现项目内确认层: {delete_result}"
            assert (delete_result.get("after") or {}).get("dataset") is None, f"删除后配置数据集仍残留: {delete_result}"
            assert (delete_result.get("after") or {}).get("pathMap") is None, f"删除后 path map 仍残留: {delete_result}"
            assert (delete_result.get("after") or {}).get("configStillListed") is False, f"删除后配置列表仍残留: {delete_result}"
            assert (delete_result.get("after") or {}).get("activeKey") == result.get("incrementalActiveKey"), f"删除非活动配置不应改变当前配置: {delete_result}"
            assert (delete_result.get("after") or {}).get("records") == (delete_result.get("before") or {}).get("records"), f"删除题库配置不应改写练习记录: {delete_result}"
            report["checks"]["dynamicImport"] = result
            report["checks"]["configDelete"] = delete_result
            report["status"] = "pass"
            return 0
        except Exception as error:
            report["status"] = "fail"
            report["error"] = str(error)
            return 1
        finally:
            report["consoleErrors"] = [
                asdict(entry)
                for entry in console_log
                if entry.type and entry.type.lower() == "error"
            ]
            REPORT_DIR.mkdir(parents=True, exist_ok=True)
            REPORT_FILE.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            await context.close()
            await browser.close()


if __name__ == "__main__":
    completed = asyncio.run(run())
    print(f"Dynamic library optional E2E report: {REPORT_FILE}")
    raise SystemExit(completed)
