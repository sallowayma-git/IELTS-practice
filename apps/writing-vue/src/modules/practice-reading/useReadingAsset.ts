import { computed, ref } from 'vue'
import { readingLibraryApi } from './api'
import { normalizeReadingRecordId } from './contracts'
import { createReadingAssetController } from './readingAssetCore.js'

export function useReadingAsset(dependencies = {}) {
  const api = dependencies.api || readingLibraryApi
  const controller = createReadingAssetController(api, normalizeReadingRecordId)
  const asset = ref(controller.state.asset)
  const loading = ref(controller.state.loading)
  const error = ref(controller.state.error)
  const payload = computed(() => asset.value?.payload || null)

  async function loadReadingAsset(assetId, options = {}) {
    loading.value = true
    try {
      const data = await controller.loadReadingAsset(assetId, options)
      asset.value = controller.state.asset
      error.value = controller.state.error
      return data
    } catch (loadError) {
      asset.value = controller.state.asset
      error.value = controller.state.error
      throw loadError
    } finally {
      loading.value = controller.state.loading
    }
  }

  async function loadReadingAssetPool(options = {}) {
    return controller.loadReadingAssetPool(options)
  }

  function clearReadingAssetError() {
    controller.clearReadingAssetError()
    error.value = controller.state.error
  }

  function clearReadingAsset() {
    controller.clearReadingAsset()
    asset.value = controller.state.asset
  }

  return {
    asset,
    payload,
    loading,
    error,
    loadReadingAsset,
    loadReadingAssetPool,
    clearReadingAssetError,
    clearReadingAsset
  }
}
