#!/usr/bin/env node

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const appDataSource = fs.readFileSync(path.join(root, 'js/data/v2/appData.js'), 'utf8');
const catalogSource = fs.readFileSync(path.join(root, 'js/data/v2/dataCatalog.js'), 'utf8');
const recordSource = fs.readFileSync(path.join(root, 'js/data/practiceRecordSource.js'), 'utf8');
const examSessionSource = fs.readFileSync(path.join(root, 'js/app/examSessionMixin.js'), 'utf8');
const clone = (value) => value === undefined ? undefined : structuredClone(value);
function stable(value) { if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`; if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`; return JSON.stringify(value); }
function checksum(value) { let hash = 0x811c9dc5; for (const char of stable(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 0x01000193); } return `fnv1a-${(hash >>> 0).toString(16)}`; }
function parseLegacyValue(value) { let parsed = clone(value); for (let depth = 0; depth < 3; depth += 1) { if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch { break; } } else if (parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, 'data') && (Object.prototype.hasOwnProperty.call(parsed, 'version') || Object.prototype.hasOwnProperty.call(parsed, 'compressed'))) parsed = parsed.data; else break; } return clone(parsed); }
class AppDataError extends Error { constructor(code, message) { super(message); this.code = code; } }
function sealSnapshot(snapshot) { snapshot.checksum = checksum({ envelopes: snapshot.envelopes, entities: snapshot.entities }); return snapshot; }
async function expectFailure(task, message) {
    let rejected = false;
    let error = null;
    try { await task(); } catch (caught) { rejected = true; error = caught; }
    assert.strictEqual(rejected, true, message);
    return error;
}
async function backupFixture(id) {
    const fixture = harness();
    await fixture.app.ready;
    await fixture.app.practice.completeAttempt({
        operationId: `${id}-seed`,
        record: { id: `${id}-record`, examId: 'reading-backup', type: 'reading', totalQuestions: 1, correctAnswers: 1, answers: { 1: 'A' } }
    });
    fixture.backup = await fixture.app.backups.create({ id });
    return fixture;
}
function storedBackup(shared, id) {
    const entries = shared.docs.get('backups.entries');
    const stored = entries && entries.data.find((item) => String(item && item.id) === String(id));
    assert(stored, `expected stored backup ${id}`);
    return stored;
}
function synchronizeStoredBackup(stored, mutate) {
    const data = clone(stored.data);
    mutate(data);
    sealSnapshot(data);
    stored.data = data;
    stored.size = JSON.stringify(data).length;
    stored.checksum = data.checksum;
}

function harness() {
    const catalogSandbox = { structuredClone }; catalogSandbox.globalThis = catalogSandbox;
    vm.runInContext(catalogSource, vm.createContext(catalogSandbox), { filename: 'dataCatalog.js' });
    const catalog = catalogSandbox.__AppDataV2Catalog;
    const shared = { docs: new Map(), entities: new Map([['practiceSummaries', new Map()], ['practiceDetails', new Map()], ['practiceAnnotations', new Map()]]), reads: [], lists: [], mutations: [], counter: 0, failEntityStore: null, lastInstallOptions: null, beforeInstall: null };
    const envelope = (key, data, state = 'present', revision = 1, operationId = 'seed') => ({ schemaVersion: 2, revision, operationId, updatedAt: new Date().toISOString(), state, data: state === 'cleared' ? null : clone(data), checksum: checksum(state === 'cleared' ? null : data) });
    class Kernel {
        async initialize() { this.state = 'ready'; this.backend = 'memory'; return this; }
        async read(key, options = {}) { const entry = catalog.get(key); const value = shared.docs.get(key) || null; const data = !value || value.state === 'cleared' ? entry.defaultValue() : value.data; return options.withMeta ? { data: clone(data), envelope: clone(value) } : clone(data); }
        async mutate(changes, options = {}) { const op = String(options.operationId || `doc-${++shared.counter}`); const revisions = {}; for (const change of changes) { const old = shared.docs.get(change.logicalKey); if (change.expectedRevision !== undefined && Number(change.expectedRevision) !== Number(old && old.revision || 0)) throw new AppDataError('CONFLICT', 'document revision'); const revision = Number(old && old.revision || 0) + 1; shared.docs.set(change.logicalKey, envelope(change.logicalKey, change.data, change.state, revision, op)); revisions[change.logicalKey] = revision; } return { committed: true, operationId: op, revisions, derived: { status: 'ready', pending: [] }, warnings: [] }; }
        async journalNoop(options = {}) { return { committed: true, operationId: options.operationId || `noop-${++shared.counter}`, revisions: {}, derived: { status: 'ready', pending: [] }, warnings: [] }; }
        async readEntity(store, recordId, options = {}) { shared.reads.push(store); const row = shared.entities.get(store).get(String(recordId)) || null; return options.withMeta ? clone(row) : row && clone(row.data); }
        async listEntities(store, options = {}) { if (store !== 'practiceSummaries') throw new AppDataError('VALIDATION', 'details are not listable'); shared.lists.push(store); const rows = Array.from(shared.entities.get(store).values()); return options.withMeta ? clone(rows) : rows.map((row) => clone(row.data)); }
        async readPracticeSnapshot(recordIds = null, options = {}) { const ids = recordIds === null ? null : new Set((Array.isArray(recordIds) ? recordIds : [recordIds]).map(String)); const stores = options.stores || ['practiceSummaries', 'practiceDetails', 'practiceAnnotations']; const result = {}; for (const store of stores) { if (ids) shared.reads.push(store); const rows = Array.from(shared.entities.get(store).values()).filter((row) => !ids || ids.has(String(row.recordId))); result[store] = options.withMeta ? clone(rows) : rows.map((row) => clone(row.data)); } return result; }
        async mutateEntities(operations, options = {}) { const op = String(options.operationId || `entity-${++shared.counter}`); const revisions = {}; const next = new Map(Array.from(shared.entities, ([store, rows]) => [store, new Map(rows)])); for (const item of operations) { if (shared.failEntityStore === item.store) throw new AppDataError('IO', `forced entity failure: ${item.store}`); const rows = next.get(item.store); if (item.type === 'clear') { rows.clear(); revisions[`${item.store}/*`] = 0; continue; } const old = rows.get(String(item.recordId)); if (item.expectedRevision !== undefined && item.expectedRevision !== null && Number(item.expectedRevision) !== Number(old && old.revision || 0)) throw new AppDataError('CONFLICT', 'entity revision'); if (item.type === 'delete') { rows.delete(String(item.recordId)); revisions[`${item.store}/${item.recordId}`] = Number(old && old.revision || 0) + 1; } else { const row = { recordId: String(item.recordId), revision: Number(old && old.revision || 0) + 1, operationId: op, updatedAt: new Date().toISOString(), data: clone(item.data), checksum: checksum(item.data) }; rows.set(row.recordId, row); revisions[`${item.store}/${item.recordId}`] = row.revision; } } shared.entities = next; shared.mutations.push(clone(operations)); return { committed: true, operationId: op, revisions, derived: { status: 'ready', pending: [] }, warnings: [] }; }
        async exportSnapshot(options = {}) {
            const selected = Array.isArray(options.logicalKeys) ? new Set(options.logicalKeys) : null;
            const selectedEntities = Array.isArray(options.entityStores) ? new Set(options.entityStores) : null;
            const envelopes = {};
            for (const entry of catalog.list()) {
                const key = entry.logicalKey;
                if (entry.export !== true || (selected && !selected.has(key))) continue;
                envelopes[key] = shared.docs.has(key)
                    ? clone(shared.docs.get(key))
                    : envelope(key, null, 'cleared', 1, 'snapshot-default');
            }
            const entities = {};
            for (const [store, rows] of shared.entities) {
                if (selectedEntities && !selectedEntities.has(store)) continue;
                entities[store] = Array.from(rows.values()).map(clone);
            }
            const snapshot = { format: 'ielts-atlas-data-v2', schemaVersion: 2, scope: selected ? 'partial' : 'full', envelopes, entities };
            snapshot.checksum = checksum({ envelopes, entities });
            return snapshot;
        }
        async installSnapshot(snapshot, options = {}) {
            if (snapshot.checksum !== checksum({ envelopes: snapshot.envelopes, entities: snapshot.entities })) throw new AppDataError('VALIDATION', 'snapshot checksum');
            if (typeof shared.beforeInstall === 'function') {
                const hook = shared.beforeInstall;
                shared.beforeInstall = null;
                await hook();
            }
            const token = options.expectedRevisionToken || {};
            for (const [key, expected] of Object.entries(token.documents || {})) {
                const actual = shared.docs.get(key) || null;
                if (Number(actual && actual.revision || 0) !== Number(expected || 0)) {
                    throw new AppDataError('CONFLICT', `document revision: ${key}`);
                }
            }
            for (const [store, expectedRows] of Object.entries(token.entities || {})) {
                const actualRows = shared.entities.get(store) || new Map();
                const ids = new Set([...actualRows.keys(), ...Object.keys(expectedRows || {})]);
                for (const id of ids) {
                    const actual = actualRows.get(id) || null;
                    const expected = expectedRows[id] || 0;
                    if (Number(actual && actual.revision || 0) !== Number(expected || 0)) {
                        throw new AppDataError('CONFLICT', `entity revision: ${store}/${id}`);
                    }
                }
            }
            const nextDocs = new Map(shared.docs);
            const nextEntities = new Map(Array.from(shared.entities, ([store, rows]) => [store, new Map(rows)]));
            for (const [key, value] of Object.entries(snapshot.envelopes)) nextDocs.set(key, clone(value));
            for (const [store, rows] of Object.entries(snapshot.entities)) nextEntities.set(store, new Map(rows.map((row) => [String(row.recordId), clone(row)])));
            shared.docs = nextDocs; shared.entities = nextEntities; shared.lastInstallOptions = clone(options);
            return { committed: true, operationId: options.operationId || `install-${++shared.counter}`, revisions: {}, derived: { status: 'ready', pending: [] }, warnings: [] };
        }
        onCommitted() { return () => {}; }
        status() { return { state: this.state, backend: this.backend, failure: null }; }
    }
    const internals = { DataKernel: Kernel, AppDataError, catalog, clone, checksum, parseLegacyValue, randomId: (prefix) => `${prefix}-${++shared.counter}`, nowIso: () => new Date().toISOString(), makeEnvelope: (entry, data, options = {}) => envelope(entry.logicalKey, data, options.state, options.revision, options.operationId), validateEnvelope: (entry, value) => Boolean(value && value.schemaVersion === 2 && value.checksum === checksum(value.data)) };
    const sandbox = { console, Date, JSON, Math, Map, Set, Promise, structuredClone, __AppDataV2Internals: internals, sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} } }; sandbox.window = sandbox; sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox); vm.runInContext(recordSource, context, { filename: 'practiceRecordSource.js' }); vm.runInContext(appDataSource, context, { filename: 'appData.js' }); return { app: sandbox.AppData, shared, envelope, sandbox, context };
}

