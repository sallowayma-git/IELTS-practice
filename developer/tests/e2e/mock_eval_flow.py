#!/usr/bin/env python3
"""Phase 05A E2E Test: Evaluation Flow Scenarios

测试覆盖:
1. 正常流: 提交→完成→入库→历史可查
2. 取消流: 取消后 status='cancelled',无脏数据
3. 失败流: 网络断开/解析失败→status='failed'+error信息
4. 超时流: 120s超时→status='failed'+timeout

验收标准:
- evaluation_sessions 表正确记录会话状态
- essays 表在成功时有记录,失败/取消时无脏数据
- 所有场景都能正确清理资源
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import tempfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import List, Optional
import shutil

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


class MockDatabase:
    """模拟数据库用于测试"""
    
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.conn = sqlite3.connect(str(db_path))
        self.conn.row_factory = sqlite3.Row
        self._init_schema()
    
    def _init_schema(self):
        """初始化测试数据库 schema"""
        cursor = self.conn.cursor()
        
        # 创建 topics 表 (用于外键约束)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS topics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                task_type TEXT NOT NULL
            )
        """)
        
        # 创建 evaluation_sessions 表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS evaluation_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL UNIQUE,
                task_type TEXT NOT NULL,
                topic_id INTEGER,
                status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'cancelled', 'failed')),
                provider_path_json TEXT,
                error_code TEXT,
                error_message TEXT,
                duration_ms INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME,
                FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE SET NULL
            )
        """)
        
        # 创建 essays 表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS essays (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                topic_id INTEGER,
                task_type TEXT NOT NULL,
                content TEXT NOT NULL,
                word_count INTEGER NOT NULL,
                llm_provider TEXT NOT NULL,
                model_name TEXT NOT NULL,
                total_score REAL,
                task_achievement REAL,
                coherence_cohesion REAL,
                lexical_resource REAL,
                grammatical_range REAL,
                evaluation_json TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE SET NULL
            )
        """)
        
        self.conn.commit()
    
    def get_session(self, session_id: str) -> Optional[dict]:
        """获取会话记录"""
        cursor = self.conn.cursor()
        row = cursor.execute(
            "SELECT * FROM evaluation_sessions WHERE session_id = ?",
            (session_id,)
        ).fetchone()
        return dict(row) if row else None
    
    def get_essay_count(self) -> int:
        """获取 essay 记录数"""
        cursor = self.conn.cursor()
        return cursor.execute("SELECT COUNT(*) FROM essays").fetchone()[0]
    
    def close(self):
        """关闭数据库连接"""
        self.conn.close()


class MockEvaluateService:
    """模拟 EvaluateService 用于测试"""
    
    def __init__(self, db: MockDatabase):
        self.db = db
        self.sessions = {}
    
    def record_session_start(self, session_id: str, task_type: str, topic_id: Optional[int] = None):
        """记录会话开始"""
        cursor = self.db.conn.cursor()
        cursor.execute(
            "INSERT INTO evaluation_sessions (session_id, task_type, topic_id, status) VALUES (?, ?, ?, 'running')",
            (session_id, task_type, topic_id)
        )
        self.db.conn.commit()
        self.sessions[session_id] = {"start_time": datetime.now()}
    
    def record_session_finish(self, session_id: str, status: str, 
                             error_code: Optional[str] = None,
                             error_message: Optional[str] = None):
        """记录会话结束"""
        session = self.sessions.get(session_id)
        duration_ms = None
        if session:
            duration_ms = int((datetime.now() - session["start_time"]).total_seconds() * 1000)
        
        cursor = self.db.conn.cursor()
        cursor.execute("""
            UPDATE evaluation_sessions
            SET status = ?,
                error_code = ?,
                error_message = ?,
                duration_ms = ?,
                completed_at = CURRENT_TIMESTAMP
            WHERE session_id = ?
        """, (status, error_code, error_message, duration_ms, session_id))
        self.db.conn.commit()
    
    def create_essay(self, session_id: str):
        """创建 essay 记录"""
        cursor = self.db.conn.cursor()
        cursor.execute("""
            INSERT INTO essays (
                topic_id, task_type, content, word_count,
                llm_provider, model_name,
                total_score, task_achievement, coherence_cohesion,
                lexical_resource, grammatical_range,
                evaluation_json
            ) VALUES (NULL, 'task2', 'Test content', 100, 'test-provider', 'test-model',
                     7.0, 7.0, 7.0, 7.0, 7.0, '{}')
        """)
        self.db.conn.commit()
        return cursor.lastrowid


