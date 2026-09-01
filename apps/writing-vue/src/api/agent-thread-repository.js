import { invokeCommand, unwrapCommandResponse } from '@/api/tauri-bridge.js'

// M12 agent thread / planner / approval surface. Every export is one
// capability already registered in src-tauri/src/lib.rs invoke_handler.
// The single-user desktop app identifies users as 'local' (same convention
// as memory-repository.js).

const LOCAL_USER_ID = 'local'

export async function createAgentThread(title, threadKind = 'workspace') {
  const response = await invokeCommand('agent_thread_create', {
    command: { userId: LOCAL_USER_ID, threadKind, title }
  })
  return unwrapCommandResponse(response, 'agent_thread_create')
}

export async function listAgentThreads(limit = 50) {
  const response = await invokeCommand('agent_thread_list', {
    userId: LOCAL_USER_ID,
    limit
  })
  return unwrapCommandResponse(response, 'agent_thread_list')
}

export async function listThreadMessages(threadId, limit = 200) {
  const response = await invokeCommand('agent_thread_list_messages', {
    threadId,
    limit
  })
  return unwrapCommandResponse(response, 'agent_thread_list_messages')
}

export async function appendThreadMessage(threadId, role, content, payload = null) {
  const response = await invokeCommand('agent_thread_append_message', {
    command: { threadId, role, content, payload }
  })
  return unwrapCommandResponse(response, 'agent_thread_append_message')
}

export async function archiveAgentThread(threadId) {
  const response = await invokeCommand('agent_thread_archive', { threadId })
  return unwrapCommandResponse(response, 'agent_thread_archive')
}

export async function listPendingApprovals(limit = 50) {
  const response = await invokeCommand('agent_approval_list', { limit })
  return unwrapCommandResponse(response, 'agent_approval_list')
}

export async function decideApproval(approvalId, status, approvedBy = 'local') {
  const response = await invokeCommand('agent_approval_decide', {
    command: { approvalId, status, approvedBy }
  })
  return unwrapCommandResponse(response, 'agent_approval_decide')
}

export async function listStudyPlanItems(planId) {
  const response = await invokeCommand('study_plan_list_items', { planId })
  return unwrapCommandResponse(response, 'study_plan_list_items')
}

export async function markStudyPlanItemDone(itemId, done = true) {
  const response = await invokeCommand('study_plan_mark_done', {
    command: { itemId, done }
  })
  return unwrapCommandResponse(response, 'study_plan_mark_done')
}

export const agentThreadRepository = {
  createThread: createAgentThread,
  listThreads: listAgentThreads,
  listMessages: listThreadMessages,
  appendMessage: appendThreadMessage,
  archiveThread: archiveAgentThread,
  listApprovals: listPendingApprovals,
  decideApproval,
  listPlanItems: listStudyPlanItems,
  markPlanItemDone: markStudyPlanItemDone
}

export default agentThreadRepository
