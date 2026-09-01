<template>
  <div class="history-page">
    <div class="page-header page-header--workspace">
      <div class="page-header__copy">
        <span class="history-eyebrow">学习档案</span>
        <h1 class="heading-serif">练习历史</h1>
        <p>阅读与写作记录、趋势和复盘统一保存在本机。</p>
      </div>
      <div class="header-actions">
        <button 
          class="btn btn-warm-sand" 
          @click="exportCSV"
          :disabled="loading || total === 0"
        >
          导出 CSV ({{ total }} 条)
        </button>
        <button 
          class="btn btn-danger" 
          @click="confirmDeleteAll"
          :disabled="loading || total === 0"
        >
          清空所有
        </button>
      </div>
    </div>

    <div v-if="pageNotice.message" :class="['page-notice', `notice-${pageNotice.type}`, 'card']">
      <span>{{ pageNotice.message }}</span>
      <button class="btn-icon" type="button" @click="clearPageNotice" aria-label="关闭提示">✕</button>
    </div>

    <!-- 筛选面板 -->
    <div class="filter-panel card">
      <div class="filter-row">
        <div class="filter-item">
          <label for="history-task-type">任务类型</label>
          <select id="history-task-type" v-model="filters.task_type">
            <option value="">全部</option>
            <option value="task1">Task 1</option>
            <option value="task2">Task 2</option>
            <option value="reading">阅读</option>
          </select>
        </div>

        <div class="filter-item">
          <label for="history-start-date">日期范围</label>
          <div class="date-range">
            <input 
              id="history-start-date"
              type="date" 
              v-model="filters.start_date"
              :max="filters.end_date || today"
              aria-label="开始日期"
            />
            <span>至</span>
            <input 
              id="history-end-date"
              type="date" 
              v-model="filters.end_date"
              :min="filters.start_date"
              :max="today"
              aria-label="结束日期"
            />
          </div>
        </div>

        <div class="filter-item">
          <label for="history-min-score">{{ scoreFilterLabel }}</label>
          <div class="score-range">
            <input 
              id="history-min-score"
              type="number" 
              v-model.number="filters.min_score"
              :min="scoreFilterBounds.min"
              :max="scoreFilterBounds.max"
              :step="scoreFilterBounds.step"
              :disabled="!scoreFilterEnabled"
              :placeholder="scoreFilterEnabled ? `最低${scoreFilterUnit}` : '先选择任务类型'"
              aria-label="最低分数"
            />
            <span>至</span>
            <input 
              id="history-max-score"
              type="number" 
              v-model.number="filters.max_score"
              :min="scoreFilterBounds.min"
              :max="scoreFilterBounds.max"
              :step="scoreFilterBounds.step"
              :disabled="!scoreFilterEnabled"
              :placeholder="scoreFilterEnabled ? `最高${scoreFilterUnit}` : '先选择任务类型'"
              aria-label="最高分数"
            />
          </div>
          <p v-if="!scoreFilterEnabled" class="score-range-hint">请先选择阅读或具体写作 Task；混合历史不能把准确率和 Band 分数混在一起筛选。</p>
        </div>

        <button class="btn btn-warm-sand" @click="resetFilters">重置筛选</button>
      </div>

      <div class="search-row">
        <input 
          id="history-search"
          type="text"
          v-model="filters.search"
          placeholder="搜索题目标题或作文内容"
          class="search-input"
          title="按关键词搜索题目标题和作文正文"
        />
      </div>
    </div>

    <!-- 统计分析区域 -->
    <div v-if="showAnalyticsSection" class="statistics-section card">
      <div
        v-if="statistics || trendSeries.length > 0"
        :class="['statistics-content', 'analytics-layout', { 'analytics-layout--trend-only': !hasWritingAnalytics }]"
      >
        <section v-if="hasWritingAnalytics" class="stat-chart analytics-radar-card">
          <div class="section-header">
            <h2>4-Dimensional Scoring Analysis</h2>
          </div>
          <RadarChart
            v-if="statistics.count > 0 && isKnownWritingTaskType(statistics.latest_task_type)"
            :currentScores="statistics.latest"
            :averageScores="statistics.average"
            :taskType="statistics.latest_task_type"
          />
          <div v-else class="empty-chart">
            <p>{{ statistics.count > 0 ? '最新记录未标注任务类型，无法展示 Task 专项雷达图' : '暂无可对比的数据' }}</p>
          </div>
          <div v-if="statistics.count > 0" class="radar-metrics">
            <div class="radar-metric">
              <span>本次得分</span>
              <strong>{{ latestOverallScore }}</strong>
            </div>
            <div class="radar-divider"></div>
            <div class="radar-metric">
              <span>历史平均</span>
              <strong>{{ historyAverageScore }}</strong>
            </div>
          </div>
        </section>

        <div class="analytics-side">
          <section v-if="hasWritingAnalytics" class="stat-comparison analytics-compare-card">
            <div class="section-header">
              <h3>详细对比</h3>
              <div class="range-selector">
                <label for="history-statistics-range">范围</label>
                <select id="history-statistics-range" v-model="statisticsRange">
                  <option value="all">全部历史</option>
                  <option value="recent10">最近10次</option>
                  <option value="thisMonth">本月</option>
                  <option value="task1">Task 1专项</option>
                  <option value="task2">Task 2专项</option>
                </select>
              </div>
            </div>
            <div v-if="statistics.count > 0" class="comparison-table-scroll">
              <table class="comparison-table">
              <thead>
                <tr>
                  <th>评分项</th>
                  <th>最新</th>
                  <th>平均</th>
                  <th>差值</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{{ getTaskCriterionLabel(statistics.latest_task_type) }}</td>
                  <td>{{ statistics.latest.tr_ta }}</td>
                  <td>{{ statistics.average.tr_ta }}</td>
                  <td :class="getDifferenceClass(statistics.latest.tr_ta - statistics.average.tr_ta)">
                    {{ formatDifference(statistics.latest.tr_ta - statistics.average.tr_ta) }}
                  </td>
                </tr>
                <tr>
                  <td>Coherence & Cohesion</td>
                  <td>{{ statistics.latest.cc }}</td>
                  <td>{{ statistics.average.cc }}</td>
                  <td :class="getDifferenceClass(statistics.latest.cc - statistics.average.cc)">
                    {{ formatDifference(statistics.latest.cc - statistics.average.cc) }}
                  </td>
                </tr>
                <tr>
                  <td>Lexical Resource</td>
                  <td>{{ statistics.latest.lr }}</td>
                  <td>{{ statistics.average.lr }}</td>
                  <td :class="getDifferenceClass(statistics.latest.lr - statistics.average.lr)">
                    {{ formatDifference(statistics.latest.lr - statistics.average.lr) }}
                  </td>
                </tr>
                <tr>
                  <td>Grammatical Range</td>
                  <td>{{ statistics.latest.gra }}</td>
                  <td>{{ statistics.average.gra }}</td>
                  <td :class="getDifferenceClass(statistics.latest.gra - statistics.average.gra)">
                    {{ formatDifference(statistics.latest.gra - statistics.average.gra) }}
                  </td>
                </tr>
              </tbody>
              </table>
            </div>
            <div v-else class="empty-comparison">
              <p>{{ getRangeDescription() }}下暂无数据</p>
            </div>
            <div v-if="statistics.count > 0" class="stat-summary">
              <p><strong>统计范围：</strong>{{ getRangeDescription() }}</p>
              <p><strong>记录数量：</strong>{{ statistics.count }} 次</p>
              <p><strong>最新提交：</strong>{{ formatDate(statistics.latest_date) }}</p>
            </div>
          </section>

          <section class="trend-chart-container analytics-trend-card test-dashboard-card">
            <h3>
              <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
              学习趋势
            </h3>
            <div class="trend-series-list">
              <section v-for="series in trendSeries" :key="series.key" class="trend-series" :data-trend-scale="series.key">
                <h4>{{ series.title }}</h4>
                <LineChart
                  :historyData="series.data"
                  :min-score="series.minScore"
                  :max-score="series.maxScore"
                  :grid-lines="series.gridLines"
                  :score-prefix="series.scorePrefix"
                  :score-suffix="series.scoreSuffix"
                  :axis-label-decimals="series.axisLabelDecimals"
                />
              </section>
            </div>
          </section>
        </div>
      </div>
      <div v-else-if="loadingStatistics" class="loading">加载统计数据中...</div>
      <div v-else class="statistics-empty">
        <p>暂无统计数据</p>
      </div>
    </div>

    <!-- 批量操作栏 -->
    <div v-if="selectedIds.length > 0" class="batch-actions card">
      <span class="selection-count">已选择 {{ selectedIds.length }} 条记录</span>
      <button class="btn btn-danger btn-sm" @click="confirmBatchDelete">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px; vertical-align: text-bottom;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> 删除选中
      </button>
      <button class="btn btn-warm-sand btn-sm" @click="clearSelection">
        取消选择
      </button>
    </div>

    <!-- 列表区域 -->
    <div
      v-if="loading"
      class="loading history-list-state history-list-state--loading card"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span class="history-state-spinner" aria-hidden="true"></span>
      <p class="state-message">加载历史记录中...</p>
    </div>
    
    <div
      v-else-if="error"
      class="error-state history-list-state history-list-state--error card"
      role="alert"
      aria-live="assertive"
    >
      <p class="state-message"><span class="state-icon" aria-hidden="true">!</span>{{ error }}</p>
      <button class="btn btn-brand" @click="loadEssays">重试</button>
    </div>

    <div
      v-else-if="essays.length === 0 && !hasActiveFilters"
      class="empty-state history-list-state history-list-state--empty card"
      role="status"
      aria-live="polite"
    >
      <p class="state-message">暂无历史记录，提交作文或完成阅读练习后查看历史</p>
    </div>

    <div
      v-else-if="essays.length === 0 && hasActiveFilters"
      class="empty-state history-list-state history-list-state--filtered card"
      role="status"
      aria-live="polite"
    >
      <p class="state-message">当前筛选条件无结果，请调整筛选条件</p>
      <button class="btn btn-warm-sand" @click="resetFilters">重置筛选</button>
    </div>

    <template v-else>
      <div class="recent-practices-head">
        <h2 class="heading-serif">最近练习</h2>
        <button class="btn-text" @click="exportCSV">导出历史报告</button>
      </div>

      <div class="essay-list">
        <div
          v-for="essay in essays"
          :key="essay.id"
          class="essay-item card"
          :data-history-id="essay.id"
        >
          <label class="essay-checkbox">
            <input
              type="checkbox"
              :checked="selectedIds.includes(essay.id)"
              :aria-label="`选择历史记录：${essay.title}`"
              @change="toggleSelection(essay.id)"
            />
          </label>

          <div
            class="essay-content"
            role="button"
            tabindex="0"
            @click="viewDetail(essay.id)"
            @keydown.enter="viewDetail(essay.id)"
            @keydown.space.prevent="viewDetail(essay.id)"
          >
            <div class="essay-header">
              <span :class="['task-badge', getRecordTaskClass(essay)]">
                {{ getRecordTypeLabel(essay) }}
              </span>
              <span class="essay-date">{{ formatDate(essay.submittedAt) }}</span>
            </div>

            <div class="essay-title">
              {{ essay.title }}
            </div>

            <div class="essay-stats">
              <span class="stat-item">{{ getRecordDurationLabel(essay) }}</span>
            </div>
          </div>

          <div class="essay-right">
            <div class="essay-score-pod">
              <span>{{ essay.scoreLabel || (essay.activity === 'reading' ? 'Accuracy' : 'Overall Band') }}</span>
              <strong>{{ formatRecordScore(essay) }}</strong>
            </div>
            <div class="essay-actions">
              <button type="button" class="btn-icon" @click.stop="viewDetail(essay.id)" title="查看详情" aria-label="查看详情">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
              </button>
              <button type="button" class="btn-icon" @click.stop="confirmDelete(essay.id)" title="删除" aria-label="删除">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <div v-if="total > pagination.limit" class="pagination">
      <button 
        class="btn btn-warm-sand"
        :disabled="pagination.page === 1"
        @click="pagination.page--"
      >
        上一页
      </button>
      <span class="page-info">
        第 {{ pagination.page }} / {{ totalPages }} 页（共 {{ total }} 条）
      </span>
      <button 
        class="btn btn-warm-sand"
        :disabled="pagination.page >= totalPages"
        @click="pagination.page++"
      >
        下一页
      </button>
    </div>

    <!-- 详情弹窗 -->
    <div v-if="detailModalEssay" class="dialog-overlay" @click.self="closeDetail">
      <div class="dialog card detail-modal">
        <div class="modal-header">
          <h3 class="heading-serif">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px; vertical-align: text-bottom;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
            评分详情（只读）
          </h3>
          <button class="btn-icon" @click="closeDetail">✕</button>
        </div>
        
        <div v-if="loadingDetail" class="loading">加载中...</div>

        <div v-else-if="detailError" class="error-state detail-error-state card">
          <p class="state-message"><span class="state-icon" aria-hidden="true">!</span>{{ detailError }}</p>
          <div class="detail-error-actions">
            <button class="btn btn-brand" @click="retryDetail">重试</button>
            <button class="btn btn-warm-sand" @click="closeDetail">关闭</button>
          </div>
        </div>
        
        <div v-else-if="detailData" class="detail-content">
          <!-- 复用 ResultPage 风格的展示 -->
          <div class="detail-grid">
            <!-- 左侧：作文内容 -->
            <div class="detail-left">
              <div class="section-header">题目要求</div>
              <div class="topic-preview-card">
                {{ detailData.display_topic_title || getTopicTitle(detailData.topic_title) }}
              </div>

              <div class="section-header">作文内容</div>
              <div class="essay-text">{{ detailData.content }}</div>

              <template v-if="detailFeedback">
                <div class="section-header" style="margin-top: 20px;">整体建议</div>
                <div class="feedback-panel">{{ detailFeedback }}</div>
              </template>
              
              <div class="section-header" style="margin-top: 20px;">基本信息</div>
              <div class="info-grid">
                <div class="info-item">
                  <span class="info-label">任务类型</span>
                  <span>{{ getRecordTypeLabel(detailData) }}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">字数</span>
                  <span>{{ detailData.word_count }}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">提交时间</span>
                  <span>{{ formatDate(detailData.submitted_at) }}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">模型</span>
                  <span>{{ detailData.model_name }}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">题目来源</span>
                  <span>{{ getTopicSourceLabel(detailData.topic_source) }}</span>
                </div>
              </div>
            </div>

            <!-- 右侧：评分详情 -->
            <div class="detail-right">
              <div class="total-score">
                <div class="score-value">{{ detailData.total_score }}</div>
                <div class="score-label">总分</div>
              </div>

              <div class="score-breakdown">
                <div class="score-item">
                  <span class="score-name">Task Achievement</span>
                  <span class="score-value">{{ detailData.task_achievement }}</span>
                </div>
                <div class="score-item">
                  <span class="score-name">Coherence & Cohesion</span>
                  <span class="score-value">{{ detailData.coherence_cohesion }}</span>
                </div>
                <div class="score-item">
                  <span class="score-name">Lexical Resource</span>
                  <span class="score-value">{{ detailData.lexical_resource }}</span>
                </div>
                <div class="score-item">
                  <span class="score-name">Grammatical Range</span>
                  <span class="score-value">{{ detailData.grammatical_range }}</span>
                </div>
              </div>

              <div v-if="detailTaskAnalysisEntries.length > 0" class="detail-analysis-card">
                <div class="section-header">任务诊断</div>
                <div class="detail-analysis-grid">
                  <div
                    v-for="item in detailTaskAnalysisEntries"
                    :key="item.label"
                    class="detail-analysis-item"
                  >
                    <span class="info-label">{{ item.label }}</span>
                    <p>{{ item.value }}</p>
                  </div>
                </div>
              </div>

              <div v-if="detailBandRationaleEntries.length > 0" class="detail-analysis-card">
                <div class="section-header">评分理由</div>
                <div class="detail-analysis-grid">
                  <div
                    v-for="item in detailBandRationaleEntries"
                    :key="item.label"
                    class="detail-analysis-item"
                  >
                    <span class="info-label">{{ item.label }}</span>
                    <p>{{ item.value }}</p>
                  </div>
                </div>
              </div>

              <div v-if="detailImprovementPlan.length > 0" class="detail-analysis-card">
                <div class="section-header">提分计划</div>
                <ul class="plan-list">
                  <li v-for="(item, index) in detailImprovementPlan" :key="`${index}-${item}`">
                    {{ item }}
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="detail-empty-state" role="status">
          <p>这条记录暂时没有可显示的评分详情。</p>
          <button class="btn btn-warm-sand" @click="closeDetail">关闭</button>
        </div>
      </div>
    </div>

    <!-- 删除确认弹窗 -->
    <div v-if="showDeleteConfirm" class="dialog-overlay" @click.self="showDeleteConfirm = false">
      <div class="dialog card">
        <h3 class="heading-serif">{{ deleteConfirmTitle }}</h3>
        <p>{{ deleteConfirmMessage }}</p>
        
        <!-- 清空所有需要输入确认 -->
        <div v-if="deleteMode === 'all'">
          <input 
            type="text"
            v-model="deleteConfirmInput"
            placeholder="请输入 &quot;确认删除&quot; 以继续"
            class="input"
            style="width: 100%; margin: 12px 0;"
          />
        </div>

        <div class="dialog-actions">
          <button class="btn btn-warm-sand" @click="showDeleteConfirm = false">
            取消
          </button>
          <button 
            class="btn btn-danger" 
            @click="executeDelete"
            :disabled="deleteMode === 'all' && deleteConfirmInput !== '确认删除'"
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
function announceA11yStatus(message) {
  if (typeof document === 'undefined') return
  const el = document.getElementById('a11y-status-live')
  if (!el) return
  el.textContent = ''
  window.setTimeout(() => { el.textContent = String(message || '') }, 10)
}

