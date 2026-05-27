(function(window) {
    class SimpleStorageWrapper {
        constructor(repositories) {
            this.repos = repositories;
        }

        get settingsRepo() { return this.repos.settings; }
        get backupRepo() { return this.repos.backups; }
        get metaRepo() { return this.repos.meta; }

        isPracticeDataKey(key) {
            return key === 'practice_records' || key === 'user_stats';
        }

        getPracticeRecordAPI() {
            const api = window.PracticeRecordAPI;
            if (!api) {
                throw new Error('PracticeRecordAPI unavailable');
            }
            return api;
        }

        rejectPracticeDataWrite(methodName, targetName) {
            throw new Error(`SimpleStorageWrapper.${methodName} is disabled; use ${targetName}`);
        }

        async getPracticeRecords() {
            const api = this.getPracticeRecordAPI();
            if (typeof api.list !== 'function') {
                throw new Error('PracticeRecordAPI.list unavailable');
            }
            return await api.list();
        }

        async savePracticeRecords() {
            this.rejectPracticeDataWrite('savePracticeRecords', 'PracticeRecordAPI.replace');
        }

        async addPracticeRecord() {
            this.rejectPracticeDataWrite('addPracticeRecord', 'PracticeRecordAPI.saveRecord');
        }

        async getById(id) {
            const api = this.getPracticeRecordAPI();
            if (typeof api.getById !== 'function') {
                throw new Error('PracticeRecordAPI.getById unavailable');
            }
            return await api.getById(id);
        }

        async update() {
            this.rejectPracticeDataWrite('update', 'PracticeRecordAPI.saveRecord');
        }

        async delete() {
            this.rejectPracticeDataWrite('delete', 'PracticeRecordAPI.deleteById');
        }

        async deletePracticeRecord() {
            this.rejectPracticeDataWrite('deletePracticeRecord', 'PracticeRecordAPI.deleteById');
        }

        async deletePracticeRecords() {
            this.rejectPracticeDataWrite('deletePracticeRecords', 'PracticeRecordAPI.deleteMany');
        }

        async getPracticeRecordsCount() {
            const records = await this.getPracticeRecords();
            return Array.isArray(records) ? records.length : 0;
        }

        validatePracticeRecord(record) {
            const errors = [];
            if (!record || typeof record !== 'object') {
                errors.push('记录必须是对象');
            } else {
                if (!record.id || typeof record.id !== 'string') {
                    errors.push('记录缺少有效的 id');
                }
                if (!record.type || typeof record.type !== 'string') {
                    errors.push('记录缺少有效的 type');
                }
                if (record.score === undefined || record.score === null || typeof record.score !== 'number') {
                    errors.push('记录缺少有效的 score');
                }
                if (record.totalQuestions !== undefined && typeof record.totalQuestions !== 'number') {
                    errors.push('totalQuestions 必须是数字');
                }
                if (record.correctAnswers !== undefined && typeof record.correctAnswers !== 'number') {
                    errors.push('correctAnswers 必须是数字');
                }
                if (record.duration !== undefined && typeof record.duration !== 'number') {
                    errors.push('duration 必须是数字');
                }
                if (!record.date) {
                    errors.push('记录缺少有效的 date');
                } else if (Number.isNaN(new Date(record.date).getTime())) {
                    errors.push('date 格式无效');
                }
            }
            return {
                isValid: errors.length === 0,
                errors
            };
        }

        async getUserSettings() { return await this.settingsRepo.getAll(); }
        async saveUserSettings(settings) { await this.settingsRepo.saveAll(settings); return true; }
        async getUserSetting(key, defaultValue = null) { return await this.settingsRepo.get(key, defaultValue); }
        async setUserSetting(key, value) { await this.settingsRepo.set(key, value); return true; }

        async getBackups() { return await this.backupRepo.list(); }
        async saveBackups(backups) { await this.backupRepo.saveAll(backups); return true; }
        async addBackup(backup) { await this.backupRepo.add(backup); return true; }
        async deleteBackup(id) { return await this.backupRepo.delete(id); }
        async clearBackups() { await this.backupRepo.clear(); return true; }

        async get(key, defaultValue = null) {
            if (this.isPracticeDataKey(key)) {
                const api = this.getPracticeRecordAPI();
                if (key === 'practice_records') {
                    if (typeof api.list !== 'function') {
                        throw new Error('PracticeRecordAPI.list unavailable');
                    }
                    return await api.list();
                }
                if (typeof api.readStats !== 'function') {
                    throw new Error('PracticeRecordAPI.readStats unavailable');
                }
                return await api.readStats({ fallback: defaultValue });
            }
            return await this.metaRepo.get(key, defaultValue);
        }

        async set(key, value) {
            if (this.isPracticeDataKey(key)) {
                if (key === 'practice_records') {
                    this.rejectPracticeDataWrite('set(practice_records)', 'PracticeRecordAPI.replace');
                }
                this.rejectPracticeDataWrite('set(user_stats)', 'PracticeRecordAPI.writeStats');
            }
            await this.metaRepo.set(key, value);
            return true;
        }

        async remove(key) {
            if (this.isPracticeDataKey(key)) {
                if (key === 'practice_records') {
                    this.rejectPracticeDataWrite('remove(practice_records)', 'PracticeRecordAPI.clear');
                }
                this.rejectPracticeDataWrite('remove(user_stats)', 'PracticeRecordAPI.resetStats');
            }
            await this.metaRepo.remove(key);
            return true;
        }
    }

    function connectWrapper(repositories) {
        if (!repositories) {
            return;
        }
        if (window.simpleStorageWrapper && window.simpleStorageWrapper.repos === repositories) {
            return;
        }
        window.simpleStorageWrapper = new SimpleStorageWrapper(repositories);
        console.log('[SimpleStorageWrapper] 已连接新的数据仓库接口');
    }

    const registry = window.StorageProviderRegistry;
    if (registry && typeof registry.onProvidersReady === 'function') {
        registry.onProvidersReady(({ repositories }) => connectWrapper(repositories));
        const current = registry.getCurrentProviders && registry.getCurrentProviders();
        if (current && current.repositories) {
            connectWrapper(current.repositories);
        }
    } else if (window.dataRepositories) {
        connectWrapper(window.dataRepositories);
    } else {
        console.warn('[SimpleStorageWrapper] 数据仓库尚未可用，等待外部注入');
    }

    window.SimpleStorageWrapper = SimpleStorageWrapper;
})(window);
