import assert from 'node:assert/strict';
import { test } from 'node:test';
import { harness, read } from './helpers/diagnosticHarness.js';

function setup(kind = 'bridge', configure) {
    const h = harness({ install: false });
    const timers = [], sent = [], presentations = [], bindings = [];
    const w = h.sandbox;
    w.setTimeout = (fn, delay) => { const timer = { fn, delay }; timers.push(timer); return timer; };
    w.clearTimeout = timer => { if (timer) timer.cancelled = true; };
    w.setInterval = (fn, delay) => { const timer = { fn, delay, interval: true }; timers.push(timer); return timer; };
    w.clearInterval = w.clearTimeout;
    w.parent = w;
    w.opener = { postMessage(message) { sent.push(structuredClone(message)); } };
    w.location = { protocol: 'file:', pathname: '/fixtures/practice.html', href: 'file:///fixtures/practice.html?private=PRIVATE_QUERY' };
    w.document.referrer = '';
    w.document.querySelector = () => null;
    w.document.documentElement = { dataset: {} };
    w.document.currentScript = { src: `file:///repo/js/bundles/${kind === 'bridge' ? 'listening-record-bridge' : 'practice-page-enhancer'}.bundle.js` };
    w.document.readyState = 'loading';
    w.practicePageEnhancerConfig = { autoInitialize: false };
    const answer = { value: 'PRIVATE_ANSWER' };
    w.document.querySelector = selector => selector === '[name="q1"]' ? answer : null;
    w.document.querySelectorAll = selector => selector === '[name="q1"]' ? [answer] : [];
    w.App = { state: { isReviewing: true }, config: { questionList: [1], answerKey: { text: { q1: 'PRIVATE_TRANSCRIPT' } } } };
    h.run('js/diagnostics/practiceDiagnosticBootstrap.js');
    h.run('js/diagnostics/diagnosticReporter.js');
    h.run('js/diagnostics/operationDiagnostics.js');
    h.run('js/diagnostics/diagnosticExport.js');
    w.AppDiagnosticChannel = { createChild() { return { connect(binding) { bindings.push(binding); } }; } };
    w.getMessageCenter = () => ({ showIncident(id, presentation) { presentations.push({ id, presentation }); } });
    h.run('js/diagnostics/practiceDiagnostics.js');
    configure?.(h);
    h.run(kind === 'bridge' ? 'js/listeningRecordBridge.js' : 'js/practice-page-enhancer.js');
    if (kind === 'bridge') h.emit('document:DOMContentLoaded');
    else w.practicePageEnhancer.setupCommunication();
    const init = { sessionId: 'PRIVATE_SESSION', examId: 'PRIVATE_EXAM', suiteSessionId: 'PRIVATE_SUITE',
        windowSessionToken: 'PRIVATE_TOKEN', parentOrigin: 'null' };
    function dispatch(type, data, overrides = {}) {
        h.emit('message', { source: w.opener, origin: 'null', data: { type, source: 'exam_host', data }, ...overrides });
    }
    return { ...h, timers, sent, answer, presentations, bindings, init, dispatch,
        events: () => w.AppDiagnostics.snapshot().events,
        expire() { for (const timer of [...timers]) if (!timer.cancelled && !timer.interval && timer.delay === 10000) {
            timer.cancelled = true; timer.fn();
        } },
        submit() {
            if (kind === 'bridge') return w.__listeningBridgeComplete();
            return w.practicePageEnhancer.sendMessage('PRACTICE_COMPLETE', { answers: { q1: answer.value }, notes: 'PRIVATE_NOTE' });
        },
        latest() { return sent.filter(message => message.type === 'PRACTICE_COMPLETE').at(-1)?.data; }
    };
}

