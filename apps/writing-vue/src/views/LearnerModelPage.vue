<template>
  <main class="learner-model-page">
    <header class="page-header">
      <div class="page-header-top">
        <div class="learner-model-page__copy">
          <p class="page-header-kicker">LEARNER MODEL · 学习模型</p>
          <h1 class="heading-serif">技能复习地图</h1>
        </div>
        <div class="page-header-actions">
          <button class="btn btn-secondary" type="button" :disabled="loading" @click="loadLearnerModel">
            {{ loading ? '同步中…' : '重新同步' }}
          </button>
        </div>
      </div>
      <p class="page-header-desc">这里展示可解释的证据带宽与下一步探针，不把有限样本伪装成精确分数。</p>
    </header>

    <p v-if="errorMessage" class="inline-message inline-message-error" role="alert">{{ errorMessage }}</p>
    <p v-else-if="loading" class="inline-message inline-message-info" role="status">正在读取学习证据…</p>

    <div v-else class="learner-model-page__body" aria-live="polite">
      <div class="learner-stats" aria-label="学习模型概览">
        <div class="stat">
          <span class="stat-label">待复习</span>
          <span class="stat-value">{{ needs.length }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">技能</span>
          <span class="stat-value">{{ states.length }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">高不确定</span>
          <span class="stat-value">{{ highUncertaintyCount }}</span>
        </div>
      </div>

      <section class="section has-rule" aria-labelledby="learner-review-title">
        <header class="section-head">
          <h2 id="learner-review-title">优先复习</h2>
          <span class="section-meta">{{ needs.length }} 项</span>
        </header>

        <p v-if="needs.length === 0" class="empty-state">当前没有需要排队的技能。</p>
        <ul v-else class="list learner-list">
          <li v-for="need in needs" :key="need.skillKey" class="list-row">
            <span class="list-row-lead">
              <span class="tag" :class="priorityTone[need.priorityBand]">{{ priorityLabel[need.priorityBand] || need.priorityBand }}</span>
            </span>
            <span class="list-row-main">
              <span class="list-row-title">{{ formatSkillKey(need.skillKey) }}</span>
              <span class="list-row-meta">
                <span>{{ formatReasonCodes(need.reasonCodes) }}</span>
                <span>建议探针：{{ probeLabel[need.preferredProbe] || need.preferredProbe }}</span>
                <span>证据 {{ need.evidenceCount }} / 不同材料 {{ need.distinctAssetCount }}</span>
                <span>避免重复材料 {{ need.avoidAssetIds.length ? `${need.avoidAssetIds.length} 项` : '无' }}</span>
              </span>
            </span>
            <span class="list-row-trail">
              <span class="tag tag-neutral">计划 {{ formatDate(need.dueAt) }}</span>
            </span>
          </li>
        </ul>
      </section>

      <section class="section has-rule" aria-labelledby="learner-state-title">
        <header class="section-head">
          <h2 id="learner-state-title">技能状态</h2>
          <span class="section-meta">{{ states.length }} 项</span>
        </header>

        <p v-if="states.length === 0" class="empty-state">完成一次可归因的练习后，这里会出现技能状态。</p>
        <ul v-else class="list learner-list">
          <li v-for="state in states" :key="state.skillKey" class="list-row">
            <span class="list-row-lead">
              <span class="tag" :class="uncertaintyTone[state.uncertaintyBand]">{{ bandLabel[state.uncertaintyBand] || state.uncertaintyBand }}</span>
            </span>
            <span class="list-row-main">
              <span class="list-row-title">{{ formatSkillKey(state.skillKey) }}</span>
              <span class="list-row-meta">
                <span>有效证据 {{ state.evidenceCount }} 次</span>
                <span>不同材料 {{ state.distinctAssetCount }} 项</span>
                <span>下次复习 {{ formatDate(state.nextReviewAt) }}</span>
              </span>
            </span>
            <span class="list-row-trail">
              <span class="tag tag-neutral">{{ trendLabel[state.trend] || state.trend }}</span>
            </span>
          </li>
        </ul>
      </section>
    </div>
  </main>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { getLearnerReviewNeeds, getLearnerState } from '../api/learner-repository.js'
import { formatReasonCodes, formatSkillKey } from '../modules/learner/labels.js'

const loading = ref(true)
const errorMessage = ref('')
const states = ref([])
const needs = ref([])

const bandLabel = {
  high: '高不确定性',
  medium: '中不确定性',
  low: '低不确定性'
}

const trendLabel = {
  improving: '近期改善',
  stable: '近期稳定',
  declining: '近期下滑',
  insufficient_evidence: '证据不足'
}

const priorityLabel = {
  urgent: '紧急',
  high: '优先',
  moderate: '一般',
  watch: '可缓'
}

const probeLabel = {
  novel_item: '新材料迁移',
  same_item_retention: '间隔保持',
  contrastive_pair: '对比辨析',
  coach_micro_drill: '教练微练习',
  writing_rewrite: '写作重写'
}

const priorityTone = {
  urgent: 'tag-danger',
  high: 'tag-warning',
  moderate: 'tag-info',
  watch: 'tag-neutral'
}

const uncertaintyTone = {
  high: 'tag-danger',
  medium: 'tag-warning',
  low: 'tag-success'
}

const highUncertaintyCount = computed(() => states.value.filter((state) => state.uncertaintyBand === 'high').length)

function formatDate(value) {
  if (!value) return '尚无安排'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

async function loadLearnerModel() {
  loading.value = true
  errorMessage.value = ''
  try {
    const [stateSnapshot, reviewSnapshot] = await Promise.all([
      getLearnerState({ limit: 100 }),
      getLearnerReviewNeeds({ limit: 100 })
    ])
    states.value = stateSnapshot.states || []
    needs.value = reviewSnapshot.needs || []
  } catch (error) {
    errorMessage.value = error?.message || '学习模型暂时不可用'
  } finally {
    loading.value = false
  }
}

onMounted(loadLearnerModel)
</script>

<style scoped>
/* Learner model (flag-gated): skill queues as list rows, one card level at most. */
.learner-model-page {
  min-width: 0;
  max-width: 960px;
}

.learner-model-page__body {
  display: grid;
  gap: var(--anth-space-6);
}

.learner-stats {
  display: flex;
}

.learner-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
