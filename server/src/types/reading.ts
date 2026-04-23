export interface ReadingAssistantQueryRequest {
  examId: string
  query?: string
  userQuery?: string
  locale?: 'zh' | 'en'
  surface?: 'chat_widget' | 'selection_popover' | 'review_workspace'
  action?: 'chat' | 'translate' | 'explain_selection' | 'find_paraphrases' | 'find_antonyms' | 'extract_keywords' | 'locate_evidence' | 'analyze_mistake' | 'review_set' | 'recommend_drills'
  promptKind?: 'preset' | 'freeform' | 'followup'
  selectedText?: string
  selectedContext?: {
    text?: string
    scope?: 'passage' | 'question'
    questionNumbers?: string[]
    paragraphLabels?: string[]
  } | null
  focusQuestionNumbers?: string[]
  history?: Array<{
    role: 'user' | 'assistant'
    content: string
  }>
  attemptContext?: {
    submitted?: boolean
    score?: number | null
    wrongQuestions?: string[]
    selectedAnswers?: Record<string, string>
  }
}
