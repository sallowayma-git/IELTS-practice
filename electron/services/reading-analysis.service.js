const ProviderOrchestratorService = require('./provider-orchestrator.service');
const {
    buildReadingSingleAttemptResponseFormat,
    normalizeReadingSingleAttemptLlm
} = require('./reading-analysis-contract');
const logger = require('../utils/logger');

class ReadingAnalysisService {
    constructor(configService) {
        this.providerOrchestrator = new ProviderOrchestratorService(configService);
        this.REQUEST_TIMEOUT_MS = 45000;
    }

    async generateSingleAttemptAnalysis(payload = {}) {
        const normalizedPayload = payload && typeof payload === 'object' ? payload : {};
        const stage1Input = this._ensurePlainObject(normalizedPayload.singleAttemptAnalysisInput);
        const stage1Analysis = this._ensurePlainObject(normalizedPayload.singleAttemptAnalysis);
        const stage1Summary = this._ensurePlainObject(stage1Analysis && stage1Analysis.summary);
        const stage1Radar = this._ensurePlainObject(stage1Analysis && stage1Analysis.radar);

        if (!stage1Input || !stage1Analysis || !stage1Summary || !stage1Radar) {
            const error = new Error('singleAttemptAnalysisInput / singleAttemptAnalysis 缺失，无法执行二阶段分析');
            error.code = 'invalid_payload';
            throw error;
        }

        const startedAt = Date.now();
        const timeoutController = new AbortController();
        const timeoutId = setTimeout(() => timeoutController.abort('timeout'), this.REQUEST_TIMEOUT_MS);
        let rawContent = '';
        let usedConfig = null;
        let providerPath = [];

        try {
            const streamResult = await this.providerOrchestrator.streamCompletion({
                preferredConfigId: normalizedPayload.api_config_id || normalizedPayload.config_id || null,
                messages: this._buildMessages(stage1Input, stage1Analysis),
                temperature: 0.2,
                max_tokens: 900,
                signal: timeoutController.signal,
                onChunk: (chunk) => {
                    if (typeof chunk === 'string') {
                        rawContent += chunk;
                    }
                },
                response_format: buildReadingSingleAttemptResponseFormat()
            });
            usedConfig = streamResult?.usedConfig || null;
            providerPath = Array.isArray(streamResult?.providerPath) ? streamResult.providerPath : [];

            let parsed = {};
            let degradedReason = null;
            try {
                parsed = this._parseJsonObject(rawContent);
            } catch (parseError) {
                degradedReason = parseError?.code || 'parse_error';
                logger.warn('Reading analysis parse degraded to stage1 guidance', null, {
                    code: degradedReason,
                    message: parseError?.message || 'parse_failed'
                });
            }
            const normalizedLlm = normalizeReadingSingleAttemptLlm(parsed);
            const latencyMs = Date.now() - startedAt;
            const result = {
                ...normalizedLlm,
                generatedAt: new Date().toISOString(),
                model_trace: {
                    config_id: usedConfig?.id || null,
                    provider: usedConfig?.provider || null,
                    model: usedConfig?.default_model || null,
                    latency_ms: latencyMs,
                    provider_path: providerPath
                }
            };

            if (!result.diagnosis.length || !result.nextActions.length || degradedReason) {
                const fallback = this._buildFallbackLlmFromStage1(stage1Analysis);
                result.diagnosis = result.diagnosis.length ? result.diagnosis : fallback.diagnosis;
                result.nextActions = result.nextActions.length ? result.nextActions : fallback.nextActions;
                result.model_trace.degraded = true;
                result.model_trace.degraded_reason = degradedReason || 'llm_missing_diagnosis_or_actions';
                logger.warn('Reading analysis degraded to stage1-derived guidance', null, {
                    diagnosis: result.diagnosis.length,
                    nextActions: result.nextActions.length
                });
            }

            return result;
        } catch (error) {
            const errorCode = String(error?.code || '').trim() || 'reading_analysis_failed';
            if (errorCode === 'invalid_payload') {
                throw error;
            }
            const fallback = this._buildFallbackLlmFromStage1(stage1Analysis);
            const normalizedFallback = normalizeReadingSingleAttemptLlm({
                diagnosis: fallback.diagnosis,
                nextActions: fallback.nextActions,
                confidence: 0.35
            });
            logger.warn('Reading analysis request degraded to stage1 guidance', null, {
                code: errorCode,
                message: error?.message || 'reading_analysis_failed'
            });
            return {
                ...normalizedFallback,
                generatedAt: new Date().toISOString(),
                model_trace: {
                    config_id: usedConfig?.id || null,
                    provider: usedConfig?.provider || null,
                    model: usedConfig?.default_model || null,
                    latency_ms: Date.now() - startedAt,
                    provider_path: providerPath,
                    degraded: true,
                    degraded_reason: errorCode,
                    error_message: error?.message || null
                }
            };
        } finally {
            clearTimeout(timeoutId);
        }
    }

    _ensurePlainObject(value) {
        return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    }