import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { essays as essaysApi } from '@/api/client.js'
import { historyRepository } from '@/api/history-repository.js'
import RadarChart from '@/components/RadarChart.vue'
import LineChart from '@/components/LineChart.vue'
import { debounce } from '@/utils/debounce.js'
import { createRequestGate } from '@/utils/request-gate.js'
import { getTopicTitlePreview } from '@/utils/tiptap-text.js'
import {
  BAND_RATIONALE_LABELS,
  TASK_ANALYSIS_LABELS,
  formatLabeledEntries,
  normalizeList,
  resolveEvaluationConsumption
} from '@/utils/evaluation-result.js'

// 状态
const router = useRouter()
const loading = ref(false)
const error = ref('')
const essaysList = ref([])
const total = ref(0)
const writingHistoryTotal = ref(0)
const readingHistoryTotal = ref(0)
const pagination = ref({ page: 1, limit: 20 })
const today = new Date().toISOString().split('T')[0]
const pageNotice = ref({ type: '', message: '' })

// Statistics state
const loadingStatistics = ref(false)
const statistics = ref(null)
const statisticsRange = ref('all')
const HISTORY_CSV_HEADERS = [
  '提交时间',
  '题目类型',
  '题目标题',
  '字数',
  '总分',
  'Task Achievement',
  'Coherence & Cohesion',
  'Lexical Resource',
  'Grammatical Range',
  '模型名称'
]

