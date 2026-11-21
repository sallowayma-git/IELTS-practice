import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { fixtures, grade, record } from '../fixtures/historyCountFixtures.mjs';
import { productionReadingResults } from '../fixtures/productionReadingResults.mjs';

const root = process.env.HISTORY_SOURCE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const files = [
    'js/core/practiceCore.js', 'js/utils/answerMatchCore.js', 'js/utils/answerSanitizer.js',
    'js/utils/answerComparisonUtils.js', 'js/utils/dataConsistencyManager.js',
    'js/components/practiceRecordModal.js', 'js/utils/markdownExporter.js'
];
function load() {
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
        document: { body: { insertAdjacentHTML() {} }, getElementById() { return null; },
            addEventListener() {}, removeEventListener() {} }, setTimeout() {}, clearTimeout() {}
    });
    context.window = context;
    for (const file of files) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
    return context;
}
const plain = value => JSON.parse(JSON.stringify(value));
function counts(context, input) {
    return plain(context.AnswerComparisonUtils.resolveRecordCounts(input));
}
const errorCount = html => html.match(/class="meta-value error-count">(.*?)<\/span>/)?.[1];

for (const [name, missed] of [['allWrong', 3], ['partial', 3], ['suite', 6], ['summary', 3]]) {
    test(`${name}: real modal counts scored slots before and after display preparation/reopen`, () => {
        const context = load();
        const input = fixtures()[name];
        const original = JSON.stringify(input);
        assert.equal(errorCount(context.practiceRecordModal.createModalHtml(input)), String(missed));
        const prepared = new context.DataConsistencyManager().ensureConsistency(input);
        assert.equal(errorCount(context.practiceRecordModal.createModalHtml(prepared)), String(missed));
        for (let i = 0; i < 2; i += 1) {
            context.practiceRecordModal.show(input);
            assert.deepEqual(plain(context.practiceRecordModal.currentRecord), plain(input));
            context.practiceRecordModal.hide();
        }
        new context.MarkdownExporter().generateRecordMarkdown(input);
        assert.equal(JSON.stringify(input), original, 'display and export must leave saved grading/annotations intact');
    });
}

