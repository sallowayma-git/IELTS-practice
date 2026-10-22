<template>
  <div id="browse-view" :class="['view', 'hero-section', { active: activeView === 'browse' }]" data-reading-browse>
    <div class="toolbar is-sticky browse-toolbar">
    <div class="browse-title-bar hero-panel__header">
      <button
        class="btn btn-ghost btn-icon browse-title-trigger"
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
      <div id="type-filter-buttons" class="hero-panel__actions shui-filter-group shui-segmented-control segmented">
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

    <div v-if="questionKindLabel" class="browse-question-kind" data-reading-question-kind>
      <span>题型：{{ questionKindLabel }}</span>
      <button class="btn btn-ghost btn-sm" type="button" @click="$emit('clear-question-kind')">
        清除题型筛选
      </button>
    </div>

    <div class="search-box">
      <div class="search-row">
        <div class="search-input-wrap">
          <svg class="search-leading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7"></circle>
            <path d="m20 20-4-4"></path>
          </svg>
          <input
            :value="keyword"
            type="text"
            class="input search-input"
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
          class="browse-frequency-filter segmented"
          id="browse-frequency-filter-buttons"
          aria-label="频率筛选"
        >
          <button
            v-for="filter in frequencyFilters"
            :key="filter.value"
            class="segmented-item browse-frequency-chip"
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
            class="select browse-sort-select"
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

    </div>

    <div class="browse-body">
    <MascotState v-if="error" kind="error" :title="error">
      <div class="empty-state-action">
        <button class="btn btn-secondary btn-sm" type="button" @click="$emit('retry-load', $event)">重试</button>
      </div>
    </MascotState>
    <div v-if="suiteError" class="inline-message inline-message-error" data-reading-suite-error>{{ suiteError }}</div>
    <div id="exam-list-container" class="scroll-region">
      <div v-if="loading" class="loading">
        <div class="spinner"></div>
        <p>正在加载题目列表...</p>
      </div>
      <MascotState
        v-else-if="filteredReadingAssets.length === 0"
        :kind="keyword ? 'no-results' : 'empty'"
        class="exam-list-empty"
        title="未找到匹配的题目"
        desc="请调整筛选条件或搜索词后再试"
      >
        <div v-if="keyword" class="empty-state-action exam-list-empty-actions">
          <button class="btn btn-secondary exam-list-empty-action" type="button" @click="$emit('clear-search', $event)">清除搜索</button>
        </div>
      </MascotState>
      <div v-else class="exam-list reading-card-grid">
        <article
          v-for="asset in filteredReadingAssets"
          :key="asset.id"
          class="reading-card exam-item"
          :data-exam-id="asset.id"
          :data-reading-asset-id="asset.id"
        >
          <div class="reading-card__body">
            <div class="reading-card__tags">
              <span class="tag tag-neutral">{{ categoryOf(asset) }}</span>
              <span
                v-if="frequencyTagOf(asset)"
                class="tag"
                :class="frequencyTagOf(asset).cls"
              >{{ frequencyTagOf(asset).label }}</span>
              <span v-if="asset.pdfOnly" class="tag tag-info">PDF</span>
            </div>
            <h4 class="reading-card__title">{{ asset.title }}</h4>
            <div v-if="questionKindTags(asset).length" class="reading-card__kinds">
              <span
                v-for="kind in questionKindTags(asset)"
                :key="kind.key"
                class="reading-card__kind"
              >{{ kind.label }}</span>
            </div>
          </div>
          <footer class="reading-card__footer">
            <button
              v-if="asset.pdfOnly && !customSuiteDraft"
              class="btn btn-primary btn-sm"
              type="button"
              data-action="pdf"
              :data-exam-id="asset.id"
              :aria-label="`查看PDF ${asset.title}`"
              @click="$emit('view-pdf', asset)"
            >
              查看 PDF
            </button>
            <template v-else>
              <button
                v-if="asset.pdfOnly"
                class="btn btn-ghost btn-sm"
                type="button"
                data-action="pdf"
                :data-exam-id="asset.id"
                :aria-label="`查看PDF ${asset.title}`"
                @click="$emit('view-pdf', asset)"
              >
                PDF
              </button>
              <button
                class="btn btn-primary btn-sm"
                type="button"
                data-action="start"
                :data-exam-id="asset.id"
                :aria-label="`${customSuiteDraft ? '选择' : '开始练习'} ${asset.title}`"
                @click="$emit('browse-primary-action', asset)"
              >
                {{ customSuiteDraft ? '选择此题' : '开始练习' }}
              </button>
            </template>
          </footer>
        </article>
      </div>
      <div
        v-if="customSuiteDraft"
        id="custom-suite-selection-bar"
        class="card custom-suite-selection-bar"
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
            class="btn btn-primary btn-lg"
            type="button"
            data-custom-suite-confirm
            :disabled="!customSuiteReady || creatingSuite"
            @click="$emit('confirm-custom-suite-selection', $event)"
          >
            确认套题
          </button>
          <button
            class="btn btn-secondary btn-lg"
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
  </div>
