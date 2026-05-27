#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function createMemoryStorage() {
    const data = new Map();
    return {
        get length() {
            return data.size;
        },
        key(index) {
            return Array.from(data.keys())[index] || null;
        },
        getItem(key) {
            return data.has(String(key)) ? data.get(String(key)) : null;
        },
        setItem(key, value) {
            data.set(String(key), String(value));
        },
        removeItem(key) {
            data.delete(String(key));
        },
        clear() {
            data.clear();
        },
        _dump() {
            return Object.fromEntries(data.entries());
        }
    };
}

function createFetch(responseData = null) {
    return async () => ({
        ok: true,
        async json() {
            return responseData || { practice_records: [{ id: 'backup-record', examId: 'reading-backup' }] };
        }
    });
}

async function createHarness(options = {}) {
    const localStorage = createMemoryStorage();
    const sessionStorage = createMemoryStorage();
    const intervals = [];
    const timeouts = [];
    const listeners = [];
    const calls = [];
    const quietConsole = {
        log() {},
        info() {},
        warn() {},
        error() {}
    };

    const windowStub = {
        location: { protocol: options.protocol || 'http:' },
        localStorage,
        sessionStorage,
        indexedDB: null,
        dispatchEvent() {},
        addEventListener(type, handler) {
            listeners.push({ type, handler });
        },
        showMessage() {},
        fetch: createFetch(options.backupData),
        setTimeout(callback, delay) {
            const id = { callback, delay };
            timeouts.push(id);
            return id;
        },
        clearTimeout(id) {
            const index = timeouts.indexOf(id);
            if (index >= 0) {
                timeouts.splice(index, 1);
            }
        }
    };
    if (options.practiceRecordAPI) {
        windowStub.PracticeRecordAPI = options.practiceRecordAPI(calls);
    }

    const sandbox = {
        window: windowStub,
        globalThis: windowStub,
        localStorage,
        sessionStorage,
        document: {
            dispatchEvent() {}
        },
        CustomEvent: class CustomEvent {
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail || null;
            }
        },
        console: quietConsole,
        JSON,
        Date,
        Math,
        setInterval(callback, delay) {
            const id = { callback, delay };
            intervals.push(id);
            return id;
        },
        clearInterval(id) {
            const index = intervals.indexOf(id);
            if (index >= 0) {
                intervals.splice(index, 1);
            }
        },
        setTimeout(callback, delay) {
            return windowStub.setTimeout(callback, delay);
        },
        clearTimeout(id) {
            return windowStub.clearTimeout(id);
        },
        fetch: createFetch(options.backupData)
    };
    const context = vm.createContext(sandbox);
    const source = fs.readFileSync(path.join(repoRoot, 'js/utils/storage.js'), 'utf8');
    vm.runInContext(source, context, { filename: 'js/utils/storage.js' });
    await windowStub.persistentStore.ready;
    return {
        window: windowStub,
        persistentStore: windowStub.persistentStore,
        localStorage,
        sessionStorage,
        calls,
        intervals,
        timeouts,
        context,
        listeners
    };
}

function loadScript(relativePath, context) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    vm.runInContext(source, context, { filename: relativePath });
}

function flushWindowTimeouts(harness) {
    while (harness.timeouts.length > 0) {
        const pending = harness.timeouts.splice(0, harness.timeouts.length);
        pending.forEach((entry) => {
            if (typeof entry.callback === 'function') {
                entry.callback();
            }
        });
    }
}

function readEnvelope(storage, key) {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw).data : null;
}

function readRawPracticeRecords(harness) {
    const records = readEnvelope(harness.localStorage, 'exam_system_practice_records');
    return Array.isArray(records) ? records : [];
}

async function writeRawPracticeRecords(harness, records) {
    harness.localStorage.setItem('exam_system_practice_records', JSON.stringify({
        data: records,
        timestamp: Date.now(),
        version: '1.0.0',
        compressed: false
    }));
}

