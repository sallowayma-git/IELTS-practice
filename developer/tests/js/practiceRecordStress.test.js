#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { performance } from 'perf_hooks';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const ciProfile = process.argv.includes('--ci');
const profile = ciProfile
    ? { concurrentRecords: 36, heavyRecords: 32, highlights: 60, notes: 30, outlines: 8 }
    : { concurrentRecords: 72, heavyRecords: 64, highlights: 180, notes: 80, outlines: 16 };

const clone = (value) => value === undefined ? undefined : structuredClone(value);
const source = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const stable = (value) => {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
};
const checksum = (value) => {
    let hash = 0x811c9dc5;
    for (const char of stable(value)) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 0x01000193);
    }
    return `fnv1a-${(hash >>> 0).toString(16)}`;
};

function createHarness(seed = null) {
    const catalogSandbox = { structuredClone };
    catalogSandbox.globalThis = catalogSandbox;
    vm.runInContext(source('js/data/v2/dataCatalog.js'), vm.createContext(catalogSandbox), { filename: 'dataCatalog.js' });
    const catalog = catalogSandbox.__AppDataV2Catalog;
    const shared = {
        docs: new Map(),
        entities: new Map([
            ['practiceSummaries', new Map()],
            ['practiceDetails', new Map()],
            ['practiceAnnotations', new Map()]
        ]),
        snapshotReads: 0,
        mutations: 0,
        counter: 0
    };
    if (seed && seed.entities) {
        for (const [store, rows] of Object.entries(seed.entities)) {
            if (!shared.entities.has(store)) shared.entities.set(store, new Map());
            for (const row of rows || []) shared.entities.get(store).set(String(row.recordId), clone(row));
        }
    }

    const envelope = (key, data, state = 'present', revision = 1, operationId = 'seed') => ({
        schemaVersion: catalog.version,
        revision,
        operationId,
        updatedAt: new Date().toISOString(),
        state,
        data: state === 'cleared' ? null : clone(data),
        checksum: checksum(state === 'cleared' ? null : data)
    });
    const defaultValue = (key) => {
        const entry = catalog.get(key);
        return entry && typeof entry.defaultValue === 'function' ? entry.defaultValue() : null;
    };
    class AppDataError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
            this.committed = false;
        }
    }
    class Kernel {
        async initialize() { this.state = 'ready'; this.backend = 'memory'; return this; }
        async read(key, options = {}) {
            const row = shared.docs.get(key) || null;
            const data = row && row.state !== 'cleared' ? row.data : defaultValue(key);
            return options.withMeta ? { data: clone(data), envelope: clone(row) } : clone(data);
        }
        async mutate(changes, options = {}) {
            const operationId = String(options.operationId || `document-${++shared.counter}`);
            for (const change of changes) {
                const current = shared.docs.get(change.logicalKey) || null;
                const currentRevision = Number(current && current.revision || 0);
                if (change.expectedRevision !== undefined && Number(change.expectedRevision) !== currentRevision) {
                    throw new AppDataError('CONFLICT', 'document revision conflict');
                }
                shared.docs.set(change.logicalKey, envelope(
                    change.logicalKey,
                    change.data,
                    change.state,
                    currentRevision + 1,
                    operationId
                ));
            }
            return { committed: true, operationId, revisions: {}, derived: { status: 'ready', pending: [] }, warnings: [] };
        }
        async journalNoop(options = {}) {
            return { committed: true, operationId: options.operationId || `noop-${++shared.counter}`, revisions: {}, derived: { status: 'ready', pending: [] }, warnings: [] };
        }
        async readEntity(store, recordId, options = {}) {
            const row = shared.entities.get(store).get(String(recordId)) || null;
            return options.withMeta ? clone(row) : row && clone(row.data);
        }
        async listEntities(store, options = {}) {
            if (store !== 'practiceSummaries') throw new AppDataError('VALIDATION', 'only practice summaries are listable');
            const rows = Array.from(shared.entities.get(store).values());
            return options.withMeta ? clone(rows) : rows.map((row) => clone(row.data));
        }
        async readPracticeSnapshot(recordIds = null, options = {}) {
            shared.snapshotReads += 1;
            const requested = recordIds === null || recordIds === undefined
                ? null
                : new Set((Array.isArray(recordIds) ? recordIds : [recordIds]).map(String));
            const stores = Array.isArray(options.stores) && options.stores.length
                ? options.stores
                : ['practiceSummaries', 'practiceDetails', 'practiceAnnotations'];
            const result = {};
            for (const store of stores) {
                const rows = Array.from(shared.entities.get(store).values())
                    .filter((row) => !requested || requested.has(String(row.recordId)));
                result[store] = options.withMeta ? clone(rows) : rows.map((row) => clone(row.data));
            }
            return result;
        }
        async mutateEntities(operations, options = {}) {
            const operationId = String(options.operationId || `entity-${++shared.counter}`);
            const next = new Map(Array.from(shared.entities, ([store, rows]) => [store, new Map(rows)]));
            for (const item of operations) {
                const rows = next.get(item.store);
                if (item.type === 'clear') {
                    rows.clear();
                    continue;
                }
                const id = String(item.recordId);
                const current = rows.get(id) || null;
                const currentRevision = Number(current && current.revision || 0);
                if (item.expectedRevision !== undefined && item.expectedRevision !== null
                    && Number(item.expectedRevision) !== currentRevision) {
                    throw new AppDataError('CONFLICT', `entity revision conflict: ${item.store}/${id}`);
                }
                if (item.type === 'delete') {
                    rows.delete(id);
                    continue;
                }
                rows.set(id, {
                    recordId: id,
                    revision: currentRevision + 1,
                    operationId,
                    updatedAt: new Date().toISOString(),
                    data: clone(item.data),
                    checksum: checksum(item.data)
                });
            }
            shared.entities = next;
            shared.mutations += 1;
            return { committed: true, operationId, revisions: {}, derived: { status: 'ready', pending: [] }, warnings: [] };
        }
        async exportSnapshot() {
            return {
                format: 'ielts-atlas-data-v2',
                schemaVersion: catalog.version,
                scope: 'full',
                envelopes: {},
                entities: Object.fromEntries(Array.from(shared.entities, ([store, rows]) => [store, Array.from(rows.values()).map(clone)]))
            };
        }
        async installSnapshot() { return { committed: true, operationId: 'install', revisions: {}, derived: { status: 'ready', pending: [] }, warnings: [] }; }
        onCommitted() { return () => {}; }
        status() { return { state: this.state, backend: this.backend, failure: null }; }
    }

    const internals = {
        DataKernel: Kernel,
        AppDataError,
        catalog,
        clone,
        checksum,
        randomId: (prefix) => `${prefix}-${++shared.counter}`,
        nowIso: () => new Date().toISOString(),
        makeEnvelope: (entry, data, options = {}) => envelope(entry.logicalKey, data, options.state, options.revision, options.operationId)
    };
    const sandbox = {
        console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
        Date, JSON, Math, Map, Set, Promise, structuredClone, Reflect,
        Object, Array, Number, String, Boolean, RegExp, Error, TypeError,
        __AppDataV2Internals: internals
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);
    vm.runInContext(source('js/data/practiceRecordSource.js'), context, { filename: 'practiceRecordSource.js' });
    vm.runInContext(source('js/data/v2/appData.js'), context, { filename: 'appData.js' });
    return {
        app: sandbox.AppData,
        shared,
        snapshot() {
            return {
                entities: Object.fromEntries(Array.from(shared.entities, ([store, rows]) => [store, Array.from(rows.values()).map(clone)]))
            };
        }
    };
}

