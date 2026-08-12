(function installDataCatalog(global) {
    'use strict';

    const V2_SCHEMA_VERSION = 2;

    function clone(value) {
        if (value === undefined) return undefined;
        if (typeof structuredClone === 'function') {
            try { return structuredClone(value); } catch (_) { /* fall through */ }
        }
        return JSON.parse(JSON.stringify(value));
    }

    function objectDefault() { return {}; }
    function arrayDefault() { return []; }
    function nullableDefault() { return null; }
    function normalizeArray(value) { return Array.isArray(value) ? clone(value) : []; }
    function normalizeObject(value) {
        return value && typeof value === 'object' && !Array.isArray(value) ? clone(value) : {};
    }
    function normalizeNullableString(value) {
        return value === null || value === undefined || value === '' ? null : String(value);
    }
    function isArray(value) { return Array.isArray(value); }
    function isObject(value) { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
    function isNullableString(value) { return value === null || typeof value === 'string'; }

    const CATALOG_OWNERS = new Set([
        'settings', 'library', 'recovery', 'backups', 'vocab',
        'preferences', 'goals', 'achievements', 'system', 'practice'
    ]);
    const CATALOG_CLASSIFICATIONS = new Set(['authoritative', 'preference', 'session', 'system']);
    const IMPORT_POLICIES = new Set(['replace', 'patch', 'merge-by-id', 'ignore']);

    function isNonEmptyString(value) {
        return typeof value === 'string' && Boolean(value.trim());
    }

    function ownerFromKey(logicalKey) {
        const dot = String(logicalKey || '').indexOf('.');
        return dot > 0 ? logicalKey.slice(0, dot) : '';
    }

    function freezeEntry(entry) {
        const logicalKey = String(entry.logicalKey || '');
        const owner = ownerFromKey(logicalKey);
        const next = Object.assign({}, entry, {
            logicalKey,
            owner,
            schemaVersion: V2_SCHEMA_VERSION,
            export: entry.export === true,
            import: entry.import || 'ignore'
        });
        return Object.freeze(next);
    }

    // Minimal document catalog. Practice lives in entity stores (summaries/details/annotations),
    // not as document keys. import merge identity is resolved in AppData, not here.
    const definitions = [
        {
            logicalKey: 'settings.values', classification: 'authoritative',
            defaultValue: objectDefault, normalize: normalizeObject, validate: isObject,
            export: true, import: 'patch'
        },
        {
            logicalKey: 'library.configurations', classification: 'authoritative',
            defaultValue: arrayDefault, normalize: normalizeArray, validate: isArray,
            export: true, import: 'merge-by-id'
        },
        {
            logicalKey: 'library.importedIndexes', classification: 'authoritative',
            defaultValue: objectDefault, normalize: normalizeObject, validate: isObject,
            export: true, import: 'patch'
        },
        {
            logicalKey: 'library.activeConfigurationId', classification: 'authoritative',
            defaultValue: nullableDefault, normalize: normalizeNullableString, validate: isNullableString,
            export: true, import: 'replace'
        },
        {
            logicalKey: 'recovery.activeSessions', classification: 'authoritative',
            defaultValue: arrayDefault, normalize: normalizeArray, validate: isArray,
            export: true, import: 'merge-by-id'
        },
        {
            logicalKey: 'recovery.drafts', classification: 'authoritative',
            defaultValue: arrayDefault, normalize: normalizeArray, validate: isArray,
            export: true, import: 'merge-by-id'
        },
        {
            logicalKey: 'recovery.interrupted', classification: 'authoritative',
            defaultValue: arrayDefault, normalize: normalizeArray, validate: isArray,
            export: true, import: 'merge-by-id'
        },
        {
            logicalKey: 'recovery.rejectedCompletions', classification: 'authoritative',
            defaultValue: arrayDefault, normalize: normalizeArray, validate: isArray,
            export: true, import: 'merge-by-id'
        },
        {
            logicalKey: 'recovery.windowSession', classification: 'session',
            defaultValue: objectDefault, normalize: normalizeObject, validate: isObject,
            export: false, import: 'ignore'
        },
        {
            logicalKey: 'backups.entries', classification: 'authoritative',
            defaultValue: arrayDefault, normalize: normalizeArray, validate: isArray,
            export: false, import: 'merge-by-id'
        },
        {
            logicalKey: 'backups.settings', classification: 'authoritative',
            defaultValue: objectDefault, normalize: normalizeObject, validate: isObject,
            export: true, import: 'patch'
        },
        {
            logicalKey: 'backups.exportHistory', classification: 'authoritative',
            defaultValue: arrayDefault, normalize: normalizeArray, validate: isArray,
            export: false, import: 'ignore'
        },
        {
            logicalKey: 'backups.importHistory', classification: 'authoritative',
            defaultValue: arrayDefault, normalize: normalizeArray, validate: isArray,
            export: false, import: 'ignore'
        },
        {
            logicalKey: 'vocab.words', classification: 'authoritative',
            defaultValue: arrayDefault, normalize: normalizeArray, validate: isArray,
            export: true, import: 'merge-by-id'
        },
        {
            logicalKey: 'vocab.userConfig', classification: 'authoritative',
            defaultValue: objectDefault, normalize: normalizeObject, validate: isObject,
            export: true, import: 'patch'
        },
        {
            logicalKey: 'vocab.lists', classification: 'authoritative',
            defaultValue: objectDefault, normalize: normalizeObject, validate: isObject,
            export: true, import: 'patch'
        },
        {
            logicalKey: 'preferences.values', classification: 'preference',
            defaultValue: objectDefault, normalize: normalizeObject, validate: isObject,
            export: true, import: 'patch'
        },
        {
            logicalKey: 'goals.items', classification: 'authoritative',
            defaultValue: arrayDefault, normalize: normalizeArray, validate: isArray,
            export: true, import: 'merge-by-id'
        },
        {
            logicalKey: 'achievements.manual', classification: 'authoritative',
            defaultValue: objectDefault, normalize: normalizeObject, validate: isObject,
            export: true, import: 'patch'
        },
        {
            logicalKey: 'achievements.progress', classification: 'authoritative',
            defaultValue: objectDefault, normalize: normalizeObject, validate: isObject,
            export: true, import: 'patch'
        },
        {
            logicalKey: 'system.migrations', classification: 'system',
            defaultValue: objectDefault, normalize: normalizeObject, validate: isObject,
            export: false, import: 'ignore'
        },
        {
            logicalKey: 'system.operationJournal', classification: 'system',
            defaultValue: objectDefault, normalize: normalizeObject, validate: isObject,
            export: false, import: 'ignore'
        },
        {
            // Monotonic entity revisions survive physical deletes and snapshot
            // replacement. Keeping this in the existing system store avoids a
            // schema upgrade while preserving the kernel's atomic CAS contract.
            logicalKey: 'system.entityRevisions', classification: 'system',
            defaultValue: objectDefault, normalize: normalizeObject, validate: isObject,
            export: false, import: 'ignore'
        }
    ].map(freezeEntry);

    function validateCatalog(entries) {
        if (!Array.isArray(entries) || !entries.length) throw new Error('DataCatalog requires at least one entry');
        const logicalKeys = new Set();
        for (const entry of entries) {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                throw new Error('DataCatalog entry must be an object');
            }
            if (!isNonEmptyString(entry.logicalKey) || logicalKeys.has(entry.logicalKey)) {
                throw new Error(`DataCatalog duplicate/invalid logical key: ${entry.logicalKey}`);
            }
            logicalKeys.add(entry.logicalKey);
        }
        for (const entry of entries) {
            if (!CATALOG_OWNERS.has(entry.owner) || !entry.logicalKey.startsWith(`${entry.owner}.`)) {
                throw new Error(`DataCatalog owner conflict for ${entry.logicalKey}: ${entry.owner}`);
            }
            if (!CATALOG_CLASSIFICATIONS.has(entry.classification)
                || !Number.isInteger(entry.schemaVersion) || entry.schemaVersion !== V2_SCHEMA_VERSION
                || typeof entry.defaultValue !== 'function'
                || typeof entry.normalize !== 'function'
                || typeof entry.validate !== 'function'
                || typeof entry.export !== 'boolean'
                || !IMPORT_POLICIES.has(entry.import)) {
                throw new Error(`DataCatalog incomplete contract: ${entry.logicalKey}`);
            }
            try {
                const defaultValue = entry.defaultValue();
                if (!entry.validate(defaultValue) || !entry.validate(entry.normalize(defaultValue))) {
                    throw new Error('invalid default');
                }
            } catch (_) {
                throw new Error(`DataCatalog invalid default contract: ${entry.logicalKey}`);
            }
        }
        return true;
    }

    validateCatalog(definitions);
    const byKey = new Map(definitions.map((entry) => [entry.logicalKey, entry]));
    const DataCatalog = Object.freeze({
        version: V2_SCHEMA_VERSION,
        list() { return definitions.slice(); },
        get(logicalKey) {
            const entry = byKey.get(String(logicalKey || ''));
            if (!entry) throw new Error(`DataCatalog unknown logical key: ${logicalKey}`);
            return entry;
        },
        has(logicalKey) { return byKey.has(String(logicalKey || '')); },
        validate: validateCatalog,
        clone
    });

    Object.defineProperty(global, '__AppDataV2Catalog', {
        value: DataCatalog,
        enumerable: false,
        configurable: true,
        writable: false
    });
})(typeof window !== 'undefined' ? window : globalThis);
