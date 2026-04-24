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

function formatAnswerValue(value) {
    if (Array.isArray(value)) {
        return uniqueList(value.map((item) => String(item || '').trim()).filter(Boolean)).join(' / ');
    }
    return String(value || '').trim();
}

function createTokenizer(stopwords = new Set()) {
    return function tokenize(value) {
        const text = String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ')
            .trim();
        if (!text) {
            return [];
        }
        return uniqueList(
            text
                .split(/\s+/)
                .map((token) => token.trim())
                .filter((token) => token.length >= 2 && !stopwords.has(token))
        );
    };
}

function budgetFinalChunks(contextRoute, sortedChunks, budget, { contextRoutes, chunkType }) {
    const normalizedBudget = Math.max(1, Number(budget) || 8);
    if (contextRoute === contextRoutes.SIMILAR) {
        return sortedChunks.slice(0, normalizedBudget);
    }

    const passageChunks = sortedChunks.filter((chunk) => chunk.chunkType === chunkType.PASSAGE);
    const nonPassageChunks = sortedChunks.filter((chunk) => chunk.chunkType !== chunkType.PASSAGE);
    if (!passageChunks.length) {
        return sortedChunks.slice(0, normalizedBudget);
    }

    const minPassageBudget = Math.max(1, Math.floor(normalizedBudget / 3));
    const actualPassageBudget = Math.min(minPassageBudget, passageChunks.length);
    const actualQuestionBudget = Math.max(0, normalizedBudget - actualPassageBudget);

    const merged = [];
    const seen = new Set();
    [...passageChunks.slice(0, actualPassageBudget), ...nonPassageChunks.slice(0, actualQuestionBudget)].forEach((chunk) => {
        const key = String(chunk && chunk.id ? chunk.id : '');
        if (!key || seen.has(key)) {
            return;
        }
        seen.add(key);
        merged.push(chunk);
    });
    return merged.slice(0, normalizedBudget);
}

function buildRetrievalTokens({ bundle, payload, focusQuestionNumbers = [], tokenize, chunkType }) {
    const mergedText = [
        payload?.query || '',
        payload?.selectedText || ''
    ];

    if (focusQuestionNumbers.length > 0) {
        const focusedChunks = (Array.isArray(bundle?.chunks) ? bundle.chunks : [])
            .filter((chunk) => Array.isArray(chunk?.questionNumbers) && chunk.questionNumbers.some((qNum) => focusQuestionNumbers.includes(qNum)))
            .filter((chunk) => chunk.chunkType === chunkType.QUESTION || chunk.chunkType === chunkType.EXPLANATION)
            .slice(0, 12);
        focusedChunks.forEach((chunk) => {
            mergedText.push(String(chunk?.content || '').slice(0, 360));
        });
    }

    return tokenize(mergedText.join(' '));
}

function scorePassageChunkRelevance(chunk, searchTerms = [], index = 0, tokenize) {
    const tokenSet = new Set(tokenize(chunk?.content || ''));
    const overlap = searchTerms.reduce((score, term) => score + (tokenSet.has(term) ? 1 : 0), 0);
    return overlap * 4 - Math.min(index, 12) * 0.15;
}

function pickSupplementalPassageChunks(passageChunks, payload, focusQuestionChunks = [], { tokenize, fallbackLimit }) {
    if (!Array.isArray(passageChunks) || passageChunks.length === 0) {
        return [];
    }
    const searchTerms = tokenize([
        payload?.query || '',
        payload?.selectedText || '',
        ...focusQuestionChunks.map((chunk) => String(chunk?.content || ''))
    ].join(' '));
    if (searchTerms.length === 0) {
        return passageChunks.slice(0, fallbackLimit);
    }
    return passageChunks
        .map((chunk, index) => ({
            chunk,
            score: scorePassageChunkRelevance(chunk, searchTerms, index, tokenize)
        }))
        .sort((left, right) => right.score - left.score)
        .slice(0, fallbackLimit)
        .map((entry) => entry.chunk);
}

