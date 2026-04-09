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
    async streamCompletion({
        messages,
        temperature,
        max_tokens,
        onChunk,
        signal,
        response_format = null,
        allow_json_object_fallback = true,
        allow_raw_fallback = true
    }) {
        try {
            const requestBody = {
                model: this.model,
                messages,
                temperature,
                max_tokens,
                stream: true
            };
            if (response_format) {
                requestBody.response_format = response_format;
            }

            let response = await this._sendCompletionRequest(requestBody, signal);
            let errorData = null;

            if (!response.ok) {
                errorData = await response.json().catch(() => ({}));

                if (response_format && this._shouldRetryWithoutStructuredOutput(response.status, errorData)) {
                    const fallbackFormat = this._buildJsonObjectFallback(response_format);
                    if (fallbackFormat && allow_json_object_fallback) {
                        logger.warn('Structured schema unsupported, retrying with json_object', null, {
                            provider: this.provider,
                            model: this.model,
                            status: response.status,
                            message: errorData?.error?.message || errorData?.message || null
                        });
                        requestBody.response_format = fallbackFormat;
                        response = await this._sendCompletionRequest(requestBody, signal);
                    } else if (allow_raw_fallback) {
                        logger.warn('Structured output unsupported, retrying without response_format', null, {
                            provider: this.provider,
                            model: this.model,
                            status: response.status,
                            message: errorData?.error?.message || errorData?.message || null
                        });
                        delete requestBody.response_format;
                        response = await this._sendCompletionRequest(requestBody, signal);
                    }
                }
            }

            if (!response.ok) {
                errorData = await response.json().catch(() => ({}));
                throw this._parseError(response.status, errorData);
            }

            // 处理流式响应
            await this._processStream(response.body, onChunk);

        } catch (error) {
            if (error.name === 'AbortError') {
                const abortError = this._buildAbortError(signal);
                logger.info('LLM stream aborted', null, {
                    provider: this.provider,
                    model: this.model,
                    code: abortError.code
                });
                throw abortError;
            }
            logger.error('LLM stream error', error);
            throw error;
        }
    }

    async _sendCompletionRequest(requestBody, signal) {
        return fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: this._getHeaders(),
            body: JSON.stringify(requestBody),
            signal
        });
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

                    if (!trimmed) {
                        continue;
                    }

                    if (trimmed === 'data: [DONE]') {
                        return;
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

    _shouldRetryWithoutStructuredOutput(status, errorData) {
        if (status !== 400) {
            return false;
        }

        const message = String(errorData?.error?.message || errorData?.message || '').toLowerCase();
        if (!message) {
            return false;
        }

        return [
            'response_format',
            'json_schema',
            'structured output',
            'unsupported parameter',
            'unsupported_response_format'
        ].some((token) => message.includes(token));
    }

    _buildJsonObjectFallback(responseFormat) {
        if (!responseFormat || responseFormat.type !== 'json_schema') {
            return null;
        }
        return { type: 'json_object' };
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

    _buildAbortError(signal) {
        const reasonRaw = signal ? signal.reason : null;
        const reason = String(
            typeof reasonRaw === 'string'
                ? reasonRaw
                : reasonRaw?.code || reasonRaw?.reason || reasonRaw?.message || ''
        ).toLowerCase();

        if (reason.includes('timeout')) {
            const timeoutError = new Error('请求超时已取消');
            timeoutError.code = 'timeout';
            return timeoutError;
        }

        if (reason.includes('user')) {
            const cancelError = new Error('用户已取消请求');
            cancelError.code = 'request_cancelled';
            return cancelError;
        }

        const cancelError = new Error('请求已取消');
        cancelError.code = 'request_cancelled';
        return cancelError;
    }
}

module.exports = LLMProvider;