for (const kind of ['bridge', 'enhancer']) {
    test(`${kind}: trusted INIT only, timeout stays unconfirmed, retry preserves the original payload and receipt`, async () => {
        const h = setup(kind);
        h.dispatch('INIT_SESSION', h.init, { source: {} });
        assert.equal(h.bindings.length, 0);
        h.dispatch('INIT_SESSION', { ...h.init, windowSessionToken: '' });
        assert.equal(h.bindings.length, 0);
        h.dispatch('INIT_SESSION', h.init);
        assert.equal(h.bindings.length, 1);
        h.submit();
        const original = h.latest();
        h.answer.value = 'PRIVATE_EDITED';
        h.expire();
        const event = h.events().at(-1);
        assert.equal(event.code, 'PRACTICE_CHANNEL_TIMEOUT');
        assert.equal(event.notification.kind, 'dialog');
        assert.equal(event.persistence.operation, 'unconfirmed');
        const retry = h.presentations.at(-1).presentation.retry.run;
        const waiting = retry();
        assert.deepEqual(h.latest(), original);
        h.dispatch('PRACTICE_SUBMIT_ACK', { ...original, windowSessionToken: 'WRONG_TOKEN' });
        assert.equal(kind === 'bridge' ? h.sandbox.__listeningBridgeGetState().completed : h.sandbox.practicePageEnhancer.pendingSubmissions.size === 0, false);
        h.dispatch('PRACTICE_SUBMIT_ACK', original);
        assert.equal((await waiting).verified, true);
        assert.equal((await retry()).operation, 'committed');
        const report = await h.sandbox.AppDiagnosticExport.exportJSON();
        assert.doesNotMatch(report.json, /PRIVATE_|WRONG_TOKEN/);
        assert.equal(report.report.collection.entryCoverage.capture, 'late-injection');
        assert.ok(report.report.collection.entryCoverage.limitations.includes('earlier-failures-unavailable'));
    });

    test(`${kind}: storage rejection retains safe cause and original IDs; stale retry cannot target a replaced session`, async () => {
        const h = setup(kind);
        h.dispatch('INIT_SESSION', h.init); h.submit();
        const original = h.latest();
        h.dispatch('PRACTICE_SUBMIT_FAILED', { ...original, errorCode: 'QUOTA_EXCEEDED' });
        const event = h.events().at(-1);
        assert.equal(event.code, 'PRACTICE_SAVE_FAILED');
        assert.equal(event.causeCode, 'QUOTA_EXCEEDED');
        assert.equal(event.persistence.operation, 'unconfirmed');
        const retry = h.presentations.at(-1).presentation.retry.run;
        h.dispatch('INIT_SESSION', { ...h.init, sessionId: 'PRIVATE_REPLACEMENT' });
        const count = h.sent.length;
        assert.equal((await retry()).verified, false);
        assert.equal(h.sent.length, count);
    });

    test(`${kind}: missing handshake is visible and diagnostics failure cannot prevent business sending`, () => {
        const h = setup(kind);
        h.expire();
        assert.equal(h.events().at(-1).action, 'handshake');
        h.sandbox.AppOperationDiagnostics = { breadcrumb() { throw new Error(); }, failure() { throw new Error(); } };
        h.dispatch('INIT_SESSION', h.init);
        assert.doesNotThrow(() => h.submit());
        assert.ok(h.latest().submissionId);
    });
}

test('optional listening media is declared before loading; required failures retain only a safe reference', async () => {
    const h = setup();
    const audio = { tagName: 'AUDIO', src: 'file:///PRIVATE_FOLDER/PRIVATE_TRANSCRIPT.mp3?PRIVATE_TOKEN' };
    h.emit('error', { target: audio });
    assert.equal(h.events().at(-1).notification.kind, 'none');
    assert.equal(h.events().at(-1).resource.optional, true);
    const bundle = { src: 'file:///PRIVATE_FOLDER/js/bundles/listening-record-bridge.bundle.js?PRIVATE_TOKEN' };
    h.sandbox.AppDiagnostics.declareResource(bundle, { url: bundle.src, optional: false });
    h.emit('error', { target: bundle });
    assert.equal(h.events().at(-1).resource.path, 'js/bundles/listening-record-bridge.bundle.js');
    assert.equal(h.events().at(-1).resource.status, 'unknown');
    assert.equal(h.events().at(-1).notification.kind, 'persistent');
    const report = await h.sandbox.AppDiagnosticExport.exportJSON();
    assert.doesNotMatch(report.json, /PRIVATE_/);
});

test('early controlled coverage is preserved by bundle handoff; hostile coverage cannot enter exports', async () => {
    const h = harness({ install: false });
    h.sandbox.AppDiagnosticBootstrap.install({ context: 'listening', entryCoverage: { entry: 'listening-wrapper', capture: 'before-dependencies' } });
    h.run('js/diagnostics/practiceDiagnosticBootstrap.js');
    h.run('js/diagnostics/diagnosticReporter.js');
    h.run('js/diagnostics/diagnosticExport.js');
    const report = await h.sandbox.AppDiagnosticExport.snapshot();
    assert.equal(report.collection.entryCoverage.capture, 'before-dependencies');
    assert.equal(JSON.parse(h.sandbox.AppDiagnostics.exportText()).entryCoverage.entry, 'listening-wrapper');
    const malicious = { get entry() { throw new Error('PRIVATE_TOKEN'); }, capture: 'PRIVATE_ANSWER', limitations: ['PRIVATE_NOTE'] };
    assert.doesNotThrow(() => h.sandbox.AppDiagnosticContract.sanitizeEntryCoverage(malicious));
    assert.doesNotMatch(JSON.stringify(h.sandbox.AppDiagnosticContract.sanitizeEntryCoverage(malicious)), /PRIVATE_/);
});

test('cancelled bridge completion creates no critical report or submission', () => {
    const h = setup();
    h.sandbox.App = null;
    h.dispatch('INIT_SESSION', h.init);
    assert.equal(h.submit(), false);
    assert.equal(h.latest(), undefined);
    assert.equal(h.events().length, 0);
});
