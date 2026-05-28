import asyncio
import threading
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

from playwright.async_api import async_playwright


class SilentRequestHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):  # noqa: A003 - keep signature for HTTP handler
        pass


@contextmanager
def serve_repository(root: Path):
    handler = partial(SilentRequestHandler, directory=str(root))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = server.server_address[1]

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield port
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


async def run_check() -> Path:
    repo_root = Path(__file__).resolve().parents[3]
    fixtures_root = repo_root / "developer/tests/e2e/fixtures"
    entry_point = fixtures_root / "index.html"
    if not entry_point.exists():
        raise FileNotFoundError(f"Missing fixture entry point: {entry_point}")

    reports_dir = repo_root / "developer/tests/e2e/reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    screenshot_path = reports_dir / "path-compatibility.png"

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch()
        page = await browser.new_page()

        with serve_repository(repo_root) as port:
            base_url = f"http://127.0.0.1:{port}"
            entry_url = f"{base_url}/developer/tests/e2e/fixtures/index.html"
            await page.goto(entry_url)
            await page.wait_for_selector('h1:has-text("路径兼容性测试入口")')

            await page.click("#high-frequency-link")
            await page.wait_for_selector('h1:has-text("高频次高频文章占位文件")')
            high_url = unquote(page.url)
            expected_high = "睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/placeholder.html"
            if expected_high not in high_url:
                raise AssertionError(f"Unexpected high frequency url: {high_url}")

            await page.click('a:has-text("返回测试入口")')
            await page.wait_for_selector('h1:has-text("路径兼容性测试入口")')

            await page.click("#all-articles-link")
            await page.wait_for_selector('h1:has-text("所有文章占位文件")')
            all_url = unquote(page.url)
            expected_all = "睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/placeholder.html"
            if expected_all not in all_url:
                raise AssertionError(f"Unexpected all articles url: {all_url}")

            await page.screenshot(path=str(screenshot_path), full_page=True)

        await browser.close()

    return screenshot_path


def main() -> None:
    screenshot_path = asyncio.run(run_check())
    print(f"Playwright 测试完成，截图已生成：{screenshot_path}")


if __name__ == "__main__":
    main()
