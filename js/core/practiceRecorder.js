/**
 * 练习记录管理器
 * 负责练习会话管理、成绩记录和数据持久化
 */
class PracticeRecorder {
    constructor() {
        this.activeSessions = new Map();
        this.sessionListeners = new Map();
        this.autoSaveInterval = 30000; // 30秒自动保存
        this.autoSaveTimer = null;

        // 初始化存储系统
        this.scoreStorage = new ScoreStorage();
        this.repositories = window.dataRepositories;
        if (!this.repositories) {
            throw new Error('数据仓库未初始化，PracticeRecorder 无法构建');
        }
        this.practiceRepo = this.repositories.practice;
        this.metaRepo = this.repositories.meta;

        this.practiceTypeCache = new Map();

        // 异步初始化
        this.initialize().catch(error => {
            console.error('[PracticeRecorder] 初始化失败', error);
        });
    }

    normalizePracticeType(rawType) {
        if (!rawType) return null;
        const normalized = String(rawType).toLowerCase();
        if (normalized.includes('listen')) return 'listening';
        if (normalized.includes('read')) return 'reading';
        return null;
    }

    lookupExamIndexEntry(examId) {
        if (!examId) return null;

        if (this.practiceTypeCache.has(examId)) {
            return this.practiceTypeCache.get(examId);
        }

        const sources = [
            () => Array.isArray(window.examIndex) ? window.examIndex : null,
            () => Array.isArray(window.completeExamIndex)
                ? window.completeExamIndex.map(exam => ({ ...exam, type: exam.type || 'reading' }))
                : null,
            () => Array.isArray(window.listeningExamIndex) ? window.listeningExamIndex : null
        ];

        for (const getSource of sources) {
            const list = getSource();
            if (Array.isArray(list)) {
                const entry = list.find(item => item && item.id === examId);
                if (entry) {
                    this.practiceTypeCache.set(examId, entry);
                    return entry;
                }
            }
        }

        this.practiceTypeCache.set(examId, null);
        return null;
    }

    resolvePracticeType(session = {}, examEntry = null) {
        const examId = session.examId;
        const metadata = session.metadata || {};
        const cachedEntry = this.practiceTypeCache.get(examId);
        const entry = examEntry || cachedEntry || this.lookupExamIndexEntry(examId);

        const normalized = this.normalizePracticeType(
            metadata.type
            || metadata.examType
            || entry?.type
        );
        if (normalized) return normalized;

        if (entry) {
            const entryType = this.normalizePracticeType(entry.type);
            if (entryType) return entryType;
        }

        if (examId && String(examId).toLowerCase().includes('listening')) {
            return 'listening';
        }

        return 'reading';
    }

    resolveRecordDate(session = {}, fallbackEndTime) {
        const metadataDate = session.metadata?.date;
        const sourceDate = metadataDate
            || session.date
            || fallbackEndTime
            || session.endTime
            || session.startTime;
        const date = sourceDate ? new Date(sourceDate) : new Date();
        return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
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

    updateStreakDays(stats, practiceRecord) {
        if (!stats) return;

        const resolvedDate = practiceRecord?.date
            || practiceRecord?.endTime
            || practiceRecord?.startTime
            || this.resolveRecordDate(practiceRecord || {});
        const recordDay = this.getDateOnlyIso(resolvedDate);
        if (!recordDay) return;

        const practiceDays = Array.isArray(stats.practiceDays) ? stats.practiceDays.slice() : [];
        if (!practiceDays.includes(recordDay)) {
            practiceDays.push(recordDay);
        }

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

    buildRecordMetadata(session = {}, examEntry, type) {
        const metadata = { ...(session.metadata || {}) };
        const examId = session.examId;

        const derivedTitle = metadata.examTitle || metadata.title || examEntry?.title || examId || 'Unknown Exam';
        const derivedCategory = metadata.category || examEntry?.category || 'Unknown';
        const derivedFrequency = metadata.frequency || examEntry?.frequency || 'unknown';

        metadata.examTitle = derivedTitle;
        metadata.category = derivedCategory;
        metadata.frequency = derivedFrequency;
        metadata.type = type;
        metadata.examType = metadata.examType || type;

        return metadata;
    }

    /**
     * 初始化练习记录器
     */
    async initialize() {
        console.log('PracticeRecorder initialized');

        // 恢复活动会话
        await this.restoreActiveSessions();

        // 恢复临时存储的记录
        await this.recoverTemporaryRecords();

        // 设置消息监听器
        this.setupMessageListeners();

        // 启动自动保存
        this.startAutoSave();

        // 页面卸载时保存数据 - 全局事件必须使用原生 addEventListener
        window.addEventListener('beforeunload', () => {
            this.saveAllSessions().catch(error => {
                console.error('[PracticeRecorder] 页面关闭时保存会话失败:', error);
            });
        });
    }

    /**
     * 恢复活动会话
     */
    async restoreActiveSessions() {
        const raw = await this.metaRepo.get('active_sessions', []);
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
     * 设置消息监听器
     */
    setupMessageListeners() {
        // 监听来自考试窗口的消息 - 全局事件必须使用原生 addEventListener
        window.addEventListener('message', (event) => {
            this.handleExamMessage(event);
        });

        // 监听页面可见性变化 - 全局事件必须使用原生 addEventListener
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.checkSessionStatus();
            }
        });
    }

