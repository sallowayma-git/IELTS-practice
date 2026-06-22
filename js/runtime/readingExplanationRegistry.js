(function initReadingExplanationRegistry(global) {
    'use strict';

    const store = new Map();
    const MAX_READING_REGISTRY_CLONE_DEPTH = 16;
    const MAX_READING_REGISTRY_CLONE_NODES = 50000;
    const MAX_READING_REGISTRY_ARRAY_ITEMS = 5000;
    const MAX_READING_REGISTRY_OBJECT_KEYS = 1000;
    const MAX_READING_REGISTRY_STRING_LENGTH = 100000;
    const READING_REGISTRY_UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

    function isRegistryTruncationMarker(value) {
        return typeof value === 'string' && /^\[Truncated \d+ items\]$/.test(value);
    }

    function cloneRegistryValue(value, depth = 0, state = { seen: new WeakSet(), nodes: 0 }) {
        if (value == null) {
            return value;
        }
        const valueType = typeof value;
        if (valueType === 'string') {
            return value.length > MAX_READING_REGISTRY_STRING_LENGTH
                ? `${value.slice(0, MAX_READING_REGISTRY_STRING_LENGTH)}...`
                : value;
        }
        if (valueType === 'number') {
            return Number.isFinite(value) ? value : null;
        }
        if (valueType === 'boolean') {
            return value;
        }
        if (valueType === 'bigint') {
            return value.toString();
        }
        if (valueType !== 'object') {
            return undefined;
        }
        if (value instanceof Date) {
            return Number.isNaN(value.getTime()) ? null : value.toISOString();
        }
        if (depth > MAX_READING_REGISTRY_CLONE_DEPTH) {
            return '[MaxDepth]';
        }
        if (state.seen.has(value)) {
            return '[Circular]';
        }
        if (state.nodes >= MAX_READING_REGISTRY_CLONE_NODES) {
            return '[Truncated]';
        }

        state.nodes += 1;
        state.seen.add(value);
        try {
            if (Array.isArray(value)) {
                const hasExistingMarker = value.length === MAX_READING_REGISTRY_ARRAY_ITEMS + 1
                    && isRegistryTruncationMarker(value[MAX_READING_REGISTRY_ARRAY_ITEMS]);
                const list = value
                    .slice(0, hasExistingMarker ? MAX_READING_REGISTRY_ARRAY_ITEMS + 1 : MAX_READING_REGISTRY_ARRAY_ITEMS)
                    .map((item) => cloneRegistryValue(item, depth + 1, state))
                    .filter((item) => item !== undefined);
                if (value.length > MAX_READING_REGISTRY_ARRAY_ITEMS && !hasExistingMarker) {
                    list.push(`[Truncated ${value.length - MAX_READING_REGISTRY_ARRAY_ITEMS} items]`);
                }
                return list;
            }

            let keys;
            try {
                keys = Object.keys(value);
            } catch (_) {
                return '[Unreadable]';
            }
            const output = {};
            for (const key of keys.slice(0, MAX_READING_REGISTRY_OBJECT_KEYS)) {
                if (READING_REGISTRY_UNSAFE_KEYS.has(key)) {
                    continue;
                }
                const safeValue = cloneRegistryValue(value[key], depth + 1, state);
                if (safeValue !== undefined) {
                    output[key] = safeValue;
                }
            }
            if (keys.length > MAX_READING_REGISTRY_OBJECT_KEYS) {
                output.__truncatedKeys = keys.length - MAX_READING_REGISTRY_OBJECT_KEYS;
            }
            return output;
        } finally {
            state.seen.delete(value);
        }
    }

    function deepClone(value) {
        return cloneRegistryValue(value);
    }

    const api = {
        register(id, payload) {
            if (!id || !payload || typeof payload !== 'object') {
                throw new Error('reading_explanation_payload_invalid');
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

    global.__READING_EXPLANATION_DATA__ = api;
})(typeof window !== 'undefined' ? window : globalThis);
