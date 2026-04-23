export interface ApiErrorEnvelope {
  error: string
  message: string
  details?: Record<string, unknown>
}

export interface ServiceBundle {
  db: unknown
  configService: any
  promptService: any
  evaluateService: any
  topicService: any
  essayService: any
  settingsService: any
  uploadService: any
  readingCoachService: any
}
