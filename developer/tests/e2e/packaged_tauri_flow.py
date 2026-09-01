#!/usr/bin/env python3
"""Truthful packaged Tauri 2 smoke gate.

This deliberately speaks the WebDriver HTTP protocol directly, so the gate
has no hidden Playwright/file:// fallback.  Set TAURI_APP_BINARY to a built
Tauri executable and ensure tauri-driver plus the platform native driver are
on PATH (or set TAURI_DRIVER/TAURI_NATIVE_DRIVER).
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
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
REPORT = ROOT / "developer/tests/e2e/reports/suite-practice-flow-report.json"
READING_SCREENSHOT = ROOT / "developer/tests/e2e/reports/reading-practice-current.png"
LIBRARY_SCREENSHOT = ROOT / "developer/tests/e2e/reports/library-current.png"
SETTINGS_SCREENSHOT = ROOT / "developer/tests/e2e/reports/settings-current.png"
HISTORY_SCREENSHOT = ROOT / "developer/tests/e2e/reports/history-current.png"
COMPOSE_SCREENSHOT = ROOT / "developer/tests/e2e/reports/compose-current.png"
TOPICS_SCREENSHOT = ROOT / "developer/tests/e2e/reports/topics-current.png"
AGENT_SCREENSHOT = ROOT / "developer/tests/e2e/reports/agent-current.png"
DRIVER_LOG = ROOT / "developer/tests/e2e/reports/tauri-driver.log"
READING_P95_BUDGET_MS = 3000


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
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
        ROOT / "dist/writing",
    )
    candidates = [
        ROOT / "src-tauri/tauri.conf.json",
        ROOT / "src-tauri/Cargo.toml",
        ROOT / "apps/writing-vue/package.json",
    ]
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
        timeout=300,
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
                         "sqliteRestart": "blocked"}}
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


def wait_for_value(driver: Driver, source: str, timeout_seconds: int = 15):
    deadline = time.time() + timeout_seconds
    last = None
    while time.time() < deadline:
        last = driver.script(source)
        if last:
            return last
        time.sleep(0.1)
    raise RuntimeError(f"WebDriver condition timed out: {last}")


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


def drive_windows_folder_picker(path: Path) -> tuple[threading.Thread, dict]:
    if os.name != "nt":
        raise RuntimeError("packaged workspace picker automation currently requires Windows")
    state: dict = {"status": "waiting"}
    resolved = str(path.resolve())

    def worker() -> None:
        try:
            from ctypes import wintypes

            user32 = ctypes.windll.user32
            kernel32 = ctypes.windll.kernel32
            kernel32.GlobalAlloc.restype = ctypes.c_void_p
            kernel32.GlobalLock.argtypes = [ctypes.c_void_p]
            kernel32.GlobalLock.restype = ctypes.c_void_p
            kernel32.GlobalUnlock.argtypes = [ctypes.c_void_p]
            user32.SetClipboardData.argtypes = [wintypes.UINT, ctypes.c_void_p]
            user32.SetClipboardData.restype = ctypes.c_void_p
            user32.GetDlgItem.restype = wintypes.HWND
            callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

            def window_text(hwnd) -> str:
                length = user32.GetWindowTextLengthW(hwnd)
                buffer = ctypes.create_unicode_buffer(length + 1)
                user32.GetWindowTextW(hwnd, buffer, len(buffer))
                return buffer.value

            def class_name(hwnd) -> str:
                buffer = ctypes.create_unicode_buffer(256)
                user32.GetClassNameW(hwnd, buffer, len(buffer))
                return buffer.value

            dialog = None
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline and dialog is None:
                candidates = []

                @callback_type
                def collect(hwnd, _lparam):
                    if user32.IsWindowVisible(hwnd) and class_name(hwnd) == "#32770":
                        candidates.append(hwnd)
                    return True

                user32.EnumWindows(collect, 0)
                dialog = next(
                    (hwnd for hwnd in candidates if user32.GetDlgItem(hwnd, 1)),
                    None,
                )
                if dialog is None:
                    time.sleep(0.1)
            if dialog is None:
                raise RuntimeError("workspace folder dialog was not found")

            encoded = (resolved + "\0").encode("utf-16-le")
            handle = kernel32.GlobalAlloc(0x0002, len(encoded))
            if not handle:
                raise RuntimeError("failed to allocate clipboard memory")
            pointer = kernel32.GlobalLock(handle)
            ctypes.memmove(pointer, encoded, len(encoded))
            kernel32.GlobalUnlock(handle)
            if not user32.OpenClipboard(None):
                raise RuntimeError("failed to open clipboard")
            try:
                user32.EmptyClipboard()
                if not user32.SetClipboardData(13, handle):
                    raise RuntimeError("failed to set clipboard path")
            finally:
                user32.CloseClipboard()

            def key(vk: int, up: bool = False) -> None:
                user32.keybd_event(vk, 0, 0x0002 if up else 0, 0)

            def chord(modifier: int, value: int) -> None:
                key(modifier)
                key(value)
                key(value, True)
                key(modifier, True)

            user32.SetForegroundWindow(dialog)
            time.sleep(0.15)
            chord(0x11, ord("L"))
            time.sleep(0.1)
            chord(0x11, ord("V"))
            key(0x0D)
            key(0x0D, True)
            time.sleep(0.6)
            confirm = user32.GetDlgItem(dialog, 1)
            if not confirm:
                raise RuntimeError("workspace folder confirmation button was not found")
            user32.PostMessageW(confirm, 0x00F5, 0, 0)
            state.update({
                "status": "submitted",
                "dialogTitle": window_text(dialog),
                "buttonTitle": window_text(confirm),
            })
        except Exception as error:
            state.update({"status": "failed", "error": str(error)})

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()
    return thread, state


def stage_test_runtime(app: Path) -> tuple[tempfile.TemporaryDirectory[str], Path]:
    config_path = ROOT / "src-tauri/tauri.conf.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))
    resources = ((config.get("bundle") or {}).get("resources") or {})
    if not isinstance(resources, dict) or not resources:
        raise RuntimeError("tauri.conf.json does not declare packaged runtime resources")

    temporary = tempfile.TemporaryDirectory(prefix="ielts-tauri-e2e-")
    runtime_root = Path(temporary.name).resolve()
    runtime_app = runtime_root / app.name
    try:
        shutil.copy2(app, runtime_app)
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
    except Exception:
        temporary.cleanup()
        raise
    return temporary, runtime_app


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
    native = resolve_executable(
        "TAURI_NATIVE_DRIVER", ("msedgedriver", "chromedriver"),
        (Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData/Local")) / "IELTSAtlas/webdriver/msedgedriver.exe",
         Path(os.environ.get("PROGRAMFILES(X86)", "C:/Program Files (x86)")) / "Microsoft/Edge/Application/msedgedriver.exe",
         Path(os.environ.get("PROGRAMFILES", "C:/Program Files")) / "Microsoft/Edge/Application/msedgedriver.exe"),
    )
    build_performed = False
    build_detail = None
    try:
        app, build_performed, build_detail = ensure_current_binary(app, bool(explicit_app))
    except Exception as exc:
        return blocked("current packaged executable could not be built", [str(exc)])
    missing = []
    if not app.is_file(): missing.append(f"packaged executable: {app} (set TAURI_APP_BINARY)")
    if not tauri: missing.append("tauri-driver (install cargo-tauri-driver or set TAURI_DRIVER)")
    if not native: missing.append("msedgedriver/chromedriver (set TAURI_NATIVE_DRIVER)")
    if missing:
        missing.extend(filter(None, [f"tauri-driver version: {executable_version(tauri) or 'unknown'}",
                                     f"native driver version: {executable_version(native) or 'unknown'}"]))
        return blocked("packaged WebView dependencies are unavailable; no fallback is permitted", missing)

    configured_url = os.environ.get("TAURI_WEBDRIVER_URL")
    driver_port = free_tcp_port()
    if configured_url:
        parsed_url = urllib.parse.urlparse(configured_url)
        if parsed_url.hostname not in {"127.0.0.1", "localhost"} or parsed_url.port is None:
            return blocked("TAURI_WEBDRIVER_URL must use a local host and explicit port", [configured_url])
        driver_port = parsed_url.port
    native_port = free_tcp_port()
    while native_port == driver_port:
        native_port = free_tcp_port()
    driver_url = configured_url or f"http://127.0.0.1:{driver_port}"
    driver = Driver(driver_url)
    checks = {}
    metadata = binary_metadata(app, tauri, native, build_performed)
    metadata["driverLog"] = str(DRIVER_LOG.resolve())
    metadata["driverUrl"] = driver_url
    metadata["nativeDriverPort"] = native_port
    if build_detail:
        metadata["buildDetail"] = build_detail
    proc = None
    driver_log = None
    staged_runtime = None
    isolated_app_data = None
    agent_workspace = None
    fake_agent_provider = None
    picker_thread = None
    picker_state = None
    try:
        isolated_app_data = tempfile.TemporaryDirectory(prefix="ielts-tauri-appdata-")
        agent_workspace = tempfile.TemporaryDirectory(prefix="ielts-agent-workspace-")
        agent_note = Path(agent_workspace.name, "note.txt")
        agent_note.write_text("Packaged Agent workspace evidence.", encoding="utf-8")
        expected_agent_note_hash = sha256_file(agent_note)
        fake_agent_provider = FakeAgentProvider(expected_agent_note_hash)
        fake_agent_provider.start()
        staged_runtime, runtime_app = stage_test_runtime(app)
        metadata["stagedRuntimePath"] = str(runtime_app)
        DRIVER_LOG.parent.mkdir(parents=True, exist_ok=True)
        driver_log = DRIVER_LOG.open("w", encoding="utf-8", errors="replace")
        proc = subprocess.Popen(
            [
                tauri,
                "--port",
                str(driver_port),
                "--native-port",
                str(native_port),
                "--native-driver",
                native,
            ],
            cwd=ROOT,
            stdout=driver_log,
            stderr=subprocess.STDOUT,
            text=True,
            env={**os.environ, "APPDATA": isolated_app_data.name},
        )
        status = None
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                driver_log.flush()
                raise RuntimeError(
                    f"tauri-driver exited with code {proc.returncode}: {log_tail(DRIVER_LOG)}"
                )
            try:
                status = driver.call("GET", "/status", timeout_seconds=1)
                if proc.poll() is not None:
                    raise RuntimeError(
                        f"tauri-driver exited with code {proc.returncode}: {log_tail(DRIVER_LOG)}"
                    )
                break
            except Exception:
                time.sleep(0.25)
        if status is None:
            driver_log.flush()
            raise RuntimeError(f"tauri-driver was not ready after 30s: {log_tail(DRIVER_LOG)}")
        driver.create(str(runtime_app))
        checks["launch"] = "passed"
        wait_for_vue(driver)
        for route in ("#/writing", "#/topics", "#/settings", "#/history", "#/agent", "#/"):
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
            "agent": capture_route_visual(
                driver, "#/agent", "[data-agent-console]", AGENT_SCREENSHOT
            ),
        }
        checks["uiRouteVisuals"] = "passed"
        result = driver.script("return window.__TAURI_INTERNALS__ ? window.__TAURI_INTERNALS__.invoke('reading_list_assets') : null")
        assets = (result or {}).get("data") if isinstance(result, dict) else None
        if not assets: raise RuntimeError("Tauri IPC bridge unavailable or reading_list_assets returned empty")
        checks["readingIpc"] = "passed"
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

        picker_thread, picker_state = drive_windows_folder_picker(Path(agent_workspace.name))
        clicked = driver.script("""
            location.hash = '#/agent';
            const consoleRoot = document.querySelector('[data-agent-console]');
            if (!consoleRoot) return false;
            const panel = document.querySelector('details[data-agent-workspace]');
            if (!panel) return false;
            panel.open = true;
            const button = document.querySelector('.agent-workspace-select');
            if (!button) return false;
            button.click();
            return true;
        """)
        if not clicked:
            raise RuntimeError("packaged Agent workspace button was unavailable")
        picker_thread.join(timeout=15)
        if picker_thread.is_alive():
            raise RuntimeError("native Agent workspace picker automation timed out")
        if picker_state.get("status") != "submitted":
            raise RuntimeError(f"native Agent workspace picker automation failed: {picker_state}")
        workspace_name = Path(agent_workspace.name).name
        wait_for_value(
            driver,
            f"return document.querySelector('.agent-workspace-select')?.textContent.includes({workspace_name!r})",
        )
        started = driver.script("""
            const button = document.querySelector('.agent-run-button');
            if (!button || button.disabled) return false;
            button.click();
            return true;
        """)
        if not started:
            raise RuntimeError("packaged Agent run button was unavailable after workspace grant")
        agent_state = wait_for_value(driver, """
            const status = document.querySelector('.agent-page-header__status');
            if (!status?.classList.contains('is-complete') && !status?.classList.contains('is-error')) return null;
            return {
              state: status.classList.contains('is-complete') ? 'complete' : 'error',
              output: document.querySelector('.agent-output-panel p')?.textContent || ''
            };
        """, timeout_seconds=30)
        if agent_state.get("state") != "complete":
            raise RuntimeError(f"packaged Agent run failed in the real workspace UI: {agent_state}")
        agent_ui = driver.script("""
            const values = Object.fromEntries(Array.from(document.querySelectorAll('.agent-output-metadata div')).map(row => [
              row.querySelector('dt')?.textContent.trim(), row.querySelector('dd')?.textContent.trim()
            ]));
            return {
              output: document.querySelector('.agent-output-panel p')?.textContent || '',
              tools: document.querySelector('.agent-run-steps')?.textContent || '',
              values
            };
        """)
        run_id = (agent_ui.get("values") or {}).get("Run ID") if isinstance(agent_ui, dict) else None
        if not run_id or "read_file" not in agent_ui.get("tools", ""):
            raise RuntimeError(f"packaged Agent UI did not render run/tool evidence: {agent_ui}")
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
        if len(fake_agent_provider.requests) != 2:
            raise RuntimeError(
                f"packaged Agent fake provider expected two rounds, got {len(fake_agent_provider.requests)}"
            )
        metadata["agentWorkspaceRun"] = {
            "runId": run_id,
            "output": agent_ui["output"],
            "toolCalls": hydrated_data["toolCalls"],
            "trace": trace,
            "providerRounds": len(fake_agent_provider.requests),
            "workspacePicker": picker_state,
        }
        driver.screenshot(AGENT_SCREENSHOT)
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
        saved = driver.script("return window.__TAURI_INTERNALS__.invoke('upsert_setting', {cmd:{namespace:'e2e', key:'restartMarker', value:arguments[0]}})", [marker])
        if not isinstance(saved, dict) or not saved.get("ok"): raise RuntimeError(f"upsert_setting failed: {saved}")
        driver.close()
        driver.create(str(app.resolve()))
        wait_for_vue(driver)
        restored = driver.script("return window.__TAURI_INTERNALS__.invoke('list_settings', {namespace:'e2e'})")
        values = (restored or {}).get("data", []) if isinstance(restored, dict) else []
        checks["sqliteRestart"] = "passed" if any(x.get("key") == "restartMarker" and x.get("value") == marker for x in values) else "failed"
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
        if driver_log:
            driver_log.close()
        if staged_runtime:
            staged_runtime.cleanup()
        if agent_workspace:
            agent_workspace.cleanup()
        if isolated_app_data:
            isolated_app_data.cleanup()
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return report["exitCode"]


if __name__ == "__main__": raise SystemExit(main())
