/**
 * Product API facade — Tauri only.
 * Electron / Fastify / file:// paths removed.
 */

import {
  listHistory,
  getHistoryDetail,
  getWritingHistoryStatistics,
  exportHistory,
  deleteHistoryAttempt,
  deleteHistoryAttempts,
  clearHistory
} from '@/api/history-repository.js'
import {
  saveDraft,
  submitAttempt,
  cloneWritingDraft,
  startEvaluation,
  listEvaluationEvents,
  cancelEvaluation,
  getEvaluationForAttempt,
  newIdempotencyKey
} from '@/api/writing-repository.js'
import {
  listSettings,
  upsertSetting,
  listAiConfigs,
  upsertAiConfig,
  deleteAiConfig,
  setDefaultAiConfig,
  testAiProvider
} from '@/api/settings-repository.js'
import { writingTopicsRepository } from '@/api/topics-repository.js'
import { writingPromptsRepository } from '@/api/writing-prompts-repository.js'
import { isTauriRuntime } from '@/api/tauri-bridge.js'
import { adaptWritingHistoryDetail } from '@/utils/evaluation-result.js'
import { requireWritingAttemptMode } from '@/api/writing-mode.js'

const ERROR_MESSAGES = {
  invalid_api_key: 'API 密钥无效，请前往设置页面检查配置',
  insufficient_quota: 'API 余额不足，请充值后重试',
  rate_limit_exceeded: '请求频率超限，请稍后重试',
  rate_limited: '请求频率超限，请稍后重试',
  model_not_found: '模型不存在，请检查模型名称配置',
  timeout: '请求超时，请检查网络连接或稍后重试',
  network_error: '网络连接失败，请检查网络设置',
  server_error: '服务异常，请稍后重试',
  invalid_response_format: '评分数据解析失败，请点击"重试"按钮',
  start_failed: '启动评测失败，请重试',
  'ai.not_configured': '未配置 AI：请先在设置中添加并启用默认模型与 API Key。',
  tauri_required: '需要 Tauri 运行时（Electron/Fastify 已移除）',
  unknown_error: '未知错误，请重试'
}

const evaluationListeners = new Map()
let listenerSequence = 0
const activePolls = new Map()

export function getErrorMessage(code, fallbackMessage = '') {
  const mapped = ERROR_MESSAGES[code]
  if (mapped) return mapped
  const message = typeof fallbackMessage === 'string' ? fallbackMessage.trim() : ''
  if (message) return message
  return ERROR_MESSAGES.unknown_error
}

/** Prefer backend Chinese message (e.g. startEvaluation) over bare error code. */
export function resolveApiErrorMessage(error, fallbackCode = 'unknown_error') {
  const code = error?.code || fallbackCode
  // Known product codes win over sparse/technical messages so UI stays consistent.
  if (code && ERROR_MESSAGES[code] && (code === 'ai.not_configured' || !String(error?.message || '').trim())) {
    return ERROR_MESSAGES[code]
  }
  const message = typeof error?.message === 'string' ? error.message.trim() : ''
  if (message) return message
  return getErrorMessage(code)
}

export function isAPIAvailable() {
  return isTauriRuntime()
}

function createAiNotConfiguredError() {
  const error = new Error(ERROR_MESSAGES['ai.not_configured'])
  error.code = 'ai.not_configured'
  error.retryable = false
  return error
}

/**
 * Fail closed only at the evaluation-provider boundary. Durable writing input
 * must survive a missing provider so users can configure AI and retry later.
 */
async function assertAiConfiguredForWritingEvaluation() {
  const list = await configs.list()
  const defaultConfig = list.find((item) => item.is_default) || null
  if (defaultConfig?.is_enabled && defaultConfig?.has_secret) {
    const provider = String(defaultConfig.provider || '').trim().toLowerCase()
    if (provider && provider !== 'unconfigured') return
  }

  // Explicit offline scorer path (runtime provider only; not the product default).
  const { items } = await listSettings('ai')
  const providerEntry = (items || []).find((item) => item.key === 'provider')
  let provider = providerEntry?.value
  if (typeof provider === 'string') {
    try {
      const parsed = JSON.parse(provider)
      if (typeof parsed === 'string') provider = parsed
    } catch {
      // keep raw string
    }
  }
  if (String(provider || '').trim().toLowerCase() === 'deterministic') return

  throw createAiNotConfiguredError()
}

