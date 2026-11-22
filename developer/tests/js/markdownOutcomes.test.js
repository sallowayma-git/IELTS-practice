import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { fixtures, grade, record } from '../fixtures/historyCountFixtures.mjs';

const root = process.env.MARKDOWN_SOURCE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
function load() {
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
        document: { body: { insertAdjacentHTML() {} }, getElementById() { return null; },
            addEventListener() {}, removeEventListener() {} }, setTimeout() {}, clearTimeout() {}
    });
    context.window = context;
    for (const file of ['js/utils/answerMatchCore.js', 'js/utils/answerSanitizer.js', 'js/core/practiceCore.js',
        'js/utils/answerComparisonUtils.js', 'js/utils/dataConsistencyManager.js',
        'js/components/practiceRecordModal.js', 'js/utils/markdownExporter.js']) {
        vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
    }
    return context;
}

function results(markdown) {
    return Object.fromEntries(markdown.split('\n').filter(line => /^\| \d/.test(line)).map(line => {
        const cells = line.split('|').map(cell => cell.trim());
        return [cells[1], cells[4]];
    }));
}

const cases = () => {
    const source = fixtures();
    return [
        ['split groups', source.split, { 1: '✗', 2: '✗', 3: '✗', 7: '✓', 8: '✓', 9: '✓', 10: '✓' }],
        ['partial group', source.partial, { 11: 'Partial 1/4' }],
        ['duplicate selections', source.duplicate, { 7: '✓', 8: '✗' }],
        ['unknown answer key', source.unknown, { 1: 'Unknown' }],
        ['ordinary and blank', source.ordinary, { 1: '✓', 2: '✗', 3: 'No Answer' }],
        ['weighted failure', source.allWrong, { 11: '✗' }]
    ];
};

for (const mode of ['comparison', 'fallback']) {
    for (const [name, original, expected] of cases()) {
        test(`${mode}: ${name} agrees with history through normalization and display preparation`, () => {
            const context = load();
            const exporter = new context.MarkdownExporter();
            const input = structuredClone(original);
            if (mode === 'fallback') {
                input.scoreInfo ||= {};
                input.scoreInfo.details = input.answerComparison;
                delete input.answerComparison;
            }
            const normalized = structuredClone(input);
            if (normalized.answerComparison) normalized.answerComparison = context.PracticeCore.contracts.normalizeAnswerComparison(normalized.answerComparison);
            if (normalized.scoreInfo?.details) normalized.scoreInfo.details = context.PracticeCore.contracts.normalizeAnswerComparison(normalized.scoreInfo.details);
            for (const record of [input, normalized, new context.DataConsistencyManager().ensureConsistency(normalized)]) {
                const before = JSON.stringify(record);
                const markdown = exporter.generateRecordMarkdown(record);
                assert.deepEqual(results(markdown), expected);
                const html = context.practiceRecordModal.createModalHtml(record);
                for (const entry of context.AnswerComparisonUtils.getNormalizedEntries(record)) {
                    const outcome = expected[entry.displayNumber];
                    const css = outcome.startsWith('Partial') ? 'partial' :
                        ({ '✓': 'correct', '✗': 'incorrect', Unknown: 'unknown', 'No Answer': 'unanswered' })[outcome];
                    assert.match(html, new RegExp(`answer-row ${css}[\\s\\S]*?question-num">${entry.displayNumber}<`));
                }
                assert.equal(JSON.stringify(record), before, 'export and history must preserve totals, snapshots and annotations');
                if (name === 'split groups') assert.match(markdown, /4\/7/);
                if (mode === 'comparison') assert.deepEqual(results(exporter.generateTableFromComparison(record.answerComparison, record)), expected);
            }
        });
    }
}

for (const mode of ['comparison', 'fallback']) {
    test(`${mode}: canonical answer keys, snapshot validation and grading provenance survive export`, () => {
        const context = load();
        const exporter = new context.MarkdownExporter();
        const examples = [
            ['stored false', grade('D', 'D', false), 'D', 'D', '✗'],
            ['stale correct snapshot', grade('D', 'A', false), 'D', 'D', '✓'],
            ['missing correct snapshot', { userAnswer: 'D', isCorrect: false, weight: 1 }, 'D', 'D', '✓'],
            ['legacy boolean', { userAnswer: 'D effects', correctAnswer: 'D', isCorrect: false }, 'D effects', 'D', '✓'],
            ['display boolean', { ...grade('D effects', 'D', false), isCorrectSource: 'display' }, 'D effects', 'D', '✓'],
            ['missing verdict', { userAnswer: 'D effects', correctAnswer: 'D' }, 'D effects', 'D', '✓'],
            ['null verdict without key', { userAnswer: 'D', isCorrect: null }, 'D', '', 'Unknown'],
            ['boolean without key', { userAnswer: 'D', isCorrect: false, weight: 1 }, 'D', '', 'Unknown'],
            ['missing verdict without key', { userAnswer: 'D' }, 'D', '', 'Unknown'],
            ['no partial evidence', { userAnswer: 'A, B', correctAnswer: 'A, B, C', isCorrect: false, weight: 3 }, 'A, B', 'A, B, C', '✗']
        ];
        for (const [name, detail, answer, correct, expected] of examples) {
            const input = { id: name, answers: { q1: answer }, correctAnswerMap: { q1: correct },
                ...(mode === 'comparison' ? { answerComparison: { q1: detail } } : { scoreInfo: { details: { q1: detail } } }) };
            const before = JSON.stringify(input);
            const table = exporter.generateAnswerTable(input.realData, input);
            assert.equal(results(table)[1], expected, name);
            assert.equal(JSON.stringify(input), before);
        }
    });
}

