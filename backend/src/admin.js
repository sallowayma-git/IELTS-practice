const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { requireRecordId } = require('./practiceRecords');
const {
    USERNAME_PATTERN,
    ensureCsrfToken,
    createRateLimiter,
    normalizeUsername,
    publicUser,
    requireAdmin,
    requireAuth,
    validatePasswordStrength,
    verifyCsrfToken
} = require('./auth');
const {
    hasSessionTotpVerification,
    markSessionTotpVerified,
    resolveTotpVerificationMaxAgeMs
} = require('./totp');

const ADMIN_SEARCH_QUERY_MAX_LENGTH = 80;

const listQuerySchema = z.object({
    q: z.string().trim().max(ADMIN_SEARCH_QUERY_MAX_LENGTH).optional().default(''),
    role: z.enum(['all', 'user', 'admin']).optional().default('all'),
    limit: z.coerce.number().int().min(1).max(100).optional().default(25),
    offset: z.coerce.number().int().min(0).optional().default(0)
});

const createUserSchema = z.object({
    username: z.string().trim().min(3).max(32).regex(USERNAME_PATTERN),
    password: z.string().min(8).max(128),
    role: z.enum(['user', 'admin']).optional().default('user')
});

const updateUserSchema = z.object({
    role: z.enum(['user', 'admin']).optional(),
    password: z.string().min(8).max(128).optional()
}).refine((value) => value.role !== undefined || value.password !== undefined, {
    message: 'No changes supplied'
});

const trafficQuerySchema = z.object({
    days: z.coerce.number().int().min(1).max(90).optional().default(14),
    limit: z.coerce.number().int().min(1).max(50).optional().default(10)
});

const analyticsQuerySchema = z.object({
    days: z.coerce.number().int().min(1).max(180).optional().default(30),
    limit: z.coerce.number().int().min(1).max(50).optional().default(10)
});

