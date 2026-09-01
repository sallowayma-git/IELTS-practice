<script setup>
import { computed, onMounted, ref } from 'vue'
import agentRepository from '@/api/agent-repository.js'
import {
  listAgentThreads,
  listPendingApprovals,
  decideApproval,
  markStudyPlanItemDone
} from '@/api/agent-thread-repository.js'
import {
  archiveStaleMemories,
  forgetMemory,
  getBackgroundJobStatus,
  getDailyJournal,
  getMemoryCatalog,
  putExplicitPreference,
  recordMemoryFeedback,
  triggerDailyDream
} from '@/api/memory-repository.js'
import {
  formatFeedbackKind,
  formatMemoryStatement,
  summarizeApproval,
  summarizeEvidence,
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
const journals = ref([])
const threads = ref([])
const approvals = ref([])
const planItems = ref([])
const activePlanId = ref('')
const planDoneIds = ref(new Set())
const lastVisitAt = ref(readLastVisitAt())
const evidenceEntryId = ref(null)
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

const delta = ref({ newWeakPoints: [], improved: [], reappeared: [], newPatterns: [], newPreferences: [] })

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

const dreamJobs = computed(() => jobs.value.filter((j) => String(j.jobKind || '').includes('dream')))

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
    let catalogError = null
    const [catalog, jobList, threadList, approvalList] = await Promise.all([
      // A failed catalog read must surface as a real error, not render as a
      // healthy-looking empty console.
      getMemoryCatalog({ includeArchived: true }).catch((error) => {
        catalogError = error
        return null
      }),
      getBackgroundJobStatus().catch(() => []),
      listAgentThreads(20).catch(() => []),
      listPendingApprovals(20).catch(() => [])
    ])
    if (catalogError && !errorMessage.value) {
      errorMessage.value = catalogError?.message || '记忆目录读取失败，请稍后重试。'
    }
    const allEntries = (catalog?.entries || []).map(catalogToEntry).filter(Boolean)
    preview.value = catalog
      ? { userId: catalog.userId, entries: allEntries, truncated: catalog.truncated }
      : null
    entries.value = allEntries
    jobs.value = jobList || []
    threads.value = threadList || []
    approvals.value = approvalList || []
    delta.value = computeDelta(allEntries, lastVisitAt.value)
    writeLastVisitAt(new Date().toISOString())
    lastVisitAt.value = readLastVisitAt()

    // Latest plan wins; read the real snapshot — plan IDs are not thread IDs.
    const planSnapshot = await agentRepository.getLatestStudyPlan('local').catch(() => null)
    if (planSnapshot?.plan?.id) {
      activePlanId.value = planSnapshot.plan.id
      planItems.value = planSnapshot.items || []
      planDoneIds.value = new Set(planItems.value.filter((i) => i.done).map((i) => i.id))
    } else {
      activePlanId.value = ''
      planItems.value = []
      planDoneIds.value = new Set()
    }
    await loadJournal().catch(() => {})
  } catch (error) {
    errorMessage.value = error?.message || '智能体控制台暂时不可用'
  } finally {
    loading.value = false
  }
}

async function loadJournal() {
  const today = new Date().toISOString().slice(0, 10)
  try {
    const journal = await getDailyJournal({ userId: 'local', journalDate: today })
    journals.value = journal ? [journal] : []
  } catch {
    journals.value = []
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
    actionMessage.value = '每日整理已触发，稍后会生成候选更新。'
    jobs.value = await getBackgroundJobStatus().catch(() => jobs.value)
    await loadJournal().catch(() => {})
  } catch (error) {
    actionError.value = error?.message || '每日整理触发失败'
  }
}

async function runArchiveStale() {
  actionMessage.value = ''
  actionError.value = ''
  try {
    await archiveStaleMemories()
    actionMessage.value = '已运行过期归档。过期记忆会收进「已归档」，不会删除。'
    await loadConsole()
  } catch (error) {
    actionError.value = error?.message || '归档扫描失败'
  }
}

// ---------- plan items ----------

const planGenerating = ref(false)

async function generateStudyPlan() {
  if (planGenerating.value) return
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
    const items = Array.isArray(proposal?.items) ? proposal.items : []
    if (!String(proposal?.planId || '').trim()) {
      actionError.value = proposal?.fallbackReason || '规划器没有产出可保存的计划。'
      return
    }
    // Re-read the persisted snapshot: the host assigned canonical item ids.
    const snapshot = await agentRepository.getLatestStudyPlan('local').catch(() => null)
    activePlanId.value = String(proposal.planId)
    planItems.value = snapshot?.items || items
    planDoneIds.value = new Set(planItems.value.filter((i) => i.done).map((i) => i.id))
    actionMessage.value = `已生成今日计划（${planItems.value.length} 项）。`
  } catch (error) {
    actionError.value = error?.message || '生成学习计划失败'
  } finally {
    planGenerating.value = false
  }
}

