// @ts-nocheck

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

function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeQuestionNumbers(values = []) {
    return uniqueList(
        (Array.isArray(values) ? values : [])
            .map((item) => String(item || '').trim().replace(/^q/i, ''))
            .filter(Boolean)
    );
}

function normalizeParagraphLabels(values = []) {
    return uniqueList(
        (Array.isArray(values) ? values : [])
            .map((item) => String(item || '').trim().replace(/^paragraph\s*/i, '').toUpperCase())
            .filter(Boolean)
    );
}

function classifyReadingRoute(payload, { routes, socialPatterns, weatherTimePatterns, ieltsGeneralPatterns, pageGroundedHints }) {
    const query = payload.query;
    if (!query) {
        return { route: routes.PAGE_GROUNDED, reason: 'empty_query' };
    }

    const normalized = query.trim();
    if (socialPatterns.some((pattern) => pattern.test(normalized))) {
        return { route: routes.UNRELATED_CHAT, reason: 'social_pattern' };
    }
    if (weatherTimePatterns.some((pattern) => pattern.test(normalized))) {
        return { route: routes.UNRELATED_CHAT, reason: 'real_world_query' };
    }

    const hasIeltsSignals = ieltsGeneralPatterns.every((pattern, index) => {
        if (index === 0) {
            return true;
        }
        return pattern.test(normalized);
    }) || (ieltsGeneralPatterns[0].test(normalized) && ieltsGeneralPatterns[2].test(normalized));

    const selectedContext = isObject(payload.selectedContext) ? payload.selectedContext : {};
    const selectedQuestionNumbers = normalizeQuestionNumbers(selectedContext.questionNumbers);
    const selectedParagraphLabels = normalizeParagraphLabels(selectedContext.paragraphLabels);
    const hasPageGroundedSignals = pageGroundedHints.some((pattern) => pattern.test(normalized))
        || payload.selectedText
        || payload.focusQuestionNumbers.length > 0
        || selectedQuestionNumbers.length > 0
        || selectedParagraphLabels.length > 0
        || payload.attemptContext.submitted;

    if (hasIeltsSignals && !hasPageGroundedSignals) {
        return { route: routes.IELTS_GENERAL, reason: 'ielts_general_pattern' };
    }

    return { route: routes.PAGE_GROUNDED, reason: hasPageGroundedSignals ? 'page_signal' : 'default_page_grounded' };
}

function extractQuestionRefs(query, questionRefPatternGlobal) {
    const normalized = String(query || '');
    const questionNumbers = [];
    const paragraphLabels = [];
    if (!normalized) {
        return { questionNumbers, paragraphLabels };
    }

    const matcher = new RegExp(questionRefPatternGlobal.source, questionRefPatternGlobal.flags);
    let match = matcher.exec(normalized);
    while (match) {
        const qNum = match[1] || match[2] || match[3];
        const pLabel = match[4] || match[5];
        if (qNum) {
            questionNumbers.push(String(qNum));
        }
        if (pLabel) {
            paragraphLabels.push(String(pLabel).toUpperCase());
        }
        match = matcher.exec(normalized);
    }

    return {
        questionNumbers: uniqueList(questionNumbers),
        paragraphLabels: uniqueList(paragraphLabels)
    };
}

function hasWholeSetReviewSignal(query, wholeSetPatterns) {
    const normalized = String(query || '').trim();
    if (!normalized) {
        return false;
    }
    return wholeSetPatterns.some((pattern) => pattern.test(normalized));
}

function hasQuestionLevelDiagnosticSignal(query) {
    const normalized = String(query || '').trim();
    if (!normalized) {
        return false;
    }
    return [
        /这道题|这题|当前题|当前这题|this\s+question|current\s+question/i,
        /证据|定位|原文|依据|哪段|哪里|where|evidence|locat|support|paragraph/i,
        /为什么.*(错|选)|错因|误选|为什么我|why.*wrong|why\s+did\s+i\s+choose|mistake/i,
        /正确答案|correct\s+answer/i
    ].some((pattern) => pattern.test(normalized));
}

function isReviewCoachRequest(payload) {
    const action = String(payload?.action || '').trim();
    const surface = String(payload?.surface || '').trim();
    return action === 'review_set'
        || action === 'recommend_drills'
        || surface === 'review_workspace';
}

function isPersistentReviewCoachRequest(payload) {
    const action = String(payload?.action || '').trim();
    const surface = String(payload?.surface || '').trim();
    return action === 'review_set' || surface === 'review_workspace';
}

