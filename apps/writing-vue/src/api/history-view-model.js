/**
 * Rust's `HistoryListItemVm` is an input DTO.  This is the only view model
 * exposed to the Vue application: camelCase, reading metrics included, and no
 * legacy snake_case aliases leaked to components.
 */
function text(value, fallback = null) {
  const normalized = String(value ?? '').trim()
  return normalized || fallback
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function nonNegativeInteger(value) {
  const number = nullableNumber(value)
  return number === null ? 0 : Math.max(0, Math.round(number))
}

function clamp(value, lower, upper) {
  return Math.min(upper, Math.max(lower, value))
}

function historyActivity(value) {
  return String(value || '').trim().toLowerCase() === 'reading' ? 'reading' : 'writing'
}

function writingTaskType(value) {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '')
  if (normalized === 'task1' || normalized === 't1') return 'task1'
  if (normalized === 'task2' || normalized === 't2') return 'task2'
  return null
}

export function normalizeHistoryViewModel(raw) {
  const item = raw && typeof raw === 'object' ? raw : {}
  const activity = historyActivity(item.activity)
  const id = text(item.id, '')
  const submittedAt = text(item.submittedAt ?? item.submitted_at)
  const durationMs = nonNegativeInteger(item.durationMs ?? item.duration_ms)
  const sourceScore = nullableNumber(item.scoreValue ?? item.score_value)
  const scoreValue = activity === 'reading' && sourceScore !== null
    ? clamp(sourceScore, 0, 1)
    : sourceScore
  const assetId = text(item.assetId ?? item.asset_id)
  const sessionId = text(item.sessionId ?? item.session_id, id || null)
  const suiteId = text(item.suiteId ?? item.suite_id)
  const metadata = { activity }
  if (assetId) metadata.assetId = assetId
  if (sessionId) metadata.sessionId = sessionId
  if (suiteId) metadata.suiteSessionId = suiteId

  const scoreLabel = text(
    item.scoreLabel ?? item.score_label,
    activity === 'reading' ? 'Accuracy' : 'Overall Band'
  )
  const defaultScoreDisplay = scoreValue === null
    ? '—'
    : activity === 'reading'
      ? `${Math.round(scoreValue * 100)}%`
      : scoreValue.toFixed(1)

  const viewModel = {
    id,
    activity,
    title: text(item.title, 'Untitled'),
    status: text(item.status, 'completed'),
    mode: text(item.mode, 'single'),
    submittedAt,
    durationMs,
    duration: Math.round(durationMs / 1000),
    scoreValue,
    scoreScale: text(item.scoreScale ?? item.score_scale),
    scoreLabel,
    scoreDisplay: text(item.scoreDisplay ?? item.score_display, defaultScoreDisplay),
    assetId,
    sessionId,
    suiteId,
    metadata,
    source: 'tauri'
  }

  if (activity === 'reading') {
    return {
      ...viewModel,
      examId: assetId,
      accuracy: scoreValue ?? 0,
      taskType: 'reading'
    }
  }

  return {
    ...viewModel,
    // Rust owns this classification.  Never turn an unknown legacy record
    // into Task 2 merely because the old UI lacked a nullable field.
    taskType: writingTaskType(item.taskType ?? item.task_type)
  }
}
