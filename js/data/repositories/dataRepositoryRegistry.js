(function(window) {
    const ExamData = window.ExamData = window.ExamData || {};

    class DataRepositoryRegistry {
        constructor(dataSource) {
            if (!dataSource) {
                throw new Error('DataRepositoryRegistry requires a dataSource instance');
            }
            this.dataSource = dataSource;
            this._repositories = new Map();
        }

        register(name, repository) {
            if (!name) {
                throw new Error('Repository name is required');
            }
            if (!repository) {
                throw new Error(`Repository instance missing for ${name}`);
            }
            this._repositories.set(name, repository);
        }

        get(name) {
            return this._repositories.get(name);
        }

        listNames() {
            return Array.from(this._repositories.keys());
        }

        async transaction(names, handler) {
            if (typeof handler !== 'function') {
                throw new Error('transaction handler must be a function');
            }
            const targetNames = Array.isArray(names) && names.length > 0 ? names : this.listNames();
            return this.dataSource.runTransaction(async (tx) => {
                const scope = {};
                for (const name of targetNames) {
                    if (this._repositories.has(name)) {
                        scope[name] = this._repositories.get(name);
                    }
                }
                return handler(scope, tx);
            }, { label: `registry:${targetNames.join(',')}` });
        }

        async runConsistencyChecks(names) {
            const targetNames = Array.isArray(names) && names.length > 0 ? names : this.listNames();
            const report = {};
            for (const name of targetNames) {
                const repo = this._repositories.get(name);
                if (repo && typeof repo.runConsistencyCheck === 'function') {
                    try {
                        report[name] = await repo.runConsistencyCheck();
                    } catch (error) {
                        report[name] = {
                            valid: false,
                            errors: [error.message || String(error)]
                        };
                    }
                }
            }
            return report;
        }
    }

    ExamData.DataRepositoryRegistry = DataRepositoryRegistry;
})(window);
