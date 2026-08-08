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

function createHarness(options = {}) {
    const sessionStore = createSessionStore();
    const activeSessionStore = new Map();
    const recoveryCalls = {
        save: 0,
        discard: 0,
        cleanup: 0,
        saveQueue: [],
        discardQueue: [],
        discardOptions: [],
        listedItems: null
    };
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
    const protocol = options.protocol === 'file:' ? 'file:' : 'http:';
    const windowStub = {
        location: {
            protocol,
            href: protocol === 'file:' ? 'file:///index.html' : 'http://localhost/'
        },
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
                    const items = Array.isArray(recoveryCalls.listedItems)
                        ? recoveryCalls.listedItems
                        : Array.from(activeSessionStore.values());
                    return items.map((value) => structuredClone(value));
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
    const { sessionStore, activeSessionStore, messages, practiceFinalizes, makeApp, sequence } = createHarness();
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

    const tabOwnedWal = structuredClone(sessionStore.peek('simulation'));
    const tabOwnedDurable = structuredClone(activeSessionStore.get(tabOwnedWal.id));
    assert(tabOwnedDurable, 'fixture must persist the tab-owned suite recovery');

    const emptyHttpTabHarness = createHarness();
    emptyHttpTabHarness.activeSessionStore.set(tabOwnedDurable.id, structuredClone(tabOwnedDurable));
    const emptyHttpTabApp = emptyHttpTabHarness.makeApp();
    emptyHttpTabApp.initializeSuiteMode();
    await emptyHttpTabApp._ensureSuiteRecoveryReady();
    assert.equal(emptyHttpTabApp.currentSuiteSession, null, 'an HTTP tab without WAL evidence must not adopt another tab durable suite');
    assert.equal(emptyHttpTabHarness.activeSessionStore.has(tabOwnedDurable.id), true, 'foreign durable recovery must remain untouched');
    assert.equal(emptyHttpTabHarness.recoveryCalls.discard, 0, 'an HTTP tab must not clean up a foreign durable candidate');

    const mismatchedWalHarness = createHarness();
    const localWalId = 'suite-local-tab-owner';
    mismatchedWalHarness.sessionStore.save('simulation', {
        ...structuredClone(tabOwnedWal),
        id: localWalId,
        revision: 1,
        lastUpdate: Number(tabOwnedWal.lastUpdate) + 1
    });
    mismatchedWalHarness.activeSessionStore.set(tabOwnedDurable.id, structuredClone(tabOwnedDurable));
    const mismatchedWalApp = mismatchedWalHarness.makeApp();
    mismatchedWalApp.initializeSuiteMode();
    await mismatchedWalApp._ensureSuiteRecoveryReady();
    assert.equal(mismatchedWalApp.currentSuiteSession.id, localWalId, 'an HTTP tab must retain its own WAL instead of adopting a different durable id');
    assert.equal(mismatchedWalHarness.activeSessionStore.has(tabOwnedDurable.id), true, 'mismatched foreign durable recovery must not be discarded');
    assert.equal(mismatchedWalHarness.recoveryCalls.discard, 0);

    const matchedWalHarness = createHarness();
    const matchedLocalWal = {
        ...structuredClone(tabOwnedWal),
        currentIndex: 0,
        activeExamId: 'p1',
        revision: 10,
        lastUpdate: 1000
    };
    const matchedDurable = {
        ...structuredClone(tabOwnedDurable),
        currentIndex: 1,
        activeExamId: 'p2',
        revision: 11,
        lastUpdate: 2000
    };
    matchedWalHarness.sessionStore.save('simulation', matchedLocalWal);
    matchedWalHarness.activeSessionStore.set(matchedDurable.id, matchedDurable);
    const matchedWalApp = matchedWalHarness.makeApp();
    matchedWalApp.initializeSuiteMode();
    await matchedWalApp._ensureSuiteRecoveryReady();
    assert.equal(matchedWalApp.currentSuiteSession.id, matchedLocalWal.id);
    assert.equal(matchedWalApp.currentSuiteSession.currentIndex, 1, 'matching HTTP WAL evidence must allow the newer durable snapshot');
    assert.equal(matchedWalApp.currentSuiteSession.activeExamId, 'p2');

    const fileFallbackHarness = createHarness({ protocol: 'file:' });
    fileFallbackHarness.activeSessionStore.set(tabOwnedDurable.id, structuredClone(tabOwnedDurable));
    const fileFallbackApp = fileFallbackHarness.makeApp();
    fileFallbackApp.initializeSuiteMode();
    await fileFallbackApp._ensureSuiteRecoveryReady();
    assert.equal(fileFallbackApp.currentSuiteSession.id, tabOwnedDurable.id, 'file: must retain durable recovery fallback without a window WAL');

    const shadowedSuiteOwnerHarness = createHarness();
    shadowedSuiteOwnerHarness.sessionStore.save('simulation', structuredClone(tabOwnedWal));
    shadowedSuiteOwnerHarness.recoveryCalls.listedItems = [{
        schema: 'foreign-recovery-schema',
        version: 1,
        id: tabOwnedWal.id,
        revision: 0,
        lastUpdate: 3000
    }, {
        ...structuredClone(tabOwnedDurable),
        revision: 9,
        lastUpdate: 4000
    }];
    const shadowedSuiteOwnerApp = shadowedSuiteOwnerHarness.makeApp();
    shadowedSuiteOwnerApp.initializeSuiteMode();
    await shadowedSuiteOwnerApp._ensureSuiteRecoveryReady();
    assert.equal(shadowedSuiteOwnerApp.currentSuiteSession, null, 'a later suite candidate must not bypass another-schema first ownership of the same AppData id');
    assert.equal(shadowedSuiteOwnerHarness.sessionStore.peek('simulation'), null, 'unsafe same-id WAL must be cleared instead of migrated over the first owner');
    assert.equal(shadowedSuiteOwnerHarness.recoveryCalls.save, 0);
    assert.equal(shadowedSuiteOwnerHarness.recoveryCalls.discard, 0);

    const corruptFirstOwnerHarness = createHarness();
    corruptFirstOwnerHarness.sessionStore.save('simulation', structuredClone(tabOwnedWal));
    const corruptFirstOwner = {
        ...structuredClone(tabOwnedDurable),
        status: 'invalid',
        revision: 4,
        lastUpdate: 3000
    };
    const laterValidDuplicate = {
        ...structuredClone(tabOwnedDurable),
        currentIndex: 1,
        activeExamId: 'p2',
        revision: 9,
        lastUpdate: 4000
    };
    corruptFirstOwnerHarness.recoveryCalls.listedItems = [corruptFirstOwner, laterValidDuplicate];
    corruptFirstOwnerHarness.recoveryCalls.saveQueue.push((value, options) => {
        assert.equal(options.expectedEntityRevision, 4, 'repair must CAS against the actual corrupt first owner');
        assert(value.revision >= 5);
        assert.equal(value.activeExamId, tabOwnedWal.activeExamId, 'repair must use this tab WAL, not the later duplicate payload');
        return { committed: true };
    });
    const corruptFirstOwnerApp = corruptFirstOwnerHarness.makeApp();
    corruptFirstOwnerApp.initializeSuiteMode();
    await corruptFirstOwnerApp._ensureSuiteRecoveryReady();
    assert.equal(corruptFirstOwnerApp.currentSuiteSession.id, tabOwnedWal.id);
    assert.equal(corruptFirstOwnerApp.currentSuiteSession.activeExamId, tabOwnedWal.activeExamId);
    assert.notEqual(corruptFirstOwnerApp.currentSuiteSession._suiteRecoveryWritesBlocked, true);
    assert.equal(corruptFirstOwnerHarness.recoveryCalls.discard, 0, 'matching corrupt durable must be repaired without a tombstone');

    const multiSuiteSession = {
        id: 'multi-suite-tab-owner',
        baseExamId: 'listening-multi-tab-owner',
        status: 'active',
        startTime: 1000,
        suiteResults: [],
        expectedSuiteCount: 2,
        metadata: {},
        lastUpdate: 1000,
        revision: 3,
        finalizeOperationId: null,
        finalizeRecord: null
    };
    const multiSuiteWal = {
        schema: 'multi-suite-sessions-v2',
        version: 2,
        sessions: [structuredClone(multiSuiteSession)],
        updatedAt: 1000
    };
    const multiSuiteDurable = {
        ...structuredClone(multiSuiteWal),
        id: multiSuiteSession.id,
        revision: multiSuiteSession.revision
    };

    const emptyMultiHttpHarness = createHarness();
    emptyMultiHttpHarness.activeSessionStore.set(multiSuiteDurable.id, structuredClone(multiSuiteDurable));
    const emptyMultiHttpApp = emptyMultiHttpHarness.makeApp();
    emptyMultiHttpApp.initializeSuiteMode();
    await emptyMultiHttpApp._ensureSuiteRecoveryReady();
    assert.equal(emptyMultiHttpApp.multiSuiteSessionsMap.has(multiSuiteSession.baseExamId), false, 'an HTTP tab without matching multi-suite WAL must ignore foreign durable state');
    assert.equal(emptyMultiHttpHarness.activeSessionStore.has(multiSuiteDurable.id), true);
    const foreignMultiBeforeSubmit = structuredClone(emptyMultiHttpHarness.activeSessionStore.get(multiSuiteDurable.id));
    assert.equal(await emptyMultiHttpApp.handleMultiSuitePracticeComplete(`${multiSuiteSession.baseExamId}_set1`, {
        suiteId: 'set-1',
        totalSuites: 2,
        sessionId: 'new-tab-child-session',
        answers: { q1: 'A' },
        answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
        scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
    }), true);
    const newTabMultiSession = emptyMultiHttpApp.multiSuiteSessionsMap.get(multiSuiteSession.baseExamId);
    assert(newTabMultiSession);
    assert.notEqual(newTabMultiSession.id, multiSuiteDurable.id, 'same-base completion in another tab must create a new durable identity');
    assert.deepEqual(
        emptyMultiHttpHarness.activeSessionStore.get(multiSuiteDurable.id),
        foreignMultiBeforeSubmit,
        'another tab completion must not append to or revise the foreign multi-suite entity'
    );

    const matchedMultiHttpHarness = createHarness();
    matchedMultiHttpHarness.sessionStore.save('multi-suite-practice', structuredClone(multiSuiteWal));
    matchedMultiHttpHarness.activeSessionStore.set(multiSuiteDurable.id, structuredClone(multiSuiteDurable));
    const matchedMultiHttpApp = matchedMultiHttpHarness.makeApp();
    matchedMultiHttpApp.initializeSuiteMode();
    await matchedMultiHttpApp._ensureSuiteRecoveryReady();
    const matchedMultiSession = matchedMultiHttpApp.multiSuiteSessionsMap.get(multiSuiteSession.baseExamId);
    assert(matchedMultiSession, 'matching HTTP multi-suite WAL identity must allow durable recovery');
    assert.equal(matchedMultiSession.id, multiSuiteSession.id);
    assert.equal(matchedMultiSession._lastDurableRecoveryRevision, multiSuiteSession.revision);

    const multiFileFallbackHarness = createHarness({ protocol: 'file:' });
    multiFileFallbackHarness.activeSessionStore.set(multiSuiteDurable.id, structuredClone(multiSuiteDurable));
    const multiFileFallbackApp = multiFileFallbackHarness.makeApp();
    multiFileFallbackApp.initializeSuiteMode();
    await multiFileFallbackApp._ensureSuiteRecoveryReady();
    assert.equal(
        multiFileFallbackApp.multiSuiteSessionsMap.get(multiSuiteSession.baseExamId).id,
        multiSuiteSession.id,
        'file: must retain durable-only multi-suite recovery fallback'
    );

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
    const discardFallbackTimer = setTimeout(() => {}, 60000);
    discardFallbackTimer.unref?.();
    discardFailureSession.submitReceiptTeardownTimer = discardFallbackTimer;
    discardFailureHarness.recoveryCalls.discardQueue.push(false);
    assert.equal(await discardFailureApp.abandonSuiteRecovery(discardFailureSession.id), false);
    assert.equal(discardFailureApp.currentSuiteSession, discardFailureSession, 'discard failure must retain the in-memory suite');
    assert.equal(discardFailureSession.status, 'active', 'discard failure must not mark the suite aborted');
    assert.equal(discardFailureWindow.closed, false, 'discard failure must not close the active question window');
    assert.equal(discardFailureSession.submitReceiptTeardownTimer, discardFallbackTimer, 'discard failure must preserve the fallback teardown timer');
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
    walPreservationHarness.activeSessionStore.set(validWal.id, {
        schema: 'suite-session-v2',
        version: 2,
        id: validWal.id,
        status: 'invalid',
        revision: 4,
        lastUpdate: Number(validWal.lastUpdate) + 1000
    });
    walPreservationHarness.recoveryCalls.saveQueue.push((value, options) => {
        assert.equal(options.expectedEntityRevision, 4, 'invalid durable repair must CAS against the listed entity revision');
        assert(value.revision > 4, 'the repaired snapshot must advance beyond the invalid durable revision');
        return { committed: true };
    });
    const walRestoredApp = walPreservationHarness.makeApp();
    walRestoredApp.initializeSuiteMode();
    await walRestoredApp._ensureSuiteRecoveryReady();
    assert.equal(walRestoredApp.currentSuiteSession.id, validWal.id, 'invalid durable candidates must not erase a valid window WAL');
    assert.equal(walPreservationHarness.sessionStore.peek('simulation').id, validWal.id);
    assert.equal(walPreservationHarness.recoveryCalls.discard, 0, 'matching invalid durable state must be repaired without writing a tombstone');
    assert.equal(walRestoredApp.currentSuiteSession._suiteRecoveryWritesBlocked, undefined);

    const unsafeRevisionHarness = createHarness();
    const unsafeRevisionSource = unsafeRevisionHarness.makeApp();
    unsafeRevisionSource.openExam = async () => ({ closed: false, name: 'unsafe-revision-source' });
    unsafeRevisionSource.initializeSuiteMode();
    await unsafeRevisionSource._ensureSuiteRecoveryReady();
    assert.equal(await unsafeRevisionSource._launchSuiteSessionFromSequence(sequence, { flowMode: 'simulation' }), true);
    const unsafeRevisionWal = unsafeRevisionHarness.sessionStore.peek('simulation');
    unsafeRevisionHarness.activeSessionStore.clear();
    unsafeRevisionHarness.activeSessionStore.set(unsafeRevisionWal.id, {
        schema: 'suite-session-v2',
        version: 2,
        id: unsafeRevisionWal.id,
        status: 'invalid',
        revision: 1.5,
        lastUpdate: Number(unsafeRevisionWal.lastUpdate) + 1000
    });
    unsafeRevisionHarness.recoveryCalls.saveQueue.push((value, options) => {
        assert.equal(options.expectedEntityRevision, 0, 'unsafe durable revisions must normalize to the initial CAS revision');
        assert(value.revision > 0);
        return { committed: true };
    });
    const unsafeRevisionRestoredApp = unsafeRevisionHarness.makeApp();
    unsafeRevisionRestoredApp.initializeSuiteMode();
    await unsafeRevisionRestoredApp._ensureSuiteRecoveryReady();
    assert.equal(unsafeRevisionRestoredApp.currentSuiteSession.id, unsafeRevisionWal.id);
    assert.equal(unsafeRevisionHarness.recoveryCalls.discard, 0);
    assert.notEqual(unsafeRevisionRestoredApp.currentSuiteSession._suiteRecoveryWritesBlocked, true);

    // A structurally valid single-suite entity with an unsafe imported revision must
    // be offered as revision 0, then remain both writable and abandonable under the
    // same safe-integer CAS contract used by AppData.
    for (const [label, unsafeRevision] of [
        ['fractional', 1.5],
        ['infinite', Number.POSITIVE_INFINITY],
        ['unsafe-integer', Number.MAX_SAFE_INTEGER + 1]
    ]) {
        const validUnsafeHarness = createHarness();
        const validUnsafeId = `suite-valid-unsafe-${label}`;
        const validUnsafeSnapshot = {
            ...structuredClone(tabOwnedDurable),
            id: validUnsafeId,
            revision: unsafeRevision,
            lastUpdate: 7000
        };
        validUnsafeHarness.sessionStore.save('simulation', {
            ...structuredClone(validUnsafeSnapshot),
            lastUpdate: 6000
        });
        validUnsafeHarness.activeSessionStore.set(validUnsafeId, structuredClone(validUnsafeSnapshot));
        const validUnsafeApp = validUnsafeHarness.makeApp();
        validUnsafeApp.initializeSuiteMode();
        await validUnsafeApp._ensureSuiteRecoveryReady();
        const restoredUnsafeSession = validUnsafeApp.currentSuiteSession;
        assert.equal(restoredUnsafeSession.id, validUnsafeId);
        assert.equal(restoredUnsafeSession.revision, 0, `${label} runtime revision must normalize to zero`);
        assert.equal(restoredUnsafeSession._lastDurableRecoveryRevision, 0, `${label} durable CAS base must normalize to zero`);

        const observedWrites = [];
        validUnsafeHarness.recoveryCalls.saveQueue.push((value, options) => {
            observedWrites.push({ value, options });
            return { committed: true };
        });
        validUnsafeHarness.recoveryCalls.saveQueue.push((value, options) => {
            observedWrites.push({ value, options });
            return { committed: true };
        });
        assert.equal(await validUnsafeApp._commitSuiteRecovery(restoredUnsafeSession, { notify: false }), true);
        assert.equal(await validUnsafeApp._commitSuiteRecovery(restoredUnsafeSession, { notify: false }), true);
        assert.equal(observedWrites[0].options.expectedEntityRevision, 0);
        assert.equal(observedWrites[0].value.revision, 1);
        assert.equal(observedWrites[1].options.expectedEntityRevision, 1);
        assert.equal(observedWrites[1].value.revision, 2);
        assert.equal(restoredUnsafeSession._lastDurableRecoveryRevision, 2);

        const abandonHarness = createHarness();
        abandonHarness.sessionStore.save('simulation', structuredClone(validUnsafeSnapshot));
        abandonHarness.activeSessionStore.set(validUnsafeId, structuredClone(validUnsafeSnapshot));
        const abandonApp = abandonHarness.makeApp();
        abandonApp.initializeSuiteMode();
        await abandonApp._ensureSuiteRecoveryReady();
        assert.equal(await abandonApp.abandonSuiteRecovery(validUnsafeId), true, `${label} recovery must remain abandonable`);
        assert.equal(abandonHarness.recoveryCalls.discardOptions.at(-1).expectedEntityRevision, 0);
        assert.equal(abandonApp.currentSuiteSession, null);
    }

    const invalidUnsafeFileHarness = createHarness({ protocol: 'file:' });
    invalidUnsafeFileHarness.activeSessionStore.set('suite-invalid-unsafe-file', {
        schema: 'suite-session-v2',
        version: 2,
        id: 'suite-invalid-unsafe-file',
        status: 'invalid',
        revision: Number.POSITIVE_INFINITY,
        lastUpdate: 8000
    });
    const invalidUnsafeFileApp = invalidUnsafeFileHarness.makeApp();
    invalidUnsafeFileApp.initializeSuiteMode();
    await invalidUnsafeFileApp._ensureSuiteRecoveryReady();
    assert.equal(invalidUnsafeFileApp.currentSuiteSession, null);
    assert.equal(invalidUnsafeFileHarness.recoveryCalls.discardOptions[0].expectedEntityRevision, 0);

    const walOrderingHarness = createHarness();
    const walOrderingSource = walOrderingHarness.makeApp();
    walOrderingSource.openExam = async () => ({ closed: false, name: 'wal-ordering-source' });
    walOrderingSource.initializeSuiteMode();
    await walOrderingSource._ensureSuiteRecoveryReady();
    assert.equal(await walOrderingSource._launchSuiteSessionFromSequence(sequence, { flowMode: 'simulation' }), true);
    const orderingBase = walOrderingHarness.sessionStore.peek('simulation');
    const laterTimestampSameRevision = {
        ...structuredClone(orderingBase),
        revision: 10,
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
    walOrderingHarness.sessionStore.save('simulation', laterTimestampSameRevision);
    walOrderingHarness.activeSessionStore.set(orderingBase.id, higherDurableRevision);
    const savesBeforeEqualRevisionRestore = walOrderingHarness.recoveryCalls.save;
    const walOrderingApp = walOrderingHarness.makeApp();
    walOrderingApp.initializeSuiteMode();
    await walOrderingApp._ensureSuiteRecoveryReady();
    assert.equal(walOrderingApp.currentSuiteSession.currentIndex, 1, 'durable recovery must beat a later same-revision WAL branch');
    assert.equal(walOrderingApp.currentSuiteSession.activeExamId, 'p2');
    assert.equal(walOrderingHarness.recoveryCalls.save, savesBeforeEqualRevisionRestore, 'same-revision WAL must not be promoted');

    walOrderingHarness.sessionStore.save('simulation', {
        ...laterTimestampSameRevision,
        revision: 11
    });
    walOrderingHarness.activeSessionStore.set(orderingBase.id, higherDurableRevision);
    walOrderingHarness.recoveryCalls.saveQueue.push((_value, options) => {
        assert.equal(options.expectedEntityRevision, 10);
        walOrderingHarness.activeSessionStore.set(orderingBase.id, {
            ...higherDurableRevision,
            revision: 15
        });
        return { committed: false, code: 'STALE_RECOVERY_WRITE', actualEntityRevision: 15 };
    });
    const failedPromotionApp = walOrderingHarness.makeApp();
    failedPromotionApp.initializeSuiteMode();
    const staleWalSession = failedPromotionApp.currentSuiteSession;
    await failedPromotionApp._ensureSuiteRecoveryReady();
    assert.equal(staleWalSession._suiteRecoveryWritesBlocked, true, 'stale WAL owner must be write-blocked');
    assert.equal(failedPromotionApp.currentSuiteSession.currentIndex, 1, 'failed promotion must fall back to durable progress');
    assert.equal(failedPromotionApp.currentSuiteSession.activeExamId, 'p2');
    assert.equal(failedPromotionApp.currentSuiteSession._lastDurableRecoveryRevision, 10, 'stale receipt must not adopt another tab revision');
    assert.equal(walOrderingHarness.sessionStore.peek('simulation').revision, 10, 'losing WAL must be replaced by the durable snapshot');
    const savesBeforeDurableReload = walOrderingHarness.recoveryCalls.save;
    const durableReloadApp = walOrderingHarness.makeApp();
    durableReloadApp.initializeSuiteMode();
    await durableReloadApp._ensureSuiteRecoveryReady();
    assert.equal(durableReloadApp.currentSuiteSession.activeExamId, 'p2');
    assert.equal(walOrderingHarness.recoveryCalls.save, savesBeforeDurableReload, 'reload must not retry the losing WAL');

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
        windowRef: null,
        windowBinding: {
            examId: 'p3',
            expectedSessionId: 'terminal-window-session',
            windowSessionToken: 'terminal-window-token',
            sessionGeneration: 2
        }
    };
    const finalChild = {
        closed: false,
        postMessage() {},
        close() { this.closed = true; }
    };
    finalApp.currentSuiteSession = finalSession;
    finalApp._resolveSuiteSequenceNumber = async () => 1;
    finalApp._formatSuiteDateLabel = () => '2026-08-07';
    finalApp._updatePracticeRecordsState = async () => {};
    finalApp._postExamMessage = () => true;
    finalApp.refreshOverviewData = () => {};
    let reboundTerminalExamId = '';
    finalApp._tryRebindSuiteWindow = async (_session, entry) => {
        reboundTerminalExamId = entry.examId;
        finalApp.examWindows = new Map([[entry.examId, {
            window: finalChild,
            suiteSessionId: finalSession.id,
            expectedSessionId: finalSession.windowBinding.expectedSessionId,
            windowSessionToken: finalSession.windowBinding.windowSessionToken,
            windowSessionTokenSessionId: finalSession.windowBinding.expectedSessionId,
            sessionGeneration: finalSession.windowBinding.sessionGeneration
        }]]);
        return { window: finalChild };
    };
    assert.equal(await finalApp.resumeSuitePractice(finalSession.id), true);
    committedRecord = practiceFinalizes[0] && practiceFinalizes[0].record;
    assert.equal(practiceFinalizes.length, 1, '终态恢复必须调用 v2 AppData.practice.finalizeSuite');
    assert.equal(practiceFinalizes[0].operationId, 'practice-suite:suite_terminal:finalize');
    assert.equal(practiceFinalizes[0].record.operationId, practiceFinalizes[0].operationId);
    assert.equal(sessionStore.peek('simulation'), null);
    assert.equal(finalSession.status, 'completed');
    assert.equal(reboundTerminalExamId, 'p3', '终态恢复必须按持久 binding 重新绑定存活题页');
    assert.equal(finalChild.closed, true, '终态恢复完成后必须关闭重新绑定的题页');
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
    concurrentApp._suiteModeReady = true;
    let finalizeCalls = 0;
    let releaseFinalizeSave;
    let markFinalizeSaveStarted;
    const finalizeSaveStarted = new Promise((resolve) => { markFinalizeSaveStarted = resolve; });
    const finalizeSaveGate = new Promise((resolve) => { releaseFinalizeSave = resolve; });
    concurrentApp._saveSuitePracticeRecord = async (record) => {
        finalizeCalls += 1;
        markFinalizeSaveStarted();
        await finalizeSaveGate;
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
    const concurrentSubmits = [
        concurrentApp._handleInlineSimulationSuiteSubmit('p1', concurrentPayload, concurrentWindow),
        concurrentApp._handleInlineSimulationSuiteSubmit('p1', concurrentPayload, concurrentWindow)
    ];
    await finalizeSaveStarted;
    assert.equal(await concurrentApp.abandonSuiteRecovery(concurrentSession.id), false, 'live finalize 期间不得承诺放弃成功');
    assert.equal(concurrentApp.currentSuiteSession, concurrentSession, '拒绝放弃时必须保留当前 finalizing session');
    releaseFinalizeSave();
    const concurrentOutcomes = await Promise.all(concurrentSubmits);
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