async function testStorageDataSourceReadBypassesPublicPracticeRecordRedirect() {
    const calls = [];
    const windowStub = { ExamData: {} };
    const sandbox = {
        window: windowStub,
        console: {
            log() {},
            info() {},
            warn() {},
            error() {}
        }
    };
    const context = vm.createContext(sandbox);
    const source = fs.readFileSync(path.join(repoRoot, 'js/data/dataSources/storageDataSource.js'), 'utf8');
    vm.runInContext(source, context, { filename: 'js/data/dataSources/storageDataSource.js' });

    const storageManager = {
        async get(key, defaultValue, options = {}) {
            calls.push({ type: 'get', key, options });
            if (key === 'practice_records' && !options.skipPracticeCoreRedirect) {
                throw new Error('public practice record redirect would recurse');
            }
            return key === 'practice_records'
                ? [{ id: `raw-${calls.length}`, examId: 'reading-raw' }]
                : defaultValue;
        },
        async set() {
            return true;
        },
        async remove() {
            return true;
        }
    };

    const externalDataSource = new windowStub.ExamData.StorageDataSource(storageManager);
    await assert.rejects(
        () => externalDataSource.read('practice_records', []),
        /protected key practice_records/,
        '外部 new StorageDataSource 不能读取 protected key'
    );

    const dataSource = new windowStub.ExamData.StorageDataSource(storageManager, {
        createInternalOptions() {
            return { skipPracticeCoreRedirect: true, internalAccessToken: Symbol('test-internal') };
        }
    });
    const records = await dataSource.read('practice_records', []);
    assert.strictEqual(records[0].id, 'raw-1', 'StorageDataSource.read 应直接读底层 raw store');

    const txRecords = await dataSource.runTransaction(async (transaction) => {
        return transaction.get('practice_records', []);
    });
    assert.strictEqual(txRecords[0].id, 'raw-2', 'StorageTransactionContext.get 应直接读底层 raw store');

    assert.strictEqual(calls.length, 2, 'read 和 transaction.get 应各触发一次底层读取');
    assert(calls.every((call) => call.options && call.options.skipPracticeCoreRedirect === true),
        'StorageDataSource 底层读取必须跳过 PracticeRecordAPI/public storage redirect');
}

async function testRuntimeImportFailsWithoutPracticeRecordAPI() {
    const harness = await createHarness();
    await writeRawPracticeRecords(harness, [{ id: 'existing-record', examId: 'reading-existing' }]);

    const result = await harness.persistentStore.importData({
        data: {
            practice_records: [{ id: 'import-record', examId: 'reading-import' }]
        }
    });

    assert.strictEqual(result.success, false, '运行期导入缺少 PracticeRecordAPI 时必须失败');
    assert.strictEqual(
        readRawPracticeRecords(harness).some((record) => record && record.id === 'import-record'),
        false,
        '运行期导入失败不能把导入记录写入 raw practice_records'
    );
    assert.strictEqual(
        readRawPracticeRecords(harness).some((record) => record && record.id === 'existing-record'),
        true,
        '统一 API 缺失时导入必须 fail-fast，不能先清空已有练习记录'
    );
}

async function testInternalStorageAccessIsNotWindowPublic() {
    const harness = await createHarness();
    flushWindowTimeouts(harness);

    assert.strictEqual(
        Object.prototype.hasOwnProperty.call(harness.window, 'createStorageInternalAccessOptions'),
        false,
        'internal storage access 生成器不能挂到 window'
    );
    assert.strictEqual(
        Object.prototype.hasOwnProperty.call(harness.window, 'hasStorageInternalAccess'),
        false,
        'internal storage access 校验器不能挂到 window'
    );
    assert.strictEqual(
        Object.prototype.hasOwnProperty.call(harness.window, '__installStorageInternalAccess'),
        true,
        'storage internal access installer 在被消费前应保持可用'
    );
}

