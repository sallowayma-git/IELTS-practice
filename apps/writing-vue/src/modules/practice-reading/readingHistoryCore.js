import {
  buildHistoryStats,
  buildPracticeTrendBars,
  buildPracticeTrendSummary,
  filterReadingHistory,
  getPracticeTrendRecords
} from './historyStats.js'

export function createReadingHistoryClient(api) {
  return {
    loadReadingHistory: () => api.listAll(),
    deleteReadingHistoryRecord: (recordId) => api.delete(recordId),
    clearReadingHistory: () => api.clear(),
    exportReadingHistoryArchive: () => api.exportArchive(),
    importReadingHistoryArchive: (payload) => api.importArchive(payload),
    filterReadingHistory,
    computeHistoryStats: (records, options = {}) => buildHistoryStats(records, options),
    getPracticeTrendRecords: (records, range, ranges, now = Date.now()) => getPracticeTrendRecords(records, range, ranges, now),
    computePracticeTrendSummary: (records, range, ranges, now = Date.now()) => buildPracticeTrendSummary(records, range, ranges, now),
    computePracticeTrendBars: (records, range, ranges, now = Date.now()) => buildPracticeTrendBars(records, range, ranges, now)
  }
}