    _buildMessages(stage1Input, stage1Analysis) {
        const byQuestionKind = Array.isArray(stage1Analysis.radar?.byQuestionKind)
            ? stage1Analysis.radar.byQuestionKind.map((entry) => ({
                kind: String(entry?.kind || 'unknown'),
                total: Number(entry?.total) || 0,
                correct: Number(entry?.correct) || 0,
                accuracy: Number(entry?.accuracy) || 0,
                confidence: Number(entry?.confidence) || 0
            }))
            : [];
        const payload = {
            task: 'reading_single_attempt_evidence_analysis',
            summary: {
                accuracy: Number(stage1Analysis.summary?.accuracy) || 0,
                durationSec: Number(stage1Analysis.summary?.durationSec) || 0,
                unansweredRate: Number(stage1Analysis.summary?.unansweredRate) || 0,
                changedAnswerRate: Number(stage1Analysis.summary?.changedAnswerRate) || 0
            },
            analysisSignals: stage1Input.analysisSignals || {},
            questionTypePerformance: byQuestionKind,
            passageCategory: Array.isArray(stage1Analysis.radar?.byPassageCategory)
                ? stage1Analysis.radar.byPassageCategory
                : [],
            dataQuality: stage1Input.dataQuality || {},
            unknownQuestions: Number(stage1Input.unknownQuestions) || 0,
            missingKindRatio: Number(stage1Input.missingKindRatio) || 0,
            constraints: [
                '仅基于输入证据，不要杜撰题目文本或用户行为。',
                'diagnosis 输出 2-4 条，nextActions 输出 2-3 条。',
                'nextActions 必须可执行，优先题型粒度。',
                'evidence 字段只写从输入可直接验证的事实。',
                'reason/instruction/evidence 必须使用简体中文表述；code/type/target 可使用英文标识。'
            ]
        };
        return [
            {
                role: 'system',
                content: [
                    '你是 IELTS 阅读教练。请基于结构化指标输出证据化诊断与行动建议。',
                    '只允许输出 JSON 对象，禁止 Markdown、解释文本、代码块。',
                    '顶层字段必须是 diagnosis, nextActions, confidence。',
                    'diagnosis 为 2-4 条，每条含 code, reason, evidence(1-3条字符串)。',
                    'nextActions 为 2-3 条，每条含 type, target, instruction, evidence(1-3条字符串)。',
                    'reason/instruction/evidence 必须是自然中文（简体），禁止英文句子。'
                ].join('\n')
            },
            {
                role: 'user',
                content: JSON.stringify(payload)
            }
        ];
    }

    _parseJsonObject(rawContent) {
        if (typeof rawContent !== 'string' || !rawContent.trim()) {
            const error = new Error('LLM 响应为空');
            error.code = 'empty_response';
            throw error;
        }
        try {
            const jsonObject = this._extractJsonObject(rawContent);
            return JSON.parse(jsonObject);
        } catch (error) {
            logger.error('Reading analysis parse failed', error, null, {
                rawContentPreview: String(rawContent).slice(0, 500)
            });
            const parseError = new Error(`LLM 响应解析失败: ${error.message}`);
            parseError.code = 'parse_error';
            throw parseError;
        }
    }

    _extractJsonObject(rawContent) {
        let jsonStr = rawContent.trim();
        if (jsonStr.startsWith('```json')) {
            jsonStr = jsonStr.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
        } else if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/```\s*/g, '').replace(/```\s*$/g, '').trim();
        }

        if (jsonStr.startsWith('{') && jsonStr.endsWith('}')) {
            return jsonStr;
        }

        const start = jsonStr.indexOf('{');
        if (start < 0) {
            return jsonStr;
        }
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let i = start; i < jsonStr.length; i += 1) {
            const ch = jsonStr[i];
            if (inString) {
                if (escaped) {
                    escaped = false;
                    continue;
                }
                if (ch === '\\') {
                    escaped = true;
                    continue;
                }
                if (ch === '"') {
                    inString = false;
                }
                continue;
            }
            if (ch === '"') {
                inString = true;
                continue;
            }
            if (ch === '{') {
                depth += 1;
                continue;
            }
            if (ch === '}') {
                depth -= 1;
                if (depth === 0) {
                    return jsonStr.slice(start, i + 1);
                }
            }
        }
        return jsonStr.slice(start);
    }

    _buildFallbackLlmFromStage1(stage1Analysis) {
        const diagnosis = Array.isArray(stage1Analysis?.diagnosis)
            ? stage1Analysis.diagnosis
                .map((item, index) => {
                    const reason = String(item?.reason || item?.message || '').trim();
                    if (!reason) return null;
                    const evidence = item?.evidence && typeof item.evidence === 'object'
                        ? Object.entries(item.evidence).map(([key, value]) => `${String(key)}: ${String(value)}`).slice(0, 3)
                        : [];
                    return {
                        code: String(item?.code || `diagnosis_${index + 1}`),
                        reason,
                        evidence
                    };
                })
                .filter(Boolean)
                .slice(0, 4)
            : [];
        const nextActions = Array.isArray(stage1Analysis?.nextActions)
            ? stage1Analysis.nextActions
                .map((item, index) => {
                    const instruction = String(item?.instruction || item?.action || '').trim();
                    if (!instruction) return null;
                    const evidence = item?.evidence && typeof item.evidence === 'object'
                        ? Object.entries(item.evidence).map(([key, value]) => `${String(key)}: ${String(value)}`).slice(0, 3)
                        : [];
                    return {
                        type: String(item?.type || `action_${index + 1}`),
                        target: String(item?.target || 'overall'),
                        instruction,
                        evidence
                    };
                })
                .filter(Boolean)
                .slice(0, 3)
            : [];
        if (!diagnosis.length) {
            diagnosis.push({
                code: 'overall_accuracy',
                reason: '本次先使用结构化分析结果，建议按题型拆分复盘。',
                evidence: []
            });
        }
        if (!nextActions.length) {
            nextActions.push({
                type: 'maintain_and_iterate',
                target: 'overall',
                instruction: '先复盘错题定位依据，再进行同题型限时练习。',
                evidence: []
            });
        }
        return {
            diagnosis,
            nextActions
        };
    }
}

module.exports = ReadingAnalysisService;
