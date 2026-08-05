#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const serviceSource = fs.readFileSync(path.join(repoRoot, 'js/core/externalBackupService.js'), 'utf8');

function createIndexedDb() {
    const values = new Map();
    const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore() {},
        transaction() {
            const tx = {
                error: null,
                objectStore() {
                    return {
                        get(key) {
                            const request = {};
                            queueMicrotask(() => {
                                request.result = values.get(key);
                                if (request.onsuccess) request.onsuccess({ target: request });
                            });
                            return request;
                        },
                        put(value, key) {
                            values.set(key, value);
                            return {};
                        },
                        delete(key) {
                            values.delete(key);
                            return {};
                        }
                    };
                }
            };
            queueMicrotask(() => {
                if (tx.oncomplete) tx.oncomplete();
            });
            return tx;
        },
        close() {}
    };
    return {
        open() {
            const request = {};
            queueMicrotask(() => {
                request.result = db;
                if (request.onsuccess) request.onsuccess({ target: request });
            });
            return request;
        },
        values
    };
}

function createDirectory(name = 'atlas-backups') {
    const files = new Map();
    const state = {
        permission: 'granted',
        permissionRequests: 0,
        failWrites: false,
        beforeClose: null,
        onClose: null
    };
    return {
        kind: 'directory',
        name,
        files,
        state,
        async queryPermission() {
            return state.permission;
        },
        async requestPermission() {
            state.permissionRequests += 1;
            return state.permission;
        },
        async getFileHandle(filename, options = {}) {
            if (!files.has(filename) && options.create !== true) {
                const error = new Error('not found');
                error.name = 'NotFoundError';
                throw error;
            }
            if (!files.has(filename)) files.set(filename, '');
            return {
                async createWritable() {
                    let pending = '';
                    return {
                        async write(text) {
                            if (state.failWrites) throw new Error('disk full');
                            pending = String(text);
                        },
                        async close() {
                            if (typeof state.beforeClose === 'function') await state.beforeClose(filename);
                            files.set(filename, pending);
                            if (typeof state.onClose === 'function') state.onClose(filename);
                        },
                        async abort() {}
                    };
                },
                async getFile() {
                    return {
                        name: filename,
                        async text() {
                            return files.get(filename);
                        }
                    };
                }
            };
        }
    };
}

function makeSnapshot(checksum, theme = 'dark') {
    return {
        format: 'ielts-atlas-data-v2',
        schemaVersion: 2,
        scope: 'full',
        createdAt: '2026-07-26T00:00:00.000Z',
        backend: 'indexeddb-v2',
        envelopes: {
            'preferences.values': {
                schemaVersion: 2,
                logicalKey: 'preferences.values',
                state: 'present',
                revision: 1,
                updatedAt: '2026-07-26T00:00:00.000Z',
                operationId: 'test',
                checksum: 'envelope',
                data: { theme }
            }
        },
        checksum
    };
}

function createHarness(options = {}) {
    const indexedDB = options.indexedDB || createIndexedDb();
    const directory = options.directory || createDirectory();
    const testConsole = Object.assign({}, console, { error() {}, warn() {} });
    const timers = [];
    const calls = {
        preview: [],
        create: [],
        commit: [],
        history: []
    };
    let snapshot = options.snapshot || makeSnapshot('fnv1a-first');
    let committedListener = null;
    let pickerResult = directory;

    const backups = {
        onDataCommitted(listener) {
            committedListener = listener;
            return () => { committedListener = null; };
        },
        async export() {
            return JSON.parse(JSON.stringify(snapshot));
        },
        async previewImport(payload, options) {
            calls.preview.push({ payload, options });
            return {
                id: 'plan-1',
                format: payload.format === 'ielts-atlas-data-v2' ? 'v2' : 'legacy',
                keys: ['preferences.values', 'practice.records'],
                clearedKeys: [],
                warnings: [],
                practice: { existingCount: 5, finalCount: 3, removedCount: 2 },
                destructive: true
            };
        },
        async create(options) {
            calls.create.push(options);
            return { id: 'pre-backup' };
        },
        async commitImport(planId, options) {
            calls.commit.push({ planId, options });
            return { committed: true };
        },
        async recordImport(entry) {
            calls.history.push(entry);
        }
    };

    const windowStub = {
        console: testConsole,
        indexedDB,
        isSecureContext: true,
        showDirectoryPicker: async () => pickerResult,
        navigator: {
            storage: {
                async persisted() { return true; },
                async persist() { return true; }
            }
        },
        AppData: { ready: options.appDataReady || Promise.resolve(true), backups },
        crypto: { randomUUID: () => 'uuid-1' },
        confirm: () => true,
        setTimeout(callback, delay) {
            const timer = { callback, delay, cancelled: false };
            timers.push(timer);
            return timer;
        },
        clearTimeout(timer) {
            if (timer) timer.cancelled = true;
        },
        document: null
    };
    const context = vm.createContext({
        window: windowStub,
        globalThis: windowStub,
        console: testConsole,
        Promise,
        Date,
        JSON,
        Math
    });
    vm.runInContext(serviceSource, context, { filename: 'js/core/externalBackupService.js' });

    return {
        service: windowStub.ExternalBackupService,
        directory,
        indexedDB,
        calls,
        async ready() {
            await windowStub.ExternalBackupService.ensureReady();
            await Promise.resolve();
        },
        setSnapshot(next) {
            snapshot = next;
        },
        setPickerResult(next) {
            pickerResult = next;
        },
        emitCommitted(event = {}) {
            assert.equal(typeof committedListener, 'function');
            committedListener({
                operationId: event.operationId || 'domain-commit',
                targets: Array.isArray(event.targets) ? event.targets : [],
                remote: event.remote === true
            });
        },
        async flushTimers() {
            while (timers.length) {
                const timer = timers.shift();
                if (!timer.cancelled) await timer.callback();
            }
        }
    };
}

