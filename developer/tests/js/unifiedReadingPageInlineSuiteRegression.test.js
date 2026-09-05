#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

function loadScript(relativePath, context) {
    const fullPath = path.join(repoRoot, relativePath);
    const code = fs.readFileSync(fullPath, 'utf8');
    vm.runInContext(code, context, { filename: relativePath });
}

function createWindowSessionStub() {
    const store = new Map();
    return {
        save(name, value) {
            store.set(String(name), JSON.parse(JSON.stringify(value)));
            return true;
        },
        get(name) {
            const value = store.get(String(name));
            return value == null ? null : JSON.parse(JSON.stringify(value));
        },
        discard(name) {
            store.delete(String(name));
            return true;
        }
    };
}

function createDocumentStub() {
    const radio = { checked: true, value: 'A' };
    const notes = { value: 'fresh note' };
    const timerClasses = new Set();
    const timer = {
        textContent: '',
        dataset: {},
        style: {},
        classList: {
            add(...names) { names.forEach((name) => timerClasses.add(name)); },
            remove(...names) { names.forEach((name) => timerClasses.delete(name)); },
            toggle(name, enabled) {
                if (enabled) timerClasses.add(name);
                else timerClasses.delete(name);
            },
            contains(name) { return timerClasses.has(name); }
        }
    };
    return {
        __timer: timer,
        body: {
            dataset: {},
            classList: {
                toggle() {}
            }
        },
        querySelector(selector) {
            if (selector === '#notes-panel textarea') {
                return notes;
            }
            return null;
        },
        querySelectorAll(selector) {
            if (selector === 'input[type="checkbox"][name]') {
                return [];
            }
            if (selector === 'input[type="radio"][name="q1"]') {
                return [radio];
            }
            return [];
        },
        getElementById(id) {
            return id === 'timer' ? timer : null;
        },
        addEventListener() {},
        removeEventListener() {}
    };
}

function hostEvent(sourceWindow, type, data, overrides = {}) {
    return {
        source: overrides.source || sourceWindow,
        origin: overrides.origin || 'http://localhost',
        data: { type, source: overrides.envelopeSource || 'exam_host', data }
    };
}

function createContext() {
    const windowSession = createWindowSessionStub();
    const document = createDocumentStub();
    let closeCount = 0;
    const window = {
        location: {
            href: 'http://localhost/assets/generated/reading-exams/reading-practice-unified.html?examId=reading-p1',
            search: '?examId=reading-p1',
            protocol: 'http:'
        },
        history: { replaceState() {} },
        document,
        AppData: {
            ready: Promise.resolve(true),
            recovery: { windowSession }
        },
        opener: null,
        parent: null,
        addEventListener() {},
        removeEventListener() {},
        scrollTo() {},
        scrollY: 0,
        close() { closeCount += 1; },
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        URL,
        URLSearchParams,
        Date,
        Math,
        JSON,
        Array,
        Object,
        Map,
        Set,
        Promise,
        String,
        Number,
        Boolean,
        HTMLElement: function HTMLElement() {},
        HTMLInputElement: function HTMLInputElement() {},
        HTMLTextAreaElement: function HTMLTextAreaElement() {},
        HTMLSelectElement: function HTMLSelectElement() {}
    };
    window.parent = window;
    const sandbox = {
        window,
        globalThis: window,
        document,
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        URL,
        URLSearchParams,
        Date,
        Math,
        JSON,
        Array,
        Object,
        Map,
        Set,
        Promise,
        String,
        Number,
        Boolean,
        HTMLElement: window.HTMLElement,
        HTMLInputElement: window.HTMLInputElement,
        HTMLTextAreaElement: window.HTMLTextAreaElement,
        HTMLSelectElement: window.HTMLSelectElement,
        location: window.location
    };
    sandbox.globalThis = window;
    return {
        context: vm.createContext(sandbox),
        window,
        document,
        windowSession,
        getCloseCount: () => closeCount
    };
}

function loadHooks() {
    const { context, window, document, windowSession, getCloseCount } = createContext();
    window.__IELTS_READING_PAGE_TEST_HOOKS__ = true;
    window.__READING_EXAM_MANIFEST__ = {};
    window.__READING_EXAM_DATA__ = new Map();
    loadScript('js/runtime/unifiedReadingPage.js', context);
    const hooks = window.__IELTS_UNIFIED_READING_PAGE_TEST__;
    assert(hooks, 'should expose unified reading page test hooks');
    return { hooks, window, document, windowSession, getCloseCount };
}

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

