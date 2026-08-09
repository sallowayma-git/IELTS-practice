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
    const durableSessions = new Map();
    const durableWrites = [];
    const durableDiscards = [];
    const controls = { saveActiveSession: null, discardActiveSession: null };
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
        AppData: {
            ready: Promise.resolve(),
            recovery: {
                windowSession: sessionStore,
                async listActiveSessions() {
                    return Array.from(durableSessions.values(), (value) => structuredClone(value));
                },
                async saveActiveSession(value, options = {}) {
                    assert.deepEqual(Object.keys(options).sort(), ['operationId']);
                    durableWrites.push({
                        value: structuredClone(value),
                        options: { operationId: options.operationId }
                    });
                    if (typeof controls.saveActiveSession === 'function') {
                        return controls.saveActiveSession(value, options, durableSessions);
                    }
                    durableSessions.set(String(value.id), structuredClone(value));
                    return { committed: true, value: structuredClone(value) };
                },
                async discardActiveSession(id, options = {}) {
                    assert.deepEqual(Object.keys(options).sort(), ['operationId']);
                    durableDiscards.push({
                        id: String(id),
                        options: { operationId: options.operationId }
                    });
                    if (typeof controls.discardActiveSession === 'function') {
                        return controls.discardActiveSession(id, options, durableSessions);
                    }
                    durableSessions.delete(String(id));
                    return { committed: true };
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
    return { sessionStore, durableSessions, durableWrites, durableDiscards, controls, messages, makeApp, sequence };
}

async function main() {
    const { sessionStore, durableSessions, durableWrites, messages, makeApp, sequence } = createHarness();
    const firstApp = makeApp();
    let firstWindow;
    firstApp.openExam = async () => {
        const snapshot = sessionStore.peek('simulation');
        const durable = Array.from(durableSessions.values())[0];
        assert.equal(snapshot.status, 'active');
        assert.equal(durable.status, 'active', 'first passage must not open before durable recovery is committed');
        assert.equal(snapshot.currentIndex, 0);
        assert.equal(snapshot.sequence.length, 3);
        firstWindow = { closed: false, name: 'suite-window' };
        return firstWindow;
    };
    assert.equal(await firstApp._launchSuiteSessionFromSequence(sequence, { flowMode: 'simulation' }), true);
    assert.equal(sessionStore.peek('simulation').status, 'active');
    assert.equal(durableWrites.length, 1);

    // Durable AppData is authoritative whenever it is available. A fast mirror
    // without a matching durable entity is cleared instead of being promoted.
    {
        const zeroHarness = createHarness();
        const writer = zeroHarness.makeApp();
        writer.openExam = async () => ({ closed: false, name: 'zero-durable-writer' });
        assert.equal(await writer._launchSuiteSessionFromSequence(zeroHarness.sequence, { flowMode: 'simulation' }), true);
        assert.ok(zeroHarness.sessionStore.peek('simulation'));
        zeroHarness.durableSessions.clear();

        const zeroApp = zeroHarness.makeApp();
        zeroApp.initializeSuiteMode();
        await zeroApp._suiteRecoveryReady;
        assert.equal(zeroApp.currentSuiteSession, null);
        assert.equal(zeroHarness.sessionStore.peek('simulation'), null);
        assert.equal(zeroHarness.durableWrites.length, 1, 'fast WAL must never be promoted into AppData');
    }

    // Exactly one valid durable entity wins and overwrites any newer-looking fast WAL.
    {
        const oneHarness = createHarness();
        const writer = oneHarness.makeApp();
        writer.openExam = async () => ({ closed: false, name: 'one-durable-writer' });
        assert.equal(await writer._launchSuiteSessionFromSequence(oneHarness.sequence, { flowMode: 'simulation' }), true);
        const durable = structuredClone(Array.from(oneHarness.durableSessions.values())[0]);
        const uncommittedFast = oneHarness.sessionStore.peek('simulation');
        uncommittedFast.revision = durable.revision + 100;
        uncommittedFast.lastUpdate = durable.lastUpdate + 100;
        uncommittedFast.draftsByExam = { p1: { answers: { ghost: 'not-durable' }, updatedAt: 9999 } };
        oneHarness.sessionStore.save('simulation', uncommittedFast);

        const oneApp = oneHarness.makeApp();
        oneApp.initializeSuiteMode();
        await oneApp._suiteRecoveryReady;
        assert.equal(oneApp.currentSuiteSession.id, durable.id);
        assert.equal(oneApp.currentSuiteSession.revision, durable.revision);
        assert.deepEqual(oneApp.currentSuiteSession.draftsByExam, durable.draftsByExam);
        const reconciledMirror = oneHarness.sessionStore.peek('simulation');
        assert.equal(reconciledMirror.revision, durable.revision);
        assert.deepEqual(reconciledMirror.draftsByExam, durable.draftsByExam);
        assert.equal(oneHarness.durableWrites.length, 1, 'durable restore must not write back a fast snapshot');
    }

    // Multiple valid durable entities are ambiguous in the single-window build.
    // Keep both durable records, clear the fast mirror, and refuse to choose/start.
    {
        const manyHarness = createHarness();
        const writer = manyHarness.makeApp();
        writer.openExam = async () => ({ closed: false, name: 'many-durable-writer' });
        assert.equal(await writer._launchSuiteSessionFromSequence(manyHarness.sequence, { flowMode: 'simulation' }), true);
        const firstDurable = structuredClone(Array.from(manyHarness.durableSessions.values())[0]);
        const secondDurable = {
            ...structuredClone(firstDurable),
            id: 'suite_second_durable',
            revision: firstDurable.revision + 100,
            lastUpdate: firstDurable.lastUpdate + 100
        };
        manyHarness.durableSessions.set(secondDurable.id, secondDurable);

        const manyApp = manyHarness.makeApp();
        manyApp.initializeSuiteMode();
        await manyApp._suiteRecoveryReady;
        assert.equal(manyApp.currentSuiteSession, null);
        assert.equal(manyApp._suiteRecoveryAmbiguous, true);
        assert.equal(manyApp._suiteRecoveryAmbiguousCount, 2);
        assert.equal(manyHarness.sessionStore.peek('simulation'), null);
        assert.equal(manyHarness.durableSessions.size, 2);
        assert.equal(manyHarness.messages.some((entry) => String(entry.text).includes('Multiple unfinished suites')), true);
        assert.equal(await manyApp.startSuitePractice(), false);
        assert.equal(manyHarness.durableSessions.size, 2);
    }

    // The passage result must be durable before the child receives a positive ACK
    // or the next passage is opened.
    {
        const passageHarness = createHarness();
        const passageApp = passageHarness.makeApp();
        const firstPassageWindow = { closed: false, name: 'passage-one' };
        let openCount = 0;
        passageApp.openExam = async () => {
            openCount += 1;
            if (openCount === 1) return firstPassageWindow;
            const durable = Array.from(passageHarness.durableSessions.values())[0];
            assert.equal(durable.currentIndex, 1);
            assert.equal(durable.results[0].examId, 'p1');
            return { closed: false, name: 'passage-two' };
        };
        assert.equal(await passageApp._launchSuiteSessionFromSequence(passageHarness.sequence, { flowMode: 'simulation' }), true);
        const passageOutcome = await passageApp.handleSuitePracticeComplete('p1', {
            suiteSessionId: passageApp.currentSuiteSession.id,
            submissionId: 'passage-one-submit',
            duration: 10,
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 },
            answers: { q1: 'A' },
            answerComparison: {}
        }, firstPassageWindow);
        assert.equal(passageOutcome.committed, true);
        assert.equal(openCount, 2);
    }

    // A rejected durable write is a NACK and must not advance the child window.
    {
        const failedHarness = createHarness();
        const failedApp = failedHarness.makeApp();
        let openCount = 0;
        const failedWindow = { closed: false, name: 'failed-save' };
        failedApp.openExam = async () => {
            openCount += 1;
            return openCount === 1
                ? failedWindow
                : { closed: false, name: 'retry-success' };
        };
        assert.equal(await failedApp._launchSuiteSessionFromSequence(failedHarness.sequence, { flowMode: 'simulation' }), true);
        const failedSession = failedApp.currentSuiteSession;
        const beforeFailure = {
            lastUpdate: failedSession.lastUpdate,
            revision: failedSession.revision,
            draftRevisionPresent: Object.prototype.hasOwnProperty.call(failedSession, 'draftRevision'),
            draftRevision: failedSession.draftRevision,
            currentIndex: failedSession.currentIndex,
            activeExamId: failedSession.activeExamId,
            pendingAdvancePresent: Object.prototype.hasOwnProperty.call(failedSession, 'pendingAdvance'),
            pendingAdvance: failedSession.pendingAdvance,
            globalTimerAnchorMs: failedSession.globalTimerAnchorMs,
            suiteTimerPausedOffsetMs: failedSession.suiteTimerPausedOffsetMs,
            suiteTimerPausedAtMs: failedSession.suiteTimerPausedAtMs,
            suiteTimerRunning: failedSession.suiteTimerRunning
        };
        const failedPayload = {
            suiteSessionId: failedSession.id,
            submissionId: 'passage-save-failed',
            duration: 10,
            draft: { answers: { q1: 'A' }, updatedAt: 9000 },
            draftUpdatedAt: 9000,
            suiteTimerPausedOffsetMs: 1234,
            suiteTimerPausedAtMs: 8000,
            suiteTimerRunning: false,
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 },
            answers: { q1: 'A' },
            answerComparison: {}
        };
        failedHarness.controls.saveActiveSession = async () => ({ committed: false });
        const failedOutcome = await failedApp.handleSuitePracticeComplete('p1', failedPayload, failedWindow);
        assert.equal(failedOutcome.committed, false);
        assert.equal(failedOutcome.errorCode, 'suite_recovery_save_failed');
        assert.equal(openCount, 1);
        assert.deepEqual(failedSession.results, []);
        assert.deepEqual(failedSession.draftsByExam, {});
        assert.deepEqual(failedSession.elapsedByExam, {});
        assert.equal(failedSession.lastUpdate, beforeFailure.lastUpdate);
        assert.equal(failedSession.revision, beforeFailure.revision);
        assert.equal(Object.prototype.hasOwnProperty.call(failedSession, 'draftRevision'), beforeFailure.draftRevisionPresent);
        assert.equal(failedSession.draftRevision, beforeFailure.draftRevision);
        assert.equal(failedSession.currentIndex, beforeFailure.currentIndex);
        assert.equal(failedSession.activeExamId, beforeFailure.activeExamId);
        assert.equal(Object.prototype.hasOwnProperty.call(failedSession, 'pendingAdvance'), beforeFailure.pendingAdvancePresent);
        assert.equal(failedSession.pendingAdvance, beforeFailure.pendingAdvance);
        assert.equal(failedSession.globalTimerAnchorMs, beforeFailure.globalTimerAnchorMs);
        assert.equal(failedSession.suiteTimerPausedOffsetMs, beforeFailure.suiteTimerPausedOffsetMs);
        assert.equal(failedSession.suiteTimerPausedAtMs, beforeFailure.suiteTimerPausedAtMs);
        assert.equal(failedSession.suiteTimerRunning, beforeFailure.suiteTimerRunning);
        const failedWal = failedHarness.sessionStore.peek('simulation');
        const failedDurable = failedHarness.durableSessions.get(failedSession.id);
        assert.deepEqual(failedWal.results, []);
        assert.deepEqual(failedWal.draftsByExam, {});
        assert.deepEqual(failedWal.elapsedByExam, {});
        assert.equal(failedWal.revision, beforeFailure.revision);
        assert.deepEqual(failedDurable.results, []);
        assert.deepEqual(failedDurable.draftsByExam, {});
        assert.deepEqual(failedDurable.elapsedByExam, {});
        assert.equal(failedDurable.revision, beforeFailure.revision);

        failedHarness.controls.saveActiveSession = null;
        const retryOutcome = await failedApp.handleSuitePracticeComplete('p1', failedPayload, failedWindow);
        assert.equal(retryOutcome.committed, true);
        assert.equal(openCount, 2);
        assert.equal(failedSession.results[0].examId, 'p1');
        assert.equal(failedSession.draftsByExam.p1.answers.q1, 'A');
        assert.equal(failedHarness.sessionStore.peek('simulation').results[0].examId, 'p1');
        assert.equal(failedHarness.durableSessions.get(failedSession.id).results[0].examId, 'p1');
    }

    // Drafts may arrive after the child Window exists but before openExam() resolves.
    // The initializing snapshot must bind that exact source and persist the draft.
    const earlyHarness = createHarness();
    const initializingApp = earlyHarness.makeApp();
    let initializingWindow;
    initializingApp.openExam = async () => {
        initializingWindow = { closed: false, name: 'initializing-window' };
        const initializingSession = initializingApp.currentSuiteSession;
        assert.equal(initializingSession.status, 'active');
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
    await resumedApp._suiteRecoveryReady;
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
    assert.equal(await resumedApp.resumeSuitePractice(session.id), true);
    assert.equal(openedOnResume, true);
    assert.equal(sessionStore.peek('simulation').draftsByExam.p2.answers.q2, 'new');

    const missingApp = makeApp();
    missingApp.initializeSuiteMode();
    missingApp._fetchSuiteExamIndex = async () => [sequence[0].exam];
    missingApp.openExam = async () => { throw new Error('must not open missing exam'); };
    const missingSessionId = missingApp.currentSuiteSession.id;
    assert.equal(await missingApp.resumeSuitePractice(missingSessionId), false);
    assert.equal(sessionStore.peek('simulation'), null);

    // Recovery choices are explicitly bound to the candidate id.
    {
        const choiceHarness = createHarness();
        const choiceApp = choiceHarness.makeApp();
        choiceApp.openExam = async () => ({ closed: false, name: 'choice-window' });
        assert.equal(await choiceApp._launchSuiteSessionFromSequence(choiceHarness.sequence, { flowMode: 'simulation' }), true);
        const candidate = await choiceApp.getSuiteRecoveryCandidate();
        assert.equal(candidate.id, choiceApp.currentSuiteSession.id);
        assert.equal(await choiceApp.resumeSuitePractice(), false);
        assert.equal(await choiceApp.abandonSuiteRecovery('wrong-session'), false);
        assert.equal(choiceHarness.durableSessions.has(candidate.id), true);
        assert.equal(await choiceApp.abandonSuiteRecovery(candidate.id), true);
        assert.equal(choiceHarness.durableSessions.has(candidate.id), false);
    }

    // Abandon waits for an in-flight save to finish, then discards it. The ordered
    // save-then-discard sequence leaves no durable entity behind.
    {
        const pendingHarness = createHarness();
        const pendingApp = pendingHarness.makeApp();
        pendingApp.openExam = async () => ({ closed: false, name: 'pending-window' });
        assert.equal(await pendingApp._launchSuiteSessionFromSequence(pendingHarness.sequence, { flowMode: 'simulation' }), true);
        const pendingSession = pendingApp.currentSuiteSession;
        let releaseSave;
        let saveEntered;
        const mutationOrder = [];
        const saveEnteredPromise = new Promise((resolve) => { saveEntered = resolve; });
        const saveReleasePromise = new Promise((resolve) => { releaseSave = resolve; });
        pendingHarness.controls.saveActiveSession = async (value, options, store) => {
            mutationOrder.push('save-start');
            saveEntered();
            await saveReleasePromise;
            store.set(String(value.id), structuredClone(value));
            mutationOrder.push('save-commit');
            return { committed: true };
        };
        pendingHarness.controls.discardActiveSession = async (id, options, store) => {
            mutationOrder.push('discard');
            store.delete(String(id));
            return { committed: true };
        };
        pendingSession.lastUpdate = Date.now();
        const pendingCommit = pendingApp._commitSuiteRecovery(pendingSession, { notify: false });
        await saveEnteredPromise;
        const pendingAbandon = pendingApp.abandonSuiteRecovery(pendingSession.id);
        await Promise.resolve();
        releaseSave();
        assert.equal(await pendingCommit, true);
        assert.equal(await pendingAbandon, true);
        assert.deepEqual(mutationOrder, ['save-start', 'save-commit', 'discard']);
        assert.equal(pendingHarness.durableSessions.has(pendingSession.id), false);
        await Promise.resolve();
        assert.equal(pendingHarness.durableSessions.has(pendingSession.id), false);
    }

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
    finalApp._suiteModeReady = true;
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
    assert.equal(await finalApp.resumeSuitePractice(finalSession.id), true);
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
        _suiteRecoveryClosed: false
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
