import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { loadHooks } from './unifiedReadingPageInlineSuiteRegression.test.js';
import { read, root, harness } from './helpers/diagnosticHarness.js';
import { buildGeneratedPreserveFileNames, resetGeneratedDir } from '../tools/reading-json/generate_reading_assets.node.js';

function setup(options = {}) {
    const presentations = [], calls = [];
    const parent = { postMessage(message) { calls.push(message); } };
    const h = loadHooks(({ context, window }) => {
        window.DOMException = DOMException;
        for (const file of ['diagnosticContract', 'bootstrapCollector', 'diagnosticReporter', 'operationDiagnostics']) {
            vm.runInContext(read(`js/diagnostics/${file}.js`), context);
        }
        window.AppDiagnostics.markReady();
        window.getMessageCenter = () => ({ showIncident(id, presentation) { presentations.push({ id, presentation }); } });
        options.configure?.({ context, window });
    });
    h.hooks.setTestState({ examId: 'reading-p1', sessionId: 'PRIVATE_SESSION', parentWindow: parent,
        parentOrigin: 'http://localhost', expectedParentOrigin: 'http://localhost', windowSessionToken: 'PRIVATE_TOKEN',
        windowSessionGeneration: 1 });
    const ack = () => h.hooks.handleIncoming({ source: parent, origin: 'http://localhost', data: {
        source: 'exam_host', type: 'PRACTICE_SUBMIT_ACK', data: { examId: 'reading-p1', sessionId: 'PRIVATE_SESSION',
            submissionId: h.hooks.getTestState().submissionId, windowSessionToken: 'PRIVATE_TOKEN' }
    } });
    return { ...h, parent, calls, presentations, ack, events: () => h.window.AppDiagnostics.snapshot().events };
}

test('reading timeout offers business retry with the original immutable snapshot and matching confirmation', async () => {
    const h = setup();
    const payload = { answers: { q1: 'PRIVATE_ANSWER' }, notes: 'PRIVATE_NOTE' };
    h.hooks.beginSubmission('PRACTICE_COMPLETE', payload);
    const id = h.hooks.getTestState().submissionId;
    payload.answers.q1 = 'PRIVATE_EDITED';
    h.hooks.expirePendingSubmission(id);
    const event = h.events().at(-1);
    assert.equal(event.code, 'PRACTICE_CHANNEL_TIMEOUT'); assert.equal(event.notification.kind, 'dialog');
    assert.equal(event.persistence.operation, 'unconfirmed'); assert.equal(event.retry.available, true);
    assert.ok(!JSON.stringify(event).includes('PRIVATE_'));
    const retry = h.presentations.at(-1).presentation.retry.run();
    assert.equal(h.calls.at(-1).data.submissionId, id);
    assert.equal(h.calls.at(-1).data.answers.q1, 'PRIVATE_ANSWER');
    await h.ack();
    assert.deepEqual(JSON.parse(JSON.stringify(await retry)), { verified: true, operation: 'committed' });
    assert.equal(h.hooks.getTestState().submissionStatus, 'submitted');
    assert.equal(h.hooks.beginSubmission('PRACTICE_COMPLETE', {}), false);
});

for (const outcome of ['timeout', 'nack']) test(`ordinary submit after ${outcome} reconciles the original receipt with editing locked`, async () => {
    const h = setup();
    h.hooks.setTestState({ dataset: { meta: {}, questionOrder: ['q1'], answerKey: { q1: 'A' }, questionGroups: [] } });
    await h.hooks.handleSubmit();
    const original = h.calls.at(-1).data;
    assert.equal(original.answers.q1, 'A');
    if (outcome === 'timeout') h.hooks.expirePendingSubmission();
    else await h.hooks.handleIncoming({ source: h.parent, origin: 'http://localhost', data: {
        source: 'exam_host', type: 'PRACTICE_SUBMIT_FAILED', data: { ...original, windowSessionToken: 'PRIVATE_TOKEN' }
    } });
    const oldRetry = h.presentations.at(-1).presentation.retry.run;
    assert.equal(h.hooks.getTestState().submissionEditingLocked, true);
    assert.equal(h.hooks.getReadingTimingState()?.context.editable ?? false, false);
    await h.hooks.handleSubmit();
    assert.equal(h.calls.at(-1).data.answers.q1, 'A');
    assert.equal(h.calls.at(-1).data.submissionId, original.submissionId);
    const count = h.calls.length;
    assert.equal((await oldRetry()).verified, false); assert.equal(h.calls.length, count);
    await h.ack();
    assert.equal(h.hooks.getTestState().submissionStatus, 'submitted');
    assert.equal((await oldRetry()).verified, true, 'the original receipt callback remains valid');
});

