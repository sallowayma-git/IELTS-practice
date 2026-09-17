(function (global) {
    'use strict';

    const own = (value, key) => !!value && Object.prototype.hasOwnProperty.call(value, key);
    const object = (value) => value && typeof value === 'object' ? value : {};

    function provenance(record) {
        const metadata = object(record && record.metadata);
        const source = own(metadata, 'libraryConfigurationId') ? metadata : record;
        if (!own(source, 'libraryConfigurationId')) return { known: false };
        const value = source.libraryConfigurationId;
        if (value === null) return { known: true, id: null };
        if (typeof value === 'string' && value.trim()) return { known: true, id: value.trim() };
        return { known: false };
    }

    function identity(record, isExam = false, parent = null) {
        const metadata = object(record && record.metadata);
        const id = isExam ? record && record.id : record && (record.examId || metadata.examId);
        let source = provenance(record);
        if (!source.known && parent && !own(metadata, 'libraryConfigurationId')
            && !own(record, 'libraryConfigurationId')) source = provenance(parent);
        return id && source.known ? JSON.stringify([source.id, 'reading', String(id)]) : null;
    }

    function number(value) {
        return (typeof value === 'number' || (typeof value === 'string' && value.trim()))
            && Number.isFinite(Number(value)) ? Number(value) : null;
    }

    function eligible(record) {
        if (!record || typeof record !== 'object') return false;
        if (global.PracticeRecordSource && !global.PracticeRecordSource.isRealPracticeRecord(record)) return false;
        const status = String(record.status || object(record.metadata).status || '').toLowerCase();
        return (!status || ['completed', 'submitted', 'graded'].includes(status))
            && record.graded !== false && record.gradable !== false;
    }

    function percentage(record) {
        if (!eligible(record)) return null;
        const score = object(record.scoreInfo || object(record.realData).scoreInfo);
        // New summaries preserve missing scores as null, before the history
        // display's zero defaults. Older summaries use their saved counts.
        const earned = number(own(record, 'browseScore')
            ? object(record.browseScore).earned
            : record.correctAnswers ?? score.correctAnswers ?? score.correct);
        const possible = number(own(record, 'browseScore')
            ? object(record.browseScore).possible
            : record.totalQuestions ?? score.totalQuestions ?? score.total);
        if (earned === null || possible === null || possible <= 0 || earned < 0 || earned > possible) return null;
        return earned / possible * 100;
    }

    function timestamp(record) {
        const candidates = own(record.browseScore, 'submittedAt')
            ? [record.browseScore.submittedAt]
            : [record.completedAt, record.endTime, record.date, record.timestamp];
        for (const value of candidates) {
            if (value == null || value === '') continue;
            const parsed = new Date(value).getTime();
            if (Number.isFinite(parsed) && parsed > 0) return parsed;
        }
        return 0;
    }

    function buildIndex(records) {
        const index = new Map();
        for (const parent of Array.isArray(records) ? records : []) {
            if (!eligible(parent)) continue;
            const entries = Array.isArray(parent.suiteEntrySummaries) && parent.suiteEntrySummaries.length
                ? parent.suiteEntrySummaries : parent.suiteEntries;
            // A suite contributes only its passages, never its aggregate score.
            for (const record of Array.isArray(entries) && entries.length ? entries : [parent]) {
                if (!record) continue;
                const type = String(record.type || object(record.metadata).type || parent.type || '').toLowerCase();
                if (type !== 'reading' && type !== 'reading-suite') continue;
                const key = identity(record, false, record === parent ? null : parent);
                const value = percentage(record);
                const time = timestamp(record) || (record !== parent ? timestamp(parent) : 0);
                if (!key || value === null || !time) continue;
                const tieBreak = String(record.id || record.sessionId || parent.id || parent.sessionId || '');
                const previous = index.get(key);
                if (!previous || time > previous.timestamp
                    || (time === previous.timestamp && tieBreak > previous.tieBreak)) {
                    index.set(key, {
                        percentage: value, wrong: value < 60, timestamp: time, tieBreak,
                        date: new Date(time).toISOString(), duration: Number(record.duration) || 0
                    });
                }
            }
        }
        return index;
    }

    function normalizeSelection(value) {
        const selection = object(value);
        return {
            learningState: ['unattempted', 'completed', 'wrong'].includes(selection.learningState)
                ? selection.learningState : 'all',
            favoritesOnly: selection.favoritesOnly === true
        };
    }

    function filter(exams, selection, favorites, getStatus) {
        const active = normalizeSelection(selection);
        if (active.learningState === 'all' && !active.favoritesOnly) return exams;
        return exams.filter((exam) => {
            if (exam.type !== 'reading') return false;
            const status = getStatus(exam);
            const key = identity(exam, true);
            if (active.favoritesOnly && (!key || !favorites.has(key))) return false;
            if (active.learningState === 'unattempted') return !status;
            if (active.learningState === 'completed') return !!status;
            if (active.learningState === 'wrong') return !!status && status.wrong;
            return true;
        });
    }

    global.BrowseLearningState = { identity, provenance, percentage, buildIndex, normalizeSelection, filter };
})(window);
