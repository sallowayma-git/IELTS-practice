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
    const state = {
        failNextReadWriteTransaction: false,
        failNextDeleteTransaction: false,
        beforeDeleteComplete: null
    };
    const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore() {},
        transaction(_storeName, mode) {
            let failTransaction = mode === 'readwrite' && state.failNextReadWriteTransaction;
            if (failTransaction) state.failNextReadWriteTransaction = false;
            const tx = {
                error: failTransaction ? new Error('binding database unavailable') : null,
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
                            if (!failTransaction) values.set(key, value);
                            return {};
                        },
                        delete(key) {
                            tx.hasDelete = true;
                            if (!failTransaction && state.failNextDeleteTransaction) {
                                failTransaction = true;
                                state.failNextDeleteTransaction = false;
                                tx.error = new Error('binding database unavailable');
                            }
                            if (!failTransaction) values.delete(key);
                            return {};
                        }
                    };
                }
            };
            queueMicrotask(() => {
                if (failTransaction) {
                    if (tx.onabort) tx.onabort();
                    else if (tx.onerror) tx.onerror();
                } else if (tx.hasDelete && typeof state.beforeDeleteComplete === 'function') {
                    const beforeDeleteComplete = state.beforeDeleteComplete;
                    state.beforeDeleteComplete = null;
                    beforeDeleteComplete();
                    if (tx.oncomplete) tx.oncomplete();
                } else if (tx.oncomplete) tx.oncomplete();
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
        state,
        values
    };
}

