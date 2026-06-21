/**
 * Safe state serializer for app state persisted in local storage.
 * Supports Set, Map, and Date while bounding recursive structures and
 * dropping prototype-pollution keys during serialization and restore.
 */
const STATE_SERIALIZER_POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const STATE_SERIALIZER_MAX_DEPTH = 32;
const STATE_SERIALIZER_MAX_NODES = 50000;
const STATE_SERIALIZER_MAX_ARRAY_ITEMS = 5000;
const STATE_SERIALIZER_MAX_OBJECT_KEYS = 500;
const STATE_SERIALIZER_MAX_COLLECTION_ITEMS = 5000;
function summarizeStateSerializerErrorForLog(error) {
    if (!error || typeof error !== 'object') {
        return { name: typeof error };
    }
    const status = Number(error.status);
    return {
        name: typeof error.name === 'string' && error.name ? error.name.slice(0, 80) : 'Error',
        status: Number.isFinite(status) ? status : undefined
    };
}


class StateSerializer {
    static serialize(value) {
        return StateSerializer._serialize(value, {
            nodes: 0,
            stack: new WeakSet()
        }, 0);
    }

    static deserialize(value) {
        return StateSerializer._deserialize(value, {
            nodes: 0,
            stack: new WeakSet()
        }, 0);
    }

    static _serialize(value, state, depth) {
        if (value === null || value === undefined) {
            return value;
        }
        if (typeof value !== 'object') {
            return value;
        }
        if (!StateSerializer.enterTraversal(value, state, depth, 'serialize')) {
            return null;
        }

        try {
            if (value instanceof Set) {
                return {
                    __type: 'Set',
                    __value: Array.from(value)
                        .slice(0, STATE_SERIALIZER_MAX_COLLECTION_ITEMS)
                        .map((item) => StateSerializer._serialize(item, state, depth + 1))
                };
            }

            if (value instanceof Map) {
                return {
                    __type: 'Map',
                    __value: Array.from(value.entries())
                        .slice(0, STATE_SERIALIZER_MAX_COLLECTION_ITEMS)
                        .map(([key, item]) => [
                            StateSerializer._serialize(key, state, depth + 1),
                            StateSerializer._serialize(item, state, depth + 1)
                        ])
                };
            }

            if (value instanceof Date) {
                return {
                    __type: 'Date',
                    __value: Number.isNaN(value.getTime()) ? null : value.toISOString()
                };
            }

            if (Array.isArray(value)) {
                return value
                    .slice(0, STATE_SERIALIZER_MAX_ARRAY_ITEMS)
                    .map((item) => StateSerializer._serialize(item, state, depth + 1));
            }

            const serialized = {};
            for (const [key, item] of StateSerializer.safeEntries(value).slice(0, STATE_SERIALIZER_MAX_OBJECT_KEYS)) {
                const safeValue = StateSerializer._serialize(item, state, depth + 1);
                if (safeValue !== undefined) {
                    serialized[key] = safeValue;
                }
            }
            return serialized;
        } finally {
            StateSerializer.exitTraversal(value, state);
        }
    }

    static _deserialize(value, state, depth) {
        if (value === null || value === undefined) {
            return value;
        }
        if (typeof value !== 'object') {
            return value;
        }
        if (!StateSerializer.enterTraversal(value, state, depth, 'deserialize')) {
            return null;
        }

        try {
            if (Object.prototype.hasOwnProperty.call(value, '__type')) {
                const type = typeof value.__type === 'string' ? value.__type : '';
                if (type === 'Set') {
                    return new Set(
                        StateSerializer.normalizeArray(value.__value, STATE_SERIALIZER_MAX_COLLECTION_ITEMS)
                            .map((item) => StateSerializer._deserialize(item, state, depth + 1))
                    );
                }
                if (type === 'Map') {
                    return new Map(
                        StateSerializer.normalizeArray(value.__value, STATE_SERIALIZER_MAX_COLLECTION_ITEMS)
                            .filter((entry) => Array.isArray(entry) && entry.length >= 2)
                            .map(([key, item]) => [
                                StateSerializer._deserialize(key, state, depth + 1),
                                StateSerializer._deserialize(item, state, depth + 1)
                            ])
                    );
                }
                if (type === 'Date') {
                    if (typeof value.__value !== 'string') {
                        return null;
                    }
                    const date = new Date(value.__value);
                    return Number.isNaN(date.getTime()) ? null : date;
                }
                console.warn(`[StateSerializer] Unknown type: ${type}`);
                return StateSerializer._deserialize(value.__value, state, depth + 1);
            }

            if (Array.isArray(value)) {
                return value
                    .slice(0, STATE_SERIALIZER_MAX_ARRAY_ITEMS)
                    .map((item) => StateSerializer._deserialize(item, state, depth + 1));
            }

            const deserialized = {};
            for (const [key, item] of StateSerializer.safeEntries(value).slice(0, STATE_SERIALIZER_MAX_OBJECT_KEYS)) {
                const safeValue = StateSerializer._deserialize(item, state, depth + 1);
                if (safeValue !== undefined) {
                    deserialized[key] = safeValue;
                }
            }
            return deserialized;
        } finally {
            StateSerializer.exitTraversal(value, state);
        }
    }

