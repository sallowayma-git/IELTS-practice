#!/usr/bin/env python3
"""Regression for reserved file:// popups and delayed practice UI readiness."""

from __future__ import annotations

import asyncio
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.async_api import async_playwright

from practice_submit_file_flow import wait_for_practice_popup


async def assert_waiting(task: asyncio.Task, stage: str) -> None:
    # Navigation/UI changes are held until this check finishes. The timeout
    # checks that readiness stays pending; it never advances the browser.
    done, _ = await asyncio.wait({task}, timeout=0.5)
    if done:
        await task
        raise AssertionError(f"Popup readiness completed prematurely: {stage}")
    print(f"PASS: readiness remains pending at {stage}", flush=True)


async def main() -> None:
    with TemporaryDirectory(prefix="practice-popup-readiness-") as directory:
        fixture = Path(directory)
        host_path = fixture / "host.html"
        target_path = fixture / "reading-practice.html"
        host_path.write_text("<!doctype html><title>Popup host</title>", encoding="utf-8")
        target_path.write_text(
            '<!doctype html><title>Practice target</title>'
            '<button id="submit-btn" hidden>Submit</button>',
            encoding="utf-8",
        )
        exam_id = "popup-readiness"
        expected_url = target_path.as_uri() + f"?examId={exam_id}&dataKey={exam_id}"

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            try:
                context = await browser.new_context()
                page = await context.new_page()
                await page.goto(host_path.as_uri())
                async with page.expect_popup() as popup_info:
                    await page.evaluate(
                        """({ examId, expectedUrl }) => {
                            window.app = { examWindows: new Map([
                                [examId, { expectedUrl }]
                            ]) };
                            window.reservedPopup = window.open('about:blank');
                        }""",
                        {"examId": exam_id, "expectedUrl": expected_url},
                    )
                child = await popup_info.value
                await child.wait_for_load_state("domcontentloaded")
                assert child.url == "about:blank", child.url
                # Even matching UI in the reserved document must not satisfy
                # readiness before the host's expected URL has been reached.
                await child.set_content('<button id="submit-btn">Blank document</button>')
                readiness = asyncio.create_task(wait_for_practice_popup(page, child, exam_id))
                try:
                    await assert_waiting(readiness, "about:blank with matching UI")
                    await page.evaluate(
                        "url => { window.reservedPopup.location.href = url; }",
                        expected_url,
                    )
                    await child.wait_for_url(expected_url, wait_until="domcontentloaded")
                    await assert_waiting(readiness, "target URL with hidden submit button")
                    await child.locator("#submit-btn").evaluate("button => { button.hidden = false; }")
                    await asyncio.wait_for(readiness, timeout=10)
                    metadata = await child.evaluate(
                        "() => ({ href: location.href, hasOpener: !!window.opener })"
                    )
                    assert metadata == {"href": expected_url, "hasOpener": True}, metadata
                    assert await child.locator("#submit-btn").is_visible()
                    print("PASS: metadata is evaluated in the ready target document", flush=True)
                    # The same wait must also work when navigation and UI setup
                    # have already completed before the caller receives the page.
                    await asyncio.wait_for(wait_for_practice_popup(page, child, exam_id), timeout=10)
                    print("PASS: an already-ready target completes normally", flush=True)
                finally:
                    if not readiness.done():
                        readiness.cancel()
                    await asyncio.gather(readiness, return_exceptions=True)
            finally:
                await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
