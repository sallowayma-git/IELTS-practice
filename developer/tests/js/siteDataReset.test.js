#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const source = fs.readFileSync(path.join(root, 'js/core/siteDataReset.js'), 'utf8');

function createStorage(seed = {}, options = {}) {
    const values = new Map(Object.entries(seed));
    return {
        values,
        clearCalls: 0,
        clear() {
            this.clearCalls += 1;
            if (options.clearError) throw options.clearError;
            values.clear();
        }
    };
}

function createHarness(options = {}) {
    const events = [];
    const messages = [];
    const requests = [];
    const deleteModes = Object.assign({}, options.deleteModes);
    const deleteModeSequence = Object.fromEntries(
        Object.entries(options.deleteModeSequence || {}).map(([name, modes]) => [name, [...modes]])
    );
    const localStorage = createStorage(
        { consent: 'yes' },
        { clearError: options.localStorageClearError }
    );
    const sessionStorage = createStorage(
        { recovery: 'active' },
        { clearError: options.sessionStorageClearError }
    );
    const nextDeleteMode = (name) => {
        const sequence = deleteModeSequence[name];
        return sequence && sequence.length
            ? sequence.shift()
            : (deleteModes[name] || 'success');
    };
    const indexedDB = {
        deleteDatabase(name) {
            events.push(`delete:${name}`);
            const request = { name, completed: false };
            requests.push(request);
            request.complete = () => {
                if (request.completed) return;
                request.completed = true;
                events.push(`deleted:${name}`);
                request.onsuccess?.({ target: request });
            };
            queueMicrotask(() => {
                const mode = nextDeleteMode(name);
                if (mode === 'skipped') {
                    request.skipped = true;
                    events.push(`skipped:${name}`);
                    request.complete();
                    return;
                }
                if (mode === 'error') {
                    request.error = new Error(`delete failed: ${name}`);
                    request.onerror?.({ target: request });
                    return;
                }
                if (mode === 'blocked' || mode === 'blocked-success') {
                    request.onblocked?.({ target: request });
                    if (mode === 'blocked') return;
                }
                queueMicrotask(request.complete);
            });
            return request;
        }
    };
    const externalBackup = {
        calls: 0,
        prepareCalls: 0,
        commitCalls: 0,
        rollbackCalls: 0,
        status: {
            suspended: options.initialSuspended === true,
            bound: options.initialBound !== false
        }
    };
    const prepareResults = [...(options.prepareResults || [])];
    const runExternalOperation = async function (name) {
        this.calls += 1;
        events.push(`external:${name}`);
        if (name === 'prepare') {
            this.prepareCalls += 1;
            this.status.suspended = true;
            this.status.bound = false;
        }
        if (options.externalError) {
            throw new Error(name === 'unbind' ? 'binding cleanup failed' : 'external backup busy');
        }
        if (name === 'prepare' && prepareResults.length) return prepareResults.shift();
        if (Object.prototype.hasOwnProperty.call(options, 'externalResult')) {
            return options.externalResult;
        }
        return name === 'unbind'
            ? true
            : { success: true, diskFilesPreserved: true, bindingCleared: true };
    };
    externalBackup.rollbackFullResetPreparation = async function () {
        this.rollbackCalls += 1;
        events.push('external:rollback');
        this.status.suspended = false;
        this.status.bound = true;
        return true;
    };
    externalBackup.commitFullResetPreparation = async function () {
        this.commitCalls += 1;
        events.push('external:commit');
        if (options.commitError) throw options.commitError;
        return Object.prototype.hasOwnProperty.call(options, 'commitResult')
            ? options.commitResult
            : true;
    };
    let lockTail = Promise.resolve();
    externalBackup.withFullResetLock = async function (callback) {
        const previous = lockTail;
        let release;
        lockTail = new Promise((resolve) => { release = resolve; });
        await previous;
        events.push('full-reset-lock:acquired');
        try {
            const result = await callback();
            events.push('full-reset-lock:callback-complete');
            return result;
        } finally {
            events.push('full-reset-lock:released');
            release();
        }
    };
    if (options.externalMethod === 'unbind') {
        externalBackup.unbindDirectory = runExternalOperation.bind(externalBackup, 'unbind');
        externalBackup.prepareForFullReset = externalBackup.unbindDirectory;
    } else {
        externalBackup.prepareForFullReset = runExternalOperation.bind(externalBackup, 'prepare');
    }
    if (options.missingFullResetInterface) {
        delete externalBackup.prepareForFullReset;
        delete externalBackup.unbindDirectory;
        delete externalBackup.withFullResetLock;
        delete externalBackup.rollbackFullResetPreparation;
    }
    const indexedDBStub = options.missingIndexedDBDeleteDatabase ? {} : indexedDB;
    const windowStub = {
        indexedDB: options.missingIndexedDB ? undefined : indexedDBStub,
        localStorage,
        sessionStorage,
        ExternalBackupService: options.missingExternalBackupService ? undefined : externalBackup,
        confirm: () => options.confirmed !== false,
        showMessage(message, type) { messages.push({ message, type }); },
        console: Object.assign({}, console, { error() {} }),
        location: {
            reloadCalls: 0,
            reload() { this.reloadCalls += 1; events.push('reload'); }
        }
    };
    const context = vm.createContext({
        window: windowStub,
        globalThis: windowStub,
        console: windowStub.console,
        Promise,
        Object,
        Error
    });
    vm.runInContext(source, context, { filename: 'siteDataReset.js' });
    return {
        windowStub,
        events,
        messages,
        requests,
        deleteModes,
        localStorage,
        sessionStorage,
        externalBackup,
        enqueueOtherTask() {
            events.push('other:attempt');
            return externalBackup.withFullResetLock(async () => {
                events.push('other:ran');
                return true;
            });
        },
        complete(name) {
            const request = requests.find((item) => item.name === name && !item.completed);
            assert.ok(request, `missing pending request for ${name}`);
            request.complete();
        }
    };
}

