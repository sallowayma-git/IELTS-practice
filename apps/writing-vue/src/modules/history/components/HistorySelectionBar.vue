<template>
  <div class="history-selection" role="region" aria-label="选择记录">
    <span class="history-selection__count" aria-live="polite">已选 {{ count }} 条</span>
    <button type="button" class="btn-text btn-text--danger" :disabled="count === 0" data-history-delete @click="$emit('delete')">删除</button>
    <button type="button" class="btn-text" :disabled="!hasRows" data-history-select-page @click="$emit('select-page')">全选本页</button>
    <button type="button" class="btn-text" data-history-cancel @click="$emit('cancel')">取消</button>
    <button type="button" class="btn-text history-selection__clear" :disabled="!hasRows" data-history-clear-all @click="$emit('clear-all')">
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
  position: sticky;
  top: var(--history-sticky-top, calc(var(--anth-nav-height) + 1px));
  z-index: 4;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 20px;
  padding: 0;
  border-top: 1px solid var(--anth-rule);
  background: var(--anth-canvas);
}

.history-selection__count {
  font-size: var(--anth-text-sm);
  font-variant-numeric: lining-nums tabular-nums;
}

.history-selection .btn-text {
  min-height: 44px;
  white-space: nowrap;
}

.btn-text--danger,
.atlas-paper .btn-text--danger:hover:not(:disabled) {
  color: var(--anth-danger);
}

.history-selection__clear {
  margin-left: auto;
  color: var(--anth-ink-faint);
}

@media (max-width: 640px) {
  .history-selection__clear {
    margin-left: 0;
  }
}
</style>
