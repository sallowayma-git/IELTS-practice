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

class ElementStub {
    constructor(id = '') {
        this.id = id;
        this.children = [];
        this.dataset = {};
        this.style = {};
        this.disabled = false;
        this.textContent = '';
        this.innerHTML = '';
        this.className = '';
        this.listeners = new Map();
    }

    addEventListener(type, handler) {
        this.listeners.set(type, handler);
    }

    click() {
        const handler = this.listeners.get('click');
        if (typeof handler === 'function') {
            handler({ target: this });
        }
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    insertAdjacentElement(_position, child) {
        this.children.push(child);
        return child;
    }

    prepend(child) {
        this.children.unshift(child);
        return child;
    }

    querySelector(selector) {
        if (selector === 'button[data-review-nav="prev"]') {
            return this._prevBtn || (this._prevBtn = new ElementStub('review-prev'));
        }
        if (selector === 'button[data-review-nav="next"]') {
            return this._nextBtn || (this._nextBtn = new ElementStub('review-next'));
        }
        return null;
    }
}

function extractInlineRuntime(html) {
    const scripts = Array.from(html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi))
        .map((match) => match[1].trim())
        .filter(Boolean);
    const runtime = scripts.find((script) => script.includes('function buildReplaySnapshot'));
    if (!runtime) {
        throw new Error('exam-placeholder inline runtime not found');
    }
    return runtime;
}

function createHarness(options = {}) {
    const elements = new Map();
    const ensureElement = (id) => {
        if (!elements.has(id)) {
            elements.set(id, new ElementStub(id));
        }
        return elements.get(id);
    };

    [
        'access-denied-overlay',
        'exam-title',
        'exam-subtitle',
        'meta-exam-id',
        'meta-category',
        'meta-session',
        'meta-suite',
        'meta-score',
        'meta-duration',
        'status-title',
        'status-detail',
        'complete-exam-btn',
        'force-ready-btn',
        'event-log'
    ].forEach(ensureElement);

    const listeners = new Map();
    const documentStub = {
        body: new ElementStub('body'),
        referrer: '',
        getElementById(id) {
            return ensureElement(id);
        },
        createElement(tag) {
            return new ElementStub(tag);
        },
        querySelector(selector) {
            if (selector === 'body > header' || selector === 'header') {
                return ensureElement('header');
            }
            return null;
        }
    };

    const openerMessages = [];
    const windowStub = {
        location: {
            search: options.search || '?test_env=1&examId=reading-p1&title=Passage%201&category=P1&suiteSessionId=suite-1',
            href: 'https://child.example/templates/exam-placeholder.html',
            protocol: 'https:'
        },
        opener: {
            postMessage(message) {
                openerMessages.push(message);
            }
        },
        parent: null,
        EnvironmentDetector: {
            isInTestEnvironment() {
                return true;
            }
        },
        addEventListener(type, handler) {
            listeners.set(type, handler);
        },
        scrollTo() {}
    };

    const sandbox = {
        window: windowStub,
        document: documentStub,
        console: {
            log() {},
            info() {},
            warn() {},
            error() {}
        },
        URLSearchParams,
        Date,
        Math,
        String,
        Number,
        Object,
        Array,
        Boolean,
        setTimeout() {
            return 1;
        },
        clearTimeout() {}
    };
    sandbox.globalThis = windowStub;
    sandbox.window.parent = sandbox.window;

    const html = fs.readFileSync(path.join(repoRoot, 'templates/exam-placeholder.html'), 'utf8');
    vm.runInContext(extractInlineRuntime(html), vm.createContext(sandbox), {
        filename: 'templates/exam-placeholder.html:inline'
    });

    const dispatchHostMessage = (message) => {
        const handler = listeners.get('message');
        if (!handler) throw new Error('message handler was not registered');
        const messageData = message.data || {};
        const data = Object.assign({}, messageData, {
            windowSessionToken: typeof messageData.windowSessionToken === 'string'
                ? messageData.windowSessionToken
                : 'placeholder-test-token'
        });
        handler({
            data: Object.assign({}, message, { source: 'exam_host', data }),
            source: windowStub.opener,
            origin: 'https://host.example'
        });
    };
    const initializeSession = () => {
        dispatchHostMessage({
            type: 'INIT_SESSION',
            data: {
                examId: 'reading-p1',
                sessionId: 'placeholder-session',
                suiteSessionId: 'suite-1',
                parentOrigin: 'https://host.example'
            }
        });
        openerMessages.length = 0;
    };
    if (options.initialize !== false) {
        initializeSession();
    }

    return {
        document: documentStub,
        body: documentStub.body,
        elements,
        openerMessages,
        initializeSession,
        sendMessage(message) {
            dispatchHostMessage(message);
        }
    };
}

