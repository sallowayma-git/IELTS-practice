import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

// Coach panel lifecycle: what the learner sees while a request runs, how a
// failure leaves a way forward, and that drafts/threads never bleed together.

const appRequire = createRequire(new URL('../../../apps/writing-vue/package.json', import.meta.url))
const ts = appRequire('typescript')
const readApp = (path) => readFileSync(new URL(`../../../apps/writing-vue/src/${path}`, import.meta.url), 'utf8')
const compiled = ts.transpileModule(readApp('modules/practice-reading/useReadingCoach.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText

const settle = () => new Promise((resolve) => setImmediate(resolve))
const failure = (code, message = code) => Object.assign(new Error(message), { code })
const userRow = (id, content) => ({ id, role: 'user', status: 'completed', content })
const answerRow = (id, content = 'answer') => ({ id, role: 'assistant', status: 'completed', content })

// One composable instance per call, sharing the module (and its draft store)
// the way two page instances in one app do. `state.submission` is swappable.
function createModule(api) {
  const vue = {
    ref: (value) => ({ value }),
    computed: (getter) => ({ get value() { return getter() } }),
    unref: (value) => value?.value ?? value
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled)(
    (name) => name === 'vue' ? vue : name === './api' ? { readingCoachApi: api, readingSessionApi: {} } : appRequire(name),
    module, module.exports
  )
  return module.exports
}

function harness({ query, listMessages, selected = null } = {}) {
  const state = { submission: { sessionId: 'attempt-1', examId: 'exam-1' } }
  const api = {
    query: query || (async () => ({ threadId: 't1', answer: 'answer', messages: [userRow('u1', 'q'), answerRow('a1')] })),
    listMessages: listMessages || (async () => ({ threadId: 't1', messages: [] })),
    listFeedback: async () => []
  }
  const exports = createModule(api)
  const coach = exports.useReadingCoach({
    submissionSource: () => state.submission,
    readSelectedContext: () => selected
  })
  return { coach, state, exports }
}

test('the question shows as soon as it is sent, and the stored rows replace it', async () => {
  let release
  const { coach } = harness({
    query: async () => {
      await new Promise((resolve) => { release = resolve })
      return { threadId: 't1', answer: 'answer', messages: [userRow('u1', 'Why?'), answerRow('a1')] }
    }
  })
  coach.coachQuery.value = 'Why?'
  const pending = coach.askCoach()
  assert.deepEqual(coach.coachTranscript.value.map((entry) => [entry.role, entry.content, entry.persisted]), [['user', 'Why?', false]])
  assert.equal(coach.coachQuery.value, '', 'the box is emptied on send')
  release()
  await pending
  assert.deepEqual(coach.coachTranscript.value.map((entry) => entry.id), ['u1', 'a1'])
})

test('a failed question goes back in the box and offers a retry, not a dead end', async () => {
  let attempts = 0
  const { coach } = harness({
    query: async () => {
      attempts += 1
      if (attempts === 1) throw failure('coach.provider_failed', 'provider timeout')
      return { threadId: 't1', answer: 'answer', messages: [userRow('u1', 'Why?'), answerRow('a1')] }
    }
  })
  coach.coachQuery.value = 'Why?'
  await coach.askCoach()
  assert.equal(coach.coachQuery.value, 'Why?')
  assert.equal(coach.coachRetryKind.value, 'plain')
  assert.equal(coach.coachTranscript.value.at(-1).isError, true)

  await coach.retryCoachQuery('same')
  assert.equal(attempts, 2)
  assert.equal(coach.coachQuery.value, '', 'retrying consumes the restored draft')
  assert.equal(coach.coachRetryKind.value, '')
  assert.deepEqual(coach.coachTranscript.value.map((entry) => entry.id), ['u1', 'a1'])
})

test('a typed draft is not overwritten by a failed send', async () => {
  const { coach } = harness({ query: async () => { throw failure('coach.provider_failed') } })
  coach.coachQuery.value = 'first'
  const pending = coach.askCoach()
  coach.coachQuery.value = 'second thought'
  await pending
  assert.equal(coach.coachQuery.value, 'second thought')
})

test('truncated output offers a short retry that asks for a brief answer once', async () => {
  const queries = []
  const { coach } = harness({
    query: async (payload) => {
      queries.push(payload.content)
      throw failure('coach.output_truncated')
    }
  })
  coach.coachQuery.value = 'Explain Q7'
  await coach.askCoach()
  assert.equal(coach.coachRetryKind.value, 'truncated')
  await coach.retryCoachQuery('short')
  await coach.retryCoachQuery('short')
  const hint = '（请用不超过 5 句话简要回答）'
  assert.deepEqual(queries, ['Explain Q7', `Explain Q7${hint}`, `Explain Q7${hint}`])
})

test('context overflow offers a compact retry: clipped selection, slim attempt context', async () => {
  const payloads = []
  const selected = { text: 'x'.repeat(900), scope: 'passage', questionNumbers: ['7'] }
  const { coach, state } = harness({
    selected,
    query: async (payload) => {
      payloads.push(payload)
      throw failure('coach.context_exceeded')
    }
  })
  state.submission = {
    sessionId: 'attempt-1',
    answerComparison: { q7: { questionId: 'q7', displayLabel: '7', isCorrect: false, userAnswer: 'A' } },
    questionTimelineLite: [{ q: 7, ms: 1000 }],
    analysisSignals: { weak: ['tfng'] },
    markedQuestions: ['q7'],
    questionTypePerformance: { tfng: { total: 4 } }
  }
  coach.coachQuery.value = 'Why?'
  await coach.askCoach()
  assert.equal(coach.coachRetryKind.value, 'context')
  await coach.retryCoachQuery('compact')

  const [full, compact] = payloads
  assert.equal(full.selectedText.length, 900)
  assert.equal(full.attemptContext.questionTimelineLite.length, 1)
  assert.equal(compact.selectedText.length, 200)
  assert.deepEqual(compact.attemptContext.questionTimelineLite, [])
  assert.deepEqual(compact.attemptContext.markedQuestions, [])
  assert.equal(compact.attemptContext.analysisSignals, null)
  assert.deepEqual(compact.attemptContext.wrongQuestions, ['7'], 'what to talk about survives the slimming')
})

test('a failed review offers a retry that re-runs the review', async () => {
  const actions = []
  const { coach } = harness({
    query: async (payload) => {
      actions.push(payload.action)
      if (actions.length === 1) throw failure('coach.provider_failed')
      return { threadId: 't1', answer: 'review', assistantMessage: { content: 'review' }, messages: [answerRow('a1', 'review')] }
    }
  })
  await coach.runCoachQuickAction('review')
  assert.equal(coach.llmReviewStatus.value, 'failed')
  assert.equal(coach.coachRetryKind.value, 'plain')
  await coach.retryCoachQuery('same')
  assert.deepEqual(actions, ['review_set', 'review_set'])
  assert.equal(coach.llmReviewStatus.value, 'success')
})

test('a running review blocks a second request instead of racing it on the same thread', async () => {
  let release
  const queries = []
  const { coach } = harness({
    query: async (payload) => {
      queries.push(payload.action)
      await new Promise((resolve) => { release = resolve })
      return { threadId: 't1', answer: 'ok', assistantMessage: { content: 'ok' }, messages: [answerRow('a1', 'ok')] }
    }
  })
  const review = coach.runCoachQuickAction('review')
  assert.equal(coach.coachLoading.value, true)
  coach.coachQuery.value = 'Why?'
  assert.equal(coach.canAskCoach.value, false)
  await coach.runCoachQuickAction('hint')
  await coach.askCoach()
  assert.deepEqual(queries, ['review_set'])
  release()
  await review
  assert.equal(coach.coachLoading.value, false)
})

test('a question sent while the history loads keeps its pending bubble', async () => {
  let finishHistory
  let finishQuery
  const { coach, state } = harness({
    listMessages: () => new Promise((resolve) => { finishHistory = () => resolve({ threadId: 't1', messages: [userRow('old-u', 'earlier'), answerRow('old-a', 'earlier answer')] }) }),
    query: () => new Promise((resolve) => { finishQuery = () => resolve({ threadId: 't1', answer: 'new', messages: [userRow('old-u', 'earlier'), answerRow('old-a', 'earlier answer'), userRow('u2', 'Why?'), answerRow('a2', 'new')] }) })
  })
  coach.hydrateReadingCoachFromSubmission(state.submission)
  coach.coachQuery.value = 'Why?'
  const pending = coach.askCoach()
  finishHistory()
  await settle()
  assert.deepEqual(coach.coachTranscript.value.map((entry) => entry.content), ['earlier', 'earlier answer', 'Why?'])
  finishQuery()
  await pending
  assert.deepEqual(coach.coachTranscript.value.map((entry) => entry.id), ['old-u', 'old-a', 'u2', 'a2'])
})

test('drafts belong to their thread: no leak across attempts, restored on return', () => {
  const { coach, state } = harness()
  coach.hydrateReadingCoachFromSubmission(state.submission)
  coach.coachQuery.value = 'draft for A'

  coach.resetReadingCoachState()
  assert.equal(coach.coachQuery.value, '', 'reset leaves no draft behind')
  state.submission = { sessionId: 'attempt-2' }
  coach.hydrateReadingCoachFromSubmission(state.submission)
  assert.equal(coach.coachQuery.value, '', 'attempt B does not see the draft of A')
  coach.coachQuery.value = 'draft for B'

  coach.resetReadingCoachState()
  state.submission = { sessionId: 'attempt-1' }
  coach.hydrateReadingCoachFromSubmission(state.submission)
  assert.equal(coach.coachQuery.value, 'draft for A')
})

test('drafts survive the page being rebuilt for another route', () => {
  const api = { listMessages: async () => ({ messages: [] }), listFeedback: async () => [], query: async () => ({}) }
  const exports = createModule(api)
  const submission = { sessionId: 'attempt-1' }
  const first = exports.useReadingCoach({ submissionSource: () => submission })
  first.hydrateReadingCoachFromSubmission(submission)
  first.coachQuery.value = 'kept'
  first.resetReadingCoachState() // what the page does when it unmounts

  const second = exports.useReadingCoach({ submissionSource: () => submission })
  second.hydrateReadingCoachFromSubmission(submission)
  assert.equal(second.coachQuery.value, 'kept')
})

test('a history load failure is shown with a way to reload, and reloading clears it', async () => {
  let fail = true
  const { coach, state } = harness({
    listMessages: async () => {
      if (fail) throw failure('db.error', 'database is locked')
      return { threadId: 't1', messages: [userRow('u1', 'q'), answerRow('a1')] }
    }
  })
  coach.hydrateReadingCoachFromSubmission(state.submission)
  await settle()
  assert.equal(coach.coachHistoryFailed.value, true)
  assert.match(coach.coachNotice.value, /对话记录加载失败/)
  fail = false
  coach.reloadCoachHistory()
  await settle()
  assert.equal(coach.coachHistoryFailed.value, false)
  assert.equal(coach.coachNotice.value, '')
  assert.equal(coach.coachTranscript.value.length, 2)
})

test('asking about a selection with nothing selected says so', async () => {
  const { coach } = harness()
  await coach.runCoachSelectionAction('explain_selection')
  assert.equal(coach.coachNotice.value, '请先选中题干或原文片段。')
})

test('leaving the page (reset) drops the open stream and any pending bubble', async () => {
  let streamed
  let release
  const { coach } = harness({
    query: async (_payload, _sessionId, options) => {
      streamed = options.onDelta
      options.onDelta('half')
      await new Promise((resolve) => { release = resolve })
      return { threadId: 't1', answer: 'late', messages: [userRow('u1', 'Why?'), answerRow('a1', 'late')] }
    }
  })
  coach.coachQuery.value = 'Why?'
  const pending = coach.askCoach()
  coach.resetReadingCoachState()
  streamed('more')
  release()
  await pending
  assert.deepEqual(coach.coachTranscript.value, [])
  assert.equal(coach.coachLoading.value, false)
})
