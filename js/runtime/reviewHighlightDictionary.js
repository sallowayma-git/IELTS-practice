(function initReviewHighlightDictionary(global) {
    'use strict';

    const STYLE_ID = 'review-highlight-dictionary-style';
    const BUBBLE_ID = 'review-highlight-dictionary-bubble';
    const INTERACTIVE_CLASS = 'review-dictionary-highlight';
    const VOCAB_MESSAGE_TYPE = 'VOCAB_HIGHLIGHT_SAVE';
    const FALLBACK_STORAGE_KEY = 'exam_system_vocab_list_reading_highlights';
    const MAX_STORED_HIGHLIGHT_WORDS = 5000;
    const MAX_WORD_TEXT_LENGTH = 160;
    const MAX_MEANING_TEXT_LENGTH = 4000;
    const MAX_SOURCE_TEXT_LENGTH = 200;
    const MAX_EXTRA_TEXT_LENGTH = 1000;
    const MAX_TAGS = 20;
    const MAX_CONTEXT_JSON_CHARS = 8000;
    const MAX_CONTEXT_DEPTH = 6;
    const MAX_CONTEXT_OBJECT_KEYS = 50;
    const MAX_CONTEXT_ARRAY_ITEMS = 50;
    const MAX_FALLBACK_STORAGE_STRING_LENGTH = 5 * 1024 * 1024;
    const CONTEXT_POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
    const FALLBACK_STORAGE_POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

    let currentOptions = {};
    let activeHighlight = null;
    let activeLookup = null;
    let outsideHandlerAttached = false;

    function summarizeReviewDictionaryErrorForLog(error) {
        if (!error || typeof error !== 'object') {
            return { name: typeof error };
        }
        const status = Number(error.status);
        return {
            name: typeof error.name === 'string' && error.name ? error.name.slice(0, 80) : 'Error',
            status: Number.isFinite(status) ? status : undefined
        };
    }

    function cleanText(value, maxLength = MAX_EXTRA_TEXT_LENGTH) {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (text.length <= maxLength) {
            return text;
        }
        const truncated = text.slice(0, maxLength);
        return /[\uD800-\uDBFF]$/.test(truncated)
            ? truncated.slice(0, -1)
            : truncated;
    }

    function hashText(value) {
        const text = String(value || '');
        let hash = 0;
        for (let index = 0; index < text.length; index += 1) {
            hash = ((hash << 5) - hash) + text.charCodeAt(index);
            hash |= 0;
        }
        return Math.abs(hash).toString(36);
    }

    function buildHighlightId(word) {
        const slug = cleanText(word, MAX_WORD_TEXT_LENGTH)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 80);
        return `reading-highlight-${slug || 'term'}-${hashText(word)}`;
    }

    function normalizeTags(tags) {
        return Array.isArray(tags)
            ? tags.slice(0, MAX_TAGS).map((tag) => cleanText(tag, MAX_SOURCE_TEXT_LENGTH)).filter(Boolean)
            : [];
    }

    function estimateContextJsonChars(value, depth = 0, seen = new WeakSet()) {
        if (value == null) {
            return 4;
        }
        if (typeof value === 'string') {
            return value.length + 2;
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value).length;
        }
        if (typeof value !== 'object' || depth >= MAX_CONTEXT_DEPTH || seen.has(value)) {
            return 0;
        }
        seen.add(value);
        try {
            if (Array.isArray(value)) {
                let size = 2;
                value.slice(0, MAX_CONTEXT_ARRAY_ITEMS).forEach((item, index) => {
                    size += (index > 0 ? 1 : 0) + estimateContextJsonChars(item, depth + 1, seen);
                });
                return size;
            }
            let size = 2;
            Object.keys(value).slice(0, MAX_CONTEXT_OBJECT_KEYS).forEach((key, index) => {
                size += (index > 0 ? 1 : 0) + String(key).length + 3 + estimateContextJsonChars(value[key], depth + 1, seen);
            });
            return size;
        } catch (_) {
            return MAX_CONTEXT_JSON_CHARS + 1;
        } finally {
            seen.delete(value);
        }
    }

    function normalizeContextValue(value, depth = 0, seen = new WeakSet()) {
        if (typeof value === 'string') {
            return cleanText(value, MAX_EXTRA_TEXT_LENGTH);
        }
        if (typeof value === 'number') {
            return Number.isFinite(value) ? value : null;
        }
        if (value == null || typeof value === 'boolean') {
            return value;
        }
        if (Array.isArray(value)) {
            if (depth >= MAX_CONTEXT_DEPTH || seen.has(value)) {
                return null;
            }
            seen.add(value);
            try {
                return value
                    .slice(0, MAX_CONTEXT_ARRAY_ITEMS)
                    .map((item) => normalizeContextValue(item, depth + 1, seen))
                    .filter((item) => item !== null && item !== undefined);
            } finally {
                seen.delete(value);
            }
        }
        if (value && typeof value === 'object') {
            if (depth >= MAX_CONTEXT_DEPTH || seen.has(value)) {
                return null;
            }
            if (estimateContextJsonChars(value, depth) > MAX_CONTEXT_JSON_CHARS) {
                return null;
            }
            seen.add(value);
            const clone = {};
            Object.keys(value)
                .slice(0, MAX_CONTEXT_OBJECT_KEYS)
                .forEach((key) => {
                    const safeKey = cleanText(key, MAX_SOURCE_TEXT_LENGTH);
                    if (!safeKey || CONTEXT_POLLUTION_KEYS.has(safeKey)) {
                        return;
                    }
                    const normalized = normalizeContextValue(value[key], depth + 1, seen);
                    if (normalized !== null && normalized !== undefined) {
                        clone[safeKey] = normalized;
                    }
                });
            try {
                return JSON.stringify(clone).length <= MAX_CONTEXT_JSON_CHARS ? clone : null;
            } catch (_) {
                return null;
            } finally {
                seen.delete(value);
            }
        }
        return null;
    }

    function isPlainObject(value) {
        return value && Object.prototype.toString.call(value) === '[object Object]';
    }

    function isUnsafeStorageKey(key) {
        return FALLBACK_STORAGE_POLLUTION_KEYS.has(String(key));
    }

    function cleanNumber(value, fallback = null) {
        const numeric = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(numeric) ? numeric : fallback;
    }

    function cleanDateLike(value, fallback = '') {
        const text = cleanText(value, MAX_SOURCE_TEXT_LENGTH);
        return text || fallback;
    }

    function sanitizeFallbackWordEntry(entry) {
        if (!isPlainObject(entry)) {
            return null;
        }
        if (Object.keys(entry).some((key) => isUnsafeStorageKey(key))) {
            entry = Object.keys(entry).reduce((safe, key) => {
                if (!isUnsafeStorageKey(key)) {
                    safe[key] = entry[key];
                }
                return safe;
            }, {});
        }
        const word = cleanText(entry.word, MAX_WORD_TEXT_LENGTH);
        if (!word) {
            return null;
        }
        return {
            id: cleanText(entry.id, MAX_SOURCE_TEXT_LENGTH) || buildHighlightId(word),
            word,
            meaning: cleanText(entry.meaning, MAX_MEANING_TEXT_LENGTH),
            example: cleanText(entry.example, MAX_MEANING_TEXT_LENGTH),
            note: cleanText(entry.note, MAX_MEANING_TEXT_LENGTH),
            timestamp: cleanNumber(entry.timestamp, Date.now()),
            source: cleanText(entry.source || 'reading-highlight', MAX_SOURCE_TEXT_LENGTH),
            easeFactor: cleanNumber(entry.easeFactor, null),
            interval: cleanNumber(entry.interval, 1),
            repetitions: cleanNumber(entry.repetitions, 0),
            intraCycles: cleanNumber(entry.intraCycles, 0),
            correctCount: cleanNumber(entry.correctCount, 0),
            lastReviewed: entry.lastReviewed == null ? null : cleanDateLike(entry.lastReviewed),
            nextReview: entry.nextReview == null ? null : cleanDateLike(entry.nextReview),
            createdAt: cleanDateLike(entry.createdAt),
            updatedAt: cleanDateLike(entry.updatedAt)
        };
    }

    function sanitizeFallbackList(rawList) {
        if (!isPlainObject(rawList)) {
            return null;
        }
        const now = new Date().toISOString();
        const words = Array.isArray(rawList.words)
            ? rawList.words
                .map((entry) => sanitizeFallbackWordEntry(entry))
                .filter(Boolean)
                .slice(-MAX_STORED_HIGHLIGHT_WORDS)
            : [];
        return {
            id: cleanText(rawList.id, MAX_SOURCE_TEXT_LENGTH) || 'reading-highlights',
            name: cleanText(rawList.name, MAX_SOURCE_TEXT_LENGTH) || '闃呰楂樹寒鐢熻瘝',
            icon: cleanText(rawList.icon, MAX_SOURCE_TEXT_LENGTH) || '馃摉',
            source: cleanText(rawList.source || 'reading-highlight', MAX_SOURCE_TEXT_LENGTH),
            words,
            createdAt: cleanDateLike(rawList.createdAt, now),
            updatedAt: cleanDateLike(rawList.updatedAt, now)
        };
    }

    function getMessageTargetOrigin() {
        const origin = global.location && global.location.origin;
        return origin && origin !== 'null' && /^https?:\/\//i.test(origin) ? origin : '*';
    }

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .${INTERACTIVE_CLASS} {
                cursor: pointer;
                text-decoration: underline;
                text-decoration-thickness: 1px;
                text-decoration-style: dotted;
                text-underline-offset: 3px;
            }
            .${INTERACTIVE_CLASS}:focus {
                outline: 2px solid rgba(37, 99, 235, 0.75);
                outline-offset: 2px;
            }
            #${BUBBLE_ID} {
                position: fixed;
                z-index: 2147483640;
                width: min(340px, calc(100vw - 24px));
                max-height: min(420px, calc(100vh - 24px));
                overflow: auto;
                border: 1px solid rgba(148, 163, 184, 0.45);
                border-radius: 8px;
                background: #ffffff;
                color: #0f172a;
                box-shadow: 0 18px 48px rgba(15, 23, 42, 0.22);
                padding: 12px;
                font-size: 13px;
                line-height: 1.45;
            }
            body.dark-mode #${BUBBLE_ID} {
                background: #111827;
                color: #e5e7eb;
                border-color: rgba(148, 163, 184, 0.35);
                box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
            }
            #${BUBBLE_ID} .vocab-bubble-head {
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: 10px;
                margin-bottom: 8px;
            }
            #${BUBBLE_ID} .vocab-term {
                margin: 0;
                font-size: 16px;
                font-weight: 700;
                overflow-wrap: anywhere;
            }
            #${BUBBLE_ID} .vocab-meta {
                color: #64748b;
                font-size: 12px;
                margin-top: 2px;
                overflow-wrap: anywhere;
            }
            body.dark-mode #${BUBBLE_ID} .vocab-meta {
                color: #94a3b8;
            }
            #${BUBBLE_ID} .vocab-close {
                width: 28px;
                height: 28px;
                border: 1px solid rgba(148, 163, 184, 0.55);
                border-radius: 6px;
                background: transparent;
                color: inherit;
                cursor: pointer;
                font-size: 18px;
                line-height: 1;
            }
            #${BUBBLE_ID} .vocab-section {
                margin-top: 8px;
            }
            #${BUBBLE_ID} .vocab-label {
                color: #64748b;
                font-size: 12px;
                font-weight: 700;
                margin-bottom: 2px;
            }
            body.dark-mode #${BUBBLE_ID} .vocab-label {
                color: #94a3b8;
            }
            #${BUBBLE_ID} .vocab-text {
                overflow-wrap: anywhere;
                white-space: pre-wrap;
            }
            #${BUBBLE_ID} .vocab-part {
                border-top: 1px solid rgba(148, 163, 184, 0.25);
                padding-top: 7px;
                margin-top: 7px;
            }
            #${BUBBLE_ID} .vocab-actions {
                display: flex;
                justify-content: flex-end;
                gap: 8px;
                margin-top: 12px;
            }
            #${BUBBLE_ID} .vocab-add {
                border: 1px solid rgba(37, 99, 235, 0.85);
                border-radius: 6px;
                background: #2563eb;
                color: #ffffff;
                cursor: pointer;
                font-size: 13px;
                font-weight: 700;
                padding: 6px 10px;
            }
            #${BUBBLE_ID} .vocab-add:disabled {
                cursor: default;
                opacity: 0.75;
            }
        `;
        document.head.appendChild(style);
    }

    function isEnabled() {
        return !currentOptions || typeof currentOptions.isEnabled !== 'function'
            ? true
            : currentOptions.isEnabled() === true;
    }

    function getRoots() {
        const roots = currentOptions && currentOptions.roots && typeof currentOptions.roots === 'object'
            ? currentOptions.roots
            : {};
        return Object.values(roots).filter((node) => node && node.nodeType === Node.ELEMENT_NODE);
    }

    function isManagedHighlight(node) {
        if (!node || !(node instanceof HTMLElement) || !node.matches('.hl')) {
            return false;
        }
        const roots = getRoots();
        return roots.some((root) => root.contains(node));
    }

    function getHighlightFromEvent(event) {
        const target = event && event.target instanceof HTMLElement
            ? event.target.closest('.hl')
            : null;
        return isManagedHighlight(target) ? target : null;
    }

    function getLookupService() {
        return currentOptions.lookupService || global.DictionaryService || null;
    }

    function lookupTerm(term) {
        const service = getLookupService();
        if (!service || typeof service.lookup !== 'function') {
            return {
                found: false,
                requested: cleanText(term),
                term: cleanText(term),
                reason: 'dictionary_unavailable'
            };
        }
        try {
            if (typeof service.init === 'function') {
                service.init();
            }
            return service.lookup(term);
        } catch (error) {
            console.warn('[ReviewHighlightDictionary] lookup failed:', summarizeReviewDictionaryErrorForLog(error));
            return {
                found: false,
                requested: cleanText(term),
                term: cleanText(term),
                reason: 'lookup_error'
            };
        }
    }

    function ensureBubble() {
        ensureStyle();
        let bubble = document.getElementById(BUBBLE_ID);
        if (bubble) {
            return bubble;
        }
        bubble = document.createElement('div');
        bubble.id = BUBBLE_ID;
        bubble.setAttribute('role', 'dialog');
        bubble.setAttribute('aria-live', 'polite');
        bubble.style.display = 'none';
        document.body.appendChild(bubble);
        bubble.addEventListener('click', (event) => {
            const closeButton = event.target instanceof HTMLElement
                ? event.target.closest('[data-vocab-close]')
                : null;
            if (closeButton) {
                closeBubble();
                return;
            }
            const addButton = event.target instanceof HTMLElement
                ? event.target.closest('[data-vocab-add]')
                : null;
            if (addButton) {
                saveActiveLookup(addButton);
            }
        });
        return bubble;
    }

    function appendTextElement(parent, tagName, className, text) {
        const element = document.createElement(tagName);
        if (className) {
            element.className = className;
        }
        element.textContent = String(text || '');
        parent.appendChild(element);
        return element;
    }

    function appendSection(parent, label, text) {
        if (!text) {
            return null;
        }
        const section = document.createElement('div');
        section.className = 'vocab-section';
        appendTextElement(section, 'div', 'vocab-label', label);
        appendTextElement(section, 'div', 'vocab-text', text);
        parent.appendChild(section);
        return section;
    }

    function appendPart(parent, part) {
        if (!part) {
            return;
        }
        const meta = [part.phonetic ? `/${part.phonetic}/` : '', part.pos || '', part.sourceLabel || '']
            .filter(Boolean)
            .join(' · ');
        const node = document.createElement('div');
        node.className = 'vocab-part';
        appendTextElement(node, 'div', 'vocab-term', part.term || part.lemma || part.requested);
        if (meta) {
            appendTextElement(node, 'div', 'vocab-meta', meta);
        }
        appendSection(node, '中文释义', part.zh);
        appendSection(node, '英文释义', part.en);
        parent.appendChild(node);
    }

    function renderLookup(lookup) {
        const found = lookup && lookup.found;
        const term = cleanText((lookup && (lookup.term || lookup.requested)) || '');
        const meta = found && !Array.isArray(lookup.parts)
            ? [lookup.phonetic ? `/${lookup.phonetic}/` : '', lookup.pos || '', lookup.sourceLabel || '本地词典']
                .filter(Boolean)
                .join(' · ')
            : '';
        const sourceLine = found && lookup.sourceLabel
            ? `${lookup.sourceLabel}${lookup.license ? ` · ${lookup.license}` : ''}`
            : '';

        const fragment = document.createDocumentFragment();
        const head = document.createElement('div');
        head.className = 'vocab-bubble-head';
        const headingWrap = document.createElement('div');
        appendTextElement(headingWrap, 'h4', 'vocab-term', term || (lookup && lookup.requested) || '高亮词');
        if (meta) {
            appendTextElement(headingWrap, 'div', 'vocab-meta', meta);
        }
        head.appendChild(headingWrap);

        const closeButton = document.createElement('button');
        closeButton.className = 'vocab-close';
        closeButton.type = 'button';
        closeButton.dataset.vocabClose = '';
        closeButton.setAttribute('aria-label', '关闭');
        closeButton.textContent = '×';
        head.appendChild(closeButton);
        fragment.appendChild(head);

        if (!found) {
            appendSection(fragment, '本地词典', '未收录该高亮内容。可先加入阅读高亮生词，后续手动补充释义。');
        } else if (Array.isArray(lookup.parts) && lookup.parts.length) {
            lookup.parts.forEach((part) => appendPart(fragment, part));
        } else {
            appendSection(fragment, '中文释义', lookup.zh);
            appendSection(fragment, '英文释义', lookup.en);
            appendSection(fragment, '例句', lookup.example);
            appendSection(fragment, '来源', sourceLine);
        }

        const actions = document.createElement('div');
        actions.className = 'vocab-actions';
        const addButton = document.createElement('button');
        addButton.className = 'vocab-add';
        addButton.type = 'button';
        addButton.dataset.vocabAdd = '';
        addButton.textContent = '加入生词本';
        actions.appendChild(addButton);
        fragment.appendChild(actions);
        return fragment;
    }

    function positionBubble(bubble, highlight) {
        const rect = highlight.getBoundingClientRect();
        bubble.style.display = 'block';
        bubble.style.left = '0px';
        bubble.style.top = '0px';
        const margin = 12;
        const bubbleRect = bubble.getBoundingClientRect();
        let left = rect.left + (rect.width / 2) - (bubbleRect.width / 2);
        left = Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - bubbleRect.width - margin));
        let top = rect.bottom + 8;
        if (top + bubbleRect.height + margin > window.innerHeight) {
            top = rect.top - bubbleRect.height - 8;
        }
        top = Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - bubbleRect.height - margin));
        bubble.style.left = `${Math.round(left)}px`;
        bubble.style.top = `${Math.round(top)}px`;
    }

    function openBubble(highlight) {
        if (!isEnabled() || !highlight) {
            return;
        }
        const term = cleanText(highlight.textContent);
        if (!term) {
            return;
        }
        activeHighlight = highlight;
        activeLookup = lookupTerm(term);
        const bubble = ensureBubble();
        bubble.replaceChildren(renderLookup(activeLookup));
        positionBubble(bubble, highlight);
        if (!outsideHandlerAttached) {
            outsideHandlerAttached = true;
            document.addEventListener('click', handleOutsideClick, true);
            document.addEventListener('keydown', handleDocumentKeydown, true);
            window.addEventListener('resize', closeBubble);
            window.addEventListener('scroll', closeBubble, true);
        }
    }

    function closeBubble() {
        const bubble = document.getElementById(BUBBLE_ID);
        if (bubble) {
            bubble.style.display = 'none';
            bubble.replaceChildren();
        }
        activeHighlight = null;
        activeLookup = null;
    }

    function handleOutsideClick(event) {
        const bubble = document.getElementById(BUBBLE_ID);
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (!bubble || bubble.style.display === 'none' || !target) {
            return;
        }
        if (bubble.contains(target) || target.closest(`.${INTERACTIVE_CLASS}`)) {
            return;
        }
        closeBubble();
    }

    function handleDocumentKeydown(event) {
        if (event.key === 'Escape') {
            closeBubble();
            return;
        }
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }
        const highlight = getHighlightFromEvent(event);
        if (highlight) {
            event.preventDefault();
            openBubble(highlight);
        }
    }

    function buildVocabPayload() {
        const lookup = activeLookup || {};
        const context = currentOptions && typeof currentOptions.getContext === 'function'
            ? currentOptions.getContext()
            : {};
        const selectedText = cleanText(activeHighlight && activeHighlight.textContent, MAX_WORD_TEXT_LENGTH);
        return {
            word: cleanText(lookup.term || lookup.lemma || selectedText, MAX_WORD_TEXT_LENGTH),
            selectedText,
            meaning: cleanText(lookup.zh || '', MAX_MEANING_TEXT_LENGTH),
            definition: cleanText(lookup.en || '', MAX_MEANING_TEXT_LENGTH),
            phonetic: cleanText(lookup.phonetic || '', MAX_SOURCE_TEXT_LENGTH),
            partOfSpeech: cleanText(lookup.pos || '', MAX_SOURCE_TEXT_LENGTH),
            source: cleanText(lookup.source || 'local', MAX_SOURCE_TEXT_LENGTH),
            sourceLabel: cleanText(lookup.sourceLabel || '本地词典', MAX_SOURCE_TEXT_LENGTH),
            license: cleanText(lookup.license || '', MAX_SOURCE_TEXT_LENGTH),
            example: cleanText(lookup.example || '', MAX_MEANING_TEXT_LENGTH),
            tags: normalizeTags(lookup.tags),
            context: normalizeContextValue(context) || {}
        };
    }

    function createStorageEnvelope(data) {
        return JSON.stringify({
            data,
            timestamp: Date.now(),
            version: '1.0.0',
            compressed: false
        });
    }

    function parseFallbackStorageJson(raw) {
        if (!raw) {
            return null;
        }
        const source = String(raw);
        if (source.length > MAX_FALLBACK_STORAGE_STRING_LENGTH) {
            return null;
        }
        return JSON.parse(source);
    }

    function readFallbackList() {
        try {
            const raw = global.localStorage && global.localStorage.getItem(FALLBACK_STORAGE_KEY);
            if (!raw) {
                return null;
            }
            const parsed = parseFallbackStorageJson(raw);
            const data = parsed && Object.prototype.hasOwnProperty.call(parsed, 'data')
                ? parsed.data
                : parsed;
            return sanitizeFallbackList(data);
        } catch (_) {
            return null;
        }
    }

    function writeFallbackVocab(payload) {
        if (!global.localStorage || !payload || !payload.word) {
            return false;
        }
        const now = new Date().toISOString();
        const list = readFallbackList() || {
            id: 'reading-highlights',
            name: '阅读高亮生词',
            icon: '📖',
            source: 'reading-highlight',
            words: [],
            createdAt: now,
            updatedAt: now
        };
        list.words = Array.isArray(list.words)
            ? list.words.map((item) => sanitizeFallbackWordEntry(item)).filter(Boolean).slice(-MAX_STORED_HIGHLIGHT_WORDS)
            : [];
        const safeWord = cleanText(payload.word, MAX_WORD_TEXT_LENGTH);
        if (!safeWord) {
            return false;
        }
        const key = safeWord.toLowerCase();
        const existingIndex = list.words.findIndex((item) => String(item.word || '').trim().toLowerCase() === key);
        const noteText = cleanText([
            payload.phonetic ? `音标: ${cleanText(payload.phonetic, MAX_SOURCE_TEXT_LENGTH)}` : '',
            payload.partOfSpeech ? `词性: ${cleanText(payload.partOfSpeech, MAX_SOURCE_TEXT_LENGTH)}` : '',
            payload.selectedText && payload.selectedText !== payload.word ? `原高亮: ${cleanText(payload.selectedText, MAX_WORD_TEXT_LENGTH)}` : '',
            payload.sourceLabel ? `来源: ${cleanText(payload.sourceLabel, MAX_SOURCE_TEXT_LENGTH)}` : ''
        ].filter(Boolean).join('；'), MAX_MEANING_TEXT_LENGTH);
        const wordRecord = {
            id: buildHighlightId(safeWord),
            word: safeWord,
            meaning: cleanText(payload.meaning || payload.definition || '待补充释义', MAX_MEANING_TEXT_LENGTH),
            example: cleanText(payload.example || '', MAX_MEANING_TEXT_LENGTH),
            note: noteText,
            timestamp: Date.now(),
            source: 'reading-highlight',
            easeFactor: null,
            interval: 1,
            repetitions: 0,
            intraCycles: 0,
            correctCount: 0,
            lastReviewed: null,
            nextReview: null,
            createdAt: existingIndex >= 0 ? (list.words[existingIndex].createdAt || now) : now,
            updatedAt: now
        };
        if (existingIndex >= 0) {
            list.words.splice(existingIndex, 1, { ...list.words[existingIndex], ...wordRecord });
        } else {
            list.words.push(wordRecord);
        }
        list.words = list.words.slice(-MAX_STORED_HIGHLIGHT_WORDS);
        list.updatedAt = now;
        list.stats = {
            totalWords: list.words.length,
            masteredWords: list.words.filter((word) => (Number(word.correctCount) || 0) >= 4).length,
            reviewingWords: list.words.filter((word) => word.lastReviewed && !word.nextReview).length
        };
        global.localStorage.setItem(FALLBACK_STORAGE_KEY, createStorageEnvelope(list));
        return true;
    }

    function postVocabPayload(payload) {
        if (currentOptions && typeof currentOptions.postMessage === 'function') {
            currentOptions.postMessage(VOCAB_MESSAGE_TYPE, payload);
            return true;
        }
        const candidates = [global.opener, global.parent];
        for (let index = 0; index < candidates.length; index += 1) {
            const target = candidates[index];
            if (!target || target === global) {
                continue;
            }
            try {
                target.postMessage({
                    type: VOCAB_MESSAGE_TYPE,
                    source: 'practice_page',
                    data: payload
                }, getMessageTargetOrigin());
                return true;
            } catch (_) {
                // try next target
            }
        }
        return false;
    }

    function saveActiveLookup(button) {
        const payload = buildVocabPayload();
        if (!payload.word) {
            return;
        }
        const posted = postVocabPayload(payload);
        const fallbackSaved = writeFallbackVocab(payload);
        if (button instanceof HTMLButtonElement) {
            button.textContent = posted || fallbackSaved ? '已加入' : '保存失败';
            button.disabled = true;
        }
    }

    function enhance(options = {}) {
        currentOptions = { ...currentOptions, ...options };
        ensureStyle();
        closeBubble();
        const enabled = isEnabled();
        getRoots().forEach((root) => {
            root.querySelectorAll('.hl').forEach((node) => {
                if (!(node instanceof HTMLElement)) {
                    return;
                }
                node.classList.toggle(INTERACTIVE_CLASS, enabled);
                if (enabled) {
                    node.setAttribute('tabindex', '0');
                    node.setAttribute('role', 'button');
                    node.setAttribute('aria-label', `查看释义：${cleanText(node.textContent)}`);
                } else {
                    node.removeAttribute('tabindex');
                    node.removeAttribute('role');
                    node.removeAttribute('aria-label');
                }
            });
        });
    }

    function attach(options = {}) {
        currentOptions = { ...currentOptions, ...options };
        ensureStyle();
        if (attach._attached) {
            enhance(options);
            return;
        }
        attach._attached = true;
        document.addEventListener('click', (event) => {
            const highlight = getHighlightFromEvent(event);
            if (!highlight || !isEnabled()) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            openBubble(highlight);
        });
        enhance(options);
    }

    const api = {
        attach,
        enhance,
        close: closeBubble,
        storageKey: FALLBACK_STORAGE_KEY,
        messageType: VOCAB_MESSAGE_TYPE
    };

    if (typeof module !== 'undefined' && module.exports) {
        api._test = {
            normalizeContextValue,
            sanitizeFallbackList,
            sanitizeFallbackWordEntry,
            writeFallbackVocab
        };
        module.exports = api;
    } else {
        global.ReviewHighlightDictionary = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
