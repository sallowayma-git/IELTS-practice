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

        this.initializationError = null;
        this.initializing = true;

        this.storageKeys = {
            practiceRecords: 'practice_records',
            userStats: 'user_stats',
            storageVersion: 'storage_version',
            backupData: 'manual_backups'
        };

        this.currentVersion = '1.0.0';
        this.maxRecords = 1000;
        this.storage = this.createStorageAdapter();
        if (typeof window !== 'undefined') {
            window.scoreStorage = this;
        }

        this.ready = this.initialize()
            .catch((error) => {
                this.initializationError = error;
                return Promise.reject(error);
            })
            .finally(() => {
                this.initializing = false;
            });
    }

    async ensureReady(options = {}) {
        const { allowDuringInit = false } = options;
        if (this.initializationError) {
            throw this.initializationError;
        }
        if (this.initializing && allowDuringInit) {
            return;
        }
        if (this.ready) {
            await this.ready;
        }
    }

    getPracticeRecordAPI(requiredMethods = []) {
        const api = window.PracticeRecordAPI;
        if (!api || typeof api !== 'object') {
            throw new Error('ScoreStorage: PracticeRecordAPI not ready');
        }
        (Array.isArray(requiredMethods) ? requiredMethods : [requiredMethods])
            .filter(Boolean)
            .forEach((methodName) => {
                if (typeof api[methodName] !== 'function') {
                    throw new Error(`ScoreStorage: PracticeRecordAPI.${methodName} not ready`);
                }
            });
        return api;
    }

    async listPracticeRecordsCanonical() {
        const api = this.getPracticeRecordAPI(['list']);
        const records = await api.list();
        return Array.isArray(records) ? records : [];
    }

    async replacePracticeRecordsCanonical(records, options = {}) {
        const finalRecords = Array.isArray(records) ? records : [];
        const api = this.getPracticeRecordAPI(['replace']);
        await api.replace(finalRecords, Object.assign({
            currentVersion: this.currentVersion,
            maxRecords: this.maxRecords
        }, options || {}));
        return true;
    }

    normalizePracticeType(rawType) {
        const coreContracts = window.PracticeCore && window.PracticeCore.contracts;
        if (coreContracts && typeof coreContracts.normalizePracticeType === 'function') {
            return coreContracts.normalizePracticeType(rawType);
        }
        if (!rawType) return null;
        const normalized = String(rawType).toLowerCase();
        if (normalized.includes('listen')) return 'listening';
        if (normalized.includes('read')) return 'reading';
        return null;
    }

    inferPracticeType(recordData = {}) {
        const coreContracts = window.PracticeCore && window.PracticeCore.contracts;
        if (coreContracts && typeof coreContracts.inferPracticeType === 'function') {
            return coreContracts.inferPracticeType(recordData);
        }
        const metadata = recordData.metadata || {};
        const normalized = this.normalizePracticeType(
            recordData.type
            || metadata.type
            || metadata.examType
            || (recordData.examId && String(recordData.examId).toLowerCase().includes('listening') ? 'listening' : null)
        );
        return normalized || 'reading';
    }

    resolveRecordDate(recordData = {}, now = new Date().toISOString()) {
        const coreContracts = window.PracticeCore && window.PracticeCore.contracts;
        if (coreContracts && typeof coreContracts.resolveRecordDate === 'function') {
            return coreContracts.resolveRecordDate(recordData, now);
        }
        const candidates = [
            recordData.metadata?.date,
            recordData.date,
            recordData.endTime,
            recordData.completedAt,
            recordData.startTime,
            recordData.timestamp,
            now
        ];
        for (const value of candidates) {
            if (!value) continue;
            const parsed = new Date(value);
            if (!Number.isNaN(parsed.getTime())) {
                return parsed.toISOString();
            }
        }
        return now;
    }

    inferExamId(recordData = {}) {
        if (!recordData || typeof recordData !== 'object') {
            return null;
        }
        if (recordData.examId) {
            return recordData.examId;
        }
        if (recordData.metadata?.examId) {
            return recordData.metadata.examId;
        }
        if (Array.isArray(recordData.suiteEntries)) {
            const suiteExam = recordData.suiteEntries.find(entry => entry && entry.examId);
            if (suiteExam) {
                return suiteExam.examId;
            }
        }
        const recordId = recordData.id;
        if (typeof recordId === 'string') {
            const match = recordId.match(/^record_([^_]+)_/);
            if (match && match[1]) {
                return match[1];
            }
        }
        return null;
    }

    buildMetadata(recordData = {}, type) {
        const coreContracts = window.PracticeCore && window.PracticeCore.contracts;
        if (coreContracts && typeof coreContracts.buildMetadata === 'function') {
            return coreContracts.buildMetadata(recordData, type);
        }
        const metadata = { ...(recordData.metadata || {}) };
        const examId = recordData.examId;
        const fallbackTitle = recordData.title || recordData.examTitle || examId || 'Unknown Exam';
        const fallbackCategory = recordData.category || 'Unknown';
        const fallbackFrequency = recordData.frequency || 'unknown';

        metadata.examTitle = metadata.examTitle || metadata.title || fallbackTitle;
        metadata.category = metadata.category || fallbackCategory;
        metadata.frequency = metadata.frequency || fallbackFrequency;
        metadata.type = type;
        metadata.examType = metadata.examType || type;

        return metadata;
    }

    ensureNumber(value, fallback = 0) {
        const num = Number(value);
        return Number.isFinite(num) ? num : fallback;
    }

    deriveTotalQuestionCount(recordData = {}, fallbackLength = 0) {
        const candidates = [
            recordData.totalQuestions,
            recordData.questionCount,
            recordData.scoreInfo?.total,
            recordData.scoreInfo?.totalQuestions,
            recordData.realData?.scoreInfo?.totalQuestions,
            recordData.realData?.scoreInfo?.total
        ];
        for (const candidate of candidates) {
            const num = Number(candidate);
            if (Number.isFinite(num) && num >= 0) {
                return num;
            }
        }

        if (Array.isArray(recordData.answers)) {
            return recordData.answers.length;
        }
        if (Array.isArray(recordData.answerList)) {
            return recordData.answerList.length;
        }

        const detailSources = [
            recordData.answerDetails,
            recordData.scoreInfo?.details,
            recordData.realData?.scoreInfo?.details
        ];
        for (const details of detailSources) {
            if (details && typeof details === 'object') {
                return Object.keys(details).length;
            }
        }
        return fallbackLength || 0;
    }

    deriveCorrectAnswerCount(recordData = {}, answers = []) {
        const numericCandidates = [
            recordData.correctAnswers,
            recordData.correct,
            recordData.score,
            recordData.scoreInfo?.correct,
            recordData.scoreInfo?.score,
            recordData.realData?.scoreInfo?.correct,
            recordData.realData?.scoreInfo?.score
        ];
        for (const candidate of numericCandidates) {
            const num = Number(candidate);
            if (Number.isFinite(num) && num >= 0) {
                return num;
            }
        }

        if (
            recordData.correctAnswers &&
            typeof recordData.correctAnswers === 'object' &&
            !Array.isArray(recordData.correctAnswers)
        ) {
            let hasBooleanFlag = false;
            const correctCount = Object.values(recordData.correctAnswers).reduce((count, value) => {
                if (typeof value === 'boolean') {
                    hasBooleanFlag = true;
                    return value ? count + 1 : count;
                }
                if (value && typeof value === 'object') {
                    const flag = value.isCorrect ?? value.correct;
                    if (typeof flag === 'boolean') {
                        hasBooleanFlag = true;
                        return flag ? count + 1 : count;
                    }
                }
                return count;
            }, 0);
            if (hasBooleanFlag) {
                return correctCount;
            }
        }

        if (Array.isArray(answers) && answers.length > 0) {
            const computed = answers.reduce((sum, answer) => {
                if (!answer || typeof answer !== 'object') {
                    return sum;
                }
                if (answer.correct === true || answer.isCorrect === true) {
                    return sum + 1;
                }
                return sum;
            }, 0);
            if (computed > 0) {
                return computed;
            }
        }

        const detailSources = [
            recordData.answerDetails,
            recordData.scoreInfo?.details,
            recordData.realData?.scoreInfo?.details
        ];
        for (const details of detailSources) {
            if (!details || typeof details !== 'object') {
                continue;
            }
            let hasFlag = false;
            let correct = 0;
            Object.values(details).forEach(detail => {
                if (!detail || typeof detail !== 'object') {
                    return;
                }
                if (detail.isCorrect === true || detail.correct === true) {
                    correct += 1;
                }
                hasFlag = hasFlag || typeof detail.isCorrect === 'boolean' || typeof detail.correct === 'boolean';
            });
            if (hasFlag) {
                return correct;
            }
        }
        const answerMap = {};
        if (Array.isArray(answers)) {
            answers.forEach((answer) => {
                if (!answer || typeof answer !== 'object') {
                    return;
                }
                const key = answer.questionId || answer.id || answer.key;
                if (key && answer.answer != null) {
                    answerMap[this.normalizeAnswerMapKey(key)] = answer.answer;
                }
            });
        } else if (this.isPlainObject(answers)) {
            Object.entries(answers).forEach(([key, value]) => {
                const normalizedKey = this.normalizeAnswerMapKey(key);
                if (normalizedKey && value != null) {
                    answerMap[normalizedKey] = value;
                }
            });
        }
        const correctMap = this.resolveCorrectAnswerMap(recordData);
        if (Object.keys(answerMap).length > 0 && Object.keys(correctMap).length > 0) {
            return Object.keys(answerMap).reduce((count, key) => {
                if (!Object.prototype.hasOwnProperty.call(correctMap, key)) {
                    return count;
                }
                return this.compareAnswerValues(answerMap[key], correctMap[key]) ? count + 1 : count;
            }, 0);
        }
        return 0;
    }

    compareAnswerValues(userAnswer, correctAnswer) {
        if (userAnswer == null || correctAnswer == null) {
            return false;
        }
        const matchCore = window.AnswerMatchCore;
        if (matchCore && typeof matchCore.compareAnswers === 'function') {
            return matchCore.compareAnswers(userAnswer, correctAnswer) === true;
        }
        return String(userAnswer).trim().toLowerCase() === String(correctAnswer).trim().toLowerCase();
    }

    getDateOnlyIso(value) {
        if (!value) return null;
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
            return value;
        }
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return null;
        }
        const year = parsed.getFullYear();
        const month = String(parsed.getMonth() + 1).padStart(2, '0');
        const day = String(parsed.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    getLocalDayStart(value) {
        if (!value) return null;
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
            const [year, month, day] = value.split('-').map(part => Number(part));
            if ([year, month, day].some(num => Number.isNaN(num))) {
                return null;
            }
            return new Date(year, month - 1, day).getTime();
        }
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return null;
        }
        return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).getTime();
    }

    createStorageAdapter() {
        const metaRepo = this.repositories.meta;
        const backupRepo = this.repositories.backups;
        const keys = this.storageKeys;
        const self = this;

        return {
            async get(key, defaultValue = null) {
                switch (key) {
                    case keys.practiceRecords: {
                        const api = self.getPracticeRecordAPI(['list']);
                        const records = await api.list();
                        return Array.isArray(records) ? records : [];
                    }
                    case keys.userStats: {
                        const fallback = defaultValue !== null && defaultValue !== undefined ? defaultValue : self.getDefaultUserStats();
                        const api = self.getPracticeRecordAPI(['readStats']);
                        return await api.readStats({ fallback });
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
                    case keys.practiceRecords: {
                        throw new Error('ScoreStorage.storage.set(practice_records) is disabled; use PracticeRecordAPI.replace');
                    }
                    case keys.userStats: {
                        throw new Error('ScoreStorage.storage.set(user_stats) is disabled; use PracticeRecordAPI.writeStats');
                    }
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
                    case keys.practiceRecords: {
                        throw new Error('ScoreStorage.storage.remove(practice_records) is disabled; use PracticeRecordAPI.clear');
                    }
                    case keys.userStats: {
                        throw new Error('ScoreStorage.storage.remove(user_stats) is disabled; use PracticeRecordAPI.resetStats');
                    }
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
        try {
            console.log('ScoreStorage initialized');

            // 检查存储版本并迁移数据
            await this.checkStorageVersion();

            // 初始化数据结构
            await this.initializeDataStructures();

            // Legacy migration happens at PersistentStore bootstrap, not in runtime services.

            // 暂时禁用清理过期数据，避免误删新记录
            // await this.cleanupExpiredData();
        } catch (error) {
            this.initializationError = error;
            console.error('[ScoreStorage] 初始化失败', error);
            throw error;
        }
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
            await this.createBackup('migration_backup', { allowDuringInit: true });

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
                await this.restoreBackup('migration_backup', { allowDuringInit: true });
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
        const records = await this.listPracticeRecordsCanonical();
        const standardizedRecords = records.map(record => this.standardizeRecord(record));
        await this.replacePracticeRecordsCanonical(standardizedRecords, { updateStats: true });
    }

    /**
     * 初始化数据结构
     */
    async initializeDataStructures() {
        if (window.PracticeRecordAPI && typeof window.PracticeRecordAPI.readStats === 'function') {
            await window.PracticeRecordAPI.readStats({ fallback: this.getDefaultUserStats() });
            console.log('[ScoreStorage] 用户统计由 PracticeRecordAPI 管理');
            return;
        }
        console.warn('[ScoreStorage] PracticeRecordAPI.readStats unavailable, skip stats initialization');
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
            practiceDays: [],
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
            await this.ensureReady();
            // 标准化记录格式
            const standardizedRecord = this.standardizeRecord(recordData);
            
            // 验证记录数据
            this.validateRecord(standardizedRecord);

            const practiceRecordApi = window.PracticeRecordAPI;
            if (practiceRecordApi && typeof practiceRecordApi.saveRecord === 'function') {
                try {
                    const savedRecord = await practiceRecordApi.saveRecord(standardizedRecord, {
                        currentVersion: this.currentVersion,
                        maxRecords: this.maxRecords,
                        updateStats: true
                    });
                    console.log('Practice record saved:', savedRecord.id);
                    return savedRecord;
                } catch (apiError) {
                    console.warn('[ScoreStorage] PracticeRecordAPI 保存失败:', apiError);
                    throw apiError;
                }
            }

            throw new Error('ScoreStorage.savePracticeRecord: unified store not ready');
            
        } catch (error) {
            console.error('Failed to save practice record:', error);
            throw error;
        }
    }

    normalizeLegacyRecord(record) {
        if (!record || typeof record !== 'object') {
            return record;
        }
        const patched = Object.assign({}, record);
        if (Array.isArray(record.suiteEntries)) {
            patched.suiteEntries = record.suiteEntries.map(entry => this.clonePlainObject(entry)).filter(Boolean);
        }
        if (record.suiteMode != null) {
            patched.suiteMode = Boolean(record.suiteMode);
        }
        if (record.suiteSessionId) {
            patched.suiteSessionId = record.suiteSessionId;
        }
        if (record.frequency) {
            patched.frequency = record.frequency;
        }
        const inferredType = this.inferPracticeType(patched);
        if (!patched.type) {
            patched.type = inferredType;
        }
        const normalizedMetadata = this.buildMetadata(
            Object.assign({}, patched, { metadata: patched.metadata || {} }),
            patched.type
        );
        patched.metadata = normalizedMetadata;
        const normalizedAnswers = this.standardizeAnswers(patched.answers || patched.answerList || []);
        patched.answers = normalizedAnswers;
        patched.answerList = normalizedAnswers;
        const answerMap = normalizedAnswers.reduce((map, item) => {
            if (item && item.questionId) {
                map[item.questionId] = item.answer || '';
            }
            return map;
        }, {});
        const comparisonSource = patched.answerComparison || patched.realData?.answerComparison || null;
        const detailSource = patched.scoreInfo?.details
            || patched.realData?.scoreInfo?.details
            || patched.answerDetails
            || null;
        const normalizedCorrectMap = this.resolveCorrectAnswerMap(patched, comparisonSource, detailSource);
        patched.correctAnswerMap = normalizedCorrectMap || {};
        if (!patched.answerDetails || typeof patched.answerDetails !== 'object') {
            patched.answerDetails = this.buildAnswerDetailsFromMaps(answerMap, patched.correctAnswerMap);
        }
        const derivedTotals = this.deriveTotalQuestionCount(patched, normalizedAnswers.length);
        const derivedCorrect = this.deriveCorrectAnswerCount(patched, normalizedAnswers);
        patched.totalQuestions = this.ensureNumber(patched.totalQuestions, derivedTotals);
        patched.correctAnswers = this.ensureNumber(patched.correctAnswers, derivedCorrect);
        patched.score = this.ensureNumber(patched.score, patched.correctAnswers);
        patched.accuracy = this.ensureNumber(
            patched.accuracy,
            patched.totalQuestions > 0 ? patched.correctAnswers / patched.totalQuestions : 0
        );
        if (!patched.startTime) {
            patched.startTime = patched.date || patched.endTime || new Date().toISOString();
        }
        if (!patched.endTime) {
            patched.endTime = patched.date || patched.startTime;
        }
        if (!patched.status) {
            patched.status = 'completed';
        }
        if (!patched.scoreInfo) {
            patched.scoreInfo = {};
        }
        if (!patched.scoreInfo.details && patched.answerDetails) {
            patched.scoreInfo.details = patched.answerDetails;
        }
        if (patched.realData) {
            patched.realData = Object.assign({}, patched.realData, {
                answers: patched.realData.answers || answerMap,
                correctAnswers: patched.correctAnswerMap,
                correctAnswerMap: patched.correctAnswerMap,
                scoreInfo: Object.assign({}, patched.realData.scoreInfo || {}, {
                    details: patched.realData.scoreInfo?.details || patched.answerDetails || null
                })
            });
        }
        return patched;
    }

    needsRecordSanitization(record) {
        if (!record || typeof record !== 'object') {
            return true;
        }
        if (!record.type || !record.metadata || !record.metadata.type) {
            return true;
        }
        const numericFields = ['score', 'totalQuestions', 'correctAnswers', 'accuracy', 'duration'];
        return numericFields.some((field) => {
            if (!Object.prototype.hasOwnProperty.call(record, field)) {
                return false;
            }
            return typeof record[field] !== 'number' || Number.isNaN(record[field]);
        });
    }

    /**
     * 标准化记录格式
     */
    standardizeRecord(recordData) {
        const coreContracts = window.PracticeCore && window.PracticeCore.contracts;
        if (coreContracts && typeof coreContracts.standardizeRecord === 'function') {
            return coreContracts.standardizeRecord(recordData, {
                currentVersion: this.currentVersion,
                generateRecordId: () => this.generateRecordId()
            });
        }
        const now = new Date().toISOString();
        const type = this.inferPracticeType(recordData);
        const recordDate = this.resolveRecordDate(recordData, now);
        const resolvedExamId = this.inferExamId(recordData);
        const metadata = this.buildMetadata(
            Object.assign({}, recordData, { examId: resolvedExamId }),
            type
        );
        const comparisonSource = recordData.answerComparison
            || recordData.realData?.answerComparison
            || null;
        const normalizedAnswers = this.standardizeAnswers(recordData.answers || recordData.answerList || []);
        let answerMap = normalizedAnswers.reduce((map, item) => {
            if (item && item.questionId) {
                map[item.questionId] = item.answer || '';
            }
            return map;
        }, {});
        // 如果 answers 为空，尝试从 answerComparison 补齐 userAnswer
        if ((!answerMap || Object.keys(answerMap).length === 0) && comparisonSource) {
            const fromComparison = this.convertComparisonToMap(comparisonSource, 'userAnswer');
            if (Object.keys(fromComparison).length > 0) {
                answerMap = fromComparison;
            }
        }
        const suiteSessionId = recordData.suiteSessionId
            || recordData.metadata?.suiteSessionId
            || null;
        if (suiteSessionId && !metadata.suiteSessionId) {
            metadata.suiteSessionId = suiteSessionId;
        }
        const frequency = recordData.frequency || metadata.frequency || null;
        if (frequency && !metadata.frequency) {
            metadata.frequency = frequency;
        }
        const normalizedCorrectMap = this.resolveCorrectAnswerMap(recordData, comparisonSource);
        const derivedTotalQuestions = this.deriveTotalQuestionCount(recordData, normalizedAnswers.length);
        const derivedCorrectAnswers = this.deriveCorrectAnswerCount(recordData, normalizedAnswers);
        const totalQuestions = this.ensureNumber(recordData.totalQuestions, derivedTotalQuestions);
        const correctAnswers = this.ensureNumber(recordData.correctAnswers, derivedCorrectAnswers);
        let accuracy = this.ensureNumber(
            recordData.accuracy,
            totalQuestions > 0 ? correctAnswers / totalQuestions : 0
        );
        if (accuracy > 1 && accuracy <= 100) {
            accuracy = accuracy / 100; // 容错百分比形式
        }
        if (!Number.isFinite(accuracy) || accuracy < 0) {
            accuracy = 0;
        } else if (accuracy > 1) {
            accuracy = 1;
        }
        const detailSource = recordData.answerDetails
            || recordData.scoreInfo?.details
            || recordData.realData?.scoreInfo?.details
            || (comparisonSource ? this.convertComparisonToDetails(comparisonSource) : null)
            || this.buildAnswerDetailsFromMaps(answerMap, normalizedCorrectMap);

        const startTime = recordData.startTime && !Number.isNaN(new Date(recordData.startTime).getTime())
            ? new Date(recordData.startTime).toISOString()
            : recordDate;
        const endTime = recordData.endTime && !Number.isNaN(new Date(recordData.endTime).getTime())
            ? new Date(recordData.endTime).toISOString()
            : recordDate;
        const resolvedTitle = recordData.title
            || metadata.examTitle
            || metadata.title
            || recordData.examTitle
            || recordData.examId
            || '未命名练习';
        const normalizedSuiteEntries = this.standardizeSuiteEntries(recordData.suiteEntries || []);
        const normalizedComparison = comparisonSource && typeof comparisonSource === 'object'
            ? this.clonePlainObject(comparisonSource)
            : null;

        return {
            // 基础信息
            id: recordData.id || this.generateRecordId(),
            examId: resolvedExamId,
            sessionId: recordData.sessionId,
            title: resolvedTitle,
            type,

            // 时间信息
            startTime,
            endTime,
            duration: this.ensureNumber(recordData.duration, 0),
            date: recordDate,

            // 成绩信息
            status: recordData.status || 'completed',
            score: this.ensureNumber(recordData.score, correctAnswers),
            totalQuestions,
            correctAnswers,
            accuracy,

            // 答题详情
            answers: normalizedAnswers,
            answerDetails: detailSource || null,
            correctAnswerMap: normalizedCorrectMap || {},
            questionTypePerformance: recordData.questionTypePerformance || {},

            // 元数据
            metadata,
            frequency: frequency || metadata.frequency || null,
            suiteMode: Boolean(recordData.suiteMode || (frequency && frequency.toLowerCase() === 'suite')),
            suiteSessionId,
            suiteEntries: normalizedSuiteEntries,
            scoreInfo: recordData.scoreInfo
                ? Object.assign({}, recordData.scoreInfo, {
                    details: recordData.scoreInfo.details || detailSource || null
                })
                : (detailSource ? { details: detailSource } : null),
            realData: recordData.realData
                ? Object.assign({}, recordData.realData, {
                    answers: recordData.realData.answers || answerMap,
                    correctAnswers: normalizedCorrectMap,
                    correctAnswerMap: normalizedCorrectMap,
                    scoreInfo: Object.assign({}, recordData.realData.scoreInfo || {}, {
                        details: recordData.realData.scoreInfo?.details || detailSource || null
                    }),
                    answerComparison: recordData.realData.answerComparison
                        ? this.clonePlainObject(recordData.realData.answerComparison)
                        : (normalizedComparison || null)
                })
                : (normalizedComparison ? { answerComparison: normalizedComparison } : null),
            answerComparison: normalizedComparison,

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
        const coreContracts = window.PracticeCore && window.PracticeCore.contracts;
        if (coreContracts && typeof coreContracts.buildAnswerArray === 'function') {
            return coreContracts.buildAnswerArray(answers);
        }
        if (!Array.isArray(answers)) {
            if (answers && typeof answers === 'object') {
                answers = Object.entries(answers).map(([questionId, value]) => ({
                    questionId,
                    answer: value
                }));
            } else {
                answers = [];
            }
        }
        return answers.map((answer, index) => ({
            questionId: answer.questionId || `q${index + 1}`,
            answer: answer.answer || '',
            correctAnswer: answer.correctAnswer || '',
            correct: Boolean(answer.correct),
            timeSpent: answer.timeSpent || 0,
            questionType: answer.questionType || 'unknown',
            timestamp: answer.timestamp || new Date().toISOString()
        }));
    }

    clonePlainObject(value) {
        if (value == null || typeof value !== 'object') {
            return value ?? null;
        }
        if (Array.isArray(value)) {
            return value.map(item => this.clonePlainObject(item)).filter(item => item !== undefined);
        }
        const clone = {};
        Object.keys(value).forEach((key) => {
            const entry = value[key];
            clone[key] = (entry && typeof entry === 'object')
                ? this.clonePlainObject(entry)
                : entry;
        });
        return clone;
    }

    isPlainObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    normalizeAnswerMapKey(key) {
        if (key == null) {
            return '';
        }
        let normalizedKey = String(key).trim();
        if (!normalizedKey) {
            return '';
        }
        if (/^\d+$/.test(normalizedKey)) {
            normalizedKey = `q${normalizedKey}`;
        } else if (normalizedKey.startsWith('question')) {
            normalizedKey = normalizedKey.replace('question', 'q');
        }
        return normalizedKey;
    }

    mergeAnswerMaps(...sources) {
        const merged = {};
        sources.forEach((source) => {
            if (!this.isPlainObject(source)) {
                return;
            }
            Object.entries(source).forEach(([key, value]) => {
                const normalizedKey = this.normalizeAnswerMapKey(key);
                if (!normalizedKey || Object.prototype.hasOwnProperty.call(merged, normalizedKey)) {
                    return;
                }
                if (value == null || String(value).trim() === '') {
                    return;
                }
                merged[normalizedKey] = value;
            });
        });
        return merged;
    }

    convertComparisonToMap(comparison, key = 'correctAnswer') {
        if (!comparison || typeof comparison !== 'object') {
            return {};
        }
        const map = {};
        Object.entries(comparison).forEach(([questionId, entry]) => {
            if (!entry || typeof entry !== 'object') return;
            const value = entry[key] ?? (key === 'correctAnswer' ? entry.correct : entry.user);
            if (value != null && String(value).trim() !== '') {
                map[questionId] = value;
            }
        });
        return map;
    }

    resolveCorrectAnswerMap(recordData = {}, comparisonSource = null, detailSource = null) {
        const coreContracts = window.PracticeCore && window.PracticeCore.contracts;
        if (coreContracts && typeof coreContracts.resolveRecordCorrectAnswerMap === 'function') {
            return coreContracts.resolveRecordCorrectAnswerMap(recordData, {
                comparison: comparisonSource,
                detailSources: detailSource ? [detailSource] : []
            });
        }
        const realData = this.isPlainObject(recordData.realData) ? recordData.realData : {};
        const effectiveComparison = comparisonSource || recordData.answerComparison || realData.answerComparison || null;
        return this.mergeAnswerMaps(
            recordData.correctAnswerMap,
            realData.correctAnswerMap,
            recordData.correctAnswers,
            realData.correctAnswers,
            effectiveComparison ? this.convertComparisonToMap(effectiveComparison, 'correctAnswer') : null,
            recordData.answerDetails ? this.deriveCorrectMapFromDetails(recordData.answerDetails) : null,
            detailSource ? this.deriveCorrectMapFromDetails(detailSource) : null,
            recordData.scoreInfo?.details ? this.deriveCorrectMapFromDetails(recordData.scoreInfo.details) : null,
            realData.scoreInfo?.details ? this.deriveCorrectMapFromDetails(realData.scoreInfo.details) : null
        );
    }

    convertComparisonToDetails(comparison) {
        if (!comparison || typeof comparison !== 'object') {
            return null;
        }
        const details = {};
        Object.entries(comparison).forEach(([questionId, entry]) => {
            if (!entry || typeof entry !== 'object') return;
            details[questionId] = {
                userAnswer: entry.userAnswer ?? entry.user ?? '',
                correctAnswer: entry.correctAnswer ?? entry.correct ?? '',
                isCorrect: typeof entry.isCorrect === 'boolean' ? entry.isCorrect : null
            };
        });
        return details;
    }

    standardizeSuiteEntries(entries) {
        if (!Array.isArray(entries)) {
            return [];
        }
        return entries.map((entry, index) => {
            if (!entry || typeof entry !== 'object') {
                return null;
            }
            const normalizedAnswers = this.standardizeAnswers(entry.answers || entry.answerList || []);
            const answerMap = normalizedAnswers.reduce((map, item) => {
                if (item && item.questionId) {
                    map[item.questionId] = item.answer || '';
                }
                return map;
            }, {});
            const normalizedScoreInfo = entry.scoreInfo
                ? Object.assign({}, entry.scoreInfo, {
                    details: entry.scoreInfo?.details
                        ? this.clonePlainObject(entry.scoreInfo.details)
                        : null
                })
                : null;
            const answerComparisonSource = entry.answerComparison
                || normalizedScoreInfo?.details
                || entry.rawData?.answerComparison
                || null;
            const normalizedCorrectMap = this.resolveCorrectAnswerMap(
                entry,
                answerComparisonSource,
                normalizedScoreInfo?.details || entry.rawData?.scoreInfo?.details || null
            );
            const highlights = Array.isArray(entry.highlights)
                ? entry.highlights.slice()
                : (Array.isArray(entry.rawData?.highlights) ? entry.rawData.highlights.slice() : []);
            const scrollY = Number.isFinite(Number(entry.scrollY))
                ? Number(entry.scrollY)
                : (Number.isFinite(Number(entry.rawData?.scrollY)) ? Number(entry.rawData.scrollY) : 0);
            return {
                examId: entry.examId || null,
                title: entry.title || entry.examTitle || `套题第${index + 1}篇`,
                category: entry.category || entry.metadata?.category || '套题',
                duration: this.ensureNumber(entry.duration, 0),
                scoreInfo: normalizedScoreInfo,
                answers: answerMap,
                correctAnswerMap: normalizedCorrectMap,
                answerComparison: this.clonePlainObject(answerComparisonSource) || null,
                metadata: entry.metadata ? Object.assign({}, entry.metadata) : {},
                highlights,
                scrollY,
                rawData: entry.rawData ? this.clonePlainObject(entry.rawData) : null
            };
        }).filter(Boolean);
    }

    deriveCorrectMapFromDetails(details) {
        const coreContracts = window.PracticeCore && window.PracticeCore.contracts;
        if (coreContracts && typeof coreContracts.deriveCorrectMapFromDetails === 'function') {
            return coreContracts.deriveCorrectMapFromDetails(details);
        }
        if (!details || typeof details !== 'object') {
            return {};
        }
        const map = {};
        Object.entries(details).forEach(([questionId, info]) => {
            if (!info) {
                return;
            }
            const correctAnswer = info.correctAnswer || info.answer || info.value;
            if (correctAnswer != null) {
                map[questionId] = (typeof correctAnswer === 'string')
                    ? correctAnswer.trim()
                    : String(correctAnswer);
            }
        });
        return map;
    }

    buildAnswerDetailsFromMaps(answerMap = {}, correctMap = {}) {
        const coreContracts = window.PracticeCore && window.PracticeCore.contracts;
        if (coreContracts && typeof coreContracts.buildAnswerDetails === 'function') {
            return coreContracts.buildAnswerDetails(answerMap, correctMap);
        }
        const details = {};
        const keys = new Set([
            ...Object.keys(answerMap || {}),
            ...Object.keys(correctMap || {})
        ]);
        keys.forEach((questionId) => {
            const userAnswer = answerMap && answerMap[questionId] ? String(answerMap[questionId]) : '-';
            const correctAnswer = correctMap && correctMap[questionId] ? String(correctMap[questionId]) : '-';
            let isCorrect = null;
            if (correctAnswer !== '-') {
                const matchCore = window.AnswerMatchCore;
                isCorrect = matchCore && typeof matchCore.compareAnswers === 'function'
                    ? matchCore.compareAnswers(userAnswer, correctAnswer) === true
                    : userAnswer.toLowerCase() === correctAnswer.toLowerCase();
            }
            details[questionId] = {
                userAnswer,
                correctAnswer,
                isCorrect
            };
        });
        return details;
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
        record.accuracy = Math.max(0, Math.min(1, Number(record.accuracy) || 0));
        
        record.duration = Number.isFinite(record.duration) && record.duration >= 0
            ? record.duration
            : 0;
    }

    /**
     * 更新用户统计
     */
    async updateUserStats(practiceRecord, options = {}) {
        const { allowDuringInit = false } = options;
        await this.recalculateUserStats({ allowDuringInit });
    }

    applyRecordToStats(stats, practiceRecord) {
        if (!stats || typeof stats !== 'object') {
            return;
        }

        const duration = Number(practiceRecord.duration) || 0;
        const accuracy = Number(practiceRecord.accuracy) || 0;
        const normalizedRecord = { ...practiceRecord, duration, accuracy };

        stats.categoryStats = stats.categoryStats && typeof stats.categoryStats === 'object' ? stats.categoryStats : {};
        stats.questionTypeStats = stats.questionTypeStats && typeof stats.questionTypeStats === 'object' ? stats.questionTypeStats : {};

        stats.totalPractices += 1;
        stats.totalTimeSpent += duration;

        const totalScore = (stats.averageScore * (stats.totalPractices - 1)) + accuracy;
        stats.averageScore = stats.totalPractices > 0 ? totalScore / stats.totalPractices : 0;

        this.updateCategoryStats(stats, normalizedRecord);
        this.updateQuestionTypeStats(stats, normalizedRecord);
        this.updateStreakDays(stats, normalizedRecord);
        this.checkAchievements(stats, normalizedRecord);

        stats.updatedAt = new Date().toISOString();
    }

    /**
     * 更新分类统计
     */
    updateCategoryStats(stats, practiceRecord) {
        const category = practiceRecord?.metadata?.category;
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
        const recordSource = practiceRecord.date || practiceRecord.endTime || practiceRecord.startTime;
        const recordDay = this.getDateOnlyIso(recordSource);
        if (!recordDay) return;

        const dayMs = 24 * 60 * 60 * 1000;
        let practiceDays = Array.isArray(stats.practiceDays) ? stats.practiceDays.slice() : [];

        if (practiceDays.length === 0) {
            const historicalStreak = Math.max(0, Math.round(this.ensureNumber(stats.streakDays, 0)));
            const lastPracticeIso = this.getDateOnlyIso(stats.lastPracticeDate);
            const lastPracticeStart = this.getLocalDayStart(lastPracticeIso);

            if (historicalStreak > 0 && lastPracticeIso && Number.isFinite(lastPracticeStart)) {
                const migratedDays = [];
                for (let offset = historicalStreak - 1; offset >= 0; offset -= 1) {
                    const timestamp = lastPracticeStart - (offset * dayMs);
                    const dayIso = this.getDateOnlyIso(timestamp);
                    if (dayIso) {
                        migratedDays.push(dayIso);
                    }
                }
                practiceDays = migratedDays;
            }
        }

        const uniqueDays = new Set(practiceDays);
        uniqueDays.add(recordDay);
        practiceDays = Array.from(uniqueDays);

        const validDays = practiceDays
            .map(day => ({ day, start: this.getLocalDayStart(day) }))
            .filter(item => item.start !== null)
            .sort((a, b) => a.start - b.start);

        if (validDays.length === 0) {
            stats.practiceDays = [];
            stats.streakDays = 0;
            stats.lastPracticeDate = null;
            return;
        }

        let currentStreak = 1;

        for (let index = 1; index < validDays.length; index += 1) {
            const previous = validDays[index - 1];
            const current = validDays[index];
            const diff = Math.round((current.start - previous.start) / (1000 * 60 * 60 * 24));

            if (diff === 1) {
                currentStreak += 1;
            } else if (diff > 1) {
                currentStreak = 1;
            }
        }

        stats.practiceDays = validDays.map(item => item.day);
        stats.streakDays = currentStreak;
        stats.lastPracticeDate = validDays[validDays.length - 1].day;
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
        await this.ensureReady();
        const raw = await this.listPracticeRecordsCanonical();
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
    async getUserStats(options = {}) {
        const { allowDuringInit = false } = options;
        await this.ensureReady({ allowDuringInit });
        const api = this.getPracticeRecordAPI(['readStats']);
        return await api.readStats({ fallback: this.getDefaultUserStats() });
    }

    /**
     * 重新计算用户统计
     */
    async recalculateUserStats(options = {}) {
        const { allowDuringInit = false } = options;
        await this.ensureReady({ allowDuringInit });
        const api = this.getPracticeRecordAPI(['recalculateStats']);
        const stats = await api.recalculateStats();
        console.log('User stats recalculated through PracticeRecordAPI');
        return stats;
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
            if (Array.isArray(r.answers)) {
                const map = {};
                r.answers.forEach((entry, idx) => {
                    if (!entry) return;
                    const key = entry.questionId || `q${idx + 1}`;
                    map[key] = entry.answer || entry.userAnswer || '';
                });
                r.answerList = r.answers.slice();
                r.answers = map;
            }
            if (Array.isArray(rd.answers)) {
                const rdMap = {};
                rd.answers.forEach((entry, idx) => {
                    if (!entry) return;
                    const key = entry.questionId || `q${idx + 1}`;
                    rdMap[key] = entry.answer || entry.userAnswer || '';
                });
                rd.answers = rdMap;
            }
            const comparisonSource = r.answerComparison || rd.answerComparison || null;
            if ((!r.answers || Object.keys(r.answers).length === 0) && comparisonSource) {
                const fromComparison = this.convertComparisonToMap(comparisonSource, 'userAnswer');
                if (Object.keys(fromComparison).length > 0) {
                    r.answers = fromComparison;
                }
            }
            const normalizedCorrectMap = this.resolveCorrectAnswerMap(
                r,
                comparisonSource,
                r.answerDetails || r.scoreInfo?.details || rd.scoreInfo?.details || null
            );
            if (Object.keys(normalizedCorrectMap).length > 0) {
                r.correctAnswerMap = normalizedCorrectMap;
            }
            if (!r.answerDetails) {
                if (comparisonSource) {
                    r.answerDetails = this.convertComparisonToDetails(comparisonSource);
                }
                if (!r.answerDetails) {
                    r.answerDetails = r.scoreInfo?.details || this.buildAnswerDetailsFromMaps(r.answers, r.correctAnswerMap);
                }
            }

            // 正确/总题数归一
            const derivedCorrect = (typeof r.correctAnswers === 'number') ? r.correctAnswers
                                 : (typeof r.score === 'number' ? r.score
                                    : (typeof sInfo.correct === 'number'
                                        ? sInfo.correct
                                        : this.deriveCorrectAnswerCount(r, r.answers || [])));

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
            if (r.realData && typeof r.realData === 'object') {
                r.realData.correctAnswers = r.correctAnswerMap || {};
                r.realData.correctAnswerMap = r.correctAnswerMap || {};
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
    async createBackup(backupName = null, options = {}) {
        const { allowDuringInit = false } = options;
        await this.ensureReady({ allowDuringInit });
        if (window.DataBackupManager) {
            const backupManager = new DataBackupManager();
            const practiceRecords = await this.listPracticeRecordsCanonical();
            const userStats = await this.getUserStats({ allowDuringInit });

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
    async restoreBackup(backupId, options = {}) {
        try {
            const { allowDuringInit = false } = options;
            await this.ensureReady({ allowDuringInit });
            const backups = await this.storage.get('manual_backups', []);
            const backup = backups.find(b => b.id === backupId);

            if (!backup) {
                throw new Error(`Backup not found: ${backupId}`);
            }

            if (backup.data) {
                const hasStats = backup.data.userStats && typeof backup.data.userStats === 'object';
                await this.replacePracticeRecordsCanonical(backup.data.practiceRecords || [], { updateStats: !hasStats });
                if (hasStats) {
                    const api = this.getPracticeRecordAPI(['resetStats']);
                    await api.resetStats(backup.data.userStats);
                }
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
            await this.ensureReady();
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
        await this.ensureReady();
        const exportData = {
            exportDate: new Date().toISOString(),
            version: this.currentVersion,
            practiceRecords: await this.listPracticeRecordsCanonical(),
            userStats: await this.getUserStats(),
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
            await this.ensureReady();
            const payload = typeof importData === 'string' ? JSON.parse(importData) : importData;

            const records = this.extractPracticeRecordsFromPayload(payload);
            const stats = this.extractUserStatsFromPayload(payload);

            if (!Array.isArray(records) || records.length === 0) {
                throw new Error('Invalid import data format: no practice records found');
            }

            // 标准化记录，避免字段缺失
            const standardizedRecords = records.map((r) => {
                try {
                    return this.standardizeRecord(r);
                } catch (e) {
                    console.warn('[ScoreStorage] 标准化导入记录失败，跳过:', r && r.id, e);
                    return null;
                }
            }).filter(Boolean);

            // 创建备份
            await this.createBackup('pre_import_backup');

            if (options.merge) {
                // 合并模式：按 id 去重，保留导入集中的最新（后出现的覆盖）
                const existingRecords = await this.listPracticeRecordsCanonical();
                const mergedMap = new Map();
                existingRecords.forEach((rec) => {
                    if (rec && rec.id) mergedMap.set(rec.id, rec);
                });
                standardizedRecords.forEach((rec) => {
                    if (rec && rec.id) mergedMap.set(rec.id, rec);
                });
                const mergedRecords = Array.from(mergedMap.values());
                await this.replacePracticeRecordsCanonical(mergedRecords, { updateStats: true });
                console.log(`Imported ${standardizedRecords.length} records (merge mode), total ${mergedRecords.length}`);

            } else {
                // 替换模式：完全替换数据
                await this.replacePracticeRecordsCanonical(standardizedRecords, { updateStats: !stats });

                if (stats) {
                    const api = this.getPracticeRecordAPI(['writeStats']);
                    await api.writeStats(stats);
                }

                console.log(`Imported ${standardizedRecords.length} records (replace mode)`);
            }

            return true;

        } catch (error) {
            console.error('Failed to import data:', error);
            throw error;
        }
    }

    extractPracticeRecordsFromPayload(payload) {
        if (!payload) return [];
        if (Array.isArray(payload)) return payload;
        if (Array.isArray(payload.practiceRecords)) return payload.practiceRecords;
        if (Array.isArray(payload.practice_records)) return payload.practice_records;
        if (Array.isArray(payload.data?.practice_records)) return payload.data.practice_records;
        if (Array.isArray(payload.data?.practiceRecords)) return payload.data.practiceRecords;
        if (payload.data?.exam_system_practice_records && Array.isArray(payload.data.exam_system_practice_records.data)) {
            return payload.data.exam_system_practice_records.data;
        }
        if (payload.exam_system_practice_records && Array.isArray(payload.exam_system_practice_records.data)) {
            return payload.exam_system_practice_records.data;
        }
        return [];
    }

    extractUserStatsFromPayload(payload) {
        if (!payload || typeof payload !== 'object') return null;
        return payload.userStats
            || payload.user_stats
            || payload.data?.userStats
            || payload.data?.user_stats
            || null;
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
        await this.ensureReady();
        const records = await this.listPracticeRecordsCanonical();
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
        await this.ensureReady();
        const data = {
            practiceRecords: await this.listPracticeRecordsCanonical(),
            userStats: await this.getUserStats(),
            backupData: await this.storage.get(this.storageKeys.backupData, [])
        };

        const jsonString = JSON.stringify(data);
        return jsonString.length; // 字节数的近似值
    }

    // Note: destroy方法已移除，因为备份功能现在由DataBackupManager处理
}

// 确保全局可用
window.ScoreStorage = ScoreStorage;
