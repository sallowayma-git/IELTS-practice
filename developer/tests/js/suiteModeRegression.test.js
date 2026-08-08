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

function createSandbox(options = {}) {
    const cloneValue = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const windowSessionStore = new Map();
    let activeSessions = [];
    let practiceRecords = [];
    const recoveryControl = {
        saveQueue: [],
        cleanupQueue: [],
        events: []
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
        AppData: {
            ready: Promise.resolve(),
            recovery: {
                async listActiveSessions() {
                    return cloneValue(activeSessions);
                },
                async saveActiveSession(value, options = {}) {
                    recoveryControl.events.push({ type: 'save', value: cloneValue(value), options: cloneValue(options) });
                    const behavior = recoveryControl.saveQueue.length ? recoveryControl.saveQueue.shift() : true;
                    if (behavior instanceof Error) throw behavior;
                    if (typeof behavior === 'function') return behavior(value, options);
                    if (behavior === false) return { committed: false };
                    const id = String(value && value.id || '');
                    const index = activeSessions.findIndex((item) => String(item && item.id || '') === id);
                    if (index >= 0) activeSessions[index] = cloneValue(value);
                    else activeSessions.push(cloneValue(value));
                    return { committed: true, item: cloneValue(value) };
                },
                async discardActiveSession(id) {
                    recoveryControl.events.push({ type: 'discard', id: String(id) });
                    activeSessions = activeSessions.filter((item) => String(item && item.id || '') !== String(id));
                    return { committed: true };
                },
                async cleanupForRetry(options = {}) {
                    recoveryControl.events.push({ type: 'cleanup', options: cloneValue(options) });
                    const behavior = recoveryControl.cleanupQueue.length ? recoveryControl.cleanupQueue.shift() : true;
                    if (behavior instanceof Error) throw behavior;
                    return { committed: behavior !== false, removedCount: behavior === false ? 0 : 1, removedByKind: {} };
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
        location: options.protocol === 'file:'
            ? { protocol: 'file:', origin: 'null', href: 'file:///index.html' }
            : { protocol: 'http:', origin: 'http://localhost', href: 'http://localhost/' },
        crypto: webcrypto,
        practiceConfig: { suite: {} },
        __listenerCount(type) {
            if (!listenerRegistry.has(type)) return 0;
            return listenerRegistry.get(type).size;
        },
        __listenerStats: listenerStats
    };
    windowStub.__dispatchEvent = (type, event) => {
        const listeners = listenerRegistry.has(type) ? Array.from(listenerRegistry.get(type)) : [];
        listeners.forEach((listener) => listener(event));
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
    return { sandbox, windowStub, windowSessionStore, recoveryControl };
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
    const { sandbox, windowStub, windowSessionStore, recoveryControl } = createSandbox();
    const context = vm.createContext(sandbox);
    loadScript('js/app/examSessionMixin.js', context);
    loadScript('js/app/suitePracticeMixin.js', context);

    if (!windowStub.ExamSystemAppMixins || !windowStub.ExamSystemAppMixins.suitePractice) {
        throw new Error('mixin 加载失败');
    }

    // Case 0.0: 套题必须先提交 durable v2 recovery；配额错误只清 recovery 后重试一次。
    {
        const app = createApp(windowStub);
        const quotaError = new Error('quota');
        quotaError.code = 'QUOTA_EXCEEDED';
        recoveryControl.saveQueue.push(quotaError, true);
        recoveryControl.events.length = 0;
        let openCount = 0;
        app.openExam = async () => {
            openCount += 1;
            assert.deepStrictEqual(
                recoveryControl.events.map((event) => event.type),
                ['save', 'cleanup', 'save'],
                '首题窗口只能在清理并确认 durable recovery 后打开'
            );
            return createStubWindow('suite-window');
        };
        assert.strictEqual(
            await app._launchSuiteSessionFromSequence(makeSession('suite_start_retry').sequence, { flowMode: 'simulation' }),
            true,
            '配额清理后的单次重试成功时应启动套题'
        );
        assert.strictEqual(openCount, 1, 'durable commit 成功后只能打开一次首题');
        const cleanupEvent = recoveryControl.events.find((event) => event.type === 'cleanup');
        assert.deepStrictEqual(
            plain(cleanupEvent.options.preserve.activeSession),
            [app.currentSuiteSession.id],
            '清理必须保护当前套题 recovery'
        );
    }

    // Case 0.0.1: cleanup 后仍失败或存储被拒绝时，套题不得 fail-open。
    for (const failureMode of ['quota', 'backend']) {
        const app = createApp(windowStub);
        const firstError = new Error(failureMode);
        firstError.code = failureMode === 'quota' ? 'QUOTA_EXCEEDED' : 'BACKEND_UNAVAILABLE';
        recoveryControl.events.length = 0;
        recoveryControl.saveQueue.push(firstError);
        if (failureMode === 'quota') {
            const retryError = new Error('quota-retry');
            retryError.code = 'QUOTA_EXCEEDED';
            recoveryControl.saveQueue.push(retryError);
        }
        let openCount = 0;
        app.openExam = async () => {
            openCount += 1;
            return createStubWindow('must-not-open');
        };
        assert.strictEqual(
            await app._launchSuiteSessionFromSequence(makeSession(`suite_start_${failureMode}`).sequence, { flowMode: 'simulation' }),
            false,
            `${failureMode} 持久化失败必须阻止启动`
        );
        assert.strictEqual(openCount, 0, '未确认 recovery 时不得打开首题');
        assert.strictEqual(app.currentSuiteSession, null, '未启动会话不得留在内存中伪装成可恢复状态');
        assert.strictEqual(
            recoveryControl.events.filter((event) => event.type === 'cleanup').length,
            failureMode === 'quota' ? 1 : 0,
            '只有 quota 错误允许触发 recovery cleanup'
        );
    }

    // Case 0.0.1a: 刷新后的同名存活题页必须旋转 token 重新绑定，不得导航或重载。
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_live_rebind');
        session.windowRef = null;
        session.windowBinding = {
            examId: 'reading-p1',
            expectedSessionId: 'reading-p1-session',
            windowSessionToken: 'old-window-token',
            sessionGeneration: 4,
            expectedUrl: 'http://localhost/exam.html?examId=reading-p1',
            expectedOrigin: 'http://localhost',
            allowOpaqueOrigin: false
        };
        session.currentIndex = 1;
        session.activeExamId = 'reading-p2';
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map((item) => [item.examId, session.id]));
        assert.strictEqual(
            app._buildSuiteWindowBinding(session).examId,
            'reading-p1',
            'proof 前的 fallback binding 必须保留凭据来源篇章'
        );
        const liveChild = createStubWindow('ielts-suite-mode-tab');
        liveChild.location.href = session.windowBinding.expectedUrl;
        liveChild.addEventListener = () => {};
        const originalPostMessage = liveChild.postMessage.bind(liveChild);
        liveChild.postMessage = (payload, targetOrigin) => {
            originalPostMessage(payload, targetOrigin);
            if (payload && payload.type === 'SUITE_REBIND_CHALLENGE') {
                windowStub.__dispatchEvent('message', {
                    source: liveChild,
                    origin: 'http://localhost',
                    data: {
                        type: 'SUITE_REBIND_PROOF',
                        source: 'practice_page',
                        data: {
                            challenge: payload.data.challenge,
                            suiteSessionId: session.id,
                            examId: 'reading-p2',
                            sessionId: 'reading-p1-session',
                            windowSessionToken: 'old-window-token',
                            windowSessionGeneration: 4
                        }
                    }
                });
            }
        };
        const originalOpen = windowStub.open;
        const observedOpenUrls = [];
        windowStub.open = (url, name) => {
            observedOpenUrls.push({ url, name });
            return liveChild;
        };
        try {
            const rebound = await app._tryRebindSuiteWindow(session, session.sequence[1]);
            assert.strictEqual(rebound.window, liveChild, '应复用同一 WindowProxy');
            assert.deepStrictEqual(observedOpenUrls, [{ url: '', name: 'ielts-suite-mode-tab' }]);
            assert.strictEqual(liveChild.location.href, session.windowBinding.expectedUrl, '重绑定不得改写题页 URL');
            const info = app.examWindows.get('reading-p2');
            assert.strictEqual(info.expectedSessionId, 'reading-p1-session', '重绑定必须保留练习 session 身份');
            assert.strictEqual(info.sessionGeneration, 5, '重绑定 generation 必须严格递增');
            assert.notStrictEqual(info.windowSessionToken, 'old-window-token', '重绑定必须旋转 token');
            assert.strictEqual(session.windowBinding.examId, 'reading-p2', 'proof 成功后才能接管实际活动篇章');
        } finally {
            windowStub.open = originalOpen;
            const info = app.examWindows && app.examWindows.get('reading-p2');
            if (info && info.closeMonitor) clearInterval(info.closeMonitor);
            if (app._handshakeTimers) {
                for (const timer of app._handshakeTimers.values()) clearInterval(timer);
                app._handshakeTimers.clear();
            }
        }
    }

    // Case 0.0.1aa: 首个 INIT 之前必须已有包含 window binding 的 durable v2 snapshot。
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_pre_init_binding');
        session.windowRef = null;
        session._suiteGeneration = 1;
        session._lastDurableRecoveryRevision = 0;
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map((item) => [item.examId, session.id]));
        assert.strictEqual(await app._commitSuiteRecovery(session, { reason: 'pre-init-base' }), true);
        const child = createStubWindow('ielts-suite-mode-tab');
        child.addEventListener = () => {};
        let firstInitDurableSnapshot = null;
        const originalPostMessage = child.postMessage.bind(child);
        child.postMessage = (payload) => {
            if (!firstInitDurableSnapshot && payload && String(payload.type || '').toUpperCase() === 'INIT_SESSION') {
                const saves = recoveryControl.events.filter((event) => event.type === 'save');
                firstInitDurableSnapshot = saves.length ? plain(saves[saves.length - 1].value) : null;
            }
            originalPostMessage(payload);
        };
        app.resolveReadingLaunchDescriptor = () => ({
            mode: 'unified_html',
            url: 'http://localhost/exam.html?examId=reading-p1'
        });
        app.openExamWindow = () => child;
        app._guardExamWindowContent = (targetWindow) => targetWindow;
        app._captureLaunchLibraryConfigurationId = async () => null;
        app.startPracticeSession = async () => 'reading-p1-session';
        app.injectDataCollectionScript = () => {};
        const opened = await app.openExam('reading-p1', {
            examDefinition: session.sequence[0].exam,
            target: 'tab',
            windowName: session.windowName,
            suiteSessionId: session.id,
            suiteFlowMode: 'simulation',
            suiteTimerMode: 'countdown',
            suiteTimerLimitSeconds: 3600,
            sequenceIndex: 0,
            sequenceTotal: session.sequence.length
        });
        assert.strictEqual(opened, child);
        assert(firstInitDurableSnapshot && firstInitDurableSnapshot.windowBinding, 'first INIT must observe a durable window binding');
        const firstInit = child._messages.find((message) => message && String(message.type || '').toUpperCase() === 'INIT_SESSION');
        assert(firstInit, 'suite window must receive INIT after the checkpoint');
        assert.strictEqual(firstInitDurableSnapshot.windowBinding.expectedSessionId, firstInit.data.sessionId);
        assert.strictEqual(firstInitDurableSnapshot.windowBinding.windowSessionToken, firstInit.data.windowSessionToken);
        const info = app.examWindows && app.examWindows.get('reading-p1');
        if (info && info.closeMonitor) clearInterval(info.closeMonitor);
        if (app._handshakeTimers) {
            for (const timer of app._handshakeTimers.values()) clearInterval(timer);
            app._handshakeTimers.clear();
        }
    }

    // Case 0.0.1ab: an async sender from a replaced registration must not restore the old map entry.
    {
        const app = createApp(windowStub);
        const oldWindow = createStubWindow('old-registration');
        const newWindow = createStubWindow('new-registration');
        const oldInfo = app.ensureExamWindowSession('reading-p1', oldWindow);
        let releaseOldDraft;
        app.getReadingDraftForExam = async () => new Promise((resolve) => { releaseOldDraft = resolve; });
        const staleSend = app._sendExamInitEnvelope('reading-p1', oldWindow);
        await Promise.resolve();
        const newInfo = {
            ...oldInfo,
            window: newWindow,
            expectedSessionId: 'reading-p1-new-session',
            windowSessionToken: 'reading-p1-new-token',
            windowSessionTokenSessionId: 'reading-p1-new-session',
            sessionGeneration: Number(oldInfo.sessionGeneration) + 1,
            initEnvelopeEpoch: 0
        };
        app.examWindows.set('reading-p1', newInfo);
        releaseOldDraft({ sessionId: oldInfo.expectedSessionId, updatedAt: 1, answers: { q1: 'OLD' } });
        assert.strictEqual(await staleSend, null);
        assert.strictEqual(app.examWindows.get('reading-p1'), newInfo, 'stale sender must not write its old registration back');
        assert.strictEqual(oldWindow._messages.length, 0, 'stale registration must not receive INIT');
    }

    // Case 0.0.1ac: within one registration, only the latest async draft sender may emit INIT.
    {
        const app = createApp(windowStub);
        const child = createStubWindow('same-registration');
        const info = app.ensureExamWindowSession('reading-p1', child);
        let callCount = 0;
        let releaseSlowDraft;
        app.getReadingDraftForExam = async () => {
            callCount += 1;
            if (callCount === 1) return new Promise((resolve) => { releaseSlowDraft = resolve; });
            return { sessionId: info.expectedSessionId, updatedAt: 20, answers: { q1: 'NEW' } };
        };
        const slowSend = app._sendExamInitEnvelope('reading-p1', child);
        await Promise.resolve();
        const fastPayload = await app._sendExamInitEnvelope('reading-p1', child);
        assert.strictEqual(fastPayload.draft.answers.q1, 'NEW');
        releaseSlowDraft({ sessionId: info.expectedSessionId, updatedAt: 10, answers: { q1: 'OLD' } });
        assert.strictEqual(await slowSend, null);
        assert.strictEqual(child._messages.length, 2, 'only the latest sender should emit the two INIT aliases');
        assert(child._messages.every((message) => message.data.draft.answers.q1 === 'NEW'));
    }

    // Case 0.0.1b: file:// 无法读取子窗口 URL 时，完整持久 binding 仍应允许无导航重绑。
    {
        const fileHarness = createSandbox({ protocol: 'file:' });
        const fileContext = vm.createContext(fileHarness.sandbox);
        loadScript('js/app/examSessionMixin.js', fileContext);
        loadScript('js/app/suitePracticeMixin.js', fileContext);
        const fileApp = createApp(fileHarness.windowStub);
        const session = makeSession('suite_file_live_rebind');
        session.windowRef = null;
        session.windowBinding = {
            examId: 'reading-p1',
            expectedSessionId: 'reading-p1-file-session',
            windowSessionToken: 'old-file-token',
            sessionGeneration: 7,
            expectedUrl: 'file:///reading-practice-unified.html?examId=reading-p1',
            expectedOrigin: 'file://',
            allowOpaqueOrigin: true
        };
        fileApp.currentSuiteSession = session;
        fileApp.suiteExamMap = new Map(session.sequence.map((item) => [item.examId, session.id]));
        const liveChild = createStubWindow('ielts-suite-mode-tab');
        Object.defineProperty(liveChild, 'location', {
            configurable: true,
            get() {
                const error = new Error('opaque file origin');
                error.name = 'SecurityError';
                throw error;
            }
        });
        const observedOpenUrls = [];
        const originalPostMessage = liveChild.postMessage.bind(liveChild);
        liveChild.postMessage = (payload, targetOrigin) => {
            originalPostMessage(payload, targetOrigin);
            if (payload && payload.type === 'SUITE_REBIND_CHALLENGE') {
                fileHarness.windowStub.__dispatchEvent('message', {
                    source: liveChild,
                    origin: 'null',
                    data: {
                        type: 'SUITE_REBIND_PROOF',
                        source: 'practice_page',
                        data: {
                            challenge: payload.data.challenge,
                            suiteSessionId: session.id,
                            examId: 'reading-p1',
                            sessionId: 'reading-p1-file-session',
                            windowSessionToken: 'old-file-token',
                            windowSessionGeneration: 7
                        }
                    }
                });
            }
        };
        fileHarness.windowStub.open = (url, name) => {
            observedOpenUrls.push({ url, name });
            return liveChild;
        };
        const rebound = await fileApp._tryRebindSuiteWindow(session, session.sequence[0]);
        assert.strictEqual(rebound.window, liveChild, 'file:// must reuse the surviving named WindowProxy');
        assert.deepStrictEqual(observedOpenUrls, [{ url: '', name: 'ielts-suite-mode-tab' }]);
        const info = fileApp.examWindows.get('reading-p1');
        assert.strictEqual(info.expectedSessionId, 'reading-p1-file-session');
        assert.strictEqual(info.sessionGeneration, 8);
        assert.notStrictEqual(info.windowSessionToken, 'old-file-token');
        if (info && info.closeMonitor) clearInterval(info.closeMonitor);
        if (fileApp._handshakeTimers) {
            for (const timer of fileApp._handshakeTimers.values()) clearInterval(timer);
            fileApp._handshakeTimers.clear();
        }
    }

    // Case 0.0.2: 每题 recovery 未提交时必须 NACK，且保持当前篇可重试。
    {
        const fileHarness = createSandbox({ protocol: 'file:' });
        const fileContext = vm.createContext(fileHarness.sandbox);
        loadScript('js/app/examSessionMixin.js', fileContext);
        loadScript('js/app/suitePracticeMixin.js', fileContext);
        const fileApp = createApp(fileHarness.windowStub);
        const session = makeSession('suite_file_blank_window');
        session.windowRef = null;
        session.windowBinding = {
            examId: 'reading-p1',
            expectedSessionId: 'reading-p1-file-session',
            windowSessionToken: 'old-file-token',
            sessionGeneration: 2,
            expectedUrl: 'file:///reading-practice-unified.html?examId=reading-p1',
            expectedOrigin: 'file://',
            allowOpaqueOrigin: true
        };
        fileApp.currentSuiteSession = session;
        const blankChild = createStubWindow('ielts-suite-mode-tab');
        blankChild.location.href = 'about:blank';
        blankChild.close = function close() { this.closed = true; };
        fileHarness.windowStub.open = () => blankChild;
        assert.strictEqual(await fileApp._tryRebindSuiteWindow(session, session.sequence[0]), null);
        assert.strictEqual(blankChild.closed, true, 'new file:// about:blank window must be closed instead of treated as a rebound child');
        assert.strictEqual(Boolean(fileApp.examWindows && fileApp.examWindows.has('reading-p1')), false);
    }

    // Case 0.0.1c: completed recovery 清理失败时不得并发创建新套题。
    {
        const app = createApp(windowStub);
        const completed = makeSession('suite_completed_cleanup_failure');
        completed.status = 'completed';
        app.currentSuiteSession = completed;
        app._teardownSuiteSession = async () => false;
        let openCount = 0;
        app.openExam = async () => {
            openCount += 1;
            return createStubWindow('must-not-open');
        };
        assert.strictEqual(
            await app._launchSuiteSessionFromSequence(makeSession('replacement').sequence, { flowMode: 'simulation' }),
            false
        );
        assert.strictEqual(app.currentSuiteSession, completed);
        assert.strictEqual(openCount, 0);
    }

    // Case 0.0.2: 每题 recovery 未提交时必须 NACK，且保持当前篇可重试。
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_passage_nack');
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map((item) => [item.examId, session.id]));
        let openCount = 0;
        app.openExam = async () => {
            openCount += 1;
            return createStubWindow('suite-window');
        };
        recoveryControl.saveQueue.push(false);
        const payload = {
            suiteSessionId: session.id,
            submissionId: 'submission-p1',
            answers: { q1: 'A' },
            answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 },
            draft: { answers: { q1: 'A' }, updatedAt: 100 },
            draftUpdatedAt: 100
        };
        const failed = await app.handleSuitePracticeComplete('reading-p1', payload, session.windowRef);
        assert.strictEqual(failed.handled, true);
        assert.strictEqual(failed.committed, false, '未持久化 passage 不得 ACK committed');
        assert.strictEqual(failed.errorCode, 'suite_recovery_save_failed');
        assert.strictEqual(session.currentIndex, 0, '失败后必须停留在 P1');
        assert.strictEqual(session.activeExamId, 'reading-p1');
        assert.strictEqual(openCount, 0, '失败后不得清题或切到 P2');

        const retried = await app.handleSuitePracticeComplete('reading-p1', payload, session.windowRef);
        assert.strictEqual(retried.committed, true, '相同 submission 重试提交成功后才 ACK');
        assert.strictEqual(openCount, 1, '成功重试后只前进一次');
        assert.strictEqual(session.currentIndex, 1);
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
        recoveryControl.events.length = 0;
        app.openExam = async (examId, options = {}) => {
            const latestSave = recoveryControl.events
                .filter((event) => event.type === 'save' && event.value && event.value.id === session.id)
                .at(-1);
            assert(latestSave, '导航前必须存在当前套题的 durable recovery commit');
            assert.strictEqual(latestSave.value.activeExamId, examId, '导航前 recovery 必须已指向目标篇章');
            assert.strictEqual(
                latestSave.value.currentIndex,
                session.sequence.findIndex((entry) => entry.examId === examId),
                '导航前 recovery 索引必须已切到目标篇章'
            );
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
        await new Promise((resolve) => setTimeout(resolve, 0));
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
        for (let attempt = 0; attempt < 10 && typeof releaseFirstOpen !== 'function'; attempt += 1) {
            await Promise.resolve();
        }
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
        app.handleSuitePracticeComplete = async () => { throw new Error('suite handler failure'); };
        let standaloneWrites = 0;
        app.saveRealPracticeData = async () => { standaloneWrites += 1; return { id: 'unexpected' }; };
        assert.strictEqual(await app.handlePracticeComplete('reading-p1', {
            suiteSessionId: session.id,
            answers: { q1: 'A' },
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
        }, session.windowRef), false);
        assert.strictEqual(standaloneWrites, 0, '套题处理失败不得写入单篇 fallback');
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
        app._announcePracticeSubmitOutcome(examId, { ...payload, suiteId: 'set-1' }, sourceWindow, true);
        assert.strictEqual(app._replayPracticeSubmitReceipt(examId, { ...payload, suiteId: 'set-1' }, sourceWindow), true);
        assert.strictEqual(app._replayPracticeSubmitReceipt(examId, { ...payload, suiteId: 'set-2' }, sourceWindow), false, 'ACK receipt 必须包含 suiteId');
        clearTimeout(session.submitReceiptTeardownTimer);
        session.submitReceiptTeardownTimer = null;

        let guardedCloseTeardownCount = 0;
        app._teardownSuiteSession = async () => { guardedCloseTeardownCount += 1; return true; };
        session.status = 'active';
        app._ensureSuiteWindowGuard(session, sourceWindow);
        sourceWindow.close();
        await Promise.resolve();
        assert.strictEqual(guardedCloseTeardownCount, 0, '进行中的套题必须继续拦截 guarded close');
        session.status = 'completed';
        sourceWindow.close();
        await Promise.resolve();
        assert.strictEqual(guardedCloseTeardownCount, 1, '最终 ACK 的 guarded close 必须立即 teardown 已完成套题');
        app._releaseSuiteWindowGuard(sourceWindow);

        let completedCloseTeardownCount = 0;
        app._teardownSuiteSession = async (targetSession) => {
            assert.strictEqual(targetSession, session);
            completedCloseTeardownCount += 1;
            return true;
        };
        app.setupExamWindowCommunication(sourceWindow, examId);
        const closeAttemptHandler = app.messageHandlers.get(examId);
        const closeAttemptEvent = {
            source: sourceWindow,
            origin: 'http://localhost',
            data: {
                type: 'SUITE_CLOSE_ATTEMPT',
                source: 'practice_page',
                data: {
                    examId,
                    suiteSessionId: session.id,
                    windowSessionToken: 'token-inline-submit-ack'
                }
            }
        };
        await closeAttemptHandler(closeAttemptEvent);
        assert.strictEqual(completedCloseTeardownCount, 1, 'final ACK 后子页退出应立即清理已完成套题');

        session.status = 'active';
        await closeAttemptHandler(closeAttemptEvent);
        assert.strictEqual(completedCloseTeardownCount, 1, '进行中的套题仍必须拦截子页关闭');
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

        const oldV2Session = app.multiSuiteSessionsMap.get(examId);
        delete oldV2Session.suiteResults[0].metadata.submissionId;
        delete oldV2Session.finalizeRecord.suiteEntries[0].metadata;
        assert.strictEqual(await app.handlePracticeComplete(examId, payload, sourceWindow), true);
        outcome = sourceWindow._messages.filter(message => message && /^PRACTICE_SUBMIT_/.test(message.type)).at(-1);
        assert.strictEqual(outcome.type, 'PRACTICE_SUBMIT_ACK');
        assert.strictEqual(saveAttempts, 2, 'retry must re-attempt the failed aggregate save exactly once');
        assert.strictEqual(app.multiSuiteSessionsMap.get(examId), oldV2Session, '旧 v2 frozen 必须保留 recovery 作为 durable receipt');
    }

    // Case 3.0.3a: legacy payload 的 finalizing 重试只能收敛原 frozen aggregate
    {
        const app = createApp(windowStub);
        let saveAttempts = 0;
        app._saveSuitePracticeRecord = async () => {
            saveAttempts += 1;
            if (saveAttempts === 1) throw new Error('expected legacy multi-suite save failure');
        };
        const payload = {
            suiteId: 'set-1',
            totalSuites: 1,
            answers: { q1: 'A' },
            answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
        };
        assert.strictEqual(await app.handleMultiSuitePracticeComplete('listening-multi-legacy-retry', payload), false);
        assert.strictEqual(await app.handleMultiSuitePracticeComplete('listening-multi-legacy-retry', payload), true);
        assert.strictEqual(saveAttempts, 2, 'legacy retry 只能重放一次原 frozen aggregate，不能创建新 session 再聚合');
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

    // Case 3.0.4a: suiteId multi-suite partial results must restore into a new app instance
    {
        const examId = 'listening-100-p1_set1';
        const app = createApp(windowStub);
        app.initializeSuiteMode();

        const handled = await app.handleSuitePracticeComplete(examId, {
            suiteId: 'set-1',
            totalSuites: 2,
            sessionId: 'multi-suite-child-session-1',
            answers: { q1: 'A' },
            correctAnswers: { q1: 'A' },
            answerComparison: {
                q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true }
            },
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 },
            duration: 42
        });

        assert.strictEqual(handled, true, 'multi-suite 部分结果应成功处理');
        const mirrored = windowSessionStore.get('multi-suite-practice');
        assert.strictEqual(mirrored.schema, 'multi-suite-sessions-v2', 'multi-suite 应写入 v2 恢复快照');
        assert.strictEqual(mirrored.version, 2, 'multi-suite 恢复快照版本必须为 v2');
        const mirroredSession = mirrored.sessions.find((session) => session.baseExamId === 'listening-100-p1');
        assert(mirroredSession, '部分结果应保留目标 multi-suite 会话');
        assert.strictEqual(mirroredSession.suiteResults.length, 1, '部分结果应写入 suiteResults');
        assert.strictEqual(mirroredSession.suiteResults[0].suiteId, 'set-1', '恢复快照应保留 suiteId');
        const durableSession = recoveryControl.events
            .filter((event) => event.type === 'save' && event.value.schema === 'multi-suite-sessions-v2')
            .at(-1)?.value;
        assert(durableSession, '部分结果必须写入 AppData v2 activeSession');
        assert.strictEqual(durableSession.sessions[0].suiteResults.length, 1);

        windowSessionStore.delete('multi-suite-practice');
        const restoredApp = createApp(windowStub);
        restoredApp.initializeSuiteMode();
        await restoredApp._ensureSuiteRecoveryReady();
        const restoredSession = restoredApp.multiSuiteSessionsMap.get('listening-100-p1');
        assert(restoredSession, '没有窗口镜像时仍应从 v2 恢复 multi-suite 会话');
        assert.strictEqual(restoredSession.status, 'active', '部分恢复会话应保持 active');
        assert.strictEqual(restoredSession.expectedSuiteCount, 2, '恢复会话应保留 expectedSuiteCount');
        assert.strictEqual(restoredSession.suiteResults.length, 1, '恢复会话应保留部分结果');
        assert.deepStrictEqual(
            plain(restoredSession.suiteResults[0].answerComparison),
            { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
            '恢复会话应保留结果比较数据'
        );

        const retryApp = createApp(windowStub);
        const retryPayload = {
            suiteId: 'set-1',
            totalSuites: 2,
            sessionId: 'multi-suite-retry-child',
            answers: { q1: 'B' },
            answerComparison: { q1: { userAnswer: 'B', correctAnswer: 'B', isCorrect: true } },
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
        };
        const saveEventStart = recoveryControl.events.length;
        recoveryControl.saveQueue.push(false);
        assert.strictEqual(
            await retryApp.handleMultiSuitePracticeComplete('listening-retry-p1_set1', retryPayload),
            false,
            'durable receipt 未确认时部分结果必须 NACK'
        );
        const refreshedAfterNack = createApp(windowStub);
        refreshedAfterNack.initializeSuiteMode();
        await refreshedAfterNack._ensureSuiteRecoveryReady();
        assert.strictEqual(
            refreshedAfterNack.multiSuiteSessionsMap.has('listening-retry-p1'),
            false,
            'v2 枚举成功后不得从 window WAL 恢复未提交结果'
        );
        assert.strictEqual(
            await retryApp.handleMultiSuitePracticeComplete('listening-retry-p1_set1', retryPayload),
            true,
            '相同结果重试必须再次尝试 durable save'
        );
        assert.strictEqual(
            recoveryControl.events.slice(saveEventStart).filter((event) => (
                event.type === 'save'
                && event.value.schema === 'multi-suite-sessions-v2'
                && event.value.sessions[0].baseExamId === 'listening-retry-p1'
            )).length,
            2,
            '内存中已存在结果不能绕过未完成的 v2 写入'
        );
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

    // Case 3.0.6.1: durable recovery 清理后，v2 聚合记录仍是精确提交的幂等收据
    {
        const app = createApp(windowStub);
        await app._ensureSuiteRecoveryReady();
        const examId = 'listening-multi-canonical-receipt_set1';
        const payload = {
            suiteId: 'set-1',
            totalSuites: 1,
            sessionId: 'multi-canonical-child',
            submissionId: 'multi-canonical-submission',
            answers: { q1: 'A' },
            answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
        };

        assert.strictEqual(await app.handleMultiSuitePracticeComplete(examId, payload), true);
        assert.strictEqual(app.multiSuiteSessionsMap.has('listening-multi-canonical-receipt'), false, 'cleanup 成功后 runtime recovery 应释放');
        const committed = await windowStub.AppData.practice.list({ projection: 'detail' });
        assert.strictEqual(committed.length, 1);
        assert.strictEqual(committed[0].suiteEntries[0].metadata.sessionId, payload.sessionId);
        assert.strictEqual(committed[0].suiteEntries[0].metadata.submissionId, payload.submissionId);

        const refreshed = createApp(windowStub);
        refreshed.initializeSuiteMode();
        await refreshed._ensureSuiteRecoveryReady();
        assert.strictEqual(await refreshed.handleMultiSuitePracticeComplete(examId, payload), true, '刷新后的精确重放必须由 canonical 记录 ACK');
        assert.strictEqual((await windowStub.AppData.practice.list({ projection: 'detail' })).length, 1, 'canonical 重放不能生成第二条聚合记录');

        const concurrentApp = createApp(windowStub);
        const originalFinalizeSuite = windowStub.AppData.practice.finalizeSuite;
        let finalizeCalls = 0;
        windowStub.AppData.practice.finalizeSuite = async (...args) => {
            finalizeCalls += 1;
            return originalFinalizeSuite(...args);
        };
        try {
            assert.deepStrictEqual(
                await Promise.all([
                    concurrentApp.handleMultiSuitePracticeComplete('listening-multi-concurrent_set1', payload),
                    concurrentApp.handleMultiSuitePracticeComplete('listening-multi-concurrent_set1', payload)
                ]),
                [true, true],
                '完整 triple 的并发重放必须得到相同 ACK'
            );
        } finally {
            windowStub.AppData.practice.finalizeSuite = originalFinalizeSuite;
        }
        assert.strictEqual(finalizeCalls, 1, '并发精确重放只能生成一次 canonical aggregate');
    }

    // Case 3.0.6.2: completed multi-suite 只拥有原提交重放，不能吞掉同 base 的下一次运行
    {
        const app = createApp(windowStub);
        await app._ensureSuiteRecoveryReady();
        const examId = 'listening-multi-owner_set1';
        const aggregateRecords = new Map();
        const saveAttempts = [];
        app._saveSuitePracticeRecord = async (record) => {
            saveAttempts.push(plain(record));
            aggregateRecords.set(record.operationId, plain(record));
        };
        const originalDiscard = windowStub.AppData.recovery.discardActiveSession;
        const discardCalls = [];
        windowStub.AppData.recovery.discardActiveSession = async (id, options) => {
            discardCalls.push({ id: String(id), options: plain(options || {}) });
            return { committed: false };
        };
        const firstPayload = {
            suiteId: 'set-1',
            totalSuites: 1,
            sessionId: 'multi-owner-child',
            submissionId: 'multi-owner-submission-1',
            answers: { q1: 'A' },
            answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 },
            spellingErrors: [{ word: 'practice', userInput: 'practise' }]
        };
        const completedSession = app.getOrCreateMultiSuiteSession(examId);

        try {
            assert.strictEqual(await app.handleMultiSuitePracticeComplete(examId, firstPayload), true);
            assert.strictEqual(aggregateRecords.size, 1, '首次运行只能生成一条聚合记录');
            assert.strictEqual(saveAttempts.length, 1, '首次运行只能提交一次 aggregate');
            assert.strictEqual(discardCalls.length, 1, 'aggregate 成功后必须尝试清理 durable recovery');
            assert.strictEqual(discardCalls[0].id, completedSession.id, 'durable cleanup 必须针对已完成会话');
            assert.strictEqual(app.multiSuiteSessionsMap.get(completedSession.baseExamId), completedSession, 'durable cleanup 失败时应保留完成态作为重放收据');

            // durable recovery 在 aggregate commit 与 cleanup 之间只可能恢复到 finalizing；
            // 必须先用原 operationId 收敛旧记录，再解释当前 submission。
            completedSession.status = 'finalizing';
            app.multiSuiteSessionsMap.set(completedSession.baseExamId, completedSession);
            assert.strictEqual(await app.handleMultiSuitePracticeComplete(examId, firstPayload), true, 'finalizing 原 submission 必须幂等收敛');
            assert.strictEqual(aggregateRecords.size, 1, 'finalizing 重放不能创建第二条聚合记录');
            assert.strictEqual(saveAttempts.length, 2, 'finalizing 重放必须再次提交原 frozen aggregate');
            assert.deepStrictEqual(saveAttempts[1], saveAttempts[0], 'finalizing 重放的 aggregate 必须保持字节语义稳定');

            const oldV2Snapshot = plain(completedSession);
            oldV2Snapshot.status = 'finalizing';
            delete oldV2Snapshot.suiteResults[0].metadata.submissionId;
            delete oldV2Snapshot.finalizeRecord.suiteEntries[0].metadata;
            oldV2Snapshot.finalizeRecord.spellingErrors[0].timestamp += 1;
            assert.strictEqual(app._isValidMultiSuiteRecoverySnapshot({
                schema: 'multi-suite-sessions-v2', version: 2, sessions: [oldV2Snapshot]
            }), true, '升级前缺少 entry metadata 的 v2 frozen snapshot 仍应可恢复');

            // 模拟旧实现中 cleanup 失败后残留的 completed runtime session。
            app.multiSuiteSessionsMap.set(completedSession.baseExamId, completedSession);
            assert.strictEqual(await app.handleMultiSuitePracticeComplete(examId, firstPayload), true, '原 submission 重放必须幂等成功');
            assert.strictEqual(aggregateRecords.size, 1, '原 submission 重放不能重复聚合');
            assert.strictEqual(saveAttempts.length, 2, 'completed 原 submission 重放不能再次调用 aggregate 保存');

            const nextPayload = {
                ...firstPayload,
                submissionId: 'multi-owner-submission-2',
                answers: { q1: 'B' },
                answerComparison: { q1: { userAnswer: 'B', correctAnswer: 'B', isCorrect: true } }
            };
            assert.strictEqual(await app.handleMultiSuitePracticeComplete(examId, nextPayload), true, '新 submission 必须创建新运行');
            assert.strictEqual(aggregateRecords.size, 2, '同 base 的下一次运行必须生成独立聚合记录');
            assert.strictEqual(saveAttempts.length, 3, '下一次运行必须只新增一次 aggregate 保存');
            const records = Array.from(aggregateRecords.values());
            assert.notStrictEqual(records[0].id, records[1].id, '两次运行必须使用不同 multi-suite session id');
            assert.strictEqual(records[1].answers['set-1::q1'], 'B', '新聚合必须包含下一次运行的答案');
            assert.strictEqual(records[1].suiteEntries.length, 1, '新聚合不能混入旧运行结果');
            assert.strictEqual(records[1].scoreInfo.total, 1, '新聚合分数只能来自当前运行');
            assert.strictEqual(records[1].suiteEntries[0].rawData.submissionId, nextPayload.submissionId, '新聚合必须归属当前 submission');

            const nextChildPayload = {
                ...nextPayload,
                sessionId: 'multi-owner-child-2',
                answers: { q1: 'C' },
                answerComparison: { q1: { userAnswer: 'C', correctAnswer: 'C', isCorrect: true } }
            };
            assert.strictEqual(await app.handleMultiSuitePracticeComplete(examId, nextChildPayload), true, '不同 child session 必须创建新运行');
            assert.strictEqual(aggregateRecords.size, 3, '不同 child session 不能被误判为 completed 重放');
            assert.strictEqual(saveAttempts.length, 4, '不同 child session 必须只新增一次 aggregate 保存');
            assert.strictEqual(Array.from(aggregateRecords.values())[2].answers['set-1::q1'], 'C');

            completedSession.status = 'finalizing';
            completedSession.finalizeOperationId = 'wrong-operation-id';
            app.multiSuiteSessionsMap.set(completedSession.baseExamId, completedSession);
            assert.strictEqual(await app.handleMultiSuitePracticeComplete(examId, firstPayload), false, '错配 operationId 的 frozen aggregate 必须 fail closed');
            assert.strictEqual(saveAttempts.length, 4, '错配 operationId 不能触发 aggregate 保存');

            completedSession.finalizeOperationId = completedSession.finalizeRecord.operationId;
            completedSession.finalizeRecord.spellingErrors = [];
            assert.strictEqual(await app.handleMultiSuitePracticeComplete(examId, firstPayload), false, '损坏的顶层拼写汇总必须 fail closed');
            assert.strictEqual(saveAttempts.length, 4, '损坏的拼写汇总不能调用保存');

            completedSession.finalizeRecord = plain(saveAttempts[0]);
            completedSession.finalizeOperationId = completedSession.finalizeRecord.operationId;
            completedSession.suiteResults[0].answers.q1 = 'tampered';
            app.multiSuiteSessionsMap.set(completedSession.baseExamId, completedSession);
            assert.strictEqual(
                await app.handleMultiSuitePracticeComplete(examId, firstPayload),
                false,
                '不一致的 frozen aggregate 必须 fail closed，不能复用 operationId 重建'
            );
            assert.strictEqual(aggregateRecords.size, 3, '损坏 frozen aggregate 不能写入新记录');
            assert.strictEqual(saveAttempts.length, 4, '损坏 frozen aggregate 不能调用保存');
            app.multiSuiteSessionsMap.delete(completedSession.baseExamId);
        } finally {
            windowStub.AppData.recovery.discardActiveSession = originalDiscard;
            for (const record of aggregateRecords.values()) {
                await originalDiscard(record.id);
            }
        }
    }

    // Case 3.0.6.3: finalizing 必须携带 frozen pair；同一 active suite 的不同提交不能误 ACK
    {
        const app = createApp(windowStub);
        await app._ensureSuiteRecoveryReady();
        const examId = 'listening-multi-active-conflict_set1';
        const firstPayload = {
            suiteId: 'set-1',
            totalSuites: 2,
            sessionId: 'multi-active-child',
            submissionId: 'multi-active-submission-1',
            answers: { q1: 'A' },
            answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
        };
        assert.strictEqual(await app.handleMultiSuitePracticeComplete(examId, firstPayload), true);
        const session = app.multiSuiteSessionsMap.get('listening-multi-active-conflict');
        assert.strictEqual(await app.handleMultiSuitePracticeComplete(examId, {
            ...firstPayload,
            submissionId: 'multi-active-submission-2',
            answers: { q1: 'B' }
        }), false, '同一 active suite 的不同 submission 不能 ACK 未持久化答案');
        assert.strictEqual(session.suiteResults.length, 1);
        assert.strictEqual(session.suiteResults[0].answers.q1, 'A');

        const missingFrozen = plain(session);
        missingFrozen.status = 'finalizing';
        missingFrozen.finalizeOperationId = null;
        missingFrozen.finalizeRecord = null;
        assert.strictEqual(await app.finalizeMultiSuiteRecord(missingFrozen), false, 'finalizing 缺少 frozen pair 必须 fail closed');
        assert.strictEqual(app._isValidMultiSuiteRecoverySnapshot({
            schema: 'multi-suite-sessions-v2',
            version: 2,
            sessions: [missingFrozen]
        }), false, '缺少 frozen pair 的 finalizing recovery 不能进入运行态');
        await windowStub.AppData.recovery.discardActiveSession(session.id);
        app.multiSuiteSessionsMap.delete(session.baseExamId);
    }

    // Case 3.0.6.4: 恢复的 active-complete 会话（finalize 前崩溃窗口）须先幂等收敛，
    // 再让同 base 新一轮继续，而不是被已记录的同 suiteId 阻塞 NACK。
    {
        const app = createApp(windowStub);
        await app._ensureSuiteRecoveryReady();
        const examId = 'listening-multi-active-complete_set1';

        // 直接构造 active-complete 会话（结果已齐、无 frozen record）。
        // 真实崩溃窗口：最后一次 _commitMultiSuiteRecovery 已把 active 状态写入 durable，
        // finalize 尚未执行。因此 durable 与 WAL 都存在，durable 为权威。
        const result = {
            suiteId: 'set-1',
            examId: examId,
            answers: { q1: 'A' },
            correctAnswers: { q1: 'A' },
            answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 },
            spellingErrors: [],
            timestamp: Date.now(),
            duration: 10,
            metadata: { sessionId: 'multi-active-complete-child', submissionId: 'multi-active-complete-sub-1' },
            rawData: null
        };
        const activeCompleteSession = {
            id: 'multi_listening-multi-active-complete_crash_1',
            baseExamId: 'listening-multi-active-complete',
            status: 'active',
            startTime: Date.now(),
            suiteResults: [result],
            expectedSuiteCount: 1,
            metadata: { source: 'p1', createdAt: new Date().toISOString() },
            lastUpdate: Date.now(),
            revision: 1
        };
        const durableSnap = {
            schema: 'multi-suite-sessions-v2',
            version: 2,
            id: activeCompleteSession.id,
            revision: 1,
            sessions: [activeCompleteSession],
            updatedAt: Date.now()
        };
        await windowStub.AppData.recovery.saveActiveSession(durableSnap);
        windowSessionStore.set('multi-suite-practice', durableSnap);

        const restoredApp = createApp(windowStub);
        restoredApp.initializeSuiteMode();
        await restoredApp._ensureSuiteRecoveryReady();
        const restored = restoredApp.multiSuiteSessionsMap.get('listening-multi-active-complete');
        assert(restored, 'active-complete durable 快照应可恢复');
        assert.strictEqual(restored.status, 'active');

        // 新一轮同 suiteId、新身份：应触发收敛 finalize 旧会话，再接纳新结果。
        const aggregateRecords = [];
        restoredApp._saveSuitePracticeRecord = async (record) => { aggregateRecords.push(record); };
        const newPayload = {
            suiteId: 'set-1',
            totalSuites: 1,
            sessionId: 'multi-active-complete-new-child',
            submissionId: 'multi-active-complete-sub-2',
            answers: { q1: 'B' },
            answerComparison: { q1: { userAnswer: 'B', correctAnswer: 'B', isCorrect: true } },
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
        };
        assert.strictEqual(
            await restoredApp.handleMultiSuitePracticeComplete(examId, newPayload),
            true,
            'active-complete 恢复后同 suiteId 新提交不得被 NACK'
        );
        // 旧 active-complete 会话先收敛为一条聚合记录；随后新一轮完成自己的一条。
        assert.strictEqual(aggregateRecords.length, 2, '旧会话收敛 + 新一轮完成各生成一条记录');
        const firstRecord = aggregateRecords[0];
        assert.strictEqual(firstRecord.suiteEntries.length, 1, '收敛记录应包含旧结果');
        const secondRecord = aggregateRecords[1];
        assert.strictEqual(secondRecord.suiteEntries[0].answers.q1, 'B', '新一轮结果应聚合进第二条记录');
        if (restored && restored.id) {
            await windowStub.AppData.recovery.discardActiveSession(restored.id);
        }
        restoredApp.multiSuiteSessionsMap.delete('listening-multi-active-complete');
    }

    // Case 3.0.6.5: 损坏 durable + 有效 window-WAL 同时存在时，恢复须保留 WAL 回退；
    // 而 durable 完全不存在（save 从未成功）时仍丢弃 WAL（未提交结果不恢复）。
    {
        const app = createApp(windowStub);
        await app._ensureSuiteRecoveryReady();
        const examId = 'listening-multi-corrupt-durable_set1';
        const payload = {
            suiteId: 'set-1',
            totalSuites: 2,
            sessionId: 'multi-corrupt-child',
            submissionId: 'multi-corrupt-sub-1',
            answers: { q1: 'A' },
            answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
        };
        assert.strictEqual(await app.handleMultiSuitePracticeComplete(examId, payload), true);
        const session = app.multiSuiteSessionsMap.get('listening-multi-corrupt-durable');

        // 保留 WAL，同时写入一个损坏的 durable（结构合法但校验失败：finalizeOperationId 错配）。
        const corruptDurable = plain(session);
        corruptDurable.finalizeOperationId = 'practice-multisuite:wrong:id:finalize';
        corruptDurable.finalizeRecord = { id: 'stale-record' };
        const corruptDurableRevision = Number(session.revision) + 7;
        await windowStub.AppData.recovery.saveActiveSession({
            schema: 'multi-suite-sessions-v2',
            version: 2,
            id: session.id,
            revision: corruptDurableRevision,
            sessions: [corruptDurable],
            updatedAt: Date.now()
        });

        const restoredApp = createApp(windowStub);
        restoredApp.initializeSuiteMode();
        await restoredApp._ensureSuiteRecoveryReady();
        assert(
            restoredApp.multiSuiteSessionsMap.has('listening-multi-corrupt-durable'),
            '损坏 durable 存在时应保留 window-WAL 回退，不能把有效草稿抹掉'
        );
        const restoredSession = restoredApp.multiSuiteSessionsMap.get('listening-multi-corrupt-durable');
        assert.strictEqual(
            restoredSession._lastDurableRecoveryRevision,
            corruptDurableRevision,
            '匹配的损坏 durable 必须把实体 revision 交给保留的 window-WAL'
        );
        assert.strictEqual(
            restoredSession.revision,
            corruptDurableRevision,
            '保留的 window-WAL 必须追平 durable revision，确保下一次变更可以前进'
        );
        restoredSession.revision += 1;
        recoveryControl.saveQueue.push(async (value, options) => {
            const currentDurable = (await windowStub.AppData.recovery.listActiveSessions())
                .find((item) => String(item && item.id || '') === String(value.id));
            assert.strictEqual(Number(currentDurable && currentDurable.revision), corruptDurableRevision);
            assert.strictEqual(
                options.expectedEntityRevision,
                corruptDurableRevision,
                'WAL 恢复后的下一次保存必须从匹配的 durable revision 做 CAS'
            );
            assert.strictEqual(value.revision, corruptDurableRevision + 1);
            return { committed: true, item: plain(value) };
        });
        assert.strictEqual(
            await restoredApp._commitMultiSuiteRecovery(restoredSession),
            true,
            '继承 durable revision 后的 window-WAL 必须仍可继续保存'
        );
        assert.notStrictEqual(restoredSession._suiteRecoveryWritesBlocked, true);

        for (const [label, invalidRevision] of [['fractional', 1.5], ['infinite', Infinity]]) {
            const invalidRevisionWal = {
                ...plain(restoredSession),
                id: `multi-invalid-revision-${label}`,
                baseExamId: `listening-multi-invalid-revision-${label}`,
                revision: 2,
                _restoredFromWindowSession: true
            };
            delete invalidRevisionWal._lastDurableRecoveryRevision;
            restoredApp.multiSuiteSessionsMap.set(invalidRevisionWal.baseExamId, invalidRevisionWal);
            const invalidRevisionDurable = plain(invalidRevisionWal);
            delete invalidRevisionDurable._restoredFromWindowSession;
            invalidRevisionDurable.finalizeOperationId = 'practice-multisuite:wrong:id:finalize';
            invalidRevisionDurable.finalizeRecord = { id: 'stale-record' };
            restoredApp._restorePersistentMultiSuiteSessions([{
                schema: 'multi-suite-sessions-v2',
                version: 2,
                id: invalidRevisionWal.id,
                revision: invalidRevision,
                sessions: [invalidRevisionDurable]
            }]);
            const retainedWal = restoredApp.multiSuiteSessionsMap.get(invalidRevisionWal.baseExamId);
            assert.strictEqual(retainedWal, invalidRevisionWal);
            assert.strictEqual(retainedWal._lastDurableRecoveryRevision, 0);
            assert.strictEqual(retainedWal.revision, 2);
            retainedWal.revision += 1;
            recoveryControl.saveQueue.push((value, options) => {
                assert.strictEqual(options.expectedEntityRevision, 0);
                assert.strictEqual(value.revision, 3);
                assert.strictEqual(value.sessions[0].revision, 3);
                return { committed: true, item: plain(value) };
            });
            assert.strictEqual(
                await restoredApp._commitMultiSuiteRecovery(retainedWal),
                true,
                `${label} durable revision 必须按 0 修复且不得锁死有效 WAL`
            );
            assert.notStrictEqual(retainedWal._suiteRecoveryWritesBlocked, true);
            restoredApp.multiSuiteSessionsMap.delete(invalidRevisionWal.baseExamId);
        }

        const duplicateIdWal = {
            ...plain(restoredSession),
            id: 'multi-duplicate-id',
            baseExamId: 'listening-multi-duplicate-id',
            revision: 1,
            _restoredFromWindowSession: true
        };
        delete duplicateIdWal._lastDurableRecoveryRevision;
        restoredApp.multiSuiteSessionsMap.set(duplicateIdWal.baseExamId, duplicateIdWal);
        restoredApp._restorePersistentMultiSuiteSessions([3, 9].map((revision, index) => {
            const candidateSession = {
                ...plain(duplicateIdWal),
                revision,
                lastUpdate: 1000 + index
            };
            delete candidateSession._restoredFromWindowSession;
            return {
                schema: 'multi-suite-sessions-v2',
                version: 2,
                id: duplicateIdWal.id,
                revision,
                sessions: [candidateSession],
                updatedAt: 1000 + index
            };
        }));
        const restoredDuplicate = restoredApp.multiSuiteSessionsMap.get(duplicateIdWal.baseExamId);
        assert.strictEqual(
            restoredDuplicate._lastDurableRecoveryRevision,
            3,
            '重复 active-session id 必须继承 AppData CAS 实际使用的首项 revision'
        );
        assert.strictEqual(restoredDuplicate.revision, 3);
        restoredApp.multiSuiteSessionsMap.delete(duplicateIdWal.baseExamId);

        const durableOwnerId = 'multi-valid-durable-owner';
        const conflictingWal = {
            ...plain(restoredDuplicate),
            id: durableOwnerId,
            baseExamId: 'listening-valid-owner-window-wal',
            revision: 2,
            _restoredFromWindowSession: true
        };
        delete conflictingWal._lastDurableRecoveryRevision;
        restoredApp.multiSuiteSessionsMap.set(conflictingWal.baseExamId, conflictingWal);
        const durableOwnedSession = {
            ...plain(restoredDuplicate),
            id: durableOwnerId,
            baseExamId: 'listening-valid-owner-durable',
            revision: 6,
            lastUpdate: Date.now() + 100
        };
        delete durableOwnedSession._restoredFromWindowSession;
        delete durableOwnedSession._lastDurableRecoveryRevision;
        restoredApp._restorePersistentMultiSuiteSessions([{
            schema: 'multi-suite-sessions-v2',
            version: 2,
            id: durableOwnerId,
            revision: 6,
            sessions: [durableOwnedSession],
            updatedAt: Date.now() + 100
        }]);
        assert.strictEqual(
            restoredApp.multiSuiteSessionsMap.has(conflictingWal.baseExamId),
            false,
            'a valid durable entity must evict a different-base WAL that reuses its exact CAS id'
        );
        const restoredDurableOwner = restoredApp.multiSuiteSessionsMap.get(durableOwnedSession.baseExamId);
        assert(restoredDurableOwner, 'the valid durable owner must still be restored');
        assert.strictEqual(restoredDurableOwner.id, durableOwnerId);
        assert.strictEqual(restoredDurableOwner._lastDurableRecoveryRevision, 6);
        assert.strictEqual(
            Array.from(restoredApp.multiSuiteSessionsMap.values())
                .filter((item) => item && String(item.id || '') === durableOwnerId)
                .length,
            1,
            'one AppData identity must produce only one live multi-suite session'
        );
        restoredApp.multiSuiteSessionsMap.delete(durableOwnedSession.baseExamId);

        const canonicalOwnerId = 'multi-valid-durable-canonical-owner';
        const canonicalBaseExamId = 'listening-valid-owner-canonical';
        const rawWalBaseExamId = ` ${canonicalBaseExamId} `;
        const nonCanonicalWal = {
            ...plain(restoredDurableOwner),
            id: canonicalOwnerId,
            baseExamId: rawWalBaseExamId,
            revision: 2,
            _restoredFromWindowSession: true
        };
        delete nonCanonicalWal._lastDurableRecoveryRevision;
        restoredApp.multiSuiteSessionsMap.set(rawWalBaseExamId, nonCanonicalWal);
        const canonicalDurableSession = {
            ...plain(restoredDurableOwner),
            id: canonicalOwnerId,
            baseExamId: rawWalBaseExamId,
            revision: 7,
            lastUpdate: Date.now() + 200
        };
        delete canonicalDurableSession._restoredFromWindowSession;
        delete canonicalDurableSession._lastDurableRecoveryRevision;
        restoredApp._restorePersistentMultiSuiteSessions([{
            schema: 'multi-suite-sessions-v2',
            version: 2,
            id: canonicalOwnerId,
            revision: 7,
            sessions: [canonicalDurableSession],
            updatedAt: Date.now() + 200
        }]);
        assert.strictEqual(
            restoredApp.multiSuiteSessionsMap.has(rawWalBaseExamId),
            false,
            'a non-canonical WAL key must not coexist with the canonical durable base'
        );
        assert(restoredApp.multiSuiteSessionsMap.has(canonicalBaseExamId));
        assert.strictEqual(
            restoredApp.multiSuiteSessionsMap.get(canonicalBaseExamId).baseExamId,
            canonicalBaseExamId,
            'durable restore must canonicalize both the Map key and the session property'
        );
        assert.strictEqual(
            Array.from(restoredApp.multiSuiteSessionsMap.values())
                .filter((item) => item && String(item.id || '') === canonicalOwnerId)
                .length,
            1,
            'canonicalization differences must not duplicate one CAS identity'
        );
        restoredApp.multiSuiteSessionsMap.delete(canonicalBaseExamId);

        const competingBaseExamId = 'listening-valid-owner-competing-id';
        const competingWal = {
            ...plain(restoredDurableOwner),
            id: 'multi-window-owner-competing-id',
            baseExamId: ` ${competingBaseExamId} `,
            revision: 2,
            _restoredFromWindowSession: true
        };
        delete competingWal._lastDurableRecoveryRevision;
        restoredApp.multiSuiteSessionsMap.set(competingWal.baseExamId, competingWal);
        const competingDurable = {
            ...plain(restoredDurableOwner),
            id: 'multi-durable-owner-competing-id',
            baseExamId: competingBaseExamId,
            revision: 8,
            lastUpdate: Date.now() + 300
        };
        delete competingDurable._restoredFromWindowSession;
        delete competingDurable._lastDurableRecoveryRevision;
        restoredApp._restorePersistentMultiSuiteSessions([{
            schema: 'multi-suite-sessions-v2',
            version: 2,
            id: competingDurable.id,
            revision: 8,
            sessions: [competingDurable],
            updatedAt: Date.now() + 300
        }]);
        assert.strictEqual(
            restoredApp.multiSuiteSessionsMap.get(competingBaseExamId).id,
            competingDurable.id,
            'a valid durable candidate must replace a canonical-base WAL even when their CAS ids differ'
        );
        assert.strictEqual(
            Array.from(restoredApp.multiSuiteSessionsMap.values())
                .some((item) => item && item.id === competingWal.id),
            false,
            'the whitespace WAL alias must not remain as a second live base entry'
        );
        restoredApp.multiSuiteSessionsMap.delete(competingBaseExamId);

        const crossSchemaWal = {
            id: 'cross-schema-duplicate-id',
            baseExamId: 'listening-cross-schema-duplicate',
            revision: 1,
            _restoredFromWindowSession: true
        };
        restoredApp.multiSuiteSessionsMap.set(crossSchemaWal.baseExamId, crossSchemaWal);
        const laterMultiSuiteItem = {
            ...plain(restoredDuplicate),
            id: crossSchemaWal.id,
            baseExamId: crossSchemaWal.baseExamId,
            revision: 9
        };
        restoredApp._restorePersistentMultiSuiteSessions([{
            schema: 'suite-session-v2',
            version: 2,
            id: crossSchemaWal.id,
            revision: 4
        }, {
            schema: 'multi-suite-sessions-v2',
            version: 2,
            id: crossSchemaWal.id,
            revision: 9,
            sessions: [laterMultiSuiteItem]
        }]);
        assert.strictEqual(
            restoredApp.multiSuiteSessionsMap.has(crossSchemaWal.baseExamId),
            false,
            '同 ID 的 AppData 首项属于其他 schema 时，后项 multi-suite 不得声明 CAS 所有权'
        );

        const shadowedMarkerId = 'cross-schema-shadowed-marker';
        const shadowedMarkerBase = 'listening-cross-schema-shadowed-marker';
        const safeFallbackWal = {
            ...plain(restoredSession),
            id: 'safe-fallback-wal-id',
            baseExamId: ` ${shadowedMarkerBase} `,
            revision: 2,
            _restoredFromWindowSession: true
        };
        delete safeFallbackWal._lastDurableRecoveryRevision;
        restoredApp.multiSuiteSessionsMap.set(safeFallbackWal.baseExamId, safeFallbackWal);
        const corruptShadowedMarker = {
            ...plain(restoredSession),
            id: shadowedMarkerId,
            baseExamId: shadowedMarkerBase,
            revision: 9,
            finalizeOperationId: 'practice-multisuite:wrong:id:finalize',
            finalizeRecord: { id: 'stale-record' }
        };
        delete corruptShadowedMarker._restoredFromWindowSession;
        delete corruptShadowedMarker._lastDurableRecoveryRevision;
        restoredApp._restorePersistentMultiSuiteSessions([{
            schema: 'suite-session-v2',
            version: 2,
            id: shadowedMarkerId,
            revision: 4
        }, {
            schema: 'multi-suite-sessions-v2',
            version: 2,
            id: shadowedMarkerId,
            revision: 9,
            sessions: [corruptShadowedMarker]
        }]);
        assert.strictEqual(
            restoredApp.multiSuiteSessionsMap.get(shadowedMarkerBase),
            safeFallbackWal,
            'a corrupt durable base marker must retain a different safe WAL id even when its own id is shadowed'
        );
        assert.strictEqual(safeFallbackWal.baseExamId, shadowedMarkerBase);
        assert.strictEqual(safeFallbackWal._lastDurableRecoveryRevision, undefined);
        restoredApp.multiSuiteSessionsMap.delete(shadowedMarkerBase);

        const exactIdWal = {
            id: 'multi-exact-id',
            baseExamId: 'listening-multi-exact-id',
            revision: 2,
            _restoredFromWindowSession: true
        };
        restoredApp.multiSuiteSessionsMap.set(exactIdWal.baseExamId, exactIdWal);
        restoredApp._restorePersistentMultiSuiteSessions([{
            schema: 'multi-suite-sessions-v2',
            version: 2,
            id: `${exactIdWal.id} `,
            revision: 8,
            sessions: [{ baseExamId: exactIdWal.baseExamId }]
        }]);
        assert.strictEqual(
            exactIdWal._lastDurableRecoveryRevision,
            undefined,
            'active-session id 必须按 AppData 原始字符串精确匹配，不能 trim 后借用 revision'
        );
        assert.strictEqual(exactIdWal.revision, 2);
        restoredApp.multiSuiteSessionsMap.delete(exactIdWal.baseExamId);

        const mismatchedOwnerWal = {
            ...plain(restoredSession),
            id: 'multi-nested-owner',
            baseExamId: 'listening-multi-mismatched-owner',
            revision: 2,
            _restoredFromWindowSession: true
        };
        delete mismatchedOwnerWal._lastDurableRecoveryRevision;
        restoredApp.multiSuiteSessionsMap.set(mismatchedOwnerWal.baseExamId, mismatchedOwnerWal);
        const mismatchedDurableSession = plain(mismatchedOwnerWal);
        delete mismatchedDurableSession._restoredFromWindowSession;
        restoredApp._restorePersistentMultiSuiteSessions([{
            schema: 'multi-suite-sessions-v2',
            version: 2,
            id: 'multi-top-level-owner',
            revision: 11,
            sessions: [mismatchedDurableSession]
        }]);
        assert.strictEqual(
            restoredApp.multiSuiteSessionsMap.get(mismatchedOwnerWal.baseExamId),
            mismatchedOwnerWal,
            '顶层 CAS 实体与 nested session id 错配时不得覆盖同 base 的 window-WAL'
        );
        assert.strictEqual(mismatchedOwnerWal._lastDurableRecoveryRevision, undefined);
        restoredApp.multiSuiteSessionsMap.delete(mismatchedOwnerWal.baseExamId);

        await windowStub.AppData.recovery.discardActiveSession(session.id);
        restoredApp.multiSuiteSessionsMap.delete('listening-multi-corrupt-durable');
    }

    // Case 3.0.6.6: multi-suite recovery 收到 stale receipt 后必须置 write-block，
    // 后续提交短路，避免用同一旧 revision 无限重试并反复 NACK 合法提交（F3）。
    {
        const app = createApp(windowStub);
        await app._ensureSuiteRecoveryReady();
        const session = {
            id: 'multi-writeblock-session',
            baseExamId: 'listening-multi-writeblock',
            status: 'active',
            startTime: Date.now(),
            suiteResults: [],
            expectedSuiteCount: 1,
            metadata: { source: 'p1' },
            lastUpdate: Date.now(),
            revision: 2,
            _lastDurableRecoveryRevision: 1
        };
        app.multiSuiteSessionsMap.set(session.baseExamId, session);

        const saveEventsBefore = recoveryControl.events.filter((event) => event.type === 'save').length;
        recoveryControl.saveQueue.push(() => ({ committed: false, code: 'STALE_RECOVERY_WRITE' }));
        assert.strictEqual(
            await app._commitMultiSuiteRecovery(session),
            false,
            'stale receipt 时 multi-suite recovery 提交必须失败'
        );
        assert.strictEqual(
            session._suiteRecoveryWritesBlocked,
            true,
            'stale receipt 后 multi-suite session 必须置 write-block'
        );

        // write-block 后不应再向 AppData 发起任何持久化提交。
        const saveEventsMid = recoveryControl.events.filter((event) => event.type === 'save').length;
        assert.strictEqual(
            await app._commitMultiSuiteRecovery(session),
            false,
            'write-block 后提交必须短路返回 false'
        );
        const saveEventsAfter = recoveryControl.events.filter((event) => event.type === 'save').length;
        assert.strictEqual(
            saveEventsAfter,
            saveEventsMid,
            'write-block 后不得再调用 saveActiveSession'
        );
        assert(saveEventsAfter > saveEventsBefore, 'stale receipt 必须确实触发过一次持久化提交');

        app.multiSuiteSessionsMap.delete(session.baseExamId);
        await windowStub.AppData.recovery.discardActiveSession(session.id);
    }

    // Case 3.0.6.7: 已完成的套题会话关闭末篇子页时，不得把末篇标成 interrupted（H1）。
    {
        const app = createApp(windowStub);
        const suite = makeSession('suite_completed_close');
        suite.status = 'completed';
        const child = suite.windowRef;
        app.currentSuiteSession = suite;
        app.suiteExamMap = new Map(suite.sequence.map((item) => [item.examId, suite.id]));
        app.examWindows = new Map([['reading-p1', { window: child, suiteSessionId: suite.id }]]);
        const statusUpdates = [];
        app.updateExamStatus = (examId, status) => { statusUpdates.push({ examId, status }); };
        const cleanupCalls = [];
        app.cleanupExamSession = async (examId) => { cleanupCalls.push(examId); };

        assert.strictEqual(await app.handleExamWindowClosed('reading-p1', child), true);
        assert.strictEqual(
            statusUpdates.some((update) => update.examId === 'reading-p1' && update.status === 'completed'),
            true,
            'completed 套题关闭末篇必须标记 completed 而非 interrupted'
        );
        assert.strictEqual(
            statusUpdates.some((update) => update.status === 'interrupted'),
            false,
            'completed 套题关闭末篇不得落为 interrupted'
        );
        assert.strictEqual(cleanupCalls.includes('reading-p1'), true, 'completed 套题关闭后必须清理 exam session');
        app.examWindows.delete('reading-p1');
    }

    // Case 3.0.7: stale completed-session teardown must not own a newer session
    {
        const app = createApp(windowStub);
        const staleSession = makeSession('suite_stale_completed');
        staleSession.status = 'completed';
        staleSession._suiteGeneration = 1;
        const freshSession = makeSession('suite_fresh_started');
        freshSession.status = 'active';
        freshSession._suiteGeneration = 2;
        freshSession.windowRef = createStubWindow('suite-fresh-window');

        app.currentSuiteSession = freshSession;
        app.suiteExamMap = new Map(freshSession.sequence.map(item => [item.examId, freshSession.id]));
        app._mirrorSessionToStorage(freshSession);
        const freshSnapshot = plain(windowSessionStore.get('simulation'));
        const freshWindow = freshSession.windowRef;
        let scheduledTeardown = null;
        let discardCalls = 0;
        const originalSetTimeout = sandbox.setTimeout;
        const originalClearTimeout = sandbox.clearTimeout;
        const originalDiscard = windowStub.AppData.recovery.windowSession.discard;

        sandbox.setTimeout = (callback) => {
            scheduledTeardown = callback;
            return { unref() {} };
        };
        sandbox.clearTimeout = () => {};
        windowStub.AppData.recovery.windowSession.discard = (...args) => {
            discardCalls += 1;
            return originalDiscard(...args);
        };

        try {
            assert.strictEqual(app._scheduleSuiteSubmitTeardown(staleSession), true, '旧 session 应成功注册延迟清理');
            assert.strictEqual(typeof scheduledTeardown, 'function', '应捕获延迟清理回调');
            scheduledTeardown();
            await Promise.resolve();
        } finally {
            sandbox.setTimeout = originalSetTimeout;
            sandbox.clearTimeout = originalClearTimeout;
            windowStub.AppData.recovery.windowSession.discard = originalDiscard;
        }

        assert.strictEqual(app.currentSuiteSession, freshSession, '旧 session teardown 不得替换新 session');
        assert.strictEqual(freshWindow.closed, false, '旧 session teardown 不得关闭新 session 窗口');
        assert.strictEqual(app.suiteExamMap.get('reading-p1'), freshSession.id, '旧 session teardown 不得清理新 suiteExamMap');
        assert.deepStrictEqual(plain(windowSessionStore.get('simulation')), freshSnapshot, '旧 session teardown 不得清理新 snapshot');
        assert.strictEqual(discardCalls, 0, '旧 session teardown 不得 discard 新 session snapshot');
    }

    // Case 3.0.8: timer 与进行中的 teardown 重叠时，失败后必须保留一次自动重试。
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_teardown_timer_overlap');
        session.status = 'completed';
        session.windowRef.close = function close() { this.closed = true; };
        const suiteWindow = session.windowRef;
        const overlapExamId = session.activeExamId;
        const overlapInfo = {
            window: suiteWindow,
            suiteSessionId: session.id,
            expectedSessionId: 'teardown-overlap-attempt',
            windowSessionToken: 'teardown-overlap-token',
            windowSessionTokenSessionId: 'teardown-overlap-attempt',
            sessionGeneration: 3
        };
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));
        app.examWindows = new Map([[overlapExamId, overlapInfo]]);
        app.messageHandlers = new Map([[overlapExamId, () => {}]]);
        session.windowBinding = {
            examId: overlapExamId,
            expectedSessionId: overlapInfo.expectedSessionId,
            windowSessionToken: overlapInfo.windowSessionToken,
            sessionGeneration: overlapInfo.sessionGeneration
        };

        const scheduledTimers = [];
        const originalSetTimeout = sandbox.setTimeout;
        const originalClearTimeout = sandbox.clearTimeout;
        sandbox.setTimeout = (callback) => {
            const timer = { run: callback, unref() {} };
            scheduledTimers.push(timer);
            return timer;
        };
        sandbox.clearTimeout = () => {};

        let discardAttempts = 0;
        let markDiscardStarted;
        let releaseDiscard;
        const discardStarted = new Promise((resolve) => { markDiscardStarted = resolve; });
        const discardGate = new Promise((resolve) => { releaseDiscard = resolve; });
        app._discardPersistentSuiteRecovery = async () => {
            discardAttempts += 1;
            if (discardAttempts === 1) {
                markDiscardStarted();
                return discardGate;
            }
            return true;
        };

        try {
            assert.strictEqual(app._scheduleSuiteSubmitTeardown(session), true);
            session.activeExamId = session.sequence[1].examId;
            const firstTeardown = app._teardownSuiteSession(session);
            await discardStarted;
            const frozenRegistrations = session._suiteTeardownRegistrations;
            assert(frozenRegistrations && typeof frozenRegistrations.get === 'function' && frozenRegistrations.size === 1);
            const overlappingTimer = scheduledTimers[0].run();
            releaseDiscard(false);
            assert.strictEqual(await firstTeardown, false);
            await overlappingTimer;
            assert.strictEqual(
                session._suiteTeardownRegistrations,
                frozenRegistrations,
                'completed teardown retry must retain the original exact registration snapshot'
            );
            assert.strictEqual(scheduledTimers.length, 2, '失败的重叠 teardown 必须重新挂起 fallback timer');
            assert.strictEqual(session.submitReceiptTeardownTimer, scheduledTimers[1]);
            await scheduledTimers[1].run();
        } finally {
            sandbox.setTimeout = originalSetTimeout;
            sandbox.clearTimeout = originalClearTimeout;
        }

        assert.strictEqual(discardAttempts, 2, 'fallback timer 必须在瞬时失败后重新尝试 discard');
        assert.strictEqual(app.currentSuiteSession, null, '重试成功后必须完成 teardown');
        assert.strictEqual(suiteWindow.closed, true, '重试成功后必须关闭已完成题页');
        assert.strictEqual(
            app.examWindows.has(session.sequence[1].examId),
            false,
            'late activeExamId mutation must not create a ghost registration during force-close'
        );
        assert.strictEqual(session._suiteTeardownRegistrations, undefined);
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

    // Case 4.2: 下一篇打开失败不得删除已提交结果，且可重试继续。
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_open_next_retry');
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map((item) => [item.examId, session.id]));
        app.openExam = async () => { throw new Error('expected next-window failure'); };
        const discardCount = recoveryControl.events.filter((event) => event.type === 'discard').length;
        const outcome = await app.handleSuitePracticeComplete('reading-p1', {
            suiteSessionId: session.id,
            submissionId: 'submit-open-next-retry',
            duration: 30,
            answers: { q1: 'A' },
            answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
        }, session.windowRef);
        assert.strictEqual(outcome.handled, true);
        assert.strictEqual(outcome.committed, true, '当前篇 durable 后必须 ACK');
        assert.strictEqual(outcome.errorCode, 'suite_advance_failed');
        assert.strictEqual(session.activeExamId, 'reading-p2', 'recovery 必须指向待打开的下一篇');
        assert.strictEqual(session.results.length, 1, '已提交结果必须留在 suite session');
        assert.strictEqual(
            recoveryControl.events.filter((event) => event.type === 'discard').length,
            discardCount,
            '自动切题失败不得 discard recovery'
        );
        const retriedWindow = createStubWindow('open-next-retried');
        app.openExam = async () => retriedWindow;
        assert.strictEqual(await app.continueSuitePractice(), true, '现有继续入口应能重试打开下一篇');
    }

    // Case 4.3: 关闭活动子页必须暂停计时并写入 durable recovery。
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_close_pauses_timer');
        const child = session.windowRef;
        session.suiteTimerRunning = true;
        session.suiteTimerPausedAtMs = null;
        session.suiteTimerPausedOffsetMs = 0;
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map((item) => [item.examId, session.id]));
        app.examWindows = new Map([['reading-p1', { window: child, suiteSessionId: session.id }]]);
        const saveStart = recoveryControl.events.length;
        assert.strictEqual(await app.handleExamWindowClosed('reading-p1', child), true);
        assert.strictEqual(session.suiteTimerRunning, false);
        assert(Number.isFinite(Number(session.suiteTimerPausedAtMs)));
        const pausedElapsed = app._computeSuiteElapsedSeconds(session, session.suiteTimerPausedAtMs);
        assert.strictEqual(
            app._computeSuiteElapsedSeconds(session, session.suiteTimerPausedAtMs + 60000),
            pausedElapsed,
            '窗口关闭后套题总计时不得继续增长'
        );
        const saved = recoveryControl.events.slice(saveStart).filter((event) => event.type === 'save').at(-1)?.value;
        assert(saved && saved.suiteTimerRunning === false, '暂停字段必须写入 AppData v2 recovery');
        assert.strictEqual(saved.suiteTimerPausedAtMs, session.suiteTimerPausedAtMs);
    }

    // Case 4.4: 同名入口必须按 suite session 隔离窗口所有权。
    {
        const originalOpen = windowStub.open;
        const windowsByName = new Map();
        windowStub.open = (_url, name) => {
            if (!windowsByName.has(name)) {
                const child = createStubWindow(name);
                child.close = () => { child.closed = true; };
                windowsByName.set(name, child);
            }
            return windowsByName.get(name);
        };
        try {
            const firstApp = createApp(windowStub);
            const secondApp = createApp(windowStub);
            firstApp._generateSuiteSessionId = () => 'suite-window-owner-a';
            secondApp._generateSuiteSessionId = () => 'suite-window-owner-b';
            const openExam = async (_examId, options) => windowStub.open('', options.windowName);
            firstApp.openExam = openExam;
            secondApp.openExam = openExam;
            const sequence = makeSession().sequence;
            assert.strictEqual(await firstApp._launchSuiteSessionFromSequence(sequence, { flowMode: 'simulation' }), true);
            assert.strictEqual(await secondApp._launchSuiteSessionFromSequence(sequence, { flowMode: 'simulation' }), true);
            assert.notStrictEqual(firstApp.currentSuiteSession.windowName, secondApp.currentSuiteSession.windowName);
            const secondWindow = secondApp.currentSuiteSession.windowRef;
            assert.strictEqual(await firstApp._teardownSuiteSession(firstApp.currentSuiteSession), true);
            assert.strictEqual(secondWindow.closed, false, '旧主页面 teardown 不得关闭新 session 的子页');
        } finally {
            windowStub.open = originalOpen;
        }
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
        session.draftsByExam['reading-p2'] = { answers: { q2: 'B' }, noteText: 'P2 draft' };
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
        assert.deepStrictEqual(
            plain(ctxMsg.data.draftsByExam),
            plain(session.draftsByExam),
            'inline context 必须同时携带所有篇章草稿'
        );
        assert.notStrictEqual(ctxMsg.data.draftsByExam, session.draftsByExam, '草稿集合必须以克隆值发送');
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
        app._refreshExamWindowToken(examId, info);
        app.examWindows.set(examId, info);
        const initialGeneration = info.sessionGeneration;

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
        assert(resetInfo.sessionGeneration > initialGeneration, 'reset 旋转 token 时必须推进 generation');
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

    // Finalization must freeze teardown ownership before its first durable await.
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_finalize_freezes_owner');
        const examId = session.activeExamId;
        const suiteWindow = session.windowRef;
        suiteWindow.close = function close() { this.closed = true; };
        session._suiteGeneration = 1;
        session.results = session.sequence.map((entry, index) => ({
            examId: entry.examId,
            title: entry.exam.title,
            category: entry.exam.category,
            duration: 10,
            answers: { q1: String.fromCharCode(65 + index) },
            answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 },
            rawData: {}
        }));
        const suiteInfo = {
            window: suiteWindow,
            suiteSessionId: session.id,
            expectedSessionId: 'suite-finalize-owner-attempt',
            windowSessionToken: 'suite-finalize-owner-token',
            windowSessionTokenSessionId: 'suite-finalize-owner-attempt',
            sessionGeneration: 7
        };
        session.windowBinding = {
            examId,
            expectedSessionId: suiteInfo.expectedSessionId,
            windowSessionToken: suiteInfo.windowSessionToken,
            sessionGeneration: suiteInfo.sessionGeneration
        };
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));
        app.examWindows = new Map([[examId, suiteInfo]]);
        app.messageHandlers = new Map([[examId, () => {}]]);

        let markFinalizeWriteEntered;
        let releaseFinalizeWrite;
        const finalizeWriteEntered = new Promise((resolve) => { markFinalizeWriteEntered = resolve; });
        const finalizeWriteGate = new Promise((resolve) => { releaseFinalizeWrite = resolve; });
        let recoveryWrites = 0;
        app._commitSuiteRecovery = async () => {
            recoveryWrites += 1;
            if (recoveryWrites === 1) {
                markFinalizeWriteEntered();
                await finalizeWriteGate;
            }
            return true;
        };
        app._saveSuitePracticeRecord = async () => {};
        app._updatePracticeRecordsState = async () => {};
        app._discardPersistentSuiteRecovery = async () => true;

        const finalizing = app.finalizeSuiteRecord(session, { deferTeardown: true });
        await finalizeWriteEntered;
        const frozenRegistrations = session._suiteTeardownRegistrations;
        assert(frozenRegistrations && typeof frozenRegistrations.get === 'function');
        assert.strictEqual(frozenRegistrations.get(examId).windowInfo, suiteInfo);

        const normalWindow = createStubWindow('normal-after-finalize-start');
        normalWindow.close = function close() { this.closed = true; };
        const normalInfo = {
            window: normalWindow,
            suiteSessionId: null,
            expectedSessionId: 'normal-after-finalize-attempt',
            windowSessionToken: 'normal-after-finalize-token',
            windowSessionTokenSessionId: 'normal-after-finalize-attempt',
            sessionGeneration: 8
        };
        // Simulate a late binding mutation while the first finalize write is in flight.
        session.windowRef = normalWindow;
        session.windowBinding = {
            examId,
            expectedSessionId: normalInfo.expectedSessionId,
            windowSessionToken: normalInfo.windowSessionToken,
            sessionGeneration: normalInfo.sessionGeneration
        };
        app.examWindows.set(examId, normalInfo);
        const normalHandler = () => {};
        app.messageHandlers.set(examId, normalHandler);
        releaseFinalizeWrite();

        assert.strictEqual(await finalizing, true);
        assert.strictEqual(session._suiteTeardownRegistrations, frozenRegistrations);
        let scheduledTeardown = null;
        const originalSetTimeout = sandbox.setTimeout;
        const originalClearTimeout = sandbox.clearTimeout;
        sandbox.setTimeout = (callback) => {
            scheduledTeardown = callback;
            return { unref() {} };
        };
        sandbox.clearTimeout = () => {};
        try {
            assert.strictEqual(app._scheduleSuiteSubmitTeardown(session), true);
            assert.strictEqual(session._suiteTeardownRegistrations, frozenRegistrations, 'delayed scheduling must reuse the pre-finalize snapshot');
            await scheduledTeardown();
        } finally {
            sandbox.setTimeout = originalSetTimeout;
            sandbox.clearTimeout = originalClearTimeout;
        }
        assert.strictEqual(suiteWindow.closed, true, 'teardown must close the originally frozen suite window');
        assert.strictEqual(normalWindow.closed, false, 'teardown must not close a late normal replacement');
        assert.strictEqual(app.examWindows.get(examId), normalInfo);
        assert.strictEqual(app.messageHandlers.get(examId), normalHandler);
    }

    // Reusing a suite WindowProxy must invalidate its old owner before openExam's first await.
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_reuse_navigation_gap');
        const examId = session.activeExamId;
        const sharedWindow = session.windowRef;
        sharedWindow.close = function close() { this.closed = true; };
        session.status = 'completed';
        session._suiteGeneration = 1;
        const suiteInfo = {
            window: sharedWindow,
            suiteSessionId: session.id,
            expectedSessionId: 'suite-reuse-gap-attempt',
            windowSessionToken: 'suite-reuse-gap-token',
            windowSessionTokenSessionId: 'suite-reuse-gap-attempt',
            expectedUrl: 'http://localhost/suite-old.html',
            expectedOrigin: 'http://localhost',
            allowOpaqueOrigin: false,
            sessionGeneration: 5
        };
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));
        app.examWindows = new Map([[examId, suiteInfo]]);
        app.setupExamWindowCommunication(sharedWindow, examId, {
            id: examId,
            title: 'Suite reuse gap',
            type: 'reading'
        });
        const oldMessageHandler = app.messageHandlers.get(examId);
        const oldHandshakeTimer = setInterval(() => {}, 60000);
        app._handshakeTimers = new Map([[examId, oldHandshakeTimer]]);
        session.windowBinding = {
            examId,
            expectedSessionId: suiteInfo.expectedSessionId,
            windowSessionToken: suiteInfo.windowSessionToken,
            sessionGeneration: suiteInfo.sessionGeneration
        };
        app._ensureSuiteWindowGuard(session, sharedWindow);
        await windowStub.AppData.recovery.saveActiveSession({ id: session.id, status: 'completed' });
        await windowStub.AppData.recovery.saveActiveSession({
            id: `active-session:${suiteInfo.expectedSessionId}`,
            examId,
            sessionId: suiteInfo.expectedSessionId,
            status: 'started'
        });

        let scheduledTeardown = null;
        let markReuseCleanupEntered;
        let releaseReuseCleanup;
        const reuseCleanupEntered = new Promise((resolve) => { markReuseCleanupEntered = resolve; });
        const reuseCleanupGate = new Promise((resolve) => { releaseReuseCleanup = resolve; });
        const originalSetTimeout = sandbox.setTimeout;
        const originalClearTimeout = sandbox.clearTimeout;
        const originalCleanupReused = app._cleanupReusedWindowSessions;
        const originalCaptureLibrary = app._captureLaunchLibraryConfigurationId;
        const originalStartPractice = app.startPracticeSession;
        const originalInject = app.injectDataCollectionScript;
        const originalGuard = app._guardExamWindowContent;
        const originalResolveReading = app.resolveReadingLaunchDescriptor;
        sandbox.setTimeout = (callback) => {
            if (!scheduledTeardown) scheduledTeardown = callback;
            return { unref() {} };
        };
        sandbox.clearTimeout = () => {};
        app._cleanupReusedWindowSessions = async () => {
            markReuseCleanupEntered();
            await reuseCleanupGate;
            return [];
        };
        app._captureLaunchLibraryConfigurationId = async () => null;
        app.startPracticeSession = async () => true;
        app.injectDataCollectionScript = () => {};
        app._guardExamWindowContent = (targetWindow) => targetWindow;
        app.resolveReadingLaunchDescriptor = () => ({
            mode: 'unified_html',
            url: 'http://localhost/normal-reuse-gap.html'
        });

        let normalInfo = null;
        try {
            assert.strictEqual(app._scheduleSuiteSubmitTeardown(session), true);
            const opening = app.openExam(examId, {
                examDefinition: { id: examId, title: 'Normal reuse gap', type: 'reading', hasHtml: true },
                target: 'tab',
                reuseWindow: sharedWindow,
                practiceMode: 'single'
            });
            await reuseCleanupEntered;
            const pendingInfo = app.examWindows.get(examId);
            assert.notStrictEqual(pendingInfo, suiteInfo, 'navigation must synchronously replace the old registration');
            assert.strictEqual(pendingInfo.window, sharedWindow);
            assert.strictEqual(pendingInfo.suiteSessionId, null);
            assert(pendingInfo.sessionGeneration > suiteInfo.sessionGeneration);
            assert.strictEqual(pendingInfo.handshakeDeferred, true);
            assert.strictEqual(app.messageHandlers.has(examId), false, 'the navigated-away document handler must be detached synchronously');
            assert.strictEqual(app._handshakeTimers.has(examId), false, 'the old handshake retry must be stopped synchronously');
            const messageCountBeforePendingRequest = sharedWindow._messages.length;
            await oldMessageHandler({
                source: sharedWindow,
                origin: 'http://localhost',
                data: { type: 'REQUEST_INIT', source: 'practice_page', data: { examId } }
            });
            assert.strictEqual(
                sharedWindow._messages.length,
                messageCountBeforePendingRequest,
                'a detached handler must fail closed while reassignment is pending'
            );

            await scheduledTeardown();
            assert.strictEqual(sharedWindow.closed, false, 'teardown must not close the already navigated normal page');
            assert.strictEqual(
                sharedWindow._messages.some(message => message && message.type === 'SUITE_FORCE_CLOSE'),
                false,
                'the pending normal reuse must not receive a suite force-close envelope'
            );

            releaseReuseCleanup();
            assert.strictEqual(await opening, sharedWindow);
            normalInfo = app.examWindows.get(examId);
            assert.strictEqual(normalInfo.window, sharedWindow);
            assert.strictEqual(normalInfo.suiteSessionId, null);
            assert.strictEqual(normalInfo.status, 'active');
        } finally {
            releaseReuseCleanup && releaseReuseCleanup();
            sandbox.setTimeout = originalSetTimeout;
            sandbox.clearTimeout = originalClearTimeout;
            app._cleanupReusedWindowSessions = originalCleanupReused;
            app._captureLaunchLibraryConfigurationId = originalCaptureLibrary;
            app.startPracticeSession = originalStartPractice;
            app.injectDataCollectionScript = originalInject;
            app._guardExamWindowContent = originalGuard;
            app.resolveReadingLaunchDescriptor = originalResolveReading;
        }

        const activeAfterTeardown = await windowStub.AppData.recovery.listActiveSessions();
        assert.strictEqual(app.currentSuiteSession, null);
        assert.strictEqual(
            activeAfterTeardown.some(item => item && item.sessionId === suiteInfo.expectedSessionId),
            false,
            'the old suite attempt recovery must still be removed during the navigation gap'
        );
        if (normalInfo && normalInfo.closeMonitor) clearInterval(normalInfo.closeMonitor);
        if (app._handshakeTimers) {
            for (const timer of app._handshakeTimers.values()) clearInterval(timer);
            app._handshakeTimers.clear();
        }
        app.examWindows.delete(examId);
        app.messageHandlers.delete(examId);
    }

    // A raw PDF reuse has no later managed handshake; it must fully detach the old owner.
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_pdf_reuse_gap');
        const examId = session.activeExamId;
        const sharedWindow = session.windowRef;
        sharedWindow.close = function close() { this.closed = true; };
        session.status = 'completed';
        session._suiteGeneration = 1;
        const closeMonitorToken = setInterval(() => {}, 60000);
        const handshakeTimerToken = setInterval(() => {}, 60000);
        const suiteInfo = {
            window: sharedWindow,
            suiteSessionId: session.id,
            expectedSessionId: 'suite-pdf-owner-attempt',
            windowSessionToken: 'suite-pdf-owner-token',
            windowSessionTokenSessionId: 'suite-pdf-owner-attempt',
            sessionGeneration: 3,
            closeMonitor: closeMonitorToken
        };
        session.windowBinding = {
            examId,
            expectedSessionId: suiteInfo.expectedSessionId,
            windowSessionToken: suiteInfo.windowSessionToken,
            sessionGeneration: suiteInfo.sessionGeneration
        };
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));
        app.examWindows = new Map([[examId, suiteInfo]]);
        const listenerCountBeforeHandler = windowStub.__listenerCount('message');
        app.setupExamWindowCommunication(sharedWindow, examId, {
            id: examId,
            title: 'Suite PDF reuse',
            type: 'reading'
        });
        assert.strictEqual(windowStub.__listenerCount('message'), listenerCountBeforeHandler + 1);
        app._handshakeTimers = new Map([[examId, handshakeTimerToken]]);
        app._discardPersistentSuiteRecovery = async () => true;

        let scheduledTeardown = null;
        const originalSetTimeout = sandbox.setTimeout;
        const originalClearTimeout = sandbox.clearTimeout;
        const originalClearInterval = sandbox.clearInterval;
        const clearedIntervals = new Set();
        sandbox.setTimeout = (callback) => {
            scheduledTeardown = callback;
            return { unref() {} };
        };
        sandbox.clearTimeout = () => {};
        sandbox.clearInterval = (timer) => {
            clearedIntervals.add(timer);
            originalClearInterval(timer);
        };
        try {
            assert.strictEqual(app._scheduleSuiteSubmitTeardown(session), true);
            assert.strictEqual(
                app._openPdfWindow({ id: examId, title: 'Normal PDF' }, 'http://localhost/normal.pdf', {
                    reuseWindow: sharedWindow,
                    target: 'tab'
                }),
                sharedWindow
            );
            assert.strictEqual(sharedWindow.location.href, 'http://localhost/normal.pdf');
            assert.strictEqual(app.examWindows.has(examId), false, 'unmanaged PDF reuse must not leave a provisional registration');
            assert.strictEqual(app.messageHandlers.has(examId), false);
            assert.strictEqual(app._handshakeTimers.has(examId), false);
            assert.strictEqual(windowStub.__listenerCount('message'), listenerCountBeforeHandler, 'PDF reuse must detach the real old message listener');
            assert(clearedIntervals.has(closeMonitorToken), 'PDF reuse must stop the old close monitor');
            assert(clearedIntervals.has(handshakeTimerToken), 'PDF reuse must stop the old handshake timer');

            // A later managed launch may occupy the same exam id on another window.
            // The invalidated PDF WindowProxy must remain remembered independently
            // of the current examWindows entry until the frozen teardown completes.
            const normalWindow = createStubWindow('normal-after-pdf-reuse');
            normalWindow.close = function close() { this.closed = true; };
            const normalInfo = {
                window: normalWindow,
                suiteSessionId: null,
                expectedSessionId: 'normal-after-pdf-attempt',
                windowSessionToken: 'normal-after-pdf-token',
                windowSessionTokenSessionId: 'normal-after-pdf-attempt',
                sessionGeneration: 4
            };
            const normalHandler = () => {};
            app.examWindows.set(examId, normalInfo);
            app.messageHandlers.set(examId, normalHandler);

            await scheduledTeardown();
            assert.strictEqual(sharedWindow.closed, false, 'delayed teardown must not close the already navigated PDF');
            assert.strictEqual(normalWindow.closed, false);
            assert.strictEqual(app.examWindows.get(examId), normalInfo);
            assert.strictEqual(app.messageHandlers.get(examId), normalHandler);
            assert.strictEqual(
                sharedWindow._messages.some(message => message && message.type === 'SUITE_FORCE_CLOSE'),
                false,
                'the PDF replacement must not receive a suite force-close envelope'
            );
            assert.strictEqual(app.currentSuiteSession, null);
        } finally {
            sandbox.setTimeout = originalSetTimeout;
            sandbox.clearTimeout = originalClearTimeout;
            sandbox.clearInterval = originalClearInterval;
            if (suiteInfo.closeMonitor) clearInterval(suiteInfo.closeMonitor);
            if (app._handshakeTimers) {
                for (const timer of app._handshakeTimers.values()) clearInterval(timer);
                app._handshakeTimers.clear();
            }
        }
    }

    // Delayed completed-suite teardown only owns its exact registration and recovery.
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_delayed_exact_owner');
        const examId = session.activeExamId;
        const sharedWindow = session.windowRef;
        sharedWindow.close = function close() { this.closed = true; };
        session.status = 'completed';
        session._suiteGeneration = 1;
        const suiteInfo = {
            window: sharedWindow,
            suiteSessionId: session.id,
            expectedSessionId: 'suite-owned-attempt',
            windowSessionToken: 'suite-owned-token',
            sessionGeneration: 4
        };
        const suiteHandler = () => {};
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));
        app.examWindows = new Map([[examId, suiteInfo]]);
        app.messageHandlers = new Map([[examId, suiteHandler]]);
        session.windowBinding = {
            examId,
            expectedSessionId: suiteInfo.expectedSessionId,
            windowSessionToken: suiteInfo.windowSessionToken,
            sessionGeneration: suiteInfo.sessionGeneration
        };
        app._ensureSuiteWindowGuard(session, sharedWindow);
        assert.strictEqual(sharedWindow.__IELTS_SUITE_PARENT_GUARD__.sessionId, session.id);
        app._mirrorSessionToStorage(session);
        await windowStub.AppData.recovery.saveActiveSession({ id: session.id, status: 'completed' });
        await windowStub.AppData.recovery.saveActiveSession({
            id: `active-session:${suiteInfo.expectedSessionId}`,
            examId,
            sessionId: suiteInfo.expectedSessionId,
            status: 'started'
        });

        let scheduledTeardown = null;
        const originalSetTimeout = sandbox.setTimeout;
        const originalClearTimeout = sandbox.clearTimeout;
        sandbox.setTimeout = (callback) => {
            scheduledTeardown = callback;
            return { unref() {} };
        };
        sandbox.clearTimeout = () => {};

        const normalInfo = {
            window: sharedWindow,
            // A completed suite may still cause normal initialization to inherit this tag.
            suiteSessionId: session.id,
            expectedSessionId: 'normal-reused-attempt',
            windowSessionToken: 'normal-reused-token',
            sessionGeneration: suiteInfo.sessionGeneration + 1
        };
        const lateWindowRef = createStubWindow('late-normal-window-ref');
        lateWindowRef.close = function close() { this.closed = true; };
        const normalHandler = () => {};
        try {
            assert.strictEqual(app._scheduleSuiteSubmitTeardown(session), true);
            assert.strictEqual(typeof scheduledTeardown, 'function');

            // The normal practice reuses the same exam id and WindowProxy before the delay expires.
            app.examWindows.set(examId, normalInfo);
            app.messageHandlers.set(examId, normalHandler);
            // Even if a late protocol message mutates the live binding, the scheduled
            // teardown must retain the completed suite's pre-delay ownership snapshot.
            session.windowBinding = {
                examId,
                expectedSessionId: normalInfo.expectedSessionId,
                windowSessionToken: normalInfo.windowSessionToken,
                sessionGeneration: normalInfo.sessionGeneration
            };
            session.windowRef = lateWindowRef;
            await windowStub.AppData.recovery.saveActiveSession({
                id: `active-session:${normalInfo.expectedSessionId}`,
                examId,
                sessionId: normalInfo.expectedSessionId,
                status: 'started'
            });

            await scheduledTeardown();
        } finally {
            sandbox.setTimeout = originalSetTimeout;
            sandbox.clearTimeout = originalClearTimeout;
        }

        const activeAfterTeardown = await windowStub.AppData.recovery.listActiveSessions();
        assert.strictEqual(app.currentSuiteSession, null, 'completed suite teardown should still finish');
        assert.strictEqual(app.suiteExamMap.has(examId), false, 'completed suite routing should be cleared');
        assert.strictEqual(windowSessionStore.has('simulation'), false, 'completed suite snapshot should be cleared');
        assert.strictEqual(sharedWindow.closed, false, 'reused normal-practice window must stay open');
        assert.strictEqual(lateWindowRef.closed, false, 'live windowRef changes must not redirect frozen teardown at another window');
        assert.strictEqual(
            sharedWindow.__IELTS_SUITE_PARENT_GUARD__,
            undefined,
            'the completed suite guard should be released from the reused window'
        );
        assert.strictEqual(
            sharedWindow._messages.some((message) => message && message.type === 'SUITE_FORCE_CLOSE'),
            false,
            'reused normal-practice window must not receive SUITE_FORCE_CLOSE'
        );
        assert.strictEqual(app.examWindows.get(examId), normalInfo, 'new registration must survive stale teardown');
        assert.strictEqual(app.messageHandlers.get(examId), normalHandler, 'new message handler must survive stale teardown');
        assert.strictEqual(
            activeAfterTeardown.some((item) => item && item.sessionId === suiteInfo.expectedSessionId),
            false,
            'the completed suite attempt recovery should be removed by exact session id'
        );
        assert.strictEqual(
            activeAfterTeardown.some((item) => item && item.sessionId === normalInfo.expectedSessionId),
            true,
            'the reused normal-practice recovery must survive stale teardown'
        );

        app.examWindows.delete(examId);
        app.messageHandlers.delete(examId);
        await windowStub.AppData.recovery.discardActiveSession(`active-session:${normalInfo.expectedSessionId}`);
    }

    // A different-window normal registration must survive while the frozen suite window closes.
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_delayed_distinct_window');
        const examId = session.activeExamId;
        const suiteWindow = session.windowRef;
        suiteWindow.close = function close() { this.closed = true; };
        session.status = 'completed';
        session._suiteGeneration = 1;
        const suiteInfo = {
            window: suiteWindow,
            suiteSessionId: session.id,
            expectedSessionId: 'suite-distinct-attempt',
            windowSessionToken: 'suite-distinct-token',
            windowSessionTokenSessionId: 'suite-distinct-attempt',
            sessionGeneration: 7
        };
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));
        app.examWindows = new Map([[examId, suiteInfo]]);
        app.messageHandlers = new Map([[examId, () => {}]]);
        session.windowBinding = {
            examId,
            expectedSessionId: suiteInfo.expectedSessionId,
            windowSessionToken: suiteInfo.windowSessionToken,
            sessionGeneration: suiteInfo.sessionGeneration
        };
        app._ensureSuiteWindowGuard(session, suiteWindow);
        await windowStub.AppData.recovery.saveActiveSession({ id: session.id, status: 'completed' });
        await windowStub.AppData.recovery.saveActiveSession({
            id: `active-session:${suiteInfo.expectedSessionId}`,
            examId,
            sessionId: suiteInfo.expectedSessionId,
            status: 'started'
        });

        let scheduledTeardown = null;
        const originalSetTimeout = sandbox.setTimeout;
        const originalClearTimeout = sandbox.clearTimeout;
        sandbox.setTimeout = (callback) => {
            scheduledTeardown = callback;
            return { unref() {} };
        };
        sandbox.clearTimeout = () => {};

        const normalWindow = createStubWindow('distinct-normal-window');
        normalWindow.close = function close() { this.closed = true; };
        const normalInfo = {
            window: normalWindow,
            suiteSessionId: null,
            expectedSessionId: 'normal-distinct-attempt',
            windowSessionToken: 'normal-distinct-token',
            windowSessionTokenSessionId: 'normal-distinct-attempt',
            sessionGeneration: suiteInfo.sessionGeneration + 1
        };
        const normalHandler = () => {};
        try {
            assert.strictEqual(app._scheduleSuiteSubmitTeardown(session), true);
            app.examWindows.set(examId, normalInfo);
            app.messageHandlers.set(examId, normalHandler);
            session.windowRef = normalWindow;
            session.windowBinding = {
                examId,
                expectedSessionId: normalInfo.expectedSessionId,
                windowSessionToken: normalInfo.windowSessionToken,
                sessionGeneration: normalInfo.sessionGeneration
            };
            await windowStub.AppData.recovery.saveActiveSession({
                id: `active-session:${normalInfo.expectedSessionId}`,
                examId,
                sessionId: normalInfo.expectedSessionId,
                status: 'started'
            });
            await scheduledTeardown();
        } finally {
            sandbox.setTimeout = originalSetTimeout;
            sandbox.clearTimeout = originalClearTimeout;
        }

        const activeAfterTeardown = await windowStub.AppData.recovery.listActiveSessions();
        assert.strictEqual(suiteWindow.closed, true, 'the frozen suite window must be closed');
        assert.strictEqual(normalWindow.closed, false, 'the distinct normal window must stay open');
        assert.strictEqual(
            suiteWindow._messages.some(message => message && message.type === 'SUITE_FORCE_CLOSE'),
            false,
            'teardown must not route a force-close envelope through the replacement registration'
        );
        assert.strictEqual(app.examWindows.get(examId), normalInfo, 'the distinct normal registration must survive');
        assert.strictEqual(normalInfo.window, normalWindow, 'teardown must not rebind the normal registration to the old suite window');
        assert.strictEqual(normalInfo.windowSessionToken, 'normal-distinct-token', 'teardown must not rotate the normal token');
        assert.strictEqual(app.messageHandlers.get(examId), normalHandler, 'the distinct normal handler must survive');
        assert.strictEqual(
            activeAfterTeardown.some(item => item && item.sessionId === suiteInfo.expectedSessionId),
            false,
            'the old suite attempt recovery must be removed'
        );
        assert.strictEqual(
            activeAfterTeardown.some(item => item && item.sessionId === normalInfo.expectedSessionId),
            true,
            'the distinct normal recovery must survive'
        );

        app.examWindows.delete(examId);
        app.messageHandlers.delete(examId);
        await windowStub.AppData.recovery.discardActiveSession(`active-session:${normalInfo.expectedSessionId}`);
    }

    // A failed active-suite abort must recapture ownership after navigation.
    {
        const app = createApp(windowStub);
        const session = makeSession('suite_abort_recaptures_registration');
        const firstExamId = session.sequence[0].examId;
        const firstWindow = session.windowRef;
        firstWindow.close = function close() { this.closed = true; };
        const firstInfo = {
            window: firstWindow,
            suiteSessionId: session.id,
            expectedSessionId: 'abort-first-attempt',
            windowSessionToken: 'abort-first-token',
            windowSessionTokenSessionId: 'abort-first-attempt',
            sessionGeneration: 1
        };
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));
        app.examWindows = new Map([[firstExamId, firstInfo]]);
        app.messageHandlers = new Map([[firstExamId, () => {}]]);
        session.windowBinding = {
            examId: firstExamId,
            expectedSessionId: firstInfo.expectedSessionId,
            windowSessionToken: firstInfo.windowSessionToken,
            sessionGeneration: firstInfo.sessionGeneration
        };

        let discardAttempts = 0;
        app._discardPersistentSuiteRecovery = async () => {
            discardAttempts += 1;
            return discardAttempts > 1;
        };

        assert.strictEqual(
            await app._abortSuiteSession(session, { reason: 'user_discard' }),
            false,
            'the first abort should surface the durable discard failure'
        );
        assert.strictEqual(session.status, 'active', 'a failed abort must leave the suite active');
        assert.strictEqual(app.currentSuiteSession, session, 'a failed abort must retain the active owner');
        assert.strictEqual(
            session._suiteTeardownRegistrations,
            undefined,
            'an active abort failure must discard its frozen teardown registration'
        );
        assert.strictEqual(firstWindow.closed, false, 'a failed abort must not close the current window');

        const secondExamId = session.sequence[1].examId;
        const secondWindow = createStubWindow('suite-window-after-abort-retry');
        secondWindow.close = function close() { this.closed = true; };
        const secondInfo = {
            window: secondWindow,
            suiteSessionId: session.id,
            expectedSessionId: 'abort-second-attempt',
            windowSessionToken: 'abort-second-token',
            windowSessionTokenSessionId: 'abort-second-attempt',
            sessionGeneration: 2
        };
        session.currentIndex = 1;
        session.activeExamId = secondExamId;
        session.windowRef = secondWindow;
        session.windowBinding = {
            examId: secondExamId,
            expectedSessionId: secondInfo.expectedSessionId,
            windowSessionToken: secondInfo.windowSessionToken,
            sessionGeneration: secondInfo.sessionGeneration
        };
        app.examWindows.delete(firstExamId);
        app.messageHandlers.delete(firstExamId);
        app.examWindows.set(secondExamId, secondInfo);
        app.messageHandlers.set(secondExamId, () => {});

        const recaptured = app._captureSuiteTeardownRegistrations(session);
        assert.strictEqual(
            recaptured.get(secondExamId).windowInfo,
            secondInfo,
            'the retry precondition must expose the newly bound exact registration'
        );
        const cleanupResults = [];
        const cleanupExamSession = app.cleanupExamSession.bind(app);
        app.cleanupExamSession = async (...args) => {
            const result = await cleanupExamSession(...args);
            cleanupResults.push({ examId: args[0], result });
            return result;
        };

        assert.strictEqual(
            await app._abortSuiteSession(session, { reason: 'user_discard' }),
            true,
            'the retry should teardown the registration captured after navigation'
        );
        assert.strictEqual(discardAttempts, 2, 'the retry must attempt durable discard again');
        assert.strictEqual(secondWindow.closed, true, 'the retry must close the newly bound suite window');
        assert.strictEqual(firstWindow.closed, false, 'the retry must not reuse and close the stale window snapshot');
        assert.deepStrictEqual(
            cleanupResults,
            [{ examId: secondExamId, result: true }],
            'the retry must run exact cleanup for the newly captured registration'
        );
        assert.strictEqual(app.currentSuiteSession, null, 'the successful retry must finish teardown');
        assert.strictEqual(app.examWindows.has(secondExamId), false, 'the newly captured registration must be cleaned');
    }

    process.stdout.write(JSON.stringify({ status: 'pass', detail: 'simulation mode regression cases passed' }));
}

run().catch((error) => {
    const detail = error && error.stack ? error.stack : String(error);
    process.stdout.write(JSON.stringify({ status: 'fail', detail }));
    process.exit(1);
});
