#!/usr/bin/env node
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..', '..')
const require = createRequire(import.meta.url)

function ensureServerBundle() {
  execFileSync('npm', ['run', 'build:server'], {
    cwd: repoRoot,
    stdio: 'inherit'
  })
}

function createFakePracticeHistoryDb() {
  const historyRows = new Map()
  const suiteRows = new Map()
  const clone = (value) => JSON.parse(JSON.stringify(value))
  return {
    exec() {},
    close() {},
    prepare(sql) {
      const normalized = String(sql || '').replace(/\s+/g, ' ').trim()
      if (normalized.startsWith('INSERT INTO practice_history_records')) {
        return {
          run(record) {
            historyRows.set(record.id, {
              id: record.id,
              activity: record.activity,
              session_id: record.sessionId,
              asset_id: record.assetId,
              exam_id: record.examId,
              title: record.title,
              status: record.status,
              score: record.score,
              total_questions: record.totalQuestions,
              correct_answers: record.correctAnswers,
              accuracy: record.accuracy,
              duration: record.duration,
              submitted_at: record.submittedAt,
              started_at: record.startTime,
              ended_at: record.endTime,
              metadata_json: record.metadataJson,
              submission_json: record.submissionJson,
              created_at: record.submittedAt,
              updated_at: record.updatedAt
            })
            return { changes: 1 }
          }
        }
      }
      if (normalized.startsWith('SELECT * FROM practice_history_records WHERE id = ? AND activity = ?')) {
        return {
          get(id, activity) {
            const row = historyRows.get(id)
            return row && row.activity === activity ? clone(row) : undefined
          }
        }
      }
      if (normalized.startsWith('SELECT * FROM practice_history_records WHERE session_id = ? AND activity = ?')) {
        return {
          get(sessionId, activity) {
            const row = Array.from(historyRows.values()).find((entry) => entry.session_id === sessionId && entry.activity === activity)
            return row ? clone(row) : undefined
          }
        }
      }
      if (normalized.startsWith('INSERT INTO practice_reading_suite_sessions')) {
        return {
          run(record) {
            suiteRows.set(record.sessionId, {
              session_id: record.sessionId,
              status: record.status,
              flow_mode: record.flowMode,
              frequency_scope: record.frequencyScope,
              current_index: record.currentIndex,
              total_passages: record.totalPassages,
              session_json: record.sessionJson,
              created_at: record.createdAt,
              updated_at: record.updatedAt,
              completed_at: record.completedAt
            })
            return { changes: 1 }
          }
        }
      }
      if (normalized.startsWith('SELECT * FROM practice_reading_suite_sessions WHERE session_id = ?')) {
        return {
          get(sessionId) {
            const row = suiteRows.get(sessionId)
            return row ? clone(row) : undefined
          }
        }
      }
      throw new Error(`Unsupported SQL in CORE-10 test double: ${normalized}`)
    }
  }
}

