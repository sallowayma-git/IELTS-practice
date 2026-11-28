<template>
  <details v-if="items.length || error" class="jiufen-drafts" open>
    <summary>九分学长 · 未提交草稿</summary>
    <p v-if="error" role="alert">{{ error }} <button type="button" @click="refresh">重试</button></p>
    <ul v-else>
      <li v-for="item in items" :key="item.assetId">
        <router-link :to="{ name: practiceRoute, params: { assetId: item.assetId }, query: { resume: '1' } }">
          继续作答 · {{ item.title }}
        </router-link>
        <span v-if="item.updatedAt"> · {{ formatDate(item.updatedAt) }}</span>
      </li>
    </ul>
  </details>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import { jiufen } from '@/api/jiufen.js'

const props = defineProps({ channel: { type: String, required: true } })
const items = ref([])
const error = ref('')
const practiceRoute = computed(() => props.channel === 'reading' ? 'PracticeReading' : 'PracticeListening')

async function refresh() {
  if (!isTauri()) return
  error.value = ''
  try {
    items.value = await jiufen.draftAssets(props.channel)
  } catch (failure) {
    error.value = `未能读取本地草稿：${failure?.message || String(failure)}`
  }
}

function formatDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString()
}

onMounted(refresh)
</script>

<style scoped>
.jiufen-drafts { padding: .75rem 1rem; }
.jiufen-drafts summary { cursor: pointer; }
.jiufen-drafts li { margin-block: .35rem; }
</style>
