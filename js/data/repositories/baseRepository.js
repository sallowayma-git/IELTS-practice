(function(window) {
    const ExamData = window.ExamData = window.ExamData || {};
    const UNSAFE_REPOSITORY_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
    const MAX_REPOSITORY_SANITIZE_DEPTH = 24;
    const MAX_REPOSITORY_SANITIZE_NODES = 50000;
    const MAX_REPOSITORY_ARRAY_ITEMS = 5000;
    const MAX_REPOSITORY_OBJECT_KEYS = 500;
    const MAX_REPOSITORY_STRING_LENGTH = 20000;

    function getValidationFailureMessage(name) {
        return `${name || 'Repository'} data validation failed`;
    }

    function getValidatorExceptionMessage() {
        return 'Repository validator failed.';
    }

    function getConsistencyExceptionMessage(name) {
        return `${name || 'Repository'} consistency check failed.`;
    }

    function isPlainObject(value) {
        return value && Object.prototype.toString.call(value) === '[object Object]';
    }

    function sanitizeRepositoryValue(value, seen = null, depth = 0) {
        if (value === null || value === undefined) {
            return value;
        }
        const valueType = typeof value;
        if (valueType === 'string') {
            return value.length > MAX_REPOSITORY_STRING_LENGTH
                ? `${value.slice(0, MAX_REPOSITORY_STRING_LENGTH)}...`
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
        if (depth > MAX_REPOSITORY_SANITIZE_DEPTH) {
            return '[MaxDepth]';
        }

        const scanState = seen || {
            seen: new WeakSet(),
            nodes: 0
        };
        if (scanState.seen.has(value)) {
            return '[Circular]';
        }
        if (scanState.nodes >= MAX_REPOSITORY_SANITIZE_NODES) {
            return '[Truncated]';
        }
        scanState.nodes += 1;
        scanState.seen.add(value);

        if (Array.isArray(value)) {
            const output = [];
            try {
                value.slice(0, MAX_REPOSITORY_ARRAY_ITEMS).forEach((item) => {
                    const safeValue = sanitizeRepositoryValue(item, scanState, depth + 1);
                    if (safeValue !== undefined) {
                        output.push(safeValue);
                    }
                });
                if (value.length > MAX_REPOSITORY_ARRAY_ITEMS) {
                    output.push(`[Truncated ${value.length - MAX_REPOSITORY_ARRAY_ITEMS} items]`);
                }
                return output;
            } finally {
                scanState.seen.delete(value);
            }
        }
        if (!isPlainObject(value)) {
            scanState.seen.delete(value);
            return undefined;
        }

        const output = {};
        try {
            const keys = Object.keys(value);
            keys.slice(0, MAX_REPOSITORY_OBJECT_KEYS).forEach((key) => {
                if (UNSAFE_REPOSITORY_KEYS.has(key)) {
                    return;
                }
                const safeValue = sanitizeRepositoryValue(value[key], scanState, depth + 1);
                if (safeValue !== undefined) {
                    output[key] = safeValue;
                }
            });
            if (keys.length > MAX_REPOSITORY_OBJECT_KEYS) {
                output.__truncatedKeys = keys.length - MAX_REPOSITORY_OBJECT_KEYS;
            }
            return output;
        } finally {
            scanState.seen.delete(value);
        }
    }

    function cloneValue(value) {
        if (value === null || value === undefined) {
            return value;
        }
        if (typeof structuredClone === 'function') {
            try {
                return sanitizeRepositoryValue(structuredClone(value));
            } catch (_) {
                // Fallback to JSON serialization below
            }
        }
        try {
            return sanitizeRepositoryValue(JSON.parse(JSON.stringify(value)));
        } catch (_) {
            return sanitizeRepositoryValue(value);
        }
    }

    class BaseRepository {
        constructor(options) {
            const {
                dataSource,
                key,
                name,
                defaultValue = null,
                migrations = [],
                validators = [],
                cloneOnRead = true
            } = options || {};

            if (!dataSource) {
                throw new Error('BaseRepository requires a dataSource instance');
            }
            if (!key) {
                throw new Error('BaseRepository requires a storage key');
            }

            this.dataSource = dataSource;
            this.key = key;
            this.name = name || key;
            this.defaultValue = defaultValue;
            this.migrations = Array.isArray(migrations) ? migrations.slice() : [migrations];
            this.validators = Array.isArray(validators) ? validators.slice() : [validators];
            this.cloneOnRead = cloneOnRead;
        }

        _resolveDefaultValue(override) {
            const candidate = override !== undefined ? override : this.defaultValue;
            return typeof candidate === 'function' ? candidate() : candidate;
        }

        async read(options = {}) {
            const { transaction, defaultValue, skipValidation = false, clone = undefined } = options;
            const resolvedDefault = this._resolveDefaultValue(defaultValue);
            const sourceValue = transaction
                ? await transaction.get(this.key, resolvedDefault)
                : await this.dataSource.read(this.key, resolvedDefault);

            let value = sourceValue === undefined ? resolvedDefault : sourceValue;
            value = await this.applyMigrations(value, { transaction });
            value = sanitizeRepositoryValue(value);

            if (!skipValidation) {
                this.validate(value);
            }

            if (clone === false || (!this.cloneOnRead && clone === undefined)) {
                return value;
            }
            return cloneValue(value);
        }

        async write(value, options = {}) {
            const { transaction, skipValidation = false, clone = true } = options;
            const preparedValue = sanitizeRepositoryValue(value);
            if (!skipValidation) {
                this.validate(preparedValue);
            }
            const dataToPersist = clone ? cloneValue(preparedValue) : preparedValue;
            if (transaction) {
                transaction.set(this.key, dataToPersist);
                return true;
            }
            await this.dataSource.write(this.key, dataToPersist);
            return true;
        }

        async remove(options = {}) {
            const { transaction } = options;
            if (transaction) {
                transaction.remove(this.key);
                return true;
            }
            await this.dataSource.remove(this.key);
            return true;
        }

        async applyMigrations(value, context = {}) {
            let current = value;
            for (const migration of this.migrations) {
                if (typeof migration === 'function') {
                    current = await migration(current, { key: this.key, name: this.name, ...context });
                }
            }
            return current;
        }

        validate(value) {
            const errors = [];
            for (const validator of this.validators) {
                if (typeof validator !== 'function') {
                    continue;
                }
                try {
                    const result = validator(value);
                    if (result === false) {
                        errors.push(getValidationFailureMessage(this.name));
                    } else if (typeof result === 'string') {
                        errors.push(result);
                    } else if (result && typeof result === 'object') {
                        if (result.valid === false || result.isValid === false) {
                            errors.push(result.message || result.error || getValidationFailureMessage(this.name));
                        }
                    }
                } catch (error) {
                    errors.push(getValidatorExceptionMessage(error));
                }
            }
            if (errors.length > 0) {
                const err = new Error(`[${this.name}] ${getValidationFailureMessage(this.name)}: ${errors.join('; ')}`);
                err.validationErrors = errors;
                throw err;
            }
            return true;
        }

        async runConsistencyCheck(options = {}) {
            try {
                const data = await this.read({ ...options, skipValidation: false });
                return { valid: true, data, errors: [] };
            } catch (error) {
                const errors = error.validationErrors || [getConsistencyExceptionMessage(this.name)];
                return { valid: false, errors };
            }
        }

        registerMigration(fn) {
            if (typeof fn === 'function') {
                this.migrations.push(fn);
            }
        }

        registerValidator(fn) {
            if (typeof fn === 'function') {
                this.validators.push(fn);
            }
        }
    }

    ExamData.cloneValue = cloneValue;
    ExamData.sanitizeRepositoryValue = sanitizeRepositoryValue;
    ExamData.getValidationFailureMessage = getValidationFailureMessage;
    ExamData.getValidatorExceptionMessage = getValidatorExceptionMessage;
    ExamData.getConsistencyExceptionMessage = getConsistencyExceptionMessage;
    ExamData.BaseRepository = BaseRepository;
})(window);
