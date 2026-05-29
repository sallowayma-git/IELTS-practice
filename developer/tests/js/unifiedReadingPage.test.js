#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function createButton(id, label) {
    return {
        id,
        dataset: {},
        style: {},
        disabled: false,
        textContent: label,
        addEventListener() {},
        removeEventListener() {},
        setAttribute() {},
        getAttribute() { return null; }
    };
}

function createStorage() {
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

function createMinimalResults() {
    return {
        answers: { q1: 'A' },
        answerComparison: {
            q1: {
                questionId: 'q1',
                userAnswer: 'A',
                correctAnswer: 'B',
                isCorrect: false
            }
        },
        scoreInfo: {
            correct: 0,
            total: 1,
            totalQuestions: 1,
            percentage: 0
        },
        analysisSignals: {
            questionCount: 1,
            unansweredCount: 0,
            changedAnswerCount: 1,
            markedQuestionCount: 1,
            interactionDensity: 0.6
        },
        questionTimelineLite: [
            { questionId: 'q1', displayLabel: '1', changeCount: 2 }
        ],
        questionTypePerformance: {
            matching: {
                kind: 'matching',
                total: 1,
                correct: 0,
                accuracy: 0,
                questionIds: ['q1']
            }
        },
        singleAttemptAnalysisInput: {
            totalQuestions: 1,
            analysisSignals: {
                questionCount: 1,
                unansweredCount: 0,
                changedAnswerCount: 1,
                markedQuestionCount: 1,
                interactionDensity: 0.6
            },
            questionTimelineLite: [
                { questionId: 'q1', displayLabel: '1', changeCount: 2 }
            ],
            questionTypePerformance: {
                matching: { total: 1, correct: 0, accuracy: 0 }
            }
        },
        singleAttemptAnalysis: {
            summary: {
                accuracy: 0,
                durationSec: 100,
                unansweredRate: 0,
                changedAnswerRate: 0
            },
            radar: {
                byQuestionKind: [],
                byPassageCategory: []
            },
            diagnosis: [],
            nextActions: []
        },
        realData: {}
    };
}

function createHarness(options = {}) {
    const submitBtn = createButton('submit-btn', 'Submit');
    const resetBtn = createButton('reset-btn', 'Reset');
    const resultsContainer = {
        id: 'results',
        style: {},
        dataset: {},
        innerHTML: '',
        addEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; }
    };
    const postedMessages = [];
    const listeners = new Map();

    const appNodes = new Map();
    appNodes.set('exam-title', { textContent: '' });
    appNodes.set('exam-subtitle', { textContent: '' });
    appNodes.set('left', {
        innerHTML: '',
        textContent: '',
        contains: typeof options.leftContains === 'function' ? options.leftContains : (() => false),
        querySelectorAll() { return []; },
        ownerDocument: null
    });
    appNodes.set('question-groups', {
        innerHTML: '',
        textContent: '',
        contains: typeof options.questionGroupsContains === 'function' ? options.questionGroupsContains : (() => false),
        querySelectorAll() { return []; },
        ownerDocument: null
    });
    appNodes.set('results', resultsContainer);
    appNodes.set('question-nav', { innerHTML: '' });
    appNodes.set('submit-btn', submitBtn);
    appNodes.set('reset-btn', resetBtn);

    const documentStub = {
        title: 'Unified Reading Fixture',
        body: {
            dataset: {},
            classList: { toggle() {} },
            appendChild() {},
            insertAdjacentElement() {}
        },
        head: {
            appendChild() {}
        },
        addEventListener(type, handler) {
            listeners.set(type, handler);
        },
        removeEventListener(type) {
            listeners.delete(type);
        },
        getElementById(id) {
            return appNodes.get(id) || null;
        },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        createElement() {
            return {
                id: '',
                style: {},
                dataset: {},
                className: '',
                innerHTML: '',
                addEventListener() {},
                appendChild() {},
                querySelector() { return null; },
                querySelectorAll() { return []; },
                classList: { toggle() {} }
            };
        }
    };
    appNodes.get('left').ownerDocument = documentStub;
    appNodes.get('question-groups').ownerDocument = documentStub;

    const openerStub = {
        postMessage(message, origin) {
            postedMessages.push({ message, origin });
        }
    };

    const localStorage = createStorage();
    const sessionStorage = createStorage();

    const fetchImpl = typeof options.fetchImpl === 'function'
        ? options.fetchImpl
        : (async () => ({
            ok: true,
            headers: { get: () => 'application/json' },
            json: async () => ({ success: true, data: {} })
        }));

    const runtime = options.runtime === 'web' ? '' : '&runtime=electron';
    const windowStub = {
        document: documentStub,
        opener: openerStub,
        parent: openerStub,
        self: null,
        top: null,
        name: '',
        localStorage,
        sessionStorage,
        location: {
            href: `file:///Users/test/unified-reading.html?examId=p1-high-01${runtime}`,
            search: `?examId=p1-high-01${runtime}`,
            origin: 'null'
        },
        addEventListener() {},
        removeEventListener() {},
        getSelection() {
            return typeof options.getSelection === 'function' ? options.getSelection() : null;
        },
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        console: {
            log() {}, warn() {}, error() {}, info() {}
        },
        fetch: fetchImpl
    };

    if (options.electronAPI) {
        windowStub.electronAPI = options.electronAPI;
    }

    const sandbox = {
        window: windowStub,
        document: documentStub,
        console: windowStub.console,
        localStorage,
        sessionStorage,
        URLSearchParams,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        TextEncoder,
        TextDecoder,
        Date,
        Math,
        JSON,
        Map,
        Set,
        HTMLElement: function HTMLElement() {},
        HTMLInputElement: function HTMLInputElement() {},
        HTMLTextAreaElement: function HTMLTextAreaElement() {},
        HTMLSelectElement: function HTMLSelectElement() {},
        fetch: fetchImpl
    };
    sandbox.globalThis = sandbox.window;
    sandbox.window.window = sandbox.window;
    sandbox.window.self = sandbox.window;
    sandbox.window.top = sandbox.window;
    sandbox.window.fetch = fetchImpl;

    const fullPath = path.join(repoRoot, 'js/runtime/unifiedReadingPage.js');
    let source = fs.readFileSync(fullPath, 'utf8');
    source = source.replace(
        /\}\)\(typeof window !== 'undefined' \? window : globalThis\);\s*$/,
        "global.__UNIFIED_READING_TEST_HOOKS__ = { state, captureDom, stopInitLoop, renderResults, sendReadingCoachQuery, ensureReadingCoachUi, buildReadingCoachRequestPayload, buildResults, buildReplayResults, compareNodePaths, buildHighlightId, normalizeHighlightRecord, normalizeHighlightRecords, getPracticeMarkedQuestions, setPracticeMarkedQuestions }; })(typeof window !== 'undefined' ? window : globalThis);"
    );
    const context = vm.createContext(sandbox);
    vm.runInContext(source, context, { filename: 'js/runtime/unifiedReadingPage.js' });

    const hooks = context.window.__UNIFIED_READING_TEST_HOOKS__;
    hooks.captureDom();
    hooks.stopInitLoop();

    hooks.state.examId = 'p1-high-01';
    hooks.state.sessionId = 'session_1';
    hooks.state.lastResults = createMinimalResults();
    hooks.state.submitted = true;

    return {
        hooks,
        postedMessages,
        localStorage,
        sessionStorage
    };
}

