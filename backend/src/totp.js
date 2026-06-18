const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const otp = require('otplib');
const QRCode = require('qrcode');
const { z } = require('zod');
const {
    ensureCsrfToken,
    createRateLimiter,
    publicUser,
    requireAuth,
    verifyCsrfToken
} = require('./auth');

const DEFAULT_ISSUER = 'IELTS Atlas';
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_BYTES = 8;

const tokenSchema = z.object({
    token: z.string().trim().min(1).max(64)
});

const disableSchema = z.object({
    password: z.string().min(1).max(128),
    token: z.string().trim().min(1).max(64)
});

function parseBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function getTotpConfig(options = {}) {
    return {
        enabled: options.enabled !== undefined
            ? Boolean(options.enabled)
            : parseBoolean(process.env.TOTP_ENABLED, true),
        issuer: options.issuer || process.env.TOTP_ISSUER || DEFAULT_ISSUER,
        encryptionKeySource: options.encryptionKey
            || process.env.TOTP_ENCRYPTION_KEY
            || process.env.SESSION_SECRET
            || 'development-session-secret-change-me',
        epochTolerance: options.epochTolerance ?? 30,
        recoveryCodeCount: options.recoveryCodeCount || RECOVERY_CODE_COUNT,
        recoveryHashRounds: options.recoveryHashRounds || 10
    };
}

function encryptionKey(source) {
    return crypto.createHash('sha256').update(String(source)).digest();
}

function encryptSecret(secret, keySource) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(keySource), iv);
    const encrypted = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
        'v1',
        iv.toString('base64url'),
        tag.toString('base64url'),
        encrypted.toString('base64url')
    ].join(':');
}

function decryptSecret(payload, keySource) {
    const [version, ivText, tagText, encryptedText] = String(payload || '').split(':');
    if (version !== 'v1' || !ivText || !tagText || !encryptedText) {
        throw new Error('Invalid TOTP secret payload');
    }
    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        encryptionKey(keySource),
        Buffer.from(ivText, 'base64url')
    );
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([
        decipher.update(Buffer.from(encryptedText, 'base64url')),
        decipher.final()
    ]).toString('utf8');
}

function normalizeToken(value) {
    return String(value || '').replace(/\s+/g, '').trim();
}

