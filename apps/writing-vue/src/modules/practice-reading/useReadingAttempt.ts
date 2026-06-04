import { READING_ACTIVITY, normalizeReadingRecordId } from './contracts'

export function useReadingAttempt() {
  function resolveReviewTarget(record) {
    const assetId = normalizeReadingRecordId(record?.assetId || record?.examId)
    const sessionId = normalizeReadingRecordId(record?.sessionId)
    return {
      activity: READING_ACTIVITY,
      assetId,
      sessionId,
      ready: Boolean(assetId && sessionId)
    }
  }

  return {
    resolveReviewTarget
  }
}
