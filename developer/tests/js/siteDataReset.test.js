#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const resetSource = fs.readFileSync(path.join(repoRoot, 'js/core/siteDataReset.js'), 'utf8');

function createStorage(seed, behavior = {}) {
    const values = new Map(Object.entries(seed || {}));
    return {
        values,
        clearCalls: 0,
        getItem(key) {
            return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
            if (behavior.failSetItem) throw new Error('storage write failed');
            values.set(key, String(value));
        },
        removeItem(key) {
            values.delete(key);
        },
        clear() {
            this.clearCalls += 1;
            values.clear();
        }
    };
}

/**
 * Deterministic timer host. The blocked-deletion timeout is measured in seconds,
 * so tests drive it explicitly instead of sleeping.
 */
function createClock() {
    let now = 0;
    let sequence = 0;
    const timers = new Map();
    return {
        timers,
        setTimeout(callback, delay) {
            sequence += 1;
            timers.set(sequence, { callback, at: now + (Number(delay) || 0), delay: Number(delay) || 0 });
            return sequence;
        },
        clearTimeout(id) {
            timers.delete(id);
        },
        pendingDelays() {
            return Array.from(timers.values()).map((timer) => timer.delay);
        },
        advance(ms) {
            now += ms;
            const due = Array.from(timers.entries())
                .filter(([, timer]) => timer.at <= now)
                .sort((a, b) => a[1].at - b[1].at);
            for (const [id, timer] of due) {
                timers.delete(id);
                timer.callback();
            }
            return due.length;
        }
    };
}

/** Let queued microtasks/immediates drain so IndexedDB stub events can fire. */
async function flushAsync(rounds = 12) {
    for (let i = 0; i < rounds; i += 1) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}

/**
 * Fail loudly instead of hanging the suite if a reset never settles.
 *
 * The guard timer is deliberately not unref'd: a regression that leaves the
 * reset pending would otherwise let Node drain its loop and exit 0 without ever
 * printing a failure.
 */
function withDeadline(promise, label, ms = 5000) {
    let timer;
    const guard = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), ms);
    });
    return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

function createHarness(options = {}) {
    const events = [];
    const messages = [];
    const clock = createClock();
    const localStorage = createStorage(Object.assign({
        hasSeenGplLicense: 'true',
        'ielts_atlas:v2:authoritative:preferences.values': '{"consent":{"hasSeenGplLicense":true}}'
    }, options.seedLocalStorage || {}), { failSetItem: options.failLocalStorageWrites });
    const sessionStorage = createStorage({
        'ielts_atlas:v2:session:recovery.windowSession': '{"active":true}'
    }, { failSetItem: options.failSessionStorageWrites });
    const deleteModes = options.deleteModes || {};
    const pendingRequests = [];
    /**
     * Rows a "database" holds. `deleteDatabase` only empties the bucket when the
     * browser actually runs the request, so a late deletion firing against data
     * written after the reset is directly observable.
     */
    const databaseContents = new Map(
        Object.entries(options.databaseContents || { IELTSAtlasDataV2: ['seed-record'] })
            .map(([name, rows]) => [name, rows.slice()])
    );
    const indexedDB = {
        databaseContents,
        deleteDatabase(name) {
            events.push('delete:' + name);
            const request = {};
            const entry = { name, request, completed: false };
            pendingRequests.push(entry);
            /** Run what the browser does when the request finally reaches the front. */
            entry.completeDeletion = () => {
                if (entry.completed) return false;
                entry.completed = true;
                databaseContents.set(name, []);
                events.push('deleted:' + name);
                if (request.onsuccess) request.onsuccess({ target: request });
                return true;
            };
            queueMicrotask(() => {
                const mode = deleteModes[name] || 'success';
                if (mode === 'error') {
                    request.error = new Error('delete failed: ' + name);
                    if (request.onerror) request.onerror({ target: request });
                    return;
                }
                if (mode === 'blocked-forever' || mode === 'blocked-then-late-success') {
                    // Another tab keeps the connection open: onblocked fires and no
                    // terminal event ever follows while that tab stays open. The
                    // request stays armed — tests fire `completeDeletion()` to
                    // replay the moment that tab closes.
                    if (request.onblocked) request.onblocked({ target: request });
                    return;
                }
                if (mode === 'blocked-success' && request.onblocked) {
                    request.onblocked({ target: request });
                }
                queueMicrotask(() => { entry.completeDeletion(); });
            });
            return request;
        }
    };
    const externalBackup = {
        prepareCalls: 0,
        unbindCalls: 0,
        async prepareForFullReset() {
            this.prepareCalls += 1;
            events.push('external:prepare');
            if (options.prepareError) throw new Error('prepare failed');
            if (options.preparePending) return new Promise(() => {});
            return { success: true, diskFilesPreserved: true };
        },
        async unbindDirectory() {
            this.unbindCalls += 1;
            events.push('external:unbind');
            if (options.unbindPending) return new Promise(() => {});
            return { success: true, diskFilesPreserved: true };
        }
    };
    if (options.useUnbind) delete externalBackup.prepareForFullReset;
    const windowStub = {
        name: options.windowName || '',
        console: Object.assign({}, console, { error() {} }),
        indexedDB,
        localStorage,
        sessionStorage,
        ExternalBackupService: externalBackup,
        setTimeout: (callback, delay) => clock.setTimeout(callback, delay),
        clearTimeout: (id) => clock.clearTimeout(id),
        confirm: () => options.confirmed !== false,
        location: {
            reloadCalls: 0,
            reload() {
                this.reloadCalls += 1;
                events.push('reload');
            }
        }
    };
    function installMessageCenter() {
        windowStub.showMessage = function showMessage(message, type) {
            messages.push({ message, type });
        };
    }
    // index.html loads core-foundation (this module) before the ui-shell bundle
    // that defines showMessage. `deferMessageCenter` reproduces that ordering so
    // boot-time notices are tested against the real world, not a friendlier one.
    if (!options.deferMessageCenter) installMessageCenter();
    const context = vm.createContext({
        window: windowStub,
        globalThis: windowStub,
        console: windowStub.console,
        Promise,
        Object,
        Error,
        Math
    });
    vm.runInContext(resetSource, context, { filename: 'js/core/siteDataReset.js' });
    return {
        windowStub,
        events,
        messages,
        localStorage,
        sessionStorage,
        externalBackup,
        clock,
        deleteModes,
        pendingRequests,
        databaseContents,
        /** Bring up the UI layer that owns showMessage, as ui-shell.bundle.js does. */
        installMessageCenter,
        /** Replay the browser finally running an abandoned deleteDatabase request. */
        completeLateDeletion(name) {
            const entry = pendingRequests.filter((item) => item.name === name && !item.completed).pop();
            assert.ok(entry, `expected an outstanding deleteDatabase request for ${name}`);
            return entry.completeDeletion();
        },
        /** Simulate the app reopening a database and writing fresh user data. */
        writeFreshData(name, row) {
            const rows = databaseContents.get(name) || [];
            rows.push(row);
            databaseContents.set(name, rows);
            return rows;
        }
    };
}

