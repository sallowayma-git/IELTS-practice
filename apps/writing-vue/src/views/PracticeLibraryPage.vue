<template>
  <div class="container hero-shell practice-library-legacy practice-library-open-source" data-practice-reading-home>
    <div class="hero-header">
      <h1 class="hero-brand-title" aria-label="IELTS Atlas">
        <span class="hero-brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4.5 20V8.2a2.7 2.7 0 0 1 2.7-2.7H10"></path>
            <path d="M19.5 20V8.2a2.7 2.7 0 0 0-2.7-2.7H14"></path>
            <path d="M7.2 16.8H10a2 2 0 0 1 2 2V6.5a2 2 0 0 0-2-2H7.2a2.7 2.7 0 0 0-2.7 2.7v11.6a2 2 0 0 1 2-2Z"></path>
            <path d="M16.8 16.8H14a2 2 0 0 0-2 2V6.5a2 2 0 0 1 2-2h2.8a2.7 2.7 0 0 1 2.7 2.7v11.6a2 2 0 0 0-2-2Z"></path>
            <path d="M9 9.5h1.3M13.7 9.5H15"></path>
          </svg>
        </span>
        <span class="hero-brand-text">IELTS Atlas</span>
        <span class="hero-brand-subtitle">项目仅授权ZYZ Reading Walks 提供分发，小红书号：276752989</span>
        <a
          href="https://www.xiaohongshu.com/user/profile/5b4d76744eacab058489e72f"
          target="_blank"
          rel="noopener noreferrer"
          class="hero-badge hero-badge--cta hero-badge--redbook"
          aria-label="小红书主页"
        >
          小红书
        </a>
        <a
          href="https://github.com/sallowayma-git/IELTS-practice"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-hover-link"
          aria-label="GitHub Repository"
        >
          <svg viewBox="0 0 24 24" width="28" height="28" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
          </svg>
        </a>
      </h1>
    </div>

    <nav class="main-nav hero-nav" data-nav-controller="legacy" aria-label="主导航">
      <span class="hero-nav__liquid-indicator" aria-hidden="true"></span>
      <button
        v-for="item in legacyViews"
        :key="item.value"
        type="button"
        :class="['nav-btn', 'hero-nav__btn', { active: activeView === item.value || (activeView === 'vocab' && item.value === 'more') }]"
        :data-view="item.value"
        @click="showView(item.value)"
      >
        <span class="ui-emoji-icon" v-html="item.icon"></span>
        {{ item.label }}
      </button>
    </nav>

    <div id="overview-view" :class="['view', 'hero-panel', 'hero-section', { active: activeView === 'overview' }]" data-reading-overview>
      <div class="hero-panel__header">
        <h2 class="hero-panel__title heading-serif">📊 学习总览</h2>
      </div>
      <div class="category-grid" id="category-overview">
        <div class="overview-section-heading">
          <h3 class="overview-section-title">阅读</h3>
          <div class="overview-section-actions">
            <button
              class="btn shui-glass-btn"
              type="button"
              id="endless-mode-btn"
              data-action="start-endless-mode"
              data-overview-action="endless"
              @click="startEndlessMode"
            >
              <span class="ui-emoji-icon" v-html="icons.endless"></span>
              <span>无尽模式</span>
            </button>
            <button
              class="btn shui-glass-btn"
              type="button"
              data-action="start-suite-mode"
              data-overview-action="suite"
              data-start-reading-suite
              :disabled="creatingSuite"
              @click="openSuiteModeSelector"
            >
              <span class="ui-emoji-icon" v-html="icons.suite"></span>
              <span>{{ creatingSuite ? '创建中' : '套题模式' }}</span>
            </button>
          </div>
        </div>

        <div
          v-for="entry in readingCategoryEntries"
          :key="entry.category"
          class="category-card"
          :data-reading-category-card="entry.category"
        >
          <div class="category-header">
            <div class="category-icon">📖</div>
            <div>
              <div class="category-title">{{ entry.category }} 阅读</div>
              <div class="category-meta">{{ entry.total }} 篇</div>
            </div>
          </div>
          <div class="category-actions">
            <button
              class="btn"
              type="button"
              data-action="browse-category"
              :data-category="entry.category"
              data-type="reading"
              @click="browseCategory(entry.category, 'reading')"
            >
              📚 浏览题库
            </button>
            <button
              class="btn btn-secondary"
              type="button"
              data-action="start-random-practice"
              :data-category="entry.category"
              data-type="reading"
              @click="startRandomPractice(entry.category, 'reading')"
            >
              🎲 随机练习
            </button>
          </div>
        </div>
      </div>
      <div v-if="error" class="inline-message inline-message-error">{{ error }}</div>
      <div v-if="suiteError" class="inline-message inline-message-error" data-reading-suite-error>{{ suiteError }}</div>
    </div>

    <div id="browse-view" :class="['view', 'hero-panel', 'hero-section', { active: activeView === 'browse' }]" data-reading-browse>
      <div class="browse-title-bar hero-panel__header">
        <button
          class="browse-title-trigger"
          id="browse-title-trigger"
          type="button"
          aria-haspopup="true"
          :aria-expanded="browsePreferencePanelOpen ? 'true' : 'false'"
          title="列表偏好"
          @click="toggleBrowsePreference"
        >
          <span class="ui-emoji-icon" v-html="icons.book"></span>
          <span class="browse-title-dot" aria-hidden="true"></span>
        </button>
        <h2 id="browse-title" class="hero-panel__title">{{ browseTitle }}</h2>
        <div
          class="browse-preference-panel"
          id="browse-preference-panel"
          :hidden="!browsePreferencePanelOpen"
        >
          <label class="browse-preference-option">
            <input
              id="browse-remember-position"
              v-model="browseRememberPosition"
              type="checkbox"
              @change="persistBrowsePreference"
            >
            <span class="browse-preference-text">列表位置记录</span>
          </label>
        </div>
        <div id="type-filter-buttons" class="hero-panel__actions shui-filter-group shui-segmented-control">
          <span class="shui-segmented-indicator" aria-hidden="true"></span>
          <button
            v-for="filter in typeFilters"
            :key="filter.value"
            class="shui-segmented-btn shui-filter-btn"
            :class="{ active: selectedType === filter.value }"
            type="button"
            :aria-pressed="selectedType === filter.value ? 'true' : 'false'"
            :data-filter-type="filter.value"
            data-action="filter-exam-type"
            @click="filterByType(filter.value)"
          >
            {{ filter.label }}
          </button>
        </div>
      </div>

      <div class="search-box">
        <div class="search-row">
          <div class="search-input-wrap">
            <input
              v-model="keyword"
              type="text"
              class="search-input"
              id="exam-search-input"
              placeholder="搜索题目..."
              aria-label="搜索题目"
              data-input-action="search-exams"
              data-input-event="keyup"
            >
            <button
              type="button"
              class="search-clear-btn"
              id="search-clear-btn"
              aria-label="清除搜索"
              :hidden="!keyword"
              data-action="clear-exam-search"
              @click="clearSearch"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div
            class="browse-frequency-filter"
            id="browse-frequency-filter-buttons"
            aria-label="频率筛选"
          >
            <button
              v-for="filter in frequencyFilters"
              :key="filter.value"
              class="browse-frequency-chip"
              :class="{ active: frequencyFilter === filter.value }"
              type="button"
              :aria-pressed="frequencyFilter === filter.value ? 'true' : 'false'"
              :data-frequency-filter="filter.value"
              data-index-action="filter-frequency"
              :data-action-value="filter.value"
              @click="toggleFrequencyFilter(filter.value)"
            >
              {{ filter.label }}
            </button>
          </div>
          <div class="browse-sort-wrapper">
            <select v-model="sortMode" id="browse-sort-select" class="browse-sort-select" aria-label="题库排序">
              <option value="default">默认排序</option>
              <option value="frequency-desc">频率高→低</option>
              <option value="difficulty-desc">难度高→低</option>
            </select>
            <div class="browse-sort-icon" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3.5 5.25L7 8.75L10.5 5.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      <div v-if="error" class="inline-message inline-message-error">
        <span>{{ error }}</span>
        <button class="btn-text" type="button" @click="loadReadingData">重试</button>
      </div>
      <div v-if="suiteError" class="inline-message inline-message-error" data-reading-suite-error>{{ suiteError }}</div>
      <div id="exam-list-container">
        <div v-if="loading" class="loading">
          <div class="spinner"></div>
          <p>正在加载题目列表...</p>
        </div>
        <div v-else-if="filteredReadingAssets.length === 0" class="exam-list-empty" role="status">
          <div class="exam-list-empty-icon" aria-hidden="true">🔍</div>
          <p class="exam-list-empty-text">未找到匹配的题目</p>
          <p class="exam-list-empty-hint">请调整筛选条件或搜索词后再试</p>
          <div v-if="keyword" class="exam-list-empty-actions">
            <button class="btn btn-secondary exam-list-empty-action" type="button" @click="clearSearch">清除搜索</button>
          </div>
        </div>
        <div v-else class="exam-list">
          <div
            v-for="asset in filteredReadingAssets"
            :key="asset.id"
            class="exam-item"
            :data-exam-id="asset.id"
            :data-reading-asset-id="asset.id"
          >
            <div class="exam-info">
              <div>
                <h4>{{ asset.title }}</h4>
                <div class="exam-meta">{{ formatExamMetaText(asset) }}</div>
              </div>
            </div>
            <div class="exam-actions">
              <button
                class="btn exam-item-action-btn"
                type="button"
                data-action="start"
                :data-exam-id="asset.id"
                :aria-label="`开始练习 ${asset.title}`"
                @click="startReading(asset)"
              >
                开始练习
              </button>
              <button
                class="btn btn-outline exam-item-action-btn"
                type="button"
                data-action="pdf"
                :data-exam-id="asset.id"
                :aria-label="`查看PDF ${asset.title}`"
                @click="viewPdf(asset)"
              >
                PDF
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

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
            @click="togglePracticeSummary"
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
                    @click.stop="selectPracticeTrendRange(range.value)"
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
                        @click.stop="shiftHeatmapMonth(-1)"
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
                        @click.stop="shiftHeatmapMonth(1)"
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
                      @click.stop="practiceWidgetSelectorOpen = true"
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
                      @click.stop="practiceWidgetSelectorOpen = false"
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
                    @click.stop="selectPracticeWidget(widget.value)"
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
            <button class="shui-segmented-btn shui-filter-btn active" type="button" aria-pressed="true" data-filter-type="all" data-action="filter-record-type">
              全部
            </button>
            <button class="shui-segmented-btn shui-filter-btn" type="button" aria-pressed="false" data-filter-type="reading" data-action="filter-record-type">
              阅读
            </button>
          </div>
          <div class="hero-panel__actions">
            <button class="btn btn-secondary hero-btn hero-btn--ghost" type="button" data-action="export-practice-markdown" :disabled="historyBusy" @click="exportPracticeMarkdown">
              导出Markdown
            </button>
            <button class="btn btn-info hero-btn" id="bulk-delete-btn" type="button" data-action="toggle-bulk-delete" :disabled="historyBusy" @click="toggleBulkDeleteMode">
              {{ bulkDeleteButtonLabel }}
            </button>
            <button class="btn btn-warning hero-btn hero-btn--warn" type="button" data-action="clear-practice-data" :disabled="historyBusy" @click="clearPracticeData">
              清除记录
            </button>
          </div>
        </div>
        <div class="practice-history-search-row">
          <div class="search-input-wrap">
            <input
              v-model="historyKeyword"
              type="text"
              class="search-input"
              id="history-search-input"
              placeholder="搜索练习记录（标题/分类/日期）..."
              aria-label="搜索练习记录"
              data-input-action="search-practice-history"
              data-input-event="input"
            >
            <button
              type="button"
              class="search-clear-btn history-search-clear-btn"
              id="history-search-clear-btn"
              aria-label="清除练习记录搜索"
              :hidden="!historyKeyword"
              data-action="clear-history-search"
              @click="historyKeyword = ''"
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
          <div v-else-if="filteredHistory.length === 0" class="practice-history-empty">
            <div class="practice-history-empty-icon" aria-hidden="true">📂</div>
            <p class="practice-history-empty-text">暂无任何练习记录</p>
            <p>开始练习后，记录将自动保存在这里</p>
            <button class="btn btn-primary" type="button" @click="browseCategory('all', 'reading')">去题库练习</button>
          </div>
          <div
            v-for="record in filteredHistory"
            v-else
            :key="record.id"
            class="history-item history-record-item"
            :class="{ 'history-item-selectable': bulkDeleteMode, 'history-item-selected': selectedHistoryIds.has(record.id) }"
            :data-record-id="record.id"
            @click="handleHistoryItemClick(record, $event)"
          >
            <div :class="['record-selection', { 'record-selection-hidden': !bulkDeleteMode }]">
              <input
                type="checkbox"
                :checked="selectedHistoryIds.has(record.id)"
                :data-record-id="record.id"
                :tabindex="bulkDeleteMode ? '0' : '-1'"
                aria-label="选择练习记录"
                @change.stop="toggleHistorySelection(record.id)"
              >
            </div>
            <div :class="['record-info', { 'record-info-selectable': bulkDeleteMode }]">
              <a
                href="#"
                class="practice-record-title"
                data-record-action="details"
                :data-record-id="record.id"
                @click.prevent.stop="openReadingReview(record)"
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
                @click.stop="deleteHistoryRecord(record)"
              >
                🗑️
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div id="more-view" :class="['view', 'hero-panel', 'hero-section', { active: activeView === 'more' }]" data-reading-more>
      <div class="hero-panel__header">
        <h2 class="hero-panel__title heading-serif">✨ 更多工具</h2>
      </div>
      <p class="more-view-subtitle">探索额外的学习辅助功能，助你高效备考。</p>
      <div class="more-tools-grid">
        <button class="tool-card tool-card--featured" type="button" id="writing-entry-btn" @click="openWritingEntry">
          <div class="tool-card-icon" v-html="icons.editLarge"></div>
          <div class="tool-card-content">
            <h3>写作评分</h3>
            <p>AI驱动的雅思写作评分系统，获取专业四维度评分与详细反馈。</p>
          </div>
          <div class="tool-card-arrow">进入</div>
        </button>
        <button class="tool-card" type="button" data-action="open-clock" @click="openClockTool">
          <div class="tool-card-icon" v-html="icons.clockLarge"></div>
          <div class="tool-card-content">
            <h3>全屏时钟</h3>
            <p>沉浸式模拟指针时钟，实时同步系统时间，陪伴你的专注时刻。</p>
          </div>
          <div class="tool-card-arrow">进入</div>
        </button>
        <button class="tool-card" type="button" data-action="open-vocab" @click="openVocabTool">
          <div class="tool-card-icon" v-html="icons.vocabLarge"></div>
          <div class="tool-card-content">
            <h3>单词背诵</h3>
            <p>本地 Leitner 分箱 + 艾宾浩斯复习节奏，随时继续你的词汇任务。</p>
          </div>
          <div class="tool-card-arrow">进入</div>
        </button>
        <button class="tool-card" type="button" data-action="open-reading-memorize" @click="openReadingMemorize">
          <div class="tool-card-icon">🧩</div>
          <div class="tool-card-content">
            <h3>阅读背题</h3>
            <p>复用统一阅读页，查看答案、解析与定位高亮，并可切换测试。</p>
          </div>
          <div class="tool-card-arrow">进入</div>
        </button>
        <button class="tool-card" type="button" data-action="show-achievements" @click="showAchievementsTool">
          <div class="tool-card-icon" v-html="icons.achievementLarge"></div>
          <div class="tool-card-content">
            <h3>成就</h3>
            <p>查看你解锁的徽章和荣誉。</p>
          </div>
          <div class="tool-card-arrow">查看</div>
        </button>
      </div>
    </div>

    <section id="vocab-view" :class="['view', { active: activeView === 'vocab' }]" data-view="vocab" :hidden="activeView !== 'vocab'">
      <div class="vocab-view-shell" data-vocab-role="root"></div>
    </section>

    <div id="achievements-modal" class="theme-modal">
      <div class="theme-modal-content" style="max-width: 600px;">
        <div class="theme-modal-header">
          <h3 class="heading-serif">
            <span class="ui-emoji-icon" v-html="icons.achievementSmall"></span>
            我的成就
          </h3>
          <button class="theme-modal-close" type="button" data-action="hide-achievements" aria-label="关闭" @click="hideAchievementsTool">×</button>
        </div>
        <div class="theme-modal-body">
          <div class="achievements-grid" id="achievements-list"></div>
        </div>
      </div>
    </div>

    <div
      id="suite-mode-selector-modal"
      class="theme-modal suite-mode-selector-modal"
      :class="{ show: suiteModeSelectorOpen }"
      role="dialog"
      aria-modal="true"
      aria-labelledby="suite-mode-selector-title"
      @click.self="closeSuiteModeSelector"
    >
      <div class="theme-modal-content suite-mode-selector-content">
        <div class="theme-modal-header">
          <div>
            <h3 id="suite-mode-selector-title">选择套题流程</h3>
            <p class="suite-mode-selector-subtitle">本次会话将锁定所选流程，答题中不再切换。</p>
          </div>
          <button
            class="theme-modal-close"
            type="button"
            data-suite-flow-cancel="1"
            aria-label="取消套题流程选择"
            @click="closeSuiteModeSelector"
          >
            ×
          </button>
        </div>
        <div class="theme-modal-body suite-mode-selector-body">
          <div class="suite-flow-options" aria-label="套题流程">
            <button
              v-for="option in suiteFlowOptions"
              :key="option.value"
              class="suite-flow-option"
              :class="{ active: selectedSuiteFlowMode === option.value }"
              type="button"
              :data-suite-flow-mode="option.value"
              :aria-pressed="selectedSuiteFlowMode === option.value ? 'true' : 'false'"
              @click="selectSuiteFlowMode(option.value, { start: true })"
            >
              <span>{{ option.label }}</span>
              <small>{{ option.description }}</small>
            </button>
          </div>
          <label class="suite-frequency-selector" for="suite-frequency-scope">
            <span>抽题范围</span>
            <select
              id="suite-frequency-scope"
              v-model="selectedSuiteFrequencyScope"
              class="suite-frequency-select"
            >
              <option
                v-for="option in suiteFrequencyOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </label>
          <div class="suite-mode-selector-actions">
            <button class="btn btn-secondary" type="button" data-suite-flow-cancel="1" @click="closeSuiteModeSelector">取消</button>
          </div>
        </div>
      </div>
    </div>

    <div
      id="fullscreen-clock-overlay"
      class="clock-overlay is-hidden"
      role="dialog"
      aria-modal="true"
      aria-label="全屏时钟"
    >
      <div class="clock-overlay-inner controls-hidden" data-clock-role="overlay-inner">
        <button
          class="clock-action-btn clock-fullscreen-btn"
          type="button"
          data-action="toggle-clock-fullscreen"
          aria-label="切换全屏模式"
          aria-pressed="false"
        >
          <svg class="fullscreen-icon icon-enter" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <polyline points="4 9 4 4 9 4"></polyline>
            <line x1="4" y1="4" x2="10" y2="10"></line>
            <polyline points="20 15 20 20 15 20"></polyline>
            <line x1="20" y1="20" x2="14" y2="14"></line>
          </svg>
          <svg class="fullscreen-icon icon-exit" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <polyline points="15 9 20 9 20 4"></polyline>
            <line x1="20" y1="4" x2="14" y2="10"></line>
            <polyline points="9 15 4 15 4 20"></polyline>
            <line x1="4" y1="20" x2="10" y2="14"></line>
            <polyline points="20 15 20 20 15 20"></polyline>
            <line x1="20" y1="20" x2="14" y2="14"></line>
            <polyline points="4 9 4 4 9 4"></polyline>
            <line x1="4" y1="4" x2="10" y2="10"></line>
          </svg>
        </button>
        <button
          class="clock-action-btn clock-close-btn"
          type="button"
          data-action="close-clock"
          aria-label="关闭时钟"
        >
          <svg class="fullscreen-icon icon-close" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <line x1="8" y1="8" x2="16" y2="16"></line>
            <line x1="16" y1="8" x2="8" y2="16"></line>
          </svg>
        </button>
        <div class="clock-view-stack" data-clock-role="view-stack">
          <section class="clock-view is-active" data-clock-view="analog" aria-label="模拟指针时钟">
            <canvas id="analog-clock-canvas" aria-hidden="true"></canvas>
          </section>
          <section class="clock-view" data-clock-view="flip" aria-label="翻页时钟">
            <div class="flip-clock" id="flip-clock" aria-live="polite"></div>
          </section>
          <section class="clock-view" data-clock-view="digital" aria-label="数字时钟">
            <div class="digital-clock" id="digital-clock" aria-live="polite"></div>
          </section>
          <section class="clock-view" data-clock-view="ambient" aria-label="低对比度数字时钟">
            <div class="ambient-clock" id="ambient-clock" aria-live="polite"></div>
          </section>
        </div>
        <div class="clock-pagination" data-clock-role="pagination" aria-hidden="true">
          <button class="clock-dot is-active" type="button" data-target-view="analog" aria-label="切换到模拟指针时钟"></button>
          <button class="clock-dot" type="button" data-target-view="flip" aria-label="切换到翻页时钟"></button>
          <button class="clock-dot" type="button" data-target-view="digital" aria-label="切换到数字时钟"></button>
          <button class="clock-dot" type="button" data-target-view="ambient" aria-label="切换到低对比度数字时钟"></button>
        </div>
      </div>
    </div>

    <div id="settings-view" :class="['view', 'hero-panel', 'hero-section', { active: activeView === 'settings' }]" data-reading-settings>
      <div class="hero-panel__header">
        <h2 class="hero-panel__title heading-serif">⚙️ 系统设置</h2>
      </div>
      <div class="hero-settings-group">
        <div class="hero-panel hero-section system-management-panel">
          <h3 class="heading-serif">🔧 系统管理</h3>
          <p class="hero-panel__muted">系统工具和设置选项</p>
          <div class="hero-settings-actions">
            <button class="btn btn-warning hero-btn hero-btn--warn" id="clear-cache-btn" type="button" @click="clearPracticeCache">
              🗑️ 清除缓存
            </button>
            <button class="btn btn-warning hero-btn hero-btn--warn" id="load-library-btn" type="button" @click="loadReadingData">
              📂 加载题库
            </button>
            <button class="btn btn-warning hero-btn hero-btn--warn" id="theme-switcher-btn-entry" type="button" @click="switchBackgroundTheme">
              🎨 主题切换
            </button>
            <button class="btn btn-warning hero-btn hero-btn--warn" id="show-onboarding-btn" type="button" @click="startOnboardingTour">
              🎯 显示引导
            </button>
            <button class="btn btn-warning hero-btn hero-btn--warn" id="library-config-btn" type="button" data-action="library-config" @click="showReadingLibraryConfigList">
              <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="ui-emoji-icon" aria-hidden="true">
                <line x1="4" y1="21" x2="4" y2="14"></line>
                <line x1="4" y1="10" x2="4" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12" y2="3"></line>
                <line x1="20" y1="21" x2="20" y2="16"></line>
                <line x1="20" y1="12" x2="20" y2="3"></line>
                <line x1="1" y1="14" x2="7" y2="14"></line>
                <line x1="9" y1="8" x2="15" y2="8"></line>
                <line x1="17" y1="16" x2="23" y2="16"></line>
              </svg>
              题库配置切换
            </button>
            <button class="btn btn-warning hero-btn hero-btn--warn" id="force-refresh-btn" type="button" data-action="force-refresh" @click="loadReadingData">
              🔄 强制刷新题库
            </button>
          </div>
        </div>

        <div class="hero-panel hero-section data-management-panel">
          <h3 class="heading-serif">💾 数据管理</h3>
          <p class="hero-panel__muted">数据备份、导入导出和完整性检查</p>
          <div class="hero-settings-actions">
            <button class="btn hero-btn data-mgmt-btn" id="create-backup-btn" type="button" :disabled="historyBusy" @click="createReadingBackup">
              💾 创建备份
            </button>
            <button class="btn hero-btn data-mgmt-btn" id="backup-list-btn" type="button" @click="showReadingBackupList">
              📋 备份列表
            </button>
            <button class="btn hero-btn data-mgmt-btn" id="export-data-btn" type="button" :disabled="historyBusy" @click="exportReadingArchive('export')">
              📤 导出数据
            </button>
            <button class="btn hero-btn data-mgmt-btn" id="import-data-btn" type="button" :disabled="historyBusy" @click="triggerReadingArchiveImport">
              📥 导入数据
            </button>
            <input
              ref="readingArchiveImportInput"
              class="settings-file-input"
              data-reading-archive-import-input
              type="file"
              accept="application/json,.json"
              @change="handleReadingArchiveImportChange"
            />
          </div>
        </div>

        <div class="hero-panel hero-section system-info-panel">
          <h3 class="heading-serif">📊 系统信息</h3>
          <div class="hero-surface settings-system-info system-info-surface">
            <div class="settings-system-info__status system-info-status">题库状态: {{ libraryStatusLabel }}</div>
            <div>题目总数: <span id="total-exams">{{ readingAssets.length }}</span></div>
            <div>HTML题目: <span id="html-exams">{{ htmlAssetCount }}</span></div>
            <div>PDF题目: <span id="pdf-exams">{{ pdfAssetCount }}</span></div>
            <div>最后更新: <span id="last-update">{{ latestAssetSyncLabel }}</span></div>
          </div>
          <div class="app-update-actions">
            <button class="btn btn-secondary hero-btn hero-btn--ghost" id="check-updates-btn" type="button" data-update-action="open-modal" @click="openUpdateManager">
              <span data-update-field="entry-action-label">查看更新</span>
            </button>
          </div>
          <div class="settings-footer hero-settings-links legacy-team-links">
            <a href="https://docs.qq.com/doc/DSXZhWUtqeVN0d1ZT" target="_blank" rel="noopener noreferrer" class="inline-hover-link settings-footer__feedback hero-settings-links__feedback">问题反馈</a>
            <a href="https://github.com/sallowayma-git" target="_blank" rel="noopener noreferrer" class="settings-footer__author hero-settings-links__github">Salloway呈现</a>
          </div>
        </div>
      </div>

      <div v-if="backupListOpen" class="backup-list-container" data-reading-backup-list>
        <div class="backup-list-card">
          <div class="backup-list-header">
            <h3 class="backup-list-title">
              <span class="backup-list-title-icon" aria-hidden="true">📋</span>
              <span class="backup-list-title-text">备份列表</span>
            </h3>
            <button class="btn btn-secondary backup-list-dismiss" type="button" @click="backupListOpen = false">收起</button>
          </div>
          <div class="backup-list-scroll">
            <div v-if="!readingBackups.length" class="backup-list-empty">
              <div class="backup-list-empty-icon" aria-hidden="true">📂</div>
              <p class="backup-list-empty-text">暂无备份记录。</p>
              <p class="backup-list-empty-hint">创建手动备份后将显示在此列表中。</p>
            </div>
            <div v-for="backup in readingBackups" :key="backup.id" class="backup-entry" :data-backup-id="backup.id">
              <div class="backup-entry-info">
                <strong class="backup-entry-id">{{ backup.id }}</strong>
                <div class="backup-entry-meta">{{ formatBackupDate(backup) }}</div>
                <div class="backup-entry-meta">记录: {{ backup.count }} 条 | {{ backup.schemaVersion }}</div>
              </div>
              <div class="backup-entry-actions">
                <button class="btn btn-secondary" type="button" @click="downloadReadingBackup(backup)">下载</button>
                <button class="btn btn-success backup-entry-restore" type="button" :disabled="historyBusy" @click="restoreReadingBackup(backup)">恢复</button>
                <button class="btn btn-warning hero-btn--warn" type="button" :disabled="historyBusy" @click="deleteReadingBackup(backup.id)">删除</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="libraryConfigOpen" class="backup-list-container reading-library-config-list" data-reading-library-config-list>
        <div class="backup-list-card">
          <div class="backup-list-header">
            <h3 class="backup-list-title">
              <span class="backup-list-title-icon" aria-hidden="true">🗂️</span>
              <span class="backup-list-title-text">题库配置</span>
            </h3>
            <button class="btn btn-secondary backup-list-dismiss" type="button" @click="libraryConfigOpen = false">收起</button>
          </div>
          <div class="backup-list-scroll reading-library-config-scroll">
            <div class="backup-entry reading-library-config-entry" data-library-config-key="practice-reading-api">
              <div class="backup-entry-info">
                <strong class="backup-entry-id">默认阅读题库</strong>
                <div class="backup-entry-meta">来源: Practice API / reading assets</div>
                <div class="backup-entry-meta">题目: {{ readingAssets.length }} 条 | HTML: {{ htmlAssetCount }} | PDF: {{ pdfAssetCount }}</div>
                <div class="backup-entry-meta">最后更新: {{ latestAssetSyncLabel }}</div>
              </div>
              <div class="backup-entry-actions">
                <button class="btn btn-secondary" type="button" :disabled="loading" @click="loadReadingData">刷新</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div id="theme-switcher-modal" class="theme-modal" :class="{ show: themeSwitcherOpen }">
      <div class="theme-modal-content">
        <div class="theme-modal-header">
          <h3 class="heading-serif">🎨 主题切换</h3>
          <button
            class="theme-modal-close"
            type="button"
            data-index-action="hide-theme-switcher"
            aria-label="关闭"
            @click="themeSwitcherOpen = false"
          >
            ×
          </button>
        </div>
        <div class="theme-modal-body">
          <div class="theme-options-viewport" role="presentation">
            <div class="theme-options theme-options-glass">
              <div
                v-for="theme in backgroundThemes"
                :key="theme.value"
                class="theme-card"
              >
                <div :class="['theme-card-bg', theme.previewClass]"></div>
                <div class="theme-card-glass-layer">
                  <div class="theme-card-header">
                    <h4 class="theme-card-title">{{ theme.title }}</h4>
                    <div class="theme-card-subtitle">
                      <span>{{ theme.subtitle }}</span>
                    </div>
                  </div>
                  <div class="theme-card-footer">
                    <span class="theme-card-tag">{{ theme.tag }}</span>
                    <button
                      class="theme-card-btn"
                      type="button"
                      data-index-action="switch-bg-theme"
                      :data-action-value="theme.value"
                      @click="applyBackgroundTheme(theme.value)"
                    >
                      应用
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <p v-if="localMessage" class="practice-local-message" role="status">{{ localMessage }}</p>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { practiceAssets, practiceHistory, practiceReadingSuite } from '@/api/practice-client.js'

