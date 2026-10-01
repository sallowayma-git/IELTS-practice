#!/usr/bin/env node
'use strict';

// 回归：练习记录详情（PracticeRecordModal -> AnswerComparisonUtils.getNormalizedEntries）
// 必须与提交界面（unifiedReadingPage.buildResultsFromAnswers）的多选题判定保持一致。
//
// 历史 bug：分键多选题（Choose TWO/THREE，多个 questionId 共享一组 checkbox）在提交时按
// “该子题正确选项是否出现在所选集合中”逐题给 overlap 分，并把权威 isCorrect 存入
// answerComparison / scoreInfo.details；但记录详情重建表格时丢弃了已存储的 isCorrect，
// 改用严格集合全等重算，导致“对了一部分”的子题（用户答案是整个选择集，如 D,E；
// 该子题正确答案仅 D）被全部判错，顶部错题数也随之与得分自相矛盾。

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

function loadScript(relativePath, context) {
    const code = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    vm.runInContext(code, context, { filename: relativePath });
}

function createUtilsSandbox() {
    const sandbox = {
        console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
        document: {
            body: { insertAdjacentHTML() {} },
            addEventListener() {},
            removeEventListener() {},
            getElementById() { return null; }
        },
        setTimeout() {}
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);

    loadScript('js/utils/answerMatchCore.js', context);
    loadScript('js/utils/answerSanitizer.js', context);
    loadScript('js/core/practiceCore.js', context);
    loadScript('js/utils/answerComparisonUtils.js', context);
    loadScript('js/utils/dataConsistencyManager.js', context);
    loadScript('js/components/practiceRecordModal.js', context);
    return sandbox;
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function getModalEntries(sandbox, record) {
    let entries = null;
    const before = JSON.stringify(record);
    const modal = sandbox.practiceRecordModal;
    modal.createModalHtml = (prepared) => {
        entries = modal.collectAllEntries(prepared);
        return '';
    };
    modal.show(record);
    assert.ok(entries, 'the real modal display path should produce answer rows');
    assert.strictEqual(JSON.stringify(record), before, 'display preparation must not mutate the stored record');
    return entries;
}

// 截图场景：Choose TWO，q1 正确 A、q2 正确 D，用户选择集合为 D,E。
// 提交界面：q1 错（A 未选），q2 对（D 在集合中），得分 1/2。
function buildSplitKeyRecord() {
    const comparison = {
        q1: {
            questionId: 'q1',
            userAnswer: ['D', 'E'],
            correctAnswer: 'A',
            isCorrect: false,
            questionType: 'multi_choice',
            partialCorrectCount: 0,
            weight: 1
        },
        q2: {
            questionId: 'q2',
            userAnswer: ['D', 'E'],
            correctAnswer: 'D',
            isCorrect: true,
            questionType: 'multi_choice',
            partialCorrectCount: 1,
            weight: 1
        }
    };
    return {
        answers: { q1: ['D', 'E'], q2: ['D', 'E'] },
        correctAnswerMap: { q1: 'A', q2: 'D' },
        answerComparison: clone(comparison),
        scoreInfo: {
            correct: 1,
            total: 2,
            totalQuestions: 2,
            accuracy: 0.5,
            details: clone(comparison)
        }
    };
}

function testSplitKeyPartialCreditSurvivesHistoryDetail() {
    const sandbox = createUtilsSandbox();
    const utils = sandbox.AnswerComparisonUtils;
    const record = buildSplitKeyRecord();

    const entries = utils.getNormalizedEntries(record);
    const byNumber = {};
    entries.forEach((entry) => {
        byNumber[entry.questionNumber] = entry;
    });

    assert.ok(byNumber[1], 'q1 row should be present');
    assert.ok(byNumber[2], 'q2 row should be present');

    assert.strictEqual(
        byNumber[1].isCorrect,
        false,
        'q1 (correct A, selected D,E) should remain incorrect'
    );
    assert.strictEqual(
        byNumber[2].isCorrect,
        true,
        'q2 (correct D, selected D,E) must keep the overlap credit decided at submit time'
    );

    const summary = utils.summariseEntries(entries);
    assert.strictEqual(summary.correct, 1, 'history summary correct count must match submit score');
    assert.strictEqual(summary.incorrect, 1, 'history summary incorrect count must match submit score');
}

// 单键数组多选题（一个 questionId，正确答案为选项数组 B,C,D，用户选 A,B,C）：
// 提交时整题未全对 -> isCorrect=false，但 partialCorrectCount=2。详情行不得翻转为对。
function testSingleKeyArrayPartialStaysNonPerfect() {
    const sandbox = createUtilsSandbox();
    const utils = sandbox.AnswerComparisonUtils;

    const comparison = {
        q11: {
            questionId: 'q11',
            userAnswer: ['A', 'B', 'C'],
            correctAnswer: ['B', 'C', 'D'],
            isCorrect: false,
            questionType: 'multi_choice',
            partialCorrectCount: 2,
            weight: 3
        }
    };
    const record = {
        answers: { q11: ['A', 'B', 'C'] },
        correctAnswerMap: { q11: ['B', 'C', 'D'] },
        answerComparison: clone(comparison),
        scoreInfo: { correct: 2, total: 3, totalQuestions: 3, accuracy: 2 / 3, details: clone(comparison) }
    };

    const entries = utils.getNormalizedEntries(record);
    assert.strictEqual(entries.length, 1, 'single-key grouped checkbox should stay one row');
    assert.strictEqual(
        entries[0].isCorrect,
        false,
        'partial single-key grouped checkbox row should remain non-perfect in history detail'
    );
}

// 兼容：老记录没有存储布尔 isCorrect 时，仍回退到答案比对重算（普通单选）。
function testFallsBackToRecomputeWhenNoStoredFlag() {
    const sandbox = createUtilsSandbox();
    const utils = sandbox.AnswerComparisonUtils;

    const record = {
        answers: { q5: 'A', q6: 'B' },
        correctAnswerMap: { q5: 'A', q6: 'C' },
        answerComparison: {
            q5: { questionId: 'q5', userAnswer: 'A', correctAnswer: 'A' },
            q6: { questionId: 'q6', userAnswer: 'B', correctAnswer: 'C' }
        }
    };

    const entries = utils.getNormalizedEntries(record);
    const byNumber = {};
    entries.forEach((entry) => {
        byNumber[entry.questionNumber] = entry;
    });

    assert.strictEqual(byNumber[5].isCorrect, true, 'matching plain answer without stored flag should recompute correct');
    assert.strictEqual(byNumber[6].isCorrect, false, 'mismatching plain answer without stored flag should recompute incorrect');
}

// 仅 scoreInfo.details 携带权威 isCorrect（无 answerComparison）时也应被采纳。
function testStoredFlagFromScoreDetailsIsHonoured() {
    const sandbox = createUtilsSandbox();
    const utils = sandbox.AnswerComparisonUtils;

    const details = {
        q3: { questionId: 'q3', userAnswer: ['D', 'E'], correctAnswer: 'D', isCorrect: true, weight: 1 }
    };
    const record = {
        answers: { q3: ['D', 'E'] },
        correctAnswerMap: { q3: 'D' },
        scoreInfo: { correct: 1, total: 1, totalQuestions: 1, accuracy: 1, details }
    };

    const entries = utils.getNormalizedEntries(record);
    assert.strictEqual(entries.length, 1, 'score detail row should be present');
    assert.strictEqual(
        entries[0].isCorrect,
        true,
        'authoritative isCorrect stored in scoreInfo.details must be honoured in history detail'
    );
}

function testStaleCorrectAnswerSnapshotFallsBackInModal() {
    for (const diagnosticsEnabled of [false, true]) {
        const sandbox = createUtilsSandbox();
        if (!diagnosticsEnabled) delete sandbox.DataConsistencyManager;
        const entries = getModalEntries(sandbox, {
            id: 'stale-correct-answer',
            startTime: '2026-09-20T00:00:00Z',
            answers: { q1: 'A' },
            correctAnswerMap: { q1: 'A' },
            answerComparison: {
                q1: { userAnswer: 'A', correctAnswer: 'B', isCorrect: false }
            }
        });
        assert.strictEqual(entries[0].userAnswer, 'A');
        assert.strictEqual(entries[0].correctAnswer, 'A');
        assert.strictEqual(entries[0].isCorrect, true, 'a stale comparison must not override the canonical answer');
    }
}

function testDisplayGeneratedVerdictDoesNotOverrideMatchingCore() {
    const sandbox = createUtilsSandbox();
    const entries = getModalEntries(sandbox, {
        id: 'legacy-labeled-option',
        startTime: '2026-09-20T00:00:00Z',
        answers: { q1: 'D effects' },
        correctAnswerMap: { q1: 'D' },
        scoreInfo: { correct: 1, total: 1, accuracy: 1 }
    });
    assert.strictEqual(entries[0].isCorrect, true, 'display-generated string equality must not override option matching');
}

function testDisplayGeneratedVerdictDoesNotMaskStoredCredit() {
    const sandbox = createUtilsSandbox();
    const record = buildSplitKeyRecord();
    delete record.answerComparison;
    const entries = getModalEntries(sandbox, record);
    assert.strictEqual(entries[1].isCorrect, true, 'display-generated comparisons must allow submission details to supply partial credit');
}

function testMissingVerdictsFallThroughEverySource() {
    const cases = [1, 2, 3].flatMap(index => ['q2', '2', 'question2'].map(key => [index, key]));
    for (const [storedSourceIndex, key] of cases) {
        const sandbox = createUtilsSandbox();
        const placeholder = { userAnswer: ['D', 'E'], correctAnswer: 'D' };
        const normalized = sandbox.PracticeCore.contracts.normalizeAnswerComparison({ q2: placeholder });
        assert.strictEqual(normalized.q2.isCorrect, null, 'the production normalizer should supply the missing verdict');
        const sources = Array.from({ length: 4 }, () => clone(normalized));
        sources[storedSourceIndex] = {
            [key]: { userAnswer: ['E', 'D'], correctAnswer: 'D', isCorrect: true }
        };
        const record = {
            answers: { q2: ['D', 'E'] },
            correctAnswerMap: { q2: 'D' },
            answerComparison: sources[0],
            scoreInfo: { details: sources[2] },
            realData: { answerComparison: sources[1], scoreInfo: { details: sources[3] } }
        };
        const entries = sandbox.AnswerComparisonUtils.getNormalizedEntries(record);
        assert.strictEqual(entries[0].isCorrect, true, `source ${storedSourceIndex} should supply the verdict across key aliases`);
        if (storedSourceIndex === 1) {
            assert.strictEqual(getModalEntries(sandbox, record)[0].isCorrect, true, 'display enrichment must preserve the nested comparison fallback');
        }
    }
}

function testStoredFalseKeepsSourcePrecedence() {
    const sandbox = createUtilsSandbox();
    const comparison = { userAnswer: 'D', correctAnswer: 'D', isCorrect: false };
    const entries = sandbox.AnswerComparisonUtils.getNormalizedEntries({
        answers: { q2: 'D' },
        correctAnswerMap: { q2: 'D' },
        answerComparison: { q2: comparison },
        scoreInfo: { details: { q2: { ...comparison, isCorrect: true } } }
    });
    assert.strictEqual(entries[0].isCorrect, false, 'false is a valid stored verdict and must not fall through');
}

function testStaleSnapshotsCannotSupplyAVerdict() {
    const sandbox = createUtilsSandbox();
    for (const staleDetail of [
        { userAnswer: ['A', 'B'], correctAnswer: 'D', isCorrect: true },
        { userAnswer: ['D', 'E'], correctAnswer: ['D', 'A'], isCorrect: true },
        { userAnswer: ['D', 'E'], isCorrect: true }
    ]) {
        const entries = sandbox.AnswerComparisonUtils.getNormalizedEntries({
            answers: { q2: ['D', 'E'] },
            correctAnswerMap: { q2: 'D' },
            answerComparison: { q2: { userAnswer: ['D', 'E'], correctAnswer: 'D' } },
            scoreInfo: { details: { q2: staleDetail } }
        });
        assert.strictEqual(entries[0].isCorrect, false, 'both stored answer snapshots must match the displayed row');
    }
}

function testStaleVerdictFallsThroughToMatchingSnapshot() {
    const sandbox = createUtilsSandbox();
    const record = buildSplitKeyRecord();
    record.answerComparison.q2.correctAnswer = 'A';
    record.answerComparison.q2.isCorrect = false;
    const entries = sandbox.AnswerComparisonUtils.getNormalizedEntries(record);
    assert.strictEqual(entries[1].isCorrect, true, 'a stale boolean must not hide a later valid submission verdict');
}

function testSnapshotsAreCheckedAfterLetterKeyAlignment() {
    const sandbox = createUtilsSandbox();
    for (const [correctAnswer, expectedVerdict] of [['D', true], ['A', false]]) {
        const entries = sandbox.AnswerComparisonUtils.getNormalizedEntries({
            answers: { qa: ['D', 'E'] },
            correctAnswerMap: { q1: correctAnswer },
            answerComparison: { qa: { userAnswer: ['D', 'E'], correctAnswer: 'D', isCorrect: true } }
        });
        assert.strictEqual(entries.length, 1, 'letter answers should align to the numeric row');
        assert.strictEqual(entries[0].isCorrect, expectedVerdict, 'the verdict must match the final aligned answer snapshot');
    }
}

const tests = [
    testSplitKeyPartialCreditSurvivesHistoryDetail,
    testSingleKeyArrayPartialStaysNonPerfect,
    testFallsBackToRecomputeWhenNoStoredFlag,
    testStoredFlagFromScoreDetailsIsHonoured,
    testStaleCorrectAnswerSnapshotFallsBackInModal,
    testDisplayGeneratedVerdictDoesNotOverrideMatchingCore,
    testDisplayGeneratedVerdictDoesNotMaskStoredCredit,
    testMissingVerdictsFallThroughEverySource,
    testStoredFalseKeepsSourcePrecedence,
    testStaleSnapshotsCannotSupplyAVerdict,
    testStaleVerdictFallsThroughToMatchingSnapshot,
    testSnapshotsAreCheckedAfterLetterKeyAlignment
];

let passed = 0;
const failures = [];
for (const test of tests) {
    try {
        test();
        passed += 1;
    } catch (error) {
        failures.push({ name: test.name, message: error.message });
    }
}

if (failures.length) {
    failures.forEach((failure) => {
        console.error(`FAIL ${failure.name}: ${failure.message}`);
    });
    console.error(`${failures.length}/${tests.length} failed`);
    process.exit(1);
}

console.log(JSON.stringify({
    status: 'pass',
    detail: `${passed}/${tests.length} answer-comparison multi-choice history checks passed`
}));