async function testCancelledResetHasNoSideEffects() {
    const harness = createHarness({ confirmed: false });
    assert.equal(typeof harness.windowStub.clearCache, 'function', 'fresh core load must expose clearCache');
    const result = await harness.windowStub.clearCache();
    assert.equal(result.success, false);
    assert.equal(result.reason, 'cancelled');
    assert.deepEqual(harness.events, []);
    assert.equal(harness.externalBackup.prepareCalls, 0);
    assert.equal(harness.localStorage.clearCalls, 0);
    assert.equal(harness.sessionStorage.clearCalls, 0);
    assert.equal(harness.windowStub.location.reloadCalls, 0);
}

async function testSuccessfulResetReturnsToFreshBrowserState() {
    const harness = createHarness();
    const result = await harness.windowStub.clearCache();
    assert.equal(result.success, true);
    assert.deepEqual(JSON.parse(JSON.stringify(result.databases)), [
        'IELTSAtlasDataV2',
        'ExamSystemDB',
        'IELTSAtlasExternalBackupV2'
    ]);
    assert.equal(harness.events[0], 'external:prepare', 'external disk writer must stop before database deletion');
    assert.deepEqual(harness.events.slice(1, 4).sort(), [
        'delete:ExamSystemDB',
        'delete:IELTSAtlasDataV2',
        'delete:IELTSAtlasExternalBackupV2'
    ]);
    assert.equal(harness.localStorage.values.size, 0, 'GPL consent and v2 fallback data must be removed');
    assert.equal(harness.sessionStorage.values.size, 0, 'window recovery state must be removed');
    assert.equal(harness.windowStub.location.reloadCalls, 1);
    assert.equal(result.externalBackupFilesPreserved, true);
}

async function testBlockedDeletionWaitsAndWarns() {
    const harness = createHarness({
        deleteModes: { IELTSAtlasDataV2: 'blocked-success' }
    });
    const result = await harness.windowStub.SiteDataReset.perform({ reload: false });
    assert.equal(result.success, true);
    assert.ok(harness.messages.some((entry) => entry.type === 'warning' && /其他 IELTS Atlas 标签页/.test(entry.message)));
    assert.equal(harness.localStorage.values.size, 0);
}

async function testDeletionFailureDoesNotClaimSuccessOrReload() {
    const harness = createHarness({
        deleteModes: { ExamSystemDB: 'error' }
    });
    const result = await harness.windowStub.clearCache();
    assert.equal(result.success, false);
    assert.equal(result.reason, 'partial_reset');
    assert.equal(result.terminal, true);
    assert.equal(harness.localStorage.clearCalls, 1, 'terminal cleanup must continue after one database deletion error');
    assert.equal(harness.sessionStorage.clearCalls, 1);
    assert.equal(harness.windowStub.location.reloadCalls, 1,
        'a page whose data kernel may have been deleted must not remain interactive');
    assert.ok(harness.messages.some((entry) => entry.type === 'error'));
}

