/**
 * Writing topic-bank adapter.
 *
 * The Rust/SQLite aggregate owns IDs, filtering, pagination, import and
 * statistics. This module only adapts camelCase command DTOs to the existing
 * Vue view-model names; it never caches or persists topic data in the browser.
 */

import { invokeCommand, isTauriRuntime, unwrapCommandResponse } from '@/api/tauri-bridge.js'

function asTopicId(value) {
  const id = String(value ?? '').trim()
  if (!id) {
    const error = new Error('题目 ID 不能为空')
    error.code = 'writing.topic.invalid_id'
    throw error
  }
  return id
}

function normalizeTaskType(value) {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '')
  if (normalized === 'task1' || normalized === 't1') return 'task1'
  if (normalized === 'task2' || normalized === 't2') return 'task2'
  return String(value ?? '').trim()
}

function numberOr(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function normalizeTopic(raw) {
  return {
    id: asTopicId(raw?.id),
    // Existing components use `type`; the Rust DTO remains canonical taskType.
    type: normalizeTaskType(raw?.taskType ?? raw?.task_type ?? raw?.type),
    category: String(raw?.category ?? ''),
    difficulty: numberOr(raw?.difficulty),
    title_json: String(raw?.titleJson ?? raw?.title_json ?? ''),
    image_path: raw?.imagePath ?? raw?.image_path ?? null,
    // Rust owns the persisted value. The UI may only render a safe data URL;
    // it never resolves an arbitrary local filesystem path.
    image_url: raw?.imageUrl ?? raw?.image_url ?? raw?.imagePath ?? raw?.image_path ?? null,
    is_official: Boolean(raw?.isOfficial ?? raw?.is_official),
    usage_count: numberOr(raw?.usageCount ?? raw?.usage_count),
    created_at: raw?.createdAt ?? raw?.created_at ?? '',
    updated_at: raw?.updatedAt ?? raw?.updated_at ?? ''
  }
}

function topicCommand(data = {}, explicitId = undefined) {
  const command = {
    taskType: normalizeTaskType(data.taskType ?? data.task_type ?? data.type),
    category: String(data.category ?? ''),
    difficulty: numberOr(data.difficulty),
    titleJson: String(data.titleJson ?? data.title_json ?? data.title ?? data.prompt ?? ''),
    imagePath: data.imagePath ?? data.image_path ?? data.imageUrl ?? data.image_url ?? null
  }
  const suppliedId = explicitId === undefined
    ? (data.id ?? data.sourceId ?? data.source_id)
    : explicitId
  if (suppliedId !== undefined && suppliedId !== null) {
    command.id = asTopicId(suppliedId)
  }
  if (data.isOfficial !== undefined || data.is_official !== undefined) {
    command.isOfficial = Boolean(data.isOfficial ?? data.is_official)
  }
  return command
}

function normalizePagination(pagination = {}) {
  const page = Math.max(1, Math.floor(numberOr(pagination.page, 1)))
  const limit = Math.min(500, Math.max(1, Math.floor(numberOr(pagination.limit, 20))))
  return { page, limit, offset: (page - 1) * limit }
}

function normalizeFilters(filters = {}) {
  const taskType = normalizeTaskType(filters.taskType ?? filters.task_type ?? filters.type)
  const category = String(filters.category ?? '').trim()
  const search = String(filters.search ?? '').trim()
  const difficulty = numberOr(filters.difficulty)
  return {
    taskType: taskType || null,
    category: category || null,
    difficulty: difficulty > 0 ? difficulty : null,
    search: search || null
  }
}

export async function listWritingTopics(filters = {}, pagination = {}) {
  const { page, limit, offset } = normalizePagination(pagination)
  const response = await invokeCommand('writing_topic_list', {
    query: { ...normalizeFilters(filters), limit, offset }
  })
  const result = unwrapCommandResponse(response, 'writing_topic_list') || {}
  return {
    source: 'tauri',
    data: Array.isArray(result.items) ? result.items.map(normalizeTopic) : [],
    total: numberOr(result.total),
    page,
    limit: numberOr(result.limit, limit)
  }
}

export async function getWritingTopic(id) {
  const response = await invokeCommand('writing_topic_get', { id: asTopicId(id) })
  const result = unwrapCommandResponse(response, 'writing_topic_get')
  return result ? normalizeTopic(result) : null
}

export async function upsertWritingTopic(data, id = undefined) {
  const response = await invokeCommand('writing_topic_upsert', {
    cmd: topicCommand(data, id)
  })
  return normalizeTopic(unwrapCommandResponse(response, 'writing_topic_upsert'))
}

export async function deleteWritingTopic(id) {
  const response = await invokeCommand('writing_topic_delete', { id: asTopicId(id) })
  return Boolean(unwrapCommandResponse(response, 'writing_topic_delete'))
}

export async function importWritingTopics(topics) {
  const values = Array.isArray(topics) ? topics : []
  const response = await invokeCommand('writing_topic_import', {
    cmd: { topics: values.map((topic) => topicCommand(topic)) }
  })
  const result = unwrapCommandResponse(response, 'writing_topic_import') || {}
  const created = numberOr(result.created)
  const updated = numberOr(result.updated)
  return {
    source: 'tauri',
    created,
    updated,
    success: created + updated,
    failed: 0
  }
}

export async function getWritingTopicStatistics() {
  const response = await invokeCommand('writing_topic_statistics')
  const result = unwrapCommandResponse(response, 'writing_topic_statistics') || {}
  const byType = Array.isArray(result.byTaskType)
    ? result.byTaskType.map((row) => ({
      type: normalizeTaskType(row?.taskType ?? row?.task_type),
      count: numberOr(row?.count)
    }))
    : []
  return {
    source: 'tauri',
    total: numberOr(result.total),
    byType
  }
}

export const writingTopicsRepository = {
  list: listWritingTopics,
  get: getWritingTopic,
  create: (data) => upsertWritingTopic(data),
  update: (id, data) => upsertWritingTopic(data, id),
  delete: deleteWritingTopic,
  batchImport: importWritingTopics,
  getStatistics: getWritingTopicStatistics,
  isTauriRuntime
}

export default writingTopicsRepository
