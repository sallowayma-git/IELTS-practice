<template>
  <p v-if="error" class="runified-status is-error" role="alert" data-draft-save-error>
    草稿未保存：{{ error }}
    <button class="btn-text" type="button" :disabled="saving" @click="$emit('retry')">
      {{ saving ? '正在保存…' : '重试保存' }}
    </button>
  </p>
  <p v-else-if="saving" class="runified-status" role="status">正在保存草稿…</p>
</template>

<script setup>
defineProps({ error: { type: String, default: '' }, saving: Boolean })
defineEmits(['retry'])
</script>
