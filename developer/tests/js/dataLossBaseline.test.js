#!/usr/bin/env node

// dataLossBaseline.test.js — anti-data-loss baselines for the IDB-only entity practice model.
// Uses a memory FakeKernel so baselines do not depend on real IndexedDB.

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { test } from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const catalogSource = fs.readFileSync(path.join(repoRoot, 'js/data/v2/dataCatalog.js'), 'utf8');
const appDataSource = fs.readFileSync(path.join(repoRoot, 'js/data/v2/appData.js'), 'utf8');
const practiceRecordSourceSource = fs.readFileSync(path.join(repoRoot, 'js/data/practiceRecordSource.js'), 'utf8');

function clone(value) {
    return value === undefined ? undefined : structuredClone(value);
}

function stable(value) {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function checksum(value) {
    const source = stable(value);
    let hash = 0x811c9dc5;
    for (let index = 0; index < source.length; index += 1) {
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

class AppDataError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.code = code;
        this.details = details;
        this.committed = false;
    }
}

function createHarness() {
    const catalogSandbox = { structuredClone };
    catalogSandbox.globalThis = catalogSandbox;
    vm.runInContext(catalogSource, vm.createContext(catalogSandbox), { filename: 'dataCatalog.js' });
    const catalog = catalogSandbox.__AppDataV2Catalog;

    let idCounter = 0;
    const shared = {
        docs: new Map(),
        entities: new Map([
            ['practiceSummaries', new Map()],
            ['practiceDetails', new Map()],
            ['practiceAnnotations', new Map()]
        ]),
        journal: new Map(),
        mutations: [],
        conflicts: new Map(),
        injectedMutateFailures: [],
        failEntityStore: null
    };

    function envelope(key, data, state = 'present', revision = 1, operationId = 'seed') {
        const payload = {
            schemaVersion: 2,
            revision,
            operationId,
            updatedAt: new Date().toISOString(),
            state,
            data: state === 'cleared' ? null : clone(data)
        };
        payload.checksum = checksum(payload.data);
        return payload;
    }

    class FakeKernel {
        constructor() {
            this.state = 'created';
            this.backend = 'memory-v2';
        }

        async initialize() {
            this.state = 'ready';
            return this;
        }

        async read(logicalKey, options = {}) {
            const entry = catalog.get(logicalKey);
            const value = shared.docs.get(logicalKey) || null;
            const data = !value || value.state === 'cleared' ? entry.defaultValue() : value.data;
            return options.withMeta ? { data: clone(data), envelope: clone(value) } : clone(data);
        }

        async mutate(changes, options = {}) {
            const operationId = String(options.operationId || `mutation-${++idCounter}`);
            const fingerprint = checksum({ changes, warnings: options.warnings || [] });
            if (shared.journal.has(operationId)) {
                const prior = shared.journal.get(operationId);
                if (prior.fingerprint !== fingerprint) throw new AppDataError('CONFLICT', `operationId conflict: ${operationId}`);
                return clone(prior.receipt);
            }
            const injected = shared.injectedMutateFailures.find((entry) => entry.match(operationId, changes));
            if (injected) {
                shared.injectedMutateFailures.splice(shared.injectedMutateFailures.indexOf(injected), 1);
                throw injected.error;
            }
            for (const change of changes) {
                const current = shared.docs.get(change.logicalKey);
                const actualRevision = current ? current.revision : 0;
                if (change.expectedRevision !== undefined && Number(change.expectedRevision) !== actualRevision) {
                    throw new AppDataError('CONFLICT', `Revision conflict for ${change.logicalKey}`, { actualRevision });
                }
                const failures = shared.conflicts.get(change.logicalKey) || 0;
                if (failures > 0) {
                    shared.conflicts.set(change.logicalKey, failures - 1);
                    throw new AppDataError('CONFLICT', `Injected conflict for ${change.logicalKey}`);
                }
            }
            const revisions = {};
            for (const change of changes) {
                const current = shared.docs.get(change.logicalKey);
                const revision = current ? current.revision + 1 : 1;
                revisions[change.logicalKey] = revision;
                shared.docs.set(change.logicalKey, envelope(change.logicalKey, change.data, change.state, revision, operationId));
            }
            const receipt = {
                committed: true,
                revisions,
                operationId,
                derived: { status: 'ready', pending: [] },
                warnings: []
            };
            if (Object.keys(revisions).length === 1) receipt.revision = revisions[Object.keys(revisions)[0]];
            shared.journal.set(operationId, { fingerprint, receipt: clone(receipt) });
            shared.mutations.push({ operationId, keys: changes.map((c) => c.logicalKey) });
            return clone(receipt);
        }

        async journalNoop(options = {}) {
            return {
                committed: true,
                operationId: options.operationId || `noop-${++idCounter}`,
                revisions: {},
                derived: { status: 'ready', pending: [] },
                warnings: []
            };
        }

        async readEntity(store, recordId, options = {}) {
            const row = shared.entities.get(store).get(String(recordId)) || null;
            return options.withMeta ? clone(row) : row && clone(row.data);
        }

        async listEntities(store, options = {}) {
            if (store !== 'practiceSummaries') throw new AppDataError('VALIDATION', 'details are not listable');
            const rows = Array.from(shared.entities.get(store).values());
            return options.withMeta ? clone(rows) : rows.map((row) => clone(row.data));
        }

        async readPracticeSnapshot(recordIds = null, options = {}) {
            const ids = recordIds == null ? null : new Set((Array.isArray(recordIds) ? recordIds : [recordIds]).map(String));
            const stores = options.stores || ['practiceSummaries', 'practiceDetails', 'practiceAnnotations'];
            return Object.fromEntries(stores.map((store) => [store, Array.from(shared.entities.get(store).values())
                .filter((row) => !ids || ids.has(String(row.recordId)))
                .map((row) => options.withMeta ? clone(row) : clone(row.data))]));
        }

        async mutateEntities(operations, options = {}) {
            const operationId = String(options.operationId || `entity-${++idCounter}`);
            const fingerprint = checksum({ operations, warnings: options.warnings || [] });
            if (shared.journal.has(operationId)) {
                const prior = shared.journal.get(operationId);
                if (prior.fingerprint !== fingerprint) throw new AppDataError('CONFLICT', `operationId conflict: ${operationId}`);
                return clone(prior.receipt);
            }
            for (const item of operations) {
                if (shared.failEntityStore === item.store) {
                    throw new AppDataError('IO', `forced entity failure: ${item.store}`);
                }
            }
            const revisions = {};
            const next = new Map(Array.from(shared.entities, ([store, rows]) => [store, new Map(rows)]));
            for (const item of operations) {
                const rows = next.get(item.store);
                if (item.type === 'clear') {
                    rows.clear();
                    revisions[`${item.store}/*`] = 0;
                    continue;
                }
                const old = rows.get(String(item.recordId));
                if (item.expectedRevision !== undefined && item.expectedRevision !== null
                    && Number(item.expectedRevision) !== Number(old && old.revision || 0)) {
                    throw new AppDataError('CONFLICT', 'entity revision');
                }
                if (item.type === 'delete') {
                    rows.delete(String(item.recordId));
                    revisions[`${item.store}/${item.recordId}`] = Number(old && old.revision || 0) + 1;
                } else {
                    const row = {
                        recordId: String(item.recordId),
                        revision: Number(old && old.revision || 0) + 1,
                        operationId,
                        updatedAt: new Date().toISOString(),
                        data: clone(item.data),
                        checksum: checksum(item.data)
                    };
                    rows.set(row.recordId, row);
                    revisions[`${item.store}/${item.recordId}`] = row.revision;
                }
            }
            shared.entities = next;
            const receipt = {
                committed: true,
                operationId,
                revisions,
                derived: { status: 'ready', pending: [] },
                warnings: []
            };
            shared.journal.set(operationId, { fingerprint, receipt: clone(receipt) });
            shared.mutations.push({ operationId, operations: clone(operations) });
            return clone(receipt);
        }

        async exportSnapshot(options = {}) {
            const selected = Array.isArray(options.logicalKeys) ? new Set(options.logicalKeys) : null;
            const selectedEntities = Array.isArray(options.entityStores) ? new Set(options.entityStores) : null;
            const envelopes = {};
            for (const [key, value] of shared.docs) {
                if (selected && !selected.has(key)) continue;
                if (catalog.get(key).export === true) envelopes[key] = clone(value);
            }
            const entities = {};
            for (const [store, rows] of shared.entities) {
                if (selectedEntities && !selectedEntities.has(store)) continue;
                entities[store] = Array.from(rows.values()).map(clone);
            }
            const snapshot = {
                format: 'ielts-atlas-data-v2',
                schemaVersion: 2,
                scope: selected ? 'partial' : 'full',
                envelopes,
                entities
            };
            snapshot.checksum = checksum({ envelopes, entities });
            return snapshot;
        }

        async installSnapshot(snapshot, options = {}) {
            if (snapshot.checksum !== checksum({ envelopes: snapshot.envelopes, entities: snapshot.entities })) {
                throw new AppDataError('VALIDATION', 'snapshot checksum');
            }
            for (const [key, value] of Object.entries(snapshot.envelopes || {})) {
                shared.docs.set(key, clone(value));
            }
            for (const [store, rows] of Object.entries(snapshot.entities || {})) {
                shared.entities.set(store, new Map(rows.map((row) => [String(row.recordId), clone(row)])));
            }
            return {
                committed: true,
                operationId: options.operationId || `install-${++idCounter}`,
                revisions: {},
                derived: { status: 'ready', pending: [] },
                warnings: []
            };
        }

        onCommitted() { return () => {}; }
        status() { return { state: this.state, backend: this.backend, failure: null }; }
    }

    const internals = {
        DataKernel: FakeKernel,
        AppDataError,
        catalog,
        clone,
        checksum,
        randomId: (prefix) => `${prefix}-${++idCounter}`,
        nowIso: () => new Date().toISOString(),
        makeEnvelope: (entry, data, options = {}) => envelope(entry.logicalKey, data, options.state, options.revision, options.operationId),
        validateEnvelope: (_entry, value) => Boolean(value && value.schemaVersion === 2 && value.checksum === checksum(value.data))
    };

    const sandbox = {
        console,
        Date,
        JSON,
        Math,
        Map,
        Set,
        Promise,
        structuredClone,
        __AppDataV2Internals: internals,
        sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);
    vm.runInContext(practiceRecordSourceSource, context, { filename: 'practiceRecordSource.js' });
    vm.runInContext(appDataSource, context, { filename: 'appData.js' });

    return { app: sandbox.AppData, shared };
}

async function expectCode(promise, code) {
    await assert.rejects(promise, (error) => {
        assert.strictEqual(error.code, code);
        return true;
    });
}

test('baseline 1: failed document write leaves previous value readable', async () => {
    const harness = createHarness();
    const app = harness.app;
    await app.ready;
    await app.settings.patch({ theme: 'keep-me' }, { operationId: 'seed-settings' });
    harness.shared.injectedMutateFailures.push({
        match: (operationId) => operationId === 'fail-write',
        error: new AppDataError('IO', 'forced write failure')
    });
    await expectCode(app.settings.patch({ theme: 'lost' }, { operationId: 'fail-write' }), 'IO');
    assert.deepStrictEqual(await app.settings.getAll(), { theme: 'keep-me' });
});

test('baseline 2: entity write failure does not partially create practice layers', async () => {
    const harness = createHarness();
    const app = harness.app;
    await app.ready;
    harness.shared.failEntityStore = 'practiceDetails';
    await expectCode(app.practice.completeAttempt({
        operationId: 'partial-fail',
        record: { id: 'r-fail', type: 'reading', answers: { 1: 'A' } }
    }), 'IO');
    assert.strictEqual(harness.shared.entities.get('practiceSummaries').has('r-fail'), false);
    assert.strictEqual(harness.shared.entities.get('practiceDetails').has('r-fail'), false);
    assert.strictEqual(harness.shared.entities.get('practiceAnnotations').has('r-fail'), false);
});

test('baseline 3: clear removes all practice entity layers', async () => {
    const harness = createHarness();
    const app = harness.app;
    await app.ready;
    await app.practice.completeAttempt({
        operationId: 'seed-clear',
        record: { id: 'r1', type: 'reading', answers: { 1: 'A' }, notes: { q1: 'n' } }
    });
    await app.practice.clear({ operationId: 'clear-all' });
    assert.strictEqual(harness.shared.entities.get('practiceSummaries').size, 0);
    assert.strictEqual(harness.shared.entities.get('practiceDetails').size, 0);
    assert.strictEqual(harness.shared.entities.get('practiceAnnotations').size, 0);
    assert.strictEqual((await app.practice.list()).length, 0);
});

test('baseline 4: backup restore recovers practice entities after delete', async () => {
    const harness = createHarness();
    const app = harness.app;
    await app.ready;
    await app.practice.completeAttempt({
        operationId: 'seed-backup',
        record: { id: 'rec-1', examId: 'reading-1', type: 'reading', answers: { 1: 'A' } }
    });
    await app.backups.create({ id: 'manual-backup-a', operationId: 'manual-backup-create-a' });
    await app.practice.delete('rec-1', { operationId: 'practice-delete-1' });
    assert.strictEqual((await app.practice.list()).length, 0);
    const backups = await app.backups.list();
    assert.ok(backups.some((item) => item.id === 'manual-backup-a'));
    await app.backups.restore('manual-backup-a', { operationId: 'restore-a' });
    assert.ok((await app.practice.list()).some((item) => item.id === 'rec-1'));
    assert.strictEqual((await app.practice.get('rec-1')).answers[1], 'A');
});

test('baseline 5: light projection excludes full-only fields', async () => {
    const harness = createHarness();
    const app = harness.app;
    await app.ready;
    await app.practice.completeAttempt({
        operationId: 'seed-light',
        record: {
            id: 'light-1',
            type: 'reading',
            title: 'Light',
            answers: { 1: 'A' },
            answerDetails: 'huge detail',
            notes: { q1: 'note' },
            highlights: [{ text: 'h' }],
            metadata: { examId: 'e1', libraryConfigurationId: 'lib-1', privatePayload: 'secret' }
        }
    });
    const light = (await app.practice.list({ projection: 'light' }))[0];
    assert.strictEqual(light.id, 'light-1');
    assert.ok(!Object.prototype.hasOwnProperty.call(light, 'answers'));
    assert.ok(!Object.prototype.hasOwnProperty.call(light, 'answerDetails'));
    assert.ok(!Object.prototype.hasOwnProperty.call(light, 'notes'));
    assert.ok(!Object.prototype.hasOwnProperty.call(light, 'highlights'));
    assert.ok(!Object.prototype.hasOwnProperty.call(light.metadata, 'privatePayload'));
    assert.strictEqual(light.metadata.libraryConfigurationId, 'lib-1');
});

test('baseline 6: read returns are clones', async () => {
    const harness = createHarness();
    const app = harness.app;
    await app.ready;
    await app.settings.patch({ theme: 'clone-me' }, { operationId: 'seed-clone' });
    const first = await app.settings.getAll();
    first.theme = 'mutated';
    assert.deepStrictEqual(await app.settings.getAll(), { theme: 'clone-me' });
});

test('baseline 7: concurrent CAS surfaces CONFLICT', async () => {
    const harness = createHarness();
    const app = harness.app;
    await app.ready;
    await app.settings.patch({ theme: 'first' }, { operationId: 'cas-1' });
    const baselineRevision = harness.shared.docs.get('settings.values').revision;
    await app.settings.patch({ theme: 'second' }, { operationId: 'cas-2', expectedRevision: baselineRevision });
    await expectCode(
        app.settings.patch({ theme: 'third' }, { operationId: 'cas-late', expectedRevision: baselineRevision }),
        'CONFLICT'
    );
    assert.deepStrictEqual(await app.settings.getAll(), { theme: 'second' });
});

test('baseline 8: failed delete does not drop other layers', async () => {
    const harness = createHarness();
    const app = harness.app;
    await app.ready;
    await app.practice.completeAttempt({
        operationId: 'seed-delete',
        record: { id: 'keep-me', type: 'reading', answers: { 1: 'A' }, notes: { q1: 'n' } }
    });
    harness.shared.failEntityStore = 'practiceDetails';
    await expectCode(app.practice.delete('keep-me', { operationId: 'delete-fail' }), 'IO');
    assert.strictEqual(harness.shared.entities.get('practiceSummaries').has('keep-me'), true);
    assert.strictEqual(harness.shared.entities.get('practiceDetails').has('keep-me'), true);
    assert.strictEqual(harness.shared.entities.get('practiceAnnotations').has('keep-me'), true);
});

test('baseline 9: fault injection can force one conflict then recover', async () => {
    const harness = createHarness();
    const app = harness.app;
    await app.ready;
    await app.settings.patch({ theme: 'baseline-9' }, { operationId: 'baseline-9-seed' });
    harness.shared.conflicts.set('settings.values', 1);
    const retried = await app.settings.patch({ theme: 'retry' }, { operationId: 'baseline-9-conflict' });
    assert.equal(retried.committed, true);
    assert.deepStrictEqual(await app.settings.getAll(), { theme: 'retry' });
});

test('baseline 10: export/import checksum and entity round-trip', async () => {
    const harness = createHarness();
    const app = harness.app;
    await app.ready;
    await app.practice.completeAttempt({
        operationId: 'seed-export',
        record: { id: 'rec-a', examId: 'reading-1', type: 'reading', totalQuestions: 4, correctAnswers: 2, answers: { 1: 'A' } }
    });
    await app.settings.patch({ theme: 'dark' }, { operationId: 'seed-export-settings' });
    const snapshot = await app.backups.export();
    assert.strictEqual(snapshot.format, 'ielts-atlas-data-v2');
    assert.strictEqual(Number(snapshot.schemaVersion), 2);
    assert.ok(snapshot.entities.practiceSummaries.some((row) => row.recordId === 'rec-a'));
    assert.ok(snapshot.envelopes['settings.values']);

    const corrupted = clone(snapshot);
    corrupted.checksum = 'fnv1a-deadbeef';
    await expectCode(app.backups.previewImport(corrupted), 'VALIDATION');

    await app.practice.clear({ operationId: 'clear-before-import' });
    const preview = await app.backups.previewImport(snapshot, { replace: true });
    const receipt = await app.backups.commitImport(preview.id, { operationId: 'baseline-10-import' });
    assert.strictEqual(receipt.committed, true);
    assert.strictEqual((await app.practice.get('rec-a')).answers[1], 'A');
    assert.deepStrictEqual(await app.settings.getAll(), { theme: 'dark' });
});
