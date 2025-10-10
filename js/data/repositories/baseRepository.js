(function(window) {
    const ExamData = window.ExamData = window.ExamData || {};

    function cloneValue(value) {
        if (value === null || value === undefined) {
            return value;
        }
        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (_) {
                // Fallback to JSON serialization below
            }
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (_) {
            return value;
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
            if (!skipValidation) {
                this.validate(value);
            }
            const dataToPersist = clone ? cloneValue(value) : value;
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
                        errors.push(`${this.name} 数据验证失败`);
                    } else if (typeof result === 'string') {
                        errors.push(result);
                    } else if (result && typeof result === 'object') {
                        if (result.valid === false || result.isValid === false) {
                            errors.push(result.message || result.error || `${this.name} 数据验证失败`);
                        }
                    }
                } catch (error) {
                    errors.push(error.message || String(error));
                }
            }
            if (errors.length > 0) {
                const err = new Error(`[${this.name}] 数据验证失败: ${errors.join('; ')}`);
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
                const errors = error.validationErrors || [error.message || String(error)];
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
    ExamData.BaseRepository = BaseRepository;
})(window);
