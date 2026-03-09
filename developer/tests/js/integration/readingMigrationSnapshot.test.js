#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../../..');

const SOURCE_DIR = path.join(REPO_ROOT, 'developer', 'reading-exams');
const MANIFEST_FILE = path.join(REPO_ROOT, 'assets', 'generated', 'reading-exams', 'manifest.js');
const REVIEW_FILE = path.join(REPO_ROOT, 'developer', 'tests', 'fixtures', 'reading-crosswalk-review.json');

function emitResult(payload) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadManifest(filePath) {
    const context = { window: {} };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(filePath, 'utf8'), context, { filename: filePath });
    return context.window.__READING_EXAM_MANIFEST__ || {};
}

try {
    const sourceFiles = fs.readdirSync(SOURCE_DIR)
        .filter((name) => name.endsWith('.json') && name !== 'reading-exam-source.schema.json')
        .sort((a, b) => a.localeCompare(b, 'en'));
    const manifest = loadManifest(MANIFEST_FILE);
    const review = readJson(REVIEW_FILE);
    const manifestKeys = Object.keys(manifest).sort((a, b) => a.localeCompare(b, 'en'));
    const manualQueue = Array.isArray(review.manualReviewQueue) ? review.manualReviewQueue : [];
    const missingReviewReason = manualQueue
        .filter((item) => !item || typeof item.reviewReason !== 'string' || !item.reviewReason.trim())
        .map((item) => item?.examId || item?.title || 'unknown');
    const unmigrated = Array.isArray(review.unmigratedReadingExams) ? review.unmigratedReadingExams : [];
    const unmigratedIds = unmigrated.map((item) => item.examId).filter(Boolean);
    const manualOnly = unmigrated.filter((item) => item.reviewReason === 'manual_mapping_needed');

    const assertions = [
        [sourceFiles.length === 191, `developer/reading-exams 数量应为 191，实际 ${sourceFiles.length}`],
        [manifestKeys.length === 191, `manifest 条目数应为 191，实际 ${manifestKeys.length}`],
        [review.unmigratedCount === 1, `unmigratedCount 应为 1，实际 ${review.unmigratedCount}`],
        [unmigratedIds.length === 1 && unmigratedIds[0] === 'p2-high-26', `唯一未迁移题应为 p2-high-26，实际 ${JSON.stringify(unmigratedIds)}`],
        [manualOnly.length === 1 && manualOnly[0].examId === 'p2-high-26', 'manual_mapping_needed 未正确单独暴露'],
        [missingReviewReason.length === 0, `manualReviewQueue 缺少 reviewReason: ${JSON.stringify(missingReviewReason)}`],
        [manifestKeys.includes('p3-medium-169'), 'manifest 缺少 p3-medium-169'],
        [!manifestKeys.includes('p2-high-26'), 'p2-high-26 不应进入 manifest'],
    ];

    const failures = assertions.filter(([passed]) => !passed).map(([, detail]) => detail);
    emitResult({
        status: failures.length ? 'fail' : 'pass',
        passed: assertions.length - failures.length,
        total: assertions.length,
        detail: failures.length ? failures.join(' | ') : 'reading migration snapshot ok'
    });
} catch (error) {
    emitResult({
        status: 'fail',
        passed: 0,
        total: 1,
        detail: error && error.message ? error.message : String(error)
    });
    process.exit(1);
}
