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
        _attrs: new Map(),
        addEventListener() {},
        removeEventListener() {},
        setAttribute(name, value) {
            this._attrs.set(String(name), String(value));
        },
        getAttribute(name) {
            return this._attrs.has(String(name)) ? this._attrs.get(String(name)) : null;
        }
    };
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
    const submitBtn = createButton('submit-btn', 'Submit');
    const resetBtn = createButton('reset-btn', 'Reset');
    const resultsContainer = {
        id: 'results',
        style: {},
        innerHTML: '',
        dataset: {},
        addEventListener() {},
        querySelector() { return null; }
    };
    const postedMessages = [];
    const suiteModeCalls = [];
    const listeners = new Map();

    const documentStub = {
        title: 'Unified Reading Fixture',
        body: {
            dataset: {},
            classList: {
                toggle() {}
            },
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
            if (id === 'submit-btn') return submitBtn;
            if (id === 'reset-btn') return resetBtn;
            if (id === 'results') return resultsContainer;
            return null;
        },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        createElement() {
            return {
                id: '',
                style: {},
                dataset: {},
                innerHTML: '',
                appendChild() {},
                addEventListener() {},
                querySelector() { return null; }
            };
        }
    };

    const openerStub = {
        postMessage(message, origin) {
            postedMessages.push({ message, origin });
        }
    };
    const localStorage = createWebStorage();
    const sessionStorage = createWebStorage();
    let electronOpenLegacyCalls = 0;
    let closeCalls = 0;
    const fetchImpl = typeof options.fetchImpl === 'function'
        ? options.fetchImpl
        : (async () => {
            throw new Error('fetch not mocked');
        });

    const windowStub = {
        document: documentStub,
        opener: options.noParent ? null : openerStub,
        parent: options.noParent ? null : openerStub,
        name: '',
        localStorage,
        sessionStorage,
        location: {
            href: 'file:///Users/test/unified-reading.html?examId=p1',
            search: '?examId=p1',
            origin: 'null'
        },
        close() {
            closeCalls += 1;
        },
        addEventListener() {},
        removeEventListener() {},
        updatePracticeSuiteModeUI(value) {
            suiteModeCalls.push(Boolean(value));
        },
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        console: {
            log() {},
            warn() {},
            error() {},
            info() {}
        }
    };
    if (options.withElectronAPI) {
        const electronAPI = {
            openLegacy() {
                electronOpenLegacyCalls += 1;
            }
        };
        if (options.includeLocalApiInfo !== false) {
            electronAPI.getLocalApiInfo = async () => ({
                success: true,
                data: {
                    baseUrl: options.localApiBaseUrl || 'http://127.0.0.1:3000'
                }
            });
        }
        if (options.enableReadingAnalysisIpc !== false) {
            electronAPI.analyzeReadingSingleAttempt = async (payload) => {
                if (typeof options.analyzeReadingSingleAttempt === 'function') {
                    return options.analyzeReadingSingleAttempt(payload);
                }
                throw new Error('analyzeReadingSingleAttempt not mocked');
            };
        }
        windowStub.electronAPI = electronAPI;
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
    sandbox.window.URLSearchParams = URLSearchParams;
    sandbox.window.fetch = fetchImpl;

    const fullPath = path.join(repoRoot, 'js/runtime/unifiedReadingPage.js');
    let source = fs.readFileSync(fullPath, 'utf8');
    source = source.replace(
        /\}\)\(typeof window !== 'undefined' \? window : globalThis\);\s*$/,
        "global.__UNIFIED_READING_TEST_HOOKS__ = { state, captureDom, syncPrimaryActionButtons, syncSuiteModeState, handleIncoming, buildEnvelope, buildReviewNavigatePayload, buildQuestionTypePerformance, buildQuestionTimelineLite, buildAnalysisSignals, buildResults, renderResults, trackAnswerTimeline, stopInitLoop, postMessage, mergeSingleAttemptAnalysis, triggerSingleAttemptLlmAnalysis }; })(typeof window !== 'undefined' ? window : globalThis);"
    );
    const context = vm.createContext(sandbox);
    vm.runInContext(source, context, { filename: 'js/runtime/unifiedReadingPage.js' });
    const hooks = context.window.__UNIFIED_READING_TEST_HOOKS__;
    hooks.captureDom();
    hooks.stopInitLoop();

    return {
        hooks,
        windowStub,
        submitBtn,
        resetBtn,
        postedMessages,
        suiteModeCalls,
        resultsContainer,
        localStorage,
        getElectronOpenLegacyCalls() {
            return electronOpenLegacyCalls;
        },
        getCloseCalls() {
            return closeCalls;
        }
    };
}

async function testSingleAttemptLlmAnalysisPatchFlow() {
    const fetchCalls = [];
    const harness = createHarness({
        withElectronAPI: false,
        fetchImpl: async (url, init) => {
            fetchCalls.push({ url, init });
            return {
                ok: true,
                async json() {
                    return {
                        success: true,
                        data: {
                            diagnosis: [
                                {
                                    code: 'weak_accuracy',
                                    reason: '题型「摘要填空」正确率偏低（2/6）。',
                                    evidence: ['summary_completion: 33%']
                                },
                                {
                                    code: 'time_pressure',
                                    reason: '未作答率过高，存在时间分配问题。',
                                    evidence: ['unansweredRate: 0.2']
                                }
                            ],
                            nextActions: [
                                {
                                    type: 'targeted_drill',
                                    target: 'summary_completion',
                                    instruction: '先做 10 道摘要填空限时训练。',
                                    evidence: ['summary_completion accuracy low']
                                },
                                {
                                    type: 'time_management',
                                    target: 'overall',
                                    instruction: '先扫易题再回难题，保证全题作答。',
                                    evidence: ['unansweredRate high']
                                }
                            ],
                            confidence: 0.76,
                            generatedAt: '2026-04-10T00:00:00.000Z'
                        }
                    };
                }
            };
        }
    });
    harness.windowStub.location.search = '?examId=reading-p1&localApiBaseUrl=http%3A%2F%2F127.0.0.1%3A3900';
    harness.hooks.state.examId = 'reading-p1';
    harness.hooks.state.sessionId = 'session-llm-1';
    const results = {
        answers: { q1: 'A' },
        answerComparison: {
            q1: { questionId: 'q1', userAnswer: 'A', correctAnswer: 'B', isCorrect: false }
        },
        scoreInfo: {
            correct: 0,
            total: 1,
            totalQuestions: 1,
            percentage: 0
        },
        singleAttemptAnalysisInput: {
            totalQuestions: 1,
            analysisSignals: {
                unansweredCount: 0,
                changedAnswerCount: 0
            },
            questionTypePerformance: {
                summary_completion: {
                    total: 1,
                    correct: 0,
                    accuracy: 0,
                    confidence: 0.5
                }
            }
        },
        singleAttemptAnalysis: {
            summary: {
                accuracy: 0,
                durationSec: 75,
                unansweredRate: 0,
                changedAnswerRate: 0
            },
            radar: {
                byQuestionKind: [
                    {
                        kind: 'summary_completion',
                        total: 1,
                        correct: 0,
                        accuracy: 0,
                        confidence: 0.5
                    }
                ],
                byPassageCategory: []
            },
            diagnosis: [
                { code: 'fallback', reason: '结构化诊断', evidence: {} }
            ],
            nextActions: [
                { type: 'fallback', target: 'overall', instruction: '结构化建议', evidence: {} }
            ],
            confidence: 0.5
        },
        realData: {}
    };

    await harness.hooks.triggerSingleAttemptLlmAnalysis(results);
    assert.strictEqual(fetchCalls.length, 1, '应调用一次二阶段分析接口');
    assert.strictEqual(harness.hooks.state.llmAnalysisStatus, 'success', '二阶段成功后状态应为 success');
    assert.ok(results.singleAttemptAnalysisLlm, '成功后应回填 singleAttemptAnalysisLlm');
    assert.strictEqual(harness.postedMessages[harness.postedMessages.length - 1].message.type, 'PRACTICE_ANALYSIS_PATCH', '成功后应发送分析补丁消息');
}

