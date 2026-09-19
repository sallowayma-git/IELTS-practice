import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

const sandbox = {};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const file of ['js/data/practiceRecordSource.js', 'js/services/readingAnalytics.js']) {
    vm.runInContext(fs.readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8'), sandbox);
}
const aggregate = (records, options) => JSON.parse(JSON.stringify(sandbox.ReadingAnalytics.aggregate(records, options)));
const now = new Date(2026, 8, 19, 12).getTime();
const record = (id, earned, possible, extras = {}) => ({
    id, sessionId: id, examId: 'passage-a', type: 'reading', status: 'completed',
    correctAnswers: earned, totalQuestions: possible, date: new Date(now).toISOString(),
    metadata: { libraryConfigurationId: null, category: 'P1' }, ...extras
});

test('unequal attempts and fractional points are weighted, including per-type credit', () => {
    const result = aggregate([
        record('a', 1, 2, { questionTypePerformance: { 'multiple-choice': { correct: 1, total: 2 } } }),
        record('b', 9, 10, { questionTypePerformance: { 'multiple-choice': { correct: 9, total: 10 } } })
    ]);
    assert.equal(result.total.accuracy, 10 / 12);
    assert.equal(result.total.attempts, 2);
    assert.equal(result.total.distinctPassages, 1);
    assert.equal(result.questionTypes['multiple-choice'].accuracy, 10 / 12);
    const partial = aggregate([record('fraction', 1.5, 3, {
        questionTypePerformance: { 'multiple-choice': { correct: 1.5, total: 3 } }
    })]);
    assert.equal(partial.total.earned, 1.5);
    assert.equal(partial.questionTypes['multiple-choice'].earned, 1.5);
    assert.equal(partial.coverage.completeQuestionTypes, 1);
});

test('suites count child submissions once, preserve retakes, and never count parent totals', () => {
    const child = record('child', 1.5, 2);
    const parent = record('suite', 50, 100, { suiteEntries: [child], suiteMode: true });
    const repeat = record('repeat', 2, 2);
    const result = aggregate([child, repeat, parent]);
    assert.equal(result.total.attempts, 2);
    assert.equal(result.total.earned, 3.5);
    assert.equal(result.total.possible, 4);
    assert.equal(result.total.distinctPassages, 1);
    assert.equal(result.suiteOnly.attempts, 0);
    const linked = record('standalone', 1.5, 2, { suiteSessionId: 'suite' });
    assert.equal(aggregate([linked, parent]).total.attempts, 1);
    assert.equal(aggregate([parent, parent]).total.attempts, 1);
});

test('missing children use separate parent-only scores or a disclosed partial child aggregate', () => {
    const parent = record('suite', 9, 10, { suiteMode: true, metadata: { libraryConfigurationId: null, suiteEntryCount: 3 } });
    const fallback = aggregate([parent]);
    assert.equal(fallback.total.accuracy, null);
    assert.equal(fallback.total.attempts, 0);
    assert.equal(fallback.suiteOnly.accuracy, .9);
    assert.equal(fallback.coverage.missingSuiteChildren, 3);
    const partial = aggregate([{ ...parent, suiteEntries: [record('c', 1, 2)] }]);
    assert.equal(partial.total.accuracy, .5);
    assert.equal(partial.suiteOnly.attempts, 0);
    assert.equal(partial.coverage.missingSuiteChildren, 2);
    const recovered = aggregate([parent, record('child', 1, 2, { suiteSessionId: 'suite' })]);
    assert.equal(recovered.total.accuracy, .5);
    assert.equal(recovered.suiteOnly.attempts, 0);
});

test('explicit legacy suite links deduplicate submissions without supplying passage identity', () => {
    const child = record('embedded', 1, 2, { metadata: {}, title: 'Embedded' });
    const parent = record('legacy-suite', 1, 2, {
        metadata: { suiteEntryCount: 2 }, title: 'Legacy suite', suiteEntries: [child]
    });
    const standalone = record('standalone', 1, 2, {
        metadata: {}, title: 'Stale copy', suiteSessionId: parent.sessionId
    });
    const result = aggregate([standalone, parent]);
    assert.equal(result.total.attempts, 1);
    assert.equal(result.total.earned, 1);
    assert.equal(result.total.possible, 2);
    assert.equal(result.total.distinctPassages, 0);
    assert.equal(result.coverage.unknownIdentity, 1);
    assert.equal(result.coverage.missingSuiteChildren, 1);
    assert.equal(aggregate([standalone, parent], { query: 'stale' }).total.attempts, 0);
    const oldParent = { ...parent, suiteEntries: [{ ...child, date: new Date(now - 100 * 86400000).toISOString() }] };
    assert.equal(aggregate([standalone, oldParent], { days: 7, now }).total.attempts, 0);
    const retake = record('retake', 9, 10, { metadata: {} });
    assert.equal(aggregate([standalone, parent, retake]).total.accuracy, 10 / 12);
    const recovered = aggregate([{ ...parent, suiteEntries: [], suiteMode: true }, standalone]);
    assert.equal(recovered.total.attempts, 1);
    assert.equal(recovered.total.distinctPassages, 0);
});

test('explicit suite links never deduplicate conflicting known library sources', () => {
    const child = record('child', 1, 2, { metadata: { libraryConfigurationId: 'A' } });
    const standalone = record('child', 9, 10, {
        metadata: { libraryConfigurationId: 'B' }, suiteSessionId: 'suite'
    });
    for (const metadata of [{ libraryConfigurationId: 'A' }, {}]) {
        const parent = record('suite', 1, 2, { metadata, suiteEntries: [child] });
        const result = aggregate([standalone, parent]);
        assert.equal(result.total.attempts, 2);
        assert.equal(result.total.accuracy, 10 / 12);
        assert.equal(result.total.distinctPassages, 2);
    }
});

test('source and saved category are independent of Browse, including same IDs across libraries', () => {
    const a = record('same', 1, 2, { metadata: { libraryConfigurationId: 'A', category: 'P1' } });
    const b = record('same', 3, 4, { metadata: { libraryConfigurationId: 'B', category: 'P3' } });
    sandbox.examIndex = [{ id: 'passage-a', category: 'P2' }];
    const before = aggregate([a, b]);
    sandbox.examIndex = [{ id: 'passage-a', category: 'P1' }];
    assert.deepEqual(aggregate([a, b]), before);
    assert.equal(before.total.distinctPassages, 2);
    assert.equal(before.categories.P1.accuracy, .5);
    assert.equal(before.categories.P3.accuracy, .75);
    assert.equal(before.categories.P2.accuracy, null);
});

test('unknown and invalid metadata are not converted into zero scores or guessed categories/types', () => {
    const result = aggregate([
        record('missing-denominator', 1, undefined),
        record('zero', 0, 0), record('negative', 0, -1), record('too-large', 5, 4),
        record('boolean', false, true),
        record('unknown', .5, 2, { metadata: {}, questionTypeErrorCounts: { 'multiple-choice': 1 } }),
        record('type-invalid', 1, 3, { questionTypePerformance: {
            'multiple-choice': { correct: 1 }, other: { correct: 0, total: 3 }
        } })
    ]);
    assert.equal(result.total.scored, 2);
    assert.equal(result.total.accuracy, 1.5 / 5);
    assert.equal(result.coverage.unknownScore, 5);
    assert.equal(result.coverage.unknownIdentity, 1);
    assert.equal(result.coverage.unknownCategory, 1);
    assert.deepEqual(result.questionTypes, {});
    assert.equal(result.coverage.completeQuestionTypes, 0);
    assert.equal(aggregate([]).total.accuracy, null);
    assert.equal(aggregate([record('zero', 0, 0)]).total.accuracy, null);
    assert.equal(aggregate([record('real-zero', 0, 5)]).total.accuracy, 0);
});

test('partial type metadata discloses coverage and inconsistent totals are excluded', () => {
    const result = aggregate([record('partial', 2.5, 5, {
        questionTypePerformance: { mcq: { correct: 1.5, total: 2 }, unknown: { correct: 1, total: 3 } }
    }), record('inconsistent', 1, 2, {
        questionTypePerformance: { mcq: { correct: 1, total: 4 } }
    })]);
    assert.equal(result.questionTypes['multiple-choice'].earned, 1.5);
    assert.equal(result.coverage.classifiedPossible, 2);
    assert.equal(result.coverage.completeQuestionTypes, 0);
    const impossibleRemainder = aggregate([record('bad-remainder', 4, 5, {
        questionTypePerformance: { mcq: { correct: 1, total: 4 } }
    })]);
    assert.deepEqual(impossibleRemainder.questionTypes, {}, 'remaining earned credit cannot exceed remaining possible credit');
});

test('drafts, interrupted, ungradable, listening and demonstration records never enter Reading accuracy', () => {
    const rows = ['draft', 'interrupted', 'cancelled', 'in_progress'].map(status => record(status, 10, 10, { status }));
    rows.push(record('ungraded', 10, 10, { graded: false }), record('ungradable', 10, 10, { gradable: false }),
        record('listening', 10, 10, { type: 'listening' }), record('demo', 10, 10, { dataSource: 'demo' }),
        record('unknown-type', 10, 10, { type: 'practice' }), record('real', 1, 2));
    assert.equal(aggregate(rows).total.attempts, 1);
    assert.equal(aggregate(rows).total.accuracy, .5);
    assert.equal(aggregate(rows, { recordType: 'listening' }).total.accuracy, null);
    const parent = record('draft-suite', 10, 10, { status: 'draft', suiteEntries: [record('child', 10, 10)] });
    assert.equal(aggregate([parent]).total.attempts, 0);
});

test('history windows use local calendar days and original submission times, with honest undated coverage', () => {
    const start = new Date(2026, 8, 13).getTime();
    const rows = [record('boundary', 1, 2, { date: new Date(start).toISOString() }),
        record('old', 10, 10, { date: new Date(start - 1).toISOString() }),
        record('unknown', 1, 2, { browseScore: { earned: 1, possible: 2, submittedAt: null } }),
        record('future', 10, 10, { date: new Date(now + 1).toISOString() })];
    const week = aggregate(rows, { days: 7, now });
    assert.equal(week.total.attempts, 1);
    assert.equal(week.coverage.excludedUndated, 1);
    assert.equal(aggregate(rows, { now }).total.attempts, 4);
    assert.equal(aggregate(rows, { now }).coverage.unknownDate, 1);
    const parent = record('parent', 1, 2, { suiteEntries: [record('c', 1, 2, { date: null })] });
    assert.equal(aggregate([parent], { days: 7, now }).total.attempts, 1);
});

test('deduplication precedes search/window selection, and search follows the visible suite row', () => {
    const child = record('child', 1, 2, { title: 'Embedded', date: new Date(now - 100 * 86400000).toISOString() });
    const duplicate = { ...child, title: 'Stale duplicate', date: new Date(now).toISOString() };
    const parent = record('parent', 1, 2, { title: 'Suite', suiteEntries: [child] });
    assert.equal(aggregate([duplicate, parent], { query: 'embedded' }).total.attempts, 0);
    assert.equal(aggregate([duplicate, parent], { query: 'suite' }).total.attempts, 1);
    assert.equal(aggregate([duplicate, parent], { query: 'stale' }).total.attempts, 0);
    assert.equal(aggregate([duplicate, parent], { days: 7, now }).total.attempts, 0);
});