const router = useRouter()
const route = useRoute()
const ENDLESS_STATE_KEY = 'practice_reading_endless_state_v1'
const READING_BACKUP_STORAGE_KEY = 'practice_reading_archive_backups_v1'
const MAX_READING_BACKUPS = 10
const SUITE_FLOW_MODE_STORAGE_KEY = 'suite_flow_mode'
const SUITE_FREQUENCY_SCOPE_STORAGE_KEY = 'suite_frequency_scope'
const SUITE_AUTO_ADVANCE_STORAGE_KEY = 'suite_auto_advance_after_submit'
const legacyMoreToolScripts = [
  'js/utils/vocabDataIO.js',
  'js/core/vocabScheduler.js',
  'js/core/vocabStore.js',
  'js/app/vocabListSwitcher.js',
  'js/components/vocabDashboardCards.js',
  'js/components/vocabSessionView.js',
  'js/services/achievementManager.js',
  'js/presentation/moreView.js'
]

let legacyMoreToolsPromise = null
let legacyOnboardingPromise = null
let legacyUpdateManagerPromise = null
const legacyStylePromises = new Map()
const legacyScriptPromises = new Map()

const icons = {
  overview: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>',
  book: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>',
  edit: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>',
  more: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>',
  settings: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>',
  suite: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><path d="M14 3v6h6"></path><path d="M8 13h8M8 17h6"></path></svg>',
  endless: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8c2.2 0 4 1.8 4 4s-1.8 4-4 4c-1.9 0-3.1-1.1-4.4-2.7L11.4 12C10.1 10.4 8.9 9 7 9c-1.7 0-3 1.3-3 3s1.3 3 3 3c1.4 0 2.4-.8 3.6-2.2"></path><path d="M13.4 10.7C14.7 9.1 15.9 8 17 8"></path></svg>',
  editLarge: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>',
  clockLarge: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>',
  vocabLarge: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>',
  achievementLarge: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 21h8"></path><path d="M12 17v4"></path><path d="M7 4h10"></path><path d="M17 4v8c0 2.8-2.2 5-5 5s-5-2.2-5-5V4"></path><path d="M15 4V2H9v2"></path><path d="M5 4H2v4c0 1.1.9 2 2 2h1"></path><path d="M19 4h3v4c0 1.1-.9 2-2 2h-1"></path></svg>',
  achievementSmall: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 21h8"></path><path d="M12 17v4"></path><path d="M7 4h10"></path><path d="M17 4v8c0 2.8-2.2 5-5 5s-5-2.2-5-5V4"></path><path d="M15 4V2H9v2"></path><path d="M5 4H2v4c0 1.1.9 2 2 2h1"></path><path d="M19 4h3v4c0 1.1-.9 2-2 2h-1"></path></svg>'
}

const legacyViews = [
  { value: 'overview', label: '总览', icon: icons.overview },
  { value: 'browse', label: '题库浏览', icon: icons.book },
  { value: 'practice', label: '练习记录', icon: icons.edit },
  { value: 'more', label: '更多', icon: icons.more },
  { value: 'settings', label: '设置', icon: icons.settings }
]

const typeFilters = [
  { value: 'all', label: '全部' },
  { value: 'reading', label: '阅读' }
]

const frequencyFilters = [
  { value: 'high', label: '高频' },
  { value: 'medium', label: '中频' },
  { value: 'low', label: '低频' }
]

const practiceTrendRanges = [
  { value: 'recent10', label: '最近十次', limit: 10 },
  { value: 'last7d', label: '最近七天', days: 7 },
  { value: 'last30d', label: '最近一月', days: 30 },
  { value: 'recent20', label: '最近20次', limit: 20 }
]

const backgroundThemes = [
  {
    value: 'misty-mountain',
    title: '晨雾群山',
    subtitle: '⛰️ Misty Mountain',
    tag: '动态',
    previewClass: 'theme-bg-misty'
  },
  {
    value: 'teal-ocean',
    title: '深海孤航',
    subtitle: '⛵ Teal Ocean',
    tag: '动态',
    previewClass: 'theme-bg-ocean'
  },
  {
    value: 'floral-bloom',
    title: '落日雾花',
    subtitle: '🌸 Floral Bloom',
    tag: '静态',
    previewClass: 'theme-bg-floral'
  }
]

const practiceWidgetOptions = [
  {
    value: 'heatmap',
    label: '练习热力图',
    eyebrow: 'Heatmap',
    title: '练习热力图',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"></rect><path d="M8 2v4"></path><path d="M16 2v4"></path><path d="M3 10h18"></path><path d="M8 14h.01"></path><path d="M12 14h.01"></path><path d="M16 14h.01"></path><path d="M8 17h.01"></path></svg>'
  },
  {
    value: 'priority',
    label: '中高频余量',
    eyebrow: 'Focus',
    title: '中高频余量',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10"></path><path d="M10 20V4"></path><path d="M16 20v-7"></path><path d="M22 20H2"></path></svg>'
  },
  {
    value: 'radar',
    label: '阅读错题雷达',
    eyebrow: 'Radar',
    title: '阅读错题雷达',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 3 8l9 5 9-5-9-5Z"></path><path d="m3 8 9 13 9-13"></path><path d="M12 13v8"></path></svg>'
  }
]

