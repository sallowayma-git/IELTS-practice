#!/usr/bin/env python3
"""Truthful packaged Tauri 2 smoke gate.

This deliberately speaks the WebDriver HTTP protocol directly, so the gate
has no hidden Playwright/file:// fallback.  Set TAURI_APP_BINARY to a built
Tauri executable and ensure tauri-driver plus the platform native driver are
on PATH (or set TAURI_DRIVER/TAURI_NATIVE_DRIVER). On Windows the native driver
is chosen to match the installed WebView2 runtime (see webdriver_select.py).
"""
from __future__ import annotations

import base64
import ctypes
import hashlib
import http.server
import json
import math
import os
import shutil
import socket
import sqlite3
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

from webdriver_select import DriverSelectionError, installed_webview2_version, select_native_driver

ROOT = Path(__file__).resolve().parents[3]
REPORT = ROOT / "developer/tests/e2e/reports/suite-practice-flow-report.json"
READING_SCREENSHOT = ROOT / "developer/tests/e2e/reports/reading-practice-current.png"
LIBRARY_SCREENSHOT = ROOT / "developer/tests/e2e/reports/library-current.png"
SETTINGS_SCREENSHOT = ROOT / "developer/tests/e2e/reports/settings-current.png"
HISTORY_SCREENSHOT = ROOT / "developer/tests/e2e/reports/history-current.png"
COMPOSE_SCREENSHOT = ROOT / "developer/tests/e2e/reports/compose-current.png"
TOPICS_SCREENSHOT = ROOT / "developer/tests/e2e/reports/topics-current.png"
NOTEBOOK_SCREENSHOT = ROOT / "developer/tests/e2e/reports/notebook-current.png"
NOTEBOOK_WEEKLY_SCREENSHOT = ROOT / "developer/tests/e2e/reports/notebook-weekly-current.png"
DRIVER_LOG = ROOT / "developer/tests/e2e/reports/tauri-driver.log"
READING_P95_BUDGET_MS = 3000
FAKE_NOW_ENV = "IELTS_ATLAS_FAKE_NOW"
WEEKLY_MIN_OBSERVATIONS = 8  # ielts_db::WEEKLY_MIN_OBSERVATIONS
WEEKLY_TITLE = "这一周的练习回顾"
# A non-empty wrong answer is a real negative skill signal; a blank is not.
PACKAGED_WRONG_ANSWER = "__packaged_wrong__"
# Deterministic preference among question kinds present in two or more assets.
WEEKLY_KIND_PRIORITY = ("true_false_not_given", "matching_headings", "summary_completion")
# Mirrors crates/ielts-db/src/reading/assets.rs::matching_subtype, in order.
MATCHING_SUBTYPE_RULES = (
    (("list of headings", "correct heading"), "matching_headings"),
    (("paragraph contains", "section contains"), "matching_information"),
    (("correct ending", "sentence ending"), "matching_sentence_endings"),
    (("complete the summary",), "summary_completion"),
    (("classify the following",), "classification"),
    (("match each",), "matching_features"),
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def runtime_source_fingerprint() -> str:
    source_root = ROOT / "agent-runtime-python"
    paths = [source_root / "sidecar_entry.py", source_root / "pyproject.toml"]
    paths.extend((source_root / "src").rglob("*.py"))
    digest = hashlib.sha256()
    for path in sorted(paths, key=lambda item: item.relative_to(ROOT).as_posix()):
        digest.update(path.relative_to(ROOT).as_posix().encode("utf-8") + b"\0")
        digest.update(bytes.fromhex(sha256_file(path)))
    return digest.hexdigest()


def git_value(*args: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", *args], cwd=ROOT, capture_output=True, text=True, timeout=10, check=False
        )
        value = result.stdout.strip()
        return value or None
    except (OSError, subprocess.SubprocessError):
        return None


def latest_shipping_source_mtime() -> float:
    roots = (
        ROOT / "apps/writing-vue/src",
        ROOT / "src-tauri/src",
        ROOT / "crates/ielts-domain/src",
        ROOT / "crates/ielts-db/src",
        ROOT / "crates/ielts-application/src",
        ROOT / "crates/ielts-db/migrations",
        ROOT / "dist/writing",
    )
    candidates = [
        ROOT / "src-tauri/tauri.conf.json",
        ROOT / "src-tauri/Cargo.toml",
        ROOT / "apps/writing-vue/package.json",
        ROOT / "Cargo.toml",
        ROOT / "Cargo.lock",
        ROOT / "src-tauri/build.rs",
        ROOT / "src-tauri/binaries/ielts-agent-runtime-x86_64-pc-windows-msvc.sha256",
    ]
    candidates.extend((ROOT / "crates").glob("*/Cargo.toml"))
    for root in roots:
        if root.is_dir():
            candidates.extend(path for path in root.rglob("*") if path.is_file())
    return max((path.stat().st_mtime for path in candidates if path.is_file()), default=0.0)


def ensure_current_binary(app: Path, explicit: bool) -> tuple[Path, bool, str | None]:
    if explicit:
        return app, False, None
    stale = not app.is_file() or app.stat().st_mtime < latest_shipping_source_mtime()
    if not stale:
        return app, False, None
    completed = subprocess.run(
        ["cargo", "build", "--release", "-p", "ielts-practice-tauri"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=900,
        check=False,
    )
    detail = "\n".join(part.strip() for part in (completed.stdout, completed.stderr) if part.strip())
    if completed.returncode != 0:
        raise RuntimeError(f"current packaged binary build failed: {detail[-4000:]}")
    return ROOT / "target/release/ielts-practice-tauri.exe", True, detail[-1000:] or None


def binary_metadata(app: Path, tauri: str | None, native: str | None, build_performed: bool) -> dict:
    status = git_value("status", "--porcelain")
    return {
        "gitCommit": git_value("rev-parse", "HEAD"),
        "gitDirty": bool(status),
        "gitStatus": status,
        "binaryPath": str(app.resolve()) if app.is_file() else str(app),
        "binarySha256": sha256_file(app) if app.is_file() else None,
        "binarySize": app.stat().st_size if app.is_file() else None,
        "binaryModifiedAt": datetime.fromtimestamp(app.stat().st_mtime, timezone.utc).isoformat() if app.is_file() else None,
        "buildPerformed": build_performed,
        "tauriDriverVersion": executable_version(tauri),
        "nativeDriverVersion": executable_version(native),
    }


def resolve_executable(env_name: str, names: tuple[str, ...], extra: tuple[Path, ...] = ()) -> str | None:
    """Resolve explicit path, PATH entry, then common Windows install locations."""
    explicit = os.environ.get(env_name)
    if explicit:
        candidate = Path(explicit).expanduser()
        if candidate.is_file():
            return str(candidate)
        found = shutil.which(explicit)
        if found:
            return found
    for name in names:
        found = shutil.which(name)
        if found:
            return found
    for candidate in extra:
        if candidate.is_file():
            return str(candidate)
    return None


def executable_version(path: str | None) -> str | None:
    if not path:
        return None
    try:
        result = subprocess.run([path, "--version"], capture_output=True, text=True, timeout=5, check=False)
        if result.returncode != 0:
            return None
        value = (result.stdout or result.stderr).strip()
        return value or None
    except (OSError, subprocess.SubprocessError):
        return None


def blocked(reason: str, missing: list[str]) -> int:
    report = {"schemaVersion": 2, "generatedAt": datetime.now(timezone.utc).isoformat(),
              "status": "blocked", "exitCode": 2, "target": "packaged-tauri-2",
              "reason": reason, "missingDependencies": missing,
              "checks": {"launch": "blocked", "vueRoutes": "blocked", "readingIpc": "blocked",
                          "uiRouteVisuals": "blocked", "agentIpcBoundary": "blocked",
                          "agentWorkspaceRun": "blocked",
                         "bundledResources": "blocked", "readingView": "blocked",
                         "readingPerformance": "blocked", "notesDialog": "blocked",
                         "readingSubmitBoundary": "blocked",
                         "backupPathBoundary": "blocked",
                         "updaterBoundary": "blocked",
                         "sqliteRestart": "blocked",
                         "coachReceipts": "blocked", "automaticDaily": "blocked",
                         "dailyRestartDedupe": "blocked", "weeklyReport": "blocked",
                         "promptAuthorityBoundary": "blocked", "ipcAllowList": "blocked"}}
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 2


class Driver:
    def __init__(self, base: str): self.base, self.sid = base.rstrip("/"), None
    def call(self, method: str, path: str, body=None, timeout_seconds: int = 30):
        req = urllib.request.Request(self.base + path, method=method,
                                      data=None if body is None else json.dumps(body).encode(),
                                      headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout_seconds) as response:
                return json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"WebDriver {method} {path} returned HTTP {exc.code}: {detail}") from exc
    def create(self, app: str):
        value = self.call("POST", "/session", {"capabilities": {"alwaysMatch": {
            "browserName": "wry", "tauri:options": {"application": app}}}})
        self.sid = value.get("sessionId") or value.get("value", {}).get("sessionId")
        if not self.sid: raise RuntimeError(f"WebDriver session failed: {value}")
    def script(self, source, args=None):
        value = self.call("POST", f"/session/{self.sid}/execute/sync", {"script": source, "args": args or []})
        return value.get("value", value)
    def screenshot(self, path: Path):
        value = self.call("GET", f"/session/{self.sid}/screenshot")
        encoded = value.get("value", value)
        if not isinstance(encoded, str) or not encoded:
            raise RuntimeError(f"WebDriver screenshot failed: {value}")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(base64.b64decode(encoded))
    def url(self, url): self.call("POST", f"/session/{self.sid}/url", {"url": url})
    def close(self):
        if self.sid:
            try: self.call("DELETE", f"/session/{self.sid}")
            except Exception: pass


def wait_for_vue(driver: Driver, timeout_seconds: int = 30):
    deadline = time.time() + timeout_seconds
    last = None
    while time.time() < deadline:
        windows = driver.call("GET", f"/session/{driver.sid}/window/handles").get("value", [])
        last = {"windowHandles": windows}
        if len(windows) != 1:
            time.sleep(0.25)
            continue
        driver.call("POST", f"/session/{driver.sid}/window", {"handle": windows[0]})
        last = driver.script("""
            const root = document.querySelector('#app');
            return {
              readyState: document.readyState,
              url: location.href,
              mounted: !!root && root.childElementCount > 0,
              html: document.documentElement.outerHTML.slice(0, 1000)
            };
        """)
        if isinstance(last, dict) and last.get("mounted"):
            return last
        time.sleep(0.25)
    raise RuntimeError(f"Vue root did not mount: {last}")


def wait_for_value(driver: Driver, source: str, timeout_seconds: int = 15, *, label: str = "WebDriver condition"):
    deadline = time.time() + timeout_seconds
    last = None
    while time.time() < deadline:
        last = driver.script(source)
        if last:
            return last
        time.sleep(0.1)
    raise RuntimeError(f"{label} timed out: {last}")


def log_tail(path: Path, limit: int = 4000) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")[-limit:]
    except OSError:
        return ""


def stop_process(process: subprocess.Popen | None) -> None:
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def free_tcp_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def pick_ports(configured_port: int | None) -> tuple[int, int]:
    driver_port = configured_port or free_tcp_port()
    native_port = free_tcp_port()
    while native_port == driver_port:
        native_port = free_tcp_port()
    return driver_port, native_port


def start_tauri_driver(driver: "Driver", tauri: str, native: str, ports: tuple[int, int],
                       env: dict, driver_log) -> subprocess.Popen:
    """Start tauri-driver (the app inherits `env`) and wait for its /status."""
    proc = subprocess.Popen(
        [tauri, "--port", str(ports[0]), "--native-port", str(ports[1]), "--native-driver", native],
        cwd=ROOT, stdout=driver_log, stderr=subprocess.STDOUT, text=True, env=env,
    )
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            driver_log.flush()
            raise RuntimeError(f"tauri-driver exited with code {proc.returncode}: {log_tail(DRIVER_LOG)}")
        try:
            driver.call("GET", "/status", timeout_seconds=1)
        except Exception:
            time.sleep(0.25)
            continue
        if proc.poll() is not None:
            raise RuntimeError(f"tauri-driver exited with code {proc.returncode}: {log_tail(DRIVER_LOG)}")
        return proc
    driver_log.flush()
    stop_process(proc)
    raise RuntimeError(f"tauri-driver was not ready after 30s: {log_tail(DRIVER_LOG)}")


def is_weekly_request(body: dict) -> bool:
    messages = body.get("messages") if isinstance(body, dict) else None
    if not isinstance(messages, list):
        return False
    return any(isinstance(message, dict) and message.get("role") == "system"
               and "weekly journal" in str(message.get("content", "")).lower()
               for message in messages)


def _first_json_object(text: str):
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        if start < 0:
            return None
        try:
            return json.JSONDecoder().raw_decode(text, start)[0]
        except json.JSONDecodeError:
            return None


def weekly_pack(body: dict) -> dict | None:
    """The weekly pack (`pack`, else the bare object) from the first user JSON."""
    messages = body.get("messages") if isinstance(body, dict) else None
    for message in messages if isinstance(messages, list) else []:
        if not isinstance(message, dict) or message.get("role") != "user":
            continue
        content = message.get("content")
        if not isinstance(content, str):
            continue
        value = _first_json_object(content)
        if not isinstance(value, dict):
            continue
        pack = value.get("pack", value)
        if isinstance(pack, dict):
            return pack
    return None


def weekly_facts(body: dict) -> dict:
    """The `pack.facts` map of a weekly request, or an empty map."""
    pack = weekly_pack(body)
    facts = pack.get("facts") if isinstance(pack, dict) else None
    return facts if isinstance(facts, dict) else {}


def weekly_evidence_fact(body: dict) -> str | None:
    """The first fact id (key order) whose provenance covers two or more assets."""
    facts = weekly_facts(body)
    for fact_id in sorted(facts):
        fact = facts.get(fact_id)
        provenance = fact.get("provenance") if isinstance(fact, dict) else None
        asset_ids = provenance.get("assetIds") if isinstance(provenance, dict) else None
        if not isinstance(asset_ids, list):
            continue
        assets = {asset for asset in asset_ids if isinstance(asset, str) and asset}
        if len(assets) >= 2:
            return fact_id
    return None


def instruction_text(html: str) -> str:
    """Lower-cased text of an HTML fragment with tags removed and spaces collapsed."""
    text: list[str] = []
    in_tag = False
    for char in html:
        if char == "<":
            in_tag = True
        elif char == ">" and in_tag:
            in_tag = False
            text.append(" ")
        elif not in_tag:
            text.append(char)
    return " ".join("".join(text).replace("&nbsp;", " ").split()).lower()


def matching_subtype(text: str) -> str:
    """The specific matching task an instruction text names, else `matching`."""
    for needles, kind in MATCHING_SUBTYPE_RULES:
        if any(needle in text for needle in needles):
            return kind
    return "matching"


def question_kind(group: dict) -> str:
    """The scored kind of a question group, resolving generic `matching`."""
    if not isinstance(group, dict):
        return "unknown"
    kind = group.get("kind")
    if not isinstance(kind, str) or not kind:
        return "unknown"
    if kind != "matching":
        return kind
    html = group.get("bodyHtml")
    return matching_subtype(instruction_text(html if isinstance(html, str) else ""))


def question_kinds(payload: dict) -> dict[str, set[str]]:
    """Question ids of a reading payload keyed by their scored kind."""
    kinds: dict[str, set[str]] = {}
    groups = payload.get("questionGroups") if isinstance(payload, dict) else None
    for group in groups if isinstance(groups, list) else []:
        kind = question_kind(group)
        question_ids = group.get("questionIds") if isinstance(group, dict) else None
        ids = ({question_id for question_id in question_ids if isinstance(question_id, str) and question_id}
               if isinstance(question_ids, list) else set())
        if kind == "unknown" or not ids:
            continue
        kinds.setdefault(kind, set()).update(ids)
    return kinds


def choose_shared_kind(kinds_by_asset: dict[str, set[str]]) -> str | None:
    """A kind present in two or more assets, with a stable preference order."""
    counts: dict[str, int] = {}
    for kinds in kinds_by_asset.values():
        for kind in set(kinds):
            if isinstance(kind, str) and kind and kind != "unknown":
                counts[kind] = counts.get(kind, 0) + 1
    eligible = [kind for kind, count in counts.items() if count >= 2]
    if not eligible:
        return None

    def order(kind: str) -> tuple[int, int, str]:
        if kind in WEEKLY_KIND_PRIORITY:
            return (0, WEEKLY_KIND_PRIORITY.index(kind), kind)
        if kind == "matching":
            return (2, 0, kind)
        return (1, 0, kind)

    return min(eligible, key=order)


def weekly_wrong_question_ids(payload: dict, kind: str) -> set[str]:
    """Answer-key question ids of one kind in a reading payload."""
    return set(question_kinds(payload).get(kind, set()))


def weekly_attempt_answers(payload: dict, kind: str) -> dict:
    """Answer key with only the chosen kind's questions answered wrong."""
    answers = payload.get("answerKey") if isinstance(payload, dict) else None
    if not isinstance(answers, dict):
        return {}
    wrong = weekly_wrong_question_ids(payload, kind)
    return {question_id: PACKAGED_WRONG_ANSWER if question_id in wrong else answer
            for question_id, answer in answers.items()}


def _number_text(value) -> str:
    """A JSON number as the page's `String(number)` writes it."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def fact_display(fact: dict) -> str:
    """One weekly fact as apps/writing-vue/src/modules/notebook/weekly.js renders it."""
    value = fact.get("value") if isinstance(fact, dict) else None
    fmt = str(fact.get("format") or "").lower() if isinstance(fact, dict) else ""
    if fmt == "percent":
        return f"{math.floor(float(value) * 100 + 0.5)}%"
    if fmt == "minutes":
        return f"{_number_text(value)} 分钟"
    return _number_text(value)


def weekly_answer(body: dict) -> str:
    """The packaged fake's v3 answer: validator-clean prose plus a Soul edit."""
    facts = weekly_facts(body)
    first = ("这一周读了 {{f:volume.reading}} 篇。" if "volume.reading" in facts
             else "这一周保持练习，记录已经整理好了。")
    observation = "同类题的错误值得回看原文依据。"
    second = ("阅读正确率是 {{f:accuracy.rate}}。" + observation
              if "accuracy.rate" in facts else observation)
    evidence = weekly_evidence_fact(body)
    profile_edits = []
    if evidence:
        profile_edits = [{
            "key": "soul.companionNotes",
            "value": "先看错题，再开始新的练习。",
            "evidenceIds": [evidence],
            "reason": "同类题在两篇文章里都有错题。",
        }]
    return json.dumps({
        "digest": {
            "title": WEEKLY_TITLE,
            "body": [first, second],
            "changes": [],
            "nextSteps": [{
                "text": "下一周再做两组同类题。",
                "target": {"type": "kind", "key": "reading.tfng"},
            }],
            "strengths": ["练习记录完整，阅读和写作都有覆盖。"],
            "weaknesses": ["同类题在不同文章里出错。"],
        },
        "profileEdits": profile_edits,
        "mutations": [],
    }, ensure_ascii=False)


def send_weekly_completion(handler: http.server.BaseHTTPRequestHandler, body: dict, model: str) -> None:
    payload = json.dumps({"id": "chatcmpl-packaged-weekly", "model": model,
                          "choices": [{"message": {"role": "assistant", "content": weekly_answer(body)}}],
                          "usage": {"prompt_tokens": 13, "completion_tokens": 9}}).encode("utf-8")
    handler.send_response(200)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("x-request-id", "packaged-request-weekly")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


def weekly_fake_now(now: datetime) -> datetime:
    """First Sunday 10:00 strictly after `now`, in `now`'s own UTC offset."""
    morning = now.replace(hour=10, minute=0, second=0, microsecond=0)
    sunday = morning + timedelta(days=(6 - now.weekday()) % 7)
    return sunday if sunday > now else sunday + timedelta(days=7)


def weekday_fake_now(now: datetime) -> datetime:
    """The Wednesday before that Sunday: no weekend, so no weekly pass runs
    during the daily scenarios whatever day the CI clock says."""
    return weekly_fake_now(now) - timedelta(days=4)


class FakeAgentProvider:
    FINAL_REQUEST_ID = "packaged-request-final"

    def __init__(self, expected_tool_hash: str):
        self.port = free_tcp_port()
        self.requests: list[dict] = []
        self.expected_tool_hash = expected_tool_hash
        self.tool_result_verified = False
        owner = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length) or b"{}")
                owner.requests.append(body)
                if is_weekly_request(body):
                    send_weekly_completion(self, body, "packaged-fake-model-actual")
                    return
                messages = body.get("messages") or []
                tool_results = [message for message in messages if message.get("role") == "tool"]
                if tool_results:
                    try:
                        tool_result = json.loads(tool_results[-1].get("content") or "")
                    except (TypeError, json.JSONDecodeError):
                        self.send_error(422, "tool result was not valid JSON")
                        return
                    expected = {
                        "path": "note.txt",
                        "content": "Packaged Agent workspace evidence.",
                        "sha256": owner.expected_tool_hash,
                    }
                    if any(tool_result.get(key) != value for key, value in expected.items()):
                        self.send_error(422, "read_file did not return the expected file")
                        return
                    owner.tool_result_verified = True
                    message = {"content": "Packaged Agent run completed from the local fake provider.",
                               "tool_calls": []}
                    body_request_id = "chatcmpl-packaged-final"
                    header_request_id = owner.FINAL_REQUEST_ID
                else:
                    message = {
                        "content": None,
                        "tool_calls": [{
                            "id": "packaged-read-1",
                            "type": "function",
                            "function": {"name": "read_file", "arguments": "{\"path\":\"note.txt\"}"},
                        }],
                    }
                    body_request_id = "chatcmpl-packaged-tool"
                    header_request_id = "packaged-request-tool"
                payload = json.dumps({
                    "id": body_request_id,
                    "model": "packaged-fake-model-actual",
                    "choices": [{"message": message}],
                    "usage": {"prompt_tokens": 7, "completion_tokens": 3},
                }).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("x-request-id", header_request_id)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, _format, *_args):
                return

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", self.port), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}/v1"

    def start(self) -> None:
        self.thread.start()

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)