async function testSingleAttemptLlmAnalysisPrefersElectronIpc() {
    const ipcCalls = [];
    const fetchCalls = [];
    const harness = createHarness({
        withElectronAPI: true,
        analyzeReadingSingleAttempt: async (payload) => {
            ipcCalls.push(payload);
            return {
                success: true,
                data: {
                    diagnosis: [],
                    nextActions: [],
                    confidence: 0.61
                }
            };
        },
        fetchImpl: async (url) => {
            fetchCalls.push(url);
            throw new Error('fetch should not be used when IPC is available');
        }
    });
    harness.hooks.state.examId = 'reading-p1';
    harness.hooks.state.sessionId = 'session-llm-ipc-1';
    const results = {
        answers: { q1: 'A' },
        answerComparison: {
            q1: { questionId: 'q1', userAnswer: 'A', correctAnswer: 'B', isCorrect: false }
        },
        scoreInfo: {
            correct: 0,
            total: 1,
            totalQuestions: 1,
            percentage: 0
        },
        singleAttemptAnalysisInput: {
            totalQuestions: 1,
            analysisSignals: { unansweredCount: 0, changedAnswerCount: 0 },
            questionTypePerformance: {
                summary_completion: { total: 1, correct: 0, accuracy: 0, confidence: 0.5 }
            }
        },
        singleAttemptAnalysis: {
            summary: { accuracy: 0, durationSec: 75, unansweredRate: 0, changedAnswerRate: 0 },
            radar: { byQuestionKind: [{ kind: 'summary_completion', total: 1, correct: 0, accuracy: 0, confidence: 0.5 }], byPassageCategory: [] },
            diagnosis: [{ code: 'fallback', reason: '结构化诊断', evidence: {} }],
            nextActions: [{ type: 'fallback', target: 'overall', instruction: '结构化建议', evidence: {} }],
            confidence: 0.5
        },
        realData: {}
    };

    await harness.hooks.triggerSingleAttemptLlmAnalysis(results);
    assert.strictEqual(ipcCalls.length, 1, 'Electron 环境应优先走 IPC 分析通道');
    assert.strictEqual(fetchCalls.length, 0, 'Electron IPC 可用时不应退回 fetch');
    assert.strictEqual(harness.hooks.state.llmAnalysisStatus, 'success', 'IPC 成功后应进入 success 状态');
}

async function testSingleAttemptLlmAnalysisDegradedShowsRetryWithoutModelId() {
    const harness = createHarness({
        withElectronAPI: false,
        fetchImpl: async () => ({
            ok: true,
            async json() {
                return {
                    success: true,
                    data: {
                        diagnosis: [],
                        nextActions: [],
                        confidence: 0.45,
                        model_trace: {
                            provider: 'openai',
                            model: 'MiniMax-M2.7-free',
                            degraded: true
                        }
                    }
                };
            }
        })
    });
    harness.windowStub.location.search = '?examId=reading-p1&localApiBaseUrl=http%3A%2F%2F127.0.0.1%3A3900';
    harness.hooks.state.examId = 'reading-p1';
    harness.hooks.state.sessionId = 'session-llm-degraded';
    const results = {
        answers: { q1: 'A' },
        answerComparison: {
            q1: { questionId: 'q1', userAnswer: 'A', correctAnswer: 'B', isCorrect: false }
        },
        scoreInfo: {
            correct: 0,
            total: 1,
            totalQuestions: 1,
            percentage: 0
        },
        singleAttemptAnalysisInput: {
            totalQuestions: 1,
            analysisSignals: { unansweredCount: 0, changedAnswerCount: 0 },
            questionTypePerformance: {
                summary_completion: { total: 1, correct: 0, accuracy: 0, confidence: 0.5 }
            }
        },
        singleAttemptAnalysis: {
            summary: { accuracy: 0, durationSec: 75, unansweredRate: 0, changedAnswerRate: 0 },
            radar: { byQuestionKind: [{ kind: 'summary_completion', total: 1, correct: 0, accuracy: 0, confidence: 0.5 }], byPassageCategory: [] },
            diagnosis: [{ code: 'fallback', reason: '结构化诊断', evidence: {} }],
            nextActions: [{ type: 'fallback', target: 'overall', instruction: '结构化建议', evidence: {} }],
            confidence: 0.5
        },
        realData: {}
    };

    await harness.hooks.triggerSingleAttemptLlmAnalysis(results);
    assert.strictEqual(harness.hooks.state.llmAnalysisStatus, 'degraded', '降级响应应进入 degraded 状态');
    assert.ok(harness.hooks.state.llmAnalysisMessage.includes('AI 分析失败'), '降级状态应给出失败提示');
    assert.ok(!harness.hooks.state.llmAnalysisMessage.includes('MiniMax-M2.7-free'), '降级状态不应显示模型 ID');
    assert.ok(String(harness.resultsContainer.innerHTML || '').includes('重试 AI 分析'), '降级状态应展示重试按钮');
}

async function testSingleAttemptLlmAnalysisUsesRuntimeQueryBaseUrl() {
    const fetchCalls = [];
    const harness = createHarness({
        withElectronAPI: false,
        fetchImpl: async (url) => {
            fetchCalls.push(String(url));
            return {
                ok: true,
                async json() {
                    return {
                        success: true,
                        data: {
                            diagnosis: [],
                            nextActions: [],
                            confidence: 0.5
                        }
                    };
                }
            };
        }
    });
    harness.windowStub.location.search = '?examId=reading-p1&localApiBaseUrl=http%3A%2F%2F127.0.0.1%3A3911';
    harness.hooks.state.examId = 'reading-p1';
    harness.hooks.state.sessionId = 'session-query-base-url';
    const results = {
        answers: { q1: 'A' },
        answerComparison: {
            q1: { questionId: 'q1', userAnswer: 'A', correctAnswer: 'B', isCorrect: false }
        },
        scoreInfo: {
            correct: 0,
            total: 1,
            totalQuestions: 1,
            percentage: 0
        },
        singleAttemptAnalysisInput: {
            totalQuestions: 1,
            analysisSignals: { unansweredCount: 0, changedAnswerCount: 0 },
            questionTypePerformance: {
                summary_completion: { total: 1, correct: 0, accuracy: 0, confidence: 0.5 }
            }
        },
        singleAttemptAnalysis: {
            summary: { accuracy: 0, durationSec: 75, unansweredRate: 0, changedAnswerRate: 0 },
            radar: { byQuestionKind: [{ kind: 'summary_completion', total: 1, correct: 0, accuracy: 0, confidence: 0.5 }], byPassageCategory: [] },
            diagnosis: [{ code: 'fallback', reason: '结构化诊断', evidence: {} }],
            nextActions: [{ type: 'fallback', target: 'overall', instruction: '结构化建议', evidence: {} }],
            confidence: 0.5
        },
        realData: {}
    };

    await harness.hooks.triggerSingleAttemptLlmAnalysis(results);
    assert.strictEqual(fetchCalls.length, 1, 'query runtime baseUrl 应触发一次接口请求');
    assert.strictEqual(fetchCalls[0], 'http://127.0.0.1:3911/api/reading/single-attempt-analysis', '应优先使用 query 中的 localApiBaseUrl');
}

