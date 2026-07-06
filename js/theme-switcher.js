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

    recordInternalTheme(themeId = 'default') {
        const snapshot = {
            mode: 'internal',
            theme: themeId,
            updatedAt: Date.now()
        };
        this.save(snapshot);
        return this.load();
    }
};

if (typeof window !== 'undefined') {
    window.__themeSwitcher = themePreferenceController;
}

// Theme switching functionality
function applyTheme(theme) {
    const root = document.documentElement;
    if (!theme) return;
    try {
        root.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        themePreferenceController.recordInternalTheme(theme);
    } catch (e) {}
}

function applyDefaultTheme() {
    const root = document.documentElement;
    try {
        root.removeAttribute('data-theme');
        localStorage.removeItem('theme');
        themePreferenceController.recordInternalTheme('default');
    } catch (e) {}
}

function showThemeSwitcherModal() {
    const modal = document.getElementById('theme-switcher-modal');
    if (modal) {
        modal.classList.add('show');
        if (typeof window !== 'undefined' && typeof window.__syncThemeScrollerButtons === 'function') {
            window.requestAnimationFrame(window.__syncThemeScrollerButtons);
        }
    }
}

function hideThemeSwitcherModal() {
    const modal = document.getElementById('theme-switcher-modal');
    if (modal) {
        modal.classList.remove('show');
    }
}

function syncThemeScrollerButtons() {
    const scroller = document.getElementById('theme-options-scroller');
    const prevButton = document.querySelector('[data-theme-scroll="prev"]');
    const nextButton = document.querySelector('[data-theme-scroll="next"]');

    if (!scroller || !prevButton || !nextButton) {
        return;
    }

    const maxScrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    const canScroll = maxScrollLeft > 8;
    const isAtStart = scroller.scrollLeft <= 8;
    const isAtEnd = scroller.scrollLeft >= maxScrollLeft - 8;

    prevButton.hidden = !canScroll;
    nextButton.hidden = !canScroll;
    prevButton.disabled = !canScroll || isAtStart;
    nextButton.disabled = !canScroll || isAtEnd;
}

function initializeThemeScrollerControls() {
    const scroller = document.getElementById('theme-options-scroller');
    const prevButton = document.querySelector('[data-theme-scroll="prev"]');
    const nextButton = document.querySelector('[data-theme-scroll="next"]');

    if (!scroller || !prevButton || !nextButton) {
        return;
    }

    const scrollStep = function scrollStep() {
        return Math.max(280, Math.round(scroller.clientWidth * 0.72));
    };

    prevButton.addEventListener('click', function() {
        scroller.scrollBy({ left: -scrollStep(), behavior: 'smooth' });
    });

    nextButton.addEventListener('click', function() {
        scroller.scrollBy({ left: scrollStep(), behavior: 'smooth' });
    });

    scroller.addEventListener('scroll', syncThemeScrollerButtons, { passive: true });
    window.addEventListener('resize', syncThemeScrollerButtons);
    syncThemeScrollerButtons();
}

function initializeThemeSwitcher() {
    if (typeof window !== 'undefined' && window.__themeSwitcherInitialized) {
        return;
    }

    if (typeof window !== 'undefined') {
        window.__themeSwitcherInitialized = true;
        window.__syncThemeScrollerButtons = syncThemeScrollerButtons;
    }

    // Restore general theme
    try {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) applyTheme(savedTheme);
    } catch (e) {}

    // Close modal when clicking outside
    document.addEventListener('click', function(event) {
        const modal = document.getElementById('theme-switcher-modal');
        if (modal && modal.classList.contains('show')) {
            if (!modal.contains(event.target) && !event.target.closest('#theme-switcher-btn-entry, [data-index-action="show-theme-switcher"]')) {
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

    initializeThemeScrollerControls();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeThemeSwitcher, { once: true });
} else {
    initializeThemeSwitcher();
}
