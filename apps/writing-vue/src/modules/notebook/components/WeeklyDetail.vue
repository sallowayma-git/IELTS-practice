<template>
  <div class="weekly-detail" data-weekly-detail :data-week-state="entry.state">
    <template v-if="hasNarrative">
      <p v-for="(line, index) in entry.paragraphs" :key="index" class="weekly-paragraph">
        <WeeklyText :text="line" :facts="entry.facts" />
      </p>

      <section v-for="group in entry.groups" :key="group.key" class="weekly-group" :data-week-group="group.key">
        <h3><span class="notebook-mark" aria-hidden="true">§</span>{{ group.title }}</h3>
        <ul>
          <li v-for="(item, index) in group.items" :key="index">
            <WeeklyText :text="item.text" :facts="entry.facts" />
            <router-link v-if="item.route" :to="item.route" class="text-link" @click="$emit('navigate')">去练习</router-link>
          </li>
        </ul>
      </section>

      <form v-if="askUser && !answered" class="weekly-question" data-weekly-ask @submit.prevent="answer">
        <label>
          {{ askUser.question }}
          <input
            v-model="value"
            class="input"
            :type="askUser.key === 'soul.examDate' ? 'date' : 'number'"
            :min="askUser.key === 'soul.examDate' ? tomorrowDate() : 4"
            :max="askUser.key === 'soul.examDate' ? undefined : 9"
            :step="askUser.key === 'soul.examDate' ? undefined : 0.5"
            required
          >
        </label>
        <button class="btn btn-secondary btn-sm" type="submit" :disabled="saving">保存到个人情况</button>
      </form>
      <p v-if="answered" role="status">已保存到个人情况。</p>
      <p v-if="error" class="inline-message inline-message-error" role="alert">{{ error }}</p>

      <section v-if="entry.blocks.length" class="weekly-data" data-weekly-data aria-label="本周数据">
        <h3><span class="notebook-mark" aria-hidden="true">§</span>本周数据</h3>
        <WeeklyReportBody :week="entry" />
      </section>
    </template>

    <template v-else>
      <p v-if="entry.stateLine" class="section-meta weekly-state-line" data-week-state-line>
        {{ entry.stateLine.text }}<template v-if="entry.stateLine.settings">。<router-link class="text-link" :to="{ name: 'Settings' }">去设置</router-link></template>
      </p>
      <section class="weekly-data" data-weekly-data>
        <WeeklyReportBody :week="entry" />
      </section>
    </template>

    <section v-if="entry.memoryChanges.length" class="weekly-memory" data-week-memory-changes>
      <h3><span class="notebook-mark" aria-hidden="true">§</span>这一周记忆的变化</h3>
      <ul class="notebook-notes">
        <li v-for="change in entry.memoryChanges" :key="change.key">
          <span><span class="tag">{{ change.action }}</span> {{ change.statement }}。</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { getSoul, tomorrowDate, updateSoul } from '@/api/soul-repository.js'
import WeeklyReportBody from './WeeklyReportBody.vue'
import WeeklyText from './WeeklyText.vue'

const props = defineProps({ entry: { type: Object, required: true } })
defineEmits(['navigate'])

// A final report with a narrative body is the only shape that shows prose.
// live / final_no_ai / narrative_failed are data-only by contract.
const hasNarrative = computed(() => props.entry.state === 'final' && props.entry.paragraphs.length > 0)

// Only the two Soul questions have a write path; anything else is not a form.
const askUser = computed(() => {
  const ask = props.entry.askUser
  return ask && ['soul.targetBand', 'soul.examDate'].includes(ask.key) && ask.question ? ask : null
})

const value = ref('')
const answered = ref(false)
const saving = ref(false)
const error = ref('')

onMounted(async () => {
  const key = askUser.value?.key
  if (!key) return
  try {
    const snapshot = await getSoul()
    const current = snapshot?.profile?.[key]
    answered.value = key === 'soul.examDate'
      ? Boolean(current) && String(current) >= tomorrowDate()
      : current !== null && current !== undefined && current !== ''
  } catch (failure) {
    error.value = failure?.message || '个人情况暂时读不出来。'
  }
})

async function answer() {
  const key = askUser.value?.key
  if (!key) return
  saving.value = true
  error.value = ''
  try {
    await updateSoul({ [key]: key === 'soul.targetBand' ? Number(value.value) : value.value })
    answered.value = true
  } catch (failure) {
    error.value = failure?.message || '个人情况暂时未能保存，请稍后重试。'
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.weekly-detail {
  display: grid;
  gap: 20px;
}

.weekly-paragraph,
.weekly-group li {
  max-width: var(--anth-measure);
  margin: 0;
  color: var(--anth-ink);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-body-lg-size);
  line-height: 1.9;
}

.weekly-group h3,
.weekly-data h3,
.weekly-memory h3 {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0 0 8px;
  color: var(--anth-ink-strong);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-md);
  font-weight: 700;
}

.weekly-group ul {
  display: grid;
  gap: 8px;
  margin: 0;
  padding-left: 1.2em;
}

.weekly-group li .text-link {
  margin-left: 8px;
  white-space: nowrap;
}

.weekly-question {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: end;
  padding: 14px;
  border: 2px dashed var(--nb-ink, #1E1A16);
  border-radius: 12px;
}

.weekly-question label {
  flex: 1 1 220px;
  font-family: var(--anth-font-serif);
}

.weekly-question input {
  display: block;
  margin-top: 8px;
}

.weekly-state-line {
  margin: 0;
}

.weekly-data {
  display: grid;
  gap: 20px;
}

.weekly-data + .weekly-data {
  margin-top: 4px;
}

.weekly-memory {
  padding-top: 4px;
}

@media (max-width: 600px) {
  .weekly-question {
    display: grid;
    align-items: stretch;
  }

  .weekly-question label {
    flex: none;
  }
}
</style>
