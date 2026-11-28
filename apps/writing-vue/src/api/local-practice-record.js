import { getHistoryDetail } from '@/api/history-repository.js'

export async function loadLocalCompletedDetail(activity, assetId, attemptId) {
  const { detail } = await getHistoryDetail(attemptId)
  const attempt = detail?.attempt
  if (attempt?.status !== 'completed' || attempt.activity !== activity || attempt.assetId !== assetId) {
    throw new Error('未找到与当前题目匹配的已提交记录')
  }
  return detail
}
