#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function createButton(id, label) {
    return {
        id,
        dataset: {},
        style: {},
        disabled: false,
        textContent: label,
        _attrs: new Map(),
        addEventListener() {},
        removeEventListener() {},
        setAttribute(name, value) {
            this._attrs.set(String(name), String(value));
        },
        getAttribute(name) {
            return this._attrs.has(String(name)) ? this._attrs.get(String(name)) : null;
        }
    };
}

function createHarness() {
    const submitBtn = createButton('submit-btn', 'Submit');
    const resetBtn = createButton('reset-btn', 'Reset');
    const postedMessages = [];
    const suiteModeCalls = [];
    const listeners = new Map();

    const documentStub = {
        title: 'Unified Reading Fixture',
        body: {
            dataset: {},
            classList: {
                toggle() {}
            },
            insertAdjacentElement() {}
        },
        head: {
            appendChild() {}
        },
        addEventListener(type, handler) {
            listeners.set(type, handler);
        },
        removeEventListener(type) {
            listeners.delete(type);
        },
        getElementById(id) {
            if (id === 'submit-btn') return submitBtn;
            if (id === 'reset-btn') return resetBtn;
            return null;
        },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        createElement() {
            return {
                id: '',
                style: {},
                dataset: {},
                innerHTML: '',
                appendChild() {},
                addEventListener() {},
                querySelector() { return null; }
            };
        }
    };

    const openerStub = {
        postMessage(message, origin) {
            postedMessages.push({ message, origin });
        }
    };

    const windowStub = {
        document: documentStub,
        opener: openerStub,
        parent: openerStub,
        location: {
            href: 'file:///Users/test/unified-reading.html?examId=p1',
            search: '?examId=p1',
            origin: 'null'
        },
        addEventListener() {},
        removeEventListener() {},
        updatePracticeSuiteModeUI(value) {
            suiteModeCalls.push(Boolean(value));
        },
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        console: {
            log() {},
            warn() {},
            error() {},
            info() {}
        }
    };

    const sandbox = {
        window: windowStub,
        document: documentStub,
        console: windowStub.console,
        URLSearchParams,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Date,
        Math,
        JSON,
        Map,
        Set,
        HTMLElement: function HTMLElement() {},
        HTMLInputElement: function HTMLInputElement() {},
        HTMLTextAreaElement: function HTMLTextAreaElement() {},
        HTMLSelectElement: function HTMLSelectElement() {}
    };
    sandbox.globalThis = sandbox.window;
    sandbox.window.window = sandbox.window;
    sandbox.window.self = sandbox.window;
    sandbox.window.top = sandbox.window;
    sandbox.window.URLSearchParams = URLSearchParams;

    const fullPath = path.join(repoRoot, 'js/runtime/unifiedReadingPage.js');
    let source = fs.readFileSync(fullPath, 'utf8');
    source = source.replace(
        /\}\)\(typeof window !== 'undefined' \? window : globalThis\);\s*$/,
        "global.__UNIFIED_READING_TEST_HOOKS__ = { state, captureDom, syncPrimaryActionButtons, syncSuiteModeState, handleIncoming, buildEnvelope, buildReviewNavigatePayload, stopInitLoop }; })(typeof window !== 'undefined' ? window : globalThis);"
    );
    const context = vm.createContext(sandbox);
    vm.runInContext(source, context, { filename: 'js/runtime/unifiedReadingPage.js' });
    const hooks = context.window.__UNIFIED_READING_TEST_HOOKS__;
    hooks.captureDom();
    hooks.stopInitLoop();

    return {
        hooks,
        windowStub,
        submitBtn,
        resetBtn,
        postedMessages,
        suiteModeCalls
    };
}

