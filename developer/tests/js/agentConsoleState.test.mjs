import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { persistedPlanItems, formatStudyProbe, summarizeBackgroundJob, summarizeJournal, formatJournalDate } from '../../../apps/writing-vue/src/modules/agent-console/format.js'

const view = readFileSync(new URL('../../../apps/writing-vue/src/views/AgentConsolePage.vue', import.meta.url), 'utf8')
const script = view.split('<script setup>')[1].split('</script>')[0].replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm, '')
function consoleState(overrides = {}) {
  const defaults = {
    ref: value => ({ value }), computed: getter => ({ get value() { return getter() } }), onMounted: () => {},
    window: { localStorage: { getItem: () => '', setItem: () => {} }, confirm: () => true },
    persistedPlanItems, formatStudyProbe, summarizeBackgroundJob, summarizeJournal, formatJournalDate,
    agentRepository: {}, getMemoryCatalog: async () => ({ userId: 'local', entries: [] }),
    markStudyPlanItemDone: async () => {}, forgetMemory: async () => {}, archiveMemory: async () => {},
    recordMemoryFeedback: async () => {}, archiveStaleMemories: async () => {},
    getBackgroundJobStatus: async () => [], listAgentThreads: async () => [], listPendingApprovals: async () => [],
    getDailyJournal: async () => null, triggerDailyDream: async () => {}
  }
  const deps = { ...defaults, ...overrides }
  return new Function(...Object.keys(deps), `${script}
    return { generateStudyPlan, readStudyPlan, togglePlanItem, refreshMemoryCatalog, retryMemoryCatalog,
      refreshAfterMemoryMutation, forgetEntry, archiveEntry, submitMemoryFeedback,
      loadConsole, entries, preview, memoryCatalogStale, actionMessage, actionError, errorMessage,
      planItems, activePlanId, planDoneIds, planReadError, planReading, evidenceEntryId, evidenceState,
      readBackgroundJobs, jobs, jobsReading, jobsReadError, jobSummaries, runningDreams,
      loadJournal, switchJournalDate, journalDate, journals, journalReading, journalReadError, journalSummary, runDailyDream,
      get evidenceRequest() { return evidenceRequest } };
  `)(...Object.values(deps))
}
const snapshot = { plan: { id: 'plan-1' }, items: [{ id: 'spi-1', planId: 'plan-1', done: false }] }
const memory = { id: 'mem-1', value: { version: 1 } }
const catalog = { userId: 'local', entries: [{ id: 'mem-1', statement: '旧正文' }] }
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('created plan read failure has no proposal items, no undefined write, and read-only retry', async () => {
  let creates = 0, reads = 0
  const writes = []
  const ui = consoleState({ agentRepository: {
    runStudyPlanner: async () => { creates++; return { planId: 'plan-1', items: [{ itemId: 'proposal-1' }] } },
    getLatestStudyPlan: async () => { if (++reads === 1) throw new Error('offline'); return snapshot }
  }, markStudyPlanItemDone: async (...args) => writes.push(args) })
  await ui.generateStudyPlan()
  assert.equal(ui.activePlanId.value, 'plan-1')
  assert.deepEqual(ui.planItems.value, [])
  assert.match(ui.planReadError.value, /已创建，但读取失败/)
  assert.equal(ui.actionMessage.value, '')
  await ui.togglePlanItem({ itemId: 'proposal-1' })
  await ui.generateStudyPlan()
  assert.equal(creates, 1)
  assert.deepEqual(writes, [])
  await ui.readStudyPlan()
  assert.equal(creates, 1)
  assert.equal(ui.planReadError.value, '')
  await ui.togglePlanItem({ id: 'foreign' })
  await ui.togglePlanItem(ui.planItems.value[0])
  assert.deepEqual(writes, [['spi-1', true]])
})

test('snapshot contract rejects missing IDs, wrong plans and duplicates; empty persisted plan is valid', () => {
  for (const bad of [null, {}, { ...snapshot, items: null }, { ...snapshot, items: [{ itemId: 'x' }] },
    { ...snapshot, items: [{ id: ' ', planId: 'plan-1' }] },
    { ...snapshot, items: [{ id: 'spi-1', planId: 'other' }] },
    { ...snapshot, items: [snapshot.items[0], snapshot.items[0]] }]) {
    assert.throws(() => persistedPlanItems(bad, 'plan-1'))
  }
  assert.throws(() => persistedPlanItems(snapshot, 'new-plan'))
  assert.deepEqual(persistedPlanItems({ ...snapshot, items: [] }), [])
})