function makeRecord(index, options = {}) {
    const prefix = options.prefix || 'stress';
    const highlights = Array.from({ length: options.highlightCount || 0 }, (_, highlightIndex) => ({
        id: `${prefix}-highlight-${index}-${highlightIndex}`,
        noteId: options.noteCount ? `${prefix}-note-${index}-${highlightIndex % options.noteCount}` : '',
        text: `highlight ${index}/${highlightIndex} ${'h'.repeat(48)}`,
        start: highlightIndex * 5,
        end: highlightIndex * 5 + 12
    }));
    const notes = Array.from({ length: options.noteCount || 0 }, (_, noteIndex) => ({
        id: `${prefix}-note-${index}-${noteIndex}`,
        body: `note ${index}/${noteIndex} ${'n'.repeat(64)}`,
        quote: `quote ${index}/${noteIndex}`
    }));
    const noteOutlines = Array.from({ length: options.outlineCount || 0 }, (_, outlineIndex) => ({
        id: `${prefix}-outline-${index}-${outlineIndex}`,
        title: `Outline ${index}/${outlineIndex}`,
        order: outlineIndex
    }));
    const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, index % 60)).toISOString();
    return {
        id: `${prefix}-record-${index}`,
        sessionId: `${prefix}-session-${index}`,
        examId: `${prefix}-exam-${index}`,
        title: `Stress record ${index}`,
        type: 'reading',
        date: timestamp,
        startTime: timestamp,
        endTime: timestamp,
        duration: 1800 + index,
        totalQuestions: 40,
        correctAnswers: 36,
        accuracy: 0.9,
        answers: { q1: 'A', q2: 'B' },
        correctAnswerMap: { q1: 'A', q2: 'C' },
        highlights,
        notes,
        noteOutlines,
        metadata: { examTitle: `Stress record ${index}`, category: 'P3', frequency: 'high', type: 'reading' }
    };
}

