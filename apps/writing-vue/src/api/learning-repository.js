/**
 * Read-only learning evidence repository for the M1 Attempt Review surface.
 * Canonical evidence is produced by Rust; the Vue layer only queries it.
 */

import { invokeCommand, unwrapCommandResponse } from '@/api/tauri-bridge.js'

function requiredText(value, label) {
  const normalized = String(value || '').trim()
  if (!normalized) throw new TypeError(`${label} is required`)
  return normalized
}

export async function compareAttemptsForAsset({ assetId, limit = 5, minimumGapHours = 12 }) {
  const response = await invokeCommand('learning_compare_attempts', {
    query: {
      assetId: requiredText(assetId, 'assetId'),
      limit,
      minimumGapHours
    }
  })
  return unwrapCommandResponse(response, 'learning_compare_attempts')
}

export async function runAttemptReview({ attemptId, configId = null }) {
  const response = await invokeCommand('agent_run_attempt_review', {
    request: {
      attemptId: requiredText(attemptId, 'attemptId'),
      configId: configId || null
    }
  })
  return unwrapCommandResponse(response, 'agent_run_attempt_review')
}

export async function getAgentRun(runId) {
  const response = await invokeCommand('agent_get_run', {
    runId: requiredText(runId, 'runId')
  })
  return unwrapCommandResponse(response, 'agent_get_run')
}

export const learningRepository = {
  compareAttemptsForAsset,
  runAttemptReview,
  getAgentRun
}

export default learningRepository
