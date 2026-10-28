import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const appRequire = createRequire(new URL('../../../apps/writing-vue/package.json', import.meta.url))
const ts = appRequire('typescript')
const source = readFileSync(new URL('../../../apps/writing-vue/src/modules/practice-reading/useReadingCoach.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText

// Loads the composable with a scripted `readingCoachApi.query`.
function coachWith(query) {
  const submission = { sessionId: 'attempt-1' }
  const module = { exports: {} }
  const api = {
    readingCoachApi: { query, listMessages: async () => ({ messages: [] }), listFeedback: async () => [] },
    readingSessionApi: {}
  }
  const vue = {
    ref: (value) => ({ value }),
    computed: (getter) => ({ get value() { return getter() } }),
    unref: (value) => value?.value ?? value
  }
  new Function('require', 'module', 'exports', compiled)(
    (name) => name === 'vue' ? vue : name === './api' ? api : appRequire(name),
    module, module.exports
  )
  return module.exports.useReadingCoach({ submissionSource: () => submission })
}

const userRow = { id: 'user-1', role: 'user', status: 'completed', content: 'Why?', sequence: 1 }
const answerRow = { id: 'assistant-1', role: 'assistant', status: 'completed', content: 'Check the qualifier.', sequence: 2 }

// The backend forwards only the learner-visible answer text, never JSON syntax.
test('streamed deltas show as a provisional answer until the validated reply replaces it', async () => {
  let coach
  const midStream = []
  coach = coachWith(async (_payload, _sessionId, options) => {
    options.onDelta('Check ')
    options.onDelta('the qualifier.')
    midStream.push(coach.coachTranscript.value.map((entry) => [entry.role, entry.content, entry.persisted]))
    return { threadId: 'thread-1', answer: 'Check the qualifier.', messages: [userRow, answerRow] }
  })
  coach.coachQuery.value = 'Why?'
  await coach.askCoach()
  assert.deepEqual(midStream, [[['assistant', 'Check the qualifier.', false]]])
  assert.deepEqual(coach.coachTranscript.value.map((entry) => [entry.id, entry.content, entry.persisted]), [
    ['user-1', 'Why?', true],
    ['assistant-1', 'Check the qualifier.', true]
  ])
})

test('a failed stream drops the provisional text and keeps the error path', async () => {
  const coach = coachWith(async (_payload, _sessionId, options) => {
    options.onDelta('Half')
    throw Object.assign(new Error('provider timeout'), { code: 'coach.provider_failed' })
  })
  coach.coachQuery.value = 'Why?'
  await coach.askCoach()
  const transcript = coach.coachTranscript.value
  assert.equal(transcript.some((entry) => entry.content === 'Half'), false)
  assert.equal(transcript.filter((entry) => entry.isError).length, 1)
})

test('a delta that arrives after the reply settled cannot re-add a bubble', async () => {
  let streamed
  const coach = coachWith(async (_payload, _sessionId, options) => {
    streamed = options.onDelta
    options.onDelta('Check ')
    return { threadId: 'thread-1', answer: 'Check the qualifier.', messages: [userRow, answerRow] }
  })
  coach.coachQuery.value = 'Why?'
  await coach.askCoach()
  const before = coach.coachTranscript.value.map((entry) => [entry.id, entry.content])
  streamed('late text')
  assert.deepEqual(coach.coachTranscript.value.map((entry) => [entry.id, entry.content]), before)
  assert.equal(coach.coachTranscript.value.some((entry) => entry.status === 'streaming'), false)
})

test('a reset mid-stream closes the stream: later deltas do not show, and the reply does not reopen the bubble', async () => {
  let streamed
  let finish
  const coach = coachWith(async (_payload, _sessionId, options) => {
    streamed = options.onDelta
    options.onDelta('Half ')
    await new Promise((resolve) => { finish = resolve })
    return { threadId: 'thread-1', answer: 'Check the qualifier.', messages: [userRow, answerRow] }
  })
  coach.coachQuery.value = 'Why?'
  const pending = coach.askCoach()
  assert.equal(coach.coachTranscript.value.some((entry) => entry.content === 'Half '), true)

  coach.resetReadingCoachState()
  assert.deepEqual(coach.coachTranscript.value, [])
  streamed('after reset')
  assert.deepEqual(coach.coachTranscript.value, [], 'a delta after reset must not re-add a bubble')

  finish()
  await pending
  assert.equal(coach.coachTranscript.value.some((entry) => entry.content === 'after reset'), false)
  assert.equal(coach.coachTranscript.value.some((entry) => entry.status === 'streaming'), false)
})

test('a truncated or over-long coach answer shows its own learner-facing message', async () => {
  const coach = coachWith(async () => {
    throw Object.assign(new Error('model output truncated at max_tokens'), { code: 'coach.output_truncated' })
  })
  coach.coachQuery.value = 'Why?'
  await coach.askCoach()
  assert.equal(coach.coachError.value, '阅读教练请求失败：回答过长，已被截断，请换个更具体的问题再试')

  const tooLong = coachWith(async () => {
    throw Object.assign(new Error('prompt exceeds model context'), { code: 'coach.context_exceeded' })
  })
  tooLong.coachQuery.value = 'Why?'
  await tooLong.askCoach()
  assert.match(tooLong.coachError.value, /上下文长度/)
})
