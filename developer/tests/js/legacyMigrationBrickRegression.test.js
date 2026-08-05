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
    const envelope = (key, data, state = 'present', revision = 1, operationId = 'seed') => ({ schemaVersion: 2, revision, operationId, updatedAt: new Date().toISOString(), state, data: state === 'cleared' ? null : clone(data), checksum: checksum(state === 'cleared' ? null : data) });
    class Kernel {
        async initialize() { this.state = 'ready'; this.backend = 'memory'; return this; }
        async getEnvelope(key) { return shared.docs.get(key) || null; }
        async read(key, options = {}) { const entry = catalog.get(key); const value = shared.docs.get(key) || null; const data = !value || value.state === 'cleared' ? entry.defaultValue() : value.data; return options.withMeta ? { data: clone(data), envelope: clone(value) } : clone(data); }
        async mutate(changes, options = {}) { const op = String(options.operationId || `doc-${++shared.counter}`); const revisions = {}; for (const change of changes) { const old = shared.docs.get(change.logicalKey); if (change.expectedRevision !== undefined && Number(change.expectedRevision) !== Number(old && old.revision || 0)) throw new AppDataError('CONFLICT', 'document revision'); const revision = Number(old && old.revision || 0) + 1; shared.docs.set(change.logicalKey, envelope(change.logicalKey, change.data, change.state, revision, op)); revisions[change.logicalKey] = revision; } return { committed: true, operationId: op, revisions, derived: { status: 'ready', pending: [] }, warnings: [] }; }
        async readEntity(store, recordId) { const row = shared.entities.get(store).get(String(recordId)); return row ? clone(row.data) : null; }
        async listEntities(store) { if (store !== 'practiceSummaries') throw new AppDataError('VALIDATION', 'details are not listable'); return Array.from(shared.entities.get(store).values()).map((row) => clone(row.data)); }
        async mutateEntities(operations, options = {}) { const op = String(options.operationId || `entity-${++shared.counter}`); for (const item of operations) { const rows = shared.entities.get(item.store); const old = rows.get(String(item.recordId)); rows.set(String(item.recordId), { recordId: String(item.recordId), revision: Number(old && old.revision || 0) + 1, operationId: op, data: clone(item.data) }); } return { committed: true, operationId: op, revisions: {}, derived: { status: 'ready', pending: [] }, warnings: [] }; }
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
