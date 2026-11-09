"""Shared file:// startup with real Chromium directory handles and disk writes.

Only the picker/permission UI is supplied by the fixture. The app still receives
a trusted click, persists a native handle, and runs its packaged file driver.
"""
from contextlib import asynccontextmanager
from pathlib import Path
import shutil
import tempfile

from playwright import async_api

INIT = Path(__file__).with_name('localFileStorageInit.js')


def __getattr__(name):
    return getattr(async_api, name)


async def _prepare(context):
    directory = Path(tempfile.mkdtemp(prefix='ielts-local-storage-test-')).resolve()
    await context.add_init_script(path=INIT)

    def watch(page):
        async def authorize():
            if not page.url.startswith('file:'):
                return
            try:
                await page.wait_for_function("""() => !window.FileJournal
                    || ['needs-directory', 'directory-json', 'opfs-json'].includes(FileJournal.status().backend)
                    || window.AppData?.status().state === 'failed'""", timeout=15000)
                if not await page.locator('#local-file-storage-dialog').count():
                    return
                await page.evaluate('window.__testDirectoryDrop = true')
                session = await context.new_cdp_session(page)
                try:
                    for kind in ['dragEnter', 'dragOver', 'drop']:
                        await session.send('Input.dispatchDragEvent', {
                            'type': kind, 'x': 10, 'y': 10,
                            'data': {'items': [], 'files': [str(directory)], 'dragOperationsMask': 1},
                        })
                finally:
                    await session.detach()
                await page.get_by_role('dialog', name='连接本地数据目录').get_by_role('button').click()
                await page.locator('#local-file-storage-dialog').wait_for(state='detached')
                await page.evaluate('() => AppData.ready')
            except Exception as error:
                if not page.is_closed():
                    print(f'Local directory fixture failed: {error}', flush=True)
        page.on('domcontentloaded', authorize)

    context.on('page', watch)
    for page in context.pages:
        watch(page)

    def cleanup():
        assert directory.parent == Path(tempfile.gettempdir()).resolve()
        assert directory.name.startswith('ielts-local-storage-test-')
        shutil.rmtree(directory, ignore_errors=True)
    context.on('close', cleanup)
    return context


class _Chromium:
    def __init__(self, target):
        self.target = target

    def __getattr__(self, name):
        return getattr(self.target, name)

    async def launch(self, **options):
        options['args'] = [*options.get('args', []), '--enable-experimental-web-platform-features']
        browser = await self.target.launch(**options)
        new_context, new_page = browser.new_context, browser.new_page

        async def context(**kwargs):
            return await _prepare(await new_context(**kwargs))

        async def page(**kwargs):
            result = await new_page(**kwargs)
            await _prepare(result.context)
            return result
        browser.new_context, browser.new_page = context, page
        return browser


@asynccontextmanager
async def async_playwright():
    async with async_api.async_playwright() as playwright:
        class Configured:
            chromium = _Chromium(playwright.chromium)

            def __getattr__(self, name):
                return getattr(playwright, name)
        yield Configured()
