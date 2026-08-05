#!/usr/bin/env python3
"""Browser regression for the destructive settings reset."""

from __future__ import annotations

import json
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright


REPO_ROOT = Path(__file__).resolve().parents[3]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format: str, *_args: object) -> None:
        return


def main() -> None:
    handler = partial(QuietHandler, directory=str(REPO_ROOT))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_address[1]}/index.html"

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context()
            page = context.new_page()
            requested_urls: list[str] = []
            page.on("request", lambda request: requested_urls.append(request.url))
            page.on("dialog", lambda dialog: dialog.accept())

            page.goto(url, wait_until="load", timeout=60_000)
            page.wait_for_function("() => !!window.AppData && !!window.LicenseModal", timeout=60_000)
            page.evaluate("async () => { await window.AppData.ready; }")
            page.wait_for_function("() => window.app && window.app.isInitialized === true", timeout=60_000)
            page.wait_for_selector("#license-modal.show", timeout=15_000)
            page.evaluate("async () => { await window.LicenseModal.accept(); }")
            page.wait_for_function("() => !document.getElementById('license-modal').classList.contains('show')")

            assert page.evaluate("() => typeof window.clearCache") == "function"
            assert not any("/js/bundles/browse.bundle.js" in item for item in requested_urls)

            page.evaluate(
                """async () => {
                    const payload = 'x'.repeat(600);
                    const index = Array.from({ length: 800 }, (_, i) => ({
                        id: `full-reset-${i}`,
                        path: `reading/full-reset-${i}.html`,
                        payload
                    }));
                    await window.AppData.library.import({
                        id: 'full-reset-probe',
                        configuration: { name: 'full-reset-probe' },
                        index
                    });
                    await window.AppData.backups.create({
                        id: 'full-reset-probe-backup',
                        type: 'manual'
                    });
                    await window.AppData.preferences.setTheme('full-reset-theme');
                    localStorage.setItem('hasSeenGplLicense', 'true');
                    localStorage.setItem('full-reset-legacy-local', 'present');
                    sessionStorage.setItem('full-reset-legacy-session', 'present');

                    await new Promise((resolve, reject) => {
                        const request = indexedDB.open('ExamSystemDB', 1);
                        request.onupgradeneeded = () => {
                            if (!request.result.objectStoreNames.contains('keyValueStore')) {
                                request.result.createObjectStore('keyValueStore');
                            }
                        };
                        request.onerror = () => reject(request.error);
                        request.onsuccess = () => {
                            const db = request.result;
                            const tx = db.transaction('keyValueStore', 'readwrite');
                            tx.objectStore('keyValueStore').put({ stale: true }, 'full-reset-probe');
                            tx.oncomplete = () => { db.close(); resolve(); };
                            tx.onerror = () => reject(tx.error);
                        };
                    });

                    await new Promise((resolve, reject) => {
                        const request = indexedDB.open('IELTSAtlasExternalBackupV2', 1);
                        request.onupgradeneeded = () => {
                            if (!request.result.objectStoreNames.contains('binding')) {
                                request.result.createObjectStore('binding');
                            }
                        };
                        request.onerror = () => reject(request.error);
                        request.onsuccess = () => {
                            const db = request.result;
                            const tx = db.transaction('binding', 'readwrite');
                            tx.objectStore('binding').put({ directoryName: 'stale-binding' }, 'metadata');
                            tx.oncomplete = () => { db.close(); resolve(); };
                            tx.onerror = () => reject(tx.error);
                        };
                    });
                }"""
            )

            page.locator("nav.main-nav button[data-view='settings']").click()
            page.wait_for_selector("#settings-view.active", timeout=10_000)
            with page.expect_navigation(timeout=30_000):
                page.locator("#clear-cache-btn").click()

            page.wait_for_function("() => !!window.AppData && !!window.LicenseModal", timeout=60_000)
            page.evaluate("async () => { await window.AppData.ready; }")
            page.wait_for_selector("#license-modal.show", timeout=15_000)

            result = page.evaluate(
                """async () => {
                    const databaseNames = indexedDB.databases
                        ? (await indexedDB.databases()).map((entry) => entry.name)
                        : [];
                    return {
                        consent: await window.AppData.preferences.getConsent(),
                        theme: await window.AppData.preferences.getTheme(),
                        importedCount: (await window.AppData.library.getIndex('full-reset-probe')).length,
                        backupCount: (await window.AppData.backups.list()).length,
                        legacyLocal: localStorage.getItem('full-reset-legacy-local'),
                        legacySession: sessionStorage.getItem('full-reset-legacy-session'),
                        externalBound: window.ExternalBackupService.getStatus().bound,
                        databaseNames
                    };
                }"""
            )

            assert result["consent"].get("hasSeenGplLicense") is not True
            assert result["theme"] is None
            assert result["importedCount"] == 0
            assert result["backupCount"] == 0
            assert result["legacyLocal"] is None
            assert result["legacySession"] is None
            assert result["externalBound"] is False
            assert "ExamSystemDB" not in result["databaseNames"]
            assert not any("/js/bundles/browse.bundle.js" in item for item in requested_urls)

            print(json.dumps({"status": "pass", "result": result}, ensure_ascii=False))
            browser.close()
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