async function testSingleAttemptLlmAnalysisNetworkFailureUsesClearMessage() {
    const harness = createHarness({
        withElectronAPI: false,
        fetchImpl: async () => {
            throw new Error('Failed to fetch');
        }
    });
    harness.windowStub.location.search = '?examId=reading-p1&localApiBaseUrl=http%3A%2F%2F127.0.0.1%3A3900';
    harness.hooks.state.examId = 'reading-p1';
    harness.hooks.state.sessionId = 'session-network-failure';
    const results = {
        answers: { q1: 'A' },
        answerComparison: {
            q1: { questionId: 'q1', userAnswer: 'A', correctAnswer: 'B', isCorrect: false }
        },
        scoreInfo: {
            correct: 0,
            total: 1,
            totalQuestions: 1,
            percentage: 0
        },
        singleAttemptAnalysisInput: {
            totalQuestions: 1,
            analysisSignals: { unansweredCount: 0, changedAnswerCount: 0 },
            questionTypePerformance: {
                summary_completion: { total: 1, correct: 0, accuracy: 0, confidence: 0.5 }
            }
        },
        singleAttemptAnalysis: {
            summary: { accuracy: 0, durationSec: 75, unansweredRate: 0, changedAnswerRate: 0 },
            radar: { byQuestionKind: [{ kind: 'summary_completion', total: 1, correct: 0, accuracy: 0, confidence: 0.5 }], byPassageCategory: [] },
            diagnosis: [{ code: 'fallback', reason: '结构化诊断', evidence: {} }],
            nextActions: [{ type: 'fallback', target: 'overall', instruction: '结构化建议', evidence: {} }],
            confidence: 0.5
        },
        realData: {}
    };

    await harness.hooks.triggerSingleAttemptLlmAnalysis(results);
    assert.strictEqual(harness.hooks.state.llmAnalysisStatus, 'failed', '网络失败时应进入 failed 状态');
    assert.ok(harness.hooks.state.llmAnalysisMessage.includes('本地分析服务连接失败'), '网络失败文案应暴露明确诊断而不是 Failed to fetch');
}

async function testSingleAttemptLlmAnalysisIgnoresStaleCachedBaseUrlWhenElectronInfoAvailable() {
    const fetchCalls = [];
    const harness = createHarness({
        withElectronAPI: true,
        enableReadingAnalysisIpc: false,
        localApiBaseUrl: 'http://127.0.0.1:3905',
        fetchImpl: async (url) => {
            fetchCalls.push(String(url));
            return {
                ok: true,
                async json() {
                    return { success: true, data: { diagnosis: [], nextActions: [], confidence: 0.51 } };
                }
            };
        }
    });
    harness.localStorage.setItem('exam_system_local_api_info_v1', JSON.stringify({
        baseUrl: 'http://127.0.0.1:3999',
        updatedAt: Date.now() - 60000
    }));
    harness.windowStub.location.search = '?examId=reading-p1';
    harness.hooks.state.examId = 'reading-p1';
    harness.hooks.state.sessionId = 'session-stale-cache';
    const results = {
        answers: { q1: 'A' },
        answerComparison: { q1: { questionId: 'q1', userAnswer: 'A', correctAnswer: 'B', isCorrect: false } },
        scoreInfo: { correct: 0, total: 1, totalQuestions: 1, percentage: 0 },
        singleAttemptAnalysisInput: {
            totalQuestions: 1,
            analysisSignals: { unansweredCount: 0, changedAnswerCount: 0 },
            questionTypePerformance: { summary_completion: { total: 1, correct: 0, accuracy: 0, confidence: 0.5 } }
        },
        singleAttemptAnalysis: {
            summary: { accuracy: 0, durationSec: 75, unansweredRate: 0, changedAnswerRate: 0 },
            radar: { byQuestionKind: [{ kind: 'summary_completion', total: 1, correct: 0, accuracy: 0, confidence: 0.5 }], byPassageCategory: [] },
            diagnosis: [{ code: 'fallback', reason: '结构化诊断', evidence: {} }],
            nextActions: [{ type: 'fallback', target: 'overall', instruction: '结构化建议', evidence: {} }],
            confidence: 0.5
        },
        realData: {}
    };
    await harness.hooks.triggerSingleAttemptLlmAnalysis(results);
    assert.strictEqual(fetchCalls.length, 1, '应发起一次分析请求');
    assert.strictEqual(fetchCalls[0], 'http://127.0.0.1:3905/api/reading/single-attempt-analysis', '应优先使用 Electron 实时 localApiInfo，而不是旧缓存地址');
}

async function testSingleAttemptLlmAnalysisNetworkFailureClearsCachedBaseUrl() {
    const harness = createHarness({
        withElectronAPI: false,
        fetchImpl: async () => {
            throw new Error('Failed to fetch');
        }
    });
    harness.windowStub.location.search = '?examId=reading-p1';
    harness.localStorage.setItem('exam_system_local_api_info_v1', JSON.stringify({
        baseUrl: 'http://127.0.0.1:3999',
        updatedAt: Date.now()
    }));
    harness.hooks.state.examId = 'reading-p1';
    harness.hooks.state.sessionId = 'session-clear-cache';
    const results = {
        answers: { q1: 'A' },
        answerComparison: { q1: { questionId: 'q1', userAnswer: 'A', correctAnswer: 'B', isCorrect: false } },
        scoreInfo: { correct: 0, total: 1, totalQuestions: 1, percentage: 0 },
        singleAttemptAnalysisInput: {
            totalQuestions: 1,
            analysisSignals: { unansweredCount: 0, changedAnswerCount: 0 },
            questionTypePerformance: { summary_completion: { total: 1, correct: 0, accuracy: 0, confidence: 0.5 } }
        },
        singleAttemptAnalysis: {
            summary: { accuracy: 0, durationSec: 75, unansweredRate: 0, changedAnswerRate: 0 },
            radar: { byQuestionKind: [{ kind: 'summary_completion', total: 1, correct: 0, accuracy: 0, confidence: 0.5 }], byPassageCategory: [] },
            diagnosis: [{ code: 'fallback', reason: '结构化诊断', evidence: {} }],
            nextActions: [{ type: 'fallback', target: 'overall', instruction: '结构化建议', evidence: {} }],
            confidence: 0.5
        },
        realData: {}
    };

    await harness.hooks.triggerSingleAttemptLlmAnalysis(results);
    assert.strictEqual(
        harness.localStorage.getItem('exam_system_local_api_info_v1'),
        null,
        '网络失败后应清理缓存的 localApiBaseUrl，避免后续持续命中坏地址'
    );
}

