<template>
  <section class="listening-audio" data-listening-audio>
    <audio
      ref="audio"
      v-if="audioUrl"
      class="listening-audio__element"
      preload="metadata"
      :src="audioUrl"
      aria-label="听力录音"
      @timeupdate="updateTime"
      @seeking="handleSeeking"
      @loadedmetadata="readDuration"
      @durationchange="readDuration"
      @playing="setPlaying(true); buffering = false"
      @pause="setPlaying(false); buffering = false"
      @ended="setPlaying(false); clearClip()"
      @waiting="buffering = true"
      @canplay="buffering = false"
      @volumechange="volume = audio.muted ? 0 : audio.volume"
      @error="playError = '录音加载失败，请重试'; buffering = false; setPlaying(false)"
    ></audio>
    <button class="listening-audio__play" type="button" :disabled="!audioUrl || loading || Boolean(error)"
      :aria-label="playing ? '暂停录音' : '播放录音'" :title="playing ? '暂停录音' : '播放录音'" @click="togglePlayback">
      <span aria-hidden="true">{{ playing ? 'Ⅱ' : '▶' }}</span>
    </button>
    <span class="listening-audio__time">{{ formatTime(currentTime) }} <span>/ {{ formatTime(duration) }}</span></span>
    <input class="listening-audio__seek" type="range" min="0" :max="duration || 1" step="0.1" :value="currentTime"
      :disabled="!audioUrl || !duration || loading" aria-label="录音进度" :aria-valuetext="`${formatTime(currentTime)} / ${formatTime(duration)}`" @input="seek">
    <label class="listening-audio__volume">音量
      <input type="range" min="0" max="1" step="0.05" :value="volume" :disabled="!audioUrl" aria-label="音量" @input="setVolume">
    </label>
    <p v-if="loading || buffering" class="listening-audio__status" role="status">{{ loading ? '正在加载录音…' : '正在缓冲…' }}</p>
    <p v-if="error || playError" class="listening-audio__error" role="alert">{{ error || playError }}</p>
    <p v-else-if="!audioUrl && !loading" class="listening-audio__status">暂无录音。</p>
    <button
      v-if="(error || playError) && !loading"
      class="btn btn-secondary btn-sm"
      type="button"
      @click="retryAudio"
    >重试加载</button>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  audioUrl: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  durationSeconds: { type: Number, default: 0 }
})

const emit = defineEmits(['retry', 'timeupdate', 'playing-change'])
const audio = ref(null)
const playError = ref('')
const playing = ref(false)
const buffering = ref(false)
const currentTime = ref(0)
const mediaDuration = ref(0)
const volume = ref(1)
const duration = computed(() => mediaDuration.value || props.durationSeconds || 0)
let clip = null
let stopTimer = null

function formatTime(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
function setPlaying(value) {
  playing.value = value
  emit('playing-change', value)
}
function readDuration() {
  const value = audio.value?.duration
  mediaDuration.value = Number.isFinite(value) ? value : 0
}
function setVolume(event) {
  if (!audio.value) return
  audio.value.muted = false
  audio.value.volume = Number(event.target.value)
}
function seek(event) {
  if (!audio.value || !duration.value) return
  clearClip()
  audio.value.currentTime = Number(event.target.value)
  updateTime()
}
function retryAudio() {
  clearClip()
  playError.value = ''
  buffering.value = false
  audio.value?.load()
  emit('retry')
}
async function togglePlayback() {
  const player = audio.value
  if (!player) return
  clearClip()
  playError.value = ''
  if (!player.paused) {
    player.pause()
    return
  }
  const url = props.audioUrl
  try {
    await player.play()
  } catch {
    if (url === props.audioUrl) playError.value = '录音播放失败，请重试'
  }
}
function clearClip() {
  clip = null
  clearTimeout(stopTimer)
  stopTimer = null
}
function updateTime() {
  const player = audio.value
  if (!player) return
  currentTime.value = player.currentTime
  emit('timeupdate', player.currentTime)
  if (clip && player.currentTime >= clip.end) {
    player.pause()
    clearClip()
  }
}
function handleSeeking() {
  if (clip && (audio.value.currentTime < clip.start - 0.2 || audio.value.currentTime > clip.end)) clearClip()
}
async function playSegment(start, end) {
  const player = audio.value
  if (!player || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return
  clearClip()
  playError.value = ''
  const segment = { start, end }
  clip = segment
  try {
    player.currentTime = start
    await player.play()
    if (clip !== segment) return
    const check = () => {
      updateTime()
      if (clip) stopTimer = setTimeout(check, 40)
    }
    check()
  } catch {
    if (clip !== segment) return
    clearClip()
    playError.value = '无法播放这一句，请等待录音加载后重试'
  }
}
watch(() => props.audioUrl, () => {
  clearClip()
  playError.value = ''
  currentTime.value = 0
  mediaDuration.value = 0
  buffering.value = false
  setPlaying(false)
  emit('timeupdate', 0)
})
onBeforeUnmount(clearClip)
defineExpose({ playSegment })
</script>
