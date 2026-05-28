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

function deepClone(value) {
    return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function createStubWindow(name) {
    const stub = {
        name,
        closed: false,
        location: { href: 'about:blank' },
        document: { title: '', addEventListener() {}, removeEventListener() {} },
        focus() { this._focused = true; },
        close() { this.closed = true; },
        postMessage(message) {
            if (!this._messages) {
                this._messages = [];
            }
            this._messages.push(message);
        },
        open(url = 'about:blank', target = '_blank', features = '') {
            const child = createStubWindow(target || '_blank');
            child.lastUrl = url;
            child.features = features;
            if (!this._openedChildren) {
                this._openedChildren = [];
            }
            this._openedChildren.push({ url, target, features, window: child });
            return child;
        }
    };

    stub.self = stub;
    stub.top = stub;
    return stub;
}

async function main() {
    const storageState = new Map();
    const storage = {
        async get(key, fallback = undefined) {
            if (storageState.has(key)) {
                return deepClone(storageState.get(key));
            }
            return deepClone(fallback);
        },
        async set(key, value) {
            storageState.set(key, deepClone(value));
        }
    };

    const documentStub = {
        title: '',
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        dispatchEvent() { return true; },
        createElement() { return { className: '', style: {} }; }
    };

    const windowStub = {
        _messages: [],
        showMessage(text, level) {
            this._messages.push({ text, level });
        },
        addEventListener() {},
        removeEventListener() {},
        location: { href: 'http://localhost/' },
        screen: { availWidth: 1920, availHeight: 1080 },
        document: documentStub,
        practicePageManager: {
            async startPracticeSession(examId) {
                return `session-${examId}`;
            }
        },
        open(url = 'about:blank', name = '_blank') {
            const stub = createStubWindow(name);
            stub.lastUrl = url;
            return stub;
        }
    };

    windowStub.storage = storage;
    windowStub.CustomEvent = function CustomEvent(type, init = {}) {
        return { type, detail: init.detail || null };
    };

    const sessionStorageStub = new Map();
    const sessionStorageObj = {
        getItem(key) { return sessionStorageStub.get(key) || null; },
        setItem(key, value) { sessionStorageStub.set(key, String(value)); },
        removeItem(key) { sessionStorageStub.delete(key); },
        clear() { sessionStorageStub.clear(); }
    };

    const sandbox = {
        window: windowStub,
        storage,
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Math,
        document: documentStub,
        CustomEvent: windowStub.CustomEvent
    };
    sandbox.globalThis = sandbox.window;
    sandbox.window.sessionStorage = sessionStorageObj;

    const context = vm.createContext(sandbox);

    loadScript('js/app/examSessionMixin.js', context);
    loadScript('js/app/suitePracticeMixin.js', context);

    const examIndex = [
        {
            id: 'reading-p1',
            title: 'Passage 1',
            type: 'reading',
            category: 'P1',
            path: 'templates/mock/p1/',
            filename: 'index.html',
            hasHtml: true
        },
        {
            id: 'reading-p2',
            title: 'Passage 2',
            type: 'reading',
            category: 'P2',
            path: 'templates/mock/p2/',
            filename: 'index.html',
            hasHtml: true
        },
        {
            id: 'reading-p3',
            title: 'Passage 3',
            type: 'reading',
            category: 'P3',
            path: 'templates/mock/p3/',
            filename: 'index.html',
            hasHtml: true
        }
    ];

    await storage.set('exam_index', examIndex);
    await storage.set('active_exam_index_key', 'exam_index');
    await storage.set('practice_records', []);
    await storage.set('active_sessions', []);

    const mixins = windowStub.ExamSystemAppMixins;
    if (!mixins || !mixins.examSession || !mixins.suitePractice) {
        throw new Error('未能加载所需的 mixin');
    }

    const app = {
        components: {},
        setState() {},
        getState() { return null; },
        updateExamStatus() {},
        refreshOverviewData() {},
        saveRealPracticeData: async () => {},
        cleanupExamSession: async () => {},
        _updatePracticeRecordsState: async () => {}
    };

    Object.assign(app, mixins.examSession, mixins.suitePractice);

    app.ensureExamWindowSession = function ensureExamWindowSession(examId, win) {
        if (!this.examWindows) {
            this.examWindows = new Map();
        }
        const info = { examId, window: win, expectedSessionId: this.generateSessionId(examId) };
        this.examWindows.set(examId, info);
        return info;
    };

    app.injectDataCollectionScript = function injectDataCollectionScript(examWindow, examId) {
        this.initializePracticeSession(examWindow, examId);
        if (typeof this.handleSessionReady === 'function') {
            this.handleSessionReady(examId, { pageType: 'unified-reading' });
        }
    };
    app.setupExamWindowManagement = function setupExamWindowManagement() {};

    const windowsMap = new Map();
    const openCalls = [];
    let openAttempt = 0;

    app.openExam = async function openExamStub(examId, options = {}) {
        openAttempt += 1;
        openCalls.push({ examId, options: { ...options } });

        const reuseWindow = options.reuseWindow && !options.reuseWindow.closed
            ? options.reuseWindow
            : null;

        if (openAttempt === 1) {
            const name = options.windowName && options.windowName.trim() ? options.windowName.trim() : '_blank';
            let targetWindow = windowsMap.get(name);
            if (!targetWindow || targetWindow.closed) {
                targetWindow = createStubWindow(name);
                windowsMap.set(name, targetWindow);
            }
            targetWindow.lastExamId = examId;

            if (typeof this.startPracticeSession === 'function') {
                await this.startPracticeSession(examId);
            }
            if (typeof this.injectDataCollectionScript === 'function') {
                this.injectDataCollectionScript(targetWindow, examId);
            }
            if (typeof this.setupExamWindowManagement === 'function') {
                this.setupExamWindowManagement(targetWindow, examId);
            }

            return targetWindow;
        }

        if (openAttempt === 2) {
            assert(reuseWindow, '第二次调用应提供复用窗口');
            reuseWindow.lastExamId = examId;

            if (typeof this.startPracticeSession === 'function') {
                await this.startPracticeSession(examId);
            }
            if (typeof this.injectDataCollectionScript === 'function') {
                this.injectDataCollectionScript(reuseWindow, examId);
            }
            if (typeof this.setupExamWindowManagement === 'function') {
                this.setupExamWindowManagement(reuseWindow, examId);
            }

            return reuseWindow;
        }

        if (openAttempt === 3) {
            return null; // 模拟复用窗口失败
        }

        if (openAttempt === 4) {
            const name = options.windowName && options.windowName.trim() ? options.windowName.trim() : '_blank';
            const newWindow = createStubWindow(name);
            newWindow.lastExamId = examId;
            windowsMap.set(name, newWindow);

            if (typeof this.startPracticeSession === 'function') {
                await this.startPracticeSession(examId);
            }
            if (typeof this.injectDataCollectionScript === 'function') {
                this.injectDataCollectionScript(newWindow, examId);
            }
            if (typeof this.setupExamWindowManagement === 'function') {
                this.setupExamWindowManagement(newWindow, examId);
            }

            return newWindow;
        }

        return null;
    };

    await app.startSuitePractice({ flowMode: 'simulation' });

    const session = app.currentSuiteSession;
    assert(session, '应创建套题会话');
    assert.strictEqual(session.sequence.length, 3, '应包含三篇文章');

    const firstExam = session.sequence[0];
    const secondExam = session.sequence[1];
    const thirdExam = session.sequence[2];

    assert.strictEqual(openCalls.length, 1, '首篇应触发一次 openExam 调用');
    const firstWindow = session.windowRef;
    assert(firstWindow, '应持有首篇窗口引用');
    assert.strictEqual(firstWindow.lastExamId, firstExam.examId, '首篇窗口应加载 P1');
    const firstCtx = firstWindow._messages.find(msg => msg && msg.type === 'SIMULATION_CONTEXT');
    assert(firstCtx, '首篇加载后应立即收到 SIMULATION_CONTEXT');
    assert.strictEqual(firstCtx.data.examId, firstExam.examId, '首篇上下文 examId 应匹配');

    const practicePayload = {
        duration: 900,
        scoreInfo: { correct: 12, total: 13, accuracy: 12 / 13, percentage: Math.round((12 / 13) * 100) },
        answers: { q1: 'A' },
        answerComparison: { q1: { correct: 'A', user: 'A' } }
    };

    const handledP1 = await app.handleSuitePracticeComplete(firstExam.examId, practicePayload);
    assert.strictEqual(handledP1, true, 'P1 完成后应继续 P2');
    assert.strictEqual(openCalls.length, 2, '应再次调用 openExam 载入 P2');
    assert.strictEqual(app.currentSuiteSession.windowRef, firstWindow, '仍应复用首个窗口');
    assert.strictEqual(app.currentSuiteSession.activeExamId, secondExam.examId, '会话应切换到 P2');
    assert.strictEqual(firstWindow.lastExamId, secondExam.examId, '窗口应更新为 P2');

    const handledP2 = await app.handleSuitePracticeComplete(secondExam.examId, practicePayload);
    assert.strictEqual(handledP2, true, 'P2 完成后应继续 P3');
    assert.strictEqual(openCalls.length, 4, 'P3 加载应包含一次失败与一次回退');
    assert.strictEqual(app.currentSuiteSession.activeExamId, thirdExam.examId, '会话应切换到 P3');
    assert.notStrictEqual(app.currentSuiteSession.windowRef, firstWindow, '回退后应获得新的窗口');
    assert.strictEqual(app.currentSuiteSession.windowRef.lastExamId, thirdExam.examId, '新窗口应加载 P3');

    const failureMessage = windowStub._messages.find(msg => typeof msg.text === 'string' && msg.text.includes('无法继续套题练习'));
    assert.strictEqual(failureMessage, undefined, '不应出现无法继续的警告');

    const handledP3 = await app.handleSuitePracticeComplete(thirdExam.examId, practicePayload);
    assert.strictEqual(handledP3, true, 'P3 完成后应顺利收尾');
    assert.strictEqual(app.currentSuiteSession, null, '套题会话应在完成后被清理');

    const practiceRecords = await storage.get('practice_records', []);
    assert.strictEqual(practiceRecords.length, 1, '应只生成一条套题练习记录');
    assert.strictEqual(practiceRecords[0].suiteEntries.length, 3, '套题记录应包含三篇文章');

    const completionMessage = windowStub._messages.find(msg => typeof msg.text === 'string' && msg.text.includes('套题练习已完成'));
    assert(completionMessage, '应提示套题练习完成');

    // 验证 SimulationSession 字段在初始化时存在
    const appSim = {
        components: {},
        setState() {},
        getState() { return null; },
        updateExamStatus() {},
        refreshOverviewData() {},
        saveRealPracticeData: async () => {},
        cleanupExamSession: async () => {},
        _updatePracticeRecordsState: async () => {}
    };
    Object.assign(appSim, mixins.examSession, mixins.suitePractice);
    appSim.ensureExamWindowSession = app.ensureExamWindowSession;
    appSim.injectDataCollectionScript = app.injectDataCollectionScript;
    appSim.setupExamWindowManagement = app.setupExamWindowManagement;

    const simOpenCalls = [];
    appSim.openExam = async function(examId, options = {}) {
        simOpenCalls.push({ examId, options: { ...options } });
        const name = options.windowName && options.windowName.trim() ? options.windowName.trim() : '_blank';
        const win = createStubWindow(name);
        win.lastExamId = examId;
        return win;
    };

    sessionStorageStub.clear();
    await appSim.startSuitePractice({ flowMode: 'simulation' });
    const simSession = appSim.currentSuiteSession;
    assert(simSession, '模拟会话应被创建');
    assert(typeof simSession.draftsByExam === 'object', '应包含 draftsByExam');
    assert(typeof simSession.elapsedByExam === 'object', '应包含 elapsedByExam');
    assert(typeof simSession.globalTimerAnchorMs === 'number', '应包含 globalTimerAnchorMs');

    const simP1 = simSession.sequence[0];
    const simP2 = simSession.sequence[1];
    const simP1Result = await appSim.handleSuitePracticeComplete(simP1.examId, practicePayload);
    assert.strictEqual(simP1Result, true, 'P1 提交后应自动前进');
    assert.strictEqual(simSession.currentIndex, 1, '应前进到第二篇');
    assert(simSession.draftsByExam[simP1.examId], 'P1 draft 应被保存');

    // 验证 sessionStorage 镜像
    const stored = sessionStorageStub.get('ielts_sim_session');
    assert(stored, 'sessionStorage 应包含会话镜像');
    const snapshot = JSON.parse(stored);
    assert.strictEqual(snapshot.id, simSession.id, '镜像 id 应匹配');
    assert.strictEqual(snapshot.currentIndex, 1, '镜像 currentIndex 应为 1');

    // 验证 _handleSimulationNavigate prev
    const simNavResult = await appSim._handleSimulationNavigate(simP2.examId, { direction: 'prev' }, simSession.windowRef);
    assert.strictEqual(simNavResult, true, '向前导航应成功');
    assert.strictEqual(simSession.currentIndex, 0, '应回到第一篇');
    assert.strictEqual(simSession.activeExamId, simP1.examId, '活动篇章应是 P1');

    // 导航到界外应失败
    const simNavOob = await appSim._handleSimulationNavigate(simP1.examId, { direction: 'prev' }, simSession.windowRef);
    assert.strictEqual(simNavOob, false, 'P1 向前导航应失败');

    process.stdout.write(JSON.stringify({ status: 'pass', detail: '模拟模式按顺序串联三篇题目并生成单条记录，导航与 sessionStorage 镜像正常' }));
}

main().catch(error => {
    const detail = error && error.stack ? error.stack : String(error);
    process.stdout.write(JSON.stringify({ status: 'fail', detail }));
    process.exit(1);
});