async function testSingleAttemptLlmAnalysisUsesParentBridgeInElectronRuntime() {
    const fetchCalls = [];
    const harness = createHarness({
        withElectronAPI: false,
        fetchImpl: async (url) => {
            fetchCalls.push(String(url));
            throw new Error('fetch should not be used in electron runtime bridge mode');
        }
    });
    harness.windowStub.location.search = '?examId=reading-p1&runtime=electron';
    harness.hooks.state.examId = 'reading-p1';
    harness.hooks.state.sessionId = 'session-electron-bridge';
    const results = {
        answers: { q1: 'A' },
        answerComparison: { q1: { questionId: 'q1', userAnswer: 'A', correctAnswer: 'B', isCorrect: false } },
        scoreInfo: { correct: 0, total: 1, totalQuestions: 1, percentage: 0 },
        singleAttemptAnalysisInput: {
            totalQuestions: 1,
            analysisSignals: { unansweredCount: 0, changedAnswerCount: 0 },
            questionTypePerformance: { summary_completion: { total: 1, correct: 0, accuracy: 0, confidence: 0.5 } }
        },
        singleAttemptAnalysis: {
            summary: { accuracy: 0, durationSec: 75, unansweredRate: 0, changedAnswerRate: 0 },
            radar: { byQuestionKind: [{ kind: 'summary_completion', total: 1, correct: 0, accuracy: 0, confidence: 0.5 }], byPassageCategory: [] },
            diagnosis: [{ code: 'fallback', reason: '结构化诊断', evidence: {} }],
            nextActions: [{ type: 'fallback', target: 'overall', instruction: '结构化建议', evidence: {} }],
            confidence: 0.5
        },
        realData: {}
    };

    const pending = harness.hooks.triggerSingleAttemptLlmAnalysis(results);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const request = harness.postedMessages.find((entry) => entry && entry.message && entry.message.type === 'REQUEST_READING_ANALYSIS');
    assert.ok(request, 'electron runtime 下应向父页发送 REQUEST_READING_ANALYSIS');
    const requestId = request.message.data && request.message.data.requestId;
    assert.ok(requestId, '父页分析请求应携带 requestId');
    harness.hooks.handleIncoming({
        data: {
            type: 'READING_ANALYSIS_RESULT',
            data: {
                requestId,
                success: true,
                data: {
                    diagnosis: [],
                    nextActions: [],
                    confidence: 0.62
                }
            }
        }
    });

    await pending;
    assert.strictEqual(fetchCalls.length, 0, 'electron runtime 桥接链路不应走本地 fetch');
    assert.strictEqual(harness.hooks.state.llmAnalysisStatus, 'success', '父页分析桥返回成功后应进入 success 状态');
}

async function testSingleAttemptLlmAnalysisReportsUnavailableBridgeClearly() {
    const harness = createHarness({
        withElectronAPI: false,
        noParent: true,
        fetchImpl: async () => {
            throw new Error('fetch should not be used in electron runtime bridge mode');
        }
    });
    harness.windowStub.location.search = '?examId=reading-p1&runtime=electron';
    harness.hooks.state.examId = 'reading-p1';
    harness.hooks.state.sessionId = 'session-electron-unavailable';
    const results = {
        answers: { q1: 'A' },
        answerComparison: { q1: { questionId: 'q1', userAnswer: 'A', correctAnswer: 'B', isCorrect: false } },
        scoreInfo: { correct: 0, total: 1, totalQuestions: 1, percentage: 0 },
        singleAttemptAnalysisInput: {
            totalQuestions: 1,
            analysisSignals: { unansweredCount: 0, changedAnswerCount: 0 },
            questionTypePerformance: { summary_completion: { total: 1, correct: 0, accuracy: 0, confidence: 0.5 } }
        },
        singleAttemptAnalysis: {
            summary: { accuracy: 0, durationSec: 75, unansweredRate: 0, changedAnswerRate: 0 },
            radar: { byQuestionKind: [{ kind: 'summary_completion', total: 1, correct: 0, accuracy: 0, confidence: 0.5 }], byPassageCategory: [] },
            diagnosis: [{ code: 'fallback', reason: '结构化诊断', evidence: {} }],
            nextActions: [{ type: 'fallback', target: 'overall', instruction: '结构化建议', evidence: {} }],
            confidence: 0.5
        },
        realData: {}
    };

    await harness.hooks.triggerSingleAttemptLlmAnalysis(results);
    assert.strictEqual(harness.hooks.state.llmAnalysisStatus, 'failed', '缺少父页桥时应进入 failed 状态');
    assert.ok(
        harness.hooks.state.llmAnalysisMessage.includes('当前与主应用连接中断'),
        '桥不可用文案应明确指出连接中断，而不是统一成超时'
    );
    assert.ok(
        !harness.hooks.state.llmAnalysisMessage.includes('父页分析桥请求超时'),
        '桥不可用文案不应退化成超时提示'
    );
}

async function testSingleAttemptLlmAnalysisReportsInvalidBridgePayloadClearly() {
    const harness = createHarness({
        withElectronAPI: false,
        fetchImpl: async () => {
            throw new Error('fetch should not be used in electron runtime bridge mode');
        }
    });
    harness.windowStub.location.search = '?examId=reading-p1&runtime=electron';
    harness.hooks.state.examId = 'reading-p1';
    harness.hooks.state.sessionId = 'session-electron-invalid-payload';
    const results = {
        answers: { q1: 'A' },
        answerComparison: { q1: { questionId: 'q1', userAnswer: 'A', correctAnswer: 'B', isCorrect: false } },
        scoreInfo: { correct: 0, total: 1, totalQuestions: 1, percentage: 0 },
        singleAttemptAnalysisInput: {
            totalQuestions: 1,
            analysisSignals: { unansweredCount: 0, changedAnswerCount: 0 },
            questionTypePerformance: { summary_completion: { total: 1, correct: 0, accuracy: 0, confidence: 0.5 } }
        },
        singleAttemptAnalysis: {
            summary: { accuracy: 0, durationSec: 75, unansweredRate: 0, changedAnswerRate: 0 },
            radar: { byQuestionKind: [{ kind: 'summary_completion', total: 1, correct: 0, accuracy: 0, confidence: 0.5 }], byPassageCategory: [] },
            diagnosis: [{ code: 'fallback', reason: '结构化诊断', evidence: {} }],
            nextActions: [{ type: 'fallback', target: 'overall', instruction: '结构化建议', evidence: {} }],
            confidence: 0.5
        },
        realData: {}
    };

    const pending = harness.hooks.triggerSingleAttemptLlmAnalysis(results);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const request = harness.postedMessages.find((entry) => entry && entry.message && entry.message.type === 'REQUEST_READING_ANALYSIS');
    assert.ok(request, '无效 payload 测试前应先发送父页分析请求');
    const requestId = request.message.data && request.message.data.requestId;

    harness.hooks.handleIncoming({
        data: {
            type: 'READING_ANALYSIS_RESULT',
            data: {
                requestId,
                success: true,
                data: null
            }
        }
    });

    await pending;
    assert.strictEqual(harness.hooks.state.llmAnalysisStatus, 'failed', '无效 payload 应进入 failed 状态');
    assert.ok(
        harness.hooks.state.llmAnalysisMessage.includes('主应用返回的数据结构异常'),
        '无效 payload 文案应明确指出返回结构异常'
    );
}

