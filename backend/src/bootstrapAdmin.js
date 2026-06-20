const bcrypt = require('bcryptjs');
const {
    USERNAME_PATTERN,
    normalizeUsername,
    validatePasswordStrength
} = require('./auth');

function validateAdminInput(username, password) {
    const normalizedUsername = normalizeUsername(username);
    if (!USERNAME_PATTERN.test(normalizedUsername)) {
        const error = new Error('ADMIN_USERNAME must be 3-32 characters and use letters, numbers, "_" or "-".');
        error.status = 400;
        throw error;
    }
    const passwordCheck = validatePasswordStrength(password);
    if (!passwordCheck.valid) {
        const error = new Error('ADMIN_PASSWORD does not meet password strength requirements.');
        error.status = 400;
        error.details = passwordCheck.errors;
        throw error;
    }
    return normalizedUsername;
}

function parseBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

async function resetAdminTotpIfRequested(db, userId, value) {
    if (!parseBoolean(value, false)) {
        return false;
    }
    await db.query('DELETE FROM user_totp_recovery_codes WHERE user_id = $1', [userId]);
    await db.query('DELETE FROM user_totp_settings WHERE user_id = $1', [userId]);
    return true;
}

async function deleteSessionsForUserIfPossible(db, userId) {
    try {
        const result = await db.query(
            `DELETE FROM "session"
             WHERE (
                    sess::jsonb #>> '{user,id}' = $1
                 OR sess::jsonb #>> '{pendingTotpLogin,user,id}' = $1
                 OR sess::jsonb #>> '{pendingTotpSetup,user,id}' = $1
             )`,
            [userId]
        );
        return result.rowCount || 0;
    } catch (error) {
        if (error && error.code === '42P01') {
            return 0;
        }
        throw error;
    }
}

async function bootstrapAdmin(options = {}) {
    const db = options.db;
    if (!db || typeof db.query !== 'function') {
        throw new Error('bootstrapAdmin requires a db client');
    }
    const username = options.username ?? process.env.ADMIN_USERNAME;
    const password = options.password ?? process.env.ADMIN_PASSWORD;
    if (!username || !password) {
        return { skipped: true, reason: 'ADMIN_USERNAME and ADMIN_PASSWORD are required' };
    }

    const normalizedUsername = validateAdminInput(username, password);
    const usernameLower = normalizedUsername.toLowerCase();
    const bcryptImpl = options.bcrypt || bcrypt;

    const existing = await db.query(
        'SELECT id, password_hash, role FROM users WHERE username_lower = $1',
        [usernameLower]
    );

    if (existing.rows[0]) {
        const existingUser = existing.rows[0];
        const passwordMatches = existingUser.password_hash && typeof bcryptImpl.compare === 'function'
            ? await bcryptImpl.compare(password, existingUser.password_hash)
            : false;
        const passwordHash = passwordMatches
            ? existingUser.password_hash
            : await bcryptImpl.hash(password, 12);
        const roleChanged = existingUser.role !== 'admin';
        const result = await db.query(
            `UPDATE users
             SET username = $1, password_hash = $2, role = 'admin'
             WHERE username_lower = $3
             RETURNING id, username, role`,
            [normalizedUsername, passwordHash, usernameLower]
        );
        const totpReset = await resetAdminTotpIfRequested(
            db,
            result.rows[0].id,
            options.resetTotp ?? process.env.ADMIN_RESET_TOTP
        );
        const sessionsDeleted = (!passwordMatches || roleChanged || totpReset)
            ? await deleteSessionsForUserIfPossible(db, result.rows[0].id)
            : 0;
        return { skipped: false, created: false, totpReset, sessionsDeleted, user: result.rows[0] };
    }

    const passwordHash = await bcryptImpl.hash(password, 12);
    const result = await db.query(
        `INSERT INTO users (username, username_lower, password_hash, role)
         VALUES ($1, $2, $3, 'admin')
         RETURNING id, username, role`,
        [normalizedUsername, usernameLower, passwordHash]
    );

    return { skipped: false, created: true, totpReset: false, user: result.rows[0] };
}

module.exports = {
    bootstrapAdmin,
    deleteSessionsForUserIfPossible,
    resetAdminTotpIfRequested,
    validateAdminInput
};
