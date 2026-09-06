#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const clone = (value) => structuredClone(value);
const ids = (records) => Array.from(records, (record) => record.id);

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function interruptedRecord(id = 'interrupted-1') {
    return {
        id, examId: 'reading-p1', sessionId: `session-${id}`,
        status: 'interrupted', reason: 'window_closed', duration: 120,
        startTime: '2026-09-06T10:00:00.000Z', endTime: '2026-09-06T10:02:00.000Z',
        answers: { q1: 'Unscored answer' }, metadata: { examTitle: 'Reading P1' }
    };
}

function createHarness() {
    const state = {
        completed: [{
            id: 'completed-1', examId: 'reading-p1', title: 'Reading P1',
            date: '2026-09-06T09:00:00.000Z', percentage: 80, duration: 600
        }],
        interrupted: [],
        drafts: [{ id: 'reading-draft-1', answers: { q1: 'Draft answer' } }],
        activeSessions: [{ id: 'active-session:other-session' }],
        messages: [], confirmations: [], events: [],
        completedViews: [], interruptedViews: [], trends: [], summaries: [], browse: [],
        calls: { list: 0, interruptedList: 0, discard: [], clear: 0, clearInterrupted: 0, clearRecovery: 0 }
    };
    const listeners = new Map();
    const historyContainer = { addEventListener() {} };
    const interruptedContainer = { addEventListener() {} };
    const quietConsole = { log() {}, warn() {}, error() {}, info() {}, debug() {} };
    const appData = {
        ready: Promise.resolve(),
        practice: {
            async list() { state.calls.list += 1; return clone(state.completed); },
            async listInsights() { return clone(state.completed); },
            async delete() { throw new Error('Interrupted deletion must not write formal history'); },
            async clear() {
                state.calls.clear += 1;
                state.completed.length = 0;
                return { committed: true };
            }
        },
        recovery: {
            async listInterrupted() {
                state.calls.interruptedList += 1;
                return clone(state.interrupted);
            },
            async saveInterrupted(record) {
                state.interrupted.push(clone(record));
                return { committed: true };
            },
            async discardInterrupted(id) {
                state.calls.discard.push(id);
                state.interrupted = state.interrupted.filter((record) => record.id !== id);
                return { committed: true };
            },
            async clearInterrupted() {
                state.calls.clearInterrupted += 1;
                state.interrupted.length = 0;
                return { committed: true };
            },
            async discardActiveSession(id) {
                state.activeSessions = state.activeSessions.filter((record) => record.id !== id);
                return { committed: true };
            },
            async clear() {
                state.calls.clearRecovery += 1;
                throw new Error('History actions must preserve drafts and unrelated recovery');
            }
        }
    };
    const sandbox = {
        console: quietConsole, setTimeout, clearTimeout, setInterval, clearInterval,
        Date, Math, JSON, AppData: appData,
        location: { origin: 'http://localhost', protocol: 'http:' },
        navigator: { userAgent: 'Interrupted history integration test' },
        screen: { width: 1280, height: 720 },
        addEventListener() {},
        confirm(message) { state.confirmations.push(message); return true; },
        getCurrentExamType: () => 'all',
        getBulkDeleteModeState: () => false,
        getSelectedRecordsState: () => new Set(),
        clearSelectedRecordsState() {}, setBulkDeleteModeState() {},
        processedSessions: { clear() {} },
        resolveActiveLibraryIndex: async () => [{ id: 'reading-p1', title: 'Reading P1', type: 'reading' }],
        CustomEvent: class {
            constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
        },
        document: {
            addEventListener(type, handler) {
                if (!listeners.has(type)) listeners.set(type, []);
                listeners.get(type).push(handler);
            },
            dispatchEvent(event) {
                state.events.push({ type: event.type, detail: clone(event.detail) });
                for (const handler of listeners.get(event.type) || []) handler(event);
            },
            getElementById(id) {
                if (id === 'practice-history-list') return historyContainer;
                if (id === 'interrupted-practice-history') return interruptedContainer;
                return null;
            },
            querySelector: () => null, querySelectorAll: () => []
        },
        PracticeDashboardView: class {
            updateSummary(summary) { state.summaries.push(clone(summary)); }
        },
        PracticeTrendRenderer: class {
            update(records) { state.trends.push(clone(records)); }
        },
        PracticeHistoryRenderer: {
            helpers: { computeRecordsSignature: (records) => JSON.stringify(records) },
            renderView({ records }) { state.completedViews.push(clone(records)); }
        },
        InterruptedPracticeHistory: {
            render({ container, records, error, onDelete, onRetry }) {
                assert.equal(container, interruptedContainer);
                state.interruptedViews.push({ records: clone(records), error, onDelete, onRetry });
            }
        }
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);
    function loadScript(relativePath) {
        vm.runInContext(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'), context, { filename: relativePath });
    }
    loadScript('js/main.js');
    sandbox.showMessage = (message, type) => state.messages.push({ message, type });
    sandbox.refreshBrowseProgressFromRecords = (records) => {
        state.browse.push(clone(records));
        return false;
    };
    return { sandbox, state, appData, loadScript };
}

test('recovery-only changes refresh independently without reaching formal history, trends, summary, Browse or return values', async () => {
    const { sandbox, state } = createHarness();
    assert.deepEqual(ids(await sandbox.syncPracticeRecords()), ['completed-1']);
    state.interrupted.push(interruptedRecord());
    assert.deepEqual(ids(await sandbox.syncPracticeRecords()), ['completed-1']);

    assert.equal(state.completedViews.length, 1, 'The unchanged canonical signature must remain effective');
    assert.deepEqual(ids(state.completedViews[0]), ['completed-1']);
    assert.deepEqual(ids(state.trends[0]), ['completed-1']);
    assert.equal(state.summaries[0].totalPracticed, 1);
    assert.deepEqual(state.browse.map(ids), [['completed-1'], ['completed-1']]);
    assert.deepEqual(state.interruptedViews.map((view) => ids(view.records)), [[], ['interrupted-1']]);

    state.interrupted.length = 0;
    await sandbox.syncPracticeRecords();
    assert.deepEqual(state.interruptedViews.at(-1).records, [], 'Removal must refresh even with the same formal signature');
});

test('a recovery read failure remains visible and retryable while canonical history stays usable', async () => {
    const { sandbox, state, appData } = createHarness();
    const originalList = appData.recovery.listInterrupted;
    appData.recovery.listInterrupted = async () => { throw new Error('Recovery backend unavailable'); };

    assert.deepEqual(ids(await sandbox.syncPracticeRecords()), ['completed-1']);
    assert.deepEqual(ids(state.completedViews.at(-1)), ['completed-1']);
    assert.deepEqual(ids(state.browse.at(-1)), ['completed-1']);
    const failedView = state.interruptedViews.at(-1);
    assert.match(failedView.error.message, /Recovery backend unavailable/);
    assert.equal(typeof failedView.onRetry, 'function');

    appData.recovery.listInterrupted = originalList;
    state.interrupted.push(interruptedRecord());
    await failedView.onRetry();
    assert.equal(state.interruptedViews.at(-1).error, null);
    assert.deepEqual(ids(state.interruptedViews.at(-1).records), ['interrupted-1']);
});

test('an older recovery read cannot replace a newer accepted recovery view', async () => {
    const { sandbox, state, appData } = createHarness();
    const oldRead = deferred();
    appData.recovery.listInterrupted = () => oldRead.promise;
    const oldSync = sandbox.syncPracticeRecords();
    appData.recovery.listInterrupted = async () => [interruptedRecord('newer')];
    await sandbox.syncPracticeRecords();
    oldRead.resolve([interruptedRecord('stale')]);
    await oldSync;
    assert.deepEqual(ids(state.interruptedViews.at(-1).records), ['newer']);
    assert.equal(state.interruptedViews.length, 1, 'The late stale read must not repaint recovery');
});

test('the interrupted renderer deletes only recovery records and refreshes authoritative state', async () => {
    const { sandbox, state } = createHarness();
    state.interrupted.push(interruptedRecord());
    await sandbox.syncPracticeRecords();
    assert.equal(await state.interruptedViews.at(-1).onDelete('interrupted-1'), true);
    assert.deepEqual(state.calls.discard, ['interrupted-1']);
    assert.deepEqual(ids(state.completed), ['completed-1']);
    assert.deepEqual(state.interruptedViews.at(-1).records, []);
    assert.equal(state.messages.at(-1).type, 'success');
    assert.equal(state.calls.clearRecovery, 0);
});

test('rejected or uncommitted interrupted deletions retain records and never announce success', async () => {
    for (const failure of ['reject', 'uncommitted']) {
        const { sandbox, state, appData } = createHarness();
        state.interrupted.push(interruptedRecord());
        appData.recovery.discardInterrupted = async () => {
            if (failure === 'reject') throw new Error('Delete rejected');
            return { committed: false };
        };
        assert.equal(await sandbox.deleteInterruptedRecord('interrupted-1'), false);
        assert.deepEqual(ids(state.interruptedViews.at(-1).records), ['interrupted-1']);
        assert.deepEqual(ids(state.completed), ['completed-1']);
        assert.equal(state.messages.at(-1).type, 'error');
        assert.equal(state.messages.some((message) => message.type === 'success'), false);
    }
});

test('clear-all clears formal and interrupted history while preserving drafts and active checkpoints', async () => {
    const { sandbox, state } = createHarness();
    state.interrupted.push(interruptedRecord());
    const preserved = clone({ drafts: state.drafts, activeSessions: state.activeSessions });
    assert.equal(await sandbox.clearPracticeData(), true);
    assert.equal(state.calls.clear, 1);
    assert.equal(state.calls.clearInterrupted, 1);
    assert.equal(state.calls.clearRecovery, 0);
    assert.deepEqual(state.completedViews.at(-1), []);
    assert.deepEqual(state.interruptedViews.at(-1).records, []);
    assert.deepEqual({ drafts: state.drafts, activeSessions: state.activeSessions }, preserved);
    assert.equal(state.messages.at(-1).type, 'success');
});

test('clear-all reports either partial failure and renders the committed scope correctly', async () => {
    for (const failedScope of ['canonical', 'interrupted']) {
        const { sandbox, state, appData } = createHarness();
        state.interrupted.push(interruptedRecord());
        if (failedScope === 'canonical') {
            appData.practice.clear = async () => { state.calls.clear += 1; throw new Error('Formal clear failed'); };
        } else {
            appData.recovery.clearInterrupted = async () => {
                state.calls.clearInterrupted += 1;
                return { committed: false };
            };
        }
        assert.equal(await sandbox.clearPracticeData(), false);
        assert.equal(state.calls.clear, 1);
        assert.equal(state.calls.clearInterrupted, 1);
        assert.equal(state.calls.clearRecovery, 0);
        assert.deepEqual(ids(state.completedViews.at(-1)), failedScope === 'canonical' ? ['completed-1'] : []);
        assert.deepEqual(ids(state.interruptedViews.at(-1).records), failedScope === 'interrupted' ? ['interrupted-1'] : []);
        assert.equal(state.messages.at(-1).type, 'error');
        assert.equal(state.messages.some((message) => message.type === 'success'), false);
        assert.equal(state.drafts.length, 1);
    }
});

test('committed deletion with a failed recovery read reports the refresh problem', async () => {
    const { sandbox, state, appData } = createHarness();
    state.interrupted.push(interruptedRecord());
    appData.recovery.listInterrupted = async () => { throw new Error('Read after delete failed'); };
    assert.equal(await sandbox.deleteInterruptedRecord('interrupted-1'), false);
    assert.deepEqual(state.interrupted, []);
    assert.match(state.interruptedViews.at(-1).error.message, /Read after delete failed/);
    assert.equal(state.messages.at(-1).type, 'warning');
});

test('actual recorder interruption queues a fresh read behind an already pending history sync', async () => {
    const { sandbox, state, appData, loadScript } = createHarness();
    loadScript('js/core/practiceCore.js');
    loadScript('js/core/practiceRecorder.js');
    const recorder = Object.create(sandbox.PracticeRecorder.prototype);
    recorder.activeSessions = new Map();
    recorder.sessionListeners = new Map();
    recorder.sessionStartGenerations = new WeakMap();
    recorder.activeSessions.set('reading-p1', {
        sessionId: 'pending-interruption', examId: 'reading-p1', status: 'active',
        startTime: new Date(Date.now() - 120000).toISOString(),
        progress: { answeredQuestions: 1, totalQuestions: 10 }, answers: { q1: 'A' }, metadata: {}
    });
    const firstCanonicalRead = deferred();
    appData.practice.list = async () => {
        state.calls.list += 1;
        return state.calls.list === 1 ? firstCanonicalRead.promise : clone(state.completed);
    };
    const pendingSync = sandbox.ensurePracticeRecordsSync('pending-history');
    assert.equal(state.calls.list, 1);
    assert.equal(await recorder.endPracticeSession('reading-p1', 'window_closed'), true);
    assert.equal(state.calls.list, 1, 'The interruption must join the active sync before its tail');
    assert(state.events.some((event) => event.type === 'practiceSessionEnded'
        && event.detail.reason === 'window_closed' && event.detail.interruptedRecordSaved === true));

    firstCanonicalRead.resolve(clone(state.completed));
    assert.deepEqual(ids(await pendingSync), ['completed-1']);
    assert.equal(state.calls.list, 2, 'An interruption committed after the first read requires a second authoritative read');
    assert.deepEqual(state.interruptedViews.map((view) => ids(view.records)), [[], ['interrupted_pending-interruption']]);
    assert.equal(state.completedViews.length, 2, 'The committed interruption forces the coalesced tail to render');
    assert.deepEqual(ids(state.trends.at(-1)), ['completed-1']);
});

test('completion and unsuccessful interruption events do not trigger interruption refreshes', async () => {
    const { sandbox, state } = createHarness();
    for (const detail of [
        { reason: 'completed', interruptedRecordSaved: true },
        { reason: 'window_closed', interruptedRecordSaved: false },
        { reason: 'window_closed' },
        undefined
    ]) {
        sandbox.document.dispatchEvent(new sandbox.CustomEvent('practiceSessionEnded', { detail }));
    }
    await Promise.resolve();
    assert.equal(state.calls.list, 0);
    assert.equal(state.interruptedViews.length, 0);
});