function newId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeAiConfig(item) {
  return {
    id: item.id,
    config_name: item.configName,
    provider: item.provider,
    base_url: item.baseUrl,
    default_model: item.defaultModel,
    is_default: !!item.isDefault,
    is_enabled: !!item.isEnabled,
    has_secret: !!item.hasSecret
  }
}

function toAiConfigCommand(data, id = null) {
  const cmd = {
    configName: data.config_name,
    provider: data.provider,
    baseUrl: data.base_url,
    defaultModel: data.default_model,
    isEnabled: data.is_enabled ?? data.enabled ?? true
  }
  if (id) cmd.id = id
  if (data.api_key) cmd.apiKey = data.api_key
  return cmd
}

export const configs = {
  async list() {
    return (await listAiConfigs()).map(normalizeAiConfig)
  },

  async getDefault() {
    const list = await this.list()
    return list.find((item) => item.is_default) || null
  },

  async create(data) {
    const created = normalizeAiConfig(await upsertAiConfig(toAiConfigCommand(data)))
    if (data.is_default) await setDefaultAiConfig(created.id)
    return created
  },

  async update(id, updates) {
    const all = await this.list()
    const prev = all.find((item) => item.id === id)
    if (!prev) {
      const err = new Error(`config not found: ${id}`)
      err.code = 'not_found'
      throw err
    }
    const next = { ...prev, ...updates, id }
    const updated = normalizeAiConfig(await upsertAiConfig(toAiConfigCommand(next, id)))
    if (updates.is_default) await setDefaultAiConfig(id)
    return updated
  },

  async delete(id) {
    return deleteAiConfig(id)
  },

  async setDefault(id) {
    return setDefaultAiConfig(id)
  },

  async toggleEnabled(id) {
    const all = await this.list()
    const prev = all.find((item) => item.id === id)
    if (!prev) {
      const err = new Error(`config not found: ${id}`)
      err.code = 'not_found'
      throw err
    }
    return this.update(id, { is_enabled: !prev.is_enabled })
  },

  async test(id) {
    const configId = String(id || '').trim()
    if (!configId) {
      throw new Error('请选择要测试的 API 配置')
    }
    return testAiProvider(configId)
  }
}

export const prompts = writingPromptsRepository

function emitEvaluationEvent(event) {
  evaluationListeners.forEach((listener) => {
    try {
      listener(event)
    } catch (error) {
      console.warn('写作评测事件监听器执行失败:', error)
    }
  })
}

function mapEventToUi(raw) {
  const eventType = raw.eventType || 'log'
  const payload = raw.payload || {}
  const typeMap = {
    stage: 'stage',
    completed: 'complete',
    complete: 'complete',
    error: 'error',
    failed: 'error',
    log: 'log'
  }
  const type = typeMap[eventType] || eventType
  const data =
    typeof payload === 'object' && payload !== null
      ? { ...payload }
      : { message: String(payload || '') }
  if (raw.stage && !data.stage) {
    data.stage = raw.stage
    data.key = typeof raw.stage === 'string' ? raw.stage.toLowerCase() : raw.stage
  }
  return {
    type,
    sessionId: raw.sessionId,
    evaluationId: raw.evaluationId,
    sequence: raw.sequence,
    data
  }
}

