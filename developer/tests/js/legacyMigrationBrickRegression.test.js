#!/usr/bin/env node
// Regression: a single malformed v1 practice record (e.g. negative duration) must NOT
// reject AppData's module-level `ready` promise. Before the fix, migrateLegacyData ran
// unguarded inside the ready chain, so one bad record threw VALIDATION -> ready rejected
// as INITIALIZATION_BLOCKED -> every browse read awaiting ready failed -> #browse-view
// loading overlay never cleared (browse "won't open / freezes"), and with zero summaries
// written the idempotency guard never tripped, so reload re-hit the same record forever.
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const appDataSource = fs.readFileSync(path.join(root, 'js/data/v2/appData.js'), 'utf8');
const catalogSource = fs.readFileSync(path.join(root, 'js/data/v2/dataCatalog.js'), 'utf8');
const recordSource = fs.readFileSync(path.join(root, 'js/data/practiceRecordSource.js'), 'utf8');
const clone = (value) => value === undefined ? undefined : structuredClone(value);
function stable(value) { if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`; if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`; return JSON.stringify(value); }
function checksum(value) { let hash = 0x811c9dc5; for (const char of stable(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 0x01000193); } return `fnv1a-${(hash >>> 0).toString(16)}`; }
function parseLegacyValue(value) { let parsed = clone(value); for (let depth = 0; depth < 3; depth += 1) { if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch { break; } } else if (parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, 'data') && (Object.prototype.hasOwnProperty.call(parsed, 'version') || Object.prototype.hasOwnProperty.call(parsed, 'compressed'))) parsed = parsed.data; else break; } return clone(parsed); }
class AppDataError extends Error { constructor(code, message) { super(message); this.code = code; } }

