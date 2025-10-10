/**
 * 成绩记录和存储系统
 * 负责答题结果解析、标准化存储和数据备份恢复
 */
class ScoreStorage {
    constructor(options = {}) {
        this.repositories = options.repositories || window.dataRepositories;
        if (!this.repositories) {
            throw new Error('数据仓库未初始化，无法构建 ScoreStorage');
        }

        this.storageKeys = {
            practiceRecords: 'practice_records',
            userStats: 'user_stats',
            storageVersion: 'storage_version',
            backupData: 'manual_backups'
        };

        this.currentVersion = '1.0.0';
        this.maxRecords = 1000;
        this.storage = this.createStorageAdapter();

        this.initialize();
    }

    createStorageAdapter() {
        const practiceRepo = this.repositories.practice;
        const metaRepo = this.repositories.meta;
        const backupRepo = this.repositories.backups;
        const keys = this.storageKeys;
        const self = this;

        return {
            async get(key, defaultValue = null) {
                switch (key) {
                    case keys.practiceRecords:
                        return await practiceRepo.list();
                    case keys.userStats: {
                        const fallback = defaultValue !== null && defaultValue !== undefined ? defaultValue : self.getDefaultUserStats();
                        const stats = await metaRepo.get('user_stats', fallback);
                        return stats || self.getDefaultUserStats();
                    }
                    case keys.storageVersion:
                        return await metaRepo.get('storage_version', defaultValue);
                    case keys.backupData:
                    case 'manual_backups':
                        return await backupRepo.list();
                    default:
                        return await metaRepo.get(key, defaultValue);
                }
            },
            async set(key, value) {
                switch (key) {
                    case keys.practiceRecords:
                        await practiceRepo.overwrite(Array.isArray(value) ? value : []);
                        return true;
                    case keys.userStats:
                        await metaRepo.set('user_stats', value);
                        return true;
                    case keys.storageVersion:
                        await metaRepo.set('storage_version', value);
                        return true;
                    case keys.backupData:
                    case 'manual_backups':
                        await backupRepo.saveAll(Array.isArray(value) ? value : []);
                        return true;
                    default:
                        await metaRepo.set(key, value);
                        return true;
                }
            },
            async remove(key) {
                switch (key) {
                    case keys.practiceRecords:
                        await practiceRepo.clear();
                        return true;
                    case keys.userStats:
                        await metaRepo.remove('user_stats');
                        return true;
                    case keys.storageVersion:
                        await metaRepo.remove('storage_version');
                        return true;
                    case keys.backupData:
                    case 'manual_backups':
                        await backupRepo.clear();
                        return true;
                    default:
                        await metaRepo.remove(key);
                        return true;
                }
            }
        };
    }

    /**
     * 初始化存储系统
     */
    async initialize() {
        console.log('ScoreStorage initialized');

        // 检查存储版本并迁移数据
        await this.checkStorageVersion();

        // 初始化数据结构
        await this.initializeDataStructures();

        // 暂时禁用清理过期数据，避免误删新记录
        // await this.cleanupExpiredData();
    }

    /**
     * 检查存储版本
     */
    async checkStorageVersion() {
        const normalizeVersion = v => {
          if (v === undefined || v === null) return '';
          const s = String(v).trim();
          return s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
        };
        const storedVersionRaw = await this.storage.get(this.storageKeys.storageVersion);
        const storedVersion = normalizeVersion(storedVersionRaw);
        const current = normalizeVersion(this.currentVersion);
        if (!storedVersion) {
          await this.storage.set(this.storageKeys.storageVersion, current);
          console.log('Storage version initialized:', current);
          return;
        }
        if (storedVersion !== current) {
          await this.migrateData(storedVersion, current);
        } else {
          console.log('[ScoreStorage] 版本匹配，跳过迁移');
        }
    }

