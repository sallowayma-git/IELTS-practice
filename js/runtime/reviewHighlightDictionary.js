(function initReviewHighlightDictionary(global) {
    'use strict';

    const STYLE_ID = 'review-highlight-dictionary-style';
    const BUBBLE_ID = 'review-highlight-dictionary-bubble';
    const INTERACTIVE_CLASS = 'review-dictionary-highlight';
    const VOCAB_MESSAGE_TYPE = 'VOCAB_HIGHLIGHT_SAVE';
    const FALLBACK_STORAGE_KEY = 'exam_system_vocab_list_reading_highlights';

    let currentOptions = {};
    let activeHighlight = null;
    let activeLookup = null;
    let outsideHandlerAttached = false;

    function cleanText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
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
            console.warn('[ReviewHighlightDictionary] lookup failed:', error);
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

    function renderPart(part) {
        if (!part) {
            return '';
        }
        const meta = [part.phonetic ? `/${part.phonetic}/` : '', part.pos || '', part.sourceLabel || '']
            .filter(Boolean)
            .join(' · ');
        return `
            <div class="vocab-part">
                <div class="vocab-term">${escapeHtml(part.term || part.lemma || part.requested)}</div>
                ${meta ? `<div class="vocab-meta">${escapeHtml(meta)}</div>` : ''}
                ${part.zh ? `<div class="vocab-section"><div class="vocab-label">中文释义</div><div class="vocab-text">${escapeHtml(part.zh)}</div></div>` : ''}
                ${part.en ? `<div class="vocab-section"><div class="vocab-label">英文释义</div><div class="vocab-text">${escapeHtml(part.en)}</div></div>` : ''}
            </div>
        `;
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
        const body = !found
            ? `
                <div class="vocab-section">
                    <div class="vocab-label">本地词典</div>
                    <div class="vocab-text">未收录该高亮内容。可先加入阅读高亮生词，后续手动补充释义。</div>
                </div>
            `
            : (Array.isArray(lookup.parts) && lookup.parts.length
                ? lookup.parts.map(renderPart).join('')
                : `
                    ${lookup.zh ? `<div class="vocab-section"><div class="vocab-label">中文释义</div><div class="vocab-text">${escapeHtml(lookup.zh)}</div></div>` : ''}
                    ${lookup.en ? `<div class="vocab-section"><div class="vocab-label">英文释义</div><div class="vocab-text">${escapeHtml(lookup.en)}</div></div>` : ''}
                    ${lookup.example ? `<div class="vocab-section"><div class="vocab-label">例句</div><div class="vocab-text">${escapeHtml(lookup.example)}</div></div>` : ''}
                    ${sourceLine ? `<div class="vocab-section"><div class="vocab-label">来源</div><div class="vocab-text">${escapeHtml(sourceLine)}</div></div>` : ''}
                `);

        return `
            <div class="vocab-bubble-head">
                <div>
                    <h4 class="vocab-term">${escapeHtml(term || lookup.requested || '高亮词')}</h4>
                    ${meta ? `<div class="vocab-meta">${escapeHtml(meta)}</div>` : ''}
                </div>
                <button class="vocab-close" type="button" data-vocab-close aria-label="关闭">×</button>
            </div>
            ${body}
            <div class="vocab-actions">
                <button class="vocab-add" type="button" data-vocab-add>加入生词本</button>
            </div>
        `;
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
        bubble.innerHTML = renderLookup(activeLookup);
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
            bubble.innerHTML = '';
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
        const selectedText = cleanText(activeHighlight && activeHighlight.textContent);
        return {
            word: cleanText(lookup.term || lookup.lemma || selectedText),
            selectedText,
            meaning: cleanText(lookup.zh || ''),
            definition: cleanText(lookup.en || ''),
            phonetic: cleanText(lookup.phonetic || ''),
            partOfSpeech: cleanText(lookup.pos || ''),
            source: lookup.source || 'local',
            sourceLabel: lookup.sourceLabel || '本地词典',
            license: lookup.license || '',
            example: cleanText(lookup.example || ''),
            tags: Array.isArray(lookup.tags) ? lookup.tags.slice() : [],
            context: context && typeof context === 'object' ? context : {}
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

    function readFallbackList() {
        try {
            const raw = global.localStorage && global.localStorage.getItem(FALLBACK_STORAGE_KEY);
            if (!raw) {
                return null;
            }
            const parsed = JSON.parse(raw);
            const data = parsed && Object.prototype.hasOwnProperty.call(parsed, 'data')
                ? parsed.data
                : parsed;
            return data && typeof data === 'object' && Array.isArray(data.words) ? data : null;
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
        const key = payload.word.toLowerCase();
        const existingIndex = list.words.findIndex((item) => String(item.word || '').trim().toLowerCase() === key);
        const wordRecord = {
            id: `reading-highlight-${key.replace(/[^a-z0-9]+/g, '-')}`,
            word: payload.word,
            meaning: payload.meaning || payload.definition || '待补充释义',
            example: payload.example || '',
            note: [
                payload.phonetic ? `音标: ${payload.phonetic}` : '',
                payload.partOfSpeech ? `词性: ${payload.partOfSpeech}` : '',
                payload.selectedText && payload.selectedText !== payload.word ? `原高亮: ${payload.selectedText}` : '',
                payload.sourceLabel ? `来源: ${payload.sourceLabel}` : ''
            ].filter(Boolean).join('；'),
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
                }, '*');
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
        module.exports = api;
    } else {
        global.ReviewHighlightDictionary = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
