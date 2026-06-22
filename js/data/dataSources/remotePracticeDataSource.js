(function(window) {
    const ExamData = window.ExamData = window.ExamData || {};
    const MAX_REMOTE_PRACTICE_CLONE_DEPTH = 12;
    const MAX_REMOTE_PRACTICE_CLONE_NODES = 50000;
    const MAX_REMOTE_PRACTICE_ARRAY_ITEMS = 5000;
    const MAX_REMOTE_PRACTICE_OBJECT_KEYS = 500;
    const MAX_REMOTE_PRACTICE_STRING_LENGTH = 20000;
    const REMOTE_PRACTICE_UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

    function cloneRemotePracticeValue(value, depth = 0, state = { seen: new WeakSet(), nodes: 0 }) {
        if (value == null) {
            return value;
        }
        const valueType = typeof value;
        if (valueType === 'string') {
            return value.length > MAX_REMOTE_PRACTICE_STRING_LENGTH
                ? `${value.slice(0, MAX_REMOTE_PRACTICE_STRING_LENGTH)}...`
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
        if (depth > MAX_REMOTE_PRACTICE_CLONE_DEPTH) {
            return '[MaxDepth]';
        }
        if (state.seen.has(value)) {
            return '[Circular]';
        }
        if (state.nodes >= MAX_REMOTE_PRACTICE_CLONE_NODES) {
            return '[Truncated]';
        }

        state.nodes += 1;
        state.seen.add(value);
        try {
            if (Array.isArray(value)) {
                const list = value
                    .slice(0, MAX_REMOTE_PRACTICE_ARRAY_ITEMS)
                    .map((item) => cloneRemotePracticeValue(item, depth + 1, state))
                    .filter((item) => item !== undefined);
                if (value.length > MAX_REMOTE_PRACTICE_ARRAY_ITEMS) {
                    list.push(`[Truncated ${value.length - MAX_REMOTE_PRACTICE_ARRAY_ITEMS} items]`);
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
            for (const key of keys.slice(0, MAX_REMOTE_PRACTICE_OBJECT_KEYS)) {
                if (REMOTE_PRACTICE_UNSAFE_KEYS.has(key)) {
                    continue;
                }
                const safeValue = cloneRemotePracticeValue(value[key], depth + 1, state);
                if (safeValue !== undefined) {
                    output[key] = safeValue;
                }
            }
            if (keys.length > MAX_REMOTE_PRACTICE_OBJECT_KEYS) {
                output.__truncatedKeys = keys.length - MAX_REMOTE_PRACTICE_OBJECT_KEYS;
            }
            return output;
        } finally {
            state.seen.delete(value);
        }
    }

    function cloneValue(value) {
        if (ExamData.cloneValue) {
            try {
                return ExamData.cloneValue(value);
            } catch (_) {
                // Fallback below keeps local mirrors writable even when shared cloning is unavailable.
            }
        }
        return cloneRemotePracticeValue(value);
    }

    function isUnauthorized(error) {
        return error && error.status === 401;
    }

    function summarizeRemotePracticeErrorForLog(error) {
        if (!error || typeof error !== 'object') {
            return { name: typeof error };
        }
        const status = Number(error.status);
        return {
            name: typeof error.name === 'string' && error.name ? error.name.slice(0, 80) : 'Error',
            status: Number.isFinite(status) ? status : undefined
        };
    }

    function clearApiAuthState(apiClient) {
        if (!apiClient) {
            return;
        }
        if (typeof apiClient.clearAuthState === 'function') {
            apiClient.clearAuthState();
            return;
        }
        apiClient.user = null;
        apiClient.csrfToken = null;
        apiClient.pendingTotp = null;
    }

    class RemotePracticeTransactionContext {
        constructor(dataSource) {
            this.dataSource = dataSource;
            this.operations = [];
            this.cache = new Map();
        }

        async get(key, defaultValue) {
            if (this.cache.has(key)) {
                return this.cache.get(key);
            }
            const value = await this.dataSource.read(key, defaultValue);
            this.cache.set(key, value);
            return value;
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
            for (const operation of this.operations) {
                if (operation.type === 'set') {
                    await this.dataSource.write(operation.key, operation.value);
                } else if (operation.type === 'remove') {
                    await this.dataSource.remove(operation.key);
                }
            }
            this.operations = [];
        }

        async rollback() {
            this.operations = [];
        }
    }

    class RemotePracticeDataSource {
        constructor(localDataSource, apiClient, options = {}) {
            if (!localDataSource) {
                throw new Error('RemotePracticeDataSource requires a local data source');
            }
            if (!apiClient) {
                throw new Error('RemotePracticeDataSource requires a RemoteApiClient');
            }
            this.localDataSource = localDataSource;
            this.apiClient = apiClient;
            this.practiceKey = options.practiceKey || 'practice_records';
            this._queue = Promise.resolve();
        }

        isPracticeKey(key) {
            return key === this.practiceKey;
        }

        async read(key, defaultValue) {
            if (!this.isPracticeKey(key) || !this.apiClient.isAuthenticated()) {
                return this.localDataSource.read(key, defaultValue);
            }
            try {
                const records = await this.apiClient.listPracticeRecords();
                await this.localDataSource.write(key, cloneValue(records));
                return records;
            } catch (error) {
                if (isUnauthorized(error)) {
                    clearApiAuthState(this.apiClient);
                }
                console.warn('[RemotePracticeDataSource] 读取远端练习记录失败，回退本地:', summarizeRemotePracticeErrorForLog(error));
                return this.localDataSource.read(key, defaultValue);
            }
        }

        async write(key, value) {
            if (!this.isPracticeKey(key) || !this.apiClient.isAuthenticated()) {
                return this.localDataSource.write(key, value);
            }
            return this._enqueue(async () => {
                try {
                    const records = await this.apiClient.replacePracticeRecords(Array.isArray(value) ? value : []);
                    await this.localDataSource.write(key, cloneValue(records));
                    return true;
                } catch (error) {
                    if (isUnauthorized(error)) {
                        clearApiAuthState(this.apiClient);
                    }
                    console.warn('[RemotePracticeDataSource] 写入远端练习记录失败，回退本地:', summarizeRemotePracticeErrorForLog(error));
                    return this.localDataSource.write(key, value);
                }
            });
        }

        async remove(key) {
            if (!this.isPracticeKey(key) || !this.apiClient.isAuthenticated()) {
                return this.localDataSource.remove(key);
            }
            return this._enqueue(async () => {
                try {
                    const records = await this.apiClient.clearPracticeRecords();
                    await this.localDataSource.write(key, cloneValue(records));
                    return true;
                } catch (error) {
                    if (isUnauthorized(error)) {
                        clearApiAuthState(this.apiClient);
                    }
                    console.warn('[RemotePracticeDataSource] 清空远端练习记录失败，回退本地:', summarizeRemotePracticeErrorForLog(error));
                    return this.localDataSource.remove(key);
                }
            });
        }

        async runTransaction(handler) {
            if (typeof handler !== 'function') {
                throw new Error('RemotePracticeDataSource.runTransaction requires a handler function');
            }
            return this._enqueue(async () => {
                const context = new RemotePracticeTransactionContext(this);
                try {
                    const result = await handler(context);
                    await context.commit();
                    return result;
                } catch (error) {
                    await context.rollback();
                    console.error('[RemotePracticeDataSource] Transaction failed:', summarizeRemotePracticeErrorForLog(error));
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

    ExamData.RemotePracticeDataSource = RemotePracticeDataSource;
    ExamData.RemotePracticeTransactionContext = RemotePracticeTransactionContext;
})(window);