function harness(legacyValues, seedDocuments = {}, options = {}) {
    const catalogSandbox = { structuredClone }; catalogSandbox.globalThis = catalogSandbox;
    vm.runInContext(catalogSource, vm.createContext(catalogSandbox), { filename: 'dataCatalog.js' });
    const catalog = catalogSandbox.__AppDataV2Catalog;
    const envelope = (key, data, state = 'present', revision = 1, operationId = 'seed') => ({ schemaVersion: 2, revision, operationId, updatedAt: new Date().toISOString(), state, data: state === 'cleared' ? null : clone(data), checksum: checksum(state === 'cleared' ? null : data) });
    const shared = options.shared || {
        docs: new Map(),
        entities: new Map([['practiceSummaries', new Map()], ['practiceDetails', new Map()], ['practiceAnnotations', new Map()]]),
        counter: 0,
        legacyReadCount: 0,
        externalReadCount: 0,
        documentMutationCount: 0,
        entityMutationCount: 0
    };
    if (!options.shared) {
        for (const [key, data] of Object.entries(seedDocuments)) {
            shared.docs.set(key, envelope(key, data, 'present', 1, options.seedDocumentOperationIds?.[key] || 'seed'));
        }
        for (const [store, rows] of Object.entries(options.seedEntities || {})) {
            for (const [recordId, data] of Object.entries(rows)) {
                shared.entities.get(store).set(recordId, {
                    recordId,
                    revision: 1,
                    operationId: 'seed',
                    updatedAt: new Date().toISOString(),
                    data: clone(data),
                    checksum: checksum(data)
                });
            }
        }
    }
    class Kernel {
        async initialize() { this.state = 'ready'; this.backend = 'memory'; return this; }
        async getEnvelope(key) { return shared.docs.get(key) || null; }
        async read(key, options = {}) { const entry = catalog.get(key); const value = shared.docs.get(key) || null; const data = !value || value.state === 'cleared' ? entry.defaultValue() : value.data; return options.withMeta ? { data: clone(data), envelope: clone(value) } : clone(data); }
        async mutate(changes, options = {}) { const op = String(options.operationId || `doc-${++shared.counter}`); const revisions = {}; shared.documentMutationCount += 1; for (const change of changes) { const old = shared.docs.get(change.logicalKey); if (change.expectedRevision !== undefined && Number(change.expectedRevision) !== Number(old && old.revision || 0)) throw new AppDataError('CONFLICT', 'document revision'); const revision = Number(old && old.revision || 0) + 1; shared.docs.set(change.logicalKey, envelope(change.logicalKey, change.data, change.state, revision, op)); revisions[change.logicalKey] = revision; } return { committed: true, operationId: op, revisions, derived: { status: 'ready', pending: [] }, warnings: [] }; }
        async readEntity(store, recordId, options = {}) { const row = shared.entities.get(store).get(String(recordId)) || null; return options.withMeta ? clone(row) : row && clone(row.data); }
        async listEntities(store) { if (store !== 'practiceSummaries') throw new AppDataError('VALIDATION', 'details are not listable'); return Array.from(shared.entities.get(store).values()).map((row) => clone(row.data)); }
        async mutateEntities(operations, options = {}) { const op = String(options.operationId || `entity-${++shared.counter}`); shared.entityMutationCount += 1; for (const item of operations) { const rows = shared.entities.get(item.store); const old = rows.get(String(item.recordId)); if (item.expectedRevision !== undefined && Number(item.expectedRevision) !== Number(old && old.revision || 0)) throw new AppDataError('CONFLICT', 'entity revision'); if (item.type === 'delete') { rows.delete(String(item.recordId)); continue; } const data = clone(item.data); rows.set(String(item.recordId), { recordId: String(item.recordId), revision: Number(old && old.revision || 0) + 1, operationId: op, updatedAt: new Date().toISOString(), data, checksum: checksum(data) }); } return { committed: true, operationId: op, revisions: {}, derived: { status: 'ready', pending: [] }, warnings: [] }; }
        status() { return { state: this.state, backend: this.backend, failure: null }; }
    }
    const internals = { DataKernel: Kernel, AppDataError, catalog, clone, checksum, parseLegacyValue, randomId: (prefix) => `${prefix}-${++shared.counter}`, nowIso: () => new Date().toISOString(), makeEnvelope: (entry, data, options = {}) => envelope(entry.logicalKey, data, options.state, options.revision, options.operationId), validateEnvelope: (entry, value) => Boolean(value && value.schemaVersion === 2 && value.checksum === checksum(value.data)), readLegacyValues: async () => { shared.legacyReadCount += 1; return clone(legacyValues); }, readLegacyExternalBackup: async () => { shared.externalReadCount += 1; return clone(options.externalBackup || null); } };
    const sandbox = { console: { log() {}, warn() {}, error() {} }, Date, JSON, Math, Map, Set, Promise, structuredClone, __AppDataV2Internals: internals, sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} } }; sandbox.window = sandbox; sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox); vm.runInContext(recordSource, context, { filename: 'practiceRecordSource.js' }); vm.runInContext(appDataSource, context, { filename: 'appData.js' }); return { app: sandbox.AppData, shared };
}