    /**
     * 处理来自考试窗口的消息
     */
    handleExamMessage(event) {
        const normalized = this.normalizeIncomingMessage(event && event.data);
        if (!normalized) {
            return;
        }
        const { type, data } = normalized;
        
        switch (type) {
            case 'session_started':
                this.handleSessionStarted(data);
                break;
            case 'session_progress':
                this.handleSessionProgress(data);
                break;
            case 'session_completed':
                this.handleSessionCompleted(data).catch(error => {
                    console.error('[PracticeRecorder] 会话完成处理失败:', error);
                });
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
            default:
                break;
        }
    }

    normalizeIncomingMessage(rawMessage) {
        if (!rawMessage || typeof rawMessage !== 'object') {
            return null;
        }

        const rawType = typeof rawMessage.type === 'string' ? rawMessage.type.trim() : '';
        if (!rawType) {
            return null;
        }

        const typeMap = {
            PRACTICE_COMPLETE: 'session_completed',
            practice_complete: 'session_completed',
            practice_completed: 'session_completed',
            PracticeComplete: 'session_completed',
            SESSION_COMPLETE: 'session_completed',
            session_complete: 'session_completed',
            sessionCompleted: 'session_completed',
            SESSION_PROGRESS: 'session_progress',
            session_progress: 'session_progress',
            practice_progress: 'session_progress'
        };

        const normalizedType = typeMap[rawType] || rawType;
        const payload = rawMessage.data || {};

        if (normalizedType === 'session_completed') {
            const shaped = this.ensureCompletionPayloadShape(payload);
            if (!shaped) {
                console.warn('[PracticeRecorder] 收到无法识别的练习完成数据，已忽略');
                return null;
            }
            return { type: 'session_completed', data: shaped };
        }

        if (!payload || typeof payload !== 'object') {
            return null;
        }

        return { type: normalizedType, data: payload };
    }

    ensureCompletionPayloadShape(data) {
        if (!data || typeof data !== 'object') {
            return null;
        }

        if (data.examId && data.results) {
            return data;
        }

        return this.normalizePracticeCompletePayload(data);
    }

    normalizePracticeCompletePayload(payload) {
        if (!payload || typeof payload !== 'object') {
            return null;
        }

        const scoreInfo = payload.scoreInfo || {};
        const toNumber = (value, fallback = 0) => {
            const num = Number(value);
            return Number.isFinite(num) ? num : fallback;
        };

        const normalizedAnswers = this.normalizeAnswerCollection(payload.answers, payload.correctAnswers);
        const totalQuestions = toNumber(
            payload.totalQuestions ?? scoreInfo.total ?? scoreInfo.totalQuestions,
            normalizedAnswers.length
        );
        const correctAnswers = toNumber(
            payload.correctAnswersCount ?? scoreInfo.correct ?? scoreInfo.score ?? payload.score,
            0
        );
        const accuracy = typeof payload.accuracy === 'number'
            ? payload.accuracy
            : (typeof scoreInfo.accuracy === 'number'
                ? scoreInfo.accuracy
                : (totalQuestions > 0 ? correctAnswers / totalQuestions : 0));
        const percentage = typeof scoreInfo.percentage === 'number'
            ? scoreInfo.percentage
            : Math.round(accuracy * 100);
        const duration = toNumber(
            payload.duration,
            (payload.endTime && payload.startTime)
                ? Math.round((new Date(payload.endTime) - new Date(payload.startTime)) / 1000)
                : 0
        );

        const examId = payload.examId || payload.metadata?.examId || null;
        if (!examId) {
            return null;
        }

        return {
            examId,
            sessionId: payload.sessionId || null,
            results: {
                score: toNumber(scoreInfo.score, correctAnswers),
                totalQuestions,
                correctAnswers,
                accuracy,
                percentage,
                duration,
                answers: normalizedAnswers,
                questionTypePerformance: payload.questionTypePerformance || {},
                interactions: payload.interactions || [],
                startTime: payload.startTime || null,
                endTime: payload.endTime || null,
                metadata: payload.metadata || {},
                source: scoreInfo.source || payload.pageType || 'practice_page'
            }
        };
    }