function scoreChunk(chunk, factors, { tokenize, contextRoutes, chunkType }) {
    const queryTokens = factors.queryTokens || [];
    const focusQuestionNumbers = factors.focusQuestionNumbers || [];
    const focusParagraphLabels = factors.focusParagraphLabels || [];
    const contextRoute = factors.contextRoute;

    let score = 0;
    const contentTokens = tokenize(chunk.content || '');
    const tokenSet = new Set(contentTokens);

    queryTokens.forEach((token) => {
        if (tokenSet.has(token)) {
            score += 1.2;
        }
    });

    if (factors.selectedText && chunk.content.includes(factors.selectedText.slice(0, 30))) {
        score += 2;
    }

    if (focusQuestionNumbers.length > 0 && chunk.questionNumbers.some((qNum) => focusQuestionNumbers.includes(qNum))) {
        score += 8;
    }

    if (focusParagraphLabels.length > 0 && chunk.paragraphLabels.some((label) => focusParagraphLabels.includes(label))) {
        score += 6;
    }

    if (chunk.chunkType === chunkType.QUESTION) {
        score += 2.2;
    } else if (chunk.chunkType === chunkType.PASSAGE) {
        score += 1.6;
    } else if (chunk.chunkType === chunkType.EXPLANATION) {
        score += contextRoute === contextRoutes.REVIEW ? 2.4 : 0.8;
    } else if (chunk.chunkType === chunkType.ANSWER_KEY) {
        score += contextRoute === contextRoutes.REVIEW ? 1.8 : -0.8;
    }

    if (contextRoute === contextRoutes.SELECTION && chunk.chunkType === chunkType.PASSAGE) {
        score += 1.4;
    }

    return score;
}

function resolveContextBudget(contextRoute, contextRoutes) {
    switch (contextRoute) {
    case contextRoutes.SELECTION:
        return 8;
    case contextRoutes.REVIEW:
        return 16;
    case contextRoutes.FOLLOWUP:
        return 10;
    case contextRoutes.CLARIFY:
        return 8;
    case contextRoutes.SIMILAR:
        return 10;
    default:
        return 12;
    }
}

function resolveAllQuestionNumbers(bundle, chunkType) {
    const bundleChunks = Array.isArray(bundle?.chunks) ? bundle.chunks : [];
    return uniqueList(
        bundleChunks
            .filter((chunk) => chunk?.chunkType === chunkType.QUESTION || chunk?.chunkType === chunkType.ANSWER_KEY)
            .flatMap((chunk) => Array.isArray(chunk?.questionNumbers) ? chunk.questionNumbers : [])
            .map((item) => String(item || '').trim().replace(/^q/i, ''))
            .filter(Boolean)
    );
}

function resolveDisplayQuestionNumber(bundle, questionNumber) {
    const raw = String(questionNumber || '').trim();
    if (!raw) {
        return '';
    }

    const normalized = raw.replace(/^q/i, '');
    const displayMap = isObject(bundle?.examDataset?.questionDisplayMap)
        ? bundle.examDataset.questionDisplayMap
        : {};
    const displayValues = new Set(
        Object.values(displayMap)
            .map((value) => String(value || '').trim().replace(/^q/i, ''))
            .filter(Boolean)
    );
    if (displayValues.has(normalized)) {
        return normalized;
    }

    const internalKey = raw.toLowerCase().startsWith('q') ? raw.toLowerCase() : `q${normalized}`;
    const mapped = String(displayMap[internalKey] || '').trim().replace(/^q/i, '');
    return mapped || normalized;
}

function normalizeQuestionNumbersForBundle(bundle, questionNumbers = []) {
    return uniqueList(
        (Array.isArray(questionNumbers) ? questionNumbers : [])
            .map((item) => resolveDisplayQuestionNumber(bundle, item))
            .filter(Boolean)
    );
}

