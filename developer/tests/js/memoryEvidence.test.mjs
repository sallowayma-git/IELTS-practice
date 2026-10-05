import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { resolveMemoryEvidence, memoryEvidenceRoute } from '../../../apps/writing-vue/src/modules/agent-console/format.js'

const observation = {
  id: 'obs-1', userId: 'local', observationType: 'question_outcome',
  observedAt: '2026-10-01', scopeKey: 'reading.tfng', valueText: '判断题改答后仍错误',
  evidence: [{ eventId: 'ev-1', evidenceRole: 'support', ordinal: 0 }]
}
const event = {
  id: 'ev-1', userId: 'local', activity: 'reading', assetId: 'asset-1',
  attemptId: 'attempt-1', questionId: 'q-1', eventType: 'reading_question_outcome',
  sourceKind: 'attempt', sourceId: 'attempt-1', occurredAt: '2026-10-01',
  payload: { isCorrect: false, changeCount: 2 }
}
function readers(observations = [observation], events = [event]) {
  return {
    observations: async () => ({ observations, missingIds: [], freshness: 'fresh' }),
    events: async () => ({ events, missingIds: [] })
  }
}

test('exact memory -> observation -> event -> attempt chain preserves original and source', async () => {
  const result = await resolveMemoryEvidence(['obs-1'], readers())
  assert.equal(result.items[0].original, observation.valueText)
  assert.match(result.items[0].events[0].original, /"changeCount": 2/)
  assert.match(result.items[0].events[0].source, /support.*attempt-1/)
  assert.match(result.items[0].events[0].location, /q-1/)
  assert.deepEqual(result.items[0].events[0].route, {
    name: 'PracticeReadingReview', params: { assetId: 'asset-1', sessionId: 'attempt-1' }
  })
})

test('unrequested observations and unlinked events never become evidence', async () => {
  const result = await resolveMemoryEvidence(['obs-1'], readers(
    [observation, { ...observation, id: 'unrelated', evidence: [{ eventId: 'bad' }] }],
    [event, { ...event, id: 'bad' }]
  ))
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].events.length, 1)
  assert.match(result.items[0].events[0].id, /^ev-1:/)
})

test('foreign-user observations/events are not shown; missing chains are disclosed', async () => {
  const result = await resolveMemoryEvidence(['obs-1', 'foreign'], readers(
    [observation, { ...observation, id: 'foreign', userId: 'other' }], [{ ...event, userId: 'other' }]
  ))
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].events.length, 0)
  assert.equal(result.warnings.length, 2)
})

test('reads are bounded and deduplicated with explicit truncation', async () => {
  const ids = Array.from({ length: 25 }, (_, i) => `obs-${i}`)
  let requestedObservations, requestedEvents
  const result = await resolveMemoryEvidence([...ids, ...ids], {
    observations: async (requested) => {
      requestedObservations = requested
      return { observations: requested.map((id) => ({ ...observation, id,
        evidence: Array.from({ length: 60 }, (_, i) => ({ eventId: `ev-${i}`, ordinal: i, evidenceRole: 'support' }))
      })), missingIds: [] }
    },
    events: async (requested) => {
      requestedEvents = requested
      return { events: [], missingIds: requested }
    }
  })
  assert.equal(requestedObservations.length, 20)
  assert.equal(requestedEvents.length, 50)
  assert.equal(result.truncated, true)
  assert.ok(result.warnings.some((text) => text.includes('不是全部证据')))
})

test('successful unlinked memory is empty without making a host request', async () => {
  const fail = async () => { throw new Error('must not call') }
  assert.deepEqual(await resolveMemoryEvidence([], { observations: fail, events: fail }), {
    items: [], warnings: [], truncated: false
  })
})

test('missing observation is an incomplete chain, not healthy empty evidence', async () => {
  const result = await resolveMemoryEvidence(['missing'], readers([], []))
  assert.equal(result.items.length, 0)
  assert.match(result.warnings[0], /无法核验/)
})

test('observation/event read failures and malformed responses reject instead of reporting empty', async () => {
  await assert.rejects(resolveMemoryEvidence(['obs-1'], { ...readers(), observations: async () => { throw new Error('offline') } }), /offline/)
  await assert.rejects(resolveMemoryEvidence(['obs-1'], { ...readers(), events: async () => { throw new Error('event offline') } }), /event offline/)
  await assert.rejects(resolveMemoryEvidence(['obs-1'], { ...readers(), observations: async () => null }), /响应无效/)
  await assert.rejects(resolveMemoryEvidence(['obs-1'], { ...readers(), events: async () => ({}) }), /响应无效/)
  await assert.rejects(resolveMemoryEvidence(['obs-1'], readers([{ ...observation, evidence: null }])), /引用无效/)
  await assert.rejects(resolveMemoryEvidence(['obs-1'], readers([{ ...observation, evidence: [{ eventId: '' }] }])), /引用无效/)
})

test('stale projections and long original records are disclosed', async () => {
  const mock = readers([{ ...observation, valueText: '原'.repeat(5000) }])
  const read = mock.observations
  mock.observations = async () => ({ ...await read(), freshness: 'stale' })
  const result = await resolveMemoryEvidence(['obs-1'], mock)
  assert.match(result.warnings[0], /尚未更新/)
  assert.match(result.items[0].original, /已截断/)
})

