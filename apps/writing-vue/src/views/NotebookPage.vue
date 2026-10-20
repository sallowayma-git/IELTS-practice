<template>
  <section class="notebook-page" data-notebook>
    <header class="page-header notebook-header">
      <div class="page-header-top">
        <div class="notebook-header__copy">
          <p class="page-header-kicker">NOTEBOOK · 札记</p>
          <h1 class="heading-serif">札记</h1>
        </div>
        <div class="page-header-actions">
          <button class="btn notebook-btn-tidy" type="button" :disabled="tidying || loading" data-notebook-tidy @click="tidyToday">
            {{ tidying ? '正在整理…' : '整理今天' }}
          </button>
        </div>
      </div>
      <p class="page-header-desc">练习之后，系统会把当天的情况整理成一篇短记：看到了什么，哪里在变，接下来练什么。</p>
    </header>

    <p v-if="notice" class="inline-message inline-message-success" role="status">{{ notice }}</p>
    <p v-if="actionError" class="inline-message inline-message-error" role="alert">{{ actionError }}</p>
    <p v-if="loading" class="section-meta" role="status" aria-live="polite">正在翻开札记…</p>

    <template v-else>
      <div v-if="loadError" class="inline-message inline-message-error" role="alert">
        <p>{{ loadError }}</p>
        <button class="btn btn-text btn-sm" type="button" @click="load">再试一次</button>
      </div>

      <MascotState
        v-else-if="!entries.length && !weeks.length"
        kind="empty"
        class="notebook-empty"
        title="札记还是空白的一页。"
        desc="练习过的日子，系统会在第二天把它整理成一篇札记放在这里；想提前看，可以点「整理今天」。先去读一篇文章或写一篇作文吧。"
      >
        <router-link class="btn btn-secondary btn-sm empty-state-action" to="/">去读一篇文章</router-link>
      </MascotState>

      <template v-else>
        <section v-if="weeks.length" class="notebook-section-block">
          <div class="notebook-month-nav">
            <h2 class="notebook-block-title heading-serif">每周整理</h2>
            <nav aria-label="周记月份">
              <button type="button" aria-label="上个月" @click="changeMonth(-1)">‹</button>
              <span data-notebook-month>{{ monthLabel }}</span>
              <button type="button" aria-label="下个月" @click="changeMonth(1)">›</button>
            </nav>
          </div>
          <div class="notebook-shelf">
            <template v-for="(slot, index) in monthlySlots" :key="slot.day">
              <button
                v-if="slot.week"
                type="button"
                class="notebook-week-card"
                :class="[`notebook-fill--${weekFill(index)}`, { 'notebook-week-card--dense': slot.week.schemaVersion >= 2 }]"
                :style="weekCardStyle(index)"
                :data-notebook-week="slot.week.window"
                :data-week-state="slot.week.state"
                @click="openWeek(weeks.indexOf(slot.week))"
              >
                <Doodle class="notebook-week-card__doodle" :name="weekDoodle(slot.week)" :size="40" />
                <div class="notebook-week-card__numeral">
                  <span class="notebook-week-card__num">{{ weekNumeral(slot.week) }}</span>
                  <span class="notebook-kicker">{{ weekRange(slot.week) }}</span>
                </div>
                <p v-if="slot.week.title" class="notebook-week-card__title">{{ slot.week.title }}</p>
                <p v-if="slot.week.firstSentence" class="notebook-week-card__excerpt">{{ slot.week.firstSentence }}</p>
                <ul v-if="slot.week.points.length" class="notebook-week-card__points">
                  <li v-for="(point, pointIndex) in slot.week.points" :key="pointIndex">{{ point }}</li>
                </ul>
                <p v-if="weekFooter(slot.week)" class="notebook-kicker notebook-week-card__footer">{{ weekFooter(slot.week) }}</p>
              </button>
              <div v-else class="notebook-week-card notebook-week-card--placeholder" :style="weekCardStyle(index)" data-weekly-slot>这周的周记还在路上</div>
            </template>
            <div class="notebook-week-card notebook-week-card--monthly" :style="weekCardStyle(monthlySlots.length)" data-monthly-placeholder>月记 · 即将推出</div>
          </div>
        </section>

        <section v-if="entries.length" class="notebook-section-block">
          <h2 class="notebook-block-title heading-serif">每日札记</h2>
          <div class="notebook-board-scroll">
            <div class="notebook-board">
              <article
                v-for="(entry, index) in entries"
                :key="entry.day"
                class="notebook-day-card"
                :class="`notebook-fill--${dayFill(index)}`"
                :data-notebook-day="entry.day"
                :data-notebook-entry="entry.day"
                tabindex="0"
                role="button"
                @click="openDay(index)"
                @keydown.enter="openDay(index)"
              >
                <Doodle class="notebook-day-card__doodle" :name="dayDoodle(entry)" :size="32" />
                <div class="notebook-day-card__numeral">
                  <span class="notebook-day-card__num">{{ dayNumeral(entry) }}</span>
                  <span class="notebook-kicker">{{ dayKicker(entry) }}</span>
                </div>
                <p class="notebook-day-card__title">{{ entry.title }}</p>
                <ul v-if="entry.summaryLines.length" class="notebook-day-card__obs">
                  <li v-for="line in entry.summaryLines" :key="line">{{ line }}</li>
                </ul>
                <div v-if="entry.changes.improved.length || entry.changes.recurring.length" class="notebook-day-card__tags">
                  <span v-for="item in entry.changes.improved" :key="item" class="notebook-pill notebook-pill--mint">{{ item }}</span>
                  <span v-for="item in entry.changes.recurring" :key="item" class="notebook-pill notebook-pill--mustard">{{ item }}</span>
                </div>
                <div class="notebook-day-card__foot">
                  <p v-if="entry.notes.length" class="notebook-kicker notebook-day-card__footer">{{ entry.notes.length }} 条依据</p>
                  <MoodMascot
                    class="notebook-day-card__mood"
                    :mood="dayMood(entry)"
                    :size="36"
                    :label="dayMoodLabel(entry)"
                  />
                </div>
              </article>
            </div>
          </div>
        </section>
      </template>

      <section class="section has-rule notebook-memory" aria-labelledby="notebook-memory-title" data-notebook-memory>
        <header class="section-head">
          <h2 id="notebook-memory-title" class="heading-serif">关于你，我们记住了</h2>
        </header>
        <LearnerPreferences />
        <h3 class="notebook-memory__subtitle">系统观察到的</h3>
        <p class="page-header-desc">这是系统从你的练习里学到的。哪一句不对，就告诉我们；不想被记住，就让它忘记。</p>
        <p v-if="memoryError" class="inline-message inline-message-error" role="alert">{{ memoryError }}</p>
        <p v-else-if="!memories.length" class="section-meta">还没有记住什么。多练几次，这里会出现系统对你的了解。</p>
        <div v-else class="notebook-memory__grid">
          <div v-for="memory in memories" :key="memory.id" class="notebook-memory__card" :data-memory-id="memory.id">
            <p class="notebook-memory__text">{{ memory.statement }}</p>
            <div class="notebook-memory__actions">
              <button class="btn btn-text btn-sm" type="button" :disabled="busy.has(memory.id)" @click="markInaccurate(memory)">不准确</button>
              <button class="btn btn-text btn-sm" type="button" :disabled="busy.has(memory.id)" @click="forget(memory)">忘记</button>
            </div>
          </div>
        </div>
      </section>
    </template>

    <NotebookSheet
      :open="sheetOpen"
      :doodle-name="sheet.doodleName"
      :mood="sheet.mood"
      :mood-label="sheet.moodLabel"
      :numeral="sheet.numeral"
      :kicker="sheet.kicker"
      :title="sheet.title"
      :fill="sheet.fill"
      :change-lead="sheet.changeLead"
      :changes="sheet.changes"
      :next-practice="sheet.nextPractice"
      :practice-line="sheet.practiceLine"
      :practice-items="sheet.practiceItems"
      @close="closeSheet"
    >
      <template v-if="sheet.week" #weekly>
        <WeeklyDetail :key="sheet.week.window" :entry="sheet.week" @navigate="closeSheet" />
      </template>
      <template v-if="showReading" #reading>
        <ul class="notebook-notes">
          <li v-for="line in sheet.entry.reading.lines" :key="line.kind"><span>{{ line.text }}</span></li>
          <li v-if="sheet.entry.reading.topMiss"><span>{{ sheet.entry.reading.topMiss }}</span></li>
        </ul>
      </template>
      <template v-if="sheet.entry?.writing?.lines.length" #writing>
        <ul class="notebook-notes">
          <li v-for="line in sheet.entry.writing.lines" :key="line"><span>{{ line }}</span></li>
        </ul>
      </template>
      <template v-if="sheet.entry?.model?.lines.length" #model>
        <ul class="notebook-notes">
          <li v-for="line in sheet.entry.model.lines" :key="line"><span>{{ line }}</span></li>
        </ul>
      </template>
      <template v-if="sheet.entry?.tomorrow?.line" #tomorrow>
        <p class="notebook-prose notebook-lead">{{ sheet.entry.tomorrow.line }}</p>
        <p v-if="sheet.entry.tomorrow.link" class="notebook-prose">{{ sheet.entry.tomorrow.link }}</p>
      </template>
      <template v-if="sheetKind === 'day'" #observations>
        <p v-if="sheet.observations.length" class="notebook-prose">{{ sheet.observations.join('') }}</p>
        <ul v-if="sheet.notes.length" class="notebook-notes">
          <li v-for="(note, noteIndex) in sheet.notes" :key="note.id">
            <span>{{ note.statement }}。{{ phraseHead(note.phrase) }}<span class="notebook-tail">{{ phraseLast(note.phrase) }}<button
              v-if="note.evidenceIds.length"
              class="notebook-ref"
              type="button"
              :aria-expanded="openNote === noteKey(sheet.entry, note)"
              :aria-controls="`note-${noteKey(sheet.entry, note)}`"
              :aria-label="`查看第 ${noteIndex + 1} 条依据`"
              @click="toggleNote(sheet.entry, note)"
            >{{ noteIndex + 1 }}</button></span></span>
            <span
              v-if="openNote === noteKey(sheet.entry, note)"
              :id="`note-${noteKey(sheet.entry, note)}`"
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
      </template>
    </NotebookSheet>
  </section>
