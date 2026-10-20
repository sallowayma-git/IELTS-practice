/**
 * Command table for the dev-only Tauri mock. Each handler receives the invoke
 * args and returns the bare `data` payload; tauri-mock.js wraps it in the
 * `{ ok: true, data }` envelope. Failures throw via `fail()` and come back as
 * `{ ok: false, error }`, the same shape the Rust CommandResponse uses.
 *
 * Command names are the ones registered in src-tauri/src/lib.rs. Anything the
 * UI calls that is not in this table is reported as `[dev-mock] unhandled`.
 */
import {
  APP_DATA_PATHS,
  APP_INFO,
  EVAL_EVENT_TEMPLATE,
  buildWritingEvaluation,
  writingDetail,
} from './seed.js'
import { weeklyReports } from './weekly-reports.js'

const ZERO_MEMORY_CHANGES = { newCandidates: 0, promoted: 0, reinforced: 0, refined: 0, improved: 0, regressed: 0, contradicted: 0, superseded: 0 }

function fail(code, message) {
  const error = new Error(message)
  error.envelope = { code, message, retryable: false }
  return error
}

const clone = (value) => JSON.parse(JSON.stringify(value ?? null))
const idFrom = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const dateOf = (iso) => String(iso || '').slice(0, 10)

/** Lowercase trimmed comparison for reading answers; both sides are strings. */
const sameAnswer = (left, right) => String(left ?? '').trim().toLowerCase() === String(right ?? '').trim().toLowerCase()

// Mirrors crates/ielts-db/src/soul.rs validate_soul_field_at.
const SOUL_KEYS = new Set([
  'soul.nickname', 'soul.address', 'soul.tone', 'soul.toneSuggestion', 'soul.targetBand',
  'soul.examDate', 'soul.message', 'soul.companionNotes',
])

function tomorrowLocal() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function validateSoulField(key, value) {
  if (!SOUL_KEYS.has(key)) throw fail('soul.invalid_field', `invalid Soul field: ${key}`)
  if (value == null) return
  const text = typeof value === 'string' ? value : ''
  let valid = false
  switch (key) {
    case 'soul.nickname': valid = typeof value === 'string' && [...text].length <= 40; break
    case 'soul.address': valid = text === '你' || text === '您'; break
    case 'soul.tone':
    case 'soul.toneSuggestion': valid = ['温和', '平衡', '直接'].includes(text); break
    case 'soul.targetBand': valid = typeof value === 'number' && Number.isFinite(value)
      && value >= 4 && value <= 9 && value * 2 === Math.round(value * 2); break
    case 'soul.examDate': valid = text === '' || /^\d{4}-\d{2}-\d{2}$/.test(text) && text >= tomorrowLocal(); break
    case 'soul.message':
    case 'soul.companionNotes': valid = typeof value === 'string' && [...text].length <= 1000; break
  }
  if (!valid) throw fail('soul.invalid_field', `invalid Soul field: ${key}`)
}

// ------------------------------------------------------------ history ----

function filterHistory(items, query = {}) {
  const search = String(query.search || '').trim().toLowerCase()
  return items.filter((item) => {
    if (query.activity && item.activity !== query.activity) return false
    if (query.taskType && item.taskType !== query.taskType) return false
    if (search && !String(item.title || '').toLowerCase().includes(search)) return false
    if (query.startDate && dateOf(item.submittedAt) < query.startDate) return false
    if (query.endDate && dateOf(item.submittedAt) > query.endDate) return false
    if (query.minScore != null && Number(item.scoreValue) < Number(query.minScore)) return false
    if (query.maxScore != null && Number(item.scoreValue) > Number(query.maxScore)) return false
    return true
  })
}

function sortNewestFirst(items) {
  return [...items].sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)) || String(b.id).localeCompare(String(a.id)))
}

function criteriaOf(detail) {
  return detail?.evaluation?.score || null
}

function writingStatistics(state) {
  const writing = sortNewestFirst(state.history.items.filter((item) => item.activity === 'writing'))
  const scored = writing
    .map((item) => ({ item, score: criteriaOf(state.history.details[item.id]) }))
    .filter((row) => row.score)
  const average = (key) => {
    if (!scored.length) return null
    const total = scored.reduce((sum, row) => sum + Number(row.score[key] || 0), 0)
    return Math.round((total / scored.length) * 10) / 10
  }
  const latest = scored[0]
  const pick = (score) => ({ taskResponse: score.taskResponse, coherence: score.coherence, lexical: score.lexical, grammar: score.grammar })
  return {
    count: writing.length,
    latest: latest
      ? { score: pick(latest.score), taskType: latest.item.taskType, submittedAt: latest.item.submittedAt }
      : null,
    average: scored.length
      ? { taskResponse: average('taskResponse'), coherence: average('coherence'), lexical: average('lexical'), grammar: average('grammar') }
      : null,
  }
}

