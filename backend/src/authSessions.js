const crypto = require('node:crypto');

const AUTH_SESSION_AUDIENCES = new Set(['business', 'admin', 'auth']);

function normalizeAuthSessionAudience(value) {
    const text = String(value || '').trim().toLowerCase();
    return AUTH_SESSION_AUDIENCES.has(text) ? text : '';
}

function createAuthSessionId() {
    return crypto.randomUUID();
}

function createAuthSessionHandle() {
    return crypto.randomBytes(32).toString('base64url');
}

function hashAuthSessionHandle(secret, handle) {
    return crypto.createHmac('sha256', String(secret || '')).update(String(handle || '')).digest('hex');
}

class PostgresAuthSessionStore {
    constructor(db) {
        this.db = db;
    }

    async createSession(session) {
        const result = await this.db.query(
            `INSERT INTO auth_sessions (
                id, session_handle_hash, user_id, audience, expires_at,
                last_verifier_rotated_at, totp_verified_at, user_agent_summary, ip_hash
            )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id, user_id, audience, created_at, last_seen_at, revoked_at, expires_at,
                       last_verifier_rotated_at, totp_verified_at, user_agent_summary, ip_hash`,
            [
                session.id,
                session.handleHash,
                session.userId,
                session.audience,
                session.expiresAt,
                session.lastVerifierRotatedAt || null,
                session.totpVerifiedAt || null,
                session.userAgentSummary || null,
                session.ipHash || null
            ]
        );
        return result.rows[0] || null;
    }

    async getActiveSession(id, handleHash) {
        const result = await this.db.query(
            `UPDATE auth_sessions
             SET last_seen_at = now()
             WHERE id = $1
               AND session_handle_hash = $2
               AND revoked_at IS NULL
               AND expires_at > now()
             RETURNING id, user_id, audience, created_at, last_seen_at, revoked_at, expires_at,
                       last_verifier_rotated_at, totp_verified_at, user_agent_summary, ip_hash`,
            [id, handleHash]
        );
        return result.rows[0] || null;
    }

    async revokeSession(id) {
        if (!id) {
            return null;
        }
        const result = await this.db.query(
            `UPDATE auth_sessions
             SET revoked_at = COALESCE(revoked_at, now())
             WHERE id = $1
             RETURNING id, user_id, audience, created_at, last_seen_at, revoked_at, expires_at,
                       last_verifier_rotated_at, totp_verified_at, user_agent_summary, ip_hash`,
            [id]
        );
        return result.rows[0] || null;
    }
}

class MemoryAuthSessionStore {
    constructor() {
        this.sessions = new Map();
    }

    async createSession(session) {
        const now = new Date().toISOString();
        const record = {
            id: session.id,
            session_handle_hash: session.handleHash,
            user_id: session.userId,
            audience: session.audience,
            created_at: now,
            last_seen_at: now,
            revoked_at: null,
            expires_at: session.expiresAt,
            last_verifier_rotated_at: session.lastVerifierRotatedAt || null,
            totp_verified_at: session.totpVerifiedAt || null,
            user_agent_summary: session.userAgentSummary || null,
            ip_hash: session.ipHash || null
        };
        this.sessions.set(record.id, record);
        return { ...record };
    }

    async getActiveSession(id, handleHash) {
        const record = this.sessions.get(id);
        if (!record || record.session_handle_hash !== handleHash || record.revoked_at) {
            return null;
        }
        if (new Date(record.expires_at).getTime() <= Date.now()) {
            return null;
        }
        record.last_seen_at = new Date().toISOString();
        return { ...record };
    }

    async revokeSession(id) {
        const record = this.sessions.get(id);
        if (!record) {
            return null;
        }
        if (!record.revoked_at) {
            record.revoked_at = new Date().toISOString();
        }
        return { ...record };
    }
}

module.exports = {
    AUTH_SESSION_AUDIENCES,
    MemoryAuthSessionStore,
    PostgresAuthSessionStore,
    createAuthSessionHandle,
    createAuthSessionId,
    hashAuthSessionHandle,
    normalizeAuthSessionAudience
};
