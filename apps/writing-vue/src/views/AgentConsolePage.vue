<script setup>
import { computed, onMounted, ref } from 'vue'
import agentRepository from '@/api/agent-repository.js'
import { getMemoryEvidence } from '@/api/learning-repository.js'
import {
  listAgentThreads,
  listPendingApprovals,
  decideApproval,
  markStudyPlanItemDone
} from '@/api/agent-thread-repository.js'
import {
  archiveStaleMemories,
  archiveMemory,
  forgetMemory,
  getBackgroundJobStatus,
  getDailyJournal,
  getMemoryCatalog,
  recordMemoryFeedback,
  triggerDailyDream
} from '@/api/memory-repository.js'
import {
  formatFeedbackKind,
  formatJournalDate,
  formatMemoryStatement,
  formatStudyProbe,
  persistedPlanItems,
  summarizeApproval,
  summarizeBackgroundJob,
  summarizeJournal
} from '@/modules/agent-console/format.js'

// ════════════════════════════════════════════════════════════════════
// Self-evolution console. Four zones mirror the closed loop:
//   1. heartbeat   — is the loop alive today (jobs / journal / counts)
//   2. study plan  — what the planner proposes next (M12-04)
//   3. evolution   — how the system's understanding changed (M9 memories)
//   4. advanced    — raw workspace runs for power users (M0 surface)
// ════════════════════════════════════════════════════════════════════

// ---------- shared defensive readers (ported verbatim from M9) ----------

function readMemoryField(entry, field, fallback) {
  const value = entry && typeof entry === 'object' ? entry.value : null
  if (value && typeof value === 'object' && field in value) {
    const v = value[field]
    return v === undefined || v === null ? fallback : v
  }
  return fallback
}

function classifySource(entry) {
  const sourceClass = String(
    readMemoryField(entry, 'sourceClass', '') || readMemoryField(entry, 'source_class', '')
  ).toLowerCase()
  if (sourceClass === 'user_explicit') return 'user_explicit'
  if (sourceClass === 'observed') return 'observed'
  if (sourceClass === 'predicted') return 'predicted'
  if (sourceClass === 'consolidated') return 'consolidated'
  if (sourceClass === 'inferred') return 'predicted'
  if (sourceClass === 'system_policy') return 'system_policy'
  const ctxSource = String(entry && entry.source || '').toLowerCase()
  if (ctxSource === 'explicit_preference') return 'user_explicit'
  if (ctxSource === 'predicted_hypothesis' || ctxSource === 'inferred_candidate') return 'predicted'
  if (ctxSource === 'active_memory') return 'observed'
  return 'observed'
}

function asNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function confidenceBand(entry) {
  const raw = String(readMemoryField(entry, 'confidenceBand', '') || readMemoryField(entry, 'confidence_band', '')).toLowerCase()
  if (raw === 'low' || raw === 'medium' || raw === 'high') return raw
  return 'medium'
}

function memoryId(entry) {
  return String(entry && entry.id || readMemoryField(entry, 'id', '') || readMemoryField(entry, 'memoryId', '') || readMemoryField(entry, 'memory_id', ''))
}

function memoryVersion(entry) {
  return asNumber(readMemoryField(entry, 'version', 0) || readMemoryField(entry, 'memoryVersion', 0), 0)
}

function memoryNamespace(entry) {
  return String(readMemoryField(entry, 'namespace', '') || '').toLowerCase()
}

function memoryScope(entry) {
  const scope = readMemoryField(entry, 'scope', null)
  if (scope && typeof scope === 'object') {
    if (scope.key) return String(scope.key).toLowerCase()
    if (scope.activity) return String(scope.activity).toLowerCase()
  }
  if (typeof scope === 'string') return scope.toLowerCase()
  return ''
}

function memoryStatement(entry) {
  return formatMemoryStatement(entry, readMemoryField)
}

function memoryStatus(entry) {
  return String(readMemoryField(entry, 'status', '') || 'active').toLowerCase()
}

function supportCount(entry) {
  return asNumber(readMemoryField(entry, 'supportCount', 0) || readMemoryField(entry, 'support_count', 0), 0)
}

function contradictionCount(entry) {
  return asNumber(readMemoryField(entry, 'contradictionCount', 0) || readMemoryField(entry, 'contradiction_count', 0), 0)
}

function firstSeen(entry) {
  return String(readMemoryField(entry, 'firstSeen', '') || readMemoryField(entry, 'first_seen', '') || readMemoryField(entry, 'createdAt', '') || readMemoryField(entry, 'created_at', ''))
}

function lastSeen(entry) {
  return String(readMemoryField(entry, 'lastSeen', '') || readMemoryField(entry, 'last_seen', '') || readMemoryField(entry, 'updatedAt', '') || readMemoryField(entry, 'updated_at', ''))
}