function normalizeSelectedAnswersForBundle(bundle, selectedAnswers = {}) {
    if (!isObject(selectedAnswers)) {
        return {};
    }
    return Object.entries(selectedAnswers).reduce((accumulator, [questionNumber, answer]) => {
        const displayQuestionNumber = resolveDisplayQuestionNumber(bundle, questionNumber);
        const answerText = formatAnswerValue(answer);
        if (!displayQuestionNumber || !answerText) {
            return accumulator;
        }
        accumulator[displayQuestionNumber] = answerText;
        return accumulator;
    }, {});
}

function normalizeAttemptContextForBundle(bundle, attemptContext = {}) {
    const source = isObject(attemptContext) ? attemptContext : {};
    return {
        wrongQuestions: normalizeQuestionNumbersForBundle(bundle, source.wrongQuestions || []),
        selectedAnswers: normalizeSelectedAnswersForBundle(bundle, source.selectedAnswers || {})
    };
}

function buildReviewTargets(bundle, payload, focusQuestionNumbers = [], chunkType) {
    const bundleChunks = Array.isArray(bundle?.chunks) ? bundle.chunks : [];
    const normalizedAttempt = normalizeAttemptContextForBundle(bundle, payload?.attemptContext);
    const selectedAnswers = normalizedAttempt.selectedAnswers;
    const fallbackQuestions = normalizedAttempt.wrongQuestions;
    const targetQuestionNumbers = uniqueList([
        ...normalizeQuestionNumbersForBundle(bundle, focusQuestionNumbers || []),
        ...fallbackQuestions,
        ...Object.keys(selectedAnswers),
        ...resolveAllQuestionNumbers(bundle, chunkType)
    ]).slice(0, 20);

    if (!targetQuestionNumbers.length) {
        return [];
    }

    return targetQuestionNumbers.map((questionNumber) => {
        const questionChunk = bundleChunks.find((chunk) => chunk.chunkType === chunkType.QUESTION && chunk.questionNumbers.includes(questionNumber));
        const answerKeyChunk = bundleChunks.find((chunk) => chunk.chunkType === chunkType.ANSWER_KEY && chunk.questionNumbers.includes(questionNumber));
        const explanationChunk = bundleChunks.find((chunk) => chunk.chunkType === chunkType.EXPLANATION && chunk.questionNumbers.includes(questionNumber));
        const questionStem = String(questionChunk?.content || '').trim().slice(0, 520);
        const selectedAnswer = formatAnswerValue(selectedAnswers[questionNumber]) || '未记录';
        const correctAnswerMatch = String(answerKeyChunk?.content || '').match(/正确答案[:：]\s*(.+)$/);
        const correctAnswer = String(correctAnswerMatch?.[1] || '').trim() || '未知';
        const officialExplanation = String(explanationChunk?.content || '').trim().slice(0, 900);
        return {
            questionNumber,
            questionStem,
            selectedAnswer,
            correctAnswer,
            officialExplanation
        };
    });
}

