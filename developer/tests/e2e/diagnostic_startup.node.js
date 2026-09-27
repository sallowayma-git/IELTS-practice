import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const reports = path.join(root, 'developer/tests/e2e/reports');
fs.mkdirSync(reports, { recursive: true });
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ielts-diagnostic-startup-'));
for (const source of ['index.html', 'css', 'js/bundles', 'assets/vendor', 'assets/images']) {
    const destination = path.join(fixture, source);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(path.join(root, source), destination, { recursive: true });
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/IELTS-practice\//, '/');
    const filename = path.resolve(fixture, '.' + pathname);
    if (!filename.startsWith(fixture + path.sep)) return response.writeHead(403).end();
    try {
        const body = fs.readFileSync(filename);
        response.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream' });
        response.end(body);
    } catch (_) { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true,
    args: ['--allow-file-access-from-files', '--log-file=' + path.join(reports, 'diagnostic-chromium.log')] });
const results = [];
const foundationPath = 'js/bundles/core-foundation.bundle.js';
const legacyPath = 'js/bundles/legacy-app.bundle.js';
const foundation = fs.readFileSync(path.join(root, foundationPath), 'utf8');
const legacy = fs.readFileSync(path.join(root, legacyPath), 'utf8');
try {
    for (const [mode, url] of [
        ['file', pathToFileURL(path.join(fixture, 'index.html')).href],
        ['http', origin + '/index.html'],
        ['subpath', origin + '/IELTS-practice/index.html']
    ]) {
        for (const fault of ['missing', 'parse', 'rejection', 'caught-initialization', 'healthy']) {
            fs.writeFileSync(path.join(fixture, foundationPath), foundation);
            fs.writeFileSync(path.join(fixture, legacyPath), legacy);
            if (fault === 'missing') fs.unlinkSync(path.join(fixture, foundationPath));
            if (fault === 'parse') fs.writeFileSync(path.join(fixture, foundationPath), 'function invalid( {');
            if (fault === 'rejection') fs.writeFileSync(path.join(fixture, foundationPath), 'Promise.reject(new Error("PRIVATE_INITIALIZATION_DETAIL"));');
            if (fault === 'caught-initialization') {
                fs.appendFileSync(path.join(fixture, legacyPath), '\nwindow.ExamSystemAppMixins.bootstrap = { async initializeComponents() { throw new Error("PRIVATE_INITIALIZATION_DETAIL"); } };\n');
            }
            const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
            const page = await context.newPage();
            const nativeErrors = [];
            page.on('pageerror', (error) => nativeErrors.push(error.name));
            await page.goto(url + '?v=private-cache-value', { waitUntil: 'load' });
            if (fault === 'healthy') {
                await page.waitForFunction(() => window.app?.isInitialized === true);
                assert.equal(await page.locator('#diagnostic-startup-failure').count(), 0, `${mode}: optional listening files must not block startup`);
                const state = await page.evaluate(() => ({
                    same: AppDiagnostics === AppDiagnosticBootstrap.install(),
                    status: AppDiagnostics.status(), buildId: AppDiagnosticBuild.buildId,
                    startupErrors: AppDiagnostics.snapshot().events.filter((event) => event.notification.kind === 'startup').length
                }));
                assert.ok(state.same && state.status.handedOff);
                assert.equal(state.startupErrors, 0);
                results.push({ mode, fault, buildId: state.buildId, passed: true });
            } else {
                const panel = page.locator('#diagnostic-startup-failure');
                await panel.waitFor({ state: 'visible' });
                const evidence = await page.evaluate(() => JSON.parse(AppDiagnosticBootstrap.install().exportText()));
                const code = fault === 'missing' ? 'RESOURCE_LOAD_FAILED' : 'APP_BOOT_FAILED';
                assert.ok(evidence.events.some((event) => event.code === code), `${mode}/${fault}: expected ${code}`);
                assert.ok(evidence.events.every((event) => event.resource.status === 'unknown'));
                const serialized = JSON.stringify(evidence);
                for (const secret of ['PRIVATE_INITIALIZATION_DETAIL', 'private-cache-value', fixture, '127.0.0.1']) assert.equal(serialized.includes(secret), false);
                assert.ok(Buffer.byteLength(serialized) <= 32 * 1024);
                if (fault === 'parse' || fault === 'rejection') assert.ok(nativeErrors.length > 0, 'native browser output is preserved');
                const download = page.waitForEvent('download');
                await panel.getByRole('button', { name: '导出诊断' }).click();
                assert.equal((await download).suggestedFilename(), 'ielts-startup-diagnostics.txt');
                if (mode === 'http' && fault === 'missing') await page.screenshot({ path: path.join(reports, 'diagnostic-startup-panel.png') });
                results.push({ mode, fault, events: evidence.events.length, code, nativeErrors: nativeErrors.length, passed: true });
            }
            await context.close();
            console.log(`PASS ${mode}/${fault}`);
        }
    }
} finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    // Only delete the exact task-owned directory returned by mkdtemp, under the OS temp root.
    const resolved = path.resolve(fixture);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('ielts-diagnostic-startup-'));
    fs.rmSync(resolved, { recursive: true, force: true });
    fs.writeFileSync(path.join(reports, 'diagnostic-startup-report.json'), JSON.stringify({ cases: results }, null, 2));
}
assert.equal(results.length, 15);
