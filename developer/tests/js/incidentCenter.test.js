import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './helpers/diagnosticHarness.js';

function fixture() {
    const h = harness();
    h.sandbox.AppDiagnostics = h.collector;
    h.collector.markReady();
    h.run('js/presentation/incident-center.js');
    // Model/contract tests; real DOM, keyboard and layout are covered in Chromium.
    h.sandbox.IncidentCenter.prototype.render = function () {};
    h.sandbox.IncidentCenter.prototype.open = function (item) { this.dialog = { item }; };
    let time = 1000;
    const center = new h.sandbox.IncidentCenter({ now: () => time });
    const report = (input = {}, presentation) => center.report({ code: 'PRACTICE_SAVE_FAILED', module: 'practice',
        action: 'submit', error: new Error('PRIVATE_ANSWER'), persistence: { operation: 'unconfirmed' }, ...input }, presentation);
    return { ...h, center, report, tick(ms) { time += ms; } };
}

test('impact policy records expected/recovered/cancelled/optional conditions without critical UI', () => {
    const h = fixture();
    h.report({}, { impact: 'expected' });
    h.report({}, { impact: 'recovered' });
    h.report({ cancelled: true });
    h.report({ code: 'RESOURCE_LOAD_FAILED', resource: { optional: true } });
    assert.equal(h.collector.snapshot().events.length, 4);
    assert.equal(h.center.groups.size, 0);
    assert.equal(h.center.dialog, null);
    const failed = h.report({ persistence: { operation: 'not-committed' } });
    assert.equal(h.center.groups.get(failed).kind, 'persistent');
    const unconfirmed = h.report();
    assert.equal(h.center.dialog.item.id, unconfirmed);
    assert.equal(h.collector.getIncident(unconfirmed).notification.kind, 'dialog');
});

test('unconfirmed draft and recovery saves escalate; committed outcomes remain explicit', () => {
    for (const [action, code] of [['save-draft', 'PRACTICE_SAVE_FAILED'], ['save-recovery', 'RECOVERY_SAVE_FAILED']]) {
        const h = fixture();
        const id = h.report({ action, code });
        assert.equal(h.center.dialog.item.id, id);
        const committed = h.report({ action, code, persistence: { operation: 'committed' } });
        assert.equal(h.center.groups.get(committed).kind, 'persistent');
        assert.equal(h.center.groups.get(committed).event.persistence.operation, 'committed');
    }
});

test('same error observations share an incident reference and do not inflate repetitions', () => {
    const h = fixture();
    const error = new Error('PRIVATE_ANSWER');
    const id = h.report({ error });
    for (let i = 0; i < 50; i++) assert.equal(h.report({ error }), id);
    assert.equal(h.center.groups.size, 1);
    assert.equal(h.center.groups.get(id).count, 1);
    assert.equal(h.collector.snapshot().events.length, 1);
    assert.equal(h.center.queue.length, 0);
});

test('aggregation lasts exactly 60 seconds and preserves independent diagnostic events', () => {
    const h = fixture();
    const first = h.report();
    h.tick(59999);
    const second = h.report();
    assert.notEqual(first, second);
    assert.equal(h.center.groups.size, 1);
    assert.equal(h.center.groups.get(first).count, 2);
    assert.equal(h.center.show(second), first);
    assert.equal(h.center.groups.get(first).count, 2);
    h.tick(1);
    h.report();
    assert.equal(h.center.groups.size, 2);
    assert.equal(h.collector.snapshot().events.length, 3);
});

test('distinct operations never aggregate and UI capacity does not discard recorded incidents', () => {
    const h = fixture();
    const ids = [];
    for (let i = 0; i < 45; i++) ids.push(h.report({ correlation: { operation: 'operation-' + i } }));
    assert.equal(h.center.groups.size, 20);
    assert.equal(h.center.queue.length, 5);
    assert.equal(h.center.overflow, 25);
    assert.equal(h.center.dialog.item.id, ids[0]);
    assert.equal(h.collector.snapshot().events.length, 45);
    for (const id of ids) assert.equal(h.collector.getIncident(id).eventId, id);
    assert.ok(!h.collector.exportText().includes('operation-'));
});

test('notification identity bookkeeping remains bounded during storms', () => {
    const h = fixture();
    for (let i = 0; i < 260; i++) h.report({ correlation: { operation: 'operation-' + i } });
    assert.equal(h.center.seen.size, 200);
    assert.equal(h.center.groups.size, 20);
    assert.equal(h.center.queue.length, 5);
    const status = h.collector.status();
    assert.ok(status.events > 100 && status.events <= 200 && status.bytes <= 256 * 1024);
    assert.equal(status.events + status.dropped, 260, 'only the existing diagnostic retention policy trims history');
});

function withRetry(h, run) {
    const id = h.report({ correlation: { operation: 'original-operation', submission: 'original-submission' },
        retry: { available: true, action: 'submit' } });
    const event = h.collector.getIncident(id);
    const retry = { ...event.retry, run };
    h.center.show(id, { retry });
    return { id, event, item: h.center.groups.get(id), retry };
}

