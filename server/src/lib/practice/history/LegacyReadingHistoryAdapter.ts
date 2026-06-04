import type {
  PracticeHistoryImportResult,
  PracticeHistorySummary,
  ReadingPracticePayload,
  ReadingPracticeSubmission
} from '../contracts.js'
import { createReadingPracticeSubmission } from '../reading-sessions.js'

type AnyRecord = Record<string, unknown>

function isRecord(value: unknown): value is AnyRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    const normalized = normalizeNonEmptyString(value)
    if (normalized) return normalized
  }
  return ''
}

function firstDefined(...values: unknown[]) {
  return values.find((value) => value !== undefined && value !== null && value !== '')
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readRecordField(source: unknown, fieldName: string): unknown {
  return isRecord(source) ? source[fieldName] : undefined
}

function readNestedRecord(source: unknown, fieldName: string): AnyRecord {
  const value = readRecordField(source, fieldName)
  return isRecord(value) ? value : {}
}

function normalizeLegacyRecordKey(record: AnyRecord): string {
  const realData = readNestedRecord(record, 'realData')
  return firstNonEmptyString(
    record.sessionId,
    realData.sessionId,
    record.id,
    record.examId,
    record.assetId
  )
}

function isCanonicalReadingSubmission(value: unknown): value is ReadingPracticeSubmission {
  if (!isRecord(value)) return false
  return value.activity === 'reading'
    && value.status === 'submitted'
    && Boolean(normalizeNonEmptyString(value.sessionId))
    && isRecord(value.scoreInfo)
    && isRecord(value.answerComparison)
}

function hasAnswerLikePayload(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length > 0
}

function isLegacyPracticeRecord(value: unknown): value is AnyRecord {
  if (!isRecord(value) || isCanonicalReadingSubmission(value)) {
    return false
  }
  const metadata = readNestedRecord(value, 'metadata')
  const realData = readNestedRecord(value, 'realData')
  const resultSnapshot = readNestedRecord(value, 'resultSnapshot')
  const resultRealData = readNestedRecord(resultSnapshot, 'realData')
  const activity = firstNonEmptyString(
    value.activity,
    value.type,
    value.examType,
    metadata.activity,
    metadata.type,
    realData.activity,
    realData.type
  ).toLowerCase()
  const examId = firstNonEmptyString(
    value.examId,
    value.assetId,
    value.dataKey,
    metadata.examId,
    metadata.assetId,
    metadata.dataKey,
    realData.examId,
    realData.assetId,
    realData.dataKey
  )
  const answers = firstDefined(
    value.answers,
    realData.answers,
    resultSnapshot.answers,
    resultRealData.answers
  )
  const scoreInfo = firstDefined(
    value.scoreInfo,
    realData.scoreInfo,
    resultSnapshot.scoreInfo,
    resultRealData.scoreInfo
  )
  const looksReading = !activity
    || activity === 'reading'
    || activity === 'practice_complete'
    || activity === 'practice'
    || activity === 'practice_record'
    || activity === 'ielts_reading'
  return Boolean(examId && looksReading && (hasAnswerLikePayload(answers) || isRecord(scoreInfo)))
}

function collectArchiveEntries(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!isRecord(payload)) return []
  if (Array.isArray(payload.submissions)) return payload.submissions
  if (Array.isArray(payload.records)) {
    return payload.records.map((entry) => (
      isRecord(entry) && Object.prototype.hasOwnProperty.call(entry, 'submission')
        ? entry.submission
        : entry
    ))
  }
  if (isRecord(payload.submission)) return [payload.submission]
  return []
}

export function canonicalArchivePayloadWithoutLegacyRecords(payload: unknown): unknown {
  const entries = collectArchiveEntries(payload)
  if (!entries.length) return payload
  return {
    submissions: entries.filter((entry) => !isLegacyPracticeRecord(entry))
  }
}

export function collectLegacyPracticeRecords(payload: unknown): AnyRecord[] {
  const candidates: unknown[] = []
  const append = (value: unknown) => {
    asArray(value).forEach((entry) => candidates.push(entry))
  }

  if (Array.isArray(payload)) {
    append(payload)
  }
  if (isRecord(payload)) {
    const data = readNestedRecord(payload, 'data')
    const examSystem = readNestedRecord(payload, 'exam_system_practice_records')
    const dataExamSystem = readNestedRecord(data, 'exam_system_practice_records')
    append(payload.records)
    append(payload.practice_records)
    append(payload.mymelodypracticerecords)
    append(payload.my_melody_practice_records)
    append(data.practice_records)
    append(data.mymelodypracticerecords)
    append(data.my_melody_practice_records)
    append(examSystem.data)
    append(dataExamSystem.data)
  }

  const seen = new Set<string>()
  const output: AnyRecord[] = []
  candidates.forEach((entry, index) => {
    if (!isLegacyPracticeRecord(entry)) return
    const key = normalizeLegacyRecordKey(entry) || `index:${index}`
    if (seen.has(key)) return
    seen.add(key)
    output.push(entry)
  })
  return output
}

