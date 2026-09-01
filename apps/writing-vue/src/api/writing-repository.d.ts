export function newIdempotencyKey(prefix?: string): string
export function saveDraft(payload: Record<string, unknown>): Promise<{ source: 'tauri'; draft: unknown }>
export function getDraft(attemptId: string): Promise<{ source: 'tauri'; draft: unknown }>
export function submitAttempt(attemptId: string, idempotencyKey?: string): Promise<{ source: 'tauri'; attempt: unknown }>
export function startEvaluation(payload: Record<string, unknown>): Promise<{ source: 'tauri'; handle: unknown }>
export function listEvaluationEvents(evaluationId: string, afterSequence?: number): Promise<unknown[]>
export function cancelEvaluation(evaluationId: string): Promise<boolean>
export function getEvaluationForAttempt(attemptId: string): Promise<{ source: 'tauri'; evaluation: unknown }>
export function isTauriRuntime(): boolean