    /**
     * 数据迁移
     */
    async migrateData(fromVersion, toVersion) {
        if (String(fromVersion) === String(toVersion)) {
          console.log('[ScoreStorage] migrateData skipped: same version');
          return;
        }
        console.log(`Migrating data from ${fromVersion} to ${toVersion}`);

        try {
            // 备份当前数据
            await this.createBackup('migration_backup');

            // 根据版本执行相应的迁移逻辑
            if (fromVersion < '1.0.0') {
                await this.migrateToV1();
            }

            // 更新版本号
            await this.storage.set(this.storageKeys.storageVersion, toVersion);
            console.log('Data migration completed successfully');

        } catch (error) {
            console.error('Data migration failed:', error);
            // 恢复备份数据
            try {
                await this.restoreBackup('migration_backup');
            } catch (restoreError) {
                console.error('Failed to restore backup:', restoreError);
            }
        }
    }

    /**
     * 迁移到版本1.0.0
     */
    async migrateToV1() {
        // 标准化练习记录格式
        const records = await this.storage.get(this.storageKeys.practiceRecords, []);
        const standardizedRecords = records.map(record => this.standardizeRecord(record));
        await this.storage.set(this.storageKeys.practiceRecords, standardizedRecords);

        // 重新计算用户统计
        await this.recalculateUserStats();
    }

    /**
     * 初始化数据结构
     */
    async initializeDataStructures() {
        // 确保基础数据结构存在
        const existingRecords = await this.storage.get(this.storageKeys.practiceRecords);
        if (existingRecords === null || existingRecords === undefined) {
            console.log('[ScoreStorage] 初始化练习记录数组');
            await this.storage.set(this.storageKeys.practiceRecords, []);
        } else {
            console.log(`[ScoreStorage] 保留现有练习记录: ${existingRecords.length} 条`);
        }

        const existingStats = await this.storage.get(this.storageKeys.userStats);
        if (existingStats === null || existingStats === undefined) {
            console.log('[ScoreStorage] 初始化用户统计');
            await this.storage.set(this.storageKeys.userStats, this.getDefaultUserStats());
        } else {
            console.log('[ScoreStorage] 保留现有用户统计');
        }
    }

    /**
     * 获取默认用户统计
     */
    getDefaultUserStats() {
        if (window.ExamData && typeof window.ExamData.createDefaultUserStats === 'function') {
            return window.ExamData.createDefaultUserStats();
        }
        const now = new Date().toISOString();
        return {
            totalPractices: 0,
            totalTimeSpent: 0,
            averageScore: 0,
            categoryStats: {},
            questionTypeStats: {},
            streakDays: 0,
            lastPracticeDate: null,
            achievements: [],
            createdAt: now,
            updatedAt: now
        };
    }

    /**
     * 保存练习记录
     */
    async savePracticeRecord(recordData) {
        try {
            // 标准化记录格式
            const standardizedRecord = this.standardizeRecord(recordData);
            
            // 验证记录数据
            this.validateRecord(standardizedRecord);
            
            // 获取现有记录
            const records = await this.storage.get(this.storageKeys.practiceRecords, []);

            // 检查是否已存在相同ID的记录
            const existingIndex = records.findIndex(r => r.id === standardizedRecord.id);
            if (existingIndex !== -1) {
                console.log('更新现有记录:', standardizedRecord.id);
                records[existingIndex] = standardizedRecord;
            } else {
                // 添加新记录到开头（保持最新记录在前）
                records.unshift(standardizedRecord);
            }

            // 维护记录数量限制
            if (records.length > this.maxRecords) {
                records.splice(this.maxRecords);
            }

            // 保存记录
            const saveResult = await this.storage.set(this.storageKeys.practiceRecords, records);
            if (!saveResult) {
                throw new Error('Failed to save records to storage');
            }

            // 更新用户统计
            await this.updateUserStats(standardizedRecord);
            
            console.log('Practice record saved:', standardizedRecord.id);
            return standardizedRecord;
            
        } catch (error) {
            console.error('Failed to save practice record:', error);
            throw error;
        }
    }

