#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function loadScript(relativePath, context) {
    const fullPath = path.join(repoRoot, relativePath);
    const source = fs.readFileSync(fullPath, 'utf8');
    vm.runInContext(source, context, { filename: relativePath });
}

function createWebStorage() {
    const map = new Map();
    return {
        getItem(key) {
            return map.has(key) ? map.get(key) : null;
        },
        setItem(key, value) {
            map.set(key, String(value));
        },
        removeItem(key) {
            map.delete(key);
        }
    };
}

function createHarness(options = {}) {
    const immediateTimers = options.immediateTimers === true;
    const markedQuestionsCalls = [];
    const appendedNodes = [];
    const dispatchedEvents = [];

    const classList = {
        add() {},
        remove() {},
        toggle() {},
        contains() { return false; }
    };

    const documentStub = {
        readyState: 'complete',
        title: 'Practice Enhancer Fixture',
        currentScript: {
            src: 'file:///Users/test/js/practice-page-enhancer.js'
        },
        body: {
            dataset: {},
            classList
        },
        head: {
            appendChild(node) {
                appendedNodes.push(node);
                return node;
            }
        },
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent(event) {
            dispatchedEvents.push(event);
            return true;
        },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        getElementById() { return null; },
        createElement(tagName) {
            return {
                tagName: String(tagName || 'div').toUpperCase(),
                style: {},
                dataset: {},
                classList,
                appendChild() {},
                addEventListener() {},
                removeEventListener() {},
                setAttribute() {},
                removeAttribute() {},
                querySelector() { return null; },
                querySelectorAll() { return []; }
            };
        }
    };

    const quietConsole = {
        log() {},
        warn() {},
        error() {},
        info() {}
    };
    const localStorage = createWebStorage();
    const sessionStorage = createWebStorage();

    const windowStub = {
        document: documentStub,
        console: quietConsole,
        location: {
            href: 'file:///Users/test/practice.html?examId=p1',
            pathname: '/Users/test/practice.html',
            search: '?examId=p1',
            origin: 'null'
        },
        navigator: {},
        history: {
            state: null,
            pushState() {},
            replaceState() {}
        },
        opener: null,
        parent: null,
        localStorage,
        sessionStorage,
        practicePageEnhancerConfig: {
            autoInitialize: false
        },
        addEventListener() {},
        removeEventListener() {},
        getComputedStyle() {
            return { position: 'relative', display: 'block' };
        },
        setPracticeMarkedQuestions(values) {
            markedQuestionsCalls.push(Array.isArray(values) ? values.slice() : values);
        }
    };

    const sandbox = {
        window: windowStub,
        document: documentStub,
        console: quietConsole,
        location: windowStub.location,
        history: windowStub.history,
        URL,
        URLSearchParams,
        setTimeout: immediateTimers
            ? (handler) => {
                if (typeof handler === 'function') {
                    handler();
                }
                return 1;
            }
            : setTimeout,
        clearTimeout: immediateTimers ? (() => {}) : clearTimeout,
        setInterval,
        clearInterval,
        Date,
        Math,
        JSON,
        Map,
        Set,
        Promise,
        localStorage,
        sessionStorage,
        CustomEvent: function CustomEvent(type, init = {}) {
            return {
                type,
                detail: init.detail
            };
        },
        fetch: async () => ({ ok: true, json: async () => ({}) })
    };
    sandbox.globalThis = sandbox.window;
    sandbox.window.window = sandbox.window;
    sandbox.window.self = sandbox.window;
    sandbox.window.top = sandbox.window;
    sandbox.window.URL = URL;
    sandbox.window.URLSearchParams = URLSearchParams;
    sandbox.window.CustomEvent = sandbox.CustomEvent;

    const context = vm.createContext(sandbox);
    loadScript('js/practice-page-enhancer.js', context);

    return {
        context,
        windowStub,
        enhancer: windowStub.practicePageEnhancer,
        markedQuestionsCalls,
        appendedNodes,
        dispatchedEvents
    };
}
function testCollectAnswersNowDelegatesToEnhancer() {
    const harness = createHarness();
    let callCount = 0;
    harness.enhancer.answers = { q1: 'A' };
    harness.enhancer.collectAllAnswers = () => {
        callCount += 1;
        harness.enhancer.answers = { q1: 'A', q2: 'B' };
    };

    const result = harness.windowStub.collectAnswersNow();
    assert.strictEqual(callCount, 1, 'collectAnswersNow 应委托给 practicePageEnhancer.collectAllAnswers');
    assert.deepStrictEqual(result, { q1: 'A', q2: 'B' }, 'collectAnswersNow 应返回增强器最新 answers');
}
function testGetCorrectAnswersDelegatesToEnhancer() {
    const harness = createHarness();
    let callCount = 0;
    harness.enhancer.correctAnswers = { q1: 'A' };
    harness.enhancer.extractCorrectAnswers = () => {
        callCount += 1;
        harness.enhancer.correctAnswers = { q1: 'A', q2: 'C' };
    };

    const result = harness.windowStub.getCorrectAnswers();
    assert.strictEqual(callCount, 1, 'getCorrectAnswers 应委托给 practicePageEnhancer.extractCorrectAnswers');
    assert.deepStrictEqual(result, { q1: 'A', q2: 'C' }, 'getCorrectAnswers 应返回增强器最新 correctAnswers');
}
function testSendMessageRespectsReadOnlyGuard() {
    const harness = createHarness();
    const posted = [];
    let hookArgs = null;
    harness.enhancer.parentWindow = {
        postMessage(message, origin) {
            posted.push({ message, origin });
        }
    };
    harness.enhancer.runHooks = (...args) => {
        hookArgs = args;
    };

    harness.enhancer.readOnly = true;
    harness.enhancer.sendMessage('PRACTICE_COMPLETE', { score: 100 });
    assert.strictEqual(posted.length, 0, 'readOnly 模式不应发送 PRACTICE_COMPLETE');

    harness.enhancer.readOnly = false;
    harness.enhancer.sendMessage('SESSION_READY', { ok: true });
    assert.strictEqual(posted.length, 1, '普通消息应发送到父窗口');
    assert.strictEqual(posted[0].origin, '*', 'postMessage 目标 origin 应保持兼容');
    assert.strictEqual(posted[0].message.type, 'SESSION_READY', '消息类型应原样保留');
    assert.strictEqual(posted[0].message.source, 'practice_page', '消息来源应保持 practice_page');
    assert.deepStrictEqual(hookArgs, ['beforeSendMessage', 'SESSION_READY', { ok: true }], '发送前应调用 beforeSendMessage hook');
}

