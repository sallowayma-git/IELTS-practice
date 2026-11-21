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

        const separator = original.lastIndexOf('::');
        if (separator >= 0) {
            const scope = original.slice(0, separator);
            const question = normalizeKey(original.slice(separator + 2));
            return { ...question, originalKey: original, sourceEntryKey: scope,
                canonicalKey: question.canonicalKey ? `${scope}::${question.canonicalKey}` : null };
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
        canonicalKey = canonicalKey.split('::').pop();

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

    function matchesAnswerSnapshot(value, answerInfo) {
        const snapshot = normalizeForComparison(value);
        const tokens = info => info.normalized == null
            ? []
            : [].concat(info.normalized).map(token => String(token).toLowerCase()).sort();
        // Compare complete snapshots, not grading equivalence (which can accept
        // one token from an array of alternatives). Selection order is irrelevant.
        return JSON.stringify(tokens(snapshot)) === JSON.stringify(tokens(answerInfo));
    }

    function resolveStoredGrade(entry) {
        let metadata = null;
        for (const candidate of entry.correctnessCandidates) {
            if (matchesAnswerSnapshot(candidate.userAnswer ?? candidate.user ?? candidate.answer, entry.userInfo)
                && matchesAnswerSnapshot(candidate.correctAnswer ?? candidate.correct, entry.correctInfo)) {
                if (typeof candidate.isCorrect === 'boolean') return candidate;
                if (!metadata) metadata = candidate;
            }
        }
        return metadata;
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

                numericEntry.correctnessCandidates.push(...letterEntry.correctnessCandidates);
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
        // Preserve submission grading only for the final displayed answer snapshot,
        // including any letter-to-number alignment. Legacy rows still recompute.
        const storedGrade = resolveStoredGrade(entry);
        const storedCorrect = entry.hasCorrectAnswer && storedGrade ? storedGrade.isCorrect : null;
        const recomputedCorrect = answersMatch(entry.userInfo, entry.correctInfo);
        const isCorrect = typeof storedCorrect === 'boolean'
            ? storedCorrect
            : recomputedCorrect;

        const weight = storedGrade && Number.isSafeInteger(storedGrade.weight) && storedGrade.weight > 0
            ? storedGrade.weight : 1;
        const partial = entry.hasCorrectAnswer && storedGrade ? storedGrade.partialCorrectCount : null;
        const partialCorrectCount = Number.isSafeInteger(partial) && partial >= 0 && partial <= weight
            ? partial : (isCorrect === true ? weight : (isCorrect === false && weight === 1 ? 0 : null));
        const selected = entry.hasUserAnswer ? [].concat(entry.userInfo.normalized).length : 0;
        const savedAnswered = storedGrade?.answeredCount;
        const hasOccupancyEvidence = storedGrade && Object.prototype.hasOwnProperty.call(storedGrade, 'answeredCount');
        const legacySelectionSet = weight === 1 && (selected > weight || entry.correctnessCandidates.some(candidate => (
            Array.isArray(candidate.userAnswer ?? candidate.user ?? candidate.answer)
            && matchesAnswerSnapshot(candidate.userAnswer ?? candidate.user ?? candidate.answer, entry.userInfo)
            && matchesAnswerSnapshot(candidate.correctAnswer ?? candidate.correct, entry.correctInfo)
        )));
        // Shared split-key rows display all selections, not their assigned slot.
        // Only matching submission occupancy may classify those rows as filled.
        const answered = Number.isSafeInteger(savedAnswered) && savedAnswered >= 0
            && savedAnswered <= Math.min(weight, selected) ? savedAnswered
            : (selected > 0 && (hasOccupancyEvidence || legacySelectionSet) ? null : Math.min(weight, selected));
        const unanswered = answered === null ? 0 : weight - answered;
        const credit = partialCorrectCount !== null && (answered === null || partialCorrectCount <= answered)
            ? partialCorrectCount : null;
        const incorrect = credit === null || answered === null ? 0 : answered - credit;
        const scoredCounts = {
            total: weight, correct: credit ?? 0,
            incorrect, unanswered, unknown: weight - (credit ?? 0) - incorrect - unanswered
        };

        return {
            canonicalKey: entry.canonicalKey,
            sourceEntryKey: entry.sourceEntryKey,
            originalKeys: Array.from(entry.originalKeys),
            questionNumber: entry.questionNumber,
            displayNumber,
            userAnswer: userDisplay,
            correctAnswer: correctDisplay,
            isCorrect,
            weight,
            partialCorrectCount: credit,
            scoredCounts,
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

        // Keep candidates in source order so missing or stale verdicts cannot hide
        // a valid boolean in a later source. Display-generated flags are not grades.
        const correctnessSources = [
            { entries: record.answerComparison },
            { entries: record.realData && record.realData.answerComparison },
            { entries: record.scoreInfo && record.scoreInfo.details, producer: record.scoreInfo && record.scoreInfo.source },
            { entries: record.realData && record.realData.scoreInfo && record.realData.scoreInfo.details,
                producer: record.realData && record.realData.scoreInfo && record.realData.scoreInfo.source },
            { entries: record.answerDetails },
            { entries: record.realData && record.realData.answerDetails }
        ];
        const correctnessMap = new Map();
        correctnessSources.forEach(({ entries: source, producer }) => {
            if (!isPlainObject(source)) {
                return;
            }
            Object.entries(source).forEach(([rawKey, candidate]) => {
                if (!isPlainObject(candidate)
                    || candidate.isCorrectSource === 'display') {
                    return;
                }
                // Older display enrichment also stored unmarked booleans. Only
                // weighted grades or details from a submission producer can
                // override matching; a questionId alone is normalization metadata.
                const hasGradingEvidence = (Number.isSafeInteger(candidate.weight) && candidate.weight > 0)
                    || producer === 'unified_reading_page'
                    || producer === 'listening_record_bridge';
                if (!hasGradingEvidence) {
                    return;
                }
                const { canonicalKey } = normalizeKey(rawKey);
                if (!correctnessMap.has(canonicalKey)) {
                    correctnessMap.set(canonicalKey, []);
                }
                correctnessMap.get(canonicalKey).push(candidate);
            });
        });

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
                    sourceEntryKey: keyInfo.sourceEntryKey,
                    questionNumber: keyInfo.questionNumber,
                    rangeLabel: keyInfo.rangeLabel || null,
                    originalKeys: new Set(),
                    userAnswer: null,
                    correctAnswer: null,
                    hasUserAnswer: false,
                    hasCorrectAnswer: false,
                    correctnessCandidates: (correctnessMap.get(keyInfo.canonicalKey) || []).slice(),
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
                !keyInfo.sourceEntryKey && keyInfo.questionNumber != null ? String(keyInfo.questionNumber) : null,
                !keyInfo.sourceEntryKey && keyInfo.questionNumber != null ? `q${keyInfo.questionNumber}` : null
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
            .filter(Boolean);

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
        let total = 0;

        entries.forEach(entry => {
            if (!entry) {
                return;
            }
            if (entry.scoredCounts) {
                const counts = entry.scoredCounts;
                total += counts.total;
                correct += counts.correct;
                incorrect += counts.incorrect;
                unanswered += counts.unanswered;
                unknown += counts.unknown;
                return;
            }
            total += 1;
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
            total,
            correct,
            incorrect,
            unanswered,
            unknown
        };
    }

    function passageIdentity(record, index) {
        return record.sessionId || record.id || record.examId || record.metadata?.examId || `suite-entry-${index}`;
    }

    function uniquePassages(record) {
        const seen = new Set();
        return (Array.isArray(record?.suiteEntries) ? record.suiteEntries : []).filter((entry, index) => {
            if (!entry || typeof entry !== 'object') return false;
            const identity = passageIdentity(entry, index);
            if (seen.has(identity)) return false;
            seen.add(identity);
            return true;
        });
    }

    function getRecordEntries(record, normalize = getNormalizedEntries) {
        const entries = [];
        const collect = (source, scope = []) => {
            const passages = uniquePassages(source);
            if (passages.length) {
                passages.forEach((passage, index) => collect(passage, [...scope, passageIdentity(passage, index)]));
                return; // Root suite maps are copies of the passage results.
            }
            for (const entry of normalize(source)) {
                entries.push({ ...entry, sourceEntryKey: JSON.stringify([...scope, entry.sourceEntryKey || '']) });
            }
        };
        if (record && typeof record === 'object') collect(record);
        const seen = new Set();
        return entries.filter(entry => {
            const key = JSON.stringify([entry.sourceEntryKey, entry.canonicalKey || entry.questionId || entry.displayNumber]);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function countValue(value) {
        if (typeof value !== 'number' && !(typeof value === 'string' && value.trim())) return null;
        const number = Number(value);
        return Number.isSafeInteger(number) && number >= 0 ? number : null;
    }

    function savedCountCandidates(record) {
        const candidates = [];
        // AppData captures original evidence before supplying legacy display zeros.
        if (Object.prototype.hasOwnProperty.call(record, 'browseScore')) {
            candidates.push([record.browseScore?.earned, record.browseScore?.possible]);
        } else {
            candidates.push([record.correctAnswers, record.totalQuestions]);
        }
        for (const score of [record.scoreInfo, record.realData?.scoreInfo]) {
            if (!score || score.source === 'comparison_calculation' || score.source === 'display') continue;
            candidates.push([score.correct, score.total], [score.correct, score.totalQuestions]);
        }
        candidates.push([record.score, record.total]);
        return candidates;
    }

    function savedCounts(record, detailTotal) {
        for (const [earned, possible] of savedCountCandidates(record)) {
            const correct = countValue(earned);
            const total = countValue(possible);
            if (correct !== null && total !== null && correct <= total && (total > 0 || detailTotal === 0)) {
                return { correct, total };
            }
        }
        return null;
    }

    // Shared history/export count contract. Aggregate grades never create row verdicts.
    function resolveRecordCounts(record, entries = null, normalize = getNormalizedEntries) {
        record = record || {};
        if (entries === null) entries = getRecordEntries(record, normalize);
        const detail = summariseEntries(entries);
        const saved = savedCounts(record, detail.total);
        if (!saved) {
            const passages = uniquePassages(record);
            const grades = passages.map(passage => resolveRecordCounts(passage, null, normalize));
            if (grades.length) {
                const sum = field => grades.reduce((value, grade) => value + (grade[field] ?? 0), 0);
                const knownTotal = sum('total');
                const possible = savedCountCandidates(record).map(([, value]) => countValue(value))
                    .find(value => value !== null && value >= knownTotal);
                const total = possible ?? (grades.every(grade => grade.total !== null) ? knownTotal : null);
                const completeGrade = total !== null && total === knownTotal
                    && grades.every(grade => grade.correct !== null && grade.total !== null);
                const correct = completeGrade ? sum('correct') : null;
                const missed = completeGrade ? total - correct : null;
                const incorrect = sum('incorrect');
                const unanswered = sum('unanswered');
                const unknown = sum('unknown') + (total === null ? 0 : total - knownTotal);
                // Missing child grades, including empty/unknown-size passages,
                // must not disappear into a complete subset of flattened rows.
                const detailStatus = grades.some(grade => grade.detailStatus === 'conflict') ? 'conflict'
                    : (completeGrade && !unknown && grades.every(grade => grade.detailStatus === 'complete') ? 'complete' : 'partial');
                return { total, correct, missed, incorrect, unanswered, unknown, source: 'passages', detailStatus,
                    unclassifiedMissed: missed === null ? null : missed - incorrect - unanswered };
            }
        }
        if (saved) {
            const missed = saved.total - saved.correct;
            const compatible = detail.total <= saved.total && detail.correct <= saved.correct
                && detail.incorrect + detail.unanswered <= missed;
            const incorrect = compatible ? detail.incorrect : 0;
            const unanswered = compatible ? detail.unanswered : 0;
            const unknown = compatible ? detail.unknown + saved.total - detail.total : saved.total;
            return { ...saved, missed, incorrect, unanswered, unknown, source: 'saved',
                unclassifiedMissed: missed - incorrect - unanswered,
                detailStatus: !compatible ? 'conflict' : (unknown ? 'partial' : 'complete') };
        }
        // Missing saved evidence must also exclude synthesized display totals.
        const possible = savedCountCandidates(record).map(([, value]) => countValue(value))
            .find(value => value !== null && value >= detail.total);
        const total = possible ?? (detail.total || null);
        const unknown = detail.unknown + (total === null ? 0 : total - detail.total);
        const complete = total !== null && unknown === 0;
        return { ...detail, total, correct: complete ? detail.correct : null,
            missed: complete ? detail.incorrect + detail.unanswered : null, unknown,
            unclassifiedMissed: null, source: 'detail', detailStatus: complete ? 'complete' : 'partial' };
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
        getRecordEntries,
        resolveRecordCounts,
        summariseEntries,
        enrichRecordMetadata,
        withEnrichedMetadata
    };

    global.AnswerComparisonUtils = AnswerComparisonUtils;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = AnswerComparisonUtils;
    }

})(typeof window !== 'undefined' ? window : globalThis);