function buildReadingRetrievalContext({
    bundle,
    payload,
    contextRoute,
    intent,
    contextRoutes,
    chunkType,
    tokenize,
    passageFallbackLimit = 3
}) {
    const allChunks = Array.isArray(bundle?.chunks) ? bundle.chunks : [];
    const normalizedAttempt = normalizeAttemptContextForBundle(bundle, payload?.attemptContext);
    let focusQuestionNumbers = uniqueList([
        ...normalizeQuestionNumbersForBundle(bundle, intent.questionNumbers || []),
        ...(contextRoute === contextRoutes.REVIEW ? normalizedAttempt.wrongQuestions : []),
        ...(contextRoute === contextRoutes.REVIEW ? Object.keys(normalizedAttempt.selectedAnswers || {}) : [])
    ]);
    if (contextRoute === contextRoutes.REVIEW && focusQuestionNumbers.length === 0) {
        focusQuestionNumbers = resolveAllQuestionNumbers(bundle, chunkType);
    }
    const focusParagraphLabels = uniqueList(intent.paragraphLabels || []);
    const queryTokens = buildRetrievalTokens({
        bundle,
        payload,
        focusQuestionNumbers,
        tokenize,
        chunkType
    });

    const chunkScores = allChunks.map((chunk) => {
        const score = scoreChunk(chunk, {
            queryTokens,
            focusQuestionNumbers,
            focusParagraphLabels,
            contextRoute,
            intent,
            selectedText: payload.selectedText
        }, { tokenize, contextRoutes, chunkType });
        return { chunk, score };
    });

    chunkScores.sort((a, b) => b.score - a.score);
    const sortedChunks = chunkScores.map((item) => item.chunk);
    const focusQuestionChunks = sortedChunks.filter((chunk) => (
        chunk.chunkType === chunkType.QUESTION
        && Array.isArray(chunk.questionNumbers)
        && chunk.questionNumbers.some((qNum) => focusQuestionNumbers.includes(qNum))
    ));
    const supplementalPassageChunks = pickSupplementalPassageChunks(
        allChunks.filter((chunk) => chunk.chunkType === chunkType.PASSAGE),
        payload,
        focusQuestionChunks,
        { tokenize, fallbackLimit: passageFallbackLimit }
    );

    const deterministic = [];
    const seen = new Set();
    const pushChunk = (chunk) => {
        if (!chunk || !chunk.id || seen.has(chunk.id)) {
            return;
        }
        seen.add(chunk.id);
        deterministic.push(chunk);
    };

    if (focusQuestionNumbers.length > 0) {
        sortedChunks.forEach((chunk) => {
            if (chunk.questionNumbers.some((qNum) => focusQuestionNumbers.includes(qNum))) {
                pushChunk(chunk);
            }
        });
    }
    if (focusParagraphLabels.length > 0) {
        sortedChunks.forEach((chunk) => {
            if (chunk.paragraphLabels.some((label) => focusParagraphLabels.includes(label))) {
                pushChunk(chunk);
            }
        });
    }
    supplementalPassageChunks.forEach(pushChunk);

    sortedChunks.slice(0, 24).forEach(pushChunk);

    const budget = resolveContextBudget(contextRoute, contextRoutes);
    const finalChunks = budgetFinalChunks(contextRoute, deterministic, budget, { contextRoutes, chunkType });

    const usedQuestionNumbers = uniqueList(
        finalChunks.flatMap((chunk) => Array.isArray(chunk.questionNumbers) ? chunk.questionNumbers : [])
    );
    const usedParagraphLabels = uniqueList(
        finalChunks.flatMap((chunk) => Array.isArray(chunk.paragraphLabels) ? chunk.paragraphLabels : [])
    );

    const missingContext = [];
    if (focusQuestionNumbers.length > 0) {
        const missingQuestions = focusQuestionNumbers.filter((qNum) => !usedQuestionNumbers.includes(qNum));
        if (missingQuestions.length) {
            missingContext.push(`缺少题号上下文：Q${missingQuestions.join(', Q')}`);
        }
    }
    if (focusParagraphLabels.length > 0) {
        const missingParagraphs = focusParagraphLabels.filter((label) => !usedParagraphLabels.includes(label));
        if (missingParagraphs.length) {
            missingContext.push(`缺少段落上下文：Paragraph ${missingParagraphs.join(', ')}`);
        }
    }
    if (!finalChunks.length) {
        missingContext.push('当前请求未检索到可用证据片段');
    }

    return {
        sortedChunks,
        finalChunks,
        missingContext,
        focusQuestionNumbers,
        focusParagraphLabels,
        usedQuestionNumbers,
        usedParagraphLabels,
        reviewTargets: buildReviewTargets(bundle, payload, focusQuestionNumbers, chunkType)
    };
}

export {
    createTokenizer,
    buildReadingRetrievalContext,
    buildRetrievalTokens,
    pickSupplementalPassageChunks,
    scorePassageChunkRelevance,
    scoreChunk,
    resolveContextBudget,
    budgetFinalChunks,
    buildReviewTargets
};
