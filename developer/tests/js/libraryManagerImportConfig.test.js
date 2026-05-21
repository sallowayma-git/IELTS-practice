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
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    vm.runInContext(source, context, { filename: relativePath });
}

function clone(value) {
    if (value === undefined) {
        return undefined;
    }
    return JSON.parse(JSON.stringify(value));
}

function createHarness(seed = {}) {
    const storageState = new Map();
    const localStorageState = new Map();
    const appState = { examIndex: [] };
    Object.entries(seed.storage || {}).forEach(([key, value]) => {
        storageState.set(key, clone(value));
    });

    const localStorage = {
        getItem(key) {
            return localStorageState.has(key) ? localStorageState.get(key) : null;
        },
        setItem(key, value) {
            localStorageState.set(key, String(value));
        },
        removeItem(key) {
            localStorageState.delete(key);
        }
    };

    const windowStub = {
        console: { log() {}, warn() {}, error() {}, info() {} },
        localStorage,
        storage: {
            async get(key, fallback = null) {
                return storageState.has(key) ? clone(storageState.get(key)) : clone(fallback);
            },
            async set(key, value) {
                storageState.set(key, clone(value));
                return true;
            },
            async remove(key) {
                storageState.delete(key);
                return true;
            }
        },
        completeExamIndex: clone(seed.completeExamIndex || []),
        listeningExamIndex: clone(seed.listeningExamIndex || []),
        getExamIndexState() {
            return clone(appState.examIndex);
        },
        setExamIndexState(next) {
            appState.examIndex = clone(Array.isArray(next) ? next : []);
            return clone(appState.examIndex);
        },
        assignExamSequenceNumbers(list) {
            (Array.isArray(list) ? list : []).forEach((exam, index) => {
                if (exam && typeof exam === 'object') {
                    exam.sequenceNumber = index + 1;
                }
            });
        },
        setBrowseFilterState() {},
        setFilteredExamsState() {},
        updateSystemInfo() {},
        updateOverview() {},
        loadExamList() {},
        renderLibraryConfigList() {},
        showMessage() {},
        dispatchEvent() {}
    };

    const sandbox = {
        window: windowStub,
        globalThis: windowStub,
        console: windowStub.console,
        localStorage,
        CustomEvent: class CustomEvent {
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail;
            }
        },
        Date,
        Math,
        JSON,
        Map,
        Set,
        Array,
        Object,
        String,
        Number,
        Promise,
        encodeURIComponent,
        decodeURIComponent,
        setTimeout,
        clearTimeout
    };

    const context = vm.createContext(sandbox);
    loadScript('js/core/resourceCore.js', context);
    loadScript('js/services/libraryDiscovery.js', context);
    loadScript('js/services/libraryManager.js', context);
    return { window: windowStub, storageState, appState };
}

function baseSeed() {
    const readingA = {
        id: 'reading-a',
        examId: 'reading-a',
        type: 'reading',
        title: 'P1 Reading A',
        category: 'P1',
        path: 'ReadingCustom/A/',
        filename: 'a.html'
    };
    const listeningOld = {
        id: 'listening-old',
        examId: 'listening-old',
        type: 'listening',
        title: 'P2 Listening Old',
        category: 'P2',
        path: 'ListeningCustom/old/',
        filename: 'old.html',
        importKey: 'listening:old.html'
    };
    const records = [{
        id: 'record-keep',
        examId: 'reading-a',
        title: 'P1 Reading A',
        metadata: { category: 'P1', examType: 'reading' }
    }];

    return {
        readingA,
        listeningOld,
        records,
        storage: {
            active_exam_index_key: 'custom_active',
            custom_active: [readingA, listeningOld],
            exam_index: [readingA, listeningOld],
            exam_index_configurations: [
                { name: '当前题库', key: 'custom_active', examCount: 2, timestamp: 1 },
                { name: '默认题库', key: 'exam_index', examCount: 2, timestamp: 1 }
            ],
            practice_records: records
        },
        completeExamIndex: [readingA],
        listeningExamIndex: [listeningOld]
    };
}

const results = [];
function recordResult(name, detail) {
    results.push({ name, passed: true, detail, timestamp: new Date().toISOString() });
}

async function testFullListeningCreatesSnapshotAndKeepsReading() {
    const seed = baseSeed();
    const { window } = createHarness(seed);
    const manager = window.LibraryManager.getInstance();
    const listeningNew = {
        id: 'listening-new',
        examId: 'listening-new',
        type: 'listening',
        title: 'P2 Listening New',
        category: 'P2',
        path: 'Drop/new/',
        filename: 'new.html',
        importKey: 'listening:drop/new.html'
    };

    const created = await manager.createImportedLibraryConfiguration({
        type: 'listening',
        mode: 'full',
        additions: [listeningNew],
        label: 'drop',
        activate: true
    });

    assert.notStrictEqual(created.key, 'custom_active', '导入必须创建新配置，不能污染当前配置');
    assert.strictEqual(await window.storage.get('active_exam_index_key'), created.key, '新配置应成为活动配置');
    const oldConfig = await window.storage.get('custom_active');
    assert.deepStrictEqual(oldConfig, [seed.readingA, seed.listeningOld], '旧配置索引必须原样保留');
    const next = await window.storage.get(created.key);
    assert(next.some((exam) => exam.id === 'reading-a'), '听力全量导入必须继承阅读索引');
    assert(next.some((exam) => exam.id === 'listening-new'), '新听力题必须进入新配置');
    assert(!next.some((exam) => exam.id === 'listening-old'), '听力全量导入应替换旧听力索引');
    assert.deepStrictEqual(await window.storage.get('practice_records'), seed.records, '导入配置不能修改练习记录');
    assert.strictEqual(created.counts.reading, 1);
    assert.strictEqual(created.counts.listening, 1);

    recordResult('听力全量导入创建新配置并继承阅读', { key: created.key, counts: created.counts });
}

