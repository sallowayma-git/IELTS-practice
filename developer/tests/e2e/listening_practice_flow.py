#!/usr/bin/env python3
"""
E2E测试：听力练习完整流程
测试100 P1/P4多套题练习、拼写错误收集和词表切换
"""

from __future__ import annotations

import asyncio
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List

from playwright.async_api import (
    Browser,
    ConsoleMessage,
    Error as PlaywrightError,
    Page,
    TimeoutError as PlaywrightTimeoutError,
    async_playwright,
)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX_PATH = REPO_ROOT / "index.html"
INDEX_URL = INDEX_PATH.as_uri()
REPORT_DIR = REPO_ROOT / "developer" / "tests" / "e2e" / "reports"
CHROME_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/138.0.0.0 Safari/537.36"
)


@dataclass
class ConsoleEntry:
    page_title: str
    type: str
    text: str


async def _ensure_app_ready(page: Page) -> None:
    """等待应用初始化完成"""
    await page.wait_for_load_state("load")
    await page.wait_for_function("() => !!window.AppData", timeout=60000)
    await page.evaluate("async () => { await window.AppData.ready; }")
    await page.wait_for_function("() => window.app?.isInitialized === true", timeout=60000)


async def _click_nav(page: Page, view: str) -> None:
    """点击导航按钮"""
    await page.locator(f"nav button[data-view='{view}']").click()
    await page.wait_for_selector(f"#{view}-view.active", timeout=15000)


async def _dismiss_overlays(page: Page) -> None:
    """关闭可能的遮罩层"""
    accepted = await page.evaluate(
        """async () => {
            if (!window.LicenseModal || typeof window.LicenseModal.accept !== 'function') {
                throw new Error('LicenseModal.accept is unavailable');
            }
            return window.LicenseModal.accept();
        }"""
    )
    if not accepted:
        raise RuntimeError("GPL license consent was not committed")
    await page.wait_for_function(
        "() => !document.getElementById('license-modal')?.classList.contains('show')",
        timeout=5000,
    )

    overlay = page.locator("#library-loader-overlay")
    if await overlay.count():
        try:
            await overlay.wait_for(state="visible", timeout=2000)
            close_btn = overlay.locator("[data-library-action='close']")
            if await close_btn.count():
                await close_btn.first.click()
                await overlay.wait_for(state="detached", timeout=5000)
        except Exception:
            pass


def _collect_console(page: Page, store: List[ConsoleEntry]) -> None:
    """收集控制台日志"""
    def _handler(msg: ConsoleMessage) -> None:
        store.append(ConsoleEntry(page_title=page.url, type=msg.type, text=msg.text))
    page.on("console", _handler)


async def _get_exam_titles(page: Page) -> List[str]:
    """获取当前题目列表的标题（兼容 exam-card / exam-item）"""
    modern_titles = await page.locator(".exam-card .exam-title").all_text_contents()
    modern_titles = [t.strip() for t in modern_titles if t and t.strip()]
    if modern_titles:
        return modern_titles

    # 兼容旧版 exam-item 结构
    return await page.evaluate(
        "() => Array.from(document.querySelectorAll('.exam-item'))\n"
        "  .map(el => {\n"
        "    const titleEl = el.querySelector('.exam-title') || el.querySelector('h4');\n"
        "    return (titleEl?.textContent || '').trim();\n"
        "  })\n"
        "  .filter(Boolean)"
    )


async def _get_filter_buttons_state(page: Page) -> List[Dict[str, Any]]:
    """收集筛选按钮状态"""
    return await page.evaluate(
        "() => Array.from(document.querySelectorAll('#browse-frequency-filter-buttons button')).map(btn => ({"
        "  text: (btn.textContent || '').trim(),"
        "  filterId: btn.dataset.frequencyFilter || null,"
        "  active: btn.getAttribute('aria-pressed') === 'true'"
        "}))"
    )


async def _write_failure_report(
    page: Page,
    console_log: List[ConsoleEntry],
    report_path: Path,
    error_message: str | None = None,
    snapshots: list | None = None,
) -> None:
    """写入失败调试信息"""
    try:
        report = {
            "pageUrl": page.url,
            "activeView": await page.evaluate(
                "() => document.querySelector('.view.active')?.id || null"
            ),
            "filterButtons": await _get_filter_buttons_state(page),
            "examTitles": await _get_exam_titles(page),
            "consoleErrors": [
                asdict(entry)
                for entry in console_log
                if entry.type and entry.type.lower() == "error"
            ],
        }
        if error_message:
            report["error"] = error_message
        if snapshots:
            report["snapshots"] = snapshots
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    except Exception as report_error:
        print(f"[FrequencyTest] 无法写入失败报告: {report_error}")


