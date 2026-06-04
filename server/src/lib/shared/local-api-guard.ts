const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])
const LOCAL_PROTOCOLS = new Set(['app:', 'file:'])
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function normalizeHeaderValue(value: unknown) {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0].trim() : ''
  }
  return typeof value === 'string' ? value.trim() : ''
}

function isNullOrigin(value: string) {
  return value === '' || value === 'null'
}

function parseUrlCandidate(value: string) {
  try {
    return new URL(value)
  } catch (_) {
    return null
  }
}

export function isTrustedLocalApiUrl(value: unknown) {
  const normalized = normalizeHeaderValue(value)
  if (isNullOrigin(normalized)) {
    return true
  }
  const parsed = parseUrlCandidate(normalized)
  if (!parsed) {
    return false
  }
  if (LOCAL_PROTOCOLS.has(parsed.protocol)) {
    return true
  }
  return LOCAL_HOSTS.has(parsed.hostname)
}

export function resolveAllowedCorsOrigin(value: unknown) {
  const normalized = normalizeHeaderValue(value)
  if (isNullOrigin(normalized)) {
    return null
  }
  return isTrustedLocalApiUrl(normalized) ? normalized : null
}

export function isTrustedLocalApiRequest(headers: Record<string, unknown> = {}) {
  const origin = normalizeHeaderValue(headers.origin)
  const referer = normalizeHeaderValue(headers.referer)
  if (origin && !isTrustedLocalApiUrl(origin)) {
    return false
  }
  if (!origin && referer && !isTrustedLocalApiUrl(referer)) {
    return false
  }
  return true
}

export function isWriteMethod(method: string) {
  return WRITE_METHODS.has(String(method || '').toUpperCase())
}
