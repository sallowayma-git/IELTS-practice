import assert from 'node:assert/strict';
import { test } from 'node:test';
import { webcrypto } from 'node:crypto';
import { harness } from './helpers/diagnosticHarness.js';

const generation = 'dg-' + '0'.repeat(32);
const clone = value => JSON.parse(JSON.stringify(value));
function makeStore(rows = new Map(), initialState = {}) {
    const listeners = new Set();
    const state = { generation, cutoff: -1, enabled: true, suspended: false, phase: 'active', failure: null,
        persistence: 'persisted', coverage: 'complete', ...initialState };
    return { state, rows, status: () => ({ ...state }),
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        barrier(changes) { Object.assign(state, changes); rows.clear(); for (const fn of listeners) fn({ type: 'barrier', status: { ...state } }); },
        async append(events) {
            for (const event of events) if (state.enabled && !state.suspended && event.persistence.generation === state.generation
                && event.timestamp > state.cutoff) rows.set(event.eventId, event);
            return { persistence: 'persisted', persistedEventIds: events.filter(e => rows.has(e.eventId)).map(e => e.eventId) };
        },
        async snapshot() { return { events: [...rows.values()], storage: { ...state }, persistence: 'persisted', coverage: 'partial' }; }
    };
}
function endpoint(store) {
    const h = harness();
    const timers = new Map();
    let clock = 0;
    h.sandbox.crypto = webcrypto;
    h.sandbox.setTimeout = fn => { const id = ++clock; timers.set(id, fn); return id; };
    h.sandbox.clearTimeout = id => timers.delete(id);
    h.sandbox.removeEventListener = (name, fn) => h.listeners.set(name, (h.listeners.get(name) || []).filter(x => x.fn !== fn));
    h.sandbox.AppDiagnostics = h.collector;
    h.sandbox.AppDiagnosticStore = store;
    h.collector.attachSink(store);
    h.collector.markReady();
    h.run('js/diagnostics/diagnosticChannel.js');
    return { ...h, timers, tick() { const first = timers.entries().next().value; if (!first) return false;
        timers.delete(first[0]); first[1](); return true; } };
}
function pair(origin = 'null', shared = false, initialState = {}) {
    const rows = new Map();
    const hs = makeStore(rows, initialState), cs = makeStore(shared ? rows : new Map(), initialState);
    const h = endpoint(hs), c = endpoint(cs), bus = [], sent = [];
    const hostWindow = { closed: false, postMessage(data, targetOrigin) { bus.push({ to: 'host', data: clone(data), targetOrigin }); sent.push(bus.at(-1)); } };
    const childWindow = { closed: false, postMessage(data, targetOrigin) { bus.push({ to: 'child', data: clone(data), targetOrigin }); sent.push(bus.at(-1)); } };
    const auth = { sessionId: 'session-PRIVATE', windowSessionToken: 'CREDENTIAL_PRIVATE_5678',
        origin, allowOpaqueOrigin: origin === 'null' };
    let registration = { ...auth, window: childWindow };
    let host = h.sandbox.AppDiagnosticChannel.createHost({ getBinding: () => registration });
    const child = c.sandbox.AppDiagnosticChannel.createChild();
    function pump(filter = () => true) {
        for (let limit = 0; bus.length && limit < 100; limit++) {
            const item = bus.shift();
            if (!filter(item)) continue;
            if (item.to === 'host') host.receive({ data: item.data, source: childWindow, origin });
            else child.receive({ data: item.data, source: hostWindow, origin });
        }
        assert.ok(bus.length < 100);
    }
    const connect = () => { child.connect({ ...auth, window: hostWindow }); pump(); };
    const report = (input = {}) => c.collector.report({ code: 'PRACTICE_SAVE_FAILED', module: 'reading', action: 'save',
        error: new Error('CREDENTIAL_PRIVATE_5678 answer PRIVATE_ANSWER file:///private/path'),
        persistence: { operation: 'unconfirmed' }, notification: { kind: 'dialog', requiresDismissal: true }, ...input });
    return { h, c, hs, cs, sent, bus, hostWindow, childWindow, auth, child, connect, report, pump,
        get host() { return host; }, setRegistration(value) { registration = value; },
        replaceHost() { host.dispose(); host = h.sandbox.AppDiagnosticChannel.createHost({ getBinding: () => registration }); },
        deliver(data, overrides = {}) { host.receive({ data, origin, source: childWindow, ...overrides }); },
        step() { c.tick(); pump(); } };
}
function eventMessage(p) { p.report(); p.c.tick(); return p.bus.find(x => x.data.kind === 'events').data; }

