(function initPracticeRecordAPI(global) {
    'use strict';

    const DEFAULT_VERSION = '1.0.0';
    const DEFAULT_MAX_RECORDS = 1000;

    if (global.PracticeRecordAPI && global.PracticeRecordAPI.__stable === true) {
        return;
    }

    let recordStore = null;

    function getPracticeCore() {
        return global.PracticeCore || null;
    }

    function installRecordStore() {
        if (recordStore) {
            return recordStore;
        }
        const core = getPracticeCore();
        if (!core || typeof core.__installRecordAPI !== 'function') {
            return null;
        }
        recordStore = core.__installRecordAPI((store) => store || null);
        try {
            delete core.__installRecordAPI;
        } catch (_) {
            core.__installRecordAPI = undefined;
        }
        return recordStore;
    }

    function getRecordStore() {
        return recordStore || installRecordStore();
    }

    installRecordStore();

    function getDefaultSaveOptions(options = {}) {
        const source = options && typeof options === 'object' ? options : {};
        const normalized = {
            currentVersion: source.currentVersion || DEFAULT_VERSION,
            maxRecords: DEFAULT_MAX_RECORDS
        };
        const maxRecords = Number(source.maxRecords);
        if (Number.isFinite(maxRecords) && maxRecords > 0) {
            normalized.maxRecords = maxRecords;
        }
        Object.keys(source).forEach((key) => {
            if (source[key] !== undefined) {
                normalized[key] = source[key];
            }
        });
        normalized.currentVersion = normalized.currentVersion || DEFAULT_VERSION;
        normalized.maxRecords = Number.isFinite(Number(normalized.maxRecords)) && Number(normalized.maxRecords) > 0
            ? Number(normalized.maxRecords)
            : DEFAULT_MAX_RECORDS;
        return normalized;
    }

    function toIdString(value) {
        return value == null ? '' : String(value);
    }

    function isPlainObject(value) {
        return value && typeof value === 'object' && !Array.isArray(value);
    }

    function clonePlainObject(value) {
        if (value == null || typeof value !== 'object') {
            return value ?? null;
        }
        if (Array.isArray(value)) {
            return value.map((item) => clonePlainObject(item));
        }
        const clone = {};
        Object.keys(value).forEach((key) => {
            clone[key] = clonePlainObject(value[key]);
        });
        return clone;
    }

    function getDefaultStats() {
        if (global.ExamData && typeof global.ExamData.createDefaultUserStats === 'function') {
            return clonePlainObject(global.ExamData.createDefaultUserStats());
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

    function toCamelCaseKey(key) {
        return String(key)
            .replace(/[-_\s]+([a-zA-Z0-9])/g, (_, group) => group.toUpperCase())
            .replace(/^[A-Z]/, match => match.toLowerCase());
    }

    function normalizeStatsAliases(stats) {
        if (!isPlainObject(stats)) {
            return {};
        }
        const normalized = {};
        Object.entries(stats).forEach(([key, value]) => {
            normalized[toCamelCaseKey(key)] = value;
        });
        return normalized;
    }

    function prepareStats(stats) {
        const source = normalizeStatsAliases(stats);
        const prepared = Object.assign({}, getDefaultStats(), clonePlainObject(source));
        prepared.categoryStats = isPlainObject(source.categoryStats) ? clonePlainObject(source.categoryStats) : {};
        prepared.questionTypeStats = isPlainObject(source.questionTypeStats) ? clonePlainObject(source.questionTypeStats) : {};
        prepared.practiceDays = Array.isArray(source.practiceDays) ? source.practiceDays.slice() : [];
        prepared.achievements = Array.isArray(source.achievements) ? source.achievements.slice() : [];
        prepared.updatedAt = source.updatedAt || new Date().toISOString();
        return prepared;
    }

    function getCoreContracts() {
        const core = getPracticeCore();
        return core && core.contracts ? core.contracts : null;
    }

    function normalizeRecord(record, options = {}) {
        if (!isPlainObject(record)) {
            return null;
        }

        const contracts = getCoreContracts();
        if (!contracts || typeof contracts.standardizeRecord !== 'function') {
            throw new Error('PracticeRecordAPI.normalizeRecord: PracticeCore.contracts.standardizeRecord not ready');
        }

        const preserveIds = options.preserveIds !== false;
        const safePrefix = options.fallbackIdPrefix || 'record';
        const sourceId = record.id
            ?? record.recordId
            ?? record.record_id
            ?? record.practiceId
            ?? record.practice_id
            ?? record.sessionId
            ?? record.sessionID
            ?? record.timestamp
            ?? record.uuid;
        const candidate = clonePlainObject(record) || {};

        let id = preserveIds && sourceId ? String(sourceId).trim() : '';
        if (!id) {
            const index = Number.isFinite(Number(options.index)) ? Number(options.index) : 0;
            id = `${safePrefix}_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`;
        }
        candidate.id = id;

        if (record.recordStatus !== undefined && candidate.status === undefined) {
            candidate.status = record.recordStatus;
        }

        const generateRecordId = typeof options.generateRecordId === 'function'
            ? options.generateRecordId
            : () => id;
        const standardized = contracts.standardizeRecord(candidate, Object.assign({}, options, {
            currentVersion: options.currentVersion || DEFAULT_VERSION,
            generateRecordId
        }));
        return standardized && standardized.examId ? standardized : null;
    }

    function normalizeDateValue(value) {
        if (!value) {
            return null;
        }
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return value.toISOString();
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            return new Date(value).toISOString();
        }
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) {
                return null;
            }
            if (/^\d+$/.test(trimmed)) {
                const numeric = Number(trimmed);
                if (Number.isFinite(numeric)) {
                    const milliseconds = trimmed.length > 10 ? numeric : numeric * 1000;
                    return new Date(milliseconds).toISOString();
                }
            }
            const parsed = new Date(trimmed);
            if (!Number.isNaN(parsed.getTime())) {
                return parsed.toISOString();
            }
        }
        return null;
    }

    function getRecordTimestamp(record) {
        if (!record || typeof record !== 'object') {
            return 0;
        }
        const candidates = [
            record.updatedAt,
            record.createdAt,
            record.endTime,
            record.startTime,
            record.timestamp,
            record.date
        ];
        for (let index = 0; index < candidates.length; index += 1) {
            const iso = normalizeDateValue(candidates[index]);
            if (iso) {
                const time = new Date(iso).getTime();
                if (Number.isFinite(time)) {
                    return time;
                }
            }
        }
        return 0;
    }

    function mergeRecordDetails(existing, incoming, options = {}) {
        const merged = Object.assign({}, existing || {}, incoming || {});
        if (isPlainObject(existing && existing.metadata) || isPlainObject(incoming && incoming.metadata)) {
            merged.metadata = Object.assign(
                {},
                isPlainObject(existing && existing.metadata) ? existing.metadata : {},
                isPlainObject(incoming && incoming.metadata) ? incoming.metadata : {}
            );
        }
        if (isPlainObject(existing && existing.realData) || isPlainObject(incoming && incoming.realData)) {
            merged.realData = Object.assign(
                {},
                isPlainObject(existing && existing.realData) ? existing.realData : {},
                isPlainObject(incoming && incoming.realData) ? incoming.realData : {}
            );
        }
        return normalizeRecord(merged, Object.assign({}, options, {
            generateRecordId: () => String(merged.id || (incoming && incoming.id) || (existing && existing.id) || `record_${Date.now()}`)
        }));
    }

    async function readStats(options = {}) {
        const fallback = Object.prototype.hasOwnProperty.call(options, 'fallback')
            ? options.fallback
            : getDefaultStats();

        const store = getRecordStore();
        if (!store || typeof store.readMeta !== 'function') {
            throw new Error('PracticeRecordAPI.readStats: unified meta store not ready');
        }

        return prepareStats(await store.readMeta('user_stats', fallback));
    }

    async function writeStats(stats) {
        const finalStats = prepareStats(stats);
        const store = getRecordStore();

        if (store && typeof store.writeMeta === 'function') {
            await store.writeMeta('user_stats', finalStats);
            return finalStats;
        }

        throw new Error('PracticeRecordAPI.writeStats: unified meta store not ready');
    }

    function normalizeDay(value) {
        if (!value) return null;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        return date.toISOString().slice(0, 10);
    }

    function calculateStreakDays(days) {
        const sorted = Array.isArray(days) ? days.slice().sort() : [];
        if (sorted.length === 0) return 0;
        let streak = 1;
        for (let index = sorted.length - 1; index > 0; index -= 1) {
            const current = new Date(sorted[index]);
            const previous = new Date(sorted[index - 1]);
            const diffDays = Math.round((current - previous) / 86400000);
            if (diffDays === 1) {
                streak += 1;
                continue;
            }
            if (diffDays > 1) break;
        }
        return streak;
    }

    function normalizeAccuracyForStats(record) {
        const values = [
            record && record.accuracy,
            record && record.scoreInfo && record.scoreInfo.accuracy,
            record && record.realData && record.realData.scoreInfo && record.realData.scoreInfo.accuracy
        ];
        for (let index = 0; index < values.length; index += 1) {
            const numeric = Number(values[index]);
            if (Number.isFinite(numeric)) {
                if (numeric > 1 && numeric <= 100) {
                    return numeric / 100;
                }
                return Math.max(0, Math.min(1, numeric));
            }
        }
        const correct = Number(record && (record.correctAnswers ?? record.scoreInfo?.correct ?? record.score));
        const total = Number(record && (record.totalQuestions ?? record.scoreInfo?.total));
        return Number.isFinite(correct) && Number.isFinite(total) && total > 0
            ? Math.max(0, Math.min(1, correct / total))
            : 0;
    }

    function applyRecordToStats(stats, record) {
        if (!stats || !record || typeof record !== 'object') {
            return;
        }

        const duration = Math.max(0, Number(record.duration) || 0);
        const accuracy = normalizeAccuracyForStats(record);
        const category = String((record.metadata && record.metadata.category) || record.category || record.type || '').trim();
        const day = normalizeDay(record.date || record.endTime || record.startTime || record.createdAt);

        stats.totalPractices += 1;
        stats.totalTimeSpent += duration;
        const totalScore = (stats.averageScore * (stats.totalPractices - 1)) + accuracy;
        stats.averageScore = stats.totalPractices > 0 ? totalScore / stats.totalPractices : 0;

        stats.categoryStats = isPlainObject(stats.categoryStats) ? stats.categoryStats : {};
        if (category) {
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
            const categoryStats = stats.categoryStats[category];
            categoryStats.practices += 1;
            categoryStats.timeSpent += duration;
            categoryStats.bestScore = Math.max(categoryStats.bestScore || 0, accuracy);
            categoryStats.totalQuestions += Number(record.totalQuestions) || 0;
            categoryStats.correctAnswers += Number(record.correctAnswers) || 0;
            categoryStats.avgScore = ((categoryStats.avgScore || 0) * (categoryStats.practices - 1) + accuracy) / categoryStats.practices;
        }

        stats.questionTypeStats = isPlainObject(stats.questionTypeStats) ? stats.questionTypeStats : {};
        if (isPlainObject(record.questionTypePerformance)) {
            Object.entries(record.questionTypePerformance).forEach(([type, performance]) => {
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
                typeStats.totalQuestions += Number(performance && performance.total) || 0;
                typeStats.correctAnswers += Number(performance && performance.correct) || 0;
                typeStats.accuracy = typeStats.totalQuestions > 0
                    ? typeStats.correctAnswers / typeStats.totalQuestions
                    : 0;
            });
        }

        if (day) {
            const days = new Set(Array.isArray(stats.practiceDays) ? stats.practiceDays : []);
            days.add(day);
            stats.practiceDays = Array.from(days).sort();
            stats.lastPracticeDate = stats.practiceDays[stats.practiceDays.length - 1] || null;
            stats.streakDays = calculateStreakDays(stats.practiceDays);
        }
        stats.updatedAt = new Date().toISOString();
    }

    async function recalculateStats() {
        const records = await list();
        const stats = getDefaultStats();
        (Array.isArray(records) ? records : []).forEach((record) => applyRecordToStats(stats, record));
        return await writeStats(stats);
    }

    async function resetStats(stats = null) {
        return await writeStats(isPlainObject(stats) ? stats : getDefaultStats());
    }

    async function mergeStats(stats, options = {}) {
        if (!isPlainObject(stats)) {
            return await readStats();
        }

        const mergeMode = options.mergeMode || options.mode || 'merge';
        if (mergeMode === 'replace') {
            return await writeStats(stats);
        }

        const existing = await readStats({ fallback: {} });
        const merged = Object.assign({}, existing);
        Object.entries(stats).forEach(([key, value]) => {
            if (value === undefined || value === null) {
                return;
            }
            const current = existing[key];
            if (typeof value === 'number' && typeof current === 'number') {
                merged[key] = Math.max(value, current);
                return;
            }
            if (isPlainObject(value) && isPlainObject(current)) {
                merged[key] = Object.assign({}, current, value);
                return;
            }
            merged[key] = clonePlainObject(value);
        });

        return await writeStats(merged);
    }

    async function updateStatsForSavedRecord(record, options = {}) {
        if (!record || options.updateStats === false) {
            return false;
        }

        await recalculateStats();
        return true;
    }

    async function list() {
        const store = getRecordStore();
        if (!store || typeof store.listPracticeRecords !== 'function') {
            throw new Error('PracticeRecordAPI.list: unified store not ready');
        }

        const records = await store.listPracticeRecords();
        return Array.isArray(records) ? records : [];
    }

    async function getById(recordId) {
        const targetId = toIdString(recordId);
        if (!targetId) {
            return null;
        }
        const records = await list();
        return records.find((record) => {
            if (!record || typeof record !== 'object') {
                return false;
            }
            return toIdString(record.id) === targetId || toIdString(record.sessionId) === targetId;
        }) || null;
    }

    async function replace(records, options = {}) {
        if (!Array.isArray(records)) {
            throw new Error('PracticeRecordAPI.replace requires an array of records');
        }
        const finalRecords = records;
        const saveOptions = getDefaultSaveOptions(options);
        const store = getRecordStore();
        if (store && typeof store.replacePracticeRecords === 'function') {
            await store.replacePracticeRecords(finalRecords, saveOptions);
            if (options.updateStats === true) {
                await recalculateStats();
            }
            return finalRecords;
        }

        throw new Error('PracticeRecordAPI.replace: unified store not ready');
    }

    async function mergeRecords(records, options = {}) {
        if (!Array.isArray(records)) {
            throw new Error('PracticeRecordAPI.mergeRecords requires an array of records');
        }

        const mergeMode = options.mergeMode || options.mode || 'merge';
        const normalizeOptions = getDefaultSaveOptions(options);
        const incomingRecords = records
            .map((record, index) => normalizeRecord(record, Object.assign({}, normalizeOptions, {
                preserveIds: options.preserveIds !== false,
                fallbackIdPrefix: options.fallbackIdPrefix || 'record',
                index
            })))
            .filter(Boolean);
        const existingRecords = await list();

        if (mergeMode === 'replace') {
            await replace(incomingRecords, Object.assign({}, options, { updateStats: options.updateStats !== false }));
            return {
                importedCount: incomingRecords.length,
                updatedCount: existingRecords.length,
                skippedCount: 0,
                finalCount: incomingRecords.length,
                records: incomingRecords
            };
        }

        const indexMap = new Map();
        existingRecords.forEach((record, index) => {
            if (record && record.id !== undefined && record.id !== null) {
                indexMap.set(String(record.id), { record, index });
            }
        });

        const mergedRecords = existingRecords.slice();
        let importedCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;

        incomingRecords.forEach((record) => {
            if (!record || record.id === undefined || record.id === null) {
                return;
            }

            const key = String(record.id);
            const existing = indexMap.get(key);

            if (!existing) {
                mergedRecords.push(record);
                indexMap.set(key, { record, index: mergedRecords.length - 1 });
                importedCount += 1;
                return;
            }

            if (mergeMode === 'skip') {
                skippedCount += 1;
                return;
            }

            const existingTimestamp = getRecordTimestamp(existing.record);
            const incomingTimestamp = getRecordTimestamp(record);
            if (incomingTimestamp >= existingTimestamp) {
                const merged = mergeRecordDetails(existing.record, record, normalizeOptions);
                mergedRecords[existing.index] = merged;
                indexMap.set(key, { record: merged, index: existing.index });
                updatedCount += 1;
                return;
            }

            skippedCount += 1;
        });

        mergedRecords.sort((a, b) => getRecordTimestamp(a) - getRecordTimestamp(b));
        await replace(mergedRecords, Object.assign({}, options, { updateStats: options.updateStats !== false }));

        return {
            importedCount,
            updatedCount,
            skippedCount,
            finalCount: mergedRecords.length,
            records: mergedRecords
        };
    }

    async function restoreRecords(records, options = {}) {
        if (!Array.isArray(records)) {
            throw new Error('PracticeRecordAPI.restoreRecords requires an array of records');
        }

        await replace(records, Object.assign({}, options, { updateStats: false }));
        if (isPlainObject(options.stats)) {
            await writeStats(options.stats);
        } else if (options.updateStats !== false) {
            await recalculateStats();
        }
        return {
            restoredCount: records.length,
            statsRestored: isPlainObject(options.stats)
        };
    }

    async function clear(options = {}) {
        await replace([], Object.assign({}, options, { updateStats: false }));
        if (options.updateStats === true) {
            await resetStats();
        }
        return true;
    }

    async function deleteMany(recordIds, options = {}) {
        const ids = Array.isArray(recordIds) ? recordIds.map(toIdString).filter(Boolean) : [];
        if (ids.length === 0) {
            return { deletedCount: 0, deletedRecords: [], records: await list() };
        }

        const idSet = new Set(ids);
        const records = await list();
        const deletedRecords = [];
        const remainingRecords = [];

        (Array.isArray(records) ? records : []).forEach((record) => {
            const recordId = toIdString(record && record.id);
            const sessionId = toIdString(record && record.sessionId);
            if ((recordId && idSet.has(recordId)) || (sessionId && idSet.has(sessionId))) {
                deletedRecords.push(record);
                return;
            }
            remainingRecords.push(record);
        });

        if (deletedRecords.length > 0) {
            await replace(remainingRecords, options);
            if (options.updateStats === true) {
                await recalculateStats();
            }
        }

        return {
            deletedCount: deletedRecords.length,
            deletedRecords,
            records: remainingRecords
        };
    }

    async function deleteById(recordId, options = {}) {
        const result = await deleteMany([recordId], options);
        return {
            deleted: result.deletedCount > 0,
            record: result.deletedRecords[0] || null,
            records: result.records
        };
    }

    async function saveRecord(record, options = {}) {
        if (!record || typeof record !== 'object') {
            throw new Error('PracticeRecordAPI.saveRecord requires a record object');
        }

        const saveOptions = getDefaultSaveOptions(options);
        const store = getRecordStore();
        if (!store || typeof store.savePracticeRecord !== 'function') {
            throw new Error('PracticeRecordAPI.saveRecord: PracticeCore store not ready');
        }
        const savedRecord = await store.savePracticeRecord(record, saveOptions);

        if (options.updateStats === true) {
            await updateStatsForSavedRecord(savedRecord, options);
        }

        return savedRecord;
    }

    function fromCompletion(payload, context = {}, examEntry = null, options = {}) {
        const core = getPracticeCore();
        if (!core || !core.ingestor || typeof core.ingestor.fromCompletion !== 'function') {
            return null;
        }
        return core.ingestor.fromCompletion(payload, context || {}, examEntry || null, getDefaultSaveOptions(options));
    }

    async function saveCompletion(payload, context = {}, examEntry = null, options = {}) {
        const record = fromCompletion(payload, context, examEntry, options);
        if (!record) {
            throw new Error('PracticeRecordAPI.saveCompletion could not build canonical record');
        }
        return await saveRecord(record, options);
    }

    function normalizeAccuracy(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric < 0) {
            return 0;
        }
        if (numeric > 1 && numeric <= 100) {
            return numeric / 100;
        }
        return Math.min(numeric, 1);
    }

    function toSummaryMetrics(record = {}) {
        const total = Number(record.totalQuestions ?? record.scoreInfo?.total ?? record.scoreInfo?.totalQuestions ?? record.realData?.scoreInfo?.total ?? record.realData?.totalQuestions);
        const correct = Number(record.correctAnswers ?? record.score ?? record.scoreInfo?.correct ?? record.scoreInfo?.score ?? record.realData?.scoreInfo?.correct ?? record.realData?.score);
        const safeTotal = Number.isFinite(total) && total >= 0 ? total : 0;
        const safeCorrect = Number.isFinite(correct) && correct >= 0 ? correct : 0;

        let accuracy = normalizeAccuracy(record.accuracy ?? record.scoreInfo?.accuracy ?? record.realData?.scoreInfo?.accuracy ?? (safeTotal > 0 ? safeCorrect / safeTotal : 0));
        const percentageCandidate = Number(record.percentage ?? record.scoreInfo?.percentage ?? record.realData?.scoreInfo?.percentage);
        const percentage = Number.isFinite(percentageCandidate) && percentageCandidate >= 0 && percentageCandidate <= 100
            ? percentageCandidate
            : Math.round(accuracy * 100);
        const hasExplicitAccuracy = record.accuracy != null
            || record.scoreInfo?.accuracy != null
            || record.realData?.scoreInfo?.accuracy != null;
        accuracy = percentage > 1 && !hasExplicitAccuracy
            ? percentage / 100
            : accuracy;

        return {
            totalQuestions: safeTotal,
            correctAnswers: safeCorrect,
            accuracy,
            percentage,
            duration: Number(record.duration ?? record.realData?.duration) || 0
        };
    }

    function toReplayEntries(record, projector) {
        if (typeof projector === 'function') {
            return projector(record);
        }
        return [];
    }

    global.PracticeRecordAPI = {
        __stable: true,
        version: '1.0.0',
        list,
        getById,
        replace,
        mergeRecords,
        restoreRecords,
        clear,
        deleteById,
        deleteMany,
        saveRecord,
        normalizeRecord,
        fromCompletion,
        saveCompletion,
        toSummaryMetrics,
        toReplayEntries,
        getDefaultStats,
        prepareStats,
        readStats,
        writeStats,
        mergeStats,
        resetStats,
        recalculateStats,
        updateStatsForSavedRecord
    };

    if (global.persistentStore && typeof global.persistentStore.migrateLegacyData === 'function') {
        Promise.resolve()
            .then(() => global.persistentStore.migrateLegacyData({ skipReady: true }))
            .catch((error) => {
                console.warn('[PracticeRecordAPI] 延后练习记录迁移失败:', error);
            });
    }
})(typeof window !== 'undefined' ? window : globalThis);
