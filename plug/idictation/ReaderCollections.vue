<template>
  <button class="btn btn-secondary" type="button" :disabled="Boolean(busy)" @click="open">打开精读收藏</button>
  <dialog ref="dialog" class="reader-collections" aria-labelledby="reader-collections-title">
    <header>
      <h2 id="reader-collections-title">爱听写精读收藏</h2>
      <button class="btn btn-ghost" type="button" aria-label="关闭精读收藏" @click="dialog.close()">×</button>
    </header>
    <label>收藏类型
      <select v-model="kind" class="select" :disabled="Boolean(busy)" @change="load(1)">
        <option value="all">全部</option>
        <option value="bookmark">书签</option>
        <option value="highlight">高亮</option>
        <option value="note">笔记</option>
      </select>
    </label>
    <p v-if="busy" role="status">{{ busy }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <button v-if="error && !result" class="btn btn-secondary" type="button" :disabled="Boolean(busy)" @click="load(1)">重试</button>
    <p v-if="result && !result.items.length" role="status">此类型暂无精读收藏。</p>
    <div v-if="result?.items.length" class="list">
      <article v-for="entry in result.items" :key="entry.key" class="list-row reader-collections__entry">
        <div>
          <strong>{{ entry.title || '精读收藏句' }}</strong>
          <p>{{ entry.text || '原文已不可用' }}</p>
          <p v-if="entry.translation" class="section-meta">{{ entry.translation }}</p>
        </div>
        <button class="btn btn-secondary btn-sm" type="button" :disabled="Boolean(busy) || !entry.available" @click="show(entry.key)">
          {{ entry.available ? '在原文中定位' : '原文不可用' }}
        </button>
      </article>
    </div>
    <nav v-if="result && (result.page > 1 || result.total > result.pageSize)" aria-label="精读收藏分页">
      <button class="btn btn-secondary btn-sm" type="button" :disabled="Boolean(busy) || result.page <= 1" @click="load(result.page - 1)">上一页</button>
      <span>第 {{ result.page }} 页</span>
      <button class="btn btn-secondary btn-sm" type="button" :disabled="Boolean(busy) || result.page * result.pageSize >= result.total" @click="load(result.page + 1)">下一页</button>
    </nav>
  </dialog>
</template>

<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { idictation } from '@/api/idictation.js'

const router = useRouter()
const dialog = ref(null)
const kind = ref('all')
const result = ref(null)
const error = ref('')
const busy = ref('')
let active = true

async function run(message, action) {
  if (busy.value) return
  busy.value = message
  error.value = ''
  try { await action() }
  catch (failure) { if (active) error.value = failure?.message || String(failure) }
  finally { if (active) busy.value = '' }
}

function load(page) {
  result.value = null
  return run('正在读取收藏…', async () => {
    const response = await idictation.readerCollections(kind.value, page)
    if (active) result.value = response
  })
}

function open() {
  dialog.value.showModal()
  return load(1)
}

function show(key) {
  return run('正在核对原文版本…', async () => {
    const { assetId, sentenceId } = await idictation.openReaderCollection(key)
    if (!active || !dialog.value?.open) return
    await router.push({ name: 'PracticeReading', params: { assetId }, query: { sentenceId } })
  })
}

onBeforeUnmount(() => { active = false })
</script>

<style scoped>
.reader-collections {
  width: min(44rem, 90vw);
  max-height: 82vh;
  margin: auto;
  padding: 1.25rem;
  border: 1px solid var(--anth-rule);
  border-radius: var(--anth-radius-card);
  background: var(--anth-surface);
  color: var(--anth-ink);
}
.reader-collections::backdrop { background: var(--anth-scrim); }
.reader-collections header, .reader-collections nav { display: flex; align-items: center; gap: .6rem; }
.reader-collections header { justify-content: space-between; }
.reader-collections__entry p { margin: .3rem 0; overflow-wrap: anywhere; }
</style>
