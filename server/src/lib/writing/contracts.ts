// @ts-nocheck
const logger = require('../../../../electron/utils/logger.js');

const EVALUATION_CONTRACT_VERSION = 'v3';

function buildScoringStageExample(taskType) {
    const taskAnalysis = taskType === 'task1'
        ? {
            task_fulfillment: '覆盖了主要图表特征，但个别对比不够完整',
            overview_quality: '概述存在且抓住了主趋势',
            key_features_coverage: '提到了高低值与总体变化，但细节选择一般',
            data_support_quality: '引用了数据，但部分比较不够精确'
        }
        : {
            prompt_response_quality: '回应题目主体要求，但论证深度一般',
            position_clarity: '立场明确且基本一致',
            argument_development: '主体段有展开，但例证偏泛',
            conclusion_effectiveness: '结论能回扣题目，但力度不足'
        };

    return {
        total_score: 6.5,
        task_achievement: 6.5,
        coherence_cohesion: 6.0,
        lexical_resource: 6.5,
        grammatical_range: 6.0,
        task_analysis: taskAnalysis,
        band_rationale: {
            task_achievement: '回应完整度尚可，但支持展开不足，限制在 6.5 左右',
            coherence_cohesion: '段落结构清楚，但段间推进不够紧',
            lexical_resource: '词汇范围够用，重复表达略多',
            grammatical_range: '复杂句有尝试，但准确率不稳定'
        },
        improvement_plan: [
            '每个主体段补 1 个更具体的例子',
            '减少重复连接词，提升段落推进感'
        ],
        input_context: {
            prompt_summary: '题目要求讨论双方观点并明确给出自己的立场。',
            required_points: ['明确立场', '比较双方观点', '给出结论'],
            major_risks: ['例证偏泛', '段落展开不足']
        }
    };
}

function buildReviewStageExample() {
    return {
        review_blocks: [
            {
                paragraph_index: 2,
                comment: '主体段中心句明确，但例证不够具体。',
                analysis: '当前段落说明了观点，却没有给出足够可验证的支撑。',
                feedback: '补 1 个具体场景或因果链，论证会更扎实。'
            }
        ],
        sentences: [
            {
                index: 2,
                original: 'Governments should invest more on public transport.',
                errors: [
                    {
                        type: 'grammar',
                        word: 'invest more on',
                        range: { start: 19, end: 33, unit: 'utf16' },
                        reason: '固定搭配错误，应为 invest more in',
                        correction: 'invest more in'
                    }
                ],
                corrected: 'Governments should invest more in public transport.'
            }
        ],
        overall_feedback: '立场明确，但段落展开还不够具体。优先提升主体段的论证深度。',
        improvement_plan: [
            '每个主体段增加 1 个具体例子',
            '优先修复高频搭配错误'
        ],
        rewrite_suggestions: [
            '将空泛判断改写为“观点 + 原因 + 例子”三步结构'
        ]
    };
}

function buildScoringResponseFormat(taskType) {
    const taskAnalysisProperties = taskType === 'task1'
        ? {
            task_fulfillment: { type: 'string' },
            overview_quality: { type: 'string' },
            key_features_coverage: { type: 'string' },
            data_support_quality: { type: 'string' }
        }
        : {
            prompt_response_quality: { type: 'string' },
            position_clarity: { type: 'string' },
            argument_development: { type: 'string' },
            conclusion_effectiveness: { type: 'string' }
        };

    return {
        type: 'json_schema',
        json_schema: {
            name: `ielts_${taskType}_scoring_stage`,
            strict: true,
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    total_score: { type: 'number' },
                    task_achievement: { type: 'number' },
                    coherence_cohesion: { type: 'number' },
                    lexical_resource: { type: 'number' },
                    grammatical_range: { type: 'number' },
                    task_analysis: {
                        type: 'object',
                        additionalProperties: false,
                        properties: taskAnalysisProperties,
                        required: Object.keys(taskAnalysisProperties)
                    },
                    band_rationale: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            task_achievement: { type: 'string' },
                            coherence_cohesion: { type: 'string' },
                            lexical_resource: { type: 'string' },
                            grammatical_range: { type: 'string' }
                        },
                        required: [
                            'task_achievement',
                            'coherence_cohesion',
                            'lexical_resource',
                            'grammatical_range'
                        ]
                    },
                    improvement_plan: {
                        type: 'array',
                        items: { type: 'string' }
                    },
                    input_context: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            prompt_summary: { type: 'string' },
                            required_points: {
                                type: 'array',
                                items: { type: 'string' }
                            },
                            major_risks: {
                                type: 'array',
                                items: { type: 'string' }
                            }
                        },
                        required: ['prompt_summary', 'required_points', 'major_risks']
                    }
                },
                required: [
                    'total_score',
                    'task_achievement',
                    'coherence_cohesion',
                    'lexical_resource',
                    'grammatical_range',
                    'task_analysis',
                    'band_rationale',
                    'improvement_plan',
                    'input_context'
                ]
            }
        }
    };
}

