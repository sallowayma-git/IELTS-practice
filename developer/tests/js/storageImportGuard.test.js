#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'js/utils/storage.js'), 'utf8');

function createWebStorage() {
    const data = new Map();
    const target = {
        get length() { return data.size; },
        key(index) { return Array.from(data.keys())[index] || null; },
        getItem(key) { return data.has(String(key)) ? data.get(String(key)) : null; },
        setItem(key, value) {
            const normalizedKey = String(key);
            const normalizedValue = String(value);
            data.set(normalizedKey, normalizedValue);
            target[normalizedKey] = normalizedValue;
        },
        removeItem(key) {
            const normalizedKey = String(key);
            data.delete(normalizedKey);
            delete target[normalizedKey];
        },
        clear() {
            Array.from(data.keys()).forEach((key) => {
                data.delete(key);
                delete target[key];
            });
        }
    };
    return target;
}

async function createStorageHarness(options = {}) {
    const localStorage = createWebStorage();
    const sessionStorage = createWebStorage();
    const fetchImpl = options.fetch || (async () => ({
        ok: false,
        async json() {
            return {};
        }
    }));
    const context = {
        console: {
            log() {},
            warn() {},
            error() {}
        },
        window: {
            location: {
                href: 'http://127.0.0.1:3000/',
                origin: 'http://127.0.0.1:3000',
                protocol: 'http:'
            },
            localStorage,
            sessionStorage,
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent() {},
            CustomEvent: function CustomEvent(type, init = {}) {
                return { type, detail: init.detail || null };
            }
        },
        document: {
            dispatchEvent() {}
        },
        URL,
        fetch: fetchImpl,
        localStorage,
        sessionStorage,
        setInterval() { return 1; },
        clearInterval() {},
        setTimeout(callback) {
            if (typeof callback === 'function') callback();
            return 1;
        },
        clearTimeout() {},
        CustomEvent: function CustomEvent(type, init = {}) {
            return { type, detail: init.detail || null };
        }
    };
    context.globalThis = context.window;
    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'js/utils/storage.js' });
    await context.window.persistentStore.ready;
    return {
        manager: context.window.persistentStore,
        storageFacade: context.window.storage,
        preferenceStore: context.window.preferenceStore,
        localStorage
    };
}

{
    const { manager } = await createStorageHarness();
    await manager.set('practice_records', [{ id: 'existing', examId: 'reading-existing' }]);

    const result = await manager.importData({
        data: {
            storage_backend: { data: 'session' },
            constructor: { data: { prototype: { polluted: true } } },
            arbitrary_runtime_flag: { data: true }
        }
    });

    assert.equal(result.success, false, 'all-invalid imports must fail');
    assert.match(result.message, /no allowed storage keys/i);
    assert.deepEqual(
        await manager.get('practice_records', []),
        [{ id: 'existing', examId: 'reading-existing' }],
        'all-invalid imports must not clear existing data'
    );
    assert.equal(Object.prototype.polluted, undefined);
}

{
    const { manager, localStorage } = await createStorageHarness();
    const result = await manager.importData({
        data: JSON.parse(`{
            "practice_records": { "data": [{ "id": "imported", "examId": "reading-imported" }] },
            "exam_system_vocab_list_custom": { "data": { "id": "custom", "words": [] } },
            "storage_backend": { "data": "session" },
            "__proto__": { "data": { "polluted": true } },
            "constructor": { "data": { "prototype": { "polluted": true } } },
            "arbitrary_runtime_flag": { "data": true }
        }`)
    });

    assert.equal(result.success, true);
    assert.equal(result.importedKeys, 2);
    assert.equal(result.skippedKeys, 4);
    assert.deepEqual(await manager.get('practice_records', []), [{ id: 'imported', examId: 'reading-imported' }]);
    assert.deepEqual(await manager.get('vocab_list_custom', null), { id: 'custom', words: [] });
    assert.equal(await manager.get('arbitrary_runtime_flag', 'missing'), 'missing');
    assert.equal(localStorage.getItem('exam_system_storage_backend'), null);
    assert.equal(Object.prototype.polluted, undefined);
}

{
    const { manager } = await createStorageHarness();
    await manager.set('practice_records', [{ id: 'existing', examId: 'reading-existing' }]);

    const result = await manager.importData({
        data: JSON.parse(`{
            "practice_records": {
                "data": [{
                    "id": "bad",
                    "examId": "reading-bad",
                    "payload": {
                        "__proto__": { "polluted": true }
                    }
                }]
            }
        }`)
    });

    assert.equal(result.success, false);
    assert.match(result.message, /unsafe key/i);
    assert.deepEqual(
        await manager.get('practice_records', []),
        [{ id: 'existing', examId: 'reading-existing' }],
        'unsafe nested import data must not replace existing records'
    );
    assert.equal(Object.prototype.polluted, undefined);
}

