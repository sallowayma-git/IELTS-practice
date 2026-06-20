#!/usr/bin/env node
import path from 'path';
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

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
        location: { href: 'about:blank' },
        _messages: [],
        postMessage(payload, targetOrigin) {
            if (payload && typeof payload === 'object') {
                this._messages.push({ ...payload, targetOrigin });
            } else {
                this._messages.push({ payload, targetOrigin });
            }
        },
        focus() {}
    };
}

function createSandbox() {
    const storageStub = {
        _data: new Map(),
        async get(key, fallback = null) {
            return this._data.has(key) ? this._data.get(key) : fallback;
        },
        async set(key, value) {
            this._data.set(key, value);
            return true;
        }
    };

    const sessionStorageStub = new Map();
    const sessionStorageObj = {
        getItem(key) { return sessionStorageStub.get(key) || null; },
        setItem(key, value) { sessionStorageStub.set(key, String(value)); },
        removeItem(key) { sessionStorageStub.delete(key); },
        clear() { sessionStorageStub.clear(); }
    };

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
        CustomEvent: function CustomEvent(type, init = {}) {
            return { type, detail: init.detail || null };
        },
        location: { origin: 'http://localhost', href: 'http://localhost/' },
        localStorage: {
            _data: new Map(),
            getItem(key) { return this._data.has(key) ? this._data.get(key) : null; },
            setItem(key, value) { this._data.set(key, String(value)); },
            removeItem(key) { this._data.delete(key); }
        },
        sessionStorage: sessionStorageObj,
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
        storage: storageStub,
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Math,
        CustomEvent: windowStub.CustomEvent
    };
    windowStub.storage = storageStub;
    sandbox.globalThis = sandbox.window;
    sandbox.window.storage = storageStub;
    return { sandbox, windowStub, sessionStorageStub };
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
    const { sandbox, windowStub, sessionStorageStub } = createSandbox();
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
        windowStub.localStorage.setItem('suite_auto_advance_after_submit', 'false');
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
        windowStub.localStorage.removeItem('suite_auto_advance_after_submit');
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
        const mirroredSession = JSON.parse(sessionStorageStub.get('ielts_sim_session'));
        const mirroredP2Result = mirroredSession.results.find(entry => entry.examId === 'reading-p2');
        assert.strictEqual(Object.prototype.hasOwnProperty.call(mirroredP2Result, 'highlights'), false, 'sessionStorage results 不应重复写高亮');
        assert.deepStrictEqual(mirroredSession.draftsByExam['reading-p2'].highlights, p2Highlights, 'sessionStorage 应只在 draft 中保存 P2 高亮');

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
                examId: 'reading-p2',
                title: 'Passage 2',
                answers: { q1: 'B' },
                answerComparison: { q1: { userAnswer: 'B', correctAnswer: 'B', isCorrect: true } },
                scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 },
                highlights: [],
                scrollY: 0,
                rawData: {}
            }
        ];
        session.draftsByExam['reading-p2'] = {
            answers: { q1: 'B' },
            highlights: p2Highlights,
            scrollY: 288,
            updatedAt: Date.now()
        };

        const p2Replay = app._buildSuiteReplayEntry(session, 'reading-p2');
        assert.deepStrictEqual(p2Replay.highlights, p2Highlights, '回顾态 replay 必须从 P2 draft 回灌高亮');
        assert.strictEqual(p2Replay.scrollY, 288, '回顾态 replay 必须从 P2 draft 回灌滚动位置');

        let savedRecord = null;
        app._saveSuitePracticeRecord = async (record) => {
            savedRecord = record;
        };
        app._updatePracticeRecordsState = async () => {};
        app._teardownSuiteSession = async () => {};
        await app.finalizeSuiteRecord(session);
        const p2Entry = savedRecord.suiteEntries.find(entry => entry.examId === 'reading-p2');
        assert.deepStrictEqual(p2Entry.highlights, p2Highlights, '最终记录也必须保留 draft 中的 P2 高亮');
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
            { examId: 'reading-p1', title: 'Passage 1', answers: { q1: 'A' }, answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } }, scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }, rawData: {} },
            { examId: 'reading-p2', title: 'Passage 2', answers: { q1: 'B' }, answerComparison: { q1: { userAnswer: 'B', correctAnswer: 'B', isCorrect: true } }, scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }, highlights: p2Highlights, scrollY: 240, rawData: { highlights: p2Highlights, scrollY: 240 } },
            { examId: 'reading-p3', title: 'Passage 3', answers: { q1: 'C' }, answerComparison: { q1: { userAnswer: 'C', correctAnswer: 'C', isCorrect: true } }, scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }, rawData: {} }
        ];
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));

        let savedRecord = null;
        app._saveSuitePracticeRecord = async (record) => {
            savedRecord = record;
        };
        app._updatePracticeRecordsState = async () => {};
        app._teardownSuiteSession = async () => {};

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
        const secondNavigate = await app._handleSimulationNavigate('reading-p1', { direction: 'next' }, session.windowRef);
        assert.strictEqual(secondNavigate, false, '并发切题应被锁拒绝，避免重复导航');
        assert.strictEqual(openCallCount, 1, '并发切题期间只允许一次窗口切换');

        if (typeof resolveOpen === 'function') {
            resolveOpen();
        }
        const firstNavigateOk = await firstNavigate;
        assert.strictEqual(firstNavigateOk, true, '首个切题请求应成功');

        session.activeExamId = 'reading-p2';
        const staleNavigate = await app._handleSimulationNavigate('reading-p1', { direction: 'next' }, session.windowRef);
        assert.strictEqual(staleNavigate, false, '非活动篇章消息必须忽略');
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

    // Case 4: 套题意外关闭后，已作答篇应按单篇普通流程保存
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
        assert.deepStrictEqual(savedExamIds.sort(), ['reading-p1', 'reading-p2'], '中断后应保存所有已作答篇章');
    }

    // Case 5: sessionStorage 镜像在 teardown 后应被清理
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_storage_cleanup');
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));
        app._mirrorSessionToStorage(session);
        assert(sessionStorageStub.has('ielts_sim_session'), '镜像应存在');
        app._clearSessionStorage();
        assert(!sessionStorageStub.has('ielts_sim_session'), '清理后镜像应删除');
    }

    // Case 6: _sendSimulationContext 应发送正确的上下文
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_context');
        session.draftsByExam['reading-p1'] = { answers: { q1: 'A' }, highlights: [], scrollY: 0 };
        session.elapsedByExam['reading-p1'] = 45;
        app.currentSuiteSession = session;
        const targetWindow = createStubWindow('ctx-window');
        const sent = app._sendSimulationContext(session, 'reading-p1', targetWindow);
        assert.strictEqual(sent, true, '应成功发送上下文');
        const ctxMsg = targetWindow._messages.find(m => m && m.type === 'SIMULATION_CONTEXT');
        assert(ctxMsg, '应收到 SIMULATION_CONTEXT');
        assert.strictEqual(ctxMsg.data.currentIndex, 0, 'currentIndex 应为 0');
        assert.strictEqual(ctxMsg.data.total, 3, 'total 应为 3');
        assert.strictEqual(ctxMsg.data.isLast, false, 'P1 不是最后一篇');
        assert.strictEqual(ctxMsg.data.canPrev, false, 'P1 不能向前');
        assert.strictEqual(ctxMsg.data.canNext, true, 'P1 可以向后');
        assert.deepStrictEqual(ctxMsg.data.draft.answers, { q1: 'A' }, 'draft 应回传');
        assert.strictEqual(ctxMsg.data.elapsed, 45, 'elapsed 应回传');

        const sentP3 = app._sendSimulationContext(session, 'reading-p3', targetWindow);
        assert.strictEqual(sentP3, true, 'P3 上下文应成功');
        const ctxP3 = targetWindow._messages.filter(m => m && m.type === 'SIMULATION_CONTEXT')[1];
        assert.strictEqual(ctxP3.data.isLast, true, 'P3 应标记为最后一篇');
        assert.strictEqual(ctxP3.data.canNext, false, 'P3 不能向后导航');
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

    // Case 9b: CSP sandbox 下的 Listening bridge origin 为 null，只能由预期窗口走受限协议
    {
        const app = createApp(windowStub);
        const examWindow = createStubWindow('sandboxed-listening-window');
        const unknownWindow = createStubWindow('sandboxed-listening-attacker');
        const examId = 'sandboxed-listening-p1';
        const expectedSessionId = 'sandboxed-listening-p1_expected';
        let captured = null;

        app.handlePracticeComplete = async (handledExamId, data) => {
            captured = { examId: handledExamId, data };
        };

        app.setupExamWindowCommunication(examWindow, examId, {
            id: examId,
            title: 'Sandboxed Listening',
            type: 'listening'
        });

        const info = app.ensureExamWindowSession(examId, examWindow);
        info.expectedSessionId = expectedSessionId;
        app.examWindows.set(examId, info);

        const handler = app.messageHandlers.get(examId);
        assert.strictEqual(typeof handler, 'function', '沙盒听力题源应注册 message handler');

        const completionMessage = {
            type: 'PRACTICE_COMPLETE',
            source: 'listening_record_bridge',
            data: {
                source: 'listening_record_bridge',
                examId: 'listening-unknown',
                sessionId: 'listening-unknown_opaque',
                practiceType: 'listening',
                pageType: 'listening',
                answers: { q1: 'acommodation' },
                correctAnswers: { q1: 'accommodation' },
                answerComparison: {
                    q1: { userAnswer: 'acommodation', correctAnswer: 'accommodation', isCorrect: false }
                },
                scoreInfo: { correct: 0, total: 1, accuracy: 0, percentage: 0, source: 'listening_record_bridge' }
            }
        };

        await handler({
            source: unknownWindow,
            origin: 'null',
            data: completionMessage
        });

        assert.strictEqual(captured, null, '未知 null-origin 窗口不得冒充听力桥');

        await handler({
            source: examWindow,
            origin: 'null',
            data: completionMessage
        });

        assert(captured, '预期沙盒听力桥消息应被接受');
        assert.strictEqual(captured.examId, examId, '沙盒听力桥仍应使用父应用题源 examId');
        assert.strictEqual(captured.data.sessionId, expectedSessionId, '沙盒听力桥 sessionId 应被纠正为父页面会话');

        examWindow._messages.length = 0;
        await handler({
            source: examWindow,
            origin: 'null',
            data: {
                type: 'REQUEST_INIT',
                source: 'listening_record_bridge',
                data: {
                    source: 'listening_record_bridge',
                    examId,
                    sessionId: expectedSessionId,
                    pageType: 'listening'
                }
            }
        });

        assert(
            examWindow._messages.some(message => message && message.type === 'INIT_SESSION' && message.targetOrigin === '*'),
            '沙盒听力页初始化必须用通配 targetOrigin'
        );
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
                return { id: 'record-custom-listening', examId };
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
            handleSessionCompleted: async () => ({ id: 'record-normalized-errors', examId })
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
                return { id: `record_${payload.sessionId}`, examId: payload.examId, sessionId: payload.sessionId };
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

        app.generateSessionId = () => resetSessionId;
        app.components.practiceRecorder = {
            activeSessions: new Map(),
            async handleSessionCompleted(payload) {
                completions.push(payload);
                this.activeSessions.delete(payload.examId);
                return { id: `record_${payload.sessionId}`, examId: payload.examId, sessionId: payload.sessionId };
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
        app.startPracticeSession = async (handledExamId) => {
            resetStarts.push(handledExamId);
            app.components.practiceRecorder.activeSessions.set(handledExamId, {
                examId: handledExamId,
                sessionId: 'temporary-reset-session',
                metadata: {},
                progress: {},
                answers: {}
            });
        };
        app.cleanupExamSession = async () => {
            cleanupCount += 1;
        };
        app.restartExamHandshake = (targetWindow, handledExamId) => {
            restartCount += 1;
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
        app.examWindows.set(examId, info);

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
        await handler({
            source: examWindow,
            origin: 'http://localhost',
            data: {
                type: 'PRACTICE_RESET_REQUEST',
                source: 'practice_page',
                data: {
                    examId,
                    sessionId: firstSessionId,
                    reason: 'retake-after-submit',
                    fromPracticeMode: 'single',
                    targetPracticeMode: 'single',
                    normalUrl: 'file:///reading-practice-unified.html?examId=reading-retake-unified'
                }
            }
        });

        const resetInfo = app.examWindows.get(examId);
        assert.strictEqual(resetInfo.expectedSessionId, resetSessionId, 'reset 必须生成新的 expectedSessionId');
        assert.strictEqual(resetInfo.status, 'active', 'reset 后窗口应回到 active');
        assert.deepStrictEqual(resetStarts, [examId], 'reset 后必须补建练习会话');
        assert.strictEqual(recorderStarts.length, 1, 'reset 后必须同步 recorder sessionId');
        assert.strictEqual(recorderStarts[0].sessionId, resetSessionId, 'recorder sessionId 必须使用 reset 后的新 session');
        assert.strictEqual(
            app.components.practiceRecorder.activeSessions.get(examId).sessionId,
            resetSessionId,
            'reset 后 active recorder session 必须可被下一次提交使用'
        );
        assert(
            examWindow._messages.some(message => message && message.type === 'INIT_SESSION' && message.data && message.data.sessionId === resetSessionId),
            'reset 后必须向子页发送新的 INIT_SESSION'
        );
        assert.strictEqual(restartCount, 1, 'reset 后必须重启握手');
        assert(statuses.some(item => item.examId === examId && item.status === 'in-progress'), 'reset 后题源状态应回到 in-progress');
    }

    process.stdout.write(JSON.stringify({ status: 'pass', detail: 'simulation mode regression cases passed' }));
}

run().catch((error) => {
    const detail = error && error.stack ? error.stack : String(error);
    process.stdout.write(JSON.stringify({ status: 'fail', detail }));
    process.exit(1);
});