async function testExternalQuiesceFailureCannotBlockRecoveryReset() {
    const harness = createHarness({ prepareError: true });
    const result = await harness.windowStub.clearCache();
    assert.equal(result.success, false);
    assert.equal(result.reason, 'partial_reset');
    assert.equal(result.terminal, true);
    assert.equal(harness.localStorage.values.size, 0);
    assert.equal(harness.sessionStorage.values.size, 0);
    assert.equal(harness.windowStub.location.reloadCalls, 1);
    assert.equal(harness.events.filter((entry) => entry.startsWith('delete:')).length, 3,
        'reset must still delete all browser databases when AppData/external backup initialization is broken');
}

async function testPendingExternalQuiesceTimesOutAndConcurrentCallsShareRecovery() {
    for (const mode of ['prepare', 'unbind']) {
        const harness = createHarness(mode === 'prepare'
            ? { preparePending: true }
            : { useUnbind: true, unbindPending: true });
        const first = harness.windowStub.SiteDataReset.perform({ reload: false });
        const second = harness.windowStub.SiteDataReset.perform({ reload: false });
        await flushAsync();

        const delays = harness.clock.pendingDelays();
        assert.equal(delays.length, 1, `${mode} must arm exactly one quiesce timeout`);
        assert.ok(delays[0] >= 5000 && delays[0] <= 10000);
        assert.equal(harness.events.filter((entry) => entry === `external:${mode}`).length, 1,
            `concurrent calls must share one ${mode} attempt`);

        harness.clock.advance(delays[0]);
        const [firstResult, secondResult] = await withDeadline(
            Promise.all([first, second]),
            `${mode} quiesce timeout recovery`
        );
        assert.equal(firstResult, secondResult, 'concurrent callers must receive the same outcome object');
        assert.equal(firstResult.success, false, 'a quiesce timeout must remain visible as partial reset');
        assert.equal(firstResult.terminal, false);
        assert.equal(harness.events.filter((entry) => entry.startsWith('delete:')).length, 3,
            'quiesce timeout must not prevent database recovery cleanup');
        const timeout = Array.from(firstResult.errors).find((entry) => entry.stage === 'external-backup-quiesce');
        assert.equal(timeout.error.code, 'EXTERNAL_BACKUP_QUIESCE_TIMEOUT');
        assert.equal(harness.clock.timers.size, 0);
    }
}

async function testQuiesceTimeoutNonTerminalResetCanRunAgain() {
    for (const mode of ['prepare', 'unbind']) {
        const options = mode === 'prepare'
            ? { preparePending: true }
            : { useUnbind: true, unbindPending: true };
        const harness = createHarness(options);
        const firstPending = harness.windowStub.SiteDataReset.perform({ reload: false });
        await flushAsync();
        harness.clock.advance(harness.clock.pendingDelays()[0]);
        const first = await withDeadline(firstPending, `${mode} timeout before retry`);

        assert.equal(first.success, false);
        assert.equal(first.terminal, false);
        assert.ok(first.errors.some((entry) => entry.stage === 'external-backup-quiesce'));

        if (mode === 'prepare') options.preparePending = false;
        else options.unbindPending = false;
        const second = await withDeadline(
            harness.windowStub.SiteDataReset.perform({ reload: false }),
            `${mode} retry after timeout`
        );

        assert.equal(second.success, true, 'a settled non-terminal timeout must release resetPromise');
        assert.notEqual(second, first, 'the retry must not replay the previous partial outcome');
        assert.equal(harness.events.filter((entry) => entry.startsWith('delete:')).length, 6,
            'the retry must issue a fresh deletion for every database');
        assert.equal(mode === 'prepare'
            ? harness.externalBackup.prepareCalls
            : harness.externalBackup.unbindCalls, 2);
    }
}

