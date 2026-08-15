#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const uiShellBundlePath = path.join(repoRoot, 'js', 'bundles', 'ui-shell.bundle.js');

const CONTENT_TYPES = Object.freeze({
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2'
});

function timeoutAfter(milliseconds, label) {
    return new Promise((_, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`${label} timed out after ${milliseconds}ms`));
        }, milliseconds);
        if (typeof timer.unref === 'function') {
            timer.unref();
        }
    });
}

async function within(promise, milliseconds, label) {
    return Promise.race([promise, timeoutAfter(milliseconds, label)]);
}

function resolveStaticPath(requestUrl) {
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(requestUrl, 'http://127.0.0.1').pathname);
    } catch (_) {
        return null;
    }
    const relativePath = pathname === '/'
        ? 'index.html'
        : pathname.replace(/^\/+/, '');
    if (!relativePath || relativePath.includes('\0')) {
        return null;
    }

    const resolved = path.resolve(repoRoot, relativePath);
    const rootPrefix = repoRoot.endsWith(path.sep) ? repoRoot : `${repoRoot}${path.sep}`;
    if (resolved !== repoRoot && !resolved.startsWith(rootPrefix)) {
        return null;
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        return null;
    }

    const realRoot = fs.realpathSync(repoRoot);
    const realPath = fs.realpathSync(resolved);
    const realRootPrefix = realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`;
    return realPath === realRoot || realPath.startsWith(realRootPrefix) ? realPath : null;
}

async function startStaticServer() {
    const server = http.createServer((request, response) => {
        const filePath = resolveStaticPath(request.url || '/');
        if (!filePath) {
            response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end('Not found');
            return;
        }
        const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()]
            || 'application/octet-stream';
        response.writeHead(200, {
            'Cache-Control': 'no-store',
            'Content-Type': contentType
        });
        if (request.method === 'HEAD') {
            response.end();
            return;
        }
        const stream = fs.createReadStream(filePath);
        stream.on('error', () => response.destroy());
        stream.pipe(response);
    });

    await within(new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    }), 5_000, 'static server listen');

    const address = server.address();
    if (!address || typeof address === 'string') {
        server.close();
        throw new Error('Static server did not expose a TCP port');
    }
    return {
        server,
        indexUrl: `http://127.0.0.1:${address.port}/index.html?test_env=1`
    };
}

async function closeStaticServer(server) {
    if (!server || !server.listening) {
        return;
    }
    if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
    }
    await within(new Promise((resolve) => {
        server.close(() => resolve());
    }), 3_000, 'static server close');
}

