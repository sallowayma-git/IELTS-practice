import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const reports = path.join(root, 'developer/tests/e2e/reports');
fs.mkdirSync(reports, { recursive: true });
const fixture = path.join(reports, 'incident-notifications-fixture.html');
const sources = ['js/diagnostics/diagnosticContract.js', 'js/diagnostics/bootstrapCollector.js',
    'js/diagnostics/diagnosticReporter.js', 'js/diagnostics/diagnosticExport.js',
    'js/presentation/incident-center.js', 'js/presentation/message-center.js'];
const html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>Incident notifications fixture</title><style>' + fs.readFileSync(path.join(root, 'css/main.css'), 'utf8')
        .replace('@import url("./incident-center.css");', () => fs.readFileSync(path.join(root, 'css/incident-center.css'), 'utf8'))
    + '</style><body><label>练习输入<input id="origin"></label><button id="outside">外部按钮</button><div id="already-inert" inert>不可交互</div>'
    + sources.map((source) => '<script>' + fs.readFileSync(path.join(root, source), 'utf8') + '</script>').join('\n')
    + '<script>AppDiagnostics.markReady(); window.center = getMessageCenter().incidents; window.reportFailure = (extra = {}, presentation) => '
    + 'getMessageCenter().reportIncident({code:"PRACTICE_SAVE_FAILED",module:"practice",action:"submit",error:new Error("PRIVATE_ANSWER"),'
    + 'persistence:{operation:"unconfirmed"},...extra},presentation);</script></body></html>';
