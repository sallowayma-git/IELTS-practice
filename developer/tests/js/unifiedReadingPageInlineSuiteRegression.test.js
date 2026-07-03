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

function createSessionStorageStub() {
    const store = new Map();
    return {
        store,
        getItem(key) {
            return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
            store.set(key, String(value));
        },
        removeItem(key) {
            store.delete(key);
        }
    };
}

function createDocumentStub() {
    const radio = { checked: true, value: 'A' };
    const notes = { value: 'fresh note' };
    return {
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
        getElementById() {
            return null;
        },
        addEventListener() {},
        removeEventListener() {}
    };
}

function createContext() {
    const sessionStorage = createSessionStorageStub();
    const document = createDocumentStub();
    const window = {
        location: {
            href: 'http://localhost/assets/generated/reading-exams/reading-practice-unified.html?examId=reading-p1',
            search: '?examId=reading-p1'
        },
        history: { replaceState() {} },
        document,
        sessionStorage,
        opener: null,
        parent: null,
        addEventListener() {},
        removeEventListener() {},
        scrollTo() {},
        scrollY: 0,
        close() {},
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
        sessionStorage,
        location: window.location
    };
    sandbox.globalThis = window;
    return { context: vm.createContext(sandbox), window, document, sessionStorage };
}

function loadHooks() {
    const { context, window, sessionStorage } = createContext();
    window.__IELTS_READING_PAGE_TEST_HOOKS__ = true;
    window.__READING_EXAM_MANIFEST__ = {};
    window.__READING_EXAM_DATA__ = new Map();
    loadScript('js/runtime/unifiedReadingPage.js', context);
    const hooks = window.__IELTS_UNIFIED_READING_PAGE_TEST__;
    assert(hooks, 'should expose unified reading page test hooks');
    return { hooks, window, sessionStorage };
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
    const { hooks, sessionStorage, window } = loadHooks();

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

    const storageKey = 'ielts_sim_draft::suite-1::reading-p1';
    assert(sessionStorage.store.has(storageKey), 'reinit snapshot must persist the local mirror');
    const stored = JSON.parse(sessionStorage.store.get(storageKey));
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
        windowSessionToken: 'token-new',
        windowSessionIssuedAtMs: 5000,
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

    await hooks.handleIncoming({
        source: sourceWindow,
        data: {
            type: 'INIT_SESSION',
            data: {
                examId: 'reading-p2',
                sessionId: 'session-new',
                suiteSessionId: 'suite-new',
                windowSessionToken: 'token-old',
                messageIssuedAtMs: 4000
            }
        }
    });

    let state = hooks.getTestState();
    assert.strictEqual(state.lastInitSignature, '', 'stale INIT_SESSION must not overwrite current inline session');
    assert.strictEqual(state.windowSessionToken, 'token-new', 'stale INIT_SESSION must not replace window token');

    await hooks.handleIncoming({
        source: sourceWindow,
        data: {
            type: 'SIMULATION_CONTEXT',
            data: {
                examId: 'reading-p2',
                sessionId: 'session-new',
                suiteSessionId: 'suite-new',
                flowMode: 'simulation',
                currentIndex: 0,
                total: 3,
                windowSessionToken: 'token-old',
                messageIssuedAtMs: 4000,
                suiteSequence: [
                    { examId: 'reading-p1' },
                    { examId: 'reading-p2' },
                    { examId: 'reading-p3' }
                ]
            }
        }
    });

    state = hooks.getTestState();
    assert.strictEqual(state.simulationCtx.currentIndex, 1, 'stale SIMULATION_CONTEXT must not replace active simulation context');

    await hooks.handleIncoming({
        source: sourceWindow,
        data: {
            type: 'INIT_SESSION',
            data: {
                examId: 'reading-p2',
                sessionId: 'session-newer',
                suiteSessionId: 'suite-new',
                windowSessionToken: 'token-newer',
                messageIssuedAtMs: 6000
            }
        }
    });

    state = hooks.getTestState();
    assert.strictEqual(state.sessionId, 'session-newer', 'newer INIT_SESSION must still be accepted');
    assert.strictEqual(state.windowSessionToken, 'token-newer', 'newer INIT_SESSION must adopt the latest window token');
}

async function main() {
    await testDraftArbitration();
    await testInlineEnvelopeGuard();
    await testInlineReinitSnapshot();
    await testWindowSessionMessageGuard();
    process.stdout.write(JSON.stringify({
        status: 'pass',
        detail: 'unified reading inline suite regressions covered'
    }));
}

main().catch((error) => {
    const detail = error && error.stack ? error.stack : String(error);
    process.stdout.write(JSON.stringify({ status: 'fail', detail }));
    process.exit(1);
});