const suiteFlowOptions = [
  { value: 'simulation', label: '模拟模式', description: '贴近官方机考' },
  { value: 'classic', label: '经典模式', description: '自动跳转' },
  { value: 'stationary', label: '驻足模式', description: '提交后停留回看' }
]

const suiteFrequencyOptions = [
  { value: 'high_medium', label: '高频 + 次高频' },
  { value: 'high', label: '仅高频' },
  { value: 'all', label: '全部频率（默认）' }
]

const activeView = ref('overview')
const selectedCategory = ref('all')
const selectedType = ref('all')
const frequencyFilter = ref('all')
const keyword = ref('')
const historyKeyword = ref('')
const sortMode = ref('default')
const browsePreferencePanelOpen = ref(false)
const browseRememberPosition = ref(readBrowseRememberPosition())
const practiceSummaryExpanded = ref(true)
const practiceTrendRange = ref('recent10')
const activePracticeWidget = ref('heatmap')
const practiceWidgetSelectorOpen = ref(false)
const themeSwitcherOpen = ref(false)
const backupListOpen = ref(false)
const libraryConfigOpen = ref(false)
const suiteModeSelectorOpen = ref(false)
const selectedSuiteFlowMode = ref(resolveSuitePreference().flowMode)
const selectedSuiteFrequencyScope = ref(resolveSuitePreference().frequencyScope)
const heatmapMonth = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
const readingAssets = ref([])
const readingHistory = ref([])
const readingBackups = ref(readReadingBackups())
const readingArchiveImportInput = ref(null)
const loading = ref(false)
const loadingHistory = ref(false)
const historyBusy = ref(false)
const creatingSuite = ref(false)
const error = ref('')
const historyError = ref('')
const suiteError = ref('')
const localMessage = ref('')
const bulkDeleteMode = ref(false)
const selectedHistoryIds = ref(new Set())
const latestAssetSyncAt = ref(null)

const readingCategoryEntries = computed(() => ['P1', 'P2', 'P3'].map((category) => ({
  category,
  type: 'reading',
  total: countByCategory(category)
})))

const browseTitle = computed(() => {
  if (selectedCategory.value === 'all' && selectedType.value === 'all') return '题库浏览'
  if (selectedCategory.value === 'all') return '阅读题库'
  return `${selectedCategory.value} 阅读`
})

const filteredReadingAssets = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  const filtered = readingAssets.value.filter((asset) => {
    if (selectedType.value !== 'all' && asset.activity !== selectedType.value) return false
    if (selectedCategory.value !== 'all' && normalizeCategory(asset.category) !== selectedCategory.value) return false
    if (frequencyFilter.value !== 'all' && normalizeFrequency(asset) !== frequencyFilter.value) return false
    if (!query) return true
    return [
      asset.id,
      asset.title,
      asset.source,
      asset.category,
      asset.difficulty,
      asset.payloadRef,
      asset.metadata?.dataKey,
      asset.metadata?.pdfFilename,
      asset.metadata?.legacyFilename
    ].filter(Boolean).join(' ').toLowerCase().includes(query)
  })

  return filtered.slice().sort((left, right) => {
    if (sortMode.value === 'frequency-desc') {
      return frequencyRank(right) - frequencyRank(left)
        || String(left.category || '').localeCompare(String(right.category || ''), 'zh-Hans-CN')
        || String(left.title || '').localeCompare(String(right.title || ''), 'zh-Hans-CN')
    }
    if (sortMode.value === 'difficulty-desc') {
      return difficultyRank(right) - difficultyRank(left)
        || frequencyRank(right) - frequencyRank(left)
        || String(left.category || '').localeCompare(String(right.category || ''), 'zh-Hans-CN')
        || String(left.title || '').localeCompare(String(right.title || ''), 'zh-Hans-CN')
    }
    return String(left.category || '').localeCompare(String(right.category || ''), 'zh-Hans-CN')
      || String(left.title || '').localeCompare(String(right.title || ''), 'zh-Hans-CN')
  })
})

const sortedHistory = computed(() => readingHistory.value.slice().sort((left, right) => (
  safeDateMs(right.submittedAt || right.endTime || right.startTime) - safeDateMs(left.submittedAt || left.endTime || left.startTime)
)))

const filteredHistory = computed(() => {
  const query = historyKeyword.value.trim().toLowerCase()
  if (!query) return sortedHistory.value
  return sortedHistory.value.filter((record) => [
    record.id,
    record.title,
    record.assetId,
    record.examId,
    record.metadata?.category,
    record.submittedAt,
    record.endTime
  ].filter(Boolean).join(' ').toLowerCase().includes(query))
})

const historyStats = computed(() => {
  const totalPracticed = readingHistory.value.length
  const totalAccuracy = readingHistory.value.reduce((sum, record) => sum + Number(record.accuracy || 0), 0)
  const totalDuration = readingHistory.value.reduce((sum, record) => sum + Number(record.duration || 0), 0)
  return {
    totalPracticed,
    averageAccuracy: totalPracticed ? Math.round((totalAccuracy / totalPracticed) * 100) : 0,
    studyMinutes: Math.round(totalDuration / 60),
    streakDays: calculateStreakDays(readingHistory.value)
  }
})

const practiceTrendRecords = computed(() => {
  const config = practiceTrendRanges.find((range) => range.value === practiceTrendRange.value) || practiceTrendRanges[0]
  if (config.days) {
    const cutoff = Date.now() - config.days * 24 * 60 * 60 * 1000
    return sortedHistory.value.filter((record) => {
      return safeDateMs(record.submittedAt || record.endTime || record.startTime) >= cutoff
    })
  }
  return sortedHistory.value.slice(0, config.limit || 10)
})

const practiceTrendSummary = computed(() => {
  const records = practiceTrendRecords.value
  const totalAccuracy = records.reduce((sum, record) => sum + historyPercentage(record), 0)
  const range = practiceTrendRanges.find((item) => item.value === practiceTrendRange.value) || practiceTrendRanges[0]
  return {
    count: records.length,
    averageAccuracy: records.length ? Math.round(totalAccuracy / records.length) : 0,
    rangeLabel: range.label
  }
})

const practiceTrendBars = computed(() => practiceTrendRecords.value
  .slice()
  .reverse()
  .map((record, index) => {
    const accuracy = historyPercentage(record)
    return {
      id: String(record.id || record.sessionId || index),
      label: record.title || `记录 ${index + 1}`,
      accuracy,
      height: Math.max(8, Math.min(100, accuracy))
    }
  }))

const priorityInsight = computed(() => {
  const buckets = {
    high: buildPriorityBucket('high'),
    medium: buildPriorityBucket('medium')
  }
  return buckets
})

const activePracticeWidgetMeta = computed(() => (
  practiceWidgetOptions.find((widget) => widget.value === activePracticeWidget.value)
  || practiceWidgetOptions[0]
))

const heatmapMonthLabel = computed(() => {
  const cursor = heatmapMonth.value
  const now = new Date()
  if (cursor.getFullYear() === now.getFullYear() && cursor.getMonth() === now.getMonth()) {
    return '本月'
  }
  return `${cursor.getFullYear()}年${cursor.getMonth() + 1}月`
})

const practiceHeatmapDays = computed(() => {
  const cursor = heatmapMonth.value
  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const dailySets = new Map()
  const allActiveDays = new Map()
  readingHistory.value.forEach((record, index) => {
    const date = getRecordDate(record)
    const key = formatDateKey(date)
    const setId = getPracticeSetId(record, key, index)
    if (!key || !setId) return
    if (!allActiveDays.has(key)) allActiveDays.set(key, new Set())
    allActiveDays.get(key).add(setId)
    if (date.getFullYear() !== year || date.getMonth() !== month) return
    if (!dailySets.has(key)) dailySets.set(key, new Set())
    dailySets.get(key).add(setId)
  })
  const averageSetsPerActiveDay = allActiveDays.size
    ? Array.from(allActiveDays.values()).reduce((sum, set) => sum + set.size, 0) / allActiveDays.size
    : 1
  return Array.from({ length: daysInMonth }, (_, index) => {
    const date = new Date(year, month, index + 1)
    const key = formatDateKey(date)
    const count = dailySets.get(key)?.size || 0
    return {
      key,
      label: `${month + 1}月${index + 1}日，做题 ${count} 套`,
      count,
      level: resolveHeatmapLevel(count, averageSetsPerActiveDay)
    }
  })
})

const practiceHeatmapSummary = computed(() => {
  const total = practiceHeatmapDays.value.reduce((sum, day) => sum + day.count, 0)
  if (!total) return `${heatmapMonthLabel.value}暂无练习记录`
  return `${heatmapMonthLabel.value}共做题 ${total} 套`
})

const readingRadarInsight = computed(() => {
  const counts = new Map()
  const records = sortedHistory.value.slice(0, 10)
  records.forEach((record) => {
    const performance = record?.metadata?.questionTypePerformance
      || record?.metadata?.analysisArtifacts?.questionTypePerformance
      || record?.metadata?.singleAttemptAnalysisInput?.questionTypePerformance
    if (!performance || typeof performance !== 'object') return
    Object.values(performance).forEach((entry) => {
      if (!entry || typeof entry !== 'object') return
      const total = Number(entry.total)
      const correct = Number(entry.correct ?? entry.correctAnswers)
      if (!Number.isFinite(total) || !Number.isFinite(correct)) return
      const wrong = Math.max(0, total - correct)
      if (!wrong) return
      const kind = normalizeQuestionKind(entry.kind || entry.type || 'unknown')
      counts.set(kind, (counts.get(kind) || 0) + wrong)
    })
  })
  const totalErrors = Array.from(counts.values()).reduce((sum, count) => sum + count, 0)
  const dataPoints = Array.from(counts.entries())
    .map(([type, count]) => ({
      type,
      label: formatQuestionKindLabel(type),
      count,
      percent: totalErrors ? Math.round((count / totalErrors) * 100) : 0
    }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 5)
  return {
    recordCount: records.length,
    totalErrors,
    dataPoints,
    summary: totalErrors
      ? `最近${records.length}次阅读共 ${totalErrors} 道错题`
      : '最近10次阅读暂无可分类错题'
  }
})

const bulkDeleteButtonLabel = computed(() => {
  const selectedCount = selectedHistoryIds.value.size
  if (bulkDeleteMode.value) {
    return selectedCount > 0 ? `完成选择 (${selectedCount})` : '完成选择'
  }
  return selectedCount > 0 ? `批量删除 (${selectedCount})` : '批量删除'
})

const htmlAssetCount = computed(() => readingAssets.value.filter(hasReadingPracticePayload).length)
const pdfAssetCount = computed(() => readingAssets.value.filter((asset) => getPdfPath(asset)).length)
const libraryStatusLabel = computed(() => readingAssets.value.length ? '已加载完整索引' : '等待加载')
const latestAssetSyncLabel = computed(() => latestAssetSyncAt.value ? latestAssetSyncAt.value.toLocaleString() : '未同步')

onMounted(() => {
  syncViewFromRoute()
  loadReadingData()
  updateLiquidIndicator()
  updateSegmentedIndicators()
})

watch(() => route.query.view, () => {
  syncViewFromRoute()
})

watch(activeView, (value) => {
  updateRouteView(value)
  nextTick(() => {
    updateLiquidIndicator()
    updateSegmentedIndicators()
  })
})

watch(selectedType, () => {
  nextTick(updateSegmentedIndicators)
})

async function loadReadingData() {
  await Promise.all([
    loadAssets(),
    loadHistory()
  ])
}

async function loadAssets() {
  loading.value = true
  error.value = ''
  try {
    const result = await practiceAssets.listAll({ activity: 'reading' })
    readingAssets.value = Array.isArray(result?.data) ? result.data : []
    latestAssetSyncAt.value = new Date()
  } catch (loadError) {
    console.error('加载阅读题库失败:', loadError)
    readingAssets.value = []
    error.value = loadError?.message
      ? `阅读题库加载失败：${loadError.message}`
      : '阅读题库加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

async function loadHistory() {
  loadingHistory.value = true
  historyError.value = ''
  try {
    const result = await practiceHistory.listAll({ activity: 'reading' })
    readingHistory.value = Array.isArray(result?.data) ? result.data : []
  } catch (loadError) {
    console.error('加载阅读练习记录失败:', loadError)
    readingHistory.value = []
    historyError.value = loadError?.message || '阅读练习记录加载失败'
  } finally {
    loadingHistory.value = false
  }
}

function syncViewFromRoute() {
  const rawView = Array.isArray(route.query.view) ? route.query.view[0] : route.query.view
  const view = rawView === 'records' ? 'practice' : rawView
  if (view === 'vocab') {
    activeView.value = 'vocab'
    return
  }
  if (legacyViews.some((item) => item.value === view)) {
    activeView.value = view
  }
}

function updateRouteView(view) {
  const current = Array.isArray(route.query.view) ? route.query.view[0] : route.query.view
  const nextView = view === 'overview' ? undefined : view
  if ((current || undefined) === nextView) return
  router.replace({
    query: {
      ...route.query,
      view: nextView
    }
  }).catch(() => {})
}

function showView(view) {
  if (!legacyViews.some((item) => item.value === view)) return
  activeView.value = view
}

function normalizeCategory(category) {
  const value = String(category || '').trim().toUpperCase()
  if (value.includes('P1')) return 'P1'
  if (value.includes('P2')) return 'P2'
  if (value.includes('P3')) return 'P3'
  return value || 'P1'
}

function normalizeFrequency(source) {
  const value = [
    source?.metadata?.frequency,
    source?.frequency,
    source?.difficulty,
    source?.title,
    source?.id,
    source?.assetId,
    source?.examId,
    source?.metadata?.dataKey,
    source?.metadata?.legacyFilename,
    source?.metadata?.pdfFilename
  ].filter(Boolean).join(' ').toLowerCase()
  if (value.includes('medium') || value.includes('次高频') || value.includes('中频') || value.includes('-medium')) return 'medium'
  if (value.includes('high') || value.includes('超高频') || value.includes('高频') || value.includes('-high')) return 'high'
  if (value.includes('low') || value.includes('低频') || value.includes('-low')) return 'low'
  return 'unknown'
}

function getRecordAssetKey(record) {
  return String(record?.assetId || record?.examId || record?.metadata?.assetId || record?.metadata?.examId || '').trim()
}

function getRecordAsset(record) {
  const assetKey = getRecordAssetKey(record)
  if (!assetKey) return null
  return readingAssets.value.find((asset) => String(asset?.id || '').trim() === assetKey) || null
}

function getRecordFrequency(record) {
  const direct = normalizeFrequency(record)
  if (direct !== 'unknown') return direct
  return normalizeFrequency(getRecordAsset(record))
}

function readBrowseRememberPosition() {
  try {
    const raw = localStorage.getItem('browse_view_preferences_v2')
    const parsed = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, 'autoScrollEnabled')) {
      return Boolean(parsed.autoScrollEnabled)
    }
  } catch (_) {}
  return true
}

function persistBrowsePreference() {
  try {
    const raw = localStorage.getItem('browse_view_preferences_v2')
    const parsed = raw ? JSON.parse(raw) : {}
    localStorage.setItem('browse_view_preferences_v2', JSON.stringify({
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
      autoScrollEnabled: Boolean(browseRememberPosition.value)
    }))
  } catch (_) {}
  browsePreferencePanelOpen.value = false
  showLocalMessage(browseRememberPosition.value
    ? '已开启列表位置记录，将自动恢复到上次答题的位置'
    : '已关闭列表位置记录')
}

function toggleBrowsePreference(event) {
  event?.preventDefault?.()
  browsePreferencePanelOpen.value = !browsePreferencePanelOpen.value
}

function buildPriorityBucket(frequency) {
  const assets = readingAssets.value.filter((asset) => normalizeFrequency(asset) === frequency)
  const records = readingHistory.value.filter((record) => getRecordFrequency(record) === frequency)
  const practicedAssetIds = new Set(records.map(getRecordAssetKey).filter(Boolean))
  const practiced = assets.length
    ? assets.filter((asset) => practicedAssetIds.has(String(asset?.id || '').trim())).length
    : practicedAssetIds.size || records.length
  const total = assets.length || practiced
  const totalAccuracy = records.reduce((sum, record) => sum + historyPercentage(record), 0)
  return {
    total,
    practiced,
    percent: total ? Math.round((practiced / total) * 100) : 0,
    accuracy: records.length ? Math.round(totalAccuracy / records.length) : 0
  }
}

function safeDateMs(value) {
  const timestamp = Date.parse(value || '')
  return Number.isFinite(timestamp) ? timestamp : 0
}

function countByCategory(category) {
  return readingAssets.value.filter((asset) => normalizeCategory(asset.category) === category).length
}

function filterByType(type) {
  selectedType.value = type === 'reading' ? 'reading' : 'all'
  if (selectedType.value === 'all') {
    selectedCategory.value = 'all'
  }
}

function browseCategory(category, type = 'reading') {
  selectedCategory.value = category === 'all' ? 'all' : normalizeCategory(category)
  selectedType.value = type === 'reading' ? 'reading' : 'all'
  activeView.value = 'browse'
}

function toggleFrequencyFilter(value) {
  const normalized = frequencyFilters.some((filter) => filter.value === value) ? value : 'all'
  frequencyFilter.value = frequencyFilter.value === normalized ? 'all' : normalized
}

function togglePracticeSummary() {
  practiceSummaryExpanded.value = !practiceSummaryExpanded.value
}

function selectPracticeTrendRange(value) {
  if (!practiceTrendRanges.some((range) => range.value === value)) return
  practiceTrendRange.value = value
}

function selectPracticeWidget(value) {
  if (!practiceWidgetOptions.some((widget) => widget.value === value)) return
  activePracticeWidget.value = value
  practiceWidgetSelectorOpen.value = false
}

function shiftHeatmapMonth(delta) {
  const cursor = heatmapMonth.value
  heatmapMonth.value = new Date(cursor.getFullYear(), cursor.getMonth() + Number(delta || 0), 1)
}

function clearSearch() {
  keyword.value = ''
}

function startReading(asset) {
  if (!asset?.id) return
  if (!hasReadingPracticePayload(asset) && getPdfPath(asset)) {
    viewPdf(asset)
    return
  }
  router.push({
    name: 'PracticeReading',
    params: { assetId: asset.id }
  })
}

function startRandomPractice(category = 'all') {
  const normalizedCategory = category === 'all' ? 'all' : normalizeCategory(category)
  const pool = readingAssets.value.filter((asset) => (
    asset?.id
    && asset.activity === 'reading'
    && hasReadingPracticePayload(asset)
    && (normalizedCategory === 'all' || normalizeCategory(asset.category) === normalizedCategory)
  ))
  const selected = pool[Math.floor(Math.random() * pool.length)]
  if (!selected) {
    browseCategory(normalizedCategory, 'reading')
    return
  }
  startReading(selected)
}

function startEndlessMode() {
  const pool = readingAssets.value.filter((asset) => (
    asset?.id
    && asset.activity === 'reading'
    && hasReadingPracticePayload(asset)
  ))
  const selected = pool[Math.floor(Math.random() * pool.length)]
  if (!selected) {
    showLocalMessage('无尽模式：题库为空，请先加载题库')
    return
  }
  try {
    window.sessionStorage?.setItem(ENDLESS_STATE_KEY, JSON.stringify({
      active: true,
      startedAt: new Date().toISOString(),
      currentAssetId: selected.id,
      pool: pool.map((asset) => ({
        id: asset.id,
        title: asset.title,
        category: asset.category
      }))
    }))
  } catch (_) {
    // best-effort endless state; route query still keeps the mode active.
  }
  showLocalMessage(`无尽模式已启动，正在打开：${selected.title}`)
  router.push({
    name: 'PracticeReading',
    params: { assetId: selected.id },
    query: { mode: 'endless' }
  })
}

function resolveLegacyAssetUrl(relativePath) {
  const normalized = String(relativePath || '').replace(/^\/+/, '')
  try {
    const currentUrl = new URL(window.location.href)
    if (currentUrl.pathname.includes('/dist/writing/')) {
      return new URL(`../../${normalized}`, currentUrl.href).href
    }
  } catch (_) {}
  return `/${normalized}`
}

function loadLegacyStyle(relativePath) {
  if (legacyStylePromises.has(relativePath)) return legacyStylePromises.get(relativePath)
  const href = resolveLegacyAssetUrl(relativePath)
  const existing = document.querySelector(`link[data-legacy-style="${relativePath}"]`)
  if (existing) {
    const promise = Promise.resolve()
    legacyStylePromises.set(relativePath, promise)
    return promise
  }
  const promise = new Promise((resolve, reject) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.dataset.legacyStyle = relativePath
    link.onload = () => resolve()
    link.onerror = () => {
      legacyStylePromises.delete(relativePath)
      reject(new Error(`加载 legacy 样式失败：${relativePath}`))
    }
    document.head.appendChild(link)
  })
  legacyStylePromises.set(relativePath, promise)
  return promise
}