    normalizeAnswerCollection(answers = {}, correctAnswers = {}) {
        if (Array.isArray(answers)) {
            return answers;
        }
        const list = [];
        const normalizedCorrect = correctAnswers && typeof correctAnswers === 'object' ? correctAnswers : {};
        const entries = answers && typeof answers === 'object'
            ? Object.entries(answers)
            : [];
        const now = new Date().toISOString();

        for (const [rawKey, rawValue] of entries) {
            const normalizedKey = rawKey && rawKey.startsWith('q') ? rawKey : `q${rawKey}`;
            const answerValue = (rawValue && typeof rawValue === 'object' && 'answer' in rawValue)
                ? rawValue.answer
                : rawValue;
            const expected = normalizedCorrect[rawKey]
                ?? normalizedCorrect[normalizedKey]
                ?? null;
            const normalizedAnswerValue = answerValue == null ? '' : String(answerValue).trim().toLowerCase();
            const normalizedExpectedValue = expected == null ? '' : String(expected).trim().toLowerCase();
            const isCorrect = expected === null
                ? undefined
                : normalizedAnswerValue === normalizedExpectedValue;

            list.push({
                questionId: normalizedKey,
                answer: answerValue,
                correct: isCorrect,
                timeSpent: (rawValue && typeof rawValue.timeSpent === 'number') ? rawValue.timeSpent : 0,
                questionType: (rawValue && rawValue.questionType) || 'unknown',
                timestamp: now
            });
        }

        return list;
    }

    /**
     * 开始练习会话
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
        this.saveActiveSessions().catch(error => {
            console.error('[PracticeRecorder] 保存活动会话失败:', error);
        });
        
        // 设置会话监听器
        this.setupSessionListener(examId);
        
        console.log(`Practice session started for exam: ${examId}`);
        
        // 触发事件
        this.dispatchSessionEvent('sessionStarted', { examId, sessionData });
        
        return sessionData;
    }

    /**
     * 处理会话开始
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
            this.saveActiveSessions().catch(error => {
                console.error('[PracticeRecorder] 保存活动会话失败:', error);
            });
            
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
    async handleSessionCompleted(data) {
        const payload = this.ensureCompletionPayloadShape(data);
        if (!payload) {
            console.warn('[PracticeRecorder] 无法处理会话完成事件：缺少必要数据');
            return;
        }

        const { examId, results, sessionId } = payload;
        if (!examId) {
            console.warn('[PracticeRecorder] 完成事件缺少 examId，已忽略');
            return;
        }

        if (!this.activeSessions.has(examId)) {
            console.warn('[PracticeRecorder] 未找到匹配的活动会话，examId = %s', examId);
            return;
        }

        let session = this.activeSessions.get(examId);
        if (sessionId && session && session.sessionId !== sessionId) {
            session.sessionId = sessionId;
        }

        const resolvedEndTime = data && data.endTime
            ? new Date(data.endTime).toISOString()
            : (results && results.endTime ? new Date(results.endTime).toISOString() : new Date().toISOString());

        const examEntry = this.lookupExamIndexEntry(examId);
        const type = this.resolvePracticeType({ ...session, examId }, examEntry);
        const recordDate = this.resolveRecordDate({ ...session, endTime: resolvedEndTime }, resolvedEndTime);
        const metadata = this.buildRecordMetadata({ ...session, examId }, examEntry, type);

        // 计算总用时
        const duration = new Date(resolvedEndTime) - new Date(session.startTime);
        
        // 创建练习记录
        const practiceRecord = {
            id: `record_${session.sessionId}`,
            examId,
            sessionId: session.sessionId,
            startTime: session.startTime,
            endTime: resolvedEndTime,
            duration: Math.floor(duration / 1000), // 秒
            status: 'completed',
            type,
            date: recordDate,
            score: results?.score || 0,
            totalQuestions: results?.totalQuestions || session.progress.totalQuestions,
            correctAnswers: results?.correctAnswers || 0,
            accuracy: results?.accuracy || 0,
            answers: (results && Array.isArray(results.answers) && results.answers.length)
                ? results.answers
                : (session.answers || []),
            questionTypePerformance: results?.questionTypePerformance || {},
            metadata,
            createdAt: resolvedEndTime
        };
        
        try {
            const savedRecord = await this.savePracticeRecord(practiceRecord) || practiceRecord;
            await this.updateUserStats(practiceRecord);

            this.endPracticeSession(examId);

            console.log(`Practice session completed: ${examId}`);

            this.dispatchSessionEvent('sessionCompleted', { examId, practiceRecord: savedRecord });

            return savedRecord;
        } catch (error) {
            console.error(`[PracticeRecorder] 处理完成会话时出错:`, error);
            await this.saveToTemporaryStorage(practiceRecord);
            return practiceRecord;
        }
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
        this.saveActiveSessions().catch(error => {
            console.error('[PracticeRecorder] 保存活动会话失败:', error);
        });
        
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
        this.saveActiveSessions().catch(error => {
            console.error('[PracticeRecorder] 保存活动会话失败:', error);
        });
        
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
        this.saveActiveSessions().catch(error => {
            console.error('[PracticeRecorder] 保存活动会话失败:', error);
        });
        
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
            
            this.saveInterruptedRecord(interruptedRecord).catch(error => {
                console.error('[PracticeRecorder] 保存中断记录失败:', error);
            });
        }
        
        // 清理会话
        this.activeSessions.delete(examId);
        this.cleanupSessionListener(examId);
        this.saveActiveSessions().catch(error => {
            console.error('[PracticeRecorder] 保存活动会话失败:', error);
        });
        
        console.log(`Practice session ended: ${examId} (${reason})`);
        
        // 触发结束事件
        this.dispatchSessionEvent('sessionEnded', { examId, reason });
    }

    /**
     * 设置会话监听器
     */
    setupSessionListener(examId) {
        // 定期检查会话状态
        const listener = setInterval(() => {
            this.checkSessionActivity(examId);
        }, 60000); // 每分钟检查一次
        
        this.sessionListeners.set(examId, listener);
    }

