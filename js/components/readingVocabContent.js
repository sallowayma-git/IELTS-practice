(function (global) {
    'use strict';

    const CONTAINERS = new Set(['DIV', 'SECTION', 'ARTICLE', 'MAIN']);
    const HEADING = /^H[1-6]$/;

    function labelFromText(value) {
        const match = String(value || '').trim().match(/^(?:Paragraph\s+)?([A-Z])(?:[.:)])?$/);
        return match ? match[1] : '';
    }

    function standaloneLabel(node) {
        if (HEADING.test(node.tagName) || node.matches('.paragraph-label, strong, b, p')) {
            return labelFromText(node.textContent);
        }
        return '';
    }

    function leadingLabel(node) {
        // A capital article at the start of an ordinary sentence is not a label.
        // Inline labels must have their own leading element or say "Paragraph X".
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        let firstText;
        while ((firstText = walker.nextNode()) && !firstText.textContent.trim()) {}
        if (!firstText) return '';
        const marker = firstText.parentElement.closest('strong, b, .paragraph-label');
        if (marker && node.contains(marker)) {
            const label = labelFromText(marker.textContent);
            if (label) return label;
        }
        const explicit = node.textContent.trim().match(/^Paragraph\s+([A-Z])(?:\s*[:.)]\s*|\s+)/);
        return explicit ? explicit[1] : '';
    }

    function isInstruction(text) {
        return /^(?:You should spend\b[^.]*\bminutes\b|Questions\s+\d+\s*(?:[-–—]|to)\s*\d+\s+(?:are based|refer to)\b)/i.test(text.trim());
    }

    function isItalicSubtitle(node) {
        if (node.tagName !== 'P') return false;
        const text = node.textContent.trim();
        const italicText = Array.from(node.querySelectorAll('em, i'))
            .filter(element => !element.parentElement.closest('em, i'))
            .map(element => element.textContent.trim()).join(' ').trim();
        return !!text && text === italicText;
    }

    function hasContent(node) {
        return !!node.textContent.trim() || node.matches('img, svg, video, audio, canvas, hr, math') ||
            !!node.querySelector('img, svg, video, audio, canvas, hr, math');
    }

    function collectUnits(root) {
        const units = [];
        function visit(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                if (node.textContent.trim()) {
                    const paragraph = document.createElement('p');
                    paragraph.textContent = node.textContent;
                    units.push(paragraph);
                }
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            if (CONTAINERS.has(node.tagName) && !node.classList.contains('paragraph-wrapper')) {
                Array.from(node.childNodes).forEach(visit);
            } else if (hasContent(node)) {
                units.push(node);
            }
        }
        Array.from(root.childNodes).forEach(visit);
        return units;
    }

    function ordinalLetter(index) {
        let label = '';
        for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
            label = String.fromCharCode(65 + (value - 1) % 26) + label;
        }
        return label;
    }

    function normalizePassage(passage, fallbackTitle = '') {
        // This is the same bodyHtml/html precedence and ordered-block contract
        // used by the practice page's renderDataset implementation.
        const rawHtml = (Array.isArray(passage?.blocks) ? passage.blocks : [])
            .map(block => block?.bodyHtml || block?.html || '').join('\n');
        const root = document.createElement('div');
        root.innerHTML = rawHtml;
        root.querySelectorAll('.paragraph-dropzone, .match-dropzone, .dropzone, .empty-space, #divider')
            .forEach(node => node.remove());

        let passageTitle = fallbackTitle;
        let titleFound = false;
        let beforeBody = true;
        const instructions = [];
        const subtitles = [];
        const body = [];
        for (const node of collectUnits(root)) {
            const text = node.textContent.trim();
            if (HEADING.test(node.tagName) && /^READING PASSAGE\s*\d*$/i.test(text)) continue;
            if (beforeBody && isInstruction(text)) {
                instructions.push(node.outerHTML);
                continue;
            }
            if (beforeBody && !titleFound && /^H[1-3]$/.test(node.tagName) && !standaloneLabel(node)) {
                passageTitle = text;
                titleFound = true;
                continue;
            }
            if (beforeBody && !standaloneLabel(node) &&
                (/^H[4-6]$/.test(node.tagName) || (titleFound && isItalicSubtitle(node)))) {
                subtitles.push(node.outerHTML);
                continue;
            }
            beforeBody = false;
            body.push(node);
        }

        const blocks = [];
        let current = null;
        let pendingHeadingHtml = '';
        function finish() {
            if (!current) return;
            const textRoot = document.createElement('div');
            textRoot.innerHTML = current.html;
            if (hasContent(textRoot)) {
                const index = blocks.length;
                blocks.push({
                    id: `p-${index + 1}`,
                    letter: current.label || ordinalLetter(index),
                    explicitLabel: !!current.label,
                    html: current.html,
                    text: textRoot.textContent.trim()
                });
            }
            current = null;
        }
        function start(html, label = '') {
            current = { html: pendingHeadingHtml + html, label };
            pendingHeadingHtml = '';
        }

        for (const node of body) {
            const marker = standaloneLabel(node);
            if (marker) {
                finish();
                start('', marker);
                continue;
            }
            if (node.classList.contains('paragraph-wrapper')) {
                finish();
                start(node.innerHTML, leadingLabel(node));
                finish();
                continue;
            }
            const inlineLabel = leadingLabel(node);
            if (inlineLabel) {
                finish();
                start(node.outerHTML, inlineLabel);
                continue;
            }
            if (HEADING.test(node.tagName) && !current?.label) {
                finish();
                pendingHeadingHtml += node.outerHTML;
                continue;
            }
            if (current?.label) {
                // Some sources split one lettered paragraph across multiple p
                // elements. Keep every element under the explicit section label.
                current.html += node.outerHTML;
            } else {
                finish();
                start(node.outerHTML);
            }
        }
        finish();
        if (pendingHeadingHtml) {
            start('');
            finish();
        }

        return {
            passageTitle,
            instructionHtml: instructions.join('\n'),
            subtitleHtml: subtitles.join('\n'),
            rawHtml,
            blocks
        };
    }

    global.ReadingVocabContent = Object.freeze({ normalizePassage });
})(typeof window !== 'undefined' ? window : globalThis);