function loadLegacyScript(relativePath) {
  if (legacyScriptPromises.has(relativePath)) return legacyScriptPromises.get(relativePath)
  const existing = document.querySelector(`script[data-legacy-script="${relativePath}"]`)
  if (existing) {
    const promise = Promise.resolve()
    legacyScriptPromises.set(relativePath, promise)
    return promise
  }
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = resolveLegacyAssetUrl(relativePath)
    script.async = false
    script.dataset.legacyScript = relativePath
    script.onload = () => resolve()
    script.onerror = () => {
      legacyScriptPromises.delete(relativePath)
      reject(new Error(`加载 legacy 脚本失败：${relativePath}`))
    }
    document.head.appendChild(script)
  })
  legacyScriptPromises.set(relativePath, promise)
  return promise
}

function ensureLegacyMoreTools() {
  if (window.VocabSessionView && window.showAchievements && window.openClockOverlay) {
    return Promise.resolve()
  }
  if (!legacyMoreToolsPromise) {
    legacyMoreToolsPromise = loadLegacyStyle('css/main.css')
      .then(() => legacyMoreToolScripts.reduce(
        (chain, scriptPath) => chain.then(() => loadLegacyScript(scriptPath)),
        Promise.resolve()
      ))
      .catch((error) => {
        legacyMoreToolsPromise = null
        throw error
      })
  }
  return legacyMoreToolsPromise
}

function ensureLegacyOnboarding() {
  if (window.OnboardingTour && typeof window.OnboardingTour.start === 'function') {
    return Promise.resolve()
  }
  if (!legacyOnboardingPromise) {
    legacyOnboardingPromise = loadLegacyStyle('css/onboarding.css')
      .then(() => loadLegacyScript('js/components/onboardingTour.js'))
      .then(() => {
        window.OnboardingTour?.init?.()
      })
      .catch((error) => {
        legacyOnboardingPromise = null
        throw error
      })
  }
  return legacyOnboardingPromise
}

async function startOnboardingTour(event) {
  event?.preventDefault?.()
  event?.stopImmediatePropagation?.()
  try {
    await ensureLegacyOnboarding()
    if (!window.OnboardingTour || typeof window.OnboardingTour.start !== 'function') {
      throw new Error('OnboardingTour 未加载')
    }
    window.OnboardingTour.start(true)
  } catch (error) {
    console.error('打开引导流程失败:', error)
    showLocalMessage(error?.message ? `引导打开失败：${error.message}` : '引导打开失败，请稍后重试。')
  }
}

function ensureUpdateManagerInstance() {
  if (window.appUpdateManager && typeof window.appUpdateManager.handleAction === 'function') {
    return Promise.resolve(window.appUpdateManager)
  }
  if (typeof window.AppUpdateManager !== 'function') {
    return Promise.reject(new Error('AppUpdateManager 未加载'))
  }
  const manager = new window.AppUpdateManager()
  window.appUpdateManager = manager
  return manager.init().then(() => manager)
}

function ensureLegacyUpdateManager() {
  if (window.appUpdateManager && typeof window.appUpdateManager.handleAction === 'function') {
    return Promise.resolve(window.appUpdateManager)
  }
  if (!legacyUpdateManagerPromise) {
    legacyUpdateManagerPromise = loadLegacyStyle('css/main.css')
      .then(() => loadLegacyScript('js/integration/updateManager.js'))
      .then(() => ensureUpdateManagerInstance())
      .catch((error) => {
        legacyUpdateManagerPromise = null
        throw error
      })
  }
  return legacyUpdateManagerPromise
}

async function openUpdateManager(event) {
  event?.preventDefault?.()
  event?.stopImmediatePropagation?.()
  try {
    const manager = await ensureLegacyUpdateManager()
    if (typeof manager.handleAction === 'function') {
      await manager.handleAction('open-modal')
      return
    }
    manager.showModal?.()
    await manager.ensureAutoCheck?.()
  } catch (error) {
    console.error('打开更新管理失败:', error)
    showLocalMessage(error?.message ? `更新检查打开失败：${error.message}` : '更新检查打开失败，请稍后重试。')
  }
}

async function openClockTool(event) {
  event?.preventDefault?.()
  event?.stopImmediatePropagation?.()
  try {
    await ensureLegacyMoreTools()
    window.ensureMoreView?.()
    if (typeof window.openClockOverlay !== 'function') {
      throw new Error('MoreView 时钟模块未加载')
    }
    window.openClockOverlay()
  } catch (error) {
    console.error('打开全屏时钟失败:', error)
    showLocalMessage(error?.message ? `全屏时钟打开失败：${error.message}` : '全屏时钟打开失败，请稍后重试。')
  }
}

async function openVocabTool(event) {
  event?.preventDefault?.()
  event?.stopImmediatePropagation?.()
  activeView.value = 'vocab'
  await nextTick()
  try {
    await ensureLegacyMoreTools()
    window.ensureMoreView?.()
    if (!window.VocabSessionView || typeof window.VocabSessionView.mount !== 'function') {
      throw new Error('VocabSessionView 未加载')
    }
    await window.VocabSessionView.mount('#vocab-view')
  } catch (error) {
    console.error('打开单词背诵失败:', error)
    showLocalMessage(error?.message ? `单词背诵打开失败：${error.message}` : '单词背诵打开失败，请稍后重试。')
  }
}

async function showAchievementsTool() {
  try {
    await ensureLegacyMoreTools()
    if (typeof window.showAchievements !== 'function') {
      throw new Error('AchievementManager 未加载')
    }
    await window.showAchievements()
  } catch (error) {
    console.error('打开成就面板失败:', error)
    showLocalMessage(error?.message ? `成就面板打开失败：${error.message}` : '成就面板打开失败，请稍后重试。')
  }
}

function openReadingMemorize() {
  const asset = filteredReadingAssets.value.find((entry) => entry?.id)
    || readingAssets.value.find((entry) => entry?.id)
  if (!asset) {
    showLocalMessage('阅读背题：题库为空，请先加载题库。')
    return
  }
  router.push({
    name: 'PracticeReading',
    params: { assetId: asset.id },
    query: { mode: 'review' }
  })
}

function hideAchievementsTool() {
  if (typeof window.hideAchievements === 'function') {
    window.hideAchievements()
    return
  }
  document.getElementById('achievements-modal')?.classList.remove('show')
}

function openWritingEntry(event) {
  event?.preventDefault?.()
  event?.stopImmediatePropagation?.()
  router.push({ name: 'Compose' })
}

function normalizeSuiteFlowMode(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return suiteFlowOptions.some((option) => option.value === normalized) ? normalized : ''
}

function normalizeSuiteFrequencyScope(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'high' || normalized === 'only_high' || normalized === '仅高频' || normalized === '高频') return 'high'
  if (
    normalized === 'high_medium'
    || normalized === 'high-medium'
    || normalized === 'highmedium'
    || normalized === 'high+medium'
    || normalized === '高频+次高频'
    || normalized === '高频次高频'
  ) return 'high_medium'
  if (normalized === 'all' || normalized === 'default' || normalized === '全部' || normalized === '全部频率') return 'all'
  return suiteFrequencyOptions.some((option) => option.value === normalized) ? normalized : ''
}

function readLocalStorageValue(key) {
  try {
    return window.localStorage?.getItem(key) || ''
  } catch (_) {
    return ''
  }
}

function writeLocalStorageValue(key, value) {
  try {
    window.localStorage?.setItem(key, String(value))
  } catch (_) {
    // storage is best-effort in packaged and browser-test contexts.
  }
}

function resolveSuitePreference(overrides = {}) {
  const flowMode = normalizeSuiteFlowMode(overrides.flowMode)
    || normalizeSuiteFlowMode(readLocalStorageValue(SUITE_FLOW_MODE_STORAGE_KEY))
    || 'classic'
  const frequencyScope = normalizeSuiteFrequencyScope(overrides.frequencyScope)
    || normalizeSuiteFrequencyScope(readLocalStorageValue(SUITE_FREQUENCY_SCOPE_STORAGE_KEY))
    || 'all'
  const autoAdvanceAfterSubmit = flowMode !== 'stationary'
  return {
    flowMode,
    frequencyScope,
    autoAdvanceAfterSubmit
  }
}

function persistSuitePreference(partial = {}) {
  const next = resolveSuitePreference(partial)
  writeLocalStorageValue(SUITE_FLOW_MODE_STORAGE_KEY, next.flowMode)
  writeLocalStorageValue(SUITE_FREQUENCY_SCOPE_STORAGE_KEY, next.frequencyScope)
  writeLocalStorageValue(SUITE_AUTO_ADVANCE_STORAGE_KEY, next.autoAdvanceAfterSubmit ? 'true' : 'false')
  return next
}

function openSuiteModeSelector(event) {
  event?.preventDefault?.()
  event?.stopImmediatePropagation?.()
  const preference = resolveSuitePreference()
  selectedSuiteFlowMode.value = preference.flowMode
  selectedSuiteFrequencyScope.value = preference.frequencyScope
  suiteModeSelectorOpen.value = true
}

function closeSuiteModeSelector() {
  if (creatingSuite.value) return
  suiteModeSelectorOpen.value = false
}

function selectSuiteFlowMode(mode, options = {}) {
  const normalized = normalizeSuiteFlowMode(mode)
  if (!normalized) return
  selectedSuiteFlowMode.value = normalized
  if (options.start) {
    void startReadingSuite()
  }
}

async function startReadingSuite(event) {
  event?.preventDefault?.()
  event?.stopImmediatePropagation?.()
  creatingSuite.value = true
  suiteError.value = ''
  try {
    const preference = persistSuitePreference({
      flowMode: selectedSuiteFlowMode.value,
      frequencyScope: selectedSuiteFrequencyScope.value
    })
    const suite = await practiceReadingSuite.create({
      flowMode: preference.flowMode,
      frequencyScope: preference.frequencyScope
    })
    const sessionId = String(suite?.sessionId || '').trim()
    if (!sessionId) {
      throw new Error('套题 session 创建失败')
    }
    suiteModeSelectorOpen.value = false
    router.push({
      name: 'PracticeReadingSuite',
      params: { sessionId }
    })
  } catch (createError) {
    console.error('创建阅读套题失败:', createError)
    suiteError.value = createError?.message
      ? `阅读套题创建失败：${createError.message}`
      : '阅读套题创建失败，请稍后重试'
  } finally {
    creatingSuite.value = false
  }
}

function openReadingReview(record) {
  const assetId = String(record?.assetId || record?.examId || '').trim()
  const sessionId = String(record?.sessionId || '').trim()
  if (!assetId || !sessionId) return
  const suiteSessionId = getReadingHistorySuiteSessionId(record)
  const target = {
    name: 'PracticeReadingReview',
    params: { assetId, sessionId }
  }
  if (suiteSessionId) {
    target.query = { suiteSessionId }
  }
  router.push(target)
}

function getReadingHistorySuiteSessionId(record) {
  const metadata = record?.metadata || record?.submission?.metadata || record?.raw?.metadata || {}
  return String(metadata.suiteSessionId || metadata.suite_session_id || '').trim()
}

function handleHistoryItemClick(record, event) {
  if (bulkDeleteMode.value) {
    toggleHistorySelection(record.id)
    return
  }
  const actionTarget = event.target?.closest?.('[data-record-action]')
  if (actionTarget) return
  openReadingReview(record)
}

function toggleHistorySelection(recordId) {
  const id = String(recordId || '').trim()
  if (!id) return
  const next = new Set(selectedHistoryIds.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  selectedHistoryIds.value = next
}

async function toggleBulkDeleteMode() {
  if (historyBusy.value) return
  if (!bulkDeleteMode.value) {
    selectedHistoryIds.value = new Set()
    bulkDeleteMode.value = true
    showLocalMessage('批量管理模式已开启，点击记录进行选择')
    return
  }

  const selectedIds = Array.from(selectedHistoryIds.value)
  if (selectedIds.length === 0) {
    bulkDeleteMode.value = false
    return
  }

  if (!window.confirm(`确定要删除选中的 ${selectedIds.length} 条记录吗？此操作不可恢复。`)) {
    bulkDeleteMode.value = false
    selectedHistoryIds.value = new Set()
    return
  }

  historyBusy.value = true
  try {
    await Promise.all(selectedIds.map((recordId) => practiceHistory.delete('reading', recordId)))
    selectedHistoryIds.value = new Set()
    bulkDeleteMode.value = false
    await loadHistory()
    showLocalMessage(`已删除 ${selectedIds.length} 条练习记录`)
  } catch (error) {
    console.error('批量删除练习记录失败:', error)
    showLocalMessage(error?.message ? `批量删除失败：${error.message}` : '批量删除失败，请稍后重试')
  } finally {
    historyBusy.value = false
  }
}

async function deleteHistoryRecord(record) {
  const recordId = String(record?.id || '').trim()
  if (!recordId || historyBusy.value) return
  const title = record?.title || '无标题'
  const date = formatRecordDate(record)
  if (!window.confirm(`确定要删除这条练习记录吗？\n\n题目: ${title}\n时间: ${date}\n\n此操作不可恢复。`)) {
    return
  }

  historyBusy.value = true
  try {
    await practiceHistory.delete('reading', recordId)
    selectedHistoryIds.value = new Set(Array.from(selectedHistoryIds.value).filter((id) => id !== recordId))
    await loadHistory()
    showLocalMessage('记录已删除')
  } catch (error) {
    console.error('删除练习记录失败:', error)
    showLocalMessage(error?.message ? `删除记录失败：${error.message}` : '删除记录失败，请稍后重试')
  } finally {
    historyBusy.value = false
  }
}

async function clearPracticeData() {
  if (historyBusy.value) return
  if (!window.confirm('确定要清除所有阅读练习记录吗？此操作不可恢复。')) {
    return
  }

  historyBusy.value = true
  try {
    const result = await practiceHistory.clear({ activity: 'reading' })
    selectedHistoryIds.value = new Set()
    bulkDeleteMode.value = false
    await loadHistory()
    showLocalMessage(`练习记录已清除${result?.deletedCount ? `：${result.deletedCount} 条` : ''}`)
  } catch (error) {
    console.error('清除练习记录失败:', error)
    showLocalMessage(error?.message ? `清除记录失败：${error.message}` : '清除记录失败，请稍后重试')
  } finally {
    historyBusy.value = false
  }
}

function exportPracticeMarkdown() {
  const records = filteredHistory.value
  if (!records.length) {
    showLocalMessage('暂无可导出的练习记录')
    return
  }
  const lines = [
    '# 阅读练习记录',
    '',
    `导出时间: ${new Date().toLocaleString()}`,
    `记录数量: ${records.length}`,
    ''
  ]
  records.forEach((record, index) => {
    lines.push(
      `## ${index + 1}. ${record.title || '无标题'}`,
      '',
      `- 提交时间: ${formatRecordDate(record)}`,
      `- 用时: ${formatDurationShort(record.duration)}`,
      `- 正确率: ${historyPercentage(record)}%`,
      `- 得分: ${Number(record.correctAnswers || record.score || 0)} / ${Number(record.totalQuestions || 0)}`,
      `- Session: ${record.sessionId || ''}`,
      `- Asset: ${record.assetId || record.examId || ''}`,
      ''
    )
  })
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `reading-practice-records-${new Date().toISOString().slice(0, 10)}.md`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  showLocalMessage('Markdown 导出完成')
}

function downloadJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function normalizeReadingBackupEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  const archive = entry.archive && typeof entry.archive === 'object' ? entry.archive : null
  if (!archive || archive.activity !== 'reading' || !Array.isArray(archive.submissions)) return null
  const createdAt = String(entry.createdAt || archive.exportedAt || new Date().toISOString())
  const id = String(entry.id || `reading-backup-${createdAt}`).replace(/[^A-Za-z0-9._:-]/g, '-')
  return {
    id,
    createdAt,
    schemaVersion: String(archive.schemaVersion || 'practice-history-archive.v1'),
    count: Number(archive.count || archive.submissions.length || 0),
    archive
  }
}

