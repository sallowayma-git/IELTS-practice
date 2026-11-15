<template>
  <section class="listening-audio" data-listening-audio>
    <div class="listening-audio__label">
      <p class="listening-audio__kicker">AUDIO · 录音</p>
      <p v-if="durationLabel" class="listening-audio__duration">时长 {{ durationLabel }}</p>
    </div>
    <div class="listening-audio__player">
      <audio
        v-if="audioUrl"
        class="listening-audio__element"
        controls
        preload="metadata"
        :src="audioUrl"
        aria-label="听力录音"
      ></audio>
      <p v-else-if="loading" class="listening-audio__status" role="status">正在加载录音…</p>
      <p v-else-if="error" class="listening-audio__error" role="alert">{{ error }}</p>
      <p v-else class="listening-audio__status">暂无录音。</p>
      <button
        v-if="error && !loading"
        class="btn btn-secondary btn-sm"
        type="button"
        @click="$emit('retry')"
      >重试加载</button>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  audioUrl: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  durationSeconds: { type: Number, default: 0 }
})

defineEmits(['retry'])

const durationLabel = computed(() => {
  const total = Math.max(0, Math.round(Number(props.durationSeconds) || 0))
  if (!total) return ''
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return minutes > 0 ? `${minutes} 分 ${rest} 秒` : `${rest} 秒`
})
</script>
