#!/usr/bin/env node
/**
 * 复盘回放协议（宿主侧）。
 *
 * 契约：一条练习记录进入"可评分"，必须且只能由「宿主收齐这一轮 attempt 的全部
 * REPLAY_APPLIED 回执」触发。任何伪造 / 迟到 / 跨记录 / 跨 attempt / 少一篇的
 * 回执都不得让用户拿到评分入口——否则"已复盘"就不再等价于"真的看完了"。
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import test from 'node:test';
import vm from 'vm';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function loadScript(relativePath, context) {
    vm.runInContext(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'), context, { filename: relativePath });
}

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createHarness() {
    const applied = [];
    const documentStub = {
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        getElementById() { return null; }
    };
    const listeners = new Map();
    const windowStub = {
        document: documentStub,
        location: { origin: 'http://localhost', href: 'http://localhost/' },
        addEventListener(type, handler) { listeners.set(type, handler); },
        removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type); },
        resolveActiveLibraryIndex: async () => [],
        PracticeReviewFlow: {
            __v1: true,
            notifyAttemptApplied(info) { applied.push(clone(info)); return true; }
        },
        AppData: { ready: Promise.resolve(), practice: {} }
    };
    const sandbox = {
        window: windowStub, document: documentStub, console,
        setTimeout, clearTimeout, setInterval, clearInterval,
        Date, Math, JSON, Map, Set, URL, URLSearchParams
    };
    sandbox.globalThis = windowStub;
    const context = vm.createContext(sandbox);
    loadScript('js/app/examSessionMixin.js', context);
    loadScript('js/app/suitePracticeMixin.js', context);
    const app = { components: {}, setState() {}, getState() { return null; } };
    Object.assign(app, windowStub.ExamSystemAppMixins.examSession, windowStub.ExamSystemAppMixins.suitePractice);
    return { app, windowStub, applied };
}

function bindReview(harness, record, examId, options = {}) {
    const examWindow = {
        name: `review-${examId}`,
        closed: false,
        location: { href: `http://localhost/${examId}.html` },
        _messages: [],
        postMessage(message) { this._messages.push(clone(message)); }
    };
    const review = harness.app._buildReviewSession(record, options);
    assert(review, '应能构造回放会话');
    harness.app._ensureReviewReplayStore().set(review.sessionId, review);
    const entryIndex = Math.max(0, review.entries.findIndex((entry) => entry.examId === examId));
    const info = {
        window: examWindow,
        expectedSessionId: `session-${examId}`,
        windowSessionToken: `token-${examId}`,
        windowSessionTokenSessionId: `session-${examId}`,
        expectedUrl: `http://localhost/${examId}.html`,
        expectedOrigin: 'http://localhost',
        allowOpaqueOrigin: false,
        reviewMode: true,
        reviewSessionId: review.sessionId,
        reviewEntryIndex: entryIndex,
        readOnly: true
    };
    harness.app.examWindows = new Map([[examId, info]]);
    harness.app.setupExamWindowCommunication(examWindow, examId);
    const handler = harness.app.messageHandlers.get(examId);
    assert.strictEqual(typeof handler, 'function', '应注册消息处理器');
    return { examWindow, review, info, handler, entryIndex };
}

async function sendAck(handler, examWindow, data, overrides = {}) {
    await handler({
        origin: overrides.origin || 'http://localhost',
        source: overrides.source || examWindow,
        data: {
            type: overrides.type || 'REPLAY_APPLIED',
            source: overrides.envelopeSource || 'practice_page',
            data
        }
    });
}

const SINGLE_RECORD = {
    id: 'record-single',
    examId: 'reading-p1',
    type: 'reading',
    status: 'completed',
    scoreInfo: { correct: 7, total: 10, percentage: 70 },
    totalQuestions: 10,
    correctAnswers: 7,
    duration: 600,
    date: '2026-09-01T00:00:00.000Z',
    answers: { 'reading-p1-q1': 'A' },
    correctAnswerMap: { 'reading-p1-q1': 'B' }
};

const SUITE_RECORD = {
    id: 'record-suite',
    examId: 'suite-record-suite',
    type: 'reading',
    status: 'completed',
    scoreInfo: { correct: 12, total: 20 },
    totalQuestions: 20,
    correctAnswers: 12,
    date: '2026-09-01T00:00:00.000Z',
    suiteEntries: [
        { examId: 'reading-p1', scoreInfo: { correct: 7, total: 10 }, answers: { 'reading-p1-q1': 'A' }, correctAnswerMap: { 'reading-p1-q1': 'B' } },
        { examId: 'reading-p2', scoreInfo: { correct: 5, total: 10 }, answers: { 'reading-p2-q1': 'C' }, correctAnswerMap: { 'reading-p2-q1': 'D' } }
    ]
};

test('回放载荷携带 reviewAttemptId，普通回放为 null', async () => {
    const harness = createHarness();
    const scheduled = bindReview(harness, SINGLE_RECORD, 'reading-p1', { reviewAttemptId: 'attempt-1' });
    harness.app._sendReviewReplayMessages('reading-p1', scheduled.examWindow, scheduled.review, 0);
    const replay = scheduled.examWindow._messages.find((message) => message && message.type === 'REPLAY_PRACTICE_RECORD');
    assert(replay, '应下发回放数据');
    assert.strictEqual(replay.data.reviewAttemptId, 'attempt-1');
    assert.strictEqual(replay.data.recordId, 'record-single');
    assert.strictEqual(replay.data.reviewEntryIndex, 0);
    assert.strictEqual(replay.data.reviewEntryTotal, 1);

    const plain = createHarness();
    const history = bindReview(plain, SINGLE_RECORD, 'reading-p1');
    plain.app._sendReviewReplayMessages('reading-p1', history.examWindow, history.review, 0);
    const plainReplay = history.examWindow._messages.find((message) => message && message.type === 'REPLAY_PRACTICE_RECORD');
    assert.strictEqual(plainReplay.data.reviewAttemptId, null, '普通历史回放不得铸 attempt');
});

test('单篇：一条有效 ACK 即进入待评分', async () => {
    const harness = createHarness();
    const { examWindow, review, info, handler } = bindReview(harness, SINGLE_RECORD, 'reading-p1', { reviewAttemptId: 'attempt-1' });
    await sendAck(handler, examWindow, {
        examId: 'reading-p1',
        sessionId: info.expectedSessionId,
        windowSessionToken: info.windowSessionToken,
        reviewSessionId: review.sessionId,
        reviewAttemptId: 'attempt-1',
        recordId: 'record-single',
        reviewEntryIndex: 0
    });
    assert.strictEqual(harness.applied.length, 1, '收齐回执后应挂出待评分');
    assert.strictEqual(harness.applied[0].recordId, 'record-single');
    assert.strictEqual(harness.applied[0].reviewAttemptId, 'attempt-1');
    assert.strictEqual(harness.app._ensureReviewReplayStore().get(review.sessionId).pendingGrade, true);
});

test('单篇：重复 ACK 只挂一次待评分', async () => {
    const harness = createHarness();
    const { examWindow, review, info, handler } = bindReview(harness, SINGLE_RECORD, 'reading-p1', { reviewAttemptId: 'attempt-1' });
    const payload = {
        examId: 'reading-p1',
        sessionId: info.expectedSessionId,
        windowSessionToken: info.windowSessionToken,
        reviewSessionId: review.sessionId,
        reviewAttemptId: 'attempt-1',
        recordId: 'record-single',
        reviewEntryIndex: 0
    };
    await sendAck(handler, examWindow, payload);
    await sendAck(handler, examWindow, payload);
    await sendAck(handler, examWindow, payload);
    assert.strictEqual(harness.applied.length, 1, '重复回执不得重复通知');
});

test('伪造 / 迟到 / 跨记录的 ACK 一律不记复盘', async () => {
    const harness = createHarness();
    const { examWindow, review, info, handler } = bindReview(harness, SINGLE_RECORD, 'reading-p1', { reviewAttemptId: 'attempt-1' });
    const valid = {
        examId: 'reading-p1',
        sessionId: info.expectedSessionId,
        windowSessionToken: info.windowSessionToken,
        reviewSessionId: review.sessionId,
        reviewAttemptId: 'attempt-1',
        recordId: 'record-single',
        reviewEntryIndex: 0
    };

    await sendAck(handler, examWindow, { ...valid, windowSessionToken: 'forged-token' });
    await sendAck(handler, examWindow, valid, { origin: 'https://evil.example' });
    await sendAck(handler, examWindow, valid, { source: { name: 'other', closed: false, postMessage() {} } });
    await sendAck(handler, examWindow, valid, { envelopeSource: 'evil_page' });
    await sendAck(handler, examWindow, { ...valid, sessionId: 'session-other' });
    await sendAck(handler, examWindow, { ...valid, recordId: 'record-other' });
    await sendAck(handler, examWindow, { ...valid, examId: 'reading-p9' });
    await sendAck(handler, examWindow, { ...valid, reviewEntryIndex: 3 });
    await sendAck(handler, examWindow, { ...valid, reviewEntryIndex: -1 });
    await sendAck(handler, examWindow, { ...valid, reviewAttemptId: 'attempt-stale' });
    await sendAck(handler, examWindow, { ...valid, reviewAttemptId: '' });
    await sendAck(handler, examWindow, { ...valid, reviewSessionId: 'review_other' });
    assert.strictEqual(harness.applied.length, 0, '任何一条非法回执都不得进入待评分');
    assert.strictEqual(harness.app._ensureReviewReplayStore().get(review.sessionId).pendingGrade, false);

    // 同一窗口随后发来合法回执仍应被接受：拒收不得污染会话状态。
    await sendAck(handler, examWindow, valid);
    assert.strictEqual(harness.applied.length, 1);
});

test('普通历史回放的 ACK 不触发复盘', async () => {
    const harness = createHarness();
    const { examWindow, review, info, handler } = bindReview(harness, SINGLE_RECORD, 'reading-p1');
    await sendAck(handler, examWindow, {
        examId: 'reading-p1',
        sessionId: info.expectedSessionId,
        windowSessionToken: info.windowSessionToken,
        reviewSessionId: review.sessionId,
        reviewAttemptId: 'attempt-1',
        recordId: 'record-single',
        reviewEntryIndex: 0
    });
    assert.strictEqual(harness.applied.length, 0, '没有 attempt 的会话不得被推进为待评分');
});

test('套题：必须每一子篇都回执才可评分', async () => {
    const harness = createHarness();
    const first = bindReview(harness, SUITE_RECORD, 'reading-p1', { reviewAttemptId: 'attempt-suite' });
    assert.strictEqual(first.review.entries.length, 2, '套题应解析出两篇');
    const base = {
        sessionId: first.info.expectedSessionId,
        windowSessionToken: first.info.windowSessionToken,
        reviewSessionId: first.review.sessionId,
        reviewAttemptId: 'attempt-suite',
        recordId: 'record-suite'
    };
    await sendAck(first.handler, first.examWindow, { ...base, examId: 'reading-p1', reviewEntryIndex: 0 });
    assert.strictEqual(harness.applied.length, 0, '只读完第一篇不得进入待评分');
    assert.strictEqual(harness.app._ensureReviewReplayStore().get(first.review.sessionId).pendingGrade, false);

    // 用户翻到第二篇：宿主换窗口注册，但复盘会话不变。
    const info2 = {
        window: first.examWindow,
        expectedSessionId: 'session-reading-p2',
        windowSessionToken: 'token-reading-p2',
        windowSessionTokenSessionId: 'session-reading-p2',
        expectedUrl: 'http://localhost/reading-p2.html',
        expectedOrigin: 'http://localhost',
        allowOpaqueOrigin: false,
        reviewMode: true,
        reviewSessionId: first.review.sessionId,
        reviewEntryIndex: 1,
        readOnly: true
    };
    first.examWindow.location.href = 'http://localhost/reading-p2.html';
    harness.app.examWindows = new Map([['reading-p2', info2]]);
    harness.app.setupExamWindowCommunication(first.examWindow, 'reading-p2');
    const handler2 = harness.app.messageHandlers.get('reading-p2');
    await sendAck(handler2, first.examWindow, {
        ...base,
        examId: 'reading-p2',
        sessionId: info2.expectedSessionId,
        windowSessionToken: info2.windowSessionToken,
        reviewEntryIndex: 1
    });
    assert.strictEqual(harness.applied.length, 1, '两篇都回执后才进入待评分');
    assert.strictEqual(harness.applied[0].entryCount, 2);
    assert.strictEqual(harness.app._ensureReviewReplayStore().get(first.review.sessionId).pendingGrade, true);
});
