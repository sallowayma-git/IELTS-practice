const LLMProvider = require('./llm-provider');
const logger = require('../utils/logger');

/**
 * Provider Orchestrator
 * 主备切换 + 重试退避 + 冷却
 */
class ProviderOrchestratorService {
    constructor(configService) {
        this.configService = configService;
        this.maxFallbackProviders = 2; // 主 + 最多2个备
        this.failureCooldownMs = 60 * 1000;
    }

    async streamCompletion({ preferredConfigId = null, messages, temperature, max_tokens, signal, onChunk }) {
        const candidates = await this._resolveCandidates(preferredConfigId);
        if (candidates.length === 0) {
            throw new Error('未找到可用的 API 配置，请先在设置中启用配置');
        }

        const providerPath = [];
        let lastError = null;

        for (const config of candidates.slice(0, this.maxFallbackProviders + 1)) {
            const maxRetries = Number.isFinite(Number(config.max_retries))
                ? Math.max(0, Number(config.max_retries))
                : 2;

            if (this._isInCooldown(config)) {
                providerPath.push({
                    provider: config.provider,
                    model: config.default_model,
                    status: 'cooldown',
                    reason: 'provider cooling down'
                });
                continue;
            }

            for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
                const provider = new LLMProvider({
                    provider: config.provider,
                    base_url: config.base_url,
                    api_key: config.api_key,
                    model: config.default_model
                });

                try {
                    await provider.streamCompletion({
                        messages,
                        temperature,
                        max_tokens,
                        signal,
                        onChunk
                    });

                    this.configService.markSuccess(config.id);
                    providerPath.push({
                        provider: config.provider,
                        model: config.default_model,
                        status: 'success',
                        attempts: attempt
                    });

                    return {
                        usedConfig: config,
                        providerPath
                    };
                } catch (error) {
                    lastError = error;
                    const errorCode = this._getErrorCode(error);
                    providerPath.push({
                        provider: config.provider,
                        model: config.default_model,
                        status: 'failed',
                        attempts: attempt,
                        error_code: errorCode,
                        message: error.message
                    });

                    const shouldRetry = this._isRetryable(errorCode) && attempt <= maxRetries;
                    if (shouldRetry) {
                        const delay = this._backoffDelay(attempt);
                        await this._sleep(delay, signal);
                        continue;
                    }

                    const failCount = Number(config.failure_count || 0) + 1;
                    const cooldownUntil = failCount >= 3
                        ? new Date(Date.now() + this.failureCooldownMs).toISOString()
                        : null;
                    this.configService.markFailure(config.id, cooldownUntil);
                    break;
                }
            }
        }

        throw lastError || new Error('所有供应商调用失败');
    }

    async _resolveCandidates(preferredConfigId) {
        if (preferredConfigId) {
            const preferred = await this.configService.getConfigByIdDecrypted(preferredConfigId);
            return [preferred];
        }
        return this.configService.getDecryptedEnabledConfigs();
    }

    _isInCooldown(config) {
        if (!config.cooldown_until) {
            return false;
        }
        return new Date(config.cooldown_until).getTime() > Date.now();
    }

    _isRetryable(errorCode) {
        return ['timeout', 'network_error', 'rate_limit_exceeded', 'rate_limited', 'server_error'].includes(errorCode);
    }

    _backoffDelay(attempt) {
        if (attempt <= 1) return 500;
        return 1500;
    }

    _getErrorCode(error) {
        const message = String(error?.message || '').toLowerCase();
        if (message.includes('unauthorized') || message.includes('api key')) return 'invalid_api_key';
        if (message.includes('insufficient') && message.includes('quota')) return 'insufficient_quota';
        if (message.includes('rate limit')) return 'rate_limit_exceeded';
        if (message.includes('not found') || message.includes('模型不存在')) return 'model_not_found';
        if (message.includes('timeout')) return 'timeout';
        if (message.includes('network')) return 'network_error';
        if (message.includes('server error') || message.includes('5xx')) return 'server_error';
        logger.warn('Unknown orchestrator error code', null, { message: error?.message });
        return 'unknown_error';
    }

    async _sleep(ms, signal) {
        if (ms <= 0) return;
        await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, ms);
            if (signal) {
                signal.addEventListener('abort', () => {
                    clearTimeout(timer);
                    reject(new Error('请求已取消'));
                }, { once: true });
            }
        });
    }
}

module.exports = ProviderOrchestratorService;
