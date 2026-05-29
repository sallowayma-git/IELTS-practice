import type { ReadingSuiteSession, ReadingSuiteSessionStatus } from './contracts.js'
import { cloneReadingSuiteSession } from './reading-suite-sessions.js'
import { createHttpError } from '../shared/http.js'
import { safeJsonParse, safeJsonStringify } from '../shared/json.js'
import { isSqliteLike, type SqliteDatabaseLike } from '../shared/sqlite.js'

type AnyRecord = Record<string, unknown>

const SUITE_STATUSES = new Set<ReadingSuiteSessionStatus>(['active', 'completed', 'cancelled'])

function isRecord(value: unknown): value is AnyRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isReadingSuiteSession(value: unknown): value is ReadingSuiteSession {
  return isRecord(value)
    && typeof value.sessionId === 'string'
    && value.activity === 'reading'
    && value.practiceMode === 'suite'
    && typeof value.flowMode === 'string'
    && typeof value.frequencyScope === 'string'
    && SUITE_STATUSES.has(value.status as ReadingSuiteSessionStatus)
    && Number.isInteger(value.currentIndex)
    && Number.isInteger(value.totalPassages)
    && Array.isArray(value.sequence)
    && isRecord(value.aggregate)
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
}

function normalizeSessionId(sessionId: string): string {
  return String(sessionId || '').trim()
}

export class ReadingSuiteSessionStore {
  private readonly db: SqliteDatabaseLike | null
  private readonly memorySessions = new Map<string, ReadingSuiteSession>()

  constructor(db: unknown) {
    this.db = isSqliteLike(db) ? db : null
    if (this.db) {
      this.ensureSchema()
    }
  }

  save(session: ReadingSuiteSession): ReadingSuiteSession {
    if (!isReadingSuiteSession(session)) {
      throw createHttpError('invalid_reading_suite_session', 'Invalid reading suite session payload')
    }

    const snapshot = cloneReadingSuiteSession(session)
    if (this.db) {
      this.db.prepare(`
        INSERT INTO practice_reading_suite_sessions (
          session_id, status, flow_mode, frequency_scope, current_index, total_passages,
          session_json, created_at, updated_at, completed_at
        ) VALUES (
          @sessionId, @status, @flowMode, @frequencyScope, @currentIndex, @totalPassages,
          @sessionJson, @createdAt, @updatedAt, @completedAt
        )
        ON CONFLICT(session_id) DO UPDATE SET
          status = excluded.status,
          flow_mode = excluded.flow_mode,
          frequency_scope = excluded.frequency_scope,
          current_index = excluded.current_index,
          total_passages = excluded.total_passages,
          session_json = excluded.session_json,
          updated_at = excluded.updated_at,
          completed_at = excluded.completed_at
      `).run({
        sessionId: snapshot.sessionId,
        status: snapshot.status,
        flowMode: snapshot.flowMode,
        frequencyScope: snapshot.frequencyScope,
        currentIndex: snapshot.currentIndex,
        totalPassages: snapshot.totalPassages,
        sessionJson: safeJsonStringify(snapshot),
        createdAt: snapshot.createdAt,
        updatedAt: snapshot.updatedAt,
        completedAt: snapshot.completedAt || null
      })
    } else {
      this.memorySessions.set(snapshot.sessionId, snapshot)
    }
    return cloneReadingSuiteSession(snapshot)
  }

  get(sessionId: string): ReadingSuiteSession | null {
    const normalizedSessionId = normalizeSessionId(sessionId)
    if (!normalizedSessionId) return null

    if (this.db) {
      const row = this.db.prepare(`
        SELECT * FROM practice_reading_suite_sessions
        WHERE session_id = ?
        LIMIT 1
      `).get(normalizedSessionId)
      return row ? this.rowToSession(row as AnyRecord) : null
    }

    const session = this.memorySessions.get(normalizedSessionId)
    return session ? cloneReadingSuiteSession(session) : null
  }

  delete(sessionId: string): boolean {
    const normalizedSessionId = normalizeSessionId(sessionId)
    if (!normalizedSessionId) return false
    const deleted = this.memorySessions.delete(normalizedSessionId)
    if (this.db) {
      const result = this.db.prepare(`
        DELETE FROM practice_reading_suite_sessions
        WHERE session_id = ?
      `).run(normalizedSessionId)
      return Boolean(result?.changes || deleted)
    }
    return deleted
  }

  private ensureSchema() {
    if (!this.db) return
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS practice_reading_suite_sessions (
        session_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        flow_mode TEXT NOT NULL,
        frequency_scope TEXT NOT NULL,
        current_index INTEGER NOT NULL DEFAULT 0,
        total_passages INTEGER NOT NULL DEFAULT 3,
        session_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_practice_suite_status_updated_at
        ON practice_reading_suite_sessions(status, updated_at DESC);
    `)
  }

  private rowToSession(row: AnyRecord): ReadingSuiteSession {
    const sessionId = normalizeSessionId(String(row.session_id || ''))
    const session = safeJsonParse<ReadingSuiteSession | null>(row.session_json, null)
    if (!isReadingSuiteSession(session) || session.sessionId !== sessionId) {
      throw createHttpError(
        'reading_suite_session_corrupt',
        `Reading suite session is corrupt: ${sessionId || 'unknown'}`,
        500,
        { sessionId }
      )
    }
    return cloneReadingSuiteSession(session)
  }
}
