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
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import re
import subprocess
import sys
from typing import Dict, List, Optional

REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX_PATH = REPO_ROOT / "index.html"
INDEX_URL = f"{INDEX_PATH.as_uri()}?test_env=1"
REPORT_DIR = REPO_ROOT / "developer" / "tests" / "e2e" / "reports"

try:
    from playwright.async_api import (  # type: ignore[import-untyped]
        Browser,
        ConsoleMessage,
        Error as PlaywrightError,
        Page,
        TimeoutError as PlaywrightTimeoutError,
        async_playwright,
    )
except ModuleNotFoundError:
    venv_dir = (REPO_ROOT / ".venv").resolve()
    venv_python = REPO_ROOT / ".venv" / "bin" / "python"
    current_prefix = Path(sys.prefix).resolve()
    if venv_python.exists() and current_prefix != venv_dir:
        completed = subprocess.run([
            str(venv_python),
            str(Path(__file__).resolve()),
        ], cwd=str(REPO_ROOT))
    else:
        node_runner = REPO_ROOT / "developer" / "tests" / "e2e" / "suite_practice_flow.node.js"
        completed = subprocess.run([
            "node",
            str(node_runner),
        ], cwd=str(REPO_ROOT))
    raise SystemExit(completed.returncode)


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
        await _dismiss_overlays(page)
        await page.locator(f"nav button[data-view='{view}']").click()
        await page.wait_for_selector(f"#{view}-view.active", timeout=15000)
        log_step(f"视图 {view} 已激活", "SUCCESS")
    except PlaywrightTimeoutError:
        log_step(f"视图 {view} 激活超时", "ERROR")
        # 检查视图是否存在但未激活
        view_exists = await page.is_visible(f"#{view}-view")
        log_step(f"视图 {view} 存在: {view_exists}", "DEBUG")
        raise


async def _select_suite_flow_mode(page: Page, mode: str) -> None:
    normalized_input = str(mode).strip().lower()
    if normalized_input == "stationary":
        normalized = "stationary"
    elif normalized_input == "simulation":
        normalized = "simulation"
    else:
        normalized = "classic"
    modal = page.locator("#suite-mode-selector-modal")
    try:
        await modal.wait_for(state="visible", timeout=2500)
    except PlaywrightTimeoutError:
        log_step("未检测到套题模式弹窗（test_env 直通路径），按预设参数继续。", "DEBUG")
        return

    mode_btn = page.locator(f"#suite-mode-selector-modal button[data-suite-flow-mode='{normalized}']")
    if not await mode_btn.count():
        log_step(f"未找到套题模式按钮: {normalized}，使用默认模式。", "WARNING")
        await modal.wait_for(state="hidden", timeout=10000)
        return
    await mode_btn.click()
    await modal.wait_for(state="hidden", timeout=10000)


async def _preset_suite_preferences(
    page: Page,
    mode: str = "classic",
    frequency_scope: str = "all",
    auto_advance_after_submit: Optional[bool] = None,
) -> None:
    normalized_mode = str(mode).strip().lower()
    if normalized_mode not in {"classic", "simulation", "stationary"}:
        normalized_mode = "classic"
    normalized_scope = str(frequency_scope).strip().lower()
    if normalized_scope not in {"high", "high_medium", "all"}:
        normalized_scope = "all"
    if auto_advance_after_submit is None:
        auto_advance_after_submit = normalized_mode != "stationary"
    normalized_auto_advance = bool(auto_advance_after_submit)
    await page.evaluate(
        """(payload) => {
            try {
                localStorage.setItem('suite_flow_mode', payload.mode);
                localStorage.setItem('suite_frequency_scope', payload.scope);
                localStorage.setItem('suite_auto_advance_after_submit', payload.autoAdvanceAfterSubmit ? 'true' : 'false');
            } catch (_) {
                // ignore storage failures
            }
            if (!window.practiceConfig || typeof window.practiceConfig !== 'object') {
                window.practiceConfig = {};
            }
            if (!window.practiceConfig.suite || typeof window.practiceConfig.suite !== 'object') {
                window.practiceConfig.suite = {};
            }
            window.practiceConfig.suite.flowMode = payload.mode;
            window.practiceConfig.suite.frequencyScope = payload.scope;
            window.practiceConfig.suite.autoAdvanceAfterSubmit = payload.autoAdvanceAfterSubmit;
        }""",
        {
            "mode": normalized_mode,
            "scope": normalized_scope,
            "autoAdvanceAfterSubmit": normalized_auto_advance,
        }
    )


