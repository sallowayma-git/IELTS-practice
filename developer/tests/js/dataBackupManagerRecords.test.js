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

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createTestInterval(callback, delay) {
    const timer = setInterval(callback, delay);
    if (timer && typeof timer.unref === 'function') {
        timer.unref();
    }
    return timer;
}

function createHarness() {
    const records = [{
        id: 'existing-1',
        examId: 'reading-p1',
        title: 'Existing',
        startTime: '2026-05-20T10:00:00.000Z',
        endTime: '2026-05-20T10:10:00.000Z',
        duration: 600,
        score: 1,
        totalQuestions: 1,
        correctAnswers: 1
    }];
    const meta = new Map();
    let userStats = { totalPractices: 1 };
    const calls = [];

    const storage = {
        async get(key, fallback = null) {
            calls.push({ type: 'storage.get', key });
            return meta.has(key) ? clone(meta.get(key)) : clone(fallback);
        },
        async set(key, value) {
            calls.push({ type: 'storage.set', key, value: clone(value) });
            meta.set(key, clone(value));
            return true;
        }
    };

    const quietConsole = {
        log() {},
        warn() {},
        error() {},
        info() {},
        debug() {}
    };
    const sandboxWindow = {
        console: quietConsole,
        PracticeRecordAPI: {
            async list() {
                calls.push({ type: 'api.list' });
                return clone(records);
            },
            async replace(nextRecords, options = {}) {
                calls.push({ type: 'api.replace', records: clone(nextRecords), options: clone(options) });
                records.splice(
                    0,
                    records.length,
                    ...(Array.isArray(nextRecords) ? clone(nextRecords) : [])
                );
                if (options.updateStats === true) {
                    await this.recalculateStats();
                }
                return clone(records);
            },
            async readStats() {
                calls.push({ type: 'api.readStats' });
                return clone(userStats);
            },
            async mergeStats(stats, options = {}) {
                calls.push({ type: 'api.mergeStats', stats: clone(stats), options: clone(options) });
                userStats = { ...userStats, ...clone(stats) };
                return clone(userStats);
            },
            async resetStats(stats = null) {
                calls.push({ type: 'api.resetStats', stats: clone(stats) });
                userStats = stats ? clone(stats) : {};
                return clone(userStats);
            },
            async recalculateStats() {
                calls.push({ type: 'api.recalculateStats' });
                userStats = {
                    totalPractices: records.length,
                    totalTimeSpent: records.reduce((sum, record) => sum + (Number(record.duration) || 0), 0)
                };
                return clone(userStats);
            }
        },
        PracticeStore: {
            async list() {
                throw new Error('PracticeStore.list should not be called');
            },
            async replace() {
                throw new Error('PracticeStore.replace should not be called');
            }
        },
        simpleStorageWrapper: {
            async getPracticeRecords() {
                throw new Error('simpleStorageWrapper.getPracticeRecords should not be called');
            },
            async savePracticeRecords() {
                throw new Error('simpleStorageWrapper.savePracticeRecords should not be called');
            }
        },
        scoreStorage: {
            async importData() {
                throw new Error('scoreStorage.importData should not be called');
            },
            async getPracticeRecords() {
                throw new Error('scoreStorage.getPracticeRecords should not be called');
            }
        },
        practiceRecorder: {
            async createBackup() {
                throw new Error('practiceRecorder.createBackup should not be called');
            },
            async restoreBackup() {
                throw new Error('practiceRecorder.restoreBackup should not be called');
            },
            scoreStorage: {
                async importData() {
                    throw new Error('practiceRecorder.scoreStorage.importData should not be called');
                }
            }
        }
    };

    const sandbox = {
        window: sandboxWindow,
        storage,
        console: quietConsole,
        setInterval: createTestInterval,
        clearInterval,
        setTimeout,
        clearTimeout,
        Date,
        Math,
        JSON
    };
    sandbox.globalThis = sandbox.window;
    const context = vm.createContext(sandbox);
    loadScript('js/core/practiceCore.js', context);
    sandboxWindow.PracticeCore.store = {
        async listPracticeRecords() {
            throw new Error('PracticeCore.store.listPracticeRecords should not be called');
        },
        async replacePracticeRecords() {
            throw new Error('PracticeCore.store.replacePracticeRecords should not be called');
        }
    };
    loadScript('js/utils/dataBackupManager.js', context);

    return {
        DataBackupManager: sandbox.window.DataBackupManager,
        records,
        calls,
        meta,
        getUserStats: () => clone(userStats),
        setUserStats: (nextStats) => {
            userStats = clone(nextStats);
        }
    };
}