async function testDraftArbitration() {
    const { hooks } = loadHooks();

    const stale = hooks.mergeDraft(
        { answers: { q1: 'NEW' }, highlights: [{ id: 'new' }], noteText: 'new', scrollY: 9, updatedAt: 3000 },
        { answers: { q1: 'OLD' }, highlights: [{ id: 'old' }], noteText: 'old', scrollY: 1, updatedAt: 1000 }
    );
    assert.deepStrictEqual(plain(stale.answers), { q1: 'NEW' }, 'older draft must not overwrite answers');
    assert.strictEqual(stale.noteText, 'new', 'older draft must not overwrite noteText');
    assert.deepStrictEqual(plain(stale.highlights), [{ id: 'new' }], 'older draft must not overwrite highlights');
    assert.strictEqual(stale.scrollY, 9, 'older draft must not overwrite scrollY');
    assert.strictEqual(stale.updatedAt, 3000, 'older draft must not replace updatedAt');

    const fresh = hooks.mergeDraft(
        { answers: { q1: 'OLD' }, highlights: [{ id: 'old' }], noteText: 'old', scrollY: 1, updatedAt: 1000 },
        { answers: { q1: 'NEW' }, highlights: [{ id: 'new' }], noteText: 'new', scrollY: 9, updatedAt: 3000 }
    );
    assert.deepStrictEqual(plain(fresh.answers), { q1: 'NEW' }, 'newer draft must win answers');
    assert.strictEqual(fresh.noteText, 'new', 'newer draft must win noteText');
    assert.deepStrictEqual(plain(fresh.highlights), [{ id: 'new' }], 'newer draft must win highlights');
    assert.strictEqual(fresh.scrollY, 9, 'newer draft must win scrollY');
    assert.strictEqual(fresh.updatedAt, 3000, 'newer draft must win updatedAt');
}

async function testSuiteTimerModePrecedence() {
    const { hooks, document } = loadHooks();
    const pausedAtMs = Date.now();
    hooks.setTestState({
        suiteSessionId: 'suite-timer',
        suiteTimerMode: 'elapsed',
        suiteTimerLimitSeconds: 60,
        suiteTimerAnchorMs: pausedAtMs - 120000,
        pagePausedAtMs: pausedAtMs,
        pagePausedOffsetMs: 0
    });
    hooks.renderTimer();
    assert.strictEqual(document.__timer.textContent, '02:00', 'elapsed 套题必须显示正计时');
    assert.strictEqual(document.__timer.dataset.timerMode, 'elapsed');
    assert.strictEqual(document.__timer.classList.contains('timer-expired'), false, 'elapsed 套题不得按 limit 触发倒计时过期');

    hooks.setTestState({
        suiteTimerMode: 'countdown',
        suiteTimerLimitSeconds: 3600
    });
    hooks.renderTimer();
    assert.strictEqual(document.__timer.textContent, '58 minutes remaining');
    assert.strictEqual(document.__timer.dataset.timerMode, 'countdown');
}

async function testInlinePartTimingAccumulatesMillisecondsAndFreezesSubmissionRows() {
    const { hooks } = loadHooks();
    const startedAtMs = 1000000;
    const dataset = {
        meta: { title: 'Timed Part' },
        questionOrder: ['q1'],
        answerKey: { q1: 'A' },
        questionGroups: []
    };
    const results = hooks.buildResultsFromAnswers(dataset, { q1: 'A' });
    hooks.setTestState({
        dataset,
        suite: {
            inline: true,
            activeExamId: 'timed-part',
            activeStartedAtMs: startedAtMs,
            sequence: [{ examId: 'timed-part', title: 'Timed Part' }],
            slotsByExamId: new Map([['timed-part', {
                examId: 'timed-part',
                title: 'Timed Part',
                dataset,
                durationMs: 0,
                durationSeconds: 0,
                lastResults: results
            }]])
        }
    });

    for (let tick = 1; tick <= 50; tick += 1) {
        hooks.checkpointActiveSuiteDuration(startedAtMs + tick * 1200, true);
    }
    let slot = hooks.getTestState().slotsByExamId[0][1];
    assert.strictEqual(slot.durationMs, 60000, 'fifty 1.2-second checkpoints must retain the full minute');
    assert.strictEqual(slot.durationSeconds, 60, 'part duration should round only after millisecond accumulation');

    hooks.checkpointActiveSuiteDuration(startedAtMs + 50 * 1200 + 500, false);
    const pausedDurationMs = hooks.getTestState().slotsByExamId[0][1].durationMs;
    hooks.checkpointActiveSuiteDuration(startedAtMs + 70 * 1200, false);
    slot = hooks.getTestState().slotsByExamId[0][1];
    assert.strictEqual(slot.durationMs, pausedDurationMs, 'paused time must not accrue into the active part');
}