for (const origin of ['null', 'http://localhost:8080', 'https://example.test']) {
    test(`trusted diagnostics retain origin identity and never trigger UI or business ACKs (${origin})`, async () => {
        const p = pair(origin, true);
        let observers = 0;
        p.h.collector.subscribe(() => observers++);
        const id = p.report(); // Captured before channel binding.
        const original = p.c.collector.getIncident(id);
        p.connect(); p.step();
        const received = p.h.collector.getIncident(id);
        assert.ok(received);
        for (const key of ['eventId', 'windowId', 'sequence', 'timestamp']) assert.equal(received[key], original[key]);
        assert.equal(received.persistence.generation, generation);
        assert.equal(received.persistence.operation, 'unconfirmed');
        assert.equal(received.notification.kind, 'none');
        assert.equal(received.retry.available, false);
        assert.equal(observers, 0);
        assert.equal(p.child.status().pendingEvents, 0);
        assert.equal(p.h.output.length, 0);
        assert.ok(p.sent.every(x => x.targetOrigin === (origin === 'null' ? '*' : origin)));
        assert.ok(p.sent.every(x => ['hello', 'ready', 'events', 'ack'].includes(x.data.kind)));
        await p.c.collector.flush(); await p.h.collector.flush();
        p.h.run('js/diagnostics/diagnosticExport.js');
        const exported = await p.h.sandbox.AppDiagnosticExport.exportJSON();
        assert.equal(exported.report.events.filter(e => e.eventId === id).length, 1);
        const outputs = exported.json + p.c.collector.exportText() + JSON.stringify([...p.hs.rows.values()]);
        for (const secret of ['CREDENTIAL_PRIVATE_5678', 'PRIVATE_ANSWER', 'file:///private/path', 'session-PRIVATE']) assert.ok(!outputs.includes(secret));
        const payload = p.sent.find(x => x.data.kind === 'events').data.payload;
        assert.ok(!payload.includes(p.auth.windowSessionToken));
    });
}

test('source, origin, token, session, version, hop, identity, malformed and oversized envelopes fail closed', () => {
    const p = pair(); p.connect(); const valid = clone(eventMessage(p)); p.bus.length = 0;
    const variants = [
        [{ ...valid, windowSessionToken: 'wrong' }], [{ ...valid, sessionId: 'old' }], [{ ...valid, version: 2 }],
        [{ ...valid, hop: 2 }], [{ ...valid, channelId: 'dc-' + 'f'.repeat(32) }],
        [{ ...valid, windowId: 'win_' + 'f'.repeat(32) }], [{ ...valid, payload: '{bad' }],
        [{ ...valid, payload: 'x'.repeat(73 * 1024) }], [{ ...valid, extra: 'PRIVATE' }],
        [valid, { source: { ...p.childWindow } }], [valid, { origin: 'https://attacker.test' }],
        [valid, { source: null }], [{ ...valid, payload: JSON.stringify(Array(9).fill(JSON.parse(valid.payload)[0])) }]
    ];
    for (const edit of [event => event.windowId = 'win_' + 'e'.repeat(32), event => event.sequence++,
        event => event.collection.source = 'relay', event => event.answers = 'a'.repeat(8192),
        event => event.persistence.generation = 'unknown', event => event.timestamp = -1]) {
        const input = JSON.parse(valid.payload); edit(input[0]); variants.push([{ ...valid, payload: JSON.stringify(input) }]);
    }
    const hostile = { ...valid };
    Object.defineProperty(hostile, 'payload', { get() { throw new Error('PRIVATE'); } });
    variants.push([hostile]);
    for (const [message, overrides] of variants) p.deliver(message, overrides);
    assert.equal(p.h.collector.snapshot().events.length, 0);
    assert.equal(p.h.output.length, 0);
    assert.equal(p.bus.length, 0, 'rejected messages do not acknowledge');
    p.deliver(valid);
    assert.equal(p.h.collector.snapshot().events.length, 1);
});

