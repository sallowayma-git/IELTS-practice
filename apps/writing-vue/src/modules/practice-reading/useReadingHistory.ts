import { readingHistoryApi } from './api'
import { createReadingHistoryClient } from './readingHistoryCore.js'

export function useReadingHistory() {
  return useReadingHistoryWithDependencies()
}

interface ReadingHistoryDependencies { api?: typeof readingHistoryApi }

export function useReadingHistoryWithDependencies(dependencies: ReadingHistoryDependencies = {}) {
  const api = dependencies.api || readingHistoryApi
  return createReadingHistoryClient(api)
}
