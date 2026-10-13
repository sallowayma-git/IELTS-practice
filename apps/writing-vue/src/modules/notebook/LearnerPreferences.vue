<template>
  <div class="learner-prefs" data-notebook-preferences>
    <h3 id="learner-prefs-title" class="learner-prefs__title">你告诉我们的</h3>
    <p class="field-help">这些是你亲自写下的偏好，教练讲解时会优先照做。随时可以修改或删掉。</p>

    <p v-if="notice" class="inline-message inline-message-success" role="status" data-preference-notice>{{ notice }}</p>
    <p v-if="error" class="inline-message inline-message-error" role="alert" data-preference-error>{{ error }}</p>

    <p v-if="loading" class="section-meta" role="status">正在读取你的偏好…</p>
    <ul v-else-if="notes.length" class="list learner-prefs__list" aria-labelledby="learner-prefs-title">
      <li
        v-for="note in notes"
        :key="note.key"
        class="list-row learner-prefs__row"
        :data-preference-key="note.key"
      >
        <form
          v-if="editingKey === note.key"
          class="learner-prefs__form"
          data-preference-edit-form
          @submit.prevent="saveEdit(note)"
        >
          <label class="sr-only" :for="`pref-edit-${note.key}`">修改这条偏好</label>
          <input
            :id="`pref-edit-${note.key}`"
            ref="editInput"
            v-model="editText"
            class="input"
            type="text"
            :maxlength="MAX_PREFERENCE_CHARS"
            :aria-invalid="editTooLong ? 'true' : undefined"
            autocomplete="off"
            data-preference-edit-input
            @keydown.esc.prevent="cancelEdit"
          >
          <span class="learner-prefs__count" aria-live="polite">{{ editLength }}/{{ MAX_PREFERENCE_CHARS }}</span>
          <button class="btn btn-secondary btn-sm" type="submit" :disabled="busy.has(note.key)" data-preference-save>保存</button>
          <button class="btn btn-text btn-sm" type="button" :disabled="busy.has(note.key)" @click="cancelEdit">取消</button>
        </form>
        <template v-else>
          <p class="learner-prefs__text">
            <span class="tag tag-accent learner-prefs__badge">你写的</span>
            <span data-preference-text>{{ note.text }}</span>
          </p>
          <div class="learner-prefs__actions">
            <button class="btn btn-text btn-sm" type="button" :disabled="busy.has(note.key)" data-preference-edit @click="startEdit(note)">修改</button>
            <button class="btn btn-text btn-sm" type="button" :disabled="busy.has(note.key)" data-preference-delete @click="remove(note)">删除</button>
          </div>
        </template>
      </li>
    </ul>
    <p v-else-if="!loadFailed" class="section-meta" data-preference-empty>还没有写下偏好。比如「先给我看例句」「解释用中文」。</p>

    <form
      v-if="!loading && !loadFailed && notes.length < MAX_PREFERENCE_NOTES"
      class="field learner-prefs__add"
      data-preference-add-form
      @submit.prevent="add"
    >
      <label class="field-label" for="learner-prefs-new">添加一条偏好</label>
      <div class="learner-prefs__form">
        <input
          id="learner-prefs-new"
          v-model="draft"
          class="input"
          type="text"
          :maxlength="MAX_PREFERENCE_CHARS"
          :aria-invalid="draftTooLong ? 'true' : undefined"
          aria-describedby="learner-prefs-new-help"
          placeholder="例如：先给我看例句"
          autocomplete="off"
          data-preference-input
        >
        <span class="learner-prefs__count" aria-live="polite">{{ draftLength }}/{{ MAX_PREFERENCE_CHARS }}</span>
        <button class="btn btn-secondary btn-sm" type="submit" :disabled="adding || !draftLength" data-preference-add>添加</button>
      </div>
      <p id="learner-prefs-new-help" class="field-help">一句话，不超过 {{ MAX_PREFERENCE_CHARS }} 个字。</p>
    </form>
    <p v-else-if="!loading && !loadFailed" class="field-help" data-preference-full>已经写了 {{ MAX_PREFERENCE_NOTES }} 条，删掉一条后可以再加。</p>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import {
  deleteExplicitPreference,
  listExplicitPreferences,
  putExplicitPreference
} from '@/api/memory-repository.js'
import {
  MAX_PREFERENCE_CHARS,
  MAX_PREFERENCE_NOTES,
  newPreferenceKey,
  preferenceDraftProblem,
  preferenceErrorMessage,
  preferenceLength,
  userPreferenceNotes
} from './preferences.js'