test('receiver independently sanitizes trusted messages, strips arbitrary content and executable actions', () => {
    const p = pair(); p.connect(); const message = eventMessage(p); p.bus.length = 0;
    const input = JSON.parse(message.payload)[0];
    input.answers = { q1: 'PRIVATE_ANSWER' }; input.windowSessionToken = p.auth.windowSessionToken;
    input.error.message = p.auth.windowSessionToken; input.error.stack = [{ path: 'C:/PRIVATE_PATH', line: 5 }];
    input.breadcrumbs = [{ action: p.auth.windowSessionToken, payload: 'PRIVATE_ANSWER' }];
    message.payload = JSON.stringify([input]); p.deliver(message);
    assert.equal(p.h.collector.snapshot().events.length, 1);
    const serialized = p.h.collector.exportText();
    for (const secret of ['PRIVATE_ANSWER', 'PRIVATE_PATH', p.auth.windowSessionToken]) assert.ok(!serialized.includes(secret));
});

test('relay retries and ACK replays are bounded and duplicate by origin event', async () => {
    const p = pair(); p.connect(); const id = p.report();
    for (let i = 0; i < 6; i++) { p.c.tick(); p.pump(item => item.to !== 'child'); }
    assert.equal(p.sent.filter(x => x.data.kind === 'events').length, 3);
    assert.equal(p.child.status().connection, 'disconnected');
    assert.ok(p.c.collector.getIncident(id));
    assert.equal(p.h.collector.snapshot().events.length, 1);
    const message = p.sent.find(x => x.data.kind === 'events').data;
    for (let i = 0; i < 100; i++) p.deliver(message);
    assert.equal(p.sent.filter(x => x.data.kind === 'ack').length, 3);
    await p.h.collector.flush(); assert.equal(p.hs.rows.size, 1);
    p.child.connect({ ...p.auth, window: p.hostWindow });
    assert.equal(p.c.timers.size, 0, 'repeated INIT cannot restart a failed connection');
});

test('handshake retries, acknowledgements and hostile hello churn have fixed limits', () => {
    const p = pair(); p.child.connect({ ...p.auth, window: p.hostWindow });
    for (let i = 0; i < 6; i++) p.c.tick();
    assert.equal(p.sent.filter(x => x.data.kind === 'hello').length, 3);
    assert.equal(p.child.status().connection, 'disconnected');
    const hello = p.sent[0].data;
    for (let i = 0; i < 100; i++) p.deliver({ ...hello, connectionId: 'dc-' + i.toString(16).padStart(32, '0') });
    assert.ok(p.sent.filter(x => x.data.kind === 'ready').length <= 64);
});

test('queue event and UTF-8 byte bounds survive unavailable parents and event storms', () => {
    const p = pair();
    const breadcrumbs = Array.from({ length: 50 }, () => ({ module: 'reading', action: 'save', outcome: 'failed' }));
    for (let i = 0; i < 500; i++) p.report({ breadcrumbs });
    const status = p.child.status();
    assert.ok(status.pendingEvents <= 200); assert.ok(status.pendingBytes <= 256 * 1024); assert.ok(status.dropped > 0);
    assert.ok(p.c.collector.status().bytes <= 256 * 1024);
    p.hostWindow.closed = true;
    assert.equal(p.child.connect({ ...p.auth, window: p.hostWindow }), false);
    assert.equal(p.child.status().aggregation, 'incomplete');
    assert.ok(p.c.collector.snapshot().events.length > 0);
});

