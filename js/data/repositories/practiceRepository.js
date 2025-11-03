(function(window) {
    const ExamData = window.ExamData = window.ExamData || {};
    const BaseRepository = ExamData.BaseRepository;

    function ensureArray(value) {
        return Array.isArray(value) ? value : [];
    }

    class PracticeRepository extends BaseRepository {
        constructor(dataSource, options = {}) {
            super({
                dataSource,
                key: options.key || 'practice_records',
                name: options.name || 'practice_records',
                defaultValue: () => [],
                migrations: [
                    (value) => ensureArray(value),
                    ...(options.migrations || [])
                ],
                validators: [
                    (value) => Array.isArray(value) || 'practice_records 必须为数组',
                    ...(options.validators || [])
                ],
                cloneOnRead: options.cloneOnRead !== false
            });
            if (Number.isFinite(options.maxRecords) && options.maxRecords > 0) {
                this.maxRecords = Math.floor(options.maxRecords);
            } else {
                this.maxRecords = Number.POSITIVE_INFINITY;
            }
        }

        normalizeRecord(record) {
            if (!record || typeof record !== 'object') {
                throw new Error('practice record 必须是对象');
            }
            const normalized = { ...record };
            if (!normalized.id) {
                normalized.id = `record_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            } else {
                normalized.id = String(normalized.id);
            }
            return normalized;
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
                if (record.score !== undefined && typeof record.score !== 'number') {
                    errors.push('score 必须是数字');
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

        _assertRecord(record) {
            const validation = this.validatePracticeRecord(record);
            if (!validation.isValid) {
                const error = new Error(`[practice_records] 记录无效: ${validation.errors.join(', ')}`);
                error.validationErrors = validation.errors;
                throw error;
            }
            return true;
        }

        async list(options = {}) {
            return await this.read({ ...options, clone: options.clone !== false });
        }

        async getById(id, options = {}) {
            const records = await this.read({ ...options, clone: true });
            return records.find(r => r.id === id) || null;
        }

        async overwrite(records, options = {}) {
            const list = ensureArray(records).map((record) => {
                const normalized = this.normalizeRecord(record);
                this._assertRecord(normalized);
                return normalized;
            });
            await this.write(list, { ...options, skipValidation: true });
            return true;
        }

        async upsert(record, options = {}) {
            const normalized = this.normalizeRecord(record);
            this._assertRecord(normalized);
            const merge = options.merge === true;
            return this.dataSource.runTransaction(async (tx) => {
                let records = await this.read({ transaction: tx, skipValidation: true, clone: true });
                records = ensureArray(records);
                const index = records.findIndex(r => r.id === normalized.id);
                if (index >= 0) {
                    records[index] = merge ? { ...records[index], ...normalized } : normalized;
                } else {
                    records.unshift(normalized);
                }
                if (Number.isFinite(this.maxRecords) && records.length > this.maxRecords) {
                    records = records.slice(0, this.maxRecords);
                }
                await this.write(records, { transaction: tx, skipValidation: true, clone: false });
                return normalized;
            }, { label: 'practice-upsert' });
        }

        async removeById(id, options = {}) {
            if (!id) return 0;
            const removed = await this.removeByIds([id], options);
            return removed;
        }

        async removeByIds(ids, options = {}) {
            const idSet = new Set((ids || []).filter(Boolean).map(String));
            if (idSet.size === 0) {
                return 0;
            }
            return this.dataSource.runTransaction(async (tx) => {
                let records = await this.read({ transaction: tx, skipValidation: true, clone: true });
                records = ensureArray(records);
                const next = records.filter(record => !idSet.has(record.id));
                const removed = records.length - next.length;
                if (removed > 0) {
                    await this.write(next, { transaction: tx, skipValidation: true, clone: false });
                }
                return removed;
            }, { label: 'practice-remove' });
        }

        async update(id, updates = {}, options = {}) {
            if (!id) {
                throw new Error('update 需要记录 id');
            }
            if (!updates || typeof updates !== 'object') {
                throw new Error('updates 必须是对象');
            }
            return this.dataSource.runTransaction(async (tx) => {
                let records = await this.read({ transaction: tx, skipValidation: true, clone: true });
                records = ensureArray(records);
                const index = records.findIndex(record => record.id === String(id));
                if (index === -1) {
                    return null;
                }
                const updated = { ...records[index], ...updates };
                this._assertRecord(updated);
                records[index] = updated;
                await this.write(records, { transaction: tx, skipValidation: true, clone: false });
                return updated;
            }, { label: 'practice-update' });
        }

        async count(options = {}) {
            const records = await this.read({ ...options, clone: false, skipValidation: false });
            return Array.isArray(records) ? records.length : 0;
        }

        async clear(options = {}) {
            await this.write([], { ...options, skipValidation: true });
            return true;
        }

        async runConsistencyCheck(options = {}) {
            const report = await super.runConsistencyCheck(options);
            if (!report.valid) {
                return report;
            }
            const errors = [];
            const records = ensureArray(report.data);
            for (const record of records) {
                const validation = this.validatePracticeRecord(record);
                if (!validation.isValid) {
                    errors.push(`记录 ${record && record.id ? record.id : 'unknown'}: ${validation.errors.join(', ')}`);
                }
            }
            if (errors.length > 0) {
                return { valid: false, errors };
            }
            return { valid: true, data: records, errors: [] };
        }
    }

    ExamData.PracticeRepository = PracticeRepository;
})(window);
