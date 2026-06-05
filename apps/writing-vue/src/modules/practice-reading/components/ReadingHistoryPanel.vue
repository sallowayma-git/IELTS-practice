<template>
  <div id="practice-view" :class="['view', 'hero-panel', 'hero-section', { active: activeView === 'practice' }]" data-reading-records>
    <div class="hero-panel__header practice-view__header">
      <div class="practice-view__title-row">
        <h2 class="hero-panel__title heading-serif">📝 练习记录</h2>
        <button
          id="practice-summary-toggle"
          class="practice-summary-toggle"
          type="button"
          data-index-action="toggle-practice-summary"
          aria-controls="practice-summary-region"
          :aria-expanded="practiceSummaryExpanded ? 'true' : 'false'"
          :aria-label="practiceSummaryExpanded ? '折叠练习统计卡片' : '展开练习统计卡片'"
          @click="$emit('toggle-practice-summary', $event)"
        >
          <span class="practice-summary-toggle__glyph" aria-hidden="true"></span>
        </button>
      </div>
    </div>

    <div id="practice-summary-region" class="practice-summary-region" :hidden="!practiceSummaryExpanded">
      <div class="practice-stats hero-grid hero-grid--stats">
        <div class="hero-card hero-card--stat stat-card">
          <div class="hero-card__label stat-label">已练习题目</div>
          <div class="hero-card__value stat-number" id="total-practiced">{{ historyStats.totalPracticed }}</div>
          <div class="hero-card__meta">累计巩固练习</div>
        </div>
        <div class="hero-card hero-card--stat stat-card">
          <div class="hero-card__label stat-label">平均正确率</div>
          <div class="hero-card__value stat-number" id="avg-score">{{ historyStats.averageAccuracy }}%</div>
          <div class="hero-card__meta">近期待练表现</div>
        </div>
        <div class="hero-card hero-card--stat stat-card">
          <div class="hero-card__label stat-label">学习时长(分钟)</div>
          <div class="hero-card__value stat-number" id="study-time">{{ historyStats.studyMinutes }}</div>
          <div class="hero-card__meta">聚焦沉浸时长</div>
        </div>
        <div class="hero-card hero-card--stat stat-card">
          <div class="hero-card__label stat-label">连续学习天数</div>
          <div class="hero-card__value stat-number" id="streak-days">{{ historyStats.streakDays }}</div>
          <div class="hero-card__meta">坚持天数</div>
        </div>
      </div>

      <div class="practice-insights-grid">
        <section
          id="practice-trend-card"
          class="practice-trend-card"
          role="button"
          tabindex="0"
          aria-label="打开练习趋势筛选范围"
          aria-pressed="false"
        >
          <div class="practice-trend-card__rotor">
            <div class="practice-trend-card__face practice-trend-card__front">
              <div class="practice-trend-card__header">
                <div class="practice-trend-card__title-line">
                  <div>
                    <p class="practice-trend-card__eyebrow">Trend</p>
                    <h3 class="practice-trend-card__title">练习趋势</h3>
                  </div>
                  <div class="practice-trend-card__metrics">
                    <div>
                      <span class="practice-trend-card__metric-value" id="practice-trend-count">{{ practiceTrendSummary.count }}</span>
                      <span class="practice-trend-card__metric-label">记录</span>
                    </div>
                    <div>
                      <span class="practice-trend-card__metric-value" id="practice-trend-average">{{ practiceTrendSummary.averageAccuracy }}%</span>
                      <span class="practice-trend-card__metric-label">均值</span>
                    </div>
                  </div>
                </div>
                <div class="practice-trend-card__range" id="practice-trend-range-label">{{ practiceTrendSummary.rangeLabel }}</div>
              </div>
              <div class="practice-trend-chart-shell">
                <canvas id="practice-trend-canvas" aria-hidden="true"></canvas>
                <div v-if="practiceTrendBars.length === 0" id="practice-trend-empty" class="practice-trend-empty">
                  暂无趋势数据
                </div>
                <div v-else class="practice-trend-bars" aria-label="练习正确率趋势">
                  <span
                    v-for="bar in practiceTrendBars"
                    :key="bar.id"
                    class="practice-trend-bar"
                    :style="{ height: `${bar.height}%` }"
                    :title="`${bar.label}: ${bar.accuracy}%`"
                  ></span>
                </div>
              </div>
            </div>
            <div class="practice-trend-card__face practice-trend-card__back">
              <div class="practice-trend-card__header">
                <div>
                  <p class="practice-trend-card__eyebrow">Range</p>
                  <h3 class="practice-trend-card__title">筛选范围</h3>
                </div>
              </div>
              <div class="practice-trend-options" aria-label="练习趋势筛选范围">
                <button
                  v-for="range in practiceTrendRanges"
                  :key="range.value"
                  class="practice-trend-option"
                  :class="{ active: practiceTrendRange === range.value }"
                  type="button"
                  :data-practice-trend-range="range.value"
                  :aria-pressed="practiceTrendRange === range.value ? 'true' : 'false'"
                  @click.stop="$emit('select-practice-trend-range', range.value)"
                >
                  {{ range.label }}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section
          id="practice-custom-card"
          class="practice-custom-card"
          :class="{ 'is-flipped': practiceWidgetSelectorOpen }"
          role="button"
          tabindex="0"
          aria-label="打开自定义练习组件选择"
          :aria-pressed="practiceWidgetSelectorOpen ? 'true' : 'false'"
        >
          <div class="practice-custom-card__rotor">
            <div class="practice-trend-card__face practice-custom-card__front">
              <div class="practice-trend-card__header">
                <div>
                  <p class="practice-trend-card__eyebrow">{{ activePracticeWidgetMeta.eyebrow }}</p>
                  <h3 class="practice-trend-card__title" id="practice-custom-card-title">{{ activePracticeWidgetMeta.title }}</h3>
                </div>
                <div class="practice-custom-card__header-actions">
                  <div
                    v-if="activePracticeWidget === 'heatmap'"
                    class="practice-heatmap-month-controls"
                    id="practice-heatmap-month-controls"
                    aria-label="切换热力图月份"
                  >
                    <button
                      class="practice-custom-card__icon-btn"
                      type="button"
                      data-practice-heatmap-month="prev"
                      aria-label="查看上个月"
                      title="上个月"
                      @click.stop="$emit('shift-heatmap-month', -1)"
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="m15 18-6-6 6-6"></path>
                      </svg>
                    </button>
                    <span class="practice-heatmap-month-label" id="practice-heatmap-month-label" aria-live="polite">{{ heatmapMonthLabel }}</span>
                    <button
                      class="practice-custom-card__icon-btn"
                      type="button"
                      data-practice-heatmap-month="next"
                      aria-label="查看下个月"
                      title="下个月"
                      @click.stop="$emit('shift-heatmap-month', 1)"
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="m9 18 6-6-6-6"></path>
                      </svg>
                    </button>
                  </div>
                  <button
                    class="practice-custom-card__flip-btn practice-custom-card__icon-btn"
                    type="button"
                    aria-label="配置自定义组件"
                    title="配置自定义组件"
                    :aria-pressed="practiceWidgetSelectorOpen ? 'true' : 'false'"
                    @click.stop="$emit('update:practiceWidgetSelectorOpen', true)"
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z"></path>
                      <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"></path>
                      <path d="M12 2v2"></path>
                      <path d="M12 20v2"></path>
                      <path d="m4.93 4.93 1.41 1.41"></path>
                      <path d="m17.66 17.66 1.41 1.41"></path>
                      <path d="M2 12h2"></path>
                      <path d="M20 12h2"></path>
                      <path d="m6.34 17.66-1.41 1.41"></path>
                      <path d="m19.07 4.93-1.41 1.41"></path>
                    </svg>
                  </button>
                </div>
              </div>
              <div v-show="activePracticeWidget === 'heatmap'" class="practice-custom-widget-content" data-widget-type="heatmap">
                <div class="practice-heatmap" id="practice-heatmap" aria-label="练习活动热力图">
                  <span
                    v-for="day in practiceHeatmapDays"
                    :key="day.key"
                    class="practice-heatmap__cell"
                    :class="`practice-heatmap__cell--${day.level}`"
                    :title="`${day.label}: ${day.count} 次练习`"
                    :aria-label="`${day.label}: ${day.count} 次练习`"
                  ></span>
                </div>
                <div class="practice-heatmap__footer">
                  <span id="practice-heatmap-summary">{{ practiceHeatmapSummary }}</span>
                  <div class="practice-heatmap__legend" aria-label="做题量颜色图例">
                    <span>少</span>
                    <i class="practice-heatmap__legend-cell practice-heatmap__legend-cell--0"></i>
                    <i class="practice-heatmap__legend-cell practice-heatmap__legend-cell--1"></i>
                    <i class="practice-heatmap__legend-cell practice-heatmap__legend-cell--2"></i>
                    <i class="practice-heatmap__legend-cell practice-heatmap__legend-cell--3"></i>
                    <i class="practice-heatmap__legend-cell practice-heatmap__legend-cell--4"></i>
                    <span>多</span>
                  </div>
                </div>
              </div>
              <div v-show="activePracticeWidget === 'priority'" class="practice-custom-widget-content" data-widget-type="priority">
                <div class="priority-progress-stack" aria-label="中高频练习进度">
                  <div class="priority-progress priority-progress--high">
                    <div class="priority-progress__head">
                      <span>高频</span>
                      <strong id="practice-priority-high-count">{{ priorityInsight.high.practiced }}/{{ priorityInsight.high.total }}</strong>
                    </div>
                    <div class="priority-progress__track" aria-hidden="true">
                      <span
                        class="priority-progress__fill"
                        id="practice-priority-high-fill"
                        :style="{ width: `${priorityInsight.high.percent}%` }"
                      ></span>
                    </div>
                  </div>
                  <div class="priority-progress priority-progress--medium">
                    <div class="priority-progress__head">
                      <span>中频</span>
                      <strong id="practice-priority-medium-count">{{ priorityInsight.medium.practiced }}/{{ priorityInsight.medium.total }}</strong>
                    </div>
                    <div class="priority-progress__track" aria-hidden="true">
                      <span
                        class="priority-progress__fill"
                        id="practice-priority-medium-fill"
                        :style="{ width: `${priorityInsight.medium.percent}%` }"
                      ></span>
                    </div>
                  </div>
                </div>
                <div class="priority-accuracy" aria-label="中高频正确率">
                  <div class="priority-accuracy__orb priority-accuracy__orb--high">
                    <span id="practice-priority-high-accuracy">{{ priorityInsight.high.accuracy }}%</span>
                    <small>高频正确率</small>
                  </div>
                  <div class="priority-accuracy__orb priority-accuracy__orb--medium">
                    <span id="practice-priority-medium-accuracy">{{ priorityInsight.medium.accuracy }}%</span>
                    <small>中频正确率</small>
                  </div>
                </div>
              </div>
              <div v-show="activePracticeWidget === 'radar'" class="practice-custom-widget-content" data-widget-type="radar">
                <div class="practice-radar-chart-shell">
                  <canvas id="practice-radar-canvas" aria-hidden="true"></canvas>
                  <div
                    v-if="readingRadarInsight.totalErrors === 0"
                    id="practice-radar-empty"
                    class="practice-trend-empty"
                  >
                    暂无阅读错题数据
                  </div>
                  <div v-else class="practice-radar-bars" aria-label="阅读错题题型分布">
                    <div
                      v-for="point in readingRadarInsight.dataPoints"
                      :key="point.type"
                      class="practice-radar-bar"
                      :style="{ '--radar-value': `${point.percent}%` }"
                    >
                      <span class="practice-radar-bar__label">{{ point.label }}</span>
                      <span class="practice-radar-bar__track" aria-hidden="true">
                        <span class="practice-radar-bar__fill"></span>
                      </span>
                      <strong>{{ point.count }}</strong>
                    </div>
                  </div>
                </div>
                <p class="practice-radar-summary" id="practice-radar-summary">{{ readingRadarInsight.summary }}</p>
              </div>
            </div>
            <div class="practice-trend-card__face practice-trend-card__back practice-custom-card__back">
              <div class="practice-trend-card__header">
                <div>
                  <p class="practice-trend-card__eyebrow">Widgets</p>
                  <h3 class="practice-trend-card__title">自定义组件</h3>
                </div>
                <div class="practice-custom-card__header-actions">
                  <button
                    class="practice-custom-card__flip-btn practice-custom-card__icon-btn"
                    type="button"
                    aria-label="关闭自定义练习组件选择"
                    title="关闭自定义练习组件选择"
                    @click.stop="$emit('update:practiceWidgetSelectorOpen', false)"
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>
              </div>
              <div class="practice-custom-options" aria-label="自定义练习组件">
                <button
                  v-for="widget in practiceWidgetOptions"
                  :key="widget.value"
                  class="practice-custom-option"
                  :class="{ active: activePracticeWidget === widget.value }"
                  type="button"
                  :data-practice-widget="widget.value"
                  :aria-pressed="activePracticeWidget === widget.value ? 'true' : 'false'"
                  @click.stop="$emit('select-practice-widget', widget.value)"
                >
                  <span class="practice-custom-option__icon" aria-hidden="true" v-html="widget.icon"></span>
                  <span class="practice-custom-option__body">
                    <strong>{{ widget.label }}</strong>
                  </span>
                  <span class="practice-custom-option__check" aria-hidden="true"></span>
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>

    <div class="practice-history hero-panel hero-section" data-reading-history-panel>
      <div class="hero-panel__header practice-history-header">
        <h3 class="hero-panel__title heading-serif">📈 练习历史</h3>
        <div id="record-type-filter-buttons" class="hero-panel__actions shui-filter-group shui-segmented-control">
          <span class="shui-segmented-indicator" aria-hidden="true"></span>
          <button
            class="shui-segmented-btn shui-filter-btn"
            :class="{ active: selectedHistoryType === 'all' }"
            type="button"
            :aria-pressed="selectedHistoryType === 'all' ? 'true' : 'false'"
            data-filter-type="all"
            data-index-action="filter-records"
            data-action-value="all"
            data-action="filter-record-type"
            @click="$emit('filter-records', 'all')"
          >
            全部
          </button>
          <button
            class="shui-segmented-btn shui-filter-btn"
            :class="{ active: selectedHistoryType === 'reading' }"
            type="button"
            :aria-pressed="selectedHistoryType === 'reading' ? 'true' : 'false'"
            data-filter-type="reading"
            data-index-action="filter-records"
            data-action-value="reading"
            data-action="filter-record-type"
            @click="$emit('filter-records', 'reading')"
          >
            阅读
          </button>
        </div>
        <div class="hero-panel__actions">
          <button class="btn btn-secondary hero-btn hero-btn--ghost" type="button" data-index-action="export-practice-markdown" data-action="export-practice-markdown" :disabled="historyBusy" @click="$emit('export-practice-markdown', $event)">
            📄 导出Markdown
          </button>
          <button class="btn btn-info hero-btn" id="bulk-delete-btn" type="button" data-index-action="toggle-bulk-delete" data-action="toggle-bulk-delete" :disabled="historyBusy" @click="$emit('toggle-bulk-delete-mode', $event)">
            <svg
              viewBox="0 0 24 24"
              width="1em"
              height="1em"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="ui-emoji-icon"
              aria-hidden="true"
            >
              <polyline points="9 11 12 14 22 4"></polyline>
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
            </svg>
            {{ bulkDeleteButtonLabel }}
          </button>
          <button class="btn btn-warning hero-btn hero-btn--warn" type="button" data-index-action="clear-practice-data" data-action="clear-practice-data" :disabled="historyBusy" @click="$emit('clear-practice-data', $event)">
            🗑️ 清除记录
          </button>
        </div>
      </div>
      <div class="practice-history-search-row">
        <div class="search-input-wrap">
          <input
            :value="historyKeyword"
            type="text"
            class="search-input"
            id="history-search-input"
            placeholder="搜索练习记录（标题/分类/日期）..."
            aria-label="搜索练习记录"
            data-input-action="search-practice-history"
            data-input-event="input"
            @input="$emit('update:historyKeyword', $event.target.value)"
          >
          <button
            type="button"
            class="search-clear-btn history-search-clear-btn"
            id="history-search-clear-btn"
            aria-label="清除练习记录搜索"
            :hidden="!historyKeyword"
            data-action="clear-history-search"
            @click="$emit('update:historyKeyword', '')"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>

      <div v-if="historyError" class="inline-message inline-message-error">{{ historyError }}</div>
      <div id="history-list" class="practice-history-list">
        <div v-if="loadingHistory" class="loading">
          <div class="spinner"></div>
          <p>正在加载练习记录...</p>
        </div>
        <div v-else-if="filteredHistory.length === 0" class="history-empty-placeholder">
          <div class="history-empty-placeholder__icon" aria-hidden="true">📋</div>
          <p>暂无练习记录</p>
          <p class="history-empty-placeholder__note">开始练习后，记录将自动保存在这里</p>
        </div>
        <div
          v-for="record in filteredHistory"
          v-else
          :key="record.id"
          class="history-item history-record-item"
          :class="{ 'history-item-selectable': bulkDeleteMode, 'history-item-selected': selectedHistoryIds.has(record.id) }"
          :data-record-id="record.id"
          @click="$emit('history-item-click', record, $event)"
        >
          <div :class="['record-selection', { 'record-selection-hidden': !bulkDeleteMode }]">
            <input
              type="checkbox"
              :checked="selectedHistoryIds.has(record.id)"
              :data-record-id="record.id"
              :tabindex="bulkDeleteMode ? '0' : '-1'"
              aria-label="选择练习记录"
              @change.stop="$emit('toggle-history-selection', record.id)"
            >
          </div>
          <div :class="['record-info', { 'record-info-selectable': bulkDeleteMode }]">
            <a
              href="#"
              class="practice-record-title"
              data-record-action="details"
              :data-record-id="record.id"
              @click.prevent.stop="$emit('open-reading-review', record)"
            >
              <strong>{{ record.title || '无标题' }}</strong>
            </a>
            <div class="record-meta-line">
              <small class="record-date">{{ formatRecordDate(record) }}</small>
              <small class="record-duration-value">
                <strong>用时</strong>
                <strong class="duration-time">{{ formatDurationShort(record.duration) }}</strong>
              </small>
            </div>
          </div>
          <div class="record-percentage-container">
            <div class="record-percentage" :style="{ color: getScoreColor(historyPercentage(record)) }">
              {{ historyPercentage(record) }}%
            </div>
          </div>
          <div v-if="!bulkDeleteMode" class="record-actions-container">
            <button
              type="button"
              class="delete-record-btn"
              title="删除此记录"
              :aria-label="`删除练习记录: ${record.title || '无标题'}`"
              data-record-action="delete"
              :data-record-id="record.id"
              :disabled="historyBusy"
              @click.stop="$emit('delete-history-record', record)"
            >
              🗑️
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  activeView: { type: String, required: true },
  practiceSummaryExpanded: { type: Boolean, default: true },
  historyStats: { type: Object, required: true },
  practiceTrendSummary: { type: Object, required: true },
  practiceTrendBars: { type: Array, required: true },
  practiceTrendRanges: { type: Array, required: true },
  practiceTrendRange: { type: String, required: true },
  practiceWidgetSelectorOpen: { type: Boolean, default: false },
  activePracticeWidget: { type: String, required: true },
  activePracticeWidgetMeta: { type: Object, required: true },
  heatmapMonthLabel: { type: String, required: true },
  practiceHeatmapDays: { type: Array, required: true },
  practiceHeatmapSummary: { type: String, required: true },
  priorityInsight: { type: Object, required: true },
  readingRadarInsight: { type: Object, required: true },
  practiceWidgetOptions: { type: Array, required: true },
  selectedHistoryType: { type: String, required: true },
  historyBusy: { type: Boolean, default: false },
  bulkDeleteButtonLabel: { type: String, required: true },
  historyKeyword: { type: String, default: '' },
  historyError: { type: String, default: '' },
  loadingHistory: { type: Boolean, default: false },
  filteredHistory: { type: Array, required: true },
  bulkDeleteMode: { type: Boolean, default: false },
  selectedHistoryIds: { type: Object, required: true },
  formatRecordDate: { type: Function, required: true },
  formatDurationShort: { type: Function, required: true },
  getScoreColor: { type: Function, required: true },
  historyPercentage: { type: Function, required: true }
})

defineEmits([
  'update:practiceWidgetSelectorOpen',
  'update:historyKeyword',
  'toggle-practice-summary',
  'select-practice-trend-range',
  'shift-heatmap-month',
  'select-practice-widget',
  'filter-records',
  'export-practice-markdown',
  'toggle-bulk-delete-mode',
  'clear-practice-data',
  'history-item-click',
  'toggle-history-selection',
  'open-reading-review',
  'delete-history-record'
])
</script>