for (const origin of ['null', 'http://localhost:8080', 'https://example.test']) {
    test(`fresh stores relay current-generation evidence after a completed reset (${origin})`, () => {
        const currentGeneration = 'dg-' + '3'.repeat(32);
        const p = pair(origin, false, { phase: 'reset-complete', generation: currentGeneration, cutoff: Date.now() - 1 });
        const id = p.report();
        const event = clone(p.c.collector.getIncident(id));
        assert.equal(p.h.collector.acceptRelayed({ ...event, persistence: { ...event.persistence, generation } }), false);
        assert.equal(p.h.collector.acceptRelayed({ ...event, timestamp: p.hs.state.cutoff }), false);
        p.connect(); p.step();
        assert.equal(p.child.status().connection, 'connected');
        assert.equal(p.child.status().pendingEvents, 0);
        assert.equal(p.h.collector.getIncident(id)?.persistence.generation, currentGeneration);
        assert.equal(p.h.collector.getIncident(id)?.timestamp, event.timestamp);
        assert.equal(p.hs.state.phase, 'reset-complete', 'recovery preserves the reset tombstone');
    });
}

const overflowInputs = [
    ['ordinary events', { error: null, notification: { kind: 'none' } }],
    ['large events', { breadcrumbs: Array.from({ length: 50 }, () => ({ module: 'reading', action: 'save', outcome: 'failed' })) }]
];
for (const [bound, input] of overflowInputs) {
    for (const trigger of ['ack', 'retry']) {
        test(`queue ${bound} eviction preserves an in-flight batch through ${trigger}`, () => {
            const p = pair(); p.connect();
            const id = p.report(input); p.c.tick();
            let last;
            for (let i = 0; i < 210; i++) last = p.report(input);
            const queued = p.child.status();
            assert.ok(queued.dropped > 0, 'the oldest queued event, already in flight, was evicted');
            assert.ok(queued.pendingBytes <= 256 * 1024);
            assert.ok(queued.pendingEvents < 200, 'the byte bound caused eviction before the event count limit');
            if (trigger === 'retry') p.c.tick();
            p.pump();
            assert.equal(p.child.status().connection, 'connected');
            assert.ok(p.h.collector.getIncident(id), 'the immutable in-flight batch still reaches the host');
            for (let i = 0; i < 30 && p.child.status().pendingEvents; i++) p.step();
            assert.equal(p.child.status().pendingEvents, 0);
            assert.equal(p.child.status().pendingBytes, 0);
            assert.ok(p.h.collector.getIncident(last));
            const fresh = p.report(); p.step();
            assert.ok(p.h.collector.getIncident(fresh), 'later events use the same healthy connection');
        });
    }
}

for (const changes of [{ generation: 'dg-' + '1'.repeat(32) }, { enabled: false }, { suspended: true, phase: 'reset-complete' },
    { phase: 'resetting' }, { cutoff: 8640000000000000 }, { failure: 'COORDINATION_UNAVAILABLE' }]) {
    for (const trigger of ['ack', 'retry']) {
        test(`evicted in-flight events remain fenced on ${trigger} at ${JSON.stringify(changes)}`, () => {
            const p = pair(); p.connect(); p.report(); p.c.tick();
            for (let i = 0; i < 210; i++) p.report();
            assert.ok(p.child.status().dropped > 0);
            // Miss the notification and retain newer evidence: the pending payload
            // must be checked against lifecycle state independently of the queue.
            Object.assign(p.cs.state, changes);
            p.report();
            if (trigger === 'retry') p.c.tick();
            p.pump();
            for (let i = 0; i < 5; i++) p.c.tick();
            assert.equal(p.child.status().connection, 'incomplete');
            assert.equal(p.sent.filter(x => x.data.kind === 'events').length, 1);
        });
    }
}

