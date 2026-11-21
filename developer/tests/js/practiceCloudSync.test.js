import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../../js/services/practiceCloud.js', import.meta.url), 'utf8');
const clone = (value) => JSON.parse(JSON.stringify(value));

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

async function harness({ start = false, readLatency = 0 } = {}) {
    const initial = ['first', 'second', 'third'].map((id) => ({ id, title: id }));
    let local = clone(initial);
    let remote = clone(initial);
    let binding = { userId: 'test-user', enabled: true, baseline: clone(initial) };
    let localRevision = 0;
    let remoteRevision = 0;
    let syncReads = 0;
    let syncWrites = 0;
    let syncApplies = 0;
    let responseLatency = 0;
    let elapsed = 0;
    let pollTicks = 0;
    let poll;
    let startListener;
    let heldRead;
    let heldApply;
    let heldLockReturn;
    const panel = {
        querySelector: () => ({ addEventListener() {} }),
        querySelectorAll: () => []
    };
    function advance(milliseconds) {
        elapsed += milliseconds;
        while (poll && poll.next <= elapsed) {
            poll.next += poll.delay;
            pollTicks += 1;
            poll.callback();
        }
    }
    const document = {
        readyState: 'loading',
        hidden: false,
        querySelector: () => ({}),
        getElementById: () => start ? panel : null,
        addEventListener(type, callback) { if (type === 'DOMContentLoaded') startListener = callback; },
        dispatchEvent() {}
    };
    const app = {
        ready: Promise.resolve(),
        backups: { onDataCommitted() {} },
        cloudSync: {
            normalize: clone,
            async capture() { return { records: clone(local), state: clone(binding), token: localRevision }; },
            async apply(captured, records, nextState) {
                if (captured.token !== localRevision) throw Object.assign(new Error('Local records changed'), { code: 'CONFLICT' });
                local = clone(records);
                binding = clone(nextState);
                localRevision += 1;
                syncApplies += 1;
                const gate = heldApply;
                heldApply = null;
                if (gate) { gate.started.resolve(); await gate.release.promise; }
            }
        }
    };
    const navigator = { locks: {
        async request(_name, task) {
            const gate = heldLockReturn;
            heldLockReturn = null;
            const result = await task();
            if (gate) { gate.started.resolve(); await gate.release.promise; }
            return result;
        }
    } };
    const window = { document, navigator, AppData: app, addEventListener() {} };
    const context = {
        window, document, navigator,
        setInterval(callback, delay) { poll = { callback, delay, next: elapsed + delay }; },
        AbortSignal: { timeout: () => undefined },
        CustomEvent: class { constructor(type) { this.type = type; } },
        async fetch(url, options) {
            let data;
            let status = 200;
            if (url === '/api/auth/me') data = { user: { id: 'test-user', username: 'test' }, csrfToken: 'test-token' };
            else if (url === '/api/auth/registration') data = { allowed: false };
            else if (url === '/api/practice-records/sync') {
                if (options.method === 'POST') {
                    syncWrites += 1;
                    const submitted = JSON.parse(options.body);
                    if (submitted.revision !== remoteRevision) status = 409;
                    else { remote = clone(submitted.records); remoteRevision += 1; }
                }
                data = { userId: 'test-user', records: clone(remote), revision: remoteRevision };
                if (options.method !== 'POST') {
                    syncReads += 1;
                    const gate = heldRead;
                    heldRead = null;
                    if (gate) { gate.started.resolve(); await gate.release.promise; }
                    // Successful transport can span a real production poll callback.
                    advance(responseLatency);
                }
            } else throw new Error(`Unexpected request: ${url}`);
            return { ok: status === 200, status, json: async () => clone(data) };
        }
    };
    vm.runInNewContext(source, context);
    if (start) {
        await startListener();
        assert.equal(poll.delay, 15000);
    } else await window.PracticeCloud.refresh();
    assert.equal(window.PracticeCloud.status().phase, 'ready');
    responseLatency = readLatency;
    return {
        cloud: window.PracticeCloud,
        initial,
        replaceLocal(records) { local = clone(records); localRevision += 1; },
        replaceRemote(records) { remote = clone(records); remoteRevision += 1; },
        holdNextRead() {
            const gate = { started: deferred(), release: deferred() };
            heldRead = gate;
            return gate;
        },
        holdNextApply() {
            const gate = { started: deferred(), release: deferred() };
            heldApply = gate;
            return gate;
        },
        holdNextLockReturn() {
            const gate = { started: deferred(), release: deferred() };
            heldLockReturn = gate;
            return gate;
        },
        snapshot: () => ({ local: clone(local), remote: clone(remote), baseline: clone(binding.baseline), syncReads, syncWrites, syncApplies, elapsed, pollTicks })
    };
}

async function pendingConflict() {
    const fixture = await harness();
    const local = [{ id: 'first', title: 'Local edit' }, ...fixture.initial.slice(1)];
    const remote = [{ id: 'first', title: 'Remote edit' }, ...fixture.initial.slice(1)];
    fixture.replaceLocal(local);
    fixture.replaceRemote(remote);
    const gate = fixture.holdNextLockReturn();
    const earlier = fixture.cloud.sync();
    await gate.started.promise;
    assert.equal(fixture.cloud.status().phase, 'conflict');
    const choices = (keep) => ({ first: { keep, local: JSON.stringify(local[0]), remote: JSON.stringify(remote[0]) } });
    return { fixture, local, remote, gate, earlier, choices };
}

