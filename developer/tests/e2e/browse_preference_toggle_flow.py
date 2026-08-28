#!/usr/bin/env python3
"""E2E: verify browse preference toggle via 📚 button and red-dot indicator state."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime
from pathlib import Path
import subprocess
import sys

REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX_URL = f"{(REPO_ROOT / 'index.html').as_uri()}?test_env=1"
REPORT_DIR = REPO_ROOT / "developer" / "tests" / "e2e" / "reports"
REPORT_PATH = REPORT_DIR / "browse-preference-toggle-report.json"

try:
    from playwright.async_api import async_playwright
except ModuleNotFoundError:
    venv_dir = (REPO_ROOT / ".venv").resolve()
    venv_python = REPO_ROOT / ".venv" / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    current_prefix = Path(sys.prefix).resolve()
    if venv_python.exists() and current_prefix != venv_dir:
        completed = subprocess.run(
            [str(venv_python), str(Path(__file__).resolve())],
            cwd=str(REPO_ROOT),
        )
        raise SystemExit(completed.returncode)
    raise


async def _dismiss_overlays(page) -> None:
    accepted = await page.evaluate(
        """async () => {
            if (!window.LicenseModal || typeof window.LicenseModal.accept !== 'function') {
                throw new Error('LicenseModal.accept is unavailable');
            }
            return window.LicenseModal.accept();
        }"""
    )
    if not accepted:
        raise RuntimeError("GPL license consent was not committed")
    await page.wait_for_function(
        "() => !document.getElementById('license-modal')?.classList.contains('show')",
        timeout=5000,
    )

    overlay = page.locator("#library-loader-overlay")
    if await overlay.count():
        try:
            await overlay.wait_for(state="visible", timeout=2000)
            close_btn = overlay.locator("[data-library-action='close']")
            if await close_btn.count():
                await close_btn.first.click()
                await overlay.wait_for(state="detached", timeout=5000)
        except Exception:
            pass


async def run() -> None:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = {"generatedAt": datetime.now().isoformat(), "status": "fail", "steps": [], "error": None}

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True, args=["--allow-file-access-from-files"])
            page = await browser.new_page()
            await page.goto(INDEX_URL)
            await page.wait_for_load_state("load")
            await page.wait_for_function("() => !!window.AppData", timeout=60000)
            await page.evaluate("async () => { await window.AppData.ready; }")
            await page.wait_for_function("() => window.app?.isInitialized === true", timeout=60000)
            await _dismiss_overlays(page)

            await page.locator("nav button[data-view='browse']").click()
            await page.wait_for_selector("#browse-view.active", timeout=15000)
            await page.wait_for_selector("#browse-title-trigger", timeout=15000)
            await page.wait_for_function(
                """
                () => {
                    const trigger = document.getElementById('browse-title-trigger');
                    if (!trigger) return false;
                    const pressed = trigger.getAttribute('aria-pressed');
                    return pressed === 'true' || pressed === 'false';
                }
                """,
                timeout=10000,
            )

            # Helper closure to capture current state.
            async def read_state() -> dict:
                return await page.evaluate(
                    """
                    async () => {
                        const trigger = document.getElementById('browse-title-trigger');
                        const dot = trigger ? trigger.querySelector('.browse-title-dot') : null;
                        const style = dot ? window.getComputedStyle(dot) : null;
                        if (typeof window.flushBrowsePreferenceWrites === 'function') {
                            await window.flushBrowsePreferenceWrites();
                        }
                        const pref = await window.AppData.preferences.getBrowse();
                        return {
                            hasTrigger: !!trigger,
                            hasDot: !!dot,
                            activeClass: !!(trigger && trigger.classList.contains('active')),
                            ariaPressed: trigger ? trigger.getAttribute('aria-pressed') : null,
                            dotOpacity: style ? style.opacity : null,
                            autoScrollEnabled: pref?.autoScrollEnabled ?? null,
                        };
                    }
                    """
                )

            before = await read_state()
            report["steps"].append({"name": "before", "state": before})

            await page.click("#browse-title-trigger")
            await page.wait_for_function(
                """() => {
                    const trigger = document.getElementById('browse-title-trigger');
                    const dot = trigger?.querySelector('.browse-title-dot');
                    return trigger?.getAttribute('aria-pressed') === 'false'
                        && Number.parseFloat(getComputedStyle(dot).opacity || '1') < 0.2;
                }""",
                timeout=2000,
            )
            after_first = await read_state()
            report["steps"].append({"name": "after_first_click", "state": after_first})

            await page.click("#browse-title-trigger")
            await page.wait_for_function(
                """() => {
                    const trigger = document.getElementById('browse-title-trigger');
                    const dot = trigger?.querySelector('.browse-title-dot');
                    return trigger?.getAttribute('aria-pressed') === 'true'
                        && Number.parseFloat(getComputedStyle(dot).opacity || '0') > 0.8;
                }""",
                timeout=2000,
            )
            after_second = await read_state()
            report["steps"].append({"name": "after_second_click", "state": after_second})

            def effective_enabled(state: dict) -> bool:
                value = state.get("autoScrollEnabled")
                if isinstance(value, bool):
                    return value
                return bool(state.get("activeClass"))

            has_required_nodes = before["hasTrigger"] and before["hasDot"]
            before_enabled = effective_enabled(before)
            after_first_enabled = effective_enabled(after_first)
            after_second_enabled = effective_enabled(after_second)
            first_changed = after_first_enabled != before_enabled
            second_restored = after_second_enabled == before_enabled

            first_opacity = float(after_first["dotOpacity"] or 0)
            second_opacity = float(after_second["dotOpacity"] or 0)
            first_dot_visible = first_opacity < 0.2 if not after_first["activeClass"] else first_opacity > 0.4
            second_dot_visible = second_opacity < 0.2 if not after_second["activeClass"] else second_opacity > 0.4

            if not (has_required_nodes and first_changed and second_restored and first_dot_visible and second_dot_visible):
                raise AssertionError(
                    json.dumps(
                        {
                            "hasRequiredNodes": has_required_nodes,
                            "firstChanged": first_changed,
                            "secondRestored": second_restored,
                            "firstDotVisible": first_dot_visible,
                            "secondDotVisible": second_dot_visible,
                        },
                        ensure_ascii=False,
                    )
                )

            report["status"] = "pass"
            await browser.close()

    except Exception as error:
        report["error"] = str(error)
        REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        raise SystemExit(1)

    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(run())