async function testCoachQueryViaElectronLocalApi() {
    let fetchCount = 0;
    const harness = createHarness({
        electronAPI: {
            async getLocalApiInfo() {
                return {
                    success: true,
                    data: { baseUrl: 'http://127.0.0.1:3905' }
                };
            }
        },
        fetchImpl: async (url, init) => {
            fetchCount += 1;
            assert.ok(String(url).includes('/api/reading/assistant/query/stream'), '应请求新的阅读教练 assistant stream 接口');
            const payload = JSON.parse(init.body);
            assert.strictEqual(payload.examId, 'p1-high-01', '应透传 examId');
            assert.strictEqual(payload.sessionId, 'session_1', '应透传 sessionId 以便后端回写练习记录');
            assert.strictEqual(payload.mode, 'single', '应透传练习模式');
            assert.strictEqual(payload.surface, 'chat_widget', '浮动面板自由提问不应默认伪装成 review_workspace');
            assert.strictEqual(payload.attemptContext?.selectedAnswers?.['1'], 'A', '应把用户答案传给教练服务');
            assert.ok(Array.isArray(payload.attemptContext?.wrongQuestions), '应传递错题题号数组');
            assert.strictEqual(payload.attemptContext.wrongQuestions[0], '1', '应把错题题号传给教练服务');
            assert.strictEqual(payload.attemptContext.analysisSignals.changedAnswerCount, 1, '应把行为分析信号传给教练服务');
            assert.deepStrictEqual(payload.attemptContext.markedQuestions, ['q1'], '应把标记题传给教练服务');
            assert.strictEqual(payload.attemptContext.questionTimelineLite[0].changeCount, 2, '应把答题时间线传给教练服务');
            assert.strictEqual(payload.attemptContext.questionTypePerformance.matching.total, 1, '应把题型表现传给教练服务');
            return {
                ok: true,
                headers: {
                    get(name) {
                        return String(name || '').toLowerCase() === 'content-type' ? 'application/json' : '';
                    }
                },
                async json() {
                    return {
                        success: true,
                        data: {
                            answer: '先定位题干关键词，再回原文找同义替换。',
                            answerSections: [
                                { type: 'direct_answer', text: '先定位题干关键词，再回原文找同义替换。' }
                            ],
                            followUps: ['这题证据在哪段', '我下一步练什么'],
                            confidence: 'high',
                            missingContext: [],
                            generatedAt: new Date().toISOString()
                        }
                    };
                }
            }
        }
    });
    harness.hooks.setPracticeMarkedQuestions(['q1']);

    await harness.hooks.sendReadingCoachQuery('这题怎么做？', { action: 'chat', promptKind: 'freeform' });

    assert.strictEqual(fetchCount, 1, '应调用一次本地 assistant HTTP 接口');
    assert.ok(harness.hooks.state.readingCoachSnapshot, '应写入 readingCoachSnapshot');
    assert.ok(Array.isArray(harness.hooks.state.readingCoachTranscript) && harness.hooks.state.readingCoachTranscript.length >= 2, '应累计对话转录');
    const patchMsg = harness.postedMessages.find((entry) => entry?.message?.type === 'PRACTICE_COACH_PATCH');
    assert.ok(patchMsg, '成功后应发送 PRACTICE_COACH_PATCH');
}