function testSendMessageQueuesPracticeCompleteWhenParentMissing() {
    const harness = createHarness();
    harness.enhancer.parentWindow = null;
    harness.enhancer.readOnly = false;

    harness.enhancer.sendMessage('PRACTICE_COMPLETE', {
        examId: 'reading-p1',
        sessionId: 'session-no-parent',
        scoreInfo: { correct: 2, total: 3, accuracy: 2 / 3, percentage: 67 }
    });

    const raw = harness.windowStub.localStorage.getItem('exam_system_pending_practice_messages_v1');
    assert.ok(raw, '无父窗口时应把 PRACTICE_COMPLETE 写入待处理队列');
    const queue = JSON.parse(raw);
    assert.ok(Array.isArray(queue) && queue.length === 1, '待处理队列应追加一条消息');
    assert.strictEqual(queue[0].message.type, 'PRACTICE_COMPLETE', '待处理队列中的消息类型应保持 PRACTICE_COMPLETE');
    assert.ok(
        String(harness.windowStub.name || '').startsWith('__exam_pending_practice_v1__'),
        '无父窗口时应同步写入 window.name 持久化通道'
    );
}

function testSendMessageQueuesPracticeCompleteWhenParentIsSelf() {
    const harness = createHarness();
    harness.enhancer.parentWindow = harness.windowStub;
    harness.enhancer.readOnly = false;

    harness.enhancer.sendMessage('PRACTICE_COMPLETE', {
        examId: 'reading-p2',
        sessionId: 'session-self-parent',
        scoreInfo: { correct: 3, total: 5, accuracy: 0.6, percentage: 60 }
    });

    const raw = harness.windowStub.localStorage.getItem('exam_system_pending_practice_messages_v1');
    assert.ok(raw, 'parentWindow===window 时也应写入待处理队列');
    const queue = JSON.parse(raw);
    assert.ok(Array.isArray(queue) && queue.length === 1, 'self-parent 场景应有一条待处理消息');
    assert.strictEqual(queue[0].message.type, 'PRACTICE_COMPLETE', 'self-parent 场景消息类型应保持 PRACTICE_COMPLETE');
    assert.ok(
        String(harness.windowStub.name || '').startsWith('__exam_pending_practice_v1__'),
        'self-parent 场景也应同步写入 window.name 持久化通道'
    );
}
function testApplyReplayRecordRestoresMarkedQuestions() {
    const harness = createHarness();
    let reviewModeArg = null;
    let replayApplied = null;
    let dispatchedPayload = null;

    harness.enhancer.examId = 'p1';
    harness.enhancer.buildReplayResultsFromEntry = () => ({
        answers: { q1: 'A' },
        correctAnswers: { q1: 'A' },
        answerComparison: {
            q1: {
                userAnswer: 'A',
                correctAnswer: 'A',
                isCorrect: true
            }
        },
        scoreInfo: {
            correct: 1,
            total: 1,
            percentage: 100
        }
    });
    harness.enhancer.setReviewMode = (value) => {
        reviewModeArg = value;
    };
    harness.enhancer.applyReplayAnswersToDom = (answers) => {
        replayApplied = answers;
    };
    harness.enhancer.dispatchPracticeResultsEvent = (payload) => {
        dispatchedPayload = payload;
    };
    harness.enhancer.hasRenderableResults = () => true;
    harness.enhancer.renderReplayFallbackTable = () => {
        throw new Error('可渲染结果存在时不应走 fallback table');
    };

    harness.enhancer.applyReplayRecord({
        reviewSessionId: 'review-1',
        reviewEntryIndex: 2,
        markedQuestions: ['q1', '2'],
        entry: {
            examId: 'p1',
            metadata: {
                source: 'replay'
            }
        }
    });

    assert.strictEqual(reviewModeArg, true, '回放应强制进入只读 review mode');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(replayApplied)), { q1: 'A' }, '回放应把答案写回 DOM');
    assert.deepStrictEqual(harness.markedQuestionsCalls, [['q1', '2']], '回放应恢复 marked questions');
    assert.strictEqual(harness.enhancer.reviewViewMode, 'review', '回放后视图模式应为 review');
    assert.strictEqual(harness.enhancer.reviewSessionId, 'review-1', '回放应保存 reviewSessionId');
    assert.strictEqual(harness.enhancer.reviewEntryIndex, 2, '回放应保存 reviewEntryIndex');
    assert.strictEqual(dispatchedPayload.metadata.replay, true, '回放结果事件应打 replay 标记');
    assert.strictEqual(dispatchedPayload.metadata.readOnly, true, '回放结果事件应强制只读');
}
function testApplyReplayRecordSchedulesReplayFallbackOnce() {
    const harness = createHarness({ immediateTimers: true });
    let fallbackRenderCount = 0;

    harness.enhancer.examId = 'p1';
    harness.enhancer.buildReplayResultsFromEntry = () => ({
        answers: { q1: 'A' },
        correctAnswers: { q1: 'A' },
        answerComparison: {
            q1: {
                questionId: 'q1',
                userAnswer: 'A',
                correctAnswer: 'A',
                isCorrect: true
            }
        },
        scoreInfo: {
            correct: 1,
            total: 1,
            percentage: 100
        }
    });
    harness.enhancer.applyReplayAnswersToDom = () => {};
    harness.enhancer.hasRenderableResults = () => false;
    harness.enhancer.renderReplayFallbackTable = () => {
        fallbackRenderCount += 1;
    };

    harness.enhancer.applyReplayRecord({
        reviewSessionId: 'review-2',
        markedQuestions: ['q1'],
        entry: {
            examId: 'p1'
        }
    });

    assert.strictEqual(harness.dispatchedEvents.length, 1, '回放结果应只派发一次 practiceResultsReady');
    assert.strictEqual(fallbackRenderCount, 1, '回放 fallback table 只应调度一次');
}
function testResultsMonitoringAndScoreContracts() {
    const harness = createHarness();
    const calls = { extract: 0, collect: 0, submit: 0 };
    const retries = [];
    const states = [
        { hasDataRows: true, text: 'Final Score: 50% (1/2)' },
        { hasDataRows: false, text: 'Final Score: 50% (1/2)' },
        { hasDataRows: false, text: 'Accuracy: 85%', resultsEl: { querySelectorAll: () => [] } }
    ];
    harness.enhancer.correctAnswers = {};
    harness.enhancer.extractFromResultsTable = () => { calls.extract += 1; harness.enhancer.correctAnswers.q1 = 'A'; };
    harness.enhancer.collectAllAnswers = () => { calls.collect += 1; };
    harness.enhancer.handleSubmit = () => { calls.submit += 1; };
    harness.enhancer.readResultsState = () => states.shift() || { hasDataRows: false, text: '', resultsEl: { querySelectorAll: () => [] } };
    harness.enhancer.retryUntil = (task, options) => { retries.push(options); task(); };
    harness.enhancer.startCorrectAnswerMonitoring();
    harness.enhancer.startResultsMonitoring();
    const score = harness.enhancer.extractScore();
    assert.strictEqual(calls.extract, 1, '结果表可读时应触发正确答案提取');
    assert.strictEqual(calls.collect, 1, 'Final Score 出现时应触发答案收集');
    assert.strictEqual(calls.submit, 1, 'Final Score 出现时应触发提交流程');
    assert.strictEqual(retries[0].maxTries, 30, 'correct answer monitoring 重试上限应保持兼容');
    assert.strictEqual(retries[1].maxTries, 60, 'results monitoring 重试上限应保持兼容');
    assert.strictEqual(score.source, 'accuracy_percentage_extraction', 'extractScore 应保持 Accuracy 提取合同');
    assert.strictEqual(score.percentage, 85, 'extractScore 应保持百分比结果');
}
function testSuiteComparisonScoreAndPayloadContracts() {
    const harness = createHarness();
    const messages = [];

    harness.enhancer.examId = 'exam-suite';
    harness.enhancer.sessionId = 'session-suite';
    harness.enhancer.answers = {
        'set1::q1': 'A',
        'set1::q2': 'B',
        'set2::q1': 'C'
    };
    harness.enhancer.correctAnswers = {
        'set1::q1': 'A',
        'set1::q2': 'C',
        'q2': 'C'
    };
    harness.enhancer.sendMessage = (type, payload) => { messages.push({ type, payload }); };

    const comparison = harness.enhancer.generateSuiteAnswerComparison('set1');
    assert.deepStrictEqual(Object.keys(comparison).sort(), ['q1', 'q2'], 'suite comparison 应只包含当前套题键');
    assert.strictEqual(comparison.q1.isCorrect, true, 'suite comparison 应保持 compareAnswers 合同');
    assert.strictEqual(comparison.q2.isCorrect, false, 'suite comparison 应保持 compareAnswers 合同');

    const suiteScore = harness.enhancer.calculateSuiteScore(comparison);
    assert.strictEqual(suiteScore.correct, 1, 'suite score 应正确统计正确题数');
    assert.strictEqual(suiteScore.total, 2, 'suite score 应正确统计总题数');
    assert.strictEqual(suiteScore.percentage, 50, 'suite score 百分比应保持兼容');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(suiteScore, 'source'), false, 'suite score 不应引入 comparison source 字段');

    const fallbackScore = harness.enhancer.calculateScoreFromComparison({}, { allowEmpty: true });
    assert.strictEqual(fallbackScore.source, 'comparison_fallback', 'compare-score fallback source 应保持 comparison_fallback');

    harness.enhancer.sendSuiteCompleteMessage('set1', comparison, suiteScore, [{ token: 'sp1' }]);
    assert.strictEqual(messages.length, 1, 'suite complete 应发送一次 PRACTICE_COMPLETE');
    assert.strictEqual(messages[0].type, 'PRACTICE_COMPLETE', 'suite complete 消息类型应保持 PRACTICE_COMPLETE');
    const normalizedAnswers = JSON.parse(JSON.stringify(messages[0].payload.answers));
    const normalizedCorrectAnswers = JSON.parse(JSON.stringify(messages[0].payload.correctAnswers));
    assert.deepStrictEqual(normalizedAnswers, { q1: 'A', q2: 'B' }, 'suite payload answers 应保持去前缀合同');
    assert.deepStrictEqual(normalizedCorrectAnswers, { q1: 'A', q2: 'C' }, 'suite payload correctAnswers 应保持去前缀合同');
    assert.strictEqual(messages[0].payload.scoreInfo.percentage, 50, 'suite payload scoreInfo 应保持兼容');
    assert.deepStrictEqual(messages[0].payload.spellingErrors, [{ token: 'sp1' }], 'suite payload spellingErrors 应保持透传合同');
    assert.strictEqual(messages[0].payload.questionTypePerformance.unknown.total, 2, 'suite payload 题型映射缺失时应归入 unknown');
    assert.strictEqual(Boolean(messages[0].payload.questionTypePerformance.general), false, 'suite payload 不应引入 general 兜底');
    assert.ok(Array.isArray(messages[0].payload.questionTimelineLite), 'suite payload 应补充 questionTimelineLite');
    assert.ok(messages[0].payload.analysisSignals && typeof messages[0].payload.analysisSignals === 'object', 'suite payload 应补充 analysisSignals');

    harness.enhancer.sendSuiteCompleteMessage('set1', comparison, null, []);
    assert.strictEqual(messages[1].payload.scoreInfo.percentage, 50, 'suite payload 缺省 scoreInfo 时应走 comparison 计算且保持百分比');
}