test('null/mismatched/malformed snapshots after creation stay retryable without recreating', async () => {
  for (const result of [null, { ...snapshot, plan: { id: 'other' } }, { ...snapshot, items: [{ itemId: 'x' }] }]) {
    const ui = consoleState({ agentRepository: {
      runStudyPlanner: async () => ({ planId: 'plan-1' }), getLatestStudyPlan: async () => result
    } })
    await ui.generateStudyPlan()
    assert.deepEqual(ui.planItems.value, [])
    assert.match(ui.planReadError.value, /已创建，但读取失败/)
  }
})

test('initial plan read failure is retryable and done write failure rolls back', async () => {
  let fail = true
  const ui = consoleState({ agentRepository: { getLatestStudyPlan: async () => {
    if (fail) throw new Error('offline'); return snapshot
  } }, markStudyPlanItemDone: async () => { throw new Error('write failed') } })
  await ui.loadConsole()
  assert.match(ui.planReadError.value, /计划读取失败/)
  fail = false
  await ui.readStudyPlan()
  await ui.togglePlanItem(ui.planItems.value[0])
  assert.equal(ui.planDoneIds.value.size, 0)
  assert.equal(ui.actionError.value, 'write failed')
})

test('late catalog success or error cannot overwrite a newer response or close its drawer', async () => {
  for (const fails of [false, true]) {
    const old = deferred(), fresh = deferred()
    let calls = 0
    const ui = consoleState({ getMemoryCatalog: () => (++calls === 1 ? old.promise : fresh.promise) })
    const first = ui.refreshMemoryCatalog(), second = ui.refreshMemoryCatalog()
    fresh.resolve({ userId: 'local', entries: [] })
    await second
    ui.evidenceEntryId.value = 'new-drawer'
    if (fails) old.reject(new Error('old error')); else old.resolve(catalog)
    assert.equal(await first, false)
    assert.deepEqual(ui.entries.value, [])
    assert.equal(ui.evidenceEntryId.value, 'new-drawer')
    assert.equal(ui.memoryCatalogStale.value, false)
  }
})

test('console reload follows latest persisted plan while failed created-plan retry stays pinned', async () => {
  let current = snapshot
  const ui = consoleState({ agentRepository: { getLatestStudyPlan: async () => current } })
  await ui.loadConsole()
  current = { plan: { id: 'plan-2' }, items: [{ id: 'spi-2', planId: 'plan-2', done: true }] }
  await ui.loadConsole()
  assert.equal(ui.activePlanId.value, 'plan-2')
  assert.deepEqual([...ui.planDoneIds.value], ['spi-2'])
  ui.planReadError.value = '已创建，但读取失败'
  current = snapshot
  await ui.loadConsole()
  assert.equal(ui.activePlanId.value, 'plan-2')
  assert.deepEqual(ui.planItems.value, [])
})

test('slow unrelated initial load cannot restore catalog error after successful retry', async () => {
  const jobs = deferred()
  let reads = 0
  const ui = consoleState({ agentRepository: { getLatestStudyPlan: async () => null },
    getBackgroundJobStatus: () => jobs.promise, getMemoryCatalog: async () => {
      if (++reads === 1) throw new Error('initial offline'); return catalog
    } })
  const initial = ui.loadConsole()
  await new Promise(resolve => setImmediate(resolve))
  await ui.retryMemoryCatalog()
  jobs.resolve([])
  await initial
  assert.equal(ui.errorMessage.value, '')
  assert.equal(ui.entries.value[0].value.statement, '旧正文')
})

test('forget invalidates reads before write and reads started during write, including initial console load', async () => {
  for (const initial of [false, true]) {
    const old = deferred(), during = deferred(), write = deferred()
    let calls = 0
    const ui = consoleState({ agentRepository: { getLatestStudyPlan: async () => null },
      getMemoryCatalog: () => (++calls === 1 ? old.promise : calls === 2 ? during.promise : Promise.resolve({ userId: 'local', entries: [] })),
      forgetMemory: () => write.promise })
    const first = initial ? ui.loadConsole() : ui.refreshMemoryCatalog()
    const forgetting = ui.forgetEntry(memory)
    old.resolve(catalog)
    await first
    assert.deepEqual(ui.entries.value, [])
    const middle = ui.refreshMemoryCatalog()
    write.resolve()
    await forgetting
    during.resolve(catalog)
    await middle
    assert.deepEqual(ui.entries.value, [])
    assert.match(ui.actionMessage.value, /已永久遗忘/)
  }
})

test('saved mutation with failed refresh clears body/evidence; retry reads only', async () => {
  let writes = 0, reads = 0
  const ui = consoleState({ forgetMemory: async () => { writes++ }, getMemoryCatalog: async () => {
    if (++reads === 1) throw new Error('offline'); return { userId: 'local', entries: [] }
  } })
  ui.entries.value = [memory]
  ui.evidenceEntryId.value = 'mem-1'
  await ui.forgetEntry(memory)
  assert.deepEqual(ui.entries.value, [])
  assert.equal(ui.evidenceEntryId.value, null)
  assert.equal(ui.memoryCatalogStale.value, true)
  assert.match(ui.actionError.value, /操作已保存/)
  await ui.retryMemoryCatalog()
  assert.equal(writes, 1)
  assert.equal(ui.memoryCatalogStale.value, false)
})

