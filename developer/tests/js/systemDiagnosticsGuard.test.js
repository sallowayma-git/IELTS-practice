#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import test from 'node:test';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'js', 'components', 'SystemDiagnostics.js'), 'utf8');

function loadDiagnostics() {
    const windowStub = {
        location: {
            origin: 'http://127.0.0.1:3000',
            protocol: 'http:',
            href: 'http://127.0.0.1:3000/'
        },
        examIndex: [],
        addEventListener() {},
        removeEventListener() {}
    };
    const context = {
        window: windowStub,
        console: { log() {}, warn() {}, error() {}, info() {} },
        Date,
        Map,
        Set,
        String,
        Number,
        Array,
        Promise,
        Math,
        URL,
        setInterval() {
            return 1;
        },
        clearInterval() {}
    };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'SystemDiagnostics.js' });
    return windowStub.SystemDiagnostics;
}

test('system diagnostics caps validation count and validation concurrency', async () => {
    const SystemDiagnostics = loadDiagnostics();
    const diagnostics = new SystemDiagnostics();
    let active = 0;
    let maxActive = 0;
    diagnostics.validateExamFile = async (exam) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active -= 1;
        diagnostics.successCount += 1;
        return { id: exam.id, status: 'success' };
    };

    const exams = Array.from({ length: 250 }, (_, index) => ({ id: `exam-${index}` }));
    const report = await diagnostics.validateAllExams(exams);

    assert.equal(report.summary.total, 200);
    assert.equal(report.allResults.length, 200);
    assert.equal(report.summary.successRate, 100);
    assert(maxActive <= 10, `validation concurrency should be capped, saw ${maxActive}`);
});

test('system diagnostics normalizes communication ids and non-positive concurrency', async () => {
    const SystemDiagnostics = loadDiagnostics();
    const diagnostics = new SystemDiagnostics();
    const calls = [];
    let active = 0;
    let maxActive = 0;
    diagnostics.testExamCommunication = async (examId) => {
        calls.push(examId);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active -= 1;
        return { examId, success: true };
    };

    const ids = ['', null, ...Array.from({ length: 40 }, (_, index) => ` exam-${index} `)];
    const report = await diagnostics.testMultipleExams(ids, 0);

    assert.equal(report.summary.total, 25);
    assert.equal(calls.length, 25);
    assert.equal(calls[0], 'exam-0');
    assert.equal(calls[24], 'exam-24');
    assert(maxActive <= 3, `fallback concurrency should be 3, saw ${maxActive}`);
});

test('system diagnostics reports zero success rate for empty communication input', async () => {
    const SystemDiagnostics = loadDiagnostics();
    const diagnostics = new SystemDiagnostics();
    const report = await diagnostics.testMultipleExams([], -10);

    assert.equal(report.summary.total, 0);
    assert.equal(report.summary.successRate, 0);
});
