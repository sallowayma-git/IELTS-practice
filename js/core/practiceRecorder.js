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

        this.practiceTypeCache = new Map();

        // 异步初始化
        this.ready = (async () => {
            await window.AppData.ready;
            await this.initialize();
        })();

        this.ready.catch(error => {
            console.error('[PracticeRecorder] 初始化失败', error);
        });
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

    getCoreContracts() {
        return window.PracticeCore && window.PracticeCore.contracts
            ? window.PracticeCore.contracts
            : null;
    }

    requireCoreContract(name) {
        const coreContracts = this.getCoreContracts();
        if (coreContracts && typeof coreContracts[name] === 'function') {
            return coreContracts[name];
        }
        throw new Error(`PracticeRecorder requires PracticeCore.contracts.${name}`);
    }

    clonePlainObject(value) {
        const coreContracts = this.getCoreContracts();
        if (coreContracts && typeof coreContracts.clonePlainObject === 'function') {
            return coreContracts.clonePlainObject(value);
        }
        if (value == null || typeof value !== 'object') {
            return value ?? null;
        }
        if (Array.isArray(value)) {
            return value.map((item) => this.clonePlainObject(item));
        }
        const clone = {};
        Object.keys(value).forEach((key) => {
            clone[key] = this.clonePlainObject(value[key]);
        });
        return clone;
    }

    activeSessionEntityId(sessionOrId) {
        const rawId = sessionOrId && typeof sessionOrId === 'object'
            ? (sessionOrId.id || sessionOrId.sessionId)
            : sessionOrId;
        const normalized = String(rawId || '').trim();
        if (!normalized) {
            throw new Error('Active practice session requires a stable session id');
        }
        return normalized.startsWith('active-session:') ? normalized : `active-session:${normalized}`;
    }

    async persistActiveSession(session, previousEntityId = null) {
        const entity = Object.assign({}, session, { id: this.activeSessionEntityId(session) });
        const receipt = await window.AppData.recovery.saveActiveSession(entity);
        if (previousEntityId && previousEntityId !== entity.id) {
            await window.AppData.recovery.discardActiveSession(previousEntityId);
        }
        return receipt;
    }

    resolveAnnotationState(recordData = {}, fallbackSources = []) {
        const coreContracts = this.getCoreContracts();
        if (coreContracts && typeof coreContracts.resolveAnnotationState === 'function') {
            return coreContracts.resolveAnnotationState(recordData, fallbackSources);
        }
        const root = recordData && typeof recordData === 'object' ? recordData : {};
        const sources = [root, root.rawData, root.realData, root.rawData?.realData]
            .concat(Array.isArray(fallbackSources) ? fallbackSources : [fallbackSources])
            .filter((source) => source && typeof source === 'object' && !Array.isArray(source));
        const pickArray = (field) => {
            const source = sources.find((candidate) => Array.isArray(candidate[field]));
            return source ? this.clonePlainObject(source[field]) : [];
        };
        const pickString = (field) => {
            const source = sources.find((candidate) => typeof candidate[field] === 'string');
            return source ? source[field] : '';
        };
        const scrollSource = sources.find((candidate) => candidate.scrollY != null && Number.isFinite(Number(candidate.scrollY)));
        return {
            highlights: pickArray('highlights'),
            markedQuestions: pickArray('markedQuestions'),
            noteText: pickString('noteText'),
            notes: pickArray('notes'),
            noteOutlines: pickArray('noteOutlines'),
            scrollY: scrollSource ? Number(scrollSource.scrollY) : 0
        };
    }

    firstFiniteNumber(fallback, ...values) {
        for (const value of values) {
            if (value === undefined || value === null) {
                continue;
            }
            if (typeof value === 'string' && value.trim() === '') {
                continue;
            }
            const num = Number(value);
            if (Number.isFinite(num)) {
                return num;
            }
        }
        return fallback;
    }

    isInTestEnvironment() {
        try {
            if (window.EnvironmentDetector && typeof window.EnvironmentDetector.isInTestEnvironment === 'function') {
                return window.EnvironmentDetector.isInTestEnvironment();
            }
        } catch (error) {
            console.warn('[PracticeRecorder] 环境探测失败，默认按生产环境处理:', error);
        }
        return false;
    }

    isSyntheticSessionAllowed(payload = null) {
        const explicitAllow = Boolean(
            payload
            && typeof payload === 'object'
            && (
                payload.allowSyntheticSession === true
                || payload.allowSynthetic === true
                || payload?.results?.allowSyntheticSession === true
                || payload?.results?.allowSynthetic === true
                || payload?.metadata?.allowSyntheticSession === true
                || payload?.metadata?.allowSynthetic === true
                || payload?.results?.metadata?.allowSyntheticSession === true
                || payload?.results?.metadata?.allowSynthetic === true
            )
        );
        if (explicitAllow) {
            return true;
        }
        return this.isInTestEnvironment();
    }

    async recordRejectedCompletionPayload(payload, context = {}) {
        try {
            const snapshot = {
                id: `rejected_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                createdAt: new Date().toISOString(),
                context: Object.assign({}, context),
                payload: payload && typeof payload === 'object'
                    ? {
                        examId: payload.examId || null,
                        sessionId: payload.sessionId || null,
                        originalExamId: payload.originalExamId || null,
                        derivedExamId: payload.derivedExamId || null,
                        rawExamId: payload.rawExamId || null,
                        suiteSessionId: payload.suiteSessionId || null,
                        metadata: payload.metadata || payload.results?.metadata || null
                    }
                    : null
            };
            await window.AppData.recovery.saveRejectedCompletion(snapshot);
            const existing = await window.AppData.recovery.listRejectedCompletions();
            const list = (Array.isArray(existing) ? existing : [])
                .slice()
                .sort((left, right) => Date.parse(right.updatedAt || right.createdAt || 0) - Date.parse(left.updatedAt || left.createdAt || 0));
            for (const stale of list.slice(50)) {
                await window.AppData.recovery.discardRejectedCompletion(stale.id || stale.sessionId || stale.recordId);
            }
        } catch (error) {
            console.warn('[PracticeRecorder] 记录拒绝的完成负载失败:', error);
        }
    }

    lookupExamIndexEntry(examId, examIndex = []) {
        if (!examId) return null;

        const entry = (Array.isArray(examIndex) ? examIndex : [])
            .find(item => item && item.id === examId) || null;
        if (entry) this.practiceTypeCache.set(examId, entry);
        return entry;
    }

    resolvePracticeType(session = {}, examEntry = null) {
        const examId = session.examId;
        const metadata = session.metadata || {};
        const cachedEntry = this.practiceTypeCache.get(examId);
        const entry = examEntry || cachedEntry || null;

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
        console.log('[PracticeRecorder] 初始化完成');

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
        const raw = await window.AppData.recovery.listActiveSessions();
        const storedSessions = (Array.isArray(raw) ? raw : [])
            .filter((sessionData) => sessionData.schema !== 'suite-session-v2');

        storedSessions
            .slice()
            .sort((left, right) => Date.parse(left.updatedAt || left.lastActivity || 0) - Date.parse(right.updatedAt || right.lastActivity || 0))
            .forEach(sessionData => {
            this.activeSessions.set(sessionData.examId, {
                ...sessionData,
                id: this.activeSessionEntityId(sessionData),
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

        // Completion persistence belongs exclusively to the exam host protocol.  The
        // recorder is invoked there only after source/origin/token validation, so a
        // second global listener must never race it into a duplicate save.
        if (type === 'session_completed') {
            return;
        }

        switch (type) {
            case 'session_started':
                this.handleSessionStarted(data);
                break;
            case 'session_progress':
                this.handleSessionProgress(data);
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

        const normalizedComparison = this.normalizeAnswerComparison(
            payload.answerComparison || payload.realData?.answerComparison || null
        );

        const answerMap = this.mergeAnswerSources(
            payload.answerMap,
            payload.answers,
            payload.realData?.answers,
            this.convertComparisonToAnswerMap(normalizedComparison, 'userAnswer')
        );
        const correctAnswerMap = this.resolveRecordCorrectAnswerMap(
            Object.assign({}, payload, { answerComparison: normalizedComparison })
        );
        const answerDetails = this.buildCanonicalAnswerDetails(
            answerMap,
            correctAnswerMap,
            payload.answerDetails,
            scoreInfo.details,
            payload.realData?.scoreInfo?.details,
            normalizedComparison
        );
        const answerList = this.convertAnswerMapToArray(answerMap, correctAnswerMap);
        const annotations = this.resolveAnnotationState(payload);
        const questionTypeMap = payload.questionTypeMap && typeof payload.questionTypeMap === 'object'
            ? { ...payload.questionTypeMap }
            : (payload.realData?.questionTypeMap && typeof payload.realData.questionTypeMap === 'object'
                ? { ...payload.realData.questionTypeMap }
                : {});
        const totalQuestions = toNumber(
            payload.totalQuestions ?? scoreInfo.total ?? scoreInfo.totalQuestions,
            Object.keys(answerMap).length
        );
        const correctAnswers = this.firstFiniteNumber(
            0,
            payload.correctAnswers,
            payload.correctAnswersCount,
            scoreInfo.correct,
            scoreInfo.score,
            payload.score
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

        const examId = payload.examId || payload.metadata?.examId || payload.originalExamId || payload.derivedExamId || null;
        if (!examId) {
            return null;
        }

        return {
            examId,
            sessionId: payload.sessionId || null,
            originalExamId: payload.originalExamId || payload.metadata?.originalExamId || null,
            derivedExamId: payload.derivedExamId || payload.metadata?.derivedExamId || null,
            rawExamId: payload.examId || null,
            results: {
                score: toNumber(scoreInfo.score, correctAnswers),
                totalQuestions,
                correctAnswers,
                accuracy,
                percentage,
                duration,
                answers: answerList,
                answerMap,
                correctAnswerMap,
                answerDetails,
                answerComparison: normalizedComparison,
                questionTypePerformance: payload.questionTypePerformance || {},
                interactions: payload.interactions || [],
                ...annotations,
                questionTypeMap,
                startTime: payload.startTime || null,
                endTime: payload.endTime || null,
                metadata: Object.assign({}, payload.metadata || {}, {
                    markedQuestions: this.clonePlainObject(annotations.markedQuestions)
                }),
                source: scoreInfo.source || payload.pageType || 'practice_page',
                realData: Object.assign({}, payload.realData || {}, {
                    answers: answerMap,
                    correctAnswers: correctAnswerMap,
                    correctAnswerMap,
                    answerComparison: normalizedComparison,
                    ...this.clonePlainObject(annotations),
                    questionTypeMap,
                    scoreInfo: Object.assign({}, scoreInfo, { details: answerDetails })
                })
            }
        };
    }

    buildSyntheticCompletionSession(examId, results = {}, fallbackSessionId = null) {
        const durationSec = Number(results?.duration) || 0;
        const endTime = results?.endTime
            ? new Date(results.endTime).toISOString()
            : new Date().toISOString();
        const startTime = results?.startTime
            ? new Date(results.startTime).toISOString()
            : new Date(new Date(endTime).getTime() - durationSec * 1000).toISOString();

        const metadata = Object.assign({}, results?.metadata || {});
        if (results?.title && !metadata.examTitle) {
            metadata.examTitle = results.title;
        }
        if (results?.pageType && !metadata.category) {
            metadata.category = results.pageType;
        }
        const inferredType = this.normalizePracticeType(
            results?.type
            || metadata.type
            || metadata.examType
            || results?.pageType
            || (Array.isArray(results?.questionTypePerformance) ? 'reading' : null)
        );
        if (inferredType) {
            metadata.type = inferredType;
            metadata.examType = inferredType;
        }

        return {
            examId,
            sessionId: fallbackSessionId || this.generateSessionId(examId || 'synthetic'),
            startTime,
            lastActivity: endTime,
            status: 'completed',
            progress: {
                currentQuestion: results?.totalQuestions || 0,
                totalQuestions: results?.totalQuestions || 0,
                answeredQuestions: results?.totalQuestions || 0,
                timeSpent: durationSec
            },
            answers: this.normalizeAnswerMap(results?.answers || {}),
            metadata
        };
    }

    normalizeAnswerValue(value) {
        return this.requireCoreContract('normalizeAnswerValue')(value);
    }

    normalizeAnswerMap(rawAnswers = {}) {
        return this.requireCoreContract('normalizeAnswerMap')(rawAnswers);
    }

    mergeAnswerSources(...sources) {
        return this.requireCoreContract('mergeAnswerSources')(...sources);
    }

    resolveRecordCorrectAnswerMap(record = {}, ...prioritySources) {
        return this.requireCoreContract('resolveRecordCorrectAnswerMap')(record, { prioritySources });
    }

    convertComparisonToAnswerMap(comparison, key = 'correctAnswer') {
        return this.requireCoreContract('convertComparisonToMap')(comparison, key);
    }

    normalizeAnswerComparison(comparison) {
        return this.requireCoreContract('normalizeAnswerComparison')(comparison);
    }

    convertAnswerMapToArray(answerMap = {}, correctMap = {}) {
        return this.requireCoreContract('buildAnswerArray')(answerMap, correctMap);
    }

    convertAnswerArrayToMap(answerList = []) {
        return this.normalizeAnswerMap(answerList);
    }

    buildAnswerDetails(answerMap = {}, correctMap = {}) {
        return this.requireCoreContract('buildAnswerDetails')(answerMap, correctMap);
    }

    buildCanonicalAnswerDetails(answerMap = {}, correctMap = {}, ...detailSources) {
        const details = {};
        detailSources.forEach((source) => {
            if (!source || typeof source !== 'object') {
                return;
            }
            Object.entries(source).forEach(([questionId, detail]) => {
                if (!detail || typeof detail !== 'object') {
                    return;
                }
                details[questionId] = Object.assign({}, details[questionId] || {}, detail);
            });
        });

        const canonicalDetails = this.buildAnswerDetails(answerMap, correctMap);
        Object.entries(canonicalDetails || {}).forEach(([questionId, detail]) => {
            details[questionId] = Object.assign({}, details[questionId] || {}, detail);
        });
        return details;
    }

    deriveCorrectMapFromDetails(details) {
        return this.requireCoreContract('deriveCorrectMapFromDetails')(details);
    }

    /**
     * 开始练习会话
     */
    startPracticeSession(examId, examData = {}) {
        const requestedSessionId = examData && examData.sessionId != null
            ? String(examData.sessionId).trim()
            : '';
        const existing = this.activeSessions.has(examId)
            ? this.activeSessions.get(examId)
            : null;
        // Prefer an explicit host session id so INIT/COMPLETE and the recorder share one
        // identity.  Reuse an existing active session when the host rebinds the same exam.
        const sessionId = requestedSessionId
            || (existing && existing.sessionId)
            || this.generateSessionId(examId);
        const startTime = (existing && existing.startTime)
            || new Date().toISOString();
        const previousEntityId = existing
            ? this.activeSessionEntityId(existing)
            : null;

        const sessionData = {
            id: this.activeSessionEntityId(sessionId),
            sessionId,
            examId,
            startTime,
            lastActivity: new Date().toISOString(),
            status: existing ? (existing.status || 'started') : 'started',
            progress: Object.assign({
                currentQuestion: 0,
                totalQuestions: examData.totalQuestions || 0,
                answeredQuestions: 0,
                timeSpent: 0
            }, existing && existing.progress ? existing.progress : {}),
            answers: existing && existing.answers ? existing.answers : [],
            metadata: Object.assign({
                examTitle: examData.title || '',
                category: examData.category || '',
                frequency: examData.frequency || '',
                userAgent: navigator.userAgent,
                screenResolution: `${screen.width}x${screen.height}`,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                // 启动时捕获的题库配置 ID：mixin/调用方传入则写进会话 metadata，后续经
                // handleSessionCompleted 的 buildRecordMetadata 透传到记录 metadata。
                libraryConfigurationId: (examData && examData.libraryConfigurationId != null)
                    ? examData.libraryConfigurationId
                    : null
            }, existing && existing.metadata ? existing.metadata : {})
        };
        if (examData && examData.libraryConfigurationId != null) {
            sessionData.metadata.libraryConfigurationId = examData.libraryConfigurationId;
        }
        if (examData && examData.title) {
            sessionData.metadata.examTitle = examData.title;
        }

        // 存储会话
        this.activeSessions.set(examId, sessionData);
        this.persistActiveSession(sessionData, previousEntityId).catch(error => {
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
        const examId = data && data.examId != null ? String(data.examId).trim() : '';
        const sessionId = data && data.sessionId != null ? String(data.sessionId).trim() : '';
        const metadata = data && data.metadata && typeof data.metadata === 'object'
            ? data.metadata
            : null;

        if (!examId || !sessionId) {
            return;
        }

        // Host handshake (SESSION_READY / INIT rebind) must create the active session when
        // the full PracticeRecorder was hot-upgraded after a fallback start, or when the
        // early startPracticeSession raced ahead of the host expectedSessionId.
        if (!this.activeSessions.has(examId)) {
            this.startPracticeSession(examId, Object.assign({}, metadata || {}, {
                sessionId,
                title: metadata && (metadata.title || metadata.examTitle) || '',
                category: metadata && metadata.category || '',
                frequency: metadata && metadata.frequency || '',
                libraryConfigurationId: metadata && metadata.libraryConfigurationId != null
                    ? metadata.libraryConfigurationId
                    : null
            }));
            const created = this.activeSessions.get(examId);
            if (created) {
                created.status = 'active';
                this.activeSessions.set(examId, created);
            }
            console.log(`Session created on host confirm: ${examId}`);
            return;
        }

        let session = this.activeSessions.get(examId);
        const previousEntityId = this.activeSessionEntityId(session);
        session.sessionId = sessionId;
        session.id = this.activeSessionEntityId(sessionId);
        session.status = 'active';
        session.lastActivity = new Date().toISOString();

        if (metadata) {
            session.metadata = { ...session.metadata, ...metadata };
        }

        this.activeSessions.set(examId, session);
        this.persistActiveSession(session, previousEntityId).catch(error => {
            console.error('[PracticeRecorder] 保存活动会话失败:', error);
        });

        console.log(`Session confirmed started: ${examId}`);
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
            session.answers = Array.isArray(answers)
                ? this.convertAnswerArrayToMap(answers)
                : answers;
        }

        this.activeSessions.set(examId, session);

        // 触发进度事件
        this.dispatchSessionEvent('sessionProgress', { examId, progress });
    }

    /**
     * 处理会话完成
     */
    async handleSessionCompleted(rawData) {
        const payload = this.ensureCompletionPayloadShape(rawData);
        if (!payload) {
            console.warn('[PracticeRecorder] 无法处理会话完成事件：缺少必要数据');
            return;
        }

        const { results } = payload;
        const examIndex = await window.resolveActiveLibraryIndex();
        const candidateExamIds = [
            payload.examId,
            payload.originalExamId,
            payload.derivedExamId,
            payload.rawExamId
        ].map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean);

        let resolvedExamId = candidateExamIds[0] || null;
        let session = null;

        for (const candidateId of candidateExamIds) {
            if (candidateId && this.activeSessions.has(candidateId)) {
                resolvedExamId = candidateId;
                session = this.activeSessions.get(candidateId);
                break;
            }
        }

        if (!session && payload.sessionId) {
            for (const [storedExamId, storedSession] of this.activeSessions.entries()) {
                if (storedSession && storedSession.sessionId === payload.sessionId) {
                    resolvedExamId = storedExamId;
                    session = storedSession;
                    break;
                }
            }
        }

        if (!resolvedExamId) {
            resolvedExamId = payload.examId || payload.originalExamId || payload.derivedExamId || `unknown_${Date.now()}`;
        }

        if (session && payload.sessionId && session.sessionId !== payload.sessionId) {
            session.sessionId = payload.sessionId;
        }

        let syntheticSession = false;
        if (!session) {
            if (!this.isSyntheticSessionAllowed(payload)) {
                console.error('[PracticeRecorder] 活动会话缺失，生产环境拒绝合成数据保存:', {
                    resolvedExamId,
                    sessionId: payload.sessionId || null,
                    candidates: candidateExamIds
                });
                await this.recordRejectedCompletionPayload(payload, {
                    reason: 'missing_active_session',
                    resolvedExamId,
                    candidateExamIds
                });
                return null;
            }
            session = this.buildSyntheticCompletionSession(resolvedExamId, results, payload.sessionId);
            syntheticSession = true;
            console.warn('[PracticeRecorder] 未找到匹配的活动会话，测试环境启用合成数据保存:', resolvedExamId);
        }

        const resolvedEndTime = (() => {
            if (results?.endTime) return new Date(results.endTime).toISOString();
            if (session && session.lastActivity) return new Date(session.lastActivity).toISOString();
            if (results?.startTime && Number.isFinite(results?.duration)) {
                const startTs = new Date(results.startTime).getTime();
                return new Date(startTs + (Number(results.duration) || 0) * 1000).toISOString();
            }
            return new Date().toISOString();
        })();

        const resolvedStartTime = (() => {
            if (session?.startTime) return new Date(session.startTime).toISOString();
            if (results?.startTime) return new Date(results.startTime).toISOString();
            return new Date(new Date(resolvedEndTime).getTime() - (Number(results?.duration) || 0) * 1000).toISOString();
        })();

        session.startTime = resolvedStartTime;

        const examEntry = this.lookupExamIndexEntry(resolvedExamId, examIndex)
            || this.lookupExamIndexEntry(payload.originalExamId, examIndex)
            || this.lookupExamIndexEntry(payload.derivedExamId, examIndex);
        const type = this.resolvePracticeType({ ...session, examId: resolvedExamId }, examEntry);
        const recordDate = this.resolveRecordDate({ ...session, endTime: resolvedEndTime }, resolvedEndTime);
        let metadata = this.buildRecordMetadata(
            { ...session, examId: resolvedExamId, metadata: Object.assign({}, session.metadata, results?.metadata || {}) },
            examEntry,
            type
        );
        let suiteSessionId = payload.suiteSessionId
            || metadata?.suiteSessionId
            || session?.metadata?.suiteSessionId
            || null;
        if (!suiteSessionId) {
            suiteSessionId = this.resolveSuiteSessionFromApp(resolvedExamId);
        }
        if (suiteSessionId && !metadata.suiteSessionId) {
            metadata = Object.assign({}, metadata, { suiteSessionId });
        }
        if (suiteSessionId && !metadata.practiceMode) {
            metadata = Object.assign({}, metadata, { practiceMode: 'suite' });
        }

        const answerMap = this.mergeAnswerSources(
            results?.answerMap,
            Array.isArray(results?.answers) ? this.convertAnswerArrayToMap(results.answers) : results?.answers,
            results?.realData?.answers,
            session.answers,
            this.convertComparisonToAnswerMap(results?.answerComparison, 'userAnswer')
        );

        const correctAnswerMap = this.resolveRecordCorrectAnswerMap(Object.assign({}, results || {}, {
            rawData: Object.assign({}, results?.rawData || {}, {
                correctAnswerMap: session?.correctAnswerMap || results?.rawData?.correctAnswerMap
            })
        }));

        const answerDetails = this.buildCanonicalAnswerDetails(
            answerMap,
            correctAnswerMap,
            results?.answerDetails,
            results?.scoreInfo?.details,
            results?.realData?.scoreInfo?.details,
            results?.answerComparison
        );
        const answerList = this.convertAnswerMapToArray(answerMap, correctAnswerMap);
        const scoreInfo = Object.assign({}, results?.scoreInfo || {});
        if (!scoreInfo.details || Object.keys(scoreInfo.details || {}).length === 0) {
            scoreInfo.details = answerDetails;
        }

        const normalizedComparison = this.normalizeAnswerComparison(
            results?.answerComparison || results?.realData?.answerComparison || null
        );

        const explicitDurationSeconds = Number(results?.duration);
        const hasExplicitDuration = Number.isFinite(explicitDurationSeconds) && explicitDurationSeconds >= 0;
        const durationMs = hasExplicitDuration
            ? Math.floor(explicitDurationSeconds * 1000)
            : Math.max(new Date(resolvedEndTime) - new Date(resolvedStartTime), 0);
        const resolvedCorrectAnswers = this.firstFiniteNumber(
            0,
            results?.correctAnswers,
            results?.correctAnswersCount,
            scoreInfo.correct,
            scoreInfo.score,
            results?.score
        );
        const resolvedScore = this.firstFiniteNumber(resolvedCorrectAnswers, results?.score, scoreInfo.score, resolvedCorrectAnswers);
        const resolvedTotalQuestions = this.firstFiniteNumber(
            Object.keys(answerMap).length || Object.keys(correctAnswerMap).length,
            results?.totalQuestions,
            scoreInfo.total,
            scoreInfo.totalQuestions,
            session.progress?.totalQuestions
        );
        const resolvedAccuracy = this.firstFiniteNumber(
            resolvedTotalQuestions > 0 ? resolvedCorrectAnswers / resolvedTotalQuestions : 0,
            results?.accuracy,
            scoreInfo.accuracy
        );
        const annotations = this.resolveAnnotationState(results || {}, [session || {}]);
        metadata.markedQuestions = this.clonePlainObject(annotations.markedQuestions);

        const practiceRecord = {
            id: `record_${session.sessionId || this.generateSessionId(resolvedExamId)}`,
            examId: resolvedExamId,
            sessionId: session.sessionId || payload.sessionId || this.generateSessionId(resolvedExamId),
            startTime: resolvedStartTime,
            endTime: resolvedEndTime,
            duration: Math.floor(durationMs / 1000),
            status: 'completed',
            type,
            date: recordDate,
            score: resolvedScore,
            totalQuestions: resolvedTotalQuestions,
            correctAnswers: resolvedCorrectAnswers,
            accuracy: resolvedAccuracy,
            answers: answerMap,
            answerList,
            answerDetails,
            correctAnswerMap,
            scoreInfo,
            questionTypePerformance: results?.questionTypePerformance || {},
            ...annotations,
            metadata,
            suiteSessionId,
            createdAt: resolvedEndTime,
            realData: Object.assign({}, results?.realData || {}, {
                answers: answerMap,
                correctAnswers: correctAnswerMap,
                correctAnswerMap,
                scoreInfo,
                interactions: results?.interactions || [],
                isRealData: true,
                source: results?.source || 'practice_page',
                ...this.clonePlainObject(annotations)
            })
        };

        if (normalizedComparison && Object.keys(normalizedComparison).length > 0) {
            practiceRecord.answerComparison = normalizedComparison;
            practiceRecord.realData.answerComparison = normalizedComparison;
        }

        const allowSuiteStandaloneSave = payload?.allowStandaloneSave
            || results?.allowStandaloneSave
            || metadata?.allowStandaloneSave;

        if (suiteSessionId && !allowSuiteStandaloneSave) {
            console.log(`[PracticeRecorder] 套题模式条目 ${resolvedExamId} 属于 ${suiteSessionId}，跳过单篇记录保存。`);
            if (!syntheticSession && this.activeSessions.has(resolvedExamId)) {
                this.endPracticeSession(resolvedExamId);
            }
            return practiceRecord;
        }

        if (suiteSessionId && allowSuiteStandaloneSave && metadata && !metadata.suiteStandaloneSave) {
            metadata = Object.assign({}, metadata, { suiteStandaloneSave: true });
            practiceRecord.metadata = metadata;
        }

        try {
            const savedRecord = await this.savePracticeRecord(practiceRecord);

            if (!syntheticSession && this.activeSessions.has(resolvedExamId)) {
                this.endPracticeSession(resolvedExamId);
            }

            console.log(`Practice session completed: ${resolvedExamId}`);

            this.dispatchSessionEvent('sessionCompleted', { examId: resolvedExamId, practiceRecord: savedRecord });

            return savedRecord;
        } catch (error) {
            console.error('[PracticeRecorder] 处理完成会话时出错:', error);
            try {
                await this.saveToTemporaryStorage(practiceRecord);
            } catch (recoveryError) {
                console.error('[PracticeRecorder] canonical 与 recovery 提交均失败:', recoveryError);
                error.recoveryError = recoveryError;
            }
            throw error;
        }
    }

    resolveSuiteSessionFromApp(examId) {
        if (!examId) {
            return null;
        }
        try {
            const appInstance = typeof window !== 'undefined' ? window.app : null;
            if (!appInstance) {
                return null;
            }
            if (appInstance.suiteExamMap && typeof appInstance.suiteExamMap.get === 'function') {
                const mappedId = appInstance.suiteExamMap.get(examId);
                if (mappedId) {
                    return mappedId;
                }
            }
            const currentSession = appInstance.currentSuiteSession;
            if (currentSession && Array.isArray(currentSession.sequence)) {
                const match = currentSession.sequence.find(entry => entry && entry.examId === examId);
                if (match && currentSession.id) {
                    return currentSession.id;
                }
            }
            const stateSuite = appInstance.state && appInstance.state.suite;
            if (stateSuite && Array.isArray(stateSuite.sequence)) {
                const match = stateSuite.sequence.find(entry => entry && entry.examId === examId);
                if (match && stateSuite.sessionId) {
                    return stateSuite.sessionId;
                }
            }
        } catch (error) {
            console.warn('[PracticeRecorder] 无法从应用状态解析套题会话:', error);
        }
        return null;
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
    async endPracticeSession(examId, reason = 'completed') {
        if (!this.activeSessions.has(examId)) return false;

        const session = this.activeSessions.get(examId);
        let sessionEntityId;
        try {
            sessionEntityId = this.activeSessionEntityId(session);
        } catch (error) {
            console.error('[PracticeRecorder] 活动会话缺少稳定标识，已保留原检查点:', error);
            this.dispatchSessionEvent('sessionError', { examId, error });
            return false;
        }

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

            try {
                // The active checkpoint is the only durable copy until the
                // interrupted record commits. Never discard it on a failed
                // conversion (quota, backend loss, validation, etc.).
                await this.saveInterruptedRecord(interruptedRecord);
            } catch (error) {
                console.error('[PracticeRecorder] 保存中断记录失败:', error);
                this.dispatchSessionEvent('sessionError', { examId, error });
                return false;
            }
        }

        // The interrupted save may outlive a replacement or an in-place host
        // rebind. Only the original object and identity still own this cleanup.
        if (this.activeSessions.get(examId) !== session
            || this.activeSessionEntityId(session) !== sessionEntityId) {
            return true;
        }

        // 清理会话
        this.activeSessions.delete(examId);
        this.cleanupSessionListener(examId);
        try {
            await window.AppData.recovery.discardActiveSession(sessionEntityId);
        } catch (error) {
            console.error('[PracticeRecorder] 清理活动会话失败:', error);
        }

        // A new session can also start while the old checkpoint is discarded.
        if (this.activeSessions.has(examId)) {
            return true;
        }

        console.log(`Practice session ended: ${examId} (${reason})`);

        // 触发结束事件
        this.dispatchSessionEvent('sessionEnded', { examId, reason });
        return true;
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
        await this.saveActiveSessions();
        console.log('Auto-saved all active sessions');
    }

    /**
     * 保存活动会话到存储
     */
    async saveActiveSessions() {
        for (const session of this.activeSessions.values()) {
            await this.persistActiveSession(session);
        }
    }

    /**
     * 保存练习记录
     */
    async savePracticeRecord(record, options = {}) {
        const maxRetries = 3;
        const storageReadyRecord = this.prepareRecordForStorage(record);
        const saveOperationId = storageReadyRecord.operationId || this.generateOperationId('practice-complete');

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`[PracticeRecorder] 开始保存练习记录(尝试 ${attempt}/${maxRetries}):`, record.id);

                const receipt = await window.AppData.practice.completeAttempt({
                    record: storageReadyRecord,
                    operationId: saveOperationId
                });
                const savedRawRecord = receipt.record;
                const savedRecord = this.restoreRecordAnswerState(savedRawRecord, record);
                console.log(`[PracticeRecorder] AppData.practice 保存成功: ${savedRecord.id}`);

                const verified = await this.verifyRecordSaved(savedRecord.id);
                if (!verified) {
                    console.warn('[PracticeRecorder] AppData.practice 保存后未立即检出，稍后将由同步任务纠正');
                } else {
                    console.log('[PracticeRecorder] 记录保存验证成功');
                }
                return savedRecord;
            } catch (error) {
                console.error(
                    `[PracticeRecorder] AppData.practice 保存失败 (尝试 ${attempt}):`,
                    {
                        error: error?.message,
                        validationErrors: error?.validationErrors || null,
                        recordSummary: this.buildRecordLogSummary(storageReadyRecord)
                    },
                    error
                );

                if (attempt === maxRetries || this.isCriticalError(error)) {
                    return await this.retrySaveWithStandardizedRecord(record, saveOperationId);
                }

                const delay = attempt * 100;
                console.log(`[PracticeRecorder] 等待 ${delay}ms 后重试...`);
                await this.wait(delay);
            }
        }

        return await this.retrySaveWithStandardizedRecord(record, saveOperationId);
    }

    /**
     * 用标准化后的 payload 再走统一 API 保存。
     */
    async retrySaveWithStandardizedRecord(record, operationId = null) {
        try {
            console.log('[PracticeRecorder] 使用标准化记录重试保存');

            const examIndex = await window.resolveActiveLibraryIndex();
            const standardizedRecord = this.normalizeRecordForAppData(record, examIndex);
            const receipt = await window.AppData.practice.completeAttempt({
                record: standardizedRecord,
                operationId: operationId || standardizedRecord.operationId || this.generateOperationId('practice-complete')
            });
            return receipt.record;
        } catch (error) {
            console.error('[PracticeRecorder] 标准化重试保存失败:', {
                error: error?.message,
                validationErrors: error?.validationErrors || null,
                recordSummary: this.buildRecordLogSummary(record)
            }, error);
            throw error;
        }
    }

    /**
     * 标准化记录格式（用于统一 API 重试保存）。
     */
    normalizeRecordForAppData(recordData, examIndex = []) {
        const now = new Date().toISOString();
        const resolvedExamId = this.inferExamId(recordData);
        const endTime = recordData.endTime && !Number.isNaN(new Date(recordData.endTime).getTime())
            ? new Date(recordData.endTime).toISOString()
            : now;
        const examEntry = this.lookupExamIndexEntry(resolvedExamId, examIndex);
        const inferredType = this.normalizePracticeType(
            recordData.type
            || recordData.metadata?.type
            || examEntry?.type
            || (resolvedExamId && String(resolvedExamId).toLowerCase().includes('listening') ? 'listening' : null)
        ) || 'reading';
        const metadata = this.buildRecordMetadata(
            {
                examId: resolvedExamId,
                metadata: recordData.metadata
            },
            examEntry,
            inferredType
        );
        const recordDate = recordData.date
            || this.resolveRecordDate(
                {
                    examId: resolvedExamId,
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
        const answerMap = this.mergeAnswerSources(
            recordData.answerMap,
            recordData.answers,
            recordData.realData?.answers,
            recordData.answerList,
            this.convertComparisonToAnswerMap(recordData.answerComparison || recordData.realData?.answerComparison, 'userAnswer')
        );
        const correctAnswerMap = this.resolveRecordCorrectAnswerMap(recordData);
        const answerDetails = this.buildCanonicalAnswerDetails(
            answerMap,
            correctAnswerMap,
            recordData.answerDetails,
            recordData.scoreInfo?.details,
            recordData.realData?.scoreInfo?.details,
            recordData.answerComparison || recordData.realData?.answerComparison
        );
        const resolvedCorrectAnswers = this.firstFiniteNumber(
            0,
            recordData.correctAnswers,
            recordData.correctAnswersCount,
            recordData.scoreInfo?.correct,
            recordData.scoreInfo?.score,
            recordData.realData?.scoreInfo?.correct,
            recordData.realData?.scoreInfo?.score,
            recordData.score
        );
        const annotations = this.resolveAnnotationState(recordData, [recordData.metadata || {}]);
        metadata.markedQuestions = this.clonePlainObject(annotations.markedQuestions);

        return {
            // 基础信息
            id: recordData.id || this.generateRecordId(),
            examId: resolvedExamId,
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
            correctAnswers: resolvedCorrectAnswers,
            accuracy: Number(recordData.accuracy) || 0,

            // 答题详情
            answers: answerMap,
            answerList: this.convertAnswerMapToArray(answerMap, correctAnswerMap),
            answerDetails,
            correctAnswerMap,
            scoreInfo: Object.assign({}, recordData.scoreInfo || {}, { details: answerDetails }),
            questionTypePerformance: recordData.questionTypePerformance || {},
            ...annotations,
            realData: Object.assign({}, recordData.realData || {}, {
                answers: answerMap,
                correctAnswers: correctAnswerMap,
                correctAnswerMap,
                scoreInfo: Object.assign({}, recordData.realData?.scoreInfo || {}, { details: answerDetails }),
                ...this.clonePlainObject(annotations)
            }),

            // 元数据
            metadata,

            // 系统信息
            version: '0.6.2-fix',
            createdAt: recordData.createdAt || now,
            updatedAt: now
        };
    }

    /**
     * 验证记录是否已保存
     */
    async verifyRecordSaved(recordId) {
        try {
            return Boolean(await window.AppData.practice.get(recordId, { projection: 'light' }));
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

    buildRecordLogSummary(record) {
        if (!record || typeof record !== 'object') {
            return null;
        }
        return {
            id: record.id,
            examId: record.examId,
            type: record.type || record.metadata?.type || null,
            status: record.status,
            totalQuestions: record.totalQuestions,
            correctAnswers: record.correctAnswers,
            correctAnswersType: typeof record.correctAnswers
        };
    }

    prepareRecordForStorage(record) {
        if (!record) {
            return record;
        }
        const clone = Object.assign({}, record);
        if (!clone.examId) {
            const inferredExamId = this.inferExamId(record);
            if (inferredExamId) {
                clone.examId = inferredExamId;
                clone.metadata = Object.assign({}, clone.metadata || {}, { examId: inferredExamId });
            }
        }
        // normalizeAnswerMap 已经自动过滤噪声键和无效值
        const answerMap = this.mergeAnswerSources(
            record.answerMap,
            record.answers,
            record.realData?.answers,
            record.answerList,
            this.convertComparisonToAnswerMap(record.answerComparison || record.realData?.answerComparison, 'userAnswer')
        );
        const correctMap = this.resolveRecordCorrectAnswerMap(record);
        const annotations = this.resolveAnnotationState(record, [record.metadata || {}]);

        const answerList = this.convertAnswerMapToArray(answerMap, correctMap);
        clone.answerList = answerList;
        // AppData v2 stores canonical answer maps in the detail entity. Converting
        // `answers` to the legacy array shape here makes persisted review records
        // unreadable to consumers that intentionally accept maps only.
        clone.answers = answerMap;
        clone.correctAnswerMap = correctMap;
        clone.questionTypeMap = this.clonePlainObject(
            record.questionTypeMap || record.realData?.questionTypeMap || {}
        );
        clone.interactions = this.clonePlainObject(
            Array.isArray(record.interactions)
                ? record.interactions
                : (Array.isArray(record.realData?.interactions) ? record.realData.interactions : [])
        );
        clone.answerDetails = this.buildCanonicalAnswerDetails(
            answerMap,
            correctMap,
            record.answerDetails,
            record.scoreInfo?.details,
            record.realData?.scoreInfo?.details,
            record.answerComparison || record.realData?.answerComparison
        );
        clone.scoreInfo = Object.assign({}, clone.scoreInfo || {}, { details: clone.answerDetails });
        Object.assign(clone, this.clonePlainObject(annotations));
        clone.metadata = Object.assign({}, clone.metadata || {}, {
            markedQuestions: this.clonePlainObject(annotations.markedQuestions)
        });

        if (clone.answerComparison) {
            clone.answerComparison = this.normalizeAnswerComparison(clone.answerComparison);
        }

        clone.realData = Object.assign({}, clone.realData || {}, {
            answers: answerMap,
            correctAnswers: correctMap,
            correctAnswerMap: correctMap,
            scoreInfo: Object.assign({}, clone.realData?.scoreInfo || {}, { details: clone.answerDetails }),
            ...this.clonePlainObject(annotations)
        });
        if (clone.realData.answerComparison) {
            clone.realData.answerComparison = this.normalizeAnswerComparison(clone.realData.answerComparison);
        }
        return clone;
    }

    restoreRecordAnswerState(savedRecord, sourceRecord) {
        const clone = Object.assign({}, savedRecord || {});
        if (Array.isArray(clone.answers)) {
            clone.answerList = clone.answers.slice();
            clone.answers = this.convertAnswerArrayToMap(clone.answerList);
        } else if (!clone.answers && sourceRecord && sourceRecord.answers) {
            clone.answers = sourceRecord.answers;
        }
        clone.correctAnswerMap = this.resolveRecordCorrectAnswerMap({
            correctAnswerMap: clone.correctAnswerMap,
            realData: clone.realData,
            rawData: sourceRecord || {},
            correctAnswers: clone.correctAnswers,
            answerDetails: clone.answerDetails,
            scoreInfo: clone.scoreInfo,
            answerComparison: clone.answerComparison || clone.realData?.answerComparison
        });
        const details = this.buildCanonicalAnswerDetails(
            clone.answers || {},
            clone.correctAnswerMap,
            clone.answerDetails,
            clone.scoreInfo?.details,
            clone.realData?.scoreInfo?.details,
            sourceRecord?.answerDetails,
            sourceRecord?.scoreInfo?.details,
            sourceRecord?.realData?.scoreInfo?.details,
            clone.answerComparison || clone.realData?.answerComparison,
            sourceRecord?.answerComparison || sourceRecord?.realData?.answerComparison
        );
        clone.answerDetails = details;
        clone.scoreInfo = Object.assign({}, clone.scoreInfo || {}, {
            details
        });
        clone.realData = Object.assign({}, clone.realData || {}, {
            answers: clone.answers,
            correctAnswers: clone.correctAnswerMap,
            correctAnswerMap: clone.correctAnswerMap,
            scoreInfo: Object.assign({}, clone.realData?.scoreInfo || {}, { details })
        });
        const annotations = this.resolveAnnotationState(clone, [sourceRecord || {}]);
        Object.assign(clone, this.clonePlainObject(annotations));
        clone.realData = Object.assign({}, clone.realData, this.clonePlainObject(annotations));
        return clone;
    }

    /**
     * 手动更新用户统计
     */
    async updateUserStatsManually(practiceRecord) {
        try {
            await this.updateUserStats(practiceRecord);
            return true;
        } catch (error) {
            console.error('[PracticeRecorder] 手动更新用户统计失败:', error);
            return false;
        }
    }

    /**
     * 保存到临时存储
     */
    async saveToTemporaryStorage(record) {
        const recordId = String(record && (record.id || record.sessionId) || `record-${Date.now()}`);
        const receipt = await window.AppData.recovery.saveDraft({
            id: `practice-record:${recordId}`,
            recordId,
            kind: 'practice_record_recovery',
            record: this.clonePlainObject(record),
            tempSavedAt: new Date().toISOString(),
            needsRecovery: true
        });

        try {
            const drafts = await window.AppData.recovery.listDrafts();
            const recoveryDrafts = (Array.isArray(drafts) ? drafts : [])
                .filter((draft) => draft && draft.kind === 'practice_record_recovery')
                .sort((left, right) => Date.parse(left.updatedAt || left.tempSavedAt || 0) - Date.parse(right.updatedAt || right.tempSavedAt || 0));
            for (const stale of recoveryDrafts.slice(0, Math.max(0, recoveryDrafts.length - 50))) {
                await window.AppData.recovery.discardDraft(stale.id);
            }
        } catch (error) {
            console.warn('[PracticeRecorder] recovery 草稿清理失败，不影响已提交草稿:', error);
        }
        console.log('[PracticeRecorder] 记录已保存到临时存储:', record.id);
        return receipt;
    }

    /**
     * 保存中断记录
     */
    async saveInterruptedRecord(record) {
        await window.AppData.recovery.saveInterrupted(record);
        const existing = await window.AppData.recovery.listInterrupted();
        const records = (Array.isArray(existing) ? existing : [])
            .slice()
            .sort((left, right) => Date.parse(right.updatedAt || right.createdAt || 0) - Date.parse(left.updatedAt || left.createdAt || 0));
        for (const stale of records.slice(100)) {
            await window.AppData.recovery.discardInterrupted(stale.id || stale.sessionId || stale.recordId);
        }
        console.log(`Interrupted record saved: ${record.id}`);
    }

    /**
     * 更新用户统计
     */
    async updateUserStats(practiceRecord) {
        await window.AppData.practice.getStats();
    }

    async listPracticeRecordsForStats() {
        const records = await window.AppData.practice.list({ projection: 'light' });
        return Array.isArray(records) ? records : [];
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
            // 过滤条件（examId/metadata.category/startTime/date/accuracy）与唯一内部消费者
            // getDataIntegrityReport -> validateRecordIntegrity（id/examId/startTime/endTime/accuracy/duration）
            // 都在 light 投影覆盖范围内，不需要拉取答题详情。
            const records = await window.AppData.practice.list({ projection: 'light' });
            const list = Array.isArray(records) ? records : [];
            if (Object.keys(filters).length === 0) {
                return list;
            }
            return list.filter(record => {
                if (filters.examId && record.examId !== filters.examId) return false;
                if (filters.category && record.metadata && record.metadata.category !== filters.category) return false;
                if (filters.startDate && new Date(record.startTime || record.date) < new Date(filters.startDate)) return false;
                if (filters.endDate && new Date(record.startTime || record.date) > new Date(filters.endDate)) return false;
                if (filters.minAccuracy && record.accuracy < filters.minAccuracy) return false;
                if (filters.maxAccuracy && record.accuracy > filters.maxAccuracy) return false;

                return true;
            });
        } catch (error) {
            console.error('Failed to get practice records from AppData.practice:', error);
            return [];
        }
    }

    getDefaultUserStats() {
        return {
            totalPractices: 0,
            totalTimeSpent: 0,
            averageScore: 0,
            categoryStats: {},
            questionTypeStats: {},
            streakDays: 0,
            practiceDays: [],
            lastPracticeDate: null,
            achievements: []
        };
    }

    convertRecordsToCSV(records) {
        const list = Array.isArray(records) ? records : [];
        if (list.length === 0) return '';
        const headers = [
            'ID', '考试ID', '开始时间', '结束时间', '用时(秒)',
            '状态', '分数', '总题数', '正确数', '准确率',
            '分类', '频率', '题目标题'
        ];
        const rows = list.map(record => {
            const metadata = record && record.metadata ? record.metadata : {};
            return [
                record?.id ?? '',
                record?.examId ?? '',
                record?.startTime ?? '',
                record?.endTime ?? '',
                record?.duration ?? '',
                record?.status ?? '',
                record?.score ?? '',
                record?.totalQuestions ?? '',
                record?.correctAnswers ?? '',
                `${Math.round((Number(record?.accuracy) || 0) * 100)}%`,
                metadata.category || '',
                metadata.frequency || '',
                metadata.examTitle || ''
            ];
        });
        return [headers, ...rows]
            .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
            .join('\n');
    }

    /**
     * 获取用户统计
     */
    async getUserStats() {
        return Object.assign(this.getDefaultUserStats(), await window.AppData.practice.getStats());
    }

    /**
     * 导出练习数据
     */
    async exportData(format = 'json') {
        const normalizedFormat = String(format || 'json').toLowerCase();
        if (normalizedFormat === 'csv') {
            const records = await this.listPracticeRecordsForStats();
            return this.convertRecordsToCSV(records);
        }
        if (normalizedFormat !== 'json') {
            throw new Error(`Unsupported export format: ${format}`);
        }
        const snapshot = await window.AppData.backups.export({ domains: ['practice'] });
        return JSON.stringify(snapshot, null, 2);
    }

    /**
     * 导入练习数据
     */
    async importData(data, options = {}) {
        const mergeMode = options.merge === false || options.mergeMode === 'replace'
            ? 'replace'
            : (options.mergeMode || 'merge');
        const payload = Array.isArray(data) ? { records: data } : data;
        const preview = await window.AppData.backups.previewImport(payload, { practiceMode: mergeMode });
        const backup = options.createBackup === false
            ? null
            : await window.AppData.backups.create({ type: 'pre-import' });
        const receipt = await window.AppData.backups.commitImport(preview.id, {
            operationId: options.operationId,
            confirmDestructive: mergeMode === 'replace'
        });
        try {
            await window.AppData.backups.recordImport({ type: preview.format, keys: preview.keys, backupId: backup && backup.id, practice: preview.practice });
        } catch (historyError) {
            console.warn('[PracticeRecorder] 导入已提交，但历史记录写入失败:', historyError);
        }
        return Object.assign({}, receipt, { backupId: backup && backup.id });
    }

    /**
     * 创建数据备份
     */
    createBackup(backupName = null) {
        return window.AppData.backups.create({ id: backupName || undefined, type: 'practice-recorder' });
    }

    /**
     * 恢复数据备份
     */
    restoreBackup(backupId) {
        return window.AppData.backups.restore(backupId);
    }

    /**
     * 获取备份列表
     */
    getBackups() {
        try {
            return window.AppData.backups.list();
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
            return window.AppData.status();
        } catch (error) {
            console.error('Failed to get storage stats:', error);
            return null;
        }
    }

    generateRecordId() {
        return `record_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    generateOperationId(prefix = 'operation') {
        try {
            if (window.crypto && typeof window.crypto.randomUUID === 'function') {
                return `${prefix}_${window.crypto.randomUUID()}`;
            }
        } catch (_) {
            // fall through to timestamp entropy
        }
        return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 12)}`;
    }

    /**
     * 生成会话ID（可选带 examId 前缀，便于与宿主 expectedSessionId 对齐）
     */
    generateSessionId(examId) {
        const suffix = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const normalizedExamId = typeof examId === 'string'
            ? examId.trim().replace(/\s+/g, '-')
            : (examId != null ? String(examId).trim().replace(/\s+/g, '-') : '');
        if (normalizedExamId) {
            return `${normalizedExamId}_${suffix}`;
        }
        return `session_${suffix}`;
    }

    extractExamIdFromRecordId(recordId) {
        if (typeof recordId !== 'string') return null;
        const match = recordId.match(/^record_([^_]+)_/);
        return match && match[1] ? match[1] : null;
    }

    inferExamId(record = {}) {
        if (!record || typeof record !== 'object') return null;
        if (record.examId) return record.examId;
        if (record.metadata?.examId) return record.metadata.examId;
        if (Array.isArray(record.suiteEntries)) {
            const suiteExam = record.suiteEntries.find(entry => entry && entry.examId);
            if (suiteExam) return suiteExam.examId;
        }
        return this.extractExamIdFromRecordId(record.id);
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
                if (this.isSyntheticSessionAllowed(realData)) {
                    console.warn('[PracticeRecorder] 数据验证失败，测试环境使用模拟数据');
                    return await this.handleFallbackData(examId);
                }
                console.error('[PracticeRecorder] 数据验证失败，生产环境拒绝模拟数据回退:', examId);
                return null;
            }

            // 获取题目信息
            const examIndex = await window.resolveActiveLibraryIndex();
            const examList = Array.isArray(examIndex) ? examIndex : [];
            const exam = examList.find(e => e.id === examId);

            if (!exam) {
                console.error('[PracticeRecorder] 无法找到题目信息:', examId);
                return;
            }

            // 构造增强的练习记录
            const practiceRecord = this.createRealPracticeRecord(exam, validatedData);

            // AppData 在权威提交后调度统计投影。
            const savedRecord = await this.savePracticeRecord(practiceRecord);

            // 清理活动会话
            this.endPracticeSession(examId);

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
            if (this.isSyntheticSessionAllowed(realData)) {
                return await this.handleFallbackData(examId);
            }
            return null;
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
        const answerComparison = this.normalizeAnswerComparison(
            realData.answerComparison || realData.realData?.answerComparison || null
        );
        const answerMap = this.mergeAnswerSources(
            realData.answerMap,
            realData.answers,
            this.convertComparisonToAnswerMap(answerComparison, 'userAnswer')
        );
        const correctAnswerMap = this.resolveRecordCorrectAnswerMap(
            Object.assign({}, realData, { answerComparison })
        );
        const questionTypeMap = realData.questionTypeMap && typeof realData.questionTypeMap === 'object'
            ? { ...realData.questionTypeMap }
            : {};
        const answerList = this.convertAnswersFormat(
            answerMap,
            correctAnswerMap,
            answerComparison,
            questionTypeMap
        );
        const totalQuestions = scoreInfo.total || Object.keys(correctAnswerMap).length || Object.keys(answerMap).length;
        const accuracy = scoreInfo.accuracy || (totalQuestions > 0 ? score / totalQuestions : 0);
        const annotations = this.resolveAnnotationState(realData);

        const practiceRecord = {
            // 基础信息
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

            // 答题详情
            answers: answerList,
            correctAnswerMap,
            answerComparison,
            questionTypeMap,
            questionTypePerformance: this.extractQuestionTypePerformance(realData),
            ...annotations,

            // 元数据
            metadata: {
                examTitle: exam.title || '',
                category: exam.category || '',
                frequency: exam.frequency || '',
                markedQuestions: this.clonePlainObject(annotations.markedQuestions),
                collectionMethod: 'automatic',
                dataQuality: this.assessDataQuality(realData),
                processingTime: Date.now(),
                // 启动时捕获的题库配置 ID：优先取 realData 与其 metadata 显式透传的值；
                // 若上游未透传则显式写入 null（保留 key），让 AppData 记录 provenance
                // 不再回退读取当前激活题库，避免记录来源在提交时被切换题库影响。
                libraryConfigurationId: (realData
                    && realData.libraryConfigurationId !== undefined
                    && realData.libraryConfigurationId !== null)
                    ? realData.libraryConfigurationId
                    : (realData
                        && realData.metadata
                        && realData.metadata.libraryConfigurationId !== undefined
                        && realData.metadata.libraryConfigurationId !== null)
                        ? realData.metadata.libraryConfigurationId
                        : null
            },

            // 额外的真实数据信息
            realData: Object.assign({}, realData, {
                sessionId: realData.sessionId,
                answers: answerMap,
                correctAnswers: correctAnswerMap,
                correctAnswerMap,
                answerComparison,
                questionTypeMap,
                answerHistory: realData.answerHistory || {},
                interactions: realData.interactions || [],
                ...this.clonePlainObject(annotations),
                scoreInfo: scoreInfo,
                pageType: realData.pageType,
                url: realData.url,
                source: scoreInfo.source || 'data_collector'
            }),

            // 系统信息
            dataSource: 'real',
            isRealData: true,
            createdAt: now.toISOString()
        };

        return practiceRecord;
    }

    /**
     * 转换答案格式为 canonical record 格式
     */
    convertAnswersFormat(answers, correctAnswerMap = {}, answerComparison = {}, questionTypeMap = {}) {
        if (!answers || typeof answers !== 'object') {
            return [];
        }

        return Object.entries(answers).map(([questionId, answer], index) => ({
            questionId: questionId,
            answer: answer,
            correct: (() => {
                const comparisonEntry = answerComparison && typeof answerComparison === 'object'
                    ? answerComparison[questionId]
                    : null;
                if (comparisonEntry && typeof comparisonEntry.isCorrect === 'boolean') {
                    return comparisonEntry.isCorrect;
                }
                const correctAnswer = correctAnswerMap && Object.prototype.hasOwnProperty.call(correctAnswerMap, questionId)
                    ? correctAnswerMap[questionId]
                    : '';
                return correctAnswer !== '' && String(answer).trim().toLowerCase() === String(correctAnswer).trim().toLowerCase();
            })(),
            timeSpent: 0,
            questionType: (() => {
                const comparisonEntry = answerComparison && typeof answerComparison === 'object'
                    ? answerComparison[questionId]
                    : null;
                return (comparisonEntry && (comparisonEntry.questionType || comparisonEntry.type))
                    || questionTypeMap[questionId]
                    || 'unknown';
            })(),
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
            }, window.location.protocol === 'file:' ? '*' : window.location.origin);
        }
    }

    /**
     * 恢复临时存储的记录
     */
    async recoverTemporaryRecords() {
        try {
            const tempRecords = await window.AppData.recovery.listDrafts();
            const list = (Array.isArray(tempRecords) ? tempRecords : []).filter((draft) => (
                draft
                && (draft.kind === 'practice_record_recovery' || draft.needsRecovery === true)
            ));

            if (list.length === 0) {
                console.log('[PracticeRecorder] 没有需要恢复的临时记录');
                return;
            }

            console.log(`[PracticeRecorder] 发现 ${list.length} 条临时记录，开始恢复`);

            let recoveredCount = 0;
            for (const tempRecord of list) {
                try {
                    const sourceRecord = tempRecord.record && typeof tempRecord.record === 'object'
                        ? tempRecord.record
                        : tempRecord;
                    const { tempSavedAt, needsRecovery, kind, ...cleanRecord } = sourceRecord;
                    const sanitized = this.sanitizeRecoveredRecord(cleanRecord);
                    if (!sanitized) {
                        console.warn('[PracticeRecorder] 跳过无法修正的临时记录（缺少 examId 或字段无效）', cleanRecord?.id);
                        continue;
                    }

                    // 尝试正常保存
                    await this.savePracticeRecord(sanitized);
                    await window.AppData.recovery.discardDraft(tempRecord.id);
                    recoveredCount++;

                    console.log(`[PracticeRecorder] 恢复记录成功: ${sanitized.id}`);

                } catch (error) {
                    console.error(`[PracticeRecorder] 恢复记录失败: ${tempRecord.id}`, error);
                }
            }
            console.log(`[PracticeRecorder] 已恢复 ${recoveredCount} 条临时记录`);

        } catch (error) {
            console.error('[PracticeRecorder] 恢复临时记录时出错', error);
        }
    }

    sanitizeRecoveredRecord(record) {
        if (!record || typeof record !== 'object') return null;
        const clone = Object.assign({}, record);
        const inferredExamId = this.inferExamId(clone);
        if (!inferredExamId) return null;
        clone.examId = inferredExamId;
        clone.metadata = Object.assign({}, clone.metadata || {}, { examId: inferredExamId });

        const numericFields = ['score', 'totalQuestions', 'correctAnswers', 'accuracy', 'duration'];
        numericFields.forEach((field) => {
            if (clone[field] !== undefined && clone[field] !== null) {
                const num = Number(clone[field]);
                if (Number.isFinite(num)) {
                    clone[field] = num;
                } else {
                    delete clone[field];
                }
            }
        });
        if (clone.accuracy > 1 && clone.accuracy <= 100) {
            clone.accuracy = clone.accuracy / 100;
        }
        return clone;
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
            const records = await this.getPracticeRecords();
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
            const tempRecords = await window.AppData.recovery.listDrafts();
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
                const storageInfo = window.AppData.status();
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
// The practice bundle is loaded on demand and may arrive after the bootstrap
// fallback's bounded polling window. Upgrade immediately when the real class
// becomes available so suite submissions never remain on the light recorder.
if (window.app && typeof window.app.instantiatePracticeRecorder === 'function') {
    window.app.instantiatePracticeRecorder();
}
