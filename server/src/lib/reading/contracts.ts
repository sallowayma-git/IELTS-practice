// @ts-nocheck

const READING_COACH_VERSION = 'v2';

const READING_ROUTES = Object.freeze({
    UNRELATED_CHAT: 'unrelated_chat',
    IELTS_GENERAL: 'ielts_general',
    PAGE_GROUNDED: 'page_grounded'
});

const READING_CONTEXT_ROUTES = Object.freeze({
    TUTOR: 'tutor',
    SELECTION: 'selection',
    REVIEW: 'review',
    FOLLOWUP: 'followup',
    CLARIFY: 'clarify',
    SIMILAR: 'similar'
});

const READING_INTENTS = Object.freeze({
    GROUNDED_QUESTION: 'grounded_question',
    WHOLE_SET_OR_REVIEW: 'whole_set_or_review',
    FOLLOWUP_REQUEST: 'followup_request',
    SOCIAL_OR_SMALLTALK: 'social_or_smalltalk',
    GENERAL_CHAT: 'general_chat',
    SELECTION_TOOL_REQUEST: 'selection_tool_request',
    REVIEW_COACH_REQUEST: 'review_coach_request',
    CLARIFY: 'clarify'
});

const READING_CHUNK_TYPE = Object.freeze({
    PASSAGE: 'passage_paragraph',
    QUESTION: 'question_item',
    ANSWER_KEY: 'answer_key',
    EXPLANATION: 'answer_explanation'
});

const READING_QUICK_ACTIONS = Object.freeze([
    { id: 'hint', label: '给我提示' },
    { id: 'explain', label: '解释这题' },
    { id: 'review', label: '复盘错题' },
    { id: 'similar', label: '推荐同类题' }
]);

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

function countChunksByType(chunks = []) {
    return (Array.isArray(chunks) ? chunks : []).reduce((accumulator, chunk) => {
        const type = String(chunk?.chunkType || 'unknown');
        accumulator[type] = (accumulator[type] || 0) + 1;
        return accumulator;
    }, {});
}

function resolveReadingResponseKind(route, intent) {
    const kind = String(intent?.kind || '');
    if (route === READING_ROUTES.UNRELATED_CHAT) {
        return kind === READING_INTENTS.SOCIAL_OR_SMALLTALK ? 'social' : 'chat';
    }
    if (kind === READING_INTENTS.SELECTION_TOOL_REQUEST) {
        return 'tool_result';
    }
    if (kind === READING_INTENTS.REVIEW_COACH_REQUEST || kind === READING_INTENTS.WHOLE_SET_OR_REVIEW) {
        return 'review';
    }
    if (kind === READING_INTENTS.CLARIFY) {
        return 'clarify';
    }
    return route === READING_ROUTES.PAGE_GROUNDED ? 'grounded' : 'chat';
}

function buildReadingRetrievalDiagnostics({
    route,
    contextRoute,
    intent,
    retrieval,
    cacheHit = false
} = {}) {
    const finalChunks = Array.isArray(retrieval?.finalChunks) ? retrieval.finalChunks : [];
    const sortedChunks = Array.isArray(retrieval?.sortedChunks) ? retrieval.sortedChunks : [];
    const reviewTargets = Array.isArray(retrieval?.reviewTargets) ? retrieval.reviewTargets : [];
    return {
        route: String(route || ''),
        contextRoute: String(contextRoute || ''),
        intent: String(intent?.kind || ''),
        chunkCount: finalChunks.length,
        deterministicChunkCount: sortedChunks.length,
        finalChunkTypeCounts: countChunksByType(finalChunks),
        focusQuestionNumbers: uniqueList(retrieval?.focusQuestionNumbers || []),
        focusParagraphLabels: uniqueList(retrieval?.focusParagraphLabels || []),
        usedQuestionNumbers: uniqueList(retrieval?.usedQuestionNumbers || []),
        usedParagraphLabels: uniqueList(retrieval?.usedParagraphLabels || []),
        missingContext: uniqueList(retrieval?.missingContext || []),
        reviewTargetCount: reviewTargets.length,
        cacheHit: Boolean(cacheHit)
    };
}

function buildReadingTimings({ startedAt, retrievalMs = 0, cacheHit = false } = {}) {
    const totalMs = Math.max(0, Date.now() - Number(startedAt || Date.now()));
    const normalizedRetrievalMs = Math.max(0, Number(retrievalMs) || 0);
    return {
        total_ms: totalMs,
        retrieval_ms: normalizedRetrievalMs,
        generation_ms: Math.max(0, totalMs - normalizedRetrievalMs),
        cache_hit: Boolean(cacheHit)
    };
}

function buildReadingModelTrace({ usedConfig = null, providerPath = [], startedAt } = {}) {
    return {
        config_id: usedConfig?.id || null,
        provider: usedConfig?.provider || null,
        model: usedConfig?.default_model || null,
        provider_path: Array.isArray(providerPath) ? providerPath : [],
        latency_ms: Math.max(0, Date.now() - Number(startedAt || Date.now()))
    };
}

function buildReadingCoachResult({
    generatedAt,
    routeDecision,
    contextRoute,
    intent,
    answer,
    parsed,
    retrieval,
    citations,
    usedConfig,
    providerPath,
    startedAt,
    retrievalMs
} = {}) {
    const route = routeDecision?.route || READING_ROUTES.PAGE_GROUNDED;
    const responseKind = resolveReadingResponseKind(route, intent);
    const retrievalDiagnostics = buildReadingRetrievalDiagnostics({
        route,
        contextRoute,
        intent,
        retrieval,
        cacheHit: false
    });
    return {
        coachVersion: READING_COACH_VERSION,
        generatedAt,
        route,
        routeReason: routeDecision?.reason || '',
        contextRoute,
        intent,
        answer: String(answer || ''),
        answerSections: parsed?.answerSections || [],
        reviewOverall: parsed?.reviewOverall || null,
        reviewQuestionAnalyses: parsed?.reviewQuestionAnalyses || [],
        followUps: parsed?.followUps || [],
        confidence: parsed?.confidence || 'medium',
        missingContext: uniqueList([...(retrieval?.missingContext || []), ...(parsed?.missingContext || [])]).slice(0, 6),
        citations: Array.isArray(citations) ? citations : [],
        usedQuestionNumbers: retrieval?.usedQuestionNumbers || [],
        usedParagraphLabels: retrieval?.usedParagraphLabels || [],
        quickActions: READING_QUICK_ACTIONS.slice(),
        responseKind,
        contextDiagnostics: retrievalDiagnostics,
        retrievalDiagnostics,
        model_trace: buildReadingModelTrace({ usedConfig, providerPath, startedAt }),
        timings: buildReadingTimings({ startedAt, retrievalMs, cacheHit: false })
    };
}

export {
    READING_COACH_VERSION,
    READING_ROUTES,
    READING_CONTEXT_ROUTES,
    READING_INTENTS,
    READING_CHUNK_TYPE,
    READING_QUICK_ACTIONS,
    resolveReadingResponseKind,
    buildReadingRetrievalDiagnostics,
    buildReadingTimings,
    buildReadingModelTrace,
    buildReadingCoachResult
};