function testReplayUsesCanonicalCorrectAnswerMap() {
    const harness = createHarness();
    harness.sendMessage({
        type: 'REPLAY_PRACTICE_RECORD',
        data: {
            examId: 'reading-p1',
            suiteSessionId: 'suite-1',
            answers: { q1: 'A', q2: 'B' },
            answerComparison: {
                q1: { userAnswer: 'A', correctAnswer: 'B', isCorrect: false },
                q2: { userAnswer: 'B', correctAnswer: 'B', isCorrect: true }
            },
            correctAnswerMap: { q1: 'A', q2: 'C' },
            scoreInfo: { correct: 0, total: 2, accuracy: 0, percentage: 0 },
            duration: 180
        }
    });

    assert.strictEqual(harness.body.dataset.replayAnswers, '2', 'placeholder 应恢复答案数量');
    assert.strictEqual(harness.body.dataset.replayComparisons, '2', 'placeholder 应从 correctAnswerMap 合成对照数量');
    assert.strictEqual(harness.elements.get('meta-score').textContent, '正确 1 / 总题数 2（50%）', 'placeholder 应用 canonical correctAnswerMap 覆盖旧 comparison/scoreInfo');
    assert.strictEqual(harness.elements.get('status-title').textContent, '当前为回看态', 'placeholder 应进入回看态');
}

function testReplayRefusesLegacyCorrectAnswerFallbacks() {
    const harness = createHarness();
    harness.sendMessage({
        type: 'REPLAY_PRACTICE_RECORD',
        data: {
            examId: 'reading-p1',
            suiteSessionId: 'suite-1',
            answers: { q1: 'A' },
            correctAnswers: { q1: 'A' },
            answerComparison: {
                q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true }
            },
            scoreInfo: {
                correct: 0,
                total: 1,
                accuracy: 0,
                percentage: 0,
                details: {
                    q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true }
                }
            },
            duration: 180
        }
    });

    assert.strictEqual(harness.body.dataset.replayAnswers, '1', 'placeholder 应恢复 legacy 记录里的用户答案');
    assert.strictEqual(harness.body.dataset.replayComparisons, '1', 'placeholder 可保留 comparison 行用于展示未知状态');
    assert.strictEqual(
        harness.elements.get('meta-score').textContent,
        '正确 0 / 总题数 1（0%）',
        '缺 canonical correctAnswerMap 时占位页只能保留原始分数，不能重算'
    );
    assert.strictEqual(harness.elements.get('status-title').textContent, '当前为回看态', 'placeholder 应进入回看态');
}

function testReplayKeepsSuitePrefixedQuestionNumbers() {
    const harness = createHarness();
    harness.sendMessage({
        type: 'REPLAY_PRACTICE_RECORD',
        data: {
            examId: 'reading-p1',
            suiteSessionId: 'suite-1',
            answers: {
                q1: 'A',
                'reading-p1::q17': 'D'
            },
            correctAnswerMap: {
                q1: 'A',
                'reading-p1::q17': 'D'
            },
            scoreInfo: { correct: 0, total: 2, accuracy: 0, percentage: 0 },
            duration: 180
        }
    });

    assert.strictEqual(harness.body.dataset.replayAnswers, '2', 'suite 前缀题号不应和 q1 撞键');
    assert.strictEqual(harness.body.dataset.replayComparisons, '2', 'suite 前缀题号应保留原题号数字');
    assert.strictEqual(
        harness.elements.get('meta-score').textContent,
        '正确 2 / 总题数 2（100%）',
        'P1::q17 必须归一为 q17，而不是 q1'
    );
}

