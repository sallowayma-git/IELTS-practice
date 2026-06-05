const stylePromises = new Map<string, Promise<void>>()
const scriptPromises = new Map<string, Promise<void>>()

function normalizeLegacyPath(relativePath: string) {
  return String(relativePath || '').replace(/^\/+/, '')
}

function buildPromiseKey(markerAttribute: string, relativePath: string) {
  return `${markerAttribute}::${relativePath}`
}

function findExistingElement(tagName: string, markerAttribute: string, relativePath: string) {
  return document.querySelector(`${tagName}[${markerAttribute}="${relativePath}"]`)
}

export function resolveLegacyAssetUrl(relativePath: string) {
  const normalized = normalizeLegacyPath(relativePath)
  try {
    const currentUrl = new URL(window.location.href)
    if (currentUrl.pathname.includes('/dist/writing/')) {
      return new URL(`../../${normalized}`, currentUrl.href).href
    }
  } catch (_) {}
  return `/${normalized}`
}

export function loadLegacyStyle(
  relativePath: string,
  options: { markerAttribute?: string, errorPrefix?: string } = {}
) {
  const markerAttribute = options.markerAttribute || 'data-legacy-style'
  const errorPrefix = options.errorPrefix || '加载 legacy 样式失败：'
  const normalizedPath = normalizeLegacyPath(relativePath)
  const promiseKey = buildPromiseKey(markerAttribute, normalizedPath)

  if (stylePromises.has(promiseKey)) {
    return stylePromises.get(promiseKey)
  }

  const href = resolveLegacyAssetUrl(normalizedPath)
  const existing = findExistingElement('link', markerAttribute, normalizedPath)
  if (existing) {
    const promise = Promise.resolve()
    stylePromises.set(promiseKey, promise)
    return promise
  }

  const promise = new Promise<void>((resolve, reject) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.setAttribute(markerAttribute, normalizedPath)
    link.onload = () => resolve()
    link.onerror = () => {
      stylePromises.delete(promiseKey)
      reject(new Error(`${errorPrefix}${normalizedPath}`))
    }
    document.head.appendChild(link)
  })

  stylePromises.set(promiseKey, promise)
  return promise
}

export function loadLegacyScript(
  relativePath: string,
  options: { markerAttribute?: string, errorPrefix?: string } = {}
) {
  const markerAttribute = options.markerAttribute || 'data-legacy-script'
  const errorPrefix = options.errorPrefix || '加载 legacy 脚本失败：'
  const normalizedPath = normalizeLegacyPath(relativePath)
  const promiseKey = buildPromiseKey(markerAttribute, normalizedPath)

  if (scriptPromises.has(promiseKey)) {
    return scriptPromises.get(promiseKey)
  }

  const existing = findExistingElement('script', markerAttribute, normalizedPath)
  if (existing) {
    const promise = Promise.resolve()
    scriptPromises.set(promiseKey, promise)
    return promise
  }

  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = resolveLegacyAssetUrl(normalizedPath)
    script.async = false
    script.setAttribute(markerAttribute, normalizedPath)
    script.onload = () => resolve()
    script.onerror = () => {
      scriptPromises.delete(promiseKey)
      reject(new Error(`${errorPrefix}${normalizedPath}`))
    }
    document.head.appendChild(script)
  })

  scriptPromises.set(promiseKey, promise)
  return promise
}
