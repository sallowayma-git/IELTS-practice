// RecordStats.js - UI component for displaying practice statistics
// Inherits from BaseComponent, renders stats from RecordStore

class RecordStats extends BaseComponent {
    constructor(stores, container) {
        super(stores, {
            totalPracticed: document.getElementById('total-practiced'),
            avgScore: document.getElementById('avg-score'),
            studyTime: document.getElementById('study-time'),
            streakDays: document.getElementById('streak-days')
        });
        this.container = container;
        this.checkRequiredElements();
    }

    checkRequiredElements() {
        const required = ['totalPracticed', 'avgScore', 'studyTime', 'streakDays'];
        const missing = required.filter(key => !this.elements[key]);
        if (missing.length > 0) {
            console.warn('[RecordStats] Missing elements:', missing);
            this.createFallbackElements(missing);
        }
    }

    createFallbackElements(missing) {
        missing.forEach(key => {
            if (!this.elements[key]) {
                this.elements[key] = document.createElement('span');
                this.elements[key].id = key;
                this.container.appendChild(this.elements[key]);
            }
        });
    }

    attach(container) {
        super.attach(container);
        this.render();
    }

    setupEventListeners() {
        // No events needed for stats display
    }

    render() {
        const stats = this.stores.records.stats || {};

        if (this.elements.totalPracticed) {
            this.elements.totalPracticed.textContent = stats.totalPracticed || 0;
        }

        if (this.elements.avgScore) {
            this.elements.avgScore.textContent = `${(stats.averageScore || 0).toFixed(1)}%`;
        }

        if (this.elements.studyTime) {
            const minutes = Math.round((stats.studyTime || 0) / 60000); // Convert ms to minutes
            this.elements.studyTime.textContent = minutes;
        }

        if (this.elements.streakDays) {
            this.elements.streakDays.textContent = stats.streakDays || 0;
        }
    }

    // Public API
    refresh() {
        this.render();
    }
}

// Global export
window.RecordStats = RecordStats;

console.log('[RecordStats] Component loaded');