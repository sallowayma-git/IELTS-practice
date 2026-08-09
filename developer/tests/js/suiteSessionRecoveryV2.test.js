#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const source = fs.readFileSync(path.join(repoRoot, 'js/app/suitePracticeMixin.js'), 'utf8');

function createSessionStore() {
    const values = new Map();
    const calls = { save: 0, get: 0, discard: 0 };
    return {
        save(name, value) { calls.save += 1; values.set(String(name), structuredClone(value)); return true; },
        get(name) { calls.get += 1; return values.has(String(name)) ? structuredClone(values.get(String(name))) : null; },
        discard(name) { calls.discard += 1; values.delete(String(name)); return true; },
        peek(name) { return values.get(String(name)) || null; },
        calls
    };
}

function createPassthroughLockManager() {
    return {
        async request(name, options, callback) {
            return callback({ name, mode: options && options.mode || 'exclusive' });
        }
    };
}

function createExclusiveLockManager() {
    const held = new Map();
    const calls = [];
    let nextError = null;
    return {
        held,
        calls,
        failNext(error) { nextError = error; },
        async request(name, options, callback) {
            calls.push({ name: String(name), options: structuredClone(options || {}) });
            if (nextError) {
                const error = nextError;
                nextError = null;
                throw error;
            }
            assert.equal(options && options.mode, 'exclusive');
            assert.equal(options && options.ifAvailable, true, 'claim contention must never queue a stale WAL');
            if (held.has(String(name))) return callback(null);
            const lock = { name: String(name), mode: 'exclusive' };
            held.set(String(name), lock);
            try {
                return await callback(lock);
            } finally {
                if (held.get(String(name)) === lock) held.delete(String(name));
            }
        }
    };
}

function createHarness(options = {}) {
    const sessionStore = options.sessionStore || createSessionStore();
    const activeSessionStore = options.activeSessionStore || new Map();
    const recoveryFenceStore = options.recoveryFenceStore || new Map();
    const realisticRecoveryStore = options.realisticRecoveryStore === true;
    const recoveryRevision = (item) => {
        const revision = Number(item && item.revision);
        return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
    };
    const recoveryGroup = (item) => {
        const explicit = String(item && item._recoveryExclusiveGroup || '').trim();
        if (explicit) return explicit;
        return item && item.schema === 'suite-session-v2' && Number(item.version) === 2
            ? 'suite-practice'
            : '';
    };
    const cloneRecoveryOptions = (value = {}) => Object.fromEntries(Object.entries(value)
        .filter(([, entry]) => typeof entry !== 'function')
        .map(([key, entry]) => [key, structuredClone(entry)]));
    const recoveryCalls = {
        save: 0,
        discard: 0,
        cleanup: 0,
        saveQueue: [],
        discardQueue: [],
        discardOptions: [],
        listedItems: null,
        listQueue: [],
        list: 0
    };
    const messages = [];
    const practiceFinalizes = [];
    const rawStorageTrap = new Proxy({}, {
        get() {
            throw new Error('suite recovery must use AppData v2, not raw Web Storage');
        },
        set() {
            throw new Error('suite recovery must use AppData v2, not raw Web Storage');
        }
    });
    const protocol = options.protocol === 'file:' ? 'file:' : 'http:';
    const windowStub = {
        location: {
            protocol,
            href: protocol === 'file:' ? 'file:///index.html' : 'http://localhost/'
        },
        localStorage: rawStorageTrap,
        sessionStorage: rawStorageTrap,
        showMessage(text, type) { messages.push({ text, type }); },
        addEventListener() {},
        removeEventListener() {}
    };
    windowStub.navigator = options.locks === null
        ? {}
        : { locks: options.locks || createPassthroughLockManager() };
    const sandbox = {
        window: windowStub,
        console,
        Date,
        Math,
        JSON,
        Array,
        Object,
        Map,
        Set,
        URL,
        structuredClone,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        AppData: {
            ready: Promise.resolve(),
            recovery: {
                windowSession: sessionStore,
                async listActiveSessions() {
                    recoveryCalls.list += 1;
                    if (options.listActiveSessionsError) throw options.listActiveSessionsError;
                    const items = recoveryCalls.listQueue.length
                        ? recoveryCalls.listQueue.shift()
                        : Array.isArray(recoveryCalls.listedItems)
                        ? recoveryCalls.listedItems
                        : Array.from(activeSessionStore.values());
                    return items
                        .filter((value) => !realisticRecoveryStore || value?._recoveryTombstone !== true)
                        .map((value) => structuredClone(value));
                },
                async getActiveSessionFence(id) {
                    const normalizedId = String(id);
                    if (recoveryFenceStore.has(normalizedId)) {
                        return structuredClone(recoveryFenceStore.get(normalizedId));
                    }
                    const active = activeSessionStore.get(normalizedId);
                    return active
                        ? {
                            id: normalizedId,
                            exists: true,
                            tombstoned: active._recoveryTombstone === true,
                            revision: recoveryRevision(active)
                        }
                        : { id: normalizedId, exists: false, tombstoned: false, revision: 0 };
                },
                async saveActiveSession(value, options = {}) {
                    recoveryCalls.save += 1;
                    const behavior = recoveryCalls.saveQueue.length ? recoveryCalls.saveQueue.shift() : true;
                    const outcome = typeof behavior === 'function'
                        ? await behavior(structuredClone(value), cloneRecoveryOptions(options))
                        : behavior;
                    if (outcome instanceof Error) throw outcome;
                    if (outcome === false || (outcome && outcome.committed === false)) {
                        return outcome === false ? { committed: false } : structuredClone(outcome);
                    }
                    if (typeof options.commitGuard === 'function' && options.commitGuard() === false) {
                        return { committed: false, stale: true, reason: 'COMMIT_GUARD_REJECTED' };
                    }
                    const normalizedId = String(value.id);
                    if (realisticRecoveryStore
                        && Object.prototype.hasOwnProperty.call(options, 'expectedEntityRevision')) {
                        const expectedRevision = Number(options.expectedEntityRevision);
                        const active = activeSessionStore.get(normalizedId);
                        const actualRevision = active ? recoveryRevision(active) : 0;
                        if (actualRevision !== expectedRevision) {
                            return {
                                committed: false,
                                stale: true,
                                code: 'STALE_RECOVERY_WRITE',
                                expectedEntityRevision: expectedRevision,
                                actualEntityRevision: actualRevision
                            };
                        }
                    }
                    const exclusiveGroup = String(options.exclusiveGroup || '').trim();
                    if (realisticRecoveryStore && exclusiveGroup) {
                        const conflicting = Array.from(activeSessionStore.entries()).find(([id, item]) => (
                            String(id) !== normalizedId
                            && item?._recoveryTombstone !== true
                            && recoveryGroup(item) === exclusiveGroup
                        ));
                        if (conflicting) {
                            return {
                                committed: false,
                                stale: true,
                                code: 'RECOVERY_GROUP_CONFLICT',
                                conflictingEntityId: String(conflicting[0])
                            };
                        }
                    }
                    const storedValue = structuredClone(value);
                    if (exclusiveGroup) storedValue._recoveryExclusiveGroup = exclusiveGroup;
                    activeSessionStore.set(normalizedId, storedValue);
                    recoveryFenceStore.set(String(value.id), {
                        id: String(value.id),
                        exists: true,
                        tombstoned: false,
                        revision: recoveryRevision(value)
                    });
                    return outcome && typeof outcome === 'object'
                        ? { ...structuredClone(outcome), committed: true, item: structuredClone(value) }
                        : { committed: true, item: structuredClone(value) };
                },
                async discardActiveSession(id, options = {}) {
                    recoveryCalls.discard += 1;
                    recoveryCalls.discardOptions.push(cloneRecoveryOptions(options));
                    const behavior = recoveryCalls.discardQueue.length ? recoveryCalls.discardQueue.shift() : true;
                    const outcome = typeof behavior === 'function'
                        ? await behavior(String(id), cloneRecoveryOptions(options))
                        : behavior;
                    if (outcome instanceof Error) throw outcome;
                    if (outcome === false || (outcome && outcome.committed === false)) {
                        return outcome === false ? { committed: false } : structuredClone(outcome);
                    }
                    if (typeof options.commitGuard === 'function' && options.commitGuard() === false) {
                        return { committed: false, stale: true, reason: 'COMMIT_GUARD_REJECTED' };
                    }
                    const normalizedId = String(id);
                    if (realisticRecoveryStore
                        && Object.prototype.hasOwnProperty.call(options, 'expectedEntityRevision')) {
                        const expectedRevision = Number(options.expectedEntityRevision);
                        const active = activeSessionStore.get(normalizedId);
                        const actualRevision = active ? recoveryRevision(active) : 0;
                        if (actualRevision !== expectedRevision) {
                            return {
                                committed: false,
                                stale: true,
                                code: 'STALE_RECOVERY_WRITE',
                                expectedEntityRevision: expectedRevision,
                                actualEntityRevision: actualRevision
                            };
                        }
                        activeSessionStore.set(normalizedId, {
                            id: normalizedId,
                            revision: Math.min(Number.MAX_SAFE_INTEGER, actualRevision + 1),
                            _recoveryTombstone: true,
                            discardedAt: Date.now()
                        });
                    } else {
                        activeSessionStore.delete(normalizedId);
                    }
                    if (Object.prototype.hasOwnProperty.call(options, 'expectedEntityRevision')) {
                        const expectedRevision = Number(options.expectedEntityRevision);
                        recoveryFenceStore.set(normalizedId, {
                            id: normalizedId,
                            exists: true,
                            tombstoned: true,
                            revision: Number.isSafeInteger(expectedRevision) && expectedRevision >= 0
                                ? Math.min(Number.MAX_SAFE_INTEGER, expectedRevision + 1)
                                : 1
                        });
                    } else {
                        recoveryFenceStore.delete(String(id));
                    }
                    return outcome && typeof outcome === 'object'
                        ? { ...structuredClone(outcome), committed: true }
                        : { committed: true };
                },
                async cleanupForRetry() {
                    recoveryCalls.cleanup += 1;
                    return { committed: true, removedCount: 0, removedByKind: {} };
                }
            },
            practice: {
                async finalizeSuite(command = {}) {
                    practiceFinalizes.push(structuredClone(command));
                    return { committed: true, record: structuredClone(command.record) };
                }
            }
        }
    };
    if (options.listActiveSessionsUnavailable === true) {
        delete sandbox.AppData.recovery.listActiveSessions;
    }
    windowStub.AppData = sandbox.AppData;
    windowStub.ExamSystemAppMixins = {};
    sandbox.globalThis = windowStub;
    const vmContext = vm.createContext(sandbox);
    vm.runInContext(source, vmContext, { filename: 'js/app/suitePracticeMixin.js' });
    const createVmMap = vm.runInContext('() => new Map()', vmContext);
    const mixin = windowStub.ExamSystemAppMixins.suitePractice;
    const sequence = ['p1', 'p2', 'p3'].map((examId, index) => ({
        examId,
        exam: { id: examId, title: `Passage ${index + 1}`, category: `P${index + 1}` },
        category: `P${index + 1}`
    }));
    const makeApp = () => {
        const app = {
            components: {},
            currentSuiteSession: null,
            suiteExamMap: new Map(),
            examWindows: createVmMap(),
            messages
        };
        Object.assign(app, mixin);
        let registrationGeneration = 0;
        app._installManagedTestWindow = (examId, targetWindow) => {
            registrationGeneration += 1;
            app.examWindows.set(examId, {
                window: targetWindow,
                suiteSessionId: app.currentSuiteSession && app.currentSuiteSession.id || null,
                registrationToken: `test-registration-${registrationGeneration}`,
                sessionGeneration: registrationGeneration
            });
            return targetWindow;
        };
        app._captureExamSessionRegistration = (examId, windowInfo) => Object.freeze({
            examId,
            window: windowInfo.window,
            suiteSessionId: String(windowInfo.suiteSessionId || ''),
            registrationToken: windowInfo.registrationToken,
            sessionGeneration: windowInfo.sessionGeneration
        });
        app._isExamSessionRegistrationCurrent = (examId, registration) => {
            const current = app.examWindows.get(examId);
            return !!current
                && current.window === registration.window
                && String(current.suiteSessionId || '') === String(registration.suiteSessionId || '')
                && current.registrationToken === registration.registrationToken
                && current.sessionGeneration === registration.sessionGeneration;
        };
        let launchSequence = 0;
        const launchReceipts = new WeakMap();
        app._beginExamLaunchOwnership = (examId) => Object.freeze({
            examId: String(examId || ''),
            sequence: ++launchSequence,
            initialState: null,
            targetLeaseKeys: Object.freeze([])
        });
        app._isExamLaunchOwnershipCurrent = (examId, ownership) => Boolean(
            ownership && String(ownership.examId || '') === String(examId || '')
        );
        app._claimExamLaunchWindowOwnership = () => true;
        app._commitExamLaunchOwnership = () => true;
        app._rollbackExamLaunchOwnership = () => true;
        app._recordExamLaunchRegistrationReceipt = (examId, ownership, registration) => {
            if (!ownership || !registration) return false;
            launchReceipts.set(ownership, { examId: String(examId || ''), registration });
            return true;
        };
        app._captureExamLaunchRegistrationReceipt = (examId, ownership, targetWindow = null) => {
            const receipt = ownership && launchReceipts.get(ownership);
            if (!receipt
                || receipt.examId !== String(examId || '')
                || (targetWindow && receipt.registration.window !== targetWindow)
                || !app._isExamSessionRegistrationCurrent(examId, receipt.registration)) return null;
            return receipt.registration;
        };
        let openExamImplementation = null;
        Object.defineProperty(app, 'openExam', {
            configurable: true,
            get() {
                return openExamImplementation;
            },
            set(implementation) {
                openExamImplementation = async (...args) => {
                    const targetWindow = await implementation.apply(app, args);
                    if (!targetWindow || targetWindow.closed) return targetWindow;
                    app._installManagedTestWindow(args[0], targetWindow);
                    const launchOwnership = args[1] && args[1].launchOwnership;
                    if (launchOwnership) {
                        app._recordExamLaunchRegistrationReceipt(
                            args[0],
                            launchOwnership,
                            app._captureExamSessionRegistration(args[0], app.examWindows.get(args[0]))
                        );
                    }
                    return targetWindow;
                };
            }
        });
        app._clearSuiteHandshakes = () => {};
        app._ensureSuiteWindowGuard = () => {};
        app._releaseSuiteWindowGuard = () => {};
        app._focusSuiteWindow = () => {};
        app._sendSimulationContext = () => true;
        app.updateExamStatus = () => {};
        app.cleanupExamSession = async () => {};
        return app;
    };
    sandbox.localStorage = rawStorageTrap;
    sandbox.sessionStorage = rawStorageTrap;
    return {
        sessionStore,
        activeSessionStore,
        recoveryFenceStore,
        recoveryCalls,
        messages,
        practiceFinalizes,
        makeApp,
        sequence
    };
}

