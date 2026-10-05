<template>
  <div class="dialog-overlay" @click.self="$emit('cancel')" @keydown.esc="$emit('cancel')">
    <div class="dialog card" role="dialog" aria-modal="true" :aria-label="title">
      <h3 class="heading-serif">{{ title }}</h3>
      <p>{{ message }}</p>

      <input
        v-if="mode === 'all'"
        v-model="typed"
        type="text"
        placeholder="请输入 &quot;确认删除&quot; 以继续"
        class="input delete-confirm-input"
      />

      <div class="dialog-actions">
        <button type="button" class="btn btn-warm-sand" @click="$emit('cancel')">取消</button>
        <button type="button" class="btn btn-danger" :disabled="!confirmed" @click="$emit('confirm')">确认删除</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'

const CONFIRM_WORD = '确认删除'

const props = defineProps({
  /** 'batch' (the selected records) | 'all' (everything in the tab) */
  mode: { type: String, required: true },
  /** Tab label for 'all' scope ('' = every activity). */
  scopeLabel: { type: String, default: '' },
  count: { type: Number, default: 0 }
})
defineEmits(['cancel', 'confirm'])

const typed = ref('')
const confirmed = computed(() => props.mode !== 'all' || typed.value === CONFIRM_WORD)

const title = computed(() => {
  if (props.mode === 'all') return props.scopeLabel ? `清空${props.scopeLabel}记录` : '清空所有历史记录'
  return props.mode === 'batch' ? `删除 ${props.count} 条记录` : '删除记录'
})

const message = computed(() => {
  if (props.mode === 'all') {
    const scope = props.scopeLabel ? `全部${props.scopeLabel}记录（不受当前筛选影响）` : '所有历史记录'
    return `此操作将删除${scope}，且不可恢复。请输入"${CONFIRM_WORD}"以继续。`
  }
  if (props.mode === 'batch') return `确定删除选中的 ${props.count} 条记录？此操作不可恢复。`
  return '确定删除该记录？此操作不可恢复。'
})
</script>

<style scoped>
.delete-confirm-input {
  width: 100%;
  margin: 12px 0;
}
</style>
