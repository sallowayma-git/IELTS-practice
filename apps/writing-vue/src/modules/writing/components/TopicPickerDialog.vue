<template>
  <div class="dialog-overlay" @click.self="emit('close')" @keydown.esc="emit('close')">
    <div
      ref="dialogRef"
      class="dialog dialog-lg picker-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="topic-picker-title"
      tabindex="-1"
    >
      <header class="dialog-header">
        <div class="picker-heading">
          <p class="page-header-kicker">{{ taskLabel }} · 题库</p>
          <h3 id="topic-picker-title">选择题目</h3>
        </div>
        <button class="btn btn-ghost btn-sm btn-icon" type="button" aria-label="关闭" @click="emit('close')">✕</button>
      </header>

      <div class="dialog-body picker-body">
        <div class="picker-filters" role="search" aria-label="题目筛选">
          <input
            v-model="query"
            class="input"
            type="search"
            placeholder="搜索题目关键词"
            aria-label="搜索题目"
            @keydown.enter.prevent="focusFirstCard"
          />
          <select v-model="categoryModel" class="select" aria-label="题目分类">
            <option value="">全部分类</option>
            <option v-for="option in categoryOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>

        <p v-if="!loading && !error && topics.length" class="picker-count">
          共 <span class="t-num">{{ visibleTopics.length }}</span> 道题目
        </p>

        <p v-if="loading" class="picker-status" role="status">数据同步中...</p>
        <div v-else-if="error" class="inline-message inline-message-error" role="alert">{{ error }}</div>
        <MascotState v-else-if="topics.length === 0" kind="empty" title="当前分类下暂无题目" desc="换个分类试试。" />
        <MascotState
          v-else-if="visibleTopics.length === 0"
          kind="no-results"
          title="没有匹配的题目"
          desc="换个关键词或分类再试。"
        />

        <div v-else ref="gridRef" class="picker-grid" @keydown="onGridKeydown">
          <button
            v-for="topic in visibleTopics"
            :key="topic.id"
            type="button"
            :class="['picker-card', { 'is-selected': isSelected(topic) }]"
            :aria-pressed="isSelected(topic) ? 'true' : 'false'"
            @click="emit('select', topic)"
          >
            <span class="picker-card__main">
              <span v-if="thumbOf(topic)" class="picker-thumb">
                <img :src="thumbOf(topic)" loading="lazy" alt="" />
              </span>
              <span class="picker-card__body">
                <span class="picker-card__top">
                  <span class="picker-tags">
                    <span :class="['tag', topic.type === 'task1' ? 'tag-accent' : 'tag-info']">
                      {{ topic.type === 'task1' ? 'Task 1' : 'Task 2' }}
                    </span>
                    <span class="tag tag-neutral">{{ categoryLabel(topic.category) }}</span>
                  </span>
                  <span class="picker-dots" role="img" :aria-label="`难度 ${topic.difficulty || 0}/5`">
                    <span
                      v-for="dot in 5"
                      :key="dot"
                      :class="['picker-dot', { 'is-filled': dot <= (topic.difficulty || 0) }]"
                    ></span>
                  </span>
                </span>
                <span class="picker-title">{{ titleOf(topic) }}</span>
              </span>
            </span>
            <span class="picker-card__footer">
              <span class="t-num">练过 {{ topic.usage_count || 0 }} 次</span>
              <span v-if="isSelected(topic)" class="tag tag-accent">当前</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import MascotState from '@/components/mascot/MascotState.vue'
import { extractTextFromTiptap } from '@/utils/tiptap-text.js'
import { getWritingCategoryLabel } from '@/utils/writing-categories.js'

const SAFE_IMAGE_PATTERN = /^data:image\/(?:png|jpeg|jpg|webp);base64,/i
const ARROW_KEYS = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp']

const props = defineProps({
  topics: { type: Array, default: () => [] },
  taskType: { type: String, default: 'task2' },
  category: { type: String, default: '' },
  categoryOptions: { type: Array, default: () => [] },
  selectedTopicId: { type: [String, Number], default: null },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' }
})

const emit = defineEmits(['select', 'close', 'update:category'])

const query = ref('')
const dialogRef = ref(null)
const gridRef = ref(null)
let returnFocusTo = null

const taskLabel = computed(() => (props.taskType === 'task1' ? 'Task 1' : 'Task 2'))

const categoryModel = computed({
  get: () => props.category,
  set: (value) => emit('update:category', value)
})

const visibleTopics = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return props.topics
  return props.topics.filter((topic) => matchesQuery(topic, needle))
})

function titleOf(topic) {
  return extractTextFromTiptap(topic.title_json)
}

function categoryLabel(category) {
  return getWritingCategoryLabel(category)
}

function matchesQuery(topic, needle) {
  return `${titleOf(topic)} ${categoryLabel(topic.category)}`.toLowerCase().includes(needle)
}

function isSelected(topic) {
  return props.selectedTopicId !== null && String(topic.id) === String(props.selectedTopicId)
}