async function testImportUsesPracticeRecordApiOnly() {
    const harness = createHarness();
    const manager = new harness.DataBackupManager();

    try {
        await manager.importPracticeData({
            practice_records: [{
                id: 'incoming-1',
                examId: 'reading-p2',
                title: 'Incoming',
                startTime: '2026-05-21T10:00:00.000Z',
                endTime: '2026-05-21T10:05:00.000Z',
                duration: 300,
                score: 1,
                totalQuestions: 2,
                correctAnswers: 1
            }],
            user_stats: {
                totalPractices: 2
            }
        }, {
            createBackup: false
        });

        assert.deepStrictEqual(harness.records.map(record => record.id), ['existing-1', 'incoming-1']);
        assert(harness.calls.some(call => call.type === 'api.list'), '导入合并前应通过 PracticeRecordAPI 读取现有记录');
        assert(harness.calls.some(call => call.type === 'api.replace'), '导入合并后应通过 PracticeRecordAPI 替换记录');
        assert.strictEqual(
            harness.calls.some(call => call.type === 'scoreStorage.importData'),
            false,
            '导入不应绕到 ScoreStorage.importData'
        );
        assert.strictEqual(harness.getUserStats().totalPractices, 2, '导入携带 user_stats 时仍应通过 PracticeRecordAPI 保留统计兼容');
        assert(harness.calls.some(call => call.type === 'api.mergeStats'), '导入携带 user_stats 时应通过 PracticeRecordAPI.mergeStats');
        assert.strictEqual(
            harness.calls.some(call => call.key === 'user_stats'),
            false,
            'DataBackupManager 不应直接读写 raw user_stats'
        );
    } finally {
        if (manager.cleanupTimer) {
            clearInterval(manager.cleanupTimer);
        }
    }
}

async function testImportWithoutStatsRecalculatesThroughPracticeRecordApi() {
    const harness = createHarness();
    const manager = new harness.DataBackupManager();

    try {
        harness.setUserStats({ totalPractices: 99, totalTimeSpent: 9999 });

        await manager.importPracticeData({
            practice_records: [{
                id: 'incoming-replace-1',
                examId: 'reading-replace',
                title: 'Incoming Replace',
                startTime: '2026-05-23T10:00:00.000Z',
                endTime: '2026-05-23T10:05:00.000Z',
                duration: 300,
                score: 1,
                totalQuestions: 2,
                correctAnswers: 1
            }]
        }, {
            createBackup: false,
            mergeMode: 'replace'
        });

        assert.deepStrictEqual(harness.records.map(record => record.id), ['incoming-replace-1']);
        assert(
            harness.calls.some(call => call.type === 'api.replace' && call.options && call.options.updateStats === true),
            '导入替换 records 时应要求 PracticeRecordAPI 同步统计'
        );
        assert(harness.calls.some(call => call.type === 'api.recalculateStats'), '导入不带 user_stats 时应通过 PracticeRecordAPI 重算统计');
        assert.strictEqual(harness.getUserStats().totalPractices, 1, '导入替换后统计应跟随 canonical records');
        assert.strictEqual(harness.getUserStats().totalTimeSpent, 300, '导入替换后统计时长应按 canonical records 重算');
    } finally {
        if (manager.cleanupTimer) {
            clearInterval(manager.cleanupTimer);
        }
    }
}

