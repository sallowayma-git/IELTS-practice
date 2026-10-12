<template>
  <section class="notebook-page" data-notebook>
    <header class="page-header notebook-header">
      <div class="page-header-top">
        <div class="notebook-header__copy">
          <p class="page-header-kicker">NOTEBOOK · 札记</p>
          <h1 class="heading-serif">札记</h1>
        </div>
        <div class="page-header-actions">
          <button class="btn btn-secondary" type="button" :disabled="tidying || loading" data-notebook-tidy @click="tidyToday">
            {{ tidying ? '正在整理…' : '整理今天' }}
          </button>
        </div>
      </div>
      <p class="page-header-desc">练习之后，系统会把当天的情况整理成一篇短记：看到了什么，哪里在变，接下来练什么。</p>
    </header>

    <div class="notebook-layout">
      <div class="notebook-main">
        <p v-if="notice" class="inline-message inline-message-success" role="status">{{ notice }}</p>
        <p v-if="actionError" class="inline-message inline-message-error" role="alert">{{ actionError }}</p>

        <p v-if="loading" class="section-meta" role="status" aria-live="polite">正在翻开札记…</p>

        <template v-else>
          <div v-if="loadError" class="inline-message inline-message-error" role="alert">
            <p>{{ loadError }}</p>
            <button class="btn btn-text btn-sm" type="button" @click="load">再试一次</button>
          </div>

          <div v-else-if="!entries.length && !weeks.length" class="notebook-empty empty-state" role="status">
            <h3>札记还是空白的一页。</h3>
            <p class="empty-state-desc">练习过的日子，系统会在第二天把它整理成一篇札记放在这里；想提前看，可以点「整理今天」。先去读一篇文章或写一篇作文吧。</p>
            <router-link class="btn btn-secondary btn-sm empty-state-action" to="/">去读一篇文章</router-link>
          </div>

          <article
            v-for="(week, weekIndex) in weeks"
            :id="`notebook-week-${weekIndex}`"
            :key="`${week.window}:${week.startDay}`"
            class="notebook-entry section has-rule"
            :data-notebook-week="week.window"
          >
            <header class="section-head">
              <h2 class="heading-serif">{{ week.title }}</h2>
              <time class="section-meta" :datetime="week.startDay">{{ week.dateLabel }}</time>
            </header>

            <div class="notebook-stats" aria-label="本周概览">
              <div class="stat">
                <span class="stat-label">观察</span>
                <span class="stat-value">{{ week.observations.length }}</span>
              </div>
              <div class="stat">
                <span class="stat-label">变化</span>
                <span class="stat-value">{{ week.changes.length }}</span>
              </div>
              <div class="stat">
                <span class="stat-label">下一步</span>
                <span class="stat-value">{{ week.nextPractice.length }}</span>
              </div>
            </div>

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
            :id="`notebook-day-${entryIndex}`"
            :key="entry.day"
            class="notebook-entry section has-rule"
            :data-notebook-entry="entry.day"
          >
            <header class="section-head">
              <h2 class="heading-serif">{{ entry.title }}</h2>
              <time class="section-meta" :datetime="entry.day">{{ entry.dateLabel }}</time>
            </header>

            <section v-if="entry.observations.length || entry.notes.length" class="notebook-section">
              <h3><span class="notebook-mark" aria-hidden="true">§</span>观察</h3>
              <p v-if="entry.observations.length" class="notebook-prose">{{ entry.observations.join('') }}</p>
              <ul v-if="entry.notes.length" class="notebook-notes">
                <li v-for="(note, noteIndex) in entry.notes" :key="note.id">
                  <span>{{ note.statement }}。{{ phraseHead(note.phrase) }}<span class="notebook-tail">{{ phraseLast(note.phrase) }}<button
                    v-if="note.evidenceIds.length"
                    class="notebook-ref"
                    type="button"
                    :aria-expanded="openNote === noteKey(entry, note)"
                    :aria-controls="`note-${noteKey(entry, note)}`"
                    :aria-label="`查看第 ${noteIndex + 1} 条依据`"
                    @click="toggleNote(entry, note)"
                  >{{ noteIndex + 1 }}</button></span></span>
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
            </section>

            <section v-if="entry.changes.improved.length || entry.changes.recurring.length" class="notebook-section">
              <h3><span class="notebook-mark" aria-hidden="true">§</span>变化</h3>
              <p v-if="entry.changeLead" class="notebook-prose notebook-lead">{{ entry.changeLead }}</p>
              <dl class="notebook-changes">
                <div v-if="entry.changes.improved.length">
                  <dt>在变好</dt>
                  <dd>
                    <span v-for="item in entry.changes.improved" :key="item" class="tag tag-success">{{ item }}</span>
                  </dd>
                </div>
                <div v-if="entry.changes.recurring.length">
                  <dt>反复出现</dt>
                  <dd>
                    <span v-for="item in entry.changes.recurring" :key="item" class="tag tag-warning">{{ item }}</span>
                  </dd>
                </div>
              </dl>
            </section>

            <section v-if="entryIndex === 0 && !weeks.length && practice.length" class="notebook-section" data-notebook-next>
              <h3><span class="notebook-mark" aria-hidden="true">§</span>下一步练习</h3>
              <p v-if="practiceLine" class="notebook-prose notebook-lead">{{ practiceLine }}</p>
              <ol class="notebook-practice">
                <li v-for="item in practice" :key="item.id">
                  <strong>{{ item.label }}</strong>
                  <span v-if="item.why">{{ item.why }}</span>
                  <span v-if="item.minutes" class="notebook-practice__time">约 {{ item.minutes }} 分钟</span>
                </li>
              </ol>
            </section>
          </article>

          <section v-if="!entries.length && !weeks.length && practice.length" class="section has-rule notebook-entry" data-notebook-next>
            <header class="section-head">
              <h2 class="heading-serif">下一步练习</h2>
            </header>
            <ol class="notebook-practice">
              <li v-for="item in practice" :key="item.id">
                <strong>{{ item.label }}</strong>
                <span v-if="item.why">{{ item.why }}</span>
                <span v-if="item.minutes" class="notebook-practice__time">约 {{ item.minutes }} 分钟</span>
              </li>
            </ol>
          </section>

          <section class="section has-rule notebook-memory" aria-labelledby="notebook-memory-title" data-notebook-memory>
            <header class="section-head">
              <h2 id="notebook-memory-title" class="heading-serif">关于你，我们记住了</h2>
            </header>
            <p class="page-header-desc">这是系统目前对你的理解。哪一句不对，就告诉我们；不想被记住，就让它忘记。</p>
            <p v-if="memoryError" class="inline-message inline-message-error" role="alert">{{ memoryError }}</p>
            <p v-else-if="!memories.length" class="section-meta">还没有记住什么。多练几次，这里会出现系统对你的了解。</p>
            <ol v-else class="list notebook-memory__list">
              <li v-for="memory in memories" :key="memory.id" class="list-row notebook-memory__row" :data-memory-id="memory.id">
                <p class="notebook-memory__text">{{ memory.statement }}</p>
                <div class="notebook-memory__actions">
                  <button class="btn btn-text btn-sm" type="button" :disabled="busy.has(memory.id)" @click="markInaccurate(memory)">不准确</button>
                  <button class="btn btn-text btn-sm" type="button" :disabled="busy.has(memory.id)" @click="forget(memory)">忘记</button>
                </div>
              </li>
            </ol>
          </section>
        </template>
      </div>

      <aside v-if="indexItems.length" class="notebook-index" aria-label="札记目录" data-notebook-index>
        <p class="page-header-kicker">目录</p>
        <ul class="list notebook-index__list">
          <li v-for="item in indexItems" :key="item.id">
            <button
              type="button"
              class="list-row notebook-index__row"
              :class="{ 'is-selected': item.id === currentId }"
              :aria-current="item.id === currentId ? 'true' : undefined"
              @click="jumpTo(item.id)"
            >
              <span class="list-row-main">
                <span class="list-row-title">{{ item.label }}</span>
                <span class="list-row-meta">{{ item.title }}</span>
              </span>
            </button>
          </li>
        </ul>
      </aside>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
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
  ENTRY_LIMIT,
  buildWeeklyEntry,
  isPracticed,
  journalWindow,
  nextPractice,
  practiceLead,
  previousPracticedDay,
  rememberedSentences
} from '@/modules/notebook/compose.js'

