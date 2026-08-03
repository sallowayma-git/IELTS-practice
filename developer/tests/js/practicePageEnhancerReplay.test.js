#!/usr/bin/env node
'use strict';

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const results = [];

function runScript(relativePath, context) {
    vm.runInContext(
        fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'),
        context,
        { filename: relativePath }
    );
}

function createDocumentStub() {
    return {
        readyState: 'loading',
        currentScript: { src: 'file:///repo/js/practice-page-enhancer.js' },
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        getElementById() { return null; },
        createElement() {
            return {
                dataset: {},
                style: {},
                appendChild() {},
                addEventListener() {}
            };
        },
        head: { appendChild() {} },
        body: {
            classList: { toggle() {}, add() {}, remove() {} },
            insertAdjacentElement() {},
            appendChild() {}
        },
        documentElement: { appendChild() {} }
    };
}

function loadEnhancer() {
    const windowStub = {
        practicePageEnhancerConfig: { autoInitialize: false },
        location: { href: 'file:///repo/ReadingPractice/test.html', pathname: '/ReadingPractice/test.html' },
        opener: null,
        parent: null,
        CSS: { escape(value) { return String(value); } },
        addEventListener() {},
        removeEventListener() {},
        getComputedStyle() { return { position: 'static' }; },
        AnswerMatchCore: {
            compareAnswers(userAnswer, correctAnswer) {
                return String(userAnswer == null ? '' : userAnswer).trim().toLowerCase()
                    === String(correctAnswer == null ? '' : correctAnswer).trim().toLowerCase();
            }
        }
    };
    windowStub.parent = windowStub;

    const sandbox = {
        window: windowStub,
        document: createDocumentStub(),
        console: {
            log() {},
            info() {},
            warn() {},
            error() {}
        },
        URL,
        URLSearchParams,
        Date,
        Math,
        String,
        Number,
        Object,
        Array,
        Boolean,
        Set,
        Map,
        Promise,
        setTimeout() { return 1; },
        clearTimeout() {},
        HTMLInputElement: function HTMLInputElement() {},
        HTMLTextAreaElement: function HTMLTextAreaElement() {},
        HTMLSelectElement: function HTMLSelectElement() {},
        HTMLButtonElement: function HTMLButtonElement() {}
    };
    sandbox.globalThis = windowStub;
    const context = vm.createContext(sandbox);
    runScript('js/core/practiceCore.js', context);
    runScript('js/practice-page-enhancer.js', context);
    return windowStub.practicePageEnhancer;
}

function recordResult(name, passed, detail) {
    results.push({ name, passed, detail, timestamp: new Date().toISOString() });
}

function assertCanonicalReplayResults(replayResults) {
    assert.strictEqual(replayResults.correctAnswers.q1, 'A', 'canonical correctAnswerMap must win for q1');
    assert.strictEqual(replayResults.correctAnswers.q2, 'D', 'canonical correctAnswerMap must win for q2');
    assert.strictEqual(replayResults.answerComparison.q1.correctAnswer, 'A', 'comparison q1 correctAnswer must be rebuilt from canonical map');
    assert.strictEqual(replayResults.answerComparison.q2.correctAnswer, 'D', 'comparison q2 correctAnswer must be rebuilt from canonical map');
    assert.strictEqual(replayResults.answerComparison.q1.isCorrect, true, 'comparison q1 isCorrect must be recalculated from canonical map');
    assert.strictEqual(replayResults.answerComparison.q2.isCorrect, true, 'comparison q2 isCorrect must be recalculated from canonical map');
    assert.strictEqual(replayResults.scoreInfo.correct, 2, 'replay score correct count must be derived from canonical comparison');
    assert.strictEqual(replayResults.scoreInfo.total, 2, 'replay score total must be derived from canonical comparison');
    assert.strictEqual(replayResults.scoreInfo.percentage, 100, 'replay score percentage must be derived from canonical comparison');
}

async function testPracticeEnhancerReplayCanonicalMapWins() {
    const enhancer = loadEnhancer();
    const replayResults = enhancer.buildReplayResultsFromEntry({
        answers: { q1: 'A', q2: 'D' },
        correctAnswerMap: { q1: 'A', q2: 'D' },
        correctAnswers: { q1: 'B', q2: 'C' },
        answerComparison: {
            q1: { userAnswer: 'A', correctAnswer: 'B', isCorrect: false },
            q2: { userAnswer: 'D', correctAnswer: 'C', isCorrect: false }
        },
        scoreInfo: { correct: 0, total: 2, accuracy: 0, percentage: 0 },
        realData: {
            correctAnswerMap: { q2: 'D' },
            correctAnswers: { q1: 'B', q2: 'C' }
        }
    });

    assertCanonicalReplayResults(replayResults);
    recordResult('practice enhancer replay prefers canonical correctAnswerMap', true, {
        correctAnswers: replayResults.correctAnswers
    });
}

