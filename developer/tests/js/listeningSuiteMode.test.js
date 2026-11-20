import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const source = fs.readFileSync(new URL('../../../js/app/suitePracticeMixin.js', import.meta.url), 'utf8');
const stateSource = fs.readFileSync(new URL('../../../js/app/state-service.js', import.meta.url), 'utf8');
const clone = (value) => JSON.parse(JSON.stringify(value));
const bank = (type, count) => Array.from({ length: count }, (_, i) => ({
    id: `${type}-p${i + 1}`, type, category: `P${i + 1}`, title: `${type} ${i + 1}`, hasHtml: true, frequency: 'high',
    filename: `part-${i + 1}.html`
}));

function harness() {
    const stored = new Map();
    const records = [];
    const messages = [];
    const window = {
        location: { href: 'http://localhost/', protocol: 'http:' },
        showMessage: (text) => messages.push(text), addEventListener() {}, removeEventListener() {},
        resolveActiveLibraryIndex: async () => [...bank('reading', 3), ...bank('listening', 4)],
        PracticeTimerPreferences: { ready: Promise.resolve(), read: () => ({ mode: 'elapsed', countdownMinutes: 40, limitEnabled: true, limitMinutes: 35, expiryAction: 'lock' }) },
        AppData: { ready: Promise.resolve(), recovery: {
            windowSession: { save: (key, value) => stored.set(key, clone(value)), get: (key) => stored.get(key), discard: (key) => stored.delete(key) },
            listActiveSessions: async () => [], saveActiveSession: async () => ({ committed: true }), discardActiveSession: async () => ({ committed: true })
        }, practice: { list: async () => records, getStats: async () => ({}), finalizeSuite: async ({ record }) => {
            const index = records.findIndex((item) => item.id === record.id);
            if (index >= 0) records[index] = clone(record); else records.push(clone(record));
            return { committed: true, record };
        } } }
    };
    const context = vm.createContext({ window, console, URL, setTimeout, clearTimeout, setInterval, clearInterval, Map, Set });
    vm.runInContext(source, context);
    vm.runInContext(stateSource, context);
    const app = Object.assign({ components: {}, examWindows: new Map() }, window.ExamSystemAppMixins.suitePractice);
    Object.assign(app, {
        _clearSuiteHandshakes() {}, _ensureSuiteWindowGuard() {}, _focusSuiteWindow() {},
        _releaseSuiteCloseGuardAfterCommit() {}, _sendSimulationContext() {},
        _updatePracticeRecordsState: async () => {},
        openExam: async () => ({ closed: false, focus() {}, close() {}, document: {} })
    });
    return { app, window, stored, records, messages };
}

test('listening selects exactly P1-P4, while reading still selects P1-P3', async () => {
    for (const type of ['listening', 'reading']) {
        const { app } = harness();
        let chosen;
        app._launchSuiteSessionFromSequence = async (sequence) => { chosen = sequence; return true; };
        assert.equal(await app.startSuitePractice({ type, flowMode: 'stationary' }), true);
        assert.equal(chosen.length, type === 'listening' ? 4 : 3);
        assert.ok(chosen.every((entry, index) => entry.exam.type === type && entry.exam.category === `P${index + 1}`));
    }
});

test('frequency gaps prevent an incomplete listening suite from opening', async () => {
    const { app, window, messages } = harness();
    window.resolveActiveLibraryIndex = async () => bank('listening', 4).map((exam, index) => ({ ...exam, frequency: index === 3 ? 'low' : 'high' }));
    let opened = false;
    app.openExam = async () => { opened = true; };
    assert.equal(Boolean(await app.startSuitePractice({ type: 'listening', frequencyScope: 'high' })), false);
    assert.equal(opened, false);
    assert.ok(messages.some((message) => message.includes('P4') && message.includes('听力')));
});

test('custom listening selection keeps its type and requires all four parts', async () => {
    const { app, window } = harness();
    const visits = [];
    window.browseCategory = (...args) => visits.push(args);
    await app.startSuitePractice({ type: 'listening', frequencyScope: 'custom' });
    const service = window.appStateService;
    assert.equal(service.getCustomSuiteDraft().type, 'listening');
    assert.deepEqual(clone(service.getCustomSuiteDraft().categories), ['P1', 'P2', 'P3', 'P4']);
    service.selectCustomSuiteExam(bank('reading', 1)[0]);
    assert.equal(service.getCustomSuiteDraft().stageIndex, 0, 'reading cannot enter a listening suite');
    bank('listening', 3).forEach((exam) => service.selectCustomSuiteExam(exam));
    assert.equal(service.getCustomSuiteDraft().status, 'selecting');
    assert.equal(await app.confirmCustomSuiteSelection(), false);
    service.selectCustomSuiteExam(bank('listening', 4)[3]);
    let chosen;
    app._launchSuiteSessionFromSequence = async (sequence) => { chosen = sequence; return true; };
    assert.equal(await app.confirmCustomSuiteSelection(), true);
    assert.equal(chosen.length, 4);
    assert.deepEqual(visits[0], ['P1', 'listening']);
});

