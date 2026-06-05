export function createReadingLibraryClient(api) {
  return {
    loadReadingAssets: (options = {}) => api.listAssets(options),
    getReadingAsset: (assetId, options = {}) => api.getAsset(assetId, options)
  }
}
