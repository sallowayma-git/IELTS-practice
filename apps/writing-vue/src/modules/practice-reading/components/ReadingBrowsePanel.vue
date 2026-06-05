<template>
  <div id="browse-view" :class="['view', 'hero-panel', 'hero-section', { active: activeView === 'browse' }]" data-reading-browse>
    <div class="browse-title-bar hero-panel__header">
      <button
        class="browse-title-trigger"
        id="browse-title-trigger"
        type="button"
        aria-haspopup="true"
        :aria-expanded="browsePreferencePanelOpen ? 'true' : 'false'"
        title="列表偏好"
        @click="$emit('toggle-browse-preference', $event)"
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
            :checked="browseRememberPosition"
            type="checkbox"
            @change="handleBrowseRememberPositionChange"
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
          :hidden="filter.hidden ? true : null"
          :data-filter-type="filter.value"
          data-index-action="filter-exams"
          :data-action-value="filter.value"
          data-action="filter-exam-type"
          @click="$emit('filter-by-type', filter.value)"
        >
          {{ filter.label }}
        </button>
      </div>
    </div>

    <div class="search-box">
      <div class="search-row">
        <div class="search-input-wrap">
          <input
            :value="keyword"
            type="text"
            class="search-input"
            id="exam-search-input"
            placeholder="搜索题目..."
            aria-label="搜索题目"
            data-index-action="search-exams"
            data-input-action="search-exams"
            data-input-event="keyup"
            @input="$emit('update:keyword', $event.target.value)"
          >
          <button
            type="button"
            class="search-clear-btn"
            id="search-clear-btn"
            aria-label="清除搜索"
            :hidden="!keyword"
            data-index-action="clear-search"
            data-action="clear-exam-search"
            @click="$emit('clear-search', $event)"
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
            @click="$emit('toggle-frequency-filter', filter.value)"
          >
            {{ filter.label }}
          </button>
        </div>
        <div class="browse-sort-wrapper">
          <select
            :value="sortMode"
            id="browse-sort-select"
            class="browse-sort-select"
            aria-label="题库排序"
            @change="$emit('update:sortMode', $event.target.value)"
          >
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
      <button class="btn-text" type="button" @click="$emit('retry-load', $event)">重试</button>
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
          <button class="btn btn-secondary exam-list-empty-action" type="button" @click="$emit('clear-search', $event)">清除搜索</button>
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
              @click="$emit('browse-primary-action', asset)"
            >
              {{ customSuiteDraft ? '选择此题' : '开始练习' }}
            </button>
            <button
              class="btn btn-outline exam-item-action-btn"
              type="button"
              data-action="pdf"
              :data-exam-id="asset.id"
              :aria-label="`查看PDF ${asset.title}`"
              @click="$emit('view-pdf', asset)"
            >
              PDF
            </button>
          </div>
        </div>
      </div>
      <div
        v-if="customSuiteDraft"
        id="custom-suite-selection-bar"
        class="custom-suite-selection-bar"
        data-custom-suite-selection
      >
        <div class="custom-suite-selection-main">
          <strong>套题自选</strong>
          <span>请选择 {{ customSuiteCurrentCategory }} 阅读题目</span>
        </div>
        <div class="custom-suite-picked-list" aria-label="已选择套题">
          <span
            v-for="category in customSuiteCategories"
            :key="category"
            class="custom-suite-picked-chip"
            :class="{ filled: Boolean(customSuitePickedByCategory[category]) }"
            :data-custom-suite-category="category"
          >
            {{ category }} · {{ customSuitePickedByCategory[category]?.title || '待选' }}
          </span>
        </div>
        <div class="custom-suite-selection-actions">
          <button
            class="btn btn-primary"
            type="button"
            data-custom-suite-confirm
            :disabled="!customSuiteReady || creatingSuite"
            @click="$emit('confirm-custom-suite-selection', $event)"
          >
            确认套题
          </button>
          <button
            class="btn btn-secondary"
            type="button"
            data-custom-suite-cancel
            :disabled="creatingSuite"
            @click="$emit('cancel-custom-suite-selection', $event)"
          >
            取消自选
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  activeView: { type: String, required: true },
  browsePreferencePanelOpen: { type: Boolean, default: false },
  browseRememberPosition: { type: Boolean, default: true },
  browseTitle: { type: String, required: true },
  typeFilters: { type: Array, required: true },
  selectedType: { type: String, required: true },
  keyword: { type: String, default: '' },
  frequencyFilters: { type: Array, required: true },
  frequencyFilter: { type: String, required: true },
  sortMode: { type: String, required: true },
  error: { type: String, default: '' },
  suiteError: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  filteredReadingAssets: { type: Array, required: true },
  customSuiteDraft: { type: Object, default: null },
  customSuiteCurrentCategory: { type: String, required: true },
  customSuiteCategories: { type: Array, required: true },
  customSuitePickedByCategory: { type: Object, required: true },
  customSuiteReady: { type: Boolean, default: false },
  creatingSuite: { type: Boolean, default: false },
  icons: { type: Object, required: true },
  formatExamMetaText: { type: Function, required: true }
})

const emit = defineEmits([
  'update:browseRememberPosition',
  'update:keyword',
  'update:sortMode',
  'toggle-browse-preference',
  'persist-browse-preference',
  'filter-by-type',
  'clear-search',
  'toggle-frequency-filter',
  'retry-load',
  'browse-primary-action',
  'view-pdf',
  'confirm-custom-suite-selection',
  'cancel-custom-suite-selection'
])

function handleBrowseRememberPositionChange(event) {
  emit('update:browseRememberPosition', Boolean(event?.target?.checked))
  emit('persist-browse-preference', event)
}
</script>
