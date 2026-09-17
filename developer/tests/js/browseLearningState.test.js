import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const source = (file) => fs.readFileSync(new URL(`../../../js/${file}`, import.meta.url), 'utf8');
function harness(extra = {}) {
    const window = { ...extra };
    const context = vm.createContext({ window, console, document: { getElementById: () => null } });
    vm.runInContext(source('data/practiceRecordSource.js'), context);
    vm.runInContext(source('services/browseLearningState.js'), context);
    return { window, context, state: window.BrowseLearningState };
}
const exam = (id = 'p1', library = null) => ({ id, type: 'reading', libraryConfigurationId: library });
const record = (id = 'old', overrides = {}) => ({
    id, examId: 'p1', type: 'reading', metadata: { libraryConfigurationId: null },
    completedAt: '2026-09-01T10:00:00Z', correctAnswers: 5, totalQuestions: 10, ...overrides
});

test('latest valid graded retake clears red status; fractional scores use the exact 60% boundary', () => {
    const { state } = harness();
    const key = state.identity(exam(), true);
    assert.equal(state.buildIndex([record()]).get(key).wrong, true);
    const retake = record('retake', { completedAt: '2026-09-02', correctAnswers: 10 });
    const result = state.buildIndex([retake, record()]).get(key);
    assert.equal(result.percentage, 100);
    assert.equal(result.wrong, false);
    assert.equal(state.percentage(record('partial', { correctAnswers: 5.99 })), 59.9);
    assert.equal(state.buildIndex([record('partial', { correctAnswers: 5.99 })]).get(key).wrong, true);
    assert.equal(state.buildIndex([record('boundary', { correctAnswers: 6 })]).get(key).wrong, false);
});

test('draft, interruption, demo, ungradable and missing-score records cannot replace a graded result', () => {
    const { state } = harness();
    const invalid = [
        { status: 'draft' }, { status: 'interrupted' }, { status: 'started' },
        { graded: false }, { gradable: false }, { totalQuestions: 0 },
        { correctAnswers: null }, { correctAnswers: 11 }, { dataSource: 'demo' },
        { browseScore: { earned: null, possible: 10 }, correctAnswers: 0 }
    ].map((fields, index) => record(`invalid-${index}`, { completedAt: '2026-09-03', ...fields }));
    const index = state.buildIndex([record(), ...invalid]);
    assert.equal(index.size, 1);
    assert.equal(index.get(state.identity(exam(), true)).tieBreak, 'old');
    assert.equal(state.buildIndex(invalid).size, 0);
});

test('provenance and exam identity isolate identical IDs and titles; unknown legacy provenance stays unattempted', () => {
    const { state } = harness();
    const index = state.buildIndex([
        record('default'), record('custom', { metadata: { libraryConfigurationId: 'custom' }, correctAnswers: 9 }),
        record('legacy', { metadata: {}, completedAt: '2026-09-09', correctAnswers: 10 })
    ]);
    assert.equal(index.size, 2);
    assert.equal(index.get(state.identity(exam(), true)).percentage, 50);
    assert.equal(index.get(state.identity(exam('p1', 'custom'), true)).percentage, 90);
    assert.equal(state.identity({ ...exam(), libraryConfigurationId: undefined }, true), null);
    assert.equal(state.buildIndex([record('legacy', { metadata: {} })]).size, 0);
});

test('suite entries keep their own source, score and completion time without copying parent totals', () => {
    const { state } = harness();
    const suite = record('suite', {
        examId: 'p1', completedAt: '2026-09-05', correctAnswers: 30, totalQuestions: 30,
        suiteEntrySummaries: [
            record('child', { completedAt: '2026-09-02', correctAnswers: 3 }),
            record('other-library', { examId: 'p1', metadata: { libraryConfigurationId: 'other' }, correctAnswers: 8 }),
            record('unknown-score', { examId: 'p2', browseScore: { earned: null, possible: 10 } })
        ]
    });
    const index = state.buildIndex([suite, record('child', { completedAt: '2026-09-02', correctAnswers: 3 })]);
    assert.equal(index.size, 2);
    assert.equal(index.get(state.identity(exam(), true)).percentage, 30);
    assert.equal(index.get(state.identity(exam(), true)).timestamp, Date.parse('2026-09-02'));
    assert.equal(index.get(state.identity(exam('p1', 'other'), true)).percentage, 80);
    assert.equal(index.has(state.identity(exam('p2'), true)), false);
});

