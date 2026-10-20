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

const history = legacyWeeklyEntry({ runId: 'old', window: '2026-W41', digest: {
  title: '旧周记', body: ['练了 {{f:count}} 次', '<img src=x onerror=alert(1)>', '{{f:missing}}'],
  facts: { count: { value: 3 } }, nextSteps: [{ text: '换一篇文章' }]
} })
assert.deepEqual(history.body, ['练了 3 次', '<img src=x onerror=alert(1)>', '〔引用不可用〕'])
assert.equal(history.groups[0].items[0].text, '换一篇文章')
assert.equal(history.groups[0].items[0].route, null)
console.log('Integration contracts passed: current mock commands, typed reports, legacy plain text, preferences and reading data tools')
