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

function loadHistoryRenderer() {
    const windowStub = {};
    const documentStub = {
        createElement() {
            return {
                className: '',
                dataset: {},
                style: {},
                appendChild() {},
                setAttribute() {},
                addEventListener() {},
                removeEventListener() {}
            };
        },
        createTextNode(text) {
            return { textContent: String(text) };
        }
    };
    const sandbox = {
        window: windowStub,
        document: documentStub,
        Node: function Node() {},
        console
    };
    sandbox.globalThis = sandbox.window;
    vm.createContext(sandbox);
    const source = fs.readFileSync(path.join(repoRoot, 'js/views/legacyViewBundle.js'), 'utf8');
    vm.runInContext(source, sandbox, { filename: 'js/views/legacyViewBundle.js' });
    return windowStub.PracticeHistoryRenderer;
}

function recordResult(name, passed, detail) {
    results.push({ name, passed, detail, timestamp: new Date().toISOString() });
}

function baseRecord(overrides = {}) {
    return {
        id: 'record-1',
        sessionId: 'session-1',
        examId: 'reading-p1',
        title: 'Old title',
        date: '2026-05-23T10:00:00.000Z',
        percentage: 80,
        duration: 120,
        correctAnswers: 8,
        totalQuestions: 10,
        suiteEntries: [
            { examId: 'reading-p1' }
        ],
        ...overrides
    };
}

async function testTitleChangesAffectSignature() {
    const renderer = loadHistoryRenderer();
    const oldSig = renderer.helpers.computeRecordsSignature([baseRecord()]);
    const newSig = renderer.helpers.computeRecordsSignature([baseRecord({ title: 'New title' })]);
    assert.notStrictEqual(oldSig, newSig, '历史列表签名必须包含展示标题');
    recordResult('practice history signature tracks title changes', true, { oldSig, newSig });
}

async function testSuiteEntriesChangesAffectSignature() {
    const renderer = loadHistoryRenderer();
    const oldSig = renderer.helpers.computeRecordsSignature([baseRecord()]);
    const newSig = renderer.helpers.computeRecordsSignature([
        baseRecord({
            suiteEntries: [
                { examId: 'reading-p1' },
                { examId: 'reading-p2' }
            ]
        })
    ]);
    assert.notStrictEqual(oldSig, newSig, '历史列表签名必须包含 suiteEntries 展示变化');
    recordResult('practice history signature tracks suite entry changes', true, { oldSig, newSig });
}

async function testUpdatedAtChangesAffectSignature() {
    const renderer = loadHistoryRenderer();
    const oldSig = renderer.helpers.computeRecordsSignature([baseRecord({ updatedAt: '2026-05-23T10:00:00.000Z' })]);
    const newSig = renderer.helpers.computeRecordsSignature([baseRecord({ updatedAt: '2026-05-23T10:05:00.000Z' })]);
    assert.notStrictEqual(oldSig, newSig, '历史列表签名必须包含 updatedAt');
    recordResult('practice history signature tracks updatedAt changes', true, { oldSig, newSig });
}

async function runAllTests() {
    const tests = [
        testTitleChangesAffectSignature,
        testSuiteEntriesChangesAffectSignature,
        testUpdatedAtChangesAffectSignature
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