async function testParentBridgeAcceptsMessageTypeAndPayloadEnvelope() {
    const harness = createHarness({
        withElectronAPI: false,
        fetchImpl: async () => {
            throw new Error('fetch should not be used in electron runtime bridge mode');
        }
    });
    harness.windowStub.location.search = '?examId=reading-p1&runtime=electron';
    harness.hooks.state.examId = 'reading-p1';
    harness.hooks.state.sessionId = 'session-envelope-compat';
    const results = {
        answers: { q1: 'A' },
        answerComparison: { q1: { questionId: 'q1', userAnswer: 'A', correctAnswer: 'B', isCorrect: false } },
        scoreInfo: { correct: 0, total: 1, totalQuestions: 1, percentage: 0 },
        singleAttemptAnalysisInput: {
            totalQuestions: 1,
            analysisSignals: { unansweredCount: 0, changedAnswerCount: 0 },
            questionTypePerformance: { summary_completion: { total: 1, correct: 0, accuracy: 0, confidence: 0.5 } }
        },
        singleAttemptAnalysis: {
            summary: { accuracy: 0, durationSec: 75, unansweredRate: 0, changedAnswerRate: 0 },
            radar: { byQuestionKind: [{ kind: 'summary_completion', total: 1, correct: 0, accuracy: 0, confidence: 0.5 }], byPassageCategory: [] },
            diagnosis: [{ code: 'fallback', reason: '结构化诊断', evidence: {} }],
            nextActions: [{ type: 'fallback', target: 'overall', instruction: '结构化建议', evidence: {} }],
            confidence: 0.5
        },
        realData: {}
    };

    const pending = harness.hooks.triggerSingleAttemptLlmAnalysis(results);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const request = harness.postedMessages.find((entry) => entry && entry.message && entry.message.type === 'REQUEST_READING_ANALYSIS');
    assert.ok(request, '兼容 envelope 测试前应先发送父页分析请求');
    const requestId = request.message.data && request.message.data.requestId;

    harness.hooks.handleIncoming({
        data: {
            messageType: 'READING_ANALYSIS_RESULT',
            requestId,
            payload: {
                success: true,
                data: {
                    diagnosis: [],
                    nextActions: [],
                    confidence: 0.67
                }
            }
        }
    });

    await pending;
    assert.strictEqual(harness.hooks.state.llmAnalysisStatus, 'success', 'messageType/payload envelope 应被兼容解析');
}

async function testParentBridgeAcceptsLegacyDirectAnalysisData() {
    const harness = createHarness({
        withElectronAPI: false,
        fetchImpl: async () => {
            throw new Error('fetch should not be used in electron runtime bridge mode');
        }
    });
    harness.windowStub.location.search = '?examId=reading-p1&runtime=electron';
    harness.hooks.state.examId = 'reading-p1';
    harness.hooks.state.sessionId = 'session-legacy-direct';
    const results = {
        answers: { q1: 'A' },
        answerComparison: { q1: { questionId: 'q1', userAnswer: 'A', correctAnswer: 'B', isCorrect: false } },
        scoreInfo: { correct: 0, total: 1, totalQuestions: 1, percentage: 0 },
        singleAttemptAnalysisInput: {
            totalQuestions: 1,
            analysisSignals: { unansweredCount: 0, changedAnswerCount: 0 },
            questionTypePerformance: { summary_completion: { total: 1, correct: 0, accuracy: 0, confidence: 0.5 } }
        },
        singleAttemptAnalysis: {
            summary: { accuracy: 0, durationSec: 75, unansweredRate: 0, changedAnswerRate: 0 },
            radar: { byQuestionKind: [{ kind: 'summary_completion', total: 1, correct: 0, accuracy: 0, confidence: 0.5 }], byPassageCategory: [] },
            diagnosis: [{ code: 'fallback', reason: '结构化诊断', evidence: {} }],
            nextActions: [{ type: 'fallback', target: 'overall', instruction: '结构化建议', evidence: {} }],
            confidence: 0.5
        },
        realData: {}
    };

    const pending = harness.hooks.triggerSingleAttemptLlmAnalysis(results);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const request = harness.postedMessages.find((entry) => entry && entry.message && entry.message.type === 'REQUEST_READING_ANALYSIS');
    assert.ok(request, 'legacy direct data 测试前应先发送父页分析请求');
    const requestId = request.message.data && request.message.data.requestId;

    harness.hooks.handleIncoming({
        data: {
            type: 'READING_ANALYSIS_RESULT',
            data: {
                requestId,
                diagnosis: [],
                nextActions: [],
                confidence: 0.73
            }
        }
    });

    await pending;
    assert.strictEqual(harness.hooks.state.llmAnalysisStatus, 'success', '直接 data 旧格式应被兼容解析');
}

async function testParentBridgeSettlesSinglePendingWithoutRequestId() {
    const harness = createHarness({
        withElectronAPI: false,
        fetchImpl: async () => {
            throw new Error('fetch should not be used in electron runtime bridge mode');
        }
    });
    harness.windowStub.location.search = '?examId=reading-p1&runtime=electron';
    harness.hooks.state.examId = 'reading-p1';
    harness.hooks.state.sessionId = 'session-requestid-fallback';
    const results = {
        answers: { q1: 'A' },
        answerComparison: { q1: { questionId: 'q1', userAnswer: 'A', correctAnswer: 'B', isCorrect: false } },
        scoreInfo: { correct: 0, total: 1, totalQuestions: 1, percentage: 0 },
        singleAttemptAnalysisInput: {
            totalQuestions: 1,
            analysisSignals: { unansweredCount: 0, changedAnswerCount: 0 },
            questionTypePerformance: { summary_completion: { total: 1, correct: 0, accuracy: 0, confidence: 0.5 } }
        },
        singleAttemptAnalysis: {
            summary: { accuracy: 0, durationSec: 75, unansweredRate: 0, changedAnswerRate: 0 },
            radar: { byQuestionKind: [{ kind: 'summary_completion', total: 1, correct: 0, accuracy: 0, confidence: 0.5 }], byPassageCategory: [] },
            diagnosis: [{ code: 'fallback', reason: '结构化诊断', evidence: {} }],
            nextActions: [{ type: 'fallback', target: 'overall', instruction: '结构化建议', evidence: {} }],
            confidence: 0.5
        },
        realData: {}
    };

    const pending = harness.hooks.triggerSingleAttemptLlmAnalysis(results);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const request = harness.postedMessages.find((entry) => entry && entry.message && entry.message.type === 'REQUEST_READING_ANALYSIS');
    assert.ok(request, 'requestId fallback 测试前应先发送父页分析请求');

    harness.hooks.handleIncoming({
        data: {
            type: 'READING_ANALYSIS_RESULT',
            data: {
                success: true,
                data: {
                    diagnosis: [],
                    nextActions: [],
                    confidence: 0.58
                }
            }
        }
    });

    await pending;
    assert.strictEqual(harness.hooks.state.llmAnalysisStatus, 'success', '单 pending 且缺 requestId 时应兜底结算成功');
}

function testInitSessionSimulationSyncsButtonsAndSuiteState() {
    const harness = createHarness();

    harness.hooks.handleIncoming({
        data: {
            type: 'INIT_SESSION',
            data: {
                examId: 'p1',
                sessionId: 'session-1',
                suiteSessionId: 'suite-1',
                suiteFlowMode: 'simulation',
                suiteSequenceIndex: 1,
                suiteSequenceTotal: 3
            }
        }
    });

    assert.strictEqual(harness.hooks.state.sessionId, 'session-1', 'INIT_SESSION 应写入 sessionId');
    assert.strictEqual(harness.hooks.state.suiteSessionId, 'suite-1', 'INIT_SESSION 应写入 suiteSessionId');
    assert.strictEqual(harness.hooks.state.simulationMode, true, 'simulation flow 应开启 simulationMode');
    assert.strictEqual(harness.submitBtn.textContent, '下一题', 'simulation 非最后一题时 submit 应切成 下一题');
    assert.strictEqual(harness.resetBtn.textContent, '上一题', 'simulation 模式下 reset 应切成 上一题');
    assert.deepStrictEqual(harness.suiteModeCalls, [true], 'suite mode 状态应同步给 practice-page-ui');
    assert.strictEqual(harness.windowStub.__UNIFIED_READING_SIMULATION_MODE__, true, 'runtime flag 应同步到全局');
    assert.strictEqual(harness.postedMessages.length, 1, 'INIT_SESSION 后应向父窗口回发 SESSION_READY');
    assert.strictEqual(harness.postedMessages[0].message.type, 'SESSION_READY', '应回发 SESSION_READY');
    assert.strictEqual(harness.postedMessages[0].origin, '*', 'SESSION_READY 应保持 file:// 兼容的 postMessage 目标');
}

