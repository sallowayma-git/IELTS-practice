export interface ReadingAssistantQueryRequest {
  examId?: string
  sessionId?: string
  mode?: string
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
    analysisSignals?: Record<string, unknown> | null
    markedQuestions?: string[]
    questionTimelineLite?: Array<Record<string, unknown>>
    questionTypePerformance?: Record<string, Record<string, unknown>>
  }
}

export type ReadingAssistantRoute = 'unrelated_chat' | 'ielts_general' | 'page_grounded'
export type ReadingAssistantContextRoute = 'tutor' | 'selection' | 'review' | 'followup' | 'clarify' | 'similar'
export type ReadingAssistantIntentKind =
  | 'grounded_question'
  | 'whole_set_or_review'
  | 'followup_request'
  | 'social_or_smalltalk'
  | 'general_chat'
  | 'selection_tool_request'
  | 'review_coach_request'
  | 'clarify'
export type ReadingAssistantResponseKind = 'chat' | 'grounded' | 'tool_result' | 'review' | 'clarify' | 'social'
export type ReadingAssistantConfidence = 'high' | 'medium' | 'low'

export interface ReadingAssistantIntent {
  kind: ReadingAssistantIntentKind
  confidence?: number
  questionNumbers?: string[]
  paragraphLabels?: string[]
}

export interface ReadingAssistantAnswerSection {
  type: 'direct_answer' | 'reasoning' | 'evidence' | 'next_step'
  text: string
}

export interface ReadingAssistantCitation {
  id?: string
  chunkType: 'passage_paragraph' | 'question_item' | 'answer_key' | 'answer_explanation' | string
  questionNumbers?: string[]
  paragraphLabels?: string[]
  excerpt: string
}

export interface ReadingAssistantRetrievalDiagnostics {
  route: ReadingAssistantRoute | string
  contextRoute: ReadingAssistantContextRoute | string
  intent: ReadingAssistantIntentKind | string
  chunkCount: number
  deterministicChunkCount: number
  finalChunkTypeCounts: Record<string, number>
  focusQuestionNumbers: string[]
  focusParagraphLabels: string[]
  usedQuestionNumbers: string[]
  usedParagraphLabels: string[]
  missingContext: string[]
  reviewTargetCount: number
  cacheHit: boolean
}

export interface ReadingAssistantTimings {
  total_ms: number
  retrieval_ms: number
  generation_ms: number
  cache_hit: boolean
}

export interface ReadingAssistantModelTrace {
  config_id: string | number | null
  provider: string | null
  model: string | null
  provider_path: Array<Record<string, unknown>>
  latency_ms: number
}

export interface ReadingAssistantReviewOverall {
  primaryWeakness: string
  patternSummary: string
  teachingPlan: string
}

export interface ReadingAssistantReviewQuestionAnalysis {
  questionNumber: string
  likelyMistake: string
  whyUserChoseWrong: string
  whyCorrectAnswerWorks: string
  whyWrongAnswerFails: string
  nextRule: string
}

export interface ReadingAssistantQueryResponse {
  coachVersion: 'v2' | string
  generatedAt: string
  route: ReadingAssistantRoute | string
  routeReason: string
  contextRoute: ReadingAssistantContextRoute | string
  intent: ReadingAssistantIntent
  answer: string
  answerSections: ReadingAssistantAnswerSection[]
  reviewOverall: ReadingAssistantReviewOverall | null
  reviewQuestionAnalyses: ReadingAssistantReviewQuestionAnalysis[]
  followUps: string[]
  confidence: ReadingAssistantConfidence
  missingContext: string[]
  citations: ReadingAssistantCitation[]
  usedQuestionNumbers: string[]
  usedParagraphLabels: string[]
  quickActions: Array<{ id: string; label: string }>
  responseKind: ReadingAssistantResponseKind
  contextDiagnostics: ReadingAssistantRetrievalDiagnostics
  retrievalDiagnostics: ReadingAssistantRetrievalDiagnostics
  model_trace: ReadingAssistantModelTrace
  timings: ReadingAssistantTimings
  cacheHit?: boolean
}
