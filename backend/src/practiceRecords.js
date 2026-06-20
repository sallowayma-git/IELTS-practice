const crypto = require('node:crypto');
const { z } = require('zod');
const { requireAuth, verifyCsrfToken } = require('./auth');

const practiceRecordSchema = z.object({}).passthrough();
const MAX_RECORDS_PER_REQUEST = 5000;
const MAX_INDEXED_TEXT_LENGTH = 512;
const MAX_TYPE_LENGTH = 64;
const MAX_TITLE_LENGTH = 500;
const MAX_PAYLOAD_DEPTH = 40;
const MAX_PAYLOAD_NODES = 20000;
const MAX_SCORE = 100;
const MAX_QUESTION_COUNT = 10000;
const MAX_DURATION_SECONDS = 365 * 24 * 60 * 60;
const POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;
const NULL_CHARACTER_PATTERN = /\u0000/;

function requestError(message, status = 400, details = undefined) {
    const error = new Error(message);
    error.status = status;
    if (details) {
        error.details = details;
    }
    return error;
}

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function hasUnpairedSurrogate(value) {
    const text = String(value);
    for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        if (code >= 0xD800 && code <= 0xDBFF) {
            const next = text.charCodeAt(index + 1);
            if (!(next >= 0xDC00 && next <= 0xDFFF)) {
                return true;
            }
            index += 1;
        } else if (code >= 0xDC00 && code <= 0xDFFF) {
            return true;
        }
    }
    return false;
}

function assertSafeUnicodeText(value, fieldName) {
    const text = String(value);
    if (hasUnpairedSurrogate(text)) {
        throw requestError(`${fieldName} contains invalid Unicode`, 400, {
            field: fieldName
        });
    }
}

function normalizeIndexedText(value, fieldName) {
    if (!isNonEmptyString(value)) {
        return null;
    }
    const text = String(value).trim();
    assertSafeUnicodeText(text, fieldName);
    if (CONTROL_CHARACTER_PATTERN.test(text)) {
        throw requestError(`${fieldName} contains unsafe control characters`, 400, {
            field: fieldName
        });
    }
    if (text.length > MAX_INDEXED_TEXT_LENGTH) {
        throw requestError(`${fieldName} is too long`, 400, {
            field: fieldName,
            maxLength: MAX_INDEXED_TEXT_LENGTH
        });
    }
    return text;
}

function createRecordId() {
    return `record_${Date.now()}_${crypto.randomUUID()}`;
}

function assertSafeJsonPayload(value, path = 'record', depth = 0, state = { nodes: 0, seen: new WeakSet() }) {
    state.nodes += 1;
    if (state.nodes > MAX_PAYLOAD_NODES) {
        throw requestError('practice record payload is too complex', 413, {
            maxNodes: MAX_PAYLOAD_NODES
        });
    }
    if (depth > MAX_PAYLOAD_DEPTH) {
        throw requestError('practice record payload is too deeply nested', 400, {
            maxDepth: MAX_PAYLOAD_DEPTH
        });
    }
    const valueType = typeof value;
    if (valueType === 'bigint' || valueType === 'function' || valueType === 'symbol') {
        throw requestError('practice record payload contains a non-JSON value', 400, {
            field: path
        });
    }
    if (valueType === 'number' && !Number.isFinite(value)) {
        throw requestError('practice record payload contains a non-finite number', 400, {
            field: path
        });
    }
    if (valueType === 'string') {
        if (NULL_CHARACTER_PATTERN.test(value)) {
            throw requestError('practice record payload contains an unsupported null character', 400, {
                field: path
            });
        }
        if (hasUnpairedSurrogate(value)) {
            throw requestError('practice record payload contains invalid Unicode', 400, {
                field: path
            });
        }
        return;
    }
    if (!value || typeof value !== 'object') {
        return;
    }
    if (state.seen.has(value)) {
        throw requestError('practice record payload contains a circular reference', 400, {
            field: path
        });
    }
    state.seen.add(value);
    try {
        if (Array.isArray(value)) {
            value.forEach((entry, index) => assertSafeJsonPayload(entry, `${path}[${index}]`, depth + 1, state));
            return;
        }
        for (const key of Object.keys(value)) {
            if (POLLUTION_KEYS.has(key)) {
                throw requestError('practice record contains an unsafe key', 400, {
                    field: `${path}.${key}`
                });
            }
            assertSafeJsonPayload(value[key], `${path}.${key}`, depth + 1, state);
        }
    } finally {
        state.seen.delete(value);
    }
}

