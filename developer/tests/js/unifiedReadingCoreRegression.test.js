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
        referrer: 'http://localhost/',
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
            search: '?examId=reading-p1',
            protocol: 'http:'
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
        sessionId: 'session-reading-p1',
        practiceMode: 'single',
        parentWindow: hostWindow,
        expectedParentOrigin: 'http://localhost',
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

    let explanationStarted = false;
    hooks.setTestOverride('renderExplanations', () => {
        explanationStarted = true;
        return Promise.resolve();
    });

    let submitError = null;
    const submitPromise = hooks.handleSubmit().catch((error) => {
        submitError = error;
    });
    await Promise.resolve();

    assert.ifError(submitError);
    assert.strictEqual(messages.length, 1, 'submit should notify host before explanation rendering completes');
    assert.strictEqual(messages[0].type, 'PRACTICE_COMPLETE', 'submit should post a practice completion message');
    assert.strictEqual(messages[0].data?.answers?.q1, 'A', 'posted submission should include the current answer');
    assert.strictEqual(explanationStarted, false, 'results and explanations must wait for a matching host ACK');

    await submitPromise;
    assert.ifError(submitError);
    const pendingState = hooks.getTestState();
    const accepted = await hooks.acceptSubmissionAcknowledgement({
        submissionId: pendingState.submissionId,
        sessionId: pendingState.sessionId,
        examId: pendingState.examId
    });
    assert.strictEqual(accepted, true, 'matching ACK should finalize the pending submission');
    assert.strictEqual(explanationStarted, true, 'matching ACK should render the result explanation');
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
        parentWindow: hostWindow,
        expectedParentOrigin: 'http://localhost',
        parentOrigin: 'http://localhost'
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
    const dataset = {
        questionGroups: [{
            groupId: 'mc-array',
            kind: 'multi_choice',
            questionIds: ['q11']
        }],
        questionOrder: ['q11'],
        answerKey: {
            q11: ['B', 'C', 'D']
        }
    };
    const partialAnswers = {
        q11: ['A', 'B', 'C']
    };
    const results = hooks.buildResultsFromAnswers(dataset, partialAnswers);

    assert.strictEqual(results.scoreInfo.correct, 2, 'single-key grouped checkbox arrays should award overlap credit');
    assert.strictEqual(results.scoreInfo.totalQuestions, 3, 'single-key grouped checkbox arrays should keep three-point total');
    assert.strictEqual(results.answerComparison.q11.isCorrect, false, 'partial grouped checkbox selections should still show non-perfect row status');
    assert.strictEqual(results.answerComparison.q11.partialCorrectCount, 2, 'partial grouped checkbox row should record matched option count');

    hooks.setTestState({ dataset });
    const partialReplay = hooks.buildReplayResults({
        answers: partialAnswers,
        correctAnswerMap: dataset.answerKey,
        allQuestionIds: dataset.questionOrder
    });
    assert.strictEqual(partialReplay.scoreInfo.correct, 2, 'single-key replay should retain partial option credit');
    assert.strictEqual(partialReplay.scoreInfo.totalQuestions, 3, 'single-key replay should retain option-weighted total');
    assert.strictEqual(partialReplay.answerComparison.q11.partialCorrectCount, 2, 'single-key replay should retain matched option count');

    const perfectReplay = hooks.buildReplayResults({
        answers: { q11: ['B', 'C', 'D'] },
        correctAnswerMap: dataset.answerKey,
        allQuestionIds: dataset.questionOrder
    });
    assert.strictEqual(perfectReplay.scoreInfo.correct, 3, 'perfect single-key replay should retain all option points');
    assert.strictEqual(perfectReplay.scoreInfo.totalQuestions, 3, 'perfect single-key replay should keep option-weighted total');
    assert.strictEqual(perfectReplay.answerComparison.q11.isCorrect, true, 'perfect single-key replay should remain fully correct');
}

function testAcceptedAnswerArraysStaySinglePoint() {
    const { hooks } = loadHooks();
    const dataset = {
        questionGroups: [{
            groupId: 'text-alt',
            kind: 'sentence_completion',
            questionIds: ['q8']
        }],
        questionOrder: ['q8'],
        answerKey: {
            q8: ['a panoramic camera', 'panoramic camera']
        }
    };
    const answers = {
        q8: 'panoramic camera'
    };
    const results = hooks.buildResultsFromAnswers(dataset, answers);

    assert.strictEqual(results.scoreInfo.correct, 1, 'accepted textual alternatives should count as one correct answer');
    assert.strictEqual(results.scoreInfo.totalQuestions, 1, 'accepted textual alternatives must not inflate total score weight');
    assert.strictEqual(results.answerComparison.q8.isCorrect, true, 'accepted textual alternative should still match');

    hooks.setTestState({ dataset });
    const replay = hooks.buildReplayResults({
        answers,
        correctAnswerMap: dataset.answerKey,
        allQuestionIds: dataset.questionOrder
    });
    assert.strictEqual(replay.scoreInfo.correct, 1, 'accepted textual alternative replay should remain correct');
    assert.strictEqual(replay.scoreInfo.totalQuestions, 1, 'accepted textual alternatives should remain one point in replay');
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
            q8: 'A,B',
            q9: 'A,B'
        },
        correctAnswerMap: {
            q8: 'A',
            q9: 'C'
        },
        allQuestionIds: ['q8', 'q9']
    });

    assert.strictEqual(results.scoreInfo.correct, 1, 'one correct split choice should retain half credit');
    assert.strictEqual(results.scoreInfo.totalQuestions, 2, 'split choices should remain independently weighted');
    assert.strictEqual(results.answerComparison.q8.isCorrect, true, 'first persisted choice should match its split key');
    assert.strictEqual(results.answerComparison.q9.isCorrect, false, 'wrong split choice should not erase the correct option credit');
}

