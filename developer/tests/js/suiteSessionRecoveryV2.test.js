#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const source = fs.readFileSync(path.join(repoRoot, 'js/app/suitePracticeMixin.js'), 'utf8');

function createSessionStore() {
    const values = new Map();
    const calls = { save: 0, get: 0, discard: 0 };
    return {
        save(name, value) { calls.save += 1; values.set(String(name), structuredClone(value)); return true; },
        get(name) { calls.get += 1; return values.has(String(name)) ? structuredClone(values.get(String(name))) : null; },
        discard(name) { calls.discard += 1; values.delete(String(name)); return true; },
        peek(name) { return values.get(String(name)) || null; },
        calls
    };
}

function createHarness() {
    const sessionStore = createSessionStore();
    const activeSessionStore = new Map();
    const recoveryCalls = { save: 0, discard: 0, cleanup: 0, saveQueue: [], discardQueue: [], discardOptions: [] };
    const messages = [];
    const practiceFinalizes = [];
    const rawStorageTrap = new Proxy({}, {
        get() {
            throw new Error('suite recovery must use AppData v2, not raw Web Storage');
        },
        set() {
            throw new Error('suite recovery must use AppData v2, not raw Web Storage');
        }
    });
    const windowStub = {
        location: { protocol: 'http:', href: 'http://localhost/' },
        localStorage: rawStorageTrap,
        sessionStorage: rawStorageTrap,
        showMessage(text, type) { messages.push({ text, type }); },
        addEventListener() {},
        removeEventListener() {}
    };
    const sandbox = {
        window: windowStub,
        console,
        Date,
        Math,
        JSON,
        Array,
        Object,
        Map,
        Set,
        URL,
        structuredClone,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        AppData: {
            ready: Promise.resolve(),
            recovery: {
                windowSession: sessionStore,
                async listActiveSessions() {
                    return Array.from(activeSessionStore.values()).map((value) => structuredClone(value));
                },
                async saveActiveSession(value, options = {}) {
                    recoveryCalls.save += 1;
                    const behavior = recoveryCalls.saveQueue.length ? recoveryCalls.saveQueue.shift() : true;
                    const outcome = typeof behavior === 'function'
                        ? await behavior(structuredClone(value), structuredClone(options))
                        : behavior;
                    if (outcome instanceof Error) throw outcome;
                    if (outcome === false || (outcome && outcome.committed === false)) {
                        return outcome === false ? { committed: false } : structuredClone(outcome);
                    }
                    activeSessionStore.set(String(value.id), structuredClone(value));
                    return outcome && typeof outcome === 'object'
                        ? { ...structuredClone(outcome), committed: true, item: structuredClone(value) }
                        : { committed: true, item: structuredClone(value) };
                },
                async discardActiveSession(id, options = {}) {
                    recoveryCalls.discard += 1;
                    recoveryCalls.discardOptions.push(structuredClone(options));
                    const behavior = recoveryCalls.discardQueue.length ? recoveryCalls.discardQueue.shift() : true;
                    const outcome = typeof behavior === 'function'
                        ? await behavior(String(id), structuredClone(options))
                        : behavior;
                    if (outcome instanceof Error) throw outcome;
                    if (outcome === false || (outcome && outcome.committed === false)) {
                        return outcome === false ? { committed: false } : structuredClone(outcome);
                    }
                    activeSessionStore.delete(String(id));
                    return outcome && typeof outcome === 'object'
                        ? { ...structuredClone(outcome), committed: true }
                        : { committed: true };
                },
                async cleanupForRetry() {
                    recoveryCalls.cleanup += 1;
                    return { committed: true, removedCount: 0, removedByKind: {} };
                }
            },
            practice: {
                async finalizeSuite(command = {}) {
                    practiceFinalizes.push(structuredClone(command));
                    return { committed: true, record: structuredClone(command.record) };
                }
            }
        }
    };
    windowStub.AppData = sandbox.AppData;
    windowStub.ExamSystemAppMixins = {};
    sandbox.globalThis = windowStub;
    vm.runInContext(source, vm.createContext(sandbox), { filename: 'js/app/suitePracticeMixin.js' });
    const mixin = windowStub.ExamSystemAppMixins.suitePractice;
    const sequence = ['p1', 'p2', 'p3'].map((examId, index) => ({
        examId,
        exam: { id: examId, title: `Passage ${index + 1}`, category: `P${index + 1}` },
        category: `P${index + 1}`
    }));
    const makeApp = () => {
        const app = { components: {}, currentSuiteSession: null, suiteExamMap: new Map(), messages };
        Object.assign(app, mixin);
        app._clearSuiteHandshakes = () => {};
        app._ensureSuiteWindowGuard = () => {};
        app._releaseSuiteWindowGuard = () => {};
        app._focusSuiteWindow = () => {};
        app._sendSimulationContext = () => true;
        app.updateExamStatus = () => {};
        app.cleanupExamSession = async () => {};
        return app;
    };
    sandbox.localStorage = rawStorageTrap;
    sandbox.sessionStorage = rawStorageTrap;
    return { sessionStore, activeSessionStore, recoveryCalls, messages, practiceFinalizes, makeApp, sequence };
}