async function testBindingWritesVerifiedV2Snapshots() {
    const harness = createHarness();
    await harness.ready();

    const result = await harness.service.bindDirectory({ writeNow: true });
    assert.equal(result.directoryName, 'atlas-backups');
    assert.equal(result.writeResult.success, true);
    assert.ok(harness.directory.files.has('ielts-atlas-backup-latest.json'));
    assert.ok(Array.from(harness.directory.files.keys()).some((name) => /^ielts-atlas-backup-\d{4}-\d{2}-\d{2}\.json$/.test(name)));

    const latest = JSON.parse(harness.directory.files.get('ielts-atlas-backup-latest.json'));
    assert.equal(latest.format, 'ielts-atlas-data-v2');
    assert.equal(latest.checksum, 'fnv1a-first');
    assert.equal(harness.service.getStatus().lastChecksum, 'fnv1a-first');
    assert.ok(harness.indexedDB.values.get('directory-handle'), 'directory handle must persist outside AppData JSON');
}

async function testCommittedDataDebouncesSilentWriteWithoutPrompt() {
    const harness = createHarness();
    await harness.ready();
    await harness.service.bindDirectory({ writeNow: true });

    harness.directory.state.permission = 'granted';
    harness.setSnapshot(makeSnapshot('fnv1a-second', 'light'));
    harness.emitCommitted({
        operationId: 'child-realm-commit',
        targets: [{ logicalKey: 'vocab.collection.reading-highlights' }],
        remote: true
    });
    assert.equal(harness.service.getStatus().dirty, true);
    await harness.flushTimers();
    assert.equal(harness.service.getStatus().dirty, false);
    assert.equal(harness.service.getStatus().lastChecksum, 'fnv1a-second');
    assert.equal(harness.directory.state.permissionRequests, 0, 'silent writes must never request permission');

    harness.directory.state.permission = 'prompt';
    harness.setSnapshot(makeSnapshot('fnv1a-third', 'blue'));
    harness.emitCommitted();
    await harness.flushTimers();
    assert.equal(harness.service.getStatus().dirty, true);
    assert.equal(harness.directory.state.permissionRequests, 0);
}

async function testRestoreUsesPreviewSafetyBackupAndAtomicCommit() {
    const harness = createHarness();
    await harness.ready();
    await harness.service.bindDirectory({ writeNow: true });

    const restored = await harness.service.restoreFromLatest();
    assert.equal(restored.success, true);
    assert.equal(harness.calls.preview.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(harness.calls.preview[0].options)), {
        replace: true,
        practiceMode: 'replace',
        applyClears: true,
        fullRestore: true
    });
    assert.equal(harness.calls.create.length, 1);
    assert.equal(harness.calls.create[0].type, 'pre-external-restore');
    assert.equal(harness.calls.commit.length, 1);
    assert.equal(harness.calls.commit[0].planId, 'plan-1');
    assert.equal(harness.calls.commit[0].options.confirmDestructive, true);
    assert.equal(harness.calls.history.length, 1);
    assert.equal(harness.calls.history[0].source, 'external-backup');
}