async function testFullDataBootstrapHidesInternalPracticeRepositories() {
    const harness = await createHarness();
    const scripts = [
        'js/core/storageProviderRegistry.js',
        'js/data/dataSources/storageDataSource.js',
        'js/data/repositories/baseRepository.js',
        'js/data/repositories/dataRepositoryRegistry.js',
        'js/data/repositories/practiceRepository.js',
        'js/data/repositories/settingsRepository.js',
        'js/data/repositories/backupRepository.js',
        'js/data/repositories/metaRepository.js',
        'js/core/practiceCore.js',
        'js/data/index.js',
        'js/core/practiceRecordAPI.js'
    ];
    scripts.forEach((script) => loadScript(script, harness.context));
    flushWindowTimeouts(harness);

    assert(harness.window.PracticeRecordAPI, 'PracticeRecordAPI 应完成初始化');
    assert.strictEqual(
        Object.prototype.hasOwnProperty.call(harness.window.ExamData, 'internalRepositories'),
        false,
        'ExamData.internalRepositories 不能暴露底层 practiceRepo'
    );
    assert.strictEqual(
        Boolean(harness.window.dataRepositories && harness.window.dataRepositories.practice),
        false,
        'public dataRepositories 不能暴露 practice 仓库'
    );
    assert.strictEqual(
        typeof harness.window.PracticeCore.__installInternalRepositories,
        'undefined',
        'PracticeCore 内部仓库 installer 必须在数据层注入后删除'
    );
    assert.strictEqual(
        typeof harness.window.PracticeCore.__installRecordAPI,
        'undefined',
        'PracticeCore RecordAPI installer 必须在 PracticeRecordAPI 初始化后删除'
    );
    assert.strictEqual(
        typeof harness.window.__installStorageInternalAccess,
        'undefined',
        'storage internal access installer 必须在数据层注入后删除'
    );

    await harness.window.PracticeRecordAPI.saveRecord({
        id: 'bootstrap-record',
        examId: 'reading-bootstrap',
        type: 'reading',
        date: '2026-05-25T00:00:00.000Z',
        score: 1,
        totalQuestions: 1,
        correctAnswers: 1,
        accuracy: 1
    });
    const records = await harness.window.PracticeRecordAPI.list();
    assert.strictEqual(records.length, 1, '隐藏内部仓库后 PracticeRecordAPI 仍应能落库');
    assert.strictEqual(records[0].id, 'bootstrap-record');
}

async function testRuntimeImportUsesPracticeRecordAPI() {
    const savedRecords = [];
    const harness = await createHarness({
        practiceRecordAPI: (calls) => ({
            async replace(records) {
                calls.push({ type: 'api.replace', records });
                savedRecords.splice(0, savedRecords.length, ...(Array.isArray(records) ? records : []));
                return savedRecords.slice();
            },
            async list() {
                calls.push({ type: 'api.list' });
                return savedRecords.slice();
            }
        })
    });

    const result = await harness.persistentStore.importData({
        data: {
            practice_records: [{ id: 'import-record', examId: 'reading-import' }]
        }
    });

    assert.strictEqual(result.success, true, 'PracticeRecordAPI 可用时运行期导入应成功');
    assert(harness.calls.some((call) => call.type === 'api.replace'), '运行期导入必须调用 PracticeRecordAPI.replace');
    assert.strictEqual(savedRecords.length, 1, 'PracticeRecordAPI 应收到导入记录');
    assert.strictEqual(
        readRawPracticeRecords(harness).some((record) => record && record.id === 'import-record'),
        false,
        '运行期导入成功也不能把导入记录落到 raw practice_records 影子键'
    );
}