test('a proven first-attempt rejection unlocks edits and a fresh answer/timing snapshot', async () => {
    const h = setup();
    h.hooks.setTestState({ dataset: { meta: {}, questionOrder: ['q1'], answerKey: { q1: 'A' }, questionGroups: [] } });
    await h.hooks.handleSubmit();
    const original = h.calls.at(-1).data;
    await h.hooks.handleIncoming({ source: h.parent, origin: 'http://localhost', data: {
        source: 'exam_host', type: 'PRACTICE_SUBMIT_FAILED', data: { ...original,
            operation: 'not-committed', windowSessionToken: 'PRIVATE_TOKEN' }
    } });
    assert.equal(h.hooks.getTestState().submissionEditingLocked, false);
    assert.equal(h.events().at(-1).persistence.operation, 'not-committed');
    assert.equal(h.events().at(-1).retry.available, false);
    h.document.querySelectorAll('input[type="radio"][name="q1"]')[0].value = 'B';
    await h.hooks.handleSubmit();
    assert.equal(h.calls.at(-1).data.answers.q1, 'B');
    assert.notEqual(h.calls.at(-1).data.submissionId, original.submissionId);
    await h.hooks.handleIncoming({ source: h.parent, origin: 'http://localhost', data: {
        source: 'exam_host', type: 'PRACTICE_SUBMIT_ACK', data: { ...original, windowSessionToken: 'PRIVATE_TOKEN' }
    } });
    assert.equal(h.hooks.getTestState().submissionStatus, 'submitting');
    await h.ack();
});

test('a rejected retry cannot disprove an earlier unconfirmed commit or discard its receipt', async () => {
    const h = setup();
    h.hooks.beginSubmission('PRACTICE_COMPLETE', { answers: { q1: 'A' } });
    const original = h.calls.at(-1).data;
    h.hooks.expirePendingSubmission();
    await h.hooks.handleSubmit();
    await h.hooks.handleIncoming({ source: h.parent, origin: 'http://localhost', data: {
        source: 'exam_host', type: 'PRACTICE_SUBMIT_FAILED', data: { ...original,
            operation: 'not-committed', windowSessionToken: 'PRIVATE_TOKEN' }
    } });
    assert.equal(h.hooks.getTestState().submissionEditingLocked, true);
    assert.equal(h.hooks.getTestState().submissionId, original.submissionId);
    assert.equal(h.events().at(-1).persistence.operation, 'unconfirmed');
    const retry = h.presentations.at(-1).presentation.retry.run();
    await h.ack();
    assert.equal((await retry).verified, true);
});

test('stale retry cannot target a replacement session', async () => {
    const h = setup();
    h.hooks.beginSubmission('PRACTICE_COMPLETE', { answers: { q1: 'original' } });
    h.hooks.expirePendingSubmission();
    const oldRetry = h.presentations.at(-1).presentation.retry.run;
    h.hooks.setTestState({ sessionId: 'replacement', windowSessionToken: 'replacement-token', windowSessionGeneration: 2 });
    const count = h.calls.length;
    assert.equal((await oldRetry()).verified, false); assert.equal(h.calls.length, count);
});

for (const finalSubmission of [true, false]) test(`suite ACK renders the active passage and retains final=${finalSubmission} from submission`, async () => {
    const h = setup();
    const resultPanel = { innerHTML: '', style: {} };
    const getElement = h.document.getElementById.bind(h.document);
    h.document.getElementById = id => id === 'results' ? resultPanel : getElement(id);
    h.hooks.captureDom();
    const makeSlot = (examId, answer, order) => {
        const dataset = { meta: {}, questionOrder: order, answerKey: {}, questionGroups: [] };
        return { examId, dataKey: examId, dataset, draft: { answers: { q1: answer }, highlights: [] },
            lastResults: h.hooks.buildResultsFromAnswers(dataset, { q1: answer }) };
    };
    const p1 = makeSlot('reading-p1', 'PASSAGE_ONE', ['q1']);
    const p3 = makeSlot('reading-p3', 'PASSAGE_THREE', ['q1', 'q2']);
    const submitted = finalSubmission ? p3 : p1;
    const active = finalSubmission ? p1 : p3;
    h.hooks.setTestState({ examId: submitted.examId, dataset: submitted.dataset, suiteSessionId: 'suite',
        simulationMode: true, simulationCtx: { isLast: finalSubmission },
        suite: { inline: true, activeExamId: submitted.examId, activationGeneration: 1,
            slotsByExamId: new Map([[p1.examId, p1], [p3.examId, p3]]) } });
    h.hooks.beginSubmission('SIMULATION_SUBMIT', {}, { results: submitted.lastResults, highlights: [] });
    h.hooks.setTestState({ examId: active.examId, dataset: active.dataset, lastResults: active.lastResults,
        simulationCtx: { isLast: !finalSubmission }, suite: { activeExamId: active.examId, activationGeneration: 2 } });
    let explanationExam;
    h.hooks.setTestOverride('renderExplanations', options => { explanationExam = options.examId; });
    await h.hooks.acceptSubmissionAcknowledgement({ examId: submitted.examId, sessionId: 'PRIVATE_SESSION',
        suiteSessionId: 'suite', submissionId: h.hooks.getTestState().submissionId });
    assert.equal(explanationExam, active.examId);
    assert.ok(resultPanel.innerHTML.includes(active.draft.answers.q1));
    assert.ok(!resultPanel.innerHTML.includes(submitted.draft.answers.q1));
    assert.equal(h.hooks.getTestState().readOnly, true);
    assert.equal(h.getCloseCount(), finalSubmission ? 1 : 0);
});