class FakeCoachProvider:
    MODEL = "packaged-coach-actual"
    REQUEST_ID = "packaged-coach-header"
    USAGE = {"inputTokens": 11, "outputTokens": 5}

    def __init__(self):
        self.requests: list[dict] = []
        self.responses: list[str] = []
        self.invalid_answer = False
        owner = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                if self.path != "/v1/chat/completions":
                    self.send_error(404)
                    return
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
                owner.requests.append(body)
                if is_weekly_request(body):
                    send_weekly_completion(self, body, owner.MODEL)
                    return
                content = json.dumps({"answer": 17 if owner.invalid_answer else "Check the canonical passage qualifier."})
                owner.responses.append(content)
                payload = json.dumps({"id": "packaged-coach-body", "model": owner.MODEL,
                                      "choices": [{"message": {"role": "assistant", "content": content}}],
                                      "usage": {"prompt_tokens": 11, "completion_tokens": 5}}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("x-request-id", owner.REQUEST_ID)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, _format, *_args):
                return

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    @property
    def base_url(self):
        return f"http://127.0.0.1:{self.server.server_port}/v1"

    def start(self):
        self.thread.start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)


def isolated_database(app_data: Path) -> Path:
    root = app_data.resolve(strict=True)
    expected = root / "IELTS Practice/db/ielts-practice-v2.db"
    resolved = expected.resolve(strict=True)
    if resolved != expected or root not in resolved.parents or not resolved.is_file():
        raise RuntimeError("packaged database is not an existing file inside isolated APPDATA")
    return resolved