async function togglePlanItem(item) {
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
  actionError.value = ''
  try {
    await recordMemoryFeedback(id, kind)
    actionMessage.value = `已记下：这条记忆${formatFeedbackKind(kind)}。系统会据此调整可信度。`
  } catch (error) {
    actionError.value = error?.message || '反馈提交失败'
  } finally {
    setBusy(id, false)
  }
}

async function forgetEntry(entry) {
  const id = memoryId(entry)
  if (!id) { actionError.value = '该条目没有稳定 ID，无法归档。'; return }
  setBusy(id, true)
  actionError.value = ''
  try {
    await forgetMemory({ memoryId: id, expectedVersion: memoryVersion(entry), reason: 'user_agent_console_archive' })
    entries.value = entries.value.filter((e) => memoryId(e) !== id)
    actionMessage.value = '已归档该记忆。需要时可以在「已归档」里查看。'
  } catch (error) {
    actionError.value = error?.message || '归档失败'
  } finally {
    setBusy(id, false)
  }
}

async function pinExplicitPreference(entry) {
  const key = readMemoryField(entry, 'preferenceKey', '') || readMemoryField(entry, 'preference_key', '') || String(entry && entry.key || '')
  if (!key) { actionError.value = '该条目没有偏好键，无法固定。'; return }
  const value = readMemoryField(entry, 'value', null)
  setBusy(key, true)
  actionError.value = ''
  try {
    await putExplicitPreference({ preferenceKey: key, scope: memoryScope(entry) || 'global', value: value ?? true })
    actionMessage.value = `已固定这条偏好。`
  } catch (error) {
    actionError.value = error?.message || '固定偏好失败'
  } finally {
    setBusy(key, false)
  }
}

// ---------- Evidence Drawer (M9-04, ported verbatim) ----------

function toggleEvidence(entry) {
  const id = memoryId(entry)
  evidenceEntryId.value = evidenceEntryId.value === id ? null : id
}

function evidenceFor(entry) {
  const supportIds = readMemoryField(entry, 'supportIds', []) || readMemoryField(entry, 'support_ids', []) || []
  const observationIds = readMemoryField(entry, 'evidenceObservationIds', []) || readMemoryField(entry, 'evidence_observation_ids', []) || []
  const assetIds = readMemoryField(entry, 'assetIds', []) || readMemoryField(entry, 'asset_ids', []) || []
  const links = readMemoryField(entry, 'links', []) || []
  return {
    supportIds: Array.isArray(supportIds) ? supportIds : [],
    observationIds: Array.isArray(observationIds) ? observationIds : [],
    assetIds: Array.isArray(assetIds) ? assetIds : [],
    links: Array.isArray(links) ? links : []
  }
}

function evidenceCopy(entry) {
  return summarizeEvidence(evidenceFor(entry))
}

function approvalCopy(approval) {
  return summarizeApproval(approval)
}

// ════════════════════════════════════════════════════════════════════
// Advanced workspace (zone 4): ported from AgentWorkspacePage verbatim.
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
const outputText = ref('选择本地工作区后，运行结果会出现在这里。')
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
  return path.split(/[\\/]/).filter(Boolean).pop() || '选择本地工作区'
})
const workspaceStatus = computed(() => workspaceGrant.value?.displayPath || '仅授权所选目录')
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
    detail: workspaceGrant.value ? workspaceName.value : '尚未选择',
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

async function pickWorkspace() {
  if (workspaceLocked.value) return
  workspaceBusy.value = true
  try {
    const grant = await agentRepository.pickWorkspace()
    if (!grant) return
    workspaceGrant.value = grant
    selectedFile.value = ''
    lastRun.value = null
    runState.value = 'idle'
    outputText.value = '工作区已授权，可以开始运行。'
    lastRunAt.value = ''
  } catch (error) {
    showError(error)
  } finally {
    workspaceBusy.value = false
  }
}

function resetWorkspace() {
  if (workspaceLocked.value) return
  workspaceGrant.value = null
  selectedFile.value = ''
  lastRun.value = null
  runState.value = 'idle'
  outputText.value = '选择本地工作区后，运行结果会出现在这里。'
  lastRunAt.value = ''
}