function buildReviewResponseFormat() {
    return {
        type: 'json_schema',
        json_schema: {
            name: 'ielts_review_stage',
            strict: true,
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    review_blocks: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                paragraph_index: { type: 'integer' },
                                comment: { type: 'string' },
                                analysis: { type: 'string' },
                                feedback: { type: 'string' }
                            },
                            required: ['paragraph_index', 'comment', 'analysis', 'feedback']
                        }
                    },
                    sentences: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                index: { type: 'integer' },
                                original: { type: 'string' },
                                errors: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        additionalProperties: false,
                                        properties: {
                                            type: { type: 'string' },
                                            word: { type: 'string' },
                                            range: {
                                                type: 'object',
                                                additionalProperties: false,
                                                properties: {
                                                    start: { type: 'integer' },
                                                    end: { type: 'integer' },
                                                    unit: { type: 'string' }
                                                },
                                                required: ['start', 'end', 'unit']
                                            },
                                            reason: { type: 'string' },
                                            correction: { type: 'string' }
                                        },
                                        required: ['type', 'word', 'range', 'reason', 'correction']
                                    }
                                },
                                corrected: { type: 'string' }
                            },
                            required: ['index', 'original', 'errors']
                        }
                    },
                    overall_feedback: { type: 'string' },
                    improvement_plan: {
                        type: 'array',
                        items: { type: 'string' }
                    },
                    rewrite_suggestions: {
                        type: 'array',
                        items: { type: 'string' }
                    }
                },
                required: [
                    'review_blocks',
                    'sentences',
                    'overall_feedback',
                    'improvement_plan',
                    'rewrite_suggestions'
                ]
            }
        }
    };
}

function validateScoringStage(evaluation, taskType) {
    const requiredScoreFields = [
        'total_score',
        'task_achievement',
        'coherence_cohesion',
        'lexical_resource',
        'grammatical_range'
    ];
    const requiredTaskAnalysisFields = taskType === 'task1'
        ? ['task_fulfillment', 'overview_quality', 'key_features_coverage', 'data_support_quality']
        : ['prompt_response_quality', 'position_clarity', 'argument_development', 'conclusion_effectiveness'];
    const normalized = { ...evaluation };

    for (const field of requiredScoreFields) {
        const numeric = coerceScore(evaluation[field]);
        if (numeric === null) {
            const error = new Error(`第一阶段缺少有效分数字段: ${field}`);
            error.code = 'validation_error';
            throw error;
        }
        normalized[field] = numeric;
    }

    const analysisEnvelope = normalizeAnalysisEnvelope(evaluation);
    normalized.task_analysis = requireStructuredTextMap(
        analysisEnvelope.task_analysis,
        requiredTaskAnalysisFields,
        '第一阶段 task_analysis'
    );
    normalized.band_rationale = requireStructuredTextMap(
        analysisEnvelope.band_rationale,
        ['task_achievement', 'coherence_cohesion', 'lexical_resource', 'grammatical_range'],
        '第一阶段 band_rationale'
    );
    normalized.improvement_plan = normalizeList(analysisEnvelope.improvement_plan);
    delete normalized.analysis;
    normalized.input_context = normalizeInputContext(evaluation.input_context);

    return normalized;
}