function testInitSessionSimulationSyncsButtonsAndSuiteState() {
    const harness = createHarness();

    harness.hooks.handleIncoming({
        data: {
            type: 'INIT_SESSION',
            data: {
                examId: 'p1',
                sessionId: 'session-1',
                suiteSessionId: 'suite-1',
                suiteFlowMode: 'simulation',
                suiteSequenceIndex: 1,
                suiteSequenceTotal: 3
            }
        }
    });

    assert.strictEqual(harness.hooks.state.sessionId, 'session-1', 'INIT_SESSION 应写入 sessionId');
    assert.strictEqual(harness.hooks.state.suiteSessionId, 'suite-1', 'INIT_SESSION 应写入 suiteSessionId');
    assert.strictEqual(harness.hooks.state.simulationMode, true, 'simulation flow 应开启 simulationMode');
    assert.strictEqual(harness.submitBtn.textContent, '下一题', 'simulation 非最后一题时 submit 应切成 下一题');
    assert.strictEqual(harness.resetBtn.textContent, '上一题', 'simulation 模式下 reset 应切成 上一题');
    assert.deepStrictEqual(harness.suiteModeCalls, [true], 'suite mode 状态应同步给 practice-page-ui');
    assert.strictEqual(harness.windowStub.__UNIFIED_READING_SIMULATION_MODE__, true, 'runtime flag 应同步到全局');
    assert.strictEqual(harness.postedMessages.length, 1, 'INIT_SESSION 后应向父窗口回发 SESSION_READY');
    assert.strictEqual(harness.postedMessages[0].message.type, 'SESSION_READY', '应回发 SESSION_READY');
    assert.strictEqual(harness.postedMessages[0].origin, '*', 'SESSION_READY 应保持 file:// 兼容的 postMessage 目标');
}

function testSimulationContextUpdatesFlagsAndButtonLabels() {
    const harness = createHarness();
    harness.hooks.state.examId = 'p1';

    harness.hooks.handleIncoming({
        data: {
            type: 'SIMULATION_CONTEXT',
            data: {
                examId: 'p1',
                flowMode: 'simulation',
                currentIndex: 2,
                total: 3,
                isLast: true,
                canPrev: true,
                canNext: false,
                elapsed: 12
            }
        }
    });

    assert.strictEqual(harness.hooks.state.simulationMode, true, 'SIMULATION_CONTEXT 应保持 simulationMode');
    assert.strictEqual(harness.hooks.state.simulationContextReady, true, 'SIMULATION_CONTEXT 应标记 ready');
    assert.strictEqual(harness.submitBtn.textContent, 'Submit', '最后一题时 submit 文案应恢复为 Submit');
    assert.strictEqual(harness.resetBtn.disabled, false, '有上一题时 reset 不应禁用');
    assert.strictEqual(harness.windowStub.__UNIFIED_READING_SIMULATION_IS_LAST__, true, '最后一题 runtime flag 应同步');
}

function testBuildEnvelopeKeepsProtocolContract() {
    const harness = createHarness();
    harness.hooks.state.examId = 'p1';
    harness.hooks.state.sessionId = 'session-2';
    harness.hooks.state.suiteSessionId = 'suite-2';

    const envelope = harness.hooks.buildEnvelope('SIMULATION_NAVIGATE', { direction: 'next' });

    assert.strictEqual(envelope.type, 'SIMULATION_NAVIGATE', '消息类型应原样保留');
    assert.strictEqual(envelope.source, 'practice_page', '消息 source 应保持 practice_page');
    assert.strictEqual(envelope.data.examId, 'p1', '协议应保留 examId');
    assert.strictEqual(envelope.data.sessionId, 'session-2', '协议应保留 sessionId');
    assert.strictEqual(envelope.data.suiteSessionId, 'suite-2', '协议应保留 suiteSessionId');
    assert.strictEqual(envelope.data.direction, 'next', '自定义 payload 应被合并');
}

