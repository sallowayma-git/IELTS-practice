<template>
  <section class="listening-library" data-listening-library>
    <header class="page-header listening-library__header">
      <p class="page-header-kicker">LISTENING · 听力</p>
      <h1 class="heading-serif listening-library__title">听力题库</h1>
      <p class="page-header-desc">按场景和频率挑选一套听力，逐节作答。</p>
      <JiufenDrafts channel="listening" />
      <LibraryFilters v-model:source="sourceFilter" v-model:part="partFilter" :parts="listeningParts"
        :extra-sources="[{ value: 'idictation', label: '爱听写精听' }, { value: 'idictation-exam', label: '爱听写真题' }, { value: 'idictation-jijing', label: '爱听写机经' }]" />
      <ArticleFilters v-if="sourceFilter==='idictation'" />
      <template v-if="sourceFilter==='idictation-exam'">
        <button class="btn btn-secondary" type="button" :disabled="listeningBusy" @click="loadListeningCatalog()">
          {{ listeningBusy ? '正在加载剑雅听力…' : '加载剑雅 A 类听力' }}
        </button>
        <p v-if="listeningError" role="alert">{{ listeningError }}</p>
      </template>
      <template v-if="sourceFilter==='idictation-jijing'">
        <button class="btn btn-secondary" type="button" :disabled="listeningBusy" @click="loadListeningCatalog('jijing')">
          {{ listeningBusy ? '正在加载机经听力…' : '加载机经听力' }}
        </button>
        <label>练习范围
          <select v-model="jijingScope" class="input">
            <option value="suite">整套</option>
            <option value="part">单 Part</option>
          </select>
        </label>
        <p v-if="listeningError" role="alert">{{ listeningError }}</p>
      </template>
    </header>

    <p v-if="openError" role="alert">{{ openError }}</p>
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
      v-else-if="!allAssets.length"
      kind="empty"
      class="listening-library__state"
      :title="sourceFilter==='idictation'?'请选择精听书目':'听力题库还是空的'"
      :desc="sourceFilter==='idictation'?'在上方加载书目并选择，查看可用章节。':'连接题源账号后可加载在线听力内容。'"
    />

    <template v-else>
      <div v-if="!sourceFilter.startsWith('idictation')" class="listening-library__toolbar" role="search" aria-label="听力筛选">
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
        <div class="segmented" aria-label="热榜筛选">
          <button type="button" class="segmented-item" :class="{ active: hotlistOnly }"
            :aria-pressed="hotlistOnly" data-hotlist-filter @click="hotlistOnly = !hotlistOnly">热榜</button>
        </div>
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
              <span v-if="item.provider">{{ item.provider.startsWith('idictation') ? '爱听写' : '九分学长' }}</span>
              <span v-if="item.category">{{ item.category }}</span>
              <span v-if="item.difficulty">{{ difficultyLabel(item.difficulty) }}</span>
              <span v-if="item.frequency">{{ frequencyLabel(item.frequency) }}</span>
            </p>
            <div v-if="item.sourceTags?.length || item.hotlist?.length" class="listening-card__kinds" aria-label="题源标签">
              <span v-if="item.hotlist?.length" class="tag tag-accent" title="九分学长7天热榜" data-hotlist-tag>热榜</span>
              <span v-for="tag in item.sourceTags" :key="tag" class="tag tag-neutral listening-card__source" data-source-tag>{{ tag }}</span>
            </div>
            <div v-if="listeningKindTags(item).length" class="listening-card__kinds">
              <span v-for="kind in listeningKindTags(item)" :key="kind.key" class="listening-kind">
                {{ kind.label }}
              </span>
            </div>
          </div>
          <span v-if="item.available === false">暂无权限</span>
          <button v-else-if="item.provider" class="btn btn-primary listening-card__start" type="button" :disabled="openingRemote" @click="openRemote(item)">
            {{ item.practiceKind === 'material' ? '打开精听' : item.provider.startsWith('idictation') ? '打开试卷' : '开始练习' }}
          </button>
          <router-link v-else
            class="btn btn-primary listening-card__start"
            :to="{ name: 'PracticeListening', params: { assetId: item.id } }"
          >开始练习</router-link>
        </article>
      </div>
    </template>
  </section>
</template>

<script setup>
import { useRoute, useRouter } from 'vue-router'
import { computed, onMounted, ref } from 'vue'
import { listListeningAssets as listeningListAssets } from '@/api/listening-repository.js'
import LibraryFilters from '../../../../plug/jiufen/LibraryFilters.vue'
import JiufenDrafts from '@/components/JiufenDrafts.vue'
import ArticleFilters from '../../../../plug/idictation/ArticleFilters.vue'
import {articleCards,openArticle} from '../../../../plug/idictation/articleLibrary.js'
import { listeningExamCards, listeningBusy, listeningError, loadListeningCatalog, openListening } from '../../../../plug/idictation/listeningLibrary.js'
import {remoteCards, openNativeUnit} from '../../../../plug/jiufen/library.js'
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
const hotlistOnly = ref(false)
const jijingScope = ref('suite')

const onlineListening = remoteCards('listening')
const listeningParts = ['P1','P2','P3','P4']
const sourceFilter = ref('all'), partFilter = ref('all')
const allAssets = computed(() => [...assets.value, ...onlineListening.value, ...articleCards.value, ...listeningExamCards.value].sort((a,b)=>a.title.localeCompare(b.title)))
const categories = computed(() => uniqueValues(allAssets.value.map((asset) => asset.category)))
const frequencies = computed(() => uniqueValues(
  allAssets.value.map((asset) => String(asset.frequency || '').trim().toLowerCase())
))
const filteredAssets = computed(() => allAssets.value.filter((asset) => {
  if (sourceFilter.value !== 'all' && sourceFilter.value !== (asset.provider || 'local')) return false
  if (sourceFilter.value === 'idictation-jijing' && Boolean(asset.paperId) !== (jijingScope.value === 'part')) return false
  if (sourceFilter.value === 'all' && asset.provider === 'idictation-jijing' && asset.paperId) return false
  if(asset.practiceKind==='material')return true
  const parts = asset.parts?.length ? asset.parts : [asset.category]
  if (partFilter.value !== 'all' && !parts.includes(partFilter.value)) return false
  if (sourceFilter.value === 'idictation-exam' || sourceFilter.value === 'idictation-jijing') return true
  const category = String(asset.category || '').trim()
  const frequency = String(asset.frequency || '').trim().toLowerCase()
  if (categoryFilter.value !== 'all' && category !== categoryFilter.value) return false
  if (frequencyFilter.value !== 'all' && frequency !== frequencyFilter.value) return false
  if (hotlistOnly.value && !asset.hotlist?.some(entry => partFilter.value === 'all' || entry.part === partFilter.value)) return false
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

const router = useRouter()
const route = useRoute()
const openingRemote = ref(false)
const openError = ref('')
async function openRemote(item) {
  if (openingRemote.value) return
  openingRemote.value = true
  openError.value = ''
  const origin = route.fullPath
  try {
    const open = { idictation: openArticle, 'idictation-exam': openListening, 'idictation-jijing': openListening }[item.provider] || openNativeUnit
    const target = await open(item)
    if (route.fullPath === origin) await router.push(target)
  } catch (failure) {
    openError.value = failure?.message || String(failure)
  } finally {
    openingRemote.value = false
  }
}
onMounted(loadAssets)
</script>

<style src="../modules/practice-listening/styles/listening.css"></style>