function historyCsv(items) {
  const rows = items.map((item) => [item.submittedAt, item.activity, item.taskType || '', `"${String(item.title).replace(/"/g, '""')}"`, item.scoreDisplay].join(','))
  return ['submittedAt,activity,taskType,title,score', ...rows].join('\n') + '\n'
}

function clearableCount(state, activity) {
  return state.history.items.filter((item) => item.mode !== 'memorize' && (!activity || item.activity === activity)).length
}

// ------------------------------------------------------------ reading ----

function recordReadingSubmission(state, cmd) {
  const asset = state.reading.assets.find((entry) => entry.id === cmd.assetId)
  const payload = state.reading.payloads[cmd.assetId]?.payload
  const key = payload?.answerKey || {}
  const questionIds = Object.keys(key)
  const answers = questionIds.map((questionId) => {
    const answer = cmd.answers?.[questionId] ?? null
    return {
      questionId,
      answer,
      isCorrect: answer != null && sameAnswer(answer, key[questionId]),
      weight: 1,
      questionKind: null,
      marked: (cmd.markedQuestions || []).includes(questionId),
    }
  })
  const correctCount = answers.filter((row) => row.isCorrect).length
  const questionCount = answers.length || 1
  const ratio = Math.round((correctCount / questionCount) * 100) / 100
  const attemptId = cmd.attemptId || idFrom('reading')
  const submittedAt = new Date().toISOString()
  const item = {
    id: attemptId,
    activity: 'reading',
    title: cmd.titleSnapshot || asset?.title || 'Reading practice',
    status: 'completed',
    mode: 'single',
    submittedAt,
    durationMs: cmd.durationMs ?? 0,
    scoreValue: ratio,
    scoreScale: 'ratio',
    scoreLabel: 'Accuracy',
    scoreDisplay: `${Math.round(ratio * 100)}%`,
    taskType: 'reading',
    assetId: cmd.assetId,
    sessionId: `session-${attemptId}`,
  }
  state.history.items.unshift(item)
  state.history.details[attemptId] = {
    summary: item,
    attempt: {
      id: attemptId,
      activity: 'reading',
      mode: 'single',
      status: 'completed',
      submittedAt,
      durationMs: item.durationMs,
      scoreValue: ratio,
      scoreScale: 'ratio',
      correctCount,
      questionCount,
      assetId: cmd.assetId,
      titleSnapshot: item.title,
      answers,
      annotations: [],
    },
  }
  return { attemptId, sessionId: item.sessionId, assetId: cmd.assetId, scoreValue: ratio, scoreDisplay: item.scoreDisplay, correctCount, questionCount, percentage: ratio * 100, durationMs: item.durationMs, submittedAt, status: 'completed' }
}

// ------------------------------------------------------------ writing ----

function emitEvaluation(state, host, evaluationId, attemptId, channel, taskType) {
  const events = state.writing.events[evaluationId] || []
  const finish = () => {
    const band = taskType === 'task1' ? 6.0 : 6.5
    const evaluation = buildWritingEvaluation({ id: evaluationId, band, taskType })
    state.writing.evaluations[attemptId] = { ...evaluation, attemptId }
    const attempt = state.writing.attempts[attemptId]
    const submittedAt = attempt?.submittedAt || new Date().toISOString()
    const item = {
      id: attemptId,
      activity: 'writing',
      title: (attempt?.promptSnapshot || 'Writing practice').slice(0, 90),
      status: 'completed',
      mode: attempt?.mode || 'freeform',
      submittedAt,
      durationMs: 1_800_000,
      scoreValue: band,
      scoreScale: 'band9',
      scoreLabel: 'Overall Band',
      scoreDisplay: band.toFixed(1),
      taskType,
      sessionId: attemptId,
    }
    state.history.items = [item, ...state.history.items.filter((row) => row.id !== attemptId)]
    const draft = state.writing.drafts[attemptId] || {}
    state.history.details[attemptId] = writingDetail(item, band, { contentText: draft.contentText, promptSnapshot: draft.promptSnapshot })
  }
  EVAL_EVENT_TEMPLATE.forEach((step, index) => {
    const delay = 700 * (index + 1)
    const timer = setTimeout(() => {
      const event = { sequence: index + 1, evaluationId, eventType: step.eventType, payload: step.payload }
      events.push(event)
      state.writing.events[evaluationId] = events
      if (channel) host.send(channel, index, event)
      if (step.eventType === 'completed') finish()
    }, delay)
    state.writing.timers[evaluationId] = [...(state.writing.timers[evaluationId] || []), timer]
  })
}

// ------------------------------------------------------------ handlers ----