async def _click_filter_and_wait(
    page: Page, filter_id: str, previous_titles: List[str]
) -> List[str]:
    """点击筛选按钮并等待列表发生变化"""
    text_map = {
        "all": "全部",
        "ultra-high": "超高频",
        "high": "高频",
        "medium": "中频",
        "low": "低频",
    }

    if filter_id == "all":
        button = page.locator(
            "#browse-frequency-filter-buttons button[aria-pressed='true']"
        )
    else:
        button = page.locator(
            f"#browse-frequency-filter-buttons button[data-frequency-filter='{filter_id}']"
        )

    if not await button.count():
        label = text_map.get(filter_id, "")
        if label:
            button = page.locator("#browse-frequency-filter-buttons button", has_text=label)

    if not await button.count():
        raise AssertionError(f"未找到筛选按钮: {filter_id}")

    await button.first.click()

    await page.wait_for_function(
        "(prev) => {\n"
        "  const modernTitles = Array.from(document.querySelectorAll('.exam-card .exam-title'))\n"
        "    .map(el => (el.textContent || '').trim())\n"
        "    .filter(Boolean);\n"
        "  const legacyTitles = Array.from(document.querySelectorAll('.exam-item'))\n"
        "    .map(el => {\n"
        "      const titleEl = el.querySelector('.exam-title') || el.querySelector('h4');\n"
        "      return (titleEl?.textContent || '').trim();\n"
        "    })\n"
        "    .filter(Boolean);\n"
        "  const titles = modernTitles.length ? modernTitles : legacyTitles;\n"
        "  if (!titles.length) return false;\n"
        "  if (titles.length !== prev.length) return true;\n"
        "  return titles.some((t, i) => t !== prev[i]);\n"
        "}",
        arg=previous_titles,
        timeout=15000,
    )

    await page.wait_for_timeout(300)
    return await _get_exam_titles(page)