function readReadingBackups() {
  try {
    const raw = localStorage.getItem(READING_BACKUP_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? parsed.map(normalizeReadingBackupEntry).filter(Boolean)
      : []
  } catch (_) {
    return []
  }
}

function persistReadingBackups(backups) {
  const normalized = Array.isArray(backups)
    ? backups.map(normalizeReadingBackupEntry).filter(Boolean).slice(0, MAX_READING_BACKUPS)
    : []
  readingBackups.value = normalized
  try {
    localStorage.setItem(READING_BACKUP_STORAGE_KEY, JSON.stringify(normalized))
  } catch (error) {
    console.warn('保存阅读备份索引失败:', error)
    showLocalMessage('本地备份索引保存失败，请使用导出文件备份。')
  }
}

function formatBackupDate(backup) {
  const timestamp = String(backup?.createdAt || backup?.archive?.exportedAt || '').trim()
  if (!timestamp) return '未知时间'
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString()
}

async function createReadingBackup() {
  if (historyBusy.value) return
  historyBusy.value = true
  try {
    const archive = await practiceHistory.exportArchive({ activity: 'reading' })
    const createdAt = new Date().toISOString()
    const backup = normalizeReadingBackupEntry({
      id: `reading-backup-${createdAt.replace(/[:.]/g, '-')}`,
      createdAt,
      archive
    })
    if (!backup) {
      throw new Error('备份数据结构无效')
    }
    persistReadingBackups([backup, ...readingBackups.value.filter((entry) => entry.id !== backup.id)])
    backupListOpen.value = true
    libraryConfigOpen.value = false
    showLocalMessage(`阅读记录备份完成：${backup.count} 条`)
  } catch (error) {
    console.error('创建阅读备份失败:', error)
    showLocalMessage(error?.message ? `备份失败：${error.message}` : '备份失败，请稍后重试')
  } finally {
    historyBusy.value = false
  }
}

function showReadingBackupList() {
  readingBackups.value = readReadingBackups()
  backupListOpen.value = true
  libraryConfigOpen.value = false
  if (!readingBackups.value.length) {
    showLocalMessage('暂无备份记录')
  }
}

function downloadReadingBackup(backup) {
  const normalized = normalizeReadingBackupEntry(backup)
  if (!normalized) {
    showLocalMessage('备份数据无效，无法下载')
    return
  }
  downloadJsonFile(`${normalized.id}.json`, normalized.archive)
  showLocalMessage('备份文件已下载')
}

async function restoreReadingBackup(backup) {
  if (historyBusy.value) return
  const normalized = normalizeReadingBackupEntry(backup)
  if (!normalized) {
    showLocalMessage('备份数据无效，无法恢复')
    return
  }
  if (!window.confirm(`确定要恢复备份 ${normalized.id} 吗？当前阅读练习记录将被替换。`)) {
    return
  }

  historyBusy.value = true
  try {
    await practiceHistory.clear({ activity: 'reading' })
    const result = await practiceHistory.importArchive('reading', normalized.archive)
    selectedHistoryIds.value = new Set()
    bulkDeleteMode.value = false
    await loadHistory()
    showLocalMessage(`备份恢复完成：${result?.importedCount || 0} 条，跳过 ${result?.skippedCount || 0} 条`)
  } catch (error) {
    console.error('恢复阅读备份失败:', error)
    showLocalMessage(error?.message ? `恢复失败：${error.message}` : '恢复失败，请稍后重试')
  } finally {
    historyBusy.value = false
  }
}

function deleteReadingBackup(backupId) {
  const id = String(backupId || '').trim()
  if (!id) return
  if (!window.confirm(`确定要删除备份 ${id} 吗？此操作不可恢复。`)) {
    return
  }
  persistReadingBackups(readingBackups.value.filter((backup) => backup.id !== id))
  showLocalMessage('备份已删除')
}

async function exportReadingArchive(mode = 'export') {
  if (historyBusy.value) return
  historyBusy.value = true
  try {
    const archive = await practiceHistory.exportArchive({ activity: 'reading' })
    const prefix = mode === 'backup' ? 'ielts-reading-practice-backup' : 'ielts-reading-practice-export'
    downloadJsonFile(`${prefix}-${new Date().toISOString().slice(0, 10)}.json`, archive)
    showLocalMessage(`阅读记录${mode === 'backup' ? '备份' : '导出'}完成：${archive?.count || 0} 条`)
  } catch (error) {
    console.error('导出阅读记录失败:', error)
    showLocalMessage(error?.message ? `导出失败：${error.message}` : '导出失败，请稍后重试')
  } finally {
    historyBusy.value = false
  }
}

function triggerReadingArchiveImport() {
  if (historyBusy.value) return
  readingArchiveImportInput.value?.click()
}

async function handleReadingArchiveImportChange(event) {
  const input = event?.target
  const file = input?.files?.[0]
  if (!file) return
  try {
    await importReadingArchiveFile(file)
  } finally {
    if (input) {
      input.value = ''
    }
  }
}

async function importReadingArchiveFile(file) {
  historyBusy.value = true
  try {
    const text = await file.text()
    const payload = JSON.parse(text)
    const result = await practiceHistory.importArchive('reading', payload)
    await loadHistory()
    showLocalMessage(`阅读记录导入完成：${result?.importedCount || 0} 条，跳过 ${result?.skippedCount || 0} 条`)
  } catch (error) {
    console.error('导入阅读记录失败:', error)
    showLocalMessage(error?.message ? `导入失败：${error.message}` : '导入失败，请检查 JSON 文件')
  } finally {
    historyBusy.value = false
  }
}

function showReadingLibraryConfigList() {
  libraryConfigOpen.value = true
  backupListOpen.value = false
}

function historyPercentage(record) {
  return Math.round(Number(record?.accuracy || 0) * 100)
}

function formatRecordDate(record) {
  const value = String(record?.submittedAt || record?.endTime || record?.startTime || '').trim()
  return value ? new Date(value).toLocaleString() : '未知时间'
}

function getRecordDate(record) {
  const timestamp = safeDateMs(record?.submittedAt || record?.endTime || record?.startTime)
  return timestamp ? new Date(timestamp) : null
}

function formatDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function getPracticeSetId(record, dateKey, index) {
  const metadata = record?.metadata && typeof record.metadata === 'object' ? record.metadata : {}
  const suiteSessionId = String(metadata.suiteSessionId || metadata.suite_session_id || '').trim()
  if (suiteSessionId) return `suite:${suiteSessionId}`
  const sessionId = String(record?.sessionId || metadata.sessionId || '').trim()
  if (sessionId) return `session:${sessionId}`
  const assetId = String(record?.assetId || record?.examId || metadata.assetId || metadata.examId || '').trim()
  if (assetId && dateKey) return `asset:${dateKey}:${assetId}`
  return dateKey ? `record:${dateKey}:${index}` : ''
}

function resolveHeatmapLevel(count, averageSetsPerActiveDay) {
  if (!count) return 0
  const baseline = Math.max(1, Number(averageSetsPerActiveDay) || 1)
  if (count >= baseline * 2.4) return 4
  if (count >= baseline * 1.6) return 3
  if (count >= baseline) return 2
  return 1
}

function formatDurationShort(durationSec) {
  const seconds = Math.max(0, Math.round(Number(durationSec || 0)))
  if (!seconds) return '0秒'
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (!minutes) return `${rest}秒`
  return `${minutes}分${rest ? `${rest}秒` : ''}`
}

function getScoreColor(percentage) {
  if (percentage >= 85) return '#16a34a'
  if (percentage >= 70) return '#ca8a04'
  if (percentage >= 55) return '#ea580c'
  return '#dc2626'
}

function normalizeQuestionKind(value) {
  return String(value || 'unknown').trim().toLowerCase().replace(/[\s_-]+/g, '_') || 'unknown'
}

function formatQuestionKindLabel(value) {
  const labels = {
    matching_headings: '标题匹配',
    true_false_not_given: '判断题',
    yes_no_not_given: '判断题',
    multiple_choice: '选择题',
    summary_completion: '摘要填空',
    sentence_completion: '句子填空',
    table_completion: '表格填空',
    matching_information: '信息匹配',
    matching_features: '特征匹配',
    matching_sentence_endings: '句尾匹配',
    short_answer: '简答题',
    unknown: '未分类'
  }
  const normalized = normalizeQuestionKind(value)
  return labels[normalized] || normalized.split('_').filter(Boolean).map((part) => (
    part.charAt(0).toUpperCase() + part.slice(1)
  )).join(' ')
}

function formatExamMetaText(asset) {
  const category = normalizeCategory(asset.category)
  const frequency = asset.metadata?.frequency || asset.difficulty || ''
  const label = frequency ? ` | ${frequency}` : ''
  return `${category} | reading${label}`
}

function frequencyRank(asset) {
  const ranks = { high: 3, medium: 2, low: 1, unknown: 0 }
  return ranks[normalizeFrequency(asset)] || 0
}

function difficultyRank(asset) {
  const value = [
    asset?.metadata?.difficultyRank,
    asset?.metadata?.difficulty,
    asset?.difficulty,
    asset?.metadata?.frequency,
    asset?.frequency,
    asset?.title,
    asset?.id,
    asset?.metadata?.dataKey,
    asset?.metadata?.legacyFilename,
    asset?.metadata?.pdfFilename
  ].filter(Boolean).join(' ').toLowerCase()
  if (/(\b|_)(hard|difficult|advanced|high)(\b|_|-)/.test(value) || value.includes('困难') || value.includes('高难') || value.includes('超高频') || value.includes('高频')) return 3
  if (/(\b|_)(medium|intermediate|mid)(\b|_|-)/.test(value) || value.includes('中等') || value.includes('中频') || value.includes('次高频')) return 2
  if (/(\b|_)(easy|basic|low)(\b|_|-)/.test(value) || value.includes('简单') || value.includes('低频')) return 1
  const numeric = Number(asset?.metadata?.difficultyRank ?? asset?.difficultyRank ?? asset?.metadata?.difficultyScore)
  return Number.isFinite(numeric) ? numeric : 0
}

function getPdfPath(asset) {
  return asset?.metadata?.shuiPdf
    || asset?.metadata?.legacyPath
    || asset?.metadata?.pdfPath
    || asset?.metadata?.pdfFilename
    || asset?.metadata?.legacyFilename
    || ''
}

function hasReadingPracticePayload(asset) {
  const metadata = asset?.metadata || {}
  return Boolean(
    asset?.payloadRef
    || metadata.dataKey
    || metadata.script
  )
}

function viewPdf(asset) {
  const pdfPath = String(getPdfPath(asset) || '').trim()
  if (!pdfPath) {
    showLocalMessage('此题暂未提供 PDF。')
    return
  }
  const targetUrl = resolveLegacyAssetUrl(pdfPath)
  const opened = window.open(
    targetUrl,
    `reading_pdf_${String(asset?.id || Date.now()).replace(/[^A-Za-z0-9_-]/g, '_')}`,
    'width=1000,height=800,scrollbars=yes,resizable=yes,status=yes,toolbar=yes'
  )
  if (!opened) {
    showLocalMessage('PDF 打开失败：请检查弹窗拦截设置。')
    return
  }
  showLocalMessage(`正在打开 PDF：${pdfPath}`)
}

function clearPracticeCache() {
  const removablePrefixes = [
    'practice_reading_answers_',
    'practice_reading_submission_'
  ]
  for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = sessionStorage.key(index) || ''
    if (removablePrefixes.some((prefix) => key.startsWith(prefix))) {
      sessionStorage.removeItem(key)
    }
  }
  showLocalMessage('阅读练习临时缓存已清除。')
}

function switchBackgroundTheme() {
  themeSwitcherOpen.value = true
}

function applyBackgroundTheme(themeName) {
  const nextTheme = backgroundThemes.some((theme) => theme.value === themeName)
    ? themeName
    : 'misty-mountain'
  if (typeof window.switchBgTheme === 'function') {
    window.switchBgTheme(nextTheme)
  } else {
    try {
      localStorage.setItem('three_bg_theme', nextTheme)
    } catch (_) {}
    window.dispatchEvent(new CustomEvent('shui-bg-theme-change', { detail: { theme: nextTheme } }))
  }
  themeSwitcherOpen.value = false
  const label = backgroundThemes.find((theme) => theme.value === nextTheme)?.title || nextTheme
  showLocalMessage(`主题已切换：${label}`)
}

function calculateStreakDays(records) {
  const days = new Set(records.map((record) => {
    const value = String(record.submittedAt || record.endTime || '').trim()
    if (!value) return ''
    return value.slice(0, 10)
  }).filter(Boolean))
  if (!days.size) return 0

  let streak = 0
  const cursor = new Date()
  for (;;) {
    const key = cursor.toISOString().slice(0, 10)
    if (!days.has(key)) break
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

function showLocalMessage(message) {
  localMessage.value = message
  window.setTimeout(() => {
    if (localMessage.value === message) {
      localMessage.value = ''
    }
  }, 3200)
}

function updateLiquidIndicator() {
  const nav = document.querySelector('.practice-library-legacy .hero-nav')
  if (!nav) return
  const indicator = nav.querySelector('.hero-nav__liquid-indicator')
  const active = nav.querySelector('.hero-nav__btn.active')
  if (!indicator || !active) return
  const navRect = nav.getBoundingClientRect()
  const activeRect = active.getBoundingClientRect()
  const inset = 3
  indicator.style.left = `${Math.max(0, activeRect.left - navRect.left + inset)}px`
  indicator.style.top = `${Math.max(0, activeRect.top - navRect.top + inset)}px`
  indicator.style.width = `${Math.max(16, activeRect.width - inset * 2)}px`
  indicator.style.height = `${Math.max(16, activeRect.height - inset * 2)}px`
  nav.classList.add('hero-nav--liquid-ready')
}

function updateSegmentedIndicators() {
  document.querySelectorAll('.practice-library-legacy .shui-segmented-control').forEach((control) => {
    const indicator = control.querySelector('.shui-segmented-indicator')
    const active = control.querySelector('.shui-segmented-btn.active, .shui-segmented-btn[aria-pressed="true"]')
    if (!indicator || !active) return
    indicator.style.width = `${active.offsetWidth}px`
    indicator.style.transform = `translateX(${active.offsetLeft}px)`
    indicator.style.opacity = '1'
  })
}
</script>

<style scoped>
.practice-library-legacy {
  --color-white: #fff;
  --color-gray-50: #f8fafc;
  --color-gray-100: #f1f5f9;
  --color-gray-200: #e2e8f0;
  --color-gray-300: #cbd5e1;
  --color-gray-400: #94a3b8;
  --color-gray-500: #64748b;
  --color-gray-600: #475569;
  --color-gray-700: #334155;
  --color-gray-800: #1e293b;
  --color-gray-900: #0f172a;
  --color-brand-primary: #667eea;
  --color-brand-secondary: #764ba2;
  --color-brand-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-info: #3b82f6;
  --space-xs: 8px;
  --space-sm: 12px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
  --space-2xl: 48px;
  --font-size-xs: 0.75rem;
  --font-size-sm: 0.875rem;
  --font-size-base: 1rem;
  --font-size-lg: 1.125rem;
  --font-size-xl: 1.25rem;
  --font-size-3xl: 1.875rem;
  --font-size-4xl: 2.25rem;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
  --line-height-tight: 1.25;
  --border-radius-lg: 12px;
  --border-radius-xl: 16px;
  --border-radius-full: 999px;
  --shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.08);
  --shadow-md: 0 8px 24px rgba(15, 23, 42, 0.12);
  --shadow-lg: 0 16px 40px rgba(15, 23, 42, 0.15);
  --transition-normal: 180ms ease;
  position: relative;
  z-index: 1;
  max-width: 1200px;
  margin: 0 auto;
  padding: clamp(32px, 5vw, 72px) clamp(16px, 5vw, 48px) 80px;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.hero-header {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.hero-header h1 {
  width: 100%;
  margin: 0;
  font-size: clamp(2.2rem, 4.5vw, 3.4rem);
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: var(--color-gray-900);
}

.hero-brand-title {
  flex-wrap: wrap;
  row-gap: 10px;
}

.hero-brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: clamp(44px, 5vw, 58px);
  height: clamp(44px, 5vw, 58px);
  border-radius: 16px;
  color: #0f2143;
  background: rgba(255, 255, 255, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.5);
  box-shadow:
    0 16px 34px rgba(15, 23, 42, 0.1),
    inset 0 1px 1px rgba(255, 255, 255, 0.72),
    inset 0 -1px 1px rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(18px) saturate(160%);
  -webkit-backdrop-filter: blur(18px) saturate(160%);
}

.hero-brand-text {
  font-family: Georgia, 'Times New Roman', 'WenKai', serif;
  font-size: clamp(2.45rem, 5.2vw, 4.35rem);
  font-weight: 700;
  line-height: 0.96;
  letter-spacing: 0;
  color: #08172f;
  text-shadow:
    0 1px 0 rgba(255, 255, 255, 0.62),
    0 18px 40px rgba(15, 23, 42, 0.16);
}

.hero-brand-subtitle {
  flex: 1 1 320px;
  min-width: 240px;
  color: rgba(51, 65, 85, 0.72);
  font-size: clamp(0.86rem, 1.4vw, 1rem);
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: 0;
}

.hero-brand-title .inline-hover-link {
  margin-left: auto;
  margin-right: 20px;
  color: inherit;
  display: flex;
  align-items: center;
  transition: opacity 0.2s;
}

.hero-brand-title .inline-hover-link:hover {
  opacity: 0.7;
}

.hero-badge {
  font-size: 0.78rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  padding: 5px 14px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.6);
  color: var(--color-white);
}

.hero-badge--redbook {
  background: #ff1c1c;
  box-shadow: 0 12px 30px rgba(255, 77, 79, 0.35);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.hero-nav {
  position: relative;
  display: flex;
  justify-content: center;
  gap: 4px;
  padding: 6px;
  margin-bottom: 0;
  flex-wrap: wrap;
  background: rgba(245, 245, 247, 0.55);
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.7);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04), inset 0 -1px 1px rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  overflow: hidden;
  isolation: isolate;
}

