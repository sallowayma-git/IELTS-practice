import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import type { ServiceBundle } from './types/api.js'
import { registerManagementRoutes } from './routes/management.js'
import { registerPracticeRoutes } from './routes/practice.js'
import { registerReadingRoutes } from './routes/reading.js'
import { registerWritingRoutes } from './routes/writing.js'
import { PracticeService } from './lib/practice/service.js'

export async function createServerApp(services: ServiceBundle): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false
  })

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin
    reply.header('Access-Control-Allow-Origin', origin || '*')
    reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    if (request.method === 'OPTIONS') {
      reply.code(204).send()
      return reply
    }
  })

  app.get('/health', async () => ({
    success: true,
    data: {
      status: 'ok',
      runtime: 'electron-local-fastify'
    }
  }))

  const practiceService = new PracticeService(services)

  await registerManagementRoutes(app, services)
  await registerPracticeRoutes(app, services, practiceService)
  await registerReadingRoutes(app, services, practiceService)
  await registerWritingRoutes(app, services)

  return app
}