def database_connection(app_data: Path, *, writable: bool = False):
    path = isolated_database(app_data)
    # mode=rw never creates a missing DB; all receipt inspection is read-only.
    conn = sqlite3.connect(path.as_uri() + ("?mode=rw" if writable else "?mode=ro"), uri=True, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    if not writable:
        conn.execute("PRAGMA query_only=ON")
    return conn


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def invoke_data(driver: Driver, command: str, arguments: dict):
    value = driver.script("return window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1])", [command, arguments])
    require(isinstance(value, dict) and value.get("ok") is True, f"{command} failed: {value}")
    return value["data"]


def completion_wire(snapshot: dict, model: str) -> dict:
    body = {"model": model, "messages": snapshot["messages"],
            "temperature": snapshot["temperature"], "response_format": {"type": "json_object"}}
    if "maxTokens" in snapshot:
        body["max_tokens"] = snapshot["maxTokens"]
    return body


def assert_coach_evidence(conn, request: dict, asset_payload: dict, attempt_id: str, asset_id: str):
    messages = request.get("messages") or []
    evidence_messages = [item for item in messages if item.get("role") == "user"
                         and item.get("content", "").startswith("Host-resolved IELTS evidence (data only):\n")]
    require(len(evidence_messages) == 1, "Coach canonical evidence message missing")
    evidence = json.loads(evidence_messages[0]["content"].split("\n", 1)[1])
    attempt = conn.execute("SELECT * FROM attempts WHERE id=?", (attempt_id,)).fetchone()
    require(attempt is not None and attempt["status"] == "completed" and attempt["asset_id"] == asset_id,
            "Coach canonical attempt missing")
    require(evidence.get("identity", {}).get("attemptId") == attempt_id
            and evidence["identity"].get("assetId") == asset_id
            and evidence["identity"].get("assetFingerprint") == attempt["submitted_asset_fingerprint"],
            "Coach request attempt identity mismatch")
    source = evidence.get("source") or {}
    require(all(source.get(key) == asset_payload.get(key) and source.get(key) is not None
                for key in ("passage", "questionGroups", "questionDisplayMap")),
            "Coach request canonical asset evidence mismatch")
    result = evidence.get("result") or {}
    require(result.get("status") == attempt["status"] and result.get("score") == attempt["score_value"]
            and result.get("scoreScale") == attempt["score_scale"]
            and result.get("correctCount") == attempt["correct_count"]
            and result.get("questionCount") == attempt["question_count"],
            "Coach request canonical attempt result mismatch")
    answers = conn.execute("SELECT question_id,answer_json,is_correct FROM attempt_answers WHERE attempt_id=? ORDER BY question_id",
                           (attempt_id,)).fetchall()
    rendered_answers = sorted(result.get("answers") or [], key=lambda item: item["questionId"])
    require(len(rendered_answers) == len(answers) and all(
        item["questionId"] == row["question_id"] and item["answer"] == json.loads(row["answer_json"])
        and item.get("isCorrect") == (None if row["is_correct"] is None else bool(row["is_correct"]))
        for item, row in zip(rendered_answers, answers)), "Coach request canonical attempt answers mismatch")


def assert_coach_receipt(conn, payload: dict, message: dict, provider: FakeCoachProvider, index: int, failed: bool):
    run_id, snapshot_id, invocation_id = (payload[key] for key in ("runId", "snapshotId", "invocationId"))
    run = conn.execute("SELECT * FROM agent_runs WHERE id=?", (run_id,)).fetchone()
    snapshot = conn.execute("SELECT * FROM agent_context_snapshots WHERE id=?", (snapshot_id,)).fetchone()
    invocation = conn.execute("SELECT * FROM llm_invocations WHERE id=?", (invocation_id,)).fetchone()
    require(all(row is not None for row in (run, snapshot, invocation)), "Coach linked receipt missing")
    result = json.loads(run["result_json"])
    require(run["status"] == ("failed" if failed else "completed") and run["completed_at"]
            and run["rounds"] == 1, "Coach terminal run receipt incomplete")
    require(result["snapshotId"] == snapshot_id and result["invocationId"] == invocation_id
            and result["threadId"] == message["thread_id"] and result["runKind"] == "coach"
            and snapshot["run_id"] == run_id and invocation["run_id"] == run_id, "Coach identity linkage mismatch")
    require(result["failureMessageId" if failed else "assistantMessageId"] == message["id"]
            and message["status"] == ("failed" if failed else "completed")
            and message["role"] == ("system" if failed else "assistant"), "Coach message/terminal receipt mismatch")
    user = conn.execute("SELECT * FROM coach_messages WHERE id=?", (result["userMessageId"],)).fetchone()
    require(user is not None and user["thread_id"] == message["thread_id"]
            and user["role"] == "user" and user["status"] == "completed"
            and user["sequence"] < message["sequence"], "Coach user message linkage mismatch")
    plan = json.loads(snapshot["query_plan_json"])
    require(plan["userMessageId"] == user["id"] and plan["threadId"] == message["thread_id"]
            and plan["invocationId"] == invocation_id and snapshot["scope"] == f"coach:{message['thread_id']}",
            "Coach snapshot plan linkage mismatch")
    require(conn.execute("SELECT COUNT(*) FROM llm_invocations WHERE run_id=?", (run_id,)).fetchone()[0] == 1
            and conn.execute("SELECT COUNT(*) FROM agent_context_snapshots WHERE run_id=?", (run_id,)).fetchone()[0] == 1,
            "Coach duplicated snapshot/invocation receipts")
    rendered = snapshot["rendered_context"]
    digest = hashlib.sha256(rendered.encode()).hexdigest()
    require(snapshot["content_hash"] == digest == invocation["request_hash"], "Coach request hash mismatch")
    items = conn.execute("SELECT * FROM agent_context_items WHERE snapshot_id=?", (snapshot_id,)).fetchall()
    require(len(items) == 1 and items[0]["item_id"] == user["id"]
            and json.loads(items[0]["provenance_json"])["contentHash"] == digest,
            "Coach context item provenance mismatch")
    wire = completion_wire(json.loads(rendered), "packaged-coach-requested")
    actual = provider.requests[index]
    # Rust serializes f32 temperature as its exact widened value on the wire.
    require({k: v for k, v in wire.items() if k != "temperature"}
            == {k: v for k, v in actual.items() if k != "temperature"}
            and math.isclose(wire["temperature"], actual["temperature"], abs_tol=1e-7), "Coach snapshot/wire mapping mismatch")
    require(invocation["response_hash"] == hashlib.sha256(provider.responses[index].encode()).hexdigest(), "Coach response hash mismatch")
    require(invocation["model"] == result["actualModel"] == provider.MODEL
            and json.loads(invocation["usage_json"]) == result["usage"] == provider.USAGE
            and invocation["provider_request_id"] == result["providerRequestId"] == provider.REQUEST_ID
            and isinstance(invocation["latency_ms"], int) and invocation["latency_ms"] >= 0
            and result["latencyMs"] == invocation["latency_ms"] and result["retryCount"] == 0,
            "Coach actual provider metadata mismatch")
    require(bool(run["error_json"]) == failed and bool(invocation["error_json"]) == failed,
            "Coach atomic failure receipt mismatch")
    if failed:
        require(result.get("assistantMessageId") is None
                and json.loads(run["error_json"]) == json.loads(invocation["error_json"])
                and json.loads(invocation["error_json"])["code"] == "coach.provider_failed", "Coach invalid answer did not fail closed")
    else:
        require(message["content"] == json.loads(provider.responses[index])["answer"], "Coach answer content mismatch")
    return {"runId": run_id, "snapshotId": snapshot_id, "invocationId": invocation_id, "status": run["status"]}


def _credential_api():
    require(os.name == "nt", "packaged credential verification requires Windows")
    api = ctypes.WinDLL("advapi32", use_last_error=True)
    api.CredReadW.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.POINTER(ctypes.c_void_p)]
    api.CredReadW.restype = ctypes.c_int
    api.CredDeleteW.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32]
    api.CredDeleteW.restype = ctypes.c_int
    api.CredFree.argtypes = [ctypes.c_void_p]
    return api


def _test_credential_target(config_id: str) -> str:
    # A UUID generated by this harness is the only credential we may inspect or remove.
    uuid.UUID(config_id)
    return f"ai.config.{config_id}.api_key.com.ieltsatlas.practice"


def _credential_exists(config_id: str) -> bool:
    api = _credential_api()
    credential = ctypes.c_void_p()
    if api.CredReadW(_test_credential_target(config_id), 1, 0, ctypes.byref(credential)):
        api.CredFree(credential)
        return True
    error = ctypes.get_last_error()
    if error == 1168:  # ERROR_NOT_FOUND
        return False
    raise OSError(error, "could not inspect test credential")


def cleanup_test_ai_config(driver: Driver, config_id: str) -> None:
    deletion_error = None
    try:
        invoke_data(driver, "ai_delete_config", {"id": config_id})
    except Exception as error:
        deletion_error = error
    if _credential_exists(config_id):
        # The product command can swallow a keyring delete failure. This QA-only
        # fallback targets the freshly generated credential, never a user key.
        api = _credential_api()
        if not api.CredDeleteW(_test_credential_target(config_id), 1, 0):
            raise OSError(ctypes.get_last_error(), "could not remove test credential")
    require(not _credential_exists(config_id), "test credential remains in Windows Credential Manager")
    if deletion_error:
        raise RuntimeError(f"ai_delete_config failed during test cleanup: {deletion_error}")