.hero-nav__liquid-indicator {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 1;
  pointer-events: none;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.6);
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.45), rgba(255, 255, 255, 0.05));
  box-shadow:
    inset 0 2px 3px rgba(255, 255, 255, 0.9),
    inset 0 -2px 5px rgba(255, 255, 255, 0.2),
    inset 0 0 10px rgba(255, 255, 255, 0.4),
    0 4px 12px rgba(0, 0, 0, 0.06);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  opacity: 0;
  transition: left 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.15), top 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.15), width 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.15), height 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.15), opacity 0.22s ease;
}

.hero-nav.hero-nav--liquid-ready .hero-nav__liquid-indicator {
  opacity: 1;
}

.nav-btn,
.hero-nav__btn {
  flex: 1;
  position: relative;
  z-index: 2;
  border: 1px solid transparent;
  background: transparent;
  color: rgba(60, 60, 67, 0.7);
  padding: 10px 14px;
  border-radius: 999px;
  font-size: 0.95rem;
  font-weight: 600;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  transition: color 260ms ease, background 260ms ease, box-shadow 260ms ease;
}

.hero-nav__btn:hover {
  color: rgba(0, 0, 0, 0.85);
  background: rgba(255, 255, 255, 0.45);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.03), inset 0 1px 1px rgba(255, 255, 255, 0.7);
}

.hero-nav__btn.active {
  color: #1d1d1f;
  background: transparent;
  box-shadow: none;
  text-shadow: 0 1px 2px rgba(255, 255, 255, 0.8);
}

.view {
  display: none;
  background: #f2f2f2;
  padding: var(--space-2xl);
  border-radius: var(--border-radius-xl);
  box-shadow: var(--shadow-lg);
  border: 2px solid #737373;
  min-height: 400px;
}

.view.active {
  display: block;
}

.view > h2 {
  margin-bottom: var(--space-xl);
  font-size: var(--font-size-3xl);
  font-weight: var(--font-weight-bold);
  color: var(--color-gray-900);
}

.heading-serif {
  font-family: var(--font-family-display);
}

.category-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-md);
}

.overview-section-heading {
  grid-column: 1 / -1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.overview-section-title {
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--color-gray-800);
}

.overview-section-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  border: none;
}

.category-card {
  background: rgba(255, 252, 247, 0.95);
  background-image: linear-gradient(135deg, rgba(252, 214, 172, 0.32), rgba(173, 228, 210, 0.28)), linear-gradient(135deg, rgba(255, 255, 255, 0.95), rgba(250, 244, 236, 0.9));
  padding: var(--space-xl);
  border-radius: var(--border-radius-xl);
  border: 1px solid rgba(232, 189, 145, 0.35);
  transition: all var(--transition-normal);
  box-shadow: 0 18px 46px rgba(215, 180, 140, 0.2), 0 10px 28px rgba(53, 192, 161, 0.14);
  position: relative;
  overflow: hidden;
  backdrop-filter: blur(14px);
}

.category-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: linear-gradient(120deg, #f6b26b 0%, #35c0a1 100%);
  opacity: 0.9;
}

.category-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 22px 58px rgba(92, 119, 230, 0.2), 0 12px 30px rgba(124, 231, 255, 0.16);
  border-color: rgba(232, 189, 145, 0.5);
}

.category-header {
  display: flex;
  align-items: center;
  margin-bottom: var(--space-lg);
}

.category-icon {
  font-size: 2.5rem;
  margin-right: var(--space-lg);
  opacity: 0.8;
}

.category-title {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-bold);
  color: var(--color-gray-900);
  margin-bottom: var(--space-xs);
}

.category-meta {
  font-size: var(--font-size-sm);
  color: var(--color-gray-600);
  font-weight: var(--font-weight-medium);
}

.category-card .category-actions {
  display: flex;
  gap: var(--space-md);
  margin-top: var(--space-xl);
  flex-wrap: nowrap;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  min-height: 40px;
  padding: var(--space-md) var(--space-lg);
  border-radius: var(--border-radius-lg);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  text-decoration: none;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all var(--transition-normal);
  white-space: nowrap;
  background: #bf755a;
  color: #f2f2f2;
}

.btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #bf755a, #a0654a);
  transform: translateY(-1px);
  box-shadow: var(--shadow-lg);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  pointer-events: none;
}

.btn-secondary {
  background: #525918;
  color: #f2f2f2;
}

.btn-secondary:hover:not(:disabled) {
  background: linear-gradient(135deg, #525918, #3a3d10);
  box-shadow: var(--shadow-md);
}

.btn-warning {
  background: #bf75a5;
}

.btn-info {
  background: #bf755a;
}

.btn-outline {
  background: rgba(255, 255, 255, 0.94);
  color: #2f3a3f;
  border: 1px solid rgba(232, 189, 145, 0.35);
}

.btn-sm {
  padding: var(--space-sm) var(--space-md);
  font-size: var(--font-size-xs);
}

.btn-text {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-brand-primary);
  font-weight: 600;
  cursor: pointer;
}

.browse-title-bar,
.hero-panel__header {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: var(--space-xl);
}

.browse-title-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.36);
  cursor: pointer;
}

#browse-title {
  margin: 0;
  font-size: var(--font-size-3xl);
}

#type-filter-buttons,
.shui-filter-group,
.hero-panel__actions {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

#type-filter-buttons {
  margin-left: auto;
}

.shui-filter-btn.active {
  background: var(--color-brand-gradient);
}

.search-box {
  margin-bottom: var(--space-xl);
  position: relative;
}

.search-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.search-input-wrap {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
}

.search-input {
  width: 100%;
  min-height: 44px;
  border: 1px solid var(--color-gray-300);
  border-radius: var(--border-radius-lg);
  padding: 0 42px 0 14px;
  background: rgba(255, 255, 255, 0.85);
}

.search-clear-btn {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  border: 0;
  background: transparent;
  color: var(--color-gray-500);
  cursor: pointer;
}

.browse-sort-wrapper {
  position: relative;
  min-width: 160px;
}

.browse-sort-select {
  width: 100%;
  min-height: 44px;
  appearance: none;
  border: 1px solid var(--color-gray-300);
  border-radius: var(--border-radius-lg);
  padding: 0 36px 0 14px;
  background: rgba(255, 255, 255, 0.85);
}

.browse-sort-icon {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none;
}

.exam-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--space-md);
  max-height: 72vh;
  overflow-y: auto;
  padding-left: var(--space-sm);
  align-content: start;
}

.exam-item {
  background: rgba(255, 252, 247, 0.95);
  padding: var(--space-lg);
  border-radius: var(--border-radius-xl);
  border: 1px solid transparent;
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  transition: all var(--transition-normal);
  box-shadow: 0 18px 46px rgba(215, 180, 140, 0.2), 0 10px 28px rgba(53, 192, 161, 0.14);
  position: relative;
  backdrop-filter: blur(12px);
}

.exam-item:hover {
  transform: translateY(-3px);
  border-color: rgba(232, 189, 145, 0.5);
  background: linear-gradient(140deg, rgba(252, 226, 199, 0.96), rgba(188, 228, 213, 0.9));
}

.exam-info {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  flex: 1;
}

.exam-info h4 {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-gray-900);
  line-height: var(--line-height-tight);
}

.exam-meta {
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
  flex-wrap: wrap;
  font-size: var(--font-size-sm);
  color: #3a4148;
  font-weight: var(--font-weight-medium);
  margin-top: var(--space-xs);
  padding: 6px 10px;
  border-radius: var(--border-radius-lg);
  background: rgba(232, 189, 145, 0.18);
}

.exam-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-sm);
  width: 100%;
}

.exam-item-action-btn {
  opacity: 0.95;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--border-radius-lg);
  border: 1px solid rgba(232, 189, 145, 0.4);
  background: linear-gradient(135deg, #f6b26b, #35c0a1);
  color: #0f1416;
  box-shadow: 0 8px 20px rgba(215, 180, 140, 0.14), 0 4px 10px rgba(53, 192, 161, 0.12);
}

.exam-list-empty,
.practice-history-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  padding: var(--space-2xl) var(--space-xl);
  text-align: center;
  border-radius: var(--border-radius-xl);
  background: rgba(226, 232, 240, 0.16);
  border: 1px dashed rgba(148, 163, 184, 0.4);
  color: var(--color-gray-700);
}

.exam-list-empty-icon,
.practice-history-empty-icon {
  font-size: 2.5rem;
}

.exam-list-empty-text,
.practice-history-empty-text {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
}

.exam-list-empty-hint {
  font-size: var(--font-size-sm);
  color: var(--color-gray-500);
}

.practice-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-xl);
  margin-bottom: var(--space-2xl);
}

.stat-card {
  background: #f2f2f2;
  padding: var(--space-xl);
  border-radius: var(--border-radius-xl);
  text-align: center;
  border: 2px solid #737373;
  box-shadow: var(--shadow-lg);
  transition: all var(--transition-normal);
  position: relative;
  overflow: hidden;
  backdrop-filter: blur(10px);
}

.stat-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: var(--color-brand-gradient);
}

.stat-number {
  font-size: var(--font-size-4xl);
  font-weight: var(--font-weight-bold);
  color: var(--color-brand-primary);
  margin-bottom: var(--space-sm);
}

.stat-label {
  font-size: var(--font-size-sm);
  color: var(--color-gray-600);
  font-weight: var(--font-weight-medium);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.practice-history {
  background: linear-gradient(135deg, #e8e8e8 0%, #ffffff 50%, #e8e8e8 100%);
  border-radius: var(--border-radius-xl);
  padding: var(--space-xl);
  border: 2px solid #737373;
}

.practice-history-header {
  justify-content: flex-start;
}

.practice-history-header > .hero-panel__actions:last-child {
  margin-left: auto;
}

.practice-history-search-row {
  margin-bottom: var(--space-lg);
}

.practice-history-list {
  display: grid;
  gap: var(--space-md);
}

.history-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  gap: var(--space-md);
  align-items: center;
  padding: var(--space-lg);
  border-radius: var(--border-radius-xl);
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(148, 163, 184, 0.24);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
}

.history-item:hover {
  box-shadow: var(--shadow-md);
}

.record-selection-hidden {
  display: none;
}

.practice-record-title {
  color: var(--color-gray-900);
  text-decoration: none;
}

.practice-record-title:hover {
  color: var(--color-brand-primary);
}

.record-meta-line {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-md);
  color: var(--color-gray-600);
  margin-top: 6px;
}

.record-percentage {
  font-size: 1.3rem;
  font-weight: var(--font-weight-bold);
}

.delete-record-btn {
  border: 0;
  background: transparent;
  cursor: pointer;
  opacity: 0.72;
}

.more-tools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--space-lg);
  margin-top: var(--space-xl);
}

.tool-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: var(--space-md);
  align-items: center;
  padding: var(--space-xl);
  border-radius: var(--border-radius-xl);
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: rgba(255, 255, 255, 0.78);
  text-align: left;
  cursor: pointer;
}

.tool-card-content h3 {
  margin: 0 0 6px;
}

.tool-card-content p,
.more-view-subtitle,
.hero-panel__muted {
  color: var(--color-gray-600);
  margin: 0;
}

.hero-settings-group {
  display: grid;
  gap: var(--space-xl);
}

.hero-settings-actions,
.hero-settings-links,
.app-update-details-grid {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-md);
}

.app-update-details-row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-md);
  min-width: 220px;
  padding: var(--space-md);
  border-radius: var(--border-radius-lg);
  background: rgba(255, 255, 255, 0.66);
}

.hero-settings-links a {
  color: var(--color-brand-primary);
  font-weight: 600;
}

.inline-message {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  margin-top: 16px;
  border-radius: var(--border-radius-lg);
}

.inline-message-error {
  color: #7f1d1d;
  background: rgba(254, 226, 226, 0.72);
  border: 1px solid rgba(248, 113, 113, 0.4);
}

.loading {
  text-align: center;
  padding: var(--space-2xl);
  color: var(--color-gray-600);
}

.spinner {
  border: 3px solid var(--color-gray-200);
  border-radius: var(--border-radius-full);
  border-top: 3px solid var(--color-brand-primary);
  width: 40px;
  height: 40px;
  animation: spin 1s linear infinite;
  margin: 0 auto var(--space-lg);
}

.ui-emoji-icon {
  display: inline-flex;
  width: 1em;
  height: 1em;
  color: currentColor;
  vertical-align: -0.14em;
  flex: 0 0 auto;
}

.ui-emoji-icon :deep(svg),
.tool-card-icon :deep(svg) {
  width: 100%;
  height: 100%;
  stroke: currentColor;
}

.practice-local-message {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 50;
  max-width: min(420px, calc(100vw - 48px));
  padding: 12px 16px;
  border-radius: var(--border-radius-lg);
  color: var(--color-gray-900);
  background: rgba(255, 255, 255, 0.92);
  box-shadow: var(--shadow-lg);
  border: 1px solid rgba(148, 163, 184, 0.28);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 900px) {
  .practice-library-legacy {
    padding: 28px 16px 48px;
  }

  .hero-header h1 {
    flex-wrap: wrap;
  }

  .hero-brand-title .inline-hover-link {
    margin-left: 0;
  }

  .category-grid {
    grid-template-columns: 1fr;
  }

  .overview-section-heading,
  .browse-title-bar,
  .hero-panel__header,
  .search-row {
    align-items: stretch;
    flex-direction: column;
  }

  #type-filter-buttons {
    margin-left: 0;
  }

  .exam-list {
    grid-template-columns: 1fr;
    padding-left: 0;
  }

  .history-item {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .record-percentage-container,
  .record-actions-container {
    grid-column: 2;
  }
}

/* Vue port of opensource@ec47b29 index.html + heroui-bridge.css.
   Keep the legacy DOM/API contract above; this layer restores the actual product skin. */
