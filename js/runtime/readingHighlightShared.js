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
                records.push({
                    scope,
                    text,
                    kind: resolveHighlightKind(node),
                    occurrence: seen,
                    startOffset: hit,
                    endOffset: hit + text.length,
                    before: fullText.slice(Math.max(0, hit - 20), hit),
                    after: fullText.slice(hit + text.length, hit + text.length + 20)
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
        const normalizedRecordText = String(record.text || '').replace(/\s+/g, ' ').trim();
        const startOffset = Number(record.startOffset);
        const endOffset = Number(record.endOffset);
        if (
            Number.isFinite(startOffset)
            && Number.isFinite(endOffset)
            && endOffset > startOffset
            && startOffset >= 0
            && endOffset <= fullText.length
        ) {
            const segment = fullText.slice(startOffset, endOffset);
            const normalizedSegment = String(segment || '').replace(/\s+/g, ' ').trim();
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
                        return;
                    } catch (_) {
                        // fallback to text-based restore
                    }
                }
            }
        }
        let cursor = 0;
        let hit = -1;
        const requiredOccurrence = Number.isFinite(Number(record.occurrence)) ? Number(record.occurrence) : 0;
        for (let index = 0; index <= requiredOccurrence; index += 1) {
            hit = fullText.indexOf(record.text, cursor);
            if (hit < 0) break;
            cursor = hit + record.text.length;
        }
        if (hit < 0) {
            return;
        }
        const expectedBefore = String(record.before || '').trim();
        const expectedAfter = String(record.after || '').trim();
        if (expectedBefore && !fullText.slice(Math.max(0, hit - expectedBefore.length), hit).includes(expectedBefore)) {
            return;
        }
        if (expectedAfter && !fullText.slice(hit + record.text.length, hit + record.text.length + expectedAfter.length).includes(expectedAfter)) {
            return;
        }
        const range = resolveRangeFromOffsets(root, hit, hit + record.text.length);
        if (!range || range.collapsed) {
            return;
        }
        const span = document.createElement('span');
        applyHighlightKind(span, highlightKind);
        try {
            range.surroundContents(span);
        } catch (_) {
            // ignore malformed ranges
        }
    }

    function restoreHighlights(rootsByScope, records = []) {
        if (rootsByScope && typeof rootsByScope === 'object') {
            Object.values(rootsByScope).forEach((root) => unwrapHighlights(root));
        }
        if (!Array.isArray(records) || !records.length || !rootsByScope || typeof rootsByScope !== 'object') {
            return;
        }
        records.forEach((record) => {
            const root = rootsByScope[record.scope];
            if (!root) return;
            restoreHighlightRecord(root, record);
        });
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
