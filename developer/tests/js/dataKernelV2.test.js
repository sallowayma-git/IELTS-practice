#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const catalogSource = fs.readFileSync(path.join(repoRoot, 'js/data/v2/dataCatalog.js'), 'utf8');
const kernelSource = fs.readFileSync(path.join(repoRoot, 'js/data/v2/dataKernel.js'), 'utf8');
const recordSource = fs.readFileSync(path.join(repoRoot, 'js/data/practiceRecordSource.js'), 'utf8');
const appDataSource = fs.readFileSync(path.join(repoRoot, 'js/data/v2/appData.js'), 'utf8');

function withTimeout(promise, label, timeoutMs = 15000) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs); })])
        .finally(() => clearTimeout(timer));
}
async function origin() {
    const server = http.createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        response.end('<!doctype html><meta charset="utf-8">');
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return { server, url: `http://127.0.0.1:${server.address().port}/` };
}
function launchOptions() {
    const candidates = [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    ];
    const executablePath = candidates.find((candidate) => fs.existsSync(candidate));
    return executablePath ? { headless: true, executablePath } : { headless: true };
}
async function loadAppData(page) {
    await page.addScriptTag({ content: catalogSource });
    await page.addScriptTag({ content: kernelSource });
    await page.addScriptTag({ content: recordSource });
    await page.addScriptTag({ content: appDataSource });
    await page.evaluate(async () => window.AppData.ready);
}
async function persistedBusinessState(page) {
    return page.evaluate(() => new Promise((resolve, reject) => {
        const request = indexedDB.open('IELTSAtlasDataV2');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const db = request.result;
            const stores = ['documents', 'practiceSummaries', 'practiceDetails', 'practiceAnnotations'];
            const tx = db.transaction(stores, 'readonly');
            const reads = Object.fromEntries(stores.map((store) => [store, tx.objectStore(store).getAll()]));
            tx.onerror = () => { db.close(); reject(tx.error); };
            tx.onabort = () => { db.close(); reject(tx.error || new Error('business state read aborted')); };
            tx.oncomplete = () => {
                const result = {};
                for (const [store, read] of Object.entries(reads)) {
                    result[store] = Object.fromEntries(read.result.map((row) => [
                        row.logicalKey || row.recordId,
                        { revision: row.revision, checksum: row.checksum }
                    ]));
                }
                db.close();
                resolve(result);
            };
        };
    }));
}

class FakeObjectStoreNames {
    constructor(state) { this.state = state; }
    contains(name) { return this.state.stores.has(String(name)); }
    item(index) { return Array.from(this.state.stores.keys())[index] || null; }
    get length() { return this.state.stores.size; }
    [Symbol.iterator]() { return this.state.stores.keys(); }
}

class FakeTransaction {
    constructor(db, names, mode) {
        this.db = db;
        this.names = names.map(String);
        this.mode = mode;
        this.pending = 0;
        this.aborted = false;
        this.completed = false;
        this.error = null;
        this.oncomplete = null;
        this.onerror = null;
        this.onabort = null;
    }
    objectStore(name) {
        const storeName = String(name);
        if (!this.names.includes(storeName)) throw new Error(`Store not in transaction: ${storeName}`);
        const state = this.db.state.stores.get(storeName);
        if (!state) throw new Error(`Unknown fake object store: ${storeName}`);
        return new FakeObjectStore(this, storeName, state);
    }
    request(operation) {
        const request = { result: undefined, error: null, onsuccess: null, onerror: null };
        this.pending += 1;
        queueMicrotask(() => {
            if (this.aborted) { this.pending -= 1; return; }
            try {
                request.result = operation();
                if (typeof request.onsuccess === 'function') request.onsuccess({ target: request });
            } catch (error) {
                request.error = error;
                if (typeof request.onerror === 'function') request.onerror({ target: request });
                this.abort(error);
            } finally {
                this.pending -= 1;
                this.finishIfIdle();
            }
        });
        return request;
    }
    finishIfIdle() {
        if (this.pending || this.aborted || this.completed) return;
        this.completed = true;
        queueMicrotask(() => { if (!this.aborted && typeof this.oncomplete === 'function') this.oncomplete({ target: this }); });
    }
    abort(error = null) {
        if (this.aborted || this.completed) return;
        this.aborted = true;
        this.error = error || this.error || new Error('fake transaction aborted');
        queueMicrotask(() => { if (typeof this.onabort === 'function') this.onabort({ target: this }); });
    }
}

class FakeObjectStore {
    constructor(transaction, name, state) { this.transaction = transaction; this.name = name; this.state = state; }
    get(key) { return this.transaction.request(() => cloneFake(this.state.rows.get(String(key)))); }
    getAll() { return this.transaction.request(() => Array.from(this.state.rows.values(), cloneFake)); }
    put(value) {
        return this.transaction.request(() => {
            const key = value && value[this.state.keyPath];
            if (key === undefined || key === null) throw new Error(`Missing fake keyPath: ${this.state.keyPath}`);
            this.state.rows.set(String(key), cloneFake(value));
            return value;
        });
    }
    delete(key) { return this.transaction.request(() => { this.state.rows.delete(String(key)); return undefined; }); }
    clear() { return this.transaction.request(() => { this.state.rows.clear(); return undefined; }); }
}