function validateReviewStage(evaluation) {
    if (!evaluation || typeof evaluation !== 'object' || Array.isArray(evaluation)) {
        const error = new Error('第二阶段响应必须是对象');
        error.code = 'validation_error';
        throw error;
    }
    if (!Array.isArray(evaluation.review_blocks) && !Array.isArray(evaluation.paragraph_reviews)) {
        const error = new Error('第二阶段缺少 review_blocks 数组');
        error.code = 'validation_error';
        throw error;
    }

    const reviewBlocks = normalizeReviewBlocks(evaluation.review_blocks || evaluation.paragraph_reviews);
    const overallFeedback = normalizeText(evaluation.overall_feedback);

    if (!overallFeedback) {
        const error = new Error('第二阶段缺少有效 overall_feedback');
        error.code = 'validation_error';
        throw error;
    }

    return {
        sentences: normalizeSentences(evaluation.sentences),
        paragraph_reviews: reviewBlocks,
        review_blocks: reviewBlocks,
        overall_feedback: overallFeedback,
        improvement_plan: normalizeList(evaluation.improvement_plan),
        rewrite_suggestions: normalizeList(evaluation.rewrite_suggestions)
    };
}

function mergeStageResults({ scoringEvaluation, reviewEvaluation, reviewMeta = {} }) {
    const scorecard = {
        total_score: coerceScore(scoringEvaluation.total_score),
        task_achievement: coerceScore(scoringEvaluation.task_achievement),
        coherence_cohesion: coerceScore(scoringEvaluation.coherence_cohesion),
        lexical_resource: coerceScore(scoringEvaluation.lexical_resource),
        grammatical_range: coerceScore(scoringEvaluation.grammatical_range)
    };
    const reviewDegraded = reviewMeta.degraded === true;
    const reviewStatus = reviewDegraded ? 'degraded' : 'completed';
    const reviewErrorMessage = normalizeText(reviewMeta.error_message || reviewMeta.errorMessage);
    const mergedImprovementPlan = Array.isArray(reviewEvaluation.improvement_plan) && reviewEvaluation.improvement_plan.length > 0
        ? reviewEvaluation.improvement_plan
        : (Array.isArray(scoringEvaluation.improvement_plan) ? scoringEvaluation.improvement_plan : []);
    const reviewBlocks = Array.isArray(reviewEvaluation.review_blocks)
        ? reviewEvaluation.review_blocks
        : (Array.isArray(reviewEvaluation.paragraph_reviews) ? reviewEvaluation.paragraph_reviews : []);
    const rewriteSuggestions = Array.isArray(reviewEvaluation.rewrite_suggestions)
        ? reviewEvaluation.rewrite_suggestions
        : [];
    const taskAnalysis = normalizeMap(scoringEvaluation.task_analysis);
    const bandRationale = normalizeMap(scoringEvaluation.band_rationale);
    const inputContext = scoringEvaluation.input_context !== undefined
        ? scoringEvaluation.input_context
        : {};
    const sentences = Array.isArray(reviewEvaluation.sentences) ? reviewEvaluation.sentences : [];
    const overallFeedback = typeof reviewEvaluation.overall_feedback === 'string' ? reviewEvaluation.overall_feedback : '';

    const merged = {
        contract_version: EVALUATION_CONTRACT_VERSION,
        ...scorecard,
        scorecard,
        sentences,
        overall_feedback: overallFeedback,
        review_degraded: reviewDegraded,
        review_status: {
            stage: 'review',
            status: reviewStatus,
            degraded: reviewDegraded,
            ...(reviewErrorMessage ? { error_message: reviewErrorMessage } : {})
        },
        improvement_plan: mergedImprovementPlan,
        paragraph_reviews: reviewBlocks,
        review_blocks: reviewBlocks,
        rewrite_suggestions: rewriteSuggestions,
        analysis: {
            task_analysis: taskAnalysis,
            band_rationale: bandRationale,
            improvement_plan: mergedImprovementPlan,
            input_context: inputContext
        },
        review: {
            status: reviewStatus,
            sentences,
            overall_feedback: overallFeedback,
            paragraph_reviews: reviewBlocks,
            review_blocks: reviewBlocks,
            improvement_plan: mergedImprovementPlan,
            rewrite_suggestions: rewriteSuggestions,
            review_degraded: reviewDegraded
        }
    };

    if (Object.keys(taskAnalysis).length > 0) {
        merged.task_analysis = taskAnalysis;
    }
    if (Object.keys(bandRationale).length > 0) {
        merged.band_rationale = bandRationale;
    }
    if (inputContext !== undefined) {
        merged.input_context = inputContext;
    }

    return merged;
}