export function createHandlers(state, host) {
  const notebook = state.notebook
  const soul = state.soul
  const preferences = []
  const reports = weeklyReports()
  const coachFeedback = []
  let coachThreadId = 'coach-thread'

  const sessionStub = (kind) => (args) => ({ id: `${kind}-mock`, kind, status: 'active', ...args?.cmd, startedAt: new Date().toISOString() })

  return {
    reading_list_assets: () => clone(state.reading.assets),
    reading_get_asset_payload: ({ assetId }) => {
      const entry = state.reading.payloads[assetId]
      if (!entry) throw fail('reading.asset_not_found', `asset not found: ${assetId}`)
      return clone(entry)
    },
    reading_pick_practice_asset: ({ cmd }) => {
      const pool = state.reading.assets.filter((asset) => !asset.pdfOnly && (!cmd?.category || asset.category === cmd.category))
      const pick = pool[Math.floor(Math.random() * pool.length)] || state.reading.assets[0]
      return { assetId: pick.id }
    },
    reading_get_pdf_data_url: () => null,
    reading_export_archive: () => ({ schemaVersion: 1, activity: 'reading', exportedAt: new Date().toISOString(), count: 0, submissions: [] }),
    reading_import_archive: () => ({ committed: true, imported: 0, failed: 0 }),
    reading_save_draft: ({ cmd }) => {
      state.reading.drafts[cmd.attemptId] = { ...cmd, updatedAt: new Date().toISOString() }
      return { id: cmd.attemptId, assetId: cmd.assetId, status: 'in_progress', answers: cmd.answers || {}, updatedAt: new Date().toISOString() }
    },
    reading_get_open_draft: () => null,
    reading_patch_answer: ({ attemptId, questionId, answer, marked }) => {
      const draft = state.reading.drafts[attemptId]
      if (draft) {
        draft.answers = { ...(draft.answers || {}), [questionId]: answer }
        draft.markedQuestions = marked ? [...new Set([...(draft.markedQuestions || []), questionId])] : (draft.markedQuestions || []).filter((id) => id !== questionId)
      }
      return true
    },
    reading_submit_attempt: ({ cmd }) => recordReadingSubmission(state, cmd),
    suite_create: sessionStub('suite'),
    suite_get: ({ suiteId }) => ({ id: suiteId, kind: 'suite', status: 'active', passages: [] }),
    suite_submit_passage: () => ({ status: 'completed' }),
    suite_save_passage_draft: () => ({ status: 'in_progress' }),
    suite_cancel: ({ suiteId }) => ({ id: suiteId, status: 'cancelled' }),
    endless_create: sessionStub('endless'),
    endless_get: ({ sessionId }) => ({ id: sessionId, kind: 'endless', status: 'active', passages: [] }),
    endless_save_passage_draft: () => ({ status: 'in_progress' }),
    endless_cancel: ({ sessionId }) => ({ id: sessionId, status: 'cancelled' }),
    endless_advance: ({ sessionId }) => ({ id: sessionId, status: 'active' }),
    endless_submit: () => ({ status: 'completed' }),
    memorize_create: sessionStub('memorize'),
    memorize_finish: ({ attemptId }) => ({ id: attemptId, status: 'completed' }),
    list_history: ({ query = {} }) => {
      const matches = sortNewestFirst(filterHistory(state.history.items, query))
      const limit = Number(query.limit ?? 20)
      const offset = Number(query.offset ?? 0)
      return { items: clone(matches.slice(offset, offset + limit)), total: matches.length, limit, offset, nextCursor: null }
    },
    get_history_detail: ({ attemptId }) => {
      const detail = state.history.details[attemptId]
      if (!detail) throw fail('history.not_found', `attempt not found: ${attemptId}`)
      return clone(detail)
    },
    history_writing_statistics: () => writingStatistics(state),
    export_history: ({ cmd }) => {
      const items = sortNewestFirst(filterHistory(state.history.items, cmd?.query))
      return { format: cmd?.format || 'csv', body: historyCsv(items), recordCount: items.length }
    },
    delete_history_attempt: ({ attemptId }) => {
      const before = state.history.items.length
      state.history.items = state.history.items.filter((item) => item.id !== attemptId)
      return state.history.items.length < before
    },
    delete_history_attempts: ({ cmd }) => {
      const ids = new Set(cmd?.attemptIds || [])
      const before = state.history.items.length
      state.history.items = state.history.items.filter((item) => !ids.has(item.id))
      return before - state.history.items.length
    },
    history_issue_clear_token: ({ cmd }) => ({
      token: 'mock-clear-token',
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      clearableCount: clearableCount(state, cmd?.activity || null),
    }),
    clear_history: ({ cmd }) => {
      if (cmd?.token !== 'mock-clear-token') throw fail('history.clear_token', 'clear confirmation is missing')
      const activity = cmd?.activity || null
      const before = state.history.items.length
      state.history.items = state.history.items.filter((item) => item.mode === 'memorize' || (activity && item.activity !== activity))
      return before - state.history.items.length
    },
    history_get_retention_policy: () => clone(state.history.retention),
    history_set_retention_policy: ({ cmd }) => {
      state.history.retention = { maxTerminalAttempts: cmd?.maxTerminalAttempts ?? null }
      return clone(state.history.retention)
    },
    writing_topic_list: ({ query = {} }) => {
      const search = String(query.search || '').toLowerCase()
      const rows = state.topics.filter((topic) => (!query.taskType || topic.taskType === query.taskType)
        && (!query.category || topic.category === query.category)
        && (!query.difficulty || topic.difficulty === query.difficulty)
        && (!search || topic.titleJson.toLowerCase().includes(search)))
      const offset = Number(query.offset || 0)
      const limit = Number(query.limit || 12)
      return { items: clone(rows.slice(offset, offset + limit)), total: rows.length, limit, offset }
    },
    writing_topic_get: ({ id }) => clone(state.topics.find((topic) => topic.id === id) || null),
    writing_topic_upsert: ({ cmd }) => {
      const now = new Date().toISOString()
      const existing = cmd.id ? state.topics.find((topic) => topic.id === cmd.id) : null
      const image = cmd.imagePath || null
      if (existing) {
        Object.assign(existing, {
          taskType: cmd.taskType, category: cmd.category, difficulty: cmd.difficulty, titleJson: cmd.titleJson,
          imagePath: image, isOfficial: cmd.isOfficial ?? existing.isOfficial, updatedAt: now,
        })
        return clone(existing)
      }
      const created = {
        id: cmd.id || idFrom('topic'), taskType: cmd.taskType, category: cmd.category, difficulty: cmd.difficulty,
        titleJson: cmd.titleJson, imagePath: image, isOfficial: Boolean(cmd.isOfficial), usageCount: 0, createdAt: now, updatedAt: now,
      }
      state.topics.unshift(created)
      return clone(created)
    },
    writing_topic_delete: ({ id }) => {
      const before = state.topics.length
      state.topics = state.topics.filter((topic) => topic.id !== id)
      return state.topics.length < before
    },
    writing_topic_import: ({ cmd }) => {
      let created = 0
      for (const topic of cmd?.topics || []) {
        const now = new Date().toISOString()
        state.topics.unshift({ id: topic.id || idFrom('topic'), taskType: topic.taskType, category: topic.category, difficulty: topic.difficulty, titleJson: topic.titleJson, imagePath: topic.imagePath || null, isOfficial: false, usageCount: 0, createdAt: now, updatedAt: now })
        created += 1
      }
      return { created, updated: 0 }
    },
    writing_topic_statistics: () => ({
      total: state.topics.length,
      byTaskType: ['task1', 'task2'].map((taskType) => ({ taskType, count: state.topics.filter((topic) => topic.taskType === taskType).length })),
    }),
    writing_prompt_list: ({ taskType }) => clone(state.prompts.filter((prompt) => !taskType || prompt.taskType === taskType)),
    writing_prompt_get: ({ id }) => clone(state.prompts.find((prompt) => prompt.id === id) || null),
    writing_prompt_upsert: ({ cmd }) => {
      const now = new Date().toISOString()
      let row = cmd.id ? state.prompts.find((prompt) => prompt.id === cmd.id) : null
      if (!row) {
        row = { id: cmd.id || idFrom('prompt'), taskType: cmd.taskType, version: cmd.version || '1', body: cmd.body, isActive: false, createdAt: now, updatedAt: now }
        state.prompts.push(row)
      } else {
        Object.assign(row, { taskType: cmd.taskType, version: cmd.version || row.version, body: cmd.body, updatedAt: now })
      }
      if (cmd.isActive) activatePrompt(state, row.id)
      return clone(row)
    },
    writing_prompt_import: ({ cmd }) => {
      const prompts = cmd?.prompts || []
      for (const prompt of prompts) {
        state.prompts.push({ id: prompt.id || idFrom('prompt'), taskType: prompt.taskType, version: prompt.version || '1', body: prompt.body, isActive: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      }
      return { created: prompts.length, updated: 0, failed: 0 }
    },
    writing_prompt_activate: ({ id }) => {
      activatePrompt(state, id)
      return clone(state.prompts.find((prompt) => prompt.id === id) || null)
    },
    writing_prompt_delete: ({ id }) => {
      const before = state.prompts.length
      state.prompts = state.prompts.filter((prompt) => prompt.id !== id)
      return state.prompts.length < before
    },
    writing_save_draft: ({ cmd }) => {
      const draft = { attemptId: cmd.attemptId, mode: cmd.mode, assetId: cmd.assetId ?? null, contentText: cmd.contentText || '', promptSnapshot: cmd.promptSnapshot ?? null, taskType: cmd.taskType ?? null, wordCount: String(cmd.contentText || '').trim().split(/\s+/).filter(Boolean).length, updatedAt: new Date().toISOString() }
      state.writing.drafts[cmd.attemptId] = draft
      return clone(draft)
    },
    writing_get_draft: ({ attemptId }) => clone(state.writing.drafts[attemptId] || null),
    writing_clone_draft: ({ cmd }) => {
      const source = state.writing.drafts[cmd.sourceAttemptId]
      if (!source) throw fail('writing.draft_not_found', 'draft not found')
      const attemptId = idFrom('writing')
      const copy = { ...source, attemptId, updatedAt: new Date().toISOString() }
      state.writing.drafts[attemptId] = copy
      return clone(copy)
    },
    writing_submit_attempt: ({ cmd }) => {
      const draft = state.writing.drafts[cmd.attemptId] || { contentText: '', promptSnapshot: null, mode: 'freeform' }
      const submittedAt = new Date().toISOString()
      state.writing.attempts[cmd.attemptId] = { attemptId: cmd.attemptId, submittedAt, mode: draft.mode, promptSnapshot: draft.promptSnapshot, taskType: draft.taskType }
      return { id: cmd.attemptId, attemptId: cmd.attemptId, status: 'submitted', submittedAt, contentText: draft.contentText }
    },
    writing_start_evaluation: ({ cmd, onEvent }) => {
      const evaluationId = `eval-${cmd.attemptId}-${Date.now().toString(36)}`
      const taskType = cmd.taskType || state.writing.attempts[cmd.attemptId]?.taskType || 'task2'
      state.writing.events[evaluationId] = []
      state.writing.evaluations[cmd.attemptId] = { id: evaluationId, status: 'running', stage: 'preparing', taskType, attemptId: cmd.attemptId }
      emitEvaluation(state, host, evaluationId, cmd.attemptId, onEvent, taskType)
      return { evaluationId, attemptId: cmd.attemptId, status: 'running' }
    },
    writing_list_evaluation_events: ({ evaluationId, afterSequence = 0 }) => clone((state.writing.events[evaluationId] || []).filter((event) => event.sequence > Number(afterSequence))),
    writing_cancel_evaluation: ({ evaluationId }) => {
      ;(state.writing.timers[evaluationId] || []).forEach((timer) => clearTimeout(timer))
      for (const evaluation of Object.values(state.writing.evaluations)) {
        if (evaluation.id === evaluationId && evaluation.status === 'running') evaluation.status = 'cancelled'
      }
      return true
    },
    writing_get_evaluation: ({ attemptId }) => {
      const live = state.writing.evaluations[attemptId]
      if (live) return clone(live)
      const detail = state.history.details[attemptId]
      return detail?.evaluation ? clone({ ...detail.evaluation, attemptId }) : null
    },
    list_settings: ({ namespace }) => clone(state.settings.filter((row) => !namespace || row.namespace === namespace)),
    upsert_setting: ({ cmd }) => {
      const entry = { namespace: cmd.namespace, key: cmd.key, value: cmd.value, updatedAt: new Date().toISOString() }
      const index = state.settings.findIndex((row) => row.namespace === cmd.namespace && row.key === cmd.key)
      if (index >= 0) state.settings[index] = entry
      else state.settings.push(entry)
      return clone(entry)
    },
    soul_get: () => clone({ profile: soul.profile, revisions: soul.revisions }),
    soul_update: ({ fields }) => {
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
        throw fail('soul.invalid_fields', 'Soul fields must be an object')
      }
      const entries = Object.entries(fields)
      // Rust writes all fields in one transaction: validate everything first.
      for (const [key, value] of entries) validateSoulField(key, value)
      for (const [key, value] of entries) {
        const before = soul.profile[key] ?? null
        if (value == null || value === '') delete soul.profile[key]
        else soul.profile[key] = value
        soul.revisions.unshift({
          id: idFrom('soul'), key, before, after: value, actor: 'user', evidenceIds: [],
          reason: '用户编辑', runId: null, createdAt: new Date().toISOString(), revertsId: null,
        })
      }
      return clone({ profile: soul.profile, revisions: soul.revisions })
    },
    soul_undo: ({ revisionId }) => {
      const revision = soul.revisions.find((row) => row.id === revisionId && row.actor === 'model'
        && !soul.revisions.some((other) => other.revertsId === revisionId))
      if (!revision) throw fail('soul.not_found', '没有找到可撤销的修改。')
      if ((soul.profile[revision.key] ?? null) !== revision.after) {
        throw fail('soul.conflict', '字段后来已修改，不能覆盖；请手动编辑。')
      }
      if (revision.before == null) delete soul.profile[revision.key]
      else soul.profile[revision.key] = revision.before
      soul.revisions.unshift({
        id: idFrom('soul'), key: revision.key, before: revision.after, after: revision.before,
        actor: 'undo', evidenceIds: [], reason: '撤销模型修改', runId: null,
        createdAt: new Date().toISOString(), revertsId: revisionId,
      })
      return clone({ profile: soul.profile, revisions: soul.revisions })
    },
    set_secret: ({ cmd }) => {
      const ref = { name: cmd.name, refId: idFrom('secret'), updatedAt: new Date().toISOString() }
      state.secretRefs = [...state.secretRefs.filter((row) => row.name !== cmd.name), ref]
      return clone(ref)
    },
    list_secret_refs: () => clone(state.secretRefs),
    delete_secret: ({ name }) => {
      state.secretRefs = state.secretRefs.filter((row) => row.name !== name)
      return true
    },
    ai_list_configs: () => clone(state.aiConfigs),
    ai_upsert_config: ({ cmd }) => {
      const now = cmd.id ? state.aiConfigs.find((row) => row.id === cmd.id) : null
      const row = now || { id: idFrom('ai-cfg'), isDefault: state.aiConfigs.length === 0, hasSecret: false }
      Object.assign(row, {
        configName: cmd.configName, provider: cmd.provider, baseUrl: cmd.baseUrl || '', defaultModel: cmd.defaultModel,
        isEnabled: cmd.isEnabled !== false, hasSecret: row.hasSecret || Boolean(cmd.apiKey),
      })
      if (!now) state.aiConfigs.push(row)
      return clone(row)
    },
    ai_delete_config: ({ id }) => {
      state.aiConfigs = state.aiConfigs.filter((row) => row.id !== id)
      return true
    },
    ai_set_default_config: ({ id }) => {
      state.aiConfigs = state.aiConfigs.map((row) => ({ ...row, isDefault: row.id === id }))
      return clone(state.aiConfigs.find((row) => row.id === id) || null)
    },
    ai_test_provider: ({ configId }) => ({ ok: true, configId, latencyMs: 420, message: 'dev-mock: provider reachable' }),
    create_backup: ({ appVersion }) => {
      const createdAt = new Date().toISOString()
      const name = `ielts-backup-${createdAt.slice(0, 10)}.zip`
      const manifest = {
        schemaVersion: 1,
        databaseSchemaVersion: 2,
        createdAt,
        appVersion: appVersion || APP_INFO.version,
        includesSecrets: false,
        attemptCount: state.history.items.length,
        settingsCount: state.settings.length,
        secretRefCount: state.secretRefs.length,
        tableCount: 12,
        rowCount: 1280,
        checksumSha256: '3f9c2a7e1b4d8f60a5c3e9d2b71f04a8c6e5d3b2a1f0e9d8c7b6a5948372615e',
      }
      state.backups = [{ name, grantId: `grant-${name}`, displayPath: `C:/atlas/backups/${name}`, modifiedAt: createdAt, sizeBytes: 2_516_480 }, ...state.backups]
      return { path: `C:/atlas/backups/${name}`, manifest }
    },
    list_backups: () => clone(state.backups),
    pick_backup_import_path: () => null,
    import_backup_path: ({ dryRun }) => ({ dryRun: dryRun !== false, valid: true, attemptCount: 0, settingsCount: 0, secretRefCount: 0, warnings: [] }),
    get_app_info: () => clone(APP_INFO),
    get_app_data_paths: () => clone(APP_DATA_PATHS),
    check_for_updates: () => ({ configured: false, updateAvailable: false, installed: false, requiresRestart: false, currentVersion: APP_INFO.version, latestVersion: null, body: null, stage: 'unconfigured', message: '此构建未配置签名更新通道。' }),
    install_update: () => null,
    restart_after_update: () => null,
    get_startup_diagnostics: () => ({ bootId: 'dev-mock', startedAt: new Date().toISOString(), appData: APP_DATA_PATHS.appData, logsDir: APP_DATA_PATHS.logs, legacyDataDirs: [], notes: ['dev-mock: no native host'] }),
    get_performance_budgets: () => ({}),
    get_query_plan_baselines: () => [],
    cognitive_runtime_status: () => ({ status: 'stopped' }),
    cognitive_runtime_health: () => ({ status: 'stopped', healthy: false }),
    cognitive_runtime_cancel: () => null,
    cognitive_runtime_restart: () => null,
    timer_elapsed_seconds: () => 0,
    timer_should_auto_submit: () => false,
    agent_get_workspace: () => ({ threads: [], runs: [], approvals: [], studyPlanId: notebook.plan.plan.id }),
    agent_run: ({ request }) => ({ runId: request?.runId || idFrom('run'), status: 'completed' }),
    agent_run_attempt_review: ({ request }) => ({ runId: idFrom('run'), attemptId: request?.attemptId, status: 'completed' }),
    agent_get_run: ({ runId }) => ({ runId, status: 'completed', steps: [], output: null }),
    agent_cancel_run: ({ runId }) => ({ runId, status: 'cancelled' }),
    study_plan_run: () => ({ planId: notebook.plan.plan.id, status: 'completed' }),
    study_plan_create: () => ({ planId: notebook.plan.plan.id }),
    study_plan_get_latest: () => clone(notebook.plan),
    study_plan_list_items: () => clone(notebook.plan.items),
    study_plan_mark_done: ({ itemId }) => {
      const row = notebook.plan.items.find((item) => item.id === itemId)
      if (row) row.done = true
      return true
    },
    agent_thread_create: ({ title }) => ({ id: idFrom('thread'), title: title || 'New thread', archived: false, createdAt: new Date().toISOString() }),
    agent_thread_list: () => [],
    agent_thread_list_messages: () => [],
    agent_thread_append_message: ({ threadId, text }) => ({ id: idFrom('msg'), threadId, role: 'user', text, createdAt: new Date().toISOString() }),
    agent_thread_archive: () => true,
    agent_thread_save_checkpoint: () => null,
    agent_thread_load_latest_checkpoint: () => null,
    agent_thread_request_cancel: () => null,
    agent_approval_list: () => [],
    agent_approval_decide: () => true,
    memory_context_preview: () => ({ items: [], tokenBudget: 0 }),
    memory_catalog_list: ({ input = {} }) => ({ userId: 'local', entries: clone(notebook.catalog), truncated: false, includeArchived: Boolean(input.includeArchived) }),
    memory_generate_candidates: () => [],
    memory_promote_candidate: ({ input }) => ({ memoryId: input?.memoryId || null, status: 'promoted' }),
    memory_list_explicit_preferences: () => clone(preferences),
    memory_put_explicit_preference: ({ input }) => {
      const row = { userId: 'local', preferenceKey: input.preferenceKey, scope: input.scope || 'global', value: input.value,
        status: 'active', source: 'user', updatedAt: new Date().toISOString() }
      const index = preferences.findIndex((entry) => entry.preferenceKey === row.preferenceKey && entry.scope === row.scope)
      if (index < 0) preferences.push(row); else preferences[index] = row
      return clone(row)
    },
    memory_delete_explicit_preference: ({ input }) => {
      const index = preferences.findIndex((row) => row.preferenceKey === input.preferenceKey && row.scope === (input.scope || 'global'))
      if (index < 0) return false
      preferences.splice(index, 1)
      return true
    },
    memory_archive: ({ input }) => ({ memoryId: input?.memoryId || null, status: 'archived' }),
    memory_forget: ({ input }) => ({ memoryId: input?.memoryId || null, status: 'forgotten' }),
    memory_record_feedback: ({ memoryId, feedbackKind }) => ({ memoryId, feedbackKind, recorded: true }),
    coach_record_feedback: ({ command }) => {
      const verdicts = ['thumbs_up', 'thumbs_down', 'incorrect']
      const existing = coachFeedback.find(({ record }) => record.coachMessageId === command.coachMessageId
        && (record.feedbackKind === command.feedbackKind || verdicts.includes(record.feedbackKind) && verdicts.includes(command.feedbackKind)))
      if (existing) return clone(existing.record)
      const record = { id: idFrom('feedback'), userId: command.userId || 'local', coachMessageId: command.coachMessageId,
        feedbackKind: command.feedbackKind, payload: command.payload || null, createdAt: new Date().toISOString() }
      coachFeedback.push({ threadId: coachThreadId, record })
      return clone(record)
    },
    coach_list_feedback: ({ threadId }) => clone(coachFeedback.filter((row) => row.threadId === threadId).map((row) => row.record)),
    coach_record_reask_link: () => null,
    coach_record_strategy_assignment: () => null,
    coach_link_outcome: () => null,
    coach_ensure_thread: ({ cmd }) => {
      coachThreadId = `coach-${cmd?.attemptId || 'thread'}`
      return { id: coachThreadId, attemptId: cmd?.attemptId || null, status: 'open' }
    },
    coach_list_messages: () => [],
    coach_run: () => ({ status: 'completed', messages: [] }),
    journal_get_daily: ({ query = {} }) => clone(notebook.journals[query.journalDate] || {
      id: `journal-${query.journalDate}`, userId: 'local', journalDate: query.journalDate, version: 1, status: 'published',
      facts: { journalDate: query.journalDate, timeSpentMs: 0, writingEvalSummary: { completed: 0, degraded: 0, averageBand: null }, skillDeltas: [], memoryChanges: ZERO_MEMORY_CHANGES, coachFeedbackCount: 0, coachReaskCount: 0, sourceHash: 'mock', todayObservationIds: [], memoryEvents: [] },
      sourceHash: 'mock', renderedMarkdown: null, supersededBy: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }),
    journal_rerun: () => null,
    journal_list_versions: () => [],
    dream_run_daily: () => ({ status: 'completed', journalDate: dateOf(new Date().toISOString()) }),
    background_job_status: () => notebook.dayList.map((day) => ({
      id: `job-${day}`, jobKind: 'daily_journal', userId: 'local', status: 'completed', priority: 0,
      scheduledAt: `${day}T00:00:00Z`, lockedAt: null, heartbeatAt: null, attempts: 1, maxAttempts: 3,
      dedupeKey: `daily_journal:local:${day}`, lastError: null, createdAt: `${day}T00:00:00Z`, updatedAt: `${day}T00:00:00Z`,
    })),
    weekly_report_current: () => clone(reports.current),
    weekly_report_list: () => clone(reports.list),
    weekly_history_list: () => notebook.weeks.map((digest, index) => ({ runId: `legacy-${index}`, window: digest.window,
      start: `${digest.windowStart}T00:00:00Z`, end: `${digest.windowEnd}T23:59:59Z`, digest: clone(digest) })),
    consolidation_archive_stale: () => ({ archived: 0 }),
    learner_model_get_state: () => ({ states: clone(notebook.states) }),
    learner_model_get_review_needs: () => ({ needs: clone(notebook.needs) }),
    learner_model_rebuild: () => ({ status: 'completed' }),
    learner_model_verify: () => ({ status: 'verified' }),
    learning_compare_attempts: ({ query }) => ({ assetId: query?.assetId || null, comparisons: [], gapHours: query?.minimumGapHours ?? 12 }),
    learning_get_attempt_detail: () => null,
    learning_get_question_history: () => [],
    learning_search_events: () => [],
    learning_observations_snapshot: () => null,
    learning_observations_get_by_ids: ({ ids = [] }) => ({
      schemaVersion: 1, projectorKey: 'learning_observations', projectorVersion: 1, ledgerInputHash: 'ledger', observationOutputHash: 'obs',
      generatedAt: '2026-10-02T23:00:00Z', freshness: 'fresh', missingIds: [],
      observations: ids.map((id) => ({
        id, userId: 'local', observationType: 'question_outcome', namespace: 'reading', scopeKind: 'skill', scopeKey: 'reading.tfng',
        polarity: null, valueNum: null, valueText: '第 9 题改答后仍错误：原文没有提到价格变化。', payload: {}, confidence: 0.8, evidenceStrength: 0.7,
        observedAt: '2026-10-02', projectorKey: 'learning_observations', projectorVersion: 1, sourceFingerprint: `fp-${id}`,
        sensitivity: 'normal', trust: 'deterministic_projection', evidence: [{ eventId: `ev-${id}`, evidenceRole: 'support', ordinal: 0 }],
      })),
    }),
    learning_events_get_evidence_by_ids: ({ ids = [] }) => ({
      schemaVersion: 1, missingIds: [],
      events: ids.map((id) => ({
        id: `ev-${id}`, userId: 'local', activity: 'reading', assetId: 'p1-high-01', attemptId: 'attempt-9', questionId: 'q9',
        skillKey: 'reading.tfng', eventType: 'reading_question_outcome', sourceKind: 'attempt', sourceId: 'attempt-9',
        occurredAt: '2026-10-02', payload: {}, contentHash: `hash-${id}`, schemaVersion: 1, sensitivity: 'normal', trust: 'canonical_learning_truth',
      })),
    }),
    learning_events_rebuild: () => null,
    learning_events_verify: () => ({ status: 'verified' }),
    learning_observations_rebuild: () => null,
    learning_observations_verify: () => ({ status: 'verified' }),
    annotation_upsert: ({ cmd }) => ({ id: cmd?.id || idFrom('ann'), ...cmd, createdAt: new Date().toISOString() }),
    annotation_list: () => [],
    annotation_delete: () => true,
    annotation_revalidate: () => [],
    dictionary_lookup: ({ term }) => ({ term, phonetic: null, definitions: [{ partOfSpeech: 'n.', meaning: `${term}（dev-mock 释义）` }] }),
    dictionary_import: () => 0,
    vocab_upsert: ({ cmd }) => ({ id: cmd?.id || idFrom('vocab'), ...cmd, reviewCount: 0 }),
    vocab_list: () => [],
    vocab_review: ({ cmd }) => ({ itemId: cmd?.itemId, grade: cmd?.grade, reviewCount: 1 }),
    vocab_delete: () => true
  }
}

function activatePrompt(state, id) {
  const target = state.prompts.find((prompt) => prompt.id === id)
  if (!target) return
  state.prompts = state.prompts.map((prompt) => (prompt.taskType === target.taskType ? { ...prompt, isActive: prompt.id === id } : prompt))
}
