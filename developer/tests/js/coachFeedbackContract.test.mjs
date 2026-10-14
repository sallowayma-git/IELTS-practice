import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

// Coach feedback / re-ask contract: the TS wire values and command shapes must
// match crates/ielts-domain/src/coach_feedback.rs exactly (serde snake_case
// enum, camelCase deny_unknown_fields commands), and the reading coach panel
// only sends feedback for persisted assistant messages and links re-asks only
// for explicit re-asks.

const appRequire = createRequire(new URL('../../../apps/writing-vue/package.json', import.meta.url))
const ts = appRequire('typescript')
const readRepo = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')
const readApp = (path) => readRepo(`apps/writing-vue/src/${path}`)
const domain = readRepo('crates/ielts-domain/src/coach_feedback.rs')

function rustEnumWireValues(name) {
  const body = domain.match(new RegExp(`pub enum ${name}\\s*\\{([^}]*)\\}`))
  assert.ok(body, `enum ${name} not found`)
  const variants = body[1].match(/\b[A-Z][A-Za-z]+\b/g)
  return variants.map((variant) => variant.replace(/(?<!^)([A-Z])/g, '_$1').toLowerCase())
}

function rustCommandKeys(name) {
  const body = domain.match(new RegExp(`pub struct ${name}\\s*\\{([^}]*)\\}`))
  assert.ok(body, `struct ${name} not found`)
  const fields = [...body[1].matchAll(/pub (\w+):\s*(Option<)?/g)]
  return fields.map(([, field, optional]) => ({
    key: field.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
    optional: Boolean(optional)
  }))
}

function loadMemoryRepository() {
  const source = readApp('api/memory-repository.js')
    .replace(/^import .*$/m, '')
    .replace(/^export default .*$/m, '')
    .replace(/^export (async function|function|const) /gm, '$1 ')
  const calls = []
  const invokeCommand = async (command, args) => {
    calls.push({ command, args })
    return { ok: true }
  }
  const exported = new Function('invokeCommand', 'unwrapCommandResponse',
    `${source}\nreturn { COACH_FEEDBACK_KINDS, recordCoachFeedback, recordCoachReaskLink }`)(
    invokeCommand, (response) => response
  )
  return { ...exported, calls }
}

test('TS coach feedback kinds equal the Rust CoachFeedbackKind wire values', () => {
  const rust = rustEnumWireValues('CoachFeedbackKind')
  // as_str must agree with serde snake_case for every variant.
  for (const value of rust) assert.ok(domain.includes(`=> "${value}"`), `as_str missing ${value}`)
  const { COACH_FEEDBACK_KINDS } = loadMemoryRepository()
  assert.deepEqual([...COACH_FEEDBACK_KINDS].sort(), [...rust].sort())
  const dts = readApp('api/memory-repository.d.ts')
  const union = dts.match(/export type CoachFeedbackKind =([^]*?)\r?\n\r?\n/)
  assert.ok(union, 'CoachFeedbackKind union missing from d.ts')
  assert.deepEqual([...union[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1]).sort(), [...rust].sort())
})

test('reading coach panel only offers Rust feedback kinds', () => {
  const rust = new Set(rustEnumWireValues('CoachFeedbackKind'))
  const coachSource = readApp('modules/practice-reading/useReadingCoach.ts')
  const block = coachSource.match(/READING_COACH_FEEDBACK_OPTIONS = \[([^]*?)\] as const/)
  assert.ok(block)
  const kinds = [...block[1].matchAll(/kind: '([a-z_]+)'/g)].map((match) => match[1])
  assert.ok(kinds.length >= 2)
  for (const kind of kinds) assert.ok(rust.has(kind), `${kind} is not a CoachFeedbackKind`)
})

