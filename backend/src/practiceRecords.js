const { z } = require('zod');
const { requireAuth, verifyCsrfToken } = require('./auth');

const practiceRecordSchema = z.object({}).passthrough();

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function getSessionId(record) {
    const value = record && (record.sessionId || record.session_id || record.realData?.sessionId);
    return isNonEmptyString(value) ? String(value).trim() : null;
}

function getExamId(record) {
    const value = record && (record.examId || record.exam_id || record.metadata?.examId);
    return isNonEmptyString(value) ? String(value).trim() : null;
}

function toNullableNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function toNullableInteger(value) {
    const number = toNullableNumber(value);
    return number === null ? null : Math.trunc(number);
}

function normalizePracticeRecord(record) {
    const parsed = practiceRecordSchema.parse(record);
    const normalized = { ...parsed };
    if (!normalized.id) {
        normalized.id = `record_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    } else {
        normalized.id = String(normalized.id);
    }
    const sessionId = getSessionId(normalized);
    if (sessionId && !normalized.sessionId) {
        normalized.sessionId = sessionId;
    }
    return normalized;
}

function normalizeRecordList(records) {
    if (!Array.isArray(records)) {
        const error = new Error('practice records must be an array');
        error.status = 400;
        throw error;
    }
    return records.map(normalizePracticeRecord);
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
            const next = mergeRecord(merged[currentIndex], record);
            merged[currentIndex] = next;
            indexRecord(next, currentIndex);
            return;
        }

        const nextIndex = merged.length;
        merged.push(record);
        indexRecord(record, nextIndex);
    });

    return merged;
}

function extractColumns(record) {
    const scoreInfo = record.scoreInfo || record.realData?.scoreInfo || {};
    return {
        sessionId: getSessionId(record),
        examId: getExamId(record),
        type: isNonEmptyString(record.type) ? String(record.type) : (isNonEmptyString(record.examType) ? String(record.examType) : null),
        title: isNonEmptyString(record.title) ? String(record.title) : null,
        score: toNullableNumber(record.score ?? record.percentage ?? scoreInfo.percentage),
        totalQuestions: toNullableInteger(record.totalQuestions ?? scoreInfo.total),
        correctAnswers: toNullableInteger(record.correctAnswers ?? scoreInfo.correct),
        duration: toNullableNumber(record.duration)
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
        const list = normalizeRecordList(records);
        await this.db.withTransaction(async (client) => {
            await client.query('DELETE FROM practice_records WHERE user_id = $1', [userId]);
            for (let index = 0; index < list.length; index += 1) {
                await insertRecord(client, userId, list[index], index);
            }
        });
        return list;
    }

    async deleteById(userId, id) {
        const result = await this.db.query(
            'DELETE FROM practice_records WHERE user_id = $1 AND id = $2',
            [userId, String(id)]
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
        const list = normalizeRecordList(records);
        this.recordsByUser.set(userId, list.map((record) => ({ ...record })));
        return this.list(userId);
    }

    async deleteById(userId, id) {
        const records = this.recordsByUser.get(userId) || [];
        const next = records.filter((record) => record.id !== String(id));
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
            return store.replace(userId, normalizeRecordList(records));
        },
        async import(userId, records) {
            const existing = await store.list(userId);
            const merged = mergePracticeRecords(existing, records);
            return store.replace(userId, merged);
        },
        async deleteById(userId, id) {
            return store.deleteById(userId, id);
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
    extractColumns,
    getSessionId,
    mergePracticeRecords,
    normalizePracticeRecord,
    normalizeRecordList
};