async function testCoachQueryViaLocalApiSse() {
    const completionPayload = {
        success: true,
        data: {
            answer: '先排除明显不符项，再找原文证据。',
            answerSections: [{ type: 'direct_answer', text: '先排除明显不符项，再找原文证据。' }],
            followUps: ['证据词有哪些'],
            confidence: 'medium',
            missingContext: []
        }
    };
    const fetchCalls = [];
    const harness = createHarness({
        runtime: 'web',
        fetchImpl: async (url) => {
            fetchCalls.push(String(url));
            return {
                ok: true,
                headers: {
                    get(name) {
                        return String(name || '').toLowerCase() === 'content-type' ? 'application/json' : '';
                    }
                },
                async json() {
                    return completionPayload;
                }
            };
        }
    });

    harness.localStorage.setItem('exam_system_local_api_info_v1', JSON.stringify({ baseUrl: 'http://127.0.0.1:3905' }));
    harness.hooks.state.readingCoachRequestId += 1;
    harness.hooks.state.readingCoachOpen = true;

    await harness.hooks.sendReadingCoachQuery('给我提示', { action: 'chat', promptKind: 'freeform' });

    assert.ok(fetchCalls[0].includes('/api/reading/assistant/query/stream'), '应请求新的教练 SSE 接口');
    assert.ok(harness.hooks.state.readingCoachSnapshot && harness.hooks.state.readingCoachSnapshot.answer, 'SSE 完成后应回填 snapshot');
}