for (const changes of [{ generation: 'dg-' + '1'.repeat(32) }, { enabled: false }, { suspended: true, phase: 'resetting' },
    { suspended: true, phase: 'reset-complete' }, { phase: 'resetting' },
    { cutoff: 8640000000000000 }, { failure: 'COORDINATION_UNAVAILABLE' }]) {
    test(`receiver fences delayed events at lifecycle boundary ${JSON.stringify(changes)}`, () => {
        const p = pair(); p.connect(); const old = clone(eventMessage(p)); p.bus.length = 0;
        // Deliberately miss the notification: status() must still read current state.
        Object.assign(p.hs.state, changes);
        assert.equal(p.h.collector.acceptRelayed(JSON.parse(old.payload)[0]), false);
        p.deliver(old);
        assert.equal(p.h.collector.snapshot().events.length, 0);
        assert.equal(p.bus.length, 0);
        assert.ok(p.c.collector.snapshot().events.length);
    });
}

test('clear invalidates pending ACKs and sender replay while retaining current-page export', () => {
    const p = pair(); p.connect(); const id = p.report(); p.c.tick(); p.pump(x => x.to !== 'child');
    const ack = p.sent.find(x => x.data.kind === 'ack').data;
    p.cs.barrier({ generation: 'dg-' + '2'.repeat(32) });
    p.child.receive({ data: ack, source: p.hostWindow, origin: 'null' });
    for (let i = 0; i < 5; i++) p.c.tick();
    assert.equal(p.sent.filter(x => x.data.kind === 'events').length, 1);
    assert.equal(p.child.status().pendingEvents, 0);
    assert.ok(p.c.collector.getIncident(id));
    assert.equal(p.c.collector.getIncident(id).persistence.generation, generation);
});

test('new host instance rejects messages authorized by a reloaded host', () => {
    const p = pair(); p.connect(); const old = clone(eventMessage(p)); p.bus.length = 0;
    p.replaceHost(); p.deliver(old);
    assert.equal(p.h.collector.snapshot().events.length, 0);
    for (let i = 0; i < 5; i++) p.step();
    assert.equal(p.child.status().connection, 'disconnected');
    assert.ok(p.c.collector.snapshot().events.length);
});

test('session and window replacements revoke old credentials without replaying queued history', () => {
    const p = pair(); p.connect(); const old = clone(eventMessage(p)); p.bus.length = 0;
    p.setRegistration({ ...p.auth, window: p.childWindow, sessionId: 'new-session', windowSessionToken: 'new-token' });
    p.deliver(old); assert.equal(p.h.collector.snapshot().events.length, 0);
    p.child.connect({ ...p.auth, window: p.hostWindow, sessionId: 'new-session', windowSessionToken: 'new-token' });
    p.pump(); p.step();
    assert.equal(p.child.status().pendingEvents, 0);
    assert.equal(p.h.collector.snapshot().events.length, 0);
    p.report(); p.step(); assert.equal(p.h.collector.snapshot().events.length, 1);
    p.setRegistration({ ...p.auth, window: {} });
    p.deliver(old); assert.equal(p.h.collector.snapshot().events.length, 1);
});

test('a reloaded child challenges the host again and invalidates queued events from the old page', () => {
    const p = pair(); p.connect(); const old = clone(eventMessage(p)); p.bus.length = 0;
    const hello = { ...p.sent[0].data, connectionId: 'dc-' + 'e'.repeat(32), windowId: 'win_' + 'e'.repeat(32) };
    p.deliver(hello); p.deliver(old);
    assert.equal(p.h.collector.snapshot().events.length, 0);
});