const trendRecords = computed(() => {
  if (!essaysList.value) return [];
  return [...essaysList.value].sort((a, b) => {
    const ta = new Date(a.submittedAt || 0).getTime()
    const tb = new Date(b.submittedAt || 0).getTime()
    return ta - tb
  }).slice(-15)
})

function trendScaleForRecord(record) {
  if (record?.scoreScale === 'ratio' || record?.activity === 'reading') return 'reading'
  return 'writing'
}

const trendSeries = computed(() => {
  const grouped = { writing: [], reading: [] }
  for (const record of trendRecords.value) {
    const date = new Date(record.submittedAt || 0)
    const key = trendScaleForRecord(record)
    grouped[key].push({
      date: `${date.getMonth() + 1}/${date.getDate()}`,
      score: key === 'reading'
        ? Number(record.scoreValue || 0) * 100
        : Number(record.scoreValue || 0)
    })
  }

  const series = []
  if (grouped.writing.length > 0) {
    series.push({
      key: 'writing',
      title: '写作 Band 趋势',
      data: grouped.writing,
      minScore: 0,
      maxScore: 9,
      gridLines: [0, 1.5, 3, 4.5, 6, 7.5, 9],
      scorePrefix: 'Band ',
      scoreSuffix: '',
      axisLabelDecimals: 1
    })
  }
  if (grouped.reading.length > 0) {
    series.push({
      key: 'reading',
      title: '阅读正确率趋势',
      data: grouped.reading,
      minScore: 0,
      maxScore: 100,
      gridLines: [0, 20, 40, 60, 80, 100],
      scorePrefix: '',
      scoreSuffix: '%',
      axisLabelDecimals: 0
    })
  }
  return series
})

const hasWritingAnalytics = computed(() => writingHistoryTotal.value > 0 && statistics.value && statistics.value.count > 0)
const showAnalyticsSection = computed(() => total.value > 0 && (hasWritingAnalytics.value || trendSeries.value.length > 0 || loadingStatistics.value))

// 筛选条件（严格按照后端契约）
const filters = ref({
  task_type: '',
  start_date: '',  // ISO 字符串
  end_date: '',    // ISO 字符串
  min_score: null, // 阅读为 0–100 百分比；写作为 0–9 Band
  max_score: null,
  search: ''       // 后端 LIKE 查询
})

function scoreScaleForTaskType(taskType) {
  if (taskType === 'reading') return 'ratio'
  if (taskType === 'task1' || taskType === 'task2') return 'band9'
  return null
}

const scoreFilterScale = computed(() => scoreScaleForTaskType(filters.value.task_type))
const scoreFilterEnabled = computed(() => scoreFilterScale.value !== null)
const scoreFilterBounds = computed(() => scoreFilterScale.value === 'ratio'
  ? { min: 0, max: 100, step: 1 }
  : { min: 0, max: 9, step: 0.5 })
const scoreFilterLabel = computed(() => scoreFilterScale.value === 'ratio'
  ? '阅读正确率范围（%）'
  : scoreFilterScale.value === 'band9'
    ? '写作 Band 分数范围'
    : '分数范围')
const scoreFilterUnit = computed(() => scoreFilterScale.value === 'ratio' ? '正确率（%）' : 'Band 分数')

// 批量选择
const selectedIds = ref([])

// 详情弹窗
const detailModalEssay = ref(null)
const detailData = ref(null)
const loadingDetail = ref(false)
const detailError = ref('')

// 删除确认
const showDeleteConfirm = ref(false)
const deleteMode = ref('') // 'single' | 'batch' | 'all'
const deleteTarget = ref(null)
const deleteConfirmInput = ref('')

const listRequestGate = createRequestGate()
const statisticsRequestGate = createRequestGate()
const detailRequestGate = createRequestGate()

// 计算属性
const essays = computed(() => essaysList.value)
const totalPages = computed(() => Math.ceil(total.value / pagination.value.limit))
const hasActiveFilters = computed(() => {
  return filters.value.task_type || 
         filters.value.start_date || 
         filters.value.end_date ||
         filters.value.min_score !== null ||
         filters.value.max_score !== null ||
         filters.value.search
})

