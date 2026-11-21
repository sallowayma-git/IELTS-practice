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

async function harness() {
    const initial = ['first', 'second', 'third'].map((id) => ({ id, title: id }));
    let local = clone(initial);
    let remote = clone(initial);
    let binding = { userId: 'test-user', enabled: true, baseline: clone(initial) };
    let localRevision = 0;
    let remoteRevision = 0;
    let syncReads = 0;
    let heldRead;
    let heldApply;
    const document = {
        readyState: 'loading',
        querySelector: () => ({}),
        getElementById: () => null,
        addEventListener() {},
        dispatchEvent() {}
    };
    const app = {
        cloudSync: {
            normalize: clone,
            async capture() { return { records: clone(local), state: clone(binding), token: localRevision }; },
            async apply(captured, records, nextState) {
                if (captured.token !== localRevision) throw Object.assign(new Error('Local records changed'), { code: 'CONFLICT' });
                local = clone(records);
                binding = clone(nextState);
                localRevision += 1;
                const gate = heldApply;
                heldApply = null;
                if (gate) { gate.started.resolve(); await gate.release.promise; }
            }
        }
    };
    const window = { document, AppData: app };
    const context = {
        window, document,
        AbortSignal: { timeout: () => undefined },
        CustomEvent: class { constructor(type) { this.type = type; } },
        async fetch(url, options) {
            let data;
            let status = 200;
            if (url === '/api/auth/me') data = { user: { id: 'test-user', username: 'test' }, csrfToken: 'test-token' };
            else if (url === '/api/auth/registration') data = { allowed: false };
            else if (url === '/api/practice-records/sync') {
                if (options.method === 'POST') {
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
                }
            } else throw new Error(`Unexpected request: ${url}`);
            return { ok: status === 200, status, json: async () => clone(data) };
        }
    };
    vm.runInNewContext(source, context);
    await window.PracticeCloud.refresh();
    assert.equal(window.PracticeCloud.status().phase, 'ready');
    return {
        cloud: window.PracticeCloud,
        initial,
        replaceLocal(records) { local = clone(records); localRevision += 1; },
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
        snapshot: () => ({ local: clone(local), remote: clone(remote), baseline: clone(binding.baseline), syncReads })
    };
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
    test(`awaiting sync after ${name} includes changes made during an older no-op sync`, { timeout: 2000 }, async () => {
        const fixture = await harness();
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
