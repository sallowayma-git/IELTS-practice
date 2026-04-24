// @ts-nocheck

function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value) {
    return String(value == null ? '' : value)
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
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

function extractParagraphLabels(text) {
    const labels = [];
    const pattern = /paragraph\s*([A-H])|段落\s*([A-H])/ig;
    let match = pattern.exec(String(text || ''));
    while (match) {
        const label = String(match[1] || match[2] || '').toUpperCase();
        if (label) {
            labels.push(label);
        }
        match = pattern.exec(String(text || ''));
    }
    return uniqueList(labels);
}

function resolveQuestionNumber(questionId, questionDisplayMap = {}) {
    const normalizedQuestionId = String(questionId || '').trim();
    if (!normalizedQuestionId) {
        return '';
    }
    const displayValue = questionDisplayMap[normalizedQuestionId];
    const normalizedDisplay = String(displayValue == null ? '' : displayValue).trim().replace(/^q/i, '');
    if (normalizedDisplay) {
        return normalizedDisplay;
    }
    return normalizedQuestionId.replace(/^q/i, '');
}

function sliceHtmlContainerAroundIndex(html, index, tagName, maxLength = 2200) {
    const source = String(html || '');
    const normalizedTag = String(tagName || '').trim().toLowerCase();
    if (!source || !normalizedTag || !Number.isFinite(index) || index < 0) {
        return '';
    }
    const lower = source.toLowerCase();
    const openTag = `<${normalizedTag}`;
    const closeTag = `</${normalizedTag}>`;
    const start = lower.lastIndexOf(openTag, index);
    if (start < 0) {
        return '';
    }
    const closeStart = lower.indexOf(closeTag, index);
    if (closeStart < 0) {
        return '';
    }
    const end = closeStart + closeTag.length;
    if (end <= start || end - start > maxLength) {
        return '';
    }
    return source.slice(start, end);
}

function sliceBalancedHtmlElementAt(html, openIndex, tagName, maxLength = 4200) {
    const source = String(html || '');
    const normalizedTag = String(tagName || '').trim().toLowerCase();
    if (!source || !normalizedTag || !Number.isFinite(openIndex) || openIndex < 0) {
        return '';
    }
    const lower = source.toLowerCase();
    if (!lower.startsWith(`<${normalizedTag}`, openIndex)) {
        return '';
    }
    const tagPattern = new RegExp(`<\\/?${normalizedTag}\\b[^>]*>`, 'ig');
    tagPattern.lastIndex = openIndex;
    let depth = 0;
    let match = tagPattern.exec(source);
    while (match) {
        const tag = match[0];
        if (/^<\//.test(tag)) {
            depth -= 1;
            if (depth === 0) {
                const end = match.index + tag.length;
                if (end <= openIndex || end - openIndex > maxLength) {
                    return '';
                }
                return source.slice(openIndex, end);
            }
        } else if (!/\/>$/.test(tag)) {
            depth += 1;
        }
        match = tagPattern.exec(source);
    }
    return '';
}

function findNearestBalancedElementByClass(html, markerIndex, classNames = [], maxLength = 4200) {
    const source = String(html || '');
    if (!source || !Number.isFinite(markerIndex) || markerIndex < 0 || !classNames.length) {
        return '';
    }
    const classPattern = classNames.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const openPattern = new RegExp(`<div\\b[^>]*class=["'][^"']*(?:${classPattern})[^"']*["'][^>]*>`, 'ig');
    let candidate = null;
    let match = openPattern.exec(source);
    while (match && match.index <= markerIndex) {
        candidate = match;
        match = openPattern.exec(source);
    }
    if (!candidate) {
        return '';
    }
    const segment = sliceBalancedHtmlElementAt(source, candidate.index, 'div', maxLength);
    return segment && segment.length ? segment : '';
}

function trimQuestionParagraphSnippet(html, { questionId, displayLabel } = {}) {
    const raw = String(html || '');
    if (!raw) {
        return '';
    }
    const questionMarkers = uniqueList(
        Array.from(raw.matchAll(/(?:name|data-question|id)=["'](q\d+)/ig))
            .map((item) => String(item[1] || '').trim().toLowerCase())
            .filter(Boolean)
    );
    if (questionMarkers.length <= 1) {
        return raw;
    }
    const markerPatterns = [];
    const displayNumber = String(displayLabel || '').trim().replace(/[^0-9]/g, '');
    if (displayNumber) {
        markerPatterns.push(new RegExp(`<strong>\\s*${displayNumber}\\s*<\\/strong>`, 'i'));
    }
    const normalizedQuestionId = String(questionId || '').trim();
    if (normalizedQuestionId) {
        const escapedQuestionId = normalizedQuestionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        markerPatterns.push(new RegExp(`(?:name|data-question|id)=["']${escapedQuestionId}(?:[-_][^"']*)?["']`, 'i'));
    }

    let markerIndex = -1;
    for (const pattern of markerPatterns) {
        const match = raw.match(pattern);
        if (match && typeof match.index === 'number') {
            markerIndex = match.index;
            break;
        }
    }
    if (markerIndex < 0) {
        return raw;
    }

    const before = raw.slice(0, markerIndex);
    const after = raw.slice(markerIndex);
    const previousBreak = Math.max(
        before.lastIndexOf('.'),
        before.lastIndexOf(';'),
        before.lastIndexOf(':'),
        before.lastIndexOf('?'),
        before.lastIndexOf('!')
    );
    const nextCandidates = ['.', ';', '?', '!']
        .map((char) => {
            const index = after.indexOf(char);
            return index >= 0 ? index : Infinity;
        });
    const nextBreak = Math.min(...nextCandidates);
    const start = previousBreak >= 0 ? previousBreak + 1 : 0;
    const end = Number.isFinite(nextBreak) ? markerIndex + nextBreak + 1 : raw.length;
    return raw.slice(start, end);
}

function extractQuestionSnippetAroundMarker(html, markerIndex, { questionId, displayLabel } = {}) {
    const source = String(html || '');
    if (!source || !Number.isFinite(markerIndex) || markerIndex < 0) {
        return '';
    }

    const row = sliceHtmlContainerAroundIndex(source, markerIndex, 'tr', 2600);
    if (row) {
        return row;
    }

    const questionItem = findNearestBalancedElementByClass(
        source,
        markerIndex,
        ['question-item', 'match-question-item'],
        3600
    );
    if (questionItem) {
        return questionItem;
    }

    const paragraph = sliceHtmlContainerAroundIndex(source, markerIndex, 'p', 2600);
    if (paragraph) {
        return trimQuestionParagraphSnippet(paragraph, { questionId, displayLabel });
    }

    return '';
}

function extractGroupInstructionText(html) {
    const normalizedHtml = String(html || '');
    if (!normalizedHtml) {
        return '';
    }
    const lines = [];
    const headingMatch = normalizedHtml.match(/<h[3-5][^>]*>([\s\S]*?)<\/h[3-5]>/i);
    if (headingMatch && headingMatch[1]) {
        const heading = cleanText(headingMatch[1]);
        if (heading) {
            lines.push(heading);
        }
    }
    const paragraphPattern = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
    let match = paragraphPattern.exec(normalizedHtml);
    while (match && lines.length < 4) {
        const rawParagraph = String(match[0] || '');
        if (/<(?:input|select|textarea|span)\b[^>]*(?:name|data-question|id)=["']q\d+/i.test(rawParagraph)
            || /<strong>\s*\d{1,3}\s*<\/strong>/i.test(rawParagraph)) {
            match = paragraphPattern.exec(normalizedHtml);
            continue;
        }
        const text = cleanText(match[1] || '');
        if (/^\d{1,3}\s*[.)]\s+\S/.test(text)) {
            match = paragraphPattern.exec(normalizedHtml);
            continue;
        }
        if (text) {
            lines.push(text);
        }
        match = paragraphPattern.exec(normalizedHtml);
    }
    return uniqueList(lines).join(' | ');
}

function extractQuestionOptions(html, questionId) {
    const normalizedHtml = String(html || '');
    const normalizedQuestionId = String(questionId || '').trim();
    if (!normalizedHtml || !normalizedQuestionId) {
        return '';
    }
    const escapedQuestionId = normalizedQuestionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const options = [];
    const labelPattern = new RegExp(`<label[^>]*>[\\s\\S]{0,280}?name=["']${escapedQuestionId}["'][\\s\\S]{0,280}?<\\/label>`, 'ig');
    let labelMatch = labelPattern.exec(normalizedHtml);
    while (labelMatch) {
        const text = cleanText(labelMatch[0]);
        if (text) {
            options.push(text.replace(/\s+/g, ' ').trim());
        }
        labelMatch = labelPattern.exec(normalizedHtml);
    }
    if (options.length) {
        return `可选项：${uniqueList(options).slice(0, 8).join(' / ')}`;
    }

    const rowPattern = new RegExp(`<tr[^>]*>[\\s\\S]{0,1600}?name=["']${escapedQuestionId}["'][\\s\\S]{0,1600}?<\\/tr>`, 'i');
    const rowMatch = normalizedHtml.match(rowPattern);
    if (!rowMatch) {
        return '';
    }
    const letters = Array.from(normalizedHtml.matchAll(/<th[^>]*>\s*([A-Z])\s*<\/th>/gi))
        .map((item) => String(item[1] || '').trim().toUpperCase())
        .filter(Boolean);
    if (letters.length >= 2) {
        return `可选项：${uniqueList(letters).join(' / ')}`;
    }
    return '';
}

function extractQuestionTextFromGroupHtml({ html, questionId, questionDisplayLabel } = {}) {
    const normalizedHtml = String(html || '');
    const normalizedQuestionId = String(questionId || '').trim();
    if (!normalizedHtml || !normalizedQuestionId) {
        return '';
    }

    const escapedQuestionId = normalizedQuestionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const snippets = [];
    const pushSnippet = (snippet) => {
        const text = cleanText(snippet || '');
        if (!text) {
            return;
        }
        snippets.push(text.replace(/\s+/g, ' ').trim());
    };

    const anchorPattern = new RegExp(`id=["']${escapedQuestionId}-anchor["'][\\s\\S]{0,1200}?<p[^>]*>([\\s\\S]*?)<\\/p>`, 'i');
    const anchorMatch = normalizedHtml.match(anchorPattern);
    if (anchorMatch && anchorMatch[1]) {
        pushSnippet(anchorMatch[1]);
    }

    const markerPatterns = [
        new RegExp(`name=["']${escapedQuestionId}["']`, 'ig'),
        new RegExp(`data-question=["']${escapedQuestionId}["']`, 'ig'),
        new RegExp(`id=["']${escapedQuestionId}-anchor["']`, 'ig')
    ];
    const containerTags = ['tr', 'li', 'p'];
    markerPatterns.forEach((marker) => {
        let markerMatch = marker.exec(normalizedHtml);
        while (markerMatch) {
            const markerIndex = Number(markerMatch.index);
            const primarySnippet = extractQuestionSnippetAroundMarker(normalizedHtml, markerIndex, {
                questionId: normalizedQuestionId,
                displayLabel: questionDisplayLabel
            });
            pushSnippet(primarySnippet);
            if (!primarySnippet) {
                containerTags.forEach((tagName) => {
                    const segment = sliceHtmlContainerAroundIndex(normalizedHtml, markerIndex, tagName);
                    if (segment) {
                        pushSnippet(segment);
                    }
                });
            }
            markerMatch = marker.exec(normalizedHtml);
        }
    });

    const displayLabel = String(questionDisplayLabel || '').trim().replace(/[^0-9]/g, '');
    if (displayLabel) {
        const displayPattern = new RegExp(`<strong>\\s*${displayLabel}\\s*<\\/strong>`, 'ig');
        let displayMatch = displayPattern.exec(normalizedHtml);
        while (displayMatch) {
            pushSnippet(extractQuestionSnippetAroundMarker(normalizedHtml, displayMatch.index, {
                questionId: normalizedQuestionId,
                displayLabel
            }));
            displayMatch = displayPattern.exec(normalizedHtml);
        }
    }

    const normalizedQuestionNumber = normalizedQuestionId.replace(/^q/i, '');
    const dedupedSnippets = uniqueList(snippets).filter((text) => text.length >= 6);
    let bestSnippet = '';
    let bestScore = -Infinity;
    dedupedSnippets.forEach((text) => {
        let score = Math.min(8, text.length / 48);
        if (displayLabel && new RegExp(`\\b${displayLabel}\\b`).test(text)) {
            score += 3;
        }
        if (displayLabel && new RegExp(`^\\s*${displayLabel}\\s*[.)]\\s+`).test(text)) {
            score += 8;
        }
        if (normalizedQuestionNumber && new RegExp(`\\b${normalizedQuestionNumber}\\b`).test(text)) {
            score += 2;
        }
        if (displayLabel && new RegExp(`^\\s*(?!${displayLabel}\\b)\\d{1,3}\\s*[.)]\\s+`).test(text)) {
            score -= 8;
        }
        const displayNumbers = uniqueList(Array.from(text.matchAll(/\b(?:[1-9]|[1-3][0-9]|40)\b/g)).map((item) => item[0]));
        const otherDisplayNumbers = displayNumbers.filter((value) => value !== displayLabel && value !== normalizedQuestionNumber);
        score -= Math.min(12, otherDisplayNumbers.length * 2);
        if (text.length > 700) {
            score -= 4;
        }
        if (/which|what|how|why|是否|哪|完成|匹配|包含|同义|正确|错误/i.test(text)) {
            score += 2;
        }
        if (/q\d+/i.test(text)) {
            score -= 1.5;
        }
        if (score > bestScore) {
            bestScore = score;
            bestSnippet = text;
        }
    });

    const groupInstruction = extractGroupInstructionText(normalizedHtml);
    const optionsHint = extractQuestionOptions(normalizedHtml, normalizedQuestionId);
    const combined = uniqueList([groupInstruction, bestSnippet, optionsHint].filter(Boolean)).join(' | ');
    if (combined) {
        return combined.slice(0, 1000);
    }

    return '';
}

function extractPassageParagraphChunks(examId, passageHtml, chunkType) {
    const chunks = [];
    if (!passageHtml) {
        return chunks;
    }
    const paragraphPattern = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
    let match = paragraphPattern.exec(passageHtml);
    let index = 0;
    while (match) {
        index += 1;
        const rawParagraph = String(match[0] || '');
        const text = cleanText(rawParagraph);
        if (!text) {
            match = paragraphPattern.exec(passageHtml);
            continue;
        }
        const labelMatch = rawParagraph.match(/<strong>\s*([A-H])\s*<\/strong>/i);
        const label = labelMatch && labelMatch[1] ? String(labelMatch[1]).toUpperCase() : '';
        chunks.push({
            id: `${examId}::passage_paragraph::${label || `p${index}`}`,
            chunkType: chunkType.PASSAGE,
            questionNumbers: [],
            paragraphLabels: label ? [label] : [],
            content: text
        });
        match = paragraphPattern.exec(passageHtml);
    }

    if (chunks.length === 0) {
        const fallbackPassage = cleanText(passageHtml).slice(0, 5600);
        if (fallbackPassage) {
            chunks.push({
                id: `${examId}::passage_paragraph::fallback`,
                chunkType: chunkType.PASSAGE,
                questionNumbers: [],
                paragraphLabels: [],
                content: fallbackPassage
            });
        }
    }
    return chunks;
}

function buildQuestionChunk({ examId, questionId, questionGroups, questionDisplayMap, explanationDataset, chunkType }) {
    const normalizedQuestionId = String(questionId || '').trim();
    if (!normalizedQuestionId) {
        return null;
    }
    const normalizedQuestion = resolveQuestionNumber(normalizedQuestionId, questionDisplayMap);
    if (!normalizedQuestion) {
        return null;
    }
    let content = '';
    let questionKind = '';

    for (let index = 0; index < questionGroups.length; index += 1) {
        const group = questionGroups[index];
        const questionIds = Array.isArray(group?.questionIds) ? group.questionIds : [];
        if (!questionIds.includes(normalizedQuestionId)) {
            continue;
        }
        questionKind = String(group?.kind || '').trim();
        const html = String(group?.bodyHtml || group?.leadHtml || '');
        content = extractQuestionTextFromGroupHtml({
            html,
            questionId: normalizedQuestionId,
            questionDisplayLabel: questionDisplayMap[normalizedQuestionId]
        });
        if (content) {
            break;
        }
    }

    if (!content && explanationDataset && Array.isArray(explanationDataset.questionExplanations)) {
        const explanationItem = explanationDataset.questionExplanations
            .flatMap((section) => Array.isArray(section?.items) ? section.items : [])
            .find((item) => String(item?.questionId || '').trim() === normalizedQuestionId);
        if (explanationItem) {
            const text = cleanText(explanationItem.text || '');
            content = text.split('解析：')[0].slice(0, 320);
        }
    }

    if (!content) {
        content = `Q${normalizedQuestion}（题干未解析）`;
    }

    return {
        id: `${examId}::question_item::q${normalizedQuestion}`,
        chunkType: chunkType.QUESTION,
        questionNumbers: [normalizedQuestion],
        paragraphLabels: extractParagraphLabels(content),
        content: `Q${normalizedQuestion}${questionKind ? ` (${questionKind})` : ''}: ${content}`
    };
}

function buildReadingChunks(examId, examDataset, explanationDataset, chunkType) {
    const chunks = [];
    const questionOrder = Array.isArray(examDataset.questionOrder) ? examDataset.questionOrder : [];
    const questionDisplayMap = isObject(examDataset.questionDisplayMap) ? examDataset.questionDisplayMap : {};

    const passageHtml = Array.isArray(examDataset.passage?.blocks)
        ? examDataset.passage.blocks.map((block) => String(block?.bodyHtml || block?.html || '')).join('\n')
        : '';

    extractPassageParagraphChunks(examId, passageHtml, chunkType).forEach((chunk) => chunks.push(chunk));

    const questionGroups = Array.isArray(examDataset.questionGroups) ? examDataset.questionGroups : [];
    questionOrder.forEach((questionId) => {
        const chunk = buildQuestionChunk({
            examId,
            questionId,
            questionGroups,
            questionDisplayMap,
            explanationDataset,
            chunkType
        });
        if (chunk) {
            chunks.push(chunk);
        }
    });

    const answerKey = isObject(examDataset.answerKey) ? examDataset.answerKey : {};
    Object.entries(answerKey).forEach(([questionId, answer]) => {
        const normalizedQuestion = resolveQuestionNumber(questionId, questionDisplayMap);
        if (!normalizedQuestion) {
            return;
        }
        chunks.push({
            id: `${examId}::answer_key::q${normalizedQuestion}`,
            chunkType: chunkType.ANSWER_KEY,
            questionNumbers: [normalizedQuestion],
            paragraphLabels: [],
            content: `Q${normalizedQuestion} 正确答案：${String(answer || '').trim()}`
        });
    });

    if (explanationDataset && Array.isArray(explanationDataset.questionExplanations)) {
        explanationDataset.questionExplanations.forEach((section, sectionIndex) => {
            const sectionItems = Array.isArray(section?.items) ? section.items : [];
            sectionItems.forEach((item, itemIndex) => {
                const questionId = String(item?.questionId || '').trim();
                const questionNumber = String(item?.questionNumber || '').trim() || questionId.replace(/^q/i, '');
                const text = cleanText(item?.text || section?.text || '');
                if (!text) {
                    return;
                }
                chunks.push({
                    id: `${examId}::answer_explanation::${sectionIndex + 1}_${itemIndex + 1}`,
                    chunkType: chunkType.EXPLANATION,
                    questionNumbers: questionNumber ? [questionNumber.replace(/^q/i, '')] : [],
                    paragraphLabels: extractParagraphLabels(text),
                    content: text.slice(0, 1600)
                });
            });
        });
    }

    return chunks;
}

export {
    buildReadingChunks,
    extractQuestionTextFromGroupHtml,
    extractParagraphLabels,
    cleanText
};
