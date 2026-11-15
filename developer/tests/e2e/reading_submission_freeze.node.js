import assert from 'node:assert/strict';
import { environment, saveReport, restoreInstrumentation } from './helpers/readingQualification.mjs';
import { configureSyncContext, prepareSync } from './helpers/readingQualificationSync.mjs';

const baseline = process.env.READING_FREEZE_EXPECT_BASELINE === '1';
const selectedScenarios = process.env.READING_FREEZE_SCENARIOS ? process.env.READING_FREEZE_SCENARIOS.split(',') : undefined;
const env = await environment();
const { browser } = env;
const report = { ...env.provenance, baseline, cases: [] };
const hooks = 'window.__IELTS_UNIFIED_READING_PAGE_TEST__';
async function ready(page) {
    await page.waitForFunction(() => window.__IELTS_UNIFIED_READING_PAGE_TEST__?.getTestState().sessionReadySent
        && !window.__IELTS_UNIFIED_READING_PAGE_TEST__.getTestState().suiteActivating
        && window.__IELTS_UNIFIED_READING_PAGE_TEST__.collectCurrentDraft()?.readingTiming);
}
async function dropAnswer(page) {
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    const source = page.locator('#question-groups .drag-item:not(.option-consumed)').first();
    const target = page.locator('#question-groups .paragraph-dropzone, #question-groups .match-dropzone').first();
    try {
        // Drive the supported DOM drag handlers with the browser's DataTransfer;
        // dragstart itself constructs the payload. This is not an OS drag test.
        await source.dispatchEvent('dragstart', { dataTransfer: transfer });
        await target.dispatchEvent('dragover', { dataTransfer: transfer });
        await target.dispatchEvent('drop', { dataTransfer: transfer });
        await source.dispatchEvent('dragend', { dataTransfer: transfer });
    } finally { await transfer.dispose(); }
}
async function registrationCancellation(scenario) {
    const context = await browser.newContext({ viewport: { width: 1365, height: 1000 } });
    await context.addInitScript(() => { window.__IELTS_READING_PAGE_TEST_HOOKS__ = true; });
    try {
        const host = await context.newPage();
        await host.goto(env.url('developer/tests/e2e/fixtures/index.html'));
        await host.setContent('<iframe name="practice" style="width: 1300px; height: 950px"></iframe>');
        await host.evaluate(url => {
            const frame = document.querySelector('iframe');
            window.__registration = { examId: 'p3-high-15', sessionId: 'original-attempt',
                windowSessionToken: 'original-token', windowSessionGeneration: 1,
                libraryConfigurationId: null, practiceMode: 'single', parentOrigin: location.origin };
            window.__completions = [];
            window.__send = (type, data = {}) => frame.contentWindow.postMessage({ type, source: 'exam_host',
                data: { ...window.__registration, ...data, messageIssuedAtMs: Date.now() } }, '*');
            window.addEventListener('message', event => {
                if (event.source !== frame.contentWindow) return;
                if (event.data?.type === 'REQUEST_INIT') window.__send('INIT_SESSION');
                if (event.data?.type === 'PRACTICE_COMPLETE') window.__completions.push(event.data.data);
            });
            frame.src = url;
        }, `${env.url('assets/generated/reading-exams/reading-practice-unified.html')}?examId=p3-high-15&dataKey=p3-high-15&test_env=1`);
        const page = host.frame({ name: 'practice' });
        await ready(page);
        const input = page.locator('#question-groups input[type="text"]').first();
        await input.fill('retained before registration');
        const acceptedAnswers = await page.evaluate(`${hooks}.collectCurrentDraft().answers`);
        await page.evaluate(() => {
            const original = ReadingTimingController.prototype.save;
            window.__registrationGate = { armed: true, held: false, release: null,
                restore: () => { ReadingTimingController.prototype.save = original; } };
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
    } finally { await restoreInstrumentation(context); await context.close(); }
}
try {
    if (!baseline && !selectedScenarios) {
        for (const scenario of ['same-attempt-registration', 'replacement-attempt-registration']) {
            await registrationCancellation(scenario);
        }
    }
    scenarioLoop: for (const scenario of selectedScenarios || (baseline ? ['ordinary', 'control', 'question-click']
        : ['ordinary', 'control', 'question-click', 'interactions', 'selection-drop', 'delayed-activation', 'delayed-checkpoint', 'restored-inactive', 'pre-handoff-failure', 'unknown-ack',
            'legacy-host-reload', 'legacy-page-reload', 'legacy-page-ack-loss'])) {
        const context = await browser.newContext({ viewport: { width: 1365, height: 1000 } });
        await configureSyncContext(context);
        await context.addInitScript(() => {
            window.__IELTS_READING_PAGE_TEST_HOOKS__ = true;
            // Retain disposable popups after completion so assertions cannot race
            // the host/page's normal post-ACK window closure. Context cleanup owns them.
            window.close = () => {};
            window.__heldAcknowledgements = [];
            window.__holdAcknowledgements = false;
            window.addEventListener('message', event => {
                if (window.__holdAcknowledgements && ['PRACTICE_SUBMIT_ACK', 'SUITE_RECOVERY_OUTCOME'].includes(event.data?.type)) {
                    window.__heldAcknowledgements.push(event.data);
                    event.stopImmediatePropagation();
                }
            }, true);
        });
        let sync, queuedDrop;
        try {
            let recoveryStartedAt;
            const host = await context.newPage();
            await host.goto(`${env.url('index.html')}?test_env=1`);
            await host.waitForFunction(() => window.app?.isInitialized === true, null, { timeout: 60000 });
            await host.evaluate(async () => {
                await AppData.ready;
                await LicenseModal.accept();
                await window.ensureBrowseGroup();
                await window.AppEntry.ensureSessionSuiteReady();
            });
            sync = await prepareSync(host, env);
            const [page] = await Promise.all([host.waitForEvent('popup'), host.evaluate(async scenario => {
                window.app._shouldUsePlaceholderPage = () => false;
                await window.app._ensureSuiteRecoveryReady();
                const index = await window.app._fetchSuiteExamIndex();
                const sequence = ['P1', 'P2', 'P3'].map(category => {
                    // Keep a real text answer on the submitting passage. An
                    // arbitrary P3 can contain only choice/drag controls.
                    const exam = index.find(item => category === 'P3' ? item.id === (scenario === 'selection-drop' ? 'p3-high-192' : 'p3-high-15')
                        : item.category === category && item.type !== 'listening');
                    if (!exam) throw new Error('Required production submission fixture is missing');
                    return { examId: exam.id, exam };
                });
                await window.app._launchSuiteSessionFromSequence(sequence, { flowMode: 'simulation', frequencyScope: 'all' });
            }, scenario)]);
            page.on('dialog', dialog => dialog.accept());
            await ready(page);
            if (scenario === 'delayed-activation') await page.evaluate(() => {
                const original = ReadingTimingController.prototype.createEntry;
                window.__qualificationGate = { armed: true, held: false,
                    restore: () => { ReadingTimingController.prototype.createEntry = original; } };
                ReadingTimingController.prototype.createEntry = async function(...args) {
                    const hold = window.__qualificationGate.armed && args[0].sequenceIndex === 2;
                    if (hold) window.__qualificationGate.armed = false;
                    const entry = await original.apply(this, args);
                    if (hold) await new Promise(resolve => {
                        window.__qualificationGate.release = resolve; window.__qualificationGate.held = true;
                    });
                    return entry;
                };
            });
            for (const index of [1, 2, 0, 2]) {
                await page.locator(`#part-section-${index + 1} .part-nav-name`).click();
                if (scenario === 'delayed-activation' && index === 2) {
                    await page.waitForFunction(() => window.__qualificationGate.held);
                    await page.locator('#question-groups input[type="text"]').first().fill('answer during activation');
                    const accepted = await page.evaluate(`${hooks}.collectCurrentDraft().answers`);
                    await page.locator('#submit-btn').click({ force: true });
                    assert.equal(await host.evaluate(async () => (await AppData.practice.list()).length), 0);
                    assert.equal(await page.evaluate(`${hooks}.getTestState().submissionId`), '');
                    await page.evaluate(() => window.__qualificationGate.release());
                    await page.waitForFunction(() => window.__IELTS_UNIFIED_READING_PAGE_TEST__.getTestState().submitted);
                    const result = await host.evaluate(async () => {
                        const records = await AppData.practice.list();
                        const suite = await AppData.practice.get(records[0].id);
                        return { count: records.length, suite, rows: await Promise.all(suite.suiteEntries.map(entry =>
                            AppData.recovery.getReadingTiming(entry.readingTiming.attemptId))) };
                    });
                    assert.equal(result.count, 1); assert.equal(result.suite.suiteEntries.length, 3);
                    assert.deepEqual(result.suite.suiteEntries[2].answers, accepted);
                    for (const [index, entry] of result.suite.suiteEntries.entries()) {
                        assert.equal(entry.readingTiming.frozen, true);
                        assert.deepEqual(entry.readingTiming, result.rows[index].snapshot);
                    }
                    report.cases.push({ scenario, outcome: 'passed', completedRecords: 1, frozenPersistedSnapshots: 3 });
                    console.log(`${scenario}: passed`);
                    continue scenarioLoop;
                }
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
            if (scenario.startsWith('legacy-')) await host.evaluate(() => {
                const commit = window.app._commitSuiteRecovery;
                const save = window.app._saveSuitePracticeRecord;
                window.__restoreQualification = () => {
                    window.app._commitSuiteRecovery = commit; window.app._saveSuitePracticeRecord = save;
                };
                window.app._saveSuitePracticeRecord = function(record) {
                    return save.call(this, this.currentSuiteSession?.finalizeRecord || record);
                };
                let seeded = false;
                window.app._commitSuiteRecovery = async function(session, options = {}) {
                    if (!seeded && options.reason === 'finalize-record') {
                        seeded = true;
                        // Persist the old race's unfrozen/advanced final snapshot.
                        // The real seal rejects it; no storage guard is bypassed.
                        const timing = session.finalizeRecord.suiteEntries[2].readingTiming;
                        timing.frozen = false;
                        timing.revision += 3;
                        timing.unallocatedMs += 5;
                        timing.totalMs += 5;
                        session.results[2].readingTiming = structuredClone(timing);
                    }
                    return commit.call(this, session, options);
                };
            });
            assert.equal(await input.count(), 1, 'the production fixture must exercise a real text answer');
            if (await input.count()) await input.fill('synthetic answer');
            if (scenario === 'interactions') await page.locator('#question-groups input[type="checkbox"]').first().check();
            if (scenario === 'selection-drop') {
                const select = page.locator('#question-groups input[type="radio"]').first();
                await select.check();
                const beforeDrop = await page.evaluate(`${hooks}.collectCurrentDraft().answers`);
                await dropAnswer(page);
                assert.notDeepEqual(await page.evaluate(`${hooks}.collectCurrentDraft().answers`), beforeDrop,
                    'the production drag handlers must accept an answer before submission');
                queuedDrop = await page.evaluateHandle(() => new DataTransfer());
                await page.locator('#question-groups .drag-item:not(.option-consumed)').first()
                    .dispatchEvent('dragstart', { dataTransfer: queuedDrop });
                assert.ok(await queuedDrop.evaluate(transfer => transfer.getData('text/plain')),
                    'a drag begun before submission must carry a real payload across the barrier');
            }
            if (scenario === 'delayed-checkpoint') {
                await host.evaluate(() => {
                    const original = window.app._commitSuiteRecovery;
                    window.__qualificationGate = { armed: true, held: false,
                        restore: () => { window.app._commitSuiteRecovery = original; } };
                    window.app._commitSuiteRecovery = async function(...args) {
                        const hold = window.__qualificationGate.armed;
                        if (hold) window.__qualificationGate.armed = false;
                        const result = await original.apply(this, args);
                        if (hold) await new Promise(resolve => {
                            window.__qualificationGate.release = resolve; window.__qualificationGate.held = true;
                        });
                        return result;
                    };
                });
                await input.fill('answer with a delayed checkpoint');
                await page.evaluate(`${hooks}.syncSimulationDraftSnapshot('qualification-late-checkpoint')`);
                await host.evaluate(() => { void window.app._commitSuiteRecovery(window.app.currentSuiteSession,
                    { reason: 'qualification-checkpoint' }); });
                await host.waitForFunction(() => window.__qualificationGate.held);
            }
            if (scenario === 'unknown-ack') await page.evaluate(() => {
                window.__holdAcknowledgements = true;
            });
            await page.evaluate(({ failBeforeHandoff, ordinary }) => {
                const original = ReadingTimingController.prototype.save;
                let failNext = failBeforeHandoff;
                window.__freezeGate = { armed: !failBeforeHandoff && !ordinary, held: false, release: null,
                    restore: () => { ReadingTimingController.prototype.save = original; } };
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
            }, { failBeforeHandoff: scenario === 'pre-handoff-failure', ordinary: scenario === 'ordinary' });
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
            if (scenario !== 'ordinary') await page.waitForFunction(() => window.__freezeGate.held);
            await sync?.incoming();
            if (scenario === 'question-click') await page.locator('#part-section-3 .q-item').first().click();
            if (scenario === 'delayed-checkpoint') await host.evaluate(() => window.__qualificationGate.release());
            if (scenario === 'selection-drop') {
                const select = page.locator('#question-groups input[type="radio"]').nth(1);
                await select.click({ force: true }); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
                await page.locator('#question-groups .drag-item').first().dragTo(
                    page.locator('#question-groups .paragraph-dropzone, #question-groups .match-dropzone').first(), { force: true });
                await dropAnswer(page);
                await page.locator('#question-groups .paragraph-dropzone, #question-groups .match-dropzone').first()
                    .dispatchEvent('drop', { dataTransfer: queuedDrop });
                await page.locator('#submit-btn').click({ force: true });
                assert.deepEqual(await page.evaluate(`${hooks}.collectCurrentDraft().answers`), acceptedAnswers);
            }
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
                await page.locator('#question-groups input[type="checkbox"]').first().click({ force: true });
                await page.evaluate(async () => {
                    const h = window.__IELTS_UNIFIED_READING_PAGE_TEST__;
                    const s = h.getTestState();
                    h.syncSimulationDraftSnapshot('late-checkpoint');
                    await h.handleSubmit();
                    await h.handleIncoming({ source: window.opener, origin: location.origin, data: {
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
            await page.evaluate(() => window.__freezeGate.release?.());
            if (scenario.startsWith('legacy-')) {
                await page.waitForFunction(() => {
                    const state = window.__IELTS_UNIFIED_READING_PAGE_TEST__.getTestState();
                    return state.submissionId && state.submissionStatus === 'draft';
                });
                const retained = await host.evaluate(async () => {
                    const session = await AppData.recovery.getActiveSession(window.app.currentSuiteSession.id);
                    return { id: session.id, operationId: session.finalizeOperationId, submissionId: session.finalizeSubmissionId,
                        answers: session.finalizeRecord.answers, count: (await AppData.practice.list()).length };
                });
                assert.equal(retained.count, 0);
                assert.ok(retained.submissionId);
                const diagnostic = await host.evaluate(async () => {
                    const failure = AppDiagnostics.snapshot().events.find(event => event.module === 'suite'
                        && event.action === 'submit' && event.timingReason === 'not-frozen');
                    const output = await AppDiagnosticExport.exportJSON({ eventId: failure?.eventId });
                    return { failure, exported: output.report.events.find(event => event.eventId === failure?.eventId) };
                });
                assert.ok(diagnostic.failure, 'the real pre-fix snapshot must identify the unfrozen invariant');
                assert.equal(diagnostic.failure.causeCode, 'TIMING_STALE_WRITER');
                assert.equal(diagnostic.failure.persistence.operation, 'not-committed');
                assert.equal(diagnostic.failure.retry.available, true, 'the supported suite recovery closure is available');
                assert.equal(diagnostic.exported.timingReason, 'not-frozen');
                assert.ok(diagnostic.failure.breadcrumbs.some(crumb => crumb.action === 'save-recovery' && crumb.outcome === 'succeeded'));
                assert.ok(!diagnostic.failure.breadcrumbs.some(crumb => crumb.action === 'storage-confirmed'
                    && crumb.correlation.operation === diagnostic.failure.correlation.operation && crumb.outcome === 'succeeded'));
                const childFailure = await page.evaluate(() => AppDiagnostics.snapshot().events.find(event => event.code === 'PRACTICE_SAVE_FAILED'));
                assert.ok(childFailure); assert.notEqual(childFailure.windowId, diagnostic.failure.windowId);
                for (const key of ['scopeId', 'suite', 'submission', 'operation']) {
                    assert.equal(childFailure.correlation[key], diagnostic.failure.correlation[key], `shared ${key} alias`);
                }
                if (scenario === 'legacy-host-reload') {
                    await host.reload();
                    await host.waitForFunction(() => window.app?.isInitialized === true, null, { timeout: 60000 });
                    await host.evaluate(() => { void window.startSuitePractice(); });
                    await host.locator('[data-suite-recovery-choice="continue"]').filter({ hasText: '恢复并确认提交' }).click();
                } else {
                    await page.reload();
                    await page.waitForFunction(() => window.__IELTS_UNIFIED_READING_PAGE_TEST__?.getTestState().sessionReadySent
                        && !window.__IELTS_UNIFIED_READING_PAGE_TEST__.getTestState().suiteActivating);
                    assert.equal(await page.evaluate(`${hooks}.getTestState().submissionEditingLocked`), true);
                    assert.deepEqual(await page.evaluate(`${hooks}.collectCurrentDraft().answers`), acceptedAnswers);
                    assert.equal(await page.evaluate(`${hooks}.getReadingTimingState()?.entries.length || 0`), 0,
                        'a reloaded finalizing page must not acquire a new timing writer');
                    if (scenario === 'legacy-page-ack-loss') await page.evaluate(() => { window.__holdAcknowledgements = true; });
                    recoveryStartedAt = Date.now();
                    await page.locator('#submit-btn').click();
                    if (scenario === 'legacy-page-ack-loss') {
                        await page.waitForFunction(() => window.__heldAcknowledgements.length > 0);
                        const committed = await host.evaluate(async id => AppData.practice.get(id), retained.id);
                        assert.ok(committed);
                        await page.waitForFunction(() => window.__IELTS_UNIFIED_READING_PAGE_TEST__.getTestState().submissionStatus === 'draft');
                        assert.equal(await page.evaluate(`${hooks}.getTestState().submissionEditingLocked`), true);
                        const dismiss = page.getByRole('button', { name: '关闭提示（不代表已保存）', exact: true });
                        if (await dismiss.count()) await dismiss.click();
                        await page.evaluate(() => { window.__holdAcknowledgements = false; });
                        await page.locator('#submit-btn').click();
                        await page.waitForFunction(() => window.__IELTS_UNIFIED_READING_PAGE_TEST__.getTestState().submitted);
                        assert.deepEqual(await host.evaluate(async id => AppData.practice.get(id), retained.id), committed);
                        await page.evaluate(async () => {
                            const late = structuredClone(window.__heldAcknowledgements[0]);
                            late.data.operation = 'not-committed';
                            await window.__IELTS_UNIFIED_READING_PAGE_TEST__.handleIncoming({ source: window.opener, origin: location.origin, data: late });
                        });
                        assert.equal(await page.evaluate(`${hooks}.getTestState().submissionStatus`), 'submitted');
                    }
                    await page.waitForFunction(() => window.__IELTS_UNIFIED_READING_PAGE_TEST__.getTestState().submitted);
                    const cleanup = await host.evaluate(async id => ({
                        scheduled: Boolean(window.app.currentSuiteSession?.submitReceiptTeardownTimer),
                        retained: Boolean(await AppData.recovery.getActiveSession(id)),
                        guarded: Boolean(window.app.currentSuiteSession?.windowRef?.__IELTS_SUITE_PARENT_GUARD__)
                    }), retained.id);
                    assert.equal(cleanup.scheduled, true, 'successful page recovery schedules post-commit cleanup');
                    assert.equal(cleanup.retained, true, 'recovery remains available during the receipt replay window');
                    assert.equal(cleanup.guarded, false, 'committed recovery releases the page close guard');
                }
                await host.evaluate(async id => {
                    for (let attempt = 0; attempt < 100; attempt++) {
                        if (await AppData.practice.get(id)) return;
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                    try { await AppData.practice.recoverSuiteFinalization({ sessionId: id, operationId: `practice-suite:${id}:finalize` }); }
                    catch (error) { throw new Error(`Recovery did not finish: ${error.code}: ${error.message}`); }
                    throw new Error('Recovery did not finish');
                }, retained.id);
                const recovered = await host.evaluate(async id => AppData.practice.get(id), retained.id);
                assert.ok(recovered, JSON.stringify(await host.evaluate(async expectedId => ({
                    expectedId, records: (await AppData.practice.list()).map(record => ({ id: record.id, sessionId: record.sessionId, operationId: record.operationId })),
                    recovery: (await AppData.recovery.listActiveSessions()).map(session => ({ id: session.id, status: session.status }))
                }), retained.id)));
                assert.equal(recovered.operationId, retained.operationId);
                assert.equal(recovered.submissionId, retained.submissionId);
                assert.deepEqual(recovered.answers, retained.answers);
            }
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
            if (!page.isClosed()) await page.waitForFunction(() => {
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
                const evidence = await host.evaluate(async () => {
                    const session = await AppData.recovery.getActiveSession(window.app.currentSuiteSession.id);
                    const submitted = session.finalizeRecord.suiteEntries[2].readingTiming;
                    const saved = await AppData.recovery.getReadingTiming(submitted.attemptId);
                    const error = AppDiagnostics.snapshot().events.find(event => event.module === 'suite'
                        && event.code === 'PRACTICE_SAVE_FAILED');
                    return { status: session.status, frozen: submitted.frozen, writerMatches: submitted.writer === saved.snapshot.writer,
                        submittedRevision: submitted.revision, savedRevision: saved.snapshot.revision,
                        code: error?.causeCode, operation: error?.persistence.operation };
                });
                assert.equal(evidence.status, 'finalizing'); assert.equal(evidence.frozen, false);
                assert.equal(evidence.writerMatches, true); assert.equal(evidence.code, 'TIMING_STALE_WRITER');
                assert.equal(evidence.operation, 'not-committed');
                report.cases.push({ scenario, outcome: 'expected pre-fix failure', completedRecords: 0, evidence });
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
            if (scenario === 'legacy-page-reload') {
                await host.waitForFunction(() => window.app.currentSuiteSession === null, null, { timeout: 40000, polling: 100 });
                assert.ok(Date.now() - recoveryStartedAt >= 30000, 'cleanup preserves the full 30-second receipt replay window');
                assert.equal(await host.evaluate(async id => (await AppData.recovery.getActiveSession(id)) === null, result.suite.id), true);
                assert.equal(await host.evaluate(() => AppData.recovery.windowSession.get('simulation') === null), true);
                await page.close();
                await host.reload();
                await host.waitForFunction(() => window.app?.isInitialized === true, null, { timeout: 60000 });
                const afterReload = await host.evaluate(async id => {
                    await window.AppEntry.ensureSessionSuiteReady();
                    return { candidate: await window.app.getSuiteRecoveryCandidate(),
                        record: await AppData.practice.get(id), count: (await AppData.practice.list()).length };
                }, result.suite.id);
                assert.equal(afterReload.candidate, null, 'completed recovery does not reappear after host reload');
                assert.equal(afterReload.count, 1);
                assert.deepEqual(afterReload.record, result.suite);
                report.cases.at(-1).cleanupAfterReplayWindow = true;
            }
            console.log(`${scenario}: ${report.cases.at(-1).outcome}`);
            if (sync) report.cases.at(-1).sync = await sync.verify(result.suite.id);
        } finally { await queuedDrop?.dispose(); await sync?.close(); await restoreInstrumentation(context); await context.close(); }
    }
    report.status = 'passed';
} catch (error) {
    report.status = 'failed';
    report.failure = { name: error.name, message: error.message };
    throw error;
} finally {
    await env.close();
    saveReport(`reading-submission-freeze-${baseline ? 'baseline' : 'candidate'}.json`, report);
}
