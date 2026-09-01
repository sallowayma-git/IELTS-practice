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
        <p class="eyebrow">Learner Model v1</p>
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
            <p class="eyebrow">Review queue</p>
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
            <p class="eyebrow">Evidence state</p>
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
.learner-model-page {
  --color-text: var(--anth-ink);
  --color-text-muted: var(--anth-ink-soft);
  --color-surface: var(--anth-surface);
  --color-surface-muted: var(--anth-surface-sunken);
  --color-border: var(--anth-border);
  max-width: 1180px;
  margin: 0 auto;
  padding: 2.5rem clamp(1rem, 4vw, 3.5rem) 4rem;
}

.learner-model-page__header,
.panel__heading,
.review-card__topline,
.state-card__topline {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.learner-model-page__header {
  margin-bottom: 2rem;
}

.eyebrow {
  margin: 0 0 0.4rem;
  color: var(--color-text-muted);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

h1,
h2 {
  margin: 0;
  color: var(--color-text);
}

h1 {
  font-size: clamp(2rem, 4vw, 3.4rem);
}

h2 {
  font-size: 1.35rem;
}

.lede {
  max-width: 42rem;
  margin: 0.8rem 0 0;
  color: var(--color-text-muted);
  line-height: 1.6;
}

.feedback {
  padding: 1rem;
  border-radius: 0.8rem;
  background: var(--color-surface-muted);
  color: var(--color-text-muted);
}

.feedback--error {
  background: var(--anth-danger-soft);
  color: var(--anth-danger);
}

.learner-model-page__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1.25rem;
}

.panel {
  min-width: 0;
  padding: 1.25rem;
  border: 1px solid var(--color-border);
  border-radius: 1.1rem;
  background: var(--color-surface);
  box-shadow: var(--anth-shadow-sm);
}

.count-badge,
.priority-badge,
.uncertainty-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.25rem 0.6rem;
  font-size: 0.72rem;
  font-weight: 700;
}

.count-badge {
  background: var(--color-surface-muted);
  color: var(--color-text-muted);
}

.priority-badge {
  background: var(--anth-accent-soft);
  color: var(--anth-accent-strong);
}

.uncertainty-badge--high {
  background: var(--anth-danger-soft);
  color: var(--anth-danger);
}

.uncertainty-badge--medium {
  background: var(--anth-warning-soft);
  color: var(--anth-warning);
}

.uncertainty-badge--low {
  background: var(--anth-success-soft);
  color: var(--anth-success);
}

.review-list,
.state-list {
  display: grid;
  gap: 0.75rem;
  margin: 1.25rem 0 0;
  padding: 0;
  list-style: none;
}

.review-card,
.state-card {
  padding: 1rem;
  border-radius: 0.85rem;
  background: var(--color-surface-muted);
}

.review-card__reason,
.state-card__trend,
.review-card__date {
  margin: 0.55rem 0 0;
  color: var(--color-text-muted);
  font-size: 0.85rem;
  line-height: 1.5;
}

.metric-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  margin: 0.9rem 0 0;
}

.metric-list div {
  min-width: 0;
}

.metric-list dt {
  color: var(--color-text-muted);
  font-size: 0.72rem;
}

.metric-list dd {
  margin: 0.2rem 0 0;
  color: var(--color-text);
  font-size: 0.85rem;
  font-weight: 650;
}

.empty-state {
  margin: 1.25rem 0 0;
  color: var(--color-text-muted);
}

@media (max-width: 820px) {
  .learner-model-page__header,
  .learner-model-page__grid {
    display: block;
  }

  .btn-warm-sand {
    margin-top: 1rem;
  }

  .panel + .panel {
    margin-top: 1rem;
  }
}
</style>