test('partial credit separates earned, answered-wrong, blank and unknown slots', () => {
    const context = load();
    const cases = fixtures();
    for (const [name, expected] of Object.entries({
        allWrong: [3, 0, 3, 0, 0], partial: [4, 1, 0, 3, 0],
        suite: [11, 5, 3, 3, 0], ordinary: [3, 1, 1, 1, 0],
        unknown: [1, null, 0, 0, 1], summary: [10, 7, 0, 0, 10], duplicate: [2, 1, 1, 0, 0]
    })) {
        const actual = counts(context, cases[name]);
        assert.deepEqual([actual.total, actual.correct, actual.incorrect, actual.unanswered, actual.unknown], expected, name);
    }
    assert.equal(counts(context, cases.unknown).missed, null);
    assert.equal(counts(context, cases.summary).unclassifiedMissed, 3);
    assert.match(context.practiceRecordModal.createModalHtml(cases.partial), /部分得分.*1\/4/);
    assert.match(context.practiceRecordModal.createModalHtml(cases.unknown), /error-count">未知</);
});

test('valid saved totals including zero remain authoritative over incompatible detail', () => {
    const context = load();
    const input = record('conflict', { q1: grade('A', 'A', true) }, 0, 3);
    const result = counts(context, input);
    assert.equal(result.correct, 0);
    assert.equal(result.missed, 3);
    assert.equal(result.detailStatus, 'conflict');
    assert.equal(result.unknown, 3);
    assert.equal(result.incorrect, 0, 'an aggregate mismatch cannot manufacture wrong row verdicts');
    assert.match(context.practiceRecordModal.createModalHtml(input), /score-highlight">0\/3</);
});

test('malformed or missing score fields fall back to validated weighted detail', () => {
    const context = load();
    for (const bad of [null, '', ' ', false, {}, -1, 1.5, NaN, Infinity, 'broken', 99]) {
        const input = fixtures().partial;
        input.correctAnswers = bad;
        input.scoreInfo.correct = bad;
        const result = counts(context, input);
        assert.equal(result.correct, 1, String(bad));
        assert.equal(result.missed, 3, String(bad));
    }
    const legacy = record('legacy', { q1: { userAnswer: 'A', correctAnswer: 'A' }, q2: { userAnswer: '', correctAnswer: 'B' } });
    assert.equal(counts(context, legacy).missed, 1);
    assert.equal(counts(context, { scoreInfo: { correct: '0', total: '10' } }).missed, 10);
    assert.equal(counts(context, { totalQuestions: 10 }).correct, null);
    assert.equal(counts(context, { totalQuestions: 10 }).unknown, 10);
    assert.equal(counts(context, {}).missed, null);
    assert.equal(counts(context, { correctAnswers: 0, totalQuestions: 0 }).missed, 0);
});

test('suite identities preserve repeated numbers and exclude root and duplicate passage copies', () => {
    const context = load();
    const a = record('passage-a', { q1: grade('A', 'A', true) }, 1, 1);
    const b = record('passage-b', { q1: grade('B', 'A', false) }, 0, 1);
    const input = record('suite', { 'passage-a::q1': a.answerComparison.q1, 'passage-b::q1': b.answerComparison.q1 }, 1, 2,
        { suiteEntries: [a, b, structuredClone(a)] });
    assert.equal(context.practiceRecordModal.collectAllEntries(input).length, 2);
    assert.equal(counts(context, input).missed, 1);
    delete input.suiteEntries;
    assert.equal(context.practiceRecordModal.collectAllEntries(input).length, 2, 'root-only scoped suite keys retain passage identity');
    assert.equal(counts(context, input).incorrect, 1);
    const repeatedExam = { suiteEntries: [{ ...a, sessionId: 'first' }, { ...a, sessionId: 'second' }] };
    assert.equal(context.practiceRecordModal.collectAllEntries(repeatedExam).length, 2, 'distinct attempts must not collapse');
});

test('stale and display-generated metadata cannot award weighted credit', () => {
    const context = load();
    for (const change of [{ isCorrectSource: 'display' }, { correctAnswer: 'stale' }]) {
        const input = record('invalid-grade', { q1: { ...grade('B', 'A', true, 4, 4), ...change } });
        input.correctAnswerMap = { q1: 'A' };
        const result = counts(context, input);
        assert.equal(result.correct, 0);
        assert.equal(result.incorrect, 1);
    }
    const input = fixtures().partial;
    delete input.correctAnswers;
    delete input.scoreInfo;
    assert.equal(counts(context, input).correct, 1);
    const prepared = new context.DataConsistencyManager().ensureConsistency(input);
    assert.equal(counts(context, prepared).correct, 1, 'display row totals must never become saved grading authority');
    assert.equal(counts(context, prepared).total, 4);
});

test('normalization retains grading evidence and display provenance', () => {
    const context = load();
    const source = { q1: { ...grade('A', 'A, B', false, 2, 1), answeredCount: 1, isCorrectSource: 'display' } };
    for (const useSanitizer of [true, false]) {
        if (!useSanitizer) delete context.AnswerSanitizer;
        const result = context.PracticeCore.contracts.normalizeAnswerComparison(source);
        assert.equal(result.q1.weight, 2);
        assert.equal(result.q1.partialCorrectCount, 1);
        assert.equal(result.q1.answeredCount, 1);
        assert.equal(result.q1.isCorrectSource, 'display');
    }
});

test('display enrichment cannot turn missing totals into saved row-count grades', () => {
    const context = load();
    const input = fixtures().partial;
    delete input.totalQuestions;
    delete input.scoreInfo;
    delete input.startTime;
    const prepared = new context.DataConsistencyManager().ensureConsistency(input);
    assert.equal(counts(context, prepared).total, 4);
    assert.equal(counts(context, prepared).correct, 1);
    assert.equal(counts(context, prepared).missed, 3);
});

test('empty records without saved totals remain unknown through the normal modal path', () => {
    const context = load();
    const manager = new context.DataConsistencyManager();
    for (const input of [
        { answers: {} },
        { realData: { answers: {} } },
        { answers: {}, totalQuestions: 0, browseScore: { earned: null, possible: null } },
        ...['display', 'comparison_calculation'].map(source => ({ answers: {}, scoreInfo: { total: 0, source } }))
    ]) {
        const original = JSON.stringify(input);
        const prepared = manager.ensureConsistency(input);
        assert.equal(prepared.totalQuestions, 0, 'legacy display preparation supplies a zero');
        for (const candidate of [input, prepared, manager.ensureConsistency(prepared)]) {
            const result = counts(context, candidate);
            assert.equal(result.total, null, original);
            assert.equal(result.correct, null, original);
            assert.equal(result.missed, null, original);
            assert.equal(result.detailStatus, 'partial', original);
        }
        let rendered;
        context.document.body.insertAdjacentHTML = (_, html) => { rendered = html; };
        context.practiceRecordModal.show(input);
        assert.match(rendered, /score-highlight">未知</);
        assert.equal(errorCount(rendered), '未知');
        assert.deepEqual(plain(context.practiceRecordModal.currentRecord), plain(input));
        context.practiceRecordModal.hide();
        assert.equal(JSON.stringify(input), original);
    }
});

test('explicit zero denominators remain complete when the record has no answer slots', () => {
    const context = load();
    const manager = new context.DataConsistencyManager();
    for (const fields of [
        { totalQuestions: 0 },
        { totalQuestions: '0' },
        { correctAnswers: 0, totalQuestions: 0 },
        { browseScore: { earned: null, possible: 0 } },
        { scoreInfo: { total: 0 } },
        { realData: { scoreInfo: { totalQuestions: 0 } } },
        { total: 0 }
    ]) {
        const input = { answers: {}, ...fields };
        const original = JSON.stringify(input);
        for (const candidate of [input, manager.ensureConsistency(input)]) {
            const result = counts(context, candidate);
            assert.equal(result.total, 0, original);
            assert.equal(result.correct, 0, original);
            assert.equal(result.missed, 0, original);
            assert.equal(result.detailStatus, 'complete', original);
            const html = context.practiceRecordModal.createModalHtml(candidate);
            assert.match(html, /score-highlight">0\/0</);
            assert.equal(errorCount(html), '0');
        }
        assert.equal(JSON.stringify(input), original);
    }
});

test('display preparation preserves a saved denominator without manufacturing earned credit', () => {
    const context = load();
    for (const totalQuestions of [10, '10']) {
        const input = { answers: {}, totalQuestions };
        const prepared = new context.DataConsistencyManager().ensureConsistency(input);
        const result = counts(context, prepared);
        assert.equal(result.total, 10);
        assert.equal(result.correct, null);
        assert.equal(result.missed, null);
        assert.equal(result.unknown, 10);
        assert.match(context.practiceRecordModal.createModalHtml(prepared), /score-highlight">未知\/10</);
    }
});

test('unknown weighted results retain their denominator without inventing credit', () => {
    const context = load();
    const input = record('unknown-weighted', { q1: { userAnswer: ['A', 'B'], correctAnswer: '', isCorrect: null, weight: 3 } });
    const result = counts(context, input);
    assert.equal(result.total, 3);
    assert.equal(result.correct, null);
    assert.equal(result.unknown, 2);
    assert.equal(result.unanswered, 1);
});

test('suite-only totals and scoped numeric passage IDs do not collapse or disappear', () => {
    const context = load();
    const suite = fixtures().suite;
    delete suite.correctAnswers;
    delete suite.totalQuestions;
    delete suite.scoreInfo;
    assert.equal(counts(context, suite).correct, 5);
    assert.equal(counts(context, suite).missed, 6);
    const scoped = record('scoped', { 'audio-passage-312::q1': grade('B', 'A', false), 'audio-passage-313::q1': grade('A', 'A', true) });
    assert.equal(counts(context, scoped).total, 2);
    assert.equal(counts(context, scoped).correct, 1);
});

test('incomplete passage grades retain suite denominators through display preparation', () => {
    const context = load();
    const input = fixtures().incompleteSuite;
    const original = JSON.stringify(input);
    for (const source of [input, { suiteEntries: [input, structuredClone(input)] }]) {
        for (const candidate of [source, new context.DataConsistencyManager().ensureConsistency(source)]) {
            const result = counts(context, candidate);
            assert.equal(result.total, 11);
            assert.equal(result.correct, null);
            assert.equal(result.missed, null);
            assert.equal(result.unknown, 10);
            assert.equal(result.detailStatus, 'partial');
            assert.match(context.practiceRecordModal.createModalHtml(candidate), /score-highlight">未知\/11</);
            assert.equal(errorCount(context.practiceRecordModal.createModalHtml(candidate)), '未知');
        }
    }
    assert.equal(JSON.stringify(input), original);
});

test('an unknown-size passage cannot make a suite complete and parent denominators fill the gap', () => {
    const context = load();
    const input = fixtures().incompleteSuite;
    delete input.suiteEntries[1].totalQuestions;
    assert.equal(counts(context, input).total, null);
    assert.equal(counts(context, input).correct, null);
    assert.equal(counts(context, input).detailStatus, 'partial');
    input.totalQuestions = 11;
    assert.equal(counts(context, input).total, 11);
    assert.equal(counts(context, input).unknown, 10);
    assert.equal(counts(context, input).correct, null);
    input.correctAnswers = 7;
    assert.equal(counts(context, input).correct, 7, 'a valid saved parent grade stays authoritative');
});

test('production split selections retain slot occupancy through ingestion and the real modal', () => {
    const context = load();
    for (const [selected, expected] of [
        [['C'], [1, 0, 12]], [['E'], [1, 0, 12]], [['D'], [0, 1, 12]],
        [[], [0, 0, 13]], [['C', 'D'], [1, 1, 11]], [['C', 'E'], [2, 0, 11]],
        [['C', 'D', 'E'], [0, 2, 11]]
    ]) {
        const submitted = productionReadingResults('p2-medium-245', { q9: selected, q10: selected });
        const input = context.PracticeCore.ingestor.fromCompletion({ ...submitted, examId: 'p2-medium-245' });
        const original = JSON.stringify(input);
        for (const candidate of [input, new context.DataConsistencyManager().ensureConsistency(input)]) {
            const result = counts(context, candidate);
            assert.deepEqual([result.correct, result.incorrect, result.unanswered], expected, String(selected));
            assert.equal(result.unknown, 0, String(selected));
            const html = context.practiceRecordModal.createModalHtml(candidate);
            assert.match(html, new RegExp(`unanswered-count">${expected[2]}<`));
            assert.equal(errorCount(html), String(13 - expected[0]));
        }
        assert.equal(JSON.stringify(input), original);
    }
});

test('legacy split display sets keep unproven occupancy unknown after normalization', () => {
    for (const useSanitizer of [true, false]) {
        const context = load();
        if (!useSanitizer) delete context.AnswerSanitizer;
        const submitted = productionReadingResults('p2-medium-245', { q9: ['C'], q10: ['C'] });
        for (const row of Object.values(submitted.answerComparison)) delete row.answeredCount;
        for (const row of Object.values(submitted.scoreInfo.details)) delete row.answeredCount;
        const input = context.PracticeCore.ingestor.fromCompletion({ ...submitted, examId: 'p2-medium-245' });
        delete input.scoreInfo.details;
        delete input.realData.scoreInfo.details;
        const result = counts(context, input);
        assert.equal(result.correct, 1);
        assert.equal(result.incorrect, 0);
        assert.equal(result.unanswered, 11);
        assert.equal(result.unknown, 1);
        assert.equal(result.detailStatus, 'partial');
    }
});

test('suite aggregation carries partial and conflicting child detail alongside known grades', () => {
    const context = load();
    const known = record('known', { q1: grade('A', 'A', true) }, 1, 1);
    const summary = record('summary', {}, 7, 10);
    const input = { suiteEntries: [known, summary] };
    let result = counts(context, input);
    assert.equal(result.total, 11);
    assert.equal(result.correct, 8);
    assert.equal(result.unknown, 10);
    assert.equal(result.detailStatus, 'partial');
    input.suiteEntries.push(record('conflict', { q1: grade('A', 'A', true) }, 0, 1));
    result = counts(context, input);
    assert.equal(result.correct, 8);
    assert.equal(result.total, 12);
    assert.equal(result.unknown, 11);
    assert.equal(result.detailStatus, 'conflict');
});
