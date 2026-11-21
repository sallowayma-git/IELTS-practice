export function createReadingAssetController(api, normalizeReadingRecordId) {
  let generation = 0
  const state = {
    asset: null,
    loading: false,
    error: ''
  }

  async function loadReadingAsset(assetId, options = {}) {
    const current = ++generation
    const normalizedAssetId = normalizeReadingRecordId(assetId)
    if (!normalizedAssetId) {
      state.asset = null
      state.error = '缺少阅读资源编号'
      state.loading = false
      return null
    }

    const { afterLoad } = options || {}
    state.loading = true
    state.error = ''
    try {
      const data = normalizeReadingAssetViewModel(await api.getAsset(normalizedAssetId))
      if (current !== generation) return null
      state.asset = data
      if (typeof afterLoad === 'function') {
        await afterLoad(data)
      }
      return data
    } catch (loadError) {
      if (current !== generation) return null
      state.asset = null
      state.error = loadError?.message
        ? `阅读资源加载失败：${loadError.message}`
        : '阅读资源加载失败，请稍后重试'
      throw loadError
    } finally {
      if (current === generation) state.loading = false
    }
  }

  async function loadReadingAssetPool() {
    return api.listAssets()
  }

  function clearReadingAssetError() {
    state.error = ''
  }

  function clearReadingAsset() {
    generation++
    state.asset = null
    state.loading = false
  }

  return {
    state,
    loadReadingAsset,
    loadReadingAssetPool,
    clearReadingAssetError,
    clearReadingAsset
  }
}

export function normalizeReadingAssetViewModel(value) {
  if (!value || typeof value !== 'object') return value
  const nested = value.payload
  if (nested?.asset && Object.prototype.hasOwnProperty.call(nested, 'payload')) {
    return { ...value, ...nested.asset, payload: nested.payload }
  }
  if (value.asset && Object.prototype.hasOwnProperty.call(value, 'payload')) {
    return { ...value.asset, payload: value.payload }
  }
  return value
}

/** A passage the unified reading page can render (not a PDF-only scan). */
export function hasReadingPracticePayload(asset) {
  const metadata = asset?.metadata || {}
  return asset?.practiceKind !== 'material' && metadata.practiceKind !== 'material' && !asset?.pdfOnly && Boolean(
    asset?.payloadRef
    || asset?.contentRef
    || metadata.dataKey
    || metadata.script
  )
}