async function testFullReadingCreatesSnapshotAndKeepsListening() {
    const seed = baseSeed();
    const { window } = createHarness(seed);
    const manager = window.LibraryManager.getInstance();
    const readingNew = {
        id: 'reading-new',
        examId: 'reading-new',
        type: 'reading',
        title: 'P3 Reading New',
        category: 'P3',
        path: 'Drop/reading/',
        filename: 'reading.html',
        importKey: 'reading:drop/reading.html'
    };

    const created = await manager.createImportedLibraryConfiguration({
        type: 'reading',
        mode: 'full',
        additions: [readingNew],
        activate: true
    });

    const next = await window.storage.get(created.key);
    assert(next.some((exam) => exam.id === 'reading-new'), '阅读全量导入必须进入新配置');
    assert(!next.some((exam) => exam.id === 'reading-a'), '阅读全量导入应替换旧阅读索引');
    assert(next.some((exam) => exam.id === 'listening-old'), '阅读全量导入必须继承听力索引');
    assert.deepStrictEqual(await window.storage.get('custom_active'), [seed.readingA, seed.listeningOld], '旧配置不能被阅读全量改写');
    assert.deepStrictEqual(await window.storage.get('practice_records'), seed.records, '阅读导入不能修改练习记录');

    recordResult('阅读全量导入创建新配置并继承听力', { key: created.key, counts: created.counts });
}

async function testIncrementalCreatesSnapshotAndDedupes() {
    const seed = baseSeed();
    const { window } = createHarness(seed);
    const manager = window.LibraryManager.getInstance();
    const replacement = Object.assign({}, seed.listeningOld, {
        id: 'listening-old-replacement',
        title: 'P2 Listening Updated'
    });
    const extra = {
        id: 'listening-extra',
        examId: 'listening-extra',
        type: 'listening',
        title: 'P4 Listening Extra',
        category: 'P4',
        path: 'Drop/extra/',
        filename: 'extra.html',
        importKey: 'listening:drop/extra.html'
    };

    const created = await manager.createImportedLibraryConfiguration({
        type: 'listening',
        mode: 'incremental',
        additions: [replacement, extra],
        activate: true
    });

    assert.notStrictEqual(created.key, 'custom_active', '增量导入也必须创建新配置');
    assert.strictEqual(created.merge.updated, 1, '同 importKey 的题源应更新');
    assert.strictEqual(created.merge.added, 1, '新 importKey 的题源应追加');
    const next = await window.storage.get(created.key);
    assert(next.some((exam) => exam.id === 'reading-a'), '增量导入必须保留阅读索引');
    assert(next.some((exam) => exam.title === 'P2 Listening Updated'), '增量导入应更新旧题');
    assert(next.some((exam) => exam.id === 'listening-extra'), '增量导入应追加新题');
    assert(!next.some((exam) => exam.id === 'listening-old'), '同 importKey 旧题不应重复保留');
    assert.deepStrictEqual(await window.storage.get('custom_active'), [seed.readingA, seed.listeningOld], '增量导入不能改写原活动配置');
    assert.deepStrictEqual(await window.storage.get('practice_records'), seed.records, '增量导入不能修改练习记录');

    recordResult('增量导入创建新配置并按 importKey 去重更新', { key: created.key, merge: created.merge });
}

async function testSwitchConfigurationDoesNotTouchPracticeRecords() {
    const seed = baseSeed();
    seed.storage.alt_config = [{
        id: 'listening-alt',
        examId: 'listening-alt',
        type: 'listening',
        title: 'Alt Listening',
        category: 'P1',
        path: 'Alt/',
        filename: 'alt.html'
    }];
    seed.storage.exam_index_configurations.push({ name: 'Alt', key: 'alt_config', examCount: 1, timestamp: 2 });

    const { window } = createHarness(seed);
    const manager = window.LibraryManager.getInstance();
    const before = await window.storage.get('practice_records');
    const applied = await manager.applyLibraryConfiguration('alt_config');

    assert.strictEqual(applied, true, '配置切换应该成功');
    assert.strictEqual(await window.storage.get('active_exam_index_key'), 'alt_config', '活动配置应切换到目标配置');
    assert.deepStrictEqual(await window.storage.get('practice_records'), before, '配置切换不能触碰练习记录');

    recordResult('切换题库配置不触碰练习记录', { activeKey: 'alt_config' });
}

async function main() {
    try {
        await testFullListeningCreatesSnapshotAndKeepsReading();
        await testFullReadingCreatesSnapshotAndKeepsListening();
        await testIncrementalCreatesSnapshotAndDedupes();
        await testSwitchConfigurationDoesNotTouchPracticeRecords();
        console.log(JSON.stringify({
            status: 'pass',
            detail: `${results.length}/${results.length} 测试通过`,
            passed: results.length,
            total: results.length,
            results
        }, null, 2));
    } catch (error) {
        console.log(JSON.stringify({
            status: 'fail',
            detail: error.message,
            results,
            stack: error.stack
        }, null, 2));
        process.exit(1);
    }
}

main();