    /**
     * 标准化记录格式
     */
    standardizeRecord(recordData) {
        const now = new Date().toISOString();
        
        return {
            // 基础信息
            id: recordData.id || this.generateRecordId(),
            examId: recordData.examId,
            sessionId: recordData.sessionId,
            
            // 时间信息
            startTime: recordData.startTime,
            endTime: recordData.endTime,
            duration: recordData.duration || 0,
            
            // 成绩信息
            status: recordData.status || 'completed',
            score: recordData.score || 0,
            totalQuestions: recordData.totalQuestions || 0,
            correctAnswers: recordData.correctAnswers || 0,
            accuracy: recordData.accuracy || 0,
            
            // 答题详情
            answers: this.standardizeAnswers(recordData.answers || []),
            questionTypePerformance: recordData.questionTypePerformance || {},
            
            // 元数据
            metadata: {
                examTitle: '',
                category: '',
                frequency: '',
                ...recordData.metadata
            },
            
            // 系统信息
            version: this.currentVersion,
            createdAt: recordData.createdAt || now,
            updatedAt: now
        };
    }

    /**
     * 标准化答案格式
     */
    standardizeAnswers(answers) {
        if (!Array.isArray(answers)) {
            answers = [];
        }
        return answers.map((answer, index) => ({
            questionId: answer.questionId || `q${index + 1}`,
            answer: answer.answer || '',
            correct: Boolean(answer.correct),
            timeSpent: answer.timeSpent || 0,
            questionType: answer.questionType || 'unknown',
            timestamp: answer.timestamp || new Date().toISOString()
        }));
    }

    /**
     * 验证记录数据
     */
    validateRecord(record) {
        const requiredFields = ['id', 'examId', 'startTime', 'endTime'];
        
        for (const field of requiredFields) {
            if (!record[field]) {
                throw new Error(`Missing required field: ${field}`);
            }
        }
        
        // 验证时间格式
        if (new Date(record.startTime).toString() === 'Invalid Date') {
            throw new Error('Invalid startTime format');
        }
        
        if (new Date(record.endTime).toString() === 'Invalid Date') {
            throw new Error('Invalid endTime format');
        }
        
        // 验证数值范围
        if (record.accuracy < 0 || record.accuracy > 1) {
            throw new Error('Accuracy must be between 0 and 1');
        }
        
        if (record.duration < 0) {
            throw new Error('Duration cannot be negative');
        }
    }

    /**
     * 更新用户统计
     */
    async updateUserStats(practiceRecord) {
        const stats = await this.storage.get(this.storageKeys.userStats, this.getDefaultUserStats());
        
        // 更新基础统计
        stats.totalPractices += 1;
        stats.totalTimeSpent += practiceRecord.duration;
        
        // 计算平均分数
        const totalScore = (stats.averageScore * (stats.totalPractices - 1)) + practiceRecord.accuracy;
        stats.averageScore = totalScore / stats.totalPractices;
        
        // 更新分类统计
        this.updateCategoryStats(stats, practiceRecord);
        
        // 更新题型统计
        this.updateQuestionTypeStats(stats, practiceRecord);
        
        // 更新连续学习天数
        this.updateStreakDays(stats, practiceRecord);
        
        // 检查成就
        this.checkAchievements(stats, practiceRecord);
        
        // 更新时间戳
        stats.updatedAt = new Date().toISOString();
        
        // 保存统计数据
        await this.storage.set(this.storageKeys.userStats, stats);
        
        console.log('User stats updated');
    }

    /**
     * 更新分类统计
     */
    updateCategoryStats(stats, practiceRecord) {
        const category = practiceRecord.metadata.category;
        if (!category) return;
        
        if (!stats.categoryStats[category]) {
            stats.categoryStats[category] = {
                practices: 0,
                avgScore: 0,
                timeSpent: 0,
                bestScore: 0,
                totalQuestions: 0,
                correctAnswers: 0
            };
        }
        
        const catStats = stats.categoryStats[category];
        catStats.practices += 1;
        catStats.timeSpent += practiceRecord.duration;
        catStats.totalQuestions += practiceRecord.totalQuestions;
        catStats.correctAnswers += practiceRecord.correctAnswers;
        catStats.bestScore = Math.max(catStats.bestScore, practiceRecord.accuracy);
        
        // 重新计算平均分数
        const catTotalScore = (catStats.avgScore * (catStats.practices - 1)) + practiceRecord.accuracy;
        catStats.avgScore = catTotalScore / catStats.practices;
    }

