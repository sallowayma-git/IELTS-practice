#!/usr/bin/env python3
"""Phase 05B E2E Test: Upload Flow via HTTP

真正的 E2E 测试 - 通过 127.0.0.1 本地 HTTP API 调用真实服务

测试覆盖:
1. 上传流程: POST /api/upload/image → 验证返回 + 真实文件存在
2. 删除流程: DELETE /api/upload/image/:filename → 验证文件删除
3. 路径安全: 验证恶意路径被拒绝

前置条件:
- Electron 主进程运行中，或手动启动 local-api-server
- 真实文件系统可访问
"""

from __future__ import annotations

import base64
import json
import time
import subprocess
import sys
import signal
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Dict, Any
import os
from urllib.parse import quote

# HTTP 客户端
try:
    import requests
except ImportError:
    print("Installing requests...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests", "-q"])
    import requests

HTTP = requests.Session()
HTTP.trust_env = False

REPO_ROOT = Path(__file__).resolve().parents[3]
REPORT_DIR = REPO_ROOT / "developer" / "tests" / "e2e" / "reports"

# 默认测试环境配置
DEFAULT_API_BASE = "http://127.0.0.1"
DEFAULT_IMAGES_DIR = Path.home() / "Library" / "Application Support" / "ielts-practice" / "images"
DEFAULT_API_PORT = 3000


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
class TestResult:
    """测试结果"""
    name: str
    status: str  # pass, fail, skip
    detail: str
    duration: float = 0.0
    evidence: Optional[Dict[str, Any]] = None


class RealUploadTestRunner:
    """真实上传测试执行器"""
    
    def __init__(self, api_base: str, images_dir: Path):
        self.api_base = api_base.rstrip('/')
        self.images_dir = images_dir
        self.transport = "http"
        
    def _api_request(self, method: str, endpoint: str, **kwargs) -> requests.Response:
        """发送 API 请求"""
        url = f"{self.api_base}{endpoint}"
        log_step(f"HTTP {method.upper()} {url}", "DEBUG")
        return HTTP.request(method, url, timeout=30, **kwargs)
    
    def check_file_exists(self, relative_path: str) -> bool:
        """检查真实文件是否存在"""
        full_path = self.images_dir / relative_path
        return full_path.exists()
    
    def get_file_size(self, relative_path: str) -> int:
        """获取真实文件大小"""
        full_path = self.images_dir / relative_path
        return full_path.stat().st_size if full_path.exists() else 0


