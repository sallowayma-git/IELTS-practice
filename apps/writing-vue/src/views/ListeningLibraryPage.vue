<template>
  <section class="listening-library" data-listening-library>
    <header class="page-header listening-library__header">
      <p class="page-header-kicker">LISTENING · 听力</p>
      <h1 class="heading-serif listening-library__title">听力题库</h1>
      <p class="page-header-desc">按场景和频率挑选一套听力，逐节作答。</p>
    </header>

    <p v-if="loading" class="listening-library__status" role="status" aria-live="polite">正在加载听力题库…</p>

    <MascotState
      v-else-if="error"
      kind="error"
      class="listening-library__state"
      role="alert"
      :title="error"
    >
      <button class="btn btn-secondary" type="button" @click="loadAssets">重试</button>
    </MascotState>

    <MascotState
      v-else-if="!assets.length"
      kind="empty"
      class="listening-library__state"
      title="听力题库还是空的"
      desc="内置听力包加入后，这里会列出可练习的套题。"
    />

    <template v-else>
      <div class="listening-library__toolbar" role="search" aria-label="听力筛选">
        <label class="listening-library__filter">
          <span>场景</span>
          <select v-model="categoryFilter" class="input">
            <option value="all">全部场景</option>
            <option v-for="category in categories" :key="category" :value="category">{{ category }}</option>
          </select>
        </label>
        <label class="listening-library__filter">
          <span>频率</span>
          <select v-model="frequencyFilter" class="input">
            <option value="all">全部频率</option>
            <option v-for="frequency in frequencies" :key="frequency" :value="frequency">
              {{ frequencyLabel(frequency) }}
            </option>
          </select>
        </label>
        <p class="listening-library__count" role="status">{{ filteredAssets.length }} 套</p>
      </div>

      <p v-if="!filteredAssets.length" class="listening-library__status" role="status">
        没有符合当前筛选的听力套题。
      </p>

      <div v-else class="listening-library__list">
        <article
          v-for="item in filteredAssets"
          :key="item.id"
          class="listening-card"
          data-listening-asset-id
        >
          <div class="listening-card__main">
            <h2 class="heading-serif listening-card__title">{{ item.title || '未命名听力' }}</h2>
            <p class="listening-card__meta">
              <span v-if="item.category">{{ item.category }}</span>
              <span v-if="item.difficulty">{{ difficultyLabel(item.difficulty) }}</span>
              <span v-if="item.frequency">{{ frequencyLabel(item.frequency) }}</span>
            </p>
            <div v-if="listeningKindTags(item).length" class="listening-card__kinds">
              <span v-for="kind in listeningKindTags(item)" :key="kind.key" class="listening-kind">
                {{ kind.label }}
              </span>
            </div>
          </div>
          <router-link
            class="btn btn-primary listening-card__start"
            :to="{ name: 'PracticeListening', params: { assetId: item.id } }"
          >开始练习</router-link>
        </article>
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { listListeningAssets as listeningListAssets } from '@/api/listening-repository.js'
import MascotState from '@/components/mascot/MascotState.vue'
import {
  difficultyLabel,
  frequencyLabel,
  listeningKindTags
} from '@/modules/practice-listening/listeningTags.js'

const loading = ref(true)
const error = ref('')
const assets = ref([])
const categoryFilter = ref('all')
const frequencyFilter = ref('all')

const categories = computed(() => uniqueValues(assets.value.map((asset) => asset.category)))
const frequencies = computed(() => uniqueValues(
  assets.value.map((asset) => String(asset.frequency || '').trim().toLowerCase())
))
const filteredAssets = computed(() => assets.value.filter((asset) => {
  const category = String(asset.category || '').trim()
  const frequency = String(asset.frequency || '').trim().toLowerCase()
  if (categoryFilter.value !== 'all' && category !== categoryFilter.value) return false
  if (frequencyFilter.value !== 'all' && frequency !== frequencyFilter.value) return false
  return true
}))

function uniqueValues(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
}

async function loadAssets() {
  loading.value = true
  error.value = ''
  try {
    const { items } = await listeningListAssets()
    assets.value = Array.isArray(items) ? items : []
  } catch (loadError) {
    console.warn('加载听力题库失败:', loadError)
    assets.value = []
    error.value = loadError?.message
      ? `听力题库加载失败：${loadError.message}`
      : '听力题库加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

onMounted(loadAssets)
</script>

<style src="../modules/practice-listening/styles/listening.css"></style>