const userIdParamSchema = z.string().uuid();
const TRAFFIC_METHOD_MAX_LENGTH = 16;
const TRAFFIC_PATH_MAX_LENGTH = 300;
const TRAFFIC_ROUTE_GROUP_MAX_LENGTH = 32;
const TRAFFIC_HEADER_MAX_LENGTH = 500;
const TRAFFIC_USER_ID_MAX_LENGTH = 128;
const DEFAULT_MEMORY_TRAFFIC_MAX_EVENTS = 10000;
const MAX_MEMORY_SESSION_JSON_LENGTH = 256 * 1024;
const ADMIN_RECORD_PAYLOAD_MAX_DEPTH = 12;
const ADMIN_RECORD_PAYLOAD_MAX_NODES = 20000;
const ADMIN_RECORD_PAYLOAD_MAX_ARRAY_ITEMS = 5000;
const ADMIN_RECORD_PAYLOAD_MAX_OBJECT_KEYS = 1000;
const ADMIN_RECORD_SENSITIVE_VALUE = '[redacted]';
const ADMIN_RECORD_TRUNCATED_VALUE = '[truncated]';
const ADMIN_RECORD_CIRCULAR_VALUE = '[circular]';
const ADMIN_RECORD_MAX_DEPTH_VALUE = '[max-depth]';
const ADMIN_RECORD_ACCESSOR_VALUE = '[accessor]';
const ADMIN_RECORD_UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function toInteger(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function roundNumber(value, digits = 1) {
    const number = toNumber(value);
    const factor = 10 ** digits;
    return Math.round(number * factor) / factor;
}

function truncateText(value, maxLength, fallback = '') {
    const text = String(value ?? fallback)
        .replace(/[\u0000-\u001F\u007F]+/g, ' ')
        .trim();
    if (text.length <= maxLength) {
        return text;
    }
    let truncated = text.slice(0, maxLength);
    if (/[\uD800-\uDBFF]$/.test(truncated)) {
        truncated = truncated.slice(0, -1);
    }
    return truncated;
}

function parseMemorySessionValue(raw) {
    if (typeof raw !== 'string') {
        return raw;
    }
    if (raw.length > MAX_MEMORY_SESSION_JSON_LENGTH) {
        return null;
    }
    try {
        return JSON.parse(raw);
    } catch (_) {
        return null;
    }
}

function stripQueryAndFragment(value, fallback = '') {
    const text = String(value ?? fallback).trim();
    if (!text) {
        return fallback;
    }
    return text.split(/[?#]/, 1)[0] || fallback;
}

function escapeLikePattern(value) {
    return String(value).replace(/[!%_]/g, '!$&');
}

function normalizeAdminSearchQuery(value) {
    return truncateText(String(value ?? '').toLowerCase(), ADMIN_SEARCH_QUERY_MAX_LENGTH);
}

function normalizeRequestPath(value) {
    const text = String(value ?? '/').trim();
    if (!text) {
        return '/';
    }
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(text) && !/^https?:\/\//i.test(text)) {
        return '/';
    }
    const sanitizeNormalizedPath = (path) => {
        const cleanPath = stripQueryAndFragment(path, '/')
            .replace(/[\u0000-\u001F\u007F]+/g, ' ')
            .trim();
        if (!cleanPath) {
            return '/';
        }
        return cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`;
    };
    try {
        const url = new URL(text, 'http://local.invalid');
        return sanitizeNormalizedPath(url.pathname || '/');
    } catch (_) {
        return sanitizeNormalizedPath(text);
    }
}

function normalizeReferrer(value) {
    const text = String(value ?? '').trim();
    if (!text) {
        return null;
    }
    try {
        const url = new URL(text);
        return url.origin === 'null' ? null : url.origin;
    } catch (_) {
        return stripQueryAndFragment(text, '') ? '/' : null;
    }
}

function normalizeUserAgent(value) {
    const text = truncateText(value, TRAFFIC_HEADER_MAX_LENGTH);
    if (!text) {
        return null;
    }
    const lower = text.toLowerCase();
    if (/\b(?:bot|crawler|spider)\b/.test(lower)) {
        return 'bot';
    }
    if (lower.includes('edg/')) {
        return 'edge';
    }
    if (lower.includes('firefox/')) {
        return 'firefox';
    }
    if (lower.includes('opr/') || lower.includes('opera')) {
        return 'opera';
    }
    if (lower.includes('chrome/') || lower.includes('chromium/')) {
        return 'chromium';
    }
    if (lower.includes('safari/') && lower.includes('version/')) {
        return 'safari';
    }
    if (lower.includes('curl/')) {
        return 'curl';
    }
    if (lower.includes('wget/')) {
        return 'wget';
    }
    return 'other';
}

function normalizeTrafficLanguage(value) {
    const text = truncateText(value, TRAFFIC_HEADER_MAX_LENGTH)
        .toLowerCase()
        .replace(/[\u0000-\u001F\u007F]+/g, ' ')
        .trim();
    if (!text) {
        return null;
    }
    const primary = text.split(',', 1)[0].trim().split(';', 1)[0].trim();
    const match = primary.match(/^([a-z]{2,3})(?:-[a-z0-9]{2,8})?$/i);
    return match ? match[1].toLowerCase() : null;
}

function normalizeTrafficSessionId(value) {
    const text = truncateText(value || '', 128);
    return /^[a-f0-9]{64}$/i.test(text) ? text.toLowerCase() : null;
}

function normalizeTrafficUserId(value) {
    const text = truncateText(value || '', TRAFFIC_USER_ID_MAX_LENGTH);
    return userIdParamSchema.safeParse(text).success ? text.toLowerCase() : null;
}

function normalizeRole(value) {
    return value === 'admin' ? 'admin' : 'user';
}

function adminMutationError(message) {
    const error = new Error(message);
    error.status = 400;
    return error;
}

function summarizeAdminErrorForLog(error) {
    if (!error || typeof error !== 'object') {
        return { name: typeof error };
    }
    const summary = {
        name: typeof error.name === 'string' && error.name ? error.name : 'Error'
    };
    if (error.code !== undefined) {
        summary.code = String(error.code);
    }
    if (error.status !== undefined || error.statusCode !== undefined) {
        summary.status = Number(error.status || error.statusCode);
    }
    return summary;
}

function serializeUser(row) {
    return {
        id: row.id,
        username: row.username,
        role: normalizeRole(row.role),
        createdAt: row.created_at || row.createdAt || null,
        updatedAt: row.updated_at || row.updatedAt || null,
        recordCount: toInteger(row.record_count ?? row.recordCount),
        latestRecordAt: row.latest_record_at || row.latestRecordAt || null,
        averageScore: row.average_score === null || row.average_score === undefined
            ? null
            : roundNumber(row.average_score),
        totalStudyMinutes: roundNumber(row.total_duration ?? row.totalStudyMinutes ?? 0),
        correctAnswers: toInteger(row.correct_answers ?? row.correctAnswers),
        totalQuestions: toInteger(row.total_questions ?? row.totalQuestions)
    };
}

function isSensitiveAdminRecordKey(key) {
    const normalized = String(key ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!normalized) {
        return false;
    }
    return normalized.includes('password')
        || normalized.includes('token')
        || normalized.includes('secret')
        || normalized.includes('csrf')
        || normalized.includes('totp')
        || normalized.includes('recoverycode')
        || normalized.includes('apikey')
        || normalized.includes('accesskey')
        || normalized.includes('credential')
        || normalized.includes('privatekey')
        || normalized === 'authorization'
        || normalized === 'authheader'
        || normalized === 'cookie'
        || normalized === 'setcookie';
}

function sanitizeAdminRecordPayload(value, depth = 0, state = { nodes: 0, seen: new WeakSet() }) {
    if (value === null) {
        return null;
    }

    const valueType = typeof value;
    if (valueType === 'string' || valueType === 'boolean') {
        return value;
    }
    if (valueType === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (valueType === 'bigint') {
        return value.toString();
    }
    if (valueType !== 'object') {
        return null;
    }

    if (depth >= ADMIN_RECORD_PAYLOAD_MAX_DEPTH) {
        return ADMIN_RECORD_MAX_DEPTH_VALUE;
    }
    if (state.seen.has(value)) {
        return ADMIN_RECORD_CIRCULAR_VALUE;
    }

    state.nodes += 1;
    if (state.nodes > ADMIN_RECORD_PAYLOAD_MAX_NODES) {
        return ADMIN_RECORD_TRUNCATED_VALUE;
    }

    state.seen.add(value);

    try {
        if (Array.isArray(value)) {
            const result = [];
            const limit = Math.min(value.length, ADMIN_RECORD_PAYLOAD_MAX_ARRAY_ITEMS);
            for (let index = 0; index < limit; index += 1) {
                result.push(sanitizeAdminRecordPayload(value[index], depth + 1, state));
            }
            if (value.length > limit) {
                result.push(ADMIN_RECORD_TRUNCATED_VALUE);
            }
            return result;
        }

        let keys;
        try {
            keys = Object.keys(value);
        } catch (_) {
            return ADMIN_RECORD_TRUNCATED_VALUE;
        }

        const result = {};
        const limit = Math.min(keys.length, ADMIN_RECORD_PAYLOAD_MAX_OBJECT_KEYS);
        for (let index = 0; index < limit; index += 1) {
            const key = keys[index];
            if (ADMIN_RECORD_UNSAFE_KEYS.has(key)) {
                continue;
            }
            if (isSensitiveAdminRecordKey(key)) {
                result[key] = ADMIN_RECORD_SENSITIVE_VALUE;
                continue;
            }

            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor) {
                continue;
            }
            if (!Object.prototype.propertyIsEnumerable.call(value, key)) {
                continue;
            }
            if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
                result[key] = ADMIN_RECORD_ACCESSOR_VALUE;
                continue;
            }
            result[key] = sanitizeAdminRecordPayload(descriptor.value, depth + 1, state);
        }
        if (keys.length > limit) {
            result.__truncatedKeys = keys.length - limit;
        }
        return result;
    } finally {
        state.seen.delete(value);
    }
}

function serializeRecord(row) {
    const rawPayload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    const payload = sanitizeAdminRecordPayload(rawPayload);
    return {
        id: row.id,
        sessionId: row.session_id || rawPayload.sessionId || null,
        examId: row.exam_id || rawPayload.examId || null,
        type: row.type || rawPayload.type || rawPayload.examType || null,
        title: row.title || rawPayload.title || null,
        score: row.score === null || row.score === undefined ? (rawPayload.score ?? null) : Number(row.score),
        totalQuestions: row.total_questions ?? rawPayload.totalQuestions ?? null,
        correctAnswers: row.correct_answers ?? rawPayload.correctAnswers ?? null,
        duration: row.duration === null || row.duration === undefined ? (rawPayload.duration ?? null) : Number(row.duration),
        createdAt: row.created_at || rawPayload.createdAt || null,
        updatedAt: row.updated_at || rawPayload.updatedAt || null,
        payload
    };
}

function serializeTypeStats(row) {
    return {
        type: row.type || 'unknown',
        recordCount: toInteger(row.record_count ?? row.recordCount),
        averageScore: row.average_score === null || row.average_score === undefined
            ? null
            : roundNumber(row.average_score),
        totalStudyMinutes: roundNumber(row.total_duration ?? row.totalStudyMinutes ?? 0),
        latestRecordAt: row.latest_record_at || row.latestRecordAt || null
    };
}

function serializeTrafficDaily(row) {
    return {
        day: row.day,
        requests: toInteger(row.requests),
        pageViews: toInteger(row.page_views ?? row.pageViews),
        uniqueVisitors: toInteger(row.unique_visitors ?? row.uniqueVisitors),
        errors: toInteger(row.errors)
    };
}

function serializeTrafficPath(row) {
    return {
        path: row.path,
        routeGroup: row.route_group || row.routeGroup || 'other',
        requests: toInteger(row.requests),
        uniqueVisitors: toInteger(row.unique_visitors ?? row.uniqueVisitors),
        lastSeenAt: row.last_seen_at || row.lastSeenAt || null
    };
}

function serializeTrafficEvent(row) {
    return {
        occurredAt: row.occurred_at || row.occurredAt || null,
        method: row.method,
        path: row.path,
        routeGroup: row.route_group || row.routeGroup || 'other',
        statusCode: toInteger(row.status_code ?? row.statusCode),
        durationMs: toInteger(row.duration_ms ?? row.durationMs),
        userId: normalizeTrafficUserId(row.user_id || row.userId)
    };
}

function serializeDailyLearning(row) {
    return {
        day: row.day,
        records: toInteger(row.records),
        activeUsers: toInteger(row.active_users ?? row.activeUsers),
        averageScore: row.average_score === null || row.average_score === undefined
            ? null
            : roundNumber(row.average_score),
        totalStudyMinutes: roundNumber(row.total_duration ?? row.totalStudyMinutes ?? 0)
    };
}

function serializeUserGrowth(row) {
    return {
        day: row.day,
        users: toInteger(row.users),
        admins: toInteger(row.admins)
    };
}

function serializeScoreBucket(row) {
    return {
        bucket: row.bucket,
        records: toInteger(row.records)
    };
}

function serializeTrafficGroup(row) {
    return {
        group: row.route_group || row.group || 'other',
        requests: toInteger(row.requests),
        errors: toInteger(row.errors),
        averageDurationMs: roundNumber(row.average_duration_ms ?? row.averageDurationMs)
    };
}

function serializeTrafficStatus(row) {
    return {
        statusClass: row.status_class || row.statusClass || 'unknown',
        requests: toInteger(row.requests)
    };
}

function normalizeTrafficEvent(event = {}) {
    const rawPath = normalizeRequestPath(event.path || '/');
    const rawReferrer = normalizeReferrer(event.referrer);
    return {
        userId: normalizeTrafficUserId(event.userId),
        sessionId: normalizeTrafficSessionId(event.sessionId),
        method: truncateText(event.method || 'GET', TRAFFIC_METHOD_MAX_LENGTH, 'GET').toUpperCase(),
        path: truncateText(rawPath, TRAFFIC_PATH_MAX_LENGTH, '/') || '/',
        routeGroup: truncateText(event.routeGroup || classifyRouteGroup(rawPath), TRAFFIC_ROUTE_GROUP_MAX_LENGTH, 'other') || 'other',
        statusCode: toInteger(event.statusCode),
        durationMs: Math.max(0, toInteger(event.durationMs)),
        ipHash: event.ipHash ? truncateText(event.ipHash, 128) : null,
        userAgent: normalizeUserAgent(event.userAgent),
        referrer: rawReferrer ? truncateText(rawReferrer, TRAFFIC_HEADER_MAX_LENGTH) : null
    };
}

function buildUserStats(user, records) {
    const byType = new Map();
    let scoreTotal = 0;
    let scoreCount = 0;
    let duration = 0;
    let correct = 0;
    let total = 0;
    let latestRecordAt = null;

    for (const record of records) {
        const score = Number(record.score);
        const recordDuration = Number(record.duration);
        const correctAnswers = Number(record.correctAnswers ?? record.correct_answers);
        const totalQuestions = Number(record.totalQuestions ?? record.total_questions);
        const type = record.type || record.examType || 'unknown';
        const updatedAt = record.updatedAt || record.updated_at || record.date || record.createdAt || null;
        if (Number.isFinite(score)) {
            scoreTotal += score;
            scoreCount += 1;
        }
        if (Number.isFinite(recordDuration)) duration += recordDuration;
        if (Number.isFinite(correctAnswers)) correct += correctAnswers;
        if (Number.isFinite(totalQuestions)) total += totalQuestions;
        if (updatedAt && (!latestRecordAt || Number(new Date(updatedAt)) > Number(new Date(latestRecordAt)))) {
            latestRecordAt = updatedAt;
        }
        const entry = byType.get(type) || {
            type,
            recordCount: 0,
            scoreTotal: 0,
            scoreCount: 0,
            totalStudyMinutes: 0,
            latestRecordAt: null
        };
        entry.recordCount += 1;
        if (Number.isFinite(score)) {
            entry.scoreTotal += score;
            entry.scoreCount += 1;
        }
        if (Number.isFinite(recordDuration)) entry.totalStudyMinutes += recordDuration;
        if (updatedAt && (!entry.latestRecordAt || Number(new Date(updatedAt)) > Number(new Date(entry.latestRecordAt)))) {
            entry.latestRecordAt = updatedAt;
        }
        byType.set(type, entry);
    }

    return {
        user: serializeUser(user),
        recordCount: records.length,
        averageScore: scoreCount ? roundNumber(scoreTotal / scoreCount) : null,
        totalStudyMinutes: roundNumber(duration),
        correctAnswers: toInteger(correct),
        totalQuestions: toInteger(total),
        latestRecordAt,
        byType: Array.from(byType.values()).map((entry) => ({
            type: entry.type,
            recordCount: entry.recordCount,
            averageScore: entry.scoreCount ? roundNumber(entry.scoreTotal / entry.scoreCount) : null,
            totalStudyMinutes: roundNumber(entry.totalStudyMinutes),
            latestRecordAt: entry.latestRecordAt
        }))
    };
}

async function hashPassword(password, rounds = 12) {
    return bcrypt.hash(password, rounds);
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
                (SELECT count(DISTINCT user_id)::int FROM practice_records) AS active_user_count,
                (SELECT avg(score) FROM practice_records WHERE score IS NOT NULL) AS average_score,
                (SELECT coalesce(sum(duration), 0) FROM practice_records WHERE duration IS NOT NULL) AS total_duration,
                (SELECT coalesce(sum(correct_answers), 0)::int FROM practice_records WHERE correct_answers IS NOT NULL) AS correct_answers,
                (SELECT coalesce(sum(total_questions), 0)::int FROM practice_records WHERE total_questions IS NOT NULL) AS total_questions,
                (SELECT max(updated_at) FROM practice_records) AS latest_record_at,
                (SELECT count(*)::int FROM traffic_events) AS total_requests,
                (SELECT count(*)::int FROM traffic_events WHERE route_group = 'page') AS total_page_views,
                (SELECT count(DISTINCT ip_hash)::int FROM traffic_events WHERE ip_hash IS NOT NULL) AS unique_visitors,
                (SELECT count(*)::int FROM traffic_events WHERE occurred_at >= date_trunc('day', now())) AS requests_today,
                (SELECT count(*)::int FROM traffic_events WHERE route_group = 'page' AND occurred_at >= date_trunc('day', now())) AS page_views_today
        `);
        const row = result.rows[0] || {};
        return {
            userCount: toInteger(row.user_count),
            adminCount: toInteger(row.admin_count),
            practiceRecordCount: toInteger(row.practice_record_count),
            activeUserCount: toInteger(row.active_user_count),
            averageScore: row.average_score === null || row.average_score === undefined ? null : roundNumber(row.average_score),
            totalStudyMinutes: roundNumber(row.total_duration),
            correctAnswers: toInteger(row.correct_answers),
            totalQuestions: toInteger(row.total_questions),
            latestRecordAt: row.latest_record_at || null,
            traffic: {
                totalRequests: toInteger(row.total_requests),
                totalPageViews: toInteger(row.total_page_views),
                uniqueVisitors: toInteger(row.unique_visitors),
                requestsToday: toInteger(row.requests_today),
                pageViewsToday: toInteger(row.page_views_today)
            }
        };
    }

    async globalStats() {
        const totals = await this.summary();
        const byType = await this.db.query(`
            SELECT
                coalesce(type, 'unknown') AS type,
                count(*)::int AS record_count,
                avg(score) AS average_score,
                coalesce(sum(duration), 0) AS total_duration,
                max(updated_at) AS latest_record_at
            FROM practice_records
            GROUP BY coalesce(type, 'unknown')
            ORDER BY record_count DESC, type ASC
        `);
        return {
            ...totals,
            byType: byType.rows.map(serializeTypeStats)
        };
    }

    async analytics(options = {}) {
        const days = options.days;
        const limit = options.limit;
        const [dailyLearning, userGrowth, topUsers, scoreBuckets] = await Promise.all([
            this.db.query(
                `SELECT
                    to_char(date_trunc('day', updated_at), 'YYYY-MM-DD') AS day,
                    count(*)::int AS records,
                    count(DISTINCT user_id)::int AS active_users,
                    avg(score) AS average_score,
                    coalesce(sum(duration), 0) AS total_duration
                 FROM practice_records
                 WHERE updated_at >= now() - ($1::int * interval '1 day')
                 GROUP BY date_trunc('day', updated_at)
                 ORDER BY day ASC`,
                [days]
            ),
            this.db.query(
                `SELECT
                    to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
                    count(*)::int AS users,
                    count(*) FILTER (WHERE role = 'admin')::int AS admins
                 FROM users
                 WHERE created_at >= now() - ($1::int * interval '1 day')
                 GROUP BY date_trunc('day', created_at)
                 ORDER BY day ASC`,
                [days]
            ),
            this.db.query(
                `SELECT
                    u.id,
                    u.username,
                    u.role,
                    u.created_at,
                    u.updated_at,
                    count(pr.id)::int AS record_count,
                    max(pr.updated_at) AS latest_record_at,
                    avg(pr.score) AS average_score,
                    coalesce(sum(pr.duration), 0) AS total_duration,
                    coalesce(sum(pr.correct_answers), 0)::int AS correct_answers,
                    coalesce(sum(pr.total_questions), 0)::int AS total_questions
                 FROM users u
                 JOIN practice_records pr ON pr.user_id = u.id
                 WHERE pr.updated_at >= now() - ($1::int * interval '1 day')
                 GROUP BY u.id
                 ORDER BY record_count DESC, average_score DESC NULLS LAST, latest_record_at DESC
                 LIMIT $2`,
                [days, limit]
            ),
            this.db.query(
                `SELECT bucket, count(*)::int AS records
                 FROM (
                    SELECT CASE
                        WHEN score IS NULL THEN 'No score'
                        WHEN score < 40 THEN '0-39'
                        WHEN score < 60 THEN '40-59'
                        WHEN score < 80 THEN '60-79'
                        ELSE '80-100'
                    END AS bucket
                    FROM practice_records
                    WHERE updated_at >= now() - ($1::int * interval '1 day')
                 ) scored
                 GROUP BY bucket
                 ORDER BY CASE bucket
                    WHEN '0-39' THEN 1
                    WHEN '40-59' THEN 2
                    WHEN '60-79' THEN 3
                    WHEN '80-100' THEN 4
                    ELSE 5
                 END`,
                [days]
            )
        ]);
        return {
            days,
            dailyLearning: dailyLearning.rows.map(serializeDailyLearning),
            userGrowth: userGrowth.rows.map(serializeUserGrowth),
            topUsers: topUsers.rows.map(serializeUser),
            scoreBuckets: scoreBuckets.rows.map(serializeScoreBucket)
        };
    }

    async listUsers(options = {}) {
        const q = normalizeAdminSearchQuery(options.q);
        const searchPattern = escapeLikePattern(q);
        const role = options.role === 'admin' || options.role === 'user' ? options.role : 'all';
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
                max(pr.updated_at) AS latest_record_at,
                avg(pr.score) AS average_score,
                coalesce(sum(pr.duration), 0) AS total_duration,
                coalesce(sum(pr.correct_answers), 0)::int AS correct_answers,
                coalesce(sum(pr.total_questions), 0)::int AS total_questions
             FROM users u
             LEFT JOIN practice_records pr ON pr.user_id = u.id
             WHERE ($1 = '' OR u.username_lower LIKE '%' || $1 || '%' ESCAPE '!' OR lower(u.username) LIKE '%' || $1 || '%' ESCAPE '!')
               AND ($4 = 'all' OR u.role = $4)
             GROUP BY u.id
             ORDER BY u.created_at DESC, u.username_lower ASC
             LIMIT $2 OFFSET $3`,
            [searchPattern, limit, offset, role]
        );
        const total = await this.db.query(
            `SELECT count(*)::int AS total
             FROM users
             WHERE ($1 = '' OR username_lower LIKE '%' || $1 || '%' ESCAPE '!' OR lower(username) LIKE '%' || $1 || '%' ESCAPE '!')
               AND ($2 = 'all' OR role = $2)`,
            [searchPattern, role]
        );
        return {
            users: users.rows.map(serializeUser),
            total: toInteger(total.rows[0]?.total),
            limit,
            offset,
            role
        };
    }

    async getUser(userId) {
        const result = await this.db.query(
            `SELECT
                u.id,
                u.username,
                u.role,
                u.created_at,
                u.updated_at,
                count(pr.id)::int AS record_count,
                max(pr.updated_at) AS latest_record_at,
                avg(pr.score) AS average_score,
                coalesce(sum(pr.duration), 0) AS total_duration,
                coalesce(sum(pr.correct_answers), 0)::int AS correct_answers,
                coalesce(sum(pr.total_questions), 0)::int AS total_questions
             FROM users u
             LEFT JOIN practice_records pr ON pr.user_id = u.id
             WHERE u.id = $1
             GROUP BY u.id`,
            [userId]
        );
        return result.rows[0] ? serializeUser(result.rows[0]) : null;
    }

    async createUser({ username, password, role }) {
        const usernameValue = normalizeUsername(username);
        const passwordHash = await hashPassword(password);
        const result = await this.db.query(
            `INSERT INTO users (username, username_lower, password_hash, role)
             VALUES ($1, $2, $3, $4)
             RETURNING id, username, role, created_at, updated_at`,
            [usernameValue, usernameValue.toLowerCase(), passwordHash, normalizeRole(role)]
        );
        return serializeUser(result.rows[0]);
    }

    async updateUser(userId, changes = {}) {
        const updates = [];
        const params = [userId];
        const nextRole = changes.role !== undefined ? normalizeRole(changes.role) : undefined;
        const nextPasswordHash = changes.password !== undefined ? await hashPassword(changes.password) : undefined;
        if (changes.role !== undefined) {
            params.push(nextRole);
            updates.push(`role = $${params.length}`);
        }
        if (changes.password !== undefined) {
            params.push(nextPasswordHash);
            updates.push(`password_hash = $${params.length}`);
        }
        if (!updates.length) {
            return this.getUser(userId);
        }

        const runUpdate = async (client) => {
            if (nextRole === 'user') {
                await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
                const current = await client.query(
                    'SELECT id, role FROM users WHERE id = $1 FOR UPDATE',
                    [userId]
                );
                if (!current.rows[0]) {
                    return null;
                }
                if (current.rows[0].role === 'admin') {
                    const adminCount = await client.query('SELECT count(*)::int AS total FROM users WHERE role = $1', ['admin']);
                    if (toInteger(adminCount.rows[0]?.total) <= 1) {
                        throw adminMutationError('Cannot demote the last admin');
                    }
                }
            }
            const result = await client.query(
                `UPDATE users
                 SET ${updates.join(', ')}
                 WHERE id = $1
                 RETURNING id, username, role, created_at, updated_at`,
                params
            );
            return result.rows[0] ? serializeUser(result.rows[0]) : null;
        };

        if (nextRole === 'user' && typeof this.db.withTransaction === 'function') {
            return this.db.withTransaction(runUpdate);
        }
        return runUpdate(this.db);
    }

    async countAdmins() {
        const result = await this.db.query('SELECT count(*)::int AS total FROM users WHERE role = $1', ['admin']);
        return toInteger(result.rows[0]?.total);
    }

    async deleteSessionsForUser(userId, exceptSid = null, client = this.db) {
        await client.query(
            `DELETE FROM "session"
             WHERE (
                    sess::jsonb #>> '{user,id}' = $1
                 OR sess::jsonb #>> '{pendingTotpLogin,user,id}' = $1
                 OR sess::jsonb #>> '{pendingTotpSetup,user,id}' = $1
             )
             AND ($2::text IS NULL OR sid <> $2::text)`,
            [userId, exceptSid]
        );
    }

    async deleteUser(userId) {
        const runDelete = async (client) => {
            await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
            const current = await client.query(
                'SELECT id, username, role FROM users WHERE id = $1 FOR UPDATE',
                [userId]
            );
            if (!current.rows[0]) {
                return null;
            }
            if (current.rows[0].role === 'admin') {
                const adminCount = await client.query('SELECT count(*)::int AS total FROM users WHERE role = $1', ['admin']);
                if (toInteger(adminCount.rows[0]?.total) <= 1) {
                    throw adminMutationError('Cannot delete the last admin');
                }
            }
            await this.deleteSessionsForUser(userId, null, client);
            const result = await client.query(
                'DELETE FROM users WHERE id = $1 RETURNING id, username, role',
                [userId]
            );
            return result.rows[0] ? serializeUser(result.rows[0]) : null;
        };

        if (typeof this.db.withTransaction === 'function') {
            return this.db.withTransaction(runDelete);
        }
        return runDelete(this.db);
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

    async userStats(userId) {
        const user = await this.getUser(userId);
        if (!user) return null;
        const byType = await this.db.query(
            `SELECT
                coalesce(type, 'unknown') AS type,
                count(*)::int AS record_count,
                avg(score) AS average_score,
                coalesce(sum(duration), 0) AS total_duration,
                max(updated_at) AS latest_record_at
             FROM practice_records
             WHERE user_id = $1
             GROUP BY coalesce(type, 'unknown')
             ORDER BY record_count DESC, type ASC`,
            [userId]
        );
        return {
            user,
            recordCount: user.recordCount,
            averageScore: user.averageScore,
            totalStudyMinutes: user.totalStudyMinutes,
            correctAnswers: user.correctAnswers,
            totalQuestions: user.totalQuestions,
            latestRecordAt: user.latestRecordAt,
            byType: byType.rows.map(serializeTypeStats)
        };
    }

    async deletePracticeRecord(userId, recordId) {
        const result = await this.db.query(
            'DELETE FROM practice_records WHERE user_id = $1 AND id = $2',
            [userId, String(recordId)]
        );
        return result.rowCount || 0;
    }

    async recordTraffic(event) {
        const safeEvent = normalizeTrafficEvent(event);
        await this.db.query(
            `INSERT INTO traffic_events (
                occurred_at, user_id, session_id, method, path, route_group,
                status_code, duration_ms, ip_hash, user_agent, referrer
             )
             VALUES (now(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
                safeEvent.userId,
                safeEvent.sessionId,
                safeEvent.method,
                safeEvent.path,
                safeEvent.routeGroup,
                safeEvent.statusCode,
                safeEvent.durationMs,
                safeEvent.ipHash,
                safeEvent.userAgent,
                safeEvent.referrer
            ]
        );
    }

    async trafficSummary(options = {}) {
        const days = options.days;
        const limit = options.limit;
        const totals = await this.db.query(
            `SELECT
                count(*)::int AS requests,
                count(*) FILTER (WHERE route_group = 'page')::int AS page_views,
                count(DISTINCT ip_hash)::int AS unique_visitors,
                count(*) FILTER (WHERE status_code >= 400)::int AS errors,
                avg(duration_ms) AS average_duration_ms
             FROM traffic_events
             WHERE occurred_at >= now() - ($1::int * interval '1 day')`,
            [days]
        );
        const daily = await this.db.query(
            `SELECT
                to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') AS day,
                count(*)::int AS requests,
                count(*) FILTER (WHERE route_group = 'page')::int AS page_views,
                count(DISTINCT ip_hash)::int AS unique_visitors,
                count(*) FILTER (WHERE status_code >= 400)::int AS errors
             FROM traffic_events
             WHERE occurred_at >= now() - ($1::int * interval '1 day')
             GROUP BY date_trunc('day', occurred_at)
             ORDER BY day ASC`,
            [days]
        );
        const topPaths = await this.db.query(
            `SELECT
                path,
                route_group,
                count(*)::int AS requests,
                count(DISTINCT ip_hash)::int AS unique_visitors,
                max(occurred_at) AS last_seen_at
             FROM traffic_events
             WHERE occurred_at >= now() - ($1::int * interval '1 day')
             GROUP BY path, route_group
             ORDER BY requests DESC, path ASC
             LIMIT $2`,
            [days, limit]
        );
        const routeGroups = await this.db.query(
            `SELECT
                route_group,
                count(*)::int AS requests,
                count(*) FILTER (WHERE status_code >= 400)::int AS errors,
                avg(duration_ms) AS average_duration_ms
             FROM traffic_events
             WHERE occurred_at >= now() - ($1::int * interval '1 day')
             GROUP BY route_group
             ORDER BY requests DESC, route_group ASC`,
            [days]
        );
        const statusCodes = await this.db.query(
            `SELECT
                CASE
                    WHEN status_code >= 500 THEN '5xx'
                    WHEN status_code >= 400 THEN '4xx'
                    WHEN status_code >= 300 THEN '3xx'
                    WHEN status_code >= 200 THEN '2xx'
                    ELSE 'other'
                END AS status_class,
                count(*)::int AS requests
             FROM traffic_events
             WHERE occurred_at >= now() - ($1::int * interval '1 day')
             GROUP BY status_class
             ORDER BY status_class ASC`,
            [days]
        );
        const recent = await this.db.query(
            `SELECT occurred_at, method, path, route_group, status_code, duration_ms, user_id
             FROM traffic_events
             WHERE occurred_at >= now() - ($1::int * interval '1 day')
             ORDER BY occurred_at DESC
             LIMIT $2`,
            [days, limit]
        );
        const row = totals.rows[0] || {};
        return {
            days,
            requests: toInteger(row.requests),
            pageViews: toInteger(row.page_views),
            uniqueVisitors: toInteger(row.unique_visitors),
            errors: toInteger(row.errors),
            averageDurationMs: roundNumber(row.average_duration_ms),
            daily: daily.rows.map(serializeTrafficDaily),
            topPaths: topPaths.rows.map(serializeTrafficPath),
            routeGroups: routeGroups.rows.map(serializeTrafficGroup),
            statusCodes: statusCodes.rows.map(serializeTrafficStatus),
            recent: recent.rows.map(serializeTrafficEvent)
        };
    }
}

class MemoryAdminStore {
    constructor(options = {}) {
        this.authStore = options.authStore;
        this.practiceStore = options.practiceStore;
        this.totpStore = options.totpStore;
        this.sessionStore = options.sessionStore;
        this.maxTrafficEvents = Math.max(1, toInteger(options.maxTrafficEvents || DEFAULT_MEMORY_TRAFFIC_MAX_EVENTS));
        this.trafficEvents = [];
    }

    _users() {
        return Array.from(this.authStore?.users?.values?.() || []);
    }

    _records(userId) {
        return this.practiceStore?.recordsByUser?.get(userId) || [];
    }

    _findUser(userId) {
        return this._users().find((user) => user.id === userId) || null;
    }

    async summary() {
        const users = this._users();
        const records = users.flatMap((user) => this._records(user.id));
        const scores = records.map((record) => Number(record.score)).filter(Number.isFinite);
        const duration = records.reduce((sum, record) => sum + (Number(record.duration) || 0), 0);
        return {
            userCount: users.length,
            adminCount: users.filter((user) => user.role === 'admin').length,
            practiceRecordCount: records.length,
            activeUserCount: users.filter((user) => this._records(user.id).length > 0).length,
            averageScore: scores.length ? roundNumber(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
            totalStudyMinutes: roundNumber(duration),
            correctAnswers: records.reduce((sum, record) => sum + (Number(record.correctAnswers) || 0), 0),
            totalQuestions: records.reduce((sum, record) => sum + (Number(record.totalQuestions) || 0), 0),
            latestRecordAt: records.reduce((latest, record) => {
                const value = record.updatedAt || record.date || record.createdAt || null;
                if (!value) return latest;
                return !latest || Number(new Date(value)) > Number(new Date(latest)) ? value : latest;
            }, null),
            traffic: this._trafficTotals(this.trafficEvents)
        };
    }

    async globalStats() {
        const summary = await this.summary();
        const byType = new Map();
        for (const user of this._users()) {
            for (const record of this._records(user.id)) {
                const type = record.type || record.examType || 'unknown';
                const entry = byType.get(type) || { type, recordCount: 0, scoreTotal: 0, scoreCount: 0, totalStudyMinutes: 0, latestRecordAt: null };
                const score = Number(record.score);
                const duration = Number(record.duration);
                const updatedAt = record.updatedAt || record.date || record.createdAt || null;
                entry.recordCount += 1;
                if (Number.isFinite(score)) {
                    entry.scoreTotal += score;
                    entry.scoreCount += 1;
                }
                if (Number.isFinite(duration)) entry.totalStudyMinutes += duration;
                if (updatedAt && (!entry.latestRecordAt || Number(new Date(updatedAt)) > Number(new Date(entry.latestRecordAt)))) {
                    entry.latestRecordAt = updatedAt;
                }
                byType.set(type, entry);
            }
        }
        return {
            ...summary,
            byType: Array.from(byType.values()).map((entry) => ({
                type: entry.type,
                recordCount: entry.recordCount,
                averageScore: entry.scoreCount ? roundNumber(entry.scoreTotal / entry.scoreCount) : null,
                totalStudyMinutes: roundNumber(entry.totalStudyMinutes),
                latestRecordAt: entry.latestRecordAt
            }))
        };
    }

    async analytics(options = {}) {
        const days = options.days || 30;
        const limit = options.limit || 10;
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        const dailyLearning = new Map();
        const userGrowth = new Map();
        const scoreBuckets = new Map();
        const topUsers = [];

        for (const user of this._users()) {
            const createdAt = Number(new Date(user.createdAt || user.created_at || Date.now()));
            if (createdAt >= cutoff) {
                const day = new Date(createdAt).toISOString().slice(0, 10);
                const entry = userGrowth.get(day) || { day, users: 0, admins: 0 };
                entry.users += 1;
                if (user.role === 'admin') entry.admins += 1;
                userGrowth.set(day, entry);
            }

            const recentRecords = this._records(user.id).filter((record) => {
                const timestamp = Number(new Date(record.updatedAt || record.date || record.createdAt || Date.now()));
                return timestamp >= cutoff;
            });
            if (recentRecords.length) {
                topUsers.push(buildUserStats(user, recentRecords).user);
            }
            for (const record of recentRecords) {
                const timestamp = Number(new Date(record.updatedAt || record.date || record.createdAt || Date.now()));
                const day = new Date(timestamp).toISOString().slice(0, 10);
                const score = Number(record.score);
                const duration = Number(record.duration);
                const entry = dailyLearning.get(day) || {
                    day,
                    records: 0,
                    users: new Set(),
                    scoreTotal: 0,
                    scoreCount: 0,
                    totalStudyMinutes: 0
                };
                entry.records += 1;
                entry.users.add(user.id);
                if (Number.isFinite(score)) {
                    entry.scoreTotal += score;
                    entry.scoreCount += 1;
                }
                if (Number.isFinite(duration)) entry.totalStudyMinutes += duration;
                dailyLearning.set(day, entry);

                const bucket = !Number.isFinite(score)
                    ? 'No score'
                    : (score < 40 ? '0-39' : (score < 60 ? '40-59' : (score < 80 ? '60-79' : '80-100')));
                scoreBuckets.set(bucket, (scoreBuckets.get(bucket) || 0) + 1);
            }
        }

        return {
            days,
            dailyLearning: Array.from(dailyLearning.values())
                .sort((a, b) => a.day.localeCompare(b.day))
                .map((entry) => ({
                    day: entry.day,
                    records: entry.records,
                    activeUsers: entry.users.size,
                    averageScore: entry.scoreCount ? roundNumber(entry.scoreTotal / entry.scoreCount) : null,
                    totalStudyMinutes: roundNumber(entry.totalStudyMinutes)
                })),
            userGrowth: Array.from(userGrowth.values()).sort((a, b) => a.day.localeCompare(b.day)),
            topUsers: topUsers
                .sort((a, b) => b.recordCount - a.recordCount || (b.averageScore || 0) - (a.averageScore || 0))
                .slice(0, limit),
            scoreBuckets: ['0-39', '40-59', '60-79', '80-100', 'No score']
                .filter((bucket) => scoreBuckets.has(bucket))
                .map((bucket) => ({ bucket, records: scoreBuckets.get(bucket) }))
        };
    }

    async listUsers(options = {}) {
        const q = normalizeAdminSearchQuery(options.q);
        const role = options.role === 'admin' || options.role === 'user' ? options.role : 'all';
        const filtered = this._users()
            .filter((user) => !q || user.username.toLowerCase().includes(q))
            .filter((user) => role === 'all' || user.role === role)
            .sort((a, b) => a.username.localeCompare(b.username));
        const users = filtered
            .slice(options.offset, options.offset + options.limit)
            .map((user) => buildUserStats(user, this._records(user.id)).user);
        return {
            users,
            total: filtered.length,
            limit: options.limit,
            offset: options.offset,
            role
        };
    }

    async getUser(userId) {
        const user = this._findUser(userId);
        return user ? buildUserStats(user, this._records(userId)).user : null;
    }

    async createUser({ username, password, role }) {
        const usernameValue = normalizeUsername(username);
        const usernameLower = usernameValue.toLowerCase();
        if (this.authStore.users.has(usernameLower)) {
            const error = new Error('duplicate user');
            error.code = '23505';
            throw error;
        }
        const user = {
            id: crypto.randomUUID(),
            username: usernameValue,
            username_lower: usernameLower,
            password_hash: await hashPassword(password, 4),
            role: normalizeRole(role),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        this.authStore.users.set(usernameLower, user);
        return serializeUser(user);
    }

    async updateUser(userId, changes = {}) {
        const user = this._findUser(userId);
        if (!user) return null;
        if (changes.role !== undefined) {
            const nextRole = normalizeRole(changes.role);
            if (user.role === 'admin' && nextRole === 'user' && await this.countAdmins() <= 1) {
                throw adminMutationError('Cannot demote the last admin');
            }
            user.role = nextRole;
        }
        if (changes.password !== undefined) user.password_hash = await hashPassword(changes.password, 4);
        user.updatedAt = new Date().toISOString();
        return serializeUser(user);
    }

    async countAdmins() {
        return this._users().filter((user) => user.role === 'admin').length;
    }

    async deleteSessionsForUser(userId, exceptSid = null) {
        const store = this.sessionStore;
        if (!store || typeof store.destroy !== 'function') {
            return;
        }
        let entries = [];
        if (store.sessions && typeof store.sessions === 'object') {
            entries = Object.entries(store.sessions).map(([sid, raw]) => [sid, parseMemorySessionValue(raw)]);
        } else if (typeof store.all === 'function') {
            const sessions = await new Promise((resolve, reject) => {
                store.all((error, items) => error ? reject(error) : resolve(items || {}));
            });
            entries = Array.isArray(sessions)
                ? sessions.map((value, index) => [value?.id || String(index), value])
                : Object.entries(sessions);
        }
        await Promise.all(entries
            .filter(([sid, value]) => {
                if (exceptSid && sid === exceptSid) return false;
                return value?.user?.id === userId
                    || value?.pendingTotpLogin?.user?.id === userId
                    || value?.pendingTotpSetup?.user?.id === userId;
            })
            .map(([sid]) => new Promise((resolve, reject) => {
                store.destroy(sid, (error) => error ? reject(error) : resolve());
            })));
    }

    async deleteUser(userId) {
        const user = this._findUser(userId);
        if (!user) return null;
        if (user.role === 'admin' && await this.countAdmins() <= 1) {
            throw adminMutationError('Cannot delete the last admin');
        }
        await this.deleteSessionsForUser(userId);
        this.authStore.users.delete(String(user.username || '').toLowerCase());
        if (this.practiceStore?.recordsByUser) {
            this.practiceStore.recordsByUser.delete(userId);
        }
        if (this.totpStore && typeof this.totpStore.disable === 'function') {
            await this.totpStore.disable(userId);
        }
        return serializeUser(user);
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

    async userStats(userId) {
        const user = this._findUser(userId);
        if (!user) return null;
        return buildUserStats(user, this._records(userId));
    }

    async deletePracticeRecord(userId, recordId) {
        if (!this.practiceStore || typeof this.practiceStore.deleteById !== 'function') {
            return 0;
        }
        return this.practiceStore.deleteById(userId, recordId);
    }

    async recordTraffic(event) {
        const safeEvent = normalizeTrafficEvent(event);
        this.trafficEvents.push({
            ...safeEvent,
            occurredAt: new Date().toISOString()
        });
        if (this.trafficEvents.length > this.maxTrafficEvents) {
            this.trafficEvents.splice(0, this.trafficEvents.length - this.maxTrafficEvents);
        }
    }

    _trafficTotals(events) {
        const today = new Date().toISOString().slice(0, 10);
        return {
            totalRequests: events.length,
            totalPageViews: events.filter((event) => event.routeGroup === 'page').length,
            uniqueVisitors: new Set(events.map((event) => event.ipHash).filter(Boolean)).size,
            requestsToday: events.filter((event) => String(event.occurredAt || '').slice(0, 10) === today).length,
            pageViewsToday: events.filter((event) => event.routeGroup === 'page' && String(event.occurredAt || '').slice(0, 10) === today).length
        };
    }

    async trafficSummary(options = {}) {
        const days = options.days || 14;
        const limit = options.limit || 10;
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        const events = this.trafficEvents.filter((event) => Number(new Date(event.occurredAt)) >= cutoff);
        const byDay = new Map();
        const byPath = new Map();
        const byRouteGroup = new Map();
        const byStatusClass = new Map();
        for (const event of events) {
            const day = String(event.occurredAt || '').slice(0, 10);
            const daily = byDay.get(day) || { day, requests: 0, pageViews: 0, visitors: new Set(), errors: 0 };
            daily.requests += 1;
            if (event.routeGroup === 'page') daily.pageViews += 1;
            if (event.ipHash) daily.visitors.add(event.ipHash);
            if (event.statusCode >= 400) daily.errors += 1;
            byDay.set(day, daily);
            const pathKey = `${event.routeGroup}:${event.path}`;
            const pathEntry = byPath.get(pathKey) || { path: event.path, routeGroup: event.routeGroup, requests: 0, visitors: new Set(), lastSeenAt: event.occurredAt };
            pathEntry.requests += 1;
            if (event.ipHash) pathEntry.visitors.add(event.ipHash);
            if (Number(new Date(event.occurredAt)) > Number(new Date(pathEntry.lastSeenAt))) pathEntry.lastSeenAt = event.occurredAt;
            byPath.set(pathKey, pathEntry);

            const groupKey = event.routeGroup || 'other';
            const routeGroup = byRouteGroup.get(groupKey) || { group: groupKey, requests: 0, errors: 0, durationTotal: 0 };
            routeGroup.requests += 1;
            if (event.statusCode >= 400) routeGroup.errors += 1;
            routeGroup.durationTotal += event.durationMs || 0;
            byRouteGroup.set(groupKey, routeGroup);

            const statusCode = Number(event.statusCode);
            const statusClass = statusCode >= 500 ? '5xx'
                : (statusCode >= 400 ? '4xx'
                    : (statusCode >= 300 ? '3xx'
                        : (statusCode >= 200 ? '2xx' : 'other')));
            byStatusClass.set(statusClass, (byStatusClass.get(statusClass) || 0) + 1);
        }
        return {
            days,
            requests: events.length,
            pageViews: events.filter((event) => event.routeGroup === 'page').length,
            uniqueVisitors: new Set(events.map((event) => event.ipHash).filter(Boolean)).size,
            errors: events.filter((event) => event.statusCode >= 400).length,
            averageDurationMs: events.length ? roundNumber(events.reduce((sum, event) => sum + (event.durationMs || 0), 0) / events.length) : 0,
            daily: Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day)).map((entry) => ({
                day: entry.day,
                requests: entry.requests,
                pageViews: entry.pageViews,
                uniqueVisitors: entry.visitors.size,
                errors: entry.errors
            })),
            topPaths: Array.from(byPath.values())
                .sort((a, b) => b.requests - a.requests || a.path.localeCompare(b.path))
                .slice(0, limit)
                .map((entry) => ({
                    path: entry.path,
                    routeGroup: entry.routeGroup,
                    requests: entry.requests,
                    uniqueVisitors: entry.visitors.size,
                    lastSeenAt: entry.lastSeenAt
                })),
            routeGroups: Array.from(byRouteGroup.values())
                .sort((a, b) => b.requests - a.requests || a.group.localeCompare(b.group))
                .map((entry) => ({
                    group: entry.group,
                    requests: entry.requests,
                    errors: entry.errors,
                    averageDurationMs: entry.requests ? roundNumber(entry.durationTotal / entry.requests) : 0
                })),
            statusCodes: Array.from(byStatusClass.entries())
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([statusClass, requests]) => ({ statusClass, requests })),
            recent: events.slice(-limit).reverse().map(serializeTrafficEvent)
        };
    }
}

function parseQuery(schema, query, message) {
    const parsed = schema.safeParse(query || {});
    if (!parsed.success) {
        const error = new Error(message);
        error.status = 400;
        error.details = parsed.error.flatten();
        throw error;
    }
    return parsed.data;
}

function parseParam(schema, value, message) {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
        const error = new Error(message);
        error.status = 400;
        error.details = parsed.error.flatten();
        throw error;
    }
    return parsed.data;
}

