"""Pick the native WebDriver that matches the installed WebView2 runtime.

On Windows the Tauri app renders in WebView2 (Chromium/Edge engine) and the
packaged E2E harness reaches it through tauri-driver -> msedgedriver. Edge's
WebDriver must match the WebView2 runtime's MAJOR version, and WebView2
auto-updates, so a driver that worked last month can silently stop matching.

This module reads the installed runtime version from the Windows registry and
chooses, among drivers that already exist on this machine, the first whose major
version matches. It never downloads anything: when nothing matches it raises
`DriverSelectionError` with an actionable message.

Search order (first match wins):
  1. $TAURI_NATIVE_DRIVER (a path, or a name on PATH)
  2. msedgedriver / chromedriver on PATH
  3. %TEMP%\\ielts-msedgedriver-<version>\\msedgedriver.exe (newest version first)
  4. %LOCALAPPDATA%\\IELTSAtlas\\webdriver\\msedgedriver.exe
  5. the Edge install directories
When the runtime version cannot be read (not Windows, no registry entry) the first
existing driver is returned unchecked, which is the behaviour before this module.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path

# The WebView2 Runtime's update-client id; its `pv` value is the installed version.
WEBVIEW2_CLIENT_ID = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
REGISTRY_LOCATIONS = (
    ("HKLM", rf"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{WEBVIEW2_CLIENT_ID}"),
    ("HKLM", rf"SOFTWARE\Microsoft\EdgeUpdate\Clients\{WEBVIEW2_CLIENT_ID}"),
    ("HKCU", rf"SOFTWARE\Microsoft\EdgeUpdate\Clients\{WEBVIEW2_CLIENT_ID}"),
)
VERSION_PATTERN = re.compile(r"(\d+)\.(\d+)\.(\d+)\.(\d+)")
ENV_NAME = "TAURI_NATIVE_DRIVER"


class DriverSelectionError(RuntimeError):
    """No existing native driver matches the installed WebView2 runtime."""


@dataclass(frozen=True)
class Selection:
    path: str
    version: str | None
    source: str
    runtime_version: str | None
    # (source, path, version) of every candidate passed over, for the report.
    skipped: tuple[tuple[str, str, str | None], ...] = field(default=())

    @property
    def checked_against_runtime(self) -> bool:
        return self.runtime_version is not None


def major_of(text: str | None) -> int | None:
    """Major version in free text such as '154.0.4258.53' or 'Microsoft Edge WebDriver 154.0...'."""
    match = VERSION_PATTERN.search(text or "")
    return int(match.group(1)) if match else None


def version_in(text: str | None) -> str | None:
    match = VERSION_PATTERN.search(text or "")
    return match.group(0) if match else None


def _registry_pv(hive: str, subkey: str) -> str | None:
    if os.name != "nt":
        return None
    import winreg

    root = {"HKLM": winreg.HKEY_LOCAL_MACHINE, "HKCU": winreg.HKEY_CURRENT_USER}[hive]
    try:
        with winreg.OpenKey(root, subkey) as key:
            value, _ = winreg.QueryValueEx(key, "pv")
    except OSError:
        return None
    return version_in(str(value))


def installed_webview2_version(read: Callable[[str, str], str | None] = _registry_pv) -> str | None:
    """The WebView2 runtime version, e.g. '154.0.4258.53', or None if not found."""
    for hive, subkey in REGISTRY_LOCATIONS:
        version = read(hive, subkey)
        if version:
            return version
    return None


def probe_driver_version(path: str) -> str | None:
    try:
        result = subprocess.run([path, "--version"], capture_output=True, text=True, timeout=10, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    return version_in(result.stdout or result.stderr) if result.returncode == 0 else None


def _version_key(name: str) -> tuple[int, ...]:
    return tuple(int(part) for part in (version_in(name) or "0.0.0.0").split("."))


def candidate_drivers(
    env: Mapping[str, str] = os.environ,
    which: Callable[[str], str | None] = shutil.which,
) -> list[tuple[str, str]]:
    """(source, path) of every existing driver, in preference order, deduplicated."""
    found: list[tuple[str, str]] = []

    def add(source: str, path: str | Path | None) -> None:
        if path and Path(path).is_file() and not any(Path(path).resolve() == Path(p).resolve() for _, p in found):
            found.append((source, str(path)))

    explicit = env.get(ENV_NAME)
    if explicit:
        add(ENV_NAME, Path(explicit).expanduser() if Path(explicit).expanduser().is_file() else which(explicit))
    for name in ("msedgedriver", "chromedriver"):
        add(f"PATH:{name}", which(name))
    temp = Path(env.get("TEMP") or env.get("TMP") or "")
    if temp.is_dir():
        for directory in sorted(temp.glob("ielts-msedgedriver-*"), key=lambda p: _version_key(p.name), reverse=True):
            add(f"%TEMP%/{directory.name}", directory / "msedgedriver.exe")
    local = env.get("LOCALAPPDATA")
    if local:
        add("%LOCALAPPDATA%/IELTSAtlas/webdriver", Path(local) / "IELTSAtlas/webdriver/msedgedriver.exe")
    for variable, default in (("PROGRAMFILES(X86)", "C:/Program Files (x86)"), ("PROGRAMFILES", "C:/Program Files")):
        add("Edge install", Path(env.get(variable, default)) / "Microsoft/Edge/Application/msedgedriver.exe")
    return found


def select_native_driver(
    env: Mapping[str, str] = os.environ,
    *,
    runtime_version: str | None = None,
    read_runtime: Callable[[], str | None] = installed_webview2_version,
    which: Callable[[str], str | None] = shutil.which,
    version_of: Callable[[str], str | None] = probe_driver_version,
) -> Selection:
    """The first existing driver whose major version matches the WebView2 runtime."""
    runtime = runtime_version or read_runtime()
    candidates = candidate_drivers(env, which)
    if not candidates:
        raise DriverSelectionError(_no_driver_message(runtime))
    skipped: list[tuple[str, str, str | None]] = []
    for source, path in candidates:
        version = version_of(path)
        if runtime is None or (major_of(version) is not None and major_of(version) == major_of(runtime)):
            return Selection(path, version, source, runtime, tuple(skipped))
        skipped.append((source, path, version))
    raise DriverSelectionError(_mismatch_message(runtime, skipped))


def _fix_steps(runtime: str) -> str:
    folder = rf"%TEMP%\ielts-msedgedriver-{runtime}"
    return (
        f"Fix (this harness never downloads): get the driver for exactly {runtime} from "
        f"https://msedgedriver.microsoft.com/{runtime}/edgedriver_win64.zip "
        f"(or run developer/tests/ci/install_edge_webdriver.ps1 -Destination {folder}), "
        f"put msedgedriver.exe in {folder}, or point {ENV_NAME} at a matching msedgedriver.exe."
    )


def _no_driver_message(runtime: str | None) -> str:
    base = "No msedgedriver/chromedriver was found (checked " + ENV_NAME + ", PATH, %TEMP%/ielts-msedgedriver-*, %LOCALAPPDATA%/IELTSAtlas/webdriver, the Edge install)."
    return base + (" " + _fix_steps(runtime) if runtime else f" Set {ENV_NAME} to the driver matching the WebView2 runtime.")


def _mismatch_message(runtime: str, skipped: list[tuple[str, str, str | None]]) -> str:
    listing = "; ".join(f"{source}: {path} is {version or 'unreadable'}" for source, path, version in skipped)
    return (
        f"The installed WebView2 runtime is {runtime} (major {major_of(runtime)}), but no msedgedriver with that "
        f"major version was found. Drivers present: {listing}. " + _fix_steps(runtime)
    )
