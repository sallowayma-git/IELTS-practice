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
    const navigatorStub = {
        locks: {
            async request(name, lockOptions = {}, callback) {
                assert.strictEqual(lockOptions.mode, 'exclusive');
                assert.strictEqual(lockOptions.ifAvailable, true);
                const normalizedName = String(name || '');
                // Each createApp fixture represents the sole realm under test. The callback's
                // returned promise controls how long the exclusive lease remains held.
                return await callback({ name: normalizedName, mode: 'exclusive' });
            }
        }
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
        navigator: navigatorStub,
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
    sandbox.navigator = navigatorStub;
    sandbox.globalThis = sandbox.window;
    return { sandbox, windowStub, windowSessionStore, recoveryControl };
}

function createApp(windowStub, options = {}) {
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
    app._createSuiteTestMap = typeof windowStub.__createSuiteTestMap === 'function'
        ? windowStub.__createSuiteTestMap
        : () => new Map();
    if (options.suiteModeReady !== false) {
        app._suiteModeReady = true;
        app.currentSuiteSession = null;
        app.suiteExamMap = app._createSuiteTestMap();
        app.multiSuiteSessionsMap = app._createSuiteTestMap();
        app._multiSuiteCompletionTails = app._createSuiteTestMap();
        app._suiteSessionGeneration = 0;
        app._suiteRecoveryReady = Promise.resolve(null);
    }
    return app;
}

function installManagedTestWindow(app, examId, targetWindow, options = {}) {
    if (!targetWindow || targetWindow.closed) return targetWindow;
    const managedMap = typeof app._createSuiteTestMap === 'function'
        ? app._createSuiteTestMap()
        : new Map();
    if (!app.examWindows || app.examWindows.constructor !== managedMap.constructor) {
        if (app.examWindows && typeof app.examWindows.entries === 'function') {
            for (const [key, value] of app.examWindows.entries()) managedMap.set(key, value);
        }
        app.examWindows = managedMap;
    }
    const previous = app.examWindows.get(examId);
    const generation = Math.max(0, Number(previous && previous.sessionGeneration) || 0) + 1;
    const expectedSessionId = `test-session:${String(examId)}:${generation}`;
    const windowSessionToken = `test-token:${String(examId)}:${generation}`;
    const info = {
        window: targetWindow,
        navigationOwnership: { examId: String(examId), generation },
        suiteSessionId: options.suiteSessionId || (app.currentSuiteSession && app.currentSuiteSession.id) || null,
        expectedSessionId,
        windowSessionToken,
        windowSessionTokenSessionId: expectedSessionId,
        expectedUrl: 'http://localhost/exam.html',
        expectedOrigin: 'http://localhost',
        allowOpaqueOrigin: false,
        sessionGeneration: generation,
        status: 'active'
    };
    app.examWindows.set(examId, info);
    if (options.launchOwnership && typeof app._recordExamLaunchRegistrationReceipt === 'function') {
        app._recordExamLaunchRegistrationReceipt(
            examId,
            options.launchOwnership,
            app._captureExamSessionRegistration(examId, info)
        );
    }
    if (options.launchOwnership && typeof app._commitExamLaunchOwnership === 'function') {
        assert.strictEqual(app._commitExamLaunchOwnership(options.launchOwnership), true);
    }
    return targetWindow;
}

function buildOwnedStartResult(app, examId, value = true, launchOwnership = null) {
    const windowInfo = app.examWindows && app.examWindows.get(examId);
    return app._buildPracticeSessionOwnedSuccess(
        examId,
        'test',
        windowInfo && windowInfo.expectedSessionId,
        value,
        windowInfo,
        launchOwnership
    );
}

