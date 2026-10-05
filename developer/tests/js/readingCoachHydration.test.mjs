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

function coachFor(messages, review = null, listMessages = async () => ({ threadId: 'thread-1', messages })) {
  const submission = { sessionId: 'attempt-1', ...(review ? { singleAttemptAnalysisLlm: review } : {}) }
  const module = { exports: {} }
  const api = {
    readingCoachApi: { listMessages },
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
  const coach = module.exports.useReadingCoach({ submissionSource: () => submission })
  coach.hydrateReadingCoachFromSubmission(submission, { pendingIfMissing: true })
  return new Promise((resolve) => setImmediate(() => resolve(coach)))
}

function practiceCoachFor(pages) {
  const source = readFileSync(new URL('../../../apps/writing-vue/src/api/practice-client.js', import.meta.url), 'utf8')
  const section = source.slice(source.indexOf('async function readCoachMessages('), source.indexOf('export const practiceMigration'))
    .replace('export const practiceCoach =', 'const practiceCoach =')
  const calls = []
  const listCoachMessages = async (_threadId, cursor, limit) => {
    calls.push([cursor, limit])
    return { items: pages.shift() || [] }
  }
  const practiceCoach = new Function('listCoachMessages', 'ensureCoachThread', 'invokeCommand', 'unwrapCommandResponse',
    `${section}\nreturn practiceCoach`)(
    listCoachMessages,
    async () => ({ thread: { id: 'thread-1' } }),
    async () => ({}),
    () => ({ assistantMessage: { content: 'reply' } })
  )
  return { practiceCoach, calls }
}

test('paginated history reaches review user 101 and assistant 102', async () => {
  const first = Array.from({ length: 100 }, (_, index) => ({
    ...user(`u${index + 1}`, 'chat'), sequence: index + 1
  }))
  const tail = [{ ...user('review-101'), sequence: 101 }, { ...assistant('answer-102', 'review-101'), sequence: 102 }]
  const { practiceCoach, calls } = practiceCoachFor([first, tail])
  const { messages } = await practiceCoach.listMessages('reading', 'attempt-1')
  assert.equal(messages.length, 102)
  assert.deepEqual(calls, [[0, 100], [100, 100]])
  const coach = await coachFor(messages)
  assert.equal(coach.llmReviewStatus.value, 'success')
  assert.equal(coach.coachTranscript.value.at(-1).id, 'answer-102')
})

test('query response also reloads messages beyond the first page', async () => {
  const first = Array.from({ length: 100 }, (_, index) => ({ sequence: index + 1, id: `m${index + 1}` }))
  const { practiceCoach, calls } = practiceCoachFor([first, [{ sequence: 101, id: 'latest' }]])
  const result = await practiceCoach.query('reading', { content: '复盘' }, 'attempt-1')
  assert.equal(result.messages.at(-1).id, 'latest')
  assert.deepEqual(calls, [[0, 100], [100, 100]])
})

test('latest failed review after page boundary stays failed despite older success', async () => {
  const first = Array.from({ length: 98 }, (_, index) => ({ ...user(`chat-${index}`, 'chat'), sequence: index + 1 }))
  first.push({ ...user('old-review'), sequence: 99 }, { ...assistant('old-answer', 'old-review'), sequence: 100 })
  const tail = [{ ...user('new-review'), sequence: 101 }, { ...assistant('failed-102', 'new-review', 'failed'), sequence: 102 }]
  const { practiceCoach } = practiceCoachFor([first, tail])
  const coach = await coachFor((await practiceCoach.listMessages('reading', 'attempt-1')).messages)
  assert.equal(coach.llmReviewStatus.value, 'failed')
  assert.match(coach.llmReviewMessage.value, /provider unavailable/)
})

test('nonadvancing cursor rejects repeated pages', async () => {
  const page = Array.from({ length: 100 }, (_, index) => ({ sequence: index + 1 }))
  const { practiceCoach, calls } = practiceCoachFor([page, page])
  await assert.rejects(practiceCoach.listMessages('reading', 'attempt-1'), /cursor did not advance/)
  assert.equal(calls.length, 2)
})

test('late history response for same submission cannot overwrite newer hydration', async () => {
  let resolveOld
  const oldResponse = new Promise((resolve) => { resolveOld = resolve })
  let calls = 0
  const coach = await coachFor([], null, () => ++calls === 1
    ? oldResponse
    : Promise.resolve({ threadId: 'new-thread', messages: [user('new-review'), assistant('new-failure', 'new-review', 'failed')] }))
  coach.hydrateReadingCoachFromSubmission({ sessionId: 'attempt-1' }, { pendingIfMissing: true })
  await new Promise((resolve) => setImmediate(resolve))
  resolveOld({ threadId: 'old-thread', messages: [user('old-review'), assistant('old-success', 'old-review')] })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(coach.llmReviewStatus.value, 'failed')
  assert.equal(coach.coachTranscript.value.at(-1).id, 'new-failure')
})

test('legacy assistant without status still hydrates when bound to review user', async () => {
  const coach = await coachFor([user('review'), { ...assistant('legacy-answer', 'review'), status: undefined }])
  assert.equal(coach.llmReviewStatus.value, 'success')
})

const user = (id, action = 'review_set') => ({ id, role: 'user', status: 'completed', content: '复盘', structuredPayload: { action } })
const assistant = (id, userMessageId, status = 'completed') => ({
  id, role: status === 'failed' ? 'system' : 'assistant', status,
  content: status === 'failed' ? 'provider unavailable' : 'Evidence answer',
  structuredPayload: userMessageId ? { userMessageId } : {}
})

test('completed assistant bound to latest review user hydrates success', async () => {
  const coach = await coachFor([user('u1'), assistant('a1', 'u1')])
  assert.equal(coach.llmReviewStatus.value, 'success')
  assert.equal(coach.coachTranscript.value[1].role, 'assistant')
})

test('failed receipt bound to latest review user hydrates failure', async () => {
  const coach = await coachFor([user('u1'), assistant('f1', 'u1', 'failed')])
  assert.equal(coach.llmReviewStatus.value, 'failed')
  assert.match(coach.llmReviewMessage.value, /provider unavailable/)
})

test('old unbound assistant, wrong user and chat result cannot complete review', async () => {
  for (const messages of [
    [user('u1'), assistant('old', null)],
    [user('u1'), assistant('other', 'u2')],
    [user('u1'), user('u2', 'chat'), assistant('chat', 'u2')],
    [user('u1'), assistant('running', 'u1', 'running')]
  ]) {
    const coach = await coachFor(messages)
    assert.equal(coach.llmReviewStatus.value, 'idle')
    assert.equal(coach.llmReviewMessage.value, 'AI 复盘待补全')
  }
})

test('latest review user governs hydration; older success cannot cover new pending or failure', async () => {
  const pending = await coachFor([user('u1'), assistant('a1', 'u1'), user('u2')])
  assert.equal(pending.llmReviewStatus.value, 'idle')
  const failed = await coachFor([user('u1'), assistant('a1', 'u1'), user('u2'), assistant('f2', 'u2', 'failed')])
  assert.equal(failed.llmReviewStatus.value, 'failed')
})
