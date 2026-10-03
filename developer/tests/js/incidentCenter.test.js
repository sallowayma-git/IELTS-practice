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
    h.sandbox.IncidentCenter.prototype.removeDialog = function () { this.dialog = null; };
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

for (const change of ['unavailable', 'action', 'operation', 'submission', 'committed']) {
    test(`enrichment invalidates a retry when its ${change} metadata changes`, async () => {
        const h = fixture();
        const error = new Error('generic failure');
        const correlation = { operation: 'original-operation', submission: 'original-submission' };
        let calls = 0;
        const id = h.report({ code: 'UNEXPECTED_RUNTIME_ERROR', error, correlation,
            retry: { available: true, action: 'submit' } });
        h.center.show(id, { retry: { ...h.collector.getIncident(id).retry, run: () => calls++ } });
        const item = h.center.groups.get(id);
        assert.ok(item.retry);
        h.report({ error,
            correlation: { ...correlation, ...(change === 'operation' || change === 'submission' ? { [change]: 'other' } : {}) },
            retry: { available: change !== 'unavailable', action: change === 'action' ? 'save-draft' : 'submit' },
            persistence: { operation: change === 'committed' ? 'committed' : 'unconfirmed' } });
        assert.equal(h.collector.getIncident(id).code, 'PRACTICE_SAVE_FAILED');
        assert.equal(item.retry, null);
        await h.center.retry(item);
        assert.equal(calls, 0);
    });
}

test('retry execution rechecks the current report even when observation delivery was missed', async () => {
    const h = fixture();
    const error = new Error('generic failure');
    const correlation = { operation: 'original-operation', submission: 'original-submission' };
    let calls = 0;
    const id = h.report({ code: 'UNEXPECTED_RUNTIME_ERROR', error, correlation,
        retry: { available: true, action: 'submit' } });
    h.center.show(id, { retry: { ...h.collector.getIncident(id).retry, run: () => calls++ } });
    h.center.unsubscribe();
    h.collector.report({ code: 'PRACTICE_SAVE_FAILED', module: 'practice', action: 'submit', error, correlation,
        retry: { available: false }, notification: { kind: 'dialog' } });
    await h.center.retry(h.center.groups.get(id));
    assert.equal(calls, 0);
});

for (const enrichedIndex of [0, 1]) {
    test(`enriching aggregate member ${enrichedIndex + 1} preserves each incident's reference and classification`, () => {
        const h = fixture();
        const errors = [new Error('generic failure'), new Error('generic failure')];
        const ids = errors.map((error) => h.report({ code: 'UNEXPECTED_RUNTIME_ERROR', action: 'unknown', error }));
        assert.equal(h.center.groups.size, 1);
        assert.equal(h.center.groups.get(ids[0]).count, 2);
        h.report({ error: errors[enrichedIndex], correlation: { operation: 'enriched-operation' } });
        const enriched = ids[enrichedIndex];
        const other = ids[1 - enrichedIndex];
        assert.equal(h.center.groups.size, 2);
        assert.equal(h.center.dialog.item.id, enriched);
        assert.equal(h.center.dialog.item.event.code, 'PRACTICE_SAVE_FAILED');
        assert.equal(h.center.dialog.item.event.action, 'submit');
        assert.equal(h.center.groups.get(other).event.code, 'UNEXPECTED_RUNTIME_ERROR');
        assert.equal(h.center.groups.get(other).count, 1);
        assert.equal(h.center.groups.get(enriched).count, 1);
        assert.equal(h.center.show(other), other);
        assert.equal(h.center.show(enriched), enriched);
        h.report({ code: 'UNEXPECTED_RUNTIME_ERROR', action: 'unknown' });
        assert.equal(h.center.groups.get(other).count, 2);
        assert.equal(h.collector.snapshot().events.length, 3);
    });
}

test('a transient observation can escalate without being treated as a user dismissal', () => {
    const h = fixture();
    const error = new Error('generic failure');
    let notices = 0;
    h.center.transient = () => notices++;
    const id = h.collector.report({ error, notification: { kind: 'transient' } });
    h.center.show(id);
    assert.equal(notices, 1);
    assert.equal(h.center.dialog, null);
    h.report({ error });
    assert.equal(h.center.dialog?.item.id, id);
    assert.equal(h.center.dialog.item.dismissed, false);
    h.center.close();
    h.center.show(id);
    assert.equal(h.center.dialog, null, 'explicit dismissal still suppresses repeated presentation');
    assert.equal(h.center.groups.get(id).dismissed, true);
    assert.equal(h.collector.getIncident(id).persistence.operation, 'unconfirmed');
});

test('an explicitly dismissed notification remains dismissed after identity-preserving enrichment', () => {
    const h = fixture();
    const error = new Error('generic failure');
    const id = h.report({ code: 'UNEXPECTED_RUNTIME_ERROR', action: 'unknown', error });
    h.center.open(h.center.groups.get(id));
    h.center.close();
    h.report({ error });
    assert.equal(h.center.dialog, null);
    assert.equal(h.center.groups.get(id).dismissed, true);
});

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

