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

    const reopenedWindows = [];

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
            reopenedWindows.push({ url, name, window: stub });
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
        components: {
            practiceRecorder: {
                savePracticeRecord: async () => {},
                startPracticeSession: () => ({ sessionId: 'recorder-session' })
            }
        },
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

        if (openAttempt === 1) {
            const name = options.windowName && options.windowName.trim() ? options.windowName.trim() : '_blank';
            if (!windowsMap.has(name) || windowsMap.get(name).closed) {
                windowsMap.set(name, createStubWindow(name));
            }
            const targetWindow = windowsMap.get(name);
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

            if (options && options.suiteSessionId && typeof this.ensureExamWindowSession === 'function') {
                const info = this.ensureExamWindowSession(examId, targetWindow);
                if (info) {
                    info.suiteSessionId = options.suiteSessionId;
                    if (!this.examWindows) {
                        this.examWindows = new Map();
                    }
                    this.examWindows.set(examId, info);
                }
            }

            return targetWindow;
        }

        if (openAttempt === 2) {
            return null;
        }

        const reuseWindow = options.reuseWindow && !options.reuseWindow.closed ? options.reuseWindow : null;
        if (!reuseWindow) {
            return null;
        }

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

        if (options && options.suiteSessionId && typeof this.ensureExamWindowSession === 'function') {
            const info = this.ensureExamWindowSession(examId, reuseWindow);
            if (info) {
                info.suiteSessionId = options.suiteSessionId;
                if (!this.examWindows) {
                    this.examWindows = new Map();
                }
                this.examWindows.set(examId, info);
            }
        }

        return reuseWindow;
    };

    const startResult = await app.startSuitePractice();
    assert.strictEqual(startResult, undefined, 'startSuitePractice 应返回 undefined');

    const session = app.currentSuiteSession;
    assert(session, '应创建套题会话');
    assert.strictEqual(session.sequence.length, 3, '应包含三篇文章');

    const firstExam = session.sequence[0];
    const secondExam = session.sequence[1];

    assert.strictEqual(openCalls.length, 1, '首篇应触发一次 openExam 调用');
    const firstWindow = session.windowRef;
    assert(firstWindow, '应持有首篇窗口引用');
    assert.strictEqual(firstWindow.lastExamId, firstExam.examId, '首篇窗口应加载 P1');

    firstWindow.closed = false;
    const closeAttemptsBefore = Array.isArray(session.closeAttempts) ? session.closeAttempts.length : 0;
    firstWindow.close();
    const closeAttemptsAfter = Array.isArray(session.closeAttempts) ? session.closeAttempts.length : 0;
    assert.strictEqual(firstWindow.closed, false, '套题防护应阻止首篇窗口被直接关闭');
    assert.strictEqual(closeAttemptsAfter, closeAttemptsBefore + 1, '拦截关闭应记录一次尝试');

    const selfOpenAttemptsBefore = closeAttemptsAfter;
    const sameWindow = firstWindow.open('next.html', '_self');
    const selfOpenAttemptsAfter = Array.isArray(session.closeAttempts) ? session.closeAttempts.length : 0;
    assert.strictEqual(sameWindow, firstWindow, '拦截自目标打开应返回原窗口');
    assert.strictEqual(selfOpenAttemptsAfter, selfOpenAttemptsBefore + 1, '自目标打开应同样记录尝试');

    const newChild = firstWindow.open('child.html', '_blank');
    assert(newChild && newChild !== firstWindow, '普通新标签打开应仍然生效');
    assert.strictEqual(newChild.lastUrl, 'child.html', '新标签应接收到目标 URL');
    const attemptsAfterChild = Array.isArray(session.closeAttempts) ? session.closeAttempts.length : 0;
    assert.strictEqual(attemptsAfterChild, selfOpenAttemptsAfter, '普通新标签打开不应计入关闭尝试');

    const practicePayload = {
        duration: 900,
        scoreInfo: { correct: 12, total: 13, accuracy: 12 / 13, percentage: Math.round((12 / 13) * 100) },
        answers: { q1: 'A' },
        answerComparison: { q1: { correct: 'A', user: 'A' } }
    };

    firstWindow.closed = true;

    const handledSuccess = await app.handleSuitePracticeComplete(firstExam.examId, practicePayload);
    assert.strictEqual(handledSuccess, true, '应成功衔接到下一篇');

    assert(app.currentSuiteSession, '套题会话仍应存在');
    assert.strictEqual(app.currentSuiteSession.status, 'active', '套题会话应保持激活状态');
    assert.strictEqual(app.currentSuiteSession.activeExamId, secondExam.examId, '应切换到第二篇');

    assert.strictEqual(openCalls.length, 3, '第二篇应触发重试逻辑');
    const secondCall = openCalls[1];
    assert.strictEqual(secondCall.options.reuseWindow, undefined, '初次衔接尝试没有可复用窗口');

    assert.strictEqual(reopenedWindows.length, 1, '应尝试重建被关闭的标签');
    const fallbackRecord = reopenedWindows[0];
    assert.strictEqual(fallbackRecord.url, 'about:blank', '回退窗口应先以空白页重建');
    assert.strictEqual(fallbackRecord.name, session.windowName, '回退窗口应沿用套题标签名');

    const thirdCall = openCalls[2];
    assert(thirdCall.options.reuseWindow === fallbackRecord.window, '重试应使用回退窗口');

    assert.strictEqual(app.currentSuiteSession.windowRef, fallbackRecord.window, '窗口引用应指向回退窗口');
    assert.strictEqual(fallbackRecord.window.lastExamId, secondExam.examId, '回退窗口应加载 P2');

    const failureMessage = windowStub._messages.find(msg => typeof msg.text === 'string' && msg.text.includes('无法继续套题练习'));
    assert.strictEqual(failureMessage, undefined, '不应出现无法继续的警告');

    process.stdout.write(JSON.stringify({ status: 'pass', detail: '套题模式能在首篇完成后继续下一篇练习' }));
}

main().catch(error => {
    const detail = error && error.stack ? error.stack : String(error);
    process.stdout.write(JSON.stringify({ status: 'fail', detail }));
    process.exit(1);
});