async function testBackupRestoreUsesPracticeRecordApiOnly() {
    const harness = createHarness();
    const manager = new harness.DataBackupManager();

    try {
        const backupId = await manager.createPreImportBackup();
        assert(backupId, '应能创建预导入备份');

        harness.records.splice(0, harness.records.length, {
            id: 'mutated-1',
            examId: 'reading-mutated',
            title: 'Mutated',
            startTime: '2026-05-22T10:00:00.000Z',
            endTime: '2026-05-22T10:01:00.000Z',
            duration: 60,
            score: 0,
            totalQuestions: 1,
            correctAnswers: 0
        });
        harness.setUserStats({ totalPractices: 99 });

        await manager.restoreBackup(backupId);

        assert.deepStrictEqual(harness.records.map(record => record.id), ['existing-1'], '恢复备份应通过 PracticeRecordAPI.replace 还原 records');
        assert.strictEqual(harness.getUserStats().totalPractices, 1, '恢复备份应通过 PracticeRecordAPI.resetStats 还原 user_stats');
        assert(harness.calls.some(call => call.type === 'api.readStats'), '创建备份应通过 PracticeRecordAPI.readStats');
        assert(harness.calls.some(call => call.type === 'api.resetStats'), '恢复备份应通过 PracticeRecordAPI.resetStats');
        assert.strictEqual(
            harness.calls.some(call => call.key === 'user_stats'),
            false,
            '备份恢复链路不应直接读写 raw user_stats'
        );
    } finally {
        if (manager.cleanupTimer) {
            clearInterval(manager.cleanupTimer);
        }
    }
}

async function testClearPracticeRecordsRecalculatesStats() {
    const harness = createHarness();
    const manager = new harness.DataBackupManager();

    try {
        harness.setUserStats({ totalPractices: 99, totalTimeSpent: 9999 });

        const result = await manager.clearData({
            clearPracticeRecords: true,
            clearUserStats: false,
            createBackup: false
        });

        assert.deepStrictEqual(harness.records, [], '清空 records 应通过 PracticeRecordAPI.replace 清空 canonical records');
        assert(
            harness.calls.some(call => call.type === 'api.replace' && call.options && call.options.updateStats === true),
            '清空 records 但未显式清 stats 时应要求 PracticeRecordAPI 同步统计'
        );
        assert(harness.calls.some(call => call.type === 'api.recalculateStats'), '清空 records 后应通过 PracticeRecordAPI 重算统计');
        assert.strictEqual(harness.getUserStats().totalPractices, 0, '清空 records 后 stats 不应保留旧 totalPractices');
        assert(result.clearedItems.includes('user_stats'), 'records 清空引发统计同步时应报告 user_stats 已更新');
    } finally {
        if (manager.cleanupTimer) {
            clearInterval(manager.cleanupTimer);
        }
    }
}

async function testNormalizeImportPayloadStatsUsesExplicitStatsKeyOnly() {
    const harness = createHarness();
    const manager = new harness.DataBackupManager();

    try {
        const normalized = manager.normalizeImportPayload({
            totalPractices: 99,
            totalTimeSpent: 9999,
            stats: {
                totalPractices: 2,
                totalTimeSpent: 300
            },
            practice_records: [{
                id: 'stats-root-guard',
                examId: 'reading-stats-root',
                startTime: '2026-05-24T10:00:00.000Z',
                endTime: '2026-05-24T10:05:00.000Z',
                duration: 300,
                score: 1,
                totalQuestions: 2,
                correctAnswers: 1
            }]
        });

        assert.strictEqual(normalized.userStats.totalPractices, 2, '导入 stats 必须来自显式 stats/user_stats key，不能把根对象误判成 stats');
        assert.strictEqual(normalized.userStats.totalTimeSpent, 300);
        assert.strictEqual(normalized.practiceRecords.length, 1, 'practice_records 仍应正常提取');
    } finally {
        if (manager.cleanupTimer) {
            clearInterval(manager.cleanupTimer);
        }
    }
}