async function testVocabPhoneticMutationProtection() {
    const fixture = harness();
    await fixture.app.ready;
    await fixture.app.vocab.saveWords([{
        id: 'phonetic-merge-word',
        word: 'Alpha',
        phonetic: 'legacy-value',
        meaning: 'stored meaning'
    }]);

    const mergeReceipt = await fixture.app.vocab.mergeListWords({
        listId: 'default',
        words: [{ word: ' alpha ', phonetic: '  /\u02c8\u00e6lf\u0259  ' }]
    });
    assert.strictEqual(mergeReceipt.addedCount, 0);
    assert.strictEqual(mergeReceipt.updatedCount, 1);
    assert.strictEqual(
        (await fixture.app.vocab.listWords())[0].phonetic,
        '\u02c8\u00e6lf\u0259',
        'a non-empty incoming phonetic must be trimmed and update the existing word'
    );

    await fixture.app.vocab.mergeListWords({
        listId: 'default',
        words: [
            { word: 'ALPHA', phonetic: '   ' },
            { word: 'alpha' }
        ]
    });
    assert.strictEqual(
        (await fixture.app.vocab.listWords())[0].phonetic,
        '\u02c8\u00e6lf\u0259',
        'blank or missing merge values must not erase a stored phonetic'
    );

    const patchReceipt = await fixture.app.vocab.patchWord({
        listId: 'default',
        wordId: 'phonetic-merge-word',
        patch: { phonetic: ' \t\r\n ', meaning: 'patched meaning' }
    });
    assert.strictEqual(patchReceipt.word.phonetic, '\u02c8\u00e6lf\u0259', 'patchWord must ignore a blank phonetic');
    assert.strictEqual(patchReceipt.word.meaning, 'patched meaning', 'patchWord must still apply sibling fields');

    await fixture.app.vocab.saveCollection('phonetic-upsert-list', {
        id: 'phonetic-upsert-list',
        rawCollectionField: { retain: true },
        words: [{
            id: 'phonetic-upsert-word',
            word: 'Bravo',
            phonetic: 'stored-upsert-value',
            note: 'before upsert'
        }]
    });
    const upsertReceipt = await fixture.app.vocab.upsertCollectionWord('phonetic-upsert-list', {
        word: 'Bravo',
        phonetic: '   ',
        note: 'after upsert'
    });
    assert.strictEqual(upsertReceipt.word.phonetic, 'stored-upsert-value', 'upsertCollectionWord must ignore a blank phonetic');
    assert.strictEqual(upsertReceipt.word.note, 'after upsert', 'upsertCollectionWord must still apply sibling fields');
    assert.deepStrictEqual(
        (await fixture.app.vocab.readList('phonetic-upsert-list')).rawCollectionField,
        { retain: true },
        'upserting one word must preserve unknown collection fields'
    );

    await fixture.app.vocab.saveCollection('legacy-array-list', [{
        id: 'legacy-array-word',
        word: 'Charlie',
        phonetic: 'stored-array-value',
        meaning: 'before patch'
    }]);
    const legacyPatchReceipt = await fixture.app.vocab.patchWord({
        listId: 'legacy-array-list',
        wordId: 'legacy-array-word',
        patch: { phonetic: ' / ', meaning: 'after patch' }
    });
    assert.strictEqual(legacyPatchReceipt.word.phonetic, 'stored-array-value');
    assert.strictEqual(legacyPatchReceipt.word.meaning, 'after patch');
    const upgradedLegacyList = await fixture.app.vocab.readList('legacy-array-list');
    assert.strictEqual(upgradedLegacyList.words[0].phonetic, 'stored-array-value');
    assert.strictEqual(upgradedLegacyList.words[0].meaning, 'after patch');
}

async function testAtomicVocabPhoneticBackfill() {
    const fixture = harness();
    await fixture.app.ready;
    const words = [
        {
            id: 'alpha-first',
            word: 'Alpha',
            phonetic: '',
            note: 'first duplicate',
            status: 'review',
            repetitions: 4,
            interval: 12,
            easeFactor: 2.35,
            nextReview: '2025-02-01T00:00:00.000Z',
            lastReviewed: '2025-01-20T00:00:00.000Z',
            createdAt: '2024-12-01T00:00:00.000Z',
            updatedAt: '2025-01-20T00:00:00.000Z',
            rawWordField: { sourceRow: 17, untouched: ['one', 'two'] }
        },
        {
            id: 'explicit-beta',
            word: 'Beta',
            phonetic: 'custom-explicit-value',
            status: 'learning',
            repetitions: 2,
            nextReview: '2025-01-25T00:00:00.000Z',
            createdAt: '2024-12-02T00:00:00.000Z',
            updatedAt: '2025-01-18T00:00:00.000Z'
        },
        {
            id: 'alpha-second',
            word: ' alpha ',
            note: 'second duplicate',
            status: 'new',
            repetitions: 0,
            nextReview: null,
            createdAt: '2024-12-03T00:00:00.000Z',
            updatedAt: '2024-12-03T00:00:00.000Z',
            rawWordField: { sourceRow: 29 }
        },
        {
            id: 'blank-gamma',
            word: 'Gamma',
            phonetic: '   ',
            status: 'review',
            repetitions: 7,
            nextReview: '2025-03-01T00:00:00.000Z',
            createdAt: '2024-12-04T00:00:00.000Z',
            updatedAt: '2025-01-21T00:00:00.000Z'
        },
        'legacy-string-word'
    ];
    await fixture.app.vocab.saveWords(words);
    const revisionBefore = fixture.shared.docs.get('vocab.words').revision;
    const entries = [
        { word: ' ALPHA ', phonetic: '  /\u02c8\u00e6lf\u0259/  ' },
        { word: 'alpha', phonetic: 'must-not-win-over-the-first-candidate' },
        { word: 'beta', phonetic: 'must-not-overwrite-explicit' },
        { word: 'Gamma', phonetic: '  \u02c8\u0261\u00e6m\u0259  ' },
        { word: 'not-in-the-list', phonetic: 'missing-candidate' },
        { word: 'blank-candidate', phonetic: '   ' }
    ];

    const receipt = await fixture.app.vocab.backfillListWordPhonetics({
        listId: 'default',
        entries
    }, { operationId: 'phonetic-backfill-atomic' });
    assert.strictEqual(receipt.committed, true);
    assert.strictEqual(receipt.updatedCount, 3, 'every stored duplicate with a missing phonetic must be filled');
    assert.deepStrictEqual(Object.keys(receipt.revisions), ['vocab.words'], 'the backfill must commit as one list-document mutation');
    assert.strictEqual(
        fixture.shared.docs.get('vocab.words').revision,
        revisionBefore + 1,
        'the whole backfill must advance the list document exactly once'
    );
    assert.strictEqual(fixture.shared.docs.get('vocab.words').operationId, 'phonetic-backfill-atomic');

    const expected = clone(words);
    expected[0].phonetic = '\u02c8\u00e6lf\u0259';
    expected[2].phonetic = '\u02c8\u00e6lf\u0259';
    expected[3].phonetic = '\u02c8\u0261\u00e6m\u0259';
    const stored = await fixture.app.vocab.listWords();
    assert.deepStrictEqual(
        stored,
        expected,
        'backfill must preserve raw fields, progress, timestamps, explicit values, and word order'
    );
    assert.deepStrictEqual(stored.slice(0, 4).map((word) => word.id), ['alpha-first', 'explicit-beta', 'alpha-second', 'blank-gamma']);
    assert.strictEqual(stored[4], 'legacy-string-word', 'backfill must retain non-object legacy entries byte-for-byte');
    assert.strictEqual(stored.some((word) => word.word === 'not-in-the-list'), false, 'candidate-only words must not be added');
    assert.strictEqual(stored[1].phonetic, 'custom-explicit-value', 'an explicit stored phonetic must win over a candidate');

    const envelopeAfterFirstRun = clone(fixture.shared.docs.get('vocab.words'));
    const noOpReceipt = await fixture.app.vocab.backfillListWordPhonetics({
        listId: 'default',
        entries
    }, { operationId: 'phonetic-backfill-idempotent' });
    assert.strictEqual(noOpReceipt.committed, false);
    assert.strictEqual(noOpReceipt.updatedCount, 0);
    assert.deepStrictEqual(
        fixture.shared.docs.get('vocab.words'),
        envelopeAfterFirstRun,
        'an idempotent backfill must not rewrite the list envelope'
    );
    assert.deepStrictEqual(noOpReceipt.words, expected, 'the no-op receipt must expose the unchanged stored order and values');
}

async function testReplaceProgressPhoneticProtection() {
    const fixture = harness();
    await fixture.app.ready;
    const storedWords = [
        { id: 'stored-alpha', word: 'Alpha', phonetic: 'stored-alpha-value' },
        { id: 'stored-bravo', word: 'Bravo', phonetic: 'stored-bravo-value' },
        { id: 'stored-charlie', word: 'Charlie', phonetic: 'stored-charlie-value' },
        { id: 'stored-delta', word: 'Delta', phonetic: 'stored-delta-value' }
    ];
    const incomingWords = [
        { id: 'incoming-alpha', word: ' alpha ', repetitions: 1 },
        { id: 'incoming-bravo', word: 'BRAVO', phonetic: ' \t ', repetitions: 2 },
        { id: 'incoming-charlie', word: ' charlie ', phonetic: '  /////  ', repetitions: 3 },
        { id: 'incoming-delta', word: 'Delta', phonetic: '  /incoming-delta-value/  ', repetitions: 4 }
    ];
    const expectedPhonetics = [
        'stored-alpha-value',
        'stored-bravo-value',
        'stored-charlie-value',
        'incoming-delta-value'
    ];

    await fixture.app.vocab.saveWords(storedWords);
    const defaultReceipt = await fixture.app.vocab.replaceProgress({
        listId: 'default',
        words: incomingWords,
        config: { dailyGoal: 12 }
    }, { operationId: 'replace-progress-default-phonetics' });
    assert.deepStrictEqual(
        defaultReceipt.words.map((word) => word.phonetic),
        expectedPhonetics,
        'default progress restore must preserve explicit phonetics for missing, blank, and pure-slash inputs while normalizing a real update'
    );
    assert.deepStrictEqual(
        (await fixture.app.vocab.listWords()).map((word) => word.phonetic),
        expectedPhonetics,
        'default progress restore must persist the protected phonetics'
    );

    await fixture.app.vocab.saveCollection('replace-progress-collection', {
        id: 'replace-progress-collection',
        rawCollectionField: { retained: true },
        words: storedWords
    });
    const collectionReceipt = await fixture.app.vocab.replaceProgress({
        listId: 'replace-progress-collection',
        words: incomingWords,
        config: { dailyGoal: 8 }
    }, { operationId: 'replace-progress-collection-phonetics' });
    assert.deepStrictEqual(
        collectionReceipt.words.map((word) => word.phonetic),
        expectedPhonetics,
        'collection progress restore must apply the same phonetic protection rule'
    );
    const storedCollection = await fixture.app.vocab.readList('replace-progress-collection');
    assert.deepStrictEqual(storedCollection.words.map((word) => word.phonetic), expectedPhonetics);
    assert.deepStrictEqual(storedCollection.rawCollectionField, { retained: true });
}

