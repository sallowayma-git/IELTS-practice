<template>
  <div class="workspace vocabulary-workspace">
    <section class="vocabulary-page scroll-region">
      <header class="page-header">
        <div class="page-header-top">
          <div class="vocabulary-head">
            <p class="page-header-kicker">VOCABULARY · 生词</p>
            <h1 class="heading-serif">生词本</h1>
          </div>
          <div v-if="!sessionOpen && !onlineOpen" class="page-header-actions">
            <button
              class="btn btn-primary"
              type="button"
              :disabled="loading || !!error || reviewCount === 0"
              @click="openSession"
            >
              开始复习（{{ reviewCount }}）
            </button>
          </div>
        </div>
        <p class="page-header-desc">复习到期和新收的单词。</p>
      </header>

      <VocabularySessionPanel
        v-if="sessionOpen"
        :items="items"
        @close="closeSession"
        @updated="applyUpdatedItem"
      />
      <VocabularyTraining v-if="onlineOpen" :book-id="bookId" :unit-id="unitId" :mode="onlineMode" :resume="onlineResume" :title="units.find(unit=>unit.id===unitId)?.title || ''" @close="onlineOpen=false" />

      <template v-if="!sessionOpen && !onlineOpen">
        <div v-if="books.length" class="vocabulary-toolbar" role="group" aria-label="词书范围">
          <select v-model="bookId" class="input" aria-label="选择词书" :disabled="loading" @change="changeBook">
            <option value="">全部生词</option>
            <option v-for="book in books" :key="book.id" :value="book.id">{{ book.title }}（{{ book.wordCount }}）</option>
          </select>
          <select v-if="bookId" v-model="unitId" class="input" aria-label="选择章节" :disabled="loading" @change="load">
            <option value="">全部章节</option>
            <option v-for="unit in units" :key="unit.id" :value="unit.id">{{ unit.title }}（{{ unit.wordCount }}）</option>
          </select>
        </div>
        <div v-if="selectedBook?.provider === 'idictation'" class="vocabulary-toolbar" aria-label="爱听写原站练习">
          <label>练习模式 <select v-model="onlineMode" class="input"><option :value="1">听写</option><option :value="2">听音选义</option><option :value="3">默写</option><option :value="4">看词选义</option></select></label>
          <label><input v-model="onlineResume" type="checkbox" /> 继续原站进度</label>
          <button class="btn btn-secondary" type="button" :disabled="loading || !!error || !unitId" @click="onlineOpen=true">开始爱听写练习</button>
          <p class="section-meta">选择具体章节后开始。需先在设置中连接爱听写；号码类词书仅支持听写。</p>
        </div>
        <p v-if="loading" class="section-meta" role="status" aria-live="polite">正在加载生词本…</p>

        <MascotState
          v-else-if="error"
          kind="error"
          class="vocabulary-state"
          role="alert"
          :title="error"
        >
          <div class="empty-state-action">
            <button class="btn btn-secondary" type="button" @click="load">重试</button>
          </div>
        </MascotState>

        <MascotState
          v-else-if="items.length === 0"
          kind="empty"
          class="vocabulary-state"
          title="还没有生词。"
          desc="在阅读中框选单词即可收进生词本。"
        />

        <template v-else>
          <div class="vocabulary-toolbar">
            <div class="segmented" role="group" aria-label="生词筛选">
              <button
                v-for="tab in tabs"
                :key="tab.value"
                type="button"
                class="segmented-item"
                :aria-pressed="activeFilter === tab.value ? 'true' : 'false'"
                @click="activeFilter = tab.value"
              >
                {{ tab.label }}
              </button>
            </div>
            <input
              v-model="keyword"
              class="input vocabulary-search"
              type="search"
              aria-label="搜索单词或释义"
              placeholder="搜索单词或释义"
            />
          </div>

          <p v-if="rows.length === 0" class="section-meta vocabulary-no-results" role="status">
            没有匹配的生词。
          </p>

          <div v-else class="list vocabulary-list">
            <article
              v-for="item in rows"
              :key="item.id"
              class="list-row vocabulary-row"
              data-vocab-row
            >
              <div class="list-row-main">
                <span class="list-row-title heading-serif vocabulary-row__term" data-vocab-term>{{ item.term }}</span>
                <div
                  v-if="item.phonetic || item.partOfSpeech || item.review?.lapses > 0"
                  class="list-row-meta"
                >
                  <span v-if="item.phonetic">{{ item.phonetic }}</span>
                  <span v-if="item.partOfSpeech">{{ item.partOfSpeech }}</span>
                  <span v-if="item.review?.lapses > 0">遗忘 {{ item.review.lapses }} 次</span>
                </div>
                <p v-if="item.definition" class="vocabulary-row__definition">{{ item.definition }}</p>
              </div>
              <div class="list-row-trail">
                <span v-if="vocabStatus(item, nowMs) === 'due'" class="tag tag-warning">待复习</span>
                <span v-else-if="vocabStatus(item, nowMs) === 'fresh'" class="tag tag-neutral">新词</span>
                <span v-else class="vocabulary-row__review">{{ dueLabel(item, nowMs) }}</span>
              </div>
            </article>
          </div>
        </template>
      </template>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { listVocab } from '@/api/enrichment-repository.js'