    /**
     * 更新题型统计
     */
    updateQuestionTypeStats(stats, practiceRecord) {
        if (!practiceRecord.questionTypePerformance) return;
        
        Object.entries(practiceRecord.questionTypePerformance).forEach(([type, performance]) => {
            if (!stats.questionTypeStats[type]) {
                stats.questionTypeStats[type] = {
                    practices: 0,
                    accuracy: 0,
                    totalQuestions: 0,
                    correctAnswers: 0,
                    avgTimePerQuestion: 0
                };
            }
            
            const typeStats = stats.questionTypeStats[type];
            typeStats.practices += 1;
            typeStats.totalQuestions += performance.total || 0;
            typeStats.correctAnswers += performance.correct || 0;
            
            // 重新计算准确率
            typeStats.accuracy = typeStats.totalQuestions > 0 
                ? typeStats.correctAnswers / typeStats.totalQuestions 
                : 0;
            
            // 计算平均每题用时
            if (performance.timeSpent && performance.total) {
                const newAvgTime = performance.timeSpent / performance.total;
                typeStats.avgTimePerQuestion = (typeStats.avgTimePerQuestion * (typeStats.practices - 1) + newAvgTime) / typeStats.practices;
            }
        });
    }

    /**
     * 更新连续学习天数
     */
    updateStreakDays(stats, practiceRecord) {
        const today = new Date(practiceRecord.startTime).toDateString();
        const lastDate = stats.lastPracticeDate ? new Date(stats.lastPracticeDate).toDateString() : null;
        
        if (lastDate !== today) {
            if (lastDate) {
                const daysDiff = (new Date(today) - new Date(lastDate)) / (1000 * 60 * 60 * 24);
                if (daysDiff === 1) {
                    stats.streakDays += 1;
                } else if (daysDiff > 1) {
                    stats.streakDays = 1;
                }
            } else {
                stats.streakDays = 1;
            }
            stats.lastPracticeDate = today;
        }
    }

    /**
     * 检查成就
     */
    checkAchievements(stats, practiceRecord) {
        const achievements = stats.achievements || [];
        
        // 首次练习成就
        if (stats.totalPractices === 1 && !achievements.includes('first-practice')) {
            achievements.push('first-practice');
        }
        
        // 连续学习成就
        if (stats.streakDays >= 7 && !achievements.includes('week-streak')) {
            achievements.push('week-streak');
        }
        
        if (stats.streakDays >= 30 && !achievements.includes('month-streak')) {
            achievements.push('month-streak');
        }
        
        // 高分成就
        if (practiceRecord.accuracy >= 0.9 && !achievements.includes('high-scorer')) {
            achievements.push('high-scorer');
        }
        
        // 分类掌握成就
        const category = practiceRecord.metadata.category;
        if (category && stats.categoryStats[category]) {
            const catStats = stats.categoryStats[category];
            if (catStats.practices >= 10 && catStats.avgScore >= 0.8) {
                const achievementKey = `${category.toLowerCase()}-master`;
                if (!achievements.includes(achievementKey)) {
                    achievements.push(achievementKey);
                }
            }
        }
        
        stats.achievements = achievements;
    }

    /**
     * 获取练习记录
     */
    async getPracticeRecords(filters = {}) {
        const raw = await this.storage.get(this.storageKeys.practiceRecords, []);
        const base = Array.isArray(raw) ? raw : [];
        // Normalize each record to ensure UI can rely on a stable shape
        const records = base.map(r => this.normalizeRecordFields(r));

        if (Object.keys(filters).length === 0) {
            return records.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
        }

        return records.filter(record => {
            // 按考试ID筛选
            if (filters.examId && record.examId !== filters.examId) return false;
            
            // 按分类筛选
            if (filters.category && record.metadata.category !== filters.category) return false;
            
            // 按时间范围筛选
            if (filters.startDate && new Date(record.startTime) < new Date(filters.startDate)) return false;
            if (filters.endDate && new Date(record.startTime) > new Date(filters.endDate)) return false;
            
            // 按准确率筛选
            if (filters.minAccuracy && record.accuracy < filters.minAccuracy) return false;
            if (filters.maxAccuracy && record.accuracy > filters.maxAccuracy) return false;
            
            // 按状态筛选
            if (filters.status && record.status !== filters.status) return false;
            
            return true;
        }).sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    }

    /**
     * 获取用户统计
     */
    async getUserStats() {
        return await this.storage.get(this.storageKeys.userStats, this.getDefaultUserStats());
    }