async function testInlineSubmissionCheckpointsActiveQuestionTiming() {
    const { hooks } = loadHooks();
    const dataset = {
        meta: { title: 'Timed Submission Part' },
        questionOrder: ['q1'],
        answerKey: { q1: 'A' },
        questionGroups: [{ kind: 'short_answer', questionIds: ['q1'] }]
    };
    const slot = {
        examId: 'timed-submit-part',
        title: 'Timed Submission Part',
        category: 'P1',
        dataset,
        draft: { answers: { q1: 'A' }, updatedAt: Date.now() - 5000 },
        questionTimeSpentMs: {},
        durationMs: 0,
        durationSeconds: 0,
        navStatus: new Map()
    };
    hooks.setTestState({
        dataset,
        currentActiveQuestionId: 'q1',
        questionTimingStartedAtMs: Date.now() - 5000,
        readOnly: false,
        reviewMode: false,
        submitted: false,
        suite: {
            inline: true,
            activeExamId: 'timed-submit-part',
            activeStartedAtMs: Date.now() - 5000,
            sequence: [{ examId: 'timed-submit-part', title: 'Timed Submission Part', category: 'P1' }],
            slotsByExamId: new Map([['timed-submit-part', slot]])
        }
    });
    hooks.setTestInteraction({ timerRunning: true });

    const snapshot = hooks.buildInlineSuiteSubmissionSnapshot();
    const performance = snapshot.suiteEntries[0].questionTypePerformance['short-answer'];
    assert(performance, 'inline suite submission should include active question type performance');
    assert(performance.timeSpent >= 4.5, 'running active-question time must be checkpointed before suite scoring');
    assert(snapshot.results.questionTypePerformance['short-answer'].timeSpent >= 4.5);
}

async function testInlineEnvelopeGuard() {
    const { hooks } = loadHooks();

    hooks.setTestState({
        examId: 'reading-p2',
        sessionId: 'session-new',
        suiteSessionId: 'suite-new',
        sessionReadySent: true,
        suite: {
            inline: true,
            activeExamId: 'reading-p2',
            currentIndex: 1,
            sequence: [
                { examId: 'reading-p1' },
                { examId: 'reading-p2' },
                { examId: 'reading-p3' }
            ],
            slotsByExamId: new Map()
        }
    });

    assert.strictEqual(
        hooks.shouldIgnoreInlineSuiteEnvelope({
            examId: 'reading-p1',
            sessionId: 'session-old',
            suiteSessionId: 'suite-old'
        }),
        true,
        'late INIT/SIMULATION payload for another exam must be ignored'
    );

    assert.strictEqual(
        hooks.shouldIgnoreInlineSuiteEnvelope({
            examId: 'reading-p2',
            sessionId: 'session-old',
            suiteSessionId: 'suite-new'
        }),
        true,
        'late payload with stale sessionId must be ignored once ready'
    );

    assert.strictEqual(
        hooks.shouldIgnoreInlineSuiteEnvelope({
            examId: 'reading-p2',
            sessionId: 'session-new',
            suiteSessionId: 'suite-new'
        }),
        false,
        'current payload must still be accepted'
    );
}

async function testInlineReinitSnapshot() {
    const { hooks, windowSession, window } = loadHooks();

    hooks.setTestState({
        examId: 'reading-p1',
        dataKey: 'reading-p1',
        sessionId: 'session-1',
        suiteSessionId: 'suite-1',
        simulationMode: true,
        simulationContextReady: true,
        simulationDraftFingerprint: '',
        lastResults: null,
        suite: {
            inline: true,
            activeExamId: 'reading-p1',
            currentIndex: 0,
            activeStartedAtMs: Date.now() - 5000,
            sequence: [{ examId: 'reading-p1' }],
            slotsByExamId: new Map([
                ['reading-p1', {
                    examId: 'reading-p1',
                    dataKey: 'reading-p1',
                    dataset: { meta: { title: 'P1' } },
                    draft: {
                        answers: { q1: 'OLD' },
                        highlights: [],
                        noteText: 'old note',
                        scrollY: 1,
                        updatedAt: 1000
                    },
                    navStatus: new Map(),
                    lastResults: null,
                    durationSeconds: 0
                }]
            ])
        },
        dataset: { meta: { title: 'P1' }, questionOrder: ['q1'] }
    });

    window.scrollY = 321;

    const draft = hooks.captureInlineSuiteDraftBeforeReinit('reinit');
    assert(draft, 'reinit snapshot should produce a draft');
    assert.deepStrictEqual(plain(draft.answers), { q1: 'A' }, 'current answer must be captured before reinit');
    assert.strictEqual(draft.noteText, 'fresh note', 'current note must be captured before reinit');
    assert.strictEqual(draft.scrollY, 321, 'current scroll position must be captured before reinit');
    assert(draft.updatedAt >= 1000, 'captured draft must carry a fresh updatedAt');

    const state = hooks.getTestState();
    const slotEntry = state.slotsByExamId.find(([examId]) => examId === 'reading-p1');
    assert(slotEntry, 'slot should still exist after snapshot');
    assert.deepStrictEqual(plain(slotEntry[1].draft.answers), { q1: 'A' }, 'slot draft must be updated before reinit');
    assert.strictEqual(slotEntry[1].draft.noteText, 'fresh note', 'slot draft noteText must be updated before reinit');

    const stored = windowSession.get('simulation-draft:suite-1:reading-p1');
    assert(stored, 'reinit snapshot must persist the window-session draft');
    assert.deepStrictEqual(plain(stored.draft.answers), { q1: 'A' }, 'persisted mirror must use the captured draft');
}