async function testCommitDuringWriteKeepsDirtyAndWritesFollowup() {
    const harness = createHarness();
    await harness.ready();
    await harness.service.bindDirectory({ writeNow: true });
    harness.setSnapshot(makeSnapshot('fnv1a-race-start', 'race-start'));
    harness.service.markDirty();

    let injected = false;
    harness.directory.state.onClose = (filename) => {
        if (injected || filename === 'ielts-atlas-backup-latest.json') return;
        injected = true;
        harness.setSnapshot(makeSnapshot('fnv1a-race-latest', 'race-latest'));
        harness.emitCommitted();
    };
    const firstWrite = await harness.service.writeNow();
    harness.directory.state.onClose = null;
    assert.equal(firstWrite.success, true);
    assert.equal(firstWrite.followupPending, true);
    assert.equal(harness.service.getStatus().dirty, true,
        'a commit that lands during disk I/O must not be cleared by the older write');

    await harness.flushTimers();
    assert.equal(harness.service.getStatus().dirty, false);
    assert.equal(harness.service.getStatus().lastChecksum, 'fnv1a-race-latest');
}

async function testReloadDetectsStaleDiskSnapshot() {
    const first = createHarness();
    await first.ready();
    await first.service.bindDirectory({ writeNow: true });

    const second = createHarness({
        indexedDB: first.indexedDB,
        directory: first.directory,
        snapshot: makeSnapshot('fnv1a-after-reload', 'after-reload')
    });
    await second.ready();
    assert.equal(second.service.getStatus().bound, true);
    assert.equal(second.service.getStatus().dirty, true,
        'startup must compare the current AppData snapshot with the last disk checksum');
    await second.flushTimers();
    assert.equal(second.service.getStatus().dirty, false);
    assert.equal(second.service.getStatus().lastChecksum, 'fnv1a-after-reload');
}

async function testWriteFailureIsReportedWithoutClearingDirtyState() {
    const harness = createHarness();
    await harness.ready();
    await harness.service.bindDirectory({ writeNow: true });
    harness.directory.state.failWrites = true;
    harness.setSnapshot(makeSnapshot('fnv1a-failed', 'failed'));
    harness.service.markDirty();

    const result = await harness.service.writeNow();
    assert.equal(result.success, false);
    assert.equal(result.reason, 'write_error');
    assert.equal(harness.service.getStatus().dirty, true);
    assert.match(harness.service.getStatus().lastWriteError, /disk full/);
}

async function testUnbindClearsOnlyLocalBinding() {
    const harness = createHarness();
    await harness.ready();
    await harness.service.bindDirectory({ writeNow: true });
    const diskCopy = harness.directory.files.get('ielts-atlas-backup-latest.json');
    await harness.service.unbindDirectory();

    assert.equal(harness.service.getStatus().bound, false);
    assert.equal(harness.indexedDB.values.has('directory-handle'), false);
    assert.equal(harness.directory.files.get('ielts-atlas-backup-latest.json'), diskCopy, 'unbind must not delete disk files');
}

async function testOtherTabUnbindStopsStaleHandleWrites() {
    const first = createHarness();
    await first.ready();
    await first.service.bindDirectory({ writeNow: true });
    const second = createHarness({
        indexedDB: first.indexedDB,
        directory: first.directory
    });
    await second.ready();
    await second.service.unbindDirectory();

    const staleTabWrite = await first.service.writeNow();
    assert.equal(staleTabWrite.success, false);
    assert.equal(staleTabWrite.reason, 'unbound',
        'each disk write must re-read the shared binding after another tab unbinds');
}

async function testFullResetSuspendsWritesAndPreservesDiskFiles() {
    const harness = createHarness();
    await harness.ready();
    await harness.service.bindDirectory({ writeNow: true });
    const diskCopy = new Map(harness.directory.files);

    harness.setSnapshot(makeSnapshot('fnv1a-pending-reset', 'pending-reset'));
    harness.emitCommitted();
    const result = await harness.service.prepareForFullReset();
    await harness.flushTimers();

    assert.equal(result.success, true);
    assert.equal(result.diskFilesPreserved, true);
    assert.equal(harness.service.getStatus().bound, false);
    assert.equal(harness.service.getStatus().suspended, true);
    assert.equal(harness.indexedDB.values.has('directory-handle'), false);
    assert.deepEqual(harness.directory.files, diskCopy,
        'full reset preparation must cancel pending writes and preserve every disk file');

    harness.service.markDirty();
    const writeAfterReset = await harness.service.writeNow();
    assert.equal(writeAfterReset.success, false);
    assert.equal(writeAfterReset.reason, 'suspended');
    assert.deepEqual(harness.directory.files, diskCopy);
}