test('passive export exposes parent closure, idempotent installation and one-hop isolation', async () => {
    const p = pair(); p.connect(); p.report(); p.step();
    assert.equal(p.c.sandbox.AppDiagnosticChannel.createChild(), p.child);
    assert.equal(p.c.listeners.get('message').length, 1);
    const hostChild = p.h.sandbox.AppDiagnosticChannel.createChild();
    assert.equal(hostChild.status().pendingEvents, 0, 'accepted relays cannot be forwarded by another transport');
    p.hostWindow.closed = true;
    const before = p.sent.length;
    p.c.run('js/diagnostics/diagnosticExport.js');
    const result = await p.c.sandbox.AppDiagnosticExport.exportJSON();
    assert.equal(result.report.transport.connection, 'disconnected');
    assert.equal(result.report.collection.aggregation, 'incomplete');
    assert.equal(JSON.parse(p.c.collector.exportText()).transport.connection, 'disconnected');
    assert.equal(p.sent.length, before, 'export never probes or forwards');
    p.child.dispose();
    assert.equal(p.c.listeners.get('message').length, 0);
    assert.equal(p.c.timers.size, 0);
});

test('missing crypto, denied postMessage and a failed receiver retain local evidence without recursion', () => {
    for (const failure of ['crypto', 'post', 'receiver']) {
        const p = pair();
        if (failure === 'crypto') p.c.sandbox.crypto = null;
        if (failure === 'post') p.hostWindow.postMessage = () => { throw new Error(p.auth.windowSessionToken); };
        if (failure === 'receiver') p.h.sandbox.AppDiagnostics = { acceptRelayed() { throw new Error(p.auth.windowSessionToken); } };
        if (failure === 'receiver') p.replaceHost();
        const id = p.report(); p.connect();
        for (let i = 0; i < 8; i++) p.step();
        assert.ok(p.c.collector.getIncident(id));
        assert.equal(p.h.output.length + p.c.output.length, 0);
        assert.equal(p.h.collector.snapshot().events.length, 0);
    }
});

test('host mixin reserves valid and malformed diagnostic messages before all business handlers', async () => {
    const p = pair();
    p.h.run('js/app/examSessionMixin.js');
    p.h.run('js/core/practiceCore.js');
    p.h.run('js/core/practiceRecorder.js');
    const info = { window: p.childWindow, expectedSessionId: p.auth.sessionId, windowSessionToken: p.auth.windowSessionToken,
        allowOpaqueOrigin: true, expectedOrigin: 'null', registrationId: 1, sessionGeneration: 1, suiteSessionId: 'suite-test',
        status: 'active', submittedRecordId: '', lastAck: null, pendingCompletion: { id: 'business-pending' } };
    const app = Object.assign({ examWindows: new Map([['exam', info]]) }, p.h.sandbox.ExamSystemAppMixins.examSession);
    let businessCalls = 0;
    for (const name of ['_reportExamMessageRejected', 'handlePracticeComplete', 'handlePracticeError', 'handleExamWindowClosed']) {
        app[name] = () => { businessCalls++; };
    }
    const registration = app._captureExamSessionRegistration('exam', info);
    const before = clone({ ...info, window: null });
    app.setupExamWindowCommunication(p.childWindow, 'exam', null, { expectedRegistration: registration, deferInitialHandshake: true });
    const handler = app.messageHandlers.get('exam');
    async function route() {
        while (p.bus.length) {
            const item = p.bus.shift();
            if (item.to === 'host') await handler({ data: item.data, source: p.childWindow, origin: 'null' });
            else p.child.receive({ data: item.data, source: p.hostWindow, origin: 'null' });
        }
    }
    p.child.connect({ ...p.auth, window: p.hostWindow }); await route();
    const id = p.report(); p.c.tick(); await route();
    assert.ok(p.h.collector.getIncident(id));
    for (const data of [{ type: 'IELTS_DIAGNOSTIC_V1', data: { type: 'ERROR_OCCURRED', error: 'PRIVATE' } },
        { type: 'IELTS_DIAGNOSTIC_V1', payload: 'x'.repeat(100000) }]) {
        await handler({ data, source: {}, origin: 'null' });
        assert.equal(p.h.sandbox.PracticeCore.protocol.normalizeMessage(data), null);
        assert.equal(p.h.sandbox.PracticeRecorder.prototype.normalizeIncomingMessage(data), null);
    }
    assert.equal(businessCalls, 0);
    assert.deepEqual(clone({ ...info, window: null }), before);
    assert.equal(app.examWindows.get('exam'), info);
    assert.equal(app._diagnosticChannels.size, 1);
    app._discardActiveSessionsForExam = async () => {};
    await app.cleanupExamSession('exam', { expectedRegistration: registration });
    assert.equal(app._diagnosticChannels.size, 0);
    await handler({ data: p.sent.find(x => x.data.kind === 'events').data, source: p.childWindow, origin: 'null' });
    assert.equal(businessCalls, 0, 'stale diagnostic listeners stay silent');
});

