(function(window) {
    const ExamData = window.ExamData = window.ExamData || {};

    class StorageTransactionContext {
        constructor(storageManager) {
            this.storage = storageManager;
            this.operations = [];
            this.cache = new Map();
        }

        async get(key, defaultValue) {
            if (this.cache.has(key)) {
                return this.cache.get(key);
            }
            const resolvedDefault = typeof defaultValue === 'function' ? defaultValue() : defaultValue;
            const value = await this.storage.get(key, resolvedDefault);
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
                    await this.storage.set(op.key, op.value);
                } else if (op.type === 'remove') {
                    await this.storage.remove(op.key);
                }
            }
            this.operations = [];
        }

        async rollback() {
            this.operations = [];
        }
    }

    class StorageDataSource {
        constructor(storageManager) {
            if (!storageManager) {
                throw new Error('StorageDataSource requires a StorageManager instance');
            }
            this.storage = storageManager;
            this._queue = Promise.resolve();
        }

        async read(key, defaultValue) {
            const resolvedDefault = typeof defaultValue === 'function' ? defaultValue() : defaultValue;
            const value = await this.storage.get(key, resolvedDefault);
            return value === undefined ? resolvedDefault : value;
        }

        async write(key, value) {
            return this._enqueue(async () => {
                await this.storage.set(key, value);
                return true;
            });
        }

        async remove(key) {
            return this._enqueue(async () => {
                await this.storage.remove(key);
                return true;
            });
        }

        async runTransaction(handler, options = {}) {
            if (typeof handler !== 'function') {
                throw new Error('StorageDataSource.runTransaction requires a handler function');
            }
            const label = options.label || 'storage-transaction';
            return this._enqueue(async () => {
                const context = new StorageTransactionContext(this.storage);
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