async function testReviewPayloadUsesExplicitReviewWorkspaceOnly() {
    const harness = createHarness({ runtime: 'web' });
    const freeformPayload = harness.hooks.buildReadingCoachRequestPayload('第 1 题证据在哪', {
        action: 'chat',
        promptKind: 'freeform'
    });
    const reviewPayload = harness.hooks.buildReadingCoachRequestPayload('请复盘我的错题', {
        action: 'review_set',
        promptKind: 'preset',
        forceSubmitted: true
    });

    assert.strictEqual(freeformPayload.surface, 'chat_widget', '提交后自由提问仍应走 chat_widget');
    assert.strictEqual(reviewPayload.surface, 'review_workspace', '显式 review_set 才应走 review_workspace');
}

function testSelectionCoachPayloadCarriesQuestionContext() {
    const groupNode = {
        dataset: { questionIds: 'q11,q12' },
        getAttribute() { return null; }
    };
    const questionNode = {
        dataset: { questionId: 'q12' },
        id: 'q12-anchor',
        getAttribute(name) {
            if (name === 'data-question-id') return 'q12';
            if (name === 'id') return this.id;
            return null;
        },
        closest(selector) {
            if (selector === '[data-question], [data-question-id], [name], [id]') {
                return questionNode;
            }
            if (selector === '.unified-group[data-question-ids]') {
                return groupNode;
            }
            return null;
        }
    };
    const textNode = { nodeType: 3, parentElement: questionNode };
    const harness = createHarness({
        runtime: 'web',
        questionGroupsContains: (node) => node === questionNode,
        getSelection: () => ({
            toString: () => 'Animals were involved in importing tea.',
            anchorNode: textNode,
            focusNode: textNode
        })
    });
    harness.hooks.state.dataset = {
        questionDisplayMap: {
            q11: '11',
            q12: '12'
        }
    };

    const payload = harness.hooks.buildReadingCoachRequestPayload('解释选中的句子', {
        action: 'explain_selection',
        promptKind: 'preset'
    });

    assert.strictEqual(payload.surface, 'selection_popover', '选中文本工具必须走 selection_popover');
    assert.strictEqual(payload.selectedContext.scope, 'question', '题目区选中文本必须标记 question scope');
    assert.deepStrictEqual(Array.from(payload.selectedContext.questionNumbers), ['12', '11'], '选中文本上下文必须携带直接题号和题组题号');
    assert.deepStrictEqual(Array.from(payload.focusQuestionNumbers), ['12', '11'], '选区题号必须优先于旧错题焦点');
}

function testSelectionCoachPayloadCarriesPassageParagraphContext() {
    const paragraphWrapper = {
        dataset: {},
        textContent: 'B Tea consumption spread throughout Chinese culture.',
        getAttribute() { return null; },
        querySelector(selector) {
            if (selector === '[data-paragraph]') {
                return { dataset: { paragraph: 'B' } };
            }
            return null;
        },
        closest(selector) {
            if (selector === '[data-paragraph], .paragraph-wrapper') {
                return paragraphWrapper;
            }
            return null;
        }
    };
    const textNode = { nodeType: 3, parentElement: paragraphWrapper };
    const harness = createHarness({
        runtime: 'web',
        leftContains: (node) => node === paragraphWrapper,
        getSelection: () => ({
            toString: () => 'Tea consumption spread throughout Chinese culture.',
            anchorNode: textNode,
            focusNode: textNode
        })
    });

    const payload = harness.hooks.buildReadingCoachRequestPayload('定位这段证据', {
        action: 'locate_evidence',
        promptKind: 'preset'
    });

    assert.strictEqual(payload.surface, 'selection_popover', '原文选中文本工具必须走 selection_popover');
    assert.strictEqual(payload.selectedContext.scope, 'passage', '原文选中文本必须标记 passage scope');
    assert.deepStrictEqual(Array.from(payload.selectedContext.paragraphLabels), ['B'], '选中文本上下文必须携带段落 label');
}