const notes = ref([])
const loading = ref(true)
const loadFailed = ref(false)
const notice = ref('')
const error = ref('')
const draft = ref('')
const adding = ref(false)
const editingKey = ref('')
const editText = ref('')
const editInput = ref(null)
const busy = ref(new Set())

const draftLength = computed(() => preferenceLength(draft.value))
const draftTooLong = computed(() => draftLength.value > MAX_PREFERENCE_CHARS)
const editLength = computed(() => preferenceLength(editText.value))
const editTooLong = computed(() => editLength.value > MAX_PREFERENCE_CHARS)

function setBusy(key, value) {
  const next = new Set(busy.value)
  if (value) next.add(key); else next.delete(key)
  busy.value = next
}

function clearMessages() {
  notice.value = ''
  error.value = ''
}

async function load() {
  loading.value = true
  try {
    notes.value = userPreferenceNotes(await listExplicitPreferences())
    loadFailed.value = false
  } catch {
    notes.value = []
    loadFailed.value = true
    error.value = '暂时读不到你的偏好，请稍后再来看看。'
  } finally {
    loading.value = false
  }
}

async function add() {
  clearMessages()
  const problem = preferenceDraftProblem(draft.value)
  if (problem) { error.value = problem; return }
  adding.value = true
  try {
    await putExplicitPreference({ preferenceKey: newPreferenceKey(), scope: 'global', value: draft.value.trim() })
    draft.value = ''
    notice.value = '记下了。之后的讲解会照这个来。'
    await load()
  } catch (failure) {
    error.value = preferenceErrorMessage(failure, '没能保存这条偏好，请稍后再试。')
  } finally {
    adding.value = false
  }
}

async function startEdit(note) {
  clearMessages()
  editingKey.value = note.key
  editText.value = note.text
  await nextTick()
  const input = Array.isArray(editInput.value) ? editInput.value[0] : editInput.value
  input?.focus()
}

function cancelEdit() {
  editingKey.value = ''
  editText.value = ''
}

async function saveEdit(note) {
  clearMessages()
  const problem = preferenceDraftProblem(editText.value)
  if (problem) { error.value = problem; return }
  if (editText.value.trim() === note.text) { cancelEdit(); return }
  setBusy(note.key, true)
  try {
    await putExplicitPreference({ preferenceKey: note.key, scope: note.scope, value: editText.value.trim() })
    cancelEdit()
    notice.value = '已修改。'
    await load()
  } catch (failure) {
    error.value = preferenceErrorMessage(failure, '没能修改这条偏好，请稍后再试。')
  } finally {
    setBusy(note.key, false)
  }
}

async function remove(note) {
  if (!window.confirm(`删除这条偏好？\n「${note.text}」`)) return
  clearMessages()
  setBusy(note.key, true)
  try {
    await deleteExplicitPreference({ preferenceKey: note.key, scope: note.scope })
    notice.value = '已删除。'
    await load()
  } catch (failure) {
    error.value = preferenceErrorMessage(failure, '没能删除这条偏好，请稍后再试。')
  } finally {
    setBusy(note.key, false)
  }
}

onMounted(load)
</script>

<style scoped>
.learner-prefs {
  display: grid;
  gap: var(--anth-space-2);
  margin-bottom: var(--anth-space-5);
}

.learner-prefs__title {
  margin: 0;
  color: var(--anth-ink-strong);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-md);
}

.learner-prefs__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.learner-prefs__row {
  grid-template-columns: minmax(0, 1fr) auto;
}

.learner-prefs__text {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--anth-space-2);
  max-width: var(--anth-measure);
  margin: 0;
  color: var(--anth-ink);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-body-lg-size);
  line-height: var(--anth-text-body-lg-line);
}

.learner-prefs__badge {
  flex: none;
  font-family: var(--anth-font-sans);
}

.learner-prefs__actions {
  display: flex;
  gap: var(--anth-space-3);
  white-space: nowrap;
}

/* Input, counter and buttons on one line; the input takes the slack. */
.learner-prefs__form {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  gap: var(--anth-space-2);
  min-width: 0;
  max-width: var(--anth-measure);
}

.learner-prefs__form .input {
  flex: 1 1 auto;
}

.learner-prefs__count {
  flex: none;
  color: var(--anth-ink-muted);
  font-family: var(--anth-font-sans);
  font-size: var(--anth-text-small-size);
  font-variant-numeric: tabular-nums;
}

.learner-prefs__add {
  margin-top: var(--anth-space-2);
}

@media (max-width: 640px) {
  .learner-prefs__form {
    flex-wrap: wrap;
  }

  .learner-prefs__form .input {
    flex-basis: 100%;
  }
}
</style>