async function testPublicStorageFacadeReadsWithPracticeRecordAPIAndRejectsWrites() {
    const savedRecords = [{ id: 'api-existing', examId: 'reading-existing' }];
    let stats = { totalPractices: 1 };
    const harness = await createHarness({
        practiceRecordAPI: (calls) => ({
            async list() {
                calls.push({ type: 'api.list' });
                return savedRecords.slice();
            },
            async replace(records, options) {
                calls.push({ type: 'api.replace', records, options });
                throw new Error('public storage facade must not call PracticeRecordAPI.replace');
            },
            async clear(options) {
                calls.push({ type: 'api.clear', options });
                throw new Error('public storage facade must not call PracticeRecordAPI.clear');
            },
            async readStats(options = {}) {
                calls.push({ type: 'api.readStats', options });
                return Object.assign({}, options.fallback || {}, stats);
            },
            async writeStats(nextStats) {
                calls.push({ type: 'api.writeStats', stats: nextStats });
                throw new Error('public storage facade must not call PracticeRecordAPI.writeStats');
            },
            async resetStats() {
                calls.push({ type: 'api.resetStats' });
                throw new Error('public storage facade must not call PracticeRecordAPI.resetStats');
            }
        })
    });

    const listed = await harness.persistentStore.get('practice_records', []);
    assert.strictEqual(listed.length, 1, 'public storage.get(practice_records) 应委托 PracticeRecordAPI.list');

    await assert.rejects(
        () => harness.persistentStore.set('practice_records', [{ id: 'api-next', examId: 'reading-next' }]),
        /Storage\.set\(practice_records\) is disabled/,
        'public storage.set(practice_records) 必须禁用'
    );
    assert.strictEqual(savedRecords[0].id, 'api-existing', 'public storage.set(practice_records) 不能改 canonical records');
    assert.strictEqual(readRawPracticeRecords(harness).some((record) => record && record.id === 'api-next'), false, 'public storage.set(practice_records) 不能写 raw shadow key');

    await assert.rejects(
        () => harness.persistentStore.remove('practice_records'),
        /Storage\.remove\(practice_records\) is disabled/,
        'public storage.remove(practice_records) 必须禁用'
    );
    assert.strictEqual(savedRecords.length, 1, 'public storage.remove(practice_records) 不能清空 canonical records');

    const readStats = await harness.persistentStore.get('user_stats', { totalPractices: 0 });
    assert.strictEqual(readStats.totalPractices, 1, 'public storage.get(user_stats) 应委托 PracticeRecordAPI.readStats');

    await assert.rejects(
        () => harness.persistentStore.set('user_stats', { totalPractices: 3 }),
        /Storage\.set\(user_stats\) is disabled/,
        'public storage.set(user_stats) 必须禁用'
    );
    assert.strictEqual(stats.totalPractices, 1, 'public storage.set(user_stats) 不能改 canonical stats');

    await assert.rejects(
        () => harness.persistentStore.remove('user_stats'),
        /Storage\.remove\(user_stats\) is disabled/,
        'public storage.remove(user_stats) 必须禁用'
    );
    assert.strictEqual(stats.totalPractices, 1, 'public storage.remove(user_stats) 不能重置 canonical stats');

    const callTypes = harness.calls.map((call) => call.type);
    assert(callTypes.includes('api.list'), 'PracticeRecordAPI.list must be called');
    assert(callTypes.includes('api.readStats'), 'PracticeRecordAPI.readStats must be called');
    assert(!callTypes.includes('api.replace'), 'public storage.set(practice_records) must not call PracticeRecordAPI.replace');
    assert(!callTypes.includes('api.clear'), 'public storage.remove(practice_records) must not call PracticeRecordAPI.clear');
    assert(!callTypes.includes('api.writeStats'), 'public storage.set(user_stats) must not call PracticeRecordAPI.writeStats');
    assert(!callTypes.includes('api.resetStats'), 'public storage.remove(user_stats) must not call PracticeRecordAPI.resetStats');
}

