/* Always-on local JSON persistence. IndexedDB is a disposable projection. */
(function installFileJournal(global) {
    'use strict';
    if (global.FileJournal) return;
    const FORMAT = 'ielts-atlas-local-journal';
    const VERSION = 1;
    const DIRECTORY = 'ielts-atlas-local-v1';
    const LOCK = 'ielts-atlas-local-journal-v1';
    const CACHE_KEY = '__fileJournalCache';
    const BINDING_DB = 'IELTSAtlasLocalFilesV1';
    const STORES = ['documents', 'system', 'practiceSummaries', 'practiceDetails', 'practiceAnnotations'];
    const keyOf = (store, row) => row[store === 'documents' || store === 'system' ? 'logicalKey' : 'recordId'];
    const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const empty = () => Object.fromEntries(STORES.map(store => [store, new Map()]));
    const rowsOf = tables => Object.fromEntries(STORES.map(store => [store, [...tables[store].values()].sort((a, b) => {
        const left = keyOf(store, a), right = keyOf(store, b);
        return left < right ? -1 : left > right ? 1 : 0;
    })]));
    const uid = () => global.crypto.randomUUID();
    let activeDriver = null;
    let storageStatus = { backend: 'initializing', readPath: null, cache: 'unavailable' };

    function problem(message, code = 'FILE_STORAGE_UNAVAILABLE') {
        const error = new Error(message); error.code = code; return error;
    }
    async function digest(text) {
        const bytes = await global.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
    }
    function locked(work) {
        if (!global.navigator?.locks?.request) throw problem('本地文件保存需要 Web Locks，请通过固定 localhost 地址打开。');
        return global.navigator.locks.request(LOCK, { mode: 'exclusive' }, work);
    }
    async function binding(value) {
        if (!global.indexedDB) return null;
        const db = await new Promise((resolve, reject) => {
            const request = global.indexedDB.open(BINDING_DB, 1);
            request.onupgradeneeded = () => request.result.createObjectStore('handles');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        try {
            return await new Promise((resolve, reject) => {
                const tx = db.transaction('handles', value === undefined ? 'readonly' : 'readwrite');
                const request = value === undefined ? tx.objectStore('handles').get('local') : tx.objectStore('handles').put(value, 'local');
                tx.oncomplete = () => resolve(value === undefined ? request.result : value);
                tx.onabort = tx.onerror = () => reject(tx.error);
            });
        } finally { db.close(); }
    }
    // This prompt belongs to local storage, independently of the optional sync UI.
    function requestDirectory(saved) {
        if (!global.document) throw problem('OPFS 不可用，需要连接本地数据目录。');
        storageStatus = { ...storageStatus, backend: 'needs-directory' };
        return new Promise((resolve, reject) => {
            const show = () => {
                const dialog = global.document.createElement('dialog');
                dialog.id = 'local-file-storage-dialog';
                dialog.setAttribute('aria-labelledby', 'local-file-storage-title');
                dialog.style.cssText = 'max-width:32rem;padding:1.5rem;border-radius:12px;z-index:2147483647';
                const title = global.document.createElement('h2');
                title.id = 'local-file-storage-title'; title.textContent = '连接本地数据目录';
                const message = global.document.createElement('p');
                message.textContent = '当前打开方式无法使用浏览器私有文件。请选择专用的本地目录保存练习数据；之后的保存会自动写入。这个目录与可选的 OneDrive 同步目录分开。也可以通过固定 localhost 地址打开以使用私有文件。';
                const button = global.document.createElement('button');
                button.textContent = saved ? '恢复目录访问' : '选择本地数据目录';
                const errorText = global.document.createElement('p'); errorText.setAttribute('role', 'alert');
                dialog.append(title, message, button, errorText);
                dialog.addEventListener('cancel', event => event.preventDefault());
                button.addEventListener('click', async () => {
                    try {
                        // Both permission methods must start inside this user gesture.
                        const handle = saved ? (await saved.requestPermission({ mode: 'readwrite' }) === 'granted' ? saved : null)
                            : await global.showDirectoryPicker({ id: 'ielts-atlas-local-data', mode: 'readwrite' });
                        if (!handle) throw problem('未获得目录写入权限，请重试。');
                        const root = await handle.getDirectoryHandle(DIRECTORY, { create: true });
                        await binding(handle);
                        dialog.close(); dialog.remove(); resolve({ root, backend: 'directory-json', handle });
                    } catch (error) { errorText.textContent = error.name === 'AbortError' ? '尚未选择目录，数据保存还未启用。' : error.message; }
                });
                if (typeof global.showDirectoryPicker !== 'function') {
                    button.disabled = true;
                    errorText.textContent = '当前浏览器不能连接目录。请使用固定 localhost 地址，或桌面 Chrome / Edge。';
                    reject(problem(errorText.textContent));
                }
                global.document.body.append(dialog); dialog.showModal();
            };
            if (global.document.body) show(); else global.document.addEventListener('DOMContentLoaded', show, { once: true });
        });
    }
    async function directory() {
        // Once a visible directory is selected, never silently switch authorities.
        let saved, bindingFailure;
        try { saved = await binding(); } catch (error) { bindingFailure = error; }
        if (saved) {
            if (await saved.queryPermission({ mode: 'readwrite' }) !== 'granted') return requestDirectory(saved);
            return { root: await saved.getDirectoryHandle(DIRECTORY, { create: true }), backend: 'directory-json', handle: saved };
        }
        try {
            const root = await global.navigator.storage.getDirectory();
            const local = await root.getDirectoryHandle(DIRECTORY, { create: true });
            // An established OPFS journal works without IndexedDB. On a first
            // launch we still need to establish that no saved directory or old
            // database is being abandoned before creating an empty authority.
            if (bindingFailure && !await readHead(local)) throw problem('无法确认旧数据目录，请恢复浏览器数据库访问后重试。');
            return { root: local, backend: 'opfs-json', handle: null };
        } catch (error) {
            // Quota/device failures must not create a second empty authority.
            if (!['SecurityError', 'NotSupportedError', 'TypeError'].includes(error.name)) throw error;
            return requestDirectory(null);
        }
    }
    async function readText(root, name) { return (await (await root.getFileHandle(name)).getFile()).text(); }
    async function writeText(root, name, text) {
        const handle = await root.getFileHandle(name, { create: true });
        const writer = await handle.createWritable({ mode: 'exclusive' });
        try { await writer.write(text); await writer.close(); }
        catch (error) { try { await writer.abort(); } catch (_) {} throw error; }
        if (await readText(root, name) !== text) throw problem('本地文件回读校验失败：' + name, 'CORRUPT_RECORD');
    }
    async function readHead(root) {
        let text;
        try { text = await readText(root, 'head.json'); }
        catch (error) { if (error.name === 'NotFoundError') return null; throw error; }
        const envelope = JSON.parse(text), head = envelope.head;
        if (!head || head.format !== FORMAT || head.version !== VERSION || envelope.sha256 !== await digest(JSON.stringify(head))
            || typeof head.workspaceId !== 'string' || !Number.isSafeInteger(head.sequence) || head.sequence < 0
            || !Array.isArray(head.tail) || head.tail.length > 128 || !head.snapshot) {
            throw problem('本地数据清单损坏或版本不受支持，已停止写入。', 'CORRUPT_RECORD');
        }
        return { ...head, token: envelope.sha256 };
    }
    async function publishHead(root, value) {
        const head = { ...value }; delete head.token;
        const sha256 = await digest(JSON.stringify(head));
        try { await writeText(root, 'head.json', JSON.stringify({ head, sha256 }) + '\n'); }
        catch (error) {
            // close() can have committed even when a subsequent read failed. Never
            // report a false rollback if the committed frontier can be verified.
            try { if ((await readHead(root))?.token === sha256) return { ...head, token: sha256 }; } catch (_) {}
            throw error;
        }
        return { ...head, token: sha256 };
    }
    async function writePart(root, kind, sequence, payload) {
        const name = `${kind}-${String(sequence).padStart(12, '0')}-${uid()}.${kind === 'ops' ? 'jsonl' : 'json'}`;
        const text = JSON.stringify(payload) + '\n';
        const sha256 = await digest(text);
        await writeText(root, name, text);
        return { name, sha256, sequence };
    }
    async function readPart(root, part) {
        if (!part || !/^(snapshot|ops)-\d{12,}-[a-f\d-]+\.(json|jsonl)$/.test(part.name)
            || !Number.isSafeInteger(part.sequence) || part.sequence < 0) throw problem('无效的本地数据分段。', 'CORRUPT_RECORD');
        const text = await readText(root, part.name);
        if (await digest(text) !== part.sha256) throw problem('本地数据分段不完整或校验失败：' + part.name, 'CORRUPT_RECORD');
        const value = JSON.parse(text);
        if (value.format !== FORMAT || value.version !== VERSION || value.sequence !== part.sequence) throw problem('本地数据分段版本不受支持。', 'CORRUPT_RECORD');
        return value;
    }
    function tablesFrom(rows) {
        const tables = empty();
        for (const store of STORES) {
            if (!Array.isArray(rows[store])) throw problem('本地快照缺少数据表。', 'CORRUPT_RECORD');
            for (const row of rows[store]) {
                const key = row && keyOf(store, row);
                if (typeof key !== 'string' || tables[store].has(key)) throw problem('本地快照包含无效或重复记录。', 'CORRUPT_RECORD');
                tables[store].set(key, row);
            }
        }
        return tables;
    }
    function applyChanges(tables, changes) {
        if (!Array.isArray(changes)) throw problem('本地事务缺少变更。', 'CORRUPT_RECORD');
        for (const change of changes) {
            if (!STORES.includes(change.store)) throw problem('本地事务包含未知数据表。', 'CORRUPT_RECORD');
            const table = tables[change.store];
            if (change.type === 'clear') table.clear();
            else if (change.type === 'delete' && typeof change.key === 'string') table.delete(change.key);
            else if (change.type === 'put' && typeof keyOf(change.store, change.row) === 'string') table.set(keyOf(change.store, change.row), change.row);
            else throw problem('本地事务变更无效。', 'CORRUPT_RECORD');
        }
    }
    // Execute the existing kernel's transaction callbacks against private staged
    // maps. A failed request or callback discards the entire transaction.
    function stage(tables, stores, writable, work) {
        return new Promise((resolve, reject) => {
            const next = { ...tables }, changes = [];
            if (writable) for (const store of stores) next[store] = new Map(tables[store]);
            let pending = 0, value, stopped = false;
            const fail = error => { if (!stopped) { stopped = true; reject(error); } };
            const finish = () => { if (!stopped && pending === 0) { stopped = true; resolve({ tables: next, changes, value }); } };
            const request = callback => {
                const result = {}; pending++;
                queueMicrotask(() => {
                    if (stopped) return;
                    try { result.result = clone(callback()); result.onsuccess?.({ target: result }); }
                    catch (error) { result.error = error; fail(error); }
                    pending--; queueMicrotask(finish);
                });
                return result;
            };
            const change = (store, item) => {
                if (!writable) throw problem('Read-only transaction');
                changes.push({ store, ...clone(item) });
            };
            const tx = {
                abort() { fail(problem('Local transaction aborted')); },
                objectStore(store) {
                    if (!stores.includes(store)) throw problem('Store not in transaction: ' + store);
                    return {
                        get: key => request(() => next[store].get(key)),
                        getAll: () => request(() => [...next[store].values()]),
                        put: row => {
                            const saved = clone(row);
                            return request(() => { change(store, { type: 'put', row: saved }); next[store].set(keyOf(store, saved), saved); return keyOf(store, saved); });
                        },
                        delete: key => request(() => { change(store, { type: 'delete', key }); next[store].delete(key); }),
                        clear: () => request(() => { change(store, { type: 'clear' }); next[store].clear(); })
                    };
                }
            };
            try { work(tx, result => { value = result; }, fail); queueMicrotask(finish); }
            catch (error) { fail(error); }
        });
    }

    function driverClass(IndexedDBDriver) {
        return class FileJournalDriver extends IndexedDBDriver {
            constructor(indexedDB, options) {
                super(indexedDB, options);
                // Fence pre-file releases before importing their rows: their v2
                // connections close on versionchange and cannot reopen at v2.
                // Otherwise an old tab could keep writing only to the cache.
                this.cache = new IndexedDBDriver(indexedDB, { ...options, databaseVersion: 3 });
                this.tables = null; this.head = null; this.closed = false;
                this.cacheToken = null;
            }
            async initialize() {
                const chosen = await directory();
                this.root = chosen.root; this.backend = chosen.backend; this.directoryHandle = chosen.handle;
                await locked(async () => {
                    const head = await readHead(this.root);
                    // The first import must be complete. A failed legacy DB read
                    // cannot be mistaken for a new, empty installation.
                    if (!head) {
                        for await (const _ of this.root.keys()) throw problem('本地清单缺失但仍有数据文件，请恢复清单后重试。', 'CORRUPT_RECORD');
                        await this.cache.initialize();
                        if (await this.cacheMarker()) throw problem('本地文件已移除，不能用旧缓存替代已提交的数据。请恢复本地文件或备份。', 'CORRUPT_RECORD');
                        const rows = await this.cacheRows();
                        this.tables = tablesFrom(rows);
                        const workspaceId = uid();
                        const snapshot = await writePart(this.root, 'snapshot', 0, {
                            format: FORMAT, version: VERSION, workspaceId, sequence: 0, rows
                        });
                        this.head = await publishHead(this.root, { format: FORMAT, version: VERSION, workspaceId, sequence: 0, snapshot, tail: [] });
                    } else {
                        try { await this.cache.initialize(); } catch (_) { this.cache.close(); }
                        await this.refresh(head);
                    }
                    await this.project();
                });
                activeDriver = this;
                storageStatus = { ...storageStatus, backend: this.backend, sequence: this.head.sequence };
                return this;
            }
            close() { this.closed = true; this.cache.close(); this.tables = null; }
            cacheMarker() {
                return this.cache._transaction(['documents'], 'readonly', 'read file cache frontier', (tx, done, fail) => {
                    const request = tx.objectStore('documents').get(CACHE_KEY);
                    request.onsuccess = () => done(request.result?.envelope || null);
                    request.onerror = () => fail(request.error);
                });
            }
            cacheRows() {
                return this.cache._transaction(STORES, 'readonly', 'read file cache', (tx, done, fail) => {
                    const rows = {}; let pending = STORES.length;
                    for (const store of STORES) {
                        const request = tx.objectStore(store).getAll();
                        request.onerror = () => fail(request.error);
                        request.onsuccess = () => { rows[store] = request.result.filter(row => store !== 'documents' || row.logicalKey !== CACHE_KEY); if (!--pending) done(rows); };
                    }
                });
            }
            async refresh(knownHead) {
                const head = knownHead || await readHead(this.root);
                if (!head) throw problem('本地数据文件已移除，请重新打开应用。');
                if (this.head && head.workspaceId !== this.head.workspaceId) throw problem('本地数据已重置，请重新打开应用。');
                if (this.head && head.sequence < this.head.sequence) throw problem('本地文件版本发生回退，已停止读写。', 'CORRUPT_RECORD');
                if (this.head?.token === head.token && this.tables) { storageStatus.readPath = 'memory'; return; }
                if (!this.tables && this.cache.db) {
                    try {
                        const marker = await this.cacheMarker();
                        if (marker?.token === head.token) {
                            const rows = await this.cacheRows();
                            if (await digest(JSON.stringify(rows)) === marker.rowsHash) {
                                this.tables = tablesFrom(rows); this.head = head; this.cacheToken = head.token;
                                storageStatus.readPath = 'indexeddb'; return;
                            }
                        }
                    } catch (_) { /* Rebuild from verified files. */ }
                }
                let tables, sequence;
                if (this.tables && this.head && this.head.sequence >= head.snapshot.sequence && this.head.sequence <= head.sequence
                    && head.tail.some(part => part.sequence === this.head.sequence + 1)) {
                    tables = Object.fromEntries(STORES.map(store => [store, new Map(this.tables[store])]));
                    sequence = this.head.sequence;
                } else {
                    const snapshot = await readPart(this.root, head.snapshot);
                    if (snapshot.workspaceId !== head.workspaceId) throw problem('本地快照所属空间无效。', 'CORRUPT_RECORD');
                    tables = tablesFrom(snapshot.rows); sequence = snapshot.sequence;
                }
                for (const part of head.tail) {
                    if (part.sequence <= sequence) continue;
                    if (part.sequence !== sequence + 1) throw problem('本地事务日志缺少分段。', 'CORRUPT_RECORD');
                    const transaction = await readPart(this.root, part);
                    if (transaction.workspaceId !== head.workspaceId || transaction.previousSequence !== sequence) throw problem('本地事务因果版本无效。', 'CORRUPT_RECORD');
                    applyChanges(tables, transaction.changes); sequence = transaction.sequence;
                }
                if (sequence !== head.sequence) throw problem('本地文件版本不完整。', 'CORRUPT_RECORD');
                this.tables = tables; this.head = head; storageStatus.readPath = 'json';
            }
            async project(changes) {
                if (!this.cache.db) { storageStatus.cache = 'unavailable'; return; }
                try {
                    const rows = rowsOf(this.tables);
                    const marker = { token: this.head.token, rowsHash: await digest(JSON.stringify(rows)) };
                    // Both rows and the frontier marker move in one cache transaction.
                    await this.cache._transaction(STORES, 'readwrite', 'project local files', (tx, done) => {
                        if (!changes || this.cacheToken === null) {
                            for (const store of STORES) { tx.objectStore(store).clear(); for (const row of rows[store]) tx.objectStore(store).put(row); }
                        } else for (const item of changes) {
                            const store = tx.objectStore(item.store);
                            if (item.type === 'clear') store.clear();
                            else if (item.type === 'delete') store.delete(item.key);
                            else store.put(item.row);
                        }
                        tx.objectStore('documents').put({ logicalKey: CACHE_KEY, envelope: marker }); done(true);
                    }, true);
                    this.cacheToken = this.head.token; storageStatus.cache = 'current';
                } catch (_) {
                    this.cache.close(); this.cacheToken = null; storageStatus.cache = 'unavailable';
                    // Files are committed. A projection failure is not a failed save.
                }
            }
            async _transaction(stores, mode, description, work) {
                return locked(async () => {
                    if (this.closed) throw problem('本地文件连接已关闭，请重新打开应用。');
                    const previousCache = this.cacheToken;
                    await this.refresh();
                    if (previousCache !== this.head.token) this.cacheToken = null;
                    const staged = await stage(this.tables, stores, mode === 'readwrite', work);
                    if (staged.changes.length) {
                        const sequence = this.head.sequence + 1;
                        if (!Number.isSafeInteger(sequence)) throw problem('本地事务序号超出范围。');
                        const part = await writePart(this.root, 'ops', sequence, {
                            format: FORMAT, version: VERSION, workspaceId: this.head.workspaceId,
                            sequence, previousSequence: this.head.sequence, description, changes: staged.changes
                        });
                        let snapshot = this.head.snapshot, tail = [...this.head.tail, part];
                        if (tail.length >= 128) {
                            snapshot = await writePart(this.root, 'snapshot', sequence, {
                                format: FORMAT, version: VERSION, workspaceId: this.head.workspaceId, sequence, rows: rowsOf(staged.tables)
                            });
                            tail = [];
                        }
                        const committed = await publishHead(this.root, { ...this.head, sequence, snapshot, tail });
                        this.tables = staged.tables; this.head = committed;
                        storageStatus.sequence = sequence;
                        await this.project(staged.changes);
                    }
                    return clone(staged.value);
                });
            }
            resetBarrier(active) {
                const model = global.FolderSyncModel;
                return this._transaction(['system'], 'readwrite', 'reset barrier', (tx, done, fail) => {
                    const store = tx.objectStore('system'), request = store.get(model.STATE_KEY);
                    request.onerror = () => fail(request.error);
                    request.onsuccess = () => {
                        const state = request.result?.envelope?.data;
                        if (active) store.put({ logicalKey: model.RESET_KEY, active: true }); else store.delete(model.RESET_KEY);
                        done(state ? model.status(state) : { enabled: false, pending: 0 });
                    };
                });
            }
            async resetLocal() {
                return locked(async () => {
                    const workspaceId = uid();
                    const snapshot = await writePart(this.root, 'snapshot', 0, { format: FORMAT, version: VERSION, workspaceId, sequence: 0, rows: rowsOf(empty()) });
                    await publishHead(this.root, { format: FORMAT, version: VERSION, workspaceId, sequence: 0, snapshot, tail: [] });
                    this.close();
                    // External histories remain recoverable. Private files are removed
                    // only after the new empty frontier prevents stale-cache imports.
                    if (this.backend === 'opfs-json') {
                        for await (const name of this.root.keys()) if (name !== 'head.json' && name !== snapshot.name) await this.root.removeEntry(name);
                    }
                });
            }
        };
    }
    global.FileJournal = Object.freeze({
        driverClass, directoryName: DIRECTORY, bindingDatabase: BINDING_DB,
        status: () => ({ ...storageStatus }),
        async resetBarrier(active) { await global.AppData.ready; return activeDriver.resetBarrier(active); },
        async resetLocal() { if (activeDriver) await activeDriver.resetLocal(); },
        async isLocalDirectory(handle) {
            const local = activeDriver?.directoryHandle;
            if (!local) return false;
            return await local.isSameEntry(handle) || await local.resolve(handle) !== null || await handle.resolve(local) !== null;
        }
    });
})(typeof window !== 'undefined' ? window : globalThis);