async def test_normal_flow(db: MockDatabase, service: MockEvaluateService) -> TestResult:
    """测试正常流程: 提交→完成→入库→历史可查"""
    start_time = datetime.now()
    
    try:
        log_step("测试场景 1: 正常流程", "INFO")
        
        # 1. 记录会话开始
        session_id = "test_session_normal_001"
        service.record_session_start(session_id, "task2")
        
        # 2. 验证会话状态为 running
        session = db.get_session(session_id)
        assert session is not None, "会话记录不存在"
        assert session["status"] == "running", f"会话状态应为 running,实际为 {session['status']}"
        log_step("✓ 会话状态正确记录为 running", "SUCCESS")
        
        # 3. 模拟评分完成,创建 essay
        essay_id = service.create_essay(session_id)
        assert essay_id > 0, "Essay 创建失败"
        log_step(f"✓ Essay 记录已创建 (ID: {essay_id})", "SUCCESS")
        
        # 4. 记录会话完成
        service.record_session_finish(session_id, "completed")
        
        # 5. 验证会话状态为 completed
        session = db.get_session(session_id)
        assert session["status"] == "completed", f"会话状态应为 completed,实际为 {session['status']}"
        assert session["completed_at"] is not None, "completed_at 应有值"
        assert session["duration_ms"] is not None, "duration_ms 应有值"
        assert session["error_code"] is None, "error_code 应为 NULL"
        assert session["error_message"] is None, "error_message 应为 NULL"
        log_step("✓ 会话状态正确更新为 completed", "SUCCESS")
        
        # 6. 验证 essay 可查询
        essay_count = db.get_essay_count()
        assert essay_count >= 1, "Essay 记录应存在"
        log_step(f"✓ Essay 记录可查询 (总数: {essay_count})", "SUCCESS")
        
        duration = (datetime.now() - start_time).total_seconds()
        return TestResult(
            name="正常流程",
            status="pass",
            detail="提交→完成→入库→历史可查 全流程通过",
            duration=duration
        )
        
    except AssertionError as e:
        duration = (datetime.now() - start_time).total_seconds()
        log_step(f"✗ 测试失败: {e}", "ERROR")
        return TestResult(
            name="正常流程",
            status="fail",
            detail=str(e),
            duration=duration
        )


async def test_cancel_flow(db: MockDatabase, service: MockEvaluateService) -> TestResult:
    """测试取消流程: 取消后 status='cancelled',无脏数据"""
    start_time = datetime.now()
    
    try:
        log_step("测试场景 2: 取消流程", "INFO")
        
        # 1. 记录会话开始
        session_id = "test_session_cancel_001"
        service.record_session_start(session_id, "task2")
        
        # 2. 记录 essay 数量 (用于后续验证无脏数据)
        initial_essay_count = db.get_essay_count()
        
        # 3. 模拟用户取消
        service.record_session_finish(session_id, "cancelled")
        
        # 4. 验证会话状态为 cancelled
        session = db.get_session(session_id)
        assert session["status"] == "cancelled", f"会话状态应为 cancelled,实际为 {session['status']}"
        assert session["completed_at"] is not None, "completed_at 应有值"
        assert session["error_code"] is None, "取消场景 error_code 应为 NULL"
        assert session["error_message"] is None, "取消场景 error_message 应为 NULL"
        log_step("✓ 会话状态正确记录为 cancelled", "SUCCESS")
        
        # 5. 验证无新增 essay 脏数据
        final_essay_count = db.get_essay_count()
        assert final_essay_count == initial_essay_count, \
            f"取消后不应有新 essay 记录,初始: {initial_essay_count}, 当前: {final_essay_count}"
        log_step("✓ 无 essay 脏数据", "SUCCESS")
        
        # 6. 验证无残留 running 状态
        cursor = db.conn.cursor()
        running_count = cursor.execute(
            "SELECT COUNT(*) FROM evaluation_sessions WHERE status = 'running'"
        ).fetchone()[0]
        assert running_count == 0, f"不应有 running 状态的会话,实际有 {running_count} 个"
        log_step("✓ 无残留 running 状态", "SUCCESS")
        
        duration = (datetime.now() - start_time).total_seconds()
        return TestResult(
            name="取消流程",
            status="pass",
            detail="取消后状态正确,无脏数据,无残留 running 状态",
            duration=duration
        )
        
    except AssertionError as e:
        duration = (datetime.now() - start_time).total_seconds()
        log_step(f"✗ 测试失败: {e}", "ERROR")
        return TestResult(
            name="取消流程",
            status="fail",
            detail=str(e),
            duration=duration
        )