class StandaloneServerManager:
    """管理 standalone-api-server 进程（真实服务层，不是 Mock）"""

    def __init__(self, api_port: int):
        self.api_port = api_port
        self.proc: Optional[subprocess.Popen] = None
        self.script_path = REPO_ROOT / "developer" / "tests" / "e2e" / "standalone-api-server.cjs"

    def _resolve_electron_bin(self) -> Optional[Path]:
        bin_name = "electron.cmd" if os.name == "nt" else "electron"
        candidate = REPO_ROOT / "node_modules" / ".bin" / bin_name
        if candidate.exists():
            return candidate
        return None

    def start(self) -> bool:
        electron_bin = self._resolve_electron_bin()
        if not electron_bin:
            log_step(
                "未找到 electron 可执行文件（node_modules/.bin/electron），无法自动拉起 standalone server",
                "WARNING"
            )
            return False

        env = os.environ.copy()
        env["WRITING_API_PORT"] = str(self.api_port)
        env["IELTS_USER_DATA_PATH"] = str(Path.home() / "Library" / "Application Support" / "ielts-practice")

        log_step(f"尝试自动拉起 standalone server: {electron_bin} {self.script_path}", "INFO")
        self.proc = subprocess.Popen(
            [str(electron_bin), str(self.script_path)],
            cwd=str(REPO_ROOT),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        # 等待最多 15 秒
        deadline = time.time() + 15
        while time.time() < deadline:
            if self.proc.poll() is not None:
                stdout = self.proc.stdout.read() if self.proc.stdout else ""
                stderr = self.proc.stderr.read() if self.proc.stderr else ""
                log_step(f"standalone server 启动失败，退出码={self.proc.returncode}", "ERROR")
                if stdout:
                    log_step(f"stdout: {stdout.strip()}", "DEBUG")
                if stderr:
                    log_step(f"stderr: {stderr.strip()}", "DEBUG")
                return False
            try:
                resp = HTTP.get(f"{DEFAULT_API_BASE}:{self.api_port}/health", timeout=1.5)
                if resp.status_code == 200:
                    log_step("standalone server 已启动并通过健康检查", "SUCCESS")
                    return True
            except requests.RequestException:
                time.sleep(0.3)

        log_step("standalone server 启动超时", "ERROR")
        if self.proc.poll() is not None:
            stdout = self.proc.stdout.read() if self.proc.stdout else ""
            stderr = self.proc.stderr.read() if self.proc.stderr else ""
            if stdout.strip():
                log_step(f"stdout: {stdout.strip()}", "DEBUG")
            if stderr.strip():
                log_step(f"stderr: {stderr.strip()}", "DEBUG")
        return False

    def stop(self) -> None:
        if not self.proc or self.proc.poll() is not None:
            return
        log_step("关闭 standalone server", "INFO")
        try:
            self.proc.send_signal(signal.SIGTERM)
            self.proc.wait(timeout=5)
        except (subprocess.TimeoutExpired, ProcessLookupError):
            self.proc.kill()
        finally:
            self.proc = None


async def test_health_check(runner: RealUploadTestRunner) -> TestResult:
    """测试 API 健康检查"""
    start_time = datetime.now()
    
    try:
        log_step("测试场景 0: 健康检查", "INFO")
        
        resp = runner._api_request("GET", "/health")
        
        if resp.status_code != 200:
            raise AssertionError(f"健康检查失败, status={resp.status_code}")
        
        data = resp.json()
        assert data.get("success") == True, f"健康检查返回 success=false: {data}"
        
        log_step("✓ API 服务健康", "SUCCESS")
        
        duration = (datetime.now() - start_time).total_seconds()
        return TestResult(
            name="健康检查",
            status="pass",
            detail=f"API 服务运行正常 ({runner.api_base})",
            duration=duration,
            evidence={"transport": runner.transport, "api_base": runner.api_base}
        )
        
    except (requests.RequestException, ConnectionError) as e:
        duration = (datetime.now() - start_time).total_seconds()
        log_step(f"✗ 测试失败 (连接错误): {e}", "ERROR")
        return TestResult(
            name="健康检查",
            status="fail",
            detail=f"连接失败: {e}",
            duration=duration
        )
    except AssertionError as e:
        duration = (datetime.now() - start_time).total_seconds()
        log_step(f"✗ 测试失败: {e}", "ERROR")
        return TestResult(
            name="健康检查",
            status="fail",
            detail=str(e),
            duration=duration
        )


async def test_upload_and_delete_flow(runner: RealUploadTestRunner) -> TestResult:
    """测试上传和删除流程"""
    start_time = datetime.now()
    image_path = None
    thumbnail_path = None
    
    try:
        log_step("测试场景 1: 上传→删除流程", "INFO")
        
        # 1. 生成测试图片数据 (1x1 PNG)
        # 最小有效 PNG 文件
        png_data = bytes([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,  # PNG signature
            0x00, 0x00, 0x00, 0x0d,  # IHDR length
            0x49, 0x48, 0x44, 0x52,  # "IHDR"
            0x00, 0x00, 0x00, 0x01,  # width: 1
            0x00, 0x00, 0x00, 0x01,  # height: 1
            0x08, 0x02,              # bit depth: 8, color type: 2 (RGB)
            0x00, 0x00, 0x00,        # compression, filter, interlace
            0x90, 0x77, 0x53, 0xde,  # CRC
            0x00, 0x00, 0x00, 0x0c,  # IDAT length
            0x49, 0x44, 0x41, 0x54,  # "IDAT"
            0x08, 0xd7, 0x63, 0xf8, 0xff, 0xff, 0xff, 0x00, 0x05, 0xfe, 0x02, 0xfe,  # data
            0xa3, 0x6c, 0xec, 0x98,  # CRC
            0x00, 0x00, 0x00, 0x00,  # IEND length
            0x49, 0x45, 0x4e, 0x44,  # "IEND"
            0xae, 0x42, 0x60, 0x82   # CRC
        ])
        
        # 2. 上传图片
        payload = {
            "name": "test_e2e.png",
            "type": "image/png",
            "data_base64": base64.b64encode(png_data).decode('utf-8')
        }
        
        resp = runner._api_request("POST", "/api/upload/image", json=payload)
        assert resp.status_code == 200, f"上传失败, status={resp.status_code}"
        
        data = resp.json()
        assert data.get("success") == True, f"上传返回失败: {data}"
        
        image_path = data.get("image_path")
        thumbnail_path = data.get("thumbnail_path")
        size = data.get("size")

        assert image_path, "未返回 image_path"
        assert thumbnail_path, "未返回 thumbnail_path"
        assert size and size > 0, f"size 无效: {size}"
        assert image_path.startswith("originals/"), f"image_path 前缀错误: {image_path}"
        assert thumbnail_path.startswith("thumbnails/"), f"thumbnail_path 前缀错误: {thumbnail_path}"
        assert "_thumb" in Path(thumbnail_path).stem, f"thumbnail_path 命名不符合预期: {thumbnail_path}"

        log_step(f"✓ 上传成功 (image_path: {image_path})", "SUCCESS")
        log_step(f"  thumbnail_path: {thumbnail_path}", "DEBUG")
        log_step(f"  size: {size} bytes", "DEBUG")
        
        # 3. 验证真实文件存在
        assert runner.check_file_exists(image_path), f"原图文件不存在: {image_path}"
        assert runner.check_file_exists(thumbnail_path), f"缩略图文件不存在: {thumbnail_path}"
        original_size = runner.get_file_size(image_path)
        thumb_size = runner.get_file_size(thumbnail_path)
        assert original_size > 0, f"原图文件大小无效: {original_size}"
        assert thumb_size > 0, f"缩略图文件大小无效: {thumb_size}"

        log_step("✓ 真实文件已验证存在", "SUCCESS")
        
        # 4. 删除图片
        # 从 image_path 提取文件名 (格式: originals/xxx.png)
        filename = image_path.split('/')[-1] if '/' in image_path else image_path
        
        delete_resp = runner._api_request("DELETE", f"/api/upload/image/{filename}")
        assert delete_resp.status_code == 200, f"删除失败, status={delete_resp.status_code}"
        
        delete_data = delete_resp.json()
        assert delete_data.get("success") == True, f"删除返回失败: {delete_data}"
        
        log_step("✓ 删除请求成功", "SUCCESS")
        
        # 5. 验证文件已删除
        time.sleep(0.5)  # 等待文件系统同步
        
        assert not runner.check_file_exists(image_path), f"原图文件应被删除: {image_path}"
        assert not runner.check_file_exists(thumbnail_path), f"缩略图文件应被删除: {thumbnail_path}"
        
        log_step("✓ 原图和缩略图都已删除", "SUCCESS")
        
        duration = (datetime.now() - start_time).total_seconds()
        return TestResult(
            name="上传→删除流程",
            status="pass",
            detail=f"上传成功,返回 image_path={image_path}, thumbnail_path={thumbnail_path}; 删除后文件已清理",
            duration=duration,
            evidence={
                "transport": runner.transport,
                "image_path": image_path,
                "thumbnail_path": thumbnail_path,
                "images_dir": str(runner.images_dir),
                "size": size,
                "original_size": original_size,
                "thumbnail_size": thumb_size
            }
        )
        
    except AssertionError as e:
        duration = (datetime.now() - start_time).total_seconds()
        log_step(f"✗ 测试失败: {e}", "ERROR")
        return TestResult(
            name="上传→删除流程",
            status="fail",
            detail=str(e),
            duration=duration,
            evidence={
                "image_path": image_path,
                "thumbnail_path": thumbnail_path
            } if image_path else None
        )


async def test_path_security(runner: RealUploadTestRunner) -> TestResult:
    """测试路径安全: 恶意路径应被拒绝"""
    start_time = datetime.now()
    
    try:
        log_step("测试场景 2: 路径安全", "INFO")
        
        malicious_filenames = [
            "../etc/passwd",
            "../../sensitive.txt",
            "../../../tmp/phase05_upload_sentinel.txt",
            "/etc/passwd",
            "..\\..\\Windows\\system32\\drivers\\etc\\hosts"
        ]

        sentinel_path = Path("/tmp/phase05_upload_sentinel.txt")
        sentinel_path.write_text("phase05-upload-sentinel", encoding="utf-8")
        assert sentinel_path.exists(), "sentinel 文件创建失败"

        blocked = 0
        for malicious in malicious_filenames:
            encoded = quote(malicious, safe="")
            resp = runner._api_request("DELETE", f"/api/upload/image/{encoded}")
            assert resp.status_code in (200, 400, 404), f"异常状态码: {resp.status_code}"

            if resp.status_code == 200:
                data = resp.json()
                assert data.get("success") is not True, f"恶意路径不应返回 success=true: {malicious}"
                blocked += 1
                log_step(f"  恶意路径 '{malicious}' -> blocked, code={data.get('code')}", "DEBUG")
            else:
                blocked += 1
                log_step(f"  恶意路径 '{malicious}' -> blocked, status={resp.status_code}", "DEBUG")

        assert blocked == len(malicious_filenames), "存在未被拦截的恶意路径请求"
        assert sentinel_path.exists(), "路径安全测试后 sentinel 文件被异常删除"

        log_step("✓ 恶意路径请求未导致异常", "SUCCESS")
        
        duration = (datetime.now() - start_time).total_seconds()
        return TestResult(
            name="路径安全",
            status="pass",
            detail="恶意路径请求被正确拦截，且未影响图片目录外文件",
            duration=duration,
            evidence={
                "transport": runner.transport,
                "tested_paths": malicious_filenames,
                "sentinel_path": str(sentinel_path)
            }
        )
        
    except AssertionError as e:
        duration = (datetime.now() - start_time).total_seconds()
        log_step(f"✗ 测试失败: {e}", "ERROR")
        return TestResult(
            name="路径安全",
            status="fail",
            detail=str(e),
            duration=duration
        )


async def run(api_port: Optional[int] = None, images_dir: Optional[str] = None) -> None:
    """运行所有测试"""
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    start_time = datetime.now()
    
    log_step("=" * 80)
    log_step("Phase 05B 真实 E2E 测试: 上传流程 (HTTP)")
    log_step("=" * 80)
    
    # 解析配置：优先显式参数，其次环境变量，最后固定 3000
    candidate_ports: List[int] = []
    if api_port:
        candidate_ports.append(int(api_port))
    else:
        env_port = os.environ.get("WRITING_API_PORT")
        if env_port and env_port.isdigit():
            candidate_ports.append(int(env_port))
        if DEFAULT_API_PORT not in candidate_ports:
            candidate_ports.append(DEFAULT_API_PORT)

    resolved_port = candidate_ports[0]
    api_base = f"{DEFAULT_API_BASE}:{resolved_port}"
    
    real_images_dir = Path(images_dir) if images_dir else DEFAULT_IMAGES_DIR
    
    log_step(f"API 端口候选: {', '.join(str(p) for p in candidate_ports)}")
    log_step(f"API Base (initial): {api_base}")
    log_step(f"Images Dir: {real_images_dir}")
    standalone_manager: Optional[StandaloneServerManager] = None

    try:
        # 运行测试
        results: List[TestResult] = []

        # 先测试健康检查（带端口回退）
        health_result: Optional[TestResult] = None
        runner: Optional[RealUploadTestRunner] = None
        for idx, port in enumerate(candidate_ports):
            runner = RealUploadTestRunner(f"{DEFAULT_API_BASE}:{port}", real_images_dir)
            current = await test_health_check(runner)
            if current.status == "pass":
                resolved_port = port
                api_base = runner.api_base
                health_result = current
                break
            if idx < len(candidate_ports) - 1:
                log_step(f"端口 {port} 健康检查失败，尝试下一个候选端口", "WARNING")

        if health_result is None:
            health_result = current
            # 用最后一次 runner 继续处理自动拉起逻辑
            if runner is None:
                runner = RealUploadTestRunner(api_base, real_images_dir)

        if health_result.status != "pass":
            standalone_manager = StandaloneServerManager(api_port=resolved_port)
            if standalone_manager.start():
                runner = RealUploadTestRunner(f"{DEFAULT_API_BASE}:{resolved_port}", real_images_dir)
                health_result = await test_health_check(runner)
        results.append(health_result)
        
        if health_result.status != "pass":
            log_step("API 服务不可用,跳过后续测试", "ERROR")
            log_step("请确保 Electron 应用已启动，或安装 electron 依赖以自动拉起 standalone-api-server", "WARNING")
        else:
            # 运行上传删除流程测试
            results.append(await test_upload_and_delete_flow(runner))
            # 运行路径安全测试
            results.append(await test_path_security(runner))
        
        # 统计结果
        passed = sum(1 for r in results if r.status == "pass")
        failed = sum(1 for r in results if r.status == "fail")
        skipped = sum(1 for r in results if r.status == "skip")
        total = len(results)
        
        # 提取硬证据
        upload_evidence = next((r.evidence for r in results if r.name == "上传→删除流程" and r.evidence), {})
        
        # 生成报告
        duration = (datetime.now() - start_time).total_seconds()
        report = {
            "generatedAt": datetime.now().isoformat(),
            "duration": duration,
            "status": "pass" if failed == 0 and passed > 0 else "fail",
            "transport": "http",
            "images_dir": str(real_images_dir),
            "api_base": api_base,
            "image_path": upload_evidence.get("image_path"),
            "thumbnail_path": upload_evidence.get("thumbnail_path"),
            "summary": {
                "total": total,
                "passed": passed,
                "failed": failed,
                "skipped": skipped
            },
            "results": [
                {
                    "name": r.name,
                    "status": r.status,
                    "detail": r.detail,
                    "duration": r.duration,
                    "evidence": r.evidence
                }
                for r in results
            ]
        }
        
        # 保存报告
        report_path = REPORT_DIR / "phase05-upload-flow-report.json"
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        log_step(f"✓ 测试报告已保存: {report_path}", "SUCCESS")
        
        # 打印摘要
        log_step("=" * 80)
        log_step("测试结果摘要:")
        log_step(f"  Transport: HTTP")
        log_step(f"  Images Dir: {real_images_dir}")
        log_step(f"  总测试数: {total}")
        log_step(f"  通过: {passed}", "SUCCESS" if passed == total else "INFO")
        log_step(f"  失败: {failed}", "ERROR" if failed > 0 else "INFO")
        log_step(f"  耗时: {duration:.2f}秒")
        log_step("=" * 80)
        
        if failed == 0 and passed > 0:
            log_step("✅ 所有测试通过", "SUCCESS")
        elif failed > 0:
            log_step(f"❌ {failed} 个测试失败", "ERROR")
            for r in results:
                if r.status == "fail":
                    log_step(f"  - {r.name}: {r.detail}", "ERROR")
        else:
            log_step("⚠️ 测试已跳过 (服务不可用)", "WARNING")
        
        log_step("=" * 80)
        
        exit_code = 0 if failed == 0 and passed > 0 else 1
        raise SystemExit(exit_code)

    except (requests.RequestException, ConnectionError, FileNotFoundError) as e:
        log_step(f"测试执行失败 (环境错误): {e}", "ERROR")
        import traceback
        traceback.print_exc()
        raise SystemExit(1)
    finally:
        if standalone_manager:
            standalone_manager.stop()


if __name__ == "__main__":
    import asyncio
    import argparse
    
    parser = argparse.ArgumentParser(description="Phase 05B E2E Test (HTTP)")
    parser.add_argument("--port", type=int, help="API server port")
    parser.add_argument("--images-dir", type=str, help="Images directory path")
    args = parser.parse_args()
    
    asyncio.run(run(api_port=args.port, images_dir=args.images_dir))
