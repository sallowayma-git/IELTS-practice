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

const IELTS_READING_REVIEW_QUESTION_LIMIT = 40;

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
            '你是 IELTS 阅读错因洞察教练，目标不是讲题，而是帮助用户看见自己为什么会那样想。',
            '必须先核对题干、用户答案、标准答案、官方解析/原文片段，但这些只作为诊断依据，不作为主要展示内容。',
            '优先分析用户的思考偏差：他可能抓住了哪个词、忽略了哪个限制、被哪个干扰项诱导、在哪一步停止了核对。',
            '不要机械复述原文、不要搬运官方解析、不要逐题输出“原文说/正确答案是”的讲解稿。',
            '如果证据不够，明确写入 missingContext；但仍可基于题型、用户答案和正确答案给出低置信度的思维路径假设。'
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
            'answerSections.type 只允许：direct_answer, reasoning, next_step；review 场景禁止使用 evidence 类型当主输出。',
            'answer 必须是 2-4 句总评：先说整组易错模式，再说用户可能的思维漏洞，最后给一个思考方向；不要列答案讲解。',
            'answerSections 只写错因洞察和思考引导，不写原文翻译、段落复述、官方解析复述。',
            'reviewOverall 必须给整组诊断：primaryWeakness 是一句核心易错点，patternSummary 是错题之间的共同思维模式，teachingPlan 是下一次做题的思考流程。',
            'reviewQuestionAnalyses 必须逐题说明：questionNumber, likelyMistake, whyUserChoseWrong, whyCorrectAnswerWorks, whyWrongAnswerFails, nextRule。',
            'whyUserChoseWrong 要重点推测用户为什么会被错误答案吸引，例如只看前半句、只匹配关键词、忽略限定词、把未提及当否定、被干扰选项的局部真实信息误导。',
            'whyCorrectAnswerWorks 和 whyWrongAnswerFails 只用于解释认知差距，不要写成完整题目讲解；每项不超过 2 句。',
            '先诊断后教学；整组易错模式归纳优先于逐题流水账；逐题分析只服务于归纳用户的长期易错点。',
            '不要求每题引用原文证据；如需引用，最多引用一个很短的关键短语用于说明“用户漏看/误读的差距”。',
            '如果某题同时缺少 original_reading_passage_text 和 officialExplanation，必须在 missingContext 里说明该题证据不足。',
            '易错点先用一句自然语言总结；如果能落到常见阅读错误体系，就在表述中自然带出，例如审题、定位、同义替换、过度推断、TFNG/YNNG 判定混淆。',
            'confidence 只能是 high / medium / low。',
            '只能使用提供的 context chunks、reviewTargets、selected context 和 attempt context；禁止虚构证据。',
            'Context Chunks 和 officialExplanation 是诊断材料，不是最终答案模板；不得大段复制。'
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
    const analysisSignals = isObject(attemptContext.analysisSignals)
        ? Object.entries(attemptContext.analysisSignals)
            .map(([key, value]) => `${key}=${value}`)
            .join(' | ')
        : 'none';
    const markedQuestions = Array.isArray(attemptContext.markedQuestions) && attemptContext.markedQuestions.length
        ? attemptContext.markedQuestions.join(', ')
        : 'none';
    const questionTimelineLite = Array.isArray(attemptContext.questionTimelineLite) && attemptContext.questionTimelineLite.length
        ? attemptContext.questionTimelineLite
            .slice(0, 12)
            .map((entry) => {
                if (!isObject(entry)) return null;
                const label = String(entry.displayLabel || entry.questionId || '').trim().replace(/^q/i, '');
                const changeCount = Number.isFinite(Number(entry.changeCount)) ? Number(entry.changeCount) : 0;
                const visitCount = Number.isFinite(Number(entry.visitCount)) ? Number(entry.visitCount) : 0;
                const elapsedMs = Number.isFinite(Number(entry.elapsedMs ?? entry.durationMs))
                    ? Number(entry.elapsedMs ?? entry.durationMs)
                    : 0;
                return label ? `Q${label}:changes=${changeCount},visits=${visitCount},elapsedMs=${elapsedMs}` : null;
            })
            .filter(Boolean)
            .join(' | ')
        : 'none';
    const questionTypePerformance = isObject(attemptContext.questionTypePerformance)
        ? Object.entries(attemptContext.questionTypePerformance)
            .map(([kind, entry]) => {
                if (!isObject(entry)) return null;
                const total = Number.isFinite(Number(entry.total)) ? Number(entry.total) : 0;
                const correct = Number.isFinite(Number(entry.correct)) ? Number(entry.correct) : 0;
                const accuracy = Number.isFinite(Number(entry.accuracy)) ? `${Math.round(Number(entry.accuracy) * 100)}%` : 'unknown';
                return `${kind}:${correct}/${total}(${accuracy})`;
            })
            .filter(Boolean)
            .join(' | ')
        : 'none';
    return [
        `submitted: ${attemptContext.submitted ? 'yes' : 'no'}`,
        `score: ${attemptContext.score == null ? 'unknown' : attemptContext.score}`,
        `wrongQuestions: ${wrongQuestions}`,
        `selectedAnswers: ${selectedAnswers}`,
        `analysisSignals: ${analysisSignals}`,
        `markedQuestions: ${markedQuestions}`,
        `questionTimelineLite: ${questionTimelineLite}`,
        `questionTypePerformance: ${questionTypePerformance}`
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
    return reviewTargets.map((item, index) => {
        const passageEvidence = Array.isArray(item.passageEvidence) && item.passageEvidence.length
            ? item.passageEvidence.map((entry, evidenceIndex) => {
                const labels = Array.isArray(entry?.paragraphLabels) && entry.paragraphLabels.length
                    ? entry.paragraphLabels.join(',')
                    : 'n/a';
                return `passageEvidence${evidenceIndex + 1}: paragraphs=${labels}; text=${truncateText(entry?.text || '', 360)}`;
            }).join('\n')
            : 'passageEvidence: none';
        const attemptSignals = item.attemptSignals && typeof item.attemptSignals === 'object'
            ? item.attemptSignals
            : {};
        const timeline = attemptSignals.timeline && typeof attemptSignals.timeline === 'object'
            ? `changes=${Number(attemptSignals.timeline.changeCount || 0)}, visits=${Number(attemptSignals.timeline.visitCount || 0)}, elapsedMs=${Number(attemptSignals.timeline.elapsedMs || 0)}`
            : 'none';
        const questionTypePerformance = Array.isArray(attemptSignals.questionTypePerformance) && attemptSignals.questionTypePerformance.length
            ? attemptSignals.questionTypePerformance.join('; ')
            : 'none';
        const analysisSignals = Array.isArray(attemptSignals.analysisSignals) && attemptSignals.analysisSignals.length
            ? attemptSignals.analysisSignals.join('; ')
            : 'none';
        return [
            `[Review ${index + 1}]`,
            `questionNumber: Q${item.questionNumber}`,
            `questionStem: ${truncateText(item.questionStem || 'none', 520)}`,
            `userAnswer: ${item.selectedAnswer || '未记录'}`,
            `correctAnswer: ${item.correctAnswer || '未知'}`,
            `officialExplanation: ${truncateText(item.officialExplanation || 'none', 900)}`,
            passageEvidence,
            `attemptSignals: marked=${attemptSignals.marked ? 'true' : 'false'}; timeline=${timeline}; questionTypePerformance=${questionTypePerformance}; analysisSignals=${analysisSignals}`
        ].join('\n');
    }).join('\n\n');
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
                `sessionId: ${payload.sessionId || 'none'}`,
                `mode: ${payload.mode || 'none'}`,
                `surface: ${payload.surface || 'none'}`,
                `action: ${payload.action || 'chat'}`,
                `promptKind: ${payload.promptKind || 'none'}`,
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
    const sectionTypes = isReview
        ? ['direct_answer', 'reasoning', 'next_step']
        : ['direct_answer', 'reasoning', 'evidence', 'next_step'];
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
                        enum: sectionTypes
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
            minItems: 1,
            maxItems: IELTS_READING_REVIEW_QUESTION_LIMIT,
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

function createCoachParseError(message) {
    const error = new Error(message);
    error.code = 'coach_parse_failed';
    return error;
}

function normalizeReadingCoachModelResponse(rawContent, logger = null, options = {}) {
    const requireReviewSchema = Boolean(options && options.requireReviewSchema);
    const parsed = parseJsonObject(rawContent, logger);
    if (!isObject(parsed)) {
        throw createCoachParseError('阅读教练响应解析失败');
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
        throw createCoachParseError('阅读教练响应缺少有效 answerSections');
    }

    const followUps = uniqueList(
        (Array.isArray(parsed.followUps) ? parsed.followUps : [])
            .map((item) => String(item || '').trim())
            .filter(Boolean)
    ).slice(0, 3);

    const defaultFollowUps = ['再给我一步提示', '这题证据在哪里', '我下一步该练什么'];

    const normalized = {
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

    if (requireReviewSchema) {
        validateReviewCoachResponse(normalized, parsed);
    }

    return normalized;
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

function validateReviewCoachResponse(value, rawParsed = {}) {
    if (!isObject(rawParsed.reviewOverall) || !isObject(value.reviewOverall)) {
        throw createCoachParseError('阅读教练复盘响应缺少 reviewOverall');
    }
    const { primaryWeakness, patternSummary, teachingPlan } = value.reviewOverall;
    if (!primaryWeakness || !patternSummary || !teachingPlan) {
        throw createCoachParseError('阅读教练复盘响应 reviewOverall 不完整');
    }
    if (!Array.isArray(rawParsed.reviewQuestionAnalyses) || !Array.isArray(value.reviewQuestionAnalyses)) {
        throw createCoachParseError('阅读教练复盘响应缺少 reviewQuestionAnalyses');
    }
    if (value.reviewQuestionAnalyses.length === 0) {
        throw createCoachParseError('阅读教练复盘响应缺少有效逐题分析');
    }
    if (value.answerSections.some((item) => item.type === 'evidence')) {
        throw createCoachParseError('阅读教练复盘响应不允许 evidence 作为主输出段落');
    }
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
