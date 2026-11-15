/**
 * Listening audio loader.
 *
 * Audio never crosses IPC as a filesystem path: the Rust host resolves
 * `meta.audio` inside the pack root and returns a data URL. This composable
 * only owns the recoverable error state — the player itself is a native
 * `<audio controls>` that the learner starts; nothing here autoplays.
 */

import { ref } from 'vue'
import { getListeningAudioDataUrl as listeningGetAudioDataUrl } from '@/api/listening-repository.js'

export function useListeningAudio() {
  const audioUrl = ref('')
  const loading = ref(false)
  const error = ref('')

  async function loadAudio(assetId) {
    const normalizedAssetId = String(assetId || '').trim()
    if (!normalizedAssetId) {
      audioUrl.value = ''
      error.value = '缺少听力资源编号，无法加载音频'
      return ''
    }
    loading.value = true
    error.value = ''
    audioUrl.value = ''
    try {
      const dataUrl = await listeningGetAudioDataUrl(normalizedAssetId)
      const normalizedUrl = String(dataUrl || '')
      if (!normalizedUrl) {
        error.value = '音频资源为空，暂时无法播放'
        return ''
      }
      audioUrl.value = normalizedUrl
      return normalizedUrl
    } catch (loadError) {
      console.warn('加载听力音频失败:', loadError)
      error.value = loadError?.message
        ? `音频加载失败：${loadError.message}`
        : '音频加载失败，请稍后重试'
      return ''
    } finally {
      loading.value = false
    }
  }

  function clearAudio() {
    audioUrl.value = ''
    error.value = ''
    loading.value = false
  }

  return {
    audioUrl,
    loading,
    error,
    loadAudio,
    clearAudio
  }
}