function normalizeRecoveryCode(value) {
    return String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function formatRecoveryCode(raw) {
    return raw.match(/.{1,4}/g).join('-');
}

function generateRecoveryCodes(count = RECOVERY_CODE_COUNT) {
    return Array.from({ length: count }, () => {
        const raw = crypto.randomBytes(RECOVERY_CODE_BYTES).toString('hex').toUpperCase();
        return formatRecoveryCode(raw);
    });
}

async function hashRecoveryCodes(codes, bcryptImpl = bcrypt, rounds = 10) {
    return Promise.all(codes.map((code) => bcryptImpl.hash(normalizeRecoveryCode(code), rounds)));
}

function verifyTotpToken(token, secret, config) {
    const normalized = normalizeToken(token);
    if (!/^\d{6}$/.test(normalized)) {
        return false;
    }
    const result = otp.verifySync({
        token: normalized,
        secret,
        epochTolerance: config.epochTolerance
    });
    return Boolean(result && result.valid);
}

function serializeStatus(row, recoveryCodesRemaining = 0) {
    return {
        enabled: Boolean(row && row.enabled),
        confirmedAt: row?.confirmed_at || row?.confirmedAt || null,
        lastUsedAt: row?.last_used_at || row?.lastUsedAt || null,
        recoveryCodesRemaining: Number(recoveryCodesRemaining || 0)
    };
}

class PostgresTotpStore {
    constructor(db) {
        this.db = db;
    }

    async getStatus(userId) {
        const settings = await this.db.query(
            `SELECT enabled, confirmed_at, last_used_at
             FROM user_totp_settings
             WHERE user_id = $1`,
            [userId]
        );
        const recovery = await this.db.query(
            `SELECT count(*)::int AS remaining
             FROM user_totp_recovery_codes
             WHERE user_id = $1 AND used_at IS NULL`,
            [userId]
        );
        return serializeStatus(settings.rows[0], recovery.rows[0]?.remaining);
    }

    async getSecretPayload(userId) {
        const result = await this.db.query(
            `SELECT secret_encrypted
             FROM user_totp_settings
             WHERE user_id = $1 AND enabled = true`,
            [userId]
        );
        return result.rows[0]?.secret_encrypted || null;
    }

    async saveEnabled(userId, secretEncrypted, recoveryCodeHashes) {
        const run = async (client) => {
            const result = await client.query(
                `INSERT INTO user_totp_settings (user_id, secret_encrypted, enabled, confirmed_at, last_used_at)
                 VALUES ($1, $2, true, now(), NULL)
                 ON CONFLICT (user_id) DO UPDATE
                 SET secret_encrypted = EXCLUDED.secret_encrypted,
                     enabled = true,
                     confirmed_at = now(),
                     last_used_at = NULL
                 RETURNING enabled, confirmed_at, last_used_at`,
                [userId, secretEncrypted]
            );
            await client.query('DELETE FROM user_totp_recovery_codes WHERE user_id = $1', [userId]);
            for (const hash of recoveryCodeHashes) {
                await client.query(
                    `INSERT INTO user_totp_recovery_codes (user_id, code_hash)
                     VALUES ($1, $2)`,
                    [userId, hash]
                );
            }
            return serializeStatus(result.rows[0], recoveryCodeHashes.length);
        };

        if (typeof this.db.withTransaction === 'function') {
            return this.db.withTransaction(run);
        }
        return run(this.db);
    }

    async markUsed(userId) {
        await this.db.query(
            'UPDATE user_totp_settings SET last_used_at = now() WHERE user_id = $1',
            [userId]
        );
    }

    async replaceRecoveryCodes(userId, recoveryCodeHashes) {
        const run = async (client) => {
            await client.query('DELETE FROM user_totp_recovery_codes WHERE user_id = $1', [userId]);
            for (const hash of recoveryCodeHashes) {
                await client.query(
                    `INSERT INTO user_totp_recovery_codes (user_id, code_hash)
                     VALUES ($1, $2)`,
                    [userId, hash]
                );
            }
            return recoveryCodeHashes.length;
        };
        if (typeof this.db.withTransaction === 'function') {
            return this.db.withTransaction(run);
        }
        return run(this.db);
    }

    async consumeRecoveryCode(userId, code, bcryptImpl = bcrypt) {
        const normalized = normalizeRecoveryCode(code);
        if (!normalized) {
            return false;
        }
        const result = await this.db.query(
            `SELECT id, code_hash
             FROM user_totp_recovery_codes
             WHERE user_id = $1 AND used_at IS NULL
             ORDER BY created_at ASC`,
            [userId]
        );
        for (const row of result.rows) {
            if (await bcryptImpl.compare(normalized, row.code_hash)) {
                await this.db.query(
                    'UPDATE user_totp_recovery_codes SET used_at = now() WHERE id = $1',
                    [row.id]
                );
                await this.markUsed(userId);
                return true;
            }
        }
        return false;
    }

    async disable(userId) {
        await this.db.query('DELETE FROM user_totp_recovery_codes WHERE user_id = $1', [userId]);
        const result = await this.db.query('DELETE FROM user_totp_settings WHERE user_id = $1', [userId]);
        return result.rowCount || 0;
    }
}

class MemoryTotpStore {
    constructor() {
        this.settings = new Map();
        this.recoveryCodes = new Map();
    }

    async getStatus(userId) {
        const setting = this.settings.get(userId);
        const remaining = (this.recoveryCodes.get(userId) || []).filter((code) => !code.usedAt).length;
        return serializeStatus(setting, remaining);
    }

    async getSecretPayload(userId) {
        const setting = this.settings.get(userId);
        return setting && setting.enabled ? setting.secret_encrypted : null;
    }

    async saveEnabled(userId, secretEncrypted, recoveryCodeHashes) {
        const setting = {
            user_id: userId,
            secret_encrypted: secretEncrypted,
            enabled: true,
            confirmed_at: new Date().toISOString(),
            last_used_at: null
        };
        this.settings.set(userId, setting);
        this.recoveryCodes.set(userId, recoveryCodeHashes.map((hash, index) => ({
            id: `${userId}:${index}`,
            code_hash: hash,
            usedAt: null,
            createdAt: new Date().toISOString()
        })));
        return serializeStatus(setting, recoveryCodeHashes.length);
    }

    async markUsed(userId) {
        const setting = this.settings.get(userId);
        if (setting) {
            setting.last_used_at = new Date().toISOString();
        }
    }

    async replaceRecoveryCodes(userId, recoveryCodeHashes) {
        this.recoveryCodes.set(userId, recoveryCodeHashes.map((hash, index) => ({
            id: `${userId}:${index}`,
            code_hash: hash,
            usedAt: null,
            createdAt: new Date().toISOString()
        })));
        return recoveryCodeHashes.length;
    }

    async consumeRecoveryCode(userId, code, bcryptImpl = bcrypt) {
        const normalized = normalizeRecoveryCode(code);
        const codes = this.recoveryCodes.get(userId) || [];
        for (const entry of codes) {
            if (!entry.usedAt && await bcryptImpl.compare(normalized, entry.code_hash)) {
                entry.usedAt = new Date().toISOString();
                await this.markUsed(userId);
                return true;
            }
        }
        return false;
    }

    async disable(userId) {
        const existed = this.settings.delete(userId);
        this.recoveryCodes.delete(userId);
        return existed ? 1 : 0;
    }
}

function getSetupUser(req) {
    if (req.session?.user) {
        return publicUser(req.session.user);
    }
    if (req.session?.pendingTotpSetup?.user) {
        return publicUser(req.session.pendingTotpSetup.user);
    }
    return null;
}

function createRequireAdminTotp(store) {
    return async function requireAdminTotp(req, res, next) {
        try {
            if (!req.session?.user || publicUser(req.session.user).role !== 'admin') {
                return next();
            }
            const status = await store.getStatus(req.session.user.id);
            if (!status.enabled) {
                return res.status(403).json({ error: 'Admin TOTP setup required' });
            }
            return next();
        } catch (error) {
            return next(error);
        }
    };
}

function createTotpRouter(options = {}) {
    const express = require('express');
    const router = express.Router();
    const store = options.store || new PostgresTotpStore(options.db);
    const authStore = options.authStore;
    const bcryptImpl = options.bcrypt || bcrypt;
    const config = getTotpConfig(options);
    const checkRateLimit = options.checkRateLimit || createRateLimiter(options.rateLimit);

    function assertEnabled() {
        if (!config.enabled) {
            const error = new Error('TOTP support is disabled');
            error.status = 403;
            throw error;
        }
    }

    async function verifyStoredToken(userId, token) {
        const secretPayload = await store.getSecretPayload(userId);
        if (!secretPayload) {
            return false;
        }
        const secret = decryptSecret(secretPayload, config.encryptionKeySource);
        if (verifyTotpToken(token, secret, config)) {
            await store.markUsed(userId);
            return true;
        }
        return store.consumeRecoveryCode(userId, token, bcryptImpl);
    }

    router.get('/status', requireAuth, async (req, res, next) => {
        try {
            return res.json({ status: await store.getStatus(req.session.user.id) });
        } catch (error) {
            return next(error);
        }
    });

    router.post('/setup', verifyCsrfToken, async (req, res, next) => {
        try {
            assertEnabled();
            const user = getSetupUser(req);
            if (!user) {
                return res.status(401).json({ error: 'Authentication required' });
            }
            const secret = otp.generateSecret();
            const otpauthUrl = otp.generateURI({
                strategy: 'totp',
                issuer: config.issuer,
                label: user.username,
                secret
            });
            req.session.pendingTotpSetup = {
                user,
                secret,
                startedAt: Date.now(),
                forced: !req.session.user
            };
            return res.json({
                secret,
                otpauthUrl,
                qrCodeDataUrl: await QRCode.toDataURL(otpauthUrl),
                issuer: config.issuer,
                username: user.username
            });
        } catch (error) {
            return next(error);
        }
    });

    router.post('/verify-setup', verifyCsrfToken, async (req, res, next) => {
        try {
            assertEnabled();
            const setup = req.session?.pendingTotpSetup;
            const user = setup?.user ? publicUser(setup.user) : getSetupUser(req);
            if (!user || !setup?.secret) {
                return res.status(400).json({ error: 'TOTP setup was not started' });
            }
            const parsed = tokenSchema.safeParse(req.body || {});
            if (!parsed.success || !verifyTotpToken(parsed.data.token, setup.secret, config)) {
                return res.status(401).json({ error: 'TOTP code is invalid' });
            }
            const recoveryCodes = generateRecoveryCodes(config.recoveryCodeCount);
            const recoveryCodeHashes = await hashRecoveryCodes(
                recoveryCodes,
                bcryptImpl,
                config.recoveryHashRounds
            );
            const status = await store.saveEnabled(
                user.id,
                encryptSecret(setup.secret, config.encryptionKeySource),
                recoveryCodeHashes
            );
            req.session.user = publicUser(user);
            delete req.session.pendingTotpSetup;
            return res.json({
                user: publicUser(user),
                status,
                recoveryCodes,
                csrfToken: ensureCsrfToken(req)
            });
        } catch (error) {
            return next(error);
        }
    });

    router.post('/login', verifyCsrfToken, async (req, res, next) => {
        try {
            assertEnabled();
            const pending = req.session?.pendingTotpLogin;
            if (!pending?.user) {
                return res.status(400).json({ error: 'TOTP login was not started' });
            }
            checkRateLimit(`totp-login:${req.ip}:${pending.user.id}`);
            const parsed = tokenSchema.safeParse(req.body || {});
            if (!parsed.success || !(await verifyStoredToken(pending.user.id, parsed.data.token))) {
                return res.status(401).json({ error: 'TOTP code is invalid' });
            }
            const user = publicUser(pending.user);
            await new Promise((resolve, reject) => {
                req.session.regenerate((error) => error ? reject(error) : resolve());
            });
            req.session.user = user;
            return res.json({ user, csrfToken: ensureCsrfToken(req) });
        } catch (error) {
            return next(error);
        }
    });

    router.post('/recovery-codes', requireAuth, verifyCsrfToken, async (req, res, next) => {
        try {
            assertEnabled();
            const status = await store.getStatus(req.session.user.id);
            if (!status.enabled) {
                return res.status(400).json({ error: 'TOTP is not enabled' });
            }
            const recoveryCodes = generateRecoveryCodes(config.recoveryCodeCount);
            const recoveryCodeHashes = await hashRecoveryCodes(
                recoveryCodes,
                bcryptImpl,
                config.recoveryHashRounds
            );
            await store.replaceRecoveryCodes(req.session.user.id, recoveryCodeHashes);
            return res.json({
                recoveryCodes,
                status: await store.getStatus(req.session.user.id)
            });
        } catch (error) {
            return next(error);
        }
    });

    router.post('/disable', requireAuth, verifyCsrfToken, async (req, res, next) => {
        try {
            assertEnabled();
            const user = publicUser(req.session.user);
            if (user.role === 'admin') {
                return res.status(403).json({ error: 'Admin TOTP cannot be disabled here' });
            }
            if (!authStore || typeof authStore.findByUsernameLower !== 'function') {
                return res.status(500).json({ error: 'Auth store unavailable' });
            }
            const parsed = disableSchema.safeParse(req.body || {});
            if (!parsed.success) {
                return res.status(400).json({ error: 'Password and TOTP code are required' });
            }
            const account = await authStore.findByUsernameLower(user.username.toLowerCase());
            const passwordOk = account && await bcryptImpl.compare(parsed.data.password, account.password_hash);
            if (!passwordOk) {
                return res.status(401).json({ error: 'Password is incorrect' });
            }
            if (!(await verifyStoredToken(user.id, parsed.data.token))) {
                return res.status(401).json({ error: 'TOTP code is invalid' });
            }
            await store.disable(user.id);
            return res.json({ status: await store.getStatus(user.id) });
        } catch (error) {
            return next(error);
        }
    });

    return router;
}

module.exports = {
    MemoryTotpStore,
    PostgresTotpStore,
    createRequireAdminTotp,
    createTotpRouter,
    decryptSecret,
    encryptSecret,
    generateRecoveryCodes,
    getTotpConfig,
    normalizeRecoveryCode,
    normalizeToken,
    serializeStatus,
    verifyTotpToken
};
