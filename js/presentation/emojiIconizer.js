(function initEmojiIconizer(global) {
    'use strict';

    if (global.EmojiIconizer && global.EmojiIconizer.__initialized) {
        return;
    }

    var SKIP_TAGS = {
        SCRIPT: true,
        STYLE: true,
        TEXTAREA: true,
        INPUT: true,
        SELECT: true,
        OPTION: true,
        CODE: true,
        PRE: true
    };

    var EMOJI_BASE_PATTERN = '(?:[\\u00A9\\u00AE\\u203C\\u2049\\u2122\\u2139\\u2194-\\u2199\\u21A9-\\u21AA\\u231A-\\u231B\\u2328\\u23CF\\u23E9-\\u23FA\\u24C2\\u25AA-\\u25AB\\u25B6\\u25C0\\u25FB-\\u25FE\\u2600-\\u27BF\\u2934-\\u2935\\u2B05-\\u2B07\\u2B1B-\\u2B1C\\u2B50\\u2B55\\u3030\\u303D\\u3297\\u3299]|\\uD83C[\\uDC00-\\uDFFF]|\\uD83D[\\uDC00-\\uDFFF]|\\uD83E[\\uDC00-\\uDFFF])';
    var EMOJI_PATTERN = new RegExp(
        '(?:[#*0-9]\\uFE0F?\\u20E3|(?:\\uD83C[\\uDDE6-\\uDDFF]){2}|' +
        EMOJI_BASE_PATTERN +
        '(?:\\uFE0E|\\uFE0F)?(?:\\u200D' + EMOJI_BASE_PATTERN + '(?:\\uFE0E|\\uFE0F)?)*)',
        'g'
    );

    var ICON_BY_EMOJI = {};
    ICON_BY_EMOJI['\uD83D\uDCCA'] = 'chart';
    ICON_BY_EMOJI['\uD83D\uDCC8'] = 'chart';
    ICON_BY_EMOJI['\uD83D\uDCDA'] = 'book';
    ICON_BY_EMOJI['\uD83D\uDCD6'] = 'book';
    ICON_BY_EMOJI['\uD83D\uDCDD'] = 'note';
    ICON_BY_EMOJI['\u2728'] = 'spark';
    ICON_BY_EMOJI['\u2699'] = 'gear';
    ICON_BY_EMOJI['\uD83D\uDD27'] = 'gear';
    ICON_BY_EMOJI['\uD83D\uDDD1'] = 'trash';
    ICON_BY_EMOJI['\uD83D\uDCC2'] = 'folder';
    ICON_BY_EMOJI['\uD83D\uDD04'] = 'sync';
    ICON_BY_EMOJI['\uD83D\uDCBE'] = 'save';
    ICON_BY_EMOJI['\uD83D\uDCCB'] = 'list';
    ICON_BY_EMOJI['\uD83D\uDCE4'] = 'upload';
    ICON_BY_EMOJI['\uD83D\uDCE5'] = 'download';
    ICON_BY_EMOJI['\uD83C\uDFAF'] = 'target';
    ICON_BY_EMOJI['\uD83C\uDFC6'] = 'trophy';
    ICON_BY_EMOJI['\uD83D\uDCC4'] = 'doc';
    ICON_BY_EMOJI['\uD83C\uDFA8'] = 'spark';
    ICON_BY_EMOJI['\u2705'] = 'check';
    ICON_BY_EMOJI['\u2714'] = 'check';
    ICON_BY_EMOJI['\u274C'] = 'close';
    ICON_BY_EMOJI['\u2716'] = 'close';
    ICON_BY_EMOJI['\u26A0'] = 'warning';
    ICON_BY_EMOJI['\u2139'] = 'info';
    ICON_BY_EMOJI['\uD83C\uDFA7'] = 'headphones';
    ICON_BY_EMOJI['\u26A1'] = 'bolt';
    ICON_BY_EMOJI['\uD83D\uDD52'] = 'clock';
    ICON_BY_EMOJI['\u23F0'] = 'clock';
    ICON_BY_EMOJI['\uD83E\uDDE0'] = 'brain';
    ICON_BY_EMOJI['\uD83D\uDE80'] = 'rocket';
    ICON_BY_EMOJI['\uD83C\uDFB2'] = 'dice';
    ICON_BY_EMOJI['\u2795'] = 'plus';
    ICON_BY_EMOJI['\uD83D\uDCCD'] = 'pin';
    ICON_BY_EMOJI['\uD83D\uDEE0'] = 'tools';
    ICON_BY_EMOJI['\uD83D\uDEE1'] = 'shield';
    ICON_BY_EMOJI['\uD83C\uDF10'] = 'globe';
    ICON_BY_EMOJI['\uD83D\uDCA1'] = 'bulb';
    ICON_BY_EMOJI['\uD83E\uDDF9'] = 'spark';
    ICON_BY_EMOJI['\uD83D\uDC42'] = 'headphones';
    ICON_BY_EMOJI['\uD83D\uDC41'] = 'target';
    ICON_BY_EMOJI['\uD83C\uDF31'] = 'spark';
    ICON_BY_EMOJI['\uD83C\uDF89'] = 'spark';
    ICON_BY_EMOJI['\uD83D\uDD35'] = 'dot';
    ICON_BY_EMOJI['\uD83D\uDFE1'] = 'dot';
    ICON_BY_EMOJI['\uD83C\uDF40'] = 'spark';
    ICON_BY_EMOJI['\uD83C\uDF93'] = 'badge';
    ICON_BY_EMOJI['\uD83D\uDC4B'] = 'hand';
    ICON_BY_EMOJI['\uD83E\uDE84'] = 'spark';
    ICON_BY_EMOJI['\uD83D\uDC37'] = 'dot';

    var ICON_SVG_CONTENT = {
        chart: '<rect x="4" y="11" width="3" height="8" rx="1"></rect><rect x="10.5" y="7" width="3" height="12" rx="1"></rect><rect x="17" y="4" width="3" height="15" rx="1"></rect>',
        book: '<path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H20v15H7.5A2.5 2.5 0 0 0 5 20.5V5.5z"></path><path d="M5 5.5V20.5A2.5 2.5 0 0 1 2.5 18V7.5A2.5 2.5 0 0 1 5 5z"></path>',
        note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><path d="M14 3v6h6"></path><path d="M8 15l2.4 2.4 5.8-5.8"></path>',
        spark: '<path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3z"></path>',
        gear: '<circle cx="12" cy="12" r="3"></circle><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7"></path>',
        trash: '<path d="M4 7h16"></path><path d="M9 7V5h6v2"></path><rect x="6" y="7" width="12" height="14" rx="2"></rect><path d="M10 11v6M14 11v6"></path>',
        folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3V7z"></path><path d="M3 10h18v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7z"></path>',
        sync: '<path d="M20 6v5h-5"></path><path d="M4 18v-5h5"></path><path d="M6.2 11a6 6 0 0 1 10.6-2.4L20 11"></path><path d="M17.8 13a6 6 0 0 1-10.6 2.4L4 13"></path>',
        save: '<path d="M5 3h11l3 3v15H5z"></path><path d="M8 3v6h8V3"></path><rect x="8" y="14" width="8" height="5" rx="1"></rect>',
        list: '<path d="M9 6h11M9 12h11M9 18h11"></path><circle cx="5" cy="6" r="1"></circle><circle cx="5" cy="12" r="1"></circle><circle cx="5" cy="18" r="1"></circle>',
        upload: '<path d="M12 16V5"></path><path d="M8 9l4-4 4 4"></path><path d="M4 18v2h16v-2"></path>',
        download: '<path d="M12 5v11"></path><path d="M8 12l4 4 4-4"></path><path d="M4 18v2h16v-2"></path>',
        target: '<circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="12" r="4"></circle><circle cx="12" cy="12" r="1.6"></circle>',
        trophy: '<path d="M8 4h8v3a4 4 0 0 1-8 0V4z"></path><path d="M8 6H5a3 3 0 0 0 3 3"></path><path d="M16 6h3a3 3 0 0 1-3 3"></path><path d="M12 11v4"></path><path d="M9 20h6"></path><path d="M10 15h4"></path>',
        doc: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><path d="M14 3v6h6"></path><path d="M8 13h8M8 17h6"></path>',
        flag: '<path d="M5 4v16"></path><path d="M5 5h12l-2 3 2 3H5z"></path>',
        keycap: '<rect x="4" y="4" width="16" height="16" rx="3"></rect><path d="M9 12h6M12 9v6"></path>',
        check: '<path d="M5 12.5l4.2 4.2L19 7"></path>',
        close: '<path d="M7 7l10 10M17 7L7 17"></path>',
        warning: '<path d="M12 4l8 14H4z"></path><path d="M12 9v4"></path><circle cx="12" cy="16.5" r="0.8"></circle>',
        info: '<circle cx="12" cy="12" r="8"></circle><path d="M12 10v5"></path><circle cx="12" cy="7.5" r="0.8"></circle>',
        headphones: '<path d="M4 13a8 8 0 0 1 16 0"></path><rect x="3" y="13" width="4" height="7" rx="2"></rect><rect x="17" y="13" width="4" height="7" rx="2"></rect>',
        bolt: '<path d="M13 2L5 13h5l-1 9 8-11h-5z"></path>',
        clock: '<circle cx="12" cy="12" r="8"></circle><path d="M12 8v4.5l3 1.8"></path>',
        brain: '<path d="M9 6a3 3 0 0 1 6 0"></path><path d="M8 10a2.5 2.5 0 0 1 0-5"></path><path d="M16 10a2.5 2.5 0 0 0 0-5"></path><path d="M8 10a3 3 0 0 0 0 6"></path><path d="M16 10a3 3 0 0 1 0 6"></path><path d="M10 16a2 2 0 0 0 4 0"></path>',
        rocket: '<path d="M14 4c3 1 5 4 6 6-2 .8-4.4 1-6.6.8L9 15.2C8.2 13 8.5 10.8 9.4 9 11 6.2 12.5 4.8 14 4z"></path><path d="M9 15l-3 3"></path><path d="M6 18l1.2-4.2"></path><circle cx="14.5" cy="9.5" r="1"></circle>',
        dice: '<rect x="4" y="4" width="16" height="16" rx="3"></rect><circle cx="8.5" cy="8.5" r="1"></circle><circle cx="15.5" cy="8.5" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="8.5" cy="15.5" r="1"></circle><circle cx="15.5" cy="15.5" r="1"></circle>',
        plus: '<path d="M12 6v12M6 12h12"></path>',
        pin: '<path d="M12 21s6-5.7 6-10a6 6 0 1 0-12 0c0 4.3 6 10 6 10z"></path><circle cx="12" cy="11" r="2"></circle>',
        tools: '<path d="M4 20l6-6"></path><path d="M14 6l4 4"></path><path d="M15 3a3 3 0 0 0 3 3l-6.5 6.5a2 2 0 0 1-2.8 0L7.5 11.3a2 2 0 0 1 0-2.8L14 2a3 3 0 0 0 1 1z"></path>',
        shield: '<path d="M12 3l7 3v5c0 4.5-3 7.5-7 10-4-2.5-7-5.5-7-10V6z"></path>',
        globe: '<circle cx="12" cy="12" r="8"></circle><path d="M4 12h16"></path><path d="M12 4a13 13 0 0 1 0 16"></path><path d="M12 4a13 13 0 0 0 0 16"></path>',
        bulb: '<path d="M9 17h6"></path><path d="M10 20h4"></path><path d="M8.5 12a3.5 3.5 0 1 1 7 0c0 1.5-.8 2.3-1.6 3.1-.6.6-.9 1.1-.9 1.9h-2c0-.8-.3-1.3-.9-1.9C9.3 14.3 8.5 13.5 8.5 12z"></path>',
        dot: '<circle cx="12" cy="12" r="6"></circle>',
        badge: '<circle cx="12" cy="10" r="5"></circle><path d="M9.5 15.5L8 20l4-2 4 2-1.5-4.5"></path>',
        hand: '<path d="M7 12V8a1 1 0 1 1 2 0v3"></path><path d="M9 11V7a1 1 0 1 1 2 0v4"></path><path d="M11 11V7a1 1 0 1 1 2 0v4"></path><path d="M13 12V8a1 1 0 1 1 2 0v5.5a4.5 4.5 0 0 1-4.5 4.5H9a4 4 0 0 1-4-4v-2a1 1 0 1 1 2 0z"></path>',
        fallback: '<circle cx="12" cy="12" r="8"></circle><path d="M12 8v4"></path><circle cx="12" cy="15.5" r="1"></circle>'
    };

    var observer = null;

    function normalizeEmojiToken(token) {
        return String(token || '').replace(/[\uFE0E\uFE0F]/g, '');
    }

    function isSkippableElement(node) {
        if (!node || node.nodeType !== 1) {
            return false;
        }
        if (SKIP_TAGS[node.nodeName]) {
            return true;
        }
        if (node.classList && node.classList.contains('ui-emoji-icon')) {
            return true;
        }
        return !!node.isContentEditable;
    }

    function shouldSkipTextNode(node) {
        if (!node || node.nodeType !== 3 || !node.parentNode) {
            return true;
        }

        var parent = node.parentNode;
        while (parent && parent.nodeType === 1) {
            if (isSkippableElement(parent)) {
                return true;
            }
            parent = parent.parentNode;
        }
        return false;
    }

    function resolveIconName(token) {
        if (/^(?:\uD83C[\uDDE6-\uDDFF]){2}$/.test(token)) {
            return 'flag';
        }
        if (/^[#*0-9]\uFE0F?\u20E3$/.test(token)) {
            return 'keycap';
        }

        var normalized = normalizeEmojiToken(token);
        if (ICON_BY_EMOJI[normalized]) {
            return ICON_BY_EMOJI[normalized];
        }
        return 'fallback';
    }

    function buildIconSvg(iconName) {
        var body = ICON_SVG_CONTENT[iconName] || ICON_SVG_CONTENT.fallback;
        return '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + body + '</svg>';
    }

    function createIconNode(token) {
        var iconName = resolveIconName(token);
        var span = document.createElement('span');
        span.className = 'ui-emoji-icon';
        span.setAttribute('aria-hidden', 'true');
        span.innerHTML = buildIconSvg(iconName);
        return span;
    }

    function replaceEmojiInTextNode(textNode) {
        if (!textNode || !textNode.nodeValue || shouldSkipTextNode(textNode)) {
            return false;
        }

        var text = textNode.nodeValue;
        EMOJI_PATTERN.lastIndex = 0;
        if (!EMOJI_PATTERN.test(text)) {
            return false;
        }

        EMOJI_PATTERN.lastIndex = 0;
        var fragment = document.createDocumentFragment();
        var lastIndex = 0;
        var match;

        while ((match = EMOJI_PATTERN.exec(text))) {
            if (match.index > lastIndex) {
                fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
            }
            fragment.appendChild(createIconNode(match[0]));
            lastIndex = match.index + match[0].length;
        }

        if (lastIndex < text.length) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
        }

        if (!textNode.parentNode) {
            return false;
        }
        textNode.parentNode.replaceChild(fragment, textNode);
        return true;
    }

    function walkAndReplace(root) {
        if (!root) {
            return;
        }

        if (root.nodeType === 3) {
            replaceEmojiInTextNode(root);
            return;
        }

        if (root.nodeType !== 1 || isSkippableElement(root)) {
            return;
        }

        var walker = document.createTreeWalker(root, 4, null, false);
        var candidates = [];
        var current = walker.nextNode();
        while (current) {
            if (!shouldSkipTextNode(current)) {
                candidates.push(current);
            }
            current = walker.nextNode();
        }

        var i;
        for (i = 0; i < candidates.length; i++) {
            replaceEmojiInTextNode(candidates[i]);
        }
    }

    function observeDynamicContent() {
        if (!global.MutationObserver || !document.body) {
            return;
        }

        observer = new MutationObserver(function onMutations(mutations) {
            var i;
            var j;
            for (i = 0; i < mutations.length; i++) {
                var mutation = mutations[i];
                if (mutation.type === 'characterData') {
                    replaceEmojiInTextNode(mutation.target);
                    continue;
                }
                if (mutation.type !== 'childList' || !mutation.addedNodes || !mutation.addedNodes.length) {
                    continue;
                }
                for (j = 0; j < mutation.addedNodes.length; j++) {
                    walkAndReplace(mutation.addedNodes[j]);
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    function bootstrap() {
        walkAndReplace(document.body);
        observeDynamicContent();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
        bootstrap();
    }

    global.EmojiIconizer = {
        __initialized: true,
        refresh: function refresh(node) {
            walkAndReplace(node || document.body);
        },
        disconnect: function disconnect() {
            if (observer && typeof observer.disconnect === 'function') {
                observer.disconnect();
            }
        }
    };
})(window);