function normalizeCoachTranscript(value: unknown): Array<AnyRecord> {
  if (!Array.isArray(value)) return []
  return value
    .map((entry): AnyRecord | null => {
      if (!isRecord(entry)) return null
      const content = firstNonEmptyString(entry.content, entry.text, entry.message, entry.answer)
      if (!content) return null
      const role = String(entry.role || '').trim().toLowerCase() === 'assistant'
        ? 'assistant'
        : 'user'
      return {
        ...entry,
        role,
        content
      }
    })
    .filter((entry): entry is AnyRecord => Boolean(entry))
}

function normalizeLegacyExamId(record: AnyRecord): string {
  const metadata = readNestedRecord(record, 'metadata')
  const realData = readNestedRecord(record, 'realData')
  const resultSnapshot = readNestedRecord(record, 'resultSnapshot')
  const resultMetadata = readNestedRecord(resultSnapshot, 'metadata')
  const resultRealData = readNestedRecord(resultSnapshot, 'realData')
  return firstNonEmptyString(
    record.examId,
    record.assetId,
    record.dataKey,
    metadata.examId,
    metadata.assetId,
    metadata.dataKey,
    resultSnapshot.examId,
    resultSnapshot.assetId,
    resultMetadata.examId,
    resultMetadata.assetId,
    resultMetadata.dataKey,
    realData.examId,
    realData.assetId,
    realData.dataKey,
    resultRealData.examId,
    resultRealData.assetId,
    resultRealData.dataKey
  )
}

function buildLegacyReadingAttempt(record: AnyRecord): AnyRecord {
  const metadata = readNestedRecord(record, 'metadata')
  const realData = readNestedRecord(record, 'realData')
  const resultSnapshot = readNestedRecord(record, 'resultSnapshot')
  const resultMetadata = readNestedRecord(resultSnapshot, 'metadata')
  const resultRealData = readNestedRecord(resultSnapshot, 'realData')
  const singleAttemptInput = readNestedRecord(record, 'singleAttemptAnalysisInput')
  const realSingleAttemptInput = readNestedRecord(realData, 'singleAttemptAnalysisInput')
  const interactions = asArray(firstDefined(record.interactions, realData.interactions, resultSnapshot.interactions, resultRealData.interactions))

  return {
    answers: firstDefined(record.answers, realData.answers, resultSnapshot.answers, resultRealData.answers, {}),
    markedQuestions: firstDefined(
      record.markedQuestions,
      metadata.markedQuestions,
      resultSnapshot.markedQuestions,
      resultMetadata.markedQuestions,
      realData.markedQuestions,
      resultRealData.markedQuestions,
      []
    ),
    highlights: firstDefined(
      record.highlights,
      metadata.highlights,
      resultSnapshot.highlights,
      resultMetadata.highlights,
      realData.highlights,
      resultRealData.highlights,
      []
    ),
    questionTimelineLite: firstDefined(
      record.questionTimelineLite,
      record.questionTimeline,
      singleAttemptInput.questionTimelineLite,
      resultSnapshot.questionTimelineLite,
      resultRealData.questionTimelineLite,
      realData.questionTimelineLite,
      realSingleAttemptInput.questionTimelineLite,
      []
    ),
    interactionCount: firstDefined(
      record.interactionCount,
      record.interactionsCount,
      realData.interactionCount,
      realData.interactionsCount,
      resultSnapshot.interactionCount,
      resultRealData.interactionCount,
      interactions.length || undefined
    ),
    duration: firstDefined(
      record.duration,
      record.durationSec,
      record.elapsed,
      record.elapsedSeconds,
      realData.duration,
      realData.durationSec,
      resultSnapshot.duration,
      resultRealData.duration
    ),
    startTime: firstDefined(
      record.startTime,
      record.startedAt,
      realData.startTime,
      realData.startedAt,
      resultSnapshot.startTime,
      resultRealData.startTime
    ),
    endTime: firstDefined(
      record.endTime,
      record.completedAt,
      record.submittedAt,
      record.updatedAt,
      realData.endTime,
      realData.completedAt,
      resultSnapshot.endTime,
      resultSnapshot.completedAt,
      resultRealData.endTime
    ),
    timerSnapshot: firstDefined(
      record.timerSnapshot,
      metadata.timerSnapshot,
      realData.timerSnapshot,
      resultSnapshot.timerSnapshot,
      resultMetadata.timerSnapshot,
      resultRealData.timerSnapshot
    ),
    effectiveEndTime: firstDefined(
      record.effectiveEndTime,
      metadata.effectiveEndTime,
      realData.effectiveEndTime,
      resultSnapshot.effectiveEndTime,
      resultMetadata.effectiveEndTime,
      resultRealData.effectiveEndTime
    ),
    effectiveEndTimeMs: firstDefined(
      record.effectiveEndTimeMs,
      metadata.effectiveEndTimeMs,
      realData.effectiveEndTimeMs,
      resultSnapshot.effectiveEndTimeMs,
      resultMetadata.effectiveEndTimeMs,
      resultRealData.effectiveEndTimeMs
    ),
    scrollY: firstDefined(
      record.scrollY,
      metadata.scrollY,
      realData.scrollY,
      resultSnapshot.scrollY,
      resultMetadata.scrollY,
      resultRealData.scrollY
    ),
    singleAttemptAnalysisLlm: firstDefined(
      record.singleAttemptAnalysisLlm,
      realData.singleAttemptAnalysisLlm,
      resultSnapshot.singleAttemptAnalysisLlm,
      resultRealData.singleAttemptAnalysisLlm
    )
  }
}

