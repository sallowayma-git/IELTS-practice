/**
 * Stable keys for server-owned reading mode transitions.
 *
 * A retry must describe the same session passage after a reload; randomness
 * belongs only to create operations, never to a submitted transition.
 */
export function endlessSubmitIdempotencyKey(sessionId, assetId) {
  const session = String(sessionId || '').trim()
  const asset = String(assetId || '').trim()
  if (!session || !asset) {
    throw new Error('endless sessionId and assetId are required')
  }
  return `endless-submit:${session}:${asset}`
}
