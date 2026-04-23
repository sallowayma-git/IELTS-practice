import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import type { ServiceBundle } from './types/api.js'
import { registerManagementRoutes } from './routes/management.js'
import { registerReadingRoutes } from './routes/reading.js'
import { registerWritingRoutes } from './routes/writing.js'

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

  await registerManagementRoutes(app, services)
  await registerReadingRoutes(app, services)
  await registerWritingRoutes(app, services)

  return app
}