async function testV2MergeImportPhoneticProtection() {
    const fixture = harness();
    await fixture.app.ready;
    const storedDefaultWords = [
        { id: 'default-missing', word: 'Alpha', phonetic: 'stored-default-alpha', meaning: 'stored alpha' },
        { id: 'default-blank', word: 'Bravo', phonetic: 'stored-default-bravo', meaning: 'stored bravo' },
        { id: 'default-slashes', word: 'Charlie', phonetic: 'stored-default-charlie', meaning: 'stored charlie' },
        { id: 'default-update', word: 'Delta', phonetic: 'stored-default-delta', meaning: 'stored delta' }
    ];
    const incomingDefaultWords = [
        { id: 'default-missing', word: 'Alpha', meaning: 'imported alpha', importMarker: 'missing' },
        { id: 'default-blank', word: 'Bravo', phonetic: ' \t ', meaning: 'imported bravo', importMarker: 'blank' },
        { id: 'default-slashes', word: 'Charlie', phonetic: '  /////  ', meaning: 'imported charlie', importMarker: 'slashes' },
        { id: 'default-update', word: 'Delta', phonetic: '  /imported-default-delta/  ', meaning: 'imported delta', importMarker: 'update' }
    ];
    const storedNamedWords = [
        { id: 'named-missing', word: 'Echo', phonetic: 'stored-named-echo', meaning: 'stored echo' },
        { id: 'named-blank', word: 'Foxtrot', phonetic: 'stored-named-foxtrot', meaning: 'stored foxtrot' },
        { id: 'named-slashes', word: 'Golf', phonetic: 'stored-named-golf', meaning: 'stored golf' },
        { id: 'named-update', word: 'Hotel', phonetic: 'stored-named-hotel', meaning: 'stored hotel' }
    ];
    const incomingNamedWords = [
        { id: 'named-missing', word: 'Echo', meaning: 'imported echo', importMarker: 'missing' },
        { id: 'named-blank', word: 'Foxtrot', phonetic: '   ', meaning: 'imported foxtrot', importMarker: 'blank' },
        { id: 'named-slashes', word: 'Golf', phonetic: '  ////  ', meaning: 'imported golf', importMarker: 'slashes' },
        { id: 'named-update', word: 'Hotel', phonetic: '  /imported-named-hotel/  ', meaning: 'imported hotel', importMarker: 'update' }
    ];

    await fixture.app.vocab.saveWords(storedDefaultWords);
    await fixture.app.vocab.saveCollections({
        'phonetic-import-list': {
            id: 'phonetic-import-list',
            name: 'Stored list name',
            words: storedNamedWords
        },
        'unrelated-list': {
            id: 'unrelated-list',
            name: 'Must survive document merge',
            words: [{ id: 'untouched', word: 'Untouched', phonetic: 'untouched-value' }]
        }
    });

    const snapshot = {
        format: 'ielts-atlas-data-v2',
        schemaVersion: 2,
        scope: 'partial',
        envelopes: {
            'vocab.words': fixture.envelope('vocab.words', incomingDefaultWords),
            'vocab.lists': fixture.envelope('vocab.lists', {
                'phonetic-import-list': {
                    id: 'phonetic-import-list',
                    name: 'Imported list name',
                    importMarker: 'updated-list-fields',
                    words: incomingNamedWords
                }
            })
        },
        entities: {}
    };
    snapshot.checksum = checksum({ envelopes: snapshot.envelopes, entities: snapshot.entities });

    const plan = await fixture.app.backups.previewImport(snapshot, { practiceMode: 'merge' });
    assert.deepStrictEqual(new Set(plan.keys), new Set(['vocab.words', 'vocab.lists']));
    assert.strictEqual(plan.destructive, false);
    await fixture.app.backups.commitImport(plan.id);

    const defaultWords = await fixture.app.vocab.listWords();
    assert.deepStrictEqual(
        defaultWords.map((word) => word.phonetic),
        ['stored-default-alpha', 'stored-default-bravo', 'stored-default-charlie', 'imported-default-delta'],
        'v2 merge import must protect stored default-list phonetics from missing, blank, and pure-slash values'
    );
    assert.deepStrictEqual(
        defaultWords.map((word) => [word.meaning, word.importMarker]),
        incomingDefaultWords.map((word) => [word.meaning, word.importMarker]),
        'default-list fields other than the protected phonetic must retain merge-by-id semantics'
    );

    const collections = await fixture.app.vocab.listCollections();
    const namedList = collections['phonetic-import-list'];
    assert.strictEqual(namedList.name, 'Imported list name');
    assert.strictEqual(namedList.importMarker, 'updated-list-fields');
    assert.deepStrictEqual(
        namedList.words.map((word) => word.phonetic),
        ['stored-named-echo', 'stored-named-foxtrot', 'stored-named-golf', 'imported-named-hotel'],
        'v2 merge import must apply the same phonetic protection inside named lists'
    );
    assert.deepStrictEqual(
        namedList.words.map((word) => [word.meaning, word.importMarker]),
        incomingNamedWords.map((word) => [word.meaning, word.importMarker]),
        'named-list incoming fields must still replace their prior values'
    );
    assert.strictEqual(collections['unrelated-list'].words[0].phonetic, 'untouched-value');
}

