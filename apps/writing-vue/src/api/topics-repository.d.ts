export interface WritingTopicViewModel {
  id: string
  type: 'task1' | 'task2' | string
  category: string
  difficulty: number
  title_json: string
  image_path: string | null
  image_url: string | null
  is_official: boolean
  usage_count: number
  created_at: string
  updated_at: string
}

export function listWritingTopics(filters?: Record<string, unknown>, pagination?: Record<string, unknown>): Promise<{ source: 'tauri'; data: WritingTopicViewModel[]; total: number; page: number; limit: number }>
export function getWritingTopic(id: string): Promise<WritingTopicViewModel | null>
export function upsertWritingTopic(data: Record<string, unknown>, id?: string): Promise<WritingTopicViewModel>
export function deleteWritingTopic(id: string): Promise<boolean>
export function importWritingTopics(topics: Record<string, unknown>[]): Promise<{ source: 'tauri'; created: number; updated: number; success: number; failed: number }>
export function getWritingTopicStatistics(): Promise<{ source: 'tauri'; total: number; byType: Array<{ type: string; count: number }> }>