for (const keep of ['local', 'remote']) {
    test(`keeping the ${keep} conflict version waits for an earlier lock to finish`, { timeout: 2000 }, async () => {
        const { fixture, local, remote, gate, earlier, choices } = await pendingConflict();
        const resolving = fixture.cloud.sync(choices(keep));
        gate.release.resolve();
        await Promise.all([earlier, resolving]);

        const expected = keep === 'local' ? local : remote;
        const saved = fixture.snapshot();
        assert.equal(fixture.cloud.status().phase, 'ready');
        assert.deepEqual(saved.local, expected);
        assert.deepEqual(saved.remote, expected);
        assert.deepEqual(saved.baseline, expected);
    });
}

test('a queued conflict choice does not overwrite a newer remote edit', { timeout: 2000 }, async () => {
    const { fixture, local, remote, gate, earlier, choices } = await pendingConflict();
    const resolving = fixture.cloud.sync(choices('local'));
    const newerRemote = [{ ...remote[0], title: 'Newer remote edit' }, ...remote.slice(1)];
    fixture.replaceRemote(newerRemote);
    gate.release.resolve();
    await Promise.all([earlier, resolving]);

    const saved = fixture.snapshot();
    assert.equal(fixture.cloud.status().phase, 'conflict');
    assert.deepEqual(saved.local, local);
    assert.deepEqual(saved.remote, newerRemote);
    assert.deepEqual(saved.baseline, fixture.initial);
    assert.equal(saved.syncWrites, 0);
});

test('refreshing the account cancels a queued conflict choice', { timeout: 2000 }, async () => {
    const { fixture, local, remote, gate, earlier, choices } = await pendingConflict();
    const resolving = fixture.cloud.sync(choices('local'));
    const refreshing = fixture.cloud.refresh();
    gate.release.resolve();
    await Promise.all([earlier, resolving, refreshing]);

    const saved = fixture.snapshot();
    assert.deepEqual(saved.local, local);
    assert.deepEqual(saved.remote, remote);
    assert.deepEqual(saved.baseline, fixture.initial);
    assert.equal(saved.syncWrites, 0);
});

for (const direction of ['upload', 'download']) {
    test(`periodic refreshes allow ${direction} when every successful read takes 16 seconds`, { timeout: 2000 }, async () => {
        const fixture = await harness({ start: true, readLatency: 16000 });
        const expected = [...fixture.initial, { id: 'new', title: 'New practice' }].sort((left, right) => left.id.localeCompare(right.id));
        if (direction === 'upload') fixture.replaceLocal(expected);
        else fixture.replaceRemote(expected);
        const before = fixture.snapshot();

        await fixture.cloud.sync();

        const saved = fixture.snapshot();
        assert.equal(fixture.cloud.status().phase, 'ready');
        assert.deepEqual(saved.remote, expected);
        assert.deepEqual(saved.local, saved.remote);
        assert.deepEqual(saved.baseline, saved.remote);
        assert.equal(saved.syncReads - before.syncReads, 1, 'the successful response is consumed without retrying');
        assert.equal(saved.syncWrites - before.syncWrites, direction === 'upload' ? 1 : 0);
        assert.equal(saved.syncApplies - before.syncApplies, 1);
        assert.equal(saved.elapsed - before.elapsed, 16000);
        assert.equal(saved.pollTicks - before.pollTicks, 1, 'the production interval fires while the response is pending');
    });
}

test('a sync requested after the active pass commits also waits for the newer clear', { timeout: 2000 }, async () => {
    const fixture = await harness();
    fixture.replaceLocal([...fixture.initial, { id: 'new', title: 'New practice' }]);
    const gate = fixture.holdNextApply();
    const earlier = fixture.cloud.sync();
    await gate.started.promise;
    fixture.replaceLocal([]);
    const requested = fixture.cloud.sync();
    gate.release.resolve();
    await Promise.all([earlier, requested]);

    const saved = fixture.snapshot();
    assert.deepEqual(saved.remote, [], 'the server acknowledges the clear before the overlapping caller returns');
    assert.deepEqual(saved.local, []);
    assert.deepEqual(saved.baseline, []);
    assert.equal(fixture.cloud.status().phase, 'ready');
});

for (const [name, changedRecords] of [
    ['clearing records', () => []],
    ['deleting a record', (records) => records.slice(1)],
    ['saving a record', (records) => [...records, { id: 'new', title: 'New practice' }]]
]) {
    for (const readLatency of [0, 16000]) {
        test(`awaiting sync after ${name} includes changes made during an older no-op sync (${readLatency}ms reads)`, { timeout: 2000 }, async () => {
            const fixture = await harness({ start: readLatency > 0, readLatency });
            const readsBefore = fixture.snapshot().syncReads;
            const gate = fixture.holdNextRead();
            const earlier = fixture.cloud.sync();
            await gate.started.promise;
            const expected = changedRecords(fixture.initial);
            fixture.replaceLocal(expected);
            const requested = Array.from({ length: 3 }, () => fixture.cloud.sync());
            gate.release.resolve();
            await Promise.all([earlier, ...requested]);

            const saved = fixture.snapshot();
            const byId = (records) => records.slice().sort((left, right) => left.id.localeCompare(right.id));
            assert.deepEqual(byId(saved.remote), byId(expected), 'the server contains the requested local changes before sync resolves');
            assert.deepEqual(byId(saved.local), byId(expected), 'the older response cannot restore removed records or erase a new save');
            assert.deepEqual(byId(saved.baseline), byId(expected), 'the saved baseline acknowledges the same records');
            assert.equal(saved.syncReads - readsBefore, 2, 'concurrent requests share one fresh follow-up pass');
            assert.equal(fixture.cloud.status().phase, 'ready');
        });
    }
}