for (const transition of ['revoked', 'aggregated']) {
    test(`an in-flight retry cannot confirm an incident after its binding is ${transition}`, async () => {
        const h = fixture();
        const error = new Error('generic failure');
        const correlation = { operation: 'original-operation', submission: 'original-submission' };
        const id = h.report({ code: 'UNEXPECTED_RUNTIME_ERROR', error, correlation,
            retry: { available: true, action: 'submit' } });
        let complete;
        h.center.show(id, { retry: { ...h.collector.getIncident(id).retry,
            run: () => new Promise((resolve) => { complete = resolve; }) } });
        const item = h.center.groups.get(id);
        const attempt = h.center.retry(item);
        if (transition === 'revoked') h.report({ error, correlation, retry: { available: false } });
        else h.report({ code: 'UNEXPECTED_RUNTIME_ERROR', correlation, retry: { available: true, action: 'submit' } });
        complete({ verified: true, operation: 'committed' });
        await attempt;
        assert.equal(item.operation, undefined);
        assert.equal(item.busy, false);
        assert.equal(item.actionStatus, '');
    });
}

for (const enrichedIndex of [0, 1]) {
    for (const settlement of ['fulfilled', 'rejected']) {
        test(`pending retry stays single flight when aggregate member ${enrichedIndex + 1} splits before it is ${settlement}`, async () => {
            const h = fixture();
            const errors = [new Error('generic failure'), new Error('generic failure')];
            const correlation = { operation: 'original-operation', submission: 'original-submission' };
            const input = { code: 'UNEXPECTED_RUNTIME_ERROR', correlation, retry: { available: true, action: 'submit' } };
            const first = h.report({ ...input, error: errors[0] });
            let calls = 0;
            let settle;
            const run = () => {
                calls++;
                return calls === 1 ? new Promise((resolve, reject) => {
                    settle = () => settlement === 'fulfilled' ? resolve({ verified: true, operation: 'committed' })
                        : reject(new Error('PRIVATE_RETRY'));
                }) : { verified: true, operation: 'committed' };
            };
            h.center.show(first, { retry: { ...h.collector.getIncident(first).retry, run } });
            const attempt = h.center.retry(h.center.groups.get(first));
            const second = h.report({ ...input, error: errors[1] });
            assert.equal(h.center.groups.get(first).count, 2);
            h.report({ ...input, code: 'PRACTICE_SAVE_FAILED', error: errors[enrichedIndex] });
            const original = h.center.groups.get(first);
            const other = h.center.groups.get(second);
            // A new callback wrapper must not bypass the original operation's lock.
            for (const id of [first, second]) {
                h.center.show(id, { retry: { ...h.collector.getIncident(id).retry, run: () => run() } });
                await h.center.retry(h.center.groups.get(id));
            }
            assert.equal(calls, 1, 'splitting and rebinding cannot invoke a second concurrent attempt');
            assert.equal(original.busy, true);
            assert.equal(other.busy, true, 'the same operation remains busy under another incident reference');
            settle();
            await attempt;
            assert.equal(original.busy, false);
            assert.equal(other.busy, false);
            assert.equal(original.operation, undefined, 'a replaced binding cannot adopt the old result');
            assert.equal(other.operation, undefined, 'settlement cannot confirm the surviving observation');
            assert.equal(original.actionStatus, '');
            assert.equal(other.actionStatus, '');
            await h.center.retry(original);
            assert.equal(calls, 2, 'the lock is released after either settlement path');
            assert.equal(original.operation, 'committed');
        });
    }
}