async function testPublicBypassOptionsCannotWritePracticeData() {
    const savedRecords = [{ id: 'api-existing', examId: 'reading-existing' }];
    let stats = { totalPractices: 1 };
    const harness = await createHarness({
        practiceRecordAPI: (calls) => ({
            async list() {
                calls.push({ type: 'api.list' });
                return savedRecords.slice();
            },
            async replace(records, options) {
                calls.push({ type: 'api.replace', records, options });
                throw new Error('public bypass options must not call PracticeRecordAPI.replace');
            },
            async clear(options) {
                calls.push({ type: 'api.clear', options });
                throw new Error('public bypass options must not call PracticeRecordAPI.clear');
            },
            async readStats(options = {}) {
                calls.push({ type: 'api.readStats', options });
                return Object.assign({}, options.fallback || {}, stats);
            },
            async writeStats(nextStats) {
                calls.push({ type: 'api.writeStats', stats: nextStats });
                throw new Error('public bypass options must not call PracticeRecordAPI.writeStats');
            },
            async resetStats() {
                calls.push({ type: 'api.resetStats' });
                throw new Error('public bypass options must not call PracticeRecordAPI.resetStats');
            }
        })
    });
    await writeRawPracticeRecords(harness, [{ id: 'raw-shadow', examId: 'reading-shadow' }]);

    const listed = await harness.persistentStore.get('practice_records', [], { skipPracticeCoreRedirect: true });
    assert.strictEqual(listed[0].id, 'api-existing', 'skipPracticeCoreRedirect 不能让 public get 读取 raw practice_records');

    await assert.rejects(
        () => harness.persistentStore.set('practice_records', [{ id: 'api-skip', examId: 'reading-skip' }], { skipPracticeCoreRedirect: true }),
        /Storage\.set\(practice_records\) is disabled/,
        'skipPracticeCoreRedirect 不能让 public set 写 practice_records'
    );
    assert.strictEqual(savedRecords[0].id, 'api-existing', 'skipPracticeCoreRedirect public set 不能改 canonical records');
    assert.strictEqual(readRawPracticeRecords(harness).some((record) => record && record.id === 'api-skip'), false,
        'skipPracticeCoreRedirect public set 不能写 raw practice_records');

    await assert.rejects(
        () => harness.persistentStore.set('user_stats', { totalPractices: 5 }, { skipReady: true }),
        /Storage\.set\(user_stats\) is disabled/,
        'skipReady 不能让 public set(user_stats) 写 stats'
    );
    assert.strictEqual(stats.totalPractices, 1, 'skipReady public set(user_stats) 不能改 canonical stats');

    await assert.rejects(
        () => harness.persistentStore.append('practice_records', { id: 'api-append', examId: 'reading-append' }),
        /Storage\.append\(practice_records\) is disabled/,
        'public append(practice_records) 必须禁用'
    );

    await assert.rejects(
        () => harness.persistentStore.remove('practice_records', { skipReady: true }),
        /Storage\.remove\(practice_records\) is disabled/,
        'skipReady 不能让 public remove(practice_records) 清空 records'
    );
    assert.strictEqual(savedRecords.length, 1, 'skipReady public remove(practice_records) 不能清空 canonical records');

    const callTypes = harness.calls.map((call) => call.type);
    assert(!callTypes.includes('api.replace'), 'public bypass options must not call PracticeRecordAPI.replace');
    assert(!callTypes.includes('api.clear'), 'public bypass options must not call PracticeRecordAPI.clear');
    assert(!callTypes.includes('api.writeStats'), 'public bypass options must not call PracticeRecordAPI.writeStats');
    assert(!callTypes.includes('api.resetStats'), 'public bypass options must not call PracticeRecordAPI.resetStats');
}

