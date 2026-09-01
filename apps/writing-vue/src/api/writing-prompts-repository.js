/**
 * Writing prompt-policy adapter. Rust/SQLite owns prompt IDs, the one-active
 * invariant, and all durable mutation; this module only normalizes import text
 * and adapts camelCase command DTOs to the legacy Settings view model.
 */

import { invokeCommand, unwrapCommandResponse } from '@/api/tauri-bridge.js'

function asPromptId(value) {
  const id = String(value ?? '').trim()
  if (!id) throw new Error('提示词 ID 不能为空')
  return id
}

function normalizeTaskType(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
  if (normalized === 'task1' || normalized === 't1') return 'task1'
  if (normalized === 'task2' || normalized === 't2') return 'task2'
  return null
}

function normalizeBody(item) {
  for (const key of ['body', 'content', 'system', 'systemPrompt', 'prompt', 'text']) {
    const value = item?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function activeValue(item) {
  if (Object.prototype.hasOwnProperty.call(item || {}, 'is_active')) return Boolean(item.is_active)
  if (Object.prototype.hasOwnProperty.call(item || {}, 'isActive')) return Boolean(item.isActive)
  if (Object.prototype.hasOwnProperty.call(item || {}, 'active')) return Boolean(item.active)
  return undefined
}

function promptImportItems(jsonData) {
  if (Array.isArray(jsonData)) return jsonData
  if (Array.isArray(jsonData?.prompts)) return jsonData.prompts
  if (!jsonData || typeof jsonData !== 'object') return [jsonData]

  const taskEntries = ['task1', 'task2']
    .filter((taskType) => Object.prototype.hasOwnProperty.call(jsonData, taskType))
    .map((taskType) => {
      const source = jsonData[taskType]
      if (typeof source === 'string') {
        return {
          version: jsonData.version,
          task_type: taskType,
          is_active: true,
          body: source
        }
      }
      if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new Error(`${taskType} 提示词必须是字符串或对象`)
      }
      return {
        ...source,
        version: source.version ?? jsonData.version,
        task_type: source.task_type ?? source.taskType ?? taskType,
        ...(activeValue(source) === undefined ? { is_active: true } : {})
      }
    })
  return taskEntries.length ? taskEntries : [jsonData]
}

function normalizeImportItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error('提示词必须是对象')
  }
  const taskType = normalizeTaskType(item.task_type ?? item.taskType ?? item.type)
  const body = normalizeBody(item)
  if (!taskType || !body) {
    throw new Error('提示词必须包含 task_type（task1 或 task2）和非空正文')
  }
  const rawId = String(item.id ?? '').trim()
  const version = String(item.version ?? item.promptVersion ?? item.prompt_version ?? '').trim()
  const normalized = {
    taskType,
    body
  }
  if (rawId) normalized.id = rawId
  if (version) normalized.version = version
  const active = activeValue(item)
  if (active !== undefined) normalized.isActive = active
  return normalized
}

function toViewModel(item) {
  return {
    id: item.id,
    task_type: item.taskType ?? item.task_type,
    version: item.version,
    body: item.body,
    is_active: activeValue(item) ?? false,
    created_at: item.createdAt ?? item.created_at ?? null,
    updated_at: item.updatedAt ?? item.updated_at ?? null
  }
}

export async function listWritingPrompts(taskType = null) {
  const normalizedTaskType = taskType == null ? null : normalizeTaskType(taskType)
  if (taskType != null && !normalizedTaskType) {
    throw new Error('提示词 task_type 必须是 task1 或 task2')
  }
  const response = await invokeCommand('writing_prompt_list', {
    taskType: normalizedTaskType
  })
  const prompts = unwrapCommandResponse(response, 'writing_prompt_list') || []
  return prompts.map(toViewModel)
}

export async function getWritingPrompt(id) {
  const response = await invokeCommand('writing_prompt_get', { id: asPromptId(id) })
  const item = unwrapCommandResponse(response, 'writing_prompt_get')
  return item ? toViewModel(item) : null
}

export async function upsertWritingPrompt(data, explicitId = undefined) {
  const command = normalizeImportItem(data)
  const id = explicitId === undefined ? command.id : asPromptId(explicitId)
  if (id) command.id = id
  const response = await invokeCommand('writing_prompt_upsert', { cmd: command })
  return toViewModel(unwrapCommandResponse(response, 'writing_prompt_upsert'))
}

export async function importWritingPromptConfig(jsonData) {
  const prompts = promptImportItems(jsonData).map(normalizeImportItem)
  const response = await invokeCommand('writing_prompt_import', { cmd: { prompts } })
  const report = unwrapCommandResponse(response, 'writing_prompt_import') || {}
  const items = Array.isArray(report.items) ? report.items.map(toViewModel) : []
  return {
    imported: items.length,
    created: Number(report.created || 0),
    updated: Number(report.updated || 0),
    items
  }
}

export async function activateWritingPrompt(id) {
  const response = await invokeCommand('writing_prompt_activate', { id: asPromptId(id) })
  return toViewModel(unwrapCommandResponse(response, 'writing_prompt_activate'))
}

export async function deleteWritingPrompt(id) {
  const response = await invokeCommand('writing_prompt_delete', { id: asPromptId(id) })
  return !!unwrapCommandResponse(response, 'writing_prompt_delete')
}

export const writingPromptsRepository = {
  listAll: listWritingPrompts,
  get: getWritingPrompt,
  create: (data) => upsertWritingPrompt(data),
  update: (id, data) => upsertWritingPrompt(data, id),
  async getActive(taskType) {
    return (await listWritingPrompts(taskType)).find((item) => item.is_active) || null
  },
  import: importWritingPromptConfig,
  activate: activateWritingPrompt,
  delete: deleteWritingPrompt,
  async exportActive() {
    return { prompts: (await listWritingPrompts()).filter((item) => item.is_active) }
  }
}

export default writingPromptsRepository