const loading = ref(true)
const loadError = ref('')
const entries = ref([])
const weeks = ref([])
const memories = ref([])
const memoryError = ref('')
const practice = ref([])
// Worded for the newest entry's day, where the plan is shown.
const practiceLine = computed(() => practiceLead(practice.value, entries.value[0]?.day))
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

// Only days the host has already finished are read; see journalWindow.
// An entry's gap runs back to the previous day with practice. The first
// ENTRY_LIMIT days are read; older days are read only while an entry still has
// no answer, so a notebook with recent practice never reads the whole window.
async function readEntries(memoriesById) {
  const { days, cutOff } = journalWindow(await getBackgroundJobStatus())
  const journals = new Map()
  const practiced = new Map()
  const readBatch = async (batch) => {
    const reads = await Promise.allSettled(
      batch.map((day) => getDailyJournal({ userId: 'local', journalDate: day }))
    )
    batch.forEach((day, index) => {
      const journal = settledValue(reads[index])
      const matches = Boolean(journal) && (journal.journalDate || journal.journal_date) === day
      journals.set(day, matches ? journal : null)
      practiced.set(day, matches ? isPracticed(journal) : undefined)
    })
  }
  const shown = () => days.slice(0, ENTRY_LIMIT)
  const unanswered = () => shown().some((_, index) => previousPracticedDay(days, index, practiced, cutOff) === undefined)
  for (let next = 0; next < days.length; next += ENTRY_LIMIT) {
    await readBatch(days.slice(next, next + ENTRY_LIMIT))
    if (!unanswered()) break
  }
  return shown()
    .map((day, index) => journals.get(day)
      ? buildNotebookEntry(journals.get(day), memoriesById, { previousDay: previousPracticedDay(days, index, practiced, cutOff) })
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

// The marker must not wrap alone: it stays in one unbreakable run with the last glyph.
function phraseHead(text) {
  return [...String(text || '')].slice(0, -1).join('')
}

function phraseLast(text) {
  return [...String(text || '')].at(-1) || ''
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

const indexItems = computed(() => weeks.value.length
  ? weeks.value.map((week, index) => ({ id: `notebook-week-${index}`, label: week.dateLabel, title: week.title }))
  : entries.value.map((entry, index) => ({ id: `notebook-day-${index}`, label: entry.dateLabel, title: entry.title })))
const activeId = ref('')
const currentId = computed(() => activeId.value || indexItems.value[0]?.id)

function jumpTo(id) {
  activeId.value = id
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  document.getElementById(id)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
}

onMounted(load)
</script>

<style scoped>
/* Editorial journal: one prose column, a sticky week index on the right. */
.notebook-layout {
  display: grid;
  grid-template-columns: minmax(0, var(--anth-prose-max)) 200px;
  gap: 56px;
  align-items: start;
  justify-content: start;
}

.notebook-empty h3 {
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-lg);
}

.notebook-entry {
  scroll-margin-top: var(--anth-space-5);
  animation: atlas-fade-in var(--anth-duration-slow) var(--anth-ease) both;
}

.notebook-stats {
  display: flex;
}

.notebook-section h3 {
  display: flex;
  align-items: baseline;
  gap: var(--anth-space-2);
  margin: 0 0 6px;
  color: var(--anth-ink-strong);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-md);
}

.notebook-prose,
.notebook-notes,
.notebook-changes,
.notebook-practice,
.notebook-memory__text {
  max-width: var(--anth-measure);
  margin: 0;
  color: var(--anth-ink);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-body-lg-size);
  line-height: var(--anth-text-body-lg-line);
}

