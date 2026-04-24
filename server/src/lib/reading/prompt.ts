// @ts-nocheck

function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function uniqueList(list = []) {
    const seen = new Set();
    const output = [];
    list.forEach((item) => {
        const value = String(item || '').trim();
        if (!value || seen.has(value)) {
            return;
        }
        seen.add(value);
        output.push(value);
    });
    return output;
}

function clampConfidence(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'high' || normalized === 'medium' || normalized === 'low') {
        return normalized;
    }
    return 'medium';
}

function tryParseJson(value) {
    try {
        return JSON.parse(value);
    } catch (_) {
        return null;
    }
}

function parseJsonObject(rawContent, logger = null) {
    if (typeof rawContent !== 'string' || !rawContent.trim()) {
        const error = new Error('阅读教练返回为空');
        error.code = 'empty_response';
        throw error;
    }

    let jsonText = rawContent.trim();
    if (jsonText.startsWith('```json')) {
        jsonText = jsonText.replace(/```json\s*/gi, '').replace(/```\s*$/g, '').trim();
    } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/```\s*/g, '').replace(/```\s*$/g, '').trim();
    }

    const direct = tryParseJson(jsonText);
    if (direct) {
        return direct;
    }

    const start = jsonText.indexOf('{');
    if (start < 0) {
        return null;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < jsonText.length; index += 1) {
        const ch = jsonText[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === '"') {
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
                const candidate = jsonText.slice(start, index + 1);
                const parsed = tryParseJson(candidate);
                if (parsed) {
                    return parsed;
                }
            }
        }
    }

    if (logger && typeof logger.warn === 'function') {
        logger.warn('Reading coach response parse failed', null, {
            rawContentPreview: String(rawContent).slice(0, 400)
        });
    }

    return null;
}

function compactMultiline(value) {
    return String(value || '')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+\n/g, '\n')
        .trim();
}

