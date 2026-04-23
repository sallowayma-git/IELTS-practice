/**
 * 本地 Fastify API 适配层
 * 统一封装写作模块的 HTTP / SSE 调用
 */

const LOCAL_API_INFO_STORAGE_KEY = 'writing_local_api_info_v1'
const evaluationListeners = new Map()
const evaluationStreams = new Map()
let cachedBaseUrl = ''
let cachedBaseUrlPromise = null
let listenerSequence = 0

const ERROR_MESSAGES = {
    invalid_api_key: 'API 密钥无效，请前往设置页面检查配置',
    insufficient_quota: 'API 余额不足，请充值后重试',
    rate_limit_exceeded: '请求频率超限，请稍后重试',
    rate_limited: '请求频率超限，请稍后重试',
    model_not_found: '模型不存在，请检查模型名称配置',
    timeout: '请求超时（240秒），请检查网络连接或稍后重试',
    network_error: '网络连接失败，请检查网络设置',
    server_error: 'LLM 服务商服务异常，请稍后重试',
    invalid_response_format: '评分数据解析失败，请点击"重试"按钮',
    start_failed: '启动评测失败，请重试',
    unknown_error: '未知错误，请重试'
}

export function getErrorMessage(code) {
    return ERROR_MESSAGES[code] || ERROR_MESSAGES.unknown_error
}

export function isAPIAvailable() {
    return Boolean(
        typeof window !== 'undefined'
        && window.electronAPI
        && typeof window.electronAPI.getLocalApiInfo === 'function'
    )
}

function getStorageList() {
    if (typeof window === 'undefined') {
        return []
    }
    return [window.sessionStorage, window.localStorage].filter(Boolean)
}

function readCachedBaseUrl() {
    if (cachedBaseUrl) {
        return cachedBaseUrl
    }
    const stores = getStorageList()
    for (let index = 0; index < stores.length; index += 1) {
        const store = stores[index]
        try {
            const raw = store.getItem(LOCAL_API_INFO_STORAGE_KEY)
            if (!raw) {
                continue
            }
            const parsed = JSON.parse(raw)
            const baseUrl = typeof parsed?.baseUrl === 'string' ? parsed.baseUrl.trim() : ''
            if (baseUrl) {
                cachedBaseUrl = baseUrl
                return baseUrl
            }
        } catch (_) {
            // ignore malformed cache
        }
    }
    return ''
}

function persistBaseUrl(baseUrl) {
    const normalized = typeof baseUrl === 'string' ? baseUrl.trim() : ''
    if (!normalized) {
        return
    }
    cachedBaseUrl = normalized
    const serialized = JSON.stringify({
        baseUrl: normalized,
        updatedAt: Date.now()
    })
    getStorageList().forEach((store) => {
        try {
            store.setItem(LOCAL_API_INFO_STORAGE_KEY, serialized)
        } catch (_) {
            // ignore storage failures
        }
    })
}

function clearBaseUrlCache() {
    cachedBaseUrl = ''
    getStorageList().forEach((store) => {
        try {
            store.removeItem(LOCAL_API_INFO_STORAGE_KEY)
        } catch (_) {
            // ignore storage failures
        }
    })
}

async function resolveLocalApiBaseUrl(options = {}) {
    const forceRefresh = Boolean(options.forceRefresh)
    if (!forceRefresh) {
        const cached = readCachedBaseUrl()
        if (cached) {
            return cached
        }
        if (cachedBaseUrlPromise) {
            return cachedBaseUrlPromise
        }
    }

    if (!isAPIAvailable()) {
        throw new Error('本地 API 不可用')
    }

    cachedBaseUrlPromise = window.electronAPI.getLocalApiInfo()
        .then((response) => {
            const baseUrl = typeof response?.data?.baseUrl === 'string'
                ? response.data.baseUrl.trim()
                : ''
            if (!baseUrl) {
                const error = new Error('本地 API 地址不可用')
                error.code = 'local_api_unavailable'
                throw error
            }
            persistBaseUrl(baseUrl)
            return baseUrl
        })
        .catch((error) => {
            clearBaseUrlCache()
            throw normalizeClientError(error, 'local_api_unavailable', '本地 API 地址不可用')
        })
        .finally(() => {
            cachedBaseUrlPromise = null
        })

    return cachedBaseUrlPromise
}

function normalizeJsonPayload(payload) {
    if (ArrayBuffer.isView(payload)) {
        return Array.from(payload)
    }
    if (payload instanceof ArrayBuffer) {
        return Array.from(new Uint8Array(payload))
    }
    if (Array.isArray(payload)) {
        return payload.map((item) => normalizeJsonPayload(item))
    }
    if (!payload || typeof payload !== 'object') {
        return payload
    }
    const normalized = {}
    Object.entries(payload).forEach(([key, value]) => {
        normalized[key] = normalizeJsonPayload(value)
    })
    return normalized
}

