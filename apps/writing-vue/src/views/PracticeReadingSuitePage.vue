<template>
  <div class="reading-suite-page" data-reading-suite-page>
    <header class="suite-header">
      <div>
        <span class="eyebrow">Reading Suite</span>
        <h1>阅读套题</h1>
        <p>{{ headerSummary }}</p>
      </div>
      <div class="suite-actions">
        <router-link class="btn btn-secondary" to="/library">返回练习库</router-link>
        <button class="btn btn-secondary" type="button" :disabled="loading" @click="loadSuite">
          {{ loading ? '同步中' : '刷新' }}
        </button>
      </div>
    </header>

    <div v-if="error" class="inline-message inline-message-error">
      <span>{{ error }}</span>
      <button class="btn-text" type="button" @click="loadSuite">重试</button>
    </div>

    <div v-if="loading" class="surface loading">正在加载套题状态...</div>

    <section v-if="!loading && suite" class="suite-workspace">
      <aside class="surface suite-summary" data-reading-suite-summary>
        <span class="panel-label">Suite Session</span>
        <h2>{{ suite.sessionId }}</h2>
        <div class="summary-grid">
          <div>
            <span>状态</span>
            <strong>{{ getStatusLabel(suite.status) }}</strong>
          </div>
          <div>
            <span>进度</span>
            <strong>{{ suite.aggregate.submittedPassages }}/{{ suite.aggregate.totalPassages }}</strong>
          </div>
          <div>
            <span>正确率</span>
            <strong>{{ suite.aggregate.percentage }}%</strong>
          </div>
          <div>
            <span>总分</span>
            <strong>{{ suite.aggregate.correct }}/{{ suite.aggregate.totalQuestions }}</strong>
          </div>
        </div>
        <button
          v-if="currentPassage"
          class="btn btn-primary"
          type="button"
          data-reading-suite-start-current
          @click="openPassage(currentPassage)"
        >
          继续当前篇
        </button>
      </aside>

      <main class="surface suite-passages">
        <div class="section-head">
          <span class="panel-label">Passages</span>
          <strong>{{ suite.flowMode }} · {{ suite.frequencyScope }}</strong>
        </div>
        <article
          v-for="entry in suite.sequence"
          :key="entry.assetId"
          class="passage-row"
          :class="[`passage-row--${entry.status}`]"
          :data-reading-suite-passage="entry.assetId"
          :data-reading-suite-current="entry.index === suite.currentIndex && suite.status === 'active' ? 'true' : 'false'"
        >
          <div class="passage-index">{{ entry.category || `P${entry.index + 1}` }}</div>
          <div class="passage-main">
            <div class="passage-meta">
              <span>{{ getPassageStatusLabel(entry.status) }}</span>
              <span v-if="entry.sessionId">Session {{ entry.sessionId }}</span>
            </div>
            <h2>{{ entry.title }}</h2>
            <p>{{ formatPassageScore(entry) }}</p>
          </div>
          <div class="passage-actions">
            <button
              v-if="entry.status === 'active'"
              class="btn btn-primary"
              type="button"
              @click="openPassage(entry)"
            >
              开始
            </button>
            <button
              v-else-if="entry.status === 'submitted' && entry.sessionId"
              class="btn btn-secondary"
              type="button"
              @click="openReview(entry)"
            >
              复盘
            </button>
            <span v-else class="passage-lock">等待前一篇</span>
          </div>
        </article>
      </main>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { practiceReadingSuite } from '@/api/practice-client.js'

const props = defineProps({
  sessionId: {
    type: String,
    required: true
  }
})

const router = useRouter()
const suite = ref(null)
const loading = ref(false)
const error = ref('')

const currentPassage = computed(() => {
  if (!suite.value || suite.value.status !== 'active') {
    return null
  }
  return suite.value.sequence?.find((entry) => entry.index === suite.value.currentIndex && entry.status === 'active') || null
})

const headerSummary = computed(() => {
  if (!suite.value) {
    return '从 Practice API 加载 Vue 原生套题 session。'
  }
  return `${suite.value.aggregate.submittedPassages}/${suite.value.aggregate.totalPassages} 已提交 · ${suite.value.aggregate.percentage}%`
})

