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

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((done, fail) => {
        resolve = done;
        reject = fail;
    });
    return { promise, resolve, reject };
}

const RENDEZVOUS_TIMEOUT_MS = 2000;

function withTimeout(promise, label, timeoutMs = RENDEZVOUS_TIMEOUT_MS) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });
    return Promise.race([Promise.resolve(promise), timeout])
        .finally(() => clearTimeout(timer));
}

function loadMainBlock(context, startMarker, endMarker, label) {
    const source = fs.readFileSync(path.join(repoRoot, 'js/main.js'), 'utf8');
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert(start >= 0 && end > start, `unable to locate ${label} in js/main.js`);
    vm.runInContext(source.slice(start, end), context, { filename: `js/main.js#${label}` });
}

function loadSourceBlock(relativePath, context, startMarker, endMarker, label) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert(start >= 0 && end > start, `unable to locate ${label} in ${relativePath}`);
    vm.runInContext(source.slice(start, end), context, { filename: `${relativePath}#${label}` });
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
    const deferReadingExamIndex = seed.deferReadingExamIndex === true;
    const controlReadingExamIndex = seed.controlReadingExamIndex === true;
    const manifestStarted = createDeferred();
    const manifestRelease = createDeferred();
    let manifestRequestStarted = false;
    let examDataScriptLoads = 0;
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
    const installReadingExamIndex = () => {
        windowStub.__READING_EXAM_INDEX__ = clone(defaultReadingIndex);
        windowStub.getReadingExamIndex = function getReadingExamIndex() {
            return clone(defaultReadingIndex);
        };
    };
    if (!deferReadingExamIndex) {
        installReadingExamIndex();
    }
    if (seed.ensureExamDataScriptsRejects) {
        windowStub.ensureExamDataScripts = async function ensureExamDataScripts() {
            throw new Error('simulated optional listening load failure');
        };
    } else if (deferReadingExamIndex && controlReadingExamIndex) {
        windowStub.ensureExamDataScripts = async function ensureExamDataScripts() {
            examDataScriptLoads += 1;
            if (!manifestRequestStarted) {
                manifestRequestStarted = true;
                manifestStarted.resolve();
            }
            await manifestRelease.promise;
            installReadingExamIndex();
        };
    } else if (deferReadingExamIndex) {
        windowStub.ensureExamDataScripts = async function ensureExamDataScripts() {
            examDataScriptLoads += 1;
            await Promise.resolve();
            installReadingExamIndex();
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
    return {
        window: windowStub,
        context,
        indexes,
        getActiveId: () => activeId,
        getConfigurations: () => clone(configurations),
        getExamDataScriptLoads: () => examDataScriptLoads,
        waitForReadingManifestRequest: () => manifestStarted.promise,
        releaseReadingManifest: () => manifestRelease.resolve()
    };
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

function availabilityRegressionSeed() {
    const key = 'pre_upgrade_mixed';
    const currentMissingPdf = {
        id: 'p2-medium-243',
        examId: 'p2-medium-243',
        type: 'reading',
        title: 'Current Missing PDF',
        category: 'P2',
        path: 'Generated/missing/',
        filename: 'reading-practice-unified.html',
        sourceKind: 'generated-reading',
        hasHtml: true,
        hasPdf: false,
        pdfFilename: 'ReadingPractice/PDF/P2 - The internal body clock 生物钟.pdf'
    };
    const currentAvailablePdf = {
        id: 'p1-high-01',
        examId: 'p1-high-01',
        type: 'reading',
        title: 'Current Available PDF',
        category: 'P1',
        path: 'Generated/available/',
        filename: 'available.html',
        sourceKind: 'generated-reading',
        hasHtml: true,
        hasPdf: true,
        pdfFilename: 'ReadingPractice/PDF/available.pdf'
    };
    const currentCollisionPdf = {
        id: 'p3-high-03',
        examId: 'p3-high-03',
        type: 'reading',
        title: 'Current Manifest Collision',
        category: 'P3',
        path: 'Generated/collision/',
        filename: 'collision.html',
        sourceKind: 'generated-reading',
        hasHtml: true,
        hasPdf: false,
        pdfFilename: 'ReadingPractice/PDF/manifest-collision.pdf'
    };
    const persistedIndex = [
        Object.assign({}, currentMissingPdf, { hasPdf: true, snapshotMarker: 'keep-missing-row' }),
        Object.assign({}, currentAvailablePdf, { hasPdf: false, snapshotMarker: 'keep-available-row' }),
        {
            id: 'legacy-file-picker-pdf',
            type: 'reading',
            title: 'Legacy selected PDF',
            category: 'P1',
            path: 'Imported/legacy-pdf/',
            sourceKind: 'file-picker',
            importKey: 'reading:legacy-pdf',
            pdfFilename: '  selected-reading.pdf  '
        },
        {
            id: 'legacy-file-picker-no-pdf',
            type: 'reading',
            title: 'Legacy selection without PDF',
            category: 'P2',
            path: 'Imported/legacy-no-pdf/',
            sourceKind: 'file-picker',
            importKey: 'reading:legacy-no-pdf',
            pdfFilename: '   '
        },
        {
            id: 'p3-high-03',
            type: 'reading',
            title: 'File picker sharing a manifest ID',
            category: 'P3',
            path: 'Imported/manifest-id-collision/',
            sourceKind: 'file-picker',
            importKey: 'reading:manifest-id-collision',
            pdfFilename: 'selected-manifest-id-collision.pdf'
        },
        {
            id: 'explicit-file-picker-unavailable',
            type: 'reading',
            title: 'Explicitly unavailable selected PDF',
            category: 'P2',
            path: 'Imported/explicit-unavailable/',
            sourceKind: 'file-picker',
            importKey: 'reading:explicit-unavailable',
            hasPdf: false,
            pdfFilename: 'selected-but-disabled.pdf'
        },
        {
            id: 'explicit-file-picker-available',
            type: 'reading',
            title: 'Explicitly available selected PDF',
            category: 'P3',
            path: 'Imported/explicit-available/',
            sourceKind: 'file-picker',
            importKey: 'reading:explicit-available',
            hasPdf: true,
            pdfFilename: ''
        },
        {
            id: 'non-file-picker-with-locator',
            type: 'reading',
            title: 'Non file picker without availability flag',
            category: 'P3',
            path: 'Imported/non-file-picker/',
            sourceKind: 'pdf-only',
            pdfFilename: 'must-not-be-inferred.pdf'
        },
        {
            id: 'unknown-generated-reading',
            type: 'reading',
            title: 'Unknown generated row',
            category: 'P1',
            path: 'Generated/unknown/',
            sourceKind: 'generated-reading',
            hasPdf: true,
            pdfFilename: 'unknown.pdf'
        },
        {
            id: 'legacy-listening-file-picker',
            type: 'listening',
            title: 'Legacy listening selection',
            category: 'P4',
            path: 'Imported/listening/',
            sourceKind: 'file-picker',
            importKey: 'listening:legacy-pdf',
            pdfFilename: 'selected-listening.pdf'
        }
    ];

    return {
        key,
        persistedIndex,
        seed: {
            library: {
                activeConfigurationId: key,
                importedIndexes: { [key]: persistedIndex },
                configurations: [{ id: key, key, name: '升级前混合题库', examCount: persistedIndex.length }]
            },
            readingExamIndex: [currentMissingPdf, currentAvailablePdf, currentCollisionPdf],
            defaultListeningAvailable: false
        }
    };
}

function assertAvailabilityReconciled(index, configurationId) {
    const rows = Array.isArray(index) ? index : [];
    const byId = (id) => {
        const row = rows.find((item) => item && item.id === id);
        assert(row, `missing normalized row: ${id}`);
        return row;
    };

    assert.strictEqual(rows.length, 10, 'normalization must preserve every mixed-snapshot row');
    assert.strictEqual(byId('p2-medium-243').hasPdf, false, 'current manifest false must override a stale generated-reading true');
    assert.strictEqual(byId('p2-medium-243').pdfFilename, 'ReadingPractice/PDF/P2 - The internal body clock 生物钟.pdf', 'manifest reconciliation must retain the expected locator');
    assert.strictEqual(byId('p2-medium-243').snapshotMarker, 'keep-missing-row', 'manifest reconciliation must not replace the persisted row');
    assert.strictEqual(byId('p1-high-01').hasPdf, true, 'current manifest true must override a stale generated-reading false');
    assert.strictEqual(byId('p1-high-01').snapshotMarker, 'keep-available-row', 'bidirectional reconciliation must preserve snapshot metadata');

    assert.strictEqual(byId('legacy-file-picker-pdf').hasPdf, true, 'legacy file-picker rows with a trimmed locator must be backfilled as available');
    assert.strictEqual(byId('legacy-file-picker-pdf').pdfFilename, '  selected-reading.pdf  ', 'availability inference must not rewrite the stored locator');
    assert.strictEqual(byId('legacy-file-picker-no-pdf').hasPdf, false, 'legacy file-picker rows with only whitespace must be backfilled as unavailable');
    assert.strictEqual(byId('p3-high-03').hasPdf, true, 'a file-picker row sharing a manifest ID must use its own locator instead of manifest authority');
    assert.strictEqual(byId('explicit-file-picker-unavailable').hasPdf, false, 'an explicit false flag must not be overridden by a locator');
    assert.strictEqual(byId('explicit-file-picker-available').hasPdf, true, 'an explicit true flag must not be overridden by an empty locator');
    assert.strictEqual(
        Object.prototype.hasOwnProperty.call(byId('non-file-picker-with-locator'), 'hasPdf'),
        false,
        'non-file-picker rows must not receive inferred availability'
    );
    assert.strictEqual(byId('unknown-generated-reading').hasPdf, true, 'generated rows without an exact current manifest ID must remain untouched');
    assert.strictEqual(byId('legacy-listening-file-picker').hasPdf, true, 'legacy file-picker inference must survive in a mixed reading/listening snapshot');
    rows.forEach((row) => {
        assert.strictEqual(row.libraryConfigurationId, configurationId, 'published rows must retain their active-library provenance');
    });
}

function createLatestIntentRaceHarness() {
    const canonicalA = {
        id: 'race-a',
        examId: 'race-a',
        type: 'reading',
        sourceKind: 'generated-reading',
        title: 'Delayed A',
        category: 'P1',
        path: 'Race/A/',
        filename: 'a.html',
        hasPdf: false,
        pdfFilename: 'a.pdf'
    };
    const delayedA = Object.assign({}, canonicalA, { hasPdf: true });
    const immediateB = {
        id: 'race-b',
        examId: 'race-b',
        type: 'reading',
        sourceKind: 'file-picker',
        title: 'Immediate B',
        category: 'P2',
        path: 'Race/B/',
        filename: 'b.html',
        hasPdf: true,
        pdfFilename: 'b.pdf'
    };
    const harness = createHarness({
        deferReadingExamIndex: true,
        controlReadingExamIndex: true,
        readingExamIndex: [canonicalA],
        library: {
            activeConfigurationId: 'race_a',
            importedIndexes: {
                race_a: [delayedA],
                race_b: [immediateB]
            },
            configurations: [
                { id: 'race_a', key: 'race_a', name: 'Race A', examCount: 1, timestamp: 11 },
                { id: 'race_b', key: 'race_b', name: 'Race B', examCount: 1, timestamp: 22 }
            ]
        }
    });
    const { window } = harness;
    const effects = {
        publications: [],
        overviews: [],
        systemInfo: [],
        examLists: [],
        listeningAvailability: [],
        progressSyncs: [],
        filterStates: [],
        filteredIndexes: [],
        configRenders: [],
        configRenderGuards: [],
        messages: [],
        activations: [],
        configurationUpdates: [],
        pathMapSaves: []
    };
    const ids = (index) => clone(index).map((exam) => exam.id);

    window.dispatchEvent = function dispatchEvent(event) {
        if (event && event.type === 'examIndexLoaded') {
            const index = clone(event.detail.index);
            effects.publications.push({
                key: event.detail.key ?? null,
                ids: index.map((exam) => exam.id),
                provenance: index.map((exam) => exam.libraryConfigurationId)
            });
        }
        return true;
    };
    window.updateOverview = (index) => effects.overviews.push(ids(index));
    window.updateSystemInfo = (index) => effects.systemInfo.push(ids(index));
    window.loadExamList = (index) => effects.examLists.push(ids(index));
    window.refreshListeningAvailabilityUI = (index) => effects.listeningAvailability.push(ids(index));
    window.startPracticeRecordsSyncInBackground = (trigger, options) => {
        effects.progressSyncs.push(`${trigger}:${options?.forceRender === true}`);
    };
    window.setBrowseFilterState = (category, type) => effects.filterStates.push([category, type]);
    window.setFilteredExamsState = (index) => effects.filteredIndexes.push(ids(index));
    window.renderLibraryConfigList = (options) => {
        effects.configRenderGuards.push(typeof options?.isCurrent === 'function');
        if (typeof options?.isCurrent === 'function' && !options.isCurrent()) return null;
        effects.configRenders.push(options?.activeKey ?? null);
        return null;
    };
    window.showMessage = (message, type) => effects.messages.push({ message, type });

    const activate = window.AppData.library.activate.bind(window.AppData.library);
    window.AppData.library.activate = async function activateObserved(id) {
        effects.activations.push(id);
        return activate(id);
    };
    const updateConfiguration = window.AppData.library.updateConfiguration.bind(window.AppData.library);
    window.AppData.library.updateConfiguration = async function updateConfigurationObserved(config) {
        effects.configurationUpdates.push(config?.id || config?.key || null);
        return updateConfiguration(config);
    };
    const savePathMap = window.ResourceCore.savePathMapForConfiguration.bind(window.ResourceCore);
    window.ResourceCore.savePathMapForConfiguration = async function savePathMapObserved(key, index, options) {
        effects.pathMapSaves.push(key);
        return savePathMap(key, index, options);
    };

    return Object.assign(harness, {
        manager: window.LibraryManager.getInstance(),
        delayedA,
        immediateB,
        effects
    });
}

function assertLatestIntentRaceOutcome(harness, options = {}) {
    const { window, effects } = harness;
    assert.strictEqual(harness.getActiveId(), 'race_b', 'the newer supplied library must remain durably active');
    assert.deepStrictEqual(effects.publications, [{
        key: 'race_b',
        ids: ['race-b'],
        provenance: ['race_b']
    }], 'only the newer supplied library may publish an index');
    assert.deepStrictEqual(effects.overviews, [['race-b']], 'overview publication must remain owned by the newer intent');
    assert.deepStrictEqual(effects.systemInfo, [['race-b']], 'system-info publication must remain owned by the newer intent');
    assert.deepStrictEqual(effects.examLists, [['race-b']], 'exam-list publication must remain owned by the newer intent');
    assert.deepStrictEqual(effects.listeningAvailability, [['race-b']], 'availability UI must remain owned by the newer intent');
    assert.deepStrictEqual(effects.progressSyncs, ['library-loaded:true'], 'only the newer intent may request progress sync');
    assert.deepStrictEqual(effects.filterStates, [['all', 'all']], 'only the newer intent may reset browse filters');
    assert.deepStrictEqual(effects.filteredIndexes, [[]], 'only the newer intent may reset the filtered index');
    assert.deepStrictEqual(effects.configRenders, ['race_b'], 'the deferred configuration render must retain newer-intent ownership');
    assert.deepStrictEqual(effects.configRenderGuards, [true], 'the deferred renderer must receive a live intent guard');
    assert.deepStrictEqual(
        effects.activations,
        options.expectedActivations || ['race_b'],
        'durable activations must complete in latest-intent order'
    );
    assert.deepStrictEqual(
        effects.configurationUpdates,
        options.expectedConfigurationUpdates || ['race_b'],
        'the delayed intent must not update A metadata'
    );
    assert.deepStrictEqual(effects.pathMapSaves, ['race_b'], 'the delayed intent must not save or activate A path data');
    assert.strictEqual(
        harness.getConfigurations().find((config) => config.id === 'race_a').timestamp,
        11,
        'the delayed intent must leave A metadata untouched'
    );
    assert.strictEqual(window.ResourceCore.getPathMap().reading.root, 'Race/B/');
    assert.strictEqual(window.__activeLibraryPathMap.reading.root, 'Race/B/');
    assert.strictEqual(window.pathMap.reading.root, 'Race/B/');
}

function resetRaceEffects(effects) {
    Object.values(effects).forEach((value) => {
        if (Array.isArray(value)) value.length = 0;
    });
}

function assertCoherentRaceAOutcome(harness, options = {}) {
    const { window, effects } = harness;
    assert.strictEqual(harness.getActiveId(), 'race_a', 'the accepted A activation must remain durable');
    assert.deepStrictEqual(effects.publications, [{
        key: 'race_a',
        ids: ['race-a'],
        provenance: ['race_a']
    }]);
    assert.deepStrictEqual(effects.overviews, [['race-a']]);
    assert.deepStrictEqual(effects.systemInfo, [['race-a']]);
    assert.deepStrictEqual(effects.examLists, [['race-a']]);
    assert.deepStrictEqual(effects.listeningAvailability, [['race-a']]);
    assert.deepStrictEqual(effects.progressSyncs, ['library-loaded:true']);
    assert.deepStrictEqual(effects.filterStates, [['all', 'all']]);
    assert.deepStrictEqual(effects.filteredIndexes, [[]]);
    assert.deepStrictEqual(effects.configRenders, ['race_a']);
    assert.deepStrictEqual(effects.configRenderGuards, [true]);
    assert.deepStrictEqual(effects.activations, options.expectedActivations || ['race_a']);
    assert.deepStrictEqual(effects.configurationUpdates, ['race_a']);
    assert.deepStrictEqual(effects.pathMapSaves, ['race_a']);
    assert.strictEqual(window.ResourceCore.getPathMap().reading.root, 'Race/A/');
    assert.strictEqual(window.__activeLibraryPathMap.reading.root, 'Race/A/');
    assert.strictEqual(window.pathMap.reading.root, 'Race/A/');
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

async function testColdListeningOnlyBaseLoadsManifestBeforeAddingDefaultReading() {
    const seed = baseSeed();
    seed.deferReadingExamIndex = true;
    seed.library.importedIndexes.custom_active = [seed.listeningOld];
    seed.library.configurations[0].examCount = 1;
    const harness = createHarness(seed);
    const manager = harness.window.LibraryManager.getInstance();
    const listeningNew = {
        id: 'listening-cold-import',
        examId: 'listening-cold-import',
        type: 'listening',
        title: 'Cold Listening Import',
        category: 'P1',
        path: 'Drop/cold/',
        filename: 'cold.html',
        importKey: 'listening:drop/cold.html'
    };

    const created = await manager.createImportedLibraryConfiguration({
        type: 'listening',
        mode: 'full',
        additions: [listeningNew],
        activate: false
    });
    const next = await harness.window.AppData.library.getIndex(created.key);

    assert.equal(harness.getExamDataScriptLoads(), 1,
        'a listening-only custom base must load exam-data before adding default reading rows');
    assert.strictEqual(created.applied, true, 'a nonactivating import must preserve its successful persistence result');
    assert.strictEqual(harness.getActiveId(), 'custom_active', 'a nonactivating import must not claim or change activation intent');
    assert(next.some((exam) => exam.id === seed.readingA.id),
        'cold import must retain the canonical default reading index');
    assert(next.some((exam) => exam.id === listeningNew.id));
    recordResult('冷启动仅听力基库先加载 Reading manifest 再补齐默认阅读', {
        key: created.key,
        count: next.length
    });
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

async function testLoadActiveLibraryReconcilesPreUpgradeAvailability() {
    const fixture = availabilityRegressionSeed();
    const storedBefore = clone(fixture.persistedIndex);
    const { window } = createHarness(fixture.seed);
    const manager = window.LibraryManager.getInstance();

    const loaded = await manager.loadActiveLibrary(true);

    assertAvailabilityReconciled(loaded, fixture.key);
    assert.deepStrictEqual(
        await window.AppData.library.getIndex(fixture.key),
        storedBefore,
        'loading must project compatibility fields without mutating the persisted pre-upgrade snapshot'
    );
    assert.deepStrictEqual(fixture.persistedIndex, storedBefore, 'loading must not mutate the caller-owned fixture');
    recordResult('启动加载归一化升级前 file-picker 与 generated-reading 可用性', { loadedCount: loaded.length });
}

async function testApplyLibraryConfigurationReconcilesFetchedAndSuppliedAvailability() {
    const fetchedFixture = availabilityRegressionSeed();
    const fetchedStoredBefore = clone(fetchedFixture.persistedIndex);
    const fetchedHarness = createHarness(fetchedFixture.seed);
    let fetchedPublished = null;
    fetchedHarness.window.dispatchEvent = function dispatchEvent(event) {
        if (event && event.type === 'examIndexLoaded') {
            fetchedPublished = event.detail.index;
        }
        return true;
    };

    const fetchedApplied = await fetchedHarness.window.LibraryManager.getInstance()
        .applyLibraryConfiguration(fetchedFixture.key);

    assert.strictEqual(fetchedApplied, true, 'applying a fetched pre-upgrade mixed snapshot should succeed');
    assertAvailabilityReconciled(fetchedPublished, fetchedFixture.key);
    assert.deepStrictEqual(
        await fetchedHarness.window.AppData.library.getIndex(fetchedFixture.key),
        fetchedStoredBefore,
        'fetched apply normalization must not mutate persisted source rows'
    );

    const suppliedFixture = availabilityRegressionSeed();
    const suppliedHarness = createHarness(suppliedFixture.seed);
    const suppliedDataset = clone(suppliedFixture.persistedIndex);
    const suppliedBefore = clone(suppliedDataset);
    let suppliedPublished = null;
    suppliedHarness.window.dispatchEvent = function dispatchEvent(event) {
        if (event && event.type === 'examIndexLoaded') {
            suppliedPublished = event.detail.index;
        }
        return true;
    };

    const suppliedApplied = await suppliedHarness.window.LibraryManager.getInstance()
        .applyLibraryConfiguration(suppliedFixture.key, suppliedDataset);

    assert.strictEqual(suppliedApplied, true, 'applying an explicitly supplied pre-upgrade mixed snapshot should succeed');
    assertAvailabilityReconciled(suppliedPublished, suppliedFixture.key);
    assert.deepStrictEqual(suppliedDataset, suppliedBefore, 'supplied apply normalization must not mutate its caller-owned dataset');
    assert.deepStrictEqual(
        await suppliedHarness.window.AppData.library.getIndex(suppliedFixture.key),
        suppliedFixture.persistedIndex,
        'supplying a dataset for apply must not rewrite the stored snapshot'
    );
    recordResult('配置切换归一化 fetched 与 supplied 升级前题库快照', {
        fetchedCount: fetchedPublished.length,
        suppliedCount: suppliedPublished.length
    });
}

async function testColdStartLoadsManifestBeforeCachedAndSuppliedAvailabilityReconciliation() {
    const cachedFixture = availabilityRegressionSeed();
    cachedFixture.seed.deferReadingExamIndex = true;
    const cachedHarness = createHarness(cachedFixture.seed);
    assert.strictEqual(
        Object.prototype.hasOwnProperty.call(cachedHarness.window, '__READING_EXAM_INDEX__'),
        false,
        'strict-on-demand cold start must begin without a pre-seeded reading manifest'
    );

    const cachedLoaded = await cachedHarness.window.LibraryManager.getInstance().loadActiveLibrary(true);

    assert.strictEqual(cachedHarness.getExamDataScriptLoads(), 1,
        'cached custom-library normalization must load exam-data before its early return');
    assertAvailabilityReconciled(cachedLoaded, cachedFixture.key);

    const suppliedFixture = availabilityRegressionSeed();
    suppliedFixture.seed.deferReadingExamIndex = true;
    const suppliedHarness = createHarness(suppliedFixture.seed);
    const suppliedDataset = clone(suppliedFixture.persistedIndex);
    const suppliedBefore = clone(suppliedDataset);
    let suppliedPublished = null;
    suppliedHarness.window.dispatchEvent = function dispatchEvent(event) {
        if (event && event.type === 'examIndexLoaded') suppliedPublished = event.detail.index;
        return true;
    };

    const suppliedApplied = await suppliedHarness.window.LibraryManager.getInstance()
        .applyLibraryConfiguration(suppliedFixture.key, suppliedDataset);

    assert.strictEqual(suppliedApplied, true);
    assert.strictEqual(suppliedHarness.getExamDataScriptLoads(), 1,
        'supplied custom-library normalization must load exam-data before publishing rows');
    assertAvailabilityReconciled(suppliedPublished, suppliedFixture.key);
    assert.deepStrictEqual(suppliedDataset, suppliedBefore,
        'cold-start reconciliation must not mutate the caller-owned supplied dataset');
    recordResult('严格按需冷启动先加载 Reading manifest 再归一化缓存与 supplied 快照', {
        cachedCount: cachedLoaded.length,
        suppliedCount: suppliedPublished.length
    });
}

async function testNewerApplySupersedesManifestDelayedApply() {
    const harness = createLatestIntentRaceHarness();
    const delayedApply = harness.manager.applyLibraryConfiguration('race_a', [clone(harness.delayedA)]);
    await harness.waitForReadingManifestRequest();

    const immediateResult = await harness.manager.applyLibraryConfiguration('race_b', [clone(harness.immediateB)]);
    assert.strictEqual(immediateResult, true, 'the immediate supplied-B apply must complete');
    harness.releaseReadingManifest();
    const delayedResult = await delayedApply;
    assert.strictEqual(delayedResult, false, 'the manifest-delayed A apply must report that it was superseded');
    await new Promise((resolve) => setTimeout(resolve, 0));

    assertLatestIntentRaceOutcome(harness);
    recordResult('较新的 supplied apply 淘汰 manifest 延迟的旧 apply', {
        activeKey: harness.getActiveId(),
        publications: harness.effects.publications.map((entry) => entry.key)
    });
}

async function testNewerApplySupersedesManifestDelayedActiveLoad() {
    const harness = createLatestIntentRaceHarness();
    const delayedLoad = harness.manager.loadActiveLibrary(true);
    await harness.waitForReadingManifestRequest();

    const immediateResult = await harness.manager.applyLibraryConfiguration('race_b', [clone(harness.immediateB)]);
    assert.strictEqual(immediateResult, true, 'the immediate supplied-B apply must complete');
    harness.releaseReadingManifest();
    const delayedResult = await delayedLoad;
    assert.deepStrictEqual(clone(delayedResult), [], 'the manifest-delayed active load must return no stale A index');
    await new Promise((resolve) => setTimeout(resolve, 0));

    assertLatestIntentRaceOutcome(harness);
    recordResult('较新的 supplied apply 淘汰 manifest 延迟的活动库加载', {
        activeKey: harness.getActiveId(),
        publications: harness.effects.publications.map((entry) => entry.key)
    });
}

async function testProductionUiEntryCapturesIntentBeforeDatasetFetch() {
    const harness = createLatestIntentRaceHarness();
    harness.releaseReadingManifest();
    await harness.window.AppData.library.activate(null);
    resetRaceEffects(harness.effects);
    const fetchStarted = createDeferred();
    const fetchRelease = createDeferred();
    const getIndex = harness.window.AppData.library.getIndex.bind(harness.window.AppData.library);
    harness.window.AppData.library.getIndex = async function getIndexWithDelayedA(id) {
        if (id === 'race_a') {
            fetchStarted.resolve();
            await fetchRelease.promise;
        }
        return getIndex(id);
    };

    loadMainBlock(
        harness.context,
        '// 切换题库配置',
        '// 删除题库配置',
        'switchLibraryConfig'
    );
    harness.window.switchLibraryConfig = harness.context.switchLibraryConfig;

    const delayedA = harness.window.switchLibraryConfig('race_a');
    await withTimeout(fetchStarted.promise, 'production UI race_a dataset fetch');
    const immediateB = await harness.window.switchLibraryConfig('race_b');
    assert.strictEqual(immediateB, true, 'the newer UI selection must complete before delayed A resumes');

    fetchRelease.resolve();
    const delayedResult = await withTimeout(delayedA, 'production UI delayed race_a selection');
    assert.strictEqual(delayedResult, false, 'the older UI selection must retain its original stale ticket');
    await new Promise((resolve) => setTimeout(resolve, 0));

    assertLatestIntentRaceOutcome(harness);
    assert.deepStrictEqual(
        harness.effects.messages.map((entry) => entry.message),
        ['正在切换题库配置...', '题库配置已切换'],
        'only the winning UI selection may emit switch progress and success messages'
    );
    recordResult('生产 UI 入口在异步 dataset preflight 前捕获选择票据', {
        activeKey: harness.getActiveId(),
        publications: harness.effects.publications.map((entry) => entry.key)
    });
}

async function testDefaultSwitchDoesNotNoopWhenActiveReadFails() {
    const seed = baseSeed();
    const { window, getActiveId } = createHarness(seed);
    const manager = window.LibraryManager.getInstance();
    const getActive = window.AppData.library.getActive.bind(window.AppData.library);
    const publications = [];
    window.dispatchEvent = function dispatchEvent(event) {
        if (event && event.type === 'examIndexLoaded') publications.push(clone(event.detail.index));
        return true;
    };
    let shouldFail = true;
    window.AppData.library.getActive = async function getActiveWithTransientFailure() {
        if (shouldFail) {
            shouldFail = false;
            throw new Error('simulated active-library read failure');
        }
        return getActive();
    };

    const switched = await manager.switchLibraryConfig(null);

    assert.strictEqual(switched, true, 'a failed active-key read must not be mistaken for an already-active default library');
    assert.strictEqual(getActiveId(), null, 'the requested default library must still be activated');
    assert.strictEqual(publications.length, 1);
    assert.strictEqual(publications[0][0].sequenceNumber, 1);
    assert.strictEqual(window.examIndexMetadata?.source, 'default-script');
    assert.strictEqual(window.ResourceCore.getPathMap().reading.root, manager.resolveScriptPathRoot('reading'));
    assert.strictEqual(window.ResourceCore.getPathMap().listening.root, manager.resolveScriptPathRoot('listening'));
    recordResult('活动配置读取失败不会把默认库切换误判为 no-op', {
        activeKey: getActiveId()
    });
}

async function testSameActiveSwitchRemainsNoopWithoutPendingCommit() {
    const seed = baseSeed();
    const { window, getActiveId } = createHarness(seed);
    const manager = window.LibraryManager.getInstance();
    const activate = window.AppData.library.activate.bind(window.AppData.library);
    const activations = [];
    window.AppData.library.activate = async function activateObserved(id) {
        activations.push(id);
        return activate(id);
    };

    const switched = await manager.switchLibraryConfig('custom_active');

    assert.strictEqual(switched, false, 'selecting the current library without an in-flight commit must remain a no-op');
    assert.strictEqual(getActiveId(), 'custom_active');
    assert.deepStrictEqual(activations, [], 'a true same-active no-op must not perform a durable activation');
    recordResult('无挂起提交时重复选择当前题库保持 no-op', {
        activeKey: getActiveId()
    });
}

function assertActivePreparationRecovered(harness) {
    const { window, effects } = harness;
    assert.strictEqual(harness.getActiveId(), 'race_a');
    assert.deepStrictEqual(effects.publications, [{
        key: null,
        ids: ['race-a'],
        provenance: ['race_a']
    }], 'exactly one replacement active-library load must publish A');
    assert.deepStrictEqual(effects.overviews, [['race-a']]);
    assert.deepStrictEqual(effects.listeningAvailability, [['race-a']]);
    assert.deepStrictEqual(effects.progressSyncs, ['library-loaded:true']);
    assert.deepStrictEqual(effects.pathMapSaves, ['race_a']);
    assert.deepStrictEqual(effects.activations, [], 'restarting preparation must not rewrite the durable active key');
    assert.strictEqual(window.ResourceCore.getPathMap().reading.root, 'Race/A/');
    assert.strictEqual(window.__activeLibraryPathMap.reading.root, 'Race/A/');
    assert.strictEqual(window.pathMap.reading.root, 'Race/A/');
}

async function testSameActiveReselectionRestartsDelayedActiveLoad() {
    const harness = createLatestIntentRaceHarness();
    const delayedLoad = harness.manager.loadActiveLibrary(true);
    await withTimeout(harness.waitForReadingManifestRequest(), 'same-active startup manifest request');

    const repeatedSelection = harness.manager.switchLibraryConfig('race_a');
    harness.releaseReadingManifest();

    const originalResult = await withTimeout(delayedLoad, 'superseded same-active startup load');
    const selectionResult = await withTimeout(repeatedSelection, 'same-active replacement load');
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepStrictEqual(clone(originalResult), [], 'the original preparation must retire under the newer ticket');
    assert.strictEqual(selectionResult, false, 'reselecting the durable key remains a no-op result');
    assertActivePreparationRecovered(harness);
    recordResult('同一活动配置重选会接管并重启尚未提交的 startup load', {
        activeKey: harness.getActiveId(),
        publications: harness.effects.publications.length
    });
}

async function testMissingSelectionRestartsDelayedActiveLoad() {
    const harness = createLatestIntentRaceHarness();
    const delayedLoad = harness.manager.loadActiveLibrary(true);
    await withTimeout(harness.waitForReadingManifestRequest(), 'missing-target startup manifest request');

    const missingSelection = harness.manager.switchLibraryConfig('missing_config');
    harness.releaseReadingManifest();

    const originalResult = await withTimeout(delayedLoad, 'superseded missing-target startup load');
    const selectionResult = await withTimeout(missingSelection, 'missing-target replacement load');
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepStrictEqual(clone(originalResult), [], 'the invalid successor must not revive the old ticket');
    assert.strictEqual(selectionResult, false, 'a missing configuration must remain rejected');
    assertActivePreparationRecovered(harness);
    assert(harness.effects.messages.some((entry) => entry.type === 'warning'),
        'the missing selection must still report its validation warning');
    recordResult('缺失后继配置会恢复被其淘汰的活动库准备', {
        activeKey: harness.getActiveId(),
        publications: harness.effects.publications.length
    });
}

async function testFailedDefaultCommitRecoversCanonicalDefaultState() {
    const seed = baseSeed();
    const { window, getActiveId } = createHarness(seed);
    const manager = window.LibraryManager.getInstance();
    const publications = [];
    window.dispatchEvent = function dispatchEvent(event) {
        if (event && event.type === 'examIndexLoaded') publications.push(clone(event.detail.index));
        return true;
    };
    const setActivePathMap = manager.setActivePathMap.bind(manager);
    let shouldFail = true;
    manager.setActivePathMap = function setActivePathMapWithTransientFailure(pathMap) {
        if (shouldFail) {
            shouldFail = false;
            throw new Error('simulated post-activation default path failure');
        }
        return setActivePathMap(pathMap);
    };

    const switched = await manager.switchLibraryConfig(null);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(switched, false, 'the original failed commit must retain its failure result after recovery');
    assert.strictEqual(getActiveId(), null);
    assert.strictEqual(publications.length, 1, 'default recovery must publish one coherent replacement epoch');
    assert.strictEqual(publications[0][0].sequenceNumber, 1);
    assert.strictEqual(window.examIndexMetadata?.source, 'default-script');
    assert.strictEqual(window.ResourceCore.getPathMap().reading.root, manager.resolveScriptPathRoot('reading'));
    assert.strictEqual(window.ResourceCore.getPathMap().listening.root, manager.resolveScriptPathRoot('listening'));
    recordResult('默认库提交失败后恢复规范序号、元数据与路由', {
        activeKey: getActiveId(),
        publications: publications.length
    });
}

async function testNewerApplySupersedesManifestDelayedActivatingImport() {
    const harness = createLatestIntentRaceHarness();
    const importedListening = {
        id: 'race-import-listening',
        examId: 'race-import-listening',
        type: 'listening',
        sourceKind: 'file-picker',
        title: 'Delayed imported listening',
        category: 'P3',
        path: 'Race/Import/',
        filename: 'import.html',
        importKey: 'listening:race/import.html'
    };

    const delayedImport = harness.manager.createImportedLibraryConfiguration({
        type: 'listening',
        mode: 'full',
        additions: [importedListening],
        activate: true
    });
    await withTimeout(harness.waitForReadingManifestRequest(), 'activating import manifest request');

    const immediateB = await harness.manager.applyLibraryConfiguration('race_b', [clone(harness.immediateB)]);
    assert.strictEqual(immediateB, true);
    harness.releaseReadingManifest();
    const created = await withTimeout(delayedImport, 'manifest-delayed activating import');
    assert.strictEqual(created.applied, false, 'a superseded import may persist but must not activate');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const stored = await harness.window.AppData.library.getIndex(created.key);
    assert(stored.some((exam) => exam.id === importedListening.id), 'the superseded import must retain its saved configuration');
    assert(harness.getConfigurations().some((config) => config.id === created.key));
    assertLatestIntentRaceOutcome(harness, {
        expectedConfigurationUpdates: ['race_b', created.key]
    });
    recordResult('激活型导入复用起始票据且不覆盖较新的选择', {
        importedKey: created.key,
        activeKey: harness.getActiveId(),
        applied: created.applied
    });
}

async function testRejectedNewerApplyDoesNotSplitDurableActivation() {
    const harness = createLatestIntentRaceHarness();
    harness.releaseReadingManifest();
    assert.strictEqual(
        await harness.manager.applyLibraryConfiguration('race_b', [clone(harness.immediateB)]),
        true
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    resetRaceEffects(harness.effects);

    const activationPersisted = createDeferred();
    const activationRelease = createDeferred();
    const activate = harness.window.AppData.library.activate.bind(harness.window.AppData.library);
    harness.window.AppData.library.activate = async function activateWithPersistedAGate(id) {
        const result = await activate(id);
        if (id === 'race_a') {
            activationPersisted.resolve();
            await activationRelease.promise;
        }
        return result;
    };

    const delayedA = harness.manager.applyLibraryConfiguration('race_a', [clone(harness.delayedA)]);
    await withTimeout(activationPersisted.promise, 'race_a durable activation before rejected intent');
    const rejected = await harness.manager.applyLibraryConfiguration('empty_newer', []);
    assert.strictEqual(rejected, false, 'an empty newer request must be rejected before claiming commit ownership');

    activationRelease.resolve();
    const appliedA = await withTimeout(delayedA, 'race_a completion after rejected newer intent');
    assert.strictEqual(appliedA, true, 'the accepted activation must finish coherently after a rejected request');
    await new Promise((resolve) => setTimeout(resolve, 0));

    assertCoherentRaceAOutcome(harness);
    recordResult('空数据新请求不会截断已落盘的有效 activation', {
        activeKey: harness.getActiveId(),
        rejected
    });
}

async function testFailingNewerPreflightDoesNotSplitDurableActivation() {
    const harness = createLatestIntentRaceHarness();
    harness.releaseReadingManifest();
    assert.strictEqual(
        await harness.manager.applyLibraryConfiguration('race_b', [clone(harness.immediateB)]),
        true
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    resetRaceEffects(harness.effects);

    const activationPersisted = createDeferred();
    const activationRelease = createDeferred();
    const activate = harness.window.AppData.library.activate.bind(harness.window.AppData.library);
    harness.window.AppData.library.activate = async function activateWithPersistedAGate(id) {
        const result = await activate(id);
        if (id === 'race_a') {
            activationPersisted.resolve();
            await activationRelease.promise;
        }
        return result;
    };
    const loadPathMap = harness.manager.loadPathMapForConfiguration.bind(harness.manager);
    harness.manager.loadPathMapForConfiguration = async function loadPathMapWithFailure(key) {
        if (key === 'failing_newer') {
            throw new Error('simulated precommit path-map failure');
        }
        return loadPathMap(key);
    };

    const delayedA = harness.manager.applyLibraryConfiguration('race_a', [clone(harness.delayedA)]);
    await withTimeout(activationPersisted.promise, 'race_a durable activation before failing intent');
    await assert.rejects(
        harness.manager.applyLibraryConfiguration('failing_newer', [{
            ...clone(harness.immediateB),
            id: 'race-failing-newer',
            examId: 'race-failing-newer',
            path: 'Race/Failing/'
        }]),
        /simulated precommit path-map failure/
    );

    activationRelease.resolve();
    const appliedA = await withTimeout(delayedA, 'race_a completion after failing newer preflight');
    assert.strictEqual(appliedA, true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assertCoherentRaceAOutcome(harness);
    recordResult('准备阶段失败的新请求不会截断已落盘的有效 activation', {
        activeKey: harness.getActiveId()
    });
}

async function testFailingNewerCommitRecoversDurableActivation() {
    const harness = createLatestIntentRaceHarness();
    harness.releaseReadingManifest();
    assert.strictEqual(
        await harness.manager.applyLibraryConfiguration('race_b', [clone(harness.immediateB)]),
        true
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    resetRaceEffects(harness.effects);

    const activationPersisted = createDeferred();
    const activationRelease = createDeferred();
    const activate = harness.window.AppData.library.activate.bind(harness.window.AppData.library);
    let gatedRaceA = false;
    harness.window.AppData.library.activate = async function activateWithCommitFailure(id) {
        if (id === 'race_b') {
            throw new Error('simulated newer activation failure');
        }
        const result = await activate(id);
        if (id === 'race_a' && !gatedRaceA) {
            gatedRaceA = true;
            activationPersisted.resolve();
            await activationRelease.promise;
        }
        return result;
    };

    const delayedA = harness.manager.applyLibraryConfiguration('race_a', [clone(harness.delayedA)]);
    await withTimeout(activationPersisted.promise, 'race_a durable activation before failing commit');
    const failingB = harness.manager.applyLibraryConfiguration('race_b', [clone(harness.immediateB)]);
    activationRelease.resolve();

    const delayedResult = await withTimeout(delayedA, 'stale race_a completion before recovery');
    assert.strictEqual(delayedResult, false, 'the older commit must defer coherence to the newer claimant');
    await assert.rejects(
        withTimeout(failingB, 'failing newer commit and durable-state recovery'),
        /simulated newer activation failure/
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    assertCoherentRaceAOutcome(harness, { expectedActivations: ['race_a', 'race_a'] });
    recordResult('提交阶段失败的新请求恢复已落盘的 activation', {
        activeKey: harness.getActiveId(),
        activations: harness.effects.activations
    });
}

async function testFailingNewerCommitRecoversOlderSuppliedActivation() {
    const harness = createLatestIntentRaceHarness();
    harness.releaseReadingManifest();
    assert.strictEqual(
        await harness.manager.applyLibraryConfiguration('race_b', [clone(harness.immediateB)]),
        true
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    resetRaceEffects(harness.effects);

    const activationPersisted = createDeferred();
    const activationRelease = createDeferred();
    const activate = harness.window.AppData.library.activate.bind(harness.window.AppData.library);
    let gatedEphemeralA = false;
    harness.window.AppData.library.activate = async function activateWithSuppliedCommitFailure(id) {
        if (id === 'race_b') {
            throw new Error('simulated newer supplied activation failure');
        }
        const result = await activate(id);
        if (id === 'ephemeral_a' && !gatedEphemeralA) {
            gatedEphemeralA = true;
            activationPersisted.resolve();
            await activationRelease.promise;
        }
        return result;
    };

    const delayedA = harness.manager.applyLibraryConfiguration('ephemeral_a', [clone(harness.delayedA)]);
    await withTimeout(activationPersisted.promise, 'ephemeral_a durable activation before failing newer commit');
    const newerClaimed = createDeferred();
    const claimLibraryCommitIntent = harness.manager.claimLibraryCommitIntent.bind(harness.manager);
    harness.manager.claimLibraryCommitIntent = function claimObserved(generation) {
        const claimed = claimLibraryCommitIntent(generation);
        if (claimed) newerClaimed.resolve();
        return claimed;
    };
    const failingB = harness.manager.applyLibraryConfiguration('race_b', [clone(harness.immediateB)]);
    try {
        await withTimeout(newerClaimed.promise, 'newer race_b commit claim after supplied activation');
    } finally {
        activationRelease.resolve();
    }

    const delayedResult = await withTimeout(delayedA, 'stale supplied activation completion before recovery');
    assert.strictEqual(delayedResult, false, 'the older supplied commit must defer publication to the newer claimant');
    await assert.rejects(
        withTimeout(failingB, 'failing newer commit and supplied-state recovery'),
        /simulated newer supplied activation failure/
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const { window, effects } = harness;
    assert.deepStrictEqual(await window.AppData.library.getIndex('ephemeral_a'), [],
        'the recovered older dataset must remain an intentionally non-persisted supplied snapshot');
    assert.strictEqual(harness.getActiveId(), 'ephemeral_a');
    assert.deepStrictEqual(effects.publications, [{
        key: 'ephemeral_a',
        ids: ['race-a'],
        provenance: ['ephemeral_a']
    }]);
    assert.deepStrictEqual(effects.overviews, [['race-a']]);
    assert.deepStrictEqual(effects.systemInfo, [['race-a']]);
    assert.deepStrictEqual(effects.examLists, [['race-a']]);
    assert.deepStrictEqual(effects.listeningAvailability, [['race-a']]);
    assert.deepStrictEqual(effects.progressSyncs, ['library-loaded:true']);
    assert.deepStrictEqual(effects.filterStates, [['all', 'all']]);
    assert.deepStrictEqual(effects.filteredIndexes, [[]]);
    assert.deepStrictEqual(effects.configRenders, ['ephemeral_a']);
    assert.deepStrictEqual(effects.configRenderGuards, [true]);
    assert.deepStrictEqual(effects.activations, ['ephemeral_a', 'ephemeral_a']);
    assert.deepStrictEqual(effects.configurationUpdates, []);
    assert.deepStrictEqual(effects.pathMapSaves, ['ephemeral_a']);
    assert.strictEqual(window.ResourceCore.getPathMap().reading.root, 'Race/A/');
    assert.strictEqual(window.__activeLibraryPathMap.reading.root, 'Race/A/');
    assert.strictEqual(window.pathMap.reading.root, 'Race/A/');
    recordResult('较新提交失败时恢复旧 supplied activation 的内存快照', {
        activeKey: harness.getActiveId(),
        activations: effects.activations
    });
}

async function testFailingNewerCommitPrefersOlderSuppliedSnapshotOverStoredIndex() {
    const harness = createLatestIntentRaceHarness();
    harness.releaseReadingManifest();
    assert.strictEqual(
        await harness.manager.applyLibraryConfiguration('race_b', [clone(harness.immediateB)]),
        true
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    resetRaceEffects(harness.effects);

    const suppliedA = {
        ...clone(harness.delayedA),
        id: 'race-a-supplied-v2',
        examId: 'race-a-supplied-v2',
        sourceKind: 'file-picker',
        title: 'Supplied A v2',
        path: 'Race/Supplied-A-v2/',
        filename: 'a-v2.html'
    };
    const activationPersisted = createDeferred();
    const activationRelease = createDeferred();
    const activate = harness.window.AppData.library.activate.bind(harness.window.AppData.library);
    let gatedSuppliedA = false;
    harness.window.AppData.library.activate = async function activateWithStoredIndexConflict(id) {
        if (id === 'race_b') {
            throw new Error('simulated newer activation failure after supplied replacement');
        }
        const result = await activate(id);
        if (id === 'race_a' && !gatedSuppliedA) {
            gatedSuppliedA = true;
            activationPersisted.resolve();
            await activationRelease.promise;
        }
        return result;
    };

    const delayedA = harness.manager.applyLibraryConfiguration('race_a', [suppliedA]);
    await withTimeout(activationPersisted.promise, 'supplied race_a v2 activation before failing newer commit');
    const newerClaimed = createDeferred();
    const claimLibraryCommitIntent = harness.manager.claimLibraryCommitIntent.bind(harness.manager);
    harness.manager.claimLibraryCommitIntent = function claimObserved(generation) {
        const claimed = claimLibraryCommitIntent(generation);
        if (claimed) newerClaimed.resolve();
        return claimed;
    };
    const failingB = harness.manager.applyLibraryConfiguration('race_b', [clone(harness.immediateB)]);
    try {
        await withTimeout(newerClaimed.promise, 'newer race_b claim after supplied race_a v2 activation');
    } finally {
        activationRelease.resolve();
    }

    assert.strictEqual(
        await withTimeout(delayedA, 'stale supplied race_a v2 completion before recovery'),
        false
    );
    await assert.rejects(
        withTimeout(failingB, 'failing newer commit and same-key supplied recovery'),
        /simulated newer activation failure after supplied replacement/
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const persistedA = await harness.window.AppData.library.getIndex('race_a');
    assert.deepStrictEqual(persistedA.map((exam) => exam.id), ['race-a'],
        'the stored D1 index must remain distinct so recovery cannot pass by reading it');
    const { window, effects } = harness;
    assert.strictEqual(harness.getActiveId(), 'race_a');
    assert.deepStrictEqual(effects.publications, [{
        key: 'race_a',
        ids: ['race-a-supplied-v2'],
        provenance: ['race_a']
    }]);
    assert.deepStrictEqual(effects.overviews, [['race-a-supplied-v2']]);
    assert.deepStrictEqual(effects.systemInfo, [['race-a-supplied-v2']]);
    assert.deepStrictEqual(effects.examLists, [['race-a-supplied-v2']]);
    assert.deepStrictEqual(effects.listeningAvailability, [['race-a-supplied-v2']]);
    assert.deepStrictEqual(effects.progressSyncs, ['library-loaded:true']);
    assert.deepStrictEqual(effects.filterStates, [['all', 'all']]);
    assert.deepStrictEqual(effects.filteredIndexes, [[]]);
    assert.deepStrictEqual(effects.configRenders, ['race_a']);
    assert.deepStrictEqual(effects.configRenderGuards, [true]);
    assert.deepStrictEqual(effects.activations, ['race_a', 'race_a']);
    assert.deepStrictEqual(effects.configurationUpdates, ['race_a']);
    assert.deepStrictEqual(effects.pathMapSaves, ['race_a']);
    assert.strictEqual(window.ResourceCore.getPathMap().reading.root, 'Race/Supplied-A-v2/');
    assert.strictEqual(window.__activeLibraryPathMap.reading.root, 'Race/Supplied-A-v2/');
    assert.strictEqual(window.pathMap.reading.root, 'Race/Supplied-A-v2/');
    recordResult('较新提交失败时 supplied D2 恢复优先于同键持久 D1', {
        activeKey: harness.getActiveId(),
        published: effects.publications[0].ids,
        persisted: persistedA.map((exam) => exam.id)
    });
}

async function testFailedSameKeyActivationRestoresPriorCoherentDataset() {
    const harness = createLatestIntentRaceHarness();
    harness.releaseReadingManifest();
    assert.deepStrictEqual(
        (await harness.manager.loadActiveLibrary(true)).map((exam) => exam.id),
        ['race-a']
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    resetRaceEffects(harness.effects);

    const failedD2 = {
        ...clone(harness.delayedA),
        id: 'race-a-failed-d2',
        examId: 'race-a-failed-d2',
        sourceKind: 'file-picker',
        title: 'Failed same-key D2',
        path: 'Race/Failed-D2/',
        filename: 'failed-d2.html'
    };
    const activate = harness.window.AppData.library.activate.bind(harness.window.AppData.library);
    let shouldFail = true;
    harness.window.AppData.library.activate = async function failSameKeyBeforeWrite(id) {
        if (id === 'race_a' && shouldFail) {
            shouldFail = false;
            throw new Error('simulated same-key activation failure before write');
        }
        return activate(id);
    };

    await assert.rejects(
        harness.manager.applyLibraryConfiguration('race_a', [failedD2]),
        /simulated same-key activation failure before write/
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const { window, effects } = harness;
    assert.strictEqual(harness.getActiveId(), 'race_a');
    assert.deepStrictEqual(effects.publications, [{
        key: 'race_a',
        ids: ['race-a'],
        provenance: ['race_a']
    }], 'a failed same-key activation must restore D1 rather than publish the rejected D2');
    assert.deepStrictEqual(effects.overviews, [['race-a']]);
    assert.deepStrictEqual(effects.systemInfo, [['race-a']]);
    assert.deepStrictEqual(effects.examLists, [['race-a']]);
    assert.deepStrictEqual(effects.listeningAvailability, [['race-a']]);
    assert.deepStrictEqual(effects.progressSyncs, ['library-loaded:true']);
    assert.deepStrictEqual(effects.filterStates, [['all', 'all']]);
    assert.deepStrictEqual(effects.filteredIndexes, [[]]);
    assert.deepStrictEqual(effects.configRenders, ['race_a']);
    assert.deepStrictEqual(effects.configRenderGuards, [true]);
    assert.deepStrictEqual(effects.activations, ['race_a']);
    assert.deepStrictEqual(effects.configurationUpdates, ['race_a']);
    assert.deepStrictEqual(effects.pathMapSaves, ['race_a']);
    assert.strictEqual(window.ResourceCore.getPathMap().reading.root, 'Race/A/');
    assert.strictEqual(window.__activeLibraryPathMap.reading.root, 'Race/A/');
    assert.strictEqual(window.pathMap.reading.root, 'Race/A/');
    recordResult('同 key activation 写入前失败时恢复先前一致 D1', {
        activeKey: harness.getActiveId(),
        published: effects.publications[0].ids
    });
}

async function testActiveReloadRefreshesDurableRecoverySnapshot() {
    const harness = createLatestIntentRaceHarness();
    harness.releaseReadingManifest();
    assert.strictEqual(
        await harness.manager.applyLibraryConfiguration('race_a', [clone(harness.delayedA)]),
        true
    );

    const storedD2 = {
        ...clone(harness.delayedA),
        id: 'race-a-stored-v2',
        examId: 'race-a-stored-v2',
        sourceKind: 'file-picker',
        title: 'Stored A v2',
        path: 'Race/Stored-V2/',
        filename: 'stored-v2.html'
    };
    await harness.window.AppData.library.import({
        id: 'race_a',
        configuration: { id: 'race_a', key: 'race_a', name: 'Race A v2', examCount: 1 },
        index: [storedD2]
    });
    assert.deepStrictEqual(
        (await harness.manager.loadActiveLibrary(true)).map((exam) => exam.id),
        ['race-a-stored-v2']
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    resetRaceEffects(harness.effects);

    const activate = harness.window.AppData.library.activate.bind(harness.window.AppData.library);
    harness.window.AppData.library.activate = async function failNewerBeforeWrite(id) {
        if (id === 'race_b') {
            throw new Error('simulated newer activation failure after active reload');
        }
        return activate(id);
    };

    await assert.rejects(
        harness.manager.applyLibraryConfiguration('race_b', [clone(harness.immediateB)]),
        /simulated newer activation failure after active reload/
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const { window, effects } = harness;
    assert.strictEqual(harness.getActiveId(), 'race_a');
    assert.deepStrictEqual(effects.publications, [{
        key: 'race_a',
        ids: ['race-a-stored-v2'],
        provenance: ['race_a']
    }], 'recovery must use the D2 snapshot published by the latest coherent active reload');
    assert.deepStrictEqual(effects.overviews, [['race-a-stored-v2']]);
    assert.deepStrictEqual(effects.systemInfo, [['race-a-stored-v2']]);
    assert.deepStrictEqual(effects.examLists, [['race-a-stored-v2']]);
    assert.deepStrictEqual(effects.listeningAvailability, [['race-a-stored-v2']]);
    assert.deepStrictEqual(effects.progressSyncs, ['library-loaded:true']);
    assert.deepStrictEqual(effects.filterStates, [['all', 'all']]);
    assert.deepStrictEqual(effects.filteredIndexes, [[]]);
    assert.deepStrictEqual(effects.configRenders, ['race_a']);
    assert.deepStrictEqual(effects.configRenderGuards, [true]);
    assert.deepStrictEqual(effects.activations, ['race_a']);
    assert.deepStrictEqual(effects.configurationUpdates, ['race_a']);
    assert.deepStrictEqual(effects.pathMapSaves, ['race_a']);
    assert.strictEqual(window.ResourceCore.getPathMap().reading.root, 'Race/Stored-V2/');
    assert.strictEqual(window.__activeLibraryPathMap.reading.root, 'Race/Stored-V2/');
    assert.strictEqual(window.pathMap.reading.root, 'Race/Stored-V2/');
    recordResult('活动库 reload 后恢复快照同步到持久 D2', {
        activeKey: harness.getActiveId(),
        published: effects.publications[0].ids
    });
}

async function testFailedSuppliedCommitRecoversPreparedDataset() {
    const harness = createLatestIntentRaceHarness();
    harness.releaseReadingManifest();
    assert.strictEqual(
        await harness.manager.applyLibraryConfiguration('race_b', [clone(harness.immediateB)]),
        true
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    resetRaceEffects(harness.effects);

    const savePathMap = harness.manager.savePathMapForConfiguration.bind(harness.manager);
    let shouldFail = true;
    harness.manager.savePathMapForConfiguration = async function savePathMapWithTransientFailure(key, index, options) {
        if (key === 'ephemeral_a' && shouldFail) {
            shouldFail = false;
            throw new Error('simulated supplied path-map failure');
        }
        return savePathMap(key, index, options);
    };

    await assert.rejects(
        harness.manager.applyLibraryConfiguration('ephemeral_a', [clone(harness.delayedA)]),
        /simulated supplied path-map failure/
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const { window, effects } = harness;
    assert.strictEqual(harness.getActiveId(), 'ephemeral_a');
    assert.deepStrictEqual(effects.publications, [{
        key: 'ephemeral_a',
        ids: ['race-a'],
        provenance: ['ephemeral_a']
    }]);
    assert.deepStrictEqual(effects.overviews, [['race-a']]);
    assert.deepStrictEqual(effects.systemInfo, [['race-a']]);
    assert.deepStrictEqual(effects.examLists, [['race-a']]);
    assert.deepStrictEqual(effects.listeningAvailability, [['race-a']]);
    assert.deepStrictEqual(effects.progressSyncs, ['library-loaded:true']);
    assert.deepStrictEqual(effects.filterStates, [['all', 'all']]);
    assert.deepStrictEqual(effects.filteredIndexes, [[]]);
    assert.deepStrictEqual(effects.configRenders, ['ephemeral_a']);
    assert.deepStrictEqual(effects.configRenderGuards, [true]);
    assert.deepStrictEqual(effects.activations, ['ephemeral_a', 'ephemeral_a']);
    assert.deepStrictEqual(effects.configurationUpdates, []);
    assert.deepStrictEqual(effects.pathMapSaves, ['ephemeral_a']);
    assert.strictEqual(window.ResourceCore.getPathMap().reading.root, 'Race/A/');
    assert.strictEqual(window.__activeLibraryPathMap.reading.root, 'Race/A/');
    assert.strictEqual(window.pathMap.reading.root, 'Race/A/');
    recordResult('提交失败时复用未持久化的 supplied dataset 恢复 activation', {
        activeKey: harness.getActiveId(),
        activations: effects.activations
    });
}

async function testAsyncConfigRenderCannotRepaintStaleSelection() {
    const harness = createLatestIntentRaceHarness();
    harness.releaseReadingManifest();
    const firstConfigRead = createDeferred();
    const firstConfigRelease = createDeferred();
    const bMounted = createDeferred();
    const mounts = [];
    const renderPromises = [];
    const seenGuards = [];
    let configReadCount = 0;
    const container = { querySelector() { return null; } };
    const renderSandbox = {
        console,
        document: {
            getElementById(id) {
                return id === 'settings-view' ? container : null;
            }
        },
        async resolveLibraryConfigurations() {
            configReadCount += 1;
            if (configReadCount === 1) {
                firstConfigRead.resolve();
                await firstConfigRelease.promise;
            }
            return [{ id: 'race_a', key: 'race_a' }, { id: 'race_b', key: 'race_b' }];
        },
        async getActiveLibraryConfigurationKey() { return null; },
        ensureLibraryConfigView() {
            return {
                mount(_container, _configs, options) {
                    mounts.push(options.activeKey);
                    if (options.activeKey === 'race_b') bMounted.resolve();
                    return options.activeKey;
                }
            };
        },
        renderLibraryConfigFallback() { throw new Error('unexpected fallback render'); },
        showMessage() {},
        switchLibraryConfig() {},
        deleteLibraryConfig() {}
    };
    const renderContext = vm.createContext(renderSandbox);
    loadMainBlock(
        renderContext,
        'function resolveLibraryConfigContainer',
        'async function showLibraryConfigList',
        'renderLibraryConfigList'
    );
    harness.window.renderLibraryConfigList = (options) => {
        seenGuards.push(typeof options?.isCurrent === 'function');
        const promise = renderContext.renderLibraryConfigList(options);
        renderPromises.push(promise);
        return promise;
    };

    assert.strictEqual(
        await harness.manager.applyLibraryConfiguration('race_a', [clone(harness.delayedA)]),
        true
    );
    await withTimeout(firstConfigRead.promise, 'race_a asynchronous config render');
    assert.strictEqual(
        await harness.manager.applyLibraryConfiguration('race_b', [clone(harness.immediateB)]),
        true
    );
    await withTimeout(bMounted.promise, 'race_b config render mount');
    firstConfigRelease.resolve();
    await withTimeout(Promise.all(renderPromises), 'guarded configuration renders');

    assert.deepStrictEqual(seenGuards, [true, true]);
    assert.deepStrictEqual(mounts, ['race_b'], 'the stale A renderer must stop after its awaited configuration read');
    assert.strictEqual(harness.getActiveId(), 'race_b');
    assert.strictEqual(harness.window.ResourceCore.getPathMap().reading.root, 'Race/B/');
    recordResult('异步题库配置渲染在 await 后重新验证选择所有权', {
        mounts,
        activeKey: harness.getActiveId()
    });
}

async function testAsyncConfigRenderRejectionIsHandled() {
    const seed = baseSeed();
    const { window } = createHarness(seed);
    const manager = window.LibraryManager.getInstance();
    const warnings = [];
    window.console.warn = (...args) => warnings.push(args);
    window.renderLibraryConfigList = async function renderLibraryConfigListRejected() {
        throw new Error('simulated asynchronous render failure');
    };

    assert.strictEqual(
        await manager.applyLibraryConfiguration('custom_active', clone(seed.library.importedIndexes.custom_active)),
        true
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert(
        warnings.some((args) => args[0] === '[LibraryManager] 重渲染题库配置列表失败'
            && /simulated asynchronous render failure/.test(String(args[1]))),
        'the deferred renderer rejection must be observed and logged'
    );
    recordResult('异步配置列表渲染 rejection 被显式处理', {
        warningCount: warnings.length
    });
}

async function testNewerApplyCommitsAfterDelayedOlderActivation() {
    const harness = createLatestIntentRaceHarness();
    harness.releaseReadingManifest();
    const activationPersisted = createDeferred();
    const activationRelease = createDeferred();
    const activate = harness.window.AppData.library.activate.bind(harness.window.AppData.library);
    harness.window.AppData.library.activate = async function activateWithDelayedA(id) {
        const result = await activate(id);
        if (id === 'race_a') {
            activationPersisted.resolve();
            await activationRelease.promise;
        }
        return result;
    };

    const delayedApply = harness.manager.applyLibraryConfiguration('race_a', [clone(harness.delayedA)]);
    await withTimeout(activationPersisted.promise, 'older race_a durable activation');
    let newerSettled = false;
    const newerApply = harness.manager.applyLibraryConfiguration('race_b', [clone(harness.immediateB)])
        .then((result) => {
            newerSettled = true;
            return result;
        });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(newerSettled, false, 'the newer commit must queue behind an older in-flight activation');

    activationRelease.resolve();
    const [delayedResult, newerResult] = await withTimeout(
        Promise.all([delayedApply, newerApply]),
        'delayed race_a and newer race_b commits'
    );
    assert.strictEqual(delayedResult, false, 'the older apply must stop after its delayed activation returns stale');
    assert.strictEqual(newerResult, true, 'the newer apply must commit after the older activation releases');
    await new Promise((resolve) => setTimeout(resolve, 0));

    assertLatestIntentRaceOutcome(harness, { expectedActivations: ['race_a', 'race_b'] });
    recordResult('较新的 apply 在旧 activation 结束后最后提交', {
        activeKey: harness.getActiveId(),
        activations: harness.effects.activations
    });
}

async function testNewerActiveLoadWaitsForDelayedOlderActivation() {
    const harness = createLatestIntentRaceHarness();
    harness.releaseReadingManifest();
    const activationPersisted = createDeferred();
    const activationRelease = createDeferred();
    const activate = harness.window.AppData.library.activate.bind(harness.window.AppData.library);
    harness.window.AppData.library.activate = async function activateWithDelayedB(id) {
        const result = await activate(id);
        if (id === 'race_b') {
            activationPersisted.resolve();
            await activationRelease.promise;
        }
        return result;
    };
    const activeReadStarted = createDeferred();
    const getActive = harness.window.AppData.library.getActive.bind(harness.window.AppData.library);
    harness.window.AppData.library.getActive = async function getActiveObserved() {
        activeReadStarted.resolve();
        return getActive();
    };

    const delayedApply = harness.manager.applyLibraryConfiguration('race_b', [clone(harness.immediateB)]);
    await withTimeout(activationPersisted.promise, 'older race_b durable activation');
    let loadSettled = false;
    const newerLoad = harness.manager.loadActiveLibrary(true).then((index) => {
        loadSettled = true;
        return index;
    });
    let barrierError = null;
    try {
        const checkpoint = await withTimeout(
            Promise.race([
                activeReadStarted.promise.then(() => 'active-read'),
                new Promise((resolve) => setTimeout(() => resolve('still-blocked'), 0))
            ]),
            'observe activation commit barrier'
        );
        assert.strictEqual(
            checkpoint,
            'still-blocked',
            'the newer load must not read the active key before the in-flight activation returns'
        );
        assert.strictEqual(loadSettled, false, 'the newer load must wait for the in-flight durable activation');
    } catch (error) {
        barrierError = error;
    } finally {
        activationRelease.resolve();
    }

    const [delayedResult, loaded] = await withTimeout(
        Promise.all([delayedApply, newerLoad]),
        'activation barrier apply/load completion'
    );
    if (barrierError) throw barrierError;
    assert.strictEqual(delayedResult, true, 'the older accepted activation must finish coherently before the read-only load');
    assert.deepStrictEqual(clone(loaded).map((exam) => ({
        id: exam.id,
        provenance: exam.libraryConfigurationId
    })), [{ id: 'race-b', provenance: 'race_b' }], 'the newer load must observe and publish the committed B selection');

    const { window, effects } = harness;
    assert.strictEqual(harness.getActiveId(), 'race_b');
    assert.deepStrictEqual(effects.activations, ['race_b']);
    assert.deepStrictEqual(effects.configurationUpdates, ['race_b']);
    assert.deepStrictEqual(effects.pathMapSaves, ['race_b', 'race_b']);
    assert.deepStrictEqual(effects.publications, [{
        key: 'race_b',
        ids: ['race-b'],
        provenance: ['race_b']
    }, {
        key: null,
        ids: ['race-b'],
        provenance: ['race_b']
    }]);
    assert.deepStrictEqual(effects.overviews, [['race-b'], ['race-b']]);
    assert.deepStrictEqual(effects.systemInfo, [['race-b']]);
    assert.deepStrictEqual(effects.examLists, [['race-b']]);
    assert.deepStrictEqual(effects.listeningAvailability, [['race-b'], ['race-b']]);
    assert.deepStrictEqual(effects.progressSyncs, ['library-loaded:true', 'library-loaded:true']);
    assert.deepStrictEqual(effects.filterStates, [['all', 'all']]);
    assert.deepStrictEqual(effects.filteredIndexes, [[]]);
    assert.deepStrictEqual(effects.configRenders, []);
    assert.strictEqual(window.ResourceCore.getPathMap().reading.root, 'Race/B/');
    assert.strictEqual(window.__activeLibraryPathMap.reading.root, 'Race/B/');
    assert.strictEqual(window.pathMap.reading.root, 'Race/B/');
    recordResult('较新的活动库加载等待旧 activation 并读取最终提交', {
        activeKey: harness.getActiveId(),
        publications: effects.publications.map((entry) => entry.ids)
    });
}

async function testFailingActiveLoadDoesNotInterruptDurableActivation() {
    const harness = createLatestIntentRaceHarness();
    harness.releaseReadingManifest();
    assert.strictEqual(
        await harness.manager.applyLibraryConfiguration('race_b', [clone(harness.immediateB)]),
        true
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    resetRaceEffects(harness.effects);

    const activationPersisted = createDeferred();
    const activationRelease = createDeferred();
    const activate = harness.window.AppData.library.activate.bind(harness.window.AppData.library);
    harness.window.AppData.library.activate = async function activateWithPersistedAGate(id) {
        const result = await activate(id);
        if (id === 'race_a') {
            activationPersisted.resolve();
            await activationRelease.promise;
        }
        return result;
    };
    harness.window.AppData.library.getActive = async function getActiveRejected() {
        throw new Error('simulated active read failure');
    };

    const delayedA = harness.manager.applyLibraryConfiguration('race_a', [clone(harness.delayedA)]);
    await withTimeout(activationPersisted.promise, 'race_a durable activation before failing load');
    const failingLoad = harness.manager.loadActiveLibrary(true);
    activationRelease.resolve();

    const [appliedA, loaded] = await withTimeout(
        Promise.all([delayedA, failingLoad]),
        'accepted activation and failing active load'
    );
    assert.strictEqual(appliedA, true, 'a read-only load must not claim ownership before it can read active state');
    assert.deepStrictEqual(clone(loaded), []);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assertCoherentRaceAOutcome(harness);
    recordResult('活动库读取失败不会截断已落盘的 activation', {
        activeKey: harness.getActiveId()
    });
}

async function testSupersededQueuedDefaultLoadReturnsEmptyArray() {
    const harness = createLatestIntentRaceHarness();
    harness.releaseReadingManifest();
    const activationPersisted = createDeferred();
    const activationRelease = createDeferred();
    const activate = harness.window.AppData.library.activate.bind(harness.window.AppData.library);
    harness.window.AppData.library.activate = async function activateWithPersistedAGate(id) {
        const result = await activate(id);
        if (id === 'race_a') {
            activationPersisted.resolve();
            await activationRelease.promise;
        }
        return result;
    };

    const delayedA = harness.manager.applyLibraryConfiguration('race_a', [clone(harness.delayedA)]);
    await withTimeout(activationPersisted.promise, 'race_a activation before queued default load');

    const defaultQueued = createDeferred();
    const newerApplyQueued = createDeferred();
    const runCommit = harness.manager.runLibraryCommitForIntent.bind(harness.manager);
    let observedQueuedCommits = 0;
    harness.manager.runLibraryCommitForIntent = function runCommitObserved(generation, commit) {
        const result = runCommit(generation, commit);
        observedQueuedCommits += 1;
        if (observedQueuedCommits === 1) defaultQueued.resolve();
        if (observedQueuedCommits === 2) newerApplyQueued.resolve();
        return result;
    };

    const supersededDefault = harness.manager.loadLibrary('default');
    await withTimeout(defaultQueued.promise, 'default load queued behind race_a');
    const newerB = harness.manager.applyLibraryConfiguration('race_b', [clone(harness.immediateB)]);
    await withTimeout(newerApplyQueued.promise, 'newer race_b queued behind default load');
    activationRelease.resolve();

    const [delayedResult, defaultResult, newerResult] = await withTimeout(
        Promise.all([delayedA, supersededDefault, newerB]),
        'superseded queued default load completion'
    );
    assert.strictEqual(delayedResult, false);
    assert(Array.isArray(defaultResult), 'a stale queued load must preserve the public array contract');
    assert.deepStrictEqual(clone(defaultResult), []);
    assert.strictEqual(newerResult, true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assertLatestIntentRaceOutcome(harness, { expectedActivations: ['race_a', 'race_b'] });
    recordResult('排队后失效的默认库加载返回空数组', {
        activeKey: harness.getActiveId(),
        returnedArray: Array.isArray(defaultResult)
    });
}

async function establishDeletionRaceBaseline(harness) {
    harness.releaseReadingManifest();
    assert.strictEqual(
        await harness.manager.applyLibraryConfiguration('race_a', [clone(harness.delayedA)]),
        true
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(harness.getActiveId(), 'race_a');
    assert.deepStrictEqual(harness.effects.publications.map((entry) => entry.key), ['race_a']);
    assert.strictEqual(harness.window.ResourceCore.getPathMap().reading.root, 'Race/A/');
}

async function assertDeletionRaceWinner(harness, deletionResult, switchResult) {
    assert.strictEqual(deletionResult.deleted, true, 'the serialized deletion must be the sole winner');
    assert.strictEqual(switchResult, false, 'the conflicting switch must report that it did not commit');
    assert.strictEqual(harness.getActiveId(), 'race_a', 'the original active library must remain durable');
    assert.deepStrictEqual(
        await harness.window.AppData.library.getIndex('race_b'),
        [],
        'the deleted dataset must not be recreated from a captured switch snapshot'
    );
    assert(!harness.getConfigurations().some((config) => config.id === 'race_b' || config.key === 'race_b'));
    assert.deepStrictEqual(
        harness.effects.publications.map((entry) => entry.key),
        ['race_a'],
        'the deleted configuration must never publish after the coherent A baseline'
    );
    assert.strictEqual(harness.window.ResourceCore.getPathMap().reading.root, 'Race/A/');
    assert.strictEqual(harness.window.__activeLibraryPathMap.reading.root, 'Race/A/');
    assert.strictEqual(harness.window.pathMap.reading.root, 'Race/A/');
}

async function testDeleteFirstExcludesSwitchDuringRemove() {
    const harness = createLatestIntentRaceHarness();
    await establishDeletionRaceBaseline(harness);

    const removeStarted = createDeferred();
    const removeRelease = createDeferred();
    const remove = harness.window.AppData.library.remove.bind(harness.window.AppData.library);
    harness.window.AppData.library.remove = async function removeWithGate(id) {
        if (id === 'race_b') {
            removeStarted.resolve();
            await removeRelease.promise;
        }
        const result = await remove(id);
        if (await harness.window.AppData.library.getActive() === id) {
            await harness.window.AppData.library.activate(null);
        }
        return result;
    };

    const deletion = harness.manager.deleteLibraryConfiguration('race_b');
    await withTimeout(removeStarted.promise, 'delete-first remove entry');
    const switching = harness.manager.switchLibraryConfig('race_b');
    let switchSettled = false;
    switching.then(
        () => { switchSettled = true; },
        () => { switchSettled = true; }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(switchSettled, false,
        'a conflicting switch must queue until destructive cleanup completes');
    removeRelease.resolve();
    const [deletionResult, switchResult] = await withTimeout(
        Promise.all([deletion, switching]),
        'delete-first completion and stored-target revalidation'
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    await assertDeletionRaceWinner(harness, deletionResult, switchResult);
    recordResult('delete-first 与 switch 并发时独占删除成为唯一提交者', {
        deleted: deletionResult.deleted,
        switched: switchResult
    });
}

async function testDeleteFirstQueuesLaterDefaultSelection() {
    const harness = createLatestIntentRaceHarness();
    await establishDeletionRaceBaseline(harness);

    const removeStarted = createDeferred();
    const removeRelease = createDeferred();
    const successorQueued = createDeferred();
    const remove = harness.window.AppData.library.remove.bind(harness.window.AppData.library);
    harness.window.AppData.library.remove = async function removeWithGate(id) {
        if (id === 'race_b') {
            removeStarted.resolve();
            await removeRelease.promise;
        }
        return remove(id);
    };
    const runCommit = harness.manager.runLibraryCommitForIntent.bind(harness.manager);
    harness.manager.runLibraryCommitForIntent = function runCommitObserved(generation, commit) {
        const pending = runCommit(generation, commit);
        successorQueued.resolve();
        return pending;
    };

    const deletion = harness.manager.deleteLibraryConfiguration('race_b');
    await withTimeout(removeStarted.promise, 'delete-B destructive phase');
    const switching = harness.manager.switchLibraryConfig(null);
    await withTimeout(successorQueued.promise, 'later default selection queued behind delete-B');

    let switchSettled = false;
    switching.then(
        () => { switchSettled = true; },
        () => { switchSettled = true; }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(switchSettled, false,
        'the later non-conflicting selection must wait for delete-B instead of being discarded');

    removeRelease.resolve();
    const [deletionResult, switchResult] = await withTimeout(
        Promise.all([deletion, switching]),
        'delete-B followed by default selection'
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(deletionResult.deleted, true);
    assert.strictEqual(switchResult, true,
        'the later default selection must commit after destructive cleanup releases the queue');
    assert.strictEqual(harness.getActiveId(), null, 'the newer default selection must be durable');
    assert.deepStrictEqual(await harness.window.AppData.library.getIndex('race_b'), []);
    assert(!harness.getConfigurations().some((config) => config.id === 'race_b' || config.key === 'race_b'));
    assert.deepStrictEqual(harness.effects.publications, [
        { key: 'race_a', ids: ['race-a'], provenance: ['race_a'] },
        { key: null, ids: ['race-a'], provenance: [null] }
    ], 'A must remain coherent until the queued default publication replaces it');
    assert.deepStrictEqual(harness.effects.activations, ['race_a', null]);
    const expectedDefaultRoot = harness.manager.DEFAULT_PATH_MAP.reading.root;
    assert.strictEqual(harness.window.ResourceCore.getPathMap().reading.root, expectedDefaultRoot);
    assert.strictEqual(harness.window.__activeLibraryPathMap.reading.root, expectedDefaultRoot);
    assert.strictEqual(harness.window.pathMap.reading.root, expectedDefaultRoot);
    recordResult('delete-B 独占阶段会保留并顺序提交后续默认库选择', {
        deleted: deletionResult.deleted,
        switched: switchResult,
        activeKey: harness.getActiveId()
    });
}

async function createQueuedDeletionRace() {
    const harness = createLatestIntentRaceHarness();
    const examC = {
        ...clone(harness.immediateB),
        id: 'race-c',
        examId: 'race-c',
        path: 'Race/C/',
        filename: 'c.html',
        pdfFilename: 'c.pdf'
    };
    await harness.window.AppData.library.import({
        id: 'race_c',
        configuration: { name: 'Race C', examCount: 1 },
        index: [examC]
    });
    await establishDeletionRaceBaseline(harness);

    const removeStarted = createDeferred();
    const removeRelease = createDeferred();
    const commitsQueued = [createDeferred(), createDeferred()];
    let queuedCount = 0;
    const remove = harness.window.AppData.library.remove.bind(harness.window.AppData.library);
    harness.window.AppData.library.remove = async function removeWithGate(id) {
        if (id === 'race_b') {
            removeStarted.resolve();
            await removeRelease.promise;
        }
        return remove(id);
    };
    const runCommit = harness.manager.runLibraryCommitForIntent.bind(harness.manager);
    harness.manager.runLibraryCommitForIntent = function runCommitObserved(generation, commit) {
        const pending = runCommit(generation, commit);
        commitsQueued[queuedCount++]?.resolve();
        return pending;
    };

    return Object.assign(harness, { removeStarted, removeRelease, commitsQueued });
}

async function assertDeletedBAndSelectedTarget(harness, targetKey) {
    assert.deepStrictEqual(await harness.window.AppData.library.getIndex('race_b'), []);
    assert(!harness.getConfigurations().some((config) => config.id === 'race_b' || config.key === 'race_b'));
    assert.strictEqual(harness.getActiveId(), targetKey, 'the accepted selection must remain durable');
    const expectedId = targetKey === null ? 'race-a' : 'race-c';
    assert.deepStrictEqual(harness.effects.publications, [
        { key: 'race_a', ids: ['race-a'], provenance: ['race_a'] },
        { key: targetKey, ids: [expectedId], provenance: [targetKey] }
    ], 'only the accepted selection may replace the coherent A publication');
    assert.deepStrictEqual(harness.effects.activations, ['race_a', targetKey]);
    assert.deepStrictEqual(harness.effects.configRenders, ['race_a', targetKey]);
    const expectedRoot = targetKey === null ? harness.manager.DEFAULT_PATH_MAP.reading.root : 'Race/C/';
    assert.strictEqual(harness.window.ResourceCore.getPathMap().reading.root, expectedRoot);
    assert.strictEqual(harness.window.__activeLibraryPathMap.reading.root, expectedRoot);
    assert.strictEqual(harness.window.pathMap.reading.root, expectedRoot);
}

async function testDeletePreservesQueuedSelectionAfterRejectedSuccessor(targetKey, rejection) {
    const harness = await createQueuedDeletionRace();
    const deletion = harness.manager.deleteLibraryConfiguration('race_b');
    let switching;
    try {
        await withTimeout(harness.removeStarted.promise, 'delete-B before accepted selection');
        switching = harness.manager.switchLibraryConfig(targetKey);
        await withTimeout(harness.commitsQueued[0].promise, 'accepted selection queued behind delete-B');

        if (rejection === 'missing') {
            assert.strictEqual(await withTimeout(
                harness.manager.switchLibraryConfig('missing-config'),
                'missing successor rejection'
            ), false);
        } else if (rejection === 'empty') {
            assert.strictEqual(await withTimeout(
                harness.manager.applyLibraryConfiguration('empty-config', []),
                'empty successor rejection'
            ), false);
        } else {
            const loadPathMap = harness.manager.loadPathMapForConfiguration.bind(harness.manager);
            harness.manager.loadPathMapForConfiguration = async function loadPathMapWithFailure(key) {
                if (key === 'failing-config') throw new Error('simulated queued successor preflight failure');
                return loadPathMap(key);
            };
            await assert.rejects(withTimeout(
                harness.manager.applyLibraryConfiguration('failing-config', [clone(harness.immediateB)]),
                'failing successor preflight'
            ), /simulated queued successor preflight failure/);
        }

        let switchSettled = false;
        switching.then(
            () => { switchSettled = true; },
            () => { switchSettled = true; }
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.strictEqual(switchSettled, false, 'the accepted selection must wait for destructive cleanup');
        assert.strictEqual(harness.getActiveId(), 'race_a');
        assert.deepStrictEqual(harness.effects.publications.map((entry) => entry.key), ['race_a']);
        assert.strictEqual(harness.window.ResourceCore.getPathMap().reading.root, 'Race/A/');
    } finally {
        harness.removeRelease.resolve();
    }

    const [deletionResult, switchResult] = await withTimeout(
        Promise.all([deletion, switching]),
        'delete and accepted selection after rejected successor'
    );
    assert.strictEqual(deletionResult.deleted, true, 'a rejected successor must not interrupt deletion cleanup');
    assert.strictEqual(switchResult, true, 'a rejected successor must not cancel the accepted queued selection');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await assertDeletedBAndSelectedTarget(harness, targetKey);
    recordResult(`delete-B 后排队的 ${targetKey || 'default'} 不被 ${rejection} 请求取消`, { targetKey, rejection });
}

async function testNewerValidSelectionSupersedesDeleteQueuedSelection(firstKey, newerKey) {
    const harness = await createQueuedDeletionRace();
    const deletion = harness.manager.deleteLibraryConfiguration('race_b');
    let firstSelection;
    let newerSelection;
    try {
        await withTimeout(harness.removeStarted.promise, 'delete-B before competing valid selections');
        firstSelection = harness.manager.switchLibraryConfig(firstKey);
        await withTimeout(harness.commitsQueued[0].promise, 'first accepted selection queued');
        newerSelection = harness.manager.switchLibraryConfig(newerKey);
        await withTimeout(harness.commitsQueued[1].promise, 'newer accepted selection queued');
        assert.strictEqual(await withTimeout(
            harness.manager.switchLibraryConfig('missing-config'),
            'rejected request after two accepted selections'
        ), false);
        assert.deepStrictEqual(harness.effects.publications.map((entry) => entry.key), ['race_a']);
    } finally {
        harness.removeRelease.resolve();
    }

    const [deletionResult, firstResult, newerResult] = await withTimeout(
        Promise.all([deletion, firstSelection, newerSelection]),
        'delete and competing valid selections completion'
    );
    assert.strictEqual(deletionResult.deleted, true);
    assert.strictEqual(firstResult, false, 'a newer valid candidate must supersede the earlier reservation');
    assert.strictEqual(newerResult, true, 'the latest accepted candidate must survive the rejected request');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await assertDeletedBAndSelectedTarget(harness, newerKey);
    recordResult(`delete-B 后较新的 ${newerKey || 'default'} 覆盖 ${firstKey || 'default'} 预约`, { firstKey, newerKey });
}

async function testRejectedSuccessorDoesNotBypassDeletedTargetRevalidation() {
    const harness = await createQueuedDeletionRace();
    let revalidatedDeletedTarget = false;
    const getIndex = harness.window.AppData.library.getIndex.bind(harness.window.AppData.library);
    harness.window.AppData.library.getIndex = async function observeDeletedTargetRead(id) {
        const index = await getIndex(id);
        if (id === 'race_b' && index.length === 0) revalidatedDeletedTarget = true;
        return index;
    };
    const deletion = harness.manager.deleteLibraryConfiguration('race_b');
    let switching;
    try {
        await withTimeout(harness.removeStarted.promise, 'delete-B before same-target selection');
        switching = harness.manager.switchLibraryConfig('race_b');
        await withTimeout(harness.commitsQueued[0].promise, 'same-target selection queued');
        assert.strictEqual(await withTimeout(
            harness.manager.applyLibraryConfiguration('empty-config', []),
            'empty request after accepted same-target selection'
        ), false);
    } finally {
        harness.removeRelease.resolve();
    }

    const [deletionResult, switchResult] = await withTimeout(
        Promise.all([deletion, switching]),
        'deleted-target revalidation after rejected successor'
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(revalidatedDeletedTarget, true, 'the accepted reservation must reach stored-target revalidation');
    await assertDeletionRaceWinner(harness, deletionResult, switchResult);
    recordResult('拒绝后续请求仍不允许排队的已删除 B 复活', { switchResult });
}

async function testCapturedSwitchCannotCommitAfterDelete() {
    const harness = createLatestIntentRaceHarness();
    await establishDeletionRaceBaseline(harness);

    const pathReadStarted = createDeferred();
    const pathReadRelease = createDeferred();
    const loadPathMap = harness.manager.loadPathMapForConfiguration.bind(harness.manager);
    harness.manager.loadPathMapForConfiguration = async function loadPathMapWithCapturedBGate(key) {
        if (key === 'race_b') {
            pathReadStarted.resolve();
            await pathReadRelease.promise;
        }
        return loadPathMap(key);
    };

    const switching = harness.manager.switchLibraryConfig('race_b');
    await withTimeout(pathReadStarted.promise, 'switch-first captured B path lookup');
    const deletionResult = await withTimeout(
        harness.manager.deleteLibraryConfiguration('race_b'),
        'delete after switch captured B'
    );
    pathReadRelease.resolve();
    const switchResult = await withTimeout(switching, 'captured switch retirement');
    await new Promise((resolve) => setTimeout(resolve, 0));

    await assertDeletionRaceWinner(harness, deletionResult, switchResult);
    recordResult('switch-first 已捕获快照不会在删除完成后复活配置', {
        deleted: deletionResult.deleted,
        switched: switchResult
    });
}

async function testProductionUploadStopsAfterManagerRejection() {
    const harness = createLatestIntentRaceHarness();
    harness.releaseReadingManifest();
    loadSourceBlock(
        'js/boot-fallbacks.js',
        harness.context,
        "  if (typeof window.handleLibraryUpload !== 'function') {",
        '\n  const VALID_INITIAL_VIEWS',
        'handleLibraryUpload fallback'
    );

    const uploadExam = {
        id: 'upload-a',
        examId: 'upload-a',
        type: 'reading',
        sourceKind: 'file-picker',
        title: 'Rejected upload A',
        category: 'P1',
        path: 'Upload/A/',
        filename: 'a.html',
        importKey: 'reading:upload/a.html'
    };
    harness.window.LibraryDiscovery.discover = async function discoverUpload() {
        return {
            entries: [clone(uploadExam)],
            report: {
                accepted: 1,
                rejected: 0,
                files: 1,
                html: 1,
                pdf: 0,
                audio: 0,
                runtime: { registered: 1, html: 1, pdf: 0, audio: 0 },
                reasonCounts: {},
                rejectedSamples: [],
                warnings: []
            }
        };
    };

    const importStarted = createDeferred();
    const rejectImport = createDeferred();
    const importLibrary = harness.window.AppData.library.import.bind(harness.window.AppData.library);
    let importedConfigurationAttempts = 0;
    harness.window.AppData.library.import = async function importWithFirstAttemptRejection(payload) {
        if (String(payload?.id || '').startsWith('library_import_')) {
            importedConfigurationAttempts += 1;
            if (importedConfigurationAttempts === 1) {
                importStarted.resolve();
                await rejectImport.promise;
                throw new Error('simulated manager import rejection');
            }
        }
        return importLibrary(payload);
    };

    const upload = harness.window.handleLibraryUpload(
        { type: 'reading', mode: 'full' },
        [{ name: 'a.html' }]
    );
    await withTimeout(importStarted.promise, 'production upload manager import');
    assert.strictEqual(
        await harness.manager.applyLibraryConfiguration('race_b', [clone(harness.immediateB)]),
        true,
        'the newer B selection must commit while upload A is paused'
    );
    rejectImport.resolve();

    const report = await withTimeout(upload, 'production upload rejection report');
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(report.status, 'error', 'the invoked manager rejection must terminate as an error');
    assert.match(report.message, /simulated manager import rejection/);
    assert.strictEqual(importedConfigurationAttempts, 1,
        'the production wrapper must not enter the legacy writer for a second import');
    assert.strictEqual(harness.getConfigurations().length, 2,
        'a rejected manager import must not create a duplicate fallback configuration');
    assertLatestIntentRaceOutcome(harness);
    recordResult('生产上传在 manager rejection 后终止且不重入旧写路径', {
        status: report.status,
        importAttempts: importedConfigurationAttempts,
        activeKey: harness.getActiveId()
    });
}

async function testSwitchConfigurationDoesNotTouchPracticeRecords() {
    const seed = baseSeed();
    seed.useAppStateService = true;
    seed.library.importedIndexes.alt_config = [{
        id: 'listening-alt',
        examId: 'listening-alt',
        type: 'listening',
        title: 'Alt Listening',
        libraryConfigurationId: 'previous-library',
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
    let publishedIndex;
    window.dispatchEvent = function dispatchEvent(event) {
        if (event && event.type === 'examIndexLoaded') {
            publicationOrder.push('index-publication');
            publishedIndex = event.detail.index;
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
    assert.strictEqual(publishedIndex[0].libraryConfigurationId, 'alt_config', 'switching configurations overrides inherited card provenance');
    assert.strictEqual(seed.library.importedIndexes.alt_config[0].libraryConfigurationId, 'previous-library', 'render provenance must not mutate the stored source dataset');
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
    assert.strictEqual(getActiveId(), null, 'a fallback to default content must repair the invalid persistent selection');
    assert.strictEqual(loaded[0].libraryConfigurationId, null, 'fallback cards must retain builtin provenance despite the stale active configuration');
    recordResult('错误迁移的 v1 活动题库回退 Reading manifest', { loadedCount: loaded.length });
}

async function testCustomIndexReadFailureDoesNotPublishDefaultFallback() {
    const seed = baseSeed();
    const { window, getActiveId } = createHarness(seed);
    const publications = [];
    window.AppData.library.getIndex = async function getIndexRejected() {
        throw new Error('simulated custom index read failure');
    };
    window.dispatchEvent = function dispatchEvent(event) {
        if (event && event.type === 'examIndexLoaded') publications.push(clone(event.detail.index));
        return true;
    };

    const loaded = await window.LibraryManager.getInstance().loadActiveLibrary(true);

    assert.deepStrictEqual(clone(loaded), []);
    assert.strictEqual(getActiveId(), 'custom_active');
    assert.deepStrictEqual(publications, [], 'a storage read error must not be misrepresented as an empty custom library');
    recordResult('自定义题库读取失败不会发布默认库回退', {
        activeKey: getActiveId()
    });
}

async function testDefaultLoadPreservesArrayContractAndRoutingMetadata() {
    const seed = baseSeed();
    const { window, getActiveId } = createHarness(seed);
    const publications = [];
    window.dispatchEvent = function dispatchEvent(event) {
        if (event && event.type === 'examIndexLoaded') publications.push(clone(event.detail.index));
        return true;
    };

    const manager = window.LibraryManager.getInstance();
    const loaded = await manager.loadLibrary('default');

    assert(Array.isArray(loaded), 'the default load public contract must remain an index array');
    assert(loaded.length > 0);
    assert.strictEqual(getActiveId(), null);
    assert.strictEqual(loaded[0].sequenceNumber, 1);
    assert.strictEqual(window.examIndexMetadata?.source, 'default-script');
    assert.strictEqual(window.ResourceCore.getPathMap().reading.root, manager.resolveScriptPathRoot('reading'));
    assert.strictEqual(window.ResourceCore.getPathMap().listening.root, manager.resolveScriptPathRoot('listening'));
    assert.strictEqual(publications.length, 1);
    assert(publications[0].every((exam) => exam.libraryConfigurationId === null));
    recordResult('默认题库加载保留数组契约与路由元数据', {
        loadedCount: loaded.length
    });
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
    assert.strictEqual(loaded[0].libraryConfigurationId, 'healthy-custom', 'cards must retain the configuration that produced their content');
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
        await testColdListeningOnlyBaseLoadsManifestBeforeAddingDefaultReading();
        await testFullReadingCreatesSnapshotAndKeepsListening();
        await testIncrementalCreatesSnapshotAndDedupes();
        await testLoadActiveLibraryReconcilesPreUpgradeAvailability();
        await testApplyLibraryConfigurationReconcilesFetchedAndSuppliedAvailability();
        await testColdStartLoadsManifestBeforeCachedAndSuppliedAvailabilityReconciliation();
        await testNewerApplySupersedesManifestDelayedApply();
        await testNewerApplySupersedesManifestDelayedActiveLoad();
        await testProductionUiEntryCapturesIntentBeforeDatasetFetch();
        await testDefaultSwitchDoesNotNoopWhenActiveReadFails();
        await testSameActiveSwitchRemainsNoopWithoutPendingCommit();
        await testSameActiveReselectionRestartsDelayedActiveLoad();
        await testMissingSelectionRestartsDelayedActiveLoad();
        await testFailedDefaultCommitRecoversCanonicalDefaultState();
        await testNewerApplySupersedesManifestDelayedActivatingImport();
        await testRejectedNewerApplyDoesNotSplitDurableActivation();
        await testFailingNewerPreflightDoesNotSplitDurableActivation();
        await testFailingNewerCommitRecoversDurableActivation();
        await testFailingNewerCommitRecoversOlderSuppliedActivation();
        await testFailingNewerCommitPrefersOlderSuppliedSnapshotOverStoredIndex();
        await testFailedSameKeyActivationRestoresPriorCoherentDataset();
        await testActiveReloadRefreshesDurableRecoverySnapshot();
        await testFailedSuppliedCommitRecoversPreparedDataset();
        await testAsyncConfigRenderCannotRepaintStaleSelection();
        await testAsyncConfigRenderRejectionIsHandled();
        await testNewerApplyCommitsAfterDelayedOlderActivation();
        await testNewerActiveLoadWaitsForDelayedOlderActivation();
        await testFailingActiveLoadDoesNotInterruptDurableActivation();
        await testSupersededQueuedDefaultLoadReturnsEmptyArray();
        await testDeleteFirstExcludesSwitchDuringRemove();
        await testDeleteFirstQueuesLaterDefaultSelection();
        for (const targetKey of [null, 'race_c']) {
            for (const rejection of ['missing', 'empty', 'preflight']) {
                await testDeletePreservesQueuedSelectionAfterRejectedSuccessor(targetKey, rejection);
            }
        }
        await testNewerValidSelectionSupersedesDeleteQueuedSelection(null, 'race_c');
        await testNewerValidSelectionSupersedesDeleteQueuedSelection('race_c', null);
        await testRejectedSuccessorDoesNotBypassDeletedTargetRevalidation();
        await testCapturedSwitchCannotCommitAfterDelete();
        await testProductionUploadStopsAfterManagerRejection();
        await testSwitchConfigurationDoesNotTouchPracticeRecords();
        await testDeleteInactiveConfigurationCleansDatasetAndPathMap();
        await testDeleteConfigurationGuardsDefaultAndActive();
        await testDefaultLibrarySkipsListeningWithoutManifest();
        await testDefaultLibraryKeepsListeningWithManifest();
        await testBrokenLegacyActiveLibraryFallsBackToReadingManifest();
        await testCustomIndexReadFailureDoesNotPublishDefaultFallback();
        await testDefaultLoadPreservesArrayContractAndRoutingMetadata();
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

await main();