function testSimulationContextUpdatesFlagsAndButtonLabels() {
    const harness = createHarness();
    harness.hooks.state.examId = 'p1';

    harness.hooks.handleIncoming({
        data: {
            type: 'SIMULATION_CONTEXT',
            data: {
                examId: 'p1',
                flowMode: 'simulation',
                currentIndex: 2,
                total: 3,
                isLast: true,
                canPrev: true,
                canNext: false,
                elapsed: 12
            }
        }
    });

    assert.strictEqual(harness.hooks.state.simulationMode, true, 'SIMULATION_CONTEXT 应保持 simulationMode');
    assert.strictEqual(harness.hooks.state.simulationContextReady, true, 'SIMULATION_CONTEXT 应标记 ready');
    assert.strictEqual(harness.submitBtn.textContent, 'Submit', '最后一题时 submit 文案应恢复为 Submit');
    assert.strictEqual(harness.resetBtn.disabled, false, '有上一题时 reset 不应禁用');
    assert.strictEqual(harness.windowStub.__UNIFIED_READING_SIMULATION_IS_LAST__, true, '最后一题 runtime flag 应同步');
}

function testBuildEnvelopeKeepsProtocolContract() {
    const harness = createHarness();
    harness.hooks.state.examId = 'p1';
    harness.hooks.state.sessionId = 'session-2';
    harness.hooks.state.suiteSessionId = 'suite-2';

    const envelope = harness.hooks.buildEnvelope('SIMULATION_NAVIGATE', { direction: 'next' });

    assert.strictEqual(envelope.type, 'SIMULATION_NAVIGATE', '消息类型应原样保留');
    assert.strictEqual(envelope.source, 'practice_page', '消息 source 应保持 practice_page');
    assert.strictEqual(envelope.data.examId, 'p1', '协议应保留 examId');
    assert.strictEqual(envelope.data.sessionId, 'session-2', '协议应保留 sessionId');
    assert.strictEqual(envelope.data.suiteSessionId, 'suite-2', '协议应保留 suiteSessionId');
    assert.strictEqual(envelope.data.direction, 'next', '自定义 payload 应被合并');
}

function testBuildReviewNavigatePayloadUsesCurrentReviewContext() {
    const harness = createHarness();
    harness.hooks.state.reviewSessionId = 'review-9';
    harness.hooks.state.suiteSessionId = 'suite-9';
    harness.hooks.state.reviewEntryIndex = 4;
    harness.hooks.state.suiteReviewMode = true;
    harness.hooks.state.reviewContext = {
        currentIndex: 3
    };

    const payload = harness.hooks.buildReviewNavigatePayload('next', true);

    assert.strictEqual(payload.direction, 'next', 'review navigate 应保留方向');
    assert.strictEqual(payload.reviewSessionId, 'review-9', 'review navigate 应包含 reviewSessionId');
    assert.strictEqual(payload.suiteSessionId, 'suite-9', 'review navigate 应包含 suiteSessionId');
    assert.strictEqual(payload.currentIndex, 3, 'review navigate 应优先使用当前 reviewContext 索引');
    assert.strictEqual(payload.finalizeOnNext, true, 'review navigate 应透传 finalizeOnNext');
}

function testInitSessionReviewModeKeepsEditableWhenReadOnlyFalse() {
    const harness = createHarness();

    harness.hooks.handleIncoming({
        data: {
            type: 'INIT_SESSION',
            data: {
                examId: 'p1',
                sessionId: 'session-review',
                reviewMode: true,
                readOnly: false,
                reviewSessionId: 'review-1',
                reviewEntryIndex: 2
            }
        }
    });

    assert.strictEqual(harness.hooks.state.reviewMode, true, 'review init 应进入 reviewMode');
    assert.strictEqual(harness.hooks.state.readOnly, false, 'readOnly=false 时不应强制锁成只读');
    assert.strictEqual(harness.submitBtn.disabled, false, 'readOnly=false 时 submit 不应被禁用');
    assert.strictEqual(harness.resetBtn.disabled, false, 'readOnly=false 时 reset 不应被禁用');
    assert.strictEqual(harness.postedMessages[0].message.data.reviewMode, true, 'SESSION_READY 应带回 reviewMode');
    assert.strictEqual(harness.postedMessages[0].message.data.readOnly, false, 'SESSION_READY 应带回 readOnly=false');
    assert.strictEqual(harness.postedMessages[0].message.data.reviewSessionId, 'review-1', 'SESSION_READY 应带回 reviewSessionId');
}

function testReviewContextAnsweringModeExitsReadOnly() {
    const harness = createHarness();
    harness.hooks.state.examId = 'p1';
    harness.hooks.state.reviewMode = true;
    harness.hooks.state.readOnly = true;
    harness.submitBtn.disabled = true;
    harness.resetBtn.disabled = true;

    harness.hooks.handleIncoming({
        data: {
            type: 'REVIEW_CONTEXT',
            data: {
                examId: 'p1',
                viewMode: 'answering',
                readOnly: false,
                currentIndex: 1,
                canPrev: true,
                canNext: true
            }
        }
    });

    assert.strictEqual(harness.hooks.state.reviewMode, false, 'answering 视图应退出 reviewMode');
    assert.strictEqual(harness.hooks.state.reviewViewMode, 'answering', 'answering 视图应写回 reviewViewMode');
    assert.strictEqual(harness.hooks.state.readOnly, false, 'answering 视图不应保持只读');
    assert.strictEqual(harness.submitBtn.disabled, false, 'answering 视图应恢复 submit 可用');
    assert.strictEqual(harness.resetBtn.disabled, false, 'answering 视图应恢复 reset 可用');
}

