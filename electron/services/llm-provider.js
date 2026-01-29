const logger = require('../utils/logger');

/**
 * LLM Provider 适配层
 * 
 * 支持多个供应商的统一接口:
 * - OpenAI
 * - OpenRouter
 * - DeepSeek
 * 
 * 所有 provider 都使用 OpenAI-compatible API
 */
class LLMProvider {
    constructor({ provider, base_url, api_key, model }) {
        this.provider = provider;
        this.baseUrl = base_url;
        this.apiKey = api_key;
        this.model = model;
    }

    /**
     * 测试连接 (使用最小 token 消耗)
     */
    async testConnection() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: this._getHeaders(),
                body: JSON.stringify({
                    model: this.model,
                    messages: [{ role: 'user', content: 'hi' }],
                    max_tokens: 1,
                    stream: false
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw this._parseError(response.status, errorData);
            }

            logger.debug(`Connection test successful: ${this.provider}`);

            return true;
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('Network timeout: 连接超时,请检查网络或 base_url');
            }
            throw error;
        }
    }

    /**
     * 流式调用 LLM
     */
    async streamCompletion({ messages, temperature, max_tokens, onChunk, signal }) {
        try {
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: this._getHeaders(),
                body: JSON.stringify({
                    model: this.model,
                    messages,
                    temperature,
                    max_tokens,
                    stream: true
                }),
                signal
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw this._parseError(response.status, errorData);
            }

            // 处理流式响应
            await this._processStream(response.body, onChunk);

        } catch (error) {
            if (error.name === 'AbortError') {
                logger.info('LLM stream aborted by user');
                throw new Error('请求已取消');
            }
            logger.error('LLM stream error', error);
            throw error;
        }
    }

    /**
     * 处理 SSE 流式响应
     */
    async _processStream(body, onChunk) {
        const reader = body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();

                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                // 按行分割
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // 保留最后一个不完整的行

                for (const line of lines) {
                    const trimmed = line.trim();

                    if (!trimmed || trimmed === 'data: [DONE]') {
                        continue;
                    }

                    if (trimmed.startsWith('data: ')) {
                        const jsonStr = trimmed.slice(6); // 移除 "data: " 前缀

                        try {
                            const chunk = JSON.parse(jsonStr);
                            const content = chunk.choices?.[0]?.delta?.content;

                            if (content) {
                                onChunk(content);
                            }
                        } catch (parseError) {
                            logger.warn('Failed to parse SSE chunk', null, { line: trimmed });
                            // 不抛出错误,继续处理下一个 chunk
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    /**
     * 获取请求头
     */
    _getHeaders() {
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
        };

        // OpenRouter 特殊处理
        if (this.provider === 'openrouter') {
            headers['HTTP-Referer'] = 'https://github.com/ielts-writing-ai';
            headers['X-Title'] = 'IELTS Writing AI';
        }

        return headers;
    }

    /**
     * 解析错误
     */
    _parseError(status, errorData) {
        const errorMessage = errorData.error?.message || errorData.message || 'Unknown error';

        if (status === 401) {
            return new Error(`Unauthorized: API Key 无效或已过期 - ${errorMessage}`);
        }

        if (status === 429) {
            return new Error(`rate limit: API 调用频率超限,请稍后重试 - ${errorMessage}`);
        }

        if (status === 404) {
            return new Error(`Not Found: 模型不存在或 base_url 错误 - ${errorMessage}`);
        }

        if (status >= 500) {
            return new Error(`Server Error: 供应商服务器错误 (${status}) - ${errorMessage}`);
        }

        return new Error(`API Error (${status}): ${errorMessage}`);
    }
}

module.exports = LLMProvider;
