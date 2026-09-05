(function installAppData(global) {
    'use strict';

    const internals = global.__AppDataV2Internals;
    if (!internals || typeof internals.DataKernel !== 'function') {
        throw new Error('AppData v2 requires DataKernel');
    }
    const {
        DataKernel,
        AppDataError,
        catalog,
        clone,
        randomId,
        nowIso,
        checksum,
        canonicalizeJson: kernelCanonicalizeJson,
        validateEntityRow: kernelValidateEntityRow
    } = internals;
    const kernel = new DataKernel();
    const importPlans = new Map();
    const RECOVERY_KEYS = Object.freeze({
        activeSession: 'recovery.activeSessions',
        draft: 'recovery.drafts',
        interrupted: 'recovery.interrupted',
        rejectedCompletion: 'recovery.rejectedCompletions'
    });
    const PREFERENCE_FIELDS = Object.freeze({
        theme: 'theme', browse: 'browse', timer: 'timer', suite: 'suite', candidateCode: 'candidateCode',
        resourceBasePrefix: 'resourceBasePrefix', onboarding: 'onboarding', readingDisplay: 'readingDisplay',
        threeBackground: 'threeBackground', themePortal: 'themePortal', practiceWidget: 'practiceWidget',
        consent: 'consent', logConfig: 'logConfig'
    });
    const PRACTICE_ENTITY_STORES = Object.freeze(['practiceSummaries', 'practiceDetails', 'practiceAnnotations']);

    function asObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
    function asArray(value) { return Array.isArray(value) ? value : []; }
    function normalizePhoneticValue(value) {
        if (typeof value !== 'string') return '';
        return value.trim().replace(/^\/+|\/+$/g, '').trim();
    }
    function idOf(value, fields) {
        for (const field of fields) {
            if (value && value[field] !== undefined && value[field] !== null && value[field] !== '') return String(value[field]);
        }
        return '';
    }

    function preserveProgressPhonetics(incomingWords, existingWords) {
        const existingById = new Map();
        const existingByWord = new Map();
        asArray(existingWords).forEach((rawWord) => {
            const word = asObject(rawWord);
            const phonetic = normalizePhoneticValue(word.phonetic);
            if (!phonetic) return;
            const id = typeof word.id === 'string' ? word.id.trim() : '';
            const identity = String(word.word || '').trim().toLowerCase();
            if (id && !existingById.has(id)) existingById.set(id, phonetic);
            if (identity && !existingByWord.has(identity)) existingByWord.set(identity, phonetic);
        });
        return asArray(incomingWords).map((rawWord) => {
            if (!rawWord || typeof rawWord !== 'object' || Array.isArray(rawWord)) return clone(rawWord);
            const word = clone(rawWord);
            const incomingPhonetic = normalizePhoneticValue(word.phonetic);
            if (incomingPhonetic) {
                word.phonetic = incomingPhonetic;
                return word;
            }
            delete word.phonetic;
            const id = typeof word.id === 'string' ? word.id.trim() : '';
            const identity = String(word.word || '').trim().toLowerCase();
            const preserved = (id && existingById.get(id)) || (identity && existingByWord.get(identity)) || '';
            if (preserved) word.phonetic = preserved;
            return word;
        });
    }

    function importedLibraryId(value, options = {}) {
        const id = value === null || value === undefined ? '' : String(value).trim();
        if (!id && options.nullable) return null;
        if (!id) throw new AppDataError('VALIDATION', 'Imported library configuration id is required');
        if (/^exam_index(?:_|$)/.test(id)) {
            throw new AppDataError('VALIDATION', 'Unsupported library configuration id');
        }
        return id;
    }
    function assertObject(value, message) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppDataError('VALIDATION', message);
    }
    function assertArray(value, message) {
        if (!Array.isArray(value)) throw new AppDataError('VALIDATION', message);
    }
    function jsonValue(value, label = 'value') {
        try {
            const serialized = JSON.stringify(value, (_key, current) => {
                if (typeof current === 'bigint') return String(current);
                if (typeof current === 'number' && !Number.isFinite(current)) return null;
                return current;
            });
            if (serialized === undefined) return null;
            return JSON.parse(serialized);
        } catch (error) {
            throw new AppDataError('VALIDATION', `${label} must be JSON-serializable`, { cause: error && error.message });
        }
    }
    function operationId(command, prefix, semanticPayload = command) {
        const id = command && command.operationId ? String(command.operationId) : randomId(prefix);
        jsonValue(semanticPayload, `${prefix} payload`);
        return id;
    }
    function mutationOptions(command, prefix, semanticPayload, extra = {}) {
        const source = asObject(command);
        const payload = jsonValue(semanticPayload, `${prefix} payload`);
        const intent = { command: prefix, payload };
        if (Object.prototype.hasOwnProperty.call(source, 'expectedRevision')) {
            intent.expectedRevision = source.expectedRevision;
        }
        return Object.assign({}, extra, {
            operationId: operationId(source, prefix, payload),
            intent
        });
    }
    function optionsMutationOptions(options, prefix, semanticPayload, extra = {}) {
        return mutationOptions(asObject(options), prefix, semanticPayload, extra);
    }
    function deterministicEntityId(prefix, operation) {
        return `${prefix}_${checksum({ operationId: String(operation) }).replace(/[^a-z0-9]+/gi, '')}`;
    }
    function normalizeAccuracyRatio(value, label = 'accuracy') {
        if (value === undefined || value === null || value === '') return null;
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
            throw new AppDataError('VALIDATION', `${label} must be between 0 and 100`);
        }
        return numeric > 1 ? numeric / 100 : numeric;
    }
    function defaultStats() {
        return {
            totalPractices: 0, totalQuestions: 0, correctAnswers: 0, averageAccuracy: 0,
            reading: { practices: 0, questions: 0, correct: 0, accuracy: 0 },
            listening: { practices: 0, questions: 0, correct: 0, accuracy: 0 },
            lastUpdated: nowIso()
        };
    }

    function firstNonNegative(...values) {
        for (const value of values) {
            let candidate = value;
            if (typeof candidate === 'string') {
                candidate = candidate.trim();
                if (!candidate) continue;
            } else if (typeof candidate !== 'number') {
                continue;
            }
            const numeric = Number(candidate);
            if (Number.isFinite(numeric) && numeric >= 0) return numeric;
        }
        return null;
    }

    function normalizePracticeScore(record) {
        const scoreInfo = asObject(record.scoreInfo);
        const legacyScoreInfo = asObject(asObject(record.realData).scoreInfo);
        const overloadedAnswers = record.correctAnswers;
        if (overloadedAnswers && typeof overloadedAnswers === 'object') {
            record.correctAnswerMap = Object.assign(
                {},
                clone(asObject(overloadedAnswers)),
                clone(asObject(record.correctAnswerMap))
            );
        }
        const correct = firstNonNegative(
            overloadedAnswers,
            record.correctAnswersCount,
            scoreInfo.correctAnswers,
            scoreInfo.correct,
            legacyScoreInfo.correctAnswers,
            legacyScoreInfo.correct
        );
        if (correct !== null) record.correctAnswers = correct;
        else if (overloadedAnswers && typeof overloadedAnswers === 'object') record.correctAnswers = 0;
        const total = firstNonNegative(
            record.totalQuestions,
            record.questionCount,
            scoreInfo.totalQuestions,
            scoreInfo.total,
            legacyScoreInfo.totalQuestions,
            legacyScoreInfo.total
        );
        if (total !== null) record.totalQuestions = total;
    }

    function mergeAnswers(target, source) {
        if (Array.isArray(source)) {
            source.forEach((item, index) => {
                if (!item || typeof item !== 'object') return;
                const questionId = idOf(item, ['questionId', 'questionNumber', 'id', 'number']) || String(index + 1);
                const answer = item.answer ?? item.value ?? item.userAnswer ?? item.selectedAnswer;
                if (answer !== undefined) target[questionId] = clone(answer);
            });
            return;
        }
        for (const [questionId, answer] of Object.entries(asObject(source))) {
            target[String(questionId)] = clone(answer);
        }
    }

    function normalizePracticeAnswers(record) {
        const answers = {};
        const raw = asObject(record.rawData);
        const rawReal = asObject(raw.realData);
        const real = asObject(record.realData);
        for (const source of [
            rawReal.answerMap, rawReal.answerList, rawReal.answers,
            raw.answerMap, raw.answerList, raw.answers,
            real.answerMap, real.answerList, real.answers,
            record.answerMap, record.answerList, record.answers
        ]) mergeAnswers(answers, source);
        if (Object.keys(answers).length) record.answers = answers;
    }

    function questionTypeErrorCounts(source) {
        const counts = {};
        const add = (type, count = 1) => {
            const key = String(type || '').trim();
            if (key && count > 0) counts[key] = (counts[key] || 0) + count;
        };
        for (const [type, value] of Object.entries(asObject(source && source.questionTypePerformance))) {
            const metrics = asObject(value);
            const total = firstNonNegative(metrics.totalQuestions, metrics.total);
            const correct = firstNonNegative(metrics.correctAnswers, metrics.correct);
            if (total !== null && correct !== null) add(type, Math.max(0, total - correct));
        }
        for (const detail of Object.values(asObject(asObject(source && source.scoreInfo).details))) {
            if (detail && detail.isCorrect === false) add(detail.questionType || detail.type);
        }
        return counts;
    }

    function canonicalizeRecord(input) {
        assertObject(input, 'practice record must be an object');
        const record = jsonValue(input, 'practice record');
        record.id = idOf(record, ['id', 'recordId', 'sessionId']) || randomId('record');
        record.sessionId = idOf(record, ['sessionId']) || record.id;
        record.timestamp = record.timestamp || record.completedAt || record.date || nowIso();
        record.completedAt = record.completedAt || record.timestamp;
        record.type = record.type || record.examType || (record.metadata && record.metadata.type) || 'practice';
        record.metadata = asObject(record.metadata);
        if (!record.metadata.examId && record.examId) record.metadata.examId = record.examId;
        if (!record.examId && record.metadata.examId) record.examId = record.metadata.examId;
        normalizePracticeAnswers(record);
        normalizePracticeScore(record);
        for (const field of ['duration', 'totalQuestions', 'correctAnswers', 'accuracy', 'totalScore']) {
            if (record[field] === undefined || record[field] === null || record[field] === '') continue;
            const numeric = Number(record[field]);
            if (!Number.isFinite(numeric) || numeric < 0) throw new AppDataError('VALIDATION', `practice record ${field} must be a non-negative number`);
            record[field] = numeric;
        }
        if (record.accuracy !== undefined) record.accuracy = normalizeAccuracyRatio(record.accuracy, 'practice record accuracy');
        return jsonValue(record, 'canonical practice record');
    }

    function lightSuiteEntry(source, fallbackType = null) {
        const entry = asObject(source);
        const scoreInfo = asObject(entry.scoreInfo);
        const realScoreInfo = asObject(asObject(entry.realData).scoreInfo);
        const metadata = asObject(entry.metadata);
        const totalQuestions = firstNonNegative(entry.totalQuestions, scoreInfo.totalQuestions, scoreInfo.total, realScoreInfo.totalQuestions, realScoreInfo.total) ?? 0;
        const correctAnswers = firstNonNegative(entry.correctAnswers, scoreInfo.correctAnswers, scoreInfo.correct, realScoreInfo.correctAnswers, realScoreInfo.correct) ?? 0;
        const explicitAccuracy = entry.accuracy ?? scoreInfo.accuracy ?? realScoreInfo.accuracy;
        const accuracy = normalizeAccuracyRatio(
            explicitAccuracy === undefined && totalQuestions > 0 ? correctAnswers / totalQuestions : (explicitAccuracy ?? 0),
            'suite entry accuracy'
        ) || 0;
        const percentage = Number(entry.percentage ?? scoreInfo.percentage ?? realScoreInfo.percentage ?? (accuracy * 100)) || 0;
        return jsonValue({
            id: entry.id || null,
            sessionId: entry.sessionId || null,
            examId: entry.examId || metadata.examId || null,
            title: entry.title || entry.examTitle || metadata.examTitle || metadata.title || '',
            type: entry.type || metadata.type || fallbackType,
            date: entry.date || entry.completedAt || entry.timestamp || null,
            duration: Number(entry.duration ?? scoreInfo.duration ?? realScoreInfo.duration ?? 0) || 0,
            totalQuestions,
            correctAnswers,
            accuracy,
            percentage,
            questionTypeErrorCounts: questionTypeErrorCounts(entry)
        }, 'suite entry light projection');
    }

    function lightFromCanonical(source) {
        const scoreInfo = asObject(source.scoreInfo);
        const realScoreInfo = asObject(asObject(source.realData).scoreInfo);
        const metadata = asObject(source.metadata);
        const hasOwn = (object, field) => Object.prototype.hasOwnProperty.call(object, field);
        const dataSource = hasOwn(source, 'dataSource')
            ? source.dataSource
            : (hasOwn(metadata, 'dataSource') ? metadata.dataSource : undefined);
        const totalQuestions = Number(source.totalQuestions ?? scoreInfo.totalQuestions ?? scoreInfo.total ?? realScoreInfo.totalQuestions ?? realScoreInfo.total ?? 0) || 0;
        const correctAnswers = Number(source.correctAnswers ?? scoreInfo.correctAnswers ?? scoreInfo.correct ?? realScoreInfo.correctAnswers ?? realScoreInfo.correct ?? 0) || 0;
        const explicitAccuracy = source.accuracy ?? scoreInfo.accuracy ?? realScoreInfo.accuracy;
        const accuracy = normalizeAccuracyRatio(
            explicitAccuracy === undefined && totalQuestions > 0 ? correctAnswers / totalQuestions : (explicitAccuracy ?? 0),
            'practice light accuracy'
        ) || 0;
        return jsonValue({
            id: source.id,
            sessionId: source.sessionId,
            examId: source.examId || source.metadata.examId || null,
            title: source.title || source.examTitle || (source.metadata && source.metadata.examTitle) || source.metadata.title || '',
            type: source.type,
            mode: source.mode || source.practiceMode || null,
            timestamp: source.timestamp,
            completedAt: source.completedAt,
            date: source.date || source.completedAt || source.timestamp || null,
            startTime: source.startTime || null,
            endTime: source.endTime || null,
            // canonicalizeRecord validates an explicit root duration first.
            // Legacy aliases still need individual validation so a malformed
            // earlier alias cannot mask a later valid value or persist a
            // negative canonical summary.
            duration: firstNonNegative(
                source.duration,
                source.durationSeconds,
                source.duration_seconds,
                source.elapsedSeconds,
                source.elapsed_seconds,
                source.timeSpent,
                source.time_spent,
                scoreInfo.duration,
                scoreInfo.durationSeconds,
                scoreInfo.duration_seconds,
                scoreInfo.elapsedSeconds,
                scoreInfo.elapsed_seconds,
                scoreInfo.timeSpent,
                scoreInfo.time_spent,
                realScoreInfo.duration,
                realScoreInfo.durationSeconds,
                realScoreInfo.duration_seconds,
                realScoreInfo.elapsedSeconds,
                realScoreInfo.elapsed_seconds,
                realScoreInfo.timeSpent,
                realScoreInfo.time_spent
            ) ?? 0,
            totalQuestions,
            correctAnswers,
            accuracy,
            percentage: Number(source.percentage ?? scoreInfo.percentage ?? realScoreInfo.percentage ?? (accuracy * 100)) || 0,
            score: source.score ?? scoreInfo.score ?? realScoreInfo.score ?? null,
            questionTypeErrorCounts: questionTypeErrorCounts(source),
            // 缺失时必须留空而不是写 null：消费方按 `dataSource === 'real' || === undefined`
            // 过滤记录（js/main.js updatePracticeView），null 两者都不匹配会让记录整条消失。
            // jsonValue 走 JSON.stringify，undefined 字段会被丢弃，读取时即为 undefined。
            dataSource,
            // Summaries are list indexes.  Keep only the metadata needed to filter, show a
            // source label, or locate the originating library; details stay in their entity.
            metadata: Object.fromEntries([
                // `source` must stay: PracticeRecordSource uses metadata.source demo markers
                // (e.g. onboarding-demo) so light/stats/achievements stay consistent with full.
                'examId', 'examTitle', 'title', 'type', 'category', 'frequency',
                'dataSource', 'source', 'libraryConfigurationId'
            ].filter((field) => hasOwn(metadata, field)).map((field) => [field, clone(metadata[field])])),
            suite: source.suite == null ? null : clone(asObject(source.suite)),
            suiteEntrySummaries: asArray(source.suiteEntries).map((entry) => lightSuiteEntry(
                entry,
                String(source.type || '').replace(/-suite$/, '') || null
            ))
        }, 'practice light projection');
    }

    function projectLight(record) {
        if (!record) return null;
        return lightFromCanonical(canonicalizeRecord(record));
    }

    function firstNonEmpty(...values) {
        let first;
        for (const value of values) {
            if (value === undefined || value === null) continue;
            if (first === undefined) first = value;
            if (Array.isArray(value) && value.length) return clone(value);
            if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length) return clone(value);
            if (typeof value !== 'object') return clone(value);
        }
        return first === undefined ? {} : clone(first);
    }

    const SUMMARY_FIELDS = new Set(['id', 'sessionId', 'examId', 'title', 'type', 'mode', 'timestamp', 'completedAt', 'date', 'startTime', 'endTime', 'duration', 'totalQuestions', 'correctAnswers', 'accuracy', 'percentage', 'score', 'questionTypeErrorCounts', 'dataSource', 'metadata', 'suite', 'suiteEntrySummaries']);
    const ANNOTATION_FIELDS = new Set(['markedQuestions', 'highlights', 'notes', 'noteOutlines', 'noteText', 'scrollY', 'interactions', 'annotations']);

    function withoutRawData(value) {
        if (Array.isArray(value)) return value.map(withoutRawData);
        if (!value || typeof value !== 'object') return clone(value);
        const clean = {};
        for (const [key, item] of Object.entries(value)) {
            if (key !== 'realData' && key !== 'rawData') clean[key] = withoutRawData(item);
        }
        return clean;
    }

    function splitPracticeRecord(input) {
        const source = canonicalizeRecord(input);
        const summary = lightFromCanonical(source);
        const detail = { recordId: source.id };
        const annotations = { recordId: source.id };
        for (const [key, value] of Object.entries(source)) {
            if (key === 'realData' || key === 'rawData' || key === 'answerMap' || key === 'answerList' || SUMMARY_FIELDS.has(key)) continue;
            if (ANNOTATION_FIELDS.has(key)) annotations[key] = withoutRawData(value);
            else if (key === 'suiteEntries') detail.suiteEntries = asArray(value).map((entry) => {
                const next = Object.assign({}, asObject(entry));
                const replaySource = Object.assign({}, asObject(next.rawData), asObject(next.realData));
                for (const replayKey of [
                    'answers', 'correctAnswerMap', 'answerComparison', 'answerDetails', 'scoreInfo', 'questionTypePerformance',
                    'startTime', 'startedAt', 'endTime', 'completedAt', 'timestamp', 'date',
                    'duration', 'durationSeconds', 'duration_seconds', 'elapsedSeconds', 'elapsed_seconds', 'timeSpent', 'time_spent'
                ]) {
                    if (!hasOwn(next, replayKey) && hasOwn(replaySource, replayKey)) next[replayKey] = clone(replaySource[replayKey]);
                }
                const annotation = {};
                for (const annotationKey of ANNOTATION_FIELDS) {
                    if (hasOwn(next, annotationKey)) { annotation[annotationKey] = next[annotationKey]; delete next[annotationKey]; }
                    if (next.realData && hasOwn(next.realData, annotationKey)) delete next.realData[annotationKey];
                    if (next.rawData && hasOwn(next.rawData, annotationKey)) delete next.rawData[annotationKey];
                }
                delete next.realData; delete next.rawData;
                if (Object.keys(annotation).length) {
                    if (!annotations.suiteEntries) annotations.suiteEntries = {};
                    annotations.suiteEntries[String(next.examId || asObject(next.metadata).examId || next.id || Object.keys(annotations.suiteEntries).length)] = annotation;
                }
                return withoutRawData(next);
            });
            else detail[key] = withoutRawData(value);
        }
        // Accept the old mirror only as an input normalization boundary; it is never persisted.
        const realData = asObject(source.realData); const rawData = asObject(source.rawData);
        for (const key of ['answers', 'correctAnswerMap', 'answerComparison', 'answerDetails', 'scoreInfo', 'questionTypePerformance']) {
            if (!hasOwn(detail, key)) detail[key] = firstNonEmpty(source[key], realData[key], rawData[key]);
        }
        for (const key of ANNOTATION_FIELDS) {
            if (hasOwn(annotations, key)) continue;
            if (hasOwn(realData, key)) annotations[key] = withoutRawData(realData[key]);
            else if (hasOwn(rawData, key)) annotations[key] = withoutRawData(rawData[key]);
        }
        return { summary: jsonValue(summary, 'practice summary'), detail: jsonValue(detail, 'practice detail'), annotations: jsonValue(annotations, 'practice annotations') };
    }

    function joinPracticeRecord(summary, detail, annotations, projection = 'full') {
        if (!summary) return null;
        const mode = String(projection || 'full').toLowerCase();
        const light = clone(summary);
        if (mode === 'light' || mode === 'summary') return light;
        const joined = Object.assign({}, light, clone(asObject(detail)));
        delete joined.recordId;
        if (mode === 'detail' || mode === 'medium') return jsonValue(joined, 'practice detail projection');
        const annotationData = asObject(annotations);
        for (const [key, value] of Object.entries(annotationData)) if (key !== 'recordId' && key !== 'suiteEntries') joined[key] = clone(value);
        if (Array.isArray(joined.suiteEntries)) {
            const suiteAnnotations = asObject(annotationData.suiteEntries);
            joined.suiteEntries = joined.suiteEntries.map((entry) => Object.assign({}, entry, clone(suiteAnnotations[String(entry.examId || asObject(entry.metadata).examId || entry.id)] || {})));
        }
        return jsonValue(joined, 'practice full projection');
    }

    function projectDetail(record) { return joinPracticeRecord(splitPracticeRecord(record).summary, splitPracticeRecord(record).detail, null, 'detail'); }

    // “什么算真实练习记录”只有一份定义（js/data/practiceRecordSource.js）。
    // 这里必须硬性依赖而不是本地兜底：曾经投影器与 js/main.js 各写一套判定，
    // 导致演示/种子记录在列表里看不见却计入统计与成就。缺失即启动失败，
    // 让漏配 bundle 在开发期就暴露，而不是运行时静默退回旧语义。
    const practiceRecordSource = global.PracticeRecordSource;
    if (!practiceRecordSource || typeof practiceRecordSource.isRealPracticeRecord !== 'function') {
        throw new Error('AppData v2 requires PracticeRecordSource (js/data/practiceRecordSource.js)');
    }
    const isRealPracticeRecord = practiceRecordSource.isRealPracticeRecord;

    function computeStats(records) {
        const stats = defaultStats();
        for (const record of asArray(records).filter(isRealPracticeRecord)) {
            const summary = projectLight(record);
            const type = String(summary.type || '').toLowerCase();
            const target = type.includes('listen') ? stats.listening : stats.reading;
            stats.totalPractices += 1;
            stats.totalQuestions += summary.totalQuestions;
            stats.correctAnswers += summary.correctAnswers;
            target.practices += 1;
            target.questions += summary.totalQuestions;
            target.correct += summary.correctAnswers;
        }
        stats.averageAccuracy = stats.totalQuestions ? (stats.correctAnswers / stats.totalQuestions) * 100 : 0;
        for (const target of [stats.reading, stats.listening]) target.accuracy = target.questions ? (target.correct / target.questions) * 100 : 0;
        stats.lastUpdated = nowIso();
        return stats;
    }

    function validIso(value) {
        if (value === null || value === undefined || value === '') return null;
        const time = new Date(value).getTime();
        return Number.isFinite(time) ? new Date(time).toISOString() : null;
    }

    function practiceType(record) {
        const metadata = asObject(record.metadata);
        const hints = [record.type, record.practiceType, metadata.type, metadata.examType, metadata.practiceType,
            record.examId, record.title, metadata.examId, metadata.title].filter(Boolean).join(' ').toLowerCase();
        if (hints.includes('listen') || hints.includes('audio') || hints.includes('hearing')) return 'listening';
        if (hints.includes('read')) return 'reading';
        return null;
    }

    function accuracyRatio(record) {
        const summary = lightFromCanonical(record);
        const value = Number(summary.accuracy);
        if (!Number.isFinite(value)) return 0;
        return Math.max(0, Math.min(1, value > 1 ? value / 100 : value));
    }

    function durationSeconds(record) {
        const scoreInfo = asObject(record.scoreInfo);
        const realData = asObject(record.realData);
        const realScoreInfo = asObject(realData.scoreInfo);
        for (const value of [record.duration, realData.duration, scoreInfo.duration, scoreInfo.timeSpent, realScoreInfo.duration, realScoreInfo.timeSpent]) {
            const numeric = Number(value);
            if (Number.isFinite(numeric) && numeric >= 0) return numeric;
        }
        return 0;
    }

    function earlierUnlock(left, right) {
        const leftIso = validIso(left);
        const rightIso = validIso(right);
        if (!leftIso) return rightIso;
        if (!rightIso) return leftIso;
        return new Date(leftIso).getTime() <= new Date(rightIso).getTime() ? leftIso : rightIso;
    }

    function laterUnlock(left, right) {
        const leftIso = validIso(left);
        const rightIso = validIso(right);
        if (!leftIso) return rightIso;
        if (!rightIso) return leftIso;
        return new Date(leftIso).getTime() >= new Date(rightIso).getTime() ? leftIso : rightIso;
    }

    function computeAchievementProgress(records, manual, existing) {
        const items = asArray(records).filter(isRealPracticeRecord).map(canonicalizeRecord)
            .map((record, index) => ({
                record,
                index,
                unlockedAt: validIso(record.completedAt || record.timestamp),
                time: new Date(record.completedAt || record.timestamp).getTime()
            }))
            .sort((left, right) => {
                const leftTime = Number.isFinite(left.time) ? left.time : Number.MAX_SAFE_INTEGER;
                const rightTime = Number.isFinite(right.time) ? right.time : Number.MAX_SAFE_INTEGER;
                return leftTime - rightTime || left.index - right.index;
            });
        const candidates = {};
        const setThreshold = (id, list, count) => {
            if (list.length >= count) candidates[id] = list[count - 1].unlockedAt;
        };
        setThreshold('first_step', items, 1);
        setThreshold('practice_bronze', items, 10);
        setThreshold('practice_silver', items, 50);
        setThreshold('practice_gold', items, 100);
        setThreshold('practice_platinum', items, 200);

        const reading = items.filter((item) => practiceType(item.record) === 'reading');
        const listening = items.filter((item) => practiceType(item.record) === 'listening');
        setThreshold('reading_first', reading, 1);
        setThreshold('reading_bronze', reading, 10);
        setThreshold('reading_silver', reading, 50);
        setThreshold('reading_gold', reading, 100);
        setThreshold('listening_first', listening, 1);
        setThreshold('listening_bronze', listening, 10);
        setThreshold('listening_silver', listening, 50);
        setThreshold('listening_gold', listening, 100);
        if (reading.length >= 10 && listening.length >= 10) candidates.balanced_foundation = laterUnlock(reading[9].unlockedAt, listening[9].unlockedAt);
        if (reading.length >= 30 && listening.length >= 30) candidates.balanced_advanced = laterUnlock(reading[29].unlockedAt, listening[29].unlockedAt);

        let cumulativeDuration = 0;
        let cumulativeAccuracy = 0;
        let perfectCount = 0;
        let speedCount = 0;
        for (let index = 0; index < items.length; index += 1) {
            const item = items[index];
            const accuracy = accuracyRatio(item.record);
            const duration = durationSeconds(item.record);
            cumulativeDuration += duration;
            cumulativeAccuracy += accuracy;
            if (!Object.prototype.hasOwnProperty.call(candidates, 'time_focus_60') && cumulativeDuration >= 3600) candidates.time_focus_60 = item.unlockedAt;
            if (!Object.prototype.hasOwnProperty.call(candidates, 'time_focus_300') && cumulativeDuration >= 18000) candidates.time_focus_300 = item.unlockedAt;
            if (!Object.prototype.hasOwnProperty.call(candidates, 'time_focus_1000') && cumulativeDuration >= 60000) candidates.time_focus_1000 = item.unlockedAt;
            if (!Object.prototype.hasOwnProperty.call(candidates, 'accuracy_stable') && index + 1 >= 10 && cumulativeAccuracy / (index + 1) >= 0.7) candidates.accuracy_stable = item.unlockedAt;
            if (!Object.prototype.hasOwnProperty.call(candidates, 'accuracy_elite') && index + 1 >= 20 && cumulativeAccuracy / (index + 1) >= 0.85) candidates.accuracy_elite = item.unlockedAt;
            if (accuracy >= 1) {
                perfectCount += 1;
                if (!Object.prototype.hasOwnProperty.call(candidates, 'accuracy_perfect')) candidates.accuracy_perfect = item.unlockedAt;
                if (perfectCount === 3) candidates.perfect_three = item.unlockedAt;
                if (perfectCount === 10) candidates.perfect_ten = item.unlockedAt;
            }
            if (duration > 0 && duration <= 300 && accuracy > 0.8) {
                speedCount += 1;
                if (!Object.prototype.hasOwnProperty.call(candidates, 'speed_demon')) candidates.speed_demon = item.unlockedAt;
                if (speedCount === 3) candidates.speed_three = item.unlockedAt;
                if (speedCount === 10) candidates.speed_ten = item.unlockedAt;
            }
        }

        const dayItems = new Map();
        for (const item of items) {
            if (!item.unlockedAt) continue;
            const day = item.unlockedAt.slice(0, 10);
            if (!dayItems.has(day)) dayItems.set(day, item.unlockedAt);
        }
        const days = Array.from(dayItems.keys()).sort();
        let streak = 0;
        let previousDay = null;
        for (const day of days) {
            const currentDay = new Date(`${day}T00:00:00.000Z`).getTime();
            streak = previousDay !== null && currentDay - previousDay === 86400000 ? streak + 1 : 1;
            previousDay = currentDay;
            if (streak === 3 && !Object.prototype.hasOwnProperty.call(candidates, 'streak_bronze')) candidates.streak_bronze = dayItems.get(day);
            if (streak === 7 && !Object.prototype.hasOwnProperty.call(candidates, 'streak_silver')) candidates.streak_silver = dayItems.get(day);
            if (streak === 30 && !Object.prototype.hasOwnProperty.call(candidates, 'streak_gold')) candidates.streak_gold = dayItems.get(day);
            if (streak === 60 && !Object.prototype.hasOwnProperty.call(candidates, 'streak_platinum')) candidates.streak_platinum = dayItems.get(day);
        }

        const progress = {};
        const mergeUnlocked = (source) => {
            for (const [rawId, value] of Object.entries(asObject(source))) {
                if (!value || rawId === 'updatedAt') continue;
                const id = rawId;
                const unlockedAt = value && typeof value === 'object' ? validIso(value.unlockedAt) : null;
                if (!progress[id]) progress[id] = { unlockedAt };
                else progress[id].unlockedAt = earlierUnlock(progress[id].unlockedAt, unlockedAt);
            }
        };
        mergeUnlocked(existing);
        mergeUnlocked(manual);
        for (const [id, unlockedAt] of Object.entries(candidates)) {
            if (!progress[id]) progress[id] = { unlockedAt: validIso(unlockedAt) };
            else progress[id].unlockedAt = earlierUnlock(progress[id].unlockedAt, unlockedAt);
        }
        return jsonValue(progress, 'achievement progress');
    }

    // Entity records are authoritative. Projections are assembled on reads, never cached or
    // scheduled as follow-up work; this keeps a successful write immediately observable.
    async function retryMergeConflict(options, task, maxAttempts = 3) {
        const explicitRevision = hasOwn(options, 'expectedRevision');
        let lastError;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            try {
                return await task();
            } catch (error) {
                lastError = error;
                if (explicitRevision || !error || error.code !== 'CONFLICT' || attempt + 1 >= maxAttempts) {
                    throw error;
                }
            }
        }
        throw lastError;
    }

    async function readCollectionMeta(logicalKey) {
        const meta = await kernel.read(logicalKey, { withMeta: true });
        return { items: asArray(meta.data), revision: meta.envelope ? Number(meta.envelope.revision) : 0 };
    }

    function retainBackupEntries(items, limit = 20, preserveIds = []) {
        const cap = Math.max(1, Number(limit) || 20);
        const newestFirst = (left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || ''));
        const entries = asArray(items).filter(Boolean).sort(newestFirst);
        const retained = [];
        const retainedIds = new Set();
        const requestedIds = new Set(asArray(preserveIds).map(String).filter(Boolean));
        for (const item of entries) {
            const id = String(item.id);
            if (retained.length >= cap || retainedIds.has(id) || !requestedIds.has(id)) continue;
            retained.push(item);
            retainedIds.add(id);
        }
        for (const item of entries) {
            const id = String(item.id);
            if (retained.length >= cap) break;
            if (retainedIds.has(id)) continue;
            retained.push(item);
            retainedIds.add(id);
        }
        return retained;
    }

    function hasOwn(value, key) {
        return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
    }

    function normalizeLibraryConfigurationId(value) {
        return importedLibraryId(value, { nullable: true });
    }

    async function practiceRecordWithLibraryProvenance(source, command, options = {}) {
        assertObject(source, 'practice record must be an object');
        const record = jsonValue(source, 'practice record');
        const metadata = asObject(record.metadata);
        let configurationId;

        if (hasOwn(command, 'libraryConfigurationId')) {
            configurationId = command.libraryConfigurationId;
        } else if (hasOwn(metadata, 'libraryConfigurationId')) {
            configurationId = metadata.libraryConfigurationId;
        } else if (hasOwn(record, 'libraryConfigurationId')) {
            configurationId = record.libraryConfigurationId;
        } else {
            configurationId = await kernel.read('library.activeConfigurationId');
        }

        const normalizedId = normalizeLibraryConfigurationId(configurationId);
        record.metadata = Object.assign({}, metadata, { libraryConfigurationId: normalizedId });

        if (options.includeSuiteEntries && Array.isArray(record.suiteEntries)) {
            record.suiteEntries = record.suiteEntries.map((entry) => {
                if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
                const next = jsonValue(entry, 'practice suite entry');
                const entryMetadata = asObject(next.metadata);
                const entryId = hasOwn(entryMetadata, 'libraryConfigurationId')
                    ? normalizeLibraryConfigurationId(entryMetadata.libraryConfigurationId)
                    : normalizedId;
                next.metadata = Object.assign({}, entryMetadata, { libraryConfigurationId: entryId });
                return next;
            });
        }

        return record;
    }

    function practiceRecordMatches(record, identities) {
        const expected = new Set(asArray(identities).map((value) => String(value || '')).filter(Boolean));
        if (!expected.size || !record || typeof record !== 'object') return false;
        return ['id', 'recordId', 'sessionId'].some((field) => {
            const value = record[field];
            return value !== undefined && value !== null && expected.has(String(value));
        });
    }

    function practiceLayerId(row) {
        return String(row && (row.recordId || row.id || row.sessionId) || '');
    }
    async function practiceLayers(recordId, withMeta = false) {
        const snapshot = await kernel.readPracticeSnapshot([recordId], { withMeta });
        const find = (store) => asArray(snapshot[store]).find((row) => practiceLayerId(row) === String(recordId)) || null;
        return { summary: find('practiceSummaries'), detail: find('practiceDetails'), annotations: find('practiceAnnotations') };
    }
    async function practiceLayersForUpsert(recordId) {
        const layers = await practiceLayers(recordId, true);
        if (typeof kernel.getEntityRevision !== 'function') return layers;
        for (const [field, store] of [
            ['summary', 'practiceSummaries'],
            ['detail', 'practiceDetails'],
            ['annotations', 'practiceAnnotations']
        ]) {
            if (layers[field]) continue;
            const info = await kernel.getEntityRevision(store, recordId, { withPresence: true });
            const revision = typeof info === 'number' ? info : Number(info && info.revision) || 0;
            if (info && typeof info === 'object' && info.present === true) {
                throw new AppDataError('CONFLICT', `Practice record appeared while preparing ${recordId}`, {
                    store,
                    recordId: String(recordId)
                });
            }
            if (revision > 0) layers[field] = { recordId: String(recordId), revision, deleted: true, data: null };
        }
        return layers;
    }
    function entityRevision(row) { return row ? Number(row.revision) : 0; }
    function practiceUpserts(recordId, layers, existing = {}) {
        return [
            { type: 'upsert', store: 'practiceSummaries', recordId, data: layers.summary, expectedRevision: entityRevision(existing.summary) },
            { type: 'upsert', store: 'practiceDetails', recordId, data: layers.detail, expectedRevision: entityRevision(existing.detail) },
            { type: 'upsert', store: 'practiceAnnotations', recordId, data: layers.annotations, expectedRevision: entityRevision(existing.annotations) }
        ];
    }
    async function joinedPractice(recordId, projection, snapshot = null) {
        const mode = String(projection || 'full').toLowerCase();
        const stores = mode === 'light' || mode === 'summary'
            ? ['practiceSummaries']
            : (mode === 'detail' || mode === 'medium' ? ['practiceSummaries', 'practiceDetails'] : undefined);
        const layers = snapshot || await kernel.readPracticeSnapshot([recordId], { stores });
        const find = (store) => asArray(layers[store]).find((row) => practiceLayerId(row) === String(recordId)) || null;
        const summary = find('practiceSummaries');
        if (!summary) return null;
        if (mode === 'light' || mode === 'summary') return clone(summary);
        const detail = find('practiceDetails');
        if (mode === 'detail' || mode === 'medium') return joinPracticeRecord(summary, detail, null, mode);
        return joinPracticeRecord(summary, detail, find('practiceAnnotations'), mode);
    }
    const practice = Object.freeze({
        async list(options = {}) {
            await ready;
            const projection = String(options.projection || 'full').toLowerCase();
            const summaries = await kernel.listEntities('practiceSummaries');
            if (projection === 'light' || projection === 'summary') return summaries;
            const stores = projection === 'detail' || projection === 'medium'
                ? ['practiceSummaries', 'practiceDetails']
                : undefined;
            const snapshot = await kernel.readPracticeSnapshot(null, { stores });
            return (await Promise.all(asArray(snapshot.practiceSummaries)
                .map((summary) => joinedPractice(practiceLayerId(summary), projection, snapshot)))).filter(Boolean);
        },
        async get(recordId, options = {}) { await ready; return joinedPractice(String(recordId || ''), options.projection || 'full'); },
        async completeAttempt(command) {
            await ready;
            const source = command && (command.record || command.attempt) ? (command.record || command.attempt) : command;
            const mutation = mutationOptions(command, 'practice-complete', source);
            const recordInput = await practiceRecordWithLibraryProvenance(source, command);
            if (!idOf(recordInput, ['id', 'recordId', 'sessionId'])) recordInput.id = deterministicEntityId('record', mutation.operationId);
            const layers = splitPracticeRecord(recordInput); const recordId = layers.summary.id;
            const receipt = await retryMergeConflict(command || {}, async () => kernel.mutateEntities(
                practiceUpserts(recordId, layers, await practiceLayersForUpsert(recordId)), mutation));
            return Object.assign({}, receipt, { record: await joinedPractice(recordId, 'full') });
        },
        async finalizeSuite(command) {
            await ready; assertObject(command, 'finalizeSuite command is required');
            const mutation = mutationOptions(command, 'practice-suite', command);
            const input = await practiceRecordWithLibraryProvenance(command.record || command.aggregate || command, command, { includeSuiteEntries: true });
            if (!idOf(input, ['id', 'recordId', 'sessionId'])) input.id = deterministicEntityId('suite', mutation.operationId);
            const layers = splitPracticeRecord(input); const recordId = layers.summary.id;
            const childIdentities = asArray(command.childRecordIds || command.childSessionIds).map(String);
            const children = new Set((await kernel.listEntities('practiceSummaries'))
                .filter((summary) => practiceRecordMatches(summary, childIdentities))
                .map((summary) => idOf(summary, ['id', 'recordId', 'sessionId'])));
            children.delete(recordId);
            const receipt = await retryMergeConflict(command, async () => {
                const existing = await practiceLayersForUpsert(recordId);
                const deletes = Array.from(children).flatMap((id) => ['practiceSummaries', 'practiceDetails', 'practiceAnnotations'].map((store) => ({ type: 'delete', store, recordId: id })));
                return kernel.mutateEntities(deletes.concat(practiceUpserts(recordId, layers, existing)), mutation);
            });
            return Object.assign({}, receipt, { record: await joinedPractice(recordId, 'full') });
        },
        async updateAnnotations(command) {
            await ready; assertObject(command, 'updateAnnotations command is required'); const recordId = String(command.recordId || '');
            return retryMergeConflict(command, async () => {
                const current = await practiceLayers(recordId, true); if (!current.summary) throw new AppDataError('VALIDATION', `Unknown practice record: ${recordId}`);
                if (command.expectedRevision !== undefined && Number(command.expectedRevision) !== entityRevision(current.annotations)) throw new AppDataError('CONFLICT', `Revision conflict for practice annotations ${recordId}`);
                const annotations = Object.assign({ recordId }, clone(asObject(current.annotations && current.annotations.data)));
                const detail = clone(asObject(current.detail && current.detail.data)); const examId = String(command.examId || current.summary.data.examId || 'default');
                if (Array.isArray(detail.suiteEntries) && detail.suiteEntries.length) {
                    if (!detail.suiteEntries.some((entry) => String(entry.examId || asObject(entry.metadata).examId || '') === examId)) throw new AppDataError('VALIDATION', `Suite record ${recordId} does not contain exam ${examId}`);
                    annotations.suiteEntries = Object.assign({}, asObject(annotations.suiteEntries), { [examId]: Object.assign({}, asObject(annotations.suiteEntries)[examId], clone(asObject(command.patch))) });
                } else {
                    if (current.summary.data.examId && String(current.summary.data.examId) !== examId) throw new AppDataError('VALIDATION', `Record ${recordId} does not match exam ${examId}`);
                    annotations.annotations = Object.assign({}, asObject(annotations.annotations), { [examId]: Object.assign({}, asObject(annotations.annotations)[examId], clone(asObject(command.patch))) });
                    Object.assign(annotations, clone(asObject(command.patch)));
                }
                return kernel.mutateEntities([{
                    type: 'upsert',
                    store: 'practiceAnnotations',
                    recordId,
                    data: annotations,
                    expectedRevision: entityRevision(current.annotations)
                }], mutationOptions(command, 'practice-annotations', command));
            });
        },
        async delete(command) {
            await ready; const recordId = String(command && (command.recordId || command.id) || command || ''); if (!recordId) throw new AppDataError('VALIDATION', 'practice record id is required');
            const found = await kernel.readEntity('practiceSummaries', recordId); if (!found) return Object.assign(await kernel.journalNoop(mutationOptions(command, 'practice-delete', { recordId })), { deletedCount: 0, noop: true });
            const receipt = await kernel.mutateEntities(['practiceSummaries', 'practiceDetails', 'practiceAnnotations'].map((store) => ({ type: 'delete', store, recordId })), mutationOptions(command, 'practice-delete', { recordId }));
            return Object.assign({}, receipt, { deletedCount: 1 });
        },
        async deleteMany(command) {
            await ready; assertObject(command, 'practice.deleteMany command is required'); const recordIds = Array.from(new Set(asArray(command.recordIds).map(String).filter(Boolean)));
            if (!recordIds.length) throw new AppDataError('VALIDATION', 'practice.deleteMany requires recordIds'); const summaries = await kernel.listEntities('practiceSummaries'); const ids = recordIds.filter((id) => summaries.some((item) => practiceRecordMatches(item, [id])));
            if (!ids.length) return Object.assign(await kernel.journalNoop(mutationOptions(command, 'practice-delete-many', { recordIds })), { deletedCount: 0, noop: true });
            const receipt = await kernel.mutateEntities(ids.flatMap((recordId) => ['practiceSummaries', 'practiceDetails', 'practiceAnnotations'].map((store) => ({ type: 'delete', store, recordId }))), mutationOptions(command, 'practice-delete-many', { recordIds })); return Object.assign({}, receipt, { deletedCount: ids.length });
        },
        async clear(command = {}) { await ready; return kernel.mutateEntities(['practiceSummaries', 'practiceDetails', 'practiceAnnotations'].map((store) => ({ type: 'clear', store })), mutationOptions(command, 'practice-clear', { all: true })); },
        async listInsights(options = {}) {
            await ready;
            const limit = Math.max(1, Math.min(50, Number(options.limit) || 10));
            const summaries = (await kernel.listEntities('practiceSummaries'))
                .slice()
                .sort((left, right) => String(right.date || right.completedAt || right.timestamp || '')
                    .localeCompare(String(left.date || left.completedAt || left.timestamp || '')))
                .slice(0, limit);
            return Promise.all(summaries.map(async (summary) => {
                if (Object.keys(asObject(summary.questionTypeErrorCounts)).length) return clone(summary);
                const detail = await kernel.readEntity('practiceDetails', summary.id);
                return jsonValue(Object.assign({}, clone(summary), {
                    questionTypeErrorCounts: questionTypeErrorCounts(detail)
                }), 'practice insight');
            }));
        },
        async getStats() { await ready; return computeStats(await kernel.listEntities('practiceSummaries')); },
        projectLight,
        projectDetail
    });

    const settings = Object.freeze({
        async getAll() { await ready; return kernel.read('settings.values'); },
        async patch(values, options = {}) {
            await ready; assertObject(values, 'settings.patch requires an object');
            const mutation = optionsMutationOptions(options, 'settings-patch', values);
            return retryMergeConflict(options, async () => {
                const current = await kernel.read('settings.values', { withMeta: true });
                return kernel.mutate([{ logicalKey: 'settings.values', data: Object.assign({}, asObject(current.data), clone(values)), expectedRevision: options.expectedRevision ?? (current.envelope ? current.envelope.revision : 0) }], mutation);
            });
        },
        async reset(options = {}) { await ready; const current = await kernel.read('settings.values', { withMeta: true }); return kernel.mutate([{ logicalKey: 'settings.values', state: 'cleared', expectedRevision: options.expectedRevision ?? (current.envelope ? current.envelope.revision : 0) }], optionsMutationOptions(options, 'settings-reset', { reset: true })); }
    });

    const library = Object.freeze({
        async listConfigurations() { await ready; return kernel.read('library.configurations'); },
        async getActive() { await ready; return kernel.read('library.activeConfigurationId'); },
        async getIndex(configurationId) {
            await ready;
            const id = importedLibraryId(configurationId, { nullable: true });
            if (id === null) return [];
            const indexes = await kernel.read('library.importedIndexes');
            return asArray(indexes[id]);
        },
        async updateConfiguration(configuration, options = {}) {
            await ready; assertObject(configuration, 'library.updateConfiguration requires an object');
            const id = importedLibraryId(idOf(configuration, ['id', 'key', 'configId']));
            const current = await kernel.read('library.configurations', { withMeta: true });
            const configs = asArray(current.data);
            const index = configs.findIndex((item) => idOf(item, ['id', 'key', 'configId']) === id);
            const next = Object.assign({}, index >= 0 ? configs[index] : {}, clone(configuration), { id, key: id });
            if (index >= 0) configs[index] = next; else configs.push(next);
            return kernel.mutate([{ logicalKey: 'library.configurations', data: configs, expectedRevision: current.envelope ? current.envelope.revision : 0 }], optionsMutationOptions(options, 'library-config', configuration));
        },
        async activate(configurationId, options = {}) {
            await ready;
            const id = importedLibraryId(configurationId, { nullable: true });
            const current = await kernel.read('library.activeConfigurationId', { withMeta: true });
            return kernel.mutate([{ logicalKey: 'library.activeConfigurationId', data: id, expectedRevision: current.envelope ? current.envelope.revision : 0 }], optionsMutationOptions(options, 'library-activate', { configurationId: id }));
        },
        async import(command) {
            await ready; assertObject(command, 'library.import requires a command');
            const id = importedLibraryId(command.id || command.configurationId || randomId('library'));
            const configsMeta = await kernel.read('library.configurations', { withMeta: true });
            const indexesMeta = await kernel.read('library.importedIndexes', { withMeta: true });
            const configs = asArray(configsMeta.data).filter((item) => idOf(item, ['id', 'key', 'configId']) !== id);
            configs.push(Object.assign({}, asObject(command.configuration), { id, key: id }));
            const indexes = Object.assign({}, asObject(indexesMeta.data), { [id]: asArray(command.index) });
            return kernel.mutate([
                { logicalKey: 'library.configurations', data: configs, expectedRevision: configsMeta.envelope ? configsMeta.envelope.revision : 0 },
                { logicalKey: 'library.importedIndexes', data: indexes, expectedRevision: indexesMeta.envelope ? indexesMeta.envelope.revision : 0 }
            ], mutationOptions(command, 'library-import', command));
        },
        async remove(configurationId, options = {}) {
            await ready; const id = importedLibraryId(configurationId);
            const configsMeta = await kernel.read('library.configurations', { withMeta: true });
            const indexesMeta = await kernel.read('library.importedIndexes', { withMeta: true });
            const activeMeta = await kernel.read('library.activeConfigurationId', { withMeta: true });
            const indexes = Object.assign({}, asObject(indexesMeta.data)); delete indexes[id];
            const changes = [
                { logicalKey: 'library.configurations', data: asArray(configsMeta.data).filter((item) => idOf(item, ['id', 'key', 'configId']) !== id), expectedRevision: configsMeta.envelope ? configsMeta.envelope.revision : 0 },
                { logicalKey: 'library.importedIndexes', data: indexes, expectedRevision: indexesMeta.envelope ? indexesMeta.envelope.revision : 0 }
            ];
            if (String(activeMeta.data || '') === id) {
                changes.push({ logicalKey: 'library.activeConfigurationId', data: null, expectedRevision: activeMeta.envelope ? activeMeta.envelope.revision : 0 });
            }
            return kernel.mutate(changes, optionsMutationOptions(options, 'library-remove', { configurationId: id }));
        },
        async resolveIndex() {
            await ready;
            const [activeId, indexes] = await Promise.all([kernel.read('library.activeConfigurationId'), kernel.read('library.importedIndexes')]);
            return activeId && Array.isArray(asObject(indexes)[activeId]) ? clone(indexes[activeId]) : clone([]);
        }
    });

    function recoveryKey(kind) {
        const key = RECOVERY_KEYS[String(kind || '')];
        if (!key) throw new AppDataError('VALIDATION', `Unknown recovery kind: ${kind}`);
        return key;
    }
    // Recovery document TTL is an AppData domain rule, not a catalog policy field.
    const RECOVERY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    function recoveryTimestamp(item) {
        for (const field of ['updatedAt', 'lastActivity', 'tempSavedAt', 'timestamp', 'createdAt']) {
            const parsed = Date.parse(item && item[field]);
            if (Number.isFinite(parsed)) return parsed;
        }
        return null;
    }
    async function pruneRecoveryKey(logicalKey) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const current = await kernel.read(logicalKey, { withMeta: true });
            const items = asArray(current.data);
            const cutoff = Date.now() - RECOVERY_TTL_MS;
            const retained = items.filter((item) => {
                const timestamp = recoveryTimestamp(item);
                return timestamp === null || timestamp > cutoff;
            });
            if (retained.length === items.length) return items;
            try {
                await kernel.mutate([{ logicalKey, data: retained, expectedRevision: current.envelope ? current.envelope.revision : 0 }], {
                    operationId: randomId('recovery-ttl')
                });
                return retained;
            } catch (error) {
                if (!(error instanceof AppDataError) || error.code !== 'CONFLICT' || attempt === 2) throw error;
            }
        }
        return kernel.read(logicalKey);
    }
    async function cleanupExpiredRecovery() {
        for (const logicalKey of Object.values(RECOVERY_KEYS)) await pruneRecoveryKey(logicalKey);
    }
    const windowSession = Object.freeze({
        save(name, value) {
            if (!global.sessionStorage) throw new AppDataError('BACKEND_UNAVAILABLE', 'sessionStorage unavailable');
            const logicalName = String(name || 'default');
            const payload = { schemaVersion: catalog.version, updatedAt: nowIso(), data: clone(value) };
            global.sessionStorage.setItem(`ielts_atlas:v2:session:${logicalName}`, JSON.stringify(payload));
            return true;
        },
        get(name) {
            if (!global.sessionStorage) return null;
            const raw = global.sessionStorage.getItem(`ielts_atlas:v2:session:${String(name || 'default')}`);
            if (!raw) return null;
            const payload = JSON.parse(raw);
            return payload && payload.schemaVersion === catalog.version ? clone(payload.data) : null;
        },
        discard(name) {
            if (global.sessionStorage) global.sessionStorage.removeItem(`ielts_atlas:v2:session:${String(name || 'default')}`);
            return true;
        }
    });

    const recoveryMutationTails = new Map();
    function enqueueRecoveryMutation(logicalKey, task) {
        const previous = recoveryMutationTails.get(logicalKey) || Promise.resolve();
        const result = previous.then(task, task);
        recoveryMutationTails.set(logicalKey, result.catch(() => undefined));
        return result;
    }

    async function readRecovery(kind, id) {
        await ready;
        const items = await pruneRecoveryKey(recoveryKey(kind));
        return id == null ? items : items.find((item) => idOf(item, ['id', 'sessionId', 'recordId']) === String(id)) || null;
    }
    async function saveRecovery(kind, value, options = {}) {
        await ready; assertObject(value, `recovery ${kind} value must be an object`);
        const mutation = optionsMutationOptions(options, `recovery-${kind}-save`, value);
        const key = recoveryKey(kind);
        const id = idOf(value, ['id', 'sessionId', 'recordId']) || deterministicEntityId('recovery', mutation.operationId);
        const item = Object.assign({}, clone(value), { id: value.id || id, updatedAt: nowIso() });
        const receipt = await enqueueRecoveryMutation(key, () => retryMergeConflict(options, async () => {
            const current = await readCollectionMeta(key);
            const index = current.items.findIndex((entry) => idOf(entry, ['id', 'sessionId', 'recordId']) === id);
            if (index >= 0) current.items[index] = item; else current.items.push(item);
            return kernel.mutate([{ logicalKey: key, data: current.items, expectedRevision: current.revision }], mutation);
        }));
        const committedItem = (await kernel.read(key))
            .find((entry) => idOf(entry, ['id', 'sessionId', 'recordId']) === id);
        return Object.assign({}, receipt, { item: clone(committedItem || item) });
    }
    async function discardRecovery(kind, id, options = {}) {
        await ready;
        const key = recoveryKey(kind);
        const mutation = optionsMutationOptions(options, `recovery-${kind}-discard`, { id: String(id) });
        return enqueueRecoveryMutation(key, () => retryMergeConflict(options, async () => {
            const current = await readCollectionMeta(key);
            const next = current.items.filter((entry) => idOf(entry, ['id', 'sessionId', 'recordId']) !== String(id));
            return kernel.mutate([{ logicalKey: key, data: next, expectedRevision: current.revision }], mutation);
        }));
    }
    async function clearRecovery(kind, options = {}) {
        await ready;
        const key = recoveryKey(kind);
        const mutation = optionsMutationOptions(options, `recovery-${kind}-clear`, { kind });
        return enqueueRecoveryMutation(key, () => retryMergeConflict(options, async () => {
            const current = await readCollectionMeta(key);
            if (options.expectedRevision !== undefined && Number(options.expectedRevision) !== current.revision) {
                throw new AppDataError('CONFLICT', `Revision conflict while clearing recovery ${kind}`, { expectedRevision: options.expectedRevision, actualRevision: current.revision });
            }
            return kernel.mutate([{ logicalKey: key, state: 'cleared', expectedRevision: current.revision }], mutation);
        }));
    }
    async function clearAllRecovery(options = {}) {
        const results = {};
        for (const kind of Object.keys(RECOVERY_KEYS)) {
            results[kind] = await clearRecovery(kind, options);
        }
        return results;
    }
    const recovery = Object.freeze({
        windowSession,
        async clear(options = {}) { return clearAllRecovery(options); },
        async listActiveSessions() { return readRecovery('activeSession'); },
        async getActiveSession(id) { return readRecovery('activeSession', id); },
        async saveActiveSession(value, options) { return saveRecovery('activeSession', value, options); },
        async completeActiveSession(id, options) { return discardRecovery('activeSession', id, options); },
        async discardActiveSession(id, options) { return discardRecovery('activeSession', id, options); },
        async listDrafts() { return readRecovery('draft'); },
        async getDraft(id) { return readRecovery('draft', id); },
        async saveDraft(value, options) { return saveRecovery('draft', value, options); },
        async discardDraft(id, options) { return discardRecovery('draft', id, options); },
        async listInterrupted() { return readRecovery('interrupted'); },
        async getInterrupted(id) { return readRecovery('interrupted', id); },
        async saveInterrupted(value, options) { return saveRecovery('interrupted', value, options); },
        async discardInterrupted(id, options) { return discardRecovery('interrupted', id, options); },
        async listRejectedCompletions() { return readRecovery('rejectedCompletion'); },
        async getRejectedCompletion(id) { return readRecovery('rejectedCompletion', id); },
        async saveRejectedCompletion(value, options) { return saveRecovery('rejectedCompletion', value, options); },
        async discardRejectedCompletion(id, options) { return discardRecovery('rejectedCompletion', id, options); }
    });

    function isImportableEntry(entry) {
        return entry
            && entry.classification !== 'system'
            && entry.classification !== 'session'
            && entry.import !== 'ignore';
    }

    function isPlainImportObject(value) {
        return Boolean(value && typeof value === 'object' && !Array.isArray(value));
    }

    function fallbackCanonicalizeSnapshotJson(value, path = '$', ancestors = new Set()) {
        if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) throw new AppDataError('VALIDATION', `Non-finite number at ${path}`, { path });
            return Object.is(value, -0) ? 0 : value;
        }
        if (typeof value !== 'object' || value === undefined || typeof value === 'bigint'
            || typeof value === 'function' || typeof value === 'symbol') {
            throw new AppDataError('VALIDATION', `Non-JSON value at ${path}`, { path, type: typeof value });
        }
        if (ancestors.has(value)) throw new AppDataError('VALIDATION', `Cyclic data at ${path}`, { path });
        const prototype = Object.getPrototypeOf(value);
        if (!Array.isArray(value) && prototype !== null) {
            const constructor = Object.prototype.hasOwnProperty.call(prototype, 'constructor')
                ? prototype.constructor
                : null;
            if (typeof constructor !== 'function' || constructor.name !== 'Object') {
                throw new AppDataError('VALIDATION', `Non-plain object at ${path}`, { path });
            }
        }
        if (typeof Reflect === 'object' && typeof Reflect.ownKeys === 'function'
            && Reflect.ownKeys(value).some((key) => typeof key === 'symbol')) {
            throw new AppDataError('VALIDATION', `Symbol-keyed property at ${path}`, { path });
        }
        ancestors.add(value);
        try {
            if (Array.isArray(value)) {
                const result = new Array(value.length);
                for (let index = 0; index < value.length; index += 1) {
                    if (!Object.prototype.hasOwnProperty.call(value, index)) {
                        throw new AppDataError('VALIDATION', `Sparse array entry at ${path}[${index}]`, { path });
                    }
                    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
                    if (!descriptor || descriptor.get || descriptor.set) {
                        throw new AppDataError('VALIDATION', `Accessor property at ${path}[${index}]`, { path });
                    }
                    result[index] = fallbackCanonicalizeSnapshotJson(descriptor.value, `${path}[${index}]`, ancestors);
                }
                return result;
            }
            const result = {};
            for (const key of Object.keys(value).sort()) {
                const descriptor = Object.getOwnPropertyDescriptor(value, key);
                if (!descriptor || descriptor.get || descriptor.set) {
                    throw new AppDataError('VALIDATION', `Accessor property at ${path}.${key}`, { path });
                }
                result[key] = fallbackCanonicalizeSnapshotJson(descriptor.value, `${path}.${key}`, ancestors);
            }
            return result;
        } finally { ancestors.delete(value); }
    }

    function canonicalizeSnapshotJson(value, path = '$') {
        return typeof kernelCanonicalizeJson === 'function'
            ? kernelCanonicalizeJson(value, path)
            : fallbackCanonicalizeSnapshotJson(value, path);
    }

    function snapshotValidation(message, details) {
        return new AppDataError('VALIDATION', message, details || {});
    }

    function assertSnapshotEnvelope(logicalKey, envelope) {
        const entry = catalog.get(logicalKey);
        try {
            if (typeof internals.validateEnvelope === 'function' && !internals.validateEnvelope(entry, envelope)) {
                throw snapshotValidation(`Invalid snapshot envelope: ${logicalKey}`, { logicalKey });
            }
        } catch (error) {
            if (error && error.code === 'VALIDATION') throw error;
            throw snapshotValidation(`Invalid snapshot envelope: ${logicalKey}`, {
                logicalKey,
                cause: error && error.message
            });
        }
        canonicalizeSnapshotJson(envelope, `$.envelopes.${logicalKey}`);
        if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
            || Number(envelope.schemaVersion) !== Number(entry.schemaVersion)
            || !Number.isSafeInteger(Number(envelope.revision)) || Number(envelope.revision) < 1 || Number(envelope.revision) >= Number.MAX_SAFE_INTEGER
            || typeof envelope.operationId !== 'string' || !envelope.operationId.trim()
            || typeof envelope.updatedAt !== 'string' || !envelope.updatedAt.trim()
            || (envelope.state !== 'present' && envelope.state !== 'cleared')) {
            throw snapshotValidation(`Invalid snapshot envelope: ${logicalKey}`, { logicalKey });
        }
        const data = canonicalizeSnapshotJson(envelope.data, `$.envelopes.${logicalKey}.data`);
        if ((envelope.state === 'cleared' && data !== null)
            || (envelope.state === 'present' && !entry.validate(data))) {
            throw snapshotValidation(`Invalid snapshot envelope data: ${logicalKey}`, { logicalKey });
        }
        if (typeof envelope.checksum !== 'string' || envelope.checksum !== checksum(data)) {
            throw snapshotValidation(`Invalid snapshot envelope checksum: ${logicalKey}`, { logicalKey });
        }
        return envelope;
    }

    function assertSnapshotEntityRow(store, row) {
        const path = `$.entities.${store}`;
        canonicalizeSnapshotJson(row, path);
        if (!row || typeof row !== 'object' || Array.isArray(row)
            || typeof row.recordId !== 'string' || !row.recordId.trim()
            || !Number.isSafeInteger(Number(row.revision)) || Number(row.revision) < 1 || Number(row.revision) >= Number.MAX_SAFE_INTEGER
            || typeof row.operationId !== 'string' || !row.operationId.trim()
            || typeof row.updatedAt !== 'string' || !row.updatedAt.trim()) {
            throw snapshotValidation(`Invalid snapshot entity: ${store}`, { store, recordId: row && row.recordId || null });
        }
        const data = canonicalizeSnapshotJson(row.data, `${path}.${row.recordId}.data`);
        const identityField = store === 'practiceSummaries' ? 'id' : 'recordId';
        if (!isPlainImportObject(data)
            || typeof data[identityField] !== 'string'
            || data[identityField] !== row.recordId) {
            throw snapshotValidation(`Invalid snapshot entity identity: ${store}/${row.recordId}`, {
                store,
                recordId: row.recordId,
                identityField
            });
        }
        if (typeof row.checksum !== 'string' || row.checksum !== checksum(data)) {
            throw snapshotValidation(`Invalid snapshot entity checksum: ${store}/${row.recordId}`, {
                store,
                recordId: row.recordId
            });
        }
        if (typeof kernelValidateEntityRow === 'function') {
            try { kernelValidateEntityRow(store, row); }
            catch (error) {
                throw snapshotValidation(`Invalid snapshot entity: ${store}/${row.recordId}`, {
                    store,
                    recordId: row.recordId,
                    cause: error && error.message
                });
            }
        }
        return row;
    }

    function assertSnapshotPracticeEntitySets(entities) {
        const presentStores = PRACTICE_ENTITY_STORES.filter((store) => hasOwn(entities, store));
        if (!presentStores.length) return;
        if (presentStores.length !== PRACTICE_ENTITY_STORES.length) {
            throw snapshotValidation('Practice import entity layers must contain summaries, details, and annotations');
        }
        const expected = practiceEntityIds(entities.practiceSummaries);
        for (const store of PRACTICE_ENTITY_STORES.slice(1)) {
            const actual = practiceEntityIds(entities[store]);
            if (actual.size !== expected.size || Array.from(expected).some((recordId) => !actual.has(recordId))) {
                throw snapshotValidation('Practice import entity layers must contain the same recordIds', {
                    counts: Object.fromEntries(PRACTICE_ENTITY_STORES.map((name) => [name, practiceEntityIds(entities[name]).size]))
                });
            }
        }
    }

    function assertV2Snapshot(snapshot) {
        const parsed = canonicalizeSnapshotJson(snapshot, '$');
        if (!isPlainImportObject(parsed)
            || parsed.format !== 'ielts-atlas-data-v2'
            || Number(parsed.schemaVersion) !== Number(catalog.version)
            || !isPlainImportObject(parsed.envelopes)
            || !isPlainImportObject(parsed.entities)
            || (parsed.scope !== 'full' && parsed.scope !== 'partial')
            || typeof parsed.checksum !== 'string' || !parsed.checksum) {
            throw snapshotValidation('Snapshot is invalid');
        }
        for (const logicalKey of Object.keys(parsed.envelopes)) {
            if (!catalog.has(logicalKey)) throw snapshotValidation(`Unknown import key: ${logicalKey}`, { logicalKey });
            assertSnapshotEnvelope(logicalKey, parsed.envelopes[logicalKey]);
        }
        for (const [store, rows] of Object.entries(parsed.entities)) {
            if (!PRACTICE_ENTITY_STORES.includes(store) || !Array.isArray(rows)) {
                throw snapshotValidation(`Invalid import entity store: ${store}`, { store });
            }
            const ids = new Set();
            for (const row of rows) {
                assertSnapshotEntityRow(store, row);
                if (ids.has(row.recordId)) {
                    throw snapshotValidation(`Duplicate import entity: ${store}/${row.recordId}`, {
                        store,
                        recordId: row.recordId
                    });
                }
                ids.add(row.recordId);
            }
        }
        if (parsed.scope === 'full' && PRACTICE_ENTITY_STORES.some((store) => !hasOwn(parsed.entities, store))) {
            throw snapshotValidation('Full import is missing a practice entity layer');
        }
        assertSnapshotPracticeEntitySets(parsed.entities);
        if (parsed.checksum !== checksum({ envelopes: parsed.envelopes, entities: parsed.entities })) {
            throw snapshotValidation('Import checksum mismatch');
        }
        return parsed;
    }

    function isV2SnapshotShape(parsed) {
        return isPlainImportObject(parsed)
            && parsed.format === 'ielts-atlas-data-v2'
            && isPlainImportObject(parsed.envelopes)
            && isPlainImportObject(parsed.entities);
    }

    const POISONED_V2_WRAPPER_ALIASES = Object.freeze({
        'settings.values': Object.freeze(['exam_system_settings', 'exam_system_user_settings', 'exam_system_system_settings']),
        'vocab.userConfig': Object.freeze(['exam_system_vocab_user_config']),
        'achievements.manual': Object.freeze(['exam_system_user_achievements', 'exam_system_achievement_manual_state'])
    });
    const LIBRARY_IMPORT_KEYS = Object.freeze([
        'library.configurations',
        'library.importedIndexes',
        'library.activeConfigurationId'
    ]);

    function canonicalizeV2Import(parsed) {
        const warnings = [];
        const repairedKeys = [];
        const ignoredKeys = [];
        const envelopes = {};
        for (const [logicalKey, rawEnvelope] of Object.entries(parsed.envelopes)) {
            if (!catalog.has(logicalKey)) throw new AppDataError('VALIDATION', `Unknown import key: ${logicalKey}`);
            const envelope = clone(rawEnvelope);
            const data = envelope && envelope.state === 'present' ? envelope.data : null;
            if (logicalKey === 'library.activeConfigurationId' && String(data) === '[object Object]') {
                ignoredKeys.push(logicalKey);
                warnings.push('Skipped poisoned active library id');
                continue;
            }
            if (isPlainImportObject(data)
                && Object.prototype.hasOwnProperty.call(data, 'key')
                && Object.prototype.hasOwnProperty.call(data, 'value')
                && String(data.key || '').startsWith('exam_system_')) {
                const aliases = POISONED_V2_WRAPPER_ALIASES[logicalKey] || [];
                const decoded = aliases.includes(String(data.key)) ? internals.parseLegacyValue(data.value) : null;
                if (!isPlainImportObject(decoded)) {
                    ignoredKeys.push(logicalKey);
                    warnings.push(`Skipped mismatched legacy storage wrapper: ${logicalKey}`);
                    continue;
                }
                const overlay = Object.fromEntries(Object.entries(data)
                    .filter(([key]) => key !== 'key' && key !== 'value' && key !== 'timestamp'));
                envelope.data = Object.assign({}, decoded, overlay);
                envelope.checksum = checksum(envelope.data);
                repairedKeys.push(logicalKey);
                warnings.push(`Repaired legacy storage wrapper: ${logicalKey}`);
            }
            envelopes[logicalKey] = envelope;
        }

        if (parsed.scope === 'full') {
            const presentLibraryKeys = LIBRARY_IMPORT_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(envelopes, key));
            if (presentLibraryKeys.length && presentLibraryKeys.length !== LIBRARY_IMPORT_KEYS.length) {
                for (const key of presentLibraryKeys) {
                    delete envelopes[key];
                    ignoredKeys.push(key);
                }
                warnings.push('Skipped incomplete library data');
            }
        }
        const exportableKeys = catalog.list()
            .filter((entry) => entry.export === true && isImportableEntry(entry))
            .map((entry) => entry.logicalKey);
        const missingKeys = parsed.scope === 'full'
            ? exportableKeys.filter((key) => !Object.prototype.hasOwnProperty.call(envelopes, key))
            : [];
        const degraded = parsed.scope === 'full' && (missingKeys.length || ignoredKeys.length);
        return {
            envelopes,
            warnings,
            repairedKeys,
            ignoredKeys,
            missingKeys,
            declaredScope: parsed.scope,
            effectiveScope: degraded ? 'partial' : parsed.scope,
            trust: degraded ? 'degraded-partial' : (parsed.scope === 'full' ? 'trusted-full' : 'partial')
        };
    }

    function resolveImportReplaceFlags(options = {}) {
        const source = asObject(options);
        const practiceMode = String(source.practiceMode || source.mergeMode || '').toLowerCase();
        const replaceAll = source.replace === true;
        return {
            replaceDocuments: replaceAll,
            // Call sites (practiceRecorder / boot-fallbacks) pass practiceMode replace|merge.
            replacePractice: replaceAll || practiceMode === 'replace'
        };
    }

    function pickFirstRecordArray(candidates) {
        for (const candidate of asArray(candidates)) {
            if (Array.isArray(candidate.records) && candidate.records.some(isPlainImportObject)) {
                return { source: candidate.source, records: candidate.records };
            }
        }
        return null;
    }

    /**
     * Historical v1 export shapes (opensource / pre-AppData-v2):
     *   - practiceRecorder.exportData: { exportDate, version, practiceRecords, userStats }
     *   - DataBackupManager: { exportInfo, practiceRecords, userStats?, backups? }
     *   - BackupAPI dual schema: practice_records / practiceRecords (+ nested data.*)
     *   - bare array of records, or { records: [...] }
     * Recognition only — no dual backend and no local store migration.
     */
    function extractLegacyPracticeRecords(payload) {
        const sources = [];
        const add = (source, records) => {
            if (Array.isArray(records) && records.some(isPlainImportObject)) {
                sources.push({ source, records });
            }
        };

        if (Array.isArray(payload)) {
            add('(root array)', payload);
        } else if (isPlainImportObject(payload)) {
            const preferred = pickFirstRecordArray([
                { source: 'practice_records', records: payload.practice_records },
                { source: 'practiceRecords', records: payload.practiceRecords },
                { source: 'records', records: payload.records }
            ]);
            if (preferred) add(preferred.source, preferred.records);

            const data = isPlainImportObject(payload.data) ? payload.data : null;
            if (data) {
                const nested = pickFirstRecordArray([
                    { source: 'data.practice_records', records: data.practice_records },
                    { source: 'data.practiceRecords', records: data.practiceRecords }
                ]);
                if (nested) add(nested.source, nested.records);
                else if (isPlainImportObject(data.practice_records)) add('data.practice_records.data', data.practice_records.data);
                else if (isPlainImportObject(data.practiceRecords)) add('data.practiceRecords.data', data.practiceRecords.data);
                if (isPlainImportObject(data.exam_system_practice_records)) {
                    add('data.exam_system_practice_records.data', data.exam_system_practice_records.data);
                }
            }
            if (isPlainImportObject(payload.exam_system_practice_records)) {
                add('exam_system_practice_records.data', payload.exam_system_practice_records.data);
            }
        }

        const seen = new Set();
        const records = [];
        for (const entry of sources) {
            for (const item of asArray(entry.records)) {
                if (!isPlainImportObject(item)) continue;
                const identity = idOf(item, ['id', 'recordId', 'sessionId']);
                if (identity) {
                    if (seen.has(identity)) continue;
                    seen.add(identity);
                }
                records.push(item);
            }
        }
        return {
            records,
            sources: sources.map((entry) => entry.source)
        };
    }

    function entityRowFromLayer(recordId, data, operationId) {
        const payload = jsonValue(data, 'import practice entity');
        return {
            recordId: String(recordId),
            revision: 1,
            operationId: String(operationId || `import-${recordId}`),
            updatedAt: nowIso(),
            data: payload,
            checksum: checksum(payload)
        };
    }

    function convertLegacyPracticeImport(payload) {
        const extracted = extractLegacyPracticeRecords(payload);
        if (!extracted.records.length) {
            throw new AppDataError(
                'VALIDATION',
                'Import file is neither a v2 snapshot nor a recognizable v1 practice export'
            );
        }

        const entities = {
            practiceSummaries: [],
            practiceDetails: [],
            practiceAnnotations: []
        };
        const warnings = [];
        let skipped = 0;

        for (const raw of extracted.records) {
            try {
                const layers = splitPracticeRecord(raw);
                const recordId = layers.summary.id;
                const operationId = `import-v1-${recordId}`;
                entities.practiceSummaries.push(entityRowFromLayer(recordId, layers.summary, operationId));
                entities.practiceDetails.push(entityRowFromLayer(recordId, layers.detail, operationId));
                entities.practiceAnnotations.push(entityRowFromLayer(recordId, layers.annotations, operationId));
            } catch (error) {
                skipped += 1;
                warnings.push(`Skipped invalid practice record: ${error && error.message ? error.message : error}`);
            }
        }

        if (!entities.practiceSummaries.length) {
            throw new AppDataError('VALIDATION', 'Import file practice records could not be normalized');
        }

        const accepted = entities.practiceSummaries.length;
        return {
            format: 'v1',
            scope: 'partial',
            envelopes: {},
            entities,
            checksum: null,
            warnings,
            practiceSummary: {
                accepted,
                importedCount: accepted,
                skippedCount: skipped,
                sources: extracted.sources.slice()
            }
        };
    }

    function parseImportPayload(payload) {
        let rawParsed;
        try { rawParsed = typeof payload === 'string' ? JSON.parse(payload) : payload; }
        catch (error) {
            if (error instanceof AppDataError) throw error;
            throw new AppDataError('VALIDATION', 'Import payload is not valid JSON', { cause: error && error.message });
        }

        // Bare record arrays are a historical import convenience (UI file pickers).
        if (Array.isArray(rawParsed)) return convertLegacyPracticeImport(jsonValue(rawParsed, 'import payload'));
        if (!rawParsed || typeof rawParsed !== 'object') throw new AppDataError('VALIDATION', 'Import payload must be an object');

        if (isV2SnapshotShape(rawParsed)) {
            const parsed = assertV2Snapshot(rawParsed);
            const canonical = canonicalizeV2Import(parsed);
            return {
                format: 'v2',
                scope: canonical.effectiveScope,
                declaredScope: canonical.declaredScope,
                envelopes: canonical.envelopes,
                entities: parsed.entities,
                checksum: parsed.checksum,
                warnings: canonical.warnings,
                practiceSummary: null,
                repairedKeys: canonical.repairedKeys,
                ignoredKeys: canonical.ignoredKeys,
                missingKeys: canonical.missingKeys,
                trust: canonical.trust
            };
        }

        // Explicit but malformed v2 claims must not fall through to legacy parsers.
        if (rawParsed.format === 'ielts-atlas-data-v2') {
            throw new AppDataError('VALIDATION', 'Only valid v2 snapshots can be imported');
        }

        return convertLegacyPracticeImport(jsonValue(rawParsed, 'import payload'));
    }

    function collectionIdentityFields(logicalKey) {
        if (logicalKey === 'library.configurations') return ['id', 'key', 'configId'];
        if (logicalKey.startsWith('recovery.')) return ['id', 'sessionId', 'recordId'];
        if (logicalKey === 'backups.entries') return ['id'];
        if (logicalKey === 'vocab.words') return ['id', 'word', 'key'];
        if (logicalKey === 'goals.items') return ['id', 'goalId'];
        return ['id', 'sessionId', 'recordId'];
    }

    function collectionIdentity(logicalKey, value) {
        const identity = idOf(value, collectionIdentityFields(logicalKey));
        return logicalKey === 'vocab.words' ? identity.trim().toLowerCase() : identity;
    }

    function mergeCollection(existing, incoming, logicalKey) {
        const result = asArray(existing).map((item) => clone(item));
        const positions = new Map();
        result.forEach((item, index) => {
            const identity = collectionIdentity(logicalKey, item);
            if (identity) positions.set(identity, index);
        });
        for (const rawItem of asArray(incoming)) {
            const item = jsonValue(rawItem, `${logicalKey} item`);
            const identity = collectionIdentity(logicalKey, item);
            if (!identity) throw new AppDataError('VALIDATION', `${logicalKey} import item has no stable identity`);
            const position = positions.get(identity);
            const mergedItem = logicalKey === 'vocab.words'
                ? preserveProgressPhonetics([item], position === undefined ? [] : [result[position]])[0]
                : item;
            if (position !== undefined) result[position] = mergedItem;
            else {
                positions.set(identity, result.length);
                result.push(mergedItem);
            }
        }
        return result;
    }

    function mergeVocabListPhonetics(existing, incoming) {
        const result = Object.assign({}, asObject(existing));
        Object.entries(asObject(incoming)).forEach(([listId, incomingValue]) => {
            const existingValue = result[listId];
            const existingWords = Array.isArray(existingValue)
                ? existingValue
                : asObject(existingValue).words;
            if (Array.isArray(incomingValue)) {
                result[listId] = preserveProgressPhonetics(incomingValue, existingWords);
                return;
            }
            if (incomingValue && typeof incomingValue === 'object') {
                const nextList = clone(incomingValue);
                if (Array.isArray(nextList.words)) {
                    nextList.words = preserveProgressPhonetics(nextList.words, existingWords);
                }
                result[listId] = nextList;
                return;
            }
            result[listId] = clone(incomingValue);
        });
        return result;
    }

    function mergeImportValue(entry, existing, incoming) {
        const policy = entry.import;
        if (policy === 'merge-by-id') return mergeCollection(existing, incoming, entry.logicalKey);
        if (policy === 'patch') {
            if (entry.logicalKey === 'vocab.lists') {
                return mergeVocabListPhonetics(existing, incoming);
            }
            if (Array.isArray(existing) || Array.isArray(incoming)) {
                // Array-shaped keys should use merge-by-id; treat accidental patch as replace.
                return clone(incoming);
            }
            return Object.assign({}, asObject(existing), asObject(incoming));
        }
        if (policy === 'replace') return clone(incoming);
        throw new AppDataError('VALIDATION', `Unsupported import policy for ${entry.logicalKey}: ${policy}`);
    }

    async function currentEntitySnapshot() {
        const summaries = await kernel.listEntities('practiceSummaries', { withMeta: true });
        const result = {};
        for (const store of PRACTICE_ENTITY_STORES) {
            if (store === 'practiceSummaries') result[store] = summaries;
            else result[store] = (await Promise.all(summaries.map((summary) => kernel.readEntity(store, summary.recordId, { withMeta: true })))).filter(Boolean);
        }
        return result;
    }
    function practiceEntityIds(rows) {
        return new Set(asArray(rows).map((row) => String(row && row.recordId || '')).filter(Boolean));
    }
    function assertPracticeEntitySetsMatch(entities, message) {
        const expected = practiceEntityIds(entities.practiceSummaries);
        for (const store of PRACTICE_ENTITY_STORES.slice(1)) {
            const actual = practiceEntityIds(entities[store]);
            if (actual.size !== expected.size || Array.from(expected).some((recordId) => !actual.has(recordId))) {
                throw new AppDataError('VALIDATION', message || 'Practice import entity layers must contain the same recordIds', {
                    counts: Object.fromEntries(PRACTICE_ENTITY_STORES.map((name) => [name, practiceEntityIds(entities[name]).size]))
                });
            }
        }
    }
    async function createImportPlan(parsed, options = {}) {
        const { replaceDocuments, replacePractice } = resolveImportReplaceFlags(options);
        const snapshot = { format: 'ielts-atlas-data-v2', schemaVersion: catalog.version, scope: parsed.scope, envelopes: {}, entities: {} };
        const revisionToken = { documents: {}, entities: {}, entityEpochs: {} };
        const keys = []; const clearedKeys = [];
        const warnings = asArray(parsed.warnings).map(String);
        for (const [logicalKey, envelope] of Object.entries(asObject(parsed.envelopes))) {
            if (!catalog.has(logicalKey)) throw new AppDataError('VALIDATION', `Unknown import key: ${logicalKey}`);
            const entry = catalog.get(logicalKey); if (!isImportableEntry(entry)) continue;
            if (!internals.validateEnvelope(entry, envelope)) throw new AppDataError('VALIDATION', `Invalid import envelope: ${logicalKey}`);
            if (envelope.state === 'cleared' && !replaceDocuments && options.applyClears !== true) {
                warnings.push(`Skipped cleared import key in merge mode: ${logicalKey}`);
                continue;
            }
            const current = await kernel.read(logicalKey, { withMeta: true });
            revisionToken.documents[logicalKey] = current.envelope ? Number(current.envelope.revision) || 0 : 0;
            let next = envelope;
            if (!replaceDocuments && envelope.state === 'present') {
                next = internals.makeEnvelope(entry, mergeImportValue(entry, current.data, envelope.data), { operationId: randomId('import-merge') });
            }
            snapshot.envelopes[logicalKey] = next;
            keys.push(logicalKey);
            if (next.state === 'cleared') clearedKeys.push(logicalKey);
        }

        // A full replace mirrors all exportable user data. Missing physical
        // envelopes mean catalog defaults, represented here as explicit clears.
        if (replaceDocuments && parsed.scope === 'full') {
            for (const entry of catalog.list().filter((candidate) => candidate.export === true && isImportableEntry(candidate))) {
                if (Object.prototype.hasOwnProperty.call(snapshot.envelopes, entry.logicalKey)) continue;
                snapshot.envelopes[entry.logicalKey] = internals.makeEnvelope(entry, null, {
                    state: 'cleared',
                    operationId: randomId('import-clear')
                });
                keys.push(entry.logicalKey);
                clearedKeys.push(entry.logicalKey);
            }
        }

        // Any successful practice import installs all three stores together. Merge
        // may update a subset only when the final recordId sets remain identical.
        const sourceStores = Object.keys(asObject(parsed.entities));
        let practiceExistingCount = null;
        let practiceIncomingCount = null;
        if (sourceStores.length) {
            if (replacePractice && PRACTICE_ENTITY_STORES.some((store) => !sourceStores.includes(store))) {
                throw new AppDataError('VALIDATION', 'Practice replace requires summaries, details, and annotations');
            }
            if (typeof kernel.getEntityRevisionEpochs === 'function') {
                revisionToken.entityEpochs = await kernel.getEntityRevisionEpochs();
            }
            const current = await currentEntitySnapshot();
            revisionToken.entities = Object.fromEntries(PRACTICE_ENTITY_STORES.map((store) => [store, Object.fromEntries(
                asArray(current[store]).map((row) => [String(row.recordId), Number(row.revision) || 0])
            )]));
            practiceExistingCount = asArray(current.practiceSummaries).length;
            practiceIncomingCount = asArray(parsed.entities.practiceSummaries).length;
            const existing = replacePractice
                ? Object.fromEntries(PRACTICE_ENTITY_STORES.map((store) => [store, []]))
                : current;
            for (const store of PRACTICE_ENTITY_STORES) {
                const rows = asArray(existing[store]).map(clone);
                const positions = new Map(rows.map((row, index) => [String(row.recordId), index]));
                for (const row of asArray(parsed.entities[store])) {
                    if (!row || !String(row.recordId || '')) throw new AppDataError('VALIDATION', `Invalid import entity: ${store}`);
                    const index = positions.get(String(row.recordId));
                    if (index === undefined) {
                        positions.set(String(row.recordId), rows.length);
                        rows.push(clone(row));
                    } else rows[index] = clone(row);
                }
                snapshot.entities[store] = rows;
            }
            assertPracticeEntitySetsMatch(snapshot.entities);
        }

        snapshot.checksum = checksum({ envelopes: snapshot.envelopes, entities: snapshot.entities });
        const practiceSummary = parsed.practiceSummary
            ? clone(parsed.practiceSummary)
            : (Object.prototype.hasOwnProperty.call(snapshot.entities, 'practiceSummaries')
                ? {
                    accepted: Number(practiceIncomingCount) || 0,
                    importedCount: Number(practiceIncomingCount) || 0,
                    skippedCount: 0,
                    existingCount: Number(practiceExistingCount) || 0,
                    incomingCount: Number(practiceIncomingCount) || 0,
                    finalCount: asArray(snapshot.entities.practiceSummaries).length,
                    removedCount: Math.max(0, (Number(practiceExistingCount) || 0)
                        - asArray(snapshot.entities.practiceSummaries).length)
                }
                : null);
        if (practiceSummary && practiceSummary.existingCount === undefined) {
            practiceSummary.existingCount = Number(practiceExistingCount) || 0;
            practiceSummary.incomingCount = Number(practiceIncomingCount) || Number(practiceSummary.importedCount) || 0;
            practiceSummary.finalCount = asArray(snapshot.entities.practiceSummaries).length;
            practiceSummary.removedCount = Math.max(0, practiceSummary.existingCount - practiceSummary.finalCount);
        }
        const destructive = clearedKeys.length > 0
            || Boolean(practiceSummary && Number(practiceSummary.removedCount) > 0);
        return {
            snapshot,
            keys,
            clearedKeys,
            warnings,
            practiceSummary,
            destructive,
            resetJournal: replaceDocuments && replacePractice,
            revisionToken,
            diagnostics: {
                format: parsed.format,
                replaceDocuments,
                replacePractice,
                declaredScope: parsed.declaredScope || parsed.scope,
                effectiveScope: parsed.scope,
                trust: parsed.trust || (parsed.format === 'v2' ? 'trusted-full' : 'degraded-partial'),
                missingKeys: clone(parsed.missingKeys || []),
                repairedKeys: clone(parsed.repairedKeys || []),
                ignoredKeys: clone(parsed.ignoredKeys || [])
            }
        };
    }
    async function createRestorePlan(backup) {
        const parsed = parseImportPayload(asObject(backup && backup.data));
        if (parsed.format !== 'v2') throw new AppDataError('VALIDATION', 'Only v2 snapshots can be restored from local backups');
        if (backup.checksum && backup.checksum !== parsed.checksum) throw new AppDataError('VALIDATION', 'Backup checksum mismatch');
        return createImportPlan(parsed, { replace: true });
    }

    const backups = Object.freeze({
        onDataCommitted(listener) { return kernel.onCommitted(listener); },
        async getSettings() { await ready; return kernel.read('backups.settings'); },
        async setSettings(values, options = {}) { await ready; const current = await kernel.read('backups.settings', { withMeta: true }); return kernel.mutate([{ logicalKey: 'backups.settings', data: asObject(values), expectedRevision: current.envelope ? current.envelope.revision : 0 }], optionsMutationOptions(options, 'backup-settings', values)); },
        async getExportHistory() { await ready; return kernel.read('backups.exportHistory'); },
        async getImportHistory() { await ready; return kernel.read('backups.importHistory'); },
        async recordExport(entry, options = {}) { await ready; const current = await readCollectionMeta('backups.exportHistory'); current.items.unshift(Object.assign({ timestamp: nowIso() }, jsonValue(entry, 'backup export history entry'))); return kernel.mutate([{ logicalKey: 'backups.exportHistory', data: current.items.slice(0, 100), expectedRevision: current.revision }], optionsMutationOptions(options, 'backup-export-history', entry)); },
        async recordImport(entry, options = {}) { await ready; const current = await readCollectionMeta('backups.importHistory'); current.items.unshift(Object.assign({ timestamp: nowIso() }, jsonValue(entry, 'backup import history entry'))); return kernel.mutate([{ logicalKey: 'backups.importHistory', data: current.items.slice(0, 100), expectedRevision: current.revision }], optionsMutationOptions(options, 'backup-import-history', entry)); },
        async create(options = {}) {
            await ready; const current = await readCollectionMeta('backups.entries');
            const mutation = optionsMutationOptions(options, 'backup-create', { id: options.id || null, type: options.type || 'manual' });
            const backupId = options.id || (options.operationId ? `backup_${checksum({ operationId: String(options.operationId) }).replace(/[^a-z0-9]/gi, '')}` : randomId('backup'));
            const existing = current.items.find((item) => String(item.id) === String(backupId));
            if (existing) {
                if (String(existing.operationId || '') === String(mutation.operationId)
                    && String(existing.type || 'manual') === String(options.type || 'manual')) {
                    return clone(existing);
                }
                throw new AppDataError('CONFLICT', `Backup id already exists: ${backupId}`, {
                    backupId: String(backupId)
                });
            }
            const snapshot = await kernel.exportSnapshot();
            const backup = { id: backupId, operationId: mutation.operationId, timestamp: nowIso(), type: options.type || 'manual', version: 2, data: snapshot, size: JSON.stringify(snapshot).length, checksum: snapshot.checksum };
            current.items.unshift(backup);
            current.items = retainBackupEntries(current.items, 20, options.preserveIds);
            await kernel.mutate([{ logicalKey: 'backups.entries', data: current.items, expectedRevision: current.revision }], mutation);
            const committed = (await kernel.read('backups.entries')).find((item) => String(item.id) === String(backupId));
            return clone(committed || backup);
        },
        async list() { await ready; return kernel.read('backups.entries'); },
        async delete(id, options = {}) { await ready; const current = await readCollectionMeta('backups.entries'); return kernel.mutate([{ logicalKey: 'backups.entries', data: current.items.filter((item) => String(item.id) !== String(id)), expectedRevision: current.revision }], optionsMutationOptions(options, 'backup-delete', { id: String(id) })); },
        async export(options = {}) {
            await ready;
            if (options.backupId !== undefined && options.backupId !== null) {
                const backupId = String(options.backupId);
                const stored = asArray(await kernel.read('backups.entries'))
                    .find((item) => String(item && item.id) === backupId);
                if (!stored) throw new AppDataError('VALIDATION', `Unknown backup: ${backupId}`);
                const validatedSnapshot = assertV2Snapshot(stored.data);
                const portable = jsonValue(stored, 'stored backup export');
                if (!portable.data || typeof portable.checksum !== 'string'
                    || portable.checksum !== validatedSnapshot.checksum
                    || portable.data.checksum !== validatedSnapshot.checksum) {
                    throw new AppDataError('VALIDATION', `Backup checksum mismatch: ${backupId}`);
                }
                return portable;
            }
            if (Array.isArray(options.domains)) {
                if (!options.domains.length) throw new AppDataError('VALIDATION', 'backups.export domains cannot be empty');
                const domains = new Set(options.domains.map(String));
                const knownDomains = new Set(catalog.list().map((entry) => entry.owner));
                knownDomains.add('practice');
                const unknown = Array.from(domains).filter((domain) => !knownDomains.has(domain));
                if (unknown.length) throw new AppDataError('VALIDATION', `Unknown backup export domain: ${unknown[0]}`);
                const logicalKeys = catalog.list()
                    .filter((entry) => domains.has(entry.owner) && entry.export === true)
                    .map((entry) => entry.logicalKey);
                const includesPractice = domains.has('practice');
                if (!logicalKeys.length && !includesPractice) {
                    throw new AppDataError('VALIDATION', 'backups.export domains select no exportable data');
                }
                const snapshot = await kernel.exportSnapshot(Object.assign(
                    { logicalKeys },
                    includesPractice ? {} : { entityStores: [] }
                ));
                assertV2Snapshot(snapshot);
                return snapshot;
            }
            const snapshot = await kernel.exportSnapshot();
            assertV2Snapshot(snapshot);
            return snapshot;
        },
        validateSnapshot(snapshot) {
            try {
                assertV2Snapshot(snapshot);
                return true;
            } catch (_) {
                return false;
            }
        },
        async previewImport(payload, options = {}) {
            await ready; const parsed = parseImportPayload(payload); const prepared = await createImportPlan(parsed, options); const planId = randomId('import-plan');
            const cutoff = Date.now() - (30 * 60 * 1000);
            for (const [id, existing] of importPlans) {
                if (Date.parse(existing.createdAt) < cutoff || importPlans.size >= 20) importPlans.delete(id);
            }
            const plan = { id: planId, format: parsed.format, scope: parsed.scope, keys: prepared.keys, clearedKeys: prepared.clearedKeys, warnings: prepared.warnings, createdAt: nowIso(), snapshot: prepared.snapshot, practiceSummary: prepared.practiceSummary, diagnostics: prepared.diagnostics, destructive: prepared.destructive, resetJournal: prepared.resetJournal, revisionToken: prepared.revisionToken, signature: checksum(prepared.snapshot) };
            importPlans.set(planId, plan); return { id: planId, format: plan.format, scope: plan.scope, keys: plan.keys, clearedKeys: clone(plan.clearedKeys), warnings: clone(plan.warnings), createdAt: plan.createdAt, practice: clone(plan.practiceSummary), diagnostics: clone(plan.diagnostics), destructive: plan.destructive };
        },
        async commitImport(planId, options = {}) {
            await ready; const plan = importPlans.get(String(planId)); if (!plan) throw new AppDataError('VALIDATION', `Unknown import plan: ${planId}`);
            if (plan.destructive && options.confirmDestructive !== true) {
                throw new AppDataError('VALIDATION', 'Destructive import requires explicit confirmation');
            }
            const mutation = optionsMutationOptions(options, 'import-commit', {
                planId: plan.id,
                signature: plan.signature
            }, { warnings: plan.warnings });
            const receipt = await kernel.installSnapshot(plan.snapshot, Object.assign({}, mutation, {
                resetJournal: plan.resetJournal === true,
                expectedRevisionToken: plan.revisionToken
            }));
            importPlans.delete(String(planId));
            return Object.assign({}, receipt, plan.practiceSummary || {}, { practice: clone(plan.practiceSummary) });
        },
        async restore(id, options = {}) {
            await ready; const backup = (await kernel.read('backups.entries')).find((item) => String(item.id) === String(id));
            if (!backup) throw new AppDataError('VALIDATION', `Unknown backup: ${id}`);
            const prepared = await createRestorePlan(backup);
            const restoreMutation = optionsMutationOptions(options, 'backup-restore', {
                backupId: String(id),
                checksum: backup.checksum || checksum(backup.data)
            }, { resetJournal: true });
            const preRestoreOperationId = `${restoreMutation.operationId}:pre-restore`;
            const preRestoreBackupId = `pre_restore_${checksum({
                operationId: restoreMutation.operationId,
                backupId: String(id),
                checksum: backup.checksum || checksum(backup.data)
            }).replace(/[^a-z0-9]/gi, '')}`;
            const preRestoreBackup = await backups.create({
                id: preRestoreBackupId,
                operationId: preRestoreOperationId,
                type: 'pre-restore',
                preserveIds: [String(id)]
            });
            const receipt = await kernel.installSnapshot(prepared.snapshot, Object.assign({}, restoreMutation, {
                resetJournal: prepared.resetJournal === true,
                expectedRevisionToken: prepared.revisionToken
            }));
            return Object.assign({}, receipt, { preRestoreBackupId: preRestoreBackup.id });
        }
    });

    let vocabMutationTail = Promise.resolve();
    function enqueueVocabMutation(task) {
        const result = vocabMutationTail.then(task, task);
        vocabMutationTail = result.catch(() => undefined);
        return result;
    }
    function retryVocabMutation(options, task) {
        return enqueueVocabMutation(() => retryMergeConflict(options, task));
    }

    const vocab = Object.freeze({
        async listWords() { await ready; return kernel.read('vocab.words'); },
        async saveWords(words, options = {}) {
            await ready; assertArray(words, 'vocab.saveWords requires an array');
            const mutation = optionsMutationOptions(options, 'vocab-words', words);
            return retryVocabMutation(options, async () => {
                const current = await kernel.read('vocab.words', { withMeta: true });
                return kernel.mutate([{
                    logicalKey: 'vocab.words',
                    data: words,
                    expectedRevision: options.expectedRevision ?? (current.envelope ? current.envelope.revision : 0)
                }], mutation);
            });
        },
        async getConfig() { await ready; return kernel.read('vocab.userConfig'); },
        async setConfig(config, options = {}) {
            await ready;
            const mutation = optionsMutationOptions(options, 'vocab-config', config);
            return retryVocabMutation(options, async () => {
                const current = await kernel.read('vocab.userConfig', { withMeta: true });
                return kernel.mutate([{
                    logicalKey: 'vocab.userConfig',
                    data: asObject(config),
                    expectedRevision: options.expectedRevision ?? (current.envelope ? current.envelope.revision : 0)
                }], mutation);
            });
        },
        async patchConfig(patch, options = {}) {
            await ready; assertObject(patch, 'vocab.patchConfig requires an object');
            const mutation = optionsMutationOptions(options, 'vocab-config-patch', patch);
            return retryVocabMutation(options, async () => {
                const current = await kernel.read('vocab.userConfig', { withMeta: true });
                const next = Object.assign({}, asObject(current.data), clone(patch));
                return kernel.mutate([{
                    logicalKey: 'vocab.userConfig',
                    data: next,
                    expectedRevision: options.expectedRevision ?? (current.envelope ? current.envelope.revision : 0)
                }], mutation);
            });
        },
        async activateList(listId, options = {}) { return this.patchConfig({ activeListId: String(listId || 'default') }, options); },
        async listCollections() { await ready; return kernel.read('vocab.lists'); },
        async saveCollection(id, value, options = {}) {
            await ready;
            const collectionId = String(id);
            const mutation = optionsMutationOptions(options, 'vocab-list', { id: collectionId, value });
            return retryVocabMutation(options, async () => {
                const current = await kernel.read('vocab.lists', { withMeta: true });
                const next = Object.assign({}, asObject(current.data), { [collectionId]: clone(value) });
                return kernel.mutate([{
                    logicalKey: 'vocab.lists',
                    data: next,
                    expectedRevision: options.expectedRevision ?? (current.envelope ? current.envelope.revision : 0)
                }], mutation);
            });
        },
        async saveCollections(values, options = {}) {
            await ready;
            assertObject(values, 'vocab.saveCollections requires an object');
            const upserts = Object.fromEntries(Object.entries(values).map(([id, value]) => [String(id), clone(value)]));
            const mutation = optionsMutationOptions(options, 'vocab-lists-batch', upserts);
            return retryVocabMutation(options, async () => {
                const current = await kernel.read('vocab.lists', { withMeta: true });
                const next = Object.assign({}, asObject(current.data), upserts);
                return kernel.mutate([{
                    logicalKey: 'vocab.lists',
                    data: next,
                    expectedRevision: options.expectedRevision ?? (current.envelope ? current.envelope.revision : 0)
                }], mutation);
            });
        },
        async upsertCollectionWord(collectionId, word, options = {}) {
            await ready; assertObject(word, 'vocab.upsertCollectionWord requires a word');
            const id = String(collectionId || '');
            if (!id) throw new AppDataError('VALIDATION', 'vocab collection id is required');
            const identity = String(word.word || word.id || '').trim().toLowerCase();
            if (!identity) throw new AppDataError('VALIDATION', 'vocab word identity is required');
            const normalizedWord = clone(word);
            if (Object.prototype.hasOwnProperty.call(normalizedWord, 'phonetic')) {
                const phonetic = normalizePhoneticValue(normalizedWord.phonetic);
                if (phonetic) normalizedWord.phonetic = phonetic; else delete normalizedWord.phonetic;
            }
            const mutation = optionsMutationOptions(options, 'vocab-word', { collectionId: id, word: normalizedWord });
            return retryVocabMutation(options, async () => {
                const current = await kernel.read('vocab.lists', { withMeta: true });
                const collections = Object.assign({}, asObject(current.data));
                const existing = collections[id];
                const list = existing && typeof existing === 'object' && !Array.isArray(existing)
                    ? Object.assign({}, clone(existing), { words: asArray(existing.words) })
                    : { id, words: asArray(existing) };
                const index = list.words.findIndex((item) => String(item && (item.word || item.id) || '').trim().toLowerCase() === identity);
                const nextWord = Object.assign({}, index >= 0 ? list.words[index] : {}, normalizedWord, { updatedAt: normalizedWord.updatedAt || nowIso() });
                if (!nextWord.createdAt) nextWord.createdAt = nextWord.updatedAt;
                if (index >= 0) list.words[index] = nextWord; else list.words.push(nextWord);
                list.updatedAt = nowIso();
                collections[id] = list;
                const receipt = await kernel.mutate([{
                    logicalKey: 'vocab.lists',
                    data: collections,
                    expectedRevision: options.expectedRevision ?? (current.envelope ? current.envelope.revision : 0)
                }], mutation);
                return Object.assign({}, receipt, { word: clone(nextWord) });
            });
        },
        async readList(listId) { await ready; const id = String(listId || 'default'); if (id === 'default') return kernel.read('vocab.words'); const collections = await kernel.read('vocab.lists'); return Object.prototype.hasOwnProperty.call(collections, id) ? clone(collections[id]) : null; },
        async replaceListWords(command, options = {}) {
            await ready; assertObject(command, 'vocab.replaceListWords requires a command');
            const id = String(command.listId || 'default'); const words = asArray(command.words);
            if (id === 'default') return this.saveWords(words, options);
            const mutation = optionsMutationOptions(options, 'vocab-list-words-replace', command);
            return retryVocabMutation(options, async () => {
                const current = await kernel.read('vocab.lists', { withMeta: true });
                const collections = Object.assign({}, asObject(current.data));
                collections[id] = Object.assign({}, asObject(collections[id]), { id, words, updatedAt: nowIso() });
                return kernel.mutate([{
                    logicalKey: 'vocab.lists',
                    data: collections,
                    expectedRevision: options.expectedRevision ?? (current.envelope ? current.envelope.revision : 0)
                }], mutation);
            });
        },
        async mergeListWords(command, options = {}) {
            await ready;
            assertObject(command, 'vocab.mergeListWords requires a command');
            const listId = String(command.listId || 'default');
            const incoming = asArray(command.words);
            const logicalKey = listId === 'default' ? 'vocab.words' : 'vocab.lists';
            const mutation = optionsMutationOptions(options, 'vocab-words-merge', command);
            return retryVocabMutation(options, async () => {
                const current = await kernel.read(logicalKey, { withMeta: true });
                const collections = listId === 'default' ? null : Object.assign({}, asObject(current.data));
                const storedList = listId === 'default'
                    ? asArray(current.data)
                    : (function readStoredCollection() {
                        const collection = collections[listId];
                        return collection && typeof collection === 'object' && !Array.isArray(collection)
                            ? asArray(collection.words)
                            : asArray(collection);
                    }());
                const merged = storedList.map((word) => clone(word));
                const positions = new Map();
                merged.forEach((word, index) => {
                    const identity = String(word && (word.word || word.id) || '').trim().toLowerCase();
                    if (identity) positions.set(identity, index);
                });
                let addedCount = 0;
                let updatedCount = 0;
                for (const rawWord of incoming) {
                    assertObject(rawWord, 'vocab.mergeListWords entries must be objects');
                    const identity = String(rawWord.word || rawWord.id || '').trim().toLowerCase();
                    if (!identity) throw new AppDataError('VALIDATION', 'vocab word identity is required');
                    if (!positions.has(identity)) {
                        const addedWord = clone(rawWord);
                        if (Object.prototype.hasOwnProperty.call(addedWord, 'phonetic')) {
                            const phonetic = normalizePhoneticValue(addedWord.phonetic);
                            if (phonetic) addedWord.phonetic = phonetic; else delete addedWord.phonetic;
                        }
                        positions.set(identity, merged.length);
                        merged.push(addedWord);
                        addedCount += 1;
                        continue;
                    }
                    const index = positions.get(identity);
                    const existing = asObject(merged[index]);
                    const patch = {};
                    if (typeof rawWord.meaning === 'string' && rawWord.meaning.trim()) patch.meaning = rawWord.meaning.trim();
                    if (typeof rawWord.example === 'string' && rawWord.example.trim()) patch.example = rawWord.example.trim();
                    const phonetic = normalizePhoneticValue(rawWord.phonetic);
                    if (phonetic) patch.phonetic = phonetic;
                    if (typeof rawWord.freq === 'number' && Number.isFinite(rawWord.freq)) patch.freq = rawWord.freq;
                    merged[index] = Object.assign({}, existing, patch, { updatedAt: nowIso() });
                    updatedCount += 1;
                }
                const data = listId === 'default'
                    ? merged
                    : Object.assign({}, collections, {
                        [listId]: Object.assign(
                            {},
                            (function collectionBaseForWrite() {
                                const collection = collections[listId];
                                return collection && typeof collection === 'object' && !Array.isArray(collection)
                                    ? clone(collection)
                                    : {};
                            }()),
                            { id: listId, words: merged, updatedAt: nowIso() }
                        )
                    });
                const receipt = await kernel.mutate([{
                    logicalKey,
                    data,
                    expectedRevision: options.expectedRevision ?? (current.envelope ? current.envelope.revision : 0)
                }], mutation);
                return Object.assign({}, receipt, { listId, words: clone(merged), addedCount, updatedCount });
            });
        },
        async backfillListWordPhonetics(command, options = {}) {
            await ready;
            assertObject(command, 'vocab.backfillListWordPhonetics requires a command');
            const listId = String(command.listId || 'default');
            const phonetics = new Map();
            asArray(command.entries).forEach((entry) => {
                assertObject(entry, 'vocab.backfillListWordPhonetics entries must be objects');
                const identity = String(entry.word || '').trim().toLowerCase();
                const phonetic = normalizePhoneticValue(entry.phonetic);
                if (identity && phonetic && !phonetics.has(identity)) {
                    phonetics.set(identity, phonetic);
                }
            });
            const logicalKey = listId === 'default' ? 'vocab.words' : 'vocab.lists';
            const mutation = optionsMutationOptions(options, 'vocab-phonetic-backfill', {
                listId,
                entryCount: phonetics.size,
                entriesChecksum: checksum(Array.from(phonetics.entries()))
            });
            return retryVocabMutation(options, async () => {
                const current = await kernel.read(logicalKey, { withMeta: true });
                const collections = listId === 'default' ? null : Object.assign({}, asObject(current.data));
                const storedList = listId === 'default'
                    ? asArray(current.data)
                    : (function readStoredCollection() {
                        const collection = collections[listId];
                        return collection && typeof collection === 'object' && !Array.isArray(collection)
                            ? asArray(collection.words)
                            : asArray(collection);
                    }());
                let updatedCount = 0;
                const words = storedList.map((word) => {
                    if (!word || typeof word !== 'object' || Array.isArray(word)) {
                        return clone(word);
                    }
                    const existing = asObject(word);
                    if (normalizePhoneticValue(existing.phonetic)) return clone(existing);
                    const identity = String(existing.word || existing.id || '').trim().toLowerCase();
                    const phonetic = phonetics.get(identity);
                    if (!phonetic) return clone(existing);
                    updatedCount += 1;
                    return Object.assign({}, clone(existing), { phonetic });
                });
                if (!updatedCount) {
                    return { committed: false, listId, words: clone(words), updatedCount: 0 };
                }
                const data = listId === 'default'
                    ? words
                    : Object.assign({}, collections, {
                        [listId]: Object.assign({}, asObject(collections[listId]), { id: listId, words })
                    });
                const receipt = await kernel.mutate([{
                    logicalKey,
                    data,
                    expectedRevision: options.expectedRevision ?? (current.envelope ? current.envelope.revision : 0)
                }], mutation);
                return Object.assign({}, receipt, { listId, words: clone(words), updatedCount });
            });
        },
        async patchWord(command, options = {}) {
            await ready; assertObject(command, 'vocab.patchWord requires a command');
            const listId = String(command.listId || 'default'); const wordId = String(command.wordId || command.id || '');
            if (!wordId) throw new AppDataError('VALIDATION', 'vocab word id is required');
            const normalizedPatch = clone(asObject(command.patch));
            if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'phonetic')) {
                const phonetic = normalizePhoneticValue(normalizedPatch.phonetic);
                if (phonetic) normalizedPatch.phonetic = phonetic; else delete normalizedPatch.phonetic;
            }
            const logicalKey = listId === 'default' ? 'vocab.words' : 'vocab.lists';
            const mutation = optionsMutationOptions(
                Object.assign({}, options, { operationId: command.operationId || options.operationId }),
                'vocab-word-patch',
                Object.assign({}, command, { patch: normalizedPatch })
            );
            return retryVocabMutation(options, async () => {
                const current = await kernel.read(logicalKey, { withMeta: true });
                const collections = listId === 'default' ? null : asObject(current.data);
                const collectionValue = listId === 'default' ? null : collections[listId];
                const collection = collectionValue && typeof collectionValue === 'object' && !Array.isArray(collectionValue)
                    ? asObject(collectionValue)
                    : {};
                const list = listId === 'default'
                    ? asArray(current.data)
                    : (Array.isArray(collectionValue) ? collectionValue : asArray(collection.words));
                const index = list.findIndex((word) => idOf(word, ['id', 'word', 'key']) === wordId);
                if (index < 0) throw new AppDataError('VALIDATION', `Unknown vocab word: ${wordId}`);
                const updated = Object.assign({}, list[index], normalizedPatch, { id: list[index].id || wordId, updatedAt: nowIso() });
                const next = list.slice(); next[index] = updated;
                const data = listId === 'default'
                    ? next
                    : Object.assign({}, collections, {
                        [listId]: Object.assign({}, collection, { id: listId, words: next, updatedAt: nowIso() })
                    });
                const receipt = await kernel.mutate([{
                    logicalKey,
                    data,
                    expectedRevision: options.expectedRevision ?? (current.envelope ? Number(current.envelope.revision) : 0)
                }], mutation);
                return Object.assign({}, receipt, { word: clone(updated) });
            });
        },
        async replaceProgress(command, options = {}) {
            await ready; assertObject(command, 'vocab.replaceProgress requires a command');
            const listId = String(command.listId || 'default'); const words = asArray(command.words);
            const mutation = optionsMutationOptions(options, 'vocab-progress', command);
            return retryVocabMutation(options, async () => {
                const configMeta = await kernel.read('vocab.userConfig', { withMeta: true });
                let committedWords = words;
                const changes = [{
                    logicalKey: 'vocab.userConfig',
                    data: Object.assign({}, asObject(configMeta.data), asObject(command.config), { activeListId: listId }),
                    expectedRevision: configMeta.envelope ? configMeta.envelope.revision : 0
                }];
                if (listId === 'default') {
                    const wordsMeta = await kernel.read('vocab.words', { withMeta: true });
                    committedWords = preserveProgressPhonetics(words, wordsMeta.data);
                    changes.push({ logicalKey: 'vocab.words', data: committedWords, expectedRevision: wordsMeta.envelope ? wordsMeta.envelope.revision : 0 });
                } else {
                    const listsMeta = await kernel.read('vocab.lists', { withMeta: true }); const lists = Object.assign({}, asObject(listsMeta.data));
                    const existingValue = lists[listId];
                    const existingList = existingValue && typeof existingValue === 'object' && !Array.isArray(existingValue)
                        ? asObject(existingValue)
                        : {};
                    const existingWords = Array.isArray(existingValue)
                        ? existingValue
                        : existingList.words;
                    committedWords = preserveProgressPhonetics(words, existingWords);
                    lists[listId] = Object.assign({}, existingList, { id: listId, words: committedWords });
                    changes.push({ logicalKey: 'vocab.lists', data: lists, expectedRevision: listsMeta.envelope ? listsMeta.envelope.revision : 0 });
                }
                const receipt = await kernel.mutate(changes, mutation);
                return Object.assign({}, receipt, { listId, words: clone(committedWords) });
            });
        }
    });

    async function readPreferences() { await ready; return kernel.read('preferences.values'); }
    let preferenceMutationTail = Promise.resolve();
    function enqueuePreferenceMutation(task) {
        const result = preferenceMutationTail.then(task, task);
        preferenceMutationTail = result.catch(() => undefined);
        return result;
    }
    async function writePreference(field, value, options = {}) {
        const mutation = optionsMutationOptions(options, 'preference-set', { field, value });
        return enqueuePreferenceMutation(() => retryMergeConflict(options, async () => {
            const current = await kernel.read('preferences.values', { withMeta: true });
            const next = Object.assign({}, asObject(current.data), { [field]: clone(value) });
            return kernel.mutate([{ logicalKey: 'preferences.values', data: next, expectedRevision: options.expectedRevision ?? (current.envelope ? current.envelope.revision : 0) }], mutation);
        }));
    }
    async function patchPreference(field, patch, options = {}) {
        await ready;
        const mutation = optionsMutationOptions(options, 'preference-patch', { field, patch });
        return enqueuePreferenceMutation(() => retryMergeConflict(options, async () => {
            const current = await kernel.read('preferences.values', { withMeta: true });
            const values = asObject(current.data);
            const next = Object.assign({}, values, { [field]: Object.assign({}, asObject(values[field]), asObject(patch)) });
            return kernel.mutate([{ logicalKey: 'preferences.values', data: next, expectedRevision: options.expectedRevision ?? (current.envelope ? current.envelope.revision : 0) }], mutation);
        }));
    }
    const preferences = Object.freeze({
        async getAll() { return readPreferences(); },
        async getTheme() { return (await readPreferences())[PREFERENCE_FIELDS.theme] ?? null; }, async setTheme(value, options) { await ready; return writePreference(PREFERENCE_FIELDS.theme, value, options); },
        async getBrowse() { return clone((await readPreferences())[PREFERENCE_FIELDS.browse] ?? null); }, async setBrowse(value, options) { await ready; return writePreference(PREFERENCE_FIELDS.browse, value, options); }, async patchBrowse(value, options) { return patchPreference(PREFERENCE_FIELDS.browse, value, options); },
        async getTimer(scope) { const timer = clone((await readPreferences())[PREFERENCE_FIELDS.timer] ?? {}); return scope ? clone(timer[String(scope)] ?? null) : timer; }, async setTimer(scope, value, options) { return patchPreference(PREFERENCE_FIELDS.timer, { [String(scope)]: clone(value) }, options); },
        async getSuite() { return clone((await readPreferences())[PREFERENCE_FIELDS.suite] ?? null); }, async setSuite(value, options) { await ready; return writePreference(PREFERENCE_FIELDS.suite, value, options); }, async patchSuite(value, options) { return patchPreference(PREFERENCE_FIELDS.suite, value, options); },
        async getCandidateCode() { return (await readPreferences())[PREFERENCE_FIELDS.candidateCode] ?? null; }, async setCandidateCode(value, options) { await ready; return writePreference(PREFERENCE_FIELDS.candidateCode, value, options); }
        ,async getResourceBasePrefix() { return (await readPreferences())[PREFERENCE_FIELDS.resourceBasePrefix] ?? null; }, async setResourceBasePrefix(value, options) { await ready; return writePreference(PREFERENCE_FIELDS.resourceBasePrefix, value, options); },
        async getOnboarding() { return clone((await readPreferences())[PREFERENCE_FIELDS.onboarding] ?? {}); }, async setOnboarding(value, options) { await ready; return writePreference(PREFERENCE_FIELDS.onboarding, asObject(value), options); },
        async getReadingDisplay() { return clone((await readPreferences())[PREFERENCE_FIELDS.readingDisplay] ?? null); }, async setReadingDisplay(value, options) { await ready; return writePreference(PREFERENCE_FIELDS.readingDisplay, value, options); },
        async getThreeBackground() { return (await readPreferences())[PREFERENCE_FIELDS.threeBackground] ?? null; }, async setThreeBackground(value, options) { await ready; return writePreference(PREFERENCE_FIELDS.threeBackground, value, options); },
        async getThemePortal() { return clone((await readPreferences())[PREFERENCE_FIELDS.themePortal] ?? null); }, async setThemePortal(value, options) { await ready; return writePreference(PREFERENCE_FIELDS.themePortal, value, options); },
        async getPracticeWidget() { return (await readPreferences())[PREFERENCE_FIELDS.practiceWidget] ?? null; }, async setPracticeWidget(value, options) { await ready; return writePreference(PREFERENCE_FIELDS.practiceWidget, value, options); },
        async getConsent() { return clone((await readPreferences())[PREFERENCE_FIELDS.consent] ?? {}); }, async setConsent(value, options) { await ready; return writePreference(PREFERENCE_FIELDS.consent, asObject(value), options); },
        async getLogConfig() { return clone((await readPreferences())[PREFERENCE_FIELDS.logConfig] ?? null); }, async setLogConfig(value, options) { await ready; return writePreference(PREFERENCE_FIELDS.logConfig, asObject(value), options); }
    });

    const goals = Object.freeze({
        async list() { await ready; return kernel.read('goals.items'); },
        async save(goal, options = {}) { await ready; assertObject(goal, 'goals.save requires an object'); const mutation = optionsMutationOptions(options, 'goal-save', goal); const current = await readCollectionMeta('goals.items'); const id = idOf(goal, ['id', 'goalId']) || deterministicEntityId('goal', mutation.operationId); const item = Object.assign({}, clone(goal), { id }); const index = current.items.findIndex((entry) => idOf(entry, ['id', 'goalId']) === id); if (index >= 0) current.items[index] = item; else current.items.push(item); return kernel.mutate([{ logicalKey: 'goals.items', data: current.items, expectedRevision: current.revision }], mutation); },
        async delete(id, options = {}) { await ready; const current = await readCollectionMeta('goals.items'); return kernel.mutate([{ logicalKey: 'goals.items', data: current.items.filter((item) => idOf(item, ['id', 'goalId']) !== String(id)), expectedRevision: current.revision }], optionsMutationOptions(options, 'goal-delete', { id: String(id) })); }
    });

    function deliveryTimestamp(value) {
        const candidate = value && typeof value === 'object' ? value.unlockedAt : value;
        const time = typeof candidate === 'string' && candidate.trim() ? Date.parse(candidate) : NaN;
        return Number.isFinite(time) ? new Date(time).toISOString() : null;
    }

    function mergeDeliveryAcknowledgements(current, incoming) {
        const merged = Object.assign({}, asObject(current));
        for (const [id, value] of Object.entries(asObject(incoming))) {
            const key = String(id).trim();
            if (!key) continue;
            const previous = deliveryTimestamp(merged[key]);
            const next = deliveryTimestamp(value);
            if (!hasOwn(merged, key) || (next && (!previous || next < previous))) {
                merged[key] = next;
            } else if (previous) {
                merged[key] = previous;
            } else {
                merged[key] = null;
            }
        }
        return merged;
    }

    const achievements = Object.freeze({
        async getAll() {
            await ready;
            const progress = await retryMergeConflict({}, async () => {
                const [summaries, manual, current] = await Promise.all([
                    kernel.listEntities('practiceSummaries'),
                    kernel.read('achievements.manual'),
                    kernel.read('achievements.progress', { withMeta: true })
                ]);
                const projected = asObject(computeAchievementProgress(summaries, manual, current.data));
                if (checksum(projected) !== checksum(asObject(current.data))) {
                    await kernel.mutate([{
                        logicalKey: 'achievements.progress',
                        data: projected,
                        expectedRevision: current.envelope ? Number(current.envelope.revision) : 0
                    }], {
                        operationId: `achievement-progress-${current.envelope ? Number(current.envelope.revision) : 0}-${checksum(projected)}`
                    });
                }
                return projected;
            }, 5);
            if (Object.prototype.hasOwnProperty.call(progress, 'fresh')) delete progress.fresh;
            Object.defineProperty(progress, 'fresh', { value: true, enumerable: false });
            return progress;
        },
        async retryPending() { return achievements.getAll(); },
        async acknowledgeDelivery(unlocked, options = {}) {
            await ready;
            assertObject(unlocked, 'achievements.acknowledgeDelivery requires an object');
            const requested = clone(unlocked);
            const mutation = optionsMutationOptions(options, 'achievement-delivery-acknowledge', requested);
            return retryMergeConflict({}, async () => {
                const current = await kernel.read('settings.values', { withMeta: true });
                const settingsValue = asObject(current.data);
                const delivery = asObject(settingsValue.achievementDelivery);
                const acknowledged = mergeDeliveryAcknowledgements(delivery.acknowledged, requested);
                return kernel.mutate([{
                    logicalKey: 'settings.values',
                    data: Object.assign({}, settingsValue, {
                        achievementDelivery: { version: 1, acknowledged }
                    }),
                    expectedRevision: current.envelope ? Number(current.envelope.revision) : 0
                }], mutation);
            }, 5);
        },
        async getManualState() { await ready; return kernel.read('achievements.manual'); }
    });

    const LEGACY_DOCUMENT_ALIASES = Object.freeze({
        'settings.values': ['user_settings', 'settings', 'system_settings'],
        'recovery.activeSessions': ['active_sessions'], 'recovery.drafts': ['temp_practice_records'],
        'recovery.interrupted': ['interrupted_records'], 'recovery.rejectedCompletions': ['rejected_completion_payloads'],
        'backups.entries': ['manual_backups'], 'backups.settings': ['backup_settings'],
        'backups.exportHistory': ['export_history'], 'backups.importHistory': ['import_history'],
        'vocab.words': ['vocab_words'], 'vocab.userConfig': ['vocab_user_config'], 'vocab.lists': ['vocab_lists'],
        'preferences.values': ['ui_preferences'], 'goals.items': ['learning_goals'],
        'achievements.manual': ['achievement_manual_state', 'user_achievements']
    });
    const LEGACY_PREFERENCE_ALIASES = Object.freeze({
        theme: 'theme', preferred_theme: 'theme', browse_state: 'browse', browse_preferences: 'browse',
        practice_timer_preferences: 'timer', suite_preference: 'suite', candidate_code: 'candidateCode',
        ielts_reading_display_preferences_v1: 'readingDisplay', onboarding_completed: 'onboarding.completed'
    });
    const LEGACY_VOCAB_LIST_ALIASES = Object.freeze({
        'spelling-errors-p1': ['vocab_list_p1_errors', 'vocab_list_p1'],
        'spelling-errors-p4': ['vocab_list_p4_errors', 'vocab_list_p4'],
        'spelling-errors-master': ['vocab_list_master_errors', 'vocab_list_master'],
        custom: ['vocab_list_custom'],
        'reading-highlights': ['vocab_list_reading_highlights']
    });
    const LEGACY_VOCAB_LIST_IDS = Object.freeze({
        p1: 'spelling-errors-p1',
        'p1-errors': 'spelling-errors-p1',
        p1_errors: 'spelling-errors-p1',
        p4: 'spelling-errors-p4',
        'p4-errors': 'spelling-errors-p4',
        p4_errors: 'spelling-errors-p4',
        master: 'spelling-errors-master',
        'master-errors': 'spelling-errors-master',
        master_errors: 'spelling-errors-master',
        custom: 'custom',
        reading: 'reading-highlights',
        'reading-highlights': 'reading-highlights',
        vocab_list_p1_errors: 'spelling-errors-p1',
        vocab_list_p4_errors: 'spelling-errors-p4',
        vocab_list_master_errors: 'spelling-errors-master',
        vocab_list_custom: 'custom',
        vocab_list_reading_highlights: 'reading-highlights'
    });

    function setLegacyPath(target, pathValue, value) {
        const path = String(pathValue).split('.');
        let cursor = target;
        for (const part of path.slice(0, -1)) {
            cursor[part] = Object.assign({}, asObject(cursor[part]));
            cursor = cursor[part];
        }
        cursor[path[path.length - 1]] = clone(value);
    }
    function legacyPreferences(legacy) {
        const preferences = Object.assign({}, asObject(legacy.ui_preferences));
        for (const [alias, target] of Object.entries(LEGACY_PREFERENCE_ALIASES)) {
            if (Object.prototype.hasOwnProperty.call(legacy, alias)) {
                setLegacyPath(preferences, target, legacy[alias]);
            }
        }
        return Object.keys(preferences).length ? preferences : null;
    }
    function legacyVocabConfig(legacy) {
        const config = Object.assign({}, asObject(legacy.vocab_user_config));
        if (Object.prototype.hasOwnProperty.call(legacy, 'vocab_active_list_id')) {
            config.activeListId = clone(legacy.vocab_active_list_id);
        }
        if (config.activeListId !== undefined && config.activeListId !== null) {
            const rawId = String(config.activeListId);
            config.activeListId = LEGACY_VOCAB_LIST_IDS[rawId] || rawId;
        }
        return Object.keys(config).length ? config : null;
    }
    function legacyVocabLists(legacy) {
        const lists = {};
        for (const [rawId, value] of Object.entries(asObject(legacy.vocab_lists))) {
            const id = LEGACY_VOCAB_LIST_IDS[rawId] || String(rawId);
            lists[id] = clone(value);
        }
        for (const [id, aliases] of Object.entries(LEGACY_VOCAB_LIST_ALIASES)) {
            const alias = aliases.find((key) => Object.prototype.hasOwnProperty.call(legacy, key));
            if (alias) lists[id] = clone(legacy[alias]);
        }
        return Object.keys(lists).length ? lists : null;
    }
    function legacyCollectionIdentity(logicalKey, value) {
        if (logicalKey === 'vocab.words') {
            const word = typeof value === 'string'
                ? value.trim().toLowerCase()
                : collectionIdentity(logicalKey, value);
            if (word) return `word:${word}`;
        }
        const identity = collectionIdentity(logicalKey, value);
        return identity ? `id:${identity}` : `content:${checksum(value)}`;
    }
    function mergeLegacyCollection(legacyValue, currentValue, logicalKey) {
        const result = [];
        const positions = new Map();
        for (const item of asArray(legacyValue).concat(asArray(currentValue))) {
            const next = clone(item);
            const identity = legacyCollectionIdentity(logicalKey, next);
            if (positions.has(identity)) result[positions.get(identity)] = next;
            else {
                positions.set(identity, result.length);
                result.push(next);
            }
        }
        return result;
    }
    function reconcileLegacyValue(entry, legacyValue, currentValue) {
        if (entry.import === 'merge-by-id') {
            return mergeLegacyCollection(legacyValue, currentValue, entry.logicalKey);
        }
        if (entry.import === 'patch') {
            return Object.assign({}, asObject(legacyValue), asObject(currentValue));
        }
        return clone(currentValue);
    }
    function legacyDocumentCandidate(logicalKey, aliases, legacy) {
        if (logicalKey === 'preferences.values') {
            const value = legacyPreferences(legacy);
            return { found: value !== null, value };
        }
        if (logicalKey === 'vocab.userConfig') {
            const value = legacyVocabConfig(legacy);
            return { found: value !== null, value };
        }
        if (logicalKey === 'vocab.lists') {
            const value = legacyVocabLists(legacy);
            return { found: value !== null, value };
        }
        const alias = aliases.find((key) => Object.prototype.hasOwnProperty.call(legacy, key));
        return alias ? { found: true, value: clone(legacy[alias]) } : { found: false, value: null };
    }
    async function prepareLegacyDocumentChange(logicalKey, legacyValue) {
        const entry = catalog.get(logicalKey);
        const currentEnvelope = await kernel.getEnvelope(logicalKey);
        if (!currentEnvelope) {
            return { logicalKey, data: clone(legacyValue), expectedRevision: 0 };
        }
        if (entry.import === 'replace' || entry.import === 'ignore') return null;
        const currentValue = await kernel.read(logicalKey);
        const next = reconcileLegacyValue(entry, legacyValue, currentValue);
        if (checksum(next) === checksum(currentValue)) return null;
        return {
            logicalKey,
            data: next,
            expectedRevision: Number(currentEnvelope.revision) || 0
        };
    }

    async function prepareLegacyEntityUpsert(store, recordId, data) {
        if (typeof kernel.getEntityRevision === 'function') {
            const revisionInfo = await kernel.getEntityRevision(store, recordId, { withPresence: true });
            if (revisionInfo && typeof revisionInfo === 'object') {
                if (revisionInfo.present === true) return null;
                return {
                    type: 'upsert',
                    store,
                    recordId,
                    data,
                    expectedRevision: Number(revisionInfo.revision) || 0
                };
            }
            if (await kernel.readEntity(store, recordId)) return null;
            return {
                type: 'upsert',
                store,
                recordId,
                data,
                expectedRevision: Number(revisionInfo) || 0
            };
        }
        if (await kernel.readEntity(store, recordId)) return null;
        return { type: 'upsert', store, recordId, data, expectedRevision: 0 };
    }

    function mergeLegacySources(indexedDbValue, externalValue) {
        const indexedDb = asObject(indexedDbValue);
        const external = asObject(externalValue);
        const merged = Object.assign({}, external, indexedDb);
        const records = new Map();
        const addRecords = (value) => {
            const list = Array.isArray(value) ? value : asArray(asObject(value).data);
            list.forEach((record) => {
                const id = idOf(record, ['id', 'recordId', 'sessionId']);
                records.set(id ? `id:${id}` : `content:${checksum(record)}`, clone(record));
            });
        };
        addRecords(external.practice_records || external.practiceRecords);
        addRecords(indexedDb.practice_records);
        if (records.size) merged.practice_records = Array.from(records.values());
        return merged;
    }

    function legacyLibraryBundle(legacy) {
        const idMap = new Map();
        const indexes = {};
        for (const [oldId, value] of Object.entries(asObject(legacy))) {
            if (!/^exam_index_/.test(oldId) || oldId === 'exam_index_configurations' || !asArray(value).length) continue;
            const id = `legacy-library-${checksum(oldId).replace(/^fnv1a-/, '')}`;
            idMap.set(oldId, id);
            indexes[id] = clone(value);
        }
        if (!idMap.size) return null;
        const configurations = new Map();
        asArray(legacy.exam_index_configurations).forEach((configuration) => {
            const oldId = idOf(configuration, ['id', 'key', 'configId']);
            const id = idMap.get(oldId);
            if (id) configurations.set(id, Object.assign({}, clone(configuration), { id, key: id, examCount: indexes[id].length }));
        });
        for (const [oldId, id] of idMap) {
            if (!configurations.has(id)) configurations.set(id, {
                id,
                key: id,
                name: `迁移的自定义题库 (${oldId})`,
                examCount: indexes[id].length,
                sourceType: 'legacy-import'
            });
        }
        return {
            configurations: Array.from(configurations.values()),
            indexes,
            activeId: idMap.get(String(legacy.active_exam_index_key || '')) || null
        };
    }

    async function migrateLegacyData() {
        // Unit embedders may provide a deliberately minimal kernel bootstrap.
        if (typeof internals.readLegacyValues !== 'function') return;
        const migrationMeta = await kernel.read('system.migrations', { withMeta: true });
        const migrationState = asObject(migrationMeta.data);
        const v1Complete = asObject(migrationState.v1ToV2).status === 'complete';
        const externalConsumed = asObject(migrationState.externalBackupV1).status === 'consumed';
        let externalBackup = null;
        if (!externalConsumed && typeof internals.readLegacyExternalBackup === 'function') {
            try { externalBackup = await internals.readLegacyExternalBackup(); }
            catch (error) {
                if (global.console && console.warn) console.warn('[AppData v2] legacy external backup skipped:', error && error.message);
            }
        }
        if (v1Complete && !externalBackup) return;

        // Once the durable marker is complete, never re-consume ExamSystemDB.
        // A legacy external backup may still be discovered later and is handled
        // independently without resurrecting subsequently deleted v1 data.
        const indexedDb = v1Complete ? {} : await internals.readLegacyValues();
        if (indexedDb && indexedDb.__legacyReadComplete === false) {
            throw new AppDataError('BACKEND_UNAVAILABLE', 'Legacy IndexedDB could not be read completely; migration will retry on next startup');
        }
        const legacy = mergeLegacySources(indexedDb, externalBackup);
        const changes = [];
        for (const [logicalKey, aliases] of Object.entries(LEGACY_DOCUMENT_ALIASES)) {
            const candidate = legacyDocumentCandidate(logicalKey, aliases, legacy);
            if (!candidate.found) continue;
            const change = await prepareLegacyDocumentChange(logicalKey, candidate.value);
            if (change) changes.push(change);
        }
        const libraryBundle = legacyLibraryBundle(legacy);
        if (libraryBundle) {
            for (const [logicalKey, value] of [
                ['library.configurations', libraryBundle.configurations],
                ['library.importedIndexes', libraryBundle.indexes],
                ['library.activeConfigurationId', libraryBundle.activeId]
            ]) {
                const change = await prepareLegacyDocumentChange(logicalKey, value);
                if (change) changes.push(change);
            }
        }
        if (changes.length) await kernel.mutate(changes, { operationId: `legacy-documents-${internals.checksum(changes)}` });
        const recordsValue = legacy.practice_records;
        const records = Array.isArray(recordsValue) ? recordsValue : asArray(asObject(recordsValue).data);
        const operations = [];
        for (const [index, record] of records.entries()) {
            let canonical;
            let parts;
            try {
                const candidate = clone(record);
                if (!idOf(candidate, ['id', 'recordId', 'sessionId'])) candidate.id = `legacy_${index}_${internals.checksum(record)}`;
                canonical = canonicalizeRecord(candidate);
                parts = splitPracticeRecord(canonical);
            } catch (error) {
                if (global.console && console.warn) console.warn(`[AppData v2] skipping malformed legacy practice record #${index}:`, error && error.message);
                continue;
            }
            for (const [store, data] of [
                ['practiceSummaries', parts.summary],
                ['practiceDetails', parts.detail],
                ['practiceAnnotations', parts.annotations]
            ]) {
                // A deleted entity has no physical row, but its sidecar revision
                // remains authoritative. Restore legacy backup data against that
                // tombstone instead of retrying forever with expectedRevision 0.
                // Storage/CAS failures intentionally escape this loop so the
                // migration marker is not consumed before every valid row lands.
                const operation = await prepareLegacyEntityUpsert(store, canonical.id, data);
                if (operation) operations.push(operation);
            }
        }
        if (operations.length) {
            await kernel.mutateEntities(operations, {
                operationId: `legacy-practice-${internals.checksum(operations)}`
            });
        }

        const nextMigrationState = Object.assign({}, migrationState);
        if (!v1Complete) nextMigrationState.v1ToV2 = {
            version: 1,
            status: 'complete',
            completedAt: nowIso(),
            sourceChecksum: checksum(indexedDb),
            sourceRecordCount: asArray(indexedDb.practice_records).length
        };
        if (externalBackup) nextMigrationState.externalBackupV1 = {
            version: 1,
            status: 'consumed',
            completedAt: nowIso(),
            sourceChecksum: checksum(externalBackup)
        };
        await kernel.mutate([{
            logicalKey: 'system.migrations',
            data: nextMigrationState,
            expectedRevision: migrationMeta.envelope ? Number(migrationMeta.envelope.revision) : 0
        }], { operationId: `legacy-migration-${checksum(nextMigrationState)}` });
    }

    const ready = kernel.initialize()
        .then(async () => {
            // Legacy migration and recovery cleanup are best-effort: a failure here
            // (e.g. one malformed v1 record) must not brick the data layer for every
            // read that awaits `ready`. Only a genuine backend init failure below is fatal.
            try {
                await migrateLegacyData();
            } catch (error) {
                if (global.console && console.error) console.error('[AppData v2] legacy migration skipped:', error);
            }
            try {
                await cleanupExpiredRecovery();
            } catch (error) {
                if (global.console && console.warn) console.warn('[AppData v2] recovery cleanup skipped:', error);
            }
            return true;
        })
        .catch((error) => {
            if (global.console && console.error) console.error('[AppData v2] initialization blocked:', error);
            throw error instanceof AppDataError ? error : new AppDataError('INITIALIZATION_BLOCKED', error && error.message || 'AppData v2 initialization failed');
        });

    const AppData = { practice, settings, library, recovery, backups, vocab, preferences, goals, achievements };
    Object.defineProperties(AppData, {
        ready: { value: ready, enumerable: false },
        status: { value: () => kernel.status(), enumerable: false }
    });
    Object.freeze(AppData);
    Object.defineProperty(global, 'AppData', { value: AppData, enumerable: true, configurable: false, writable: false });
    if (!Reflect.deleteProperty(global, '__AppDataV2Internals')) {
        throw new Error('AppData v2 failed to close its internal bootstrap channel');
    }
    if (!Reflect.deleteProperty(global, '__AppDataV2Catalog')) {
        throw new Error('AppData v2 failed to close its catalog bootstrap channel');
    }
})(typeof window !== 'undefined' ? window : globalThis);