test('wrapper commands carry exactly the Rust command struct keys', async () => {
  const repo = loadMemoryRepository()
  await repo.recordCoachFeedback('cmsg-1', 'thumbs_up')
  await repo.recordCoachReaskLink('cmsg-a', 'cmsg-u')
  const [feedback, reask] = repo.calls
  assert.equal(feedback.command, 'coach_record_feedback')
  assert.deepEqual(Object.keys(feedback.args), ['command'])
  const feedbackKeys = rustCommandKeys('RecordCoachFeedbackCommand')
  assert.deepEqual(Object.keys(feedback.args.command).sort(),
    feedbackKeys.filter((field) => !field.optional).map((field) => field.key).sort())
  assert.deepEqual(feedback.args.command, { userId: 'local', coachMessageId: 'cmsg-1', feedbackKind: 'thumbs_up' })

  assert.equal(reask.command, 'coach_record_reask_link')
  assert.deepEqual(Object.keys(reask.args), ['command'])
  assert.deepEqual(Object.keys(reask.args.command).sort(),
    rustCommandKeys('RecordReaskLinkCommand').map((field) => field.key).sort())
  assert.deepEqual(reask.args.command, { userId: 'local', parentAssistantMessageId: 'cmsg-a', newUserMessageId: 'cmsg-u' })

  // Tauri command parameter names must match the wrapper argument key.
  const host = readRepo('src-tauri/src/commands/coach_feedback.rs')
  assert.match(host, /pub fn coach_record_feedback\([^)]*\bcommand: RecordCoachFeedbackCommand/)
  assert.match(host, /pub fn coach_record_reask_link\([^)]*\bcommand: RecordReaskLinkCommand/)
})

test('wrapper rejects unknown kinds and empty ids before invoking', async () => {
  const repo = loadMemoryRepository()
  await assert.rejects(repo.recordCoachFeedback('cmsg-1', 'satisfaction'), /unknown coach feedback kind/)
  await assert.rejects(repo.recordCoachFeedback(' ', 'thumbs_up'), /coachMessageId is required/)
  await assert.rejects(repo.recordCoachReaskLink('cmsg-a', ''), /newUserMessageId is required/)
  assert.equal(repo.calls.length, 0)
})

// --- reading coach composable behaviour ---