test('stale candidates fall through to valid submission snapshots across aliases and nested sources', () => {
    const context = load();
    const exporter = new context.MarkdownExporter();
    for (const source of ['comparison', 'details', 'nestedDetails']) {
        for (const alias of ['q2', '2', 'question2']) {
            const detail = grade(['E', 'D'], 'D', true);
            const input = { answers: { q2: ['D', 'E'] }, correctAnswerMap: { q2: 'D' },
                answerComparison: { q2: { userAnswer: ['D', 'E'], correctAnswer: 'D', isCorrect: null } } };
            if (source === 'comparison') input.realData = { answerComparison: { [alias]: detail } };
            if (source === 'details') input.scoreInfo = { details: { [alias]: detail } };
            if (source === 'nestedDetails') input.realData = { scoreInfo: { details: { [alias]: detail } } };
            assert.equal(results(exporter.generateRecordMarkdown(input))[2], '✓', `${source}/${alias}`);
            detail.correctAnswer = 'A';
            assert.equal(results(exporter.generateRecordMarkdown(input))[2], '✗', 'stale correct snapshot is rejected');
            if (source !== 'comparison') {
                detail.correctAnswer = 'D';
                detail.userAnswer = ['A', 'B'];
                assert.equal(results(exporter.generateRecordMarkdown(input))[2], '✗', 'stale user snapshot is rejected');
            }
        }
    }
});

test('letter alignment validates snapshots before preserving grouped credit', () => {
    const context = load();
    const exporter = new context.MarkdownExporter();
    for (const correctAnswer of ['D', 'A']) {
        const input = { answers: { qa: ['D', 'E'] }, correctAnswerMap: { q1: correctAnswer },
            answerComparison: { qa: grade(['D', 'E'], 'D', true) } };
        assert.deepEqual(results(exporter.generateRecordMarkdown(input)), { 1: correctAnswer === 'D' ? '✓' : '✗' });
    }
});

test('fallback handles nested details and direct realData without manufacturing verdicts', () => {
    const context = load();
    const exporter = new context.MarkdownExporter();
    const realData = { answers: { q1: ['D', 'E'], q2: 'A' }, correctAnswerMap: { q1: 'D' },
        scoreInfo: { source: 'unified_reading_page', details: { q1: { userAnswer: ['D', 'E'], correctAnswer: 'D', isCorrect: true } } } };
    assert.deepEqual(results(exporter.generateAnswerTable(realData, { id: 'direct-real-data' })), { 1: '✓', 2: 'Unknown' });
    assert.deepEqual(results(exporter.generateRecordMarkdown({ id: 'nested', realData })), { 1: '✓', 2: 'Unknown' });
});

test('a row with inconsistent perfect flag and validated partial credit stays partial', () => {
    const context = load();
    const input = record('partial-flag', { q1: grade(['A'], ['A', 'B', 'C'], true, 3, 1) }, 1, 3);
    assert.deepEqual(results(new context.MarkdownExporter().generateRecordMarkdown(input)), { 1: 'Partial 1/3' });
});

for (const source of ['answerDetails', 'scoreInfo']) {
    test(`legacy ${source} fallback keeps answer snapshots without a separate answer map`, () => {
        const context = load();
        const details = { q1: { answer: ['D', 'E'], correctAnswer: 'D', isCorrect: true, weight: 1 },
            q2: { userAnswer: 'A', isCorrect: null } };
        const input = { id: 'legacy-detail-only',
            ...(source === 'answerDetails' ? { answerDetails: details } : { scoreInfo: { details } }) };
        const before = JSON.stringify(input);
        assert.deepEqual(results(new context.MarkdownExporter().generateRecordMarkdown(input)), { 1: '✓', 2: 'Unknown' });
        assert.match(context.practiceRecordModal.createModalHtml(input), /answer-row correct/);
        assert.equal(JSON.stringify(input), before);
    });
}
