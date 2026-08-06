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

function createClassList() {
    return {
        add() {},
        remove() {},
        toggle() {}
    };
}

function createContext() {
    function HTMLElement() {}
    function HTMLInputElement() {}
    HTMLInputElement.prototype = Object.create(HTMLElement.prototype);
    HTMLInputElement.prototype.constructor = HTMLInputElement;
    function HTMLTextAreaElement() {}
    HTMLTextAreaElement.prototype = Object.create(HTMLElement.prototype);
    HTMLTextAreaElement.prototype.constructor = HTMLTextAreaElement;
    function HTMLSelectElement() {}
    HTMLSelectElement.prototype = Object.create(HTMLElement.prototype);
    HTMLSelectElement.prototype.constructor = HTMLSelectElement;

    const timer = {
        textContent: '',
        style: {},
        classList: createClassList()
    };
    const radio = new HTMLInputElement();
    Object.assign(radio, {
        checked: true,
        value: 'A',
        type: 'radio',
        name: 'q1',
        disabled: false,
        dataset: {}
    });
    const notes = new HTMLTextAreaElement();
    Object.assign(notes, {
        value: 'fresh note',
        disabled: false,
        dataset: {}
    });
    const document = {
        title: 'Unified Reading Test',
        body: {
            dataset: {},
            classList: createClassList()
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
            if (selector === 'input, textarea, select') {
                return [radio, notes];
            }
            return [];
        },
        getElementById(id) {
            if (id === 'timer') {
                return timer;
            }
            return null;
        },
        createElement() {
            return {
                className: '',
                dataset: {},
                style: {},
                classList: createClassList(),
                appendChild() {},
                setAttribute() {},
                addEventListener() {},
                innerHTML: '',
                textContent: ''
            };
        },
        addEventListener() {},
        removeEventListener() {}
    };
    const window = {
        location: {
            href: 'http://localhost/assets/generated/reading-exams/reading-practice-unified.html?examId=reading-p1',
            search: '?examId=reading-p1'
        },
        history: { replaceState() {} },
        document,
        opener: null,
        parent: null,
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {},
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
        HTMLElement,
        HTMLInputElement,
        HTMLTextAreaElement,
        HTMLSelectElement,
        CustomEvent: function CustomEvent(type, init = {}) {
            this.type = type;
            this.detail = init.detail;
        },
        CSS: {
            escape(value) {
                return String(value);
            }
        }
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
        HTMLElement,
        HTMLInputElement,
        HTMLTextAreaElement,
        HTMLSelectElement,
        CustomEvent: window.CustomEvent,
        CSS: window.CSS,
        location: window.location
    };
    sandbox.globalThis = window;
    return {
        context: vm.createContext(sandbox),
        window,
        document,
        timer
    };
}

function loadHooks() {
    const { context, window, document, timer } = createContext();
    window.__IELTS_READING_PAGE_TEST_HOOKS__ = true;
    window.__READING_EXAM_MANIFEST__ = {};
    window.__READING_EXAM_DATA__ = new Map();
    loadScript('js/utils/answerMatchCore.js', context);
    loadScript('js/runtime/unifiedReadingPage.js', context);
    const hooks = window.__IELTS_UNIFIED_READING_PAGE_TEST__;
    assert(hooks, 'should expose unified reading page test hooks');
    return { hooks, window, document, timer };
}

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

