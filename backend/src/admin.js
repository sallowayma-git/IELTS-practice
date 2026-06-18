const { z } = require('zod');
const { requireAdmin, requireAuth, verifyCsrfToken } = require('./auth');

const listQuerySchema = z.object({
    q: z.string().optional().default(''),
    limit: z.coerce.number().int().min(1).max(100).optional().default(25),
    offset: z.coerce.number().int().min(0).optional().default(0)
});

function toInteger(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function serializeUser(row) {
    return {
        id: row.id,
        username: row.username,
        role: row.role === 'admin' ? 'admin' : 'user',
        createdAt: row.created_at || row.createdAt || null,
        updatedAt: row.updated_at || row.updatedAt || null,
        recordCount: toInteger(row.record_count ?? row.recordCount),
        latestRecordAt: row.latest_record_at || row.latestRecordAt || null
    };
}

function serializeRecord(row) {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    return {
        id: row.id,
        sessionId: row.session_id || payload.sessionId || null,
        examId: row.exam_id || payload.examId || null,
        type: row.type || payload.type || payload.examType || null,
        title: row.title || payload.title || null,
        score: row.score === null || row.score === undefined ? (payload.score ?? null) : Number(row.score),
        totalQuestions: row.total_questions ?? payload.totalQuestions ?? null,
        correctAnswers: row.correct_answers ?? payload.correctAnswers ?? null,
        duration: row.duration === null || row.duration === undefined ? (payload.duration ?? null) : Number(row.duration),
        createdAt: row.created_at || payload.createdAt || null,
        updatedAt: row.updated_at || payload.updatedAt || null,
        payload
    };
}

class PostgresAdminStore {
    constructor(db) {
        this.db = db;
    }

    async summary() {
        const result = await this.db.query(`
            SELECT
                (SELECT count(*)::int FROM users) AS user_count,
                (SELECT count(*)::int FROM users WHERE role = 'admin') AS admin_count,
                (SELECT count(*)::int FROM practice_records) AS practice_record_count,
                (SELECT max(updated_at) FROM practice_records) AS latest_record_at
        `);
        const row = result.rows[0] || {};
        return {
            userCount: toInteger(row.user_count),
            adminCount: toInteger(row.admin_count),
            practiceRecordCount: toInteger(row.practice_record_count),
            latestRecordAt: row.latest_record_at || null
        };
    }

    async listUsers(options = {}) {
        const q = String(options.q || '').trim().toLowerCase();
        const limit = options.limit;
        const offset = options.offset;
        const users = await this.db.query(
            `SELECT
                u.id,
                u.username,
                u.role,
                u.created_at,
                u.updated_at,
                count(pr.id)::int AS record_count,
                max(pr.updated_at) AS latest_record_at
             FROM users u
             LEFT JOIN practice_records pr ON pr.user_id = u.id
             WHERE ($1 = '' OR u.username_lower LIKE '%' || $1 || '%' OR lower(u.username) LIKE '%' || $1 || '%')
             GROUP BY u.id
             ORDER BY u.created_at DESC, u.username_lower ASC
             LIMIT $2 OFFSET $3`,
            [q, limit, offset]
        );
        const total = await this.db.query(
            `SELECT count(*)::int AS total
             FROM users
             WHERE ($1 = '' OR username_lower LIKE '%' || $1 || '%' OR lower(username) LIKE '%' || $1 || '%')`,
            [q]
        );
        return {
            users: users.rows.map(serializeUser),
            total: toInteger(total.rows[0]?.total),
            limit,
            offset
        };
    }

    async listPracticeRecords(userId, options = {}) {
        const records = await this.db.query(
            `SELECT id, session_id, exam_id, type, title, score, total_questions,
                    correct_answers, duration, payload, created_at, updated_at
             FROM practice_records
             WHERE user_id = $1
             ORDER BY updated_at DESC, sort_order ASC
             LIMIT $2 OFFSET $3`,
            [userId, options.limit, options.offset]
        );
        const total = await this.db.query(
            'SELECT count(*)::int AS total FROM practice_records WHERE user_id = $1',
            [userId]
        );
        return {
            records: records.rows.map(serializeRecord),
            total: toInteger(total.rows[0]?.total),
            limit: options.limit,
            offset: options.offset
        };
    }

    async deletePracticeRecord(userId, recordId) {
        const result = await this.db.query(
            'DELETE FROM practice_records WHERE user_id = $1 AND id = $2',
            [userId, String(recordId)]
        );
        return result.rowCount || 0;
    }
}

class MemoryAdminStore {
    constructor(options = {}) {
        this.authStore = options.authStore;
        this.practiceStore = options.practiceStore;
    }

    _users() {
        return Array.from(this.authStore?.users?.values?.() || []);
    }

    _records(userId) {
        return this.practiceStore?.recordsByUser?.get(userId) || [];
    }

    async summary() {
        const users = this._users();
        const records = users.flatMap((user) => this._records(user.id));
        return {
            userCount: users.length,
            adminCount: users.filter((user) => user.role === 'admin').length,
            practiceRecordCount: records.length,
            latestRecordAt: null
        };
    }

    async listUsers(options = {}) {
        const q = String(options.q || '').trim().toLowerCase();
        const filtered = this._users()
            .filter((user) => !q || user.username.toLowerCase().includes(q))
            .sort((a, b) => a.username.localeCompare(b.username));
        const users = filtered
            .slice(options.offset, options.offset + options.limit)
            .map((user) => serializeUser({
                ...user,
                recordCount: this._records(user.id).length
            }));
        return {
            users,
            total: filtered.length,
            limit: options.limit,
            offset: options.offset
        };
    }

    async listPracticeRecords(userId, options = {}) {
        const records = this._records(userId);
        return {
            records: records
                .slice(options.offset, options.offset + options.limit)
                .map((record) => serializeRecord({
                    id: record.id,
                    session_id: record.sessionId,
                    exam_id: record.examId,
                    type: record.type,
                    title: record.title,
                    score: record.score,
                    total_questions: record.totalQuestions,
                    correct_answers: record.correctAnswers,
                    duration: record.duration,
                    payload: record,
                    created_at: record.createdAt || record.date || null,
                    updated_at: record.updatedAt || record.date || null
                })),
            total: records.length,
            limit: options.limit,
            offset: options.offset
        };
    }

    async deletePracticeRecord(userId, recordId) {
        if (!this.practiceStore || typeof this.practiceStore.deleteById !== 'function') {
            return 0;
        }
        return this.practiceStore.deleteById(userId, recordId);
    }
}

function parseListQuery(query) {
    return listQuerySchema.parse(query || {});
}

function createAdminRouter(options = {}) {
    const express = require('express');
    const router = express.Router();
    const store = options.store || new PostgresAdminStore(options.db);
    const requireAdminTotp = options.requireAdminTotp || ((req, res, next) => next());

    router.use(requireAuth);
    router.use(requireAdmin);
    router.use(requireAdminTotp);

    router.get('/summary', async (req, res, next) => {
        try {
            return res.json(await store.summary());
        } catch (error) {
            return next(error);
        }
    });

    router.get('/users', async (req, res, next) => {
        try {
            const query = parseListQuery(req.query);
            return res.json(await store.listUsers(query));
        } catch (error) {
            return next(error);
        }
    });

    router.get('/users/:userId/practice-records', async (req, res, next) => {
        try {
            const query = parseListQuery(req.query);
            return res.json(await store.listPracticeRecords(req.params.userId, query));
        } catch (error) {
            return next(error);
        }
    });

    router.delete('/users/:userId/practice-records/:recordId', verifyCsrfToken, async (req, res, next) => {
        try {
            const removed = await store.deletePracticeRecord(req.params.userId, req.params.recordId);
            return res.json({ removed });
        } catch (error) {
            return next(error);
        }
    });

    return router;
}

module.exports = {
    MemoryAdminStore,
    PostgresAdminStore,
    createAdminRouter,
    parseListQuery,
    serializeRecord,
    serializeUser
};