async function testNormalizeRecordCanonicalCorrectAnswerMapWins() {
    const harness = createHarness();
    const manager = new harness.DataBackupManager();

    try {
        const normalized = manager.normalizeRecord({
            id: 'correct-map-conflict',
            examId: 'reading-correct-map',
            answers: { q1: 'A', q2: 'D', q3: 'E' },
            correctAnswerMap: { q1: 'A' },
            correctAnswers: { q1: 'B', q2: 'C', q3: 'F' },
            correctAnswersCount: 2,
            scoreInfo: { correct: 3, total: 3 },
            realData: {
                correctAnswerMap: { q2: 'D' },
                correctAnswers: { q3: 'E' }
            }
        });

        assert.strictEqual(normalized.correctAnswers, 2, '对象型 correctAnswers 不能污染数字答对数');
        assert.strictEqual(normalized.correctAnswerMap.q1, 'A', '导入记录应优先使用 canonical correctAnswerMap');
        assert.strictEqual(normalized.correctAnswerMap.q2, 'D', 'realData.correctAnswerMap 应先于 legacy correctAnswers 补缺');
        assert.strictEqual(normalized.correctAnswerMap.q3, 'F', '顶层 legacy correctAnswers 可作为补缺来源');
        assert.strictEqual(normalized.realData.correctAnswers.q1, 'A', 'realData.correctAnswers 应镜像 canonical map');
        assert.strictEqual(normalized.realData.correctAnswerMap.q2, 'D', 'realData.correctAnswerMap 应镜像 canonical map');
    } finally {
        if (manager.cleanupTimer) {
            clearInterval(manager.cleanupTimer);
        }
    }
}

async function testNormalizeRecordKeepsCoreAccuracyScale() {
    const harness = createHarness();
    const manager = new harness.DataBackupManager();

    try {
        const normalized = manager.normalizeRecord({
            id: 'accuracy-scale',
            examId: 'reading-accuracy-scale',
            startTime: '2026-05-24T10:00:00.000Z',
            endTime: '2026-05-24T10:05:00.000Z',
            durationSeconds: 300,
            answers: { q1: 'A', q2: 'B' },
            correctAnswerMap: { q1: 'A', q2: 'C' },
            correctAnswers: 1,
            totalQuestions: 2,
            accuracy: 0.5,
            percentage: 50
        });

        assert.strictEqual(normalized.score, 1, 'DataBackupManager 不能把 percentage/accuracy 当成 score');
        assert.strictEqual(normalized.accuracy, 0.5, 'DataBackupManager 不能把 Core 的 0..1 accuracy 改成 0..100');
        assert.strictEqual(normalized.duration, 300, 'durationSeconds 外部别名应由 Core 标准化为秒');
    } finally {
        if (manager.cleanupTimer) {
            clearInterval(manager.cleanupTimer);
        }
    }
}

async function testNormalizeImportPayloadDoesNotDeepWalkNestedSnapshots() {
    const harness = createHarness();
    const manager = new harness.DataBackupManager();

    try {
        const normalized = manager.normalizeImportPayload({
            archive: {
                nested: {
                    practice_records: [{
                        id: 'nested-should-not-import',
                        examId: 'reading-nested',
                        startTime: '2026-05-24T10:00:00.000Z',
                        duration: 60
                    }]
                }
            }
        });

        assert.strictEqual(
            normalized.practiceRecords.length,
            0,
            'DataBackupManager 只能读取显式导入 schema，不能深挖任意嵌套 practice_records'
        );
    } finally {
        if (manager.cleanupTimer) {
            clearInterval(manager.cleanupTimer);
        }
    }
}

async function main() {
    try {
        await testImportUsesPracticeRecordApiOnly();
        await testImportWithoutStatsRecalculatesThroughPracticeRecordApi();
        await testBackupRestoreUsesPracticeRecordApiOnly();
        await testClearPracticeRecordsRecalculatesStats();
        await testNormalizeImportPayloadStatsUsesExplicitStatsKeyOnly();
        await testNormalizeRecordCanonicalCorrectAnswerMapWins();
        await testNormalizeRecordKeepsCoreAccuracyScale();
        await testNormalizeImportPayloadDoesNotDeepWalkNestedSnapshots();
        process.stdout.write(JSON.stringify({
            status: 'pass',
            detail: 'DataBackupManager 导入/合并/清空/备份恢复只走 PracticeRecordAPI 并同步统计，记录语义交给 Core 标准化'
        }));
    } catch (error) {
        process.stdout.write(JSON.stringify({
            status: 'fail',
            detail: error && error.stack ? error.stack : String(error)
        }));
        process.exit(1);
    }
}

main();
