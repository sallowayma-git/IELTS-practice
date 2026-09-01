export interface CommandError {
  message?: string
  code?: string
  retryable?: boolean
  context?: unknown
  causeId?: string
}

export interface CommandResponse<T = unknown> {
  ok: boolean
  data?: T
  error?: CommandError
}

export function isTauriRuntime(): boolean
export function assertTauriRuntime(label?: string): void
export function invokeCommand<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T | CommandResponse<T>>
export function unwrapCommandResponse<T>(response: T | CommandResponse<T>, label?: string): T