function createDirectory(name = 'atlas-backups') {
    const files = new Map();
    const state = {
        permission: 'granted',
        permissionRequests: 0,
        failWrites: false,
        failWritesFor: new Set(),
        writeError: null,
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
                            if (state.writeError) {
                                throw materializeFailure(state.writeError, 'write aborted');
                            }
                            if (state.failWrites || state.failWritesFor.has(filename)) {
                                throw new Error('disk full');
                            }
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
        },
        async *values() {
            for (const filename of files.keys()) {
                yield { kind: 'file', name: filename };
            }
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

function materializeFailure(failure, fallbackMessage) {
    const value = typeof failure === 'function' ? failure() : failure;
    if (value instanceof Error) return value;
    if (value && typeof value === 'object') {
        const error = new Error(value.message || fallbackMessage);
        if (value.name) error.name = value.name;
        return error;
    }
    return new Error(value == null ? fallbackMessage : String(value));
}

function createSharedBackupState(snapshot) {
    return {
        snapshot: JSON.parse(JSON.stringify(snapshot)),
        pendingRestore: null,
        restoreCommitGate: null,
        onRestoreCommitStart: null,
        onRestoreCommitComplete: null
    };
}

function createWebLocksHarness() {
    let queue = Promise.resolve();
    let active = 0;
    return {
        get active() {
            return active;
        },
        request(_name, _options, callback) {
            const previous = queue;
            let release;
            queue = new Promise((resolve) => { release = resolve; });
            return previous.then(async () => {
                active += 1;
                try {
                    return await callback();
                } finally {
                    active -= 1;
                    release();
                }
            });
        }
    };
}

function createBroadcastChannelHarness() {
    const channels = new Set();
    const messages = [];
    const deliveries = [];
    return {
        messages,
        deliveries,
        get receivedCounts() {
            return Array.from(channels).map((channel) => channel.received);
        },
        create(name) {
            const channel = {
                name,
                onmessage: null,
                closed: false,
                received: 0,
                postMessage(data) {
                    messages.push({ name, data });
                    for (const peer of channels) {
                        if (peer === channel || peer.closed || peer.name !== name) continue;
                        queueMicrotask(() => {
                            if (!peer.closed && typeof peer.onmessage === 'function') {
                                deliveries.push({ name, data });
                                peer.received += 1;
                                peer.onmessage({ data });
                            }
                        });
                    }
                },
                close() {
                    channel.closed = true;
                    channels.delete(channel);
                }
            };
            channels.add(channel);
            return channel;
        }
    };
}

function createHarness(options = {}) {
    const indexedDB = options.indexedDB || createIndexedDb();
    const directory = options.directory || createDirectory();
    const sharedData = options.sharedData || null;
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
    let pickerStartedResolve;
    const pickerStarted = new Promise((resolve) => { pickerStartedResolve = resolve; });
    const exportFailure = options.exportFailure || null;
    const previewFailure = options.previewFailure || null;
    const commitFailure = options.commitFailure || null;
    const BroadcastChannel = options.broadcastHub
        ? function BroadcastChannel(name) { return options.broadcastHub.create(name); }
        : undefined;

    const backups = {
        onDataCommitted(listener) {
            committedListener = listener;
            return () => { committedListener = null; };
        },
        async export() {
            if (exportFailure) {
                throw materializeFailure(exportFailure, 'backup export failed');
            }
            if (typeof options.onExport === 'function') options.onExport(sharedData, snapshot);
            return JSON.parse(JSON.stringify(sharedData ? sharedData.snapshot : snapshot));
        },
        validateSnapshot(payload) {
            if (typeof options.validateSnapshot === 'function') return options.validateSnapshot(payload);
            return Boolean(payload
                && payload.format === 'ielts-atlas-data-v2'
                && payload.schemaVersion === 2
                && typeof payload.checksum === 'string'
                && payload.checksum.length > 0);
        },
        async previewImport(payload, options) {
            calls.preview.push({ payload, options });
            if (previewFailure) throw materializeFailure(previewFailure, 'preview failed');
            if (sharedData) sharedData.pendingRestore = JSON.parse(JSON.stringify(payload));
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
            if (commitFailure) throw materializeFailure(commitFailure, 'commit failed');
            if (sharedData) {
                if (typeof sharedData.onRestoreCommitStart === 'function') {
                    const onRestoreCommitStart = sharedData.onRestoreCommitStart;
                    sharedData.onRestoreCommitStart = null;
                    onRestoreCommitStart();
                }
                if (sharedData.restoreCommitGate) await sharedData.restoreCommitGate;
                sharedData.snapshot = JSON.parse(JSON.stringify(sharedData.pendingRestore));
                if (typeof sharedData.onRestoreCommitComplete === 'function') {
                    const onRestoreCommitComplete = sharedData.onRestoreCommitComplete;
                    sharedData.onRestoreCommitComplete = null;
                    onRestoreCommitComplete();
                }
            }
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
        BroadcastChannel,
        showDirectoryPicker: async () => {
            pickerStartedResolve();
            return pickerResult;
        },
        navigator: {
            storage: {
                async persisted() { return true; },
                async persist() { return true; }
            },
            locks: options.locks === undefined ? createWebLocksHarness() : options.locks
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
            if (sharedData) sharedData.snapshot = JSON.parse(JSON.stringify(next));
            else snapshot = next;
        },
        setPickerResult(next) {
            pickerResult = next;
        },
        waitForPicker() {
            return pickerStarted;
        },
        pendingTimerCount() {
            return timers.filter((timer) => !timer.cancelled).length;
        },
        pendingTimerDelays() {
            return timers.filter((timer) => !timer.cancelled).map((timer) => timer.delay);
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

async function testMissingCrossTabLockFailsClosed() {
    const harness = createHarness({ locks: null });
    await harness.ready();
    await assert.rejects(
        () => harness.service.bindDirectory({ writeNow: false }),
        /缺少跨标签页安全锁/
    );
    assert.equal(harness.indexedDB.values.has('directory-handle'), false,
        'binding must not be persisted when cross-tab locking is unavailable');
}

async function testPublicWriteNowRejectsWithoutCrossTabLock() {
    const seeded = createHarness();
    await seeded.ready();
    await seeded.service.bindDirectory({ writeNow: true });

    const harness = createHarness({
        indexedDB: seeded.indexedDB,
        directory: seeded.directory,
        locks: null
    });
    await harness.ready();
    harness.setSnapshot(makeSnapshot('fnv1a-no-lock-write-now', 'no-lock'));
    harness.service.markDirty();

    // This exercises the public writeNow contract used by the UI click path;
    // a DOM modal harness is intentionally not needed for this rejection.
    await assert.rejects(
        () => harness.service.writeNow(),
        /缺少跨标签页安全锁/
    );
    assert.equal(harness.service.getStatus().dirty, true,
        'writeNow must not clear dirty state when the safety lock is unavailable');
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

async function testPermissionDeniedStopsBindAndSilentFlush() {
    const deniedBind = createHarness();
    await deniedBind.ready();
    deniedBind.directory.state.permission = 'denied';

    await assert.rejects(
        () => deniedBind.service.bindDirectory({ writeNow: false }),
        /未获得文件夹读写权限/
    );
    assert.equal(deniedBind.directory.state.permissionRequests, 1);
    assert.equal(deniedBind.service.getStatus().bound, false);
    assert.equal(deniedBind.indexedDB.values.has('directory-handle'), false,
        'permission denial must not persist a directory binding');

    const deniedFlush = createHarness();
    await deniedFlush.ready();
    await deniedFlush.service.bindDirectory({ writeNow: true });
    deniedFlush.setSnapshot(makeSnapshot('fnv1a-permission-denied', 'permission-denied'));
    deniedFlush.service.markDirty();
    deniedFlush.directory.state.permission = 'denied';

    const result = await deniedFlush.service.flushSilentlyIfPermitted();
    assert.equal(result.success, false);
    assert.equal(result.reason, 'permission_denied');
    assert.equal(deniedFlush.directory.state.permissionRequests, 0,
        'silent permission checks must not open a permission prompt');
    assert.equal(deniedFlush.service.getStatus().dirty, true);
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

async function testRestorePreviewFailurePreservesRestoreGate() {
    const snapshot = makeSnapshot('fnv1a-preview-failed', 'preview-failed');
    const directory = createDirectory();
    directory.files.set('ielts-atlas-backup-latest.json', JSON.stringify(snapshot));
    const harness = createHarness({
        directory,
        previewFailure: new Error('preview unavailable')
    });
    await harness.ready();
    await harness.service.bindDirectory({ writeNow: false });

    await assert.rejects(
        () => harness.service.restoreFromLatest({ confirmed: true }),
        /preview unavailable/
    );
    assert.equal(harness.calls.preview.length, 1);
    assert.equal(harness.calls.commit.length, 0);
    assert.equal(harness.calls.history.length, 0);
    assert.equal(harness.service.getStatus().awaitingRestore, true,
        'preview failure must leave the existing backup requiring an explicit retry');
}

async function testRestoreCommitFailurePreservesRestoreGate() {
    const snapshot = makeSnapshot('fnv1a-commit-failed', 'commit-failed');
    const directory = createDirectory();
    directory.files.set('ielts-atlas-backup-latest.json', JSON.stringify(snapshot));
    const harness = createHarness({
        directory,
        commitFailure: new Error('commit unavailable')
    });
    await harness.ready();
    await harness.service.bindDirectory({ writeNow: false });

    await assert.rejects(
        () => harness.service.restoreFromLatest({ confirmed: true }),
        /commit unavailable/
    );
    assert.equal(harness.calls.preview.length, 1);
    assert.equal(harness.calls.create.length, 1,
        'the safety snapshot is created before the commit attempt');
    assert.equal(harness.calls.commit.length, 1);
    assert.equal(harness.calls.history.length, 0);
    assert.equal(harness.service.getStatus().awaitingRestore, true,
        'commit failure must not clear the restore gate');
}

async function testRestoreKeepsPostRestoreCommitDirty() {
    const diskSnapshot = makeSnapshot('fnv1a-restore-disk', 'disk');
    const postRestoreSnapshot = makeSnapshot('fnv1a-post-restore-commit', 'post-restore-commit');
    const sharedData = createSharedBackupState(diskSnapshot);
    const harness = createHarness({ sharedData });
    await harness.ready();
    await harness.service.bindDirectory({ writeNow: true });

    sharedData.onRestoreCommitComplete = () => {
        sharedData.snapshot = JSON.parse(JSON.stringify(postRestoreSnapshot));
    };
    const restored = await harness.service.restoreFromLatest({ confirmed: true });
    assert.equal(restored.success, true);
    assert.equal(harness.service.getStatus().dirty, true,
        'a commit observed after restore must keep the external backup stale');

    await harness.flushTimers();
    const latest = JSON.parse(harness.directory.files.get('ielts-atlas-backup-latest.json'));
    assert.equal(latest.checksum, postRestoreSnapshot.checksum,
        'the post-restore commit must be flushed instead of being overwritten by restore state');
    assert.equal(harness.service.getStatus().dirty, false);
}

async function testRestoreConcurrentCommitSchedulesFlushAfterAwaitingRestoreClears() {
    const diskSnapshot = makeSnapshot('fnv1a-concurrent-restore-disk', 'restore-disk');
    const concurrentSnapshot = makeSnapshot('fnv1a-concurrent-restore-commit', 'concurrent-commit');
    const directory = createDirectory();
    directory.files.set('ielts-atlas-backup-latest.json', JSON.stringify(diskSnapshot));
    const sharedData = createSharedBackupState(diskSnapshot);
    const harness = createHarness({ directory, sharedData });
    await harness.ready();

    const bound = await harness.service.bindDirectory({ writeNow: false });
    assert.equal(bound.existingBackupFound, true);
    assert.equal(harness.service.getStatus().awaitingRestore, true);

    sharedData.onRestoreCommitComplete = () => {
        sharedData.snapshot = JSON.parse(JSON.stringify(concurrentSnapshot));
        harness.emitCommitted({ operationId: 'commit-during-restore' });
    };

    const restored = await harness.service.restoreFromLatest({ confirmed: true });
    assert.equal(restored.success, true);
    const status = harness.service.getStatus();
    assert.equal(status.awaitingRestore, false,
        'successful restore must clear the restore gate even after a concurrent commit');
    assert.equal(status.dirty, true,
        'the concurrent commit must leave the external backup stale');
    assert.equal(harness.pendingTimerCount(), 1,
        'clearing awaitingRestore must schedule the follow-up silent flush');
    assert.deepEqual(harness.pendingTimerDelays(), [8000]);

    await harness.flushTimers();
    const latest = JSON.parse(directory.files.get('ielts-atlas-backup-latest.json'));
    assert.equal(latest.checksum, concurrentSnapshot.checksum);
    assert.equal(harness.service.getStatus().dirty, false);
}

async function testRestoreSerializesWithBackgroundFlushAcrossTabs() {
    const restoredSnapshot = makeSnapshot('fnv1a-restored-across-tabs', 'restored');
    const staleSnapshot = makeSnapshot('fnv1a-stale-across-tabs', 'stale');
    const sharedData = createSharedBackupState(restoredSnapshot);
    const locks = createWebLocksHarness();
    const first = createHarness({ sharedData, locks });
    await first.ready();
    await first.service.bindDirectory({ writeNow: true });

    sharedData.snapshot = JSON.parse(JSON.stringify(staleSnapshot));
    const second = createHarness({
        indexedDB: first.indexedDB,
        directory: first.directory,
        sharedData,
        locks
    });
    await second.ready();
    assert.equal(second.service.getStatus().dirty, true);

    let releaseRestoreCommit;
    sharedData.restoreCommitGate = new Promise((resolve) => { releaseRestoreCommit = resolve; });
    let announceRestoreCommit;
    const restoreCommitStarted = new Promise((resolve) => { announceRestoreCommit = resolve; });
    sharedData.onRestoreCommitStart = announceRestoreCommit;

    const restorePromise = first.service.restoreFromLatest({ confirmed: true });
    await restoreCommitStarted;
    assert.equal(locks.active, 1,
        'restore must hold the shared disk lock while its AppData commit is pending');

    const flushPromise = second.service.flushSilentlyIfPermitted();
    releaseRestoreCommit();
    const [restoreResult, flushResult] = await Promise.all([restorePromise, flushPromise]);

    assert.equal(restoreResult.success, true);
    assert.equal(flushResult.success, true);
    const latest = JSON.parse(first.directory.files.get('ielts-atlas-backup-latest.json'));
    assert.equal(latest.checksum, restoredSnapshot.checksum,
        'a background flush must not write the pre-restore snapshot after restore commits');
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

async function testAbortErrorWriteFailureIsReportedWithoutFalseSuccess() {
    const harness = createHarness();
    await harness.ready();
    await harness.service.bindDirectory({ writeNow: true });
    const abortError = new Error('user aborted the file write');
    abortError.name = 'AbortError';
    harness.directory.state.writeError = abortError;
    harness.setSnapshot(makeSnapshot('fnv1a-aborted', 'aborted'));
    harness.service.markDirty();

    const result = await harness.service.writeNow();
    assert.equal(result.success, false);
    assert.equal(result.reason, 'write_error');
    assert.equal(result.error.name, 'AbortError');
    assert.equal(harness.service.getStatus().dirty, true);
    assert.match(harness.service.getStatus().lastWriteError, /user aborted/);
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

async function testPickerReturningAfterFullResetDoesNotRebindDirectory() {
    const harness = createHarness();
    await harness.ready();

    let resolvePicker;
    const pickerResult = new Promise((resolve) => { resolvePicker = resolve; });
    harness.setPickerResult(pickerResult);
    const bindPromise = harness.service.bindDirectory({ writeNow: false });
    await harness.waitForPicker();

    const resetResult = await harness.service.prepareForFullReset();
    assert.equal(resetResult.success, true);
    resolvePicker(harness.directory);

    let bindError = null;
    try {
        await bindPromise;
    } catch (error) {
        bindError = error;
    }
    assert.ok(bindError, 'a picker result arriving after reset must not complete binding');
    assert.equal(harness.service.getStatus().bound, false);
    assert.equal(harness.service.getStatus().suspended, true);
    assert.equal(harness.indexedDB.values.has('directory-handle'), false);
    assert.equal(harness.directory.files.size, 0);
}

async function testFullResetHoldsCrossTabLockAcrossPreparation() {
    const locks = createWebLocksHarness();
    const harness = createHarness({ locks });
    await harness.ready();
    await harness.service.bindDirectory({ writeNow: true });
    harness.setSnapshot(makeSnapshot('fnv1a-reset-lock', 'reset-lock'));
    harness.service.markDirty();

    let releaseWrite;
    let announceWriteStarted;
    const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
    const writeStarted = new Promise((resolve) => { announceWriteStarted = resolve; });
    let gated = false;
    harness.directory.state.beforeClose = async () => {
        if (gated) return;
        gated = true;
        announceWriteStarted();
        await writeGate;
    };
    let lockHeldDuringBindingClear = 0;
    harness.indexedDB.state.beforeDeleteComplete = () => {
        lockHeldDuringBindingClear = locks.active;
    };

    const resetPromise = harness.service.prepareForFullReset();
    await writeStarted;
    assert.equal(locks.active, 1,
        'full-reset preparation must retain the cross-tab lock across its backup write');
    assert.equal(harness.service.getStatus().resetPreparing, true);
    assert.equal(harness.service.getStatus().suspended, false,
        'the binding remains usable until the pre-reset backup is complete');

    releaseWrite();
    const result = await resetPromise;
    assert.equal(result.success, true);
    assert.equal(lockHeldDuringBindingClear, 1,
        'binding cleanup must happen while the full-reset lock is still held');
    assert.equal(locks.active, 0);
}

async function testCrossTabPickerRejectsAfterResetEpochBroadcast() {
    const broadcastHub = createBroadcastChannelHarness();
    const locks = createWebLocksHarness();
    const first = createHarness({ broadcastHub, locks });
    await first.ready();
    await first.service.bindDirectory({ writeNow: true });

    const second = createHarness({
        indexedDB: first.indexedDB,
        directory: first.directory,
        broadcastHub,
        locks
    });
    await second.ready();

    let resolvePicker;
    second.setPickerResult(new Promise((resolve) => { resolvePicker = resolve; }));
    const bindPromise = second.service.bindDirectory({ writeNow: false });
    await second.waitForPicker();

    const resetResult = await first.service.prepareForFullReset();
    assert.equal(resetResult.success, true);
    await Promise.resolve();
    await Promise.resolve();
    assert.ok(broadcastHub.messages.some((message) => message.data.type === 'reset-start'),
        'the resetting tab must publish the epoch change to other tabs');
    assert.equal(broadcastHub.deliveries.length, 1,
        'the other tab must receive the reset epoch change');
    assert.deepEqual(broadcastHub.receivedCounts.sort(), [0, 1]);

    resolvePicker(first.directory);
    await assert.rejects(
        () => bindPromise,
        /刚刚开始重置/
    );
    assert.equal(first.indexedDB.values.has('directory-handle'), false,
        'a picker started before the cross-tab epoch change must not persist a new handle');
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
    const latest = JSON.parse(harness.directory.files.get('ielts-atlas-backup-latest.json'));
    assert.equal(latest.checksum, 'fnv1a-pending-reset',
        'full reset preparation must flush dirty data before clearing the binding');
    for (const [filename, text] of diskCopy) {
        if (filename !== 'ielts-atlas-backup-latest.json') {
            assert.equal(harness.directory.files.get(filename), text,
                'full reset must preserve existing dated generations');
        }
    }
    const afterResetFiles = new Map(harness.directory.files);

    harness.service.markDirty();
    const writeAfterReset = await harness.service.writeNow();
    assert.equal(writeAfterReset.success, false);
    assert.equal(writeAfterReset.reason, 'suspended');
    assert.deepEqual(harness.directory.files, afterResetFiles);
}

async function testFullResetPublicLockAndRollbackContract() {
    const harness = createHarness();
    await harness.ready();
    await harness.service.bindDirectory({ writeNow: true });

    assert.equal(typeof harness.service.withFullResetLock, 'function');
    assert.equal(typeof harness.service.commitFullResetPreparation, 'function');
    assert.equal(typeof harness.service.rollbackFullResetPreparation, 'function');

    const result = await harness.service.withFullResetLock(async () => {
        const prepared = await harness.service.prepareForFullReset({ lockHeld: true });
        assert.equal(prepared.success, true);
        return harness.service.rollbackFullResetPreparation({ lockHeld: true });
    });
    assert.equal(result.success, true);
    assert.equal(harness.service.getStatus().bound, true);
    assert.equal(harness.service.getStatus().suspended, false);
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
    assert.equal(harness.indexedDB.values.has('directory-handle'), false);
    assert.equal(harness.indexedDB.values.has('metadata'), false);
    assert.ok(Number(harness.indexedDB.values.get('reset-epoch')) >= 1);
}

async function testFullResetWriteFailurePreservesBindingState() {
    const harness = createHarness();
    await harness.ready();
    await harness.service.bindDirectory({ writeNow: true });
    const originalLatest = harness.directory.files.get('ielts-atlas-backup-latest.json');

    harness.setSnapshot(makeSnapshot('fnv1a-reset-write-failed', 'reset-write-failed'));
    harness.service.markDirty();
    harness.directory.state.failWrites = true;

    const result = await harness.service.prepareForFullReset();
    assert.equal(result.success, false);
    assert.equal(result.reason, 'external_backup_write_failed');
    assert.equal(harness.service.getStatus().bound, true);
    assert.equal(harness.service.getStatus().suspended, false);
    assert.equal(harness.service.getStatus().dirty, true);
    assert.equal(harness.indexedDB.values.has('directory-handle'), true);
    assert.equal(harness.directory.files.get('ielts-atlas-backup-latest.json'), originalLatest);
}

async function testFullResetBindingDbFailureCanBeRetriedWithoutPermanentSuspension() {
    const harness = createHarness();
    await harness.ready();
    await harness.service.bindDirectory({ writeNow: true });
    harness.indexedDB.state.failNextDeleteTransaction = true;

    let firstError = null;
    let firstResult = null;
    try {
        firstResult = await harness.service.prepareForFullReset();
    } catch (error) {
        firstError = error;
    }
    assert.ok(firstError || (firstResult && firstResult.success === false),
        'a binding database cleanup failure must be reported');
    assert.equal(harness.service.getStatus().suspended, false,
        'a failed binding cleanup must not leave the service permanently suspended');
    assert.equal(harness.service.getStatus().bound, true);
    assert.equal(harness.indexedDB.values.has('directory-handle'), true);

    const retryResult = await harness.service.prepareForFullReset();
    assert.equal(retryResult.success, true);
    assert.equal(harness.service.getStatus().suspended, true);
    assert.equal(harness.service.getStatus().bound, false);
    assert.equal(harness.indexedDB.values.has('directory-handle'), false);
}

async function testFullResetFailsClosedWhenCommitArrivesDuringBindingCleanup() {
    const harness = createHarness();
    await harness.ready();
    await harness.service.bindDirectory({ writeNow: true });
    harness.setSnapshot(makeSnapshot('fnv1a-reset-cleanup-race', 'cleanup-race'));
    harness.service.markDirty();

    harness.indexedDB.state.beforeDeleteComplete = () => harness.emitCommitted();
    const result = await harness.service.prepareForFullReset();

    assert.equal(result.success, false);
    assert.equal(result.reason, 'external_backup_changed_during_reset');
    assert.equal(harness.service.getStatus().suspended, false);
    assert.equal(harness.service.getStatus().bound, true);
    assert.equal(harness.service.getStatus().resetPreparing, false);
    assert.equal(harness.service.getStatus().directoryName, 'atlas-backups');
    assert.equal(harness.service.getStatus().dirty, true);
    assert.equal(harness.indexedDB.values.has('directory-handle'), true,
        'a commit during binding cleanup must restore the binding before retry');
}

async function testFullResetDetectsMissedCrossTabCommitBeforeDeletion() {
    const initialSnapshot = makeSnapshot('fnv1a-reset-cross-tab-before-delete', 'before-delete');
    const postCommitSnapshot = makeSnapshot('fnv1a-reset-cross-tab-after-delete', 'after-delete');
    const sharedData = createSharedBackupState(initialSnapshot);
    let exportCount = 0;
    const harness = createHarness({
        sharedData,
        onExport(currentSharedData) {
            exportCount += 1;
            if (exportCount === 5) currentSharedData.snapshot = JSON.parse(JSON.stringify(postCommitSnapshot));
        }
    });
    await harness.ready();
    await harness.service.bindDirectory({ writeNow: true });

    const result = await harness.service.prepareForFullReset();
    assert.equal(result.success, false);
    assert.equal(result.reason, 'external_backup_changed_during_reset',
        'a cross-tab commit missed by the listener must still block local deletion');
    assert.equal(harness.service.getStatus().suspended, false);
    assert.equal(harness.service.getStatus().bound, true);
    assert.equal(harness.indexedDB.values.has('directory-handle'), true);
}

async function testFreshnessExportFailureStopsFullResetBeforeBindingCleanup() {
    const seeded = createHarness();
    await seeded.ready();
    await seeded.service.bindDirectory({ writeNow: true });
    const diskFilesBeforeReset = new Map(seeded.directory.files);

    const harness = createHarness({
        indexedDB: seeded.indexedDB,
        directory: seeded.directory,
        exportFailure: new Error('freshness export unavailable')
    });
    await harness.ready();

    let resetError = null;
    let resetResult = null;
    try {
        resetResult = await harness.service.prepareForFullReset();
    } catch (error) {
        resetError = error;
    }
    assert.ok(resetError || (resetResult && resetResult.success === false),
        'a freshness export failure must stop full reset');
    assert.equal(harness.service.getStatus().suspended, false);
    assert.equal(harness.service.getStatus().bound, true);
    assert.equal(harness.indexedDB.values.has('directory-handle'), true,
        'full reset must leave the binding so local data deletion can be cancelled');
    assert.deepEqual(harness.directory.files, diskFilesBeforeReset);
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
    assert.equal(harness.service.getStatus().suspended, false,
        'full reset must keep the binding active while it waits for the dirty write');
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

async function testUnchangedChecksumDoesNotTrustMissingOrCorruptLatest() {
    for (const latestText of [null, '{not-json']) {
        const harness = createHarness();
        await harness.ready();
        await harness.service.bindDirectory({ writeNow: true });
        if (latestText === null) harness.directory.files.delete('ielts-atlas-backup-latest.json');
        else harness.directory.files.set('ielts-atlas-backup-latest.json', latestText);

        harness.service.markDirty();
        const result = await harness.service.flushSilentlyIfPermitted();
        assert.equal(result.success, true);
        assert.equal(result.reason, 'written');
        assert.equal(result.skipped, undefined);
        const latest = JSON.parse(harness.directory.files.get('ielts-atlas-backup-latest.json'));
        assert.equal(latest.checksum, 'fnv1a-first');
        assert.equal(harness.service.getStatus().dirty, false);
    }
}

async function testLatestFailureLeavesGenerationForFallbackRestore() {
    const harness = createHarness();
    await harness.ready();
    await harness.service.bindDirectory({ writeNow: true });
    const originalLatest = harness.directory.files.get('ielts-atlas-backup-latest.json');

    harness.setSnapshot(makeSnapshot('fnv1a-generation-survives', 'generation-survives'));
    harness.service.markDirty();
    harness.directory.state.failWritesFor.add('ielts-atlas-backup-latest.json');
    const writeResult = await harness.service.writeNow();
    assert.equal(writeResult.success, false);
    assert.equal(writeResult.reason, 'write_error');
    assert.equal(harness.service.getStatus().dirty, true);
    assert.equal(harness.directory.files.get('ielts-atlas-backup-latest.json'), originalLatest);

    const generation = Array.from(harness.directory.files.entries()).find(([filename, text]) => {
        if (!/^ielts-atlas-backup-\d{4}-\d{2}-\d{2}(?:-\d{9})?\.json$/.test(filename)) return false;
        try { return JSON.parse(text).checksum === 'fnv1a-generation-survives'; }
        catch (_) { return false; }
    });
    assert.ok(generation, 'the dated generation must remain after latest write failure');

    harness.directory.files.delete('ielts-atlas-backup-latest.json');
    const restored = await harness.service.restoreFromLatest({ confirmed: true });
    assert.equal(restored.success, true);
    assert.equal(harness.calls.preview[0].payload.checksum, 'fnv1a-generation-survives');
}

async function testRestoreFallsBackToNewestValidDatedGeneration() {
    for (const latestText of [null, '{broken-latest']) {
        const directory = createDirectory();
        directory.files.set(
            'ielts-atlas-backup-2026-07-25.json',
            JSON.stringify(makeSnapshot('fnv1a-older-generation', 'older'))
        );
        directory.files.set(
            'ielts-atlas-backup-2026-07-26-120000000.json',
            JSON.stringify(makeSnapshot('fnv1a-newer-generation', 'newer'))
        );
        if (latestText !== null) directory.files.set('ielts-atlas-backup-latest.json', latestText);

        const harness = createHarness({ directory });
        await harness.ready();
        await harness.service.bindDirectory({ writeNow: false });
        const restored = await harness.service.restoreFromLatest({ confirmed: true });
        assert.equal(restored.success, true);
        assert.equal(harness.calls.preview[0].payload.checksum, 'fnv1a-newer-generation');
    }
}

async function main() {
    await testBindingWritesVerifiedV2Snapshots();
    await testMissingCrossTabLockFailsClosed();
    await testPublicWriteNowRejectsWithoutCrossTabLock();
    await testCommittedDataDebouncesSilentWriteWithoutPrompt();
    await testPermissionDeniedStopsBindAndSilentFlush();
    await testRestoreUsesPreviewSafetyBackupAndAtomicCommit();
    await testRestorePreviewFailurePreservesRestoreGate();
    await testRestoreCommitFailurePreservesRestoreGate();
    await testRestoreKeepsPostRestoreCommitDirty();
    await testRestoreSerializesWithBackgroundFlushAcrossTabs();
    await testCommitDuringWriteKeepsDirtyAndWritesFollowup();
    await testReloadDetectsStaleDiskSnapshot();
    await testWriteFailureIsReportedWithoutClearingDirtyState();
    await testAbortErrorWriteFailureIsReportedWithoutFalseSuccess();
    await testUnbindClearsOnlyLocalBinding();
    await testOtherTabUnbindStopsStaleHandleWrites();
    await testPickerReturningAfterFullResetDoesNotRebindDirectory();
    await testFullResetHoldsCrossTabLockAcrossPreparation();
    await testCrossTabPickerRejectsAfterResetEpochBroadcast();
    await testFullResetSuspendsWritesAndPreservesDiskFiles();
    await testFullResetPublicLockAndRollbackContract();
    await testBindingExistingBackupRequiresRestoreBeforeAnyWrite();
    await testFullResetWorksWhenAppDataReadyRejects();
    await testFullResetWriteFailurePreservesBindingState();
    await testFullResetBindingDbFailureCanBeRetriedWithoutPermanentSuspension();
    await testFullResetFailsClosedWhenCommitArrivesDuringBindingCleanup();
    await testFullResetDetectsMissedCrossTabCommitBeforeDeletion();
    await testFreshnessExportFailureStopsFullResetBeforeBindingCleanup();
    await testFullResetWaitsForInFlightPreResetWrite();
    await testUnchangedChecksumDoesNotTrustMissingOrCorruptLatest();
    await testLatestFailureLeavesGenerationForFallbackRestore();
    await testRestoreFallsBackToNewestValidDatedGeneration();
    await testRestoreConcurrentCommitSchedulesFlushAfterAwaitingRestoreClears();
    console.log('ExternalBackupService v2 tests passed');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