function testNonLastSimulationSubmitNavigatesInsteadOfFinalSubmit() {
    const harness = createHarness();
    harness.sendMessage({
        type: 'SIMULATION_CONTEXT',
        data: {
            currentIndex: 0,
            total: 3,
            isLast: false
        }
    });

    harness.elements.get('complete-exam-btn').click();

    assert.strictEqual(harness.openerMessages.length, 1, '非末篇模拟提交只应发送一次导航消息');
    const message = harness.openerMessages[0];
    assert.strictEqual(message.type, 'SIMULATION_NAVIGATE', '非末篇模拟提交必须导航到下一篇，不能结算整套');
    assert.strictEqual(message.data.direction, 'next', 'SIMULATION_NAVIGATE 应指向下一篇');
    assert(message.data.resultSnapshot, '导航消息必须携带当前篇结果快照');
    assert(message.data.resultSnapshot.correctAnswerMap, '结果快照必须携带 canonical correctAnswerMap');
    assert.strictEqual(
        Object.prototype.hasOwnProperty.call(message.data.resultSnapshot, 'correctAnswers'),
        false,
        '占位页新结果快照不应新增 legacy correctAnswers 答案表'
    );
    assert.strictEqual(harness.body.dataset.examState, '已提交本篇，等待下一篇...', '非末篇提交后应等待父页切篇');
}

function testPracticeCompleteCarriesSubmissionContract() {
    const harness = createHarness();
    harness.elements.get('complete-exam-btn').click();

    const message = harness.openerMessages.find((item) => item && item.type === 'PRACTICE_COMPLETE');
    assert(message, '占位页普通提交必须发送 PRACTICE_COMPLETE');
    assert.strictEqual(message.data.sessionId, 'placeholder-session');
    assert.strictEqual(message.data.windowSessionToken, 'placeholder-test-token');
    assert.match(message.data.submissionId, /^placeholder-submit-/);
}