test('forget cancellation preserves body and does not write or invalidate a read', async () => {
  const pending = deferred()
  const ui = consoleState({ window: { localStorage: { getItem: () => '' }, confirm: () => false },
    forgetMemory: async () => assert.fail('cancelled'), getMemoryCatalog: () => pending.promise })
  const reading = ui.refreshMemoryCatalog()
  await ui.forgetEntry(memory)
  pending.resolve(catalog)
  assert.equal(await reading, true)
  assert.equal(ui.entries.value[0].value.statement, '旧正文')
})

test('archive and feedback also invalidate older reads', async () => {
  for (const action of ['archiveEntry', 'submitMemoryFeedback']) {
    const pending = deferred()
    let calls = 0
    const ui = consoleState({ getMemoryCatalog: () => ++calls === 1 ? pending.promise : Promise.resolve({ userId: 'local', entries: [] }) })
    const old = ui.refreshMemoryCatalog()
    await ui[action]({ ...memory, key: 'preference' }, 'accurate')
    pending.resolve(catalog)
    assert.equal(await old, false)
    assert.deepEqual(ui.entries.value, [])
  }
})

test('plan retry control only reads; legacy string and structured probes remain readable', () => {
  assert.match(view, /@click="readStudyPlan">重新读取计划/)
  assert.equal(formatStudyProbe('reading.tfng'), 'reading.tfng')
  assert.equal(formatStudyProbe({ skillKey: 'reading.tfng', probeKind: 'novel_item' }), 'reading.tfng · novel_item')
  assert.equal(formatStudyProbe(null), '待确认技能')
  assert.equal(formatStudyProbe({}), '待确认技能')
})

test('job status and attempts reflect the ledger; only running daily dreams light the card', async () => {
  const statuses = ['queued', 'waiting', 'running', 'completed', 'failed', 'interrupted', 'unknown']
  const ui = consoleState({ getBackgroundJobStatus: async () => statuses.map((status, i) => ({
    id: String(i), jobKind: 'daily_dream', status, attempts: i, maxAttempts: 7, lastError: i === 4 ? 'provider failed' : null
  })).concat({ id: 'journal', jobKind: 'daily_journal', status: 'running' }) })
  await ui.readBackgroundJobs()
  assert.deepEqual(ui.jobSummaries.value.map(row => row.statusLabel),
    ['等待中', '等待中', '运行中', '已完成', '失败', '已中断', '未知状态（unknown）', '运行中'])
  assert.equal(ui.runningDreams.value.length, 1)
  assert.equal(ui.jobSummaries.value[4].error, 'provider failed')
  assert.equal(ui.jobSummaries.value[4].attemptsLabel, '执行次数 4 / 7')
  assert.equal(summarizeBackgroundJob({ job_kind: 'daily_dream', status: 'failed', attempts: 0, max_attempts: 3, last_error: 'offline' }).error, 'offline')
})

test('job read failure and invalid response remain unavailable; retry is read only', async () => {
  for (const result of [null, {}]) {
    let reads = 0, writes = 0
    const ui = consoleState({ getBackgroundJobStatus: async () => {
      if (++reads === 1) throw new Error('offline')
      return reads === 2 ? result : []
    }, triggerDailyDream: async () => { writes++ } })
    await ui.readBackgroundJobs()
    assert.match(ui.jobsReadError.value, /offline/)
    assert.deepEqual(ui.jobs.value, [])
    await ui.readBackgroundJobs()
    assert.match(ui.jobsReadError.value, /响应无效/)
    await ui.readBackgroundJobs()
    assert.equal(ui.jobsReadError.value, '')
    assert.equal(ui.jobsReading.value, false)
    assert.equal(writes, 0)
  }
})

test('older job success/error cannot overwrite a newer read or end its loading', async () => {
  for (const fails of [false, true]) {
    const old = deferred(), fresh = deferred()
    let reads = 0
    const ui = consoleState({ getBackgroundJobStatus: () => ++reads === 1 ? old.promise : fresh.promise })
    const first = ui.readBackgroundJobs(), second = ui.readBackgroundJobs()
    if (fails) old.reject(new Error('old')); else old.resolve([{ id: 'old' }])
    await first
    assert.equal(ui.jobsReading.value, true)
    fresh.resolve([{ id: 'fresh', status: 'completed' }])
    await second
    assert.equal(ui.jobs.value[0].id, 'fresh')
    assert.equal(ui.jobsReadError.value, '')
  }
})

const dailyJournal = date => ({ journalDate: date, facts: { attemptsCount: 2 } })

