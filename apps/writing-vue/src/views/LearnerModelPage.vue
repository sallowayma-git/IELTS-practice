<script setup>
import { onMounted, ref } from 'vue'
import { getLearnerReviewNeeds, getLearnerState } from '../api/learner-repository.js'

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

const probeLabel = {
  novel_item: '新材料迁移',
  same_item_retention: '间隔保持',
  contrastive_pair: '对比辨析',
  coach_micro_drill: '教练微练习',
  writing_rewrite: '写作重写'
}

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

<template>
  <main class="learner-model-page">
    <header class="learner-model-page__header">
      <div>
        <h1>技能复习地图</h1>
        <p class="lede">
          这里展示可解释的证据带宽与下一步探针，不把有限样本伪装成精确分数。
        </p>
      </div>
      <button class="btn btn-warm-sand" type="button" :disabled="loading" @click="loadLearnerModel">
        {{ loading ? '同步中…' : '重新同步' }}
      </button>
    </header>

    <p v-if="errorMessage" class="feedback feedback--error">{{ errorMessage }}</p>
    <p v-else-if="loading" class="feedback">正在读取学习证据…</p>

    <section v-else class="learner-model-page__grid" aria-live="polite">
      <article class="panel">
        <div class="panel__heading">
          <div>
            <h2>优先复习</h2>
          </div>
          <span class="count-badge">{{ needs.length }}</span>
        </div>

        <p v-if="needs.length === 0" class="empty-state">当前没有需要排队的技能。</p>
        <ul v-else class="review-list">
          <li v-for="need in needs" :key="need.skillKey" class="review-card">
            <div class="review-card__topline">
              <strong>{{ need.skillKey }}</strong>
              <span class="priority-badge">{{ need.priorityBand }}</span>
            </div>
            <p class="review-card__reason">{{ need.reasonCodes.join(' · ') }}</p>
            <dl class="metric-list">
              <div>
                <dt>建议探针</dt>
                <dd>{{ probeLabel[need.preferredProbe] || need.preferredProbe }}</dd>
              </div>
              <div>
                <dt>证据 / 不同材料</dt>
                <dd>{{ need.evidenceCount }} / {{ need.distinctAssetCount }}</dd>
              </div>
              <div>
                <dt>避免重复材料</dt>
                <dd>{{ need.avoidAssetIds.length ? `${need.avoidAssetIds.length} 项` : '无' }}</dd>
              </div>
            </dl>
            <p class="review-card__date">计划时间：{{ formatDate(need.dueAt) }}</p>
          </li>
        </ul>
      </article>

      <article class="panel">
        <div class="panel__heading">
          <div>
            <h2>技能状态</h2>
          </div>
          <span class="count-badge">{{ states.length }}</span>
        </div>

        <p v-if="states.length === 0" class="empty-state">完成一次可归因的练习后，这里会出现技能状态。</p>
        <ul v-else class="state-list">
          <li v-for="state in states" :key="state.skillKey" class="state-card">
            <div class="state-card__topline">
              <strong>{{ state.skillKey }}</strong>
              <span :class="['uncertainty-badge', `uncertainty-badge--${state.uncertaintyBand}`]">
                {{ bandLabel[state.uncertaintyBand] || state.uncertaintyBand }}
              </span>
            </div>
            <p class="state-card__trend">{{ trendLabel[state.trend] || state.trend }}</p>
            <dl class="metric-list">
              <div>
                <dt>有效证据</dt>
                <dd>{{ state.evidenceCount }} 次</dd>
              </div>
              <div>
                <dt>不同材料</dt>
                <dd>{{ state.distinctAssetCount }} 项</dd>
              </div>
              <div>
                <dt>下次复习</dt>
                <dd>{{ formatDate(state.nextReviewAt) }}</dd>
              </div>
            </dl>
          </li>
        </ul>
      </article>
    </section>
  </main>
</template>

<style scoped>
/* Learner model (flag-gated): two ruled columns of skills on paper. */
.learner-model-page {
  display: grid;
  gap: 32px;
}

.learner-model-page__header,
.panel__heading,
.review-card__topline,
.state-card__topline {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.learner-model-page__header {
  padding-bottom: 20px;
  border-bottom: 1px solid var(--anth-rule);
}

h1 {
  margin: 0;
  font-size: clamp(1.75rem, 3vw, 2.125rem);
}

h2 {
  margin: 0;
  font-size: var(--anth-text-lg);
}

.lede {
  max-width: var(--anth-measure);
  margin: 8px 0 0;
  color: var(--anth-ink-soft);
  line-height: var(--anth-leading-relaxed);
}

.feedback {
  margin: 0;
  color: var(--anth-ink-faint);
}

.feedback--error {
  color: var(--anth-danger);
}

.learner-model-page__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 40px;
}

.panel {
  min-width: 0;
  padding-top: 14px;
  border-top: 1px solid var(--anth-ink);
}

.count-badge {
  color: var(--anth-ink-faint);
  font-size: var(--anth-text-sm);
  font-variant-numeric: lining-nums tabular-nums;
}

.priority-badge,
.uncertainty-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--anth-ink-soft);
  font-size: var(--anth-text-xs);
}

.priority-badge::before,
.uncertainty-badge::before {
  content: "";
  width: 7px;
  height: 7px;
  background: var(--anth-ink);
}

.uncertainty-badge--high::before { background: var(--anth-danger); }
.uncertainty-badge--medium::before { background: var(--anth-warning); }
.uncertainty-badge--low::before { background: var(--anth-success); }

.review-list,
.state-list {
  display: grid;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

.review-card,
.state-card {
  padding: 12px 0;
  border-bottom: 1px solid var(--anth-rule);
}

.review-card__reason,
.state-card__trend,
.review-card__date {
  margin: 4px 0 0;
  color: var(--anth-ink-soft);
  font-size: var(--anth-text-sm);
  line-height: var(--anth-leading-normal);
}

.metric-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 8px 0 0;
}

.metric-list div {
  min-width: 0;
}

.metric-list dt {
  color: var(--anth-ink-faint);
  font-size: var(--anth-text-xs);
}

.metric-list dd {
  margin: 2px 0 0;
  font-size: var(--anth-text-sm);
  font-variant-numeric: lining-nums tabular-nums;
}

.empty-state {
  margin: 12px 0 0;
  color: var(--anth-ink-faint);
}

@media (max-width: 820px) {
  .learner-model-page__header {
    flex-direction: column;
  }

  .learner-model-page__grid,
  .metric-list {
    grid-template-columns: 1fr;
  }
}
</style>