const deleteConfirmTitle = computed(() => {
  if (deleteMode.value === 'all') return '清空所有历史记录'
  if (deleteMode.value === 'batch') return `删除 ${selectedIds.value.length} 条记录`
  return '删除记录'
})

const deleteConfirmMessage = computed(() => {
  if (deleteMode.value === 'all') {
    return '此操作将删除所有历史记录，且不可恢复。请输入"确认删除"以继续。'
  }
  if (deleteMode.value === 'batch') {
    return `确定删除选中的 ${selectedIds.value.length} 条记录？此操作不可恢复。`
  }
  return '确定删除该记录？此操作不可恢复。'
})

const detailEvaluation = computed(() => resolveEvaluationConsumption(
  detailData.value?.evaluation_json || detailData.value?.evaluation,
  {
    overall_feedback: detailData.value?.overall_feedback,
    feedback: detailData.value?.feedback,
    task_analysis: detailData.value?.task_analysis,
    band_rationale: detailData.value?.band_rationale,
    improvement_plan: detailData.value?.improvement_plan,
    total_score: detailData.value?.total_score,
    score: {
      total_score: detailData.value?.total_score,
      task_achievement: detailData.value?.task_achievement,
      coherence_cohesion: detailData.value?.coherence_cohesion,
      lexical_resource: detailData.value?.lexical_resource,
      grammatical_range: detailData.value?.grammatical_range
    }
  }
))
const detailFeedback = computed(() => detailEvaluation.value.feedback)
const detailTaskAnalysisEntries = computed(() => (
  formatLabeledEntries(
    detailEvaluation.value.task_analysis,
    TASK_ANALYSIS_LABELS
  )
))
const detailBandRationaleEntries = computed(() => (
  formatLabeledEntries(
    detailEvaluation.value.band_rationale,
    BAND_RATIONALE_LABELS
  )
))
const detailImprovementPlan = computed(() => normalizeList(detailEvaluation.value.improvement_plan))
const historyAverageScore = computed(() => {
  if (!statistics.value || statistics.value.count <= 0) return '0.0'
  const avg = statistics.value.average || {}
  const values = [
    Number(avg.tr_ta || 0),
    Number(avg.cc || 0),
    Number(avg.lr || 0),
    Number(avg.gra || 0)
  ]
  const totalScore = values.reduce((sum, item) => sum + item, 0)
  return (totalScore / 4).toFixed(1)
})

const latestOverallScore = computed(() => {
  if (!statistics.value || statistics.value.count <= 0) return '0.0'
  const latest = statistics.value.latest || {}
  const values = [
    Number(latest.tr_ta || 0),
    Number(latest.cc || 0),
    Number(latest.lr || 0),
    Number(latest.gra || 0)
  ]
  const totalScore = values.reduce((sum, item) => sum + item, 0)
  return (totalScore / 4).toFixed(1)
})

function setPageNotice(type, message) {
  pageNotice.value = message
    ? { type, message: String(message).trim() }
    : { type: '', message: '' }
}

function clearPageNotice() {
  setPageNotice('', '')
}

function buildApiFilters(source = filters.value) {
  const apiFilters = {}

  if (source.task_type && source.task_type !== 'reading') apiFilters.task_type = source.task_type
  if (source.start_date) apiFilters.start_date = source.start_date
  if (source.end_date) apiFilters.end_date = source.end_date
  if (source.min_score !== null && source.min_score !== '') {
    apiFilters.min_score = source.min_score
  }
  if (source.max_score !== null && source.max_score !== '') {
    apiFilters.max_score = source.max_score
  }
  if (source.search && source.search.trim()) {
    apiFilters.search = source.search.trim()
  }

  return apiFilters
}

function buildHistoryQuery(source = filters.value, { limit, offset = 0 } = {}) {
  const taskType = source.task_type === 'task1' || source.task_type === 'task2'
    ? source.task_type
    : null
  const activity = source.task_type === 'reading'
    ? 'reading'
    : taskType
      ? 'writing'
      : null
  const scoreScale = scoreScaleForTaskType(source.task_type)
  const scoreValue = (value) => {
    if (value === null || value === '') return null
    const numeric = Number(value)
    return scoreScale === 'ratio' ? numeric / 100 : numeric
  }

  return {
    activity,
    limit,
    offset,
    search: source.search || '',
    startDate: source.start_date || '',
    endDate: source.end_date || '',
    minScore: scoreValue(source.min_score),
    maxScore: scoreValue(source.max_score),
    scoreScale,
    taskType
  }
}

function shouldLoadWritingHistory(source = filters.value) {
  return source.task_type !== 'reading'
}

function shouldLoadReadingHistory(source = filters.value) {
  return !source.task_type || source.task_type === 'reading'
}

function validateFilters(source = filters.value) {
  if (source.start_date && source.end_date && source.start_date > source.end_date) {
    return '开始日期不能晚于结束日期'
  }

  if (source.min_score !== null && source.max_score !== null && source.min_score > source.max_score) {
    return '最低分不能高于最高分'
  }

  const scoreScale = scoreScaleForTaskType(source.task_type)
  const hasScoreRange = source.min_score !== null || source.max_score !== null
  if (hasScoreRange && !scoreScale) {
    return '请先选择阅读或具体写作 Task，再按分数筛选'
  }
  if (hasScoreRange) {
    const upper = scoreScale === 'ratio' ? 100 : 9
    for (const value of [source.min_score, source.max_score]) {
      if (value === null || value === '') continue
      const numeric = Number(value)
      if (!Number.isFinite(numeric) || numeric < 0 || numeric > upper) {
        return scoreScale === 'ratio'
          ? '阅读正确率必须在 0–100% 之间'
          : '写作 Band 分数必须在 0–9 之间'
      }
    }
  }

  return ''
}

function keepVisibleSelections() {
  if (selectedIds.value.length === 0) return

  const visibleIds = new Set(essaysList.value.map((essay) => essay.id))
  selectedIds.value = selectedIds.value.filter((id) => visibleIds.has(id))
}

function normalizeWritingHistoryRecord(record) {
  return {
    ...record,
    activity: record.activity || 'writing',
    submitted_at: record.submitted_at || record.created_at || '',
    total_score: Number(record.total_score ?? record.overall_score ?? 0)
  }
}

function normalizeReadingHistoryRecord(record) {
  const accuracy = Number(record.accuracy || 0)
  const percentage = Math.round(accuracy * 100)
  const metadata = record?.metadata || record?.submission?.metadata || {}
  return {
    id: record.id,
    activity: 'reading',
    task_type: 'reading',
    sessionId: record.sessionId,
    assetId: record.assetId || record.examId,
    metadata,
    display_topic_title: record.title || record.examId || '阅读练习',
    topic_title: record.title || record.examId || '阅读练习',
    submitted_at: record.submittedAt || record.endTime || '',
    word_count: Number(record.totalQuestions || 0),
    duration: Number(record.duration || 0),
    total_score: percentage / 10,
    reading_accuracy: percentage,
    correct_answers: Number(record.correctAnswers || record.score || 0),
    total_questions: Number(record.totalQuestions || 0),
    raw: record
  }
}

function getReadingHistorySuiteSessionId(record) {
  const metadata = record?.metadata || record?.raw?.metadata || record?.raw?.submission?.metadata || {}
  return String(
    record?.suiteId
    || record?.suite_id
    || record?.raw?.suiteId
    || record?.raw?.suite_id
    || metadata.suiteSessionId
    || metadata.suite_session_id
    || ''
  ).trim()
}