function validateEvaluation(evaluation) {
    const errors = [];
    const requiredScoreFields = [
        'total_score',
        'task_achievement',
        'coherence_cohesion',
        'lexical_resource',
        'grammatical_range'
    ];

    for (const field of requiredScoreFields) {
        if (evaluation[field] === null || evaluation[field] === undefined) {
            errors.push(`缺少必填字段: ${field}`);
        } else if (typeof evaluation[field] !== 'number') {
            errors.push(`字段 ${field} 必须是数字,实际是 ${typeof evaluation[field]}`);
        } else if (evaluation[field] < 0 || evaluation[field] > 9) {
            errors.push(`字段 ${field} 分数超出范围 [0,9],实际值: ${evaluation[field]}`);
        }
    }

    if (evaluation.review_degraded !== undefined && typeof evaluation.review_degraded !== 'boolean') {
        errors.push('review_degraded 必须是布尔值');
    }
    if (evaluation.review_status !== undefined) {
        if (!evaluation.review_status || typeof evaluation.review_status !== 'object' || Array.isArray(evaluation.review_status)) {
            errors.push('review_status 必须是对象');
        } else if (!['completed', 'degraded'].includes(evaluation.review_status.status)) {
            errors.push("review_status.status 必须是 'completed' 或 'degraded'");
        } else if (typeof evaluation.review_status.degraded !== 'boolean') {
            errors.push('review_status.degraded 必须是布尔值');
        } else {
            if (evaluation.review_degraded !== undefined && evaluation.review_degraded !== evaluation.review_status.degraded) {
                errors.push('review_degraded 必须与 review_status.degraded 保持一致');
            }
            if (evaluation.review_status.status === 'degraded' && evaluation.review_status.degraded !== true) {
                errors.push("review_status.status 为 degraded 时，review_status.degraded 必须为 true");
            }
            if (evaluation.review_status.status === 'completed' && evaluation.review_status.degraded !== false) {
                errors.push("review_status.status 为 completed 时，review_status.degraded 必须为 false");
            }
        }
    }

    if (!Array.isArray(evaluation.sentences)) {
        errors.push('sentences 必须是数组');
    } else {
        for (let sentenceIndex = 0; sentenceIndex < evaluation.sentences.length; sentenceIndex += 1) {
            const sentence = evaluation.sentences[sentenceIndex];
            if (typeof sentence.index !== 'number') {
                errors.push(`sentences[${sentenceIndex}].index 必须是数字`);
            }
            if (typeof sentence.original !== 'string') {
                errors.push(`sentences[${sentenceIndex}].original 必须是字符串`);
            }
            if (!Array.isArray(sentence.errors)) {
                errors.push(`sentences[${sentenceIndex}].errors 必须是数组`);
                continue;
            }
            for (let errorIndex = 0; errorIndex < sentence.errors.length; errorIndex += 1) {
                const errorItem = sentence.errors[errorIndex];
                if (!errorItem || typeof errorItem !== 'object') {
                    errors.push(`sentences[${sentenceIndex}].errors[${errorIndex}] 必须是对象`);
                    continue;
                }
                if (!errorItem.range || typeof errorItem.range !== 'object') {
                    errors.push(`sentences[${sentenceIndex}].errors[${errorIndex}].range 必须是对象`);
                    continue;
                }
                if (errorItem.range.unit !== 'utf16') {
                    errors.push(`sentences[${sentenceIndex}].errors[${errorIndex}].range.unit 必须是 'utf16'`);
                }
                if (typeof errorItem.range.start !== 'number' || typeof errorItem.range.end !== 'number') {
                    errors.push(`sentences[${sentenceIndex}].errors[${errorIndex}].range.start/end 必须是数字`);
                }
                if (!Number.isInteger(errorItem.range.start) || !Number.isInteger(errorItem.range.end)) {
                    errors.push(`sentences[${sentenceIndex}].errors[${errorIndex}].range.start/end 必须是整数`);
                }
                if (errorItem.range.start < 0 || errorItem.range.end < 0 || errorItem.range.start > errorItem.range.end) {
                    errors.push(`sentences[${sentenceIndex}].errors[${errorIndex}] range 值不合法`);
                }
                if (
                    typeof errorItem.type !== 'string'
                    || typeof errorItem.word !== 'string'
                    || typeof errorItem.reason !== 'string'
                    || typeof errorItem.correction !== 'string'
                ) {
                    errors.push(`sentences[${sentenceIndex}].errors[${errorIndex}] 缺少 type/word/reason/correction 字符串字段`);
                }
            }
        }
    }

    if (typeof evaluation.overall_feedback !== 'string' || !evaluation.overall_feedback.trim()) {
        errors.push('overall_feedback 必须是非空字符串');
    }

    if (evaluation.review_degraded === true) {
        if (Array.isArray(evaluation.sentences) && evaluation.sentences.length > 0) {
            errors.push('review_degraded 为 true 时，sentences 必须为空数组');
        }
        if (Array.isArray(evaluation.review_blocks) && evaluation.review_blocks.length > 0) {
            errors.push('review_degraded 为 true 时，review_blocks 必须为空数组');
        }
    }

    for (const field of ['paragraph_reviews', 'review_blocks', 'improvement_plan', 'rewrite_suggestions']) {
        if (evaluation[field] !== undefined && !Array.isArray(evaluation[field])) {
            errors.push(`${field} 必须是数组`);
        }
    }

    if (Array.isArray(evaluation.review_blocks)) {
        for (let index = 0; index < evaluation.review_blocks.length; index += 1) {
            const block = evaluation.review_blocks[index];
            if (!block || typeof block !== 'object') {
                errors.push(`review_blocks[${index}] 必须是对象`);
                continue;
            }
            if (typeof block.paragraph_index !== 'number') {
                errors.push(`review_blocks[${index}].paragraph_index 必须是数字`);
            }
            for (const field of ['comment', 'analysis', 'feedback']) {
                if (typeof block[field] !== 'string') {
                    errors.push(`review_blocks[${index}].${field} 必须是字符串`);
                }
            }
        }
    }

    if (errors.length > 0) {
        const errorMessage = `评测结果验证失败:\n- ${errors.join('\n- ')}`;
        logger.error('Evaluation validation failed', null, null, { errors });

        const error = new Error(errorMessage);
        error.code = 'validation_error';
        throw error;
    }
}