function normalizeClientError(errorLike, fallbackCode, fallbackMessage) {
    const message = typeof errorLike?.message === 'string' && errorLike.message.trim()
        ? errorLike.message.trim()
        : fallbackMessage
    const error = errorLike instanceof Error ? errorLike : new Error(message)
    error.code = typeof errorLike?.code === 'string' && errorLike.code.trim()
        ? errorLike.code.trim()
        : fallbackCode
    if (!error.message || !String(error.message).trim()) {
        error.message = fallbackMessage
    }
    return error
}

function buildQuery(params = {}) {
    const search = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
        if (value == null || value === '') {
            return
        }
        search.set(key, String(value))
    })
    const serialized = search.toString()
    return serialized ? `?${serialized}` : ''
}

async function request(path, options = {}) {
    const {
        method = 'GET',
        query,
        body,
        headers = {}
    } = options

    const baseUrl = await resolveLocalApiBaseUrl()
    let response

    try {
        response = await fetch(`${baseUrl}${path}${buildQuery(query)}`, {
            method,
            headers: body === undefined ? headers : {
                'Content-Type': 'application/json',
                ...headers
            },
            body: body === undefined ? undefined : JSON.stringify(normalizeJsonPayload(body))
        })
    } catch (error) {
        throw normalizeClientError(error, 'network_error', '网络连接失败，请检查网络设置')
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase()
    const payload = contentType.includes('application/json')
        ? await response.json().catch(() => ({}))
        : await response.text().catch(() => '')

    if (!response.ok) {
        const normalized = normalizeClientError({
            code: payload?.error || payload?.code || 'server_error',
            message: payload?.message || payload?.error?.message || `HTTP_${response.status}`
        }, 'server_error', '服务请求失败')
        throw normalized
    }

    if (payload && typeof payload === 'object' && payload.success === false) {
        throw normalizeClientError({
            code: payload?.error || payload?.error?.code || 'server_error',
            message: payload?.message || payload?.error?.message || '服务请求失败'
        }, 'server_error', '服务请求失败')
    }

    if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'data')) {
        return payload.data
    }

    return payload
}

function emitEvaluationEvent(event) {
    evaluationListeners.forEach((listener) => {
        try {
            listener(event)
        } catch (error) {
            console.warn('写作评测事件监听器执行失败:', error)
        }
    })
}

function parseSsePayload(rawPayload, fallbackType, sessionId) {
    let parsed = {}
    try {
        parsed = rawPayload ? JSON.parse(rawPayload) : {}
    } catch (_) {
        parsed = {}
    }

    if (!parsed || typeof parsed !== 'object') {
        parsed = {}
    }

    if (!parsed.type) {
        parsed.type = fallbackType
    }
    if (!parsed.sessionId) {
        parsed.sessionId = sessionId
    }
    return parsed
}

async function ensureEvaluationStream(sessionId) {
    const normalizedSessionId = String(sessionId || '').trim()
    if (!normalizedSessionId || evaluationStreams.has(normalizedSessionId)) {
        return
    }

    const baseUrl = await resolveLocalApiBaseUrl()
    const stream = new EventSource(`${baseUrl}/api/writing/evaluations/${encodeURIComponent(normalizedSessionId)}/stream`)
    const close = () => {
        if (!evaluationStreams.has(normalizedSessionId)) {
            return
        }
        stream.close()
        evaluationStreams.delete(normalizedSessionId)
    }

    const bind = (eventType) => {
        stream.addEventListener(eventType, (event) => {
            const payload = parseSsePayload(event.data, eventType, normalizedSessionId)
            emitEvaluationEvent(payload)
            if (payload.type === 'complete' || payload.type === 'error') {
                close()
            }
        })
    }

    ;[
        'start',
        'progress',
        'stage',
        'score',
        'analysis',
        'review',
        'sentence',
        'feedback',
        'complete',
        'error',
        'log',
        'heartbeat'
    ].forEach(bind)

    stream.onerror = () => {
        if (stream.readyState === EventSource.CLOSED) {
            close()
        }
    }

    evaluationStreams.set(normalizedSessionId, { close })
}

function closeEvaluationStream(sessionId) {
    const normalizedSessionId = String(sessionId || '').trim()
    const entry = evaluationStreams.get(normalizedSessionId)
    if (!entry) {
        return
    }
    entry.close()
}

function closeAllEvaluationStreams() {
    Array.from(evaluationStreams.keys()).forEach((sessionId) => {
        closeEvaluationStream(sessionId)
    })
}

export const configs = {
    async list() {
        return request('/api/configs')
    },

    async getDefault() {
        const list = await this.list()
        return list.find((item) => item.is_default) || list[0]
    },

    async create(data) {
        return request('/api/configs', { method: 'POST', body: data })
    },

    async update(id, updates) {
        return request(`/api/configs/${id}`, { method: 'PUT', body: updates })
    },

    async delete(id) {
        return request(`/api/configs/${id}`, { method: 'DELETE' })
    },

    async setDefault(id) {
        return request(`/api/configs/${id}/default`, { method: 'POST' })
    },

    async toggleEnabled(id) {
        return request(`/api/configs/${id}/toggle-enabled`, { method: 'POST' })
    },

    async test(id) {
        return request(`/api/configs/${id}/test`, { method: 'POST' })
    }
}