async function restoreOwnedMultiSuiteItems(app, windowSession, items) {
    assert.strictEqual(
        await app._acquireMultiSuiteRecoveryOwnership(windowSession),
        true,
        'multi-suite restore fixture must own the base and exact recovery leases'
    );
    return await app._restorePersistentMultiSuiteSessions(items, [windowSession]);
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
    windowStub.__createSuiteTestMap = vm.runInContext('() => new Map()', context);

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
        app.openExam = async (examId, openOptions = {}) => {
            openCount += 1;
            assert.deepStrictEqual(
                recoveryControl.events.map((event) => event.type),
                ['save', 'cleanup', 'save'],
                '首题窗口只能在清理并确认 durable recovery 后打开'
            );
            const targetWindow = installManagedTestWindow(app, examId, createStubWindow('suite-window'), openOptions);
            const targetRegistration = app._captureSuiteNavigationRegistration(
                examId,
                targetWindow,
                openOptions.suiteSessionId,
                openOptions.launchOwnership
            );
            assert(targetRegistration, 'successful open fixture must install an exact managed registration');
            assert.strictEqual(
                app._isSuiteNavigationRegistrationCurrent(examId, targetRegistration, openOptions.suiteSessionId),
                true
            );
            assert.strictEqual(
                app._isSuiteExamLaunchOwnershipCurrent(examId, openOptions.launchOwnership, targetWindow),
                false,
                'open commit must release the reservation before returning to the suite caller'
            );
            return targetWindow;
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
        const oldNavigationOwnership = app._recordExamWindowNavigation(liveChild, 'reading-p2');
        const oldSameSuiteInfo = {
            examId: 'reading-p2',
            window: liveChild,
            navigationOwnership: oldNavigationOwnership,
            suiteSessionId: session.id,
            expectedSessionId: 'reading-p1-session',
            windowSessionToken: 'old-window-token',
            windowSessionTokenSessionId: 'reading-p1-session',
            sessionGeneration: 4,
            expectedUrl: session.windowBinding.expectedUrl,
            expectedOrigin: session.windowBinding.expectedOrigin,
            allowOpaqueOrigin: false,
            status: 'active'
        };
        app.examWindows = app._createSuiteTestMap();
        app.examWindows.set('reading-p2', oldSameSuiteInfo);
        assert.strictEqual(
            app._buildSuiteWindowBinding(session).windowSessionToken,
            'old-window-token',
            'the fixture must expose the stale same-suite registration that used to overwrite nextBinding'
        );
        let durableBindingBeforeSetup = null;
        let durableWindowNameBeforeSetup = null;
        const originalSetup = app.setupExamWindowManagement.bind(app);
        app.setupExamWindowManagement = (...args) => {
            const saves = recoveryControl.events.filter((event) => event.type === 'save'
                && event.value && String(event.value.id) === String(session.id));
            const latestSave = saves[saves.length - 1];
            durableBindingBeforeSetup = latestSave && plain(latestSave.value.windowBinding);
            durableWindowNameBeforeSetup = latestSave && latestSave.value.windowName;
            return originalSetup(...args);
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
            assert.deepStrictEqual(durableBindingBeforeSetup, plain(session.windowBinding));
            assert.strictEqual(durableBindingBeforeSetup.examId, 'reading-p2');
            assert.strictEqual(durableBindingBeforeSetup.expectedSessionId, 'reading-p1-session');
            assert.strictEqual(durableBindingBeforeSetup.sessionGeneration, 5);
            assert.notStrictEqual(durableBindingBeforeSetup.windowSessionToken, 'old-window-token');
            assert.strictEqual(durableWindowNameBeforeSetup, session.windowName);
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
        app.startPracticeSession = async (examId, startOptions = {}) => buildOwnedStartResult(
            app,
            examId,
            'reading-p1-session',
            startOptions.launchOwnership
        );
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
    // A passage CAS receipt remains authoritative even if this continuation loses its
    // recovery claim before saveActiveSession returns. Keep the receipt-aligned tuple,
    // ACK the submission, and suppress every later window side effect.
    for (const autoAdvance of [false, true]) {
        const app = createApp(windowStub);
        const session = makeSession(`suite_passage_post_receipt_${autoAdvance ? 'advance' : 'manual'}`);
        if (!autoAdvance) {
            session.flowMode = 'stationary';
            session.autoAdvanceAfterSubmit = false;
        }
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map((item) => [item.examId, session.id]));
        let openCount = 0;
        app.openExam = async () => {
            openCount += 1;
            return createStubWindow('must-not-open-after-post-receipt-loss');
        };
        let claimRelease = null;
        recoveryControl.saveQueue.push((value) => {
            claimRelease = app._releaseSuiteRecoveryClaim('single', session);
            return { committed: true, item: plain(value) };
        });
        const outcome = await app.handleSuitePracticeComplete('reading-p1', {
            suiteSessionId: session.id,
            submissionId: `post-receipt-${autoAdvance ? 'advance' : 'manual'}`,
            answers: { q1: 'A' },
            answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
        }, session.windowRef);
        if (claimRelease) await claimRelease;
        assert.strictEqual(outcome.handled, true);
        assert.strictEqual(outcome.committed, true, 'a confirmed per-call durable receipt must still ACK');
        assert.strictEqual(outcome.errorCode, 'suite_advance_superseded');
        assert.strictEqual(openCount, 0, 'post-receipt ownership loss must suppress window navigation');
        assert.strictEqual(session.currentIndex, autoAdvance ? 1 : 0);
        assert.strictEqual(session.activeExamId, autoAdvance ? 'reading-p2' : 'reading-p1');
        if (autoAdvance) {
            assert.strictEqual(session.pendingAdvance, null);
        } else {
            assert.strictEqual(session.pendingAdvance.completedExamId, 'reading-p1');
        }
        const durableEvent = recoveryControl.events.filter((event) => (
            event.type === 'save' && event.value && event.value.id === session.id
        )).at(-1);
        assert(durableEvent, 'the post-owner-loss outcome must be backed by this invocation durable receipt');
        assert.strictEqual(durableEvent.value.currentIndex, session.currentIndex);
        assert.strictEqual(durableEvent.value.activeExamId, session.activeExamId);
    }

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
            return installManagedTestWindow(app, examId, win, options);
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
            return installManagedTestWindow(app, examId, win, options);
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

        app.openExam = async (examId, options = {}) => {
            const win = createStubWindow('suite-window');
            win.lastExamId = examId;
            return installManagedTestWindow(app, examId, win, options);
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
        app.openExam = async (examId, options = {}) => {
            openCallCount += 1;
            return await new Promise((resolve) => {
                resolveOpen = () => resolve(installManagedTestWindow(
                    app,
                    examId,
                    createStubWindow('suite-window'),
                    options
                ));
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
        app.openExam = async (examId, options = {}) => {
            opened.push(examId);
            if (opened.length === 1) {
                await new Promise((resolve) => { releaseFirstOpen = resolve; });
            }
            return installManagedTestWindow(app, examId, createStubWindow('suite-window'), options);
        };

        const firstNavigate = app._handleSimulationNavigate(
            'reading-p1',
            { direction: 'next' },
            session.windowRef
        );
        for (let attempt = 0; attempt < 50 && typeof releaseFirstOpen !== 'function'; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        assert.strictEqual(typeof releaseFirstOpen, 'function', '第一跳必须在 claim 与 durable save 后进入 openExam');
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
        app.openExam = async (examId, options = {}) => {
            openCount += 1;
            const win = createStubWindow('suite-window');
            win.lastExamId = examId;
            return installManagedTestWindow(app, examId, win, options);
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

        const restoredApp = createApp(windowStub, { suiteModeReady: false });
        restoredApp.initializeSuiteMode();
        await restoredApp._ensureSuiteRecoveryReady();
        const restoredSession = restoredApp.multiSuiteSessionsMap.get('listening-100-p1');
        assert(restoredSession, '匹配当前标签页窗口镜像时应从 v2 恢复 multi-suite 会话');
        assert.strictEqual(restoredSession.status, 'active', '部分恢复会话应保持 active');
        assert.strictEqual(restoredSession.expectedSuiteCount, 2, '恢复会话应保留 expectedSuiteCount');
        assert.strictEqual(restoredSession.suiteResults.length, 1, '恢复会话应保留部分结果');
        assert.deepStrictEqual(
            plain(restoredSession.suiteResults[0].answerComparison),
            { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
            '恢复会话应保留结果比较数据'
        );

        assert.strictEqual(
            await restoredApp._releaseSuiteRecoveryClaim('multi', restoredSession),
            true
        );
        const originalLocks = windowStub.navigator.locks;
        const durableTakeoverLocks = {
            held: new Map(),
            calls: [],
            async request(name, lockOptions = {}, callback) {
                assert.strictEqual(lockOptions.mode, 'exclusive');
                assert.strictEqual(lockOptions.ifAvailable, true);
                const normalizedName = String(name || '');
                this.calls.push(normalizedName);
                if (this.held.has(normalizedName)) return callback(null);
                const lock = { name: normalizedName, mode: 'exclusive' };
                this.held.set(normalizedName, lock);
                try {
                    return await callback(lock);
                } finally {
                    if (this.held.get(normalizedName) === lock) this.held.delete(normalizedName);
                }
            }
        };
        windowStub.navigator.locks = durableTakeoverLocks;
        const durableOwnerApp = createApp(windowStub);
        const durableOwnerSession = plain(restoredSession);
        assert.strictEqual(
            await durableOwnerApp._acquireMultiSuiteRecoveryOwnership(durableOwnerSession),
            true,
            'active tab fixture must hold the base and exact durable recovery leases'
        );
        windowSessionStore.delete('multi-suite-practice');
        const foreignTabApp = createApp(windowStub, { suiteModeReady: false });
        foreignTabApp.initializeSuiteMode();
        await foreignTabApp._ensureSuiteRecoveryReady();
        assert.strictEqual(
            foreignTabApp.multiSuiteSessionsMap.has('listening-100-p1'),
            false,
            'fresh HTTP tab must not bypass an active durable owner lease'
        );
        assert.strictEqual(
            await durableOwnerApp._releaseSuiteRecoveryClaim('multi', durableOwnerSession),
            true
        );
        const takeoverFallback = foreignTabApp.getOrCreateMultiSuiteSession(
            'listening-100-p1_set1',
            { install: false }
        );
        const takeover = await foreignTabApp._refreshPersistentMultiSuiteBase(
            'listening-100-p1',
            takeoverFallback
        );
        assert.strictEqual(takeover.blocked, false);
        const takenOverSession = takeover.session;
        assert(takenOverSession, 'the same fresh tab must recover durable state after owner release/crash');
        assert.strictEqual(takenOverSession.id, durableSession.id);
        assert.strictEqual(
            await foreignTabApp._releaseSuiteRecoveryClaim('multi', takenOverSession),
            true
        );
        for (const recoveredSession of Array.from(foreignTabApp.multiSuiteSessionsMap.values())) {
            if (foreignTabApp._ownsMultiSuiteRecoveryOwnership(recoveredSession)) {
                assert.strictEqual(
                    await foreignTabApp._releaseSuiteRecoveryClaim('multi', recoveredSession),
                    true
                );
            }
        }
        if (foreignTabApp.currentSuiteSession
            && foreignTabApp._ownsSuiteRecoveryClaim('single', foreignTabApp.currentSuiteSession)) {
            assert.strictEqual(
                await foreignTabApp._releaseSuiteRecoveryClaim('single', foreignTabApp.currentSuiteSession),
                true
            );
        }
        assert.strictEqual(
            durableTakeoverLocks.held.has(foreignTabApp._suiteRecoveryClaimName(durableSession.id)),
            false,
            'the exact durable takeover lease must be released by fixture cleanup'
        );
        windowStub.navigator.locks = originalLocks;

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
        const refreshedAfterNack = createApp(windowStub, { suiteModeReady: false });
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

        const refreshed = createApp(windowStub, { suiteModeReady: false });
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

        const restoredApp = createApp(windowStub, { suiteModeReady: false });
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

        const restoredApp = createApp(windowStub, { suiteModeReady: false });
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
            await restoreOwnedMultiSuiteItems(restoredApp, invalidRevisionWal, [{
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
        await restoreOwnedMultiSuiteItems(restoredApp, duplicateIdWal, [3, 9].map((revision, index) => {
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
        await restoreOwnedMultiSuiteItems(restoredApp, conflictingWal, [{
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
        await restoreOwnedMultiSuiteItems(restoredApp, nonCanonicalWal, [{
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
        const competingDurable = {
            ...plain(restoredDurableOwner),
            id: 'multi-durable-owner-competing-id',
            baseExamId: competingBaseExamId,
            revision: 8,
            lastUpdate: Date.now() + 300
        };
        delete competingDurable._restoredFromWindowSession;
        delete competingDurable._lastDurableRecoveryRevision;
        const competingDurableItem = {
            schema: 'multi-suite-sessions-v2',
            version: 2,
            id: competingDurable.id,
            revision: 8,
            sessions: [competingDurable],
            updatedAt: Date.now() + 300
        };
        const originalCompetingLocks = windowStub.navigator.locks;
        const previousMultiWindowWal = plain(windowSessionStore.get('multi-suite-practice') || null);
        const competingLocks = {
            held: new Map(),
            async request(name, lockOptions = {}, callback) {
                assert.strictEqual(lockOptions.mode, 'exclusive');
                assert.strictEqual(lockOptions.ifAvailable, true);
                const normalizedName = String(name || '');
                if (this.held.has(normalizedName)) return callback(null);
                const lock = { name: normalizedName, mode: 'exclusive' };
                this.held.set(normalizedName, lock);
                try {
                    return await callback(lock);
                } finally {
                    if (this.held.get(normalizedName) === lock) this.held.delete(normalizedName);
                }
            }
        };
        windowStub.navigator.locks = competingLocks;
        const competingOwnerApp = createApp(windowStub);
        const liveCompetingDurable = plain(competingDurable);
        assert.strictEqual(
            await competingOwnerApp._acquireSuiteRecoveryClaim('multi', liveCompetingDurable),
            true,
            'foreign authoritative durable fixture must hold its exact lease'
        );
        await windowStub.AppData.recovery.saveActiveSession(plain(competingDurableItem));
        windowSessionStore.set('multi-suite-practice', {
            schema: 'multi-suite-sessions-v2',
            version: 2,
            sessions: [plain(competingWal)],
            updatedAt: Date.now()
        });
        const contendedWalApp = createApp(windowStub, { suiteModeReady: false });
        contendedWalApp.initializeSuiteMode();
        await contendedWalApp._ensureSuiteRecoveryReady();
        assert.strictEqual(
            contendedWalApp.multiSuiteSessionsMap.has(competingBaseExamId),
            false,
            'a same-base WAL must remain quarantined while the authoritative durable lease is active'
        );
        assert.strictEqual(
            windowSessionStore.get('multi-suite-practice').sessions[0].id,
            competingWal.id,
            'contention must preserve the copied WAL bytes for a later crash takeover retry'
        );
        assert.strictEqual(
            await competingOwnerApp._releaseSuiteRecoveryClaim('multi', liveCompetingDurable),
            true
        );

        const takeoverApp = createApp(windowStub, { suiteModeReady: false });
        takeoverApp.initializeSuiteMode();
        await takeoverApp._ensureSuiteRecoveryReady();
        const authoritativeTakeover = takeoverApp.multiSuiteSessionsMap.get(competingBaseExamId);
        assert(authoritativeTakeover, 'released/crashed durable owner must be recoverable by a fresh app');
        assert.strictEqual(
            authoritativeTakeover.id,
            competingDurable.id,
            'the authoritative durable identity must replace the stale same-base WAL identity'
        );
        assert.strictEqual(
            Array.from(takeoverApp.multiSuiteSessionsMap.values())
                .some((item) => item && item.id === competingWal.id),
            false
        );
        assert.strictEqual(await takeoverApp._releaseSuiteRecoveryClaim('multi', authoritativeTakeover), true);
        for (const app of [contendedWalApp, takeoverApp]) {
            for (const recoveredSession of Array.from(app.multiSuiteSessionsMap.values())) {
                if (app._ownsSuiteRecoveryClaim('multi', recoveredSession)) {
                    await app._releaseSuiteRecoveryClaim('multi', recoveredSession);
                }
            }
            if (app.currentSuiteSession && app._ownsSuiteRecoveryClaim('single', app.currentSuiteSession)) {
                await app._releaseSuiteRecoveryClaim('single', app.currentSuiteSession);
            }
        }
        await windowStub.AppData.recovery.discardActiveSession(competingDurable.id);
        if (previousMultiWindowWal) windowSessionStore.set('multi-suite-practice', previousMultiWindowWal);
        else windowSessionStore.delete('multi-suite-practice');
        windowStub.navigator.locks = originalCompetingLocks;

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
        await restoreOwnedMultiSuiteItems(restoredApp, crossSchemaWal, [{
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
            lastUpdate: Date.now(),
            _suiteRecoveryTimestampKnown: true,
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
        const originalShadowedMarkerLocks = windowStub.navigator.locks;
        const originalShadowedMarkerFence = windowStub.AppData.recovery.getActiveSessionFence;
        const shadowedMarkerLocks = {
            held: new Map(),
            calls: [],
            async request(name, lockOptions = {}, callback) {
                assert.strictEqual(lockOptions.mode, 'exclusive');
                assert.strictEqual(lockOptions.ifAvailable, true);
                const normalizedName = String(name || '');
                this.calls.push(normalizedName);
                if (this.held.has(normalizedName)) return callback(null);
                const lock = { name: normalizedName, mode: 'exclusive' };
                this.held.set(normalizedName, lock);
                try {
                    return await callback(lock);
                } finally {
                    if (this.held.get(normalizedName) === lock) this.held.delete(normalizedName);
                }
            }
        };
        windowStub.navigator.locks = shadowedMarkerLocks;
        windowStub.AppData.recovery.getActiveSessionFence = async (id) => ({
            id: String(id),
            exists: false,
            tombstoned: false,
            revision: 0
        });
        const shadowedMarkerSaveStart = recoveryControl.events.length;
        try {
            await restoreOwnedMultiSuiteItems(restoredApp, safeFallbackWal, [{
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
                'a shadowed corrupt base marker must not delete a different exact-id WAL'
            );
            assert.strictEqual(safeFallbackWal.baseExamId, shadowedMarkerBase);
            assert.notStrictEqual(
                safeFallbackWal._lastDurableRecoveryRevision,
                9,
                'a later shadowed marker must not lend its revision to a different WAL identity'
            );
            const safeFallbackSaves = recoveryControl.events
                .slice(shadowedMarkerSaveStart)
                .filter((event) => event.type === 'save');
            assert.strictEqual(safeFallbackSaves.length, 1);
            assert.strictEqual(safeFallbackSaves[0].value.id, safeFallbackWal.id);
            assert.strictEqual(safeFallbackSaves[0].options.expectedEntityRevision, 0);
            assert.deepStrictEqual(
                shadowedMarkerLocks.calls,
                [
                    restoredApp._multiSuiteBaseClaimName(safeFallbackWal.baseExamId),
                    restoredApp._suiteRecoveryClaimName(safeFallbackWal.id)
                ],
                'only the WAL base and exact identity may be claimed; a shadowed corrupt marker is not authoritative'
            );
            assert.strictEqual(
                await restoredApp._releaseSuiteRecoveryClaim('multi', safeFallbackWal),
                true
            );
            assert.strictEqual(shadowedMarkerLocks.held.size, 0);
        } finally {
            await windowStub.AppData.recovery.discardActiveSession(safeFallbackWal.id);
            if (originalShadowedMarkerFence) {
                windowStub.AppData.recovery.getActiveSessionFence = originalShadowedMarkerFence;
            } else {
                delete windowStub.AppData.recovery.getActiveSessionFence;
            }
            windowStub.navigator.locks = originalShadowedMarkerLocks;
        }
        restoredApp.multiSuiteSessionsMap.delete(shadowedMarkerBase);

        const exactIdWal = {
            id: 'multi-exact-id',
            baseExamId: 'listening-multi-exact-id',
            revision: 2,
            lastUpdate: Date.now(),
            _suiteRecoveryTimestampKnown: true,
            _restoredFromWindowSession: true
        };
        restoredApp.multiSuiteSessionsMap.set(exactIdWal.baseExamId, exactIdWal);
        const originalExactIdFence = windowStub.AppData.recovery.getActiveSessionFence;
        windowStub.AppData.recovery.getActiveSessionFence = async (id) => ({
            id: String(id),
            exists: false,
            tombstoned: false,
            revision: 0
        });
        const exactIdSaveStart = recoveryControl.events.length;
        try {
            await restoreOwnedMultiSuiteItems(restoredApp, exactIdWal, [{
                schema: 'multi-suite-sessions-v2',
                version: 2,
                id: `${exactIdWal.id} `,
                revision: 8,
                sessions: [{ baseExamId: exactIdWal.baseExamId }]
            }]);
            assert.notStrictEqual(
                exactIdWal._lastDurableRecoveryRevision,
                8,
                'active-session id 必须按 AppData 原始字符串精确匹配，不能 trim 后借用 revision'
            );
            assert.strictEqual(
                restoredApp.multiSuiteSessionsMap.get(exactIdWal.baseExamId),
                exactIdWal,
                'the exact-id WAL may establish its own expected=0 entity without borrowing a whitespace alias'
            );
            const exactIdSaves = recoveryControl.events
                .slice(exactIdSaveStart)
                .filter((event) => event.type === 'save');
            assert.strictEqual(exactIdSaves.length, 1);
            assert.strictEqual(exactIdSaves[0].value.id, exactIdWal.id);
            assert.strictEqual(exactIdSaves[0].options.expectedEntityRevision, 0);
            assert.strictEqual(await restoredApp._releaseSuiteRecoveryClaim('multi', exactIdWal), true);
        } finally {
            await windowStub.AppData.recovery.discardActiveSession(exactIdWal.id);
            if (originalExactIdFence) {
                windowStub.AppData.recovery.getActiveSessionFence = originalExactIdFence;
            } else {
                delete windowStub.AppData.recovery.getActiveSessionFence;
            }
        }
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
        const mismatchedDurableSession = {
            ...plain(mismatchedOwnerWal),
            id: 'multi-corrupt-nested-owner'
        };
        delete mismatchedDurableSession._restoredFromWindowSession;
        const laterValidDuplicate = plain(mismatchedOwnerWal);
        delete laterValidDuplicate._restoredFromWindowSession;
        await restoreOwnedMultiSuiteItems(restoredApp, mismatchedOwnerWal, [{
            schema: 'multi-suite-sessions-v2',
            version: 2,
            id: mismatchedOwnerWal.id,
            revision: 11,
            sessions: [mismatchedDurableSession]
        }, {
            schema: 'multi-suite-sessions-v2',
            version: 2,
            id: mismatchedOwnerWal.id,
            revision: 12,
            sessions: [laterValidDuplicate]
        }]);
        assert.strictEqual(
            restoredApp.multiSuiteSessionsMap.get(mismatchedOwnerWal.baseExamId),
            mismatchedOwnerWal,
            'a corrupt first exact-id owner must block a later duplicate from replacing the window WAL'
        );
        assert.strictEqual(mismatchedOwnerWal._lastDurableRecoveryRevision, 11);
        assert.strictEqual(mismatchedOwnerWal.revision, 11, 'the retained WAL must inherit the actual first CAS owner revision');
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
        assert.strictEqual(await app._ensureSuiteRecoveryClaim('single', freshSession), true);
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
        app.openExam = async (examId, options = {}) => (
            installManagedTestWindow(app, examId, retriedWindow, options)
        );
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
            firstApp.openExam = async (examId, options = {}) => installManagedTestWindow(
                firstApp,
                examId,
                windowStub.open('', options.windowName),
                options
            );
            secondApp.openExam = async (examId, options = {}) => installManagedTestWindow(
                secondApp,
                examId,
                windowStub.open('', options.windowName),
                options
            );
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
        assert.strictEqual(await app._ensureSuiteRecoveryClaim('single', session), true);
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

        app.handleSessionReady('reading-p1', {
            sessionId: 'session-reading-p1',
            suiteSessionId: session.id,
            pageType: 'unified-reading'
        });
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
        app.openExam = async (examId, options = {}) => installManagedTestWindow(
            app,
            examId,
            options.reuseWindow || reusedWindow,
            options
        );
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
        app.openExam = async (examId, options = {}) => installManagedTestWindow(
            app,
            examId,
            options.reuseWindow || reusedWindow,
            options
        );
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
        const completionWindow = createStubWindow('custom-listening-completion-window');
        const completionInfo = app.ensureExamWindowSession(examId, completionWindow);
        completionInfo.expectedSessionId = `${examId}_session`;
        app.examWindows.set(examId, completionInfo);
        const completionRegistration = app._captureExamSessionRegistration(examId, completionInfo);

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
        }, completionWindow, { expectedRegistration: completionRegistration });

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
        const completionWindow = createStubWindow('normalized-listening-completion-window');
        const completionInfo = app.ensureExamWindowSession(examId, completionWindow);
        completionInfo.expectedSessionId = `${examId}_session`;
        app.examWindows.set(examId, completionInfo);
        const completionRegistration = app._captureExamSessionRegistration(examId, completionInfo);

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
        }, completionWindow, { expectedRegistration: completionRegistration });

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
        app.startPracticeSession = async (handledExamId, startOptions = {}) => {
            resetStarts.push(handledExamId);
            app.components.practiceRecorder.activeSessions.set(handledExamId, {
                examId: handledExamId,
                sessionId: 'temporary-reset-session',
                metadata: {},
                progress: {},
                answers: {}
            });
            return buildOwnedStartResult(
                app,
                handledExamId,
                true,
                startOptions.launchOwnership
            );
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
        app.startPracticeSession = async (handledExamId, startOptions = {}) => buildOwnedStartResult(
            app,
            handledExamId,
            true,
            startOptions.launchOwnership
        );
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
        assert.strictEqual(await app._ensureSuiteRecoveryClaim('single', session), true);
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

    // A failed primary recovery save must retry with the frozen registration id.
    {
        const app = createApp(windowStub);
        const examId = 'reading-fallback-session-alignment';
        const ownerSessionId = 'fallback-owner-session';
        const unrelatedSessionId = 'fallback-unrelated-session';
        const examWindow = createStubWindow('fallback-session-alignment-window');
        const windowInfo = {
            window: examWindow,
            expectedSessionId: ownerSessionId,
            windowSessionToken: 'fallback-session-token',
            windowSessionTokenSessionId: ownerSessionId,
            sessionGeneration: 1,
            suiteSessionId: null
        };
        const originalResolveActiveLibraryIndex = windowStub.resolveActiveLibraryIndex;
        const hadOpen = Object.prototype.hasOwnProperty.call(windowStub, 'open');
        const originalOpen = windowStub.open;
        const fallbackOpenCalls = [];
        let generatedSessionIdCount = 0;

        app.examWindows = new Map([[examId, windowInfo]]);
        app.messageHandlers = new Map([[examId, () => {}]]);
        app.generateSessionId = () => {
            generatedSessionIdCount += 1;
            return 'unexpected-generated-fallback-session';
        };
        windowStub.resolveActiveLibraryIndex = async () => [{
            id: examId,
            title: 'Fallback Session Alignment',
            type: 'reading'
        }];
        windowStub.open = (url, name) => {
            fallbackOpenCalls.push({ url, name });
            return createStubWindow(name);
        };

        try {
            await windowStub.AppData.recovery.saveActiveSession({
                id: `active-session:${unrelatedSessionId}`,
                examId,
                sessionId: unrelatedSessionId,
                status: 'started'
            });
            const recoveryEventStart = recoveryControl.events.length;
            recoveryControl.saveQueue.push(new Error('transient primary recovery failure'), true);

            await app.startPracticeSession(examId);

            const attemptedSaves = recoveryControl.events
                .slice(recoveryEventStart)
                .filter((event) => event.type === 'save' && event.value && event.value.examId === examId);
            assert.strictEqual(attemptedSaves.length, 2, 'primary failure must make one fallback save attempt');
            attemptedSaves.forEach((event) => {
                assert.strictEqual(event.value.sessionId, ownerSessionId);
                assert.strictEqual(event.value.id, `active-session:${ownerSessionId}`);
            });
            const activeAfterFallback = await windowStub.AppData.recovery.listActiveSessions();
            assert(
                activeAfterFallback.some((item) => item && item.id === `active-session:${ownerSessionId}`),
                'fallback recovery must use the exact registration id'
            );
            assert.strictEqual(windowInfo.expectedSessionId, ownerSessionId);
            assert.strictEqual(generatedSessionIdCount, 0, 'fallback must not mint another session id');
            assert.strictEqual(fallbackOpenCalls.length, 1);
            assert.strictEqual(fallbackOpenCalls[0].name, `practice_${ownerSessionId}`);

            const expectedRegistration = app._captureExamSessionRegistration(examId, windowInfo);
            assert.strictEqual(
                await app.cleanupExamSession(examId, { expectedRegistration }),
                true,
                'the exact current registration should be cleaned'
            );
            const activeAfterCleanup = await windowStub.AppData.recovery.listActiveSessions();
            assert.strictEqual(
                activeAfterCleanup.some((item) => item && item.id === `active-session:${ownerSessionId}`),
                false,
                'exact cleanup must delete the fallback recovery it owns'
            );
            assert.strictEqual(
                activeAfterCleanup.some((item) => item && item.id === `active-session:${unrelatedSessionId}`),
                true,
                'exact cleanup must preserve another session for the same exam'
            );
        } finally {
            await windowStub.AppData.recovery.discardActiveSession(`active-session:${ownerSessionId}`);
            await windowStub.AppData.recovery.discardActiveSession(`active-session:${unrelatedSessionId}`);
            await windowStub.AppData.recovery.discardActiveSession('active-session:unexpected-generated-fallback-session');
            windowStub.resolveActiveLibraryIndex = originalResolveActiveLibraryIndex;
            if (hadOpen) {
                windowStub.open = originalOpen;
            } else {
                delete windowStub.open;
            }
        }
    }

    // A fallback save that loses its exact registration immediately after commit must clean its ghost.
    {
        const app = createApp(windowStub);
        const examId = 'reading-fallback-inflight-replacement';
        const ownerSessionId = 'fallback-inflight-owner';
        const replacementSessionId = 'fallback-inflight-replacement';
        const ownerInfo = {
            window: createStubWindow('fallback-inflight-owner-window'),
            expectedSessionId: ownerSessionId,
            windowSessionToken: 'fallback-inflight-owner-token',
            windowSessionTokenSessionId: ownerSessionId,
            sessionGeneration: 1,
            suiteSessionId: null
        };
        const replacementInfo = {
            window: createStubWindow('fallback-inflight-replacement-window'),
            expectedSessionId: replacementSessionId,
            windowSessionToken: 'fallback-inflight-replacement-token',
            windowSessionTokenSessionId: replacementSessionId,
            sessionGeneration: 2,
            suiteSessionId: null
        };
        const replacementHandler = () => {};
        const recovery = windowStub.AppData.recovery;
        const originalSaveActiveSession = recovery.saveActiveSession;
        const originalResolveActiveLibraryIndex = windowStub.resolveActiveLibraryIndex;
        const hadOpen = Object.prototype.hasOwnProperty.call(windowStub, 'open');
        const originalOpen = windowStub.open;
        let fallbackOpenCount = 0;
        let fallbackSaveCount = 0;

        app.examWindows = new Map([[examId, ownerInfo]]);
        app.messageHandlers = new Map([[examId, () => {}]]);
        app.components.practiceRecorder = {
            startPracticeSession() {
                throw new Error('force final fallback');
            }
        };
        windowStub.resolveActiveLibraryIndex = async () => [{
            id: examId,
            title: 'Fallback In-flight Replacement',
            type: 'reading'
        }];
        windowStub.open = () => {
            fallbackOpenCount += 1;
            return createStubWindow('unexpected-fallback-window');
        };
        recovery.saveActiveSession = async (value, options = {}) => {
            fallbackSaveCount += 1;
            const allowed = typeof options.commitGuard === 'function' && options.commitGuard() === true;
            if (!allowed) {
                return { committed: false, stale: true, code: 'STALE_RECOVERY_WRITE' };
            }
            const receipt = await originalSaveActiveSession(value, options);
            app.examWindows.set(examId, replacementInfo);
            app.messageHandlers.set(examId, replacementHandler);
            return receipt;
        };

        try {
            await originalSaveActiveSession({
                id: `active-session:${replacementSessionId}`,
                examId,
                sessionId: replacementSessionId,
                status: 'started'
            });
            assert.strictEqual(
                await app.startPracticeSessionFallback(examId, {}, { sessionId: 'unowned-fallback-session' }),
                null,
                'fallback without an immutable registration tuple must fail closed'
            );
            assert.strictEqual(fallbackSaveCount, 0, 'an unowned fallback must not reach recovery storage');
            assert.strictEqual(await app.startPracticeSession(examId), null);
            assert.strictEqual(fallbackSaveCount, 1, 'the fallback must make only its owner-bound save attempt');
            assert.strictEqual(fallbackOpenCount, 0, 'a stale fallback must not open another practice window');
            assert.strictEqual(app.examWindows.get(examId), replacementInfo, 'the replacement registration must survive');
            assert.strictEqual(app.messageHandlers.get(examId), replacementHandler, 'the replacement handler must survive');
            const active = await recovery.listActiveSessions();
            assert.strictEqual(
                active.some((item) => item && item.id === `active-session:${ownerSessionId}`),
                false,
                'post-commit ownership loss must discard the just-written fallback recovery'
            );
            assert.strictEqual(
                active.some((item) => item && item.id === `active-session:${replacementSessionId}`),
                true,
                'post-commit cleanup must preserve the replacement recovery'
            );
        } finally {
            recovery.saveActiveSession = originalSaveActiveSession;
            await recovery.discardActiveSession(`active-session:${ownerSessionId}`);
            await recovery.discardActiveSession(`active-session:${replacementSessionId}`);
            await recovery.discardActiveSession('active-session:unowned-fallback-session');
            windowStub.resolveActiveLibraryIndex = originalResolveActiveLibraryIndex;
            if (hadOpen) {
                windowStub.open = originalOpen;
            } else {
                delete windowStub.open;
            }
        }
    }

    // The async practice page manager must receive the host id and may realign only its exact owner.
    {
        const app = createApp(windowStub);
        const examId = 'reading-manager-session-alignment';
        const hostSessionId = 'manager-host-session';
        const managerSessionId = 'manager-actual-session';
        const windowInfo = {
            window: createStubWindow('manager-session-alignment-window'),
            expectedSessionId: hostSessionId,
            windowSessionToken: 'manager-host-token',
            windowSessionTokenSessionId: hostSessionId,
            sessionGeneration: 1,
            suiteSessionId: null
        };
        const initialToken = windowInfo.windowSessionToken;
        const originalResolveActiveLibraryIndex = windowStub.resolveActiveLibraryIndex;
        const hadManager = Object.prototype.hasOwnProperty.call(windowStub, 'practicePageManager');
        const originalManager = windowStub.practicePageManager;

        app.examWindows = new Map([[examId, windowInfo]]);
        app.messageHandlers = new Map([[examId, () => {}]]);
        windowStub.resolveActiveLibraryIndex = async () => [{
            id: examId,
            title: 'Manager Session Alignment',
            type: 'reading'
        }];
        windowStub.practicePageManager = {
            async startPracticeSession(handledExamId, examData) {
                assert.strictEqual(handledExamId, examId);
                assert.strictEqual(examData.sessionId, hostSessionId, 'manager must receive the host owner id');
                await windowStub.AppData.recovery.saveActiveSession({
                    id: `active-session:${managerSessionId}`,
                    examId,
                    sessionId: managerSessionId,
                    status: 'started'
                });
                return managerSessionId;
            }
        };

        try {
            const startResult = await app.startPracticeSession(examId);
            assert.strictEqual(app._isPracticeSessionOwnedSuccess(startResult), true);
            assert.strictEqual(startResult.sessionId, managerSessionId);
            assert.strictEqual(startResult.value, managerSessionId);
            assert.strictEqual(windowInfo.expectedSessionId, managerSessionId);
            assert.strictEqual(windowInfo.windowSessionTokenSessionId, managerSessionId);
            assert.notStrictEqual(windowInfo.windowSessionToken, initialToken, 'manager id realignment must rotate the token');

            windowStub.practicePageManager.startPracticeSession = async (handledExamId, examData) => {
                assert.strictEqual(handledExamId, examId);
                assert.strictEqual(examData.sessionId, managerSessionId);
                return true;
            };
            const booleanResult = await app.startPracticeSession(examId, {
                examDefinition: { id: examId, title: 'Manager Boolean Success', type: 'reading' }
            });
            assert.strictEqual(app._isPracticeSessionOwnedSuccess(booleanResult), true);
            assert.strictEqual(booleanResult.sessionId, managerSessionId);
            assert.notStrictEqual(windowInfo.expectedSessionId, 'true', 'boolean success must not become a session id');

            const expectedRegistration = app._captureExamSessionRegistration(examId, windowInfo);
            assert.strictEqual(await app.cleanupExamSession(examId, { expectedRegistration }), true);
            const active = await windowStub.AppData.recovery.listActiveSessions();
            assert.strictEqual(
                active.some((item) => item && item.id === `active-session:${managerSessionId}`),
                false,
                'cleanup must own the manager-aligned recovery id'
            );
        } finally {
            await windowStub.AppData.recovery.discardActiveSession(`active-session:${managerSessionId}`);
            windowStub.resolveActiveLibraryIndex = originalResolveActiveLibraryIndex;
            if (hadManager) {
                windowStub.practicePageManager = originalManager;
            } else {
                delete windowStub.practicePageManager;
            }
        }
    }

    // A manager result that arrives after replacement may clean its own ghost, never the new owner.
    {
        const app = createApp(windowStub);
        const examId = 'reading-manager-inflight-replacement';
        const hostSessionId = 'manager-inflight-host';
        const managerSessionId = 'manager-inflight-actual';
        const replacementSessionId = 'manager-inflight-replacement';
        const ownerInfo = {
            window: createStubWindow('manager-inflight-owner-window'),
            expectedSessionId: hostSessionId,
            windowSessionToken: 'manager-inflight-owner-token',
            windowSessionTokenSessionId: hostSessionId,
            sessionGeneration: 1,
            suiteSessionId: null
        };
        const replacementInfo = {
            window: createStubWindow('manager-inflight-replacement-window'),
            expectedSessionId: replacementSessionId,
            windowSessionToken: 'manager-inflight-replacement-token',
            windowSessionTokenSessionId: replacementSessionId,
            sessionGeneration: 2,
            suiteSessionId: null
        };
        const replacementHandler = () => {};
        const originalResolveActiveLibraryIndex = windowStub.resolveActiveLibraryIndex;
        const hadManager = Object.prototype.hasOwnProperty.call(windowStub, 'practicePageManager');
        const originalManager = windowStub.practicePageManager;

        app.examWindows = new Map([[examId, ownerInfo]]);
        app.messageHandlers = new Map([[examId, () => {}]]);
        windowStub.resolveActiveLibraryIndex = async () => [{
            id: examId,
            title: 'Manager In-flight Replacement',
            type: 'reading'
        }];
        windowStub.practicePageManager = {
            async startPracticeSession(handledExamId, examData) {
                assert.strictEqual(handledExamId, examId);
                assert.strictEqual(examData.sessionId, hostSessionId);
                await windowStub.AppData.recovery.saveActiveSession({
                    id: `active-session:${managerSessionId}`,
                    examId,
                    sessionId: managerSessionId,
                    status: 'started'
                });
                app.examWindows.set(examId, replacementInfo);
                app.messageHandlers.set(examId, replacementHandler);
                return managerSessionId;
            }
        };

        try {
            await windowStub.AppData.recovery.saveActiveSession({
                id: `active-session:${replacementSessionId}`,
                examId,
                sessionId: replacementSessionId,
                status: 'started'
            });
            assert.strictEqual(await app.startPracticeSession(examId), null);
            assert.strictEqual(app.examWindows.get(examId), replacementInfo);
            assert.strictEqual(app.messageHandlers.get(examId), replacementHandler);
            assert.strictEqual(replacementInfo.expectedSessionId, replacementSessionId);
            assert.strictEqual(replacementInfo.windowSessionToken, 'manager-inflight-replacement-token');
            const active = await windowStub.AppData.recovery.listActiveSessions();
            assert.strictEqual(
                active.some((item) => item && item.id === `active-session:${managerSessionId}`),
                false,
                'the displaced manager recovery must be discarded by its actual id'
            );
            assert.strictEqual(
                active.some((item) => item && item.id === `active-session:${replacementSessionId}`),
                true,
                'the replacement recovery must survive targeted ghost cleanup'
            );
        } finally {
            await windowStub.AppData.recovery.discardActiveSession(`active-session:${managerSessionId}`);
            await windowStub.AppData.recovery.discardActiveSession(`active-session:${replacementSessionId}`);
            windowStub.resolveActiveLibraryIndex = originalResolveActiveLibraryIndex;
            if (hadManager) {
                windowStub.practicePageManager = originalManager;
            } else {
                delete windowStub.practicePageManager;
            }
        }
    }

    // A registration replaced while findExamDefinition is pending must not be adopted by the old start.
    {
        const app = createApp(windowStub);
        const examId = 'reading-start-definition-owner-gate';
        const ownerWindow = createStubWindow('definition-owner-window');
        const replacementWindow = createStubWindow('definition-replacement-window');
        const ownerInfo = {
            window: ownerWindow,
            expectedSessionId: 'definition-owner-session',
            windowSessionToken: 'definition-owner-token',
            windowSessionTokenSessionId: 'definition-owner-session',
            sessionGeneration: 1,
            suiteSessionId: null
        };
        const replacementInfo = {
            window: replacementWindow,
            expectedSessionId: 'definition-replacement-session',
            windowSessionToken: 'definition-replacement-token',
            windowSessionTokenSessionId: 'definition-replacement-session',
            sessionGeneration: 2,
            suiteSessionId: null
        };
        const replacementHandler = () => {};
        const originalResolveActiveLibraryIndex = windowStub.resolveActiveLibraryIndex;
        let markLookupEntered;
        let releaseLookup;
        const lookupEntered = new Promise((resolve) => { markLookupEntered = resolve; });
        const lookupGate = new Promise((resolve) => { releaseLookup = resolve; });
        windowStub.resolveActiveLibraryIndex = async () => {
            markLookupEntered();
            await lookupGate;
            return [{ id: examId, title: 'Definition owner gate', type: 'reading' }];
        };
        app.examWindows = new Map([[examId, ownerInfo]]);
        app.messageHandlers = new Map([[examId, () => {}]]);

        try {
            const starting = app.startPracticeSession(examId);
            await lookupEntered;
            app.examWindows.set(examId, replacementInfo);
            app.messageHandlers.set(examId, replacementHandler);
            releaseLookup();

            assert.strictEqual(await starting, null);
            assert.strictEqual(app.examWindows.get(examId), replacementInfo);
            assert.strictEqual(app.messageHandlers.get(examId), replacementHandler);
            assert.strictEqual(replacementInfo.expectedSessionId, 'definition-replacement-session');
            assert.strictEqual(replacementInfo.windowSessionToken, 'definition-replacement-token');
        } finally {
            releaseLookup && releaseLookup();
            windowStub.resolveActiveLibraryIndex = originalResolveActiveLibraryIndex;
        }
    }

    // A stale openExam index lookup must stop before it navigates or overwrites a replacement.
    {
        const app = createApp(windowStub);
        const examId = 'reading-open-index-owner-gate';
        const ownerInfo = {
            window: createStubWindow('open-index-owner-window'),
            expectedSessionId: 'open-index-owner-session',
            windowSessionToken: 'open-index-owner-token',
            windowSessionTokenSessionId: 'open-index-owner-session',
            sessionGeneration: 1,
            suiteSessionId: null
        };
        const replacementInfo = {
            window: createStubWindow('open-index-replacement-window'),
            expectedSessionId: 'open-index-replacement-session',
            windowSessionToken: 'open-index-replacement-token',
            windowSessionTokenSessionId: 'open-index-replacement-session',
            sessionGeneration: 2,
            suiteSessionId: null
        };
        const replacementHandler = () => {};
        const originalResolveActiveLibraryIndex = windowStub.resolveActiveLibraryIndex;
        const originalOpenExamWindow = app.openExamWindow;
        const originalInject = app.injectDataCollectionScript;
        let markIndexEntered;
        let releaseIndex;
        const indexEntered = new Promise((resolve) => { markIndexEntered = resolve; });
        const indexGate = new Promise((resolve) => { releaseIndex = resolve; });
        let openCount = 0;
        let injectCount = 0;
        windowStub.resolveActiveLibraryIndex = async () => {
            markIndexEntered();
            await indexGate;
            return [{ id: examId, title: 'Open index owner gate', type: 'reading', hasHtml: true }];
        };
        app.openExamWindow = () => {
            openCount += 1;
            return ownerInfo.window;
        };
        app.injectDataCollectionScript = () => {
            injectCount += 1;
        };
        app.examWindows = new Map([[examId, ownerInfo]]);
        app.messageHandlers = new Map([[examId, () => {}]]);

        try {
            const opening = app.openExam(examId, { target: 'tab' });
            await indexEntered;
            app.examWindows.set(examId, replacementInfo);
            app.messageHandlers.set(examId, replacementHandler);
            releaseIndex();

            assert.strictEqual(await opening, null);
            assert.strictEqual(openCount, 0, 'a stale index lookup must stop before navigation');
            assert.strictEqual(injectCount, 0);
            assert.strictEqual(app.examWindows.get(examId), replacementInfo);
            assert.strictEqual(app.messageHandlers.get(examId), replacementHandler);
        } finally {
            releaseIndex && releaseIndex();
            windowStub.resolveActiveLibraryIndex = originalResolveActiveLibraryIndex;
            app.openExamWindow = originalOpenExamWindow;
            app.injectDataCollectionScript = originalInject;
        }
    }

    // Removing the frozen predecessor during the index await is neutral; only a different tuple supersedes launch.
    {
        const app = createApp(windowStub);
        const examId = 'reading-open-index-predecessor-closed';
        const oldWindow = createStubWindow('open-index-predecessor-window');
        const newWindow = createStubWindow('_blank');
        newWindow.addEventListener = () => {};
        const oldInfo = {
            window: oldWindow,
            expectedSessionId: 'open-index-predecessor-session',
            windowSessionToken: 'open-index-predecessor-token',
            windowSessionTokenSessionId: 'open-index-predecessor-session',
            sessionGeneration: 1,
            suiteSessionId: null
        };
        const originalResolveActiveLibraryIndex = windowStub.resolveActiveLibraryIndex;
        let markIndexEntered;
        let releaseIndex;
        const indexEntered = new Promise(resolve => { markIndexEntered = resolve; });
        const indexGate = new Promise(resolve => { releaseIndex = resolve; });
        windowStub.resolveActiveLibraryIndex = async () => {
            markIndexEntered();
            await indexGate;
            return [{ id: examId, title: 'Closed predecessor launch', type: 'reading', hasHtml: true }];
        };
        app.examWindows = new Map([[examId, oldInfo]]);
        app.messageHandlers = new Map([[examId, () => {}]]);
        app.resolveReadingLaunchDescriptor = () => ({
            mode: 'unified_html',
            url: `http://localhost/${examId}.html`
        });
        app.openExamWindow = () => newWindow;
        app._guardExamWindowContent = targetWindow => targetWindow;
        app._captureLaunchLibraryConfigurationId = async () => null;
        app.startPracticeSession = async (handledExamId, startOptions = {}) => buildOwnedStartResult(
            app,
            handledExamId,
            true,
            startOptions.launchOwnership
        );
        app.injectDataCollectionScript = () => {};
        try {
            const opening = app.openExam(examId, { target: 'tab', windowName: '_blank' });
            await indexEntered;
            const predecessorRegistration = app._captureExamSessionRegistration(examId, oldInfo);
            assert.strictEqual(await app.cleanupExamSession(examId, {
                expectedRegistration: predecessorRegistration,
                recoverySessionId: predecessorRegistration.expectedSessionId
            }), true);
            releaseIndex();
            assert.strictEqual(await opening, newWindow);
            assert.strictEqual(app.examWindows.get(examId).window, newWindow);
            assert.notStrictEqual(app.examWindows.get(examId), oldInfo);
        } finally {
            releaseIndex && releaseIndex();
            windowStub.resolveActiveLibraryIndex = originalResolveActiveLibraryIndex;
            const current = app.examWindows && app.examWindows.get(examId);
            if (current && current.closeMonitor) clearInterval(current.closeMonitor);
            if (app._handshakeTimers) {
                for (const timer of app._handshakeTimers.values()) clearInterval(timer);
                app._handshakeTimers.clear();
            }
        }
    }

    // An openExam manager await that loses its exact owner must not inject, INIT, checkpoint, or rebind.
    {
        const app = createApp(windowStub);
        const examId = 'reading-open-manager-owner-gate';
        const exam = { id: examId, title: 'Open manager owner gate', type: 'reading', hasHtml: true };
        const oldWindow = createStubWindow('open-manager-old-window');
        const replacementWindow = createStubWindow('open-manager-replacement-window');
        const oldLoadHandlers = [];
        const replacementLoadHandlers = [];
        oldWindow.addEventListener = (type, handler) => {
            if (type === 'load' && typeof handler === 'function') oldLoadHandlers.push(handler);
        };
        replacementWindow.addEventListener = (type, handler) => {
            if (type === 'load' && typeof handler === 'function') replacementLoadHandlers.push(handler);
        };
        const originalManager = windowStub.practicePageManager;
        const hadManager = Object.prototype.hasOwnProperty.call(windowStub, 'practicePageManager');
        const originalResolveReading = app.resolveReadingLaunchDescriptor;
        const originalOpenExamWindow = app.openExamWindow;
        const originalGuard = app._guardExamWindowContent;
        const originalCaptureLibrary = app._captureLaunchLibraryConfigurationId;
        const originalInject = app.injectDataCollectionScript;
        let markManagerEntered;
        let releaseManager;
        const managerEntered = new Promise((resolve) => { markManagerEntered = resolve; });
        const managerGate = new Promise((resolve) => { releaseManager = resolve; });
        let injectCount = 0;
        let checkpointCount = 0;
        app.resolveReadingLaunchDescriptor = () => ({
            mode: 'unified_html',
            url: `http://localhost/${examId}.html`
        });
        app.openExamWindow = () => oldWindow;
        app._guardExamWindowContent = (targetWindow) => targetWindow;
        app._captureLaunchLibraryConfigurationId = async () => null;
        app.injectDataCollectionScript = () => {
            injectCount += 1;
        };
        windowStub.practicePageManager = {
            async startPracticeSession(handledExamId, examData) {
                assert.strictEqual(handledExamId, examId);
                assert.strictEqual(typeof examData.sessionId, 'string');
                assert(examData.sessionId.length > 0);
                markManagerEntered();
                await managerGate;
                return examData.sessionId;
            }
        };

        let replacementRegistration = null;
        let replacementHandler = null;
        try {
            const opening = app.openExam(examId, {
                examDefinition: exam,
                target: 'tab',
                windowName: 'open-manager-owner-gate-tab',
                suiteSessionId: 'suite-open-manager-owner-gate',
                beforeSuiteHandshake: async () => {
                    checkpointCount += 1;
                    return true;
                }
            });
            await managerEntered;
            const oldRegistration = app._captureExamSessionRegistration(examId);
            assert(oldRegistration && oldRegistration.window === oldWindow);

            replacementRegistration = app.setupExamWindowManagement(
                replacementWindow,
                examId,
                exam,
                {
                    expectedUrl: `http://localhost/${examId}-replacement.html`,
                    deferInitialHandshake: true
                }
            );
            replacementHandler = app.messageHandlers.get(examId);
            assert(replacementRegistration && replacementRegistration.window === replacementWindow);
            releaseManager();

            assert.strictEqual(await opening, null);
            assert.strictEqual(injectCount, 0, 'a displaced launch must never inject into its old WindowProxy');
            assert.strictEqual(checkpointCount, 0, 'a displaced launch must not mutate the suite binding');
            assert.strictEqual(
                oldWindow._messages.some(message => message && String(message.type || '').toUpperCase() === 'INIT_SESSION'),
                false,
                'the displaced WindowProxy must not receive INIT'
            );

            await Promise.all(oldLoadHandlers.map(handler => Promise.resolve(handler())));
            assert.strictEqual(app.examWindows.get(examId), replacementRegistration.windowInfo);
            assert.strictEqual(app.messageHandlers.get(examId), replacementHandler);
            assert.strictEqual(replacementRegistration.windowInfo.window, replacementWindow);
            assert.strictEqual(
                oldWindow._messages.some(message => message && String(message.type || '').toUpperCase() === 'INIT_SESSION'),
                false,
                'stale load callbacks must remain owner-gated'
            );
        } finally {
            releaseManager && releaseManager();
            app.resolveReadingLaunchDescriptor = originalResolveReading;
            app.openExamWindow = originalOpenExamWindow;
            app._guardExamWindowContent = originalGuard;
            app._captureLaunchLibraryConfigurationId = originalCaptureLibrary;
            app.injectDataCollectionScript = originalInject;
            if (hadManager) {
                windowStub.practicePageManager = originalManager;
            } else {
                delete windowStub.practicePageManager;
            }
            const current = app.examWindows && app.examWindows.get(examId);
            if (current && current.closeMonitor) clearInterval(current.closeMonitor);
            if (app._handshakeTimers) {
                for (const timer of app._handshakeTimers.values()) clearInterval(timer);
                app._handshakeTimers.clear();
            }
            replacementLoadHandlers.length = 0;
        }
    }

    // Failed deferred starts must tear down only their exact owned popup registration.
    for (const failureMode of [
        'manager-false',
        'recovery-uncommitted',
        'checkpoint-false',
        'config-window-close',
        'manager-window-close'
    ]) {
        const app = createApp(windowStub);
        const examId = `reading-open-start-failure-${failureMode}`;
        const exam = { id: examId, title: failureMode, type: 'reading', hasHtml: true };
        const examWindow = createStubWindow(`start-failure-${failureMode}`);
        examWindow.addEventListener = () => {};
        examWindow.close = function close() { this.closed = true; };
        const hadManager = Object.prototype.hasOwnProperty.call(windowStub, 'practicePageManager');
        const originalManager = windowStub.practicePageManager;
        let injectCount = 0;
        app.resolveReadingLaunchDescriptor = () => ({
            mode: 'unified_html',
            url: `http://localhost/${examId}.html`
        });
        app.openExamWindow = () => examWindow;
        app._guardExamWindowContent = targetWindow => targetWindow;
        app._captureLaunchLibraryConfigurationId = async () => {
            if (failureMode === 'config-window-close') examWindow.close();
            return null;
        };
        app.injectDataCollectionScript = () => { injectCount += 1; };
        if (failureMode === 'manager-false' || failureMode === 'manager-window-close') {
            windowStub.practicePageManager = {
                async startPracticeSession() {
                    if (failureMode === 'manager-window-close') {
                        examWindow.close();
                        return true;
                    }
                    return false;
                }
            };
        } else {
            delete windowStub.practicePageManager;
        }
        if (failureMode === 'recovery-uncommitted') {
            recoveryControl.saveQueue.push(false);
        }
        if (failureMode === 'checkpoint-false') {
            app.startPracticeSession = async (handledExamId, startOptions = {}) => buildOwnedStartResult(
                app,
                handledExamId,
                true,
                startOptions.launchOwnership
            );
        }
        try {
            const opened = await app.openExam(examId, {
                examDefinition: exam,
                target: 'tab',
                windowName: examWindow.name,
                ...(failureMode === 'checkpoint-false' ? {
                    suiteSessionId: `suite-${examId}`,
                    beforeSuiteHandshake: async () => false
                } : {})
            });
            assert.strictEqual(opened, null);
            assert.strictEqual(Boolean(app.examWindows && app.examWindows.has(examId)), false);
            assert.strictEqual(Boolean(app.messageHandlers && app.messageHandlers.has(examId)), false);
            assert.strictEqual(examWindow.closed, true);
            assert.strictEqual(injectCount, 0);
        } finally {
            if (hadManager) {
                windowStub.practicePageManager = originalManager;
            } else {
                delete windowStub.practicePageManager;
            }
            const current = app.examWindows && app.examWindows.get(examId);
            if (current && current.closeMonitor) clearInterval(current.closeMonitor);
            if (app._handshakeTimers) {
                for (const timer of app._handshakeTimers.values()) clearInterval(timer);
                app._handshakeTimers.clear();
            }
        }
    }

    // A completed first navigation is owned by its exact provisional registration. A newer
    // same-exam launch that fails before navigation must not strand the first launch mid-config.
    {
        const app = createApp(windowStub);
        const examId = 'reading-post-navigation-registration-owner';
        const exam = { id: examId, title: 'Post-navigation owner', type: 'reading', hasHtml: true };
        const examWindow = createStubWindow('_blank');
        examWindow.addEventListener = () => {};
        examWindow.close = function close() { this.closed = true; };
        const hadOpen = Object.prototype.hasOwnProperty.call(windowStub, 'open');
        const originalOpen = windowStub.open;
        let markConfigurationEntered;
        let releaseConfiguration;
        const configurationEntered = new Promise(resolve => { markConfigurationEntered = resolve; });
        const configurationGate = new Promise(resolve => { releaseConfiguration = resolve; });
        let configurationCommitGuard = null;
        let injectCount = 0;
        let restartCount = 0;
        windowStub.open = () => examWindow;
        app.resolveReadingLaunchDescriptor = () => ({
            mode: 'unified_html',
            url: `http://localhost/${examId}.html`
        });
        app._guardExamWindowContent = targetWindow => targetWindow;
        app._captureLaunchLibraryConfigurationId = async (_handledExamId, captureOptions = {}) => {
            configurationCommitGuard = captureOptions.commitGuard;
            assert.strictEqual(configurationCommitGuard(), true);
            markConfigurationEntered();
            await configurationGate;
            assert.strictEqual(configurationCommitGuard(), true);
            return null;
        };
        app.startPracticeSession = async (handledExamId, startOptions = {}) => {
            assert.strictEqual(
                app._isExamSessionRegistrationCurrent(handledExamId, startOptions.expectedRegistration),
                true
            );
            return buildOwnedStartResult(app, handledExamId, true);
        };
        app.restartExamHandshake = () => { restartCount += 1; };
        app.injectDataCollectionScript = () => { injectCount += 1; };
        let provisionalRegistration = null;
        try {
            const opening = app.openExam(examId, {
                examDefinition: exam,
                target: 'tab',
                windowName: '_blank'
            });
            await configurationEntered;
            provisionalRegistration = app._captureExamSessionRegistration(examId);
            assert(provisionalRegistration);
            assert.strictEqual(provisionalRegistration.window, examWindow);
            assert.strictEqual(provisionalRegistration.windowInfo.launchProvisional, true);
            assert.strictEqual(
                app._isOpenExamRegistrationCurrent(examId, provisionalRegistration, examWindow),
                true
            );

            await assert.rejects(
                app.openExam(examId, { requireRecordProvenance: true }),
                /./
            );
            assert.strictEqual(configurationCommitGuard(), true);
            assert.strictEqual(
                app._isExamSessionRegistrationCurrent(examId, provisionalRegistration),
                true,
                'a failed pre-navigation reservation must not supersede the navigated provisional tuple'
            );
            releaseConfiguration();

            assert.strictEqual(await opening, examWindow);
            const finalRegistration = app._captureExamSessionRegistration(examId);
            assert(finalRegistration);
            assert.notStrictEqual(finalRegistration.windowInfo, provisionalRegistration.windowInfo);
            assert.strictEqual(finalRegistration.windowInfo.launchProvisional, undefined);
            assert.strictEqual(finalRegistration.windowInfo.handshakeDeferred, false);
            assert.strictEqual(app.messageHandlers.has(examId), true);
            assert.strictEqual(restartCount, 1);
            assert.strictEqual(injectCount, 1);
        } finally {
            releaseConfiguration && releaseConfiguration();
            if (hadOpen) windowStub.open = originalOpen;
            else delete windowStub.open;
            const current = app.examWindows && app.examWindows.get(examId);
            if (current && current.closeMonitor) clearInterval(current.closeMonitor);
            if (app._handshakeTimers) {
                for (const timer of app._handshakeTimers.values()) clearInterval(timer);
                app._handshakeTimers.clear();
            }
        }
    }

    // A supplied launch token publishes the exact final registration it created. A same-suite,
    // same-WindowProxy successor installed after openExam resolves must not be re-captured as the
    // older launch's result by reading the global examWindows map.
    {
        const app = createApp(windowStub);
        const examId = 'reading-launch-registration-receipt';
        const suiteSessionId = 'suite-launch-registration-receipt';
        const exam = { id: examId, title: 'Launch receipt', type: 'reading', hasHtml: true };
        const examWindow = createStubWindow('launch-registration-receipt-window');
        examWindow.addEventListener = () => {};
        app.resolveReadingLaunchDescriptor = () => ({
            mode: 'unified_html',
            url: `http://localhost/${examId}.html`
        });
        app._guardExamWindowContent = targetWindow => targetWindow;
        app._captureLaunchLibraryConfigurationId = async () => null;
        app.restartExamHandshake = () => {};
        app.injectDataCollectionScript = () => {};
        app.startPracticeSession = async (handledExamId, startOptions = {}) => {
            const expectedRegistration = startOptions.expectedRegistration;
            assert.strictEqual(
                app._isExamSessionRegistrationCurrent(handledExamId, expectedRegistration),
                true
            );
            const previousInfo = expectedRegistration.windowInfo;
            const realignedInfo = {
                ...previousInfo,
                expectedSessionId: 'launch-receipt-manager-session',
                sessionId: null,
                sessionGeneration: Number(previousInfo.sessionGeneration || 0) + 1,
                windowSessionToken: 'launch-receipt-manager-token',
                windowSessionTokenSessionId: 'launch-receipt-manager-session'
            };
            app.examWindows.set(handledExamId, realignedInfo);
            const registration = app._captureExamSessionRegistration(handledExamId, realignedInfo);
            return Object.freeze({
                owned: true,
                status: 'owned-success',
                examId: handledExamId,
                source: 'manager',
                sessionId: realignedInfo.expectedSessionId,
                value: null,
                registration
            });
        };

        const launchOwnership = app._beginExamLaunchOwnership(examId, {
            reuseWindow: examWindow,
            windowName: examWindow.name
        });
        const opened = await app.openExam(examId, {
            examDefinition: exam,
            target: 'tab',
            reuseWindow: examWindow,
            windowName: examWindow.name,
            launchOwnership,
            suiteSessionId,
            beforeSuiteHandshake: async (context = {}) => {
                assert.strictEqual(context.commitGuard(), true);
                return true;
            }
        });
        assert.strictEqual(opened, examWindow);
        const launchReceipt = app._captureExamLaunchRegistrationReceipt(
            examId,
            launchOwnership,
            examWindow
        );
        assert(launchReceipt, 'successful supplied launch must publish an exact receipt');
        assert.strictEqual(launchReceipt.expectedSessionId, 'launch-receipt-manager-session');
        assert.strictEqual(launchReceipt.suiteSessionId, suiteSessionId);
        assert.strictEqual(
            app._isExamSessionRegistrationCurrent(examId, launchReceipt),
            true
        );

        const newerRegistration = app.setupExamWindowManagement(
            examWindow,
            examId,
            exam,
            {
                expectedRegistration: launchReceipt,
                expectedUrl: `http://localhost/${examId}.html`,
                suiteSessionId,
                skipContentGuard: true,
                deferInitialHandshake: true
            }
        );
        assert(newerRegistration);
        assert.strictEqual(newerRegistration.window, examWindow);
        assert.strictEqual(newerRegistration.suiteSessionId, suiteSessionId);
        assert.notStrictEqual(newerRegistration.windowInfo, launchReceipt.windowInfo);
        assert.notStrictEqual(newerRegistration.expectedSessionId, launchReceipt.expectedSessionId);
        assert.strictEqual(
            app._captureExamLaunchRegistrationReceipt(examId, launchOwnership, examWindow),
            null,
            'a newer same-suite tuple must invalidate, not replace, the older launch receipt'
        );
        assert.strictEqual(app.examWindows.get(examId), newerRegistration.windowInfo);

        const current = app.examWindows.get(examId);
        if (current && current.closeMonitor) clearInterval(current.closeMonitor);
        if (app._handshakeTimers && app._handshakeTimers.has(examId)) {
            clearInterval(app._handshakeTimers.get(examId));
            app._handshakeTimers.delete(examId);
        }
        const currentHandler = app.messageHandlers && app.messageHandlers.get(examId);
        if (currentHandler) {
            windowStub.removeEventListener('message', currentHandler);
            app.messageHandlers.delete(examId);
        }
    }

    // Direct location assignment does not prove that options.windowName resolves to the reused
    // WindowProxy. Only window.open(requestedName) may establish that named-context proof.
    for (const launchKind of ['html', 'pdf']) {
        const app = createApp(windowStub);
        const examId = `reading-direct-reuse-name-proof-${launchKind}`;
        const exam = { id: examId, title: `Direct reuse ${launchKind}`, type: 'reading' };
        const actualName = `actual-direct-reuse-${launchKind}`;
        const unrelatedName = `unrelated-direct-reuse-${launchKind}`;
        const examWindow = createStubWindow(actualName);
        const ownership = app._beginExamLaunchOwnership(examId, {
            reuseWindow: examWindow,
            windowName: unrelatedName
        });
        const launchOptions = {
            examId,
            reuseWindow: examWindow,
            windowName: unrelatedName,
            launchOwnership: ownership
        };
        const opened = launchKind === 'html'
            ? app.openExamWindow(`http://localhost/${examId}.html`, exam, launchOptions)
            : app._openPdfWindow(exam, `http://localhost/${examId}.pdf`, launchOptions);
        assert.strictEqual(opened, examWindow);
        assert.notStrictEqual(
            app._resolveExamLaunchProvenWindow(`window-name:${unrelatedName}`),
            examWindow,
            `${launchKind} direct reuse must not treat options.windowName as resolved proof`
        );
        assert.strictEqual(
            app._resolveExamLaunchProvenWindow(`window-name:${actualName}`),
            examWindow,
            `${launchKind} direct reuse may retain the safely read actual WindowProxy name`
        );

        const namedExamId = `reading-unrelated-named-continuation-${launchKind}`;
        const namedContinuation = app._beginExamLaunchOwnership(namedExamId, {
            windowName: unrelatedName
        });
        Object.defineProperty(examWindow, 'name', {
            configurable: true,
            get() { throw new Error('cross-origin name'); }
        });
        const opaqueOwnership = app._beginExamLaunchOwnership(
            `reading-opaque-direct-reuse-${launchKind}`,
            { reuseWindow: examWindow }
        );
        assert.strictEqual(
            app._isExamLaunchOwnershipCurrent(namedExamId, namedContinuation),
            true,
            `${launchKind} opaque reuse must not steal an unrelated unproven named continuation`
        );
        assert.strictEqual(
            app._examLaunchOwnershipTargetLeaseKeys.get(opaqueOwnership)
                .has(`window-name:${unrelatedName}`),
            false
        );
    }

    // An abort may await durable recovery cleanup after removing its exact HTML tuple. A raw PDF
    // navigation on the same WindowProxy has no managed map entry, but its committed navigation
    // token must still prevent the older abort from closing the newly owned document.
    {
        const app = createApp(windowStub);
        const htmlExamId = 'reading-html-abort-before-pdf-reuse';
        const pdfExamId = 'reading-pdf-reuses-aborting-window';
        const examWindow = createStubWindow('html-abort-pdf-reuse-window');
        let closeCount = 0;
        examWindow.close = function close() {
            closeCount += 1;
            this.closed = true;
        };
        const htmlOwnership = app._beginExamLaunchOwnership(htmlExamId, {
            reuseWindow: examWindow
        });
        assert.strictEqual(app.openExamWindow(
            `http://localhost/${htmlExamId}.html`,
            { id: htmlExamId, title: 'HTML abort owner', type: 'reading' },
            {
                examId: htmlExamId,
                reuseWindow: examWindow,
                launchOwnership: htmlOwnership
            }
        ), examWindow);
        const htmlRegistration = app._captureExamSessionRegistration(htmlExamId);
        assert(htmlRegistration && htmlRegistration.navigationOwnership);

        let markDiscardEntered;
        let releaseDiscard;
        const discardEntered = new Promise(resolve => { markDiscardEntered = resolve; });
        const discardGate = new Promise(resolve => { releaseDiscard = resolve; });
        app._discardActiveSessionsForExam = async () => {
            markDiscardEntered();
            await discardGate;
            return 0;
        };
        const aborting = app._abortOwnedExamLaunch(
            htmlExamId,
            examWindow,
            htmlOwnership,
            htmlRegistration
        );
        await discardEntered;
        assert.strictEqual(app.examWindows.has(htmlExamId), false);

        const pdfOwnership = app._beginExamLaunchOwnership(pdfExamId, {
            reuseWindow: examWindow
        });
        assert.strictEqual(app._openPdfWindow(
            { id: pdfExamId, title: 'PDF replacement', type: 'reading' },
            `http://localhost/${pdfExamId}.pdf`,
            { reuseWindow: examWindow, launchOwnership: pdfOwnership }
        ), examWindow);
        assert.notStrictEqual(
            app._examWindowCommittedNavigationOwners.get(examWindow),
            htmlRegistration.navigationOwnership
        );
        assert.strictEqual(app.examWindows.has(pdfExamId), false, 'raw PDF must remain unmanaged');

        releaseDiscard();
        assert.strictEqual(await aborting, true);
        assert.strictEqual(closeCount, 0, 'the stale HTML abort must not close the newer raw PDF');
        assert.strictEqual(examWindow.closed, false);
        assert.strictEqual(examWindow.location.href, `http://localhost/${pdfExamId}.pdf`);
    }

    // Popup fallback may register the host window, but startup abort must never close the app itself.
    {
        const app = createApp(windowStub);
        const examId = 'reading-host-window-start-abort';
        const hadClose = Object.prototype.hasOwnProperty.call(windowStub, 'close');
        const originalClose = windowStub.close;
        let hostCloseCount = 0;
        windowStub.close = () => { hostCloseCount += 1; };
        const info = {
            window: windowStub,
            expectedSessionId: 'host-window-abort-session',
            windowSessionToken: 'host-window-abort-token',
            windowSessionTokenSessionId: 'host-window-abort-session',
            sessionGeneration: 1,
            suiteSessionId: null,
            expectedOrigin: 'http://localhost'
        };
        app.examWindows = new Map([[examId, info]]);
        app.messageHandlers = new Map([[examId, () => {}]]);
        const launchOwnership = app._beginExamLaunchOwnership(examId, { reuseWindow: windowStub });
        const registration = app._captureExamSessionRegistration(examId, info);
        try {
            assert.strictEqual(
                await app._abortOwnedExamLaunch(examId, windowStub, launchOwnership, registration),
                true
            );
            assert.strictEqual(hostCloseCount, 0);
            assert.strictEqual(app.examWindows.has(examId), false);
        } finally {
            if (hadClose) windowStub.close = originalClose;
            else delete windowStub.close;
        }
    }

    // Launch ownership reserves implicit names, cannot be widened by a caller, and gates guard retries.
    {
        const app = createApp(windowStub);
        const implicitExamId = 'reading-implicit-lease';
        const implicitOwnership = app._beginExamLaunchOwnership(implicitExamId, {});
        assert(implicitOwnership.targetLeaseKeys.includes(`window-name:exam_${implicitExamId}`));
        assert(implicitOwnership.targetLeaseKeys.includes(`window-name:pdf_${implicitExamId}`));

        let staleOpenCount = 0;
        const originalOpenExamWindow = app.openExamWindow;
        app.openExamWindow = () => {
            staleOpenCount += 1;
            return createStubWindow('unexpected-expanded-target');
        };
        assert.strictEqual(await app.openExam(implicitExamId, {
            examDefinition: { id: implicitExamId, title: 'Implicit lease', type: 'reading', hasHtml: true },
            launchOwnership: implicitOwnership,
            windowName: 'caller-added-target'
        }), null);
        assert.strictEqual(staleOpenCount, 0, 'an adopted launch token must not gain a new named target');
        app.openExamWindow = originalOpenExamWindow;

        const sharedWindow = createStubWindow(`exam_${implicitExamId}`);
        app._beginExamLaunchOwnership('reading-window-holder', { reuseWindow: sharedWindow });
        const staleImplicit = app._beginExamLaunchOwnership(implicitExamId, {});
        Object.defineProperty(sharedWindow, 'name', {
            configurable: true,
            get() { throw new Error('cross-origin name'); }
        });
        const opaqueWinner = app._beginExamLaunchOwnership('reading-window-winner', { reuseWindow: sharedWindow });
        assert.strictEqual(
            app._isExamLaunchOwnershipCurrent(implicitExamId, staleImplicit),
            false,
            'claiming an opaque WindowProxy must transfer its previously proven named lease'
        );
        const inheritedTargetKey = `window-name:exam_${implicitExamId}`;
        const interveningNamedLaunch = app._beginExamLaunchOwnership('reading-window-name-intervening', {
            windowName: `exam_${implicitExamId}`
        });
        assert.strictEqual(
            app._isExamLaunchOwnershipCurrent('reading-window-winner', opaqueWinner),
            false,
            'an inherited effective target key must remain part of the opaque owner lease'
        );
        const secondOpaqueWinner = app._beginExamLaunchOwnership('reading-window-second-winner', {
            reuseWindow: sharedWindow
        });
        assert.strictEqual(
            app._isExamLaunchOwnershipCurrent('reading-window-name-intervening', interveningNamedLaunch),
            false,
            'a later opaque reuse must transfer the proven target key across multiple generations'
        );
        assert(
            app._examLaunchOwnershipTargetLeaseKeys.get(secondOpaqueWinner).has(inheritedTargetKey),
            'the multi-generation owner must retain the inherited effective target key'
        );
        const secondNamedWindow = createStubWindow(`exam_${implicitExamId}`);
        const secondNamedOwner = app._beginExamLaunchOwnership('reading-window-second-context', {
            windowName: `exam_${implicitExamId}`
        });
        assert.strictEqual(
            app._claimExamLaunchWindowOwnership(
                secondNamedOwner,
                secondNamedWindow,
                `exam_${implicitExamId}`
            ),
            true
        );
        const opaqueFirstContextReuse = app._beginExamLaunchOwnership('reading-window-first-context-reuse', {
            reuseWindow: sharedWindow
        });
        assert.strictEqual(
            app._isExamLaunchOwnershipCurrent('reading-window-second-context', secondNamedOwner),
            true,
            'an opaque reuse of P1 must not steal a target name now proven to resolve to P2'
        );
        assert.strictEqual(
            app._examLaunchOwnershipTargetLeaseKeys.get(opaqueFirstContextReuse).has(inheritedTargetKey),
            false
        );

        const renamedWindow = createStubWindow('proof-name-foo');
        app._beginExamLaunchOwnership('reading-proof-name-holder', { reuseWindow: renamedWindow });
        assert.strictEqual(
            app._resolveExamLaunchProvenWindow('window-name:proof-name-foo'),
            renamedWindow
        );
        renamedWindow.name = 'proof-name-bar';
        const pendingFooOwner = app._beginExamLaunchOwnership('reading-proof-name-pending-foo', {
            windowName: 'proof-name-foo'
        });
        app._beginExamLaunchOwnership('reading-proof-name-bar-reuse', {
            reuseWindow: renamedWindow
        });
        assert.strictEqual(
            app._isExamLaunchOwnershipCurrent('reading-proof-name-pending-foo', pendingFooOwner),
            true,
            'a readable rename must revoke the old proof instead of stealing the pending old name'
        );
        assert.strictEqual(app._resolveExamLaunchProvenWindow('window-name:proof-name-foo'), null);
        assert.strictEqual(
            app._resolveExamLaunchProvenWindow('window-name:proof-name-bar'),
            renamedWindow
        );

        const closedProofWindow = createStubWindow('proof-name-closed');
        app._beginExamLaunchOwnership('reading-proof-name-closed-holder', {
            reuseWindow: closedProofWindow
        });
        const closedProofKey = 'window-name:proof-name-closed';
        const storedClosedProof = app._examLaunchProvenWindowByTargetKey.get(closedProofKey);
        if (typeof WeakRef === 'function') {
            assert.notStrictEqual(storedClosedProof, closedProofWindow, 'proof map must not strongly retain WindowProxy');
            assert.strictEqual(typeof storedClosedProof.deref, 'function');
        }
        closedProofWindow.closed = true;
        assert.strictEqual(app._resolveExamLaunchProvenWindow(closedProofKey), null);
        assert.strictEqual(app._examLaunchProvenWindowByTargetKey.has(closedProofKey), false);

        const committedReservationApp = createApp(windowStub);
        for (let index = 0; index < 4; index += 1) {
            const committedExamId = `reading-committed-reservation-${index}`;
            const committedWindow = createStubWindow(`committed-actual-name-${index}`);
            const customWindowName = `committed-custom-name-${index}`;
            const committedOwnership = committedReservationApp._beginExamLaunchOwnership(
                committedExamId,
                {
                    reuseWindow: committedWindow,
                    windowName: customWindowName
                }
            );
            assert.strictEqual(
                committedReservationApp._examLaunchOwnershipExplicitWindows.get(committedOwnership),
                committedWindow
            );
            const launchOptions = {
                examId: committedExamId,
                reuseWindow: committedWindow,
                windowName: customWindowName,
                launchOwnership: committedOwnership
            };
            assert.strictEqual(
                committedReservationApp.openExamWindow(
                    `http://localhost/${committedExamId}.html`,
                    { id: committedExamId, title: 'Committed reservation', type: 'reading' },
                    launchOptions
                ),
                committedWindow
            );
            assert(
                launchOptions.navigationRegistration
                && committedReservationApp._isExamSessionRegistrationCurrent(
                    committedExamId,
                    launchOptions.navigationRegistration
                ),
                'navigation must install an exact registration before releasing its reservation'
            );
            assert.strictEqual(
                committedReservationApp._commitExamLaunchOwnership(committedOwnership),
                true
            );
            assert.strictEqual(committedReservationApp._examLaunchOwnerships.has(committedExamId), false);
            assert.strictEqual(
                committedReservationApp._examLaunchTargetOwnerships.size,
                0,
                'successful unique named launches must not accumulate target reservations'
            );
            assert.strictEqual(
                committedReservationApp._examLaunchWindowOwnerships.get(committedWindow),
                undefined
            );
            assert.strictEqual(
                committedReservationApp._examLaunchOwnershipExplicitWindows.has(committedOwnership),
                false,
                'commit must release the token side table strong WindowProxy reference'
            );
            assert.strictEqual(
                committedReservationApp._claimExamLaunchWindowOwnership(
                    committedOwnership,
                    committedWindow,
                    customWindowName
                ),
                false,
                'a committed continuation must never reacquire its released reservation'
            );
            assert.strictEqual(
                committedReservationApp._isExamLaunchOwnershipCurrent(
                    committedExamId,
                    committedOwnership,
                    null,
                    committedWindow
                ),
                false
            );
            if (index === 0) {
                const provenName = `committed-actual-name-${index}`;
                const pendingNamedOwnership = committedReservationApp._beginExamLaunchOwnership(
                    'reading-committed-proof-pending',
                    { windowName: provenName }
                );
                Object.defineProperty(committedWindow, 'name', {
                    configurable: true,
                    get() { throw new Error('cross-origin name'); }
                });
                const opaqueReuseOwnership = committedReservationApp._beginExamLaunchOwnership(
                    'reading-committed-proof-opaque-reuse',
                    { reuseWindow: committedWindow }
                );
                assert.strictEqual(
                    committedReservationApp._isExamLaunchOwnershipCurrent(
                        'reading-committed-proof-pending',
                        pendingNamedOwnership
                    ),
                    false,
                    'weak name proof must survive reservation release and protect a later opaque reuse'
                );
                assert.strictEqual(
                    committedReservationApp._rollbackExamLaunchOwnership(opaqueReuseOwnership),
                    true
                );
                assert.strictEqual(
                    committedReservationApp._rollbackExamLaunchOwnership(pendingNamedOwnership),
                    true
                );
                assert.strictEqual(committedReservationApp._examLaunchTargetOwnerships.size, 0);
            }
            committedWindow.closed = true;
            assert.strictEqual(
                committedReservationApp._resolveExamLaunchProvenWindow(
                    `window-name:committed-actual-name-${index}`
                ),
                null,
                'closed committed windows must not retain a proven-name resolution'
            );
        }

        const rollbackApp = createApp(windowStub);
        const rollbackWindow = createStubWindow('rollback-nested-target');
        const rollbackExamId = 'reading-rollback-nested';
        rollbackApp.setupExamWindowCommunication(
            rollbackWindow,
            rollbackExamId,
            { id: rollbackExamId, title: 'Installed launch owner', type: 'reading' },
            { expectedUrl: 'http://localhost/exam.html' }
        );
        const installedInfo = rollbackApp.examWindows.get(rollbackExamId);
        const installedHandler = rollbackApp.messageHandlers.get(rollbackExamId);
        const installedRegistration = rollbackApp._captureExamSessionRegistration(
            rollbackExamId,
            installedInfo
        );
        const predecessor = rollbackApp._beginExamLaunchOwnership(rollbackExamId, {
            reuseWindow: rollbackWindow,
            windowName: rollbackWindow.name
        });
        const staleReservation = rollbackApp._beginExamLaunchOwnership(rollbackExamId, {
            reuseWindow: rollbackWindow,
            windowName: rollbackWindow.name
        });
        const newestReservation = rollbackApp._beginExamLaunchOwnership(rollbackExamId, {
            reuseWindow: rollbackWindow,
            windowName: rollbackWindow.name
        });
        assert.strictEqual(rollbackApp._rollbackExamLaunchOwnership(staleReservation), false);
        assert.strictEqual(rollbackApp._rollbackExamLaunchOwnership(newestReservation), true);
        assert.strictEqual(
            rollbackApp._isExamLaunchOwnershipCurrent(
                rollbackExamId,
                predecessor,
                null,
                rollbackWindow
            ),
            false,
            'a failed nested reservation must not resurrect an older open continuation'
        );
        assert.strictEqual(
            rollbackApp._isExamSessionRegistrationCurrent(
                rollbackExamId,
                installedRegistration
            ),
            true,
            'pre-navigation reservations must not invalidate the installed page registration'
        );
        assert.strictEqual(
            rollbackApp.messageHandlers.get(rollbackExamId),
            installedHandler
        );
        const messagesBeforeInstalledRequest = rollbackWindow._messages.length;
        await installedHandler({
            source: rollbackWindow,
            origin: 'http://localhost',
            data: {
                type: 'REQUEST_INIT',
                source: 'practice_page',
                data: { examId: rollbackExamId }
            }
        });
        assert(
            rollbackWindow._messages.length > messagesBeforeInstalledRequest,
            'a failed pre-navigation launch must not disable the installed page protocol'
        );
        const nextReservation = rollbackApp._beginExamLaunchOwnership(rollbackExamId, {
            reuseWindow: rollbackWindow,
            windowName: rollbackWindow.name
        });
        assert.strictEqual(
            rollbackApp._isExamLaunchOwnershipCurrent(
                rollbackExamId,
                nextReservation,
                null,
                rollbackWindow
            ),
            true,
            'a later launch must replace stale reservations without traversing predecessor chains'
        );
        const rollbackInfo = rollbackApp.examWindows.get(rollbackExamId);
        if (rollbackInfo && rollbackInfo.closeMonitor) clearInterval(rollbackInfo.closeMonitor);

        for (const takeoverMode of ['pre-navigation-failure', 'committed-navigation']) {
            const guardApp = createApp(windowStub);
            const guardExamId = `reading-guard-retry-owner-${takeoverMode}`;
            const guardWindow = createStubWindow(`guard-retry-window-${takeoverMode}`);
            let replaceCount = 0;
            guardWindow.location = {
                href: 'about:blank',
                replace(url) {
                    replaceCount += 1;
                    this.href = url;
                }
            };
            const originalSetTimeout = sandbox.setTimeout;
            const originalShouldUsePlaceholder = guardApp._shouldUsePlaceholderPage;
            let scheduledRetry = null;
            sandbox.setTimeout = (callback) => {
                scheduledRetry = callback;
                return 1;
            };
            guardApp._shouldUsePlaceholderPage = () => true;
            try {
                const guardOwnership = guardApp._beginExamLaunchOwnership(guardExamId, {
                    reuseWindow: guardWindow
                });
                const navigationOwnership = guardApp._recordExamWindowNavigation(
                    guardWindow,
                    guardExamId
                );
                const navigationRegistration = guardApp._installExamNavigationProvisionalRegistration(
                    guardExamId,
                    guardWindow,
                    { expectedUrl: 'about:blank' }
                );
                guardApp._guardExamWindowContent(
                    guardWindow,
                    { id: guardExamId, title: 'Guard retry' },
                    {
                        examId: guardExamId,
                        launchOwnership: guardOwnership,
                        navigationOwnership,
                        navigationRegistration,
                        guardRetryCount: 3
                    }
                );
                assert.strictEqual(typeof scheduledRetry, 'function');

                const replacementOwnership = guardApp._beginExamLaunchOwnership(guardExamId, {
                    reuseWindow: guardWindow
                });
                if (takeoverMode === 'pre-navigation-failure') {
                    assert.strictEqual(guardApp._rollbackExamLaunchOwnership(replacementOwnership), true);
                    scheduledRetry();
                    assert.strictEqual(
                        replaceCount,
                        1,
                        'a failed pre-navigation reservation must not suppress the installed page retry'
                    );
                    assert.notStrictEqual(guardWindow.location.href, 'about:blank');
                } else {
                    const replacementUrl = `http://localhost/${guardExamId}-replacement.html`;
                    assert.strictEqual(guardApp.openExamWindow(
                        replacementUrl,
                        { id: guardExamId, title: 'Committed replacement', type: 'reading' },
                        {
                            examId: guardExamId,
                            reuseWindow: guardWindow,
                            launchOwnership: replacementOwnership
                        }
                    ), guardWindow);
                    scheduledRetry();
                    assert.strictEqual(
                        replaceCount,
                        0,
                        'a real navigation must invalidate the older installed-page retry'
                    );
                    assert.strictEqual(guardWindow.location.href, replacementUrl);
                }
            } finally {
                sandbox.setTimeout = originalSetTimeout;
                guardApp._shouldUsePlaceholderPage = originalShouldUsePlaceholder;
            }
        }

        for (const successorMode of ['same-navigation', 'new-navigation']) {
            const guardApp = createApp(windowStub);
            const guardExamId = `reading-guard-managed-successor-${successorMode}`;
            const guardWindow = createStubWindow(`guard-managed-successor-${successorMode}`);
            guardWindow.addEventListener = () => {};
            let replaceCount = 0;
            guardWindow.location = {
                href: 'about:blank',
                replace(url) {
                    replaceCount += 1;
                    this.href = url;
                }
            };
            const originalSetTimeout = sandbox.setTimeout;
            const originalShouldUsePlaceholder = guardApp._shouldUsePlaceholderPage;
            let scheduledRetry = null;
            sandbox.setTimeout = (callback) => {
                scheduledRetry = callback;
                return 1;
            };
            guardApp._shouldUsePlaceholderPage = () => true;
            try {
                const navigationOwnership = guardApp._recordExamWindowNavigation(
                    guardWindow,
                    guardExamId
                );
                const provisionalRegistration = guardApp._installExamNavigationProvisionalRegistration(
                    guardExamId,
                    guardWindow,
                    { expectedUrl: 'about:blank' }
                );
                guardApp._guardExamWindowContent(
                    guardWindow,
                    { id: guardExamId, title: 'Guard managed successor' },
                    {
                        examId: guardExamId,
                        navigationOwnership,
                        navigationRegistration: provisionalRegistration,
                        guardRetryCount: 3
                    }
                );
                assert.strictEqual(typeof scheduledRetry, 'function');
                const guardRetry = scheduledRetry;

                const successorNavigationOwnership = successorMode === 'new-navigation'
                    ? guardApp._recordExamWindowNavigation(guardWindow, guardExamId)
                    : navigationOwnership;
                const managedRegistration = guardApp.setupExamWindowManagement(
                    guardWindow,
                    guardExamId,
                    { id: guardExamId, title: 'Managed successor', type: 'reading' },
                    {
                        expectedRegistration: provisionalRegistration,
                        expectedUrl: 'about:blank',
                        skipContentGuard: true,
                        deferInitialHandshake: true
                    }
                );
                assert(managedRegistration, 'setup must install the managed successor registration');
                assert.notStrictEqual(managedRegistration.windowInfo, provisionalRegistration.windowInfo);
                assert.strictEqual(
                    managedRegistration.navigationOwnership,
                    successorNavigationOwnership
                );

                guardRetry();
                assert.strictEqual(
                    replaceCount,
                    successorMode === 'same-navigation' ? 1 : 0,
                    successorMode === 'same-navigation'
                        ? 'a managed successor on the same navigation must inherit the pending retry'
                        : 'a managed successor after a new navigation must reject the stale retry'
                );
                const managedInfo = guardApp.examWindows.get(guardExamId);
                if (managedInfo && managedInfo.closeMonitor) clearInterval(managedInfo.closeMonitor);
                if (guardApp._handshakeTimers && guardApp._handshakeTimers.has(guardExamId)) {
                    clearInterval(guardApp._handshakeTimers.get(guardExamId));
                }
                const managedHandler = guardApp.messageHandlers
                    && guardApp.messageHandlers.get(guardExamId);
                if (managedHandler) {
                    windowStub.removeEventListener('message', managedHandler);
                    guardApp.messageHandlers.delete(guardExamId);
                }
            } finally {
                sandbox.setTimeout = originalSetTimeout;
                guardApp._shouldUsePlaceholderPage = originalShouldUsePlaceholder;
            }
        }
    }

    // Managed suiteSessionId:null is an ordinary owner even while the same exam is active in a suite.
    {
        const app = createApp(windowStub);
        const examId = 'reading-managed-ordinary-owner';
        const examWindow = createStubWindow('managed-ordinary-window');
        const windowInfo = {
            window: examWindow,
            expectedSessionId: 'managed-ordinary-session',
            windowSessionToken: 'managed-ordinary-token',
            windowSessionTokenSessionId: 'managed-ordinary-session',
            sessionGeneration: 1,
            suiteSessionId: null,
            expectedOrigin: 'http://localhost',
            allowOpaqueOrigin: false,
            status: 'active'
        };
        app.examWindows = new Map([[examId, windowInfo]]);
        app.currentSuiteSession = {
            id: 'suite-managed-ordinary',
            status: 'active',
            activeExamId: examId,
            currentIndex: 0,
            sequence: [{ examId }],
            results: []
        };
        app.suiteExamMap.set(examId, app.currentSuiteSession.id);
        let resolverCalls = 0;
        app._resolveSuiteSessionId = () => {
            resolverCalls += 1;
            return app.currentSuiteSession.id;
        };
        const initPayload = app._buildExamInitPayload(examId, windowInfo);
        assert.strictEqual(initPayload.suiteSessionId, null);
        assert.strictEqual(resolverCalls, 0, 'explicit null must bypass global suite inference');

        const registration = app._captureExamSessionRegistration(examId, windowInfo);
        let suiteReadyCalls = 0;
        let suiteReviewNavigateCalls = 0;
        let ordinaryReviewNavigateCalls = 0;
        let simulationNavigateCalls = 0;
        app._handleSuiteSessionReady = () => { suiteReadyCalls += 1; };
        app.handleSuiteReviewNavigate = async () => {
            suiteReviewNavigateCalls += 1;
            return true;
        };
        app.handleReviewReplayNavigate = async () => {
            ordinaryReviewNavigateCalls += 1;
            return true;
        };
        app._handleSimulationNavigate = async () => { simulationNavigateCalls += 1; };
        assert.strictEqual(app.handleSessionReady(examId, {
            examId,
            sessionId: 'forged-ready-session',
            windowSessionToken: windowInfo.windowSessionToken,
            initialized: true
        }, { expectedRegistration: registration }), false);
        assert.strictEqual(windowInfo.expectedSessionId, registration.expectedSessionId);
        assert.strictEqual(app.handleSessionReady(examId, {
            examId,
            sessionId: registration.expectedSessionId,
            suiteSessionId: app.currentSuiteSession.id,
            windowSessionToken: windowInfo.windowSessionToken,
            initialized: true
        }, { expectedRegistration: registration }), false);
        assert.strictEqual(windowInfo.suiteSessionId, null);
        assert.strictEqual(suiteReadyCalls, 0);

        examWindow.addEventListener = () => {};
        app.setupExamWindowCommunication(examWindow, examId, null, {
            expectedRegistration: registration
        });
        const dispatchForgedSuiteMessage = async (type, extra = {}) => {
            windowStub.__dispatchEvent('message', {
                source: examWindow,
                origin: 'http://localhost',
                data: {
                    type,
                    source: 'practice_page',
                    data: {
                        examId,
                        sessionId: registration.expectedSessionId,
                        suiteSessionId: app.currentSuiteSession.id,
                        windowSessionToken: registration.windowSessionToken,
                        ...extra
                    }
                }
            });
            await Promise.resolve();
        };
        windowStub.__dispatchEvent('message', {
            source: examWindow,
            origin: 'http://localhost',
            data: {
                type: 'SESSION_READY',
                source: 'practice_page',
                data: {
                    examId,
                    sessionId: registration.expectedSessionId
                }
            }
        });
        await Promise.resolve();
        assert.strictEqual(windowInfo.dataCollectorReady, undefined, 'tokenless ordinary READY must stay bootstrap-ineligible');
        await dispatchForgedSuiteMessage('SESSION_READY', { initialized: true });
        await dispatchForgedSuiteMessage('REVIEW_NAVIGATE', {
            direction: 'next',
            suiteReviewMode: true
        });
        await dispatchForgedSuiteMessage('SIMULATION_NAVIGATE', { direction: 'next' });
        await dispatchForgedSuiteMessage('SIMULATION_ACTIVE_EXAM_CHANGE');
        assert.strictEqual(windowInfo.suiteSessionId, null);
        assert.strictEqual(suiteReadyCalls, 0);
        assert.strictEqual(suiteReviewNavigateCalls, 0);
        assert.strictEqual(ordinaryReviewNavigateCalls, 0);
        assert.strictEqual(simulationNavigateCalls, 0);
        assert.strictEqual(app.currentSuiteSession.activeExamId, examId);

        let suiteCompletionCalls = 0;
        let recorderPayload = null;
        app.handleSuitePracticeComplete = async () => {
            suiteCompletionCalls += 1;
            return true;
        };
        app.components.practiceRecorder = {
            async handleSessionCompleted(payload) {
                recorderPayload = { ...payload };
                return {
                    id: 'managed-ordinary-record',
                    examId,
                    sessionId: payload.sessionId,
                    endTime: payload.endTime
                };
            }
        };
        app._isPracticeCompletionPersisted = async () => true;
        app._announceSubmittedReadingRecord = () => false;
        app._announcePracticeSubmitOutcome = () => false;
        app.clearReadingDraftForExam = async () => false;
        app.showRealCompletionNotification = async () => true;
        app.cleanupExamSession = async () => true;
        app.updateExamStatus = () => {};
        assert.strictEqual(await app.handlePracticeComplete(examId, {
            sessionId: windowInfo.expectedSessionId,
            submissionId: 'managed-ordinary-submit',
            endTime: '2026-08-09T00:00:00.000Z'
        }, examWindow, { expectedRegistration: registration }), true);
        assert.strictEqual(suiteCompletionCalls, 0);
        assert.strictEqual(Object.prototype.hasOwnProperty.call(recorderPayload, 'suiteSessionId'), true);
        assert.strictEqual(recorderPayload.suiteSessionId, null);
        assert.strictEqual(recorderPayload.practiceMode, 'single');
        assert.strictEqual(windowInfo.suiteSessionId, null);
        assert.deepStrictEqual(plain(app.currentSuiteSession.results), []);

        for (let attempt = 0; attempt < 2; attempt += 1) {
            assert.strictEqual(await app.handlePracticeComplete(examId, {
                sessionId: windowInfo.expectedSessionId,
                submissionId: `forged-suite-submit-${attempt}`,
                suiteSessionId: app.currentSuiteSession.id,
                suiteId: 'forged-entry',
                endTime: '2026-08-09T00:00:00.000Z'
            }, examWindow, { expectedRegistration: registration }), false);
        }
        assert.strictEqual(suiteCompletionCalls, 0);
        assert.strictEqual(windowInfo.suiteSessionId, null);
        assert.deepStrictEqual(plain(app.currentSuiteSession.results), []);
        const installedHandler = app.messageHandlers && app.messageHandlers.get(examId);
        if (installedHandler) windowStub.removeEventListener('message', installedHandler);
    }

    // A durable suite completion still acknowledges the exact E1 registration after E2 reserves the shared target.
    {
        const app = createApp(windowStub);
        const examId = 'reading-suite-ack-owner';
        const suiteSessionId = 'suite-ack-owner';
        const examWindow = createStubWindow('suite-ack-shared-target');
        const windowInfo = {
            window: examWindow,
            expectedSessionId: 'suite-ack-session',
            windowSessionToken: 'suite-ack-token',
            windowSessionTokenSessionId: 'suite-ack-session',
            sessionGeneration: 1,
            suiteSessionId,
            expectedOrigin: 'http://localhost',
            allowOpaqueOrigin: false,
            status: 'active'
        };
        app.examWindows = new Map([[examId, windowInfo]]);
        app.currentSuiteSession = {
            id: suiteSessionId,
            status: 'active',
            activeExamId: examId,
            currentIndex: 0,
            sequence: [{ examId }],
            results: []
        };
        const launchOwnership = app._beginExamLaunchOwnership(examId, {
            reuseWindow: examWindow,
            windowName: examWindow.name
        });
        const registration = app._captureExamSessionRegistration(examId, windowInfo);
        app.handleSuitePracticeComplete = async () => {
            app._beginExamLaunchOwnership('reading-suite-ack-next', {
                windowName: examWindow.name
            });
            assert.strictEqual(app._isExamLaunchOwnershipCurrent(examId, launchOwnership), false);
            return {
                handled: true,
                committed: true,
                errorCode: 'suite_advance_superseded'
            };
        };
        assert.strictEqual(await app.handlePracticeComplete(examId, {
            examId,
            sessionId: registration.expectedSessionId,
            suiteSessionId,
            submissionId: 'suite-ack-submission',
            endTime: '2026-08-09T00:00:00.000Z'
        }, examWindow, {
            expectedRegistration: registration,
            launchOwnership
        }), true);
        assert(
            examWindow._messages.some(message => message && message.type === 'PRACTICE_SUBMIT_ACK'),
            'durable suite outcome must ACK through the frozen exact registration after launch lease handoff'
        );
        assert.strictEqual(
            examWindow._messages.some(message => message && message.type === 'PRACTICE_SUBMIT_FAILED'),
            false
        );
        assert.strictEqual(app.examWindows.get(examId), windowInfo);
    }

    // A memorize reset must not mutate its old registration before the replacement open owns it.
    {
        const app = createApp(windowStub);
        const examId = 'reading-reset-launch-owner';
        const examWindow = createStubWindow('reset-owner-window');
        const windowInfo = {
            window: examWindow,
            expectedSessionId: 'reset-owner-session',
            windowSessionToken: 'reset-owner-token',
            windowSessionTokenSessionId: 'reset-owner-session',
            sessionGeneration: 1,
            suiteSessionId: null,
            practiceMode: 'memorize',
            reviewMode: true,
            readOnly: true,
            status: 'completed',
            submittedRecordId: 'old-record'
        };
        app.examWindows = new Map([[examId, windowInfo]]);
        const launchOwnership = app._beginExamLaunchOwnership(examId, { reuseWindow: examWindow });
        const registration = app._captureExamSessionRegistration(examId, windowInfo);
        let markOpenEntered;
        let releaseOpen;
        const openEntered = new Promise(resolve => { markOpenEntered = resolve; });
        const openGate = new Promise(resolve => { releaseOpen = resolve; });
        app.openExam = async () => {
            markOpenEntered();
            await openGate;
            return null;
        };
        const resetting = app.handlePracticeResetRequest(examId, {
            reason: 'memorize-start-test'
        }, examWindow, { expectedRegistration: registration, launchOwnership });
        await openEntered;
        assert.strictEqual(windowInfo.practiceMode, 'memorize');
        assert.strictEqual(windowInfo.reviewMode, true);
        assert.strictEqual(windowInfo.readOnly, true);
        assert.strictEqual(windowInfo.status, 'completed');
        assert.strictEqual(windowInfo.submittedRecordId, 'old-record');
        app._beginExamLaunchOwnership(examId, { reuseWindow: examWindow });
        releaseOpen();
        assert.strictEqual(await resetting, null);
        assert.strictEqual(windowInfo.practiceMode, 'memorize');
        assert.strictEqual(windowInfo.status, 'completed');
    }

    // A completion that loses ownership may finish A's durable write, but cannot rebind or delete B.
    {
        const app = createApp(windowStub);
        const examId = 'reading-completion-owner-overlap';
        const oldWindow = createStubWindow('completion-old-window');
        const newWindow = createStubWindow('completion-new-window');
        const oldInfo = {
            window: oldWindow,
            expectedSessionId: 'completion-old-session',
            windowSessionToken: 'completion-old-token',
            windowSessionTokenSessionId: 'completion-old-session',
            sessionGeneration: 1,
            suiteSessionId: null,
            expectedOrigin: 'http://localhost'
        };
        const newInfo = {
            window: newWindow,
            expectedSessionId: 'completion-new-session',
            windowSessionToken: 'completion-new-token',
            windowSessionTokenSessionId: 'completion-new-session',
            sessionGeneration: 2,
            suiteSessionId: null,
            expectedOrigin: 'http://localhost'
        };
        app.examWindows = new Map([[examId, oldInfo]]);
        const oldHandler = () => {};
        const newHandler = () => {};
        app.messageHandlers = new Map([[examId, oldHandler]]);
        const launchOwnership = app._beginExamLaunchOwnership(examId, { reuseWindow: oldWindow });
        const oldRegistration = app._captureExamSessionRegistration(examId, oldInfo);
        await windowStub.AppData.recovery.saveActiveSession({
            id: 'active-session:completion-old-session', examId, sessionId: 'completion-old-session'
        });
        await windowStub.AppData.recovery.saveActiveSession({
            id: 'active-session:completion-new-session', examId, sessionId: 'completion-new-session'
        });
        let markRecorderEntered;
        let releaseRecorder;
        const recorderEntered = new Promise(resolve => { markRecorderEntered = resolve; });
        const recorderGate = new Promise(resolve => { releaseRecorder = resolve; });
        app.components.practiceRecorder = {
            async handleSessionCompleted(payload) {
                markRecorderEntered();
                await recorderGate;
                return {
                    id: 'completion-old-record',
                    examId,
                    sessionId: payload.sessionId,
                    endTime: payload.endTime
                };
            }
        };
        app._isPracticeCompletionPersisted = async () => true;
        let staleAnnouncementCount = 0;
        app._announceSubmittedReadingRecord = () => { staleAnnouncementCount += 1; return true; };
        app._announcePracticeSubmitOutcome = () => { staleAnnouncementCount += 1; return true; };
        const completing = app.handlePracticeComplete(examId, {
            sessionId: oldInfo.expectedSessionId,
            submissionId: 'completion-old-submit',
            endTime: '2026-08-09T00:00:00.000Z'
        }, oldWindow, { expectedRegistration: oldRegistration, launchOwnership });
        await recorderEntered;
        app._beginExamLaunchOwnership(examId, { reuseWindow: newWindow });
        app.examWindows.set(examId, newInfo);
        app.messageHandlers.set(examId, newHandler);
        releaseRecorder();
        assert.strictEqual(await completing, true);
        assert.strictEqual(staleAnnouncementCount, 0);
        assert.strictEqual(app.examWindows.get(examId), newInfo);
        assert.strictEqual(app.messageHandlers.get(examId), newHandler);
        const remaining = (await windowStub.AppData.recovery.listActiveSessions())
            .filter(item => item && item.examId === examId);
        assert.strictEqual(remaining.some(item => item.sessionId === 'completion-old-session'), false);
        assert.strictEqual(remaining.some(item => item.sessionId === 'completion-new-session'), true);
    }

    // Stable implicit window names must drive reuse cleanup even without options.reuseWindow.
    for (const reuseScope of ['same-exam', 'cross-exam']) {
        const app = createApp(windowStub);
        app.calculateWindowFeatures = () => '';
        const oldExamId = `reading-implicit-reuse-old-${reuseScope}`;
        const newExamId = reuseScope === 'same-exam'
            ? oldExamId
            : `reading-implicit-reuse-new-${reuseScope}`;
        const sharedWindow = createStubWindow(`exam_${newExamId}`);
        const registeredWindow = reuseScope === 'same-exam'
            ? createStubWindow(`exam_${newExamId}`)
            : sharedWindow;
        const oldSessionId = `implicit-reuse-session-${reuseScope}`;
        const oldInfo = {
            window: registeredWindow,
            expectedSessionId: oldSessionId,
            windowSessionToken: `implicit-reuse-token-${reuseScope}`,
            windowSessionTokenSessionId: oldSessionId,
            sessionGeneration: 1,
            suiteSessionId: null,
            expectedOrigin: 'http://localhost',
            allowOpaqueOrigin: false
        };
        app.examWindows = new Map([[oldExamId, oldInfo]]);
        app.messageHandlers = new Map([[oldExamId, () => {}]]);
        await windowStub.AppData.recovery.saveActiveSession({
            id: `active-session:${oldSessionId}`,
            examId: oldExamId,
            sessionId: oldSessionId,
            status: 'started'
        });
        const hadOpen = Object.prototype.hasOwnProperty.call(windowStub, 'open');
        const originalOpen = windowStub.open;
        windowStub.open = () => sharedWindow;
        try {
            const launchOptions = {
                examId: newExamId,
                launchOwnership: app._beginExamLaunchOwnership(newExamId, {})
            };
            assert.strictEqual(
                app.openExamWindow(
                    `http://localhost/${newExamId}.html`,
                    { id: newExamId, title: newExamId, type: 'reading' },
                    launchOptions
                ),
                sharedWindow
            );
            assert.strictEqual(launchOptions.windowReuseDetected, true);
            await app._cleanupReusedWindowSessions(sharedWindow, newExamId);
            const active = await windowStub.AppData.recovery.listActiveSessions();
            assert.strictEqual(active.some(item => item && item.sessionId === oldSessionId), false);
            if (reuseScope === 'same-exam') {
                assert.strictEqual(app.examWindows.has(oldExamId), true, 'same-exam provisional tuple must survive until setup');
                assert.strictEqual(app.examWindows.get(oldExamId).window, sharedWindow);
                assert.notStrictEqual(
                    app.examWindows.get(oldExamId),
                    oldInfo,
                    'the first navigation of a replacement WindowProxy must invalidate the installed tuple synchronously'
                );
                assert.strictEqual(app.messageHandlers.has(oldExamId), false);
            } else {
                assert.strictEqual(app.examWindows.has(oldExamId), false, 'cross-exam provisional tuple must be removed');
            }
        } finally {
            if (hadOpen) windowStub.open = originalOpen;
            else delete windowStub.open;
            await windowStub.AppData.recovery.discardActiveSession(`active-session:${oldSessionId}`);
        }
    }

    // Managed same-exam reuse retains the pending map tuple while deleting the frozen old recovery id.
    {
        const app = createApp(windowStub);
        const examId = 'reading-managed-reuse-recovery';
        const examWindow = createStubWindow('managed-reuse-window');
        const oldInfo = {
            window: examWindow,
            expectedSessionId: 'managed-reuse-old-session',
            windowSessionToken: 'managed-reuse-old-token',
            windowSessionTokenSessionId: 'managed-reuse-old-session',
            sessionGeneration: 1,
            suiteSessionId: null
        };
        app.examWindows = new Map([[examId, oldInfo]]);
        app.messageHandlers = new Map([[examId, () => {}]]);
        await windowStub.AppData.recovery.saveActiveSession({
            id: 'active-session:managed-reuse-old-session', examId, sessionId: 'managed-reuse-old-session'
        });
        assert.strictEqual(app._markExamWindowReusePending(examWindow), 1);
        const pendingInfo = app.examWindows.get(examId);
        assert.notStrictEqual(pendingInfo, oldInfo);
        assert.strictEqual(pendingInfo.reassignedFromExpectedSessionId, 'managed-reuse-old-session');
        const pendingRegistration = app._captureExamSessionRegistration(examId, pendingInfo);
        await app._cleanupReusedWindowSessions(examWindow, examId);
        assert.strictEqual(app._isExamSessionRegistrationCurrent(examId, pendingRegistration), true);
        const remaining = (await windowStub.AppData.recovery.listActiveSessions())
            .filter(item => item && item.examId === examId);
        assert.strictEqual(remaining.some(item => item.sessionId === 'managed-reuse-old-session'), false);
    }

    // A replay resolver failure is pre-navigation: keep the installed source tuple and index usable.
    {
        const app = createApp(windowStub);
        const examId = 'reading-review-resolver-source';
        const nextExamId = 'reading-review-resolver-target';
        const reviewSessionId = 'review-resolver-session';
        const reviewWindow = createStubWindow('review-resolver-window');
        app.setupExamWindowCommunication(
            reviewWindow,
            examId,
            { id: examId, title: 'Review source', type: 'reading' },
            { expectedUrl: 'http://localhost/exam.html' }
        );
        const sourceInfo = app.examWindows.get(examId);
        sourceInfo.reviewMode = true;
        sourceInfo.readOnly = true;
        sourceInfo.reviewSessionId = reviewSessionId;
        sourceInfo.reviewEntryIndex = 0;
        app.examWindows.set(examId, sourceInfo);
        const sourceRegistration = app._captureExamSessionRegistration(examId, sourceInfo);
        const sourceHandler = app.messageHandlers.get(examId);
        const reviewSession = {
            sessionId: reviewSessionId,
            recordId: 'review-resolver-record',
            currentIndex: 0,
            readOnly: true,
            windowRef: reviewWindow,
            entries: [
                { examId, title: 'Review source' },
                { examId: nextExamId, title: 'Review target' }
            ]
        };
        app._ensureReviewReplayStore().set(reviewSessionId, reviewSession);
        app._resolveReviewExamDefinition = async () => {
            throw new Error('expected resolver failure');
        };
        assert.strictEqual(await app.handleReviewReplayNavigate(
            examId,
            { direction: 'next', reviewSessionId },
            reviewWindow,
            { expectedRegistration: sourceRegistration }
        ), null);
        assert.strictEqual(reviewSession.currentIndex, 0);
        assert.strictEqual(app._isExamSessionRegistrationCurrent(examId, sourceRegistration), true);
        assert.strictEqual(app.messageHandlers.get(examId), sourceHandler);
        const messageCount = reviewWindow._messages.length;
        await sourceHandler({
            source: reviewWindow,
            origin: 'http://localhost',
            data: {
                type: 'REQUEST_INIT',
                source: 'practice_page',
                data: { examId }
            }
        });
        assert(reviewWindow._messages.length > messageCount);
        if (sourceInfo.closeMonitor) clearInterval(sourceInfo.closeMonitor);
    }

    // Suite review handoff must not treat a failed/absent exact source cleanup as release,
    // and must continue checking the exact target tuple after asynchronous context delivery.
    for (const cleanupMode of ['false', 'throw', 'missing']) {
        const app = createApp(windowStub);
        const session = makeSession(`suite-review-cleanup-${cleanupMode}`);
        session.flowMode = 'stationary';
        session.autoAdvanceAfterSubmit = false;
        session.results = [{ examId: 'reading-p1', title: 'Passage 1' }];
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));
        const sourceWindow = session.windowRef;
        const sourceInfo = {
            examId: 'reading-p1',
            window: sourceWindow,
            expectedSessionId: `review-cleanup-${cleanupMode}-source`,
            windowSessionToken: `review-cleanup-${cleanupMode}-token`,
            sessionGeneration: 1,
            suiteSessionId: session.id
        };
        app.examWindows = new Map([['reading-p1', sourceInfo]]);
        const sourceRegistration = app._captureExamSessionRegistration('reading-p1', sourceInfo);
        app._commitSuiteRecovery = async (_targetSession, commitOptions = {}) => {
            if (commitOptions.commitGuard && commitOptions.commitGuard() !== true) return false;
            if (typeof commitOptions.onDurableReceipt === 'function') {
                commitOptions.onDurableReceipt({ committed: true });
            }
            return true;
        };
        const cleanupCalls = [];
        if (cleanupMode === 'false') {
            app.cleanupExamSession = async (examId, cleanupOptions) => {
                cleanupCalls.push({ examId, cleanupOptions });
                return false;
            };
        } else if (cleanupMode === 'throw') {
            app.cleanupExamSession = async (examId, cleanupOptions) => {
                cleanupCalls.push({ examId, cleanupOptions });
                throw new Error('expected exact cleanup failure');
            };
        } else {
            app.cleanupExamSession = null;
        }
        let openCalls = 0;
        app.openExam = async () => {
            openCalls += 1;
            return createStubWindow('unexpected-review-target');
        };
        assert.strictEqual(await app.handleSuiteReviewNavigate(
            'reading-p1',
            { direction: 'next', suiteSessionId: session.id },
            sourceWindow,
            {
                expectedRegistration: sourceRegistration,
                commitGuard: () => app._isExamSessionRegistrationCurrent('reading-p1', sourceRegistration)
            }
        ), false);
        assert.strictEqual(openCalls, 0, `${cleanupMode} cleanup must stop before target navigation`);
        assert.strictEqual(cleanupCalls.length, cleanupMode === 'missing' ? 0 : 1);
        if (cleanupCalls.length) {
            assert.strictEqual(cleanupCalls[0].examId, 'reading-p1');
            assert.strictEqual(cleanupCalls[0].cleanupOptions.expectedRegistration, sourceRegistration);
        }
        assert.strictEqual(
            app._isExamSessionRegistrationCurrent('reading-p1', sourceRegistration),
            true,
            `${cleanupMode} cleanup must keep the frozen source registration authoritative`
        );
    }

    {
        const app = createApp(windowStub);
        const session = makeSession('suite-review-target-tuple-guard');
        session.flowMode = 'stationary';
        session.autoAdvanceAfterSubmit = false;
        session.results = [{ examId: 'reading-p1', title: 'Passage 1' }];
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map(item => [item.examId, session.id]));
        const sourceWindow = session.windowRef;
        const sourceInfo = {
            examId: 'reading-p1',
            window: sourceWindow,
            expectedSessionId: 'review-target-guard-source',
            windowSessionToken: 'review-target-guard-source-token',
            sessionGeneration: 1,
            suiteSessionId: session.id
        };
        app.examWindows = new Map([['reading-p1', sourceInfo]]);
        const sourceRegistration = app._captureExamSessionRegistration('reading-p1', sourceInfo);
        app._commitSuiteRecovery = async (_targetSession, commitOptions = {}) => {
            if (commitOptions.commitGuard && commitOptions.commitGuard() !== true) return false;
            if (typeof commitOptions.onDurableReceipt === 'function') {
                commitOptions.onDurableReceipt({ committed: true });
            }
            return true;
        };
        app.cleanupExamSession = async (examId, cleanupOptions = {}) => {
            assert.strictEqual(examId, 'reading-p1');
            assert.strictEqual(cleanupOptions.expectedRegistration, sourceRegistration);
            if (!app._isExamSessionRegistrationCurrent(examId, sourceRegistration)) return false;
            app.examWindows.delete(examId);
            return true;
        };
        const targetWindow = sourceWindow;
        let targetOpenCalls = 0;
        app.openExam = async (examId, openOptions = {}) => {
            targetOpenCalls += 1;
            return installManagedTestWindow(app, examId, targetWindow, openOptions);
        };
        app._waitForSuiteWindowExamReady = async () => true;
        let targetSendCalls = 0;
        let markTargetSendEntered;
        let releaseTargetSend;
        const targetSendEntered = new Promise((resolve) => { markTargetSendEntered = resolve; });
        const targetSendGate = new Promise((resolve) => { releaseTargetSend = resolve; });
        app._sendSuiteReviewState = async () => {
            targetSendCalls += 1;
            markTargetSendEntered();
            await targetSendGate;
            return true;
        };
        const targetNavigation = app.handleSuiteReviewNavigate(
            'reading-p1',
            { direction: 'next', suiteSessionId: session.id },
            sourceWindow,
            {
                expectedRegistration: sourceRegistration,
                commitGuard: () => app._isExamSessionRegistrationCurrent('reading-p1', sourceRegistration)
            }
        );
        await targetSendEntered;
        const targetInfoBeforeReplacement = app.examWindows.get('reading-p2');
        const replacementInfo = {
            ...targetInfoBeforeReplacement,
            expectedSessionId: 'review-target-reassigned-session',
            windowSessionToken: 'review-target-reassigned-token',
            sessionGeneration: Number(targetInfoBeforeReplacement.sessionGeneration || 0) + 1
        };
        app.examWindows.set('reading-p2', replacementInfo);
        releaseTargetSend();
        assert.strictEqual(
            await targetNavigation,
            false,
            'an async target tuple replacement must invalidate the review continuation'
        );
        assert.strictEqual(targetOpenCalls, 1, 'confirmed exact cleanup must proceed to target setup');
        assert.strictEqual(targetSendCalls, 1, 'the target tuple must be checked again after async delivery');
        assert.strictEqual(app.examWindows.get('reading-p2'), replacementInfo);
        assert.strictEqual(session.windowRef, targetWindow);
    }

    // The suite continuation must consume openExam's exact receipt. Re-reading the
    // global map would adopt either an ordinary tuple or a newer tuple with the same
    // suite id on the same exam and WindowProxy.
    for (const replacementMode of ['ordinary', 'same-suite']) {
        const app = createApp(windowStub);
        const suiteSessionId = `suite-post-open-${replacementMode}-replacement`;
        app._generateSuiteSessionId = () => suiteSessionId;
        const targetWindow = createStubWindow(`suite-post-open-${replacementMode}-window`);
        let replacementInfo = null;
        app.openExam = async (examId, options = {}) => {
            installManagedTestWindow(app, examId, targetWindow, options);
            const suiteInfo = app.examWindows.get(examId);
            queueMicrotask(() => {
                replacementInfo = {
                    ...suiteInfo,
                    suiteSessionId: replacementMode === 'ordinary' ? null : suiteSessionId,
                    expectedSessionId: `${replacementMode}-post-open-session`,
                    windowSessionToken: `${replacementMode}-post-open-token`,
                    windowSessionTokenSessionId: `${replacementMode}-post-open-session`,
                    sessionGeneration: Number(suiteInfo.sessionGeneration || 0) + 1
                };
                app.examWindows.set(examId, replacementInfo);
            });
            return targetWindow;
        };

        assert.strictEqual(
            await app._launchSuiteSessionFromSequence(
                makeSession(suiteSessionId).sequence,
                { flowMode: 'simulation' }
            ),
            false,
            `a suite launch must not adopt a queued ${replacementMode} replacement registration`
        );
        assert(app.currentSuiteSession && app.currentSuiteSession.id === suiteSessionId);
        assert.strictEqual(app.currentSuiteSession.windowRef, null);
        assert.strictEqual(app.examWindows.get('reading-p1'), replacementInfo);
        assert.strictEqual(
            String(replacementInfo.suiteSessionId || ''),
            replacementMode === 'ordinary' ? '' : suiteSessionId
        );
    }

    // Rebind reserves the target name before the proof await, while leaving the
    // candidate's installed registration untouched. Every independently frozen
    // identity and the reservation itself must survive before WindowProxy claim,
    // durable mutation, or setup.
    for (const replacementMode of [
        'ordinary-tuple',
        'committed-navigation',
        'window-binding',
        'launch-reservation',
        'commit-throw',
        'setup-throw'
    ]) {
        const app = createApp(windowStub);
        const session = makeSession(`suite-rebind-proof-${replacementMode}`);
        session.windowRef = null;
        session.windowBinding = {
            examId: 'reading-p1',
            expectedSessionId: 'rebind-proof-old-session',
            windowSessionToken: 'rebind-proof-old-token',
            sessionGeneration: 3,
            expectedUrl: 'http://localhost/exam.html?examId=reading-p1',
            expectedOrigin: 'http://localhost',
            allowOpaqueOrigin: false
        };
        const challengedBinding = session.windowBinding;
        session.currentIndex = 1;
        session.activeExamId = 'reading-p2';
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map((item) => [item.examId, session.id]));
        app.examWindows = app._createSuiteTestMap();

        const candidate = createStubWindow('ielts-suite-mode-tab');
        candidate.location.href = challengedBinding.expectedUrl;
        candidate.addEventListener = () => {};
        let challengedInfo = null;
        if (replacementMode === 'ordinary-tuple') {
            const stableNavigation = app._recordExamWindowNavigation(candidate, 'reading-p2');
            challengedInfo = {
                examId: 'reading-p2',
                window: candidate,
                navigationOwnership: stableNavigation,
                suiteSessionId: session.id,
                expectedSessionId: 'challenged-rebind-session',
                windowSessionToken: 'challenged-rebind-token',
                windowSessionTokenSessionId: 'challenged-rebind-session',
                sessionGeneration: 1,
                status: 'active'
            };
            app.examWindows.set('reading-p2', challengedInfo);
        }
        const originalPostMessage = candidate.postMessage.bind(candidate);
        let ordinaryInfo = null;
        let replacementNavigation = null;
        let replacementBinding = null;
        let replacementOwnership = null;
        candidate.postMessage = (payload, targetOrigin) => {
            originalPostMessage(payload, targetOrigin);
            if (!payload || payload.type !== 'SUITE_REBIND_CHALLENGE') return;
            queueMicrotask(() => {
                if (replacementMode === 'ordinary-tuple') {
                    ordinaryInfo = {
                        ...challengedInfo,
                        suiteSessionId: null,
                        expectedSessionId: 'ordinary-rebind-session',
                        windowSessionToken: 'ordinary-rebind-token',
                        windowSessionTokenSessionId: 'ordinary-rebind-session',
                        sessionGeneration: challengedInfo.sessionGeneration + 1,
                        status: 'active'
                    };
                    app.examWindows.set('reading-p2', ordinaryInfo);
                } else if (replacementMode === 'committed-navigation') {
                    replacementNavigation = app._recordExamWindowNavigation(candidate, 'reading-p2');
                } else if (replacementMode === 'launch-reservation') {
                    replacementOwnership = app._beginExamLaunchOwnership('reading-p2', {
                        windowName: 'ielts-suite-mode-tab',
                        reuseWindow: candidate
                    });
                } else if (replacementMode === 'window-binding') {
                    replacementBinding = {
                        ...challengedBinding,
                        windowSessionToken: 'newer-rebind-binding-token',
                        sessionGeneration: challengedBinding.sessionGeneration + 1
                    };
                    session.windowBinding = replacementBinding;
                }
                windowStub.__dispatchEvent('message', {
                    source: candidate,
                    origin: 'http://localhost',
                    data: {
                        type: 'SUITE_REBIND_PROOF',
                        source: 'practice_page',
                        data: {
                            challenge: payload.data.challenge,
                            suiteSessionId: session.id,
                            examId: 'reading-p2',
                            sessionId: challengedBinding.expectedSessionId,
                            windowSessionToken: challengedBinding.windowSessionToken,
                            windowSessionGeneration: challengedBinding.sessionGeneration
                        }
                    }
                });
            });
        };
        const originalOpen = windowStub.open;
        windowStub.open = () => candidate;
        let launchBeginCalls = 0;
        let challengedOwnership = null;
        const originalBegin = app._beginSuiteExamLaunchOwnership.bind(app);
        app._beginSuiteExamLaunchOwnership = (...args) => {
            launchBeginCalls += 1;
            challengedOwnership = originalBegin(...args);
            return challengedOwnership;
        };
        let launchRollbackCalls = 0;
        const originalRollback = app._rollbackExamLaunchOwnership.bind(app);
        app._rollbackExamLaunchOwnership = (ownership) => {
            launchRollbackCalls += 1;
            return originalRollback(ownership);
        };
        let launchClaimCalls = 0;
        const originalClaim = app._claimSuiteExamLaunchWindow.bind(app);
        app._claimSuiteExamLaunchWindow = (...args) => {
            launchClaimCalls += 1;
            return originalClaim(...args);
        };
        let setupCalls = 0;
        const originalSetup = app.setupExamWindowManagement.bind(app);
        app.setupExamWindowManagement = (...args) => {
            setupCalls += 1;
            if (replacementMode === 'setup-throw') {
                throw new Error('expected rebind setup failure');
            }
            return originalSetup(...args);
        };
        if (replacementMode === 'commit-throw') {
            app._commitSuiteRecovery = async () => {
                throw new Error('expected rebind pre-receipt commit failure');
            };
        }
        try {
            if (replacementMode === 'commit-throw' || replacementMode === 'setup-throw') {
                await assert.rejects(
                    () => app._tryRebindSuiteWindow(session, session.sequence[1]),
                    new RegExp(replacementMode === 'commit-throw'
                        ? 'expected rebind pre-receipt commit failure'
                        : 'expected rebind setup failure'),
                    `${replacementMode} must propagate its injected failure after releasing the reservation`
                );
            } else {
                assert.strictEqual(
                    await app._tryRebindSuiteWindow(session, session.sequence[1]),
                    null,
                    `${replacementMode} replacement during proof await must invalidate rebind`
                );
            }
            assert.strictEqual(launchBeginCalls, 1, 'rebind must reserve the target before awaiting proof');
            assert.strictEqual(launchRollbackCalls, 1, 'stale proof must roll back only its exact reservation');
            assert.strictEqual(
                launchClaimCalls,
                replacementMode === 'commit-throw' || replacementMode === 'setup-throw' ? 1 : 0,
                'only a current successful proof may claim the WindowProxy'
            );
            assert.strictEqual(
                setupCalls,
                replacementMode === 'setup-throw' ? 1 : 0,
                'managed setup must run only after proof and durable commit succeed'
            );
            assert(challengedOwnership, 'the challenged reservation must be observable');
            assert.strictEqual(
                app._isExamLaunchOwnershipCurrent('reading-p2', challengedOwnership),
                false,
                'the stale challenged reservation must no longer own the target'
            );
            if (replacementMode === 'ordinary-tuple') {
                assert.strictEqual(session.windowBinding, challengedBinding);
                assert.strictEqual(app.examWindows.get('reading-p2'), ordinaryInfo);
                assert.strictEqual(String(ordinaryInfo.suiteSessionId || ''), '');
            } else if (replacementMode === 'committed-navigation') {
                assert.strictEqual(session.windowBinding, challengedBinding);
                assert.strictEqual(app._isExamWindowNavigationCurrent(candidate, replacementNavigation), true);
                assert.strictEqual(app.examWindows.has('reading-p2'), false);
            } else if (replacementMode === 'launch-reservation') {
                assert.strictEqual(session.windowBinding, challengedBinding);
                assert.strictEqual(app.examWindows.has('reading-p2'), false);
                assert(replacementOwnership, 'the newer ordinary reservation must be created during proof');
                assert.strictEqual(
                    app._isExamLaunchOwnershipCurrent('reading-p2', replacementOwnership, null, candidate),
                    true,
                    'rolling back the stale rebind must preserve the newer ordinary reservation'
                );
            } else if (replacementMode === 'commit-throw') {
                assert.deepStrictEqual(
                    plain(session.windowBinding),
                    plain(challengedBinding),
                    'a pre-receipt commit exception must restore only its tentative binding'
                );
                assert.strictEqual(app.examWindows.has('reading-p2'), false);
            } else if (replacementMode === 'setup-throw') {
                assert.notDeepStrictEqual(
                    plain(session.windowBinding),
                    plain(challengedBinding),
                    'a post-receipt setup exception must keep the durable-aligned binding'
                );
                assert.strictEqual(session.windowBinding.sessionGeneration, challengedBinding.sessionGeneration + 1);
            } else {
                assert.strictEqual(session.windowBinding, replacementBinding);
                assert.strictEqual(app.examWindows.has('reading-p2'), false);
            }
        } finally {
            windowStub.open = originalOpen;
        }
    }

    // Resume must own the target before either recovery-ready or claim awaits.
    // A newer ordinary reservation during either gap remains authoritative and
    // the stale resume must not reach proof, WindowProxy claim, setup, or fallback open.
    for (const gateMode of ['recovery-ready', 'ensure-claim']) {
        const app = createApp(windowStub);
        const session = makeSession(`suite-resume-preawait-${gateMode}`);
        const candidate = createStubWindow('ielts-suite-mode-tab');
        candidate.location.href = 'http://localhost/exam.html?examId=reading-p1';
        session.windowRef = candidate;
        session.windowBinding = {
            examId: 'reading-p1',
            expectedSessionId: `resume-${gateMode}-session`,
            windowSessionToken: `resume-${gateMode}-token`,
            sessionGeneration: 2,
            expectedUrl: candidate.location.href,
            expectedOrigin: 'http://localhost',
            allowOpaqueOrigin: false
        };
        app._suiteModeReady = true;
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map((entry) => [entry.examId, session.id]));

        let releaseGate;
        let markGateEntered;
        const gateEntered = new Promise((resolve) => { markGateEntered = resolve; });
        const gate = new Promise((resolve) => { releaseGate = resolve; });
        if (gateMode === 'recovery-ready') {
            app._suiteRecoveryReady = gate;
        } else {
            app._suiteRecoveryReady = Promise.resolve();
            app._ensureSuiteRecoveryClaim = async () => {
                markGateEntered();
                return gate;
            };
        }
        app._commitSuiteRecovery = async (_owner, options = {}) => (
            typeof options.commitGuard !== 'function' || options.commitGuard() !== false
        );
        let challengedOwnership = null;
        const originalBegin = app._beginSuiteExamLaunchOwnership.bind(app);
        app._beginSuiteExamLaunchOwnership = (...args) => {
            challengedOwnership = originalBegin(...args);
            return challengedOwnership;
        };
        let rebindCalls = 0;
        const originalRebind = app._tryRebindSuiteWindow.bind(app);
        app._tryRebindSuiteWindow = (...args) => {
            rebindCalls += 1;
            return originalRebind(...args);
        };
        let reacquireCalls = 0;
        app._reacquireSuiteWindow = () => {
            reacquireCalls += 1;
            return candidate;
        };
        let setupCalls = 0;
        app.setupExamWindowManagement = () => {
            setupCalls += 1;
            return null;
        };
        let openCalls = 0;
        app.openExam = async () => {
            openCalls += 1;
            return candidate;
        };

        const resume = app.resumeSuitePractice(session.id);
        if (gateMode === 'ensure-claim') await gateEntered;
        else await Promise.resolve();
        assert(challengedOwnership, `${gateMode} must begin the resume reservation synchronously`);
        assert.strictEqual(
            app._isExamLaunchOwnershipCurrent('reading-p1', challengedOwnership, null, candidate),
            true
        );
        const ordinaryOwnership = app._beginExamLaunchOwnership('reading-p1', {
            windowName: session.windowName,
            reuseWindow: candidate
        });
        releaseGate(true);
        assert.strictEqual(await resume, false, `${gateMode} stale resume must fail closed`);
        assert.strictEqual(rebindCalls, gateMode === 'ensure-claim' ? 1 : 0);
        assert.strictEqual(reacquireCalls, 0, 'stale resume must stop before named-window proof');
        assert.strictEqual(setupCalls, 0, 'stale resume must stop before managed setup');
        assert.strictEqual(openCalls, 0, 'stale resume must never create a later fallback launch');
        assert.strictEqual(
            app._isExamLaunchOwnershipCurrent('reading-p1', ordinaryOwnership, null, candidate),
            true,
            'stale resume cleanup must preserve the newer ordinary owner'
        );
        assert.strictEqual(app._isExamLaunchOwnershipCurrent('reading-p1', challengedOwnership), false);
        app._rollbackExamLaunchOwnership(ordinaryOwnership);
    }

    // Concurrent resume clicks before recovery-ready must coalesce before either
    // call can create a launch reservation. Otherwise the second token supersedes
    // the first and the stale first continuation can publish a failed promise that
    // also causes the second call to roll back its only valid owner.
    {
        const app = createApp(windowStub);
        const sessionId = 'suite-resume-entry-coalesced';
        const storedSession = makeSession(sessionId);
        const session = makeSession(sessionId);
        storedSession.windowRef = null;
        storedSession.windowBinding = null;
        session.windowRef = null;
        session.windowBinding = null;
        app._suiteModeReady = true;
        app.currentSuiteSession = null;
        app._restoreSessionFromStorage = () => storedSession;
        let releaseRecovery;
        app._suiteRecoveryReady = new Promise((resolve) => { releaseRecovery = resolve; });
        app._commitSuiteRecovery = async (_owner, options = {}) => (
            typeof options.commitGuard !== 'function' || options.commitGuard() !== false
        );
        let beginCalls = 0;
        const originalBegin = app._beginSuiteExamLaunchOwnership.bind(app);
        app._beginSuiteExamLaunchOwnership = (...args) => {
            beginCalls += 1;
            return originalBegin(...args);
        };
        const targetWindow = createStubWindow('suite-resume-entry-target');
        let openCalls = 0;
        app.openExam = async (examId, options = {}) => {
            openCalls += 1;
            return installManagedTestWindow(app, examId, targetWindow, options);
        };

        const firstResume = app.resumeSuitePractice(session.id);
        const secondResume = app.resumeSuitePractice(session.id);
        assert.strictEqual(beginCalls, 1, 'the second entry must join before creating another reservation');
        assert.strictEqual(app._suiteResumeEntryPromises.has(session.id), true);
        // Recovery promotes a different authoritative object with the same durable
        // identity; the app-level gate and frozen launch token must survive the swap.
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map((entry) => [entry.examId, session.id]));
        releaseRecovery();
        assert.deepStrictEqual(await Promise.all([firstResume, secondResume]), [true, true]);
        assert.strictEqual(beginCalls, 1);
        assert.strictEqual(openCalls, 1, 'coalesced resume callers must share one navigation');
        assert.strictEqual(session.windowRef, targetWindow);
        assert.strictEqual(app._suiteResumeEntryPromises.has(session.id), false);
    }

    // A preflight begin can synchronously lose its reservation before resume
    // records the token.  That rejected token must be rolled back immediately;
    // the outer finally cannot clean up a token that was never installed in
    // resumeLaunch, and it must not disturb the newer owner that superseded it.
    {
        const app = createApp(windowStub);
        const session = makeSession('suite-resume-preflight-rejected-token');
        const candidate = createStubWindow('ielts-suite-mode-tab');
        session.windowRef = candidate;
        app._suiteModeReady = true;
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map((entry) => [entry.examId, session.id]));
        let releaseRecovery;
        app._suiteRecoveryReady = new Promise((resolve) => { releaseRecovery = resolve; });
        let rejectedOwnership = null;
        let newerOwnership = null;
        const originalBegin = app._beginSuiteExamLaunchOwnership.bind(app);
        app._beginSuiteExamLaunchOwnership = (...args) => {
            rejectedOwnership = originalBegin(...args);
            newerOwnership = app._beginExamLaunchOwnership('reading-p1', {
                windowName: session.windowName,
                reuseWindow: candidate
            });
            return rejectedOwnership;
        };

        const resume = app.resumeSuitePractice(session.id);
        assert(rejectedOwnership, 'resume preflight must create the rejected reservation');
        assert(newerOwnership, 'fixture must synchronously supersede the preflight reservation');
        assert.strictEqual(app._examLaunchOwnershipRollbackStates.has(rejectedOwnership), false);
        assert.strictEqual(app._examLaunchOwnershipExplicitWindows.has(rejectedOwnership), false);
        assert.strictEqual(
            app._isExamLaunchOwnershipCurrent('reading-p1', newerOwnership, null, candidate),
            true,
            'rejected-token cleanup must preserve the synchronous replacement owner'
        );

        session.status = 'completed';
        releaseRecovery();
        assert.strictEqual(await resume, false);
        assert.strictEqual(app._suiteResumeEntryPromises.has(session.id), false);
        assert.strictEqual(
            app._isExamLaunchOwnershipCurrent('reading-p1', newerOwnership, null, candidate),
            true
        );
        app._rollbackExamLaunchOwnership(newerOwnership);
    }

    // When recovery has not exposed the target yet, freeze the entry ownership
    // epoch. A launch begun while recovery-ready is pending must prevent a later
    // resume from manufacturing a higher-sequence reservation after the await.
    {
        const app = createApp(windowStub);
        const session = makeSession('suite-resume-unknown-target-epoch');
        app._suiteModeReady = true;
        app.currentSuiteSession = null;
        app._restoreSessionFromStorage = () => null;
        let releaseRecovery;
        app._suiteRecoveryReady = new Promise((resolve) => { releaseRecovery = resolve; });
        let suiteBeginCalls = 0;
        const originalBegin = app._beginSuiteExamLaunchOwnership.bind(app);
        app._beginSuiteExamLaunchOwnership = (...args) => {
            suiteBeginCalls += 1;
            return originalBegin(...args);
        };
        let openCalls = 0;
        app.openExam = async () => {
            openCalls += 1;
            return createStubWindow('must-not-open-after-epoch-change');
        };
        const resume = app.resumeSuitePractice(session.id);
        await Promise.resolve();
        assert.strictEqual(suiteBeginCalls, 0, 'unknown target must not reserve before it can be identified');
        const ordinaryOwnership = app._beginExamLaunchOwnership('reading-p1', {
            windowName: session.windowName
        });
        app.currentSuiteSession = session;
        app.suiteExamMap = new Map(session.sequence.map((entry) => [entry.examId, session.id]));
        releaseRecovery();
        assert.strictEqual(await resume, false);
        assert.strictEqual(suiteBeginCalls, 0, 'changed entry epoch must block any post-await reservation');
        assert.strictEqual(openCalls, 0);
        assert.strictEqual(
            app._isExamLaunchOwnershipCurrent('reading-p1', ordinaryOwnership),
            true
        );
        app._rollbackExamLaunchOwnership(ordinaryOwnership);
    }

    process.stdout.write(JSON.stringify({ status: 'pass', detail: 'simulation mode regression cases passed' }));
}

run().catch((error) => {
    const detail = error && error.stack ? error.stack : String(error);
    process.stdout.write(JSON.stringify({ status: 'fail', detail }));
    process.exit(1);
});
