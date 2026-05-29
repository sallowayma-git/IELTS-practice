export interface HttpStatusError extends Error {
  code?: string
  statusCode?: number
  details?: Record<string, unknown>
}

export interface PaginationConfig {
  defaultLimit?: number
  maxLimit?: number
}

export interface NormalizedPagination {
  page: number
  limit: number
}

function positiveInteger(value: unknown): number | null {
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null
}

export function createHttpError(
  code: string,
  message: string,
  statusCode = 400,
  details?: Record<string, unknown>
): HttpStatusError {
  const error = new Error(message) as HttpStatusError
  error.code = code
  error.statusCode = statusCode
  if (details && Object.keys(details).length > 0) {
    error.details = details
  }
  return error
}

export function normalizePagination(
  page: unknown,
  limit: unknown,
  config: PaginationConfig = {}
): NormalizedPagination {
  const defaultLimit = positiveInteger(config.defaultLimit) ?? 20
  const maxLimit = positiveInteger(config.maxLimit) ?? 200
  const normalizedPage = positiveInteger(page) ?? 1
  const requestedLimit = positiveInteger(limit) ?? defaultLimit
  return {
    page: normalizedPage,
    limit: Math.min(requestedLimit, maxLimit)
  }
}

export function paginate<T>(items: T[], page: number, limit: number) {
  const total = items.length
  const offset = (page - 1) * limit
  return {
    data: items.slice(offset, offset + limit),
    total,
    page,
    limit
  }
}