class FakeDatabase {
    constructor(state) { this.state = state; this.objectStoreNames = new FakeObjectStoreNames(state); this.onversionchange = null; }
    createObjectStore(name, options = {}) {
        const storeName = String(name);
        if (!this.state.stores.has(storeName)) this.state.stores.set(storeName, { keyPath: options.keyPath || 'id', rows: new Map() });
        return { name: storeName };
    }
    deleteObjectStore(name) { this.state.stores.delete(String(name)); }
    transaction(names, mode) { return new FakeTransaction(this, Array.isArray(names) ? names : [names], mode); }
    close() {}
}

class FakeIndexedDB {
    constructor() { this.databases = new Map(); }
    open(name, requestedVersion = 1) {
        const request = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
        queueMicrotask(() => {
            try {
                const databaseName = String(name);
                const version = Number(requestedVersion) || 1;
                let state = this.databases.get(databaseName);
                const oldVersion = state ? state.version : 0;
                if (!state) {
                    state = { version, stores: new Map() };
                    this.databases.set(databaseName, state);
                }
                request.result = new FakeDatabase(state);
                if (version > oldVersion) {
                    state.version = version;
                    if (typeof request.onupgradeneeded === 'function') request.onupgradeneeded({ oldVersion, newVersion: version, target: request });
                }
                request.result = new FakeDatabase(state);
                if (typeof request.onsuccess === 'function') request.onsuccess({ target: request });
            } catch (error) {
                request.error = error;
                if (typeof request.onerror === 'function') request.onerror({ target: request });
            }
        });
        return request;
    }
    seed(storeName, row) {
        const state = this.databases.get('IELTSAtlasDataV2');
        if (!state || !state.stores.has(storeName)) throw new Error(`Cannot seed fake store: ${storeName}`);
        state.stores.get(storeName).rows.set(String(row.recordId || row.logicalKey), cloneFake(row));
    }
}

function cloneFake(value) { return value === undefined ? undefined : structuredClone(value); }

async function runSnapshotIntegrityUnitTest() {
    const indexedDB = new FakeIndexedDB();
    // Leave structuredClone unavailable in this VM so DataCatalog's JSON fallback
    // returns objects owned by the VM realm, just like a browser's same-realm IDB.
    const sandbox = { console, Date, Math, Map, Set, Promise, setTimeout, clearTimeout, queueMicrotask, indexedDB };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);
    vm.runInContext(catalogSource, context, { filename: 'dataCatalog.js' });
    vm.runInContext(kernelSource, context, { filename: 'dataKernel.js' });
    const { DataKernel } = sandbox.__AppDataV2Internals;
    const kernel = new DataKernel({ indexedDB });
    await kernel.initialize();
    indexedDB.seed('practiceSummaries', {
        recordId: 'corrupt-export-row',
        revision: 1,
        operationId: 'corrupt-export-seed',
        updatedAt: '2026-08-09T00:00:00.000Z',
        data: { id: 'corrupt-export-row', type: 'reading' },
        checksum: 'fnv1a-forged-row'
    });

    let snapshot = null;
    let error = null;
    try { snapshot = await kernel.exportSnapshot(); } catch (caught) { error = caught; }
    assert.strictEqual(snapshot, null, 'a corrupt IndexedDB row must not produce a successful snapshot');
    assert(error, 'DataKernel.exportSnapshot must reject a corrupt IndexedDB row');
    assert.strictEqual(error.code, 'CORRUPT_RECORD', `${error.code}: ${error.message}`);
    kernel.close();
    console.log('DataKernel export corruption regression test passed');
}

