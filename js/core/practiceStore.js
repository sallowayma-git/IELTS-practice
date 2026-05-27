(function initPracticeStore(global) {
    'use strict';

    var PRACTICE_RECORDS_KEY = ['practice', 'records'].join('_');

    function getCoreStore() {
        return global.PracticeCore && global.PracticeCore.store
            ? global.PracticeCore.store
            : null;
    }

    function getLegacyWrapper() {
        return global.simpleStorageWrapper || null;
    }

    function getStorage() {
        return global.storage || null;
    }

    async function list() {
        var coreStore = getCoreStore();
        if (coreStore && typeof coreStore.listPracticeRecords === 'function') {
            return coreStore.listPracticeRecords();
        }

        var wrapper = getLegacyWrapper();
        if (wrapper && typeof wrapper.getPracticeRecords === 'function') {
            return wrapper.getPracticeRecords();
        }

        var storage = getStorage();
        if (storage && typeof storage.get === 'function') {
            var records = await storage.get(PRACTICE_RECORDS_KEY, []);
            return Array.isArray(records) ? records : [];
        }

        return [];
    }

    async function replace(records, options) {
        var finalRecords = Array.isArray(records) ? records : [];
        var coreStore = getCoreStore();
        if (coreStore && typeof coreStore.replacePracticeRecords === 'function') {
            return coreStore.replacePracticeRecords(finalRecords, options || {});
        }

        var wrapper = getLegacyWrapper();
        if (wrapper && typeof wrapper.savePracticeRecords === 'function') {
            return wrapper.savePracticeRecords(finalRecords);
        }

        var storage = getStorage();
        if (storage && typeof storage.set === 'function') {
            await storage.set(PRACTICE_RECORDS_KEY, finalRecords);
            return true;
        }

        throw new Error('PracticeStore.replace: storage not ready');
    }

    async function save(record, options) {
        var coreStore = getCoreStore();
        if (coreStore && typeof coreStore.savePracticeRecord === 'function') {
            return coreStore.savePracticeRecord(record, options || {});
        }

        var current = await list();
        var next = Array.isArray(current) ? current.slice() : [];
        var recordId = record && record.id != null ? String(record.id) : '';
        var existingIndex = recordId
            ? next.findIndex(function (entry) { return entry && String(entry.id) === recordId; })
            : -1;

        if (existingIndex >= 0) {
            next[existingIndex] = record;
        } else {
            next.unshift(record);
        }

        await replace(next, options || {});
        return record;
    }

    async function clear() {
        return replace([]);
    }

    global.PracticeStore = Object.assign({}, global.PracticeStore || {}, {
        list: list,
        replace: replace,
        save: save,
        clear: clear
    });
})(typeof window !== 'undefined' ? window : globalThis);