test('closed-day selection reads the existing journal IPC and reports loading, error, empty separately', async () => {
  const calls = [], pending = deferred()
  let writes = 0
  const ui = consoleState({ getDailyJournal: query => { calls.push(query); return pending.promise },
    triggerDailyDream: async () => { writes++ } })
  const reading = ui.switchJournalDate('2026-09-30')
  assert.equal(ui.journalDate.value, '2026-09-30')
  assert.equal(ui.journalReading.value, true)
  assert.deepEqual(ui.journals.value, [])
  pending.resolve(dailyJournal('2026-09-30'))
  await reading
  assert.deepEqual(calls, [{ userId: 'local', journalDate: '2026-09-30' }])
  assert.equal(ui.journalSummary.value.dateLabel, '2026年9月30日')
  assert.match(ui.journalSummary.value.lede, /当日/)
  assert.equal(ui.journalReading.value, false)
  assert.equal(writes, 0)
  assert.match(view, /type="date"/)
  assert.match(view, /@click="loadJournal">重新读取日记/)
})

test('journal failure clears the old body; retry only reads, and null alone is healthy empty', async () => {
  let reads = 0, writes = 0
  const ui = consoleState({ getDailyJournal: async () => {
    if (++reads === 1) throw new Error('offline')
    return reads === 2 ? {} : reads === 3 ? dailyJournal('2000-01-01') : null
  }, triggerDailyDream: async () => { writes++ } })
  ui.journals.value = [dailyJournal(ui.journalDate.value)]
  await ui.loadJournal()
  assert.match(ui.journalReadError.value, /offline/)
  assert.equal(ui.journalSummary.value, null)
  for (let i = 0; i < 2; i++) {
    await ui.loadJournal()
    assert.match(ui.journalReadError.value, /响应无效或日期不匹配/)
  }
  await ui.loadJournal()
  assert.equal(ui.journalReadError.value, '')
  assert.deepEqual(ui.journals.value, [])
  assert.equal(writes, 0)
})

test('date switches and same-day rereads suppress older successes/errors, including A-B-A', async () => {
  for (const sameDate of [false, true]) {
    for (const fails of [false, true]) {
      const old = deferred(), middle = deferred(), fresh = deferred()
      let reads = 0
      const ui = consoleState({ getDailyJournal: () => [old, middle, fresh][reads++].promise })
      const first = ui.switchJournalDate('2026-09-29')
      const second = ui.switchJournalDate(sameDate ? '2026-09-29' : '2026-09-30')
      const third = ui.switchJournalDate('2026-09-29')
      if (fails) old.reject(new Error('old')); else old.resolve(dailyJournal('2026-09-29'))
      await first
      assert.equal(ui.journalReading.value, true)
      fresh.resolve(dailyJournal('2026-09-29'))
      await third
      middle.reject(new Error('middle'))
      await second
      assert.equal(ui.journalSummary.value.date, '2026-09-29')
      assert.equal(ui.journalReadError.value, '')
      assert.equal(ui.journalReading.value, false)
    }
  }
})

test('failed daily trigger refreshes failed job diagnostics and preserves selected journal day', async () => {
  let writes = 0
  const dates = []
  const ui = consoleState({ triggerDailyDream: async () => { writes++; throw new Error('dream failed') },
    getBackgroundJobStatus: async () => [{ id: 'dream', jobKind: 'daily_dream', status: 'failed', attempts: 3, maxAttempts: 3, lastError: 'dream failed' }],
    getDailyJournal: async query => { dates.push(query.journalDate); return null } })
  ui.journalDate.value = '2026-09-29'
  await ui.runDailyDream()
  assert.equal(writes, 1)
  assert.equal(ui.actionError.value, 'dream failed')
  assert.equal(ui.jobSummaries.value[0].status, 'failed')
  assert.equal(ui.runningDreams.value.length, 0)
  assert.deepEqual(dates, ['2026-09-29'])
})

test('initial console journal response cannot replace a later date selection', async () => {
  const initial = deferred()
  let reads = 0
  const ui = consoleState({ agentRepository: { getLatestStudyPlan: async () => null },
    getDailyJournal: query => ++reads === 1 ? initial.promise : Promise.resolve(dailyJournal(query.journalDate)) })
  const initialDate = ui.journalDate.value
  const loading = ui.loadConsole()
  await ui.switchJournalDate('2026-09-28')
  initial.resolve(dailyJournal(initialDate))
  await loading
  assert.equal(ui.journalSummary.value.date, '2026-09-28')
  assert.equal(ui.journalReadError.value, '')
  assert.equal(ui.journalReading.value, false)
})

test('the console no longer carries a dead explicit-preference writer', () => {
  // Learner preferences are written from the Notebook (LearnerPreferences.vue).
  assert.doesNotMatch(view, /putExplicitPreference|pinExplicitPreference/)
})