function testHighlightHelpers() {
    const harness = createHarness({ runtime: 'web' });
    assert.ok(harness.hooks.compareNodePaths('1.2', '1.10') < 0, '节点路径比较应按数值顺序排序');
    assert.ok(harness.hooks.compareNodePaths('2.0', '1.9') > 0, '更靠后的路径应被判定为更大');

    const normalized = harness.hooks.normalizeHighlightRecord({
        scope: 'left',
        text: '  repeated   phrase ',
        kind: 'note',
        startPath: '1.10',
        startOffset: 3,
        endPath: '1.2',
        endOffset: 7
    });
    assert.strictEqual(normalized.scope, 'passage', '旧 scope 应归一为 passage');
    assert.strictEqual(normalized.kind, 'note', 'note 类型不应丢失');
    assert.strictEqual(normalized.text, 'repeated phrase', '文本应被压缩空白');
    assert.strictEqual(normalized.startPath, '1.2', '反向路径应被归一为正向顺序');
    assert.strictEqual(normalized.endPath, '1.10', '反向路径应被归一为正向顺序');
    assert.ok(typeof normalized.id === 'string' && normalized.id.includes('passage'), '应生成稳定 id');

    const replayResults = harness.hooks.buildReplayResults({
        answers: { q1: 'A' },
        correctAnswers: { q1: 'B' },
        metadata: {
            highlights: [{
                scope: 'groups',
                text: 'keyword clue',
                startPath: '0.1',
                startOffset: 0,
                endPath: '0.1',
                endOffset: 7
            }]
        }
    });
    assert.strictEqual(replayResults.highlights.length, 1, '回放结果应携带高亮');
    assert.strictEqual(replayResults.highlights[0].scope, 'questions', '回放高亮 scope 应完成归一化');

    const builtResults = harness.hooks.buildResults({ durationSec: 42 });
    assert.ok(Array.isArray(builtResults.highlights), '构建结果时应始终输出 highlights 数组');
    assert.ok(Array.isArray(builtResults.realData.highlights), 'realData 中也应同步输出 highlights');
}

function testMarkedQuestionsContractLivesInUnifiedPage() {
    const harness = createHarness({ runtime: 'web' });
    harness.hooks.state.dataKey = 'reading-p1';

    harness.hooks.setPracticeMarkedQuestions(['Q1-anchor', '2', 'q2-target', null, '']);

    assert.deepStrictEqual(
        Array.from(harness.hooks.getPracticeMarkedQuestions()),
        ['q1', 'q2'],
        '统一阅读页应直接维护 marked questions 合同'
    );
    assert.strictEqual(
        harness.sessionStorage.getItem('practice_marked_questions::reading-p1'),
        JSON.stringify(['q1', 'q2']),
        '统一阅读页应直接持久化 marked questions'
    );
}

async function main() {
    try {
        await testCoachQueryViaElectronLocalApi();
        await testCoachQueryViaLocalApiSse();
        await testReviewPayloadUsesExplicitReviewWorkspaceOnly();
        testSelectionCoachPayloadCarriesQuestionContext();
        testSelectionCoachPayloadCarriesPassageParagraphContext();
        testHighlightHelpers();
        testMarkedQuestionsContractLivesInUnifiedPage();
        console.log(JSON.stringify({
            status: 'pass',
            detail: 'UnifiedReadingPage 已覆盖阅读教练查询、高亮回放与标记题目数据结构主链路'
        }, null, 2));
    } catch (error) {
        console.log(JSON.stringify({
            status: 'fail',
            detail: error && error.stack ? error.stack : String(error)
        }, null, 2));
        process.exit(1);
    }
}

main();
