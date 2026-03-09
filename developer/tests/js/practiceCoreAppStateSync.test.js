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

function createHarness() {
    const practiceState = [];
    const globalState = [];
    const quietConsole = {
        log() {},
        warn() {},
        error() {},
        info() {},
        debug() {}
    };

    const sandbox = {
        console: quietConsole,
        Date,
        Math,
        JSON,
        app: {
            state: {
                practice: {
                    records: []
                }
            }
        },
        dataRepositories: {
            practice: {
                async list() {
                    return practiceState.map((record) => ({ ...record }));
                },
                async overwrite(records) {
                    practiceState.splice(0, practiceState.length, ...(Array.isArray(records) ? records.map((record) => ({ ...record })) : []));
                    return true;
                }
            }
        },
        setPracticeRecordsState(records) {
            globalState.splice(0, globalState.length, ...(Array.isArray(records) ? records.map((record) => ({ ...record })) : []));
            return globalState.map((record) => ({ ...record }));
        }
    };

    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);
    loadScript('js/core/practiceCore.js', context);

    return {
        sandbox,
        practiceState,
        globalState
    };
}

async function testPracticeCoreSyncsAppState() {
    const harness = createHarness();
    const record = {
        id: 'record-1',
        sessionId: 'session-1',
        type: 'reading',
        score: 8,
        correctAnswers: 8,
        totalQuestions: 10,
        accuracy: 0.8,
        percentage: 80,
        duration: 100,
        date: '2026-03-09T10:00:00.000Z',
        startTime: '2026-03-09T09:58:20.000Z',
        endTime: '2026-03-09T10:00:00.000Z',
        title: 'Record 1',
        metadata: {
            examTitle: 'Record 1',
            category: 'P1',
            frequency: 'high',
            type: 'reading',
            examType: 'reading'
        }
    };

    await harness.sandbox.PracticeCore.store.replacePracticeRecords([record]);

    assert.deepStrictEqual(
        harness.globalState.map((item) => item.id),
        ['record-1'],
        'replacePracticeRecords 后应同步全局练习记录状态'
    );
    assert.deepStrictEqual(
        harness.sandbox.app.state.practice.records.map((item) => item.id),
        ['record-1'],
        'replacePracticeRecords 后应同步 app.state.practice.records'
    );

    await harness.sandbox.PracticeCore.store.replacePracticeRecords([]);

    assert.strictEqual(harness.practiceState.length, 0, 'replacePracticeRecords([]) 应清空 canonical store');
    assert.strictEqual(harness.globalState.length, 0, 'replacePracticeRecords([]) 应清空全局练习记录状态');
    assert.strictEqual(harness.sandbox.app.state.practice.records.length, 0, 'replacePracticeRecords([]) 应同步清空 app.state.practice.records');
}

async function main() {
    try {
        await testPracticeCoreSyncsAppState();
        console.log(JSON.stringify({
            status: 'pass',
            detail: 'PracticeCore replacePracticeRecords 会同步 canonical store、全局状态和 app.state.practice.records'
        }, null, 2));
    } catch (error) {
        console.log(JSON.stringify({
            status: 'fail',
            detail: error.message
        }, null, 2));
        process.exit(1);
    }
}

main();
