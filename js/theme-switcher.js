// Theme switching functionality
function showThemeSwitcherModal() {
    const modal = document.getElementById('theme-switcher-modal');
    if (modal) {
        modal.classList.add('show');
        updateBloomThemeButton();
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

    const isDarkMode = document.body.classList.contains('bloom-dark-mode');

    // Remove existing theme classes
    button.classList.remove('btn-bloom-dark', 'btn-bloom-light');

    if (isDarkMode) {
        button.classList.add('btn-bloom-light');
        button.textContent = '明亮';
    } else {
        button.classList.add('btn-bloom-dark');
        button.textContent = '黑暗';
    }
}

// Initialize bloom theme mode on page load
function initializeBloomTheme() {
    const savedMode = localStorage.getItem('bloom-theme-mode');
    if (savedMode === 'dark') {
        document.body.classList.add('bloom-dark-mode');
    }
    updateBloomThemeButton();
}

// Initialize theme switcher when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Initialize bloom theme mode
    initializeBloomTheme();

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