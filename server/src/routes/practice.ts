import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ServiceBundle } from '../types/api.js'
import { PracticeService } from '../lib/practice/service.js'
import { beginSse } from '../lib/shared/sse.js'
import { toErrorEnvelope } from '../lib/shared/errors.js'
import { sendError, sendSuccess } from '../lib/shared/response.js'

const listAssetsSchema = z.object({
  activity: z.enum(['reading', 'writing']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).default(20),
  refresh: z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value === 'string') {
      return ['1', 'true', 'yes', 'force', 'refresh'].includes(value.trim().toLowerCase())
    }
    return value === true || value === 1
  }, z.boolean().default(false))
})

const listHistorySchema = z.object({
  activity: z.enum(['reading', 'writing']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).default(20)
})

const archiveHistorySchema = z.object({
  activity: z.enum(['reading']).default('reading')
})

const getAssetSchema = z.object({
  refresh: z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value === 'string') {
      return ['1', 'true', 'yes', 'force', 'refresh'].includes(value.trim().toLowerCase())
    }
    return value === true || value === 1
  }, z.boolean().default(false))
})

const createSessionSchema = z.object({
  activity: z.enum(['reading', 'writing']),
  assetId: z.union([z.string(), z.number()]).nullable().optional(),
  attempt: z.record(z.string(), z.unknown()).optional(),
  settings: z.record(z.string(), z.unknown()).optional()
})

const createReadingSuiteSchema = z.object({
  flowMode: z.enum(['classic', 'simulation', 'stationary']).optional(),
  frequencyScope: z.enum(['high', 'high_medium', 'all', 'custom']).optional(),
  seed: z.string().trim().nullable().optional(),
  sequence: z.array(z.union([
    z.string().trim(),
    z.object({
      assetId: z.string().trim().nullable().optional(),
      examId: z.string().trim().nullable().optional(),
      id: z.string().trim().nullable().optional()
    }).passthrough()
  ])).nullable().optional(),
  timer: z.object({
    anchorMs: z.coerce.number().int().positive().optional(),
    effectiveStartTimeMs: z.coerce.number().int().positive().optional(),
    mode: z.enum(['elapsed', 'countdown']).optional(),
    limitSeconds: z.coerce.number().int().min(0).nullable().optional(),
    pausedOffsetMs: z.coerce.number().int().min(0).optional(),
    pausedAtMs: z.coerce.number().int().positive().nullable().optional(),
    running: z.boolean().optional()
  }).passthrough().nullable().optional()
})

const submitReadingSuitePassageSchema = z.object({
  attempt: z.record(z.string(), z.unknown()).optional(),
  settings: z.record(z.string(), z.unknown()).optional()
})

const coachSchema = z.object({
  activity: z.enum(['reading', 'writing']),
  sessionId: z.string().trim().optional(),
  payload: z.record(z.string(), z.unknown()).optional()
}).passthrough()

function getParam(request: { params: unknown }, key: string) {
  return String((request.params as Record<string, unknown>)?.[key] || '').trim()
}

function getCoachSessionId(body: { sessionId?: string }, payload: Record<string, unknown>) {
  return typeof body.sessionId === 'string' && body.sessionId.trim()
    ? body.sessionId.trim()
    : (typeof payload.sessionId === 'string' && payload.sessionId.trim() ? payload.sessionId.trim() : null)
}

