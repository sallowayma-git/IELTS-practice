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
    windowStub.DOMAdapter = {
        create(tag, attributes = {}, children = []) {
            attributes = attributes || {};
            const node = {
                tag,
                attributes,
                className: attributes.className || '',
                dataset: { ...(attributes.dataset || {}) },
                children: (Array.isArray(children) ? children : [children]).filter(Boolean),
                classList: {
                    add(...classes) {
                        node.className = [node.className, ...classes].filter(Boolean).join(' ');
                    }
                },
                appendChild(child) { node.children.push(child); },
                querySelector() { return null; },
                setAttribute() {}
            };
            return node;
        }
    };
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

async function testInterruptedStatusAffectsSignature() {
    const renderer = loadHistoryRenderer();
    const completedSig = renderer.helpers.computeRecordsSignature([baseRecord({ status: 'completed' })]);
    const interruptedSig = renderer.helpers.computeRecordsSignature([baseRecord({
        status: 'interrupted',
        historyRecordKind: 'interrupted'
    })]);
    assert.notStrictEqual(completedSig, interruptedSig, '历史列表签名必须区分正式成绩与中断恢复记录');
    recordResult('practice history signature tracks interrupted status', true, { completedSig, interruptedSig });
}

function findNode(root, predicate) {
    if (!root || typeof root !== 'object') return null;
    if (predicate(root)) return root;
    for (const child of root.children || []) {
        const match = findNode(child, predicate);
        if (match) return match;
    }
    return null;
}

async function testInterruptedCardUsesRecoveryActionsInsteadOfScore() {
    const renderer = loadHistoryRenderer();
    const card = renderer.createRecordNode(baseRecord({
        id: 'interrupted-card',
        status: 'interrupted',
        historyRecordKind: 'interrupted'
    }), { bulkDeleteMode: true, selectedRecords: new Set() });

    assert(card.className.includes('history-item-interrupted'), '中断记录卡片必须有独立视觉状态');
    assert.strictEqual(card.dataset.recordKind, 'interrupted');
    assert(!card.className.includes('history-item-selectable'), '中断记录不能进入正式成绩批量删除选择');
    const statusLabel = findNode(card, (node) => node.className === 'record-interrupted-label');
    assert(statusLabel, '中断记录必须显示状态而不是伪造 0% 成绩');
    assert(statusLabel.children.includes('中断'));
    const deleteButton = findNode(card, (node) => node.dataset?.recordAction === 'delete');
    assert(deleteButton, '中断记录在批量模式下仍应提供明确的独立删除动作');
    assert.strictEqual(deleteButton.dataset.recordKind, 'interrupted');
    recordResult('interrupted history card uses recovery-specific actions', true, { recordKind: card.dataset.recordKind });
}

async function runAllTests() {
    const tests = [
        testTitleChangesAffectSignature,
        testSuiteEntriesChangesAffectSignature,
        testUpdatedAtChangesAffectSignature,
        testInterruptedStatusAffectsSignature,
        testInterruptedCardUsesRecoveryActionsInsteadOfScore
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
