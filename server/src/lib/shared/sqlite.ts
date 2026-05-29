export interface SqliteDatabaseLike {
  exec: (sql: string) => unknown
  prepare: (sql: string) => any
}

export function isSqliteLike(db: unknown): db is SqliteDatabaseLike {
  return Boolean(
    db
    && typeof (db as { exec?: unknown }).exec === 'function'
    && typeof (db as { prepare?: unknown }).prepare === 'function'
  )
}