// Task 1 cards show the chart only when it is a safe inline data URL.
function thumbOf(topic) {
  if (topic.type !== 'task1') return null
  const image = String(topic.image_path || topic.image_url || '').trim()
  return SAFE_IMAGE_PATTERN.test(image) ? image : null
}

function cardList() {
  return [...(gridRef.value?.querySelectorAll('.picker-card') || [])]
}

function focusFirstCard() {
  cardList()[0]?.focus()
}

function columnCount(cards) {
  const rowTop = cards[0].offsetTop
  const rowBreak = cards.findIndex((card) => card.offsetTop !== rowTop)
  return rowBreak === -1 ? cards.length : rowBreak
}

function stepIndex(key, index, cards) {
  if (key === 'ArrowRight') return index + 1
  if (key === 'ArrowLeft') return index - 1
  const columns = columnCount(cards)
  return key === 'ArrowDown' ? index + columns : index - columns
}

function onGridKeydown(event) {
  if (!ARROW_KEYS.includes(event.key)) return
  const cards = cardList()
  const index = cards.indexOf(event.target)
  if (index === -1) return
  event.preventDefault()
  const target = Math.min(Math.max(stepIndex(event.key, index, cards), 0), cards.length - 1)
  cards[target].focus()
}

onMounted(() => {
  returnFocusTo = document.activeElement
  dialogRef.value?.focus()
})

onBeforeUnmount(() => {
  returnFocusTo?.focus?.()
})
</script>

<style scoped>
/* Topic picker: search and category filter on top, a scrolling grid of practice cards below. */
.picker-dialog { outline: none; }
.picker-dialog .dialog-header { padding: var(--anth-space-5) var(--anth-space-6) var(--anth-space-3); }
.picker-dialog .picker-body { display: grid; align-content: start; gap: var(--anth-space-4); padding: 0 var(--anth-space-6) var(--anth-space-6); }

.picker-heading { display: grid; gap: 2px; min-width: 0; }
.picker-heading h3 { margin: 0; }

.picker-filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 200px);
  gap: var(--anth-space-2);
}

.picker-count { margin: 0; color: var(--anth-ink-muted); font-size: var(--anth-text-small-size); }
.picker-status { margin: 0; color: var(--anth-ink-muted); font-size: var(--anth-text-small-size); }

.picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr));
  gap: var(--anth-space-3);
}

/* Same card family as the topic bank: raised surface, 12px radius, quiet shadow. */
.picker-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--anth-card-border);
  border-radius: var(--anth-radius-card);
  background: var(--anth-surface-raised);
  box-shadow: var(--anth-shadow-1);
  color: var(--anth-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color var(--anth-duration-fast) var(--anth-ease), box-shadow var(--anth-duration-fast) var(--anth-ease);
}

.picker-card:hover { border-color: var(--anth-rule-hover-strong); box-shadow: var(--anth-shadow-2); }
.picker-card:focus-visible,
.picker-card.is-selected { outline: none; border-color: var(--anth-accent); box-shadow: var(--anth-halo-accent); }

.picker-card__main { display: flex; flex: 1 1 auto; min-height: 112px; min-width: 0; }

.picker-thumb {
  flex: 0 0 96px;
  width: 96px;
  height: 96px;
  margin: var(--anth-space-4) 0 0 var(--anth-space-4);
  overflow: hidden;
  border: 1px solid var(--anth-rule);
  border-radius: var(--anth-radius-sm);
  background: var(--anth-surface-sunken);
}

.picker-thumb img { display: block; width: 100%; height: 100%; object-fit: cover; }

.picker-card__body {
  display: grid;
  flex: 1 1 auto;
  align-content: start;
  gap: var(--anth-space-2);
  min-width: 0;
  padding: var(--anth-space-4);
}

.picker-card__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--anth-space-2);
  min-width: 0;
}

.picker-tags { display: flex; flex-wrap: wrap; gap: var(--anth-space-1); min-width: 0; }

.picker-dots { display: inline-flex; flex-shrink: 0; gap: 3px; padding-top: 6px; }
.picker-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--anth-rule-strong); }
.picker-dot.is-filled { background: var(--anth-accent); }

/* Serif prompt, three lines at most. */
.picker-title {
  display: -webkit-box;
  overflow: hidden;
  color: var(--anth-ink);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-body-size);
  line-height: var(--anth-text-body-line);
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.picker-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--anth-space-2);
  min-height: 40px;
  padding: var(--anth-space-2) var(--anth-space-4);
  border-top: 1px solid var(--anth-rule);
  color: var(--anth-ink-soft);
  font-size: var(--anth-text-small-size);
}

@media (max-width: 640px) {
  .picker-dialog .dialog-header { padding: var(--anth-space-4) var(--anth-space-4) var(--anth-space-2); }
  .picker-dialog .picker-body { padding: 0 var(--anth-space-4) var(--anth-space-5); }
  .picker-filters { grid-template-columns: minmax(0, 1fr); }
}
</style>
