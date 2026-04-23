import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ServiceBundle } from '../types/api.js'
import { WritingEvaluationService } from '../lib/writing/service.js'
import { beginSse } from '../lib/shared/sse.js'
import { resolveHttpStatus, toErrorEnvelope } from '../lib/shared/errors.js'

const createRequestSchema = z.object({
  task_type: z.enum(['task1', 'task2']),
  topic_id: z.coerce.number().int().positive().nullable().optional(),
  topic_text: z.string().trim().max(8000).nullable().optional(),
  content: z.string().trim().min(1).max(50000),
  word_count: z.coerce.number().int().nonnegative().nullable().optional(),
  config_id: z.coerce.number().int().positive().nullable().optional(),
  api_config_id: z.coerce.number().int().positive().nullable().optional(),
  prompt_version: z.string().trim().max(255).nullable().optional()
})

export async function registerWritingRoutes(app: FastifyInstance, services: ServiceBundle) {
  const service = new WritingEvaluationService(services)

  app.post('/api/writing/evaluations', async (request, reply) => {
    try {
      const payload = createRequestSchema.parse(request.body || {})
      const result = await service.create(payload)
      reply.send({
        success: true,
        data: {
          sessionId: result.sessionId
        }
      })
    } catch (error) {
      reply.code(resolveHttpStatus(error)).send(toErrorEnvelope(error))
    }
  })

  app.get('/api/writing/evaluations/:sessionId', async (request, reply) => {
    try {
      const sessionId = String((request.params as Record<string, unknown>).sessionId || '').trim()
      const data = await service.getSessionState(sessionId)
      reply.send({ success: true, data })
    } catch (error) {
      reply.code(resolveHttpStatus(error)).send(toErrorEnvelope(error))
    }
  })

  app.get('/api/writing/evaluations/:sessionId/stream', async (request, reply) => {
    const sessionId = String((request.params as Record<string, unknown>).sessionId || '').trim()
    const stream = beginSse(reply)
    stream.write('start', { ts: Date.now(), sessionId })

    const unsubscribe = service.subscribe(sessionId, (event) => {
      stream.write(String(event.type || 'progress'), {
        ...event,
        ts: typeof event.ts === 'number' ? event.ts : Date.now(),
        sessionId
      })
    })

    const heartbeat = setInterval(() => {
      stream.write('heartbeat', { ts: Date.now(), sessionId })
    }, 25000)

    reply.raw.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
  })

  app.delete('/api/writing/evaluations/:sessionId', async (request, reply) => {
    try {
      const sessionId = String((request.params as Record<string, unknown>).sessionId || '').trim()
      const data = await service.cancel(sessionId)
      reply.send({ success: true, data })
    } catch (error) {
      reply.code(resolveHttpStatus(error)).send(toErrorEnvelope(error))
    }
  })
}