function testReadingSubmissionAnalyticsAndQuestionTypePerformance() {
    const harness = createHarness();
    const now = Date.now();

    harness.hooks.state.startTime = now - 120000;
    harness.hooks.state.interactionCount = 12;
    harness.hooks.state.dataset = {
        questionOrder: ['q1', 'q2', 'q3'],
        answerKey: { q1: 'A', q2: 'B', q3: 'C' },
        questionGroups: [
            {
                kind: 'single_choice',
                questionIds: ['q1', 'q2']
            }
        ]
    };

    harness.hooks.trackAnswerTimeline({ q1: 'A', q2: '', q3: '' }, now - 90000);
    harness.hooks.trackAnswerTimeline({ q1: 'B', q2: '', q3: '' }, now - 80000);
    harness.hooks.trackAnswerTimeline({ q1: 'B', q2: 'B', q3: '' }, now - 70000);

    const answerComparison = {
        q1: { questionId: 'q1', userAnswer: 'B', correctAnswer: 'A', isCorrect: false },
        q2: { questionId: 'q2', userAnswer: 'B', correctAnswer: 'B', isCorrect: true },
        q3: { questionId: 'q3', userAnswer: '', correctAnswer: 'C', isCorrect: false }
    };

    const timelineLite = harness.hooks.buildQuestionTimelineLite(['q1', 'q2', 'q3']);
    const analysisSignals = harness.hooks.buildAnalysisSignals(answerComparison, timelineLite);
    const questionTypePerformance = harness.hooks.buildQuestionTypePerformance(['q1', 'q2', 'q3'], answerComparison);

    assert.strictEqual(analysisSignals.questionCount, 3, 'analysisSignals 应透传题号分母 questionCount');
    assert.strictEqual(analysisSignals.unansweredCount, 1, 'analysisSignals 应统计未作答题数');
    assert.strictEqual(analysisSignals.changedAnswerCount, 1, 'analysisSignals 应统计改答案题数');
    assert.ok(Number.isFinite(analysisSignals.interactionDensity), 'analysisSignals.interactionDensity 应为数值');
    assert.ok(analysisSignals.interactionDensity > 0, 'analysisSignals.interactionDensity 应大于 0');

    const q1Timeline = timelineLite.find((item) => item.questionId === 'q1');
    const q2Timeline = timelineLite.find((item) => item.questionId === 'q2');
    const q3Timeline = timelineLite.find((item) => item.questionId === 'q3');
    assert.strictEqual(q1Timeline.changeCount, 1, 'questionTimelineLite 应记录题目改答次数');
    assert.ok(q1Timeline.firstAnsweredAt && q1Timeline.lastAnsweredAt, '已作答题应写入 first/last 时间');
    assert.strictEqual(q2Timeline.changeCount, 0, '首次作答题 changeCount 应为 0');
    assert.strictEqual(q3Timeline.firstAnsweredAt, null, '未作答题 firstAnsweredAt 应为 null');

    assert.strictEqual(questionTypePerformance.single_choice.total, 2, '题型映射命中时应按 kind 聚合');
    assert.strictEqual(questionTypePerformance.single_choice.correct, 1, '题型映射命中时应统计正确数');
    assert.strictEqual(questionTypePerformance.unknown.total, 1, '映射缺失题目应归入 unknown');
    assert.strictEqual(Boolean(questionTypePerformance.general), false, '不应回退为 general');

    const builtResults = harness.hooks.buildResults({ durationSec: 222 });
    assert.ok(builtResults.analysisSignals && typeof builtResults.analysisSignals === 'object', 'buildResults 应包含 analysisSignals');
    assert.ok(Array.isArray(builtResults.questionTimelineLite), 'buildResults 应包含 questionTimelineLite');
    assert.ok(builtResults.questionTypePerformance && typeof builtResults.questionTypePerformance === 'object', 'buildResults 应包含 questionTypePerformance');
    assert.strictEqual(builtResults.scoreInfo.duration, 222, 'buildResults 应优先使用外部传入的 durationSec');
    assert.ok(builtResults.singleAttemptAnalysisInput && typeof builtResults.singleAttemptAnalysisInput === 'object', 'buildResults 应补齐 singleAttemptAnalysisInput');
    assert.ok(builtResults.singleAttemptAnalysis && typeof builtResults.singleAttemptAnalysis === 'object', 'buildResults 应补齐 singleAttemptAnalysis');
    assert.strictEqual(typeof builtResults.singleAttemptAnalysisInput.totalQuestions, 'number', 'singleAttemptAnalysisInput 应使用 canonical 字段 totalQuestions');
    assert.strictEqual(
        builtResults.singleAttemptAnalysisInput.durationSec,
        222,
        'singleAttemptAnalysisInput.durationSec 应与唯一时长来源保持一致'
    );
    assert.strictEqual(
        Object.prototype.hasOwnProperty.call(builtResults.singleAttemptAnalysisInput, 'summary'),
        false,
        'singleAttemptAnalysisInput 不应回退到临时 summary+questions 结构'
    );
    assert.ok(
        Array.isArray(builtResults.singleAttemptAnalysis.radar?.byQuestionKind),
        'singleAttemptAnalysis 应包含雷达数据结构'
    );
    assert.ok(
        Array.isArray(builtResults.singleAttemptAnalysis.diagnosis)
        && builtResults.singleAttemptAnalysis.diagnosis.every((item) => item && typeof item.reason === 'string'),
        'singleAttemptAnalysis.diagnosis 应统一为对象结构并包含 reason'
    );
    assert.ok(
        Array.isArray(builtResults.singleAttemptAnalysis.nextActions)
        && builtResults.singleAttemptAnalysis.nextActions.every((item) => item && typeof item.instruction === 'string'),
        'singleAttemptAnalysis.nextActions 应统一为对象结构并包含 instruction'
    );
}

function testRenderResultsPrefersExistingCanonicalAnalysis() {
    const harness = createHarness();
    const prebuiltInput = {
        totalQuestions: 999,
        correctAnswers: 777,
        accuracy: 0.777,
        durationSec: 88,
        analysisSignals: { unansweredCount: 1, changedAnswerCount: 1 },
        questionTypePerformance: {
            custom_kind: {
                total: 4,
                correct: 3,
                accuracy: 0.75,
                confidence: 0.66
            }
        }
    };
    const prebuiltAnalysis = {
        summary: {
            accuracy: 0.777,
            durationSec: 88,
            unansweredRate: 0.1,
            changedAnswerRate: 0.1
        },
        radar: {
            byQuestionKind: [
                {
                    kind: 'custom_kind',
                    total: 4,
                    correct: 3,
                    accuracy: 0.75,
                    confidence: 0.66
                }
            ],
            byPassageCategory: []
        },
        diagnosis: ['prebuilt diagnosis'],
        nextActions: ['prebuilt action'],
        confidence: 0.66
    };
    const results = {
        answers: { q1: 'A' },
        answerComparison: {
            q1: { questionId: 'q1', userAnswer: 'A', correctAnswer: 'A', isCorrect: true }
        },
        scoreInfo: {
            correct: 1,
            total: 1,
            totalQuestions: 1,
            percentage: 100
        },
        questionTypePerformance: prebuiltInput.questionTypePerformance,
        singleAttemptAnalysisInput: prebuiltInput,
        singleAttemptAnalysis: prebuiltAnalysis
    };

    harness.hooks.renderResults(results);
    assert.strictEqual(results.singleAttemptAnalysisInput.totalQuestions, 999, '已有 canonical input 不应被 renderResults 重算覆盖');
    assert.strictEqual(results.singleAttemptAnalysis.summary.durationSec, 88, '已有 canonical analysis 不应被 renderResults 重算覆盖');
    assert.ok(
        String(harness.resultsContainer.innerHTML || '').includes('custom_kind'),
        '渲染应使用已有 canonical 雷达数据'
    );
    assert.ok(
        !String(harness.resultsContainer.innerHTML || '').includes('置信'),
        '题型雷达图例不应再显示置信文案'
    );
}

function testPostMessageQueuesPracticeCompleteWhenParentMissing() {
    const harness = createHarness({ noParent: true });
    harness.hooks.state.examId = 'reading-p1';
    harness.hooks.state.sessionId = 'session-no-parent';

    harness.hooks.postMessage('PRACTICE_COMPLETE', {
        examId: 'reading-p1',
        sessionId: 'session-no-parent',
        scoreInfo: { correct: 2, total: 3, accuracy: 2 / 3, percentage: 67 }
    });

    const raw = harness.localStorage.getItem('exam_system_pending_practice_messages_v1');
    assert.ok(raw, '无父窗口时 PRACTICE_COMPLETE 应写入待处理队列');
    const queue = JSON.parse(raw);
    assert.ok(Array.isArray(queue) && queue.length === 1, '待处理队列应新增一条消息');
    assert.strictEqual(queue[0].message.type, 'PRACTICE_COMPLETE', '待处理队列消息类型应保持 PRACTICE_COMPLETE');
    assert.ok(
        String(harness.windowStub.name || '').startsWith('__exam_pending_practice_v1__'),
        '无父窗口时应同步写入 window.name 持久化通道'
    );
}

