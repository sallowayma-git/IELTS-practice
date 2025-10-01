// ExamFilterBar.js - UI component for exam search and type filtering
// Inherits from BaseComponent, handles filter UI only, emits changes via callbacks

class ExamFilterBar extends BaseComponent {
    constructor(stores, container, onFilterChange) {
        super(stores, {
            searchInput: document.querySelector('.search-input'),
            typeFilterButtons: document.getElementById('type-filter-buttons')
        });
        this.container = container;
        this.onFilterChange = onFilterChange; // Callback for parent
        this.currentType = 'all';
        this.searchQuery = '';
        this.checkRequiredElements();
    }

    checkRequiredElements() {
        const required = ['searchInput', 'typeFilterButtons'];
        const missing = required.filter(key => !this.elements[key]);
        if (missing.length > 0) {
            console.warn('[ExamFilterBar] Missing elements:', missing);
            this.createFallbackElements(missing);
        }
    }

    createFallbackElements(missing) {
        if (missing.includes('searchInput')) {
            this.elements.searchInput = document.createElement('input');
            this.elements.searchInput.className = 'search-input';
            this.elements.searchInput.placeholder = '搜索题目...';
            this.container.appendChild(this.elements.searchInput);
        }
        if (missing.includes('typeFilterButtons')) {
            this.elements.typeFilterButtons = document.createElement('div');
            this.elements.typeFilterButtons.id = 'type-filter-buttons';
            this.elements.typeFilterButtons.innerHTML = `
                <button>全部</button>
                <button>阅读</button>
                <button>听力</button>
            `;
            this.container.appendChild(this.elements.typeFilterButtons);
        }
    }

    attach(container) {
        super.attach(container);
        this.render(); // Initial render
    }

    setupEventListeners() {
        if (this.elements.searchInput) {
            let searchTimeout;
            const debouncedSearch = (e) => {
                clearTimeout(searchTimeout);
                this.searchQuery = e.target.value;
                searchTimeout = setTimeout(() => {
                    if (typeof markSearchDebounceStart === 'function') markSearchDebounceStart('ExamFilter');
                    this.onFilterChange({ type: 'search', query: this.searchQuery });
                    if (typeof markSearchDebounceEnd === 'function') markSearchDebounceEnd('ExamFilter');
                }, 300);
            };
            this.addEventListener(this.elements.searchInput, 'input', debouncedSearch);
            this.addEventListener(this.elements.searchInput, 'keyup', (e) => {
                if (e.key === 'Enter') {
                    clearTimeout(searchTimeout);
                    if (typeof markSearchDebounceStart === 'function') markSearchDebounceStart('ExamFilter');
                    this.onFilterChange({ type: 'search', query: this.searchQuery });
                    if (typeof markSearchDebounceEnd === 'function') markSearchDebounceEnd('ExamFilter');
                }
            });
        }

        if (this.elements.typeFilterButtons) {
            const filterHandler = (e) => {
                if (e.target.tagName === 'BUTTON') {
                    const type = this.mapTypeButtonToFilter(e.target.textContent.trim());
                    this.currentType = type;
                    this.updateTypeFilterButtons(e.target);
                    this.onFilterChange({ type: 'filter', filter: type });
                }
            };
            this.addEventListener(this.elements.typeFilterButtons, 'click', filterHandler);
        }

        // Global compatibility
        window.searchExams = (query) => {
            this.searchQuery = query;
            if (this.elements.searchInput) this.elements.searchInput.value = query;
            if (typeof markSearchDebounceStart === 'function') markSearchDebounceStart('ExamFilter');
            this.onFilterChange({ type: 'search', query: this.searchQuery });
            if (typeof markSearchDebounceEnd === 'function') markSearchDebounceEnd('ExamFilter');
        };
    }

    mapTypeButtonToFilter(buttonText) {
        const mapping = { '全部': 'all', '阅读': 'reading', '听力': 'listening' };
        return mapping[buttonText] || 'all';
    }

    updateTypeFilterButtons(activeButton) {
        if (!this.elements.typeFilterButtons) return;
        this.elements.typeFilterButtons.querySelectorAll('button').forEach(btn => {
            btn.classList.remove('active');
        });
        if (activeButton) activeButton.classList.add('active');
    }

    render() {
        if (!this.elements.searchInput) return;
        this.elements.searchInput.value = this.searchQuery;
        // Buttons active state already handled in updateTypeFilterButtons
    }

    // Public API
    setSearch(query) {
        this.searchQuery = query;
        this.render();
        this.onFilterChange({ type: 'search', query });
    }

    setType(type) {
        this.currentType = type;
        this.updateTypeFilterButtons(this.elements.typeFilterButtons?.querySelector(`button:contains(${this.getButtonText(type)})`));
        this.onFilterChange({ type: 'filter', filter: type });
    }

    getButtonText(type) {
        const reverseMapping = { 'all': '全部', 'reading': '阅读', 'listening': '听力' };
        return reverseMapping[type] || '全部';
    }

    clearFilters() {
        this.setSearch('');
        this.setType('all');
    }
}

// Global export
window.ExamFilterBar = ExamFilterBar;

console.log('[ExamFilterBar] Component loaded');