async function run() {
    // One valid record + one malformed (negative duration -> canonicalizeRecord throws VALIDATION).
    const legacy = { practice_records: [
        { id: 'good-1', type: 'reading', duration: 120, totalQuestions: 10, correctAnswers: 8, accuracy: 0.8 },
        { id: 'bad-1', type: 'reading', duration: -5, totalQuestions: 10, correctAnswers: 8, accuracy: 0.8 }
    ] };
    const { app } = harness(legacy);

    // Core regression: ready must resolve; browse's data read must not throw INITIALIZATION_BLOCKED.
    const summaries = await app.practice.list({ projection: 'light' });

    // Good record migrated; malformed record skipped rather than bricking the whole migration.
    assert.strictEqual(summaries.length, 1, 'exactly the one valid record should migrate');
    assert.strictEqual(summaries[0].id, 'good-1', 'the valid record must survive');
    assert.deepStrictEqual(await app.settings.getAll(), {}, 'settings read after migration must not reject');

    // Empty legacy set is also a clean resolve (no records path).
    const empty = harness({});
    assert.deepStrictEqual(await empty.app.practice.list({ projection: 'light' }), [], 'empty legacy migrates to empty list');

    const externalMerge = harness({ practice_records: [
        { id: 'idb-only', type: 'reading', title: 'IndexedDB only', totalQuestions: 1, correctAnswers: 1 },
        { id: 'shared-source', type: 'reading', title: 'IndexedDB wins', totalQuestions: 1, correctAnswers: 1 }
    ] }, {}, { externalBackup: { practiceRecords: [
        { id: 'external-only', type: 'reading', title: 'External only', totalQuestions: 1, correctAnswers: 1 },
        { id: 'shared-source', type: 'reading', title: 'External loses', totalQuestions: 1, correctAnswers: 0 }
    ] } });
    await externalMerge.app.ready;
    assert.deepStrictEqual(
        (await externalMerge.app.practice.list({ projection: 'light' })).map((record) => record.id).sort(),
        ['external-only', 'idb-only', 'shared-source'],
        'external JSON and v1 IndexedDB records must be unioned'
    );
    assert.strictEqual((await externalMerge.app.practice.get('shared-source')).title, 'IndexedDB wins',
        'v1 IndexedDB must win same-id conflicts');
    assert.strictEqual(externalMerge.shared.docs.get('system.migrations').data.externalBackupV1.status, 'consumed');
    const secondExternalBoot = harness({ practice_records: [] }, {}, {
        shared: externalMerge.shared,
        externalBackup: { practice_records: [{ id: 'must-not-reimport', type: 'reading', totalQuestions: 1, correctAnswers: 1 }] }
    });
    await secondExternalBoot.app.ready;
    assert.strictEqual(externalMerge.shared.externalReadCount, 1, 'the frozen v1 JSON must be consumed only once');
    assert.strictEqual(await secondExternalBoot.app.practice.get('must-not-reimport'), null);

    const defaultLibrary = harness({
        active_exam_index_key: 'exam_index',
        exam_index_configurations: [{ id: 'exam_index', key: 'exam_index', name: '默认题库' }],
        exam_index: [{ id: 'must-not-migrate', type: 'reading' }]
    });
    await defaultLibrary.app.ready;
    assert.strictEqual(await defaultLibrary.app.library.getActive(), null, 'v1 default sentinel must become the v2 built-in manifest selection');
    assert.deepStrictEqual(await defaultLibrary.app.library.listConfigurations(), [], 'the generated default index is not user library data');

    const customLibrary = harness({
        active_exam_index_key: 'exam_index_1700000000000',
        exam_index_configurations: [{ id: 'exam_index_1700000000000', key: 'exam_index_1700000000000', name: '旧自定义题库' }],
        exam_index_1700000000000: [{ id: 'legacy-custom-exam', type: 'reading' }]
    });
    await customLibrary.app.ready;
    const migratedCustomId = await customLibrary.app.library.getActive();
    assert.match(migratedCustomId, /^legacy-library-/, 'v1 custom library ids must be remapped out of the reserved namespace');
    assert.strictEqual((await customLibrary.app.library.getIndex(migratedCustomId))[0].id, 'legacy-custom-exam');
    assert.strictEqual(customLibrary.shared.docs.get('system.migrations').data.v1ToV2.status, 'complete', 'successful repair must persist a completion marker');

    // Exact bad-migration wrappers are replaced from the live v1 source while
    // fields written only on the wrapper after migration are preserved.
    const poisoned = harness({
        settings: { theme: 'dark', notifications: false },
        vocab_words: [{ id: 'restored-vocab-word', term: 'recover' }],
        practice_records: [{ id: 'recovered-from-poison', type: 'reading', totalQuestions: 1, correctAnswers: 1 }],
        active_exam_index_key: 'exam_index_1800000000000',
        exam_index_configurations: [{ id: 'exam_index_1800000000000', key: 'exam_index_1800000000000', name: '可恢复题库' }],
        exam_index_1800000000000: [{ id: 'recovered-exam', type: 'reading' }]
    }, {
        'settings.values': {
            key: 'exam_system_settings',
            value: JSON.stringify({ data: { theme: 'light', notifications: true }, version: '1.0.0', compressed: false }),
            timestamp: 1,
            currentOnly: true
        },
        'vocab.words': [],
        'library.configurations': [],
        'library.activeConfigurationId': '[object Object]'
    }, {
        seedDocumentOperationIds: {
            'settings.values': 'achievement-delivery-after-bad-migration',
            'vocab.words': 'legacy-documents-fnv1a-bad-row'
        }
    });
    await poisoned.app.ready;
    assert.strictEqual((await poisoned.app.practice.get('recovered-from-poison')).correctAnswers, 1);
    assert.strictEqual((await poisoned.app.settings.getAll()).theme, 'dark');
    assert.strictEqual((await poisoned.app.settings.getAll()).notifications, false);
    assert.strictEqual((await poisoned.app.settings.getAll()).currentOnly, true);
    assert.strictEqual((await poisoned.app.vocab.listWords())[0].id, 'restored-vocab-word');
    const repairedActive = await poisoned.app.library.getActive();
    assert.match(repairedActive, /^legacy-library-/);
    assert.strictEqual((await poisoned.app.library.getIndex(repairedActive))[0].id, 'recovered-exam');
    assert.strictEqual(
        poisoned.shared.docs.get('system.migrations').data.v1ToV2.mode,
        'persistent-reconcile'
    );

    // A completion marker and healthy v2 data never suppress the persistent
    // legacy union. Healthy v2-only documents and records remain intact.
    const healthyExisting = harness({
        settings: { theme: 'light', legacyOnly: true },
        vocab_words: [
            { id: 'shared-word', term: 'legacy-value' },
            { id: 'legacy-word', term: 'legacy-only' }
        ],
        practice_records: [{ id: 'intentionally-deleted', type: 'reading', totalQuestions: 1, correctAnswers: 1 }],
        active_exam_index_key: 'exam_index_1900000000000',
        exam_index_configurations: [{ id: 'exam_index_1900000000000', key: 'exam_index_1900000000000', name: '已删除题库' }],
        exam_index_1900000000000: [{ id: 'deleted-exam', type: 'reading' }]
    }, {
        'settings.values': { theme: 'dark' },
        'vocab.words': [
            { id: 'shared-word', term: 'current-value' },
            { id: 'v2-word', term: 'v2-only' }
        ],
        'system.migrations': { v1ToV2: { version: 3, status: 'complete', mode: 'existing-v2' } }
    }, {
        seedEntities: {
            practiceSummaries: { 'v2-only': { id: 'v2-only', sessionId: 'v2-only', type: 'reading', totalQuestions: 1, correctAnswers: 1 } },
            practiceDetails: { 'v2-only': { recordId: 'v2-only', answers: { q1: 'V2' } } },
            practiceAnnotations: { 'v2-only': { recordId: 'v2-only', notes: { q1: 'V2' } } }
        }
    });
    await healthyExisting.app.ready;
    assert.strictEqual((await healthyExisting.app.practice.get('intentionally-deleted')).correctAnswers, 1);
    assert.strictEqual((await healthyExisting.app.practice.get('v2-only')).answers.q1, 'V2');
    assert.strictEqual((await healthyExisting.app.settings.getAll()).theme, 'dark');
    assert.strictEqual((await healthyExisting.app.settings.getAll()).legacyOnly, true);
    const reconciledWords = await healthyExisting.app.vocab.listWords();
    assert.deepStrictEqual(reconciledWords.map((word) => word.id).sort(), ['legacy-word', 'shared-word', 'v2-word']);
    assert.strictEqual(reconciledWords.find((word) => word.id === 'shared-word').term, 'current-value');
    const restoredHealthyLibraryId = (await healthyExisting.app.library.listConfigurations())[0].id;
    assert.match(restoredHealthyLibraryId, /^legacy-library-/);
    assert.strictEqual((await healthyExisting.app.library.getIndex(restoredHealthyLibraryId))[0].id, 'deleted-exam');
    assert.strictEqual(healthyExisting.shared.docs.get('system.migrations').data.v1ToV2.mode, 'persistent-reconcile');

    // A poisoned active pointer is repaired from v1 while the healthy v2-only
    // library remains in the union.
    const activePoisonWithHealthyLibrary = harness({
        active_exam_index_key: 'exam_index_2000000000000',
        exam_index_configurations: [{ id: 'exam_index_2000000000000', key: 'exam_index_2000000000000', name: '旧库' }],
        exam_index_2000000000000: [{ id: 'must-stay-deleted', type: 'reading' }]
    }, {
        'library.configurations': [{ id: 'current-library', key: 'current-library', name: '当前库', examCount: 1 }],
        'library.importedIndexes': { 'current-library': [{ id: 'current-exam', type: 'reading' }] },
        'library.activeConfigurationId': '[object Object]'
    });
    await activePoisonWithHealthyLibrary.app.ready;
    const reconciledLibraryIds = (await activePoisonWithHealthyLibrary.app.library.listConfigurations()).map((item) => item.id).sort();
    assert.strictEqual(reconciledLibraryIds.length, 2);
    assert(reconciledLibraryIds.includes('current-library'));
    const restoredActiveId = reconciledLibraryIds.find((id) => id !== 'current-library');
    assert.match(restoredActiveId, /^legacy-library-/);
    assert.strictEqual(await activePoisonWithHealthyLibrary.app.library.getActive(), restoredActiveId);
    assert.deepStrictEqual(Object.keys(activePoisonWithHealthyLibrary.shared.docs.get('library.importedIndexes').data).sort(), reconciledLibraryIds);
    assert.strictEqual(
        (await activePoisonWithHealthyLibrary.app.library.getIndex('current-library'))[0].id,
        'current-exam'
    );
    assert.strictEqual(
        (await activePoisonWithHealthyLibrary.app.library.getIndex(restoredActiveId))[0].id,
        'must-stay-deleted'
    );

    // Persistent reconciliation adds v1-only IDs, preserves complete healthy
    // v2 records on collision, and atomically replaces a partial three-layer row.
    const mixedLegacy = {
        practice_records: [
            { id: 'shared-id', type: 'reading', title: 'V1 Shared', totalQuestions: 1, correctAnswers: 1, answers: { q1: 'V1' }, notes: { q1: 'V1' } },
            { id: 'v1-only', type: 'reading', title: 'V1 Only', totalQuestions: 1, correctAnswers: 1 },
            { id: 'partial-id', type: 'reading', title: 'V1 Repaired', totalQuestions: 1, correctAnswers: 1, answers: { q1: 'V1' }, notes: { q1: 'V1' } }
        ]
    };
    const mixed = harness(mixedLegacy, {
        'system.migrations': { v1ToV2: { version: 3, status: 'complete' } }
    }, {
        seedEntities: {
            practiceSummaries: {
                'shared-id': { id: 'shared-id', sessionId: 'shared-id', title: 'V2 Shared', type: 'reading', totalQuestions: 1, correctAnswers: 0 },
                'v2-only': { id: 'v2-only', sessionId: 'v2-only', title: 'V2 Only', type: 'reading', totalQuestions: 1, correctAnswers: 1 },
                'partial-id': { id: 'partial-id', sessionId: 'partial-id', title: 'Broken Partial', type: 'reading', totalQuestions: 1, correctAnswers: 0 }
            },
            practiceDetails: {
                'shared-id': { recordId: 'shared-id', answers: { q1: 'V2' } },
                'v2-only': { recordId: 'v2-only', answers: { q1: 'V2' } }
            },
            practiceAnnotations: {
                'shared-id': { recordId: 'shared-id', notes: { q1: 'V2' } },
                'v2-only': { recordId: 'v2-only', notes: { q1: 'V2' } }
            }
        }
    });
    await mixed.app.ready;
    assert.deepStrictEqual(
        (await mixed.app.practice.list({ projection: 'light' })).map((item) => item.id).sort(),
        ['partial-id', 'shared-id', 'v1-only', 'v2-only']
    );
    assert.strictEqual((await mixed.app.practice.get('shared-id')).answers.q1, 'V2');
    assert.strictEqual((await mixed.app.practice.get('shared-id')).title, 'V2 Shared');
    assert.strictEqual((await mixed.app.practice.get('partial-id')).answers.q1, 'V1');
    assert.strictEqual((await mixed.app.practice.get('partial-id')).title, 'V1 Repaired');

    const revisionSnapshot = Object.fromEntries(Array.from(mixed.shared.entities.entries()).map(([store, rows]) => [
        store,
        Object.fromEntries(Array.from(rows.entries()).map(([id, row]) => [id, row.revision]))
    ]));
    const mutationSnapshot = {
        documents: mixed.shared.documentMutationCount,
        entities: mixed.shared.entityMutationCount
    };
    const rebooted = harness(mixedLegacy, {}, { shared: mixed.shared });
    await rebooted.app.ready;
    assert.strictEqual(rebooted.shared.legacyReadCount, 2, 'every startup must read v1 even after a complete marker');
    assert.strictEqual(rebooted.shared.documentMutationCount, mutationSnapshot.documents, 'idempotent reboot must not rewrite documents');
    assert.strictEqual(rebooted.shared.entityMutationCount, mutationSnapshot.entities, 'idempotent reboot must not rewrite practice layers');
    assert.deepStrictEqual(
        Object.fromEntries(Array.from(rebooted.shared.entities.entries()).map(([store, rows]) => [
            store,
            Object.fromEntries(Array.from(rows.entries()).map(([id, row]) => [id, row.revision]))
        ])),
        revisionSnapshot
    );
    await rebooted.app.practice.delete('v1-only');
    assert.strictEqual(await rebooted.app.practice.get('v1-only'), null);
    const mutationsAfterDelete = rebooted.shared.entityMutationCount;
    const restoredAfterDelete = harness(mixedLegacy, {}, { shared: rebooted.shared });
    await restoredAfterDelete.app.ready;
    assert.strictEqual((await restoredAfterDelete.app.practice.get('v1-only')).id, 'v1-only');
    assert.strictEqual(
        restoredAfterDelete.shared.entityMutationCount,
        mutationsAfterDelete + 1,
        'a v1-backed deletion is restored by exactly one atomic reconciliation'
    );

    const transientLegacy = {
        active_sessions: [{
            id: 'legacy-active-session',
            sessionId: 'legacy-active-session',
            timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        }, {
            id: 'legacy-stale-session',
            sessionId: 'legacy-stale-session',
            timestamp: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
        }]
    };
    const transientFirstBoot = harness(transientLegacy);
    await transientFirstBoot.app.ready;
    assert.deepStrictEqual(
        (await transientFirstBoot.app.recovery.listActiveSessions()).map((entry) => entry.id),
        ['legacy-active-session'],
        'startup keeps fresh recovery rows while pruning entries beyond the 30-day TTL'
    );
    await transientFirstBoot.app.recovery.completeActiveSession('legacy-active-session');
    assert.strictEqual((await transientFirstBoot.app.recovery.listActiveSessions()).length, 0);
    const transientSecondBoot = harness(transientLegacy, {}, { shared: transientFirstBoot.shared });
    await transientSecondBoot.app.ready;
    assert.strictEqual(
        (await transientSecondBoot.app.recovery.listActiveSessions()).length,
        0,
        'completed transient recovery rows must not be resurrected from frozen v1 data'
    );

    console.log('PASS legacyMigrationBrickRegression');
}

run().catch((error) => { console.error('FAIL legacyMigrationBrickRegression'); console.error(error); process.exit(1); });