async def _dismiss_overlays(page: Page) -> None:
    """关闭可能阻塞交互的覆盖层"""
    log_step("检查并关闭覆盖层...")

    try:
        await page.evaluate(
            """() => {
                try {
                    localStorage.setItem('hasSeenGplLicense', 'true');
                } catch (_) {
                    // ignore storage errors
                }
                if (typeof window.acceptGplLicense === 'function') {
                    try { window.acceptGplLicense(); } catch (_) {}
                }
                const modal = document.getElementById('license-modal');
                if (modal) {
                    modal.classList.remove('show');
                }
            }"""
        )
    except Exception as e:
        log_step(f"预清理 GPL 弹窗失败: {e}", "WARNING")

    # 关闭 GPL 许可弹窗
    license_modal = page.locator("#license-modal.show")
    if await license_modal.count():
        try:
            acknowledge = license_modal.locator("button.lm-btn")
            if await acknowledge.count():
                await acknowledge.first.click()
                await page.wait_for_function(
                    "() => !document.getElementById('license-modal')?.classList.contains('show')",
                    timeout=5000,
                )
                log_step("已关闭 GPL 许可弹窗", "SUCCESS")
        except Exception as e:
            log_step(f"关闭 GPL 许可弹窗失败: {e}", "WARNING")

    
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


async def _group_loaded(page: Page, group_name: str) -> bool:
    return await page.evaluate(
        "(group) => !!(window.AppLazyLoader && window.AppLazyLoader.getStatus && window.AppLazyLoader.getStatus(group).loaded)",
        group_name,
    )


async def _complete_passage(suite_page: Page, total_count: int, index: int) -> bool:
    """完成一篇练习并等待下一篇加载"""
    if suite_page.is_closed():
        log_step("套题页面已关闭", "WARNING")
        return False

    log_step(f"完成第 {index + 1}/{total_count} 篇练习...")
    
    try:
        await suite_page.wait_for_load_state("load")
        await suite_page.wait_for_selector("#complete-exam-btn", timeout=20000)
        await suite_page.wait_for_function(
            "() => { const btn = document.getElementById('complete-exam-btn'); return btn && !btn.disabled; }",
            timeout=20000,
        )
        
        current_exam_id = await suite_page.evaluate("() => document.body.dataset.examId || ''")
        log_step(f"当前题目 ID: {current_exam_id}", "DEBUG")
        
        await suite_page.click("#complete-exam-btn")
        log_step("已点击完成按钮")
        
        await suite_page.wait_for_function(
            "(initialId) => {\n"
            "  const btn = document.getElementById('complete-exam-btn');\n"
            "  const examId = document.body.dataset.examId || '';\n"
            "  return !!(btn && btn.disabled) || examId !== String(initialId || '');\n"
            "}",
            arg=current_exam_id,
            timeout=20000,
        )
        
        if index + 1 < total_count:
            log_step(f"等待下一篇练习加载...")
            try:
                await suite_page.wait_for_function(
                    "(initialId) => {\n"
                    "  const current = document.body.dataset.examId || '';\n"
                    "  return !!current && current !== String(initialId || '');\n"
                    "}",
                    arg=current_exam_id,
                    timeout=60000,
                )
                
                new_exam_id = await suite_page.evaluate("() => document.body.dataset.examId || ''")
                log_step(f"已切换到下一篇: {new_exam_id}", "SUCCESS")
                
            except PlaywrightTimeoutError:
                if suite_page.is_closed():
                    log_step("套题页面在切换时关闭", "WARNING")
                    return False
                log_step("等待下一篇超时", "ERROR")
                raise

            await suite_page.wait_for_function(
                "() => { const btn = document.getElementById('complete-exam-btn'); return btn && !btn.disabled; }",
                timeout=20000,
            )
            log_step(f"第 {index + 2} 篇练习已准备就绪", "SUCCESS")
        else:
            log_step("已完成所有练习", "SUCCESS")

        return True
        
    except Exception as e:
        log_step(f"完成练习时出错: {e}", "ERROR")
        raise