function testPostMessageDedupesPendingPracticeCompleteBySession() {
    const harness = createHarness({ noParent: true });
    harness.hooks.state.examId = 'reading-p1';
    harness.hooks.state.sessionId = 'session-dedupe';

    harness.hooks.postMessage('PRACTICE_COMPLETE', {
        examId: 'reading-p1',
        sessionId: 'session-dedupe',
        scoreInfo: { correct: 1, total: 3, accuracy: 1 / 3, percentage: 33 }
    });
    harness.hooks.postMessage('PRACTICE_COMPLETE', {
        examId: 'reading-p1',
        sessionId: 'session-dedupe',
        scoreInfo: { correct: 2, total: 3, accuracy: 2 / 3, percentage: 67 }
    });

    const raw = harness.localStorage.getItem('exam_system_pending_practice_messages_v1');
    assert.ok(raw, '去重场景应写入待处理队列');
    const queue = JSON.parse(raw);
    assert.strictEqual(queue.length, 1, '同 examId/sessionId 的 PRACTICE_COMPLETE 应去重为一条');
    assert.strictEqual(
        Number(queue[0].message?.data?.scoreInfo?.correct),
        2,
        '去重后应保留最新一条待处理 PRACTICE_COMPLETE'
    );
}

function testPostMessageDrainsPendingQueueWhenParentRecovered() {
    const harness = createHarness({ noParent: true });
    harness.hooks.state.examId = 'reading-p1';
    harness.hooks.state.sessionId = 'session-drain';

    harness.hooks.postMessage('PRACTICE_COMPLETE', {
        examId: 'reading-p1',
        sessionId: 'session-drain',
        scoreInfo: { correct: 2, total: 3, accuracy: 2 / 3, percentage: 67 }
    });

    const replayed = [];
    const recoveredParent = {
        postMessage(message, origin) {
            replayed.push({ message, origin });
        }
    };
    harness.windowStub.opener = recoveredParent;
    harness.windowStub.parent = recoveredParent;

    harness.hooks.postMessage('SESSION_READY', {
        examId: 'reading-p1',
        sessionId: 'session-drain'
    });

    assert.strictEqual(replayed.length, 2, '父窗口恢复后应发送当前消息并回放待处理队列');
    assert.strictEqual(replayed[0].message.type, 'SESSION_READY', '恢复后应先发送当前消息');
    assert.strictEqual(replayed[1].message.type, 'PRACTICE_COMPLETE', '恢复后应回放待处理 PRACTICE_COMPLETE');
    assert.strictEqual(
        harness.localStorage.getItem('exam_system_pending_practice_messages_v1'),
        null,
        '回放成功后应清空本地待处理队列'
    );
    assert.strictEqual(
        String(harness.windowStub.name || ''),
        '',
        '回放成功后应清空 window.name 待处理缓存'
    );
}

function testSuiteForceCloseUsesElectronNavigation() {
    const harness = createHarness({ withElectronAPI: true });
    harness.hooks.handleIncoming({
        data: {
            type: 'SUITE_FORCE_CLOSE',
            data: {}
        }
    });
    assert.strictEqual(harness.getElectronOpenLegacyCalls(), 1, 'Electron 环境下 SUITE_FORCE_CLOSE 应优先回 Legacy');
    assert.strictEqual(harness.getCloseCalls(), 0, 'Electron 环境下 SUITE_FORCE_CLOSE 不应直接 close 窗口');
}

function testSuiteForceCloseInEmbeddedContextNotifiesParentWithoutNavigation() {
    const harness = createHarness({ withElectronAPI: true, noParent: true });
    const parentMessages = [];
    const embeddedParent = {
        postMessage(message, origin) {
            parentMessages.push({ message, origin });
        }
    };
    harness.windowStub.parent = embeddedParent;
    harness.hooks.state.examId = 'reading-embedded';
    harness.hooks.state.sessionId = 'session-embedded';
    harness.hooks.handleIncoming({
        data: {
            type: 'SUITE_FORCE_CLOSE',
            data: {}
        }
    });
    assert.strictEqual(parentMessages.length, 1, '内嵌上下文应通知父页退出');
    assert.strictEqual(parentMessages[0].message.type, 'PRACTICE_EXIT', '内嵌上下文应发送 PRACTICE_EXIT');
    assert.strictEqual(harness.getElectronOpenLegacyCalls(), 0, '内嵌上下文不应触发 openLegacy');
    assert.strictEqual(harness.getCloseCalls(), 0, '内嵌上下文不应直接关闭窗口');
}

async function main() {
    try {
        testInitSessionSimulationSyncsButtonsAndSuiteState();
        testSimulationContextUpdatesFlagsAndButtonLabels();
        testBuildEnvelopeKeepsProtocolContract();
        testBuildReviewNavigatePayloadUsesCurrentReviewContext();
        testInitSessionReviewModeKeepsEditableWhenReadOnlyFalse();
        testReviewContextAnsweringModeExitsReadOnly();
        testReadingSubmissionAnalyticsAndQuestionTypePerformance();
        testRenderResultsPrefersExistingCanonicalAnalysis();
        testPostMessageQueuesPracticeCompleteWhenParentMissing();
        testPostMessageDedupesPendingPracticeCompleteBySession();
        testPostMessageDrainsPendingQueueWhenParentRecovered();
        testSuiteForceCloseUsesElectronNavigation();
        testSuiteForceCloseInEmbeddedContextNotifiesParentWithoutNavigation();
        await testSingleAttemptLlmAnalysisPrefersElectronIpc();
        await testSingleAttemptLlmAnalysisPatchFlow();
        await testSingleAttemptLlmAnalysisDegradedShowsRetryWithoutModelId();
        await testSingleAttemptLlmAnalysisUsesRuntimeQueryBaseUrl();
        await testSingleAttemptLlmAnalysisNetworkFailureUsesClearMessage();
        await testSingleAttemptLlmAnalysisIgnoresStaleCachedBaseUrlWhenElectronInfoAvailable();
        await testSingleAttemptLlmAnalysisNetworkFailureClearsCachedBaseUrl();
        await testSingleAttemptLlmAnalysisUsesParentBridgeInElectronRuntime();
        await testSingleAttemptLlmAnalysisReportsUnavailableBridgeClearly();
        await testSingleAttemptLlmAnalysisReportsInvalidBridgePayloadClearly();
        await testParentBridgeAcceptsMessageTypeAndPayloadEnvelope();
        await testParentBridgeAcceptsLegacyDirectAnalysisData();
        await testParentBridgeSettlesSinglePendingWithoutRequestId();
        console.log(JSON.stringify({
            status: 'pass',
            detail: 'unifiedReadingPage 已覆盖 INIT_SESSION/SIMULATION_CONTEXT 协议、review init 可编辑合同、REVIEW_CONTEXT answering 退只读合同、SESSION_READY envelope、review navigate payload、运行时 localApiBaseUrl 恢复、降级重试 UI、父页分析桥 envelope/旧格式兼容与 requestId 兜底链路，以及桥不可用/无效响应的细化失败提示'
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