function testBuildResultsPayloadAddsAnalyticsAndUnknownTypeFallback() {
    const harness = createHarness();
    const now = Date.now();

    harness.windowStub.practicePageMetadata = {
        questionGroups: [
            {
                kind: 'single_choice',
                questionIds: ['q1']
            }
        ]
    };
    harness.enhancer.sessionId = 'session-analytics';
    harness.enhancer.examId = 'exam-analytics';
    harness.enhancer.startTime = now - 120000;
    harness.enhancer.answers = { q1: 'B', q2: 'C' };
    harness.enhancer.correctAnswers = { q1: 'A', q2: 'C', q3: 'D' };
    harness.enhancer.interactions = [
        { type: 'answer', questionId: 'q1', value: 'A', timestamp: now - 100000 },
        { type: 'answer', questionId: 'q1', value: 'B', timestamp: now - 90000 },
        { type: 'answer', questionId: 'q2', value: 'C', timestamp: now - 80000 },
        { type: 'click', timestamp: now - 70000 }
    ];
    harness.enhancer.captureQuestionSet = () => ['q1', 'q2', 'q3'];

    const payload = harness.enhancer.buildResultsPayload({
        includeComparison: true,
        includeScore: false
    });

    assert.strictEqual(payload.answerComparison.q2.isCorrect, true, 'answerComparison 语义应保持');
    assert.strictEqual(payload.analysisSignals.unansweredCount, 1, 'analysisSignals 应统计未作答数量');
    assert.strictEqual(payload.analysisSignals.changedAnswerCount, 1, 'analysisSignals 应统计改答题数量');
    assert.ok(Number.isFinite(payload.analysisSignals.interactionDensity), 'analysisSignals.interactionDensity 应为数值');
    assert.ok(payload.analysisSignals.interactionDensity > 0, 'analysisSignals.interactionDensity 应大于 0');

    const q1Timeline = payload.questionTimelineLite.find((item) => item.questionId === 'q1');
    const q3Timeline = payload.questionTimelineLite.find((item) => item.questionId === 'q3');
    assert.strictEqual(q1Timeline.changeCount, 1, 'questionTimelineLite 应记录题目改答次数');
    assert.ok(q1Timeline.firstAnsweredAt && q1Timeline.lastAnsweredAt, 'questionTimelineLite 应记录已答题时间');
    assert.strictEqual(q3Timeline.firstAnsweredAt, null, '未作答题 firstAnsweredAt 应为 null');

    assert.strictEqual(payload.questionTypePerformance.single_choice.total, 1, '映射到 kind 的题目应在对应题型统计');
    assert.strictEqual(payload.questionTypePerformance.unknown.total, 2, '未映射题目应归入 unknown');
    assert.strictEqual(Boolean(payload.questionTypePerformance.general), false, '题型兜底不应使用 general');
}