async def test_complete_practice_flow(browser: Browser, console_log: List[ConsoleEntry]) -> dict:
    """
    测试完整练习流程
    1. 从总览进入100 P1/P4
    2. 选择题目并答题
    3. 提交答案
    4. 查看练习记录
    5. 验证套题详情展示
    """
    context = await browser.new_context(user_agent=CHROME_UA)
    context.on("page", lambda pg: _collect_console(pg, console_log))
    
    page = await context.new_page()
    await page.goto(INDEX_URL)
    await _ensure_app_ready(page)
    await _dismiss_overlays(page)
    await page.evaluate("async () => window.AppLazyLoader.ensureGroup('practice-suite')")
    await page.wait_for_function(
        "() => window.app?.components?.practiceRecorder?.constructor?.name === 'PracticeRecorder'"
        " && window.app.components.practiceRecorder.isFallback !== true",
        timeout=10000,
    )
    production_state = await page.evaluate(
        """() => ({
            testEnvironment: !!(window.EnvironmentDetector
                && window.EnvironmentDetector.isInTestEnvironment()),
            recorderName: window.app?.components?.practiceRecorder?.constructor?.name || '',
            recorderFallback: !!window.app?.components?.practiceRecorder?.isFallback,
            userAgent: navigator.userAgent
        })"""
    )
    if production_state["testEnvironment"]:
        raise AssertionError("Listening E2E must not run in test_env")
    if production_state["recorderName"] != "PracticeRecorder" or production_state["recorderFallback"]:
        raise AssertionError(f"Listening E2E requires the real PracticeRecorder: {production_state}")
    
    # 步骤1: 留在Overview视图，等待加载完成
    await page.wait_for_selector("#overview-view.active", timeout=10000)
    await page.wait_for_timeout(1000)
    
    # 步骤2: 点击P1入口（使用更具体的选择器避免匹配多个按钮）
    p1_button = page.locator("button[data-category='P1'][data-action='browse-category']")
    await p1_button.wait_for(state="visible", timeout=10000)
    await p1_button.click()
    
    # 等待导航到Browse视图
    await page.wait_for_selector("#browse-view.active", timeout=15000)
    await page.wait_for_timeout(1000)
    
    # 步骤3: 选择一个具备统一 HTML 练习页的 P1 题目。题库列表可能同时
    # 包含 PDF-only 条目，不能用列表第一项来推断练习页能力。
    exam = await page.evaluate(
        """async () => {
            const index = await window.resolveActiveLibraryIndex();
            const list = Array.isArray(index) ? index : (index && index.exams) || [];
            return list.find((item) => item?.id === 'p1-high-01' && item.hasHtml !== false)
                || list.find((item) => item?.category === 'P1' && item.hasHtml !== false)
                || null;
        }"""
    )
    if not exam or not exam.get("id"):
        raise AssertionError("P1 题库中没有可用于完整流程的 HTML 题目")
    exam_id = exam["id"]
    exam_title = exam.get("title") or exam_id

    start_button = page.locator(
        f"[data-exam-id='{exam_id}'] button[data-action='start']"
    ).first
    async with page.expect_popup() as popup_wait:
        if await start_button.count():
            await start_button.evaluate("node => node.click()")
        else:
            await page.evaluate(
                "examId => window.app.openExam(examId, { practiceMode: 'single' })",
                exam_id,
            )
    
    practice_page = await popup_wait.value
    _collect_console(practice_page, console_log)
    
    # 步骤5: 等待练习页面加载
    await practice_page.wait_for_load_state("load")
    await practice_page.wait_for_function(
        "() => location.href.includes('reading-practice-unified.html')",
        timeout=20000,
    )
    await page.wait_for_function(
        "examId => window.app?.examWindows?.get?.(examId)?.dataCollectorReady === true",
        arg=exam_id,
        timeout=20000,
    )
    await practice_page.wait_for_selector("#timer", state="visible", timeout=15000)
    await practice_page.wait_for_selector("#submit-btn", timeout=20000)
    await practice_page.wait_for_timeout(1100)
    
    # 步骤6: 填写答案（模拟）
    # 注意：这里需要根据实际HTML结构填写答案
    # 暂时跳过实际填写，直接提交
    
    # 步骤7: 提交答案
    submit_btn = practice_page.locator("#submit-btn")
    await submit_btn.wait_for(state="visible", timeout=10000)
    await submit_btn.click()
    # 给子页桥接消息与父页 IndexedDB 事务留出完整的提交窗口。仅看到
    # receipt 还不等于事务已经可供历史视图读取。
    await page.wait_for_timeout(1800)
    synthetic_hits = [
        entry.text
        for entry in console_log
        if "合成数据保存" in entry.text
        or "测试环境启用合成" in entry.text
        or "synthetic session" in entry.text.lower()
    ]
    if synthetic_hits:
        raise AssertionError(f"Listening E2E detected synthetic persistence: {synthetic_hits[0]}")
    
    # 关闭练习页面
    if not practice_page.is_closed():
        await practice_page.close()
    
    # 步骤8: 查看练习记录
    await _click_nav(page, "practice")
    await page.wait_for_function(
        """async (targetExamId) => {
            const records = await window.AppData.practice.list({ projection: 'light' });
            return records.some(record => String(record?.examId || '') === targetExamId);
        }""",
        arg=exam_id,
        timeout=30000,
    )
    persistence = await page.evaluate(
        """async (targetExamId) => {
            const records = await window.AppData.practice.list({ projection: 'light' });
            return {
                recordCount: records.length,
                targetCount: records.filter(record => String(record?.examId || '') === targetExamId).length,
                hasReceipt: Array.from(window.app?.examWindows?.values?.() || [])
                    .some((info) => info && info.practiceSubmitReceipts
                        && Object.keys(info.practiceSubmitReceipts).length > 0)
            };
        }""",
        exam_id,
    )
    await page.evaluate(
        "async () => window.syncPracticeRecords({ forceRender: true, mode: 'summary' })"
    )
    
    # 验证记录列表
    await page.wait_for_selector("#history-list .history-record-item", timeout=20000)
    
    # 截图
    list_path = REPORT_DIR / "listening-practice-record-list.png"
    await page.locator("#practice-view").screenshot(path=str(list_path))
    
    # 步骤9: 打开记录详情
    first_record = page.locator("#history-list .history-record-item").first
    record_id = await first_record.get_attribute("data-record-id")
    
    details_btn = first_record.locator("[data-record-action='details']")
    await details_btn.click()
    
    # 等待详情弹窗
    await page.wait_for_selector("#practice-record-modal.modal-overlay.show", timeout=15000)
    
    # 截图
    detail_path = REPORT_DIR / "listening-practice-record-detail.png"
    await page.locator("#practice-record-modal .modal-container").screenshot(path=str(detail_path))
    
    await context.close()
    
    return {
        "name": "完整练习流程",
        "status": "pass",
        "examTitle": exam_title,
        "recordId": record_id,
        "productionState": production_state,
        "persistence": persistence,
        "syntheticHits": synthetic_hits,
        "screenshots": [str(list_path), str(detail_path)]
    }