function filterReadingHistory(records, source = filters.value) {
  const query = String(source.search || '').trim().toLowerCase()
  const minScore = source.min_score === null || source.min_score === '' ? null : Number(source.min_score)
  const maxScore = source.max_score === null || source.max_score === '' ? null : Number(source.max_score)
  return records.filter((record) => {
    if (source.task_type && source.task_type !== 'reading') return false
    if (source.start_date && String(record.submitted_at || '').slice(0, 10) < source.start_date) return false
    if (source.end_date && String(record.submitted_at || '').slice(0, 10) > source.end_date) return false
    if (minScore !== null && Number(record.total_score || 0) < minScore) return false
    if (maxScore !== null && Number(record.total_score || 0) > maxScore) return false
    if (!query) return true
    return [
      record.display_topic_title,
      record.topic_title,
      record.assetId,
      record.sessionId
    ].filter(Boolean).join(' ').toLowerCase().includes(query)
  })
}

function compareHistoryRecords(left, right) {
  return new Date(right.submitted_at || 0).getTime() - new Date(left.submitted_at || 0).getTime()
}

// 加载列表
async function loadEssays() {
  const requestId = listRequestGate.begin()
  const filtersSnapshot = { ...filters.value }
  const paginationSnapshot = { ...pagination.value }
  const validationError = validateFilters(filtersSnapshot)

  loading.value = true
  error.value = ''
  clearPageNotice()

  if (validationError) {
    if (listRequestGate.isCurrent(requestId)) {
      error.value = validationError
      essaysList.value = []
      total.value = 0
      writingHistoryTotal.value = 0
      readingHistoryTotal.value = 0
      clearSelection()
      statistics.value = null
      loading.value = false
      loadingStatistics.value = false
      statisticsRequestGate.invalidate()
    }
    return
  }

  try {
    const offset = (paginationSnapshot.page - 1) * paginationSnapshot.limit
    const query = buildHistoryQuery(filtersSnapshot, {
      limit: paginationSnapshot.limit,
      offset
    })
    const page = await historyRepository.listHistory(query)
    if (!listRequestGate.isCurrent(requestId)) return

    const pageTotal = Number(page.total || 0)
    const maxPage = Math.max(1, Math.ceil(pageTotal / paginationSnapshot.limit))
    if (paginationSnapshot.page > maxPage) {
      pagination.value.page = maxPage
      return
    }

    essaysList.value = page.items || []
    total.value = pageTotal
    writingHistoryTotal.value = query.activity === 'reading' ? 0 : total.value
    readingHistoryTotal.value = query.activity === 'writing' ? 0 : total.value
    keepVisibleSelections()
    await loadStatistics({
      totalCount: Number(page.total || 0),
      rangeValue: statisticsRange.value,
      parentListRequestId: requestId
    })
  } catch (err) {
    if (!listRequestGate.isCurrent(requestId)) return
    console.error('加载历史记录失败:', err)
    error.value = err.message || '加载失败，请重试'
    statistics.value = null
    writingHistoryTotal.value = 0
    readingHistoryTotal.value = 0
    loadingStatistics.value = false
    statisticsRequestGate.invalidate()
  } finally {
    if (listRequestGate.isCurrent(requestId)) {
      loading.value = false
    }
  }
}

// 防抖版本
const debouncedLoadEssays = debounce(loadEssays, 300)

// 重置筛选
function resetFilters() {
  filters.value = {
    task_type: '',
    start_date: '',
    end_date: '',
    min_score: null,
    max_score: null,
    search: ''
  }
  pagination.value.page = 1
  clearSelection()
}

// 批量选择
function toggleSelection(id) {
  const index = selectedIds.value.indexOf(id)
  if (index > -1) {
    selectedIds.value.splice(index, 1)
  } else {
    selectedIds.value.push(id)
  }
}

function clearSelection() {
  selectedIds.value = []
}

// 查看详情
async function viewDetail(id) {
  const listRecord = essaysList.value.find((record) => record.id === id)
  if (listRecord?.activity === 'reading') {
    const assetId = String(listRecord.assetId || '').trim()
    const sessionId = String(listRecord.sessionId || '').trim()
    if (!assetId || !sessionId) {
      setPageNotice('error', '阅读记录缺少回顾所需的 assetId 或 sessionId')
      return
    }
    const suiteSessionId = getReadingHistorySuiteSessionId(listRecord)
    const target = {
      name: 'PracticeReadingReview',
      params: { assetId, sessionId }
    }
    if (suiteSessionId) {
      target.query = { suiteSessionId }
    }
    router.push(target)
    return
  }

  const requestId = detailRequestGate.begin()
  detailModalEssay.value = id
  detailData.value = null
  detailError.value = ''
  loadingDetail.value = true

  try {
    const result = await essaysApi.getById(id)
    if (!detailRequestGate.isCurrent(requestId)) return

    detailData.value = result
  } catch (err) {
    if (!detailRequestGate.isCurrent(requestId)) return
    console.error('加载详情失败:', err)
    detailError.value = err.message || '加载详情失败，请重试'
  } finally {
    if (detailRequestGate.isCurrent(requestId)) {
      loadingDetail.value = false
    }
  }
}

function retryDetail() {
  if (detailModalEssay.value) {
    viewDetail(detailModalEssay.value)
  }
}

function closeDetail() {
  detailRequestGate.invalidate()
  detailModalEssay.value = null
  detailData.value = null
  detailError.value = ''
  loadingDetail.value = false
}

// 删除操作
function confirmDelete(id) {
  clearPageNotice()
  deleteMode.value = 'single'
  deleteTarget.value = id
  showDeleteConfirm.value = true
}

function confirmBatchDelete() {
  if (selectedIds.value.length === 0) return
  clearPageNotice()
  deleteMode.value = 'batch'
  showDeleteConfirm.value = true
}

function confirmDeleteAll() {
  clearPageNotice()
  deleteMode.value = 'all'
  deleteConfirmInput.value = ''
  showDeleteConfirm.value = true
}

async function executeDelete() {
  try {
    if (deleteMode.value === 'single') {
      await essaysApi.delete(deleteTarget.value)
    } else if (deleteMode.value === 'batch') {
      await essaysApi.batchDelete(selectedIds.value)
      selectedIds.value = []
    } else if (deleteMode.value === 'all') {
      const selectedActivity = filters.value.task_type === 'reading'
        ? 'reading'
        : (isKnownWritingTaskType(filters.value.task_type) ? 'writing' : null)
      await essaysApi.deleteAll(selectedActivity)
    }

    const wasDeleteAll = deleteMode.value === 'all'
    showDeleteConfirm.value = false
    deleteTarget.value = null
    deleteMode.value = ''
    deleteConfirmInput.value = ''
    if (wasDeleteAll) {
      clearSelection()
    }
    clearPageNotice()
    await loadEssays()
  } catch (err) {
    console.error('删除失败:', err)
    setPageNotice('error', `删除失败：${err.message || '请重试'}`)
  }
}

function escapeCsvCell(value) {
  const text = String(value ?? '')
  return `"${text.replace(/"/g, '""')}"`
}

function buildReadingHistoryCsvRows(records = []) {
  return records.map((record) => [
    record.submitted_at,
    '阅读',
    record.display_topic_title || record.topic_title || '阅读练习',
    record.total_questions || record.word_count || 0,
    `${Number(record.reading_accuracy || 0)}%`,
    '',
    '',
    '',
    '',
    'Practice API'
  ].map(escapeCsvCell).join(','))
}

function downloadCsvFile(filename, csvContent) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