function normalizeRecordId(value, fieldName = 'id') {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const text = String(value).trim();
    if (!text) {
        return null;
    }
    assertSafeUnicodeText(text, fieldName);
    if (CONTROL_CHARACTER_PATTERN.test(text)) {
        throw requestError(`${fieldName} contains unsafe control characters`, 400, {
            field: fieldName
        });
    }
    if (text.length > MAX_INDEXED_TEXT_LENGTH) {
        throw requestError(`${fieldName} is too long`, 400, {
            field: fieldName,
            maxLength: MAX_INDEXED_TEXT_LENGTH
        });
    }
    return text;
}

function requireRecordId(value, fieldName = 'id') {
    const id = normalizeRecordId(value, fieldName);
    if (!id) {
        throw requestError(`${fieldName} is required`);
    }
    return id;
}

function normalizeLimitedText(value, maxLength, fieldName = 'record metadata') {
    if (!isNonEmptyString(value)) {
        return null;
    }
    const text = String(value).trim();
    assertSafeUnicodeText(text, fieldName);
    if (CONTROL_CHARACTER_PATTERN.test(text)) {
        throw requestError(`${fieldName} contains unsafe control characters`, 400, {
            field: fieldName
        });
    }
    return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function getSessionId(record) {
    const value = record && (record.sessionId || record.session_id || record.realData?.sessionId);
    return normalizeIndexedText(value, 'sessionId');
}

function getExamId(record) {
    const value = record && (record.examId || record.exam_id || record.metadata?.examId);
    return normalizeIndexedText(value, 'examId');
}

function toNullableNumber(value, min = null, max = null) {
    if (value === null || value === undefined || value === '') return null;
    let number = Number(value);
    if (!Number.isFinite(number)) return null;
    if (min !== null) number = Math.max(min, number);
    if (max !== null) number = Math.min(max, number);
    return number;
}

function toNullableInteger(value, min = null, max = null) {
    const number = toNullableNumber(value, min, max);
    return number === null ? null : Math.trunc(number);
}

function normalizeTopLevelNumbers(record) {
    const scoreInfo = record.scoreInfo || record.realData?.scoreInfo || {};
    const score = toNullableNumber(record.score ?? record.percentage ?? scoreInfo.percentage, 0, MAX_SCORE);
    if (score !== null) {
        record.score = score;
    } else {
        delete record.score;
    }

    const accuracy = toNullableNumber(record.accuracy, 0, MAX_SCORE);
    if (accuracy !== null) {
        record.accuracy = accuracy;
    } else if (record.accuracy !== undefined) {
        delete record.accuracy;
    }

    const totalQuestions = toNullableInteger(record.totalQuestions ?? scoreInfo.total, 0, MAX_QUESTION_COUNT);
    if (totalQuestions !== null) {
        record.totalQuestions = totalQuestions;
    } else if (record.totalQuestions !== undefined) {
        delete record.totalQuestions;
    }

    const correctMax = totalQuestions !== null ? totalQuestions : MAX_QUESTION_COUNT;
    const correctAnswers = toNullableInteger(record.correctAnswers ?? scoreInfo.correct, 0, correctMax);
    if (correctAnswers !== null) {
        record.correctAnswers = correctAnswers;
    } else if (record.correctAnswers !== undefined) {
        delete record.correctAnswers;
    }

    const duration = toNullableNumber(record.duration, 0, MAX_DURATION_SECONDS);
    if (duration !== null) {
        record.duration = duration;
    } else if (record.duration !== undefined) {
        delete record.duration;
    }
}

function normalizePracticeRecord(record) {
    const parsed = practiceRecordSchema.safeParse(record);
    if (!parsed.success) {
        throw requestError('practice record must be an object', 400, parsed.error.flatten());
    }
    assertSafeJsonPayload(parsed.data);
    const normalized = { ...parsed.data };
    if (!normalizeRecordId(normalized.id)) {
        normalized.id = createRecordId();
    } else {
        normalized.id = normalizeRecordId(normalized.id, 'id');
    }
    const sessionId = getSessionId(normalized);
    if (sessionId && !normalized.sessionId) {
        normalized.sessionId = sessionId;
    }
    const examId = getExamId(normalized);
    if (examId && !normalized.examId) {
        normalized.examId = examId;
    }
    const type = normalizeLimitedText(normalized.type || normalized.examType, MAX_TYPE_LENGTH, 'type');
    if (type) {
        normalized.type = type;
    }
    const title = normalizeLimitedText(normalized.title, MAX_TITLE_LENGTH, 'title');
    if (title) {
        normalized.title = title;
    }
    normalizeTopLevelNumbers(normalized);
    return normalized;
}

function normalizeRecordList(records) {
    if (!Array.isArray(records)) {
        throw requestError('practice records must be an array');
    }
    if (records.length > MAX_RECORDS_PER_REQUEST) {
        throw requestError('too many practice records', 413, {
            maxRecords: MAX_RECORDS_PER_REQUEST
        });
    }
    return records.map(normalizePracticeRecord);
}

function assertCanAppendMergedRecord(currentLength) {
    if (currentLength >= MAX_RECORDS_PER_REQUEST) {
        throw requestError('too many practice records', 413, {
            maxRecords: MAX_RECORDS_PER_REQUEST
        });
    }
}

function getRecordsFromBody(body) {
    if (Array.isArray(body)) return body;
    if (body && Array.isArray(body.records)) return body.records;
    return null;
}

function getRecordTimestamp(record) {
    const candidates = [
        record && record.updatedAt,
        record && record.endTime,
        record && record.timestamp,
        record && record.date,
        record && record.createdAt
    ];
    for (const value of candidates) {
        const timestamp = Number(new Date(value));
        if (!Number.isNaN(timestamp)) {
            return timestamp;
        }
    }
    return 0;
}

function mergeRecord(existing, incoming) {
    if (!existing) return incoming;
    const existingTs = getRecordTimestamp(existing);
    const incomingTs = getRecordTimestamp(incoming);
    if (incomingTs >= existingTs) {
        return { ...existing, ...incoming };
    }
    return { ...incoming, ...existing };
}

function mergePracticeRecords(existingRecords = [], incomingRecords = []) {
    const merged = [];
    const idIndex = new Map();
    const sessionIndex = new Map();

    function indexRecord(record, index) {
        idIndex.set(String(record.id), index);
        const sessionId = getSessionId(record);
        if (sessionId) {
            sessionIndex.set(sessionId, index);
        }
    }

    function unindexRecord(record, index) {
        if (record && idIndex.get(String(record.id)) === index) {
            idIndex.delete(String(record.id));
        }
        const sessionId = getSessionId(record);
        if (sessionId && sessionIndex.get(sessionId) === index) {
            sessionIndex.delete(sessionId);
        }
    }

    normalizeRecordList(existingRecords).forEach((record) => {
        const index = merged.length;
        merged.push(record);
        indexRecord(record, index);
    });

    normalizeRecordList(incomingRecords).forEach((record) => {
        const sessionId = getSessionId(record);
        const currentIndex = idIndex.has(record.id)
            ? idIndex.get(record.id)
            : (sessionId && sessionIndex.has(sessionId) ? sessionIndex.get(sessionId) : -1);

        if (currentIndex >= 0) {
            const previous = merged[currentIndex];
            const next = mergeRecord(previous, record);
            unindexRecord(previous, currentIndex);
            merged[currentIndex] = next;
            indexRecord(next, currentIndex);
            return;
        }

        assertCanAppendMergedRecord(merged.length);
        const nextIndex = merged.length;
        merged.push(record);
        indexRecord(record, nextIndex);
    });

    return merged;
}

function deduplicatePracticeRecordList(records) {
    return mergePracticeRecords([], records);
}

function extractColumns(record) {
    const scoreInfo = record.scoreInfo || record.realData?.scoreInfo || {};
    return {
        sessionId: getSessionId(record),
        examId: getExamId(record),
        type: normalizeLimitedText(record.type || record.examType, MAX_TYPE_LENGTH, 'type'),
        title: normalizeLimitedText(record.title, MAX_TITLE_LENGTH, 'title'),
        score: toNullableNumber(record.score ?? record.percentage ?? scoreInfo.percentage, 0, MAX_SCORE),
        totalQuestions: toNullableInteger(record.totalQuestions ?? scoreInfo.total, 0, MAX_QUESTION_COUNT),
        correctAnswers: toNullableInteger(
            record.correctAnswers ?? scoreInfo.correct,
            0,
            toNullableInteger(record.totalQuestions ?? scoreInfo.total, 0, MAX_QUESTION_COUNT) ?? MAX_QUESTION_COUNT
        ),
        duration: toNullableNumber(record.duration, 0, MAX_DURATION_SECONDS)
    };
}

class PostgresPracticeRecordStore {
    constructor(db) {
        this.db = db;
    }

    async list(userId) {
        const result = await this.db.query(
            `SELECT payload
             FROM practice_records
             WHERE user_id = $1
             ORDER BY sort_order ASC, updated_at DESC`,
            [userId]
        );
        return result.rows.map((row) => row.payload);
    }

    async replace(userId, records) {
        const list = deduplicatePracticeRecordList(records);
        await this.db.withTransaction(async (client) => {
            await client.query('DELETE FROM practice_records WHERE user_id = $1', [userId]);
            for (let index = 0; index < list.length; index += 1) {
                await insertRecord(client, userId, list[index], index);
            }
        });
        return list;
    }

    async deleteById(userId, id) {
        const recordId = requireRecordId(id);
        const result = await this.db.query(
            'DELETE FROM practice_records WHERE user_id = $1 AND id = $2',
            [userId, recordId]
        );
        return result.rowCount || 0;
    }

    async clear(userId) {
        await this.db.query('DELETE FROM practice_records WHERE user_id = $1', [userId]);
        return true;
    }
}

async function insertRecord(client, userId, record, sortOrder) {
    const columns = extractColumns(record);
    await client.query(
        `INSERT INTO practice_records (
            user_id, id, session_id, exam_id, type, title, score,
            total_questions, correct_answers, duration, payload, sort_order
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
         ON CONFLICT (user_id, id) DO UPDATE SET
            session_id = EXCLUDED.session_id,
            exam_id = EXCLUDED.exam_id,
            type = EXCLUDED.type,
            title = EXCLUDED.title,
            score = EXCLUDED.score,
            total_questions = EXCLUDED.total_questions,
            correct_answers = EXCLUDED.correct_answers,
            duration = EXCLUDED.duration,
            payload = EXCLUDED.payload,
            sort_order = EXCLUDED.sort_order`,
        [
            userId,
            record.id,
            columns.sessionId,
            columns.examId,
            columns.type,
            columns.title,
            columns.score,
            columns.totalQuestions,
            columns.correctAnswers,
            columns.duration,
            JSON.stringify(record),
            sortOrder
        ]
    );
}

class MemoryPracticeRecordStore {
    constructor() {
        this.recordsByUser = new Map();
    }

    async list(userId) {
        const records = this.recordsByUser.get(userId) || [];
        return records.map((record) => ({ ...record }));
    }

    async replace(userId, records) {
        const list = deduplicatePracticeRecordList(records);
        this.recordsByUser.set(userId, list.map((record) => ({ ...record })));
        return this.list(userId);
    }

    async deleteById(userId, id) {
        const recordId = requireRecordId(id);
        const records = this.recordsByUser.get(userId) || [];
        const next = records.filter((record) => record.id !== recordId);
        this.recordsByUser.set(userId, next);
        return records.length - next.length;
    }

    async clear(userId) {
        this.recordsByUser.set(userId, []);
        return true;
    }
}

function createPracticeRecordService(store) {
    return {
        async list(userId) {
            return store.list(userId);
        },
        async replace(userId, records) {
            return store.replace(userId, deduplicatePracticeRecordList(records));
        },
        async import(userId, records) {
            const existing = await store.list(userId);
            const merged = mergePracticeRecords(existing, records);
            return store.replace(userId, merged);
        },
        async deleteById(userId, id) {
            return store.deleteById(userId, requireRecordId(id));
        },
        async clear(userId) {
            return store.clear(userId);
        }
    };
}

function createPracticeRecordsRouter(options = {}) {
    const express = require('express');
    const router = express.Router();
    const store = options.store || new PostgresPracticeRecordStore(options.db);
    const service = options.service || createPracticeRecordService(store);

    router.use(requireAuth);

    router.get('/', async (req, res, next) => {
        try {
            const records = await service.list(req.session.user.id);
            return res.json({ records });
        } catch (error) {
            return next(error);
        }
    });

    router.put('/', verifyCsrfToken, async (req, res, next) => {
        try {
            const records = getRecordsFromBody(req.body);
            if (!records) {
                return res.status(400).json({ error: 'records array required' });
            }
            const nextRecords = await service.replace(req.session.user.id, records);
            return res.json({ records: nextRecords });
        } catch (error) {
            return next(error);
        }
    });

    router.post('/import', verifyCsrfToken, async (req, res, next) => {
        try {
            const records = getRecordsFromBody(req.body);
            if (!records) {
                return res.status(400).json({ error: 'records array required' });
            }
            const nextRecords = await service.import(req.session.user.id, records);
            return res.status(201).json({ records: nextRecords });
        } catch (error) {
            return next(error);
        }
    });

    router.delete('/:id', verifyCsrfToken, async (req, res, next) => {
        try {
            const removed = await service.deleteById(req.session.user.id, req.params.id);
            return res.json({ removed });
        } catch (error) {
            return next(error);
        }
    });

    router.delete('/', verifyCsrfToken, async (req, res, next) => {
        try {
            await service.clear(req.session.user.id);
            return res.json({ ok: true, records: [] });
        } catch (error) {
            return next(error);
        }
    });

    return router;
}

module.exports = {
    MemoryPracticeRecordStore,
    PostgresPracticeRecordStore,
    createPracticeRecordService,
    createPracticeRecordsRouter,
    deduplicatePracticeRecordList,
    extractColumns,
    getSessionId,
    mergePracticeRecords,
    normalizePracticeRecord,
    normalizeRecordList,
    normalizeRecordId,
    requireRecordId
};
