#!/usr/bin/env node
import path from 'path';
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';
import { webcrypto } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

function loadScript(relativePath, context) {
    const fullPath = path.join(repoRoot, relativePath);
    const code = fs.readFileSync(fullPath, 'utf8');
    vm.runInContext(code, context, { filename: relativePath });
}

function createStubWindow(name) {
    return {
        name,
        closed: false,
        location: { href: 'http://localhost/exam.html' },
        _messages: [],
        postMessage(payload) {
            this._messages.push(payload);
        },
        focus() {}
    };
}

function createSandbox() {
    const cloneValue = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const windowSessionStore = new Map();
    let activeSessions = [];
    let practiceRecords = [];

    const documentStub = {
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        createElement() { return { className: '', style: {} }; },
        dispatchEvent() { return true; }
    };

    const listenerRegistry = new Map();
    const listenerStats = { added: new Map(), removed: new Map() };
    const track = (map, type) => {
        const current = map.get(type) || 0;
        map.set(type, current + 1);
    };

    const windowStub = {
        document: documentStub,
        addEventListener(type, handler) {
            if (!type || typeof handler !== 'function') return;
            if (!listenerRegistry.has(type)) {
                listenerRegistry.set(type, new Set());
            }
            listenerRegistry.get(type).add(handler);
            track(listenerStats.added, type);
        },
        removeEventListener(type, handler) {
            if (!type || typeof handler !== 'function') return;
            if (listenerRegistry.has(type)) {
                listenerRegistry.get(type).delete(handler);
            }
            track(listenerStats.removed, type);
        },
        showMessage() {},
        AppData: {
            ready: Promise.resolve(),
            recovery: {
                async listActiveSessions() {
                    return cloneValue(activeSessions);
                },
                async saveActiveSession(value, options = {}) {
                    if (typeof options.commitGuard === 'function' && options.commitGuard() !== true) {
                        return { committed: false };
                    }
                    const entity = cloneValue(value);
                    const entityId = String(entity && (entity.id || entity.sessionId) || '');
                    if (!entityId) return { committed: false };
                    const index = activeSessions.findIndex(item => String(item && (item.id || item.sessionId) || '') === entityId);
                    if (index >= 0) activeSessions[index] = entity;
                    else activeSessions.push(entity);
                    return { committed: true, value: cloneValue(entity) };
                },
                async discardActiveSession(entityId, options = {}) {
                    if (typeof options.commitGuard === 'function' && options.commitGuard() !== true) {
                        return { committed: false };
                    }
                    const normalized = String(entityId || '');
                    const before = activeSessions.length;
                    activeSessions = activeSessions.filter(item => String(item && (item.id || item.sessionId) || '') !== normalized);
                    return { committed: true, removed: before !== activeSessions.length };
                },
                windowSession: {
                    save(kind, value) {
                        windowSessionStore.set(String(kind), cloneValue(value));
                        return true;
                    },
                    get(kind) {
                        return cloneValue(windowSessionStore.get(String(kind)) || null);
                    },
                    discard(kind) {
                        windowSessionStore.delete(String(kind));
                        return true;
                    }
                }
            },
            practice: {
                async list() {
                    return cloneValue(practiceRecords);
                },
                async get(recordId) {
                    const target = String(recordId || '');
                    const record = practiceRecords.find((item) => item && (
                        String(item.id || '') === target || String(item.sessionId || '') === target
                    ));
                    return cloneValue(record || null);
                },
                async getStats() {
                    return {};
                },
                async completeAttempt(command = {}) {
                    const record = cloneValue(command.record || {});
                    practiceRecords.push(record);
                    return { committed: true, record };
                },
                async finalizeSuite(command = {}) {
                    const record = cloneValue(command.record || {});
                    practiceRecords = [record];
                    return { committed: true, record };
                }
            },
            preferences: {
                async patchSuite() {
                    return { committed: true };
                }
            }
        },
        async resolveExamForPracticeRecord(record) {
            const examId = String(record && record.examId || '');
            return examId ? { id: examId, title: record.title || examId, type: 'reading', path: 'Reading/' + examId + '/' } : null;
        },
        async resolveActiveLibraryIndex() {
            return ['reading-p1', 'reading-p2', 'reading-p3'].map((id) => ({
                id,
                title: id,
                type: 'reading',
                path: 'Reading/' + id + '/'
            }));
        },
        CustomEvent: function CustomEvent(type, init = {}) {
            return { type, detail: init.detail || null };
        },
        location: { origin: 'http://localhost', href: 'http://localhost/' },
        crypto: webcrypto,
        practiceConfig: { suite: {} },
        __listenerCount(type) {
            if (!listenerRegistry.has(type)) return 0;
            return listenerRegistry.get(type).size;
        },
        __listenerStats: listenerStats
    };

    const sandbox = {
        window: windowStub,
        document: documentStub,
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Math,
        CustomEvent: windowStub.CustomEvent,
        URL,
        URLSearchParams,
        Uint8Array
    };
    sandbox.globalThis = sandbox.window;
    return { sandbox, windowStub, windowSessionStore };
}

function createApp(windowStub) {
    const app = {
        components: {},
        setState() {},
        getState() { return null; },
        updateExamStatus() {},
        refreshOverviewData() {},
        _updatePracticeRecordsState: async () => {},
        cleanupExamSession: async () => {},
        saveRealPracticeData: async () => {}
    };
    Object.assign(app, windowStub.ExamSystemAppMixins.examSession, windowStub.ExamSystemAppMixins.suitePractice);
    app._suiteModeReady = true;
    app.suiteExamMap = new Map();
    app.multiSuiteSessionsMap = new Map();
    return app;
}

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

function makeSession(sessionId = 'suite_test_1') {
    const sequence = [
        { examId: 'reading-p1', exam: { id: 'reading-p1', title: 'Passage 1', category: 'P1' } },
        { examId: 'reading-p2', exam: { id: 'reading-p2', title: 'Passage 2', category: 'P2' } },
        { examId: 'reading-p3', exam: { id: 'reading-p3', title: 'Passage 3', category: 'P3' } }
    ];
    return {
        id: sessionId,
        status: 'active',
        startTime: Date.now(),
        sequence,
        currentIndex: 0,
        results: [],
        draftsByExam: {},
        elapsedByExam: {},
        globalTimerAnchorMs: Date.now(),
        flowMode: 'simulation',
        autoAdvanceAfterSubmit: true,
        windowRef: createStubWindow('suite-window'),
        windowName: 'ielts-suite-mode-tab',
        activeExamId: sequence[0].examId
    };
}

