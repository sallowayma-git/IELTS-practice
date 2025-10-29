#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

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
            this.handleSessionReady(examId, { pageType: 'reading' });
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

    await app.startSuitePractice();

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

    process.stdout.write(JSON.stringify({ status: 'pass', detail: '套题模式按顺序串联三篇题目并生成单条记录' }));
}

main().catch(error => {
    const detail = error && error.stack ? error.stack : String(error);
    process.stdout.write(JSON.stringify({ status: 'fail', detail }));
    process.exit(1);
});