fs.writeFileSync(fixture, html);
const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const results = [];
let browser;
try {
    browser = await chromium.launch({ headless: true });
    for (const [mode, url] of [['file', pathToFileURL(fixture).href], ['http', origin + '/fixture.html'], ['subpath', origin + '/practice/fixture.html']]) {
        const context = await browser.newContext({ acceptDownloads: true });
        const page = await context.newPage();
        const record = (scenario) => results.push({ mode, scenario, passed: true });
        const fresh = async () => { await page.goto(url); await page.locator('#origin').focus(); };
        try {
            await fresh();
            const critical = await page.evaluate(() => {
                showMessage('<img src=x onerror="window.PWNED=true">', 'warning', 20);
                const id = reportFailure();
                showMessage('系统初始化完成', 'success', 20);
                return id;
            });
            await page.waitForTimeout(550);
            assert.equal(await page.locator('.message').count(), 0, 'legacy timeout remains compatible');
            assert.equal(await page.locator('[role="alertdialog"]').count(), 1);
            assert.ok((await page.locator('.incident-dialog').innerText()).includes(critical));
            assert.match(await page.locator('.incident-dialog').innerText(), /尚未确认保存/);
            assert.equal(await page.evaluate(() => window.PWNED), undefined);
            assert.equal(await page.locator('.incident-dialog button:visible').count(), 3, 'unsupported retry is absent');
            record('legacy-success-and-timeout-cannot-dismiss-critical-incident');

            await page.keyboard.press('Tab');
            assert.equal(await page.evaluate(() => document.activeElement.tagName), 'SUMMARY');
            await page.keyboard.press('Shift+Tab');
            assert.match(await page.evaluate(() => document.activeElement.textContent), /关闭提示/);
            await page.keyboard.press('Tab');
            assert.equal(await page.evaluate(() => document.activeElement.tagName), 'SUMMARY');
            await page.evaluate(() => document.getElementById('outside').focus());
            assert.equal(await page.evaluate(() => document.querySelector('.incident-dialog').contains(document.activeElement)), true);
            const second = await page.evaluate(() => reportFailure({ correlation: { operation: 'second' } }));
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('[aria-modal="true"]').count(), 1);
            assert.ok((await page.locator('.incident-dialog').innerText()).includes(second));
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('[aria-modal="true"]').count(), 0);
            assert.equal(await page.evaluate(() => document.activeElement.id), 'origin');
            assert.equal(await page.evaluate(() => document.getElementById('already-inert').inert), true);
            assert.equal(await page.evaluate(() => AppDiagnostics.getIncident(center.groups.keys().next().value).persistence.operation), 'unconfirmed');
            record('keyboard-trap-queue-escape-restores-original-focus-without-saving');

            await fresh();
            await page.evaluate(() => {
                window.clock = 0; center.now = () => clock;
                window.failure = new Error('<svg onload="window.PWNED=true">PRIVATE_ANSWER');
                window.firstId = reportFailure({ error: failure });
                for (let i = 0; i < 20; i++) reportFailure({ error: failure });
                reportFailure();
            });
            assert.equal(await page.evaluate(() => AppDiagnostics.snapshot().events.length), 2);
            assert.equal(await page.locator('[aria-modal="true"]').count(), 1);
            assert.match(await page.locator('.incident-dialog').innerText(), /同类事件 2 次/);
            await page.locator('.incident-dialog summary').click();
            assert.equal(await page.locator('.incident-dialog img, .incident-dialog svg').count(), 0);
            assert.ok(!(await page.locator('.incident-dialog pre').textContent()).includes('PRIVATE'));
            await page.evaluate(() => { clock = 60000; reportFailure(); });
            assert.equal(await page.evaluate(() => center.queue.length), 1);
            record('identity-aggregation-window-and-malicious-technical-details');

            await fresh();
            const ids = await page.evaluate(() => Array.from({ length: 30 }, (_, i) => reportFailure({ correlation: { operation: 'operation-' + i } })));
            assert.equal(await page.locator('[aria-modal="true"]').count(), 1);
            assert.equal(await page.evaluate(() => center.queue.length), 5);
            assert.equal(await page.evaluate(() => center.groups.size), 20);
            await page.waitForFunction(() => document.querySelectorAll('.incident-notice').length === 5);
            assert.equal(await page.evaluate(async () => (await AppDiagnosticExport.snapshot()).events.length), 30);
            for (let i = 0; i < 6; i++) await page.keyboard.press('Escape');
            await page.getByRole('button', { name: '查看诊断历史', exact: true }).click();
            await page.waitForFunction(() => document.querySelector('.incident-history').children.length === 20);
            assert.ok((await page.locator('.incident-history').innerText()).includes(ids[29]));
            await page.getByRole('button', { name: '下一页', exact: true }).click();
            assert.equal(await page.locator('.incident-history button').count(), 10);
            await page.getByRole('button', { name: '上一页', exact: true }).click();
            await page.locator('.incident-history button').filter({ hasText: ids[29] }).click();
            assert.ok((await page.locator('.incident-dialog').innerText()).includes(ids[29]));
            record('bounded-dialog-and-notice-capacity-preserves-history-and-lookup');

            await fresh();
            await page.evaluate(() => {
                window.retryCalls = 0;
                window.retryId = reportFailure({ correlation: { operation: 'original', submission: 'original-submission' }, retry: { available: true, action: 'submit' } });
                const event = AppDiagnostics.getIncident(retryId);
                showIncident(retryId, { retry: { ...event.retry, run: () => { retryCalls++; return new Promise((resolve) => { window.completeRetry = resolve; }); } } });
            });
            const retry = page.getByRole('button', { name: '安全重试原操作' });
            await retry.click();
            assert.equal(await retry.isDisabled(), true);
            await page.evaluate(() => document.querySelector('.incident-dialog button[disabled]').click());
            assert.equal(await page.evaluate(() => retryCalls), 1);
            await page.evaluate(() => completeRetry({ success: true }));
            await page.waitForFunction(() => !center.dialog.item.busy);
            assert.match(await page.locator('.incident-dialog').innerText(), /尚未确认保存/);
            await retry.click();
            await page.evaluate(() => completeRetry({ verified: true, operation: 'committed' }));
            await page.waitForFunction(() => !center.dialog.item.busy);
            assert.equal(await retry.count(), 0);
            assert.match(await page.locator('.incident-dialog').innerText(), /已确认保存/);
            assert.equal(await page.locator('[aria-modal="true"]').count(), 1, 'verified success does not silently dismiss the incident');
            record('safe-operation-retry-single-flight-and-verified-outcomes');

            for (const enrichedIndex of [0, 1]) {
                for (const settlement of ['fulfilled', 'rejected']) {
                    await fresh();
                    await page.evaluate(() => {
                        window.retryCalls = 0;
                        window.retryCompletions = [];
                        window.failurePair = [new Error('generic failure'), new Error('generic failure')];
                        window.retryInput = { code: 'UNEXPECTED_RUNTIME_ERROR',
                            correlation: { operation: 'original', submission: 'original-submission' },
                            retry: { available: true, action: 'submit' } };
                        window.retryCallback = () => {
                            retryCalls++;
                            return new Promise((resolve, reject) => retryCompletions.push({ resolve, reject }));
                        };
                        window.originalRetryId = reportFailure({ ...retryInput, error: failurePair[0] });
                        showIncident(originalRetryId, { retry: { ...AppDiagnostics.getIncident(originalRetryId).retry, run: retryCallback } });
                    });
                    await retry.click();
                    assert.equal(await retry.isDisabled(), true);
                    const references = await page.evaluate((index) => {
                        const other = reportFailure({ ...retryInput, error: failurePair[1] });
                        const aggregated = center.groups.get(originalRetryId).count;
                        reportFailure({ ...retryInput, code: 'PRACTICE_SAVE_FAILED', error: failurePair[index] });
                        for (const id of [originalRetryId, other]) {
                            showIncident(id, { retry: { ...AppDiagnostics.getIncident(id).retry, run: retryCallback } });
                        }
                        return { aggregated, enriched: [originalRetryId, other][index] };
                    }, enrichedIndex);
                    assert.equal(references.aggregated, 2);
                    await retry.evaluate((control) => control.click());
                    assert.equal(await page.evaluate(() => retryCalls), 1, 'the surviving group cannot replay the same pending operation');
                    assert.equal(await retry.isDisabled(), true);
                    await page.keyboard.press('Escape');
                    assert.equal(JSON.parse(await page.locator('.incident-dialog pre').textContent()).eventId, references.enriched);
                    await retry.evaluate((control) => control.click());
                    assert.equal(await page.evaluate(() => retryCalls), 1, 'the replacement control cannot start a concurrent retry');
                    assert.equal(await retry.isDisabled(), true);
                    assert.match(await page.locator('.incident-dialog [role="status"]').innerText(), /正在检查并重试原操作/);
                    await page.evaluate((result) => {
                        if (result === 'fulfilled') retryCompletions[0].resolve({ verified: true, operation: 'committed' });
                        else retryCompletions[0].reject(new Error('PRIVATE_RETRY'));
                    }, settlement);
                    await page.waitForFunction(() => !center.dialog.retryButton.disabled);
                    assert.match(await page.locator('#incident-dialog-outcome').innerText(), /尚未确认保存/);
                    assert.equal(await page.locator('.incident-dialog [role="status"]').innerText(), '');
                    await retry.click();
                    assert.equal(await page.evaluate(() => retryCalls), 2, 'a new user action is allowed after settlement');
                    await page.evaluate(() => retryCompletions[1].resolve({ verified: true, operation: 'committed' }));
                    await page.waitForFunction(() => center.dialog.retryButton.hidden);
                    assert.match(await page.locator('#incident-dialog-outcome').innerText(), /已确认保存/);
                    assert.equal(await page.evaluate((id) => AppDiagnostics.getIncident(id).persistence.operation, references.enriched), 'unconfirmed');
                    record(`pending-retry-survives-member-${enrichedIndex + 1}-split-and-${settlement}-settlement`);
                }
            }

            await fresh();
            const invalidated = await page.evaluate(() => {
                window.retryCalls = 0;
                const error = new Error('generic failure');
                const correlation = { operation: 'original', submission: 'original-submission' };
                const id = reportFailure({ code: 'UNEXPECTED_RUNTIME_ERROR', error, correlation,
                    retry: { available: true, action: 'submit' } });
                showIncident(id, { retry: { ...AppDiagnostics.getIncident(id).retry, run: () => retryCalls++ } });
                const staleButton = center.dialog.retryButton;
                const initiallyVisible = !staleButton.hidden;
                reportFailure({ error, correlation, retry: { available: false } });
                staleButton.click();
                return { id, initiallyVisible };
            });
            assert.equal(invalidated.initiallyVisible, true);
            assert.equal(await page.getByRole('button', { name: '安全重试原操作' }).count(), 0);
            assert.equal(await page.evaluate(() => retryCalls), 0);
            assert.match(await page.locator('#incident-dialog-title').textContent(), /练习保存异常/);
            const refined = JSON.parse(await page.locator('.incident-dialog pre').textContent());
            assert.equal(refined.eventId, invalidated.id);
            assert.equal(refined.code, 'PRACTICE_SAVE_FAILED');
            assert.equal(refined.retry.available, false);
            record('enrichment-refreshes-open-details-and-revokes-stale-retry-controls');

            for (const enrichedIndex of [0, 1]) {
                await fresh();
                const references = await page.evaluate((index) => {
                    const errors = [new Error('generic failure'), new Error('generic failure')];
                    const ids = errors.map((error) => reportFailure({ code: 'UNEXPECTED_RUNTIME_ERROR', action: 'unknown', error }));
                    reportFailure({ error: errors[index], correlation: { operation: 'known-operation' } });
                    return { enriched: ids[index], other: ids[1 - index] };
                }, enrichedIndex);
                assert.equal(await page.locator('[role="alertdialog"]').count(), 1);
                assert.match(await page.locator('.incident-dialog').innerText(), /尚未确认保存。请保留此页面/);
                const event = JSON.parse(await page.locator('.incident-dialog pre').textContent());
                assert.equal(event.eventId, references.enriched);
                assert.equal(event.code, 'PRACTICE_SAVE_FAILED');
                assert.equal(event.action, 'submit');
                await page.waitForFunction(() => document.querySelectorAll('.incident-notice').length === 2);
                const generic = page.locator('.incident-notice').filter({ hasText: references.other });
                assert.match(await generic.innerText(), /操作遇到异常/);
                assert.doesNotMatch(await generic.innerText(), /同类事件/);
                record(`enriched-aggregate-member-${enrichedIndex + 1}-gets-its-own-reference-and-save-warning`);
            }

            await fresh();
            const escalated = await page.evaluate(() => {
                window.transientFailure = new Error('generic failure');
                return AppDiagnostics.report({ error: transientFailure, notification: { kind: 'transient' } });
            });
            assert.equal(await page.locator('.incident-notice, .incident-dialog').count(), 0);
            await page.evaluate(() => reportFailure({ error: transientFailure }));
            assert.equal(await page.locator('[role="alertdialog"]').count(), 1);
            await page.waitForFunction(() => document.querySelectorAll('.incident-notice').length === 1);
            assert.ok((await page.locator('.incident-dialog').innerText()).includes(escalated));
            assert.match(await page.locator('.incident-dialog').innerText(), /尚未确认保存。请保留此页面/);
            await page.keyboard.press('Escape');
            await page.evaluate(() => reportFailure({ error: transientFailure }));
            assert.equal(await page.locator('.incident-notice, .incident-dialog').count(), 0);
            record('transient-escalation-requires-explicit-dismissal-and-preserves-that-acknowledgement');

            await fresh();
            await page.evaluate(() => reportFailure({ action: 'save-recovery', code: 'RECOVERY_SAVE_FAILED', persistence: { operation: 'not-committed' } }));
            assert.equal(await page.locator('[aria-modal="true"]').count(), 0);
            assert.match(await page.locator('.incident-notifications').innerText(), /本次恢复快照已确认未保存/);
            await page.getByRole('button', { name: '查看详情', exact: true }).click();
            const downloadPromise = page.waitForEvent('download');
            await page.getByRole('button', { name: '导出诊断', exact: true }).click();
            const downloaded = await downloadPromise;
            const chunks = [];
            for await (const chunk of await downloaded.createReadStream()) chunks.push(chunk);
            const report = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            assert.equal(report.events[0].persistence.operation, 'not-committed');
            assert.ok(!JSON.stringify(report).includes('PRIVATE'));
            record('not-committed-persistent-details-and-real-passive-download');

            await page.evaluate(() => {
                Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } });
                window.Blob = class { constructor() { throw new Error('blocked'); } };
            });
            await page.getByRole('button', { name: '复制摘要', exact: true }).click();
            await page.waitForFunction(() => document.querySelector('.incident-dialog textarea').value.includes('evt_'));
            assert.equal(await page.evaluate(() => { const text = document.querySelector('.incident-dialog textarea'); return text === document.activeElement && text.selectionEnd === text.value.length; }), true);
            await page.getByRole('button', { name: '导出诊断', exact: true }).click();
            assert.ok((await page.locator('.incident-dialog textarea').inputValue()).includes('evt_'));
            record('clipboard-and-download-fallback-remain-inside-focus-boundary');

            await fresh();
            const fallbackId = await page.evaluate(() => {
                center.render = () => { throw new Error('broken notification UI'); };
                window.AppDiagnosticExport = { download: () => { throw new Error('broken exporter'); } };
                return reportFailure();
            });
            assert.ok((await page.locator('#incident-minimal-fallback').innerText()).includes(fallbackId));
            assert.match(await page.locator('#incident-minimal-fallback').innerText(), /尚未确认保存/);
            await page.getByRole('button', { name: '导出诊断或显示文本', exact: true }).click();
            assert.ok((await page.locator('#incident-minimal-fallback textarea').inputValue()).includes(fallbackId));
            assert.equal(await page.evaluate(() => AppDiagnostics.snapshot().events.length), 1, 'UI failure does not recursively report');
            record('broken-rich-ui-and-exporter-retain-actionable-text-and-export');

            await fresh();
            await page.evaluate(() => {
                const create = document.createElement.bind(document);
                document.createElement = (tag, ...args) => { if (tag === 'details') throw new Error('broken details'); return create(tag, ...args); };
                reportFailure();
            });
            assert.equal(await page.locator('.incident-backdrop').count(), 0);
            assert.equal(await page.locator('#incident-minimal-fallback button').count(), 3);
            assert.equal(await page.evaluate(() => document.getElementById('origin').inert), false);
            record('partial-dialog-construction-restores-page-and-minimal-actions');

            await fresh();
            await page.evaluate(() => {
                window.pendingSave = reportFailure();
                AppDiagnostics.startupFailed(new Error('PRIVATE_STARTUP'));
            });
            assert.equal(await page.locator('.incident-dialog').count(), 0);
            assert.equal(await page.evaluate(() => document.getElementById('diagnostic-startup-failure').inert), false);
            await page.locator('#diagnostic-startup-failure button').focus();
            assert.equal(await page.evaluate(() => document.activeElement.closest('#diagnostic-startup-failure') !== null), true);
            await page.evaluate(() => AppDiagnostics.markReady());
            await page.locator('.incident-dialog').waitFor();
            assert.ok((await page.locator('.incident-dialog').innerText()).includes(await page.evaluate(() => pendingSave)));
            await page.keyboard.press('Escape');
            assert.equal(await page.evaluate(() => AppDiagnostics.getIncident(pendingSave).persistence.operation), 'unconfirmed');
            record('startup-export-has-priority-and-recovery-resumes-unresolved-dialog');

            await fresh();
            await page.evaluate(() => reportFailure({ persistence: { operation: 'not-committed' } }));
            await page.locator('#incident-notifications').waitFor();
            await page.evaluate(() => {
                document.getElementById('incident-notifications').remove();
                reportFailure({ correlation: { operation: 'next' }, persistence: { operation: 'not-committed' } });
            });
            await page.waitForFunction(() => document.querySelectorAll('.incident-notice').length === 2);
            assert.equal(await page.locator('.incident-notice').count(), 2);
            assert.equal(await page.getByRole('button', { name: '查看诊断历史', exact: true }).count(), 1);
            record('replaced-notification-container-restores-details-and-history');

            await fresh();
            const storm = await page.evaluate(() => {
                window.noticeRenders = 0;
                const render = center.render.bind(center);
                center.render = () => { noticeRenders++; return render(); };
                window.sameNoticeError = new Error('PRIVATE_NOTICE');
                window.stableNoticeId = reportFailure({ error: sameNoticeError, persistence: { operation: 'not-committed' } });
                for (let i = 0; i < 60; i++) center.show(stableNoticeId);
                return { renders: noticeRenders, events: AppDiagnostics.snapshot().events.length,
                    groups: center.groups.size, incident: AppDiagnostics.getIncident(stableNoticeId).eventId };
            });
            assert.equal(storm.renders, 0, 'persistent notice DOM waits until the next frame');
            assert.equal(storm.events, 1);
            assert.equal(storm.groups, 1);
            await page.locator('.incident-notice').waitFor();
            assert.equal(await page.evaluate(() => noticeRenders), 1);
            await page.locator('.incident-notice button').focus();
            await page.evaluate(() => {
                window.savedNoticeButton = document.activeElement;
                window.noticeMutations = 0;
                const cards = center.cards;
                window.noticeObserver = new MutationObserver(records => { noticeMutations += records.length; });
                noticeObserver.observe(cards, { childList: true, subtree: true, characterData: true });
                for (let i = 0; i < 60; i++) center.show(stableNoticeId);
            });
            await page.waitForFunction(() => noticeRenders === 2);
            const reused = await page.evaluate(() => ({
                same: document.querySelector('.incident-notice button') === savedNoticeButton,
                focus: document.activeElement === savedNoticeButton,
                mutations: noticeMutations,
                announcementCount: document.querySelectorAll('.incident-announcement[aria-live="polite"]').length
            }));
            assert.deepEqual(reused, { same: true, focus: true, mutations: 0, announcementCount: 1 });
            await page.keyboard.press('Enter');
            await page.locator('.incident-dialog').waitFor();
            assert.ok((await page.locator('.incident-dialog').innerText()).includes(storm.incident));
            await page.keyboard.press('Escape');
            assert.equal(await page.evaluate(() => document.activeElement === center.historyButton), true,
                'dismissed card is removed and keyboard focus returns to diagnostic history');
            record('notice-bursts-batch-dom-and-reuse-focused-accessible-controls');

            await fresh();
            await page.evaluate(() => {
                const create = document.createElement.bind(document);
                document.createElement = (tag, ...args) => { if (tag === 'section') throw new Error('broken sections'); return create(tag, ...args); };
                for (let i = 0; i < 40; i++) reportFailure({ correlation: { operation: 'storm-' + i } });
            });
            assert.equal(await page.locator('#incident-minimal-text').count(), 1);
            assert.match(await page.locator('#incident-minimal-text').textContent(), /尚未确认保存/);
            assert.equal(await page.evaluate(() => AppDiagnostics.snapshot().events.length), 40);
            record('text-only-fallback-remains-bounded-during-render-failure-storm');

            await fresh();
            await page.setViewportSize({ width: 320, height: 568 });
            await page.evaluate(() => reportFailure({ action: 'save-draft' }));
            await page.locator('.incident-dialog summary').click();
            const geometry = await page.evaluate(() => {
                const panel = document.querySelector('.incident-dialog');
                const bounds = panel.getBoundingClientRect();
                return { width: innerWidth, left: bounds.left, right: bounds.right, overflow: panel.scrollWidth > panel.clientWidth, height: bounds.height, viewport: innerHeight };
            });
            assert.ok(geometry.left >= 0 && geometry.right <= geometry.width && !geometry.overflow && geometry.height <= geometry.viewport);
            await page.screenshot({ path: path.join(reports, `incident-${mode}-mobile.png`) });
            await page.setViewportSize({ width: 1280, height: 900 });
            await page.screenshot({ path: path.join(reports, `incident-${mode}-desktop.png`) });
            await page.keyboard.press('Escape');
            assert.equal(page.url(), url);
            assert.equal(context.pages().length, 1);
            record('responsive-details-actions-and-no-window-or-navigation-side-effects');
        } finally { await context.close(); }
    }
    console.log(JSON.stringify({ passed: results.length, results }, null, 2));
} finally {
    fs.writeFileSync(path.join(reports, 'incident-notifications-report.json'), JSON.stringify(results, null, 2));
    await browser?.close();
    server.close();
}