async function testLegacyReplayProjectionContract() {
    const fixture = harness();
    await fixture.app.ready;
    const completed = await fixture.app.practice.completeAttempt({
        operationId: 'legacy-replay-projection',
        record: {
            id: 'legacy-replay-projection',
            examId: 'legacy-reading-score',
            type: 'reading',
            scoreInfo: { score: 8, total: 10, accuracy: 67, timeSpent: 1200 }
        }
    });
    const projected = completed.record;
    assert.strictEqual(projected.correctAnswers, 0, 'AppData documents the generated zero score fallback');
    assert.strictEqual(
        projected.duration,
        1200,
        'AppData must promote a legacy duration alias when the canonical root field was absent'
    );
    assert.strictEqual(projected.scoreInfo.score, 8);
    assert.strictEqual(projected.scoreInfo.accuracy, 67);
    assert.strictEqual(projected.scoreInfo.timeSpent, 1200);

    const explicitZeroDurationCompleted = await fixture.app.practice.completeAttempt({
        operationId: 'explicit-zero-duration-projection',
        record: {
            id: 'explicit-zero-duration-projection',
            examId: 'explicit-zero-duration',
            type: 'reading',
            duration: 0,
            scoreInfo: { timeSpent: 1200 }
        }
    });
    assert.strictEqual(
        explicitZeroDurationCompleted.record.duration,
        0,
        'AppData must preserve an explicit canonical zero over a legacy duration alias'
    );
    assert.strictEqual(explicitZeroDurationCompleted.record.scoreInfo.timeSpent, 1200);

    const invalidDurationAliasCompleted = await fixture.app.practice.completeAttempt({
        operationId: 'invalid-duration-alias-projection',
        record: {
            id: 'invalid-duration-alias-projection',
            examId: 'invalid-duration-alias',
            type: 'reading',
            duration_seconds: 'bad',
            scoreInfo: { duration: 1200 }
        }
    });
    assert.strictEqual(
        invalidDurationAliasCompleted.record.duration,
        1200,
        'AppData must skip an invalid legacy duration alias before selecting a later valid alias'
    );

    const blankDurationAliasCompleted = await fixture.app.practice.completeAttempt({
        operationId: 'blank-duration-alias-projection',
        record: {
            id: 'blank-duration-alias-projection',
            examId: 'blank-duration-alias',
            type: 'reading',
            duration_seconds: '   ',
            scoreInfo: { duration: 1200 }
        }
    });
    assert.strictEqual(
        blankDurationAliasCompleted.record.duration,
        1200,
        'AppData must treat a whitespace-only duration alias as absent'
    );
    assert.strictEqual(
        (await fixture.app.practice.get('blank-duration-alias-projection')).duration,
        1200,
        'the normalized duration must survive a full AppData read'
    );

    const negativeDurationAliasCompleted = await fixture.app.practice.completeAttempt({
        operationId: 'negative-duration-alias-projection',
        record: {
            id: 'negative-duration-alias-projection',
            examId: 'negative-duration-alias',
            type: 'reading',
            scoreInfo: { timeSpent: -5 }
        }
    });
    assert.strictEqual(
        negativeDurationAliasCompleted.record.duration,
        0,
        'AppData must not persist a negative legacy duration alias as the canonical summary duration'
    );
    await fixture.app.practice.getStats();

    const suiteCompleted = await fixture.app.practice.finalizeSuite({
        operationId: 'legacy-suite-replay-projection',
        record: {
            id: 'legacy-suite-replay-projection',
            type: 'reading-suite',
            suiteEntries: [
                {
                    examId: 'legacy-reading-part-one',
                    scoreInfo: { correct: 2, total: 3, accuracy: 67 },
                    rawData: {
                        completedAt: '2026-08-15T10:45:00.000Z',
                        duration_seconds: 900
                    }
                },
                {
                    examId: 'legacy-reading-part-two',
                    scoreInfo: { correct: 1, total: 1, accuracy: 1 }
                }
            ]
        }
    });
    const projectedSuiteEntry = suiteCompleted.record.suiteEntries[0];
    assert.strictEqual(projectedSuiteEntry.completedAt, '2026-08-15T10:45:00.000Z');
    assert.strictEqual(projectedSuiteEntry.duration_seconds, 900);
    assert.strictEqual(projectedSuiteEntry.rawData, undefined, 'rawData must still be stripped after replay timing is promoted');

    const oneEntrySuiteCompleted = await fixture.app.practice.finalizeSuite({
        operationId: 'one-entry-suite-replay-projection',
        record: {
            id: 'one-entry-suite-replay-projection',
            type: 'reading-suite',
            suiteEntries: [{
                examId: 'one-entry-reading-part',
                scoreInfo: { correct: 8, total: 10, accuracy: 0.8 }
            }]
        }
    });
    assert.strictEqual(oneEntrySuiteCompleted.record.correctAnswers, 0);
    assert.strictEqual(oneEntrySuiteCompleted.record.totalQuestions, 0);

    const scorelessOneEntrySuiteCompleted = await fixture.app.practice.finalizeSuite({
        operationId: 'scoreless-one-entry-suite-projection',
        record: {
            id: 'scoreless-one-entry-suite-projection',
            type: 'reading-suite',
            scoreInfo: { correct: 8, total: 10, accuracy: 0.8 },
            suiteEntries: [{ examId: 'scoreless-one-entry-reading-part' }]
        }
    });
    assert.strictEqual(scorelessOneEntrySuiteCompleted.record.correctAnswers, 8);
    assert.strictEqual(scorelessOneEntrySuiteCompleted.record.totalQuestions, 10);

    const blankScoreOneEntrySuiteCompleted = await fixture.app.practice.finalizeSuite({
        operationId: 'blank-score-one-entry-suite-projection',
        record: {
            id: 'blank-score-one-entry-suite-projection',
            type: 'reading-suite',
            scoreInfo: { correct: 8, total: 10, accuracy: 0.8 },
            suiteEntries: [{
                examId: 'blank-score-one-entry-reading-part',
                correct: '   '
            }]
        }
    });

    const blankDurationOneEntrySuiteCompleted = await fixture.app.practice.finalizeSuite({
        operationId: 'blank-duration-one-entry-suite-projection',
        record: {
            id: 'blank-duration-one-entry-suite-projection',
            type: 'reading-suite',
            duration: 1200,
            suiteEntries: [{
                examId: 'blank-duration-one-entry-reading-part',
                duration_seconds: '   '
            }]
        }
    });

    const canonicalCounterSuiteCompleted = await fixture.app.practice.finalizeSuite({
        operationId: 'canonical-counter-suite-projection',
        record: {
            id: 'canonical-counter-suite-projection',
            type: 'reading-suite',
            suiteEntries: [{
                examId: 'canonical-counter-reading-part',
                correct: 2,
                total: 3,
                correctAnswers: 8,
                totalQuestions: 10,
                scoreInfo: { correct: 8, total: 10, accuracy: 0.8 }
            }]
        }
    });
    assert.strictEqual(canonicalCounterSuiteCompleted.record.suiteEntrySummaries[0].correctAnswers, 8);
    assert.strictEqual(canonicalCounterSuiteCompleted.record.suiteEntrySummaries[0].totalQuestions, 10);

    const nestedCounterSuiteCompleted = await fixture.app.practice.finalizeSuite({
        operationId: 'nested-counter-suite-projection',
        record: {
            id: 'nested-counter-suite-projection',
            type: 'reading-suite',
            suiteEntries: [{
                examId: 'nested-counter-reading-part',
                correct: 2,
                total: 3,
                scoreInfo: { correct: 8, total: 10, accuracy: 0.8 }
            }]
        }
    });

    vm.runInContext(examSessionSource, fixture.context, { filename: 'examSessionMixin.js' });
    const replayMixin = Object.assign({}, fixture.sandbox.ExamSystemAppMixins.examSession);
    const replay = replayMixin._buildReviewReplayEntriesFromRecord(projected)[0];
    assert.strictEqual(replay.scoreInfo.correct, 8, 'nested legacy score must outrank AppData generated zero');
    assert.strictEqual(replay.scoreInfo.total, 10);
    assert.strictEqual(replay.scoreInfo.accuracy, 0.67, 'percent-form accuracy must normalize to a ratio');
    assert.strictEqual(replay.scoreInfo.percentage, 67);
    assert.strictEqual(replay.duration, 1200, 'AppData-promoted legacy timeSpent must survive replay');

    const explicitZeroDurationReplay = replayMixin._buildReviewReplayEntriesFromRecord(
        explicitZeroDurationCompleted.record
    )[0];
    assert.strictEqual(
        explicitZeroDurationReplay.duration,
        0,
        'an explicit canonical zero must outrank a stale nested duration alias after projection'
    );

    const invalidDurationAliasReplay = replayMixin._buildReviewReplayEntriesFromRecord(
        invalidDurationAliasCompleted.record
    )[0];
    assert.strictEqual(invalidDurationAliasReplay.duration, 1200);

    const blankDurationAliasReplay = replayMixin._buildReviewReplayEntriesFromRecord(
        blankDurationAliasCompleted.record
    )[0];
    assert.strictEqual(blankDurationAliasReplay.duration, 1200);

    const negativeDurationAliasReplay = replayMixin._buildReviewReplayEntriesFromRecord(
        negativeDurationAliasCompleted.record
    )[0];
    assert.strictEqual(negativeDurationAliasReplay.duration, 0);

    const oneEntrySuiteReplay = replayMixin._buildReviewReplayEntriesFromRecord(
        oneEntrySuiteCompleted.record
    )[0];
    assert.strictEqual(
        oneEntrySuiteReplay.scoreInfo.correct,
        8,
        'a one-entry suite child score must outrank projected parent zeroes'
    );
    assert.strictEqual(oneEntrySuiteReplay.scoreInfo.total, 10);
    assert.strictEqual(oneEntrySuiteReplay.scoreInfo.accuracy, 0.8);

    const scorelessOneEntrySuiteReplay = replayMixin._buildReviewReplayEntriesFromRecord(
        scorelessOneEntrySuiteCompleted.record
    )[0];
    assert.strictEqual(
        scorelessOneEntrySuiteReplay.scoreInfo.correct,
        8,
        'a scoreless child in a one-entry suite must fall back to the equivalent parent score'
    );
    assert.strictEqual(scorelessOneEntrySuiteReplay.scoreInfo.total, 10);
    assert.strictEqual(scorelessOneEntrySuiteReplay.scoreInfo.accuracy, 0.8);

    const blankScoreOneEntrySuiteReplay = replayMixin._buildReviewReplayEntriesFromRecord(
        blankScoreOneEntrySuiteCompleted.record
    )[0];
    assert.strictEqual(
        blankScoreOneEntrySuiteReplay.scoreInfo.correct,
        8,
        'a whitespace-only child score alias must not block the one-entry parent fallback'
    );
    assert.strictEqual(blankScoreOneEntrySuiteReplay.scoreInfo.total, 10);
    assert.strictEqual(blankScoreOneEntrySuiteReplay.scoreInfo.accuracy, 0.8);

    const blankDurationOneEntrySuiteReplay = replayMixin._buildReviewReplayEntriesFromRecord(
        blankDurationOneEntrySuiteCompleted.record
    )[0];
    assert.strictEqual(
        blankDurationOneEntrySuiteReplay.duration,
        1200,
        'a whitespace-only child duration must fall back to the parent duration provenance'
    );

    const canonicalCounterSuiteReplay = replayMixin._buildReviewReplayEntriesFromRecord(
        canonicalCounterSuiteCompleted.record
    )[0];
    assert.strictEqual(
        canonicalCounterSuiteReplay.scoreInfo.correct,
        8,
        'canonical root correctAnswers must outrank the stale root correct alias'
    );
    assert.strictEqual(canonicalCounterSuiteReplay.scoreInfo.total, 10);
    assert.strictEqual(canonicalCounterSuiteReplay.scoreInfo.accuracy, 0.8);

    const nestedCounterSuiteReplay = replayMixin._buildReviewReplayEntriesFromRecord(
        nestedCounterSuiteCompleted.record
    )[0];
    assert.strictEqual(
        nestedCounterSuiteReplay.scoreInfo.correct,
        8,
        'nested scoreInfo.correct must outrank a root legacy correct alias when no canonical counter exists'
    );
    assert.strictEqual(nestedCounterSuiteReplay.scoreInfo.total, 10);
    assert.strictEqual(nestedCounterSuiteReplay.scoreInfo.accuracy, 0.8);

    const currentProvenanceCounterReplay = replayMixin._buildReviewReplayEntriesFromRecord({
        examId: 'current-provenance-counter',
        correct: 8,
        total: 10,
        scoreInfo: { correct: 8, total: 10, accuracy: 0.8, percentage: 80 },
        realData: { correctAnswers: 4, totalQuestions: 5, accuracy: 0.4, percentage: 40 },
        rawData: { correctAnswers: 2, totalQuestions: 3, accuracy: 0.2, percentage: 20 }
    })[0];
    assert.strictEqual(
        currentProvenanceCounterReplay.scoreInfo.correct,
        8,
        'current entry score provenance must outrank stale canonical counters in realData and rawData'
    );
    assert.strictEqual(currentProvenanceCounterReplay.scoreInfo.total, 10);
    assert.strictEqual(currentProvenanceCounterReplay.scoreInfo.accuracy, 0.8);
    assert.strictEqual(
        currentProvenanceCounterReplay.scoreInfo.percentage,
        80,
        'current entry metrics must outrank stale accuracy and percentage in realData and rawData'
    );

    const realDataProvenanceCounterReplay = replayMixin._buildReviewReplayEntriesFromRecord({
        examId: 'real-data-provenance-counter',
        realData: {
            correct: 8,
            total: 10,
            scoreInfo: { correct: 8, total: 10, accuracy: 0.8, percentage: 80 }
        },
        rawData: { correctAnswers: 2, totalQuestions: 3, accuracy: 0.2, percentage: 20 }
    })[0];
    assert.strictEqual(
        realDataProvenanceCounterReplay.scoreInfo.correct,
        8,
        'realData score provenance must outrank stale canonical counters in rawData'
    );
    assert.strictEqual(realDataProvenanceCounterReplay.scoreInfo.total, 10);
    assert.strictEqual(realDataProvenanceCounterReplay.scoreInfo.accuracy, 0.8);
    assert.strictEqual(
        realDataProvenanceCounterReplay.scoreInfo.percentage,
        80,
        'realData metrics must outrank stale accuracy and percentage in rawData'
    );

    const canonicalMetricReplay = replayMixin._buildReviewReplayEntriesFromRecord({
        examId: 'canonical-root-metric',
        accuracy: 0.9,
        percentage: 90,
        scoreInfo: { correct: 9, total: 10, accuracy: 0.8, percentage: 80 }
    })[0];
    assert.strictEqual(
        canonicalMetricReplay.scoreInfo.accuracy,
        0.9,
        'canonical root accuracy must outrank nested scoreInfo within the same provenance'
    );
    assert.strictEqual(canonicalMetricReplay.scoreInfo.percentage, 90);

    const authoritativeZeroReplay = replayMixin._buildReviewReplayEntriesFromRecord({
        examId: 'authoritative-zero-score',
        scoreInfo: { correct: 0, total: 10 },
        realData: { scoreInfo: { correct: 8, total: 10 } }
    })[0];
    assert.strictEqual(
        authoritativeZeroReplay.scoreInfo.correct,
        0,
        'an authoritative zero must retain score-info source precedence over stale aliases'
    );
    assert.strictEqual(authoritativeZeroReplay.scoreInfo.total, 10);

    const authoritativeZeroAliasReplay = replayMixin._buildReviewReplayEntriesFromRecord({
        examId: 'authoritative-zero-score-alias',
        correctAnswers: 0,
        scoreInfo: { correct: 0, score: 8, total: 10 }
    })[0];
    assert.strictEqual(
        authoritativeZeroAliasReplay.scoreInfo.correct,
        0,
        'canonical scoreInfo keys must outrank a stale score alias in the same source'
    );

    const suiteReplay = replayMixin._buildReviewReplayEntriesFromRecord(suiteCompleted.record);
    assert.strictEqual(suiteReplay[0].scoreInfo.accuracy, 0.67);
    assert.strictEqual(suiteReplay[0].duration, 900);
    assert.strictEqual(suiteReplay[0].endTime, '2026-08-15T10:45:00.000Z');

    const zeroDurationSuiteReplay = replayMixin._buildReviewReplayEntriesFromRecord({
        duration: 3600,
        suiteEntries: [
            { examId: 'zero-duration-child', duration: 0 },
            { examId: 'positive-duration-child', duration: 120 }
        ]
    });
    assert.strictEqual(
        zeroDurationSuiteReplay[0].duration,
        0,
        'an explicit child zero duration must outrank the parent suite aggregate'
    );
    assert.strictEqual(zeroDurationSuiteReplay[1].duration, 120);
    assert.strictEqual(
        zeroDurationSuiteReplay[0].scoreInfo.correct,
        0,
        'a scoreless child in a multi-entry suite must not inherit the parent aggregate score'
    );
    assert.strictEqual(zeroDurationSuiteReplay[0].scoreInfo.total, 0);

    // Field-aware fallback: child has only counters, should fall back to parent metrics
    const fieldAwareFallbackMetricsReplay = replayMixin._buildReviewReplayEntriesFromRecord({
        examId: 'field-aware-parent',
        correctAnswers: 8,
        totalQuestions: 10,
        accuracy: 0.8,
        percentage: 80,
        suiteEntries: [{
            examId: 'field-aware-child-counter-only',
            scoreInfo: { correctAnswers: 8 }  // Child has counter but no total or metrics
        }]
    });
    assert.strictEqual(
        fieldAwareFallbackMetricsReplay[0].scoreInfo.correct,
        8,
        'one-entry suite child counter must be used when present'
    );
    assert.strictEqual(
        fieldAwareFallbackMetricsReplay[0].scoreInfo.total,
        10,
        'one-entry suite must fall back to parent total when child has only correct'
    );
    assert.strictEqual(
        fieldAwareFallbackMetricsReplay[0].scoreInfo.percentage,
        80,
        'one-entry suite must fall back to parent percentage when child has only counters'
    );
    assert.strictEqual(
        fieldAwareFallbackMetricsReplay[0].scoreInfo.accuracy,
        0.8,
        'one-entry suite must fall back to parent accuracy when child has only counters'
    );

    // Field-aware fallback: child has only metrics, should fall back to parent counters
    const fieldAwareFallbackCountersReplay = replayMixin._buildReviewReplayEntriesFromRecord({
        examId: 'field-aware-parent-2',
        correctAnswers: 8,
        totalQuestions: 10,
        accuracy: 0.8,
        percentage: 80,
        suiteEntries: [{
            examId: 'field-aware-child-metric-only',
            scoreInfo: { percentage: 90 }  // Child has metric but no counters
        }]
    });
    assert.strictEqual(
        fieldAwareFallbackCountersReplay[0].scoreInfo.correct,
        8,
        'one-entry suite must fall back to parent correct when child has only metrics'
    );
    assert.strictEqual(
        fieldAwareFallbackCountersReplay[0].scoreInfo.total,
        10,
        'one-entry suite must fall back to parent total when child has only metrics'
    );
    assert.strictEqual(
        fieldAwareFallbackCountersReplay[0].scoreInfo.percentage,
        90,
        'one-entry suite child metric must be used when present'
    );
    assert.strictEqual(
        fieldAwareFallbackCountersReplay[0].scoreInfo.accuracy,
        0.9,
        'accuracy must derive from child percentage when present'
    );

    // Partial metric pairs must resolve atomically within one provenance:
    // the missing sibling is derived, never borrowed from a lower source.
    const atomicAccuracyPairReplay = replayMixin._buildReviewReplayEntriesFromRecord({
        examId: 'atomic-accuracy-pair',
        scoreInfo: { correct: 8, total: 10, accuracy: 0.8 },
        rawData: { percentage: 20 }
    })[0];
    assert.strictEqual(atomicAccuracyPairReplay.scoreInfo.accuracy, 0.8);
    assert.strictEqual(
        atomicAccuracyPairReplay.scoreInfo.percentage,
        80,
        'percentage must derive from the same provenance as accuracy, not mix in rawData'
    );

    const atomicPercentagePairReplay = replayMixin._buildReviewReplayEntriesFromRecord({
        examId: 'atomic-percentage-pair',
        scoreInfo: { correct: 8, total: 10, percentage: 20 },
        rawData: { accuracy: 0.8 }
    })[0];
    assert.strictEqual(
        atomicPercentagePairReplay.scoreInfo.accuracy,
        0.2,
        'accuracy must derive from the same provenance as percentage, not mix in rawData'
    );
    assert.strictEqual(atomicPercentagePairReplay.scoreInfo.percentage, 20);

    const atomicExplicitZeroPairReplay = replayMixin._buildReviewReplayEntriesFromRecord({
        examId: 'atomic-explicit-zero-pair',
        scoreInfo: { correct: 8, total: 10, accuracy: 0 },
        rawData: { percentage: 20 }
    })[0];
    assert.strictEqual(atomicExplicitZeroPairReplay.scoreInfo.accuracy, 0);
    assert.strictEqual(
        atomicExplicitZeroPairReplay.scoreInfo.percentage,
        0,
        'an authored zero metric must not be paired with a lower-provenance percentage'
    );

    // AppData's full projection shape: generated root zero quartet plus the
    // authored detail under rawData.scoreInfo must replay 8/10 at 80%.
    const generatedZeroQuartetReplay = replayMixin._buildReviewReplayEntriesFromRecord({
        examId: 'generated-zero-quartet',
        correctAnswers: 0,
        totalQuestions: 0,
        accuracy: 0,
        percentage: 0,
        rawData: { scoreInfo: { correct: 8, total: 10, accuracy: 0.8, percentage: 80 } }
    })[0];
    assert.strictEqual(
        generatedZeroQuartetReplay.scoreInfo.correct,
        8,
        'generated root zeroes must yield to the authored nested detail'
    );
    assert.strictEqual(generatedZeroQuartetReplay.scoreInfo.total, 10);
    assert.strictEqual(generatedZeroQuartetReplay.scoreInfo.accuracy, 0.8);
    assert.strictEqual(generatedZeroQuartetReplay.scoreInfo.percentage, 80);

    // Legacy score-only detail with generated metric zeroes: the metrics must
    // derive from the restored 8/10 counters instead of staying at 0%.
    const legacyScoreMetricDerivationReplay = replayMixin._buildReviewReplayEntriesFromRecord({
        examId: 'legacy-score-metric-derivation',
        correctAnswers: 0,
        totalQuestions: 0,
        accuracy: 0,
        percentage: 0,
        scoreInfo: { score: 8, total: 10 }
    })[0];
    assert.strictEqual(legacyScoreMetricDerivationReplay.scoreInfo.correct, 8);
    assert.strictEqual(legacyScoreMetricDerivationReplay.scoreInfo.total, 10);
    assert.strictEqual(
        legacyScoreMetricDerivationReplay.scoreInfo.accuracy,
        0.8,
        'metrics must derive from restored counters when only generated zeroes remain'
    );
    assert.strictEqual(legacyScoreMetricDerivationReplay.scoreInfo.percentage, 80);

    // Symmetric generated-zero handling: both counters must yield, never just
    // correctAnswers (which produced 25/0 at 0%).
    const symmetricGeneratedZeroReplay = replayMixin._buildReviewReplayEntriesFromRecord({
        examId: 'symmetric-generated-zero',
        correctAnswers: 0,
        totalQuestions: 0,
        scoreInfo: { correct: 25, total: 40 }
    })[0];
    assert.strictEqual(symmetricGeneratedZeroReplay.scoreInfo.correct, 25);
    assert.strictEqual(
        symmetricGeneratedZeroReplay.scoreInfo.total,
        40,
        'a generated totalQuestions zero must yield to the nested total like correctAnswers does'
    );

    // A genuine zero stays zero when the nested detail corroborates it.
    const corroboratedZeroReplay = replayMixin._buildReviewReplayEntriesFromRecord({
        examId: 'corroborated-zero',
        correctAnswers: 0,
        scoreInfo: { correct: 0 }
    })[0];
    assert.strictEqual(
        corroboratedZeroReplay.scoreInfo.correct,
        0,
        'a root zero corroborated by a nested zero must be preserved'
    );

    // A partial one-entry-suite child must inherit parent fields without
    // inheriting the parent's non-canonical scoreInfo keys.
    const parentKeyLeakGuardReplay = replayMixin._buildReviewReplayEntriesFromRecord({
        examId: 'parent-key-leak-guard-parent',
        correctAnswers: 8,
        totalQuestions: 10,
        accuracy: 0.8,
        percentage: 80,
        scoreInfo: {
            correct: 8,
            total: 10,
            score: 8,
            duration: 999,
            source: 'suite_mode_aggregated'
        },
        suiteEntries: [{
            examId: 'parent-key-leak-guard-child',
            correctAnswers: 5,
            totalQuestions: 10
        }]
    })[0];
    assert.strictEqual(parentKeyLeakGuardReplay.scoreInfo.correct, 5);
    assert.strictEqual(parentKeyLeakGuardReplay.scoreInfo.total, 10);
    assert.strictEqual(
        parentKeyLeakGuardReplay.scoreInfo.accuracy,
        0.5,
        'parent metrics that contradict the child counters must be dropped, not spliced onto them'
    );
    assert.strictEqual(
        parentKeyLeakGuardReplay.scoreInfo.percentage,
        50,
        'metrics must derive from the 5/10 child counters, not the 80% parent aggregate'
    );
    assert.strictEqual(
        parentKeyLeakGuardReplay.scoreInfo.source,
        undefined,
        'a partial child must not inherit the parent scoreInfo source label'
    );
    assert.strictEqual(
        parentKeyLeakGuardReplay.scoreInfo.score,
        undefined,
        'a partial child must not inherit the parent scoreInfo legacy score'
    );
    assert.strictEqual(
        parentKeyLeakGuardReplay.scoreInfo.duration,
        undefined,
        'a partial child must not inherit the parent scoreInfo duration'
    );

    const counterOnlyChildLeakGuardReplay = replayMixin._buildReviewReplayEntriesFromRecord({
        examId: 'counter-only-leak-guard-parent',
        correctAnswers: 8,
        totalQuestions: 10,
        accuracy: 0.8,
        percentage: 80,
        scoreInfo: {
            correct: 8,
            total: 10,
            score: 8,
            duration: 999,
            source: 'suite_mode_aggregated'
        },
        suiteEntries: [{
            examId: 'counter-only-leak-guard-child',
            scoreInfo: { correctAnswers: 8 }
        }]
    })[0];
    assert.strictEqual(counterOnlyChildLeakGuardReplay.scoreInfo.correct, 8);
    assert.strictEqual(
        counterOnlyChildLeakGuardReplay.scoreInfo.total,
        10,
        'a counter-only child must still fall back to the parent total per field'
    );
    assert.strictEqual(counterOnlyChildLeakGuardReplay.scoreInfo.accuracy, 0.8);
    assert.strictEqual(counterOnlyChildLeakGuardReplay.scoreInfo.percentage, 80);
    assert.strictEqual(counterOnlyChildLeakGuardReplay.scoreInfo.source, undefined);
    assert.strictEqual(counterOnlyChildLeakGuardReplay.scoreInfo.duration, undefined);

    // Parent-metric coherence: a one-entry-suite child with its own complete
    // counters must never display the parent aggregate's metrics when the
    // two describe different scores (the "3/10 at 80%" assembly bug).
    const incoherentParentMetricReplay = replayMixin._buildReviewReplayEntriesFromRecord({
        examId: 'incoherent-parent-metric-parent',
        correctAnswers: 8,
        totalQuestions: 10,
        accuracy: 0.8,
        percentage: 80,
        suiteEntries: [{
            examId: 'incoherent-parent-metric-child',
            correctAnswers: 3,
            totalQuestions: 10
        }]
    })[0];
    assert.strictEqual(incoherentParentMetricReplay.scoreInfo.correct, 3);
    assert.strictEqual(incoherentParentMetricReplay.scoreInfo.total, 10);
    assert.strictEqual(
        incoherentParentMetricReplay.scoreInfo.accuracy,
        0.3,
        'a child counter pair must not be spliced onto the parent aggregate accuracy'
    );
    assert.strictEqual(
        incoherentParentMetricReplay.scoreInfo.percentage,
        30,
        'metrics must derive from the child counters when the parent pair contradicts them'
    );

    // Generated zero quartet on a one-entry-suite child: the parent's
    // aggregate metrics must not resurrect a score the child never had.
    const zeroQuartetChildParentMetricReplay = replayMixin._buildReviewReplayEntriesFromRecord({
        examId: 'zero-quartet-child-parent-metric-parent',
        correctAnswers: 8,
        totalQuestions: 10,
        accuracy: 0.8,
        percentage: 80,
        suiteEntries: [{
            examId: 'zero-quartet-child-parent-metric-child',
            correctAnswers: 0,
            totalQuestions: 0
        }]
    })[0];
    assert.strictEqual(zeroQuartetChildParentMetricReplay.scoreInfo.correct, 0);
    assert.strictEqual(zeroQuartetChildParentMetricReplay.scoreInfo.total, 0);
    assert.strictEqual(
        zeroQuartetChildParentMetricReplay.scoreInfo.accuracy,
        0,
        'a generated child zero quartet must not inherit the parent aggregate metrics'
    );
    assert.strictEqual(
        zeroQuartetChildParentMetricReplay.scoreInfo.percentage,
        0
    );

    // A generated child correctAnswers zero must not import the parent's
    // correct count; the missing total still falls back per field.
    const childZeroCorrectReplay = replayMixin._buildReviewReplayEntriesFromRecord({
        examId: 'child-zero-correct-parent',
        correctAnswers: 8,
        totalQuestions: 10,
        accuracy: 0.8,
        percentage: 80,
        suiteEntries: [{
            examId: 'child-zero-correct-child',
            correctAnswers: 0
        }]
    })[0];
    assert.strictEqual(
        childZeroCorrectReplay.scoreInfo.correct,
        0,
        'an uncorroborated child zero must not cross into the parent aggregate counters'
    );
    assert.strictEqual(
        childZeroCorrectReplay.scoreInfo.total,
        10,
        'the child total may still fall back to the parent per field'
    );
    assert.strictEqual(childZeroCorrectReplay.scoreInfo.accuracy, 0);
    assert.strictEqual(childZeroCorrectReplay.scoreInfo.percentage, 0);

    // An authored child zero with its own total keeps both: the zero does
    // not import the parent correct count, and the parent metrics that
    // contradict 0/10 are dropped.
    const childZeroCorrectWithTotalReplay = replayMixin._buildReviewReplayEntriesFromRecord({
        examId: 'child-zero-correct-with-total-parent',
        correctAnswers: 8,
        totalQuestions: 10,
        accuracy: 0.8,
        percentage: 80,
        suiteEntries: [{
            examId: 'child-zero-correct-with-total-child',
            correctAnswers: 0,
            totalQuestions: 10
        }]
    })[0];
    assert.strictEqual(childZeroCorrectWithTotalReplay.scoreInfo.correct, 0);
    assert.strictEqual(childZeroCorrectWithTotalReplay.scoreInfo.total, 10);
    assert.strictEqual(childZeroCorrectWithTotalReplay.scoreInfo.accuracy, 0);
    assert.strictEqual(childZeroCorrectWithTotalReplay.scoreInfo.percentage, 0);


    const signedTimestampReplay = replayMixin._buildReviewReplayEntriesFromRecord({
        examId: 'legacy-signed-timestamp',
        timestamp: '-1',
        date: '2026-08-15T10:50:00.000Z'
    })[0];
    assert.strictEqual(signedTimestampReplay.endTime, '2026-08-15T10:50:00.000Z');
}