def check_coach(driver: Driver, app_data: Path, asset_id: str, asset_payload: dict, provider: FakeCoachProvider):
    config_id = str(uuid.uuid4())
    try:
        config = invoke_data(driver, "ai_upsert_config", {"cmd": {
            "id": config_id, "configName": "Packaged Coach E2E", "provider": "openai",
            "baseUrl": provider.base_url, "defaultModel": "packaged-coach-requested", "isEnabled": True,
            "apiKey": "packaged-local-only-key"}})
        require(_credential_exists(config_id), "test credential was not written to Windows Credential Manager")
        invoke_data(driver, "ai_set_default_config", {"id": config["id"]})
        return _check_coach_with_config(driver, app_data, asset_id, asset_payload, provider)
    finally:
        cleanup_test_ai_config(driver, config_id)


def _check_coach_with_config(driver: Driver, app_data: Path, asset_id: str, asset_payload: dict, provider: FakeCoachProvider):
    attempt = invoke_data(driver, "reading_submit_attempt", {"cmd": {
        "attemptId": "packaged-coach-attempt", "assetId": asset_id, "answers": {},
        "markedQuestions": [], "questionTimeline": [], "idempotencyKey": "packaged-coach-submit"}})
    require(attempt["attempt"]["status"] == "completed", "Coach evidence attempt was not completed")
    score_query = "SELECT status,score_value,score_scale,correct_count,question_count FROM attempts WHERE id=?"
    with closing(database_connection(app_data)) as conn:
        original_score = tuple(conn.execute(score_query, (attempt["attempt"]["id"],)).fetchone())
    thread = invoke_data(driver, "coach_ensure_thread", {"cmd": {
        "attemptId": attempt["attempt"]["id"], "assetId": asset_id, "kind": "chat"}})
    successful = invoke_data(driver, "coach_run", {"cmd": {"threadId": thread["id"], "content": "Explain my canonical reading result."}})
    assistant = successful["assistantMessage"]
    provider.invalid_answer = True
    failure = driver.script("return window.__TAURI_INTERNALS__.invoke('coach_run', {cmd: {threadId: arguments[0], content: 'Explain again.'}})", [thread["id"]])
    require(isinstance(failure, dict) and failure.get("ok") is False
            and failure.get("error", {}).get("code") == "coach.provider_failed", f"Coach illegal answer was accepted: {failure}")
    require(len(provider.requests) == 2, "Coach fake provider expected exactly two requests")
    with closing(database_connection(app_data)) as conn:
        conn.execute("BEGIN")
        messages = conn.execute("SELECT * FROM coach_messages WHERE thread_id=? ORDER BY sequence", (thread["id"],)).fetchall()
        require(len(messages) == 4, "Coach success/failure messages did not commit exactly once")
        require(messages[1]["id"] == assistant["id"] and messages[0]["id"] == successful["userMessage"]["id"], "Coach IPC message IDs differ from SQLite")
        receipts = [assert_coach_receipt(conn, assistant["structuredPayload"], dict(messages[1]), provider, 0, False),
                    assert_coach_receipt(conn, json.loads(messages[3]["structured_payload"]), dict(messages[3]), provider, 1, True)]
        for request in provider.requests:
            assert_coach_evidence(conn, request, asset_payload, attempt["attempt"]["id"], asset_id)
        require(json.loads(messages[1]["structured_payload"]) == assistant["structuredPayload"], "Coach IPC payload differs from SQLite")
        require(conn.execute("SELECT status FROM coach_threads WHERE id=?", (thread["id"],)).fetchone()[0] == "degraded", "Coach failed thread not degraded")
        require(tuple(conn.execute(score_query, (attempt["attempt"]["id"],)).fetchone()) == original_score,
                "Coach success/failure mutated canonical reading scores")
    return receipts


def native_app_pids(app: Path) -> list[int]:
    require(os.name == "nt", "native process exit verification requires Windows")
    quoted = str(app.resolve()).replace("'", "''")
    command = f"@(Get-CimInstance Win32_Process | Where-Object {{ $_.ExecutablePath -eq '{quoted}' }} | ForEach-Object {{ $_.ProcessId }}) | ConvertTo-Json -Compress"
    result = subprocess.run(["powershell", "-NoProfile", "-Command", command], capture_output=True, text=True, timeout=10, check=True)
    value = json.loads(result.stdout.strip() or "[]")
    return value if isinstance(value, list) else [value]


def close_native_app(driver: Driver, app: Path):
    require(bool(native_app_pids(app)), "staged native application process could not be identified")
    driver.close()
    driver.sid = None
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if not native_app_pids(app):
            return
        time.sleep(0.25)
    raise RuntimeError("staged native application did not exit before fixture/restart")


def seed_closed_daily_attempt(app_data: Path, day: str):
    stamp = f"{day}T12:00:00Z"
    with closing(database_connection(app_data, writable=True)) as conn, conn:
        conn.execute("INSERT INTO attempts(id,activity,mode,status,started_at,submitted_at,completed_at,duration_ms,schema_version,created_at,updated_at) VALUES(?, 'reading','single','completed',?,?,?,0,2,?,?)",
                     ("packaged-daily-yesterday", stamp, stamp, stamp, stamp, stamp))


def model_calls(provider) -> int:
    """Provider requests that the Daily pass could have made. The weekly pass is
    a separate, weekend-only model call (weekly_window_due), so it is excluded."""
    return sum(1 for body in provider.requests if not is_weekly_request(body))


def daily_receipts(app_data: Path, day: str, today: str):
    """The automatic daily pass is a deterministic summary: one `daily_journal`
    job closed against exactly one journal version. No dream run, no candidate,
    no `daily_dream` job and no model audit row may exist for it."""
    with closing(database_connection(app_data)) as conn:
        conn.execute("BEGIN")
        jobs = conn.execute("SELECT * FROM background_jobs WHERE user_id='local' AND dedupe_key=? ORDER BY job_kind",
                            (f"daily_journal:local:{day}",)).fetchall()
        today_jobs = conn.execute("SELECT COUNT(*) FROM background_jobs WHERE dedupe_key LIKE ?",
                                  (f"%:local:{today}",)).fetchone()[0]
        require(today_jobs == 0, "automatic Daily enqueued an open UTC day")
        require(conn.execute("SELECT COUNT(*) FROM background_jobs WHERE job_kind='daily_dream'").fetchone()[0] == 0,
                "automatic Daily enqueued a daily_dream job")
        if len(jobs) != 1 or jobs[0]["status"] != "completed":
            return None
        job = jobs[0]
        binding = json.loads(job["checkpoint_json"])
        # Scope to the journal this job is bound to. On a weekend the weekly pass
        # may anchor its own journal version on the same day (its failure receipt
        # needs one); that row is not the daily pass and is not counted here.
        journals = conn.execute("SELECT * FROM daily_journals WHERE user_id='local' AND journal_date=? AND id=?",
                                (day, binding.get("journalId"))).fetchall()
        require(len(journals) == 1, "Daily journal missing or duplicated")
        journal = journals[0]
        require(json.loads(journal["facts_json"])["attemptsCount"] == 1, "Daily journal did not read the yesterday fixture")
        expected = {"jobId": job["id"], "day": day, "userId": "local",
                    "journalId": journal["id"], "sourceHash": journal["source_hash"]}
        require(all(binding.get(k) == v for k, v in expected.items()) and binding.get("workerId"), "Daily checkpoint binding mismatch")
        require("dreamRunId" not in binding, "Daily checkpoint carries a dream run")
        # The weekly pass may legitimately run on a weekend in the same app
        # session (its runs carry a "weekly:" marker); the daily job may not.
        require(conn.execute("SELECT COUNT(*) FROM dream_runs WHERE input_hash IS NULL OR input_hash NOT LIKE 'weekly:%'").fetchone()[0] == 0,
                "automatic Daily wrote dream_runs")
        require(conn.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='dream_candidates'").fetchone()[0] == 0,
                "dream_candidates survived migration 0033")
        require(conn.execute("SELECT COUNT(*) FROM agent_runs WHERE model='daily-dream-v1'").fetchone()[0] == 0,
                "automatic Daily wrote a model audit row")
        return {"jobIds": [job["id"]], "journalId": journal["id"], "journalSourceHash": journal["source_hash"],
                "checkpoints": {job["job_kind"]: binding},
                "counts": {table: conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                           for table in ("background_jobs",)}
                | {"daily_journals": conn.execute("SELECT COUNT(*) FROM daily_journals WHERE id=?",
                                                  (journal["id"],)).fetchone()[0]}
                | {"dream_runs": conn.execute(
                    "SELECT COUNT(*) FROM dream_runs WHERE input_hash IS NULL OR input_hash NOT LIKE 'weekly:%'").fetchone()[0]}}


def wait_daily_receipts(app_data: Path, day: str, today: str, timeout_seconds: int = 120):
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        receipts = daily_receipts(app_data, day, today)
        if receipts:
            return receipts
        time.sleep(0.25)
    with closing(database_connection(app_data)) as conn:
        diagnostic = {
            "jobs": [dict(row) for row in conn.execute(
                "SELECT job_kind,status,attempts,max_attempts,last_error,checkpoint_json "
                "FROM background_jobs WHERE user_id='local' AND dedupe_key=? ORDER BY job_kind",
                (f"daily_journal:local:{day}",),
            )],
            "journals": [dict(row) for row in conn.execute(
                "SELECT id,source_hash FROM daily_journals WHERE user_id='local' AND journal_date=?", (day,)
            )],
        }
    raise RuntimeError(f"automatic Daily incomplete after {timeout_seconds}s: {json.dumps(diagnostic, ensure_ascii=False)}")


SCORED_READING_OBSERVATIONS = (
    "SELECT COUNT(*) FROM learner_observations WHERE user_id='local' "
    "AND projector_key='learning_observation_v1' AND projector_version=2 "
    "AND observation_type='reading.question.outcome' AND polarity IS NOT NULL "
    "AND julianday(observed_at)>julianday(?) AND julianday(observed_at)<=julianday(?)")


