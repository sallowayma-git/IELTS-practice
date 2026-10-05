<template>
  <section class="notebook-page" data-notebook>
    <header class="page-header notebook-header">
      <div>
        <h1 class="heading-serif">札记</h1>
        <p class="notebook-lede">练习之后，系统会把当天的情况整理成一篇短记：看到了什么，哪里在变，接下来练什么。</p>
      </div>
      <button class="btn-text" type="button" :disabled="tidying || loading" data-notebook-tidy @click="tidyToday">
        {{ tidying ? '正在整理…' : '整理今天' }}
      </button>
    </header>

    <p v-if="notice" class="inline-message inline-message-success" role="status">{{ notice }}</p>
    <p v-if="actionError" class="inline-message inline-message-error" role="alert">{{ actionError }}</p>

    <p v-if="loading" class="notebook-quiet" role="status" aria-live="polite">正在翻开札记…</p>

    <template v-else>
      <div v-if="loadError" class="notebook-quiet" role="alert">
        <p>{{ loadError }}</p>
        <button class="btn-text" type="button" @click="load">再试一次</button>
      </div>

      <div v-else-if="!entries.length && !weeks.length" class="notebook-empty" role="status">
        <p class="notebook-empty__title">札记还是空白的一页。</p>
        <p>练习过的日子，系统会在第二天把它整理成一篇札记放在这里；想提前看，可以点「整理今天」。先去读一篇文章或写一篇作文吧。</p>
      </div>

      <article
        v-for="(week, weekIndex) in weeks"
        :key="`${week.window}:${week.startDay}`"
        class="notebook-entry"
        :data-notebook-week="week.window"
      >
        <header class="notebook-entry__head">
          <time :datetime="week.startDay">{{ week.dateLabel }}</time>
          <h2 class="heading-serif">{{ week.title }}</h2>
        </header>

        <section v-if="week.observations.length" class="notebook-section">
          <h3><span class="notebook-mark" aria-hidden="true">§</span>这段时间的观察</h3>
          <ul class="notebook-notes">
            <li v-for="line in week.observations" :key="line"><span>{{ line }}。</span></li>
          </ul>
        </section>

        <section v-if="week.changes.length" class="notebook-section">
          <h3><span class="notebook-mark" aria-hidden="true">§</span>变化</h3>
          <ul class="notebook-notes">
            <li v-for="line in week.changes" :key="line"><span>{{ line }}。</span></li>
          </ul>
        </section>

        <section v-if="week.nextPractice.length || (weekIndex === 0 && practice.length)" class="notebook-section" data-notebook-next>
          <h3><span class="notebook-mark" aria-hidden="true">§</span>下一步练习</h3>
          <ul v-if="week.nextPractice.length" class="notebook-notes">
            <li v-for="line in week.nextPractice" :key="line"><span>{{ line }}。</span></li>
          </ul>
          <ol v-if="weekIndex === 0 && practice.length" class="notebook-practice">
            <li v-for="item in practice" :key="item.id">
              <strong>{{ item.label }}</strong>
              <span v-if="item.why">{{ item.why }}</span>
              <span v-if="item.minutes" class="notebook-practice__time">约 {{ item.minutes }} 分钟</span>
            </li>
          </ol>
        </section>
      </article>

      <article
        v-for="(entry, entryIndex) in entries"
        :key="entry.day"
        class="notebook-entry"
        :data-notebook-entry="entry.day"
      >
        <header class="notebook-entry__head">
          <time :datetime="entry.day">{{ entry.dateLabel }}</time>
          <h2 class="heading-serif">{{ entry.title }}</h2>
        </header>

        <section v-if="entry.observations.length || entry.notes.length || entry.unresolved.length" class="notebook-section">
          <h3><span class="notebook-mark" aria-hidden="true">§</span>观察</h3>
          <p v-if="entry.observations.length" class="notebook-prose">{{ entry.observations.join('') }}</p>
          <ul v-if="entry.notes.length" class="notebook-notes">
            <li v-for="(note, noteIndex) in entry.notes" :key="note.id">
              <span>{{ note.statement }}。{{ note.phrase }}</span>
              <button
                v-if="note.evidenceIds.length"
                class="notebook-ref"
                type="button"
                :aria-expanded="openNote === noteKey(entry, note)"
                :aria-controls="`note-${noteKey(entry, note)}`"
                :aria-label="`查看第 ${noteIndex + 1} 条依据`"
                @click="toggleNote(entry, note)"
              >{{ noteIndex + 1 }}</button>
              <span
                v-if="openNote === noteKey(entry, note)"
                :id="`note-${noteKey(entry, note)}`"
                class="notebook-footnote"
                role="note"
              >
                <template v-if="noteState.status === 'loading'">正在找出依据…</template>
                <template v-else-if="noteState.status === 'error'">{{ noteState.error }}</template>
                <template v-else-if="!noteState.items.length">这条判断暂时没有可展示的练习依据。</template>
                <template v-else>
                  <span v-for="item in noteState.items" :key="item.id" class="notebook-footnote__item">
                    {{ item.text }}
                    <router-link v-if="item.route" :to="item.route" class="text-link">查看那次练习</router-link>
                  </span>
                </template>
              </span>
            </li>
          </ul>
          <p v-if="entry.unresolved.length" class="notebook-prose notebook-prose--quiet">
            还没想明白的：{{ entry.unresolved.join('；') }}。
          </p>
        </section>

        <section v-if="entry.changes.improved.length || entry.changes.recurring.length" class="notebook-section">
          <h3><span class="notebook-mark" aria-hidden="true">§</span>变化</h3>
          <dl class="notebook-changes">
            <div v-if="entry.changes.improved.length">
              <dt>在变好</dt>
              <dd>{{ entry.changes.improved.join('、') }}</dd>
            </div>
            <div v-if="entry.changes.recurring.length">
              <dt>反复出现</dt>
              <dd>{{ entry.changes.recurring.join('、') }}</dd>
            </div>
          </dl>
        </section>

        <section v-if="entryIndex === 0 && !weeks.length && practice.length" class="notebook-section" data-notebook-next>
          <h3><span class="notebook-mark" aria-hidden="true">§</span>下一步练习</h3>
          <ol class="notebook-practice">
            <li v-for="item in practice" :key="item.id">
              <strong>{{ item.label }}</strong>
              <span v-if="item.why">{{ item.why }}</span>
              <span v-if="item.minutes" class="notebook-practice__time">约 {{ item.minutes }} 分钟</span>
            </li>
          </ol>
        </section>
      </article>

      <section v-if="!entries.length && !weeks.length && practice.length" class="notebook-section notebook-standalone" data-notebook-next>
        <h3><span class="notebook-mark" aria-hidden="true">§</span>下一步练习</h3>
        <ol class="notebook-practice">
          <li v-for="item in practice" :key="item.id">
            <strong>{{ item.label }}</strong>
            <span v-if="item.why">{{ item.why }}</span>
            <span v-if="item.minutes" class="notebook-practice__time">约 {{ item.minutes }} 分钟</span>
          </li>
        </ol>
      </section>

      <section class="notebook-memory" aria-labelledby="notebook-memory-title" data-notebook-memory>
        <h2 id="notebook-memory-title" class="heading-serif">关于你，我们记住了</h2>
        <p class="notebook-lede">这是系统目前对你的理解。哪一句不对，就告诉我们；不想被记住，就让它忘记。</p>
        <p v-if="memoryError" class="notebook-quiet" role="alert">{{ memoryError }}</p>
        <p v-else-if="!memories.length" class="notebook-quiet">还没有记住什么。多练几次，这里会出现系统对你的了解。</p>
        <ol v-else class="notebook-memory__list">
          <li v-for="memory in memories" :key="memory.id" :data-memory-id="memory.id">
            <p>{{ memory.statement }}</p>
            <div class="notebook-memory__actions">
              <button class="btn-text" type="button" :disabled="busy.has(memory.id)" @click="markInaccurate(memory)">不准确</button>
              <button class="btn-text" type="button" :disabled="busy.has(memory.id)" @click="forget(memory)">忘记</button>
            </div>
          </li>
        </ol>
      </section>
    </template>
  </section>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import agentRepository from '@/api/agent-repository.js'
