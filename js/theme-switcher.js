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
