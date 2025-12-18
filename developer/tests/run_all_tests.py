#!/usr/bin/env python3
"""
统一测试运行器
用途：运行所有测试（基线测试、CI测试、E2E测试）并生成综合报告
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any

REPO_ROOT = Path(__file__).resolve().parents[2]
REPORT_DIR = REPO_ROOT / "developer" / "tests" / "reports"


class TestRunner:
    """统一测试运行器"""
    
    def __init__(self):
        self.results: List[Dict[str, Any]] = []
        self.start_time = datetime.now()
        
    def log(self, message: str, level: str = "INFO") -> None:
        """记录日志"""
        timestamp = datetime.now().strftime('%H:%M:%S')
        prefix = {
            "INFO": "ℹ️",
            "SUCCESS": "✅",
            "WARNING": "⚠️",
            "ERROR": "❌"
        }.get(level, "•")
        print(f"[{timestamp}] {prefix} {message}")
    
    def run_baseline_test(self) -> bool:
        """运行基线测试"""
        self.log("=" * 80)
        self.log("运行 Phase 0 基线测试 (Playwright)")
        self.log("=" * 80)
        
        test_script = REPO_ROOT / "developer" / "tests" / "baseline" / "phase0_baseline_playwright.py"
        
        if not test_script.exists():
            self.log(f"基线测试脚本不存在: {test_script}", "ERROR")
            return False
        
        try:
            result = subprocess.run(
                [sys.executable, str(test_script)],
                capture_output=True,
                text=True,
                timeout=120
            )
            
            print(result.stdout)
            if result.stderr:
                print(result.stderr)
            
            passed = result.returncode == 0
            
            self.results.append({
                "name": "Phase 0 基线测试",
                "status": "pass" if passed else "fail",
                "returnCode": result.returncode,
                "duration": None
            })
            
            if passed:
                self.log("基线测试通过", "SUCCESS")
            else:
                self.log(f"基线测试失败 (返回码: {result.returncode})", "ERROR")
            
            return passed
            
        except subprocess.TimeoutExpired:
            self.log("基线测试超时 (120秒)", "ERROR")
            self.results.append({
                "name": "Phase 0 基线测试",
                "status": "fail",
                "error": "超时"
            })
            return False
        except Exception as e:
            self.log(f"运行基线测试时出错: {e}", "ERROR")
            self.results.append({
                "name": "Phase 0 基线测试",
                "status": "fail",
                "error": str(e)
            })
            return False
    
    def run_ci_tests(self) -> bool:
        """运行 CI 静态测试"""
        self.log("=" * 80)
        self.log("运行 CI 静态测试套件")
        self.log("=" * 80)
        
        test_script = REPO_ROOT / "developer" / "tests" / "ci" / "run_static_suite.py"
        
        if not test_script.exists():
            self.log(f"CI 测试脚本不存在: {test_script}", "ERROR")
            return False
        
        try:
            result = subprocess.run(
                [sys.executable, str(test_script)],
                capture_output=True,
                text=True,
                timeout=60
            )
            
            print(result.stdout)
            if result.stderr:
                print(result.stderr)
            
            passed = result.returncode == 0
            
            # 尝试解析 JSON 报告
            report_path = REPO_ROOT / "developer" / "tests" / "e2e" / "reports" / "static-ci-report.json"
            if report_path.exists():
                try:
                    report = json.loads(report_path.read_text(encoding="utf-8"))
                    self.results.append({
                        "name": "CI 静态测试",
                        "status": report.get("status", "unknown"),
                        "results": report.get("results", [])
                    })
                except Exception:
                    pass
            else:
                self.results.append({
                    "name": "CI 静态测试",
                    "status": "pass" if passed else "fail",
                    "returnCode": result.returncode
                })
            
            if passed:
                self.log("CI 测试通过", "SUCCESS")
            else:
                self.log(f"CI 测试失败 (返回码: {result.returncode})", "ERROR")
            
            return passed
            
        except subprocess.TimeoutExpired:
            self.log("CI 测试超时 (60秒)", "ERROR")
            self.results.append({
                "name": "CI 静态测试",
                "status": "fail",
                "error": "超时"
            })
            return False
        except Exception as e:
            self.log(f"运行 CI 测试时出错: {e}", "ERROR")
            self.results.append({
                "name": "CI 静态测试",
                "status": "fail",
                "error": str(e)
            })
            return False
    
    def run_e2e_tests(self) -> bool:
        """运行 E2E 测试"""
        self.log("=" * 80)
        self.log("运行 E2E 套题练习流程测试")
        self.log("=" * 80)
        
        test_script = REPO_ROOT / "developer" / "tests" / "e2e" / "suite_practice_flow.py"
        
        if not test_script.exists():
            self.log(f"E2E 测试脚本不存在: {test_script}", "ERROR")
            return False
        
        try:
            result = subprocess.run(
                [sys.executable, str(test_script)],
                capture_output=True,
                text=True,
                timeout=180
            )
            
            print(result.stdout)
            if result.stderr:
                print(result.stderr)
            
            passed = result.returncode == 0
            
            # 尝试解析 JSON 报告
            report_path = REPO_ROOT / "developer" / "tests" / "e2e" / "reports" / "suite-practice-flow-report.json"
            if report_path.exists():
                try:
                    report = json.loads(report_path.read_text(encoding="utf-8"))
                    self.results.append({
                        "name": "E2E 套题练习流程",
                        "status": report.get("status", "unknown"),
                        "duration": report.get("duration"),
                        "consoleLogs": len(report.get("consoleLogs", []))
                    })
                except Exception:
                    pass
            else:
                self.results.append({
                    "name": "E2E 套题练习流程",
                    "status": "pass" if passed else "fail",
                    "returnCode": result.returncode
                })
            
            if passed:
                self.log("E2E 测试通过", "SUCCESS")
            else:
                self.log(f"E2E 测试失败 (返回码: {result.returncode})", "ERROR")
            
            return passed
            
        except subprocess.TimeoutExpired:
            self.log("E2E 测试超时 (180秒)", "ERROR")
            self.results.append({
                "name": "E2E 套题练习流程",
                "status": "fail",
                "error": "超时"
            })
            return False
        except Exception as e:
            self.log(f"运行 E2E 测试时出错: {e}", "ERROR")
            self.results.append({
                "name": "E2E 套题练习流程",
                "status": "fail",
                "error": str(e)
            })
            return False
    
    def generate_report(self) -> None:
        """生成综合测试报告"""
        REPORT_DIR.mkdir(parents=True, exist_ok=True)
        
        duration = (datetime.now() - self.start_time).total_seconds()
        
        all_passed = all(
            r.get("status") == "pass" 
            for r in self.results
        )
        
        report = {
            "generatedAt": datetime.now().isoformat(),
            "duration": duration,
            "status": "pass" if all_passed else "fail",
            "summary": {
                "total": len(self.results),
                "passed": sum(1 for r in self.results if r.get("status") == "pass"),
                "failed": sum(1 for r in self.results if r.get("status") == "fail")
            },
            "results": self.results
        }
        
        report_path = REPORT_DIR / f"test-summary-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        
        self.log("=" * 80)
        self.log("测试摘要")
        self.log("=" * 80)
        self.log(f"总测试套件: {report['summary']['total']}")
        self.log(f"通过: {report['summary']['passed']}")
        self.log(f"失败: {report['summary']['failed']}")
        self.log(f"总耗时: {duration:.2f}秒")
        self.log(f"报告已保存: {report_path}")
        self.log("=" * 80)
        
        if all_passed:
            self.log("✅ 所有测试通过", "SUCCESS")
        else:
            self.log("❌ 部分测试失败", "ERROR")
    
    def run_all(self, skip_baseline: bool = False, skip_ci: bool = False, skip_e2e: bool = False) -> int:
        """运行所有测试"""
        self.log("=" * 80)
        self.log("开始运行测试套件")
        self.log("=" * 80)
        
        all_passed = True
        
        # 运行基线测试
        if not skip_baseline:
            baseline_passed = self.run_baseline_test()
            all_passed &= baseline_passed
        else:
            self.log("跳过基线测试", "WARNING")
        
        # 运行 CI 测试
        if not skip_ci:
            ci_passed = self.run_ci_tests()
            all_passed &= ci_passed
        else:
            self.log("跳过 CI 测试", "WARNING")
        
        # 运行 E2E 测试
        if not skip_e2e:
            e2e_passed = self.run_e2e_tests()
            all_passed &= e2e_passed
        else:
            self.log("跳过 E2E 测试", "WARNING")
        
        # 生成报告
        self.generate_report()
        
        return 0 if all_passed else 1


def main():
    """主函数"""
    import argparse
    
    parser = argparse.ArgumentParser(description="运行测试套件")
    parser.add_argument("--skip-baseline", action="store_true", help="跳过基线测试")
    parser.add_argument("--skip-ci", action="store_true", help="跳过 CI 测试")
    parser.add_argument("--skip-e2e", action="store_true", help="跳过 E2E 测试")
    parser.add_argument("--only-baseline", action="store_true", help="仅运行基线测试")
    parser.add_argument("--only-ci", action="store_true", help="仅运行 CI 测试")
    parser.add_argument("--only-e2e", action="store_true", help="仅运行 E2E 测试")
    
    args = parser.parse_args()
    
    skip_baseline = args.skip_baseline or args.only_ci or args.only_e2e
    skip_ci = args.skip_ci or args.only_baseline or args.only_e2e
    skip_e2e = args.skip_e2e or args.only_baseline or args.only_ci
    
    runner = TestRunner()
    exit_code = runner.run_all(
        skip_baseline=skip_baseline,
        skip_ci=skip_ci,
        skip_e2e=skip_e2e
    )
    
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
