// ExamList.js - UI component for rendering exam list and cards
// Inherits from BaseComponent, renders filtered exams, emits actions via callbacks

class ExamList extends BaseComponent {
    constructor(stores, container, onExamAction) {
        super(stores, {
            container: document.getElementById('exam-list-container')
        });
        this.container = container;
        this.onExamAction = onExamAction; // Callback for start/view actions
        this.exams = [];
        this.checkRequiredElements();
    }

    checkRequiredElements() {
        if (!this.elements.container) {
            console.warn('[ExamList] Missing container');
            this.elements.container = document.createElement('div');
            this.elements.container.id = 'exam-list-container';
            this.container.appendChild(this.elements.container);
        }
    }

    attach(container) {
        super.attach(container);
    }

    setupEventListeners() {
        // Listeners added dynamically in render for idempotency
    }

    render(exams = this.exams) {
        this.exams = exams;
        if (!this.elements.container) return;

        try {
            this.updateBrowseTitle(exams.length);
            if (exams.length === 0) {
                this.renderEmptyState();
                return;
            }
            this.renderExamList(exams);
        } catch (error) {
            console.error('[ExamList] Render error:', error);
            this.renderError(error.message);
        }
    }

    updateBrowseTitle(count) {
        // Assume browseTitle is in parent or global; fallback create
        let titleEl = document.getElementById('browse-title');
        if (!titleEl) {
            titleEl = document.createElement('h2');
            titleEl.id = 'browse-title';
            this.elements.container.parentNode.insertBefore(titleEl, this.elements.container);
        }
        let title = '📚 题库浏览';
        if (count > 0) title += ` (${count}题)`;
        titleEl.textContent = title;
    }

    renderExamList(exams) {
        const groupedExams = this.groupExamsByCategory(exams);
        let html = '';

        Object.keys(groupedExams).forEach(category => {
            const categoryExams = groupedExams[category];
            html += `
                <div class="category-section">
                    <h3 class="category-title">${category} (${categoryExams.length}题)</h3>
                    <div class="exam-grid">
            `;
            categoryExams.forEach(exam => {
                html += this.renderExamCard(exam);
            });
            html += `
                    </div>
                </div>
            `;
        });

        this.elements.container.innerHTML = html;
        this.setupExamCardListeners();
    }

    groupExamsByCategory(exams) {
        const grouped = {};
        exams.forEach(exam => {
            const category = exam.category || 'Unknown';
            if (!grouped[category]) grouped[category] = [];
            grouped[category].push(exam);
        });

        const sortedGrouped = {};
        const categoryOrder = ['P1', 'P2', 'P3', 'P4', 'Unknown'];
        categoryOrder.forEach(category => {
            if (grouped[category]) sortedGrouped[category] = grouped[category];
        });
        return sortedGrouped;
    }

    renderExamCard(exam) {
        const examPath = this.stores.exams.getExamPath(exam);
        const hasValidPath = examPath && exam.hasHtml !== false;
        const hasPdf = exam.hasPdf;

        return `
            <div class="exam-card" data-exam-id="${exam.id}">
                <div class="exam-header">
                    <span class="exam-category">${exam.category || 'Unknown'}</span>
                    <span class="exam-type">${this.getTypeIcon(exam.type)} ${exam.type || 'reading'}</span>
                </div>
                <h4 class="exam-title">${this.escapeHtml(exam.title)}</h4>
                <div class="exam-meta">
                    ${exam.difficulty ? `<span class="difficulty ${exam.difficulty}">${this.getDifficultyText(exam.difficulty)}</span>` : ''}
                    ${exam.topics && exam.topics.length > 0 ? `<div class="topics">${exam.topics.map(topic => `<span class="topic">${this.escapeHtml(topic)}</span>`).join('')}</div>` : ''}
                </div>
                <div class="exam-actions">
                    ${hasValidPath ? `
                        <button class="btn btn-primary start-practice-btn" data-exam-id="${exam.id}">
                            📝 开始练习
                        </button>
                    ` : `
                        <button class="btn btn-disabled" disabled>
                            ❌ 文件缺失
                        </button>
                    `}
                    ${hasPdf ? `
                        <button class="btn btn-secondary view-pdf-btn" data-exam-id="${exam.id}">
                            📄 查看PDF
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }

    getTypeIcon(type) {
        const icons = { 'reading': '📖', 'listening': '🎧' };
        return icons[type] || '📖';
    }

    getDifficultyText(difficulty) {
        const texts = { 'easy': '简单', 'medium': '中等', 'hard': '困难' };
        return texts[difficulty] || difficulty;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    setupExamCardListeners() {
        const startBtns = this.elements.container.querySelectorAll('.start-practice-btn');
        startBtns.forEach(btn => {
            const handler = (e) => {
                const examId = e.target.getAttribute('data-exam-id');
                this.onExamAction('start', examId);
            };
            this.addEventListener(btn, 'click', handler);
        });

        const pdfBtns = this.elements.container.querySelectorAll('.view-pdf-btn');
        pdfBtns.forEach(btn => {
            const handler = (e) => {
                const examId = e.target.getAttribute('data-exam-id');
                this.onExamAction('pdf', examId);
            };
            this.addEventListener(btn, 'click', handler);
        });
    }

    renderEmptyState() {
        this.elements.container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📚</div>
                <h3>暂无题目</h3>
                <button class="btn btn-secondary" onclick="window.searchExams('');">
                    清除筛选
                </button>
            </div>
        `;
    }

    renderError(message) {
        this.elements.container.innerHTML = `
            <div class="error-state">
                <div class="error-icon">❌</div>
                <h3>加载失败</h3>
                <p>${this.escapeHtml(message)}</p>
                <button class="btn btn-primary" onclick="window.location.reload();">
                    刷新页面
                </button>
            </div>
        `;
    }

    // Public API
    setExams(exams) {
        this.render(exams);
    }

    clear() {
        this.elements.container.innerHTML = '';
    }
}

// Global export
window.ExamList = ExamList;

console.log('[ExamList] Component loaded');