async function runAgent() {
  if (!canRun.value) return
  runState.value = 'running'
  lastRun.value = null
  activeRunId.value = crypto.randomUUID()
  outputText.value = '正在执行模型与工作区工具…'
  lastRunAt.value = ''
  try {
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

onMounted(loadConsole)
</script>

<template>
  <section class="agent-page agent-console-page" data-agent-console>
    <header class="agent-page-header">
      <div class="agent-page-header__copy">
        <p class="agent-page-header__eyebrow">学习闭环</p>
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
            <strong>{{ heartbeat.jobs }}</strong>
            <span>后台任务</span>
          </div>
          <div class="agent-heartbeat-card" :class="{ 'is-dreaming': dreamJobs.length }">
            <strong>{{ dreamJobs.length }}</strong>
            <span>整理任务</span>
          </div>
        </div>
        <div v-if="journalSummary" class="agent-journal-card">
          <div class="agent-journal-card__head">
            <h2>今日整理</h2>
            <span>{{ journalSummary.dateLabel }}</span>
          </div>
          <p class="agent-journal-card__lede">{{ journalSummary.lede }}</p>
          <dl class="agent-journal-stats">
            <div v-for="row in journalSummary.rows" :key="row.label">
              <dt>{{ row.label }}</dt>
              <dd>{{ row.value }}</dd>
            </div>
          </dl>
          <ul v-if="journalSummary.unresolved.length" class="agent-journal-unresolved">
            <li v-for="(q, i) in journalSummary.unresolved" :key="i">{{ q }}</li>
          </ul>
          <button class="agent-text-button" type="button" @click="runDailyDream">重新整理今天</button>
        </div>
        <div v-else class="agent-journal-card agent-journal-card--empty">
          <p>今天还没有学习日记。完成一次阅读或写作练习后，系统会自动生成。</p>
          <button class="agent-text-button" type="button" @click="runDailyDream">手动触发每日整理</button>
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
            :disabled="planGenerating"
            @click="generateStudyPlan"
          >
            {{ planGenerating ? '生成中…' : '生成计划' }}
          </button>
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
                aria-label="标记计划项完成"
                @change="togglePlanItem(item)"
              />
              <span aria-hidden="true"></span>
            </label>
            <div class="agent-plan-item__copy">
              <strong>{{ item.skillProbe }}</strong>
              <small>{{ item.whyText }}</small>
            </div>
            <span class="agent-plan-item__minutes">约 {{ item.estimatedMinutes }} 分钟</span>
          </li>
        </ul>
        <p v-else class="agent-empty-hint">
          学习计划会根据你的复习需求自动生成。点击「生成计划」，让规划器依据最近的技能状态安排今天练什么。
        </p>
      </section>

      <!-- Zone 3: evolution timeline -->
      <section class="agent-evolution-zone" aria-label="理解演化">
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
                <button class="agent-text-button" type="button" @click="toggleEvidence(entry)">
                  {{ evidenceEntryId === memoryId(entry) ? '收起证据' : '查看证据' }}
                </button>
                <button
                  v-if="activeTab !== 'archived'"
                  class="agent-text-button"
                  type="button"
                  :disabled="feedbackInFlight.has(memoryId(entry))"
                  @click="submitMemoryFeedback(entry, 'helpful')"
                >有帮助</button>
                <button
                  v-if="activeTab !== 'archived'"
                  class="agent-text-button"
                  type="button"
                  :disabled="feedbackInFlight.has(memoryId(entry))"
                  @click="submitMemoryFeedback(entry, 'not_helpful')"
                >没帮助</button>
                <button
                  v-if="classifySource(entry) !== 'user_explicit'"
                  class="agent-text-button"
                  type="button"
                  :disabled="feedbackInFlight.has(memoryId(entry))"
                  @click="forgetEntry(entry)"
                >归档</button>
              </div>
              <div v-if="evidenceEntryId === memoryId(entry)" class="agent-evidence-drawer">
                <p v-for="(line, i) in evidenceCopy(entry).lines" :key="i">{{ line }}</p>
                <small>{{ evidenceCopy(entry).hint }}</small>
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
                <button
                  class="agent-icon-button"
                  type="button"
                  aria-label="清除工作区选择"
                  title="清除工作区选择"
                  :disabled="workspaceLocked"
                  @click="resetWorkspace"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M3 12a9 9 0 0 1 15.3-6.4L21 8"></path>
                    <path d="M21 3v5h-5"></path>
                    <path d="M21 12a9 9 0 0 1-15.3 6.4L3 16"></path>
                    <path d="M3 21v-5h5"></path>
                  </svg>
                </button>
              </div>

              <button class="agent-workspace-select" type="button" :disabled="workspaceLocked" @click="pickWorkspace">
                <span class="agent-workspace-select__icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z"></path>
                  </svg>
                </span>
                <span class="agent-workspace-select__copy">
                  <strong>{{ workspaceName }}</strong>
                  <small>{{ workspaceStatus }}</small>
                </span>
                <svg class="agent-workspace-select__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m9 18 6-6-6-6"></path>
                </svg>
              </button>

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
                  {{ workspaceGrant ? 'Agent 访问文件后会显示在这里。' : '选择工作区后开始运行。' }}
                </p>
              </div>

              <div class="agent-sidebar__footer">
                <span class="agent-sidebar__footer-dot" aria-hidden="true"></span>
                <span>{{ workspaceGrant ? '短期本地授权' : '尚未授权工作区' }}</span>
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
                <button v-if="workspaceGrant" class="agent-context-chip" type="button" :disabled="workspaceLocked" @click="pickWorkspace">
                  <span>{{ selectedFileName }}</span>
                  <span aria-hidden="true">&#8599;</span>
                </button>
              </div>

              <div class="agent-prompt-footer">
                <span class="agent-prompt-footer__hint">{{ workspaceGrant ? '准备好后运行 Agent' : '先选择一个本地工作区' }}</span>
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
