#!/usr/bin/env python3
"""Playwright flow that exercises suite practice mode and captures screenshots.

优化版本：
- 添加详细的步骤日志
- 改进错误处理和重试机制
- 优化等待策略
- 增强调试信息
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import re
import subprocess
import sys
from typing import List, Optional

from playwright.async_api import (  # type: ignore[import-untyped]
    Browser,
    ConsoleMessage,
    Error as PlaywrightError,
    Page,
    TimeoutError as PlaywrightTimeoutError,
    async_playwright,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX_PATH = REPO_ROOT / "index.html"
E2E_BASE_URL = os.environ.get("E2E_BASE_URL")
INDEX_URL = f"{(E2E_BASE_URL or 'http://localhost:8000').rstrip('/')}/index.html?test_env=1"
REPORT_DIR = REPO_ROOT / "developer" / "tests" / "e2e" / "reports"


def log_step(message: str, level: str = "INFO") -> None:
    """记录测试步骤日志"""
    timestamp = datetime.now().strftime('%H:%M:%S.%f')[:-3]
    prefix = {
        "INFO": "ℹ️",
        "SUCCESS": "✅",
        "WARNING": "⚠️",
        "ERROR": "❌",
        "DEBUG": "🔍"
    }.get(level, "•")
    print(f"[{timestamp}] {prefix} {message}")


@dataclass
class ConsoleEntry:
    page_title: str
    type: str
    text: str
    timestamp: str


async def _ensure_app_ready(page: Page) -> None:
    """确保应用已准备就绪"""
    log_step("等待页面加载...")
    await page.wait_for_load_state("load")
    log_step("页面加载完成，等待应用初始化...")
    
    try:
        await page.wait_for_function(
            "() => window.app && window.app.isInitialized && window.storage && typeof window.storage.get === 'function'",
            timeout=60000,
        )
        log_step("应用初始化完成", "SUCCESS")
    except PlaywrightTimeoutError:
        log_step("应用初始化超时", "ERROR")
        # 打印调试信息
        app_state = await page.evaluate(
            "() => ({ hasApp: !!window.app, isInit: window.app?.isInitialized, hasStorage: !!window.storage })"
        )
        log_step(f"应用状态: {app_state}", "DEBUG")
        raise


async def _click_nav(page: Page, view: str) -> None:
    """点击导航按钮并等待视图激活"""
    log_step(f"点击导航: {view}")
    
    try:
        await page.locator(f"nav button[data-view='{view}']").click()
        await page.wait_for_selector(f"#{view}-view.active", timeout=15000)
        log_step(f"视图 {view} 已激活", "SUCCESS")
    except PlaywrightTimeoutError:
        log_step(f"视图 {view} 激活超时", "ERROR")
        # 检查视图是否存在但未激活
        view_exists = await page.is_visible(f"#{view}-view")
        log_step(f"视图 {view} 存在: {view_exists}", "DEBUG")
        raise


async def _dismiss_overlays(page: Page) -> None:
    """关闭可能阻塞交互的覆盖层"""
    log_step("检查并关闭覆盖层...")
    
    # 关闭题库加载器覆盖层
    overlay = page.locator("#library-loader-overlay")
    if await overlay.count():
        try:
            await overlay.wait_for(state="visible", timeout=2000)
            close_btn = overlay.locator("[data-library-action='close']")
            if await close_btn.count():
                await close_btn.first.click()
                await overlay.wait_for(state="detached", timeout=5000)
                log_step("已关闭题库加载器覆盖层", "SUCCESS")
        except Exception as e:
            log_step(f"关闭题库加载器覆盖层失败: {e}", "WARNING")

    # 关闭备份模态框
    backup_modal = page.locator(".backup-modal-close")
    if await backup_modal.count():
        try:
            await backup_modal.first.click()
            log_step("已关闭备份模态框", "SUCCESS")
        except Exception as e:
            log_step(f"关闭备份模态框失败: {e}", "WARNING")


async def _complete_passage(suite_page: Page, total_count: int, index: int) -> bool:
    """完成一篇练习并等待下一篇加载"""
    if suite_page.is_closed():
        log_step("套题页面已关闭", "WARNING")
        return False

    log_step(f"完成第 {index + 1}/{total_count} 篇练习...")
    
    try:
        await suite_page.wait_for_load_state("load")
        await suite_page.wait_for_selector("#complete-exam-btn", timeout=20000)
        await suite_page.evaluate(
            "() => { const btn = document.getElementById('complete-exam-btn'); if (btn) { btn.disabled = false; } }"
        )
        
        current_exam_id = await suite_page.evaluate("() => document.body.dataset.examId || ''")
        log_step(f"当前题目 ID: {current_exam_id}", "DEBUG")
        
        await suite_page.click("#complete-exam-btn")
        log_step("已点击完成按钮")

        await suite_page.evaluate(
            "() => { const btn = document.getElementById('complete-exam-btn'); if (btn) { btn.disabled = true; } }"
        )
        
        if index + 1 < total_count:
            log_step(f"等待下一篇练习加载...")
            try:
                await suite_page.wait_for_function(
                    "(initialId) => (document.body.dataset.examId || '') !== initialId",
                    arg=current_exam_id,
                    timeout=30000,
                )
                new_exam_id = await suite_page.evaluate("() => document.body.dataset.examId || ''")
                log_step(f"已切换到下一篇: {new_exam_id}", "SUCCESS")
            except PlaywrightTimeoutError:
                if suite_page.is_closed():
                    log_step("套题页面在切换时关闭", "WARNING")
                    return False
                log_step("等待下一篇超时，继续尝试", "WARNING")

            try:
                await suite_page.evaluate(
                    "() => { const btn = document.getElementById('complete-exam-btn'); if (btn) { btn.disabled = false; } }"
                )
            except PlaywrightTimeoutError:
                log_step("等待下一篇按钮启用超时，继续尝试", "WARNING")
            log_step(f"第 {index + 2} 篇练习已准备就绪", "SUCCESS")
        else:
            log_step("已完成所有练习", "SUCCESS")

        return True
        
    except Exception as e:
        log_step(f"完成练习时出错: {e}", "ERROR")
        raise


def _collect_console(page: Page, store: List[ConsoleEntry]) -> None:
    """收集控制台消息"""
    def _handler(msg: ConsoleMessage) -> None:
        store.append(ConsoleEntry(
            page_title=page.url,
            type=msg.type,
            text=msg.text,
            timestamp=datetime.now().isoformat()
        ))

    page.on("console", _handler)


async def run() -> None:
    """运行套题练习流程测试"""
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    console_log: List[ConsoleEntry] = []
    start_time = datetime.now()
    test_passed = False
    server_process: Optional[subprocess.Popen[bytes]] = None

    log_step("=" * 80)
    log_step("开始套题练习流程测试 (E2E)")
    log_step("=" * 80)

    try:
        if INDEX_URL.startswith("http://localhost:"):
            log_step("启动本地静态服务器以供 E2E 访问...")
            server_process = subprocess.Popen(
                [sys.executable, "-m", "http.server", INDEX_URL.split(":")[2].split("/")[0]],
                cwd=REPO_ROOT,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
            )
            await asyncio.sleep(1)

        async with async_playwright() as p:
            log_step("启动 Chromium 浏览器...")
            browser: Browser = await p.chromium.launch(
                headless=True,
                args=["--allow-file-access-from-files"],
            )
            context = await browser.new_context()

            context.on("page", lambda pg: _collect_console(pg, console_log))

            log_step(f"导航到: {INDEX_URL}")
            page = await context.new_page()
            await page.goto(INDEX_URL)
            
            await _ensure_app_ready(page)
            await _dismiss_overlays(page)

            log_step("切换到总览视图...")
            await _click_nav(page, "overview")
            
            log_step("查找套题练习按钮...")
            start_button = page.locator("button[data-action='start-suite-mode']")
            await start_button.scroll_into_view_if_needed()
            log_step("套题练习按钮已就绪", "SUCCESS")

            log_step("启动套题练习...")
            async with page.expect_popup() as popup_wait:
                await start_button.click()
            suite_page = await popup_wait.value
            _collect_console(suite_page, console_log)
            log_step("套题练习窗口已打开", "SUCCESS")

            log_step("开始完成 1 篇练习...")
            for idx in range(1):
                try:
                    should_continue = await _complete_passage(suite_page, 1, idx)
                except (PlaywrightTimeoutError, PlaywrightError) as e:
                    log_step(f"完成第 {idx + 1} 篇时出错: {e}", "ERROR")
                    if suite_page.is_closed():
                        log_step("套题页面已关闭，终止测试", "WARNING")
                        break
                    raise
                if not should_continue:
                    log_step(f"第 {idx + 1} 篇后终止", "WARNING")
                    break

            if not suite_page.is_closed():
                try:
                    await suite_page.wait_for_timeout(1000)
                    await suite_page.close()
                    log_step("已关闭套题练习窗口", "SUCCESS")
                except Exception as e:
                    log_step(f"关闭套题窗口失败: {e}", "WARNING")

            log_step("切换到练习记录视图...")
            await _click_nav(page, "practice")
            await page.wait_for_timeout(2000)
            
            log_step("等待练习记录加载...")
            await page.wait_for_function(
                "() => window.app && window.app.state && window.app.state.practice &&\n"
                "  Array.isArray(window.app.state.practice.records) && window.app.state.practice.records.length > 0",
                timeout=30000,
            )
            log_step("练习记录已加载", "SUCCESS")

            await page.evaluate(
                "if (typeof window.updatePracticeView === 'function') { window.updatePracticeView(); }"
            )

            await page.wait_for_timeout(500)

            log_step("查找套题练习记录...")
            await page.wait_for_selector("#history-list .history-record-item", timeout=20000)

            suite_record = page.locator(
                "#history-list .history-record-item[data-record-id^='suite_']"
            )
            target_record = suite_record.first
            await target_record.wait_for(state="visible", timeout=5000)

            record_id = await target_record.get_attribute("data-record-id")
            if not record_id:
                raise AssertionError("Suite practice record not found in history list")
            
            log_step(f"找到套题记录: {record_id}", "SUCCESS")

            title_text = await page.evaluate(
                "(id) => {\n"
                "  const base = '#history-list .history-record-item[data-record-id=\\'' + id + '\\']';\n"
                "  const titleEl = document.querySelector(base + ' .record-title')\n"
                "    || document.querySelector(base + ' .practice-record-title');\n"
                "  return titleEl ? titleEl.textContent.trim() : null;\n"
                "}",
                record_id,
            )
            if not title_text:
                raise AssertionError("Suite practice record title element missing")
            if not re.match(r"^\d{2}月\d{2}日套题练习\d+$", title_text):
                raise AssertionError(f"Unexpected suite record title: {title_text}")
            
            log_step(f"记录标题验证通过: {title_text}", "SUCCESS")

            log_step("截图: 练习记录列表...")
            list_path = REPORT_DIR / "suite-practice-record-list.png"
            await page.locator("#practice-view").screenshot(path=str(list_path))
            log_step(f"已保存截图: {list_path.name}", "SUCCESS")

            log_step("打开练习记录详情...")
            await page.evaluate(
                "(id) => {\n"
                "  if (window.app?.components?.practiceHistory?.showRecordDetails) {\n"
                "    window.app.components.practiceHistory.showRecordDetails(id);\n"
                "    return;\n"
                "  }\n"
                "  if (window.practiceHistoryEnhancer?.showRecordDetails) {\n"
                "    window.practiceHistoryEnhancer.showRecordDetails(id);\n"
                "    return;\n"
                "  }\n"
                "  const selector = '#history-list .history-record-item[data-record-id=\"' + id + '\"] button[data-history-action=\"details\"]';\n"
                "  const button = document.querySelector(selector);\n"
                "  if (button) { button.click(); }\n"
                "}",
                record_id,
            )
            await page.wait_for_selector("#practice-record-modal.modal-overlay.show", timeout=15000)
            log_step("练习记录详情已打开", "SUCCESS")

            log_step("截图: 练习记录详情...")
            detail_path = REPORT_DIR / "suite-practice-record-detail.png"
            await page.locator("#practice-record-modal .modal-container").screenshot(path=str(detail_path))
            log_step(f"已保存截图: {detail_path.name}", "SUCCESS")

            await browser.close()
            log_step("浏览器已关闭", "SUCCESS")
            
            test_passed = True
            
    except Exception as e:
        log_step(f"测试失败: {e}", "ERROR")
        import traceback
        traceback.print_exc()
        test_passed = False
        
    finally:
        duration = (datetime.now() - start_time).total_seconds()

        if server_process:
            server_process.terminate()
            try:
                server_process.wait(timeout=5)
            except Exception:
                server_process.kill()

        # 生成测试报告
        report = {
            "generatedAt": datetime.now().isoformat(),
            "duration": duration,
            "status": "pass" if test_passed else "fail",
            "consoleLogs": [
                {
                    "type": entry.type,
                    "text": entry.text,
                    "timestamp": entry.timestamp,
                    "page": entry.page_title
                }
                for entry in console_log
            ]
        }
        
        report_path = REPORT_DIR / "suite-practice-flow-report.json"
        import json
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        
        # 打印控制台日志摘要
        if console_log:
            error_logs = [e for e in console_log if e.type == "error"]
            warning_logs = [e for e in console_log if e.type == "warning"]
            
            log_step("=" * 80)
            log_step("控制台日志摘要:")
            log_step(f"  总日志数: {len(console_log)}")
            log_step(f"  错误数: {len(error_logs)}")
            log_step(f"  警告数: {len(warning_logs)}")
            
            if error_logs:
                log_step("\n前 5 个错误:", "ERROR")
                for entry in error_logs[:5]:
                    log_step(f"  [{entry.type.upper()}] {entry.text}")
        else:
            log_step("无控制台消息捕获", "WARNING")
        
        log_step("=" * 80)
        if test_passed:
            log_step(f"✅ 测试通过 (耗时: {duration:.2f}秒)", "SUCCESS")
        else:
            log_step(f"❌ 测试失败 (耗时: {duration:.2f}秒)", "ERROR")
        log_step("=" * 80)


if __name__ == "__main__":
    asyncio.run(run())
