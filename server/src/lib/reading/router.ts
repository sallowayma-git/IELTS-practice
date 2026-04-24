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

    const hasPageGroundedSignals = pageGroundedHints.some((pattern) => pattern.test(normalized))
        || payload.selectedText
        || payload.focusQuestionNumbers.length > 0
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

function classifyReadingIntent(payload, route, {
    routes,
    intents,
    socialPatterns,
    wholeSetPatterns,
    questionRefPatternGlobal
}) {
    const query = payload.query;

    if (payload.action && ['translate', 'explain_selection', 'find_paraphrases', 'find_antonyms', 'extract_keywords', 'locate_evidence'].includes(payload.action) && payload.selectedText) {
        return {
            kind: intents.SELECTION_TOOL_REQUEST,
            confidence: 0.96,
            questionNumbers: payload.focusQuestionNumbers.slice(),
            paragraphLabels: []
        };
    }

    if (payload.action && ['analyze_mistake', 'review_set', 'recommend_drills'].includes(payload.action)) {
        return {
            kind: intents.REVIEW_COACH_REQUEST,
            confidence: 0.92,
            questionNumbers: payload.focusQuestionNumbers.slice(),
            paragraphLabels: []
        };
    }

    if (payload.promptKind === 'followup') {
        return {
            kind: intents.FOLLOWUP_REQUEST,
            confidence: 0.8,
            questionNumbers: payload.focusQuestionNumbers.slice(),
            paragraphLabels: []
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

    const extracted = extractQuestionRefs(query, questionRefPatternGlobal);
    const questionNumbers = uniqueList([...payload.focusQuestionNumbers, ...extracted.questionNumbers]);
    const paragraphLabels = extracted.paragraphLabels;

    if (wholeSetPatterns.some((pattern) => pattern.test(query))) {
        return { kind: intents.WHOLE_SET_OR_REVIEW, confidence: 0.88, questionNumbers, paragraphLabels };
    }

    if (payload.attemptContext.submitted && (payload.attemptContext.wrongQuestions.length > 0 || /错题|复盘|review|mistake/i.test(query))) {
        return { kind: intents.WHOLE_SET_OR_REVIEW, confidence: 0.82, questionNumbers, paragraphLabels };
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
    extractQuestionRefs
};
