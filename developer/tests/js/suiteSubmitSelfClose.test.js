#!/usr/bin/env node
/**
 * 套题子窗口"提交后自行关闭"的回归测试。
 *
 * 锁定两条已修复的行为：
 *  1. PRACTICE_SUBMIT_ACK 必须携带子页面真正持有的 windowSessionToken。
 *     模拟模式三篇复用同一个子窗口，examWindows 只有首篇有真实注册；
 *     若回包时按消息里的末篇 examId 兜底建注册，会新铸一个子页面并不持有的
 *     token，子页面的 isTrustedHostMessage 会静默丢弃该回包，永远不自关闭。
 *  2. 套题落库后必须"先撤防护、再发 ACK"。_ensureSuiteWindowGuard 会把子窗口的
 *     window.close 换成吞掉调用的 guardedClose；只有在 ACK 之前解除，子页面收到
 *     ACK 后的自关闭才会真正生效（否则要等 30s 兜底清理）。中途提交（非末篇）
 *     则必须保留防护，避免子窗口提前消失。
 */
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

function cloneValue(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/**
 * 子窗口桩。
 * close 被定义为访问器属性，这样宿主对 window.close 的每一次赋值都能被记录成
 * 有序事件，而不需要替换任何被测方法：
 *   - 安装防护时 __IELTS_SUITE_PARENT_GUARD__ 尚未写入 -> guard:close-guarded
 *   - 解除防护时先还原 close、后 delete 防护对象 -> guard:close-restored
 * postMessage 会在投递瞬间快照防护状态，用于证明"解除早于 ACK"。
 */
function createChildWindow(name, events) {
    const stub = {
        name,
        closed: false,
        location: { href: 'http://localhost/exam.html', origin: 'http://localhost', protocol: 'http:' },
        document: { title: '', addEventListener() {}, removeEventListener() {} },
        messages: [],
        focus() {},
        open() { return null; },
        postMessage(message, targetOrigin) {
            const type = message && message.type ? String(message.type) : 'UNKNOWN';
            stub.messages.push({
                type,
                data: (message && message.data) || {},
                targetOrigin,
                guardInstalledAtPostTime: Boolean(stub.__IELTS_SUITE_PARENT_GUARD__),
                closeSwallowsAtPostTime: stub.close !== nativeClose && Boolean(stub.__IELTS_SUITE_PARENT_GUARD__)
            });
            events.push(`message:${type}`);
        }
    };

    function nativeClose() {
        stub.closed = true;
    }

    let currentClose = nativeClose;
    Object.defineProperty(stub, 'close', {
        configurable: true,
        enumerable: true,
        get() {
            return currentClose;
        },
        set(next) {
            // 防护对象此刻已存在 => 这是 _releaseSuiteWindowGuard 的还原赋值；
            // 尚不存在 => 这是 _ensureSuiteWindowGuard 的吞噬赋值。
            const restoring = Boolean(stub.__IELTS_SUITE_PARENT_GUARD__);
            currentClose = next;
            events.push(restoring ? 'guard:close-restored' : 'guard:close-guarded');
        }
    });

    stub.self = stub;
    stub.top = stub;
    return stub;
}

function createSandbox() {
    const windowSessionStore = new Map();
    let activeSessions = [];
    let practiceRecords = [];
    const notifications = [];

    const documentStub = {
        title: '',
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        createElement() { return { className: '', style: {} }; },
        dispatchEvent() { return true; }
    };

    const windowStub = {
        document: documentStub,
        addEventListener() {},
        removeEventListener() {},
        // isFileProtocol 在脚本加载时由 global.location.protocol 求值，
        // 必须是 http: 才会安装套题窗口防护，否则回归 2 会空跑通过。
        location: { href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:' },
        crypto: webcrypto,
        showMessage(text, level) {
            notifications.push({ text, level });
        },
        CustomEvent: function CustomEvent(type, init = {}) {
            return { type, detail: init.detail || null };
        },
        async resolveActiveLibraryIndex() {
            return [];
        },
        AppData: {
            ready: Promise.resolve(),
            practice: {
                async list() {
                    return cloneValue(practiceRecords);
                },
                async getStats() {
                    return { totalPractices: practiceRecords.length };
                },
                async finalizeSuite(command = {}) {
                    const record = cloneValue(command.record || {});
                    practiceRecords = [record];
                    return { committed: true, record };
                }
            },
            recovery: {
                async listActiveSessions() {
                    return cloneValue(activeSessions);
                },
                async saveActiveSession(value) {
                    const entity = cloneValue(value);
                    const entityId = String(entity && (entity.id || entity.sessionId) || '');
                    if (!entityId) return { committed: false };
                    const index = activeSessions.findIndex(item => String(item && (item.id || item.sessionId) || '') === entityId);
                    if (index >= 0) activeSessions[index] = entity;
                    else activeSessions.push(entity);
                    return { committed: true, value: cloneValue(entity) };
                },
                async discardActiveSession(entityId) {
                    const normalized = String(entityId || '');
                    activeSessions = activeSessions.filter(item => String(item && (item.id || item.sessionId) || '') !== normalized);
                    return { committed: true };
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
            }
        }
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
        crypto: webcrypto,
        URL,
        URLSearchParams,
        Uint8Array,
        CustomEvent: windowStub.CustomEvent
    };
    sandbox.globalThis = sandbox.window;

    return { sandbox, windowStub, notifications };
}

function createApp(windowStub) {
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
    const mixins = windowStub.ExamSystemAppMixins;
    if (!mixins || !mixins.examSession || !mixins.suitePractice) {
        throw new Error('未能加载所需的 mixin');
    }
    Object.assign(app, mixins.examSession, mixins.suitePractice);
    app.examWindows = new Map();
    app.suiteExamMap = new Map();
    app.multiSuiteSessionsMap = new Map();
    app._suiteModeReady = true;
    app.currentSuiteSession = null;
    return app;
}

function buildPassagePayload(examId, index, suiteSessionId) {
    return {
        examId,
        type: 'reading',
        // 模拟模式上报的是套题累计用时，宿主再折算成本篇用时。
        duration: 600 * (index + 1),
        scoreInfo: { correct: 10, total: 13, accuracy: 10 / 13, percentage: 77 },
        answers: { q1: 'A', q2: 'B' },
        answerComparison: {
            q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true },
            q2: { userAnswer: 'B', correctAnswer: 'C', isCorrect: false }
        },
        submissionId: `submit-${examId}`,
        sessionId: `session-${examId}`,
        suiteSessionId
    };
}

function makeSuiteSession(sessionId, windowRef) {
    const sequence = [
        { examId: 'reading-p1', exam: { id: 'reading-p1', title: 'Passage 1', category: 'P1' } },
        { examId: 'reading-p2', exam: { id: 'reading-p2', title: 'Passage 2', category: 'P2' } },
        { examId: 'reading-p3', exam: { id: 'reading-p3', title: 'Passage 3', category: 'P3' } }
    ];
    const now = Date.now();
    return {
        id: sessionId,
        status: 'active',
        startTime: now,
        sequence,
        currentIndex: 0,
        results: [],
        draftsByExam: {},
        elapsedByExam: {},
        globalTimerAnchorMs: now,
        suiteTimerAnchorMs: now,
        suiteTimerMode: 'countdown',
        suiteTimerLimitSeconds: 3600,
        suiteTimerPausedOffsetMs: 0,
        suiteTimerPausedAtMs: null,
        suiteTimerRunning: true,
        flowMode: 'simulation',
        frequencyScope: 'all',
        autoAdvanceAfterSubmit: true,
        activeExamId: sequence[0].examId,
        windowRef,
        windowName: 'ielts-suite-mode-tab'
    };
}

/**
 * 回归 1：ACK 必须带子页面真正持有的 token，并且不得为末篇 examId 新建幻影注册。
 */
async function verifyAckCarriesHeldToken(windowStub) {
    const events = [];
    const app = createApp(windowStub);
    const suiteWindow = createChildWindow('ielts-suite-mode-tab', events);

    // 模拟模式只有首篇拿到真实注册，后两篇复用同一个窗口、没有任何注册。
    const P1_TOKEN = 'win_p1-x_TOKEN';
    const p1Info = app.ensureExamWindowSession('p1-x', suiteWindow);
    p1Info.windowSessionToken = P1_TOKEN;
    p1Info.windowSessionTokenSessionId = p1Info.expectedSessionId;

    assert.strictEqual(app.examWindows.size, 1, '前置条件：examWindows 应只登记首篇');
    assert.strictEqual(app.examWindows.get('p1-x').window, suiteWindow, '前置条件：首篇注册应持有套题子窗口');

    const completionData = {
        examId: 'p3-z',
        submissionId: 'submit-final',
        sessionId: 'session-final',
        suiteSessionId: 'suite-token-check',
        duration: 1800,
        scoreInfo: { correct: 30, total: 39, accuracy: 30 / 39, percentage: 77 },
        answers: { q1: 'A' },
        answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } }
    };

    // 末篇 examId 没有任何注册，回包必须落到"真正持有该窗口"的首篇注册上。
    const announced = app._announcePracticeSubmitOutcome('p3-z', completionData, suiteWindow, true);
    assert.strictEqual(announced, true, '末篇提交成功后应向子窗口投递 ACK');

    const ack = suiteWindow.messages.find(item => item.type === 'PRACTICE_SUBMIT_ACK');
    assert(ack, '子窗口应收到 PRACTICE_SUBMIT_ACK');
    assert.strictEqual(ack.data.examId, 'p3-z', 'ACK 仍应寻址到子页面提交时使用的末篇 examId');

    const ackToken = ack.data.windowSessionToken;
    assert.strictEqual(
        typeof ackToken === 'string' && ackToken.length > 0,
        true,
        'ACK 必须携带非空 windowSessionToken'
    );
    // 反脆弱断言：非空还不够，必须严格等于子页面实际持有的首篇 token，
    // 且绝不能是以末篇 examId 现铸的新 token（子页面会因不等而静默丢弃）。
    assert.strictEqual(
        ackToken,
        P1_TOKEN,
        'ACK 必须携带子页面真正持有的 token（首篇注册的 token），否则会被子页面信任校验丢弃'
    );
    assert.strictEqual(
        ackToken.startsWith('win_p3-z'),
        false,
        'ACK 不得携带以末篇 examId 现铸的新 token'
    );

    assert.strictEqual(
        app.examWindows.has('p3-z'),
        false,
        '回包不得为末篇 examId 新建幻影窗口注册'
    );
    assert.strictEqual(app.examWindows.size, 1, '回包后 examWindows 仍应只有首篇一条注册');

    const receiptKey = `${completionData.sessionId}:${completionData.submissionId}`;
    const holderInfo = app.examWindows.get('p1-x');
    const receipt = holderInfo.practiceSubmitReceipts && holderInfo.practiceSubmitReceipts[receiptKey];
    assert(receipt, '成功回执应存放在真正持有窗口的首篇注册下');
    assert.strictEqual(receipt.succeeded, true, '回执应标记为提交成功');

    // 回执重放走的是"只查询不兜底新建"的路径，必须能按解析后的键命中。
    const replayed = app._replayPracticeSubmitReceipt('p3-z', completionData, suiteWindow);
    assert.strictEqual(replayed, true, '重复提交时应命中已存回执并重放 ACK');
    assert.strictEqual(
        app.examWindows.has('p3-z'),
        false,
        '回执重放同样不得为末篇 examId 新建幻影注册'
    );

    const acks = suiteWindow.messages.filter(item => item.type === 'PRACTICE_SUBMIT_ACK');
    assert.strictEqual(acks.length, 2, '回执重放应再次投递一条 ACK');
    assert.strictEqual(
        acks[1].data.windowSessionToken,
        P1_TOKEN,
        '重放的 ACK 同样必须携带子页面真正持有的 token'
    );

    return { ackToken, examWindowKeys: Array.from(app.examWindows.keys()) };
}

