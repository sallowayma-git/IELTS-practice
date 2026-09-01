import { invokeCommand, unwrapCommandResponse } from '@/api/tauri-bridge.js'

export async function pickAgentWorkspace() {
  const response = await invokeCommand('agent_pick_workspace')
  return unwrapCommandResponse(response, 'agent_pick_workspace')
}

export async function runWorkspaceAgent(payload) {
  const grantId = String(payload?.grantId || '').trim()
  const prompt = String(payload?.prompt || '').trim()
  if (!grantId) throw new TypeError('agent workspace grant is required')
  if (!prompt) throw new TypeError('agent prompt is required')

  // Client-generated run id: the UI needs it to cancel a run that is still
  // executing (agent_cancel_run flips the token; the run lands Interrupted).
  const runId = String(payload?.runId || '').trim() || crypto.randomUUID()

  const response = await invokeCommand('agent_run', {
    request: {
      grantId,
      prompt,
      configId: payload?.configId || null,
      runId
    }
  })
  return unwrapCommandResponse(response, 'agent_run')
}

export async function cancelAgentRun(runId) {
  const id = String(runId || '').trim()
  if (!id) throw new TypeError('agent run id is required')
  const response = await invokeCommand('agent_cancel_run', { runId: id })
  return unwrapCommandResponse(response, 'agent_cancel_run')
}

// M12-04: drive the deterministic Python planner; the proposal is persisted
// via the study_plan.create reverse-RPC and the reply carries the host planId.
export async function runStudyPlanner(payload) {
  const userGoal = String(payload?.userGoal || '').trim()
  if (!userGoal) throw new TypeError('study plan user goal is required')
  const response = await invokeCommand('study_plan_run', {
    request: {
      userGoal,
      availableMinutes: payload?.availableMinutes ?? 60,
      targetDate: payload?.targetDate || null,
      planDate: payload?.planDate || null
    }
  })
  return unwrapCommandResponse(response, 'study_plan_run')
}

// Latest plan + items for the console plan panel. Plan IDs are not thread
// IDs — the host hands over the real snapshot.
export async function getLatestStudyPlan(userId = 'local') {
  const response = await invokeCommand('study_plan_get_latest', { userId })
  return unwrapCommandResponse(response, 'study_plan_get_latest')
}

export async function getAgentRun(runId) {
  const id = String(runId || '').trim()
  if (!id) throw new TypeError('agent run id is required')
  const response = await invokeCommand('agent_get_run', { runId: id })
  return unwrapCommandResponse(response, 'agent_get_run')
}

export function normalizeAgentRun(outcome, record) {
  const result = record?.result && typeof record.result === 'object' ? record.result : {}
  const usage = outcome?.usage || result.usage || null
  return {
    id: record?.id || outcome?.runId || '',
    status: record?.status || (outcome ? 'completed' : 'running'),
    content: outcome?.content || '',
    rounds: numberOr(record?.rounds, outcome?.rounds),
    toolCallCount: numberOr(record?.toolCallCount, outcome?.toolCalls),
    toolCalls: Array.isArray(record?.toolCalls) ? record.toolCalls : [],
    actualModel: outcome?.actualModel || outcome?.model || result.actualModel || null,
    latencyMs: numberOr(outcome?.latencyMs, result.latencyMs),
    retryCount: numberOr(outcome?.retryCount, result.retryCount),
    usage,
    providerRequestId: outcome?.providerRequestId || result.providerRequestId || null,
    promptHash: outcome?.promptHash || result.promptHash || '',
    error: record?.error || null,
    completedAt: record?.completedAt || null
  }
}

function numberOr(primary, fallback) {
  const value = primary ?? fallback ?? 0
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

export const agentRepository = {
  pickWorkspace: pickAgentWorkspace,
  run: runWorkspaceAgent,
  cancelRun: cancelAgentRun,
  getRun: getAgentRun,
  normalizeRun: normalizeAgentRun,
  runStudyPlanner,
  getLatestStudyPlan
}

export default agentRepository
