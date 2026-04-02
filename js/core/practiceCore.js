(function initPracticeCore(global) {
    'use strict';

    if (global.PracticeCore && global.PracticeCore.__stable === true) {
        return;
    }

    const MESSAGE_TYPE_ALIASES = Object.freeze({
        practice_complete: 'PRACTICE_COMPLETE',
        practice_completed: 'PRACTICE_COMPLETE',
        PracticeComplete: 'PRACTICE_COMPLETE',
        SESSION_COMPLETE: 'PRACTICE_COMPLETE',
        session_complete: 'PRACTICE_COMPLETE',
        session_completed: 'PRACTICE_COMPLETE',
        EXAM_FINISHED: 'PRACTICE_COMPLETE',
        QUIZ_COMPLETE: 'PRACTICE_COMPLETE',
        QUIZ_COMPLETED: 'PRACTICE_COMPLETE',
        TEST_COMPLETE: 'PRACTICE_COMPLETE',
        LESSON_COMPLETE: 'PRACTICE_COMPLETE',
        WORKOUT_COMPLETE: 'PRACTICE_COMPLETE',
        SESSION_READY: 'SESSION_READY',
        session_ready: 'SESSION_READY',
        EXAM_COMPLETED: 'exam_completed',
        EXAM_PROGRESS: 'exam_progress',
        EXAM_ERROR: 'exam_error',
        progress_update: 'PROGRESS_UPDATE',
        SESSION_PROGRESS: 'PROGRESS_UPDATE',
        session_progress: 'PROGRESS_UPDATE',
        practice_progress: 'PROGRESS_UPDATE',
        SESSION_ERROR: 'ERROR_OCCURRED',
        session_error: 'ERROR_OCCURRED',
        practice_error: 'ERROR_OCCURRED',
        REQUEST_INIT: 'REQUEST_INIT',
        request_init: 'REQUEST_INIT',
        REQUEST_SESSION_INIT: 'REQUEST_INIT',
        INIT_SESSION: 'INIT_SESSION',
        init_session: 'INIT_SESSION'
    });

    const PRACTICE_COMPLETE_TYPES = new Set([
        'PRACTICE_COMPLETE',
        'PRACTICE_COMPLETED',
        'SESSION_COMPLETE',
        'SESSION_COMPLETED',
        'EXAM_FINISHED',
        'QUIZ_COMPLETE',
        'QUIZ_COMPLETED',
        'TEST_COMPLETE',
        'LESSON_COMPLETE',
        'WORKOUT_COMPLETE'
    ]);

    const STORAGE_KEYS = Object.freeze({
        practiceRecords: 'practice_records',
        userStats: 'user_stats',
        activeSessions: 'active_sessions',
        tempPracticeRecords: 'temp_practice_records'
    });

    function isPlainObject(value) {
        return value && typeof value === 'object' && !Array.isArray(value);
    }

    function safeParseJson(value) {
        if (typeof value !== 'string') {
            return null;
        }
        try {
            return JSON.parse(value);
        } catch (_) {
            return null;
        }
    }

    function clonePlainObject(value) {
        if (value == null || typeof value !== 'object') {
            return value ?? null;
        }
        if (Array.isArray(value)) {
            return value.map((item) => clonePlainObject(item)).filter((item) => item !== undefined);
        }
        const clone = {};
        Object.keys(value).forEach((key) => {
            clone[key] = clonePlainObject(value[key]);
        });
        return clone;
    }

    function ensureNumber(value, fallback = 0) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : fallback;
    }

    function normalizePracticeType(rawType) {
        if (!rawType) return null;
        const normalized = String(rawType).toLowerCase();
        if (normalized.includes('listen')) return 'listening';
        if (normalized.includes('read')) return 'reading';
        return null;
    }

    function resolveRecordDate(recordData = {}, now = new Date().toISOString()) {
        const candidates = [
            recordData.metadata && recordData.metadata.date,
            recordData.date,
            recordData.endTime,
            recordData.completedAt,
            recordData.startTime,
            recordData.timestamp,
            now
        ];

        for (let i = 0; i < candidates.length; i += 1) {
            const candidate = candidates[i];
            if (!candidate) continue;
            const parsed = new Date(candidate);
            if (!Number.isNaN(parsed.getTime())) {
                return parsed.toISOString();
            }
        }

        return now;
    }

    function inferExamId(recordData = {}) {
        if (!recordData || typeof recordData !== 'object') {
            return null;
        }

        if (recordData.examId) {
            return recordData.examId;
        }
        if (recordData.metadata && recordData.metadata.examId) {
            return recordData.metadata.examId;
        }
        if (Array.isArray(recordData.suiteEntries)) {
            const suiteExam = recordData.suiteEntries.find((entry) => entry && entry.examId);
            if (suiteExam) {
                return suiteExam.examId;
            }
        }
        if (typeof recordData.id === 'string') {
            const match = recordData.id.match(/^record_([^_]+)_/);
            if (match && match[1]) {
                return match[1];
            }
        }

        return null;
    }

    function normalizeAnswerValue(value) {
        const sanitizer = global.AnswerSanitizer;
        if (sanitizer && typeof sanitizer.normalizeValue === 'function') {
            return sanitizer.normalizeValue(value);
        }

        if (value === undefined || value === null) {
            return '';
        }
        if (typeof value === 'string') {
            const trimmed = value.trim();
            return /^\[object\s/i.test(trimmed) ? '' : trimmed;
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value).trim();
        }
        if (Array.isArray(value)) {
            return value.map((item) => normalizeAnswerValue(item)).filter(Boolean).join(',');
        }
        if (typeof value === 'object') {
            const preferKeys = ['value', 'label', 'text', 'answer', 'content', 'userAnswer', 'correctAnswer'];
            for (let i = 0; i < preferKeys.length; i += 1) {
                const entry = value[preferKeys[i]];
                if (typeof entry === 'string') {
                    const trimmed = entry.trim();
                    if (trimmed && !/^\[object\s/i.test(trimmed)) {
                        return trimmed;
                    }
                }
            }
            if (typeof value.innerText === 'string') {
                const text = value.innerText.trim();
                if (text && !/^\[object\s/i.test(text)) {
                    return text;
                }
            }
            if (typeof value.textContent === 'string') {
                const text = value.textContent.trim();
                if (text && !/^\[object\s/i.test(text)) {
                    return text;
                }
            }
            return '';
        }

        return String(value).trim();
    }

    function isNoiseKey(key) {
        if (!key) return true;

        const keyStr = String(key).toLowerCase();
        const noiseKeys = [
            'playback-speed', 'playbackspeed', 'volume-slider', 'volumeslider',
            'audio-volume', 'audiocurrenttime', 'audio-duration', 'audioduration',
            'settings', 'lastfocuselement', 'sessionid', 'examid',
            'nextexamid', 'previousexamid', 'folder', 'source', 'result',
            'metadata', 'practicesettings', 'config', 'state'
        ];
        if (noiseKeys.includes(keyStr)) {
            return true;
        }

        const noisePatterns = [
            /playback/i, /volume/i, /slider/i, /speed/i,
            /audio/i, /duration/i, /config/i, /setting/i
        ];
        for (let i = 0; i < noisePatterns.length; i += 1) {
            if (noisePatterns[i].test(keyStr)) {
                return true;
            }
        }

        const questionMatch = keyStr.match(/q?(\d+)/);
        if (questionMatch) {
            const number = parseInt(questionMatch[1], 10);
            if (number < 1 || number > 200) {
                return true;
            }
        }

        return false;
    }

    function normalizeQuestionKey(rawKey, index) {
        if (rawKey == null || rawKey === '') {
            return `q${index + 1}`;
        }
        const key = String(rawKey).trim();
        return key.startsWith('q') ? key : `q${key}`;
    }

    function normalizeAnswerMap(rawAnswers = {}) {
        const map = {};

        if (Array.isArray(rawAnswers)) {
            rawAnswers.forEach((entry, index) => {
                if (!entry) return;
                const key = normalizeQuestionKey(entry.questionId, index);
                const rawValue = entry.answer ?? entry.userAnswer ?? entry.value ?? entry;
                map[key] = normalizeAnswerValue(rawValue);
            });
            return map;
        }

        if (!rawAnswers || typeof rawAnswers !== 'object') {
            return map;
        }

        Object.entries(rawAnswers).forEach(([rawKey, rawValue], index) => {
            if (isNoiseKey(rawKey)) {
                return;
            }
            const key = normalizeQuestionKey(rawKey, index);
            const resolvedValue = rawValue && typeof rawValue === 'object' && 'answer' in rawValue
                ? rawValue.answer
                : rawValue;
            map[key] = normalizeAnswerValue(resolvedValue);
        });

        return map;
    }

    function normalizeAnswerComparison(comparison) {
        if (!comparison || typeof comparison !== 'object') {
            return {};
        }

        const sanitizer = global.AnswerSanitizer;
        if (sanitizer && typeof sanitizer.sanitizeComparisonMap === 'function') {
            return sanitizer.sanitizeComparisonMap(comparison);
        }

        const normalized = {};
        Object.entries(comparison).forEach(([questionId, entry]) => {
            if (isNoiseKey(questionId) || !entry || typeof entry !== 'object') {
                return;
            }
            const userAnswer = normalizeAnswerValue(entry.userAnswer ?? entry.user ?? entry.answer);
            const correctAnswer = normalizeAnswerValue(entry.correctAnswer ?? entry.correct);
            if (!userAnswer && !correctAnswer) {
                return;
            }
            normalized[questionId] = {
                questionId: entry.questionId || questionId,
                userAnswer,
                correctAnswer,
                isCorrect: typeof entry.isCorrect === 'boolean' ? entry.isCorrect : null
            };
        });

        return normalized;
    }

    function convertComparisonToMap(comparison, key = 'correctAnswer') {
        if (!comparison || typeof comparison !== 'object') {
            return {};
        }
        const map = {};
        Object.entries(comparison).forEach(([questionId, entry]) => {
            if (!entry || typeof entry !== 'object') return;
            const value = entry[key] ?? (key === 'correctAnswer' ? entry.correct : entry.userAnswer ?? entry.user);
            if (value != null && String(value).trim() !== '') {
                map[questionId] = value;
            }
        });
        return map;
    }

    function convertComparisonToDetails(comparison) {
        if (!comparison || typeof comparison !== 'object') {
            return null;
        }
        const details = {};
        Object.entries(comparison).forEach(([questionId, entry]) => {
            if (!entry || typeof entry !== 'object') return;
            details[questionId] = {
                userAnswer: normalizeAnswerValue(entry.userAnswer ?? entry.user ?? entry.answer),
                correctAnswer: normalizeAnswerValue(entry.correctAnswer ?? entry.correct),
                isCorrect: typeof entry.isCorrect === 'boolean' ? entry.isCorrect : null
            };
        });
        return details;
    }

    function buildAnswerDetails(answerMap = {}, correctMap = {}) {
        const details = {};
        const keys = new Set([
            ...Object.keys(answerMap || {}),
            ...Object.keys(correctMap || {})
        ]);

        keys.forEach((questionId) => {
            const userAnswer = normalizeAnswerValue(answerMap[questionId]);
            const correctAnswer = normalizeAnswerValue(correctMap[questionId]);
            let isCorrect = null;
            if (correctAnswer) {
                isCorrect = userAnswer.toLowerCase() === correctAnswer.toLowerCase();
            }
            details[questionId] = {
                userAnswer: userAnswer || '-',
                correctAnswer: correctAnswer || '-',
                isCorrect
            };
        });

        return details;
    }

    function deriveCorrectMapFromDetails(details) {
        if (!details || typeof details !== 'object') {
            return {};
        }
        const map = {};
        Object.entries(details).forEach(([questionId, info]) => {
            if (!info) return;
            const correctAnswer = info.correctAnswer || info.answer || info.value;
            if (correctAnswer != null) {
                map[questionId] = normalizeAnswerValue(correctAnswer);
            }
        });
        return map;
    }

    function buildAnswerArray(answers, correctMap = {}) {
        if (Array.isArray(answers)) {
            return answers.map((answer, index) => ({
                questionId: answer.questionId || `q${index + 1}`,
                answer: normalizeAnswerValue(answer.answer),
                correctAnswer: normalizeAnswerValue(answer.correctAnswer ?? correctMap[answer.questionId || `q${index + 1}`]),
                correct: Boolean(answer.correct),
                timeSpent: ensureNumber(answer.timeSpent, 0),
                questionType: answer.questionType || 'unknown',
                timestamp: answer.timestamp || new Date().toISOString()
            }));
        }

        const answerMap = normalizeAnswerMap(answers);
        const keys = new Set([
            ...Object.keys(answerMap),
            ...Object.keys(correctMap || {})
        ]);

        const list = [];
        keys.forEach((questionId, index) => {
            const userAnswer = normalizeAnswerValue(answerMap[questionId]);
            const normalizedCorrect = normalizeAnswerValue(correctMap[questionId]);
            const isCorrect = normalizedCorrect
                ? userAnswer.toLowerCase() === normalizedCorrect.toLowerCase()
                : false;
            list.push({
                questionId: questionId || `q${index + 1}`,
                answer: userAnswer,
                correctAnswer: normalizedCorrect,
                correct: isCorrect,
                timeSpent: 0,
                questionType: 'unknown',
                timestamp: new Date().toISOString()
            });
        });
        return list;
    }

    function deriveTotalQuestionCount(recordData = {}, fallbackLength = 0) {
        const candidates = [
            recordData.totalQuestions,
            recordData.questionCount,
            recordData.scoreInfo && recordData.scoreInfo.total,
            recordData.scoreInfo && recordData.scoreInfo.totalQuestions,
            recordData.realData && recordData.realData.scoreInfo && recordData.realData.scoreInfo.totalQuestions,
            recordData.realData && recordData.realData.scoreInfo && recordData.realData.scoreInfo.total
        ];
        for (let i = 0; i < candidates.length; i += 1) {
            const numeric = Number(candidates[i]);
            if (Number.isFinite(numeric) && numeric >= 0) {
                return numeric;
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
            recordData.scoreInfo && recordData.scoreInfo.details,
            recordData.realData && recordData.realData.scoreInfo && recordData.realData.scoreInfo.details
        ];
        for (let i = 0; i < detailSources.length; i += 1) {
            const details = detailSources[i];
            if (details && typeof details === 'object') {
                return Object.keys(details).length;
            }
        }

        return fallbackLength || 0;
    }

    function deriveCorrectAnswerCount(recordData = {}, answers = []) {
        const numericCandidates = [
            recordData.correctAnswers,
            recordData.correct,
            recordData.score,
            recordData.scoreInfo && recordData.scoreInfo.correct,
            recordData.scoreInfo && recordData.scoreInfo.score,
            recordData.realData && recordData.realData.scoreInfo && recordData.realData.scoreInfo.correct,
            recordData.realData && recordData.realData.scoreInfo && recordData.realData.scoreInfo.score
        ];
        for (let i = 0; i < numericCandidates.length; i += 1) {
            const numeric = Number(numericCandidates[i]);
            if (Number.isFinite(numeric) && numeric >= 0) {
                return numeric;
            }
        }

        if (Array.isArray(answers) && answers.length > 0) {
            return answers.reduce((sum, answer) => {
                if (!answer || typeof answer !== 'object') {
                    return sum;
                }
                return (answer.correct === true || answer.isCorrect === true) ? sum + 1 : sum;
            }, 0);
        }

        const detailSources = [
            recordData.answerDetails,
            recordData.scoreInfo && recordData.scoreInfo.details,
            recordData.realData && recordData.realData.scoreInfo && recordData.realData.scoreInfo.details
        ];
        for (let i = 0; i < detailSources.length; i += 1) {
            const details = detailSources[i];
            if (!details || typeof details !== 'object') {
                continue;
            }
            let hasFlag = false;
            let correctCount = 0;
            Object.values(details).forEach((detail) => {
                if (!detail || typeof detail !== 'object') {
                    return;
                }
                if (detail.isCorrect === true || detail.correct === true) {
                    correctCount += 1;
                }
                hasFlag = hasFlag || typeof detail.isCorrect === 'boolean' || typeof detail.correct === 'boolean';
            });
            if (hasFlag) {
                return correctCount;
            }
        }

        return 0;
    }

    function buildMetadata(recordData = {}, type) {
        const metadata = Object.assign({}, recordData.metadata || {});
        const examId = recordData.examId;
        const fallbackTitle = recordData.title || recordData.examTitle || examId || 'Unknown Exam';
        const fallbackCategory = recordData.category || metadata.category || 'Unknown';
        const fallbackFrequency = recordData.frequency || metadata.frequency || 'unknown';

        metadata.examTitle = metadata.examTitle || metadata.title || fallbackTitle;
        metadata.category = metadata.category || fallbackCategory;
        metadata.frequency = metadata.frequency || fallbackFrequency;
        metadata.type = type;
        metadata.examType = metadata.examType || type;
        if (recordData.suiteSessionId && !metadata.suiteSessionId) {
            metadata.suiteSessionId = recordData.suiteSessionId;
        }
        if (recordData.practiceMode && !metadata.practiceMode) {
            metadata.practiceMode = recordData.practiceMode;
        }
        return metadata;
    }

    function inferPracticeType(recordData = {}) {
        const metadata = recordData.metadata || {};
        const normalized = normalizePracticeType(
            recordData.type
            || metadata.type
            || metadata.examType
            || (recordData.examId && String(recordData.examId).toLowerCase().includes('listening') ? 'listening' : null)
        );
        return normalized || 'reading';
    }

    function standardizeSuiteEntries(entries) {
        if (!Array.isArray(entries)) {
            return [];
        }
        return entries.map((entry, index) => {
            if (!entry || typeof entry !== 'object') {
                return null;
            }
            const normalizedAnswers = buildAnswerArray(entry.answers || entry.answerList || [], entry.correctAnswerMap || {});
            const answerMap = normalizedAnswers.reduce((map, item) => {
                if (item && item.questionId) {
                    map[item.questionId] = item.answer || '';
                }
                return map;
            }, {});
            const answerComparisonSource = entry.answerComparison
                || (entry.scoreInfo && entry.scoreInfo.details)
                || (entry.rawData && entry.rawData.answerComparison)
                || null;
            return {
                examId: entry.examId || null,
                title: entry.title || entry.examTitle || `套题第${index + 1}篇`,
                category: entry.category || (entry.metadata && entry.metadata.category) || '套题',
                duration: ensureNumber(entry.duration, 0),
                scoreInfo: entry.scoreInfo ? clonePlainObject(entry.scoreInfo) : null,
                answers: answerMap,
                answerComparison: clonePlainObject(answerComparisonSource) || null,
                metadata: entry.metadata ? Object.assign({}, entry.metadata) : {},
                rawData: entry.rawData ? clonePlainObject(entry.rawData) : null
            };
        }).filter(Boolean);
    }

    function mergeAnswerSources() {
        const merged = {};
        Array.prototype.slice.call(arguments).forEach((source) => {
            if (!source) {
                return;
            }
            const normalized = normalizeAnswerMap(source);
            Object.entries(normalized).forEach(([key, value]) => {
                if (value == null) {
                    return;
                }
                const trimmed = String(value).trim();
                if (!trimmed) {
                    return;
                }
                merged[key] = trimmed;
            });
        });
        return merged;
    }

    function defaultGenerateRecordId() {
        return `record_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function standardizeRecord(recordData, options = {}) {
        const now = new Date().toISOString();
        const type = inferPracticeType(recordData);
        const recordDate = resolveRecordDate(recordData, now);
        const resolvedExamId = inferExamId(recordData);
        const metadata = buildMetadata(
            Object.assign({}, recordData, { examId: resolvedExamId }),
            type
        );
        const comparisonSource = recordData.answerComparison
            || (recordData.realData && recordData.realData.answerComparison)
            || null;
        const normalizedAnswers = buildAnswerArray(recordData.answers || recordData.answerList || [], recordData.correctAnswerMap || {});
        let answerMap = normalizedAnswers.reduce((map, item) => {
            if (item && item.questionId) {
                map[item.questionId] = item.answer || '';
            }
            return map;
        }, {});
        if ((!answerMap || Object.keys(answerMap).length === 0) && comparisonSource) {
            answerMap = convertComparisonToMap(comparisonSource, 'userAnswer');
        }

        let normalizedCorrectMap = (
            recordData.correctAnswerMap && typeof recordData.correctAnswerMap === 'object'
        )
            ? normalizeAnswerMap(recordData.correctAnswerMap)
            : ((recordData.realData && recordData.realData.correctAnswers && typeof recordData.realData.correctAnswers === 'object')
                ? normalizeAnswerMap(recordData.realData.correctAnswers)
                : {});

        if ((!normalizedCorrectMap || Object.keys(normalizedCorrectMap).length === 0) && comparisonSource) {
            normalizedCorrectMap = convertComparisonToMap(comparisonSource, 'correctAnswer');
        }

        const derivedTotalQuestions = deriveTotalQuestionCount(recordData, normalizedAnswers.length);
        const derivedCorrectAnswers = deriveCorrectAnswerCount(recordData, normalizedAnswers);
        const totalQuestions = ensureNumber(recordData.totalQuestions, derivedTotalQuestions);
        const correctAnswers = ensureNumber(recordData.correctAnswers, derivedCorrectAnswers);
        let accuracy = ensureNumber(recordData.accuracy, totalQuestions > 0 ? correctAnswers / totalQuestions : 0);
        if (accuracy > 1 && accuracy <= 100) {
            accuracy = accuracy / 100;
        }
        if (!Number.isFinite(accuracy) || accuracy < 0) {
            accuracy = 0;
        } else if (accuracy > 1) {
            accuracy = 1;
        }

        const detailSource = recordData.answerDetails
            || (recordData.scoreInfo && recordData.scoreInfo.details)
            || (recordData.realData && recordData.realData.scoreInfo && recordData.realData.scoreInfo.details)
            || (comparisonSource ? convertComparisonToDetails(comparisonSource) : null)
            || buildAnswerDetails(answerMap, normalizedCorrectMap);

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
        const normalizedSuiteEntries = standardizeSuiteEntries(recordData.suiteEntries || []);
        const normalizedComparison = comparisonSource && typeof comparisonSource === 'object'
            ? clonePlainObject(comparisonSource)
            : null;
        const generateRecordId = typeof options.generateRecordId === 'function'
            ? options.generateRecordId
            : defaultGenerateRecordId;

        return {
            id: recordData.id || generateRecordId(),
            examId: resolvedExamId,
            sessionId: recordData.sessionId || null,
            title: resolvedTitle,
            type,
            startTime,
            endTime,
            duration: ensureNumber(recordData.duration, 0),
            date: recordDate,
            status: recordData.status || 'completed',
            score: ensureNumber(recordData.score, correctAnswers),
            totalQuestions,
            correctAnswers,
            accuracy,
            answers: normalizedAnswers,
            answerDetails: detailSource || null,
            correctAnswerMap: normalizedCorrectMap || {},
            questionTypePerformance: recordData.questionTypePerformance || {},
            metadata,
            frequency: recordData.frequency || metadata.frequency || null,
            suiteMode: Boolean(recordData.suiteMode || ((recordData.frequency || metadata.frequency || '').toLowerCase() === 'suite')),
            suiteSessionId: recordData.suiteSessionId || (metadata && metadata.suiteSessionId) || null,
            suiteEntries: normalizedSuiteEntries,
            scoreInfo: recordData.scoreInfo
                ? Object.assign({}, recordData.scoreInfo, {
                    details: recordData.scoreInfo.details || detailSource || null
                })
                : (detailSource ? { details: detailSource } : null),
            realData: recordData.realData
                ? Object.assign({}, recordData.realData, {
                    answers: (recordData.realData && recordData.realData.answers) || answerMap,
                    correctAnswers: (recordData.realData && recordData.realData.correctAnswers) || normalizedCorrectMap,
                    scoreInfo: Object.assign({}, (recordData.realData && recordData.realData.scoreInfo) || {}, {
                        details: (recordData.realData && recordData.realData.scoreInfo && recordData.realData.scoreInfo.details) || detailSource || null
                    }),
                    answerComparison: (recordData.realData && recordData.realData.answerComparison)
                        ? clonePlainObject(recordData.realData.answerComparison)
                        : (normalizedComparison || null)
                })
                : (normalizedComparison ? { answerComparison: normalizedComparison } : null),
            answerComparison: normalizedComparison,
            version: options.currentVersion || recordData.version || '1.0.0',
            createdAt: recordData.createdAt || now,
            updatedAt: now
        };
    }

    function extractEnvelopeData(envelope) {
        const candidates = [envelope.data, envelope.payload, envelope.detail];
        for (let i = 0; i < candidates.length; i += 1) {
            const candidate = candidates[i];
            if (isPlainObject(candidate)) return candidate;
            if (typeof candidate === 'string') {
                const parsed = safeParseJson(candidate);
                if (isPlainObject(parsed)) return parsed;
            }
        }
        if (Array.isArray(envelope.args)) {
            for (let i = 0; i < envelope.args.length; i += 1) {
                const candidate = envelope.args[i];
                if (isPlainObject(candidate)) return candidate;
            }
        }
        const fallback = {};
        const baseKeys = new Set(['type', 'messageType', 'action', 'event', 'data', 'payload', 'detail', 'args', 'source', 'message', 'messageData']);
        let hasFallback = false;
        Object.keys(envelope || {}).forEach((key) => {
            if (!baseKeys.has(key)) {
                fallback[key] = envelope[key];
                hasFallback = true;
            }
        });
        return hasFallback ? fallback : {};
    }

    function normalizeMessageType(value) {
        if (typeof value !== 'string') {
            return '';
        }
        const normalized = value.trim();
        if (!normalized) {
            return '';
        }
        return MESSAGE_TYPE_ALIASES[normalized] || normalized.toUpperCase();
    }

    function normalizeMessage(rawEnvelope, depth = 0) {
        if (depth > 2) {
            return null;
        }

        let envelope = rawEnvelope;
        if (typeof envelope === 'string') {
            envelope = safeParseJson(envelope);
        }
        if (!isPlainObject(envelope)) {
            return null;
        }

        const rawType = envelope.type || envelope.messageType || envelope.action || envelope.event || '';
        const type = normalizeMessageType(rawType);

        if (!type) {
            const nested = envelope.message || envelope.messageData;
            if (nested) {
                return normalizeMessage(nested, depth + 1);
            }
            return null;
        }

        const data = extractEnvelopeData(envelope);
        const sourceTag = typeof envelope.source === 'string'
            ? envelope.source
            : (typeof data.source === 'string' ? data.source : '');

        return { type, data: isPlainObject(data) ? data : {}, sourceTag, rawType: rawType || type };
    }

    function isPracticeCompleteType(type) {
        if (!type) {
            return false;
        }
        return PRACTICE_COMPLETE_TYPES.has(type) || normalizeMessageType(type) === 'PRACTICE_COMPLETE';
    }

    function buildEnvelope(type, data) {
        return {
            type,
            data: isPlainObject(data) ? data : {}
        };
    }

    function deriveCategory(recordPayload = {}, examEntry = null, metadata = {}) {
        if (metadata.category) {
            return metadata.category;
        }
        if (recordPayload.category) {
            return recordPayload.category;
        }
        if (examEntry && examEntry.category) {
            return examEntry.category;
        }
        if (recordPayload.pageType) {
            return recordPayload.pageType;
        }
        if (recordPayload.url) {
            const match = String(recordPayload.url).match(/\b(P[1-4])\b/i);
            if (match) return match[1].toUpperCase();
        }
        if (recordPayload.title) {
            const match = String(recordPayload.title).match(/\b(P[1-4])\b/i);
            if (match) return match[1].toUpperCase();
        }
        return 'Unknown';
    }

    function deriveFrequency(recordPayload = {}, examEntry = null, metadata = {}) {
        return recordPayload.frequency
            || metadata.frequency
            || (examEntry && examEntry.frequency)
            || 'unknown';
    }

    function fromCompletion(payload, sessionContext = {}, examEntry = null, options = {}) {
        const normalizedMessage = normalizeMessage(payload);
        const rawPayload = normalizedMessage && isPracticeCompleteType(normalizedMessage.type)
            ? normalizedMessage.data
            : (isPlainObject(payload) ? payload : {});

        if (!rawPayload || typeof rawPayload !== 'object') {
            return null;
        }

        const scoreInfo = Object.assign({}, rawPayload.scoreInfo || {});
        const metadata = Object.assign({}, sessionContext.metadata || {}, rawPayload.metadata || {});
        const resolvedExamId = rawPayload.examId
            || sessionContext.examId
            || metadata.examId
            || (examEntry && examEntry.id)
            || null;
        const answerComparison = normalizeAnswerComparison(
            rawPayload.answerComparison || (rawPayload.realData && rawPayload.realData.answerComparison) || null
        );
        const answerMap = mergeAnswerSources(
            rawPayload.answerMap,
            rawPayload.answers,
            rawPayload.realData && rawPayload.realData.answers,
            sessionContext.answers,
            convertComparisonToMap(answerComparison, 'userAnswer')
        );
        const correctAnswerMap = mergeAnswerSources(
            rawPayload.correctAnswerMap,
            rawPayload.correctAnswers,
            rawPayload.realData && rawPayload.realData.correctAnswers,
            sessionContext.correctAnswerMap,
            deriveCorrectMapFromDetails(scoreInfo.details),
            deriveCorrectMapFromDetails(rawPayload.realData && rawPayload.realData.scoreInfo && rawPayload.realData.scoreInfo.details),
            convertComparisonToMap(answerComparison, 'correctAnswer')
        );
        const answerDetails = rawPayload.answerDetails
            || scoreInfo.details
            || (rawPayload.realData && rawPayload.realData.scoreInfo && rawPayload.realData.scoreInfo.details)
            || buildAnswerDetails(answerMap, correctAnswerMap);
        const answerList = buildAnswerArray(answerMap, correctAnswerMap);
        const totalQuestions = ensureNumber(
            rawPayload.totalQuestions ?? scoreInfo.total ?? scoreInfo.totalQuestions,
            Object.keys(correctAnswerMap).length || Object.keys(answerMap).length
        );
        const correctAnswers = ensureNumber(
            rawPayload.correctAnswers ?? rawPayload.correctAnswersCount ?? scoreInfo.correct ?? scoreInfo.score ?? rawPayload.score,
            deriveCorrectAnswerCount({ answerDetails, scoreInfo }, answerList)
        );
        let accuracy = typeof rawPayload.accuracy === 'number'
            ? rawPayload.accuracy
            : (typeof scoreInfo.accuracy === 'number'
                ? scoreInfo.accuracy
                : (totalQuestions > 0 ? correctAnswers / totalQuestions : 0));
        if (accuracy > 1 && accuracy <= 100) {
            accuracy = accuracy / 100;
        }
        const percentage = typeof scoreInfo.percentage === 'number'
            ? scoreInfo.percentage
            : Math.round(accuracy * 100);
        const completedAt = resolveRecordDate({
            metadata,
            date: rawPayload.date,
            endTime: rawPayload.endTime,
            completedAt: rawPayload.completedAt,
            startTime: rawPayload.startTime,
            timestamp: rawPayload.timestamp
        });
        const duration = ensureNumber(
            rawPayload.duration,
            (rawPayload.endTime && rawPayload.startTime)
                ? Math.round((new Date(rawPayload.endTime) - new Date(rawPayload.startTime)) / 1000)
                : ensureNumber(sessionContext.duration, 0)
        );
        const startTime = rawPayload.startTime
            ? new Date(rawPayload.startTime).toISOString()
            : (sessionContext.startTime
                ? new Date(sessionContext.startTime).toISOString()
                : new Date(new Date(completedAt).getTime() - duration * 1000).toISOString());
        const endTime = rawPayload.endTime
            ? new Date(rawPayload.endTime).toISOString()
            : completedAt;
        const category = deriveCategory(rawPayload, examEntry, metadata);
        const frequency = deriveFrequency(rawPayload, examEntry, metadata);
        const title = rawPayload.title
            || metadata.examTitle
            || metadata.title
            || (examEntry && examEntry.title)
            || resolvedExamId
            || '未命名练习';
        const suiteEntries = rawPayload.suiteEntries || metadata.suiteEntries || [];
        const suiteSessionId = rawPayload.suiteSessionId || metadata.suiteSessionId || sessionContext.suiteSessionId || null;

        return standardizeRecord({
            id: rawPayload.id,
            examId: resolvedExamId,
            sessionId: rawPayload.sessionId || sessionContext.sessionId || null,
            title,
            type: rawPayload.type || metadata.type || metadata.examType || (examEntry && examEntry.type) || sessionContext.type || null,
            startTime,
            endTime,
            duration,
            date: completedAt,
            status: rawPayload.status || 'completed',
            score: ensureNumber(rawPayload.score ?? scoreInfo.score, correctAnswers),
            totalQuestions,
            correctAnswers,
            accuracy,
            answers: answerList,
            answerDetails,
            correctAnswerMap,
            answerComparison,
            questionTypePerformance: rawPayload.questionTypePerformance || {},
            metadata: Object.assign({}, metadata, {
                examId: resolvedExamId,
                examTitle: title,
                category,
                frequency
            }),
            frequency,
            suiteMode: Boolean(rawPayload.suiteMode || (String(rawPayload.practiceMode || metadata.practiceMode || '').toLowerCase() === 'suite')),
            suiteSessionId,
            suiteEntries,
            scoreInfo: Object.assign({}, scoreInfo, {
                correct: correctAnswers,
                total: totalQuestions,
                accuracy,
                percentage,
                details: scoreInfo.details || answerDetails,
                source: scoreInfo.source || rawPayload.pageType || rawPayload.source || 'practice_page'
            }),
            realData: Object.assign({}, rawPayload.realData || {}, {
                answers: answerMap,
                correctAnswers: correctAnswerMap,
                answerComparison,
                scoreInfo: Object.assign({}, (rawPayload.realData && rawPayload.realData.scoreInfo) || scoreInfo, {
                    correct: correctAnswers,
                    total: totalQuestions,
                    accuracy,
                    percentage,
                    details: answerDetails,
                    source: scoreInfo.source || rawPayload.pageType || rawPayload.source || 'practice_page'
                }),
                interactions: rawPayload.interactions || [],
                isRealData: true,
                source: scoreInfo.source || rawPayload.pageType || rawPayload.source || 'practice_page',
                sessionId: rawPayload.sessionId || sessionContext.sessionId || null
            })
        }, options);
    }

    function getRepositories() {
        return global.dataRepositories || null;
    }

    function getStorageManager(storageManager) {
        return storageManager || global.storage || null;
    }

    function syncPracticeRecordState(records) {
        const syncAppState = (nextRecords) => {
            try {
                if (global.app && global.app.state && global.app.state.practice) {
                    global.app.state.practice.records = Array.isArray(nextRecords) ? nextRecords.slice() : [];
                }
            } catch (_) {}
        };

        if (typeof global.setPracticeRecordsState === 'function') {
            try {
                const finalRecords = global.setPracticeRecordsState(records);
                syncAppState(finalRecords);
                try {
                    global.practiceRecords = Array.isArray(finalRecords) ? finalRecords.slice() : [];
                } catch (_) {}
                return;
            } catch (error) {
                console.warn('[PracticeCore] 同步 practice records 状态失败:', error);
            }
        }
        syncAppState(records);
        try {
            global.practiceRecords = Array.isArray(records) ? records.slice() : [];
        } catch (_) {}
    }

    async function readPracticeRecords(storageManager) {
        const repos = getRepositories();
        if (repos && repos.practice && typeof repos.practice.list === 'function') {
            return await repos.practice.list();
        }
        const storage = getStorageManager(storageManager);
        if (storage && typeof storage.get === 'function') {
            return await storage.get(STORAGE_KEYS.practiceRecords, [], { skipPracticeCoreRedirect: true });
        }
        return [];
    }

    async function writePracticeRecords(records, storageManager) {
        const finalRecords = Array.isArray(records) ? records : [];
        const repos = getRepositories();
        if (repos && repos.practice && typeof repos.practice.overwrite === 'function') {
            await repos.practice.overwrite(finalRecords);
            syncPracticeRecordState(finalRecords);
            return true;
        }
        const storage = getStorageManager(storageManager);
        if (storage && typeof storage.writePersistentValue === 'function') {
            const result = await storage.writePersistentValue(STORAGE_KEYS.practiceRecords, finalRecords);
            syncPracticeRecordState(finalRecords);
            return result;
        }
        return false;
    }

    async function writeMeta(key, value, storageManager) {
        const repos = getRepositories();
        if (repos && repos.meta && typeof repos.meta.set === 'function') {
            await repos.meta.set(key, value);
            return true;
        }
        const storage = getStorageManager(storageManager);
        if (storage && typeof storage.writePersistentValue === 'function') {
            return await storage.writePersistentValue(key, value);
        }
        return false;
    }

    async function removeMeta(key, storageManager) {
        const repos = getRepositories();
        if (repos && repos.meta && typeof repos.meta.remove === 'function') {
            await repos.meta.remove(key);
            return true;
        }
        const storage = getStorageManager(storageManager);
        if (storage && typeof storage.removePersistentValue === 'function') {
            return await storage.removePersistentValue(key);
        }
        return false;
    }

    function extractSessionId(record) {
        if (!record || typeof record !== 'object') {
            return null;
        }
        const rawId = record.sessionId
            || (record.realData && record.realData.sessionId)
            || (record.metadata && record.metadata.sessionId)
            || null;
        if (!rawId) return null;
        return String(rawId).trim() || null;
    }

    function dedupePracticeRecords(records) {
        const seenIds = new Set();
        const seenSessions = new Set();
        const deduped = [];

        (Array.isArray(records) ? records : []).forEach((record) => {
            if (!record || typeof record !== 'object') {
                return;
            }
            const recordId = record.id != null ? String(record.id) : null;
            const sessionId = extractSessionId(record);

            if (recordId && seenIds.has(recordId)) {
                return;
            }
            if (sessionId && seenSessions.has(sessionId)) {
                return;
            }

            if (recordId) seenIds.add(recordId);
            if (sessionId) seenSessions.add(sessionId);
            deduped.push(record);
        });

        return deduped;
    }

    function handlesStorageKey(key) {
        return key === STORAGE_KEYS.practiceRecords
            || key === STORAGE_KEYS.userStats
            || key === STORAGE_KEYS.activeSessions
            || key === STORAGE_KEYS.tempPracticeRecords;
    }

    async function replacePracticeRecords(records, options = {}) {
        const canonical = dedupePracticeRecords(
            (Array.isArray(records) ? records : []).map((record) => standardizeRecord(record, options))
        );
        if (Number.isFinite(options.maxRecords) && options.maxRecords > 0 && canonical.length > options.maxRecords) {
            canonical.splice(options.maxRecords);
        }
        return await writePracticeRecords(canonical, options.storageManager);
    }

    async function savePracticeRecord(record, options = {}) {
        const standardizedRecord = standardizeRecord(record, options);
        let records = await readPracticeRecords(options.storageManager);
        records = Array.isArray(records) ? records.slice() : [];

        const existingIndex = records.findIndex((entry) => entry && String(entry.id) === String(standardizedRecord.id));
        if (existingIndex >= 0) {
            records[existingIndex] = standardizedRecord;
        } else {
            records.unshift(standardizedRecord);
        }

        const standardizedSessionId = extractSessionId(standardizedRecord);
        if (standardizedSessionId) {
            records = records.filter((entry, index) => {
                if (index === 0) {
                    return true;
                }
                const sessionId = extractSessionId(entry);
                return !(sessionId && sessionId === standardizedSessionId && String(entry.id) !== String(standardizedRecord.id));
            });
        }

        records = dedupePracticeRecords(records);
        if (Number.isFinite(options.maxRecords) && options.maxRecords > 0 && records.length > options.maxRecords) {
            records.splice(options.maxRecords);
        }
        await writePracticeRecords(records, options.storageManager);
        return standardizedRecord;
    }

    async function routeStorageSet(storageManager, key, value, options = {}) {
        if (key === STORAGE_KEYS.practiceRecords) {
            return await replacePracticeRecords(value, {
                currentVersion: options.currentVersion || '1.0.0',
                maxRecords: options.maxRecords || 1000,
                storageManager
            });
        }
        if (key === STORAGE_KEYS.userStats || key === STORAGE_KEYS.activeSessions || key === STORAGE_KEYS.tempPracticeRecords) {
            return await writeMeta(key, value, storageManager);
        }
        return null;
    }

    async function routeStorageRemove(storageManager, key) {
        if (key === STORAGE_KEYS.practiceRecords) {
            return await writePracticeRecords([], storageManager);
        }
        if (key === STORAGE_KEYS.userStats || key === STORAGE_KEYS.activeSessions || key === STORAGE_KEYS.tempPracticeRecords) {
            return await removeMeta(key, storageManager);
        }
        return null;
    }

    const contracts = Object.freeze({
        ensureNumber,
        normalizePracticeType,
        inferPracticeType,
        resolveRecordDate,
        inferExamId,
        normalizeAnswerValue,
        isNoiseKey,
        normalizeAnswerMap,
        normalizeAnswerComparison,
        mergeAnswerSources,
        buildAnswerArray,
        buildAnswerDetails,
        deriveCorrectMapFromDetails,
        deriveCorrectAnswerCount,
        deriveTotalQuestionCount,
        convertComparisonToMap,
        convertComparisonToDetails,
        buildMetadata,
        standardizeRecord,
        standardizeSuiteEntries,
        clonePlainObject
    });

    const protocol = Object.freeze({
        MESSAGE_TYPE_ALIASES,
        PRACTICE_COMPLETE_TYPES,
        normalizeMessageType,
        normalizeMessage,
        isPracticeCompleteType,
        buildEnvelope
    });

    const ingestor = Object.freeze({
        fromCompletion
    });

    const store = Object.freeze({
        STORAGE_KEYS,
        handlesStorageKey,
        listPracticeRecords: readPracticeRecords,
        replacePracticeRecords,
        savePracticeRecord,
        routeStorageSet,
        routeStorageRemove,
        writeMeta,
        removeMeta,
        syncPracticeRecordState
    });

    global.PracticeCore = {
        __stable: true,
        version: '1.0.0',
        contracts,
        protocol,
        ingestor,
        store
    };
})(typeof window !== 'undefined' ? window : globalThis);
