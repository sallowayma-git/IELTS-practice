'use strict';

/**
 * 记录元数据补全契约测试
 * AnswerComparisonUtils 只能使用记录快照和调用方显式解析出的 exam definition。
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AnswerComparisonUtils = require(path.join(__dirname, '..', '..', '..', 'js', 'utils', 'answerComparisonUtils.js'));

const results = [];

function recordResult(name, passed, detail) {
    results.push({ name, passed, detail, timestamp: new Date().toISOString() });
}

function assertStrictEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message} (expected: ${expected}, actual: ${actual})`);
    }
}

function assertTruthy(value, message) {
    if (!value) {
        throw new Error(message);
    }
}

async function testExplicitExamDefinitionFillsMissingMetadata() {
    const testName = '显式 exam definition 填充缺失 metadata';
    const record = {
        examId: 'source-exam'
    };
    const examDefinition = {
        id: 'source-exam',
        title: 'Source title',
        category: 'P4',
        type: 'listening',
        frequency: 'high'
    };
    const enriched = AnswerComparisonUtils.withEnrichedMetadata(record, examDefinition);

    assertStrictEqual(enriched.metadata.examTitle, 'Source title', '应从显式 exam definition 补齐 examTitle');
    assertStrictEqual(enriched.metadata.category, 'P4', '应从显式 exam definition 补齐 category');
    assertStrictEqual(enriched.metadata.frequency, 'high', '应透传频次信息');
    assertStrictEqual(enriched.category, 'P4', '记录应同步更新 category');
    assertTruthy(enriched.metadata.__enrichedMetadata, 'metadata 应标记为已填充');

    recordResult(testName, true, { enriched });
}

async function testSavedMetadataWinsOverResolvedExam() {
    const testName = '保存的 metadata 优先于解析出的题库条目';
    const record = {
        examId: 'shared-id',
        title: 'Saved title',
        metadata: {
            examTitle: 'Saved title',
            category: 'P1',
            frequency: 'saved-frequency'
        }
    };
    const conflictingExam = {
        id: 'shared-id',
        title: 'Current library title',
        category: 'P4',
        frequency: 'current-frequency'
    };
    const enriched = AnswerComparisonUtils.withEnrichedMetadata(record, conflictingExam);

    assertStrictEqual(enriched.metadata.category, 'P1', '显式题库条目不得覆盖历史 category');
    assertStrictEqual(enriched.metadata.examTitle, 'Saved title', '显式题库条目不得覆盖历史 title');
    assertStrictEqual(enriched.metadata.frequency, 'saved-frequency', '显式题库条目不得覆盖历史 frequency');

    recordResult(testName, true, { enriched });
}

async function testCategoryInferenceFromId() {
    const testName = 'examId 中的类别推断';

    const record = {
        examId: 'custom_reading_p2_section1',
        title: 'Reading drill'
    };

    const enriched = AnswerComparisonUtils.withEnrichedMetadata(record);

    assertStrictEqual(enriched.metadata.category, 'P2', '应从 examId 推断出 P2');
    assertStrictEqual(enriched.category, 'P2', '记录应同步更新推断的 category');

    recordResult(testName, true, { enriched });
}

async function testEnrichedMetadataGuard() {
    const testName = '__enrichedMetadata 重入保护';

    const record = {
        examId: 'p3-saved-record',
        metadata: {
            category: 'P3',
            examTitle: 'Preserved title',
            frequency: 'weekly',
            __enrichedMetadata: true
        }
    };

    const enriched = AnswerComparisonUtils.withEnrichedMetadata(record);

    assertStrictEqual(enriched.metadata.category, 'P3', '已有 category 不应被覆盖');
    assertStrictEqual(enriched.metadata.examTitle, 'Preserved title', '已有 examTitle 不应被覆盖');
    assertStrictEqual(enriched.metadata.frequency, 'weekly', '已有 frequency 不应被覆盖');
    assertStrictEqual(enriched.metadata.__enrichedMetadata, true, '标记应保持 true');

    recordResult(testName, true, { enriched });
}

async function testUnknownFallbacks() {
    const testName = '无索引信息时的兜底';

    const record = {};

    const enriched = AnswerComparisonUtils.withEnrichedMetadata(record);

    assertStrictEqual(enriched.metadata.category, 'Unknown', '无线索时 category 应为 Unknown');
    assertStrictEqual(enriched.metadata.frequency, 'unknown', '无频次信息时 frequency 应为 unknown');
    assertStrictEqual(enriched.metadata.examTitle, '未知题目', '无标题时应返回默认 examTitle');

    recordResult(testName, true, { enriched });
}

async function runAllTests() {
    const suite = [
        testExplicitExamDefinitionFillsMissingMetadata,
        testSavedMetadataWinsOverResolvedExam,
        testCategoryInferenceFromId,
        testEnrichedMetadataGuard,
        testUnknownFallbacks
    ];

    for (const testFn of suite) {
        try {
            await testFn();
        } catch (error) {
            recordResult(testFn.name || 'unknown', false, { error: error.message });
        }
    }
}

function printJsonReport() {
    const totalTests = results.length;
    const passedTests = results.filter(r => r.passed).length;
    const failedTests = totalTests - passedTests;

    const output = {
        status: failedTests === 0 ? 'pass' : 'fail',
        detail: `${passedTests}/${totalTests} 测试通过`,
        summary: {
            totalTests,
            passedTests,
            failedTests,
            successRate: `${((passedTests / Math.max(totalTests, 1)) * 100).toFixed(1)}%`,
            timestamp: new Date().toISOString()
        },
        failedTests: results
            .filter(r => !r.passed)
            .map(r => ({ name: r.name, error: r.detail.error }))
    };

    console.log(JSON.stringify(output, null, 2));
    return output;
}

(async function main() {
    try {
        const originalLog = console.log;
        console.log = function noop() {};

        await runAllTests();

        console.log = originalLog;
        const report = printJsonReport();
        process.exit(report.status === 'pass' ? 0 : 1);
    } catch (error) {
        console.error(JSON.stringify({
            status: 'fail',
            detail: `测试执行失败: ${error.message}`,
            error: error.stack
        }, null, 2));
        process.exit(1);
    }
})();