async def _verify_popstate_back_guard(suite_page: Page) -> bool:
    if suite_page.is_closed():
        return False
    current_exam_id = await suite_page.evaluate("() => document.body.dataset.examId || ''")
    current_url = suite_page.url
    if not current_exam_id:
        log_step("popstate 防退回校验前未读取到 examId", "ERROR")
        return False

    try:
        await suite_page.evaluate("() => window.history.back()")
        await suite_page.wait_for_timeout(1500)
    except Exception as error:
        log_step(f"触发 history.back() 失败: {error}", "ERROR")
        return False

    after_exam_id = await suite_page.evaluate("() => document.body.dataset.examId || ''")
    after_url = suite_page.url
    guarded = (after_exam_id == current_exam_id) and (after_url == current_url)
    if guarded:
        log_step("popstate 防退回校验通过", "SUCCESS")
    else:
        log_step(
            f"popstate 防退回校验失败: before=({current_exam_id}, {current_url}) after=({after_exam_id}, {after_url})",
            "ERROR",
        )
    return guarded


async def _count_practice_records(page: Page) -> int:
    return await page.evaluate(
        "async () => {\n"
        "  if (window.storage && typeof window.storage.get === 'function') {\n"
        "    const records = await window.storage.get('practice_records', []);\n"
        "    return Array.isArray(records) ? records.length : 0;\n"
        "  }\n"
        "  return document.querySelectorAll('#history-list .history-record-item').length;\n"
        "}"
    )


async def _suite_record_stats(page: Page) -> Dict[str, int]:
    return await page.evaluate(
        "async () => {\n"
        "  const toFiniteNumber = (value) => {\n"
        "    const num = Number(value);\n"
        "    return Number.isFinite(num) ? num : 0;\n"
        "  };\n"
        "  const parseTime = (value) => {\n"
        "    if (!value) return 0;\n"
        "    const ts = Date.parse(String(value));\n"
        "    return Number.isFinite(ts) ? ts : 0;\n"
        "  };\n"
        "  const isSuiteRecord = (record) => {\n"
        "    if (!record || typeof record !== 'object') return false;\n"
        "    if (record.suiteMode === true) return true;\n"
        "    const metadata = record.metadata && typeof record.metadata === 'object' ? record.metadata : {};\n"
        "    const frequency = String(record.frequency || metadata.frequency || '').trim().toLowerCase();\n"
        "    if (frequency === 'suite') return true;\n"
        "    const sessionId = String(record.sessionId || metadata.suiteSessionId || '').trim();\n"
        "    return sessionId.startsWith('suite_');\n"
        "  };\n"
        "  const latestTsFromRecord = (record) => {\n"
        "    if (!record || typeof record !== 'object') return 0;\n"
        "    const metadata = record.metadata && typeof record.metadata === 'object' ? record.metadata : {};\n"
        "    return Math.max(\n"
        "      parseTime(record.endTime),\n"
        "      parseTime(record.date),\n"
        "      parseTime(metadata.completedAt),\n"
        "      toFiniteNumber(record.timestamp)\n"
        "    );\n"
        "  };\n"
        "  if (!window.storage || typeof window.storage.get !== 'function') {\n"
        "    const fallbackCount = document.querySelectorAll('#history-list .history-record-item').length;\n"
        "    return { count: Number(fallbackCount) || 0, latestTs: 0 };\n"
        "  }\n"
        "  const records = await window.storage.get('practice_records', []);\n"
        "  if (!Array.isArray(records)) {\n"
        "    return { count: 0, latestTs: 0 };\n"
        "  }\n"
        "  let count = 0;\n"
        "  let latestTs = 0;\n"
        "  records.forEach((record) => {\n"
        "    if (!isSuiteRecord(record)) return;\n"
        "    count += 1;\n"
        "    const ts = latestTsFromRecord(record);\n"
        "    if (ts > latestTs) {\n"
        "      latestTs = ts;\n"
        "    }\n"
        "  });\n"
        "  return { count, latestTs };\n"
        "}"
    )


