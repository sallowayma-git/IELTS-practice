import type { ApiErrorEnvelope } from '../../types/api.js'

export function toErrorEnvelope(error: unknown, fallbackCode = 'unknown_error'): ApiErrorEnvelope {
  const source = (error && typeof error === 'object') ? error as Record<string, unknown> : {}
  const code = typeof source.code === 'string' && source.code.trim()
    ? source.code.trim()
    : fallbackCode
  const message = typeof source.message === 'string' && source.message.trim()
    ? source.message.trim()
    : fallbackCode
  const details = source.details && typeof source.details === 'object' && !Array.isArray(source.details)
    ? source.details as Record<string, unknown>
    : undefined
  return details ? { error: code, message, details } : { error: code, message }
}

export function resolveHttpStatus(error: unknown, fallback = 500): number {
  const source = (error && typeof error === 'object') ? error as Record<string, unknown> : {}
  if (typeof source.statusCode === 'number') {
    return source.statusCode
  }
  const code = String(source.code || '').toLowerCase()
  if (['invalid_request', 'invalid_payload', 'invalid_response_format', 'start_failed'].includes(code)) {
    return 400
  }
  if (code === 'rate_limit_exceeded') {
    return 429
  }
  if (code === 'model_not_found') {
    return 404
  }
  return fallback
}
