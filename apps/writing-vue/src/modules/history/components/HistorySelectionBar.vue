<template>
  <div class="history-selection" role="region" aria-label="选择记录">
    <span class="history-selection__count t-num" aria-live="polite">已选 {{ count }} 条</span>
    <button type="button" class="btn btn-danger-ghost btn-sm" :disabled="count === 0" data-history-delete @click="$emit('delete')">删除</button>
    <button type="button" class="btn btn-ghost btn-sm" :disabled="!hasRows" data-history-select-page @click="$emit('select-page')">全选本页</button>
    <button type="button" class="btn btn-ghost btn-sm" data-history-cancel @click="$emit('cancel')">取消</button>
    <button
      type="button"
      class="btn btn-danger-ghost btn-sm history-selection__clear"
      :disabled="!hasRows"
      data-history-clear-all
      @click="$emit('clear-all')"
    >
      {{ clearLabel }}
    </button>
  </div>
</template>

<script setup>
defineProps({
  count: { type: Number, default: 0 },
  hasRows: { type: Boolean, default: false },
  clearLabel: { type: String, required: true }
})
defineEmits(['delete', 'select-page', 'cancel', 'clear-all'])
</script>

<style scoped>
.history-selection {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--anth-space-2) var(--anth-space-3);
  padding-top: var(--anth-space-2);
  border-top: 1px solid var(--anth-rule);
}

.history-selection__count {
  margin-right: var(--anth-space-2);
  color: var(--anth-ink-soft);
  font-size: var(--anth-text-small-size);
}

.history-selection__clear {
  margin-left: auto;
}
</style>