const compiled = ts.transpileModule(readApp('modules/practice-reading/useReadingCoach.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText

const settle = () => new Promise((resolve) => setImmediate(resolve))

function harness({ messages, feedbackFails = false, reaskFails = false } = {}) {
  const feedback = []
  const reasks = []
  const queries = []
  let transcript = messages
  const api = {
    readingCoachApi: {
      listMessages: async () => ({ threadId: 'thread-1', messages: transcript }),
      query: async (payload) => {
        queries.push(payload)
        const userId = `u-new-${queries.length}`
        transcript = [
          ...transcript,
          { id: userId, role: 'user', status: 'completed', content: payload.content },
          { id: `a-new-${queries.length}`, role: 'assistant', status: 'completed', content: 'answer' }
        ]
        return { threadId: 'thread-1', userMessage: { id: userId }, assistantMessage: { content: 'answer' }, answer: 'answer', messages: transcript }
      },
      recordFeedback: async (messageId, kind) => {
        feedback.push([messageId, kind])
        if (feedbackFails) throw { code: 'validation', message: 'coach message not found' }
        return { id: 'cfb-1' }
      },
      recordReaskLink: async (parent, child) => {
        reasks.push([parent, child])
        if (reaskFails) throw { code: 'validation', message: 're-ask requires assistant parent' }
        return {}
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
  coach.hydrateReadingCoachFromSubmission(submission)
  return { coach, feedback, reasks, queries, module: module.exports }
}

const baseMessages = [
  { id: 'u1', role: 'user', status: 'completed', content: '这题怎么定位？' },
  { id: 'a1', role: 'assistant', status: 'completed', content: '先找关键词', structuredPayload: { followUps: ['那第 5 题呢？'] } },
  { id: 's1', role: 'system', status: 'completed', content: 'system note' },
  { id: 'f1', role: 'system', status: 'failed', content: 'provider unavailable' }
]

test('only persisted completed assistant messages are feedback-eligible', async () => {
  const { coach, module } = harness({ messages: baseMessages })
  await settle()
  const eligible = coach.coachTranscript.value.filter(module.isFeedbackEligible).map((entry) => entry.id)
  assert.deepEqual(eligible, ['a1'])
  assert.equal(module.isFeedbackEligible({ id: 'coach-error-1', role: 'assistant', status: 'failed', isError: true, persisted: false }), false)
})

test('feedback is optimistic, sent once per message, and locked after save', async () => {
  const { coach, feedback } = harness({ messages: baseMessages })
  await settle()
  const pending = coach.submitCoachFeedback('a1', 'thumbs_up')
  assert.deepEqual(coach.coachFeedback.value.a1, { kind: 'thumbs_up', status: 'saving' })
  await pending
  assert.deepEqual(coach.coachFeedback.value.a1, { kind: 'thumbs_up', status: 'saved' })
  await coach.submitCoachFeedback('a1', 'incorrect')
  await coach.submitCoachFeedback('u1', 'thumbs_up')
  await coach.submitCoachFeedback('a1-missing', 'thumbs_up')
  await coach.submitCoachFeedback('s1', 'thumbs_up')
  assert.deepEqual(feedback, [['a1', 'thumbs_up']])
  assert.equal(coach.coachError.value, '')
})

test('failed feedback clears the selection quietly and allows a retry', async () => {
  const run = harness({ messages: baseMessages, feedbackFails: true })
  await settle()
  await run.coach.submitCoachFeedback('a1', 'thumbs_down')
  assert.deepEqual(run.coach.coachFeedback.value.a1, { kind: null, status: 'failed' })
  assert.equal(run.coach.coachError.value, '')
  await run.coach.submitCoachFeedback('a1', 'thumbs_up')
  assert.equal(run.feedback.length, 2)
})

test('follow-up chip links the offering answer to the new user message', async () => {
  const { coach, reasks, queries } = harness({ messages: baseMessages })
  await settle()
  assert.deepEqual(coach.coachFollowUps.value, ['那第 5 题呢？'])
  await coach.askCoachFollowUp('那第 5 题呢？')
  await settle()
  assert.equal(queries[0].promptKind, 'followup')
  assert.deepEqual(reasks, [['a1', 'u-new-1']])
})

test('re-ask button resends and links to that answer; a typed question is not linked', async () => {
  const { coach, reasks, queries } = harness({ messages: baseMessages })
  await settle()
  await coach.reaskCoachMessage('a1')
  await settle()
  assert.equal(queries[0].promptKind, 'reask')
  assert.deepEqual(reasks, [['a1', 'u-new-1']])
  coach.coachQuery.value = '第 7 题为什么选 B？'
  await coach.askCoach()
  await settle()
  assert.equal(queries.length, 2)
  assert.equal(reasks.length, 1)
  await coach.reaskCoachMessage('u1')
  assert.equal(queries.length, 2)
})

test('a failed re-ask link never breaks the chat', async () => {
  const { coach, reasks } = harness({ messages: baseMessages, reaskFails: true })
  await settle()
  const response = await coach.reaskCoachMessage('a1')
  await settle()
  assert.equal(response, undefined)
  assert.equal(reasks.length, 1)
  assert.equal(coach.coachError.value, '')
  assert.equal(coach.coachTranscript.value.at(-1).id, 'a-new-1')
})

test('reset clears per-message feedback state', async () => {
  const { coach } = harness({ messages: baseMessages })
  await settle()
  await coach.submitCoachFeedback('a1', 'thumbs_up')
  coach.resetReadingCoachState()
  assert.deepEqual(coach.coachFeedback.value, {})
})

test('panel renders feedback hooks and the page wires the events', () => {
  const panel = readApp('modules/practice-reading/components/ReadingCoachPanel.vue')
  for (const hook of ['data-reading-coach-feedback', 'data-reading-coach-feedback-kind', 'data-reading-coach-feedback-reask', 'data-reading-coach-feedback-state']) {
    assert.ok(panel.includes(hook), hook)
  }
  assert.ok(panel.includes('isFeedbackEligible(entry)'))
  const page = readApp('views/PracticeReadingPage.vue')
  assert.ok(page.includes(':coach-feedback="coachFeedback"'))
  assert.ok(page.includes('@feedback="submitCoachFeedback($event.messageId, $event.kind)"'))
  assert.ok(page.includes('@reask="reaskCoachMessage"'))
})
