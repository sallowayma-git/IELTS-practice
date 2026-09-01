import type { Activity, AttemptMode, AttemptStatus, ScoreScale, WritingTaskType } from '@/types/generated/domain'

export interface HistoryQuery {
  activity?: Activity | null
  limit?: number
  offset?: number
  search?: string | null
  startDate?: string | null
  endDate?: string | null
  minScore?: number | null
  maxScore?: number | null
  scoreScale?: ScoreScale | null
  score_scale?: ScoreScale | null
  taskType?: WritingTaskType | null
  task_type?: WritingTaskType | null
}

/** The only history shape exposed to Vue consumers: camelCase and display-ready. */
export interface HistoryViewModel {
  id: string
  activity: Activity
  title: string
  status: AttemptStatus | string
  mode: AttemptMode | string
  submittedAt: string | null
  durationMs: number
  duration: number
  scoreValue: number | null
  scoreScale: ScoreScale | string | null
  scoreLabel: string
  scoreDisplay: string
  assetId: string | null
  sessionId: string | null
  suiteId: string | null
  metadata: {
    activity: Activity
    assetId?: string
    sessionId?: string
    suiteSessionId?: string
  }
  source: 'tauri'
  examId?: string | null
  accuracy?: number
  taskType: 'reading' | WritingTaskType | null
}

export function listHistory(query?: HistoryQuery): Promise<{ source: 'tauri'; items: HistoryViewModel[]; total: number; limit: number; offset: number; nextCursor: string | null }>
export function listHistoryAll(query?: HistoryQuery, options?: { maxItems?: number }): Promise<{ source: 'tauri'; items: HistoryViewModel[]; total: number; limit: number; offset: number; nextCursor: string | null }>
export function getHistoryDetail(attemptId: string): Promise<{ source: 'tauri'; detail: unknown }>
export function getWritingHistoryStatistics(range?: 'all' | 'monthly' | 'task1' | 'task2'): Promise<{ source: 'tauri'; statistics: unknown }>
export function exportHistory(format?: string, query?: HistoryQuery): Promise<{ source: 'tauri'; result: unknown }>
export function deleteHistoryAttempt(attemptId: string): Promise<unknown>
export function deleteHistoryAttempts(attemptIds: string[]): Promise<number>
export function clearHistory(activity?: 'reading' | 'writing' | null): Promise<number>
export function isTauriRuntime(): boolean