async function testSubmitPostsBeforeExplanationRenderFinishes() {
    const { hooks, window } = loadHooks();
    const messages = [];
    const hostWindow = {
        postMessage(payload) {
            messages.push(payload);
        }
    };

    hooks.setTestState({
        examId: 'reading-p1',
        dataKey: 'reading-p1',
        practiceMode: 'single',
        parentWindow: hostWindow,
        pageStartTime: Date.now() - 1000,
        dataset: {
            meta: {
                title: 'Reading 1',
                category: 'P1',
                frequency: 'high'
            },
            questionOrder: ['q1'],
            answerKey: { q1: 'A' }
        }
    });

    let releaseExplanation = null;
    hooks.setTestOverride('renderExplanations', () => new Promise((resolve) => {
        releaseExplanation = resolve;
    }));

    let submitError = null;
    const submitPromise = hooks.handleSubmit().catch((error) => {
        submitError = error;
    });
    await Promise.resolve();

    assert.ifError(submitError);
    assert.strictEqual(messages.length, 1, 'submit should notify host before explanation rendering completes');
    assert.strictEqual(messages[0].type, 'PRACTICE_COMPLETE', 'submit should post a practice completion message');
    assert.strictEqual(messages[0].data?.answers?.q1, 'A', 'posted submission should include the current answer');

    releaseExplanation();
    await submitPromise;
    assert.ifError(submitError);
    hooks.setTestOverride('renderExplanations', null);
    assert.strictEqual(window.__UNIFIED_READING_SIMULATION_MODE__, false, 'submit regression harness should remain in non-simulation mode');
}

function testDraftBearingInitIsNotSuppressed() {
    const { hooks } = loadHooks();
    const baseData = {
        examId: 'reading-p1',
        sessionId: 'session-init',
        windowSessionToken: 'token-init',
        messageIssuedAtMs: 1000
    };
    const noDraftSignature = hooks.buildInitSignature(baseData);
    const draftData = {
        ...baseData,
        draft: { answers: { q1: 'A' }, updatedAt: 2000 }
    };
    const draftSignature = hooks.buildInitSignature(draftData);
    assert.notStrictEqual(
        draftSignature,
        noDraftSignature,
        'a later draft-bearing INIT must not be suppressed by an earlier no-draft INIT'
    );
    assert.strictEqual(
        hooks.buildInitSignature(draftData),
        draftSignature,
        'repeated INITs carrying the same draft should still be deduplicated'
    );
}

function testSuiteReviewAnnotationsUseDraftChannel() {
    const { hooks } = loadHooks();
    const messages = [];
    const hostWindow = {
        postMessage(payload) {
            messages.push(payload);
        }
    };
    hooks.setTestState({
        examId: 'reading-suite-review',
        sessionId: 'session-suite-review',
        suiteSessionId: 'suite-review',
        simulationMode: true,
        suiteReviewMode: true,
        reviewMode: true,
        readOnly: true,
        parentWindow: hostWindow
    });

    hooks.syncReadingAnnotation('note-edit');

    assert.strictEqual(messages.length, 1, 'suite review annotation should emit one persistence message');
    assert.strictEqual(messages[0].type, 'SIMULATION_DRAFT_SYNC', 'suite review annotation must use the suite draft channel');
    assert.strictEqual(messages[0].data?.examId, 'reading-suite-review', 'suite draft sync must retain the active exam id');
}

function testGroupedCheckboxSplitKeysScorePartially() {
    const { hooks } = loadHooks();
    const results = hooks.buildResultsFromAnswers({
        questionGroups: [{
            groupId: 'mc-split',
            kind: 'multi_choice',
            questionIds: ['q11', 'q12', 'q13']
        }],
        questionOrder: ['q11', 'q12', 'q13'],
        answerKey: {
            q11: 'B',
            q12: 'C',
            q13: 'D'
        }
    }, {
        q11: 'A',
        q12: 'B',
        q13: 'C'
    });

    assert.strictEqual(results.scoreInfo.correct, 2, 'split-key grouped checkbox should award overlap credit');
    assert.strictEqual(results.scoreInfo.totalQuestions, 3, 'split-key grouped checkbox total should stay three');
    assert.strictEqual(results.answerComparison.q11.isCorrect, true, 'expected B should count as found in selected set');
    assert.strictEqual(results.answerComparison.q12.isCorrect, true, 'expected C should count as found in selected set');
    assert.strictEqual(results.answerComparison.q13.isCorrect, false, 'missing D should stay incorrect');
    assert.deepStrictEqual(
        plain(results.answerComparison.q11.userAnswer),
        ['A', 'B', 'C'],
        'review comparison should retain the selected set for grouped checkbox rows'
    );
}