</template>

<script setup>
import MascotState from '@/components/mascot/MascotState.vue'
import MoodMascot from '@/components/mascot/MoodMascot.vue'
import { dayMood, moodLabel } from '@/components/mascot/moodFor.js'
import { computed, onMounted, ref } from 'vue'
import agentRepository from '@/api/agent-repository.js'
import { getMemoryEvidence } from '@/api/learning-repository.js'
import {
  forgetMemory,
  getBackgroundJobStatus,
  getCurrentWeeklyReport,
  getDailyJournal,
  getMemoryCatalog,
  getWeeklyHistory,
  getWeeklyReports,
  recordMemoryFeedback,
  triggerDailyDream
} from '@/api/memory-repository.js'
import {
  buildNotebookEntry,
  ENTRY_LIMIT,
  isPracticed,
  journalWindow,
  nextPractice,
  practiceLead,
  previousPracticedDay,
  rememberedSentences,
  streakLength
} from '@/modules/notebook/compose.js'
import { localDay } from '@/modules/agent-console/format.js'
import LearnerPreferences from '@/modules/notebook/LearnerPreferences.vue'
import { weeklyEntries, weeklyMonth, weeklyMonthSlots, weeklySequence } from '@/modules/notebook/weekly.js'
import { legacyWeeklyEntry } from '@/modules/notebook/legacy.js'
import { pickIcon, pickObject } from '@/modules/notebook/doodles.js'
import Doodle from '@/modules/notebook/components/Doodle.vue'
import NotebookSheet from '@/modules/notebook/components/NotebookSheet.vue'
import WeeklyDetail from '@/modules/notebook/components/WeeklyDetail.vue'

