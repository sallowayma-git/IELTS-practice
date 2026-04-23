import type { ServiceBundle } from '../../types/api.js'
import type { ReadingAssistantQueryRequest } from '../../types/reading.js'

export class ReadingAssistantService {
  private readonly readingCoachService: any

  constructor(services: ServiceBundle) {
    this.readingCoachService = services.readingCoachService
  }

  async query(payload: ReadingAssistantQueryRequest, onEvent?: (event: Record<string, unknown>) => void) {
    return this.readingCoachService.query(payload, onEvent ? {
      onEvent: (event: Record<string, unknown>) => onEvent(event)
    } : {})
  }
}
