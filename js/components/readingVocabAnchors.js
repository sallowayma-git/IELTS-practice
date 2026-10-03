(function (global) {
    'use strict';

    const SCOPE = '[data-vocab-scope]';
    const EXCLUDED = 'script,style,noscript,template,button,input,textarea,select,option,' +
        '[role="button"]:not(.vocab-highlight):not(.hl),[contenteditable]:not([contenteditable="false"]),' +
        '.vocab-translation-card,.vocab-paragraph-tag,.vocab-answer-blank';
    const HIGHLIGHT = '.vocab-highlight,.hl';
    const BLOCK = 'p,div,li,td,th,blockquote,pre,h1,h2,h3,h4,h5,h6,section,article';
    const CONTEXT_LENGTH = 48;

    function hidden(element) {
        if (element.hidden || element.getAttribute('aria-hidden') === 'true') return true;
        const style = element.ownerDocument.defaultView.getComputedStyle(element);
        return style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse';
    }

    function excluded(element, root) {
        for (let current = element; current; current = current.parentElement) {
            if (current.matches(EXCLUDED) || hidden(current)) return true;
            if (current === root) break;
        }
        return false;
    }

    // Highlight wrappers contribute their original text. This keeps offsets and
    // content versions stable while other occurrences are painted or removed.
    function textNodes(root) {
        if (!root || !root.ownerDocument) return [];
        const nodes = [];
        const walker = root.ownerDocument.createTreeWalker(root, 4);
        let node;
        while ((node = walker.nextNode())) {
            if (node.parentElement && !excluded(node.parentElement, root)) nodes.push(node);
        }
        return nodes;
    }

    function text(root) {
        return textNodes(root).map(node => node.nodeValue || '').join('');
    }

    function textVersion(value) {
        let first = 0x811c9dc5;
        let second = 0x9e3779b9;
        for (let index = 0; index < value.length; index += 1) {
            const code = value.charCodeAt(index);
            first = Math.imul(first ^ code, 0x01000193);
            second = Math.imul(second ^ code, 0x85ebca6b);
        }
        return `reader-text-v1:${value.length}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
    }

    function versionForText(root, value) {
        const sourceVersion = root.getAttribute('data-vocab-source-version');
        const scopeVersion = textVersion(value);
        return sourceVersion ? `reader-scope-v2:${sourceVersion}:${scopeVersion}` : scopeVersion;
    }

    function version(root) { return versionForText(root, text(root)); }

    function comparePoints(doc, leftNode, leftOffset, rightNode, rightOffset) {
        const left = doc.createRange();
        const right = doc.createRange();
        left.setStart(leftNode, leftOffset);
        left.collapse(true);
        right.setStart(rightNode, rightOffset);
        right.collapse(true);
        return left.compareBoundaryPoints(0, right);
    }

    function offsetAtPoint(root, nodes, container, offset) {
        if (container !== root && !root.contains(container)) return null;
        let position = 0;
        for (const node of nodes) {
            const length = (node.nodeValue || '').length;
            if (container === node) return position + offset;
            if (comparePoints(root.ownerDocument, container, offset, node, 0) <= 0) return position;
            if (comparePoints(root.ownerDocument, container, offset, node, length) < 0) return null;
            position += length;
        }
        return position;
    }

    function resolveOffsets(root, start, end) {
        if (!root || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) return null;
        const nodes = textNodes(root);
        let position = 0;
        let startNode;
        let startInNode;
        for (const node of nodes) {
            const next = position + (node.nodeValue || '').length;
            if (!startNode && start >= position && start < next) {
                startNode = node;
                startInNode = start - position;
            }
            if (startNode && end > position && end <= next) {
                const range = root.ownerDocument.createRange();
                range.setStart(startNode, startInNode);
                range.setEnd(node, end - position);
                return range;
            }
            position = next;
        }
        return null;
    }

    function calculateLocation(root, range) {
        if (!root || !range || range.collapsed) return null;
        try {
            const nodes = textNodes(root);
            const fullText = nodes.map(node => node.nodeValue || '').join('');
            const startOffset = offsetAtPoint(root, nodes, range.startContainer, range.startOffset);
            const endOffset = offsetAtPoint(root, nodes, range.endContainer, range.endOffset);
            if (startOffset === null || endOffset === null || endOffset <= startOffset) return null;
            const quote = fullText.slice(startOffset, endOffset);
            return {
                startOffset, endOffset, quote, text: quote,
                before: fullText.slice(Math.max(0, startOffset - CONTEXT_LENGTH), startOffset),
                after: fullText.slice(endOffset, endOffset + CONTEXT_LENGTH),
                contentVersion: versionForText(root, fullText),
                context: fullText.slice(Math.max(0, startOffset - CONTEXT_LENGTH), endOffset + CONTEXT_LENGTH)
            };
        } catch (_) { return null; }
    }

    function overlaps(range, node) {
        const other = node.ownerDocument.createRange();
        other.selectNode(node);
        const doc = node.ownerDocument;
        return comparePoints(doc, range.startContainer, range.startOffset, other.endContainer, other.endOffset) < 0 &&
            comparePoints(doc, range.endContainer, range.endOffset, other.startContainer, other.startOffset) > 0;
    }

    function validRange(scope, range, allowHighlights = false) {
        if (!range || range.collapsed || excluded(scope, scope)) return false;
        if ((range.startContainer !== scope && !scope.contains(range.startContainer)) ||
            (range.endContainer !== scope && !scope.contains(range.endContainer))) return false;
        for (const element of scope.querySelectorAll('*')) {
            if ((element.matches(EXCLUDED + ',br,hr') || (!allowHighlights && element.matches(HIGHLIGHT)) || hidden(element)) && overlaps(range, element)) return false;
        }
        let selectedBlock = null;
        for (const node of textNodes(scope)) {
            const doc = node.ownerDocument;
            const selected = comparePoints(doc, range.startContainer, range.startOffset, node, node.length) < 0 &&
                comparePoints(doc, range.endContainer, range.endOffset, node, 0) > 0;
            if (!selected) continue;
            if (node.parentElement.closest(SCOPE) !== scope || (!allowHighlights && node.parentElement.closest(HIGHLIGHT))) return false;
            const block = node.parentElement.closest(BLOCK);
            const boundary = block && scope.contains(block) ? block : scope;
            if (selectedBlock && selectedBlock !== boundary) return false;
            selectedBlock = boundary;
        }
        return selectedBlock !== null;
    }

    function cleanWord(value) {
        return value.replace(/^[\s"'“”‘’(（[<{《/\\#]+|[\s"'“”‘’）)\]>}》,.:;!?！？，。；：/\\#]+$/g, '').trim();
    }

    function capture(scope, range) {
        if (!scope || !scope.matches(SCOPE)) return null;
        try {
            if (!validRange(scope, range)) return null;
            const rawText = range.toString();
            if (/[\r\n]/.test(rawText)) return null;
            const word = cleanWord(rawText);
            if (!word || word.length > 45 || !/[A-Za-z]/.test(word)) return null;
            const rawLocation = calculateLocation(scope, range);
            if (!rawLocation || rawLocation.quote !== rawText) return null;
            const startOffset = rawLocation.startOffset + rawText.indexOf(word);
            const trimmed = resolveOffsets(scope, startOffset, startOffset + word.length);
            if (!trimmed || !validRange(scope, trimmed)) return null;
            const scopeId = scope.getAttribute('data-vocab-scope');
            if (!scopeId) return null;
            const location = calculateLocation(scope, trimmed);
            if (scope.getAttribute('data-vocab-source-version')) {
                const sourceRoot = scope.closest('[data-vocab-source-root]');
                const unique = sourceRoot && contextCandidates(sourceRoot, scope, location).length === 1;
                location.contentVersion += unique ? '|context-unique' : '|context-scoped';
            }
            return { ...location, range: trimmed, word, scopeId, scope: scopeId };
        } catch (_) { return null; }
    }

    function findScope(root, scopeId) {
        if (!root || !scopeId) return null;
        const matches = [];
        if (root.matches && root.matches(SCOPE) && root.getAttribute('data-vocab-scope') === scopeId) matches.push(root);
        for (const scope of root.querySelectorAll(SCOPE)) {
            if (scope.getAttribute('data-vocab-scope') === scopeId) matches.push(scope);
        }
        return matches.length === 1 ? matches[0] : null;
    }

    function areaScopes(root, originalScope) {
        const scopeId = originalScope.getAttribute('data-vocab-scope');
        const area = /^(passage|questions)\//.exec(scopeId);
        if (!area) return [originalScope];
        const candidates = root.matches && root.matches(SCOPE) ? [root] : [];
        candidates.push(...root.querySelectorAll(SCOPE));
        return candidates.filter(scope => scope.getAttribute('data-vocab-scope').startsWith(area[0]));
    }

    function contextCandidates(root, originalScope, highlight) {
        if (typeof highlight.before !== 'string' || typeof highlight.after !== 'string') return [];
        const quote = typeof highlight.quote === 'string' ? highlight.quote : highlight.text;
        const candidates = [];
        for (const scope of areaScopes(root, originalScope)) {
            const fullText = text(scope);
            let position = fullText.indexOf(quote);
            while (position !== -1) {
                const end = position + quote.length;
                const beforeMatches = highlight.before ?
                    position >= highlight.before.length && fullText.slice(position - highlight.before.length, position) === highlight.before : position === 0;
                const afterMatches = highlight.after ?
                    fullText.slice(end, end + highlight.after.length) === highlight.after : end === fullText.length;
                if (beforeMatches && afterMatches) {
                    const range = resolveOffsets(scope, position, end);
                    // Existing paint cannot turn an ambiguous textual anchor into
                    // a unique one. Ignore paint only while counting candidates.
                    if (range && range.toString() === quote && validRange(scope, range, true)) candidates.push({ scope, range });
                }
                if (candidates.length > 1) return candidates;
                position = fullText.indexOf(quote, position + 1);
            }
        }
        return candidates;
    }

    function resolve(root, highlight) {
        if (!highlight) return null;
        try {
            const scope = findScope(root, highlight.scopeId || highlight.scope);
            const quote = typeof highlight.quote === 'string' ? highlight.quote : highlight.text;
            if (!scope || typeof quote !== 'string' || !quote || quote.length > 45 || /[\r\n]/.test(quote) || !/[A-Za-z]/.test(quote)) return null;
            const fullText = text(scope);
            const storedVersion = String(highlight.contentVersion || '');
            const contextFlag = /\|context-(unique|scoped)$/.exec(storedVersion);
            const baseVersion = contextFlag ? storedVersion.slice(0, contextFlag.index) : storedVersion;
            if (baseVersion === versionForText(scope, fullText)) {
                const start = highlight.startOffset;
                const end = highlight.endOffset;
                if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || fullText.slice(start, end) !== quote) return null;
                const range = resolveOffsets(scope, start, end);
                return range && range.toString() === quote && validRange(scope, range) ? range : null;
            }
            // A source edit can shift an ordinal onto an identical paragraph.
            // Current uniqueness alone is insufficient if the original source
            // contained duplicates: removing the selected copy leaves a false
            // unique survivor. Source-aware capture records that distinction.
            const sourceAware = scope.getAttribute('data-vocab-source-version') || baseVersion.startsWith('reader-scope-v2:');
            if (sourceAware && (!contextFlag || contextFlag[1] !== 'unique')) return null;
            const candidates = contextCandidates(root, scope, highlight);
            if (candidates.length !== 1) return null;
            const candidate = candidates[0];
            return validRange(candidate.scope, candidate.range) ? candidate.range : null;
        } catch (_) { return null; }
    }

    global.ReadingVocabAnchors = Object.freeze({ textNodes, text, version, hashText: textVersion, resolveOffsets, calculateLocation, capture, resolve });
})(typeof window !== 'undefined' ? window : globalThis);