async def test_vocab_practice_flow(browser: Browser, console_log: List[ConsoleEntry]) -> dict:
    """
    测试移动端 file:// 单词背诵与音标流程
    """
    context = await browser.new_context(
        user_agent=CHROME_UA,
        viewport={"width": 390, "height": 844},
    )
    context.on("page", lambda pg: _collect_console(pg, console_log))
    page_errors: List[str] = []

    page = await context.new_page()
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    await page.goto(INDEX_URL)
    await _ensure_app_ready(page)
    await _dismiss_overlays(page)

    # 模拟已有用户：启动后只应补充缺失音标，原始字段必须保持不变。
    seeded = await page.evaluate(
        """async () => {
            const word = {
                id: 'e2e-existing-emperor',
                word: 'emperor',
                meaning: 'n. 皇帝；君主',
                example: 'The emperor led the empire.',
                note: 'keep this note',
                easeFactor: 2.2,
                interval: 7,
                repetitions: 3,
                correctCount: 4,
                createdAt: '2026-07-01T00:00:00.000Z',
                updatedAt: '2026-08-01T00:00:00.000Z',
                futureField: { keep: true }
            };
            await window.AppData.vocab.saveWords([word]);
            await window.AppData.vocab.patchConfig({ activeListId: 'default', dailyNew: 20 });
            return word;
        }"""
    )

    # 进入单词背诵视图（通过 More 视图），懒加载 bundle 后等待真实识别卡。
    await _click_nav(page, "more")
    vocab_button = page.locator("button[data-action='open-vocab']")
    await vocab_button.wait_for(state="visible", timeout=10000)
    await vocab_button.click()

    vocab_view = page.locator("#vocab-view")
    await vocab_view.wait_for(state="visible", timeout=10000)
    await page.locator(".vocab-topbar").wait_for(state="visible", timeout=5000)
    recognition = page.locator(".vocab-card--recognition")
    await recognition.wait_for(state="visible", timeout=30000)

    persisted = await page.evaluate(
        """async () => {
            const words = await window.AppData.vocab.listWords();
            return words.find((word) => word.id === 'e2e-existing-emperor');
        }"""
    )
    for field in (
        "id", "word", "meaning", "example", "note", "easeFactor", "interval",
        "repetitions", "correctCount", "createdAt", "updatedAt", "futureField",
    ):
        if persisted.get(field) != seeded.get(field):
            raise AssertionError(f"phonetic backfill changed existing field: {field}")
    phonetic_value = str(persisted.get("phonetic") or "").strip()
    if not phonetic_value or phonetic_value.startswith("/") or phonetic_value.endswith("/"):
        raise AssertionError("existing-user backfill did not persist a slash-free phonetic")

    phonetic = recognition.locator(".vocab-card__phonetic")
    await phonetic.wait_for(state="visible", timeout=5000)
    visible_value = await phonetic.locator(
        "span:not([aria-hidden='true']):not(.visually-hidden)"
    ).text_content()
    accessible_label = await phonetic.locator(".visually-hidden").text_content()
    decorative_count = await phonetic.locator("span[aria-hidden='true']").count()
    if (visible_value or "").strip() != phonetic_value:
        raise AssertionError("recognition phonetic does not match the persisted value")
    if (accessible_label or "").strip() != "音标：" or decorative_count != 2:
        raise AssertionError("recognition phonetic is missing its accessible Chinese label")

    visual_metrics = await page.evaluate(
        """() => {
            const el = document.querySelector('.vocab-card__phonetic');
            const card = document.querySelector('.vocab-card--recognition');
            const rect = el.getBoundingClientRect();
            const parse = (value) => (value.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
            const luminance = (rgb) => {
                const channels = rgb.map((value) => {
                    const part = value / 255;
                    return part <= 0.03928 ? part / 12.92 : Math.pow((part + 0.055) / 1.055, 2.4);
                });
                return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
            };
            const contrast = (foreground, background) => {
                const a = luminance(foreground);
                const b = luminance(background);
                return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
            };
            const initialColor = getComputedStyle(el).color;
            const foreground = parse(initialColor);
            const endpointRatios = [
                contrast(foreground, [255, 250, 242]),
                contrast(foreground, [242, 226, 204])
            ];
            document.documentElement.setAttribute('data-theme', 'blue');
            document.body.classList.add('theme-blue', 'blue-dark-mode');
            return {
                inViewport: rect.left >= -1 && rect.right <= window.innerWidth + 1,
                wrapsWithoutOverflow: el.scrollWidth <= el.clientWidth + 1,
                cardWithinViewport: card.getBoundingClientRect().right <= window.innerWidth + 1,
                minContrast: Math.min(...endpointRatios),
                initialColor,
                themedColor: getComputedStyle(el).color
            };
        }"""
    )
    if not all(
        visual_metrics[key]
        for key in ("inViewport", "wrapsWithoutOverflow", "cardWithinViewport")
    ):
        raise AssertionError(f"mobile phonetic layout overflowed: {visual_metrics}")
    if visual_metrics["minContrast"] < 4.5:
        raise AssertionError(f"phonetic contrast is below WCAG AA: {visual_metrics}")
    if visual_metrics["initialColor"] != visual_metrics["themedColor"]:
        raise AssertionError(f"theme overrode Vocabulary phonetic contrast: {visual_metrics}")

    headword = (await recognition.locator(".vocab-card__word").text_content() or "").strip()
    await recognition.locator("button[data-action='recognize-good']").click()
    spelling = page.locator(".vocab-card--spelling")
    await spelling.wait_for(state="visible", timeout=5000)
    spelling_markup = await spelling.inner_html()
    if (
        await spelling.locator(".vocab-card__phonetic, .vocab-feedback__phonetic").count()
        or phonetic_value in spelling_markup
        or "音标" in spelling_markup
    ):
        raise AssertionError("spelling stage exposed the phonetic hint")

    await spelling.locator("input[name='answer']").fill(headword)
    await spelling.locator("button[data-action='submit-spelling']").click()
    feedback = page.locator(".vocab-card--feedback")
    await feedback.wait_for(state="visible", timeout=10000)
    feedback_data = await feedback.evaluate(
        """(card) => {
            const rows = Array.from(card.querySelectorAll('.vocab-feedback__details > div'));
            const row = rows.find((candidate) => candidate.querySelector('dt')?.textContent.trim() === '音标');
            return {
                hasRow: !!row,
                value: row?.querySelector('.vocab-feedback__phonetic span:not([aria-hidden="true"])')?.textContent.trim() || ''
            };
        }"""
    )
    if not feedback_data["hasRow"] or feedback_data["value"] != phonetic_value:
        raise AssertionError("feedback did not render the labeled phonetic detail")
    if page_errors:
        raise AssertionError(f"Vocabulary flow emitted page errors: {page_errors}")

    vocab_path = REPORT_DIR / "vocab-view-loaded.png"
    await page.locator("#vocab-view").screenshot(path=str(vocab_path))

    await context.close()

    return {
        "name": "单词背诵音标流程",
        "status": "pass",
        "phonetic": phonetic_value,
        "contrast": visual_metrics["minContrast"],
        "screenshots": [str(vocab_path)]
    }


