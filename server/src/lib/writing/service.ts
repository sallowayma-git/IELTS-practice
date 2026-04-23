import type { ServiceBundle } from '../../types/api.js'
import type { WritingEvaluationCreateRequest } from '../../types/writing.js'

export class WritingEvaluationService {
  private readonly evaluateService: any

  constructor(services: ServiceBundle) {
    this.evaluateService = services.evaluateService
  }

  async create(payload: WritingEvaluationCreateRequest) {
    return this.evaluateService.start({
      ...payload,
      config_id: payload.api_config_id ?? payload.config_id ?? null
    })
  }

  async cancel(sessionId: string) {
    return this.evaluateService.cancel(sessionId)
  }

  async getSessionState(sessionId: string) {
    return this.evaluateService.getSessionState(sessionId)
  }

  subscribe(sessionId: string, handler: (event: Record<string, unknown>) => void) {
    return this.evaluateService.subscribeSession(sessionId, handler)
  }
}