def ensure_weekly_evidence(driver: Driver, app_data: Path, asset_ids: list[str], weekly_now: str) -> int:
    """Seed actual answers, then assert the weekly projector's scored evidence.

    The week must hold a question type missed in two different assets: that is
    the cross-asset evidence a Soul edit can cite. The chosen kind is answered
    wrong in both selected assets (a non-empty answer is a real negative skill
    signal), while every other question is answered correctly. Extra assets are
    answered correctly only when the window still holds too few scored
    outcomes. Blank answers count as exam mistakes but carry no skill signal.
    This isolated database has no prior weekly run, so its window looks back 28
    days.
    """
    end = datetime.fromisoformat(weekly_now)
    bounds = ((end - timedelta(days=28)).isoformat(), end.isoformat())

    def count() -> int:
        invoke_data(driver, "weekly_report_current", {})  # refresh the observation projection
        with closing(database_connection(app_data)) as conn:
            return conn.execute(SCORED_READING_OBSERVATIONS, bounds).fetchone()[0]

    payloads: list[tuple[str, dict]] = []
    kinds_by_asset: dict[str, set[str]] = {}
    for asset_id in dict.fromkeys(asset_ids):
        canonical = invoke_data(driver, "reading_get_asset_payload", {"assetId": asset_id})
        payload = canonical.get("payload") if isinstance(canonical, dict) else None
        require(isinstance(payload, dict), f"weekly evidence asset payload is invalid: {asset_id}")
        answers = payload.get("answerKey")
        require(isinstance(answers, dict) and bool(answers), f"weekly evidence asset has no answer key: {asset_id}")
        kinds = question_kinds(payload)
        require(bool(kinds), f"weekly evidence asset has no question kinds: {asset_id}")
        payloads.append((asset_id, payload))
        kinds_by_asset[asset_id] = set(kinds)

    kind = choose_shared_kind(kinds_by_asset)
    require(kind is not None, "weekly evidence assets share no question kind in two assets")
    selected = [(asset_id, payload) for asset_id, payload in payloads
                if kind in kinds_by_asset[asset_id]][:2]
    require(len(selected) == 2, f"weekly evidence kind {kind!r} is present in fewer than two assets")

    def submit(index: int, asset_id: str, answers: dict) -> None:
        invoke_data(driver, "reading_submit_attempt", {"cmd": {
            "attemptId": f"packaged-weekly-attempt-{index}", "assetId": asset_id, "answers": answers,
            "markedQuestions": [], "questionTimeline": [], "idempotencyKey": f"packaged-weekly-submit-{index}"}})

    submitted = 0
    for asset_id, payload in selected:
        answers = weekly_attempt_answers(payload, kind)
        wrong = weekly_wrong_question_ids(payload, kind)
        require(bool(wrong) and any(question_id in answers for question_id in wrong),
                f"weekly evidence asset has no answer-key question of kind {kind!r}: {asset_id}")
        submit(submitted, asset_id, answers)
        submitted += 1

    scored = count()
    if scored < WEEKLY_MIN_OBSERVATIONS:
        attempted = {asset_id for asset_id, _ in selected}
        for asset_id, payload in payloads:
            if asset_id in attempted:
                continue
            submit(submitted, asset_id, payload["answerKey"])
            submitted += 1
            scored = count()
            if scored >= WEEKLY_MIN_OBSERVATIONS:
                break
    scored = count()
    require(scored >= WEEKLY_MIN_OBSERVATIONS, f"weekly window holds only {scored} scored outcomes")
    return scored


def final_weekly_run(rows: list[dict]) -> dict | None:
    """The first completed v3 final report with a narrative body."""
    for row in rows:
        if row.get("status") != "completed" or not row.get("digest_json"):
            continue
        try:
            digest = json.loads(row["digest_json"])
        except (TypeError, json.JSONDecodeError):
            continue
        narrative = digest.get("narrative") if isinstance(digest, dict) else None
        body = narrative.get("body") if isinstance(narrative, dict) else None
        if (digest.get("schemaVersion") != 3 or digest.get("state") != "final"
                or not isinstance(narrative, dict)
                or not isinstance(body, list)
                or not any(isinstance(paragraph, str) and paragraph.strip() for paragraph in body)):
            continue
        facts = digest.get("facts")
        display_title = digest.get("displayTitle")
        if not isinstance(facts, dict) or not isinstance(display_title, str) or not display_title.strip():
            continue
        return {"runId": row["id"], "inputHash": row["input_hash"],
                "displayTitle": display_title, "facts": facts, "narrativeBody": body}
    return None


def wait_weekly_run(app_data: Path, timeout_seconds: int = 180) -> dict:
    deadline = time.monotonic() + timeout_seconds
    rows: list[dict] = []
    while time.monotonic() < deadline:
        with closing(database_connection(app_data)) as conn:
            rows = [dict(row) for row in conn.execute(
                "SELECT r.id, r.status, r.input_hash, d.digest_json FROM dream_runs r "
                "LEFT JOIN weekly_digests d ON d.run_id = r.id "
                "WHERE r.input_hash LIKE 'weekly:%' ORDER BY r.id")]
        final = final_weekly_run(rows)
        if final:
            return final
        time.sleep(0.5)
    raise RuntimeError(f"weekly run incomplete after {timeout_seconds}s: {json.dumps(rows, ensure_ascii=False)[:2000]}")


def check_notebook_week(driver: Driver, weekly_run: dict) -> dict:
    """Open the v3 final week, verify its prose/data/citation, then undo the Soul edit."""
    title = weekly_run["displayTitle"]
    driver.script("location.hash = '#/'; return true")
    wait_for_value(driver, "return location.hash === '#/' && !document.querySelector('[data-notebook]')")
    driver.script("location.hash = '#/notebook'; return true")
    window = wait_for_value(driver, f"""
        const card = Array.from(document.querySelectorAll('[data-notebook-week]')).find((entry) =>
          entry.textContent.includes({json.dumps(title)}));
        if (!card) return null;
        card.click();
        return card.getAttribute('data-notebook-week');
    """, 30, label="weekly report card")
    wait_for_value(driver, """
        const sheet = document.querySelector('[data-notebook-sheet]');
        return Boolean(sheet && sheet.querySelector('[data-weekly-detail][data-week-state="final"]'));
    """, 30, label="final weekly report sheet")

    facts = weekly_run["facts"]
    require(isinstance(facts, dict) and "volume.reading" in facts,
            "final weekly run has no volume.reading fact")
    rendered_volume = fact_display(facts["volume.reading"])
    observed = wait_for_value(driver, """
        const sheet = document.querySelector('[data-notebook-sheet]');
        const detail = sheet && sheet.querySelector('[data-weekly-detail][data-week-state="final"]');
        if (!detail) return null;
        const data = detail.querySelector('[data-weekly-data]');
        return {
          text: sheet.textContent || '',
          paragraphs: detail.querySelectorAll('.weekly-paragraph').length,
          blocks: data ? data.querySelectorAll('[data-week-block]').length : 0,
          charts: data ? data.querySelectorAll('svg[role="img"]').length : 0,
        };
    """, 30, label="weekly report content")
    require(observed["paragraphs"] >= 1, f"final weekly report has no prose: {observed}")
    require(rendered_volume in observed["text"],
            f"volume.reading rendered as {rendered_volume!r} is absent from the weekly sheet")
    require("{{f:" not in observed["text"] and "}}" not in observed["text"],
            f"weekly sheet leaked a fact placeholder: {observed['text'][:400]}")
    require(observed["blocks"] >= 2, f"weekly data appendix has only {observed['blocks']} blocks")
    require(observed["charts"] >= 1, "weekly data appendix has no chart")

    wait_for_value(driver, """
        const citation = document.querySelector('[data-notebook-sheet] .weekly-citation');
        if (!citation) return false;
        citation.click();
        return true;
    """, 30, label="weekly citation")
    citation = wait_for_value(driver, """
        const source = document.querySelector('[data-notebook-sheet] .weekly-source');
        return source ? source.textContent.trim() : null;
    """, 15, label="weekly citation source")
    require("依据" in citation, f"weekly citation source is not labelled: {citation}")
    driver.script("""
        const close = document.querySelector('[data-notebook-sheet] .notebook-sheet__close');
        if (close) close.click();
        return true;
    """)
    wait_for_value(driver, "return !document.querySelector('[data-notebook-sheet]')", 15,
                   label="weekly sheet close")

    driver.script("location.hash = '#/settings'; return true")
    notes = wait_for_value(driver, """
        const notes = document.querySelector('[data-soul-settings] [data-soul-companion-notes]');
        return notes ? notes.textContent.trim() : null;
    """, 30, label="Soul companion notes")
    require("先看错题，再开始新的练习。" in notes, f"Soul companion note is missing: {notes}")
    wait_for_value(driver, f"""
        const button = Array.from(document.querySelectorAll('[data-soul-settings] button')).find((entry) =>
          entry.textContent.trim() === {json.dumps("撤销这次修改")});
        if (!button) return false;
        button.click();
        return true;
    """, 30, label="Soul undo button")
    notice = wait_for_value(driver, """
        const notice = document.querySelector('[data-soul-settings] [data-soul-notice]');
        return notice ? notice.textContent.trim() : null;
    """, 30, label="Soul undo notice")
    require("已撤销这次修改。" in notice, f"Soul undo was not confirmed: {notice}")
    wait_for_value(driver,
                   "return !document.querySelector('[data-soul-settings] [data-soul-companion-notes]')",
                   30, label="Soul companion notes removed")

    return {"window": window, "displayTitle": title, "paragraphs": observed["paragraphs"],
            "blocks": observed["blocks"], "charts": observed["charts"], "citation": citation,
            "factValue": rendered_volume, "soulNotes": notes, "soulUndo": notice}


def stage_test_runtime(app: Path) -> tuple[tempfile.TemporaryDirectory[str], Path, dict]:
    config_path = ROOT / "src-tauri/tauri.conf.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))
    resources = ((config.get("bundle") or {}).get("resources") or {})
    if not isinstance(resources, dict) or not resources:
        raise RuntimeError("tauri.conf.json does not declare packaged runtime resources")
    external_bins = ((config.get("bundle") or {}).get("externalBin") or [])
    require(isinstance(external_bins, list) and len(external_bins) == 1,
            "packaged runtime requires one declared externalBin")
    base = (config_path.parent / external_bins[0]).resolve()
    manifests = list(base.parent.glob(base.name + "-*.sha256"))
    require(len(manifests) == 1, "expected one target-specific externalBin SHA-256 manifest")
    manifest = manifests[0]
    target = manifest.name[len(base.name) + 1:-len(".sha256")]
    source_manifest = base.with_name(f"{base.name}-{target}.source-fingerprint")
    require(source_manifest.is_file(), "frozen runtime source fingerprint is missing")
    source_fingerprint = runtime_source_fingerprint()
    require(source_manifest.read_text(encoding="ascii").strip() == source_fingerprint,
            "frozen runtime source fingerprint differs from current Python inputs")
    source_sidecar = base.with_name(f"{base.name}-{target}{'.exe' if os.name == 'nt' else ''}")
    expected_hash = manifest.read_text(encoding="ascii").strip().lower()
    require(len(expected_hash) == 64 and all(char in "0123456789abcdef" for char in expected_hash),
            "externalBin SHA-256 manifest is invalid")
    require(source_sidecar.is_file() and sha256_file(source_sidecar) == expected_hash,
            "externalBin is missing or differs from its SHA-256 manifest")

    temporary = tempfile.TemporaryDirectory(prefix="ielts-tauri-e2e-")
    runtime_root = Path(temporary.name).resolve()
    runtime_app = runtime_root / app.name
    try:
        shutil.copy2(app, runtime_app)
        runtime_sidecar = runtime_root / (base.name + (".exe" if os.name == "nt" else ""))
        shutil.copy2(source_sidecar, runtime_sidecar)
        require(runtime_sidecar.is_file() and sha256_file(runtime_sidecar) == expected_hash,
                "staged externalBin SHA-256 mismatch")
        for source_name, target_name in resources.items():
            source = (config_path.parent / str(source_name)).resolve()
            destination = (runtime_root / str(target_name)).resolve()
            if destination != runtime_root and runtime_root not in destination.parents:
                raise RuntimeError(f"Tauri resource target escapes runtime directory: {target_name}")
            if source.is_dir():
                shutil.copytree(source, destination)
            elif source.is_file():
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, destination)
            else:
                raise RuntimeError(f"Tauri resource source is missing: {source}")
        verified = subprocess.run([str(runtime_app), "--verify-sidecar"], capture_output=True,
                                  text=True, timeout=30, check=False)
        require(verified.returncode == 0,
                f"staged host/externalBin identity mismatch: {(verified.stdout + verified.stderr)[-1000:]}")
    except Exception:
        temporary.cleanup()
        raise
    return temporary, runtime_app, {"path": str(runtime_sidecar), "sha256": expected_hash,
                                    "manifest": str(manifest), "target": target, "hostVerified": True,
                                    "sourceFingerprint": source_fingerprint}


