import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import {
  MAX_PREFERENCE_CHARS,
  MAX_PREFERENCE_NOTES,
  newPreferenceKey,
  preferenceDraftProblem,
  preferenceErrorMessage,
  preferenceLength,
  userPreferenceNotes
} from '../../../apps/writing-vue/src/modules/notebook/preferences.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const domain = read('../../../crates/ielts-domain/src/preference.rs')
const repository = read('../../../apps/writing-vue/src/api/memory-repository.js')
const host = read('../../../src-tauri/src/lib.rs')
const component = read('../../../apps/writing-vue/src/modules/notebook/LearnerPreferences.vue')
const notebook = read('../../../apps/writing-vue/src/views/NotebookPage.vue')

test('client limits mirror the host limits', () => {
  assert.match(domain, new RegExp(`MAX_PREFERENCE_TEXT_CHARS: usize = ${MAX_PREFERENCE_CHARS};`))
  assert.match(domain, new RegExp(`MAX_USER_NOTE_PREFERENCES: usize = ${MAX_PREFERENCE_NOTES};`))
  assert.match(domain, /USER_NOTE_PREFERENCE_PREFIX: &str = "user_note\.";/)
})

test('length counts characters after trimming, like the host', () => {
  assert.equal(preferenceLength('  先给我看例句  '), 6)
  assert.equal(preferenceLength('😀'), 1)
  assert.equal(preferenceDraftProblem('   '), '请先写下你的偏好。')
  assert.equal(preferenceDraftProblem('例'.repeat(MAX_PREFERENCE_CHARS)), '')
  assert.match(preferenceDraftProblem('例'.repeat(MAX_PREFERENCE_CHARS + 1)), /60 个字以内/)
})

test('only the learner\'s own active text notes are listed', () => {
  const notes = userPreferenceNotes([
    { preferenceKey: 'user_note.a1', scope: 'global', value: ' 先给我看例句 ', status: 'active', source: 'user', updatedAt: 't1' },
    { preferenceKey: 'teaching.explanation_style', scope: 'global', value: 'example_first', status: 'active' },
    { preferenceKey: 'user_note.b2', scope: 'global', value: true, status: 'active' },
    { preferenceKey: 'user_note.c3', scope: 'global', value: '解释用中文', status: 'disabled' }
  ])
  assert.deepEqual(notes, [{ key: 'user_note.a1', scope: 'global', text: '先给我看例句', updatedAt: 't1' }])
  assert.deepEqual(userPreferenceNotes(null), [])
})

test('new keys satisfy the host key rule', () => {
  const key = newPreferenceKey()
  assert.match(key, /^user_note\.[0-9a-f]{16}$/)
  assert.notEqual(newPreferenceKey(), key)
  assert.match(newPreferenceKey(null), /^user_note\.[0-9a-f]{16}$/)
})

test('host messages are shown only for learner-facing preference codes', () => {
  const refused = Object.assign(new Error('这句话里有不能交给教练的内容（像指令、密钥或健康、性格类判断），不能保存为偏好。请换一种说法。'), { code: 'memory.preference_rejected' })
  assert.equal(preferenceErrorMessage(refused, 'fallback'), refused.message)
  const internal = Object.assign(new Error('database is locked'), { code: 'memory.persistence_failed' })
  assert.equal(preferenceErrorMessage(internal, 'fallback'), 'fallback')
  for (const code of domain.matchAll(/=> "(memory\.preference_[a-z_]+)"/g)) {
    assert.equal(preferenceErrorMessage({ code: code[1], message: 'm' }, 'f'), 'm', code[1])
  }
})

test('the write path is wired end to end', () => {
  for (const command of ['memory_put_explicit_preference', 'memory_list_explicit_preferences', 'memory_delete_explicit_preference']) {
    assert.match(repository, new RegExp(`invokeCommand\\('${command}'`), command)
    assert.match(host, new RegExp(`commands::memory::${command},`), command)
  }
  assert.match(notebook, /<LearnerPreferences \/>/)
  for (const hook of ['data-notebook-preferences', 'data-preference-input', 'data-preference-add', 'data-preference-edit',
    'data-preference-save', 'data-preference-delete', 'data-preference-key']) {
    assert.ok(component.includes(hook), hook)
  }
  assert.match(component, /:maxlength="MAX_PREFERENCE_CHARS"/)
  assert.match(component, /你写的/)
})
