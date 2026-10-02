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

function loadHistoryRenderer(environment = {}) {
    const windowStub = environment.window || {};
    const documentStub = environment.document || {
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
        Node: environment.Node || function Node() {},
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

async function testHistoryMeasurementBatchesWritesBeforeReads() {
    const events = [];
    const wrappers = [];
    class FakeNode {
        constructor(height = 0) { this.style = {}; this.height = height; }
        appendChild(node) { events.push(['append', node.height]); }
        remove() { events.push(['remove']); }
        get offsetHeight() { events.push(['read', this.height]); return this.height; }
    }
    const container = { clientWidth: 1000, appendChild() {} };
    const renderer = loadHistoryRenderer({
        window: {
            innerWidth: 1200,
            VirtualScroller: class VirtualScroller {
                constructor(container, records, factory, options) { this.options = options; }
            }
        },
        document: { createElement() { const node = new FakeNode(); wrappers.push(node); return node; } },
        Node: FakeNode
    });
    const scroller = renderer.renderList(container, Array.from({ length: 35 }, (_, i) => i), {
        itemFactory(record) { return new FakeNode(100 + record); }
    });
    const firstRead = events.findIndex(event => event[0] === 'read');
    assert.strictEqual(firstRead, 30, 'All sample insertions must precede geometry reads');
    assert.strictEqual(events.slice(firstRead, -1).every(event => event[0] === 'read'), true,
        'Geometry reads must not interleave DOM mutations');
    assert.strictEqual(scroller.options.itemHeight, 137, 'Tallest sample plus safety margin must be retained');
    assert.deepStrictEqual(events.at(-1), ['remove']);
    assert.strictEqual(wrappers[0].style.visibility, 'hidden');
    events.length = 0;
    assert.throws(() => renderer.renderList(container, [1, 2], {
        itemFactory() { throw new Error('sample failed'); }
    }), /sample failed/);
    assert.deepStrictEqual(events.at(-1), ['remove'], 'Failed sampling must remove its hidden wrapper');
    recordResult('history samples batch DOM writes before geometry reads and clean up after errors', true, {});
}

async function runAllTests() {
    const tests = [
        testTitleChangesAffectSignature,
        testSuiteEntriesChangesAffectSignature,
        testUpdatedAtChangesAffectSignature,
        testHistoryMeasurementBatchesWritesBeforeReads
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
