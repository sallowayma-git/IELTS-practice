/**
 * IPC 适配层
 * 统一封装 window.writingAPI.* 调用
 */

// 错误码映射表
const ERROR_MESSAGES = {
    invalid_api_key: 'API 密钥无效，请前往设置页面检查配置',
    insufficient_quota: 'API 余额不足，请充值后重试',
    rate_limit_exceeded: '请求频率超限，请稍后重试',
    rate_limited: '请求频率超限，请稍后重试',
    model_not_found: '模型不存在，请检查模型名称配置',
    timeout: '请求超时（120秒），请检查网络连接或稍后重试',
    network_error: '网络连接失败，请检查网络设置',
    server_error: 'LLM 服务商服务异常，请稍后重试',
    invalid_response_format: '评分数据解析失败，请点击"重试"按钮',
    start_failed: '启动评测失败，请重试',
    unknown_error: '未知错误，请重试'
}

/**
 * 获取用户友好的错误消息
 */
export function getErrorMessage(code) {
    return ERROR_MESSAGES[code] || ERROR_MESSAGES.unknown_error
}

/**
 * 检查 API 是否可用
 */
export function isAPIAvailable() {
    return typeof window !== 'undefined' && window.writingAPI
}

/**
 * 统一处理 IPC 响应
 */
function handleResponse(response) {
    if (!response.success) {
        const error = new Error(response.error?.message || '操作失败')
        error.code = response.error?.code || 'unknown_error'
        throw error
    }
    return response.data
}

// API 配置相关
export const configs = {
    async list() {
        if (!isAPIAvailable()) throw new Error('API 不可用')
        const response = await window.writingAPI.configs.list()
        return handleResponse(response)
    },

    async getDefault() {
        const list = await this.list()
        return list.find(c => c.is_default) || list[0]
    }
}

// 提示词相关
export const prompts = {
    async getActive(taskType) {
        if (!isAPIAvailable()) throw new Error('API 不可用')
        const response = await window.writingAPI.prompts.getActive(taskType)
        return handleResponse(response)
    }
}

// 评测相关
export const evaluate = {
    /**
     * 启动评测
     * @param {Object} payload - { task_type, topic_id, content, word_count, config_id }
     * @returns {Promise<{ sessionId: string }>}
     */
    async start(payload) {
        if (!isAPIAvailable()) throw new Error('API 不可用')
        const response = await window.writingAPI.evaluate.start(payload)
        return handleResponse(response)
    },

    /**
     * 取消评测
     * @param {string} sessionId
     */
    async cancel(sessionId) {
        if (!isAPIAvailable()) throw new Error('API 不可用')
        const response = await window.writingAPI.evaluate.cancel(sessionId)
        return handleResponse(response)
    },

    /**
     * 订阅评测事件
     * @param {Function} callback - (event) => void
     */
    onEvent(callback) {
        if (!isAPIAvailable()) {
            console.warn('API 不可用，无法订阅事件')
            return
        }
        window.writingAPI.evaluate.onEvent(callback)
    },

    /**
     * 移除事件监听
     */
    removeEventListener() {
        if (!isAPIAvailable()) return
        window.writingAPI.evaluate.removeEventListener()
    }
}

// 题目管理相关
export const topics = {
    async list(filters = {}, pagination = { page: 1, limit: 20 }) {
        if (!isAPIAvailable()) throw new Error('API 不可用')
        const response = await window.writingAPI.topics.list(filters, pagination)
        return handleResponse(response)
    },

    async getById(id) {
        if (!isAPIAvailable()) throw new Error('API 不可用')
        const response = await window.writingAPI.topics.getById(id)
        return handleResponse(response)
    },

    async create(topicData) {
        if (!isAPIAvailable()) throw new Error('API 不可用')
        const response = await window.writingAPI.topics.create(topicData)
        return handleResponse(response)
    },

    async update(id, updates) {
        if (!isAPIAvailable()) throw new Error('API 不可用')
        const response = await window.writingAPI.topics.update(id, updates)
        return handleResponse(response)
    },

    async delete(id) {
        if (!isAPIAvailable()) throw new Error('API 不可用')
        const response = await window.writingAPI.topics.delete(id)
        return handleResponse(response)
    },

    async batchImport(topicsArray) {
        if (!isAPIAvailable()) throw new Error('API 不可用')
        const response = await window.writingAPI.topics.batchImport(topicsArray)
        return handleResponse(response)
    },

    async getStatistics() {
        if (!isAPIAvailable()) throw new Error('API 不可用')
        const response = await window.writingAPI.topics.getStatistics()
        return handleResponse(response)
    }
}

// 作文/历史记录相关
export const essays = {
    async list(filters = {}, pagination = { page: 1, limit: 20 }) {
        if (!isAPIAvailable()) throw new Error('API 不可用')
        const response = await window.writingAPI.essays.list(filters, pagination)
        return handleResponse(response)
    },

    async getById(id) {
        if (!isAPIAvailable()) throw new Error('API 不可用')
        const response = await window.writingAPI.essays.getById(id)
        return handleResponse(response)
    },

    async create(essayData) {
        if (!isAPIAvailable()) throw new Error('API 不可用')
        const response = await window.writingAPI.essays.create(essayData)
        return handleResponse(response)
    },

    async delete(id) {
        if (!isAPIAvailable()) throw new Error('API 不可用')
        const response = await window.writingAPI.essays.delete(id)
        return handleResponse(response)
    },

    async batchDelete(ids) {
        if (!isAPIAvailable()) throw new Error('API 不可用')
        const response = await window.writingAPI.essays.batchDelete(ids)
        return handleResponse(response)
    },

    async deleteAll() {
        if (!isAPIAvailable()) throw new Error('API 不可用')
        const response = await window.writingAPI.essays.deleteAll()
        return handleResponse(response)
    },

    async getStatistics(range = 'all', taskType = null) {
        if (!isAPIAvailable()) throw new Error('API 不可用')
        const response = await window.writingAPI.essays.getStatistics(range, taskType)
        return handleResponse(response)
    },

    async exportCSV(filters = {}) {
        if (!isAPIAvailable()) throw new Error('API 不可用')
        const response = await window.writingAPI.essays.exportCSV(filters)
        return handleResponse(response)
    }
}

// 设置相关
export const settings = {
    async getAll() {
        if (!isAPIAvailable()) throw new Error('API 不可用')
        const response = await window.writingAPI.settings.getAll()
        return handleResponse(response)
    },

    async get(key) {
        if (!isAPIAvailable()) throw new Error('API 不可用')
        const response = await window.writingAPI.settings.get(key)
        return handleResponse(response)
    },

    async update(updates) {
        if (!isAPIAvailable()) throw new Error('API 不可用')
        const response = await window.writingAPI.settings.update(updates)
        return handleResponse(response)
    },

    async reset() {
        if (!isAPIAvailable()) throw new Error('API 不可用')
        const response = await window.writingAPI.settings.reset()
        return handleResponse(response)
    }
}

// 图片上传相关
export const upload = {
    async uploadImage(fileData) {
        if (!isAPIAvailable()) throw new Error('API 不可用')
        const response = await window.writingAPI.upload.uploadImage(fileData)
        return handleResponse(response)
    },

    async deleteImage(filename) {
        if (!isAPIAvailable()) throw new Error('API 不可用')
        const response = await window.writingAPI.upload.deleteImage(filename)
        return handleResponse(response)
    },

    async getImagePath(filename) {
        if (!isAPIAvailable()) throw new Error('API 不可用')
        const response = await window.writingAPI.upload.getImagePath(filename)
        return handleResponse(response)
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
