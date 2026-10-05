import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

// The whole-attempt AI review is opt-in: submit and replay never start it; only
// the review chip / retry button does, and the host answers repeats from the
// stored review (see coach_canonical.rs: automatic_review_is_idempotent...).

const appRequire = createRequire(new URL('../../../apps/writing-vue/package.json', import.meta.url))
const ts = appRequire('typescript')
const read = (path) => readFileSync(new URL(`../../../apps/writing-vue/src/${path}`, import.meta.url), 'utf8')
const compiled = ts.transpileModule(read('modules/practice-reading/useReadingCoach.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText

function harness({ messages = [] } = {}) {
  const queries = []
  const api = {
    readingCoachApi: {
      listMessages: async () => ({ threadId: 'thread-1', messages }),
      query: async (payload) => {
        queries.push(payload)
        return { answer: 'AI review', assistantMessage: { content: 'AI review' }, threadId: 'thread-1', messages: [] }
      }
    },
    readingSessionApi: {}
  }
  const vue = {
    ref: (value) => ({ value }),
    computed: (getter) => ({ get value() { return getter() } }),
    unref: (value) => value?.value ?? value
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled)(
    (name) => name === 'vue' ? vue : name === './api' ? api : appRequire(name),
    module, module.exports
  )
  const submission = { sessionId: 'attempt-1', examId: 'exam-1' }
  const coach = module.exports.useReadingCoach({ submissionSource: () => submission })
  return { coach, queries, submission }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

test('submit and replay code paths contain no automatic AI review trigger', () => {
  assert.ok(!read('modules/practice-reading/useReadingModeFlow.ts').includes('runAutomaticReviewCoach'))
  const page = read('views/PracticeReadingPage.vue')
  assert.ok(!page.includes('queueAutomaticReviewRefresh'))
  assert.ok(!read('modules/practice-reading/useReadingCoach.ts').includes('queueAutomaticReviewRefresh'))
  // The only entries: the review chip and the failed-review retry button.
  assert.ok(page.includes('@retry-review="runAutomaticReviewCoach"'))
  assert.ok(page.includes('@quick-action="runCoachQuickAction"'))
})

test('opening a replay without a stored review makes no model request', async () => {
  const { coach, queries, submission } = harness()
  coach.hydrateReadingCoachFromSubmission(submission, { open: true, pendingIfMissing: true })
  await settle()
  assert.equal(queries.length, 0)
  assert.equal(coach.llmReviewStatus.value, 'idle')
  assert.equal(coach.coachResponse.value, null)
})

test('the review chip is the only thing that requests the AI review', async () => {
  const { coach, queries, submission } = harness()
  coach.hydrateReadingCoachFromSubmission(submission, { open: true, pendingIfMissing: true })
  await settle()
  await coach.runCoachQuickAction('review')
  assert.equal(queries.length, 1)
  assert.equal(queries[0].action, 'review_set')
  assert.equal(coach.llmReviewStatus.value, 'success')
})

test('a stored review is shown on replay without any request', async () => {
  const review = { id: 'u1', role: 'user', status: 'completed', content: '复盘', structuredPayload: { action: 'review_set' } }
  const answer = {
    id: 'a1', role: 'assistant', status: 'completed', content: 'Stored answer',
    structuredPayload: { userMessageId: 'u1', answer: 'Stored answer' }
  }
  const { coach, queries, submission } = harness({ messages: [review, answer] })
  coach.hydrateReadingCoachFromSubmission(submission, { open: true, pendingIfMissing: true })
  await settle()
  assert.equal(queries.length, 0)
  assert.equal(coach.llmReviewStatus.value, 'success')
  assert.equal(coach.coachResponse.value.answer, 'Stored answer')
  assert.equal(coach.coachTranscript.value.at(-1).content, 'Stored answer')
})
