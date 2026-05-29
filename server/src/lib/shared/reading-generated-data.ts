import { createHttpError } from './http.js'
import { parseGeneratedAssignmentSource, parseGeneratedRegisterSource } from './generated-json.js'

export type ReadingGeneratedRecord = Record<string, unknown>
export type ReadingGeneratedManifest = Record<string, ReadingGeneratedRecord>

function isRecord(value: unknown): value is ReadingGeneratedRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function parseReadingManifestSource(source: string): ReadingGeneratedManifest {
  const manifest = parseGeneratedAssignmentSource<ReadingGeneratedManifest>(
    source,
    {
      assignmentName: '__READING_EXAM_MANIFEST__',
      errorCode: 'reading_manifest_parse_failed',
      missingAssignmentMessage: 'Reading manifest assignment is missing',
      missingValueMessage: 'Reading manifest object is missing',
      parseMessage: 'Reading manifest could not be parsed'
    }
  )
  if (!isRecord(manifest)) {
    throw createHttpError('reading_manifest_parse_failed', 'Reading manifest could not be parsed', 500)
  }
  return manifest
}

export function parseReadingExamDataSource(source: string): { key: string; payload: ReadingGeneratedRecord } {
  return parseGeneratedRegisterSource(
    source,
    {
      registryName: '__READING_EXAM_DATA__',
      errorCode: 'reading_asset_parse_failed',
      missingRegisterMessage: 'Reading generated register call is missing',
      separatorMessage: 'Reading generated register payload separator is missing',
      missingPayloadMessage: 'Reading generated register payload object is missing',
      parseMessage: 'Reading asset payload could not be parsed'
    }
  )
}

export function parseReadingExplanationDataSource(source: string): { key: string; payload: ReadingGeneratedRecord } {
  return parseGeneratedRegisterSource(
    source,
    {
      registryName: '__READING_EXPLANATION_DATA__',
      errorCode: 'reading_explanation_parse_failed',
      missingRegisterMessage: 'Reading explanation register call is missing',
      separatorMessage: 'Reading explanation payload separator is missing',
      missingPayloadMessage: 'Reading explanation payload object is missing',
      parseMessage: 'Reading explanation payload could not be parsed'
    }
  )
}