function testCorrectAnswerExtractorKeepsSingleLetterChoices() {
    const harness = createHarness();
    const extractor = new harness.windowStub.CorrectAnswerExtractor();
    const normalized = extractor.normalizeAnswers({
        1: 'F',
        2: 'T',
        3: 'Y',
        4: 'N',
        5: 'NO',
        6: 'yes',
        7: 'A'
    });

    assert.deepStrictEqual(
        JSON.parse(JSON.stringify(normalized)),
        {
            q1: 'F',
            q2: 'T',
            q3: 'Y',
            q4: 'N',
            q5: 'FALSE',
            q6: 'TRUE',
            q7: 'A'
        },
        'CorrectAnswerExtractor 不应把单字母 F/T/Y/N 误映射成布尔值'
    );
}
function main() {
    try {
        testCollectAnswersNowDelegatesToEnhancer();
        testGetCorrectAnswersDelegatesToEnhancer();
        testSendMessageRespectsReadOnlyGuard();
        testSendMessageQueuesPracticeCompleteWhenParentMissing();
        testSendMessageQueuesPracticeCompleteWhenParentIsSelf();
        testApplyReplayRecordRestoresMarkedQuestions();
        testApplyReplayRecordSchedulesReplayFallbackOnce();
        testResultsMonitoringAndScoreContracts();
        testSuiteComparisonScoreAndPayloadContracts();
        testBuildResultsPayloadAddsAnalyticsAndUnknownTypeFallback();
        testCorrectAnswerExtractorKeepsSingleLetterChoices();
        console.log(JSON.stringify({
            status: 'pass',
            detail: 'practice-page-enhancer 已覆盖回放 marked questions、sendMessage 只读守卫、回放 fallback 单次调度、results monitoring、extractScore 与 suite submit payload 合同'
        }, null, 2));
    } catch (error) {
        console.log(JSON.stringify({
            status: 'fail',
            detail: error.message
        }, null, 2));
        process.exit(1);
    }
}

main();
