import { randomUUID } from 'node:crypto'
import type {
  PracticeAsset,
  ReadingPracticePayload,
  ReadingPracticeSubmission,
  ReadingSuiteCreateRequest,
  ReadingSuiteFrequencyScope,
  ReadingSuiteFlowMode,
  ReadingSuitePassageEntry,
  ReadingSuiteSession,
  ReadingSuiteTimerMode,
  ReadingSuiteTimerState
} from './contracts.js'
import { createReadingPracticeSubmission } from './reading-sessions.js'
import { createHttpError } from '../shared/http.js'

type AnyRecord = Record<string, unknown>

function normalizeFlowMode(value: unknown): ReadingSuiteFlowMode {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'classic' || normalized === 'stationary' || normalized === 'simulation'
    ? normalized
    : 'simulation'
}

function normalizeFrequencyScope(value: unknown): ReadingSuiteFrequencyScope {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'high' || normalized === 'high_medium' || normalized === 'all' || normalized === 'custom'
    ? normalized
    : 'all'
}

function normalizeTimerMode(value: unknown): ReadingSuiteTimerMode {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'countdown' ? 'countdown' : 'elapsed'
}

function normalizeNonNegativeInteger(value: unknown): number | null {
  if (value == null || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : null
}

function normalizePositiveInteger(value: unknown): number | null {
  if (value == null || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : null
}

function isFrequencyIncluded(frequency: unknown, scope: ReadingSuiteFrequencyScope): boolean {
  if (scope === 'custom') return true
  const normalized = String(frequency == null ? '' : frequency).trim().toLowerCase()
  if (!normalized) return true
  if (scope === 'high') {
    return ['high', '高频', 'ultra-high', '超高频'].includes(normalized)
  }
  if (scope === 'high_medium') {
    return ['high', 'medium', 'mid', '高频', '次高频', '中频'].includes(normalized)
  }
  return true
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function selectEntry(pool: PracticeAsset[], seed: string, category: string): PracticeAsset {
  if (!pool.length) {
    throw createHttpError('reading_suite_category_missing', `Reading suite is missing category ${category}`, 409)
  }
  const sorted = pool.slice().sort((left, right) => left.id.localeCompare(right.id, 'en'))
  const index = stableHash(`${seed}:${category}`) % sorted.length
  return sorted[index]
}

function assetCategory(asset: PracticeAsset): string {
  return typeof asset.category === 'string' ? asset.category.trim().toUpperCase() : ''
}

function toPassageEntry(index: number, asset: PracticeAsset): ReadingSuitePassageEntry {
  const examId = String(asset.id || '').trim()
  return {
    index,
    assetId: examId,
    examId,
    title: String(asset.title || examId),
    category: assetCategory(asset) || `P${index + 1}`,
    status: index === 0 ? 'active' : 'pending',
    sessionId: null,
    submittedAt: null,
    scoreInfo: null
  }
}

function hasReadingPayload(asset: PracticeAsset): boolean {
  return Boolean(typeof asset.payloadRef === 'string' && asset.payloadRef.trim())
}

function assetMetadata(asset: PracticeAsset): Record<string, unknown> {
  return asset.metadata && typeof asset.metadata === 'object' && !Array.isArray(asset.metadata)
    ? asset.metadata
    : {}
}

function normalizeRequestedSequenceId(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).trim()
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return ''
  }
  const input = value as AnyRecord
  return String(input.assetId || input.examId || input.id || '').trim()
}

function findReadingAsset(
  assets: PracticeAsset[],
  requestedId: string
): PracticeAsset | null {
  return assets.find((asset) => {
    const metadata = assetMetadata(asset)
    return asset.id === requestedId
      || String(asset.payloadRef || '').trim() === requestedId
      || String(metadata.dataKey || '').trim() === requestedId
      || String(metadata.legacyFilename || '').trim() === requestedId
  }) || null
}

function createExplicitSequence(
  assets: PracticeAsset[],
  requestedSequence: unknown
): ReadingSuitePassageEntry[] | null {
  if (!Array.isArray(requestedSequence) || requestedSequence.length === 0) {
    return null
  }

  const requestedIds = requestedSequence
    .map(normalizeRequestedSequenceId)
    .filter(Boolean)
  const categories = ['P1', 'P2', 'P3']
  if (requestedIds.length !== categories.length || new Set(requestedIds).size !== requestedIds.length) {
    throw createHttpError('reading_suite_custom_sequence_invalid', 'Custom reading suite requires exactly one P1, P2, and P3 passage', 400)
  }

  return requestedIds.map((requestedId, index) => {
    const asset = findReadingAsset(assets, requestedId)
    if (!asset) {
      throw createHttpError('reading_suite_custom_asset_not_found', `Reading suite custom asset not found: ${requestedId}`, 404)
    }
    const category = assetCategory(asset)
    if (asset.activity !== 'reading' || category !== categories[index] || !hasReadingPayload(asset)) {
      throw createHttpError('reading_suite_custom_sequence_invalid', 'Custom reading suite sequence must be ordered as P1, P2, P3 and use practice-ready reading assets', 409, {
        assetId: requestedId,
        expectedCategory: categories[index],
        actualCategory: category || null
      })
    }
    return toPassageEntry(index, asset)
  })
}

function getFrequency(asset: PracticeAsset): unknown {
  return assetMetadata(asset).frequency
}

function getPracticeReadyReadingAssets(
  assets: PracticeAsset[],
  frequencyScope: ReadingSuiteFrequencyScope
): PracticeAsset[] {
  return assets.filter((asset) => (
    asset
    && asset.activity === 'reading'
    && asset.source === 'reading_exam'
    && hasReadingPayload(asset)
    && isFrequencyIncluded(getFrequency(asset), frequencyScope)
  ))
}

function emptyAggregate(totalPassages: number) {
  return {
    submittedPassages: 0,
    totalPassages,
    correct: 0,
    totalQuestions: 0,
    accuracy: 0,
    percentage: 0,
    duration: 0
  }
}

function createReadingSuiteTimerState(value: unknown, fallbackAnchorMs = Date.now()): ReadingSuiteTimerState {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as AnyRecord
    : {}
  const anchorMs = normalizePositiveInteger(
    input.anchorMs
    ?? input.effectiveStartTimeMs
    ?? fallbackAnchorMs
  ) || Math.max(1, Math.floor(fallbackAnchorMs))
  const limitSeconds = normalizeNonNegativeInteger(input.limitSeconds)
  const pausedOffsetMs = normalizeNonNegativeInteger(input.pausedOffsetMs) || 0
  const pausedAtMs = normalizePositiveInteger(input.pausedAtMs)
  return {
    source: 'suite',
    anchorMs,
    effectiveStartTimeMs: anchorMs,
    mode: normalizeTimerMode(input.mode),
    limitSeconds,
    pausedOffsetMs,
    pausedAtMs,
    running: input.running !== false
  }
}

function mergeSuiteTimerSnapshot(
  currentTimer: ReadingSuiteTimerState,
  value: unknown
): ReadingSuiteTimerState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createReadingSuiteTimerState(currentTimer, currentTimer.anchorMs)
  }
  const input = value as AnyRecord
  const anchorMs = normalizePositiveInteger(currentTimer.anchorMs)
    || normalizePositiveInteger(input.anchorMs)
    || normalizePositiveInteger(input.effectiveStartTimeMs)
    || Date.now()
  const pausedOffsetMs = normalizeNonNegativeInteger(input.pausedOffsetMs)
    ?? currentTimer.pausedOffsetMs
    ?? 0
  const pausedAtMs = normalizePositiveInteger(input.pausedAtMs)
  const limitSeconds = normalizeNonNegativeInteger(input.limitSeconds)
    ?? currentTimer.limitSeconds
    ?? null
  return {
    source: 'suite',
    anchorMs,
    effectiveStartTimeMs: anchorMs,
    mode: normalizeTimerMode(input.mode || currentTimer.mode),
    limitSeconds,
    pausedOffsetMs,
    pausedAtMs,
    running: typeof input.running === 'boolean' ? input.running : currentTimer.running
  }
}

