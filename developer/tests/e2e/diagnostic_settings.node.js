import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(process.env.DIAGNOSTIC_RUNTIME_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'));
const reports = path.resolve(process.env.DIAGNOSTIC_REPORT_DIR || path.join(root, 'developer/tests/e2e/reports'));
fs.mkdirSync(reports, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/generated/diagnostics/build-manifest.json')));
function shipped(source) {
    for (const [bundle, mappings] of Object.entries(manifest.mappings)) {
        const entry = mappings.find((item) => item.source === source);
        if (entry && bundle.startsWith('js/bundles/')) return fs.readFileSync(path.join(root, bundle), 'utf8').split('\n').slice(entry.startLine - 1, entry.endLine).join('\n');
    }
    throw new Error('Missing shipped module: ' + source);
}
const sources = ['js/diagnostics/diagnosticContract.js', 'js/diagnostics/bootstrapCollector.js', 'js/diagnostics/diagnosticStore.js',
    'js/diagnostics/diagnosticReporter.js', 'js/diagnostics/diagnosticExport.js', 'js/presentation/incident-center.js',
    'js/presentation/message-center.js', 'js/components/diagnosticSettingsPanel.js', 'js/presentation/app-actions.js'];
const entry = fs.readFileSync(path.join(root, 'index.html'), 'utf8').match(/<section class="hero-panel hero-section diagnostic-settings-panel">[\s\S]*?<\/section>/)[0];
const styles = fs.readFileSync(path.join(root, 'css/main.css'), 'utf8')
    .replace('@import url("./incident-center.css");', fs.readFileSync(path.join(root, 'css/incident-center.css'), 'utf8'));
const html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>Diagnostic settings fixture</title><style>' + styles
    + '</style><body><main style="max-width:960px;margin:auto;padding:16px"><h1>系统设置</h1>' + entry + '</main>'
    + '<script>window.clock=Date.now(); Date.now=()=>clock;</script>'
    + sources.map((source) => '<script>' + shipped(source) + '</script>').join('\n')
    + '<script>AppDiagnostics.markReady();window.seed=async(count=1)=>{clock++;const ids=Array.from({length:count},()=>AppDiagnostics.report({'
    + 'code:"PRACTICE_SAVE_FAILED",module:"practice",action:"submit",notification:{kind:"none"},'
    + 'persistence:{operation:"unconfirmed"},error:new Error("<img src=x onerror=window.PWNED=true>PRIVATE_ANSWER")}));await AppDiagnostics.flush();return ids;};</script></body></html>';
const fixture = path.join(reports, 'diagnostic-settings-fixture.html');
fs.writeFileSync(fixture, html);
const server = http.createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html); });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const results = [];
let browser;
let context;
try {
    browser = await chromium.launch({ headless: true });
    for (const [mode, url] of [['file', pathToFileURL(fixture).href], ['http', origin + '/fixture.html'], ['subpath', origin + '/practice/fixture.html']]) {
        const record = (scenario) => results.push({ mode, scenario, passed: true });
        const fresh = async (init) => {
            await context?.close();
            context = await browser.newContext({ acceptDownloads: true });
            if (init) await context.addInitScript(init);
            const page = await context.newPage();
            await page.goto(url);
            await page.evaluate(() => AppDiagnosticStore.ready);
            await page.locator('#diagnostic-settings > summary').focus();
            await page.keyboard.press('Enter');
            await page.getByRole('button', { name: '刷新诊断历史', exact: true }).waitFor();
            return page;
        };
        const refreshHistory = async (page) => {
            await page.getByRole('button', { name: '刷新诊断历史', exact: true }).click();
            await page.waitForFunction(() => !Array.from(document.querySelectorAll('#diagnostic-settings-content p'))
                .some((node) => node.textContent === '正在读取诊断历史…'));
        };
        const selectReference = async (page, id) => {
            await page.getByLabel('事件编号', { exact: true }).fill(id);
            await page.getByRole('button', { name: '查找事件', exact: true }).click();
            await page.waitForFunction((id) => document.querySelector('.diagnostic-selected h4')?.textContent.includes(id), id);
        };
        const listedIds = (page, selector) => page.locator(selector).evaluateAll((nodes) =>
            nodes.map((node) => node.textContent.match(/evt_[a-f0-9]{32}_[1-9][0-9]*/)[0]));
        let page = await fresh();
        await page.waitForFunction(() => document.querySelector('.diagnostic-settings-actions').textContent.includes('暂无可用事件'));
        assert.match(await page.locator('#diagnostic-settings').innerText(), /不是学习数据备份/);
        assert.equal(await page.locator('#diagnostic-persistence').isEnabled(), true);
        record('keyboard-entry-empty-state-and-backup-reset-boundaries');

        const ids = await page.evaluate(() => seed(25));
        await page.getByRole('button', { name: '刷新诊断历史', exact: true }).click();
        await page.waitForFunction(() => document.querySelectorAll('.diagnostic-event-list button').length === 20);
        await page.getByRole('button', { name: '下一页', exact: true }).click();
        assert.equal(await page.locator('.diagnostic-event-list button').count(), 5);
        await page.reload();
        await page.locator('#diagnostic-settings > summary').click();
        await page.getByLabel('事件编号', { exact: true }).fill(ids[0]);
        await page.getByLabel('事件编号', { exact: true }).press('Enter');
        await page.waitForFunction((id) => document.querySelector('.diagnostic-selected h4')?.textContent.includes(id), ids[0]);
        assert.match(await page.locator('.diagnostic-selected').innerText(), /尚未确认保存/);
        await page.getByText('技术详情与操作上下文（仅文本）', { exact: true }).click();
        assert.ok(!(await page.locator('.diagnostic-selected pre').textContent()).includes('PRIVATE_ANSWER'));
        assert.equal(await page.evaluate(() => window.PWNED), undefined);
        record('pagination-reload-reference-lookup-save-status-and-text-redaction');

        let download = page.waitForEvent('download');
        await page.getByRole('button', { name: '导出此事件诊断', exact: true }).click();
        const single = JSON.parse(fs.readFileSync(await (await download).path(), 'utf8'));
        assert.equal(single.selection.eventId, ids[0]);
        assert.equal(single.selection.found, true);
        download = page.waitForEvent('download');
        await page.getByRole('button', { name: '导出保留的诊断历史', exact: true }).click();
        const retained = JSON.parse(fs.readFileSync(await (await download).path(), 'utf8')).events;
        assert.equal(retained.length, 25, JSON.stringify(retained.filter(event => !ids.includes(event.eventId))));
        record('real-incident-and-retained-history-json-downloads');

        await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error(); } } }));
        await page.getByRole('button', { name: '复制此事件摘要', exact: true }).click();
        await page.waitForFunction(() => document.activeElement.tagName === 'TEXTAREA');
        const summary = page.getByRole('textbox', { name: '可选择复制的诊断摘要' });
        assert.ok((await summary.inputValue()).includes(ids[0]));
        assert.equal(await summary.evaluate((node) => node.selectionEnd), (await summary.inputValue()).length);
        await page.evaluate(() => { URL.createObjectURL = () => { throw new Error(); }; });
        await page.getByRole('button', { name: '导出此事件诊断', exact: true }).click();
        await page.waitForFunction(() => document.activeElement.tagName === 'TEXTAREA');
        assert.ok((await summary.inputValue()).includes(ids[0]));
        record('clipboard-and-file-export-selectable-summary-fallback');

        await page.getByLabel('事件编号', { exact: true }).fill('evt_' + 'f'.repeat(32) + '_999');
        await page.getByRole('button', { name: '查找事件', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.diagnostic-selected h4').textContent === '事件不可用');
        assert.equal(await page.getByRole('button', { name: '导出此事件诊断', exact: true }).isDisabled(), true);
        await page.getByLabel('事件编号', { exact: true }).fill('<svg onload=window.PWNED=true>');
        await page.getByRole('button', { name: '查找事件', exact: true }).click();
        assert.equal(await page.evaluate(() => window.PWNED), undefined);
        record('unknown-and-invalid-reference-remain-usable');

        await page.evaluate(() => { window.AppDiagnosticExport = { snapshot: async () => { throw new Error(); } }; });
        await page.getByRole('button', { name: '刷新诊断历史', exact: true }).click();
        await page.waitForFunction(() => document.getElementById('diagnostic-settings-content').textContent.includes('未能完整加载'));
        await page.getByRole('button', { name: '导出保留的诊断历史', exact: true }).click();
        await page.waitForFunction(() => document.activeElement.tagName === 'TEXTAREA');
        assert.ok((await summary.inputValue()).length > 20);
        record('broken-exporter-and-history-loading-minimal-text-fallback');

        page = await fresh();
        await page.evaluate(() => seed());
        const other = await context.newPage();
        await other.goto(url);
        await other.evaluate(() => AppDiagnosticStore.ready);
        await page.evaluate(() => localStorage.setItem('learning-data-sentinel', 'preserve'));
        await page.getByLabel('在此浏览器保留诊断历史').uncheck();
        await page.waitForFunction(() => document.getElementById('diagnostic-settings-content').textContent.includes('诊断设置已更新'));
        assert.equal(await other.evaluate(() => AppDiagnosticStore.status().enabled), false);
        assert.equal(await page.getByRole('button', { name: '重试诊断存储', exact: true }).isDisabled(), true);
        assert.equal(await page.evaluate(() => localStorage.getItem('learning-data-sentinel')), 'preserve');
        assert.equal((await page.evaluate(() => AppDiagnosticStore.snapshot())).events.length, 0);
        assert.ok((await page.evaluate(() => AppDiagnosticExport.snapshot())).events.length > 0);
        await page.getByLabel('在此浏览器保留诊断历史').check();
        await page.waitForFunction(() => !document.getElementById('diagnostic-persistence').disabled);
        assert.equal((await other.evaluate(() => AppDiagnosticStore.snapshot())).events.length, 0);
        record('coordinated-opt-out-removes-only-history-and-retains-current-page-export');

        await page.getByRole('button', { name: '开启详细诊断（15 分钟）', exact: true }).click();
        await page.getByRole('button', { name: '关闭详细诊断', exact: true }).waitFor();
        assert.equal(await other.evaluate(() => AppDiagnosticStore.status().detailedMode.active), true);
        const expiry = await page.evaluate(() => AppDiagnosticStore.status().detailedMode.expiresAt);
        await page.reload();
        await page.locator('#diagnostic-settings > summary').click();
        assert.equal(await page.evaluate(() => AppDiagnosticStore.status().detailedMode.expiresAt), expiry);
        await page.evaluate(() => { clock += 900001; });
        await page.getByRole('button', { name: '开启详细诊断（15 分钟）', exact: true }).waitFor();
        record('detailed-mode-visible-countdown-reload-window-reconciliation-and-expiry');

        await page.evaluate(() => seed());
        await page.getByRole('button', { name: '仅清理诊断历史', exact: true }).click();
        await page.waitForFunction(() => document.getElementById('diagnostic-settings-content').textContent.includes('保留的诊断历史已清理'));
        assert.equal((await other.evaluate(() => AppDiagnosticStore.snapshot())).events.length, 0);
        assert.equal(await page.evaluate(() => localStorage.getItem('learning-data-sentinel')), 'preserve');
        record('diagnostic-only-clear-preserves-learning-data');

        await page.evaluate(() => seed());
        await other.evaluate(() => new Promise((resolve) => {
            const request = indexedDB.open('IELTSAtlasDiagnosticsV1', 1);
            request.onsuccess = () => { window.blocker = request.result; blocker.onversionchange = () => {}; resolve(); };
        }));
        await page.getByRole('button', { name: '仅清理诊断历史', exact: true }).click();
        await page.waitForFunction(() => document.getElementById('diagnostic-settings-content').textContent.includes('DELETE_BLOCKED'));
        assert.equal(await page.getByRole('button', { name: '仅清理诊断历史', exact: true }).isDisabled(), true);
        assert.equal(await page.getByRole('button', { name: '重试诊断存储', exact: true }).isDisabled(), true);
        assert.equal(await page.getByRole('button', { name: '导出保留的诊断历史', exact: true }).isEnabled(), true);
        await other.evaluate(() => blocker.close());
        await page.waitForFunction(() => !document.querySelector('.diagnostic-settings-controls button').disabled);
        assert.match(await page.locator('#diagnostic-settings-content').innerText(), /保留的诊断历史已清理/);
        record('blocked-deletion-keeps-export-access-and-confirms-only-after-handle-release');

        await page.evaluate(() => { indexedDB.deleteDatabase = () => { throw new DOMException('Denied', 'SecurityError'); }; });
        await page.getByRole('button', { name: '仅清理诊断历史', exact: true }).click();
        await page.waitForFunction(() => document.getElementById('diagnostic-settings-content').textContent.includes('操作未完成；无法确认'));
        assert.equal(await page.getByRole('button', { name: '导出保留的诊断历史', exact: true }).isEnabled(), true);
        record('failed-clearing-keeps-honest-status-and-export-access');

        page = await fresh();
        await page.evaluate(async () => {
            const normalizer = AppDiagnosticContract.createNormalizer();
            const generation = AppDiagnosticStore.status().generation;
            const make = (nonce, sequence, timestamp) => normalizer.sanitizeEvent({
                ...normalizer.normalize({ code: 'PRACTICE_SAVE_FAILED', notification: { kind: 'none' }, persistence: { generation } }),
                windowId: 'win_' + nonce.repeat(32), eventId: 'evt_' + nonce.repeat(32) + '_' + sequence, sequence, timestamp
            });
            const rows = Array.from({ length: 25 }, (_, i) => make('b', i + 1, clock - 100000 + i));
            rows.push(make('a', 1, clock - 10), make('a', 2, clock - 10), make('a', 3, clock - 10),
                make('b', 26, clock - 10), make('c', 2, clock - 10), make('a', 4, clock));
            for (let i = 0; i < rows.length; i += 20) await AppDiagnosticStore.append(rows.slice(i, i + 20));
            window.exportBefore = await AppDiagnosticExport.snapshot();
            window.exportBeforeText = JSON.stringify(exportBefore);
            window.baseExporter = AppDiagnosticExport;
            window.AppDiagnosticExport = { ...baseExporter, snapshot: async () => exportBefore };
        });
        const idFor = (nonce, sequence) => 'evt_' + nonce.repeat(32) + '_' + sequence;
        const expected = [idFor('a', 4), idFor('b', 26), idFor('a', 3), idFor('a', 2), idFor('c', 2), idFor('a', 1),
            ...Array.from({ length: 25 }, (_, i) => idFor('b', 25 - i))];
        await refreshHistory(page);
        assert.deepEqual(await listedIds(page, '.diagnostic-event-list button'), expected.slice(0, 20));
        await page.getByRole('button', { name: '下一页', exact: true }).click();
        assert.deepEqual(await listedIds(page, '.diagnostic-event-list button'), expected.slice(20));
        await page.getByRole('button', { name: '上一页', exact: true }).click();
        assert.deepEqual(await listedIds(page, '.diagnostic-event-list button'), expected.slice(0, 20));
        record('cross-window-settings-history-sorts-recency-and-deterministic-ties-before-pagination');

        await page.evaluate(() => getMessageCenter().showIncidentHistory());
        const historyDialog = page.getByRole('dialog', { name: '诊断历史', exact: true });
        await historyDialog.getByRole('button', { name: '下一页', exact: true }).waitFor();
        assert.deepEqual(await listedIds(page, '.incident-history button'), expected.slice(0, 20));
        await historyDialog.getByRole('button', { name: '下一页', exact: true }).click();
        assert.deepEqual(await listedIds(page, '.incident-history button'), expected.slice(20));
        await historyDialog.getByRole('button', { name: '关闭历史', exact: true }).click();
        assert.equal(await page.evaluate(() => JSON.stringify(exportBefore) === exportBeforeText), true);
        assert.deepEqual(await page.evaluate(() => exportBefore.events.slice(0, 4).map((event) => event.eventId)),
            [idFor('a', 1), idFor('a', 2), idFor('a', 3), idFor('a', 4)]);
        record('notification-history-matches-recency-without-mutating-export-window-sequences');

        page = await fresh();
        const retainedId = (await page.evaluate(() => seed()))[0];
        const originalControl = await page.evaluate(async () => {
            localStorage.setItem('learning-data-sentinel', 'preserve');
            await AppDiagnosticStore.setDetailedMode(true);
            const { enabled, generation, cutoff, phase, detailedMode } = AppDiagnosticStore.status();
            return { enabled, generation, cutoff, phase, expiresAt: detailedMode.expiresAt };
        });
        await page.addInitScript(() => {
            const open = indexedDB.open.bind(indexedDB);
            const remove = indexedDB.deleteDatabase.bind(indexedDB);
            window.rejectDiagnosticOpen = true;
            window.diagnosticOpens = 0;
            window.diagnosticDeletes = 0;
            indexedDB.open = (...args) => {
                if (args[0] === 'IELTSAtlasDiagnosticsV1') {
                    diagnosticOpens++;
                    if (rejectDiagnosticOpen) throw new DOMException('Transient failure', 'InvalidStateError');
                }
                return open(...args);
            };
            indexedDB.deleteDatabase = (...args) => {
                if (args[0] === 'IELTSAtlasDiagnosticsV1') diagnosticDeletes++;
                return remove(...args);
            };
        });
        await page.reload();
        await page.evaluate(() => AppDiagnosticStore.ready);
        await page.locator('#diagnostic-settings > summary').click();
        const failedOpens = await page.evaluate(() => diagnosticOpens);
        assert.ok(failedOpens > 0);
        await refreshHistory(page);
        await page.evaluate(() => AppDiagnosticExport.snapshot());
        assert.equal(await page.evaluate(() => diagnosticOpens), failedOpens);
        assert.equal(await page.locator('.diagnostic-event-list button').count(), 0);
        record('automatic-refresh-and-export-do-not-retry-latched-storage-failures');

        await page.getByRole('button', { name: '重试诊断存储', exact: true }).click();
        await page.waitForFunction(() => document.getElementById('diagnostic-settings-content').textContent.includes('诊断存储仍不可用'));
        assert.ok(await page.evaluate(() => diagnosticOpens > 1));
        assert.equal(await page.getByRole('button', { name: '重试诊断存储', exact: true }).isEnabled(), true);
        assert.equal(await page.getByRole('button', { name: '导出保留的诊断历史', exact: true }).isEnabled(), true);
        await page.evaluate(() => { rejectDiagnosticOpen = false; });
        await page.getByRole('button', { name: '重试诊断存储', exact: true }).focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction((id) => document.querySelector('.diagnostic-event-list')?.textContent.includes(id), retainedId);
        assert.equal(await page.evaluate(async (id) => (await AppDiagnosticStore.getIncident(id)).eventId, retainedId), retainedId);
        assert.deepEqual(await page.evaluate(() => {
            const { enabled, generation, cutoff, phase, detailedMode } = AppDiagnosticStore.status();
            return { failure: AppDiagnosticStore.status().failure, deletes: diagnosticDeletes,
                control: { enabled, generation, cutoff, phase, expiresAt: detailedMode.expiresAt },
                learning: localStorage.getItem('learning-data-sentinel') };
        }),
        { failure: null, deletes: 0, control: originalControl, learning: 'preserve' });
        record('keyboard-storage-retry-recovers-retained-history-after-failure-without-clearing-or-changing-preferences');

        page = await fresh();
        const omittedId = await page.evaluate(async () => {
            const normalizer = AppDiagnosticContract.createNormalizer();
            const persistence = { generation: AppDiagnosticStore.status().generation };
            for (let batch = 0; batch < 14; batch++) {
                const rows = Array.from({ length: 20 }, () => normalizer.normalize({ code: 'PRACTICE_SAVE_FAILED',
                    notification: { kind: 'none' }, persistence,
                    breadcrumbs: Array.from({ length: 50 }, () => ({ action: 'submit', module: 'practice' })) }));
                await AppDiagnosticStore.append(rows);
            }
            const retained = await AppDiagnosticStore.snapshot({ limit: 2000 });
            const history = await AppDiagnosticExport.snapshot();
            const omitted = retained.events.find((event) => !history.events.some((row) => row.eventId === event.eventId));
            if (!history.truncated || !omitted || retained.events.length <= history.events.length) throw new Error('Fixture must exceed the history report byte budget');
            window.baseExporter = AppDiagnosticExport;
            window.referenceReads = 0;
            window.AppDiagnosticExport = { ...baseExporter, async snapshot(query) {
                const result = await baseExporter.snapshot(query);
                if (query?.eventId === omitted.eventId) referenceReads++;
                return result;
            } };
            return omitted.eventId;
        });
        await selectReference(page, omittedId);
        const referenceReads = await page.evaluate(() => referenceReads);
        await refreshHistory(page);
        await page.waitForFunction((count) => referenceReads > count, referenceReads);
        assert.ok((await page.locator('.diagnostic-selected h4').textContent()).includes(omittedId));
        assert.equal(await page.getByRole('button', { name: '复制此事件摘要', exact: true }).isEnabled(), true);
        download = page.waitForEvent('download');
        await page.getByRole('button', { name: '导出此事件诊断', exact: true }).click();
        const retainedReport = JSON.parse(fs.readFileSync(await (await download).path(), 'utf8'));
        assert.equal(retainedReport.selection.eventId, omittedId);
        assert.equal(retainedReport.selection.found, true);
        record('truncated-history-refresh-revalidates-and-keeps-retained-selection-and-export');

        const holdSelectedRead = () => page.evaluate((id) => {
            window.releaseSelectedRead = null;
            window.selectedReadHeld = false;
            window.AppDiagnosticExport = { ...baseExporter, async snapshot(query) {
                const result = await baseExporter.snapshot(query);
                if (query?.eventId !== id || selectedReadHeld) return result;
                selectedReadHeld = true;
                return new Promise((resolve) => { window.releaseSelectedRead = () => resolve(result); });
            } };
        }, omittedId);
        await holdSelectedRead();
        await refreshHistory(page);
        await page.waitForFunction(() => typeof releaseSelectedRead === 'function');
        const newerId = (await listedIds(page, '.diagnostic-event-list button'))[0];
        await selectReference(page, newerId);
        await page.evaluate(() => releaseSelectedRead());
        assert.ok((await page.locator('.diagnostic-selected h4').textContent()).includes(newerId));
        record('delayed-reference-revalidation-cannot-overwrite-a-newer-lookup');

        await selectReference(page, omittedId);
        await holdSelectedRead();
        await refreshHistory(page);
        await page.waitForFunction(() => typeof releaseSelectedRead === 'function');
        await page.evaluate((id) => {
            window.AppDiagnosticExport = { ...baseExporter, async snapshot(query) {
                const report = await baseExporter.snapshot(query);
                return query?.eventId === id ? { ...report, events: report.events.map((event) => event.eventId === id
                    ? { ...event, persistence: { ...event.persistence, operation: 'committed' } } : event) } : report;
            } };
        }, omittedId);
        await refreshHistory(page);
        await page.waitForFunction(() => document.querySelector('.diagnostic-selected').textContent.includes('操作保存状态：已确认保存'));
        await page.evaluate(() => releaseSelectedRead());
        assert.match(await page.locator('.diagnostic-selected').innerText(), /操作保存状态：已确认保存/);
        record('superseded-refresh-cannot-overwrite-newer-selected-event-state');

        await page.evaluate(() => {
            window.AppDiagnosticExport = { ...baseExporter, async snapshot(query) {
                if (query?.eventId) throw new Error('Temporary read failure');
                return { events: [], truncated: true };
            } };
        });
        await refreshHistory(page);
        await page.waitForFunction(() => document.getElementById('diagnostic-settings-content').textContent.includes('保留上次读取的上下文'));
        assert.ok((await page.locator('.diagnostic-selected h4').textContent()).includes(omittedId));
        assert.equal(await page.getByRole('button', { name: '导出此事件诊断', exact: true }).isEnabled(), true);
        await page.evaluate(() => {
            window.AppDiagnosticExport = { ...baseExporter, snapshot: async () => ({ events: [],
                issues: ['incident-not-retained'], sources: { persisted: { state: 'available' } },
                storage: { persistence: 'persisted' }, truncated: false }) };
        });
        await refreshHistory(page);
        await page.waitForFunction(() => document.querySelector('.diagnostic-selected h4').textContent === '事件不可用');
        assert.equal(await page.getByRole('button', { name: '导出此事件诊断', exact: true }).isDisabled(), true);
        record('incomplete-revalidation-keeps-last-context-until-a-complete-read-confirms-absence');

        page = await fresh(() => Object.defineProperty(window, 'indexedDB', { value: undefined }));
        assert.match(await page.locator('#diagnostic-settings').innerText(), /仅内存模式/);
        await page.evaluate(() => seed());
        await page.getByRole('button', { name: '刷新诊断历史', exact: true }).click();
        await page.waitForFunction(() => document.querySelectorAll('.diagnostic-event-list button').length > 0);
        await page.getByRole('button', { name: '开启详细诊断（15 分钟）', exact: true }).click();
        await page.getByRole('button', { name: '关闭详细诊断', exact: true }).waitFor();
        record('unavailable-database-keeps-memory-evidence-and-coordinated-detail');

        page = await fresh(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
        assert.match(await page.locator('#diagnostic-settings').innerText(), /无法确认跨窗口协调/);
        assert.equal(await page.getByRole('button', { name: '开启详细诊断（15 分钟）', exact: true }).isDisabled(), true);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: path.join(reports, `diagnostic-settings-${mode}-mobile.png`), fullPage: true });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        record('unsupported-coordination-is-visible-and-mobile-controls-fit');
    }
    console.log(JSON.stringify({ passed: results.length, results }, null, 2));
} finally {
    fs.writeFileSync(path.join(reports, 'diagnostic-settings-results.json'), JSON.stringify({ results }, null, 2));
    await context?.close();
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
}