test('negative host result remains unconfirmed and a late ACK stays ignored until explicit retry', async () => {
    const h = setup();
    h.hooks.beginSubmission('PRACTICE_COMPLETE', {});
    const id = h.hooks.getTestState().submissionId;
    await h.hooks.handleIncoming({ source: h.parent, origin: 'http://localhost', data: { type: 'PRACTICE_SUBMIT_FAILED', source: 'exam_host',
        data: { examId: 'reading-p1', sessionId: 'PRIVATE_SESSION', submissionId: id, windowSessionToken: 'PRIVATE_TOKEN', errorCode: 'QUOTA_EXCEEDED' } } });
    assert.equal(h.events().at(-1).causeCode, 'QUOTA_EXCEEDED');
    assert.equal(h.events().at(-1).persistence.operation, 'unconfirmed');
    await h.ack(); assert.equal(h.hooks.getTestState().submissionStatus, 'draft');
});

test('closed parent retains local submission evidence and reporting failures cannot alter submission state', () => {
    const h = setup();
    h.parent.closed = true;
    assert.equal(h.hooks.beginSubmission('PRACTICE_COMPLETE', {}), false);
    assert.equal(h.events().at(-1).persistence.operation, 'unconfirmed');
    assert.equal(h.hooks.getTestState().submissionStatus, 'draft');
    h.window.AppOperationDiagnostics = { failure() { throw new Error('broken reporter'); }, breadcrumb() { throw new Error('broken reporter'); } };
    h.parent.closed = false;
    assert.equal(h.hooks.beginSubmission('PRACTICE_COMPLETE', {}), true);
    assert.equal(h.hooks.expirePendingSubmission(), true);
});

test('quota, false recovery results and missing recovery backend never claim a saved mirror', () => {
    const h = setup();
    h.hooks.setTestState({ suiteSessionId: 'PRIVATE_SUITE' });
    h.windowSession.save = () => { throw new DOMException('PRIVATE_NOTE', 'QuotaExceededError'); };
    assert.equal(h.hooks.persistSimulationDraftMirror({ answers: { q1: 'PRIVATE_ANSWER' } }), false);
    assert.equal(h.events().at(-1).causeCode, 'QUOTA_EXCEEDED');
    assert.equal(h.events().at(-1).persistence.operation, 'not-committed');
    h.windowSession.save = () => false;
    assert.equal(h.hooks.persistSimulationDraftMirror({}), false);
    delete h.window.AppData.recovery.windowSession;
    assert.equal(h.hooks.persistSimulationDraftMirror({}), false);
    assert.equal(h.events().at(-1).causeCode, 'BACKEND_UNAVAILABLE');
    assert.ok(!JSON.stringify(h.events()).includes('PRIVATE_'));
});

test('authenticated INIT installs transport only after source, origin, token, exam and generation validation', async () => {
    const connections = [];
    const host = harness();
    const aliases = host.collector.correlate({ session: 'PRIVATE_SESSION' });
    const h = setup({ configure({ window }) { window.AppDiagnosticChannel = { createChild: () => ({ connect(binding) { connections.push(binding); } }) }; } });
    const envelope = { source: 'exam_host', type: 'INIT_SESSION', data: { examId: 'reading-p1', sessionId: 'PRIVATE_SESSION',
        parentOrigin: 'http://localhost', windowSessionToken: 'PRIVATE_TOKEN', windowSessionGeneration: 1, diagnosticCorrelation: aliases } };
    await h.hooks.handleIncoming({ source: {}, origin: 'http://localhost', data: envelope });
    await h.hooks.handleIncoming({ source: h.parent, origin: 'http://wrong.invalid', data: envelope });
    assert.equal(connections.length, 0);
    await h.hooks.handleIncoming({ source: h.parent, origin: 'http://localhost', data: envelope });
    h.hooks.stopReadingDraftSync();
    assert.equal(connections.length, 1);
    assert.equal(connections[0].windowSessionToken, 'PRIVATE_TOKEN');
    h.hooks.beginSubmission('PRACTICE_COMPLETE', {}); h.hooks.expirePendingSubmission();
    assert.equal(h.events().at(-1).correlation.scopeId, aliases.scopeId);
    assert.equal(h.events().at(-1).correlation.session, aliases.session);
});

