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

function createHarness() {
    const practiceState = [];
    const metaState = new Map();
    const settingsState = {};
    const backupState = new Map([
        ['backup-1', {
            id: 'backup-1',
            data: {
                practice_records: [{
                    id: 'restored-1',
                    examId: 'reading-p1',
                    type: 'reading',
                    date: '2026-05-20T10:00:00.000Z',
                    startTime: '2026-05-20T09:50:00.000Z',
                    endTime: '2026-05-20T10:00:00.000Z',
                    duration: 600,
                    score: 8,
                    totalQuestions: 10,
                    correctAnswers: 8,
                    accuracy: 0.8,
                    metadata: { category: 'P1' }
                }]
            }
        }]
    ]);
    const stateRecords = [];

    const repositories = {
        async runConsistencyChecks() {
            return { ok: true };
        },
        practice: {
            async list() {
                return clone(practiceState);
            },
            async overwrite(records) {
                practiceState.splice(0, practiceState.length, ...(Array.isArray(records) ? clone(records) : []));
                return true;
            }
        },
        backups: {
            async list() {
                return Array.from(backupState.values()).map(clone);
            },
            async getById(id) {
                return clone(backupState.get(id) || null);
            },
            async add(backup) {
                backupState.set(backup.id, clone(backup));
                return true;
            },
            async prune() {
                return true;
            }
        },
        settings: {
            async getAll() {
                return clone(settingsState);
            },
            async saveAll(next) {
                Object.assign(settingsState, clone(next));
                return true;
            }
        },
        meta: {
            async get(key, fallback = null) {
                return metaState.has(key) ? clone(metaState.get(key)) : clone(fallback);
            },
            async set(key, value) {
                metaState.set(key, clone(value));
                return true;
            }
        }
    };

    const quietConsole = {
        log() {},
        warn() {},
        error() {},
        info() {},
        debug() {}
    };
    const publicRepositories = {
        async runConsistencyChecks() {
            return repositories.runConsistencyChecks();
        },
        backups: repositories.backups,
        settings: repositories.settings,
        meta: repositories.meta
    };
    const sandboxWindow = {
        console: quietConsole,
        dataRepositories: publicRepositories,
        practiceRecords: [],
        app: { state: { practice: { records: [] } } },
        setPracticeRecordsState(records) {
            stateRecords.splice(0, stateRecords.length, ...(Array.isArray(records) ? clone(records) : []));
            return clone(stateRecords);
        }
    };

    const sandbox = {
        window: sandboxWindow,
        console: quietConsole,
        setInterval,
        clearInterval,
        setTimeout,
        clearTimeout,
        Date,
        Math,
        JSON,
        TextDecoder
    };
    sandbox.globalThis = sandbox.window;
    const context = vm.createContext(sandbox);
    loadScript('js/core/practiceCore.js', context);
    sandbox.window.PracticeCore.__installInternalRepositories(repositories);
    loadScript('js/core/practiceRecordAPI.js', context);
    loadScript('js/core/practiceStore.js', context);
    loadScript('js/components/DataIntegrityManager.js', context);

    return {
        DataIntegrityManager: sandbox.window.DataIntegrityManager,
        repositories,
        practiceState,
        metaState,
        stateRecords,
        app: sandbox.window.app
    };
}

async function testRestoreRecalculatesStatsAndSyncsState() {
    const harness = createHarness();
    const manager = new harness.DataIntegrityManager();
    manager.stopAutoBackup();

    await manager.restoreBackup('backup-1');
    manager.stopAutoBackup();

    assert.deepStrictEqual(harness.practiceState.map(record => record.id), ['restored-1']);
    assert.deepStrictEqual(harness.stateRecords.map(record => record.id), ['restored-1'], '统一 API 替换后应同步 window state');
    assert.deepStrictEqual(harness.app.state.practice.records.map(record => record.id), ['restored-1'], '统一 API 替换后应同步 app.state');

    const stats = harness.metaState.get('user_stats');
    assert(stats, '恢复记录后应写入 user_stats');
    assert.strictEqual(stats.totalPractices, 1, '未携带 stats 的备份应按记录重算 totalPractices');
    assert.strictEqual(stats.totalTimeSpent, 600, '未携带 stats 的备份应按记录重算 totalTimeSpent');
    assert.strictEqual(stats.averageScore, 0.8, '未携带 stats 的备份应按记录重算 averageScore');
}

