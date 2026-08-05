(function installDataKernel(global) {
    'use strict';

    if (global.AppData) return;

    const catalog = global.__AppDataV2Catalog;
    if (!catalog) throw new Error('AppData v2 requires DataCatalog before DataKernel');

    const DATABASE_NAME = 'IELTSAtlasDataV2';
    // Version 2 uses a new schema, but initialization must still import the durable
    // ExamSystemDB data owned by releases which predate AppData v2.
    const DATABASE_VERSION = 2;
    const DOCUMENT_STORE = 'documents';
    const SYSTEM_STORE = 'system';
    const ENTITY_STORES = Object.freeze(['practiceSummaries', 'practiceDetails', 'practiceAnnotations']);
    const STORE_NAMES = Object.freeze([DOCUMENT_STORE, SYSTEM_STORE].concat(ENTITY_STORES));
    const OPERATION_JOURNAL_WINDOW = 500;
    const COMMIT_CHANNEL_NAME = `${DATABASE_NAME}:committed`;
    const DEFAULT_IDB_MUTATION_TIMEOUT_MS = 30000;
    const DEFAULT_IDB_REQUEST_TIMEOUT_MS = 30000;
    const MAX_TIMER_DELAY_MS = 2147483647;
    const LEGACY_DATABASE_NAME = 'ExamSystemDB';
    const LEGACY_STORE_NAME = 'keyValueStore';
    const LEGACY_EXTERNAL_DATABASE_NAME = 'ExamSystemExternalBackup';
    const LEGACY_EXTERNAL_STORE_NAME = 'handles';
    const LEGACY_EXTERNAL_HANDLE_KEY = 'backup_directory';
    const LEGACY_EXTERNAL_FILENAME = 'practice-backup-latest.json';
    const LEGACY_UNPREFIXED_WEB_KEYS = Object.freeze([
        'practice_records',
        'vocab_user_config',
        'user_achievements'
    ]);

    function clone(value) { return catalog.clone(value); }
    function nowIso() { return new Date().toISOString(); }
    function randomId(prefix) {
        const random = global.crypto && typeof global.crypto.randomUUID === 'function'
            ? global.crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
        return `${prefix || 'op'}_${random}`;
    }

    class AppDataError extends Error {
        constructor(code, message, details = {}) {
            super(message);
            this.name = 'AppDataError';
            this.code = code;
            this.committed = false;
            this.details = details;
        }
    }
    function validation(message, details) { return new AppDataError('VALIDATION', message, details || {}); }
    function corruption(message, details) { return new AppDataError('CORRUPT_RECORD', message, details || {}); }

    function normalizeTimeoutMs(value, fallback) {
        if (value === undefined || value === null || value === '') return fallback;
        const numeric = Number(value);
        return Number.isFinite(numeric) && numeric > 0 ? Math.min(numeric, MAX_TIMER_DELAY_MS) : fallback;
    }
    function scheduleTimeout(handler, delayMs) {
        if (typeof global.setTimeout !== 'function') throw new Error('setTimeout unavailable');
        const handle = global.setTimeout.call(global, handler, delayMs);
        if (handle === null || handle === undefined) throw new Error('setTimeout did not return a handle');
        return handle;
    }
    function cancelTimeout(handle) {
        if (handle !== null && handle !== undefined && typeof global.clearTimeout === 'function') {
            try { global.clearTimeout.call(global, handle); } catch (_) { /* already gone */ }
        }
    }
    function withDeadline(handle, timeoutMs, description, resolve, reject) {
        let settled = false;
        let timer = null;
        const settle = (callback, value) => {
            if (settled) return;
            settled = true;
            cancelTimeout(timer);
            callback(value);
        };
        const expire = (error) => {
            if (settled) return;
            settled = true;
            try { if (handle && typeof handle.abort === 'function') handle.abort(); } catch (_) { /* best effort */ }
            reject(error);
        };
        try {
            timer = scheduleTimeout(() => expire(new AppDataError('BACKEND_UNAVAILABLE', `IndexedDB ${description} timed out after ${timeoutMs}ms`, {
                operation: description, timeoutMs, reason: 'timeout'
            })), timeoutMs);
        } catch (error) {
            expire(new AppDataError('BACKEND_UNAVAILABLE', `IndexedDB ${description} watchdog unavailable`, {
                operation: description, reason: 'watchdog-unavailable', cause: error && error.message
            }));
        }
        return { resolve(value) { settle(resolve, value); }, reject(error) { settle(reject, error); } };
    }

    function canonicalizeJson(value, path = '$', ancestors = new Set()) {
        if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) throw validation(`Non-finite number at ${path}`, { path });
            return Object.is(value, -0) ? 0 : value;
        }
        if (typeof value !== 'object' || value === undefined || typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
            throw validation(`Non-JSON value at ${path}`, { path, type: typeof value });
        }
        if (ancestors.has(value)) throw validation(`Cyclic data at ${path}`, { path });
        const prototype = Object.getPrototypeOf(value);
        if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw validation(`Non-plain object at ${path}`, { path });
        if (typeof Reflect === 'object' && typeof Reflect.ownKeys === 'function'
            && Reflect.ownKeys(value).some((key) => typeof key === 'symbol')) {
            throw validation(`Symbol-keyed property at ${path}`, { path });
        }
        ancestors.add(value);
        try {
            if (Array.isArray(value)) {
                return value.map((item, index) => {
                    if (!Object.prototype.hasOwnProperty.call(value, index)) throw validation(`Sparse array entry at ${path}[${index}]`, { path });
                    return canonicalizeJson(item, `${path}[${index}]`, ancestors);
                });
            }
            const result = {};
            for (const key of Object.keys(value).sort()) {
                const descriptor = Object.getOwnPropertyDescriptor(value, key);
                if (!descriptor || descriptor.get || descriptor.set) throw validation(`Accessor property at ${path}.${key}`, { path });
                result[key] = canonicalizeJson(descriptor.value, `${path}.${key}`, ancestors);
            }
            return result;
        } finally { ancestors.delete(value); }
    }
    function stableStringifyCanonical(value) {
        if (value === null || typeof value !== 'object') return JSON.stringify(value);
        if (Array.isArray(value)) return `[${value.map(stableStringifyCanonical).join(',')}]`;
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringifyCanonical(value[key])}`).join(',')}}`;
    }
    function stableStringify(value) { return stableStringifyCanonical(canonicalizeJson(value)); }
    function checksum(value) {
        const input = stableStringify(value);
        let hash = 2166136261;
        for (let index = 0; index < input.length; index += 1) { hash ^= input.charCodeAt(index); hash = Math.imul(hash, 16777619); }
        return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
    }
    function legacyTimestamp(value) {
        if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return -Infinity;
        if (Number.isFinite(Number(value))) return Number(value);
        const parsed = Date.parse(value == null ? '' : String(value));
        return Number.isFinite(parsed) ? parsed : -Infinity;
    }
    function parseLegacyCandidate(value, outerTimestamp) {
        let parsed = value;
        let timestamp = legacyTimestamp(outerTimestamp);
        const hasOuterTimestamp = timestamp !== -Infinity;
        for (let depth = 0; depth < 3; depth += 1) {
            if (typeof parsed === 'string') {
                try { parsed = JSON.parse(parsed); } catch (_) { if (depth === 0) return null; break; }
            } else if (parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, 'data')
                && (Object.prototype.hasOwnProperty.call(parsed, 'version') || Object.prototype.hasOwnProperty.call(parsed, 'compressed'))) {
                const innerTimestamp = legacyTimestamp(parsed.timestamp);
                if (!hasOuterTimestamp && innerTimestamp > timestamp) timestamp = innerTimestamp;
                parsed = parsed.data;
            } else break;
        }
        return { value: clone(parsed), timestamp };
    }
    function parseLegacyValue(value) {
        const candidate = parseLegacyCandidate(value);
        return candidate ? candidate.value : clone(value);
    }
    async function readLegacyValues(indexedDBApi = global.indexedDB, storage = global.localStorage, sessionStorageApi = global.sessionStorage) {
        const values = {};
        const candidates = {};
        let readComplete = true;
        const consider = (alias, rawValue, timestamp, sourceRank) => {
            const candidate = parseLegacyCandidate(rawValue, timestamp);
            if (!candidate) return;
            const previous = candidates[alias];
            if (!previous || candidate.timestamp > previous.timestamp
                || (candidate.timestamp === previous.timestamp && sourceRank < previous.sourceRank)) {
                candidates[alias] = Object.assign(candidate, { sourceRank });
            }
        };
        if (indexedDBApi && typeof indexedDBApi.open === 'function') {
            await new Promise((resolve) => {
                let request;
                let createdEmptyDatabase = false;
                try { request = indexedDBApi.open(LEGACY_DATABASE_NAME); } catch (_) { readComplete = false; resolve(); return; }
                request.onerror = () => { if (!createdEmptyDatabase) readComplete = false; resolve(); };
                request.onupgradeneeded = () => {
                    createdEmptyDatabase = true;
                    try { request.transaction.abort(); } catch (_) {}
                };
                request.onsuccess = () => {
                    const db = request.result;
                    if (!db.objectStoreNames.contains(LEGACY_STORE_NAME)) { db.close(); resolve(); return; }
                    const tx = db.transaction(LEGACY_STORE_NAME, 'readonly');
                    const keys = tx.objectStore(LEGACY_STORE_NAME).getAllKeys();
                    const rows = tx.objectStore(LEGACY_STORE_NAME).getAll();
                    tx.oncomplete = () => {
                        (keys.result || []).forEach((key, index) => {
                            const row = (rows.result || [])[index];
                            // v1's keyValueStore persisted { key, value, timestamp } rows.
                            const validRow = row && typeof row === 'object'
                                && Object.prototype.hasOwnProperty.call(row, 'key')
                                && String(row.key) === String(key)
                                && Object.prototype.hasOwnProperty.call(row, 'value');
                            if (!validRow) {
                                readComplete = false;
                                return;
                            }
                            consider(String(key).replace(/^exam_system_/, ''), row.value, row.timestamp, 0);
                        });
                        db.close(); resolve();
                    };
                    tx.onerror = tx.onabort = () => { readComplete = false; db.close(); resolve(); };
                };
            });
        }
        for (const [sourceRank, fallbackStorage] of [storage, sessionStorageApi].entries()) {
            if (!fallbackStorage || typeof fallbackStorage.key !== 'function') continue;
            for (let index = 0; index < Number(fallbackStorage.length || 0); index += 1) {
                const key = fallbackStorage.key(index);
                if (!key) continue;
                const alias = key.startsWith('exam_system_')
                    ? key.slice('exam_system_'.length)
                    : (LEGACY_UNPREFIXED_WEB_KEYS.includes(key) ? key : null);
                if (!alias) continue;
                try { consider(alias, fallbackStorage.getItem(key), null, sourceRank + 1); } catch (_) { /* inaccessible fallback */ }
            }
        }
        for (const [alias, candidate] of Object.entries(candidates)) values[alias] = candidate.value;
        Object.defineProperty(values, '__legacyReadComplete', {
            value: readComplete,
            enumerable: false,
            configurable: false,
            writable: false
        });
        return values;
    }
    async function readLegacyExternalBackup(indexedDBApi = global.indexedDB) {
        if (!indexedDBApi || typeof indexedDBApi.open !== 'function') return null;
        const directoryHandle = await new Promise((resolve) => {
            let request;
            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                resolve(value || null);
            };
            try { request = indexedDBApi.open(LEGACY_EXTERNAL_DATABASE_NAME); } catch (_) { finish(null); return; }
            request.onerror = () => finish(null);
            request.onupgradeneeded = () => {
                try { request.transaction.abort(); } catch (_) {}
                finish(null);
            };
            request.onsuccess = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(LEGACY_EXTERNAL_STORE_NAME)) {
                    db.close(); finish(null); return;
                }
                const get = db.transaction(LEGACY_EXTERNAL_STORE_NAME, 'readonly')
                    .objectStore(LEGACY_EXTERNAL_STORE_NAME).get(LEGACY_EXTERNAL_HANDLE_KEY);
                get.onerror = () => { db.close(); finish(null); };
                get.onsuccess = () => { db.close(); finish(get.result); };
            };
        });
        if (!directoryHandle || typeof directoryHandle.queryPermission !== 'function') return null;
        if (await directoryHandle.queryPermission({ mode: 'read' }) !== 'granted') return null;
        const fileHandle = await directoryHandle.getFileHandle(LEGACY_EXTERNAL_FILENAME, { create: false });
        const parsed = JSON.parse(await (await fileHandle.getFile()).text());
        const payload = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.data !== undefined
            ? parsed.data : parsed;
        return payload && typeof payload === 'object' && !Array.isArray(payload) ? clone(payload) : null;
    }
    function lookupEntry(logicalKey) {
        if (!catalog.has(logicalKey)) throw validation(`Unknown AppData logical key: ${logicalKey}`, { logicalKey });
        return catalog.get(logicalKey);
    }
    function storeFor(logicalKey) {
        const entry = lookupEntry(logicalKey);
        if (entry.classification === 'session') throw validation(`${logicalKey} is not durable kernel data`, { logicalKey });
        return entry.classification === 'system' ? SYSTEM_STORE : DOCUMENT_STORE;
    }
    function makeEnvelope(entry, data, options = {}) {
        const state = options.state === 'cleared' ? 'cleared' : 'present';
        if (options.state !== undefined && state !== options.state) throw validation(`Invalid envelope state for ${entry.logicalKey}`);
        let normalized = null;
        if (state === 'present') {
            try { normalized = options.normalized ? data : entry.normalize(canonicalizeJson(data, `$.${entry.logicalKey}`)); } catch (error) {
                throw validation(`Unable to normalize ${entry.logicalKey}`, { cause: error && error.message });
            }
            normalized = canonicalizeJson(normalized, `$.${entry.logicalKey}`);
            if (!entry.validate(normalized)) throw validation(`Invalid data for ${entry.logicalKey}`, { logicalKey: entry.logicalKey });
        }
        const revision = options.revision === undefined ? 1 : Number(options.revision);
        if (!Number.isInteger(revision) || revision < 1) throw validation(`Invalid revision for ${entry.logicalKey}`);
        const payload = { schemaVersion: entry.schemaVersion, revision, operationId: String(options.operationId || randomId('op')),
            updatedAt: options.updatedAt || nowIso(), state, data: normalized };
        payload.checksum = checksum(payload.data);
        return Object.freeze(payload);
    }
    function validateEnvelope(entry, envelope) {
        try {
            if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
                || Number(envelope.schemaVersion) !== Number(entry.schemaVersion)
                || !Number.isInteger(Number(envelope.revision)) || Number(envelope.revision) < 1
                || typeof envelope.operationId !== 'string' || !envelope.operationId
                || typeof envelope.updatedAt !== 'string' || !envelope.updatedAt
                || (envelope.state !== 'present' && envelope.state !== 'cleared')) return false;
            const data = canonicalizeJson(envelope.data, `$.${entry.logicalKey}`);
            return (envelope.state !== 'cleared' || data === null)
                && (envelope.state !== 'present' || entry.validate(data)) && envelope.checksum === checksum(data);
        } catch (_) { return false; }
    }
    function operationId(value) {
        if (value === undefined || value === null || value === '') return randomId('mutation');
        if (typeof value !== 'string' || !value.trim()) throw validation('operationId must be a non-empty string');
        return value;
    }
    function expectedRevision(value, label) {
        if (value === undefined || value === null) return null;
        const revision = Number(value);
        if (!Number.isInteger(revision) || revision < 0) throw validation(`Invalid expectedRevision for ${label}`);
        return revision;
    }
    function compactJournal(journal) {
        const ranked = Object.entries(journal).sort((left, right) => Number(right[1].sequence) - Number(left[1].sequence));
        for (let index = OPERATION_JOURNAL_WINDOW; index < ranked.length; index += 1) delete journal[ranked[index][0]];
    }
    function readJournal(row) {
        const envelope = row && row.envelope;
        return envelope && envelope.state === 'present' && envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data)
            ? clone(envelope.data) : {};
    }
    function journalResult(journal, spec) {
        const existing = journal[spec.operationId];
        if (!existing) return null;
        if (existing.fingerprint !== spec.fingerprint || !existing.receipt) {
            throw new AppDataError('CONFLICT', `operationId is already bound to another request: ${spec.operationId}`, { operationId: spec.operationId });
        }
        return clone(existing.receipt);
    }
    function writeJournal(journal, spec, receipt) {
        const sequence = Object.values(journal).reduce((maximum, item) => Math.max(maximum, Number(item.sequence) || 0), 0) + 1;
        journal[spec.operationId] = { fingerprint: spec.fingerprint, receipt: clone(receipt), sequence, committedAt: nowIso() };
        compactJournal(journal);
        return journal;
    }
    function putJournal(tx, currentRow, journal, spec, receipt) {
        const current = currentRow && currentRow.envelope;
        const envelope = makeEnvelope(lookupEntry('system.operationJournal'), writeJournal(journal, spec, receipt), {
            revision: current ? Number(current.revision) + 1 : 1,
            operationId: spec.operationId,
            normalized: true
        });
        tx.objectStore(SYSTEM_STORE).put({ logicalKey: 'system.operationJournal', envelope: canonicalizeJson(envelope) });
    }

    class IndexedDBDriver {
        constructor(indexedDBApi, options) {
            this.indexedDB = indexedDBApi;
            this.db = null;
            this.mutationTimeoutMs = options.mutationTimeoutMs;
            this.requestTimeoutMs = options.requestTimeoutMs;
        }
        async initialize() {
            if (!this.indexedDB || typeof this.indexedDB.open !== 'function') throw new Error('IndexedDB unavailable');
            this.db = await new Promise((resolve, reject) => {
                const request = this.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
                let abandoned = false;
                let settle;
                request.onsuccess = () => { if (abandoned || !settle) { try { request.result.close(); } catch (_) {} } else settle.resolve(request.result); };
                request.onupgradeneeded = (event) => {
                    const db = request.result;
                    if (event.oldVersion < 2) {
                        for (const name of ['authoritative', 'derived']) {
                            if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
                        }
                    }
                    for (const name of STORE_NAMES) {
                        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: name === DOCUMENT_STORE || name === SYSTEM_STORE ? 'logicalKey' : 'recordId' });
                    }
                };
                settle = withDeadline({ abort() { abandoned = true; } }, this.requestTimeoutMs, 'open', resolve, reject);
                request.onerror = () => settle.reject(request.error || new Error('Unable to open IndexedDB'));
                request.onblocked = () => {
                    abandoned = true;
                    settle.reject(new Error('IndexedDB upgrade blocked'));
                };
            });
            this.db.onversionchange = () => this.close();
            return this;
        }
        close() { const db = this.db; this.db = null; try { if (db) db.close(); } catch (_) {} }
        _open() { if (!this.db) throw new Error('IndexedDB connection closed'); }
        _transaction(stores, mode, description, work, mutation = false) {
            this._open();
            return new Promise((resolve, reject) => {
                let failure = null;
                let value;
                let tx;
                try { tx = this.db.transaction(stores, mode); } catch (error) { reject(error); return; }
                const settle = withDeadline(tx, mutation ? this.mutationTimeoutMs : this.requestTimeoutMs, description, resolve, reject);
                tx.oncomplete = () => settle.resolve(clone(value));
                tx.onerror = () => { failure = failure || tx.error || new Error(`IndexedDB ${description} failed`); };
                tx.onabort = () => settle.reject(failure || tx.error || new Error(`IndexedDB ${description} aborted`));
                const fail = (error) => { failure = failure || error; try { tx.abort(); } catch (_) {} };
                try { work(tx, (result) => { value = result; }, fail); } catch (error) { fail(error); }
            });
        }
        readEnvelope(logicalKey) {
            const store = storeFor(logicalKey);
            return this._transaction([store], 'readonly', `read ${logicalKey}`, (tx, done, fail) => {
                const request = tx.objectStore(store).get(logicalKey);
                request.onsuccess = () => done(request.result ? request.result.envelope : null);
                request.onerror = () => fail(request.error || new Error(`Read failed: ${logicalKey}`));
            });
        }
        readEntity(store, recordId) {
            return this._transaction([store], 'readonly', `read ${store}/${recordId}`, (tx, done, fail) => {
                const request = tx.objectStore(store).get(recordId);
                request.onsuccess = () => done(request.result || null);
                request.onerror = () => fail(request.error || new Error('Entity read failed'));
            });
        }
        readPracticeSnapshot(recordIds = null, options = {}) {
            const stores = Array.isArray(options.stores) && options.stores.length
                ? Array.from(new Set(options.stores.map((store) => entityStore(store))))
                : ENTITY_STORES.slice();
            const requested = recordIds === null || recordIds === undefined
                ? null
                : new Set((Array.isArray(recordIds) ? recordIds : [recordIds])
                    .map((value) => String(value || ''))
                    .filter(Boolean));
            return this._transaction(stores, 'readonly', 'read practice snapshot', (tx, done, fail) => {
                const result = Object.fromEntries(stores.map((store) => [store, []]));
                let remaining = stores.length;
                const finishStore = (store, rows) => {
                    result[store] = (rows || []).filter((row) => !requested || requested.has(String(row && row.recordId || '')));
                    remaining -= 1;
                    if (!remaining) done(result);
                };
                for (const store of stores) {
                    const objectStore = tx.objectStore(store);
                    const request = requested && requested.size === 1
                        ? objectStore.get(Array.from(requested)[0])
                        : objectStore.getAll();
                    request.onsuccess = () => {
                        const rows = requested && requested.size === 1
                            ? (request.result ? [request.result] : [])
                            : request.result;
                        finishStore(store, rows);
                    };
                    request.onerror = () => fail(request.error || new Error(`Practice snapshot read failed: ${store}`));
                }
            });
        }
        listEntities(store) {
            return this._transaction([store], 'readonly', `list ${store}`, (tx, done, fail) => {
                const request = tx.objectStore(store).getAll();
                request.onsuccess = () => done(request.result || []);
                request.onerror = () => fail(request.error || new Error('Entity list failed'));
            });
        }
        atomic(spec) {
            return this._transaction(spec.stores, 'readwrite', `mutation ${spec.operationId}`, (tx, done, fail) => {
                const journalRequest = tx.objectStore(SYSTEM_STORE).get('system.operationJournal');
                journalRequest.onerror = () => fail(journalRequest.error || new Error('Journal read failed'));
                journalRequest.onsuccess = () => {
                    try { spec.apply(tx, journalRequest.result || null, readJournal(journalRequest.result), done, fail); } catch (error) { fail(error); }
                };
            }, true);
        }
        exportSnapshot(envelopeKeys) {
            return this._transaction(STORE_NAMES, 'readonly', 'snapshot export', (tx, done, fail) => {
                const result = { envelopes: {}, entities: {} };
                let remaining = STORE_NAMES.length;
                for (const store of STORE_NAMES) {
                    const request = tx.objectStore(store).getAll();
                    request.onerror = () => fail(request.error || new Error(`Snapshot read failed: ${store}`));
                    request.onsuccess = () => {
                        if (store === DOCUMENT_STORE || store === SYSTEM_STORE) {
                            for (const row of request.result || []) if (envelopeKeys(row.logicalKey)) result.envelopes[row.logicalKey] = row.envelope;
                        } else result.entities[store] = request.result || [];
                        remaining -= 1;
                        if (!remaining) done(result);
                    };
                }
            });
        }
    }

    function entityStore(store) {
        const value = String(store || '');
        if (!ENTITY_STORES.includes(value)) throw validation(`Unknown entity store: ${value}`, { store: value });
        return value;
    }
    function validateEntityRow(store, row) {
        if (!row || typeof row !== 'object' || Array.isArray(row)
            || typeof row.recordId !== 'string' || !row.recordId
            || !Number.isInteger(Number(row.revision)) || Number(row.revision) < 1
            || typeof row.operationId !== 'string' || !row.operationId
            || typeof row.updatedAt !== 'string' || !row.updatedAt) {
            throw corruption(`Invalid entity row: ${store}`, { store, recordId: row && row.recordId || null });
        }
        const data = canonicalizeJson(row.data, `$.${store}.${row.recordId}`);
        if (row.checksum !== checksum(data)) {
            throw corruption(`Entity checksum mismatch: ${store}/${row.recordId}`, { store, recordId: row.recordId });
        }
        return row;
    }
    function normalizeEntityOperation(operation, index) {
        if (!operation || typeof operation !== 'object' || Array.isArray(operation)) throw validation(`Invalid entity operation at index ${index}`);
        const type = String(operation.type || '');
        const store = entityStore(operation.store);
        if (!['upsert', 'delete', 'clear'].includes(type)) throw validation(`Invalid entity operation type: ${type}`);
        const recordId = type === 'clear' ? null : String(operation.recordId || '');
        if (type !== 'clear' && !recordId.trim()) throw validation(`Entity operation ${type} requires recordId`);
        const data = type === 'upsert' ? canonicalizeJson(operation.data, `$.operations[${index}].data`) : null;
        return { type, store, recordId, data, expectedRevision: expectedRevision(operation.expectedRevision, `${store}/${recordId || '*'}`) };
    }
    function receiptFor(operationIdValue, revisions, warnings, pending) {
        const receipt = { committed: true, revisions, operationId: operationIdValue,
            derived: { status: pending.length ? 'pending' : 'ready', pending: pending.slice() }, warnings: warnings.slice() };
        const keys = Object.keys(revisions); if (keys.length === 1) receipt.revision = revisions[keys[0]];
        return receipt;
    }

    class DataKernel {
        constructor(options = {}) {
            this.driver = null;
            this.backend = null;
            this.state = 'created';
            this.failure = null;
            this.indexedDB = Object.prototype.hasOwnProperty.call(options, 'indexedDB') ? options.indexedDB : global.indexedDB;
            this.indexedDBMutationTimeoutMs = normalizeTimeoutMs(options.indexedDBMutationTimeoutMs, DEFAULT_IDB_MUTATION_TIMEOUT_MS);
            this.indexedDBRequestTimeoutMs = normalizeTimeoutMs(options.indexedDBRequestTimeoutMs, DEFAULT_IDB_REQUEST_TIMEOUT_MS);
            this.committedListeners = new Set();
            this.commitChannel = null;
            this.instanceId = randomId('kernel');
            this.ready = null;
        }
        _initializeCommitChannel() {
            if (this.commitChannel || typeof global.BroadcastChannel !== 'function') return;
            try {
                const channel = new global.BroadcastChannel(COMMIT_CHANNEL_NAME);
                channel.onmessage = (message) => {
                    const data = message && message.data;
                    if (!data || data.sourceInstanceId === this.instanceId
                        || typeof data.operationId !== 'string' || !Array.isArray(data.targets)) return;
                    this._dispatchCommitted({
                        operationId: data.operationId,
                        targets: clone(data.targets),
                        receipt: data.receipt ? clone(data.receipt) : null,
                        remote: true
                    });
                };
                this.commitChannel = channel;
            } catch (_) {
                this.commitChannel = null;
            }
        }
        _closeCommitChannel() {
            const channel = this.commitChannel;
            this.commitChannel = null;
            try { if (channel) channel.close(); } catch (_) {}
        }
        initialize() {
            if (this.ready) return this.ready;
            this.state = 'initializing';
            this.ready = new IndexedDBDriver(this.indexedDB, {
                mutationTimeoutMs: this.indexedDBMutationTimeoutMs, requestTimeoutMs: this.indexedDBRequestTimeoutMs
            }).initialize().then((driver) => {
                this.driver = driver; this.backend = 'indexeddb-v2'; this.state = 'ready'; this._initializeCommitChannel(); return this;
            }).catch((error) => { this.state = 'failed'; this.failure = error; this.driver = null; this.backend = null;
                throw error instanceof AppDataError ? error : new AppDataError('BACKEND_UNAVAILABLE', 'IndexedDB is required for AppData v2', { cause: error && error.message }); });
            return this.ready;
        }
        close() {
            if (this.driver) this.driver.close();
            this.driver = null; this.backend = null;
            this._closeCommitChannel();
            if (this.state !== 'failed') this.state = 'closed';
        }
        _assertReady() {
            if (this.state === 'failed') throw new AppDataError('BACKEND_UNAVAILABLE', 'AppData v2 backend failed', { cause: this.failure && this.failure.message });
            if (this.state !== 'ready' || !this.driver) throw new AppDataError('BACKEND_UNAVAILABLE', 'AppData v2 is not initialized');
        }
        _latch(error) {
            if (error && (error.name === 'QuotaExceededError' || error.code === 22)) return new AppDataError('QUOTA_EXCEEDED', 'IndexedDB write failed: storage quota exceeded', { cause: error.message });
            this.state = 'failed'; this.failure = error; if (this.driver) this.driver.close(); this.driver = null; this.backend = null; this._closeCommitChannel();
            return new AppDataError('BACKEND_UNAVAILABLE', 'Active IndexedDB backend failed; reload is required', { cause: error && error.message });
        }
        onCommitted(listener) {
            if (typeof listener !== 'function') throw validation('Committed listener must be a function');
            this.committedListeners.add(listener); return () => this.committedListeners.delete(listener);
        }
        _dispatchCommitted(event) {
            if (!event || !this.committedListeners.size) return;
            const schedule = typeof global.queueMicrotask === 'function' ? global.queueMicrotask.bind(global) : (callback) => Promise.resolve().then(callback);
            schedule(() => Array.from(this.committedListeners).forEach((listener) => { try { Promise.resolve(listener(clone(event))).catch(() => {}); } catch (_) {} }));
        }
        _notifyCommitted(targets, receipt) {
            if (!targets.length) return;
            const event = { operationId: receipt.operationId, targets: clone(targets), receipt: clone(receipt), remote: false };
            this._dispatchCommitted(event);
            if (this.commitChannel) {
                try {
                    this.commitChannel.postMessage({
                        sourceInstanceId: this.instanceId,
                        operationId: event.operationId,
                        targets: event.targets,
                        receipt: event.receipt
                    });
                } catch (_) { /* cross-realm notification is best effort */ }
            }
        }
        async getEnvelope(logicalKey) {
            this._assertReady(); const entry = lookupEntry(logicalKey);
            try { const envelope = await this.driver.readEnvelope(logicalKey); if (envelope && !validateEnvelope(entry, envelope)) throw corruption(`Invalid envelope: ${logicalKey}`, { logicalKey }); return envelope; }
            catch (error) { if (error instanceof AppDataError) throw error; throw this._latch(error); }
        }
        async read(logicalKey, options = {}) {
            const entry = lookupEntry(logicalKey); const envelope = await this.getEnvelope(logicalKey);
            const data = !envelope || envelope.state === 'cleared' ? entry.defaultValue() : envelope.data;
            return options.withMeta ? { data: clone(data), envelope: envelope ? clone(envelope) : null } : clone(data);
        }
        _documentSpec(changes, options) {
            if (!Array.isArray(changes) || (!changes.length && !options.allowNoop && !options.noop)) throw validation('DataKernel.mutate requires changes');
            const opId = operationId(options.operationId); const seen = new Set();
            const prepared = changes.map((change, index) => {
                if (!change || typeof change !== 'object' || Array.isArray(change)) throw validation(`Invalid mutation change at index ${index}`);
                const logicalKey = String(change.logicalKey || ''); const entry = lookupEntry(logicalKey);
                if (logicalKey === 'system.operationJournal') throw validation('system.operationJournal is managed by DataKernel');
                if (seen.has(logicalKey)) throw validation(`Duplicate mutation key: ${logicalKey}`); seen.add(logicalKey);
                const state = change.state === 'cleared' ? 'cleared' : 'present';
                if (change.state !== undefined && state !== change.state) throw validation(`Invalid mutation state for ${logicalKey}`);
                if (state === 'cleared' && entry.classification === 'system') throw validation(`${logicalKey} cannot be cleared`);
                let data = null;
                if (state === 'present') { try { data = canonicalizeJson(entry.normalize(canonicalizeJson(change.data)), '$.data'); } catch (error) { throw validation(`Unable to normalize ${logicalKey}`, { cause: error && error.message }); } if (!entry.validate(data)) throw validation(`Invalid data for ${logicalKey}`); }
                return { logicalKey, entry, state, data, expectedRevision: expectedRevision(change.expectedRevision, logicalKey) };
            });
            const warnings = options.warnings === undefined ? [] : canonicalizeJson(options.warnings, '$.warnings');
            if (!Array.isArray(warnings) || warnings.some((item) => typeof item !== 'string')) throw validation('warnings must be an array of strings');
            const fingerprint = checksum({ changes: prepared.map((item) => ({ logicalKey: item.logicalKey, state: item.state, data: item.data, expectedRevision: item.expectedRevision })), warnings });
            return { operationId: opId, changes: prepared, pending: [], warnings, fingerprint, stores: Array.from(new Set([SYSTEM_STORE].concat(prepared.map((item) => storeFor(item.logicalKey))))) };
        }
        async mutate(changes, options = {}) {
            this._assertReady(); const spec = this._documentSpec(changes, options);
            try {
                const receipt = await this.driver.atomic(Object.assign(spec, { apply: (tx, journalRow, journal, done, fail) => {
                    const replay = journalResult(journal, spec); if (replay) { done(replay); return; }
                    const reads = spec.changes.map((change) => ({ change, request: tx.objectStore(storeFor(change.logicalKey)).get(change.logicalKey) }));
                    let remaining = reads.length;
                    const finish = () => {
                        const revisions = {};
                        for (const item of reads) {
                            const current = item.request.result ? item.request.result.envelope : null;
                            if (current && !validateEnvelope(item.change.entry, current)) throw corruption(`Invalid stored envelope: ${item.change.logicalKey}`, { logicalKey: item.change.logicalKey });
                            const revision = current ? Number(current.revision) : 0;
                            if (item.change.expectedRevision !== null && item.change.expectedRevision !== revision) throw new AppDataError('CONFLICT', `Revision conflict for ${item.change.logicalKey}`, { logicalKey: item.change.logicalKey, expectedRevision: item.change.expectedRevision, actualRevision: revision });
                            const envelope = makeEnvelope(item.change.entry, item.change.data, { state: item.change.state, revision: revision + 1, operationId: spec.operationId, normalized: true });
                            tx.objectStore(storeFor(item.change.logicalKey)).put({ logicalKey: item.change.logicalKey, envelope: canonicalizeJson(envelope) }); revisions[item.change.logicalKey] = envelope.revision;
                        }
                        const receipt = receiptFor(spec.operationId, revisions, spec.warnings, []);
                        putJournal(tx, journalRow, journal, spec, receipt);
                        done(receipt);
                    };
                    if (!remaining) { finish(); return; }
                    for (const item of reads) { item.request.onerror = () => fail(item.request.error || new Error('Mutation read failed')); item.request.onsuccess = () => { remaining -= 1; if (!remaining) { try { finish(); } catch (error) { fail(error); } } }; }
                } }));
                const targets = spec.changes.filter((change) => change.entry.owner !== 'backups' && (change.entry.classification === 'authoritative' || change.entry.classification === 'preference')).map((change) => ({ logicalKey: change.logicalKey, state: change.state, owner: change.entry.owner, classification: change.entry.classification }));
                this._notifyCommitted(targets, receipt); return receipt;
            } catch (error) { if (error instanceof AppDataError && (error.code === 'VALIDATION' || error.code === 'CONFLICT' || error.code === 'CORRUPT_RECORD')) throw error; throw this._latch(error); }
        }
        async journalNoop(options = {}) { return this.mutate([], Object.assign({}, options, { allowNoop: true })); }
        async readEntity(store, recordId, options = {}) {
            this._assertReady(); store = entityStore(store); const id = String(recordId || ''); if (!id) throw validation('readEntity requires recordId');
            try {
                const row = await this.driver.readEntity(store, id);
                if (!row) return null;
                validateEntityRow(store, row);
                return options.withMeta ? clone(row) : clone(row.data);
            }
            catch (error) { if (error instanceof AppDataError) throw error; throw this._latch(error); }
        }
        async readPracticeSnapshot(recordIds = null, options = {}) {
            this._assertReady();
            const ids = recordIds === null || recordIds === undefined
                ? null
                : (Array.isArray(recordIds) ? recordIds : [recordIds])
                    .map((value) => String(value || ''))
                    .filter(Boolean);
            try {
                const snapshot = await this.driver.readPracticeSnapshot(ids, options);
                const result = {};
                const stores = Array.isArray(options.stores) && options.stores.length
                    ? Array.from(new Set(options.stores.map((store) => entityStore(store))))
                    : ENTITY_STORES;
                for (const store of stores) {
                    const validRows = (snapshot && Array.isArray(snapshot[store]) ? snapshot[store] : [])
                        .filter((row) => {
                            try { validateEntityRow(store, row); return true; }
                            catch (error) {
                                if (error instanceof AppDataError && error.code === 'CORRUPT_RECORD') return false;
                                throw error;
                            }
                        });
                    result[store] = options.withMeta
                        ? clone(validRows)
                        : validRows.map((row) => clone(row.data));
                }
                return result;
            }
            catch (error) { if (error instanceof AppDataError) throw error; throw this._latch(error); }
        }
        async listEntities(store, options = {}) {
            this._assertReady(); store = entityStore(store);
            if (store !== 'practiceSummaries') throw validation('Only practiceSummaries supports listEntities; load details and annotations by recordId');
            try {
                const rows = await this.driver.listEntities(store);
                const validRows = rows.filter((row) => {
                    try { validateEntityRow(store, row); return true; }
                    catch (error) {
                        if (error instanceof AppDataError && error.code === 'CORRUPT_RECORD') return false;
                        throw error;
                    }
                });
                return options.withMeta ? clone(validRows) : validRows.map((row) => clone(row.data));
            }
            catch (error) { if (error instanceof AppDataError) throw error; throw this._latch(error); }
        }
        async mutateEntities(operations, options = {}) {
            this._assertReady(); if (!Array.isArray(operations) || !operations.length) throw validation('mutateEntities requires operations');
            const opId = operationId(options.operationId); const items = operations.map(normalizeEntityOperation); const seen = new Set();
            for (const item of items) { const key = `${item.store}/${item.recordId || '*'}`; if (seen.has(key)) throw validation(`Duplicate entity operation: ${key}`); seen.add(key); }
            for (const store of ENTITY_STORES) {
                const scoped = items.filter((item) => item.store === store);
                if (scoped.some((item) => item.type === 'clear') && scoped.length > 1) {
                    throw validation(`Entity clear cannot be combined with other operations for ${store}`);
                }
            }
            const warnings = options.warnings === undefined ? [] : canonicalizeJson(options.warnings, '$.warnings');
            if (!Array.isArray(warnings) || warnings.some((item) => typeof item !== 'string')) throw validation('warnings must be an array of strings');
            const spec = { operationId: opId, warnings, pending: [], fingerprint: checksum({ operations: items, warnings }), stores: Array.from(new Set([SYSTEM_STORE].concat(items.map((item) => item.store)))) };
            try {
                const receipt = await this.driver.atomic(Object.assign(spec, { apply: (tx, journalRow, journal, done, fail) => {
                    const replay = journalResult(journal, spec); if (replay) { done(replay); return; }
                    const reads = items.filter((item) => item.type !== 'clear').map((item) => ({ item, request: tx.objectStore(item.store).get(item.recordId) })); let remaining = reads.length;
                    const finish = () => { const revisions = {};
                        for (const read of reads) { const current = read.request.result || null; const revision = current ? Number(current.revision) : 0;
                            if (read.item.expectedRevision !== null && read.item.expectedRevision !== revision) throw new AppDataError('CONFLICT', `Revision conflict for ${read.item.store}/${read.item.recordId}`);
                            const key = `${read.item.store}/${read.item.recordId}`; if (read.item.type === 'delete') { tx.objectStore(read.item.store).delete(read.item.recordId); revisions[key] = revision + 1; } else { const next = { recordId: read.item.recordId, revision: revision + 1, operationId: spec.operationId, updatedAt: nowIso(), data: read.item.data }; next.checksum = checksum(next.data); tx.objectStore(read.item.store).put(next); revisions[key] = next.revision; }
                        }
                        for (const item of items.filter((item) => item.type === 'clear')) { tx.objectStore(item.store).clear(); revisions[`${item.store}/*`] = 0; }
                        const receipt = receiptFor(spec.operationId, revisions, warnings, []); putJournal(tx, journalRow, journal, spec, receipt); done(receipt); };
                    if (!remaining) { try { finish(); } catch (error) { fail(error); } return; }
                    for (const read of reads) { read.request.onerror = () => fail(read.request.error || new Error('Entity mutation read failed')); read.request.onsuccess = () => { remaining -= 1; if (!remaining) { try { finish(); } catch (error) { fail(error); } } }; }
                } }));
                this._notifyCommitted(items.map((item) => ({ store: item.store, recordId: item.recordId, type: item.type })), receipt); return receipt;
            } catch (error) { if (error instanceof AppDataError && (error.code === 'VALIDATION' || error.code === 'CONFLICT' || error.code === 'CORRUPT_RECORD')) throw error; throw this._latch(error); }
        }
        async exportSnapshot(options = {}) {
            this._assertReady();
            try {
                const selected = Array.isArray(options.logicalKeys) ? new Set(options.logicalKeys.map((key) => String(key))) : null;
                const shouldExport = (logicalKey) => {
                    if (!catalog.has(logicalKey)) return false;
                    const entry = lookupEntry(logicalKey);
                    if (selected && !selected.has(logicalKey)) return false;
                    if (entry.export === true) return true;
                    return options.includeSystem === true && entry.classification === 'system';
                };
                const data = await this.driver.exportSnapshot(shouldExport);
                // Full/partial snapshots must be dense for their declared catalog
                // range. An absent physical row means the catalog default, not an
                // instruction that future importers should guess about.
                for (const entry of catalog.list()) {
                    if (!shouldExport(entry.logicalKey)
                        || Object.prototype.hasOwnProperty.call(data.envelopes, entry.logicalKey)) continue;
                    data.envelopes[entry.logicalKey] = makeEnvelope(entry, null, {
                        state: 'cleared',
                        operationId: 'snapshot-default'
                    });
                }
                if (Array.isArray(options.entityStores)) {
                    const selectedStores = new Set(options.entityStores.map(entityStore));
                    for (const store of ENTITY_STORES) if (!selectedStores.has(store)) delete data.entities[store];
                }
                const payload = { envelopes: data.envelopes, entities: data.entities };
                return { format: 'ielts-atlas-data-v2', schemaVersion: catalog.version, scope: selected ? 'partial' : 'full', createdAt: nowIso(), backend: this.backend, envelopes: data.envelopes, entities: data.entities, checksum: checksum(payload) };
            } catch (error) { if (error instanceof AppDataError) throw error; throw this._latch(error); }
        }
        async installSnapshot(snapshot, options = {}) {
            this._assertReady(); const source = snapshot && snapshot.envelopes ? snapshot : { envelopes: snapshot, entities: {} };
            const envelopes = canonicalizeJson(source.envelopes, '$.envelopes'); const entities = canonicalizeJson(source.entities || {}, '$.entities');
            if (!envelopes || typeof envelopes !== 'object' || Array.isArray(envelopes) || !entities || typeof entities !== 'object' || Array.isArray(entities)) throw validation('Snapshot is invalid');
            if (source.checksum && source.checksum !== checksum({ envelopes, entities })) throw validation('Snapshot checksum mismatch');
            const changes = [];
            for (const [logicalKey, envelope] of Object.entries(envelopes)) {
                const entry = lookupEntry(logicalKey);
                if (entry.classification === 'system' || entry.classification === 'session' || entry.import === 'ignore') continue;
                if (!validateEnvelope(entry, envelope)) throw validation(`Invalid snapshot envelope: ${logicalKey}`);
                changes.push({ logicalKey, entry, envelope });
            }
            const entityRows = {};
            for (const store of ENTITY_STORES) {
                if (!Object.prototype.hasOwnProperty.call(entities, store)) continue;
                const rows = entities[store];
                if (!Array.isArray(rows)) throw validation(`Invalid snapshot entities: ${store}`);
                const ids = new Set();
                entityRows[store] = rows.map((row) => {
                    if (!row || typeof row !== 'object' || !String(row.recordId || '')) throw validation(`Invalid snapshot entity: ${store}`);
                    const recordId = String(row.recordId);
                    if (ids.has(recordId)) throw validation(`Duplicate snapshot entity: ${store}/${recordId}`);
                    ids.add(recordId);
                    const data = canonicalizeJson(row.data);
                    if (!row.checksum || row.checksum !== checksum(data)) throw validation(`Invalid snapshot entity checksum: ${store}/${recordId}`);
                    const revision = row.revision === undefined ? 1 : Number(row.revision);
                    if (!Number.isInteger(revision) || revision < 1) throw validation(`Invalid snapshot entity revision: ${store}/${recordId}`);
                    return { recordId, revision, operationId: String(row.operationId || options.operationId || 'snapshot'), updatedAt: String(row.updatedAt || nowIso()), data, checksum: checksum(data) };
                });
            }
            if (!changes.length && !Object.keys(entityRows).length) throw validation('Snapshot contains no importable data');
            const resetJournal = options.resetJournal === true;
            const expectedRevisionToken = options.expectedRevisionToken && typeof options.expectedRevisionToken === 'object'
                ? canonicalizeJson(options.expectedRevisionToken, '$.expectedRevisionToken')
                : null;
            const opId = operationId(options.operationId || randomId('restore')); const spec = { operationId: opId, warnings: [], pending: [], fingerprint: checksum({ envelopes: changes.map((item) => [item.logicalKey, item.envelope]), entities: entityRows, resetJournal, expectedRevisionToken }), stores: STORE_NAMES.slice() };
            try {
                const receipt = await this.driver.atomic(Object.assign(spec, { apply: (tx, journalRow, journal, done, fail) => {
                    const replay = journalResult(journal, spec); if (replay) { done(replay); return; }
                    const documentChecks = expectedRevisionToken && expectedRevisionToken.documents || {};
                    const entityChecks = expectedRevisionToken && expectedRevisionToken.entities || {};
                    const reads = Object.entries(documentChecks).map(([logicalKey, expected]) => ({
                        kind: 'document', logicalKey, expected, request: tx.objectStore(DOCUMENT_STORE).get(logicalKey)
                    })).concat(Object.entries(entityChecks).map(([store, expected]) => ({
                        kind: 'entities', store, expected, request: tx.objectStore(store).getAll()
                    })));
                    const finish = () => {
                        for (const read of reads) {
                            if (read.kind === 'document') {
                                const current = read.request.result ? read.request.result.envelope : null;
                                const actualRevision = current ? Number(current.revision) : 0;
                                const expectedRevision = Number(read.expected) || 0;
                                if (actualRevision !== expectedRevision) {
                                    throw new AppDataError('CONFLICT', `Snapshot revision conflict for ${read.logicalKey}`, { logicalKey: read.logicalKey, expectedRevision, actualRevision });
                                }
                            } else {
                                const actual = Object.fromEntries((read.request.result || []).map((row) => [String(row.recordId), Number(row.revision) || 0]));
                                const expected = read.expected && typeof read.expected === 'object' ? read.expected : {};
                                const ids = new Set(Object.keys(actual).concat(Object.keys(expected)));
                                for (const recordId of ids) {
                                    const current = actual[recordId] || 0;
                                    const wanted = Number(expected[recordId]) || 0;
                                    if (current !== wanted) {
                                        throw new AppDataError('CONFLICT', `Snapshot revision conflict for ${read.store}/${recordId}`, { store: read.store, recordId });
                                    }
                                }
                            }
                        }
                        const revisions = {};
                        for (const item of changes) { tx.objectStore(DOCUMENT_STORE).put({ logicalKey: item.logicalKey, envelope: makeEnvelope(item.entry, item.envelope.data, { state: item.envelope.state, revision: item.envelope.revision, operationId: spec.operationId, normalized: true }) }); revisions[item.logicalKey] = Number(item.envelope.revision); }
                        for (const [store, rows] of Object.entries(entityRows)) {
                            tx.objectStore(store).clear();
                            for (const row of rows) tx.objectStore(store).put(row);
                        }
                        const receipt = receiptFor(spec.operationId, revisions, [], []); putJournal(tx, journalRow, resetJournal ? {} : journal, spec, receipt); done(receipt);
                    };
                    if (!reads.length) { try { finish(); } catch (error) { fail(error); } return; }
                    let remaining = reads.length;
                    for (const read of reads) {
                        read.request.onerror = () => fail(read.request.error || new Error('Snapshot revalidation read failed'));
                        read.request.onsuccess = () => { remaining -= 1; if (!remaining) { try { finish(); } catch (error) { fail(error); } } };
                    }
                } }));
                const targets = changes
                    .filter((item) => item.entry.owner !== 'backups')
                    .map((item) => ({ logicalKey: item.logicalKey, state: item.envelope.state, owner: item.entry.owner, classification: item.entry.classification }))
                    .concat(Object.keys(entityRows).map((store) => ({ store, recordId: null, type: 'replace' })));
                this._notifyCommitted(targets, receipt);
                return receipt;
            }
            catch (error) { if (error instanceof AppDataError && (error.code === 'VALIDATION' || error.code === 'CONFLICT' || error.code === 'CORRUPT_RECORD')) throw error; throw this._latch(error); }
        }
        status() { return Object.freeze({ state: this.state, backend: this.backend, failure: this.failure ? this.failure.message : null }); }
    }

    Object.defineProperty(global, '__AppDataV2Internals', { value: { catalog, DataKernel, AppDataError, makeEnvelope, validateEnvelope, checksum, stableStringify, canonicalizeJson, clone, randomId, nowIso, parseLegacyValue, readLegacyValues, readLegacyExternalBackup, constants: Object.freeze({ DATABASE_NAME, DATABASE_VERSION, DOCUMENT_STORE, SYSTEM_STORE, ENTITY_STORES, OPERATION_JOURNAL_WINDOW }) }, enumerable: false, configurable: true, writable: false });
})(typeof window !== 'undefined' ? window : globalThis);
