(function initPracticeStore(global) {
    'use strict';

    function getPracticeRecordAPI() {
        if (!global.PracticeRecordAPI) {
            throw new Error('PracticeStore: PracticeRecordAPI not ready');
        }
        return global.PracticeRecordAPI;
    }

    async function list() {
        var api = getPracticeRecordAPI();
        if (typeof api.list !== 'function') {
            throw new Error('PracticeStore.list: PracticeRecordAPI.list not ready');
        }
        var records = await api.list();
        return Array.isArray(records) ? records : [];
    }

    async function replace(records, options) {
        var finalRecords = Array.isArray(records) ? records : [];
        var api = getPracticeRecordAPI();
        if (typeof api.replace !== 'function') {
            throw new Error('PracticeStore.replace: PracticeRecordAPI.replace not ready');
        }
        await api.replace(finalRecords, Object.assign({ updateStats: true }, options || {}));
        return true;
    }

    async function save(record, options) {
        var api = getPracticeRecordAPI();
        if (typeof api.saveRecord !== 'function') {
            throw new Error('PracticeStore.save: PracticeRecordAPI.saveRecord not ready');
        }
        return api.saveRecord(record, Object.assign({ updateStats: true }, options || {}));
    }

    async function clear(options) {
        var api = getPracticeRecordAPI();
        if (typeof api.clear === 'function') {
            await api.clear(Object.assign({ updateStats: true }, options || {}));
            return true;
        }
        return replace([], options || {});
    }

    global.PracticeStore = Object.assign({}, global.PracticeStore || {}, {
        list: list,
        replace: replace,
        save: save,
        clear: clear
    });
})(typeof window !== 'undefined' ? window : globalThis);