async function main() {
    const fixtureTimeBase = Date.now() - 60_000;
    const { sessionStore, activeSessionStore, messages, practiceFinalizes, makeApp, sequence } = createHarness();
    const firstApp = makeApp();
    let firstWindow;
    firstApp.openExam = async () => {
        const snapshot = sessionStore.peek('simulation');
        assert.equal(snapshot.status, 'active');
        assert.equal(snapshot.currentIndex, 0);
        assert.equal(snapshot.sequence.length, 3);
        firstWindow = { closed: false, name: 'suite-window' };
        return firstWindow;
    };
    assert.equal(await firstApp._launchSuiteSessionFromSequence(sequence, { flowMode: 'simulation' }), true);
    assert.equal(sessionStore.peek('simulation').status, 'active');

    const tabOwnedWal = structuredClone(sessionStore.peek('simulation'));
    const tabOwnedDurable = structuredClone(activeSessionStore.get(tabOwnedWal.id));
    assert(tabOwnedDurable, 'fixture must persist the tab-owned suite recovery');

    const durableOnlySingleLocks = createExclusiveLockManager();
    const olderDurableSingle = {
        ...structuredClone(tabOwnedDurable),
        id: 'suite-durable-only-older',
        lastUpdate: fixtureTimeBase + 100
    };
    const newestDurableSingle = {
        ...structuredClone(tabOwnedDurable),
        id: 'suite-durable-only-newest',
        lastUpdate: fixtureTimeBase + 200
    };
    const durableOnlySingleStore = new Map([
        [olderDurableSingle.id, olderDurableSingle],
        [newestDurableSingle.id, newestDurableSingle]
    ]);
    const durableSingleOwnerHarness = createHarness({
        locks: durableOnlySingleLocks,
        activeSessionStore: durableOnlySingleStore,
        realisticRecoveryStore: true
    });
    const durableSingleOwnerApp = durableSingleOwnerHarness.makeApp();
    const heldNewestSingle = durableSingleOwnerApp._restoreSessionFromStorage(newestDurableSingle);
    assert.equal(await durableSingleOwnerApp._acquireSuiteRecoveryClaim('single', heldNewestSingle), true);

    const emptyHttpTabHarness = createHarness({
        locks: durableOnlySingleLocks,
        activeSessionStore: durableOnlySingleStore,
        realisticRecoveryStore: true
    });
    const emptyHttpTabApp = emptyHttpTabHarness.makeApp();
    emptyHttpTabApp.initializeSuiteMode();
    await emptyHttpTabApp._ensureSuiteRecoveryReady();
    assert.equal(emptyHttpTabApp.currentSuiteSession, null, 'a fresh HTTP tab must not bypass the newest durable owner lease');
    assert.equal(emptyHttpTabHarness.recoveryCalls.discard, 0, 'lease contention must not clean durable recovery');
    assert.equal(
        durableOnlySingleLocks.calls.filter((call) => call.name === emptyHttpTabApp._suiteRecoveryClaimName(olderDurableSingle.id)).length,
        0,
        'newest single contention must not fall back to an older durable id'
    );
    assert.equal(await durableSingleOwnerApp._releaseSuiteRecoveryClaim('single', heldNewestSingle), true);

    const heldOlderSingle = durableSingleOwnerApp._restoreSessionFromStorage(olderDurableSingle);
    assert.equal(await durableSingleOwnerApp._acquireSuiteRecoveryClaim('single', heldOlderSingle), true);
    assert.equal(await emptyHttpTabApp._refreshSuiteRecoveryCandidates(), null);
    assert.equal(emptyHttpTabApp.currentSuiteSession, null, 'an active older singleton must block coordinated takeover of the whole group');
    assert.equal(emptyHttpTabHarness.recoveryCalls.discard, 0, 'older-owner contention must not partially clean the singleton group');
    assert.equal(durableOnlySingleStore.get(olderDurableSingle.id)._recoveryTombstone, undefined);
    assert.equal(durableOnlySingleStore.get(newestDurableSingle.id)._recoveryTombstone, undefined);
    assert.equal(
        durableOnlySingleLocks.held.has(emptyHttpTabApp._suiteRecoveryClaimName(newestDurableSingle.id)),
        false,
        'a failed group claim must release the provisional authoritative lock'
    );
    assert.equal(await durableSingleOwnerApp._releaseSuiteRecoveryClaim('single', heldOlderSingle), true);

    assert.equal(await emptyHttpTabApp._refreshSuiteRecoveryCandidates(), emptyHttpTabApp.currentSuiteSession);
    assert.equal(emptyHttpTabApp.currentSuiteSession.id, newestDurableSingle.id, 'the same tab must take over the newest durable after owner release');
    assert.equal(emptyHttpTabHarness.recoveryCalls.discard, 1, 'takeover must tombstone the older singleton before installing the newest');
    assert.equal(emptyHttpTabHarness.recoveryCalls.discardOptions[0].expectedEntityRevision, Number(olderDurableSingle.revision) || 0);
    assert.equal(durableOnlySingleStore.get(olderDurableSingle.id)._recoveryTombstone, true);
    assert.equal(
        durableOnlySingleStore.get(olderDurableSingle.id).revision,
        (Number(olderDurableSingle.revision) || 0) + 1
    );
    assert.equal(durableOnlySingleLocks.held.size, 1);
    emptyHttpTabApp.currentSuiteSession.revision += 1;
    emptyHttpTabApp.currentSuiteSession.lastUpdate = Date.now();
    assert.equal(
        await emptyHttpTabApp._commitSuiteRecovery(emptyHttpTabApp.currentSuiteSession, { notify: false }),
        true,
        'the newest singleton must commit after coordinated cleanup removes the legacy group conflict'
    );
    assert.equal(durableOnlySingleStore.get(newestDurableSingle.id)._recoveryExclusiveGroup, 'suite-practice');
    assert.equal(await emptyHttpTabApp._releaseSuiteRecoveryClaim('single', emptyHttpTabApp.currentSuiteSession), true);
    assert.equal(durableOnlySingleLocks.held.size, 0);

    const matchingGroupHttpLocks = createExclusiveLockManager();
    const matchingGroupHttpStore = new Map([
        [olderDurableSingle.id, structuredClone(olderDurableSingle)],
        [newestDurableSingle.id, structuredClone(newestDurableSingle)]
    ]);
    const matchingGroupOlderOwnerHarness = createHarness({
        locks: matchingGroupHttpLocks,
        activeSessionStore: matchingGroupHttpStore,
        realisticRecoveryStore: true
    });
    const matchingGroupOlderOwnerApp = matchingGroupOlderOwnerHarness.makeApp();
    const matchingGroupHeldOlder = matchingGroupOlderOwnerApp._restoreSessionFromStorage(olderDurableSingle);
    assert.equal(await matchingGroupOlderOwnerApp._acquireSuiteRecoveryClaim('single', matchingGroupHeldOlder), true);
    const matchingGroupHttpHarness = createHarness({
        locks: matchingGroupHttpLocks,
        activeSessionStore: matchingGroupHttpStore,
        realisticRecoveryStore: true
    });
    matchingGroupHttpHarness.sessionStore.save('simulation', structuredClone(newestDurableSingle));
    const matchingGroupHttpApp = matchingGroupHttpHarness.makeApp();
    matchingGroupHttpApp.initializeSuiteMode();
    await matchingGroupHttpApp._ensureSuiteRecoveryReady();
    assert.equal(matchingGroupHttpApp.currentSuiteSession, null, 'a matching WAL must remain quarantined while another singleton id is live');
    assert.equal(matchingGroupHttpHarness.recoveryCalls.discard, 0);
    assert.equal(matchingGroupHttpHarness.sessionStore.peek('simulation').id, newestDurableSingle.id);
    assert.equal(await matchingGroupOlderOwnerApp._releaseSuiteRecoveryClaim('single', matchingGroupHeldOlder), true);
    assert.equal(await matchingGroupHttpApp._refreshSuiteRecoveryCandidates(), matchingGroupHttpApp.currentSuiteSession);
    assert.equal(matchingGroupHttpApp.currentSuiteSession.id, newestDurableSingle.id);
    assert.equal(matchingGroupHttpStore.get(olderDurableSingle.id)._recoveryTombstone, true);
    matchingGroupHttpApp.currentSuiteSession.revision += 1;
    matchingGroupHttpApp.currentSuiteSession.lastUpdate = Date.now();
    assert.equal(await matchingGroupHttpApp._commitSuiteRecovery(
        matchingGroupHttpApp.currentSuiteSession,
        { notify: false }
    ), true, 'a matching HTTP WAL must commit after coordinated legacy-id cleanup');
    assert.equal(await matchingGroupHttpApp._releaseSuiteRecoveryClaim('single', matchingGroupHttpApp.currentSuiteSession), true);

    const splitWalGroupLocks = createExclusiveLockManager();
    const splitWalGroupStore = new Map([
        [olderDurableSingle.id, structuredClone(olderDurableSingle)],
        [newestDurableSingle.id, structuredClone(newestDurableSingle)]
    ]);
    const splitWalGroupTabA = createHarness({
        locks: splitWalGroupLocks,
        activeSessionStore: splitWalGroupStore,
        realisticRecoveryStore: true
    });
    const splitWalGroupTabB = createHarness({
        locks: splitWalGroupLocks,
        activeSessionStore: splitWalGroupStore,
        realisticRecoveryStore: true
    });
    splitWalGroupTabA.sessionStore.save('simulation', structuredClone(olderDurableSingle));
    splitWalGroupTabB.sessionStore.save('simulation', structuredClone(newestDurableSingle));
    const splitWalGroupAppA = splitWalGroupTabA.makeApp();
    const splitWalGroupAppB = splitWalGroupTabB.makeApp();
    splitWalGroupAppA.initializeSuiteMode();
    splitWalGroupAppB.initializeSuiteMode();
    await Promise.all([
        splitWalGroupAppA._ensureSuiteRecoveryReady(),
        splitWalGroupAppB._ensureSuiteRecoveryReady()
    ]);
    const splitWalOwners = [splitWalGroupAppA, splitWalGroupAppB]
        .filter((app) => app.currentSuiteSession);
    assert.equal(splitWalOwners.length, 1, 'different-id WAL tabs must elect one singleton owner');
    assert.equal(splitWalOwners[0].currentSuiteSession.id, newestDurableSingle.id);
    assert.equal(
        splitWalGroupTabA.recoveryCalls.discard + splitWalGroupTabB.recoveryCalls.discard,
        1,
        'the group winner must tombstone exactly the older durable identity'
    );
    assert.equal(splitWalGroupStore.get(olderDurableSingle.id)._recoveryTombstone, true);
    assert.equal(splitWalGroupStore.get(newestDurableSingle.id)._recoveryTombstone, undefined);
    const splitWalGroupName = splitWalGroupAppA._singleSuiteRecoveryGroupClaimName();
    assert.equal(
        splitWalGroupLocks.calls.filter((call) => call.name === splitWalGroupName).length,
        2,
        'both tabs must contend on the origin-wide singleton group lock first'
    );
    assert.deepEqual(
        splitWalGroupLocks.calls
            .map((call) => call.name)
            .filter((name) => name.startsWith('ielts-atlas:suite-recovery:'))
            .sort(),
        [
            splitWalGroupAppA._suiteRecoveryClaimName(olderDurableSingle.id),
            splitWalGroupAppA._suiteRecoveryClaimName(newestDurableSingle.id)
        ].sort(),
        'only the group winner may request the two coordinated exact identities'
    );
    assert.equal(splitWalGroupLocks.held.has(splitWalGroupName), false, 'the short-lived group lock must be released after install');
    assert.deepEqual(
        Array.from(splitWalGroupLocks.held.keys()),
        [splitWalGroupAppA._suiteRecoveryClaimName(newestDurableSingle.id)],
        'only the authoritative exact lease may survive recovery'
    );
    const splitWalLoserHarness = splitWalOwners[0] === splitWalGroupAppA
        ? splitWalGroupTabB
        : splitWalGroupTabA;
    assert.equal(
        splitWalLoserHarness.sessionStore.peek('simulation').recoveryLeaseContended,
        true,
        'group contention must preserve and mark the losing tab WAL for retry'
    );
    assert.equal(await splitWalOwners[0]._releaseSuiteRecoveryClaim(
        'single',
        splitWalOwners[0].currentSuiteSession
    ), true);
    assert.equal(splitWalGroupLocks.held.size, 0);
    const splitWalLoserApp = splitWalOwners[0] === splitWalGroupAppA
        ? splitWalGroupAppB
        : splitWalGroupAppA;
    assert.equal(
        await splitWalLoserApp._refreshSuiteRecoveryCandidates(),
        splitWalLoserApp.currentSuiteSession,
        'the marked group-contention WAL must remain retryable after owner release'
    );
    assert.equal(splitWalLoserApp.currentSuiteSession.id, newestDurableSingle.id);
    assert.equal(await splitWalLoserApp._releaseSuiteRecoveryClaim(
        'single',
        splitWalLoserApp.currentSuiteSession
    ), true);
    assert.equal(splitWalGroupLocks.held.size, 0);

    const matchingGroupFileStore = new Map([
        [olderDurableSingle.id, structuredClone(olderDurableSingle)],
        [newestDurableSingle.id, structuredClone(newestDurableSingle)]
    ]);
    const matchingGroupFileHarness = createHarness({
        protocol: 'file:',
        activeSessionStore: matchingGroupFileStore,
        realisticRecoveryStore: true
    });
    matchingGroupFileHarness.sessionStore.save('simulation', structuredClone(newestDurableSingle));
    const matchingGroupFileApp = matchingGroupFileHarness.makeApp();
    matchingGroupFileApp.initializeSuiteMode();
    await matchingGroupFileApp._ensureSuiteRecoveryReady();
    assert.equal(matchingGroupFileApp.currentSuiteSession.id, newestDurableSingle.id);
    assert.equal(matchingGroupFileStore.get(olderDurableSingle.id)._recoveryTombstone, true);
    matchingGroupFileApp.currentSuiteSession.revision += 1;
    matchingGroupFileApp.currentSuiteSession.lastUpdate = Date.now();
    assert.equal(await matchingGroupFileApp._commitSuiteRecovery(
        matchingGroupFileApp.currentSuiteSession,
        { notify: false }
    ), true, 'a matching file WAL must commit after coordinated legacy-id cleanup');
    assert.equal(await matchingGroupFileApp._releaseSuiteRecoveryClaim('single', matchingGroupFileApp.currentSuiteSession), true);

    const staleOlderWalLocks = createExclusiveLockManager();
    const staleOlderDurable = {
        ...structuredClone(olderDurableSingle),
        elapsedByExam: { p1: 111 }
    };
    const authoritativeNewerDurable = {
        ...structuredClone(newestDurableSingle),
        elapsedByExam: { p1: 999 }
    };
    const staleOlderWalStore = new Map([
        [staleOlderDurable.id, structuredClone(staleOlderDurable)],
        [authoritativeNewerDurable.id, structuredClone(authoritativeNewerDurable)]
    ]);
    const staleOlderWalHarness = createHarness({
        locks: staleOlderWalLocks,
        activeSessionStore: staleOlderWalStore,
        realisticRecoveryStore: true
    });
    staleOlderWalHarness.sessionStore.save('simulation', structuredClone(staleOlderDurable));
    const staleOlderWalApp = staleOlderWalHarness.makeApp();
    staleOlderWalApp.initializeSuiteMode();
    await staleOlderWalApp._ensureSuiteRecoveryReady();
    assert.equal(staleOlderWalApp.currentSuiteSession.id, authoritativeNewerDurable.id, 'a matching stale WAL must not override the newer singleton owner');
    assert.equal(staleOlderWalApp.currentSuiteSession.elapsedByExam.p1, 999, 'newer durable progress must survive group reconciliation');
    assert.equal(staleOlderWalStore.get(staleOlderDurable.id)._recoveryTombstone, true);
    staleOlderWalApp.currentSuiteSession.revision += 1;
    assert.equal(await staleOlderWalApp._commitSuiteRecovery(
        staleOlderWalApp.currentSuiteSession,
        { notify: false }
    ), true);
    assert.equal(await staleOlderWalApp._releaseSuiteRecoveryClaim('single', staleOlderWalApp.currentSuiteSession), true);

    const durableOnlyFileStore = new Map([
        [olderDurableSingle.id, structuredClone(olderDurableSingle)],
        [newestDurableSingle.id, structuredClone(newestDurableSingle)]
    ]);
    const durableOnlyFileHarness = createHarness({
        protocol: 'file:',
        activeSessionStore: durableOnlyFileStore,
        realisticRecoveryStore: true
    });
    const durableOnlyFileApp = durableOnlyFileHarness.makeApp();
    durableOnlyFileApp.initializeSuiteMode();
    await durableOnlyFileApp._ensureSuiteRecoveryReady();
    assert.equal(durableOnlyFileApp.currentSuiteSession.id, newestDurableSingle.id, 'file durable-only recovery must select the newest singleton');
    assert.equal(durableOnlyFileStore.get(olderDurableSingle.id)._recoveryTombstone, true, 'file durable-only recovery must clean the older group member first');
    durableOnlyFileApp.currentSuiteSession.revision += 1;
    assert.equal(await durableOnlyFileApp._commitSuiteRecovery(
        durableOnlyFileApp.currentSuiteSession,
        { notify: false }
    ), true, 'file durable-only recovery must commit after coordinated group cleanup');
    assert.equal(await durableOnlyFileApp._releaseSuiteRecoveryClaim('single', durableOnlyFileApp.currentSuiteSession), true);

    const vanishedSingleLocks = createExclusiveLockManager();
    const vanishedSingleHarness = createHarness({ locks: vanishedSingleLocks });
    vanishedSingleHarness.recoveryCalls.listQueue.push(
        [structuredClone(newestDurableSingle)],
        []
    );
    const vanishedSingleApp = vanishedSingleHarness.makeApp();
    vanishedSingleApp.initializeSuiteMode();
    await vanishedSingleApp._ensureSuiteRecoveryReady();
    assert.equal(vanishedSingleApp.currentSuiteSession, null, 'a durable clone that vanishes under its lease must not be exposed');
    assert.equal(vanishedSingleHarness.recoveryCalls.save, 0, 'a vanished durable clone must never expected=0 resurrect itself');
    assert.equal(vanishedSingleHarness.recoveryCalls.list, 2);
    assert.equal(vanishedSingleLocks.held.size, 0);

    for (const enumerationFailure of ['missing', 'throw']) {
        const unavailableSingleLocks = createExclusiveLockManager();
        const unavailableSingleHarness = createHarness({
            locks: unavailableSingleLocks,
            ...(enumerationFailure === 'missing'
                ? { listActiveSessionsUnavailable: true }
                : { listActiveSessionsError: new Error('active recovery enumeration failed') })
        });
        unavailableSingleHarness.sessionStore.save('simulation', structuredClone(tabOwnedWal));
        unavailableSingleHarness.recoveryFenceStore.set(String(tabOwnedWal.id), {
            id: String(tabOwnedWal.id),
            exists: true,
            tombstoned: true,
            revision: (Number(tabOwnedWal.revision) || 0) + 1
        });
        const unavailableSingleApp = unavailableSingleHarness.makeApp();
        unavailableSingleApp.initializeSuiteMode();
        await unavailableSingleApp._ensureSuiteRecoveryReady();
        assert.equal(
            unavailableSingleApp.currentSuiteSession,
            null,
            `HTTP single WAL must remain quarantined when durable enumeration is ${enumerationFailure}`
        );
        assert.equal(unavailableSingleHarness.recoveryCalls.save, 0);
        assert.equal(unavailableSingleHarness.sessionStore.peek('simulation').id, tabOwnedWal.id);
        assert.equal(unavailableSingleLocks.held.size, 0);
        assert.equal(
            unavailableSingleLocks.calls.filter((call) => (
                call.name === unavailableSingleApp._singleSuiteRecoveryGroupClaimName()
            )).length,
            1,
            `HTTP ${enumerationFailure} enumeration must release its acquired group coordination lock`
        );
    }

    const mismatchedWalLocks = createExclusiveLockManager();
    const mismatchedWalStore = new Map([
        [tabOwnedDurable.id, structuredClone(tabOwnedDurable)]
    ]);
    const mismatchedWalOwnerHarness = createHarness({
        locks: mismatchedWalLocks,
        activeSessionStore: mismatchedWalStore,
        realisticRecoveryStore: true
    });
    const mismatchedWalOwnerApp = mismatchedWalOwnerHarness.makeApp();
    const mismatchedForeignOwner = mismatchedWalOwnerApp._restoreSessionFromStorage(tabOwnedDurable);
    assert.equal(await mismatchedWalOwnerApp._acquireSuiteRecoveryClaim('single', mismatchedForeignOwner), true);
    const mismatchedWalHarness = createHarness({
        locks: mismatchedWalLocks,
        activeSessionStore: mismatchedWalStore,
        realisticRecoveryStore: true
    });
    const localWalId = 'suite-local-tab-owner';
    mismatchedWalHarness.sessionStore.save('simulation', {
        ...structuredClone(tabOwnedWal),
        id: localWalId,
        revision: 1,
        lastUpdate: Number(tabOwnedWal.lastUpdate) + 1
    });
    const mismatchedWalApp = mismatchedWalHarness.makeApp();
    mismatchedWalApp.initializeSuiteMode();
    await mismatchedWalApp._ensureSuiteRecoveryReady();
    assert.equal(mismatchedWalApp.currentSuiteSession, null, 'a mismatched pre-first-save WAL must remain quarantined while the durable singleton is live');
    assert.equal(mismatchedWalHarness.sessionStore.peek('simulation').id, localWalId, 'fail-closed coordination must preserve the local WAL bytes');
    assert.equal(mismatchedWalHarness.recoveryCalls.save, 0, 'the mismatched WAL must not attempt expected=0 against a foreign exclusive group');
    assert.equal(mismatchedWalHarness.activeSessionStore.has(tabOwnedDurable.id), true, 'mismatched foreign durable recovery must not be discarded');
    assert.equal(mismatchedWalHarness.recoveryCalls.discard, 0);
    assert.equal(await mismatchedWalOwnerApp._releaseSuiteRecoveryClaim('single', mismatchedForeignOwner), true);
    assert.equal(await mismatchedWalApp._refreshSuiteRecoveryCandidates(), mismatchedWalApp.currentSuiteSession);
    assert.equal(mismatchedWalApp.currentSuiteSession.id, tabOwnedDurable.id, 'after release the authoritative durable singleton must replace the mismatched WAL owner');
    assert.equal(await mismatchedWalApp._releaseSuiteRecoveryClaim('single', mismatchedWalApp.currentSuiteSession), true);

    const matchedWalHarness = createHarness();
    const matchedLocalWal = {
        ...structuredClone(tabOwnedWal),
        currentIndex: 0,
        activeExamId: 'p1',
        revision: 10,
        lastUpdate: fixtureTimeBase + 1000
    };
    const matchedDurable = {
        ...structuredClone(tabOwnedDurable),
        currentIndex: 1,
        activeExamId: 'p2',
        revision: 11,
        lastUpdate: fixtureTimeBase + 2000
    };
    matchedWalHarness.sessionStore.save('simulation', matchedLocalWal);
    matchedWalHarness.activeSessionStore.set(matchedDurable.id, matchedDurable);
    const matchedWalApp = matchedWalHarness.makeApp();
    matchedWalApp.initializeSuiteMode();
    await matchedWalApp._ensureSuiteRecoveryReady();
    assert.equal(matchedWalApp.currentSuiteSession.id, matchedLocalWal.id);
    assert.equal(matchedWalApp.currentSuiteSession.currentIndex, 1, 'matching HTTP WAL evidence must allow the newer durable snapshot');
    assert.equal(matchedWalApp.currentSuiteSession.activeExamId, 'p2');

    const bindingOwnerHarness = createHarness();
    const bindingOwnerApp = bindingOwnerHarness.makeApp();
    const priorSuiteBinding = {
        examId: 'p1',
        expectedSessionId: 'suite-binding-child',
        windowSessionToken: 'suite-binding-token',
        sessionGeneration: 7,
        expectedUrl: 'http://localhost/exam.html?examId=p1',
        expectedOrigin: 'http://localhost',
        allowOpaqueOrigin: false
    };
    const bindingOwnerSession = bindingOwnerApp._restoreSessionFromStorage({
        ...structuredClone(tabOwnedWal),
        id: 'suite-binding-owner',
        activeExamId: 'p1',
        currentIndex: 0,
        revision: 0,
        windowBinding: structuredClone(priorSuiteBinding)
    });
    assert(bindingOwnerSession);
    assert.equal(await bindingOwnerApp._acquireSuiteRecoveryClaim('single', bindingOwnerSession), true);
    bindingOwnerApp.currentSuiteSession = bindingOwnerSession;
    bindingOwnerApp.suiteExamMap = new Map(bindingOwnerSession.sequence.map((entry) => [entry.examId, bindingOwnerSession.id]));
    bindingOwnerApp.examWindows = new Map([['p1', {
        window: { closed: false },
        suiteSessionId: null,
        expectedSessionId: 'ordinary-child-session',
        windowSessionToken: 'ordinary-window-token',
        sessionGeneration: 12
    }]]);
    assert.deepEqual(
        structuredClone(bindingOwnerApp._buildSuiteWindowBinding(bindingOwnerSession)),
        priorSuiteBinding,
        'a managed ordinary same-exam registration must not replace the persisted suite binding'
    );
    assert.equal(await bindingOwnerApp._commitSuiteRecovery(bindingOwnerSession, { notify: false }), true);
    assert.deepEqual(
        bindingOwnerHarness.activeSessionStore.get(bindingOwnerSession.id).windowBinding,
        priorSuiteBinding,
        'the durable suite commit must retain the exact prior suite-owned binding'
    );
    assert.equal(await bindingOwnerApp._releaseSuiteRecoveryClaim('single', bindingOwnerSession), true);

    const sharedSingleLocks = createExclusiveLockManager();
    const sharedSingleDurable = new Map([[matchedDurable.id, structuredClone(matchedDurable)]]);
    const sharedSingleFences = new Map();
    const copiedSingleTabA = createHarness({
        locks: sharedSingleLocks,
        activeSessionStore: sharedSingleDurable,
        recoveryFenceStore: sharedSingleFences
    });
    const copiedSingleTabB = createHarness({
        locks: sharedSingleLocks,
        activeSessionStore: sharedSingleDurable,
        recoveryFenceStore: sharedSingleFences
    });
    copiedSingleTabA.sessionStore.save('simulation', structuredClone(matchedLocalWal));
    copiedSingleTabB.sessionStore.save('simulation', structuredClone(matchedLocalWal));
    const copiedSingleAppA = copiedSingleTabA.makeApp();
    const copiedSingleAppB = copiedSingleTabB.makeApp();
    const staleSingleA = copiedSingleAppA._restoreSessionFromStorage();
    const staleSingleB = copiedSingleAppB._restoreSessionFromStorage();
    copiedSingleAppA.initializeSuiteMode();
    copiedSingleAppB.initializeSuiteMode();
    assert.equal(copiedSingleAppA.currentSuiteSession, null, 'copyable WAL must remain quarantined before lease acquisition');
    assert.equal(copiedSingleAppB.currentSuiteSession, null, 'both copied tabs must quarantine WAL synchronously');
    await Promise.all([
        copiedSingleAppA._ensureSuiteRecoveryReady(),
        copiedSingleAppB._ensureSuiteRecoveryReady()
    ]);
    const singleWinner = copiedSingleAppA.currentSuiteSession ? copiedSingleAppA : copiedSingleAppB;
    const singleLoser = singleWinner === copiedSingleAppA ? copiedSingleAppB : copiedSingleAppA;
    const singleWinnerHarness = singleWinner === copiedSingleAppA ? copiedSingleTabA : copiedSingleTabB;
    const singleLoserHarness = singleWinner === copiedSingleAppA ? copiedSingleTabB : copiedSingleTabA;
    const staleSingleLoser = singleWinner === copiedSingleAppA ? staleSingleB : staleSingleA;
    assert(singleWinner.currentSuiteSession, 'exactly one copied tab must own the single-suite recovery');
    assert.equal(singleLoser.currentSuiteSession, null);
    assert.equal(sharedSingleLocks.held.size, 1, 'the winner must hold its lease for the live recovery lifetime');
    assert.equal(sharedSingleLocks.calls[0].name, sharedSingleLocks.calls[1].name, 'single copied WALs must contend on one exact-id lock');
    assert.equal(
        singleLoserHarness.sessionStore.peek('simulation').recoveryLeaseContended,
        true,
        'the loser must retain only a non-secret contention marker for safe crash takeover'
    );
    const singleSaveCountBefore = copiedSingleTabA.recoveryCalls.save + copiedSingleTabB.recoveryCalls.save;
    assert.equal(await singleLoser._commitSuiteRecovery(staleSingleLoser, { reason: 'copied-tab-stale-ref' }), false);
    assert.equal(await singleWinner._commitSuiteRecovery(singleWinner.currentSuiteSession, { reason: 'lease-owner' }), true);
    assert.equal(
        copiedSingleTabA.recoveryCalls.save + copiedSingleTabB.recoveryCalls.save,
        singleSaveCountBefore + 1,
        'only the object bound to the held claim may commit'
    );
    singleWinnerHarness.recoveryCalls.discardQueue.push(false);
    assert.equal(await singleWinner._discardStoredSuiteSession(singleWinner.currentSuiteSession), false);
    assert.equal(sharedSingleLocks.held.size, 1, 'failed durable discard must retain the lease for retry');
    assert.equal(await singleWinner._discardStoredSuiteSession(singleWinner.currentSuiteSession), true);
    assert.equal(sharedSingleLocks.held.size, 0, 'successful local cleanup must release the lease');

    const staleSingleRetry = createHarness({
        locks: sharedSingleLocks,
        activeSessionStore: sharedSingleDurable,
        recoveryFenceStore: sharedSingleFences
    });
    staleSingleRetry.sessionStore.save('simulation', structuredClone(singleLoserHarness.sessionStore.peek('simulation')));
    const staleSingleRetryApp = staleSingleRetry.makeApp();
    staleSingleRetryApp.initializeSuiteMode();
    await staleSingleRetryApp._ensureSuiteRecoveryReady();
    assert.equal(staleSingleRetryApp.currentSuiteSession, null, 'a contended WAL must not resurrect after the owner discarded durable state');
    assert.equal(staleSingleRetry.sessionStore.peek('simulation'), null);
    assert.equal(staleSingleRetry.recoveryCalls.save, 0);
    assert.equal(sharedSingleLocks.held.size, 0);

    const uncontendedPreSaveHarness = createHarness();
    const uncontendedPreSaveWal = {
        ...structuredClone(tabOwnedWal),
        id: 'suite-uncontended-pre-first-save',
        revision: 0,
        lastUpdate: fixtureTimeBase + 2500
    };
    uncontendedPreSaveHarness.sessionStore.save('simulation', structuredClone(uncontendedPreSaveWal));
    const uncontendedPreSaveApp = uncontendedPreSaveHarness.makeApp();
    uncontendedPreSaveApp.initializeSuiteMode();
    await uncontendedPreSaveApp._ensureSuiteRecoveryReady();
    assert.equal(uncontendedPreSaveApp.currentSuiteSession.id, uncontendedPreSaveWal.id);
    assert.equal(uncontendedPreSaveHarness.recoveryCalls.save, 1, 'an uncontended missing fence must migrate the first WAL');
    assert.equal(
        await uncontendedPreSaveApp._releaseSuiteRecoveryClaim('single', uncontendedPreSaveApp.currentSuiteSession),
        true
    );

    const preSaveCrashLocks = createExclusiveLockManager();
    const preSaveCrashDurable = new Map();
    const preSaveCrashFences = new Map();
    const preSaveCrashWal = {
        ...structuredClone(tabOwnedWal),
        id: 'suite-pre-first-save-crash',
        revision: 0,
        lastUpdate: fixtureTimeBase + 3000
    };
    const preSaveCrashTabA = createHarness({
        locks: preSaveCrashLocks,
        activeSessionStore: preSaveCrashDurable,
        recoveryFenceStore: preSaveCrashFences
    });
    const preSaveCrashTabB = createHarness({
        locks: preSaveCrashLocks,
        activeSessionStore: preSaveCrashDurable,
        recoveryFenceStore: preSaveCrashFences
    });
    preSaveCrashTabA.sessionStore.save('simulation', structuredClone(preSaveCrashWal));
    preSaveCrashTabB.sessionStore.save('simulation', structuredClone(preSaveCrashWal));
    preSaveCrashTabA.recoveryCalls.saveQueue.push(new Error('owner crashed before first durable save'));
    preSaveCrashTabB.recoveryCalls.saveQueue.push(new Error('owner crashed before first durable save'));
    const preSaveCrashAppA = preSaveCrashTabA.makeApp();
    const preSaveCrashAppB = preSaveCrashTabB.makeApp();
    preSaveCrashAppA.initializeSuiteMode();
    preSaveCrashAppB.initializeSuiteMode();
    await Promise.all([
        preSaveCrashAppA._ensureSuiteRecoveryReady(),
        preSaveCrashAppB._ensureSuiteRecoveryReady()
    ]);
    const preSaveCrashWinner = preSaveCrashAppA.currentSuiteSession ? preSaveCrashAppA : preSaveCrashAppB;
    const preSaveCrashLoserHarness = preSaveCrashWinner === preSaveCrashAppA ? preSaveCrashTabB : preSaveCrashTabA;
    assert(preSaveCrashWinner.currentSuiteSession, 'the first claimant keeps its WAL after a transient first-save failure');
    assert.equal(preSaveCrashDurable.has(preSaveCrashWal.id), false);
    assert.equal(preSaveCrashLoserHarness.sessionStore.peek('simulation').recoveryLeaseContended, true);
    assert.equal(
        await preSaveCrashWinner._releaseSuiteRecoveryClaim('single', preSaveCrashWinner.currentSuiteSession),
        true,
        'simulated owner crash must release the browser-held lease'
    );
    assert.equal(preSaveCrashLocks.held.size, 0);

    const preSaveCrashTakeover = createHarness({
        locks: preSaveCrashLocks,
        activeSessionStore: preSaveCrashDurable,
        recoveryFenceStore: preSaveCrashFences
    });
    preSaveCrashTakeover.sessionStore.save(
        'simulation',
        structuredClone(preSaveCrashLoserHarness.sessionStore.peek('simulation'))
    );
    const preSaveCrashTakeoverApp = preSaveCrashTakeover.makeApp();
    preSaveCrashTakeoverApp.initializeSuiteMode();
    await preSaveCrashTakeoverApp._ensureSuiteRecoveryReady();
    assert(preSaveCrashTakeoverApp.currentSuiteSession, 'a missing fence must preserve and migrate the only crash WAL');
    assert.equal(preSaveCrashTakeoverApp.currentSuiteSession.id, preSaveCrashWal.id);
    assert.equal(preSaveCrashTakeover.recoveryCalls.save, 1);
    assert.equal(preSaveCrashDurable.has(preSaveCrashWal.id), true);
    assert.equal(
        await preSaveCrashTakeoverApp._releaseSuiteRecoveryClaim(
            'single',
            preSaveCrashTakeoverApp.currentSuiteSession
        ),
        true
    );
    assert.equal(preSaveCrashLocks.held.size, 0);

    const expiredWalHarness = createHarness();
    expiredWalHarness.sessionStore.save('simulation', {
        ...structuredClone(tabOwnedWal),
        id: 'suite-expired-copied-wal',
        revision: 0,
        lastUpdate: Date.now() - (31 * 24 * 60 * 60 * 1000)
    });
    const expiredWalApp = expiredWalHarness.makeApp();
    expiredWalApp.initializeSuiteMode();
    await expiredWalApp._ensureSuiteRecoveryReady();
    assert.equal(expiredWalApp.currentSuiteSession, null, 'a copied WAL older than the durable recovery TTL must not revive');
    assert.equal(expiredWalHarness.sessionStore.peek('simulation'), null);
    assert.equal(expiredWalHarness.recoveryCalls.save, 0);

    const fileFallbackHarness = createHarness({ protocol: 'file:' });
    fileFallbackHarness.activeSessionStore.set(tabOwnedDurable.id, structuredClone(tabOwnedDurable));
    const fileFallbackApp = fileFallbackHarness.makeApp();
    fileFallbackApp.initializeSuiteMode();
    await fileFallbackApp._ensureSuiteRecoveryReady();
    assert.equal(fileFallbackApp.currentSuiteSession.id, tabOwnedDurable.id, 'file: must retain durable recovery fallback without a window WAL');

    const shadowedSuiteOwnerHarness = createHarness();
    shadowedSuiteOwnerHarness.sessionStore.save('simulation', structuredClone(tabOwnedWal));
    shadowedSuiteOwnerHarness.recoveryCalls.listedItems = [{
        schema: 'foreign-recovery-schema',
        version: 1,
        id: tabOwnedWal.id,
        revision: 0,
        lastUpdate: fixtureTimeBase + 3000
    }, {
        ...structuredClone(tabOwnedDurable),
        revision: 9,
        lastUpdate: fixtureTimeBase + 4000
    }];
    const shadowedSuiteOwnerApp = shadowedSuiteOwnerHarness.makeApp();
    shadowedSuiteOwnerApp.initializeSuiteMode();
    await shadowedSuiteOwnerApp._ensureSuiteRecoveryReady();
    assert.equal(shadowedSuiteOwnerApp.currentSuiteSession, null, 'a later suite candidate must not bypass another-schema first ownership of the same AppData id');
    assert.equal(shadowedSuiteOwnerHarness.sessionStore.peek('simulation'), null, 'unsafe same-id WAL must be cleared instead of migrated over the first owner');
    assert.equal(shadowedSuiteOwnerHarness.recoveryCalls.save, 0);
    assert.equal(shadowedSuiteOwnerHarness.recoveryCalls.discard, 0);

    const corruptFirstOwnerHarness = createHarness();
    corruptFirstOwnerHarness.sessionStore.save('simulation', structuredClone(tabOwnedWal));
    const corruptFirstOwner = {
        ...structuredClone(tabOwnedDurable),
        status: 'invalid',
        revision: 4,
        lastUpdate: fixtureTimeBase + 3000
    };
    const laterValidDuplicate = {
        ...structuredClone(tabOwnedDurable),
        currentIndex: 1,
        activeExamId: 'p2',
        revision: 9,
        lastUpdate: fixtureTimeBase + 4000
    };
    corruptFirstOwnerHarness.recoveryCalls.listedItems = [corruptFirstOwner, laterValidDuplicate];
    corruptFirstOwnerHarness.recoveryCalls.saveQueue.push((value, options) => {
        assert.equal(options.expectedEntityRevision, 4, 'repair must CAS against the actual corrupt first owner');
        assert(value.revision >= 5);
        assert.equal(value.activeExamId, tabOwnedWal.activeExamId, 'repair must use this tab WAL, not the later duplicate payload');
        return { committed: true };
    });
    const corruptFirstOwnerApp = corruptFirstOwnerHarness.makeApp();
    corruptFirstOwnerApp.initializeSuiteMode();
    await corruptFirstOwnerApp._ensureSuiteRecoveryReady();
    assert.equal(corruptFirstOwnerApp.currentSuiteSession.id, tabOwnedWal.id);
    assert.equal(corruptFirstOwnerApp.currentSuiteSession.activeExamId, tabOwnedWal.activeExamId);
    assert.notEqual(corruptFirstOwnerApp.currentSuiteSession._suiteRecoveryWritesBlocked, true);
    assert.equal(corruptFirstOwnerHarness.recoveryCalls.discard, 0, 'matching corrupt durable must be repaired without a tombstone');

    const multiSuiteSession = {
        id: 'multi-suite-tab-owner',
        baseExamId: 'listening-multi-tab-owner',
        status: 'active',
        startTime: 1000,
        suiteResults: [],
        expectedSuiteCount: 2,
        metadata: {},
        lastUpdate: fixtureTimeBase + 1000,
        revision: 3,
        finalizeOperationId: null,
        finalizeRecord: null
    };
    const multiSuiteWal = {
        schema: 'multi-suite-sessions-v2',
        version: 2,
        sessions: [structuredClone(multiSuiteSession)],
        updatedAt: fixtureTimeBase + 1000
    };
    const multiSuiteDurable = {
        ...structuredClone(multiSuiteWal),
        id: multiSuiteSession.id,
        revision: multiSuiteSession.revision
    };

    for (const enumerationFailure of ['missing', 'throw']) {
        const unavailableMultiLocks = createExclusiveLockManager();
        const unavailableMultiHarness = createHarness({
            locks: unavailableMultiLocks,
            ...(enumerationFailure === 'missing'
                ? { listActiveSessionsUnavailable: true }
                : { listActiveSessionsError: new Error('multi recovery enumeration failed') })
        });
        unavailableMultiHarness.sessionStore.save('multi-suite-practice', structuredClone(multiSuiteWal));
        unavailableMultiHarness.recoveryFenceStore.set(multiSuiteSession.id, {
            id: multiSuiteSession.id,
            exists: true,
            tombstoned: true,
            revision: multiSuiteSession.revision + 1
        });
        const unavailableMultiApp = unavailableMultiHarness.makeApp();
        unavailableMultiApp.initializeSuiteMode();
        await unavailableMultiApp._ensureSuiteRecoveryReady();
        assert.equal(
            unavailableMultiApp.multiSuiteSessionsMap.has(multiSuiteSession.baseExamId),
            false,
            `HTTP multi WAL must remain quarantined when durable enumeration is ${enumerationFailure}`
        );
        assert.equal(unavailableMultiHarness.recoveryCalls.save, 0);
        assert.equal(
            unavailableMultiHarness.sessionStore.peek('multi-suite-practice').sessions[0].id,
            multiSuiteSession.id
        );
        assert.equal(unavailableMultiLocks.held.size, 0);
    }

    const crossKindLocks = createExclusiveLockManager();
    const crossKindHarness = createHarness({ locks: crossKindLocks });
    const crossKindId = tabOwnedWal.id;
    const crossKindMultiSession = {
        ...structuredClone(multiSuiteSession),
        id: crossKindId,
        baseExamId: 'listening-cross-kind-owner'
    };
    const crossKindMultiWal = {
        schema: 'multi-suite-sessions-v2',
        version: 2,
        sessions: [structuredClone(crossKindMultiSession)],
        updatedAt: fixtureTimeBase + 2000
    };
    const crossKindMultiDurable = {
        ...structuredClone(crossKindMultiWal),
        id: crossKindId,
        revision: crossKindMultiSession.revision
    };
    crossKindHarness.sessionStore.save('simulation', structuredClone(tabOwnedWal));
    crossKindHarness.sessionStore.save('multi-suite-practice', structuredClone(crossKindMultiWal));
    crossKindHarness.recoveryCalls.listedItems = [
        structuredClone(crossKindMultiDurable),
        structuredClone(tabOwnedDurable)
    ];
    const crossKindApp = crossKindHarness.makeApp();
    const crossKindStaleSingle = crossKindApp._restoreSessionFromStorage();
    crossKindApp.initializeSuiteMode();
    await crossKindApp._ensureSuiteRecoveryReady();
    const crossKindRestoredMulti = crossKindApp.multiSuiteSessionsMap.get(crossKindMultiSession.baseExamId);
    assert.equal(crossKindApp.currentSuiteSession, null, 'a multi-suite first owner must reject the same-id single WAL');
    assert(crossKindRestoredMulti, 'the authoritative same-id multi WAL must retry its claim after single releases it');
    assert.equal(crossKindRestoredMulti.id, crossKindId);
    assert.equal(crossKindApp._ownsMultiSuiteRecoveryOwnership(crossKindRestoredMulti), true);
    assert.equal(crossKindLocks.held.size, 2);
    assert(crossKindLocks.held.has(crossKindApp._suiteRecoveryClaimName(crossKindId)));
    assert(crossKindLocks.held.has(crossKindApp._multiSuiteBaseClaimName(crossKindMultiSession.baseExamId)));
    assert.equal(crossKindHarness.recoveryCalls.save, 0);
    assert.equal(crossKindHarness.recoveryCalls.discard, 0);
    assert.equal(
        await crossKindApp._commitSuiteRecovery(crossKindStaleSingle, { notify: false }),
        false,
        'the stale single object must not borrow the multi-suite claim'
    );
    const crossKindSaveCount = crossKindHarness.recoveryCalls.save;
    crossKindRestoredMulti.revision += 1;
    assert.equal(await crossKindApp._commitMultiSuiteRecovery(crossKindRestoredMulti), true);
    assert.equal(crossKindHarness.recoveryCalls.save, crossKindSaveCount + 1);
    assert.equal(crossKindHarness.activeSessionStore.get(crossKindId).schema, 'multi-suite-sessions-v2');
    assert.equal(await crossKindApp._releaseSuiteRecoveryClaim('single', crossKindStaleSingle), false);
    assert.equal(crossKindLocks.held.size, 2, 'a stale cross-kind release must not drop either multi ownership lease');
    assert.equal(await crossKindApp._releaseSuiteRecoveryClaim('multi', crossKindRestoredMulti), true);
    assert.equal(crossKindLocks.held.size, 0);

    const reverseCrossKindLocks = createExclusiveLockManager();
    const reverseCrossKindHarness = createHarness({ locks: reverseCrossKindLocks });
    const reverseCrossKindId = 'suite-reverse-cross-kind-owner';
    const reverseCrossKindSingle = {
        ...structuredClone(tabOwnedDurable),
        id: reverseCrossKindId,
        lastUpdate: fixtureTimeBase + 3000
    };
    const reverseCrossKindMultiSession = {
        ...structuredClone(multiSuiteSession),
        id: reverseCrossKindId,
        baseExamId: 'listening-reverse-cross-kind-owner'
    };
    const reverseCrossKindMultiWal = {
        schema: 'multi-suite-sessions-v2',
        version: 2,
        sessions: [structuredClone(reverseCrossKindMultiSession)],
        updatedAt: fixtureTimeBase + 3000
    };
    reverseCrossKindHarness.sessionStore.save('multi-suite-practice', reverseCrossKindMultiWal);
    reverseCrossKindHarness.recoveryCalls.listedItems = [structuredClone(reverseCrossKindSingle)];
    const reverseCrossKindApp = reverseCrossKindHarness.makeApp();
    const reverseCrossKindStaleMulti = reverseCrossKindApp
        ._restoreMultiSuiteSessionsFromStorage({ install: false })[0];
    reverseCrossKindApp.initializeSuiteMode();
    await reverseCrossKindApp._ensureSuiteRecoveryReady();
    assert(reverseCrossKindApp.currentSuiteSession, 'durable single must retry after the wrong-kind multi WAL releases the shared id');
    assert.equal(reverseCrossKindApp.currentSuiteSession.id, reverseCrossKindId);
    assert.equal(reverseCrossKindApp.multiSuiteSessionsMap.has(reverseCrossKindMultiSession.baseExamId), false);
    assert.equal(reverseCrossKindApp._ownsSuiteRecoveryClaim('single', reverseCrossKindApp.currentSuiteSession), true);
    assert.equal(reverseCrossKindLocks.held.size, 1);
    assert.equal(
        await reverseCrossKindApp._commitMultiSuiteRecovery(reverseCrossKindStaleMulti),
        false,
        'the rejected wrong-kind WAL object must not reacquire the durable single identity'
    );
    assert.equal(await reverseCrossKindApp._releaseSuiteRecoveryClaim(
        'single',
        reverseCrossKindApp.currentSuiteSession
    ), true);
    assert.equal(reverseCrossKindLocks.held.size, 0);

    const aliasClaimLocks = createExclusiveLockManager();
    const aliasClaimHarness = createHarness({ locks: aliasClaimLocks });
    const aliasClaimApp = aliasClaimHarness.makeApp();
    aliasClaimApp.multiSuiteSessionsMap = new Map();
    const aliasCanonicalBase = 'listening-alias-claim-owner';
    const aliasLosingSession = {
        ...structuredClone(multiSuiteSession),
        id: 'multi-alias-losing-object',
        baseExamId: ` ${aliasCanonicalBase} `,
        _restoredFromWindowSession: true,
        _suiteRecoveryTimestampKnown: true
    };
    const aliasWinningSession = {
        ...structuredClone(multiSuiteSession),
        id: 'multi-alias-winning-object',
        baseExamId: aliasCanonicalBase,
        _restoredFromWindowSession: true,
        _suiteRecoveryTimestampKnown: true
    };
    assert.equal(await aliasClaimApp._acquireSuiteRecoveryClaim('multi', aliasLosingSession), true);
    assert.equal(await aliasClaimApp._acquireSuiteRecoveryClaim('multi', aliasWinningSession), true);
    aliasClaimApp.multiSuiteSessionsMap.set(aliasLosingSession.baseExamId, aliasLosingSession);
    aliasClaimApp.multiSuiteSessionsMap.set(aliasCanonicalBase, aliasWinningSession);
    const aliasDurableMarker = {
        schema: 'multi-suite-sessions-v2',
        version: 2,
        id: 'multi-alias-foreign-marker',
        revision: 1,
        sessions: [{ baseExamId: aliasCanonicalBase }]
    };
    await aliasClaimApp._restorePersistentMultiSuiteSessions([aliasDurableMarker], []);
    assert.equal(aliasClaimApp.multiSuiteSessionsMap.get(aliasCanonicalBase), aliasWinningSession);
    assert.equal(aliasLosingSession._suiteRecoveryClaimRejected, true);
    assert.equal(aliasLosingSession._suiteRecoveryWritesBlocked, true);
    const aliasSaveCount = aliasClaimHarness.recoveryCalls.save;
    assert.equal(await aliasClaimApp._commitMultiSuiteRecovery(aliasLosingSession), false);
    assert.equal(aliasClaimHarness.recoveryCalls.save, aliasSaveCount, 'an evicted alias object must not reacquire after release');
    assert.equal(aliasClaimApp._ownsSuiteRecoveryClaim('multi', aliasWinningSession), true);
    assert.equal(await aliasClaimApp._releaseSuiteRecoveryClaim('multi', aliasWinningSession), true);

    const sameObjectAliasSession = {
        ...structuredClone(multiSuiteSession),
        id: 'multi-alias-same-object',
        baseExamId: ` ${aliasCanonicalBase}-same `,
        _restoredFromWindowSession: true,
        _suiteRecoveryTimestampKnown: true
    };
    const sameObjectCanonicalBase = `${aliasCanonicalBase}-same`;
    assert.equal(await aliasClaimApp._acquireSuiteRecoveryClaim('multi', sameObjectAliasSession), true);
    aliasClaimApp.multiSuiteSessionsMap.set(sameObjectAliasSession.baseExamId, sameObjectAliasSession);
    aliasClaimApp.multiSuiteSessionsMap.set(sameObjectCanonicalBase, sameObjectAliasSession);
    await aliasClaimApp._restorePersistentMultiSuiteSessions([{
        ...aliasDurableMarker,
        id: 'multi-alias-same-object-marker',
        sessions: [{ baseExamId: sameObjectCanonicalBase }]
    }], []);
    assert.equal(aliasClaimApp.multiSuiteSessionsMap.get(sameObjectCanonicalBase), sameObjectAliasSession);
    assert.equal(aliasClaimApp._ownsSuiteRecoveryClaim('multi', sameObjectAliasSession), true);
    assert.notEqual(sameObjectAliasSession._suiteRecoveryClaimRejected, true);
    assert.equal(await aliasClaimApp._releaseSuiteRecoveryClaim('multi', sameObjectAliasSession), true);
    assert.equal(aliasClaimLocks.held.size, 0);

    const durableOnlyMultiLocks = createExclusiveLockManager();
    const durableOnlyMultiBase = 'listening-durable-only-owner';
    const olderDurableMultiSession = {
        ...structuredClone(multiSuiteSession),
        id: 'multi-durable-only-older',
        baseExamId: durableOnlyMultiBase,
        lastUpdate: fixtureTimeBase + 500
    };
    const newestDurableMultiSession = {
        ...structuredClone(multiSuiteSession),
        id: 'multi-durable-only-newest',
        baseExamId: durableOnlyMultiBase,
        lastUpdate: fixtureTimeBase + 600
    };
    const durableMultiWrapper = (session) => ({
        schema: 'multi-suite-sessions-v2',
        version: 2,
        id: session.id,
        revision: session.revision,
        sessions: [structuredClone(session)],
        updatedAt: session.lastUpdate
    });
    const olderDurableMulti = durableMultiWrapper(olderDurableMultiSession);
    const newestDurableMulti = durableMultiWrapper(newestDurableMultiSession);
    const durableOnlyMultiStore = new Map([
        [olderDurableMulti.id, olderDurableMulti],
        [newestDurableMulti.id, newestDurableMulti]
    ]);
    const durableMultiOwnerHarness = createHarness({
        locks: durableOnlyMultiLocks,
        activeSessionStore: durableOnlyMultiStore
    });
    const durableMultiOwnerApp = durableMultiOwnerHarness.makeApp();
    const heldNewestMulti = structuredClone(newestDurableMultiSession);
    assert.equal(await durableMultiOwnerApp._acquireMultiSuiteRecoveryOwnership(heldNewestMulti), true);

    const emptyMultiHttpHarness = createHarness({
        locks: durableOnlyMultiLocks,
        activeSessionStore: durableOnlyMultiStore
    });
    const emptyMultiHttpApp = emptyMultiHttpHarness.makeApp();
    emptyMultiHttpApp.initializeSuiteMode();
    await emptyMultiHttpApp._ensureSuiteRecoveryReady();
    assert.equal(emptyMultiHttpApp.multiSuiteSessionsMap.has(durableOnlyMultiBase), false, 'a fresh HTTP tab must not bypass the newest per-base lease');
    assert.equal(
        durableOnlyMultiLocks.calls.filter((call) => call.name === emptyMultiHttpApp._suiteRecoveryClaimName(olderDurableMulti.id)).length,
        0,
        'newest per-base contention must not fall back to an older multi id'
    );
    const durableOnlyMultiPayload = {
        suiteId: 'set-1',
        totalSuites: 2,
        answers: { q1: 'A' },
        answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
        scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
    };
    assert.equal(
        await emptyMultiHttpApp.handleMultiSuitePracticeComplete(
            `${durableOnlyMultiBase}_set1`,
            durableOnlyMultiPayload
        ),
        false,
        'the targeted handler must respect the live authoritative entity lock'
    );
    assert.equal(await durableMultiOwnerApp._releaseSuiteRecoveryClaim('multi', heldNewestMulti), true);
    assert.equal(
        await emptyMultiHttpApp.handleMultiSuitePracticeComplete(
            `${durableOnlyMultiBase}_set1`,
            durableOnlyMultiPayload
        ),
        true,
        'the same handler must take over the durable base after the entity owner releases'
    );
    const durableOnlyMultiRestored = emptyMultiHttpApp.multiSuiteSessionsMap.get(durableOnlyMultiBase);
    assert.equal(durableOnlyMultiRestored.id, newestDurableMulti.id, 'the same tab must take over the newest per-base durable after release');
    assert.equal(durableOnlyMultiLocks.held.size, 2);
    assert.equal(await emptyMultiHttpApp._releaseSuiteRecoveryClaim('multi', durableOnlyMultiRestored), true);
    assert.equal(durableOnlyMultiLocks.held.size, 0, 'older durable ids must never leave unused claims behind');

    const handlerTakeoverLocks = createExclusiveLockManager();
    const handlerTakeoverSession = {
        ...structuredClone(multiSuiteSession),
        id: 'multi-handler-crash-takeover',
        baseExamId: 'listening-multi-handler-crash-takeover',
        expectedSuiteCount: 2,
        suiteResults: [],
        lastUpdate: fixtureTimeBase + 700
    };
    const handlerTakeoverDurable = durableMultiWrapper(handlerTakeoverSession);
    const handlerTakeoverStore = new Map([
        [handlerTakeoverDurable.id, structuredClone(handlerTakeoverDurable)]
    ]);
    const handlerOwnerHarness = createHarness({
        locks: handlerTakeoverLocks,
        activeSessionStore: handlerTakeoverStore
    });
    const handlerOwnerApp = handlerOwnerHarness.makeApp();
    const heldHandlerOwner = structuredClone(handlerTakeoverSession);
    assert.equal(await handlerOwnerApp._acquireMultiSuiteRecoveryOwnership(heldHandlerOwner), true);

    const handlerRetryHarness = createHarness({
        locks: handlerTakeoverLocks,
        activeSessionStore: handlerTakeoverStore
    });
    const handlerRetryApp = handlerRetryHarness.makeApp();
    handlerRetryApp.initializeSuiteMode();
    await handlerRetryApp._ensureSuiteRecoveryReady();
    assert.equal(
        handlerRetryApp.multiSuiteSessionsMap.has(handlerTakeoverSession.baseExamId),
        false,
        'a live owner must keep the durable base quarantined in the retrying tab'
    );
    const handlerPayload = {
        suiteId: 'set-1',
        totalSuites: 2,
        answers: { q1: 'A' },
        answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
        scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
    };
    const canonicalReplayLocks = createExclusiveLockManager();
    const canonicalReplayHarness = createHarness({
        locks: canonicalReplayLocks,
        activeSessionStore: new Map(),
        realisticRecoveryStore: true
    });
    const canonicalReplayApp = canonicalReplayHarness.makeApp();
    canonicalReplayApp.initializeSuiteMode();
    await canonicalReplayApp._ensureSuiteRecoveryReady();
    const canonicalReplayBase = 'listening-multi-canonical-replay';
    const canonicalReplayPayload = {
        ...handlerPayload,
        sessionId: 'canonical-child-session',
        submissionId: 'canonical-child-submission'
    };
    canonicalReplayApp._generateMultiSuiteSessionId = () => 'multi-canonical-replay-empty-owner';
    canonicalReplayApp._listPracticeRecordsViaAPI = async () => [{
        multiSuite: true,
        examId: canonicalReplayBase,
        suiteEntries: [{
            suiteId: canonicalReplayPayload.suiteId,
            metadata: {
                sessionId: canonicalReplayPayload.sessionId,
                submissionId: canonicalReplayPayload.submissionId
            }
        }]
    }];
    assert.equal(
        await canonicalReplayApp.handleMultiSuitePracticeComplete(
            `${canonicalReplayBase}_set1`,
            canonicalReplayPayload
        ),
        true,
        'a canonical durable receipt must ACK a stale child without starting a new base owner'
    );
    assert.equal(canonicalReplayApp.multiSuiteSessionsMap.has(canonicalReplayBase), false);
    assert.equal(canonicalReplayHarness.recoveryCalls.save, 0);
    assert.equal(canonicalReplayHarness.sessionStore.peek('multi-suite-practice'), null);
    assert.equal(canonicalReplayLocks.held.size, 0, 'canonical replay must release the provisional base and exact leases');

    assert.equal(
        await handlerRetryApp.handleMultiSuitePracticeComplete(
            `${handlerTakeoverSession.baseExamId}_set1`,
            handlerPayload
        ),
        false,
        'the production completion path must not create a new id while the durable owner is alive'
    );
    assert.equal(handlerRetryHarness.recoveryCalls.save, 0);
    assert.equal(handlerRetryApp.multiSuiteSessionsMap.has(handlerTakeoverSession.baseExamId), false);

    assert.equal(await handlerOwnerApp._releaseSuiteRecoveryClaim('multi', heldHandlerOwner), true);
    const idleOtherBaseSession = {
        ...structuredClone(handlerTakeoverSession),
        id: 'multi-idle-other-base',
        baseExamId: 'listening-multi-idle-other-base',
        lastUpdate: fixtureTimeBase + 800
    };
    const idleOtherBaseDurable = durableMultiWrapper(idleOtherBaseSession);
    handlerTakeoverStore.set(idleOtherBaseDurable.id, structuredClone(idleOtherBaseDurable));
    const callsBeforeIdleInitialize = handlerTakeoverLocks.calls.length;
    const idleMultiHarness = createHarness({
        locks: handlerTakeoverLocks,
        activeSessionStore: handlerTakeoverStore
    });
    const idleMultiApp = idleMultiHarness.makeApp();
    idleMultiApp.initializeSuiteMode();
    await idleMultiApp._ensureSuiteRecoveryReady();
    assert.equal(idleMultiApp.multiSuiteSessionsMap.size, 0, 'an idle HTTP tab must not install durable-only multi bases');
    assert.equal(handlerTakeoverLocks.calls.length, callsBeforeIdleInitialize, 'idle startup must not claim any durable-only base or entity');
    assert.equal(handlerTakeoverLocks.held.size, 0);
    assert.equal(
        await handlerRetryApp.handleMultiSuitePracticeComplete(
            `${handlerTakeoverSession.baseExamId}_set1`,
            handlerPayload
        ),
        true,
        'the same app instance must refresh and merge into the released durable owner'
    );
    const handlerTakeoverRestored = handlerRetryApp.multiSuiteSessionsMap.get(handlerTakeoverSession.baseExamId);
    assert(handlerTakeoverRestored);
    assert.equal(handlerTakeoverRestored.id, handlerTakeoverSession.id, 'retry must preserve the durable entity identity');
    assert.equal(handlerTakeoverRestored.suiteResults.length, 1);
    assert.equal(handlerTakeoverRestored.suiteResults[0].suiteId, handlerPayload.suiteId);
    assert.equal(handlerRetryHarness.recoveryCalls.save, 1);
    assert.equal(handlerTakeoverStore.get(handlerTakeoverSession.id).id, handlerTakeoverSession.id);
    assert.equal(await handlerRetryApp._releaseSuiteRecoveryClaim('multi', handlerTakeoverRestored), true);
    assert.equal(handlerTakeoverLocks.held.size, 0);

    const emptySameBaseLocks = createExclusiveLockManager();
    const emptySameBaseStore = new Map();
    const emptySameBaseHarnessA = createHarness({
        locks: emptySameBaseLocks,
        activeSessionStore: emptySameBaseStore,
        realisticRecoveryStore: true
    });
    const emptySameBaseHarnessB = createHarness({
        locks: emptySameBaseLocks,
        activeSessionStore: emptySameBaseStore,
        realisticRecoveryStore: true
    });
    const emptySameBaseAppA = emptySameBaseHarnessA.makeApp();
    const emptySameBaseAppB = emptySameBaseHarnessB.makeApp();
    emptySameBaseAppA.initializeSuiteMode();
    emptySameBaseAppB.initializeSuiteMode();
    await Promise.all([
        emptySameBaseAppA._ensureSuiteRecoveryReady(),
        emptySameBaseAppB._ensureSuiteRecoveryReady()
    ]);
    emptySameBaseHarnessA.recoveryCalls.listQueue.push([]);
    emptySameBaseHarnessB.recoveryCalls.listQueue.push([]);
    emptySameBaseAppA._generateMultiSuiteSessionId = () => 'multi-empty-same-base-a';
    emptySameBaseAppB._generateMultiSuiteSessionId = () => 'multi-empty-same-base-b';
    const emptySameBase = 'listening-multi-empty-base-race';
    const emptySameBaseOutcomes = await Promise.all([
        emptySameBaseAppA.handleMultiSuitePracticeComplete(`${emptySameBase}_set1`, handlerPayload),
        emptySameBaseAppB.handleMultiSuitePracticeComplete(`${emptySameBase}_set1`, handlerPayload)
    ]);
    assert.deepEqual([...emptySameBaseOutcomes].sort(), [false, true], 'only one empty tab may create the first entity for a canonical base');
    assert.equal(
        emptySameBaseAppA.multiSuiteSessionsMap.size + emptySameBaseAppB.multiSuiteSessionsMap.size,
        1
    );
    assert.equal(emptySameBaseStore.size, 1, 'same-base first submit must persist exactly one entity id');
    assert.equal(
        emptySameBaseHarnessA.recoveryCalls.save + emptySameBaseHarnessB.recoveryCalls.save,
        1
    );
    const emptySameBaseWinner = emptySameBaseAppA.multiSuiteSessionsMap.has(emptySameBase)
        ? emptySameBaseAppA
        : emptySameBaseAppB;
    assert.equal(
        await emptySameBaseWinner._releaseSuiteRecoveryClaim(
            'multi',
            emptySameBaseWinner.multiSuiteSessionsMap.get(emptySameBase)
        ),
        true
    );
    assert.equal(emptySameBaseLocks.held.size, 0);

    const parallelBaseLocks = createExclusiveLockManager();
    const parallelBaseStore = new Map();
    const parallelBaseHarnessA = createHarness({
        locks: parallelBaseLocks,
        activeSessionStore: parallelBaseStore,
        realisticRecoveryStore: true
    });
    const parallelBaseHarnessB = createHarness({
        locks: parallelBaseLocks,
        activeSessionStore: parallelBaseStore,
        realisticRecoveryStore: true
    });
    const parallelBaseAppA = parallelBaseHarnessA.makeApp();
    const parallelBaseAppB = parallelBaseHarnessB.makeApp();
    parallelBaseAppA.initializeSuiteMode();
    parallelBaseAppB.initializeSuiteMode();
    await Promise.all([
        parallelBaseAppA._ensureSuiteRecoveryReady(),
        parallelBaseAppB._ensureSuiteRecoveryReady()
    ]);
    parallelBaseHarnessA.recoveryCalls.listQueue.push([]);
    parallelBaseHarnessB.recoveryCalls.listQueue.push([]);
    parallelBaseAppA._generateMultiSuiteSessionId = () => 'multi-parallel-base-a';
    parallelBaseAppB._generateMultiSuiteSessionId = () => 'multi-parallel-base-b';
    const parallelBaseA = 'listening-multi-parallel-base-a';
    const parallelBaseB = 'listening-multi-parallel-base-b';
    assert.deepEqual(await Promise.all([
        parallelBaseAppA.handleMultiSuitePracticeComplete(`${parallelBaseA}_set1`, handlerPayload),
        parallelBaseAppB.handleMultiSuitePracticeComplete(`${parallelBaseB}_set1`, handlerPayload)
    ]), [true, true], 'different canonical bases must remain independently writable');
    assert.equal(parallelBaseStore.size, 2);
    assert.equal(parallelBaseLocks.held.size, 4, 'each active base must retain one base lease and one exact entity lease');
    assert(parallelBaseLocks.held.has(parallelBaseAppA._multiSuiteBaseClaimName(parallelBaseA)));
    assert(parallelBaseLocks.held.has(parallelBaseAppB._multiSuiteBaseClaimName(parallelBaseB)));
    assert.equal(await parallelBaseAppA._releaseSuiteRecoveryClaim(
        'multi',
        parallelBaseAppA.multiSuiteSessionsMap.get(parallelBaseA)
    ), true);
    assert.equal(await parallelBaseAppB._releaseSuiteRecoveryClaim(
        'multi',
        parallelBaseAppB.multiSuiteSessionsMap.get(parallelBaseB)
    ), true);
    assert.equal(parallelBaseLocks.held.size, 0);

    const vanishedMultiLocks = createExclusiveLockManager();
    const vanishedMultiHarness = createHarness({ locks: vanishedMultiLocks });
    const vanishedMultiApp = vanishedMultiHarness.makeApp();
    vanishedMultiApp.initializeSuiteMode();
    await vanishedMultiApp._ensureSuiteRecoveryReady();
    vanishedMultiHarness.recoveryCalls.listQueue.push(
        [structuredClone(newestDurableMulti)],
        []
    );
    assert.equal(
        await vanishedMultiApp.handleMultiSuitePracticeComplete(
            `${durableOnlyMultiBase}_set1`,
            durableOnlyMultiPayload
        ),
        false,
        'a targeted durable clone that vanishes under its leases must not be exposed'
    );
    assert.equal(vanishedMultiApp.multiSuiteSessionsMap.has(durableOnlyMultiBase), false);
    assert.equal(vanishedMultiHarness.recoveryCalls.save, 0, 'a vanished durable multi clone must not expected=0 resurrect itself');
    assert.equal(vanishedMultiHarness.recoveryCalls.list, 3);
    assert.equal(vanishedMultiLocks.held.size, 0);

    const matchedMultiHttpHarness = createHarness();
    matchedMultiHttpHarness.sessionStore.save('multi-suite-practice', structuredClone(multiSuiteWal));
    matchedMultiHttpHarness.activeSessionStore.set(multiSuiteDurable.id, structuredClone(multiSuiteDurable));
    const matchedMultiHttpApp = matchedMultiHttpHarness.makeApp();
    matchedMultiHttpApp.initializeSuiteMode();
    await matchedMultiHttpApp._ensureSuiteRecoveryReady();
    const matchedMultiSession = matchedMultiHttpApp.multiSuiteSessionsMap.get(multiSuiteSession.baseExamId);
    assert(matchedMultiSession, 'matching HTTP multi-suite WAL identity must allow durable recovery');
    assert.equal(matchedMultiSession.id, multiSuiteSession.id);
    assert.equal(matchedMultiSession._lastDurableRecoveryRevision, multiSuiteSession.revision);

    const replacedWalLocks = createExclusiveLockManager();
    const replacedWalSession = {
        ...structuredClone(multiSuiteSession),
        id: 'multi-suite-replaced-window-wal',
        lastUpdate: fixtureTimeBase
    };
    const replacedWalHarness = createHarness({
        locks: replacedWalLocks,
        activeSessionStore: new Map([[multiSuiteDurable.id, structuredClone(multiSuiteDurable)]])
    });
    replacedWalHarness.sessionStore.save('multi-suite-practice', {
        ...structuredClone(multiSuiteWal),
        sessions: [replacedWalSession]
    });
    const replacedWalApp = replacedWalHarness.makeApp();
    replacedWalApp.initializeSuiteMode();
    await replacedWalApp._ensureSuiteRecoveryReady();
    const replacedWalOwner = replacedWalApp.multiSuiteSessionsMap.get(multiSuiteSession.baseExamId);
    assert.equal(replacedWalOwner.id, multiSuiteSession.id, 'the newest durable identity must replace a stale same-base WAL id');
    assert.equal(replacedWalLocks.held.size, 2, 'only the installed base and exact durable leases may remain held');
    assert(replacedWalLocks.held.has(replacedWalApp._multiSuiteBaseClaimName(multiSuiteSession.baseExamId)));
    assert(replacedWalLocks.held.has(replacedWalApp._suiteRecoveryClaimName(multiSuiteSession.id)));
    assert.equal(
        replacedWalLocks.held.has(replacedWalApp._suiteRecoveryClaimName(replacedWalSession.id)),
        false,
        'the displaced WAL exact-id lease must be released after the base transfers'
    );
    assert.equal(await replacedWalApp._releaseSuiteRecoveryClaim('multi', replacedWalOwner), true);
    assert.equal(replacedWalLocks.held.size, 0);

    let signalExactRequest;
    const exactRequestStarted = new Promise((resolve) => { signalExactRequest = resolve; });
    const halfLockManager = {
        held: new Map(),
        async request(name, lockOptions, callback) {
            assert.equal(lockOptions.mode, 'exclusive');
            assert.equal(lockOptions.ifAvailable, true);
            const normalizedName = String(name);
            const lock = { name: normalizedName, mode: 'exclusive' };
            if (normalizedName.includes(':multi-suite-base:')) {
                this.held.set(normalizedName, lock);
                void callback(lock);
                await exactRequestStarted;
                this.held.delete(normalizedName);
                throw new Error('simulated base lock loss while exact acquisition is pending');
            }
            signalExactRequest();
            await new Promise((resolve) => setTimeout(resolve, 0));
            this.held.set(normalizedName, lock);
            try {
                return await callback(lock);
            } finally {
                if (this.held.get(normalizedName) === lock) this.held.delete(normalizedName);
            }
        }
    };
    const halfLockHarness = createHarness({ locks: halfLockManager });
    const halfLockApp = halfLockHarness.makeApp();
    const halfLockSession = {
        ...structuredClone(multiSuiteSession),
        id: 'multi-half-lock-race',
        baseExamId: 'listening-multi-half-lock-race'
    };
    assert.equal(
        await halfLockApp._acquireMultiSuiteRecoveryOwnership(halfLockSession),
        false,
        'an exact lease acquired after unexpected base loss must not become an owner'
    );
    assert.equal(halfLockManager.held.size, 0, 'late exact acquisition must be released instead of leaking a half-lock');
    assert.equal(halfLockApp._ownsSuiteRecoveryClaim('multi', halfLockSession), false);

    const sharedMultiLocks = createExclusiveLockManager();
    const sharedMultiDurable = new Map([[multiSuiteDurable.id, structuredClone(multiSuiteDurable)]]);
    const copiedMultiTabA = createHarness({ locks: sharedMultiLocks, activeSessionStore: sharedMultiDurable });
    const copiedMultiTabB = createHarness({ locks: sharedMultiLocks, activeSessionStore: sharedMultiDurable });
    copiedMultiTabA.sessionStore.save('multi-suite-practice', structuredClone(multiSuiteWal));
    copiedMultiTabB.sessionStore.save('multi-suite-practice', structuredClone(multiSuiteWal));
    const copiedMultiAppA = copiedMultiTabA.makeApp();
    const copiedMultiAppB = copiedMultiTabB.makeApp();
    const staleMultiA = copiedMultiAppA._restoreMultiSuiteSessionsFromStorage({ install: false })[0];
    const staleMultiB = copiedMultiAppB._restoreMultiSuiteSessionsFromStorage({ install: false })[0];
    copiedMultiAppA.initializeSuiteMode();
    copiedMultiAppB.initializeSuiteMode();
    assert.equal(copiedMultiAppA.multiSuiteSessionsMap.size, 0, 'multi WAL must remain quarantined before claim acquisition');
    assert.equal(copiedMultiAppB.multiSuiteSessionsMap.size, 0);
    await Promise.all([
        copiedMultiAppA._ensureSuiteRecoveryReady(),
        copiedMultiAppB._ensureSuiteRecoveryReady()
    ]);
    const multiWinner = copiedMultiAppA.multiSuiteSessionsMap.has(multiSuiteSession.baseExamId)
        ? copiedMultiAppA
        : copiedMultiAppB;
    const multiLoser = multiWinner === copiedMultiAppA ? copiedMultiAppB : copiedMultiAppA;
    const multiWinnerHarness = multiWinner === copiedMultiAppA ? copiedMultiTabA : copiedMultiTabB;
    const multiLoserHarness = multiWinner === copiedMultiAppA ? copiedMultiTabB : copiedMultiTabA;
    const staleMultiLoser = multiWinner === copiedMultiAppA ? staleMultiB : staleMultiA;
    const multiWinnerSession = multiWinner.multiSuiteSessionsMap.get(multiSuiteSession.baseExamId);
    assert(multiWinnerSession);
    assert.equal(multiLoser.multiSuiteSessionsMap.size, 0, 'the copied multi-suite loser must not become a runtime owner');
    assert.equal(sharedMultiLocks.held.size, 2);
    assert.equal(sharedMultiLocks.calls[0].name, sharedMultiLocks.calls[1].name);
    assert.equal(
        multiLoserHarness.sessionStore.peek('multi-suite-practice').sessions[0].recoveryLeaseContended,
        true
    );
    multiWinnerSession.revision += 1;
    staleMultiLoser.revision += 1;
    const multiSaveCountBefore = copiedMultiTabA.recoveryCalls.save + copiedMultiTabB.recoveryCalls.save;
    const [multiWinnerCommit, multiLoserCommit] = await Promise.all([
        multiWinner._commitMultiSuiteRecovery(multiWinnerSession),
        multiLoser._commitMultiSuiteRecovery(staleMultiLoser)
    ]);
    assert.deepEqual([multiWinnerCommit, multiLoserCommit], [true, false]);
    assert.equal(
        copiedMultiTabA.recoveryCalls.save + copiedMultiTabB.recoveryCalls.save,
        multiSaveCountBefore + 1,
        'only the multi-suite object bound to the held claim may commit'
    );
    assert.equal(await multiWinner._releaseSuiteRecoveryClaim('multi', multiWinnerSession), true);
    assert.equal(sharedMultiLocks.held.size, 0);

    const uncontendedMultiHarness = createHarness();
    const uncontendedMultiSession = {
        ...structuredClone(multiSuiteSession),
        id: 'multi-uncontended-pre-first-save',
        baseExamId: 'listening-multi-uncontended-pre-first-save',
        revision: 0
    };
    uncontendedMultiHarness.sessionStore.save('multi-suite-practice', {
        ...structuredClone(multiSuiteWal),
        sessions: [structuredClone(uncontendedMultiSession)]
    });
    const uncontendedMultiApp = uncontendedMultiHarness.makeApp();
    uncontendedMultiApp.initializeSuiteMode();
    await uncontendedMultiApp._ensureSuiteRecoveryReady();
    const uncontendedMultiRestored = uncontendedMultiApp.multiSuiteSessionsMap.get(uncontendedMultiSession.baseExamId);
    assert(uncontendedMultiRestored, 'an uncontended multi WAL with no fence must be migrated, not discarded');
    assert.equal(uncontendedMultiHarness.recoveryCalls.save, 1);
    assert.equal(await uncontendedMultiApp._releaseSuiteRecoveryClaim('multi', uncontendedMultiRestored), true);

    const preSaveMultiLocks = createExclusiveLockManager();
    const preSaveMultiDurable = new Map();
    const preSaveMultiFences = new Map();
    const preSaveMultiOwnerHarness = createHarness({
        locks: preSaveMultiLocks,
        activeSessionStore: preSaveMultiDurable,
        recoveryFenceStore: preSaveMultiFences
    });
    const preSaveMultiOwner = preSaveMultiOwnerHarness.makeApp();
    preSaveMultiOwner.multiSuiteSessionsMap = new Map();
    const preSaveMultiSession = {
        ...structuredClone(multiSuiteSession),
        id: 'multi-pre-first-save-crash',
        baseExamId: 'listening-multi-pre-first-save-crash',
        revision: 0
    };
    assert.equal(await preSaveMultiOwner._acquireMultiSuiteRecoveryOwnership(preSaveMultiSession), true);
    preSaveMultiOwner.multiSuiteSessionsMap.set(preSaveMultiSession.baseExamId, preSaveMultiSession);
    assert.equal(preSaveMultiOwner._mirrorMultiSuiteSessionsToStorage(), true);
    const preSaveMultiWal = structuredClone(
        preSaveMultiOwnerHarness.sessionStore.peek('multi-suite-practice')
    );

    const preSaveMultiLoserHarness = createHarness({
        locks: preSaveMultiLocks,
        activeSessionStore: preSaveMultiDurable,
        recoveryFenceStore: preSaveMultiFences
    });
    preSaveMultiLoserHarness.sessionStore.save('multi-suite-practice', structuredClone(preSaveMultiWal));
    const preSaveMultiLoser = preSaveMultiLoserHarness.makeApp();
    preSaveMultiLoser.initializeSuiteMode();
    await preSaveMultiLoser._ensureSuiteRecoveryReady();
    assert.equal(preSaveMultiLoser.multiSuiteSessionsMap.size, 0);
    assert.equal(
        preSaveMultiLoserHarness.sessionStore.peek('multi-suite-practice').sessions[0].recoveryLeaseContended,
        true
    );
    assert.equal(await preSaveMultiOwner._releaseSuiteRecoveryClaim('multi', preSaveMultiSession), true);
    assert.equal(preSaveMultiLocks.held.size, 0);

    const preSaveMultiTakeoverHarness = createHarness({
        locks: preSaveMultiLocks,
        activeSessionStore: preSaveMultiDurable,
        recoveryFenceStore: preSaveMultiFences
    });
    preSaveMultiTakeoverHarness.sessionStore.save(
        'multi-suite-practice',
        structuredClone(preSaveMultiLoserHarness.sessionStore.peek('multi-suite-practice'))
    );
    const preSaveMultiTakeover = preSaveMultiTakeoverHarness.makeApp();
    preSaveMultiTakeover.initializeSuiteMode();
    await preSaveMultiTakeover._ensureSuiteRecoveryReady();
    const migratedPreSaveMulti = preSaveMultiTakeover.multiSuiteSessionsMap.get(preSaveMultiSession.baseExamId);
    assert(migratedPreSaveMulti, 'a missing fence must migrate the contended multi WAL after owner crash');
    assert.equal(preSaveMultiTakeoverHarness.recoveryCalls.save, 1);
    assert.equal(preSaveMultiDurable.get(preSaveMultiSession.id).schema, 'multi-suite-sessions-v2');
    assert.equal(await preSaveMultiTakeover._releaseSuiteRecoveryClaim('multi', migratedPreSaveMulti), true);
    assert.equal(preSaveMultiLocks.held.size, 0);

    const expiredMultiHarness = createHarness();
    const expiredMultiSession = {
        ...structuredClone(multiSuiteSession),
        id: 'multi-expired-copied-wal',
        baseExamId: 'listening-multi-expired-copied-wal',
        revision: 0,
        lastUpdate: Date.now() - (31 * 24 * 60 * 60 * 1000)
    };
    expiredMultiHarness.sessionStore.save('multi-suite-practice', {
        ...structuredClone(multiSuiteWal),
        sessions: [expiredMultiSession],
        updatedAt: Date.now()
    });
    const expiredMultiApp = expiredMultiHarness.makeApp();
    expiredMultiApp.initializeSuiteMode();
    await expiredMultiApp._ensureSuiteRecoveryReady();
    assert.equal(expiredMultiApp.multiSuiteSessionsMap.size, 0);
    assert.equal(expiredMultiHarness.sessionStore.peek('multi-suite-practice'), null);
    assert.equal(expiredMultiHarness.recoveryCalls.save, 0);

    const throwingFileLocks = {
        calls: 0,
        request() { this.calls += 1; throw new Error('file: must bypass Web Locks'); }
    };
    const multiFileFallbackHarness = createHarness({ protocol: 'file:', locks: throwingFileLocks });
    multiFileFallbackHarness.activeSessionStore.set(multiSuiteDurable.id, structuredClone(multiSuiteDurable));
    const multiFileFallbackApp = multiFileFallbackHarness.makeApp();
    multiFileFallbackApp.initializeSuiteMode();
    await multiFileFallbackApp._ensureSuiteRecoveryReady();
    assert.equal(
        multiFileFallbackApp.multiSuiteSessionsMap.get(multiSuiteSession.baseExamId).id,
        multiSuiteSession.id,
        'file: must retain durable-only multi-suite recovery fallback'
    );
    assert.equal(throwingFileLocks.calls, 0);

    const fileWindowOnlyHarness = createHarness({ protocol: 'file:', locks: throwingFileLocks });
    const fileWindowOnlySession = {
        ...structuredClone(multiSuiteSession),
        id: 'multi-file-window-only',
        baseExamId: 'listening-multi-file-window-only',
        revision: 0
    };
    fileWindowOnlyHarness.sessionStore.save('multi-suite-practice', {
        ...structuredClone(multiSuiteWal),
        sessions: [fileWindowOnlySession]
    });
    const fileWindowOnlyApp = fileWindowOnlyHarness.makeApp();
    fileWindowOnlyApp.initializeSuiteMode();
    await fileWindowOnlyApp._ensureSuiteRecoveryReady();
    assert(fileWindowOnlyApp.multiSuiteSessionsMap.has(fileWindowOnlySession.baseExamId));
    assert.equal(fileWindowOnlyHarness.recoveryCalls.save, 1, 'file: window-only multi WAL must establish expected=0 durable CAS');
    assert.equal(throwingFileLocks.calls, 0);

    const noLocksHarness = createHarness({ locks: null });
    noLocksHarness.sessionStore.save('simulation', structuredClone(matchedLocalWal));
    noLocksHarness.activeSessionStore.set(matchedDurable.id, structuredClone(matchedDurable));
    const noLocksApp = noLocksHarness.makeApp();
    noLocksApp.initializeSuiteMode();
    await noLocksApp._ensureSuiteRecoveryReady();
    assert.equal(noLocksApp.currentSuiteSession, null, 'HTTP recovery must fail closed without navigator.locks');
    assert.equal(noLocksHarness.recoveryCalls.save, 0);
    assert.equal(noLocksHarness.recoveryCalls.discard, 0);
    assert.equal(
        noLocksHarness.sessionStore.peek('simulation').recoveryLeaseContended,
        true,
        'an unavailable group lock must preserve and mark the WAL for a later retry'
    );
    assert.equal(noLocksHarness.sessionStore.peek('simulation').id, matchedLocalWal.id);
    assert.equal(noLocksHarness.sessionStore.peek('simulation').revision, matchedLocalWal.revision);

    const throwingLocks = createExclusiveLockManager();
    throwingLocks.failNext(new Error('locks backend unavailable'));
    const throwingLocksHarness = createHarness({ locks: throwingLocks });
    throwingLocksHarness.sessionStore.save('simulation', structuredClone(matchedLocalWal));
    throwingLocksHarness.activeSessionStore.set(matchedDurable.id, structuredClone(matchedDurable));
    const throwingLocksApp = throwingLocksHarness.makeApp();
    throwingLocksApp.initializeSuiteMode();
    await throwingLocksApp._ensureSuiteRecoveryReady();
    assert.equal(throwingLocksApp.currentSuiteSession, null, 'request failure must fail closed without hanging');
    assert.equal(throwingLocksHarness.sessionStore.peek('simulation').recoveryLeaseContended, true);
    assert.equal(throwingLocksHarness.sessionStore.peek('simulation').id, matchedLocalWal.id);
    assert.equal(throwingLocksHarness.sessionStore.peek('simulation').revision, matchedLocalWal.revision);
    assert.equal(throwingLocksHarness.recoveryCalls.save, 0);
    assert.equal(throwingLocksHarness.recoveryCalls.discard, 0);
    assert.equal(throwingLocks.held.size, 0, 'a failed group request must not leak a hold');
    assert.deepEqual(
        throwingLocks.calls.map((call) => call.name),
        [throwingLocksApp._singleSuiteRecoveryGroupClaimName()],
        'a failed group request must stop before the WAL exact-id request'
    );
    assert.equal(
        await throwingLocksApp._refreshSuiteRecoveryCandidates(),
        throwingLocksApp.currentSuiteSession,
        'group request failure must not terminalize the serialized WAL retry'
    );
    assert.equal(throwingLocksApp.currentSuiteSession.id, matchedDurable.id);
    assert.equal(await throwingLocksApp._releaseSuiteRecoveryClaim(
        'single',
        throwingLocksApp.currentSuiteSession
    ), true);
    assert.equal(throwingLocks.held.size, 0);

    // Drafts may arrive after the child Window exists but before openExam() resolves.
    // The initializing snapshot must bind that exact source and persist the draft.
    const earlyHarness = createHarness();
    const initializingApp = earlyHarness.makeApp();
    let initializingWindow;
    initializingApp.openExam = async () => {
        initializingWindow = { closed: false, name: 'initializing-window' };
        initializingApp._installManagedTestWindow('p1', initializingWindow);
        const initializingSession = initializingApp.currentSuiteSession;
        assert.equal(initializingSession.status, 'active');
        const accepted = await initializingApp._handleSuiteDraftSync('p1', {
            suiteSessionId: initializingSession.id,
            draft: { answers: { q1: 'early' }, updatedAt: 120 },
            draftUpdatedAt: 120,
            elapsed: 4
        }, initializingApp.examWindows.get('p1'), initializingWindow);
        assert.equal(accepted, true);
        assert.equal(initializingSession.windowRef, initializingWindow);
        return initializingWindow;
    };
    assert.equal(await initializingApp._launchSuiteSessionFromSequence(sequence, { flowMode: 'simulation' }), true);

    const choiceHarness = createHarness();
    const choiceSourceApp = choiceHarness.makeApp();
    choiceSourceApp.openExam = async () => ({ closed: false, name: 'choice-window', close() { this.closed = true; } });
    assert.equal(await choiceSourceApp._launchSuiteSessionFromSequence(sequence, { flowMode: 'simulation' }), true);
    const choiceApp = choiceHarness.makeApp();
    choiceApp.initializeSuiteMode();
    await choiceApp._ensureSuiteRecoveryReady();
    const choiceCandidate = await choiceApp.getSuiteRecoveryCandidate();
    assert.equal(choiceCandidate.id, choiceSourceApp.currentSuiteSession.id);
    let implicitResumeCount = 0;
    choiceApp.resumeSuitePractice = async () => { implicitResumeCount += 1; return true; };
    assert.equal(await choiceApp.startSuitePractice(), false, '未明确选择时不得自动继续恢复套题');
    assert.equal(implicitResumeCount, 0, '再次点击套题入口不能隐式等同于继续');
    assert.equal(await choiceApp.abandonSuiteRecovery(), false, '放弃 recovery 必须携带用户看到的 session id');
    assert.equal(await choiceApp.startSuitePractice({ recoveryAction: 'continue' }), false, '继续 recovery 必须携带用户看到的 session id');
    assert.equal(await choiceApp.abandonSuiteRecovery('another-suite'), false, '放弃操作必须绑定用户确认的 recovery identity');
    assert.equal(choiceApp.currentSuiteSession.id, choiceCandidate.id);
    assert.equal(await choiceApp.abandonSuiteRecovery(choiceCandidate.id), true, '用户明确放弃后应完整 teardown');
    assert.equal(choiceApp.currentSuiteSession, null);
    assert.equal(choiceHarness.activeSessionStore.size, 0, '放弃必须清除 durable active-session recovery');
    assert.equal(choiceHarness.practiceFinalizes.length, 0, '放弃未完成套题不得生成单篇或聚合记录');

    const discardFailureHarness = createHarness();
    const discardFailureApp = discardFailureHarness.makeApp();
    const discardFailureWindow = { closed: false, name: 'discard-failure', close() { this.closed = true; } };
    discardFailureApp.openExam = async () => discardFailureWindow;
    discardFailureApp.initializeSuiteMode();
    await discardFailureApp._ensureSuiteRecoveryReady();
    assert.equal(await discardFailureApp._launchSuiteSessionFromSequence(sequence, { flowMode: 'simulation' }), true);
    const discardFailureSession = discardFailureApp.currentSuiteSession;
    const discardFallbackTimer = setTimeout(() => {}, 60000);
    discardFallbackTimer.unref?.();
    discardFailureSession.submitReceiptTeardownTimer = discardFallbackTimer;
    discardFailureHarness.recoveryCalls.discardQueue.push(false);
    assert.equal(await discardFailureApp.abandonSuiteRecovery(discardFailureSession.id), false);
    assert.equal(discardFailureApp.currentSuiteSession, discardFailureSession, 'discard failure must retain the in-memory suite');
    assert.equal(discardFailureSession.status, 'active', 'discard failure must not mark the suite aborted');
    assert.equal(discardFailureWindow.closed, false, 'discard failure must not close the active question window');
    assert.equal(discardFailureSession.submitReceiptTeardownTimer, discardFallbackTimer, 'discard failure must preserve the fallback teardown timer');
    assert(discardFailureHarness.activeSessionStore.has(discardFailureSession.id), 'discard failure must retain durable recovery');
    assert.equal(await discardFailureApp.abandonSuiteRecovery(discardFailureSession.id), true, 'discard should remain retryable');

    const queuedWriteHarness = createHarness();
    const queuedWriteApp = queuedWriteHarness.makeApp();
    const queuedWriteWindow = { closed: false, name: 'queued-write', close() { this.closed = true; } };
    queuedWriteApp.openExam = async () => queuedWriteWindow;
    queuedWriteApp.initializeSuiteMode();
    await queuedWriteApp._ensureSuiteRecoveryReady();
    assert.equal(await queuedWriteApp._launchSuiteSessionFromSequence(sequence, { flowMode: 'simulation' }), true);
    const queuedWriteSession = queuedWriteApp.currentSuiteSession;
    let releaseQueuedSave;
    let markQueuedSaveStarted;
    const queuedSaveStarted = new Promise((resolve) => { markQueuedSaveStarted = resolve; });
    queuedWriteHarness.recoveryCalls.saveQueue.push(async () => {
        markQueuedSaveStarted();
        return new Promise((resolve) => { releaseQueuedSave = resolve; });
    });
    const pendingRecoveryWrite = queuedWriteApp._commitSuiteRecovery(queuedWriteSession, { reason: 'queued-before-discard' });
    await queuedSaveStarted;
    const queuedAbandon = queuedWriteApp.abandonSuiteRecovery(queuedWriteSession.id);
    await Promise.resolve();
    assert.equal(queuedWriteWindow.closed, false, 'teardown must not close the window before the queued write settles');
    releaseQueuedSave({ committed: true });
    assert.equal(await pendingRecoveryWrite, true);
    assert.equal(await queuedAbandon, true);
    assert.equal(queuedWriteHarness.activeSessionStore.has(queuedWriteSession.id), false, 'discard must run after queued save and prevent resurrection');

    const submitAbandonHarness = createHarness();
    const submitAbandonApp = submitAbandonHarness.makeApp();
    let submitAbandonOpenCount = 0;
    const submitAbandonWindow = { closed: false, name: 'submit-abandon', close() { this.closed = true; } };
    submitAbandonApp.openExam = async () => {
        submitAbandonOpenCount += 1;
        return submitAbandonWindow;
    };
    submitAbandonApp.initializeSuiteMode();
    await submitAbandonApp._ensureSuiteRecoveryReady();
    assert.equal(await submitAbandonApp._launchSuiteSessionFromSequence(sequence, { flowMode: 'simulation' }), true);
    const submitAbandonSession = submitAbandonApp.currentSuiteSession;
    let releaseSubmitSave;
    let markSubmitSaveStarted;
    const submitSaveStarted = new Promise((resolve) => { markSubmitSaveStarted = resolve; });
    submitAbandonHarness.recoveryCalls.saveQueue.push(async () => {
        markSubmitSaveStarted();
        return new Promise((resolve) => { releaseSubmitSave = resolve; });
    });
    const submitOutcomePromise = submitAbandonApp.handleSuitePracticeComplete('p1', {
        suiteSessionId: submitAbandonSession.id,
        submissionId: 'submit-abandon-p1',
        duration: 10,
        answers: { q1: 'A' },
        answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
        scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
    }, submitAbandonWindow);
    await submitSaveStarted;
    const submitAbandonPromise = submitAbandonApp.abandonSuiteRecovery(submitAbandonSession.id);
    await Promise.resolve();
    releaseSubmitSave({ committed: true });
    const submitOutcome = await submitOutcomePromise;
    assert.equal(submitOutcome.handled, true);
    assert.equal(submitOutcome.committed, false, 'abandon must invalidate the in-flight submit continuation before ACK');
    assert.equal(submitOutcome.errorCode, 'suite_teardown_in_progress');
    assert.equal(await submitAbandonPromise, true);
    assert.equal(submitAbandonOpenCount, 1, 'an abandoned submit must not open the next passage');

    const walPreservationHarness = createHarness();
    const walSourceApp = walPreservationHarness.makeApp();
    walSourceApp.openExam = async () => ({ closed: false, name: 'wal-source' });
    walSourceApp.initializeSuiteMode();
    await walSourceApp._ensureSuiteRecoveryReady();
    assert.equal(await walSourceApp._launchSuiteSessionFromSequence(sequence, { flowMode: 'simulation' }), true);
    const validWal = walPreservationHarness.sessionStore.peek('simulation');
    walPreservationHarness.activeSessionStore.clear();
    walPreservationHarness.activeSessionStore.set(validWal.id, {
        schema: 'suite-session-v2',
        version: 2,
        id: validWal.id,
        status: 'invalid',
        revision: 4,
        lastUpdate: Number(validWal.lastUpdate) + 1000
    });
    walPreservationHarness.recoveryCalls.saveQueue.push((value, options) => {
        assert.equal(options.expectedEntityRevision, 4, 'invalid durable repair must CAS against the listed entity revision');
        assert(value.revision > 4, 'the repaired snapshot must advance beyond the invalid durable revision');
        return { committed: true };
    });
    const walRestoredApp = walPreservationHarness.makeApp();
    walRestoredApp.initializeSuiteMode();
    await walRestoredApp._ensureSuiteRecoveryReady();
    assert.equal(walRestoredApp.currentSuiteSession.id, validWal.id, 'invalid durable candidates must not erase a valid window WAL');
    assert.equal(walPreservationHarness.sessionStore.peek('simulation').id, validWal.id);
    assert.equal(walPreservationHarness.recoveryCalls.discard, 0, 'matching invalid durable state must be repaired without writing a tombstone');
    assert.equal(walRestoredApp.currentSuiteSession._suiteRecoveryWritesBlocked, undefined);

    const unsafeRevisionHarness = createHarness();
    const unsafeRevisionSource = unsafeRevisionHarness.makeApp();
    unsafeRevisionSource.openExam = async () => ({ closed: false, name: 'unsafe-revision-source' });
    unsafeRevisionSource.initializeSuiteMode();
    await unsafeRevisionSource._ensureSuiteRecoveryReady();
    assert.equal(await unsafeRevisionSource._launchSuiteSessionFromSequence(sequence, { flowMode: 'simulation' }), true);
    const unsafeRevisionWal = unsafeRevisionHarness.sessionStore.peek('simulation');
    unsafeRevisionHarness.activeSessionStore.clear();
    unsafeRevisionHarness.activeSessionStore.set(unsafeRevisionWal.id, {
        schema: 'suite-session-v2',
        version: 2,
        id: unsafeRevisionWal.id,
        status: 'invalid',
        revision: 1.5,
        lastUpdate: Number(unsafeRevisionWal.lastUpdate) + 1000
    });
    unsafeRevisionHarness.recoveryCalls.saveQueue.push((value, options) => {
        assert.equal(options.expectedEntityRevision, 0, 'unsafe durable revisions must normalize to the initial CAS revision');
        assert(value.revision > 0);
        return { committed: true };
    });
    const unsafeRevisionRestoredApp = unsafeRevisionHarness.makeApp();
    unsafeRevisionRestoredApp.initializeSuiteMode();
    await unsafeRevisionRestoredApp._ensureSuiteRecoveryReady();
    assert.equal(unsafeRevisionRestoredApp.currentSuiteSession.id, unsafeRevisionWal.id);
    assert.equal(unsafeRevisionHarness.recoveryCalls.discard, 0);
    assert.notEqual(unsafeRevisionRestoredApp.currentSuiteSession._suiteRecoveryWritesBlocked, true);

    // A structurally valid single-suite entity with an unsafe imported revision must
    // be offered as revision 0, then remain both writable and abandonable under the
    // same safe-integer CAS contract used by AppData.
    for (const [label, unsafeRevision] of [
        ['fractional', 1.5],
        ['infinite', Number.POSITIVE_INFINITY],
        ['unsafe-integer', Number.MAX_SAFE_INTEGER + 1]
    ]) {
        const validUnsafeHarness = createHarness();
        const validUnsafeId = `suite-valid-unsafe-${label}`;
        const validUnsafeSnapshot = {
            ...structuredClone(tabOwnedDurable),
            id: validUnsafeId,
            revision: unsafeRevision,
            lastUpdate: fixtureTimeBase + 7000
        };
        validUnsafeHarness.sessionStore.save('simulation', {
            ...structuredClone(validUnsafeSnapshot),
            lastUpdate: fixtureTimeBase + 6000
        });
        validUnsafeHarness.activeSessionStore.set(validUnsafeId, structuredClone(validUnsafeSnapshot));
        const validUnsafeApp = validUnsafeHarness.makeApp();
        validUnsafeApp.initializeSuiteMode();
        await validUnsafeApp._ensureSuiteRecoveryReady();
        const restoredUnsafeSession = validUnsafeApp.currentSuiteSession;
        assert.equal(restoredUnsafeSession.id, validUnsafeId);
        assert.equal(restoredUnsafeSession.revision, 0, `${label} runtime revision must normalize to zero`);
        assert.equal(restoredUnsafeSession._lastDurableRecoveryRevision, 0, `${label} durable CAS base must normalize to zero`);

        const observedWrites = [];
        validUnsafeHarness.recoveryCalls.saveQueue.push((value, options) => {
            observedWrites.push({ value, options });
            return { committed: true };
        });
        validUnsafeHarness.recoveryCalls.saveQueue.push((value, options) => {
            observedWrites.push({ value, options });
            return { committed: true };
        });
        assert.equal(await validUnsafeApp._commitSuiteRecovery(restoredUnsafeSession, { notify: false }), true);
        assert.equal(await validUnsafeApp._commitSuiteRecovery(restoredUnsafeSession, { notify: false }), true);
        assert.equal(observedWrites[0].options.expectedEntityRevision, 0);
        assert.equal(observedWrites[0].value.revision, 1);
        assert.equal(observedWrites[1].options.expectedEntityRevision, 1);
        assert.equal(observedWrites[1].value.revision, 2);
        assert.equal(restoredUnsafeSession._lastDurableRecoveryRevision, 2);

        const abandonHarness = createHarness();
        abandonHarness.sessionStore.save('simulation', structuredClone(validUnsafeSnapshot));
        abandonHarness.activeSessionStore.set(validUnsafeId, structuredClone(validUnsafeSnapshot));
        const abandonApp = abandonHarness.makeApp();
        abandonApp.initializeSuiteMode();
        await abandonApp._ensureSuiteRecoveryReady();
        assert.equal(await abandonApp.abandonSuiteRecovery(validUnsafeId), true, `${label} recovery must remain abandonable`);
        assert.equal(abandonHarness.recoveryCalls.discardOptions.at(-1).expectedEntityRevision, 0);
        assert.equal(abandonApp.currentSuiteSession, null);
    }

    const invalidUnsafeFileHarness = createHarness({ protocol: 'file:' });
    invalidUnsafeFileHarness.activeSessionStore.set('suite-invalid-unsafe-file', {
        schema: 'suite-session-v2',
        version: 2,
        id: 'suite-invalid-unsafe-file',
        status: 'invalid',
        revision: Number.POSITIVE_INFINITY,
        lastUpdate: fixtureTimeBase + 8000
    });
    const invalidUnsafeFileApp = invalidUnsafeFileHarness.makeApp();
    invalidUnsafeFileApp.initializeSuiteMode();
    await invalidUnsafeFileApp._ensureSuiteRecoveryReady();
    assert.equal(invalidUnsafeFileApp.currentSuiteSession, null);
    assert.equal(invalidUnsafeFileHarness.recoveryCalls.discardOptions[0].expectedEntityRevision, 0);

    const walOrderingHarness = createHarness();
    const walOrderingSource = walOrderingHarness.makeApp();
    walOrderingSource.openExam = async () => ({ closed: false, name: 'wal-ordering-source' });
    walOrderingSource.initializeSuiteMode();
    await walOrderingSource._ensureSuiteRecoveryReady();
    assert.equal(await walOrderingSource._launchSuiteSessionFromSequence(sequence, { flowMode: 'simulation' }), true);
    const orderingBase = walOrderingHarness.sessionStore.peek('simulation');
    const laterTimestampSameRevision = {
        ...structuredClone(orderingBase),
        revision: 10,
        lastUpdate: fixtureTimeBase + 9000,
        currentIndex: 0,
        activeExamId: 'p1'
    };
    const higherDurableRevision = {
        ...structuredClone(orderingBase),
        revision: 10,
        lastUpdate: fixtureTimeBase + 1000,
        currentIndex: 1,
        activeExamId: 'p2'
    };
    walOrderingHarness.sessionStore.save('simulation', laterTimestampSameRevision);
    walOrderingHarness.activeSessionStore.set(orderingBase.id, higherDurableRevision);
    const savesBeforeEqualRevisionRestore = walOrderingHarness.recoveryCalls.save;
    const walOrderingApp = walOrderingHarness.makeApp();
    walOrderingApp.initializeSuiteMode();
    await walOrderingApp._ensureSuiteRecoveryReady();
    assert.equal(walOrderingApp.currentSuiteSession.currentIndex, 1, 'durable recovery must beat a later same-revision WAL branch');
    assert.equal(walOrderingApp.currentSuiteSession.activeExamId, 'p2');
    assert.equal(walOrderingHarness.recoveryCalls.save, savesBeforeEqualRevisionRestore, 'same-revision WAL must not be promoted');

    walOrderingHarness.sessionStore.save('simulation', {
        ...laterTimestampSameRevision,
        revision: 11
    });
    walOrderingHarness.activeSessionStore.set(orderingBase.id, higherDurableRevision);
    walOrderingHarness.recoveryCalls.saveQueue.push((_value, options) => {
        assert.equal(options.expectedEntityRevision, 10);
        walOrderingHarness.activeSessionStore.set(orderingBase.id, {
            ...higherDurableRevision,
            revision: 15
        });
        return { committed: false, code: 'STALE_RECOVERY_WRITE', actualEntityRevision: 15 };
    });
    const failedPromotionApp = walOrderingHarness.makeApp();
    failedPromotionApp.initializeSuiteMode();
    assert.equal(failedPromotionApp.currentSuiteSession, null, 'WAL promotion must remain quarantined until its claim and durable merge settle');
    await failedPromotionApp._ensureSuiteRecoveryReady();
    assert.equal(failedPromotionApp.currentSuiteSession.currentIndex, 1, 'failed promotion must fall back to durable progress');
    assert.equal(failedPromotionApp.currentSuiteSession.activeExamId, 'p2');
    assert.equal(failedPromotionApp.currentSuiteSession._lastDurableRecoveryRevision, 10, 'stale receipt must not adopt another tab revision');
    assert.equal(walOrderingHarness.sessionStore.peek('simulation').revision, 10, 'losing WAL must be replaced by the durable snapshot');
    const savesBeforeDurableReload = walOrderingHarness.recoveryCalls.save;
    const durableReloadApp = walOrderingHarness.makeApp();
    durableReloadApp.initializeSuiteMode();
    await durableReloadApp._ensureSuiteRecoveryReady();
    assert.equal(durableReloadApp.currentSuiteSession.activeExamId, 'p2');
    assert.equal(walOrderingHarness.recoveryCalls.save, savesBeforeDurableReload, 'reload must not retry the losing WAL');

    const resumedApp = makeApp();
    resumedApp.initializeSuiteMode();
    await resumedApp._ensureSuiteRecoveryReady();
    assert.equal(resumedApp.currentSuiteSession.id, firstApp.currentSuiteSession.id);
    assert.equal(resumedApp.currentSuiteSession.activeExamId, 'p1');
    assert.equal(resumedApp.currentSuiteSession.globalTimerAnchorMs, firstApp.currentSuiteSession.globalTimerAnchorMs);

    const suiteWindow = { closed: false, name: 'suite-window' };
    const session = resumedApp.currentSuiteSession;
    session.status = 'active';
    session.windowRef = suiteWindow;
    session.activeExamId = 'p2';
    session.currentIndex = 1;
    resumedApp._installManagedTestWindow('p2', suiteWindow);
    const windowInfo = resumedApp.examWindows.get('p2');
    assert.equal(await resumedApp._handleSuiteDraftSync('p2', {
        suiteSessionId: session.id,
        draft: { answers: { q2: 'new' }, updatedAt: 100 },
        draftUpdatedAt: 100,
        elapsed: 12
    }, windowInfo, suiteWindow), true);
    assert.deepEqual(session.draftsByExam.p2.answers, { q2: 'new' });
    assert.equal(await resumedApp._handleSuiteDraftSync('p2', {
        suiteSessionId: session.id,
        draft: { answers: { q2: 'equal-must-reject' }, updatedAt: 100 },
        draftUpdatedAt: 100
    }, windowInfo, suiteWindow), false);
    assert.deepEqual(session.draftsByExam.p2.answers, { q2: 'new' });
    assert.equal(await resumedApp._handleSuiteDraftSync('p2', {
        suiteSessionId: session.id,
        draft: { answers: { q2: 'missing-time-must-reject' } }
    }, windowInfo, suiteWindow), false);
    assert.equal(await resumedApp._handleSuiteDraftSync('p1', {
        suiteSessionId: session.id,
        draft: { answers: { q1: 'late-p1' }, updatedAt: 200 },
        draftUpdatedAt: 200
    }, windowInfo, suiteWindow), true);
    assert.equal(session.activeExamId, 'p2', '迟到的旧篇草稿不得回滚活动篇章');
    assert.equal(session.currentIndex, 1);

    // A paused suite must retain its pause state when a draft omits timer fields.
    const pausedSession = {
        ...session,
        suiteTimerRunning: false,
        suiteTimerPausedAtMs: 5000,
        suiteTimerPausedOffsetMs: 3000
    };
    resumedApp._syncSuiteTimerFromPayload(pausedSession, {
        draft: { answers: { q1: 'paused' }, updatedAt: 300 }
    });
    assert.equal(pausedSession.suiteTimerRunning, false, '普通草稿同步不得恢复暂停套题计时');
    assert.equal(pausedSession.suiteTimerPausedAtMs, 5000, '普通草稿同步不得清除暂停时间');

    let openedOnResume = false;
    resumedApp.openExam = async () => {
        openedOnResume = true;
        return { closed: false, name: 'replacement' };
    };
    session.windowRef = null;
    session._restoredFromStorage = true;
    resumedApp._fetchSuiteExamIndex = async () => sequence.map((entry) => entry.exam);
    assert.equal(await resumedApp.resumeSuitePractice(session.id), true);
    assert.equal(openedOnResume, true);
    assert.equal(sessionStore.peek('simulation').draftsByExam.p2.answers.q2, 'new');

    const missingApp = makeApp();
    missingApp.initializeSuiteMode();
    await missingApp._ensureSuiteRecoveryReady();
    missingApp._fetchSuiteExamIndex = async () => [sequence[0].exam];
    missingApp.openExam = async () => { throw new Error('must not open missing exam'); };
    const missingRecoveryId = missingApp.currentSuiteSession.id;
    const discardCallsBeforeMismatch = sessionStore.calls.discard;
    assert.equal(await missingApp.resumeSuitePractice(missingApp.currentSuiteSession.id), false);
    assert.equal(sessionStore.peek('simulation').id, missingRecoveryId, '题库不一致不得擅自放弃 recovery');
    assert.equal(sessionStore.calls.discard, discardCallsBeforeMismatch, '题库不一致不得清除窗口恢复镜像');
    assert.equal(
        messages.some((entry) => entry.type === 'warning' && entry.text.includes('恢复数据仍会保留')),
        true,
        '题库不一致必须明确告知用户 recovery 已保留'
    );

    const invalidTerminalSnapshot = {
        schema: 'suite-session-v2',
        version: 2,
        id: 'suite_invalid_terminal',
        status: 'finalizing',
        sequence,
        suiteSequence: sequence,
        currentIndex: sequence.length,
        activeExamId: null,
        results: [{
            examId: 'p1',
            title: 'Passage 1',
            category: 'P1',
            scoreInfo: { correct: 1, total: 1 }
        }],
        draftsByExam: {},
        elapsedByExam: {},
        suiteTimerMode: 'elapsed',
        suiteTimerLimitSeconds: 3600,
        startTime: 1000,
        globalTimerAnchorMs: 1000,
        suiteTimerAnchorMs: 1000,
        lastUpdate: fixtureTimeBase + 1000
    };
    sessionStore.save('simulation', invalidTerminalSnapshot);
    const corruptApp = makeApp();
    corruptApp.initializeSuiteMode();
    assert.equal(corruptApp.currentSuiteSession, null, '不完整终态快照必须被丢弃');
    assert.equal(sessionStore.peek('simulation'), null, '不完整终态快照不得永久卡在 finalizing');

    const validTerminalResults = sequence.map((entry) => ({
        examId: entry.examId,
        title: entry.exam.title,
        category: entry.category,
        duration: 10,
        scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 },
        answers: { [`q-${entry.examId}`]: 'A' },
        answerComparison: {}
    }));
    const terminalActiveId = 'suite_terminal_active_id';
    const terminalActiveHarness = createHarness();
    terminalActiveHarness.sessionStore.save('simulation', {
        ...invalidTerminalSnapshot,
        id: terminalActiveId,
        status: 'active',
        activeExamId: 'p3',
        results: validTerminalResults,
        finalizeOperationId: null,
        finalizeRecord: null
    });
    const terminalActiveApp = terminalActiveHarness.makeApp();
    terminalActiveApp.initializeSuiteMode();
    await terminalActiveApp._ensureSuiteRecoveryReady();
    assert.equal(terminalActiveApp.currentSuiteSession.status, 'finalizing', '已完成索引的活动篇章快照必须转入终态恢复');
    assert.equal(terminalActiveApp.currentSuiteSession.activeExamId, null, '终态恢复不得重新打开最后一篇');

    const malformedRecordId = 'suite_malformed_record';
    sessionStore.save('simulation', {
        ...invalidTerminalSnapshot,
        id: malformedRecordId,
        results: validTerminalResults,
        finalizeOperationId: `practice-suite:${malformedRecordId}:finalize`,
        finalizeRecord: {
            id: malformedRecordId,
            sessionId: malformedRecordId,
            operationId: `practice-suite:${malformedRecordId}:finalize`,
            suiteEntries: sequence.map((entry) => ({ examId: entry.examId }))
        }
    });
    const malformedRecordApp = makeApp();
    malformedRecordApp.initializeSuiteMode();
    assert.equal(malformedRecordApp.currentSuiteSession, null, '缺少聚合字段的终态记录不得重放');
    assert.equal(sessionStore.peek('simulation'), null);

    const incompleteFinalizeApp = makeApp();
    const incompleteFinalizeSession = {
        id: 'suite_incomplete_finalize',
        status: 'active',
        startTime: 1000,
        sequence,
        currentIndex: 2,
        activeExamId: 'p3',
        results: validTerminalResults.filter((entry) => entry.examId !== 'p2'),
        draftsByExam: {},
        elapsedByExam: {},
        flowMode: 'stationary',
        windowRef: null
    };
    incompleteFinalizeApp.currentSuiteSession = incompleteFinalizeSession;
    incompleteFinalizeApp._saveSuitePracticeRecord = async () => {
        throw new Error('incomplete suite must not be persisted');
    };
    assert.equal(await incompleteFinalizeApp._finalizeSuiteRecordWithGate(incompleteFinalizeSession), false);
    assert.equal(incompleteFinalizeSession.status, 'active');
    assert.equal(incompleteFinalizeSession.currentIndex, 1);
    assert.equal(incompleteFinalizeSession.activeExamId, 'p2');

    const finalApp = makeApp();
    let committedRecord = null;
    const finalSession = {
        id: 'suite_terminal',
        status: 'active',
        startTime: 1000,
        globalTimerAnchorMs: 1000,
        suiteTimerAnchorMs: 1000,
        sequence,
        currentIndex: sequence.length,
        activeExamId: null,
        results: sequence.map((entry) => ({
            examId: entry.examId,
            title: entry.exam.title,
            category: entry.category,
            duration: 10,
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 },
            answers: { [`q-${entry.examId}`]: 'A' },
            answerComparison: {}
        })),
        draftsByExam: {},
        elapsedByExam: {},
        windowRef: null,
        windowBinding: {
            examId: 'p3',
            expectedSessionId: 'terminal-window-session',
            windowSessionToken: 'terminal-window-token',
            sessionGeneration: 2
        }
    };
    const finalChild = {
        closed: false,
        postMessage() {},
        close() { this.closed = true; }
    };
    finalApp.currentSuiteSession = finalSession;
    finalApp._resolveSuiteSequenceNumber = async () => 1;
    finalApp._formatSuiteDateLabel = () => '2026-08-07';
    finalApp._updatePracticeRecordsState = async () => {};
    finalApp._postExamMessage = () => true;
    finalApp.refreshOverviewData = () => {};
    let reboundTerminalExamId = '';
    finalApp._tryRebindSuiteWindow = async (_session, entry) => {
        reboundTerminalExamId = entry.examId;
        finalApp.examWindows = new Map([[entry.examId, {
            window: finalChild,
            suiteSessionId: finalSession.id,
            expectedSessionId: finalSession.windowBinding.expectedSessionId,
            windowSessionToken: finalSession.windowBinding.windowSessionToken,
            windowSessionTokenSessionId: finalSession.windowBinding.expectedSessionId,
            sessionGeneration: finalSession.windowBinding.sessionGeneration
        }]]);
        return { window: finalChild };
    };
    assert.equal(await finalApp.resumeSuitePractice(finalSession.id), true);
    committedRecord = practiceFinalizes[0] && practiceFinalizes[0].record;
    assert.equal(practiceFinalizes.length, 1, '终态恢复必须调用 v2 AppData.practice.finalizeSuite');
    assert.equal(practiceFinalizes[0].operationId, 'practice-suite:suite_terminal:finalize');
    assert.equal(practiceFinalizes[0].record.operationId, practiceFinalizes[0].operationId);
    assert.equal(sessionStore.peek('simulation'), null);
    assert.equal(finalSession.status, 'completed');
    assert.equal(reboundTerminalExamId, 'p3', '终态恢复必须按持久 binding 重新绑定存活题页');
    assert.equal(finalChild.closed, true, '终态恢复完成后必须关闭重新绑定的题页');
    assert.equal(messages.some((entry) => entry.type === 'error'), false);

    const divergentId = 'suite_divergent_record';
    sessionStore.save('simulation', {
        ...invalidTerminalSnapshot,
        id: divergentId,
        results: validTerminalResults,
        finalizeOperationId: `practice-suite:${divergentId}:finalize`,
        finalizeRecord: {
            ...committedRecord,
            id: divergentId,
            sessionId: divergentId,
            operationId: `practice-suite:${divergentId}:finalize`,
            correctAnswers: 999,
            scoreInfo: { ...committedRecord.scoreInfo, correct: 999 }
        }
    });
    const divergentApp = makeApp();
    divergentApp.initializeSuiteMode();
    assert.equal(divergentApp.currentSuiteSession, null, '分数与结果不一致的终态聚合记录必须被丢弃');
    assert.equal(sessionStore.peek('simulation'), null);

    const concurrentApp = makeApp();
    const concurrentWindow = { closed: false, name: 'concurrent-window' };
    const concurrentSession = {
        ...finalSession,
        id: 'suite_concurrent_finalize',
        status: 'active',
        currentIndex: 0,
        activeExamId: 'p1',
        results: [],
        draftsByExam: {},
        elapsedByExam: {},
        flowMode: 'simulation',
        windowRef: concurrentWindow,
        finalizeRecord: null,
        finalizeOperationId: null,
        _lastDurableRecoveryRevision: 0,
        _suiteRecoveryWritesBlocked: false,
        _suiteTeardownInProgress: false,
        _teardownPromise: null
    };
    concurrentApp.currentSuiteSession = concurrentSession;
    concurrentApp._resolveSuiteSequenceNumber = async () => 1;
    concurrentApp._formatSuiteDateLabel = () => '2026-08-07';
    concurrentApp._updatePracticeRecordsState = async () => {};
    concurrentApp.refreshOverviewData = () => {};
    concurrentApp._suiteModeReady = true;
    let finalizeCalls = 0;
    let releaseFinalizeSave;
    let markFinalizeSaveStarted;
    const finalizeSaveStarted = new Promise((resolve) => { markFinalizeSaveStarted = resolve; });
    const finalizeSaveGate = new Promise((resolve) => { releaseFinalizeSave = resolve; });
    concurrentApp._saveSuitePracticeRecord = async (record) => {
        finalizeCalls += 1;
        markFinalizeSaveStarted();
        await finalizeSaveGate;
        return record;
    };
    const concurrentPayload = {
        suiteSessionId: concurrentSession.id,
        suiteSubmission: true,
        submissionId: 'submission-concurrent',
        suiteEntries: sequence.map((entry) => ({
            examId: entry.examId,
            duration: 10,
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 },
            answers: { [`q-${entry.examId}`]: 'A' },
            answerComparison: {}
        }))
    };
    const concurrentSubmits = [
        concurrentApp._handleInlineSimulationSuiteSubmit('p1', concurrentPayload, concurrentWindow),
        concurrentApp._handleInlineSimulationSuiteSubmit('p1', concurrentPayload, concurrentWindow)
    ];
    await finalizeSaveStarted;
    assert.equal(await concurrentApp.abandonSuiteRecovery(concurrentSession.id), false, 'live finalize 期间不得承诺放弃成功');
    assert.equal(concurrentApp.currentSuiteSession, concurrentSession, '拒绝放弃时必须保留当前 finalizing session');
    releaseFinalizeSave();
    const concurrentOutcomes = await Promise.all(concurrentSubmits);
    assert.equal(finalizeCalls, 1, '并发 inline submit 必须复用同一个 finalize promise');
    assert.equal(concurrentOutcomes.every((outcome) => outcome && outcome.committed === true), true);

    const mirrorHarness = createHarness();
    const mirrorApp = mirrorHarness.makeApp();
    const mirrorOwner = { id: 'suite-mirror-denied' };
    assert.equal(await mirrorApp._acquireSuiteRecoveryClaim('single', mirrorOwner), true);
    mirrorHarness.sessionStore.save = () => {
        const error = new Error('session storage denied');
        error.name = 'SecurityError';
        throw error;
    };
    assert.equal(mirrorApp._mirrorSuiteRecoverySnapshot({ id: 'suite-mirror-denied' }, mirrorOwner), false);
    assert.equal(
        mirrorHarness.messages.filter((entry) => entry.type === 'warning' && entry.text.includes('临时恢复存储')).length,
        1,
        'sessionStorage 拒绝必须产生可见降级提示'
    );
    assert.equal(mirrorApp._mirrorSuiteRecoverySnapshot({ id: 'suite-mirror-denied' }, mirrorOwner), false);
    assert.equal(
        mirrorHarness.messages.filter((entry) => entry.type === 'warning' && entry.text.includes('临时恢复存储')).length,
        1,
        '连续镜像失败提示必须节流'
    );

    process.stdout.write(JSON.stringify({ status: 'pass', detail: 'v2 suite recovery state machine passed' }));
}

main().catch((error) => {
    process.stdout.write(JSON.stringify({ status: 'fail', detail: error.stack || String(error) }));
    process.exit(1);
});