test('pending retry capacity remains bounded when dismissed notification groups are evicted', async () => {
    const h = fixture();
    let calls = 0;
    const completions = [];
    const attempts = [];
    let last;
    for (let i = 0; i < 25; i++) {
        const id = h.report({ correlation: { operation: 'operation-' + i }, retry: { available: true, action: 'submit' } });
        h.center.show(id, { retry: { ...h.collector.getIncident(id).retry, run: () => {
            calls++;
            return new Promise((resolve) => completions.push(resolve));
        } } });
        last = h.center.groups.get(id);
        attempts.push(h.center.retry(last));
        h.center.close();
    }
    assert.equal(calls, 20, 'UI eviction cannot create unbounded pending callbacks');
    completions.forEach((resolve) => resolve({ verified: true, operation: 'unconfirmed' }));
    await Promise.all(attempts);
    assert.equal(last.busy, false);
    const next = h.center.retry(last);
    assert.equal(calls, 21, 'settlement frees capacity for the next user action');
    completions.at(-1)({ verified: true, operation: 'committed' });
    await next;
    assert.equal(last.operation, 'committed');
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

function controlledScheduler(h) {
    const frames = new Map();
    const timers = new Map();
    let id = 0;
    h.sandbox.requestAnimationFrame = callback => { frames.set(++id, callback); return id; };
    h.sandbox.cancelAnimationFrame = token => frames.delete(token);
    h.sandbox.setTimeout = callback => { timers.set(++id, callback); return id; };
    h.sandbox.clearTimeout = token => timers.delete(token);
    const flush = callbacks => {
        const pending = Array.from(callbacks.values());
        callbacks.clear();
        pending.forEach(callback => callback());
    };
    return { frames, timers, frame: () => flush(frames), timer: () => flush(timers) };
}

test('ordinary notice bursts update incident state synchronously and render once per frame', () => {
    const h = fixture();
    const scheduler = controlledScheduler(h);
    let renders = 0;
    h.center.render = () => renders++;
    const ids = Array.from({ length: 30 }, (_, i) => h.report({ persistence: { operation: 'not-committed' },
        correlation: { operation: 'burst-' + i } }));
    assert.equal(h.collector.snapshot().events.length, 30);
    ids.forEach(id => assert.equal(h.collector.getIncident(id).eventId, id));
    assert.equal(h.center.groups.size, 20);
    assert.equal(h.center.overflow, 10);
    assert.equal(renders, 0);
    assert.equal(scheduler.frames.size, 1);
    assert.equal(scheduler.timers.size, 1);
    scheduler.frame();
    assert.equal(renders, 1);
    assert.equal(scheduler.timers.size, 0);
    h.report({ persistence: { operation: 'not-committed' } });
    scheduler.frame();
    assert.equal(renders, 2);
});

test('dialog escalation and retry revocation stay immediate while notices await a frame', () => {
    const h = fixture();
    const scheduler = controlledScheduler(h);
    let refreshes = 0;
    h.center.refreshDialog = () => refreshes++;
    const error = new Error('generic failure');
    const id = h.report({ error, code: 'UNEXPECTED_RUNTIME_ERROR', retry: { available: true, action: 'submit' },
        correlation: { operation: 'retry-operation' } });
    assert.equal(h.center.dialog.item.id, id);
    h.center.show(id, { retry: { ...h.collector.getIncident(id).retry, run() {} } });
    assert.ok(h.center.groups.get(id).retry);
    h.report({ error, retry: { available: false }, correlation: { operation: 'retry-operation' } });
    assert.equal(h.center.groups.get(id).retry, null);
    assert.ok(refreshes > 0);
    assert.equal(scheduler.frames.size, 1);
    scheduler.frame();
});

test('paused animation frames use the timer and cannot cause a second render', () => {
    const h = fixture();
    const scheduler = controlledScheduler(h);
    let renders = 0;
    h.center.render = () => renders++;
    h.report({ persistence: { operation: 'not-committed' } });
    const staleFrame = scheduler.frames.values().next().value;
    scheduler.timer();
    assert.equal(renders, 1);
    assert.equal(scheduler.frames.size, 0);
    staleFrame();
    assert.equal(renders, 1);
});

test('batched rendering failure keeps an open save warning as the fallback reference', () => {
    const h = fixture();
    const scheduler = controlledScheduler(h);
    const critical = h.report();
    const later = h.report({ persistence: { operation: 'not-committed' }, correlation: { operation: 'later-notice' } });
    assert.notEqual(later, critical);
    let fallback;
    h.center.render = () => { throw new Error('UI unavailable'); };
    h.center.fallback = event => { fallback = event; };
    scheduler.frame();
    assert.equal(fallback.eventId, critical);
    assert.equal(fallback.persistence.operation, 'unconfirmed');
    assert.equal(h.collector.snapshot().events.length, 2);
});

test('dialog technical text reuses immutable event identity and refreshes persistence revisions', () => {
    const h = fixture();
    controlledScheduler(h);
    const id = h.report();
    const item = h.center.groups.get(id);
    const dialog = h.center.dialog;
    Object.assign(dialog, { heading: h.element('h2'), panel: h.element('section'),
        technical: h.element('pre'), outcome: h.element('p'), reference: h.element('p'),
        retryButton: h.element('button'), status: h.element('p') });
    let prettySerializations = 0;
    h.sandbox.JSON = { ...JSON, stringify(value, replacer, spacing) {
        if (spacing === 2) prettySerializations++;
        return JSON.stringify(value, replacer, spacing);
    } };
    h.center.refreshDialog();
    for (let index = 0; index < 10; index++) h.center.refreshDialog();
    assert.equal(prettySerializations, 1);
    assert.equal(JSON.parse(dialog.technical.textContent).persistence.diagnostics, 'memory-only');
    const revision = h.sandbox.AppDiagnosticContract.createNormalizer().sanitizeEvent({ ...item.event,
        persistence: { ...item.event.persistence, diagnostics: 'persisted' } });
    assert.ok(Object.isFrozen(revision));
    item.event = revision;
    h.center.refreshDialog();
    assert.equal(prettySerializations, 2);
    const technical = JSON.parse(dialog.technical.textContent);
    assert.equal(technical.eventId, id);
    assert.equal(technical.persistence.diagnostics, 'persisted');
    assert.equal(technical.persistence.operation, 'unconfirmed');
    h.center.refreshDialog();
    assert.equal(prettySerializations, 2);
});
