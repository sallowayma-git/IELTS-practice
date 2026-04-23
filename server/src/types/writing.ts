export interface WritingEvaluationCreateRequest {
  task_type: 'task1' | 'task2'
  topic_id?: number | null
  topic_text?: string | null
  content: string
  word_count?: number | null
  config_id?: number | null
  api_config_id?: number | null
  prompt_version?: string | null
}
