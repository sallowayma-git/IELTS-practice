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
    const librarySeed = seed.library && typeof seed.library === 'object' ? seed.library : {};
    const indexes = new Map(Object.entries(librarySeed.importedIndexes || {}).map(([id, value]) => [String(id), clone(value)]));
    let activeId = typeof librarySeed.activeConfigurationId === 'string' && librarySeed.activeConfigurationId.trim()
        ? librarySeed.activeConfigurationId.trim()
        : null;
    let configurations = (Array.isArray(librarySeed.configurations) ? librarySeed.configurations : [])
        .filter((config) => config && (config.id || config.key))
        .map((config) => Object.assign({}, clone(config), { id: config.id || config.key }));
    const practiceRecords = clone(seed.records || []);
    const defaultReadingIndex = clone(seed.readingExamIndex || []);
    let resourceBasePrefix = '';

    const AppData = {
        ready: Promise.resolve(),
        library: {
            async getActive() { return activeId; },
            async activate(id) {
                activeId = typeof id === 'string' && id.trim() ? id.trim() : null;
                return { committed: true };
            },
            async listConfigurations() { return clone(configurations); },
            async updateConfiguration(config) {
                const id = String(config?.id || config?.key || '').trim();
                if (!id) throw new Error('configuration id required');
                const next = Object.assign({}, clone(config), { id, key: id });
                const index = configurations.findIndex((item) => item && (item.id === id || item.key === id));
                if (index >= 0) configurations[index] = next;
                else configurations.push(next);
                return { committed: true };
            },
            async getIndex(id) { return clone(indexes.get(String(id || '')) || []); },
            async resolveIndex() { return activeId ? clone(indexes.get(activeId) || []) : []; },
            async import({ id, configuration, index }) {
                const normalizedId = String(id || '').trim();
                indexes.set(normalizedId, clone(Array.isArray(index) ? index : []));
                await this.updateConfiguration(Object.assign({}, configuration || {}, { id: normalizedId, key: normalizedId }));
                return { committed: true };
            },
            async remove(id) {
                const normalizedId = String(id || '').trim();
                indexes.delete(normalizedId);
                configurations = configurations.filter((item) => item && item.id !== normalizedId && item.key !== normalizedId);
                return { committed: true };
            }
        },
        practice: {
            async list() { return clone(practiceRecords); }
        },
        preferences: {
            async getResourceBasePrefix() { return resourceBasePrefix; },
            async setResourceBasePrefix(value) { resourceBasePrefix = String(value || ''); }
        }
    };

    const windowStub = {
        console: { log() {}, warn() {}, error() {}, info() {} },
        AppData,
        __READING_EXAM_INDEX__: clone(defaultReadingIndex),
        getReadingExamIndex() {
            return clone(defaultReadingIndex);
        },
        listeningExamIndex: clone(seed.listeningExamIndex || []),
        __LISTENING_EXAM_MANIFEST__: clone(seed.listeningManifest),
        __defaultListeningLibraryAvailable: typeof seed.defaultListeningAvailable === 'boolean'
            ? seed.defaultListeningAvailable
            : undefined,
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
    if (seed.ensureExamDataScriptsRejects) {
        windowStub.ensureExamDataScripts = async function ensureExamDataScripts() {
            throw new Error('simulated optional listening load failure');
        };
    }

    const sandbox = {
        window: windowStub,
        globalThis: windowStub,
        console: windowStub.console,
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
    if (seed.useAppStateService) {
        loadScript('js/app/state-service.js', context);
    }
    loadScript('js/services/libraryDiscovery.js', context);
    loadScript('js/services/libraryManager.js', context);
    return { window: windowStub, indexes, getActiveId: () => activeId, getConfigurations: () => clone(configurations) };
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
        library: {
            activeConfigurationId: 'custom_active',
            importedIndexes: { custom_active: [readingA, listeningOld] },
            configurations: [
                { id: 'custom_active', name: '当前题库', key: 'custom_active', examCount: 2, timestamp: 1 }
            ]
        },
        records,
        readingExamIndex: [readingA],
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
    assert.strictEqual(await window.AppData.library.getActive(), created.key, '新配置应成为活动配置');
    const oldConfig = await window.AppData.library.getIndex('custom_active');
    assert.deepStrictEqual(oldConfig, [seed.readingA, seed.listeningOld], '旧配置索引必须原样保留');
    const next = await window.AppData.library.getIndex(created.key);
    assert(next.some((exam) => exam.id === 'reading-a'), '听力全量导入必须继承阅读索引');
    assert(next.some((exam) => exam.id === 'listening-new'), '新听力题必须进入新配置');
    assert(!next.some((exam) => exam.id === 'listening-old'), '听力全量导入应替换旧听力索引');
    assert.deepStrictEqual(await window.AppData.practice.list(), seed.records, '导入配置不能修改练习记录');
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

    const next = await window.AppData.library.getIndex(created.key);
    assert(next.some((exam) => exam.id === 'reading-new'), '阅读全量导入必须进入新配置');
    assert(!next.some((exam) => exam.id === 'reading-a'), '阅读全量导入应替换旧阅读索引');
    assert(next.some((exam) => exam.id === 'listening-old'), '阅读全量导入必须继承听力索引');
    assert.deepStrictEqual(await window.AppData.library.getIndex('custom_active'), [seed.readingA, seed.listeningOld], '旧配置不能被阅读全量改写');
    assert.deepStrictEqual(await window.AppData.practice.list(), seed.records, '阅读导入不能修改练习记录');

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
    const next = await window.AppData.library.getIndex(created.key);
    assert(next.some((exam) => exam.id === 'reading-a'), '增量导入必须保留阅读索引');
    assert(next.some((exam) => exam.title === 'P2 Listening Updated'), '增量导入应更新旧题');
    assert(next.some((exam) => exam.id === 'listening-extra'), '增量导入应追加新题');
    assert(!next.some((exam) => exam.id === 'listening-old'), '同 importKey 旧题不应重复保留');
    assert.deepStrictEqual(await window.AppData.library.getIndex('custom_active'), [seed.readingA, seed.listeningOld], '增量导入不能改写原活动配置');
    assert.deepStrictEqual(await window.AppData.practice.list(), seed.records, '增量导入不能修改练习记录');

    recordResult('增量导入创建新配置并按 importKey 去重更新', { key: created.key, merge: created.merge });
}

async function testSwitchConfigurationDoesNotTouchPracticeRecords() {
    const seed = baseSeed();
    seed.useAppStateService = true;
    seed.library.importedIndexes.alt_config = [{
        id: 'listening-alt',
        examId: 'listening-alt',
        type: 'listening',
        title: 'Alt Listening',
        category: 'P1',
        path: 'Alt/',
        filename: 'alt.html'
    }];
    seed.library.configurations.push({ id: 'alt_config', name: 'Alt', key: 'alt_config', examCount: 1, timestamp: 2 });

    const { window } = createHarness(seed);
    const manager = window.LibraryManager.getInstance();
    const before = await window.AppData.practice.list();
    const revisionBeforeSwitch = window.getBrowseFilterMutationRevision();
    const publicationOrder = [];
    window.dispatchEvent = function dispatchEvent(event) {
        if (event && event.type === 'examIndexLoaded') {
            publicationOrder.push('index-publication');
        }
        return true;
    };
    window.startPracticeRecordsSyncInBackground = function startPracticeRecordsSyncInBackground(
        trigger,
        options
    ) {
        publicationOrder.push(`progress-sync:${trigger}:${options?.forceRender === true}`);
    };
    const applied = await manager.applyLibraryConfiguration('alt_config');

    assert.strictEqual(applied, true, '配置切换应该成功');
    assert.strictEqual(await window.AppData.library.getActive(), 'alt_config', '活动配置应切换到目标配置');
    assert.deepStrictEqual(await window.AppData.practice.list(), before, '配置切换不能触碰练习记录');
    assert.strictEqual(
        window.getBrowseFilterMutationRevision(),
        revisionBeforeSwitch + 1,
        '配置切换的权威 all/all 写入必须使首次 Browse hydration 失效'
    );
    assert.deepStrictEqual(
        clone(window.getBrowseFilterState()),
        { category: 'all', type: 'all' },
        '配置切换后实时筛选状态必须保持 all/all'
    );
    assert.deepStrictEqual(
        publicationOrder,
        ['index-publication', 'progress-sync:library-loaded:true'],
        'direct configuration switches must publish the new index epoch before requesting progress sync'
    );

    recordResult('切换题库配置不触碰练习记录', { activeKey: 'alt_config' });
}

async function testDeleteInactiveConfigurationCleansDatasetAndPathMap() {
    const seed = baseSeed();
    seed.library.importedIndexes.delete_me = [{
        id: 'delete-me-listening',
        examId: 'delete-me-listening',
        type: 'listening',
        title: 'Delete Me Listening',
        category: 'P2',
        path: 'DeleteMe/',
        filename: 'delete.html'
    }];
    seed.library.configurations.push({ id: 'delete_me', name: 'Delete Me', key: 'delete_me', examCount: 1, timestamp: 3 });

    const { window } = createHarness(seed);
    const manager = window.LibraryManager.getInstance();
    const before = await window.AppData.practice.list();
    const result = await manager.deleteLibraryConfiguration('delete_me');

    assert.strictEqual(result.deleted, true, '非活动自定义配置应允许删除');
    assert.deepStrictEqual(await window.AppData.library.getIndex('delete_me'), [], '删除配置时必须删除对应题库数据集');
    const configs = await window.AppData.library.listConfigurations();
    assert(!configs.some((config) => config && config.key === 'delete_me'), '配置列表中不应残留已删除配置');
    assert.deepStrictEqual(await window.AppData.practice.list(), before, '删除题库配置不能删除练习记录');
    assert.strictEqual(await window.AppData.library.getActive(), 'custom_active', '删除非活动配置不能改变当前活动配置');

    recordResult('删除非活动配置会清理数据集和 path map 且保留练习记录', { key: 'delete_me' });
}

async function testDeleteConfigurationGuardsDefaultAndActive() {
    const seed = baseSeed();
    const { window } = createHarness(seed);
    const manager = window.LibraryManager.getInstance();
    const beforeConfigs = await window.AppData.library.listConfigurations();
    const beforeRecords = await window.AppData.practice.list();

    const defaultResult = await manager.deleteLibraryConfiguration('');
    const activeResult = await manager.deleteLibraryConfiguration('custom_active');

    assert.strictEqual(defaultResult.deleted, false, '默认配置不能删除');
    assert.strictEqual(defaultResult.reason, 'invalid-key', 'nullable 默认配置没有可删除实体，应返回 invalid-key');
    assert.strictEqual(activeResult.deleted, false, '当前活动配置不能删除');
    assert.strictEqual(activeResult.reason, 'active-config', '活动配置删除应返回明确原因');
    assert.deepStrictEqual(await window.AppData.library.listConfigurations(), beforeConfigs, '受保护配置删除不应改写配置列表');
    assert.deepStrictEqual(await window.AppData.practice.list(), beforeRecords, '受保护配置删除不应改写练习记录');

    recordResult('删除配置保护默认和当前活动配置', {
        defaultReason: defaultResult.reason,
        activeReason: activeResult.reason
    });
}

async function testDefaultLibrarySkipsListeningWithoutManifest() {
    const readingDefault = {
        id: 'default-reading',
        examId: 'default-reading',
        type: 'reading',
        title: 'Default Reading',
        category: 'P1',
        path: 'Reading/default/',
        filename: 'reading.html'
    };
    const listeningDefault = {
        id: 'default-listening',
        examId: 'default-listening',
        type: 'listening',
        title: 'Default Listening',
        category: 'P1',
        path: 'P1/default/',
        filename: 'listening.html'
    };
    const { window } = createHarness({
        readingExamIndex: [readingDefault],
        listeningExamIndex: [listeningDefault],
        defaultListeningAvailable: false
    });
    const manager = window.LibraryManager.getInstance();
    const loaded = await manager.loadActiveLibrary(true);

    assert(loaded.some((exam) => exam.id === 'default-reading'), '默认阅读必须继续加载');
    assert(!loaded.some((exam) => exam.type === 'listening'), 'manifest 缺失时默认听力不能进入题库');
    assert.strictEqual(window.LibraryManager.isBuiltInListeningLibraryAvailable(), false, '内置听力可用性应为 false');

    recordResult('manifest 缺失时默认题库跳过内置听力', { loadedCount: loaded.length });
}

async function testDefaultLibraryKeepsListeningWithManifest() {
    const readingDefault = {
        id: 'default-reading',
        examId: 'default-reading',
        type: 'reading',
        title: 'Default Reading',
        category: 'P1',
        path: 'Reading/default/',
        filename: 'reading.html'
    };
    const listeningDefault = {
        id: 'default-listening',
        examId: 'default-listening',
        type: 'listening',
        title: 'Default Listening',
        category: 'P2',
        path: 'P2/default/',
        filename: 'listening.html'
    };
    const { window } = createHarness({
        readingExamIndex: [readingDefault],
        listeningExamIndex: [listeningDefault],
        listeningManifest: { 'default-listening': { examId: 'default-listening' } },
        defaultListeningAvailable: true
    });
    const manager = window.LibraryManager.getInstance();
    const loaded = await manager.loadActiveLibrary(true);

    assert(loaded.some((exam) => exam.id === 'default-reading'), '默认阅读必须加载');
    assert(loaded.some((exam) => exam.id === 'default-listening'), 'manifest 存在时默认听力应进入题库');
    assert.strictEqual(window.LibraryManager.isBuiltInListeningLibraryAvailable(), true, '内置听力可用性应为 true');

    recordResult('manifest 存在时默认题库加载内置听力', { loadedCount: loaded.length });
}

async function testBrokenLegacyActiveLibraryFallsBackToReadingManifest() {
    const readingDefault = {
        id: 'default-reading-after-repair',
        examId: 'default-reading-after-repair',
        type: 'reading',
        title: 'Default Reading After Repair',
        category: 'P1',
        path: 'Reading/default-repair/',
        filename: 'reading.html'
    };
    const { window, getActiveId } = createHarness({
        library: {
            activeConfigurationId: 'exam_index',
            configurations: [{ id: 'exam_index', key: 'exam_index', name: '错误迁移的默认题库' }],
            importedIndexes: {}
        },
        readingExamIndex: [readingDefault],
        defaultListeningAvailable: false
    });
    const manager = window.LibraryManager.getInstance();
    const loaded = await manager.loadActiveLibrary(true);

    assert.deepStrictEqual(loaded.map((exam) => exam.id), ['default-reading-after-repair'], 'a broken v1 active key must not hide the generated Reading manifest');
    assert.strictEqual(getActiveId(), 'exam_index', 'display fallback must not rewrite persistent selection state');
    recordResult('错误迁移的 v1 活动题库回退 Reading manifest', { loadedCount: loaded.length });
}

async function testForceReloadKeepsHealthyCustomLibraryActive() {
    const customExam = {
        id: 'healthy-custom-reading',
        examId: 'healthy-custom-reading',
        type: 'reading',
        title: 'Healthy Custom Reading',
        category: 'P1',
        path: 'Imported/healthy/',
        filename: 'reading.html'
    };
    const { window, getActiveId } = createHarness({
        library: {
            activeConfigurationId: 'healthy-custom',
            configurations: [{ id: 'healthy-custom', key: 'healthy-custom', name: '健康自定义题库' }],
            importedIndexes: { 'healthy-custom': [customExam] }
        },
        readingExamIndex: [{ id: 'default-must-not-replace-custom', type: 'reading' }]
    });
    const loaded = await window.LibraryManager.getInstance().loadActiveLibrary(true);

    assert.deepStrictEqual(loaded.map((exam) => exam.id), ['healthy-custom-reading']);
    assert.strictEqual(getActiveId(), 'healthy-custom', 'force reload must not switch a healthy custom library to default');
    recordResult('强制刷新保留健康自定义题库', { loadedCount: loaded.length });
}

async function testFullReadingDoesNotReAddDefaultListeningWhenManifestMissing() {
    const readingNew = {
        id: 'reading-new-default',
        examId: 'reading-new-default',
        type: 'reading',
        title: 'Reading New Default',
        category: 'P2',
        path: 'Drop/reading-default/',
        filename: 'reading.html',
        importKey: 'reading:drop/reading-default.html'
    };
    const defaultListening = {
        id: 'default-listening-hidden',
        examId: 'default-listening-hidden',
        type: 'listening',
        title: 'Hidden Default Listening',
        category: 'P3',
        path: 'P3/hidden/',
        filename: 'hidden.html'
    };
    const { window } = createHarness({
        readingExamIndex: [],
        listeningExamIndex: [defaultListening],
        defaultListeningAvailable: false
    });
    const manager = window.LibraryManager.getInstance();
    const created = await manager.createImportedLibraryConfiguration({
        type: 'reading',
        mode: 'full',
        additions: [readingNew],
        activate: true
    });
    const next = await window.AppData.library.getIndex(created.key);

    assert(next.some((exam) => exam.id === 'reading-new-default'), '阅读导入应保存新阅读');
    assert(!next.some((exam) => exam.id === 'default-listening-hidden'), 'manifest 缺失时阅读全量导入不能补回默认听力');
    assert.strictEqual(created.counts.listening, 0, '导入配置听力数量应为 0');

    recordResult('阅读全量导入不会补回缺 manifest 的默认听力', { key: created.key, counts: created.counts });
}

async function testRecordResolverUsesStoredLibraryProvenance() {
    const defaultExam = {
        id: 'shared-exam-id',
        examId: 'shared-exam-id',
        type: 'reading',
        title: 'Default source',
        category: 'P1',
        path: 'Reading/default-source/'
    };
    const importedExam = Object.assign({}, defaultExam, {
        title: 'Imported source',
        category: 'P4',
        path: 'Reading/imported-source/'
    });
    const { window } = createHarness({
        library: {
            activeConfigurationId: 'library_imported_source',
            configurations: [{ id: 'library_imported_source', key: 'library_imported_source', name: 'Imported source' }],
            importedIndexes: { library_imported_source: [importedExam] }
        },
        readingExamIndex: [defaultExam]
    });

    const defaultResolved = await window.resolveExamForPracticeRecord({
        examId: 'shared-exam-id',
        metadata: { libraryConfigurationId: null }
    });
    const importedResolved = await window.resolveExamForPracticeRecord({
        examId: 'shared-exam-id',
        metadata: { libraryConfigurationId: 'library_imported_source' }
    });
    const unknownResolved = await window.resolveExamForPracticeRecord({ examId: 'shared-exam-id' });

    assert.strictEqual(defaultResolved.title, 'Default source', 'default provenance must not use the active imported library');
    assert.strictEqual(importedResolved.title, 'Imported source', 'imported provenance must resolve its own authoritative index');
    assert.strictEqual(unknownResolved, null, 'with custom libraries present, a provenance-less legacy record must not guess the active library and risk resolving a shared examId to the wrong exam');
    recordResult('历史记录按保存的题库 provenance 解析', {
        defaultTitle: defaultResolved.title,
        importedTitle: importedResolved.title
    });
}

// Conditional-downgrade contract: a v1-migrated record that never got a
// libraryConfigurationId must still be replayable when the user has NO custom
// libraries — the examId can only mean the one default-library exam, so falling
// back to the active index is safe and restores v1 behavior. This guards against
// the v2 hard gate that made every provenance-less legacy record fail to open.
async function testRecordResolverFallsBackForLegacyRecordsWhenNoCustomLibraries() {
    const defaultExam = {
        id: 'legacy-exam-id',
        examId: 'legacy-exam-id',
        type: 'reading',
        title: 'Default source',
        category: 'P1',
        path: 'Reading/default-source/'
    };
    const { window } = createHarness({
        library: {
            activeConfigurationId: null,
            configurations: [],
            importedIndexes: {}
        },
        readingExamIndex: [defaultExam]
    });

    const resolved = await window.resolveExamForPracticeRecord({ examId: 'legacy-exam-id' });

    assert.ok(resolved, 'a provenance-less legacy record must still resolve when no custom library can cause ambiguity');
    assert.strictEqual(resolved.title, 'Default source', 'the fallback must resolve against the active (default) library');
    recordResult('无自定义题库时旧记录回退当前题库解析', { title: resolved.title });
}

async function testLibraryPublishesIndexBeforeProgressSync() {
    const { window } = createHarness(baseSeed());
    const order = [];
    window.dispatchEvent = function dispatchEvent(event) {
        if (event && event.type === 'examIndexLoaded') {
            order.push('index-publication');
        }
        return true;
    };
    window.startPracticeRecordsSyncInBackground = function startPracticeRecordsSyncInBackground() {
        order.push('progress-sync');
    };

    window.LibraryManager.getInstance().finishLibraryLoading(Date.now(), [
        { id: 'published-index', type: 'reading', category: 'P1' }
    ]);

    assert.deepStrictEqual(
        order,
        ['index-publication', 'progress-sync'],
        'a new library index epoch must be published before its progress sync captures ownership'
    );
    recordResult('题库索引先于同轮进度同步发布', { order });
}

async function main() {
    try {
        await testFullListeningCreatesSnapshotAndKeepsReading();
        await testFullReadingCreatesSnapshotAndKeepsListening();
        await testIncrementalCreatesSnapshotAndDedupes();
        await testSwitchConfigurationDoesNotTouchPracticeRecords();
        await testDeleteInactiveConfigurationCleansDatasetAndPathMap();
        await testDeleteConfigurationGuardsDefaultAndActive();
        await testDefaultLibrarySkipsListeningWithoutManifest();
        await testDefaultLibraryKeepsListeningWithManifest();
        await testBrokenLegacyActiveLibraryFallsBackToReadingManifest();
        await testForceReloadKeepsHealthyCustomLibraryActive();
        await testFullReadingDoesNotReAddDefaultListeningWhenManifestMissing();
        await testRecordResolverUsesStoredLibraryProvenance();
        await testRecordResolverFallsBackForLegacyRecordsWhenNoCustomLibraries();
        await testLibraryPublishesIndexBeforeProgressSync();
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