const PALETTE = ['tomato', 'mustard', 'mint', 'pink', 'sky', 'cream']
const ROTATIONS = [-9, -5, -1, 3, 7, 11]
const WEEK_CARD_WIDTH = 220
const WEEK_CARD_OVERLAP = 0.18

const loading = ref(true)
const loadError = ref('')
const entries = ref([])
const weeks = ref([])
const selectedMonth = ref(localDay(new Date()).slice(0, 7))
const monthLabel = computed(() => `${Number(selectedMonth.value.slice(0, 4))}年${Number(selectedMonth.value.slice(5))}月`)
const monthlySlots = computed(() => weeklyMonthSlots(weeks.value, selectedMonth.value))
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

function changeMonth(delta) {
  closeSheet()
  const date = new Date(`${selectedMonth.value}-01T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + delta)
  selectedMonth.value = date.toISOString().slice(0, 7)
}

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
async function readEntries(memoriesById, plan) {
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
      ? buildNotebookEntry(journals.get(day), memoriesById, {
        previousDay: previousPracticedDay(days, index, practiced, cutOff),
        streak: streakLength(days, index, practiced),
        plan
      })
      : null)
    .filter(Boolean)
}

// Weekly reports are an addition: a host without them (or a failed read)
// simply shows the daily pages. The live week, the finished v3 weeks and the
// read-only legacy digests are read apart, so one failing does not hide the
// others; a legacy week only fills a window no v3 report already covers.
async function readWeeks() {
  const [current, persisted, legacy] = await Promise.allSettled([
    getCurrentWeeklyReport(),
    getWeeklyReports(),
    getWeeklyHistory()
  ])
  const older = listRows(settledValue(legacy)).map(legacyWeeklyEntry).filter(Boolean)
  return weeklySequence(weeklyEntries(settledValue(current), settledValue(persisted), older))
}

function listRows(value) {
  return Array.isArray(value) ? value : []
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
    entries.value = await readEntries(memoriesById, practice.value)
    weeks.value = await readWeeks()
    if (weeks.value.length) selectedMonth.value = weeklyMonth(weeks.value[0])
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
    await triggerDailyDream({ userId: 'local', day: localDay(new Date()) })
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

// ---------------------------------------------------------------- display ---
// Pure presentation helpers: palette/doodle/numeral picks for the shelf and
// board, and the shared sheet's view-model. No data loading happens here.

function weekDoodle(week) {
  return pickObject(week.window)
}

function dayDoodle(entry) {
  return pickIcon(entry.day)
}

function weekFill(index) {
  return PALETTE[index % PALETTE.length]
}

function dayFill(index) {
  return index % 4 === 3 ? PALETTE[Math.floor(index / 4) % PALETTE.length] : 'cream'
}

function weekNumeral(week) {
  return String(week.sequence || '')
}

function weekRange(week) {
  const start = new Date(`${week.startDay}T00:00:00Z`)
  if (Number.isNaN(start.getTime())) return week.dateLabel
  const end = new Date(`${week.endDay}T00:00:00Z`)
  const fmt = (date) => `${date.getUTCMonth() + 1}.${date.getUTCDate()}`
  if (Number.isNaN(end.getTime())) return `${fmt(start)}–${fmt(new Date(start.getTime() + 6 * 86400000))}`
  return start.getTime() === end.getTime() ? fmt(start) : `${fmt(start)}–${fmt(end)}`
}

// The footer is data, not prose: the state's own word, plus the host's count.
function weekFooter(week) {
  const count = week.practiceCount === null || week.practiceCount === undefined ? '' : `依据 ${week.practiceCount} 次练习`
  if (week.state === 'live') return count ? `本周进行中 · ${count}` : '本周进行中'
  return count
}

function dayNumeral(entry) {
  return String(Number(entry.day.slice(8, 10)))
}

function dayKicker(entry) {
  return `${Number(entry.day.slice(5, 7))}月 · ${entry.weekday}`
}

function weekCardStyle(index) {
  return {
    marginLeft: index === 0 ? '0' : `${-(WEEK_CARD_WIDTH * WEEK_CARD_OVERLAP)}px`,
    '--nb-rotate': `${ROTATIONS[index % ROTATIONS.length]}deg`,
    // Later cards sit on top: each card covers the previous card's right edge, so
    // every card keeps its own left-aligned numeral and title readable.
    zIndex: index + 1
  }
}

/** Accessible name for a daily entry's mood mascot. */
function dayMoodLabel(entry) {
  return `当天状态：${moodLabel(dayMood(entry))}`
}

// ----------------------------------------------------------------- sheet ---

const showReading = computed(() => sheetKind.value === 'day' && Boolean(sheet.value.entry?.reading?.lines.length || sheet.value.entry?.reading?.topMiss))

const sheetOpen = ref(false)
const sheetKind = ref('week')
const sheetIndex = ref(null)

function openWeek(index) {
  if (index < 0) return
  sheetKind.value = 'week'
  sheetIndex.value = index
  sheetOpen.value = true
}

function openDay(index) {
  sheetKind.value = 'day'
  sheetIndex.value = index
  sheetOpen.value = true
}

function closeSheet() {
  sheetOpen.value = false
}

const sheet = computed(() => {
  if (sheetKind.value === 'week') {
    const week = weeks.value[sheetIndex.value] || null
    if (!week) return emptySheet()
    return {
      doodleName: weekDoodle(week),
      mood: '',
      moodLabel: '',
      numeral: weekNumeral(week),
      kicker: weekRange(week),
      title: week.title,
      week,
      fill: weekFill(sheetIndex.value),
      observations: [],
      notes: [],
      entry: null,
      changeLead: '',
      changes: null,
      nextPractice: [],
      practiceLine: '',
      practiceItems: []
    }
  }
  const entry = entries.value[sheetIndex.value] || null
  if (!entry) return emptySheet()
  const isNewest = sheetIndex.value === 0
  return {
    doodleName: pickObject(entry.day),
    mood: dayMood(entry),
    moodLabel: dayMoodLabel(entry),
    numeral: dayNumeral(entry),
    kicker: dayKicker(entry),
    title: entry.title,
    fill: dayFill(sheetIndex.value),
    observations: entry.observations,
    notes: entry.notes,
    entry,
    changeLead: entry.changeLead,
    changes: entry.changes,
    nextPractice: [],
    practiceLine: isNewest ? practiceLine.value : '',
    practiceItems: isNewest ? practice.value : []
  }
})

function emptySheet() {
  return {
    doodleName: 'open-book', mood: '', moodLabel: '', numeral: '', kicker: '', title: '', fill: 'cream',
    observations: [], notes: [], entry: null, changeLead: '', changes: null,
    nextPractice: [], practiceLine: '', practiceItems: []
  }
}

onMounted(load)
</script>

<style scoped>
/* 1940s rubber-hose print flavour, scoped to the notebook page only. */
.notebook-page {
  --nb-ink: #1E1A16;
  --nb-tomato: #E0643A;
  --nb-mustard: #E8B33A;
  --nb-mint: #A8D5BA;
  --nb-pink: #E9B9C4;
  --nb-sky: #9CC3DE;
  --nb-cream: #FFF8EA;
  /* Full-bleed paper: background spans the whole main area; the percentage
     padding centres the content in the shell width (--anth-shell-max-width). */
  flex: 1;
  position: relative;
  box-sizing: border-box;
  min-width: 0;
  padding: 24px max(clamp(16px, 3vw, 48px), calc((100% - var(--anth-shell-max-width)) / 2)) 32px;
  background-color: var(--nb-cream);
  background-image:
    radial-gradient(ellipse at center, transparent 55%, rgba(30, 26, 22, 0.1) 100%),
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E");
  color: var(--nb-ink);
  overflow-x: hidden;
}

.notebook-btn-tidy {
  border: 2.5px solid var(--nb-ink);
  border-radius: 10px;
  background: var(--nb-tomato);
  box-shadow: 4px 4px 0 var(--nb-ink);
  color: var(--nb-ink);
  font-weight: 700;
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.notebook-btn-tidy:not(:disabled):hover {
  transform: translate(-2px, -2px);
  box-shadow: 6px 6px 0 var(--nb-ink);
}

.notebook-btn-tidy:not(:disabled):active {
  transform: translate(0, 0);
  box-shadow: 2px 2px 0 var(--nb-ink);
}

.notebook-block-title {
  margin: 28px 0 14px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.notebook-empty {
  display: grid;
  justify-items: center;
  gap: 10px;
  text-align: center;
}

.notebook-empty h3 {
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-lg);
  font-weight: 700;
}

/* ---------------------------------------------------------------- shelf --- */
.notebook-month-nav { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 16px; }
.notebook-month-nav nav { display: flex; align-items: center; gap: 18px; }
.notebook-month-nav nav button { border: 0; background: transparent; color: inherit; font: inherit; font-size: 28px; cursor: pointer; padding: 4px 12px; }
/* Empty slots are dashed; the label sits in the strip the fan leaves visible
   (a slot's left edge is covered by the card in front of it). */
.notebook-week-card--placeholder, .notebook-week-card--monthly { display: flex; align-items: center; justify-content: center; padding: 14px 24px 14px 48px; text-align: center; background: #eeeae2; color: #77736b; border: 2px dashed #aaa59a; box-shadow: none; cursor: default; }

.notebook-shelf {
  display: flex;
  padding: 44px 60px 56px 28px;
  overflow-x: auto;
  overflow-y: visible;
  scroll-snap-type: x proximate;
}

.notebook-week-card {
  flex: none;
  position: relative;
  width: 220px;
  height: 300px;
  scroll-snap-align: start;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border: 2.5px solid var(--nb-ink);
  border-radius: 14px;
  box-shadow: 4px 4px 0 var(--nb-ink);
  background: var(--nb-fill);
  color: var(--nb-ink);
  text-align: left;
  cursor: pointer;
  transform: rotate(var(--nb-rotate, 0deg));
  transition: transform 160ms ease, box-shadow 160ms ease;
}

.notebook-week-card:hover,
.notebook-week-card:focus-visible {
  transform: translate(-6px, -6px) rotate(0deg);
  box-shadow: 6px 6px 0 var(--nb-ink);
  z-index: 50 !important;
}

.notebook-week-card:active {
  box-shadow: 2px 2px 0 var(--nb-ink);
}

.notebook-week-card__numeral {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  align-self: flex-end;
}

.notebook-week-card__footer { margin-top: auto; }
.notebook-week-card__doodle { position: absolute; top: 14px; left: 14px; }

.notebook-week-card__num {
  font-family: var(--anth-font-serif);
  font-size: 40px;
  font-weight: 700;
  line-height: 1;
}

.notebook-week-card__title {
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-md);
  font-weight: 700;
}

.notebook-week-card--dense .notebook-week-card__num { font-size: 28px; }
.notebook-week-card--dense .notebook-week-card__title { font-size: 15px; line-height: 1.4; -webkit-line-clamp: 2; }
.notebook-week-card__excerpt { margin: 0; font-size: 12px; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.notebook-week-card__points { margin: 0; padding-left: 14px; font-size: 11px; line-height: 1.4; }
.notebook-week-card__points li { display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }

/* --------------------------------------------------------------- board --- */
/* The scroll wrapper is the only element with a bounded height: a multicol
   element whose own height is constrained spills extra columns sideways
   instead of scrolling, so the columns live on an unconstrained inner div. */
.notebook-board-scroll {
  height: clamp(420px, calc(100vh - 360px), 760px);
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 4px 4px 0;
  scrollbar-width: thin;
}

.notebook-board {
  column-count: 1;
  column-gap: 16px;
}

@media (min-width: 760px) {
  .notebook-board { column-count: 2; }
}

@media (min-width: 1200px) {
  .notebook-board { column-count: 3; }
}

.notebook-day-card {
  break-inside: avoid;
  margin: 0 0 16px;
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 2.5px solid var(--nb-ink);
  border-radius: 14px;
  box-shadow: 4px 4px 0 var(--nb-ink);
  background: var(--nb-fill);
  color: var(--nb-ink);
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.notebook-day-card:hover,
.notebook-day-card:focus-visible {
  transform: translate(-2px, -2px);
  box-shadow: 6px 6px 0 var(--nb-ink);
}

.notebook-day-card:active {
  transform: translate(0, 0);
  box-shadow: 2px 2px 0 var(--nb-ink);
}

.notebook-day-card__numeral {
  display: flex;
  justify-content: flex-end;
  align-items: baseline;
  gap: 6px;
}

.notebook-day-card__num {
  font-family: var(--anth-font-serif);
  font-size: 28px;
  font-weight: 700;
  line-height: 1;
}

.notebook-day-card__title {
  margin: 0;
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-md);
  font-weight: 700;
}

.notebook-day-card__obs {
  margin: 0;
  padding-left: 1.1em;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: var(--anth-text-sm);
}

.notebook-day-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.notebook-day-card__foot {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px;
}

.notebook-day-card__mood {
  margin-left: auto;
}

/* ----------------------------------------------------------- fill cycle --- */
.notebook-fill--tomato { --nb-fill: var(--nb-tomato); }
.notebook-fill--mustard { --nb-fill: var(--nb-mustard); }
.notebook-fill--mint { --nb-fill: var(--nb-mint); }
.notebook-fill--pink { --nb-fill: var(--nb-pink); }
.notebook-fill--sky { --nb-fill: var(--nb-sky); }
.notebook-fill--cream { --nb-fill: var(--nb-cream); }

.notebook-pill {
  display: inline-block;
  padding: 2px 10px;
  border: 1.5px solid var(--nb-ink);
  border-radius: 999px;
  font-family: var(--anth-font-sans);
  font-size: var(--anth-text-xs);
}

.notebook-pill--mint { background: var(--nb-mint); }
.notebook-pill--mustard { background: var(--nb-mustard); }

/* -------------------------------------------------------------- memory --- */
.notebook-memory__subtitle {
  margin: 24px 0 0;
  color: var(--nb-ink);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-md);
}

.notebook-memory__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
  margin-top: 10px;
}

.notebook-memory__card {
  display: grid;
  gap: 8px;
  padding: 12px 14px;
  border: 2px solid var(--nb-ink);
  border-radius: 12px;
  background: var(--nb-cream);
}

.notebook-memory__text {
  margin: 0;
  font-family: var(--anth-font-serif);
}

.notebook-memory__actions {
  display: flex;
  gap: var(--anth-space-3);
}

@media (max-width: 760px) {
  .notebook-week-card { width: 180px; height: 260px; }
}

@media (prefers-reduced-motion: reduce) {
  .notebook-week-card,
  .notebook-day-card,
  .notebook-btn-tidy {
    transition: none;
  }
}
</style>
