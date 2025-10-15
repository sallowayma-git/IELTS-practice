"""Capture XiaoDaiDai dashboard view screenshots with Playwright."""

from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from playwright.async_api import async_playwright

ARTIFACT_DIR = Path("artifacts")
DEFAULT_URL = "http://127.0.0.1:8000/.superdesign/design_iterations/xiaodaidai_dashboard_1.html"
VIEW_ORDER = [
    ("overview", "xiaodaidai_overview.png"),
    ("browse", "xiaodaidai_browse.png"),
    ("practice", "xiaodaidai_practice.png"),
    ("settings", "xiaodaidai_settings.png"),
]


async def capture(url: str, viewport_width: int, viewport_height: int, delay: float) -> None:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(
            viewport={"width": viewport_width, "height": viewport_height}
        )
        await page.goto(url, wait_until="networkidle")

        for view_name, filename in VIEW_ORDER:
            if view_name != "overview":
                await page.click(f"[data-view=\"{view_name}\"]")
                await asyncio.sleep(delay)
            await page.screenshot(path=str(ARTIFACT_DIR / filename), full_page=True)

        await browser.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Capture XiaoDaiDai dashboard screenshots using Playwright"
    )
    parser.add_argument(
        "--url", default=DEFAULT_URL, help="Target XiaoDaiDai dashboard URL"
    )
    parser.add_argument(
        "--width", type=int, default=1440, help="Viewport width in pixels"
    )
    parser.add_argument(
        "--height", type=int, default=900, help="Viewport height in pixels"
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=1.0,
        help="Delay in seconds after switching views before capturing",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    asyncio.run(capture(args.url, args.width, args.height, args.delay))


if __name__ == "__main__":
    main()
