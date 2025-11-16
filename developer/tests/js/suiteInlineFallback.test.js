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

function createExamWindow(parentWindow) {
    const messageListeners = [];
    const documentListeners = {};
    const buttonStub = {
        _handlers: [],
        addEventListener(type, handler) {
            this._handlers.push({ type, handler });
        }
    };

    const doc = {
        head: {
            appendChild(node) {
                if (!node || typeof node.textContent !== 'string') {
                    return;
                }
                const scriptContext = vm.createContext({
                    window: examWindow,
                    document: examWindow.document,
                    console,
                    setTimeout: (fn) => { fn(); return 0; },
                    clearTimeout: () => {},
                    Math,
                    Date,
                    Array,
                    JSON,
                });
                scriptContext.globalThis = examWindow;
                examWindow.window = examWindow;
                examWindow.self = examWindow;
                examWindow.top = examWindow;
                vm.runInContext(node.textContent, scriptContext);
            }
        },
        createElement(tagName) {
            const tag = (tagName || '').toLowerCase();
            if (tag === 'script') {
                let text = '';
                return {
                    tagName: 'SCRIPT',
                    set textContent(value) { text = value; },
                    get textContent() { return text; },
                    set type(_) {},
                    get type() { return 'text/javascript'; }
                };
            }
            return { tagName: tagName ? tagName.toUpperCase() : '', style: {}, setAttribute() {}, addEventListener() {} };
        },
        addEventListener(type, handler) {
            if (!documentListeners[type]) {
                documentListeners[type] = [];
            }
            documentListeners[type].push(handler);
        },
        querySelector(selector) {
            if (selector === 'button[onclick*="grade"]') {
                return buttonStub;
            }
            return null;
        },
        querySelectorAll() {
            return [buttonStub];
        },
        readyState: 'complete',
        defaultView: null
    };

    const examWindow = {
        name: 'ielts-suite-mode-tab',
        document: doc,
        opener: parentWindow,
        parent: parentWindow,
        location: { href: 'http://localhost/p1.html' },
        closed: false,
        _messageListeners: messageListeners,
        _messages: [],
        _nativeCloseCalled: false,
        addEventListener(type, handler) {
            if (type === 'message') {
                messageListeners.push(handler);
            }
        },
        removeEventListener() {},
        postMessage(message) {
            this._messages.push(message);
            messageListeners.slice().forEach(listener => {
                listener({ data: message, source: parentWindow });
            });
        },
        focus() {},
        close() {
            this._nativeCloseCalled = true;
            this.closed = true;
        }
    };

    doc.defaultView = examWindow;
    return examWindow;
}

async function main() {
    const storageState = new Map();
    const storage = {
        async get(key, fallback = undefined) {
            if (storageState.has(key)) {
                return JSON.parse(JSON.stringify(storageState.get(key)));
            }
            return fallback === undefined ? undefined : JSON.parse(JSON.stringify(fallback));
        },
        async set(key, value) {
            storageState.set(key, JSON.parse(JSON.stringify(value)));
        }
    };

    const parentWindow = {
        _messages: [],
        showMessage() {},
        location: { origin: 'http://localhost', href: 'http://localhost/index.html' },
        screen: { availWidth: 1920, availHeight: 1080 },
        document: { title: 'IELTS Practice' },
        postMessage(message) {
            this._messages.push(message);
        }
    };

    const sandbox = {
        window: parentWindow,
        document: parentWindow.document,
        storage,
        console,
        setTimeout: (fn) => { fn(); return 0; },
        clearTimeout: () => {},
        Math,
        Date,
        JSON,
        Array,
    };
    sandbox.globalThis = sandbox.window;

    const context = vm.createContext(sandbox);
    loadScript('js/app/examSessionMixin.js', context);
    loadScript('js/app/suitePracticeMixin.js', context);

    const mixins = parentWindow.ExamSystemAppMixins;
    if (!mixins || !mixins.examSession || !mixins.suitePractice) {
        throw new Error('未能加载 mixin');
    }

    const app = {
        components: { practiceRecorder: { savePracticeRecord: async () => {} } },
        setState() {},
        getState() { return null; },
        updateExamStatus() {},
        refreshOverviewData() {},
        saveRealPracticeData: async () => {},
        cleanupExamSession: async () => {}
    };

    Object.assign(app, mixins.examSession, mixins.suitePractice);

    app.initializeSuiteMode();

    const examId = 'reading-inline';
    const suiteSessionId = 'suite-inline-123';

    app.currentSuiteSession = {
        id: suiteSessionId,
        status: 'active',
        activeExamId: examId,
        currentIndex: 0,
        sequence: [{ examId, exam: { id: examId, title: 'Mock Inline', path: 'templates/mock/', filename: 'index.html', hasHtml: true } }],
        windowRef: null
    };
    app.suiteExamMap = new Map([[examId, suiteSessionId]]);

    const examWindow = createExamWindow(parentWindow);
    app.injectInlineScript(examWindow, examId);

    const initMessage = examWindow._messages.find(msg => msg && msg.type === 'INIT_SESSION');
    assert(initMessage, '应发送 INIT_SESSION 消息');

    const readyMessage = parentWindow._messages.find(msg => msg && msg.type === 'SESSION_READY');
    assert(readyMessage, '应收到 SESSION_READY 消息');
    assert.strictEqual(readyMessage.data.examId, examId, 'SESSION_READY 应包含正确的 examId');

    assert.strictEqual(typeof examWindow.practiceDataCollector, 'object', '应注入 practiceDataCollector');

    const closeAttemptsBefore = parentWindow._messages.filter(msg => msg && msg.type === 'SUITE_CLOSE_ATTEMPT').length;
    examWindow.close();
    const closeAttemptsAfter = parentWindow._messages.filter(msg => msg && msg.type === 'SUITE_CLOSE_ATTEMPT').length;
    assert.strictEqual(closeAttemptsAfter, closeAttemptsBefore + 1, '拦截关闭时应上报 SUITE_CLOSE_ATTEMPT');
    assert.strictEqual(examWindow._nativeCloseCalled, false, '窗口不应真正关闭');
    assert.strictEqual(examWindow.closed, false, '窗口状态应保持开启');

    const navigateMessage = { type: 'SUITE_NAVIGATE', data: { url: 'http://localhost/p2.html', examId: 'reading-inline-2' } };
    examWindow._messageListeners.forEach(listener => listener({ data: navigateMessage }));
    assert.strictEqual(examWindow.location.href, 'http://localhost/p2.html', '应在标签页内导航至下一篇');

    const forceCloseMessage = { type: 'SUITE_FORCE_CLOSE', data: { suiteSessionId } };
    examWindow._messageListeners.forEach(listener => listener({ data: forceCloseMessage }));
    assert.strictEqual(examWindow._nativeCloseCalled, true, '强制关闭应调用原生 close');
    assert.strictEqual(examWindow.closed, true, '强制关闭后窗口应标记为关闭');

    process.stdout.write(JSON.stringify({ status: 'pass', detail: '内联注入在 file:// 环境下也能维持套题标签页' }));
}

main().catch(error => {
    const detail = error && error.stack ? error.stack : String(error);
    process.stdout.write(JSON.stringify({ status: 'fail', detail }));
    process.exit(1);
});
