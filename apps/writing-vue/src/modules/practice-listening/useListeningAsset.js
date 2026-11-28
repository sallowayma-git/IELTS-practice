/**
 * Listening asset loader.
 *
 * `listening_get_asset_payload` returns the exam payload only (the Rust host
 * verifies the indexed fingerprint first). The view still wants one `asset`
 * object with the same field names the reading page uses, so this module is the
 * single place that lifts meta onto that shape — components never reach into
 * `payload.meta` to decide what a title or a category is.
 */

import { computed, ref } from 'vue'
import { getListeningAssetPayload as listeningGetAssetPayload } from '@/api/listening-repository.js'

function text(value) {
  return String(value ?? '').trim()
}

/**
 * Validate the structural contract the practice page relies on. A bad pack is
 * an error state, not a blank screen and not a crash.
 */
export function normalizeListeningAsset(payload, assetId) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('听力资源内容为空')
  }
  const meta = payload.meta && typeof payload.meta === 'object' ? payload.meta : null
  if (!meta) {
    throw new Error('听力资源缺少 meta')
  }
  const questionOrder = Array.isArray(payload.questionOrder) ? payload.questionOrder : []
  const questionGroups = Array.isArray(payload.questionGroups) ? payload.questionGroups : []
  if (!questionOrder.length || !questionGroups.length) {
    throw new Error('听力题库内容不完整')
  }
  return {
    id: text(payload.examId) || text(assetId),
    title: text(meta.title) || '听力练习',
    category: text(meta.category) || null,
    difficulty: text(meta.difficulty) || null,
    frequency: text(meta.frequency) || null,
    durationSeconds: Number(meta.durationSeconds) || null,
    // The view command returns the exam payload, not the `practice_assets`
    // row. Its schemaVersion is the exam schema (1), NOT the indexed asset
    // revision (2) Rust checks on draft/submit, so the asset revision stays
    // unpinned here instead of sending a value the host would reject.
    schemaVersion: null,
    examSchemaVersion: Number(payload.schemaVersion) || null,
    // The command does not expose the indexed fingerprint; null means "no pin".
    fingerprint: null,
    payload
  }
}

export function useListeningAsset() {
  const asset = ref(null)
  const loading = ref(false)
  const error = ref('')
  const payload = computed(() => asset.value?.payload || null)

  async function loadListeningAsset(assetId) {
    const normalizedAssetId = text(assetId)
    if (!normalizedAssetId) {
      asset.value = null
      error.value = '缺少听力资源编号'
      throw new Error(error.value)
    }
    loading.value = true
    error.value = ''
    try {
      const loaded = normalizeListeningAsset(
        await listeningGetAssetPayload(normalizedAssetId),
        normalizedAssetId
      )
      asset.value = loaded
      return loaded
    } catch (loadError) {
      asset.value = null
      error.value = loadError?.message
        ? `听力资源加载失败：${loadError.message}`
        : '听力资源加载失败，请稍后重试'
      throw loadError
    } finally {
      loading.value = false
    }
  }

  function clearListeningAssetError() {
    error.value = ''
  }

  function clearListeningAsset() {
    asset.value = null
  }

  return {
    asset,
    payload,
    loading,
    error,
    loadListeningAsset,
    clearListeningAssetError,
    clearListeningAsset
  }
}