/**
 * 回归 2：末篇落库后"先撤防护、后发 ACK"；中途提交则必须保留防护。
 */
async function verifyGuardReleaseOrdering(windowStub) {
    const events = [];
    const app = createApp(windowStub);
    const suiteWindow = createChildWindow('ielts-suite-mode-tab', events);
    const session = makeSuiteSession('suite_selfclose_1', suiteWindow);

    app.currentSuiteSession = session;
    app._registerSuiteSequence(session);

    // 模拟宿主打开首篇后安装的关闭防护。
    app._ensureSuiteWindowGuard(session, suiteWindow);
    assert(suiteWindow.__IELTS_SUITE_PARENT_GUARD__, '前置条件：套题窗口防护应已安装');
    assert.strictEqual(
        suiteWindow.__IELTS_SUITE_PARENT_GUARD__.sessionId,
        session.id,
        '前置条件：防护应绑定当前套题会话'
    );
    assert.strictEqual(
        events.includes('guard:close-guarded'),
        true,
        '前置条件：安装防护时应替换掉子窗口的 window.close'
    );

    // 模拟模式复用同一个子窗口；切篇后子页面会重新上报 SESSION_READY。
    app.openExam = async function openExamStub(examId, options = {}) {
        const targetWindow = options.reuseWindow && !options.reuseWindow.closed
            ? options.reuseWindow
            : suiteWindow;
        targetWindow.location.href = `http://localhost/exam.html?examId=${examId}`;
        const info = this.ensureExamWindowSession(examId, targetWindow);
        info.pageType = 'unified-reading';
        info.suiteSessionId = session.id;
        setTimeout(() => {
            info.lastMessageType = 'SESSION_READY';
            info.lastMessageAt = Date.now();
        }, 10);
        return targetWindow;
    };

    // ---- 负例：非末篇（P1/3）提交后防护必须仍然生效 ----
    const p1Payload = buildPassagePayload('reading-p1', 0, session.id);
    const p1Committed = await app.handlePracticeComplete('reading-p1', p1Payload, suiteWindow);
    assert.strictEqual(p1Committed, true, 'P1 提交应被套题处理器接管并落盘进度');
    assert.strictEqual(session.currentIndex, 1, 'P1 提交后应推进到第二篇');

    const p1Ack = suiteWindow.messages.find(item => item.type === 'PRACTICE_SUBMIT_ACK');
    assert(p1Ack, 'P1 提交后子页面应收到 ACK');
    assert.strictEqual(
        p1Ack.guardInstalledAtPostTime,
        true,
        'P1（非末篇）ACK 投递时套题窗口防护必须仍然在位'
    );
    assert(
        suiteWindow.__IELTS_SUITE_PARENT_GUARD__,
        'P1（非末篇）提交后不得解除套题窗口防护'
    );
    assert.strictEqual(
        events.includes('guard:close-restored'),
        false,
        'P1（非末篇）提交过程中不得发生任何防护解除'
    );

    const closeAttemptsBefore = Array.isArray(session.closeAttempts) ? session.closeAttempts.length : 0;
    suiteWindow.close();
    assert.strictEqual(
        suiteWindow.closed,
        false,
        'P1（非末篇）提交后子窗口的自关闭必须被防护吞掉'
    );
    assert.strictEqual(
        (session.closeAttempts || []).length,
        closeAttemptsBefore + 1,
        '被吞掉的关闭请求应记录到 session.closeAttempts'
    );
    assert.strictEqual(
        (session.closeAttempts || [])[closeAttemptsBefore].reason,
        'script_request',
        '被吞掉的关闭请求原因应为 script_request'
    );

    // ---- 推进到末篇 ----
    const p2Payload = buildPassagePayload('reading-p2', 1, session.id);
    const p2Committed = await app.handlePracticeComplete('reading-p2', p2Payload, suiteWindow);
    assert.strictEqual(p2Committed, true, 'P2 提交应成功并推进到第三篇');
    assert.strictEqual(session.currentIndex, 2, 'P2 提交后应推进到第三篇');
    assert(
        suiteWindow.__IELTS_SUITE_PARENT_GUARD__,
        'P2（非末篇）提交后同样不得解除套题窗口防护'
    );

    // ---- 正例：末篇（P3/3）落库后必须先撤防护再发 ACK ----
    const eventCursor = events.length;
    const p3Payload = buildPassagePayload('reading-p3', 2, session.id);
    const p3Committed = await app.handlePracticeComplete('reading-p3', p3Payload, suiteWindow);
    assert.strictEqual(p3Committed, true, 'P3 提交应完成套题落库');
    assert.strictEqual(session.status, 'completed', '末篇提交后套题会话应标记为已完成');
    assert.strictEqual(app.currentSuiteSession, session, 'ACK 后应保留会话以支持回执重放');
    assert.strictEqual(suiteWindow.closed, false, '宿主不应强行关闭子窗口，交由子页面自行退出');

    const finalEvents = events.slice(eventCursor);
    const releaseIndex = finalEvents.indexOf('guard:close-restored');
    const ackIndex = finalEvents.indexOf('message:PRACTICE_SUBMIT_ACK');
    assert.notStrictEqual(releaseIndex, -1, '末篇落库后必须解除套题窗口关闭防护');
    assert.notStrictEqual(ackIndex, -1, '末篇落库后必须向子页面投递 PRACTICE_SUBMIT_ACK');
    assert.strictEqual(
        releaseIndex < ackIndex,
        true,
        `防护解除必须严格早于 ACK 投递，实际事件序列: ${JSON.stringify(finalEvents)}`
    );

    const finalAck = suiteWindow.messages.filter(item => item.type === 'PRACTICE_SUBMIT_ACK').pop();
    assert(finalAck, '末篇提交后子页面应收到 ACK');
    assert.strictEqual(
        finalAck.data.examId,
        'reading-p3',
        '末篇 ACK 应寻址到末篇 examId'
    );
    assert.strictEqual(
        finalAck.guardInstalledAtPostTime,
        false,
        'ACK 投递瞬间套题窗口防护必须已经撤下，否则子页面自关闭仍会被吞掉'
    );
    assert.strictEqual(
        suiteWindow.__IELTS_SUITE_PARENT_GUARD__,
        undefined,
        '防护解除后不应残留 __IELTS_SUITE_PARENT_GUARD__'
    );

    // 子页面收到 ACK 后调用 window.close()，此刻必须真的能关闭。
    suiteWindow.close();
    assert.strictEqual(
        suiteWindow.closed,
        true,
        '防护解除后子页面的自关闭必须真正生效'
    );

    if (session.submitReceiptTeardownTimer) {
        clearTimeout(session.submitReceiptTeardownTimer);
        session.submitReceiptTeardownTimer = null;
    }

    // The delayed teardown must remain bound to the exact suite registration that
    // existed when the receipt window was scheduled.  A fresh standalone launch for
    // the same exam id is a different owner and must survive teardown intact.
    const capturedRegistrations = session._teardownRegistrationsByExam;
    assert(
        capturedRegistrations && capturedRegistrations.get('reading-p3'),
        '末篇 ACK 调度延迟清理时必须先捕获套题自身的精确注册'
    );
    const oldP3Info = app.examWindows.get('reading-p3');
    const standaloneWindow = createChildWindow('standalone-reading-p3', events);
    const standaloneInfo = {
        ...oldP3Info,
        window: standaloneWindow,
        expectedSessionId: 'standalone-reading-p3-session',
        sessionId: 'standalone-reading-p3-session',
        windowSessionToken: 'standalone-reading-p3-token',
        windowSessionTokenSessionId: 'standalone-reading-p3-session',
        suiteSessionId: null,
        sessionGeneration: Math.max(1, Number(oldP3Info?.sessionGeneration) || 1) + 1,
        registrationId: Math.max(1, Number(oldP3Info?.registrationId) || 1) + 1
    };
    const standaloneHandler = () => {};
    app.examWindows.set('reading-p3', standaloneInfo);
    if (!app.messageHandlers) app.messageHandlers = new Map();
    app.messageHandlers.set('reading-p3', standaloneHandler);
    await windowStub.AppData.recovery.saveActiveSession({
        id: 'standalone-reading-p3-recovery',
        examId: 'reading-p3',
        sessionId: standaloneInfo.expectedSessionId,
        status: 'active'
    });

    assert.strictEqual(await app._teardownSuiteSession(session), true, '延迟窗口结束后套题本身应正常清理');
    assert.strictEqual(
        app.examWindows.get('reading-p3'),
        standaloneInfo,
        '旧套题 teardown 不得删除同 examId 的新 standalone 注册'
    );
    assert.strictEqual(
        app.messageHandlers.get('reading-p3'),
        standaloneHandler,
        '旧套题 teardown 不得删除新 standalone 消息处理器'
    );
    const remainingRecovery = await windowStub.AppData.recovery.listActiveSessions();
    assert(
        remainingRecovery.some((entry) => entry && entry.id === 'standalone-reading-p3-recovery'),
        '旧套题 teardown 不得删除新 standalone 恢复实体'
    );

    return { finalEvents };
}

async function main() {
    const { sandbox, windowStub } = createSandbox();
    const context = vm.createContext(sandbox);

    loadScript('js/app/examSessionMixin.js', context);
    loadScript('js/app/suitePracticeMixin.js', context);

    const tokenResult = await verifyAckCarriesHeldToken(windowStub);
    const guardResult = await verifyGuardReleaseOrdering(windowStub);

    process.stdout.write(JSON.stringify({
        status: 'pass',
        detail: '末篇 ACK 携带子页面持有的 token 且不新建幻影注册；末篇落库后防护解除严格早于 ACK，中途提交仍保留防护',
        ackToken: tokenResult.ackToken,
        examWindowKeys: tokenResult.examWindowKeys,
        finalSubmitEvents: guardResult.finalEvents
    }));
}

main().catch(error => {
    const detail = error && error.stack ? error.stack : String(error);
    process.stdout.write(JSON.stringify({ status: 'fail', detail }));
    process.exit(1);
});