async function pollEvaluationEvents(attemptId, evaluationId) {
  if (!evaluationId || activePolls.has(evaluationId)) return
  let after = 0
  let stopped = false
  activePolls.set(evaluationId, () => {
    stopped = true
  })

  const tick = async () => {
    if (stopped) return
    try {
      const events = await listEvaluationEvents(evaluationId, after)
      for (const raw of events || []) {
        after = Math.max(after, Number(raw.sequence || 0))
        emitEvaluationEvent(mapEventToUi({ ...raw, sessionId: attemptId }))
        const t = String(raw.eventType || '').toLowerCase()
        if (['completed', 'failed', 'cancelled'].includes(t)) {
          stopped = true
        }
      }
      if (!stopped) {
        const evaluation = await getEvaluationForAttempt(attemptId)
        const status = String(
          evaluation?.evaluation?.status || evaluation?.status || ''
        ).toLowerCase()
        if (['completed', 'degraded', 'failed', 'interrupted'].includes(status)) {
          if (['completed', 'degraded'].includes(status) && evaluation?.evaluation) {
            emitEvaluationEvent({
              type: 'complete',
              sessionId: attemptId,
              data: evaluation.evaluation
            })
          }
          stopped = true
        }
      }
    } catch (err) {
      console.warn('poll evaluation events failed', err)
    }
    if (!stopped) {
      setTimeout(tick, 1000)
    } else {
      activePolls.delete(evaluationId)
    }
  }
  void tick()
}

async function startSubmittedEvaluation(payload) {
  const attemptId = payload.sessionId || payload.attemptId
  if (!attemptId) throw new Error('missing writing attempt id')
  await assertAiConfiguredForWritingEvaluation()
  const { handle } = await startEvaluation({
    attemptId,
    taskType: payload.taskType || payload.task_type || null,
    idempotencyKey: newIdempotencyKey('eval'),
    retryOf: payload.retryOf || null,
    onEvent: (event) => emitEvaluationEvent(mapEventToUi({ ...event, sessionId: attemptId }))
  })
  const evaluationId = handle?.evaluationId || null
  if (evaluationId) void pollEvaluationEvents(attemptId, evaluationId)
  return { sessionId: attemptId, evaluationId, handle }
}

export const evaluate = {
  async start(payload) {
    const attemptId = payload.sessionId || payload.attemptId || newId('attempt')
    const content = payload.content || payload.contentText || ''
    const mode = requireWritingAttemptMode(payload.mode)
    const promptSnapshot =
      payload.topic_text || payload.topicText || payload.promptSnapshot || null
    const taskType = payload.task_type || payload.taskType || null

    await saveDraft({
      attemptId,
      mode,
      assetId:
        payload.topic_id != null
          ? String(payload.topic_id)
          : payload.assetId || null,
      contentText: content,
      promptSnapshot,
      taskType,
      idempotencyKey: newIdempotencyKey('draft')
    })
    await submitAttempt(attemptId, newIdempotencyKey('submit'))
    try {
      return await startSubmittedEvaluation({
        attemptId,
        taskType,
        retryOf: payload.retryOf || null
      })
    } catch (error) {
      // Persistence is the source of truth: surface the failure with the
      // submitted attempt id so the UI can offer a visible retry path.
      error.attemptId = attemptId
      throw error
    }
  },

  async cancel(sessionId) {
    const { evaluation } = await getEvaluationForAttempt(sessionId)
    const evaluationId = evaluation?.id
    if (!evaluationId) {
      return { cancelled: false, sessionId }
    }
    const stop = activePolls.get(evaluationId)
    if (stop) stop()
    const cancelled = await cancelEvaluation(evaluationId)
    return { cancelled: Boolean(cancelled), sessionId, evaluationId }
  },

  async cloneDraft(sessionId) {
    const { draft } = await cloneWritingDraft(sessionId, newIdempotencyKey('clone'))
    if (!draft?.attemptId && !draft?.attempt_id) {
      throw new Error('未能创建可编辑的写作副本')
    }
    return draft
  },

  // Retry an already-submitted attempt. Never save/submit again: Rust owns
  // the monotonic attempt state and rejects late draft mutations.
  async retry(payload) {
    return startSubmittedEvaluation(payload)
  },

  async getSessionState(sessionId) {
    const { evaluation } = await getEvaluationForAttempt(sessionId)
    let events = []
    if (evaluation?.id) {
      const rawEvents = await listEvaluationEvents(evaluation.id, 0)
      events = (rawEvents || []).map((raw) => mapEventToUi({ ...raw, sessionId }))
      void pollEvaluationEvents(sessionId, evaluation.id)
    }
    return {
      sessionId,
      evaluation,
      evaluationId: evaluation?.id || null,
      events,
      status: evaluation?.status || 'unknown'
    }
  },

  onEvent(callback) {
    if (typeof callback !== 'function') return null
    listenerSequence += 1
    const listenerId = `writing_eval_listener_${listenerSequence}`
    evaluationListeners.set(listenerId, callback)
    return listenerId
  },

  removeEventListener(listenerId) {
    if (!listenerId) return
    evaluationListeners.delete(listenerId)
  }
}

