export function resolveFeatureFlag(value, defaultValue) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return defaultValue
  }
  return String(value).trim().toLowerCase() === 'true'
}

const buildEnvironment = typeof import.meta.env === 'object' ? import.meta.env : {}

export const featureFlags = Object.freeze({
  // Developer-only agent workbench (/dev/agent). Off for learners; the
  // 札记 notebook is the user-facing surface for consolidation output.
  agentWorkspaceV1: resolveFeatureFlag(
    buildEnvironment.VITE_FEATURE_AGENT_WORKSPACE_V1,
    false
  ),
  readingAttemptReviewV1: resolveFeatureFlag(
    buildEnvironment.VITE_FEATURE_READING_ATTEMPT_REVIEW_V1,
    false
  ),
  learnerModelV1: resolveFeatureFlag(
    buildEnvironment.VITE_FEATURE_LEARNER_MODEL_V1,
    false
  ),
  memoryCenterV1: resolveFeatureFlag(
    buildEnvironment.VITE_FEATURE_MEMORY_CENTER_V1,
    false
  ),
  agentThreadsV1: resolveFeatureFlag(
    buildEnvironment.VITE_FEATURE_AGENT_THREADS_V1,
    true
  )
})