export const prompts = {
    async getActive(taskType) {
        return request('/api/prompts/active', {
            query: { taskType }
        })
    },

    async import(jsonData) {
        return request('/api/prompts/import', {
            method: 'POST',
            body: jsonData
        })
    },

    async exportActive() {
        return request('/api/prompts/export')
    },

    async listAll(taskType = null) {
        return request('/api/prompts', {
            query: taskType ? { taskType } : {}
        })
    },

    async activate(id) {
        return request(`/api/prompts/${id}/activate`, { method: 'PUT' })
    },

    async delete(id) {
        return request(`/api/prompts/${id}`, { method: 'DELETE' })
    }
}

export const evaluate = {
    async start(payload) {
        const result = await request('/api/writing/evaluations', {
            method: 'POST',
            body: payload
        })
        if (result?.sessionId) {
            void ensureEvaluationStream(result.sessionId).catch((error) => {
                console.warn('写作评测 SSE 连接失败:', error)
            })
        }
        return result
    },

    async cancel(sessionId) {
        const result = await request(`/api/writing/evaluations/${encodeURIComponent(sessionId)}`, {
            method: 'DELETE'
        })
        closeEvaluationStream(sessionId)
        return result
    },

    async getSessionState(sessionId) {
        const result = await request(`/api/writing/evaluations/${encodeURIComponent(sessionId)}`)
        void ensureEvaluationStream(sessionId).catch((error) => {
            console.warn('写作评测状态补连 SSE 失败:', error)
        })
        return result
    },

    onEvent(callback) {
        if (typeof callback !== 'function') {
            return null
        }
        listenerSequence += 1
        const listenerId = `writing_eval_listener_${listenerSequence}`
        evaluationListeners.set(listenerId, callback)
        return listenerId
    },

    removeEventListener(listenerId) {
        if (!listenerId) {
            return
        }
        evaluationListeners.delete(listenerId)
        if (evaluationListeners.size === 0) {
            closeAllEvaluationStreams()
        }
    }
}

export const topics = {
    async list(filters = {}, pagination = { page: 1, limit: 20 }) {
        return request('/api/topics', {
            query: {
                ...filters,
                ...pagination
            }
        })
    },

    async getById(id) {
        return request(`/api/topics/${id}`)
    },

    async create(topicData) {
        return request('/api/topics', {
            method: 'POST',
            body: topicData
        })
    },

    async update(id, updates) {
        return request(`/api/topics/${id}`, {
            method: 'PUT',
            body: updates
        })
    },

    async delete(id) {
        return request(`/api/topics/${id}`, { method: 'DELETE' })
    },

    async batchImport(topicsArray) {
        return request('/api/topics/batch-import', {
            method: 'POST',
            body: topicsArray
        })
    },

    async getStatistics() {
        return request('/api/topics/statistics')
    }
}

export const essays = {
    async list(filters = {}, pagination = { page: 1, limit: 20 }) {
        return request('/api/essays', {
            query: {
                ...filters,
                ...pagination
            }
        })
    },

    async getById(id) {
        return request(`/api/essays/${id}`)
    },

    async create(essayData) {
        return request('/api/essays', {
            method: 'POST',
            body: essayData
        })
    },

    async delete(id) {
        return request(`/api/essays/${id}`, { method: 'DELETE' })
    },

    async batchDelete(ids) {
        return request('/api/essays/batch-delete', {
            method: 'POST',
            body: { ids }
        })
    },

    async deleteAll() {
        return request('/api/essays/all', { method: 'DELETE' })
    },

    async getStatistics(range = 'all', taskType = null) {
        return request('/api/essays/statistics', {
            query: {
                range,
                taskType
            }
        })
    },

    async exportCSV(filters = {}) {
        return request('/api/essays/export', {
            query: filters
        })
    }
}

export const settings = {
    async getAll() {
        return request('/api/settings')
    },

    async get(key) {
        return request('/api/settings', {
            query: { key }
        })
    },

    async update(updates) {
        return request('/api/settings', {
            method: 'PUT',
            body: updates
        })
    },

    async reset() {
        return request('/api/settings/reset', { method: 'POST' })
    }
}

export const upload = {
    async uploadImage(fileData) {
        return request('/api/upload/image', {
            method: 'POST',
            body: fileData
        })
    },

    async deleteImage(filename) {
        return request(`/api/upload/image/${encodeURIComponent(filename)}`, {
            method: 'DELETE'
        })
    },

    async getImagePath(filename) {
        return request(`/api/upload/image/${encodeURIComponent(filename)}/path`)
    }
}

export default {
    configs,
    prompts,
    evaluate,
    topics,
    essays,
    settings,
    upload,
    getErrorMessage,
    isAPIAvailable
}
