#!/usr/bin/env python3
"""Phase 05 E2E Test: Compose -> Evaluating -> Result chain via local HTTP/SSE/DB.

This test only touches real local runtime surfaces:
1) Compose phase: POST /api/evaluate creates a real session_id
2) Evaluating phase: GET /api/evaluate/:sessionId/stream yields SSE events to completion
3) Result phase: essay_id is persisted and queryable from DB and /api/essays/:id

No in-process mock of evaluate/topic/essay services is used.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sqlite3
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

try:
    import requests
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests", "-q"])
    import requests

try:
    import sseclient
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "sseclient-py", "-q"])
    import sseclient


REPO_ROOT = Path(__file__).resolve().parents[3]
REPORT_DIR = REPO_ROOT / "developer" / "tests" / "e2e" / "reports"
STANDALONE_SERVER = REPO_ROOT / "developer" / "tests" / "e2e" / "standalone-api-server.cjs"

DEFAULT_DB_PATH = Path.home() / "Library" / "Application Support" / "ielts-practice" / "ielts-writing.db"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_API_PORT = 3000
API_KEY_ENV_VARS = (
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "DEEPSEEK_API_KEY",
    "IELTS_WRITING_TEST_API_KEY",
)
DEFAULT_PROVIDER_NAME = "openai"


def log_step(message: str, level: str = "INFO") -> None:
    timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    prefix = {
        "INFO": "ℹ️",
        "SUCCESS": "✅",
        "WARNING": "⚠️",
        "ERROR": "❌",
        "DEBUG": "🔍",
    }.get(level, "•")
    print(f"[{timestamp}] {prefix} {message}")


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((DEFAULT_HOST, 0))
        return int(sock.getsockname()[1])


def split_text(text: str, size: int) -> List[str]:
    return [text[i : i + size] for i in range(0, len(text), size)]


def build_tiptap_doc(text: str) -> str:
    return json.dumps(
        {
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [{"type": "text", "text": text}],
                }
            ],
        },
        ensure_ascii=False,
    )


def extract_text_from_tiptap(value: Any) -> str:
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return value.strip()
        return extract_text_from_tiptap(parsed)

    if isinstance(value, dict):
        node_type = value.get("type")
        if node_type == "text":
            return str(value.get("text") or "")
        parts: List[str] = []
        for item in value.get("content") or []:
            parts.append(extract_text_from_tiptap(item))
        return "".join(parts)

    if isinstance(value, list):
        return "".join(extract_text_from_tiptap(item) for item in value)

    return ""


def build_stage1_fixture() -> Dict[str, Any]:
    return {
        "total_score": 6.5,
        "task_achievement": 6.5,
        "coherence_cohesion": 6.0,
        "lexical_resource": 6.5,
        "grammatical_range": 6.0,
        "task_analysis": {
            "prompt_response_quality": "Addresses the prompt directly with a clear position.",
            "position_clarity": "The stance is explicit and remains consistent.",
            "argument_development": "Main ideas are relevant but examples are still generic.",
            "conclusion_effectiveness": "The conclusion restates the position but could be sharper.",
        },
        "band_rationale": {
            "task_achievement": "Addresses the prompt with partially developed support.",
            "coherence_cohesion": "Logical flow works, linking can be tighter.",
            "lexical_resource": "Adequate range with occasional repetition.",
            "grammatical_range": "Mix of simple and complex structures with non-blocking slips.",
        },
        "improvement_plan": [
            "Add one concrete example with causal explanation.",
            "Tighten the concluding sentence so it closes the argument more decisively.",
        ],
        "input_context": {
            "prompt_summary": "Discuss both views on transport funding and give a clear opinion.",
            "required_points": [
                "Discuss both sides",
                "State a clear opinion",
                "Support the opinion with reasons",
            ],
            "major_risks": [
                "Examples remain generic",
                "Linking between paragraphs can be tighter",
            ],
        },
    }


def build_stage2_fixture() -> Dict[str, Any]:
    return {
        "review_blocks": [
            {
                "paragraph_index": 1,
                "comment": "Clear position sentence.",
                "analysis": "Support sentence can be more concrete.",
                "feedback": "Add one concrete example to strengthen the paragraph.",
            }
        ],
        "sentences": [
            {
                "index": 1,
                "original": "This is a deterministic local E2E evaluation sentence.",
                "errors": [],
            }
        ],
        "improvement_plan": [
            "Add one concrete example with causal explanation.",
            "Increase lexical variety for repeated nouns.",
        ],
        "overall_feedback": "Deterministic local E2E feedback for integration verification.",
        "rewrite_suggestions": [
            "Rewrite the second sentence with a concrete example and a clearer cause-effect link."
        ],
    }


def build_invalid_stage2_fixture() -> Dict[str, Any]:
    return {
        "review_blocks": [],
        "sentences": "invalid",
        "improvement_plan": [],
        "overall_feedback": "",
        "rewrite_suggestions": [],
    }


def build_long_essay_text() -> str:
    sentence = (
        "Governments should evaluate both social impact and long-term sustainability "
        "when funding urban transport projects. "
    )
    return (sentence * 28).strip()


@dataclass
class TestResult:
    name: str
    status: str
    detail: str
    duration: float
    evidence: Optional[Dict[str, Any]] = None

    def as_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "status": self.status,
            "detail": self.detail,
            "duration": self.duration,
            "evidence": self.evidence,
        }


class PreconditionSkip(RuntimeError):
    """Raised when required runtime preconditions are missing."""


def resolve_electron_bin(repo_root: Path) -> Optional[Path]:
    bin_name = "electron.cmd" if os.name == "nt" else "electron"
    candidate = repo_root / "node_modules" / ".bin" / bin_name
    if candidate.exists():
        return candidate
    return None


class LocalLLMStub:
    def __init__(self) -> None:
        self.port = find_free_port()
        self.host = DEFAULT_HOST
        self.base_url = f"http://{self.host}:{self.port}"
        self.server: Optional[ThreadingHTTPServer] = None
        self.thread: Optional[threading.Thread] = None
        self.reset()

    def reset(self, stage_fixtures: Optional[List[Dict[str, Any]]] = None) -> None:
        self.stage_fixtures = list(stage_fixtures or [build_stage1_fixture(), build_stage2_fixture()])
        self.stream_requests: List[Dict[str, Any]] = []
        self.stream_call_count = 0
        self.last_stream_request: Optional[Dict[str, Any]] = None

    def start(self) -> None:
        parent = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args: Any, **_kwargs: Any) -> None:
                return

            def _write_json(self, code: int, payload: Dict[str, Any]) -> None:
                body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self) -> None:  # noqa: N802
                if self.path != "/chat/completions":
                    self._write_json(404, {"error": {"message": "not found"}})
                    return

                raw = self.rfile.read(int(self.headers.get("Content-Length", "0") or 0))
                try:
                    req = json.loads(raw.decode("utf-8") or "{}")
                except json.JSONDecodeError:
                    self._write_json(400, {"error": {"message": "invalid json"}})
                    return

                if bool(req.get("stream")):
                    parent.stream_call_count += 1
                    parent.stream_requests.append(req)
                    parent.last_stream_request = req

                if not bool(req.get("stream")):
                    self._write_json(
                        200,
                        {
                            "id": "chatcmpl-local-test",
                            "object": "chat.completion",
                            "choices": [
                                {
                                    "index": 0,
                                    "message": {"role": "assistant", "content": "ok"},
                                    "finish_reason": "stop",
                                }
                            ],
                        },
                    )
                    return

                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "keep-alive")
                self.end_headers()

                fixture_idx = max(0, min(parent.stream_call_count - 1, len(parent.stage_fixtures) - 1))
                fixture_payload = json.dumps(parent.stage_fixtures[fixture_idx], ensure_ascii=False)
                for piece in split_text(fixture_payload, 24):
                    chunk = {
                        "id": f"chatcmpl-local-test-{parent.stream_call_count}",
                        "object": "chat.completion.chunk",
                        "choices": [{"index": 0, "delta": {"content": piece}, "finish_reason": None}],
                    }
                    data = f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n".encode("utf-8")
                    self.wfile.write(data)
                    self.wfile.flush()
                    time.sleep(0.01)

                final_chunk = {
                    "id": "chatcmpl-local-test",
                    "object": "chat.completion.chunk",
                    "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                }
                self.wfile.write(f"data: {json.dumps(final_chunk, ensure_ascii=False)}\n\n".encode("utf-8"))
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()

        self.server = ThreadingHTTPServer((self.host, self.port), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        log_step(f"Local deterministic LLM stub started: {self.base_url}", "DEBUG")

    def stop(self) -> None:
        if self.server:
            self.server.shutdown()
            self.server.server_close()
            self.server = None
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=2)
        self.thread = None


class ApiRuntime:
    def __init__(self, api_base: str, db_path: Path, allow_spawn_standalone: bool = True):
        self.api_base = api_base.rstrip("/")
        self.db_path = db_path
        self.allow_spawn_standalone = allow_spawn_standalone
        self.spawned_process: Optional[subprocess.Popen[str]] = None
        self.spawned: bool = False
        self.spawn_error: Optional[str] = None
        self.spawn_attempts: List[Dict[str, Any]] = []
        self.spawn_command: Optional[str] = None
        self.http = requests.Session()
        # Disable env proxy for localhost calls; otherwise local failures can be masked by proxy 503.
        self.http.trust_env = False

    def _request(self, method: str, endpoint: str, **kwargs: Any) -> requests.Response:
        url = f"{self.api_base}{endpoint}"
        if "timeout" not in kwargs:
            kwargs["timeout"] = 30
        return self.http.request(method=method, url=url, **kwargs)

    def health(self) -> Tuple[bool, str]:
        try:
            resp = self._request("GET", "/health")
            if resp.status_code != 200:
                return False, f"health status={resp.status_code}"
            payload = resp.json()
            if payload.get("success") is True:
                return True, "ok"
            return False, f"health success=false payload={payload}"
        except Exception as exc:  # noqa: BLE001
            return False, str(exc)

    def ensure_available(self) -> bool:
        ok, _ = self.health()
        if ok:
            return True

        if not self.allow_spawn_standalone:
            return False

        if not STANDALONE_SERVER.exists():
            self.spawn_error = f"standalone server not found: {STANDALONE_SERVER}"
            return False

        parsed = urlparse(self.api_base)
        requested_port = str(parsed.port or DEFAULT_API_PORT)
        env = os.environ.copy()
        env["WRITING_API_PORT"] = requested_port

        commands: List[List[str]] = []
        electron_bin = resolve_electron_bin(REPO_ROOT)
        if electron_bin:
            commands.append([str(electron_bin), str(STANDALONE_SERVER)])
        commands.append(["node", str(STANDALONE_SERVER)])

        self.spawned = True
        self.spawn_attempts = []
        self.spawn_command = None

        for command in commands:
            self.spawn_command = " ".join(command)
            proc = subprocess.Popen(
                command,
                cwd=str(REPO_ROOT),
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            self.spawned_process = proc

            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                if proc.poll() is not None:
                    stdout, stderr = proc.communicate(timeout=1)
                    self.spawn_attempts.append(
                        {
                            "command": self.spawn_command,
                            "status": "exited",
                            "exit_code": proc.returncode,
                            "error": self._summarize_spawn_error(stdout=stdout, stderr=stderr),
                        }
                    )
                    self.spawned_process = None
                    break

                ok, _ = self.health()
                if ok:
                    self.spawn_error = None
                    return True
                time.sleep(0.5)
            else:
                if proc.poll() is None:
                    proc.terminate()
                    try:
                        proc.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                stdout, stderr = proc.communicate(timeout=1)
                self.spawn_attempts.append(
                    {
                        "command": self.spawn_command,
                        "status": "timeout",
                        "error": self._summarize_spawn_error(stdout=stdout, stderr=stderr),
                    }
                )
                self.spawned_process = None

        self.spawn_error = self._build_spawn_error_message()
        return False

    @staticmethod
    def _summarize_spawn_error(stdout: str, stderr: str) -> str:
        output = (stdout or "").strip()
        err = (stderr or "").strip()
        merged = " ".join(part for part in [output, err] if part).strip()
        if not merged:
            return "standalone exited without output"

        # Try to extract structured JSON error first.
        for line in merged.splitlines()[::-1]:
            line = line.strip()
            if "{" not in line:
                continue
            line = line[line.find("{") :]
            try:
                parsed = json.loads(line)
            except json.JSONDecodeError:
                continue
            message = parsed.get("error") or parsed.get("message") or str(parsed)
            return f"standalone exited: {str(message)[:240]}"

        compact = " ".join(merged.split())
        return f"standalone exited: {compact[:240]}"

    def _build_spawn_error_message(self) -> str:
        if not self.spawn_attempts:
            return "standalone server startup failed with unknown reason"
        parts = []
        for attempt in self.spawn_attempts:
            command = attempt.get("command") or "<unknown>"
            status = attempt.get("status") or "failed"
            error = attempt.get("error") or "no details"
            exit_code = attempt.get("exit_code")
            if exit_code is None:
                parts.append(f"{command} => {status}: {error}")
            else:
                parts.append(f"{command} => {status}({exit_code}): {error}")
        return " | ".join(parts)

    def stop(self) -> None:
        try:
            if self.spawned_process and self.spawned_process.poll() is None:
                self.spawned_process.terminate()
                try:
                    self.spawned_process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.spawned_process.kill()
            self.spawned_process = None
        finally:
            self.http.close()


class EvalFlowRunner:
    def __init__(
        self,
        runtime: ApiRuntime,
        provider_config: Optional[Dict[str, str]] = None,
        llm_stub: Optional[LocalLLMStub] = None,
    ):
        self.runtime = runtime
        self.provider_config = provider_config or {}
        self.llm_stub = llm_stub
        self.temp_config_id: Optional[int] = None
        self.initial_config_count: int = 0
        self.temp_config_mode: Optional[str] = None
        self.temp_config_error: Optional[str] = None
        self.temp_topic_id: Optional[int] = None

    def _reset_llm_stub(self, stage_fixtures: Optional[List[Dict[str, Any]]] = None) -> None:
        if self.llm_stub:
            self.llm_stub.reset(stage_fixtures)

    def _db(self) -> sqlite3.Connection:
        if not self.runtime.db_path.exists():
            raise FileNotFoundError(f"DB not found: {self.runtime.db_path}")
        conn = sqlite3.connect(str(self.runtime.db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def _api(self, method: str, endpoint: str, **kwargs: Any) -> Dict[str, Any]:
        resp = self.runtime._request(method, endpoint, **kwargs)
        try:
            payload = resp.json()
        except json.JSONDecodeError:
            text_preview = (resp.text or "")[:200]
            raise RuntimeError(
                f"{method} {endpoint} returned non-JSON response: "
                f"status={resp.status_code}, body={text_preview!r}"
            ) from None
        return {"status": resp.status_code, "payload": payload}

    def _list_configs(self) -> List[Dict[str, Any]]:
        result = self._api("GET", "/api/configs")
        if result["status"] != 200:
            raise RuntimeError(f"GET /api/configs status={result['status']}")
        payload = result["payload"]
        if payload.get("success") is not True:
            raise RuntimeError(f"GET /api/configs failed: {payload}")
        return list(payload.get("data") or [])

    def _create_temp_config(self, llm_base_url: str) -> Optional[int]:
        configs = self._list_configs()
        self.initial_config_count = len(configs)
        config_id, api_error = self._create_temp_config_via_api(llm_base_url)
        if config_id is not None:
            self.temp_config_mode = "api"
            self.temp_config_id = config_id
            return config_id

        config_id, clone_error = self._create_temp_config_via_db_clone(llm_base_url)
        if config_id is not None:
            self.temp_config_mode = "db_clone"
            self.temp_config_error = api_error
            self.temp_config_id = config_id
            return config_id

        reasons = [part for part in [api_error, clone_error] if part]
        self.temp_config_error = "; ".join(reasons) if reasons else "unknown reason"
        return None

    def _create_temp_config_via_api(self, llm_base_url: str) -> Tuple[Optional[int], Optional[str]]:
        config_name = f"phase05-e2e-local-{int(time.time())}"
        create_payload = {
            "config_name": config_name,
            "provider": self.provider_config.get("provider") or DEFAULT_PROVIDER_NAME,
            "base_url": llm_base_url,
            "api_key": self.provider_config.get("api_key") or "local-e2e-key",
            "default_model": self.provider_config.get("model") or "gpt-4o-mini",
            "priority": 1,
            "max_retries": 0,
        }
        try:
            result = self._api("POST", "/api/configs", json=create_payload)
        except Exception as exc:  # noqa: BLE001
            return None, f"POST /api/configs failed: {exc}"

        payload = result["payload"]
        if result["status"] != 200 or payload.get("success") is not True:
            return None, f"POST /api/configs rejected: status={result['status']}, payload={payload}"

        data = payload.get("data") or {}
        config_id = data.get("id")
        if not config_id:
            return None, f"POST /api/configs missing id: payload={payload}"

        config_id = int(config_id)
        try:
            self._api("PUT", f"/api/configs/{config_id}", json={"is_default": 1})
        except Exception:
            # Some standalone runtimes don't expose config write routes; explicit config_id still works.
            pass
        return config_id, None

    def _create_temp_config_via_db_clone(self, llm_base_url: str) -> Tuple[Optional[int], Optional[str]]:
        provider_name = self.provider_config.get("provider") or DEFAULT_PROVIDER_NAME
        provider_model = self.provider_config.get("model") or "gpt-4o-mini"
        with self._db() as conn:
            source = conn.execute(
                """
                SELECT id, api_key_encrypted
                FROM api_configs
                WHERE api_key_encrypted IS NOT NULL
                  AND LENGTH(api_key_encrypted) > 0
                ORDER BY is_default DESC, id ASC
                LIMIT 1
                """
            ).fetchone()
            if source is None:
                return None, "DB clone failed: no existing encrypted API key to clone"

            config_name = f"phase05-e2e-db-clone-{int(time.time())}"
            cursor = conn.execute(
                """
                INSERT INTO api_configs
                  (config_name, provider, base_url, api_key_encrypted, default_model, priority, max_retries, is_enabled, is_default)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0)
                """,
                (config_name, provider_name, llm_base_url, source["api_key_encrypted"], provider_model, 1, 0),
            )
            conn.commit()
            return int(cursor.lastrowid), None

    def _cleanup_temp_config(self) -> None:
        if self.temp_config_id is None:
            return
        try:
            with self._db() as conn:
                conn.execute("DELETE FROM api_configs WHERE id = ?", (self.temp_config_id,))
                conn.commit()
        except Exception as exc:  # noqa: BLE001
            log_step(f"临时配置清理失败 id={self.temp_config_id}: {exc}", "WARNING")
        finally:
            self.temp_config_id = None

    def _cleanup_test_artifacts(
        self,
        *,
        session_id: Optional[str],
        essay_id: Optional[int],
        topic_id: Optional[int],
        usage_before: Optional[int],
    ) -> None:
        try:
            with self._db() as conn:
                if essay_id is not None:
                    conn.execute("DELETE FROM essays WHERE id = ?", (essay_id,))
                if session_id:
                    conn.execute("DELETE FROM evaluation_sessions WHERE session_id = ?", (session_id,))

                if self.temp_topic_id is not None:
                    conn.execute("DELETE FROM topics WHERE id = ?", (self.temp_topic_id,))
                    self.temp_topic_id = None
                elif topic_id is not None and usage_before is not None:
                    conn.execute(
                        "UPDATE topics SET usage_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                        (usage_before, topic_id),
                    )

                conn.commit()
        except Exception as exc:  # noqa: BLE001
            log_step(f"测试产物清理失败: {exc}", "WARNING")

    def preflight_environment(self) -> TestResult:
        started = time.monotonic()
        env_keys = {name: bool(os.environ.get(name)) for name in API_KEY_ENV_VARS}
        has_env_key = any(env_keys.values())
        try:
            configs = self._list_configs()
        except Exception as exc:  # noqa: BLE001
            return TestResult(
                name="Preflight",
                status="fail",
                detail=f"读取 /api/configs 失败: {exc}",
                duration=time.monotonic() - started,
                evidence={
                    "api_key_env_presence": env_keys,
                    "validation_scope": "orchestration-only-with-local-deterministic-llm-stub",
                    "external_provider_coverage": "not_covered",
                },
            )

        enabled_count = sum(1 for item in configs if int(item.get("is_enabled") or 0) == 1)
        has_explicit_provider = bool(self.provider_config.get("api_key"))
        if has_explicit_provider:
            status = "pass"
            detail = (
                "前置检查通过：已显式提供外部 provider 配置。"
                "本次结果将覆盖真实外部模型 smoke。"
            )
            validation_scope = "external-live-provider-smoke"
            external_provider_coverage = "covered"
        elif enabled_count == 0 and not has_env_key:
            status = "skip"
            detail = (
                "外部模型前置条件缺失：无启用配置且未检测到 API key 环境变量。"
                "本次结果仅用于本地 deterministic stub 的链路验证，不代表真实外部模型可用性。"
            )
            validation_scope = "orchestration-only-with-local-deterministic-llm-stub"
            external_provider_coverage = "not_covered"
        else:
            status = "pass"
            detail = (
                "前置检查通过：本次运行使用本地 deterministic stub 验证编排链路；"
                "真实外部模型可用性不在该用例覆盖范围。"
            )
            validation_scope = "orchestration-only-with-local-deterministic-llm-stub"
            external_provider_coverage = "not_covered"

        return TestResult(
            name="Preflight",
            status=status,
            detail=detail,
            duration=time.monotonic() - started,
            evidence={
                "config_total": len(configs),
                "config_enabled": enabled_count,
                "api_key_env_presence": env_keys,
                "validation_scope": validation_scope,
                "external_provider_coverage": external_provider_coverage,
                "provider": self.provider_config.get("provider"),
                "provider_base_url": self.provider_config.get("base_url"),
                "provider_model": self.provider_config.get("model"),
            },
        )

    def _ensure_topic(self) -> Dict[str, Any]:
        result = self._api("GET", "/api/topics", params={"type": "task2", "page": 1, "limit": 1})
        payload = result["payload"]
        if result["status"] != 200 or payload.get("success") is not True:
            raise RuntimeError(f"GET /api/topics failed: {payload}")

        rows = payload.get("data") or []
        if rows:
            return rows[0]

        topic_payload = {
            "type": "task2",
            "category": "education",
            "difficulty": 3,
            "title_json": build_tiptap_doc("Some people think university education should be free."),
            "is_official": 0,
        }
        create = self._api("POST", "/api/topics", json=topic_payload)
        create_payload = create["payload"]
        if create["status"] != 200 or create_payload.get("success") is not True:
            raise RuntimeError(f"POST /api/topics failed: {create_payload}")
        topic_id = int(create_payload.get("topic_id"))
        self.temp_topic_id = topic_id

        with self._db() as conn:
            row = conn.execute("SELECT * FROM topics WHERE id = ?", (topic_id,)).fetchone()
        if row is None:
            raise RuntimeError(f"topic not found after creation: {topic_id}")
        return dict(row)

    def _topic_usage(self, topic_id: int) -> int:
        with self._db() as conn:
            row = conn.execute("SELECT usage_count FROM topics WHERE id = ?", (topic_id,)).fetchone()
            if not row:
                raise RuntimeError(f"topic missing for usage check: {topic_id}")
            return int(row["usage_count"] or 0)

    def _session_row(self, session_id: str) -> Optional[Dict[str, Any]]:
        with self._db() as conn:
            row = conn.execute(
                "SELECT * FROM evaluation_sessions WHERE session_id = ?", (session_id,)
            ).fetchone()
            return dict(row) if row else None

    def _essay_row(self, essay_id: int) -> Optional[Dict[str, Any]]:
        with self._db() as conn:
            row = conn.execute("SELECT * FROM essays WHERE id = ?", (essay_id,)).fetchone()
            return dict(row) if row else None

    def _table_count(self, table: str) -> int:
        allowed = {"evaluation_sessions", "essays"}
        if table not in allowed:
            raise ValueError(f"unsupported table count target: {table}")
        with self._db() as conn:
            row = conn.execute(f"SELECT COUNT(1) AS total FROM {table}").fetchone()
            return int(row["total"] or 0)

    @staticmethod
    def _normalize_probe_text(value: str) -> str:
        return " ".join((value or "").lower().split())

    def _assert_topic_prompt_included(self, expected_topic_text: str) -> Dict[str, Any]:
        if not self.llm_stub:
            return {"checked": False, "reason": "external provider mode"}
        request = (
            self.llm_stub.stream_requests[0]
            if self.llm_stub.stream_requests
            else self.llm_stub.last_stream_request
        )
        if not request:
            raise RuntimeError("local LLM stub missing captured stream request")

        messages = request.get("messages") or []
        message_blob = self._normalize_probe_text(json.dumps(messages, ensure_ascii=False))
        topic_probe = self._normalize_probe_text(expected_topic_text)[:32]
        if not topic_probe:
            raise RuntimeError("topic probe text is empty")
        if topic_probe not in message_blob:
            raise RuntimeError(
                "LLM stage1 request does not include topic text probe; task response scoring input is incomplete"
            )
        return {
            "checked": True,
            "topic_probe": topic_probe,
            "stage1_request_index": 1,
            "stream_call_count": self.llm_stub.stream_call_count,
        }

    def _assert_structured_stage_requests(self) -> Dict[str, Any]:
        if not self.llm_stub:
            return {"checked": False, "reason": "external provider mode"}
        if len(self.llm_stub.stream_requests) < 2:
            raise RuntimeError(
                f"Expected at least 2 captured stream requests, got {len(self.llm_stub.stream_requests)}"
            )

        stage1 = self.llm_stub.stream_requests[0]
        stage2 = self.llm_stub.stream_requests[1]
        stage1_format = ((stage1.get("response_format") or {}).get("json_schema") or {})
        stage2_format = ((stage2.get("response_format") or {}).get("json_schema") or {})
        stage1_name = str(stage1_format.get("name") or "")
        stage2_name = str(stage2_format.get("name") or "")

        if stage1_name != "ielts_task2_scoring_stage":
            raise RuntimeError(f"stage1 response_format mismatch: {stage1_name!r}")
        if stage2_name != "ielts_review_stage":
            raise RuntimeError(f"stage2 response_format mismatch: {stage2_name!r}")
        if stage1_format.get("strict") is not True:
            raise RuntimeError("stage1 response_format.strict must be true")
        if stage2_format.get("strict") is not True:
            raise RuntimeError("stage2 response_format.strict must be true")

        return {
            "checked": True,
            "stage1_schema_name": stage1_name,
            "stage2_schema_name": stage2_name,
            "stream_request_count": len(self.llm_stub.stream_requests),
        }

    def _assert_dual_stage_stream_contract(self, stream_result: Dict[str, Any]) -> Dict[str, Any]:
        events = [item for item in stream_result.get("events") or [] if isinstance(item, dict)]
        if not events:
            raise RuntimeError("SSE event list is empty")

        event_types = [str(item.get("type") or "").lower() for item in events]
        score_index = next((idx for idx, item in enumerate(event_types) if item == "score"), -1)
        if score_index < 0:
            raise RuntimeError("SSE missing stage1 evidence: no score event")

        stage1_stage_event = False
        stage2_stage_event = False
        stage_markers: List[str] = []
        for item in events:
            event_type = str(item.get("type") or "").lower()
            data = item.get("data")
            marker_parts = [event_type]
            if isinstance(data, dict):
                for key in ("stage", "phase", "name", "status", "message"):
                    value = data.get(key)
                    if value is not None:
                        marker_parts.append(str(value).lower())
            elif isinstance(data, str):
                marker_parts.append(data.lower())
            marker = " ".join(marker_parts)
            if event_type == "analysis" or any(tag in marker for tag in ("stage1", "stage_1", "scoring")):
                stage1_stage_event = True
                stage_markers.append(marker)
            if event_type == "review" or any(tag in marker for tag in ("stage2", "stage_2", "review")):
                stage2_stage_event = True
                stage_markers.append(marker)

        stage2_index = next(
            (
                idx
                for idx, item in enumerate(event_types)
                if item in {"review", "sentence", "feedback"} and idx > score_index
            ),
            -1,
        )
        if stage2_index < 0:
            raise RuntimeError(
                "SSE missing stage2 evidence: no review/sentence/feedback event after score"
            )

        if self.llm_stub:
            if self.llm_stub.stream_call_count < 2:
                raise RuntimeError(
                    "Expected at least 2 LLM stream calls for dual-stage pipeline, "
                    f"got {self.llm_stub.stream_call_count}"
                )

        return {
            "score_event_index": score_index,
            "stage2_event_index": stage2_index,
            "event_types": event_types,
            "explicit_stage1_event": stage1_stage_event,
            "explicit_stage2_event": stage2_stage_event,
            "stage_markers": stage_markers[:10],
            "llm_stream_call_count": self.llm_stub.stream_call_count if self.llm_stub else None,
        }

    def _assert_review_degraded_stream_contract(self, stream_result: Dict[str, Any]) -> Dict[str, Any]:
        events = [item for item in stream_result.get("events") or [] if isinstance(item, dict)]
        event_types = [str(item.get("type") or "").lower() for item in events]

        if "error" in event_types:
            raise RuntimeError("review degraded flow must not emit error event")
        if "complete" not in event_types:
            raise RuntimeError("review degraded flow missing complete event")

        degraded_stage = next(
            (
                item
                for item in events
                if str(item.get("type") or "").lower() == "stage"
                and isinstance(item.get("data"), dict)
                and str(item["data"].get("name") or "").lower() == "review"
                and str(item["data"].get("status") or "").lower() == "degraded"
            ),
            None,
        )
        if degraded_stage is None:
            raise RuntimeError("review degraded flow missing degraded stage event")

        review_event = next(
            (item for item in events if str(item.get("type") or "").lower() == "review"),
            None,
        )
        if review_event is None:
            raise RuntimeError("review degraded flow missing review event")

        feedback_event = next(
            (item for item in events if str(item.get("type") or "").lower() == "feedback"),
            None,
        )
        if feedback_event is None:
            raise RuntimeError("review degraded flow missing feedback event")
        complete_event = next(
            (item for item in events if str(item.get("type") or "").lower() == "complete"),
            None,
        )
        if complete_event is None:
            raise RuntimeError("review degraded flow missing complete payload")
        if (complete_event.get("data") or {}).get("review_degraded") is not True:
            raise RuntimeError("degraded complete event must carry review_degraded=true")
        if not isinstance((complete_event.get("data") or {}).get("review_status"), dict):
            raise RuntimeError("degraded complete event must carry review_status object")
        if (complete_event.get("data") or {}).get("review_status", {}).get("status") != "degraded":
            raise RuntimeError("degraded complete event review_status.status must be degraded")
        if (complete_event.get("data") or {}).get("review_status", {}).get("degraded") is not True:
            raise RuntimeError("degraded complete event review_status.degraded must be true")

        if any(str(item.get("type") or "").lower() == "sentence" for item in events):
            raise RuntimeError("review degraded flow should not emit sentence events")

        review_data = review_event.get("data") or {}
        if (review_data.get("review_blocks") or review_data.get("paragraph_reviews") or []) != []:
            raise RuntimeError("degraded review event should expose empty review blocks")

        feedback_text = str(feedback_event.get("data") or "")
        if "第二阶段详解生成失败" not in feedback_text:
            raise RuntimeError("degraded feedback must explain review failure")

        return {
            "event_types": event_types,
            "review_stage_status": degraded_stage["data"].get("status"),
            "complete_review_degraded": (complete_event.get("data") or {}).get("review_degraded"),
            "complete_review_status": (complete_event.get("data") or {}).get("review_status"),
            "feedback_preview": feedback_text[:80],
        }

    @staticmethod
    def _assert_longchain_extension_shape(
        result_data: Dict[str, Any],
        essay_row: Dict[str, Any],
        *,
        expected_topic_id: Optional[int],
        expected_topic_source: str,
        expected_topic_text: Optional[str] = None,
        expected_review_degraded: bool = False,
    ) -> Dict[str, Any]:
        raw = result_data.get("evaluation_json")
        if isinstance(raw, str):
            evaluation = json.loads(raw or "{}")
        elif isinstance(raw, dict):
            evaluation = raw
        else:
            evaluation = {}

        for key in (
            "contract_version",
            "scorecard",
            "analysis",
            "review",
            "total_score",
            "task_achievement",
            "coherence_cohesion",
            "lexical_resource",
            "grammatical_range",
            "sentences",
            "overall_feedback",
            "task_analysis",
            "band_rationale",
            "improvement_plan",
            "input_context",
            "review_blocks",
            "rewrite_suggestions",
            "review_degraded",
            "review_status",
        ):
            if key not in evaluation:
                raise RuntimeError(f"evaluation_json missing required key: {key}")

        if not isinstance(evaluation.get("task_analysis"), dict):
            raise RuntimeError("evaluation_json.task_analysis must be an object")
        if not isinstance(evaluation.get("band_rationale"), dict):
            raise RuntimeError("evaluation_json.band_rationale must be an object")
        if not isinstance(evaluation.get("input_context"), dict):
            raise RuntimeError("evaluation_json.input_context must be an object")
        if evaluation.get("contract_version") != "v3":
            raise RuntimeError("evaluation_json.contract_version must be 'v3'")
        if not isinstance(evaluation.get("scorecard"), dict):
            raise RuntimeError("evaluation_json.scorecard must be an object")
        if not isinstance(evaluation.get("analysis"), dict):
            raise RuntimeError("evaluation_json.analysis must be an object")
        if not isinstance(evaluation.get("review"), dict):
            raise RuntimeError("evaluation_json.review must be an object")
        if not isinstance(evaluation.get("review_degraded"), bool):
            raise RuntimeError("evaluation_json.review_degraded must be boolean")
        if not isinstance(evaluation.get("review_status"), dict):
            raise RuntimeError("evaluation_json.review_status must be an object")
        if evaluation.get("review_status", {}).get("status") not in ("completed", "degraded"):
            raise RuntimeError("evaluation_json.review_status.status must be completed/degraded")
        if not isinstance(evaluation.get("review_status", {}).get("degraded"), bool):
            raise RuntimeError("evaluation_json.review_status.degraded must be boolean")
        if evaluation.get("review_degraded") != expected_review_degraded:
            raise RuntimeError(
                "evaluation_json.review_degraded mismatch: "
                f"expected {expected_review_degraded}, got {evaluation.get('review_degraded')}"
            )
        if evaluation.get("review", {}).get("review_degraded") is not None and (
            evaluation["review"]["review_degraded"] != evaluation.get("review_degraded")
        ):
            raise RuntimeError("evaluation_json.review.review_degraded must mirror top-level review_degraded")
        for key in ("improvement_plan", "review_blocks", "rewrite_suggestions"):
            if not isinstance(evaluation.get(key), list):
                raise RuntimeError(f"evaluation_json.{key} must be an array")

        for key in (
            "total_score",
            "task_achievement",
            "coherence_cohesion",
            "lexical_resource",
            "grammatical_range",
        ):
            if evaluation["scorecard"].get(key) != evaluation.get(key):
                raise RuntimeError(f"evaluation_json.scorecard.{key} must mirror top-level {key}")

        expected_task_analysis = (
            "prompt_response_quality",
            "position_clarity",
            "argument_development",
            "conclusion_effectiveness",
        )
        for key in expected_task_analysis:
            if not isinstance(evaluation["task_analysis"].get(key), str):
                raise RuntimeError(f"evaluation_json.task_analysis.{key} must be a string")

        for key in ("task_achievement", "coherence_cohesion", "lexical_resource", "grammatical_range"):
            if not isinstance(evaluation["band_rationale"].get(key), str):
                raise RuntimeError(f"evaluation_json.band_rationale.{key} must be a string")
            if not isinstance(evaluation["analysis"].get("band_rationale", {}).get(key), str):
                raise RuntimeError(f"evaluation_json.analysis.band_rationale.{key} must be a string")

        input_context = evaluation["input_context"]
        if not isinstance(input_context.get("prompt_summary"), str):
            raise RuntimeError("evaluation_json.input_context.prompt_summary must be a string")
        for key in ("required_points", "major_risks"):
            if not isinstance(input_context.get(key), list):
                raise RuntimeError(f"evaluation_json.input_context.{key} must be an array")
        if not isinstance(evaluation["analysis"].get("input_context", {}).get("prompt_summary"), str):
            raise RuntimeError("evaluation_json.analysis.input_context.prompt_summary must be a string")
        if not isinstance(evaluation["review"].get("overall_feedback"), str):
            raise RuntimeError("evaluation_json.review.overall_feedback must be a string")
        if not isinstance(evaluation["review"].get("review_blocks"), list):
            raise RuntimeError("evaluation_json.review.review_blocks must be an array")

        input_context = evaluation["input_context"]
        if input_context.get("topic_source") != expected_topic_source:
            raise RuntimeError(
                f"evaluation_json.input_context.topic_source mismatch: "
                f"expected {expected_topic_source!r}, got {input_context.get('topic_source')!r}"
            )

        if expected_topic_id is None:
            if essay_row.get("topic_id") is not None:
                raise RuntimeError("essay_row.topic_id must be null in free topic mode")
        else:
            if int(essay_row.get("topic_id") or 0) != expected_topic_id:
                raise RuntimeError(
                    f"essay_row.topic_id mismatch: expected {expected_topic_id}, got {essay_row.get('topic_id')}"
                )
            if int(input_context.get("topic_id") or 0) != expected_topic_id:
                raise RuntimeError(
                    f"evaluation_json.input_context.topic_id mismatch: expected {expected_topic_id}, got {input_context.get('topic_id')}"
                )

        if expected_topic_text:
            normalized_expected = " ".join(expected_topic_text.split())
            normalized_actual = " ".join(str(input_context.get("topic_text") or "").split())
            if normalized_expected != normalized_actual:
                raise RuntimeError("evaluation_json.input_context.topic_text mismatch")

        return {
            "legacy_schema_preserved": True,
            "canonical_schema_guard": True,
            "contract_version": evaluation["contract_version"],
            "topic_source": expected_topic_source,
            "task_analysis_keys": list(expected_task_analysis),
            "band_rationale_keys": ["task_achievement", "coherence_cohesion", "lexical_resource", "grammatical_range"],
        }

    def _stream_until_terminal(self, session_id: str, timeout_sec: int = 150) -> Dict[str, Any]:
        events: List[Dict[str, Any]] = []
        start = time.monotonic()

        with self.runtime._request(
            "GET",
            f"/api/evaluate/{session_id}/stream",
            stream=True,
            timeout=(10, timeout_sec),
        ) as resp:
            if resp.status_code != 200:
                raise RuntimeError(f"SSE stream status={resp.status_code}")

            client = sseclient.SSEClient(resp)
            for raw_event in client.events():
                if time.monotonic() - start > timeout_sec:
                    raise TimeoutError(f"SSE timeout after {timeout_sec}s")

                if raw_event.event == "heartbeat":
                    continue

                try:
                    payload = json.loads(raw_event.data)
                except json.JSONDecodeError:
                    events.append({"event": raw_event.event, "raw": raw_event.data})
                    continue

                events.append(payload)
                event_type = payload.get("type")
                if event_type in {"complete", "error"}:
                    break

        if not events:
            raise RuntimeError("No SSE events received")

        last = events[-1]
        return {"events": events, "terminal": last}

    def test_evaluation_chain(self, llm_base_url: str) -> TestResult:
        started = time.monotonic()
        session_id: Optional[str] = None
        essay_id: Optional[int] = None
        topic_id: Optional[int] = None
        usage_before: Optional[int] = None

        try:
            log_step("测试场景: Compose -> Evaluating -> Result 真实链路", "INFO")
            self._reset_llm_stub([build_stage1_fixture(), build_stage2_fixture()])

            config_id = self._create_temp_config(llm_base_url)
            if config_id is None:
                raise PreconditionSkip(
                    "无法创建临时本地配置，评测链路跳过。"
                    f"原因: {self.temp_config_error or 'unknown'}"
                )

            topic = self._ensure_topic()
            topic_id = int(topic["id"])
            usage_before = self._topic_usage(topic_id)

            payload = {
                "task_type": "task2",
                "topic_id": topic_id,
                "content": build_long_essay_text(),
                "word_count": 320,
                "config_id": config_id,
            }
            compose_resp = self._api("POST", "/api/evaluate", json=payload)
            compose_payload = compose_resp["payload"]
            if compose_resp["status"] != 200 or compose_payload.get("success") is not True:
                raise RuntimeError(f"POST /api/evaluate failed: {compose_payload}")

            session_id = str(compose_payload.get("session_id") or "").strip()
            if not session_id:
                raise RuntimeError(f"missing session_id in compose response: {compose_payload}")
            log_step(f"Compose 阶段成功，session_id={session_id}", "SUCCESS")

            stream_result = self._stream_until_terminal(session_id=session_id)
            terminal = stream_result["terminal"]
            if terminal.get("type") == "error":
                raise RuntimeError(f"evaluating error event: {terminal}")
            if terminal.get("type") != "complete":
                raise RuntimeError(f"terminal SSE event is not complete: {terminal}")

            essay_id_raw = (terminal.get("data") or {}).get("essay_id")
            if essay_id_raw is None:
                raise RuntimeError(f"complete event missing essay_id: {terminal}")
            essay_id = int(essay_id_raw)
            log_step(f"Evaluating 阶段成功，essay_id={essay_id}", "SUCCESS")

            deadline = time.monotonic() + 15
            session_row: Optional[Dict[str, Any]] = None
            essay_row: Optional[Dict[str, Any]] = None
            while time.monotonic() < deadline:
                session_row = self._session_row(session_id)
                essay_row = self._essay_row(essay_id)
                if session_row and essay_row:
                    break
                time.sleep(0.3)

            if not session_row:
                raise RuntimeError(f"session not persisted in DB: {session_id}")
            if not essay_row:
                raise RuntimeError(f"essay not persisted in DB: {essay_id}")

            if str(session_row.get("status")) != "completed":
                raise RuntimeError(f"session status expected completed, got {session_row.get('status')}")
            if int(session_row.get("topic_id") or 0) != topic_id:
                raise RuntimeError(
                    f"session topic_id mismatch: expected {topic_id}, got {session_row.get('topic_id')}"
                )
            if int(essay_row.get("topic_id") or 0) != topic_id:
                raise RuntimeError(
                    f"essay topic_id mismatch: expected {topic_id}, got {essay_row.get('topic_id')}"
                )

            result_resp = self._api("GET", f"/api/essays/{essay_id}")
            result_payload = result_resp["payload"]
            if result_resp["status"] != 200 or result_payload.get("success") is not True:
                raise RuntimeError(f"GET /api/essays/{essay_id} failed: {result_payload}")

            result_data = result_payload.get("data") or {}
            if int(result_data.get("id") or 0) != essay_id:
                raise RuntimeError(f"result essay id mismatch: expected {essay_id}, got {result_data.get('id')}")
            if int(result_data.get("topic_id") or 0) != topic_id:
                raise RuntimeError(
                    f"result topic_id mismatch: expected {topic_id}, got {result_data.get('topic_id')}"
                )

            usage_after = self._topic_usage(topic_id)
            usage_delta = usage_after - usage_before
            if usage_delta != 1:
                raise RuntimeError(
                    f"topic usage_count delta expected 1, got {usage_delta} (before={usage_before}, after={usage_after})"
                )

            topic_text = extract_text_from_tiptap(topic.get("title_json")).strip()
            prompt_probe_evidence = self._assert_topic_prompt_included(topic_text)
            structured_request_evidence = self._assert_structured_stage_requests()
            dual_stage_evidence = self._assert_dual_stage_stream_contract(stream_result)
            output_shape_evidence = self._assert_longchain_extension_shape(
                result_data,
                essay_row,
                expected_topic_id=topic_id,
                expected_topic_source="topic_bank",
                expected_topic_text=topic_text,
                expected_review_degraded=False,
            )

            stream_types = [str(e.get("type")) for e in stream_result["events"] if isinstance(e, dict)]
            llm_mode = "external_live_provider" if self.provider_config.get("api_key") else "local_deterministic_stub"
            detail = (
                "真实链路通过（LLM 使用真实外部 provider），session/essay/topic/usage_count 断言成立"
                if llm_mode == "external_live_provider"
                else "真实链路通过（LLM 使用本地 deterministic stub），session/essay/topic/usage_count 断言成立"
            )
            duration = time.monotonic() - started
            return TestResult(
                name="Compose -> Evaluating -> Result",
                status="pass",
                detail=detail,
                duration=duration,
                evidence={
                    "session_id": session_id,
                    "essay_id": essay_id,
                    "topic_id": topic_id,
                    "topic_usage_before": usage_before,
                    "topic_usage_after": usage_after,
                    "topic_usage_delta": usage_delta,
                    "stream_event_types": stream_types,
                    "config_mode": self.temp_config_mode,
                    "llm_mode": llm_mode,
                    "prompt_probe": prompt_probe_evidence,
                    "structured_request_guard": structured_request_evidence,
                    "dual_stage_stream_guard": dual_stage_evidence,
                    "output_schema_guard": output_shape_evidence,
                },
            )
        except PreconditionSkip as exc:
            duration = time.monotonic() - started
            return TestResult(
                name="Compose -> Evaluating -> Result",
                status="skip",
                detail=str(exc),
                duration=duration,
                evidence={"config_mode": self.temp_config_mode, "config_error": self.temp_config_error},
            )
        except Exception as exc:  # noqa: BLE001
            duration = time.monotonic() - started
            return TestResult(
                name="Compose -> Evaluating -> Result",
                status="fail",
                detail=str(exc),
                duration=duration,
                evidence={
                    "session_id": session_id,
                    "essay_id": essay_id,
                    "topic_id": topic_id,
                },
            )
        finally:
            self._cleanup_test_artifacts(
                session_id=session_id,
                essay_id=essay_id,
                topic_id=topic_id,
                usage_before=usage_before,
            )
            self._cleanup_temp_config()

    def test_free_topic_chain(self, llm_base_url: str) -> TestResult:
        started = time.monotonic()
        session_id: Optional[str] = None
        essay_id: Optional[int] = None
        free_topic_text = (
            "Some people think public libraries should be replaced by fully digital services. "
            "Discuss both views and give your own opinion."
        )

        try:
            log_step("测试场景: 自由写作题目真实链路", "INFO")
            self._reset_llm_stub([build_stage1_fixture(), build_stage2_fixture()])

            config_id = self._create_temp_config(llm_base_url)
            if config_id is None:
                raise PreconditionSkip(
                    "无法创建临时本地配置，自由写作链路跳过。"
                    f"原因: {self.temp_config_error or 'unknown'}"
                )

            payload = {
                "task_type": "task2",
                "topic_text": free_topic_text,
                "content": build_long_essay_text(),
                "word_count": 320,
                "config_id": config_id,
            }
            compose_resp = self._api("POST", "/api/evaluate", json=payload)
            compose_payload = compose_resp["payload"]
            if compose_resp["status"] != 200 or compose_payload.get("success") is not True:
                raise RuntimeError(f"POST /api/evaluate failed: {compose_payload}")

            session_id = str(compose_payload.get("session_id") or "").strip()
            if not session_id:
                raise RuntimeError(f"missing session_id in compose response: {compose_payload}")

            stream_result = self._stream_until_terminal(session_id=session_id)
            terminal = stream_result["terminal"]
            if terminal.get("type") == "error":
                raise RuntimeError(f"evaluating error event: {terminal}")
            essay_id_raw = (terminal.get("data") or {}).get("essay_id")
            if essay_id_raw is None:
                raise RuntimeError(f"complete event missing essay_id: {terminal}")
            essay_id = int(essay_id_raw)

            deadline = time.monotonic() + 15
            session_row: Optional[Dict[str, Any]] = None
            essay_row: Optional[Dict[str, Any]] = None
            while time.monotonic() < deadline:
                session_row = self._session_row(session_id)
                essay_row = self._essay_row(essay_id)
                if session_row and essay_row:
                    break
                time.sleep(0.3)

            if not session_row:
                raise RuntimeError(f"session not persisted in DB: {session_id}")
            if not essay_row:
                raise RuntimeError(f"essay not persisted in DB: {essay_id}")
            if str(session_row.get("status")) != "completed":
                raise RuntimeError(f"session status expected completed, got {session_row.get('status')}")
            if session_row.get("topic_id") is not None:
                raise RuntimeError("session.topic_id must be null in free topic mode")
            if essay_row.get("topic_id") is not None:
                raise RuntimeError("essay.topic_id must be null in free topic mode")

            result_resp = self._api("GET", f"/api/essays/{essay_id}")
            result_payload = result_resp["payload"]
            if result_resp["status"] != 200 or result_payload.get("success") is not True:
                raise RuntimeError(f"GET /api/essays/{essay_id} failed: {result_payload}")

            result_data = result_payload.get("data") or {}
            if result_data.get("topic_id") is not None:
                raise RuntimeError("result.topic_id must be null in free topic mode")
            if result_data.get("topic_source") != "custom_input":
                raise RuntimeError(f"result.topic_source mismatch: {result_data.get('topic_source')!r}")

            prompt_probe_evidence = self._assert_topic_prompt_included(free_topic_text)
            structured_request_evidence = self._assert_structured_stage_requests()
            dual_stage_evidence = self._assert_dual_stage_stream_contract(stream_result)
            output_shape_evidence = self._assert_longchain_extension_shape(
                result_data,
                essay_row,
                expected_topic_id=None,
                expected_topic_source="custom_input",
                expected_topic_text=free_topic_text,
                expected_review_degraded=False,
            )

            return TestResult(
                name="Free Topic -> Evaluating -> Result",
                status="pass",
                detail="自由写作题目链路通过，session/essay/topic_source/input_context 断言成立",
                duration=time.monotonic() - started,
                evidence={
                    "session_id": session_id,
                    "essay_id": essay_id,
                    "topic_source": result_data.get("topic_source"),
                    "prompt_probe": prompt_probe_evidence,
                    "structured_request_guard": structured_request_evidence,
                    "dual_stage_stream_guard": dual_stage_evidence,
                    "output_schema_guard": output_shape_evidence,
                },
            )
        except PreconditionSkip as exc:
            return TestResult(
                name="Free Topic -> Evaluating -> Result",
                status="skip",
                detail=str(exc),
                duration=time.monotonic() - started,
                evidence={"config_mode": self.temp_config_mode, "config_error": self.temp_config_error},
            )
        except Exception as exc:  # noqa: BLE001
            return TestResult(
                name="Free Topic -> Evaluating -> Result",
                status="fail",
                detail=str(exc),
                duration=time.monotonic() - started,
                evidence={"session_id": session_id, "essay_id": essay_id},
            )
        finally:
            self._cleanup_test_artifacts(
                session_id=session_id,
                essay_id=essay_id,
                topic_id=None,
                usage_before=None,
            )
            self._cleanup_temp_config()

    def test_review_degraded_chain(self, llm_base_url: str) -> TestResult:
        started = time.monotonic()
        session_id: Optional[str] = None
        essay_id: Optional[int] = None
        topic_id: Optional[int] = None
        usage_before: Optional[int] = None

        try:
            if self.provider_config.get("api_key"):
                raise PreconditionSkip("真实外部 provider 模式下无法稳定构造 review degraded，跳过该专项场景。")

            log_step("测试场景: review degraded 真实链路", "INFO")
            self._reset_llm_stub([build_stage1_fixture(), build_invalid_stage2_fixture()])

            config_id = self._create_temp_config(llm_base_url)
            if config_id is None:
                raise PreconditionSkip(
                    "无法创建临时本地配置，review degraded 链路跳过。"
                    f"原因: {self.temp_config_error or 'unknown'}"
                )

            topic = self._ensure_topic()
            topic_id = int(topic["id"])
            usage_before = self._topic_usage(topic_id)

            payload = {
                "task_type": "task2",
                "topic_id": topic_id,
                "content": build_long_essay_text(),
                "word_count": 320,
                "config_id": config_id,
            }
            compose_resp = self._api("POST", "/api/evaluate", json=payload)
            compose_payload = compose_resp["payload"]
            if compose_resp["status"] != 200 or compose_payload.get("success") is not True:
                raise RuntimeError(f"POST /api/evaluate failed: {compose_payload}")

            session_id = str(compose_payload.get("session_id") or "").strip()
            if not session_id:
                raise RuntimeError(f"missing session_id in compose response: {compose_payload}")

            stream_result = self._stream_until_terminal(session_id=session_id)
            terminal = stream_result["terminal"]
            if terminal.get("type") == "error":
                raise RuntimeError(f"review degraded should not end with error: {terminal}")
            essay_id_raw = (terminal.get("data") or {}).get("essay_id")
            if essay_id_raw is None:
                raise RuntimeError(f"complete event missing essay_id: {terminal}")
            essay_id = int(essay_id_raw)

            deadline = time.monotonic() + 15
            session_row: Optional[Dict[str, Any]] = None
            essay_row: Optional[Dict[str, Any]] = None
            while time.monotonic() < deadline:
                session_row = self._session_row(session_id)
                essay_row = self._essay_row(essay_id)
                if session_row and essay_row:
                    break
                time.sleep(0.3)

            if not session_row:
                raise RuntimeError(f"session not persisted in DB: {session_id}")
            if not essay_row:
                raise RuntimeError(f"essay not persisted in DB: {essay_id}")
            if str(session_row.get("status")) != "completed":
                raise RuntimeError(f"session status expected completed, got {session_row.get('status')}")
            if str(session_row.get("error_code") or "") != "review_degraded":
                raise RuntimeError(f"degraded session error_code expected review_degraded, got {session_row.get('error_code')}")

            result_resp = self._api("GET", f"/api/essays/{essay_id}")
            result_payload = result_resp["payload"]
            if result_resp["status"] != 200 or result_payload.get("success") is not True:
                raise RuntimeError(f"GET /api/essays/{essay_id} failed: {result_payload}")
            result_data = result_payload.get("data") or {}

            degraded_evidence = self._assert_review_degraded_stream_contract(stream_result)
            output_shape_evidence = self._assert_longchain_extension_shape(
                result_data,
                essay_row,
                expected_topic_id=topic_id,
                expected_topic_source="topic_bank",
                expected_topic_text=extract_text_from_tiptap(topic.get("title_json")).strip(),
                expected_review_degraded=True,
            )

            evaluation_json = result_data.get("evaluation_json") or {}
            if isinstance(evaluation_json, str):
                evaluation_json = json.loads(evaluation_json or "{}")

            if evaluation_json.get("review", {}).get("sentences") not in ([], None):
                raise RuntimeError("degraded evaluation_json.review.sentences must be empty")
            if evaluation_json.get("review", {}).get("review_blocks") not in ([], None):
                raise RuntimeError("degraded evaluation_json.review.review_blocks must be empty")
            if evaluation_json.get("review_degraded") is not True:
                raise RuntimeError("degraded evaluation_json.review_degraded must be true")
            if evaluation_json.get("review_status", {}).get("status") != "degraded":
                raise RuntimeError("degraded evaluation_json.review_status.status must be degraded")
            if evaluation_json.get("review_status", {}).get("degraded") is not True:
                raise RuntimeError("degraded evaluation_json.review_status.degraded must be true")
            if "第二阶段详解生成失败" not in str(evaluation_json.get("overall_feedback") or ""):
                raise RuntimeError("degraded evaluation_json.overall_feedback must explain review failure")

            complete_provider_path = (terminal.get("data") or {}).get("provider_path") or []
            if not any(item.get("stage") == "review" for item in complete_provider_path if isinstance(item, dict)):
                raise RuntimeError("complete.provider_path must preserve degraded review attempt")

            session_provider_path = json.loads(session_row.get("provider_path_json") or "[]")
            if not any(item.get("stage") == "review" for item in session_provider_path if isinstance(item, dict)):
                raise RuntimeError("session.provider_path_json must preserve degraded review attempt")

            usage_after = self._topic_usage(topic_id)
            usage_delta = usage_after - usage_before
            if usage_delta != 1:
                raise RuntimeError(
                    f"topic usage_count delta expected 1, got {usage_delta} (before={usage_before}, after={usage_after})"
                )

            return TestResult(
                name="Review Degraded -> Complete",
                status="pass",
                detail="review degraded 真实链路通过，未中断完成事件且保留 review 调用轨迹",
                duration=time.monotonic() - started,
                evidence={
                    "session_id": session_id,
                    "essay_id": essay_id,
                    "topic_id": topic_id,
                    "topic_usage_before": usage_before,
                    "topic_usage_after": usage_after,
                    "topic_usage_delta": usage_delta,
                    "degraded_stream_guard": degraded_evidence,
                    "output_schema_guard": output_shape_evidence,
                    "complete_provider_path": complete_provider_path,
                },
            )
        except PreconditionSkip as exc:
            return TestResult(
                name="Review Degraded -> Complete",
                status="skip",
                detail=str(exc),
                duration=time.monotonic() - started,
                evidence={"config_mode": self.temp_config_mode, "config_error": self.temp_config_error},
            )
        except Exception as exc:  # noqa: BLE001
            return TestResult(
                name="Review Degraded -> Complete",
                status="fail",
                detail=str(exc),
                duration=time.monotonic() - started,
                evidence={"session_id": session_id, "essay_id": essay_id, "topic_id": topic_id},
            )
        finally:
            self._cleanup_test_artifacts(
                session_id=session_id,
                essay_id=essay_id,
                topic_id=topic_id,
                usage_before=usage_before,
            )
            self._cleanup_temp_config()

    def test_topic_type_mismatch_rejected(self, llm_base_url: str) -> TestResult:
        started = time.monotonic()
        topic_id: Optional[int] = None
        usage_before: Optional[int] = None
        before_sessions = self._table_count("evaluation_sessions")
        before_essays = self._table_count("essays")

        try:
            log_step("测试场景: 题型不匹配必须硬拦截", "INFO")
            self._reset_llm_stub([build_stage1_fixture(), build_stage2_fixture()])

            config_id = self._create_temp_config(llm_base_url)
            if config_id is None:
                raise PreconditionSkip(
                    "无法创建临时本地配置，题型不匹配拦截链路跳过。"
                    f"原因: {self.temp_config_error or 'unknown'}"
                )

            topic = self._ensure_topic()
            topic_id = int(topic["id"])
            usage_before = self._topic_usage(topic_id)

            payload = {
                "task_type": "task1",
                "topic_id": topic_id,
                "content": build_long_essay_text(),
                "word_count": 320,
                "config_id": config_id,
            }
            compose_resp = self._api("POST", "/api/evaluate", json=payload)
            compose_payload = compose_resp["payload"]

            if compose_resp["status"] != 200:
                raise RuntimeError(f"POST /api/evaluate status mismatch: {compose_resp['status']}")
            if compose_payload.get("success") is True:
                raise RuntimeError(f"mismatch request must fail, got payload={compose_payload}")
            if str(compose_payload.get("error_code") or compose_payload.get("code") or "") != "validation_error":
                raise RuntimeError(f"mismatch error_code must be validation_error, got {compose_payload}")
            if "题型不匹配" not in str(compose_payload.get("message") or ""):
                raise RuntimeError(f"mismatch error message missing topic type hint: {compose_payload}")

            after_sessions = self._table_count("evaluation_sessions")
            after_essays = self._table_count("essays")
            if after_sessions != before_sessions:
                raise RuntimeError(
                    f"evaluation_sessions must not change on mismatch: before={before_sessions}, after={after_sessions}"
                )
            if after_essays != before_essays:
                raise RuntimeError(
                    f"essays must not change on mismatch: before={before_essays}, after={after_essays}"
                )

            usage_after = self._topic_usage(topic_id)
            if usage_after != usage_before:
                raise RuntimeError(
                    f"topic usage_count must stay unchanged on mismatch: before={usage_before}, after={usage_after}"
                )

            if self.llm_stub and self.llm_stub.stream_call_count != 0:
                raise RuntimeError(
                    f"mismatch request must not call LLM, got stream_call_count={self.llm_stub.stream_call_count}"
                )

            return TestResult(
                name="Topic Type Mismatch -> Rejected",
                status="pass",
                detail="题型不匹配被 validation_error 硬拦截，且不落 session/essay",
                duration=time.monotonic() - started,
                evidence={
                    "topic_id": topic_id,
                    "error_code": compose_payload.get("error_code") or compose_payload.get("code"),
                    "sessions_before": before_sessions,
                    "sessions_after": after_sessions,
                    "essays_before": before_essays,
                    "essays_after": after_essays,
                    "llm_stream_call_count": self.llm_stub.stream_call_count if self.llm_stub else None,
                },
            )
        except PreconditionSkip as exc:
            return TestResult(
                name="Topic Type Mismatch -> Rejected",
                status="skip",
                detail=str(exc),
                duration=time.monotonic() - started,
                evidence={"config_mode": self.temp_config_mode, "config_error": self.temp_config_error},
            )
        except Exception as exc:  # noqa: BLE001
            return TestResult(
                name="Topic Type Mismatch -> Rejected",
                status="fail",
                detail=str(exc),
                duration=time.monotonic() - started,
                evidence={"topic_id": topic_id},
            )
        finally:
            self._cleanup_test_artifacts(
                session_id=None,
                essay_id=None,
                topic_id=topic_id,
                usage_before=usage_before,
            )
            self._cleanup_temp_config()


def build_report(
    *,
    api_base: str,
    db_path: Path,
    runtime: ApiRuntime,
    llm_stub: Optional[LocalLLMStub],
    provider_config: Optional[Dict[str, str]],
    results: List[TestResult],
    started_at: float,
) -> Dict[str, Any]:
    passed = sum(1 for item in results if item.status == "pass")
    failed = sum(1 for item in results if item.status == "fail")
    skipped = sum(1 for item in results if item.status == "skip")
    total = len(results)

    if failed > 0:
        status = "fail"
    elif passed > 0:
        status = "pass"
    else:
        status = "skip"

    live_provider = bool((provider_config or {}).get("api_key"))
    validation_scope = (
        "external-live-provider-smoke"
        if live_provider
        else "orchestration-only-with-local-deterministic-llm-stub"
    )
    external_provider_coverage = "covered" if live_provider else "not_covered"
    return {
        "generatedAt": datetime.now().isoformat(),
        "duration": round(time.monotonic() - started_at, 3),
        "status": status,
        "transport": "http+sse+sqlite",
        "api_base": api_base,
        "db_path": str(db_path),
        "runtime": {
            "spawned_standalone_api": runtime.spawned,
            "spawn_error": runtime.spawn_error,
            "spawn_attempts": runtime.spawn_attempts,
            "spawn_command": runtime.spawn_command,
            "llm_stub_base_url": llm_stub.base_url if llm_stub else None,
            "llm_stub_stream_call_count": llm_stub.stream_call_count if llm_stub else None,
            "validation_scope": validation_scope,
            "external_provider_coverage": external_provider_coverage,
            "provider": (provider_config or {}).get("provider"),
            "provider_base_url": (provider_config or {}).get("base_url"),
            "provider_model": (provider_config or {}).get("model"),
        },
        "summary": {"total": total, "passed": passed, "failed": failed, "skipped": skipped},
        "results": [item.as_dict() for item in results],
    }


def run(
    api_base: str,
    db_path: Path,
    allow_spawn_standalone: bool,
    provider_config: Optional[Dict[str, str]] = None,
    report_name: str = "phase05-eval-flow-report.json",
) -> int:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()

    log_step("=" * 80, "INFO")
    log_step("Phase 05 真实 E2E: Compose -> Evaluating -> Result", "INFO")
    log_step("=" * 80, "INFO")
    log_step(f"API Base: {api_base}", "INFO")
    log_step(f"DB Path: {db_path}", "INFO")

    runtime = ApiRuntime(api_base=api_base, db_path=db_path, allow_spawn_standalone=allow_spawn_standalone)
    llm_stub: Optional[LocalLLMStub] = None
    results: List[TestResult] = []

    try:
        llm_base_url = None
        if provider_config and provider_config.get("base_url") and provider_config.get("api_key"):
            llm_base_url = str(provider_config["base_url"]).rstrip("/")
        else:
            llm_stub = LocalLLMStub()
            llm_stub.start()
            llm_base_url = llm_stub.base_url

        if not runtime.ensure_available():
            detail = "API 不可用"
            if runtime.spawn_error:
                detail = f"{detail}; standalone 启动失败: {runtime.spawn_error}"
            results.append(
                TestResult(
                    name="环境准备",
                    status="skip",
                    detail=detail,
                    duration=0.0,
                    evidence={"api_base": api_base, "spawn_error": runtime.spawn_error},
                )
            )
        elif not db_path.exists():
            results.append(
                TestResult(
                    name="环境准备",
                    status="skip",
                    detail=f"数据库不存在: {db_path}",
                    duration=0.0,
                    evidence={"db_path": str(db_path)},
                )
            )
        else:
            runner = EvalFlowRunner(runtime, provider_config=provider_config, llm_stub=llm_stub)
            results.append(runner.preflight_environment())
            results.append(runner.test_evaluation_chain(llm_base_url=llm_base_url))
            results.append(runner.test_free_topic_chain(llm_base_url=llm_base_url))
            results.append(runner.test_review_degraded_chain(llm_base_url=llm_base_url))
            results.append(runner.test_topic_type_mismatch_rejected(llm_base_url=llm_base_url))

    finally:
        runtime.stop()
        if llm_stub:
            llm_stub.stop()

    report = build_report(
        api_base=api_base,
        db_path=db_path,
        runtime=runtime,
        llm_stub=llm_stub,
        provider_config=provider_config,
        results=results,
        started_at=started,
    )
    report_path = REPORT_DIR / report_name
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    log_step(f"报告已保存: {report_path}", "SUCCESS")
    log_step(
        f"结果汇总 total={report['summary']['total']} pass={report['summary']['passed']} "
        f"fail={report['summary']['failed']} skip={report['summary']['skipped']}",
        "INFO",
    )

    return 0 if report["status"] != "fail" else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase05 evaluation flow E2E")
    parser.add_argument("--api-base", default=None)
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--provider", default=DEFAULT_PROVIDER_NAME)
    parser.add_argument("--provider-base-url", default=None)
    parser.add_argument("--provider-model", default=None)
    parser.add_argument("--provider-api-key", default=None)
    parser.add_argument("--report-name", default="phase05-eval-flow-report.json")
    parser.add_argument(
        "--no-spawn-standalone",
        action="store_true",
        help="Do not auto-start standalone API server when /health is unavailable.",
    )
    args = parser.parse_args()

    if args.api_base:
        api_base = str(args.api_base).rstrip("/")
    else:
        # Default to a dedicated free port so local 3000 conflicts do not pollute test results.
        auto_port = find_free_port()
        if auto_port == DEFAULT_API_PORT:
            auto_port = find_free_port()
        api_base = f"http://{DEFAULT_HOST}:{auto_port}"

    provider_config = None
    if args.provider_base_url and args.provider_model and args.provider_api_key:
        provider_config = {
            "provider": str(args.provider or DEFAULT_PROVIDER_NAME),
            "base_url": str(args.provider_base_url).rstrip("/"),
            "model": str(args.provider_model),
            "api_key": str(args.provider_api_key),
        }

    return run(
        api_base=api_base,
        db_path=Path(args.db),
        allow_spawn_standalone=not bool(args.no_spawn_standalone),
        provider_config=provider_config,
        report_name=str(args.report_name),
    )


if __name__ == "__main__":
    raise SystemExit(main())