import { getMemoryEvidence } from '@/api/learning-repository.js'
import {
  forgetMemory,
  getBackgroundJobStatus,
  getDailyJournal,
  getMemoryCatalog,
  getWeeklyDigests,
  recordMemoryFeedback,
  triggerDailyDream
} from '@/api/memory-repository.js'
import {
  buildNotebookEntry,
  buildWeeklyEntry,
  journalDaysFromJobs,
  nextPractice,
  rememberedSentences
} from '@/modules/notebook/compose.js'

const loading = ref(true)
const loadError = ref('')
const entries = ref([])
const weeks = ref([])
const memories = ref([])
const memoryError = ref('')
const practice = ref([])
const notice = ref('')
const actionError = ref('')
const busy = ref(new Set())
const tidying = ref(false)
const openNote = ref('')
const noteState = ref({ status: 'idle', items: [], error: '' })
let noteRequest = 0

function settledValue(result) {
  return result.status === 'fulfilled' ? result.value : null
}

async function readMemories() {
  try {
    const catalog = await getMemoryCatalog({ includeArchived: false })
    memories.value = rememberedSentences(catalog)
    memoryError.value = ''
  } catch {
    memories.value = []
    memoryError.value = '暂时读不到这部分内容，请稍后再来看看。'
  }
  return new Map(memories.value.map((memory) => [memory.id, memory]))
}

