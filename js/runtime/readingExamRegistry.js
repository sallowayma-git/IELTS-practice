(function initReadingExamRegistry(global) {
    'use strict';

    const store = new Map();

    function deepClone(value) {
        if (value == null) {
            return value;
        }
        return JSON.parse(JSON.stringify(value));
    }

    const api = {
        register(id, payload) {
            if (!id || !payload || typeof payload !== 'object') {
                throw new Error('reading_exam_payload_invalid');
            }
            store.set(String(id), deepClone(payload));
        },
        get(id) {
            if (!id) {
                return null;
            }
            return store.has(String(id)) ? deepClone(store.get(String(id))) : null;
        },
        has(id) {
            return !!id && store.has(String(id));
        },
        keys() {
            return Array.from(store.keys());
        },
        clear() {
            store.clear();
        }
    };

    global.__READING_EXAM_DATA__ = api;
})(typeof window !== 'undefined' ? window : globalThis);
