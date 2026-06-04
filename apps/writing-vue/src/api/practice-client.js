import { request, requestEventStream } from './client.js'

function practicePath(...segments) {
    const encodedSegments = segments
        .filter((segment) => segment !== null && segment !== undefined && segment !== '')
        .map((segment) => encodeURIComponent(String(segment)))
    return ['/api/practice', ...encodedSegments].join('/')
}

async function listAllPracticePages(listPage, filters = {}, options = {}) {
    const limit = Math.max(1, Math.min(Number(options.limit || 200), 200))
    const maxPages = Math.max(1, Number(options.maxPages || 1000))
    const resolveFilters = typeof options.resolveFilters === 'function'
        ? options.resolveFilters
        : () => filters
    const rows = []
    let page = 1
    let total = 0
    let lastResult = null

    while (page <= maxPages) {
        const result = await listPage(resolveFilters(page, filters), { page, limit })
        lastResult = result
        const pageRows = Array.isArray(result?.data) ? result.data : []
        rows.push(...pageRows)

        total = Number(result?.total || total || 0)
        const pageLimit = Math.max(1, Number(result?.limit || limit))
        if (!pageRows.length || (total > 0 && rows.length >= total) || pageRows.length < pageLimit) {
            break
        }
        page = Math.max(page + 1, Number(result?.page || page) + 1)
    }

    return {
        ...(lastResult && typeof lastResult === 'object' ? lastResult : {}),
        data: rows,
        total: total || rows.length,
        page: 1,
        limit
    }
}

export const practiceAssets = {
    async list(filters = {}, pagination = { page: 1, limit: 20 }) {
        return request('/api/practice/assets', {
            query: {
                ...filters,
                ...pagination
            }
        })
    },

    async listAll(filters = {}, options = {}) {
        const { refresh = false, ...paginationOptions } = options || {}
        return listAllPracticePages(practiceAssets.list, filters, {
            ...paginationOptions,
            resolveFilters: (page) => ({
                ...filters,
                refresh: refresh && page === 1 ? 'true' : undefined
            })
        })
    },

    async get(activity, assetId, options = {}) {
        return request(practicePath('assets', activity, assetId), {
            query: {
                refresh: options.refresh ? 'true' : undefined
            }
        })
    }
}

export const practiceSessions = {
    async create(payload) {
        return request('/api/practice/sessions', {
            method: 'POST',
            body: payload
        })
    },

    async getState(activity, sessionId) {
        return request(practicePath('sessions', activity, sessionId))
    },

    async cancel(activity, sessionId) {
        return request(practicePath('sessions', activity, sessionId), {
            method: 'DELETE'
        })
    }
}

export const practiceReadingSuite = {
    async create(payload = {}) {
        return request('/api/practice/reading-suite', {
            method: 'POST',
            body: payload
        })
    },

    async get(sessionId) {
        return request(practicePath('reading-suite', sessionId))
    },

    async submitPassage(sessionId, assetId, payload = {}) {
        return request(practicePath('reading-suite', sessionId, 'passages', assetId), {
            method: 'POST',
            body: payload
        })
    }
}

export const practiceHistory = {
    async list(filters = {}, pagination = { page: 1, limit: 20 }) {
        return request('/api/practice/history', {
            query: {
                ...filters,
                ...pagination
            }
        })
    },

    async listAll(filters = {}, options = {}) {
        return listAllPracticePages(practiceHistory.list, filters, options)
    },

    async get(activity, recordId) {
        return request(practicePath('history', activity, recordId))
    },

    async delete(activity, recordId) {
        return request(practicePath('history', activity, recordId), {
            method: 'DELETE'
        })
    },

    async clear(filters = {}) {
        return request('/api/practice/history', {
            method: 'DELETE',
            query: filters
        })
    },

    async exportArchive(filters = { activity: 'reading' }) {
        return request('/api/practice/history/archive', {
            query: filters
        })
    },

    async importArchive(activity, payload) {
        return request(practicePath('history', 'archive', activity), {
            method: 'POST',
            body: payload
        })
    }
}

export const practiceCoach = {
    async query(activity, payload, sessionId = null, options = {}) {
        const body = {
            activity,
            sessionId,
            payload
        }
        try {
            return await requestEventStream('/api/practice/coach/stream', {
                method: 'POST',
                body,
                onEvent: options.onEvent
            })
        } catch (error) {
            const code = String(error?.code || '').toLowerCase()
            const statusCode = Number(error?.statusCode || 0)
            if (code !== 'http_404' && code !== 'http_405' && statusCode !== 404 && statusCode !== 405) {
                throw error
            }
        }
        return request('/api/practice/coach', {
            method: 'POST',
            body
        })
    }
}

export const practiceMigration = {
    async getStatus() {
        return request('/api/practice/migration-status')
    }
}

export default {
    assets: practiceAssets,
    sessions: practiceSessions,
    readingSuite: practiceReadingSuite,
    history: practiceHistory,
    coach: practiceCoach,
    migration: practiceMigration
}