function formatDate(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ---------- view_marker (M9-06): local UI state, never learning Memory ----------

const LAST_VISIT_KEY = 'memoryCenter.lastVisitAt'

function readLastVisitAt() {
  try {
    const raw = window.localStorage.getItem(LAST_VISIT_KEY)
    return raw ? String(raw) : ''
  } catch {
    return ''
  }
}

function writeLastVisitAt(value) {
  try {
    window.localStorage.setItem(LAST_VISIT_KEY, value)
  } catch {
    // best-effort local marker only
  }
}

// ---------- reactive state ----------

const loading = ref(true)
const errorMessage = ref('')
const actionMessage = ref('')
const actionError = ref('')
const preview = ref(null)
const entries = ref([])
const jobs = ref([])
const jobsReading = ref(false)
const jobsReadError = ref('')
let jobsRequest = 0
const journals = ref([])
const journalDate = ref(new Date().toISOString().slice(0, 10))
const journalReading = ref(false)
const journalReadError = ref('')
let journalRequest = 0
const threads = ref([])
const approvals = ref([])
const planItems = ref([])
const activePlanId = ref('')
const planDoneIds = ref(new Set())
const planReadError = ref('')
const planReading = ref(false)
const lastVisitAt = ref(readLastVisitAt())
const deltaBaseline = lastVisitAt.value
const memoryCatalogStale = ref(false)
const memoryCatalogLoading = ref(false)
const evidenceEntryId = ref(null)
const evidenceState = ref({ status: 'idle', items: [], warnings: [], error: '' })
let evidenceRequest = 0
let memoryCatalogVersion = 0
const feedbackInFlight = ref(new Set())
const activeTab = ref('changes')

const sourceMeta = {
  observed: { label: '系统观察', hint: '已在行为中发生' },
  predicted: { label: '系统假设', hint: '待验证假设，未自动采纳' },
  consolidated: { label: '高阶归纳', hint: '多条证据的高阶归纳' },
  user_explicit: { label: '用户设定', hint: '你自己设定的偏好' },
  system_policy: { label: '系统策略', hint: '系统保留策略' }
}

const bandLabel = { low: '低置信', medium: '中置信', high: '高置信' }
const statusLabel = {
  candidate: '候选', pending_review: '待复核', active: '生效中', superseded: '已被取代',
  archived: '已归档', quarantined: '已隔离', rejected: '已拒绝', deleted: '已删除'
}

const tabs = [
  { key: 'about', label: '关于我' },
  { key: 'observed', label: '系统观察' },
  { key: 'ability', label: '学习能力' },
  { key: 'explanation', label: '有效讲解方式' },
  { key: 'changes', label: '近期变化' },
  { key: 'archived', label: '已归档' }
]

// ---------- derived buckets ----------

function bucketFor(entry) {
  const source = classifySource(entry)
  const namespace = memoryNamespace(entry)
  const status = memoryStatus(entry)
  if (status === 'archived') return 'archived'
  if (source === 'user_explicit') return 'about'
  if (namespace === 'behavior' || namespace === 'metacognition' || namespace === 'strategy') return 'ability'
  if (namespace === 'preference' || source === 'user_explicit') return 'explanation'
  return 'observed'
}

const tabCounts = computed(() => {
  const counts = { about: 0, observed: 0, ability: 0, explanation: 0, changes: 0, archived: 0 }
  for (const entry of entries.value) counts[bucketFor(entry)] += 1
  counts.changes = delta.value.newWeakPoints.length + delta.value.improved.length + delta.value.reappeared.length + delta.value.newPatterns.length + delta.value.newPreferences.length
  return counts
})

function entriesForTab(tabKey) {
  return entries.value.filter((entry) => bucketFor(entry) === tabKey)
}

const delta = computed(() => computeDelta(entries.value, deltaBaseline))

function computeDelta(allEntries, sinceIso) {
  if (!sinceIso) {
    return { newWeakPoints: [], improved: [], reappeared: [], newPatterns: [], newPreferences: [] }
  }
  const since = new Date(sinceIso).getTime()
  const validSince = Number.isFinite(since) ? since : 0
  const recent = allEntries.filter((entry) => {
    const seen = new Date(lastSeen(entry)).getTime()
    return Number.isFinite(seen) ? seen > validSince : false
  })
  const newWeakPoints = []
  const improved = []
  const reappeared = []
  const newPatterns = []
  const newPreferences = []
  for (const entry of recent) {
    const source = classifySource(entry)
    const namespace = memoryNamespace(entry)
    const sup = supportCount(entry)
    const con = contradictionCount(entry)
    const summary = { id: memoryId(entry), statement: memoryStatement(entry), source, lastSeen: lastSeen(entry), supportCount: sup, contradictionCount: con }
    if (source === 'consolidated') { newPatterns.push(summary); continue }
    if (source === 'user_explicit' || namespace === 'preference') { newPreferences.push(summary); continue }
    if (con > 0 && sup >= con) { improved.push(summary); continue }
    if (con > 0) { reappeared.push(summary); continue }
    newWeakPoints.push(summary)
  }
  return { newWeakPoints, improved, reappeared, newPatterns, newPreferences }
}

const deltaGroups = computed(() => ([
  { key: 'newWeakPoints', label: '新识别的薄弱点', items: delta.value.newWeakPoints },
  { key: 'improved', label: '正在改善', items: delta.value.improved },
  { key: 'reappeared', label: '重新出现', items: delta.value.reappeared },
  { key: 'newPatterns', label: '新的高阶模式', items: delta.value.newPatterns },
  { key: 'newPreferences', label: '新偏好', items: delta.value.newPreferences }
]).filter((group) => group.items.length))

const jobSummaries = computed(() => jobs.value.map(summarizeBackgroundJob))
const dreamJobs = computed(() => jobSummaries.value.filter((job) => job.kind === 'daily_dream'))
const runningDreams = computed(() => dreamJobs.value.filter((job) => job.status === 'running'))

const heartbeat = computed(() => ({
  memories: entries.value.filter((e) => memoryStatus(e) !== 'archived').length,
  jobs: jobs.value.length,
  dreams: dreamJobs.value.length,
  planOpen: planItems.value.filter((item) => !planDoneIds.value.has(item.id)).length
}))

const journalSummary = computed(() => summarizeJournal(journals.value[0]))

// ---------- catalog adapter (M9/18.3) ----------
// The catalog read returns flat governance-shaped rows; the console logic
// (buckets, delta, drawers) consumes preview-shaped entries. One adapter,
// no special cases downstream.

function catalogToEntry(row) {
  if (!row || typeof row !== 'object') return null
  const id = String(row.id || '')
  if (!id) return null
  return {
    id,
    source: 'active_memory',
    key: row.canonicalKey || '',
    pendingVerification: Boolean(row.pendingVerification),
    value: {
      id,
      memoryId: id,
      statement: row.statement || '',
      sourceClass: row.sourceClass || '',
      namespace: row.namespace || '',
      scope: row.scope || '',
      status: row.status || 'active',
      confidenceBand: row.confidenceBand || 'medium',
      supportCount: row.supportCount ?? 0,
      contradictionCount: row.contradictionCount ?? 0,
      version: row.version ?? 1,
      firstSeen: row.firstSeen || '',
      lastSeen: row.lastSeen || '',
      evidenceObservationIds: Array.isArray(row.evidenceObservationIds)
        ? row.evidenceObservationIds
        : []
    }
  }
}

// ---------- loading ----------

async function loadConsole() {
  loading.value = true
  errorMessage.value = ''
  try {
    const [, , threadList, approvalList] = await Promise.all([
      // A failed catalog read must surface as a real error, not render as a
      // healthy-looking empty console.
      refreshMemoryCatalog().catch((error) => {
        errorMessage.value = error?.message || '记忆目录读取失败，请稍后重试。'
        return null
      }),
      readBackgroundJobs(),
      listAgentThreads(20).catch(() => []),
      listPendingApprovals(20).catch(() => []),
      loadJournal()
    ])
    threads.value = threadList || []
    approvals.value = approvalList || []
    writeLastVisitAt(new Date().toISOString())
    lastVisitAt.value = readLastVisitAt()

    // Latest plan wins; read the real snapshot — plan IDs are not thread IDs.
    if (!planReadError.value && !planReading.value && !planGenerating.value) activePlanId.value = ''
    await readStudyPlan()
  } catch (error) {
    errorMessage.value = error?.message || '智能体控制台暂时不可用'
  } finally {
    loading.value = false
  }
}

async function readBackgroundJobs() {
  const request = ++jobsRequest
  jobsReading.value = true
  jobsReadError.value = ''
  jobs.value = []
  try {
    const result = await getBackgroundJobStatus()
    if (request !== jobsRequest) return false
    if (!Array.isArray(result)) throw new Error('后台任务响应无效。')
    jobs.value = result
    return true
  } catch (error) {
    if (request !== jobsRequest) return false
    jobsReadError.value = `后台任务读取失败，请重新读取。${error?.message || ''}`
    return false
  } finally {
    if (request === jobsRequest) jobsReading.value = false
  }
}

function switchJournalDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return
  journalDate.value = date
  return loadJournal()
}

