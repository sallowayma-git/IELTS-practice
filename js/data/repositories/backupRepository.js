(function(window) {
    const ExamData = window.ExamData = window.ExamData || {};
    const BaseRepository = ExamData.BaseRepository;

    function ensureArray(value) {
        return Array.isArray(value) ? value : [];
    }

    class BackupRepository extends BaseRepository {
        constructor(dataSource, options = {}) {
            super({
                dataSource,
                key: options.key || 'manual_backups',
                name: options.name || 'manual_backups',
                defaultValue: () => [],
                migrations: [
                    (value) => ensureArray(value),
                    ...(options.migrations || [])
                ],
                validators: [
                    (value) => Array.isArray(value) || 'manual_backups 必须是数组',
                    ...(options.validators || [])
                ],
                cloneOnRead: options.cloneOnRead !== false
            });
            this.maxBackups = options.maxBackups || 20;
        }

        normalizeBackup(backup) {
            if (!backup || typeof backup !== 'object') {
                throw new Error('备份数据必须是对象');
            }
            const normalized = { ...backup };
            normalized.id = normalized.id ? String(normalized.id) : `backup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            normalized.timestamp = normalized.timestamp || new Date().toISOString();
            normalized.type = normalized.type || 'manual';
            normalized.version = normalized.version || '1.0.0';
            normalized.data = normalized.data || {};
            normalized.size = normalized.size || JSON.stringify(normalized.data).length;
            return normalized;
        }

        validateBackup(backup) {
            const errors = [];
            if (!backup || typeof backup !== 'object') {
                errors.push('备份必须是对象');
            } else {
                if (!backup.id) {
                    errors.push('备份缺少 id');
                }
                if (!backup.timestamp) {
                    errors.push('备份缺少 timestamp');
                }
                if (!backup.data || typeof backup.data !== 'object') {
                    errors.push('备份缺少 data 对象');
                }
            }
            return {
                isValid: errors.length === 0,
                errors
            };
        }

        _assertBackup(backup) {
            const validation = this.validateBackup(backup);
            if (!validation.isValid) {
                const error = new Error(`[manual_backups] 备份无效: ${validation.errors.join(', ')}`);
                error.validationErrors = validation.errors;
                throw error;
            }
            return true;
        }

        async list(options = {}) {
            return await this.read({ ...options, clone: options.clone !== false });
        }

        async add(backup, options = {}) {
            const normalized = this.normalizeBackup(backup);
            this._assertBackup(normalized);
            return this.dataSource.runTransaction(async (tx) => {
                let backups = ensureArray(await this.read({ transaction: tx, skipValidation: true, clone: true }));
                backups.unshift(normalized);
                if (this.maxBackups && backups.length > this.maxBackups) {
                    backups = backups.slice(0, this.maxBackups);
                }
                await this.write(backups, { transaction: tx, skipValidation: true, clone: false });
                return normalized;
            }, { label: 'backup-add' });
        }

        async saveAll(backups, options = {}) {
            const prepared = ensureArray(backups).map((item) => {
                const normalized = this.normalizeBackup(item);
                this._assertBackup(normalized);
                return normalized;
            });
            await this.write(prepared, { ...options, skipValidation: true });
            return true;
        }

        async delete(id, options = {}) {
            if (!id) return false;
            const targetId = String(id);
            return this.dataSource.runTransaction(async (tx) => {
                let backups = ensureArray(await this.read({ transaction: tx, skipValidation: true, clone: true }));
                const next = backups.filter(backup => backup.id !== targetId);
                const deleted = next.length !== backups.length;
                if (deleted) {
                    await this.write(next, { transaction: tx, skipValidation: true, clone: false });
                }
                return deleted;
            }, { label: 'backup-delete' });
        }

        async getById(id, options = {}) {
            if (!id) return null;
            const backups = await this.read({ ...options, clone: true });
            return backups.find(backup => backup.id === String(id)) || null;
        }

        async clear(options = {}) {
            await this.write([], { ...options, skipValidation: true });
            return true;
        }

        async prune(limit, options = {}) {
            const max = typeof limit === 'number' && limit > 0 ? limit : this.maxBackups;
            return this.dataSource.runTransaction(async (tx) => {
                let backups = ensureArray(await this.read({ transaction: tx, skipValidation: true, clone: true }));
                if (backups.length <= max) {
                    return backups.length;
                }
                const next = backups.slice(0, max);
                await this.write(next, { transaction: tx, skipValidation: true, clone: false });
                return next.length;
            }, { label: 'backup-prune' });
        }
    }

    ExamData.BackupRepository = BackupRepository;
})(window);