async function testWindowSessionMessageGuard() {
    const { hooks } = loadHooks();
    const sourceWindow = { name: 'suite-host' };

    hooks.setTestState({
        examId: 'reading-p2',
        sessionId: 'session-new',
        suiteSessionId: 'suite-new',
        parentWindow: sourceWindow,
        expectedParentOrigin: 'http://localhost',
        parentOrigin: 'http://localhost',
        parentOriginIsOpaque: false,
        windowSessionToken: 'token-new',
        windowSessionIssuedAtMs: 5000,
        windowSessionGeneration: 2,
        lastInitSignature: '',
        simulationCtx: { examId: 'reading-p2', flowMode: 'simulation', currentIndex: 1 },
        suite: {
            inline: true,
            activeExamId: 'reading-p2',
            currentIndex: 1,
            sequence: [
                { examId: 'reading-p1' },
                { examId: 'reading-p2' },
                { examId: 'reading-p3' }
            ],
            slotsByExamId: new Map()
        }
    });

    await hooks.handleIncoming(hostEvent(sourceWindow, 'INIT_SESSION', {
                examId: 'reading-p2',
                sessionId: 'session-new',
                suiteSessionId: 'suite-new',
                windowSessionToken: 'token-old',
                windowSessionGeneration: 1,
                messageIssuedAtMs: 4000,
                parentOrigin: 'http://localhost'
    }));

    let state = hooks.getTestState();
    assert.strictEqual(state.lastInitSignature, '', 'stale INIT_SESSION must not overwrite current inline session');
    assert.strictEqual(state.windowSessionToken, 'token-new', 'stale INIT_SESSION must not replace window token');

    await hooks.handleIncoming(hostEvent(sourceWindow, 'SIMULATION_CONTEXT', {
                examId: 'reading-p2',
                sessionId: 'session-new',
                suiteSessionId: 'suite-new',
                flowMode: 'simulation',
                currentIndex: 0,
                total: 3,
                windowSessionToken: 'token-old',
                windowSessionGeneration: 1,
                messageIssuedAtMs: 4000,
                suiteSequence: [
                    { examId: 'reading-p1' },
                    { examId: 'reading-p2' },
                    { examId: 'reading-p3' }
                ]
    }));

    state = hooks.getTestState();
    assert.strictEqual(state.simulationCtx.currentIndex, 1, 'stale SIMULATION_CONTEXT must not replace active simulation context');

    await hooks.handleIncoming(hostEvent(sourceWindow, 'INIT_SESSION', {
                examId: 'reading-p2',
                sessionId: 'session-newer',
                suiteSessionId: 'suite-new',
                windowSessionToken: 'token-newer',
                windowSessionGeneration: 3,
                messageIssuedAtMs: 6000,
                parentOrigin: 'http://localhost'
    }));

    state = hooks.getTestState();
    assert.strictEqual(state.sessionId, 'session-newer', 'newer INIT_SESSION must still be accepted');
    assert.strictEqual(state.windowSessionToken, 'token-newer', 'newer INIT_SESSION must adopt the latest window token');

    assert.strictEqual(
        hooks.shouldAcceptWindowSessionMessage({
            windowSessionToken: 'token-same-ms-old',
            windowSessionGeneration: 3,
            messageIssuedAtMs: 6000
        }, sourceWindow),
        false,
        '同一注册代际的旧 token 即使时间戳相同也必须拒绝'
    );
    assert.strictEqual(
        hooks.shouldAcceptWindowSessionMessage({
            windowSessionToken: 'token-next-generation',
            windowSessionGeneration: 4,
            messageIssuedAtMs: 6000
        }, sourceWindow),
        true,
        '更高注册代际必须覆盖旧 token'
    );
    hooks.setTestState({
        windowSessionToken: 'token-current-no-generation',
        windowSessionIssuedAtMs: 6000,
        windowSessionGeneration: 0
    });
    assert.strictEqual(
        hooks.shouldAcceptWindowSessionMessage({
            windowSessionToken: 'token-equal-ms-no-generation',
            messageIssuedAtMs: 6000
        }, sourceWindow),
        false,
        '缺少注册代际且时间戳相等的不同 token 必须拒绝'
    );
    hooks.stopReadingDraftSync();
    hooks.stopSimulationDraftSync();
}