async function loadJournal() {
  const request = ++journalRequest
  const date = journalDate.value
  journalReading.value = true
  journalReadError.value = ''
  journals.value = []
  try {
    const journal = await getDailyJournal({ userId: 'local', journalDate: date })
    if (request !== journalRequest || date !== journalDate.value) return false
    const summary = summarizeJournal(journal)
    if (journal !== null && (!summary || summary.date !== date)) throw new Error('学习日记响应无效或日期不匹配。')
    journals.value = journal ? [journal] : []
    return true
  } catch (error) {
    if (request !== journalRequest || date !== journalDate.value) return false
    journalReadError.value = `学习日记读取失败，请重新读取。${error?.message || ''}`
    return false
  } finally {
    if (request === journalRequest && date === journalDate.value) journalReading.value = false
  }
}

async function runDailyDream() {
  actionMessage.value = ''
  actionError.value = ''
  try {
    const today = new Date().toISOString().slice(0, 10)
    // The command resolves (or deterministically builds) today's journal on
    // the Rust side; the UI only names the day.
    await triggerDailyDream({ userId: 'local', day: today })
    actionMessage.value = '今天的日记已整理。'
  } catch (error) {
    actionError.value = error?.message || '每日整理触发失败'
  } finally {
    await readBackgroundJobs()
    await loadJournal()
  }
}

async function runArchiveStale() {
  actionMessage.value = ''
  actionError.value = ''
  try {
    invalidateMemoryCatalog()
    await archiveStaleMemories()
    if (!await refreshAfterMemoryMutation()) return
    actionMessage.value = '已运行过期归档。过期记忆会收进「已归档」，不会删除。'
    await loadConsole()
  } catch (error) {
    actionError.value = error?.message || '归档扫描失败'
  }
}

// ---------- plan items ----------

const planGenerating = ref(false)

async function readStudyPlan() {
  if (planReading.value) return false
  planReading.value = true
  planReadError.value = ''
  planItems.value = []
  planDoneIds.value = new Set()
  try {
    const snapshot = await agentRepository.getLatestStudyPlan('local')
    if (!snapshot && !activePlanId.value) return true
    const items = persistedPlanItems(snapshot, activePlanId.value)
    activePlanId.value = snapshot.plan.id
    planItems.value = items
    planDoneIds.value = new Set(items.filter((item) => item.done).map((item) => item.id))
    return true
  } catch (error) {
    planReadError.value = `${activePlanId.value ? '计划已创建，但读取失败。' : '计划读取失败。'}请重新读取，不要重复生成。${error?.message || ''}`
    return false
  } finally {
    planReading.value = false
  }
}

async function generateStudyPlan() {
  if (planGenerating.value || planReading.value || planReadError.value) return
  planGenerating.value = true
  actionMessage.value = ''
  actionError.value = ''
  try {
    // The planner runs deterministically in the sidecar and persists via
    // study_plan.create; the reply carries the host-assigned planId.
    const proposal = await agentRepository.runStudyPlanner({
      userGoal: '按当前技能状态安排今日练习',
      availableMinutes: 60
    })
    if (!String(proposal?.planId || '').trim()) {
      actionError.value = proposal?.fallbackReason || '规划器没有产出可保存的计划。'
      return
    }
    // Re-read the persisted snapshot: the host assigned canonical item ids.
    activePlanId.value = String(proposal.planId)
    if (!await readStudyPlan()) return
    actionMessage.value = `已生成今日计划（${planItems.value.length} 项）。`
  } catch (error) {
    actionError.value = error?.message || '生成学习计划失败'
  } finally {
    planGenerating.value = false
  }
}

async function togglePlanItem(item) {
  if (planGenerating.value || planReading.value || planReadError.value
    || !item?.id || !planItems.value.some((row) => row.id === item.id && row.planId === activePlanId.value)) return
  const done = !planDoneIds.value.has(item.id)
  const next = new Set(planDoneIds.value)
  if (done) next.add(item.id); else next.delete(item.id)
  planDoneIds.value = next
  try {
    await markStudyPlanItemDone(item.id, done)
  } catch (error) {
    const revert = new Set(planDoneIds.value)
    if (done) revert.delete(item.id); else revert.add(item.id)
    planDoneIds.value = revert
    actionError.value = error?.message || '更新计划项失败'
  }
}

// ---------- approvals (M12-06) ----------

async function decidePendingApproval(approval, approve) {
  setBusy(approval.id, true)
  try {
    await decideApproval(approval.id, approve ? 'approved' : 'rejected')
    approvals.value = approvals.value.filter((a) => a.id !== approval.id)
    actionMessage.value = approve ? '已批准该受控行动。' : '已驳回该受控行动。'
  } catch (error) {
    actionError.value = error?.message || '审批操作失败'
  } finally {
    setBusy(approval.id, false)
  }
}

// ---------- memory feedback + mutations (ported verbatim) ----------

function setBusy(id, busy) {
  const next = new Set(feedbackInFlight.value)
  if (busy) next.add(id); else next.delete(id)
  feedbackInFlight.value = next
}

