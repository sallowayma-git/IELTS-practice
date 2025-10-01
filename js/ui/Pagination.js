// Pagination.js - Simple UI component for exam list pagination
// Inherits from BaseComponent, renders pagination controls

class Pagination extends BaseComponent {
    constructor(stores, container, onPageChange) {
        super(stores);
        this.container = container;
        this.onPageChange = onPageChange;
        this.currentPage = 1;
        this.totalItems = 0;
        this.pageSize = 20; // Default
        this.elements = { pagination: document.getElementById('exam-pagination') };
        this.checkRequiredElements();
    }

    checkRequiredElements() {
        if (!this.elements.pagination) {
            this.elements.pagination = document.createElement('div');
            this.elements.pagination.id = 'exam-pagination';
            this.container.appendChild(this.elements.pagination);
        }
    }

    attach(container) {
        super.attach(container);
    }

    setupEventListeners() {
        // Dynamic listeners in render
    }

    render(totalItems = this.totalItems, currentPage = this.currentPage) {
        this.totalItems = totalItems;
        this.currentPage = currentPage;
        if (!this.elements.pagination) return;

        const totalPages = Math.ceil(totalItems / this.pageSize);
        if (totalPages <= 1) {
            this.elements.pagination.innerHTML = '';
            return;
        }

        let html = '<div class="pagination">';
        // Previous button
        html += `<button class="btn btn-secondary ${currentPage === 1 ? 'disabled' : ''}" ${currentPage === 1 ? 'disabled' : ''} onclick="${currentPage > 1 ? `this.parentElement.parentElement.dispatchEvent(new CustomEvent('pageChange', {detail: {page: ${currentPage - 1}}}))` : ''}">上一页</button>`;

        // Page numbers (simple: first, current, last)
        if (totalPages > 3) {
            html += `<button class="btn btn-outline" onclick="...1">1</button> <span>...</span>`;
        }
        for (let i = Math.max(1, currentPage - 1); i <= Math.min(totalPages, currentPage + 1); i++) {
            html += `<button class="btn ${i === currentPage ? 'btn-primary' : 'btn-outline'}" ${i === currentPage ? 'disabled' : ''} onclick="${i !== currentPage ? `this.parentElement.parentElement.dispatchEvent(new CustomEvent('pageChange', {detail: {page: ${i}}}))` : ''}">${i}</button>`;
        }
        if (totalPages > 3) {
            html += `<span>...</span> <button class="btn btn-outline" onclick="...${totalPages}">${totalPages}</button>`;
        }

        // Next button
        html += `<button class="btn btn-secondary ${currentPage === totalPages ? 'disabled' : ''}" ${currentPage === totalPages ? 'disabled' : ''} onclick="${currentPage < totalPages ? `this.parentElement.parentElement.dispatchEvent(new CustomEvent('pageChange', {detail: {page: ${currentPage + 1}}}))` : ''}">下一页</button>`;
        html += ` <span class="pagination-info">第 ${currentPage} 页 / 共 ${totalPages} 页 (${totalItems} 题)</span></div>`;

        this.elements.pagination.innerHTML = html;

        // Setup event listener for page change
        this.elements.pagination.addEventListener('pageChange', (e) => {
            this.onPageChange(e.detail.page);
        });
    }

    // Public API
    setPage(page) {
        this.currentPage = page;
        this.render();
    }

    setTotal(total) {
        this.totalItems = total;
        this.render();
    }
}

// Global export
window.Pagination = Pagination;

console.log('[Pagination] Component loaded');