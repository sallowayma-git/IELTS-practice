(function(window, document) {
    const NOTICE_STORAGE_PREFIX = 'ielts-site-login-notice:';

    function truncateText(value, maxLength) {
        const text = String(value || '')
            .replace(/[\u0000-\u001F\u007F]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (text.length <= maxLength) {
            return text;
        }
        let truncated = text.slice(0, maxLength);
        if (/[\uD800-\uDBFF]$/.test(truncated)) {
            truncated = truncated.slice(0, -1);
        }
        return truncated;
    }

    function isSafeSiteContentPath(value) {
        const text = String(value || '').trim();
        if (!text) {
            return true;
        }
        return text.startsWith('/')
            && !text.startsWith('//')
            && !text.includes('\\')
            && !/^\/(?:api|admin|auth\/admin)(?:\/|$)/i.test(text)
            && !/[\u0000-\u001F\u007F]/.test(text);
    }

    function normalizeContentItem(item) {
        const source = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
        const ctaHref = truncateText(source.ctaHref, 240);
        return {
            enabled: Boolean(source.enabled),
            title: truncateText(source.title, 120),
            body: truncateText(source.body, 1000),
            ctaLabel: truncateText(source.ctaLabel, 60),
            ctaHref: isSafeSiteContentPath(ctaHref) ? ctaHref : ''
        };
    }

    function appendTextNode(parent, tagName, className, text) {
        const value = truncateText(text, 1000);
        if (!value) {
            return null;
        }
        const node = document.createElement(tagName);
        if (className) {
            node.className = className;
        }
        node.textContent = value;
        parent.appendChild(node);
        return node;
    }

    function renderHomeBanner(content) {
        const host = document.getElementById('site-announcement-host');
        if (!host) {
            return;
        }
        const banner = normalizeContentItem(content && content.homeBanner);
        host.textContent = '';
        host.hidden = true;
        if (!banner.enabled || (!banner.title && !banner.body)) {
            return;
        }

        const panel = document.createElement('section');
        panel.className = 'site-announcement';
        panel.setAttribute('role', 'note');

        const text = document.createElement('div');
        text.className = 'site-announcement__text';
        appendTextNode(text, 'div', 'site-announcement__title', banner.title);
        appendTextNode(text, 'div', 'site-announcement__body', banner.body);
        panel.appendChild(text);

        if (banner.ctaLabel && banner.ctaHref) {
            const link = document.createElement('a');
            link.className = 'site-announcement__action';
            link.href = banner.ctaHref;
            link.textContent = banner.ctaLabel;
            panel.appendChild(link);
        }

        host.appendChild(panel);
        host.hidden = false;
    }

    function getNoticeStorageKey(user, notice) {
        const userKey = truncateText(user && user.id, 80) || 'anonymous';
        const contentKey = [notice.title, notice.body, notice.ctaLabel, notice.ctaHref].join('|');
        return `${NOTICE_STORAGE_PREFIX}${userKey}:${contentKey}`;
    }

    function hasSeenNotice(key) {
        try {
            return window.sessionStorage.getItem(key) === '1';
        } catch (_) {
            return false;
        }
    }

    function markNoticeSeen(key) {
        try {
            window.sessionStorage.setItem(key, '1');
        } catch (_) {
            // Session storage can be unavailable; closing the notice should still work.
        }
    }

    function renderLoginNotice(content, user) {
        const notice = normalizeContentItem(content && content.loginNotice);
        if (!notice.enabled || (!notice.title && !notice.body)) {
            return;
        }
        const storageKey = getNoticeStorageKey(user, notice);
        if (hasSeenNotice(storageKey)) {
            return;
        }

        const backdrop = document.createElement('div');
        backdrop.className = 'site-login-notice-backdrop';
        backdrop.setAttribute('role', 'presentation');

        const dialog = document.createElement('section');
        dialog.className = 'site-login-notice';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-label', notice.title || 'Site notice');
        appendTextNode(dialog, 'h2', '', notice.title);
        appendTextNode(dialog, 'p', '', notice.body);

        const actions = document.createElement('div');
        actions.className = 'site-login-notice__actions';
        let handleKeydown = null;

        const close = () => {
            markNoticeSeen(storageKey);
            backdrop.remove();
            if (handleKeydown) {
                document.removeEventListener('keydown', handleKeydown);
                handleKeydown = null;
            }
        };

        const dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.textContent = 'Close';
        dismiss.addEventListener('click', close);
        actions.appendChild(dismiss);

        if (notice.ctaLabel) {
            const primary = document.createElement('button');
            primary.type = 'button';
            primary.className = 'site-login-notice__primary';
            primary.textContent = notice.ctaLabel;
            primary.addEventListener('click', () => {
                close();
                if (notice.ctaHref) {
                    window.location.assign(notice.ctaHref);
                }
            });
            actions.appendChild(primary);
        }

        dialog.appendChild(actions);
        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);
        dismiss.focus();

        handleKeydown = (event) => {
            if (event.key === 'Escape' && document.body.contains(backdrop)) {
                close();
            }
        };
        document.addEventListener('keydown', handleKeydown);
    }

    async function fetchJson(path) {
        const response = await window.fetch(path, {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: {
                accept: 'application/json'
            }
        });
        if (!response.ok) {
            return null;
        }
        return response.json();
    }

    async function getAuthenticatedUser() {
        const payload = await fetchJson('/api/auth/me');
        return payload && payload.user && payload.user.id ? payload.user : null;
    }

    async function loadSiteContent() {
        if (typeof window.fetch !== 'function') {
            return;
        }
        const payload = await fetchJson('/api/site-content');
        const content = payload && payload.content ? payload.content : {};
        renderHomeBanner(content);
        const user = await getAuthenticatedUser();
        if (user) {
            renderLoginNotice(content, user);
        }
    }

    function boot() {
        loadSiteContent().catch(() => {
            renderHomeBanner({});
        });
    }

    if (window.__IELTS_SITE_CONTENT_TEST__) {
        window.__IELTS_SITE_CONTENT__ = {
            isSafeSiteContentPath,
            normalizeContentItem,
            renderHomeBanner,
            renderLoginNotice
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }
})(window, document);
