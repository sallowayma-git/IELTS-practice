import { invokeCommand, unwrapCommandResponse } from './tauri-bridge.js'

export async function getLearnerState(query = {}) {
  const response = await invokeCommand('learner_model_get_state', { query })
  return unwrapCommandResponse(response, 'learner_model_get_state')
}

export async function getLearnerReviewNeeds(query = {}) {
  const response = await invokeCommand('learner_model_get_review_needs', { query })
  return unwrapCommandResponse(response, 'learner_model_get_review_needs')
}
