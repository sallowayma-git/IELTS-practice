import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

// Coach preference cards ("要记住这个学习偏好吗？") and the feedback entry points
// under an answer: when a card shows, what confirm/dismiss do with each host
// error code, how the state follows the stored history, and which feedback
// kinds the learner can reach. Composable behaviour is run for real (TypeScript
// transpiled, API stubbed); the panel and styles are checked statically.

const appRequire = createRequire(new URL('../../../apps/writing-vue/package.json', import.meta.url))
const ts = appRequire('typescript')
// The Windows runner checks sources out with CRLF; the markup assertions below are written with LF.
const readRepo = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const readApp = (path) => readRepo(`apps/writing-vue/src/${path}`)

const compiled = ts.transpileModule(readApp('modules/practice-reading/useReadingCoach.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText

const settle = () => new Promise((resolve) => setImmediate(resolve))

function error(code, message = code) {
  return Object.assign(new Error(message), { code })
}

// `cardResult` / `dismissResult` decide what the host answers; a function is
// called per request, so a test can fail once and then succeed.
function harness({ messages, savedFeedback = [], confirm, dismiss, feedbackFails = [] } = {}) {
  const calls = { confirm: [], dismiss: [], feedback: [] }
  const gates = []
  let transcript = messages
  const answerWith = async (handler, fallback, ...args) => {
    const result = typeof handler === 'function' ? await handler(...args) : handler
    return result === undefined ? fallback : result
  }
  const api = {
    readingCoachApi: {
      listMessages: async () => ({ threadId: 'thread-1', messages: transcript }),
      listFeedback: async () => savedFeedback,
      query: async () => ({ threadId: 'thread-1', messages: transcript, answer: 'ok' }),
      recordFeedback: async (messageId, kind) => {
        calls.feedback.push([messageId, kind])
        if (feedbackFails.includes(kind)) throw error('validation')
        return { id: 'cfb', coachMessageId: messageId, feedbackKind: kind }
      },
      recordReaskLink: async () => ({}),
      confirmMemoryCard: async (...args) => {
        calls.confirm.push(args)
        return answerWith(confirm, { memoryId: 'mem-1' }, ...args)
      },
      dismissMemoryCard: async (...args) => {
        calls.dismiss.push(args)
        return answerWith(dismiss, null, ...args)
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
  return {
    coach, calls, gates, module: module.exports, api,
    setMessages(next) { transcript = next },
    rehydrate() { coach.hydrateReadingCoachFromSubmission(submission) }
  }
}

const card = (noteIndex = 0, text = '判断题上先给例子再讲证据') => ({ noteIndex, text })
const user = (id) => ({ id, role: 'user', status: 'completed', content: `question ${id}` })
const answer = (id, payload = {}) => ({ id, role: 'assistant', status: 'completed', content: `answer ${id}`, structuredPayload: payload })

const open = (id, extra = {}) => answer(id, { teachingNotes: [{ text: 'n' }], memoryCard: card(), ...extra })

async function ready(options) {
  const run = harness(options)
  await settle()
  await settle()
  return run
}

const views = (run) => run.coach.coachMemoryCards.value

// --- when a card shows ---

test('a card shows for a completed answer with a memoryCard and no memoryCardState', async () => {
  const run = await ready({ messages: [user('u1'), open('a1')] })
  assert.deepEqual(Object.keys(views(run)), ['a1'])
  assert.deepEqual(views(run).a1, {
    messageId: 'a1', noteIndex: 0, text: '判断题上先给例子再讲证据',
    state: 'pending', savedText: '', busy: false, error: ''
  })
})

test('no memoryCard, a malformed one, or a card on a non-answer shows nothing', async () => {
  const run = await ready({
    messages: [
      user('u1'),
      answer('a1', { strategyId: 'concise_direct_v1' }),
      answer('a2', { memoryCard: { noteIndex: 0, text: '   ' } }),
      answer('a3', { memoryCard: { noteIndex: -1, text: 'x' } }),
      answer('a4', { memoryCard: { noteIndex: 1.5, text: 'x' } }),
      answer('a5', { memoryCard: { noteIndex: '0', text: 'x' } }),
      answer('a6', { memoryCard: 'text' }),
      { ...open('a7'), status: 'failed' },
      { ...open('u8'), role: 'user' }
    ]
  })
  assert.deepEqual(views(run), {})
})

test('memoryCardState decides the card: confirmed is a receipt, dismissed is gone', async () => {
  const run = await ready({
    messages: [
      user('u1'), open('a1', { memoryCardState: 'confirmed' }),
      user('u2'), open('a2', { memoryCardState: 'dismissed' }),
      user('u3'), open('a3', { memoryCardState: 'pending' })
    ]
  })
  assert.deepEqual(Object.keys(views(run)), ['a1', 'a3'])
  assert.equal(views(run).a1.state, 'confirmed')
  assert.equal(views(run).a1.savedText, '', 'after a reload the stored wording is not guessed')
  assert.equal(views(run).a3.state, 'pending', 'an unknown state is not a decision')
})

test('only the newest card keeps its buttons; confirmed receipts are unaffected', async () => {
  const run = await ready({
    messages: [
      user('u1'), open('a1'),
      user('u2'), open('a2', { memoryCardState: 'confirmed' }),
      user('u3'), open('a3')
    ]
  })
  // a1 folded away by the newer cards; a2 stays as a receipt; a3 is the one that asks.
  assert.deepEqual(Object.keys(views(run)), ['a2', 'a3'])
  assert.deepEqual([views(run).a2.state, views(run).a3.state], ['confirmed', 'pending'])
})

test('a superseded card stays folded even after the newer card is dismissed', async () => {
  const run = await ready({ messages: [user('u1'), open('a1'), user('u2'), open('a2')] })
  assert.deepEqual(Object.keys(views(run)), ['a2'])
  await run.coach.dismissCoachMemoryCard('a2')
  assert.deepEqual(views(run), {}, 'a1 does not come back')
  run.setMessages([user('u1'), open('a1'), user('u2'), open('a2', { memoryCardState: 'dismissed' })])
  run.coach.resetReadingCoachState()
  run.rehydrate()
  await settle()
  await settle()
  assert.deepEqual(views(run), {}, 'nor after a reload')
})

test('a new card folds the previous one away', async () => {
  const run = await ready({ messages: [user('u1'), open('a1')] })
  assert.deepEqual(Object.keys(views(run)), ['a1'])
  run.setMessages([user('u1'), open('a1'), user('u2'), open('a2', { memoryCard: card(0, '长难句先拆主干') })])
  run.rehydrate()
  await settle()
  await settle()
  assert.deepEqual(Object.keys(views(run)), ['a2'])
  assert.equal(views(run).a2.text, '长难句先拆主干')
})

// --- confirm ---

test('confirm sends the edited text, then the card becomes a receipt', async () => {
  const run = await ready({ messages: [user('u1'), open('a1', { memoryCard: card(2) })] })
  const pending = run.coach.confirmCoachMemoryCard('a1', '  先给例子，\n再讲证据  ')
  assert.equal(views(run).a1.busy, true)
  assert.equal(views(run).a1.state, 'pending')
  await pending
  assert.deepEqual(run.calls.confirm, [['a1', 2, '先给例子， 再讲证据']])
  assert.deepEqual(
    { state: views(run).a1.state, savedText: views(run).a1.savedText, busy: views(run).a1.busy, error: views(run).a1.error },
    { state: 'confirmed', savedText: '先给例子， 再讲证据', busy: false, error: '' }
  )
})

test('every confirm error code has its own Chinese message and leaves the card retryable', async () => {
  const expected = {
    'memory_card.invalid_text': '这条偏好为空、太长或包含不能保存的内容，请修改后再试',
    'memory_card.rejected': '这条偏好已经记过，或与已有设置冲突',
    'memory_card.no_source': '找不到这条对话，请刷新后再试',
    'memory_card.not_found': '找不到这条对话，请刷新后再试',
    'memory_card.persistence_failed': '保存失败，请重试',
    'tauri.unknown': '保存失败，请重试'
  }
  for (const [code, message] of Object.entries(expected)) {
    let fails = true
    const run = await ready({
      messages: [user('u1'), open('a1')],
      confirm: () => { if (fails) throw error(code, 'raw backend text'); return { memoryId: 'm' } }
    })
    await run.coach.confirmCoachMemoryCard('a1', '先给例子')
    const view = views(run).a1
    assert.equal(view.error, message, code)
    assert.equal(view.state, 'pending', `${code} keeps the buttons`)
    assert.equal(view.busy, false, `${code} is not stuck saving`)
    // The retry goes through and clears the error.
    fails = false
    await run.coach.confirmCoachMemoryCard('a1', '先给例子')
    assert.equal(views(run).a1.state, 'confirmed', `${code} retry`)
    assert.equal(views(run).a1.error, '')
    assert.equal(run.calls.confirm.length, 2)
  }
})

test('empty and over-long wording is refused before any request', async () => {
  const run = await ready({ messages: [user('u1'), open('a1')] })
  await run.coach.confirmCoachMemoryCard('a1', '  \n ')
  assert.equal(views(run).a1.error, '这条偏好为空、太长或包含不能保存的内容，请修改后再试')
  await run.coach.confirmCoachMemoryCard('a1', '字'.repeat(301))
  assert.equal(views(run).a1.state, 'pending')
  assert.equal(run.calls.confirm.length, 0)
  await run.coach.confirmCoachMemoryCard('a1', '字'.repeat(300))
  assert.equal(run.calls.confirm.length, 1, '300 characters is allowed')
})

test('confirm and dismiss only act on a visible pending card', async () => {
  const run = await ready({
    messages: [user('u1'), open('a1'), user('u2'), open('a2'), user('u3'), answer('a3', {}), user('u4'), open('a4', { memoryCardState: 'confirmed' })]
  })
  for (const id of ['a1', 'a3', 'a4', 'missing', '', undefined, '__proto__']) {
    await run.coach.confirmCoachMemoryCard(id, 'x')
    await run.coach.dismissCoachMemoryCard(id)
  }
  assert.deepEqual([run.calls.confirm, run.calls.dismiss], [[], []])
})

// --- dismiss ---

test('dismiss removes the card and records the decision once', async () => {
  const run = await ready({ messages: [user('u1'), open('a1', { memoryCard: card(1) })] })
  await run.coach.dismissCoachMemoryCard('a1')
  assert.deepEqual(run.calls.dismiss, [['a1', 1]])
  assert.deepEqual(views(run), {})
  await run.coach.dismissCoachMemoryCard('a1')
  assert.equal(run.calls.dismiss.length, 1)
})

test('dismiss on an already confirmed card shows the card as remembered', async () => {
  const run = await ready({
    messages: [user('u1'), open('a1')],
    dismiss: () => { throw error('memory_card.already_confirmed') }
  })
  await run.coach.dismissCoachMemoryCard('a1')
  assert.equal(views(run).a1.state, 'confirmed')
  assert.equal(views(run).a1.error, '')
  assert.equal(views(run).a1.savedText, '')
})

test('a failed dismiss keeps the card and says why', async () => {
  const run = await ready({
    messages: [user('u1'), open('a1')],
    dismiss: () => { throw error('memory_card.persistence_failed') }
  })
  await run.coach.dismissCoachMemoryCard('a1')
  assert.deepEqual([views(run).a1.state, views(run).a1.error], ['pending', '保存失败，请重试'])
})

// --- double clicks ---

test('while a request is in flight no second one starts, for any card', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const run = await ready({ messages: [user('u0'), open('a0', { memoryCardState: 'confirmed' }), user('u1'), open('a1')], confirm: () => gate })
  const first = run.coach.confirmCoachMemoryCard('a1', '先给例子')
  const second = run.coach.confirmCoachMemoryCard('a1', '先给例子')
  const third = run.coach.dismissCoachMemoryCard('a1')
  assert.equal(views(run).a1.busy, true)
  release({ memoryId: 'm' })
  await Promise.all([first, second, third])
  assert.equal(run.calls.confirm.length, 1)
  assert.equal(run.calls.dismiss.length, 0)
  assert.equal(views(run).a1.state, 'confirmed')
})

// --- hydration ---

test('the decision survives a reload because the history carries memoryCardState', async () => {
  const run = await ready({ messages: [user('u1'), open('a1')] })
  await run.coach.confirmCoachMemoryCard('a1', '先给例子')
  // What the host now stores for that message.
  run.setMessages([user('u1'), open('a1', { memoryCardState: 'confirmed' })])
  run.coach.resetReadingCoachState()
  run.rehydrate()
  await settle()
  await settle()
  assert.equal(views(run).a1.state, 'confirmed')

  const dismissed = await ready({ messages: [user('u1'), open('a1', { memoryCardState: 'dismissed' })] })
  assert.deepEqual(views(dismissed), {})
})

test('local card state does not outlive the attempt', async () => {
  const run = await ready({ messages: [user('u1'), open('a1')], confirm: () => { throw error('memory_card.rejected') } })
  await run.coach.confirmCoachMemoryCard('a1', 'x')
  assert.ok(views(run).a1.error)
  run.coach.resetReadingCoachState()
  run.rehydrate()
  await settle()
  await settle()
  assert.equal(views(run).a1.error, '')
})

test('card actions never touch the composer draft', async () => {
  const run = await ready({ messages: [user('u1'), open('a1')] })
  run.coach.coachQuery.value = '我正在输入的问题'
  await run.coach.confirmCoachMemoryCard('a1', '先给例子')
  assert.equal(run.coach.coachQuery.value, '我正在输入的问题')
  assert.equal(run.coach.coachLoading.value, false)
})

// --- feedback entry points ---

const REQUIRED_KINDS = [
  'thumbs_up', 'thumbs_down', 'too_long', 'too_short', 'too_abstract',
  'need_example', 'need_step_by_step', 'incorrect', 'not_relevant'
]

test('the learner can reach every feedback kind the host supports, and only those', async () => {
  const { module } = harness({ messages: [] })
  const offered = [...module.READING_COACH_FEEDBACK_OPTIONS, ...module.READING_COACH_ADJUSTMENT_OPTIONS].map((option) => option.kind)
  assert.deepEqual([...offered].sort(), [...REQUIRED_KINDS].sort())
  const domain = readRepo('crates/ielts-domain/src/coach_feedback.rs')
  for (const kind of offered) {
    assert.ok(domain.includes(`=> "${kind}"`), `${kind} is a host CoachFeedbackKind`)
  }
  // Two verdict buttons in the row, everything else behind the menu.
  assert.deepEqual(module.READING_COACH_FEEDBACK_OPTIONS.filter((option) => !option.menu).map((option) => option.kind), ['thumbs_up', 'thumbs_down'])
  for (const option of [...module.READING_COACH_FEEDBACK_OPTIONS, ...module.READING_COACH_ADJUSTMENT_OPTIONS]) {
    assert.match(option.label, /^[一-龥]+$/, `${option.kind} label is Chinese`)
  }
})

test('adjustments are idempotent per kind, stack on one answer and leave the verdict alone', async () => {
  const run = await ready({ messages: [user('u1'), answer('a1')] })
  await run.coach.submitCoachFeedback('a1', 'too_long')
  await run.coach.submitCoachFeedback('a1', 'too_long')
  await run.coach.submitCoachFeedback('a1', 'need_example')
  await run.coach.submitCoachFeedback('a1', 'thumbs_down')
  await run.coach.submitCoachFeedback('a1', 'not_relevant')
  assert.deepEqual(run.calls.feedback, [['a1', 'too_long'], ['a1', 'need_example'], ['a1', 'thumbs_down'], ['a1', 'not_relevant']])
  assert.deepEqual(run.coach.coachAdjustments.value.a1, { too_long: 'saved', need_example: 'saved', not_relevant: 'saved' })
  assert.deepEqual(run.coach.coachFeedback.value.a1, { kind: 'thumbs_down', status: 'saved' })
  // Not eligible: a question, an unknown id.
  await run.coach.submitCoachFeedback('u1', 'too_long')
  await run.coach.submitCoachFeedback('nope', 'too_long')
  assert.equal(run.calls.feedback.length, 4)
})

test('a failed adjustment unlocks only that kind', async () => {
  const run = await ready({ messages: [user('u1'), answer('a1')], feedbackFails: ['too_short'] })
  await run.coach.submitCoachFeedback('a1', 'too_short')
  assert.equal(run.coach.coachAdjustments.value.a1.too_short, 'failed')
  await run.coach.submitCoachFeedback('a1', 'too_short')
  assert.equal(run.calls.feedback.length, 2, 'a failed kind can be tried again')
  await run.coach.submitCoachFeedback('a1', 'too_abstract')
  assert.equal(run.coach.coachAdjustments.value.a1.too_abstract, 'saved')
})

test('saved adjustments come back with the history and never override this view', async () => {
  const run = await ready({
    messages: [user('u1'), answer('a1')],
    savedFeedback: [
      { coachMessageId: 'a1', feedbackKind: 'too_long' },
      { coachMessageId: 'a1', feedbackKind: 'thumbs_up' },
      { coachMessageId: 'a1', feedbackKind: 'style_correction' }
    ]
  })
  assert.deepEqual(run.coach.coachAdjustments.value, { a1: { too_long: 'saved' } })
  assert.deepEqual(run.coach.coachFeedback.value, { a1: { kind: 'thumbs_up', status: 'saved' } })
  await run.coach.submitCoachFeedback('a1', 'too_long')
  assert.deepEqual(run.calls.feedback, [], 'already recorded: no second request')
  assert.deepEqual(run.module.adjustmentStateFromRecords([{ coachMessageId: 'a1', feedbackKind: 'incorrect' }, null, {}]), {})
  run.coach.resetReadingCoachState()
  assert.deepEqual(run.coach.coachAdjustments.value, {})
})

// --- the small strategy tag ---

test('strategyId reads as its Chinese name; old or unknown answers show none', async () => {
  const run = await ready({ messages: [] })
  const label = (strategyId) => run.module.coachStrategyLabel({ snapshot: strategyId === undefined ? {} : { strategyId } })
  assert.deepEqual(
    ['evidence_first_v1', 'example_first_v1', 'step_by_step_v1', 'contrastive_v1', 'socratic_prompt_v1', 'concise_direct_v1'].map(label),
    ['先讲证据', '先给例子', '分步讲解', '对比辨析', '提问引导', '简洁直给']
  )
  for (const odd of [undefined, '', 'evidence_first_v2', '__proto__', 'constructor', 7, null]) assert.equal(label(odd), '', String(odd))
  assert.equal(run.module.coachStrategyLabel(null), '')
  assert.equal(run.module.coachStrategyLabel({ snapshot: null }), '')
})

// --- API client and wiring ---

test('the API client calls the host commands with direct arguments', async () => {
  const source = readApp('api/memory-repository.js')
    .replace(/^import .*$/m, '')
    .replace(/^export default .*$/m, '')
    .replace(/^export (async function|function|const) /gm, '$1 ')
  const calls = []
  const exported = new Function('invokeCommand', 'unwrapCommandResponse',
    `${source}\nreturn { confirmCoachMemoryCard, dismissCoachMemoryCard }`)(
    async (command, args) => { calls.push({ command, args }); return { ok: true, data: { memoryId: 'm' } } },
    (response) => response.data
  )
  assert.deepEqual(await exported.confirmCoachMemoryCard('a1', 2, '先给例子'), { memoryId: 'm' })
  await exported.dismissCoachMemoryCard('a1', 2)
  assert.deepEqual(calls, [
    { command: 'coach_confirm_memory_card', args: { messageId: 'a1', noteIndex: 2, text: '先给例子' } },
    { command: 'coach_dismiss_memory_card', args: { messageId: 'a1', noteIndex: 2 } }
  ])
  await assert.rejects(exported.confirmCoachMemoryCard(' ', 0, 'x'), /messageId is required/)
  assert.equal(calls.length, 2)

  // Parameter names must match the Tauri command signature.
  const host = readRepo('src-tauri/src/commands/memory_card.rs')
  assert.match(host, /pub fn coach_confirm_memory_card\(\s*db: State<'_, AppDb>,\s*message_id: String,\s*note_index: u32,\s*text: String/)
  assert.match(host, /pub fn coach_dismiss_memory_card\(\s*db: State<'_, AppDb>,\s*message_id: String,\s*note_index: u32/)
  for (const code of ['not_found', 'invalid_text', 'no_source', 'rejected', 'already_confirmed', 'persistence_failed']) {
    assert.ok(host.includes(`memory_card.${code}`) || readRepo('crates/ielts-application/src/memory/card.rs').includes(`memory_card.${code}`), code)
  }
  const dts = readApp('api/memory-repository.d.ts')
  assert.ok(dts.includes('confirmCoachMemoryCard(messageId: string, noteIndex: number, text: string)'))
  assert.ok(dts.includes('dismissCoachMemoryCard(messageId: string, noteIndex: number)'))
})

test('panel markup: a named group, live status, keyboard-reachable controls, page wiring', () => {
  const cardSource = readApp('modules/practice-reading/components/ReadingCoachMemoryCard.vue')
  assert.match(cardSource, /role="group"\s+aria-label="学习偏好确认"/)
  assert.ok(cardSource.includes('要记住这个学习偏好吗？'))
  assert.match(cardSource, /role="status"\s+aria-live="polite"/)
  assert.ok(cardSource.includes('role="alert"'), 'a refusal is announced')
  assert.ok(cardSource.includes(':maxlength="limit"') && cardSource.includes('MEMORY_CARD_TEXT_LIMIT'))
  assert.ok(cardSource.includes('{{ length }}/{{ limit }}'), 'the count is visible')
  assert.ok(cardSource.includes('<label') && cardSource.includes(':for="inputId"'), 'the box has a label')
  assert.ok(cardSource.includes(':disabled="card.busy'), 'buttons are disabled while saving')
  assert.ok(cardSource.includes('>\n          记住\n') && cardSource.includes('>\n          忽略\n'))
  assert.ok(cardSource.includes('可在记忆中心查看或修改'))
  assert.ok(!/useReadingCoach'[^]*coachQuery/.test(cardSource) && !cardSource.includes('coachQuery'), 'the card has its own draft')

  const panel = readApp('modules/practice-reading/components/ReadingCoachPanel.vue')
  assert.ok(panel.includes('<ReadingCoachMemoryCard'))
  assert.ok(panel.includes('coachMemoryCards[entry.id]'))
  assert.ok(panel.includes('focusInput()'), 'focus returns to the composer')
  assert.ok(panel.includes('data-reading-coach-strategy') && panel.includes('coachStrategyLabel(entry)'))
  assert.ok(panel.includes('data-reading-coach-feedback-menu-toggle') && panel.includes(':aria-expanded="feedbackMenuId === entry.id'))
  assert.ok(panel.includes('@keydown.esc.stop.prevent="closeFeedbackMenu(true)"'), 'Esc folds the menu, not the panel')
  assert.ok(panel.includes('讲得不对劲？'))

  const page = readApp('views/PracticeReadingPage.vue')
  for (const wiring of [
    ':coach-adjustments="coachAdjustments"',
    ':coach-memory-cards="coachMemoryCards"',
    '@memory-card-confirm="confirmCoachMemoryCard($event.messageId, $event.text)"',
    '@memory-card-dismiss="dismissCoachMemoryCard($event.messageId)"'
  ]) assert.ok(page.includes(wiring), wiring)
})

test('card styles follow the coach tokens, adapt to dark mode, and keep exam controls untouched', () => {
  const css = readApp('modules/practice-reading/styles/host-extras.css')
  const lightStart = css.indexOf('/* ---- preference card')
  const light = css.slice(lightStart, css.indexOf('.runified .reading-coach-panel__actions,', lightStart))
  assert.ok(lightStart > 0 && light.includes('.reading-coach-card__input'))
  assert.ok(light.includes('calc(13 * var(--coach-px))'))
  assert.ok(!/min-height:\s*44px/.test(light) && !/\bfont-size:\s*\d+px/.test(light), 'sizes scale with --coach-px')
  assert.ok(/\.runified\.dark-mode \.reading-coach-card\b/.test(css) && /\.runified\.dark-mode \.reading-coach-card__input/.test(css))
  // Every card selector is scoped under .runified (coach only), never a bare class.
  const selectors = [...css.matchAll(/^([^\n{]*reading-coach-(?:card|feedback__strategy|feedback__menu)[^\n{]*)\{/gm)].map((match) => match[1])
  assert.ok(selectors.length >= 8)
  for (const selector of selectors) assert.match(selector.trim(), /^(?:\.runified\b|\.runified\.dark-mode\b)|,$/, selector)
})