async def _wait_for_suite_record_growth(
    page: Page,
    baseline_record_count: int,
    baseline_suite_count: int,
    baseline_suite_latest_ts: int,
    timeout_ms: int = 30000,
) -> None:
    deadline = asyncio.get_event_loop().time() + (timeout_ms / 1000)
    while asyncio.get_event_loop().time() <= deadline:
        current_record_count = await _count_practice_records(page)
        current_suite_stats = await _suite_record_stats(page)
        current_suite_count = int(current_suite_stats.get("count") or 0)
        current_suite_latest_ts = int(current_suite_stats.get("latestTs") or 0)
        total_growth = current_record_count >= (baseline_record_count + 1)
        suite_growth = current_suite_count >= (baseline_suite_count + 1)
        suite_updated = current_suite_latest_ts > baseline_suite_latest_ts
        if total_growth or suite_growth or suite_updated:
            return
        await page.wait_for_timeout(250)
    raise AssertionError(
        "suite record did not grow within timeout: "
        f"records baseline={baseline_record_count}, suite baseline={baseline_suite_count}, latestTs baseline={baseline_suite_latest_ts}"
    )


async def _review_nav_state(page: Page):
    return await page.evaluate(
        "() => {\n"
        "  const bar = document.getElementById('review-nav-bar') || document.getElementById('practice-review-nav');\n"
        "  if (!bar) return null;\n"
        "  const next = bar.querySelector('button[data-review-dir=\"next\"], button[data-review-nav=\"next\"]');\n"
        "  const prev = bar.querySelector('button[data-review-dir=\"prev\"], button[data-review-nav=\"prev\"]');\n"
        "  const isHidden = !!(bar.style && bar.style.display === 'none');\n"
        "  return {\n"
        "    hidden: isHidden,\n"
        "    nextDisabled: !next || !!next.disabled,\n"
        "    prevDisabled: !prev || !!prev.disabled,\n"
        "    nextSelector: next ? (next.getAttribute('data-review-dir') ? '#review-nav-bar button[data-review-dir=\"next\"]' : '#practice-review-nav button[data-review-nav=\"next\"]') : '',\n"
        "    prevSelector: prev ? (prev.getAttribute('data-review-dir') ? '#review-nav-bar button[data-review-dir=\"prev\"]' : '#practice-review-nav button[data-review-nav=\"prev\"]') : ''\n"
        "  };\n"
        "}"
    )