    /**
     * 重新计算用户统计
     */
    async recalculateUserStats() {
        console.log('Recalculating user stats...');

        const records = (await this.storage.get(this.storageKeys.practiceRecords, []) || []).map(r => this.normalizeRecordFields(r));
        const stats = this.getDefaultUserStats();

        // 重新计算所有统计数据
        for (const record of records) {
            await this.updateUserStats(record);
        }

        console.log('User stats recalculated');
    }

    /**
     * 将不同来源/版本的记录统一为稳定字段，以便 UI/统计可靠工作
     * 不修改存储中的原始对象，仅在返回路径做兼容填充
     */
    normalizeRecordFields(record) {
        try {
            const r = { ...(record || {}) };

            // metadata 兜底
            r.metadata = {
                examTitle: (r.metadata && r.metadata.examTitle) || r.title || r.examTitle || r.examId || '',
                category: (r.metadata && r.metadata.category) || r.category || '',
                frequency: (r.metadata && r.metadata.frequency) || r.frequency || '',
                ...(r.metadata || {})
            };

            // 时间字段归一
            const rd = r.realData || {};
            if (!r.startTime) {
                if (typeof rd.startTime === 'number') {
                    r.startTime = new Date(rd.startTime).toISOString();
                } else if (rd.startTime) {
                    r.startTime = new Date(rd.startTime).toISOString();
                } else if (r.date) {
                    r.startTime = new Date(r.date).toISOString();
                }
            }
            if (!r.endTime) {
                if (typeof rd.endTime === 'number') {
                    r.endTime = new Date(rd.endTime).toISOString();
                } else if (rd.endTime) {
                    r.endTime = new Date(rd.endTime).toISOString();
                } else if (r.startTime && (r.duration || rd.duration)) {
                    const base = new Date(r.startTime).getTime();
                    const seconds = (Number(r.duration || rd.duration) || 0);
                    r.endTime = new Date(base + seconds * 1000).toISOString();
                }
            }

            // 用时归一（秒）: consider multiple possible fields; prefer positive seconds
            if (!(typeof r.duration === 'number' && isFinite(r.duration) && r.duration > 0)) {
                const sInfo = r.scoreInfo || rd.scoreInfo || {};
                const candidates = [
                    r.duration, rd.duration, r.durationSeconds, r.duration_seconds,
                    r.elapsedSeconds, r.elapsed_seconds, r.timeSpent, r.time_spent,
                    rd.durationSeconds, rd.elapsedSeconds, rd.timeSpent,
                    sInfo.duration, sInfo.timeSpent
                ];
                let picked;
                for (const v of candidates) {
                    const n = Number(v);
                    if (Number.isFinite(n) && n > 0) { picked = n; break; }
                }
                if (picked !== undefined) {
                    r.duration = Math.floor(picked);
                } else if (r.startTime && r.endTime) {
                    r.duration = Math.max(0, Math.floor((new Date(r.endTime) - new Date(r.startTime)) / 1000));
                } else if (Array.isArray(rd.interactions) && rd.interactions.length) {
                    // Derive from interactions timestamp span
                    try {
                        const ts = rd.interactions.map(x => x && Number(x.timestamp)).filter(n => Number.isFinite(n));
                        if (ts.length) {
                            const span = Math.max(...ts) - Math.min(...ts);
                            if (Number.isFinite(span) && span > 0) r.duration = Math.floor(span / 1000);
                        }
                    } catch(_) {}
                } else {
                    r.duration = 0;
                }
            }

            // scoreInfo 归一
            const sInfo = r.scoreInfo || rd.scoreInfo || {};
            if (!r.scoreInfo && (rd.scoreInfo || r.answerComparison)) {
                r.scoreInfo = sInfo;
            }

            // answers 归一
            if (!r.answers && rd.answers) {
                r.answers = rd.answers;
            }

            // 正确/总题数归一
            const derivedCorrect = (typeof r.correctAnswers === 'number') ? r.correctAnswers
                                 : (typeof r.score === 'number' ? r.score
                                    : (typeof sInfo.correct === 'number' ? sInfo.correct : null));

            const derivedTotal = (typeof r.totalQuestions === 'number') ? r.totalQuestions
                               : (typeof sInfo.total === 'number' ? sInfo.total
                                  : (r.realData && typeof r.realData.totalQuestions === 'number' ? r.realData.totalQuestions
                                     : (r.answers ? Object.keys(r.answers).length
                                        : (rd.answers ? Object.keys(rd.answers || {}).length : null))));

            if (typeof r.correctAnswers !== 'number' && derivedCorrect != null) {
                r.correctAnswers = derivedCorrect;
            }
            if (typeof r.totalQuestions !== 'number' && derivedTotal != null) {
                r.totalQuestions = derivedTotal;
            }

            // 准确率/百分比归一
            let acc = (typeof r.accuracy === 'number') ? r.accuracy
                    : (typeof sInfo.accuracy === 'number' ? sInfo.accuracy : null);
            if (acc == null) {
                if (typeof r.correctAnswers === 'number' && typeof r.totalQuestions === 'number' && r.totalQuestions > 0) {
                    acc = r.correctAnswers / r.totalQuestions;
                } else {
                    acc = 0;
                }
            }
            r.accuracy = acc;

            if (typeof r.percentage !== 'number' || isNaN(r.percentage)) {
                if (typeof sInfo.percentage === 'number') {
                    r.percentage = sInfo.percentage;
                } else {
                    r.percentage = Math.round(acc * 100);
                }
            }

            // 状态兜底
            if (!r.status) r.status = 'completed';

            return r;
        } catch (e) {
            try { console.warn('[ScoreStorage] normalizeRecordFields failed:', e); } catch(_) {}
            return record;
        }
    }

