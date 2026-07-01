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

function createHarness() {
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
            search: '?test_env=1&examId=reading-p1&title=Passage%201&category=P1&suiteSessionId=suite-1',
            href: ''
        },
        opener: {
            postMessage(message) {
                openerMessages.push(message);
            }
        },
        parent: null,
        localStorage: {
            getItem() {
                return null;
            }
        },
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

    return {
        document: documentStub,
        body: documentStub.body,
        elements,
        openerMessages,
        sendMessage(message) {
            const handler = listeners.get('message');
            if (!handler) {
                throw new Error('message handler was not registered');
            }
            handler({ data: message });
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

function run() {
    testReplayUsesCanonicalCorrectAnswerMap();
    testReplayRefusesLegacyCorrectAnswerFallbacks();
    testReplayKeepsSuitePrefixedQuestionNumbers();
    testNonLastSimulationSubmitNavigatesInsteadOfFinalSubmit();

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