function truncateText(value, maxLength) {
    const text = String(value || '').trim();
    if (!text || !Number.isFinite(maxLength) || maxLength <= 0 || text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, maxLength).trimEnd()}…`;
}

function buildLanguageInstruction(locale) {
    return locale === 'en'
        ? 'Respond in English. Keep question numbers, paragraph labels, and quoted evidence in their original form when useful.'
        : '请使用简体中文回答；题号、段落号、证据原文尽量保留原始表达。';
}

function buildRouteInstruction({ routeDecision, contextRoute, routes, contextRoutes }) {
    if (routeDecision.route !== routes.PAGE_GROUNDED) {
        return [
            '你是 IELTS 学习教练。',
            '对于非页面问题，给出简洁、可执行建议。',
            '不要假装引用当前文章证据。'
        ].join('\n');
    }

    if (contextRoute === contextRoutes.REVIEW) {
        return [
            '你是 IELTS 阅读复盘教练，必须优先基于给定上下文回答。',
            '你必须先核对题干、用户答案、标准答案、官方解析/证据，再解释错因。',
            '先指出错在什么，再说明证据在哪里，最后给下次更稳的判断规则。',
            '如果证据不够，明确写入 missingContext，不要硬编诊断。'
        ].join('\n');
    }

    if (contextRoute === contextRoutes.SELECTION) {
        return [
            '你是 IELTS 阅读局部辅助教练。',
            '用户只选中了局部文本，优先围绕选中内容和相关上下文回答。',
            '不要擅自扩展成整组复盘。'
        ].join('\n');
    }

    return [
        '你是 IELTS 阅读教练，必须优先基于给定上下文回答。',
        '当用户仍在做题时，不要直接泄露最终答案选项；给定位路径、排除逻辑和证据方向。',
        '当用户已提交或明确请求复盘时，可以给出明确结论，但仍必须绑定证据。',
        '如果上下文不足，要在 missingContext 列出缺口。'
    ].join('\n');
}

function buildResponseInstruction({ contextRoute, contextRoutes } = {}) {
    if (contextRoute === contextRoutes?.REVIEW) {
        return [
            '输出必须是 JSON 对象，禁止 markdown 代码块。',
            'JSON 字段必须为：answer, answerSections, followUps, confidence, missingContext, reviewOverall, reviewQuestionAnalyses。',
            'answerSections.type 只允许：direct_answer, reasoning, evidence, next_step。',
            'reviewOverall 必须给整组诊断：primaryWeakness, patternSummary, teachingPlan。',
            'reviewQuestionAnalyses 必须逐题说明：questionNumber, likelyMistake, whyUserChoseWrong, whyCorrectAnswerWorks, whyWrongAnswerFails, nextRule。',
            '先诊断后教学；整组易错模式归纳优先于逐题流水账。',
            '不要求每题都引用原文证据；但如果某题同时缺少 original_reading_passage_text 和 officialExplanation，必须在 missingContext 里说明该题证据不足。',
            '易错点先用一句自然语言总结；如果能落到常见阅读错误体系，就在表述中自然带出，例如审题、定位、同义替换、过度推断、TFNG/YNNG 判定混淆。',
            'confidence 只能是 high / medium / low。',
            '只能使用提供的 context chunks、reviewTargets、selected context 和 attempt context；禁止虚构证据。'
        ].join('\n');
    }
    return [
        '输出必须是 JSON 对象，禁止 markdown 代码块。',
        'JSON 字段必须为：answer, answerSections, followUps, confidence, missingContext。',
        'answerSections.type 只允许：direct_answer, reasoning, evidence, next_step。',
        'followUps 返回 2-3 条短的用户后续动作文案。',
        'confidence 只能是 high / medium / low。',
        '只能使用提供的 context chunks、reviewTargets、selected context 和 attempt context；禁止虚构证据。'
    ].join('\n');
}

function formatHistory(history = []) {
    if (!Array.isArray(history) || history.length === 0) {
        return 'none';
    }
    return history
        .slice(-6)
        .map((item, index) => `[History ${index + 1}] ${item.role}: ${truncateText(item.content, 280)}`)
        .join('\n');
}

function formatAttemptContext(attemptContext = {}) {
    const selectedAnswers = isObject(attemptContext.selectedAnswers)
        ? Object.entries(attemptContext.selectedAnswers)
            .map(([questionNumber, answer]) => `Q${questionNumber}=${answer}`)
            .join(' | ')
        : 'none';
    const wrongQuestions = Array.isArray(attemptContext.wrongQuestions) && attemptContext.wrongQuestions.length
        ? attemptContext.wrongQuestions.join(', ')
        : 'none';
    return [
        `submitted: ${attemptContext.submitted ? 'yes' : 'no'}`,
        `score: ${attemptContext.score == null ? 'unknown' : attemptContext.score}`,
        `wrongQuestions: ${wrongQuestions}`,
        `selectedAnswers: ${selectedAnswers}`
    ].join('\n');
}

function formatSelectedContext(payload) {
    const selectedContext = isObject(payload.selectedContext) ? payload.selectedContext : null;
    const selectedText = String(payload.selectedText || '').trim();
    if (!selectedContext && !selectedText) {
        return 'none';
    }
    const lines = [];
    if (selectedContext) {
        lines.push(`scope: ${selectedContext.scope || 'unknown'}`);
        lines.push(`text: ${truncateText(selectedContext.text || '', 320) || 'none'}`);
        lines.push(`questionNumbers: ${Array.isArray(selectedContext.questionNumbers) && selectedContext.questionNumbers.length ? selectedContext.questionNumbers.join(', ') : 'none'}`);
        lines.push(`paragraphLabels: ${Array.isArray(selectedContext.paragraphLabels) && selectedContext.paragraphLabels.length ? selectedContext.paragraphLabels.join(', ') : 'none'}`);
    } else {
        lines.push(`scope: unknown`);
        lines.push(`text: ${truncateText(selectedText, 320) || 'none'}`);
    }
    if (selectedText && (!selectedContext || selectedText !== selectedContext.text)) {
        lines.push(`selectedText: ${truncateText(selectedText, 320)}`);
    }
    return lines.join('\n');
}

function formatRetrievalSummary(retrieval = {}) {
    return [
        `focusQuestionNumbers: ${Array.isArray(retrieval.focusQuestionNumbers) && retrieval.focusQuestionNumbers.length ? retrieval.focusQuestionNumbers.join(', ') : 'none'}`,
        `focusParagraphLabels: ${Array.isArray(retrieval.focusParagraphLabels) && retrieval.focusParagraphLabels.length ? retrieval.focusParagraphLabels.join(', ') : 'none'}`,
        `usedQuestionNumbers: ${Array.isArray(retrieval.usedQuestionNumbers) && retrieval.usedQuestionNumbers.length ? retrieval.usedQuestionNumbers.join(', ') : 'none'}`,
        `usedParagraphLabels: ${Array.isArray(retrieval.usedParagraphLabels) && retrieval.usedParagraphLabels.length ? retrieval.usedParagraphLabels.join(', ') : 'none'}`,
        `finalChunkCount: ${Array.isArray(retrieval.finalChunks) ? retrieval.finalChunks.length : 0}`,
        `missingContextHints: ${Array.isArray(retrieval.missingContext) && retrieval.missingContext.length ? retrieval.missingContext.join('；') : 'none'}`
    ].join('\n');
}

function formatReviewTargets(reviewTargets = []) {
    if (!Array.isArray(reviewTargets) || reviewTargets.length === 0) {
        return 'none';
    }
    return reviewTargets.map((item, index) => [
        `[Review ${index + 1}]`,
        `questionNumber: Q${item.questionNumber}`,
        `questionStem: ${truncateText(item.questionStem || 'none', 520)}`,
        `userAnswer: ${item.selectedAnswer || '未记录'}`,
        `correctAnswer: ${item.correctAnswer || '未知'}`,
        `officialExplanation: ${truncateText(item.officialExplanation || 'none', 900)}`
    ].join('\n')).join('\n\n');
}

function formatContextChunks(chunks = [], chunkType = {}) {
    if (!Array.isArray(chunks) || chunks.length === 0) {
        return 'none';
    }
    return chunks.map((chunk, index) => {
        const questionNumbers = Array.isArray(chunk.questionNumbers) && chunk.questionNumbers.length
            ? `Q${chunk.questionNumbers.join(',Q')}`
            : 'n/a';
        const paragraphLabels = Array.isArray(chunk.paragraphLabels) && chunk.paragraphLabels.length
            ? chunk.paragraphLabels.join(',')
            : 'n/a';
        return [
            `[Context ${index + 1}]`,
            `chunkType: ${chunk.chunkType}`,
            `source: ${chunk.chunkType === chunkType.PASSAGE ? 'original_reading_passage_text' : 'derived_question_context'}`,
            `questionNumbers: ${questionNumbers}`,
            `paragraphLabels: ${paragraphLabels}`,
            truncateText(chunk.content, chunk.chunkType === chunkType.PASSAGE ? 900 : 700)
        ].join('\n');
    }).join('\n\n');
}

function buildReadingCoachPrompt({ payload, routeDecision, intent, contextRoute, retrieval, routes, contextRoutes, chunkType }) {
    const locale = payload.locale === 'en' ? 'en' : 'zh';

    return [
        {
            role: 'system',
            content: compactMultiline([
                buildRouteInstruction({ routeDecision, contextRoute, routes, contextRoutes }),
                buildLanguageInstruction(locale),
                buildResponseInstruction({ contextRoute, contextRoutes })
            ].join('\n\n'))
        },
        {
            role: 'user',
            content: compactMultiline([
                '[Request Meta]',
                `examId: ${payload.examId}`,
                `route: ${routeDecision.route}`,
                `routeReason: ${routeDecision.reason || 'none'}`,
                `contextRoute: ${contextRoute}`,
                `intent: ${intent.kind}`,
                '',
                '[Learner Request]',
                `userQuery: ${payload.query || '请给我当前题目的学习指导'}`,
                '',
                '[Attempt Context]',
                formatAttemptContext(payload.attemptContext || {}),
                '',
                '[Selected Context]',
                formatSelectedContext(payload),
                '',
                '[History]',
                formatHistory(payload.history),
                '',
                '[Retrieval Summary]',
                formatRetrievalSummary(retrieval),
                '',
                '[Review Targets]',
                formatReviewTargets(retrieval.reviewTargets),
                '',
                '[Context Chunks]',
                formatContextChunks(retrieval.finalChunks, chunkType)
            ].join('\n'))
        }
    ];
}

function buildCoachResponseFormat({ contextRoute, contextRoutes } = {}) {
    const isReview = contextRoute === contextRoutes?.REVIEW;
    const baseProperties = {
        answer: { type: 'string' },
        answerSections: {
            type: 'array',
            minItems: 1,
            maxItems: 4,
            items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    type: {
                        type: 'string',
                        enum: ['direct_answer', 'reasoning', 'evidence', 'next_step']
                    },
                    text: { type: 'string' }
                },
                required: ['type', 'text']
            }
        },
        followUps: {
            type: 'array',
            minItems: 0,
            maxItems: 3,
            items: { type: 'string' }
        },
        confidence: {
            type: 'string',
            enum: ['high', 'medium', 'low']
        },
        missingContext: {
            type: 'array',
            minItems: 0,
            maxItems: 6,
            items: { type: 'string' }
        }
    };
    const reviewProperties = isReview ? {
        reviewOverall: {
            type: 'object',
            additionalProperties: false,
            properties: {
                primaryWeakness: { type: 'string' },
                patternSummary: { type: 'string' },
                teachingPlan: { type: 'string' }
            },
            required: ['primaryWeakness', 'patternSummary', 'teachingPlan']
        },
        reviewQuestionAnalyses: {
            type: 'array',
            minItems: 0,
            maxItems: 14,
            items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    questionNumber: { type: 'string' },
                    likelyMistake: { type: 'string' },
                    whyUserChoseWrong: { type: 'string' },
                    whyCorrectAnswerWorks: { type: 'string' },
                    whyWrongAnswerFails: { type: 'string' },
                    nextRule: { type: 'string' }
                },
                required: ['questionNumber', 'likelyMistake', 'whyUserChoseWrong', 'whyCorrectAnswerWorks', 'whyWrongAnswerFails', 'nextRule']
            }
        }
    } : {};
    const required = isReview
        ? ['answer', 'answerSections', 'followUps', 'confidence', 'missingContext', 'reviewOverall', 'reviewQuestionAnalyses']
        : ['answer', 'answerSections', 'followUps', 'confidence', 'missingContext'];
    return {
        type: 'json_schema',
        json_schema: {
            name: 'reading_coach_v2_response',
            strict: true,
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: Object.assign({}, baseProperties, reviewProperties),
                required
            }
        }
    };
}

function normalizeReadingCoachModelResponse(rawContent, logger = null) {
    const parsed = parseJsonObject(rawContent, logger);
    if (!isObject(parsed)) {
        const error = new Error('阅读教练响应解析失败');
        error.code = 'coach_parse_failed';
        throw error;
    }

    const sections = Array.isArray(parsed.answerSections)
        ? parsed.answerSections
            .map((item) => {
                if (!isObject(item)) return null;
                const type = String(item.type || '').trim();
                if (!['direct_answer', 'reasoning', 'evidence', 'next_step'].includes(type)) {
                    return null;
                }
                const text = String(item.text || '').trim();
                if (!text) {
                    return null;
                }
                return { type, text };
            })
            .filter(Boolean)
            .slice(0, 4)
        : [];

    const answer = String(parsed.answer || '').trim();
    const fallbackSections = sections.length
        ? sections
        : (answer
            ? [{ type: 'direct_answer', text: answer }]
            : []);

    if (!fallbackSections.length) {
        const error = new Error('阅读教练响应缺少有效 answerSections');
        error.code = 'coach_parse_failed';
        throw error;
    }

    const followUps = uniqueList(
        (Array.isArray(parsed.followUps) ? parsed.followUps : [])
            .map((item) => String(item || '').trim())
            .filter(Boolean)
    ).slice(0, 3);

    const defaultFollowUps = ['再给我一步提示', '这题证据在哪里', '我下一步该练什么'];

    return {
        answer,
        answerSections: fallbackSections,
        followUps: followUps.length ? followUps : defaultFollowUps,
        confidence: clampConfidence(parsed.confidence),
        missingContext: uniqueList(
            (Array.isArray(parsed.missingContext) ? parsed.missingContext : [])
                .map((item) => String(item || '').trim())
                .filter(Boolean)
        ).slice(0, 6),
        reviewOverall: normalizeReviewOverall(parsed.reviewOverall),
        reviewQuestionAnalyses: normalizeReviewQuestionAnalyses(parsed.reviewQuestionAnalyses)
    };
}

function normalizeReviewOverall(value) {
    if (!isObject(value)) {
        return null;
    }
    const primaryWeakness = String(value.primaryWeakness || '').trim();
    const patternSummary = String(value.patternSummary || '').trim();
    const teachingPlan = String(value.teachingPlan || '').trim();
    if (!primaryWeakness && !patternSummary && !teachingPlan) {
        return null;
    }
    return { primaryWeakness, patternSummary, teachingPlan };
}

function normalizeReviewQuestionAnalyses(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((item) => {
            if (!isObject(item)) return null;
            const questionNumber = String(item.questionNumber || '').trim().replace(/^q/i, '');
            const likelyMistake = String(item.likelyMistake || '').trim();
            const whyUserChoseWrong = String(item.whyUserChoseWrong || '').trim();
            const whyCorrectAnswerWorks = String(item.whyCorrectAnswerWorks || '').trim();
            const whyWrongAnswerFails = String(item.whyWrongAnswerFails || '').trim();
            const nextRule = String(item.nextRule || '').trim();
            if (!questionNumber && !likelyMistake && !whyUserChoseWrong && !whyCorrectAnswerWorks && !whyWrongAnswerFails && !nextRule) {
                return null;
            }
            return {
                questionNumber,
                likelyMistake,
                whyUserChoseWrong,
                whyCorrectAnswerWorks,
                whyWrongAnswerFails,
                nextRule
            };
        })
        .filter(Boolean)
        .slice(0, 14);
}

function composeReadingCoachAnswer(answerSections, fallbackAnswer) {
    if (Array.isArray(answerSections) && answerSections.length) {
        return answerSections.map((item) => item.text).join('\n\n').trim();
    }
    return String(fallbackAnswer || '').trim();
}

export {
    buildReadingCoachPrompt,
    buildCoachResponseFormat,
    normalizeReadingCoachModelResponse,
    composeReadingCoachAnswer,
    parseJsonObject
};