// Only days the host has already finished are read; see journalDaysFromJobs.
async function readEntries(memoriesById) {
  const days = journalDaysFromJobs(await getBackgroundJobStatus())
  const journals = await Promise.allSettled(
    days.map((day) => getDailyJournal({ userId: 'local', journalDate: day }))
  )
  return journals
    .map(settledValue)
    .map((journal, index) => journal && (journal.journalDate || journal.journal_date) === days[index]
      ? buildNotebookEntry(journal, memoriesById)
      : null)
    .filter(Boolean)
}

// Weekly entries are an addition: a host without them (or a failed read)
// simply shows the daily pages.
async function readWeeks() {
  try {
    const digests = await getWeeklyDigests()
    return (Array.isArray(digests) ? digests : [])
      .map(buildWeeklyEntry)
      .filter(Boolean)
  } catch {
    return []
  }
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [memoriesById, plan] = await Promise.all([
      readMemories(),
      agentRepository.getLatestStudyPlan('local').catch(() => null)
    ])
    practice.value = nextPractice(plan)
    entries.value = await readEntries(memoriesById)
    weeks.value = await readWeeks()
  } catch {
    entries.value = []
    weeks.value = []
    loadError.value = '札记暂时打不开，请稍后再试。'
  } finally {
    loading.value = false
  }
}

async function tidyToday() {
  tidying.value = true
  notice.value = ''
  actionError.value = ''
  try {
    await triggerDailyDream({ userId: 'local', day: new Date().toISOString().slice(0, 10) })
    await load()
    notice.value = '今天的练习已整理进札记。'
  } catch {
    actionError.value = '今天暂时整理不了，稍后会自动整理。'
  } finally {
    tidying.value = false
  }
}

function setBusy(id, value) {
  const next = new Set(busy.value)
  if (value) next.add(id); else next.delete(id)
  busy.value = next
}