async function main() {
    const { sessionStore, messages, practiceFinalizes, makeApp, sequence } = createHarness();
    const firstApp = makeApp();
    let firstWindow;
    firstApp.openExam = async () => {
        const snapshot = sessionStore.peek('simulation');
        assert.equal(snapshot.status, 'active');
        assert.equal(snapshot.currentIndex, 0);
        assert.equal(snapshot.sequence.length, 3);
        firstWindow = { closed: false, name: 'suite-window' };
        return firstWindow;
    };
    assert.equal(await firstApp._launchSuiteSessionFromSequence(sequence, { flowMode: 'simulation' }), true);
    assert.equal(sessionStore.peek('simulation').status, 'active');

    // Drafts may arrive after the child Window exists but before openExam() resolves.
    // The initializing snapshot must bind that exact source and persist the draft.
    const earlyHarness = createHarness();
    const initializingApp = earlyHarness.makeApp();
    let initializingWindow;
    initializingApp.openExam = async () => {
        initializingWindow = { closed: false, name: 'initializing-window' };
        const initializingSession = initializingApp.currentSuiteSession;
        assert.equal(initializingSession.status, 'active');
        const accepted = await initializingApp._handleSuiteDraftSync('p1', {
            suiteSessionId: initializingSession.id,
            draft: { answers: { q1: 'early' }, updatedAt: 120 },
            draftUpdatedAt: 120,
            elapsed: 4
        }, { window: initializingWindow, suiteSessionId: initializingSession.id }, initializingWindow);
        assert.equal(accepted, true);
        assert.equal(initializingSession.windowRef, initializingWindow);
        return initializingWindow;
    };
    assert.equal(await initializingApp._launchSuiteSessionFromSequence(sequence, { flowMode: 'simulation' }), true);

    const choiceHarness = createHarness();
    const choiceSourceApp = choiceHarness.makeApp();
    choiceSourceApp.openExam = async () => ({ closed: false, name: 'choice-window', close() { this.closed = true; } });
    assert.equal(await choiceSourceApp._launchSuiteSessionFromSequence(sequence, { flowMode: 'simulation' }), true);
    const choiceApp = choiceHarness.makeApp();
    choiceApp.initializeSuiteMode();
    await choiceApp._ensureSuiteRecoveryReady();
    const choiceCandidate = await choiceApp.getSuiteRecoveryCandidate();
    assert.equal(choiceCandidate.id, choiceSourceApp.currentSuiteSession.id);
    let implicitResumeCount = 0;
    choiceApp.resumeSuitePractice = async () => { implicitResumeCount += 1; return true; };
    assert.equal(await choiceApp.startSuitePractice(), false, '未明确选择时不得自动继续恢复套题');
    assert.equal(implicitResumeCount, 0, '再次点击套题入口不能隐式等同于继续');
    assert.equal(await choiceApp.abandonSuiteRecovery(), false, '放弃 recovery 必须携带用户看到的 session id');
    assert.equal(await choiceApp.startSuitePractice({ recoveryAction: 'continue' }), false, '继续 recovery 必须携带用户看到的 session id');
    assert.equal(await choiceApp.abandonSuiteRecovery('another-suite'), false, '放弃操作必须绑定用户确认的 recovery identity');
    assert.equal(choiceApp.currentSuiteSession.id, choiceCandidate.id);
    assert.equal(await choiceApp.abandonSuiteRecovery(choiceCandidate.id), true, '用户明确放弃后应完整 teardown');
    assert.equal(choiceApp.currentSuiteSession, null);
    assert.equal(choiceHarness.activeSessionStore.size, 0, '放弃必须清除 durable active-session recovery');
    assert.equal(choiceHarness.practiceFinalizes.length, 0, '放弃未完成套题不得生成单篇或聚合记录');

    const discardFailureHarness = createHarness();
    const discardFailureApp = discardFailureHarness.makeApp();
    const discardFailureWindow = { closed: false, name: 'discard-failure', close() { this.closed = true; } };
    discardFailureApp.openExam = async () => discardFailureWindow;
    discardFailureApp.initializeSuiteMode();
    await discardFailureApp._ensureSuiteRecoveryReady();
    assert.equal(await discardFailureApp._launchSuiteSessionFromSequence(sequence, { flowMode: 'simulation' }), true);
    const discardFailureSession = discardFailureApp.currentSuiteSession;
    discardFailureHarness.recoveryCalls.discardQueue.push(false);
    assert.equal(await discardFailureApp.abandonSuiteRecovery(discardFailureSession.id), false);
    assert.equal(discardFailureApp.currentSuiteSession, discardFailureSession, 'discard failure must retain the in-memory suite');
    assert.equal(discardFailureSession.status, 'active', 'discard failure must not mark the suite aborted');
    assert.equal(discardFailureWindow.closed, false, 'discard failure must not close the active question window');
    assert(discardFailureHarness.activeSessionStore.has(discardFailureSession.id), 'discard failure must retain durable recovery');
    assert.equal(await discardFailureApp.abandonSuiteRecovery(discardFailureSession.id), true, 'discard should remain retryable');

    const queuedWriteHarness = createHarness();
    const queuedWriteApp = queuedWriteHarness.makeApp();
    const queuedWriteWindow = { closed: false, name: 'queued-write', close() { this.closed = true; } };
    queuedWriteApp.openExam = async () => queuedWriteWindow;
    queuedWriteApp.initializeSuiteMode();
    await queuedWriteApp._ensureSuiteRecoveryReady();
    assert.equal(await queuedWriteApp._launchSuiteSessionFromSequence(sequence, { flowMode: 'simulation' }), true);
    const queuedWriteSession = queuedWriteApp.currentSuiteSession;
    let releaseQueuedSave;
    let markQueuedSaveStarted;
    const queuedSaveStarted = new Promise((resolve) => { markQueuedSaveStarted = resolve; });
    queuedWriteHarness.recoveryCalls.saveQueue.push(async () => {
        markQueuedSaveStarted();
        return new Promise((resolve) => { releaseQueuedSave = resolve; });
    });
    const pendingRecoveryWrite = queuedWriteApp._commitSuiteRecovery(queuedWriteSession, { reason: 'queued-before-discard' });
    await queuedSaveStarted;
    const queuedAbandon = queuedWriteApp.abandonSuiteRecovery(queuedWriteSession.id);
    await Promise.resolve();
    assert.equal(queuedWriteWindow.closed, false, 'teardown must not close the window before the queued write settles');
    releaseQueuedSave({ committed: true });
    assert.equal(await pendingRecoveryWrite, true);
    assert.equal(await queuedAbandon, true);
    assert.equal(queuedWriteHarness.activeSessionStore.has(queuedWriteSession.id), false, 'discard must run after queued save and prevent resurrection');

    const submitAbandonHarness = createHarness();
    const submitAbandonApp = submitAbandonHarness.makeApp();
    let submitAbandonOpenCount = 0;
    const submitAbandonWindow = { closed: false, name: 'submit-abandon', close() { this.closed = true; } };
    submitAbandonApp.openExam = async () => {
        submitAbandonOpenCount += 1;
        return submitAbandonWindow;
    };
    submitAbandonApp.initializeSuiteMode();
    await submitAbandonApp._ensureSuiteRecoveryReady();
    assert.equal(await submitAbandonApp._launchSuiteSessionFromSequence(sequence, { flowMode: 'simulation' }), true);
    const submitAbandonSession = submitAbandonApp.currentSuiteSession;
    let releaseSubmitSave;
    let markSubmitSaveStarted;
    const submitSaveStarted = new Promise((resolve) => { markSubmitSaveStarted = resolve; });
    submitAbandonHarness.recoveryCalls.saveQueue.push(async () => {
        markSubmitSaveStarted();
        return new Promise((resolve) => { releaseSubmitSave = resolve; });
    });
    const submitOutcomePromise = submitAbandonApp.handleSuitePracticeComplete('p1', {
        suiteSessionId: submitAbandonSession.id,
        submissionId: 'submit-abandon-p1',
        duration: 10,
        answers: { q1: 'A' },
        answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
        scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
    }, submitAbandonWindow);
    await submitSaveStarted;
    const submitAbandonPromise = submitAbandonApp.abandonSuiteRecovery(submitAbandonSession.id);
    await Promise.resolve();
    releaseSubmitSave({ committed: true });
    const submitOutcome = await submitOutcomePromise;
    assert.equal(submitOutcome.handled, true);
    assert.equal(submitOutcome.committed, false, 'abandon must invalidate the in-flight submit continuation before ACK');
    assert.equal(submitOutcome.errorCode, 'suite_teardown_in_progress');
    assert.equal(await submitAbandonPromise, true);
    assert.equal(submitAbandonOpenCount, 1, 'an abandoned submit must not open the next passage');

    const walPreservationHarness = createHarness();
    const walSourceApp = walPreservationHarness.makeApp();
    walSourceApp.openExam = async () => ({ closed: false, name: 'wal-source' });
    walSourceApp.initializeSuiteMode();
    await walSourceApp._ensureSuiteRecoveryReady();
    assert.equal(await walSourceApp._launchSuiteSessionFromSequence(sequence, { flowMode: 'simulation' }), true);
    const validWal = walPreservationHarness.sessionStore.peek('simulation');
    walPreservationHarness.activeSessionStore.clear();
    walPreservationHarness.activeSessionStore.set('corrupt-durable', {
        schema: 'suite-session-v2',
        version: 2,
        id: 'corrupt-durable',
        status: 'invalid',
        revision: 4,
        lastUpdate: Number(validWal.lastUpdate) + 1000
    });
    const walRestoredApp = walPreservationHarness.makeApp();
    walRestoredApp.initializeSuiteMode();
    await walRestoredApp._ensureSuiteRecoveryReady();
    assert.equal(walRestoredApp.currentSuiteSession.id, validWal.id, 'invalid durable candidates must not erase a valid window WAL');
    assert.equal(walPreservationHarness.sessionStore.peek('simulation').id, validWal.id);
    assert.equal(
        walPreservationHarness.recoveryCalls.discardOptions[0].expectedEntityRevision,
        4,
        'invalid candidate cleanup must CAS against the listed entity revision'
    );

    const walOrderingHarness = createHarness();
    const walOrderingSource = walOrderingHarness.makeApp();
    walOrderingSource.openExam = async () => ({ closed: false, name: 'wal-ordering-source' });
    walOrderingSource.initializeSuiteMode();
    await walOrderingSource._ensureSuiteRecoveryReady();
    assert.equal(await walOrderingSource._launchSuiteSessionFromSequence(sequence, { flowMode: 'simulation' }), true);
    const orderingBase = walOrderingHarness.sessionStore.peek('simulation');
    const laterTimestampOlderRevision = {
        ...structuredClone(orderingBase),
        revision: 9,
        lastUpdate: 9000,
        currentIndex: 0,
        activeExamId: 'p1'
    };
    const higherDurableRevision = {
        ...structuredClone(orderingBase),
        revision: 10,
        lastUpdate: 1000,
        currentIndex: 1,
        activeExamId: 'p2'
    };
    walOrderingHarness.sessionStore.save('simulation', laterTimestampOlderRevision);
    walOrderingHarness.activeSessionStore.set(orderingBase.id, higherDurableRevision);
    const walOrderingApp = walOrderingHarness.makeApp();
    walOrderingApp.initializeSuiteMode();
    await walOrderingApp._ensureSuiteRecoveryReady();
    assert.equal(walOrderingApp.currentSuiteSession.currentIndex, 1, 'higher durable revision must beat a later timestamp on an older WAL revision');
    assert.equal(walOrderingApp.currentSuiteSession.activeExamId, 'p2');

    const resumedApp = makeApp();
    resumedApp.initializeSuiteMode();
    await resumedApp._ensureSuiteRecoveryReady();
    assert.equal(resumedApp.currentSuiteSession.id, firstApp.currentSuiteSession.id);
    assert.equal(resumedApp.currentSuiteSession.activeExamId, 'p1');
    assert.equal(resumedApp.currentSuiteSession.globalTimerAnchorMs, firstApp.currentSuiteSession.globalTimerAnchorMs);

    const suiteWindow = { closed: false, name: 'suite-window' };
    const session = resumedApp.currentSuiteSession;
    session.status = 'active';
    session.windowRef = suiteWindow;
    session.activeExamId = 'p2';
    session.currentIndex = 1;
    const windowInfo = { window: suiteWindow, suiteSessionId: session.id };
    assert.equal(await resumedApp._handleSuiteDraftSync('p2', {
        suiteSessionId: session.id,
        draft: { answers: { q2: 'new' }, updatedAt: 100 },
        draftUpdatedAt: 100,
        elapsed: 12
    }, windowInfo, suiteWindow), true);
    assert.deepEqual(session.draftsByExam.p2.answers, { q2: 'new' });
    assert.equal(await resumedApp._handleSuiteDraftSync('p2', {
        suiteSessionId: session.id,
        draft: { answers: { q2: 'equal-must-reject' }, updatedAt: 100 },
        draftUpdatedAt: 100
    }, windowInfo, suiteWindow), false);
    assert.deepEqual(session.draftsByExam.p2.answers, { q2: 'new' });
    assert.equal(await resumedApp._handleSuiteDraftSync('p2', {
        suiteSessionId: session.id,
        draft: { answers: { q2: 'missing-time-must-reject' } }
    }, windowInfo, suiteWindow), false);
    assert.equal(await resumedApp._handleSuiteDraftSync('p1', {
        suiteSessionId: session.id,
        draft: { answers: { q1: 'late-p1' }, updatedAt: 200 },
        draftUpdatedAt: 200
    }, windowInfo, suiteWindow), true);
    assert.equal(session.activeExamId, 'p2', '迟到的旧篇草稿不得回滚活动篇章');
    assert.equal(session.currentIndex, 1);

    // A paused suite must retain its pause state when a draft omits timer fields.
    const pausedSession = {
        ...session,
        suiteTimerRunning: false,
        suiteTimerPausedAtMs: 5000,
        suiteTimerPausedOffsetMs: 3000
    };
    resumedApp._syncSuiteTimerFromPayload(pausedSession, {
        draft: { answers: { q1: 'paused' }, updatedAt: 300 }
    });
    assert.equal(pausedSession.suiteTimerRunning, false, '普通草稿同步不得恢复暂停套题计时');
    assert.equal(pausedSession.suiteTimerPausedAtMs, 5000, '普通草稿同步不得清除暂停时间');

    let openedOnResume = false;
    resumedApp.openExam = async () => {
        openedOnResume = true;
        return { closed: false, name: 'replacement' };
    };
    session.windowRef = null;
    session._restoredFromStorage = true;
    resumedApp._fetchSuiteExamIndex = async () => sequence.map((entry) => entry.exam);
    assert.equal(await resumedApp.resumeSuitePractice(session.id), true);
    assert.equal(openedOnResume, true);
    assert.equal(sessionStore.peek('simulation').draftsByExam.p2.answers.q2, 'new');

    const missingApp = makeApp();
    missingApp.initializeSuiteMode();
    missingApp._fetchSuiteExamIndex = async () => [sequence[0].exam];
    missingApp.openExam = async () => { throw new Error('must not open missing exam'); };
    const missingRecoveryId = missingApp.currentSuiteSession.id;
    const discardCallsBeforeMismatch = sessionStore.calls.discard;
    assert.equal(await missingApp.resumeSuitePractice(missingApp.currentSuiteSession.id), false);
    assert.equal(sessionStore.peek('simulation').id, missingRecoveryId, '题库不一致不得擅自放弃 recovery');
    assert.equal(sessionStore.calls.discard, discardCallsBeforeMismatch, '题库不一致不得清除窗口恢复镜像');
    assert.equal(
        messages.some((entry) => entry.type === 'warning' && entry.text.includes('恢复数据仍会保留')),
        true,
        '题库不一致必须明确告知用户 recovery 已保留'
    );

    const invalidTerminalSnapshot = {
        schema: 'suite-session-v2',
        version: 2,
        id: 'suite_invalid_terminal',
        status: 'finalizing',
        sequence,
        suiteSequence: sequence,
        currentIndex: sequence.length,
        activeExamId: null,
        results: [{
            examId: 'p1',
            title: 'Passage 1',
            category: 'P1',
            scoreInfo: { correct: 1, total: 1 }
        }],
        draftsByExam: {},
        elapsedByExam: {},
        suiteTimerMode: 'elapsed',
        suiteTimerLimitSeconds: 3600,
        startTime: 1000,
        globalTimerAnchorMs: 1000,
        suiteTimerAnchorMs: 1000,
        lastUpdate: 1000
    };
    sessionStore.save('simulation', invalidTerminalSnapshot);
    const corruptApp = makeApp();
    corruptApp.initializeSuiteMode();
    assert.equal(corruptApp.currentSuiteSession, null, '不完整终态快照必须被丢弃');
    assert.equal(sessionStore.peek('simulation'), null, '不完整终态快照不得永久卡在 finalizing');

    const validTerminalResults = sequence.map((entry) => ({
        examId: entry.examId,
        title: entry.exam.title,
        category: entry.category,
        duration: 10,
        scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 },
        answers: { [`q-${entry.examId}`]: 'A' },
        answerComparison: {}
    }));
    const terminalActiveId = 'suite_terminal_active_id';
    sessionStore.save('simulation', {
        ...invalidTerminalSnapshot,
        id: terminalActiveId,
        status: 'active',
        activeExamId: 'p3',
        results: validTerminalResults,
        finalizeOperationId: null,
        finalizeRecord: null
    });
    const terminalActiveApp = makeApp();
    terminalActiveApp.initializeSuiteMode();
    assert.equal(terminalActiveApp.currentSuiteSession.status, 'finalizing', '已完成索引的活动篇章快照必须转入终态恢复');
    assert.equal(terminalActiveApp.currentSuiteSession.activeExamId, null, '终态恢复不得重新打开最后一篇');

    const malformedRecordId = 'suite_malformed_record';
    sessionStore.save('simulation', {
        ...invalidTerminalSnapshot,
        id: malformedRecordId,
        results: validTerminalResults,
        finalizeOperationId: `practice-suite:${malformedRecordId}:finalize`,
        finalizeRecord: {
            id: malformedRecordId,
            sessionId: malformedRecordId,
            operationId: `practice-suite:${malformedRecordId}:finalize`,
            suiteEntries: sequence.map((entry) => ({ examId: entry.examId }))
        }
    });
    const malformedRecordApp = makeApp();
    malformedRecordApp.initializeSuiteMode();
    assert.equal(malformedRecordApp.currentSuiteSession, null, '缺少聚合字段的终态记录不得重放');
    assert.equal(sessionStore.peek('simulation'), null);

    const incompleteFinalizeApp = makeApp();
    const incompleteFinalizeSession = {
        id: 'suite_incomplete_finalize',
        status: 'active',
        startTime: 1000,
        sequence,
        currentIndex: 2,
        activeExamId: 'p3',
        results: validTerminalResults.filter((entry) => entry.examId !== 'p2'),
        draftsByExam: {},
        elapsedByExam: {},
        flowMode: 'stationary',
        windowRef: null
    };
    incompleteFinalizeApp.currentSuiteSession = incompleteFinalizeSession;
    incompleteFinalizeApp._saveSuitePracticeRecord = async () => {
        throw new Error('incomplete suite must not be persisted');
    };
    assert.equal(await incompleteFinalizeApp._finalizeSuiteRecordWithGate(incompleteFinalizeSession), false);
    assert.equal(incompleteFinalizeSession.status, 'active');
    assert.equal(incompleteFinalizeSession.currentIndex, 1);
    assert.equal(incompleteFinalizeSession.activeExamId, 'p2');

    const finalApp = makeApp();
    let committedRecord = null;
    const finalSession = {
        id: 'suite_terminal',
        status: 'active',
        startTime: 1000,
        globalTimerAnchorMs: 1000,
        suiteTimerAnchorMs: 1000,
        sequence,
        currentIndex: sequence.length,
        activeExamId: null,
        results: sequence.map((entry) => ({
            examId: entry.examId,
            title: entry.exam.title,
            category: entry.category,
            duration: 10,
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 },
            answers: { [`q-${entry.examId}`]: 'A' },
            answerComparison: {}
        })),
        draftsByExam: {},
        elapsedByExam: {},
        windowRef: null
    };
    finalApp.currentSuiteSession = finalSession;
    finalApp._resolveSuiteSequenceNumber = async () => 1;
    finalApp._formatSuiteDateLabel = () => '2026-08-07';
    finalApp._updatePracticeRecordsState = async () => {};
    finalApp.refreshOverviewData = () => {};
    assert.equal(await finalApp.resumeSuitePractice(finalSession.id), true);
    committedRecord = practiceFinalizes[0] && practiceFinalizes[0].record;
    assert.equal(practiceFinalizes.length, 1, '终态恢复必须调用 v2 AppData.practice.finalizeSuite');
    assert.equal(practiceFinalizes[0].operationId, 'practice-suite:suite_terminal:finalize');
    assert.equal(practiceFinalizes[0].record.operationId, practiceFinalizes[0].operationId);
    assert.equal(sessionStore.peek('simulation'), null);
    assert.equal(finalSession.status, 'completed');
    assert.equal(messages.some((entry) => entry.type === 'error'), false);

    const divergentId = 'suite_divergent_record';
    sessionStore.save('simulation', {
        ...invalidTerminalSnapshot,
        id: divergentId,
        results: validTerminalResults,
        finalizeOperationId: `practice-suite:${divergentId}:finalize`,
        finalizeRecord: {
            ...committedRecord,
            id: divergentId,
            sessionId: divergentId,
            operationId: `practice-suite:${divergentId}:finalize`,
            correctAnswers: 999,
            scoreInfo: { ...committedRecord.scoreInfo, correct: 999 }
        }
    });
    const divergentApp = makeApp();
    divergentApp.initializeSuiteMode();
    assert.equal(divergentApp.currentSuiteSession, null, '分数与结果不一致的终态聚合记录必须被丢弃');
    assert.equal(sessionStore.peek('simulation'), null);

    const concurrentApp = makeApp();
    const concurrentWindow = { closed: false, name: 'concurrent-window' };
    const concurrentSession = {
        ...finalSession,
        id: 'suite_concurrent_finalize',
        status: 'active',
        currentIndex: 0,
        activeExamId: 'p1',
        results: [],
        draftsByExam: {},
        elapsedByExam: {},
        flowMode: 'simulation',
        windowRef: concurrentWindow,
        finalizeRecord: null,
        finalizeOperationId: null,
        _lastDurableRecoveryRevision: 0,
        _suiteRecoveryWritesBlocked: false,
        _suiteTeardownInProgress: false,
        _teardownPromise: null
    };
    concurrentApp.currentSuiteSession = concurrentSession;
    concurrentApp._resolveSuiteSequenceNumber = async () => 1;
    concurrentApp._formatSuiteDateLabel = () => '2026-08-07';
    concurrentApp._updatePracticeRecordsState = async () => {};
    concurrentApp.refreshOverviewData = () => {};
    let finalizeCalls = 0;
    concurrentApp._saveSuitePracticeRecord = async (record) => {
        finalizeCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return record;
    };
    const concurrentPayload = {
        suiteSessionId: concurrentSession.id,
        suiteSubmission: true,
        submissionId: 'submission-concurrent',
        suiteEntries: sequence.map((entry) => ({
            examId: entry.examId,
            duration: 10,
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 },
            answers: { [`q-${entry.examId}`]: 'A' },
            answerComparison: {}
        }))
    };
    const concurrentOutcomes = await Promise.all([
        concurrentApp._handleInlineSimulationSuiteSubmit('p1', concurrentPayload, concurrentWindow),
        concurrentApp._handleInlineSimulationSuiteSubmit('p1', concurrentPayload, concurrentWindow)
    ]);
    assert.equal(finalizeCalls, 1, '并发 inline submit 必须复用同一个 finalize promise');
    assert.equal(concurrentOutcomes.every((outcome) => outcome && outcome.committed === true), true);

    const mirrorHarness = createHarness();
    const mirrorApp = mirrorHarness.makeApp();
    mirrorHarness.sessionStore.save = () => {
        const error = new Error('session storage denied');
        error.name = 'SecurityError';
        throw error;
    };
    assert.equal(mirrorApp._mirrorSuiteRecoverySnapshot({ id: 'suite-mirror-denied' }), false);
    assert.equal(
        mirrorHarness.messages.filter((entry) => entry.type === 'warning' && entry.text.includes('临时恢复存储')).length,
        1,
        'sessionStorage 拒绝必须产生可见降级提示'
    );
    assert.equal(mirrorApp._mirrorSuiteRecoverySnapshot({ id: 'suite-mirror-denied' }), false);
    assert.equal(
        mirrorHarness.messages.filter((entry) => entry.type === 'warning' && entry.text.includes('临时恢复存储')).length,
        1,
        '连续镜像失败提示必须节流'
    );

    process.stdout.write(JSON.stringify({ status: 'pass', detail: 'v2 suite recovery state machine passed' }));
}

main().catch((error) => {
    process.stdout.write(JSON.stringify({ status: 'fail', detail: error.stack || String(error) }));
    process.exit(1);
});