function resolveBrowserExecutable() {
    const repoBrowserRoot = path.join(
        repoRoot,
        'developer',
        'tests',
        'e2e',
        '.pw-browsers',
        'browsers'
    );
    const candidates = [
        chromium.executablePath(),
        path.join(repoBrowserRoot, 'chromium_headless_shell-1194', 'chrome-win', 'headless_shell.exe'),
        path.join(repoBrowserRoot, 'chromium_headless_shell-1194', 'chrome-linux', 'headless_shell'),
        path.join(repoBrowserRoot, 'chromium_headless_shell-1194', 'chrome-mac', 'headless_shell'),
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser'
    ];
    return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

async function launchChromium() {
    const executablePath = resolveBrowserExecutable();
    const options = {
        headless: true,
        args: ['--allow-file-access-from-files'],
        timeout: 30_000
    };
    if (executablePath) {
        options.executablePath = executablePath;
    }
    return chromium.launch(options);
}

async function shutdownChromium(browser) {
    await browser.close();
}

async function dismissBlockingOverlays(page) {
    const accepted = await page.evaluate(async () => {
        if (!window.LicenseModal || typeof window.LicenseModal.accept !== 'function') {
            throw new Error('LicenseModal.accept is unavailable');
        }
        return window.LicenseModal.accept();
    });
    assert.equal(accepted, true, 'GPL license consent must be committed before UI interactions');
    await page.waitForFunction(
        () => !document.getElementById('license-modal')?.classList.contains('show'),
        null,
        { timeout: 5_000 }
    );

    const overlay = page.locator('#library-loader-overlay');
    if (await overlay.count() && await overlay.isVisible()) {
        const closeButton = overlay.locator("[data-library-action='close']").first();
        assert.equal(await closeButton.isVisible(), true, 'library loader close button must be visible');
        await closeButton.click();
        await overlay.waitFor({ state: 'hidden', timeout: 5_000 });
    }
}

test('real index bundle mounts the quick picker and routes search/scope actions', { timeout: 180_000 }, async (t) => {
    const bundleSource = fs.readFileSync(uiShellBundlePath, 'utf8');
    assert.match(
        bundleSource,
        /\/\* ===== js\/components\/questionBankQuickPicker\.js ===== \*\//,
        'the generated UI shell bundle must contain the quick-picker source'
    );

    const staticRuntime = await startStaticServer();
    let browser = null;
    let page = null;
    t.after(async () => {
        if (browser) {
            await shutdownChromium(browser);
        }
        await closeStaticServer(staticRuntime.server);
    });

    browser = await launchChromium();

    page = await within(
        browser.newPage({ viewport: { width: 1280, height: 900 } }),
        30_000,
        'browser.newPage'
    );
    await within(
        page.goto(staticRuntime.indexUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 }),
        35_000,
        'page.goto(index.html)'
    );
    await page.waitForFunction(
        () => {
            const api = window.QuestionBankQuickPicker;
            const instance = api && typeof api.getInstance === 'function' ? api.getInstance() : null;
            return !!(instance && instance._mounted);
        },
        null,
        { timeout: 10_000 }
    );
    await page.waitForLoadState('load', { timeout: 30_000 });
    await page.waitForFunction(
        () => window.app?.isInitialized === true,
        null,
        { timeout: 60_000 }
    );
    await dismissBlockingOverlays(page);

    const fixture = [
        { id: 'reading-p1', type: 'reading', category: 'P1', title: 'Ocean Life' },
        { id: 'reading-p3', type: 'reading', category: 'P3', title: 'Target Passage' },
        { id: 'listening-p2', type: 'listening', category: 'P2', title: 'Target Audio' }
    ];
    await page.evaluate((examIndex) => {
        window.__quickPickerSmokeCalls = [];
        window.__browseFilter = { category: 'P1', type: 'reading' };
        window.resolveActiveLibraryIndex = async () => examIndex;
        window.ensureBrowseGroup = async () => {
            window.__quickPickerSmokeCalls.push(['ensure']);
            return true;
        };
        window.app = window.app || {};
        window.app.browseCategory = (category, type) => {
            window.__quickPickerSmokeCalls.push(['browseCategory', category, type]);
            return true;
        };
        window.app.openExam = (examId) => {
            window.__quickPickerSmokeCalls.push(['openExam', examId]);
            return true;
        };
    }, fixture);

    const trigger = page.locator('#question-bank-quick-trigger');
    const panel = page.locator('#question-bank-quick-picker');
    const search = page.locator('#question-bank-quick-search');
    const results = page.locator('#question-bank-quick-results');

    assert.equal(await trigger.isVisible(), true, 'the real trigger must be visible');
    assert.equal(await trigger.isEnabled(), true, 'the real trigger must be enabled');
    await trigger.click();
    await page.waitForFunction(
        () => {
            const picker = document.getElementById('question-bank-quick-picker');
            const scopes = document.getElementById('question-bank-quick-scopes');
            return !!(picker && !picker.hidden && scopes && scopes.getAttribute('aria-busy') === 'false');
        },
        null,
        { timeout: 10_000 }
    );
    assert.equal(await panel.getAttribute('hidden'), null, 'the real trigger must open the mounted picker');

    assert.equal(await search.isVisible(), true, 'the global-search input must be visible');
    await search.fill('target');
    const matchedIds = await results
        .locator('button[data-question-bank-action="open-exam"]')
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-exam-id')));
    assert.deepEqual(
        matchedIds,
        ['reading-p3', 'listening-p2'],
        'search must ignore the current P1 browse filter and return cross-category matches'
    );

    await results.locator('button[data-exam-id="listening-p2"]').click();
    await page.waitForFunction(
        () => window.__quickPickerSmokeCalls.some(
            (call) => call[0] === 'openExam' && call[1] === 'listening-p2'
        ),
        null,
        { timeout: 5_000 }
    );

    await trigger.click();
    await page.waitForFunction(
        () => document.getElementById('question-bank-quick-scopes')?.getAttribute('aria-busy') === 'false',
        null,
        { timeout: 10_000 }
    );
    await page.locator(
        '#question-bank-quick-scopes button[data-type="reading"][data-category="P3"]'
    ).click();
    await page.waitForFunction(
        () => window.__quickPickerSmokeCalls.some(
            (call) => call[0] === 'browseCategory' && call[1] === 'P3' && call[2] === 'reading'
        ),
        null,
        { timeout: 5_000 }
    );

    const calls = await page.evaluate(() => window.__quickPickerSmokeCalls);
    assert.deepEqual(calls, [
        ['ensure'],
        ['openExam', 'listening-p2'],
        ['ensure'],
        ['browseCategory', 'P3', 'reading']
    ]);
    assert.equal(await panel.getAttribute('hidden'), '', 'successful scope navigation must close the picker');
});
