import { createHttpError } from './http.js'

type AnyRecord = Record<string, unknown>

export interface GeneratedAssignmentOptions {
  assignmentName: string
  errorCode: string
  missingAssignmentMessage: string
  missingValueMessage: string
  parseMessage: string
}

export interface GeneratedRegisterOptions {
  registryName: string
  errorCode: string
  missingRegisterMessage: string
  separatorMessage: string
  missingPayloadMessage: string
  parseMessage: string
}

function isRecord(value: unknown): value is AnyRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractBalancedJsonValue(source: string, startIndex: number, errorCode: string): string {
  const opener = source[startIndex]
  const closer = opener === '{' ? '}' : opener === '[' ? ']' : ''
  if (!closer) {
    throw createHttpError(errorCode, 'Generated JSON payload is missing an object or array opener', 500)
  }

  let depth = 0
  let inString = false
  let escaped = false
  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }
    if (char === opener) {
      depth += 1
      continue
    }
    if (char === closer) {
      depth -= 1
      if (depth === 0) {
        return source.slice(startIndex, index + 1)
      }
    }
  }

  throw createHttpError(errorCode, 'Generated JSON payload is not balanced', 500)
}

function parseJsonValue<T>(source: string, startIndex: number, errorCode: string, message: string): T {
  try {
    return JSON.parse(extractBalancedJsonValue(source, startIndex, errorCode)) as T
  } catch (error) {
    if (isRecord(error) && typeof error.statusCode === 'number') {
      throw error
    }
    throw createHttpError(errorCode, message, 500)
  }
}

function skipWhitespace(source: string, index: number): number {
  let cursor = index
  while (cursor < source.length && /\s/.test(source[cursor])) {
    cursor += 1
  }
  return cursor
}

function parseJsonStringToken(source: string, startIndex: number, errorCode: string): { value: string; endIndex: number } {
  if (source[startIndex] !== '"') {
    throw createHttpError(errorCode, 'Generated register key is not a JSON string', 500)
  }
  let escaped = false
  for (let index = startIndex + 1; index < source.length; index += 1) {
    const char = source[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      const token = source.slice(startIndex, index + 1)
      return {
        value: JSON.parse(token),
        endIndex: index + 1
      }
    }
  }
  throw createHttpError(errorCode, 'Generated register key is unterminated', 500)
}

export function parseGeneratedAssignmentSource<T>(source: string, options: GeneratedAssignmentOptions): T {
  const pattern = new RegExp(`${escapeRegExp(options.assignmentName)}\\s*=`)
  const assignment = source.match(pattern)
  if (!assignment || assignment.index == null) {
    throw createHttpError(options.errorCode, options.missingAssignmentMessage, 500)
  }
  const startIndex = source.indexOf('{', assignment.index + assignment[0].length)
  if (startIndex < 0) {
    throw createHttpError(options.errorCode, options.missingValueMessage, 500)
  }
  return parseJsonValue<T>(source, startIndex, options.errorCode, options.parseMessage)
}

export function parseGeneratedRegisterSource<T extends AnyRecord = AnyRecord>(
  source: string,
  options: GeneratedRegisterOptions
): { key: string; payload: T } {
  const registerPattern = new RegExp(`${escapeRegExp(options.registryName)}\\.register\\s*\\(`)
  const registerCall = source.match(registerPattern)
  if (!registerCall || registerCall.index == null) {
    throw createHttpError(options.errorCode, options.missingRegisterMessage, 500)
  }

  let cursor = skipWhitespace(source, registerCall.index + registerCall[0].length)
  const key = parseJsonStringToken(source, cursor, options.errorCode)
  cursor = skipWhitespace(source, key.endIndex)
  if (source[cursor] !== ',') {
    throw createHttpError(options.errorCode, options.separatorMessage, 500)
  }
  cursor = skipWhitespace(source, cursor + 1)
  if (source[cursor] !== '{') {
    throw createHttpError(options.errorCode, options.missingPayloadMessage, 500)
  }

  const payload = parseJsonValue<T>(source, cursor, options.errorCode, options.parseMessage)
  if (!isRecord(payload)) {
    throw createHttpError(options.errorCode, options.parseMessage, 500)
  }
  return {
    key: key.value,
    payload
  }
}