onMounted(() => {
  loadSuite()
})

watch(() => props.sessionId, () => {
  loadSuite()
})

async function loadSuite() {
  const normalizedSessionId = String(props.sessionId || '').trim()
  if (!normalizedSessionId) {
    error.value = '缺少套题 session'
    return
  }
  loading.value = true
  error.value = ''
  try {
    suite.value = await practiceReadingSuite.get(normalizedSessionId)
  } catch (loadError) {
    console.error('加载阅读套题失败:', loadError)
    suite.value = null
    error.value = loadError?.message
      ? `阅读套题加载失败：${loadError.message}`
      : '阅读套题加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

function openPassage(entry) {
  if (!suite.value || !entry?.assetId) return
  router.push({
    name: 'PracticeReading',
    params: { assetId: entry.assetId },
    query: { suiteSessionId: suite.value.sessionId }
  })
}

function openReview(entry) {
  if (!entry?.assetId || !entry?.sessionId) return
  router.push({
    name: 'PracticeReadingReview',
    params: {
      assetId: entry.assetId,
      sessionId: entry.sessionId
    },
    query: {
      suiteSessionId: suite.value?.sessionId || ''
    }
  })
}

function getStatusLabel(status) {
  if (status === 'completed') return '已完成'
  if (status === 'cancelled') return '已取消'
  return '进行中'
}

function getPassageStatusLabel(status) {
  if (status === 'submitted') return '已提交'
  if (status === 'active') return '当前篇'
  return '未开始'
}

function formatPassageScore(entry) {
  const score = entry?.scoreInfo
  if (!score) return '提交后显示本篇分数'
  return `${score.correct}/${score.totalQuestions} · ${score.percentage}%`
}
</script>

<style scoped>
.reading-suite-page {
  display: grid;
  gap: 20px;
  animation: rise-in 0.45s var(--ease-smooth);
}

.suite-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  padding: 10px 2px 4px;
}

.suite-header h1 {
  margin-top: 6px;
  font-size: clamp(1.85rem, 2.6vw, 3rem);
}

.suite-header p {
  max-width: 760px;
  margin-top: 8px;
  color: var(--text-secondary);
}

.eyebrow,
.panel-label {
  color: var(--primary-color);
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.suite-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.suite-workspace {
  display: grid;
  grid-template-columns: minmax(260px, 0.3fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

.suite-summary,
.suite-passages {
  padding: 22px;
}

.suite-summary {
  position: sticky;
  top: 92px;
  display: grid;
  gap: 18px;
}

.suite-summary h2 {
  overflow-wrap: anywhere;
  font-family: var(--font-family-base);
  font-size: 1rem;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.summary-grid > div {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--lg-border-subtle);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.34);
}

.summary-grid span,
.passage-meta,
.passage-lock {
  color: var(--text-muted);
  font-size: 0.78rem;
}

.summary-grid strong {
  display: block;
  margin-top: 3px;
  overflow-wrap: anywhere;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.section-head strong {
  color: var(--text-secondary);
  font-size: 0.88rem;
}

.passage-row {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  padding: 16px 0;
  border-bottom: 1px solid var(--lg-border-subtle);
}

.passage-row:last-child {
  border-bottom: 0;
}

.passage-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  border-radius: var(--radius-md);
  color: #315f67;
  background: rgba(106, 204, 199, 0.16);
  font-weight: 800;
}

.passage-main {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.passage-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.passage-main h2 {
  overflow-wrap: anywhere;
  font-family: var(--font-family-base);
  font-size: 1.02rem;
  font-weight: 700;
}

.passage-main p {
  color: var(--text-secondary);
}

.passage-actions {
  display: flex;
  justify-content: flex-end;
}

.passage-row--active .passage-index {
  color: var(--text-inverse);
  background: var(--primary-color);
}

.passage-row--submitted .passage-index {
  color: var(--text-inverse);
  background: var(--success-color);
}

@media (max-width: 980px) {
  .suite-header,
  .suite-workspace,
  .passage-row {
    grid-template-columns: 1fr;
  }

  .suite-header {
    align-items: stretch;
    flex-direction: column;
  }

  .suite-summary {
    position: static;
  }

  .passage-actions {
    justify-content: flex-start;
  }
}
</style>
