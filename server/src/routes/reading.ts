import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ServiceBundle } from '../types/api.js'
import { ReadingAssistantService } from '../lib/reading/service.js'
import { beginSse } from '../lib/shared/sse.js'
import { resolveHttpStatus, toErrorEnvelope } from '../lib/shared/errors.js'

const requestSchema = z.object({
  examId: z.string().trim().min(1),
  query: z.string().trim().max(12000).optional(),
  userQuery: z.string().trim().max(12000).optional(),
  locale: z.enum(['zh', 'en']).default('zh').optional(),
  surface: z.enum(['chat_widget', 'selection_popover', 'review_workspace']).optional(),
  action: z.enum([
    'chat',
    'translate',
    'explain_selection',
    'find_paraphrases',
    'find_antonyms',
    'extract_keywords',
    'locate_evidence',
    'analyze_mistake',
    'review_set',
    'recommend_drills'
  ]).optional(),
  promptKind: z.enum(['preset', 'freeform', 'followup']).optional(),
  selectedText: z.string().trim().max(2000).optional(),
  selectedContext: z.object({
    text: z.string().trim().max(2000).optional(),
    scope: z.enum(['passage', 'question']).optional(),
    questionNumbers: z.array(z.string().trim()).max(15).optional(),
    paragraphLabels: z.array(z.string().trim()).max(8).optional()
  }).nullable().optional(),
  focusQuestionNumbers: z.array(z.string().trim()).max(30).optional(),
  history: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string().trim().min(1).max(1200)
    })
  ).max(8).optional(),
  attemptContext: z.object({
    submitted: z.boolean().optional(),
    score: z.number().nullable().optional(),
    wrongQuestions: z.array(z.string().trim()).max(30).optional(),
    selectedAnswers: z.record(z.string(), z.string()).optional()
  }).optional()
})

export async function registerReadingRoutes(app: FastifyInstance, services: ServiceBundle) {
  const service = new ReadingAssistantService(services)

  app.post('/api/reading/assistant/query', async (request, reply) => {
    try {
      const payload = requestSchema.parse(request.body || {})
      const data = await service.query(payload)
      reply.send({ success: true, data })
    } catch (error) {
      reply.code(resolveHttpStatus(error)).send(toErrorEnvelope(error))
    }
  })

  app.post('/api/reading/assistant/query/stream', async (request, reply) => {
    let payload
    try {
      payload = requestSchema.parse(request.body || {})
    } catch (error) {
      reply.code(resolveHttpStatus(error)).send(toErrorEnvelope(error, 'invalid_request'))
      return
    }

    const stream = beginSse(reply)
    stream.write('start', { ts: Date.now(), requestId: payload.examId })

    try {
      const data = await service.query(payload, (event) => {
        stream.write(String(event.type || 'progress'), {
          ...event,
          requestId: payload.examId
        })
      })
      stream.write('complete', {
        ts: Date.now(),
        requestId: payload.examId,
        success: true,
        data
      })
    } catch (error) {
      const envelope = toErrorEnvelope(error, 'reading_assistant_failed')
      stream.write('error', {
        ts: Date.now(),
        requestId: payload.examId,
        success: false,
        error: envelope
      })
    } finally {
      stream.end()
    }
  })
}
