function cloneArrayBufferView(view) {
    if (view instanceof DataView) {
        const buffer = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
        return new DataView(buffer);
    }

    if (typeof view.slice === 'function') {
        return view.slice();
    }

    return new view.constructor(view);
}

function toIpcSerializable(value) {
    if (value === null || value === undefined) {
        return value;
    }

    if (typeof value !== 'object') {
        return value;
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (value instanceof ArrayBuffer) {
        return value.slice(0);
    }

    if (ArrayBuffer.isView(value)) {
        return cloneArrayBufferView(value);
    }

    if (Array.isArray(value)) {
        return value.map((item) => toIpcSerializable(item));
    }

    const normalized = {};
    for (const [key, nestedValue] of Object.entries(value)) {
        normalized[key] = toIpcSerializable(nestedValue);
    }
    return normalized;
}

module.exports = {
    toIpcSerializable
};