async function testPracticeEnhancerReplayIgnoresNumericCorrectAnswersAsMap() {
    const enhancer = loadEnhancer();
    const replayResults = enhancer.buildReplayResultsFromEntry({
        answers: { q1: 'A' },
        correctAnswers: 7,
        answerComparison: {
            q1: { userAnswer: 'A', correctAnswer: 'B', isCorrect: false }
        }
    });

    assert.strictEqual(Object.keys(replayResults.correctAnswers).length, 0, 'comparison correctAnswer 不能作为回灌正确答案来源');
    assert.strictEqual(replayResults.answerComparison.q1.correctAnswer, '');
    assert.strictEqual(replayResults.answerComparison.q1.isCorrect, null);
    recordResult('practice enhancer replay refuses comparison fallback correct answers', true, {
        correctAnswers: replayResults.correctAnswers
    });
}

async function testPracticeEnhancerSubmissionPayloadCarriesCorrectAnswerMap() {
    const enhancer = loadEnhancer();
    enhancer.sessionId = 'session-p1';
    enhancer.suiteSessionId = null;
    enhancer.examId = 'reading-p1';
    enhancer.answers = { q1: 'A' };
    enhancer.correctAnswers = { q1: 'A' };
    enhancer.interactions = [];
    enhancer.resolveExamId = () => 'reading-p1';
    enhancer.getPageContext = () => ({
        title: 'Passage 1',
        categoryLabel: 'P1',
        frequencyLabel: 'high'
    });
    enhancer.detectPracticeType = () => 'reading';
    enhancer.detectPageType = () => 'reading';
    enhancer.resolvePracticeTiming = () => ({
        startTime: '2026-01-01T00:00:00.000Z',
        endTime: '2026-01-01T00:01:00.000Z',
        duration: 60,
        effectiveEndTime: '2026-01-01T00:01:00.000Z'
    });
    enhancer.captureQuestionSet = () => ['q1'];
    enhancer.extractScore = () => ({ correct: 1, total: 1, accuracy: 1, percentage: 100 });

    const payload = enhancer.buildResultsPayload({
        includeComparison: true,
        includeScore: true
    });

    assert.strictEqual(payload.correctAnswerMap.q1, 'A', 'submit payload 必须显式携带 canonical correctAnswerMap');
    assert.strictEqual(payload.correctAnswers.q1, 'A', '旧 correctAnswers 只作为兼容副本保留');
    assert.notStrictEqual(payload.correctAnswerMap, enhancer.correctAnswers, 'payload correctAnswerMap 必须是快照，不能引用运行期缓存');
    recordResult('practice enhancer submit payload carries canonical correctAnswerMap', true, {
        correctAnswerMap: payload.correctAnswerMap
    });
}

async function testUnifiedReadingReplayRefusesComparisonCorrectAnswerFallback() {
    const windowStub = {
        __IELTS_READING_PAGE_TEST_HOOKS__: true,
        location: { search: '', href: 'file:///repo/ReadingPractice/reading.html' },
        opener: null,
        parent: null,
        CSS: { escape(value) { return String(value); } },
        addEventListener() {},
        removeEventListener() {},
        localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        AnswerMatchCore: {
            compareAnswers(userAnswer, correctAnswer) {
                return String(userAnswer == null ? '' : userAnswer).trim().toLowerCase()
                    === String(correctAnswer == null ? '' : correctAnswer).trim().toLowerCase();
            }
        }
    };
    windowStub.parent = windowStub;
    const sandbox = {
        window: windowStub,
        globalThis: windowStub,
        document: createDocumentStub(),
        console: { log() {}, info() {}, warn() {}, error() {} },
        URLSearchParams,
        Date,
        Math,
        String,
        Number,
        Object,
        Array,
        Boolean,
        Set,
        Map,
        Promise,
        setTimeout() { return 1; },
        clearTimeout() {},
        HTMLElement: function HTMLElement() {},
        HTMLInputElement: function HTMLInputElement() {},
        HTMLTextAreaElement: function HTMLTextAreaElement() {},
        HTMLSelectElement: function HTMLSelectElement() {}
    };
    const context = vm.createContext(sandbox);
    runScript('js/core/practiceCore.js', context);
    runScript('js/runtime/unifiedReadingPage.js', context);

    const replayResults = windowStub.__IELTS_UNIFIED_READING_PAGE_TEST__.buildReplayResults({
        answers: { q1: 'A' },
        correctAnswers: 7,
        answerComparison: {
            q1: { userAnswer: 'A', correctAnswer: 'B', isCorrect: false }
        }
    });

    assert.strictEqual(Object.keys(replayResults.correctAnswers).length, 0, 'unified reading 不能从 comparison 反推正确答案');
    assert.strictEqual(replayResults.answerComparison.q1.correctAnswer, '');
    assert.strictEqual(replayResults.answerComparison.q1.isCorrect, null);
    recordResult('unified reading replay refuses comparison fallback correct answers', true, {
        correctAnswers: replayResults.correctAnswers
    });
}