async function testPermanentlyBlockedDeletionTimesOutInsteadOfHanging() {
    const harness = createHarness({
        deleteModes: { IELTSAtlasDataV2: 'blocked-forever' }
    });
    const pending = harness.windowStub.SiteDataReset.perform({ reload: false });
    let settled = false;
    pending.then(() => { settled = true; }, () => { settled = true; });

    await flushAsync();
    assert.equal(settled, false, 'reset must still be waiting while the blocked timeout has not elapsed');
    const delays = harness.clock.pendingDelays();
    assert.equal(delays.length, 1, 'a blocked deletion must arm exactly one timeout');
    assert.ok(delays[0] >= 5000 && delays[0] <= 10000,
        `blocked timeout must be 5-10s, got ${delays[0]}ms`);

    harness.clock.advance(delays[0]);
    const result = await withDeadline(pending, 'permanently blocked reset');

    assert.equal(result.success, false, 'a database that was never deleted must not report success');
    assert.equal(result.reason, 'partial_reset');
    assert.equal(result.blocked, true, 'blocked resets must be distinguishable from generic failures');
    assert.deepEqual(JSON.parse(JSON.stringify(result.blockedDatabases)), ['IELTSAtlasDataV2']);
    assert.equal(result.retryable, true);

    const blockedErrors = Array.from(result.errors).filter((entry) => entry.stage === 'delete-database-blocked');
    assert.equal(blockedErrors.length, 1, 'blocked failures must be tagged with their own stage');
    assert.equal(blockedErrors[0].database, 'IELTSAtlasDataV2');
    assert.equal(blockedErrors[0].blocked, true);
    assert.equal(blockedErrors[0].error.code, 'DELETE_DATABASE_BLOCKED');

    assert.ok(harness.messages.some((entry) => entry.type === 'warning' && /其他 IELTS Atlas 标签页/.test(entry.message)),
        'user must be warned while the deletion is blocked');
    const finalError = harness.messages.filter((entry) => entry.type === 'error').pop();
    assert.ok(finalError, 'a blocked reset must end with an error-level message');
    assert.ok(/关闭/.test(finalError.message) && /重新点击|重试|再次/.test(finalError.message),
        `blocked guidance must tell the user to close other tabs and retry, got: ${finalError.message}`);
    assert.ok(/IELTSAtlasDataV2/.test(finalError.message), 'guidance must name the database that is still held');
}

async function testBlockedTimeoutStillCompletesTerminalCleanup() {
    const harness = createHarness({
        deleteModes: { IELTSAtlasDataV2: 'blocked-forever' }
    });
    const markerKey = harness.windowStub.SiteDataReset.PENDING_DELETION_MARKER_KEY;
    const pending = harness.windowStub.SiteDataReset.perform();
    await flushAsync();
    harness.clock.advance(harness.clock.pendingDelays()[0]);
    await withDeadline(pending, 'blocked reset terminal cleanup');

    assert.equal(harness.localStorage.clearCalls, 1,
        'one undeletable database must not skip web storage cleanup');
    assert.equal(harness.sessionStorage.clearCalls, 1);
    assert.deepEqual(Array.from(harness.sessionStorage.values.keys()), [markerKey]);
    // The marker is redundantly written after both stores are cleared so one
    // unavailable storage backend cannot erase the cross-refresh warning.
    assert.deepEqual(Array.from(harness.localStorage.values.keys()), [markerKey],
        'only the pending-deletion marker may survive the storage wipe');
    assert.equal(harness.events.filter((entry) => entry.startsWith('delete:')).length, 3,
        'the other databases must still be deleted');
    assert.equal(harness.windowStub.location.reloadCalls, 0,
        'the realm owning the real pending observer must not reload itself away');
    assert.equal(harness.clock.timers.size, 0, 'the blocked timeout must not leak after settling');
}

async function testBlockedResetCanBeRetriedAfterOtherTabCloses() {
    const harness = createHarness({
        deleteModes: { IELTSAtlasDataV2: 'blocked-forever' }
    });
    const first = harness.windowStub.SiteDataReset.perform({ reload: false });
    await flushAsync();
    harness.clock.advance(harness.clock.pendingDelays()[0]);
    const firstResult = await withDeadline(first, 'first blocked reset');
    assert.equal(firstResult.success, false);

    // The user closes the other tab: the browser drains the abandoned request,
    // which is what actually clears the pending state.
    harness.completeLateDeletion('IELTSAtlasDataV2');
    await flushAsync();
    assert.equal(harness.windowStub.SiteDataReset.isDeletionPending(), false,
        'a completed late deletion must retire the pending state');

    // The retry must actually re-run the deletion instead of replaying the
    // cached failure from the singleton promise.
    harness.deleteModes.IELTSAtlasDataV2 = 'success';
    const deletesBeforeRetry = harness.events.filter((entry) => entry.startsWith('delete:')).length;
    const retryResult = await withDeadline(
        harness.windowStub.SiteDataReset.perform({ reload: false }),
        'retry after blocked reset'
    );

    assert.equal(retryResult.success, true, 'retry must succeed once the blocking tab is gone');
    assert.notEqual(retryResult, firstResult, 'a failed reset must not be cached in resetPromise');
    assert.equal(
        harness.events.filter((entry) => entry.startsWith('delete:')).length,
        deletesBeforeRetry + 3,
        'retry must issue fresh deleteDatabase requests'
    );
}

