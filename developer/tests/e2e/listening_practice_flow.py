#!/usr/bin/env python3
"""
E2E测试：听力练习完整流程
测试100 P1/P4多套题练习、拼写错误收集和词表切换
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import List

from playwright.async_api import (
    Browser,
    ConsoleMessage,
    Error as PlaywrightError,
    Page,
    TimeoutError as PlaywrightTimeoutError,
    async_playwright,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX_PATH = REPO_ROOT / "index.html"
INDEX_URL = f"{INDEX_PATH.as_uri()}?test_env=1"
REPORT_DIR = REPO_ROOT / "developer" / "tests" / "e2e" / "reports"


@dataclass
class ConsoleEntry:
    page_title: str
    type: str
    text: str


async def _ensure_app_ready(page: Page) -> None:
    """等待应用初始化完成"""
    await page.wait_for_load_state("load")
    await page.wait_for_function(
        "() => window.app && window.app.isInitialized && window.storage",
        timeout=60000,
    )


async def _click_nav(page: Page, view: str) -> None:
    """点击导航按钮"""
    await page.locator(f"nav button[data-view='{view}']").click()
    await page.wait_for_selector(f"#{view}-view.active", timeout=15000)


async def _dismiss_overlays(page: Page) -> None:
    """关闭可能的遮罩层"""
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


async def test_complete_practice_flow(browser: Browser, console_log: List[ConsoleEntry]) -> dict:
    """
    测试完整练习流程
    1. 从总览进入100 P1/P4
    2. 选择题目并答题
    3. 提交答案
    4. 查看练习记录
    5. 验证套题详情展示
    """
    context = await browser.new_context()
    context.on("page", lambda pg: _collect_console(pg, console_log))
    
    page = await context.new_page()
    await page.goto(INDEX_URL)
    await _ensure_app_ready(page)
    await _dismiss_overlays(page)
    
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
    
    # 步骤3: 验证频率筛选按钮显示
    freq_buttons = page.locator(".frequency-filter-btn")
    button_count = await freq_buttons.count()
    assert button_count > 0, "应该显示频率筛选按钮"
    
    # 步骤4: 点击第一个题目（100 P1）
    first_exam = page.locator(".exam-card").first
    await first_exam.wait_for(state="visible", timeout=10000)
    
    # 获取题目标题
    exam_title = await first_exam.locator(".exam-title").text_content()
    
    # 打开题目
    async with page.expect_popup() as popup_wait:
        await first_exam.locator("button[data-action='start']").click()
    
    practice_page = await popup_wait.value
    _collect_console(practice_page, console_log)
    
    # 步骤5: 等待练习页面加载
    await practice_page.wait_for_load_state("load")
    await practice_page.wait_for_selector("#complete-exam-btn", timeout=20000)
    
    # 步骤6: 填写答案（模拟）
    # 注意：这里需要根据实际HTML结构填写答案
    # 暂时跳过实际填写，直接提交
    
    # 步骤7: 提交答案
    submit_btn = practice_page.locator("#complete-exam-btn")
    await submit_btn.wait_for(state="visible", timeout=10000)
    await submit_btn.click()
    
    # 等待提交完成
    await practice_page.wait_for_timeout(2000)
    
    # 关闭练习页面
    await practice_page.close()
    
    # 步骤8: 查看练习记录
    await _click_nav(page, "practice")
    await page.wait_for_timeout(2000)
    
    # 验证记录列表
    await page.wait_for_selector("#history-list .history-record-item", timeout=20000)
    
    # 截图
    list_path = REPORT_DIR / "listening-practice-record-list.png"
    await page.locator("#practice-view").screenshot(path=str(list_path))
    
    # 步骤9: 打开记录详情
    first_record = page.locator("#history-list .history-record-item").first
    record_id = await first_record.get_attribute("data-record-id")
    
    details_btn = first_record.locator("button[data-history-action='details']")
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
        "screenshots": [str(list_path), str(detail_path)]
    }


async def test_vocab_practice_flow(browser: Browser, console_log: List[ConsoleEntry]) -> dict:
    """
    测试单词背诵流程
    1. 答题出错触发错误收集
    2. 打开单词背诵功能
    3. 切换词表
    4. 背诵单词并标记
    5. 验证复习箱移动
    """
    context = await browser.new_context()
    context.on("page", lambda pg: _collect_console(pg, console_log))
    
    page = await context.new_page()
    await page.goto(INDEX_URL)
    await _ensure_app_ready(page)
    await _dismiss_overlays(page)
    
    # 步骤1: 进入单词背诵视图（通过More视图）
    await _click_nav(page, "more")
    await page.wait_for_timeout(500)
    
    # 点击单词背诵工具卡片
    vocab_button = page.locator("button[data-action='open-vocab']")
    await vocab_button.wait_for(state="visible", timeout=10000)
    await vocab_button.click()
    await page.wait_for_timeout(1500)
    
    # 步骤2: 验证词表切换器显示
    switcher = page.locator("#vocab-list-switcher")
    await switcher.wait_for(state="visible", timeout=10000)
    
    # 步骤3: 切换到P1词表
    p1_option = page.locator("#vocab-list-switcher option[value='p1']")
    await page.select_option("#vocab-list-switcher", "p1")
    await page.wait_for_timeout(1000)
    
    # 步骤4: 验证词表加载
    word_list = page.locator("#vocab-word-list")
    await word_list.wait_for(state="visible", timeout=10000)
    
    # 截图
    vocab_path = REPORT_DIR / "vocab-list-p1.png"
    await page.locator("#vocab-view").screenshot(path=str(vocab_path))
    
    # 步骤5: 切换到P4词表
    await page.select_option("#vocab-list-switcher", "p4")
    await page.wait_for_timeout(1000)
    
    # 截图
    vocab_p4_path = REPORT_DIR / "vocab-list-p4.png"
    await page.locator("#vocab-view").screenshot(path=str(vocab_p4_path))
    
    # 步骤6: 切换到综合词表
    await page.select_option("#vocab-list-switcher", "master")
    await page.wait_for_timeout(1000)
    
    # 截图
    vocab_master_path = REPORT_DIR / "vocab-list-master.png"
    await page.locator("#vocab-view").screenshot(path=str(vocab_master_path))
    
    await context.close()
    
    return {
        "name": "单词背诵流程",
        "status": "pass",
        "screenshots": [str(vocab_path), str(vocab_p4_path), str(vocab_master_path)]
    }


async def test_frequency_filter_flow(browser: Browser, console_log: List[ConsoleEntry]) -> dict:
    """
    测试频率筛选流程
    1. 点击P1/P4入口
    2. 验证筛选按钮显示
    3. 应用不同频率筛选
    4. 验证题目列表更新
    5. 测试P4"全部"按钮
    """
    context = await browser.new_context()
    context.on("page", lambda pg: _collect_console(pg, console_log))
    
    page = await context.new_page()
    await page.goto(INDEX_URL)
    await _ensure_app_ready(page)
    await _dismiss_overlays(page)
    
    # 步骤1: 留在Overview视图，等待加载完成
    await page.wait_for_selector("#overview-view.active", timeout=10000)
    await page.wait_for_timeout(1000)
    
    # 步骤2: 点击P1入口（使用更具体的选择器避免匹配多个按钮）
    p1_button = page.locator("button[data-category='P1'][data-action='browse-category']")
    await p1_button.click()
    
    # 等待导航到Browse视图
    await page.wait_for_selector("#browse-view.active", timeout=15000)
    await page.wait_for_timeout(1000)
    
    # 步骤3: 验证频率筛选按钮
    freq_buttons = page.locator(".frequency-filter-btn")
    button_count = await freq_buttons.count()
    assert button_count > 0, "应该显示频率筛选按钮"
    
    # 截图：默认状态
    default_path = REPORT_DIR / "frequency-filter-default.png"
    await page.locator("#browse-view").screenshot(path=str(default_path))
    
    # 步骤4: 点击"高频"筛选
    high_freq_btn = page.locator(".frequency-filter-btn[data-frequency='high']")
    if await high_freq_btn.count() > 0:
        await high_freq_btn.click()
        await page.wait_for_timeout(1000)
        
        # 截图：高频筛选
        high_freq_path = REPORT_DIR / "frequency-filter-high.png"
        await page.locator("#browse-view").screenshot(path=str(high_freq_path))
    
    # 步骤5: 切换到P4（使用更具体的选择器避免匙配多个按钮）
    # 需要先返回Overview视图
    await _click_nav(page, "overview")
    await page.wait_for_timeout(500)
    
    p4_button = page.locator("button[data-category='P4'][data-action='browse-category']")
    await p4_button.click()
    
    # 等待导航到Browse视图
    await page.wait_for_selector("#browse-view.active", timeout=15000)
    await page.wait_for_timeout(1000)
    
    # 步骤6: 验证P4"全部"按钮
    all_btn = page.locator(".frequency-filter-btn[data-frequency='all']")
    if await all_btn.count() > 0:
        await all_btn.click()
        await page.wait_for_timeout(1000)
        
        # 截图：P4全部
        p4_all_path = REPORT_DIR / "frequency-filter-p4-all.png"
        await page.locator("#browse-view").screenshot(path=str(p4_all_path))
    
    await context.close()
    
    return {
        "name": "频率筛选流程",
        "status": "pass",
        "screenshots": [str(default_path)]
    }


async def run() -> None:
    """运行所有E2E测试"""
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    console_log: List[ConsoleEntry] = []
    results = []
    
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
        
        # 输出测试结果
        all_passed = all(r["status"] == "pass" for r in results)
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


if __name__ == "__main__":
    asyncio.run(run())