function recomputeAggregate(sequence: ReadingSuitePassageEntry[]) {
  const submitted = sequence.filter((entry) => entry.status === 'submitted' && entry.scoreInfo)
  const correct = submitted.reduce((sum, entry) => sum + Number(entry.scoreInfo?.correct || 0), 0)
  const totalQuestions = submitted.reduce((sum, entry) => sum + Number(entry.scoreInfo?.totalQuestions || entry.scoreInfo?.total || 0), 0)
  const duration = submitted.reduce((sum, entry) => sum + Number(entry.scoreInfo?.duration || 0), 0)
  const accuracy = totalQuestions > 0 ? correct / totalQuestions : 0
  return {
    submittedPassages: submitted.length,
    totalPassages: sequence.length,
    correct,
    totalQuestions,
    accuracy,
    percentage: Math.round(accuracy * 100),
    duration
  }
}

function cloneSuiteSession(session: ReadingSuiteSession): ReadingSuiteSession {
  const snapshot = JSON.parse(JSON.stringify(session)) as ReadingSuiteSession
  if (!snapshot.timer) {
    const fallbackAnchorMs = Date.parse(snapshot.createdAt)
    snapshot.timer = createReadingSuiteTimerState(
      null,
      Number.isFinite(fallbackAnchorMs) && fallbackAnchorMs > 0 ? fallbackAnchorMs : Date.now()
    )
  } else {
    const fallbackAnchorMs = Date.parse(snapshot.createdAt)
    snapshot.timer = createReadingSuiteTimerState(
      snapshot.timer,
      Number.isFinite(fallbackAnchorMs) && fallbackAnchorMs > 0 ? fallbackAnchorMs : Date.now()
    )
  }
  return snapshot
}