async function testImportUsesProvidedStats() {
    const harness = createHarness();
    const manager = new harness.DataIntegrityManager();
    manager.stopAutoBackup();

    await manager.importData({
        data: {
            practice_records: [{
                id: 'imported-1',
                examId: 'reading-p2',
                type: 'reading',
                date: '2026-05-21T10:00:00.000Z',
                startTime: '2026-05-21T09:55:00.000Z',
                endTime: '2026-05-21T10:00:00.000Z',
                duration: 300,
                score: 1,
                totalQuestions: 2,
                correctAnswers: 1,
                accuracy: 0.5
            }],
            user_stats: {
                totalPractices: 9,
                totalTimeSpent: 1234,
                averageScore: 0.77,
                categoryStats: {},
                questionTypeStats: {},
                practiceDays: ['2026-05-21'],
                achievements: ['imported']
            }
        }
    });
    manager.stopAutoBackup();

    assert.deepStrictEqual(harness.practiceState.map(record => record.id), ['imported-1']);
    const stats = harness.metaState.get('user_stats');
    assert.strictEqual(stats.totalPractices, 9, '导入文件携带 user_stats 时应优先使用导入统计');
    assert.strictEqual(stats.totalTimeSpent, 1234);
    assert.deepStrictEqual(stats.achievements, ['imported']);
}

async function testImportCanonicalCorrectAnswerMapWins() {
    const harness = createHarness();
    const manager = new harness.DataIntegrityManager();
    manager.stopAutoBackup();

    await manager.importData({
        data: {
            practice_records: [{
                id: 'imported-correct-map',
                examId: 'reading-correct-map',
                type: 'reading',
                date: '2026-05-22T10:00:00.000Z',
                startTime: '2026-05-22T09:55:00.000Z',
                endTime: '2026-05-22T10:00:00.000Z',
                duration: 300,
                answers: { q1: 'A', q2: 'D', q3: 'E' },
                correctAnswerMap: { q1: 'A' },
                correctAnswers: { q1: 'B', q2: 'C', q3: 'F' },
                correctAnswersCount: 2,
                scoreInfo: { correct: 3, total: 3 },
                realData: {
                    correctAnswerMap: { q2: 'D' },
                    correctAnswers: { q3: 'E' }
                }
            }]
        }
    });
    manager.stopAutoBackup();

    assert.deepStrictEqual(harness.practiceState.map(record => record.id), ['imported-correct-map']);
    const imported = harness.practiceState[0];
    assert.strictEqual(imported.correctAnswers, 2, '对象型 correctAnswers 不能污染数字答对数字段');
    assert.strictEqual(imported.correctAnswerMap.q1, 'A', 'DataIntegrity 导入应优先使用 canonical correctAnswerMap');
    assert.strictEqual(imported.correctAnswerMap.q2, 'D', 'realData.correctAnswerMap 应先于 legacy correctAnswers 补缺');
    assert.strictEqual(imported.correctAnswerMap.q3, 'F', '顶层 legacy correctAnswers 只作为补缺来源');
    assert.strictEqual(imported.realData.correctAnswers.q1, 'A', 'realData.correctAnswers 应镜像 canonical map');
    assert.strictEqual(imported.realData.correctAnswerMap.q2, 'D', 'realData.correctAnswerMap 应镜像 canonical map');
}

async function testImportDoesNotNormalizeRecordsLocally() {
    const harness = createHarness();
    const manager = new harness.DataIntegrityManager();
    manager.stopAutoBackup();

    await manager.importData({
        data: {
            practice_records: [{
                id: 'imported-core-only',
                exam_id: 'reading-core-only',
                title: 'Core Only Import',
                start_time: '2026-05-23T09:55:00.000Z',
                completedAt: '2026-05-23T10:00:00.000Z',
                durationSeconds: 300,
                answers: { q1: 'A', q2: 'B' },
                correctAnswerMap: { q1: 'A', q2: 'C' },
                correctAnswers: 1,
                totalQuestions: 2,
                percentage: 50,
                accuracy: 0.5
            }]
        }
    });
    manager.stopAutoBackup();

    const imported = harness.practiceState[0];
    assert.strictEqual(imported.id, 'imported-core-only');
    assert.strictEqual(imported.examId, 'reading-core-only', '外部 exam_id 别名应由 Core/API 统一标准化');
    assert.strictEqual(imported.startTime, '2026-05-23T09:55:00.000Z');
    assert.strictEqual(imported.endTime, '2026-05-23T10:00:00.000Z');
    assert.strictEqual(imported.duration, 300);
    assert.strictEqual(imported.score, 1, 'DataIntegrity 不能把 percentage/accuracy 当成 score');
    assert.strictEqual(imported.accuracy, 0.5, 'DataIntegrity 不能把 0..1 accuracy 改成百分数');
}

async function main() {
    try {
        await testRestoreRecalculatesStatsAndSyncsState();
        await testImportUsesProvidedStats();
        await testImportCanonicalCorrectAnswerMapWins();
        await testImportDoesNotNormalizeRecordsLocally();
        process.stdout.write(JSON.stringify({
            status: 'pass',
            detail: 'DataIntegrityManager 替换记录后同步 app/window state，同步或重算 user_stats，记录语义交给 Core/API'
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
