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
        singleAttemptAnalysisInput: {
            totalQuestions: 1,
            analysisSignals: {},
            questionTimelineLite: [],
            questionTypePerformance: {}
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
    appNodes.set('left', { innerHTML: '', contains: () => false });
    appNodes.set('question-groups', { innerHTML: '', contains: () => false });
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
        getSelection() { return null; },
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
        "global.__UNIFIED_READING_TEST_HOOKS__ = { state, captureDom, stopInitLoop, renderResults, sendReadingCoachQuery, ensureReadingCoachUi }; })(typeof window !== 'undefined' ? window : globalThis);"
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
        localStorage
    };
}

async function testCoachQueryViaElectronIpc() {
    let callCount = 0;
    const harness = createHarness({
        electronAPI: {
            async queryReadingCoach(payload) {
                callCount += 1;
                assert.strictEqual(payload.examId, 'p1-high-01', '应透传 examId');
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
    });

    await harness.hooks.sendReadingCoachQuery('这题怎么做？', { action: 'chat', promptKind: 'freeform' });

    assert.strictEqual(callCount, 1, '应调用一次 reading:coach-query IPC');
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

    assert.ok(fetchCalls[0].includes('/api/reading/coach/query?stream=1'), '应请求新的教练 SSE 接口');
    assert.ok(harness.hooks.state.readingCoachSnapshot && harness.hooks.state.readingCoachSnapshot.answer, 'SSE 完成后应回填 snapshot');
}

async function main() {
    try {
        await testCoachQueryViaElectronIpc();
        await testCoachQueryViaLocalApiSse();
        console.log(JSON.stringify({
            status: 'pass',
            detail: 'UnifiedReadingPage 已覆盖 Reading Coach V2 的 IPC 与 SSE 查询主链路'
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
