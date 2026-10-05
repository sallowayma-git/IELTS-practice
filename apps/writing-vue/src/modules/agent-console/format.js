/**
 * Agent console copy — product language only.
 *
 * Journal facts, memory values, and approval payloads are structured records.
 * The Vue template must never interpolate those objects (Vue 3 stringifies
 * them as JSON). Every export here returns display strings.
 */

const SKILL_LABELS = {
  'reading.matching_headings': '阅读 · 段落大意配对',
  'reading.tfng': '阅读 · 判断题',
  'reading.yng': '阅读 · 是非题',
  'reading.multi_choice': '阅读 · 选择题',
  'reading.single_choice': '阅读 · 单选题',
  'reading.sentence_completion': '阅读 · 句子填空',
  'reading.summary_completion': '阅读 · 摘要填空',
  'reading.notes_completion': '阅读 · 笔记填空',
  'reading.table_completion': '阅读 · 表格填空',
  'reading.flow_chart_completion': '阅读 · 流程图',
  'reading.diagram_completion': '阅读 · 图示填空',
  'reading.short_answer': '阅读 · 简答题',
  'reading.classification': '阅读 · 分类题',
  'writing.task1': '写作 · Task 1',
  'writing.task2': '写作 · Task 2'
}

const ACTION_KIND_LABELS = {
  create_study_plan_draft: '创建学习计划草稿',
  mark_plan_item_done: '标记计划项完成',
  archive_memory_with_user_confirmation: '归档一条记忆',
  set_explicit_preference: '固定一条偏好',
  bulk_archive: '批量归档记忆',
  reset_derived_memory: '重置派生记忆',
  change_personalization_settings: '更改个性化设置',
  modify_long_term_plan: '修改长期计划'
}

const MEMORY_CHANGE_LABELS = [
  ['newCandidates', 'new_candidates', '新候选'],
  ['promoted', 'promoted', '已晋升'],
  ['reinforced', 'reinforced', '已加强'],
  ['refined', 'refined', '已细化'],
  ['improved', 'improved', '在改善'],
  ['regressed', 'regressed', '有回退'],
  ['contradicted', 'contradicted', '有反证'],
  ['superseded', 'superseded', '已取代']
]

