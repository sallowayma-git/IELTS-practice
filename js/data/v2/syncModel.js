/* Portable folder-sync protocol. No filesystem, timers, or database access. */
(function installFolderSyncModel(global) {
    'use strict';
    if (global.FolderSyncModel) return;
    // This branch has the legacy vocabulary schema. Do not accept newer static-edition spaces.
    const FORMAT = 'ielts-atlas-folder-sync-multidevice';
    const VERSION = 1;
    const STATE_KEY = 'system.folderSync';
    const STORES = ['practiceSummaries', 'practiceDetails', 'practiceAnnotations'];
    const DOCUMENT_KEYS = ['vocab.words', 'vocab.lists',
        'vocab.userConfig', 'library.configurations', 'library.importedIndexes', 'goals.items',
        'achievements.manual', 'preferences.values'];
    const copy = value => JSON.parse(JSON.stringify(value));
    const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
    const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
    const absent = () => ({ exists: false });
    const present = value => ({ exists: true, value: copy(value) });
    function fail(message) { const error = new Error(message); error.code = 'VALIDATION'; throw error; }
    function stable(value) {
        if (value === null || typeof value !== 'object') return JSON.stringify(value);
        if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
        return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
    }
    const equal = (left, right) => stable(left) === stable(right);
    function safeJson(value, depth = 0) {
        if (depth > 90) fail('同步数据嵌套过深');
        if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
        if (typeof value === 'number' && Number.isFinite(value)) return;
        if (!value || typeof value !== 'object') fail('同步数据不是有效 JSON');
        for (const key of Object.keys(value)) {
            if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('同步数据包含不安全的属性');
            safeJson(value[key], depth + 1);
        }
    }
    function identifier(value) { return typeof value === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(value); }
    function uuid() {
        if (!global.crypto || typeof global.crypto.randomUUID !== 'function') fail('当前环境不支持安全的同步身份生成，请使用 Chrome / Edge 或 localhost');
        return global.crypto.randomUUID();
    }
    // SHA-256 over canonical UTF-8 JSON, synchronous so it can run inside IDB transactions.
    function digest(value) {
        const bytes = new TextEncoder().encode(stable(value));
        const length = Math.ceil((bytes.length + 9) / 64) * 64;
        const padded = new Uint8Array(length); padded.set(bytes); padded[bytes.length] = 128;
        const view = new DataView(padded.buffer);
        view.setUint32(length - 8, Math.floor(bytes.length / 0x20000000));
        view.setUint32(length - 4, (bytes.length * 8) >>> 0);
        const primes = []; const h = []; const k = [];
        for (let number = 2; primes.length < 64; number++) {
            if (primes.some(prime => number % prime === 0)) continue;
            primes.push(number);
            if (h.length < 8) h.push((Math.sqrt(number) % 1 * 0x100000000) | 0);
            k.push((Math.cbrt(number) % 1 * 0x100000000) | 0);
        }
        const rotate = (word, bits) => (word >>> bits) | (word << (32 - bits));
        const words = new Int32Array(64);
        for (let offset = 0; offset < length; offset += 64) {
            for (let i = 0; i < 64; i++) {
                if (i < 16) words[i] = view.getInt32(offset + i * 4);
                else {
                    const a = words[i - 15], b = words[i - 2];
                    words[i] = (words[i - 16] + (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3))
                        + words[i - 7] + (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10))) | 0;
                }
            }
            let [a, b, c, d, e, f, g, hh] = h;
            for (let i = 0; i < 64; i++) {
                const t1 = (hh + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25))
                    + ((e & f) ^ (~e & g)) + k[i] + words[i]) | 0;
                const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
                hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
            }
            [a, b, c, d, e, f, g, hh].forEach((word, i) => { h[i] = (h[i] + word) | 0; });
        }
        return h.map(word => (word >>> 0).toString(16).padStart(8, '0')).join('');
    }
    function clockJoin(clocks) {
        const result = {};
        for (const clock of clocks) for (const [writer, value] of Object.entries(clock || {})) {
            result[writer] = Math.max(result[writer] || 0, value);
        }
        return result;
    }
    const covers = (left, right) => Object.entries(right).every(([writer, n]) => (left[writer] || 0) >= n);
    function valueAt(object, key) { return own(object, key) ? present(object[key]) : absent(); }
    function arrayMap(array) {
        const result = {};
        for (const row of array) {
            const id = plain(row) && (row.id ?? row.key ?? row.articleId ?? row.word ?? row.examId);
            if (id === undefined || own(result, String(id))) return null;
            if (['__proto__', 'constructor', 'prototype'].includes(String(id))) return null;
            result[String(id)] = row;
        }
        return result;
    }
    // Conservative, symmetric three-way merge. Unknown arrays and competing scalars conflict.
    function mergeValue(base, versions, atomic = false) {
        const changed = versions.filter(value => !equal(value, base));
        if (!changed.length) return { value: copy(base), conflict: false };
        if (changed.every(value => equal(value, changed[0]))) return { value: copy(changed[0]), conflict: false };
        if (atomic || changed.some(value => !value.exists)) return { value: copy(base), conflict: true };
        const values = changed.map(value => value.value);
        if (values.every(plain) && (!base.exists || plain(base.value))) {
            const original = base.exists ? base.value : {};
            const keys = [...new Set(Object.keys(original).concat(...values.map(Object.keys)))].sort();
            const merged = {}; let conflict = false;
            for (const key of keys) {
                // Metadata clocks may be combined; learning/SM-2 clocks are deliberately excluded.
                const timestamps = values.map(value => value[key]);
                if (['createdAt', 'updatedAt', 'titleUpdatedAt', 'firstVisitedAt', 'lastVisitedAt'].includes(key)
                    && timestamps.every(value => typeof value === 'string' && Number.isFinite(Date.parse(value)))) {
                    merged[key] = timestamps.sort()[['createdAt', 'firstVisitedAt'].includes(key) ? 0 : timestamps.length - 1];
                    continue;
                }
                const child = mergeValue(valueAt(original, key), values.map(value => valueAt(value, key)),
                    ['practiceSummaries', 'practiceDetails', 'reviewState'].includes(key));
                if (child.value.exists) merged[key] = child.value.value;
                conflict = conflict || child.conflict;
            }
            return { value: present(merged), conflict };
        }
        if (values.every(Array.isArray) && (!base.exists || Array.isArray(base.value))) {
            const maps = values.map(arrayMap), original = arrayMap(base.exists ? base.value : []);
            if (original && maps.every(Boolean)) {
                const merged = mergeValue(present(original), maps.map(present));
                const ids = Object.keys(merged.value.value);
                const order = Object.keys(original).filter(key => own(merged.value.value, key))
                    .concat(ids.filter(key => !own(original, key)).sort());
                return { value: present(order.map(key => merged.value.value[key])), conflict: merged.conflict };
            }
        }
        return { value: copy(base), conflict: true };
    }
    function vocabValue(documents) {
        return { words: documents['vocab.words'] || [], lists: documents['vocab.lists'] || {},
            state: {}, config: documents['vocab.userConfig'] || {} };
    }
    function unitsFrom(snapshot, preferences) {
        const result = {}, docs = snapshot.documents;
        const layers = Object.fromEntries(STORES.map(store => [store, new Map((snapshot.entities[store] || []).map(row => [row.recordId, row.data]))]));
        for (const [id, summary] of layers.practiceSummaries) {
            const bundle = { practiceSummaries: summary };
            for (const store of STORES.slice(1)) {
                if (!layers[store].has(id)) fail('练习记录实体层不完整，无法同步：' + id);
                bundle[store] = layers[store].get(id);
            }
            result['practice/' + id] = present(bundle);
        }
        for (const key of ['goals.items']) for (const row of docs[key] || []) {
            const id = row.id || row.goalId;
            if (!id) fail('同步集合缺少稳定 ID：' + key);
            result[key + '/' + id] = present(row);
        }
        result.vocabulary = present(vocabValue(docs));
        result.libraries = present({ configurations: docs['library.configurations'] || [], indexes: docs['library.importedIndexes'] || {} });
        result.achievements = present(docs['achievements.manual'] || {});
        if (preferences) {
            const selected = {};
            for (const key of ['theme', 'readingDisplay', 'timer']) if (own(docs['preferences.values'] || {}, key)) selected[key] = docs['preferences.values'][key];
            result.preferences = present(selected);
        }
        return result;
    }
    function validUnitKey(key) {
        return ['vocabulary', 'libraries', 'achievements', 'preferences'].includes(key)
            || /^(practice|goals\.items)\/.{1,2000}$/.test(key);
    }
    function validateUnit(key, wrapped) {
        if (!validUnitKey(key) || !plain(wrapped) || typeof wrapped.exists !== 'boolean') fail('不支持的同步实体');
        if (!wrapped.exists) return;
        if (!own(wrapped, 'value')) fail('同步实体缺少内容');
        const value = wrapped.value;
        if (key.startsWith('practice/')) {
            const id = key.slice(9);
            if (!plain(value) || STORES.some(store => !plain(value[store])
                || value[store][store === 'practiceSummaries' ? 'id' : 'recordId'] !== id)) fail('同步练习身份或实体层不匹配');
        } else if (key === 'vocabulary') {
            if (!plain(value) || !Array.isArray(value.words) || !plain(value.lists) || !plain(value.state) || !plain(value.config)) fail('同步词汇格式无效');
            if (Object.keys(value.state).length) fail('当前分支不支持新版精读关系，请使用独立同步空间');
        } else if (key === 'libraries') {
            if (!plain(value) || !Array.isArray(value.configurations) || !plain(value.indexes)) fail('同步题库配置无效');
        } else if (!plain(value)) fail('同步实体格式无效');
    }
    function projection(key, heads) {
        heads.sort((left, right) => left.id.localeCompare(right.id));
        if (heads.length === 1 || heads.every(head => equal(head.value, heads[0].value))) {
            return { value: copy(heads[0].value), conflict: false, viewClock: clockJoin(heads.map(head => head.clock)) };
        }
        const sameBase = heads.every(head => equal(head.base, heads[0].base));
        const base = sameBase ? heads[0].base : absent();
        let merged = sameBase ? mergeValue(base, heads.map(head => head.value))
            : { value: copy(heads[0].value), conflict: true };
        // A conflicting partial merge can violate entity/word relationships. Keep a valid baseline.
        if (merged.conflict) merged.value = base.exists ? copy(base) : copy(heads.find(head => head.value.exists)?.value || heads[0].value);
        try { validateUnit(key, merged.value); }
        catch (_) { merged = { value: copy(heads[0].value), conflict: true }; }
        return { ...merged, viewClock: merged.conflict ? {} : clockJoin(heads.map(head => head.clock)) };
    }
    function installChange(state, change, id) {
        const unit = state.units[change.key] || { heads: [] };
        if (unit.heads.some(head => covers(head.clock, change.clock))) return;
        unit.heads = unit.heads.filter(head => !covers(change.clock, head.clock));
        unit.heads.push({ id, clock: copy(change.clock), value: copy(change.value), base: copy(change.base) });
        Object.assign(unit, projection(change.key, unit.heads));
        state.units[change.key] = unit;
    }
    function newState(spaceId, preferences = false) {
        if (!identifier(spaceId)) fail('数据空间 ID 无效');
        return { version: VERSION, enabled: true, spaceId, writerId: uuid(), seq: 0, preferences,
            units: {}, materialized: {}, pending: [], seen: {}, blocked: {} };
    }
    function assertState(state) {
        if (!state || state.version !== VERSION || !identifier(state.spaceId) || !identifier(state.writerId)
            || !Number.isSafeInteger(state.seq) || !plain(state.units) || !plain(state.materialized)
            || !Array.isArray(state.pending) || !plain(state.seen)) fail('同步状态版本无效，请升级所有电脑上的网页');
    }
    function publish(state, entries, sourceId, resolve = false) {
        if (!entries.length) return;
        // Large first-time histories are independent complete units, not one ever-growing file.
        if (entries.length > 100) {
            for (let offset = 0; offset < entries.length; offset += 100) publish(state, entries.slice(offset, offset + 100), sourceId, resolve);
            return;
        }
        state.seq++;
        if (!Number.isSafeInteger(state.seq)) fail('同步序号已超出范围');
        const id = state.writerId + '-' + String(state.seq).padStart(12, '0');
        const changes = entries.map(([key, value]) => {
            const unit = state.units[key];
            const clock = clockJoin(unit ? (resolve || !unit.conflict ? unit.heads.map(head => head.clock) : [unit.viewClock]) : []);
            clock[state.writerId] = state.seq;
            return { key, value: copy(value), base: copy(state.materialized[key] || absent()), clock };
        });
        const operation = { format: FORMAT, version: VERSION, spaceId: state.spaceId,
            writerId: state.writerId, seq: state.seq, id, sourceId: String(sourceId || ''),
            createdAt: new Date().toISOString(), changes };
        for (const change of changes) installChange(state, change, id);
        state.pending.push(operation); state.seen[id] = digest(operation);
    }
    function capture(state, snapshot, sourceId) {
        assertState(state);
        if (!state.enabled) return state;
        const actual = unitsFrom(snapshot, state.preferences);
        const keys = [...new Set(Object.keys(state.materialized).concat(Object.keys(actual)))].filter(key => key !== 'preferences' || state.preferences);
        const entries = keys.map(key => [key, actual[key] || absent()]).filter(([key, value]) => !equal(value, state.materialized[key] || absent()));
        publish(state, entries, sourceId);
        // The local user's commit stays visible. Unresolved alternatives remain in heads.
        state.materialized = actual;
        return state;
    }
    function validateOperation(operation) {
        safeJson(operation);
        if (!plain(operation) || operation.format !== FORMAT || operation.version !== VERSION
            || !identifier(operation.spaceId) || !identifier(operation.writerId)
            || !Number.isSafeInteger(operation.seq) || operation.seq < 1
            || operation.id !== operation.writerId + '-' + String(operation.seq).padStart(12, '0')
            || !Array.isArray(operation.changes) || !operation.changes.length || operation.changes.length > 20000) fail('不支持或损坏的同步日志');
        const keys = new Set();
        for (const change of operation.changes) {
            if (keys.has(change.key)) fail('同步日志包含重复实体'); keys.add(change.key);
            validateUnit(change.key, change.value); validateUnit(change.key, change.base);
            if (!plain(change.clock) || Object.keys(change.clock).length > 1000 || change.clock[operation.writerId] !== operation.seq
                || Object.entries(change.clock).some(([writer, n]) => !identifier(writer) || !Number.isSafeInteger(n) || n < 1)) fail('同步因果版本无效');
        }
        return operation;
    }
    function receive(state, operation, allowLargeDelete = false) {
        assertState(state); validateOperation(operation);
        if (operation.spaceId !== state.spaceId) fail('日志不属于当前数据空间');
        const hash = digest(operation);
        if (own(state.seen, operation.id)) {
            if (state.seen[operation.id] !== hash) fail('相同同步操作 ID 对应不同内容，已停止应用该文件');
            return { state, duplicate: true };
        }
        state.blocked = state.blocked || {};
        if (state.blocked[operation.id] && digest(state.blocked[operation.id]) !== hash) fail('待确认日志的内容发生变化');
        const deleting = operation.changes.filter(change => change.key.startsWith('practice/')
            && !change.value.exists && state.units[change.key]?.value.exists);
        const count = Object.entries(state.units).filter(([key, unit]) => key.startsWith('practice/') && unit.value.exists).length;
        if (!allowLargeDelete && deleting.length >= 10 && deleting.length >= count * .5) {
            state.blocked[operation.id] = copy(operation);
            return { state, duplicate: false, blocked: true };
        }
        for (const change of operation.changes) installChange(state, change, operation.id);
        state.seen[operation.id] = hash;
        delete state.blocked[operation.id];
        return { state, duplicate: false };
    }
    function resolve(state, key, headId) {
        assertState(state);
        const unit = state.units[key];
        const head = unit?.heads.find(item => item.id === headId);
        if (!unit?.conflict || !head) fail('冲突已经变化，请刷新后重新选择');
        publish(state, [[key, head.value]], 'conflict-resolution', true);
    }
    function toSnapshot(state, original) {
        const result = copy(original), docs = result.documents;
        const units = {};
        for (const [key, unit] of Object.entries(state.units)) units[key] = copy(unit.value);
        for (const store of STORES) result.entities[store] = [];
        docs['goals.items'] = [];
        for (const [key, wrapped] of Object.entries(units)) {
            if (!wrapped.exists) continue;
            const value = wrapped.value;
            if (key.startsWith('practice/')) {
                const recordId = key.slice(9);
                for (const store of STORES) result.entities[store].push({ recordId, data: copy(value[store]) });
            } else if (key.startsWith('goals.items/')) docs['goals.items'].push(value);
            else if (key === 'vocabulary') {
                docs['vocab.words'] = value.words; docs['vocab.lists'] = value.lists;
                docs['vocab.userConfig'] = value.config;
            } else if (key === 'libraries') {
                docs['library.configurations'] = value.configurations; docs['library.importedIndexes'] = value.indexes;
            } else if (key === 'achievements') docs['achievements.manual'] = value;
            else if (key === 'preferences' && state.preferences) {
                const prefs = docs['preferences.values'] || {};
                for (const field of ['theme', 'readingDisplay', 'timer']) delete prefs[field];
                docs['preferences.values'] = Object.assign(prefs, value);
            }
        }
        for (const store of STORES) result.entities[store].sort((a, b) => a.recordId.localeCompare(b.recordId));
        for (const key of ['goals.items']) docs[key].sort((a, b) => String(a.id).localeCompare(String(b.id)));
        return result;
    }
    function rememberMaterialized(state, snapshot) { state.materialized = unitsFrom(snapshot, state.preferences); }
    function status(state) {
        if (!state?.version) return { enabled: false, pending: 0, conflicts: [], blocked: [], spaceId: null };
        assertState(state);
        return { enabled: state.enabled, spaceId: state.spaceId, writerId: state.writerId, preferences: state.preferences,
            pending: state.pending.length, blocked: Object.values(state.blocked || {}).map(op => ({ id: op.id, createdAt: op.createdAt,
                count: op.changes.filter(change => change.key.startsWith('practice/') && !change.value.exists).length })),
            conflicts: Object.entries(state.units).filter(([, unit]) => unit.conflict)
                .map(([key, unit]) => ({ key, versions: copy(unit.heads) })) };
    }
    global.FolderSyncModel = Object.freeze({ FORMAT, VERSION, STATE_KEY, STORES, DOCUMENT_KEYS,
        copy, stable, equal, digest, safeJson, identifier, uuid, unitsFrom, newState, capture,
        validateOperation, receive, resolve, toSnapshot, rememberMaterialized, status, assertState });
})(typeof window !== 'undefined' ? window : globalThis);