// 导出CSV
async function exportCSV() {
  clearPageNotice()
  const filtersSnapshot = { ...filters.value }
  const validationError = validateFilters(filtersSnapshot)
  if (validationError) {
    setPageNotice('error', validationError)
    return
  }

  try {
    const { result } = await historyRepository.exportHistory('csv', buildHistoryQuery(filtersSnapshot, {
      limit: 10_000
    }))
    const csvBody = typeof result === 'string' ? result : (result?.body ?? '')
    if (!csvBody) throw new Error('历史导出未返回内容')
    const dateStr = new Date().toISOString().split('T')[0]
    const filterSuffix = []
    if (filtersSnapshot.task_type) filterSuffix.push(filtersSnapshot.task_type)
    if (filtersSnapshot.start_date || filtersSnapshot.end_date) filterSuffix.push('date-filtered')
    if (filtersSnapshot.min_score !== null || filtersSnapshot.max_score !== null) filterSuffix.push('score-filtered')
    const filename = `ielts-history-${dateStr}${filterSuffix.length > 0 ? '-' + filterSuffix.join('-') : ''}.csv`
    downloadCsvFile(filename, csvBody)
    setPageNotice('success', '历史 CSV 已导出。')
  } catch (err) {
    console.error('导出CSV失败:', err)
    setPageNotice('error', `导出失败：${err.message || '请重试'}`)
  }
}

function buildStatisticsQuery(rangeValue = statisticsRange.value) {
  if (rangeValue === 'thisMonth') {
    return { range: 'monthly', taskType: null }
  }
  if (rangeValue === 'task1' || rangeValue === 'task2') {
    return { range: rangeValue, taskType: null }
  }
  return { range: rangeValue || 'all', taskType: null }
}

// Statistics functions
async function loadStatistics({ totalCount = total.value, rangeValue = statisticsRange.value, parentListRequestId = null } = {}) {
  const requestId = statisticsRequestGate.begin()

  if (totalCount === 0) {
    if (statisticsRequestGate.isCurrent(requestId) && (parentListRequestId === null || listRequestGate.isCurrent(parentListRequestId))) {
      statistics.value = { count: 0 }
      loadingStatistics.value = false
    }
    return
  }

  loadingStatistics.value = true

  try {
    const { range, taskType } = buildStatisticsQuery(rangeValue)
    const result = await essaysApi.getStatistics(range, taskType)

    if (!statisticsRequestGate.isCurrent(requestId)) return
    if (parentListRequestId !== null && !listRequestGate.isCurrent(parentListRequestId)) return

    if (result?.count > 0 && result.latest?.score && result.average) {
      const latestScore = result.latest.score
      const averageScore = result.average
      statistics.value = {
        count: result.count,
        latest: {
          tr_ta: parseFloat(latestScore.taskResponse || 0),
          cc: parseFloat(latestScore.coherence || 0),
          lr: parseFloat(latestScore.lexical || 0),
          gra: parseFloat(latestScore.grammar || 0)
        },
        average: {
          tr_ta: parseFloat(averageScore.taskResponse || 0),
          cc: parseFloat(averageScore.coherence || 0),
          lr: parseFloat(averageScore.lexical || 0),
          gra: parseFloat(averageScore.grammar || 0)
        },
        latest_task_type: isKnownWritingTaskType(result.latest.taskType)
          ? result.latest.taskType
          : null,
        latest_date: result.latest.submittedAt
      }
    } else {
      statistics.value = { count: 0 }
    }
  } catch (err) {
    if (!statisticsRequestGate.isCurrent(requestId)) return
    if (parentListRequestId !== null && !listRequestGate.isCurrent(parentListRequestId)) return

    console.error('加载统计数据失败:', err)
    statistics.value = null
  } finally {
    if (statisticsRequestGate.isCurrent(requestId) && (parentListRequestId === null || listRequestGate.isCurrent(parentListRequestId))) {
      loadingStatistics.value = false
    }
  }
}

// 工具函数
function formatDate(dateStr) {
  if (!dateStr) return ''
  return dateStr.replace('T', ' ').substring(0, 16)
}

function getTopicTitle(titleJson) {
  return getTopicTitlePreview(titleJson, { fallback: '自由写作', maxLength: 50 })
}

function getRecordTypeLabel(record) {
  if (record?.activity === 'reading') return '阅读'
  const taskType = record?.taskType ?? record?.task_type
  if (taskType === 'task1') return 'Task 1'
  if (taskType === 'task2') return 'Task 2'
  return '未标注'
}

function getRecordTaskClass(record) {
  if (record?.activity === 'reading') return 'reading'
  const taskType = record?.taskType ?? record?.task_type
  return isKnownWritingTaskType(taskType) ? taskType : 'unlabeled'
}

function isKnownWritingTaskType(taskType) {
  return taskType === 'task1' || taskType === 'task2'
}

function getTaskCriterionLabel(taskType) {
  if (taskType === 'task1') return 'Task Achievement'
  if (taskType === 'task2') return 'Task Response'
  return 'Task Criterion'
}

function getRecordDurationLabel(record) {
  const durationMs = Number(record?.durationMs || 0)
  const duration = durationMs > 0
    ? Math.round(durationMs / 1000)
    : Number(record?.duration || 0)
  if (duration > 0) {
    const minutes = Math.floor(duration / 60)
    const seconds = duration % 60
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
  }
  if (record?.activity === 'reading') return '阅读练习'
  const taskType = record?.taskType ?? record?.task_type
  if (taskType === 'task1') return '20 min'
  if (taskType === 'task2') return '40 min'
  return '—'
}

function formatRecordScore(record) {
  if (record?.activity === 'reading') {
    return record.scoreDisplay || '—'
  }
  return record?.scoreDisplay || '—'
}

function getTopicSourceLabel(source) {
  if (source === 'topic_bank') return '题库题目'
  if (source === 'custom_input') return '自定义题目'
  return '未标记'
}

function formatDifference(diff) {
  if (diff > 0) return `+${diff.toFixed(1)}`
  if (diff < 0) return diff.toFixed(1)
  return '0.0'
}

function getDifferenceClass(diff) {
  if (diff > 0) return 'positive'
  if (diff < 0) return 'negative'
  return 'neutral'
}

function getRangeDescription() {
  const descriptions = {
    all: '全部历史',
    recent10: '最近10次',
    thisMonth: '本月',
    task1: 'Task 1专项',
    task2: 'Task 2专项'
  }
  return descriptions[statisticsRange.value] || '全部历史'
}

// 监听筛选和分页变化
watch(filters, () => {
  pagination.value.page = 1
  debouncedLoadEssays()
}, { deep: true })

watch(() => filters.value.task_type, (nextTaskType, previousTaskType) => {
  if (scoreScaleForTaskType(nextTaskType) !== scoreScaleForTaskType(previousTaskType)) {
    filters.value.min_score = null
    filters.value.max_score = null
  }
})

watch(() => pagination.value.page, () => {
  loadEssays()
})

watch(statisticsRange, (rangeValue) => {
  loadStatistics({ totalCount: writingHistoryTotal.value, rangeValue })
})

// 初始化
onMounted(() => {
  loadEssays()
})

onBeforeUnmount(() => {
  listRequestGate.invalidate()
  statisticsRequestGate.invalidate()
  detailRequestGate.invalidate()
})
</script>

<style scoped>
.history-page {
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.page-header h1 {
  font-size: var(--anth-text-2xl);
  color: var(--text-primary);
}

.header-actions {
  display: flex;
  gap: 12px;
}

.page-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  padding: 14px 16px;
  border: 1px solid var(--border-color);
}

.page-notice.notice-error {
  background: var(--color-error-bg);
  border-color: var(--atlas-danger);
  color: var(--atlas-danger);
}

/* 筛选面板 */
.filter-panel {
  margin-bottom: 20px;
  padding: 16px;
}

/* 统计分析区域 */
.statistics-section {
  margin-bottom: 20px;
  padding: 24px;
}

.statistics-section .section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.statistics-section h2 {
  font-size: var(--anth-text-lg);
  color: var(--text-primary);
  margin: 0;
}

.range-selector {
  display: flex;
  align-items: center;
  gap: 8px;
}

.range-selector label {
  font-size: var(--anth-text-sm);
  color: var(--text-secondary);
}

.range-selector select {
  padding: 6px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  font-size: var(--anth-text-sm);
}

.stat-chart,
.stat-comparison {
  padding: 16px;
  background: var(--bg-light);
  border-radius: var(--border-radius);
}

