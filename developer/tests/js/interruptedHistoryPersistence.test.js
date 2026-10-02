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
        currentExamType: 'all',
        activeIndex: [{ id: 'reading-p1', title: 'Reading P1', type: 'reading' }],
        defaultIndex: [{ id: 'reading-p1', title: 'Reading P1', type: 'reading' }],
        configurations: [],
        sourceIndexes: new Map(),
        messages: [], confirmations: [], events: [], warnings: [],
        completedViews: [], interruptedViews: [], trends: [], summaries: [], browse: [],
        calls: {
            list: 0, interruptedList: 0, interruptedGet: [], interruptedSave: [], sourceIndex: [],
            configurationList: 0, defaultIndex: 0, activeIndex: 0,
            draftReads: 0, draftWrites: 0, discard: [], clear: 0, clearInterrupted: 0, clearRecovery: 0
        }
    };
    const listeners = new Map();
    const historyContainer = { addEventListener() {} };
    const interruptedContainer = { addEventListener() {} };
    const quietConsole = {
        log() {}, warn(...args) { state.warnings.push(args); }, error() {}, info() {}, debug() {}
    };
    const appData = {
        ready: Promise.resolve(),
        practice: {
            async list() { state.calls.list += 1; return clone(state.completed); },
            async listInsights() { return clone(state.completed); },
            async get() { throw new Error('Interrupted details must not read formal history'); },
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
            async getInterrupted(id) {
                state.calls.interruptedGet.push(id);
                return clone(state.interrupted.find((record) => record.id === id) || null);
            },
            async saveInterrupted(record) {
                state.calls.interruptedSave.push(clone(record));
                state.interrupted.push(clone(record));
                return { committed: true };
            },
            async getDraft() {
                state.calls.draftReads += 1;
                throw new Error('Interrupted details must not read reading drafts');
            },
            async listDrafts() {
                state.calls.draftReads += 1;
                throw new Error('Interrupted details must not search reading drafts');
            },
            async saveDraft() {
                state.calls.draftWrites += 1;
                throw new Error('Interrupted history must not write reading drafts');
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
        },
        library: {
            async listConfigurations() {
                state.calls.configurationList += 1;
                return clone(state.configurations);
            },
            async getIndex(configurationId) {
                state.calls.sourceIndex.push(configurationId);
                return clone(state.sourceIndexes.get(configurationId) || []);
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
        getCurrentExamType: () => state.currentExamType,
        getBulkDeleteModeState: () => false,
        getSelectedRecordsState: () => new Set(),
        clearSelectedRecordsState() {}, setBulkDeleteModeState() {},
        processedSessions: { clear() {} },
        resolveActiveLibraryIndex: async () => clone(state.activeIndex),
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
            render({ container, records, error, onLoadDetails, onDelete, onRetry }) {
                assert.equal(container, interruptedContainer);
                state.interruptedViews.push({ records: clone(records), error, onLoadDetails, onDelete, onRetry });
            }
        }
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);
    function loadScript(relativePath) {
        vm.runInContext(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'), context, { filename: relativePath });
    }
    loadScript('js/services/libraryManager.js');
    const libraryManager = sandbox.LibraryManager.getInstance();
    // Keep the real provenance and record-source policy. Only the physical
    // default/active index reads are replaced with deterministic fixtures.
    libraryManager.resolveDefaultIndex = async () => {
        state.calls.defaultIndex += 1;
        return clone(state.defaultIndex);
    };
    libraryManager.resolveActiveIndex = async () => {
        state.calls.activeIndex += 1;
        return clone(state.activeIndex);
    };
    loadScript('js/main.js');
    sandbox.showMessage = (message, type) => state.messages.push({ message, type });
    sandbox.refreshBrowseProgressFromRecords = (records) => {
        state.browse.push(clone(records));
        return false;
    };
    return { sandbox, state, appData, loadScript, libraryManager };
}

async function visibleInterruptedIds(harness, examType) {
    harness.state.currentExamType = examType;
    await harness.sandbox.syncPracticeRecords({ forceRender: true });
    return ids(harness.state.interruptedViews.at(-1).records);
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

test('detail callbacks read the exact interrupted ID afresh without using the rendered snapshot or drafts', async () => {
    const { sandbox, state } = createHarness();
    state.interrupted.push(interruptedRecord('first'), interruptedRecord('second'));
    await sandbox.syncPracticeRecords();
    const view = state.interruptedViews.at(-1);
    assert.equal(typeof view.onLoadDetails, 'function');
    assert.deepEqual(state.calls.interruptedGet, [], 'Rendering the history list must not eagerly load details');

    state.interrupted[1].answers.q1 = 'Answer updated after list render';
    state.interrupted[1].noteText = 'Latest saved note';
    const details = await view.onLoadDetails('second');
    assert.equal(details.id, 'second');
    assert.equal(details.answers.q1, 'Answer updated after list render');
    assert.equal(details.noteText, 'Latest saved note');
    assert.equal(view.records[1].answers.q1, 'Unscored answer', 'The rendered list snapshot is deliberately stale');

    state.interrupted[1].answers.q1 = 'Answer updated again';
    assert.equal((await view.onLoadDetails('second')).answers.q1, 'Answer updated again');
    state.interrupted = state.interrupted.filter((record) => record.id !== 'second');
    state.drafts.push({ id: 'second', answers: { q1: 'Unrelated draft with the same ID' } });
    assert.equal(await view.onLoadDetails('second'), null, 'A removed interruption must not fall back to a draft or stale snapshot');
    assert.deepEqual(state.calls.interruptedGet, ['second', 'second', 'second']);
    assert.equal(state.calls.draftReads, 0);
    assert.equal(state.calls.draftWrites, 0);
    assert.deepEqual(state.calls.interruptedSave, []);
});

test('detail lookup failures propagate to the renderer without hiding the list or reading another recovery scope', async () => {
    const { sandbox, state, appData } = createHarness();
    state.interrupted.push(interruptedRecord());
    await sandbox.syncPracticeRecords();
    const view = state.interruptedViews.at(-1);
    appData.recovery.getInterrupted = async (id) => {
        state.calls.interruptedGet.push(id);
        throw new Error('Interrupted detail lookup failed');
    };

    await assert.rejects(view.onLoadDetails('interrupted-1'), /Interrupted detail lookup failed/);
    assert.deepEqual(state.calls.interruptedGet, ['interrupted-1']);
    assert.deepEqual(ids(view.records), ['interrupted-1']);
    assert.equal(view.error, null);
    assert.deepEqual(ids(state.completedViews.at(-1)), ['completed-1']);
    assert.equal(state.calls.draftReads, 0);
    assert.equal(state.calls.draftWrites, 0);
    assert.deepEqual(state.calls.interruptedSave, []);
});

test('saved types and legacy pageType metadata keep interrupted records in the correct filter after their source exam disappears', async () => {
    const sources = [
        ['type', (type) => ({ type })],
        ['examType', (type) => ({ examType: type })],
        ['practiceType', (type) => ({ practiceType: type })],
        ['metadata.type', (type) => ({ metadata: { type } })],
        ['metadata.examType', (type) => ({ metadata: { examType: type } })],
        ['metadata.practiceType', (type) => ({ metadata: { practiceType: type } })],
        ['pageType', (type) => ({ pageType: `${type}_practice` })],
        ['metadata.pageType', (type) => ({ metadata: { pageType: `${type}_practice` } })]
    ];
    const harness = createHarness();
    harness.state.activeIndex = [];
    for (const [field, properties] of sources) {
        for (const type of ['reading', 'listening']) {
            harness.state.interrupted.push({
                ...interruptedRecord(`${field}-${type}`),
                ...properties(type),
                examId: `removed-source-${field}-${type}`,
                libraryConfigurationId: 'removed-library'
            });
        }
    }

    assert.deepEqual(await visibleInterruptedIds(harness, 'all'), ids(harness.state.interrupted));
    for (const type of ['reading', 'listening']) {
        assert.deepEqual(await visibleInterruptedIds(harness, type), sources.map(([field]) => `${field}-${type}`));
    }
    assert.deepEqual(harness.state.calls.sourceIndex, [], 'Saved type metadata is sufficient without a source library lookup');
});

test('legacy interruptions resolve their inactive saved library once per refresh without persisting enrichment or renewing TTL', async () => {
    const harness = createHarness();
    const { state } = harness;
    state.activeIndex = [{ id: 'shared-exam', type: 'reading' }];
    state.sourceIndexes.set('inactive-library', [{ id: 'shared-exam', type: 'listening' }]);
    const timestamps = {
        createdAt: '2026-09-06T10:02:00.000Z', updatedAt: '2026-09-06T10:03:00.000Z',
        expiresAt: '2026-10-06T10:03:00.000Z'
    };
    state.interrupted.push(
        { ...interruptedRecord('top-level-source'), ...timestamps, examId: 'shared-exam', libraryConfigurationId: 'inactive-library' },
        { ...interruptedRecord('metadata-source'), ...timestamps, examId: 'shared-exam', metadata: { libraryConfigurationId: 'inactive-library' } }
    );
    const savedRecords = clone(state.interrupted);

    assert.deepEqual(await visibleInterruptedIds(harness, 'listening'), ['top-level-source', 'metadata-source']);
    assert.deepEqual(state.calls.sourceIndex, ['inactive-library'], 'One source library read serves multiple interrupted records');
    assert(state.interruptedViews.at(-1).records.every((record) => record.type === 'listening'));
    assert.deepEqual(await visibleInterruptedIds(harness, 'reading'), [], 'The active library cannot override saved source provenance');
    assert.deepEqual(state.calls.sourceIndex, ['inactive-library', 'inactive-library'], 'A later refresh must reread the saved source');
    assert.deepEqual(state.interrupted, savedRecords, 'Display enrichment must preserve stored contents and retention timestamps');
    assert.deepEqual(state.calls.interruptedSave, []);
    assert.deepEqual(state.calls.discard, []);
    assert.equal(state.calls.clearInterrupted, 0);
    assert.equal(state.calls.draftWrites, 0);
});

test('removed source libraries cannot reclassify interruptions through a conflicting active library', async () => {
    const harness = createHarness();
    harness.state.activeIndex = [{ id: 'shared-exam', type: 'reading' }];
    harness.state.interrupted.push({
        ...interruptedRecord('removed-library-record'),
        examId: 'shared-exam', libraryConfigurationId: 'removed-library'
    });

    assert.deepEqual(await visibleInterruptedIds(harness, 'all'), ['removed-library-record']);
    assert.deepEqual(await visibleInterruptedIds(harness, 'reading'), []);
    assert.deepEqual(await visibleInterruptedIds(harness, 'listening'), []);
    assert.equal(harness.state.interruptedViews.at(-1).error, null);
});

test('legacy records without custom libraries safely resolve the default index while unresolved interruptions remain only in All', async () => {
    const harness = createHarness();
    harness.state.defaultIndex = [{ id: 'known-default-exam', type: 'listening' }];
    harness.state.activeIndex = clone(harness.state.defaultIndex);
    harness.state.interrupted.push(
        { ...interruptedRecord('default-index-match'), examId: 'known-default-exam' },
        { ...interruptedRecord('unresolved-record'), examId: 'removed-exam' }
    );

    assert.deepEqual(await visibleInterruptedIds(harness, 'all'), ['default-index-match', 'unresolved-record']);
    assert.deepEqual(await visibleInterruptedIds(harness, 'reading'), []);
    assert.deepEqual(await visibleInterruptedIds(harness, 'listening'), ['default-index-match']);
    assert.deepEqual(harness.state.calls.sourceIndex, []);
    assert.equal(harness.state.calls.configurationList, 3, 'Shared unknown-source policy checks custom configurations once per refresh');
    assert.deepEqual(ids(harness.state.completedViews.at(-1)), ['completed-1'], 'Formal history retains its existing unknown-type filtering policy');
});

test('explicit default provenance and metadata precedence ignore conflicting active custom exam IDs', async () => {
    const harness = createHarness();
    const { state } = harness;
    state.defaultIndex = [{ id: 'shared-exam', type: 'reading' }];
    state.activeIndex = [{ id: 'shared-exam', type: 'listening' }];
    state.configurations = [{ id: 'active-library' }, { id: 'saved-library' }];
    state.sourceIndexes.set('active-library', clone(state.activeIndex));
    state.sourceIndexes.set('saved-library', [{ id: 'shared-exam', type: 'reading' }]);
    state.interrupted.push(
        { ...interruptedRecord('default-source'), examId: 'shared-exam', libraryConfigurationId: null },
        {
            ...interruptedRecord('metadata-default'), examId: 'shared-exam',
            libraryConfigurationId: 'active-library', metadata: { libraryConfigurationId: null }
        },
        {
            ...interruptedRecord('metadata-custom'), examId: 'shared-exam',
            libraryConfigurationId: 'active-library', metadata: { libraryConfigurationId: 'saved-library' }
        },
        {
            ...interruptedRecord('metadata-active'), examId: 'shared-exam',
            libraryConfigurationId: 'saved-library', metadata: { libraryConfigurationId: 'active-library' }
        }
    );

    assert.deepEqual(await visibleInterruptedIds(harness, 'reading'), ['default-source', 'metadata-default', 'metadata-custom']);
    assert.equal(state.calls.defaultIndex, 1, 'Equivalent explicit default provenance shares a single source read');
    assert.deepEqual(state.calls.sourceIndex, ['saved-library', 'active-library']);
    assert.deepEqual(await visibleInterruptedIds(harness, 'listening'), ['metadata-active']);
    assert.equal(state.calls.configurationList, 0, 'Explicit provenance does not require unknown-source fallback');
});

test('unknown provenance with custom libraries remains in All even when active and default IDs match', async () => {
    const harness = createHarness();
    const { state } = harness;
    state.activeIndex = [{ id: 'shared-exam', type: 'reading' }];
    state.defaultIndex = [{ id: 'shared-exam', type: 'listening' }];
    state.configurations = [{ id: 'custom-library' }];
    state.interrupted.push({ ...interruptedRecord('unknown-source'), examId: 'shared-exam' });

    assert.deepEqual(await visibleInterruptedIds(harness, 'all'), ['unknown-source']);
    assert.deepEqual(await visibleInterruptedIds(harness, 'reading'), []);
    assert.deepEqual(await visibleInterruptedIds(harness, 'listening'), []);
    assert.deepEqual(state.calls.sourceIndex, []);
    assert.equal(state.calls.defaultIndex, 0);
    assert.equal(state.calls.activeIndex, 3, 'Only each canonical history sync may read the active index; source resolution must not');
});

test('an unavailable library manager leaves untyped records in All and keeps canonical history usable', async () => {
    const harness = createHarness();
    const { sandbox, state } = harness;
    state.interrupted.push(interruptedRecord('manager-unavailable'));
    sandbox.LibraryManager = undefined;

    assert.deepEqual(await visibleInterruptedIds(harness, 'all'), ['manager-unavailable']);
    assert.deepEqual(await visibleInterruptedIds(harness, 'reading'), []);
    assert.deepEqual(await visibleInterruptedIds(harness, 'listening'), []);
    assert.equal(state.interruptedViews.at(-1).error, null);
    assert.deepEqual(ids(state.browse.at(-1)), ['completed-1']);
});

test('a saved-source lookup failure warns but preserves interrupted and canonical history', async () => {
    const harness = createHarness();
    const { state, appData } = harness;
    state.activeIndex = [{ id: 'shared-exam', type: 'reading' }];
    state.interrupted.push({
        ...interruptedRecord('unavailable-source'),
        examId: 'shared-exam', metadata: { libraryConfigurationId: 'unavailable-library' }
    });
    appData.library.getIndex = async (configurationId) => {
        state.calls.sourceIndex.push(configurationId);
        throw new Error('Saved source index unavailable');
    };

    assert.deepEqual(await visibleInterruptedIds(harness, 'all'), ['unavailable-source']);
    assert.equal(state.interruptedViews.at(-1).error, null, 'A source metadata failure is not a recovery-history read failure');
    assert.deepEqual(ids(state.completedViews.at(-1)), ['completed-1']);
    assert.deepEqual(ids(state.browse.at(-1)), ['completed-1']);
    assert(state.warnings.some((warning) => warning.some((entry) => entry?.message === 'Saved source index unavailable')));
    assert.deepEqual(await visibleInterruptedIds(harness, 'reading'), []);
    assert.deepEqual(await visibleInterruptedIds(harness, 'listening'), []);
    assert.deepEqual(state.calls.interruptedSave, []);
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