test('retry requires an operation-provided callback matching original operation, submission and action', async () => {
    const h = fixture();
    let calls = 0;
    const { id, item, retry } = withRetry(h, () => { calls++; });
    assert.equal(calls, 0);
    h.center.show(id, { retry: { ...retry, operationAlias: 'wrong-operation' } });
    await h.center.retry(item);
    assert.equal(calls, 0);
    h.center.show(id, { retry: { ...retry, submissionAlias: 'wrong-submission' } });
    assert.equal(item.retry, null);
    h.center.show(id, { retry: { ...retry, action: 'import' } });
    assert.equal(item.retry, null);
    h.center.show(id, { retry });
    await h.center.retry(item);
    assert.equal(calls, 1);
    assert.equal(item.operation, undefined, 'settled promise is not a verified save');
    assert.equal(item.dismissed, false);
});

test('retry is single flight, only verified results change displayed outcome, and capture is immutable', async () => {
    const h = fixture();
    let complete;
    let calls = 0;
    const { item, event } = withRetry(h, () => { calls++; return new Promise((resolve) => { complete = resolve; }); });
    const before = JSON.stringify(event);
    const attempt = h.center.retry(item);
    await h.center.retry(item);
    assert.equal(calls, 1);
    assert.equal(item.busy, true);
    complete({ verified: true, operation: 'committed' });
    await attempt;
    assert.equal(item.operation, 'committed');
    assert.equal(item.dismissed, false);
    assert.equal(JSON.stringify(h.collector.getIncident(event.eventId)), before);
    await h.center.retry(item);
    assert.equal(calls, 1, 'committed operations cannot be replayed');
});

test('rejected/hostile retry results stay unconfirmed, without exposing exception text', async () => {
    const h = fixture();
    const { id, item, retry } = withRetry(h, () => { throw new Error('PRIVATE_RETRY'); });
    await h.center.retry(item);
    assert.equal(item.operation, undefined);
    assert.ok(!item.actionStatus.includes('PRIVATE'));
    h.center.show(id, { retry: { ...retry, run: () => ({ get verified() { throw new Error('PRIVATE_GETTER'); } }) } });
    await h.center.retry(item);
    assert.equal(item.operation, undefined);
    assert.equal(item.busy, false);
});

test('aggregated occurrences cannot accidentally replay only one of multiple operations', async () => {
    const h = fixture();
    let calls = 0;
    const { item } = withRetry(h, () => calls++);
    h.report({ correlation: { operation: 'original-operation', submission: 'original-submission' },
        retry: { available: true, action: 'submit' } });
    assert.equal(item.count, 2);
    await h.center.retry(item);
    assert.equal(calls, 0);
});

test('structured UI revalidates malicious retained records and never reads caller accessors', () => {
    const h = fixture();
    const id = h.report();
    const event = h.collector.getIncident(id);
    h.center.show({ ...event, error: { message: '<img src=x onerror=alert(1)>PRIVATE', name: 'Error' },
        answers: 'PRIVATE_ANSWERS' });
    const shown = JSON.stringify(h.center.groups.get(id).event);
    assert.ok(!shown.includes('PRIVATE') && !shown.includes('<img'));
    assert.equal(h.center.show({ get schemaVersion() { throw new Error('getter'); } }), null);
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    assert.doesNotThrow(() => h.center.show(proxy));
});

test('report subscriptions isolate throws, reentrancy and rejections, and can unsubscribe', async () => {
    const h = fixture();
    let calls = 0;
    const unsubscribe = h.collector.subscribe((event) => {
        calls++;
        assert.ok(Object.isFrozen(event));
        h.collector.report({ code: 'UNEXPECTED_RUNTIME_ERROR' });
        throw new Error('broken UI');
    });
    h.collector.subscribe(() => Promise.reject(new Error('async UI failure')));
    h.report();
    assert.equal(calls, 1);
    assert.equal(h.collector.snapshot().events.length, 1);
    unsubscribe();
    h.report();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1);
    assert.equal(h.collector.snapshot().events.length, 2);
});

test('startup remains on the independent exportable panel when the rich UI is present', () => {
    const h = fixture();
    const id = h.report({ code: 'APP_BOOT_FAILED', action: 'initialize' });
    assert.equal(h.center.groups.size, 0);
    assert.ok(h.document.getElementById('diagnostic-startup-failure'));
    assert.equal(h.collector.getIncident(id).notification.kind, 'startup');
});

test('changing subscriptions during delivery cannot extend the current observer batch', () => {
    const h = fixture();
    let calls = 0;
    let unsubscribe;
    const observe = () => {
        calls++;
        unsubscribe();
        unsubscribe = h.collector.subscribe(observe);
    };
    unsubscribe = h.collector.subscribe(observe);
    h.report();
    assert.equal(calls, 1);
    h.report();
    assert.equal(calls, 2);
});