async function markInaccurate(memory) {
  setBusy(memory.id, true)
  notice.value = ''
  actionError.value = ''
  try {
    await recordMemoryFeedback(memory.id, 'inaccurate')
    notice.value = '已记下。这一句会在下次整理时被重新审视。'
    await readMemories()
  } catch {
    actionError.value = '没能记下这条反馈，请稍后再试。'
  } finally {
    setBusy(memory.id, false)
  }
}

async function forget(memory) {
  if (!window.confirm('忘记后，这一句和它的依据都会被删除，无法恢复。你的练习记录不受影响。确定忘记吗？')) return
  setBusy(memory.id, true)
  notice.value = ''
  actionError.value = ''
  try {
    await forgetMemory({ memoryId: memory.id, expectedVersion: memory.version, reason: 'user_notebook_forget' })
    notice.value = '已忘记。'
    await readMemories()
  } catch {
    actionError.value = '没能忘记这一句，请刷新后再试。'
  } finally {
    setBusy(memory.id, false)
  }
}

function noteKey(entry, note) {
  return `${entry.day}-${note.id}`
}

function evidenceItems(result) {
  return (result?.items || []).map((observation) => ({
    id: observation.id,
    text: observation.original,
    route: observation.events.find((event) => event.route)?.route || null
  }))
}

async function toggleNote(entry, note) {
  const key = noteKey(entry, note)
  const request = ++noteRequest
  if (openNote.value === key) {
    openNote.value = ''
    return
  }
  openNote.value = key
  noteState.value = { status: 'loading', items: [], error: '' }
  try {
    const result = await getMemoryEvidence(note.evidenceIds)
    if (request !== noteRequest) return
    noteState.value = { status: 'ready', items: evidenceItems(result), error: '' }
  } catch {
    if (request !== noteRequest) return
    noteState.value = { status: 'error', items: [], error: '依据暂时读不出来。' }
  }
}

onMounted(load)
</script>

<style scoped>
/* A single reading column: dated entries like pages of a notebook. */
.notebook-page {
  display: grid;
  gap: 0;
  max-width: 44rem;
  margin: 0 auto;
}

.notebook-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
}

.notebook-header h1 {
  margin: 0 0 8px;
}

.notebook-lede {
  margin: 0;
  max-width: var(--anth-measure);
  color: var(--anth-ink-soft);
  font-size: var(--anth-text-md);
  line-height: var(--anth-leading-relaxed);
}

.notebook-quiet {
  margin: 0;
  color: var(--anth-ink-faint);
  font-size: var(--anth-text-sm);
}

.notebook-quiet p {
  margin: 0 0 6px;
}

.notebook-empty {
  padding: 8px 0 48px;
  color: var(--anth-ink-soft);
  line-height: var(--anth-leading-relaxed);
}

.notebook-empty p {
  margin: 0;
  max-width: var(--anth-measure);
}

.notebook-empty__title {
  margin-bottom: 6px !important;
  color: var(--anth-ink-strong);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-lg);
}

.notebook-entry {
  padding: 8px 0 44px;
  animation: atlas-fade-in var(--anth-duration-slow) var(--anth-ease) both;
}

.notebook-entry + .notebook-entry {
  padding-top: 36px;
  border-top: 1px solid var(--anth-rule);
}

.notebook-entry__head {
  margin-bottom: 18px;
}

.notebook-entry__head time {
  display: block;
  margin-bottom: 4px;
  color: var(--anth-ink-faint);
  font-size: var(--anth-text-sm);
  font-variant-numeric: lining-nums tabular-nums;
}

.notebook-entry__head h2 {
  margin: 0;
  font-size: var(--anth-text-xl);
  line-height: var(--anth-leading-snug);
}

.notebook-section + .notebook-section {
  margin-top: 22px;
}

.notebook-section h3 {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0 0 6px;
  color: var(--anth-ink-strong);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-md);
}

.notebook-mark {
  color: var(--anth-ink-faint);
  font-weight: var(--anth-weight-normal);
}