</template>

<script setup>
import MascotState from '@/components/mascot/MascotState.vue'
import { normalizeCategory, normalizeFrequency } from '../browseFilters.js'
import { questionKindTags } from '../readingTags.js'

defineProps({
  activeView: { type: String, required: true },
  browsePreferencePanelOpen: { type: Boolean, default: false },
  browseRememberPosition: { type: Boolean, default: true },
  browseTitle: { type: String, required: true },
  typeFilters: { type: Array, required: true },
  selectedType: { type: String, required: true },
  questionKindLabel: { type: String, default: '' },
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
  icons: { type: Object, required: true }
})

const FREQUENCY_TAGS = {
  high: { label: '高频', cls: 'tag-accent' },
  medium: { label: '次高频', cls: 'tag-neutral' },
  low: { label: '低频', cls: 'tag-neutral' }
}

function categoryOf(asset) {
  return normalizeCategory(asset?.category)
}

function frequencyTagOf(asset) {
  return FREQUENCY_TAGS[normalizeFrequency(asset)] || null
}

const emit = defineEmits([
  'update:browseRememberPosition',
  'update:keyword',
  'update:sortMode',
  'toggle-browse-preference',
  'persist-browse-preference',
  'filter-by-type',
  'clear-question-kind',
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

<style scoped>
.browse-question-kind {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--anth-space-2);
  color: var(--anth-ink-muted);
}

/* Browse cards mirror the writing topic cards (TopicManagePage .topic-card). */
.reading-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr));
  gap: var(--anth-space-4);
}

.reading-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--anth-card-border);
  border-radius: var(--anth-radius-card);
  background: var(--anth-surface-raised);
  box-shadow: var(--anth-shadow-1);
  transition: transform var(--anth-duration-fast) var(--anth-ease), box-shadow var(--anth-duration-fast) var(--anth-ease);
}

@media (hover: hover) and (pointer: fine) {
  .reading-card:hover { transform: translateY(-2px); box-shadow: var(--anth-shadow-2); }
}

.reading-card__body {
  display: grid;
  flex: 1 1 auto;
  align-content: start;
  gap: var(--anth-space-3);
  min-width: 0;
  padding: var(--anth-space-4) var(--anth-space-4) var(--anth-space-3);
}

.reading-card__tags { display: flex; flex-wrap: wrap; gap: var(--anth-space-1); min-width: 0; }

/* Serif prose, two lines at most; the title is the only thing that grows. */
.reading-card__title {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--anth-ink);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-body-lg-size);
  font-weight: var(--anth-weight-medium);
  line-height: var(--anth-text-body-lg-line);
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.reading-card__kinds { display: flex; flex-wrap: wrap; gap: var(--anth-space-1); min-width: 0; }

.reading-card__kind {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 var(--anth-space-2);
  border: 1px solid var(--anth-rule-strong);
  border-radius: var(--anth-radius-xs);
  color: var(--anth-ink-muted);
  font-size: var(--anth-text-tag-size);
  line-height: 1;
  white-space: nowrap;
}

.reading-card__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--anth-space-2) var(--anth-space-3);
  margin-top: auto;
  padding: var(--anth-space-3) var(--anth-space-4);
  border-top: 1px solid var(--anth-rule);
}

/* PDF stays a quiet secondary action next to the primary select/start button. */
.reading-card__footer .btn-ghost { color: var(--anth-ink-muted); }
</style>
