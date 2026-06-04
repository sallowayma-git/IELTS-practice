import fs from 'node:fs'
import path from 'node:path'
import type {
  ReadingInteractionOption,
  ReadingOfficialQuestionExplanationSection,
  ReadingOfficialReviewExplanations,
  ReadingPracticePayload,
  ReadingQuestionGroup,
  ReadingQuestionInteraction
} from '../contracts.js'
import { createHttpError } from '../../shared/http.js'
import { setBoundedCacheEntry, touchCacheEntry } from '../../shared/cache.js'
import {
  parseReadingExamDataSource,
  parseReadingExplanationDataSource,
  parseReadingManifestSource,
  type ReadingGeneratedManifest
} from '../../shared/reading-generated-data.js'
export { parseReadingExamDataSource, parseReadingExplanationDataSource, parseReadingManifestSource } from '../../shared/reading-generated-data.js'

type AnyRecord = Record<string, unknown>

export type ReadingManifest = ReadingGeneratedManifest

const READING_PAYLOAD_CACHE_LIMIT = 32

let readingManifestCache: ReadingManifest | null = null
const readingPayloadCache = new Map<string, ReadingPracticePayload>()

export function getReadingAssetCacheStats() {
  return {
    manifestCached: Boolean(readingManifestCache),
    payloadEntries: readingPayloadCache.size,
    payloadLimit: READING_PAYLOAD_CACHE_LIMIT,
    payloadAssetIds: Array.from(readingPayloadCache.keys()).map((key) => key.split('\u0000')[0])
  }
}

export function clearReadingAssetCaches() {
  readingManifestCache = null
  readingPayloadCache.clear()
}

function isRecord(value: unknown): value is AnyRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asPlainText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function sanitizeHtml(value: unknown): string {
  const source = typeof value === 'string' ? value : ''
  return source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
}

function normalizeQuestionId(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  const direct = raw.match(/^q(\d+)$/)
  if (direct) return `q${Number(direct[1])}`
  const numeric = raw.match(/^(\d+)$/)
  return numeric ? `q${Number(numeric[1])}` : raw
}

