const THEME_PORTAL_STORAGE_KEY = 'preferred_theme_portal';
const THEME_PORTAL_SESSION_SKIP_KEY = 'preferred_theme_skip_session';

function safeParse(json) {
    if (!json) {
        return null;
    }
    try {
        const value = JSON.parse(json);
        return value && typeof value === 'object' ? value : null;
    } catch (error) {
        console.warn('[Theme] 无法解析主题首选项:', error);
        return null;
    }
}

const themePreferenceController = {
    STORAGE_KEY: THEME_PORTAL_STORAGE_KEY,
    SESSION_KEY: THEME_PORTAL_SESSION_SKIP_KEY,

    load() {
        try {
            return safeParse(localStorage.getItem(this.STORAGE_KEY));
        } catch (error) {
            console.warn('[Theme] 读取主题首选项失败:', error);
            return null;
        }
    },

    save(payload) {
        if (!payload || typeof payload !== 'object') {
            this.clear();
            return;
        }
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(payload));
        } catch (error) {
            console.warn('[Theme] 保存主题首选项失败:', error);
        }
    },

    clear() {
        try {
            localStorage.removeItem(this.STORAGE_KEY);
        } catch (_) {
            // no-op
        }
    },

    clearSessionSkip() {
        try {
            sessionStorage.removeItem(this.SESSION_KEY);
        } catch (_) {
            // no-op
        }
    },

    markSessionRedirected() {
        try {
            sessionStorage.setItem(this.SESSION_KEY, '1');
        } catch (_) {
            // no-op
        }
    },

    shouldSkipRedirect() {
        try {
            return sessionStorage.getItem(this.SESSION_KEY) === '1';
        } catch (_) {
            return false;
        }
    },

    resolveUrl(target) {
        if (!target) {
            return '';
        }

        const bases = [];
        try {
            if (typeof document !== 'undefined' && document.baseURI) {
                bases.push(document.baseURI);
            }
        } catch (_) {}

        try {
            if (typeof window !== 'undefined' && window.__APP_FRAME_BASE_HREF__) {
                bases.push(window.__APP_FRAME_BASE_HREF__);
            }
        } catch (_) {}

        try {
            if (typeof window !== 'undefined' && window.location && window.location.href) {
                bases.push(window.location.href);
            }
        } catch (_) {}

        for (var i = 0; i < bases.length; i += 1) {
            var base = bases[i];
            if (!base) {
                continue;
            }
            try {
                return new URL(target, base).href;
            } catch (_) {
                // continue trying other bases
            }
        }

        try {
            return new URL(target).href;
        } catch (_) {
            return String(target);
        }
    },

    recordPortalNavigation(url, meta = {}) {
        const resolvedUrl = this.resolveUrl(url);
        const snapshot = {
            mode: 'portal',
            url: resolvedUrl,
            label: meta.label || '',
            theme: meta.theme || null,
            updatedAt: Date.now()
        };
        this.save(snapshot);
        this.clearSessionSkip();
        return this.load();
    },

    recordInternalTheme(themeId = 'default') {
        const snapshot = {
            mode: 'internal',
            theme: themeId,
            updatedAt: Date.now()
        };
        this.save(snapshot);
        this.clearSessionSkip();
        return this.load();
    },

    maybeAutoRedirect(options = {}) {
        const { simulate = false } = options || {};
        const preference = this.load();
        if (!preference || preference.mode !== 'portal') {
            return { shouldRedirect: false, preference };
        }

        if (this.shouldSkipRedirect()) {
            return { shouldRedirect: false, preference, reason: 'session-skipped' };
        }

        const targetUrl = this.resolveUrl(preference.url);
        if (!targetUrl || targetUrl === window.location.href) {
            return { shouldRedirect: false, preference, reason: 'already-at-target' };
        }

        if (!simulate) {
            this.markSessionRedirected();
            try {
                window.location.replace(targetUrl);
            } catch (error) {
                console.warn('[Theme] 自动跳转失败:', error);
            }
        }

        return { shouldRedirect: true, targetUrl, preference };
    }
};