test('latest ordering ignores migration updates, rejects missing time and deterministically resolves equal timestamps', () => {
    const { state } = harness();
    const rows = [record('z', { correctAnswers: 9 }), record('a', { correctAnswers: 1, updatedAt: '2030-01-01' })];
    const key = state.identity(exam(), true);
    assert.equal(state.buildIndex(rows).get(key).tieBreak, 'z');
    assert.equal(state.buildIndex(rows.reverse()).get(key).tieBreak, 'z');
    assert.equal(state.buildIndex([record('missing-time', { completedAt: null })]).size, 0);
    assert.equal(state.buildIndex([record('invalid-time', { completedAt: 1e20 })]).size, 0);
    const actualSubmission = record('imported', { completedAt: '2030-01-01', browseScore: {
        earned: 1, possible: 10, submittedAt: Date.parse('2026-08-01')
    } });
    assert.equal(state.buildIndex([actualSubmission, record('retake')]).get(key).tieBreak, 'retake');
});

test('favorite AND single learning state composes within the input scope and excludes listening when active', () => {
    const { state } = harness();
    const exams = [exam(), exam('p2'), exam('p1', 'other'), { ...exam('l1'), type: 'listening' }];
    const index = state.buildIndex([record()]);
    const getStatus = (item) => index.get(state.identity(item, true));
    const favorites = new Set([state.identity(exam('p2'), true), state.identity(exam(), true)]);
    const ids = (selection) => state.filter(exams, selection, favorites, getStatus).map(item => item.id);
    assert.deepEqual(ids({ learningState: 'unattempted', favoritesOnly: true }), ['p2']);
    assert.deepEqual(ids({ learningState: 'wrong' }), ['p1']);
    assert.deepEqual(ids({ learningState: 'completed' }), ['p1']);
    assert.equal(state.filter(exams, {}, favorites, getStatus), exams);
    assert.deepEqual(state.filter([], { favoritesOnly: true }, favorites, getStatus), []);
});

test('an explicit reset wins delayed preference hydration and retains favorites', async () => {
    let resolve;
    const gate = new Promise(done => { resolve = done; });
    const { window, context, state } = harness({
        AppData: { preferences: { getBrowse: () => gate } }, getBrowseLearningStatus: () => null
    });
    vm.runInContext(source('components/browseLearningControls.js'), context);
    const pending = window.BrowseLearningControls.ready();
    window.BrowseLearningControls.resetSelection();
    resolve({ learningState: 'completed', favoritesOnly: true, readingFavorites: { [state.identity(exam(), true)]: true } });
    await pending;
    assert.equal(window.BrowseLearningControls.filter([exam(), exam('p2')]).length, 2);
});

test('failed learning preference reads keep Browse usable and retry saved selections', async () => {
    let reads = 0;
    const { window, context, state } = harness({
        AppData: { preferences: { getBrowse: async () => {
            if (++reads === 1) throw new Error('Transient preference read failure');
            return { learningState: 'completed', favoritesOnly: true,
                readingFavorites: { [state.identity(exam(), true)]: true } };
        } } },
        getBrowseLearningStatus: (item) => item.id === 'p1' ? { percentage: 90 } : null
    });
    vm.runInContext(source('components/browseLearningControls.js'), context);
    await assert.doesNotReject(window.BrowseLearningControls.ready());
    const exams = [exam(), exam('p2')];
    assert.equal(window.BrowseLearningControls.filter(exams), exams, 'default results remain available');
    await window.BrowseLearningControls.ready();
    assert.equal(reads, 2);
    assert.deepEqual(window.BrowseLearningControls.filter(exams), [exams[0]]);
});

test('retrying failed preference hydration cannot overwrite an explicit reset', async () => {
    let reads = 0;
    const { window, context } = harness({
        AppData: { preferences: { getBrowse: async () => {
            if (++reads === 1) throw new Error('Transient preference read failure');
            return { learningState: 'completed', favoritesOnly: true };
        } } }, getBrowseLearningStatus: () => null
    });
    vm.runInContext(source('components/browseLearningControls.js'), context);
    await window.BrowseLearningControls.ready();
    window.BrowseLearningControls.resetSelection();
    await window.BrowseLearningControls.ready();
    const exams = [exam(), exam('p2')];
    assert.equal(window.BrowseLearningControls.filter(exams), exams);
});

test('cards and filters share the accepted provenance-scoped completion projection', () => {
    const { window, context } = harness();
    vm.runInContext(source('views/legacyViewBundle.js'), context);
    const prepared = window.prepareBrowseCompletionIndex([record(), record('ungradable', {
        completedAt: '2026-09-09', browseScore: { earned: null, possible: 10 }
    })]);
    assert.equal(window.getBrowseLearningStatus(exam()), null, 'preparing does not publish unfinished state');
    window.commitBrowseCompletionIndex(prepared);
    const getCardStatus = window.LegacyExamListView.prototype._getCompletionStatus;
    assert.equal(getCardStatus(exam()).percentage, 50);
    assert.equal(getCardStatus(exam('p1', 'other')), null);
    assert.equal(window.getBrowseLearningStatus(exam()).wrong, true);
    window.rebuildBrowseCompletionIndex([record('retake', { correctAnswers: 10 })]);
    assert.equal(getCardStatus(exam()).percentage, 100);
    assert.equal(window.getBrowseLearningStatus(exam()).wrong, false);
});