function testManualNavigationWaitsForTrustedHostState() {
    const uninitialized = createHarness({ initialize: false });
    const uninitializedSubmit = uninitialized.elements.get('complete-exam-btn');
    assert.strictEqual(uninitializedSubmit.disabled, true, '可信 INIT 握手前必须保持提交按钮禁用');
    uninitializedSubmit.click();
    assert.strictEqual(
        uninitialized.openerMessages.some((item) => item && item.type === 'PRACTICE_COMPLETE'),
        false,
        '即使脚本触发点击，未握手的占位页也不得发送无令牌提交'
    );
    uninitialized.elements.get('force-ready-btn').click();
    assert.strictEqual(uninitializedSubmit.disabled, true, '主动 Ready 不得冒充可信 INIT 握手并启用提交');
    uninitializedSubmit.click();
    assert.strictEqual(
        uninitialized.openerMessages.some((item) => item && item.type === 'PRACTICE_COMPLETE'),
        false,
        '主动 Ready 后仍不得绕过可信握手发送提交'
    );
    uninitialized.initializeSession();
    assert.strictEqual(uninitializedSubmit.disabled, false, '可信 INIT 握手后才可开始作答提交');

    const harness = createHarness({
        search: '?test_env=1&examId=reading-p1&title=Passage%201&category=P1&suiteSessionId=suite-1&suiteFlowMode=stationary&index=1'
    });
    harness.sendMessage({
        type: 'REVIEW_CONTEXT',
        data: {
            examId: 'reading-p1',
            suiteSessionId: 'suite-1',
            suiteReviewMode: true,
            showNav: true,
            viewMode: 'answering',
            currentIndex: 1,
            total: 3,
            canPrev: true,
            canNext: false,
            readOnly: false
        }
    });
    const nav = harness.elements.get('practice-review-nav');
    const next = nav.querySelector('button[data-review-nav="next"]');
    assert.strictEqual(next.disabled, true, '作答态不得由占位页本地乐观启用下一篇');

    harness.elements.get('complete-exam-btn').click();
    const firstSubmission = harness.openerMessages.find((item) => item && item.type === 'PRACTICE_COMPLETE');
    assert(
        firstSubmission,
        '手动模式提交必须先请求父页持久化结果'
    );
    assert.strictEqual(next.disabled, true, '父页确认持久化前下一篇必须保持禁用');

    harness.sendMessage({
        type: 'PRACTICE_SUBMIT_FAILED',
        data: {
            examId: 'reading-p1',
            suiteSessionId: 'suite-1',
            submissionId: firstSubmission.data.submissionId,
            errorCode: 'suite_recovery_save_failed'
        }
    });
    const submit = harness.elements.get('complete-exam-btn');
    assert.strictEqual(submit.disabled, false, '父页保存失败后应恢复提交按钮以允许重试');
    submit.click();
    const submissions = harness.openerMessages.filter((item) => item && item.type === 'PRACTICE_COMPLETE');
    assert.strictEqual(submissions.length, 2, '保存失败后必须允许重新发送提交');
    assert.strictEqual(
        submissions[1].data.submissionId,
        firstSubmission.data.submissionId,
        '重试必须复用 submissionId，维持父页幂等提交契约'
    );
    assert.strictEqual(next.disabled, true, '重试提交仍须等待父页确认后才能导航');

    harness.sendMessage({
        type: 'REVIEW_CONTEXT',
        data: {
            examId: 'reading-p1',
            suiteSessionId: 'suite-1',
            suiteReviewMode: true,
            showNav: true,
            viewMode: 'review',
            currentIndex: 1,
            total: 3,
            canPrev: true,
            canNext: true,
            readOnly: true
        }
    });
    assert.strictEqual(next.disabled, false, '仅父页提交成功后的 REVIEW_CONTEXT 可解锁下一篇');
}

function testWrongExamInitDoesNotPoisonActiveToken() {
    const harness = createHarness();
    harness.sendMessage({
        type: 'INIT_SESSION',
        data: {
            examId: 'reading-p2',
            sessionId: 'stale-placeholder-session',
            suiteSessionId: 'suite-1',
            parentOrigin: 'https://host.example',
            windowSessionToken: 'stale-placeholder-token'
        }
    });

    harness.sendMessage({
        type: 'REVIEW_CONTEXT',
        data: {
            examId: 'reading-p1',
            suiteSessionId: 'suite-1',
            viewMode: 'review',
            showNav: true,
            currentIndex: 0,
            total: 3,
            canNext: true,
            readOnly: true,
            windowSessionToken: 'placeholder-test-token'
        }
    });

    assert.strictEqual(
        harness.elements.get('status-title').textContent,
        '当前为回看态',
        '延迟错篇 INIT 不得污染当前会话令牌或阻断后续合法消息'
    );
}

function run() {
    testReplayUsesCanonicalCorrectAnswerMap();
    testReplayRefusesLegacyCorrectAnswerFallbacks();
    testReplayKeepsSuitePrefixedQuestionNumbers();
    testNonLastSimulationSubmitNavigatesInsteadOfFinalSubmit();
    testPracticeCompleteCarriesSubmissionContract();
    testManualNavigationWaitsForTrustedHostState();
    testWrongExamInitDoesNotPoisonActiveToken();

    process.stdout.write(JSON.stringify({
        status: 'pass',
        detail: 'exam placeholder replay restores comparisons from correctAnswerMap'
    }));
}

try {
    run();
} catch (error) {
    process.stdout.write(JSON.stringify({
        status: 'fail',
        detail: error && error.message ? error.message : String(error)
    }));
    process.exit(1);
}