    /**
     * 清理会话监听器
     */
    cleanupSessionListener(examId) {
        if (this.sessionListeners.has(examId)) {
            clearInterval(this.sessionListeners.get(examId));
            this.sessionListeners.delete(examId);
        }
    }

    /**
     * 检查会话活动状态
     */
    checkSessionActivity(examId) {
        if (!this.activeSessions.has(examId)) return;
        
        let session = this.activeSessions.get(examId);
        const now = new Date();
        const lastActivity = new Date(session.lastActivity);
        const inactiveTime = now - lastActivity;
        
        // 如果超过30分钟无活动，标记为超时
        if (inactiveTime > 30 * 60 * 1000) {
            console.warn(`Session timeout detected for exam: ${examId}`);
            this.endPracticeSession(examId, 'timeout');
        }
    }

    /**
     * 检查所有会话状态
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
            this.saveAllSessions().catch(error => {
                console.error('[PracticeRecorder] 自动保存失败:', error);
            });
        }, this.autoSaveInterval);
    }

    /**
     * 保存所有会话
     */
    async saveAllSessions() {
        try {
            await this.saveActiveSessions();
            console.log('Auto-saved all active sessions');
        } catch (error) {
            console.error('[PracticeRecorder] 保存活动会话失败:', error);
        }
    }

    /**
     * 保存活动会话到存储
     */
    async saveActiveSessions() {
        const sessionsArray = Array.from(this.activeSessions.values());
        await this.metaRepo.set('active_sessions', sessionsArray);
    }

    /**
     * 保存练习记录
     */
    async savePracticeRecord(record) {
        const maxRetries = 3;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`[PracticeRecorder] 开始保存练习记录(尝试 ${attempt}/${maxRetries}):`, record.id);

                if (this.scoreStorage && typeof this.scoreStorage.savePracticeRecord === 'function') {
                    const savedRecord = await this.scoreStorage.savePracticeRecord(record);
                    console.log(`[PracticeRecorder] ScoreStorage保存成功: ${savedRecord.id}`);

                    if (await this.verifyRecordSaved(savedRecord.id)) {
                        console.log('[PracticeRecorder] 记录保存验证成功');
                        return savedRecord;
                    }

                    console.warn('[PracticeRecorder] ScoreStorage保存验证失败，尝试降级保存');
                    throw new Error('ScoreStorage save verification failed');
                }