function testGroupedCheckboxSingleKeyArrayScoresPartially() {
    const { hooks } = loadHooks();
    const results = hooks.buildResultsFromAnswers({
        questionGroups: [{
            groupId: 'mc-array',
            kind: 'multi_choice',
            questionIds: ['q11']
        }],
        questionOrder: ['q11'],
        answerKey: {
            q11: ['B', 'C', 'D']
        }
    }, {
        q11: ['A', 'B', 'C']
    });

    assert.strictEqual(results.scoreInfo.correct, 2, 'single-key grouped checkbox arrays should award overlap credit');
    assert.strictEqual(results.scoreInfo.totalQuestions, 3, 'single-key grouped checkbox arrays should keep three-point total');
    assert.strictEqual(results.answerComparison.q11.isCorrect, false, 'partial grouped checkbox selections should still show non-perfect row status');
    assert.strictEqual(results.answerComparison.q11.partialCorrectCount, 2, 'partial grouped checkbox row should record matched option count');
}

function testAcceptedAnswerArraysStaySinglePoint() {
    const { hooks } = loadHooks();
    const results = hooks.buildResultsFromAnswers({
        questionGroups: [{
            groupId: 'text-alt',
            kind: 'sentence_completion',
            questionIds: ['q8']
        }],
        questionOrder: ['q8'],
        answerKey: {
            q8: ['a panoramic camera', 'panoramic camera']
        }
    }, {
        q8: 'panoramic camera'
    });

    assert.strictEqual(results.scoreInfo.correct, 1, 'accepted textual alternatives should count as one correct answer');
    assert.strictEqual(results.scoreInfo.totalQuestions, 1, 'accepted textual alternatives must not inflate total score weight');
    assert.strictEqual(results.answerComparison.q8.isCorrect, true, 'accepted textual alternative should still match');
}

function testReplaySplitCheckboxStringScoresByToken() {
    const { hooks } = loadHooks();
    hooks.setTestState({
        dataset: {
            questionGroups: [{
                groupId: 'mc-replay-string',
                kind: 'multi_choice',
                questionIds: ['q8', 'q9']
            }]
        }
    });
    const results = hooks.buildReplayResults({
        answers: {
            q8: 'A,C',
            q9: 'A,C'
        },
        correctAnswerMap: {
            q8: 'A',
            q9: 'C'
        },
        allQuestionIds: ['q8', 'q9']
    });

    assert.strictEqual(results.scoreInfo.correct, 2, 'persisted comma-delimited split choices should replay as two correct tokens');
    assert.strictEqual(results.answerComparison.q8.isCorrect, true, 'first persisted choice should match its split key');
    assert.strictEqual(results.answerComparison.q9.isCorrect, true, 'second persisted choice should match its split key');
}

function testSuiteTimerIgnoresEmptyLimitValues() {
    const { hooks, timer } = loadHooks();
    hooks.setTestState({
        suiteSessionId: 'suite-1',
        suiteTimerMode: 'countdown',
        suiteTimerLimitSeconds: '',
        pageStartTime: Date.now()
    });

    hooks.renderTimer();

    assert.strictEqual(timer.textContent, '60 minutes remaining', 'empty suite timer limit should fall back instead of rendering 0 minutes remaining');
}

async function main() {
    if (process.env.UNIFIED_READING_REPLAY_ONLY === '1') {
        testReplaySplitCheckboxStringScoresByToken();
        process.stdout.write(JSON.stringify({
            status: 'pass',
            detail: 'unified reading replay regression covered'
        }));
        return;
    }
    await testSubmitPostsBeforeExplanationRenderFinishes();
    testDraftBearingInitIsNotSuppressed();
    testSuiteReviewAnnotationsUseDraftChannel();
    testGroupedCheckboxSplitKeysScorePartially();
    testGroupedCheckboxSingleKeyArrayScoresPartially();
    testAcceptedAnswerArraysStaySinglePoint();
    testReplaySplitCheckboxStringScoresByToken();
    testSuiteTimerIgnoresEmptyLimitValues();
    process.stdout.write(JSON.stringify({
        status: 'pass',
        detail: 'unified reading submit/timer/scoring regressions covered'
    }));
}

main().catch((error) => {
    const detail = error && error.stack ? error.stack : String(error);
    process.stdout.write(JSON.stringify({ status: 'fail', detail }));
    process.exit(1);
});