async function flush() {
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

async function testCancelledReset() {
    const harness = createHarness({ confirmed: false });
    const result = await harness.windowStub.clearCache();
    assert.equal(result.reason, 'cancelled');
    assert.deepEqual(harness.events, []);
    assert.equal(harness.localStorage.clearCalls, 0);
}

async function testSuccessfulReset() {
    const harness = createHarness();
    const result = await harness.windowStub.clearCache();
    assert.equal(result.success, true);
    assert.deepEqual(JSON.parse(JSON.stringify(result.databases)), [
        'IELTSAtlasDataV2',
        'ExamSystemDB',
        'ExamSystemExternalBackup',
        'IELTSAtlasExternalBackupV2'
    ]);
    assert.equal(result.databases.includes('ExamSystemExternalBackup'), true,
        'full reset must remove the legacy directory handle so old data cannot auto-migrate on reload');
    assert.equal(harness.events[0], 'full-reset-lock:acquired');
    assert.ok(harness.events.indexOf('external:prepare') > 0);
    assert.equal(harness.localStorage.values.size, 0);
    assert.equal(harness.sessionStorage.values.size, 0);
    assert.equal(harness.windowStub.location.reloadCalls, 1);
    assert.equal(result.externalBackupFilesPreserved, true);
}

async function testBlockedDeletionKeepsWaiting() {
    const harness = createHarness({ deleteModes: { IELTSAtlasDataV2: 'blocked' } });
    const pending = harness.windowStub.SiteDataReset.perform({ reload: false });
    let settled = false;
    pending.finally(() => { settled = true; });
    await flush();
    assert.equal(settled, false);
    assert.equal(harness.localStorage.clearCalls, 0, 'storage clears only after every database is deleted');
    assert.ok(harness.messages.some((entry) => entry.type === 'warning' && /关闭其他标签页/.test(entry.message)));
    harness.complete('IELTSAtlasDataV2');
    const result = await pending;
    assert.equal(result.success, true);
    assert.equal(harness.localStorage.values.size, 0);
}

async function testFullResetLockCoversDatabaseDeletion() {
    const harness = createHarness({ deleteModes: { IELTSAtlasDataV2: 'blocked' } });
    const resetPromise = harness.windowStub.SiteDataReset.perform({ reload: false });
    await flush();

    const writePromise = harness.enqueueOtherTask();
    await flush();
    assert.equal(harness.events.includes('other:ran'), false,
        'a write queued during reset must wait for the full reset lock');

    harness.complete('IELTSAtlasDataV2');
    const result = await resetPromise;
    assert.equal(result.success, true);
    await writePromise;

    const resetComplete = harness.events.indexOf('full-reset-lock:callback-complete');
    const writeRan = harness.events.indexOf('other:ran');
    const lockAcquired = harness.events.indexOf('full-reset-lock:acquired');
    const firstDelete = harness.events.findIndex((entry) => entry.startsWith('delete:'));
    const deletedIndexes = harness.events
        .map((entry, index) => entry.startsWith('deleted:') ? index : -1)
        .filter((index) => index >= 0);
    const lastDelete = Math.max(...deletedIndexes);
    assert.ok(lockAcquired >= 0 && lockAcquired < firstDelete,
        'the full reset lock must be acquired before database deletion starts');
    assert.ok(lastDelete < resetComplete,
        'the full reset lock must remain held through the last database deletion');
    assert.ok(resetComplete >= 0, 'reset must complete its locked callback');
    assert.ok(writeRan > resetComplete,
        'the competing write must run only after every reset operation completes');
}

async function testPrepareFailureRollsBackPreparation() {
    const cases = [
        { prepareResults: [{ success: false, error: new Error('prepare rejected') }] },
        { externalError: true }
    ];
    for (const options of cases) {
        const harness = createHarness(options);
        const result = await harness.windowStub.clearCache();
        assert.equal(result.success, false);
        assert.equal(harness.externalBackup.rollbackCalls, 1);
        assert.equal(harness.externalBackup.status.suspended, false);
        assert.equal(harness.externalBackup.status.bound, true);
        assert.equal(harness.events.some((entry) => entry.startsWith('delete:')), false);
    }
}

async function testDeletionFailureIsVisible() {
    const harness = createHarness({ deleteModes: { ExamSystemDB: 'error' } });
    const result = await harness.windowStub.clearCache();
    assert.equal(result.success, false);
    assert.equal(result.reason, 'partial_reset');
    assert.equal(result.terminal, false);
    assert.equal(harness.windowStub.location.reloadCalls, 0);
    assert.equal(harness.localStorage.clearCalls, 1);
    assert.ok(harness.messages.some((entry) => entry.type === 'error'));
}

async function testRejectedDatabaseDeletionRollsBackPreparation() {
    const harness = createHarness({ deleteModes: { ExamSystemDB: 'error' } });
    const result = await harness.windowStub.clearCache();
    assert.equal(result.success, false);
    assert.equal(harness.externalBackup.rollbackCalls, 1);
    assert.equal(harness.externalBackup.status.suspended, false);
    assert.equal(harness.externalBackup.status.bound, true);
}

async function testSkippedDatabaseDeletionRollsBackPreparation() {
    const harness = createHarness({ missingIndexedDBDeleteDatabase: true });
    const result = await harness.windowStub.clearCache();
    assert.equal(result.success, false);
    assert.equal(harness.externalBackup.rollbackCalls, 1);
    assert.equal(harness.externalBackup.status.suspended, false);
    assert.equal(harness.externalBackup.status.bound, true);
}

async function testStorageClearFailureRollsBackPreparation() {
    const harness = createHarness({
        sessionStorageClearError: new Error('session storage unavailable')
    });
    const result = await harness.windowStub.clearCache();
    assert.equal(result.success, false);
    assert.equal(harness.externalBackup.rollbackCalls, 1);
    assert.equal(harness.externalBackup.status.suspended, false);
    assert.equal(harness.externalBackup.status.bound, true);
}

async function testPartialDeletionRetryRestoresPreparationState() {
    const harness = createHarness({
        deleteModeSequence: { ExamSystemDB: ['error', 'success'] }
    });
    const first = await harness.windowStub.clearCache();
    assert.equal(first.success, false);
    assert.equal(harness.externalBackup.prepareCalls, 1);
    assert.equal(harness.externalBackup.rollbackCalls, 1);
    assert.equal(harness.externalBackup.status.suspended, false);
    assert.equal(harness.externalBackup.status.bound, true);

    const second = await harness.windowStub.SiteDataReset.perform({ reload: false });
    assert.equal(second.success, true);
    assert.equal(harness.externalBackup.prepareCalls, 2,
        'a retry must prepare the external backup again after a partial deletion');
    assert.equal(harness.events.filter((entry) => entry === 'external:prepare').length, 2);
}

async function testExternalFailureStopsBeforeDeletion() {
    const harness = createHarness({ externalError: true });
    const result = await harness.windowStub.clearCache();
    assert.equal(result.success, false);
    assert.equal(result.reason, 'external_backup_busy');
    assert.equal(result.retryable, true);
    assert.equal(result.terminal, false);
    assert.equal(harness.events.some((entry) => entry.startsWith('delete:')), false);
    assert.equal(harness.localStorage.clearCalls, 0);
    assert.equal(harness.sessionStorage.clearCalls, 0);
    assert.equal(harness.windowStub.location.reloadCalls, 0);
}

async function testMissingExternalBackupServiceFailsClosed() {
    const harness = createHarness({ missingExternalBackupService: true });
    const result = await harness.windowStub.clearCache();
    assert.equal(result.success, false);
    assert.equal(harness.events.some((entry) => entry.startsWith('delete:')), false);
    assert.equal(harness.localStorage.clearCalls, 0);
    assert.equal(harness.sessionStorage.clearCalls, 0);
}

async function testMissingFullResetInterfaceFailsClosed() {
    const harness = createHarness({ missingFullResetInterface: true });
    const result = await harness.windowStub.clearCache();
    assert.equal(result.success, false);
    assert.equal(harness.events.some((entry) => entry.startsWith('delete:')), false);
    assert.equal(harness.localStorage.clearCalls, 0);
    assert.equal(harness.sessionStorage.clearCalls, 0);
}

async function testMissingIndexedDBDeleteDatabaseFailsClosed() {
    const harness = createHarness({ missingIndexedDB: true });
    const result = await harness.windowStub.clearCache();
    assert.equal(result.success, false);
    assert.equal(harness.externalBackup.rollbackCalls, 1);
    assert.equal(harness.windowStub.location.reloadCalls, 0);
}

async function testExternalFailureResultStopsBeforeDeletion() {
    const harness = createHarness({
        externalResult: {
            success: false,
            reason: 'external_backup_write_failed',
            error: new Error('disk full')
        }
    });
    const result = await harness.windowStub.clearCache();
    assert.equal(result.success, false);
    assert.equal(result.reason, 'external_backup_busy');
    assert.equal(result.retryable, true);
    assert.equal(result.terminal, false);
    assert.match(result.error.message, /disk full/);
    assert.equal(harness.events.some((entry) => entry.startsWith('delete:')), false);
    assert.equal(harness.localStorage.clearCalls, 0);
    assert.equal(harness.sessionStorage.clearCalls, 0);
    assert.equal(harness.windowStub.location.reloadCalls, 0);
}

async function testBindingCleanupFailureStopsBeforeDeletion() {
    const harness = createHarness({
        externalMethod: 'unbind',
        externalResult: {
            success: false,
            reason: 'binding_cleanup_failed',
            error: new Error('binding store unavailable')
        }
    });
    const result = await harness.windowStub.clearCache();
    assert.equal(result.success, false);
    assert.equal(result.reason, 'external_backup_busy');
    assert.equal(result.retryable, true);
    assert.equal(result.terminal, false);
    assert.match(result.error.message, /binding store unavailable/);
    assert.deepEqual(
        harness.events.filter((entry) => entry.startsWith('external:')),
        ['external:unbind', 'external:rollback']
    );
    assert.equal(harness.localStorage.clearCalls, 0);
    assert.equal(harness.sessionStorage.clearCalls, 0);
    assert.equal(harness.windowStub.location.reloadCalls, 0);
}

async function testConcurrentCallsShareOneRun() {
    const harness = createHarness({ deleteModes: { IELTSAtlasDataV2: 'blocked' } });
    const first = harness.windowStub.SiteDataReset.perform({ reload: false });
    const second = harness.windowStub.SiteDataReset.perform({ reload: false });
    assert.equal(first, second);
    await flush();
    assert.equal(harness.events.filter((entry) => entry.startsWith('delete:')).length, 4);
    assert.equal(harness.externalBackup.calls, 1);
    harness.complete('IELTSAtlasDataV2');
    const [left, right] = await Promise.all([first, second]);
    assert.equal(left, right);
}

async function testFinishedNonTerminalRunCanRepeat() {
    const harness = createHarness();
    assert.equal((await harness.windowStub.SiteDataReset.perform({ reload: false })).success, true);
    assert.equal((await harness.windowStub.SiteDataReset.perform({ reload: false })).success, true);
    assert.equal(harness.events.filter((entry) => entry.startsWith('delete:')).length, 8);
    assert.equal(harness.localStorage.clearCalls, 2);
}

await testCancelledReset();
await testSuccessfulReset();
await testBlockedDeletionKeepsWaiting();
await testFullResetLockCoversDatabaseDeletion();
await testPrepareFailureRollsBackPreparation();
await testDeletionFailureIsVisible();
await testRejectedDatabaseDeletionRollsBackPreparation();
await testSkippedDatabaseDeletionRollsBackPreparation();
await testStorageClearFailureRollsBackPreparation();
await testPartialDeletionRetryRestoresPreparationState();
await testExternalFailureStopsBeforeDeletion();
await testExternalFailureResultStopsBeforeDeletion();
await testBindingCleanupFailureStopsBeforeDeletion();
await testMissingExternalBackupServiceFailsClosed();
await testMissingFullResetInterfaceFailsClosed();
await testMissingIndexedDBDeleteDatabaseFailsClosed();
await testConcurrentCallsShareOneRun();
await testFinishedNonTerminalRunCanRepeat();
console.log('SiteDataReset tests passed');