                console.warn('[PracticeRecorder] ScoreStorage不可用，使用降级保存');
                throw new Error('ScoreStorage not available');
            } catch (error) {
                console.error(`[PracticeRecorder] ScoreStorage保存失败 (尝试 ${attempt}):`, error);

                if (attempt === maxRetries || this.isCriticalError(error)) {
                    return await this.fallbackSavePracticeRecord(record);
                }

                const delay = attempt * 100;
                console.log(`[PracticeRecorder] 等待 ${delay}ms 后重试...`);
                await this.wait(delay);
            }
        }

        return await this.fallbackSavePracticeRecord(record);
    }

    /**
     * 降级保存练习记录
     */
    async fallbackSavePracticeRecord(record) {
        try {
            console.log('[PracticeRecorder] 使用降级保存方法');

            const standardizedRecord = this.standardizeRecordForFallback(record);

            const existing = await this.practiceRepo.list();
            let records = Array.isArray(existing) ? [...existing] : [];
            console.log('[PracticeRecorder] 当前记录数量:', records.length);

            const existingIndex = records.findIndex(r => r && r.id === standardizedRecord.id);
            if (existingIndex !== -1) {
                console.log('[PracticeRecorder] 发现重复记录，更新现有记录');
                records[existingIndex] = standardizedRecord;
            } else {
                records.unshift(standardizedRecord);
            }

            if (records.length > 1000) {
                records = records.slice(0, 1000);
            }

            const saveSuccess = await this.practiceRepo.overwrite(records);
            if (!saveSuccess) {
                throw new Error('Storage.set returned false');
            }

            console.log(`[PracticeRecorder] 降级保存成功: ${standardizedRecord.id}`);

            if (await this.verifyRecordSaved(standardizedRecord.id)) {
                console.log('[PracticeRecorder] 降级保存验证成功');
                await this.updateUserStatsManually(standardizedRecord);
                return standardizedRecord;
            }

            throw new Error('Fallback save verification failed');
        } catch (error) {
            console.error('[PracticeRecorder] 降级保存失败:', error);
            await this.saveToTemporaryStorage(record);
            throw new Error(`All save methods failed: ${error.message}`);
        }
    }

    /**
     * 标准化记录格式（用于降级保存）
     */
    standardizeRecordForFallback(recordData) {
        const now = new Date().toISOString();
        const endTime = recordData.endTime && !Number.isNaN(new Date(recordData.endTime).getTime())
            ? new Date(recordData.endTime).toISOString()
            : now;
        const examEntry = this.lookupExamIndexEntry(recordData.examId);
        const inferredType = this.normalizePracticeType(
            recordData.type
            || recordData.metadata?.type
            || examEntry?.type
            || (recordData.examId && String(recordData.examId).toLowerCase().includes('listening') ? 'listening' : null)
        ) || 'reading';
        const metadata = this.buildRecordMetadata(
            {
                examId: recordData.examId,
                metadata: recordData.metadata
            },
            examEntry,
            inferredType
        );
        const recordDate = recordData.date
            || this.resolveRecordDate(
                {
                    examId: recordData.examId,
                    startTime: recordData.startTime,
                    endTime,
                    metadata: recordData.metadata
                },
                endTime
            );
        const startTime = recordData.startTime && !Number.isNaN(new Date(recordData.startTime).getTime())
            ? new Date(recordData.startTime).toISOString()
            : recordDate;
        const resolvedTitle = recordData.title
            || metadata.examTitle
            || metadata.title
            || examEntry?.title
            || recordData.examId
            || '未命名练习';

        return {
            // 基础信息
            id: recordData.id || this.generateRecordId(),
            examId: recordData.examId,
            sessionId: recordData.sessionId,
            title: resolvedTitle,

            // 时间信息
            startTime,
            endTime,
            duration: Number(recordData.duration) || 0,
            date: recordDate,

            // 成绩信息
            status: recordData.status || 'completed',
            type: inferredType,
            score: Number(recordData.score) || 0,
            totalQuestions: Number(recordData.totalQuestions) || 0,
            correctAnswers: Number(recordData.correctAnswers) || 0,
            accuracy: Number(recordData.accuracy) || 0,

            // 答题详情
            answers: recordData.answers || [],
            questionTypePerformance: recordData.questionTypePerformance || {},

            // 元数据
            metadata,

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
     * 验证记录是否已保存
     */
    async verifyRecordSaved(recordId) {
        try {
            const records = await this.practiceRepo.list();
            const list = Array.isArray(records) ? records : [];
            return list.some(r => r && r.id === recordId);
        } catch (error) {
            console.error('[PracticeRecorder] 验证记录保存时出错', error);
            return false;
        }
    }

    /**
     * 判断是否为严重错误
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

    wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 手动更新用户统计
     */
    async updateUserStatsManually(practiceRecord) {
        try {
            const stats = await this.metaRepo.get('user_stats', {
                totalPractices: 0,
                totalTimeSpent: 0,
                averageScore: 0,
                categoryStats: {},
                questionTypeStats: {},
                streakDays: 0,
                practiceDays: [],
                lastPracticeDate: null,
                achievements: []
            });

            // 更新基础统计
            const duration = Number(practiceRecord.duration) || 0;
            const accuracy = Number(practiceRecord.accuracy) || 0;
            const normalizedRecord = { ...practiceRecord, duration, accuracy };

            stats.totalPractices += 1;
            stats.totalTimeSpent += duration;

            // 计算平均分数
            const totalScore = (stats.averageScore * (stats.totalPractices - 1)) + accuracy;
            stats.averageScore = totalScore / stats.totalPractices;

            // 更新连续学习天数
            this.updateStreakDays(stats, normalizedRecord);

            // 更新时间戳
            stats.updatedAt = new Date().toISOString();

            await this.metaRepo.set('user_stats', stats);
            console.log('[PracticeRecorder] 用户统计手动更新完成');

        } catch (error) {
            console.error('[PracticeRecorder] 手动更新用户统计失败:', error);
        }
    }

    /**
     * 保存到临时存储
     */
    async saveToTemporaryStorage(record) {
        try {
            const existing = await this.metaRepo.get('temp_practice_records', []);
            const tempRecords = Array.isArray(existing) ? [...existing] : [];
            tempRecords.push({
                ...record,
                tempSavedAt: new Date().toISOString(),
                needsRecovery: true
            });

            // 限制临时记录数量
            const finalTempRecords = tempRecords.length > 50 ? tempRecords.slice(-50) : tempRecords;

            await this.metaRepo.set('temp_practice_records', finalTempRecords);
            console.log('[PracticeRecorder] 记录已保存到临时存储:', record.id);

        } catch (error) {
            console.error('[PracticeRecorder] 临时存储也失败', error);
        }
    }

    /**
     * 保存中断记录
     */
    async saveInterruptedRecord(record) {
        const existing = await this.metaRepo.get('interrupted_records', []);
        const records = Array.isArray(existing) ? [...existing] : [];
        records.push(record);

        const finalRecords = records.length > 100 ? records.slice(-100) : records;

        await this.metaRepo.set('interrupted_records', finalRecords);
        console.log(`Interrupted record saved: ${record.id}`);
    }

    /**
     * 更新用户统计
     */
    async updateUserStats(practiceRecord) {
        const stats = await this.metaRepo.get('user_stats', {
            totalPractices: 0,
            totalTimeSpent: 0,
            averageScore: 0,
            categoryStats: {},
            questionTypeStats: {},
            streakDays: 0,
            practiceDays: [],
            lastPracticeDate: null,
            achievements: []
        });
        
        // 更新基础统计
        const duration = Number(practiceRecord.duration) || 0;
        const accuracy = Number(practiceRecord.accuracy) || 0;
        const normalizedRecord = { ...practiceRecord, duration, accuracy };

        stats.totalPractices += 1;
        stats.totalTimeSpent += duration;

        // 计算平均分数
        const totalScore = (stats.averageScore * (stats.totalPractices - 1)) + accuracy;
        stats.averageScore = totalScore / stats.totalPractices;

        // 更新分类统计
        const category = normalizedRecord.metadata.category;
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
            catStats.timeSpent += duration;
            catStats.bestScore = Math.max(catStats.bestScore, accuracy);

            const catTotalScore = (catStats.avgScore * (catStats.practices - 1)) + accuracy;
            catStats.avgScore = catTotalScore / catStats.practices;
        }

        // 更新题型统计
        if (normalizedRecord.questionTypePerformance) {
            Object.entries(normalizedRecord.questionTypePerformance).forEach(([type, performance]) => {
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
        this.updateStreakDays(stats, normalizedRecord);

        await this.metaRepo.set('user_stats', stats);
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
    async getPracticeRecords(filters = {}) {
        try {
            return await this.scoreStorage.getPracticeRecords(filters);
        } catch (error) {
            console.error('Failed to get practice records from ScoreStorage:', error);

            // 降级处理
            const records = await this.practiceRepo.list();
            const list = Array.isArray(records) ? records : [];

            if (Object.keys(filters).length === 0) {
                return list;
            }

            return list.filter(record => {
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
    async getUserStats() {
        try {
            return await this.scoreStorage.getUserStats();
        } catch (error) {
            console.error('Failed to get user stats from ScoreStorage:', error);

            // 降级处理
            return await this.metaRepo.get('user_stats', {
                totalPractices: 0,
                totalTimeSpent: 0,
                averageScore: 0,
                categoryStats: {},
                questionTypeStats: {},
                streakDays: 0,
                practiceDays: [],
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
    async handleRealPracticeData(examId, realData) {
        console.log('[PracticeRecorder] 处理真实练习数据:', examId, realData);

        try {
            // 验证数据完整性
            const validatedData = this.validateRealData(realData);

            if (!validatedData) {
                console.warn('[PracticeRecorder] 数据验证失败，使用模拟数据');
                return await this.handleFallbackData(examId);
            }

            // 获取题目信息
            const examIndex = await this.metaRepo.get('exam_index', []);
            const examList = Array.isArray(examIndex) ? examIndex : (Array.isArray(window.examIndex) ? window.examIndex : []);
            const exam = examList.find(e => e.id === examId);

            if (!exam) {
                console.error('[PracticeRecorder] 无法找到题目信息:', examId);
                return;
            }

            // 构造增强的练习记录
            const practiceRecord = this.createRealPracticeRecord(exam, validatedData);

            // 保存记录 - 这里ScoreStorage会自动更新用户统计
            const savedRecord = await this.savePracticeRecord(practiceRecord) || practiceRecord;

            // 清理活动会话
            this.activeSessions.delete(examId);
            await this.saveActiveSessions();

            // 触发完成事件
            this.dispatchSessionEvent('realDataProcessed', {
                examId,
                practiceRecord: savedRecord,
                dataSource: 'real'
            });

            console.log('[PracticeRecorder] 真实数据处理完成:', savedRecord.id);
            return savedRecord;

        } catch (error) {
            console.error('[PracticeRecorder] 真实数据处理失败:', error);
            return await this.handleFallbackData(examId);
        }
    }

    /**
     * 验证真实数据
     */
    validateRealData(realData) {
        if (!realData || typeof realData !== 'object') {
            return null;
        }
        
        // 必需字段检查
        const requiredFields = ['sessionId', 'duration'];
        for (const field of requiredFields) {
            if (!realData.hasOwnProperty(field)) {
                console.warn(`[PracticeRecorder] 缺少必需字段: ${field}`);
                return null;
            }
        }
        
        // 数据类型检查
        if (typeof realData.duration !== 'number' || realData.duration < 0) {
            console.warn('[PracticeRecorder] 无效的练习时间');
            return null;
        }
        
        // 答案数据检查
        if (realData.answers && typeof realData.answers !== 'object') {
            console.warn('[PracticeRecorder] 无效的答案数据格式');
            return null;
        }
        
        // 分数信息检查
        if (realData.scoreInfo) {
            const { correct, total, accuracy, percentage } = realData.scoreInfo;
            
            if (correct !== undefined && total !== undefined) {
                if (typeof correct !== 'number' || typeof total !== 'number' || 
                    correct < 0 || total < 0 || correct > total) {
                    console.warn('[PracticeRecorder] 无效的分数数据');
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
            correctAnswers: score, // 正确答案数等于分数
            accuracy: accuracy,
            
            // 答题详情 - 转换为ScoreStorage期望的格式
            answers: this.convertAnswersFormat(realData.answers || {}),
            questionTypePerformance: this.extractQuestionTypePerformance(realData),
            
            // 元数据 - 与ScoreStorage兼容
            metadata: {
                examTitle: exam.title || '',
                category: exam.category || '',
                frequency: exam.frequency || '',
                collectionMethod: 'automatic',
                dataQuality: this.assessDataQuality(realData),
                processingTime: Date.now()
            },
            
            // 额外的真实数据信息
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
        
        // 如果有scoreInfo，尝试从中提取
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
        
        // 检查数据完整性
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
        
        // 检查时间合理性
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
     * 计算数据可信度
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
        
        // 根据问题调整可信度
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
     * 处理降级数据（当真实数据不可用时）
     */
    async handleFallbackData(examId) {
        console.log('[PracticeRecorder] 使用降级数据处理');

        // 检查是否有活动会话
        if (this.activeSessions.has(examId)) {
            let session = this.activeSessions.get(examId);
            
            // 生成模拟结果
            const simulatedResults = this.generateSimulatedResults(session);
            
            // 使用现有的完成处理逻辑
            return await this.handleSessionCompleted({
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
        
        // 生成合理的模拟分数
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
        // 实际的消息处理已经在initialize()中设置
        
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
     * 恢复临时存储的记录
     */
    async recoverTemporaryRecords() {
        try {
            const tempRecords = await this.metaRepo.get('temp_practice_records', []);
            const list = Array.isArray(tempRecords) ? tempRecords : [];

            if (list.length === 0) {
                console.log('[PracticeRecorder] 没有需要恢复的临时记录');
                return;
            }

            console.log(`[PracticeRecorder] 发现 ${list.length} 条临时记录，开始恢复`);

            let recoveredCount = 0;
            const failedRecords = [];

            for (const tempRecord of list) {
                try {
                    // 移除临时标识
                    const { tempSavedAt, needsRecovery, ...cleanRecord } = tempRecord;

                    // 尝试正常保存
                    await this.savePracticeRecord(cleanRecord);
                    recoveredCount++;

                    console.log(`[PracticeRecorder] 恢复记录成功: ${cleanRecord.id}`);

                } catch (error) {
                    console.error(`[PracticeRecorder] 恢复记录失败: ${tempRecord.id}`, error);
                    failedRecords.push(tempRecord);
                }
            }

            // 清理已恢复的临时记录
            if (failedRecords.length === 0) {
                await this.metaRepo.remove('temp_practice_records');
                console.log(`[PracticeRecorder] 所有${recoveredCount} 条临时记录恢复成功`);
            } else {
                await this.metaRepo.set('temp_practice_records', failedRecords);
                console.log(`[PracticeRecorder] 恢复了${recoveredCount} 条记录，${failedRecords.length} 条失败`);
            }

        } catch (error) {
            console.error('[PracticeRecorder] 恢复临时记录时出错', error);
        }
    }

    /**
     * 获取数据完整性报告
     */
    async getDataIntegrityReport() {
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
            
            // 检查练习记录
            const records = await this.practiceRepo.list();
            const recordList = Array.isArray(records) ? records : [];
            report.practiceRecords.total = recordList.length;

            recordList.forEach(record => {
                if (this.validateRecordIntegrity(record)) {
                    report.practiceRecords.valid++;
                } else {
                    report.practiceRecords.corrupted++;
                }
            });

            // 检查临时记录
            const tempRecords = await this.metaRepo.get('temp_practice_records', []);
            const tempList = Array.isArray(tempRecords) ? tempRecords : [];
            report.temporaryRecords.total = tempList.length;
            report.temporaryRecords.needsRecovery = tempList.filter(r => r && r.needsRecovery).length;
            
            // 检查活动会话
            const now = Date.now();
            this.activeSessions.forEach(session => {
                const lastActivity = new Date(session.lastActivity).getTime();
                const inactiveTime = now - lastActivity;
                
                if (inactiveTime < 30 * 60 * 1000) { // 30分钟内
                    report.activeSessions.active++;
                } else {
                    report.activeSessions.stale++;
                }
            });
            
            // 检查存储状态
            try {
                const storageInfo = window.storage && typeof window.storage.getStorageInfo === 'function'
                    ? await window.storage.getStorageInfo()
                    : null;
                report.storage.quota = storageInfo;
            } catch (error) {
                report.storage.available = false;
            }

            return report;

        } catch (error) {
            console.error('[PracticeRecorder] 生成完整性报告失败', error);
            return null;
        }
    }

    /**
     * 验证记录完整性
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
        
        // 验证数值范围
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
        // 清理定时器
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
        }
        
        // 清理会话监听器
        for (const listener of this.sessionListeners.values()) {
            clearInterval(listener);
        }
        this.sessionListeners.clear();
        
        // 保存所有数据
        this.saveAllSessions().catch(error => {
            console.error('[PracticeRecorder] 销毁时保存会话失败:', error);
        });

        console.log('PracticeRecorder destroyed');
    }
}

// 确保全局可用
window.PracticeRecorder = PracticeRecorder;
