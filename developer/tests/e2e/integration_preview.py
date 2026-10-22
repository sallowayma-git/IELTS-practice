"""Exercise the integrated UI against its actual dev-only command table."""
from __future__ import annotations

import json
import os
import shutil
import subprocess

from playwright.sync_api import sync_playwright
from design_system_preview import APP, REPORTS, VITE_BIN, free_tcp_port, stop_process, wait_for_server


def main() -> int:
    port = free_tcp_port()
    base = f"http://127.0.0.1:{port}"
    REPORTS.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "VITE_TAURI_MOCK": "1"}
    errors = []
    metrics = []
    with (REPORTS / "integration-vite.log").open("wb") as log:
        process = subprocess.Popen([shutil.which("node"), str(VITE_BIN), "--host", "127.0.0.1", "--port", str(port), "--strictPort"],
                                   cwd=APP, env=env, stdout=log, stderr=subprocess.STDOUT)
        try:
            wait_for_server(process, base)
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                try:
                    for width in (1440, 1024, 390):
                        page = browser.new_page(viewport={"width": width, "height": 900}, reduced_motion="reduce")
                        page.on("pageerror", lambda error: errors.append(str(error)))
                        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
                        for route, selector, name in [
                            ("/", "[data-dashboard-kpis] .stat-value", "dashboard"),
                            ("/?view=browse", ".reading-card", "library"),
                            ("/topics", ".topic-card", "topics"),
                            ("/history", "[data-history-id]", "history"),
                            ("/settings", "#settings-reading", "settings"),
                            ("/notebook", "[data-notebook-week]", "notebook"),
                        ]:
                            page.goto(f"{base}/#{route}", wait_until="networkidle")
                            page.wait_for_selector(selector)
                            page.evaluate("document.fonts.ready")
                            assert not page.evaluate("document.documentElement.scrollWidth > innerWidth + 1"), f"{name} overflow at {width}"
                            if name in ("dashboard", "library", "notebook"):
                                page.screenshot(path=str(REPORTS / f"integration-{name}-{width}.png"))
                        page.locator("[data-notebook-week]").first.click()
                        page.locator("[data-notebook-sheet]").wait_for(state="visible")
                        assert page.locator("[data-notebook-sheet] [data-week-block]").count() == 2
                        title = page.locator("[data-notebook-sheet] h2").bounding_box()
                        assert title["width"] >= 140, f"weekly title squeezed at {width}: {title}"
                        assert page.locator("[data-notebook-sheet] .stat").first.evaluate("node => getComputedStyle(node).display") == "flex"
                        page.screenshot(path=str(REPORTS / f"integration-week-sheet-{width}.png"))
                        page.get_by_role("button", name="关闭", exact=True).click()
                        assert page.locator("[data-weekly-history]").count() == 0, "history is merged into the weekly shelf"
                        page.get_by_role("button", name="上个月", exact=True).click()
                        legacy = page.locator('[data-notebook-week="2026-W39"]')
                        legacy.wait_for(state="visible")
                        assert legacy.get_attribute("data-week-state") == "final"
                        legacy.click()
                        page.locator("[data-notebook-sheet]").wait_for(state="visible")
                        assert page.locator("[data-notebook-sheet] .weekly-paragraph").first.is_visible()
                        result = page.evaluate("command => window.__TAURI_INTERNALS__.invoke(command, {})", "integration_unknown_command")
                        assert result["ok"] is False
                        metrics.append({"width": width, "routes": 6, "weeklySheet": True, "legacyWeekCard": True})
                        page.close()
                finally:
                    browser.close()
        finally:
            stop_process(process)
    report = {"status": "failed" if errors else "passed", "metrics": metrics, "errors": errors}
    (REPORTS / "integration-preview-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return int(bool(errors))


if __name__ == "__main__":
    raise SystemExit(main())