async function submitMemoryFeedback(entry, kind) {
  const id = memoryId(entry)
  if (!id) { actionError.value = '该条目没有稳定 ID，无法记录反馈。'; return }
  setBusy(id, true)
  actionMessage.value = ''
  actionError.value = ''
  try {
    invalidateMemoryCatalog()
    await recordMemoryFeedback(id, kind)
    if (!await refreshAfterMemoryMutation()) return
    actionMessage.value = `已记录反馈：${formatFeedbackKind(kind)}。`
  } catch (error) {
    actionError.value = error?.message || '反馈提交失败'
  } finally {
    setBusy(id, false)
  }
}

async function refreshMemoryCatalog() {
  const version = ++memoryCatalogVersion
  try {
    const catalog = await getMemoryCatalog({ includeArchived: true })
    if (version !== memoryCatalogVersion) return false
    if (!Array.isArray(catalog?.entries)) throw new Error('记忆目录响应无效。')
    entries.value = catalog.entries.map(catalogToEntry).filter(Boolean)
    preview.value = { userId: catalog.userId, entries: entries.value, truncated: catalog.truncated }
    evidenceEntryId.value = null
    evidenceRequest += 1
    memoryCatalogStale.value = false
    errorMessage.value = ''
    return true
  } catch (error) {
    if (version !== memoryCatalogVersion) return false
    clearMemoryCatalog()
    throw error
  }
}

function invalidateMemoryCatalog() {
  memoryCatalogVersion += 1
}

function clearMemoryCatalog() {
  entries.value = []
  preview.value = null
  evidenceEntryId.value = null
  evidenceRequest += 1
  memoryCatalogStale.value = true
}

async function refreshAfterMemoryMutation() {
  invalidateMemoryCatalog()
  clearMemoryCatalog()
  try {
    return await refreshMemoryCatalog()
  } catch {
    actionError.value = '操作已保存，但记忆目录读取失败。请重新读取，不要重复提交。'
    return false
  }
}

async function retryMemoryCatalog() {
  if (memoryCatalogLoading.value) return
  memoryCatalogLoading.value = true
  try {
    if (!await refreshMemoryCatalog()) return
    actionError.value = ''
    actionMessage.value = '已重新读取记忆目录。'
  } catch {
    actionError.value = '记忆目录仍无法读取，请稍后重试。已保存的操作不会重复提交。'
  } finally {
    memoryCatalogLoading.value = false
  }
}

async function archiveEntry(entry) {
  const id = memoryId(entry)
  if (!id) { actionError.value = '该条目没有稳定 ID，无法归档。'; return }
  setBusy(id, true)
  actionMessage.value = ''
  actionError.value = ''
  try {
    invalidateMemoryCatalog()
    await archiveMemory({ memoryId: id, expectedVersion: memoryVersion(entry), reason: 'user_agent_console_archive' })
    if (!await refreshAfterMemoryMutation()) return
    actionMessage.value = '已归档该记忆及依赖它的结论，正文与证据保留在「已归档」。'
  } catch (error) {
    actionError.value = error?.message || '归档失败'
  } finally {
    setBusy(id, false)
  }
}

async function forgetEntry(entry) {
  const id = memoryId(entry)
  if (!id) { actionError.value = '该条目没有稳定 ID，无法遗忘。'; return }
  if (!window.confirm('永久遗忘会删除这条记忆的正文和关联证据，无法恢复。原始练习记录不会删除。确认继续？')) return
  setBusy(id, true)
  actionMessage.value = ''
  actionError.value = ''
  try {
    invalidateMemoryCatalog()
    await forgetMemory({ memoryId: id, expectedVersion: memoryVersion(entry), reason: 'user_agent_console_forget' })
    if (!await refreshAfterMemoryMutation()) return
    actionMessage.value = '已永久遗忘该记忆，依赖它的结论已停用。原始练习记录保留。'
  } catch (error) {
    actionError.value = error?.message || '遗忘失败'
  } finally {
    setBusy(id, false)
  }
}

// ---------- Evidence Drawer (M9-04) ----------

async function toggleEvidence(entry) {
  const id = memoryId(entry)
  if (evidenceEntryId.value === id) {
    evidenceEntryId.value = null
    evidenceRequest += 1
    return
  }
  evidenceEntryId.value = id
  await loadEvidence(entry)
}

async function loadEvidence(entry) {
  const request = ++evidenceRequest
  const id = memoryId(entry)
  evidenceState.value = { status: 'loading', items: [], warnings: [], error: '' }
  try {
    const ids = readMemoryField(entry, 'evidenceObservationIds', [])
    const result = await getMemoryEvidence(ids, preview.value?.userId || 'local')
    if (request !== evidenceRequest || evidenceEntryId.value !== id) return
    evidenceState.value = { status: 'ready', items: result.items, warnings: result.warnings, error: '' }
  } catch (error) {
    if (request !== evidenceRequest || evidenceEntryId.value !== id) return
    evidenceState.value = { status: 'error', items: [], warnings: [], error: error?.message || '证据读取失败，请重试。' }
  }
}

function closeEvidence(event) {
  evidenceEntryId.value = null
  evidenceRequest += 1
  event.currentTarget.closest('article')?.querySelector('[data-memory-evidence-toggle]')?.focus()
}

function approvalCopy(approval) {
  return summarizeApproval(approval)
}

// ════════════════════════════════════════════════════════════════════
// Advanced workspace (zone 4): fixed host-managed directory, no folder picker.
// Selectors are pinned by packaged_tauri_flow.py agentWorkspaceRun.
// ════════════════════════════════════════════════════════════════════

const defaultPrompt = '请先阅读已选上下文，提炼关键事实，再给出一份简洁、可执行的学习建议。'
const promptText = ref(defaultPrompt)
const selectedFile = ref('')
const workspaceGrant = ref(null)
const workspaceBusy = ref(false)
const runState = ref('idle')
const lastRun = ref(null)
const lastRunAt = ref('')
const activeRunId = ref('')
const outputText = ref('默认工作区准备好后，运行结果会出现在这里。')
const workspaceLocked = computed(() => workspaceBusy.value || runState.value === 'running')

