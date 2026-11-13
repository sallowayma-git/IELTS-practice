import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const baseline = process.env.READING_FREEZE_EXPECT_BASELINE === '1';
const report = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    buildId: JSON.parse(fs.readFileSync(path.join(root, 'assets/generated/diagnostics/build-manifest.json'), 'utf8')).buildId,
    baseline, mode: 'file', storage: 'real IndexedDB', cases: [] };
const browser = await chromium.launch({ headless: true, args: ['--allow-file-access-from-files'],
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
report.browser = browser.version();
const hooks = 'window.__IELTS_UNIFIED_READING_PAGE_TEST__';
async function ready(page) {
    await page.waitForFunction(() => window.__IELTS_UNIFIED_READING_PAGE_TEST__?.getTestState().sessionReadySent
        && !window.__IELTS_UNIFIED_READING_PAGE_TEST__.getTestState().suiteActivating
        && window.__IELTS_UNIFIED_READING_PAGE_TEST__.collectCurrentDraft()?.readingTiming);
}
async function registrationCancellation(scenario) {
    const context = await browser.newContext({ viewport: { width: 1365, height: 1000 } });
    await context.addInitScript(() => { window.__IELTS_READING_PAGE_TEST_HOOKS__ = true; });
    try {
        const host = await context.newPage();
        await host.goto(pathToFileURL(path.join(root, 'developer/tests/e2e/fixtures/index.html')).href);
        await host.setContent('<iframe name="practice" style="width: 1300px; height: 950px"></iframe>');
        await host.evaluate(url => {
            const frame = document.querySelector('iframe');
            window.__registration = { examId: 'p3-high-15', sessionId: 'original-attempt',
                windowSessionToken: 'original-token', windowSessionGeneration: 1,
                libraryConfigurationId: null, practiceMode: 'single', parentOrigin: 'null' };
            window.__completions = [];
            window.__send = (type, data = {}) => frame.contentWindow.postMessage({ type, source: 'exam_host',
                data: { ...window.__registration, ...data, messageIssuedAtMs: Date.now() } }, '*');
            window.addEventListener('message', event => {
                if (event.source !== frame.contentWindow) return;
                if (event.data?.type === 'REQUEST_INIT') window.__send('INIT_SESSION');
                if (event.data?.type === 'PRACTICE_COMPLETE') window.__completions.push(event.data.data);
            });
            frame.src = url;
        }, `${pathToFileURL(path.join(root, 'assets/generated/reading-exams/reading-practice-unified.html'))}?examId=p3-high-15&dataKey=p3-high-15&test_env=1`);
        const page = host.frame({ name: 'practice' });
        await ready(page);
        const input = page.locator('#question-groups input[type="text"]').first();
        await input.fill('retained before registration');
        const acceptedAnswers = await page.evaluate(`${hooks}.collectCurrentDraft().answers`);
        await page.evaluate(() => {
            const original = ReadingTimingController.prototype.save;
            window.__registrationGate = { armed: true, held: false, release: null };
            ReadingTimingController.prototype.save = async function (...args) {
                const entry = args[0] || this.active;
                const hold = window.__registrationGate.armed && entry?.meter.value.frozen;
                if (hold) window.__registrationGate.armed = false;
                const result = await original.apply(this, args);
                if (hold) await new Promise(resolve => {
                    window.__registrationGate.release = resolve;
                    window.__registrationGate.held = true;
                });
                return result;
            };
            window.__canceledSubmit = window.__IELTS_UNIFIED_READING_PAGE_TEST__.handleSubmit();
        });
        await page.waitForFunction(() => window.__registrationGate.held);
        assert.equal(await input.isDisabled(), true);
        assert.equal(await page.locator('#question-groups').evaluate(root => root.inert), true);
        const sessionId = scenario === 'same-attempt-registration' ? 'original-attempt' : 'replacement-attempt';
        await host.evaluate(sessionId => {
            Object.assign(window.__registration, { sessionId, windowSessionToken: 'new-registration-token',
                windowSessionGeneration: 2 });
            window.__send('INIT_SESSION');
        }, sessionId);
        await page.waitForFunction(() => window.__IELTS_UNIFIED_READING_PAGE_TEST__.getTestState().windowSessionToken === 'new-registration-token');
        await page.evaluate(async () => {
            window.__registrationGate.release();
            await window.__canceledSubmit;
        });
        const state = await page.evaluate(`${hooks}.getTestState()`);
        assert.equal(state.sessionId, sessionId);
        assert.equal(state.submissionPhase, 'draft');
        assert.equal(state.submissionEditingLocked, false);
        assert.equal(await input.isDisabled(), false, `${scenario}: canceled preparation restores input editability`);
        assert.equal(await page.locator('#question-groups').evaluate(root => root.inert), false);
        assert.equal(await page.locator('#submit-btn').isDisabled(), false);
        assert.deepEqual(await page.evaluate(`${hooks}.collectCurrentDraft().answers`), acceptedAnswers);
        assert.equal(await host.evaluate(() => window.__completions.length), 0);
        await page.waitForFunction(sessionId => {
            const timing = window.__IELTS_UNIFIED_READING_PAGE_TEST__.getReadingTimingState();
            return timing.context.editable && timing.active?.includes(sessionId);
        }, sessionId);
        await input.fill('edited after registration');
        const editedAnswers = await page.evaluate(`${hooks}.collectCurrentDraft().answers`);
        assert.notDeepEqual(editedAnswers, acceptedAnswers);
        assert.equal(await page.evaluate(`${hooks}.collectCurrentDraft().readingTiming.frozen`), false);
        await page.locator('#submit-btn').click();
        await host.waitForFunction(() => window.__completions.length === 1);
        const completion = await host.evaluate(() => window.__completions[0]);
        assert.equal(completion.sessionId, sessionId);
        assert.equal(completion.windowSessionToken, 'new-registration-token');
        assert.deepEqual(completion.answers, editedAnswers);
        assert.ok(completion.readingTiming.attemptId.includes(sessionId));
        assert.equal(completion.readingTiming.frozen, true);
        const persisted = await page.evaluate(async attemptId => AppData.recovery.getReadingTiming(attemptId), completion.readingTiming.attemptId);
        assert.deepEqual(completion.readingTiming, persisted.snapshot);
        // This fixture exercises the real host message protocol and timing store;
        // the suite cases below cover the host's completed-record transaction.
        await host.evaluate(completion => window.__send('PRACTICE_SUBMIT_ACK', {
            examId: completion.examId, sessionId: completion.sessionId, submissionId: completion.submissionId
        }), completion);
        await page.waitForFunction(() => window.__IELTS_UNIFIED_READING_PAGE_TEST__.getTestState().submitted);
        assert.equal(await host.evaluate(() => window.__completions.length), 1);
        report.cases.push({ scenario, outcome: 'passed', completionMessages: 1, frozenPersistedSnapshots: 1 });
        console.log(`${scenario}: passed`);
    } finally { await context.close(); }
}
try {
    if (!baseline) {
        for (const scenario of ['same-attempt-registration', 'replacement-attempt-registration']) {
            await registrationCancellation(scenario);
        }
    }
    for (const scenario of baseline ? ['control', 'question-click']
        : ['control', 'question-click', 'interactions', 'restored-inactive', 'pre-handoff-failure', 'unknown-ack']) {
        const context = await browser.newContext({ viewport: { width: 1365, height: 1000 } });
        await context.addInitScript(() => {
            window.__IELTS_READING_PAGE_TEST_HOOKS__ = true;
            // Retain disposable popups after completion so assertions cannot race
            // the host/page's normal post-ACK window closure. Context cleanup owns them.
            window.close = () => {};
            window.__heldAcknowledgements = [];
            window.__holdAcknowledgements = false;
            window.addEventListener('message', event => {
                if (window.__holdAcknowledgements && event.data?.type === 'PRACTICE_SUBMIT_ACK') {
                    window.__heldAcknowledgements.push(event.data);
                    event.stopImmediatePropagation();
                }
            }, true);
        });
        try {
            const host = await context.newPage();
            await host.goto(`${pathToFileURL(path.join(root, 'index.html'))}?test_env=1`);
            await host.waitForFunction(() => window.app?.isInitialized === true, null, { timeout: 60000 });
            await host.evaluate(async () => {
                await AppData.ready;
                await LicenseModal.accept();
                await window.ensureBrowseGroup();
                await window.AppEntry.ensureSessionSuiteReady();
            });
            const [page] = await Promise.all([host.waitForEvent('popup'), host.evaluate(async () => {
                window.app._shouldUsePlaceholderPage = () => false;
                await window.app._ensureSuiteRecoveryReady();
                const index = await window.app._fetchSuiteExamIndex();
                const sequence = ['P1', 'P2', 'P3'].map(category => {
                    // Keep a real text answer on the submitting passage. An
                    // arbitrary P3 can contain only choice/drag controls.
                    const exam = index.find(item => category === 'P3' ? item.id === 'p3-high-15'
                        : item.category === category && item.type !== 'listening');
                    if (!exam) throw new Error('Required production submission fixture is missing');
                    return { examId: exam.id, exam };
                });
                await window.app._launchSuiteSessionFromSequence(sequence, { flowMode: 'simulation', frequencyScope: 'all' });
            })]);
            page.on('dialog', dialog => dialog.accept());
            await ready(page);
            for (const index of [1, 2, 0, 2]) {
                await page.locator(`#part-section-${index + 1} .part-nav-name`).click();
                await page.waitForFunction(index => {
                    const h = window.__IELTS_UNIFIED_READING_PAGE_TEST__;
                    const s = h.getTestState();
                    return s.currentIndex === index && !s.suiteActivating
                        && h.collectCurrentDraft().readingTiming?.examId === s.examId;
                }, index);
            }
            if (scenario === 'restored-inactive') {
                await page.evaluate(() => window.__IELTS_UNIFIED_READING_PAGE_TEST__.syncSimulationDraftSnapshot('test-reload'));
                await page.reload();
                await ready(page);
                const acquired = await page.evaluate(`${hooks}.getReadingTimingState().entries.length`);
                assert.equal(acquired, 1, 'only the active passage is acquired after reload');
            }
            const input = page.locator('#question-groups input[type="text"]').first();
            assert.equal(await input.count(), 1, 'the production fixture must exercise a real text answer');
            if (await input.count()) await input.fill('synthetic answer');
            if (scenario === 'unknown-ack') await page.evaluate(() => {
                window.__holdAcknowledgements = true;
            });
            await page.evaluate(failBeforeHandoff => {
                const original = ReadingTimingController.prototype.save;
                let failNext = failBeforeHandoff;
                window.__freezeGate = { armed: !failBeforeHandoff, held: false, release: null };
                ReadingTimingController.prototype.save = async function (...args) {
                    const entry = args[0] || this.active;
                    if (failNext && entry?.meter.value.frozen) {
                        failNext = false;
                        throw Object.assign(new Error('Synthetic pre-handoff failure'), { code: 'QUOTA_EXCEEDED' });
                    }
                    const hold = window.__freezeGate.armed && entry?.meter.value.frozen;
                    if (hold) window.__freezeGate.armed = false;
                    const result = await original.apply(this, args);
                    if (hold) await new Promise(resolve => {
                        window.__freezeGate.release = resolve;
                        window.__freezeGate.held = true;
                    });
                    return result;
                };
            }, scenario === 'pre-handoff-failure');
            let acceptedAnswers = await page.evaluate(`${hooks}.collectCurrentDraft().answers`);
            await page.locator('#submit-btn').click();
            if (scenario === 'pre-handoff-failure') {
                await page.waitForFunction(() => window.__IELTS_UNIFIED_READING_PAGE_TEST__.getTestState().submissionPhase === 'failed');
                assert.deepEqual(await page.evaluate(`${hooks}.collectCurrentDraft().answers`), acceptedAnswers);
                assert.equal(await page.evaluate(`${hooks}.getTestState().submissionId`), '');
                assert.equal(await page.evaluate(`${hooks}.getTestState().submissionEditingLocked`), false);
                assert.equal(await host.evaluate(async () => (await AppData.practice.list()).length), 0);
                if (await input.count()) await input.fill('edited after definite failure');
                acceptedAnswers = await page.evaluate(`${hooks}.collectCurrentDraft().answers`);
                await page.evaluate(() => { window.__freezeGate.armed = true; });
                await page.locator('#submit-btn').click();
            }
            await page.waitForFunction(() => window.__freezeGate.held);
            if (scenario === 'question-click') await page.locator('#part-section-3 .q-item').first().click();
            if (scenario === 'interactions') {
                const acceptedTiming = await page.evaluate(`${hooks}.collectCurrentDraft().readingTiming`);
                const timer = await page.evaluate(() => window.__IELTS_PRACTICE_TIMER__.getSnapshot().running);
                assert.equal(await page.evaluate(`${hooks}.getReadingTimingState().context.editable`), false);
                assert.equal(await page.locator('#submit-btn').isDisabled(), true);
                await page.locator('#part-section-3 .q-item').first().click();
                await page.locator('#part-section-1').focus();
                await page.keyboard.press('Enter');
                await page.locator('#float-prev-btn').click();
                await page.locator('#timer').click();
                if (await input.count()) {
                    assert.equal(await input.isDisabled(), true);
                    await input.click({ force: true });
                    await page.keyboard.type('blocked');
                    await input.dispatchEvent('input');
                    await input.dispatchEvent('change');
                }
                await page.locator('#question-groups').dispatchEvent('drop');
                await page.evaluate(async () => {
                    const h = window.__IELTS_UNIFIED_READING_PAGE_TEST__;
                    const s = h.getTestState();
                    h.syncSimulationDraftSnapshot('late-checkpoint');
                    await h.handleSubmit();
                    await h.handleIncoming({ source: window.opener, origin: 'null', data: {
                        type: 'SIMULATION_CONTEXT', source: 'exam_host', data: {
                            sessionId: s.sessionId, suiteSessionId: s.suiteSessionId, examId: s.examId,
                            windowSessionToken: s.windowSessionToken,
                            draft: { answers: { q1: 'late checkpoint' }, updatedAt: Date.now() + 10000 }
                        }
                    } });
                });
                assert.equal(await page.evaluate(`${hooks}.getTestState().currentIndex`), 2);
                assert.equal(await page.evaluate(() => window.__IELTS_PRACTICE_TIMER__.getSnapshot().running), timer);
                assert.deepEqual(await page.evaluate(`${hooks}.collectCurrentDraft().answers`), acceptedAnswers);
                assert.deepEqual(await page.evaluate(`${hooks}.collectCurrentDraft().readingTiming`), acceptedTiming);
            }
            await page.evaluate(() => window.__freezeGate.release());
            if (scenario === 'unknown-ack') {
                await page.waitForFunction(() => window.__heldAcknowledgements.length > 0);
                const submissionId = await page.evaluate(`${hooks}.getTestState().submissionId`);
                await page.evaluate(`${hooks}.expirePendingSubmission()`);
                assert.equal(await page.evaluate(`${hooks}.getTestState().submissionEditingLocked`), true);
                assert.equal(await host.evaluate(async () => (await AppData.practice.list()).length), 1);
                if (await input.count()) assert.equal(await input.isDisabled(), true);
                const dismiss = page.getByRole('button', { name: '关闭提示（不代表已保存）', exact: true });
                if (await dismiss.count()) await dismiss.click();
                await page.evaluate(() => { window.__holdAcknowledgements = false; });
                await page.locator('#submit-btn').click();
                assert.equal(await page.evaluate(`${hooks}.getTestState().submissionId`), submissionId);
            }
            await page.waitForFunction(() => {
                const s = window.__IELTS_UNIFIED_READING_PAGE_TEST__.getTestState();
                return s.submitted || (s.submissionId && s.submissionStatus === 'draft');
            });
            const result = await host.evaluate(async () => {
                const records = await AppData.practice.list();
                const full = await Promise.all(records.map(row => AppData.practice.get(row.id)));
                const suite = full.find(row => row.suiteMode || row.metadata?.suiteMode);
                const timings = suite ? await Promise.all(suite.suiteEntries.map(entry =>
                    AppData.recovery.getReadingTiming(entry.readingTiming.attemptId))) : [];
                return { count: full.length, suite, timings };
            });
            if (baseline && scenario === 'question-click') {
                assert.equal(result.count, 0, 'the pre-fix race must fail to commit');
                report.cases.push({ scenario, outcome: 'expected pre-fix failure', completedRecords: 0 });
            } else {
                assert.equal(result.count, 1, `${scenario}: exactly one completed record`);
                assert.equal(result.suite.suiteEntries.length, 3);
                for (const [index, entry] of result.suite.suiteEntries.entries()) {
                    assert.equal(entry.readingTiming.frozen, true);
                    assert.equal(entry.readingTiming.examId, entry.examId);
                    assert.equal(entry.readingTiming.sequenceIndex, index);
                    assert.deepEqual(entry.readingTiming, result.timings[index].snapshot);
                }
                assert.deepEqual(result.suite.suiteEntries[2].answers, acceptedAnswers);
                report.cases.push({ scenario, outcome: 'passed', completedRecords: 1, frozenPersistedSnapshots: 3 });
            }
            console.log(`${scenario}: ${report.cases.at(-1).outcome}`);
        } finally { await context.close(); }
    }
    report.status = 'passed';
} catch (error) {
    report.status = 'failed';
    throw error;
} finally {
    await browser.close();
    const directory = path.join(root, 'developer/tests/e2e/reports');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `reading-submission-freeze-${baseline ? 'baseline' : 'candidate'}.json`), JSON.stringify(report, null, 2));
}