async function testLateSuccessAfterTimeoutCannotResurrectTheResult() {
    const harness = createHarness({
        deleteModes: { ExamSystemDB: 'blocked-then-late-success' }
    });
    const pending = harness.windowStub.SiteDataReset.perform({ reload: false });
    await flushAsync();
    harness.clock.advance(harness.clock.pendingDelays()[0]);
    const result = await withDeadline(pending, 'blocked reset with late success');
    assert.equal(result.success, false);

    // deleteDatabase cannot be aborted, so the browser may still fire onsuccess
    // later. The handlers that could have resolved the caller's promise must be
    // gone; whatever remains may only observe, never re-settle.
    const entry = harness.pendingRequests.find((item) => item.name === 'ExamSystemDB');
    assert.ok(entry, 'stub must have recorded the blocked request');

    // Replay what the browser would do once the other tab finally closes.
    harness.completeLateDeletion('ExamSystemDB');
    if (entry.request.onblocked) entry.request.onblocked({ target: entry.request });
    await flushAsync();
    assert.equal(result.success, false, 'a late success must not flip the reported outcome');
    assert.equal(result.terminal, false, 'a late success must not flip the reload verdict either');
    assert.equal(harness.clock.timers.size, 0, 'no timer may survive a settled deletion');
}

/**
 * The dangerous shape of an un-cancellable delete: it lands *after* the app has
 * reopened the database and written new user data, and wipes that data.
 *
 * The module cannot stop the browser from running the request, so the contract
 * under test is that it refuses to hand the user a "clean slate" illusion while
 * the request is still armed — the reset stays reported as pending, and a new
 * reset is refused rather than queued behind it.
 */
async function testLateDeletionIsTrackedUntilTheBrowserRunsIt() {
    const harness = createHarness({
        deleteModes: { IELTSAtlasDataV2: 'blocked-forever' }
    });
    const markerKey = harness.windowStub.SiteDataReset.PENDING_DELETION_MARKER_KEY;
    const pending = harness.windowStub.SiteDataReset.perform({ reload: false });
    await flushAsync();
    harness.clock.advance(harness.clock.pendingDelays()[0]);
    const result = await withDeadline(pending, 'blocked reset before late deletion');

    assert.equal(result.success, false);
    assert.equal(result.deletionPending, true,
        'an abandoned deleteDatabase request is still armed and must be reported as pending');
    assert.deepEqual(JSON.parse(JSON.stringify(result.pendingDatabases)), ['IELTSAtlasDataV2']);
    assert.equal(harness.windowStub.SiteDataReset.isDeletionPending(), true);
    assert.deepEqual(
        JSON.parse(JSON.stringify(harness.windowStub.SiteDataReset.pendingDeletions())),
        ['IELTSAtlasDataV2']
    );
    assert.ok(harness.localStorage.values.has(markerKey),
        'the pending state must survive the reload that follows a reset');

    // The user keeps working; the app writes a new record into the database that
    // was never deleted.
    harness.writeFreshData('IELTSAtlasDataV2', 'record-written-after-reset');

    // The blocking tab finally closes and the browser drains the old request.
    harness.completeLateDeletion('IELTSAtlasDataV2');
    await flushAsync();

    assert.equal(harness.windowStub.SiteDataReset.isDeletionPending(), false,
        'the pending state must clear once the browser reports the deletion done');
    assert.deepEqual(JSON.parse(JSON.stringify(harness.windowStub.SiteDataReset.pendingDeletions())), []);
    assert.equal(harness.localStorage.values.has(markerKey), false,
        'a retired deletion must not leave a stale cross-refresh marker behind');
    assert.equal(result.success, false, 'the already-returned outcome must not be rewritten');

    // Documents the hazard this state exists for: the late delete really did
    // take the freshly written row with it. Nothing in JS can prevent that, which
    // is precisely why the user must be warned instead of shown a clean slate.
    assert.deepEqual(harness.databaseContents.get('IELTSAtlasDataV2'), [],
        'the late deletion drops data written after the reset - hence the pending warning');
}

