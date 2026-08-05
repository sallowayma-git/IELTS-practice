const themePreferenceController = {
    cache: null,
    ready: null,

    load() {
        return this.cache;
    },

    hydrate() {
        if (!this.ready) {
            this.ready = window.AppData.ready.then(() => window.AppData.preferences.getThemePortal()).then((value) => {
                this.cache = value;
                return value;
            });
        }
        return this.ready;
    },

    async save(payload) {
        if (!payload || typeof payload !== 'object') {
            return this.clear();
        }
        await window.AppData.preferences.setThemePortal(payload);
        this.cache = payload;
        return payload;
    },

    async clear() {
        await window.AppData.preferences.setThemePortal(null);
        this.cache = null;
    },

    recordInternalTheme(themeId = 'default') {
        const snapshot = {
            mode: 'internal',
            theme: themeId,
            updatedAt: Date.now()
        };
        this.save(snapshot).catch((error) => console.warn('[Theme] 保存主题首选项失败:', error));
        return snapshot;
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
        window.AppData.preferences.setTheme(theme).catch((error) => console.warn('[Theme] 保存主题失败:', error));
        themePreferenceController.recordInternalTheme(theme);
    } catch (e) {}
}

function applyDefaultTheme() {
    const root = document.documentElement;
    try {
        root.removeAttribute('data-theme');
        window.AppData.preferences.setTheme('default').catch((error) => console.warn('[Theme] 保存主题失败:', error));
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

async function initializeThemeSwitcher() {
    if (typeof window !== 'undefined' && window.__themeSwitcherInitialized) {
        return;
    }

    if (typeof window !== 'undefined') {
        window.__themeSwitcherInitialized = true;
        window.__syncThemeScrollerButtons = syncThemeScrollerButtons;
    }

    try {
        await window.AppData.ready;
        await themePreferenceController.hydrate();
        const savedTheme = await window.AppData.preferences.getTheme();
        if (savedTheme && savedTheme !== 'default') document.documentElement.setAttribute('data-theme', savedTheme);
        else document.documentElement.removeAttribute('data-theme');
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