function createMockServices(options = {}) {
  return {
    db: options.db || {},
    configService: {},
    promptService: {},
    settingsService: {
      async get() { return true },
      async getAll() { return {} },
      async update(payload = {}) { return payload },
      async reset() { return true }
    },
    uploadService: {},
    essayService: {},
    topicService: {
      async list(_filters, pagination) {
        return { data: [], total: 0, page: pagination.page, limit: pagination.limit }
      },
      async getById() {
        return null
      }
    },
    evaluateService: {
      async start() { return { sessionId: 'writing-session-1' } },
      async getSessionState(sessionId) { return { sessionId, active: true, status: 'running', lastSequence: 0, events: [] } },
      async cancel(sessionId) { return { ok: true, sessionId } },
      subscribeSession() { return () => {} }
    },
    readingCoachService: {
      async query() {
        return {
          coachVersion: 'test',
          answer: 'noop',
          answerSections: [],
          followUps: [],
          confidence: 'high'
        }
      }
    }
  }
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

function testReadingGeneratedParserRejectsInvalidKey() {
  const { parseReadingExamDataSource } = require(path.join(repoRoot, 'server/dist/lib/shared/reading-generated-data.js'))
  let thrown = null
  try {
    parseReadingExamDataSource('__READING_EXAM_DATA__.register(not_json, {"examId":"bad-key"})')
  } catch (error) {
    thrown = error
  }
  assert.ok(thrown, 'invalid register key 必须抛错')
  assert.strictEqual(thrown.code, 'reading_asset_parse_failed')
  assert.match(String(thrown.message || ''), /Generated register key is not a JSON string/)
}

function testReadingPayloadSanitizesScriptsAndInlineHandlers() {
  const { normalizeReadingPracticePayloadForTest } = require(path.join(repoRoot, 'server/dist/lib/practice/reading/reading-generated-loader.js'))
  const payload = normalizeReadingPracticePayloadForTest({
    examId: 'sanitize-case',
    meta: {
      title: 'sanitize-case',
      questionIntroHtml: '<div onclick="steal()">Intro<script>alert(1)</script></div>'
    },
    passage: {
      blocks: [
        {
          blockId: 'p-1',
          html: '<p onmouseover="evil()">Alpha<script>alert(1)</script><img src="x" onerror="boom()"></p>'
        }
      ]
    },
    questionGroups: [
      {
        groupId: 'g-1',
        kind: 'summary_completion',
        questionIds: ['q1'],
        bodyHtml: '<div onclick="x()"><input type="text" name="q1" value=""></div>',
        leadHtml: '<p onload="y()">Lead<script>hack()</script></p>',
        allowOptionReuse: false
      }
    ],
    answerKey: { q1: 'A' },
    questionOrder: ['q1'],
    questionDisplayMap: { q1: '1' }
  }, 'sanitize-case')

  assert.ok(!payload.meta.questionIntroHtml.includes('<script'))
  assert.ok(!payload.meta.questionIntroHtml.includes('onclick='))
  assert.ok(!payload.passage.blocks[0].html.includes('<script'))
  assert.ok(!payload.passage.blocks[0].html.includes('onmouseover='))
  assert.ok(!payload.passage.blocks[0].html.includes('onerror='))
  assert.ok(!payload.questionGroups[0].bodyHtml.includes('onclick='))
  assert.ok(!payload.questionGroups[0].leadHtml.includes('<script'))
  assert.ok(!payload.questionGroups[0].leadHtml.includes('onload='))
}

function testBuiltinReadingAssetProviderExplicitListAndDetail() {
  const { BuiltinReadingAssetProvider } = require(path.join(repoRoot, 'server/dist/lib/practice/reading/BuiltinReadingAssetProvider.js'))
  const provider = new BuiltinReadingAssetProvider()
  const listed = provider.listAssets()
  assert.ok(Array.isArray(listed) && listed.length > 200)
  assert.strictEqual(listed[0].activity, 'reading')
  assert.strictEqual(listed[0].source, 'reading_exam')

  const detail = provider.getAsset('p1-high-01')
  assert.strictEqual(detail.id, 'p1-high-01')
  assert.strictEqual(detail.payload.examId, 'p1-high-01')
  assert.strictEqual(detail.payload.answerKey.q1, 'viii')

  const byDataKey = provider.getAsset(String(detail.metadata.dataKey || 'p1-high-01'))
  assert.strictEqual(byDataKey.id, 'p1-high-01')
}

async function testReadingSuiteUsesInjectedProviderInsteadOfStaticManifest() {
  const { PracticeService } = require(path.join(repoRoot, 'server/dist/lib/practice/service.js'))
  const db = createFakePracticeHistoryDb()
  const calls = { listAssets: 0, getAsset: [] }
  const assets = ['P1', 'P2', 'P3'].map((category) => ({
    id: `provider-${category.toLowerCase()}`,
    activity: 'reading',
    title: `Provider ${category}`,
    source: 'reading_exam',
    category,
    payloadRef: `provider-${category.toLowerCase()}`,
    metadata: { dataKey: `provider-${category.toLowerCase()}`, frequency: 'high' },
    payload: {
      schemaVersion: 'ReadingExamSourceV1',
      examId: `provider-${category.toLowerCase()}`,
      meta: { title: `Provider ${category}`, category, frequency: 'high', questionIntroHtml: null },
      passage: { blocks: [{ blockId: `${category}-passage`, kind: 'html', html: `<p>${category}</p>` }] },
      questionGroups: [{
        groupId: `${category}-group`,
        kind: 'summary_completion',
        questionIds: ['q1'],
        bodyHtml: '<input type="text" name="q1">',
        leadHtml: null,
        allowOptionReuse: false
      }],
      answerKey: { q1: 'A' },
      questionOrder: ['q1'],
      questionDisplayMap: { q1: '1' },
      questionCount: 1,
      interactionModel: {
        q1: { questionId: 'q1', displayLabel: '1', control: 'text', source: 'native_input', name: 'q1' }
      }
    }
  }))

  const provider = {
    listAssets() {
      calls.listAssets += 1
      return assets.map(({ payload, ...asset }) => ({ ...asset }))
    },
    getAsset(assetId) {
      calls.getAsset.push(assetId)
      const found = assets.find((asset) => asset.id === assetId)
      if (!found) {
        const error = new Error(`not found: ${assetId}`)
        error.code = 'practice_asset_not_found'
        error.statusCode = 404
        throw error
      }
      return JSON.parse(JSON.stringify(found))
    },
    getStatus() {
      return {
        source: 'builtin',
        ready: true,
        assetCount: assets.length,
        htmlCount: assets.length,
        pdfCount: 0,
        version: 'core-10',
        lastLoadedAt: '2026-06-05T00:00:00.000Z',
        error: null
      }
    }
  }

  const service = new PracticeService(createMockServices({ db }), {
    readingAssetProvider: provider
  })
  const suite = await service.createReadingSuite({
    frequencyScope: 'custom',
    sequence: assets.map((asset) => asset.id)
  })

  assert.strictEqual(calls.listAssets, 1)
  assert.deepStrictEqual(suite.sequence.map((entry) => entry.assetId), assets.map((asset) => asset.id))

  const submit = await service.submitReadingSuitePassage(suite.sessionId, assets[0].id, {
    answers: { q1: 'A' },
    durationSec: 12
  })
  assert.strictEqual(submit.submission.examId, assets[0].id)
  assert.ok(calls.getAsset.includes(assets[0].id))
}

function testHistoryImportLegacyAdapterContractIsExplicit() {
  const facadeSource = readSource('server/src/lib/practice/history/PracticeHistoryFacade.ts')
  const adapterSource = readSource('server/src/lib/practice/history/LegacyReadingHistoryAdapter.ts')
  assert.ok(facadeSource.includes('LegacyReadingHistoryAdapter'))
  assert.ok(facadeSource.includes('this.legacyReadingAdapter.importRecords'))
  assert.ok(facadeSource.includes('collectLegacyPracticeRecords(payload)'))
  assert.ok(facadeSource.includes('mergeReadingImportResults(canonicalResult, legacyResult)'))
  assert.ok(adapterSource.includes('export class LegacyReadingHistoryAdapter'))
}

async function main() {
  ensureServerBundle()
  testBuiltinReadingAssetProviderExplicitListAndDetail()
  testReadingGeneratedParserRejectsInvalidKey()
  testReadingPayloadSanitizesScriptsAndInlineHandlers()
  await testReadingSuiteUsesInjectedProviderInsteadOfStaticManifest()
  testHistoryImportLegacyAdapterContractIsExplicit()
  console.log(JSON.stringify({
    status: 'pass',
    detail: 'CORE-10 reading provider/parser/sanitizer/suite/history contracts verified'
  }, null, 2))
}

main().catch((error) => {
  console.log(JSON.stringify({
    status: 'fail',
    detail: error && error.stack ? error.stack : String(error)
  }, null, 2))
  process.exit(1)
})