async function testCompressedRealDataKeepsOnlyCanonicalCorrectAnswerMap() {
    const harness = await createHarness();
    const compressed = harness.persistentStore.compressRealData({
        score: 1,
        totalQuestions: 2,
        accuracy: 0.5,
        percentage: 50,
        duration: 30,
        answers: { q1: 'A' },
        correctAnswerMap: { q1: 'A' },
        correctAnswers: { q1: 'B' },
        answerComparison: {
            q1: { userAnswer: 'A', correctAnswer: 'B', isCorrect: false }
        },
        isRealData: true,
        source: 'test'
    });

    assert.deepStrictEqual(compressed.correctAnswerMap, { q1: 'A' }, '压缩 realData 只能保留 canonical correctAnswerMap');
    assert.strictEqual(
        Object.prototype.hasOwnProperty.call(compressed, 'correctAnswers'),
        false,
        '压缩 realData 不能保留 legacy correctAnswers 对象'
    );
    assert.strictEqual(
        Object.prototype.hasOwnProperty.call(compressed.answerComparison.q1, 'correctAnswer'),
        false,
        '压缩 answerComparison 不能保留 correctAnswer 作为第二事实源'
    );
    assert.strictEqual(compressed.answerComparison.q1.isCorrect, false, '压缩 comparison 应保留已有正误显示结果');
}

async function testPublicStorageFacadeDoesNotFallbackToPracticeCore() {
    const harness = await createHarness();
    harness.window.PracticeCore = {
        store: {
            handlesStorageKey(key) {
                return key === 'practice_records' || key === 'user_stats';
            },
            async routeStorageSet() {
                throw new Error('public storage facade must not fallback to PracticeCore.store routeStorageSet');
            },
            async routeStorageRemove() {
                throw new Error('public storage facade must not fallback to PracticeCore.store routeStorageRemove');
            }
        }
    };

    await assert.rejects(
        () => harness.persistentStore.get('practice_records', []),
        /Storage\.get\(practice_records\): PracticeRecordAPI\.list not ready/,
        'API 缺失时 public storage.get(practice_records) 必须失败，不能返回默认值或读 raw store'
    );

    await assert.rejects(
        () => harness.persistentStore.set('practice_records', [{ id: 'must-not-write' }]),
        /Storage\.set\(practice_records\) is disabled/,
        'API 缺失时 public storage.set(practice_records) 必须失败'
    );
    assert.strictEqual(
        readRawPracticeRecords(harness).some((record) => record && record.id === 'must-not-write'),
        false,
        'API 缺失时 public storage.set(practice_records) 不能写 raw store'
    );

    await assert.rejects(
        () => harness.persistentStore.remove('practice_records'),
        /Storage\.remove\(practice_records\) is disabled/,
        'API 缺失时 public storage.remove(practice_records) 必须失败'
    );
}

async function testRestoreFromBackupFailsWithoutPracticeRecordAPI() {
    const harness = await createHarness();
    const result = await harness.persistentStore.restoreFromBackup();

    assert.strictEqual(result, false, '内置备份恢复缺少 PracticeRecordAPI 时应跳过失败');
    assert.strictEqual(
        readRawPracticeRecords(harness).some((record) => record && record.id === 'backup-record'),
        false,
        '内置备份恢复失败不能把备份记录写入 raw practice_records'
    );
}

async function main() {
    await testStorageDataSourceReadBypassesPublicPracticeRecordRedirect();
    await testRuntimeImportFailsWithoutPracticeRecordAPI();
    await testInternalStorageAccessIsNotWindowPublic();
    await testFullDataBootstrapHidesInternalPracticeRepositories();
    await testRuntimeImportUsesPracticeRecordAPI();
    await testPublicStorageFacadeReadsWithPracticeRecordAPIAndRejectsWrites();
    await testPublicBypassOptionsCannotWritePracticeData();
    await testCompressedRealDataKeepsOnlyCanonicalCorrectAnswerMap();
    await testPublicStorageFacadeDoesNotFallbackToPracticeCore();
    await testRestoreFromBackupFailsWithoutPracticeRecordAPI();

    process.stdout.write(JSON.stringify({
        status: 'pass',
        detail: 'StorageManager 运行期 records/stats 公开读只通过 PracticeRecordAPI，公开写入口 fail-fast'
    }));
}

main().catch((error) => {
    process.stdout.write(JSON.stringify({
        status: 'fail',
        detail: error && error.message ? error.message : String(error)
    }));
    process.exit(1);
});
