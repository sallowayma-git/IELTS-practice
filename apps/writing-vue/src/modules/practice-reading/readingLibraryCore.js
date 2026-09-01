export function createReadingLibraryClient(api) {
  return {
    loadReadingAssets: () => api.listAssets(),
    getReadingAsset: (assetId) => api.getAsset(assetId)
  }
}