export function createReadingSuiteSession(
  assets: PracticeAsset[],
  request: ReadingSuiteCreateRequest = {}
): ReadingSuiteSession {
  const flowMode = normalizeFlowMode(request.flowMode)
  const frequencyScope = normalizeFrequencyScope(request.frequencyScope)
  const seed = String(request.seed || randomUUID()).trim()
  const explicitSequence = createExplicitSequence(assets, request.sequence)
  const entries = getPracticeReadyReadingAssets(assets, frequencyScope)

  const categories = ['P1', 'P2', 'P3']
  const sequence = explicitSequence || categories.map((category, index) => {
    const picked = selectEntry(entries.filter((asset) => assetCategory(asset) === category), seed, category)
    return toPassageEntry(index, picked)
  })
  const nowMs = Date.now()
  const now = new Date(nowMs).toISOString()
  return {
    sessionId: `suite-${randomUUID()}`,
    activity: 'reading',
    practiceMode: 'suite',
    status: 'active',
    flowMode,
    frequencyScope,
    timer: createReadingSuiteTimerState(request.timer, nowMs),
    currentIndex: 0,
    totalPassages: sequence.length,
    sequence,
    aggregate: emptyAggregate(sequence.length),
    createdAt: now,
    updatedAt: now,
    completedAt: null
  }
}

export function submitReadingSuitePassage(
  session: ReadingSuiteSession,
  readingPayload: ReadingPracticePayload,
  attempt: AnyRecord = {},
  settings: AnyRecord = {}
): { suiteSession: ReadingSuiteSession; submission: ReadingPracticeSubmission } {
  if (!session || session.practiceMode !== 'suite') {
    throw createHttpError('reading_suite_not_found', 'Reading suite session not found', 404)
  }
  if (session.status !== 'active') {
    throw createHttpError('reading_suite_not_active', 'Reading suite session is not active', 409)
  }

  const assetId = String(readingPayload.examId || '').trim()
  const passageIndex = session.sequence.findIndex((entry) => entry.assetId === assetId || entry.examId === assetId)
  if (passageIndex < 0) {
    throw createHttpError('reading_suite_passage_mismatch', `Reading asset is not part of this suite: ${assetId}`, 409)
  }
  if (passageIndex !== session.currentIndex) {
    throw createHttpError('reading_suite_passage_out_of_order', 'Submit the active suite passage before moving on', 409)
  }

  const passage = session.sequence[passageIndex]
  const submission = createReadingPracticeSubmission(readingPayload, attempt, {
    ...settings,
    sessionId: typeof settings.sessionId === 'string' && settings.sessionId.trim()
      ? settings.sessionId
      : `reading-${session.sessionId}-p${passageIndex + 1}`
  })
  submission.metadata = {
    ...submission.metadata,
    practiceMode: 'suite',
    suiteSessionId: session.sessionId,
    suitePassageIndex: passageIndex,
    suitePassageTotal: session.sequence.length
  }
  submission.legacy = {
    ...submission.legacy,
    practiceMode: 'suite'
  }
  session.timer = mergeSuiteTimerSnapshot(session.timer, submission.metadata?.timerSnapshot ?? attempt.timerSnapshot)

  passage.status = 'submitted'
  passage.sessionId = submission.sessionId
  passage.submittedAt = submission.submittedAt
  passage.scoreInfo = submission.scoreInfo

  const nextIndex = passageIndex + 1
  if (nextIndex < session.sequence.length) {
    session.sequence[nextIndex].status = 'active'
    session.currentIndex = nextIndex
  } else {
    session.currentIndex = passageIndex
    session.status = 'completed'
    session.completedAt = submission.submittedAt
  }
  session.aggregate = recomputeAggregate(session.sequence)
  session.updatedAt = new Date().toISOString()

  return {
    suiteSession: cloneSuiteSession(session),
    submission
  }
}

export function cloneReadingSuiteSession(session: ReadingSuiteSession): ReadingSuiteSession {
  return cloneSuiteSession(session)
}
