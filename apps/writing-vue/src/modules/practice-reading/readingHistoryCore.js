// Reading record archive (export / import). Browsing, filtering, deleting and
// exporting records is the unified history page; this is only the backup path.
export function createReadingHistoryClient(api) {
  return {
    exportReadingHistoryArchive: () => api.exportArchive(),
    importReadingHistoryArchive: (payload) => api.importArchive(payload)
  }
}
