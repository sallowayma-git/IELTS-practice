#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const SOURCE_DIR = path.join(REPO_ROOT, 'developer', 'reading-exams');

const ALLOWED_GROUP_KINDS = new Set([
    'single_choice',
    'multi_choice',
    'true_false_not_given',
    'yes_no_not_given',
    'matching',
    'classification',
    'summary_completion',
    'table_completion',
    'diagram_completion',
    'short_answer',
    'sentence_completion'
]);

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeQuestionId(rawValue) {
    if (rawValue == null) return null;
    const match = String(rawValue).trim().toLowerCase().match(/q(\d+)/);
    return match ? `q${match[1]}` : null;
}

function validateRecord(record, filePath) {
    const errors = [];
    if (record.schemaVersion !== 'ReadingExamSourceV1') {
        errors.push('schemaVersion 非 ReadingExamSourceV1');
    }
    if (!record.examId) {
        errors.push('examId 缺失');
    }
    if (!record.meta || !record.meta.title || !record.meta.category) {
        errors.push('meta.title/category 缺失');
    }
    if (!record.passage || !Array.isArray(record.passage.blocks) || !record.passage.blocks.length) {
        errors.push('passage.blocks 缺失');
    }
    if (!Array.isArray(record.questionGroups) || !record.questionGroups.length) {
        errors.push('questionGroups 缺失');
    }
    if (!record.answerKey || typeof record.answerKey !== 'object' || Array.isArray(record.answerKey)) {
        errors.push('answerKey 非法');
    }

    const questionIds = Object.keys(record.answerKey || {})
        .map((key) => normalizeQuestionId(key))
        .filter(Boolean)
        .sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)));
    const coveredQuestionIds = new Set();

    if (!questionIds.length) {
        errors.push('answerKey 为空');
    }

    for (let index = 0; index < questionIds.length; index += 1) {
        const expected = `q${index + 1}`;
        if (questionIds[index] !== expected) {
            errors.push(`题号不连续: 期望 ${expected}，实际 ${questionIds[index]}`);
            break;
        }
    }

    for (const group of record.questionGroups || []) {
        if (!ALLOWED_GROUP_KINDS.has(group.kind)) {
            errors.push(`题组类型非法: ${group.kind}`);
        }
        if (!group.groupId) {
            errors.push('题组缺少 groupId');
        }
        if (!Array.isArray(group.questionIds)) {
            errors.push(`题组 ${group.groupId} 缺少 questionIds`);
            continue;
        }
        if (!group.questionIds.length) {
            errors.push(`题组 ${group.groupId} questionIds 为空`);
            continue;
        }
        for (const questionId of group.questionIds) {
            if (!Object.prototype.hasOwnProperty.call(record.answerKey || {}, questionId)) {
                errors.push(`题组 ${group.groupId} 包含未定义题号: ${questionId}`);
                continue;
            }
            coveredQuestionIds.add(questionId);
        }
    }

    for (const questionId of questionIds) {
        if (!coveredQuestionIds.has(questionId)) {
            errors.push(`题号未被任何题组覆盖: ${questionId}`);
        }
    }

    if (!record.sourceRefs || !record.sourceRefs.shuiPdf) {
        errors.push('sourceRefs.shuiPdf 缺失');
    } else if (record.sourceRefs.primaryProvider && !['shui', 'ielts'].includes(record.sourceRefs.primaryProvider)) {
        errors.push(`sourceRefs.primaryProvider 非法: ${record.sourceRefs.primaryProvider}`);
    }

    if (record.sourceRefs) {
        const hasPrimaryPair = Boolean(record.sourceRefs.primaryHtml && record.sourceRefs.primaryProvider);
        const hasLegacyShuiHtml = Boolean(record.sourceRefs.shuiHtml);
        if (!hasPrimaryPair && !hasLegacyShuiHtml) {
            errors.push('sourceRefs.primaryHtml/primaryProvider 或 sourceRefs.shuiHtml 至少保留一组');
        }
        if ((record.sourceRefs.primaryHtml && !record.sourceRefs.primaryProvider)
            || (!record.sourceRefs.primaryHtml && record.sourceRefs.primaryProvider)) {
            errors.push('sourceRefs.primaryHtml 与 primaryProvider 必须同时出现');
        }
    }

    if (!record.audit || !record.audit.matchStatus) {
        errors.push('audit.matchStatus 缺失');
    }

    return errors.map((message) => `${path.relative(REPO_ROOT, filePath)}: ${message}`);
}

function main() {
    const files = fs.readdirSync(SOURCE_DIR)
        .filter((name) => name.endsWith('.json') && name !== 'reading-exam-source.schema.json')
        .sort((a, b) => a.localeCompare(b, 'en'));

    const errors = [];
    for (const fileName of files) {
        const filePath = path.join(SOURCE_DIR, fileName);
        const record = readJson(filePath);
        errors.push(...validateRecord(record, filePath));
    }

    if (errors.length) {
        process.stderr.write(`${errors.join('\n')}\n`);
        process.exit(1);
    }

    process.stdout.write(`Validated ${files.length} reading JSON source files.\n`);
}

main();