.stat-chart h3,
.stat-comparison h3 {
  font-size: var(--anth-text-md);
  color: var(--text-primary);
  margin-bottom: 16px;
}

.empty-chart,
.empty-comparison,
.statistics-empty {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-muted);
}

.comparison-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 16px;
}

.comparison-table th,
.comparison-table td {
  padding: 12px;
  text-align: left;
  border-bottom: 1px solid var(--border-color);
}

.comparison-table th {
  background: var(--bg-light);
  font-weight: 600;
  color: var(--text-secondary);
  font-size: var(--anth-text-sm);
}

.comparison-table td {
  font-size: var(--anth-text-sm);
  color: var(--text-primary);
}

.comparison-table td.positive {
  color: var(--atlas-success);
  font-weight: 600;
}

.comparison-table td.negative {
  color: var(--atlas-danger);
  font-weight: 600;
}

.comparison-table td.neutral {
  color: var(--text-muted);
}

.stat-summary {
  padding: 16px;
  background: white;
  border-radius: var(--border-radius);
  border: 1px solid var(--border-color);
}

.stat-summary p {
  margin: 8px 0;
  font-size: var(--anth-text-sm);
  color: var(--text-secondary);
}

.stat-summary strong {
  color: var(--text-primary);
}

.filter-row {
  display: flex;
  gap: 16px;
  align-items: flex-end;
  margin-bottom: 12px;
}

.filter-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.filter-item label {
  font-size: var(--anth-text-sm);
  color: var(--text-secondary);
  font-weight: 500;
}

.filter-item select,
.filter-item input[type="date"],
.filter-item input[type="number"] {
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  font-size: var(--anth-text-sm);
}

.date-range,
.score-range {
  display: flex;
  align-items: center;
  gap: 8px;
}

.date-range input,
.score-range input {
  flex: 1;
}

.search-row {
  margin-top: 12px;
}

.search-input {
  width: 100%;
  padding: 10px 16px;
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  font-size: var(--anth-text-sm);
}

.search-input:disabled {
  background: var(--bg-light);
  color: var(--text-muted);
  cursor: not-allowed;
  opacity: 0.6;
}

/* 批量操作栏 */
.batch-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  margin-bottom: 20px;
  background: var(--atlas-accent-soft);
  border-color: var(--atlas-line);
}

.selection-count {
  flex: 1;
  font-weight: 600;
  color: var(--text-primary);
}

/* 列表 */
.essay-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 24px;
}

.essay-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  transition: background-color 0.2s;
}

.essay-item:hover {
  background-color: var(--bg-muted);
}

.essay-checkbox {
  flex-shrink: 0;
}

.essay-checkbox input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.essay-content {
  flex: 1;
  cursor: pointer;
}

.essay-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.task-badge {
  padding: 2px 8px;
  border-radius: 12px;
  font-size: var(--anth-text-xs);
  font-weight: 600;
}

.task-badge.task1 {
  background: var(--atlas-library-success);
  color: var(--atlas-accent-strong);
}

.task-badge.task2 {
  background: var(--atlas-accent-soft);
  color: var(--atlas-accent-strong);
}

.essay-date {
  font-size: var(--anth-text-sm);
  color: var(--text-muted);
}

.essay-title {
  font-size: var(--anth-text-base);
  color: var(--text-primary);
  margin-bottom: 8px;
  line-height: 1.4;
}

.essay-stats {
  display: flex;
  gap: 16px;
  font-size: var(--anth-text-sm);
}

.stat-item {
  color: var(--text-secondary);
}

.essay-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

/* 空状态 */
.empty-state,
.error-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-muted);
}

.empty-state button,
.error-state button {
  margin-top: 16px;
}

.loading {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-muted);
}

.state-message {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.state-icon {
  display: inline-grid;
  place-items: center;
  width: 1.25rem;
  height: 1.25rem;
  border: 1px solid currentColor;
  border-radius: 50%;
  font-weight: 700;
  font-size: 0.8rem;
}

/* 分页 */
.pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 16px;
  margin-top: 24px;
}

.page-info {
  font-size: var(--anth-text-sm);
  color: var(--text-secondary);
}

/* 详情弹窗 */
.detail-modal {
  max-width: min(1200px, calc(100vw - 32px));
  width: 90%;
  max-height: 90vh;
  overflow-y: auto;
}

.detail-error-state {
  margin: 12px 0 0;
  padding: 40px 20px;
}

.detail-error-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 16px;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-color);
}

.modal-header h3 {
  margin: 0;
  color: var(--text-primary);
}

.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.detail-left,
.detail-right {
  min-height: 400px;
}

.section-header {
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
  font-size: var(--anth-text-md);
}

.essay-text {
  background: var(--bg-light);
  padding: 16px;
  border-radius: var(--border-radius);
  line-height: 1.8;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.topic-preview-card,
.feedback-panel,
.detail-analysis-card {
  background: var(--bg-light);
  padding: 16px;
  border-radius: var(--border-radius);
  line-height: 1.8;
  color: var(--text-secondary);
}

.detail-analysis-card {
  margin-top: 20px;
}

.detail-analysis-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.detail-analysis-item p {
  margin: 4px 0 0;
  color: var(--text-primary);
  line-height: 1.7;
}

.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-label {
  font-size: var(--anth-text-xs);
  color: var(--text-muted);
}

.total-score {
  text-align: center;
  padding: 32px;
  background: var(--color-brand-gradient);
  color: var(--shui-text-strong);
  border-radius: var(--border-radius);
  margin-bottom: 20px;
  box-shadow: var(--atlas-shadow);
}

.total-score .score-value {
  font-size: var(--anth-text-3xl);
  font-weight: 700;
  margin-bottom: 8px;
}

.total-score .score-label {
  font-size: var(--anth-text-md);
  opacity: 0.9;
}

.score-breakdown {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.score-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: var(--bg-light);
  border-radius: var(--border-radius);
}

.score-item .score-name {
  font-size: var(--anth-text-sm);
  color: var(--text-secondary);
}

.score-item .score-value {
  font-size: var(--anth-text-lg);
  font-weight: 600;
  color: var(--primary-color);
}

.plan-list {
  margin: 0;
  padding-left: 18px;
}

.plan-list li {
  margin-bottom: 8px;
  line-height: 1.7;
}

@media (max-width: 960px) {
  .page-header,
  .filter-row {
    flex-direction: column;
    align-items: stretch;
  }

  .detail-grid {
    grid-template-columns: 1fr;
  }

  .info-grid {
    grid-template-columns: 1fr;
  }

  .header-actions,
  .essay-header,
  .essay-stats {
    flex-wrap: wrap;
  }

  .essay-item {
    align-items: flex-start;
  }

  .detail-modal {
    width: calc(100% - 24px);
  }

  .detail-left,
  .detail-right {
    min-height: auto;
  }
}

.history-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
  animation: rise-in 0.45s var(--ease-smooth);
}

.page-header--workspace {
  align-items: flex-end;
  gap: 20px;
}