function testReplayKeepsMissingCorrectAnswersUnknown() {
    const { hooks } = loadHooks();
    hooks.setTestState({
        dataset: {
            questionGroups: [],
            questionOrder: ['q1', 'q2']
        }
    });
    const results = hooks.buildReplayResults({
        answerComparison: {
            q1: { userAnswer: 'A' },
            q2: { userAnswer: 'B' }
        },
        correctAnswerMap: { q1: 'A' },
        allQuestionIds: ['q1', 'q2']
    });

    assert.strictEqual(results.answerComparison.q1.isCorrect, true, 'available canonical answers should still be scored');
    assert.strictEqual(results.answerComparison.q2.isCorrect, null, 'questions missing a canonical correct answer must remain unknown');
    assert.strictEqual(results.scoreInfo.correct, 1);
    assert.strictEqual(results.scoreInfo.totalQuestions, 1, 'unknown questions must not inflate the scored denominator');
    assert.deepStrictEqual(plain(results.answers), { q1: 'A', q2: 'B' }, 'comparison-only records must still replay user answers into the DOM');
}

function testSplitCheckboxRequiresExpectedSelectionCount() {
    const { hooks } = loadHooks();
    const dataset = {
        questionGroups: [{
            groupId: 'mc-inline-count',
            kind: 'multiple_choice',
            questionIds: ['q8', 'q9']
        }],
        answerKey: {
            q8: 'A',
            q9: 'C'
        }
    };

    assert.strictEqual(
        hooks.hasAnswerInDataset('q8', { q8: ['A'], q9: ['A'] }, dataset),
        false,
        'one selected token must not mark every split question answered'
    );
    assert.strictEqual(
        hooks.hasAnswerInDataset('q8', { q8: ['A', 'C'], q9: ['A', 'C'] }, dataset),
        true,
        'the split group should count as answered after the expected selections are present'
    );
}

function testReviewCompletionCountsSelectedOptionsExactlyOnce() {
    const { hooks } = loadHooks();
    const splitDataset = {
        questionGroups: [{
            groupId: 'production-style-three-choice',
            kind: 'multi_choice',
            questionIds: ['q11', 'q12', 'q13']
        }],
        questionOrder: ['q11', 'q12', 'q13'],
        answerKey: { q11: 'C', q12: 'D', q13: 'E' }
    };
    const partial = hooks.buildResultsFromAnswers(splitDataset, {
        q11: ['C'],
        q12: ['C'],
        q13: ['C']
    });
    assert.strictEqual(
        hooks.countAnsweredWeight(partial, splitDataset),
        1,
        'one shared selection in a three-point split group must report 1 / 3 completion'
    );

    const legacyComparisonOnly = {
        answerComparison: {
            q11: { questionId: 'q11', userAnswer: ['C'], weight: 1 },
            q12: { questionId: 'q12', userAnswer: ['C'], weight: 1 },
            q13: { questionId: 'q13', userAnswer: ['C'], weight: 1 }
        },
        scoreInfo: { total: 3, totalQuestions: 3 }
    };
    assert.strictEqual(
        hooks.countAnsweredWeight(legacyComparisonOnly, splitDataset),
        1,
        'comparison-only replay data must de-duplicate the repeated selected set'
    );

    const weightedDataset = {
        questionGroups: [{
            groupId: 'weighted-three-choice',
            kind: 'multi_choice',
            questionIds: ['q21']
        }],
        questionOrder: ['q21'],
        answerKey: { q21: ['A', 'B', 'C'] }
    };
    const weightedPartial = hooks.buildResultsFromAnswers(weightedDataset, { q21: ['A'] });
    assert.strictEqual(
        hooks.countAnsweredWeight(weightedPartial, weightedDataset),
        1,
        'one selection in a weighted single-key group must not receive its full three-point weight'
    );
}

function testPersistedChoiceStringSplitsForHighlighting() {
    const { hooks } = loadHooks();
    assert.deepStrictEqual(
        plain(hooks.normalizeChoiceTokenList('A,B')),
        ['A', 'B'],
        'persisted split choices should expose each selected option for review highlighting'
    );
}

function testJudgementChoicesRemainAvailableForHighlighting() {
    const { hooks } = loadHooks();
    assert.deepStrictEqual(
        plain(hooks.normalizeChoiceTokenList(['TRUE', 'FALSE', 'NOT GIVEN'])),
        ['false', 'NOT GIVEN', 'true'],
        'judgement answers should not be discarded by letter-choice normalization'
    );
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
        testGroupedCheckboxSingleKeyArrayScoresPartially();
        testAcceptedAnswerArraysStaySinglePoint();
        testReplaySplitCheckboxStringScoresByToken();
        testReplayKeepsMissingCorrectAnswersUnknown();
        testSplitCheckboxRequiresExpectedSelectionCount();
        testReviewCompletionCountsSelectedOptionsExactlyOnce();
        testPersistedChoiceStringSplitsForHighlighting();
        testJudgementChoicesRemainAvailableForHighlighting();
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
    testReplayKeepsMissingCorrectAnswersUnknown();
    testSplitCheckboxRequiresExpectedSelectionCount();
    testReviewCompletionCountsSelectedOptionsExactlyOnce();
    testPersistedChoiceStringSplitsForHighlighting();
    testJudgementChoicesRemainAvailableForHighlighting();
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