async function testReferrerlessInitBindsOnlyTrustedHost() {
    const { hooks } = loadHooks();
    const parentWindow = { postMessage() {} };
    hooks.setTestState({
        examId: 'reading-p1',
        sessionId: null,
        suiteSessionId: null,
        parentWindow,
        expectedParentOrigin: '',
        parentOrigin: '',
        parentOriginIsOpaque: false,
        windowSessionToken: '',
        lastInitSignature: ''
    });
    const initData = {
        examId: 'reading-p1',
        sessionId: 'referrerless-session',
        parentOrigin: 'https://host.example',
        windowSessionToken: 'referrerless-token'
    };
    await hooks.handleIncoming(hostEvent({ postMessage() {} }, 'INIT_SESSION', initData, { origin: 'https://host.example' }));
    assert.strictEqual(hooks.getTestState().parentOrigin, '', 'a forged source must not bind a referrerless child');
    await hooks.handleIncoming(hostEvent(parentWindow, 'INIT_SESSION', initData, { origin: 'https://attacker.invalid' }));
    assert.strictEqual(hooks.getTestState().parentOrigin, '', 'a mismatched origin must not bind a referrerless child');
    await hooks.handleIncoming(hostEvent(parentWindow, 'INIT_SESSION', initData, { origin: 'https://host.example' }));
    assert.strictEqual(hooks.getTestState().parentOrigin, 'https://host.example', 'trusted non-opaque INIT must bind the missing referrer origin');
    assert.strictEqual(hooks.getTestState().windowSessionToken, 'referrerless-token');

    const fileHarness = loadHooks();
    const fileParent = { postMessage() {} };
    fileHarness.window.location.protocol = 'file:';
    fileHarness.hooks.setTestState({
        examId: 'reading-p1',
        sessionId: null,
        suiteSessionId: null,
        parentWindow: fileParent,
        expectedParentOrigin: '',
        parentOrigin: '',
        parentOriginIsOpaque: false,
        windowSessionToken: '',
        lastInitSignature: ''
    });
    await fileHarness.hooks.handleIncoming(hostEvent(fileParent, 'INIT_SESSION', {
        examId: 'reading-p1',
        sessionId: 'file-session',
        parentOrigin: 'file://',
        windowSessionToken: 'file-token'
    }, { origin: 'file://' }));
    assert.strictEqual(fileHarness.hooks.getTestState().parentOrigin, 'null',
        'file:// opener INIT must bind the opaque origin');
    assert.strictEqual(fileHarness.hooks.getTestState().parentOriginIsOpaque, true);
    assert.strictEqual(fileHarness.hooks.getTestState().windowSessionToken, 'file-token');
}

async function testSavedRecordAcknowledgementSessionGate() {
    const { hooks } = loadHooks();
    const sourceWindow = { name: 'saved-record-host' };
    hooks.setTestState({
        examId: 'reading-p1',
        sessionId: 'session-current',
        submittedRecordId: 'record-existing',
        parentWindow: sourceWindow,
        expectedParentOrigin: 'http://localhost',
        parentOrigin: 'http://localhost',
        parentOriginIsOpaque: false,
        windowSessionToken: 'token-current',
        suite: {
            inline: false,
            slotsByExamId: new Map()
        }
    });

    await hooks.handleIncoming(hostEvent(sourceWindow, 'PRACTICE_RECORD_SAVED', {
                examId: 'reading-p1',
                sessionId: 'session-stale',
                recordId: 'record-stale',
                windowSessionToken: 'token-current'
    }));
    assert.strictEqual(
        hooks.getTestState().submittedRecordId,
        'record-existing',
        'a late acknowledgement from an older session must be ignored'
    );

    await hooks.handleIncoming(hostEvent(sourceWindow, 'PRACTICE_RECORD_SAVED', {
                examId: 'reading-p1',
                recordId: 'record-without-session',
                windowSessionToken: 'token-current'
    }));
    assert.strictEqual(
        hooks.getTestState().submittedRecordId,
        'record-existing',
        'an acknowledgement without a session binding must be ignored'
    );

    const validAcknowledgement = {
        examId: 'reading-p1',
        sessionId: 'session-current',
        recordId: 'record-current',
        windowSessionToken: 'token-current'
    };
    await hooks.handleIncoming(hostEvent(
        sourceWindow,
        'PRACTICE_RECORD_SAVED',
        validAcknowledgement,
        { origin: 'https://attacker.invalid' }
    ));
    await hooks.handleIncoming(hostEvent(
        sourceWindow,
        'PRACTICE_RECORD_SAVED',
        validAcknowledgement,
        { source: { name: sourceWindow.name } }
    ));
    await hooks.handleIncoming(hostEvent(
        sourceWindow,
        'PRACTICE_RECORD_SAVED',
        validAcknowledgement,
        { envelopeSource: 'practice_page' }
    ));
    await hooks.handleIncoming(hostEvent(sourceWindow, 'PRACTICE_RECORD_SAVED', {
        ...validAcknowledgement,
        windowSessionToken: 'token-forged'
    }));
    assert.strictEqual(
        hooks.getTestState().submittedRecordId,
        'record-existing',
        'wrong origin/window/source/token must not overwrite the saved record binding'
    );

    await hooks.handleIncoming(hostEvent(sourceWindow, 'PRACTICE_RECORD_SAVED', {
                ...validAcknowledgement
    }));
    assert.strictEqual(
        hooks.getTestState().submittedRecordId,
        'record-current',
        'the current session acknowledgement should bind its saved record id'
    );

    hooks.setTestState({ sessionId: null });
    await hooks.handleIncoming(hostEvent(sourceWindow, 'PRACTICE_RECORD_SAVED', {
                examId: 'reading-p1',
                sessionId: 'session-current',
                recordId: 'record-during-restart',
                windowSessionToken: 'token-current'
    }));
    assert.strictEqual(
        hooks.getTestState().submittedRecordId,
        'record-current',
        'an acknowledgement received during session restart must be ignored'
    );
}