.page-header__copy {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.page-header__copy h1 {
  font-family: var(--font-family-display);
  font-size: clamp(38px, 5vw, 62px);
  line-height: 0.94;
  letter-spacing: -0.05em;
}

.page-header__copy p {
  max-width: 760px;
  color: var(--text-secondary);
  font-size: var(--anth-text-base);
}

.history-page .filter-panel,
.history-page .statistics-section,
.history-page .batch-actions,
.history-page .error-state,
.history-page .empty-state {
  padding: 20px 22px;
  border-radius: var(--radius-lg);
  background: var(--surface-0);
  border: 1px solid var(--line-1);
  box-shadow: none;
}

.history-page .filter-row,
.history-page .search-row,
.history-page .section-header,
.history-page .header-actions,
.history-page .range-selector,
.history-page .date-range,
.history-page .score-range {
  gap: 12px;
}

/* Keep the filter controls on a shared baseline while allowing the score
   explanation to occupy its own row instead of pushing the reset action. */
.history-page .filter-row {
  display: grid;
  grid-template-columns: minmax(150px, 0.8fr) minmax(260px, 1.35fr) minmax(260px, 1.35fr) auto;
  align-items: start;
  gap: 16px;
  margin-bottom: 14px;
}

.history-page .filter-item {
  min-width: 0;
  gap: 7px;
}

.history-page .filter-item > label {
  min-height: 1.25rem;
  line-height: 1.25rem;
}

.history-page .filter-item select,
.history-page .filter-item input[type='date'],
.history-page .filter-item input[type='number'] {
  width: 100%;
  min-height: 40px;
  box-sizing: border-box;
}

.history-page .date-range,
.history-page .score-range {
  min-height: 40px;
}

.history-page .date-range > span,
.history-page .score-range > span {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: var(--anth-text-xs);
}

.history-page .score-range-hint {
  min-height: 2.4em;
  margin: 6px 0 0;
  color: var(--text-muted);
  font-size: var(--anth-text-xs);
  line-height: 1.35;
}

.history-page .filter-row > .btn {
  align-self: end;
  min-height: 40px;
  white-space: nowrap;
}

.history-page .search-row {
  margin-top: 0;
}

.history-page .section-header h2 {
  font-family: var(--font-family-display);
  font-size: var(--anth-text-2xl);
  line-height: 0.96;
  letter-spacing: -0.04em;
}

.history-page .batch-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.history-page .essay-list {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--line-1);
}

.history-page .essay-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  padding: 18px 0;
  margin: 0;
  border: none;
  border-bottom: 1px solid var(--line-1);
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.history-page .essay-content {
  min-width: 0;
}

.history-page .essay-header,
.history-page .essay-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.history-page .essay-title {
  margin: 8px 0;
  font-size: var(--anth-text-md);
  font-weight: 600;
  color: var(--text-primary);
}

.history-page .essay-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.history-page .task-badge,
.history-page .score-name {
  border-radius: 999px;
}

.history-page .pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding-top: 8px;
}

.history-page .empty-state {
  display: grid;
  justify-items: center;
  gap: 12px;
  min-height: 132px;
  box-sizing: border-box;
  padding: 34px 22px;
}

.history-page .empty-state p {
  max-width: 34rem;
  margin: 0;
  line-height: 1.55;
}

.history-page .empty-state button {
  margin-top: 0;
}

.history-page .detail-modal {
  width: min(1180px, calc(100vw - 32px));
  max-width: min(1180px, calc(100vw - 32px));
  padding: 22px 24px;
  border-radius: var(--radius-xl);
}

.history-page .detail-content,
.history-page .detail-grid,
.history-page .detail-left,
.history-page .detail-right {
  gap: 18px;
}

.history-page .topic-preview-card,
.history-page .feedback-panel,
.history-page .essay-text,
.history-page .detail-analysis-card,
.history-page .total-score,
.history-page .score-item,
.history-page .info-item {
  border-radius: var(--radius-md);
  background: var(--atlas-glass);
  border: 1px solid var(--line-1);
  box-shadow: none;
}

.history-page .statistics-section {
  padding: 24px;
}

.history-page .analytics-layout {
  display: grid;
  grid-template-columns: minmax(320px, 0.9fr) minmax(0, 1.1fr);
  gap: 18px;
}

.history-page .stat-chart,
.history-page .trend-series {
  animation: atlas-rise-in var(--anth-duration-slow) var(--anth-ease-out) both;
}

.history-page .trend-series:nth-child(2) { animation-delay: 60ms; }

.history-page .analytics-layout--trend-only {
  grid-template-columns: minmax(0, 1fr);
}

.history-page .analytics-radar-card {
  display: grid;
  gap: 10px;
  align-content: start;
  padding: 22px;
  background: var(--atlas-library-surface-soft);
}

.history-page .analytics-radar-card .section-header {
  margin: 0;
}

.history-page .analytics-radar-card .section-header h2 {
  font-family: var(--font-family-display);
  font-size: 1.9rem;
  line-height: 1.02;
}

.history-page .radar-metrics {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  margin-top: 6px;
}

.history-page .radar-metric {
  display: grid;
  justify-items: center;
  gap: 2px;
}

.history-page .radar-metric span {
  color: var(--text-muted);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.history-page .radar-metric strong {
  font-family: var(--font-family-display);
  font-size: 2rem;
  line-height: 1;
  color: var(--atlas-ink);
}

.history-page .radar-divider {
  width: 1px;
  height: 42px;
  background: var(--atlas-line);
}

.history-page .analytics-side {
  display: grid;
  gap: 14px;
  align-content: start;
}

.history-page .analytics-compare-card,
.history-page .analytics-trend-card {
  padding: 18px;
  border-radius: var(--radius-lg);
  background: var(--atlas-library-surface-soft);
  border: 1px solid var(--atlas-rim);
}

.history-page .analytics-compare-card .section-header {
  margin-bottom: 14px;
}

.history-page .analytics-compare-card .section-header h3 {
  font-family: var(--font-family-display);
  font-size: 1.55rem;
  line-height: 1;
}

.history-page .range-selector {
  gap: 6px;
}

.history-page .range-selector label {
  font-size: var(--anth-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.history-page .comparison-table th {
  background: transparent;
  font-size: var(--anth-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.history-page .comparison-table td {
  font-size: var(--anth-text-sm);
}

.history-page .stat-summary {
  background: var(--atlas-glass);
}

.history-page .analytics-trend-card h3 {
  margin-top: 0;
  margin-bottom: 16px;
  font-family: var(--font-family-display);
  font-size: 1.45rem;
  display: flex;
  align-items: center;
  gap: 8px;
}

.history-page .recent-practices-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.history-page .recent-practices-head h2 {
  font-family: var(--font-family-display);
  font-size: clamp(2rem, 3.2vw, 3rem);
  line-height: 1;
}

.history-page .essay-list {
  display: grid;
  gap: 12px;
  border: none;
}

.history-page .essay-item {
  grid-template-columns: auto minmax(0, 1fr) auto;
  padding: 14px 18px;
  border: 1px solid var(--atlas-rim);
  border-radius: 18px;
  background: var(--atlas-library-surface-soft);
}

.history-page .essay-title {
  margin: 4px 0;
  font-size: var(--anth-text-base);
  font-weight: 700;
}

.history-page .essay-stats {
  gap: 12px;
  font-size: var(--anth-text-xs);
}

.history-page .essay-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.history-page .essay-score-pod {
  min-width: 88px;
  display: grid;
  justify-items: center;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 14px;
  background: var(--atlas-accent-soft);
  border: 1px solid var(--atlas-line);
}

.history-page .essay-score-pod span {
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

.history-page .essay-score-pod strong {
  font-family: var(--font-family-display);
  font-size: 1.5rem;
  line-height: 1;
  color: var(--atlas-ink);
}

.history-page .pagination {
  justify-content: center;
  gap: 14px;
}

@media (max-width: 960px) {
  .history-page .filter-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: start;
  }

  .history-page .filter-row > .btn {
    align-self: end;
    justify-self: start;
  }

  .history-page .analytics-layout {
    grid-template-columns: 1fr;
  }

  .history-page .analytics-radar-card .section-header h2,
  .history-page .analytics-compare-card .section-header h3,
  .history-page .analytics-trend-card h3 {
    font-size: 1.4rem;
  }

  .history-page .recent-practices-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .history-page .essay-item {
    grid-template-columns: 1fr;
    align-items: stretch;
  }
}

@media (max-width: 640px) {
  .history-page .filter-row {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .history-page .filter-row > .btn {
    width: 100%;
    justify-self: stretch;
  }

  .history-page .date-range,
  .history-page .score-range {
    gap: 6px;
  }

  .history-page .score-range-hint {
    min-height: 0;
  }
}
</style>