function stripTags(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function readAttribute(tag: string, attributeName: string): string {
  const pattern = new RegExp(`\\s${attributeName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  const match = tag.match(pattern)
  return String(match?.[1] || match?.[2] || match?.[3] || '').trim()
}

function normalizeNumber(value: unknown): number | null {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function hasClass(tag: string, className: string): boolean {
  const classes = readAttribute(tag, 'class').split(/\s+/).filter(Boolean)
  return classes.includes(className)
}

function parseInputTags(html: string) {
  return Array.from(html.matchAll(/<input\b[^>]*>/gi)).map((match) => {
    const tag = match[0]
    return {
      tag,
      type: readAttribute(tag, 'type').toLowerCase() || 'text',
      name: readAttribute(tag, 'name'),
      value: readAttribute(tag, 'value')
    }
  }).filter((input) => input.name)
}

function uniqueOptions(options: ReadingInteractionOption[]): ReadingInteractionOption[] {
  const seen = new Set<string>()
  const output: ReadingInteractionOption[] = []
  options.forEach((option) => {
    const value = String(option.value || '').trim()
    if (!value || seen.has(value)) return
    seen.add(value)
    output.push({
      value,
      label: String(option.label || value).trim()
    })
  })
  return output
}

function extractDragOptions(html: string): ReadingInteractionOption[] {
  const options: ReadingInteractionOption[] = []
  const tagPattern = /<(?:div|span)\b[^>]*class=(?:"[^"]*(?:drag-item|draggable-word)[^"]*"|'[^']*(?:drag-item|draggable-word)[^']*')[^>]*>[\s\S]*?<\/(?:div|span)>/gi
  Array.from(html.matchAll(tagPattern)).forEach((match) => {
    const node = match[0]
    const openTag = node.match(/^<[^>]+>/)?.[0] || ''
    const value = readAttribute(openTag, 'data-heading')
      || readAttribute(openTag, 'data-option')
      || readAttribute(openTag, 'data-word')
      || readAttribute(openTag, 'data-key')
      || readAttribute(openTag, 'data-value')
      || readAttribute(openTag, 'value')
    if (!value) return
    options.push({
      value,
      label: stripTags(node)
    })
  })
  return uniqueOptions(options)
}

function expandQuestionSequence(rawValue: string): string[] {
  const value = String(rawValue || '').trim().toLowerCase()
  if (!value) return []
  const numbers = (value.match(/\d+/g) || []).map((entry) => Number(entry))
  if ((value.includes('-') || value.includes('–')) && numbers.length === 2 && numbers[1] >= numbers[0]) {
    const ids: string[] = []
    for (let current = numbers[0]; current <= numbers[1]; current += 1) {
      ids.push(`q${current}`)
    }
    return ids
  }
  if ((value.includes('_') || value.includes('-') || value.includes('–')) && numbers.length >= 2) {
    return numbers.map((entry) => `q${entry}`)
  }
  const normalized = normalizeQuestionId(value)
  return normalized ? [normalized] : []
}

function toDisplayLabel(questionId: string, displayMap: Record<string, string>): string {
  return String(displayMap[questionId] || questionId.replace(/^q/i, '')).trim()
}

function addInteraction(
  model: Record<string, ReadingQuestionInteraction>,
  questionId: string,
  displayMap: Record<string, string>,
  patch: Omit<ReadingQuestionInteraction, 'questionId' | 'displayLabel'>
) {
  const normalized = normalizeQuestionId(questionId)
  if (!normalized) return
  model[normalized] = {
    questionId: normalized,
    displayLabel: toDisplayLabel(normalized, displayMap),
    ...patch
  }
}

function buildInteractionModel(
  groups: ReadingQuestionGroup[],
  questionOrder: string[],
  displayMap: Record<string, string>
): Record<string, ReadingQuestionInteraction> {
  const model: Record<string, ReadingQuestionInteraction> = {}

  groups.forEach((group) => {
    const groupOptions = extractDragOptions(group.bodyHtml)
    const inputTags = parseInputTags(group.bodyHtml)

    inputTags.forEach((input) => {
      const questionIds = expandQuestionSequence(input.name)
      if (!questionIds.length) return

      if (input.type === 'radio') {
        const options = uniqueOptions(
          inputTags
            .filter((candidate) => candidate.type === 'radio' && candidate.name === input.name)
            .map((candidate) => ({ value: candidate.value, label: candidate.value }))
        )
        questionIds.forEach((questionId) => {
          addInteraction(model, questionId, displayMap, {
            control: 'radio',
            source: 'native_input',
            name: input.name,
            options
          })
        })
        return
      }

      if (input.type === 'checkbox') {
        const options = uniqueOptions(
          inputTags
            .filter((candidate) => candidate.type === 'checkbox' && candidate.name === input.name)
            .map((candidate) => ({ value: candidate.value, label: candidate.value }))
        )
        questionIds.forEach((questionId) => {
          addInteraction(model, questionId, displayMap, {
            control: 'checkbox',
            source: 'native_input',
            name: input.name,
            options
          })
        })
        return
      }

      questionIds.forEach((questionId) => {
        addInteraction(model, questionId, displayMap, {
          control: 'text',
          source: 'native_input',
          name: input.name
        })
      })
    })

    if (!groupOptions.length) {
      return
    }

    group.questionIds.forEach((questionId) => {
      if (model[questionId]) return
      addInteraction(model, questionId, displayMap, {
        control: 'dragdrop',
        source: 'dropzone',
        name: questionId,
        options: groupOptions,
        allowOptionReuse: Boolean(group.allowOptionReuse)
      })
    })
  })

  questionOrder.forEach((questionId) => {
    if (model[questionId]) return
    addInteraction(model, questionId, displayMap, {
      control: 'text',
      source: 'fallback',
      name: questionId
    })
  })

  return model
}

function resolveExamScriptPath(examsDir: string, manifestEntry: AnyRecord, assetId: string): string {
  const rawScript = asString(manifestEntry.script, `./${assetId}.js`)
  const resolved = path.resolve(examsDir, rawScript)
  const relative = path.relative(examsDir, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw createHttpError('reading_asset_path_invalid', `Invalid reading asset script path: ${rawScript}`, 500)
  }
  return resolved
}

function resolveExplanationScriptPath(explanationsDir: string, assetId: string): string {
  const resolved = path.resolve(explanationsDir, `${assetId}.js`)
  const relative = path.relative(explanationsDir, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw createHttpError('reading_explanation_path_invalid', `Invalid reading explanation script path: ${assetId}`, 500)
  }
  return resolved
}

function normalizeExplanationMeta(meta: unknown, dataset: AnyRecord, assetId: string): Record<string, string | null> {
  const source = isRecord(meta) ? meta : {}
  return {
    examId: asString(source.examId, asString(dataset.examId, assetId)),
    title: asOptionalString(source.title),
    category: asOptionalString(source.category ?? dataset.category),
    sourceDoc: asOptionalString(source.sourceDoc),
    noteType: asOptionalString(source.noteType),
    matchedTitle: asOptionalString(source.matchedTitle)
  }
}

function normalizeQuestionRange(value: unknown) {
  if (!isRecord(value)) return null
  const start = normalizeNumber(value.start)
  const end = normalizeNumber(value.end)
  if (start == null || end == null) return null
  return {
    start,
    end
  }
}

function normalizeQuestionExplanationSection(section: AnyRecord, index: number): ReadingOfficialQuestionExplanationSection | null {
  const items = Array.isArray(section.items)
    ? section.items
        .filter(isRecord)
        .map((item) => {
          const questionNumber = normalizeNumber(item.questionNumber)
          const text = asPlainText(item.text)
          if (questionNumber == null || !text) return null
          const questionId = normalizeQuestionId(item.questionId) || normalizeQuestionId(questionNumber)
          return {
            questionNumber,
            questionId: questionId || null,
            text
          }
        })
        .filter((item): item is { questionNumber: number; questionId: string | null; text: string } => Boolean(item))
    : []
  const text = asOptionalString(section.text)
  if (!items.length && !text) {
    return null
  }
  return {
    sectionTitle: asString(section.sectionTitle, `题目讲解 ${index + 1}`),
    mode: asOptionalString(section.mode),
    questionRange: normalizeQuestionRange(section.questionRange),
    text,
    items
  }
}

function normalizeOfficialReviewExplanations(dataset: AnyRecord, assetId: string): ReadingOfficialReviewExplanations | null {
  const passageNotes = Array.isArray(dataset.passageNotes)
    ? dataset.passageNotes
        .filter(isRecord)
        .map((note, index) => ({
          label: asString(note.label, `Paragraph ${index + 1}`),
          text: asPlainText(note.text)
        }))
        .filter((note) => note.text)
    : []
  const questionExplanations = Array.isArray(dataset.questionExplanations)
    ? dataset.questionExplanations
        .filter(isRecord)
        .map((section, index) => normalizeQuestionExplanationSection(section, index))
        .filter((section): section is ReadingOfficialQuestionExplanationSection => Boolean(section))
    : []

  if (!passageNotes.length && !questionExplanations.length) {
    return null
  }
  return {
    schemaVersion: asString(dataset.schemaVersion, 'ReadingExplanationV1'),
    examId: asString(dataset.examId, assetId),
    meta: normalizeExplanationMeta(dataset.meta, dataset, assetId),
    passageNotes,
    questionExplanations
  }
}

function resolveExistingExplanationScriptPath(assetId: string, expectedKey: string): string | null {
  const explanationsDir = path.resolve(__dirname, '../../../../../assets/generated/reading-explanations')
  const candidates = [expectedKey, assetId].filter((value, index, list) => value && list.indexOf(value) === index)
  for (const candidate of candidates) {
    const explanationPath = resolveExplanationScriptPath(explanationsDir, candidate)
    if (fs.existsSync(explanationPath)) {
      return explanationPath
    }
  }
  return null
}

function loadOfficialReviewExplanations(assetId: string, expectedKey: string, explanationPath: string | null): ReadingOfficialReviewExplanations | null {
  if (!explanationPath) return null
  const { key: capturedKey, payload } = parseReadingExplanationDataSource(fs.readFileSync(explanationPath, 'utf8'))
  if (capturedKey && capturedKey !== expectedKey && capturedKey !== assetId) {
    throw createHttpError('reading_explanation_key_mismatch', `Reading explanation key mismatch: ${assetId}`, 500)
  }
  return normalizeOfficialReviewExplanations(payload, assetId)
}

export function loadReadingManifest(): ReadingManifest {
  if (readingManifestCache) {
    return readingManifestCache
  }

  const manifestPath = path.resolve(__dirname, '../../../../../assets/generated/reading-exams/manifest.js')
  if (!fs.existsSync(manifestPath)) {
    throw createHttpError('reading_manifest_missing', 'Reading manifest is missing', 500)
  }
  readingManifestCache = parseReadingManifestSource(fs.readFileSync(manifestPath, 'utf8'))
  return readingManifestCache
}

function normalizeReadingDataset(dataset: AnyRecord, assetId: string): ReadingPracticePayload {
  const meta = isRecord(dataset.meta) ? dataset.meta : {}
  const rawPassage = isRecord(dataset.passage) ? dataset.passage : {}
  const blocks = Array.isArray(rawPassage.blocks) ? rawPassage.blocks : []
  const questionGroups = Array.isArray(dataset.questionGroups) ? dataset.questionGroups : []
  const answerKey = isRecord(dataset.answerKey) ? dataset.answerKey : {}
  const questionOrder = Array.isArray(dataset.questionOrder)
    ? dataset.questionOrder.map((item) => normalizeQuestionId(item)).filter(Boolean)
    : Object.keys(answerKey).map((item) => normalizeQuestionId(item)).filter(Boolean)
  const questionDisplayMap = isRecord(dataset.questionDisplayMap)
    ? Object.fromEntries(Object.entries(dataset.questionDisplayMap).map(([key, value]) => [normalizeQuestionId(key), String(value || '').trim()]))
    : Object.fromEntries(questionOrder.map((questionId) => [questionId, questionId.replace(/^q/i, '')]))
  const normalizedGroups: ReadingQuestionGroup[] = questionGroups
    .filter(isRecord)
    .map((group, index) => ({
      groupId: asString(group.groupId, `group-${index + 1}`),
      kind: asString(group.kind, 'unknown'),
      questionIds: Array.isArray(group.questionIds)
        ? group.questionIds.map((item) => normalizeQuestionId(item)).filter(Boolean)
        : [],
      bodyHtml: sanitizeHtml(group.bodyHtml),
      leadHtml: group.leadHtml == null ? null : sanitizeHtml(group.leadHtml),
      allowOptionReuse: Boolean(group.allowOptionReuse)
    }))

  return {
    schemaVersion: asString(dataset.schemaVersion, 'ReadingExamSourceV1'),
    examId: asString(dataset.examId, assetId),
    meta: {
      title: asString(meta.title, asString(dataset.examId, assetId)),
      category: asOptionalString(meta.category),
      frequency: asOptionalString(meta.frequency),
      pdfFilename: asOptionalString(meta.pdfFilename),
      legacyPath: asOptionalString(meta.legacyPath),
      legacyFilename: asOptionalString(meta.legacyFilename),
      questionIntroHtml: meta.questionIntroHtml == null ? null : sanitizeHtml(meta.questionIntroHtml)
    },
    passage: {
      blocks: blocks
        .filter(isRecord)
        .map((block, index) => ({
          blockId: asString(block.blockId, `passage-${index + 1}`),
          kind: 'html',
          html: sanitizeHtml(block.html || block.bodyHtml)
        }))
    },
    questionGroups: normalizedGroups,
    answerKey,
    questionOrder,
    questionDisplayMap,
    questionCount: questionOrder.length,
    sourceRefs: isRecord(dataset.sourceRefs) ? dataset.sourceRefs : undefined,
    audit: isRecord(dataset.audit) ? dataset.audit : undefined,
    interactionModel: buildInteractionModel(normalizedGroups, questionOrder, questionDisplayMap)
  }
}

export function normalizeReadingPracticePayloadForTest(dataset: Record<string, unknown>, assetId: string): ReadingPracticePayload {
  return normalizeReadingDataset(dataset, assetId)
}

export function loadReadingPracticePayload(assetId: string, manifestEntry: AnyRecord): ReadingPracticePayload {
  const examsDir = path.resolve(__dirname, '../../../../../assets/generated/reading-exams')
  const examPath = resolveExamScriptPath(examsDir, manifestEntry, assetId)
  if (!fs.existsSync(examPath)) {
    throw createHttpError('reading_asset_missing', `Reading asset script is missing: ${assetId}`, 404)
  }

  const expectedKey = asString(manifestEntry.dataKey, asString(manifestEntry.examId, assetId))
  const explanationPath = resolveExistingExplanationScriptPath(assetId, expectedKey)
  const cacheKey = `${assetId}\u0000${expectedKey}\u0000${examPath}\u0000${explanationPath || 'no-explanation'}`
  const cached = touchCacheEntry(readingPayloadCache, cacheKey)
  if (cached) {
    return cached
  }

  const source = fs.readFileSync(examPath, 'utf8')
  const { key: capturedKey, payload } = parseReadingExamDataSource(source)
  if (capturedKey && capturedKey !== expectedKey && capturedKey !== assetId) {
    throw createHttpError('reading_asset_key_mismatch', `Reading asset key mismatch: ${assetId}`, 500)
  }

  const normalized = normalizeReadingDataset(payload, assetId)
  normalized.reviewExplanations = loadOfficialReviewExplanations(assetId, expectedKey, explanationPath)
  setBoundedCacheEntry(readingPayloadCache, cacheKey, normalized, READING_PAYLOAD_CACHE_LIMIT)
  return normalized
}
