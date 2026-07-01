(function(window) {
    const ExamData = window.ExamData = window.ExamData || {};

    function isProtectedPracticeDataKey(key) {
        return key === 'practice_records' || key === 'user_stats';
    }

    class StorageTransactionContext {
        constructor(storageManager, options = {}) {
            this.storage = storageManager;
            this.createInternalOptions = typeof options.createInternalOptions === 'function'
                ? options.createInternalOptions
                : null;
            this.operations = [];
            this.cache = new Map();
        }

        _internalOptions(key) {
            if (this.createInternalOptions) {
                return this.createInternalOptions();
            }
            if (isProtectedPracticeDataKey(key)) {
                throw new Error(`StorageTransactionContext cannot access protected key ${key} without internal storage access`);
            }
            return { skipPracticeCoreRedirect: true };
        }

        async get(key, defaultValue) {
            if (this.cache.has(key)) {
                return this.cache.get(key);
            }
            const resolvedDefault = typeof defaultValue === 'function' ? defaultValue() : defaultValue;
            const value = await this.storage.get(key, resolvedDefault, this._internalOptions(key));
            const finalValue = value === undefined ? resolvedDefault : value;
            this.cache.set(key, finalValue);
            return finalValue;
        }

        set(key, value) {
            this.cache.set(key, value);
            this.operations.push({ type: 'set', key, value });
        }

        remove(key) {
            this.cache.delete(key);
            this.operations.push({ type: 'remove', key });
        }

        async commit() {
            for (const op of this.operations) {
                if (op.type === 'set') {
                    await this.storage.set(op.key, op.value, this._internalOptions(op.key));
                } else if (op.type === 'remove') {
                    await this.storage.remove(op.key, this._internalOptions(op.key));
                }
            }
            this.operations = [];
        }

        async rollback() {
            this.operations = [];
        }
    }

    class StorageDataSource {
        constructor(storageManager, options = {}) {
            if (!storageManager) {
                throw new Error('StorageDataSource requires a StorageManager instance');
            }
            this.storage = storageManager;
            this.createInternalOptions = typeof options.createInternalOptions === 'function'
                ? options.createInternalOptions
                : null;
            this._queue = Promise.resolve();
        }

        _internalOptions(key) {
            if (this.createInternalOptions) {
                return this.createInternalOptions();
            }
            if (isProtectedPracticeDataKey(key)) {
                throw new Error(`StorageDataSource cannot access protected key ${key} without internal storage access`);
            }
            return { skipPracticeCoreRedirect: true };
        }

        async read(key, defaultValue) {
            const resolvedDefault = typeof defaultValue === 'function' ? defaultValue() : defaultValue;
            const value = await this.storage.get(key, resolvedDefault, this._internalOptions(key));
            return value === undefined ? resolvedDefault : value;
        }

        async write(key, value) {
            return this._enqueue(async () => {
                await this.storage.set(key, value, this._internalOptions(key));
                return true;
            });
        }

        async remove(key) {
            return this._enqueue(async () => {
                await this.storage.remove(key, this._internalOptions(key));
                return true;
            });
        }

        async runTransaction(handler, options = {}) {
            if (typeof handler !== 'function') {
                throw new Error('StorageDataSource.runTransaction requires a handler function');
            }
            const label = options.label || 'storage-transaction';
            return this._enqueue(async () => {
                const context = new StorageTransactionContext(this.storage, {
                    createInternalOptions: this.createInternalOptions
                });
                try {
                    const result = await handler(context);
                    await context.commit();
                    return result;
                } catch (error) {
                    await context.rollback();
                    console.error(`[StorageDataSource] Transaction failed (${label}):`, error);
                    throw error;
                }
            });
        }

        _enqueue(task) {
            const next = this._queue.then(task);
            this._queue = next.catch(() => {});
            return next;
        }
    }

    ExamData.StorageTransactionContext = StorageTransactionContext;
    ExamData.StorageDataSource = StorageDataSource;
})(window);