    static enterTraversal(value, state, depth, operation) {
        if (depth > STATE_SERIALIZER_MAX_DEPTH) {
            throw new Error(`State is too deeply nested to ${operation} safely. Maximum supported depth is ${STATE_SERIALIZER_MAX_DEPTH}.`);
        }
        if (state.stack.has(value)) {
            return false;
        }
        state.stack.add(value);
        state.nodes += 1;
        if (state.nodes > STATE_SERIALIZER_MAX_NODES) {
            throw new Error(`State is too large to ${operation} safely. Maximum supported node count is ${STATE_SERIALIZER_MAX_NODES}.`);
        }
        return true;
    }

    static exitTraversal(value, state) {
        state.stack.delete(value);
    }

    static isUnsafeKey(key) {
        return STATE_SERIALIZER_POLLUTION_KEYS.has(String(key));
    }

    static safeEntries(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return [];
        }
        return Object.entries(value).filter(([key]) => !StateSerializer.isUnsafeKey(key));
    }

    static normalizeArray(value, limit = STATE_SERIALIZER_MAX_ARRAY_ITEMS) {
        return Array.isArray(value) ? value.slice(0, limit) : [];
    }

    static validate(originalValue) {
        try {
            const serialized = StateSerializer.serialize(originalValue);
            const deserialized = StateSerializer.deserialize(serialized);

            if (originalValue instanceof Set) {
                const originalArray = Array.from(originalValue);
                const deserializedArray = Array.from(deserialized);
                return JSON.stringify(originalArray.sort()) === JSON.stringify(deserializedArray.sort());
            }

            if (originalValue instanceof Map) {
                const originalArray = Array.from(originalValue.entries()).sort();
                const deserializedArray = Array.from(deserialized.entries()).sort();
                return JSON.stringify(originalArray) === JSON.stringify(deserializedArray);
            }

            return JSON.stringify(originalValue) === JSON.stringify(deserialized);
        } catch (error) {
            console.error('[StateSerializer] Validation failed:', summarizeStateSerializerErrorForLog(error));
            return false;
        }
    }

    static createStorageAdapter(baseStorage) {
        return {
            async get(key, defaultValue = null) {
                try {
                    const value = await baseStorage.get(key, defaultValue);
                    return StateSerializer.deserialize(value);
                } catch (error) {
                    console.error('[StateSerializer] get failed:', summarizeStateSerializerErrorForLog(error));
                    return defaultValue;
                }
            },

            async set(key, value) {
                try {
                    const serializedValue = StateSerializer.serialize(value);
                    return await baseStorage.set(key, serializedValue);
                } catch (error) {
                    console.error('[StateSerializer] set failed:', summarizeStateSerializerErrorForLog(error));
                    throw error;
                }
            },

            async remove(key) {
                try {
                    return await baseStorage.remove(key);
                } catch (error) {
                    console.error('[StateSerializer] remove failed:', summarizeStateSerializerErrorForLog(error));
                    throw error;
                }
            },

            async clear() {
                try {
                    return await baseStorage.clear();
                } catch (error) {
                    console.error('[StateSerializer] clear failed:', summarizeStateSerializerErrorForLog(error));
                    throw error;
                }
            }
        };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = StateSerializer;
}
