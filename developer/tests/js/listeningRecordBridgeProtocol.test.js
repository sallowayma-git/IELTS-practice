import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const bridgeSource = fs.readFileSync(path.join(repoRoot, 'js/listeningRecordBridge.js'), 'utf8');

function createHarness() {
    const posted = [];
    const messageListeners = [];
    const timers = [];
    let nextTimerId = 1;

    const parentWindow = {
        postMessage(message, targetOrigin) {
            posted.push({ message, targetOrigin });
        }
    };
    const answerInput = { value: 'accommodation' };
    const document = {
        readyState: 'complete',
        title: 'Listening protocol test',
        referrer: '',
        body: null,
        documentElement: {},
        activeElement: null,
        addEventListener() {},
        querySelector(selector) {
            return selector === '[name="q1"]' ? answerInput : null;
        },
        querySelectorAll() {
            return [];
        },
        createElement() {
            return {
                innerHTML: '',
                querySelector() { return null; },
                querySelectorAll() { return []; }
            };
        }
    };
    const window = {
        document,
        opener: parentWindow,
        parent: null,
        location: {
            protocol: 'file:',
            href: 'file:///fixtures/listening.html?examId=listening-protocol',
            pathname: '/fixtures/listening.html'
        },
        crypto: {
            randomUUID() {
                return 'fixed-submission';
            }
        },
        App: {
            state: { isReviewing: true },
            config: {
                questionList: [1],
                answerKey: {
                    text: { q1: 'accommodation' }
                }
            }
        },
        addEventListener(type, listener) {
            if (type === 'message') messageListeners.push(listener);
        }
    };
    window.parent = window;

    const sandbox = {
        window,
        document,
        URL,
        Uint8Array,
        console: {
            log() {},
            warn() {},
            error() {}
        },
        setInterval(callback, delay) {
            const timer = { id: nextTimerId++, callback, delay, interval: true, cancelled: false };
            timers.push(timer);
            return timer.id;
        },
        clearInterval(id) {
            const timer = timers.find((item) => item.id === id);
            if (timer) timer.cancelled = true;
        },
        setTimeout(callback, delay) {
            const timer = { id: nextTimerId++, callback, delay, interval: false, cancelled: false };
            timers.push(timer);
            return timer.id;
        },
        clearTimeout(id) {
            const timer = timers.find((item) => item.id === id);
            if (timer) timer.cancelled = true;
        }
    };
    sandbox.globalThis = sandbox;
    vm.runInContext(bridgeSource, vm.createContext(sandbox), {
        filename: 'js/listeningRecordBridge.js'
    });

    assert.strictEqual(messageListeners.length, 1, 'bridge must register one host message listener');
    return {
        window,
        parentWindow,
        posted,
        timers,
        dispatch(type, data, overrides = {}) {
            messageListeners[0]({
                source: overrides.source || parentWindow,
                origin: overrides.origin === undefined ? 'null' : overrides.origin,
                data: {
                    type,
                    source: overrides.messageSource || 'exam_host',
                    data
                }
            });
        }
    };
}

function messagesOf(harness, type) {
    return harness.posted.filter((entry) => entry.message && entry.message.type === type);
}

function run() {
    const harness = createHarness();
    const state = harness.window.__listeningBridgeGetState();

    assert.strictEqual(harness.window.__listeningBridgeComplete(), true);
    assert(state.pendingCompletion, 'pre-INIT completion must be retained');
    assert.strictEqual(state.pendingCompletion.submissionId, 'listening-submit-fixed-submission');
    assert.strictEqual(state.completed, false, 'completion cannot settle before persistence ACK');
    assert.strictEqual(messagesOf(harness, 'PRACTICE_COMPLETE').length, 0, 'pre-INIT must not emit completion');
    assert(messagesOf(harness, 'REQUEST_INIT').length >= 1, 'pre-INIT completion must request initialization');
    assert(harness.posted.every((entry) => entry.targetOrigin === '*'), 'file bridge sends must use wildcard targetOrigin');

    harness.dispatch('INIT_SESSION', {
        examId: 'listening-protocol',
        sessionId: 'host-session',
        windowSessionToken: 'host-token',
        parentOrigin: 'null',
        startTime: 1000
    });

    const firstCompletion = messagesOf(harness, 'PRACTICE_COMPLETE').at(-1);
    assert(firstCompletion, 'trusted INIT must flush pending completion');
    assert.strictEqual(firstCompletion.message.data.submissionId, 'listening-submit-fixed-submission');
    assert.strictEqual(firstCompletion.message.data.sessionId, 'host-session');
    assert.strictEqual(firstCompletion.message.data.windowSessionToken, 'host-token');
    assert.strictEqual(state.completed, false, 'emission alone must not mark completion');

    const retryTimer = harness.timers.find((timer) => !timer.interval && timer.delay === 400 && !timer.cancelled);
    assert(retryTimer, 'completion must schedule a persistence retry');
    retryTimer.callback();
    const completionMessages = messagesOf(harness, 'PRACTICE_COMPLETE');
    assert.strictEqual(completionMessages.length, 2, 'timeout must resend completion');
    assert.strictEqual(
        completionMessages[0].message.data.submissionId,
        completionMessages[1].message.data.submissionId,
        'retry must reuse the same submissionId'
    );

    harness.dispatch('PRACTICE_SUBMIT_ACK', {
        submissionId: 'forged-submission',
        sessionId: 'host-session',
        windowSessionToken: 'host-token'
    });
    assert.strictEqual(state.completed, false, 'mismatched submission ACK must be ignored');

    harness.dispatch('PRACTICE_SUBMIT_ACK', {
        submissionId: 'listening-submit-fixed-submission',
        sessionId: 'host-session',
        windowSessionToken: 'host-token'
    }, { origin: 'https://forged.example' });
    assert.strictEqual(state.completed, false, 'wrong-origin ACK must be ignored');

    harness.dispatch('PRACTICE_SUBMIT_ACK', {
        submissionId: 'listening-submit-fixed-submission',
        sessionId: 'host-session',
        windowSessionToken: 'host-token'
    });
    assert.strictEqual(state.completed, true, 'trusted persisted ACK must settle completion');
    assert.strictEqual(state.pendingCompletion, null, 'settled completion must release pending payload');
    assert(
        harness.timers.filter((timer) => !timer.interval).every((timer) => timer.cancelled),
        'trusted ACK must cancel every completion retry'
    );

    console.log(JSON.stringify({
        status: 'pass',
        detail: 'listening pre-INIT completion, same-submission retry and persisted ACK checks passed'
    }));
}

try {
    run();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