test('practice navigation needs an explicit attempt and supported activity', () => {
  assert.equal(memoryEvidenceRoute({ ...event, attemptId: null }), null)
  assert.equal(memoryEvidenceRoute({ ...event, activity: 'other' }), null)
  assert.deepEqual(memoryEvidenceRoute({ ...event, activity: 'writing' }), { name: 'Result', params: { sessionId: 'attempt-1' } })
  assert.equal(memoryEvidenceRoute({ ...event, activity: 'writing', attemptId: '../bad' }), null)
})

const view = readFileSync(new URL('../../../apps/writing-vue/src/views/AgentConsolePage.vue', import.meta.url), 'utf8')
function drawer(getMemoryEvidence) {
  const functions = view.slice(view.indexOf('async function toggleEvidence('), view.indexOf('function approvalCopy('))
  return new Function('getMemoryEvidence', `
    const evidenceEntryId = { value: null }, evidenceState = { value: {} }, preview = { value: { userId: 'local' } };
    let evidenceRequest = 0;
    const memoryId = entry => entry.id;
    const readMemoryField = (entry, key, fallback) => entry.value[key] ?? fallback;
    ${functions}
    return { toggleEvidence, loadEvidence, closeEvidence, evidenceEntryId, evidenceState };
  `)(getMemoryEvidence)
}
const entry = { id: 'mem-1', value: { evidenceObservationIds: ['obs-1'] } }

test('drawer exposes loading, failure, retry and healthy empty states', async () => {
  let complete
  const ui = drawer(() => new Promise((resolve, reject) => { complete = { resolve, reject } }))
  const pending = ui.toggleEvidence(entry)
  assert.equal(ui.evidenceState.value.status, 'loading')
  complete.reject(new Error('IPC unavailable'))
  await pending
  assert.equal(ui.evidenceState.value.status, 'error')
  assert.equal(ui.evidenceState.value.error, 'IPC unavailable')
  const retry = ui.loadEvidence(entry)
  complete.resolve({ items: [], warnings: [] })
  await retry
  assert.equal(ui.evidenceState.value.status, 'ready')
})

test('late evidence response cannot overwrite another memory or a closed drawer', async () => {
  const resolves = []
  const ui = drawer(() => new Promise((resolve) => resolves.push(resolve)))
  const first = ui.toggleEvidence(entry)
  const second = ui.toggleEvidence({ ...entry, id: 'mem-2' })
  resolves[1]({ items: [{ id: 'second' }], warnings: [] })
  await second
  resolves[0]({ items: [{ id: 'first' }], warnings: [] })
  await first
  assert.equal(ui.evidenceState.value.items[0].id, 'second')
  const third = ui.loadEvidence({ ...entry, id: 'mem-2' })
  let focused = false
  ui.closeEvidence({ currentTarget: { closest: () => ({ querySelector: () => ({ focus: () => { focused = true } }) }) } })
  resolves[2]({ items: [{ id: 'closed' }], warnings: [] })
  await third
  assert.equal(ui.evidenceEntryId.value, null)
  assert.equal(focused, true)
  assert.notEqual(ui.evidenceState.value.items[0]?.id, 'closed')
})

test('drawer has native keyboard controls, labelled region and explicit state branches', () => {
  assert.match(view, /:aria-expanded="evidenceEntryId === memoryId\(entry\)"/)
  assert.match(view, /:aria-controls="`evidence-\$\{memoryId\(entry\)\}`"/)
  assert.match(view, /role="region"/)
  assert.match(view, /tabindex="0" @keydown\.esc\.stop="closeEvidence"/)
  assert.match(view, /<router-link v-if="event.route" :to="event.route"/)
  assert.match(view, /status === 'error'/)
  assert.match(view, /!evidenceState.items.length && !evidenceState.warnings.length/)
})

test('repository uses existing host commands and propagates command errors', async () => {
  const source = readFileSync(new URL('../../../apps/writing-vue/src/api/learning-repository.js', import.meta.url), 'utf8')
  const bridge = `export async function invokeCommand(command, args) { return globalThis.__memoryEvidenceInvoke(command, args) }; export function unwrapCommandResponse(response) { if (!response.ok) throw new Error(response.error.message); return response.data }`
  const bridgeUrl = `data:text/javascript;base64,${Buffer.from(bridge).toString('base64')}`
  const formatUrl = new URL('../../../apps/writing-vue/src/modules/agent-console/format.js', import.meta.url).href
  const loadable = source.replace('@/api/tauri-bridge.js', bridgeUrl).replace('@/modules/agent-console/format.js', formatUrl)
  const api = await import(`data:text/javascript;base64,${Buffer.from(loadable).toString('base64')}`)
  const calls = []
  try {
    globalThis.__memoryEvidenceInvoke = (command, args) => {
      calls.push({ command, args })
      return { ok: true, data: command === 'learning_observations_get_by_ids'
        ? { observations: [observation], missingIds: [] } : { events: [event], missingIds: [] } }
    }
    await api.getMemoryEvidence(['obs-1', 'obs-1'])
    assert.deepEqual(calls, [
      { command: 'learning_observations_get_by_ids', args: { ids: ['obs-1'] } },
      { command: 'learning_events_get_evidence_by_ids', args: { ids: ['ev-1'] } }
    ])
    await assert.rejects(api.getObservationsByIds(Array.from({ length: 51 }, (_, i) => `obs-${i}`)), /1–50/)
    globalThis.__memoryEvidenceInvoke = () => ({ ok: false, error: { message: 'host failed' } })
    await assert.rejects(api.getMemoryEvidence(['obs-1']), /host failed/)
  } finally {
    delete globalThis.__memoryEvidenceInvoke
  }
})
