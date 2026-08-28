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
class AppDataError extends Error { constructor(code, message) { super(message); this.code = code; } }

function harness(legacyValues, options = {}) {
    const catalogSandbox = { structuredClone }; catalogSandbox.globalThis = catalogSandbox;
    vm.runInContext(catalogSource, vm.createContext(catalogSandbox), { filename: 'dataCatalog.js' });
    const catalog = catalogSandbox.__AppDataV2Catalog;
    const shared = options.shared || { docs: new Map(), entities: new Map([['practiceSummaries', new Map()], ['practiceDetails', new Map()], ['practiceAnnotations', new Map()]]), counter: 0, legacyReads: 0, externalReads: 0 };
    if (!shared.entityRevisions) {
        shared.entityRevisions = new Map([
            ['practiceSummaries', new Map()],
            ['practiceDetails', new Map()],
            ['practiceAnnotations', new Map()]
        ]);
    }
    for (const store of ['practiceSummaries', 'practiceDetails', 'practiceAnnotations']) {
        if (!shared.entityRevisions.has(store)) shared.entityRevisions.set(store, new Map());
    }
    const envelope = (key, data, state = 'present', revision = 1, operationId = 'seed') => ({ schemaVersion: 2, revision, operationId, updatedAt: new Date().toISOString(), state, data: state === 'cleared' ? null : clone(data), checksum: checksum(state === 'cleared' ? null : data) });
    class Kernel {
        async initialize() { this.state = 'ready'; this.backend = 'memory'; return this; }
        async getEnvelope(key) { return shared.docs.get(key) || null; }
        async read(key, options = {}) { const entry = catalog.get(key); const value = shared.docs.get(key) || null; const data = !value || value.state === 'cleared' ? entry.defaultValue() : value.data; return options.withMeta ? { data: clone(data), envelope: clone(value) } : clone(data); }
        async mutate(changes, options = {}) { const op = String(options.operationId || `doc-${++shared.counter}`); const revisions = {}; for (const change of changes) { const old = shared.docs.get(change.logicalKey); if (change.expectedRevision !== undefined && Number(change.expectedRevision) !== Number(old && old.revision || 0)) throw new AppDataError('CONFLICT', 'document revision'); const revision = Number(old && old.revision || 0) + 1; shared.docs.set(change.logicalKey, envelope(change.logicalKey, change.data, change.state, revision, op)); revisions[change.logicalKey] = revision; } return { committed: true, operationId: op, revisions, derived: { status: 'ready', pending: [] }, warnings: [] }; }
        async readEntity(store, recordId) { const row = shared.entities.get(store).get(String(recordId)); return row ? clone(row.data) : null; }
        async getEntityRevision(store, recordId, options = {}) {
            const id = String(recordId);
            const row = shared.entities.get(store).get(id) || null;
            const revision = Math.max(
                Number(row && row.revision) || 0,
                Number(shared.entityRevisions.get(store).get(id)) || 0
            );
            return options.withPresence ? { revision, present: Boolean(row) } : revision;
        }
        async listEntities(store) { if (store !== 'practiceSummaries') throw new AppDataError('VALIDATION', 'details are not listable'); return Array.from(shared.entities.get(store).values()).map((row) => clone(row.data)); }
        async mutateEntities(operations, options = {}) {
            const op = String(options.operationId || `entity-${++shared.counter}`);
            for (const item of operations) {
                const id = String(item.recordId);
                const rows = shared.entities.get(item.store);
                const old = rows.get(id) || null;
                const revisionMap = shared.entityRevisions.get(item.store);
                const revision = Math.max(Number(old && old.revision) || 0, Number(revisionMap.get(id)) || 0);
                if (item.expectedRevision !== undefined && item.expectedRevision !== null
                    && Number(item.expectedRevision) !== revision) {
                    throw new AppDataError('CONFLICT', `entity revision: ${item.store}/${id}`);
                }
                const nextRevision = revision + 1;
                rows.set(id, { recordId: id, revision: nextRevision, operationId: op, data: clone(item.data) });
                revisionMap.set(id, nextRevision);
            }
            return { committed: true, operationId: op, revisions: {}, derived: { status: 'ready', pending: [] }, warnings: [] };
        }
        status() { return { state: this.state, backend: this.backend, failure: null }; }
    }
    const internals = { DataKernel: Kernel, AppDataError, catalog, clone, checksum, randomId: (prefix) => `${prefix}-${++shared.counter}`, nowIso: () => new Date().toISOString(), makeEnvelope: (entry, data, options = {}) => envelope(entry.logicalKey, data, options.state, options.revision, options.operationId), validateEnvelope: (entry, value) => Boolean(value && value.schemaVersion === 2 && value.checksum === checksum(value.data)), readLegacyValues: async () => { shared.legacyReads += 1; return clone(legacyValues); }, readLegacyExternalBackup: async () => { shared.externalReads += 1; return clone(options.externalBackup || null); } };
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

    const legacyFields = harness({
        vocab_list_p1_errors: [{ word: 'alpha' }],
        vocab_list_p4_errors: [{ word: 'beta' }],
        vocab_list_master_errors: [{ word: 'gamma' }],
        vocab_list_custom: [{ word: 'delta' }],
        vocab_list_reading_highlights: [{ word: 'epsilon' }],
        vocab_user_config: { dailyNew: 12, reviewLimit: 50 },
        vocab_active_list_id: 'p1',
        ui_preferences: { theme: 'light', retained: true, timer: { reading: { minutes: 20 } } },
        theme: 'dark',
        practice_timer_preferences: { listening: { minutes: 30 } }
    });
    await legacyFields.app.ready;
    const migratedLists = await legacyFields.app.vocab.listCollections();
    assert.deepStrictEqual(Object.keys(migratedLists).sort(), [
        'custom',
        'reading-highlights',
        'spelling-errors-master',
        'spelling-errors-p1',
        'spelling-errors-p4'
    ]);
    assert.strictEqual(migratedLists['spelling-errors-p1'][0].word, 'alpha');
    assert.strictEqual(migratedLists['reading-highlights'][0].word, 'epsilon');
    assert.deepStrictEqual(await legacyFields.app.vocab.getConfig(), {
        dailyNew: 12,
        reviewLimit: 50,
        activeListId: 'spelling-errors-p1'
    });
    assert.deepStrictEqual(await legacyFields.app.preferences.getAll(), {
        theme: 'dark',
        retained: true,
        timer: { listening: { minutes: 30 } }
    }, 'standalone legacy preferences overlay the aggregate object instead of being skipped');

    const partialDocuments = {
        docs: new Map(),
        entities: new Map([['practiceSummaries', new Map()], ['practiceDetails', new Map()], ['practiceAnnotations', new Map()]]),
        counter: 0,
        legacyReads: 0,
        externalReads: 0
    };
    const seedEnvelope = (data, revision = 1) => ({
        schemaVersion: 2,
        revision,
        operationId: 'partial-v2-seed',
        updatedAt: '2026-07-26T00:00:00.000Z',
        state: 'present',
        data: clone(data),
        checksum: checksum(data)
    });
    partialDocuments.docs.set('vocab.words', seedEnvelope([
        { word: 'shared', source: 'v2' },
        { word: 'new-only', source: 'v2' }
    ]));
    partialDocuments.docs.set('preferences.values', seedEnvelope({ theme: 'v2-theme', v2Only: true }));
    const retriedMigration = harness({
        vocab_words: [
            { word: 'shared', source: 'legacy' },
            { word: 'legacy-only', source: 'legacy' }
        ],
        ui_preferences: { theme: 'legacy-theme', legacyOnly: true }
    }, { shared: partialDocuments });
    await retriedMigration.app.ready;
    const reconciledWords = await retriedMigration.app.vocab.listWords();
    assert.deepStrictEqual(reconciledWords.map((word) => word.word), ['shared', 'legacy-only', 'new-only']);
    assert.strictEqual(reconciledWords.find((word) => word.word === 'shared').source, 'v2');
    assert.deepStrictEqual(await retriedMigration.app.preferences.getAll(), {
        theme: 'v2-theme',
        legacyOnly: true,
        v2Only: true
    });
    assert.strictEqual(partialDocuments.docs.get('system.migrations').data.v1ToV2.status, 'complete');

    const tombstonedExternal = {
        docs: new Map(),
        entities: new Map([
            ['practiceSummaries', new Map()],
            ['practiceDetails', new Map()],
            ['practiceAnnotations', new Map()]
        ]),
        entityRevisions: new Map([
            ['practiceSummaries', new Map([['late-external', 4]])],
            ['practiceDetails', new Map([['late-external', 4]])],
            ['practiceAnnotations', new Map([['late-external', 4]])]
        ]),
        counter: 0,
        legacyReads: 0,
        externalReads: 0
    };
    tombstonedExternal.docs.set('system.migrations', seedEnvelope({
        v1ToV2: { version: 1, status: 'complete' }
    }));
    const lateExternalPayload = { practiceRecords: [{
        id: 'late-external',
        type: 'reading',
        title: 'Recovered after tombstone',
        totalQuestions: 1,
        correctAnswers: 1
    }] };
    const restoredTombstone = harness({}, {
        shared: tombstonedExternal,
        externalBackup: lateExternalPayload
    });
    await restoredTombstone.app.ready;
    const restoredSummary = (await restoredTombstone.app.practice.list({ projection: 'light' }))
        .find((record) => record.id === 'late-external');
    assert.strictEqual(restoredSummary.title, 'Recovered after tombstone');
    for (const store of ['practiceSummaries', 'practiceDetails', 'practiceAnnotations']) {
        assert.strictEqual(tombstonedExternal.entities.get(store).get('late-external').revision, 5,
            'legacy restore must compare against and advance the durable tombstone revision');
    }
    assert.strictEqual(tombstonedExternal.docs.get('system.migrations').data.externalBackupV1.status, 'consumed');
    assert.strictEqual(tombstonedExternal.legacyReads, 0, 'a late external backup must not rescan completed v1 data');

    const tombstoneSecondBoot = harness({}, {
        shared: tombstonedExternal,
        externalBackup: lateExternalPayload
    });
    await tombstoneSecondBoot.app.ready;
    assert.strictEqual(tombstonedExternal.externalReads, 1,
        'the durable consumed marker must make tombstone recovery idempotent across boots');
    for (const store of ['practiceSummaries', 'practiceDetails', 'practiceAnnotations']) {
        assert.strictEqual(tombstonedExternal.entities.get(store).get('late-external').revision, 5);
    }

    const merged = harness({ practice_records: [
        { id: 'idb-only', type: 'reading', title: 'IDB only', totalQuestions: 1, correctAnswers: 1 },
        { id: 'shared', type: 'reading', title: 'IDB wins', totalQuestions: 1, correctAnswers: 1 }
    ] }, { externalBackup: { practiceRecords: [
        { id: 'external-only', type: 'reading', title: 'External only', totalQuestions: 1, correctAnswers: 1 },
        { id: 'shared', type: 'reading', title: 'External loses', totalQuestions: 1, correctAnswers: 0 }
    ] } });
    const mergedSummaries = await merged.app.practice.list({ projection: 'light' });
    assert.deepStrictEqual(mergedSummaries.map((record) => record.id).sort(), ['external-only', 'idb-only', 'shared']);
    assert.strictEqual(mergedSummaries.find((record) => record.id === 'shared').title, 'IDB wins');
    assert.strictEqual(merged.shared.docs.get('system.migrations').data.externalBackupV1.status, 'consumed');

    const secondBoot = harness({ practice_records: [
        { id: 'must-not-resurrect', type: 'reading', totalQuestions: 1, correctAnswers: 1 }
    ] }, { shared: merged.shared, externalBackup: { practiceRecords: [
        { id: 'must-not-reimport', type: 'reading', totalQuestions: 1, correctAnswers: 1 }
    ] } });
    await secondBoot.app.ready;
    assert.strictEqual(merged.shared.legacyReads, 1, 'completed migration must not rescan v1');
    assert.strictEqual(merged.shared.externalReads, 1, 'consumed external JSON must not be read again');
    assert.strictEqual((await secondBoot.app.practice.list({ projection: 'light' })).length, 3);

    const partialShared = { docs: new Map(), entities: new Map([['practiceSummaries', new Map()], ['practiceDetails', new Map()], ['practiceAnnotations', new Map()]]), counter: 0, legacyReads: 0, externalReads: 0 };
    partialShared.entities.get('practiceSummaries').set('partial', {
        recordId: 'partial', revision: 1, operationId: 'seed', data: { id: 'partial', type: 'reading', title: 'Keep v2 summary' }
    });
    const partial = harness({ practice_records: [{
        id: 'partial', type: 'reading', title: 'Legacy summary', totalQuestions: 1, correctAnswers: 1,
        answers: { 1: 'A' }, notes: { 1: 'Recovered note' }
    }] }, { shared: partialShared });
    await partial.app.ready;
    assert.strictEqual(partial.shared.entities.get('practiceSummaries').get('partial').data.title, 'Keep v2 summary');
    assert.strictEqual(partial.shared.entities.get('practiceDetails').get('partial').data.answers[1], 'A');
    assert.strictEqual(partial.shared.entities.get('practiceAnnotations').get('partial').data.notes[1], 'Recovered note');

    const customLibrary = harness({
        active_exam_index_key: 'exam_index_1700000000000',
        exam_index_configurations: [{ id: 'exam_index_1700000000000', name: 'Legacy custom' }],
        exam_index_1700000000000: [{ id: 'legacy-exam', type: 'reading' }]
    });
    await customLibrary.app.ready;
    const activeId = await customLibrary.app.library.getActive();
    assert.match(activeId, /^legacy-library-/);
    assert.strictEqual((await customLibrary.app.library.getIndex(activeId))[0].id, 'legacy-exam');
    assert.strictEqual((await customLibrary.app.library.listConfigurations())[0].id, activeId);

    console.log('PASS legacyMigrationBrickRegression');
}

run().catch((error) => { console.error('FAIL legacyMigrationBrickRegression'); console.error(error); process.exit(1); });
