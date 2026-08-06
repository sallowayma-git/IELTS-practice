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
    return {
        save(name, value) { values.set(String(name), structuredClone(value)); return true; },
        get(name) { return values.has(String(name)) ? structuredClone(values.get(String(name))) : null; },
        discard(name) { values.delete(String(name)); return true; },
        peek(name) { return values.get(String(name)) || null; }
    };
}

function createHarness() {
    const sessionStore = createSessionStore();
    const messages = [];
    const windowStub = {
        location: { protocol: 'http:', href: 'http://localhost/' },
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
        AppData: { recovery: { windowSession: sessionStore } }
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
    return { sessionStore, messages, makeApp, sequence };
}

async function main() {
    const { sessionStore, messages, makeApp, sequence } = createHarness();
    const firstApp = makeApp();
    let firstWindow;
    firstApp.openExam = async () => {
        const snapshot = sessionStore.peek('simulation');
        assert.equal(snapshot.status, 'initializing');
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
        assert.equal(initializingSession.status, 'initializing');
        const accepted = initializingApp._handleSuiteDraftSync('p1', {
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

    const resumedApp = makeApp();
    resumedApp.initializeSuiteMode();
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
    assert.equal(resumedApp._handleSuiteDraftSync('p2', {
        suiteSessionId: session.id,
        draft: { answers: { q2: 'new' }, updatedAt: 100 },
        draftUpdatedAt: 100,
        elapsed: 12
    }, windowInfo, suiteWindow), true);
    assert.deepEqual(session.draftsByExam.p2.answers, { q2: 'new' });
    assert.equal(resumedApp._handleSuiteDraftSync('p2', {
        suiteSessionId: session.id,
        draft: { answers: { q2: 'equal-must-reject' }, updatedAt: 100 },
        draftUpdatedAt: 100
    }, windowInfo, suiteWindow), false);
    assert.deepEqual(session.draftsByExam.p2.answers, { q2: 'new' });
    assert.equal(resumedApp._handleSuiteDraftSync('p2', {
        suiteSessionId: session.id,
        draft: { answers: { q2: 'missing-time-must-reject' } }
    }, windowInfo, suiteWindow), false);
    assert.equal(resumedApp._handleSuiteDraftSync('p1', {
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
    assert.equal(await resumedApp.resumeSuitePractice(), true);
    assert.equal(openedOnResume, true);
    assert.equal(sessionStore.peek('simulation').draftsByExam.p2.answers.q2, 'new');

    const missingApp = makeApp();
    missingApp.initializeSuiteMode();
    missingApp._fetchSuiteExamIndex = async () => [sequence[0].exam];
    missingApp.openExam = async () => { throw new Error('must not open missing exam'); };
    assert.equal(await missingApp.resumeSuitePractice(), false);
    assert.equal(sessionStore.peek('simulation'), null);

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
    finalApp._saveSuitePracticeRecord = async (record) => {
        committedRecord = structuredClone(record);
        const snapshot = sessionStore.peek('simulation');
        assert.equal(snapshot.status, 'finalizing');
        assert.equal(snapshot.currentIndex, sequence.length);
        assert.equal(snapshot.finalizeOperationId, 'practice-suite:suite_terminal:finalize');
        assert.equal(snapshot.finalizeRecord.operationId, snapshot.finalizeOperationId);
        return record;
    };
    assert.equal(await finalApp.resumeSuitePractice(), true);
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
        finalizeOperationId: null
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

    process.stdout.write(JSON.stringify({ status: 'pass', detail: 'v2 suite recovery state machine passed' }));
}

main().catch((error) => {
    process.stdout.write(JSON.stringify({ status: 'fail', detail: error.stack || String(error) }));
    process.exit(1);
});
