import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

export const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
export const root = path.resolve(process.env.READING_QUALIFICATION_ROOT || checkout);
export const mode = process.env.READING_QUALIFICATION_MODE || 'file';
assert.ok(['file', 'http'].includes(mode), `Unsupported access mode: ${mode}`);

export async function environment() {
    const server = mode === 'http' ? http.createServer((request, response) => {
        const target = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
        if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
            response.writeHead(404); response.end(); return;
        }
        const mime = { '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css',
            '.html': 'text/html', '.svg': 'image/svg+xml' }[path.extname(target)] || 'application/octet-stream';
        response.writeHead(200, { 'content-type': mime + '; charset=utf-8', 'cache-control': 'no-store' });
        fs.createReadStream(target).pipe(response);
    }) : null;
    if (server) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true, args: ['--allow-file-access-from-files'],
        ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
    const manifest = fs.readFileSync(path.join(root, 'assets/generated/diagnostics/build-manifest.json'));
    return {
        browser,
        url: relative => server ? `http://127.0.0.1:${server.address().port}/${relative}`
            : pathToFileURL(path.join(root, relative)).href,
        provenance: {
            revision: process.env.READING_QUALIFICATION_REVISION || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
            buildId: JSON.parse(manifest).buildId,
            manifestSha256: createHash('sha256').update(manifest).digest('hex'),
            browser: browser.version(), browserName: process.env.READING_QUALIFICATION_BROWSER || 'Chromium',
            platform: process.platform, headless: true, mode, storage: 'real IndexedDB',
            sync: process.env.READING_QUALIFICATION_SYNC === '1' ? 'OPFS folders; simulated transport' : 'disabled',
            fileJournal: fs.existsSync(path.join(root, 'js/data/v2/fileJournal.js')),
            repetition: Number(process.env.READING_QUALIFICATION_REPETITION || 1)
        },
        async close() { await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); }
    };
}

export function saveReport(name, report) {
    const target = process.env.READING_QUALIFICATION_REPORT || path.join(checkout, 'developer/tests/e2e/reports', name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
}

export async function openHost(context, env) {
    const page = await context.newPage();
    await page.goto(env.url('index.html') + '?test_env=1');
    await page.waitForFunction(() => window.app?.isInitialized === true, null, { timeout: 60000 });
    await page.evaluate(async () => {
        await AppData.ready; await LicenseModal.accept();
        await window.ensureBrowseGroup(); await AppEntry.ensureSessionSuiteReady();
    });
    return page;
}

// Every gate delegates to the production operation. The held return is released
// and the original method restored even if an assertion fails.
export async function restoreInstrumentation(context) {
    for (const page of context.pages()) for (const frame of page.frames()) {
        if (page.isClosed() || frame.isDetached()) continue;
        await frame.evaluate(() => {
            for (const key of ['__freezeGate', '__registrationGate', '__qualificationGate']) {
                window[key]?.release?.(); window[key]?.restore?.();
            }
            window.__restoreQualification?.();
        }).catch(() => {}); // A page may close while the context is being disposed.
    }
}