.practice-library-open-source {
  --shui-shell-max-width: 1400px;
  --shui-panel-bg: rgba(255, 255, 255, 0.25);
  --shui-panel-border: rgba(255, 255, 255, 0.4);
  --shui-panel-shadow: 0 20px 40px rgba(0, 0, 0, 0.1),
    inset 0 1px 1px rgba(255, 255, 255, 0.6),
    inset 0 -1px 1px rgba(255, 255, 255, 0.1);
  --shui-surface-bg: rgba(255, 255, 255, 0.65);
  --shui-surface-border: rgba(148, 163, 184, 0.35);
  --shui-text-strong: var(--color-gray-900);
  --shui-text-muted: rgba(51, 65, 85, 0.7);
  --shui-accent: var(--color-brand-primary);
  --shui-accent-alt: var(--color-brand-secondary);
  --shui-gradient-start: #ffd89b;
  --shui-gradient-end: #6accc7;
  --shui-radius-xl: 28px;
  --shui-radius-lg: 20px;
  --shui-radius-md: 16px;
  --shui-radius-sm: 12px;
  --shui-blur: 32px;
  --bauhaus-text-main: #0f172a;
  --bauhaus-text-muted: #64748b;
  --bauhaus-accent-red: #dc2626;
  --bauhaus-accent-blue: #2563eb;
  --bauhaus-accent-dark: #334155;
  --bloom-surface: rgba(255, 252, 247, 0.95);
  --bloom-border: rgba(232, 189, 145, 0.35);
  --bloom-border-strong: rgba(232, 189, 145, 0.5);
  --bloom-sheen: linear-gradient(135deg, rgba(252, 214, 172, 0.32), rgba(173, 228, 210, 0.28));
  --bloom-highlight: linear-gradient(120deg, #f6b26b 0%, #35c0a1 100%);
  --bloom-shadow: 0 18px 46px rgba(215, 180, 140, 0.2), 0 10px 28px rgba(53, 192, 161, 0.14);
  max-width: var(--shui-shell-max-width);
  color: var(--shui-text-strong);
}

.practice-library-open-source * {
  letter-spacing: normal;
}

.practice-library-open-source .hero-header h1 {
  color: var(--shui-text-strong);
  font-family: var(--font-family-base, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  font-weight: 700;
  letter-spacing: 0;
}

.practice-library-open-source .view.hero-panel {
  background: var(--shui-panel-bg);
  border-radius: var(--shui-radius-xl);
  border: 1px solid var(--shui-panel-border);
  padding: clamp(28px, 4vw, 48px);
  box-shadow: var(--shui-panel-shadow);
  backdrop-filter: blur(var(--shui-blur));
  -webkit-backdrop-filter: blur(var(--shui-blur));
  min-height: 400px;
}

.practice-library-open-source .hero-panel__header {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}

.practice-library-open-source .hero-panel__title {
  margin: 0;
  font-size: 1.45rem;
  font-weight: 600;
  color: var(--shui-text-strong);
}

.practice-library-open-source .hero-panel__actions {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: flex-end;
}

.practice-library-open-source .hero-nav {
  background: rgba(245, 245, 247, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.7);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04), inset 0 -1px 1px rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
}

.practice-library-open-source .hero-nav__liquid-indicator {
  border: 1px solid rgba(255, 255, 255, 0.6);
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.45), rgba(255, 255, 255, 0.05));
  box-shadow:
    inset 0 2px 3px rgba(255, 255, 255, 0.9),
    inset 0 -2px 5px rgba(255, 255, 255, 0.2),
    inset 0 0 10px rgba(255, 255, 255, 0.4),
    0 4px 12px rgba(0, 0, 0, 0.06);
}

.practice-library-open-source .hero-nav__btn {
  color: rgba(60, 60, 67, 0.7);
  background: transparent;
  box-shadow: none;
  text-shadow: none;
}

.practice-library-open-source .hero-nav__btn:hover {
  color: rgba(0, 0, 0, 0.85);
  background: rgba(255, 255, 255, 0.45);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.03), inset 0 1px 1px rgba(255, 255, 255, 0.7);
}

.practice-library-open-source .hero-nav__btn.active {
  color: #1d1d1f;
  background: transparent;
  box-shadow: none;
  text-shadow: 0 1px 2px rgba(255, 255, 255, 0.8);
}

.practice-library-open-source .category-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
}

.practice-library-open-source .overview-section-heading {
  grid-column: 1 / -1;
  margin-bottom: 0;
}

.practice-library-open-source .overview-section-title {
  margin: 0;
  font-size: var(--font-size-xl);
  font-weight: 600;
  color: var(--color-gray-800);
}

.practice-library-open-source .overview-section-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  border: none;
}

.practice-library-open-source .category-card {
  background: var(--bloom-surface);
  background-image: var(--bloom-sheen), linear-gradient(135deg, rgba(255, 255, 255, 0.95), rgba(250, 244, 236, 0.9));
  border: 1px solid var(--bloom-border);
  border-radius: var(--shui-radius-lg);
  box-shadow: 0 24px 50px rgba(15, 23, 42, 0.18);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
}

.practice-library-open-source .category-card::before {
  background: rgba(255, 255, 255, 0.3);
  box-shadow: none;
}

.practice-library-open-source .category-card::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(145deg, rgba(255, 216, 155, 0.08), rgba(106, 204, 199, 0.08));
  pointer-events: none;
  mix-blend-mode: screen;
}

.practice-library-open-source .category-card:hover {
  transform: translateY(-4px);
  border-color: rgba(255, 255, 255, 0.35);
  box-shadow: 0 35px 60px rgba(15, 23, 42, 0.25);
}

.practice-library-open-source .category-card > * {
  position: relative;
  z-index: 1;
}

.practice-library-open-source .btn,
.practice-library-open-source .hero-btn,
.practice-library-open-source .hero-panel .btn,
.practice-library-open-source .exam-item-action-btn {
  color: #0f172a;
}

.practice-library-open-source .hero-btn,
.practice-library-open-source .hero-panel .btn:not(.hero-btn) {
  border-radius: var(--shui-radius-sm);
  border: none;
  background-image: linear-gradient(135deg, var(--shui-gradient-start), var(--shui-gradient-end));
  color: #0f172a;
  padding: 10px 18px;
  font-weight: 600;
  transition: transform var(--transition-normal), box-shadow var(--transition-normal), background-image var(--transition-normal);
  box-shadow: 0 18px 35px rgba(0, 0, 0, 0.15);
}

.practice-library-open-source .hero-btn:hover,
.practice-library-open-source .hero-panel .btn:not(.hero-btn):hover,
.practice-library-open-source .hero-btn:focus-visible,
.practice-library-open-source .hero-panel .btn:not(.hero-btn):focus-visible {
  transform: translateY(-1px);
  box-shadow: 0 22px 45px rgba(0, 0, 0, 0.22);
}

.practice-library-open-source .hero-btn--ghost,
.practice-library-open-source .hero-panel .btn.btn-secondary {
  background-image: none;
  background: rgba(255, 255, 255, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.5);
  color: var(--shui-text-strong);
  box-shadow: none;
}

.practice-library-open-source .hero-btn--warn,
.practice-library-open-source .hero-panel .btn.btn-warning {
  background-image: linear-gradient(135deg, rgba(255, 216, 155, 0.85), rgba(255, 216, 155, 1));
  color: #3b1f00;
}

.practice-library-open-source .shui-glass-btn {
  position: relative;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 999px;
  color: var(--shui-text-strong);
  font-weight: 600;
  padding: 8px 20px;
  box-shadow:
    0 4px 12px rgba(0, 0, 0, 0.05),
    inset 0 1px 1px rgba(255, 255, 255, 0.8),
    inset 0 -1px 1px rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background-image: none;
  text-shadow: 0 1px 1px rgba(255, 255, 255, 0.5);
}

.practice-library-open-source .shui-glass-btn:hover,
.practice-library-open-source .shui-glass-btn:focus-visible {
  background: rgba(255, 255, 255, 0.35);
  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.1),
    inset 0 1px 2px rgba(255, 255, 255, 1),
    inset 0 -1px 1px rgba(255, 255, 255, 0.3);
  transform: translateY(-2px) scale(1.02);
  border-color: rgba(255, 255, 255, 0.65);
}

.practice-library-open-source .shui-segmented-control {
  display: inline-flex;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 999px;
  padding: 4px;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.1), 0 2px 8px rgba(0, 0, 0, 0.05);
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  gap: 2px;
  position: relative;
  isolation: isolate;
}

.practice-library-open-source .shui-segmented-indicator {
  position: absolute;
  top: 4px;
  left: 0;
  height: calc(100% - 8px);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.65);
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.12),
    inset 0 1px 1px rgba(255, 255, 255, 1),
    inset 0 -1px 1px rgba(255, 255, 255, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.8);
  transition: transform 0.4s cubic-bezier(0.25, 1, 0.3, 1), width 0.4s cubic-bezier(0.25, 1, 0.3, 1), opacity 0.2s ease;
  z-index: 0;
  pointer-events: none;
}

.practice-library-open-source .shui-segmented-btn {
  position: relative;
  z-index: 1;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 999px;
  color: var(--shui-text-muted);
  font-weight: 600;
  padding: 6px 16px;
  font-size: 0.9rem;
  cursor: pointer;
  text-shadow: 0 1px 1px rgba(255, 255, 255, 0.5);
  transition: color 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.practice-library-open-source .shui-segmented-btn:hover,
.practice-library-open-source .shui-segmented-btn.active,
.practice-library-open-source .shui-segmented-btn[aria-pressed="true"] {
  color: var(--shui-text-strong);
}

.practice-library-open-source .browse-frequency-filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  border: 1px solid rgba(255, 255, 255, 0.34);
  box-shadow: inset 0 1px 3px rgba(15, 23, 42, 0.08);
  backdrop-filter: blur(16px) saturate(160%);
  -webkit-backdrop-filter: blur(16px) saturate(160%);
}

.practice-library-open-source .browse-frequency-chip {
  min-height: 34px;
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--shui-text-muted);
  font-size: 0.88rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.22s ease, border-color 0.22s ease, color 0.22s ease, transform 0.22s ease;
}

.practice-library-open-source .browse-frequency-chip:hover,
.practice-library-open-source .browse-frequency-chip.active,
.practice-library-open-source .browse-frequency-chip[aria-pressed="true"] {
  color: var(--shui-text-strong);
  background: rgba(255, 255, 255, 0.62);
  border-color: rgba(255, 255, 255, 0.78);
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.09), inset 0 1px 1px rgba(255, 255, 255, 0.95);
}

.practice-library-open-source .browse-frequency-chip:hover {
  transform: translateY(-1px);
}

.practice-library-open-source .category-card .btn[data-action="browse-category"],
.practice-library-open-source .category-card .btn[data-action="start-random-practice"] {
  background-image: none;
  background: rgba(255, 255, 255, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.55);
  color: #0f172a;
  box-shadow: 0 18px 35px rgba(15, 23, 42, 0.12);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.practice-library-open-source .category-card .btn[data-action="browse-category"]:hover,
.practice-library-open-source .category-card .btn[data-action="start-random-practice"]:hover,
.practice-library-open-source .category-card .btn[data-action="browse-category"]:focus-visible,
.practice-library-open-source .category-card .btn[data-action="start-random-practice"]:focus-visible {
  background: rgba(255, 255, 255, 0.5);
  transform: translateY(-1px);
  box-shadow: 0 22px 45px rgba(15, 23, 42, 0.18);
}

.practice-library-open-source #browse-view .exam-item-action-btn {
  background: rgba(255, 255, 255, 0.35);
  background-image: none;
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  border: 1px solid rgba(255, 255, 255, 0.5);
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.05),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  border-radius: var(--shui-radius-sm);
  color: #1d1d1f;
  font-weight: 600;
  padding: 8px 16px;
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
  transform: translateY(0) scale(1);
}

.practice-library-open-source #browse-view .exam-item-action-btn:hover,
.practice-library-open-source #browse-view .exam-item-action-btn:focus-visible {
  background: rgba(255, 255, 255, 0.58);
  box-shadow:
    0 8px 20px rgba(0, 0, 0, 0.07),
    inset 0 1px 0 rgba(255, 255, 255, 1);
  transform: translateY(-1px) scale(1.01);
  border-color: rgba(255, 255, 255, 0.75);
}

.practice-library-open-source #browse-view .exam-item-action-btn[data-action="start"] {
  background: linear-gradient(135deg, rgba(255, 216, 155, 0.3), rgba(106, 204, 199, 0.25));
  border-color: rgba(255, 216, 155, 0.4);
  color: #2d5a58;
}

.practice-library-open-source #browse-view .exam-item-action-btn[data-action="start"]:hover {
  background: linear-gradient(135deg, rgba(255, 216, 155, 0.5), rgba(106, 204, 199, 0.4));
  border-color: rgba(106, 204, 199, 0.5);
  box-shadow:
    0 8px 20px rgba(106, 204, 199, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 1);
}

.practice-library-open-source .hero-card {
  position: relative;
  padding: 32px;
  border-radius: var(--shui-radius-lg);
  background: var(--shui-panel-bg);
  border: 1px solid var(--shui-panel-border);
  box-shadow: var(--shui-panel-shadow);
  backdrop-filter: blur(var(--shui-blur));
  -webkit-backdrop-filter: blur(var(--shui-blur));
  overflow: hidden;
}

.practice-library-open-source .hero-card::before {
  display: none;
}

.practice-library-open-source .hero-card::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at top right, rgba(255, 255, 255, 0.65), transparent 55%);
  pointer-events: none;
}

.practice-library-open-source .hero-card__label,
.practice-library-open-source .stat-label {
  font-size: 0.95rem;
  color: var(--shui-text-muted);
  text-transform: uppercase;
}

.practice-library-open-source .hero-card__value,
.practice-library-open-source .stat-number {
  font-size: clamp(2.4rem, 4vw, 3.1rem);
  font-weight: 700;
  margin-top: 16px;
  color: var(--shui-text-strong);
}

.practice-library-open-source .practice-view__title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.practice-library-open-source .practice-summary-toggle {
  position: relative;
  width: 34px;
  height: 34px;
  border: 1px solid rgba(255, 255, 255, 0.55);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.32);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.72), 0 8px 18px rgba(15, 23, 42, 0.08);
  cursor: pointer;
  backdrop-filter: blur(16px) saturate(160%);
  -webkit-backdrop-filter: blur(16px) saturate(160%);
}

.practice-library-open-source .practice-summary-toggle__glyph {
  position: absolute;
  inset: 0;
  display: block;
}

.practice-library-open-source .practice-summary-toggle__glyph::before,
.practice-library-open-source .practice-summary-toggle__glyph::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 10px;
  height: 2px;
  border-radius: 999px;
  background: var(--shui-text-strong);
  transition: transform 0.22s ease;
}

.practice-library-open-source .practice-summary-toggle__glyph::before {
  transform: translate(-80%, -50%) rotate(45deg);
}

.practice-library-open-source .practice-summary-toggle__glyph::after {
  transform: translate(-20%, -50%) rotate(-45deg);
}

.practice-library-open-source .practice-summary-toggle[aria-expanded="false"] .practice-summary-toggle__glyph::before {
  transform: translate(-80%, -50%) rotate(-45deg);
}

.practice-library-open-source .practice-summary-toggle[aria-expanded="false"] .practice-summary-toggle__glyph::after {
  transform: translate(-20%, -50%) rotate(45deg);
}

.practice-library-open-source .practice-summary-region {
  display: block;
  margin-bottom: 24px;
}

.practice-library-open-source .practice-summary-region[hidden] {
  display: none;
}

.practice-library-open-source .practice-insights-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(320px, 0.75fr);
  gap: 18px;
  margin-bottom: 26px;
}

.practice-library-open-source .practice-trend-card,
.practice-library-open-source .practice-custom-card {
  position: relative;
  min-height: 270px;
  border-radius: var(--shui-radius-lg);
  color: var(--shui-text-strong);
  perspective: 1200px;
  outline: none;
}

.practice-library-open-source .practice-trend-card__rotor,
.practice-library-open-source .practice-custom-card__rotor {
  position: relative;
  min-height: 270px;
  border-radius: inherit;
  transition: transform 0.62s cubic-bezier(0.16, 1, 0.3, 1);
  transform-style: preserve-3d;
}

.practice-library-open-source .practice-custom-card.is-flipped .practice-custom-card__rotor {
  transform: rotateY(180deg);
}

.practice-library-open-source .practice-trend-card__face {
  min-height: 270px;
  padding: 24px;
  border-radius: inherit;
  background: rgba(255, 255, 255, 0.34);
  border: 1px solid rgba(255, 255, 255, 0.48);
  box-shadow: var(--shui-panel-shadow);
  backdrop-filter: blur(24px) saturate(155%);
  -webkit-backdrop-filter: blur(24px) saturate(155%);
}

.practice-library-open-source .practice-trend-card__face {
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
}

.practice-library-open-source .practice-trend-card:not(.practice-custom-card) .practice-trend-card__back {
  display: none;
}

.practice-library-open-source .practice-custom-card .practice-trend-card__face {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.practice-library-open-source .practice-custom-card .practice-custom-card__back {
  transform: rotateY(180deg);
}

.practice-library-open-source .practice-trend-card__header,
.practice-library-open-source .practice-trend-card__title-line {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.practice-library-open-source .practice-trend-card__eyebrow {
  margin: 0 0 6px;
  color: var(--shui-text-muted);
  font-size: 0.72rem;
  font-weight: 800;
  text-transform: uppercase;
}

.practice-library-open-source .practice-trend-card__title {
  margin: 0;
  font-size: 1.1rem;
  color: var(--shui-text-strong);
}

.practice-library-open-source .practice-trend-card__metrics {
  display: flex;
  gap: 14px;
  text-align: right;
}

.practice-library-open-source .practice-trend-card__metric-value {
  display: block;
  font-size: 1.35rem;
  font-weight: 800;
}

.practice-library-open-source .practice-trend-card__metric-label {
  color: var(--shui-text-muted);
  font-size: 0.72rem;
  font-weight: 700;
}

.practice-library-open-source .practice-trend-card__range {
  align-self: flex-start;
  white-space: nowrap;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.38);
  border: 1px solid rgba(255, 255, 255, 0.5);
  color: var(--shui-text-muted);
  font-size: 0.78rem;
  font-weight: 700;
}

.practice-library-open-source .practice-trend-chart-shell {
  position: relative;
  height: 132px;
  margin-top: 28px;
  border-radius: var(--shui-radius-md);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0.2));
  border: 1px solid rgba(255, 255, 255, 0.38);
  overflow: hidden;
}

.practice-library-open-source #practice-trend-canvas {
  display: none;
}

.practice-library-open-source .practice-trend-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--shui-text-muted);
  font-weight: 700;
}

.practice-library-open-source .practice-trend-bars {
  position: absolute;
  inset: 14px;
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.practice-library-open-source .practice-trend-bar {
  flex: 1 1 0;
  min-width: 8px;
  border-radius: 999px 999px 4px 4px;
  background: linear-gradient(180deg, rgba(106, 204, 199, 0.95), rgba(255, 216, 155, 0.78));
  box-shadow: 0 8px 18px rgba(53, 192, 161, 0.16);
}

.practice-library-open-source .practice-trend-options,
.practice-library-open-source .practice-custom-options {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 22px;
}

.practice-library-open-source .practice-trend-option,
.practice-library-open-source .practice-custom-option {
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.35);
  color: var(--shui-text-strong);
  padding: 8px 14px;
  font-weight: 700;
  cursor: pointer;
}

