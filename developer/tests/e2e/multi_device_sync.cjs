const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../../..');
const credentials = { username: process.env.MULTI_DEVICE_USERNAME || `sync_${Date.now()}`,
    password: process.env.MULTI_DEVICE_PASSWORD || 'PracticeSyncTest302' };
const seed = { id: 'browser-record', sessionId: 'browser-session', examId: 'p1-high-01', type: 'reading',
    title: 'Browser migration', totalQuestions: 2, correctAnswers: 1, score: 50,
    completedAt: '2026-11-18T00:00:00.000Z', answers: { 1: 'A', 2: 'C' }, correctAnswerMap: { 1: 'A', 2: 'B' },
    notes: { 2: 'Keep this note' }, highlights: [{ text: 'Evidence', start: 0, end: 8 }], markedQuestions: ['2'] };

async function run() {
    let server;
    let browser;
    let baseURL = process.env.MULTI_DEVICE_BASE_URL;
    try {
        if (!baseURL) {
            const { createApp } = require(path.join(root, 'backend/src/app'));
            const { MemoryAuthStore } = require(path.join(root, 'backend/src/auth'));
            const { MemoryPracticeRecordStore } = require(path.join(root, 'backend/src/practiceRecords'));
            const { MemoryStore } = require(path.join(root, 'backend/node_modules/express-session'));
            const app = createApp({ repoRoot: root, authStore: new MemoryAuthStore(), practiceStore: new MemoryPracticeRecordStore(),
                sessionStore: new MemoryStore(), sessionSecret: 'browser-sync-regression-secret-123456', registrationMode: 'open', cookieSecure: false });
            server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
            baseURL = `http://127.0.0.1:${server.address().port}`;
        }
        browser = await chromium.launch({ headless: true });
        const first = await browser.newContext({ baseURL });
        const second = await browser.newContext({ baseURL });
        const firstPage = await open(first);
        await save(firstPage, seed);
        await login(firstPage, !process.env.MULTI_DEVICE_USERNAME);
        await phase(firstPage, 'unbound');
        await firstPage.locator('[data-cloud-connect]').click();
        await phase(firstPage, 'ready');
        assert.equal((await firstPage.evaluate(() => AppData.backups.list())).length, 1, 'migration creates a backup');
        let remote = await (await first.request.get('/api/practice-records')).json();
        assert.equal(remote.records.length, 1);
        assert.deepEqual(remote.records[0].answers, seed.answers);
        assert.deepEqual(remote.records[0].notes, seed.notes);
        const secondPage = await open(second);
        await login(secondPage, false);
        await phase(secondPage, 'ready');
        assert.deepEqual((await records(secondPage))[0].notes, seed.notes, 'a fresh device downloads full records');

        await save(firstPage, { ...seed, id: 'automatic-record', sessionId: 'automatic-session' });
        await firstPage.waitForFunction(async () => {
            const response = await fetch('/api/practice-records');
            return (await response.json()).records.some(record => record.id === 'automatic-record');
        }, undefined, { timeout: 15000 });
        await secondPage.evaluate(() => PracticeCloud.sync());
        await firstPage.evaluate(() => AppData.practice.delete({ recordId: 'automatic-record' }));
        await firstPage.evaluate(() => PracticeCloud.sync());
        await secondPage.evaluate(() => PracticeCloud.sync());

        await first.setOffline(true);
        await save(firstPage, { ...seed, id: 'offline-record', sessionId: 'offline-session', title: 'Saved offline' });
        await firstPage.reload().catch(() => {});
        await first.setOffline(false);
        await firstPage.goto(baseURL);
        await phase(firstPage, 'ready');
        assert.equal((await records(firstPage)).length, 2, 'offline changes survive a reload');
        await secondPage.evaluate(() => PracticeCloud.sync());
        assert.equal((await records(secondPage)).length, 2);

        // Both devices edit the same record without seeing the other's version.
        await first.setOffline(true);
        await second.setOffline(true);
        await save(firstPage, { ...seed, notes: { 2: 'First device edit' } });
        await save(secondPage, { ...seed, notes: { 2: 'Second device edit' } });
        await first.setOffline(false);
        await firstPage.evaluate(() => PracticeCloud.sync());
        await phase(firstPage, 'ready');
        // Expose the conflict before the Web Lock request settles, so the user's
        // resolution overlaps the earlier sync instead of depending on timing.
        await secondPage.evaluate(() => {
            const original = navigator.locks.request;
            const released = new Promise(resolve => { window.__testReleaseConflictSync = resolve; });
            navigator.locks.request = async function (name, ...args) {
                const result = await original.call(this, name, ...args);
                if (name === 'ielts-practice-cloud-sync' && PracticeCloud.status().phase === 'conflict') {
                    navigator.locks.request = original;
                    window.__testConflictSyncHeld = true;
                    await released;
                }
                return result;
            };
        });
        await second.setOffline(false);
        await secondPage.evaluate(() => { window.__testConflictSync = PracticeCloud.sync(); });
        await phase(secondPage, 'conflict');
        await secondPage.waitForFunction(() => window.__testConflictSyncHeld === true);
        remote = await (await first.request.get('/api/practice-records')).json();
        assert.equal(remote.records.find(item => item.id === seed.id).notes['2'], 'First device edit', 'conflict does not overwrite the server');
        await secondPage.locator('[data-cloud-resolve="remote"]').click();
        await secondPage.evaluate(async () => {
            window.__testReleaseConflictSync();
            await window.__testConflictSync;
            delete window.__testReleaseConflictSync;
            delete window.__testConflictSyncHeld;
            delete window.__testConflictSync;
        });
        await phase(secondPage, 'ready');
        assert.equal((await records(secondPage)).find(item => item.id === seed.id).notes['2'], 'First device edit');

        await firstPage.evaluate(() => AppData.practice.delete({ recordId: 'offline-record' }));
        await firstPage.evaluate(() => PracticeCloud.sync());
        await secondPage.evaluate(() => PracticeCloud.sync());
        assert.equal((await records(secondPage)).length, 1, 'remote deletion is not resurrected');
        const suite = { ...seed, id: 'suite-record', sessionId: 'suite-session', mode: 'suite', suiteEntries: [
            { ...seed, id: 'suite-child', sessionId: 'suite-child-session', notes: { 2: 'Suite child note' } }
        ] };
        await firstPage.evaluate(record => AppData.practice.finalizeSuite({ record, operationId: 'browser-suite-save' }), suite);
        await firstPage.evaluate(() => PracticeCloud.sync());
        await secondPage.evaluate(() => PracticeCloud.sync());
        assert.equal((await records(secondPage)).find(item => item.id === suite.id).suiteEntries[0].notes['2'], 'Suite child note');

        const legacyCsrf = (await (await first.request.get('/api/auth/csrf')).json()).csrfToken;
        const imported = await first.request.post('/api/practice-records/import', {
            headers: { 'X-CSRF-Token': legacyCsrf }, data: { records: [{ id: 'legacy-api-record', answers: { 1: 'B' } }] }
        });
        assert.equal(imported.status(), 201);
        await firstPage.evaluate(() => PracticeCloud.sync());
        const canonicalLegacy = (await (await first.request.get('/api/practice-records')).json()).records.find(record => record.id === 'legacy-api-record');
        assert.ok(canonicalLegacy.timestamp, 'legacy dates are assigned once and persisted');
        await secondPage.evaluate(() => PracticeCloud.sync());
        assert.equal((await records(secondPage)).find(record => record.id === 'legacy-api-record').timestamp, canonicalLegacy.timestamp);
        await firstPage.evaluate(() => PracticeCloud.sync());
        await phase(firstPage, 'ready');
        await firstPage.evaluate(() => AppData.practice.clear());
        await firstPage.evaluate(() => PracticeCloud.sync());
        await secondPage.evaluate(() => PracticeCloud.sync());
        assert.equal((await records(secondPage)).length, 0, 'clearing records propagates');

        // Local compare-and-swap rejects a response captured before a new save.
        const stale = await firstPage.evaluate(() => AppData.cloudSync.capture());
        await save(firstPage, { ...seed, id: 'concurrent-local', sessionId: 'concurrent-local-session' });
        const staleResult = await firstPage.evaluate(async captured => {
            try { await AppData.cloudSync.apply(captured, [], captured.state); return 'overwritten'; }
            catch (error) { return error.code; }
        }, stale);
        assert.equal(staleResult, 'CONFLICT');
        await firstPage.evaluate(() => PracticeCloud.sync());
        await firstPage.evaluate(() => showView('settings'));
        await firstPage.locator('[data-cloud-logout]').click();
        await phase(firstPage, 'signed-out');
        await save(firstPage, { ...seed, id: 'signed-out-record', sessionId: 'signed-out-session' });
        await secondPage.evaluate(() => PracticeCloud.sync());
        assert.equal((await records(secondPage)).some(record => record.id === 'signed-out-record'), false);
        await login(firstPage, false);
        await phase(firstPage, 'ready');
        await secondPage.evaluate(() => PracticeCloud.sync());
        assert.equal((await records(secondPage)).some(record => record.id === 'signed-out-record'), true);

        // Source updates retire duplicate passage IDs without orphaning old notes.
        await save(firstPage, { ...seed, id: 'retired-passage', sessionId: 'retired-session', examId: 'p2-high-192' });
        await firstPage.evaluate(() => AppData.practice.updateAnnotations({
            recordId: 'retired-passage', examId: 'p2-low-104', patch: { notes: { 2: 'Updated through canonical ID' } }
        }));
        await firstPage.evaluate(() => PracticeCloud.sync());
        await secondPage.evaluate(() => PracticeCloud.sync());
        const retired = await secondPage.evaluate(() => AppData.practice.get('retired-passage'));
        assert.equal(retired.examId, 'p2-low-104');
        assert.equal(retired.notes['2'], 'Updated through canonical ID');
        assert.equal((await firstPage.evaluate(() => AppData.cloudSync.capture())).records.find(record => record.id === 'retired-passage').examId, 'p2-high-192');

        if (process.env.MULTI_DEVICE_SCREENSHOT_DIR) {
            const fs = require('node:fs/promises');
            await fs.mkdir(process.env.MULTI_DEVICE_SCREENSHOT_DIR, { recursive: true });
            await firstPage.locator('#cloud-account-panel').screenshot({ path: path.join(process.env.MULTI_DEVICE_SCREENSHOT_DIR, 'cloud-sync-desktop.png') });
            await firstPage.setViewportSize({ width: 390, height: 844 });
            await firstPage.locator('#cloud-account-panel').screenshot({ path: path.join(process.env.MULTI_DEVICE_SCREENSHOT_DIR, 'cloud-sync-mobile.png') });
        }

        // Changing the session must never upload another account's local records.
        if (!process.env.MULTI_DEVICE_BASE_URL) {
            await firstPage.locator('[data-cloud-logout]').click();
            await phase(firstPage, 'signed-out');
            const otherCsrf = (await (await first.request.get('/api/auth/csrf')).json()).csrfToken;
            const registered = await first.request.post('/api/auth/register', {
                headers: { 'X-CSRF-Token': otherCsrf }, data: { username: `other_${Date.now()}`, password: credentials.password }
            });
            assert.equal(registered.status(), 201);
            await firstPage.locator('[data-cloud-refresh]').click();
            await phase(firstPage, 'error');
            assert.equal((await (await first.request.get('/api/practice-records')).json()).records.length, 0);
            assert.equal((await records(firstPage)).some(record => record.id === 'retired-passage'), true);
        }

        // Ordinary static/file hosting must not try to authenticate or synchronize.
        const local = await browser.newContext();
        const localPage = await local.newPage();
        const apiCalls = [];
        localPage.on('request', request => { if (request.url().includes('/api/')) apiCalls.push(request.url()); });
        await localPage.goto(require('node:url').pathToFileURL(path.join(root, 'index.html')).href);
        await localPage.waitForFunction(() => Boolean(window.AppData));
        await localPage.evaluate(() => AppData.ready);
        await save(localPage, seed);
        assert.equal((await records(localPage)).length, 1);
        assert.equal(await localPage.locator('#cloud-account-panel').isVisible(), false);
        assert.deepEqual(apiCalls, []);
        console.log('PASS: browser registration/login, migration backup, two-device sync, offline recovery, conflicts, deletion, suite annotations, retired passage IDs, account isolation, and file:// mode');

        async function open(context) {
            const page = await context.newPage();
            await page.goto(baseURL);
            await page.waitForFunction(() => Boolean(window.AppData));
            await page.evaluate(async () => { await AppData.ready; await AppData.preferences.setConsent({ hasSeenGplLicense: true }); });
            await page.reload();
            await page.waitForFunction(() => typeof window.showView === 'function' && Boolean(window.PracticeCloud));
            await page.evaluate(() => showView('settings'));
            await phase(page, 'signed-out');
            return page;
        }
        async function login(page, register) {
            await page.locator('[data-cloud-login] input[name="username"]').fill(credentials.username);
            await page.locator('[data-cloud-login] input[name="password"]').fill(credentials.password);
            await page.locator(register ? '[data-cloud-register]' : '[data-cloud-login] button[type="submit"]').click();
        }
    } finally {
        if (browser) await browser.close();
        if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    }
}
async function records(page) { return page.evaluate(() => AppData.practice.list({ projection: 'full' })); }
async function save(page, record) { return page.evaluate(record => AppData.practice.completeAttempt({ record }), record); }
async function phase(page, expected) {
    try { await page.waitForFunction(expected => window.PracticeCloud?.status().phase === expected, expected, { timeout: 25000 }); }
    catch (error) { throw new Error(`Expected ${expected}: ${JSON.stringify(await page.evaluate(() => window.PracticeCloud?.status()))}`, { cause: error }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