async function testBindingExistingBackupRequiresRestoreBeforeAnyWrite() {
    const directory = createDirectory();
    const originalText = JSON.stringify(makeSnapshot('fnv1a-existing', 'existing'));
    directory.files.set('ielts-atlas-backup-latest.json', originalText);
    directory.files.set('ielts-atlas-backup-2026-07-26.json', originalText);
    const harness = createHarness({ directory });
    await harness.ready();

    const bound = await harness.service.bindDirectory({ writeNow: true });
    assert.equal(bound.existingBackupFound, true);
    assert.equal(bound.writeResult, null);
    assert.equal(harness.service.getStatus().awaitingRestore, true);
    assert.equal(directory.files.get('ielts-atlas-backup-latest.json'), originalText);
    assert.equal(directory.files.get('ielts-atlas-backup-2026-07-26.json'), originalText);

    const blockedWrite = await harness.service.writeNow();
    assert.equal(blockedWrite.success, false);
    assert.equal(blockedWrite.reason, 'restore_required');
    assert.equal(directory.files.get('ielts-atlas-backup-latest.json'), originalText);

    const restored = await harness.service.restoreFromLatest({ confirmed: true });
    assert.equal(restored.success, true);
    assert.equal(harness.service.getStatus().awaitingRestore, false);
    assert.equal(directory.files.get('ielts-atlas-backup-latest.json'), originalText);
}

async function testFullResetWorksWhenAppDataReadyRejects() {
    const harness = createHarness({
        appDataReady: Promise.reject(new Error('corrupt AppData initialization'))
    });
    const result = await harness.service.prepareForFullReset();
    assert.equal(result.success, true);
    assert.equal(harness.service.getStatus().suspended, true);
    assert.equal(harness.indexedDB.values.size, 0);
}

async function testFullResetWaitsForInFlightPreResetWrite() {
    const harness = createHarness();
    await harness.ready();
    await harness.service.bindDirectory({ writeNow: true });
    harness.setSnapshot(makeSnapshot('fnv1a-in-flight-before-reset', 'in-flight'));
    harness.service.markDirty();

    let releaseWrite;
    let announceWriteStarted;
    const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
    const writeStarted = new Promise((resolve) => { announceWriteStarted = resolve; });
    let gated = false;
    harness.directory.state.beforeClose = async (filename) => {
        if (gated || filename === 'ielts-atlas-backup-latest.json') return;
        gated = true;
        announceWriteStarted();
        await writeGate;
    };

    const writePromise = harness.service.writeNow();
    await writeStarted;
    let resetSettled = false;
    const resetPromise = harness.service.prepareForFullReset().then((result) => {
        resetSettled = true;
        return result;
    });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(harness.service.getStatus().suspended, true);
    assert.equal(resetSettled, false, 'full reset must wait for the in-flight disk write lock');

    releaseWrite();
    const writeResult = await writePromise;
    const resetResult = await resetPromise;
    harness.directory.state.beforeClose = null;
    assert.equal(writeResult.success, true);
    assert.equal(resetResult.success, true);
    assert.equal(harness.service.getStatus().bound, false);
    const latest = JSON.parse(harness.directory.files.get('ielts-atlas-backup-latest.json'));
    assert.equal(latest.checksum, 'fnv1a-in-flight-before-reset',
        'only the pre-reset snapshot may finish writing before the binding is cleared');
}

async function main() {
    await testBindingWritesVerifiedV2Snapshots();
    await testCommittedDataDebouncesSilentWriteWithoutPrompt();
    await testRestoreUsesPreviewSafetyBackupAndAtomicCommit();
    await testCommitDuringWriteKeepsDirtyAndWritesFollowup();
    await testReloadDetectsStaleDiskSnapshot();
    await testWriteFailureIsReportedWithoutClearingDirtyState();
    await testUnbindClearsOnlyLocalBinding();
    await testOtherTabUnbindStopsStaleHandleWrites();
    await testFullResetSuspendsWritesAndPreservesDiskFiles();
    await testBindingExistingBackupRequiresRestoreBeforeAnyWrite();
    await testFullResetWorksWhenAppDataReadyRejects();
    await testFullResetWaitsForInFlightPreResetWrite();
    console.log('ExternalBackupService v2 tests passed');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
