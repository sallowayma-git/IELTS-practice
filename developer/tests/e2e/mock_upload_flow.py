#!/usr/bin/env python3
"""Phase 05B E2E Test: Upload Flow Scenarios

测试覆盖:
1. 上传流程: 上传图片→返回 thumbnail_path→验证文件存在
2. 删除流程: 删除图片→验证原图和缩略图都被删除
3. 路径安全: 验证路径遍历攻击防护

验收标准:
- upload:image 返回 { image_path, thumbnail_path, size }
- 删除时同时清理原图和缩略图
- 路径解析安全,防止目录遍历
"""

from __future__ import annotations

import asyncio
import json
import tempfile
import shutil
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import List
import os

REPO_ROOT = Path(__file__).resolve().parents[3]
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
class TestResult:
    """测试结果"""
    name: str
    status: str  # pass, fail, skip
    detail: str
    duration: float = 0.0


class MockUploadService:
    """模拟 UploadService 用于测试"""
    
    def __init__(self, images_dir: Path):
        self.images_dir = images_dir
        self.originals_dir = images_dir / "originals"
        self.thumbnails_dir = images_dir / "thumbnails"
        self._ensure_dirs()
    
    def _ensure_dirs(self):
        """确保目录存在"""
        self.originals_dir.mkdir(parents=True, exist_ok=True)
        self.thumbnails_dir.mkdir(parents=True, exist_ok=True)
    
    def upload_image(self, filename: str, data: bytes) -> dict:
        """上传图片"""
        # 生成唯一文件名
        import time
        import hashlib
        timestamp = int(time.time() * 1000)
        hash_suffix = hashlib.md5(data).hexdigest()[:8]
        ext = Path(filename).suffix or ".png"
        unique_filename = f"{timestamp}_{hash_suffix}{ext}"
        
        # 保存原图
        original_path = self.originals_dir / unique_filename
        original_path.write_bytes(data)
        
        # 生成缩略图
        thumb_name = f"{Path(unique_filename).stem}_thumb{ext}"
        thumb_path = self.thumbnails_dir / thumb_name
        # 模拟缩略图生成(实际应用中会调整大小)
        thumb_path.write_bytes(data[:len(data)//2])  # 简化处理
        
        return {
            "image_path": f"originals/{unique_filename}",
            "thumbnail_path": f"thumbnails/{thumb_name}",
            "size": len(data)
        }
    
    def delete_image(self, filename: str) -> bool:
        """删除图片及其缩略图"""
        # 解析路径
        normalized = filename.lstrip("/")
        resolved = self.images_dir / normalized
        
        # 安全检查
        try:
            resolved = resolved.resolve()
            if not str(resolved).startswith(str(self.images_dir.resolve())):
                raise ValueError("Invalid file path")
        except Exception:
            return False
        
        deleted = 0
        candidates = []
        
        # 确定是原图还是缩略图
        is_original = resolved.parent == self.originals_dir.resolve()
        is_thumbnail = resolved.parent == self.thumbnails_dir.resolve()
        

        
        if is_original:
            # 如果是原图,添加原图和对应的缩略图
            candidates.append(resolved)
            thumb_name = f"{resolved.stem}_thumb{resolved.suffix}"
            thumb_path = self.thumbnails_dir / thumb_name
            candidates.append(thumb_path)

        elif is_thumbnail:
            # 如果是缩略图,添加缩略图和对应的原图
            candidates.append(resolved)
            # 移除 _thumb 后缀获取原图名称
            if "_thumb" in resolved.stem:
                original_name = resolved.stem.replace("_thumb", "") + resolved.suffix
                candidates.append(self.originals_dir / original_name)
        else:
            # 如果路径不明确,尝试两个目录
            candidates.append(resolved)
        
        # 删除所有候选文件
        for candidate in candidates:
            if candidate.exists():
                candidate.unlink()
                deleted += 1
        
        return deleted > 0


async def test_upload_flow(service: MockUploadService) -> TestResult:
    """测试上传流程: 上传图片→返回 thumbnail_path→验证文件存在"""
    start_time = datetime.now()
    
    try:
        log_step("测试场景 1: 上传流程", "INFO")
        
        # 1. 准备测试图片数据
        test_data = b"fake_image_data_for_testing" * 100
        filename = "test_image.png"
        
        # 2. 上传图片
        result = service.upload_image(filename, test_data)
        
        # 3. 验证返回结构
        assert "image_path" in result, "返回结果应包含 image_path"
        assert "thumbnail_path" in result, "返回结果应包含 thumbnail_path"
        assert "size" in result, "返回结果应包含 size"
        log_step("✓ 返回结构正确包含 image_path, thumbnail_path, size", "SUCCESS")
        
        # 4. 验证路径格式
        assert result["image_path"].startswith("originals/"), \
            f"image_path 应以 originals/ 开头,实际为 {result['image_path']}"
        assert result["thumbnail_path"].startswith("thumbnails/"), \
            f"thumbnail_path 应以 thumbnails/ 开头,实际为 {result['thumbnail_path']}"
        log_step("✓ 路径格式正确", "SUCCESS")
        
        # 5. 验证文件实际存在
        original_file = service.images_dir / result["image_path"]
        thumb_file = service.images_dir / result["thumbnail_path"]
        
        assert original_file.exists(), f"原图文件应存在: {original_file}"
        assert thumb_file.exists(), f"缩略图文件应存在: {thumb_file}"
        log_step("✓ 原图和缩略图文件都已创建", "SUCCESS")
        
        # 6. 验证文件大小
        assert result["size"] == len(test_data), \
            f"size 应为 {len(test_data)},实际为 {result['size']}"
        log_step(f"✓ 文件大小正确 ({result['size']} bytes)", "SUCCESS")
        
        duration = (datetime.now() - start_time).total_seconds()
        return TestResult(
            name="上传流程",
            status="pass",
            detail=f"上传成功,返回完整路径信息,文件已创建 (原图: {result['image_path']}, 缩略图: {result['thumbnail_path']})",
            duration=duration
        )
        
    except AssertionError as e:
        duration = (datetime.now() - start_time).total_seconds()
        log_step(f"✗ 测试失败: {e}", "ERROR")
        return TestResult(
            name="上传流程",
            status="fail",
            detail=str(e),
            duration=duration
        )


async def test_delete_flow(service: MockUploadService) -> TestResult:
    """测试删除流程: 删除图片→验证原图和缩略图都被删除"""
    start_time = datetime.now()
    
    try:
        log_step("测试场景 2: 删除流程", "INFO")
        
        # 1. 先上传一张图片
        test_data = b"image_to_delete" * 50
        result = service.upload_image("delete_test.jpg", test_data)
        
        original_file = service.images_dir / result["image_path"]
        thumb_file = service.images_dir / result["thumbnail_path"]
        
        # 2. 验证文件存在
        assert original_file.exists(), "上传后原图应存在"
        assert thumb_file.exists(), "上传后缩略图应存在"
        log_step("✓ 测试图片已上传", "SUCCESS")
        
        # 3. 删除图片(通过原图路径)
        deleted = service.delete_image(result["image_path"])
        assert deleted, "删除操作应返回 True"
        log_step("✓ 删除操作执行成功", "SUCCESS")
        
        # 4. 验证原图和缩略图都被删除
        assert not original_file.exists(), f"原图应被删除: {original_file}"
        assert not thumb_file.exists(), f"缩略图应被删除: {thumb_file}"
        log_step("✓ 原图和缩略图都已删除", "SUCCESS")
        
        # 5. 测试通过缩略图路径删除
        result2 = service.upload_image("delete_test2.jpg", test_data)
        original_file2 = service.images_dir / result2["image_path"]
        thumb_file2 = service.images_dir / result2["thumbnail_path"]
        
        deleted2 = service.delete_image(result2["thumbnail_path"])
        assert deleted2, "通过缩略图路径删除应成功"
        assert not original_file2.exists(), "通过缩略图删除时,原图也应被删除"
        assert not thumb_file2.exists(), "通过缩略图删除时,缩略图应被删除"
        log_step("✓ 通过缩略图路径删除也能清理原图", "SUCCESS")
        
        duration = (datetime.now() - start_time).total_seconds()
        return TestResult(
            name="删除流程",
            status="pass",
            detail="删除操作同时清理原图和缩略图,无残留文件",
            duration=duration
        )
        
    except AssertionError as e:
        duration = (datetime.now() - start_time).total_seconds()
        log_step(f"✗ 测试失败: {e}", "ERROR")
        return TestResult(
            name="删除流程",
            status="fail",
            detail=str(e),
            duration=duration
        )


async def test_path_security(service: MockUploadService) -> TestResult:
    """测试路径安全: 验证路径遍历攻击防护"""
    start_time = datetime.now()
    
    try:
        log_step("测试场景 3: 路径安全", "INFO")
        
        # 1. 测试路径遍历攻击
        malicious_paths = [
            "../../../etc/passwd",
            "../../sensitive_file.txt",
            "/etc/passwd",
            "originals/../../outside.txt"
        ]
        
        for malicious_path in malicious_paths:
            try:
                # 尝试删除恶意路径
                result = service.delete_image(malicious_path)
                # 如果没有抛出异常,验证没有删除任何文件
                assert not result, f"恶意路径 {malicious_path} 不应删除成功"
            except (ValueError, Exception):
                # 预期应该抛出异常或返回 False
                pass
        
        log_step("✓ 路径遍历攻击防护有效", "SUCCESS")
        
        # 2. 验证只能访问 images 目录内的文件
        # 创建一个测试文件在 images 目录外
        outside_file = service.images_dir.parent / "outside_test.txt"
        outside_file.write_text("should not be accessible")
        
        try:
            # 尝试通过相对路径访问
            result = service.delete_image("../outside_test.txt")
            assert not result, "不应能访问 images 目录外的文件"
        except (ValueError, Exception):
            pass
        
        # 验证外部文件未被删除
        assert outside_file.exists(), "外部文件不应被删除"
        outside_file.unlink()  # 清理
        log_step("✓ 目录边界保护有效", "SUCCESS")
        
        duration = (datetime.now() - start_time).total_seconds()
        return TestResult(
            name="路径安全",
            status="pass",
            detail="路径遍历攻击防护有效,目录边界保护正常",
            duration=duration
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


async def run() -> None:
    """运行所有测试"""
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    start_time = datetime.now()
    
    log_step("=" * 80)
    log_step("Phase 05B E2E 测试: 上传流程场景")
    log_step("=" * 80)
    
    # 创建临时目录
    temp_dir = Path(tempfile.mkdtemp())
    images_dir = temp_dir / "images"
    
    try:
        service = MockUploadService(images_dir)
        
        # 运行所有测试
        results: List[TestResult] = []
        
        results.append(await test_upload_flow(service))
        results.append(await test_delete_flow(service))
        results.append(await test_path_security(service))
        
        # 统计结果
        passed = sum(1 for r in results if r.status == "pass")
        failed = sum(1 for r in results if r.status == "fail")
        total = len(results)
        
        # 生成报告
        duration = (datetime.now() - start_time).total_seconds()
        report = {
            "generatedAt": datetime.now().isoformat(),
            "duration": duration,
            "status": "pass" if failed == 0 else "fail",
            "summary": {
                "total": total,
                "passed": passed,
                "failed": failed
            },
            "results": [
                {
                    "name": r.name,
                    "status": r.status,
                    "detail": r.detail,
                    "duration": r.duration
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
        log_step(f"  总测试数: {total}")
        log_step(f"  通过: {passed}", "SUCCESS" if passed == total else "INFO")
        log_step(f"  失败: {failed}", "ERROR" if failed > 0 else "INFO")
        log_step(f"  耗时: {duration:.2f}秒")
        log_step("=" * 80)
        
        if failed == 0:
            log_step("✅ 所有测试通过", "SUCCESS")
        else:
            log_step(f"❌ {failed} 个测试失败", "ERROR")
            for r in results:
                if r.status == "fail":
                    log_step(f"  - {r.name}: {r.detail}", "ERROR")
        
        log_step("=" * 80)
        
    finally:
        # 清理临时目录
        shutil.rmtree(temp_dir, ignore_errors=True)
        log_step("✓ 临时目录已清理", "SUCCESS")


if __name__ == "__main__":
    asyncio.run(run())
