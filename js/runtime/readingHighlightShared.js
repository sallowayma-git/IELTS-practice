(function initReadingHighlightShared(global) {
    'use strict';

    const EXPLANATION_NODE_SELECTOR = [
        '.reading-explanation-card',
        '.reading-group-explanation',
        '.reading-question-explanation',
        '.reading-question-explanation-list'
    ].join(', ');

    function isHighlightNode(node) {
        return node instanceof Element && node.classList.contains('hl');
    }

    function isExplanationNode(node) {
        return node instanceof Element && node.matches(EXPLANATION_NODE_SELECTOR);
    }

    function isInsideExplanation(node) {
        let current = node instanceof Element ? node : node?.parentElement;
        while (current) {
            if (isExplanationNode(current)) {
                return true;
            }
            current = current.parentElement;
        }
        return false;
    }

    function getTextNodes(root) {
        const nodes = [];
        if (!root) {
            return nodes;
        }
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                return isInsideExplanation(node)
                    ? NodeFilter.FILTER_REJECT
                    : NodeFilter.FILTER_ACCEPT;
            }
        });
        let node = walker.nextNode();
        while (node) {
            nodes.push(node);
            node = walker.nextNode();
        }
        return nodes;
    }

    function getText(root) {
        return getTextNodes(root)
            .map((node) => node.textContent || '')
            .join('');
    }

    function normalizeComparableText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function unwrapHighlights(root) {
        if (!root) return;
        root.querySelectorAll('.hl').forEach((highlight) => {
            if (isInsideExplanation(highlight)) {
                return;
            }
            const parent = highlight.parentNode;
            if (!parent) return;
            while (highlight.firstChild) {
                parent.insertBefore(highlight.firstChild, highlight);
            }
            parent.removeChild(highlight);
            parent.normalize();
        });
    }

    function resolveRangeFromOffsets(root, start, end) {
        const nodes = getTextNodes(root);
        let offset = 0;
        let startNode = null;
        let endNode = null;
        let startOffset = 0;
        let endOffset = 0;
        for (let index = 0; index < nodes.length; index += 1) {
            const node = nodes[index];
            const text = node.textContent || '';
            const nextOffset = offset + text.length;
            if (!startNode && start >= offset && start <= nextOffset) {
                startNode = node;
                startOffset = Math.max(0, start - offset);
            }
            if (!endNode && end >= offset && end <= nextOffset) {
                endNode = node;
                endOffset = Math.max(0, end - offset);
            }
            if (startNode && endNode) {
                break;
            }
            offset = nextOffset;
        }
        if (!startNode || !endNode) {
            return null;
        }
        const range = document.createRange();
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
        return range;
    }

    function resolveHighlightKind(node) {
        if (!(node instanceof HTMLElement)) {
            return 'highlight';
        }
        return node.dataset && node.dataset.hlType === 'note' ? 'note' : 'highlight';
    }

    function applyHighlightKind(node, kind = 'highlight') {
        if (!(node instanceof HTMLElement)) {
            return;
        }
        node.classList.add('hl');
        if (kind === 'note') {
            node.dataset.hlType = 'note';
        } else {
            delete node.dataset.hlType;
        }
    }

    function snapshotHighlights(rootsByScope) {
        const records = [];
        if (!rootsByScope || typeof rootsByScope !== 'object') {
            return records;
        }
        Object.entries(rootsByScope).forEach(([scope, root]) => {
            if (!root) return;
            const seenByText = new Map();
            const cursorByText = new Map();
            const fullText = getText(root);
            Array.from(root.querySelectorAll('.hl')).forEach((node) => {
                if (isInsideExplanation(node)) return;
                const text = String(node.textContent || '').trim();
                if (!text) return;
                const key = `${scope}::${text}`;
                const seen = seenByText.get(key) || 0;
                seenByText.set(key, seen + 1);
                let cursor = cursorByText.get(key) || 0;
                let hit = -1;
                for (let index = 0; index <= seen; index += 1) {
                    hit = fullText.indexOf(text, cursor);
                    if (hit < 0) break;
                    cursor = hit + text.length;
                }
                if (hit < 0) return;
                cursorByText.set(key, cursor);
                const startOffset = hit;
                const endOffset = hit + text.length;
                const before = fullText.slice(Math.max(0, startOffset - 20), startOffset);
                const after = fullText.slice(endOffset, endOffset + 20);
                records.push({
                    scope,
                    text,
                    kind: resolveHighlightKind(node),
                    occurrence: seen,
                    start: startOffset,
                    end: endOffset,
                    startOffset,
                    endOffset,
                    before,
                    after
                });
            });
        });
        return records;
    }

    function restoreHighlightRecord(root, record) {
        if (!root || !record || !record.text) {
            return;
        }
        const fullText = getText(root);
        if (!fullText) {
            return;
        }
        const highlightKind = record.kind === 'note' ? 'note' : 'highlight';
        const normalizedRecordText = normalizeComparableText(record.text);
        const startOffset = Number(
            Object.prototype.hasOwnProperty.call(record, 'start')
                ? record.start
                : record.startOffset
        );
        const endOffset = Number(
            Object.prototype.hasOwnProperty.call(record, 'end')
                ? record.end
                : record.endOffset
        );
        const expectedBefore = normalizeComparableText(record.before);
        const expectedAfter = normalizeComparableText(record.after);
        const occurrence = Number.isFinite(Number(record.occurrence)) ? Number(record.occurrence) : 0;
        const hasOffsetSnapshot = Number.isFinite(startOffset)
            && Number.isFinite(endOffset)
            && endOffset > startOffset;

        const offsetMatchByContext = (candidateStart) => {
            const candidateEnd = candidateStart + String(record.text || '').length;
            const candidateBefore = fullText.slice(Math.max(0, candidateStart - expectedBefore.length), candidateStart);
            const candidateAfter = fullText.slice(candidateEnd, candidateEnd + expectedAfter.length);
            const normalizedBefore = normalizeComparableText(candidateBefore);
            const normalizedAfter = normalizeComparableText(candidateAfter);
            if (expectedBefore && !normalizedBefore.endsWith(expectedBefore)) {
                return false;
            }
            if (expectedAfter && !normalizedAfter.startsWith(expectedAfter)) {
                return false;
            }
            return true;
        };

        if (
            Number.isFinite(startOffset)
            && Number.isFinite(endOffset)
            && endOffset > startOffset
            && startOffset >= 0
            && endOffset <= fullText.length
        ) {
            const segment = fullText.slice(startOffset, endOffset);
            const normalizedSegment = normalizeComparableText(segment);
            const offsetLooksValid = !normalizedRecordText
                || normalizedSegment === normalizedRecordText
                || normalizedSegment.includes(normalizedRecordText)
                || normalizedRecordText.includes(normalizedSegment);
            if (offsetLooksValid) {
                const offsetRange = resolveRangeFromOffsets(root, startOffset, endOffset);
                if (offsetRange && !offsetRange.collapsed) {
                    const offsetSpan = document.createElement('span');
                    applyHighlightKind(offsetSpan, highlightKind);
                    try {
                        offsetRange.surroundContents(offsetSpan);
                        return true;
                    } catch (_) {
                        // fallback to text-based restore
                    }
                }
            }
        }
        let cursor = 0;
        let hit = -1;
        let matchedLength = String(record.text || '').length;
        for (let index = 0; index <= occurrence; index += 1) {
            hit = fullText.indexOf(record.text, cursor);
            if (hit < 0) break;
            cursor = hit + record.text.length;
        }
        if (hit < 0 && normalizedRecordText) {
            const escapedTokens = normalizedRecordText
                .split(/\s+/)
                .filter(Boolean)
                .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
            if (escapedTokens.length) {
                const pattern = new RegExp(escapedTokens.join('\\s+'), 'g');
                let matched = null;
                let index = 0;
                while ((matched = pattern.exec(fullText)) !== null) {
                    if (index === occurrence) {
                        hit = matched.index;
                        matchedLength = String(matched[0] || '').length || matchedLength;
                        break;
                    }
                    index += 1;
                    if (pattern.lastIndex === matched.index) {
                        pattern.lastIndex += 1;
                    }
                }
            }
        }
        if (hit < 0) {
            return false;
        }
        const range = resolveRangeFromOffsets(root, hit, hit + matchedLength);
        if (!range || range.collapsed) {
            return false;
        }
        const span = document.createElement('span');
        applyHighlightKind(span, highlightKind);
        try {
            range.surroundContents(span);
            return true;
        } catch (_) {
            // ignore malformed ranges
        }
        return false;
    }

    function restoreHighlights(rootsByScope, records = []) {
        if (rootsByScope && typeof rootsByScope === 'object') {
            Object.values(rootsByScope).forEach((root) => unwrapHighlights(root));
        }
        if (!Array.isArray(records) || !records.length || !rootsByScope || typeof rootsByScope !== 'object') {
            return 0;
        }
        let restoredCount = 0;
        records.forEach((record) => {
            const root = rootsByScope[record.scope];
            if (!root) return;
            if (restoreHighlightRecord(root, record)) {
                restoredCount += 1;
            }
        });
        return restoredCount;
    }

    async function preserveHighlights(rootsByScope, callback) {
        const snapshot = snapshotHighlights(rootsByScope);
        const result = callback();
        if (result && typeof result.then === 'function') {
            return result.finally(() => {
                if (snapshot.length) {
                    restoreHighlights(rootsByScope, snapshot);
                }
            });
        }
        if (snapshot.length) {
            restoreHighlights(rootsByScope, snapshot);
        }
        return result;
    }

    global.__READING_HIGHLIGHT_SHARED__ = {
        EXPLANATION_NODE_SELECTOR,
        isHighlightNode,
        isExplanationNode,
        isInsideExplanation,
        getTextNodes,
        getText,
        unwrapHighlights,
        snapshotHighlights,
        restoreHighlights,
        preserveHighlights
    };
})(typeof window !== 'undefined' ? window : globalThis);