/** A second reset must not queue another un-cancellable delete behind the first. */
async function testSecondResetIsRefusedWhileADeletionIsStillPending() {
    const harness = createHarness({
        deleteModes: { IELTSAtlasDataV2: 'blocked-forever' }
    });
    const pending = harness.windowStub.SiteDataReset.perform({ reload: false });
    await flushAsync();
    harness.clock.advance(harness.clock.pendingDelays()[0]);
    await withDeadline(pending, 'blocked reset before duplicate attempt');

    const deletesAfterFirst = harness.events.filter((entry) => entry.startsWith('delete:')).length;
    const messagesBefore = harness.messages.length;
    // Asserted before the second call: without it a regression would silently
    // start a real reset that parks on the fake clock, turning a clear failure
    // into a suite-wide timeout.
    assert.equal(harness.windowStub.SiteDataReset.isDeletionPending(), true,
        'the abandoned request must be registered before a duplicate reset is attempted');
    const second = await withDeadline(
        harness.windowStub.clearCache(),
        'duplicate reset while a deletion is pending'
    );

    assert.equal(second.success, false, 'a reset that was refused must not report success');
    assert.equal(second.reason, 'deletion_pending');
    assert.equal(second.deletionPending, true);
    assert.equal(second.terminal, false, 'a refused reset never tore the page down');
    assert.deepEqual(JSON.parse(JSON.stringify(second.pendingDatabases)), ['IELTSAtlasDataV2']);
    assert.equal(
        harness.events.filter((entry) => entry.startsWith('delete:')).length,
        deletesAfterFirst,
        'no second deleteDatabase request may be queued while one is still armed'
    );
    assert.equal(harness.windowStub.location.reloadCalls, 0);

    const explanation = harness.messages.slice(messagesBefore);
    assert.ok(explanation.length, 'a refused reset must tell the user why');
    assert.ok(
        explanation.some((entry) => /等待|其他 IELTS Atlas 标签页/.test(entry.message)),
        `refusal must explain the pending deletion, got: ${JSON.stringify(explanation)}`
    );

    // Once the browser drains the old request the button works again.
    harness.completeLateDeletion('IELTSAtlasDataV2');
    await flushAsync();
    harness.deleteModes.IELTSAtlasDataV2 = 'success';
    const third = await withDeadline(
        harness.windowStub.SiteDataReset.perform({ reload: false }),
        'reset after the pending deletion retired'
    );
    assert.equal(third.success, true, 'the refusal must lift once the deletion actually completes');
    assert.equal(
        harness.events.filter((entry) => entry.startsWith('delete:')).length,
        deletesAfterFirst + 3,
        'the unblocked retry must issue fresh deleteDatabase requests'
    );
}

async function testLiveDeletionNeverExpiresAndMarkerFailureStaysFailSafe() {
    const harness = createHarness({
        deleteModes: { IELTSAtlasDataV2: 'blocked-forever' },
        failLocalStorageWrites: true,
        failSessionStorageWrites: true
    });
    const pending = harness.windowStub.SiteDataReset.perform();
    await flushAsync();
    harness.clock.advance(harness.clock.pendingDelays()[0]);
    const first = await withDeadline(pending, 'blocked reset with marker write failure');

    assert.equal(first.success, false);
    assert.equal(first.terminal, false, 'marker failure must not reload away the in-memory observer');
    assert.equal(first.markerPersisted, true,
        'window.name must preserve unknown deletion evidence when both Web Storage writes fail');
    assert.equal(first.deletionState, 'pending');
    assert.equal(harness.windowStub.SiteDataReset.deletionState(), 'pending');
    assert.equal(harness.windowStub.location.reloadCalls, 0);
    assert.equal(harness.localStorage.values.size, 0);
    assert.equal(harness.sessionStorage.values.size, 0);
    assert.match(harness.windowStub.name, /IELTS_ATLAS_SITE_RESET/,
        'the same-tab reload fallback must carry a namespaced marker');

    const reloaded = createHarness({ windowName: harness.windowStub.name });
    assert.equal(reloaded.windowStub.SiteDataReset.deletionState(), 'unknown',
        'a new realm cannot observe the old IDBRequest and must call persisted evidence unknown');
    const restricted = await reloaded.windowStub.SiteDataReset.perform({ reload: false });
    assert.equal(restricted.reason, 'recovery_confirmation_required');
    assert.equal(restricted.deletionState, 'unknown');
    assert.equal(reloaded.events.filter((entry) => entry.startsWith('delete:')).length, 0,
        'unknown evidence must not queue another delete without recovery confirmation');

    const recovered = await reloaded.windowStub.SiteDataReset.perform({
        reload: false,
        recoveryConfirmed: true
    });
    assert.equal(recovered.success, true);
    assert.equal(recovered.deletionState, 'retired',
        'a confirmed recovery is retired only after fresh delete requests complete');
    assert.equal(reloaded.windowStub.SiteDataReset.deletionState(), 'retired');
    assert.doesNotMatch(reloaded.windowStub.name, /IELTS_ATLAS_SITE_RESET/,
        'verified recovery must clear the fallback instead of creating an unbounded lock');

    // Advance far beyond the removed 60-second lock. Only the request's actual
    // terminal event is allowed to make this realm safe or queue another delete.
    harness.clock.advance(10 * 60 * 1000);
    const deletesBeforeRetry = harness.events.filter((entry) => entry.startsWith('delete:')).length;
    const refused = await harness.windowStub.SiteDataReset.perform({ reload: false });
    assert.equal(refused.reason, 'deletion_pending');
    assert.equal(refused.deletionState, 'pending');
    assert.equal(harness.windowStub.SiteDataReset.isDeletionPending(), true);
    assert.equal(harness.events.filter((entry) => entry.startsWith('delete:')).length, deletesBeforeRetry);

    harness.completeLateDeletion('IELTSAtlasDataV2');
    await flushAsync();
    assert.equal(harness.windowStub.SiteDataReset.isDeletionPending(), false,
        'only the late success event may retire a live deletion');
    assert.equal(harness.windowStub.SiteDataReset.deletionState(), 'retired');
}