function testBuildReviewNavigatePayloadUsesCurrentReviewContext() {
    const harness = createHarness();
    harness.hooks.state.reviewSessionId = 'review-9';
    harness.hooks.state.suiteSessionId = 'suite-9';
    harness.hooks.state.reviewEntryIndex = 4;
    harness.hooks.state.suiteReviewMode = true;
    harness.hooks.state.reviewContext = {
        currentIndex: 3
    };

    const payload = harness.hooks.buildReviewNavigatePayload('next', true);

    assert.strictEqual(payload.direction, 'next', 'review navigate 应保留方向');
    assert.strictEqual(payload.reviewSessionId, 'review-9', 'review navigate 应包含 reviewSessionId');
    assert.strictEqual(payload.suiteSessionId, 'suite-9', 'review navigate 应包含 suiteSessionId');
    assert.strictEqual(payload.currentIndex, 3, 'review navigate 应优先使用当前 reviewContext 索引');
    assert.strictEqual(payload.finalizeOnNext, true, 'review navigate 应透传 finalizeOnNext');
}

function testInitSessionReviewModeKeepsEditableWhenReadOnlyFalse() {
    const harness = createHarness();

    harness.hooks.handleIncoming({
        data: {
            type: 'INIT_SESSION',
            data: {
                examId: 'p1',
                sessionId: 'session-review',
                reviewMode: true,
                readOnly: false,
                reviewSessionId: 'review-1',
                reviewEntryIndex: 2
            }
        }
    });

    assert.strictEqual(harness.hooks.state.reviewMode, true, 'review init 应进入 reviewMode');
    assert.strictEqual(harness.hooks.state.readOnly, false, 'readOnly=false 时不应强制锁成只读');
    assert.strictEqual(harness.submitBtn.disabled, false, 'readOnly=false 时 submit 不应被禁用');
    assert.strictEqual(harness.resetBtn.disabled, false, 'readOnly=false 时 reset 不应被禁用');
    assert.strictEqual(harness.postedMessages[0].message.data.reviewMode, true, 'SESSION_READY 应带回 reviewMode');
    assert.strictEqual(harness.postedMessages[0].message.data.readOnly, false, 'SESSION_READY 应带回 readOnly=false');
    assert.strictEqual(harness.postedMessages[0].message.data.reviewSessionId, 'review-1', 'SESSION_READY 应带回 reviewSessionId');
}

function testReviewContextAnsweringModeExitsReadOnly() {
    const harness = createHarness();
    harness.hooks.state.examId = 'p1';
    harness.hooks.state.reviewMode = true;
    harness.hooks.state.readOnly = true;
    harness.submitBtn.disabled = true;
    harness.resetBtn.disabled = true;

    harness.hooks.handleIncoming({
        data: {
            type: 'REVIEW_CONTEXT',
            data: {
                examId: 'p1',
                viewMode: 'answering',
                readOnly: false,
                currentIndex: 1,
                canPrev: true,
                canNext: true
            }
        }
    });

    assert.strictEqual(harness.hooks.state.reviewMode, false, 'answering 视图应退出 reviewMode');
    assert.strictEqual(harness.hooks.state.reviewViewMode, 'answering', 'answering 视图应写回 reviewViewMode');
    assert.strictEqual(harness.hooks.state.readOnly, false, 'answering 视图不应保持只读');
    assert.strictEqual(harness.submitBtn.disabled, false, 'answering 视图应恢复 submit 可用');
    assert.strictEqual(harness.resetBtn.disabled, false, 'answering 视图应恢复 reset 可用');
}

function main() {
    try {
        testInitSessionSimulationSyncsButtonsAndSuiteState();
        testSimulationContextUpdatesFlagsAndButtonLabels();
        testBuildEnvelopeKeepsProtocolContract();
        testBuildReviewNavigatePayloadUsesCurrentReviewContext();
        testInitSessionReviewModeKeepsEditableWhenReadOnlyFalse();
        testReviewContextAnsweringModeExitsReadOnly();
        console.log(JSON.stringify({
            status: 'pass',
            detail: 'unifiedReadingPage 已覆盖 INIT_SESSION/SIMULATION_CONTEXT 协议、review init 可编辑合同、REVIEW_CONTEXT answering 退只读合同、SESSION_READY envelope 与 review navigate payload 合同'
        }, null, 2));
    } catch (error) {
        console.log(JSON.stringify({
            status: 'fail',
            detail: error.message
        }, null, 2));
        process.exit(1);
    }
}

main();
