import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const bridgeSource = fs.readFileSync(path.join(repoRoot, 'js/listeningRecordBridge.js'), 'utf8');

function createHarness(options = {}) {
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
    const suiteContainers = options.multiSuite ? [{}, {}] : [];
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
        querySelectorAll(selector) {
            if (selector === '[name="q1"]') return [answerInput];
            return selector === '[data-suite-id]' ? suiteContainers : [];
        },
        createElement() {
            return {
                innerHTML: '',
                querySelector() { return null; },
                querySelectorAll() { return []; }
            };
        }
    };
    let uuidIndex = 0;
    const uuidValues = options.uuidValues || ['fixed-submission', 'second-submission', 'third-submission'];
    const defaultApp = {
        state: { isReviewing: true },
        config: {
            questionList: [1],
            answerKey: {
                text: { q1: 'accommodation' }
            }
        }
    };
    if (options.multiSuite) {
        defaultApp.finishSuite = function finishSuite(suiteId) {
            this.lastFinishedSuiteId = suiteId;
            answerInput.value = suiteId === 'set2' ? 'library' : 'accommodation';
            this.config.answerKey.text.q1 = answerInput.value;
        };
    }
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
                const value = uuidValues[Math.min(uuidIndex, uuidValues.length - 1)];
                uuidIndex += 1;
                return value;
            }
        },
        App: options.withoutApp ? null : defaultApp,
        addEventListener(type, listener) {
            if (type === 'message') messageListeners.push(listener);
        }
    };
    if (options.correctAnswers) window.correctAnswers = options.correctAnswers;
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

function latestActiveTimer(harness, delay) {
    return harness.timers.slice().reverse().find(
        (timer) => !timer.interval && timer.delay === delay && !timer.cancelled
    );
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

    const globalAnswersHarness = createHarness({
        withoutApp: true,
        correctAnswers: { q1: 'accommodation' }
    });
    assert.strictEqual(
        globalAnswersHarness.window.__listeningBridgeComplete({ allowGenerated: true }),
        true,
        'window.correctAnswers must be a supported normalized listening contract'
    );
    globalAnswersHarness.dispatch('INIT_SESSION', {
        examId: 'listening-global-answers',
        sessionId: 'global-answers-session',
        windowSessionToken: 'global-answers-token',
        parentOrigin: 'null'
    });
    const globalAnswersCompletion = messagesOf(globalAnswersHarness, 'PRACTICE_COMPLETE').at(-1);
    assert(globalAnswersCompletion, 'window.correctAnswers completion must reach the host');
    assert.strictEqual(globalAnswersCompletion.message.data.answers.q1, 'accommodation');
    assert.strictEqual(globalAnswersCompletion.message.data.correctAnswers.q1, 'accommodation');
    assert.strictEqual(globalAnswersCompletion.message.data.scoreInfo.correct, 1);

    const multiSuiteHarness = createHarness({ multiSuite: true });
    multiSuiteHarness.dispatch('INIT_SESSION', {
        examId: 'listening-100-p1',
        sessionId: 'multi-suite-session',
        windowSessionToken: 'multi-suite-token',
        parentOrigin: 'null'
    });
    assert(
        multiSuiteHarness.window.App.finishSuite._bridgeOriginal,
        'bridge must wrap App.finishSuite for legacy multi-suite listening pages'
    );

    multiSuiteHarness.window.App.finishSuite('set1');
    const firstSuiteDebounce = latestActiveTimer(multiSuiteHarness, 500);
    assert(firstSuiteDebounce, 'first suite finish must schedule collection');
    firstSuiteDebounce.callback();
    const firstSuiteMessage = messagesOf(multiSuiteHarness, 'PRACTICE_COMPLETE').at(-1);
    assert(firstSuiteMessage, 'first suite must emit completion');
    assert.strictEqual(firstSuiteMessage.message.data.suiteId, 'set1');
    assert.strictEqual(firstSuiteMessage.message.data.totalSuites, 2);
    assert.strictEqual(firstSuiteMessage.message.data.submissionId, 'listening-submit-set1-fixed-submission');

    multiSuiteHarness.dispatch('PRACTICE_SUBMIT_ACK', {
        submissionId: firstSuiteMessage.message.data.submissionId,
        sessionId: 'multi-suite-session',
        windowSessionToken: 'multi-suite-token'
    });
    const countAfterFirstAck = messagesOf(multiSuiteHarness, 'PRACTICE_COMPLETE').length;
    multiSuiteHarness.window.App.finishSuite('set1');
    assert.strictEqual(
        messagesOf(multiSuiteHarness, 'PRACTICE_COMPLETE').length,
        countAfterFirstAck,
        'repeating an ACKed suite must remain idempotent'
    );

    multiSuiteHarness.window.App.finishSuite('set2');
    const secondSuiteDebounce = latestActiveTimer(multiSuiteHarness, 500);
    assert(secondSuiteDebounce, 'second suite must have an independent debounce latch');
    secondSuiteDebounce.callback();
    let suiteMessages = messagesOf(multiSuiteHarness, 'PRACTICE_COMPLETE');
    const secondSuiteMessage = suiteMessages.at(-1);
    assert.strictEqual(secondSuiteMessage.message.data.suiteId, 'set2');
    assert.strictEqual(secondSuiteMessage.message.data.submissionId, 'listening-submit-set2-second-submission');

    const secondSuiteRetry = latestActiveTimer(multiSuiteHarness, 400);
    assert(secondSuiteRetry, 'unacknowledged second suite must schedule persistence retry');
    secondSuiteRetry.callback();
    suiteMessages = messagesOf(multiSuiteHarness, 'PRACTICE_COMPLETE');
    assert.strictEqual(suiteMessages.at(-1).message.data.submissionId, secondSuiteMessage.message.data.submissionId);
    assert.strictEqual(suiteMessages.at(-2).message.data.submissionId, secondSuiteMessage.message.data.submissionId);

    const secondAck = {
        submissionId: secondSuiteMessage.message.data.submissionId,
        sessionId: 'multi-suite-session',
        windowSessionToken: 'multi-suite-token'
    };
    multiSuiteHarness.dispatch('PRACTICE_SUBMIT_ACK', secondAck);
    multiSuiteHarness.dispatch('PRACTICE_SUBMIT_ACK', secondAck);
    const multiSuiteState = multiSuiteHarness.window.__listeningBridgeGetState();
    assert.strictEqual(Object.keys(multiSuiteState.pendingCompletions).length, 0);
    assert.deepStrictEqual(
        Object.keys(multiSuiteState.completedCompletions).sort(),
        ['suite:set1', 'suite:set2'],
        'two suites must settle independently despite repeated ACK delivery'
    );

    console.log(JSON.stringify({
        status: 'pass',
        detail: 'listening global-answer, pre-INIT, retry/ACK and multi-suite completion checks passed'
    }));
}

try {
    run();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