export async function registerPracticeRoutes(
  app: FastifyInstance,
  services: ServiceBundle,
  service = new PracticeService(services)
) {

  app.get('/api/practice/migration-status', async (_request, reply) => {
    try {
      sendSuccess(reply, service.getMigrationStatus())
    } catch (error) {
      sendError(reply, error, 'practice_migration_status_failed')
    }
  })

  app.get('/api/practice/assets', async (request, reply) => {
    try {
      const query = listAssetsSchema.parse(request.query || {})
      const data = await service.listAssets(query)
      sendSuccess(reply, data)
    } catch (error) {
      sendError(reply, error, 'practice_assets_failed')
    }
  })

  app.get('/api/practice/assets/:activity/:assetId', async (request, reply) => {
    try {
      const query = getAssetSchema.parse(request.query || {})
      const data = await service.getAsset(getParam(request, 'activity'), getParam(request, 'assetId'), query)
      sendSuccess(reply, data)
    } catch (error) {
      sendError(reply, error, 'practice_asset_failed')
    }
  })

  app.get('/api/practice/history', async (request, reply) => {
    try {
      const query = listHistorySchema.parse(request.query || {})
      const data = await service.listHistory(query)
      sendSuccess(reply, data)
    } catch (error) {
      sendError(reply, error, 'practice_history_failed')
    }
  })

  app.get('/api/practice/history/archive', async (request, reply) => {
    try {
      const query = archiveHistorySchema.parse(request.query || {})
      const data = await service.exportHistoryArchive(query)
      sendSuccess(reply, data)
    } catch (error) {
      sendError(reply, error, 'practice_history_archive_failed')
    }
  })

  app.post('/api/practice/history/archive/:activity', async (request, reply) => {
    try {
      const data = await service.importHistoryArchive(getParam(request, 'activity'), request.body || {})
      sendSuccess(reply, data)
    } catch (error) {
      sendError(reply, error, 'practice_history_import_failed')
    }
  })

  app.delete('/api/practice/history', async (request, reply) => {
    try {
      const query = listHistorySchema.pick({ activity: true }).parse(request.query || {})
      const data = await service.clearHistory(query)
      sendSuccess(reply, data)
    } catch (error) {
      sendError(reply, error, 'practice_history_clear_failed')
    }
  })

  app.get('/api/practice/history/:activity/:recordId', async (request, reply) => {
    try {
      const data = await service.getHistoryRecord(getParam(request, 'activity'), getParam(request, 'recordId'))
      sendSuccess(reply, data)
    } catch (error) {
      sendError(reply, error, 'practice_history_record_failed')
    }
  })

  app.delete('/api/practice/history/:activity/:recordId', async (request, reply) => {
    try {
      const data = await service.deleteHistoryRecord(getParam(request, 'activity'), getParam(request, 'recordId'))
      sendSuccess(reply, data)
    } catch (error) {
      sendError(reply, error, 'practice_history_delete_failed')
    }
  })

  app.post('/api/practice/sessions', async (request, reply) => {
    try {
      const payload = createSessionSchema.parse(request.body || {})
      const data = await service.createSession(payload)
      sendSuccess(reply, data)
    } catch (error) {
      sendError(reply, error, 'practice_session_create_failed')
    }
  })

  app.post('/api/practice/reading-suite', async (request, reply) => {
    try {
      const payload = createReadingSuiteSchema.parse(request.body || {})
      const data = await service.createReadingSuite(payload)
      sendSuccess(reply, data)
    } catch (error) {
      sendError(reply, error, 'practice_reading_suite_create_failed')
    }
  })

  app.get('/api/practice/reading-suite/:sessionId', async (request, reply) => {
    try {
      const data = await service.getReadingSuite(getParam(request, 'sessionId'))
      sendSuccess(reply, data)
    } catch (error) {
      sendError(reply, error, 'practice_reading_suite_state_failed')
    }
  })

  app.post('/api/practice/reading-suite/:sessionId/passages/:assetId', async (request, reply) => {
    try {
      const payload = submitReadingSuitePassageSchema.parse(request.body || {})
      const data = await service.submitReadingSuitePassage(
        getParam(request, 'sessionId'),
        getParam(request, 'assetId'),
        payload.attempt || {},
        payload.settings || {}
      )
      sendSuccess(reply, data)
    } catch (error) {
      sendError(reply, error, 'practice_reading_suite_submit_failed')
    }
  })

  app.get('/api/practice/sessions/:activity/:sessionId', async (request, reply) => {
    try {
      const data = await service.getSessionState(getParam(request, 'activity'), getParam(request, 'sessionId'))
      sendSuccess(reply, data)
    } catch (error) {
      sendError(reply, error, 'practice_session_state_failed')
    }
  })

  app.get('/api/practice/sessions/:activity/:sessionId/stream', async (request, reply) => {
    const activity = getParam(request, 'activity')
    const sessionId = getParam(request, 'sessionId')
    const stream = beginSse(reply)
    stream.write('start', { ts: Date.now(), sessionId, activity })

    let unsubscribe = () => {}
    try {
      unsubscribe = service.subscribeSession(activity, sessionId, (event) => {
        stream.write(String(event.type || 'progress'), {
          ...event,
          ts: typeof event.ts === 'number' ? event.ts : Date.now(),
          sessionId,
          activity
        })
      })
    } catch (error) {
      stream.write('error', {
        ts: Date.now(),
        sessionId,
        activity,
        success: false,
        error: toErrorEnvelope(error, 'practice_session_stream_failed')
      })
      stream.end()
      return
    }

    const heartbeat = setInterval(() => {
      stream.write('heartbeat', { ts: Date.now(), sessionId, activity })
    }, 25000)

    reply.raw.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
  })

  app.delete('/api/practice/sessions/:activity/:sessionId', async (request, reply) => {
    try {
      const data = await service.cancelSession(getParam(request, 'activity'), getParam(request, 'sessionId'))
      sendSuccess(reply, data)
    } catch (error) {
      sendError(reply, error, 'practice_session_cancel_failed')
    }
  })

  app.post('/api/practice/coach', async (request, reply) => {
    try {
      const body = coachSchema.parse(request.body || {})
      const activity = body.activity
      const payload = body.payload && typeof body.payload === 'object'
        ? body.payload
        : Object.fromEntries(Object.entries(body).filter(([key]) => !['activity', 'sessionId', 'payload'].includes(key)))
      const data = await service.coach(activity, payload, undefined, getCoachSessionId(body, payload))
      sendSuccess(reply, data)
    } catch (error) {
      sendError(reply, error, 'practice_coach_failed')
    }
  })

  app.post('/api/practice/coach/stream', async (request, reply) => {
    let body
    try {
      body = coachSchema.parse(request.body || {})
    } catch (error) {
      sendError(reply, error, 'invalid_request')
      return
    }

    const activity = body.activity
    const payload = body.payload && typeof body.payload === 'object'
      ? body.payload
      : Object.fromEntries(Object.entries(body).filter(([key]) => !['activity', 'sessionId', 'payload'].includes(key)))
    const sessionId = getCoachSessionId(body, payload) || ''
    const stream = beginSse(reply)
    stream.write('start', { ts: Date.now(), sessionId, activity })

    try {
      const data = await service.coach(activity, payload, (event) => {
        stream.write(String(event.type || 'progress'), {
          ...event,
          sessionId,
          activity
        })
      }, sessionId || null)
      stream.write('complete', {
        ts: Date.now(),
        sessionId,
        activity,
        success: true,
        data
      })
    } catch (error) {
      stream.write('error', {
        ts: Date.now(),
        sessionId,
        activity,
        success: false,
        error: toErrorEnvelope(error, 'practice_coach_failed')
      })
    } finally {
      stream.end()
    }
  })
}
