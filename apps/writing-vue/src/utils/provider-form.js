export const PROVIDER_DEFAULTS = Object.freeze({
  openai: {
    base_url: 'https://api.openai.com/v1'
  },
  openrouter: {
    base_url: 'https://openrouter.ai/api/v1'
  },
  deepseek: {
    base_url: 'https://api.deepseek.com/v1'
  }
})

export function normalizeProviderUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '')
}

export function getProviderDefaultBaseUrl(provider) {
  return PROVIDER_DEFAULTS[provider]?.base_url || ''
}

export function isProviderDefaultUrl(provider, url) {
  const expected = getProviderDefaultBaseUrl(provider)
  if (!expected) return false
  return normalizeProviderUrl(url) === normalizeProviderUrl(expected)
}

export function resolveProviderBaseUrlOnChange({ provider, currentBaseUrl, isLinked }) {
  if (!isLinked) {
    return String(currentBaseUrl || '')
  }
  return getProviderDefaultBaseUrl(provider) || String(currentBaseUrl || '')
}