async function testUnifiedReadingReplayCanonicalMapWins() {
    const windowStub = {
        __IELTS_READING_PAGE_TEST_HOOKS__: true,
        location: { search: '', href: 'file:///repo/ReadingPractice/reading.html' },
        opener: null,
        parent: null,
        CSS: { escape(value) { return String(value); } },
        addEventListener() {},
        removeEventListener() {},
        localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        AnswerMatchCore: {
            compareAnswers(userAnswer, correctAnswer) {
                return String(userAnswer == null ? '' : userAnswer).trim().toLowerCase()
                    === String(correctAnswer == null ? '' : correctAnswer).trim().toLowerCase();
            }
        }
    };
    windowStub.parent = windowStub;
    const documentStub = createDocumentStub();

    const sandbox = {
        window: windowStub,
        globalThis: windowStub,
        document: documentStub,
        console: { log() {}, info() {}, warn() {}, error() {} },
        URLSearchParams,
        Date,
        Math,
        String,
        Number,
        Object,
        Array,
        Boolean,
        Set,
        Map,
        Promise,
        setTimeout() { return 1; },
        clearTimeout() {},
        HTMLElement: function HTMLElement() {},
        HTMLInputElement: function HTMLInputElement() {},
        HTMLTextAreaElement: function HTMLTextAreaElement() {},
        HTMLSelectElement: function HTMLSelectElement() {}
    };
    const context = vm.createContext(sandbox);
    runScript('js/core/practiceCore.js', context);
    runScript('js/runtime/unifiedReadingPage.js', context);

    const hooks = windowStub.__IELTS_UNIFIED_READING_PAGE_TEST__;
    assert(hooks && typeof hooks.buildReplayResults === 'function', 'unified reading page test hook should expose buildReplayResults');
    const replayResults = hooks.buildReplayResults({
        answers: { q1: 'A', q2: 'D' },
        correctAnswerMap: { q1: 'A', q2: 'D' },
        correctAnswers: { q1: 'B', q2: 'C' },
        answerComparison: {
            q1: { userAnswer: 'A', correctAnswer: 'B', isCorrect: false },
            q2: { userAnswer: 'D', correctAnswer: 'C', isCorrect: false }
        },
        scoreInfo: { correct: 0, total: 2, accuracy: 0, percentage: 0 },
        realData: {
            correctAnswerMap: { q2: 'D' },
            correctAnswers: { q1: 'B', q2: 'C' }
        }
    });

    assertCanonicalReplayResults(replayResults);
    recordResult('unified reading replay prefers canonical correctAnswerMap', true, {
        correctAnswers: replayResults.correctAnswers
    });
}

async function runAllTests() {
    const tests = [
        testPracticeEnhancerReplayCanonicalMapWins,
        testPracticeEnhancerReplayIgnoresNumericCorrectAnswersAsMap,
        testPracticeEnhancerSubmissionPayloadCarriesCorrectAnswerMap,
        testUnifiedReadingReplayCanonicalMapWins,
        testUnifiedReadingReplayRefusesComparisonCorrectAnswerFallback
    ];
    for (const testFn of tests) {
        try {
            await testFn();
        } catch (error) {
            recordResult(testFn.name, false, { error: error.message, stack: error.stack });
        }
    }
}

function printJsonReport() {
    const totalTests = results.length;
    const passedTests = results.filter(result => result.passed).length;
    const failedTests = totalTests - passedTests;
    const report = {
        status: failedTests === 0 ? 'pass' : 'fail',
        detail: `${passedTests}/${totalTests} 测试通过`,
        summary: { totalTests, passedTests, failedTests },
        failedTests: results.filter(result => !result.passed)
    };
    console.log(JSON.stringify(report, null, 2));
    return report;
}

(async function main() {
    await runAllTests();
    const report = printJsonReport();
    process.exit(report.status === 'pass' ? 0 : 1);
})();
