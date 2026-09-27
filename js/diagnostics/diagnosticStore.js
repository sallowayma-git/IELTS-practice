(function defineDiagnosticStorage(global) {
    'use strict';
    if (global.AppDiagnosticStorage) return;

    const DATABASE_NAME = 'IELTSAtlasDiagnosticsV1';
    const CONTROL_KEY = 'ielts-atlas-diagnostics-control-v1';
    const LOCK_NAME = 'ielts-atlas-diagnostics-lifecycle-v1';
    const ZERO = 'dg-' + '0'.repeat(32);
    const GENERATION = /^dg-[a-f0-9]{32}$/;
    const LIMITS = Object.freeze({ ageMs: 7 * 86400000, events: 2000, bytes: 2 * 1024 * 1024,
        batchEvents: 20, pendingEvents: 200, pendingBytes: 256 * 1024 });

    function priority(event) {
        return ['startup', 'dialog', 'persistent'].includes(event.notification.kind) ? 2
            : event.code !== 'UNEXPECTED_RUNTIME_ERROR' ? 1 : 0;
    }
    function create(options = {}) {
        const contract = global.AppDiagnosticContract;
        const normalizer = contract.createNormalizer();
        const databaseName = options.databaseName || DATABASE_NAME;
        const controlKey = options.controlKey || CONTROL_KEY;
        const lockName = options.lockName || LOCK_NAME;
        const now = options.now || Date.now;
        const timeoutMs = options.timeoutMs || 2000;
        const limits = Object.fromEntries(['ageMs', 'events', 'bytes'].map((key) => [key,
            Number.isSafeInteger(options.limits?.[key]) && options.limits[key] > 0
                ? Math.min(options.limits[key], LIMITS[key]) : LIMITS[key]]));
        const listeners = new Set();
        let control = { generation: ZERO, resetGeneration: ZERO, cutoff: -1, enabled: true, phase: 'active' };
        let initialReset;
        let suspended = false;
        let closed = false;
        let failure = null;
        let pendingEvents = 0;
        let pendingBytes = 0;
        let dropped = 0;
        let channel;

        function view() {
            return Object.freeze({ persistence: !control.enabled ? 'disabled'
                : failure || suspended || closed ? 'memory-only' : pendingEvents ? 'pending' : 'persisted',
                enabled: control.enabled, generation: control.generation, cutoff: control.cutoff,
                suspended: suspended || closed, phase: control.phase, failure,
                coverage: failure || suspended || closed ? 'partial' : 'complete', pendingEvents, pendingBytes, dropped });
        }
        function emit(type) {
            for (const listener of listeners) { try { listener(Object.freeze({ type, status: view() })); } catch (_) { } }
        }
        function fail(code) {
            if (!failure) { failure = code; emit('status'); }
        }
        function failureCode(error) {
            const name = error && error.name;
            return name === 'QuotaExceededError' ? 'QUOTA_EXCEEDED'
                : name === 'SecurityError' || name === 'InvalidStateError' ? 'UNAVAILABLE'
                    : name === 'AbortError' ? 'TRANSACTION_ABORTED' : 'TRANSACTION_FAILED';
        }
        function readControl() {
            const raw = global.localStorage.getItem(controlKey);
            if (raw === null) return { generation: ZERO, resetGeneration: ZERO, cutoff: -1, enabled: true, phase: 'active' };
            const value = JSON.parse(raw);
            if (!value || !GENERATION.test(value.generation) || !GENERATION.test(value.resetGeneration)
                || !Number.isSafeInteger(value.cutoff) || value.cutoff < -1 || typeof value.enabled !== 'boolean'
                || !['active', 'resetting', 'reset-complete'].includes(value.phase)) throw new Error('Invalid diagnostic control');
            return { generation: value.generation, resetGeneration: value.resetGeneration,
                cutoff: value.cutoff, enabled: value.enabled, phase: value.phase };
        }
        function sync() {
            try {
                const next = readControl();
                if (initialReset === undefined) initialReset = next.resetGeneration;
                if (next.phase === 'resetting' || initialReset !== next.resetGeneration) suspended = true;
                const changed = next.generation !== control.generation || next.phase !== control.phase;
                control = next;
                if (changed) emit('barrier');
            } catch (_) { fail('COORDINATION_UNAVAILABLE'); }
            return control;
        }
        function capabilities() {
            sync();
            try {
                if (!global.navigator?.locks?.request || !global.localStorage) fail('COORDINATION_UNAVAILABLE');
                if (!global.indexedDB?.open) fail('UNAVAILABLE');
            } catch (_) { fail('UNAVAILABLE'); }
            return !failure && !closed;
        }
        function publish(next) {
            // All control mutations and IDB operations share one cross-window lock.
            global.localStorage.setItem(controlKey, JSON.stringify(next));
            control = next;
            try { channel?.postMessage({ type: 'control-changed' }); } catch (_) { }
            emit('barrier');
        }
        function generation() {
            const values = new Uint8Array(16);
            global.crypto.getRandomValues(values);
            return 'dg-' + Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('');
        }
        function nextControl(changes = {}) {
            return { ...control, generation: generation(), cutoff: Math.max(now(), control.cutoff), ...changes };
        }
        async function locked(callback) {
            const abort = new global.AbortController();
            const timer = global.setTimeout(() => abort.abort(), timeoutMs);
            try {
                return await global.navigator.locks.request(lockName, { mode: 'exclusive', signal: abort.signal }, async () => {
                    global.clearTimeout(timer);
                    sync();
                    return callback();
                });
            } finally { global.clearTimeout(timer); }
        }
        function open(createDatabase) {
            return new Promise((resolve, reject) => {
                let request;
                let finished = false;
                const finish = (error, db) => {
                    if (finished) { db?.close(); return; }
                    finished = true;
                    global.clearTimeout(timer);
                    if (error) reject(error); else resolve(db);
                };
                const timer = global.setTimeout(() => {
                    fail('OPEN_TIMEOUT');
                    finish(new Error('Diagnostic open timed out'));
                }, timeoutMs);
                try { request = global.indexedDB.open(databaseName, 1); }
                catch (error) { finish(error); return; }
                request.onblocked = () => { fail('OPEN_BLOCKED'); finish(new Error('Diagnostic open blocked')); };
                request.onupgradeneeded = () => {
                    // A timed-out/blocked open may resume after a reset. Never let it
                    // create a database after its lifecycle lock has been released.
                    if (finished || !createDatabase) { request.transaction.abort(); return; }
                    request.result.createObjectStore('events', { keyPath: 'eventId' });
                };
                request.onerror = () => {
                    if (!createDatabase && request.error?.name === 'AbortError') finish(null, null);
                    else finish(request.error || new Error('Diagnostic open failed'));
                };
                request.onsuccess = () => {
                    request.result.onversionchange = () => request.result.close();
                    finish(null, request.result);
                };
            });
        }
        async function transaction(mode, action, createDatabase = false) {
            const db = await open(createDatabase);
            if (!db) return [];
            try {
                return await new Promise((resolve, reject) => {
                    let tx;
                    let result;
                    let thrown;
                    const timer = global.setTimeout(() => {
                        fail('TRANSACTION_TIMEOUT');
                        try { tx.abort(); } catch (_) { }
                    }, timeoutMs);
                    try {
                        tx = db.transaction('events', mode);
                        tx.oncomplete = () => { global.clearTimeout(timer); resolve(result); };
                        tx.onabort = tx.onerror = () => { global.clearTimeout(timer); reject(thrown || tx.error || new Error('Diagnostic transaction failed')); };
                        const store = tx.objectStore('events');
                        const request = store.getAll();
                        request.onsuccess = () => {
                            try { result = action(store, request.result); }
                            catch (error) { thrown = error; tx.abort(); }
                        };
                    } catch (error) { global.clearTimeout(timer); reject(error); }
                });
            } finally { db.close(); }
        }
        function eligible(event) {
            return event && event.persistence.generation === control.generation
                && event.timestamp > control.cutoff && event.timestamp >= now() - limits.ageMs;
        }
        function retained(rows) {
            return rows.map((row) => normalizer.sanitizeEvent(row.event)).filter(eligible);
        }
        function select(events) {
            const ordered = events.sort((a, b) => priority(b) - priority(a)
                || b.timestamp - a.timestamp || b.sequence - a.sequence || a.eventId.localeCompare(b.eventId));
            const keep = new Map();
            let total = 0;
            for (const event of ordered) {
                const size = contract.utf8Bytes(JSON.stringify(event));
                if (keep.size < limits.events && total + size <= limits.bytes) {
                    keep.set(event.eventId, { eventId: event.eventId, event, bytes: size });
                    total += size;
                }
            }
            return keep;
        }
        async function prune() {
            if (!capabilities() || suspended || !control.enabled) return;
            try {
                await locked(async () => {
                    if (failure || suspended || closed || !control.enabled) return;
                    await transaction('readwrite', (store, rows) => {
                        const keep = select(retained(rows));
                        for (const row of rows) if (!keep.has(row.eventId)) store.delete(row.eventId);
                        dropped += rows.length - keep.size;
                    });
                });
            } catch (error) { fail(failureCode(error)); }
        }
        function receipt(ids = []) {
            const status = view();
            return Object.freeze({ persistence: status.persistence === 'pending' ? 'persisted' : status.persistence,
                persistedEventIds: Object.freeze(ids), status });
        }
        async function append(input) {
            capabilities();
            if (failure || suspended || closed || !control.enabled) return receipt();
            const events = [];
            // Normalize before retaining a queue reference; never buffer caller objects.
            for (let index = 0; index < Math.min(input?.length || 0, LIMITS.batchEvents); index += 1) {
                const event = normalizer.sanitizeEvent(input[index]);
                if (eligible(event)) events.push(event);
            }
            const bytes = events.reduce((sum, event) => sum + contract.utf8Bytes(JSON.stringify(event)), 0);
            if (pendingEvents + events.length > LIMITS.pendingEvents || pendingBytes + bytes > LIMITS.pendingBytes) {
                dropped += events.length;
                return Object.freeze({ persistence: 'memory-only', persistedEventIds: Object.freeze([]), status: view() });
            }
            if (!events.length) return receipt();
            pendingEvents += events.length;
            pendingBytes += bytes;
            let ids = [];
            try {
                ids = await locked(async () => {
                    if (failure || suspended || closed || !control.enabled) return [];
                    const batch = events.filter(eligible);
                    if (!batch.length) return [];
                    return transaction('readwrite', (store, rows) => {
                        const merged = new Map(retained(rows).map((event) => [event.eventId, event]));
                        for (const event of batch) {
                            const previous = merged.get(event.eventId);
                            if (!previous || priority(event) >= priority(previous)) {
                                merged.set(event.eventId, normalizer.sanitizeEvent({ ...event,
                                    persistence: { ...event.persistence, diagnostics: 'persisted' } }));
                            }
                        }
                        const keep = select(Array.from(merged.values()));
                        for (const row of rows) if (!keep.has(row.eventId)) store.delete(row.eventId);
                        for (const event of batch) if (keep.has(event.eventId)) store.put(keep.get(event.eventId));
                        dropped += merged.size - keep.size;
                        return batch.filter((event) => keep.has(event.eventId)).map((event) => event.eventId);
                    }, true);
                });
            } catch (error) { fail(failureCode(error)); }
            finally { pendingEvents -= events.length; pendingBytes -= bytes; }
            return receipt(ids);
        }
        async function snapshot(query = {}) {
            capabilities();
            let events = [];
            let truncated = false;
            if (!failure && !suspended && !closed && control.enabled) {
                try {
                    events = await locked(async () => {
                        if (failure || suspended || closed || !control.enabled) return [];
                        return transaction('readonly', (_store, rows) => retained(rows));
                    });
                } catch (error) { fail(failureCode(error)); }
            }
            events = events.filter((event) => !query.eventId || event.eventId === query.eventId)
                .sort((a, b) => a.timestamp - b.timestamp || a.sequence - b.sequence || a.eventId.localeCompare(b.eventId));
            const limit = Number.isSafeInteger(query.limit) ? Math.max(0, Math.min(LIMITS.events, query.limit)) : contract.LIMITS.snapshotEvents;
            truncated = events.length > limit;
            events = limit ? events.slice(-limit) : [];
            return Object.freeze({ schemaVersion: 1, events: Object.freeze(events), persistence: view().persistence,
                coverage: failure || suspended || closed ? 'partial' : 'complete', truncated, storage: view() });
        }
        function deleteHistory() {
            return new Promise((resolve, reject) => {
                const request = global.indexedDB.deleteDatabase(databaseName);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error || new Error('Diagnostic deletion failed'));
                request.onblocked = () => { failure = 'DELETE_BLOCKED'; emit('status'); };
            });
        }
        async function clearHistory(enabled) {
            if (!capabilities() && failure === 'COORDINATION_UNAVAILABLE') return { success: false, status: view() };
            try {
                return await locked(async () => {
                    if (suspended || closed) return { success: false, status: view() };
                    publish(nextControl({ enabled: typeof enabled === 'boolean' ? enabled : control.enabled }));
                    // Removal is an explicit action even after a failed write. The
                    // generation/preference remains in force if deletion is blocked.
                    await deleteHistory();
                    failure = null;
                    emit('status');
                    return Object.freeze({ success: true, status: view() });
                });
            } catch (error) { fail(failureCode(error)); return Object.freeze({ success: false, status: view() }); }
        }
        async function retry() {
            if (closed || suspended || !sync().enabled) return Object.freeze({ success: false, status: view() });
            failure = null;
            if (capabilities()) {
                try {
                    await locked(async () => {
                        if (!control.enabled || suspended) return;
                        // Probe a real write transaction; explicit retry has an
                        // observable outcome even when the reporter has no queue.
                        await transaction('readwrite', (store) => {
                            store.put({ eventId: '__retry_probe__' });
                            store.delete('__retry_probe__');
                        }, true);
                    });
                } catch (error) { fail(failureCode(error)); }
            }
            if (!failure && !suspended && control.enabled) emit('retry');
            return Object.freeze({ success: !failure && !suspended && control.enabled, status: view() });
        }
        async function withFullReset(callback) {
            // A reset must still work after diagnostic storage failed. It requires
            // working coordination, but never opens this database to establish it.
            if (closed || !global.navigator?.locks?.request) throw new Error('Diagnostic coordination unavailable');
            return locked(async () => {
                const next = nextControl({ enabled: true, phase: 'resetting' });
                next.resetGeneration = next.generation;
                suspended = true;
                publish(next);
                const result = await callback();
                // Keep the tombstone after localStorage.clear(), on success and on
                // partial failure. Existing/reconnecting windows stay suspended.
                publish({ ...next, phase: result?.success === true ? 'reset-complete' : 'resetting' });
                return result;
            });
        }
        const onStorage = (event) => { if (event.key === controlKey || event.key === null) sync(); };
        capabilities();
        try {
            channel = new global.BroadcastChannel(controlKey);
            channel.onmessage = () => sync(); // Notifications are hints; storage is authoritative.
        } catch (_) { }
        global.addEventListener?.('storage', onStorage);
        const ready = Promise.resolve().then(prune);
        const api = Object.freeze({ append, snapshot, retry, withFullReset, controlKey, ready,
            getIncident: async (eventId) => (await snapshot({ eventId, limit: 1 })).events[0] || null,
            clear: () => clearHistory(), setEnabled: (enabled) => clearHistory(enabled === true),
            status() { sync(); return view(); },
            subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
            close() { closed = true; channel?.close(); global.removeEventListener?.('storage', onStorage); listeners.clear(); }
        });
        return api;
    }
    global.AppDiagnosticStorage = Object.freeze({ create, DATABASE_NAME, CONTROL_KEY, LOCK_NAME, LIMITS });
    global.AppDiagnosticStore = create();
})(typeof globalThis !== 'undefined' ? globalThis : this);
