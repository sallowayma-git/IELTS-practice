#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function loadScript(relativePath, context) {
    const fullPath = path.join(repoRoot, relativePath);
    const source = fs.readFileSync(fullPath, 'utf8');
    vm.runInContext(source, context, { filename: relativePath });
}

function stripComments(source) {
    return String(source || '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
}

function isForwardOnlySource(source) {
    const code = stripComments(source);
    const normalized = code.replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return true;
    }
    const reExportOnly = /^export\s+(\*\s+from|\{[^}]+\}\s+from)\s+['"][^'"]+['"]\s*;?\s*$/;
    if (reExportOnly.test(normalized)) {
        return true;
    }
    const commonJsProxy = /^module\.exports\s*=\s*require\(['"][^'"]+['"]\)\s*;?\s*$/;
    if (commonJsProxy.test(normalized)) {
        return true;
    }
    const functionCount = (code.match(/\bfunction\b/g) || []).length;
    const directAliasPattern = /(window|globalThis|global)\.[A-Za-z_$][\w$]*\s*=\s*(window|globalThis|global)\.[A-Za-z_$][\w$]*\s*;?/;
    const objectAssignAliasPattern = /(window|globalThis|global)\.[A-Za-z_$][\w$]*\s*=\s*Object\.assign\(\{\}\s*,\s*(window|globalThis|global)\.[A-Za-z_$][\w$]*\s*\|\|\s*\{\}\s*\)\s*;?/;
    return functionCount <= 1 && (directAliasPattern.test(code) || objectAssignAliasPattern.test(code));
}

function createHarness() {
    const windowStub = {};
    const silentConsole = { log() {}, warn() {}, error() {}, info() {} };
    const sandbox = { window: windowStub, console: silentConsole };
    sandbox.globalThis = sandbox.window;
    const context = vm.createContext(sandbox);
    loadScript('js/app/examActions.js', context);
    return sandbox.window.ExamFilterService;
}

function createExams() {
    return [
        { id: 'p1-09', title: 'Listening to the Ocean 海洋探测', category: 'P1', type: 'reading', path: 'Reading/P1/a.html', frequency: 'high' },
        { id: 'r1-other', title: 'Reading Other', category: 'P1', type: 'reading', path: 'Reading/P1/b.html', frequency: 'ultra-high' },
        { id: 'r1-dup', title: 'Reading Other', category: 'P1', type: 'reading', path: 'Reading/P1/c.html', frequency: 'low' },
        { id: 'l1', title: 'Listening P1', category: 'P1', type: 'listening', path: 'Listening/P1/a.html', frequency: 'medium' },
        { id: 'p2', title: 'P2 Reading', category: 'P2', type: 'reading', path: 'Reading/P2/a.html', frequency: 'low' },
        { id: 'freq-a', title: 'Freq A', category: 'P3', type: 'reading', path: 'ListeningPractice/100 P1/P1 高频（35）/a.html', frequency: 'high' },
        { id: 'freq-b', title: 'Freq B', category: 'P3', type: 'reading', path: 'ListeningPractice/100 P1/P1 高频（35）/b.html', frequency: 'medium' }
    ];
}

function testTypeAndCategoryFiltering(service) {
    const exams = createExams();
    const result = service.filterExams(exams, {
        activeCategory: 'P1',
        activeExamType: 'reading'
    });
    assert.strictEqual(result.length, 2, 'P1 reading 应保留去重后的两条');
    assert.strictEqual(result[0].id, 'p1-09', '应命中置顶题目');
}

function testFallbackCategoryInFrequencyMode(service) {
    const exams = createExams();
    const result = service.filterExams(exams, {
        activeCategory: 'P9',
        activeExamType: 'reading',
        browseFilterMode: 'frequency-p1',
        basePathFilter: 'ListeningPractice/100 P1'
    });
    assert.strictEqual(result.length, 2, '频率模式下分类无命中时应退回 path 命中项');
    assert(result.every((item) => item.path.includes('ListeningPractice/100 P1')));
}

function testFrequencySort(service) {
    const exams = createExams();
    const result = service.filterExams(exams, {
        activeCategory: 'all',
        activeExamType: 'reading',
        sortMode: 'frequency-desc'
    });
    assert.strictEqual(result[0].frequency, 'ultra-high', '频率降序应把 ultra-high 放在最前');
}

function testInvalidInput(service) {
    const result = service.filterExams(null, null);
    assert(Array.isArray(result), '非法输入应返回数组');
    assert.strictEqual(result.length, 0, '非法输入应返回空数组');
}

function testExamFilterHostIsNotForwardOnlyStub() {
    const source = fs.readFileSync(
        path.join(repoRoot, 'js/app/examActions.js'),
        'utf8'
    );
    assert.strictEqual(
        isForwardOnlySource(source),
        false,
        'examActions.js 不允许退化成转发-only 薄壳'
    );
}

function main() {
    const service = createHarness();
    assert(service, 'ExamFilterService 应该挂到 window');
    assert.strictEqual(typeof service.filterExams, 'function', 'filterExams 应为函数');

    testTypeAndCategoryFiltering(service);
    testFallbackCategoryInFrequencyMode(service);
    testFrequencySort(service);
    testInvalidInput(service);
    testExamFilterHostIsNotForwardOnlyStub();

    console.log(JSON.stringify({
        status: 'pass',
        detail: 'examFilterService tests passed'
    }, null, 2));
}

main();
