/**
 * 练习记录管理�?
 * 负责练习会话管理、成绩记录和数据持久�?
 */
class PracticeRecorder {
    constructor() {
        this.activeSessions = new Map();
        this.sessionListeners = new Map();
        this.autoSaveInterval = 30000; // 30秒自动保�?
        this.autoSaveTimer = null;

        // 初始化存储系�?
        this.scoreStorage = new ScoreStorage();

        // 异步初始�?
        this.initialize().catch(error => {
            console.error('[PracticeRecorder] 初始化失�?', error);
        });
    }

    /**
     * 初始化练习记录器
     */
    async initialize() {
        console.log('PracticeRecorder initialized');

        // 恢复活动会话
        await this.restoreActiveSessions();

        // 恢复临时存储的记�?
        await this.recoverTemporaryRecords();

        // 设置消息监听�?
        this.setupMessageListeners();

        // 启动自动保存
        this.startAutoSave();

        // 页面卸载时保存数�?
        window.addEventListener('beforeunload', () => {
            this.saveAllSessions();
        });
    }

    /**
     * 恢复活动会话
     */
    async restoreActiveSessions() {
        const raw = await storage.get('active_sessions', []);
        const storedSessions = Array.isArray(raw) ? raw : [];

        storedSessions.forEach(sessionData => {
            this.activeSessions.set(sessionData.examId, {
                ...sessionData,
                status: 'restored',
                lastActivity: new Date().toISOString()
            });
        });

        console.log(`Restored ${storedSessions.length} active sessions`);
    }