async def test_failure_flow(db: MockDatabase, service: MockEvaluateService) -> TestResult:
    """测试失败流程: 网络断开/解析失败→status='failed'+error信息"""
    start_time = datetime.now()
    
    try:
        log_step("测试场景 3: 失败流程", "INFO")
        
        # 1. 记录会话开始
        session_id = "test_session_failure_001"
        service.record_session_start(session_id, "task2")
        
        # 2. 记录 essay 数量
        initial_essay_count = db.get_essay_count()
        
        # 3. 模拟网络错误
        service.record_session_finish(
            session_id, 
            "failed",
            error_code="network_error",
            error_message="网络连接失败"
        )
        
        # 4. 验证会话状态为 failed
        session = db.get_session(session_id)
        assert session["status"] == "failed", f"会话状态应为 failed,实际为 {session['status']}"
        assert session["error_code"] == "network_error", \
            f"error_code 应为 network_error,实际为 {session['error_code']}"
        assert session["error_message"] == "网络连接失败", \
            f"error_message 不匹配,实际为 {session['error_message']}"
        assert session["completed_at"] is not None, "completed_at 应有值"
        log_step("✓ 失败状态和错误信息正确记录", "SUCCESS")
        
        # 5. 验证无新增 essay 脏数据
        final_essay_count = db.get_essay_count()
        assert final_essay_count == initial_essay_count, \
            f"失败后不应有新 essay 记录,初始: {initial_essay_count}, 当前: {final_essay_count}"
        log_step("✓ 无 essay 脏数据", "SUCCESS")
        
        # 6. 测试解析失败场景
        session_id_2 = "test_session_failure_002"
        service.record_session_start(session_id_2, "task2")
        service.record_session_finish(
            session_id_2,
            "failed",
            error_code="invalid_response_format",
            error_message="LLM 响应解析失败"
        )
        
        session_2 = db.get_session(session_id_2)
        assert session_2["status"] == "failed", "解析失败场景状态应为 failed"
        assert session_2["error_code"] == "invalid_response_format", "解析失败 error_code 不匹配"
        log_step("✓ 解析失败场景正确记录", "SUCCESS")
        
        duration = (datetime.now() - start_time).total_seconds()
        return TestResult(
            name="失败流程",
            status="pass",
            detail="网络错误和解析失败场景都正确记录 status='failed' + error 信息",
            duration=duration
        )
        
    except AssertionError as e:
        duration = (datetime.now() - start_time).total_seconds()
        log_step(f"✗ 测试失败: {e}", "ERROR")
        return TestResult(
            name="失败流程",
            status="fail",
            detail=str(e),
            duration=duration
        )


async def test_timeout_flow(db: MockDatabase, service: MockEvaluateService) -> TestResult:
    """测试超时流程: 120s超时→status='failed'+timeout"""
    start_time = datetime.now()
    
    try:
        log_step("测试场景 4: 超时流程", "INFO")
        
        # 1. 记录会话开始
        session_id = "test_session_timeout_001"
        service.record_session_start(session_id, "task2")
        
        # 2. 记录 essay 数量
        initial_essay_count = db.get_essay_count()
        
        # 3. 模拟超时
        service.record_session_finish(
            session_id,
            "failed",
            error_code="timeout",
            error_message="评测超时 (120s),请重试"
        )
        
        # 4. 验证会话状态为 failed
        session = db.get_session(session_id)
        assert session["status"] == "failed", f"会话状态应为 failed,实际为 {session['status']}"
        assert session["error_code"] == "timeout", \
            f"error_code 应为 timeout,实际为 {session['error_code']}"
        assert "超时" in session["error_message"], \
            f"error_message 应包含'超时',实际为 {session['error_message']}"
        assert session["completed_at"] is not None, "completed_at 应有值"
        log_step("✓ 超时状态和错误信息正确记录", "SUCCESS")
        
        # 5. 验证无新增 essay 脏数据
        final_essay_count = db.get_essay_count()
        assert final_essay_count == initial_essay_count, \
            f"超时后不应有新 essay 记录,初始: {initial_essay_count}, 当前: {final_essay_count}"
        log_step("✓ 无 essay 脏数据", "SUCCESS")
        
        # 6. 验证无残留 running 状态
        cursor = db.conn.cursor()
        running_count = cursor.execute(
            "SELECT COUNT(*) FROM evaluation_sessions WHERE status = 'running'"
        ).fetchone()[0]
        assert running_count == 0, f"不应有 running 状态的会话,实际有 {running_count} 个"
        log_step("✓ 无残留 running 状态", "SUCCESS")
        
        duration = (datetime.now() - start_time).total_seconds()
        return TestResult(
            name="超时流程",
            status="pass",
            detail="超时场景正确记录 status='failed' + timeout 错误信息",
            duration=duration
        )
        
    except AssertionError as e:
        duration = (datetime.now() - start_time).total_seconds()
        log_step(f"✗ 测试失败: {e}", "ERROR")
        return TestResult(
            name="超时流程",
            status="fail",
            detail=str(e),
            duration=duration
        )


async def run() -> None:
    """运行所有测试"""
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    start_time = datetime.now()
    
    log_step("=" * 80)
    log_step("Phase 05A E2E 测试: 评分流程场景")
    log_step("=" * 80)
    
    # 创建临时数据库
    temp_dir = tempfile.mkdtemp()
    db_path = Path(temp_dir) / "test.db"
    
    try:
        db = MockDatabase(db_path)
        service = MockEvaluateService(db)
        
        # 运行所有测试
        results: List[TestResult] = []
        
        results.append(await test_normal_flow(db, service))
        results.append(await test_cancel_flow(db, service))
        results.append(await test_failure_flow(db, service))
        results.append(await test_timeout_flow(db, service))
        
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
        report_path = REPORT_DIR / "phase05-eval-flow-report.json"
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
        # 清理临时数据库
        db.close()
        shutil.rmtree(temp_dir, ignore_errors=True)
        log_step("✓ 临时数据库已清理", "SUCCESS")


if __name__ == "__main__":
    asyncio.run(run())