test('listening suites require a playable HTML entry in every part', async () => {
    for (const invalid of [
        { hasHtml: false, filename: '', pdfFilename: 'part-4.pdf' },
        { hasHtml: false, filename: 'part-4.html' },
        { hasHtml: true, filename: '' },
        { hasHtml: true, filename: 'part-4.pdf' }
    ]) {
        for (const frequencyScope of ['all', 'custom']) {
            const { app, window, messages } = harness();
            window.resolveActiveLibraryIndex = async () => bank('listening', 4)
                .map((exam, index) => index === 3 ? { ...exam, ...invalid } : exam);
            let opened = false;
            app.openExam = async () => { opened = true; };
            assert.equal(Boolean(await app.startSuitePractice({ type: 'listening', frequencyScope })), false);
            assert.equal(opened, false);
            assert.equal(window.appStateService.getCustomSuiteDraft(), null);
            assert.ok(messages.some((message) => message.includes('P4')));
        }
    }
});

test('random listening selection excludes PDF-only alternatives', async () => {
    const { app, window } = harness();
    window.resolveActiveLibraryIndex = async () => bank('listening', 4).flatMap((exam) => [
        { ...exam, id: exam.id + '-pdf', hasHtml: false, filename: '', pdfFilename: 'questions.pdf' }, exam
    ]);
    let chosen;
    app._launchSuiteSessionFromSequence = async (sequence) => { chosen = sequence; return true; };
    assert.equal(await app.startSuitePractice({ type: 'listening' }), true);
    assert.equal(chosen.length, 4);
    assert.ok(chosen.every(({ exam }) => exam.hasHtml && exam.filename.endsWith('.html')));
});

test('custom selection and launch reject PDF-only and stale listening selections', async () => {
    const { app, window } = harness();
    const items = bank('listening', 4);
    window.resolveActiveLibraryIndex = async () => items;
    await app.startSuitePractice({ type: 'listening', frequencyScope: 'custom' });
    const service = window.appStateService;
    service.selectCustomSuiteExam({ ...items[0], hasHtml: false, filename: '', pdfFilename: 'questions.pdf' });
    service.selectCustomSuiteExam({ ...items[0], filename: '' });
    assert.equal(service.getCustomSuiteDraft().stageIndex, 0);
    items.forEach((exam) => service.selectCustomSuiteExam(exam));
    assert.equal(service.getCustomSuiteDraft().status, 'ready');
    Object.assign(items[3], { hasHtml: false, filename: '', pdfFilename: 'part-4.pdf' });
    let opened = false;
    app.openExam = async () => { opened = true; };
    assert.equal(await app.confirmCustomSuiteSelection(), false, 'confirmation rechecks the current index');
    assert.equal(await app._launchSuiteSessionFromSequence(items.map((exam) => ({ examId: exam.id, exam })), { type: 'listening' }), false);
    assert.equal(opened, false);
});

test('listening recovery retains timer preferences, drafts and listening record identity', async () => {
    const { app, stored, records } = harness();
    assert.equal(await app.startSuitePractice({ type: 'listening', flowMode: 'simulation' }), true);
    const session = app.currentSuiteSession;
    assert.equal(session.suiteTimerMode, 'elapsed');
    assert.equal(session.suiteTimerLimitSeconds, 35 * 60);
    const draft = { answers: { 1: 'word' }, listeningState: { audio: [{ time: 25, rate: 1 }], controls: [] }, updatedAt: Date.now() };
    app._persistSuiteDraftSnapshot(session, session.sequence[0].examId, { draft });
    app._mirrorSessionToStorage(session);
    const restored = app._restoreSessionFromStorage(stored.get('simulation'));
    assert.equal(restored.type, 'listening');
    assert.equal(restored.suiteTimerPreferences.expiryAction, 'lock');
    assert.equal(restored.draftsByExam[session.sequence[0].examId].listeningState.audio[0].time, 25);
    const entries = session.sequence.map(({ examId }, index) => ({
        examId, answers: { 1: `answer${index}` }, correctAnswers: { 1: `answer${index}` },
        answerComparison: { 1: { userAnswer: `answer${index}`, correctAnswer: `answer${index}`, isCorrect: true } },
        scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }, duration: 2,
        spellingErrors: index === 0 ? [{ word: 'word', userInput: 'wrod' }] : []
    }));
    const outcome = await app._handleInlineSimulationSuiteSubmit(session.sequence[0].examId, {
        suiteSessionId: session.id, suiteSubmission: true, submissionId: 'listening-submit', suiteEntries: entries
    }, { closed: false });
    assert.equal(outcome.committed, true);
    assert.equal(records.length, 1);
    assert.equal(records[0].type, 'listening');
    assert.equal(records[0].suiteEntries.length, 4);
    assert.equal(records[0].spellingErrors[0].word, 'word');
    assert.equal(app._isValidSuiteFinalizeRecord(session, records[0]), true);
    assert.equal(app._isValidSuiteFinalizeRecord(session, { ...records[0], type: 'reading' }), false);
    const replay = await app._handleInlineSimulationSuiteSubmit(entries[0].examId, { suiteSessionId: session.id, submissionId: 'listening-submit' }, { closed: false });
    assert.equal(replay.committed, true);
    assert.equal(records.length, 1, 'a repeated submission cannot create child records');
});
