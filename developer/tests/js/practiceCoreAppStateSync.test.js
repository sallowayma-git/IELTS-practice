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
    const stateServiceRecords = [];
    const quietConsole = {
        log() {},
        warn() {},
        error() {},
        info() {},
        debug() {}
    };

    const repositories = {
        practice: {
            async list() {
                return practiceState.map((record) => ({ ...record }));
            },
            async overwrite(records) {
                practiceState.splice(0, practiceState.length, ...(Array.isArray(records) ? records.map((record) => ({ ...record })) : []));
                return true;
            }
        },
        meta: {
            async get(_key, fallback = null) {
                return fallback;
            },
            async set() {
                return true;
            },
            async remove() {
                return true;
            }
        }
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
        practiceRecords: [{ id: 'legacy-shadow' }],
        setPracticeRecordsState(records) {
            stateServiceRecords.splice(0, stateServiceRecords.length, ...(Array.isArray(records) ? records.map((record) => ({ ...record })) : []));
            return stateServiceRecords.map((record) => ({ ...record }));
        }
    };

    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);
    loadScript('js/core/practiceCore.js', context);
    sandbox.PracticeCore.__installInternalRepositories(repositories);
    loadScript('js/core/practiceRecordAPI.js', context);

    return {
        sandbox,
        practiceState,
        stateServiceRecords
    };
}

function createStateServiceHarness() {
    let enrichCalls = 0;
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
        Set,
        Map,
        Array,
        Object,
        String,
        Number,
        Boolean,
        structuredClone,
        app: {
            state: {
                exam: {},
                practice: { records: [] },
                ui: {},
                system: {}
            }
        },
        DataConsistencyManager: class DataConsistencyManager {
            enrichRecordData() {
                enrichCalls += 1;
                throw new Error('state-service must not create display projections');
            }

            ensureConsistency() {
                enrichCalls += 1;
                throw new Error('state-service must not create display projections');
            }
        }
    };

    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);
    loadScript('js/app/state-service.js', context);
    sandbox.appStateService.connectApp(sandbox.app);

    return {
        sandbox,
        getEnrichCalls() {
            return enrichCalls;
        }
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

    assert.strictEqual(
        typeof harness.sandbox.PracticeCore.store.replacePracticeRecords,
        'undefined',
        '公开 PracticeCore.store 不能暴露批量写入口'
    );

    await harness.sandbox.PracticeRecordAPI.replace([record]);

    assert.deepStrictEqual(
        harness.stateServiceRecords.map((item) => item.id),
        ['record-1'],
        'replacePracticeRecords 后应同步 state-service 练习记录状态'
    );
    assert.deepStrictEqual(
        harness.sandbox.app.state.practice.records.map((item) => item.id),
        ['record-1'],
        'replacePracticeRecords 后应同步 app.state.practice.records'
    );

    assert.deepStrictEqual(
        harness.sandbox.practiceRecords.map((item) => item.id),
        ['legacy-shadow'],
        'replacePracticeRecords 不应写回 legacy global.practiceRecords 影子事实源'
    );

    await harness.sandbox.PracticeRecordAPI.replace([]);

    assert.strictEqual(harness.practiceState.length, 0, 'replacePracticeRecords([]) 应清空 canonical store');
    assert.strictEqual(harness.stateServiceRecords.length, 0, 'replacePracticeRecords([]) 应清空 state-service 练习记录状态');
    assert.strictEqual(harness.sandbox.app.state.practice.records.length, 0, 'replacePracticeRecords([]) 应同步清空 app.state.practice.records');
}

async function testStateServiceKeepsCanonicalPracticeRecordsOnly() {
    const harness = createStateServiceHarness();
    const record = {
        id: 'canonical-record',
        correctAnswers: 7,
        totalQuestions: 10,
        score: 7,
        realData: {
            answers: { q1: 'A' }
        }
    };

    const returned = harness.sandbox.appStateService.setPracticeRecords([record]);
    assert.strictEqual(harness.getEnrichCalls(), 0, 'setPracticeRecords 不应调用 DataConsistencyManager 生成显示投影');
    assert.strictEqual(returned[0].correctAnswers, 7, '返回值应保留数字型 correctAnswers');
    assert.strictEqual(returned[0].answerComparison, undefined, 'canonical state 不应补 answerComparison 显示字段');
    assert.strictEqual(returned[0].realData.correctAnswers, undefined, 'canonical state 不应补 realData.correctAnswers 显示字段');

    const appRecord = harness.sandbox.app.state.practice.records[0];
    assert.strictEqual(appRecord.correctAnswers, 7, 'app.state.practice.records 应保留 canonical 数字型 correctAnswers');
    assert.strictEqual(appRecord.answerComparison, undefined, 'app.state.practice.records 不应存显示投影字段');
    assert.strictEqual(appRecord.realData.correctAnswers, undefined, 'app.state.practice.records 不应存 realData.correctAnswers 投影');

    const getterRecord = harness.sandbox.getPracticeRecordsState()[0];
    getterRecord.correctAnswers = { q1: 'A' };
    getterRecord.realData.answers.q1 = 'MUTATED';
    const afterGetterMutation = harness.sandbox.appStateService.getPracticeRecords()[0];
    assert.strictEqual(afterGetterMutation.correctAnswers, 7, '全局 getter 返回 clone，不能污染内部 correctAnswers');
    assert.strictEqual(afterGetterMutation.realData.answers.q1, 'A', '全局 getter 返回 clone，不能污染内部 nested realData');

    returned[0].realData.answers.q1 = 'RETURNED_MUTATION';
    const afterReturnedMutation = harness.sandbox.appStateService.getPracticeRecords()[0];
    assert.strictEqual(afterReturnedMutation.realData.answers.q1, 'A', 'setPracticeRecords 返回值也必须是 clone');

    record.realData.answers.q1 = 'INPUT_MUTATION';
    const afterInputMutation = harness.sandbox.appStateService.getPracticeRecords()[0];
    assert.strictEqual(afterInputMutation.realData.answers.q1, 'A', '输入 record 后续变更不能污染 state-service');
}

async function main() {
    try {
        await testPracticeCoreSyncsAppState();
        await testStateServiceKeepsCanonicalPracticeRecordsOnly();
        console.log(JSON.stringify({
            status: 'pass',
            detail: 'PracticeCore replacePracticeRecords 与 AppStateService canonical 记录同步契约通过'
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