if (typeof window !== 'undefined') {
    window.__themeSwitcher = themePreferenceController;
}

function handleThemeQueryParameters() {
    if (typeof window === 'undefined') {
        return;
    }
    let handled = false;
    try {
        const params = new URLSearchParams(window.location.search || '');
        const directive = params.get('theme');
        if (!directive) {
            return;
        }
        if (['reset', 'main', 'default'].includes(directive)) {
            themePreferenceController.clear();
            themePreferenceController.clearSessionSkip();
            handled = true;
        } else if (directive === 'portal') {
            themePreferenceController.clearSessionSkip();
            handled = true;
        }

        if (handled) {
            params.delete('theme');
            const query = params.toString();
            const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash || ''}`;
            window.history.replaceState({}, document.title, nextUrl);
        }
    } catch (error) {
        console.warn('[Theme] 处理主题参数失败:', error);
    }
}

handleThemeQueryParameters();
themePreferenceController.maybeAutoRedirect();

// Theme switching functionality
function applyTheme(theme) {
    const root = document.documentElement;
    if (!theme) return;
    try {
        root.setAttribute('data-theme', theme);
        document.body.classList.toggle('theme-blue', theme === 'blue');
        // Avoid style conflicts with Bloom's dark mode when using Blue theme
        if (theme === 'blue') {
            document.body.classList.remove('bloom-dark-mode');
            localStorage.setItem('bloom-theme-mode', 'light');
        }
        localStorage.setItem('theme', theme);
        themePreferenceController.recordInternalTheme(theme);
        // Update switcher buttons
        updateBloomThemeButton();
        updateBlueThemeButton();
    } catch (e) {}
}

function applyDefaultTheme() {
    const root = document.documentElement;
    try {
        root.removeAttribute('data-theme');
        document.body.classList.remove('theme-blue');
        document.body.classList.remove('blue-dark-mode');
        localStorage.removeItem('theme');
        themePreferenceController.recordInternalTheme('default');
        // Re-apply Bloom saved mode
        const savedMode = localStorage.getItem('bloom-theme-mode');
        if (savedMode === 'dark') {
            document.body.classList.add('bloom-dark-mode');
        } else {
            document.body.classList.remove('bloom-dark-mode');
        }
    } catch (e) {}
    updateBloomThemeButton();
    updateBlueThemeButton();
}
function showThemeSwitcherModal() {
    const modal = document.getElementById('theme-switcher-modal');
    if (modal) {
        modal.classList.add('show');
        updateBloomThemeButton();
        updateBlueThemeButton();
    }
}

function hideThemeSwitcherModal() {
    const modal = document.getElementById('theme-switcher-modal');
    if (modal) {
        modal.classList.remove('show');
    }
}

// Bloom theme dark mode toggle
function toggleBloomDarkMode() {
    const body = document.body;
    const isDarkMode = body.classList.contains('bloom-dark-mode');

    if (isDarkMode) {
        body.classList.remove('bloom-dark-mode');
        localStorage.setItem('bloom-theme-mode', 'light');
    } else {
        body.classList.add('bloom-dark-mode');
        localStorage.setItem('bloom-theme-mode', 'dark');
    }

    themePreferenceController.recordInternalTheme('bloom');

    updateBloomThemeButton();
}

// Update bloom theme button appearance
function updateBloomThemeButton() {
    const button = document.getElementById('bloom-theme-btn');
    if (!button) return;
    const currentTheme = document.documentElement.getAttribute('data-theme');
    if (currentTheme === 'blue') {
        button.classList.remove('btn-bloom-dark', 'btn-bloom-light');
        button.textContent = '切换';
        button.onclick = function() { applyDefaultTheme(); };
        return;
    }

    // When not in Blue theme, behave as Bloom dark/light toggle
    const isDarkMode = document.body.classList.contains('bloom-dark-mode');
    button.classList.remove('btn-bloom-dark', 'btn-bloom-light');
    if (isDarkMode) {
        button.classList.add('btn-bloom-light');
        button.textContent = '明亮';
    } else {
        button.classList.add('btn-bloom-dark');
        button.textContent = '黑暗';
    }
    button.onclick = function() { toggleBloomDarkMode(); };
}

// Initialize bloom theme mode on page load
function initializeBloomTheme() {
    const savedMode = localStorage.getItem('bloom-theme-mode');
    if (savedMode === 'dark') {
        document.body.classList.add('bloom-dark-mode');
    }
    updateBloomThemeButton();
}

// Blue theme dark mode toggle
function toggleBlueDarkMode() {
    // Only meaningful when Blue theme is active
    const currentTheme = document.documentElement.getAttribute('data-theme');
    if (currentTheme !== 'blue') {
        applyTheme('blue');
    }
    const isDark = document.body.classList.contains('blue-dark-mode');
    if (isDark) {
        document.body.classList.remove('blue-dark-mode');
        localStorage.setItem('blue-theme-mode', 'light');
    } else {
        document.body.classList.add('blue-dark-mode');
        localStorage.setItem('blue-theme-mode', 'dark');
    }
    themePreferenceController.recordInternalTheme('blue');
    updateBlueThemeButton();
}

function updateBlueThemeButton() {
    const button = document.getElementById('blue-theme-btn');
    if (!button) return;
    const currentTheme = document.documentElement.getAttribute('data-theme');

    if (currentTheme === 'blue') {
        const isDark = document.body.classList.contains('blue-dark-mode');
        button.textContent = isDark ? '明亮' : '黑暗';
        button.onclick = function() { toggleBlueDarkMode(); };
    } else {
        button.textContent = '切换';
        button.onclick = function() { applyTheme('blue'); };
    }
}

function navigateToThemePortal(url, options = {}) {
    const meta = options || {};
    const preference = themePreferenceController.recordPortalNavigation(url, meta);
    if (meta.theme) {
        try {
            document.documentElement.setAttribute('data-theme', meta.theme);
            localStorage.setItem('theme', meta.theme);
        } catch (_) {}
    }
    if (typeof meta.onBeforeNavigate === 'function') {
        try {
            meta.onBeforeNavigate(preference);
        } catch (error) {
            console.warn('[Theme] beforeNavigate 回调失败:', error);
        }
    }

    const targetUrl = preference && preference.url
        ? themePreferenceController.resolveUrl(preference.url)
        : themePreferenceController.resolveUrl(url);

    if (targetUrl) {
        try {
            window.location.href = targetUrl;
        } catch (error) {
            console.error('[Theme] 跳转主题失败:', error);
        }
    }
}

if (typeof window !== 'undefined') {
    window.navigateToThemePortal = navigateToThemePortal;
}

// Initialize theme switcher when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Restore general theme (e.g., 'blue', 'harry', etc.)
    try {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) applyTheme(savedTheme);
    } catch (e) {}

    // Initialize bloom theme mode (independent dark/light toggle)
    initializeBloomTheme();

    // Initialize blue theme mode if blue is active
    try {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        if (currentTheme === 'blue') {
            const savedBlueMode = localStorage.getItem('blue-theme-mode');
            if (savedBlueMode === 'dark') {
                document.body.classList.add('blue-dark-mode');
            }
        }
    } catch (e) {}

    // Sync switcher buttons on load
    updateBlueThemeButton();
    updateBloomThemeButton();

    // Close modal when clicking outside
    document.addEventListener('click', function(event) {
        const modal = document.getElementById('theme-switcher-modal');
        if (modal && modal.classList.contains('show')) {
            if (!modal.contains(event.target) && !event.target.closest('button[onclick="showThemeSwitcherModal()"]')) {
                hideThemeSwitcherModal();
            }
        }
    });

    // Close modal with Escape key
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
            const modal = document.getElementById('theme-switcher-modal');
            if (modal && modal.classList.contains('show')) {
                hideThemeSwitcherModal();
            }
        }
    });
});
