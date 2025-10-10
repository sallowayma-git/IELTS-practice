(function(window) {
    class SimpleStorageWrapper {
        constructor(repositories) {
            this.repos = repositories;
        }

        get practiceRepo() { return this.repos.practice; }
        get settingsRepo() { return this.repos.settings; }
        get backupRepo() { return this.repos.backups; }
        get metaRepo() { return this.repos.meta; }

        async getPracticeRecords() { return await this.practiceRepo.list(); }
        async savePracticeRecords(records) { await this.practiceRepo.overwrite(records); return true; }
        async addPracticeRecord(record) { await this.practiceRepo.upsert(record); return true; }
        async getById(id) { return await this.practiceRepo.getById(id); }
        async update(id, updates) { return await this.practiceRepo.update(id, updates); }
        async delete(id) { const removed = await this.practiceRepo.removeById(id); return removed > 0; }
        async deletePracticeRecord(id) { return await this.delete(id); }
        async deletePracticeRecords(ids) { return await this.practiceRepo.removeByIds(ids); }
        async getPracticeRecordsCount() { return await this.practiceRepo.count(); }
        validatePracticeRecord(record) { return this.practiceRepo.validatePracticeRecord(record); }

        async getUserSettings() { return await this.settingsRepo.getAll(); }
        async saveUserSettings(settings) { await this.settingsRepo.saveAll(settings); return true; }
        async getUserSetting(key, defaultValue = null) { return await this.settingsRepo.get(key, defaultValue); }
        async setUserSetting(key, value) { await this.settingsRepo.set(key, value); return true; }

        async getBackups() { return await this.backupRepo.list(); }
        async saveBackups(backups) { await this.backupRepo.saveAll(backups); return true; }
        async addBackup(backup) { await this.backupRepo.add(backup); return true; }
        async deleteBackup(id) { return await this.backupRepo.delete(id); }
        async clearBackups() { await this.backupRepo.clear(); return true; }

        async get(key, defaultValue = null) { return await this.metaRepo.get(key, defaultValue); }
        async set(key, value) { await this.metaRepo.set(key, value); return true; }
        async remove(key) { await this.metaRepo.remove(key); return true; }
    }

    function initializeWrapper() {
        if (!window.dataRepositories) {
            setTimeout(initializeWrapper, 50);
            return;
        }
        window.simpleStorageWrapper = new SimpleStorageWrapper(window.dataRepositories);
        console.log('[SimpleStorageWrapper] 已连接新的数据仓库接口');
    }

    initializeWrapper();
})(window);