.notebook-notes {
  display: grid;
  gap: 4px;
  margin-top: 6px;
  padding: 0;
  list-style: none;
}

/* The last glyph of a note and its footnote marker never break apart. */
.notebook-tail {
  white-space: nowrap;
}

/* Footnote marker: a small superscript numeral that opens inline. */
.notebook-ref {
  min-width: 1.4em;
  padding: 0 2px;
  border: 0;
  background: transparent;
  color: var(--anth-accent-strong);
  font-size: 0.72em;
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

.notebook-changes > div {
  display: grid;
  grid-template-columns: 6em minmax(0, 1fr);
  gap: 12px;
  margin-top: 4px;
}

.notebook-changes dt {
  color: var(--anth-ink-muted);
  font-family: var(--anth-font-sans);
  font-size: var(--anth-text-sm);
}

.notebook-changes dd {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
}

.notebook-practice {
  display: grid;
  gap: 10px;
  padding-left: 1.4em;
}

.notebook-practice strong {
  display: block;
  font-weight: var(--anth-weight-semibold);
}

.notebook-practice .notebook-practice__time {
  margin-left: 8px;
  color: var(--anth-ink-muted);
  font-family: var(--anth-font-sans);
  font-size: var(--anth-text-sm);
}

.notebook-memory__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.notebook-memory__row {
  grid-template-columns: minmax(0, 1fr) auto;
}

.notebook-memory__actions {
  display: flex;
  gap: var(--anth-space-3);
  white-space: nowrap;
}

/* Index rail: plain anchors; the active row is the one last jumped to. */
.notebook-index {
  position: sticky;
  top: var(--anth-space-5);
  display: grid;
  gap: var(--anth-space-2);
}

.notebook-index__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.notebook-index__row {
  grid-template-columns: minmax(0, 1fr);
  width: 100%; min-height: 0;
  border: 0;
  border-bottom: 1px solid var(--anth-rule);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

@media (max-width: 960px) {
  .notebook-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .notebook-index {
    display: none;
  }
}
</style>
