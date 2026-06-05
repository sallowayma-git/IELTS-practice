import { readingHistoryApi } from './api'
import { createReadingHistoryClient } from './readingHistoryCore.js'

export function useReadingHistory() {
  return useReadingHistoryWithDependencies()
}

export function useReadingHistoryWithDependencies(dependencies = {}) {
  const api = dependencies.api || readingHistoryApi
  return createReadingHistoryClient(api)
}
