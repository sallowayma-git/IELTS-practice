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
    const sandbox = {};
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);

    loadScript('js/utils/answerMatchCore.js', context);

    // getNormalizedEntries 依赖 PracticeCore.contracts.resolveRecordCorrectAnswerMap
    sandbox.PracticeCore = {
        contracts: {
            resolveRecordCorrectAnswerMap(record) {
                return (record && record.correctAnswerMap) || {};
            }
        }
    };

    loadScript('js/utils/answerComparisonUtils.js', context);
    return sandbox;
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
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

const tests = [
    testSplitKeyPartialCreditSurvivesHistoryDetail,
    testSingleKeyArrayPartialStaysNonPerfect,
    testFallsBackToRecomputeWhenNoStoredFlag,
    testStoredFlagFromScoreDetailsIsHonoured
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