test('handshake readiness deadline survives a received session whose initialization has not finished', () => {
    const timeouts = new Map(), intervals = new Map();
    let next = 0;
    const h = setup({ configure({ context, window }) {
        context.setTimeout = window.setTimeout = (fn, ms) => { const id = ++next; timeouts.set(id, { fn, ms }); return id; };
        context.clearTimeout = window.clearTimeout = id => timeouts.delete(id);
        context.setInterval = window.setInterval = fn => { const id = ++next; intervals.set(id, fn); return id; };
        context.clearInterval = window.clearInterval = id => intervals.delete(id);
    } });
    h.hooks.startInitLoop();
    for (const tick of intervals.values()) tick();
    assert.equal(intervals.size, 0);
    const deadline = [...timeouts.values()].find(timer => timer.ms === 10000);
    assert.ok(deadline); deadline.fn();
    const failure = h.events().at(-1);
    assert.equal(failure.action, 'handshake'); assert.equal(failure.code, 'PRACTICE_CHANNEL_TIMEOUT');
    h.hooks.stopInitLoop();
});

test('failed readiness delivery never marks the child handshake ready', async () => {
    const h = setup();
    h.parent.postMessage = () => { throw new Error('unavailable parent'); };
    await h.hooks.handleIncoming({ source: h.parent, origin: 'http://localhost', data: {
        source: 'exam_host', type: 'INIT_SESSION', data: { examId: 'reading-p1', sessionId: 'PRIVATE_SESSION',
            parentOrigin: 'http://localhost', windowSessionToken: 'PRIVATE_TOKEN', windowSessionGeneration: 1 }
    } });
    h.hooks.stopReadingDraftSync();
    assert.equal(h.hooks.getTestState().sessionReadySent, false);
    assert.ok(h.events().some(event => event.action === 'handshake' && event.code === 'PRACTICE_CHANNEL_TIMEOUT'));
});

test('reading generator reset preserves the complete maintained entry and its early capture byte for byte', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-entry-preservation-'));
    const name = 'reading-practice-unified.html';
    const original = fs.readFileSync(path.join(root, 'assets/generated/reading-exams', name));
    try {
        fs.writeFileSync(path.join(fixture, name), original);
        fs.writeFileSync(path.join(fixture, 'preserved.js'), 'dataset');
        fs.writeFileSync(path.join(fixture, 'obsolete.js'), 'old');
        resetGeneratedDir(fixture, buildGeneratedPreserveFileNames([{ script: './preserved.js' }]));
        assert.deepEqual(fs.readFileSync(path.join(fixture, name)), original);
        assert.ok(fs.existsSync(path.join(fixture, 'preserved.js')));
        assert.ok(!fs.existsSync(path.join(fixture, 'obsolete.js')));
        const html = original.toString();
        assert.ok(html.indexOf('DIAGNOSTIC_BOOTSTRAP_END') < html.indexOf('<script src='));
        assert.ok(html.indexOf('DIAGNOSTIC_BOOTSTRAP_END') < html.indexOf('<link rel="stylesheet"'));
    } finally {
        assert.ok(path.resolve(fixture).startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(fixture, { recursive: true, force: true });
    }
});

test('build-owned reading paths preserve only shipped filenames and native quota causes survive wire sanitization', () => {
    const build = JSON.parse(read('assets/generated/diagnostics/build-manifest.json'));
    const realm = vm.createContext({ AppDiagnosticBuild: build, DOMException });
    vm.runInContext(read('js/diagnostics/diagnosticContract.js'), realm);
    const normalizer = realm.AppDiagnosticContract.createNormalizer();
    const event = normalizer.normalize({ code: 'RECOVERY_SAVE_FAILED', error: new DOMException('PRIVATE_NOTE', 'QuotaExceededError'),
        resource: { url: 'file:///PRIVATE_PATH/assets/generated/reading-exams/p1-high-01.js?PRIVATE_QUERY' } });
    assert.equal(event.resource.path, 'assets/generated/reading-exams/p1-high-01.js');
    assert.equal(event.causeCode, 'QUOTA_EXCEEDED');
    assert.deepEqual(normalizer.sanitizeEvent(JSON.parse(JSON.stringify(event))), event);
    assert.equal(normalizer.normalize({ resource: { url: 'file:///PRIVATE_PATH/assets/generated/reading-exams/p1-high-999.js' } }).resource.path, 'unknown');
    assert.equal(normalizer.normalize({ resource: { url: 'https://private.invalid/?q=assets/generated/reading-exams/p1-high-01.js' } }).resource.path, 'unknown');
    assert.ok(!JSON.stringify(event).includes('PRIVATE_'));
});