function parseListQuery(query) {
    return parseQuery(listQuerySchema, query, 'Invalid list query');
}

function parseTrafficQuery(query) {
    return parseQuery(trafficQuerySchema, query, 'Invalid traffic query');
}

function parseAnalyticsQuery(query) {
    return parseQuery(analyticsQuerySchema, query, 'Invalid analytics query');
}

function parseUserIdParam(value) {
    return parseParam(userIdParamSchema, value, 'Invalid user id');
}

function parseRecordIdParam(value) {
    try {
        return requireRecordId(value, 'recordId');
    } catch (error) {
        error.message = 'Invalid record id';
        throw error;
    }
}

function validateNewPassword(password) {
    const passwordCheck = validatePasswordStrength(password);
    if (!passwordCheck.valid) {
        const error = new Error('Password strength is insufficient');
        error.status = 400;
        error.details = passwordCheck.errors;
        throw error;
    }
}

function regenerateSession(req) {
    return new Promise((resolve, reject) => {
        req.session.regenerate((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

function sendError(res, error) {
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600
        ? error.status
        : 500;
    const safeError = status >= 500 ? 'Request failed' : (error.message || 'Request failed');
    const payload = { error: safeError };
    if (status < 500 && error.details !== undefined) {
        payload.details = error.details;
    }
    return res.status(status).json(payload);
}

function createAdminRouter(options = {}) {
    const express = require('express');
    const router = express.Router();
    const store = options.store || new PostgresAdminStore(options.db);
    const requireAdminTotp = options.requireAdminTotp || ((req, res, next) => next());
    const checkRateLimit = options.checkRateLimit || createRateLimiter(options.rateLimit);
    const totpVerificationMaxAgeMs = resolveTotpVerificationMaxAgeMs({
        verificationMaxAgeMs: options.totpVerificationMaxAgeMs
    });

    function checkAdminMutationRateLimit(req, action) {
        const adminId = req.session?.user?.id || 'unknown';
        const ip = req.ip || 'unknown';
        checkRateLimit(`admin-mutation-ip:${ip}`);
        checkRateLimit(`admin-mutation-user:${adminId}`);
        checkRateLimit(`admin-mutation-action:${action}:${ip}:${adminId}`);
    }

    router.use(requireAuth);
    router.use(async (req, res, next) => {
        try {
            if (req.session?.user?.id && typeof store.getUser === 'function') {
                const current = await store.getUser(req.session.user.id);
                if (!current) {
                    delete req.session.user;
                    return res.status(401).json({ error: 'Authentication required' });
                }
                req.session.user = publicUser(current);
            }
            return next();
        } catch (error) {
            return next(error);
        }
    });
    router.use(requireAdmin);
    router.use(requireAdminTotp);

    router.get('/summary', async (req, res, next) => {
        try {
            return res.json(await store.summary());
        } catch (error) {
            return next(error);
        }
    });

    router.get('/stats', async (req, res, next) => {
        try {
            return res.json(await store.globalStats());
        } catch (error) {
            return next(error);
        }
    });

    router.get('/traffic', async (req, res, next) => {
        try {
            return res.json(await store.trafficSummary(parseTrafficQuery(req.query)));
        } catch (error) {
            return next(error);
        }
    });

    router.get('/analytics', async (req, res, next) => {
        try {
            return res.json(await store.analytics(parseAnalyticsQuery(req.query)));
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

    router.post('/users', verifyCsrfToken, async (req, res, next) => {
        try {
            checkAdminMutationRateLimit(req, 'create-user');
            const parsed = createUserSchema.safeParse(req.body || {});
            if (!parsed.success) {
                return res.status(400).json({ error: 'Invalid user payload', details: parsed.error.flatten() });
            }
            validateNewPassword(parsed.data.password);
            try {
                const user = await store.createUser(parsed.data);
                return res.status(201).json({ user });
            } catch (error) {
                if (error && error.code === '23505') {
                    return res.status(409).json({ error: 'Username already exists' });
                }
                throw error;
            }
        } catch (error) {
            if (error.status) return sendError(res, error);
            return next(error);
        }
    });

    router.get('/users/:userId/stats', async (req, res, next) => {
        try {
            const userId = parseUserIdParam(req.params.userId);
            const stats = await store.userStats(userId);
            if (!stats) {
                return res.status(404).json({ error: 'User not found' });
            }
            return res.json(stats);
        } catch (error) {
            return next(error);
        }
    });

    router.patch('/users/:userId', verifyCsrfToken, async (req, res, next) => {
        try {
            const userId = parseUserIdParam(req.params.userId);
            checkAdminMutationRateLimit(req, 'update-user');
            const parsed = updateUserSchema.safeParse(req.body || {});
            if (!parsed.success) {
                return res.status(400).json({ error: 'Invalid user update', details: parsed.error.flatten() });
            }
            const current = await store.getUser(userId);
            if (!current) {
                return res.status(404).json({ error: 'User not found' });
            }
            if (parsed.data.password !== undefined) {
                validateNewPassword(parsed.data.password);
            }
            if (current.id === req.session.user.id && parsed.data.role && parsed.data.role !== 'admin') {
                return res.status(400).json({ error: 'You cannot remove your own admin role' });
            }
            if (current.role === 'admin' && parsed.data.role === 'user' && await store.countAdmins() <= 1) {
                return res.status(400).json({ error: 'Cannot demote the last admin' });
            }
            const user = await store.updateUser(userId, parsed.data);
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            if (typeof store.deleteSessionsForUser === 'function') {
                await store.deleteSessionsForUser(userId, req.sessionID);
            }
            if (current.id === req.session.user.id && parsed.data.password !== undefined) {
                const preserveTotpVerification = hasSessionTotpVerification(req, req.session.user, totpVerificationMaxAgeMs);
                await regenerateSession(req);
                req.session.user = publicUser(user);
                if (preserveTotpVerification) {
                    markSessionTotpVerified(req, req.session.user);
                }
                return res.json({ user: req.session.user, csrfToken: ensureCsrfToken(req) });
            }
            return res.json({ user });
        } catch (error) {
            if (error.status) return sendError(res, error);
            return next(error);
        }
    });

    router.delete('/users/:userId', verifyCsrfToken, async (req, res, next) => {
        try {
            const userId = parseUserIdParam(req.params.userId);
            checkAdminMutationRateLimit(req, 'delete-user');
            const current = await store.getUser(userId);
            if (!current) {
                return res.status(404).json({ error: 'User not found' });
            }
            if (current.id === req.session.user.id) {
                return res.status(400).json({ error: 'You cannot delete your own account from admin' });
            }
            if (current.role === 'admin' && await store.countAdmins() <= 1) {
                return res.status(400).json({ error: 'Cannot delete the last admin' });
            }
            const user = await store.deleteUser(userId);
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            return res.json({ deleted: Boolean(user), user });
        } catch (error) {
            return next(error);
        }
    });

    router.get('/users/:userId/practice-records', async (req, res, next) => {
        try {
            const userId = parseUserIdParam(req.params.userId);
            const query = parseListQuery(req.query);
            const user = await store.getUser(userId);
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            return res.json(await store.listPracticeRecords(userId, query));
        } catch (error) {
            return next(error);
        }
    });

    router.delete('/users/:userId/practice-records/:recordId', verifyCsrfToken, async (req, res, next) => {
        try {
            const userId = parseUserIdParam(req.params.userId);
            const recordId = parseRecordIdParam(req.params.recordId);
            checkAdminMutationRateLimit(req, 'delete-practice-record');
            const user = await store.getUser(userId);
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            const removed = await store.deletePracticeRecord(userId, recordId);
            if (!removed) {
                return res.status(404).json({ error: 'Record not found' });
            }
            return res.json({ removed });
        } catch (error) {
            return next(error);
        }
    });

    return router;
}

function classifyRouteGroup(pathname) {
    const path = normalizeRequestPath(pathname);
    if (path === '/' || path === '/admin' || path === '/admin/') {
        return 'page';
    }
    if (path.startsWith('/api/')) {
        return 'api';
    }
    if (
        path.startsWith('/assets/')
        || path.startsWith('/css/')
        || path.startsWith('/js/')
        || path.startsWith('/templates/')
        || path.startsWith('/ListeningPractice/')
        || path.startsWith('/admin/')
    ) {
        return 'asset';
    }
    return 'page';
}

function hashVisitor(req, secret) {
    const source = [
        req.ip || '',
        normalizeUserAgent(req.get('user-agent')) || '',
        normalizeTrafficLanguage(req.get('accept-language')) || ''
    ].join('|');
    return crypto.createHmac('sha256', secret).update(source).digest('hex');
}

function hashTrafficIdentifier(value, secret) {
    if (!value) {
        return null;
    }
    return crypto.createHmac('sha256', secret).update(String(value)).digest('hex');
}

function createTrafficMiddleware(options = {}) {
    const store = options.store;
    const enabled = options.enabled !== false && store && typeof store.recordTraffic === 'function';
    if (!enabled) {
        return (req, res, next) => next();
    }
    const secret = options.secret || process.env.TRAFFIC_SECRET || process.env.SESSION_SECRET || 'traffic-development-secret';
    const production = (options.nodeEnv || process.env.NODE_ENV) === 'production';
    const weakSecret = !secret
        || secret === 'traffic-development-secret'
        || secret === 'development-session-secret-change-me'
        || secret === 'replace-with-a-long-random-session-secret'
        || String(secret).length < 32;
    if (production && weakSecret) {
        throw new Error('TRAFFIC_SECRET or SESSION_SECRET must be set to a non-placeholder value of at least 32 characters in production');
    }
    return (req, res, next) => {
        const startedAt = Date.now();
        res.on('finish', () => {
            if (req.path === '/api/health') {
                return;
            }
            const event = normalizeTrafficEvent({
                userId: req.session?.user?.id || null,
                sessionId: hashTrafficIdentifier(req.sessionID, secret),
                method: req.method,
                path: req.path || '/',
                routeGroup: classifyRouteGroup(req.path || '/'),
                statusCode: res.statusCode,
                durationMs: Math.max(0, Date.now() - startedAt),
                ipHash: hashVisitor(req, secret),
                userAgent: req.get('user-agent') || '',
                referrer: req.get('referer') || ''
            });
            Promise.resolve(store.recordTraffic(event)).catch((error) => {
                console.error('[backend] traffic record failed:', summarizeAdminErrorForLog(error));
            });
        });
        return next();
    };
}

module.exports = {
    MemoryAdminStore,
    PostgresAdminStore,
    classifyRouteGroup,
    createAdminRouter,
    createTrafficMiddleware,
    normalizeAdminSearchQuery,
    normalizeTrafficEvent,
    parseAnalyticsQuery,
    parseListQuery,
    parseUserIdParam,
    parseTrafficQuery,
    sanitizeAdminRecordPayload,
    serializeRecord,
    serializeUser
};