const files = computed(() => {
  const byPath = new Map()
  for (const call of lastRun.value?.toolCalls || []) {
    const path = String(call.arguments?.path || call.result?.path || '').trim()
    if (!path || byPath.has(path)) continue
    const name = path.split(/[\\/]/).filter(Boolean).pop() || path
    byPath.set(path, {
      path,
      name,
      kind: fileKind(name),
      meta: `${call.toolName} · ${toolStatusLabel(call.status)}`
    })
  }
  return [...byPath.values()]
})
const workspaceName = computed(() => {
  const path = workspaceGrant.value?.displayPath || ''
  return path.split(/[\\/]/).filter(Boolean).pop() || '默认工作区'
})
const workspaceStatus = computed(() => workspaceGrant.value?.displayPath || '正在准备专用目录…')
const selectedFileName = computed(() => {
  return files.value.find((file) => file.path === selectedFile.value)?.name || workspaceName.value
})
const modelLabel = computed(() => lastRun.value?.actualModel || '本地配置模型')
const canRun = computed(() => {
  return Boolean(workspaceGrant.value && promptText.value.trim() && !workspaceLocked.value)
})
const runIdShort = computed(() => lastRun.value?.id?.slice(0, 8) || '--')
const runStateLabel = computed(() => ({
  idle: '待命',
  running: '运行中',
  complete: '已完成',
  error: '运行失败'
})[runState.value])
const runStateDetail = computed(() => {
  if (runState.value === 'running') return '模型与工具正在执行'
  if (runState.value === 'complete') return `${lastRun.value?.rounds || 0} 轮 · ${lastRun.value?.toolCallCount || 0} 次工具调用`
  if (runState.value === 'error') return '查看输出中的错误信息'
  return workspaceGrant.value ? '等待提示词' : '等待工作区授权'
})
const runSteps = computed(() => {
  const steps = [{
    key: 'workspace',
    label: '工作区授权',
    detail: workspaceGrant.value ? workspaceName.value : '正在初始化',
    state: workspaceGrant.value ? 'complete' : 'pending'
  }]
  if (runState.value === 'running') {
    steps.push({ key: 'run', label: '执行 Agent', detail: '等待模型返回', state: 'active' })
  }
  for (const call of lastRun.value?.toolCalls || []) {
    const path = call.arguments?.path || call.result?.path || `round ${call.round}`
    steps.push({
      key: `${call.sequence}-${call.callId}`,
      label: call.toolName,
      detail: `${toolStatusLabel(call.status)} · ${path}`,
      state: call.status === 'succeeded' ? 'complete' : call.status === 'running' ? 'active' : 'error'
    })
  }
  steps.push({
    key: 'result',
    label: '最终结果',
    detail: lastRun.value ? `${lastRun.value.rounds} 轮 · run ${runIdShort.value}` : '尚未运行',
    state: runState.value === 'complete' ? 'complete' : runState.value === 'error' ? 'error' : 'pending'
  })
  return steps.map((step, index) => ({ ...step, index: String(index + 1).padStart(2, '0') }))
})
const runMetadata = computed(() => {
  const run = lastRun.value
  if (!run) return []
  const tokens = run.usage ? `${run.usage.inputTokens} in / ${run.usage.outputTokens} out` : '未返回'
  return [
    { label: 'Run ID', value: run.id },
    { label: 'Actual model', value: run.actualModel || '未返回' },
    { label: 'Latency', value: `${run.latencyMs} ms` },
    { label: 'Usage', value: tokens },
    { label: 'Retries', value: String(run.retryCount) },
    { label: 'Request ID', value: run.providerRequestId || '未返回' },
    { label: 'Prompt hash', value: run.promptHash || '未返回' }
  ]
})

function selectFile(path) {
  selectedFile.value = path
}

async function initializeWorkspace() {
  if (workspaceLocked.value) return
  workspaceBusy.value = true
  try {
    workspaceGrant.value = await agentRepository.getWorkspace()
    outputText.value = '默认工作区已准备好，可以开始运行。'
  } catch (error) {
    showError(error)
  } finally {
    workspaceBusy.value = false
  }
}

async function runAgent() {
  if (!canRun.value) return
  runState.value = 'running'
  lastRun.value = null
  activeRunId.value = crypto.randomUUID()
  outputText.value = '正在执行模型与工作区工具…'
  lastRunAt.value = ''
  try {
    // A long-open page renews its short-lived grant without a user decision.
    workspaceGrant.value = await agentRepository.getWorkspace()
    const outcome = await agentRepository.run({
      grantId: workspaceGrant.value.grantId,
      prompt: promptText.value,
      runId: activeRunId.value
    })
    const record = await agentRepository.getRun(outcome.runId)
    if (!record) throw new Error(`Agent run ${outcome.runId} could not be reloaded from SQLite`)
    const run = agentRepository.normalizeRun(outcome, record)
    lastRun.value = run
    selectedFile.value = files.value[0]?.path || ''
    outputText.value = run.content || 'Agent 已完成，但未返回正文。'
    lastRunAt.value = formatTime(run.completedAt)
    runState.value = run.status === 'completed' ? 'complete' : 'error'
  } catch (error) {
    const failedRun = await hydrateFailedRun(error)
    if (failedRun) {
      lastRun.value = failedRun
      selectedFile.value = files.value[0]?.path || ''
    }
    showError(error, failedRun?.completedAt)
  } finally {
    activeRunId.value = ''
  }
}

async function cancelAgentRun() {
  if (!activeRunId.value) return
  try {
    const cancelled = await agentRepository.cancelRun(activeRunId.value)
    outputText.value = cancelled
      ? '已请求取消，Agent 会在当前模型/工具调用结束后中断。'
      : '该运行已结束，无需取消。'
  } catch (error) {
    actionError.value = error?.message || '取消请求失败'
  }
}

async function hydrateFailedRun(error) {
  const runId = String(error?.context?.runId || '').trim()
  if (!runId) return null
  try {
    const record = await agentRepository.getRun(runId)
    return record ? agentRepository.normalizeRun(null, record) : null
  } catch {
    return null
  }
}

function showError(error, completedAt) {
  runState.value = 'error'
  outputText.value = error?.message || 'Agent 运行失败。'
  lastRunAt.value = formatTime(completedAt)
}

