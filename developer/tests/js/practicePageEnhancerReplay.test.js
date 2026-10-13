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

async function testPracticeEnhancerCompletionAddsSubmissionContract() {
    const enhancer = loadEnhancer();
    const messages = [];
    enhancer.parentWindow = {
        postMessage(message, targetOrigin) {
            messages.push({ message, targetOrigin });
        }
    };
    enhancer.parentOrigin = 'https://host.example';
    enhancer.sessionId = 'enhancer-session';
    enhancer.examId = 'enhancer-exam';
    enhancer.windowSessionToken = 'enhancer-token';

    const payload = { answers: { q1: 'A' } };
    assert.strictEqual(enhancer.sendMessage('PRACTICE_COMPLETE', payload), true);
    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].targetOrigin, 'https://host.example');
    assert.strictEqual(messages[0].message.data.sessionId, 'enhancer-session');
    assert.strictEqual(messages[0].message.data.windowSessionToken, 'enhancer-token');
    assert.match(messages[0].message.data.submissionId, /^practice-submit-/);
    assert.strictEqual(payload.submissionId, messages[0].message.data.submissionId);

    enhancer.sendMessage('PRACTICE_COMPLETE', payload);
    assert.strictEqual(
        messages[1].message.data.submissionId,
        messages[0].message.data.submissionId,
        'retrying the same payload must reuse its submissionId'
    );
    recordResult('practice enhancer completion adds submission correlation', true, {
        submissionId: payload.submissionId
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

// 复盘调度：legacy 增强器只在宿主明确带了 reviewAttemptId 时才回执，
// 且回执必须带齐宿主校验所需的 record / exam / entryIndex / attempt。
async function testPracticeEnhancerAcknowledgesScheduledReplay() {
    const enhancer = loadEnhancer();
    const sent = [];
    enhancer.sendMessage = function (type, data) { sent.push({ type, data }); return true; };
    enhancer.examId = 'reading-p1';
    enhancer.sessionId = 'session-1';
    enhancer.reviewSessionId = 'review-1';
    enhancer.reviewEntryIndex = 0;

    enhancer.acknowledgeReplayApplied({
        recordId: 'record-1',
        reviewAttemptId: 'attempt-1',
        reviewSessionId: 'review-1',
        reviewEntryIndex: 0
    }, { examId: 'reading-p1' });
    assert.strictEqual(sent.length, 1, '带 attempt 的回放必须回执一次');
    assert.strictEqual(sent[0].type, 'REPLAY_APPLIED');
    assert.strictEqual(sent[0].data.recordId, 'record-1');
    assert.strictEqual(sent[0].data.reviewAttemptId, 'attempt-1');
    assert.strictEqual(sent[0].data.examId, 'reading-p1');
    assert.strictEqual(sent[0].data.sessionId, 'session-1');
    assert.strictEqual(sent[0].data.reviewEntryIndex, 0);

    sent.length = 0;
    enhancer.acknowledgeReplayApplied({ recordId: 'record-1' }, { examId: 'reading-p1' });
    enhancer.acknowledgeReplayApplied({ reviewAttemptId: 'attempt-1' }, { examId: 'reading-p1' });
    enhancer.acknowledgeReplayApplied({}, { examId: 'reading-p1' });
    assert.strictEqual(sent.length, 0, '普通历史回放不得回执 REPLAY_APPLIED');
    recordResult('practice enhancer acknowledges only scheduled replays', true, {});
}

// 复盘调度：统一阅读页只在宿主带了 reviewAttemptId 时才回执 REPLAY_APPLIED。
// 回执发生在解析渲染完成之后（见 applyReplayRecord 末尾），这里验证守卫与载荷。
async function testUnifiedReadingAcknowledgesScheduledReplay() {
    const posted = [];
    const parentStub = {
        postMessage(message, targetOrigin) { posted.push({ message, targetOrigin }); }
    };
    const windowStub = {
        __IELTS_READING_PAGE_TEST_HOOKS__: true,
        location: { search: '', href: 'file:///repo/ReadingPractice/reading.html', protocol: 'file:' },
        opener: parentStub,
        parent: parentStub,
        CSS: { escape(value) { return String(value); } },
        addEventListener() {},
        removeEventListener() {},
        AnswerMatchCore: {
            compareAnswers(userAnswer, correctAnswer) {
                return String(userAnswer == null ? '' : userAnswer).trim().toLowerCase()
                    === String(correctAnswer == null ? '' : correctAnswer).trim().toLowerCase();
            }
        }
    };
    const sandbox = {
        window: windowStub,
        globalThis: windowStub,
        document: createDocumentStub(),
        console: { log() {}, info() {}, warn() {}, error() {} },
        URLSearchParams, Date, Math, String, Number, Object, Array, Boolean, Set, Map, Promise,
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
    assert.strictEqual(typeof hooks.acknowledgeReplayApplied, 'function', '统一阅读页应暴露回执函数以便测试');

    hooks.acknowledgeReplayApplied({
        recordId: 'record-1',
        reviewAttemptId: 'attempt-1',
        reviewSessionId: 'review-1',
        reviewEntryIndex: 0
    }, 'reading-p1');
    const acks = posted.filter((item) => item.message && item.message.type === 'REPLAY_APPLIED');
    assert.strictEqual(acks.length, 1, '带 attempt 的回放必须回执一次');
    assert.strictEqual(acks[0].message.data.recordId, 'record-1');
    assert.strictEqual(acks[0].message.data.reviewAttemptId, 'attempt-1');
    assert.strictEqual(acks[0].message.data.examId, 'reading-p1');
    assert.strictEqual(acks[0].message.data.reviewEntryIndex, 0);
    assert.strictEqual(acks[0].message.source, 'practice_page');

    posted.length = 0;
    hooks.acknowledgeReplayApplied({ recordId: 'record-1' }, 'reading-p1');
    hooks.acknowledgeReplayApplied({ reviewAttemptId: 'attempt-1' }, 'reading-p1');
    hooks.acknowledgeReplayApplied({}, 'reading-p1');
    assert.strictEqual(
        posted.filter((item) => item.message && item.message.type === 'REPLAY_APPLIED').length,
        0,
        '普通历史回放不得回执 REPLAY_APPLIED'
    );
    recordResult('unified reading acknowledges only scheduled replays', true, {});
}

async function runAllTests() {
    const tests = [
        testPracticeEnhancerReplayCanonicalMapWins,
        testPracticeEnhancerReplayIgnoresNumericCorrectAnswersAsMap,
        testPracticeEnhancerSubmissionPayloadCarriesCorrectAnswerMap,
        testPracticeEnhancerCompletionAddsSubmissionContract,
        testUnifiedReadingReplayCanonicalMapWins,
        testUnifiedReadingReplayRefusesComparisonCorrectAnswerFallback,
        testPracticeEnhancerAcknowledgesScheduledReplay,
        testUnifiedReadingAcknowledgesScheduledReplay
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
