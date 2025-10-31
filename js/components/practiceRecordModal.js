class PracticeRecordModal {
    constructor() {
        this.modalId = 'practice-record-modal';
        this.isVisible = false;
        this.modalElement = null;
        this.boundBackdropHandler = null;
        this.boundEscHandler = null;

        window.practiceRecordModal = this;
    }

    show(record) {
        try {
            let processedRecord = record;

            if (window.DataConsistencyManager) {
                const manager = new DataConsistencyManager();
                processedRecord = manager.ensureConsistency(record);
                console.log('[PracticeRecordModal] \u6570\u636e\u4e00\u81f4\u6027\u68c0\u67e5\u5b8c\u6210');
            }

            processedRecord = this.prepareRecordForDisplay(processedRecord);

            const modalHtml = this.createModalHtml(processedRecord);

            this.hide();
            document.body.insertAdjacentHTML('beforeend', modalHtml);

            this.modalElement = document.getElementById(this.modalId);
            this.setupEventListeners(this.modalElement);
            this.isVisible = true;

            setTimeout(() => {
                if (this.modalElement) {
                    this.modalElement.classList.add('show');
                }
            }, 10);
        } catch (error) {
            console.error('[PracticeRecordModal] \u663e\u793a\u5931\u8d25:', error);
            if (typeof window.showMessage === 'function') {
                window.showMessage('\u65e0\u6cd5\u663e\u793a\u7ec3\u4e60\u8bb0\u5f55', 'error');
            }
        }
    }

    hide() {
        this.teardownEventListeners();

        if (this.modalElement && this.modalElement.parentNode) {
            this.modalElement.parentNode.removeChild(this.modalElement);
        }

        this.modalElement = null;
        this.isVisible = false;
    }

    teardownEventListeners() {
        if (this.modalElement && this.boundBackdropHandler) {
            this.modalElement.removeEventListener('click', this.boundBackdropHandler);
        }

        if (this.boundEscHandler) {
            document.removeEventListener('keydown', this.boundEscHandler);
        }

        this.boundBackdropHandler = null;
        this.boundEscHandler = null;
    }

    setupEventListeners(modal) {
        if (!modal) {
            return;
        }

        const closeModal = () => this.hide();

        this.boundBackdropHandler = (event) => {
            if (event.target === modal) {
                closeModal();
            }
        };
        modal.addEventListener('click', this.boundBackdropHandler);

        const closeButton = modal.querySelector('.modal-close');
        if (closeButton) {
            closeButton.addEventListener('click', closeModal, { once: true });
        }

        this.boundEscHandler = (event) => {
            if (event.key === 'Escape') {
                closeModal();
            }
        };
        document.addEventListener('keydown', this.boundEscHandler);
    }

    createModalHtml(record) {
        const metadata = record.metadata || {};
        const examTitle = metadata.examTitle || record.title || record.examId || '\u672a\u77e5\u9898\u76ee';
        const category = record.category || metadata.category || '\u672a\u77e5\u5206\u7c7b';
        const frequencyLabel = this.getFrequencyLabel(record);
        const startTimestamp = record.startTime || record.date;
        const formattedStart = this.formatDate(startTimestamp);
        const durationSeconds = this.resolveDuration(record);
        const formattedDuration = this.formatDuration(durationSeconds);
        const score = this.resolveScore(record);
        const accuracy = this.resolveAccuracy(record);
        const accuracyPercent = accuracy != null ? Math.round(accuracy * 100) : null;
        const summaryCounts = this.getEntriesSummary(this.collectAllEntries(record));
        const incorrectCount = summaryCounts.incorrect || 0;
        const unansweredCount = summaryCounts.unanswered || 0;

        const answerSection = this.generateAnswerTable(record);

        return `
            <div id="${this.modalId}" class="modal-overlay">
                <div class="modal-container">
                    <div class="modal-header">
                        <h3 class="modal-title">\u7ec3\u4e60\u8bb0\u5f55\u8be6\u60c5</h3>
                        <button class="modal-close" aria-label="\u5173\u95ed\u5f39\u7a97">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body">
                        <div class="record-summary">
                            <h4>${this.escapeHtml(category)} - ${this.escapeHtml(frequencyLabel)} - ${this.escapeHtml(examTitle)}</h4>
                            <div class="record-meta">
                                <div class="meta-item">
                                    <span class="meta-label">\u7ec3\u4e60\u65f6\u95f4\uff1a</span>
                                    <span class="meta-value">${this.escapeHtml(formattedStart)}</span>
                                </div>
                                <div class="meta-item">
                                    <span class="meta-label">\u7528\u65f6\uff1a</span>
                                    <span class="meta-value">${this.escapeHtml(formattedDuration)}</span>
                                </div>
                                <div class="meta-item">
                                    <span class="meta-label">\u5f97\u5206\uff1a</span>
                                    <span class="meta-value score-highlight">${this.escapeHtml(score)}</span>
                                </div>
                                <div class="meta-item">
                                    <span class="meta-label">\u51c6\u786e\u7387\uff1a</span>
                                    <span class="meta-value">${accuracyPercent != null ? `${accuracyPercent}%` : '\u672a\u77e5'}</span>
                                </div>
                                <div class="meta-item">
                                    <span class="meta-label">\u9519\u9898\u6570\uff1a</span>
                                    <span class="meta-value error-count">${incorrectCount}</span>
                                </div>
                                <div class="meta-item">
                                    <span class="meta-label">\u672a\u4f5c\u7b54\uff1a</span>
                                    <span class="meta-value unanswered-count">${unansweredCount}</span>
                                </div>
                            </div>
                        </div>
                        <div class="answer-details">
                            <h5>\u7b54\u9898\u8be6\u60c5</h5>
                            ${answerSection}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    prepareRecordForDisplay(record) {
        if (!record) {
            return record;
        }
        if (window.AnswerComparisonUtils && typeof window.AnswerComparisonUtils.withEnrichedMetadata === 'function') {
            return window.AnswerComparisonUtils.withEnrichedMetadata(record);
        }
        return record;
    }

    getFrequencyLabel(record) {
        const metadata = record.metadata || {};
        const frequency = record.frequency || metadata.frequency || 'unknown';
        const suiteEntries = this.getSuiteEntries(record);

        if (suiteEntries.length > 0) {
            return '\u5957\u9898\u7ec3\u4e60';
        }
        return this.formatFrequencyLabel(frequency);
    }

    resolveDuration(record) {
        if (typeof record.duration === 'number') {
            return record.duration;
        }
        if (record.realData && typeof record.realData.duration === 'number') {
            return record.realData.duration;
        }
        if (record.startTime && record.endTime) {
            const start = new Date(record.startTime);
            const end = new Date(record.endTime);
            const diff = Math.floor((end - start) / 1000);
            return Number.isFinite(diff) && diff > 0 ? diff : null;
        }
        return null;
    }

    resolveScore(record) {
        if (typeof record.correctAnswers === 'number' && typeof record.totalQuestions === 'number') {
            return `${record.correctAnswers}/${record.totalQuestions}`;
        }
        if (record.scoreInfo && typeof record.scoreInfo.correct === 'number' && typeof record.scoreInfo.total === 'number') {
            return `${record.scoreInfo.correct}/${record.scoreInfo.total}`;
        }
        if (record.realData && record.realData.scoreInfo && typeof record.realData.scoreInfo.correct === 'number' && typeof record.realData.scoreInfo.total === 'number') {
            return `${record.realData.scoreInfo.correct}/${record.realData.scoreInfo.total}`;
        }
        if (typeof record.score === 'number' && typeof record.total === 'number') {
            return `${record.score}/${record.total}`;
        }
        return '\u672a\u77e5';
    }

    resolveAccuracy(record) {
        if (typeof record.accuracy === 'number') {
            return record.accuracy;
        }
        if (record.scoreInfo && typeof record.scoreInfo.accuracy === 'number') {
            return record.scoreInfo.accuracy;
        }
        if (record.realData && record.realData.scoreInfo && typeof record.realData.scoreInfo.accuracy === 'number') {
            return record.realData.scoreInfo.accuracy;
        }
        return null;
    }

    formatDate(value, format = 'YYYY-MM-DD HH:mm:ss') {
        if (!value) {
            return '\u672a\u77e5';
        }
        try {
            if (window.Utils && typeof window.Utils.formatDate === 'function') {
                return Utils.formatDate(value, format);
            }
            const parsed = new Date(value);
            if (!Number.isNaN(parsed.getTime())) {
                return parsed.toLocaleString();
            }
        } catch (error) {
            console.warn('[PracticeRecordModal] \u65e5\u671f\u683c\u5f0f\u5316\u5931\u8d25:', error);
        }
        return '\u672a\u77e5';
    }

    formatDuration(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) {
            return '\u672a\u77e5';
        }
        const mins = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        if (mins > 0) {
            return `${mins}\u5206${remainingSeconds}\u79d2`;
        }
        return `${remainingSeconds}\u79d2`;
    }

    getSuiteEntries(record) {
        if (!record || !Array.isArray(record.suiteEntries)) {
            return [];
        }
        return record.suiteEntries.filter(Boolean);
    }

    formatSuiteEntryTitle(entry, index) {
        if (!entry) {
            return `\u5957\u9898\u7b2c${index + 1}\u7bc7`;
        }
        const metadata = entry.metadata || {};
        return metadata.examTitle || entry.title || entry.examTitle || `\u5957\u9898\u7b2c${index + 1}\u7bc7`;
    }

    formatFrequencyLabel(frequency) {
        const normalized = typeof frequency === 'string' ? frequency.trim().toLowerCase() : '';
        if (normalized === 'suite') {
            return '\u5957\u9898\u7ec3\u4e60';
        }
        if (normalized === 'high') {
            return '\u9ad8\u9891';
        }
        if (normalized === 'mid' || normalized === 'medium') {
            return '\u4e2d\u9891';
        }
        if (normalized === 'low') {
            return '\u4f4e\u9891';
        }
        return '\u672a\u77e5\u9891\u7387';
    }

    generateAnswerTable(record) {
        const preparedRecord = this.prepareRecordForDisplay(record);
        const suiteEntries = this.getSuiteEntries(preparedRecord);

        if (suiteEntries.length > 0) {
            const sections = suiteEntries
                .map((entry, index) => {
                    const entryRecord = this.prepareRecordForDisplay(entry);
                    const title = this.formatSuiteEntryTitle(entryRecord, index);
                    const content = this.renderAnswersSection(this.getNormalizedEntries(entryRecord), { wrap: false });
                    return `
                        <section class="suite-entry">
                            <h5>${this.escapeHtml(title)}</h5>
                            ${content}
                        </section>
                    `;
                })
                .join('');

            return sections || '<div class="no-answers-message"><p>\u6682\u65e0\u8be6\u7ec6\u7b54\u9898\u6570\u636e</p></div>';
        }

        return this.renderAnswersSection(this.getNormalizedEntries(preparedRecord), { wrap: true });
    }

    getNormalizedEntries(record) {
        if (window.AnswerComparisonUtils && typeof window.AnswerComparisonUtils.getNormalizedEntries === 'function') {
            const entries = window.AnswerComparisonUtils.getNormalizedEntries(record);
            return Array.isArray(entries) ? entries : [];
        }
        return [];
    }

    collectAllEntries(record) {
        const utils = window.AnswerComparisonUtils;
        if (!utils || !record) {
            return [];
        }

        let entries = utils.getNormalizedEntries(record) || [];
        const suites = this.getSuiteEntries(record);

        if (Array.isArray(suites) && suites.length > 0) {
            suites.forEach((entry) => {
                const subset = utils.getNormalizedEntries(entry) || [];
                if (subset.length > 0) {
                    entries = entries.concat(subset);
                }
            });
        }

        return entries;
    }

    getEntriesSummary(entries) {
        if (window.AnswerComparisonUtils && typeof window.AnswerComparisonUtils.summariseEntries === 'function') {
            return window.AnswerComparisonUtils.summariseEntries(entries);
        }
        const total = entries.length;
        const unanswered = entries.filter(entry => !entry.hasUserAnswer).length;
        const correct = entries.filter(entry => entry.isCorrect === true).length;
        const incorrect = entries.filter(entry => entry.isCorrect === false).length;
        return { total, correct, incorrect, unanswered };
    }

    renderAnswersSection(entries, options = {}) {
        const normalizedEntries = Array.isArray(entries) ? entries : [];
        if (normalizedEntries.length === 0) {
            return '<div class="no-answers-message"><p>\u6682\u65e0\u7b54\u9898\u6570\u636e</p></div>';
        }

        const tableHtml = this.renderEntriesTable(normalizedEntries);

        if (options.wrap === false) {
            return tableHtml;
        }

        return `
            <div class="answers-section">
                ${tableHtml}
            </div>
        `;
    }

    renderEntriesSummary() {
        return '';
    }

    renderEntriesTable(entries) {
        if (!Array.isArray(entries) || entries.length === 0) {
            return '<div class="answers-table-container"><p class="no-details">\u6682\u65e0\u7b54\u9898\u6570\u636e</p></div>';
        }

        const rows = entries
            .map((entry) => {
                const questionLabel = this.escapeHtml(entry.displayNumber || '');
                const userDisplay = this.escapeHtml(entry.userAnswer || '\u672a\u4f5c\u7b54');
                const correctDisplay = this.escapeHtml(entry.correctAnswer || '\u65e0');

                let resultIcon = '\u2753';
                let resultClass = 'unknown';

                if (entry.isCorrect === true) {
                    resultIcon = '\u2705';
                    resultClass = 'correct';
                } else if (entry.isCorrect === false) {
                    resultIcon = '\u274c';
                    resultClass = 'incorrect';
                }

                return `
                    <tr class="answer-row ${resultClass}">
                        <td class="question-num">${questionLabel}</td>
                        <td class="correct-answer">${correctDisplay}</td>
                        <td class="user-answer">${userDisplay}</td>
                        <td class="result-icon ${resultClass}">${resultIcon}</td>
                    </tr>
                `;
            })
            .join('');

        return `
            <div class="answers-table-container">
                <table class="answer-table">
                    <thead>
                        <tr>
                            <th>\u9898\u53f7</th>
                            <th>\u6b63\u786e\u7b54\u6848</th>
                            <th>\u6211\u7684\u7b54\u6848</th>
                            <th>\u5bf9\u9519</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
            </div>
        `;
    }

    escapeHtml(value) {
        if (value == null) {
            return '';
        }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    async exportSingle(recordId) {
        try {
            const practiceRecords = await window.storage.get('practice_records', []);
            const record = practiceRecords.find(r => r.id === recordId);

            if (!record) {
                throw new Error('\u8bb0\u5f55\u4e0d\u5b58\u5728');
            }

            const exporter = new MarkdownExporter();
            const examIndex = await window.storage.get('exam_index', []);
            const exam = Array.isArray(examIndex) ? examIndex.find(e => e.id === record.examId) : null;

            const enrichedRecord = this.prepareRecordForDisplay({
                ...record,
                examInfo: exam || {},
                title: exam?.title || record.title || record.examId || '\u672a\u77e5\u9898\u76ee',
                category: exam?.category || record.category || '\u672a\u77e5\u5206\u7c7b',
                frequency: exam?.frequency || record.frequency || '\u672a\u77e5\u9891\u7387'
            });

            const markdown = exporter.generateRecordMarkdown(enrichedRecord);

            const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `practice_record_${recordId}_${new Date().toISOString().split('T')[0]}.md`;
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
            URL.revokeObjectURL(url);

            if (typeof window.showMessage === 'function') {
                window.showMessage('\u7ec3\u4e60\u8bb0\u5f55\u5df2\u5bfc\u51fa', 'success');
            }
        } catch (error) {
            console.error('[PracticeRecordModal] \u5bfc\u51fa\u5931\u8d25:', error);
            if (typeof window.showMessage === 'function') {
                window.showMessage(`\u5bfc\u51fa\u5931\u8d25\uff1a${error.message}`, 'error');
            }
        }
    }
}

window.practiceRecordModal = new PracticeRecordModal();

if (!window.practiceRecordModal.showById) {
    window.practiceRecordModal.showById = async function showById(recordId) {
        try {
            const normalise = (value) => (value == null ? '' : String(value));
            const targetId = normalise(recordId);

            const records = (window.storage ? (await window.storage.get('practice_records', [])) : []) || [];
            let record = records.find(r => normalise(r.id) === targetId) ||
                records.find(r => normalise(r.sessionId) === targetId);

            if (!record) {
                throw new Error('\u8bb0\u5f55\u4e0d\u5b58\u5728');
            }

            this.show(record);
        } catch (error) {
            console.error('[PracticeRecordModal] showById \u5931\u8d25:', error);
            if (typeof window.showMessage === 'function') {
                window.showMessage(`\u65e0\u6cd5\u663e\u793a\u7ec3\u4e60\u8bb0\u5f55\uff1a${error.message}`, 'error');
            }
        }
    };
}