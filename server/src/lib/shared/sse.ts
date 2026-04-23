import type { FastifyReply } from 'fastify'

export function beginSse(reply: FastifyReply) {
  reply.hijack()
  const raw = reply.raw
  raw.setHeader('Content-Type', 'text/event-stream')
  raw.setHeader('Cache-Control', 'no-cache')
  raw.setHeader('Connection', 'keep-alive')
  raw.setHeader('Access-Control-Allow-Origin', '*')
  raw.flushHeaders?.()

  let closed = false
  raw.on('close', () => {
    closed = true
  })

  return {
    isClosed() {
      return closed
    },
    write(type: string, payload: Record<string, unknown> = {}) {
      if (closed) return
      raw.write(`event: ${type}\n`)
      raw.write(`data: ${JSON.stringify(payload)}\n\n`)
    },
    end() {
      if (closed) return
      closed = true
      raw.end()
    }
  }
}
