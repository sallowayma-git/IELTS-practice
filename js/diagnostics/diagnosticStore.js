(function defineDiagnosticStorage(global) {
    'use strict';
    if (global.AppDiagnosticStorage) return;

    const DATABASE_NAME = 'IELTSAtlasDiagnosticsV1';
    const CONTROL_KEY = 'ielts-atlas-diagnostics-control-v1';
    const LOCK_NAME = 'ielts-atlas-diagnostics-lifecycle-v1';
    const INDEX_KEY = '__diagnostic_retention_revision__';
    const ZERO = 'dg-' + '0'.repeat(32);
    const GENERATION = /^dg-[a-f0-9]{32}$/;
    const DETAILED_MODE_MS = 15 * 60 * 1000;
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
        const defaults = { generation: ZERO, resetGeneration: ZERO, cutoff: -1, enabled: true, phase: 'active',
            detailedStartedAt: 0, detailedUntil: 0 };
        let control = { ...defaults };
        let initialReset;
        let suspended = false;
        let closed = false;
        let failure = null;
        let coordinationReady = false;
        let coordinationFailed = false;
        let pendingEvents = 0;
        let pendingBytes = 0;
        let dropped = 0;
        let channel;
        let expiredDetailedUntil = 0;
        // The reserved control record's write token fences caches across windows.
        // Only a committed transaction can publish a new local retention index.
        let historyToken = null;
        let retentionIndex = null;

        function detailedMode() {
            const timestamp = now();
            if (timestamp >= control.detailedUntil) expiredDetailedUntil = Math.max(expiredDetailedUntil, control.detailedUntil);
            const coordinated = !coordinationFailed && !closed && !suspended;
            const active = coordinated && control.detailedUntil > expiredDetailedUntil
                && timestamp >= control.detailedStartedAt && timestamp < control.detailedUntil;
            return Object.freeze({ active, expiresAt: control.detailedUntil,
                remainingMs: active ? Math.min(DETAILED_MODE_MS, control.detailedUntil - timestamp) : 0,
                coordination: coordinated ? 'supported-windows' : 'unavailable' });
        }

        function view() {
            return Object.freeze({ persistence: !control.enabled ? 'disabled'
                : failure || !coordinationReady || suspended || closed ? 'memory-only' : pendingEvents ? 'pending' : 'persisted',
                enabled: control.enabled, generation: control.generation, cutoff: control.cutoff,
                suspended: suspended || closed, phase: control.phase, failure,
                coverage: failure || !coordinationReady || suspended || closed ? 'partial' : 'complete', pendingEvents, pendingBytes, dropped,
                detailedMode: detailedMode() });
        }
        function emit(type) {
            for (const listener of listeners) { try { listener(Object.freeze({ type, status: view() })); } catch (_) { } }
        }
        function fail(code) {
            // Coordination can fail after an unrelated IDB failure has latched.
            // Do not let that earlier failure hide an unsafe/stale mode lease.
            if (code === 'COORDINATION_UNAVAILABLE') { coordinationFailed = true; coordinationReady = false; }
            retentionIndex = null;
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
            if (raw === null) { historyToken = null; return { ...defaults }; }
            const value = JSON.parse(raw);
            if (!value || !GENERATION.test(value.generation) || !GENERATION.test(value.resetGeneration)
                || !Number.isSafeInteger(value.cutoff) || value.cutoff < -1 || typeof value.enabled !== 'boolean'
                || !['active', 'resetting', 'reset-complete'].includes(value.phase)) throw new Error('Invalid diagnostic control');
            // Old control records have no mode fields. Reject invalid/overlong leases
            // without invalidating the existing persistence/reset fence.
            const validMode = Number.isSafeInteger(value.detailedStartedAt) && value.detailedStartedAt > 0
                && Number.isSafeInteger(value.detailedUntil) && value.detailedUntil > value.detailedStartedAt
                && value.detailedUntil - value.detailedStartedAt <= DETAILED_MODE_MS;
            historyToken = raw;
            return { generation: value.generation, resetGeneration: value.resetGeneration,
                cutoff: value.cutoff, enabled: value.enabled, phase: value.phase,
                detailedStartedAt: validMode ? value.detailedStartedAt : 0, detailedUntil: validMode ? value.detailedUntil : 0 };
        }
        function sync() {
            try {
                const next = readControl();
                if (initialReset === undefined) initialReset = next.resetGeneration;
                if (next.phase === 'resetting' || initialReset !== next.resetGeneration) suspended = true;
                const changed = next.generation !== control.generation || next.phase !== control.phase;
                const modeChanged = next.detailedUntil !== control.detailedUntil || next.detailedStartedAt !== control.detailedStartedAt;
                control = next;
                if (changed) { retentionIndex = null; emit('barrier'); }
                else if (modeChanged) emit('status');
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
        function writeControl(next) {
            try {
                // A fresh token makes even an unchanged control record a real write.
                // Reserve room for longer cutoff/phase values before storage fills.
                const serialized = JSON.stringify({ ...next, writeToken: generation() }).padEnd(384, ' ');
                global.localStorage.setItem(controlKey, serialized);
                if (global.localStorage.getItem(controlKey) !== serialized) throw new Error('Diagnostic control write failed');
                historyToken = serialized;
                coordinationReady = true;
            } catch (error) {
                coordinationReady = false;
                fail('COORDINATION_UNAVAILABLE');
                throw error;
            }
        }
        function publish(next) {
            // All control mutations and IDB operations share one cross-window lock.
            writeControl(next);
            control = next;
            retentionIndex = null;
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
        async function transaction(mode, action, createDatabase = false, read = 'all') {
            // Every caller holds the lifecycle lock and has synchronized control.
            if (!coordinationReady) writeControl(control);
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
                        const guard = (callback) => {
                            try { return callback(); }
                            catch (error) { thrown = error; tx.abort(); }
                        };
                        const apply = (rows) => guard(() => { result = action(store, rows, guard); });
                        if (read === null) apply([]);
                        else {
                            const paged = typeof read === 'object';
                            const request = read === 'all' ? store.getAll()
                                : paged ? store.getAll(read.after === undefined ? null : global.IDBKeyRange.lowerBound(read.after, true), 100)
                                    : store.get(read);
                            request.onsuccess = () => apply(read === 'all' || paged ? request.result
                                : request.result ? [request.result] : []);
                        }
                    } catch (error) { global.clearTimeout(timer); reject(error); }
                });
            } finally { db.close(); }
        }
        function eligible(event) {
            return event && event.persistence.generation === control.generation
                && event.timestamp > control.cutoff && event.timestamp >= now() - limits.ageMs;
        }
        function eventBytes(event) {
            return contract.eventBytes?.(event) ?? contract.utf8Bytes(JSON.stringify(event));
        }
        async function retained(rows) {
            const entries = new Map();
            let started = global.performance?.now?.() ?? 0;
            for (let index = 0; index < rows.length; index += 1) {
                const row = rows[index];
                if (row.eventId === INDEX_KEY) continue;
                const event = normalizer.sanitizeEvent(row.event);
                // A mismatched key cannot confirm or overwrite another incident.
                if (eligible(event) && row.eventId === event.eventId) {
                    entries.set(event.eventId, { eventId: event.eventId, event, bytes: eventBytes(event) });
                }
                if (typeof global.requestAnimationFrame === 'function' && index + 1 < rows.length
                    && ((index + 1) % 50 === 0 || (global.performance.now() - started) >= 4)) {
                    // No IDB transaction remains open while preprocessing yields.
                    // A timer relinquishes continuation priority so rendering
                    // can run even during a long cold-history normalization.
                    if (global.document?.hidden) {
                        // Background timer clamping must not keep the shared
                        // lifecycle lock occupied for seconds per chunk.
                        if (global.scheduler?.yield) await global.scheduler.yield();
                        else if (global.MessageChannel) await new Promise((resolve) => {
                            const channel = new global.MessageChannel();
                            channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
                            channel.port2.postMessage(null);
                        });
                    } else await new Promise((resolve) => global.setTimeout(resolve, 0));
                    started = global.performance.now();
                }
            }
            return entries;
        }
        function select(entries) {
            const ordered = Array.from(entries.values()).filter((row) => eligible(row.event))
                .sort((a, b) => priority(b.event) - priority(a.event)
                    || b.event.timestamp - a.event.timestamp || b.event.sequence - a.event.sequence
                    || a.eventId.localeCompare(b.eventId));
            const keep = new Map();
            let total = 0;
            for (const row of ordered) {
                if (keep.size < limits.events && total + row.bytes <= limits.bytes) {
                    keep.set(row.eventId, row);
                    total += row.bytes;
                }
            }
            return keep;
        }
        async function readRows() {
            // Bound structured-clone delivery, too: a whole-table getAll can
            // stall a frame before our sanitizer gets its first yield.
            if (!global.IDBKeyRange) return transaction('readonly', (_store, values) => values);
            const rows = [];
            let after;
            while (true) {
                const page = await transaction('readonly', (_store, values) => values, false, { after });
                rows.push(...page);
                if (page.length < 100 || failure || suspended || closed) return rows;
                after = page[page.length - 1].eventId;
            }
        }
        async function loadIndex() {
            if (retentionIndex && retentionIndex.token === historyToken) return retentionIndex;
            const rows = await readRows();
            const entries = await retained(rows);
            return { token: historyToken, entries, revision: rows.find((row) => row.eventId === INDEX_KEY)?.revision ?? null,
                keys: new Set(rows.filter((row) => row.eventId !== INDEX_KEY).map((row) => row.eventId)) };
        }
        async function commitIndex(index, keep, writes = []) {
            // Rotate BEFORE writing. An abort leaves every old cache invalidated;
            // successful writers install their cache only after oncomplete.
            writeControl(control);
            const token = historyToken;
            const revision = keep.size ? generation() : null;
            const committed = await transaction('readwrite', (store, rows, guard) => {
                const result = { matched: false };
                // The revision is committed with the payload. Older releases
                // prune this non-event row, so their writes invalidate our cache
                // even when they do not rotate the new control write token.
                if ((rows[0]?.revision ?? null) !== index.revision) return result;
                const apply = () => {
                    result.matched = true;
                    for (const id of index.keys) if (!keep.has(id)) store.delete(id);
                    for (const id of writes) if (keep.has(id)) store.put(keep.get(id));
                    if (revision) store.put({ eventId: INDEX_KEY, revision });
                    else store.delete(INDEX_KEY);
                };
                if (index.revision !== null) apply();
                else {
                    // An unmarked empty/legacy database also needs a count
                    // fence, before installing its first revision marker.
                    const count = store.count();
                    count.onsuccess = () => guard(() => {
                        if (count.result === index.keys.size + rows.length) apply();
                    });
                }
                return result;
            }, true, INDEX_KEY);
            if (!committed.matched) { retentionIndex = null; return false; }
            retentionIndex = { token, revision, entries: keep, keys: new Set(keep.keys()) };
            return true;
        }

        async function prune() {
            if (!capabilities() || suspended || !control.enabled) return;
            try {
                await locked(async () => {
                    if (failure || suspended || closed || !control.enabled) return;
                    const index = await loadIndex();
                    sync();
                    if (failure || suspended || closed || !control.enabled || index.token !== historyToken) return;
                    const keep = select(index.entries);
                    if (index.keys.size !== keep.size || (keep.size && index.revision === null) || (!keep.size && index.revision !== null)) {
                        if (!await commitIndex(index, keep)) return;
                    } else retentionIndex = { ...index, entries: keep };
                    dropped += index.keys.size - keep.size;
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
            const bytes = events.reduce((sum, event) => sum + eventBytes(event), 0);
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
                    for (let attempt = 0; attempt < 2; attempt += 1) {
                        const index = await loadIndex();
                        sync();
                        if (failure || suspended || closed || !control.enabled || index.token !== historyToken) return [];
                        const currentBatch = batch.filter(eligible);
                        if (!currentBatch.length) return [];
                        const merged = new Map(Array.from(index.entries).filter(([, row]) => eligible(row.event)));
                        for (const event of currentBatch) {
                            const previous = merged.get(event.eventId)?.event;
                            if (!previous || priority(event) >= priority(previous)) {
                                const persisted = normalizer.sanitizeEvent({ ...event,
                                    persistence: { ...event.persistence, diagnostics: 'persisted' } });
                                merged.set(event.eventId, { eventId: event.eventId, event: persisted, bytes: eventBytes(persisted) });
                            }
                        }
                        const keep = select(merged);
                        if (!await commitIndex(index, keep, currentBatch.map((event) => event.eventId))) continue;
                        dropped += merged.size - keep.size;
                        return currentBatch.filter((event) => keep.has(event.eventId)).map((event) => event.eventId);
                    }
                    return [];
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
                        const rows = query.eventId
                            ? await transaction('readonly', (_store, values) => values, false, query.eventId)
                            : await readRows();
                        return Array.from((await retained(rows)).values(), (row) => row.event).filter(eligible);
                    });
                } catch (error) { fail(failureCode(error)); }
            }
            events = events.filter((event) => !query.eventId || event.eventId === query.eventId)
                .sort((a, b) => a.timestamp - b.timestamp || a.sequence - b.sequence || a.eventId.localeCompare(b.eventId));
            const limit = Number.isSafeInteger(query.limit) ? Math.max(0, Math.min(LIMITS.events, query.limit)) : contract.LIMITS.snapshotEvents;
            truncated = events.length > limit;
            events = limit ? events.slice(-limit) : [];
            return Object.freeze({ schemaVersion: 1, events: Object.freeze(events), persistence: view().persistence,
                coverage: view().coverage, truncated, storage: view() });
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
            if (!capabilities() && coordinationFailed) return { success: false, status: view() };
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
            coordinationReady = false;
            coordinationFailed = false;
            failure = null;
            if (capabilities()) {
                try {
                    await locked(async () => {
                        if (failure || !control.enabled || suspended || closed) return;
                        writeControl(control);
                        // Probe a real write transaction; explicit retry has an
                        // observable outcome even when the reporter has no queue.
                        await transaction('readwrite', (store) => {
                            store.put({ eventId: '__retry_probe__' });
                            store.delete('__retry_probe__');
                        }, true, null);
                    });
                } catch (error) { fail(failureCode(error)); }
            }
            const success = !failure && coordinationReady && !suspended && !closed && control.enabled;
            if (success) emit('retry');
            return Object.freeze({ success, status: view() });
        }
        async function setDetailedMode(enabled) {
            capabilities();
            if (closed || suspended || coordinationFailed) {
                return Object.freeze({ success: false, status: view() });
            }
            try {
                await locked(() => {
                    if (closed || suspended || coordinationFailed) throw new Error('Mode coordination unavailable');
                    const timestamp = now();
                    // Repeated enable requests do not silently extend a running lease.
                    if (enabled === true && detailedMode().active) return;
                    publish({ ...control, detailedStartedAt: enabled === true ? timestamp : 0,
                        detailedUntil: enabled === true ? timestamp + DETAILED_MODE_MS : 0 });
                });
                return Object.freeze({ success: true, status: view() });
            } catch (_) { return Object.freeze({ success: false, status: view() }); }
        }
        async function withFullReset(callback) {
            // A reset must still work after diagnostic storage failed. It requires
            // working coordination, but never opens this database to establish it.
            if (closed || !global.navigator?.locks?.request) throw new Error('Diagnostic coordination unavailable');
            return locked(async () => {
                const next = nextControl({ enabled: true, phase: 'resetting', detailedStartedAt: 0, detailedUntil: 0 });
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
        const api = Object.freeze({ append, snapshot, retry, setDetailedMode, withFullReset, controlKey, ready,
            getIncident: async (eventId) => (await snapshot({ eventId, limit: 1 })).events[0] || null,
            clear: () => clearHistory(), setEnabled: (enabled) => clearHistory(enabled === true),
            status() { sync(); return view(); },
            subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
            close() { closed = true; retentionIndex = null; channel?.close(); global.removeEventListener?.('storage', onStorage); listeners.clear(); }
        });
        return api;
    }
    global.AppDiagnosticStorage = Object.freeze({ create, DATABASE_NAME, CONTROL_KEY, LOCK_NAME, LIMITS, DETAILED_MODE_MS });
    global.AppDiagnosticStore = create();
})(typeof globalThis !== 'undefined' ? globalThis : this);
