<template>
  <section aria-labelledby="idictation-synonym-heading">
    <div class="vocabulary-toolbar">
      <h2 id="idictation-synonym-heading">爱听写同义替换</h2>
      <button class="btn btn-secondary" type="button" @click="$emit('close')">返回生词本</button>
    </div>
    <div class="vocabulary-toolbar" role="group" aria-label="选择同义替换章节">
      <select v-if="books.length" v-model="bookId" class="input" aria-label="同义替换词书" :disabled="busy" @change="loadChapters">
        <option value="">选择词书</option>
        <option v-for="book in books" :key="book.id" :value="book.id">{{ book.title }}（{{ book.pairCount }} 对）</option>
      </select>
      <select v-if="categories.length" v-model="chapterId" class="input" aria-label="同义替换章节" :disabled="busy" @change="loadChapter">
        <option value="">选择章节</option>
        <optgroup v-for="category in categories" :key="category.id" :label="category.title">
          <option v-for="chapter in category.chapters" :key="chapter.id" :value="chapter.id">{{ chapter.title }}（{{ chapter.pairCount }} 对）</option>
        </optgroup>
      </select>
      <button v-if="error" class="btn btn-secondary" type="button" @click="retry">重试</button>
    </div>
    <p v-if="busy" class="section-meta" role="status">正在加载同义替换…</p>
    <p v-else-if="error" class="section-meta" role="alert">{{ error }}</p>
    <p v-else-if="!books.length" class="section-meta" role="status">当前账号没有可用的同义替换词书。</p>
    <p v-else-if="bookId && !categories.some(category => category.chapters.length)" class="section-meta" role="status">此词书没有可用章节。</p>
    <p v-else-if="chapterId && !groups.some(group => group.pairs.length)" class="section-meta" role="status">此章节没有可用词对。</p>

    <p v-if="groups.some(group => group.pairs.length)" class="section-meta">先想一想，再展开核对同义表达与释义。</p>
    <template v-for="(group, index) in groups" :key="group.id + ':' + group.version">
      <section v-if="group.pairs.length">
        <h3>第 {{ index + 1 }} 组</h3>
        <div class="list">
          <details v-for="pair in group.pairs" :key="pair.id" class="list-row synonym-pair">
            <summary class="heading-serif">{{ pair.left }}</summary>
            <p><strong>{{ pair.right }}</strong><span v-if="pair.meaning"> · {{ pair.meaning }}</span></p>
          </details>
        </div>
      </section>
    </template>
  </section>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { idictation } from '@/api/idictation.js'

defineEmits(['close'])
const books = ref([])
const categories = ref([])
const groups = ref([])
const bookId = ref('')
const chapterId = ref('')
const busy = ref(false)
const error = ref('')
let mounted = true
let retry = loadBooks

async function run(action, request, apply) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  retry = action
  try {
    const rows = await request()
    if (mounted) apply(rows)
  } catch (failure) {
    if (mounted) error.value = failure?.message || String(failure)
  } finally {
    if (mounted) busy.value = false
  }
}

function loadBooks() {
  return run(loadBooks, idictation.synonymBooks, rows => { books.value = rows })
}

function loadChapters() {
  const selected = bookId.value
  chapterId.value = ''
  categories.value = []
  groups.value = []
  error.value = ''
  if (selected) return run(loadChapters, () => idictation.synonymChapters(selected),
    rows => { categories.value = rows })
}

function loadChapter() {
  const selected = chapterId.value
  groups.value = []
  error.value = ''
  if (selected) return run(loadChapter, () => idictation.synonymChapter(selected),
    rows => { groups.value = rows })
}

onMounted(loadBooks)
onUnmounted(() => { mounted = false })
</script>

<style scoped>
.synonym-pair { display: block; }
.synonym-pair summary { cursor: pointer; }
.synonym-pair p { margin: .5rem 0 0; }
</style>
