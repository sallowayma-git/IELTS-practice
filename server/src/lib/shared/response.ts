import type { FastifyReply } from 'fastify'
import { resolveHttpStatus, toErrorEnvelope } from './errors.js'

export function sendSuccess(reply: FastifyReply, data: unknown) {
  return reply.send({ success: true, data })
}

export function sendError(reply: FastifyReply, error: unknown, fallbackCode: string) {
  return reply.code(resolveHttpStatus(error)).send(toErrorEnvelope(error, fallbackCode))
}