/**
 * A marker left by a previous page load cannot be observed directly. It must
 * require explicit recovery confirmation before another delete is queued.
 */
async function testCrossRefreshMarkerRequiresConfirmedRecovery() {
    const markerKey = 'ielts_atlas:v2:site-reset:pending-deletions';
    const harness = createHarness({
        deferMessageCenter: true,
        seedLocalStorage: {
            [markerKey]: JSON.stringify({ databases: ['IELTSAtlasDataV2'], at: Date.now() })
        }
    });

    // core-foundation loads before the bundle that defines showMessage, so the
    // adoption warning must wait for the UI layer instead of being swallowed by
    // the console.log fallback.
    assert.equal(harness.messages.length, 0, 'the warning cannot be delivered before showMessage exists');
    harness.installMessageCenter();
    harness.clock.advance(250);
    assert.ok(
        harness.messages.some((entry) => entry.type === 'warning' && /等待/.test(entry.message)),
        `a reloaded page must surface the still-armed deletion, got: ${JSON.stringify(harness.messages)}`
    );
    assert.deepEqual(
        JSON.parse(JSON.stringify(harness.windowStub.SiteDataReset.pendingDeletions())),
        ['IELTSAtlasDataV2'],
        'the adopted marker must be visible to callers'
    );

    const restricted = await withDeadline(
        harness.windowStub.SiteDataReset.perform({ reload: false }),
        'unconfirmed recovery after adopting a marker'
    );
    assert.equal(restricted.success, false);
    assert.equal(restricted.reason, 'recovery_confirmation_required');
    assert.equal(restricted.recoveryConfirmationRequired, true);
    assert.equal(harness.events.filter((entry) => entry.startsWith('delete:')).length, 0,
        'unconfirmed recovery must not grow the un-cancellable deletion queue');

    const result = await withDeadline(
        harness.windowStub.SiteDataReset.perform({ reload: false, recoveryConfirmed: true }),
        'confirmed recovery after adopting a marker'
    );
    assert.equal(result.success, true, 'explicit confirmation must provide a bounded recovery path');
    assert.equal(
        harness.events.filter((entry) => entry.startsWith('delete:')).length, 3,
        'the recovery reset must really run'
    );
    assert.equal(harness.localStorage.values.has(markerKey), false,
        'a completed reset must clear the adopted marker');
    assert.deepEqual(JSON.parse(JSON.stringify(harness.windowStub.SiteDataReset.pendingDeletions())), [],
        'the recovery reset must retire the adopted name');
}

/** Expired or malformed evidence stays restricted but has a confirmed recovery path. */
async function testStaleOrCorruptMarkerRequiresConfirmedRecovery() {
    const markerKey = 'ielts_atlas:v2:site-reset:pending-deletions';
    const expired = createHarness({
        seedLocalStorage: {
            [markerKey]: JSON.stringify({ databases: ['IELTSAtlasDataV2'], at: Date.now() - 3600000 })
        }
    });
    assert.deepEqual(JSON.parse(JSON.stringify(expired.windowStub.SiteDataReset.pendingDeletions())),
        ['IELTSAtlasDataV2'], 'expired evidence must not become an automatic false-safe state');
    const expiredRestricted = await expired.windowStub.SiteDataReset.perform({ reload: false });
    assert.equal(expiredRestricted.reason, 'recovery_confirmation_required');
    assert.equal(expiredRestricted.markerExpired, true);
    const expiredRecovered = await expired.windowStub.SiteDataReset.perform({
        reload: false,
        recoveryConfirmed: true
    });
    assert.equal(expiredRecovered.success, true, 'confirmation must avoid a permanent stale-marker lock');

    const corrupt = createHarness({ seedLocalStorage: { [markerKey]: 'not json at all' } });
    assert.deepEqual(JSON.parse(JSON.stringify(corrupt.windowStub.SiteDataReset.pendingDeletions())),
        ['IELTSAtlasDataV2', 'ExamSystemDB', 'IELTSAtlasExternalBackupV2'],
        'an unparseable marker must fail safe because its affected names are unknown');
    const corruptRestricted = await corrupt.windowStub.SiteDataReset.perform({ reload: false });
    assert.equal(corruptRestricted.reason, 'recovery_confirmation_required');
    assert.equal(corruptRestricted.markerCorrupt, true);
    const corruptRecovered = await corrupt.windowStub.SiteDataReset.perform({
        reload: false,
        recoveryConfirmed: true
    });
    assert.equal(corruptRecovered.success, true);
}

