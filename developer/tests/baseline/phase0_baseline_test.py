#!/usr/bin/env python3
"""
Phase 0 基线测试脚本
用途：在 file:// 协议下自动化测试并记录基线日志
"""

import os
import sys
import json
import time
from datetime import datetime
from pathlib import Path

# 添加项目根目录到 Python 路径
PROJECT_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

try:
    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.chrome.options import Options
    from selenium.common.exceptions import TimeoutException, WebDriverException
except ImportError:
    print("❌ 错误: 未安装 selenium 库")
    print("请运行: pip install selenium")
    sys.exit(1)


class Phase0BaselineTest:
    """阶段0基线测试类"""
    
    def __init__(self):
        self.project_root = PROJECT_ROOT
        self.index_path = self.project_root / "index.html"
        self.log_dir = self.project_root / "developer" / "logs"
        self.log_file = self.log_dir / f"phase0-baseline-{datetime.now().strftime('%Y%m%d-%H%M%S')}.log"
        self.driver = None
        self.logs = []
        
    def setup_driver(self):
        """初始化 Chrome WebDriver"""
        print("🚀 初始化 Chrome WebDriver...")
        
        chrome_options = Options()
        chrome_options.add_argument('--headless')  # 无头模式
        chrome_options.add_argument('--disable-gpu')
        chrome_options.add_argument('--no-sandbox')
        chrome_options.add_argument('--disable-dev-shm-usage')
        chrome_options.add_argument('--disable-web-security')  # 允许 file:// 协议
        chrome_options.add_argument('--allow-file-access-from-files')
        
        # 启用控制台日志捕获
        chrome_options.set_capability('goog:loggingPrefs', {'browser': 'ALL'})
        
        try:
            self.driver = webdriver.Chrome(options=chrome_options)
            print("✅ WebDriver 初始化成功")
        except WebDriverException as e:
            print(f"❌ WebDriver 初始化失败: {e}")
            print("请确保已安装 ChromeDriver: brew install chromedriver")
            sys.exit(1)
    
    def log(self, message, level="INFO"):
        """记录日志"""
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]
        log_entry = f"[{timestamp}] [{level}] {message}"
        self.logs.append(log_entry)
        print(log_entry)
    
    def save_logs(self):
        """保存日志到文件"""
        self.log_dir.mkdir(parents=True, exist_ok=True)
        
        with open(self.log_file, 'w', encoding='utf-8') as f:
            f.write("=" * 80 + "\n")
            f.write("Phase 0 基线测试日志\n")
            f.write(f"测试时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"项目路径: {self.project_root}\n")
            f.write("=" * 80 + "\n\n")
            
            for log in self.logs:
                f.write(log + "\n")
        
        print(f"\n📄 日志已保存到: {self.log_file}")
    
    def capture_console_logs(self):
        """捕获浏览器控制台日志"""
        try:
            browser_logs = self.driver.get_log('browser')
            for entry in browser_logs:
                level = entry['level']
                message = entry['message']
                timestamp = entry['timestamp']
                
                # 转换时间戳
                dt = datetime.fromtimestamp(timestamp / 1000.0)
                time_str = dt.strftime('%H:%M:%S.%f')[:-3]
                
                self.log(f"[Browser Console] [{time_str}] {message}", level)
        except Exception as e:
            self.log(f"捕获控制台日志失败: {e}", "ERROR")
    
    def check_element_exists(self, selector, timeout=10):
        """检查元素是否存在"""
        try:
            WebDriverWait(self.driver, timeout).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, selector))
            )
            return True
        except TimeoutException:
            return False
    
    def test_page_load(self):
        """测试页面加载"""
        self.log("=" * 60)
        self.log("测试1: 页面加载")
        self.log("=" * 60)
        
        # 构建 file:// URL
        file_url = f"file://{self.index_path.absolute()}"
        self.log(f"加载 URL: {file_url}")
        
        try:
            self.driver.get(file_url)
            self.log("✅ 页面加载成功")
            time.sleep(2)  # 等待页面初始化
            
            # 捕获初始日志
            self.capture_console_logs()
            
        except Exception as e:
            self.log(f"❌ 页面加载失败: {e}", "ERROR")
            return False
        
        return True
    
    def test_boot_screen(self):
        """测试启动屏幕"""
        self.log("\n" + "=" * 60)
        self.log("测试2: 启动屏幕")
        self.log("=" * 60)
        
        # 检查启动屏幕元素
        if self.check_element_exists("#boot-overlay", timeout=5):
            self.log("✅ 启动屏幕显示正常")
        else:
            self.log("⚠️ 未检测到启动屏幕", "WARN")
        
        # 等待启动屏幕消失
        try:
            WebDriverWait(self.driver, 15).until(
                EC.invisibility_of_element_located((By.ID, "boot-overlay"))
            )
            self.log("✅ 启动屏幕已隐藏")
        except TimeoutException:
            self.log("⚠️ 启动屏幕未在预期时间内隐藏", "WARN")
        
        time.sleep(1)
        self.capture_console_logs()
    
    def test_overview_view(self):
        """测试总览视图"""
        self.log("\n" + "=" * 60)
        self.log("测试3: 总览视图")
        self.log("=" * 60)
        
        # 检查总览视图是否显示
        if self.check_element_exists("#overview-view.active", timeout=5):
            self.log("✅ 总览视图已激活")
        else:
            self.log("❌ 总览视图未激活", "ERROR")
            return False
        
        # 检查分类卡片是否渲染
        if self.check_element_exists("#category-overview .category-card", timeout=5):
            self.log("✅ 分类卡片已渲染")
        else:
            self.log("⚠️ 未检测到分类卡片", "WARN")
        
        self.capture_console_logs()
        return True
    
    def test_browse_view(self):
        """测试浏览视图"""
        self.log("\n" + "=" * 60)
        self.log("测试4: 浏览视图")
        self.log("=" * 60)
        
        try:
            # 点击"题库浏览"按钮
            browse_btn = self.driver.find_element(By.CSS_SELECTOR, 'button[data-view="browse"]')
            browse_btn.click()
            self.log("✅ 点击'题库浏览'按钮")
            
            time.sleep(2)  # 等待懒加载
            
            # 检查浏览视图是否激活
            if self.check_element_exists("#browse-view.active", timeout=10):
                self.log("✅ 浏览视图已激活")
            else:
                self.log("❌ 浏览视图未激活", "ERROR")
                return False
            
            # 检查题库列表是否渲染
            if self.check_element_exists("#exam-list-container .exam-item", timeout=10):
                self.log("✅ 题库列表已渲染")
            else:
                self.log("⚠️ 未检测到题库列表项", "WARN")
            
            self.capture_console_logs()
            
        except Exception as e:
            self.log(f"❌ 浏览视图测试失败: {e}", "ERROR")
            return False
        
        return True
    
    def test_practice_view(self):
        """测试练习记录视图"""
        self.log("\n" + "=" * 60)
        self.log("测试5: 练习记录视图")
        self.log("=" * 60)
        
        try:
            # 点击"练习记录"按钮
            practice_btn = self.driver.find_element(By.CSS_SELECTOR, 'button[data-view="practice"]')
            practice_btn.click()
            self.log("✅ 点击'练习记录'按钮")
            
            time.sleep(2)  # 等待懒加载
            
            # 检查练习视图是否激活
            if self.check_element_exists("#practice-view.active", timeout=10):
                self.log("✅ 练习记录视图已激活")
            else:
                self.log("❌ 练习记录视图未激活", "ERROR")
                return False
            
            self.capture_console_logs()
            
        except Exception as e:
            self.log(f"❌ 练习记录视图测试失败: {e}", "ERROR")
            return False
        
        return True
    
    def test_lazy_loader_status(self):
        """测试懒加载器状态"""
        self.log("\n" + "=" * 60)
        self.log("测试6: 懒加载器状态")
        self.log("=" * 60)
        
        try:
            # 执行 JavaScript 获取懒加载状态
            status = self.driver.execute_script("""
                if (window.AppLazyLoader && window.AppLazyLoader.getStatus) {
                    return window.AppLazyLoader.getStatus();
                }
                return null;
            """)
            
            if status:
                self.log(f"✅ 懒加载器状态: {json.dumps(status, indent=2, ensure_ascii=False)}")
            else:
                self.log("⚠️ 无法获取懒加载器状态", "WARN")
            
        except Exception as e:
            self.log(f"❌ 获取懒加载器状态失败: {e}", "ERROR")
    
    def check_errors(self):
        """检查是否有错误"""
        self.log("\n" + "=" * 60)
        self.log("错误检查")
        self.log("=" * 60)
        
        error_count = 0
        warning_count = 0
        
        for log in self.logs:
            if "ERROR" in log or "❌" in log:
                error_count += 1
            elif "WARN" in log or "⚠️" in log:
                warning_count += 1
        
        self.log(f"错误数量: {error_count}")
        self.log(f"警告数量: {warning_count}")
        
        if error_count == 0:
            self.log("✅ 无严重错误")
            return True
        else:
            self.log(f"❌ 发现 {error_count} 个错误", "ERROR")
            return False
    
    def run(self):
        """运行所有测试"""
        try:
            self.setup_driver()
            
            self.log("=" * 80)
            self.log("开始 Phase 0 基线测试")
            self.log("=" * 80)
            
            # 运行测试
            if not self.test_page_load():
                self.log("❌ 页面加载失败，终止测试", "ERROR")
                return False
            
            self.test_boot_screen()
            self.test_overview_view()
            self.test_browse_view()
            self.test_practice_view()
            self.test_lazy_loader_status()
            
            # 最终日志捕获
            time.sleep(2)
            self.capture_console_logs()
            
            # 检查错误
            success = self.check_errors()
            
            self.log("\n" + "=" * 80)
            if success:
                self.log("✅ Phase 0 基线测试通过")
            else:
                self.log("❌ Phase 0 基线测试失败")
            self.log("=" * 80)
            
            return success
            
        except Exception as e:
            self.log(f"❌ 测试过程中发生异常: {e}", "ERROR")
            return False
        
        finally:
            # 保存日志
            self.save_logs()
            
            # 关闭浏览器
            if self.driver:
                self.driver.quit()
                print("🔚 WebDriver 已关闭")


def main():
    """主函数"""
    print("=" * 80)
    print("Phase 0 基线测试脚本")
    print("=" * 80)
    
    tester = Phase0BaselineTest()
    success = tester.run()
    
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