function formatTime(value) {
  const date = value ? new Date(value) : new Date()
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fileKind(name) {
  if (/\.md$/i.test(name)) return 'markdown'
  if (/\.json$/i.test(name)) return 'json'
  return 'text'
}

function toolStatusLabel(status) {
  return ({
    running: '执行中',
    succeeded: '已完成',
    rejected: '已拒绝',
    failed: '失败',
    interrupted: '已中断'
  })[status] || status || '未知'
}

onMounted(() => {
  loadConsole()
  initializeWorkspace()
})
</script>

<template>
  <section class="agent-page agent-console-page" data-agent-console>
    <header class="agent-page-header">
      <div class="agent-page-header__copy">
        <p class="agent-page-header__eyebrow">开发者模式</p>
        <h1>智能体控制台</h1>
        <p class="agent-page-header__lede">练习留下证据，证据长成记忆，记忆再驱动下一步计划。这里只展示对你有用的结果，不展示内部记录。</p>
      </div>
      <div class="agent-page-header__status" :class="`is-${runState}`" role="status">
        <span class="agent-status-dot" aria-hidden="true"></span>
        <span>{{ runStateLabel }}</span>
      </div>
    </header>

    <p v-if="errorMessage" class="agent-inline-error">{{ errorMessage }}</p>
    <p v-else-if="actionError" class="agent-inline-error">{{ actionError }}</p>
    <p v-else-if="actionMessage" class="agent-inline-status" role="status">{{ actionMessage }}</p>
    <p v-if="loading" class="agent-loading" role="status" aria-live="polite">正在读取学习闭环状态…</p>

    <template v-else>
      <!-- Zone 1: heartbeat -->
      <section class="agent-heartbeat" aria-label="今日心跳">
        <div class="agent-heartbeat__cards">
          <div class="agent-heartbeat-card">
            <strong>{{ heartbeat.memories }}</strong>
            <span>生效中的记忆</span>
          </div>
          <div class="agent-heartbeat-card">
            <strong>{{ heartbeat.planOpen }}</strong>
            <span>待完成的计划项</span>
          </div>
          <div class="agent-heartbeat-card">
            <strong>{{ jobsReading ? '读取中' : jobsReadError ? '不可用' : heartbeat.jobs }}</strong>
            <span>后台任务</span>
          </div>
          <div class="agent-heartbeat-card" :class="{ 'is-dreaming': runningDreams.length > 0 }">
            <strong>{{ jobsReading ? '读取中' : jobsReadError ? '不可用' : runningDreams.length }}</strong>
            <span>运行中的整理任务</span>
          </div>
        </div>
        <div aria-label="后台任务状态" :aria-busy="jobsReading">
          <p v-if="jobsReading" role="status">正在读取后台任务…</p>
          <p v-else-if="jobsReadError" class="agent-inline-error" role="alert">{{ jobsReadError }}</p>
          <ul v-else-if="jobSummaries.length">
            <li v-for="job in jobSummaries" :key="job.id">
              {{ job.title }} · {{ job.statusLabel }} · {{ job.attemptsLabel }}
              <span v-if="job.error"> · 最近错误：{{ job.error }}</span>
            </li>
          </ul>
          <p v-else role="status">暂无后台任务记录。</p>
          <button class="agent-text-button" type="button" :disabled="jobsReading" @click="readBackgroundJobs">重新读取后台任务</button>
        </div>
        <div class="agent-journal-card" :aria-busy="journalReading">
          <div class="agent-journal-card__head">
            <h2>{{ formatJournalDate(journalDate) }}整理</h2>
            <label>日期 <input type="date" :value="journalDate" @change="switchJournalDate($event.target.value)"></label>
          </div>
          <p v-if="journalReading" role="status">正在读取所选日期的学习日记…</p>
          <p v-else-if="journalReadError" class="agent-inline-error" role="alert">{{ journalReadError }}</p>
          <template v-else-if="journalSummary">
            <p class="agent-journal-card__lede">{{ journalSummary.lede }}</p>
            <dl class="agent-journal-stats">
              <div v-for="row in journalSummary.rows" :key="row.label">
                <dt>{{ row.label }}</dt>
                <dd>{{ row.value }}</dd>
              </div>
            </dl>
          </template>
          <p v-else role="status">{{ formatJournalDate(journalDate) }}暂无学习日记。</p>
          <button class="agent-text-button" type="button" :disabled="journalReading" @click="loadJournal">重新读取日记</button>
          <button class="agent-text-button" type="button" @click="runDailyDream">手动触发今天的整理</button>
        </div>
      </section>

      <!-- Zone 2: study plan -->
      <section class="agent-plan-zone" aria-label="学习计划">
        <div class="agent-panel__head">
          <div>
            <p class="agent-panel__eyebrow">下一步</p>
            <h2>今日学习计划</h2>
          </div>
          <span v-if="planItems.length" class="agent-model-badge">{{ planDoneIds.size }}/{{ planItems.length }} 已完成</span>
          <button
            class="agent-text-button"
            type="button"
            :disabled="planGenerating || planReading || Boolean(planReadError)"
            @click="generateStudyPlan"
          >
            {{ planGenerating ? '生成中…' : '生成计划' }}
          </button>
        </div>
        <div v-if="planReadError" role="alert">
          <p>{{ planReadError }}</p>
          <button class="agent-text-button" type="button" :disabled="planReading" @click="readStudyPlan">重新读取计划</button>
        </div>
        <ul v-if="planItems.length" class="agent-plan-list">
          <li
            v-for="item in planItems"
            :key="item.id"
            class="agent-plan-item"
            :class="{ 'is-done': planDoneIds.has(item.id) }"
            :data-plan-item-id="item.id"
          >
            <label class="agent-plan-item__check">
              <input
                type="checkbox"
                :checked="planDoneIds.has(item.id)"
                :disabled="planGenerating || planReading || Boolean(planReadError)"
                aria-label="标记计划项完成"
                @change="togglePlanItem(item)"
              />
              <span aria-hidden="true"></span>
            </label>
            <div class="agent-plan-item__copy">
              <strong>{{ formatStudyProbe(item.skillProbe) }}</strong>
              <small>{{ item.whyText }}</small>
            </div>
            <span class="agent-plan-item__minutes">约 {{ item.estimatedMinutes }} 分钟</span>
          </li>
        </ul>
        <p v-else class="agent-empty-hint">
          {{ planReadError ? '读取成功后才能操作计划项。' : '学习计划会根据你的复习需求自动生成。点击「生成计划」，让规划器依据最近的技能状态安排今天练什么。' }}
        </p>
      </section>

      <!-- Zone 3: evolution timeline -->
      <section class="agent-evolution-zone" aria-label="理解演化">
        <button v-if="memoryCatalogStale" class="agent-text-button" data-memory-retry :disabled="memoryCatalogLoading" @click="retryMemoryCatalog">重新读取记忆目录</button>
        <nav class="agent-evo-tabs" role="tablist" aria-label="记忆分区">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            type="button"
            role="tab"
            :class="{ 'is-active': activeTab === tab.key }"
            :aria-selected="activeTab === tab.key"
            @click="activeTab = tab.key"
          >
            {{ tab.label }}
            <small>{{ tabCounts[tab.key] }}</small>
          </button>
        </nav>

        <template v-if="activeTab === 'changes'">
          <div v-if="deltaGroups.length" class="agent-delta-groups">
            <section v-for="group in deltaGroups" :key="group.key" class="agent-delta-group">
              <h3>{{ group.label }} <small>{{ group.items.length }}</small></h3>
              <ul>
                <li v-for="item in group.items" :key="item.id" class="agent-delta-item">
                  <span class="agent-delta-item__dot" :class="`is-${item.source}`" aria-hidden="true"></span>
                  <div class="agent-delta-item__copy">
                    <strong>{{ item.statement }}</strong>
                    <small>{{ sourceMeta[item.source]?.hint || '' }} · {{ formatDate(item.lastSeen) }}</small>
                  </div>
                </li>
              </ul>
            </section>
          </div>
          <p v-else class="agent-empty-hint">上次访问以来没有新的记忆变化。继续练习，或点上方「触发每日整理」。</p>
        </template>

        <template v-else>
          <div v-if="entriesForTab(activeTab).length" class="agent-memory-cards">
            <article
              v-for="entry in entriesForTab(activeTab)"
              :key="memoryId(entry)"
              class="agent-memory-card"
              :data-memory-id="memoryId(entry)"
            >
              <header class="agent-memory-card__head">
                <span class="agent-memory-card__source" :class="`is-${classifySource(entry)}`">
                  {{ sourceMeta[classifySource(entry)]?.label || classifySource(entry) }}
                </span>
                <span class="agent-memory-card__band">{{ bandLabel[confidenceBand(entry)] }}</span>
              </header>
              <p class="agent-memory-card__statement">{{ memoryStatement(entry) }}</p>
              <footer class="agent-memory-card__meta">
                <span>证据 {{ supportCount(entry) }} · 反证 {{ contradictionCount(entry) }}</span>
                <span>{{ statusLabel[memoryStatus(entry)] || memoryStatus(entry) }}</span>
              </footer>
              <div class="agent-memory-card__actions">
                <button class="agent-text-button" type="button" data-memory-evidence-toggle
                  :id="`evidence-toggle-${memoryId(entry)}`"
                  :aria-expanded="evidenceEntryId === memoryId(entry)"
                  :aria-controls="`evidence-${memoryId(entry)}`" @click="toggleEvidence(entry)">
                  {{ evidenceEntryId === memoryId(entry) ? '收起证据' : '查看证据' }}
                </button>
                <button
                  v-if="activeTab !== 'archived'"
                  class="agent-text-button"
                  type="button"
                  :disabled="feedbackInFlight.has(memoryId(entry))"
                  @click="submitMemoryFeedback(entry, 'accurate')"
                >准确</button>
                <button
                  v-if="activeTab !== 'archived'"
                  class="agent-text-button"
                  type="button"
                  :disabled="feedbackInFlight.has(memoryId(entry))"
                  @click="submitMemoryFeedback(entry, 'inaccurate')"
                >不准确</button>
                <button
                  v-if="classifySource(entry) !== 'user_explicit' && memoryStatus(entry) === 'active'"
                  class="agent-text-button"
                  type="button"
                  :disabled="feedbackInFlight.has(memoryId(entry))"
                  @click="archiveEntry(entry)"
                >归档</button>
                <button
                  v-if="classifySource(entry) !== 'user_explicit'"
                  class="agent-text-button"
                  type="button"
                  :disabled="feedbackInFlight.has(memoryId(entry))"
                  @click="forgetEntry(entry)"
                >永久遗忘</button>
              </div>
              <div v-if="evidenceEntryId === memoryId(entry)" class="agent-evidence-drawer"
                :id="`evidence-${memoryId(entry)}`" role="region"
                :aria-labelledby="`evidence-toggle-${memoryId(entry)}`"
                :aria-busy="evidenceState.status === 'loading'" tabindex="0" @keydown.esc.stop="closeEvidence">
                <p v-if="evidenceState.status === 'loading'" role="status">正在读取关联证据…</p>
                <template v-else-if="evidenceState.status === 'error'">
                  <p role="alert">{{ evidenceState.error }}</p>
                  <button class="agent-text-button" type="button" @click="loadEvidence(entry)">重新读取证据</button>
                </template>
                <template v-else-if="evidenceState.status === 'ready'">
                  <p v-if="evidenceState.items.length" role="status">已读取 {{ evidenceState.items.length }} 条关联观察。</p>
                  <p v-for="warning in evidenceState.warnings" :key="warning" role="status">{{ warning }}</p>
                  <p v-if="!evidenceState.items.length && !evidenceState.warnings.length" role="status">这条记忆尚未关联具体观察证据。</p>
                  <section v-for="observation in evidenceState.items" :key="observation.id" aria-label="关联观察">
                    <p>{{ observation.source }}</p>
                    <small>观察原文</small>
                    <pre style="white-space: pre-wrap; overflow-wrap: anywhere">{{ observation.original }}</pre>
                    <p v-if="!observation.events.length">该观察暂无可读取的关联事件。</p>
                    <div v-for="event in observation.events" :key="event.id">
                      <p>{{ event.source }}</p>
                      <p>{{ event.location }}</p>
                      <details>
                        <summary>查看事件原始记录</summary>
                        <pre style="white-space: pre-wrap; overflow-wrap: anywhere">{{ event.original }}</pre>
                      </details>
                      <router-link v-if="event.route" :to="event.route">查看这次练习</router-link>
                    </div>
                  </section>
                </template>
              </div>
            </article>
          </div>
          <p v-else class="agent-empty-hint">此分区暂无条目。</p>
        </template>
      </section>

      <!-- Zone 4: approvals + advanced workspace -->
      <details class="agent-advanced" data-agent-workspace>
        <summary class="agent-advanced__summary">
          <span>高级工作台</span>
          <small>本地目录授权 · 工具运行 · 审批队列</small>
        </summary>

        <div class="agent-advanced__body">
          <section v-if="approvals.length" class="agent-approvals" aria-label="待审批行动">
            <div class="agent-panel__head">
              <div>
                <p class="agent-panel__eyebrow">需要确认</p>
                <h2>受控行动（{{ approvals.length }}）</h2>
              </div>
            </div>
            <ul class="agent-approval-list">
              <li v-for="approval in approvals" :key="approval.id" class="agent-approval-row">
                <div class="agent-approval-row__copy">
                  <strong>{{ approvalCopy(approval).title }}</strong>
                  <p>{{ approvalCopy(approval).detail }}</p>
                </div>
                <div class="agent-approval-row__actions">
                  <button
                    class="agent-run-button agent-run-button--small"
                    type="button"
                    :disabled="feedbackInFlight.has(approval.id)"
                    @click="decidePendingApproval(approval, true)"
                  >批准</button>
                  <button
                    class="agent-text-button"
                    type="button"
                    :disabled="feedbackInFlight.has(approval.id)"
                    @click="decidePendingApproval(approval, false)"
                  >驳回</button>
                </div>
              </li>
            </ul>
          </section>

          <div class="agent-workbench">
            <aside class="agent-panel agent-sidebar" aria-label="工作区文件">
              <div class="agent-panel__head agent-sidebar__head">
                <div>
                  <p class="agent-panel__eyebrow">本机目录</p>
                  <h2>本地工作区</h2>
                </div>
              </div>

              <div class="agent-workspace-location" data-agent-workspace-path aria-live="polite">
                <span class="agent-workspace-location__icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z"></path>
                  </svg>
                </span>
                <span class="agent-workspace-location__copy">
                  <strong>{{ workspaceName }}</strong>
                  <small>{{ workspaceStatus }}</small>
                </span>
              </div>

              <div class="agent-file-tree">
                <div class="agent-file-tree__label">
                  <span>已访问文件</span>
                  <span>{{ files.length }}</span>
                </div>
                <button
                  v-for="file in files"
                  :key="file.path"
                  class="agent-file-row"
                  :class="{ 'is-selected': selectedFile === file.path }"
                  type="button"
                  @click="selectFile(file.path)"
                >
                  <span class="agent-file-row__icon" :class="`is-${file.kind}`" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M6 3h8l4 4v14H6z"></path>
                      <path d="M14 3v5h5"></path>
                      <path d="M9 13h6M9 17h6"></path>
                    </svg>
                  </span>
                  <span class="agent-file-row__copy">
                    <strong>{{ file.name }}</strong>
                    <small>{{ file.meta }}</small>
                  </span>
                  <span v-if="selectedFile === file.path" class="agent-file-row__marker" aria-hidden="true"></span>
                </button>
                <p v-if="files.length === 0" class="agent-file-tree__empty">
                  {{ workspaceGrant ? 'Agent 访问文件后会显示在这里。' : '正在准备默认工作区。' }}
                </p>
              </div>

              <div class="agent-sidebar__footer">
                <span class="agent-sidebar__footer-dot" aria-hidden="true"></span>
                <span>{{ workspaceGrant ? '仅授权专用目录 · 自动续期' : '正在初始化工作区' }}</span>
              </div>
            </aside>

            <section class="agent-panel agent-prompt-panel" aria-label="提示词工作区">
              <div class="agent-panel__head">
                <div>
                  <p class="agent-panel__eyebrow">协作</p>
                  <h2>协作提示词</h2>
                </div>
                <span class="agent-model-badge">{{ modelLabel }}</span>
              </div>

              <label class="agent-prompt-editor">
                <span class="sr-only">协作提示词</span>
                <textarea v-model="promptText" rows="8" spellcheck="false"></textarea>
                <span class="agent-prompt-editor__meta">{{ promptText.length }} 字符</span>
              </label>

              <div class="agent-context-strip">
                <div class="agent-context-strip__label">
                  <span>上下文</span>
                </div>
                <span v-if="workspaceGrant" class="agent-context-chip">
                  <span>{{ selectedFileName }}</span>
                </span>
              </div>

              <div class="agent-prompt-footer">
                <span class="agent-prompt-footer__hint">{{ workspaceGrant ? '准备好后运行 Agent' : '正在准备默认工作区' }}</span>
                <button
                  v-if="runState === 'running'"
                  class="agent-text-button"
                  type="button"
                  @click="cancelAgentRun"
                >
                  取消运行
                </button>
                <button class="agent-run-button" type="button" :disabled="!canRun" @click="runAgent">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="m8 5 11 7-11 7V5Z"></path>
                  </svg>
                  {{ runState === 'running' ? '运行中' : '运行 Agent' }}
                </button>
              </div>
            </section>

            <aside class="agent-panel agent-run-panel" aria-label="运行状态">
              <div class="agent-panel__head">
                <div>
                  <p class="agent-panel__eyebrow">运行</p>
                  <h2>运行状态</h2>
                </div>
                <span class="agent-run-count">#{{ runIdShort }}</span>
              </div>

              <div class="agent-run-summary" :class="`is-${runState}`">
                <div>
                  <strong>{{ runStateLabel }}</strong>
                  <span>{{ runStateDetail }}</span>
                </div>
              </div>

              <ol class="agent-run-steps">
                <li v-for="step in runSteps" :key="step.key" :class="`is-${step.state}`">
                  <span class="agent-run-step__index">{{ step.index }}</span>
                  <span class="agent-run-step__copy">
                    <strong>{{ step.label }}</strong>
                    <small>{{ step.detail }}</small>
                  </span>
                  <span class="agent-run-step__state" aria-hidden="true"></span>
                </li>
              </ol>

              <div class="agent-output-panel">
                <div class="agent-output-panel__head">
                  <span>输出</span>
                  <span v-if="lastRunAt">{{ lastRunAt }}</span>
                </div>
                <p>{{ outputText }}</p>
                <dl v-if="runMetadata.length" class="agent-output-metadata">
                  <div v-for="item in runMetadata" :key="item.label">
                    <dt>{{ item.label }}</dt>
                    <dd :title="item.value">{{ item.value }}</dd>
                  </div>
                </dl>
              </div>
            </aside>
          </div>
        </div>
      </details>
    </template>
  </section>
</template>

<style scoped src="../modules/agent-console/styles/console.css"></style>