    /**
     * 创建数据备份 - 使用DataBackupManager
     */
    async createBackup(backupName = null) {
        if (window.DataBackupManager) {
            const backupManager = new DataBackupManager();
            const practiceRecords = await this.storage.get(this.storageKeys.practiceRecords, []);
            const userStats = await this.storage.get(this.storageKeys.userStats, {});

            // 构建与DataBackupManager兼容的备份对象
            const backup = {
                id: backupName || `score_backup_${Date.now()}`,
                timestamp: new Date().toISOString(),
                type: 'score_storage',
                data: {
                    practiceRecords,
                    userStats,
                    storageVersion: await this.storage.get(this.storageKeys.storageVersion)
                }
            };

            // 获取现有备份
            const backups = await this.storage.get('manual_backups', []);
            backups.unshift(backup);

            // 保持最多20个备份
            if (backups.length > 20) {
                backups.splice(20);
            }

            await this.storage.set('manual_backups', backups);
            console.log('[ScoreStorage] Backup created:', backup.id);
            return backup.id;
        } else {
            // 降级：不创建备份
            console.warn('[ScoreStorage] DataBackupManager not available, skipping backup');
            return null;
        }
    }

    /**
     * 恢复数据备份 - 直接操作manual_backups存储
     */
    async restoreBackup(backupId) {
        try {
            const backups = await this.storage.get('manual_backups', []);
            const backup = backups.find(b => b.id === backupId);

            if (!backup) {
                throw new Error(`Backup not found: ${backupId}`);
            }

            if (backup.data) {
                await this.storage.set(this.storageKeys.practiceRecords, backup.data.practiceRecords);
                await this.storage.set(this.storageKeys.userStats, backup.data.userStats);
                if (backup.data.storageVersion) {
                    await this.storage.set(this.storageKeys.storageVersion, backup.data.storageVersion);
                }
            }

            console.log('[ScoreStorage] Backup restored:', backupId);
            return backup;
        } catch (error) {
            console.error('[ScoreStorage] Failed to restore backup:', error);
            throw error;
        }
    }

    /**
     * 获取备份列表 - 直接从manual_backups存储获取
     */
    async getBackups() {
        try {
            const backups = await this.storage.get('manual_backups', []);
            // 只返回score_storage类型的备份，按时间倒序排列
            return backups
                .filter(b => b.type === 'score_storage')
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        } catch (error) {
            console.error('[ScoreStorage] Failed to get backups:', error);
            return [];
        }
    }