function verifyRecord(record, expected) {
    assert(record, 'record must exist after v2 persistence round-trip');
    assert.strictEqual(record.highlights.length, expected.highlights, `${record.id}: highlights changed`);
    assert.strictEqual(record.notes.length, expected.notes, `${record.id}: notes changed`);
    assert.strictEqual(record.noteOutlines.length, expected.outlines, `${record.id}: outlines changed`);
    if (expected.highlights && expected.notes) {
        assert.strictEqual(record.highlights[0].noteId, record.notes[0].id, `${record.id}: annotation link changed`);
    }
}

async function main() {
    const metrics = {};
    const harness = createHarness();
    await harness.app.ready;
    const concurrent = Array.from({ length: profile.concurrentRecords }, (_, index) => makeRecord(index, {
        prefix: 'concurrent', highlightCount: 12, noteCount: 6, outlineCount: 3
    }));
    let started = performance.now();
    await Promise.all(concurrent.map((record) => harness.app.practice.completeAttempt({
        operationId: `stress-concurrent-${record.id}`,
        record
    })));
    metrics.concurrentSaveMs = Math.round((performance.now() - started) * 100) / 100;
    const concurrentFull = await harness.app.practice.list({ projection: 'full' });
    assert.strictEqual(concurrentFull.length, concurrent.length, 'concurrent v2 saves lost records');
    concurrentFull.forEach((record) => verifyRecord(record, { highlights: 12, notes: 6, outlines: 3 }));

    const readsBeforeSnapshotCheck = harness.shared.snapshotReads;
    const snapshotChecked = await harness.app.practice.get('concurrent-record-0', { projection: 'full' });
    assert.strictEqual(harness.shared.snapshotReads, readsBeforeSnapshotCheck + 1, 'full get must use one projection snapshot');
    verifyRecord(snapshotChecked, { highlights: 12, notes: 6, outlines: 3 });
    const light = await harness.app.practice.list({ projection: 'light' });
    assert(light.every((record) => !Object.prototype.hasOwnProperty.call(record, 'highlights')), 'light projection leaked annotations');

    const heavy = Array.from({ length: profile.heavyRecords }, (_, index) => makeRecord(index, {
        prefix: 'heavy', highlightCount: profile.highlights, noteCount: profile.notes, outlineCount: profile.outlines
    }));
    started = performance.now();
    await Promise.all(heavy.map((record) => harness.app.practice.completeAttempt({
        operationId: `stress-heavy-${record.id}`,
        record
    })));
    metrics.heavySaveMs = Math.round((performance.now() - started) * 100) / 100;
    started = performance.now();
    const heavyFull = await harness.app.practice.list({ projection: 'full' });
    metrics.fullListMs = Math.round((performance.now() - started) * 100) / 100;
    assert.strictEqual(heavyFull.length, concurrent.length + heavy.length, 'full v2 list changed record count');
    heavyFull.filter((record) => record.id.startsWith('heavy-')).forEach((record) => verifyRecord(record, {
        highlights: profile.highlights, notes: profile.notes, outlines: profile.outlines
    }));

    await harness.app.practice.updateAnnotations({
        recordId: 'heavy-record-0',
        examId: 'heavy-exam-0',
        patch: { reviewed: true },
        operationId: 'stress-annotation-update'
    });
    const updated = await harness.app.practice.get('heavy-record-0', { projection: 'full' });
    assert.strictEqual(updated.reviewed, true, 'annotation update was not visible in full projection');

    await harness.app.practice.delete({ recordId: 'heavy-record-1', operationId: 'stress-delete' });
    const afterDelete = await harness.app.practice.list({ projection: 'full' });
    assert(afterDelete.every(Boolean), 'full list must not contain null rows after deletion');
    assert(!afterDelete.some((record) => record.id === 'heavy-record-1'), 'deleted record survived full list');

    const reloaded = createHarness(harness.snapshot());
    await reloaded.app.ready;
    const reloadedRecords = await reloaded.app.practice.list({ projection: 'full' });
    assert.strictEqual(reloadedRecords.length, afterDelete.length, 'reload changed v2 record count');
    metrics.serializedBytes = JSON.stringify(harness.snapshot()).length;

    const generousLimitMs = ciProfile ? 10000 : 30000;
    for (const [name, value] of Object.entries(metrics)) {
        if (name.endsWith('Ms')) assert(value < generousLimitMs, `${name} exceeded ${generousLimitMs}ms`);
    }
    process.stdout.write(JSON.stringify({
        status: 'pass',
        detail: {
            profile: ciProfile ? 'ci' : 'full',
            concurrentRecords: concurrent.length,
            heavyRecords: heavy.length,
            highlightsPerHeavyRecord: profile.highlights,
            notesPerHeavyRecord: profile.notes,
            outlinesPerHeavyRecord: profile.outlines,
            snapshotReads: harness.shared.snapshotReads,
            ...metrics
        }
    }));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