def wait_for_reading_view(driver: Driver, timeout_seconds: int = 30):
    deadline = time.time() + timeout_seconds
    last = None
    while time.time() < deadline:
        last = driver.script("""
            const error = document.querySelector('.inline-message-error');
            const workspace = document.querySelector('[data-practice-reading-page]');
            return {
              ready: !!workspace && workspace.textContent.trim().length > 0,
              error: error ? error.textContent.trim() : '',
              hash: location.hash
            };
        """)
        if isinstance(last, dict) and last.get("error"):
            raise RuntimeError(f"Reading view failed: {last}")
        if isinstance(last, dict) and last.get("ready"):
            return last
        time.sleep(0.1)
    raise RuntimeError(f"Reading view did not become ready: {last}")


def capture_route_visual(driver: Driver, route: str, selector: str, screenshot: Path) -> dict:
    driver.script("location.hash = arguments[0]; return location.hash", [route])
    wait_for_value(driver, f"""
        const root = document.querySelector({selector!r});
        const transitioning = document.querySelector('.page-enter-active, .page-enter-to, .page-leave-active, .page-leave-to');
        return location.hash === {route!r}
          && root
          && root.getBoundingClientRect().width > 0
          && root.getBoundingClientRect().height > 0
          && !transitioning;
    """)
    # Vue out-in transitions can remove their classes one frame before the
    # outgoing page is actually painted. Capture stable route pixels only.
    time.sleep(0.45)
    metrics = driver.script(f"""
        const root = document.querySelector({selector!r});
        const rect = root.getBoundingClientRect();
        const offenders = Array.from(document.body.querySelectorAll('*'))
          .map((element) => {{
            const value = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            const className = typeof element.className === 'string'
              ? element.className
              : (element.className?.baseVal || '');
            return {{
              tag: element.tagName,
              id: element.id || '',
              className,
              left: value.left,
              right: value.right,
              width: value.width,
              display: style.display,
              position: style.position
            }};
          }})
          .filter((item) => item.display !== 'none' && item.width > 0 && (item.left < -2 || item.right > innerWidth + 2))
          .sort((left, right) => Math.max(right.right - innerWidth, -right.left) - Math.max(left.right - innerWidth, -left.left))
          .slice(0, 12);
        return {{
          width: rect.width,
          height: rect.height,
          scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
          viewportWidth: innerWidth,
          textLength: root.textContent.trim().length,
          offenders
        }};
    """)
    driver.screenshot(screenshot)
    if not isinstance(metrics, dict) or metrics.get("width", 0) < 320 or metrics.get("height", 0) < 120:
        raise RuntimeError(f"route {route} root is collapsed: {metrics}")
    if metrics.get("scrollWidth", 0) > metrics.get("viewportWidth", 0) + 24:
        raise RuntimeError(f"route {route} has unexpected horizontal overflow: {metrics}")
    return {**metrics, "screenshot": str(screenshot.resolve())}