async def test_frequency_filter_flow(browser: Browser, console_log: List[ConsoleEntry]) -> dict:
    """
    测试频率筛选流程
    1. 点击P1入口
    2. 验证筛选按钮显示
    3. 应用不同频率筛选
    4. 验证题目列表更新
    5. 清除筛选并验证完整列表恢复
    """
    debug_report_path = REPORT_DIR / "frequency-filter-debug.json"
    if debug_report_path.exists():
        debug_report_path.unlink()

    context = await browser.new_context(user_agent=CHROME_UA)
    context.on("page", lambda pg: _collect_console(pg, console_log))

    page = await context.new_page()

    try:
        await page.goto(INDEX_URL)
        await _ensure_app_ready(page)
        await _dismiss_overlays(page)

        text_to_filter_id = {
            "全部": "all",
            "超高频": "ultra-high",
            "高频": "high",
            "中频": "medium",
            "低频": "low",
        }

        # 步骤1: 留在Overview视图，等待加载完成
        await page.wait_for_selector("#overview-view.active", timeout=10000)
        await page.wait_for_timeout(1000)

        # 步骤2: 点击P1入口，进入频率模式
        p1_button = page.locator("button[data-category='P1'][data-action='browse-category']")
        await p1_button.click()

        await page.wait_for_selector("#browse-view.active", timeout=15000)
        await page.wait_for_function(
            "() => window.getCurrentCategory?.() === 'P1'"
            " && window.getCurrentExamType?.() === 'reading'",
            timeout=15000,
        )
        await page.wait_for_selector("#browse-frequency-filter-buttons button", timeout=15000)
        await page.wait_for_selector(".exam-card, .exam-item", timeout=20000)
        await page.wait_for_timeout(800)

        # 记录默认题目数
        default_titles = await _get_exam_titles(page)
        if not default_titles:
            raise AssertionError("未获取到默认题目列表")
        default_count = len(default_titles)

        default_path = REPORT_DIR / "frequency-filter-default.png"
        await page.locator("#browse-view").screenshot(path=str(default_path))

        # 依次尝试高频/中频/低频（缺少则回退到超高频）
        filter_buttons = await _get_filter_buttons_state(page)
        available_filters = []
        for btn in filter_buttons:
            fid = btn.get("filterId") or text_to_filter_id.get(btn.get("text", ""))
            if fid:
                available_filters.append(fid)
        sequence = [
            fid for fid in ["high", "medium", "low", "ultra-high"] if fid in available_filters
        ]

        if len(sequence) < 2:
            raise AssertionError("频率筛选按钮不足，无法验证列表变化")

        previous_titles = default_titles
        changes = []
        for filter_id in sequence:
            new_titles = await _click_filter_and_wait(page, filter_id, previous_titles)
            if new_titles == previous_titles:
                raise AssertionError(f"筛选 {filter_id} 后题目列表未更新")
            changes.append({"filter": filter_id, "count": len(new_titles)})
            previous_titles = new_titles

        # 当前 UI 通过再次点击激活的频率 chip 表示“全部”。
        all_titles = await _click_filter_and_wait(page, "all", previous_titles)

        if len(all_titles) < len(previous_titles) or set(all_titles) != set(default_titles):
            raise AssertionError("点击全部后题目数未恢复")

        all_path = REPORT_DIR / "frequency-filter-all.png"
        await page.locator("#browse-view").screenshot(path=str(all_path))

        return {
            "name": "频率筛选流程",
            "status": "pass",
            "defaultCount": default_count,
            "total": len(all_titles),
            "changes": changes,
            "screenshots": [str(default_path), str(all_path)],
        }
    except Exception as exc:
        await _write_failure_report(page, console_log, debug_report_path, str(exc))
        raise
    finally:
        await context.close()