function decorateEvaluationForStorage(evaluation, session) {
    const inputContext = {
        task_type: session?.task_type || null,
        topic_id: session?.topic_id || null,
        topic_source: session?.topic_source || null,
        topic_text: session?.topic_text || null,
        word_count: session?.word_count || null
    };
    const mergedInputContext = {
        ...(evaluation.input_context || {}),
        ...inputContext
    };
    const analysisEnvelope = normalizeMap(evaluation.analysis);

    return {
        ...evaluation,
        contract_version: evaluation.contract_version || EVALUATION_CONTRACT_VERSION,
        input_context: mergedInputContext,
        analysis: {
            ...analysisEnvelope,
            input_context: mergedInputContext
        },
        topic_text: inputContext.topic_text || null,
        topic_source: inputContext.topic_source || null
    };
}

function buildFallbackReviewEvaluation(scoringEvaluation, reviewError = null) {
    const reason = reviewError?.message
        ? `第二阶段详解生成失败，原因：${reviewError.message}。`
        : '第二阶段详解生成失败。';
    const overallFeedback = [
        reason,
        '以下建议基于第一阶段评分结果整理，建议稍后重试获取完整句级诊断。'
    ].join('');

    return {
        sentences: [],
        overall_feedback: overallFeedback,
        improvement_plan: Array.isArray(scoringEvaluation.improvement_plan) ? scoringEvaluation.improvement_plan : [],
        review_blocks: [],
        paragraph_reviews: [],
        rewrite_suggestions: []
    };
}

function normalizeAnalysisEnvelope(evaluation) {
    const nestedAnalysis = normalizeMap(evaluation.analysis);
    const taskAnalysis = normalizeMap(evaluation.task_analysis || nestedAnalysis.task_analysis);
    const bandRationale = normalizeMap(evaluation.band_rationale || nestedAnalysis.band_rationale);
    const improvementPlan = normalizeList(evaluation.improvement_plan || nestedAnalysis.improvement_plan);
    return {
        task_analysis: taskAnalysis,
        band_rationale: bandRationale,
        improvement_plan: improvementPlan
    };
}

function normalizeMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    return value;
}

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeList(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean);
}

