/**
 * AppleAnimations.js
 * Handles scroll-reveal animations and other visual effects for the Apple theme.
 */
class AppleAnimations {
    constructor() {
        this.observerOptions = {
            root: null,
            rootMargin: '0px',
            threshold: 0.1
        };
        this.init();
    }

    init() {
        this.observer = new IntersectionObserver(this.handleIntersect.bind(this), this.observerOptions);
        this.observeElements();

        // Re-observe when view changes
        window.addEventListener('viewChanged', () => {
            setTimeout(() => this.observeElements(), 100);
        });
    }

    observeElements() {
        const elements = document.querySelectorAll('.bento-card, .exam-item, .hero-section > *');
        elements.forEach(el => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(30px)';
            el.style.transition = 'opacity 0.8s cubic-bezier(0.165, 0.84, 0.44, 1), transform 0.8s cubic-bezier(0.165, 0.84, 0.44, 1)';
            this.observer.observe(el);
        });
    }

    handleIntersect(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const el = entry.target;
                // Add a slight delay based on index if possible, or just trigger
                el.style.opacity = '1';
                el.style.transform = 'translateY(0)';
                this.observer.unobserve(el);
            }
        });
    }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    window.appleAnimations = new AppleAnimations();
});