function getLegacyCoachSnapshot(record: AnyRecord): unknown {
  const realData = readNestedRecord(record, 'realData')
  const resultSnapshot = readNestedRecord(record, 'resultSnapshot')
  const resultRealData = readNestedRecord(resultSnapshot, 'realData')
  return firstDefined(
    record.readingCoachSnapshot,
    record.coachSnapshot,
    realData.readingCoachSnapshot,
    realData.coachSnapshot,
    resultSnapshot.readingCoachSnapshot,
    resultRealData.readingCoachSnapshot
  ) ?? null
}

function getLegacyCoachTranscript(record: AnyRecord): Array<AnyRecord> {
  const realData = readNestedRecord(record, 'realData')
  const resultSnapshot = readNestedRecord(record, 'resultSnapshot')
  const resultRealData = readNestedRecord(resultSnapshot, 'realData')
  return normalizeCoachTranscript(firstDefined(
    record.readingCoachTranscript,
    record.coachTranscript,
    realData.readingCoachTranscript,
    realData.coachTranscript,
    resultSnapshot.readingCoachTranscript,
    resultRealData.readingCoachTranscript
  ))
}

export function mergeReadingImportResults(
  canonical: PracticeHistoryImportResult,
  legacy: {
    records: PracticeHistorySummary[]
    errors: PracticeHistoryImportResult['errors']
    skippedCount: number
    totalCount: number
  }
): PracticeHistoryImportResult {
  return {
    activity: 'reading',
    importedCount: canonical.importedCount + legacy.records.length,
    skippedCount: canonical.skippedCount + legacy.skippedCount,
    totalCount: canonical.totalCount + legacy.totalCount,
    records: [
      ...canonical.records,
      ...legacy.records
    ],
    errors: [
      ...canonical.errors,
      ...legacy.errors.map((error) => ({
        ...error,
        index: canonical.totalCount + error.index
      }))
    ]
  }
}

export class LegacyReadingHistoryAdapter {
  private readonly getReadingPayload: (assetId: string) => Promise<ReadingPracticePayload>
  private readonly saveReadingSubmission: (submission: ReadingPracticeSubmission) => PracticeHistorySummary

  constructor(options: {
    getReadingPayload: (assetId: string) => Promise<ReadingPracticePayload>
    saveReadingSubmission: (submission: ReadingPracticeSubmission) => PracticeHistorySummary
  }) {
    this.getReadingPayload = options.getReadingPayload
    this.saveReadingSubmission = options.saveReadingSubmission
  }

  async importRecords(records: AnyRecord[]) {
    const importedRecords: PracticeHistorySummary[] = []
    const errors: PracticeHistoryImportResult['errors'] = []
    let skippedCount = 0

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]
      try {
        const submission = await this.toReadingSubmission(record)
        importedRecords.push(this.saveReadingSubmission(submission))
      } catch (error) {
        skippedCount += 1
        errors.push({
          index,
          reason: error instanceof Error ? error.message : 'legacy_record_import_failed'
        })
      }
    }

    return {
      records: importedRecords,
      errors,
      skippedCount,
      totalCount: records.length
    }
  }

  private async toReadingSubmission(record: AnyRecord): Promise<ReadingPracticeSubmission> {
    const assetId = normalizeLegacyExamId(record)
    if (!assetId) {
      throw new Error('legacy_record_missing_exam_id')
    }

    const readingPayload = await this.getReadingPayload(assetId)
    const attempt = buildLegacyReadingAttempt(record)
    const settings: AnyRecord = {
      sessionId: firstNonEmptyString(record.sessionId, readRecordField(record.realData, 'sessionId'), record.id)
    }
    const submission = createReadingPracticeSubmission(readingPayload, attempt, settings)
    const legacyMetadata: AnyRecord = {
      ...(submission.metadata || {}),
      importSource: 'legacy_practice_records',
      legacyPracticeRecordId: firstNonEmptyString(record.id),
      legacyExamId: assetId,
      legacyRecordType: firstNonEmptyString(record.type, record.activity),
      renderMode: 'legacy-reading'
    }

    return {
      ...submission,
      metadata: legacyMetadata,
      readingCoachSnapshot: getLegacyCoachSnapshot(record),
      readingCoachTranscript: getLegacyCoachTranscript(record),
      singleAttemptAnalysisLlm: attempt.singleAttemptAnalysisLlm ?? null,
      legacy: {
        ...submission.legacy,
        renderMode: 'vue-reading'
      }
    }
  }
}