import { listBooks, listBookUnits, listBookWords } from '@/api/vocabulary-books.js'
import { loadVocabulary } from '@/modules/vocabulary/loadVocabulary.js'
import MascotState from '@/components/mascot/MascotState.vue'
import VocabularySessionPanel from '@/modules/vocabulary/components/VocabularySessionPanel.vue'
import VocabularyTraining from '../../../../plug/idictation/VocabularyTraining.vue'
import {
  dueLabel,
  filterVocabRows,
  sortVocabRows,
  vocabCounts,
  vocabStatus
} from '@/modules/vocabulary/vocabListView.js'

const PAGE_LIMIT = 500

const loading = ref(true)
const error = ref('')
const items = ref([])
const books = ref([])
const units = ref([])
const bookId = ref('')
const unitId = ref('')
const nowMs = ref(0)
const activeFilter = ref('all')
const keyword = ref('')
const sessionOpen = ref(false)
const onlineOpen=ref(false),onlineMode=ref(1),onlineResume=ref(true)
const selectedBook=computed(()=>books.value.find(book=>book.id===bookId.value))
let loadGeneration = 0

const counts = computed(() => vocabCounts(items.value, nowMs.value))
const tabs = computed(() => [
  { value: 'all', label: `全部 (${counts.value.total})` },
  { value: 'due', label: `待复习 (${counts.value.due})` },
  { value: 'fresh', label: `新词 (${counts.value.fresh})` }
])
const reviewCount = computed(() => counts.value.due + counts.value.fresh)
const sortedRows = computed(() => sortVocabRows(items.value, nowMs.value))
const rows = computed(() => filterVocabRows(sortedRows.value, {
  filter: activeFilter.value,
  keyword: keyword.value,
  nowMs: nowMs.value
}))

function openSession() {
  if (loading.value || error.value || reviewCount.value === 0) return
  sessionOpen.value = true
}

function closeSession() {
  sessionOpen.value = false
  load()
}

function applyUpdatedItem(item) {
  if (!item) return
  items.value = items.value.map((row) => (row.id === item.id ? item : row))
}

async function load() {
  const generation = ++loadGeneration
  const selectedBook = bookId.value
  const selectedUnit = unitId.value
  loading.value = true
  error.value = ''
  try {
    const loadedBooks = await listBooks()
    const loadedUnits = selectedBook ? await listBookUnits(selectedBook) : []
    const loadedItems = await loadVocabulary(async (limit, offset) => selectedBook
      ? listBookWords(selectedBook, selectedUnit, limit, offset)
      : (await listVocab(limit, offset)).items, PAGE_LIMIT)
    if (generation !== loadGeneration) return
    books.value = loadedBooks
    units.value = loadedUnits
    items.value = loadedItems
    nowMs.value = Date.now()
  } catch (err) {
    if (generation !== loadGeneration) return
    console.error('加载生词本失败:', err)
    items.value = []
    error.value = '加载失败，请稍后重试'
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
}

function changeBook() {
  unitId.value = ''
  load()
}

onMounted(load)
</script>

<style scoped>
.workspace.vocabulary-workspace {
  grid-template-rows: minmax(0, 1fr);
}

.vocabulary-page {
  display: flex;
  flex-direction: column;
  gap: var(--anth-space-5);
  min-width: 0;
  padding-bottom: var(--anth-space-8);
}

.vocabulary-head {
  display: grid;
  gap: var(--anth-space-2);
  min-width: 0;
}

.vocabulary-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--anth-space-3);
}

.vocabulary-toolbar .vocabulary-search {
  width: min(280px, 100%);
}

.vocabulary-state {
  min-height: 180px;
}

.vocabulary-no-results {
  padding: var(--anth-space-6) 0;
  text-align: center;
}

.vocabulary-list .vocabulary-row {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
}

.vocabulary-row .vocabulary-row__term {
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-md);
  font-weight: var(--anth-weight-semibold);
}

.vocabulary-row__definition {
  display: -webkit-box;
  overflow: hidden;
  margin: 0;
  color: var(--anth-ink-soft);
  font-size: var(--anth-text-small-size);
  line-height: var(--anth-text-small-line);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.vocabulary-row__review {
  color: var(--anth-ink-muted);
  font-size: var(--anth-text-small-size);
  line-height: var(--anth-text-small-line);
  white-space: nowrap;
}

@media (max-width: 640px) {
  .vocabulary-toolbar {
    align-items: stretch;
  }

  .vocabulary-toolbar .vocabulary-search {
    width: 100%;
  }
}
</style>