async def run() -> bool:
    """运行所有E2E测试，返回是否全部通过"""
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    console_log: List[ConsoleEntry] = []
    results = []
    
    all_passed = False
    try:
        async with async_playwright() as p:
            browser: Browser = await p.chromium.launch(headless=True)
            
            # 测试1: 完整练习流程
            try:
                result1 = await test_complete_practice_flow(browser, console_log)
                results.append(result1)
            except Exception as e:
                results.append({
                    "name": "完整练习流程",
                    "status": "fail",
                    "error": str(e)
                })
            
            # 测试2: 单词背诵流程
            try:
                result2 = await test_vocab_practice_flow(browser, console_log)
                results.append(result2)
            except Exception as e:
                results.append({
                    "name": "单词背诵流程",
                    "status": "fail",
                    "error": str(e)
                })
            
            # 测试3: 频率筛选流程
            try:
                result3 = await test_frequency_filter_flow(browser, console_log)
                results.append(result3)
            except Exception as e:
                results.append({
                    "name": "频率筛选流程",
                    "status": "fail",
                    "error": str(e)
                })
            
            await browser.close()
    finally:
        if console_log:
            print("Captured console messages:")
            for entry in console_log:
                print(f"[{entry.type.upper()}] {entry.page_title}: {entry.text}")
        
        # 输出测试结果（无结果视为失败，避免 all([]) == True 的假绿）
        all_passed = bool(results) and all(r["status"] == "pass" for r in results)
        print(f"\n{'='*60}")
        print(f"E2E测试完成")
        print(f"{'='*60}")
        for result in results:
            status_icon = "✓" if result["status"] == "pass" else "✗"
            print(f"{status_icon} {result['name']}: {result['status']}")
            if result["status"] == "fail":
                print(f"  错误: {result.get('error', 'Unknown error')}")
        print(f"{'='*60}")
        print(f"总计: {len(results)} 个测试")
        print(f"通过: {sum(1 for r in results if r['status'] == 'pass')} 个")
        print(f"失败: {sum(1 for r in results if r['status'] == 'fail')} 个")
        print(f"{'='*60}\n")
    return all_passed


if __name__ == "__main__":
    raise SystemExit(0 if asyncio.run(run()) else 1)
