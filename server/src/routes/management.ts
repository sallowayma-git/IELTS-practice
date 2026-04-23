import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ServiceBundle } from '../types/api.js'
import { resolveHttpStatus, toErrorEnvelope } from '../lib/shared/errors.js'

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20)
})

function normalizeUploadBody(body: unknown) {
  const payload = (body && typeof body === 'object') ? { ...(body as Record<string, unknown>) } : {}
  const rawData = payload.data

  if (Buffer.isBuffer(rawData)) {
    return payload
  }

  if (Array.isArray(rawData)) {
    payload.data = Buffer.from(rawData)
    return payload
  }

  if (typeof rawData === 'string' && rawData.trim()) {
    payload.data = Buffer.from(rawData, 'base64')
    return payload
  }

  if (rawData && typeof rawData === 'object') {
    const numericKeys = Object.keys(rawData)
      .filter((key) => /^\d+$/.test(key))
      .sort((left, right) => Number(left) - Number(right))

    if (numericKeys.length > 0) {
      payload.data = Buffer.from(numericKeys.map((key) => Number((rawData as Record<string, unknown>)[key] || 0)))
    }
  }

  return payload
}

async function respond<T>(reply: any, task: () => Promise<T>) {
  try {
    const data = await task()
    reply.send({ success: true, data })
  } catch (error) {
    reply.code(resolveHttpStatus(error)).send(toErrorEnvelope(error))
  }
}

export async function registerManagementRoutes(app: FastifyInstance, services: ServiceBundle) {
  app.get('/api/configs', async (_request, reply) => respond(reply, () => services.configService.list()))
  app.post('/api/configs', async (request, reply) => respond(reply, () => services.configService.create(request.body || {})))
  app.put('/api/configs/:id', async (request, reply) => respond(reply, async () => {
    const id = Number((request.params as Record<string, unknown>).id)
    const body = (request.body || {}) as Record<string, unknown>
    const updates = { ...body }
    const shouldSetDefault = Number(body.is_default) === 1
    delete updates.is_default
    if (Object.keys(updates).length > 0) {
      await services.configService.update(id, updates)
    }
    if (shouldSetDefault) {
      await services.configService.setDefault(id)
    }
    return true
  }))
  app.delete('/api/configs/:id', async (request, reply) => respond(reply, () => services.configService.delete(Number((request.params as Record<string, unknown>).id))))
  app.post('/api/configs/:id/test', async (request, reply) => respond(reply, () => services.configService.test(Number((request.params as Record<string, unknown>).id))))
  app.post('/api/configs/:id/default', async (request, reply) => respond(reply, () => services.configService.setDefault(Number((request.params as Record<string, unknown>).id))))
  app.post('/api/configs/:id/toggle-enabled', async (request, reply) => respond(reply, () => services.configService.toggleEnabled(Number((request.params as Record<string, unknown>).id))))

  app.get('/api/prompts/active', async (request, reply) => respond(reply, () => services.promptService.getActive(String((request.query as Record<string, unknown>).taskType || (request.query as Record<string, unknown>).task_type || 'task2'))))
  app.get('/api/prompts', async (request, reply) => respond(reply, () => services.promptService.listAll(String((request.query as Record<string, unknown>).taskType || (request.query as Record<string, unknown>).task_type || '') || null)))
  app.post('/api/prompts/import', async (request, reply) => respond(reply, () => services.promptService.import(request.body || {})))
  app.get('/api/prompts/export', async (_request, reply) => respond(reply, () => services.promptService.exportActive()))
  app.put('/api/prompts/:id/activate', async (request, reply) => respond(reply, () => services.promptService.activate(Number((request.params as Record<string, unknown>).id))))
  app.delete('/api/prompts/:id', async (request, reply) => respond(reply, () => services.promptService.delete(Number((request.params as Record<string, unknown>).id))))

  app.get('/api/topics', async (request, reply) => respond(reply, async () => {
    const query = (request.query || {}) as Record<string, unknown>
    const pagination = paginationSchema.parse({
      page: query.page,
      limit: query.limit
    })
    const filters = { ...query }
    delete filters.page
    delete filters.limit
    return services.topicService.list(filters, pagination)
  }))
  app.get('/api/topics/:id', async (request, reply) => respond(reply, () => services.topicService.getById(Number((request.params as Record<string, unknown>).id))))
  app.post('/api/topics', async (request, reply) => respond(reply, () => services.topicService.create(request.body || {})))
  app.put('/api/topics/:id', async (request, reply) => respond(reply, () => services.topicService.update(Number((request.params as Record<string, unknown>).id), request.body || {})))
  app.delete('/api/topics/:id', async (request, reply) => respond(reply, () => services.topicService.delete(Number((request.params as Record<string, unknown>).id))))
  app.post('/api/topics/batch-import', async (request, reply) => respond(reply, () => services.topicService.batchImport(Array.isArray(request.body) ? request.body : ((request.body as Record<string, unknown>)?.topics as any[] || []))))
  app.get('/api/topics/statistics', async (_request, reply) => respond(reply, () => services.topicService.getStatistics()))

  app.get('/api/essays', async (request, reply) => respond(reply, async () => {
    const query = (request.query || {}) as Record<string, unknown>
    const pagination = paginationSchema.parse({
      page: query.page,
      limit: query.limit
    })
    const filters = { ...query }
    delete filters.page
    delete filters.limit
    return services.essayService.list(filters, pagination)
  }))
  app.get('/api/essays/:id', async (request, reply) => respond(reply, () => services.essayService.getById(Number((request.params as Record<string, unknown>).id))))
  app.post('/api/essays', async (request, reply) => respond(reply, () => services.essayService.create(request.body || {})))
  app.delete('/api/essays/:id', async (request, reply) => respond(reply, () => services.essayService.delete(Number((request.params as Record<string, unknown>).id))))
  app.post('/api/essays/batch-delete', async (request, reply) => respond(reply, () => services.essayService.batchDelete(((request.body as Record<string, unknown>)?.ids as number[]) || [])))
  app.delete('/api/essays/all', async (_request, reply) => respond(reply, () => services.essayService.deleteAll()))
  app.get('/api/essays/statistics', async (request, reply) => respond(reply, () => services.essayService.getStatistics((request.query as Record<string, unknown>).range, (request.query as Record<string, unknown>).taskType)))
  app.get('/api/essays/export', async (request, reply) => respond(reply, () => services.essayService.exportCSV(request.query || {})))

  app.get('/api/settings', async (request, reply) => {
    const query = (request.query || {}) as Record<string, unknown>
    if (typeof query.key === 'string' && query.key.trim()) {
      return respond(reply, () => services.settingsService.get(query.key))
    }
    return respond(reply, () => services.settingsService.getAll())
  })
  app.put('/api/settings', async (request, reply) => respond(reply, () => services.settingsService.update(request.body || {})))
  app.post('/api/settings/reset', async (_request, reply) => respond(reply, () => services.settingsService.reset()))

  app.post('/api/upload/image', async (request, reply) => respond(reply, () => services.uploadService.uploadImage(normalizeUploadBody(request.body))))
  app.delete('/api/upload/image/:filename', async (request, reply) => respond(reply, () => services.uploadService.deleteImage(String((request.params as Record<string, unknown>).filename || ''))))
  app.get('/api/upload/image/:filename/path', async (request, reply) => respond(reply, () => services.uploadService.getImagePath(String((request.params as Record<string, unknown>).filename || ''))))
}