function normalizeReviewBlocks(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .filter((item) => item && typeof item === 'object')
        .map((item) => {
            const paragraphIndex = Number(item.paragraph_index);
            return {
                paragraph_index: Number.isInteger(paragraphIndex) && paragraphIndex > 0
                    ? paragraphIndex
                    : null,
                comment: typeof item.comment === 'string'
                    ? item.comment.trim()
                    : '',
                analysis: typeof item.analysis === 'string'
                    ? item.analysis.trim()
                    : '',
                feedback: typeof item.feedback === 'string' ? item.feedback.trim() : ''
            };
        })
        .filter((item) => Number.isInteger(item.paragraph_index) && (item.comment || item.analysis || item.feedback));
}

function normalizeSentences(value) {
    if (!Array.isArray(value)) {
        const error = new Error('第二阶段 sentences 必须是数组');
        error.code = 'validation_error';
        throw error;
    }

    return value.flatMap((sentence, index) => {
        if (!sentence || typeof sentence !== 'object') {
            return [];
        }

        const normalizedIndex = Number(sentence.index);
        const original = normalizeText(sentence.original);
        if (!Number.isInteger(normalizedIndex) || normalizedIndex < 0) {
            return [];
        }
        if (!original) {
            return [];
        }

        const rawErrors = Array.isArray(sentence.errors) ? sentence.errors : [];
        const errors = rawErrors
            .map((item, errorIndex) => normalizeSentenceError(item, index, errorIndex))
            .filter(Boolean);

        return [{
            index: normalizedIndex,
            original,
            errors,
            ...(normalizeText(sentence.corrected)
                ? { corrected: normalizeText(sentence.corrected) }
                : {})
        }];
    });
}

function normalizeSentenceError(item, sentenceIndex, errorIndex) {
    if (!item || typeof item !== 'object') {
        return null;
    }

    const type = normalizeText(item.type);
    const word = normalizeText(item.word);
    const reason = normalizeText(item.reason);
    const correction = normalizeText(item.correction);
    const range = normalizeMap(item.range);

    const start = Number.isFinite(Number(range.start))
        ? Number(range.start)
        : (Number.isFinite(Number(item.start_pos)) ? Number(item.start_pos) : null);
    const end = Number.isFinite(Number(range.end))
        ? Number(range.end)
        : (Number.isFinite(Number(item.end_pos)) ? Number(item.end_pos) : null);
    const unit = normalizeText(range.unit) || 'utf16';

    if (!type || !word || !reason || !correction) {
        return null;
    }
    if (start === null || end === null || !Number.isInteger(start) || !Number.isInteger(end)) {
        return null;
    }
    if (start < 0 || end < 0 || start > end) {
        return null;
    }
    if (unit !== 'utf16') {
        return null;
    }

    return {
        type,
        word,
        range: { start, end, unit: 'utf16' },
        reason,
        correction
    };
}

function requireStructuredTextMap(value, requiredFields, label) {
    const normalized = {};
    const source = normalizeMap(value);

    for (const field of requiredFields) {
        const text = normalizeText(source[field]);
        if (!text) {
            const error = new Error(`${label} 缺少有效字段: ${field}`);
            error.code = 'validation_error';
            throw error;
        }
        normalized[field] = text;
    }

    return normalized;
}

function normalizeInputContext(value) {
    const source = normalizeMap(value);
    const promptSummary = normalizeText(source.prompt_summary);
    const requiredPoints = normalizeList(source.required_points);
    const majorRisks = normalizeList(source.major_risks);

    if (!promptSummary) {
        const error = new Error('第一阶段 input_context.prompt_summary 缺失');
        error.code = 'validation_error';
        throw error;
    }
    if (requiredPoints.length === 0) {
        const error = new Error('第一阶段 input_context.required_points 不能为空');
        error.code = 'validation_error';
        throw error;
    }

    return {
        prompt_summary: promptSummary,
        required_points: requiredPoints,
        major_risks: majorRisks
    };
}

function coerceScore(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return null;
    }
    return numeric;
}

export {
    EVALUATION_CONTRACT_VERSION,
    buildFallbackReviewEvaluation,
    buildReviewResponseFormat,
    buildReviewStageExample,
    buildScoringResponseFormat,
    buildScoringStageExample,
    coerceScore,
    decorateEvaluationForStorage,
    mergeStageResults,
    validateEvaluation,
    validateReviewStage,
    validateScoringStage
}