async function main() {
    const { server, url } = await origin();
    let browser;
    try {
        browser = await withTimeout(chromium.launch(launchOptions()), 'launch');
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(url);
        await page.evaluate(() => new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase('IELTSAtlasDataV2');
            request.onsuccess = resolve; request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('database reset blocked'));
        }));
        await page.evaluate(() => new Promise((resolve, reject) => {
            const request = indexedDB.open('IELTSAtlasDataV2', 1);
            request.onupgradeneeded = () => {
                for (const store of ['authoritative', 'derived', 'system']) request.result.createObjectStore(store, { keyPath: 'logicalKey' });
            };
            request.onsuccess = () => { request.result.close(); resolve(); };
            request.onerror = () => reject(request.error);
        }));
        await page.evaluate(() => new Promise((resolve, reject) => {
            const remove = indexedDB.deleteDatabase('ExamSystemDB');
            remove.onerror = () => reject(remove.error);
            remove.onblocked = () => reject(new Error('legacy database reset blocked'));
            remove.onsuccess = () => {
                const request = indexedDB.open('ExamSystemDB', 1);
                request.onupgradeneeded = () => request.result.createObjectStore('keyValueStore', { keyPath: 'key' });
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const db = request.result;
                    const tx = db.transaction('keyValueStore', 'readwrite');
                    const store = tx.objectStore('keyValueStore');
                    const stored = (data, timestamp = Date.now()) => JSON.stringify({ data, timestamp, version: '1.0.0', compressed: false });
                    [
                        ['exam_system_practice_records', stored([{ id: 'legacy-idb-record', correctAnswers: 1 }])],
                        ['exam_system_settings', stored({ theme: 'light', notifications: true }, 100)],
                        ['exam_system_exam_index_configurations', stored([{ id: 'exam_index_1700000000000', key: 'exam_index_1700000000000' }])],
                        ['exam_system_active_exam_index_key', stored('exam_index_1700000000000')],
                        ['exam_system_exam_index_1700000000000', stored([{ id: 'legacy-custom-exam', type: 'reading' }])]
                    ].forEach(([key, value]) => store.put({ key, value, timestamp: key === 'exam_system_settings' ? 100 : Date.now() }));
                    tx.oncomplete = () => { db.close(); resolve(); };
                    tx.onerror = () => reject(tx.error);
                    tx.onabort = () => reject(tx.error || new Error('legacy seed aborted'));
                };
            };
        }));
        await page.evaluate(() => {
            localStorage.setItem('practice_records', JSON.stringify([{ id: 'legacy-web-record', correctAnswers: 0 }]));
            localStorage.setItem('vocab_user_config', JSON.stringify({ dailyNew: 12 }));
            localStorage.setItem('user_achievements', JSON.stringify({ first_practice: { unlockedAt: '2026-01-01T00:00:00.000Z' } }));
            localStorage.setItem('theme', 'legacy-unprefixed-theme-must-be-rejected');
            localStorage.setItem('exam_system_settings', JSON.stringify({ data: { theme: 'dark', notifications: true, source: 'local-newer' }, timestamp: 200, version: '1.0.0', compressed: false }));
            sessionStorage.setItem('exam_system_settings', '{malformed-newer-candidate');
        });
        await page.addScriptTag({ content: catalogSource });
        await page.addScriptTag({ content: kernelSource });
        const result = await page.evaluate(async () => {
            const { DataKernel, readLegacyValues, readLegacyExternalBackup } = window.__AppDataV2Internals;
            const legacyValues = await readLegacyValues();
            const webOnlyLegacyValues = await readLegacyValues(null, localStorage, sessionStorage);
            const externalReadCalls = [];
            const externalPayload = { practice_records: [{ id: 'legacy-external-record' }] };
            const legacyDirectory = {
                async queryPermission(options) {
                    externalReadCalls.push(`permission:${options.mode}`);
                    return 'granted';
                },
                async getFileHandle(filename, options) {
                    externalReadCalls.push(`file:${filename}:${options.create}`);
                    return { async getFile() { return { async text() { return JSON.stringify({ data: externalPayload }); } }; } };
                }
            };
            const fakeLegacyIndexedDb = (directoryHandle) => ({
                open(name) {
                    externalReadCalls.push(`open:${name}`);
                    const request = {};
                    queueMicrotask(() => {
                        request.result = {
                            objectStoreNames: { contains(storeName) { return storeName === 'handles'; } },
                            transaction() {
                                return { objectStore() { return { get(key) {
                                    externalReadCalls.push(`get:${key}`);
                                    const getRequest = {};
                                    queueMicrotask(() => { getRequest.result = directoryHandle; getRequest.onsuccess(); });
                                    return getRequest;
                                } }; } };
                            },
                            close() { externalReadCalls.push('close'); }
                        };
                        request.onsuccess();
                    });
                    return request;
                }
            });
            const externalBackup = await readLegacyExternalBackup(fakeLegacyIndexedDb(legacyDirectory));
            let promptFileRead = false;
            const promptBackup = await readLegacyExternalBackup(fakeLegacyIndexedDb({
                async queryPermission() { return 'prompt'; },
                async getFileHandle() { promptFileRead = true; }
            }));
            const unavailable = new DataKernel({ indexedDB: null });
            let unavailableCode = null;
            try { await unavailable.initialize(); } catch (error) { unavailableCode = error.code; }

            const kernel = new DataKernel();
            await kernel.initialize();
            const remoteKernel = new DataKernel();
            await remoteKernel.initialize();
            const stores = Array.from(kernel.driver.db.objectStoreNames);
            const remoteCommitPromise = new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('cross-realm commit notification timed out')), 3000);
                const unsubscribe = remoteKernel.onCommitted((event) => {
                    if (event.operationId !== 'cross-realm-commit') return;
                    clearTimeout(timer);
                    unsubscribe();
                    resolve(event);
                });
            });
            await kernel.mutate([{ logicalKey: 'settings.values', data: { remote: true }, expectedRevision: 0 }], {
                operationId: 'cross-realm-commit'
            });
            const remoteCommit = await remoteCommitPromise;
            const first = await kernel.mutate([{ logicalKey: 'preferences.values', data: { theme: 'dark' }, expectedRevision: 0 }], { operationId: 'document-1' });
            const retry = await kernel.mutate([{ logicalKey: 'preferences.values', data: { theme: 'dark' }, expectedRevision: 0 }], { operationId: 'document-1' });
            let conflict = null;
            try { await kernel.mutate([{ logicalKey: 'preferences.values', data: { theme: 'light' }, expectedRevision: 1 }], { operationId: 'document-1' }); } catch (error) { conflict = error.code; }
            const intent = { command: 'settings-patch', payload: { theme: 'intent-dark' } };
            const intentFirst = await kernel.mutate([{
                logicalKey: 'achievements.progress', data: { theme: 'intent-dark' }, expectedRevision: 0
            }], { operationId: 'intent-retry', intent });
            const intentRetry = await kernel.mutate([{
                logicalKey: 'achievements.progress', data: { theme: 'intent-dark' }, expectedRevision: 1
            }], { operationId: 'intent-retry', intent });
            const intentState = await kernel.read('achievements.progress', { withMeta: true });
            let changedIntentCode = null;
            try {
                await kernel.mutate([{
                    logicalKey: 'achievements.progress', data: { theme: 'different' }, expectedRevision: 1
                }], {
                    operationId: 'intent-retry',
                    intent: { command: 'settings-patch', payload: { theme: 'different' } }
                });
            } catch (error) { changedIntentCode = error.code; }
            const sparseWords = [];
            sparseWords.length = 1;
            let sparseCode = null;
            try {
                await kernel.mutate([{
                    logicalKey: 'vocab.words', data: sparseWords, expectedRevision: 0
                }], { operationId: 'sparse-array' });
            } catch (error) { sparseCode = error.code; }

            const entities = await kernel.mutateEntities([
                { type: 'upsert', store: 'practiceSummaries', recordId: 'r1', data: { id: 'r1', title: 'Reading', score: 7 }, expectedRevision: 0 },
                { type: 'upsert', store: 'practiceDetails', recordId: 'r1', data: { recordId: 'r1', answers: ['A'], correctAnswers: ['B'] }, expectedRevision: 0 },
                { type: 'upsert', store: 'practiceAnnotations', recordId: 'r1', data: { recordId: 'r1', notes: ['review'] }, expectedRevision: 0 }
            ], { operationId: 'entity-1' });
            const entityRetry = await kernel.mutateEntities([
                { type: 'upsert', store: 'practiceSummaries', recordId: 'r1', data: { id: 'r1', title: 'Reading', score: 7 }, expectedRevision: 0 },
                { type: 'upsert', store: 'practiceDetails', recordId: 'r1', data: { recordId: 'r1', answers: ['A'], correctAnswers: ['B'] }, expectedRevision: 0 },
                { type: 'upsert', store: 'practiceAnnotations', recordId: 'r1', data: { recordId: 'r1', notes: ['review'] }, expectedRevision: 0 }
            ], { operationId: 'entity-1' });
            const practiceProjection = await kernel.readPracticeSnapshot(['r1']);
            let detailsListCode = null;
            try { await kernel.listEntities('practiceDetails'); } catch (error) { detailsListCode = error.code; }
            const snapshot = await kernel.exportSnapshot({ includeSystem: true });
            const ghostSnapshot = structuredClone(snapshot);
            ghostSnapshot.entities.practiceSummaries[0].data.id = 'payload-id-does-not-match';
            ghostSnapshot.entities.practiceSummaries[0].checksum = window.__AppDataV2Internals.checksum(
                ghostSnapshot.entities.practiceSummaries[0].data
            );
            ghostSnapshot.checksum = window.__AppDataV2Internals.checksum({
                envelopes: ghostSnapshot.envelopes,
                entities: ghostSnapshot.entities
            });
            let ghostSnapshotCode = null;
            try { await kernel.installSnapshot(ghostSnapshot, { operationId: 'ghost-snapshot' }); }
            catch (error) { ghostSnapshotCode = error.code; }
            const settingsBeforeImport = await kernel.read('settings.values', { withMeta: true });
            const practiceBeforeImport = await kernel.readPracticeSnapshot(null, { withMeta: true });
            const expectedRevisionToken = {
                documents: {
                    'settings.values': settingsBeforeImport.envelope.revision
                },
                entities: Object.fromEntries(Object.entries(practiceBeforeImport).map(([store, rows]) => [
                    store,
                    Object.fromEntries(rows.map((row) => [row.recordId, row.revision]))
                ]))
            };
            await kernel.mutateEntities([{
                type: 'upsert', store: 'practiceSummaries', recordId: 'late-import-row',
                data: { id: 'late-import-row', title: 'created while import was waiting' }, expectedRevision: 0
            }], { operationId: 'late-import-row' });
            let staleImportCode = null;
            try {
                await kernel.installSnapshot(snapshot, { operationId: 'stale-import', expectedRevisionToken });
            } catch (error) { staleImportCode = error.code; }
            const lateImportRow = await kernel.readEntity('practiceSummaries', 'late-import-row');
            const epochSnapshot = await kernel.exportSnapshot();
            const epochPractice = await kernel.readPracticeSnapshot(null, { withMeta: true });
            const epochToken = {
                documents: {},
                entities: Object.fromEntries(Object.entries(epochPractice).map(([store, rows]) => [
                    store,
                    Object.fromEntries(rows.map((row) => [row.recordId, row.revision]))
                ])),
                entityEpochs: await kernel.getEntityRevisionEpochs()
            };
            await kernel.mutateEntities([{
                type: 'upsert', store: 'practiceSummaries', recordId: 'epoch-transient',
                data: { id: 'epoch-transient', title: 'transient' }, expectedRevision: 0
            }], { operationId: 'epoch-transient-create' });
            await kernel.mutateEntities([{
                type: 'delete', store: 'practiceSummaries', recordId: 'epoch-transient', expectedRevision: 1
            }], { operationId: 'epoch-transient-delete' });
            let staleEpochCode = null;
            try {
                await kernel.installSnapshot(epochSnapshot, {
                    operationId: 'stale-epoch-import',
                    expectedRevisionToken: epochToken
                });
            } catch (error) { staleEpochCode = error.code; }
            await kernel.mutateEntities([{
                type: 'upsert', store: 'practiceSummaries', recordId: 'recreate-after-delete',
                data: { id: 'recreate-after-delete', title: 'first incarnation' }, expectedRevision: 0
            }], { operationId: 'recreate-first' });
            await kernel.mutateEntities([{
                type: 'delete', store: 'practiceSummaries', recordId: 'recreate-after-delete', expectedRevision: 1
            }], { operationId: 'recreate-delete' });
            const deletedRevision = await kernel.getEntityRevision('practiceSummaries', 'recreate-after-delete');
            let sidecarWriteCode = null;
            try {
                await kernel.mutate([{
                    logicalKey: 'system.entityRevisions', data: {}, expectedRevision: 1
                }], { operationId: 'sidecar-write-must-fail' });
            } catch (error) { sidecarWriteCode = error.code; }
            const deletedRevisionAfterRejectedSidecarWrite = await kernel.getEntityRevision(
                'practiceSummaries', 'recreate-after-delete'
            );
            const recreated = await kernel.mutateEntities([{
                type: 'upsert', store: 'practiceSummaries', recordId: 'recreate-after-delete',
                data: { id: 'recreate-after-delete', title: 'second incarnation' }, expectedRevision: deletedRevision
            }], { operationId: 'recreate-second' });
            await kernel.mutateEntities([{
                type: 'upsert', store: 'practiceSummaries', recordId: 'snapshot-tombstone',
                data: { id: 'snapshot-tombstone', title: 'must remain deleted' }, expectedRevision: 0
            }], { operationId: 'snapshot-tombstone-create' });
            await kernel.mutateEntities([{
                type: 'delete', store: 'practiceSummaries', recordId: 'snapshot-tombstone', expectedRevision: 1
            }], { operationId: 'snapshot-tombstone-delete' });
            const snapshotTombstoneBeforeRestore = await kernel.getEntityRevision(
                'practiceSummaries', 'snapshot-tombstone'
            );
            const invalidRevisionSnapshot = structuredClone(snapshot);
            invalidRevisionSnapshot.entities.practiceDetails[0].revision = -1;
            invalidRevisionSnapshot.checksum = window.__AppDataV2Internals.checksum({
                envelopes: invalidRevisionSnapshot.envelopes,
                entities: invalidRevisionSnapshot.entities
            });
            let invalidRevisionCode = null;
            try { await kernel.installSnapshot(invalidRevisionSnapshot, { operationId: 'invalid-revision' }); } catch (error) { invalidRevisionCode = error.code; }
            const upperBoundRawBefore = await kernel.driver.exportSnapshot(() => true);
            const upperBoundBefore = await kernel.exportSnapshot({ includeSystem: true });
            const upperBoundSnapshot = structuredClone(upperBoundBefore);
            upperBoundSnapshot.entities.practiceSummaries[0].revision = Number.MAX_SAFE_INTEGER - 1;
            upperBoundSnapshot.checksum = window.__AppDataV2Internals.checksum({
                envelopes: upperBoundSnapshot.envelopes,
                entities: upperBoundSnapshot.entities
            });
            let upperBoundRevisionCode = null;
            try {
                await kernel.installSnapshot(upperBoundSnapshot, { operationId: 'upper-bound-revision' });
            } catch (error) { upperBoundRevisionCode = error.code; }
            const upperBoundRawAfter = await kernel.driver.exportSnapshot(() => true);
            const exportableKeys = window.__AppDataV2Catalog.list()
                .filter((entry) => entry.export === true)
                .map((entry) => entry.logicalKey)
                .sort();
            await kernel.mutateEntities([{ type: 'clear', store: 'practiceSummaries' }], { operationId: 'clear-summary' });
            await kernel.installSnapshot(snapshot, { operationId: 'restore-1', resetJournal: true });
            const restored = await kernel.readEntity('practiceSummaries', 'r1', { withMeta: true });
            const journal = await kernel.read('system.operationJournal');
            const snapshotTombstoneAfterRestore = await kernel.getEntityRevision(
                'practiceSummaries', 'snapshot-tombstone'
            );
            let staleTombstoneAfterRestoreCode = null;
            try {
                await kernel.mutateEntities([{
                    type: 'upsert', store: 'practiceSummaries', recordId: 'snapshot-tombstone',
                    data: { id: 'snapshot-tombstone', title: 'stale resurrection' },
                    expectedRevision: snapshotTombstoneBeforeRestore
                }], { operationId: 'stale-tombstone-after-restore' });
            } catch (error) { staleTombstoneAfterRestoreCode = error.code; }
            let staleEntityAfterRestoreCode = null;
            try {
                await kernel.mutateEntities([{
                    type: 'upsert', store: 'practiceSummaries', recordId: 'r1',
                    data: { id: 'r1', title: 'stale overwrite' },
                    expectedRevision: snapshot.entities.practiceSummaries[0].revision
                }], { operationId: 'stale-after-restore' });
            } catch (error) { staleEntityAfterRestoreCode = error.code; }
            let staleDocumentAfterRestoreCode = null;
            try {
                await kernel.mutate([{
                    logicalKey: 'preferences.values', data: { theme: 'stale overwrite' },
                    expectedRevision: snapshot.envelopes['preferences.values'].revision
                }], { operationId: 'stale-document-after-restore' });
            } catch (error) { staleDocumentAfterRestoreCode = error.code; }
            await new Promise((resolve, reject) => {
                const tx = kernel.driver.db.transaction(['practiceSummaries'], 'readwrite');
                tx.objectStore('practiceSummaries').put({
                    recordId: 'corrupt',
                    revision: 1,
                    operationId: 'corrupt-seed',
                    updatedAt: new Date().toISOString(),
                    data: { id: 'corrupt', type: 'reading' },
                    checksum: 'broken-checksum'
                });
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error || new Error('unable to seed corrupt entity'));
                tx.onabort = () => reject(tx.error || new Error('corrupt entity transaction aborted'));
            });
            let corruptCode = null;
            try { await kernel.readEntity('practiceSummaries', 'corrupt'); } catch (error) { corruptCode = error.code; }
            const statusAfterCorruption = kernel.status();
            const summariesAfterCorruption = await kernel.listEntities('practiceSummaries');
            await kernel.installSnapshot(snapshot, { operationId: 'restore-after-corrupt', resetJournal: true });
            const corruptAfterRestore = await kernel.readEntity('practiceSummaries', 'corrupt');
            const restoredAfterCorruption = await kernel.readEntity('practiceSummaries', 'r1');
            const journalAfterCorruption = await kernel.read('system.operationJournal');
            await new Promise((resolve, reject) => {
                const tx = kernel.driver.db.transaction(['system'], 'readwrite');
                const store = tx.objectStore('system');
                const request = store.get('system.entityRevisions');
                request.onsuccess = () => {
                    const row = structuredClone(request.result);
                    row.envelope.data.epochs.practiceSummaries = Number.MAX_SAFE_INTEGER - 1;
                    row.envelope.checksum = window.__AppDataV2Internals.checksum(row.envelope.data);
                    store.put(row);
                };
                request.onerror = () => reject(request.error || new Error('unable to read entity revision sidecar'));
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error || new Error('unable to seed entity epoch limit'));
                tx.onabort = () => reject(tx.error || new Error('entity epoch limit seed aborted'));
            });
            const epochLimitBefore = await kernel.getEntityRevisionEpochs();
            let epochLimitCode = null;
            try {
                await kernel.mutateEntities([{
                    type: 'upsert', store: 'practiceSummaries', recordId: 'epoch-limit-row',
                    data: { id: 'epoch-limit-row', title: 'must roll back' }, expectedRevision: 0
                }], { operationId: 'epoch-limit-write' });
            } catch (error) { epochLimitCode = error.code; }
            const epochLimitAfter = await kernel.getEntityRevisionEpochs();
            const epochLimitRow = await kernel.readEntity('practiceSummaries', 'epoch-limit-row');
            const journalAfterEpochLimit = await kernel.read('system.operationJournal');
            remoteKernel.close();
            kernel.close();
            return {
                unavailableCode,
                legacyValues,
                webOnlyLegacyValues,
                externalBackup,
                externalReadCalls,
                promptBackup,
                promptFileRead,
                status: kernel.status(),
                stores,
                remoteCommit,
                first,
                retry,
                conflict,
                intentFirst,
                intentRetry,
                intentState,
                changedIntentCode,
                sparseCode,
                entities,
                entityRetry,
                practiceProjection,
                detailsListCode,
                snapshot,
                ghostSnapshotCode,
                staleImportCode,
                staleEpochCode,
                deletedRevision,
                sidecarWriteCode,
                deletedRevisionAfterRejectedSidecarWrite,
                recreated,
                snapshotTombstoneBeforeRestore,
                lateImportRow,
                invalidRevisionCode,
                upperBoundRevisionCode,
                upperBoundRollback: window.__AppDataV2Internals.checksum(upperBoundRawBefore)
                    === window.__AppDataV2Internals.checksum(upperBoundRawAfter),
                exportableKeys,
                restored,
                journal,
                snapshotTombstoneAfterRestore,
                staleTombstoneAfterRestoreCode,
                staleEntityAfterRestoreCode,
                staleDocumentAfterRestoreCode,
                corruptCode,
                statusAfterCorruption,
                summariesAfterCorruption,
                corruptAfterRestore,
                restoredAfterCorruption,
                journalAfterCorruption,
                epochLimitBefore,
                epochLimitCode,
                epochLimitAfter,
                epochLimitRow,
                journalAfterEpochLimit
            };
        });
        assert.equal(result.unavailableCode, 'BACKEND_UNAVAILABLE');
        assert.deepEqual(result.legacyValues.practice_records, [{ id: 'legacy-idb-record', correctAnswers: 1 }]);
        assert.deepEqual(result.legacyValues.settings, { theme: 'dark', notifications: true, source: 'local-newer' });
        assert.deepEqual(result.legacyValues.exam_index_configurations, [{ id: 'exam_index_1700000000000', key: 'exam_index_1700000000000' }]);
        assert.equal(result.legacyValues.active_exam_index_key, 'exam_index_1700000000000');
        assert.deepEqual(result.legacyValues.exam_index_1700000000000, [{ id: 'legacy-custom-exam', type: 'reading' }]);
        assert.deepEqual(result.webOnlyLegacyValues.practice_records, [{ id: 'legacy-web-record', correctAnswers: 0 }]);
        assert.deepEqual(result.webOnlyLegacyValues.settings, { theme: 'dark', notifications: true, source: 'local-newer' });
        assert.deepEqual(result.webOnlyLegacyValues.vocab_user_config, { dailyNew: 12 });
        assert.deepEqual(result.webOnlyLegacyValues.user_achievements, { first_practice: { unlockedAt: '2026-01-01T00:00:00.000Z' } });
        assert.equal(result.webOnlyLegacyValues.theme, undefined, 'unprefixed preference keys must stay rejected');
        assert.deepEqual(result.externalBackup, { practice_records: [{ id: 'legacy-external-record' }] });
        assert.ok(result.externalReadCalls.includes('open:ExamSystemExternalBackup'));
        assert.ok(result.externalReadCalls.includes('get:backup_directory'));
        assert.ok(result.externalReadCalls.includes('permission:read'));
        assert.ok(result.externalReadCalls.includes('file:practice-backup-latest.json:false'));
        assert.equal(result.externalReadCalls.some((call) => /put|delete|write/i.test(call)), false,
            'legacy backup reader must leave the old handle and file untouched');
        assert.equal(result.promptBackup, null);
        assert.equal(result.promptFileRead, false, 'startup migration must never prompt for or read without permission');
        assert.deepEqual(result.stores, ['documents', 'practiceAnnotations', 'practiceDetails', 'practiceSummaries', 'system']);
        assert.equal(result.first.revision, 1);
        assert.equal(result.remoteCommit.operationId, 'cross-realm-commit');
        assert.equal(result.remoteCommit.remote, true);
        assert.equal(result.remoteCommit.targets[0].logicalKey, 'settings.values');
        assert.deepEqual(result.retry, result.first);
        assert.equal(result.conflict, 'CONFLICT');
        assert.deepEqual(result.intentRetry, result.intentFirst,
            'same operationId and semantic intent must replay despite a dynamically refreshed expectedRevision');
        assert.equal(result.intentState.envelope.revision, 1, 'idempotent replay must not write a second revision');
        assert.equal(result.changedIntentCode, 'CONFLICT');
        assert.equal(result.sparseCode, 'VALIDATION');
        assert.deepEqual(result.entityRetry, result.entities);
        assert.deepEqual(Object.keys(result.practiceProjection).sort(), ['practiceAnnotations', 'practiceDetails', 'practiceSummaries']);
        assert.equal(result.practiceProjection.practiceSummaries[0].title, 'Reading');
        assert.equal(result.practiceProjection.practiceDetails[0].answers[0], 'A');
        assert.equal(result.practiceProjection.practiceAnnotations[0].notes[0], 'review');
        assert.equal(result.detailsListCode, 'VALIDATION');
        assert.equal(result.staleImportCode, 'CONFLICT');
        assert.equal(result.staleEpochCode, 'CONFLICT',
            'an add/delete ABA between preview and commit must be detected even when the physical row set matches');
        assert.equal(result.deletedRevision, 2);
        assert.equal(result.sidecarWriteCode, 'VALIDATION');
        assert.equal(result.deletedRevisionAfterRejectedSidecarWrite, result.deletedRevision,
            'a rejected public sidecar write must not reset durable tombstones');
        assert.equal(result.recreated.revision, 3,
            'an intentional recreate can use the durable tombstone revision without reopening ABA');
        assert.equal(result.lateImportRow.title, 'created while import was waiting');
        assert.equal(result.invalidRevisionCode, 'VALIDATION');
        assert.equal(result.upperBoundRevisionCode, 'VALIDATION');
        assert.equal(result.upperBoundRollback, true,
            'a revision overflow during snapshot install must roll back every queued store write');
        assert.equal(result.ghostSnapshotCode, 'VALIDATION');
        assert.deepEqual(result.snapshot.entities.practiceSummaries.map((row) => row.recordId), ['r1']);
        assert.deepEqual(
            result.exportableKeys.filter((key) => !Object.prototype.hasOwnProperty.call(result.snapshot.envelopes, key)),
            [],
            'snapshot must explicitly materialize every exportable catalog envelope'
        );
        assert.equal(Object.prototype.hasOwnProperty.call(result.snapshot.envelopes, 'exam_index'), false);
        assert.equal(result.snapshot.envelopes['library.configurations'].state, 'cleared');
        assert.equal(result.snapshot.envelopes['library.importedIndexes'].state, 'cleared');
        assert.equal(result.snapshot.envelopes['library.activeConfigurationId'].state, 'cleared');
        assert.equal(result.snapshot.entities.practiceDetails[0].data.answers[0], 'A');
        assert.equal(result.snapshot.entities.practiceAnnotations[0].data.notes[0], 'review');
        assert.ok(result.restored.revision > result.snapshot.entities.practiceSummaries[0].revision,
            'snapshot installation must advance the local entity revision instead of restoring an old CAS value');
        assert.equal(result.restored.data.score, 7);
        assert.deepEqual(Object.keys(result.journal), ['restore-1']);
        assert.ok(result.snapshotTombstoneAfterRestore > result.snapshotTombstoneBeforeRestore,
            'snapshot replacement must advance sidecar-only tombstones');
        assert.equal(result.staleTombstoneAfterRestoreCode, 'CONFLICT',
            'a pre-restore tombstone CAS token must not resurrect data after snapshot replacement');
        assert.equal(result.staleEntityAfterRestoreCode, 'CONFLICT');
        assert.equal(result.staleDocumentAfterRestoreCode, 'CONFLICT');
        assert.equal(result.corruptCode, 'CORRUPT_RECORD');
        assert.equal(result.statusAfterCorruption.state, 'ready');
        assert.deepEqual(result.summariesAfterCorruption.map((row) => row.title), ['Reading']);
        assert.equal(result.corruptAfterRestore, null);
        assert.equal(result.restoredAfterCorruption.score, 7);
        assert.deepEqual(Object.keys(result.journalAfterCorruption), ['restore-after-corrupt']);
        assert.equal(result.epochLimitBefore.practiceSummaries, Number.MAX_SAFE_INTEGER - 1);
        assert.equal(result.epochLimitCode, 'VALIDATION');
        assert.deepEqual(result.epochLimitAfter, result.epochLimitBefore,
            'an epoch overflow must leave the sidecar unchanged');
        assert.equal(result.epochLimitRow, null,
            'an epoch overflow must roll back entity writes queued in the same transaction');
        assert.equal(Object.prototype.hasOwnProperty.call(result.journalAfterEpochLimit, 'epoch-limit-write'), false,
            'an epoch overflow must not journal an uncommitted operation');
        assert.equal(result.status.state, 'closed');
        await page.evaluate(() => new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase('IELTSAtlasDataV2');
            request.onsuccess = resolve;
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error('migration target reset blocked'));
        }));
        await page.addScriptTag({ content: recordSource });
        await page.addScriptTag({ content: appDataSource });
        const migrated = await page.evaluate(async () => {
            await window.AppData.ready;
            const activeId = await window.AppData.library.getActive();
            return {
                practice: await window.AppData.practice.get('legacy-idb-record'),
                settings: await window.AppData.settings.getAll(),
                vocab: await window.AppData.vocab.getConfig(),
                achievements: await window.AppData.achievements.getManualState(),
                activeId,
                activeIndex: await window.AppData.library.getIndex(activeId)
            };
        });
        assert.equal(migrated.practice.id, 'legacy-idb-record');
        assert.equal(migrated.practice.correctAnswers, 1);
        assert.equal(migrated.settings.theme, 'dark');
        assert.equal(migrated.settings.source, 'local-newer');
        assert.equal(migrated.vocab.dailyNew, 12);
        assert.equal(migrated.achievements.first_practice.unlockedAt, '2026-01-01T00:00:00.000Z');
        assert.match(migrated.activeId, /^legacy-library-/);
        assert.equal(migrated.activeIndex[0].id, 'legacy-custom-exam');

        // The completion marker makes v1 a one-time source. A later v1 write must
        // not resurrect data after the user has moved on to v2.
        await page.evaluate(async () => {
            await window.AppData.practice.completeAttempt({
                operationId: 'persistent-v2-only',
                record: {
                    id: 'persistent-v2-only',
                    sessionId: 'persistent-v2-only',
                    type: 'reading',
                    title: 'Persistent v2 only',
                    totalQuestions: 1,
                    correctAnswers: 1,
                    answers: { q1: 'V2' }
                }
            });
        });
        await page.evaluate(() => new Promise((resolve, reject) => {
            const request = indexedDB.open('ExamSystemDB', 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const db = request.result;
                const tx = db.transaction('keyValueStore', 'readwrite');
                const data = [
                    { id: 'legacy-idb-record', correctAnswers: 1 },
                    { id: 'legacy-added-after-marker', type: 'reading', totalQuestions: 1, correctAnswers: 1 }
                ];
                tx.objectStore('keyValueStore').put({
                    key: 'exam_system_practice_records',
                    value: JSON.stringify({ data, timestamp: Date.now(), version: '1.0.0', compressed: false }),
                    timestamp: Date.now()
                });
                tx.onerror = () => { db.close(); reject(tx.error); };
                tx.onabort = () => { db.close(); reject(tx.error || new Error('legacy update aborted')); };
                tx.oncomplete = () => { db.close(); resolve(); };
            };
        }));
        await page.reload();
        await loadAppData(page);
        const secondBoot = await page.evaluate(async () => ({
            legacyAdded: await window.AppData.practice.get('legacy-added-after-marker'),
            v2Only: await window.AppData.practice.get('persistent-v2-only'),
            migration: (await window.AppData.backups.export({ scope: 'partial', logicalKeys: [] })).schemaVersion
        }));
        assert.equal(secondBoot.legacyAdded, null);
        assert.equal(secondBoot.v2Only.answers.q1, 'V2');
        assert.equal(secondBoot.migration, 2);

        // Later boots remain stable and do not churn v2 business state.
        const secondBusinessState = await persistedBusinessState(page);
        await page.reload();
        await loadAppData(page);
        const thirdBusinessState = await persistedBusinessState(page);
        assert.deepEqual(thirdBusinessState, secondBusinessState);
        console.log('DataKernel v2 IndexedDB-only behavior tests passed');
    } finally {
        if (browser) await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
}

const entrypoint = process.argv.includes('--snapshot-integrity-only') ? runSnapshotIntegrityUnitTest : main;
entrypoint().catch((error) => { console.error(error); process.exitCode = 1; });
