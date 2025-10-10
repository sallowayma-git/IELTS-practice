(function(window) {
    const ExamData = window.ExamData = window.ExamData || {};
    const BaseRepository = ExamData.BaseRepository;

    function ensureObject(value) {
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    }

    class SettingsRepository extends BaseRepository {
        constructor(dataSource, options = {}) {
            super({
                dataSource,
                key: options.key || 'user_settings',
                name: options.name || 'user_settings',
                defaultValue: () => ({}),
                migrations: [
                    (value) => ensureObject(value),
                    ...(options.migrations || [])
                ],
                validators: [
                    (value) => (value && typeof value === 'object' && !Array.isArray(value)) || 'user_settings 必须是对象',
                    ...(options.validators || [])
                ],
                cloneOnRead: options.cloneOnRead !== false
            });
        }

        async getAll(options = {}) {
            return await this.read({ ...options, clone: options.clone !== false });
        }

        async saveAll(settings, options = {}) {
            const prepared = ensureObject(settings);
            await this.write(prepared, { ...options, skipValidation: false });
            return true;
        }

        async get(key, defaultValue = null, options = {}) {
            const settings = await this.read({ ...options, clone: true });
            if (Object.prototype.hasOwnProperty.call(settings, key)) {
                return settings[key];
            }
            return typeof defaultValue === 'function' ? defaultValue() : defaultValue;
        }

        async set(key, value, options = {}) {
            return this.merge({ [key]: value }, options);
        }

        async merge(patch, options = {}) {
            if (!patch || typeof patch !== 'object') {
                throw new Error('merge 需要对象参数');
            }
            return this.dataSource.runTransaction(async (tx) => {
                const current = ensureObject(await this.read({ transaction: tx, skipValidation: true, clone: true }));
                const next = { ...current, ...patch };
                await this.write(next, { transaction: tx, skipValidation: false, clone: false });
                return next;
            }, { label: 'settings-merge' });
        }

        async removeKey(key, options = {}) {
            return this.dataSource.runTransaction(async (tx) => {
                const current = ensureObject(await this.read({ transaction: tx, skipValidation: true, clone: true }));
                if (!Object.prototype.hasOwnProperty.call(current, key)) {
                    return current;
                }
                delete current[key];
                await this.write(current, { transaction: tx, skipValidation: false, clone: false });
                return current;
            }, { label: 'settings-remove-key' });
        }

        async clear(options = {}) {
            await this.write({}, { ...options, skipValidation: true });
            return true;
        }
    }

    ExamData.SettingsRepository = SettingsRepository;
})(window);
