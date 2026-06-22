const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { z } = require('zod');

const USERNAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_-]{2,31}$/;
const INVALID_CREDENTIAL_FORMAT_ERROR = 'Username or password format is invalid';
const INVALID_CREDENTIALS_ERROR = 'Username or password is incorrect';
const DUMMY_PASSWORD_HASH = '$2a$12$OOrmAQgyb0OR42FfRf/D6.GOTtaUGKbmYgyZT2MoQOJMTFTxYjNG.';
const MAX_MEMORY_SESSION_JSON_LENGTH = 256 * 1024;
const MAX_BCRYPT_PASSWORD_BYTES = 72;
const MAX_RATE_LIMIT_KEY_LENGTH = 256;

const credentialsSchema = z.object({
    username: z.string().trim().min(3).max(32).regex(USERNAME_PATTERN),
    password: z.string().min(1).max(128)
});

const updateUsernameSchema = z.object({
    username: z.string().trim().min(3).max(32).regex(USERNAME_PATTERN),
    password: z.string().min(1).max(128)
});

const updatePasswordSchema = z.object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(1).max(128)
});

const deleteAccountSchema = z.object({
    password: z.string().min(1).max(128),
    confirm: z.string().trim().min(1).max(64)
});

function publicUser(user) {
    if (!user) return null;
    return {
        id: user.id,
        username: user.username,
        role: user.role === 'admin' ? 'admin' : 'user'
    };
}

function normalizeUsername(username) {
    return String(username || '').trim();
}

function isPasswordWithinBcryptByteLimit(password) {
    return typeof password === 'string'
        && Buffer.byteLength(password, 'utf8') <= MAX_BCRYPT_PASSWORD_BYTES;
}

function validatePasswordStrength(password) {
    const errors = [];
    if (typeof password !== 'string' || password.length < 8) {
        errors.push('Password must be at least 8 characters long');
    }
    if (typeof password === 'string' && password.length > 128) {
        errors.push('Password must not exceed 128 characters');
    }
    if (typeof password === 'string' && !isPasswordWithinBcryptByteLimit(password)) {
        errors.push('Password must not exceed 72 UTF-8 bytes');
    }
    if (!/[a-z]/.test(password || '')) {
        errors.push('Password must include a lowercase letter');
    }
    if (!/[A-Z]/.test(password || '')) {
        errors.push('Password must include an uppercase letter');
    }
    if (!/[0-9]/.test(password || '')) {
        errors.push('Password must include a number');
    }
    return {
        valid: errors.length === 0,
        errors
    };
}

function parseBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parseMemorySessionValue(raw) {
    if (!raw) return null;
    if (typeof raw !== 'string') return raw;
    if (raw.length > MAX_MEMORY_SESSION_JSON_LENGTH) return null;
    try {
        return JSON.parse(raw);
    } catch (_) {
        return null;
    }
}

function normalizeRateLimitKey(key) {
    let text;
    try {
        text = String(key || 'unknown');
    } catch (_) {
        text = 'unknown';
    }
    const normalized = text.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim() || 'unknown';
    if (normalized.length <= MAX_RATE_LIMIT_KEY_LENGTH) {
        return normalized;
    }
    return `sha256:${crypto.createHash('sha256').update(normalized).digest('hex')}`;
}

function createRateLimiter(options = {}) {
    const windowMs = options.windowMs || 10 * 60 * 1000;
    const maxAttempts = options.maxAttempts || 20;
    const maxKeys = Number.isInteger(options.maxKeys) && options.maxKeys > 0 ? options.maxKeys : 10_000;
    const attempts = new Map();

    function pruneExpired(now) {
        for (const [entryKey, entry] of attempts.entries()) {
            if (!entry || entry.resetAt <= now) {
                attempts.delete(entryKey);
            }
        }
    }

    function pruneOverflow() {
        while (attempts.size > maxKeys) {
            const firstKey = attempts.keys().next().value;
            attempts.delete(firstKey);
        }
    }

    function checkRateLimit(key) {
        const now = Date.now();
        const safeKey = normalizeRateLimitKey(key);
        const entry = attempts.get(safeKey);
        if (!entry || entry.resetAt <= now) {
            if (attempts.size >= maxKeys) {
                pruneExpired(now);
            }
            attempts.set(safeKey, { count: 1, resetAt: now + windowMs });
            pruneOverflow();
            return;
        }
        entry.count += 1;
        attempts.delete(safeKey);
        attempts.set(safeKey, entry);
        if (entry.count > maxAttempts) {
            const error = new Error('Too many requests, please try again later');
            error.status = 429;
            throw error;
        }
    }

    checkRateLimit.size = () => attempts.size;
    return checkRateLimit;
}

