(function(global) {
    'use strict';

    const MAX_QUESTION_NUMBER = 200;
    const NOISE_KEYS = new Set([
        'playback-speed',
        'playbackspeed',
        'volume-slider',
        'volumeslider',
        'audio-volume',
        'audioCurrentTime',
        'audio-duration',
        'audioDuration',
        'settings',
        'lastFocusElement',
        'sessionid',
        'examid',
        'nextExamId',
        'previousExamId',
        'folder',
        'source',
        'result',
        'metadata',
        'practiceSettings'
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
    const BOOLEAN_SYNONYMS = new Map([
        ['true', 'true'],
        ['t', 'true'],
        ['yes', 'true'],
        ['y', 'true'],
        ['1', 'true'],
        ['false', 'false'],
        ['f', 'false'],
        ['no', 'false'],
        ['n', 'false'],
        ['0', 'false']
    ]);
    const NOT_GIVEN_SYNONYMS = new Map([
        ['ng', 'not given'],
        ['notgiven', 'not given'],
        ['not-given', 'not given']
    ]);

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
        const digitMatch = lowered.match(/(\d{1,4})/);
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
        }

        const str = toStringKey(value);
        if (!str) {
            return { display: null, normalized: null };
        }

        const collapsed = str.replace(/\s+/g, ' ').trim();
        const lowered = collapsed.toLowerCase();

        if (NO_ANSWER_MARKERS.has(lowered)) {
            return { display: null, normalized: null };
        }

        if (BOOLEAN_SYNONYMS.has(lowered)) {
            const mapped = BOOLEAN_SYNONYMS.get(lowered);
            return { display: mapped === 'true' ? 'True' : 'False', normalized: mapped };
        }

        if (NOT_GIVEN_SYNONYMS.has(lowered)) {
            const mapped = NOT_GIVEN_SYNONYMS.get(lowered);
            return { display: mapped, normalized: mapped };
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
            return false;
        }

        return userInfo.normalized === correctInfo.normalized;
    }

    function mergeSourceMaps(sources) {
        const target = {};
        sources.forEach(source => {
            if (!source || typeof source !== 'object') {
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
        const displayNumber = entry.questionNumber != null
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

        const correctSources = [
            extractFromComparison(record.answerComparison, entry => entry.correctAnswer ?? entry.correct),
            extractFromComparison(record.realData && record.realData.answerComparison, entry => entry.correctAnswer ?? entry.correct),
            record.correctAnswers,
            record.realData && record.realData.correctAnswers,
            extractFromDetails(record.scoreInfo && record.scoreInfo.details, entry => entry.correctAnswer ?? entry.correct),
            extractFromDetails(record.realData && record.realData.scoreInfo && record.realData.scoreInfo.details, entry => entry.correctAnswer ?? entry.correct)
        ].filter(Boolean);

        const comparisonMap = mergeSourceMaps(comparisonSources);
        const userMap = mergeSourceMaps(userSources);
        const correctMap = mergeSourceMaps(correctSources);

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
                unanswered: 0
            };
        }

        let correct = 0;
        let incorrect = 0;
        let unanswered = 0;

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
            } else {
                incorrect += 1;
            }
        });

        return {
            total: entries.length,
            correct,
            incorrect,
            unanswered
        };
    }

    function getAllExamIndexes(globalObj) {
        const sources = [
            globalObj.completeExamIndex,
            globalObj.examIndex,
            globalObj.readingExamIndex,
            globalObj.listeningExamIndex,
            globalObj.fullExamIndex,
            globalObj.practiceExamIndex
        ];
        return sources
            .filter(Array.isArray)
            .reduce((acc, list) => acc.concat(list), []);
    }

    function normalizeTitle(title) {
        return toStringKey(title)
            .toLowerCase()
            .replace(/[\s\-_\u3000]+/g, '')
            .replace(/[^\w\u4e00-\u9fa5]/g, '');
    }

    function findExamEntry(record, metadata, globalObj) {
        const indexes = getAllExamIndexes(globalObj);
        if (indexes.length === 0) {
            return null;
        }

        const candidateIds = [
            record && record.examId,
            record && record.originalExamId,
            record && record.realData && record.realData.examId,
            metadata && metadata.examId,
            metadata && metadata.id
        ]
            .map(toStringKey)
            .filter(Boolean);

        if (candidateIds.length > 0) {
            const idLookup = new Map();
            indexes.forEach(item => {
                if (!item || typeof item !== 'object') {
                    return;
                }
                const itemId = toStringKey(item.id);
                if (itemId) {
                    idLookup.set(itemId.toLowerCase(), item);
                }
            });

            for (const id of candidateIds) {
                const normalizedId = id.toLowerCase();
                if (idLookup.has(normalizedId)) {
                    return idLookup.get(normalizedId);
                }
            }
        }

        const candidateTitles = [
            metadata && metadata.examTitle,
            metadata && metadata.title,
            record && record.title,
            record && record.examTitle,
            record && record.realData && record.realData.title
        ]
            .map(normalizeTitle)
            .filter(Boolean);

        if (candidateTitles.length > 0) {
            const titleLookup = new Map();
            indexes.forEach(item => {
                if (!item || typeof item !== 'object') {
                    return;
                }
                const itemTitle = normalizeTitle(item.title);
                if (itemTitle) {
                    titleLookup.set(itemTitle, item);
                }
            });

            for (const title of candidateTitles) {
                if (titleLookup.has(title)) {
                    return titleLookup.get(title);
                }
            }
        }

        return null;
    }

    function inferCategory(record, metadata, examEntry) {
        if (examEntry && examEntry.category) {
            return examEntry.category;
        }

        if (metadata && metadata.category && metadata.category !== 'Unknown') {
            return metadata.category;
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
            const match = item.match(/p([1-3])/i);
            if (match) {
                return `P${match[1]}`;
            }
        }

        if (examEntry && examEntry.type === 'listening') {
            return examEntry.category || 'Listening';
        }

        return metadata && metadata.category ? metadata.category : 'Unknown';
    }

    function enrichRecordMetadata(record) {
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

        const globalObj = global || {};
        const examEntry = findExamEntry(record, metadata, globalObj);

        if (examEntry) {
            if (examEntry.title && !metadata.examTitle) {
                metadata.examTitle = examEntry.title;
            }
            if (examEntry.frequency && !metadata.frequency) {
                metadata.frequency = examEntry.frequency;
            }
            if (examEntry.type && !metadata.type) {
                metadata.type = examEntry.type;
            }
        }

        metadata.category = inferCategory(record, metadata, examEntry);
        if (!metadata.frequency) {
            if (examEntry && examEntry.frequency) {
                metadata.frequency = examEntry.frequency;
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

    function withEnrichedMetadata(record) {
        if (!record || typeof record !== 'object') {
            return record;
        }
        const clone = Object.assign({}, record);
        clone.metadata = Object.assign({}, record.metadata || {});
        enrichRecordMetadata(clone);
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
