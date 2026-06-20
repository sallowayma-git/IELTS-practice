(function(window) {
    const ExamData = window.ExamData = window.ExamData || {};

    function cloneValue(value) {
        if (ExamData.cloneValue) {
            return ExamData.cloneValue(value);
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (_) {
            return value;
        }
    }

    function isUnauthorized(error) {
        return error && error.status === 401;
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
                console.warn('[RemotePracticeDataSource] 读取远端练习记录失败，回退本地:', error);
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
                    console.warn('[RemotePracticeDataSource] 写入远端练习记录失败，回退本地:', error);
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
                    console.warn('[RemotePracticeDataSource] 清空远端练习记录失败，回退本地:', error);
                    return this.localDataSource.remove(key);
                }
            });
        }

        async runTransaction(handler, options = {}) {
            if (typeof handler !== 'function') {
                throw new Error('RemotePracticeDataSource.runTransaction requires a handler function');
            }
            const label = options.label || 'remote-practice-transaction';
            return this._enqueue(async () => {
                const context = new RemotePracticeTransactionContext(this);
                try {
                    const result = await handler(context);
                    await context.commit();
                    return result;
                } catch (error) {
                    await context.rollback();
                    console.error(`[RemotePracticeDataSource] Transaction failed (${label}):`, error);
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