function classifyReadingIntent(payload, route, {
    routes,
    intents,
    socialPatterns,
    wholeSetPatterns,
    questionRefPatternGlobal
}) {
    const query = payload.query;
    const extracted = extractQuestionRefs(query, questionRefPatternGlobal);
    const selectedContext = isObject(payload.selectedContext) ? payload.selectedContext : {};
    const questionNumbers = uniqueList([
        ...normalizeQuestionNumbers(payload.focusQuestionNumbers),
        ...normalizeQuestionNumbers(selectedContext.questionNumbers),
        ...extracted.questionNumbers
    ]);
    const paragraphLabels = uniqueList([
        ...normalizeParagraphLabels(selectedContext.paragraphLabels),
        ...extracted.paragraphLabels
    ]);
    const hasSpecificTargets = questionNumbers.length > 0 || paragraphLabels.length > 0;
    const explicitWholeSetReview = hasWholeSetReviewSignal(query, wholeSetPatterns) && !hasSpecificTargets;
    const questionLevelDiagnostic = hasQuestionLevelDiagnosticSignal(query);

    if (payload.action && ['translate', 'explain_selection', 'find_paraphrases', 'find_antonyms', 'extract_keywords', 'locate_evidence'].includes(payload.action) && payload.selectedText) {
        return {
            kind: intents.SELECTION_TOOL_REQUEST,
            confidence: 0.96,
            questionNumbers,
            paragraphLabels
        };
    }

    if (isReviewCoachRequest(payload)) {
        return {
            kind: intents.REVIEW_COACH_REQUEST,
            confidence: 0.92,
            questionNumbers,
            paragraphLabels
        };
    }

    if (payload.action === 'analyze_mistake') {
        if (hasSpecificTargets || questionLevelDiagnostic) {
            return {
                kind: intents.GROUNDED_QUESTION,
                confidence: 0.9,
                questionNumbers,
                paragraphLabels
            };
        }
        return {
            kind: intents.REVIEW_COACH_REQUEST,
            confidence: 0.88,
            questionNumbers,
            paragraphLabels
        };
    }

    if (payload.promptKind === 'followup') {
        return {
            kind: intents.FOLLOWUP_REQUEST,
            confidence: 0.8,
            questionNumbers,
            paragraphLabels
        };
    }

    if (route === routes.UNRELATED_CHAT) {
        const social = socialPatterns.some((pattern) => pattern.test(query || ''));
        return {
            kind: social ? intents.SOCIAL_OR_SMALLTALK : intents.GENERAL_CHAT,
            confidence: 0.88,
            questionNumbers: [],
            paragraphLabels: []
        };
    }

    if (explicitWholeSetReview) {
        return { kind: intents.WHOLE_SET_OR_REVIEW, confidence: 0.88, questionNumbers, paragraphLabels };
    }

    if (questionNumbers.length || paragraphLabels.length) {
        return { kind: intents.GROUNDED_QUESTION, confidence: 0.9, questionNumbers, paragraphLabels };
    }

    if (!query || query.length < 4) {
        return { kind: intents.CLARIFY, confidence: 0.5, questionNumbers: [], paragraphLabels: [] };
    }

    if (route === routes.IELTS_GENERAL) {
        return { kind: intents.GENERAL_CHAT, confidence: 0.72, questionNumbers: [], paragraphLabels: [] };
    }

    return { kind: intents.GROUNDED_QUESTION, confidence: 0.7, questionNumbers, paragraphLabels };
}

function resolveReadingContextRoute(payload, intent, { contextRoutes, intents }) {
    if (payload.action === 'recommend_drills' || /相似|类似|同类题|similar\s+(practice|question|passage)/i.test(payload.query)) {
        return contextRoutes.SIMILAR;
    }
    switch (intent.kind) {
    case intents.SELECTION_TOOL_REQUEST:
        return contextRoutes.SELECTION;
    case intents.REVIEW_COACH_REQUEST:
    case intents.WHOLE_SET_OR_REVIEW:
        return contextRoutes.REVIEW;
    case intents.FOLLOWUP_REQUEST:
        return contextRoutes.FOLLOWUP;
    case intents.CLARIFY:
        return contextRoutes.CLARIFY;
    default:
        return contextRoutes.TUTOR;
    }
}

export {
    classifyReadingRoute,
    classifyReadingIntent,
    resolveReadingContextRoute,
    extractQuestionRefs,
    isReviewCoachRequest,
    isPersistentReviewCoachRequest
};