async function run() {
    await testVocabPhoneticMutationProtection();
    await testAtomicVocabPhoneticBackfill();
    await testReplaceProgressPhoneticProtection();
    await testV2MergeImportPhoneticProtection();
    await testLegacyReplayProjectionContract();
    const { app, shared, envelope, sandbox } = harness(); await app.ready;
    const huge = 'x'.repeat(20000);
    const completed = await app.practice.completeAttempt({ operationId: 'complete', record: { id: 'r1', examId: 'reading-1', type: 'reading', title: 'Test', totalQuestions: 2, correctAnswers: 1, answers: { 1: 'A' }, answerMap: { 2: 'B' }, answerList: [{ questionId: '3', answer: 'C' }], correctAnswerMap: { 1: 'B' }, answerDetails: huge, scoreInfo: { band: 7 }, markedQuestions: ['q1'], highlights: [{ text: huge }], notes: { q1: huge }, interactions: [{ type: 'click' }], metadata: { examId: 'reading-1', examTitle: 'Reading 1', category: 'academic', frequency: 4, libraryConfigurationId: 'library-1', privatePayload: huge }, realData: { rawData: { token: huge }, answers: { 1: 'wrong', 4: 'D' }, answerMap: { 5: 'E' } }, rawData: { shouldNotPersist: huge, answers: { 6: 'F' }, answerMap: { 7: 'G' }, realData: { answers: { 8: 'H' } } } } });
    assert.strictEqual(completed.record.answers[1], 'A');
    const overloadedScore = await app.practice.completeAttempt({
        operationId: 'complete-overloaded-score',
        record: {
            id: 'r-overloaded-score',
            examId: 'reading-overloaded',
            type: 'reading',
            correctAnswers: { q1: 'A', q2: 'B' },
            correctAnswerMap: {},
            scoreInfo: { correct: 1, total: 2, accuracy: 0.5 }
        }
    });
    assert.strictEqual(overloadedScore.record.correctAnswers, 1, 'object answer map must not replace the numeric score');
    assert.strictEqual(overloadedScore.record.totalQuestions, 2, 'scoreInfo.total must supply the canonical question count');
    assert.deepStrictEqual(overloadedScore.record.correctAnswerMap, { q1: 'A', q2: 'B' }, 'the overloaded answer map must be preserved in detail');
    const zeroScore = await app.practice.completeAttempt({
        operationId: 'complete-zero-score',
        record: { id: 'r-zero-score', type: 'listening', correctAnswers: -1, scoreInfo: { correct: 0, total: 1 } }
    });
    assert.strictEqual(zeroScore.record.correctAnswers, 0, 'a valid zero score must survive fallback selection');
    await assert.rejects(
        () => app.practice.completeAttempt({ operationId: 'complete-invalid-score', record: { id: 'r-invalid-score', type: 'reading', correctAnswers: -1 } }),
        { code: 'VALIDATION' }
    );
    const summary = shared.entities.get('practiceSummaries').get('r1').data;
    const detail = shared.entities.get('practiceDetails').get('r1').data;
    const annotations = shared.entities.get('practiceAnnotations').get('r1').data;
    assert(!Object.prototype.hasOwnProperty.call(summary, 'answers')); assert(!Object.prototype.hasOwnProperty.call(summary, 'answerDetails')); assert(!Object.prototype.hasOwnProperty.call(summary, 'notes')); assert(!Object.prototype.hasOwnProperty.call(summary.metadata, 'privatePayload')); assert.deepStrictEqual(summary.metadata, { examId: 'reading-1', examTitle: 'Reading 1', category: 'academic', frequency: 4, libraryConfigurationId: 'library-1' }); assert(JSON.stringify(summary).length < 3000, 'large fields must not enter summary');
    assert.deepStrictEqual(detail.answers, { 1: 'A', 2: 'B', 3: 'C', 4: 'D', 5: 'E', 6: 'F', 7: 'G', 8: 'H' }, 'all compatibility aliases must converge on Detail.answers with canonical values winning conflicts');
    assert(!Object.prototype.hasOwnProperty.call(detail, 'answerMap'));
    assert(!Object.prototype.hasOwnProperty.call(detail, 'answerList'));
    assert(!Object.prototype.hasOwnProperty.call(annotations, 'answers'));
    assert(!JSON.stringify(detail).includes('realData') && !JSON.stringify(detail).includes('rawData')); assert(!JSON.stringify(annotations).includes('realData') && !JSON.stringify(annotations).includes('rawData'));
    shared.reads = []; shared.lists = []; await app.practice.list({ projection: 'light' }); assert.deepStrictEqual(shared.lists, ['practiceSummaries']); assert.deepStrictEqual(shared.reads, []);
    shared.reads = []; await app.practice.get('r1', { projection: 'detail' }); assert.deepStrictEqual(shared.reads, ['practiceSummaries', 'practiceDetails']);
    shared.reads = []; const full = await app.practice.get('r1'); assert.deepStrictEqual(shared.reads, ['practiceSummaries', 'practiceDetails', 'practiceAnnotations']); assert.strictEqual(full.notes.q1, huge);
    assert.deepStrictEqual(full.answers, detail.answers);
    const writes = shared.mutations.at(-1); assert.strictEqual(writes.length, 3); assert.deepStrictEqual(new Set(writes.map((item) => item.store)), new Set(['practiceSummaries', 'practiceDetails', 'practiceAnnotations']));
    const summaryRevision = shared.entities.get('practiceSummaries').get('r1').revision;
    const detailRevision = shared.entities.get('practiceDetails').get('r1').revision;
    const annotationRevision = shared.entities.get('practiceAnnotations').get('r1').revision;
    await app.practice.updateAnnotations({ recordId: 'r1', examId: 'reading-1', expectedRevision: annotationRevision, patch: { reviewed: true } });
    assert.deepStrictEqual(shared.mutations.at(-1).map((item) => item.store), ['practiceAnnotations'], 'annotation edits must write only the Annotation layer');
    assert.strictEqual(shared.entities.get('practiceSummaries').get('r1').revision, summaryRevision);
    assert.strictEqual(shared.entities.get('practiceDetails').get('r1').revision, detailRevision);
    assert.strictEqual(shared.entities.get('practiceAnnotations').get('r1').revision, annotationRevision + 1);
    const suiteLight = app.practice.projectLight({
        id: 'suite-light',
        type: 'reading-suite',
        suiteEntries: [{
            examId: 'reading-child',
            title: 'Child',
            correctAnswers: { q1: 'A', q2: 'B' },
            scoreInfo: { correct: 1, total: 2 },
            answers: { 1: 'A' },
            notes: { 1: 'private' },
            replay: { html: '<secret>' }
        }]
    });
    assert.deepStrictEqual(suiteLight.suiteEntrySummaries.map((entry) => entry.examId), ['reading-child']);
    assert.strictEqual(suiteLight.suiteEntrySummaries[0].correctAnswers, 1);
    assert.strictEqual(suiteLight.suiteEntrySummaries[0].totalQuestions, 2);
    assert.strictEqual(suiteLight.suiteEntrySummaries[0].accuracy, 0.5);
    assert.strictEqual(suiteLight.suiteEntrySummaries[0].type, 'reading');
    assert(!JSON.stringify(suiteLight.suiteEntrySummaries).includes('answers'));
    assert(!JSON.stringify(suiteLight.suiteEntrySummaries).includes('private'));
    const insightRecord = app.practice.projectLight({
        id: 'reading-insight',
        type: 'reading',
        questionTypePerformance: {
            true_false_not_given: { total: 3, correct: 1 },
            short_answer: { totalQuestions: 2, correctAnswers: 1 }
        }
    });
    assert.deepStrictEqual(
        insightRecord.questionTypeErrorCounts,
        { true_false_not_given: 2, short_answer: 1 },
        'light projection must retain compact error counts without answer content'
    );
    const insightSuite = app.practice.projectLight({
        id: 'suite-insight',
        type: 'suite',
        suiteEntries: [{
            examId: 'reading-suite-entry',
            type: 'reading',
            scoreInfo: {
                details: {
                    q1: { isCorrect: false, questionType: 'matching_headings' },
                    q2: { isCorrect: true, questionType: 'matching_headings' }
                }
            }
        }]
    });
    assert.deepStrictEqual(
        insightSuite.suiteEntrySummaries[0].questionTypeErrorCounts,
        { matching_headings: 1 },
        'suite entry light projection must retain compact error counts after child deletion'
    );
    const suiteHarness = harness();
    await suiteHarness.app.ready;
    await suiteHarness.app.practice.completeAttempt({
        operationId: 'suite-child',
        record: { id: 'record_suite-child-session', sessionId: 'suite-child-session', type: 'reading', answers: { q1: 'A' } }
    });
    await suiteHarness.app.practice.finalizeSuite({
        operationId: 'suite-finalize',
        childSessionIds: ['suite-child-session'],
        record: { id: 'suite-parent', sessionId: 'suite-parent', type: 'reading', suiteEntries: [{ examId: 'reading-child' }] }
    });
    for (const store of ['practiceSummaries', 'practiceDetails', 'practiceAnnotations']) {
        assert.strictEqual(suiteHarness.shared.entities.get(store).has('record_suite-child-session'), false, `${store} child row must be removed by sessionId`);
        assert.strictEqual(suiteHarness.shared.entities.get(store).has('suite-parent'), true, `${store} aggregate row must remain`);
    }
    const historicalHarness = harness();
    historicalHarness.shared.entities.get('practiceSummaries').set('historical-insight', {
        recordId: 'historical-insight',
        revision: 1,
        operationId: 'historical-summary',
        updatedAt: '2026-01-01T00:00:00.000Z',
        data: {
            id: 'historical-insight',
            sessionId: 'historical-insight',
            type: 'reading',
            date: '2026-01-01T00:00:00.000Z'
        },
        checksum: checksum({
            id: 'historical-insight',
            sessionId: 'historical-insight',
            type: 'reading',
            date: '2026-01-01T00:00:00.000Z'
        })
    });
    historicalHarness.shared.entities.get('practiceDetails').set('historical-insight', {
        recordId: 'historical-insight',
        revision: 1,
        operationId: 'historical-detail',
        updatedAt: '2026-01-01T00:00:00.000Z',
        data: {
            recordId: 'historical-insight',
            questionTypePerformance: {
                matching_information: { total: 2, correct: 1 }
            }
        },
        checksum: checksum({
            recordId: 'historical-insight',
            questionTypePerformance: {
                matching_information: { total: 2, correct: 1 }
            }
        })
    });
    historicalHarness.shared.entities.get('practiceAnnotations').set('historical-insight', {
        recordId: 'historical-insight',
        revision: 1,
        operationId: 'historical-annotations',
        updatedAt: '2026-01-01T00:00:00.000Z',
        data: { recordId: 'historical-insight' },
        checksum: checksum({ recordId: 'historical-insight' })
    });
    historicalHarness.shared.reads = [];
    const historicalInsights = await historicalHarness.app.practice.listInsights({ limit: 10 });
    const historicalInsight = historicalInsights.find((record) => record.id === 'historical-insight');
    assert.deepStrictEqual(
        historicalInsight.questionTypeErrorCounts,
        { matching_information: 1 },
        'historical summaries must receive a bounded detail-backed insight projection'
    );
    assert.deepStrictEqual(
        historicalHarness.shared.reads,
        ['practiceDetails'],
        'insight backfill may read only the bounded missing detail, never annotations'
    );
    shared.reads = []; shared.lists = []; await app.practice.getStats(); assert.deepStrictEqual(shared.lists, ['practiceSummaries']); assert.deepStrictEqual(shared.reads, []);
    shared.reads = []; shared.lists = []; await app.achievements.getAll(); assert.deepStrictEqual(shared.lists, ['practiceSummaries']); assert.deepStrictEqual(shared.reads, []);
    const durableAchievements = harness();
    await durableAchievements.app.practice.completeAttempt({
        operationId: 'durable-achievement-record',
        record: {
            id: 'achievement-record',
            type: 'reading',
            completedAt: '2026-01-02T00:00:00.000Z',
            totalQuestions: 1,
            correctAnswers: 1
        }
    });
    const firstUnlock = await durableAchievements.app.achievements.getAll();
    assert.strictEqual(firstUnlock.first_step.unlockedAt, '2026-01-02T00:00:00.000Z');
    await durableAchievements.app.practice.clear();
    const retainedUnlock = await durableAchievements.app.achievements.getAll();
    assert.strictEqual(
        retainedUnlock.first_step.unlockedAt,
        firstUnlock.first_step.unlockedAt,
        'deleting source records must not relock a persisted achievement'
    );
    assert(durableAchievements.shared.docs.has('achievements.progress'), 'achievement progress must be durable');
    const backup = await app.backups.create({ id: 'b1' }); assert.deepStrictEqual(Object.keys(backup.data.entities).sort(), ['practiceAnnotations', 'practiceDetails', 'practiceSummaries']);
    const exported = await app.backups.export(); assert.deepStrictEqual(Object.keys(exported.entities).sort(), ['practiceAnnotations', 'practiceDetails', 'practiceSummaries']);
    assert.strictEqual(app.backups.validateSnapshot(exported), true, 'AppData must expose the canonical v2 snapshot validator');
    const corruptedExport = clone(exported);
    corruptedExport.entities.practiceSummaries.push({ recordId: 'corrupt', data: {} });
    assert.strictEqual(app.backups.validateSnapshot(corruptedExport), false, 'the canonical validator must reject a checksum mismatch');

    // Recompute the snapshot checksum after each mutation so these cases exercise
    // deep validation instead of only the outer checksum.
    const envelopeKey = Object.keys(exported.envelopes).find((key) => key === 'settings.values') || Object.keys(exported.envelopes)[0];
    const deepValidationCases = [
        ['invalid envelope field', (snapshot) => { snapshot.envelopes[envelopeKey].revision = 0; }],
        ['invalid envelope checksum', (snapshot) => { snapshot.envelopes[envelopeKey].checksum = 'fnv1a-forged-envelope'; }],
        ['invalid entity row checksum', (snapshot) => { snapshot.entities.practiceSummaries[0].checksum = 'fnv1a-forged-row'; }],
        ['invalid entity row field', (snapshot) => { delete snapshot.entities.practiceSummaries[0].operationId; }],
        ['duplicate entity recordId', (snapshot) => { snapshot.entities.practiceSummaries.push(clone(snapshot.entities.practiceSummaries[0])); }],
        ['sparse entity array', (snapshot) => { snapshot.entities.practiceSummaries = new Array(1); }],
        ['practice layer recordId mismatch', (snapshot) => { snapshot.entities.practiceDetails[0].recordId = 'different-practice-id'; }],
        ['summary payload id mismatch', (snapshot) => {
            const row = snapshot.entities.practiceSummaries[0];
            row.data.id = 'payload-id-does-not-match';
            row.checksum = checksum(row.data);
        }],
        ['detail payload id mismatch', (snapshot) => {
            const row = snapshot.entities.practiceDetails[0];
            row.data.recordId = 'payload-id-does-not-match';
            row.checksum = checksum(row.data);
        }],
        ['annotation payload id mismatch', (snapshot) => {
            const row = snapshot.entities.practiceAnnotations[0];
            row.data.recordId = 'payload-id-does-not-match';
            row.checksum = checksum(row.data);
        }]
    ];
    for (const [label, mutate] of deepValidationCases) {
        const malformed = sealSnapshot(clone(exported));
        mutate(malformed);
        sealSnapshot(malformed);
        assert.strictEqual(app.backups.validateSnapshot(malformed), false, `${label} must fail validateSnapshot`);
    }
    assert.strictEqual(
        Object.prototype.hasOwnProperty.call(sandbox, '__AppDataV2Internals'),
        false,
        'production AppData must remove the bootstrap internals channel'
    );
    Reflect.deleteProperty(sandbox, '__AppDataV2Internals');
    const postBootstrapCorruption = sealSnapshot(clone(exported));
    postBootstrapCorruption.entities.practiceAnnotations[0].data = { forged: true };
    sealSnapshot(postBootstrapCorruption);
    assert.strictEqual(
        app.backups.validateSnapshot(postBootstrapCorruption),
        false,
        'validateSnapshot must retain deep validation after bootstrap internals are deleted'
    );

    const exportIntegrity = await backupFixture('export-integrity');
    const liveRow = exportIntegrity.shared.entities.get('practiceSummaries').get('export-integrity-record');
    liveRow.data = Object.assign({}, liveRow.data, { title: 'tampered after persistence' });
    await expectFailure(
        () => exportIntegrity.app.backups.export(),
        'backups.export must reject a persisted entity row whose data no longer matches its checksum'
    );

    const backupEnvelopeForgery = await backupFixture('backup-envelope-forgery');
    const backupEnvelope = storedBackup(backupEnvelopeForgery.shared, 'backup-envelope-forgery');
    const validById = await backupEnvelopeForgery.app.backups.export({ backupId: 'backup-envelope-forgery' });
    assert.strictEqual(validById.id, 'backup-envelope-forgery', 'backupId export must succeed for an intact stored backup');
    synchronizeStoredBackup(backupEnvelope, (snapshot) => { snapshot.schemaVersion = 999; });
    await expectFailure(
        () => backupEnvelopeForgery.app.backups.export({ backupId: 'backup-envelope-forgery' }),
        'backupId export must reject a forged stored snapshot outer field even when checksums are synchronized'
    );

    const backupNestedForgery = await backupFixture('backup-nested-forgery');
    const nestedStored = storedBackup(backupNestedForgery.shared, 'backup-nested-forgery');
    synchronizeStoredBackup(nestedStored, (snapshot) => {
        snapshot.entities.practiceSummaries[0].data = Object.assign({}, snapshot.entities.practiceSummaries[0].data, { title: 'nested forgery' });
    });
    await expectFailure(
        () => backupNestedForgery.app.backups.export({ backupId: 'backup-nested-forgery' }),
        'backupId export must reject nested entity corruption despite synchronized outer checksums'
    );

    await expectFailure(() => app.backups.export({ domains: [] }), 'empty backup domains must be rejected');
    await expectFailure(() => app.backups.export({ domains: ['unknown-domain'] }), 'unknown backup domains must be rejected');
    await expectFailure(() => app.backups.export({ domains: ['system'] }), 'a known domain with no selectable export data must be rejected');
    const practiceDomainExport = await app.backups.export({ domains: ['practice', 'settings'] });
    assert.strictEqual(practiceDomainExport.scope, 'partial', 'a legal domain selection must still export successfully');
    assert.strictEqual(app.backups.validateSnapshot(practiceDomainExport), true, 'a legal domain export must remain a valid snapshot');
    await app.practice.clear(); assert.strictEqual(shared.mutations.at(-1).length, 3);
    const importPlan = await app.backups.previewImport(exported, { replace: true });
    await app.backups.commitImport(importPlan.id, { confirmDestructive: true });
    assert.strictEqual(shared.lastInstallOptions.resetJournal, true, 'full replacement imports must reset stale operation-journal entries');
    assert.strictEqual((await app.practice.get('r1')).answers[1], 'A');
    const stalePlan = await app.backups.previewImport(exported, { replace: true });
    const annotationRevisionBeforeStaleCommit = shared.entities.get('practiceAnnotations').get('r1').revision;
    await app.practice.updateAnnotations({
        recordId: 'r1',
        examId: 'reading-1',
        expectedRevision: annotationRevisionBeforeStaleCommit,
        patch: { createdDuringImportConfirmation: true }
    });
    await assert.rejects(
        () => app.backups.commitImport(stalePlan.id, { confirmDestructive: true }),
        { code: 'CONFLICT' },
        'commitImport must reject a plan built before a concurrent practice edit'
    );
    assert.strictEqual(
        shared.entities.get('practiceAnnotations').get('r1').data.createdDuringImportConfirmation,
        true,
        'a stale import must not erase the concurrent practice edit'
    );
    const partial = { format: 'ielts-atlas-data-v2', schemaVersion: 2, scope: 'partial', envelopes: {}, entities: { practiceSummaries: [] } }; partial.checksum = checksum({ envelopes: partial.envelopes, entities: partial.entities });
    await assert.rejects(() => app.backups.previewImport(partial, { replace: true }), { code: 'VALIDATION' });
    const orphanMerge = clone(partial);
    orphanMerge.entities.practiceSummaries = [{
        recordId: 'orphan',
        revision: 1,
        operationId: 'orphan-import',
        updatedAt: new Date().toISOString(),
        data: { id: 'orphan', type: 'reading' },
        checksum: checksum({ id: 'orphan', type: 'reading' })
    }];
    orphanMerge.checksum = checksum({ envelopes: orphanMerge.envelopes, entities: orphanMerge.entities });
    await assert.rejects(() => app.backups.previewImport(orphanMerge, { practiceMode: 'merge' }), { code: 'VALIDATION' });
    await app.settings.patch({ lateSetting: true });
    await app.vocab.saveWords([{ id: 'late-word', word: 'late-word' }]);
    await app.goals.save({ id: 'late-goal', title: 'Late goal' });
    await app.preferences.setTheme('late-theme');
    await app.backups.restore('b1');
    assert.strictEqual((await app.practice.get('r1')).answers[1], 'A');
    assert.deepStrictEqual(await app.settings.getAll(), {});
    assert.deepStrictEqual(await app.vocab.listWords(), []);
    assert.deepStrictEqual(await app.goals.list(), []);
    assert.deepStrictEqual(await app.preferences.getAll(), {});
    assert.strictEqual(shared.lastInstallOptions.resetJournal, true);
    assert(shared.lastInstallOptions.expectedRevisionToken,
        'local backup restore must pass the plan revision token into the atomic snapshot install');
    assert.deepStrictEqual(
        new Set(Array.from(shared.entities, ([store, rows]) => `${store}:${Array.from(rows.keys()).sort().join(',')}`)),
        new Set([
            'practiceSummaries:r-overloaded-score,r-zero-score,r1',
            'practiceDetails:r-overloaded-score,r-zero-score,r1',
            'practiceAnnotations:r-overloaded-score,r-zero-score,r1'
        ])
    );
    const restoreRace = await backupFixture('restore-race');
    await restoreRace.app.settings.patch({ beforeRace: true });
    restoreRace.shared.beforeInstall = async () => {
        const current = restoreRace.shared.docs.get('settings.values');
        restoreRace.shared.docs.set('settings.values', restoreRace.envelope(
            'settings.values',
            { concurrentDuringRestore: true },
            'present',
            Number(current && current.revision || 0) + 1,
            'concurrent-during-restore'
        ));
    };
    await assert.rejects(
        () => restoreRace.app.backups.restore('restore-race'),
        { code: 'CONFLICT' },
        'a concurrent write after the pre-restore safety backup must abort restore'
    );
    assert.strictEqual((await restoreRace.app.settings.getAll()).concurrentDuringRestore, true);
    await Promise.all([
        app.vocab.upsertCollectionWord('highlights', { word: 'alpha' }),
        app.vocab.upsertCollectionWord('highlights', { word: 'beta' })
    ]);
    assert.deepStrictEqual(
        (await app.vocab.readList('highlights')).words.map((word) => word.word).sort(),
        ['alpha', 'beta']
    );
    shared.failEntityStore = 'practiceDetails'; await assert.rejects(() => app.practice.completeAttempt({ record: { id: 'r2', type: 'reading' } }), { code: 'IO' }); assert.strictEqual(shared.entities.get('practiceSummaries').has('r2'), false); assert.strictEqual(shared.entities.get('practiceDetails').has('r2'), false); assert.strictEqual(shared.entities.get('practiceAnnotations').has('r2'), false);
    await assert.rejects(() => app.practice.delete('r1'), { code: 'IO' }); assert.strictEqual(shared.entities.get('practiceSummaries').has('r1'), true); assert.strictEqual(shared.entities.get('practiceDetails').has('r1'), true); assert.strictEqual(shared.entities.get('practiceAnnotations').has('r1'), true); shared.failEntityStore = null;
    await Promise.all([
        app.preferences.setTheme('dark'),
        app.preferences.setConsent({ accepted: true }),
        app.preferences.setBrowse({ category: 'reading' }),
        app.preferences.setOnboarding({ completed: true }),
        app.preferences.setThreeBackground('aurora'),
        app.preferences.setThemePortal({ open: false }),
        app.preferences.setPracticeWidget('compact'),
        app.preferences.setLogConfig({ level: 'warn' }),
        app.preferences.setCandidateCode({ mode: 'auto' }),
        app.preferences.setReadingDisplay({ fontSize: 18 }),
        app.preferences.setSuite({ autoAdvance: true }),
        app.preferences.setResourceBasePrefix('./')
    ]);
    const concurrentPreferences = await app.preferences.getAll();
    assert.strictEqual(concurrentPreferences.theme, 'dark');
    assert.strictEqual(concurrentPreferences.consent.accepted, true);
    assert.strictEqual(concurrentPreferences.browse.category, 'reading');
    assert.strictEqual(concurrentPreferences.logConfig.level, 'warn');
    await Promise.all(Array.from({ length: 8 }, (_, index) => app.recovery.saveActiveSession({
        id: `active-${index}`,
        sessionId: `session-${index}`,
        examId: `exam-${index}`
    })));
    assert.deepStrictEqual(
        (await app.recovery.listActiveSessions()).map((item) => item.id).sort(),
        Array.from({ length: 8 }, (_, index) => `active-${index}`)
    );
    await assert.rejects(() => app.backups.previewImport({ records: [] }), { code: 'VALIDATION' });
    const invalidStore = { format: 'ielts-atlas-data-v2', schemaVersion: 2, scope: 'partial', envelopes: {}, entities: { practiceRecords: [] } }; invalidStore.checksum = checksum({ envelopes: invalidStore.envelopes, entities: invalidStore.entities }); await assert.rejects(() => app.backups.previewImport(invalidStore), { code: 'VALIDATION' });

    // A real-world v2 export produced by the broken whole-IDB-row migration:
    // salvage safe wrappers, quarantine the inconsistent library domain, and
    // never let an empty practice replace commit without a second confirmation.
    await app.library.import({
        id: 'current-library',
        configuration: { name: 'Current library' },
        index: [{ id: 'reading-current' }]
    });
    await app.library.activate('current-library');
    await app.settings.patch({ currentOnly: true });
    const poisoned = {
        format: 'ielts-atlas-data-v2',
        schemaVersion: 2,
        scope: 'full',
        envelopes: {
            'achievements.manual': envelope('achievements.manual', {
                key: 'exam_system_user_achievements',
                value: '{}',
                timestamp: 1
            }),
            'library.activeConfigurationId': envelope('library.activeConfigurationId', '[object Object]'),
            'library.configurations': envelope('library.configurations', []),
            'preferences.values': envelope('preferences.values', {
                key: 'exam_system_settings',
                value: JSON.stringify({ theme: 'must-not-cross-domains' }),
                timestamp: 1
            }),
            'settings.values': envelope('settings.values', {
                key: 'exam_system_settings',
                value: JSON.stringify({ theme: 'light', notifications: true }),
                timestamp: 1,
                postMigrationFlag: true
            }),
            'vocab.userConfig': envelope('vocab.userConfig', {
                key: 'exam_system_vocab_user_config',
                value: JSON.stringify({ dailyNew: 20, reviewLimit: 100 }),
                timestamp: 1
            })
        },
        entities: {
            practiceSummaries: [],
            practiceDetails: [],
            practiceAnnotations: []
        }
    };
    poisoned.checksum = checksum({ envelopes: poisoned.envelopes, entities: poisoned.entities });
    const safePlan = await app.backups.previewImport(poisoned, { practiceMode: 'merge' });
    assert.strictEqual(safePlan.destructive, false);
    assert.strictEqual(safePlan.diagnostics.trust, 'degraded-partial');
    assert(safePlan.diagnostics.repairedKeys.includes('settings.values'));
    assert(safePlan.diagnostics.ignoredKeys.includes('library.activeConfigurationId'));
    assert(safePlan.diagnostics.ignoredKeys.includes('preferences.values'));
    assert(safePlan.diagnostics.missingKeys.includes('library.importedIndexes'));
    assert.strictEqual(safePlan.practice.removedCount, 0);
    await app.backups.commitImport(safePlan.id);
    assert.strictEqual(await app.library.getActive(), 'current-library');
    assert.strictEqual((await app.library.getIndex('current-library'))[0].id, 'reading-current');
    assert.strictEqual((await app.settings.getAll()).theme, 'light');
    assert.strictEqual((await app.settings.getAll()).currentOnly, true);
    assert.strictEqual((await app.settings.getAll()).postMigrationFlag, true);

    const partialLibrary = {
        format: 'ielts-atlas-data-v2',
        schemaVersion: 2,
        scope: 'partial',
        envelopes: {
            'library.activeConfigurationId': envelope('library.activeConfigurationId', null)
        },
        entities: {}
    };
    partialLibrary.checksum = checksum({ envelopes: partialLibrary.envelopes, entities: partialLibrary.entities });
    const partialLibraryPlan = await app.backups.previewImport(partialLibrary, { practiceMode: 'merge' });
    assert(partialLibraryPlan.keys.includes('library.activeConfigurationId'), 'valid partial library keys must not be quarantined');
    assert.deepStrictEqual(partialLibraryPlan.diagnostics.ignoredKeys, []);

    const destructivePlan = await app.backups.previewImport(poisoned, { practiceMode: 'replace' });
    assert.strictEqual(destructivePlan.destructive, true);
    assert(destructivePlan.practice.existingCount > 0);
    assert.strictEqual(destructivePlan.practice.finalCount, 0);
    assert.strictEqual(destructivePlan.practice.removedCount, destructivePlan.practice.existingCount);
    await assert.rejects(() => app.backups.commitImport(destructivePlan.id), { code: 'VALIDATION' });

    // Historical v1 export recognition (opensource practiceRecorder / DataBackupManager shapes).
    await app.practice.completeAttempt({
        operationId: 'keep-existing',
        record: { id: 'keep-me', examId: 'reading-keep', type: 'reading', title: 'Keep', totalQuestions: 1, correctAnswers: 1, answers: { 1: 'Z' } }
    });
    const v1Export = {
        exportDate: '2026-01-01T00:00:00.000Z',
        version: '0.6.2-form',
        practiceRecords: [{
            id: 'legacy-1',
            examId: 'reading-legacy',
            type: 'reading',
            title: 'Legacy Passage',
            metadata: { examTitle: 'Legacy Passage', category: 'P1' },
            realData: {
                answers: { q1: 'A', q2: 'B' },
                scoreInfo: { correct: 1, total: 2, accuracy: 50 },
                highlights: [{ text: 'real-highlight' }],
                notes: { q1: 'real-note' },
                noteText: 'real-note-text',
                interactions: [{ type: 'real-click' }]
            },
            rawData: {
                highlights: [{ text: 'raw-highlight' }],
                noteOutlines: { q1: ['raw-outline'] },
                noteText: 'raw-note-text',
                interactions: [{ type: 'raw-click' }]
            }
        }],
        userStats: { totalPractices: 99 }
    };
    const v1Plan = await app.backups.previewImport(v1Export, { practiceMode: 'merge' });
    assert.strictEqual(v1Plan.format, 'v1');
    assert.strictEqual(v1Plan.practice.importedCount, 1);
    const v1Receipt = await app.backups.commitImport(v1Plan.id);
    assert.strictEqual(v1Receipt.importedCount, 1);
    const legacy = await app.practice.get('legacy-1');
    assert.strictEqual(legacy.answers.q1, 'A');
    assert.strictEqual(legacy.correctAnswers, 1);
    assert.strictEqual(legacy.totalQuestions, 2);
    assert.strictEqual(legacy.accuracy, 0.5);
    assert.strictEqual(legacy.percentage, 50);
    assert.strictEqual(legacy.highlights[0].text, 'real-highlight');
    assert.strictEqual(legacy.notes.q1, 'real-note');
    assert.deepStrictEqual(legacy.noteOutlines.q1, ['raw-outline']);
    assert.strictEqual(legacy.noteText, 'real-note-text');
    assert.strictEqual(legacy.interactions[0].type, 'real-click');
    assert.strictEqual((await app.practice.get('keep-me')).answers[1], 'Z', 'merge must retain existing practice rows');

    const snakePlan = await app.backups.previewImport({
        practice_records: [{ id: 'snake-1', type: 'listening', title: 'Snake', totalQuestions: 3, correctAnswers: 2, answers: { 1: 'yes' } }]
    }, { practiceMode: 'replace' });
    assert.strictEqual(snakePlan.format, 'v1');
    assert.strictEqual(snakePlan.destructive, true);
    await app.backups.commitImport(snakePlan.id, { confirmDestructive: true });
    assert.strictEqual(await app.practice.get('keep-me'), null, 'practiceMode replace must clear prior practice rows');
    assert.strictEqual(await app.practice.get('legacy-1'), null);
    assert.strictEqual((await app.practice.get('snake-1')).answers[1], 'yes');

    console.log(JSON.stringify({ status: 'pass', tests: 52 }));
}
run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