function asObject(value) {
  if (!value) return null
  if (typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    const parsed = JSON.parse(trimmed)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function asArray(value) {
  if (Array.isArray(value)) return value
  return []
}

function asNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function pick(record, camel, snake, fallback) {
  if (!record || typeof record !== 'object') return fallback
  if (record[camel] !== undefined && record[camel] !== null) return record[camel]
  if (record[snake] !== undefined && record[snake] !== null) return record[snake]
  return fallback
}

export function formatJournalDate(value) {
  const raw = String(value || '').trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
  if (match) return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日`
  const date = raw ? new Date(raw) : null
  if (!date || Number.isNaN(date.getTime())) return raw || '今天'
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

export function summarizeBackgroundJob(job) {
  const kind = String(pick(job, 'jobKind', 'job_kind', ''))
  const rawStatus = String(job?.status || '')
  const status = rawStatus === 'queued' ? 'waiting' : rawStatus
  const labels = { waiting: '等待中', running: '运行中', completed: '已完成', failed: '失败', interrupted: '已中断' }
  const attempts = pick(job, 'attempts', 'attempts', null)
  const maxAttempts = pick(job, 'maxAttempts', 'max_attempts', null)
  return {
    id: job?.id,
    kind,
    title: ({ daily_dream: '每日整理', daily_journal: '学习日记' })[kind] || kind || '后台任务',
    status,
    statusLabel: labels[status] || `未知状态（${rawStatus || '未返回'}）`,
    attemptsLabel: `执行次数 ${attempts ?? '未返回'} / ${maxAttempts ?? '未返回'}`,
    error: String(pick(job, 'lastError', 'last_error', '') || '')
  }
}

export function formatSkillKey(skillKey) {
  const key = String(skillKey || '').trim()
  if (!key) return '相关技能'
  if (SKILL_LABELS[key]) return SKILL_LABELS[key]
  const parent = key.includes('.') ? key.slice(0, key.lastIndexOf('.')) : ''
  const leaf = key.split('.').pop() || key
  const leafLabel = leaf.replace(/_/g, ' ')
  if (parent && SKILL_LABELS[parent]) return `${SKILL_LABELS[parent]} · ${leafLabel}`
  if (key.startsWith('reading.')) return `阅读 · ${leafLabel}`
  if (key.startsWith('writing.')) return `写作 · ${leafLabel}`
  return leafLabel
}

function formatSignedDelta(delta) {
  const n = asNumber(delta, 0)
  const abs = Math.abs(n)
  const body = abs >= 10 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, '')
  if (n > 0) return `+${body}`
  return body
}

function formatMinutes(timeSpentMs) {
  const ms = asNumber(timeSpentMs, 0)
  if (ms <= 0) return ''
  const minutes = Math.max(1, Math.round(ms / 60000))
  return `${minutes} 分钟`
}

function formatBand(value) {
  if (value === null || value === undefined || value === '') return ''
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  return n % 1 === 0 ? String(n) : n.toFixed(1)
}

function formatWritingEval(summary) {
  const record = asObject(summary) || {}
  const completed = asNumber(pick(record, 'completed', 'completed', 0), 0)
  const degraded = asNumber(pick(record, 'degraded', 'degraded', 0), 0)
  const band = formatBand(pick(record, 'averageBand', 'average_band', null))
  if (!completed && !degraded && !band) return '当日没有写作评测'
  const parts = [`完成 ${completed} 篇`]
  if (degraded) parts.push(`降级 ${degraded} 篇`)
  if (band) parts.push(`均分 ${band}`)
  return parts.join(' · ')
}

function formatMemoryChanges(summary) {
  const record = asObject(summary) || {}
  const parts = []
  for (const [camel, snake, label] of MEMORY_CHANGE_LABELS) {
    const count = asNumber(pick(record, camel, snake, 0), 0)
    if (count > 0) parts.push(`${label} ${count}`)
  }
  return parts.length ? parts.join(' · ') : '记忆没有变化'
}

function formatSkillDeltas(deltas) {
  const items = asArray(deltas)
    .map((item) => {
      const record = asObject(item) || {}
      return {
        label: formatSkillKey(pick(record, 'skillKey', 'skill_key', '')),
        delta: asNumber(pick(record, 'delta', 'delta', 0), 0)
      }
    })
    .filter((item) => item.label && item.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3)
  if (!items.length) return '技能画像没有明显变化'
  return items.map((item) => `${item.label} ${formatSignedDelta(item.delta)}`).join('；')
}

function isQuietFacts(facts) {
  const writing = asObject(facts.writingEvalSummary || facts.writing_eval_summary) || {}
  const memory = asObject(facts.memoryChanges || facts.memory_changes) || {}
  const deltas = asArray(facts.skillDeltas || facts.skill_deltas)
  const memoryTotal = MEMORY_CHANGE_LABELS.reduce((sum, [camel, snake]) => {
    return sum + asNumber(pick(memory, camel, snake, 0), 0)
  }, 0)
  return (
    asNumber(facts.attemptsCount || facts.attempts_count, 0) === 0
    && asNumber(writing.completed, 0) === 0
    && asNumber(writing.degraded, 0) === 0
    && !writing.averageBand && !writing.average_band
    && deltas.length === 0
    && memoryTotal === 0
    && asNumber(facts.coachFeedbackCount || facts.coach_feedback_count, 0) === 0
    && asNumber(facts.timeSpentMs || facts.time_spent_ms, 0) === 0
  )
}

export function summarizeJournal(journal) {
  if (!journal || typeof journal !== 'object') return null
  const facts = asObject(journal.facts) || asObject(journal.factsJson) || asObject(journal.facts_json)
  if (!facts) return null
  const date = journal.journalDate || journal.journal_date || facts.journalDate || facts.journal_date || ''
  const attempts = asNumber(facts.attemptsCount || facts.attempts_count, 0)
  const coach = asNumber(facts.coachFeedbackCount || facts.coach_feedback_count, 0)
  const timeLabel = formatMinutes(facts.timeSpentMs || facts.time_spent_ms)
  const quiet = isQuietFacts(facts)
  const unresolvedRaw = journal.unresolvedQuestions || journal.unresolved_questions || []
  const unresolved = asArray(unresolvedRaw).map((item) => {
    if (typeof item === 'string') return item
    if (item && typeof item === 'object') {
      return String(item.question || item.text || item.prompt || '').trim()
    }
    return ''
  }).filter(Boolean)

  const rows = [
    { label: '练习次数', value: attempts ? `${attempts} 次` : '还没有练习' },
    { label: '写作评测', value: formatWritingEval(facts.writingEvalSummary || facts.writing_eval_summary) },
    { label: '技能变化', value: formatSkillDeltas(facts.skillDeltas || facts.skill_deltas) },
    { label: '记忆变更', value: formatMemoryChanges(facts.memoryChanges || facts.memory_changes) },
    { label: '教练反馈', value: coach ? `${coach} 条` : '没有教练反馈' }
  ]
  if (timeLabel) rows.push({ label: '学习时长', value: timeLabel })

  return {
    date,
    dateLabel: formatJournalDate(date),
    quiet,
    lede: quiet
      ? '当日没有新的练习痕迹。'
      : '根据当日的练习，系统整理出这些变化。',
    rows,
    unresolved
  }
}

export function formatPreferenceValue(value) {
  if (value === null || value === undefined || value === '') return '已保存'
  if (typeof value === 'boolean') return value ? '开启' : '关闭'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    const nested = asObject(trimmed)
    if (nested) return formatPreferenceValue(nested)
    if (trimmed.length > 80) return `${trimmed.slice(0, 77)}…`
    return trimmed
  }
  if (Array.isArray(value)) {
    if (!value.length) return '未设置'
    const parts = value.map(formatPreferenceValue).filter((part) => part && part !== '已保存')
    if (!parts.length) return '已保存'
    return parts.length > 3 ? `${parts.slice(0, 3).join('、')} 等` : parts.join('、')
  }
  if (typeof value === 'object') {
    if (typeof value.statement === 'string' && value.statement.trim()) return value.statement.trim()
    if (typeof value.label === 'string' && value.label.trim()) return value.label.trim()
    if ('enabled' in value) return formatPreferenceValue(Boolean(value.enabled))
    return '已保存的偏好'
  }
  return '已保存'
}

export function formatMemoryStatement(entry, readMemoryField) {
  const stmt = readMemoryField(entry, 'statement', '')
  if (stmt) return String(stmt)
  const key = readMemoryField(entry, 'preferenceKey', '') || readMemoryField(entry, 'preference_key', '')
  if (key) {
    const value = readMemoryField(entry, 'value', '')
    const display = formatPreferenceValue(value)
    const keyLabel = String(key).replace(/[_-]+/g, ' ')
    return display === '已保存' || display === '已保存的偏好'
      ? `偏好：${keyLabel}`
      : `${keyLabel} · ${display}`
  }
  return String(entry && entry.key || '记忆条目')
}

export function summarizeApproval(approval) {
  const kind = String(approval?.actionKind || approval?.action_kind || '').trim()
  const title = ACTION_KIND_LABELS[kind] || '需要确认的操作'
  const payload = asObject(approval?.payload) || {}
  const bits = []
  const path = payload.path || payload.filePath || payload.file_path
  if (path) {
    const name = String(path).split(/[\\/]/).filter(Boolean).pop()
    if (name) bits.push(name)
  }
  const probe = payload.skillProbe || payload.skill_probe
  if (probe) bits.push(String(probe))
  const preference = payload.preferenceKey || payload.preference_key
  if (preference) bits.push(`偏好：${String(preference).replace(/[_-]+/g, ' ')}`)
  if (payload.title) bits.push(String(payload.title))
  if (payload.reason) bits.push(String(payload.reason))
  const detail = bits.filter(Boolean).slice(0, 2).join(' · ')
    || '系统请求执行一项受控操作，需要你确认。'
  return { title, detail }
}

export function summarizeEvidence(bundle) {
  const observationCount = asArray(bundle?.observationIds).length
  const assetCount = asArray(bundle?.assetIds).length
  const supportCount = asArray(bundle?.supportIds).length
  const linkCount = asArray(bundle?.links).length
  const lines = []
  if (observationCount) lines.push(`关联 ${observationCount} 次练习观察`)
  if (assetCount) lines.push(`关联 ${assetCount} 份学习材料`)
  if (supportCount && !observationCount) lines.push(`有 ${supportCount} 条支持证据`)
  if (linkCount && !observationCount && !assetCount) lines.push(`有 ${linkCount} 条关联`)
  return {
    empty: lines.length === 0,
    lines,
    hint: lines.length
      ? '证据来自你做过的练习，不展示模型内部推理。'
      : '这条记忆还没有挂上具体练习证据。'
  }
}

export function formatFeedbackKind(kind) {
  return ({ accurate: '准确', inaccurate: '不准确', partially_accurate: '部分准确',
    outdated: '已过时', not_about_me: '不属于我', acknowledged: '已知悉' })[kind] || '已记录'
}

export const MEMORY_EVIDENCE_LIMITS = Object.freeze({ observations: 20, events: 50 })

export function formatStudyProbe(probe) {
  if (typeof probe === 'string') return probe
  if (!probe || typeof probe !== 'object') return '待确认技能'
  return [probe.skillKey, probe.probeKind].filter(Boolean).join(' · ') || '待确认技能'
}

export function memoryEvidenceIds(values) {
  return [...new Set(asArray(values).filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))]
}

export function persistedPlanItems(snapshot, expectedPlanId = '') {
  const id = snapshot?.plan?.id
  if (typeof id !== 'string' || !id.trim() || (expectedPlanId && id !== expectedPlanId)
    || !Array.isArray(snapshot.items)
    || snapshot.items.some((item) => typeof item?.id !== 'string' || !item.id.trim() || item.planId !== id)
    || new Set(snapshot.items.map((item) => item.id)).size !== snapshot.items.length) {
    throw new Error('持久化计划响应无效或不是刚创建的计划，请重新读取。')
  }
  return snapshot.items
}

function evidenceOriginal(value) {
  if (value === null || value === undefined || value === '') return ''
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return text.length > 4000 ? `${text.slice(0, 4000)}\n…（原始记录过长，已截断）` : text
}

export function memoryEvidenceRoute(event) {
  if (!event.attemptId) return null
  if (event.activity === 'reading' && event.assetId) {
    return { name: 'PracticeReadingReview', params: { assetId: event.assetId, sessionId: event.attemptId } }
  }
  if (event.activity === 'writing' && /^attempt-[a-z0-9_-]{1,128}$/i.test(event.attemptId)) {
    return { name: 'Result', params: { sessionId: event.attemptId } }
  }
  return null
}

// Only explicit memory -> observation -> event references authorize evidence.
// Readers are injected so the same contract can be exercised without a host.
export async function resolveMemoryEvidence(observationIds, readers, userId = 'local') {
  const allIds = memoryEvidenceIds(observationIds)
  const ids = allIds.slice(0, MEMORY_EVIDENCE_LIMITS.observations)
  if (!ids.length) return { items: [], warnings: [], truncated: false }
  const batch = await readers.observations(ids)
  if (!Array.isArray(batch?.observations) || !Array.isArray(batch?.missingIds)) {
    throw new Error('观察证据响应无效，请重新读取。')
  }
  const byObservation = new Map(batch.observations.filter((row) => ids.includes(row.id) && row.userId === userId).map((row) => [row.id, row]))
  const observations = ids.map((id) => byObservation.get(id)).filter(Boolean)
  if (observations.some((row) => !Array.isArray(row.evidence) || row.evidence.some((ref) => !ref || typeof ref.eventId !== 'string' || !ref.eventId.trim()))) {
    throw new Error('观察证据引用无效，请重新读取。')
  }
  const eventIds = memoryEvidenceIds(observations.flatMap((row) => asArray(row.evidence).map((ref) => ref.eventId)))
  const selectedEventIds = eventIds.slice(0, MEMORY_EVIDENCE_LIMITS.events)
  const eventsBatch = selectedEventIds.length ? await readers.events(selectedEventIds) : { events: [], missingIds: [] }
  if (!Array.isArray(eventsBatch?.events) || !Array.isArray(eventsBatch?.missingIds)) {
    throw new Error('事件证据响应无效，请重新读取。')
  }
  const byEvent = new Map(eventsBatch.events.filter((row) => selectedEventIds.includes(row.id) && row.userId === userId).map((row) => [row.id, row]))
  const warnings = []
  const missingObservations = ids.filter((id) => !byObservation.has(id)).length
  const missingEvents = selectedEventIds.filter((id) => !byEvent.has(id)).length
  if (missingObservations) warnings.push(`${missingObservations} 条关联观察不可用，无法核验其证据。`)
  if (missingEvents) warnings.push(`${missingEvents} 条关联事件不可用，证据链不完整。`)
  if (batch.freshness && batch.freshness !== 'fresh') warnings.push('观察投影尚未更新，以下为现有记录。')
  const truncated = allIds.length > ids.length || eventIds.length > selectedEventIds.length
  if (truncated) warnings.push('本次最多读取 20 条观察、50 条关联事件；以下不是全部证据。')
  const items = observations.map((row) => ({
    id: row.id,
    source: `${row.id} · ${row.observationType} · ${row.observedAt} · ${row.scopeKey}`,
    original: evidenceOriginal(row.valueText) || evidenceOriginal(row.payload) || '该观察没有文字原文。',
    events: asArray(row.evidence).filter((ref) => byEvent.has(ref.eventId)).map((ref) => {
      const event = byEvent.get(ref.eventId)
      return {
        id: `${event.id}:${ref.evidenceRole}:${ref.ordinal}`,
        source: `${event.id} · ${ref.evidenceRole} · ${event.eventType} · ${event.occurredAt} · ${event.sourceKind}${event.sourceId ? ` / ${event.sourceId}` : ''}`,
        location: [event.assetId && `材料 ${event.assetId}`, event.attemptId && `练习 ${event.attemptId}`, event.questionId && `题目 ${event.questionId}`].filter(Boolean).join(' · '),
        original: evidenceOriginal(event.payload) || '该事件没有文字原文。',
        route: memoryEvidenceRoute(event)
      }
    })
  }))
  return { items, warnings, truncated }
}

export { ACTION_KIND_LABELS, SKILL_LABELS }