export const topics = writingTopicsRepository

function mapHistoryItemToEssay(item) {
  return {
    id: item.id,
    task_type: item.taskType ?? null,
    topic_title: item.title || 'Untitled',
    content: item.contentText || '',
    total_score: item.scoreValue ?? 0,
    submitted_at: item.submittedAt || '',
    duration: item.duration ?? Math.round((item.durationMs || 0) / 1000),
    status: item.status,
    source: 'tauri'
  }
}

export const essays = {
  async list(filters = {}, pagination = { page: 1, limit: 20 }) {
    const page = Number(pagination.page || 1)
    const limit = Number(pagination.limit || 20)
    const offset = (page - 1) * limit
    const result = await listHistory({
      activity: 'writing',
      limit,
      offset,
      search: filters.search || null,
      startDate: filters.startDate || filters.start_date || null,
      endDate: filters.endDate || filters.end_date || null,
      minScore: filters.minScore ?? filters.min_score ?? null,
      maxScore: filters.maxScore ?? filters.max_score ?? null,
      taskType: filters.taskType ?? filters.task_type ?? null
    })
    return {
      data: (result.items || []).map(mapHistoryItemToEssay),
      total: result.total,
      page,
      limit
    }
  },

  async getById(id) {
    const { detail } = await getHistoryDetail(id)
    if (!detail) return null
    // Shared V4 → UI adapter used by Result + History
    const adapted = adaptWritingHistoryDetail(detail)
    if (!adapted) return null
    return {
      ...adapted,
      id: adapted.id || id,
      source: 'tauri'
    }
  },

  async delete(id) {
    await deleteHistoryAttempt(id)
    return true
  },

  async batchDelete(ids) {
    return { deleted: await deleteHistoryAttempts(ids) }
  },

  async deleteAll(activity = null) {
    return { deleted: await clearHistory(activity) }
  },

  async getStatistics(range = 'all') {
    const { statistics } = await getWritingHistoryStatistics(range)
    return statistics || { count: 0, latest: null, average: null }
  },

  async exportCSV(filters = {}) {
    const { result } = await exportHistory('csv', { activity: 'writing', ...filters })
    // Always return the CSV text body — callers historically did String(result)
    // which becomes "[object Object]" when given the full ExportHistoryResult.
    if (typeof result === 'string') return result
    return result?.body ?? ''
  }
}

export const settings = {
  async getAll() {
    const { items } = await listSettings('app')
    const out = {}
    for (const item of items || []) {
      const key = item.key
      let value = item.value
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value)
        } catch {
          // keep string
        }
      }
      out[key] = value
    }
    return out
  },

  async get(key) {
    const all = await this.getAll()
    return all[key]
  },

  async update(updates) {
    const entries = Object.entries(updates || {})
    for (const [key, value] of entries) {
      await upsertSetting('app', key, value)
    }
    return true
  },

  async reset() {
    const all = await this.getAll()
    for (const key of Object.keys(all)) {
      await upsertSetting('app', key, null)
    }
    return true
  }
}

export default {
  configs,
  prompts,
  evaluate,
  topics,
  essays,
  settings,
  getErrorMessage,
  resolveApiErrorMessage,
  isAPIAvailable
}
