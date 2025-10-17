(function(window) {
    const ExamData = window.ExamData = window.ExamData || {};
    const BaseRepository = ExamData.BaseRepository;

    class MetaRepository {
        constructor(dataSource, definitions = {}) {
            if (!dataSource) {
                throw new Error('MetaRepository requires a dataSource instance');
            }
            this.dataSource = dataSource;
            this.repositories = new Map();
            Object.entries(definitions).forEach(([key, config]) => {
                this.registerKey(key, config);
            });
        }

        registerKey(key, config = {}) {
            const repository = new BaseRepository({
                dataSource: this.dataSource,
                key,
                name: config.name || `meta:${key}`,
                defaultValue: config.defaultValue !== undefined ? config.defaultValue : null,
                migrations: config.migrations || [],
                validators: config.validators || [],
                cloneOnRead: config.cloneOnRead !== false
            });
            this.repositories.set(key, repository);
            return repository;
        }

        _getRepo(key) {
            const repo = this.repositories.get(key);
            if (!repo) {
                throw new Error(`MetaRepository 未注册键: ${key}`);
            }
            return repo;
        }

        async get(key, defaultValue, options = {}) {
            const repo = this._getRepo(key);
            const resolvedDefault = defaultValue !== undefined ? defaultValue : undefined;
            return repo.read({ ...options, defaultValue: resolvedDefault, clone: options.clone !== false });
        }

        async set(key, value, options = {}) {
            const repo = this._getRepo(key);
            await repo.write(value, { ...options, skipValidation: false, clone: options.clone !== false });
            return true;
        }

        async remove(key, options = {}) {
            const repo = this._getRepo(key);
            await repo.remove(options);
            return true;
        }

        async runConsistencyCheck(keys) {
            const targetKeys = Array.isArray(keys) && keys.length ? keys : Array.from(this.repositories.keys());
            const report = {};
            for (const key of targetKeys) {
                const repo = this.repositories.get(key);
                if (!repo) continue;
                report[key] = await repo.runConsistencyCheck();
            }
            return report;
        }
    }

    ExamData.MetaRepository = MetaRepository;
})(window);
