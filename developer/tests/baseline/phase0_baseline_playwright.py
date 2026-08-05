#!/usr/bin/env python3
"""
Phase 0 基线测试 - Playwright 版本
用途：在 file:// 协议下自动化测试并记录基线日志
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any

from playwright.async_api import (
    async_playwright,
    Browser,
    Page,
    ConsoleMessage,
    TimeoutError as PlaywrightTimeoutError,
)

# 项目路径配置
REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX_PATH = REPO_ROOT / "index.html"
INDEX_URL = f"{INDEX_PATH.as_uri()}"
LOG_DIR = REPO_ROOT / "developer" / "logs"
REPORT_DIR = REPO_ROOT / "developer" / "tests" / "baseline" / "reports"


class Phase0BaselineTest:
    """阶段0基线测试类"""
    
    def __init__(self):
        self.browser: Browser | None = None
        self.page: Page | None = None
        self.console_logs: List[Dict[str, Any]] = []
        self.test_results: List[Dict[str, Any]] = []
        self.start_time = datetime.now()
        
    def log_result(self, name: str, passed: bool, detail: str | Dict[str, Any]) -> None:
        """记录测试结果"""
        result = {
            "name": name,
            "status": "pass" if passed else "fail",
            "detail": detail,
            "timestamp": datetime.now().isoformat()
        }
        self.test_results.append(result)
        
        status_icon = "✅" if passed else "❌"
        print(f"{status_icon} {name}: {detail if isinstance(detail, str) else json.dumps(detail, ensure_ascii=False)}")
    
    def handle_console(self, msg: ConsoleMessage) -> None:
        """处理控制台消息"""
        log_entry = {
            "type": msg.type,
            "text": msg.text,
            "timestamp": datetime.now().isoformat(),
            "location": msg.location if msg.location else None
        }
        self.console_logs.append(log_entry)
        
        # 打印重要日志
        if msg.type in ["error", "warning"]:
            print(f"[Console {msg.type.upper()}] {msg.text}")
    
    async def setup(self) -> None:
        """初始化浏览器"""
        print("🚀 初始化 Playwright...")
        playwright = await async_playwright().start()
        
        self.browser = await playwright.chromium.launch(
            headless=True,
            args=[
                '--disable-web-security',
                '--allow-file-access-from-files'
            ]
        )
        
        context = await self.browser.new_context(
            viewport={'width': 1920, 'height': 1080}
        )
        
        self.page = await context.new_page()
        self.page.on("console", self.handle_console)
        
        print("✅ Playwright 初始化成功")
    
    async def teardown(self) -> None:
        """清理资源"""
        if self.browser:
            await self.browser.close()
            print("🔚 浏览器已关闭")
    
    async def test_page_load(self) -> bool:
        """测试1: 页面加载"""
        print("\n" + "=" * 60)
        print("测试1: 页面加载与启动屏幕")
        print("=" * 60)
        
        try:
            # 加载页面
            await self.page.goto(INDEX_URL, wait_until="load", timeout=30000)
            self.log_result("页面加载", True, f"成功加载 {INDEX_URL}")
            
            # 等待启动屏幕显示
            try:
                await self.page.wait_for_selector("#boot-overlay", state="visible", timeout=5000)
                self.log_result("启动屏幕显示", True, "Boot Screen 正常显示")
            except PlaywrightTimeoutError:
                self.log_result("启动屏幕显示", False, "未检测到启动屏幕")
            
            # 等待启动屏幕消失
            try:
                await self.page.wait_for_selector("#boot-overlay", state="hidden", timeout=15000)
                self.log_result("启动屏幕消失", True, "Boot Screen 正常隐藏")
            except PlaywrightTimeoutError:
                self.log_result("启动屏幕消失", False, "启动屏幕未在预期时间内隐藏")
                return False
            
            # 等待应用初始化
            try:
                await self.page.wait_for_function(
                    "() => window.app && window.app.isInitialized",
                    timeout=10000
                )
                self.log_result("应用初始化", True, "window.app.isInitialized = true")
            except PlaywrightTimeoutError:
                self.log_result("应用初始化", False, "应用未在预期时间内初始化")
                return False
            
            return True
            
        except Exception as e:
            self.log_result("页面加载", False, f"异常: {str(e)}")
            return False
    
    async def test_exam_index_loaded(self) -> bool:
        """测试2: examIndexLoaded 事件与 loadExamList"""
        print("\n" + "=" * 60)
        print("测试2: examIndexLoaded 事件")
        print("=" * 60)
        
        try:
            # 检查 examIndex 是否加载
            exam_index_loaded = await self.page.evaluate(
                "async () => Array.isArray(await window.resolveActiveLibraryIndex())"
            )
            
            if exam_index_loaded:
                exam_count = await self.page.evaluate("async () => (await window.resolveActiveLibraryIndex()).length")
                self.log_result("examIndex 加载", True, f"已加载 {exam_count} 个题目")
            else:
                self.log_result("examIndex 加载", False, "examIndex 未加载或格式错误")
                return False
            
            # 检查 loadExamList 是否被调用
            load_exam_list_called = any(
                "loadExamList" in log["text"] 
                for log in self.console_logs
            )
            
            if load_exam_list_called:
                self.log_result("loadExamList 调用", True, "检测到 loadExamList 日志")
            else:
                self.log_result("loadExamList 调用", False, "未检测到 loadExamList 调用日志")
            
            return True
            
        except Exception as e:
            self.log_result("examIndexLoaded 事件", False, f"异常: {str(e)}")
            return False
    
    async def test_overview_view(self) -> bool:
        """测试3: 总览视图"""
        print("\n" + "=" * 60)
        print("测试3: 总览视图")
        print("=" * 60)
        
        try:
            # 检查总览视图是否激活
            overview_active = await self.page.is_visible("#overview-view.active")
            
            if overview_active:
                self.log_result("总览视图激活", True, "总览视图已激活")
            else:
                self.log_result("总览视图激活", False, "总览视图未激活")
                return False
            
            # 检查分类卡片
            category_cards = await self.page.locator("#category-overview .category-card").count()
            
            if category_cards > 0:
                self.log_result("分类卡片渲染", True, f"渲染了 {category_cards} 个分类卡片")
            else:
                self.log_result("分类卡片渲染", False, "未检测到分类卡片")
            
            return True
            
        except Exception as e:
            self.log_result("总览视图", False, f"异常: {str(e)}")
            return False
    
    async def test_browse_view(self) -> bool:
        """测试4: 题库浏览视图"""
        print("\n" + "=" * 60)
        print("测试4: 题库浏览视图")
        print("=" * 60)
        
        try:
            # 点击"题库浏览"按钮
            await self.page.click('button[data-view="browse"]')
            self.log_result("点击题库浏览", True, "已点击导航按钮")
            
            # 等待视图切换
            await self.page.wait_for_selector("#browse-view.active", timeout=10000)
            self.log_result("浏览视图激活", True, "浏览视图已激活")
            
            # 等待题库列表渲染
            await self.page.wait_for_selector("#exam-list-container .exam-item", timeout=10000)
            
            exam_count = await self.page.locator("#exam-list-container .exam-item").count()
            self.log_result("题库列表渲染", True, f"渲染了 {exam_count} 个题目")
            
            # 检查懒加载状态
            browse_group_loaded = await self.page.evaluate(
                "() => window.AppLazyLoader && window.AppLazyLoader.getStatus('browse-view').loaded"
            )
            
            if browse_group_loaded:
                self.log_result("browse-view 组加载", True, "懒加载组已加载")
            else:
                self.log_result("browse-view 组加载", False, "懒加载组未加载")
            
            return True
            
        except Exception as e:
            self.log_result("题库浏览视图", False, f"异常: {str(e)}")
            return False
    
    async def test_practice_view(self) -> bool:
        """测试5: 练习记录视图"""
        print("\n" + "=" * 60)
        print("测试5: 练习记录视图")
        print("=" * 60)
        
        try:
            # 点击"练习记录"按钮
            await self.page.click('button[data-view="practice"]')
            self.log_result("点击练习记录", True, "已点击导航按钮")
            
            # 等待视图切换
            await self.page.wait_for_selector("#practice-view.active", timeout=10000)
            self.log_result("练习记录视图激活", True, "练习记录视图已激活")
            
            # 检查统计卡片
            stat_cards = await self.page.locator(".practice-stats .hero-card").count()
            
            if stat_cards > 0:
                self.log_result("统计卡片渲染", True, f"渲染了 {stat_cards} 个统计卡片")
            else:
                self.log_result("统计卡片渲染", False, "未检测到统计卡片")
            
            # 检查懒加载状态
            practice_group_loaded = await self.page.evaluate(
                "() => window.AppLazyLoader && window.AppLazyLoader.getStatus('practice-suite').loaded"
            )
            
            if practice_group_loaded:
                self.log_result("practice-suite 组加载", True, "懒加载组已加载")
            else:
                self.log_result("practice-suite 组加载", False, "懒加载组未加载")
            
            return True
            
        except Exception as e:
            self.log_result("练习记录视图", False, f"异常: {str(e)}")
            return False
    
    async def test_more_view(self) -> bool:
        """测试6: 更多工具视图"""
        print("\n" + "=" * 60)
        print("测试6: 更多工具视图")
        print("=" * 60)
        
        try:
            # 点击"更多"按钮
            await self.page.click('button[data-view="more"]')
            self.log_result("点击更多工具", True, "已点击导航按钮")
            
            # 等待视图切换
            await self.page.wait_for_selector("#more-view.active", timeout=10000)
            self.log_result("更多工具视图激活", True, "更多工具视图已激活")
            
            # 检查工具卡片
            tool_cards = await self.page.locator(".more-tools-grid .tool-card").count()
            
            if tool_cards > 0:
                self.log_result("工具卡片渲染", True, f"渲染了 {tool_cards} 个工具卡片")
            else:
                self.log_result("工具卡片渲染", False, "未检测到工具卡片")
            
            # 检查懒加载状态
            more_group_loaded = await self.page.evaluate(
                "() => window.AppLazyLoader && window.AppLazyLoader.getStatus('more-tools').loaded"
            )
            
            if more_group_loaded:
                self.log_result("more-tools 组加载", True, "懒加载组已加载")
            else:
                self.log_result("more-tools 组加载", False, "懒加载组未加载")
            
            return True
            
        except Exception as e:
            self.log_result("更多工具视图", False, f"异常: {str(e)}")
            return False
    
    async def test_lazy_loader_status(self) -> bool:
        """测试7: 懒加载器状态"""
        print("\n" + "=" * 60)
        print("测试7: 懒加载器状态")
        print("=" * 60)
        
        try:
            # 获取懒加载器状态
            lazy_loader_status = await self.page.evaluate("""
                () => {
                    if (!window.AppLazyLoader) return null;
                    
                    const groups = ['exam-data', 'browse-view', 'practice-suite', 'more-tools', 'theme-tools'];
                    const status = {};
                    
                    groups.forEach(group => {
                        const groupStatus = window.AppLazyLoader.getStatus(group);
                        status[group] = {
                            loaded: groupStatus.loaded,
                            fileCount: groupStatus.files ? groupStatus.files.length : 0
                        };
                    });
                    
                    return status;
                }
            """)
            
            if lazy_loader_status:
                self.log_result("懒加载器状态", True, lazy_loader_status)
                
                # 检查各组状态
                for group, status in lazy_loader_status.items():
                    if status["loaded"]:
                        self.log_result(f"{group} 组状态", True, f"已加载 ({status['fileCount']} 个文件)")
                    else:
                        self.log_result(f"{group} 组状态", False, "未加载")
            else:
                self.log_result("懒加载器状态", False, "AppLazyLoader 不存在")
                return False
            
            return True
            
        except Exception as e:
            self.log_result("懒加载器状态", False, f"异常: {str(e)}")
            return False
    
    async def check_console_errors(self) -> bool:
        """测试8: 控制台错误检查"""
        print("\n" + "=" * 60)
        print("测试8: 控制台错误检查")
        print("=" * 60)
        
        error_count = sum(1 for log in self.console_logs if log["type"] == "error")
        warning_count = sum(1 for log in self.console_logs if log["type"] == "warning")
        
        print(f"错误数量: {error_count}")
        print(f"警告数量: {warning_count}")
        
        # 检查关键错误
        critical_errors = [
            log for log in self.console_logs 
            if log["type"] == "error" and any(
                keyword in log["text"].lower() 
                for keyword in ["uncaught", "failed to load", "is not defined", "cannot read property"]
            )
        ]
        
        if critical_errors:
            self.log_result("关键错误检查", False, f"发现 {len(critical_errors)} 个关键错误")
            for error in critical_errors[:5]:  # 只显示前5个
                print(f"  ❌ {error['text']}")
            return False
        else:
            self.log_result("关键错误检查", True, "无关键错误")
        
        self.log_result("控制台统计", True, {
            "errors": error_count,
            "warnings": warning_count,
            "total_logs": len(self.console_logs)
        })
        
        return error_count == 0
    
    async def save_report(self) -> None:
        """保存测试报告"""
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        REPORT_DIR.mkdir(parents=True, exist_ok=True)
        
        # 生成报告
        report = {
            "generatedAt": datetime.now().isoformat(),
            "duration": (datetime.now() - self.start_time).total_seconds(),
            "status": "pass" if all(r["status"] == "pass" for r in self.test_results) else "fail",
            "summary": {
                "total": len(self.test_results),
                "passed": sum(1 for r in self.test_results if r["status"] == "pass"),
                "failed": sum(1 for r in self.test_results if r["status"] == "fail")
            },
            "results": self.test_results,
            "consoleLogs": self.console_logs
        }
        
        # 保存 JSON 报告
        report_path = REPORT_DIR / f"phase0-baseline-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n📄 JSON 报告已保存: {report_path}")
        
        # 保存文本日志
        log_path = LOG_DIR / f"phase0-baseline-{datetime.now().strftime('%Y%m%d-%H%M%S')}.log"
        
        with open(log_path, 'w', encoding='utf-8') as f:
            f.write("=" * 80 + "\n")
            f.write("Phase 0 基线测试日志 (Playwright)\n")
            f.write(f"测试时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"项目路径: {REPO_ROOT}\n")
            f.write("=" * 80 + "\n\n")
            
            f.write("测试结果摘要\n")
            f.write("-" * 80 + "\n")
            f.write(f"总测试数: {report['summary']['total']}\n")
            f.write(f"通过: {report['summary']['passed']}\n")
            f.write(f"失败: {report['summary']['failed']}\n")
            f.write(f"状态: {report['status'].upper()}\n\n")
            
            f.write("详细测试结果\n")
            f.write("-" * 80 + "\n")
            for result in self.test_results:
                status_icon = "✅" if result["status"] == "pass" else "❌"
                f.write(f"{status_icon} {result['name']}\n")
                f.write(f"   {result['detail']}\n\n")
            
            f.write("\n控制台日志\n")
            f.write("-" * 80 + "\n")
            for log in self.console_logs:
                f.write(f"[{log['type'].upper()}] {log['text']}\n")
        
        print(f"📄 文本日志已保存: {log_path}")
    
    async def run(self) -> bool:
        """运行所有测试"""
        try:
            await self.setup()
            
            print("=" * 80)
            print("开始 Phase 0 基线测试 (Playwright)")
            print("=" * 80)
            
            # 运行测试
            success = True
            success &= await self.test_page_load()
            success &= await self.test_exam_index_loaded()
            success &= await self.test_overview_view()
            success &= await self.test_browse_view()
            success &= await self.test_practice_view()
            success &= await self.test_more_view()
            success &= await self.test_lazy_loader_status()
            success &= await self.check_console_errors()
            
            # 保存报告
            await self.save_report()
            
            # 打印总结
            print("\n" + "=" * 80)
            passed_count = sum(1 for r in self.test_results if r["status"] == "pass")
            total_count = len(self.test_results)
            
            if success:
                print(f"✅ Phase 0 基线测试通过 ({passed_count}/{total_count})")
            else:
                print(f"❌ Phase 0 基线测试失败 ({passed_count}/{total_count})")
            print("=" * 80)
            
            return success
            
        except Exception as e:
            print(f"❌ 测试过程中发生异常: {e}")
            import traceback
            traceback.print_exc()
            return False
        
        finally:
            await self.teardown()


async def main():
    """主函数"""
    print("=" * 80)
    print("Phase 0 基线测试脚本 (Playwright)")
    print("=" * 80)
    
    tester = Phase0BaselineTest()
    success = await tester.run()
    
    return 0 if success else 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    exit(exit_code)
