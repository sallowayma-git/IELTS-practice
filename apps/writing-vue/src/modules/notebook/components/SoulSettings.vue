<template>
  <section
    id="settings-soul"
    class="card settings-card soul-settings"
    aria-labelledby="settings-soul-title"
    data-soul-settings
  >
    <div class="settings-card__head">
      <h2 id="settings-soul-title">个人情况</h2>
      <p class="field-help">称呼、语气和目标由你决定。陪伴者的备注与语气建议会留下修改记录。</p>
    </div>

    <p v-if="error" class="inline-message inline-message-error" role="alert" data-soul-error>{{ error }}</p>
    <p v-if="notice" class="inline-message inline-message-success" role="status" data-soul-notice>{{ notice }}</p>

    <form class="soul-form" @submit.prevent="save">
      <label class="field">
        <span class="field-label">昵称</span>
        <input v-model="form['soul.nickname']" class="input" maxlength="40" autocomplete="nickname">
      </label>
      <label class="field">
        <span class="field-label">称呼</span>
        <select v-model="form['soul.address']" class="select">
          <option>你</option>
          <option>您</option>
        </select>
      </label>
      <label class="field">
        <span class="field-label">语气</span>
        <select v-model="form['soul.tone']" class="select">
          <option>温和</option>
          <option>平衡</option>
          <option>直接</option>
        </select>
      </label>
      <label class="field">
        <span class="field-label">目标分</span>
        <input v-model="form['soul.targetBand']" class="input" type="number" min="4" max="9" step="0.5">
      </label>
      <label class="field">
        <span class="field-label">考试日期</span>
        <input v-model="form['soul.examDate']" class="input" type="date" :min="tomorrowDate()">
      </label>
      <label class="field soul-wide">
        <span class="field-label">想对陪伴者说的话</span>
        <textarea v-model="form['soul.message']" class="textarea" maxlength="1000" rows="3"></textarea>
      </label>
      <div class="soul-wide">
        <button class="btn btn-secondary" type="submit" :disabled="busy || !loaded">保存个人情况</button>
      </div>
    </form>

    <p v-if="snapshot.profile['soul.companionNotes']" data-soul-companion-notes>
      陪伴备注：{{ snapshot.profile['soul.companionNotes'] }}
    </p>
    <p v-if="snapshot.profile['soul.toneSuggestion']" data-soul-tone-suggestion>
      语气建议：{{ snapshot.profile['soul.toneSuggestion'] }}
    </p>

    <h3>修改历史</h3>
    <p v-if="!snapshot.revisions.length" class="field-help">还没有修改记录。</p>
    <ol v-else class="soul-history">
      <li v-for="revision in snapshot.revisions" :key="revision.id">
        <p>{{ names[revision.key] || revision.key }}：{{ text(revision.before) }} → {{ text(revision.after) }}</p>
        <small>{{ actorName(revision.actor) }} · {{ revision.createdAt }} · {{ revision.reason }}</small>
        <details v-if="revision.evidenceIds?.length">
          <summary>查看修改依据</summary>
          {{ revision.evidenceIds.join('、') }} · {{ revision.runId }}
        </details>
        <button
          v-if="revision.actor === 'model' && !reverted(revision.id)"
          class="btn btn-text btn-sm"
          type="button"
          :disabled="busy"
          @click="undo(revision.id)"
        >
          撤销这次修改
        </button>
      </li>
    </ol>
  </section>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { getSoul, updateSoul, undoSoulRevision, tomorrowDate } from '@/api/soul-repository.js'

const defaults = {
  'soul.nickname': '',
  'soul.address': '你',
  'soul.tone': '平衡',
  'soul.targetBand': '',
  'soul.examDate': '',
  'soul.message': ''
}
const names = {
  'soul.nickname': '昵称',
  'soul.address': '称呼',
  'soul.tone': '语气',
  'soul.targetBand': '目标分',
  'soul.examDate': '考试日期',
  'soul.message': '想说的话',
  'soul.companionNotes': '陪伴备注',
  'soul.toneSuggestion': '语气建议'
}
const actors = { model: '陪伴者', undo: '用户撤销', user: '用户' }

const form = reactive({ ...defaults })
const snapshot = ref({ profile: {}, revisions: [] })
const busy = ref(false)
const loaded = ref(false)
const error = ref('')
const notice = ref('')

const text = (value) => (value == null || value === '' ? '未填写' : value)
const actorName = (actor) => actors[actor] || actor
const reverted = (id) => snapshot.value.revisions.some((revision) => revision.revertsId === id)

function apply(value) {
  snapshot.value = { profile: value.profile ?? {}, revisions: value.revisions ?? [] }
  for (const key of Object.keys(defaults)) form[key] = snapshot.value.profile[key] ?? defaults[key]
}

async function action(run, message) {
  busy.value = true
  error.value = ''
  try {
    apply(await run())
    loaded.value = true
    notice.value = message
  } catch (failure) {
    error.value = failure?.message || '个人情况暂时未能读取，请稍后重试。'
  } finally {
    busy.value = false
  }
}

function save() {
  const fields = {
    ...form,
    'soul.targetBand': form['soul.targetBand'] === '' ? null : Number(form['soul.targetBand'])
  }
  return action(() => updateSoul(fields), '个人情况已保存。')
}

const undo = (id) => action(() => undoSoulRevision(id), '已撤销这次修改。')

onMounted(() => action(getSoul, ''))
</script>

<style scoped>
.soul-settings h2 {
  margin: 0;
}

.soul-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--anth-space-4);
  margin: var(--anth-space-5) 0;
}

.soul-wide {
  grid-column: 1 / -1;
}

.soul-history {
  padding-left: var(--anth-space-5);
}

.soul-history li {
  padding: var(--anth-space-3) 0;
  border-bottom: 1px solid var(--anth-rule);
}

.soul-history small {
  display: block;
  color: var(--anth-ink-muted);
}

.soul-history details {
  color: var(--anth-ink-soft);
  font-size: var(--anth-text-small-size);
}
</style>