.practice-library-open-source .practice-trend-option.active,
.practice-library-open-source .practice-custom-option.active {
  background: linear-gradient(135deg, rgba(255, 216, 155, 0.72), rgba(106, 204, 199, 0.56));
}

.practice-library-open-source .practice-custom-card__header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.practice-library-open-source .practice-heatmap-month-controls {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.45);
}

.practice-library-open-source .practice-heatmap-month-label {
  min-width: 42px;
  text-align: center;
  font-size: 0.78rem;
  font-weight: 800;
  color: var(--shui-text-muted);
}

.practice-library-open-source .practice-custom-card__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid rgba(255, 255, 255, 0.52);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.36);
  color: var(--shui-text-strong);
  cursor: pointer;
}

.practice-library-open-source .practice-custom-widget-content {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
}

.practice-library-open-source .practice-heatmap {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
  margin-top: 20px;
}

.practice-library-open-source .practice-heatmap__cell {
  aspect-ratio: 1;
  min-width: 0;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.36);
  border: 1px solid rgba(255, 255, 255, 0.36);
}

.practice-library-open-source .practice-heatmap__cell--1,
.practice-library-open-source .practice-heatmap__legend-cell--1 {
  background: rgba(191, 237, 205, 0.9);
}

.practice-library-open-source .practice-heatmap__cell--2,
.practice-library-open-source .practice-heatmap__legend-cell--2 {
  background: rgba(130, 220, 161, 0.92);
}

.practice-library-open-source .practice-heatmap__cell--3,
.practice-library-open-source .practice-heatmap__legend-cell--3 {
  background: rgba(69, 191, 99, 0.92);
}

.practice-library-open-source .practice-heatmap__cell--4,
.practice-library-open-source .practice-heatmap__legend-cell--4 {
  background: rgba(31, 143, 70, 0.94);
}

.practice-library-open-source .practice-heatmap__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: auto;
  color: var(--shui-text-muted);
  font-size: 0.82rem;
  font-weight: 700;
}

.practice-library-open-source .practice-heatmap__legend {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.practice-library-open-source .practice-heatmap__legend-cell {
  width: 12px;
  height: 12px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.36);
  border: 1px solid rgba(255, 255, 255, 0.4);
}

.practice-library-open-source .practice-radar-chart-shell {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 160px;
  align-items: center;
  justify-content: center;
  margin-top: 18px;
  border-radius: var(--shui-radius-md);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0.2));
  border: 1px solid rgba(255, 255, 255, 0.38);
  overflow: hidden;
}

.practice-library-open-source #practice-radar-canvas {
  display: none;
}

.practice-library-open-source .practice-radar-bars {
  display: grid;
  width: 100%;
  gap: 10px;
  padding: 16px;
}

.practice-library-open-source .practice-radar-bar {
  display: grid;
  grid-template-columns: minmax(80px, 0.8fr) minmax(0, 1fr) 28px;
  align-items: center;
  gap: 8px;
  font-size: 0.78rem;
  font-weight: 800;
  color: var(--shui-text-muted);
}

.practice-library-open-source .practice-radar-bar__track {
  height: 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.42);
  overflow: hidden;
}

.practice-library-open-source .practice-radar-bar__fill {
  display: block;
  width: max(8px, var(--radar-value));
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, rgba(255, 216, 155, 0.94), rgba(106, 204, 199, 0.86));
}

.practice-library-open-source .practice-radar-summary {
  margin: 10px 0 0;
  color: var(--shui-text-muted);
  font-size: 0.82rem;
  font-weight: 700;
  text-align: center;
}

.practice-library-open-source .priority-progress-stack {
  display: grid;
  gap: 16px;
  margin-top: 28px;
}

.practice-library-open-source .priority-progress__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  color: var(--shui-text-strong);
  font-weight: 800;
}

.practice-library-open-source .priority-progress__track {
  height: 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.44);
  border: 1px solid rgba(255, 255, 255, 0.45);
  overflow: hidden;
}

.practice-library-open-source .priority-progress__fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, rgba(255, 216, 155, 0.94), rgba(106, 204, 199, 0.86));
  transition: width 0.28s ease;
}

.practice-library-open-source .priority-accuracy {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 24px;
}

.practice-library-open-source .priority-accuracy__orb {
  min-height: 88px;
  display: grid;
  place-items: center;
  padding: 14px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.32);
  border: 1px solid rgba(255, 255, 255, 0.48);
  text-align: center;
}

.practice-library-open-source .priority-accuracy__orb span {
  display: block;
  font-size: 1.3rem;
  font-weight: 800;
}

.practice-library-open-source .priority-accuracy__orb small {
  color: var(--shui-text-muted);
  font-weight: 700;
}

.practice-library-open-source .practice-history.hero-panel {
  background: var(--shui-panel-bg);
  border: 1px solid var(--shui-panel-border);
  border-radius: var(--shui-radius-xl);
  box-shadow: var(--shui-panel-shadow);
  backdrop-filter: blur(var(--shui-blur));
  -webkit-backdrop-filter: blur(var(--shui-blur));
}

.practice-library-open-source .practice-history-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  padding: 8px;
}

.practice-library-open-source .history-item {
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  padding: 16px 24px;
  border-radius: var(--shui-radius-md);
  background: rgba(255, 255, 255, 0.58);
  border: 1px solid rgba(255, 255, 255, 0.48);
  box-shadow:
    0 12px 24px rgba(15, 23, 42, 0.08),
    inset 0 1px 1px rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.practice-library-open-source .history-item:hover {
  transform: translateY(-1px);
  box-shadow:
    0 18px 30px rgba(15, 23, 42, 0.12),
    inset 0 1px 1px rgba(255, 255, 255, 0.85);
}

.practice-library-open-source .suite-mode-selector-modal {
  z-index: 9999;
}

.practice-library-open-source .suite-mode-selector-content {
  width: min(420px, 92vw);
  border-radius: 16px;
}

.practice-library-open-source .suite-mode-selector-subtitle {
  margin: 6px 0 0;
  color: var(--shui-text-muted);
  font-size: 0.9rem;
  line-height: 1.55;
}

.practice-library-open-source .suite-mode-selector-body {
  display: grid;
  gap: 18px;
}

.practice-library-open-source .suite-flow-options {
  display: grid;
  gap: 10px;
}

.practice-library-open-source .suite-flow-option {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 14px 16px;
  border: 2px solid transparent;
  border-radius: 12px;
  background: rgba(248, 250, 252, 0.82);
  color: var(--shui-text-strong);
  text-align: left;
  font-weight: 700;
  cursor: pointer;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease, transform 0.2s ease;
}

.practice-library-open-source .suite-flow-option small {
  color: var(--shui-text-muted);
  font-size: 0.78rem;
  font-weight: 500;
}

.practice-library-open-source .suite-flow-option:hover,
.practice-library-open-source .suite-flow-option:focus-visible {
  transform: translateY(-1px);
  background: rgba(255, 255, 255, 0.92);
}

.practice-library-open-source .suite-flow-option.active,
.practice-library-open-source .suite-flow-option[aria-pressed="true"] {
  border-color: rgba(102, 126, 234, 0.78);
  background: rgba(102, 126, 234, 0.1);
  box-shadow: 0 0 0 1px rgba(102, 126, 234, 0.58);
}

.practice-library-open-source .suite-frequency-selector {
  display: grid;
  gap: 8px;
  color: var(--shui-text-strong);
  font-size: 0.86rem;
  font-weight: 800;
}

.practice-library-open-source .suite-frequency-select {
  width: 100%;
  min-height: 44px;
  appearance: none;
  border: 1px solid rgba(148, 163, 184, 0.5);
  border-radius: 10px;
  padding: 0 14px;
  background: rgba(255, 255, 255, 0.86);
  color: var(--shui-text-strong);
  font: inherit;
}

.practice-library-open-source .suite-mode-selector-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

.practice-library-open-source .hero-surface,
.practice-library-open-source .app-update-details-row {
  background: var(--shui-surface-bg);
  border-radius: var(--shui-radius-lg);
  border: 1px solid var(--shui-surface-border);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
}

.practice-library-open-source #settings-view {
  margin-top: 20px;
}

.practice-library-open-source #settings-view .hero-settings-group {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 20px;
}

.practice-library-open-source #settings-view .hero-panel {
  position: relative;
  overflow: hidden;
  padding: 32px;
  border-radius: var(--shui-radius-lg);
  border: 1px solid var(--shui-panel-border);
  background: var(--shui-panel-bg);
  box-shadow: var(--shui-panel-shadow);
  backdrop-filter: blur(var(--shui-blur)) saturate(150%);
  -webkit-backdrop-filter: blur(var(--shui-blur)) saturate(150%);
  transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1), box-shadow 0.3s ease, border-color 0.3s ease;
}

.practice-library-open-source #settings-view .hero-panel:hover {
  transform: translateY(-4px);
  border-color: rgba(255, 255, 255, 0.7);
  box-shadow:
    0 30px 60px rgba(0, 0, 0, 0.12),
    inset 0 0 0 1px rgba(255, 255, 255, 0.6);
}

.practice-library-open-source #settings-view .hero-panel::before {
  content: '';
  position: absolute;
  inset: 0;
  padding: 1px;
  border-radius: inherit;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.8), rgba(255, 255, 255, 0));
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
}

.practice-library-open-source #settings-view .hero-panel > * {
  position: relative;
  z-index: 1;
}

.practice-library-open-source #settings-view h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 0.5rem;
  color: var(--bauhaus-text-main);
  font-size: 1.25rem;
  font-weight: 700;
}

.practice-library-open-source #settings-view .hero-panel__muted {
  margin: 0 0 24px;
  color: var(--bauhaus-text-muted);
  font-size: 0.9rem;
}

.practice-library-open-source #settings-view .hero-settings-actions {
  display: flex;
  flex-flow: row wrap;
  gap: 12px;
  margin-top: 8px;
}

.practice-library-open-source #settings-view .hero-settings-actions .btn {
  flex: 1 1 auto;
  min-width: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.practice-library-open-source #settings-view .btn {
  position: relative;
  z-index: 1;
  overflow: hidden;
  padding: 10px 24px;
  border: none;
  border-radius: 999px;
  font-size: 0.9rem;
  font-weight: 600;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.practice-library-open-source #settings-view .btn::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, rgba(255, 255, 255, 0.2), transparent);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.practice-library-open-source #settings-view .btn:hover {
  transform: translateY(-3px) scale(1.02);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.15);
}

.practice-library-open-source #settings-view .btn:hover::after {
  opacity: 1;
}

.practice-library-open-source #settings-view #clear-cache-btn {
  color: var(--bauhaus-accent-red);
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(220, 38, 38, 0.2);
}

.practice-library-open-source #settings-view #clear-cache-btn:hover {
  color: #fff;
  background: var(--bauhaus-accent-red);
  border-color: transparent;
  box-shadow: 0 12px 24px rgba(220, 38, 38, 0.3);
}

.practice-library-open-source #settings-view #load-library-btn,
.practice-library-open-source #settings-view #library-config-btn,
.practice-library-open-source #settings-view #force-refresh-btn,
.practice-library-open-source #settings-view #theme-switcher-btn-entry,
.practice-library-open-source #settings-view #show-onboarding-btn {
  color: var(--bauhaus-text-main);
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(15, 23, 42, 0.15);
}

.practice-library-open-source #settings-view #load-library-btn:hover,
.practice-library-open-source #settings-view #library-config-btn:hover,
.practice-library-open-source #settings-view #force-refresh-btn:hover,
.practice-library-open-source #settings-view #theme-switcher-btn-entry:hover,
.practice-library-open-source #settings-view #show-onboarding-btn:hover {
  color: #fff;
  background: var(--bauhaus-accent-blue);
  border-color: transparent;
  box-shadow: 0 12px 24px rgba(37, 99, 235, 0.3);
}

.practice-library-open-source #settings-view .data-mgmt-btn {
  color: var(--bauhaus-accent-dark);
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(15, 23, 42, 0.15);
}

.practice-library-open-source #settings-view .data-mgmt-btn:hover {
  color: #fff;
  background: var(--bauhaus-accent-dark);
  border-color: transparent;
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.25);
}

.practice-library-open-source #settings-view .settings-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.practice-library-open-source #settings-view .system-info-surface {
  display: grid;
  gap: 4px;
  margin-top: 15px;
  padding: 16px;
  line-height: 1.8;
  font-weight: 700;
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.6);
  border-radius: 12px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.practice-library-open-source #settings-view .system-info-status {
  color: var(--color-success);
}

.practice-library-open-source #settings-view .legacy-team-links {
  display: block;
  margin-top: 30px;
  padding-top: 20px;
  text-align: center;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
}

.practice-library-open-source #settings-view .legacy-team-links a {
  display: block;
  text-decoration: none;
  font-size: 0.9em;
  transition: opacity 0.2s, color 0.3s ease;
}

.practice-library-open-source #settings-view .hero-settings-links__feedback {
  margin-bottom: 12px;
  color: #ff1c1c;
  font-weight: 700;
}

.practice-library-open-source #settings-view .hero-settings-links__github {
  color: gray;
}

.practice-library-open-source .backup-list-container {
  width: 100%;
  max-width: 1080px;
  margin: 28px auto 0;
}

.practice-library-open-source .backup-list-card {
  width: 100%;
  padding: 24px;
  color: var(--shui-text-strong);
  background: var(--shui-panel-bg);
  border: 1px solid var(--shui-panel-border);
  border-radius: var(--shui-radius-lg);
  box-shadow: var(--shui-panel-shadow);
  backdrop-filter: blur(var(--shui-blur)) saturate(150%);
  -webkit-backdrop-filter: blur(var(--shui-blur)) saturate(150%);
}

.practice-library-open-source .backup-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.practice-library-open-source .backup-list-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  color: var(--bauhaus-text-main);
  font-size: 1.18rem;
  font-weight: 800;
}

.practice-library-open-source .backup-list-title-icon {
  font-size: 1.45rem;
}

.practice-library-open-source .backup-list-scroll {
  max-height: 640px;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 14px;
}

.practice-library-open-source .backup-entry {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border-radius: var(--shui-radius-md);
  background: rgba(255, 255, 255, 0.58);
  border: 1px solid rgba(255, 255, 255, 0.48);
  box-shadow:
    0 12px 24px rgba(15, 23, 42, 0.08),
    inset 0 1px 1px rgba(255, 255, 255, 0.7);
  transition: transform 0.24s ease, box-shadow 0.24s ease, background 0.24s ease;
}

.practice-library-open-source .backup-entry:hover {
  transform: translateY(-1px);
  background: rgba(255, 255, 255, 0.68);
  box-shadow:
    0 18px 30px rgba(15, 23, 42, 0.12),
    inset 0 1px 1px rgba(255, 255, 255, 0.85);
}

.practice-library-open-source .backup-entry-info {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.practice-library-open-source .backup-entry-id {
  color: var(--bauhaus-text-main);
  word-break: break-word;
}

.practice-library-open-source .backup-entry-meta {
  color: var(--bauhaus-text-muted);
  font-size: 0.86rem;
  font-weight: 700;
}

.practice-library-open-source .backup-entry-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.practice-library-open-source .backup-list-empty {
  grid-column: 1 / -1;
  text-align: center;
  padding: 28px 18px;
  color: var(--bauhaus-text-main);
  background: rgba(255, 255, 255, 0.5);
  border: 1px dashed rgba(255, 255, 255, 0.62);
  border-radius: var(--shui-radius-md);
}

.practice-library-open-source .backup-list-empty-icon {
  font-size: 2rem;
  margin-bottom: 8px;
}

.practice-library-open-source .backup-list-empty-text,
.practice-library-open-source .backup-list-empty-hint {
  margin: 4px 0 0;
}

.practice-library-open-source .backup-list-empty-hint {
  color: var(--bauhaus-text-muted);
  font-size: 0.88rem;
}

.practice-library-open-source .reading-library-config-scroll {
  grid-template-columns: 1fr;
}

.practice-library-open-source #more-view .tool-card {
  border-radius: var(--shui-radius-lg);
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.28);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  box-shadow: 0 22px 44px rgba(0, 0, 0, 0.18);
  transition: transform var(--transition-normal), box-shadow var(--transition-normal), background var(--transition-normal);
  color: var(--shui-text-strong);
}

.practice-library-open-source #more-view .tool-card:hover,
.practice-library-open-source #more-view .tool-card:focus-visible {
  transform: translateY(-2px);
  box-shadow: 0 28px 52px rgba(0, 0, 0, 0.22);
  background: rgba(255, 255, 255, 0.38);
}

@media (max-width: 900px) {
  .practice-library-open-source .hero-nav {
    flex-direction: column;
  }

  .practice-library-open-source .category-grid,
  .practice-library-open-source .practice-history-list {
    grid-template-columns: 1fr;
  }

  .practice-library-open-source .overview-section-heading,
  .practice-library-open-source .browse-title-bar,
  .practice-library-open-source .hero-panel__header,
  .practice-library-open-source .search-row {
    align-items: stretch;
    flex-direction: column;
  }

  .practice-library-open-source #type-filter-buttons {
    margin-left: 0;
  }

  .practice-library-open-source .hero-panel__actions {
    width: 100%;
    justify-content: flex-start;
  }

  .practice-library-open-source #settings-view .hero-settings-group {
    grid-template-columns: 1fr;
  }

  .practice-library-open-source .history-item {
    grid-template-columns: auto minmax(0, 1fr);
  }
}
</style>
