export function touchCacheEntry<K, V>(cache: Map<K, V>, key: K): V | null {
  if (!cache.has(key)) {
    return null
  }
  const value = cache.get(key) as V
  cache.delete(key)
  cache.set(key, value)
  return value
}

export function setBoundedCacheEntry<K, V>(cache: Map<K, V>, key: K, value: V, limit: number): K[] {
  const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0
  const evictedKeys: K[] = []
  if (cache.has(key)) {
    cache.delete(key)
    if (normalizedLimit <= 0) {
      evictedKeys.push(key)
    }
  }
  if (normalizedLimit <= 0) {
    return evictedKeys
  }
  cache.set(key, value)
  while (cache.size > normalizedLimit) {
    const oldestKey = cache.keys().next().value
    if (oldestKey === undefined) {
      break
    }
    cache.delete(oldestKey)
    evictedKeys.push(oldestKey)
  }
  return evictedKeys
}
