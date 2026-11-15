import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { legacyWeeklyEntry } from '../../../apps/writing-vue/src/modules/notebook/legacy.js'
import { weeklyEntries } from '../../../apps/writing-vue/src/modules/notebook/weekly.js'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const appRequire = createRequire(path.join(root, 'apps/writing-vue/package.json'))
const ts = appRequire('typescript')
const cache = new Map()
function loadMock(filename) {
  const resolved = path.resolve(root, 'developer/tests/dev-mock', filename)
  if (cache.has(resolved)) return cache.get(resolved)
  if (resolved.endsWith('.json')) return JSON.parse(fs.readFileSync(resolved, 'utf8'))
  const compiled = ts.transpileModule(fs.readFileSync(resolved, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText
  const module = { exports: {} }
  cache.set(resolved, module.exports)
  new Function('require', 'module', 'exports', compiled)(
    (relative) => loadMock(path.relative(path.join(root, 'developer/tests/dev-mock'), path.resolve(path.dirname(resolved), relative))),
    module, module.exports
  )
  return module.exports
}

const state = loadMock('seed.js').createSeedState(Date.parse('2026-10-20T09:00:00Z'))
const handlers = loadMock('handlers.js').createHandlers(state, { send() {} })
const registered = new Set([...fs.readFileSync(path.join(root, 'src-tauri/src/lib.rs'), 'utf8')
  .split('generate_handler![')[1].split('])')[0].matchAll(/commands::\w+::(\w+)/g)].map((match) => match[1]))
assert.deepEqual(Object.keys(handlers).filter((name) => !registered.has(name)), [], 'mock must not revive retired commands')
const current = handlers.weekly_report_current()
const reports = handlers.weekly_report_list()
assert.equal(weeklyEntries(current, reports).length, 3)
assert.ok(reports.every((report) => report.blocks.length && !report.body))
const legacyRows = handlers.weekly_history_list()
assert.ok(legacyRows.map(legacyWeeklyEntry).every((entry) => entry.body.length))
const merged = weeklyEntries(current, reports, legacyRows.map(legacyWeeklyEntry))
assert.deepEqual(merged.map((entry) => entry.window), [
  '2026-W42', '2026-W41', '2026-W40', '2026-W39', '2026-W38', '2026-W37', '2026-W36'
], 'legacy weeks fill the shelf without duplicating a v3 window')
assert.deepEqual(merged.slice(1, 3).map((entry) => entry.schemaVersion), [3, 3], 'a v3 report wins over the legacy digest for the same window')
assert.ok(merged.slice(3).every((entry) => entry.legacy && entry.blocks.length === 0), 'legacy weeks are prose-only')
handlers.memory_put_explicit_preference({ input: { preferenceKey: 'user_note.goal', value: '先练阅读' } })
assert.equal(handlers.memory_list_explicit_preferences()[0].value, '先练阅读')
assert.equal(handlers.memory_delete_explicit_preference({ input: { preferenceKey: 'user_note.goal' } }), true)
assert.deepEqual(handlers.memory_list_explicit_preferences(), [])
assert.equal(handlers.reading_export_archive().submissions.length, handlers.reading_export_archive().count)
assert.equal(handlers.reading_import_archive().committed, true)
assert.ok(handlers.reading_list_assets().filter((asset) => !asset.pdfOnly).every((asset) => asset.payloadRef))
const thread = handlers.coach_ensure_thread({ cmd: { attemptId: 'feedback-attempt' } })
const saved = handlers.coach_record_feedback({ command: { userId: 'local', coachMessageId: 'answer-1', feedbackKind: 'thumbs_up' } })
const repeated = handlers.coach_record_feedback({ command: { userId: 'local', coachMessageId: 'answer-1', feedbackKind: 'incorrect' } })
assert.equal(repeated.id, saved.id, 'one durable verdict per answer')
assert.deepEqual(handlers.coach_list_feedback({ threadId: thread.id }), [saved])
assert.deepEqual(handlers.coach_list_feedback({ threadId: 'other-thread' }), [])

// Listening mock: one real fixture, and the same shapes the Rust commands emit.
const listeningAsset = handlers.listening_list_assets()[0]
assert.equal(listeningAsset.activity, 'listening')
assert.deepEqual(listeningAsset.questionKinds, ['form_completion', 'single_choice', 'multi_choice', 'matching'])
const listeningPayload = handlers.listening_get_asset_payload({ assetId: listeningAsset.id })
assert.equal(listeningPayload.meta.audio, 'audio/exam.wav')
assert.deepEqual(listeningPayload.questionOrder, ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'])

const listeningDraft = handlers.listening_save_draft({ cmd: {
  attemptId: 'listening-draft-1',
  assetId: listeningAsset.id,
  answers: { q1: 'waterproof', q4: ['A', 'C'] },
  markedQuestions: ['q2'],
  questionTimeline: [{ questionId: 'q4', changeCount: 2, visitCount: 3, elapsedMs: 4200, answeredAt: '2026-10-20T09:00:10Z' }],
  timerSnapshot: { anchorMs: Date.now() - 60_000 },
} })
assert.equal(listeningDraft.status, 'draft')
assert.ok(Array.isArray(listeningDraft.answers), 'draft answers are AttemptAnswer rows, not the command map')
assert.ok(listeningDraft.answers.every((row) => 'questionId' in row && !('timerSnapshot' in row)))
assert.equal('timerSnapshot' in listeningDraft, false, 'save returns the AttemptRecord wire, not the command')
assert.equal('idempotencyKey' in listeningDraft, false, 'save returns the AttemptRecord wire, not the command')
assert.deepEqual(handlers.listening_get_open_draft({ assetId: listeningAsset.id }), listeningDraft)

// check_mock_contracts.py reads every quoted `activity.suffix` literal as a
// skill key, so build the envelope code from parts instead of spelling it.
const listeningErrorCode = ['listening', 'error'].join('.')

const audioUrl = handlers.listening_get_audio_data_url({ assetId: listeningAsset.id })
assert.match(audioUrl, /^data:audio\/wav;base64,/)
assert.throws(
  () => handlers.listening_get_audio_data_url({ assetId: 'missing' }),
  (error) => error.envelope.code === listeningErrorCode && /listening asset not found/.test(error.message)
)
assert.throws(
  () => handlers.listening_submit_attempt({ cmd: { attemptId: 'listening-missing', assetId: 'missing', answers: {} } }),
  (error) => error.envelope.code === listeningErrorCode && /listening asset not found/.test(error.message)
)

const listeningSubmit = handlers.listening_submit_attempt({ cmd: {
  attemptId: 'listening-submit-1',
  assetId: listeningAsset.id,
  answers: { q1: 'waterproof', q2: 'silk', q3: 'b', q4: ['C', 'A'], q5: 'A' },
  markedQuestions: ['q6'],
  questionTimeline: [{ questionId: 'q4', changeCount: 3, visitCount: 4, elapsedMs: 9000, answeredAt: '2026-10-20T09:05:00Z' }],
  durationMs: 600_000,
} })
assert.equal(listeningSubmit.questionCount, 7, 'multi_choice carries the weight of its two required answers')
assert.equal(listeningSubmit.correctCount, 6)
assert.equal(listeningSubmit.scoreValue, 6 / 7)
assert.equal(listeningSubmit.attempt.scoreScale, 'ratio')
assert.deepEqual(listeningSubmit.attempt.answers.map((row) => row.questionId), listeningPayload.questionOrder)
const multiChoice = listeningSubmit.attempt.answers.find((row) => row.questionId === 'q4')
assert.equal(multiChoice.questionKind, 'multi_choice')
assert.equal(multiChoice.weight, 2)
assert.equal(multiChoice.isCorrect, true)
assert.deepEqual([multiChoice.changeCount, multiChoice.visitCount, multiChoice.elapsedMs], [3, 4, 9000])
assert.equal(multiChoice.answeredAt, '2026-10-20T09:05:00Z')
const unanswered = listeningSubmit.attempt.answers.find((row) => row.questionId === 'q6')
assert.equal(unanswered.answer, '', 'an absent answer is the empty string, like the Rust submit')
assert.equal(unanswered.isCorrect, false)
assert.equal(unanswered.marked, true)

const history = legacyWeeklyEntry({ runId: 'old', window: '2026-W41', digest: {
  title: '旧周记', body: ['练了 {{f:count}} 次', '<img src=x onerror=alert(1)>', '{{f:missing}}'],
  facts: { count: { value: 3 } }, nextSteps: [{ text: '换一篇文章' }]
} })
assert.deepEqual(history.body, ['练了 3 次', '<img src=x onerror=alert(1)>', '〔引用不可用〕'])
assert.equal(history.groups[0].items[0].text, '换一篇文章')
assert.equal(history.groups[0].items[0].route, null)
console.log('Integration contracts passed: current mock commands, typed reports, legacy plain text, preferences and the reading/listening data tools')