.notebook-prose,
.notebook-notes,
.notebook-changes,
.notebook-practice {
  max-width: var(--anth-measure);
  margin: 0;
  color: var(--anth-ink);
  font-family: var(--anth-font-serif);
  font-size: 1.0625rem;
  line-height: var(--anth-leading-relaxed);
}

.notebook-prose--quiet {
  margin-top: 6px;
  color: var(--anth-ink-soft);
}

.notebook-notes {
  display: grid;
  gap: 4px;
  margin-top: 6px;
  padding: 0;
  list-style: none;
}

/* Footnote marker: a small superscript numeral that opens inline. */
.notebook-ref {
  min-width: 1.4em;
  min-height: 0;
  margin-left: 2px;
  padding: 0 2px;
  border: 0;
  background: transparent;
  color: var(--anth-accent-strong);
  font-family: var(--anth-font-sans);
  font-size: 0.72em;
  font-variant-numeric: lining-nums;
  line-height: 1;
  vertical-align: super;
  cursor: pointer;
}

.notebook-ref[aria-expanded="true"] {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.notebook-footnote {
  display: grid;
  gap: 4px;
  margin: 6px 0 8px;
  padding-left: 14px;
  border-left: 1px solid var(--anth-ink);
  color: var(--anth-ink-soft);
  font-family: var(--anth-font-sans);
  font-size: var(--anth-text-sm);
  line-height: var(--anth-leading-normal);
}

.notebook-footnote__item .text-link {
  margin-left: 8px;
}

.notebook-changes {
  display: grid;
  gap: 2px;
}

.notebook-changes > div {
  display: grid;
  grid-template-columns: 6em minmax(0, 1fr);
  gap: 12px;
}

.notebook-changes dt {
  color: var(--anth-ink-faint);
  font-family: var(--anth-font-sans);
  font-size: var(--anth-text-sm);
  line-height: 1.95;
}

.notebook-changes dd {
  margin: 0;
}

.notebook-practice {
  display: grid;
  gap: 10px;
  padding-left: 1.4em;
}

.notebook-practice li::marker {
  color: var(--anth-ink-faint);
  font-family: var(--anth-font-sans);
  font-size: var(--anth-text-sm);
}

.notebook-practice strong {
  display: block;
  font-weight: var(--anth-weight-semibold);
}

.notebook-practice span {
  color: var(--anth-ink-soft);
}

.notebook-practice__time {
  margin-left: 8px;
  color: var(--anth-ink-faint) !important;
  font-family: var(--anth-font-sans);
  font-size: var(--anth-text-sm);
  font-variant-numeric: lining-nums tabular-nums;
}

.notebook-standalone {
  padding-bottom: 44px;
}

/* What the system remembers: plain sentences, two quiet actions each. */
.notebook-memory {
  display: grid;
  gap: 10px;
  padding-top: 28px;
  border-top: 1px solid var(--anth-ink);
}

.notebook-memory h2 {
  margin: 0;
  font-size: var(--anth-text-lg);
}

.notebook-memory__list {
  display: grid;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--anth-rule);
}

.notebook-memory__list li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 16px;
  padding: 12px 0;
  border-bottom: 1px solid var(--anth-rule);
}

.notebook-memory__list p {
  margin: 0;
  color: var(--anth-ink);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-md);
  line-height: var(--anth-leading-relaxed);
}

.notebook-memory__actions {
  display: flex;
  gap: 14px;
  white-space: nowrap;
}

.notebook-memory__actions .btn-text {
  min-height: 32px;
  color: var(--anth-ink-faint);
  font-size: var(--anth-text-sm);
}

.notebook-memory__actions .btn-text:hover:not(:disabled) {
  color: var(--anth-ink);
}

@media (max-width: 640px) {
  .notebook-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .notebook-memory__list li {
    grid-template-columns: 1fr;
    gap: 4px;
  }

  .notebook-changes > div {
    grid-template-columns: 1fr;
    gap: 0;
  }
}
</style>