function ensureCsrfToken(req) {
    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }
    return req.session.csrfToken;
}

function verifyCsrfToken(req, res, next) {
    const expected = req.session && req.session.csrfToken;
    const actual = req.get('x-csrf-token');
    if (!safeTokenEqual(expected, actual)) {
        return res.status(403).json({ error: 'CSRF token invalid' });
    }
    return next();
}

function safeTokenEqual(expected, actual) {
    if (typeof expected !== 'string' || typeof actual !== 'string') {
        return false;
    }
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const actualBuffer = Buffer.from(actual, 'utf8');
    if (expectedBuffer.length === 0 || expectedBuffer.length !== actualBuffer.length) {
        return false;
    }
    return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function requireAuth(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    req.session.user = publicUser(req.session.user);
    return next();
}

function requireAdmin(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    req.session.user = publicUser(req.session.user);
    if (req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    return next();
}

function regenerateSession(req) {
    return new Promise((resolve, reject) => {
        req.session.regenerate((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

function destroySession(req) {
    return new Promise((resolve, reject) => {
        req.session.destroy((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

function getSessionTotpVerificationMarker(req, user) {
    const safeUser = publicUser(user);
    const marker = req.session && req.session.totpVerified;
    const verifiedAt = Number(marker?.verifiedAt);
    if (
        safeUser?.id
        && marker?.userId === safeUser.id
        && Number.isFinite(verifiedAt)
        && verifiedAt > 0
    ) {
        return {
            userId: marker.userId,
            verifiedAt
        };
    }
    return null;
}

function restoreSessionTotpVerification(req, marker, user) {
    const safeUser = publicUser(user);
    if (!req.session || !marker || !safeUser?.id || marker.userId !== safeUser.id) {
        return;
    }
    req.session.totpVerified = {
        userId: marker.userId,
        verifiedAt: marker.verifiedAt
    };
}

function authMutationError(message, status = 409) {
    const error = new Error(message);
    error.status = status;
    return error;
}

class PostgresAuthStore {
    constructor(db) {
        this.db = db;
    }

    async findByUsernameLower(usernameLower) {
        const result = await this.db.query(
            'SELECT id, username, username_lower, password_hash, role FROM users WHERE username_lower = $1',
            [usernameLower]
        );
        return result.rows[0] || null;
    }

    async findById(userId) {
        const result = await this.db.query(
            'SELECT id, username, username_lower, password_hash, role FROM users WHERE id = $1',
            [userId]
        );
        return result.rows[0] || null;
    }

    async createUser({ username, usernameLower, passwordHash }) {
        const result = await this.db.query(
            `INSERT INTO users (username, username_lower, password_hash)
             VALUES ($1, $2, $3)
             RETURNING id, username, username_lower, password_hash, role`,
            [username, usernameLower, passwordHash]
        );
        return result.rows[0];
    }

    async updateUsername(userId, { username, usernameLower }) {
        const result = await this.db.query(
            `UPDATE users
             SET username = $2, username_lower = $3
             WHERE id = $1
             RETURNING id, username, username_lower, password_hash, role`,
            [userId, username, usernameLower]
        );
        return result.rows[0] || null;
    }

    async updatePassword(userId, passwordHash) {
        const result = await this.db.query(
            `UPDATE users
             SET password_hash = $2
             WHERE id = $1
             RETURNING id, username, username_lower, password_hash, role`,
            [userId, passwordHash]
        );
        return result.rows[0] || null;
    }

    async countAdmins() {
        const result = await this.db.query('SELECT count(*)::int AS total FROM users WHERE role = $1', ['admin']);
        return result.rows[0]?.total || 0;
    }

    async deleteSessionsForUser(userId, exceptSid = null, client = this.db) {
        const params = [userId];
        let exceptClause = '';
        if (exceptSid) {
            params.push(exceptSid);
            exceptClause = ` AND sid <> $${params.length}`;
        }
        await client.query(
            `DELETE FROM "session"
             WHERE (sess->'user'->>'id' = $1
                OR sess->'pendingTotpLogin'->'user'->>'id' = $1
                OR sess->'pendingTotpSetup'->'user'->>'id' = $1)
                ${exceptClause}`,
            params
        );
    }

    async deleteUser(userId) {
        const runDelete = async (client) => {
            await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
            const current = await client.query(
                'SELECT id, username, username_lower, password_hash, role FROM users WHERE id = $1 FOR UPDATE',
                [userId]
            );
            if (!current.rows[0]) {
                return null;
            }
            if (publicUser(current.rows[0]).role === 'admin') {
                const adminCount = await client.query('SELECT count(*)::int AS total FROM users WHERE role = $1', ['admin']);
                if (Number(adminCount.rows[0]?.total || 0) <= 1) {
                    throw authMutationError('The last admin account cannot be deleted');
                }
            }
            await this.deleteSessionsForUser(userId, null, client);
            const result = await client.query(
                'DELETE FROM users WHERE id = $1 RETURNING id, username, username_lower, password_hash, role',
                [userId]
            );
            return result.rows[0] || null;
        };

        if (typeof this.db.withTransaction === 'function') {
            return this.db.withTransaction(runDelete);
        }
        return runDelete(this.db);
    }
}

class MemoryAuthStore {
    constructor(options = {}) {
        this.users = new Map();
        this.sessionStore = options.sessionStore || null;
    }

    async findByUsernameLower(usernameLower) {
        return this.users.get(usernameLower) || null;
    }

    async findById(userId) {
        return Array.from(this.users.values()).find((user) => user.id === userId) || null;
    }

    async createUser({ username, usernameLower, passwordHash }) {
        if (this.users.has(usernameLower)) {
            const error = new Error('duplicate user');
            error.code = '23505';
            throw error;
        }
        const user = {
            id: crypto.randomUUID(),
            username,
            username_lower: usernameLower,
            password_hash: passwordHash,
            role: 'user'
        };
        this.users.set(usernameLower, user);
        return user;
    }

    async updateUsername(userId, { username, usernameLower }) {
        const existing = await this.findById(userId);
        if (!existing) return null;
        const currentKey = String(existing.username_lower || existing.username || '').toLowerCase();
        const nextOwner = this.users.get(usernameLower);
        if (nextOwner && nextOwner.id !== userId) {
            const error = new Error('duplicate user');
            error.code = '23505';
            throw error;
        }
        this.users.delete(currentKey);
        existing.username = username;
        existing.username_lower = usernameLower;
        this.users.set(usernameLower, existing);
        return existing;
    }

    async updatePassword(userId, passwordHash) {
        const existing = await this.findById(userId);
        if (!existing) return null;
        existing.password_hash = passwordHash;
        return existing;
    }

    async countAdmins() {
        return Array.from(this.users.values()).filter((user) => user.role === 'admin').length;
    }

    async deleteSessionsForUser(userId, exceptSid = null) {
        const store = this.sessionStore;
        if (!store) return;

        const shouldDestroy = (value) => {
            return value?.user?.id === userId
                || value?.pendingTotpLogin?.user?.id === userId
                || value?.pendingTotpSetup?.user?.id === userId;
        };

        const destroy = (sid) => new Promise((resolve) => {
            store.destroy(sid, () => resolve());
        });

        if (store.sessions && typeof store.sessions === 'object') {
            const sids = Object.entries(store.sessions)
                .filter(([sid, raw]) => sid !== exceptSid && shouldDestroy(parseMemorySessionValue(raw)))
                .map(([sid]) => sid);
            await Promise.all(sids.map(destroy));
            return;
        }

        if (typeof store.all === 'function') {
            await new Promise((resolve) => {
                store.all(async (error, sessions) => {
                    if (!error && sessions) {
                        const entries = Object.entries(sessions);
                        const sids = entries
                            .filter(([sid, value]) => sid !== exceptSid && shouldDestroy(parseMemorySessionValue(value)))
                            .map(([sid]) => sid);
                        await Promise.all(sids.map(destroy));
                    }
                    resolve();
                });
            });
        }
    }

    async deleteUser(userId) {
        const existing = await this.findById(userId);
        if (!existing) return null;
        if (publicUser(existing).role === 'admin' && await this.countAdmins() <= 1) {
            throw authMutationError('The last admin account cannot be deleted');
        }
        await this.deleteSessionsForUser(userId);
        this.users.delete(String(existing.username_lower || existing.username || '').toLowerCase());
        return existing;
    }
}

function sendValidationError(res, parsed, fallbackMessage) {
    return res.status(400).json({
        error: fallbackMessage,
        details: parsed.error.flatten()
    });
}

async function getCurrentStoredUser(store, sessionUser) {
    if (!sessionUser || !sessionUser.id || typeof store.findById !== 'function') {
        return null;
    }
    return store.findById(sessionUser.id);
}

function createAuthRouter(options = {}) {
    const express = require('express');
    const router = express.Router();
    const store = options.store || new PostgresAuthStore(options.db);
    const checkRateLimit = options.checkRateLimit || createRateLimiter(options.rateLimit);
    const checkCsrfRateLimit = options.checkCsrfRateLimit || createRateLimiter(options.csrfRateLimit || {
        maxAttempts: 200,
        windowMs: 10 * 60 * 1000,
        maxKeys: 10_000
    });
    const bcryptImpl = options.bcrypt || bcrypt;
    const totpStore = options.totpStore || null;
    const onDeleteUser = typeof options.onDeleteUser === 'function'
        ? options.onDeleteUser
        : async () => {};
    const totpEnabled = options.totpEnabled !== undefined
        ? Boolean(options.totpEnabled)
        : parseBoolean(process.env.TOTP_ENABLED, true);
    const sessionCookieName = options.cookieName || 'ielts.sid';
    const clearCookieOptions = options.clearCookieOptions || {};

    router.get('/csrf', (req, res, next) => {
        try {
            checkCsrfRateLimit(`csrf-ip:${req.ip}`);
            return res.json({ csrfToken: ensureCsrfToken(req) });
        } catch (error) {
            return next(error);
        }
    });

    router.get('/me', (req, res) => {
        if (!req.session || !req.session.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        return res.json({ user: publicUser(req.session.user), csrfToken: ensureCsrfToken(req) });
    });

    router.post('/register', verifyCsrfToken, async (req, res, next) => {
        try {
            const parsed = credentialsSchema.safeParse(req.body || {});
            if (!parsed.success) {
                return res.status(400).json({ error: INVALID_CREDENTIAL_FORMAT_ERROR });
            }
            const username = normalizeUsername(parsed.data.username);
            const usernameLower = username.toLowerCase();
            checkRateLimit(`register-ip:${req.ip}`);
            checkRateLimit(`register:${req.ip}:${usernameLower}`);

            const passwordCheck = validatePasswordStrength(parsed.data.password);
            if (!passwordCheck.valid) {
                return res.status(400).json({ error: 'Password strength is insufficient', details: passwordCheck.errors });
            }

            const passwordHash = await bcryptImpl.hash(parsed.data.password, 12);
            let user;
            try {
                user = await store.createUser({ username, usernameLower, passwordHash });
            } catch (error) {
                if (error && error.code === '23505') {
                    return res.status(409).json({ error: 'Username already exists' });
                }
                throw error;
            }

            await regenerateSession(req);
            req.session.user = publicUser(user);
            const csrfToken = ensureCsrfToken(req);
            return res.status(201).json({ user: publicUser(user), csrfToken });
        } catch (error) {
            return next(error);
        }
    });

    router.post('/login', verifyCsrfToken, async (req, res, next) => {
        try {
            const parsed = credentialsSchema.safeParse(req.body || {});
            if (!parsed.success) {
                return res.status(400).json({ error: INVALID_CREDENTIAL_FORMAT_ERROR });
            }
            const username = normalizeUsername(parsed.data.username);
            const usernameLower = username.toLowerCase();
            checkRateLimit(`login-ip:${req.ip}`);
            checkRateLimit(`login:${req.ip}:${usernameLower}`);
            if (!isPasswordWithinBcryptByteLimit(parsed.data.password)) {
                await bcryptImpl.compare(parsed.data.password, DUMMY_PASSWORD_HASH);
                return res.status(401).json({ error: INVALID_CREDENTIALS_ERROR });
            }

            const user = await store.findByUsernameLower(usernameLower);
            if (!user) {
                await bcryptImpl.compare(parsed.data.password, DUMMY_PASSWORD_HASH);
                return res.status(401).json({ error: INVALID_CREDENTIALS_ERROR });
            }
            const ok = await bcryptImpl.compare(parsed.data.password, user.password_hash);
            if (!ok) {
                return res.status(401).json({ error: INVALID_CREDENTIALS_ERROR });
            }

            const safeUser = publicUser(user);
            if (totpEnabled && totpStore && typeof totpStore.getStatus === 'function') {
                const status = await totpStore.getStatus(user.id);
                if (status.enabled) {
                    await regenerateSession(req);
                    req.session.pendingTotpLogin = {
                        user: safeUser,
                        startedAt: Date.now()
                    };
                    return res.json({
                        requiresTotp: true,
                        csrfToken: ensureCsrfToken(req)
                    });
                }
                if (safeUser.role === 'admin') {
                    await regenerateSession(req);
                    req.session.pendingTotpSetup = {
                        user: safeUser,
                        forced: true,
                        startedAt: Date.now()
                    };
                    return res.json({
                        requiresTotpSetup: true,
                        user: safeUser,
                        csrfToken: ensureCsrfToken(req)
                    });
                }
            }

            await regenerateSession(req);
            req.session.user = safeUser;
            const csrfToken = ensureCsrfToken(req);
            return res.json({ user: safeUser, csrfToken });
        } catch (error) {
            return next(error);
        }
    });

    router.post('/logout', verifyCsrfToken, async (req, res, next) => {
        try {
            await destroySession(req);
            res.clearCookie(sessionCookieName, clearCookieOptions);
            return res.json({ ok: true });
        } catch (error) {
            return next(error);
        }
    });

    router.patch('/account/username', requireAuth, verifyCsrfToken, async (req, res, next) => {
        try {
            const parsed = updateUsernameSchema.safeParse(req.body || {});
            if (!parsed.success) {
                return sendValidationError(res, parsed, 'Invalid account update payload');
            }
            checkRateLimit(`account-username:${req.ip}:${req.session.user.id}`);
            const currentUser = await getCurrentStoredUser(store, req.session.user);
            if (!currentUser) {
                return res.status(401).json({ error: 'Authentication required' });
            }
            if (!isPasswordWithinBcryptByteLimit(parsed.data.password)) {
                return res.status(401).json({ error: 'Current password is incorrect' });
            }
            const passwordOk = await bcryptImpl.compare(parsed.data.password, currentUser.password_hash);
            if (!passwordOk) {
                return res.status(401).json({ error: 'Current password is incorrect' });
            }
            const username = normalizeUsername(parsed.data.username);
            const usernameLower = username.toLowerCase();
            if (usernameLower === String(currentUser.username_lower || '').toLowerCase()) {
                req.session.user = publicUser(currentUser);
                return res.json({ user: req.session.user, csrfToken: ensureCsrfToken(req) });
            }

            let updatedUser;
            try {
                updatedUser = await store.updateUsername(currentUser.id, { username, usernameLower });
            } catch (error) {
                if (error && error.code === '23505') {
                    return res.status(409).json({ error: 'Username already exists' });
                }
                throw error;
            }
            if (!updatedUser) {
                return res.status(404).json({ error: 'User not found' });
            }
            if (typeof store.deleteSessionsForUser === 'function') {
                await store.deleteSessionsForUser(currentUser.id, req.sessionID);
            }
            const totpVerification = getSessionTotpVerificationMarker(req, currentUser);
            await regenerateSession(req);
            req.session.user = publicUser(updatedUser);
            restoreSessionTotpVerification(req, totpVerification, req.session.user);
            return res.json({ user: req.session.user, csrfToken: ensureCsrfToken(req) });
        } catch (error) {
            return next(error);
        }
    });

    router.patch('/account/password', requireAuth, verifyCsrfToken, async (req, res, next) => {
        try {
            const parsed = updatePasswordSchema.safeParse(req.body || {});
            if (!parsed.success) {
                return sendValidationError(res, parsed, 'Invalid password update payload');
            }
            checkRateLimit(`account-password:${req.ip}:${req.session.user.id}`);
            const currentUser = await getCurrentStoredUser(store, req.session.user);
            if (!currentUser) {
                return res.status(401).json({ error: 'Authentication required' });
            }
            if (!isPasswordWithinBcryptByteLimit(parsed.data.currentPassword)) {
                return res.status(401).json({ error: 'Current password is incorrect' });
            }
            const passwordOk = await bcryptImpl.compare(parsed.data.currentPassword, currentUser.password_hash);
            if (!passwordOk) {
                return res.status(401).json({ error: 'Current password is incorrect' });
            }
            const passwordCheck = validatePasswordStrength(parsed.data.newPassword);
            if (!passwordCheck.valid) {
                return res.status(400).json({ error: 'Password strength is insufficient', details: passwordCheck.errors });
            }
            if (parsed.data.currentPassword === parsed.data.newPassword) {
                return res.status(400).json({ error: 'New password must be different from the current password' });
            }
            const passwordHash = await bcryptImpl.hash(parsed.data.newPassword, 12);
            const updatedUser = await store.updatePassword(currentUser.id, passwordHash);
            if (!updatedUser) {
                return res.status(404).json({ error: 'User not found' });
            }
            if (typeof store.deleteSessionsForUser === 'function') {
                await store.deleteSessionsForUser(currentUser.id, req.sessionID);
            }
            const totpVerification = getSessionTotpVerificationMarker(req, currentUser);
            await regenerateSession(req);
            req.session.user = publicUser(updatedUser);
            restoreSessionTotpVerification(req, totpVerification, req.session.user);
            return res.json({ ok: true, user: req.session.user, csrfToken: ensureCsrfToken(req) });
        } catch (error) {
            return next(error);
        }
    });

    router.delete('/account', requireAuth, verifyCsrfToken, async (req, res, next) => {
        try {
            const parsed = deleteAccountSchema.safeParse(req.body || {});
            if (!parsed.success) {
                return sendValidationError(res, parsed, 'Invalid account deletion payload');
            }
            checkRateLimit(`account-delete:${req.ip}:${req.session.user.id}`);
            const currentUser = await getCurrentStoredUser(store, req.session.user);
            if (!currentUser) {
                return res.status(401).json({ error: 'Authentication required' });
            }
            if (!isPasswordWithinBcryptByteLimit(parsed.data.password)) {
                return res.status(401).json({ error: 'Current password is incorrect' });
            }
            const passwordOk = await bcryptImpl.compare(parsed.data.password, currentUser.password_hash);
            if (!passwordOk) {
                return res.status(401).json({ error: 'Current password is incorrect' });
            }
            if (String(parsed.data.confirm || '').trim() !== currentUser.username) {
                return res.status(400).json({ error: 'Type your current username to confirm account deletion' });
            }
            if (publicUser(currentUser).role === 'admin'
                && typeof store.countAdmins === 'function'
                && await store.countAdmins() <= 1) {
                return res.status(409).json({ error: 'The last admin account cannot be deleted' });
            }
            if (typeof store.deleteSessionsForUser === 'function') {
                await store.deleteSessionsForUser(currentUser.id);
            }
            const deletedUser = await store.deleteUser(currentUser.id);
            if (!deletedUser) {
                return res.status(404).json({ error: 'User not found' });
            }
            await onDeleteUser(currentUser.id, deletedUser);
            await destroySession(req);
            res.clearCookie(sessionCookieName, clearCookieOptions);
            return res.json({ ok: true, deleted: true });
        } catch (error) {
            return next(error);
        }
    });

    return router;
}

module.exports = {
    MemoryAuthStore,
    PostgresAuthStore,
    USERNAME_PATTERN,
    createAuthRouter,
    createRateLimiter,
    ensureCsrfToken,
    isPasswordWithinBcryptByteLimit,
    normalizeRateLimitKey,
    normalizeUsername,
    publicUser,
    requireAdmin,
    requireAuth,
    validatePasswordStrength,
    verifyCsrfToken
};