async def _launch_chromium(p) -> Browser:
    """以 file:// 友好的参数启动 Chromium，并在崩溃时回退默认参数。"""
    try:
        return await p.chromium.launch(
            headless=True,
            args=["--allow-file-access-from-files"],
        )
    except Exception as e:
        log_step(f"Chromium 启动失败，回退默认参数: {e}", "WARNING")
        return await p.chromium.launch(headless=True)


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
    popstate_back_guard_ok = False

    log_step("=" * 80)
    log_step("开始套题练习流程测试 (E2E)")
    log_step("=" * 80)

    try:
        async with async_playwright() as p:
            log_step("启动 Chromium 浏览器...")
            browser: Browser = await _launch_chromium(p)
            context = await browser.new_context()

            context.on("page", lambda pg: _collect_console(pg, console_log))

            log_step(f"导航到: {INDEX_URL}")
            page = await context.new_page()
            await page.goto(INDEX_URL)
            
            await _ensure_app_ready(page)
            await _dismiss_overlays(page)

            log_step("校验首屏懒加载状态...")
            initial_browse_loaded = await _group_loaded(page, "browse-runtime")
            initial_practice_loaded = await _group_loaded(page, "practice-suite")
            log_step(f"首屏 group 状态: browse-runtime={initial_browse_loaded}, practice-suite={initial_practice_loaded}", "DEBUG")
            if initial_browse_loaded:
                raise AssertionError("browse-runtime should not be loaded on initial screen")
            if initial_practice_loaded:
                raise AssertionError("practice-suite should not be loaded on initial screen")
            log_step("首屏懒加载状态校验通过", "SUCCESS")

            log_step("切换到浏览视图并验证按需加载...")
            await _click_nav(page, "browse")
            await page.wait_for_function(
                "() => window.AppLazyLoader && window.AppLazyLoader.getStatus('browse-runtime').loaded === true",
                timeout=20000,
            )
            await page.wait_for_selector("#exam-list-container", timeout=15000)
            log_step("浏览模块首次按需加载成功", "SUCCESS")

            log_step("返回总览视图，准备套题测试...")
            await _click_nav(page, "overview")
            
            log_step("查找套题练习按钮...")
            start_button = page.locator("button[data-action='start-suite-mode']")
            await start_button.scroll_into_view_if_needed()
            log_step("套题练习按钮已就绪", "SUCCESS")
            await _preset_suite_preferences(
                page,
                mode="simulation",
                frequency_scope="all",
                auto_advance_after_submit=True,
            )

            log_step("启动套题练习...")
            async with page.expect_popup() as popup_wait:
                await start_button.click()
                await _select_suite_flow_mode(page, "simulation")
            suite_page = await popup_wait.value
            _collect_console(suite_page, console_log)
            log_step("套题练习窗口已打开", "SUCCESS")

            await page.wait_for_function(
                "() => window.AppLazyLoader && window.AppLazyLoader.getStatus('session-suite').loaded === true",
                timeout=20000,
            )
            await page.wait_for_function(
                "() => window.AppLazyLoader && window.AppLazyLoader.getStatus('practice-suite').loaded === true",
                timeout=20000,
            )
            log_step("套题触发后 session-suite/practice-suite 加载成功", "SUCCESS")

            log_step("开始完成 3 篇练习...")
            for idx in range(3):
                try:
                    should_continue = await _complete_passage(suite_page, 3, idx)
                except (PlaywrightTimeoutError, PlaywrightError) as e:
                    log_step(f"完成第 {idx + 1} 篇时出错: {e}", "ERROR")
                    if suite_page.is_closed():
                        log_step("套题页面已关闭，终止测试", "WARNING")
                        break
                    raise
                if not should_continue:
                    log_step(f"第 {idx + 1} 篇后终止", "WARNING")
                    break
                if idx == 0:
                    popstate_back_guard_ok = await _verify_popstate_back_guard(suite_page)
                    if not popstate_back_guard_ok:
                        raise AssertionError("popstate back guard failed: suite exam navigated away after history.back()")

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
                "() => {\n"
                "  const appRecords = window.app && window.app.state && window.app.state.practice\n"
                "    ? window.app.state.practice.records\n"
                "    : null;\n"
                "  if (Array.isArray(appRecords) && appRecords.length > 0) {\n"
                "    return true;\n"
                "  }\n"
                "  if (typeof window.getPracticeRecordsState === 'function') {\n"
                "    try {\n"
                "      const records = window.getPracticeRecordsState();\n"
                "      if (Array.isArray(records) && records.length > 0) {\n"
                "        return true;\n"
                "      }\n"
                "    } catch (_) {}\n"
                "  }\n"
                "  return false;\n"
                "}",
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

            record_count_before = await _count_practice_records(page)
            log_step(f"回放前记录数: {record_count_before}", "DEBUG")

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

            log_step("通过详情标题启动回放...")
            async with page.expect_popup(timeout=20000) as replay_popup_wait:
                await page.click("#practice-record-modal .record-summary .record-summary-replay-trigger")
            replay_page = await replay_popup_wait.value
            _collect_console(replay_page, console_log)
            await replay_page.wait_for_load_state("load")

            await replay_page.wait_for_function(
                "() => {\n"
                "  const results = document.getElementById('results');\n"
                "  if (!results || results.style.display === 'none') return false;\n"
                "  return results.querySelectorAll('tbody tr').length > 0 || results.textContent.includes('得分');\n"
                "}",
                timeout=30000,
            )
            await replay_page.wait_for_function(
                "() => !!(document.getElementById('review-nav-bar') || document.getElementById('practice-review-nav'))",
                timeout=30000,
            )
            await replay_page.wait_for_function(
                "() => {\n"
                "  const bar = document.getElementById('review-nav-bar') || document.getElementById('practice-review-nav');\n"
                "  const header = document.querySelector('body > header') || document.querySelector('header');\n"
                "  return !!(bar && header && header.contains(bar));\n"
                "}",
                timeout=30000,
            )
            await replay_page.wait_for_function(
                "() => {\n"
                "  const bar = document.getElementById('review-nav-bar') || document.getElementById('practice-review-nav');\n"
                "  const header = document.querySelector('body > header') || document.querySelector('header');\n"
                "  if (!bar || !header) return false;\n"
                "  const br = bar.getBoundingClientRect();\n"
                "  const hr = header.getBoundingClientRect();\n"
                "  const centerDelta = Math.abs((br.left + br.width / 2) - (hr.left + hr.width / 2));\n"
                "  return centerDelta <= Math.max(24, hr.width * 0.08);\n"
                "}",
                timeout=30000,
            )
            log_step("回放页已进入结算态并显示切题栏", "SUCCESS")

            explanation_state = await replay_page.evaluate(
                "() => {\n"
                "  const params = new URLSearchParams(window.location.search || '');\n"
                "  const examId = params.get('dataKey') || params.get('examId') || '';\n"
                "  const manifest = window.__READING_EXPLANATION_MANIFEST__ || {};\n"
                "  const hasManifestEntry = !!(examId && manifest[examId]);\n"
                "  const explanationCount = document.querySelectorAll('.reading-explanation-card, .reading-question-explanation-list').length;\n"
                "  const results = document.getElementById('results');\n"
                "  const hasResultsTable = !!(results && results.querySelectorAll('tbody tr').length > 0);\n"
                "  return { examId, hasManifestEntry, explanationCount, hasResultsTable };\n"
                "}"
            )
            if explanation_state.get("hasManifestEntry") and explanation_state.get("explanationCount", 0) <= 0:
                raise AssertionError(
                    f"Replay page missing explanation DOM for exam {explanation_state.get('examId')}"
                )
            if not explanation_state.get("hasResultsTable"):
                raise AssertionError("Replay page results table missing after explanation injection")
            log_step("讲解注入与结果表并存校验通过", "SUCCESS")

            readonly_state = await replay_page.evaluate(
                "() => {\n"
                "  const submit = document.querySelector('#submit-btn, [data-submit-suite], .suite-submit-btn, button[type=\"submit\"]');\n"
                "  const reset = document.querySelector('#reset-btn');\n"
                "  return {\n"
                "    submitDisabled: !submit || submit.disabled === true,\n"
                "    resetDisabled: !reset || reset.disabled === true\n"
                "  };\n"
                "}"
            )
            if not readonly_state.get("submitDisabled"):
                raise AssertionError("Replay page is not read-only: submit button is still enabled")
            log_step("只读态校验通过", "SUCCESS")

            nav_state = await replay_page.evaluate(
                "() => {\n"
                "  const bar = document.getElementById('review-nav-bar') || document.getElementById('practice-review-nav');\n"
                "  if (!bar) return null;\n"
                "  const next = bar.querySelector('button[data-review-dir=\"next\"], button[data-review-nav=\"next\"]');\n"
                "  return {\n"
                "    reviewIndex: Number.parseInt(bar.dataset.reviewIndex || '0', 10),\n"
                "    nextDisabled: !next || next.disabled,\n"
                "    selector: next ? (next.getAttribute('data-review-dir') ? '#review-nav-bar button[data-review-dir=\"next\"]' : '#practice-review-nav button[data-review-nav=\"next\"]') : ''\n"
                "  };\n"
                "}"
            )
            if nav_state and not nav_state.get("nextDisabled"):
                await replay_page.click(nav_state.get("selector"))
                await replay_page.wait_for_load_state("load", timeout=30000)
                await replay_page.wait_for_function(
                    "(prevIndex) => {\n"
                    "  const bar = document.getElementById('review-nav-bar') || document.getElementById('practice-review-nav');\n"
                    "  if (!bar) return false;\n"
                    "  const current = Number.parseInt(bar.dataset.reviewIndex || '0', 10);\n"
                    "  return Number.isFinite(current) && current !== Number(prevIndex);\n"
                    "}",
                    arg=nav_state.get("reviewIndex", 0),
                    timeout=30000,
                )
                log_step("回放左右切题校验通过", "SUCCESS")
            else:
                log_step("该记录仅一题或无下一题，跳过切题点击", "WARNING")

            replay_path = REPORT_DIR / "suite-practice-replay-final.png"
            await replay_page.screenshot(path=str(replay_path))
            log_step(f"已保存截图: {replay_path.name}", "SUCCESS")

            await replay_page.close()
            await page.wait_for_timeout(800)

            record_count_after = await _count_practice_records(page)
            if record_count_after != record_count_before:
                raise AssertionError(f"Replay should not create new records: before={record_count_before}, after={record_count_after}")
            log_step("回放不落库校验通过", "SUCCESS")

            # 手动回看模式专项：P1提交→next→P2作答→提交→next→P3作答→提交→next完成
            manual_record_count_before = record_count_after
            manual_suite_stats_before = await _suite_record_stats(page)
            manual_suite_count_before = int(manual_suite_stats_before.get("count") or 0)
            manual_suite_latest_ts_before = int(manual_suite_stats_before.get("latestTs") or 0)
            log_step("开始手动回看模式专项验证...")
            await _click_nav(page, "overview")
            await start_button.scroll_into_view_if_needed()
            await page.evaluate(
                "() => {\n"
                "  try {\n"
                "    localStorage.setItem('suite_flow_mode', 'stationary');\n"
                "    localStorage.setItem('suite_auto_advance_after_submit', 'false');\n"
                "  } catch (_) {}\n"
                "  if (!window.practiceConfig || typeof window.practiceConfig !== 'object') {\n"
                "    window.practiceConfig = {};\n"
                "  }\n"
                "  if (!window.practiceConfig.suite || typeof window.practiceConfig.suite !== 'object') {\n"
                "    window.practiceConfig.suite = {};\n"
                "  }\n"
                "  window.practiceConfig.suite.flowMode = 'stationary';\n"
                "  window.practiceConfig.suite.autoAdvanceAfterSubmit = false;\n"
                "}"
            )
            async with page.expect_popup(timeout=20000) as manual_popup_wait:
                await start_button.click()
                await _select_suite_flow_mode(page, "stationary")
            manual_suite_page = await manual_popup_wait.value
            _collect_console(manual_suite_page, console_log)
            await manual_suite_page.wait_for_load_state("load")
            await page.wait_for_function(
                "() => !!(window.practiceConfig && window.practiceConfig.suite && window.practiceConfig.suite.autoAdvanceAfterSubmit === false)",
                timeout=10000,
            )
            log_step("已切换到手动回看模式", "SUCCESS")

            manual_exam1 = await manual_suite_page.evaluate("() => document.body.dataset.examId || ''")
            if not manual_exam1:
                raise AssertionError("manual mode first exam id missing")
            await manual_suite_page.click("#complete-exam-btn")
            await manual_suite_page.wait_for_function(
                "() => { const btn = document.getElementById('complete-exam-btn'); return !!(btn && btn.disabled); }",
                timeout=20000,
            )
            await manual_suite_page.wait_for_function(
                "(expectedId) => (document.body.dataset.examId || '') === expectedId",
                arg=manual_exam1,
                timeout=15000,
            )
            nav_after_p1_submit = await _review_nav_state(manual_suite_page)
            if not nav_after_p1_submit or nav_after_p1_submit.get("hidden") or nav_after_p1_submit.get("nextDisabled"):
                raise AssertionError("manual mode P1 submit should show enabled next nav button")
            await manual_suite_page.click(nav_after_p1_submit["nextSelector"])
            await manual_suite_page.wait_for_function(
                "(oldId) => (document.body.dataset.examId || '') !== oldId",
                arg=manual_exam1,
                timeout=30000,
            )

            manual_exam2 = await manual_suite_page.evaluate("() => document.body.dataset.examId || ''")
            if not manual_exam2 or manual_exam2 == manual_exam1:
                raise AssertionError("manual mode next from P1 did not enter P2")
            p2_answering_state = await manual_suite_page.evaluate(
                "() => {\n"
                "  const submit = document.getElementById('submit-btn') || document.getElementById('complete-exam-btn');\n"
                "  const text = submit ? String(submit.textContent || '') : '';\n"
                "  return { enabled: !!(submit && !submit.disabled), text };\n"
                "}"
            )
            if (not p2_answering_state.get("enabled")) or ("回顾模式" in p2_answering_state.get("text", "")):
                raise AssertionError("manual mode P2 should be answering state, not settled review state")
            nav_on_p2_answering = await _review_nav_state(manual_suite_page)
            if not nav_on_p2_answering or nav_on_p2_answering.get("hidden"):
                raise AssertionError("manual mode P2 answering should keep review nav visible")

            await manual_suite_page.click("#complete-exam-btn")
            await manual_suite_page.wait_for_function(
                "() => { const btn = document.getElementById('complete-exam-btn'); return !!(btn && btn.disabled); }",
                timeout=20000,
            )
            await manual_suite_page.wait_for_function(
                "(expectedId) => (document.body.dataset.examId || '') === expectedId",
                arg=manual_exam2,
                timeout=15000,
            )
            nav_after_p2_submit = await _review_nav_state(manual_suite_page)
            if not nav_after_p2_submit or nav_after_p2_submit.get("hidden") or nav_after_p2_submit.get("nextDisabled"):
                raise AssertionError("manual mode P2 submit should keep next nav enabled")
            await manual_suite_page.click(nav_after_p2_submit["nextSelector"])
            await manual_suite_page.wait_for_function(
                "(oldId) => (document.body.dataset.examId || '') !== oldId",
                arg=manual_exam2,
                timeout=30000,
            )

            manual_exam3 = await manual_suite_page.evaluate("() => document.body.dataset.examId || ''")
            if not manual_exam3 or manual_exam3 == manual_exam2:
                raise AssertionError("manual mode next from P2 did not enter P3")
            p3_answering_state = await manual_suite_page.evaluate(
                "() => {\n"
                "  const submit = document.getElementById('submit-btn') || document.getElementById('complete-exam-btn');\n"
                "  const text = submit ? String(submit.textContent || '') : '';\n"
                "  return { enabled: !!(submit && !submit.disabled), text };\n"
                "}"
            )
            if (not p3_answering_state.get("enabled")) or ("回顾模式" in p3_answering_state.get("text", "")):
                raise AssertionError("manual mode P3 should be answering state before submit")

            await manual_suite_page.click("#complete-exam-btn")
            await manual_suite_page.wait_for_function(
                "() => { const btn = document.getElementById('complete-exam-btn'); return !!(btn && btn.disabled); }",
                timeout=20000,
            )
            await manual_suite_page.wait_for_function(
                "(expectedId) => (document.body.dataset.examId || '') === expectedId",
                arg=manual_exam3,
                timeout=15000,
            )
            nav_after_p3_submit = await _review_nav_state(manual_suite_page)
            if not nav_after_p3_submit or nav_after_p3_submit.get("nextDisabled"):
                raise AssertionError("manual mode last review should allow next for finalize")
            await manual_suite_page.click(nav_after_p3_submit["nextSelector"])

            if not manual_suite_page.is_closed():
                try:
                    await manual_suite_page.wait_for_event("close", timeout=15000)
                except PlaywrightTimeoutError:
                    log_step("手动模式收尾后窗口未自动关闭，继续检查记录落库", "WARNING")
                    try:
                        await manual_suite_page.close()
                    except Exception:
                        pass

            await _click_nav(page, "practice")
            await _wait_for_suite_record_growth(
                page,
                baseline_record_count=manual_record_count_before,
                baseline_suite_count=manual_suite_count_before,
                baseline_suite_latest_ts=manual_suite_latest_ts_before,
                timeout_ms=30000,
            )
            manual_record_count_after = await _count_practice_records(page)
            manual_suite_stats_after = await _suite_record_stats(page)
            manual_suite_count_after = int(manual_suite_stats_after.get("count") or 0)
            manual_suite_latest_ts_after = int(manual_suite_stats_after.get("latestTs") or 0)
            total_growth = manual_record_count_after >= (manual_record_count_before + 1)
            suite_growth = manual_suite_count_after >= (manual_suite_count_before + 1)
            suite_updated = manual_suite_latest_ts_after > manual_suite_latest_ts_before
            if not (total_growth or suite_growth or suite_updated):
                raise AssertionError(
                    "manual mode suite finalize did not persist/update suite record: "
                    f"records {manual_record_count_before}->{manual_record_count_after}, "
                    f"suiteRecords {manual_suite_count_before}->{manual_suite_count_after}, "
                    f"suiteLatestTs {manual_suite_latest_ts_before}->{manual_suite_latest_ts_after}"
                )
            log_step("手动回看模式专项验证通过", "SUCCESS")

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
        deprecated_facade_logs = [
            entry for entry in console_log
            if "deprecated persistent write via storage facade" in entry.text
        ]
        if deprecated_facade_logs:
            log_step("检测到 StorageFacade 噪音告警，视为失败", "ERROR")
            test_passed = False
        
        # 生成测试报告
        report = {
            "generatedAt": datetime.now().isoformat(),
            "duration": duration,
            "status": "pass" if test_passed else "fail",
            "deprecatedFacadeWarnings": len(deprecated_facade_logs),
            "checks": {
                "popstateBackGuard": bool(popstate_back_guard_ok),
            },
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
            if deprecated_facade_logs:
                log_step("\n检测到的 facade 噪音:", "ERROR")
                for entry in deprecated_facade_logs[:5]:
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
