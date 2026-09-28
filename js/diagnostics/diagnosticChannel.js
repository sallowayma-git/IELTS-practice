(function defineDiagnosticChannel(global) {
    'use strict';
    if (global.AppDiagnosticChannel) return;

    const TYPE = 'IELTS_DIAGNOSTIC_V1';
    const LIMITS = Object.freeze({ envelopeBytes: 72 * 1024, batchEvents: 8,
        queueEvents: 200, queueBytes: 256 * 1024, attempts: 3, retryMs: 500,
        messagesPerInterval: 64, intervalMs: 10000 });
    const KEYS = ['type', 'version', 'kind', 'sessionId', 'windowSessionToken',
        'connectionId', 'channelId', 'windowId', 'batch', 'hop', 'payload'];
    const NONCE = /^dc-[a-f0-9]{32}$/;
    const WINDOW = /^win_[a-f0-9]{32}$/;
    const GENERATION = /^dg-[a-f0-9]{32}$/;
    const contract = global.AppDiagnosticContract;
    const children = new WeakMap();

    function field(value, key) {
        try { return Object.getOwnPropertyDescriptor(value, key)?.value; } catch (_) { return undefined; }
    }
    function text(value, max = 512) { return typeof value === 'string' && value.length > 0 && value.length <= max; }
    function nonce() {
        try {
            const bytes = new Uint8Array(16);
            global.crypto.getRandomValues(bytes);
            return 'dc-' + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
        } catch (_) { return null; }
    }
    function isMessage(data) { return field(data, 'type') === TYPE; }
    function binding(input) {
        try {
            if (!input || !input.window || input.window.closed || !text(input.sessionId)
                || !text(input.windowSessionToken)) return null;
            const opaque = input.allowOpaqueOrigin === true && input.origin === 'null';
            if (!opaque && (!text(input.origin) || !/^https?:$/.test(new URL(input.origin).protocol)
                || new URL(input.origin).origin !== input.origin)) return null;
            return { window: input.window, sessionId: input.sessionId, windowSessionToken: input.windowSessionToken,
                origin: input.origin, allowOpaqueOrigin: opaque };
        } catch (_) { return null; }
    }
    function sameBinding(a, b) {
        return a && b && a.window === b.window && a.sessionId === b.sessionId
            && a.windowSessionToken === b.windowSessionToken && a.origin === b.origin
            && a.allowOpaqueOrigin === b.allowOpaqueOrigin;
    }
    function trusted(event, peer) {
        try { return peer && !peer.window.closed && event.source === peer.window
            && (peer.allowOpaqueOrigin ? event.origin === 'null' || event.origin === 'file://'
                : event.origin === peer.origin); } catch (_) { return false; }
    }
    function decode(data, peer) {
        try {
            if (!isMessage(data) || Object.getOwnPropertyNames(data).length !== KEYS.length) return null;
            const copy = {};
            for (const key of KEYS) {
                const value = field(data, key);
                if (!['string', 'number'].includes(typeof value)) return null;
                if (typeof value === 'string' && value.length > (key === 'payload' ? LIMITS.envelopeBytes : 512)) return null;
                copy[key] = value;
            }
            if (copy.version !== 1 || copy.hop !== 1 || copy.sessionId !== peer.sessionId
                || copy.windowSessionToken !== peer.windowSessionToken || !NONCE.test(copy.connectionId)
                || !WINDOW.test(copy.windowId) || (copy.channelId !== '' && !NONCE.test(copy.channelId))
                || !['hello', 'ready', 'events', 'ack'].includes(copy.kind)
                || !Number.isSafeInteger(copy.batch) || copy.batch < 0
                || contract.utf8Bytes(JSON.stringify(copy)) > LIMITS.envelopeBytes) return null;
            if (copy.kind === 'events') {
                if (!copy.batch || !copy.channelId || !copy.payload) return null;
            } else if (copy.payload !== '' || (copy.kind === 'ack' ? !copy.batch : copy.batch !== 0)) return null;
            return copy;
        } catch (_) { return null; }
    }
    function envelope(peer, state, kind, batch = 0, payload = '') {
        // Authentication lives only in this control envelope, never in an event.
        return { type: TYPE, version: 1, kind, sessionId: peer.sessionId,
            windowSessionToken: peer.windowSessionToken, connectionId: state.connectionId,
            channelId: state.channelId, windowId: state.windowId, batch, hop: 1, payload };
    }
    function post(peer, message) {
        try {
            if (peer.window.closed || contract.utf8Bytes(JSON.stringify(message)) > LIMITS.envelopeBytes) return false;
            peer.window.postMessage(message, peer.allowOpaqueOrigin ? '*' : peer.origin);
            return true;
        } catch (_) { return false; }
    }
    function lifecycle(store) {
        try {
            const state = store.status(); // Re-reads the durable barrier even if notifications were missed.
            // Fresh stores retain the completed-reset tombstone; older instances remain suspended.
            return state && state.enabled && !state.suspended && ['active', 'reset-complete'].includes(state.phase)
                && state.failure !== 'COORDINATION_UNAVAILABLE' && GENERATION.test(state.generation) ? state : null;
        } catch (_) { return null; }
    }
    function eligible(event, state) {
        return state && event.persistence.generation === state.generation && event.timestamp > state.cutoff;
    }

    function createHost(options = {}) {
        const normalizer = contract.createNormalizer();
        const reporter = options.reporter || global.AppDiagnostics;
        const store = options.store || global.AppDiagnosticStore;
        let peer = null, active = null, disposed = false;
        let interval = 0, messages = 0;
        function receive(event) {
            if (!isMessage(event?.data)) return false;
            try {
                if (disposed) return true;
                const next = binding(options.getBinding());
                if (!sameBinding(peer, next)) { peer = next; active = null; }
                if (!trusted(event, peer)) return true;
                const now = Date.now();
                if (now < interval || now - interval >= LIMITS.intervalMs) { interval = now; messages = 0; }
                if (++messages > LIMITS.messagesPerInterval) return true;
                const message = decode(event.data, peer);
                if (!message || !lifecycle(store)) return true;
                if (message.kind === 'hello' && message.channelId === '') {
                    if (!active || active.connectionId !== message.connectionId || active.windowId !== message.windowId) {
                        const channelId = nonce();
                        if (!channelId) return true;
                        active = { connectionId: message.connectionId, windowId: message.windowId,
                            channelId, hellos: 0, batch: 0, payload: '', acknowledgements: 0 };
                    }
                    if (++active.hellos <= LIMITS.attempts) post(peer, envelope(peer, active, 'ready'));
                    return true;
                }
                if (message.kind !== 'events' || !active || message.connectionId !== active.connectionId
                    || message.channelId !== active.channelId || message.windowId !== active.windowId
                    || message.batch < active.batch || message.batch > active.batch + 1) return true;
                if (message.batch === active.batch && message.payload !== active.payload) return true;
                const inputs = JSON.parse(message.payload);
                if (!Array.isArray(inputs) || !inputs.length || inputs.length > LIMITS.batchEvents) return true;
                const state = lifecycle(store);
                const events = [];
                for (const input of inputs) {
                    if (contract.utf8Bytes(JSON.stringify(input)) > contract.LIMITS.eventBytes) return true;
                    const clean = normalizer.sanitizeEvent(input);
                    if (!clean || clean.windowId !== active.windowId || clean.collection.source === 'relay'
                        || !eligible(clean, state)) return true;
                    events.push(clean);
                }
                if (message.batch !== active.batch) {
                    // Receipt means retained diagnostic evidence, never a business persistence ACK.
                    if (!events.every(item => reporter.acceptRelayed(item))) return true;
                    active.batch = message.batch;
                    active.payload = message.payload;
                    active.acknowledgements = 0;
                }
                if (++active.acknowledgements <= LIMITS.attempts) post(peer, envelope(peer, active, 'ack', message.batch));
            } catch (_) { /* Untrusted payloads and reporter failures never reach business handlers or logs. */ }
            return true;
        }
        return Object.freeze({ receive, dispose() { disposed = true; peer = null; active = null; } });
    }

    function createChild(options = {}) {
        const reporter = options.reporter || global.AppDiagnostics;
        if (children.has(reporter)) return children.get(reporter);
        const store = options.store || global.AppDiagnosticStore;
        const normalizer = contract.createNormalizer();
        const queue = new Map();
        let peer = null, state = null, pending = null, timer = null;
        let bytes = 0, dropped = 0, sequence = 0, attempts = 0;
        let connectedOnce = false, disposed = false, connection = 'waiting';
        let unsubscribe = () => {}, unsubscribeStore = () => {};

        function status() {
            let current = connection;
            try { if (peer?.window.closed) current = 'disconnected'; } catch (_) { current = 'unavailable'; }
            return Object.freeze({ connection: current, aggregation: 'incomplete', pendingEvents: queue.size,
                pendingBytes: bytes, dropped });
        }
        function cancel() { try { global.clearTimeout(timer); } catch (_) { } timer = null; }
        function stop(reason) { cancel(); pending = null; connection = reason; }
        function remove(id) {
            const item = queue.get(id);
            if (item) { bytes -= item.bytes; queue.delete(id); }
        }
        function fence() {
            const current = lifecycle(store);
            for (const [id, item] of queue) {
                if (!eligible(item.event, current)) { remove(id); dropped += 1; }
            }
            // Capacity eviction does not invalidate the immutable in-flight batch.
            if (pending && pending.items.some(item => !eligible(item.event, current))) {
                stop('incomplete'); // Old acknowledgements cannot settle a later generation.
            }
            return current;
        }
        function later(action) {
            cancel();
            try { timer = global.setTimeout(() => { timer = null; action(); }, LIMITS.retryMs); }
            catch (_) { stop('unavailable'); }
        }
        function hello() {
            if (disposed || !peer || !state) return;
            if (++attempts > LIMITS.attempts) { stop('disconnected'); return; }
            if (!post(peer, envelope(peer, state, 'hello'))) { stop('unavailable'); return; }
            // Install before postMessage delivery (which is asynchronous in browsers).
            later(hello);
        }
        function send() {
            if (disposed || !fence() || connection !== 'connected') return;
            if (!pending) {
                const items = [];
                let payload = '[]';
                for (const item of Array.from(queue.values()).slice(0, LIMITS.batchEvents)) {
                    const next = '[' + [...items, item].map(entry => entry.json).join(',') + ']';
                    if (contract.utf8Bytes(JSON.stringify(envelope(peer, state, 'events', sequence + 1, next))) > LIMITS.envelopeBytes) break;
                    items.push(item); payload = next;
                }
                if (!items.length) return;
                pending = { items, batch: ++sequence, payload, attempts: 0 };
            }
            if (++pending.attempts > LIMITS.attempts) { stop('disconnected'); return; }
            if (!post(peer, envelope(peer, state, 'events', pending.batch, pending.payload))) { stop('unavailable'); return; }
            later(send);
        }
        function capture(input) {
            try {
                if (disposed) return;
                const event = normalizer.sanitizeEvent(input);
                if (!event || event.windowId !== reporter.windowId || event.collection.source === 'relay') return;
                const json = JSON.stringify(event), size = contract.utf8Bytes(json);
                const existing = queue.get(event.eventId);
                if (existing?.json === json) return;
                remove(event.eventId);
                queue.set(event.eventId, { event, json, bytes: size });
                bytes += size;
                while (queue.size > LIMITS.queueEvents || bytes > LIMITS.queueBytes) {
                    remove(queue.keys().next().value); dropped += 1;
                }
                if (connection === 'connected' && !timer && !pending) later(send);
            } catch (_) { }
        }
        function receive(event) {
            if (!isMessage(event?.data)) return false;
            try {
                if (disposed || !trusted(event, peer) || !state) return true;
                const message = decode(event.data, peer);
                if (!message || message.connectionId !== state.connectionId || message.windowId !== state.windowId) return true;
                if (message.kind === 'ready' && connection === 'waiting' && NONCE.test(message.channelId)) {
                    cancel(); state.channelId = message.channelId; connection = 'connected'; later(send);
                } else if (message.kind === 'ack' && connection === 'connected' && pending
                    && message.channelId === state.channelId && message.batch === pending.batch) {
                    fence();
                    if (!pending) return true;
                    for (const item of pending.items) {
                        if (queue.get(item.event.eventId) === item) remove(item.event.eventId);
                    }
                    pending = null; cancel();
                    if (queue.size) later(send);
                }
            } catch (_) { }
            return true;
        }
        function connect(input) {
            try {
                if (disposed) return false;
                const next = binding(input);
                if (!next) { stop('unavailable'); return false; }
                if (sameBinding(peer, next)) return true; // Repeated INIT cannot restart exhausted retries.
                cancel(); pending = null;
                if (connectedOnce) { dropped += queue.size; queue.clear(); bytes = 0; }
                connectedOnce = true; peer = next; attempts = 0; sequence = 0;
                const connectionId = nonce();
                if (!connectionId || !WINDOW.test(reporter.windowId)) { stop('unavailable'); return false; }
                state = { connectionId, channelId: '', windowId: reporter.windowId };
                connection = 'waiting'; fence(); hello();
                return true;
            } catch (_) { stop('unavailable'); return false; }
        }
        function dispose() {
            if (disposed) return;
            disposed = true; stop('disconnected'); peer = null; state = null; queue.clear(); bytes = 0;
            children.delete(reporter);
            try { unsubscribe(); unsubscribeStore(); } catch (_) { }
            try { global.removeEventListener('message', receive); global.removeEventListener('pagehide', dispose); } catch (_) { }
        }
        const api = Object.freeze({ connect, receive, status, dispose });
        try {
            children.set(reporter, api);
            reporter.attachTransport(api);
            unsubscribe = reporter.subscribe(capture);
            // The reporter has already sanitized and retained these before transport observes them.
            reporter.snapshot().events.forEach(capture);
            unsubscribeStore = store?.subscribe?.(fence) || (() => {});
            global.addEventListener('message', receive);
            global.addEventListener('pagehide', dispose);
        } catch (_) { stop('unavailable'); }
        return api;
    }
    global.AppDiagnosticChannel = Object.freeze({ TYPE, LIMITS, isMessage, createHost, createChild });
})(typeof globalThis !== 'undefined' ? globalThis : this);
