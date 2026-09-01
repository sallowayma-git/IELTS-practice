export interface AgentWorkspaceGrant {
  grantId: string
  displayPath: string
  expiresAt: string
}

export interface AgentTokenUsage {
  inputTokens: number
  outputTokens: number
}

export interface AgentRunOutcome {
  runId: string
  content: string
  model: string
  actualModel: string
  rounds: number
  toolCalls: number
  latencyMs: number
  retryCount: number
  promptHash: string
  usage?: AgentTokenUsage | null
  providerRequestId?: string | null
}

export interface AgentToolCallRecord {
  runId: string
  callId: string
  sequence: number
  round: number
  toolName: string
  status: 'running' | 'succeeded' | 'rejected' | 'failed' | 'interrupted'
  arguments: Record<string, unknown>
  result?: Record<string, unknown> | null
  error?: Record<string, unknown> | null
  startedAt: string
  completedAt?: string | null
}

export interface AgentRunRecord {
  id: string
  providerId: string
  model: string
  status: 'running' | 'completed' | 'failed' | 'limit_exceeded' | 'interrupted'
  rounds: number
  toolCallCount: number
  result?: Record<string, unknown> | null
  error?: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
  completedAt?: string | null
  toolCalls: AgentToolCallRecord[]
}

export interface NormalizedAgentRun {
  id: string
  status: AgentRunRecord['status']
  content: string
  rounds: number
  toolCallCount: number
  toolCalls: AgentToolCallRecord[]
  actualModel: string | null
  latencyMs: number
  retryCount: number
  usage: AgentTokenUsage | null
  providerRequestId: string | null
  promptHash: string
  error: Record<string, unknown> | null
  completedAt: string | null
}

export function pickAgentWorkspace(): Promise<AgentWorkspaceGrant | null>
export function runWorkspaceAgent(payload: {
  grantId: string
  prompt: string
  configId?: string | null
}): Promise<AgentRunOutcome>
export function getAgentRun(runId: string): Promise<AgentRunRecord | null>
export function normalizeAgentRun(
  outcome?: AgentRunOutcome | null,
  record?: AgentRunRecord | null
): NormalizedAgentRun

export const agentRepository: {
  pickWorkspace: typeof pickAgentWorkspace
  run: typeof runWorkspaceAgent
  getRun: typeof getAgentRun
  normalizeRun: typeof normalizeAgentRun
}

export default agentRepository