async function testSubmitAcknowledgementStateMachine() {
    const falseHarness = loadHooks();
    falseHarness.hooks.setTestState({
        examId: 'reading-p1',
        sessionId: 'session-submit-false',
        parentWindow: { postMessage() { return false; } },
        expectedParentOrigin: 'http://localhost',
        parentOrigin: 'http://localhost',
        parentOriginIsOpaque: false,
        windowSessionToken: 'token-submit-false',
        submissionStatus: 'draft',
        submissionId: ''
    });
    assert.strictEqual(falseHarness.hooks.beginSubmission('PRACTICE_COMPLETE', {}), false);
    assert.strictEqual(falseHarness.hooks.getTestState().submissionStatus, 'draft');
    assert.strictEqual(falseHarness.hooks.getTestState().readOnly, false);

    const failedHarness = loadHooks();
    const throwingParent = {
        postMessage() {
            throw new Error('delivery failed');
        }
    };
    failedHarness.hooks.setTestState({
        examId: 'reading-p1',
        sessionId: 'session-submit-failed',
        parentWindow: throwingParent,
        expectedParentOrigin: 'http://localhost',
        parentOrigin: 'http://localhost',
        parentOriginIsOpaque: false,
        windowSessionToken: 'token-submit-failed',
        submissionStatus: 'draft',
        submissionId: ''
    });
    assert.strictEqual(
        failedHarness.hooks.beginSubmission('PRACTICE_COMPLETE', { answers: { q1: 'A' } }),
        false,
        'a synchronous postMessage failure must reject the submission attempt'
    );
    assert.strictEqual(failedHarness.hooks.getTestState().submissionStatus, 'draft');
    assert.strictEqual(failedHarness.hooks.getTestState().readOnly, false);

    const delivered = [];
    const sourceWindow = {
        postMessage(message) {
            delivered.push(message);
        }
    };
    const { hooks, getCloseCount } = loadHooks();
    hooks.setTestState({
        examId: 'reading-p1',
        sessionId: 'session-submit-current',
        suiteSessionId: null,
        parentWindow: sourceWindow,
        expectedParentOrigin: 'http://localhost',
        parentOrigin: 'http://localhost',
        parentOriginIsOpaque: false,
        windowSessionToken: 'token-submit-current',
        submissionStatus: 'draft',
        submissionId: ''
    });

    assert.strictEqual(hooks.beginSubmission('PRACTICE_COMPLETE', { answers: { q1: 'A' } }), true);
    let state = hooks.getTestState();
    const submissionId = state.submissionId;
    assert.strictEqual(state.submissionStatus, 'submitting');
    assert.strictEqual(state.submitted, false, 'delivery alone must not mark the page submitted');
    assert.strictEqual(state.readOnly, false, 'delivery alone must not lock the page');
    assert.strictEqual(delivered.length, 1);
    assert.strictEqual(delivered[0].data.submissionId, submissionId);
    assert.strictEqual(
        hooks.beginSubmission('PRACTICE_COMPLETE', { answers: { q1: 'A' } }),
        false,
        'a duplicate click while submitting must be ignored'
    );
    assert.strictEqual(delivered.length, 1, 'duplicate clicks must not emit a second message');

    await hooks.handleIncoming(hostEvent(sourceWindow, 'PRACTICE_SUBMIT_ACK', {
        sessionId: 'session-submit-current',
        submissionId,
        windowSessionToken: 'token-submit-current'
    }));
    assert.strictEqual(hooks.getTestState().submissionStatus, 'submitting', 'ACK without examId must be ignored');

    await hooks.handleIncoming(hostEvent(sourceWindow, 'PRACTICE_SUBMIT_FAILED', {
        examId: 'reading-p1',
        sessionId: 'session-submit-current',
        submissionId,
        windowSessionToken: 'token-submit-current'
    }));
    state = hooks.getTestState();
    assert.strictEqual(state.submissionStatus, 'draft');
    assert.strictEqual(state.readOnly, false);
    await hooks.handleIncoming(hostEvent(sourceWindow, 'PRACTICE_SUBMIT_ACK', {
        examId: 'reading-p1',
        sessionId: 'session-submit-current',
        submissionId,
        windowSessionToken: 'token-submit-current'
    }));
    assert.strictEqual(hooks.getTestState().submissionStatus, 'draft', 'late ACK after NACK must not submit the page');
    assert.strictEqual(hooks.getTestState().readOnly, false);

    assert.strictEqual(hooks.beginSubmission('PRACTICE_COMPLETE', { answers: { q1: 'A' } }), true);
    assert.strictEqual(delivered.length, 2);
    assert.strictEqual(delivered[1].data.submissionId, submissionId, 'retry must reuse the idempotency key');

    await hooks.handleIncoming(hostEvent(sourceWindow, 'PRACTICE_SUBMIT_ACK', {
        examId: 'reading-p1',
        sessionId: 'session-submit-current',
        submissionId,
        windowSessionToken: 'token-submit-current'
    }));
    state = hooks.getTestState();
    assert.strictEqual(state.submissionStatus, 'submitted');
    assert.strictEqual(state.submitted, true);
    assert.strictEqual(state.readOnly, true, 'only a valid ACK may lock the page');
    assert.strictEqual(getCloseCount(), 0, 'a single-passage ACK must keep its result page open');

    const suiteHarness = loadHooks();
    const suiteParent = { postMessage() {} };
    const finalPresentation = {
        results: {
            answerComparison: {},
            scoreInfo: { correct: 0, totalQuestions: 0, percentage: 0 }
        },
        highlights: []
    };
    suiteHarness.hooks.setTestOverride('renderExplanations', () => Promise.resolve());
    suiteHarness.hooks.setTestState({
        examId: 'reading-p3',
        sessionId: 'session-suite-final',
        suiteSessionId: 'suite-final',
        parentWindow: suiteParent,
        expectedParentOrigin: 'http://localhost',
        parentOrigin: 'http://localhost',
        parentOriginIsOpaque: false,
        windowSessionToken: 'token-suite-final',
        windowSessionGeneration: 1,
        simulationMode: true,
        simulationCtx: { isLast: true },
        submissionStatus: 'draft',
        submissionId: ''
    });
    assert.strictEqual(suiteHarness.hooks.beginSubmission('SIMULATION_SUBMIT', {
        suiteSessionId: 'suite-final'
    }, finalPresentation), true);
    const suiteSubmissionId = suiteHarness.hooks.getTestState().submissionId;
    assert.strictEqual(suiteHarness.getCloseCount(), 0, 'sending the final result must not close before an ACK');
    await suiteHarness.hooks.handleIncoming(hostEvent(suiteParent, 'PRACTICE_SUBMIT_FAILED', {
        examId: 'reading-p3',
        sessionId: 'session-suite-final',
        suiteSessionId: 'suite-final',
        submissionId: suiteSubmissionId,
        windowSessionToken: 'token-suite-final'
    }));
    assert.strictEqual(suiteHarness.getCloseCount(), 0, 'a persistence NACK must keep the final child open for retry');
    assert.strictEqual(suiteHarness.hooks.getTestState().submissionStatus, 'draft');
    assert.strictEqual(suiteHarness.hooks.beginSubmission('SIMULATION_SUBMIT', {
        suiteSessionId: 'suite-final'
    }, finalPresentation), true);
    assert.strictEqual(
        suiteHarness.hooks.getTestState().submissionId,
        suiteSubmissionId,
        'the persistence retry must retain its idempotency key'
    );
    await suiteHarness.hooks.handleIncoming(hostEvent(suiteParent, 'PRACTICE_SUBMIT_ACK', {
        examId: 'reading-p3',
        sessionId: 'session-suite-final',
        suiteSessionId: 'suite-final',
        submissionId: suiteSubmissionId,
        windowSessionToken: 'token-suite-final'
    }));
    assert.strictEqual(suiteHarness.getCloseCount(), 1, 'the final suite child must close after its valid ACK');

    const lateHarness = loadHooks();
    const lateParent = { postMessage() {} };
    const nextDraftName = 'simulation-draft:suite-next:reading-p3';
    lateHarness.hooks.setTestState({
        examId: 'reading-p3',
        sessionId: 'session-suite-old',
        suiteSessionId: 'suite-old',
        parentWindow: lateParent,
        expectedParentOrigin: 'http://localhost',
        parentOrigin: 'http://localhost',
        parentOriginIsOpaque: false,
        windowSessionToken: 'token-suite-old',
        windowSessionGeneration: 1,
        windowSessionIssuedAtMs: 1000,
        simulationMode: true,
        simulationCtx: { isLast: true },
        submissionStatus: 'draft',
        submissionId: ''
    });
    lateHarness.hooks.setTestOverride('renderExplanations', () => Promise.resolve().then(async () => {
        await lateHarness.hooks.handleIncoming(hostEvent(lateParent, 'INIT_SESSION', {
            examId: 'reading-p3',
            sessionId: 'session-suite-next',
            suiteSessionId: 'suite-next',
            parentOrigin: 'http://localhost',
            windowSessionToken: 'token-suite-next',
            windowSessionGeneration: 2,
            messageIssuedAtMs: 2000
        }));
        lateHarness.windowSession.save(nextDraftName, {
            draft: { answers: { q1: 'new-session-answer' } },
            updatedAt: 2000
        });
    }));
    assert.strictEqual(lateHarness.hooks.beginSubmission('SIMULATION_SUBMIT', {
        suiteSessionId: 'suite-old'
    }, finalPresentation), true);
    const lateSubmissionId = lateHarness.hooks.getTestState().submissionId;
    await lateHarness.hooks.handleIncoming(hostEvent(lateParent, 'PRACTICE_SUBMIT_ACK', {
        examId: 'reading-p3',
        sessionId: 'session-suite-old',
        suiteSessionId: 'suite-old',
        submissionId: lateSubmissionId,
        windowSessionToken: 'token-suite-old'
    }));
    const lateState = lateHarness.hooks.getTestState();
    assert.strictEqual(lateState.sessionId, 'session-suite-next', 'the queued INIT must install the new session');
    assert.strictEqual(lateState.suiteSessionId, 'suite-next', 'the queued INIT must install the new suite binding');
    assert.strictEqual(lateState.windowSessionToken, 'token-suite-next', 'the queued INIT must install the new registration');
    assert(lateHarness.windowSession.get(nextDraftName), 'the stale ACK continuation must not clear the new session draft');
    assert.strictEqual(lateHarness.getCloseCount(), 0, 'the stale ACK continuation must not close the new registration');

    const timeoutHarness = loadHooks();
    const timeoutParent = { postMessage() {} };
    timeoutHarness.hooks.setTestState({
        examId: 'reading-p1',
        sessionId: 'session-submit-timeout',
        parentWindow: timeoutParent,
        expectedParentOrigin: 'http://localhost',
        parentOrigin: 'http://localhost',
        parentOriginIsOpaque: false,
        windowSessionToken: 'token-submit-timeout',
        submissionStatus: 'draft',
        submissionId: ''
    });
    assert.strictEqual(timeoutHarness.hooks.beginSubmission('PRACTICE_COMPLETE', {}), true);
    const timeoutSubmissionId = timeoutHarness.hooks.getTestState().submissionId;
    assert.strictEqual(timeoutHarness.hooks.expirePendingSubmission(timeoutSubmissionId), true);
    assert.strictEqual(timeoutHarness.hooks.getTestState().submissionStatus, 'draft');
    assert.strictEqual(timeoutHarness.hooks.getTestState().readOnly, false);
    await timeoutHarness.hooks.handleIncoming(hostEvent(timeoutParent, 'PRACTICE_SUBMIT_ACK', {
        examId: 'reading-p1',
        sessionId: 'session-submit-timeout',
        submissionId: timeoutSubmissionId,
        windowSessionToken: 'token-submit-timeout'
    }));
    assert.strictEqual(timeoutHarness.hooks.getTestState().submissionStatus, 'draft', 'late ACK after timeout must be ignored');
    assert.strictEqual(timeoutHarness.hooks.getTestState().readOnly, false);
}

async function main() {
    await testDraftArbitration();
    await testSuiteTimerModePrecedence();
    await testInlinePartTimingAccumulatesMillisecondsAndFreezesSubmissionRows();
    await testInlineSubmissionCheckpointsActiveQuestionTiming();
    await testInlineEnvelopeGuard();
    await testInlineReinitSnapshot();
    await testWindowSessionMessageGuard();
    await testReferrerlessInitBindsOnlyTrustedHost();
    await testSavedRecordAcknowledgementSessionGate();
    await testSubmitAcknowledgementStateMachine();
    process.stdout.write(JSON.stringify({
        status: 'pass',
        detail: 'unified reading inline suite regressions covered'
    }));
    process.exit(0);
}

main().catch((error) => {
    const detail = error && error.stack ? error.stack : String(error);
    process.stdout.write(JSON.stringify({ status: 'fail', detail }));
    process.exit(1);
});