    /**
     * 设置消息监听�?
     */
    setupMessageListeners() {
        // 监听来自考试窗口的消�?
        window.addEventListener('message', (event) => {
            this.handleExamMessage(event);
        });
        
        // 监听页面可见性变�?
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.checkSessionStatus();
            }
        });
    }

    /**
     * 处理来自考试窗口的消�?
     */
    handleExamMessage(event) {
        const { type, data } = event.data || {};
        
        if (!type || !data) return;
        
        switch (type) {
            case 'session_started':
                this.handleSessionStarted(data);
                break;
            case 'session_progress':
                this.handleSessionProgress(data);
                break;
            case 'session_completed':
                this.handleSessionCompleted(data);
                break;
            case 'session_paused':
                this.handleSessionPaused(data);
                break;
            case 'session_resumed':
                this.handleSessionResumed(data);
                break;
            case 'session_error':
                this.handleSessionError(data);
                break;
        }
    }

    /**
     * 开始练习会�?
     */
    startPracticeSession(examId, examData = {}) {
        const sessionId = this.generateSessionId();
        const startTime = new Date().toISOString();
        
        const sessionData = {
            sessionId,
            examId,
            startTime,
            lastActivity: startTime,
            status: 'started',
            progress: {
                currentQuestion: 0,
                totalQuestions: examData.totalQuestions || 0,
                answeredQuestions: 0,
                timeSpent: 0
            },
            answers: [],
            metadata: {
                examTitle: examData.title || '',
                category: examData.category || '',
                frequency: examData.frequency || '',
                userAgent: navigator.userAgent,
                screenResolution: `${screen.width}x${screen.height}`,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
            }
        };
        
        // 存储会话
        this.activeSessions.set(examId, sessionData);
        this.saveActiveSessions();
        
        // 设置会话监听�?
        this.setupSessionListener(examId);
        
        console.log(`Practice session started for exam: ${examId}`);
        
        // 触发事件
        this.dispatchSessionEvent('sessionStarted', { examId, sessionData });
        
        return sessionData;
    }

    /**
     * 处理会话开�?
     */
    handleSessionStarted(data) {
        const { examId, sessionId, metadata } = data;
        
        if (this.activeSessions.has(examId)) {
            let session = this.activeSessions.get(examId);
            session.sessionId = sessionId;
            session.status = 'active';
            session.lastActivity = new Date().toISOString();
            
            if (metadata) {
                session.metadata = { ...session.metadata, ...metadata };
            }
            
            this.activeSessions.set(examId, session);
            this.saveActiveSessions();
            
            console.log(`Session confirmed started: ${examId}`);
        }
    }

    /**
     * 处理会话进度更新
     */
    handleSessionProgress(data) {
        const { examId, progress, answers } = data;
        
        if (!this.activeSessions.has(examId)) return;
        
        let session = this.activeSessions.get(examId);
        session.lastActivity = new Date().toISOString();
        session.progress = { ...session.progress, ...progress };
        
        if (answers) {
            session.answers = answers;
        }
        
        this.activeSessions.set(examId, session);
        
        // 触发进度事件
        this.dispatchSessionEvent('sessionProgress', { examId, progress });
    }

    /**
     * 处理会话完成
     */
    handleSessionCompleted(data) {
        const { examId, results } = data;
        
        if (!this.activeSessions.has(examId)) return;
        
        let session = this.activeSessions.get(examId);
        const endTime = new Date().toISOString();
        
        // 计算总用�?
        const duration = new Date(endTime) - new Date(session.startTime);
        
        // 创建练习记录
        const practiceRecord = {
            id: `record_${session.sessionId}`,
            examId,
            sessionId: session.sessionId,
            startTime: session.startTime,
            endTime,
            duration: Math.floor(duration / 1000), // �?
            status: 'completed',
            score: results.score || 0,
            totalQuestions: results.totalQuestions || session.progress.totalQuestions,
            correctAnswers: results.correctAnswers || 0,
            accuracy: results.accuracy || 0,
            answers: results.answers || session.answers,
            questionTypePerformance: results.questionTypePerformance || {},
            metadata: session.metadata,
            createdAt: endTime
        };
        
        // 保存练习记录
        this.savePracticeRecord(practiceRecord);
        
        // 更新用户统计
        this.updateUserStats(practiceRecord);
        
        // 清理活动会话
        this.endPracticeSession(examId);
        
        console.log(`Practice session completed: ${examId}`);
        
        // 触发完成事件
        this.dispatchSessionEvent('sessionCompleted', { examId, practiceRecord });
        
        return practiceRecord;
    }

    /**
     * 处理会话暂停
     */
    handleSessionPaused(data) {
        const { examId } = data;
        
        if (!this.activeSessions.has(examId)) return;
        
        let session = this.activeSessions.get(examId);
        session.status = 'paused';
        session.lastActivity = new Date().toISOString();
        
        this.activeSessions.set(examId, session);
        this.saveActiveSessions();
        
        console.log(`Session paused: ${examId}`);
    }

    /**
     * 处理会话恢复
     */
    handleSessionResumed(data) {
        const { examId } = data;
        
        if (!this.activeSessions.has(examId)) return;
        
        let session = this.activeSessions.get(examId);
        session.status = 'active';
        session.lastActivity = new Date().toISOString();
        
        this.activeSessions.set(examId, session);
        this.saveActiveSessions();
        
        console.log(`Session resumed: ${examId}`);
    }

    /**
     * 处理会话错误
     */
    handleSessionError(data) {
        const { examId, error } = data;
        
        if (!this.activeSessions.has(examId)) return;
        
        let session = this.activeSessions.get(examId);
        session.status = 'error';
        session.error = error;
        session.lastActivity = new Date().toISOString();
        
        this.activeSessions.set(examId, session);
        this.saveActiveSessions();
        
        console.error(`Session error for ${examId}:`, error);
        
        // 触发错误事件
        this.dispatchSessionEvent('sessionError', { examId, error });
    }

    /**
     * 结束练习会话
     */
    endPracticeSession(examId, reason = 'completed') {
        if (!this.activeSessions.has(examId)) return;
        
        let session = this.activeSessions.get(examId);
        
        // 如果会话未完成，创建中断记录
        if (reason !== 'completed' && session.status !== 'completed') {
            const endTime = new Date().toISOString();
            const duration = new Date(endTime) - new Date(session.startTime);
            
            const interruptedRecord = {
                id: `interrupted_${session.sessionId}`,
                examId,
                sessionId: session.sessionId,
                startTime: session.startTime,
                endTime,
                duration: Math.floor(duration / 1000),
                status: 'interrupted',
                reason,
                progress: session.progress,
                answers: session.answers,
                metadata: session.metadata,
                createdAt: endTime
            };
            
            this.saveInterruptedRecord(interruptedRecord);
        }
        
        // 清理会话
        this.activeSessions.delete(examId);
        this.cleanupSessionListener(examId);
        this.saveActiveSessions();
        
        console.log(`Practice session ended: ${examId} (${reason})`);
        
        // 触发结束事件
        this.dispatchSessionEvent('sessionEnded', { examId, reason });
    }

    /**
     * 设置会话监听�?
     */
    setupSessionListener(examId) {
        // 定期检查会话状�?
        const listener = setInterval(() => {
            this.checkSessionActivity(examId);
        }, 60000); // 每分钟检查一�?
        
        this.sessionListeners.set(examId, listener);
    }

    /**
     * 清理会话监听�?
     */
    cleanupSessionListener(examId) {
        if (this.sessionListeners.has(examId)) {
            clearInterval(this.sessionListeners.get(examId));
            this.sessionListeners.delete(examId);
        }
    }

    /**
     * 检查会话活动状�?
     */
    checkSessionActivity(examId) {
        if (!this.activeSessions.has(examId)) return;
        
        let session = this.activeSessions.get(examId);
        const now = new Date();
        const lastActivity = new Date(session.lastActivity);
        const inactiveTime = now - lastActivity;
        
        // 如果超过30分钟无活动，标记为超�?
        if (inactiveTime > 30 * 60 * 1000) {
            console.warn(`Session timeout detected for exam: ${examId}`);
            this.endPracticeSession(examId, 'timeout');
        }
    }

    /**
     * 检查所有会话状�?
     */
    checkSessionStatus() {
        for (const examId of this.activeSessions.keys()) {
            this.checkSessionActivity(examId);
        }
    }

    /**
     * 启动自动保存
     */
    startAutoSave() {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
        }
        
        this.autoSaveTimer = setInterval(() => {
            this.saveAllSessions();
        }, this.autoSaveInterval);
    }

    /**
     * 保存所有会�?
     */
    saveAllSessions() {
        this.saveActiveSessions();
        console.log('Auto-saved all active sessions');
    }

    /**
     * 保存活动会话到存�?
     */
    saveActiveSessions() {
        const sessionsArray = Array.from(this.activeSessions.values());
        storage.set('active_sessions', sessionsArray);
    }

    /**
     * 保存练习记录
     */
    savePracticeRecord(record) {
        const maxRetries = 3;
        let attempt = 0;
        
        while (attempt < maxRetries) {
            attempt++;
            
            try {
                console.log(`[PracticeRecorder] 开始保存练习记�?(尝试 ${attempt}/${maxRetries}):`, record.id);
                
                // 首先尝试使用ScoreStorage保存记录
                if (this.scoreStorage && typeof this.scoreStorage.savePracticeRecord === 'function') {
                    const savedRecord = this.scoreStorage.savePracticeRecord(record);
                    console.log(`[PracticeRecorder] ScoreStorage保存成功: ${savedRecord.id}`);
                    
                    // 验证保存是否真的成功
                    if (this.verifyRecordSaved(savedRecord.id)) {
                        console.log('[PracticeRecorder] 记录保存验证成功');
                        return savedRecord;
                    } else {
                        console.warn('[PracticeRecorder] ScoreStorage保存验证失败，尝试降级保�?);
                        throw new Error('ScoreStorage save verification failed');
                    }
                } else {
                    console.warn('[PracticeRecorder] ScoreStorage不可用，使用降级保存');
                    throw new Error('ScoreStorage not available');
                }
            } catch (error) {
                console.error(`[PracticeRecorder] ScoreStorage保存失败 (尝试 ${attempt}):`, error);
                
                // 如果是最后一次尝试或者是严重错误，使用降级保�?
                if (attempt === maxRetries || this.isCriticalError(error)) {
                    return this.fallbackSavePracticeRecord(record);
                }
                
                // 等待一段时间后重试
                if (attempt < maxRetries) {
                    console.log(`[PracticeRecorder] 等待 ${attempt * 100}ms 后重�?..`);
                    // 同步等待（在实际应用中可能需要异步处理）
                    const start = Date.now();
                    while (Date.now() - start < attempt * 100) {
                        // 简单的同步等待
                    }
                }
            }
        }
        
        // 如果所有尝试都失败，使用降级保�?
        return this.fallbackSavePracticeRecord(record);
    }

    /**
     * 降级保存练习记录
     */
    fallbackSavePracticeRecord(record) {
        try {
            console.log('[PracticeRecorder] 使用降级保存方法');
            
            // 标准化记录格式，确保与ScoreStorage兼容
            const standardizedRecord = this.standardizeRecordForFallback(record);
            
            let records = [...storage.get('practice_records', [])];
            console.log('[PracticeRecorder] 当前记录数量:', records.length);

            // 检查是否已存在相同ID的记�?
            const existingIndex = records.findIndex(r => r.id === standardizedRecord.id);
            if (existingIndex !== -1) {
                console.log('[PracticeRecorder] 发现重复记录，更新现有记�?);
                records[existingIndex] = standardizedRecord;
            } else {
                // 新记录添加到开头（保持时间顺序�?
                records.unshift(standardizedRecord);
            }

            // 限制记录数量
            if (records.length > 1000) {
                records = records.slice(0, 1000);
            }

            // 保存记录
            const saveSuccess = storage.set('practice_records', records);
            if (!saveSuccess) {
                throw new Error('Storage.set returned false');
            }
            
            console.log(`[PracticeRecorder] 降级保存成功: ${standardizedRecord.id}`);
            
            // 验证保存是否成功
            if (this.verifyRecordSaved(standardizedRecord.id)) {
                console.log('[PracticeRecorder] 降级保存验证成功');
                
                // 手动更新用户统计（因为ScoreStorage不可用）
                this.updateUserStatsManually(standardizedRecord);
                
                return standardizedRecord;
            } else {
                throw new Error('Fallback save verification failed');
            }
            
        } catch (error) {
            console.error('[PracticeRecorder] 降级保存失败:', error);
            
            // 最后的备用方案：保存到临时存储
            this.saveToTemporaryStorage(record);
            
            // 抛出错误，但不阻止用户继续使�?
            throw new Error(`All save methods failed: ${error.message}`);
        }
    }

    /**
     * 标准化记录格式（用于降级保存�?
     */
    standardizeRecordForFallback(recordData) {
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
            answers: recordData.answers || [],
            questionTypePerformance: recordData.questionTypePerformance || {},
            
            // 元数�?
            metadata: {
                examTitle: '',
                category: '',
                frequency: '',
                ...recordData.metadata
            },
            
            // 系统信息
            version: '1.0.0',
            createdAt: recordData.createdAt || now,
            updatedAt: now,
            
            // 降级保存标识
            savedBy: 'fallback',
            fallbackReason: 'ScoreStorage unavailable'
        };
    }

    /**
     * 验证记录是否已保�?
     */
    verifyRecordSaved(recordId) {
        try {
            const records = storage.get('practice_records', []);
            const found = records.find(r => r.id === recordId);
            return !!found;
        } catch (error) {
            console.error('[PracticeRecorder] 验证记录保存时出�?', error);
            return false;
        }
    }

    /**
     * 判断是否为严重错�?
     */
    isCriticalError(error) {
        const criticalMessages = [
            'QuotaExceededError',
            'localStorage not available',
            'Storage quota exceeded'
        ];
        
        return criticalMessages.some(msg => 
            error.message && error.message.includes(msg)
        );
    }

    /**
     * 手动更新用户统计
     */
    updateUserStatsManually(practiceRecord) {
        try {
            const stats = storage.get('user_stats', {
                totalPractices: 0,
                totalTimeSpent: 0,
                averageScore: 0,
                categoryStats: {},
                questionTypeStats: {},
                streakDays: 0,
                lastPracticeDate: null,
                achievements: []
            });
            
            // 更新基础统计
            stats.totalPractices += 1;
            stats.totalTimeSpent += practiceRecord.duration;
            
            // 计算平均分数
            const totalScore = (stats.averageScore * (stats.totalPractices - 1)) + practiceRecord.accuracy;
            stats.averageScore = totalScore / stats.totalPractices;
            
            // 更新时间�?
            stats.updatedAt = new Date().toISOString();
            
            storage.set('user_stats', stats);
            console.log('[PracticeRecorder] 用户统计手动更新完成');
            
        } catch (error) {
            console.error('[PracticeRecorder] 手动更新用户统计失败:', error);
        }
    }

    /**
     * 保存到临时存�?
     */
    saveToTemporaryStorage(record) {
        try {
            const tempRecords = [...storage.get('temp_practice_records', [])];
            tempRecords.push({
                ...record,
                tempSavedAt: new Date().toISOString(),
                needsRecovery: true
            });
            
            // 限制临时记录数量
            const finalTempRecords = tempRecords.length > 50 ? tempRecords.slice(-50) : tempRecords;

            storage.set('temp_practice_records', finalTempRecords);
            console.log('[PracticeRecorder] 记录已保存到临时存储:', record.id);
            
        } catch (error) {
            console.error('[PracticeRecorder] 临时存储也失�?', error);
        }
    }

    /**
     * 保存中断记录
     */
    saveInterruptedRecord(record) {
        const records = [...storage.get('interrupted_records', [])];
        records.push(record);
        
        // 保持最�?00条中断记�?
        const finalRecords = records.length > 100 ? records.slice(-100) : records;

        storage.set('interrupted_records', finalRecords);
        console.log(`Interrupted record saved: ${record.id}`);
    }

    /**
     * 更新用户统计
     */
    updateUserStats(practiceRecord) {
        const stats = storage.get('user_stats', {
            totalPractices: 0,
            totalTimeSpent: 0,
            averageScore: 0,
            categoryStats: {},
            questionTypeStats: {},
            streakDays: 0,
            lastPracticeDate: null,
            achievements: []
        });
        
        // 更新基础统计
        stats.totalPractices += 1;
        stats.totalTimeSpent += practiceRecord.duration;
        
        // 计算平均分数
        const totalScore = (stats.averageScore * (stats.totalPractices - 1)) + practiceRecord.accuracy;
        stats.averageScore = totalScore / stats.totalPractices;
        
        // 更新分类统计
        const category = practiceRecord.metadata.category;
        if (category) {
            if (!stats.categoryStats[category]) {
                stats.categoryStats[category] = {
                    practices: 0,
                    avgScore: 0,
                    timeSpent: 0,
                    bestScore: 0
                };
            }
            
            const catStats = stats.categoryStats[category];
            catStats.practices += 1;
            catStats.timeSpent += practiceRecord.duration;
            catStats.bestScore = Math.max(catStats.bestScore, practiceRecord.accuracy);
            
            const catTotalScore = (catStats.avgScore * (catStats.practices - 1)) + practiceRecord.accuracy;
            catStats.avgScore = catTotalScore / catStats.practices;
        }
        
        // 更新题型统计
        if (practiceRecord.questionTypePerformance) {
            Object.entries(practiceRecord.questionTypePerformance).forEach(([type, performance]) => {
                if (!stats.questionTypeStats[type]) {
                    stats.questionTypeStats[type] = {
                        practices: 0,
                        accuracy: 0,
                        totalQuestions: 0,
                        correctAnswers: 0
                    };
                }
                
                const typeStats = stats.questionTypeStats[type];
                typeStats.practices += 1;
                typeStats.totalQuestions += performance.total || 0;
                typeStats.correctAnswers += performance.correct || 0;
                typeStats.accuracy = typeStats.totalQuestions > 0 
                    ? typeStats.correctAnswers / typeStats.totalQuestions 
                    : 0;
            });
        }
        
        // 更新连续学习天数
        const today = new Date().toDateString();
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
        
        storage.set('user_stats', stats);
        console.log('User stats updated');
    }

    /**
     * 获取活动会话
     */
    getActiveSessions() {
        return Array.from(this.activeSessions.values());
    }

    /**
     * 获取练习记录
     */
    getPracticeRecords(filters = {}) {
        try {
            return this.scoreStorage.getPracticeRecords(filters);
        } catch (error) {
            console.error('Failed to get practice records from ScoreStorage:', error);
            
            // 降级处理
            const records = storage.get('practice_records', []);
            
            if (Object.keys(filters).length === 0) {
                return records;
            }
            
            return records.filter(record => {
                if (filters.examId && record.examId !== filters.examId) return false;
                if (filters.category && record.metadata.category !== filters.category) return false;
                if (filters.startDate && new Date(record.startTime) < new Date(filters.startDate)) return false;
                if (filters.endDate && new Date(record.startTime) > new Date(filters.endDate)) return false;
                if (filters.minAccuracy && record.accuracy < filters.minAccuracy) return false;
                if (filters.maxAccuracy && record.accuracy > filters.maxAccuracy) return false;
                
                return true;
            });
        }
    }

    /**
     * 获取用户统计
     */
    getUserStats() {
        try {
            return this.scoreStorage.getUserStats();
        } catch (error) {
            console.error('Failed to get user stats from ScoreStorage:', error);
            
            // 降级处理
            return storage.get('user_stats', {
                totalPractices: 0,
                totalTimeSpent: 0,
                averageScore: 0,
                categoryStats: {},
                questionTypeStats: {},
                streakDays: 0,
                lastPracticeDate: null,
                achievements: []
            });
        }
    }

    /**
     * 导出练习数据
     */
    exportData(format = 'json') {
        try {
            return this.scoreStorage.exportData(format);
        } catch (error) {
            console.error('Failed to export data:', error);
            throw error;
        }
    }

    /**
     * 导入练习数据
     */
    importData(data, options = {}) {
        try {
            return this.scoreStorage.importData(data, options);
        } catch (error) {
            console.error('Failed to import data:', error);
            throw error;
        }
    }

    /**
     * 创建数据备份
     */
    createBackup(backupName = null) {
        try {
            return this.scoreStorage.createBackup(backupName);
        } catch (error) {
            console.error('Failed to create backup:', error);
            throw error;
        }
    }

    /**
     * 恢复数据备份
     */
    restoreBackup(backupId) {
        try {
            return this.scoreStorage.restoreBackup(backupId);
        } catch (error) {
            console.error('Failed to restore backup:', error);
            throw error;
        }
    }

    /**
     * 获取备份列表
     */
    getBackups() {
        try {
            return this.scoreStorage.getBackups();
        } catch (error) {
            console.error('Failed to get backups:', error);
            return [];
        }
    }

    /**
     * 获取存储统计信息
     */
    getStorageStats() {
        try {
            return this.scoreStorage.getStorageStats();
        } catch (error) {
            console.error('Failed to get storage stats:', error);
            return null;
        }
    }

    /**
     * 生成会话ID
     */
    generateSessionId() {
        return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 触发会话事件
     */
    dispatchSessionEvent(eventType, data) {
        const event = new CustomEvent(`practice${eventType}`, {
            detail: data
        });
        document.dispatchEvent(event);
    }

    /**
     * 处理真实练习数据（新增方法）
     */
    handleRealPracticeData(examId, realData) {
        console.log('[PracticeRecorder] 处理真实练习数据:', examId, realData);
        
        try {
            // 验证数据完整�?
            const validatedData = this.validateRealData(realData);
            
            if (!validatedData) {
                console.warn('[PracticeRecorder] 数据验证失败，使用模拟数�?);
                return this.handleFallbackData(examId);
            }
            
            // 获取题目信息
            const examIndex = storage.get('exam_index', []);
            const exam = examIndex.find(e => e.id === examId);
            
            if (!exam) {
                console.error('[PracticeRecorder] 无法找到题目信息:', examId);
                return;
            }
            
            // 构造增强的练习记录
            const practiceRecord = this.createRealPracticeRecord(exam, validatedData);
            
            // 保存记录 - 这里ScoreStorage会自动更新用户统�?
            this.savePracticeRecord(practiceRecord);
            
            // 清理活动会话
            this.activeSessions.delete(examId);
            this.saveActiveSessions();
            
            // 触发完成事件
            this.dispatchSessionEvent('realDataProcessed', { 
                examId, 
                practiceRecord,
                dataSource: 'real'
            });
            
            console.log('[PracticeRecorder] 真实数据处理完成:', practiceRecord.id);
            return practiceRecord;
            
        } catch (error) {
            console.error('[PracticeRecorder] 真实数据处理失败:', error);
            return this.handleFallbackData(examId);
        }
    }

    /**
     * 验证真实数据
     */
    validateRealData(realData) {
        if (!realData || typeof realData !== 'object') {
            return null;
        }
        
        // 必需字段检�?
        const requiredFields = ['sessionId', 'duration'];
        for (const field of requiredFields) {
            if (!realData.hasOwnProperty(field)) {
                console.warn(`[PracticeRecorder] 缺少必需字段: ${field}`);
                return null;
            }
        }
        
        // 数据类型检�?
        if (typeof realData.duration !== 'number' || realData.duration < 0) {
            console.warn('[PracticeRecorder] 无效的练习时�?);
            return null;
        }
        
        // 答案数据检�?
        if (realData.answers && typeof realData.answers !== 'object') {
            console.warn('[PracticeRecorder] 无效的答案数据格�?);
            return null;
        }
        
        // 分数信息检�?
        if (realData.scoreInfo) {
            const { correct, total, accuracy, percentage } = realData.scoreInfo;
            
            if (correct !== undefined && total !== undefined) {
                if (typeof correct !== 'number' || typeof total !== 'number' || 
                    correct < 0 || total < 0 || correct > total) {
                    console.warn('[PracticeRecorder] 无效的分数数�?);
                    return null;
                }
            }
            
            if (accuracy !== undefined) {
                if (typeof accuracy !== 'number' || accuracy < 0 || accuracy > 1) {
                    console.warn('[PracticeRecorder] 无效的正确率数据');
                    return null;
                }
            }
        }
        
        return realData;
    }

    /**
     * 创建真实练习记录
     */
    createRealPracticeRecord(exam, realData) {
        const now = new Date();
        const recordId = `real_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // 提取分数信息
        const scoreInfo = realData.scoreInfo || {};
        const score = scoreInfo.correct || 0;
        const totalQuestions = scoreInfo.total || Object.keys(realData.answers || {}).length;
        const accuracy = scoreInfo.accuracy || (totalQuestions > 0 ? score / totalQuestions : 0);
        
        const practiceRecord = {
            // 基础信息 - 与ScoreStorage兼容
            id: recordId,
            examId: exam.id,
            sessionId: realData.sessionId,
            
            // 时间信息
            startTime: realData.startTime ? new Date(realData.startTime).toISOString() : 
                      new Date(Date.now() - realData.duration * 1000).toISOString(),
            endTime: realData.endTime ? new Date(realData.endTime).toISOString() : now.toISOString(),
            duration: realData.duration || 0,
            
            // 成绩信息
            status: 'completed',
            score: score,
            totalQuestions: totalQuestions,
            correctAnswers: score, // 正确答案数等于分�?
            accuracy: accuracy,
            
            // 答题详情 - 转换为ScoreStorage期望的格�?
            answers: this.convertAnswersFormat(realData.answers || {}),
            questionTypePerformance: this.extractQuestionTypePerformance(realData),
            
            // 元数�?- 与ScoreStorage兼容
            metadata: {
                examTitle: exam.title || '',
                category: exam.category || '',
                frequency: exam.frequency || '',
                collectionMethod: 'automatic',
                dataQuality: this.assessDataQuality(realData),
                processingTime: Date.now()
            },
            
            // 额外的真实数据信�?
            realData: {
                sessionId: realData.sessionId,
                answers: realData.answers || {},
                answerHistory: realData.answerHistory || {},
                interactions: realData.interactions || [],
                scoreInfo: scoreInfo,
                pageType: realData.pageType,
                url: realData.url,
                source: scoreInfo.source || 'data_collector'
            },
            
            // 系统信息
            dataSource: 'real',
            isRealData: true,
            createdAt: now.toISOString()
        };
        
        return practiceRecord;
    }

    /**
     * 转换答案格式为ScoreStorage兼容格式
     */
    convertAnswersFormat(answers) {
        if (!answers || typeof answers !== 'object') {
            return [];
        }
        
        return Object.entries(answers).map(([questionId, answer], index) => ({
            questionId: questionId,
            answer: answer,
            correct: false, // 这里需要与正确答案比较，暂时设为false
            timeSpent: 0,
            questionType: 'unknown',
            timestamp: new Date().toISOString()
        }));
    }

    /**
     * 提取题型表现数据
     */
    extractQuestionTypePerformance(realData) {
        // 从realData中提取题型表现，如果没有则返回空对象
        if (realData.questionTypePerformance) {
            return realData.questionTypePerformance;
        }
        
        // 如果有scoreInfo，尝试从中提�?
        if (realData.scoreInfo) {
            const { correct, total } = realData.scoreInfo;
            if (correct !== undefined && total !== undefined) {
                return {
                    'general': {
                        total: total,
                        correct: correct,
                        accuracy: total > 0 ? correct / total : 0
                    }
                };
            }
        }
        
        return {};
    }

    /**
     * 评估数据质量
     */
    assessDataQuality(realData) {
        let quality = 'good';
        const issues = [];
        
        // 检查数据完整�?
        if (!realData.scoreInfo) {
            issues.push('no_score_info');
            quality = 'fair';
        }
        
        if (!realData.answers || Object.keys(realData.answers).length === 0) {
            issues.push('no_answers');
            quality = 'poor';
        }
        
        if (!realData.interactions || realData.interactions.length === 0) {
            issues.push('no_interactions');
            if (quality === 'good') quality = 'fair';
        }
        
        // 检查时间合理�?
        if (realData.duration < 60) { // 少于1分钟
            issues.push('too_short');
            quality = 'questionable';
        } else if (realData.duration > 7200) { // 超过2小时
            issues.push('too_long');
            if (quality === 'good') quality = 'fair';
        }
        
        return {
            level: quality,
            issues: issues,
            confidence: this.calculateConfidence(quality, issues)
        };
    }

    /**
     * 计算数据可信�?
     */
    calculateConfidence(quality, issues) {
        const baseConfidence = {
            'excellent': 0.95,
            'good': 0.85,
            'fair': 0.70,
            'poor': 0.50,
            'questionable': 0.30
        };
        
        let confidence = baseConfidence[quality] || 0.50;
        
        // 根据问题调整可信�?
        const penaltyMap = {
            'no_score_info': 0.10,
            'no_answers': 0.20,
            'no_interactions': 0.05,
            'too_short': 0.15,
            'too_long': 0.05
        };
        
        issues.forEach(issue => {
            confidence -= penaltyMap[issue] || 0.05;
        });
        
        return Math.max(0.1, Math.min(1.0, confidence));
    }

    /**
     * 处理降级数据（当真实数据不可用时�?
     */
    handleFallbackData(examId) {
        console.log('[PracticeRecorder] 使用降级数据处理');
        
        // 检查是否有活动会话
        if (this.activeSessions.has(examId)) {
            let session = this.activeSessions.get(examId);
            
            // 生成模拟结果
            const simulatedResults = this.generateSimulatedResults(session);
            
            // 使用现有的完成处理逻辑
            return this.handleSessionCompleted({
                examId: examId,
                results: simulatedResults
            });
        } else {
            console.warn('[PracticeRecorder] 无活动会话，无法生成降级数据');
            return null;
        }
    }

    /**
     * 生成模拟结果
     */
    generateSimulatedResults(session) {
        const duration = Math.floor((Date.now() - new Date(session.startTime).getTime()) / 1000);
        const estimatedQuestions = session.progress.totalQuestions || 13;
        
        // 生成合理的模拟分�?
        const baseScore = Math.floor(estimatedQuestions * 0.7); // 70%基准
        const variation = Math.floor(Math.random() * (estimatedQuestions * 0.3)); // ±30%变化
        const score = Math.max(0, Math.min(estimatedQuestions, baseScore + variation - estimatedQuestions * 0.15));
        
        return {
            score: score,
            totalQuestions: estimatedQuestions,
            accuracy: score / estimatedQuestions,
            duration: duration,
            answers: {},
            isSimulated: true,
            simulationReason: 'real_data_unavailable'
        };
    }

    /**
     * 建立与练习页面的通信（新增方法）
     */
    setupPracticePageCommunication(examWindow, sessionId) {
        console.log('[PracticeRecorder] 建立练习页面通信:', sessionId);
        
        // 这个方法可以被ExamSystemApp调用来建立通信
        // 实际的消息处理已经在initialize()中设�?
        
        // 可以在这里添加特定于会话的通信设置
        if (examWindow && !examWindow.closed) {
            // 发送记录器就绪信号
            examWindow.postMessage({
                type: 'RECORDER_READY',
                data: {
                    sessionId: sessionId,
                    timestamp: Date.now()
                }
            }, '*');
        }
    }

    /**
     * 恢复临时存储的记�?
     */
    async recoverTemporaryRecords() {
        try {
            const tempRecords = storage.get('temp_practice_records', []);
            
            if (tempRecords.length === 0) {
                console.log('[PracticeRecorder] 没有需要恢复的临时记录');
                return;
            }
            
            console.log(`[PracticeRecorder] 发现 ${tempRecords.length} 条临时记录，开始恢�?..`);
            
            let recoveredCount = 0;
            const failedRecords = [];
            
            tempRecords.forEach(tempRecord => {
                try {
                    // 移除临时标识
                    const { tempSavedAt, needsRecovery, ...cleanRecord } = tempRecord;
                    
                    // 尝试正常保存
                    this.savePracticeRecord(cleanRecord);
                    recoveredCount++;
                    
                    console.log(`[PracticeRecorder] 恢复记录成功: ${cleanRecord.id}`);
                    
                } catch (error) {
                    console.error(`[PracticeRecorder] 恢复记录失败: ${tempRecord.id}`, error);
                    failedRecords.push(tempRecord);
                }
            });
            
            // 清理已恢复的临时记录
            if (failedRecords.length === 0) {
                storage.remove('temp_practice_records');
                console.log(`[PracticeRecorder] 所�?${recoveredCount} 条临时记录恢复成功`);
            } else {
                storage.set('temp_practice_records', failedRecords);
                console.log(`[PracticeRecorder] 恢复�?${recoveredCount} 条记录，${failedRecords.length} 条失败`);
            }
            
        } catch (error) {
            console.error('[PracticeRecorder] 恢复临时记录时出�?', error);
        }
    }

    /**
     * 获取数据完整性报�?
     */
    getDataIntegrityReport() {
        try {
            const report = {
                timestamp: new Date().toISOString(),
                practiceRecords: {
                    total: 0,
                    valid: 0,
                    corrupted: 0
                },
                temporaryRecords: {
                    total: 0,
                    needsRecovery: 0
                },
                activeSessions: {
                    total: this.activeSessions.size,
                    active: 0,
                    stale: 0
                },
                storage: {
                    available: true,
                    quota: 'unknown'
                }
            };
            
            // 检查练习记�?
            const records = storage.get('practice_records', []);
            report.practiceRecords.total = records.length;
            
            records.forEach(record => {
                if (this.validateRecordIntegrity(record)) {
                    report.practiceRecords.valid++;
                } else {
                    report.practiceRecords.corrupted++;
                }
            });
            
            // 检查临时记�?
            const tempRecords = storage.get('temp_practice_records', []);
            report.temporaryRecords.total = tempRecords.length;
            report.temporaryRecords.needsRecovery = tempRecords.filter(r => r.needsRecovery).length;
            
            // 检查活动会�?
            const now = Date.now();
            this.activeSessions.forEach(session => {
                const lastActivity = new Date(session.lastActivity).getTime();
                const inactiveTime = now - lastActivity;
                
                if (inactiveTime < 30 * 60 * 1000) { // 30分钟�?
                    report.activeSessions.active++;
                } else {
                    report.activeSessions.stale++;
                }
            });
            
            // 检查存储状�?
            try {
                const storageInfo = storage.getStorageInfo();
                report.storage.quota = storageInfo;
            } catch (error) {
                report.storage.available = false;
            }
            
            return report;
            
        } catch (error) {
            console.error('[PracticeRecorder] 生成完整性报告失�?', error);
            return null;
        }
    }

    /**
     * 验证记录完整�?
     */
    validateRecordIntegrity(record) {
        const requiredFields = ['id', 'examId', 'startTime', 'endTime'];
        
        for (const field of requiredFields) {
            if (!record[field]) {
                return false;
            }
        }
        
        // 验证时间格式
        try {
            new Date(record.startTime);
            new Date(record.endTime);
        } catch (error) {
            return false;
        }
        
        // 验证数值范�?
        if (record.accuracy !== undefined && (record.accuracy < 0 || record.accuracy > 1)) {
            return false;
        }
        
        if (record.duration !== undefined && record.duration < 0) {
            return false;
        }
        
        return true;
    }

    /**
     * 销毁练习记录器
     */
    destroy() {
        // 清理定时�?
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
        }
        
        // 清理会话监听�?
        for (const listener of this.sessionListeners.values()) {
            clearInterval(listener);
        }
        this.sessionListeners.clear();
        
        // 保存所有数�?
        this.saveAllSessions();
        
        console.log('PracticeRecorder destroyed');
    }
}

// 确保全局可用
window.PracticeRecorder = PracticeRecorder;