{
    const { manager, localStorage } = await createStorageHarness();
    localStorage.setItem('exam_system_practice_records', JSON.stringify([{ id: 'stored', examId: 'reading-stored' }]));
    localStorage.setItem('exam_system___proto__', JSON.stringify({ polluted: true }));
    localStorage.setItem('exam_system_constructor', JSON.stringify({ prototype: { polluted: true } }));
    localStorage.setItem('exam_system_storage_backend', JSON.stringify('session'));

    const exported = await manager.exportData({ skipReady: true });

    assert.deepEqual(exported.data.practice_records, [{ id: 'stored', examId: 'reading-stored' }]);
    assert.equal(Object.prototype.hasOwnProperty.call(exported.data, '__proto__'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(exported.data, 'constructor'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(exported.data, 'storage_backend'), false);
    assert.equal(Object.prototype.polluted, undefined);
}

{
    const { manager, localStorage } = await createStorageHarness();
    manager.fallbackStorage = new Map([
        ['exam_system_practice_records', JSON.stringify([{ id: 'memory-record', examId: 'reading-memory' }])],
        ['exam_system_user_stats', '{bad json']
    ]);
    manager.indexedDB = {};
    manager.getAllFromIndexedDB = async () => [
        { key: 'exam_system_settings', value: JSON.stringify({ data: { theme: 'dark' } }) },
        { key: 'exam_system_import_history', value: '{"data":[{"__proto__":{"polluted":true}}]}' },
        { key: 'exam_system_backup_settings', value: '{not json' }
    ];
    localStorage.removeItem('exam_system_practice_records');
    localStorage.removeItem('exam_system_settings');
    localStorage.removeItem('exam_system_user_stats');
    localStorage.setItem('exam_system_vocab_words', JSON.stringify({ data: [{ word: 'safe' }] }));
    localStorage.setItem('exam_system_manual_backups', '{"data":[{"constructor":{"prototype":{"polluted":true}}}]}');

    const exported = await manager.exportData({ skipReady: true });

    assert(exported);
    assert.deepEqual(exported.data.practice_records, [{ id: 'memory-record', examId: 'reading-memory' }]);
    assert.deepEqual(exported.data.settings, { data: { theme: 'dark' } });
    assert.deepEqual(exported.data.vocab_words, { data: [{ word: 'safe' }] });
    assert.equal(exported.data.user_stats, undefined);
    assert.equal(exported.data.import_history, undefined);
    assert.equal(exported.data.backup_settings, undefined);
    assert.equal(exported.data.manual_backups, undefined);
    assert.equal(Object.prototype.polluted, undefined);
}

{
    const { manager } = await createStorageHarness({
        async fetch(url, options) {
            assert.equal(url, 'http://127.0.0.1:3000/assets/data/backup-practice-records.json');
            assert.deepEqual(options, { credentials: 'same-origin', cache: 'no-store' });
            return {
                ok: true,
                async json() {
                    return {
                        practice_records: [{ id: 'restored', examId: 'reading-restored' }]
                    };
                }
            };
        }
    });
    manager.ready = Promise.resolve();
    manager.localStorageAvailable = true;
    manager.sessionStorageAvailable = true;
    manager.indexedDBBlocked = true;
    manager.indexedDB = null;
    manager.mode = 'localStorage';
    manager.volatileMode = false;

    await manager.set('practice_records', [{ id: 'existing', examId: 'reading-existing' }], { skipReady: true });
    const restored = await manager.restoreFromBackup({ skipReady: true });
    assert.equal(restored, true);
    assert.deepEqual(await manager.get('practice_records', [], { skipReady: true }), [{ id: 'restored', examId: 'reading-restored' }]);
}

{
    const { manager } = await createStorageHarness({
        async fetch() {
            return {
                ok: true,
                async json() {
                    return JSON.parse(`{
                        "practice_records": [{
                            "id": "bad",
                            "payload": {
                                "__proto__": { "polluted": true }
                            }
                        }]
                    }`);
                }
            };
        }
    });
    manager.ready = Promise.resolve();
    manager.localStorageAvailable = true;
    manager.sessionStorageAvailable = true;
    manager.indexedDBBlocked = true;
    manager.indexedDB = null;
    manager.mode = 'localStorage';
    manager.volatileMode = false;

    await manager.set('practice_records', [{ id: 'existing', examId: 'reading-existing' }], { skipReady: true });
    const restored = await manager.restoreFromBackup({ skipReady: true });
    assert.equal(restored, false);
    assert.deepEqual(await manager.get('practice_records', [], { skipReady: true }), [{ id: 'existing', examId: 'reading-existing' }]);
    assert.equal(Object.prototype.polluted, undefined);
}

{
    const { manager } = await createStorageHarness({
        async fetch() {
            return {
                ok: true,
                async json() {
                    return {
                        practice_records: Array.from({ length: 5001 }, (_, index) => ({ id: `record-${index}` }))
                    };
                }
            };
        }
    });
    manager.ready = Promise.resolve();
    manager.localStorageAvailable = true;
    manager.sessionStorageAvailable = true;
    manager.indexedDBBlocked = true;
    manager.indexedDB = null;
    manager.mode = 'localStorage';
    manager.volatileMode = false;

    await manager.set('practice_records', [{ id: 'existing', examId: 'reading-existing' }], { skipReady: true });
    const restored = await manager.restoreFromBackup({ skipReady: true });
    assert.equal(restored, false);
    assert.deepEqual(await manager.get('practice_records', [], { skipReady: true }), [{ id: 'existing', examId: 'reading-existing' }]);
}

{
    const { manager, storageFacade, preferenceStore } = await createStorageHarness();
    const originalPersistentPrefix = manager.prefix;
    const originalPreferencePrefix = preferenceStore.prefix;
    const invalidNamespaces = [
        '__proto__',
        'constructor',
        'prototype',
        'storage_backend',
        '../evil',
        'bad namespace',
        '1bad',
        'a'.repeat(81)
    ];

    for (const namespace of invalidNamespaces) {
        storageFacade.setNamespace(namespace);
        assert.equal(manager.prefix, originalPersistentPrefix);
        assert.equal(preferenceStore.prefix, originalPreferencePrefix);
    }

    storageFacade.setNamespace('exam_system_test-1');
    assert.equal(manager.prefix, 'exam_system_test-1_');
    assert.equal(preferenceStore.prefix, 'exam_system_test-1_');
}

{
    const { manager, storageFacade, localStorage } = await createStorageHarness();
    localStorage.setItem('exam_system_user_stats', JSON.stringify({
        data: JSON.parse(`{
            "totalPractices": 2,
            "__proto__": { "pollutedStoredValue": true },
            "nested": {
                "ok": true,
                "constructor": { "prototype": { "pollutedStoredValue": true } }
            },
            "items": [{
                "id": "safe-item",
                "prototype": { "pollutedStoredValue": true }
            }]
        }`)
    }));
    localStorage.setItem('exam_system_theme_settings', JSON.stringify({
        data: JSON.parse(`{
            "mode": "light",
            "__proto__": { "pollutedStoredValue": true },
            "nested": {
                "constructor": { "prototype": { "pollutedStoredValue": true } },
                "safe": "keep"
            }
        }`)
    }));

    const stats = await manager.get('user_stats', {}, { skipReady: true });
    assert.equal(stats.totalPractices, 2);
    assert.equal(Object.prototype.hasOwnProperty.call(stats, '__proto__'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(stats.nested, 'constructor'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(stats.items[0], 'prototype'), false);
    assert.equal(stats.nested.ok, true);
    assert.equal(stats.items[0].id, 'safe-item');

    const themeSettings = await storageFacade.get('theme_settings', {});
    assert.equal(themeSettings.mode, 'light');
    assert.equal(Object.prototype.hasOwnProperty.call(themeSettings, '__proto__'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(themeSettings.nested, 'constructor'), false);
    assert.equal(themeSettings.nested.safe, 'keep');
    assert.equal(Object.prototype.pollutedStoredValue, undefined);
}

{
    const { manager } = await createStorageHarness();
    assert.equal(manager.sanitizeDownloadFilename('CON.json', 'fallback.json'), '_CON.json');
    assert.equal(manager.sanitizeDownloadFilename('NUL.', 'fallback.json'), '_NUL.json');
    assert.equal(manager.sanitizeDownloadFilename('report...   ', 'fallback.json'), 'report.json');
}

console.log(JSON.stringify({
    status: 'pass',
    detail: 'storage import key guard tests passed'
}, null, 2));