async function run() {
    const { sandbox, windowStub, windowSessionStore } = createSandbox();
    const context = vm.createContext(sandbox);
    loadScript('js/app/examSessionMixin.js', context);
    loadScript('js/app/suitePracticeMixin.js', context);

    if (!windowStub.ExamSystemAppMixins || !windowStub.ExamSystemAppMixins.suitePractice) {
        throw new Error('mixin 加载失败');
    }

    // Case 0: 单题历史回顾必须从记录根层或 realData 回灌高亮
    {
        const app = createApp(windowStub);
        const rootHighlights = [{ id: 'hl-root', scope: 'left', text: 'root highlight' }];
        const realDataHighlights = [{ id: 'hl-real', scope: 'groups', text: 'realData highlight' }];

        const rootEntry = app._buildReviewReplayEntriesFromRecord({
            examId: 'reading-p1',
            title: 'Single P1',
            answers: { q1: 'A' },
            correctAnswerMap: { q1: 'A' },
            answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 },
            highlights: rootHighlights,
            scrollY: 120,
            metadata: { examId: 'reading-p1', examTitle: 'Single P1' }
        })[0];

        assert.deepStrictEqual(plain(rootEntry.highlights), rootHighlights, '单题根层 highlights 必须进入 replay entry');
        assert.strictEqual(rootEntry.scrollY, 120, '单题根层 scrollY 必须进入 replay entry');

        const legacyEntry = app._buildReviewReplayEntriesFromRecord({
            examId: 'reading-p2',
            title: 'Single P2',
            answers: { q1: 'B' },
            correctAnswerMap: { q1: 'B' },
            answerComparison: { q1: { userAnswer: 'B', correctAnswer: 'B', isCorrect: true } },
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 },
            realData: {
                highlights: realDataHighlights,
                scrollY: 240
            },
            metadata: { examId: 'reading-p2', examTitle: 'Single P2' }
        })[0];

        assert.deepStrictEqual(plain(legacyEntry.highlights), realDataHighlights, '单题 legacy realData.highlights 必须进入 replay entry');
        assert.strictEqual(legacyEntry.scrollY, 240, '单题 legacy realData.scrollY 必须进入 replay entry');
    }

    // Case 1: P1 提交后自动跳转 P2，发送 SIMULATION_CONTEXT
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_auto');
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));

        const openCalls = [];
        app.openExam = async (examId, options = {}) => {
            openCalls.push({ examId, options });
            const win = createStubWindow('suite-window');
            win.lastExamId = examId;
            return win;
        };

        const originalWindow = session.windowRef;
        const handled = await app.handleSuitePracticeComplete('reading-p1', {
            suiteSessionId: session.id,
            answers: { q1: 'A' },
            answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
        }, originalWindow);

        assert.strictEqual(handled, true, '自动模式应正常处理完成');
        assert.strictEqual(openCalls.length, 1, '自动模式应打开下一篇');
        assert.strictEqual(openCalls[0].examId, 'reading-p2', '自动模式应进入第二篇');
        assert.strictEqual(openCalls[0].options.suiteFlowMode, 'simulation', '模拟模式应透传 suiteFlowMode');
        assert.strictEqual(openCalls[0].options.sequenceTotal, 3, '模拟模式应透传 sequenceTotal');
        assert(session.draftsByExam['reading-p1'], 'P1 draft 应被保存');
        const oldWindowSimCtx = originalWindow._messages.filter(msg => msg && msg.type === 'SIMULATION_CONTEXT');
        assert.strictEqual(oldWindowSimCtx.length, 0, '旧窗口不应收到 SIMULATION_CONTEXT');
        const newWindowSimCtx = session.windowRef._messages.filter(msg => msg && msg.type === 'SIMULATION_CONTEXT');
        assert.ok(newWindowSimCtx.length >= 1, '新窗口应收到 SIMULATION_CONTEXT');
    }

    // Case 1.1: 手动回看模式下提交后不应自动跳篇
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_manual');
        session.flowMode = 'classic';
        session.autoAdvanceAfterSubmit = false;
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));

        let openCount = 0;
        app.openExam = async () => {
            openCount += 1;
            return createStubWindow('suite-window');
        };
        let reviewStateCount = 0;
        app._sendSuiteReviewState = async () => {
            reviewStateCount += 1;
            return true;
        };

        const handled = await app.handleSuitePracticeComplete('reading-p1', {
            suiteSessionId: session.id,
            answers: { q1: 'A' },
            answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
        }, session.windowRef);

        assert.strictEqual(handled, true, '手动模式提交应处理成功');
        assert.strictEqual(openCount, 0, '手动模式提交后不应自动打开下一篇');
        assert.strictEqual(reviewStateCount, 1, '手动模式应下发回看上下文');
        assert.strictEqual(session.currentIndex, 0, '手动模式应停留在当前篇');
        assert.strictEqual(session.pendingAdvance.completedExamId, 'reading-p1', '应记录待切题状态');
    }

    // Case 2: SIMULATION_NAVIGATE 前后切换并保存 draft
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_nav');
        session.currentIndex = 1;
        session.activeExamId = 'reading-p2';
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));

        const openCalls = [];
        app.openExam = async (examId, options = {}) => {
            openCalls.push({ examId, options });
            const win = createStubWindow('suite-window');
            win.lastExamId = examId;
            return win;
        };

        // Navigate prev from P2 to P1
        const p2Highlights = [{ scope: 'left', text: 'important P2 text', color: 'yellow' }];
        const navPrev = await app._handleSimulationNavigate('reading-p2', {
            direction: 'prev',
            draft: { answers: { q1: 'B' }, highlights: p2Highlights, scrollY: 100 },
            resultSnapshot: {
                answers: { q1: 'B' },
                answerComparison: { q1: { userAnswer: 'B', correctAnswer: 'B', isCorrect: true } },
                scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
            },
            highlights: p2Highlights,
            scrollY: 100,
            elapsed: 120
        }, session.windowRef);
        assert.strictEqual(navPrev, true, '向前导航应成功');
        assert.strictEqual(session.currentIndex, 0, '应回到第一篇');
        assert.strictEqual(session.activeExamId, 'reading-p1', '活动篇章应是 P1');
        assert.strictEqual(openCalls[0].options.suiteFlowMode, 'simulation', '导航应透传 suiteFlowMode');
        assert.strictEqual(openCalls[0].options.sequenceTotal, 3, '导航应透传 sequenceTotal');
        assert.deepStrictEqual(session.draftsByExam['reading-p2'].answers, { q1: 'B' }, 'P2 draft 应被保存');
        assert.strictEqual(session.elapsedByExam['reading-p2'], 120, 'P2 elapsed 应被保存');
        assert.strictEqual(session.results.length, 1, '导航时应记录当前篇快照结果');
        assert.strictEqual(session.results[0].examId, 'reading-p2', '导航快照应绑定当前篇');
        assert.strictEqual(Object.prototype.hasOwnProperty.call(session.results[0], 'highlights'), false, 'results 不应重复持久化高亮');
        assert.strictEqual(Object.prototype.hasOwnProperty.call(session.results[0], 'scrollY'), false, 'results 不应重复持久化滚动位置');
        assert.strictEqual(Object.prototype.hasOwnProperty.call(session.results[0].rawData || {}, 'highlights'), false, 'rawData 不应重复持久化高亮');

        // Navigate next from P1 to P2
        const navNext = await app._handleSimulationNavigate('reading-p1', {
            direction: 'next',
            draft: { answers: { q1: 'A' }, highlights: [], scrollY: 50 },
            resultSnapshot: {
                answers: { q1: 'A' },
                answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
                scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
            }
        }, session.windowRef);
        assert.strictEqual(navNext, true, '向后导航应成功');
        assert.strictEqual(session.currentIndex, 1, '应回到第二篇');
        assert.deepStrictEqual(session.draftsByExam['reading-p1'].answers, { q1: 'A' }, 'P1 draft 应被保存');
        assert.strictEqual(session.results.length, 2, '应记录两个篇章快照结果');
        const mirroredSession = windowSessionStore.get('simulation');
        const mirroredP2Result = mirroredSession.results.find(entry => entry.examId === 'reading-p2');
        assert.strictEqual(Object.prototype.hasOwnProperty.call(mirroredP2Result, 'highlights'), false, 'window session results 不应重复写高亮');
        assert.deepStrictEqual(mirroredSession.draftsByExam['reading-p2'].highlights, p2Highlights, 'window session 应只在 draft 中保存 P2 高亮');

        const p2Replay = app._buildSuiteReplayEntry(session, 'reading-p2');
        assert.deepStrictEqual(p2Replay.highlights, p2Highlights, '套题中途回看必须能恢复 P2 高亮');
        assert.strictEqual(p2Replay.scrollY, 100, '套题中途回看必须能恢复 P2 滚动位置');

        // Out of bounds
        session.currentIndex = 0;
        session.activeExamId = 'reading-p1';
        const navOob = await app._handleSimulationNavigate('reading-p1', { direction: 'prev' }, session.windowRef);
        assert.strictEqual(navOob, false, '向前越界应失败');
    }

    // Case 2.0.0: 手动/回顾模式结果缺少高亮时，必须从同篇 draft 回灌
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_review_draft_highlight');
        const p2Highlights = [{ scope: 'groups', text: 'P2 draft evidence', kind: 'highlight', start: 8, end: 25 }];
        session.flowMode = 'stationary';
        session.autoAdvanceAfterSubmit = false;
        session.results = [
            {
                examId: 'reading-p1', title: 'Passage 1', duration: 10,
                answers: { q1: 'A' }, answerComparison: {},
                scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }, rawData: {}
            },
            {
                examId: 'reading-p2',
                title: 'Passage 2',
                duration: 10,
                answers: { q1: 'B' },
                answerComparison: { q1: { userAnswer: 'B', correctAnswer: 'B', isCorrect: true } },
                scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 },
                highlights: [],
                scrollY: 0,
                rawData: {}
            },
            {
                examId: 'reading-p3', title: 'Passage 3', duration: 10,
                answers: { q1: 'C' }, answerComparison: {},
                scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }, rawData: {}
            }
        ];
        session.draftsByExam['reading-p2'] = {
            answers: { q1: 'B' },
            highlights: p2Highlights,
            noteText: 'P2 draft note',
            scrollY: 288,
            updatedAt: Date.now()
        };

        const p2Replay = app._buildSuiteReplayEntry(session, 'reading-p2');
        assert.deepStrictEqual(p2Replay.highlights, p2Highlights, '回顾态 replay 必须从 P2 draft 回灌高亮');
        assert.strictEqual(p2Replay.noteText, 'P2 draft note', '回顾态 replay 必须从 P2 draft 回灌笔记正文');
        assert.strictEqual(p2Replay.scrollY, 288, '回顾态 replay 必须从 P2 draft 回灌滚动位置');

        let savedRecord = null;
        app._saveSuitePracticeRecord = async (record) => {
            savedRecord = record;
        };
        app._updatePracticeRecordsState = async () => {};
        app._teardownSuiteSession = async () => {};
        app.currentSuiteSession = session;
        await app.finalizeSuiteRecord(session);
        const p2Entry = savedRecord.suiteEntries.find(entry => entry.examId === 'reading-p2');
        assert.deepStrictEqual(p2Entry.highlights, p2Highlights, '最终记录也必须保留 draft 中的 P2 高亮');
        assert.strictEqual(p2Entry.noteText, 'P2 draft note', '最终记录也必须保留 draft 中的 P2 笔记正文');
        assert.strictEqual(p2Entry.scrollY, 288, '最终记录也必须保留 draft 中的 P2 滚动位置');
        assert.strictEqual(Object.prototype.hasOwnProperty.call(p2Entry.rawData || {}, 'highlights'), false, '最终 entry.rawData 不应重复持久化高亮');
        assert.strictEqual(Object.prototype.hasOwnProperty.call(savedRecord.metadata || {}, 'suiteEntries'), false, 'metadata 不应重复持久化 suiteEntries');
        assert.strictEqual(Object.prototype.hasOwnProperty.call(savedRecord.realData || {}, 'suiteEntries'), false, 'realData 不应重复持久化 suiteEntries');
    }

    // Case 2.0.1: 模拟模式最终聚合记录必须保留 P2 高亮展示态
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_final_highlight');
        const p2Highlights = [{ scope: 'groups', text: 'P2 answer evidence', color: 'green' }];
        session.results = [
            { examId: 'reading-p1', title: 'Passage 1', duration: 10, answers: { q1: 'A' }, answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } }, scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }, rawData: {} },
            { examId: 'reading-p2', title: 'Passage 2', duration: 10, answers: { q1: 'B' }, answerComparison: { q1: { userAnswer: 'B', correctAnswer: 'B', isCorrect: true } }, scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }, highlights: p2Highlights, scrollY: 240, rawData: { highlights: p2Highlights, scrollY: 240 } },
            { examId: 'reading-p3', title: 'Passage 3', duration: 10, answers: { q1: 'C' }, answerComparison: { q1: { userAnswer: 'C', correctAnswer: 'C', isCorrect: true } }, scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }, rawData: {} }
        ];
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));

        let savedRecord = null;
        app._saveSuitePracticeRecord = async (record) => {
            savedRecord = record;
        };
        app._updatePracticeRecordsState = async () => {};
        app._teardownSuiteSession = async () => {};

        app.currentSuiteSession = session;
        await app.finalizeSuiteRecord(session);
        const p2Entry = savedRecord.suiteEntries.find(entry => entry.examId === 'reading-p2');
        assert(p2Entry, '最终套题记录必须包含 P2 entry');
        assert.deepStrictEqual(p2Entry.highlights, p2Highlights, '最终套题记录必须保留 P2 高亮');
        assert.strictEqual(p2Entry.scrollY, 240, '最终套题记录必须保留 P2 滚动位置');

        const replayEntries = app._buildReviewReplayEntriesFromRecord(savedRecord);
        const p2Replay = replayEntries.find(entry => entry.examId === 'reading-p2');
        assert.deepStrictEqual(p2Replay.highlights, p2Highlights, '最终回放 entry 必须保留 P2 高亮');
        assert.strictEqual(p2Replay.scrollY, 240, '最终回放 entry 必须保留 P2 滚动位置');
    }

    // Case 2.0.2: 回顾模式上一题/下一题必须把第二篇高亮下发到新页面
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_review_replay_highlight');
        const p2Highlights = [{ scope: 'left', text: 'P2 review evidence', kind: 'highlight', start: 12, end: 30 }];
        const p2Entry = {
            examId: 'reading-p2',
            title: 'Passage 2',
            answers: { q1: 'B' },
            answerComparison: { q1: { userAnswer: 'B', correctAnswer: 'B', isCorrect: true } },
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 },
            highlights: p2Highlights,
            scrollY: 321,
            rawData: { highlights: p2Highlights, scrollY: 321 }
        };
        const record = {
            id: session.id,
            suiteMode: true,
            suiteEntries: [
                { examId: 'reading-p1', title: 'Passage 1', answers: { q1: 'A' }, answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } }, scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 } },
                p2Entry
            ],
            metadata: { suiteSessionId: session.id, frequency: 'suite' }
        };
        const reviewSession = app._buildReviewSession(record);
        app._ensureReviewReplayStore().set(reviewSession.sessionId, reviewSession);

        const firstWindow = createStubWindow('review-window');
        const secondWindow = createStubWindow('review-window');
        app.examWindows = new Map();
        app.examWindows.set('reading-p1', {
            window: firstWindow,
            reviewMode: true,
            reviewSessionId: reviewSession.sessionId,
            reviewEntryIndex: 0,
            readOnly: true
        });
        app.openExam = async (examId, options = {}) => {
            assert.strictEqual(examId, 'reading-p2', '下一题应打开 P2');
            assert.strictEqual(options.examDefinition.id, 'reading-p2', '跨题回放必须传入按记录来源解析的题目定义');
            assert.strictEqual(options.requireRecordProvenance, true, '跨题回放不得回落到当前活动题库');
            app.examWindows.set(examId, {
                window: secondWindow,
                reviewMode: Boolean(options.reviewMode),
                reviewSessionId: options.reviewSessionId,
                reviewEntryIndex: options.reviewEntryIndex,
                readOnly: true
            });
            app._dispatchReviewReplayForExam(examId, secondWindow);
            return secondWindow;
        };

        await app.handleReviewReplayNavigate('reading-p1', {
            direction: 'next',
            reviewSessionId: reviewSession.sessionId
        }, firstWindow);

        const replayMsg = secondWindow._messages.find(msg => msg && msg.type === 'REPLAY_PRACTICE_RECORD');
        assert(replayMsg, '跨题回顾导航必须向 P2 页面下发回放数据');
        assert.deepStrictEqual(plain(replayMsg.data.entry.highlights), p2Highlights, '跨题回顾导航必须保留 P2 高亮');
        assert.strictEqual(replayMsg.data.entry.scrollY, 321, '跨题回顾导航必须保留 P2 滚动位置');
    }

    // Case 2.1: 模拟模式多次切换后不得回退为经典模式
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_nav_lock');
        session.flowMode = 'simulation';
        session.autoAdvanceAfterSubmit = true;
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));

        app.openExam = async (examId) => {
            const win = createStubWindow('suite-window');
            win.lastExamId = examId;
            return win;
        };

        const hops = [
            { from: 'reading-p1', direction: 'next' },
            { from: 'reading-p2', direction: 'next' },
            { from: 'reading-p3', direction: 'prev' },
            { from: 'reading-p2', direction: 'prev' },
            { from: 'reading-p1', direction: 'next' },
            { from: 'reading-p2', direction: 'next' }
        ];
        for (const hop of hops) {
            const ok = await app._handleSimulationNavigate(hop.from, {
                direction: hop.direction,
                draft: { answers: { q1: 'A' }, highlights: [], scrollY: 0 },
                resultSnapshot: {
                    answers: { q1: 'A' },
                    answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
                    scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
                }
            }, session.windowRef);
            assert.strictEqual(ok, true, `切换应成功: ${hop.from} -> ${hop.direction}`);
            assert.strictEqual(session.flowMode, 'simulation', '多次切换后 flowMode 必须保持 simulation');
            const ctxMsg = session.windowRef._messages.find(msg => msg && msg.type === 'SIMULATION_CONTEXT');
            assert(ctxMsg, '每次切换后都应下发 SIMULATION_CONTEXT');
            assert.strictEqual(ctxMsg.data.flowMode, 'simulation', '上下文 flowMode 必须是 simulation');
        }
    }

    // Case 2.2: 模拟模式切题必须串行化，且仅允许活动篇章触发
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_nav_guard');
        session.currentIndex = 0;
        session.activeExamId = 'reading-p1';
        app.currentSuiteSession = session;

        let resolveOpen = null;
        let openCallCount = 0;
        app.openExam = async () => {
            openCallCount += 1;
            return await new Promise((resolve) => {
                resolveOpen = () => resolve(createStubWindow('suite-window'));
            });
        };

        const firstNavigate = app._handleSimulationNavigate('reading-p1', {
            direction: 'next',
            draft: { answers: { q1: 'A' }, highlights: [], scrollY: 0 },
            resultSnapshot: {
                answers: { q1: 'A' },
                answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
                scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
            }
        }, session.windowRef);
        const secondNavigate = app._handleSimulationNavigate('reading-p1', { direction: 'next' }, session.windowRef);
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.strictEqual(openCallCount, 1, '并发切题期间只允许一次窗口切换');

        if (typeof resolveOpen === 'function') {
            resolveOpen();
        }
        const firstNavigateOk = await firstNavigate;
        assert.strictEqual(firstNavigateOk, true, '首个切题请求应成功');
        assert.strictEqual(await secondNavigate, false, '重复的旧篇请求应在串行等待后按 stale 消息忽略');

        session.activeExamId = 'reading-p2';
        const staleNavigate = await app._handleSimulationNavigate('reading-p1', { direction: 'next' }, session.windowRef);
        assert.strictEqual(staleNavigate, false, '非活动篇章消息必须忽略');
    }

    // Case 2.2.1: 新篇提交若撞上上一跳的 ready 等待，必须排队而不能丢失
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_nav_queue_next');
        session.currentIndex = 0;
        session.activeExamId = 'reading-p1';
        app.currentSuiteSession = session;

        let releaseFirstOpen;
        const opened = [];
        app.openExam = async (examId) => {
            opened.push(examId);
            if (opened.length === 1) {
                await new Promise((resolve) => { releaseFirstOpen = resolve; });
            }
            return createStubWindow('suite-window');
        };

        const firstNavigate = app._handleSimulationNavigate(
            'reading-p1',
            { direction: 'next' },
            session.windowRef
        );
        await new Promise(resolve => setTimeout(resolve, 0));
        const queuedNavigate = app._handleSimulationNavigate(
            'reading-p2',
            { direction: 'next' },
            session.windowRef
        );
        assert.deepStrictEqual(opened, ['reading-p2'], '锁内只应启动第一跳');

        releaseFirstOpen();
        assert.strictEqual(await firstNavigate, true, '第一跳应成功');
        assert.strictEqual(await queuedNavigate, true, '下一篇提交应在第一跳完成后继续处理');
        assert.deepStrictEqual(opened, ['reading-p2', 'reading-p3'], '排队提交应继续切到 P3');
        assert.strictEqual(session.currentIndex, 2, '串行导航后索引应到达 P3');
        assert.strictEqual(session.activeExamId, 'reading-p3', '串行导航后活动篇章应到达 P3');
    }

    // Case 2.3: 重复绑定同一 exam 消息通道时必须替换旧监听器
    {
        const app = createApp(windowStub);
        const examWindow = createStubWindow('ielts-suite-mode-tab');
        const session = makeSession('suite_handler_replace');
        app.currentSuiteSession = session;
        app.ensureExamWindowSession('reading-p1', examWindow);

        app.setupExamWindowCommunication(examWindow, 'reading-p1', session.sequence[0].exam, {
            suiteSessionId: session.id,
            suiteFlowMode: 'simulation'
        });
        const firstHandlerCount = windowStub.__listenerCount('message');
        assert.strictEqual(firstHandlerCount >= 1, true, '首次绑定后应存在 message 监听器');

        app.setupExamWindowCommunication(examWindow, 'reading-p1', session.sequence[0].exam, {
            suiteSessionId: session.id,
            suiteFlowMode: 'simulation'
        });

        const secondHandlerCount = windowStub.__listenerCount('message');
        assert.strictEqual(secondHandlerCount, firstHandlerCount, '重复绑定不应增长 message 监听器数量');
        const removedCount = windowStub.__listenerStats.removed.get('message') || 0;
        assert.strictEqual(removedCount >= 1, true, '重复绑定时应先移除旧监听器');
    }

    // Case 2.4: 模拟模式下 sessionId 短暂不一致时，仍应按 suiteSessionId 路由导航
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_msg_route');
        session.currentIndex = 1;
        session.activeExamId = 'reading-p2';
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));

        const examWindow = createStubWindow('ielts-suite-mode-tab');
        app.setupExamWindowCommunication(examWindow, 'reading-p2', session.sequence[1].exam, {
            suiteSessionId: session.id,
            suiteFlowMode: 'simulation',
            sequenceIndex: 1,
            sequenceTotal: 3
        });

        const info = app.ensureExamWindowSession('reading-p2', examWindow);
        info.expectedSessionId = 'expected_session';
        app._refreshExamWindowToken('reading-p2', info);
        info.suiteSessionId = session.id;
        app.examWindows.set('reading-p2', info);

        let routed = 0;
        let routedPayload = null;
        app._handleSimulationNavigate = async (examId, data) => {
            routed += 1;
            routedPayload = { examId, data };
            return true;
        };

        const handler = app.messageHandlers.get('reading-p2');
        assert.strictEqual(typeof handler, 'function', '应成功注册 reading-p2 消息处理器');

        await handler({
            source: examWindow,
            origin: 'http://localhost',
            data: {
                type: 'SIMULATION_NAVIGATE',
                data: {
                    examId: 'reading-p2',
                    suiteSessionId: session.id,
                    sessionId: 'stale_session',
                    windowSessionToken: info.windowSessionToken,
                    direction: 'prev',
                    source: 'practice_page'
                },
                source: 'practice_page'
            }
        });

        assert.strictEqual(routed, 1, 'sessionId 不一致时仍应路由模拟导航');
        assert.strictEqual(routedPayload.examId, 'reading-p2', '路由 examId 必须正确');
        assert.strictEqual(routedPayload.data.direction, 'prev', '路由方向必须正确');
    }

    // Case 2.4.1: inline simulation 草稿必须按 payload.examId 分区保存
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_inline_draft_route');
        session.currentIndex = 0;
        session.activeExamId = 'reading-p1';
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));

        const examWindow = createStubWindow('ielts-suite-mode-tab');
        app.setupExamWindowCommunication(examWindow, 'reading-p1', session.sequence[0].exam, {
            suiteSessionId: session.id,
            suiteFlowMode: 'simulation',
            sequenceIndex: 0,
            sequenceTotal: 3
        });

        const info = app.ensureExamWindowSession('reading-p1', examWindow);
        info.expectedSessionId = 'expected_inline_session';
        app._refreshExamWindowToken('reading-p1', info);
        info.suiteSessionId = session.id;
        app.examWindows.set('reading-p1', info);

        const handler = app.messageHandlers.get('reading-p1');
        await handler({
            source: examWindow,
            origin: 'http://localhost',
            data: {
                type: 'SIMULATION_DRAFT_SYNC',
                data: {
                    examId: 'reading-p2',
                    suiteSessionId: session.id,
                    sessionId: 'stale_inline_session',
                    windowSessionToken: info.windowSessionToken,
                    draft: {
                        answers: { q1: 'P2 answer' },
                        highlights: [{ scope: 'left', text: 'P2 highlight' }],
                        noteText: 'P2 note',
                        scrollY: 222,
                        updatedAt: 2000
                    },
                    draftUpdatedAt: 2000,
                    source: 'practice_page'
                },
                source: 'practice_page'
            }
        });

        assert.strictEqual(session.draftsByExam['reading-p1'], undefined, 'P2 草稿不能误写到 P1');
        assert.deepStrictEqual(session.draftsByExam['reading-p2'].answers, { q1: 'P2 answer' }, 'P2 草稿应按 payload.examId 保存');
        assert.strictEqual(session.draftsByExam['reading-p2'].noteText, 'P2 note', 'P2 noteText 应保存');
    }

    // Case 2.4.1a: a queued classic draft cannot write through a replaced registration.
    {
        const app = createApp(windowStub);
        const oldWindow = createStubWindow('old-reading-window');
        const newWindow = createStubWindow('new-reading-window');
        const oldInfo = {
            window: oldWindow,
            expectedSessionId: 'reading-session',
            sessionGeneration: 1,
            practiceMode: 'classic',
            suiteSessionId: null,
            reviewMode: false
        };
        const newInfo = { ...oldInfo, window: newWindow, sessionGeneration: 2 };
        app.examWindows = new Map([['reading-p1', oldInfo]]);
        let releaseQueue;
        app._readingDraftStoreQueue = new Promise((resolve) => { releaseQueue = resolve; });
        const pending = app._queueReadingDraftSync('reading-p1', {
            sessionId: 'reading-session',
            draft: { answers: { q1: 'stale' }, updatedAt: 100 },
            draftUpdatedAt: 100
        }, oldInfo);
        app.examWindows.set('reading-p1', newInfo);
        releaseQueue();
        assert.strictEqual(await pending, false, '窗口重注册后排队中的旧草稿必须被拒绝');
    }

    // Case 2.4.1b: suite handler failure must not fall back to a standalone v2 attempt.
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_no_standalone_fallback');
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map((item) => [item.examId, session.id]));
        const suiteWindowInfo = app.ensureExamWindowSession('reading-p1', session.windowRef);
        suiteWindowInfo.suiteSessionId = session.id;
        app.examWindows.set('reading-p1', suiteWindowInfo);
        const suiteRegistration = app._captureExamSessionRegistration('reading-p1', suiteWindowInfo);
        app.handleSuitePracticeComplete = async () => { throw new Error('suite handler failure'); };
        let standaloneWrites = 0;
        app.saveRealPracticeData = async () => { standaloneWrites += 1; return { id: 'unexpected' }; };
        assert.strictEqual(await app.handlePracticeComplete('reading-p1', {
            answers: { q1: 'A' },
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
        }, session.windowRef, { expectedRegistration: suiteRegistration }), false);
        assert.strictEqual(standaloneWrites, 0, '套题处理失败不得写入单篇 fallback');
    }

    // Case 2.4.1c: an active suite must not capture an independently registered
    // standalone completion, including an exam id that also appears in the suite.
    {
        const verifyStandaloneCompletion = async (examId, label) => {
            const app = createApp(windowStub);
            const session = makeSession(`suite_parallel_${label}`);
            app.currentSuiteSession = session;
            app.suiteExamMap = new Map(session.sequence.map((item) => [item.examId, session.id]));

            let suiteHandlerCalls = 0;
            app.handleSuitePracticeComplete = async () => {
                suiteHandlerCalls += 1;
                return false;
            };

            const sourceWindow = createStubWindow(`standalone-${label}`);
            sourceWindow.location.href = `http://localhost/${examId}.html`;
            const windowInfo = app.ensureExamWindowSession(examId, sourceWindow);
            windowInfo.expectedOrigin = 'http://localhost';
            windowInfo.allowOpaqueOrigin = false;
            windowInfo.suiteSessionId = null;
            app.examWindows.set(examId, windowInfo);
            const registration = app._captureExamSessionRegistration(examId, windowInfo);

            let recorderWrites = 0;
            app.components.practiceRecorder = {
                activeSessions: new Map([[examId, {
                    examId,
                    sessionId: windowInfo.expectedSessionId
                }]]),
                async handleSessionCompleted(data) {
                    recorderWrites += 1;
                    return {
                        id: `record-${label}`,
                        examId,
                        sessionId: data.sessionId,
                        endTime: data.endTime
                    };
                },
                endPracticeSession() {}
            };
            app._isPracticeCompletionPersisted = async () => true;

            const completion = {
                examId,
                sessionId: windowInfo.expectedSessionId,
                submissionId: `submission-${label}`,
                endTime: '2026-08-10T00:00:00.000Z',
                answers: { q1: 'A' },
                scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 },
                metadata: { type: 'reading', examType: 'reading', practiceMode: 'single' }
            };

            assert.strictEqual(await app.handlePracticeComplete(examId, completion, sourceWindow, {
                expectedRegistration: registration
            }), true, `${label}: standalone completion should commit while a suite is active`);
            assert.strictEqual(suiteHandlerCalls, 0, `${label}: standalone completion must not enter the suite handler`);
            assert.strictEqual(recorderWrites, 1, `${label}: standalone completion must persist exactly once`);
            const ack = sourceWindow._messages.find((message) => message && message.type === 'PRACTICE_SUBMIT_ACK');
            assert(ack, `${label}: committed standalone completion must receive an ACK`);
        };

        await verifyStandaloneCompletion('standalone-reading', 'unrelated-exam');
        await verifyStandaloneCompletion('reading-p2', 'mapped-exam-with-standalone-registration');
    }

    // Case 2.4.2: inline simulation 草稿同步必须按篇拆分 elapsed，并镜像回窗口会话域
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_inline_elapsed_route');
        session.currentIndex = 0;
        session.activeExamId = 'reading-p1';
        session.elapsedByExam['reading-p1'] = 60;
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));

        const examWindow = createStubWindow('ielts-suite-mode-tab');
        app.setupExamWindowCommunication(examWindow, 'reading-p1', session.sequence[0].exam, {
            suiteSessionId: session.id,
            suiteFlowMode: 'simulation',
            sequenceIndex: 0,
            sequenceTotal: 3
        });

        const info = app.ensureExamWindowSession('reading-p1', examWindow);
        info.expectedSessionId = 'expected_inline_elapsed_session';
        app._refreshExamWindowToken('reading-p1', info);
        info.suiteSessionId = session.id;
        app.examWindows.set('reading-p1', info);

        const handler = app.messageHandlers.get('reading-p1');
        await handler({
            source: examWindow,
            origin: 'http://localhost',
            data: {
                type: 'SIMULATION_DRAFT_SYNC',
                data: {
                    examId: 'reading-p2',
                    suiteSessionId: session.id,
                    sessionId: 'stale_inline_elapsed_session',
                    windowSessionToken: info.windowSessionToken,
                    draft: {
                        answers: { q1: 'P2 answer' },
                        highlights: [],
                        noteText: 'P2 note',
                        scrollY: 222,
                        updatedAt: 3000
                    },
                    draftUpdatedAt: 3000,
                    elapsed: 120,
                    source: 'practice_page'
                },
                source: 'practice_page'
            }
        });

        assert.strictEqual(session.elapsedByExam['reading-p2'], 60, 'P2 elapsed 必须按整套累计时间拆分为单篇时长');
        const mirrored = windowSessionStore.get('simulation');
        assert.strictEqual(mirrored.elapsedByExam['reading-p2'], 60, '窗口会话镜像也必须保存拆分后的 P2 elapsed');
    }

    // Case 2.5: activeExamId 漂移但 currentIndex 正确时，导航应自愈继续
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_nav_self_heal');
        session.currentIndex = 0;
        session.activeExamId = 'reading-p2'; // 人为模拟迟到 SESSION_READY 导致的漂移
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));

        let openCount = 0;
        app.openExam = async (examId) => {
            openCount += 1;
            const win = createStubWindow('suite-window');
            win.lastExamId = examId;
            return win;
        };

        const healed = await app._handleSimulationNavigate('reading-p1', {
            direction: 'next',
            draft: { answers: { q1: 'A' }, highlights: [], scrollY: 0 }
        }, session.windowRef);
        assert.strictEqual(healed, true, 'activeExamId 漂移时应允许按 currentIndex 自愈导航');
        assert.strictEqual(openCount, 1, '自愈导航应继续执行切题');
        assert.strictEqual(session.currentIndex, 1, '自愈后应前进到 P2');
        assert.strictEqual(session.activeExamId, 'reading-p2', '自愈后活动篇章应正确对齐');
    }

    // Case 3: P3 (最后一篇) 提交后应立即 finalize
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_finalize');
        session.results = [
            { examId: 'reading-p1', title: 'Passage 1', answers: { q1: 'A' }, answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } }, scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }, rawData: {} },
            { examId: 'reading-p2', title: 'Passage 2', answers: { q1: 'B' }, answerComparison: { q1: { userAnswer: 'B', correctAnswer: 'B', isCorrect: true } }, scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }, rawData: {} }
        ];
        session.currentIndex = 2;
        session.activeExamId = 'reading-p3';
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));

        let finalizeCount = 0;
        app.finalizeSuiteRecord = async () => {
            finalizeCount += 1;
        };

        const handled = await app.handleSuitePracticeComplete('reading-p3', {
            suiteSessionId: session.id,
            answers: { q1: 'C' },
            answerComparison: { q1: { userAnswer: 'C', correctAnswer: 'C', isCorrect: true } },
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
        }, session.windowRef);

        assert.strictEqual(handled, true, '最后一篇提交应成功');
        assert.strictEqual(finalizeCount, 1, '最后一篇提交后应立即 finalize');
    }

    // Case 3.0.1: inline simulation 整套提交应一次 finalize 并保留三篇草稿态
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_inline_submit');
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));

        let finalizeCount = 0;
        app.finalizeSuiteRecord = async (handledSession) => {
            finalizeCount += 1;
            assert.strictEqual(handledSession, session, '应 finalize 当前套题 session');
        };

        const handled = await app.handleSuitePracticeComplete('reading-p1', {
            suiteSessionId: session.id,
            suiteSubmission: true,
            duration: 3600,
            suiteEntries: [
                {
                    examId: 'reading-p1',
                    title: 'Passage 1',
                    category: 'P1',
                    duration: 1200,
                    answers: { q1: 'A' },
                    answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
                    scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 },
                    highlights: [{ scope: 'left', text: 'P1 highlight' }],
                    noteText: 'P1 note',
                    scrollY: 111,
                    updatedAt: 1001
                },
                {
                    examId: 'reading-p2',
                    title: 'Passage 2',
                    category: 'P2',
                    duration: 1100,
                    answers: { q1: 'B' },
                    answerComparison: { q1: { userAnswer: 'B', correctAnswer: 'B', isCorrect: true } },
                    scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 },
                    highlights: [{ scope: 'groups', text: 'P2 highlight' }],
                    noteText: 'P2 note',
                    scrollY: 222,
                    updatedAt: 1002
                },
                {
                    examId: 'reading-p3',
                    title: 'Passage 3',
                    category: 'P3',
                    duration: 1300,
                    answers: { q1: 'C' },
                    answerComparison: { q1: { userAnswer: 'C', correctAnswer: 'C', isCorrect: true } },
                    scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 },
                    highlights: [{ scope: 'left', text: 'P3 highlight' }],
                    noteText: 'P3 note',
                    scrollY: 333,
                    updatedAt: 1003
                }
            ]
        }, session.windowRef);

        assert.strictEqual(handled, true, 'inline 整套提交应被处理');
        assert.strictEqual(finalizeCount, 1, 'inline 整套提交只 finalize 一次');
        assert.strictEqual(session.currentIndex, 3, '整套提交后 currentIndex 应到末尾');
        assert.strictEqual(session.results.length, 3, '整套提交应填充三篇 result');
        assert.deepStrictEqual(plain(session.results.map(item => item.examId)), ['reading-p1', 'reading-p2', 'reading-p3'], 'result 顺序应跟 sequence 一致');
        assert.strictEqual(session.draftsByExam['reading-p1'].noteText, 'P1 note', 'P1 noteText 应入 draft');
        assert.strictEqual(session.draftsByExam['reading-p2'].noteText, 'P2 note', 'P2 noteText 应入 draft');
        assert.strictEqual(session.draftsByExam['reading-p3'].scrollY, 333, 'P3 scrollY 应入 draft');
        assert.deepStrictEqual(plain(session.draftsByExam['reading-p2'].highlights), [{ scope: 'groups', text: 'P2 highlight' }], 'P2 高亮应隔离保存');
    }

    // Case 3.0.2: inline simulation 提交必须在落库后 ACK，并可按同一 submissionId 重放
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_inline_submit_ack');
        const sourceWindow = session.windowRef;
        const examId = 'reading-p1';
        const sessionId = 'session-inline-submit-ack';
        const submissionId = 'submission-inline-submit-ack';
        sourceWindow.location.href = `http://localhost/${examId}.html`;
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));
        app.examWindows = new Map([[examId, {
            window: sourceWindow,
            expectedSessionId: sessionId,
            sessionId,
            windowSessionToken: 'token-inline-submit-ack',
            windowSessionTokenSessionId: sessionId,
            expectedUrl: sourceWindow.location.href,
            expectedOrigin: 'http://localhost',
            allowOpaqueOrigin: false,
            suiteSessionId: session.id
        }]]);
        const payload = {
            examId,
            sessionId,
            submissionId,
            suiteSessionId: session.id,
            suiteSubmission: true,
            duration: 3600,
            suiteEntries: session.sequence.map((entry, index) => ({
                examId: entry.examId,
                title: entry.exam.title,
                category: entry.exam.category,
                duration: 1200,
                answers: { q1: String.fromCharCode(65 + index) },
                answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
                scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
            }))
        };

        assert.strictEqual(await app.handlePracticeComplete(examId, payload, sourceWindow), true);
        let ack = sourceWindow._messages.filter(message => message && message.type === 'PRACTICE_SUBMIT_ACK').at(-1);
        assert(ack, 'inline simulation persistence must ACK the child');
        assert.deepStrictEqual(plain({
            submissionId: ack.data.submissionId,
            sessionId: ack.data.sessionId,
            examId: ack.data.examId,
            suiteSessionId: ack.data.suiteSessionId
        }), { submissionId, sessionId, examId, suiteSessionId: session.id });
        assert.strictEqual((await windowStub.AppData.practice.list()).length, 1, 'first submit must persist one suite record');

        assert.strictEqual(await app.handlePracticeComplete(examId, payload, sourceWindow), true);
        ack = sourceWindow._messages.filter(message => message && message.type === 'PRACTICE_SUBMIT_ACK').at(-1);
        assert(ack, 'retry must replay the persisted ACK');
        assert.strictEqual((await windowStub.AppData.practice.list()).length, 1, 'retry must not persist a second suite record');
        clearTimeout(session.submitReceiptTeardownTimer);
        session.submitReceiptTeardownTimer = null;
    }

    // Case 3.0.3: multi-suite 保存失败必须 NACK，同键重试成功后才 ACK
    {
        const app = createApp(windowStub);
        const examId = 'listening-multi-suite';
        const sessionId = 'session-multi-submit';
        const submissionId = 'submission-multi-submit';
        const suiteSessionId = 'suite-session-multi-submit';
        const sourceWindow = createStubWindow('multi-suite-submit');
        sourceWindow.location.href = `http://localhost/${examId}.html`;
        app.examWindows = new Map([[examId, {
            window: sourceWindow,
            expectedSessionId: sessionId,
            sessionId,
            windowSessionToken: 'token-multi-submit',
            windowSessionTokenSessionId: sessionId,
            expectedUrl: sourceWindow.location.href,
            expectedOrigin: 'http://localhost',
            allowOpaqueOrigin: false
        }]]);
        let saveAttempts = 0;
        app._saveSuitePracticeRecord = async () => {
            saveAttempts += 1;
            if (saveAttempts === 1) throw new Error('expected multi-suite save failure');
        };
        const payload = {
            examId,
            sessionId,
            submissionId,
            suiteSessionId,
            suiteId: 'set-1',
            totalSuites: 1,
            answers: { q1: 'A' },
            answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
        };

        assert.strictEqual(await app.handlePracticeComplete(examId, payload, sourceWindow), false);
        let outcome = sourceWindow._messages.filter(message => message && /^PRACTICE_SUBMIT_/.test(message.type)).at(-1);
        assert.strictEqual(outcome.type, 'PRACTICE_SUBMIT_FAILED');
        assert.deepStrictEqual(plain({
            submissionId: outcome.data.submissionId,
            sessionId: outcome.data.sessionId,
            examId: outcome.data.examId,
            suiteSessionId: outcome.data.suiteSessionId
        }), { submissionId, sessionId, examId, suiteSessionId });

        assert.strictEqual(await app.handlePracticeComplete(examId, payload, sourceWindow), true);
        outcome = sourceWindow._messages.filter(message => message && /^PRACTICE_SUBMIT_/.test(message.type)).at(-1);
        assert.strictEqual(outcome.type, 'PRACTICE_SUBMIT_ACK');
        assert.strictEqual(saveAttempts, 2, 'retry must re-attempt the failed aggregate save exactly once');
    }

    // Case 3.0.4: canonical receipt 未确认 committed 时必须 NACK
    {
        const app = createApp(windowStub);
        const examId = 'listening-multi-uncommitted-receipt';
        const sessionId = 'session-multi-uncommitted-receipt';
        const submissionId = 'submission-multi-uncommitted-receipt';
        const sourceWindow = createStubWindow('multi-uncommitted-receipt');
        sourceWindow.location.href = `http://localhost/${examId}.html`;
        app.examWindows = new Map([[examId, {
            window: sourceWindow,
            expectedSessionId: sessionId,
            sessionId,
            windowSessionToken: 'token-multi-uncommitted-receipt',
            windowSessionTokenSessionId: sessionId,
            expectedUrl: sourceWindow.location.href,
            expectedOrigin: 'http://localhost',
            allowOpaqueOrigin: false
        }]]);
        const originalFinalizeSuite = windowStub.AppData.practice.finalizeSuite;
        windowStub.AppData.practice.finalizeSuite = async () => ({ committed: false });
        try {
            const committed = await app.handlePracticeComplete(examId, {
                examId,
                sessionId,
                submissionId,
                suiteSessionId: 'suite-multi-uncommitted-receipt',
                suiteId: 'set-1',
                totalSuites: 1,
                answers: { q1: 'A' },
                answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
                scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
            }, sourceWindow);
            assert.strictEqual(committed, false, 'uncommitted canonical receipt must not be treated as success');
        } finally {
            windowStub.AppData.practice.finalizeSuite = originalFinalizeSuite;
        }
        const outcome = sourceWindow._messages.filter(message => message && /^PRACTICE_SUBMIT_/.test(message.type)).at(-1);
        assert(outcome && outcome.type === 'PRACTICE_SUBMIT_FAILED', 'uncommitted canonical receipt must NACK');
    }

    // Case 3.0.5: reading suite 聚合提交后的 UI/清理故障不得触发单篇 fallback 或假 NACK
    for (const failingStep of ['sync', 'overview', 'message', 'teardown-schedule']) {
        const app = createApp(windowStub);
        const session = makeSession(`suite_post_commit_${failingStep}`);
        const sourceWindow = session.windowRef;
        const examId = 'reading-p1';
        const sessionId = `session-post-commit-${failingStep}`;
        const submissionId = `submission-post-commit-${failingStep}`;
        sourceWindow.location.href = `http://localhost/${examId}.html`;
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));
        app.examWindows = new Map([[examId, {
            window: sourceWindow,
            expectedSessionId: sessionId,
            sessionId,
            windowSessionToken: `token-post-commit-${failingStep}`,
            windowSessionTokenSessionId: sessionId,
            expectedUrl: sourceWindow.location.href,
            expectedOrigin: 'http://localhost',
            allowOpaqueOrigin: false,
            suiteSessionId: session.id
        }]]);

        const aggregateRecords = [];
        let partialFallbacks = 0;
        let standaloneFallbacks = 0;
        app._saveSuitePracticeRecord = async (record) => {
            aggregateRecords.push(record);
        };
        app._savePartialSuiteAsIndividual = async () => {
            partialFallbacks += 1;
        };
        app.saveRealPracticeData = async () => {
            standaloneFallbacks += 1;
            return { id: `unexpected-standalone-${failingStep}` };
        };
        if (failingStep === 'sync') {
            app._updatePracticeRecordsState = async () => { throw new Error('expected sync failure'); };
        } else if (failingStep === 'overview') {
            app.refreshOverviewData = () => { throw new Error('expected overview failure'); };
        } else if (failingStep === 'teardown-schedule') {
            app._scheduleSuiteSubmitTeardown = () => { throw new Error('expected teardown scheduling failure'); };
        }
        const originalShowMessage = windowStub.showMessage;
        if (failingStep === 'message') {
            windowStub.showMessage = () => { throw new Error('expected completion message failure'); };
        }

        const payload = {
            examId,
            sessionId,
            submissionId,
            suiteSessionId: session.id,
            suiteSubmission: true,
            duration: 3600,
            suiteEntries: session.sequence.map((entry, index) => ({
                examId: entry.examId,
                title: entry.exam.title,
                category: entry.exam.category,
                duration: 1200,
                answers: { q1: String.fromCharCode(65 + index) },
                answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
                scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
            }))
        };

        try {
            assert.strictEqual(await app.handlePracticeComplete(examId, payload, sourceWindow), true, `${failingStep}: committed suite must return success`);
            app.examWindows.get(examId).practiceSubmitReceipts = {};
            assert.strictEqual(await app.handlePracticeComplete(examId, payload, sourceWindow), true, `${failingStep}: completed-session retry must return success without receipt cache`);
        } finally {
            windowStub.showMessage = originalShowMessage;
            if (session.submitReceiptTeardownTimer) {
                clearTimeout(session.submitReceiptTeardownTimer);
                session.submitReceiptTeardownTimer = null;
            }
        }
        const outcomes = sourceWindow._messages.filter(message => message && /^PRACTICE_SUBMIT_/.test(message.type));
        assert(outcomes.length >= 2 && outcomes.every(message => message.type === 'PRACTICE_SUBMIT_ACK'), `${failingStep}: commit and completed-session retry must only ACK`);
        assert.strictEqual(aggregateRecords.length, 1, `${failingStep}: aggregate record must be written exactly once`);
        assert.strictEqual(partialFallbacks, 0, `${failingStep}: individual suite fallback must not run after commit`);
        assert.strictEqual(standaloneFallbacks, 0, `${failingStep}: outer standalone fallback must not run after commit`);
        assert.strictEqual(session.status, 'completed', `${failingStep}: committed session must stay completed`);
    }

    // Case 3.0.6: multi-suite 聚合提交后的各后置步骤故障仍须 ACK 且保持单次聚合写入
    for (const failingStep of ['spelling', 'sync', 'overview', 'session-cleanup', 'message']) {
        const app = createApp(windowStub);
        const examId = `listening-multi-post-commit-${failingStep}`;
        const sessionId = `session-multi-post-commit-${failingStep}`;
        const submissionId = `submission-multi-post-commit-${failingStep}`;
        const suiteSessionId = `suite-multi-post-commit-${failingStep}`;
        const sourceWindow = createStubWindow(`multi-post-commit-${failingStep}`);
        sourceWindow.location.href = `http://localhost/${examId}.html`;
        app.examWindows = new Map([[examId, {
            window: sourceWindow,
            expectedSessionId: sessionId,
            sessionId,
            windowSessionToken: `token-multi-post-commit-${failingStep}`,
            windowSessionTokenSessionId: sessionId,
            expectedUrl: sourceWindow.location.href,
            expectedOrigin: 'http://localhost',
            allowOpaqueOrigin: false
        }]]);

        const aggregateRecords = [];
        let standaloneFallbacks = 0;
        app._saveSuitePracticeRecord = async (record) => {
            aggregateRecords.push(record);
        };
        app.saveRealPracticeData = async () => {
            standaloneFallbacks += 1;
            return { id: `unexpected-multi-standalone-${failingStep}` };
        };
        if (failingStep === 'sync') {
            app._updatePracticeRecordsState = async () => { throw new Error('expected multi sync failure'); };
        } else if (failingStep === 'overview') {
            app.refreshOverviewData = () => { throw new Error('expected multi overview failure'); };
        } else if (failingStep === 'session-cleanup') {
            app.multiSuiteSessionsMap = new class extends Map {
                delete() { throw new Error('expected multi session cleanup failure'); }
            }();
        }
        const originalShowMessage = windowStub.showMessage;
        const originalCollector = windowStub.spellingErrorCollector;
        windowStub.spellingErrorCollector = {
            async saveErrors() {
                if (failingStep === 'spelling') throw new Error('expected spelling sync failure');
            }
        };
        if (failingStep === 'message') {
            windowStub.showMessage = () => { throw new Error('expected multi completion message failure'); };
        }
        const payload = {
            examId,
            sessionId,
            submissionId,
            suiteSessionId,
            suiteId: 'set-1',
            totalSuites: 1,
            answers: { q1: 'A' },
            answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 },
            spellingErrors: [{ word: 'practice', answer: 'practise' }]
        };

        try {
            assert.strictEqual(await app.handlePracticeComplete(examId, payload, sourceWindow), true, `${failingStep}: committed multi-suite must return success`);
            assert.strictEqual(await app.handlePracticeComplete(examId, payload, sourceWindow), true, `${failingStep}: multi-suite receipt replay must return success`);
        } finally {
            windowStub.showMessage = originalShowMessage;
            windowStub.spellingErrorCollector = originalCollector;
        }
        const outcomes = sourceWindow._messages.filter(message => message && /^PRACTICE_SUBMIT_/.test(message.type));
        assert(outcomes.length >= 2 && outcomes.every(message => message.type === 'PRACTICE_SUBMIT_ACK'), `${failingStep}: multi-suite commit and replay must only ACK`);
        assert.strictEqual(aggregateRecords.length, 1, `${failingStep}: multi-suite aggregate must be written exactly once`);
        assert.strictEqual(standaloneFallbacks, 0, `${failingStep}: multi-suite must not enter standalone fallback after commit`);
    }

    // Case 3.1: 如果最后一篇已有导航快照，最终提交仍应覆盖并 finalize
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_finalize_upsert');
        session.results = [
            { examId: 'reading-p1', title: 'Passage 1', answers: { q1: 'A' }, answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } }, scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }, rawData: {} },
            { examId: 'reading-p2', title: 'Passage 2', answers: { q1: 'B' }, answerComparison: { q1: { userAnswer: 'B', correctAnswer: 'B', isCorrect: true } }, scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }, rawData: {} },
            { examId: 'reading-p3', title: 'Passage 3', answers: { q1: 'OLD' }, answerComparison: { q1: { userAnswer: 'OLD', correctAnswer: 'C', isCorrect: false } }, scoreInfo: { correct: 0, total: 1, accuracy: 0, percentage: 0 }, rawData: {} }
        ];
        session.currentIndex = 2;
        session.activeExamId = 'reading-p3';
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));

        let finalizeCount = 0;
        app.finalizeSuiteRecord = async () => {
            finalizeCount += 1;
        };

        const handled = await app.handleSuitePracticeComplete('reading-p3', {
            suiteSessionId: session.id,
            answers: { q1: 'C' },
            answerComparison: { q1: { userAnswer: 'C', correctAnswer: 'C', isCorrect: true } },
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
        }, session.windowRef);

        assert.strictEqual(handled, true, '最后一篇覆盖提交应成功');
        assert.strictEqual(finalizeCount, 1, '最后一篇覆盖提交后仍应 finalize');
        const p3 = session.results.find(item => item.examId === 'reading-p3');
        assert.deepStrictEqual(p3.answers, { q1: 'C' }, '最终提交应覆盖旧快照答案');
    }

    // Case 4: 显式中断只清理 v2 套题会话，不拆分写入 v1 单篇记录
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_abort');
        session.results = [
            {
                examId: 'reading-p1',
                rawData: {
                    answers: { q1: 'A' },
                    scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
                }
            },
            {
                examId: 'reading-p2',
                rawData: {
                    answers: { q1: 'B' },
                    scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
                }
            }
        ];
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));

        const savedExamIds = [];
        app.saveRealPracticeData = async (examId) => {
            savedExamIds.push(examId);
        };
        app._teardownSuiteSession = async () => {
            app.currentSuiteSession = null;
        };

        await app._abortSuiteSession(session, {});
        assert.deepStrictEqual(savedExamIds, [], '中断后不得通过 v1 单篇路径写入记录');
    }

    // Case 5: AppData window-session mirror must be cleared after teardown
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_storage_cleanup');
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));
        app._mirrorSessionToStorage(session);
        assert(windowSessionStore.has('simulation'), '镜像应存在');
        app._clearSessionStorage();
        assert(!windowSessionStore.has('simulation'), '清理后镜像应删除');
    }

    // Case 6: _sendSimulationContext 应发送正确的上下文
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_context');
        const p1Highlights = [{ scope: 'left', text: 'P1 context highlight', color: 'yellow' }];
        session.draftsByExam['reading-p1'] = { answers: { q1: 'A' }, highlights: p1Highlights, scrollY: 0 };
        session.elapsedByExam['reading-p1'] = 45;
        app.currentSuiteSession = session;
        const targetWindow = createStubWindow('ctx-window');
        const sent = app._sendSimulationContext(session, 'reading-p1', targetWindow);
        assert.strictEqual(sent, true, '应成功发送上下文');
        const ctxMsg = targetWindow._messages.find(m => m && m.type === 'SIMULATION_CONTEXT');
        assert(ctxMsg, '应收到 SIMULATION_CONTEXT');
        assert.strictEqual(ctxMsg.data.currentIndex, 0, 'currentIndex 应为 0');
        assert.strictEqual(ctxMsg.data.total, 3, 'total 应为 3');
        assert.strictEqual(Array.isArray(ctxMsg.data.suiteSequence), true, 'SIMULATION_CONTEXT 应包含 suiteSequence');
        assert.deepStrictEqual(ctxMsg.data.suiteSequence.map(item => item.examId), ['reading-p1', 'reading-p2', 'reading-p3'], 'suiteSequence 应包含三篇 examId');
        assert.strictEqual(ctxMsg.data.isLast, false, 'P1 不是最后一篇');
        assert.strictEqual(ctxMsg.data.canPrev, false, 'P1 不能向前');
        assert.strictEqual(ctxMsg.data.canNext, true, 'P1 可以向后');
        assert.deepStrictEqual(ctxMsg.data.draft.answers, { q1: 'A' }, 'draft 应回传');
        assert.deepStrictEqual(ctxMsg.data.draft.highlights, p1Highlights, 'draft highlights 应随上下文回传，避免切题后丢失高亮');
        assert.strictEqual(ctxMsg.data.elapsed, 45, 'elapsed 应回传');

        const sentP3 = app._sendSimulationContext(session, 'reading-p3', targetWindow);
        assert.strictEqual(sentP3, true, 'P3 上下文应成功');
        const ctxP3 = targetWindow._messages.filter(m => m && m.type === 'SIMULATION_CONTEXT')[1];
        assert.strictEqual(ctxP3.data.isLast, true, 'P3 应标记为最后一篇');
        assert.strictEqual(ctxP3.data.canNext, false, 'P3 不能向后导航');
    }

    // Case 6.1: INIT_SESSION payload 应携带三篇 suiteSequence
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_init_sequence');
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));
        const initWindow = createStubWindow('init-window');
        const windowInfo = app.ensureExamWindowSession('reading-p1', initWindow);
        windowInfo.suiteSessionId = session.id;
        windowInfo.suiteFlowMode = 'simulation';
        const payload = app._buildExamInitPayload('reading-p1', windowInfo);
        assert.strictEqual(Array.isArray(payload.suiteSequence), true, 'INIT_SESSION 应包含 suiteSequence');
        assert.deepStrictEqual(payload.suiteSequence.map(item => item.examId), ['reading-p1', 'reading-p2', 'reading-p3'], 'INIT suiteSequence 应覆盖三篇');
        assert.deepStrictEqual(payload.suiteSequence.map(item => item.category), ['P1', 'P2', 'P3'], 'INIT suiteSequence 应带 category');
    }

    // Case 6.2: 占位页 URL 必须显式传播窄范围 suite 测试标志
    {
        const app = createApp(windowStub);
        const placeholderUrl = app._buildExamPlaceholderUrl(
            {
                id: 'reading-p1',
                title: 'Passage 1 & 特殊字符',
                category: 'P1'
            },
            {
                suiteSessionId: 'suite placeholder session',
                sequenceIndex: 0
            }
        );
        const parsed = new URL(placeholderUrl);
        assert.strictEqual(parsed.pathname.endsWith('/templates/exam-placeholder.html'), true, '应使用套题占位页');
        assert.strictEqual(parsed.searchParams.get('suite_test'), '1', '占位页必须收到 suite_test=1');
        assert.strictEqual(parsed.searchParams.get('suiteSessionId'), 'suite placeholder session', '套题会话 ID 应 round-trip');
        assert.strictEqual(parsed.searchParams.get('title'), 'Passage 1 & 特殊字符', '标题特殊字符应由 URLSearchParams 安全编码');
        assert.strictEqual(parsed.searchParams.get('index'), '0', '首篇 index=0 不应被省略');
    }

    // Case 8: handleSessionReady 应触发首篇模拟上下文下发
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_session_ready');
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));
        app.examWindows = new Map();
        const readyWindow = createStubWindow('ready-window');
        app.examWindows.set('reading-p1', {
            examId: 'reading-p1',
            window: readyWindow,
            expectedSessionId: 'session-reading-p1',
            suiteSessionId: session.id
        });

        app.handleSessionReady('reading-p1', { sessionId: 'session-reading-p1', pageType: 'unified-reading' });
        const msg = readyWindow._messages.find(item => item && item.type === 'SIMULATION_CONTEXT');
        assert(msg, 'SESSION_READY 后应下发 SIMULATION_CONTEXT');
        assert.strictEqual(msg.data.examId, 'reading-p1', 'SESSION_READY 下发应匹配 examId');
    }

    // Case 8.1: 迟到 SESSION_READY 若窗口 URL 已切到其他篇，必须忽略
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_stale_ready');
        session.currentIndex = 0;
        session.activeExamId = 'reading-p1';
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));
        app.examWindows = new Map();

        const staleWindow = createStubWindow('ready-window');
        staleWindow.location.href = 'http://localhost/assets/generated/reading-exams/reading-practice-unified.html?examId=reading-p1';
        app.examWindows.set('reading-p2', {
            examId: 'reading-p2',
            window: staleWindow,
            expectedSessionId: 'session-reading-p2',
            suiteSessionId: session.id,
            pageType: 'unified-reading'
        });

        app.handleSessionReady('reading-p2', {
            sessionId: 'session-reading-p2',
            pageType: 'unified-reading'
        });

        assert.strictEqual(session.activeExamId, 'reading-p1', '迟到 SESSION_READY 不得覆写 activeExamId');
        assert.strictEqual(session.currentIndex, 0, '迟到 SESSION_READY 不得覆写 currentIndex');
        const staleCtx = staleWindow._messages.find(item => item && item.type === 'SIMULATION_CONTEXT');
        assert.strictEqual(staleCtx, undefined, '迟到 SESSION_READY 不应下发模拟上下文');
    }

    // Case 8.2: waitForSuiteWindowExamReady 不得把调用前的旧 ready 当成当前切题成功
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_ready_timestamp_guard');
        const targetWindow = createStubWindow('ready-window');
        targetWindow.location.href = 'http://localhost/assets/generated/reading-exams/reading-practice-unified.html?examId=reading-p2';
        app.examWindows = new Map([
            ['reading-p2', {
                examId: 'reading-p2',
                window: targetWindow,
                suiteSessionId: session.id,
                pageType: 'unified-reading',
                lastMessageType: 'SESSION_READY',
                lastMessageAt: Date.now() - 5000
            }]
        ]);

        const ready = await app._waitForSuiteWindowExamReady(session, 'reading-p2', targetWindow, 120);
        assert.strictEqual(ready, false, '调用前的旧 SESSION_READY 不能被误判为当前窗口已就绪');
    }

    // Case 8.3: 复用窗口切题若未等到 fresh ready，不得提前把目标篇高亮推送到旧页
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_reuse_window_highlight_guard');
        session.currentIndex = 0;
        session.activeExamId = 'reading-p1';
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));

        const reusedWindow = createStubWindow('suite-window');
        reusedWindow.location.href = 'http://localhost/assets/generated/reading-exams/reading-practice-unified.html?examId=reading-p1';
        session.windowRef = reusedWindow;
        app.openExam = async (_examId, options = {}) => options.reuseWindow || reusedWindow;
        app._waitForSuiteWindowExamReady = async () => false;

        const ok = await app._handleSimulationNavigate('reading-p1', {
            direction: 'next',
            draft: {
                answers: { q1: 'A' },
                highlights: [{ scope: 'left', text: 'P1 highlight before switch' }],
                scrollY: 123,
                updatedAt: Date.now()
            },
            resultSnapshot: {
                answers: { q1: 'A' },
                answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
                scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
            }
        }, reusedWindow);

        assert.strictEqual(ok, true, 'ready 超时时切题流程仍应继续，由后续 SESSION_READY 兜底');
        assert.strictEqual(session.activeExamId, 'reading-p2', 'activeExamId 应先对齐到目标篇');
        assert.strictEqual(
            reusedWindow._messages.some(message => message && message.type === 'SIMULATION_CONTEXT'),
            false,
            '未拿到 fresh ready 前不得向复用窗口提前发送 SIMULATION_CONTEXT，避免旧页误吃目标篇高亮'
        );
        assert.deepStrictEqual(
            session.draftsByExam['reading-p1'].highlights,
            [{ scope: 'left', text: 'P1 highlight before switch' }],
            '切题前当前篇高亮仍应保存在 draft 中'
        );
    }

    // Case 8.4: 复用窗口若已落到目标篇 URL，即使 fresh ready 缺失也应兜底下发上下文
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_reuse_window_target_url_fallback');
        session.currentIndex = 0;
        session.activeExamId = 'reading-p1';
        const p2Highlights = [{ scope: 'left', text: 'P2 highlight after switch', color: 'green' }];
        session.draftsByExam['reading-p2'] = { answers: { q5: 'B' }, highlights: p2Highlights, scrollY: 66 };
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));

        const reusedWindow = createStubWindow('suite-window');
        reusedWindow.location.href = 'http://localhost/assets/generated/reading-exams/reading-practice-unified.html?examId=reading-p2';
        session.windowRef = reusedWindow;
        app.examWindows = new Map([
            ['reading-p2', { window: reusedWindow }]
        ]);
        app.openExam = async (_examId, options = {}) => options.reuseWindow || reusedWindow;
        app._waitForSuiteWindowExamReady = async () => false;

        const ok = await app._handleSimulationNavigate('reading-p1', {
            direction: 'next',
            draft: {
                answers: { q1: 'A' },
                highlights: [{ scope: 'left', text: 'P1 highlight before switch' }],
                scrollY: 123,
                updatedAt: Date.now()
            }
        }, reusedWindow);

        assert.strictEqual(ok, true, '目标窗口 URL 已切到新篇时，切题流程应允许兜底恢复');
        const ctxMsg = reusedWindow._messages.find(message => message && message.type === 'SIMULATION_CONTEXT');
        assert(ctxMsg, '目标窗口 URL 已切到新篇时，应继续下发 SIMULATION_CONTEXT');
        assert.strictEqual(ctxMsg.data.examId, 'reading-p2', '兜底上下文必须指向目标篇');
        assert.deepStrictEqual(ctxMsg.data.draft.highlights, p2Highlights, '目标篇高亮应随兜底上下文一起恢复');
    }

    // Case 7: 错篇 PRACTICE_COMPLETE 必须被忽略，不能污染结果
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_wrong_exam_complete');
        session.activeExamId = 'reading-p2';
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));

        const handled = await app.handleSuitePracticeComplete('reading-p1', {
            suiteSessionId: session.id,
            answers: { q1: 'A' },
            answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
        }, session.windowRef);

        assert.strictEqual(handled, true, '错篇提交应被处理为忽略');
        assert.strictEqual(session.results.length, 0, '错篇提交不得写入 session.results');
    }

    // Case 9: 听力桥的临时 examId/sessionId 不得阻断父应用当前题源落库
    {
        const app = createApp(windowStub);
        const examWindow = createStubWindow('custom-listening-window');
        const examId = 'custom-listening-teacher-pack';
        const expectedSessionId = 'custom-listening-teacher-pack_expected';
        let captured = null;

        app.handlePracticeComplete = async (handledExamId, data) => {
            captured = { examId: handledExamId, data };
        };

        app.setupExamWindowCommunication(examWindow, examId, {
            id: examId,
            title: 'Teacher Pack Listening',
            type: 'listening'
        });

        const info = app.ensureExamWindowSession(examId, examWindow);
        info.expectedSessionId = expectedSessionId;
        app._refreshExamWindowToken(examId, info);
        app.examWindows.set(examId, info);

        const handler = app.messageHandlers.get(examId);
        assert.strictEqual(typeof handler, 'function', '听力题源应注册 message handler');

        await handler({
            source: examWindow,
            origin: 'http://localhost',
            data: {
                type: 'PRACTICE_COMPLETE',
                source: 'listening_record_bridge',
                data: {
                    source: 'listening_record_bridge',
                    examId: 'listening-unknown',
                    sessionId: 'listening-unknown_123',
                    submissionId: 'listening-submit-teacher-pack',
                    windowSessionToken: info.windowSessionToken,
                    practiceType: 'listening',
                    pageType: 'listening',
                    answers: { q1: 'acommodation' },
                    correctAnswers: { q1: 'accommodation' },
                    answerComparison: {
                        q1: { userAnswer: 'acommodation', correctAnswer: 'accommodation', isCorrect: false }
                    },
                    scoreInfo: { correct: 0, total: 1, accuracy: 0, percentage: 0, source: 'listening_record_bridge' }
                }
            }
        });

        assert(captured, '听力桥 PRACTICE_COMPLETE 不应被临时 examId/sessionId 静默丢弃');
        assert.strictEqual(captured.examId, examId, '父应用应使用当前打开的题源 examId');
        assert.strictEqual(captured.data.examId, examId, 'payload examId 应被纠正为父应用题源');
        assert.strictEqual(captured.data.sessionId, expectedSessionId, 'payload sessionId 应被纠正为父应用会话');
    }

    // Case 10: 任意目录听力完成后必须进入 PracticeRecorder，并保存错词
    {
        const app = createApp(windowStub);
        const examId = 'custom-listening-arbitrary-folder';
        const savedCompletions = [];
        const savedErrors = [];
        let status = null;

        app.components.practiceRecorder = {
            handleSessionCompleted: async (payload) => {
                savedCompletions.push(payload);
                const record = {
                    id: 'record-custom-listening',
                    examId,
                    sessionId: `${examId}_session`,
                    endTime: '2026-07-26T00:00:00.000Z'
                };
                return (await windowStub.AppData.practice.completeAttempt({ record })).record;
            }
        };
        app.updateExamStatus = (handledExamId, nextStatus) => {
            status = { examId: handledExamId, status: nextStatus };
        };
        app.showRealCompletionNotification = () => {};
        app.cleanupExamSession = async () => {};
        app.setState = () => {};

        const previousCollector = windowStub.spellingErrorCollector;
        windowStub.spellingErrorCollector = {
            detectSource: () => 'other',
            detectErrors: () => [{
                word: 'accommodation',
                userInput: 'acommodation',
                questionId: 'q1',
                suiteId: null,
                examId,
                timestamp: 1710000000000,
                errorCount: 1,
                source: 'other'
            }],
            saveErrors: async (errors) => {
                savedErrors.push(...errors);
                return true;
            }
        };

        await app.handlePracticeComplete(examId, {
            examId,
            sessionId: `${examId}_session`,
            practiceType: 'listening',
            pageType: 'listening',
            answers: { q1: 'acommodation' },
            correctAnswers: { q1: 'accommodation' },
            answerComparison: {
                q1: { userAnswer: 'acommodation', correctAnswer: 'accommodation', isCorrect: false }
            },
            scoreInfo: { correct: 0, total: 1, accuracy: 0, percentage: 0, source: 'listening_record_bridge' }
        });

        windowStub.spellingErrorCollector = previousCollector;

        assert.strictEqual(savedCompletions.length, 1, '听力完成应调用 PracticeRecorder 落库');
        assert.strictEqual(savedCompletions[0].examId, examId, '落库 payload 应保留当前听力 examId');
        assert.strictEqual(savedErrors.length, 1, '任意目录听力错词应保存到词表链路');
        assert.strictEqual(savedErrors[0].word, 'accommodation', '错词应来自 answerComparison');
        assert.deepStrictEqual(status, { examId, status: 'completed' }, '完成后应更新题源状态');
    }

    // Case 10b: 听力桥自带错词也必须归一到父页面当前题源，不能写入临时 listening-unknown
    {
        const app = createApp(windowStub);
        const examId = 'listening-p1-normalized-errors';
        const savedErrors = [];

        app.components.practiceRecorder = {
            handleSessionCompleted: async () => {
                const record = {
                    id: 'record-normalized-errors',
                    examId,
                    sessionId: `${examId}_session`,
                    endTime: '2026-07-26T00:00:00.000Z'
                };
                return (await windowStub.AppData.practice.completeAttempt({ record })).record;
            }
        };
        app.updateExamStatus = () => {};
        app.showRealCompletionNotification = () => {};
        app.cleanupExamSession = async () => {};
        app.setState = () => {};

        const previousCollector = windowStub.spellingErrorCollector;
        windowStub.spellingErrorCollector = {
            detectSource: () => 'p1',
            detectErrors: () => [],
            saveErrors: async (errors) => {
                savedErrors.push(...errors);
                return true;
            }
        };

        await app.handlePracticeComplete(examId, {
            examId,
            sessionId: `${examId}_session`,
            practiceType: 'listening',
            pageType: 'listening',
            answers: { q1: 'acommodation' },
            correctAnswers: { q1: 'accommodation' },
            answerComparison: {
                q1: { userAnswer: 'acommodation', correctAnswer: 'accommodation', isCorrect: false }
            },
            scoreInfo: { correct: 0, total: 1, accuracy: 0, percentage: 0, source: 'listening_record_bridge' },
            spellingErrors: [{
                word: 'accommodation',
                userInput: 'acommodation',
                questionId: 'q1',
                suiteId: null,
                examId: 'listening-unknown',
                timestamp: 1710000000000,
                errorCount: 1,
                source: 'other'
            }]
        });

        windowStub.spellingErrorCollector = previousCollector;

        assert.strictEqual(savedErrors.length, 1, '听力桥自带错词应继续保存');
        assert.strictEqual(savedErrors[0].examId, examId, '错词 examId 必须归一到父页面题源');
        assert.strictEqual(savedErrors[0].source, 'p1', 'P1 听力错词 source 必须归一，避免写到 other 词表');
    }

    // Case 11: 听力桥 bootstrap ready 不得提前结束父子握手
    {
        const app = createApp(windowStub);
        const examWindow = createStubWindow('custom-listening-handshake-window');
        const examId = 'custom-listening-handshake';
        const expectedSessionId = 'custom-listening-handshake_expected';

        app.setupExamWindowCommunication(examWindow, examId, {
            id: examId,
            title: 'Handshake Listening',
            type: 'listening'
        });

        const info = app.ensureExamWindowSession(examId, examWindow);
        info.expectedSessionId = expectedSessionId;
        app._refreshExamWindowToken(examId, info);
        app.examWindows.set(examId, info);
        examWindow._messages.length = 0;

        const timer = setInterval(() => {}, 10000);
        app._handshakeTimers = new Map([[examId, timer]]);

        const handler = app.messageHandlers.get(examId);
        assert.strictEqual(typeof handler, 'function', '听力题源应注册 message handler');

        try {
            await handler({
                source: examWindow,
                origin: 'http://localhost',
                data: {
                    type: 'SESSION_READY',
                    source: 'listening_record_bridge',
                    data: {
                        source: 'listening_record_bridge',
                        examId: 'listening-unknown',
                        sessionId: 'listening-unknown_123',
                        pageType: 'listening',
                        type: 'listening',
                        initialized: false
                    }
                }
            });

            const preInitInfo = app.examWindows.get(examId);
            assert.strictEqual(app._handshakeTimers.has(examId), true, 'pre-init ready 不得停止 INIT 重试');
            assert.strictEqual(preInitInfo.dataCollectorReady, undefined, 'pre-init ready 不得标记 collector ready');
            assert(examWindow._messages.some(message => message && message.type === 'INIT_SESSION'), 'pre-init ready 后应补发 INIT_SESSION');

            await handler({
                source: examWindow,
                origin: 'http://localhost',
                data: {
                    type: 'SESSION_READY',
                    source: 'listening_record_bridge',
                    data: {
                        source: 'listening_record_bridge',
                        examId,
                        sessionId: expectedSessionId,
                        windowSessionToken: info.windowSessionToken,
                        pageType: 'listening',
                        type: 'listening',
                        initialized: true
                    }
                }
            });

            assert.strictEqual(app._handshakeTimers.has(examId), false, 'initialized ready 才能停止 INIT 重试');
            assert.strictEqual(app.examWindows.get(examId).dataCollectorReady, true, 'initialized ready 应标记 collector ready');
        } finally {
            clearInterval(timer);
        }
    }

    // Case 11.1: 占位页无 token 的 bootstrap ready 也只能触发 INIT，不能结束握手
    {
        const app = createApp(windowStub);
        const examWindow = createStubWindow('suite-placeholder-handshake-window');
        const examId = 'suite-placeholder-handshake';
        app.setupExamWindowCommunication(examWindow, examId, { id: examId, type: 'reading' });
        const info = app.ensureExamWindowSession(examId, examWindow);
        info.expectedOrigin = 'null';
        info.allowOpaqueOrigin = true;
        examWindow._messages.length = 0;

        const timer = setInterval(() => {}, 10000);
        app._handshakeTimers = new Map([[examId, timer]]);
        try {
            await app.messageHandlers.get(examId)({
                source: examWindow,
                origin: 'file://',
                data: {
                    type: 'SESSION_READY',
                    source: 'suite_placeholder',
                    data: {
                        source: 'suite_placeholder',
                        examId,
                        sessionId: null,
                        windowSessionToken: null,
                        pageType: 'suite-placeholder'
                    }
                }
            });

            assert.strictEqual(app._handshakeTimers.has(examId), true, '占位页 bootstrap ready 不得停止 INIT 重试');
            assert.strictEqual(app.examWindows.get(examId).dataCollectorReady, undefined, '无 token ready 不得标记 collector ready');
            assert(examWindow._messages.some(message => message && message.type === 'INIT_SESSION'), '无 token ready 后应立即补发 INIT_SESSION');
        } finally {
            clearInterval(timer);
        }
    }

    // Case 12: 听力完成早于 initialized ready 时，也必须先补建 recorder session 再落库
    {
        const app = createApp(windowStub);
        const examWindow = createStubWindow('custom-listening-complete-first-window');
        const examId = 'custom-listening-complete-first';
        const expectedSessionId = 'custom-listening-complete-first_expected';
        const calls = [];
        let status = null;

        app.components.practiceRecorder = {
            activeSessions: new Map(),
            startPracticeSession(handledExamId, examData) {
                calls.push({ type: 'startPracticeSession', examId: handledExamId, examData });
                this.activeSessions.set(handledExamId, {
                    examId: handledExamId,
                    sessionId: `${handledExamId}_generated`,
                    metadata: {},
                    progress: { totalQuestions: examData.totalQuestions || 0 },
                    answers: {}
                });
                return this.activeSessions.get(handledExamId);
            },
            handleSessionStarted(payload) {
                calls.push({ type: 'handleSessionStarted', payload });
                assert(this.activeSessions.has(payload.examId), '补建 session 必须先于 handleSessionStarted');
                const session = this.activeSessions.get(payload.examId);
                session.sessionId = payload.sessionId;
                session.metadata = { ...session.metadata, ...payload.metadata };
                this.activeSessions.set(payload.examId, session);
            },
            async handleSessionCompleted(payload) {
                calls.push({ type: 'handleSessionCompleted', payload });
                assert(this.activeSessions.has(payload.examId), '真实 recorder 没有 active session 会拒绝落库');
                const session = this.activeSessions.get(payload.examId);
                assert.strictEqual(session.sessionId, payload.sessionId, '完成 payload 必须使用父页面 expectedSessionId');
                const record = {
                    id: `record_${payload.sessionId}`,
                    examId: payload.examId,
                    sessionId: payload.sessionId,
                    endTime: payload.endTime || '2026-07-26T00:00:00.000Z'
                };
                return (await windowStub.AppData.practice.completeAttempt({ record })).record;
            }
        };
        app.updateExamStatus = (handledExamId, nextStatus) => {
            status = { examId: handledExamId, status: nextStatus };
        };
        app.showRealCompletionNotification = () => {};
        app.cleanupExamSession = async () => {};
        app.setState = () => {};

        app.setupExamWindowCommunication(examWindow, examId, {
            id: examId,
            title: 'Complete First Listening',
            type: 'listening'
        });

        const info = app.ensureExamWindowSession(examId, examWindow);
        info.expectedSessionId = expectedSessionId;
        app._refreshExamWindowToken(examId, info);
        app.examWindows.set(examId, info);

        const handler = app.messageHandlers.get(examId);
        assert.strictEqual(typeof handler, 'function', '听力题源应注册 message handler');

        await handler({
            source: examWindow,
            origin: 'http://localhost',
            data: {
                type: 'PRACTICE_COMPLETE',
                source: 'listening_record_bridge',
                data: {
                    source: 'listening_record_bridge',
                    examId: 'listening-unknown',
                    sessionId: 'listening-unknown_early',
                    submissionId: 'listening-submit-complete-first',
                    windowSessionToken: info.windowSessionToken,
                    practiceType: 'listening',
                    pageType: 'listening',
                    title: 'Complete First Listening',
                    answers: { q1: 'acommodation' },
                    correctAnswers: { q1: 'accommodation' },
                    answerComparison: {
                        q1: { userAnswer: 'acommodation', correctAnswer: 'accommodation', isCorrect: false }
                    },
                    scoreInfo: { correct: 0, total: 1, accuracy: 0, percentage: 0, source: 'listening_record_bridge' }
                }
            }
        });

        assert.deepStrictEqual(
            calls.map(call => call.type),
            ['startPracticeSession', 'handleSessionStarted', 'handleSessionCompleted'],
            'complete-before-ready 必须先建会话、再同步 sessionId、最后落库'
        );
        assert.strictEqual(calls[2].payload.examId, examId, '完成 payload examId 应被纠正为父页面当前题源');
        assert.strictEqual(calls[2].payload.sessionId, expectedSessionId, '完成 payload sessionId 应被纠正为父页面会话');
        assert.deepStrictEqual(status, { examId, status: 'completed' }, '完成后应更新题源状态');
    }

    // Case 12.1: delayed injector callbacks cannot mutate a replaced registration.
    {
        const app = createApp(windowStub);
        const examId = 'stale-injection-registration';
        const appendedScripts = [];
        let initialized = 0;
        const injectionDocument = {
            readyState: 'complete',
            documentElement: { dataset: {} },
            head: {
                appendChild(script) {
                    appendedScripts.push(script);
                }
            },
            body: null,
            getElementById() { return null; },
            querySelector() { return null; },
            createElement() {
                return {
                    dataset: {},
                    remove() {}
                };
            }
        };
        const examWindow = {
            ...createStubWindow('stale-injection-window'),
            document: injectionDocument
        };
        const info = app.ensureExamWindowSession(examId, examWindow);
        const firstRegistration = app._captureExamSessionRegistration(examId, info);
        const scheduled = [];
        const originalSetTimeout = sandbox.setTimeout;
        sandbox.setTimeout = (callback) => {
            scheduled.push(callback);
            return scheduled.length;
        };
        app.initializePracticeSession = () => { initialized += 1; };
        try {
            app.injectDataCollectionScript(examWindow, examId, null, {
                expectedRegistration: firstRegistration
            });
            assert.strictEqual(scheduled.length, 1, 'injector must queue its document-ready check');
            info.sessionGeneration += 1;
            scheduled.shift()();
            assert.strictEqual(appendedScripts.length, 0, 'a stale document-ready callback must not append a script');

            const secondRegistration = app._captureExamSessionRegistration(examId, info);
            app.injectDataCollectionScript(examWindow, examId, null, {
                expectedRegistration: secondRegistration
            });
            scheduled.shift()();
            assert.strictEqual(appendedScripts.length, 1, 'the current registration may append its enhancer script');
            info.sessionGeneration += 1;
            appendedScripts[0].onload();
            assert.strictEqual(scheduled.length, 0, 'a stale script onload must not queue session initialization');
            assert.strictEqual(initialized, 0, 'a stale injector callback must not initialize the replacement session');
        } finally {
            sandbox.setTimeout = originalSetTimeout;
        }
    }

    // Case 13: 统一阅读提交后 reset 必须复用父页通信链路并重建 recorder session
    {
        const app = createApp(windowStub);
        const examWindow = createStubWindow('unified-reading-retake-window');
        const examId = 'reading-retake-unified';
        const firstSessionId = 'reading-retake-first-session';
        const resetSessionId = 'reading-retake-reset-session';
        const completions = [];
        const recorderStarts = [];
        const resetStarts = [];
        const statuses = [];
        let cleanupCount = 0;
        let restartCount = 0;
        let restartRegistration = null;

        app.generateSessionId = () => resetSessionId;
        app.components.practiceRecorder = {
            activeSessions: new Map(),
            async handleSessionCompleted(payload) {
                completions.push(payload);
                this.activeSessions.delete(payload.examId);
                const record = {
                    id: `record_${payload.sessionId}`,
                    examId: payload.examId,
                    sessionId: payload.sessionId,
                    endTime: payload.endTime || '2026-07-26T00:00:00.000Z'
                };
                return (await windowStub.AppData.practice.completeAttempt({ record })).record;
            },
            handleSessionStarted(payload) {
                recorderStarts.push(payload);
                const session = this.activeSessions.get(payload.examId) || {
                    examId: payload.examId,
                    metadata: {},
                    progress: {},
                    answers: {}
                };
                session.sessionId = payload.sessionId;
                session.metadata = { ...session.metadata, ...payload.metadata };
                this.activeSessions.set(payload.examId, session);
            }
        };
        app.startPracticeSession = async (handledExamId, options = {}) => {
            resetStarts.push(handledExamId);
            app.components.practiceRecorder.activeSessions.set(handledExamId, {
                examId: handledExamId,
                sessionId: 'temporary-reset-session',
                metadata: {},
                progress: {},
                answers: {}
            });
            return {
                owned: true,
                sessionId: resetSessionId,
                registration: options.expectedRegistration
            };
        };
        app.cleanupExamSession = async () => {
            cleanupCount += 1;
        };
        app.restartExamHandshake = (targetWindow, handledExamId, registration) => {
            restartCount += 1;
            restartRegistration = registration;
            assert.strictEqual(targetWindow, examWindow, 'reset 应复用当前统一阅读窗口');
            assert.strictEqual(handledExamId, examId, 'reset 握手应使用当前题源');
        };
        app.updateExamStatus = (handledExamId, status) => {
            statuses.push({ examId: handledExamId, status });
        };
        app.showRealCompletionNotification = () => {};
        app.setState = () => {};

        app.setupExamWindowCommunication(examWindow, examId, {
            id: examId,
            title: 'Unified Retake Reading',
            type: 'reading'
        });

        const info = app.ensureExamWindowSession(examId, examWindow);
        info.expectedSessionId = firstSessionId;
        app._refreshExamWindowToken(examId, info);
        app.examWindows.set(examId, info);
        const firstGeneration = info.sessionGeneration;
        const firstWindowSessionToken = info.windowSessionToken;

        const handler = app.messageHandlers.get(examId);
        assert.strictEqual(typeof handler, 'function', '统一阅读题源应注册 message handler');

        await handler({
            source: examWindow,
            origin: 'http://localhost',
            data: {
                type: 'PRACTICE_COMPLETE',
                source: 'practice_page',
                data: {
                    examId,
                    sessionId: firstSessionId,
                    submissionId: 'reading-submit-first-session',
                    windowSessionToken: info.windowSessionToken,
                    answers: { q1: 'A' },
                    answerComparison: {
                        q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true }
                    },
                    scoreInfo: { correct: 1, total: 1, totalQuestions: 1, accuracy: 1, percentage: 100 },
                    metadata: {
                        type: 'reading',
                        examType: 'reading',
                        practiceMode: 'single',
                        renderMode: 'unified-reading'
                    }
                }
            }
        });

        assert.strictEqual(cleanupCount, 0, '统一阅读提交后不得清掉父页消息 handler');
        assert.strictEqual(app.messageHandlers.has(examId), true, '统一阅读完成后应保留 message handler 等待 reset');
        assert.strictEqual(app.examWindows.get(examId).status, 'completed', '统一阅读完成后应标记窗口完成态');
        assert.strictEqual(completions.length, 1, '统一阅读完成应正常进入 recorder');

        examWindow._messages.length = 0;
        recorderStarts.length = 0;
        await handler({
            source: examWindow,
            origin: 'http://localhost',
            data: {
                type: 'PRACTICE_RESET_REQUEST',
                source: 'practice_page',
                data: {
                    examId,
                    sessionId: firstSessionId,
                    windowSessionToken: info.windowSessionToken,
                    reason: 'retake-after-submit',
                    fromPracticeMode: 'single',
                    targetPracticeMode: 'single',
                    normalUrl: 'file:///reading-practice-unified.html?examId=reading-retake-unified'
                }
            }
        });

        const resetInfo = app.examWindows.get(examId);
        assert.strictEqual(resetInfo.expectedSessionId, resetSessionId, 'reset 必须生成新的 expectedSessionId');
        assert.strictEqual(resetInfo.sessionGeneration, firstGeneration + 1, 'reset must advance the window session generation exactly once');
        assert.notStrictEqual(resetInfo.windowSessionToken, firstWindowSessionToken, 'reset must rotate the window session token');
        assert.strictEqual(resetInfo.status, 'active', 'reset 后窗口应回到 active');
        assert.deepStrictEqual(resetStarts, [examId], 'reset 后必须补建练习会话');
        assert.strictEqual(recorderStarts.length, 1, 'reset 后必须同步 recorder sessionId');
        assert.strictEqual(recorderStarts[0].sessionId, resetSessionId, 'recorder sessionId 必须使用 reset 后的新 session');
        assert.strictEqual(
            app.components.practiceRecorder.activeSessions.get(examId).sessionId,
            resetSessionId,
            'reset 后 active recorder session 必须可被下一次提交使用'
        );
        const resetInit = examWindow._messages.find(message => message && message.type === 'INIT_SESSION'
            && message.data && message.data.sessionId === resetSessionId);
        assert(resetInit, 'reset 后必须向子页发送新的 INIT_SESSION');
        assert.strictEqual(resetInit.data.windowSessionGeneration, firstGeneration + 1, 'reset INIT must carry the advanced generation');
        assert.strictEqual(resetInit.data.windowSessionToken, resetInfo.windowSessionToken, 'reset INIT must carry the rotated token');
        assert.strictEqual(restartCount, 1, 'reset 后必须重启握手');
        assert.strictEqual(app._isExamSessionRegistrationCurrent(examId, restartRegistration), true, 'reset handshake must use the new exact registration');
        assert(statuses.some(item => item.examId === examId && item.status === 'in-progress'), 'reset 后题源状态应回到 in-progress');

        const resetHandler = app.messageHandlers.get(examId);
        assert.notStrictEqual(resetHandler, handler, 'reset must bind a new exact-registration message handler');
        let acceptedReady = 0;
        app.handleSessionReady = () => { acceptedReady += 1; };
        const readyEvent = {
            source: examWindow,
            origin: 'http://localhost',
            data: {
                type: 'SESSION_READY',
                source: 'practice_page',
                data: {
                    examId,
                    sessionId: resetSessionId,
                    windowSessionToken: resetInfo.windowSessionToken,
                    pageType: 'reading',
                    source: 'practice_page'
                }
            }
        };
        await handler(readyEvent);
        assert.strictEqual(acceptedReady, 0, 'the stale registration handler must ignore reset-era messages');
        await resetHandler(readyEvent);
        assert.strictEqual(acceptedReady, 1, 'the new exact registration handler must accept reset READY');
    }

    process.stdout.write(JSON.stringify({ status: 'pass', detail: 'simulation mode regression cases passed' }));
}

run().catch((error) => {
    const detail = error && error.stack ? error.stack : String(error);
    process.stdout.write(JSON.stringify({ status: 'fail', detail }));
    process.exit(1);
});
