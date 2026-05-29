export function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function safeJsonStringify(value: unknown, fallback = 'null'): string {
  try {
    return JSON.stringify(value ?? null)
  } catch {
    return fallback
  }
}
