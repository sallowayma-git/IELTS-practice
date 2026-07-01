#!/usr/bin/env node
'use strict';

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const results = [];

function loadExporter() {
    const windowStub = {};
    const sandbox = {
        window: windowStub,
        document: {
            getElementById() { return null; },
            createElement() {
                return {
                    click() {}
                };
            },
            body: {
                appendChild() {},
                removeChild() {}
            }
        },
        console: {
            log() {},
            warn() {},
            error() {},
            info() {},
            debug() {}
        },
        Blob: function Blob() {},
        URL: { createObjectURL() { return ''; }, revokeObjectURL() {} },
        setTimeout,
        clearTimeout,
        Promise,
        Date,
        JSON,
        Object,
        Array,
        String,
        Number,
        Math
    };
    sandbox.globalThis = sandbox.window;
    vm.createContext(sandbox);
    const coreSource = fs.readFileSync(path.join(repoRoot, 'js/core/practiceCore.js'), 'utf8');
    vm.runInContext(coreSource, sandbox, { filename: 'js/core/practiceCore.js' });
    const source = fs.readFileSync(path.join(repoRoot, 'js/utils/markdownExporter.js'), 'utf8');
    vm.runInContext(source, sandbox, { filename: 'js/utils/markdownExporter.js' });
    return new windowStub.MarkdownExporter();
}

function recordResult(name, passed, detail) {
    results.push({ name, passed, detail, timestamp: new Date().toISOString() });
}

async function testNumericCorrectAnswersAreNotAnswerMaps() {
    const exporter = loadExporter();
    const correctAnswers = exporter.getCorrectAnswers({
        id: 'numeric-correct',
        correctAnswers: 7,
        realData: {
            correctAnswers: 7
        }
    });
    assert.strictEqual(Object.keys(correctAnswers).length, 0, '数字型 correctAnswers 表示答对数量，不能当正确答案表导出');

    const merged = exporter.mergeComparisonWithCorrections({
        id: 'numeric-correct',
        correctAnswers: 7,
        correctAnswerMap: null,
        answerComparison: {
            q1: { userAnswer: 'A', correctAnswer: '', isCorrect: false }
        },
        realData: {
            correctAnswers: 7
        }
    });
    assert.strictEqual(merged.q1.correctAnswer, '', '数字型 correctAnswers 不能被 Markdown comparison 合并逻辑当答案来源');
    recordResult('numeric correctAnswers are ignored by Markdown answer-map helpers', true, {
        correctAnswerKeys: Object.keys(correctAnswers),
        mergedCorrectAnswer: merged.q1.correctAnswer
    });
}

async function testPlainCorrectAnswerMapsStillWork() {
    const exporter = loadExporter();
    const correctAnswers = exporter.getCorrectAnswers({
        id: 'map-correct',
        correctAnswers: { q1: 'A' },
        realData: {
            correctAnswers: 7
        }
    });
    assert.strictEqual(correctAnswers.q1, 'A', 'plain object correctAnswers 仍应作为答案表');

    const merged = exporter.mergeComparisonWithCorrections({
        id: 'map-correct',
        correctAnswers: { q1: 'A' },
        answerComparison: {
            q1: { userAnswer: 'B', correctAnswer: '', isCorrect: false }
        }
    });
    assert.strictEqual(merged.q1.correctAnswer, 'A', 'plain object correctAnswers 仍应补全 comparison');
    recordResult('plain correctAnswers maps still enrich Markdown comparisons', true, {
        mergedCorrectAnswer: merged.q1.correctAnswer
    });
}

async function testCanonicalCorrectAnswerMapWins() {
    const exporter = loadExporter();
    const record = {
        id: 'canonical-conflict',
        answers: { q1: 'A' },
        correctAnswerMap: { q1: 'A' },
        correctAnswers: { q1: 'B' },
        answerComparison: {
            q1: { userAnswer: 'A', correctAnswer: 'B', isCorrect: false }
        },
        realData: {
            correctAnswerMap: { q1: 'A' },
            correctAnswers: { q1: 'B' }
        }
    };

    const correctAnswers = exporter.getCorrectAnswers(record);
    assert.strictEqual(correctAnswers.q1, 'A', 'Markdown 正确答案表必须优先使用 canonical correctAnswerMap');

    const merged = exporter.mergeComparisonWithCorrections(record);
    assert.strictEqual(merged.q1.correctAnswer, 'B', '已有 comparison 不应被合并函数静默改写');

    const table = exporter.generateTableFromComparison(record.answerComparison, record);
    assert(table.includes('| 1 | A | A | ✓ |'), 'Markdown 表格应按 canonical correctAnswerMap 显示正确答案并重算结果');
    recordResult('canonical correctAnswerMap wins in Markdown table generation', true, {
        correctAnswer: correctAnswers.q1
    });
}

async function runAllTests() {
    const tests = [
        testNumericCorrectAnswersAreNotAnswerMaps,
        testPlainCorrectAnswerMapsStillWork,
        testCanonicalCorrectAnswerMapWins
    ];
    for (const testFn of tests) {
        try {
            await testFn();
        } catch (error) {
            recordResult(testFn.name, false, { error: error.message, stack: error.stack });
        }
    }
}

function printJsonReport() {
    const totalTests = results.length;
    const passedTests = results.filter(result => result.passed).length;
    const failedTests = totalTests - passedTests;
    const report = {
        status: failedTests === 0 ? 'pass' : 'fail',
        detail: `${passedTests}/${totalTests} 测试通过`,
        summary: { totalTests, passedTests, failedTests },
        failedTests: results.filter(result => !result.passed)
    };
    console.log(JSON.stringify(report, null, 2));
    return report;
}

(async function main() {
    await runAllTests();
    const report = printJsonReport();
    process.exit(report.status === 'pass' ? 0 : 1);
})();