/** `terminal` must describe what actually happened, not what usually happens. */
async function testTerminalFlagReflectsWhetherTheReloadReallyHappened() {
    const noReload = createHarness();
    const noReloadResult = await withDeadline(
        noReload.windowStub.SiteDataReset.perform({ reload: false }),
        'successful reset without reload'
    );
    assert.equal(noReloadResult.success, true);
    assert.equal(noReload.windowStub.location.reloadCalls, 0, 'reload:false must not reload');
    assert.equal(noReloadResult.terminal, false,
        'terminal must be false when the page was never torn down');

    const reloaded = createHarness();
    const reloadedResult = await withDeadline(
        reloaded.windowStub.SiteDataReset.perform(),
        'successful reset with reload'
    );
    assert.equal(reloaded.windowStub.location.reloadCalls, 1);
    assert.equal(reloadedResult.terminal, true, 'terminal must be true when the page really reloaded');

    // Same contract on the failure path.
    const failedNoReload = createHarness({ deleteModes: { ExamSystemDB: 'error' } });
    const failedResult = await withDeadline(
        failedNoReload.windowStub.SiteDataReset.perform({ reload: false }),
        'failed reset without reload'
    );
    assert.equal(failedResult.success, false);
    assert.equal(failedNoReload.windowStub.location.reloadCalls, 0);
    assert.equal(failedResult.terminal, false,
        'a failed reset that did not reload must not claim the page is gone');
}

/**
 * The singleton collapses duplicate clicks on one in-flight run; it is not a
 * result cache. A settled non-terminal reset must be replayable for real.
 */
async function testSuccessfulNonTerminalResetCanRunAgain() {
    const harness = createHarness();
    const first = await withDeadline(
        harness.windowStub.SiteDataReset.perform({ reload: false }),
        'first non-terminal reset'
    );
    assert.equal(first.success, true);
    const deletesAfterFirst = harness.events.filter((entry) => entry.startsWith('delete:')).length;
    assert.equal(deletesAfterFirst, 3);

    // The user writes new data, then asks for a clean slate a second time.
    harness.writeFreshData('IELTSAtlasDataV2', 'record-written-after-first-reset');
    harness.localStorage.setItem('written-after-first-reset', '1');

    const second = await withDeadline(
        harness.windowStub.SiteDataReset.perform({ reload: false }),
        'second non-terminal reset'
    );
    assert.equal(second.success, true);
    assert.notEqual(second, first, 'the settled promise must not be replayed as the second result');
    assert.equal(
        harness.events.filter((entry) => entry.startsWith('delete:')).length,
        deletesAfterFirst + 3,
        'a second reset must actually re-issue every deleteDatabase request'
    );
    assert.equal(harness.localStorage.clearCalls, 2, 'a second reset must actually clear web storage again');
    assert.equal(harness.localStorage.values.size, 0);
    assert.deepEqual(harness.databaseContents.get('IELTSAtlasDataV2'), [],
        'data written between the two resets must really be gone');
}

/** Concurrent clicks on one run still collapse into a single reset. */
async function testConcurrentCallsShareOneInFlightReset() {
    const harness = createHarness();
    const [first, second] = await withDeadline(
        Promise.all([
            harness.windowStub.SiteDataReset.perform({ reload: false }),
            harness.windowStub.SiteDataReset.perform({ reload: false })
        ]),
        'concurrent resets'
    );
    assert.equal(first.success, true);
    assert.equal(second, first, 'overlapping calls must share the in-flight promise');
    assert.equal(harness.events.filter((entry) => entry.startsWith('delete:')).length, 3,
        'a double click must not delete every database twice');
    assert.equal(harness.externalBackup.prepareCalls, 1);
}

async function main() {
    await testCancelledResetHasNoSideEffects();
    await testSuccessfulResetReturnsToFreshBrowserState();
    await testBlockedDeletionWaitsAndWarns();
    await testDeletionFailureDoesNotClaimSuccessOrReload();
    await testExternalQuiesceFailureCannotBlockRecoveryReset();
    await testPendingExternalQuiesceTimesOutAndConcurrentCallsShareRecovery();
    await testQuiesceTimeoutNonTerminalResetCanRunAgain();
    await testPermanentlyBlockedDeletionTimesOutInsteadOfHanging();
    await testBlockedTimeoutStillCompletesTerminalCleanup();
    await testBlockedResetCanBeRetriedAfterOtherTabCloses();
    await testLateSuccessAfterTimeoutCannotResurrectTheResult();
    await testLateDeletionIsTrackedUntilTheBrowserRunsIt();
    await testSecondResetIsRefusedWhileADeletionIsStillPending();
    await testLiveDeletionNeverExpiresAndMarkerFailureStaysFailSafe();
    await testCrossRefreshMarkerRequiresConfirmedRecovery();
    await testStaleOrCorruptMarkerRequiresConfirmedRecovery();
    await testTerminalFlagReflectsWhetherTheReloadReallyHappened();
    await testSuccessfulNonTerminalResetCanRunAgain();
    await testConcurrentCallsShareOneInFlightReset();
    console.log('SiteDataReset tests passed');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
