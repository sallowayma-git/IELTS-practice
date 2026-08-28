(function(global) {
    'use strict';

    const MAX_QUESTION_NUMBER = 200;
    const NOISE_KEYS = new Set([
        'playback-speed',
        'playbackspeed',
        'volume-slider',
        'volumeslider',
        'audio-volume',
        'audiocurrenttime',
        'audio-duration',
        'audioduration',
        'settings',
        'lastfocuselement',
        'sessionid',
        'examid',
        'nextexamid',
        'previousexamid',
        'folder',
        'source',
        'result',
        'metadata',
        'practicesettings'
    ]);
    const NOISE_PATTERNS = [
        /playback/i,
        /volume/i,
        /slider/i,
        /speed/i,
        /audio/i,
        /duration/i,
        /config/i
    ];
    const NO_ANSWER_MARKERS = new Set([
        'no answer',
        '未作答',
        'none',
        'n/a',
        'null',
        'undefined',
        'no-answer'
    ]);
    function getAnswerMatchCore() {
        const core = global.AnswerMatchCore;
        if (!core || typeof core !== 'object') {
            return null;
        }
        return core;
    }

    function getPracticeCoreContracts() {
        const core = global.PracticeCore;
        return core && core.contracts && typeof core.contracts === 'object'
            ? core.contracts
            : null;
    }

    function toStringKey(value) {
        if (value == null) {
            return '';
        }
        return String(value).trim();
    }

    function normalizeKey(rawKey) {
        const original = toStringKey(rawKey);
        if (!original) {
            return { canonicalKey: null, questionNumber: null, originalKey: original };
        }

        const lowered = original.toLowerCase();

        // 处理范围题号（如 q21-22 或 21-22），保留完整键用于展示
        const rangeMatch = lowered.match(/^q?(\d+)\s*-\s*(\d+)$/);
        if (rangeMatch) {
            const start = parseInt(rangeMatch[1], 10);
            const end = parseInt(rangeMatch[2], 10);
            const canonicalKey = `q${start}-${end}`;
            return {
                canonicalKey,
                questionNumber: Number.isFinite(start) ? start : null,
                originalKey: original,
                rangeLabel: `${start}-${end}`
            };
        }

        let preferredDigits = null;
        try {
            const qDigitPattern = /(?:^|[^a-z0-9])q(\d{1,4})/g;
            let match = null;
            while ((match = qDigitPattern.exec(lowered)) !== null) {
                preferredDigits = match[1];
            }
        } catch (_) {
            preferredDigits = null;
        }

        const digitMatch = preferredDigits
            ? [null, preferredDigits]
            : lowered.match(/(\d{1,4})/);
        let questionNumber = null;
        let canonicalKey = lowered;

        if (digitMatch) {
            questionNumber = parseInt(digitMatch[1], 10);
            if (Number.isFinite(questionNumber)) {
                canonicalKey = `q${questionNumber}`;
            } else {
                questionNumber = null;
            }
        } else if (/^q[a-z]+$/.test(lowered)) {
            canonicalKey = lowered;
        } else if (/^[a-z]$/.test(lowered)) {
            canonicalKey = `q${lowered}`;
        } else if (lowered.startsWith('question')) {
            const numeric = lowered.replace(/question/i, '').trim();
            if (numeric) {
                return normalizeKey(numeric);
            }
        }

        return { canonicalKey, questionNumber, originalKey: original };
    }

    function isNoiseKey(canonicalKey, questionNumber) {
        if (!canonicalKey) {
            return true;
        }

        if (NOISE_KEYS.has(canonicalKey)) {
            return true;
        }

        for (const pattern of NOISE_PATTERNS) {
            if (pattern.test(canonicalKey)) {
                return true;
            }
        }

        if (questionNumber != null) {
            if (!Number.isFinite(questionNumber) || questionNumber <= 0 || questionNumber > MAX_QUESTION_NUMBER) {
                return true;
            }
        }

        return false;
    }

    function normalizeForComparison(value) {
        if (value == null) {
            return { display: null, normalized: null };
        }

        if (Array.isArray(value)) {
            const joined = value
                .map(item => toStringKey(item))
                .filter(Boolean)
                .join(', ');
            return normalizeForComparison(joined);
        }

        if (typeof value === 'object') {
            if (value.answer != null) {
                return normalizeForComparison(value.answer);
            }
            if (value.value != null) {
                return normalizeForComparison(value.value);
            }
            // 无法提取有效值的对象，返回null
            return { display: null, normalized: null };
        }

        const str = toStringKey(value);
        if (!str) {
            return { display: null, normalized: null };
        }

        const collapsed = str.replace(/\s+/g, ' ').trim();

        // 过滤 [object Object] 这样的无效字符串
        if (/^\[object\s/i.test(collapsed)) {
            return { display: null, normalized: null };
        }

        const lowered = collapsed.toLowerCase();

        if (NO_ANSWER_MARKERS.has(lowered)) {
            return { display: null, normalized: null };
        }

        const core = getAnswerMatchCore();
        if (core && typeof core.splitAnswerTokens === 'function') {
            const tokens = core.splitAnswerTokens(collapsed);
            if (!Array.isArray(tokens) || !tokens.length) {
                return { display: null, normalized: null };
            }
            if (tokens.length === 1) {
                const normalizedText = String(tokens[0]);
                return { display: normalizedText, normalized: normalizedText };
            }
            return { display: tokens.join(', '), normalized: tokens.slice() };
        }
        if (core && typeof core.normalizeToken === 'function') {
            const normalized = core.normalizeToken(collapsed);
            if (!normalized) {
                return { display: null, normalized: null };
            }
            const normalizedText = String(normalized);
            return { display: normalizedText, normalized: normalizedText };
        }

        return { display: collapsed, normalized: lowered };
    }

    function answersMatch(userInfo, correctInfo) {
        if (!userInfo || !correctInfo) {
            return null;
        }

        if (userInfo.normalized == null && correctInfo.normalized == null) {
            return null;
        }

        if (userInfo.normalized == null) {
            return false;
        }

        if (correctInfo.normalized == null) {
            return null;
        }

        const core = getAnswerMatchCore();
        if (core && typeof core.compareAnswers === 'function') {
            return core.compareAnswers(userInfo.normalized, correctInfo.normalized) === true;
        }
        return String(userInfo.normalized) === String(correctInfo.normalized);
    }

    function isPlainObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function mergeSourceMaps(sources) {
        const target = {};
        sources.forEach(source => {
            if (!isPlainObject(source)) {
                return;
            }
            Object.keys(source).forEach(key => {
                if (key == null) {
                    return;
                }
                const strKey = String(key).trim();
                if (!strKey) {
                    return;
                }
                if (target[strKey] == null || target[strKey] === '') {
                    target[strKey] = source[key];
                }
            });
        });
        return target;
    }

    function extractFromComparison(comparison, selector) {
        if (!comparison || typeof comparison !== 'object') {
            return {};
        }
        const result = {};
        Object.keys(comparison).forEach(key => {
            const entry = comparison[key];
            if (entry && typeof entry === 'object') {
                const value = selector(entry);
                if (value != null) {
                    result[key] = value;
                }
            }
        });
        return result;
    }

    function extractFromDetails(details, selector) {
        if (!details || typeof details !== 'object') {
            return {};
        }
        const result = {};
        Object.keys(details).forEach(key => {
            const entry = details[key];
            if (entry && typeof entry === 'object') {
                const value = selector(entry);
                if (value != null) {
                    result[key] = value;
                }
            }
        });
        return result;
    }

    function lookupAnswer(map, keyVariants) {
        for (const key of keyVariants) {
            if (key && map[key] != null) {
                return map[key];
            }
        }
        return null;
    }

    function alignLetterKeys(entryMap) {
        const letterKeys = Object.keys(entryMap).filter(key => /^q[a-z]+$/.test(key) && entryMap[key]);
        if (letterKeys.length === 0) {
            return;
        }

        const numericEntries = Object.keys(entryMap)
            .map(key => ({ key, entry: entryMap[key] }))
            .filter(item => item.entry && Number.isFinite(item.entry.questionNumber))
            .sort((a, b) => a.entry.questionNumber - b.entry.questionNumber);

        if (numericEntries.length === 0) {
            return;
        }

        const sortedLetterKeys = letterKeys.slice().sort();
        const requiredLength = sortedLetterKeys.length;

        for (let start = 0; start <= numericEntries.length - requiredLength; start += 1) {
            const firstNumber = numericEntries[start].entry.questionNumber;
            const lastNumber = numericEntries[start + requiredLength - 1].entry.questionNumber;

            if (!Number.isFinite(firstNumber) || !Number.isFinite(lastNumber)) {
                continue;
            }

            if ((lastNumber - firstNumber + 1) !== requiredLength) {
                continue;
            }

            for (let index = 0; index < requiredLength; index += 1) {
                const letterKey = sortedLetterKeys[index];
                const numericKey = numericEntries[start + index].key;
                const letterEntry = entryMap[letterKey];
                const numericEntry = entryMap[numericKey];

                if (!letterEntry || !numericEntry) {
                    continue;
                }

                if (!numericEntry.hasUserAnswer && letterEntry.hasUserAnswer) {
                    numericEntry.userAnswer = letterEntry.userAnswer;
                    numericEntry.userInfo = letterEntry.userInfo;
                    numericEntry.hasUserAnswer = true;
                }

                if (!numericEntry.hasCorrectAnswer && letterEntry.hasCorrectAnswer) {
                    numericEntry.correctAnswer = letterEntry.correctAnswer;
                    numericEntry.correctInfo = letterEntry.correctInfo;
                    numericEntry.hasCorrectAnswer = true;
                }
            }

            sortedLetterKeys.forEach(letterKey => {
                delete entryMap[letterKey];
            });
            break;
        }
    }

    function finaliseEntry(entry) {
        const displayNumber = entry.rangeLabel
            ? entry.rangeLabel
            : entry.questionNumber != null
            ? String(entry.questionNumber)
            : entry.canonicalKey ? entry.canonicalKey.replace(/^q/i, '').toUpperCase() : '';

        const userDisplay = entry.hasUserAnswer ? entry.userAnswer : 'No Answer';
        const correctDisplay = entry.hasCorrectAnswer ? entry.correctAnswer : 'N/A';
        const isCorrect = answersMatch(entry.userInfo, entry.correctInfo);

        return {
            canonicalKey: entry.canonicalKey,
            originalKeys: Array.from(entry.originalKeys),
            questionNumber: entry.questionNumber,
            displayNumber,
            userAnswer: userDisplay,
            correctAnswer: correctDisplay,
            isCorrect,
            hasUserAnswer: entry.hasUserAnswer,
            hasCorrectAnswer: entry.hasCorrectAnswer
        };
    }

    function getNormalizedEntries(record) {
        if (!record || typeof record !== 'object') {
            return [];
        }

        const comparisonSources = [
            record.answerComparison,
            record.realData && record.realData.answerComparison
        ].filter(Boolean);

        const userSources = [
            extractFromComparison(record.answerComparison, entry => entry.userAnswer ?? entry.user ?? entry.answer),
            extractFromComparison(record.realData && record.realData.answerComparison, entry => entry.userAnswer ?? entry.user ?? entry.answer),
            record.answers,
            record.realData && record.realData.answers,
            extractFromDetails(record.scoreInfo && record.scoreInfo.details, entry => entry.userAnswer ?? entry.user),
            extractFromDetails(record.realData && record.realData.scoreInfo && record.realData.scoreInfo.details, entry => entry.userAnswer ?? entry.user)
        ].filter(Boolean);

        const coreContracts = getPracticeCoreContracts();
        if (!coreContracts || typeof coreContracts.resolveRecordCorrectAnswerMap !== 'function') {
            throw new Error('AnswerComparisonUtils requires PracticeCore.contracts.resolveRecordCorrectAnswerMap');
        }
        const correctMap = coreContracts.resolveRecordCorrectAnswerMap(record);

        const comparisonMap = mergeSourceMaps(comparisonSources);
        const userMap = mergeSourceMaps(userSources);

        const allKeys = new Set([
            ...Object.keys(comparisonMap),
            ...Object.keys(userMap),
            ...Object.keys(correctMap)
        ]);

        const entryMap = {};

        allKeys.forEach(rawKey => {
            const keyInfo = normalizeKey(rawKey);
            if (!keyInfo.canonicalKey) {
                return;
            }
            if (isNoiseKey(keyInfo.canonicalKey, keyInfo.questionNumber)) {
                return;
            }

            if (!entryMap[keyInfo.canonicalKey]) {
                entryMap[keyInfo.canonicalKey] = {
                    canonicalKey: keyInfo.canonicalKey,
                    questionNumber: keyInfo.questionNumber,
                    rangeLabel: keyInfo.rangeLabel || null,
                    originalKeys: new Set(),
                    userAnswer: null,
                    correctAnswer: null,
                    hasUserAnswer: false,
                    hasCorrectAnswer: false,
                    userInfo: { display: null, normalized: null },
                    correctInfo: { display: null, normalized: null }
                };
            }

            const entry = entryMap[keyInfo.canonicalKey];
            entry.originalKeys.add(keyInfo.originalKey);

            if (keyInfo.questionNumber != null && entry.questionNumber == null) {
                entry.questionNumber = keyInfo.questionNumber;
            }
            if (keyInfo.rangeLabel && !entry.rangeLabel) {
                entry.rangeLabel = keyInfo.rangeLabel;
            }

            const lookupKeys = [
                keyInfo.originalKey,
                keyInfo.canonicalKey,
                keyInfo.questionNumber != null ? String(keyInfo.questionNumber) : null,
                keyInfo.questionNumber != null ? `q${keyInfo.questionNumber}` : null
            ].filter(Boolean);

            const userValue = lookupAnswer(userMap, lookupKeys);
            if (!entry.hasUserAnswer && userValue != null) {
                const userInfo = normalizeForComparison(userValue);
                if (userInfo.display != null) {
                    entry.userAnswer = userInfo.display;
                    entry.hasUserAnswer = true;
                }
                entry.userInfo = userInfo;
            }

            const correctValue = lookupAnswer(correctMap, lookupKeys);
            if (!entry.hasCorrectAnswer && correctValue != null) {
                const correctInfo = normalizeForComparison(correctValue);
                if (correctInfo.display != null) {
                    entry.correctAnswer = correctInfo.display;
                    entry.hasCorrectAnswer = true;
                }
                entry.correctInfo = correctInfo;
            }

            if ((!entry.hasUserAnswer || !entry.hasCorrectAnswer) && comparisonMap[keyInfo.originalKey]) {
                const fromComparison = comparisonMap[keyInfo.originalKey];
                if (fromComparison && typeof fromComparison === 'object') {
                    if (!entry.hasUserAnswer && (fromComparison.userAnswer || fromComparison.user || fromComparison.answer)) {
                        const compUserInfo = normalizeForComparison(fromComparison.userAnswer ?? fromComparison.user ?? fromComparison.answer);
                        if (compUserInfo.display != null) {
                            entry.userAnswer = compUserInfo.display;
                            entry.hasUserAnswer = true;
                        }
                        entry.userInfo = compUserInfo;
                    }
                    if (!entry.hasCorrectAnswer && (fromComparison.correctAnswer || fromComparison.correct)) {
                        const compCorrectInfo = normalizeForComparison(fromComparison.correctAnswer ?? fromComparison.correct);
                        if (compCorrectInfo.display != null) {
                            entry.correctAnswer = compCorrectInfo.display;
                            entry.hasCorrectAnswer = true;
                        }
                        entry.correctInfo = compCorrectInfo;
                    }
                }
            }
        });

        alignLetterKeys(entryMap);

        const entries = Object.keys(entryMap)
            .map(key => entryMap[key])
            .filter(entry => entry && (entry.hasUserAnswer || entry.hasCorrectAnswer));

        const finalEntries = entries.map(finaliseEntry);

        return finalEntries.sort((a, b) => {
            const aNumber = Number.isFinite(a.questionNumber) ? a.questionNumber : null;
            const bNumber = Number.isFinite(b.questionNumber) ? b.questionNumber : null;

            if (aNumber != null && bNumber != null) {
                return aNumber - bNumber;
            }
            if (aNumber != null) {
                return -1;
            }
            if (bNumber != null) {
                return 1;
            }
            return a.displayNumber.localeCompare(b.displayNumber, undefined, { sensitivity: 'base' });
        });
    }

    function summariseEntries(entries) {
        if (!Array.isArray(entries) || entries.length === 0) {
            return {
                total: 0,
                correct: 0,
                incorrect: 0,
                unanswered: 0,
                unknown: 0
            };
        }

        let correct = 0;
        let incorrect = 0;
        let unanswered = 0;
        let unknown = 0;

        entries.forEach(entry => {
            if (!entry) {
                return;
            }
            if (!entry.hasUserAnswer || entry.userAnswer == null || entry.userAnswer === 'No Answer') {
                unanswered += 1;
                return;
            }
            if (entry.isCorrect === true) {
                correct += 1;
            } else if (entry.isCorrect === false) {
                incorrect += 1;
            } else {
                unknown += 1;
            }
        });

        return {
            total: entries.length,
            correct,
            incorrect,
            unanswered,
            unknown
        };
    }

    function inferCategory(record, metadata, examEntry) {
        if (metadata && metadata.category && metadata.category !== 'Unknown') {
            return metadata.category;
        }

        if (record && record.category && record.category !== 'Unknown') {
            return record.category;
        }

        if (examEntry && examEntry.category) {
            return examEntry.category;
        }

        const candidates = [
            record && record.examId,
            metadata && metadata.examId,
            metadata && metadata.title,
            metadata && metadata.examTitle,
            record && record.originalExamId
        ]
            .map(toStringKey)
            .filter(Boolean);

        for (const item of candidates) {
            const match = item.match(/p([1-4])/i);
            if (match) {
                return `P${match[1]}`;
            }
        }

        if (examEntry && examEntry.type === 'listening') {
            return examEntry.category || 'Listening';
        }

        return metadata && metadata.category ? metadata.category : 'Unknown';
    }

    function enrichRecordMetadata(record, examEntry = null) {
        if (!record || typeof record !== 'object') {
            return {
                category: 'Unknown',
                frequency: 'unknown',
                examTitle: record && record.examId ? record.examId : '未知题目'
            };
        }

        const metadata = Object.assign({}, record.metadata || {});

        if (metadata.__enrichedMetadata) {
            record.metadata = metadata;
            return metadata;
        }

        const resolvedExam = examEntry && typeof examEntry === 'object' ? examEntry : null;

        if (resolvedExam) {
            if (resolvedExam.title && !metadata.examTitle) {
                metadata.examTitle = resolvedExam.title;
            }
            if (resolvedExam.frequency && !metadata.frequency) {
                metadata.frequency = resolvedExam.frequency;
            }
            if (resolvedExam.type && !metadata.type) {
                metadata.type = resolvedExam.type;
            }
        }

        metadata.category = inferCategory(record, metadata, resolvedExam);
        if (!metadata.frequency) {
            if (resolvedExam && resolvedExam.frequency) {
                metadata.frequency = resolvedExam.frequency;
            } else if (metadata.frequency == null) {
                metadata.frequency = 'unknown';
            }
        }

        if (!metadata.examTitle) {
            metadata.examTitle = record.title || record.examId || '未知题目';
        }

        metadata.__enrichedMetadata = true;

        record.metadata = metadata;

        if (!record.category || record.category === 'Unknown') {
            record.category = metadata.category;
        }

        if (!record.frequency || record.frequency === 'unknown') {
            record.frequency = metadata.frequency;
        }

        if (!record.title && metadata.examTitle) {
            record.title = metadata.examTitle;
        }

        return metadata;
    }

    function withEnrichedMetadata(record, examEntry = null) {
        if (!record || typeof record !== 'object') {
            return record;
        }
        const clone = Object.assign({}, record);
        clone.metadata = Object.assign({}, record.metadata || {});
        enrichRecordMetadata(clone, examEntry);
        return clone;
    }

    const AnswerComparisonUtils = {
        getNormalizedEntries,
        summariseEntries,
        enrichRecordMetadata,
        withEnrichedMetadata
    };

    global.AnswerComparisonUtils = AnswerComparisonUtils;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = AnswerComparisonUtils;
    }

})(typeof window !== 'undefined' ? window : globalThis);