def main() -> int:
    explicit_app = os.environ.get("TAURI_APP_BINARY")
    app_candidates = (ROOT / "target/release/ielts-practice-tauri.exe",
                      ROOT / "target/debug/ielts-practice-tauri.exe")
    app = Path(explicit_app) if explicit_app else next((path for path in app_candidates if path.is_file()), app_candidates[0])
    tauri = resolve_executable("TAURI_DRIVER", ("tauri-driver",),
                               (Path.home() / ".cargo/bin/tauri-driver.exe",))
    # The native driver must match the installed WebView2 runtime's major version.
    native, native_selection, native_problem = None, None, None
    try:
        native_selection = select_native_driver()
        native = native_selection.path
    except DriverSelectionError as exc:
        native_problem = str(exc)
    build_performed = False
    build_detail = None
    try:
        app, build_performed, build_detail = ensure_current_binary(app, bool(explicit_app))
    except Exception as exc:
        return blocked("current packaged executable could not be built", [str(exc)])
    missing = []
    if not app.is_file(): missing.append(f"packaged executable: {app} (set TAURI_APP_BINARY)")
    if not tauri: missing.append("tauri-driver (install cargo-tauri-driver or set TAURI_DRIVER)")
    if not native: missing.append(native_problem or "msedgedriver/chromedriver (set TAURI_NATIVE_DRIVER)")
    if missing:
        missing.extend(filter(None, [f"tauri-driver version: {executable_version(tauri) or 'unknown'}",
                                     f"native driver version: {executable_version(native) or 'unknown'}"]))
        return blocked("packaged WebView dependencies are unavailable; no fallback is permitted", missing)

    configured_url = os.environ.get("TAURI_WEBDRIVER_URL")
    configured_port = None
    if configured_url:
        parsed_url = urllib.parse.urlparse(configured_url)
        if parsed_url.hostname not in {"127.0.0.1", "localhost"} or parsed_url.port is None:
            return blocked("TAURI_WEBDRIVER_URL must use a local host and explicit port", [configured_url])
        configured_port = parsed_url.port
    driver_port, native_port = pick_ports(configured_port)
    driver_url = configured_url or f"http://127.0.0.1:{driver_port}"
    driver = Driver(driver_url)
    checks = {"coachReceipts": "not_run", "automaticDaily": "not_run", "dailyRestartDedupe": "not_run",
              "weeklyReport": "not_run"}
    local_now = datetime.now().astimezone()
    weekly_now = weekly_fake_now(local_now).isoformat(timespec="seconds")
    weekday_now = weekday_fake_now(local_now).isoformat(timespec="seconds")
    metadata = binary_metadata(app, tauri, native, build_performed)
    metadata["webview2RuntimeVersion"] = native_selection.runtime_version if native_selection else installed_webview2_version()
    if native_selection:
        metadata["nativeDriverSource"] = native_selection.source
        metadata["nativeDriverMatchedRuntime"] = native_selection.checked_against_runtime
        metadata["nativeDriversSkipped"] = [
            {"source": source, "path": path, "version": version} for source, path, version in native_selection.skipped]
    metadata["driverLog"] = str(DRIVER_LOG.resolve())
    metadata["driverUrl"] = driver_url
    metadata["nativeDriverPort"] = native_port
    if build_detail:
        metadata["buildDetail"] = build_detail
    proc = None
    driver_log = None
    staged_runtime = None
    isolated_app_data = None
    fake_agent_provider = None
    fake_coach_provider = None
    try:
        isolated_app_data = tempfile.TemporaryDirectory(prefix="ielts-tauri-appdata-")
        staged_runtime, runtime_app, sidecar_metadata = stage_test_runtime(app)
        metadata["stagedExternalBin"] = sidecar_metadata
        # The product workspace is persistent and installation-relative. Only
        # the complete test installation is temporary, to isolate test writes.
        agent_workspace = runtime_app.parent / "agent-workspace"
        agent_workspace.mkdir()
        agent_note = agent_workspace / "note.txt"
        agent_note.write_text("Packaged Agent workspace evidence.", encoding="utf-8")
        expected_agent_note_hash = sha256_file(agent_note)
        fake_agent_provider = FakeAgentProvider(expected_agent_note_hash)
        fake_agent_provider.start()
        fake_coach_provider = FakeCoachProvider()
        fake_coach_provider.start()
        metadata["stagedRuntimePath"] = str(runtime_app)
        DRIVER_LOG.parent.mkdir(parents=True, exist_ok=True)
        driver_log = DRIVER_LOG.open("w", encoding="utf-8", errors="replace")
        launch_env = {
            **os.environ,
            "APPDATA": isolated_app_data.name,
            "WEBVIEW2_USER_DATA_FOLDER": str(Path(isolated_app_data.name) / "webview"),
        }
        # The app reads its weekly clock from this env (inherited through
        # tauri-driver). Until the weekly scenario it is pinned to a weekday, so
        # a CI run on a real weekend cannot complete a weekly pass early.
        metadata["fakeNow"] = {"daily": weekday_now, "weekly": weekly_now}
        proc = start_tauri_driver(driver, tauri, native, (driver_port, native_port),
                                  {**launch_env, FAKE_NOW_ENV: weekday_now}, driver_log)
        driver.create(str(runtime_app))
        checks["launch"] = "passed"
        wait_for_vue(driver)
        for route in ("#/writing", "#/topics", "#/settings", "#/history", "#/notebook", "#/"):
            reached = driver.script("location.hash=arguments[0]; return location.hash === arguments[0]", [route])
            if not reached: raise RuntimeError(f"Vue hash route failed: {route}")
        checks["vueRoutes"] = "passed"
        metadata["uiRouteVisuals"] = {
            "library": capture_route_visual(
                driver, "#/", "[data-practice-reading-home]", LIBRARY_SCREENSHOT
            ),
            "compose": capture_route_visual(
                driver, "#/writing", ".compose-page", COMPOSE_SCREENSHOT
            ),
            "topics": capture_route_visual(
                driver, "#/topics", ".topic-manage-page", TOPICS_SCREENSHOT
            ),
            "settings": capture_route_visual(
                driver, "#/settings", "[data-writing-settings]", SETTINGS_SCREENSHOT
            ),
            "history": capture_route_visual(
                driver, "#/history", ".history-page", HISTORY_SCREENSHOT
            ),
            "notebook": capture_route_visual(
                driver, "#/notebook", "[data-notebook]", NOTEBOOK_SCREENSHOT
            ),
        }
        checks["uiRouteVisuals"] = "passed"
        result = driver.script("return window.__TAURI_INTERNALS__ ? window.__TAURI_INTERNALS__.invoke('reading_list_assets') : null")
        assets = (result or {}).get("data") if isinstance(result, dict) else None
        if not assets: raise RuntimeError("Tauri IPC bridge unavailable or reading_list_assets returned empty")
        checks["readingIpc"] = "passed"
        # The real packaged command table must reject product release writes.
        # Missing args or a business error is NOT evidence that a command is
        # unreachable; even a forged passing verdict must be refused before any
        # handler runs. The M10 teaching-strategy and M11 prompt/skill commands
        # were deleted, so the app ACL (built from generate_handler!) does not
        # know them and a release build refuses them as "not allowed by ACL".
        # check_ipc_acl.py separately keeps them out of generate_handler!.
        for command in (
            "eval_run_case", "prompt_approve_candidate",
            "prompt_promote_candidate", "prompt_rollback",
            "prompt_list_versions", "prompt_get_active",
            "prompt_propose_candidate", "skill_list_versions",
            "teaching_strategy_select", "teaching_strategy_promote_candidate",
            "teaching_strategy_user_state",
        ):
            rejected = driver.script("""
                return window.__TAURI_INTERNALS__.invoke(arguments[0], {
                  command: {
                    candidateId: 'e2e-forged-candidate', approvedBy: 'e2e',
                    targetKind: 'prompt', targetVersionId: 'e2e-forged-version',
                    rolledBackBy: 'e2e',
                    results: [{caseId: 'e2e-forged-case', passed: true,
                               score: 1, grading: {allPassed: true}}]
                  }
                }).then(value => ({resolved: true, value}))
                  .catch(error => ({resolved: false, error: String(error)}));
            """, [command])
            if (not isinstance(rejected, dict) or rejected.get("resolved") is not False
                    or rejected.get("error") != f"Command {command} not allowed by ACL"):
                raise RuntimeError(f"product prompt authority still exposed: {command}: {rejected}")
        checks["promptAuthorityBoundary"] = "passed"
        # Registered but host-only commands are refused by the capability too.
        for command in ("learning_observations_rebuild", "cognitive_runtime_restart", "delete_secret"):
            rejected = driver.script("""
                return window.__TAURI_INTERNALS__.invoke(arguments[0], {})
                  .then(value => ({resolved: true, value}))
                  .catch(error => ({resolved: false, error: String(error)}));
            """, [command])
            if (not isinstance(rejected, dict) or rejected.get("resolved") is not False
                    or rejected.get("error") != f"Command {command} not allowed by ACL"):
                raise RuntimeError(f"host-only command reachable from the webview: {command}: {rejected}")
        checks["ipcAllowList"] = "passed"
        missing_agent_run = driver.script(
            "return window.__TAURI_INTERNALS__.invoke('agent_get_run', {runId: 'e2e-missing-agent-run'})"
        )
        if (not isinstance(missing_agent_run, dict) or not missing_agent_run.get("ok")
                or missing_agent_run.get("data") is not None):
            raise RuntimeError(f"agent_get_run command contract failed: {missing_agent_run}")
        invalid_agent_request = driver.script("""
            return window.__TAURI_INTERNALS__.invoke('agent_run', {
              request: {grantId: 'unused-for-empty-prompt', prompt: '', configId: null}
            })
        """)
        invalid_agent_error = (
            invalid_agent_request.get("error") if isinstance(invalid_agent_request, dict) else None
        ) or {}
        if (not isinstance(invalid_agent_request, dict) or invalid_agent_request.get("ok")
                or invalid_agent_error.get("code") != "agent.invalid_request"):
            raise RuntimeError(f"agent_run empty-prompt boundary failed: {invalid_agent_request}")
        checks["agentIpcBoundary"] = "passed"
        ai_config = driver.script("""
            return window.__TAURI_INTERNALS__.invoke('ai_upsert_config', {cmd: {
              id: 'packaged-agent-e2e', configName: 'Packaged Agent E2E',
              provider: 'openai', baseUrl: arguments[0],
              defaultModel: 'packaged-fake-model-requested', isEnabled: true,
              apiKey: 'packaged-local-only-key'
            }})
        """, [fake_agent_provider.base_url])
        ai_config_data = (ai_config or {}).get("data") if isinstance(ai_config, dict) else None
        if not isinstance(ai_config, dict) or not ai_config.get("ok") or not isinstance(ai_config_data, dict):
            raise RuntimeError(f"packaged Agent fake provider config failed: {ai_config}")
        selected_ai = driver.script(
            "return window.__TAURI_INTERNALS__.invoke('ai_set_default_config', {id: arguments[0]})",
            [ai_config_data["id"]],
        )
        if not isinstance(selected_ai, dict) or not selected_ai.get("ok"):
            raise RuntimeError(f"packaged Agent default provider selection failed: {selected_ai}")

        # The agent workbench is a developer-only route (not in the shipping
        # build), so the packaged run drives the same IPC the workbench uses.
        default_grant = driver.script(
            "return window.__TAURI_INTERNALS__.invoke('agent_get_workspace', {path: arguments[0]})",
            [str(runtime_app.parent)],
        )
        grant_data = (default_grant or {}).get("data") or {}
        if (not default_grant.get("ok") or not grant_data.get("grantId")
                or not Path(grant_data.get("displayPath", "")).samefile(agent_workspace)):
            raise RuntimeError(f"default grant escaped the staged installation subdirectory: {default_grant}")
        checks["agentDefaultWorkspace"] = "passed"
        client_run_id = str(uuid.uuid4())
        agent_run = driver.script("""
            return window.__TAURI_INTERNALS__.invoke('agent_run', {request: {
              grantId: arguments[0], prompt: arguments[1], configId: null, runId: arguments[2]
            }});
        """, [grant_data["grantId"], "请先阅读已选上下文，提炼关键事实，再给出一份简洁、可执行的学习建议。", client_run_id])
        agent_outcome = (agent_run or {}).get("data") if isinstance(agent_run, dict) else None
        if not isinstance(agent_run, dict) or not agent_run.get("ok") or not isinstance(agent_outcome, dict):
            raise RuntimeError(f"packaged Agent run failed over IPC: {agent_run}")
        run_id = agent_outcome.get("runId")
        if not run_id:
            raise RuntimeError(f"packaged Agent run returned no run id: {agent_outcome}")
        hydrated_agent_run = driver.script(
            "return window.__TAURI_INTERNALS__.invoke('agent_get_run', {runId: arguments[0]})",
            [run_id],
        )
        hydrated_data = (
            hydrated_agent_run.get("data") if isinstance(hydrated_agent_run, dict) else None
        )
        tool_calls = hydrated_data.get("toolCalls") if isinstance(hydrated_data, dict) else None
        tool_call = tool_calls[0] if isinstance(tool_calls, list) and len(tool_calls) == 1 else {}
        tool_result = tool_call.get("result") or {}
        if (not isinstance(hydrated_agent_run, dict) or not hydrated_agent_run.get("ok")
                or not isinstance(hydrated_data, dict) or hydrated_data.get("status") != "completed"
                or len(tool_calls or []) != 1 or tool_call.get("toolName") != "read_file"
                or tool_call.get("status") != "succeeded" or tool_result.get("path") != "note.txt"
                or tool_result.get("sha256") != expected_agent_note_hash):
            raise RuntimeError(f"packaged Agent SQLite hydration failed: {hydrated_agent_run}")
        trace = hydrated_data.get("result") or {}
        required_trace = ("actualModel", "latencyMs", "usage", "retryCount",
                          "providerRequestId", "promptHash")
        if any(key not in trace for key in required_trace) or "content" in trace:
            raise RuntimeError(f"packaged Agent trace is incomplete or retained response content: {trace}")
        if trace.get("providerRequestId") != FakeAgentProvider.FINAL_REQUEST_ID:
            raise RuntimeError(f"provider request header did not win over body completion ID: {trace}")
        if not fake_agent_provider.tool_result_verified:
            raise RuntimeError("fake provider did not observe a successful read_file result")
        if model_calls(fake_agent_provider) != 2:
            raise RuntimeError(
                f"packaged Agent fake provider expected two rounds, got {model_calls(fake_agent_provider)}"
            )
        metadata["agentWorkspaceRun"] = {
            "runId": run_id,
            "output": agent_outcome.get("content", ""),
            "toolCalls": hydrated_data["toolCalls"],
            "trace": trace,
            "providerRounds": model_calls(fake_agent_provider),
            "workspacePath": grant_data["displayPath"],
        }
        checks["agentWorkspaceRun"] = "passed"
        archive = driver.script(
            "return window.__TAURI_INTERNALS__.invoke('reading_export_archive')"
        )
        archive_data = (archive or {}).get("data") if isinstance(archive, dict) else None
        if not isinstance(archive, dict) or not archive.get("ok") or not isinstance(archive_data, dict):
            raise RuntimeError(f"reading_export_archive failed: {archive}")
        if archive_data.get("schemaVersion") != "practice-history-archive.v2":
            raise RuntimeError(f"reading_export_archive returned a non-canonical schema: {archive_data}")
        rejected_archive = driver.script("""
            return window.__TAURI_INTERNALS__.invoke('reading_import_archive', {value: {
              activity: 'reading', schemaVersion: 'practice-history-archive.v2',
              exportedAt: '2026-01-01T00:00:00Z', count: 1, submissions: [{}]
            }})
        """)
        rejected_data = (rejected_archive or {}).get("data") if isinstance(rejected_archive, dict) else None
        if (not isinstance(rejected_archive, dict) or not rejected_archive.get("ok")
                or not isinstance(rejected_data, dict) or rejected_data.get("committed")
                or rejected_data.get("imported") != 0):
            raise RuntimeError(f"reading_import_archive did not fail closed: {rejected_archive}")
        checks["readingArchiveBoundary"] = "passed"
        retention = driver.script(
            "return window.__TAURI_INTERNALS__.invoke('history_get_retention_policy')"
        )
        retention_data = (retention or {}).get("data") if isinstance(retention, dict) else None
        if not isinstance(retention, dict) or not retention.get("ok") or not isinstance(retention_data, dict):
            raise RuntimeError(f"history_get_retention_policy failed: {retention}")
        invalid_retention = driver.script(
            "return window.__TAURI_INTERNALS__.invoke('history_set_retention_policy', {cmd: {maxTerminalAttempts: 51}})"
        )
        if not isinstance(invalid_retention, dict) or invalid_retention.get("ok"):
            raise RuntimeError(f"invalid retention policy was accepted: {invalid_retention}")
        checks["historyRetentionBoundary"] = "passed"
        asset_id = assets[0].get("id") or assets[0].get("assetId") or assets[0].get("asset_id")
        if not asset_id:
            raise RuntimeError(f"reading_list_assets returned an entry without an id: {assets[0]}")
        payload = driver.script("return window.__TAURI_INTERNALS__.invoke('reading_get_asset_payload', {assetId: arguments[0]})", [asset_id])
        payload_data = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(payload, dict) or not payload.get("ok") or not isinstance(payload_data, dict):
            raise RuntimeError(f"reading_get_asset_payload failed for {asset_id}: {payload}")
        if not isinstance(payload_data.get("asset"), dict) or "payload" not in payload_data:
            raise RuntimeError(f"reading payload is not canonical {{asset,payload}}: {payload_data}")
        if isinstance(payload_data.get("payload"), dict) and "asset" in payload_data["payload"] and "payload" in payload_data["payload"]:
            raise RuntimeError("reading payload is double wrapped")
        checks["bundledResources"] = "passed"
        metadata["coachReceipts"] = check_coach(driver, Path(isolated_app_data.name), str(asset_id), payload_data["payload"], fake_coach_provider)
        require(model_calls(fake_agent_provider) == 2, "Coach requests contaminated Agent provider")
        checks["coachReceipts"] = "passed"
        navigation_samples = []
        encoded_asset_id = urllib.parse.quote(str(asset_id), safe="")
        for sample_index in range(5):
            driver.script("location.hash = '#/'; return true")
            wait_for_value(driver, "return !document.querySelector('[data-practice-reading-page]')")
            route = f"#/reading/{encoded_asset_id}?e2eSample={sample_index}"
            driver.script(
                "window.__e2eReadingStart = performance.now(); location.hash = arguments[0]; return true",
                [route],
            )
            wait_for_reading_view(driver)
            elapsed = driver.script("return performance.now() - window.__e2eReadingStart")
            navigation_samples.append(round(float(elapsed), 2))
        p95_index = max(0, math.ceil(len(navigation_samples) * 0.95) - 1)
        reading_p95_ms = sorted(navigation_samples)[p95_index]
        metadata["readingNavigationMs"] = navigation_samples
        metadata["readingP95Ms"] = reading_p95_ms
        metadata["readingP95BudgetMs"] = READING_P95_BUDGET_MS
        if reading_p95_ms > READING_P95_BUDGET_MS:
            raise RuntimeError(
                f"reading view P95 {reading_p95_ms}ms exceeds {READING_P95_BUDGET_MS}ms"
            )
        checks["readingView"] = "passed"
        checks["readingPerformance"] = "passed"
        layout = driver.script("""
            const rect = (selector) => {
              const element = document.querySelector(selector);
              if (!element) return null;
              const value = element.getBoundingClientRect();
              return {x: value.x, y: value.y, width: value.width, height: value.height};
            };
            const workspace = document.querySelector('[data-practice-reading-page]');
            const style = workspace ? getComputedStyle(workspace) : null;
            return {
              viewport: {width: innerWidth, height: innerHeight, devicePixelRatio},
              workspace: rect('[data-practice-reading-page]'),
              left: rect('#left'),
              right: rect('#right'),
              divider: rect('[data-practice-reading-page] > #reading-divider'),
              passageHtml: rect('#left .passage-html'),
              gridTemplateColumns: style?.gridTemplateColumns || '',
              display: style?.display || '',
              children: workspace ? Array.from(workspace.children).map((element) => {
                const childRect = element.getBoundingClientRect();
                const childStyle = getComputedStyle(element);
                return {
                  tag: element.tagName,
                  id: element.id,
                  className: element.className,
                  x: childRect.x,
                  y: childRect.y,
                  width: childRect.width,
                  height: childRect.height,
                  position: childStyle.position,
                  gridColumn: childStyle.gridColumn,
                  gridRow: childStyle.gridRow
                };
              }) : []
            };
        """)
        metadata["readingLayout"] = layout
        if not isinstance(layout, dict):
            raise RuntimeError(f"reading layout metrics unavailable: {layout}")
        for pane_name in ("left", "right", "passageHtml"):
            pane = layout.get(pane_name) or {}
            if float(pane.get("width") or 0) < 240:
                raise RuntimeError(f"reading {pane_name} collapsed: {layout}")
        driver.screenshot(READING_SCREENSHOT)
        metadata["readingScreenshot"] = str(READING_SCREENSHOT.resolve())
        driver.script("""
            const button = document.querySelector('#note-btn');
            button.focus();
            button.click();
            return document.activeElement?.id;
        """)
        wait_for_value(
            driver,
            "return document.activeElement?.tagName === 'TEXTAREA' && getComputedStyle(document.querySelector('#notes-panel')).display !== 'none'",
        )
        tab_target = driver.script("""
            document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key: 'Tab', bubbles: true}));
            return document.activeElement?.id || '';
        """)
        if tab_target != "close-note":
            raise RuntimeError(f"notes dialog did not trap Tab: {tab_target}")
        driver.script("""
            document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
            return true;
        """)
        wait_for_value(
            driver,
            "return getComputedStyle(document.querySelector('#notes-panel')).display === 'none' && document.activeElement?.id === 'note-btn'",
        )
        checks["notesDialog"] = "passed"
        negative = driver.script("""
            return window.__TAURI_INTERNALS__.invoke('reading_submit_attempt', {cmd: {
              attemptId: 'e2e-negative-submit', assetId: arguments[0], answers: {},
              markedQuestions: [], questionTimeline: [], idempotencyKey: 'e2e-negative-key',
              payload: {answerKey: {q1: 'forged'}}
            }}).then(value => ({resolved: true, value})).catch(error => ({resolved: false, error: String(error)}));
        """, [asset_id])
        if isinstance(negative, dict) and negative.get("resolved") and (negative.get("value") or {}).get("ok"):
            raise RuntimeError("reading_submit_attempt accepted forbidden client payload/answerKey")
        checks["readingSubmitBoundary"] = "passed"
        created_backup = driver.script(
            "return window.__TAURI_INTERNALS__.invoke('create_backup', {appVersion: null})"
        )
        if not isinstance(created_backup, dict) or not created_backup.get("ok"):
            raise RuntimeError(f"create_backup failed: {created_backup}")
        backups = driver.script("return window.__TAURI_INTERNALS__.invoke('list_backups')")
        backup_items = (backups or {}).get("data", []) if isinstance(backups, dict) else []
        if not backup_items:
            raise RuntimeError(f"list_backups returned no authorized grants: {backups}")
        if any("path" in item or not item.get("grantId") for item in backup_items):
            raise RuntimeError(f"list_backups leaked raw callable paths: {backup_items}")
        preview = driver.script(
            "return window.__TAURI_INTERNALS__.invoke('import_backup_path', {grantId: arguments[0], dryRun: true})",
            [backup_items[0]["grantId"]],
        )
        if not isinstance(preview, dict) or not preview.get("ok"):
            raise RuntimeError(f"authorized backup dry-run failed: {preview}")
        forged_grant = driver.script(
            "return window.__TAURI_INTERNALS__.invoke('import_backup_path', {grantId: 'forged-e2e-grant', dryRun: true})"
        )
        if not isinstance(forged_grant, dict) or forged_grant.get("ok"):
            raise RuntimeError(f"forged backup path grant was not rejected: {forged_grant}")
        forged_error = forged_grant.get("error") or {}
        if forged_error.get("code") != "backup.path_grant":
            raise RuntimeError(f"forged backup rejection used the wrong boundary: {forged_grant}")
        checks["backupPathBoundary"] = "passed"
        updater_status = driver.script(
            "return window.__TAURI_INTERNALS__.invoke('check_for_updates')"
        )
        if not isinstance(updater_status, dict):
            raise RuntimeError(f"check_for_updates returned an invalid status: {updater_status}")
        if updater_status.get("configured") or updater_status.get("stage") != "unconfigured":
            raise RuntimeError(f"development updater did not fail closed: {updater_status}")
        restart_without_install = driver.script("""
            return window.__TAURI_INTERNALS__.invoke('restart_after_update')
              .then(value => ({resolved: true, value}))
              .catch(error => ({resolved: false, error: String(error)}));
        """)
        if not isinstance(restart_without_install, dict) or restart_without_install.get("resolved"):
            raise RuntimeError(f"restart_after_update bypassed install state: {restart_without_install}")
        checks["updaterBoundary"] = "passed"
        marker = f"e2e-{int(time.time())}"
        saved = driver.script("return window.__TAURI_INTERNALS__.invoke('upsert_setting', {cmd:{namespace:'frontend-preferences', key:'restartMarker', value:arguments[0]}})", [marker])
        if not isinstance(saved, dict) or not saved.get("ok"): raise RuntimeError(f"upsert_setting failed: {saved}")
        close_native_app(driver, runtime_app)
        utc_day = datetime.now(timezone.utc).date()
        yesterday, today = (utc_day - timedelta(days=1)).isoformat(), utc_day.isoformat()
        seed_closed_daily_attempt(Path(isolated_app_data.name), yesterday)
        provider_counts = (model_calls(fake_agent_provider), model_calls(fake_coach_provider))
        driver.create(str(runtime_app))
        wait_for_vue(driver)
        restored = driver.script("return window.__TAURI_INTERNALS__.invoke('list_settings', {namespace:'frontend-preferences'})")
        values = (restored or {}).get("data", []) if isinstance(restored, dict) else []
        checks["sqliteRestart"] = "passed" if any(x.get("key") == "restartMarker" and x.get("value") == marker for x in values) else "failed"
        daily = wait_daily_receipts(Path(isolated_app_data.name), yesterday, today)
        require(provider_counts == (model_calls(fake_agent_provider), model_calls(fake_coach_provider)),
                f"Daily called a model provider: {provider_counts} -> {(model_calls(fake_agent_provider), model_calls(fake_coach_provider))}")
        metadata["automaticDaily"] = daily
        checks["automaticDaily"] = "passed"
        close_native_app(driver, runtime_app)
        driver.create(str(runtime_app))
        wait_for_vue(driver)
        replay = wait_daily_receipts(Path(isolated_app_data.name), yesterday, today)
        require(replay == daily, f"Daily restart duplicated receipts: {daily} -> {replay}")
        # Recheck after one worker scan interval, so a delayed duplicate cannot pass.
        deadline = time.monotonic() + 65
        while time.monotonic() < deadline:
            current = daily_receipts(Path(isolated_app_data.name), yesterday, today)
            require(current == daily, f"Daily replay changed receipts or content hashes: {daily} -> {current}")
            require(provider_counts == (model_calls(fake_agent_provider), model_calls(fake_coach_provider)),
                    f"Daily replay called a model provider: {provider_counts} -> {(model_calls(fake_agent_provider), model_calls(fake_coach_provider))}; "
                    f"last agent request: {json.dumps(fake_agent_provider.requests[-1], ensure_ascii=False)[:600]}")
            time.sleep(0.25)
        checks["dailyRestartDedupe"] = "passed"
        listed_ids = (item.get("id") or item.get("assetId") or item.get("asset_id") for item in assets)
        asset_ids = list(dict.fromkeys([str(asset_id), *(str(item) for item in listed_ids if item)]))
        app_data = Path(isolated_app_data.name)
        scored = ensure_weekly_evidence(driver, app_data, asset_ids, weekly_now)
        # Relaunch on the first Sunday 10:00 after this practice: the only way to
        # vary the app's env is a new tauri-driver.
        close_native_app(driver, runtime_app)
        stop_process(proc)
        driver_port, native_port = pick_ports(configured_port)
        driver.base = configured_url.rstrip("/") if configured_url else f"http://127.0.0.1:{driver_port}"
        proc = start_tauri_driver(driver, tauri, native, (driver_port, native_port),
                                  {**launch_env, FAKE_NOW_ENV: weekly_now}, driver_log)
        driver.create(str(runtime_app))
        wait_for_vue(driver)
        weekly_run = wait_weekly_run(app_data)
        week = check_notebook_week(driver, weekly_run)
        driver.screenshot(NOTEBOOK_WEEKLY_SCREENSHOT)
        weekly_requests = sum(is_weekly_request(body) for provider in (fake_agent_provider, fake_coach_provider)
                              for body in provider.requests)
        require(weekly_requests == 1, f"expected exactly one weekly provider request, got {weekly_requests}")
        metadata["weeklyReport"] = {**weekly_run, "fakeNow": weekly_now, "scoredOutcomes": scored,
                                    "providerRequests": weekly_requests, "notebookWeek": week,
                                    "screenshot": str(NOTEBOOK_WEEKLY_SCREENSHOT.resolve())}
        checks["weeklyReport"] = "passed"
        status = "passed" if all(v == "passed" for v in checks.values()) else "failed"
        report = {"schemaVersion": 2, "generatedAt": datetime.now(timezone.utc).isoformat(),
                  "status": status, "exitCode": 0 if status == "passed" else 1,
                  "target": "packaged-tauri-2", "metadata": metadata, "checks": checks}
    except Exception as exc:
        if driver_log:
            driver_log.flush()
        report = {"schemaVersion": 2, "generatedAt": datetime.now(timezone.utc).isoformat(),
                  "status": "failed", "exitCode": 1, "target": "packaged-tauri-2",
                  "metadata": metadata, "checks": checks, "error": str(exc),
                  "driverLogTail": log_tail(DRIVER_LOG)}
    finally:
        driver.close()
        stop_process(proc)
        if fake_agent_provider:
            fake_agent_provider.close()
        if fake_coach_provider:
            fake_coach_provider.close()
        if driver_log:
            driver_log.close()
        if staged_runtime:
            staged_runtime.cleanup()
        if isolated_app_data:
            isolated_app_data.cleanup()
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return report["exitCode"]


if __name__ == "__main__": raise SystemExit(main())
