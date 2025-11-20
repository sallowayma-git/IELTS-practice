/**
 * AppleNav.js
 * Specialized navigation controller for the Apple-style theme.
 * Handles sticky positioning effects and active state management.
 */

(function (global) {
    'use strict';

    class AppleNav {
        constructor() {
            this.nav = document.querySelector('.global-nav');
            this.links = document.querySelectorAll('.nav-item');
            this.init();
        }

        init() {
            if (!this.nav) return;

            // Scroll effect
            window.addEventListener('scroll', () => {
                if (window.scrollY > 10) {
                    this.nav.style.background = 'var(--glass-bg)';
                    this.nav.style.backdropFilter = 'var(--glass-blur)';
                    this.nav.style.webkitBackdropFilter = 'var(--glass-blur)';
                    this.nav.style.borderBottom = '1px solid rgba(0,0,0,0.1)';
                } else {
                    this.nav.style.background = 'rgba(251, 251, 253, 0.8)'; // Initial state
                    this.nav.style.backdropFilter = 'var(--glass-blur)';
                    this.nav.style.webkitBackdropFilter = 'var(--glass-blur)';
                    this.nav.style.borderBottom = '1px solid rgba(0,0,0,0.05)';
                }
            });

            // Active state handling is largely handled by ViewManager, 
            // but we can add extra effects here if needed.
            this.links.forEach(link => {
                link.addEventListener('click', (e) => {
                    // Remove active class from all
                    this.links.forEach(l => l.classList.remove('active'));
                    // Add to clicked
                    e.currentTarget.classList.add('active');
                });
            });

            // Listen for external view changes (e.g. from back button)
            window.addEventListener('viewChanged', (e) => {
                const viewId = e.detail.viewId;
                const navId = viewId.replace('-view', '');
                this.links.forEach(l => {
                    if (l.dataset.view === navId) {
                        l.classList.add('active');
                    } else {
                        l.classList.remove('active');
                    }
                });
            });
        }
    }

    // Initialize on load
    document.addEventListener('DOMContentLoaded', () => {
        new AppleNav();
    });

})(window);