test('HTTP rejects null origins and ACKs from wrong windows, origins, channels or batches', () => {
    const p = pair('https://example.test'); p.connect();
    const message = clone(eventMessage(p)); p.bus.length = 0;
    p.deliver(message, { origin: 'null' });
    assert.equal(p.h.collector.snapshot().events.length, 0);
    p.deliver(message); const ack = clone(p.bus.pop().data);
    for (const [data, origin, source] of [[ack, 'null', p.hostWindow], [ack, p.auth.origin, {}],
        [{ ...ack, batch: ack.batch + 1 }, p.auth.origin, p.hostWindow],
        [{ ...ack, channelId: 'dc-' + 'f'.repeat(32) }, p.auth.origin, p.hostWindow],
        [{ ...ack, sessionId: 'stale' }, p.auth.origin, p.hostWindow]]) {
        p.child.receive({ data, origin, source }); assert.equal(p.child.status().pendingEvents, 1);
    }
    p.child.receive({ data: ack, origin: p.auth.origin, source: p.hostWindow });
    assert.equal(p.child.status().pendingEvents, 0);
});

test('classification enrichment during a pending batch is sent again under the original identity', () => {
    const p = pair(); p.connect(); const error = new Error('PRIVATE');
    const id = p.c.collector.report({ error, collection: { source: 'console' } });
    p.c.tick();
    p.c.collector.report({ error, code: 'PRACTICE_SAVE_FAILED', collection: { source: 'business' } });
    p.pump(); assert.equal(p.child.status().pendingEvents, 1);
    p.step();
    assert.equal(p.child.status().pendingEvents, 0);
    assert.equal(p.h.collector.snapshot().events.length, 1);
    assert.equal(p.h.collector.getIncident(id).code, 'PRACTICE_SAVE_FAILED');
});

test('business classification can enrich an already classified automatic relay without changing identity', () => {
    const p = pair(); p.connect(); const error = new Error('PRIVATE');
    const id = p.c.collector.report({ error, code: 'RESOURCE_LOAD_FAILED', collection: { source: 'resource' } });
    p.step();
    p.c.collector.report({ error, code: 'PRACTICE_SAVE_FAILED', collection: { source: 'business' } });
    p.step();
    assert.equal(p.h.collector.getIncident(id).code, 'PRACTICE_SAVE_FAILED');
    assert.equal(p.h.collector.snapshot().events.length, 1);
});

test('maximum-size event batches account for outer JSON encoding overhead', () => {
    const p = pair(); p.connect();
    for (let i = 0; i < 16; i++) p.report({ breadcrumbs: Array.from({ length: 50 }, () => ({
        module: 'reading', action: 'save', outcome: 'failed', correlation: { session: 'session-' + i } })) });
    for (let i = 0; i < 10 && p.child.status().pendingEvents; i++) p.step();
    assert.equal(p.child.status().pendingEvents, 0);
    assert.equal(p.h.collector.snapshot().events.length, 16);
    for (const item of p.sent) assert.ok(Buffer.byteLength(JSON.stringify(item.data)) <= 72 * 1024);
});