    /**
     * 导出数据
     */
    async exportData(format = 'json') {
        const exportData = {
            exportDate: new Date().toISOString(),
            version: this.currentVersion,
            practiceRecords: await this.storage.get(this.storageKeys.practiceRecords, []),
            userStats: await this.storage.get(this.storageKeys.userStats, {}),
            backups: await this.storage.get(this.storageKeys.backupData, [])
        };
        
        switch (format.toLowerCase()) {
            case 'json':
                return JSON.stringify(exportData, null, 2);
            case 'csv':
                return this.convertToCSV(exportData.practiceRecords);
            default:
                throw new Error(`Unsupported export format: ${format}`);
        }
    }

    /**
     * 转换为CSV格式
     */
    convertToCSV(records) {
        if (records.length === 0) return '';
        
        const headers = [
            'ID', '考试ID', '开始时间', '结束时间', '用时(秒)', 
            '状态', '分数', '总题数', '正确数', '准确率', 
            '分类', '频率', '题目标题'
        ];
        
        const rows = records.map(record => [
            record.id,
            record.examId,
            record.startTime,
            record.endTime,
            record.duration,
            record.status,
            record.score,
            record.totalQuestions,
            record.correctAnswers,
            Math.round(record.accuracy * 100) + '%',
            record.metadata.category || '',
            record.metadata.frequency || '',
            record.metadata.examTitle || ''
        ]);
        
        return [headers, ...rows]
            .map(row => row.map(cell => `"${cell}"`).join(','))
            .join('\n');
    }

    /**
     * 导入数据
     */
    async importData(importData, options = {}) {
        try {
            const data = typeof importData === 'string' ? JSON.parse(importData) : importData;
            
            // 验证数据格式
            if (!data.practiceRecords || !Array.isArray(data.practiceRecords)) {
                throw new Error('Invalid import data format');
            }
            
            // 创建备份
            const backupId = await this.createBackup('pre_import_backup');
            
            if (options.merge) {
                // 合并模式：添加新记录
                const existingRecords = await this.storage.get(this.storageKeys.practiceRecords, []);
                const existingIds = new Set(existingRecords.map(r => r.id));

                const newRecords = data.practiceRecords.filter(r => !existingIds.has(r.id));
                const mergedRecords = [...existingRecords, ...newRecords];

                await this.storage.set(this.storageKeys.practiceRecords, mergedRecords);

                // 重新计算统计
                await this.recalculateUserStats();

                console.log(`Imported ${newRecords.length} new records`);

            } else {
                // 替换模式：完全替换数据
                await this.storage.set(this.storageKeys.practiceRecords, data.practiceRecords);

                if (data.userStats) {
                    await this.storage.set(this.storageKeys.userStats, data.userStats);
                } else {
                    await this.recalculateUserStats();
                }

                console.log(`Imported ${data.practiceRecords.length} records (replace mode)`);
            }
            
            return true;
            
        } catch (error) {
            console.error('Failed to import data:', error);
            throw error;
        }
    }

    // Note: 备份相关方法已移除，现在使用DataBackupManager

    /**
     * 生成记录ID
     */
    generateRecordId() {
        return `record_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 获取存储统计信息
     */
    async getStorageStats() {
        const records = await this.storage.get(this.storageKeys.practiceRecords, []);
        const backups = await this.storage.get(this.storageKeys.backupData, []);

        return {
            totalRecords: records.length,
            totalBackups: backups.length,
            oldestRecord: records.length > 0 ? records[0].startTime : null,
            newestRecord: records.length > 0 ? records[records.length - 1].startTime : null,
            storageVersion: await this.storage.get(this.storageKeys.storageVersion),
            estimatedSize: await this.estimateStorageSize()
        };
    }

    /**
     * 估算存储大小
     */
    async estimateStorageSize() {
        const data = {
            practiceRecords: await this.storage.get(this.storageKeys.practiceRecords, []),
            userStats: await this.storage.get(this.storageKeys.userStats, {}),
            backupData: await this.storage.get(this.storageKeys.backupData, [])
        };

        const jsonString = JSON.stringify(data);
        return jsonString.length; // 字节数的近似值
    }

    // Note: destroy方法已移除，因为备份功能现在由DataBackupManager处理
}

// 确保全局可用
window.ScoreStorage = ScoreStorage;
