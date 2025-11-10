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
                    const normalizedEntries = this.getNormalizedEntries(entryRecord);
                    let content = '';

                    if (this.hasNormalizedEntries(normalizedEntries)) {
                        content = this.renderAnswersSection(normalizedEntries, { wrap: false });
                    } else {
                        content = this.generateLegacyAnswerTableForSingle(entryRecord);
                    }

                    if (!content || !String(content).trim()) {
                        content = '<div class="no-answers-message"><p>\u6682\u65e0\u8be6\u7ec6\u7b54\u9898\u6570\u636e</p></div>';
                    }

                    return `
                        <section class="suite-entry">
                            <h5>${this.escapeHtml(title)}</h5>
                            ${content}
                        </section>
                    `;
                })
                .filter(Boolean)
                .join('');

            if (sections && sections.trim()) {
                return sections;
            }

            return this.generateLegacyAnswerTableForSingle(preparedRecord);
        }

        const normalizedEntries = this.getNormalizedEntries(preparedRecord);
        if (this.hasNormalizedEntries(normalizedEntries)) {
            return this.renderAnswersSection(normalizedEntries, { wrap: true });
        }

        return this.generateLegacyAnswerTableForSingle(preparedRecord);
    }

    getNormalizedEntries(record) {
        if (window.AnswerComparisonUtils && typeof window.AnswerComparisonUtils.getNormalizedEntries === 'function') {
            const entries = window.AnswerComparisonUtils.getNormalizedEntries(record);
            return Array.isArray(entries) ? entries : [];
        }
        return [];
    }

    hasNormalizedEntries(entries) {
        return Array.isArray(entries) && entries.length > 0;
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

    generateLegacyAnswerTableForSingle(record) {
        if (!record) {
            return '<div class="no-answers-message"><p>\u6682\u65e0\u7b54\u9898\u6570\u636e</p></div>';
        }

        if (record.answerComparison && Object.keys(record.answerComparison).length > 0) {
            const merged = this.mergeComparisonWithCorrections(record);
            return this.generateLegacyTableFromComparison(merged);
        }

        const answers = record.answers || (record.realData && record.realData.answers) || {};
        const correctAnswers = this.getLegacyCorrectAnswers(record);
        const questionNumbers = this.extractLegacyQuestionNumbers(answers, correctAnswers);

        if (questionNumbers.length === 0) {
            return '<div class="no-answers-message"><p>\u6682\u65e0\u7b54\u9898\u6570\u636e</p></div>';
        }

        const rows = questionNumbers
            .map((questionNumber) => {
                const userAnswer = this.getLegacyUserAnswer(answers, questionNumber);
                const correctAnswer = this.getLegacyCorrectAnswer(correctAnswers, questionNumber);
                const isCorrect = this.compareLegacyAnswers(userAnswer, correctAnswer);
                const resultClass = isCorrect ? 'correct' : 'incorrect';
                const resultIcon = isCorrect ? '&#10003;' : '&#10005;';
                const safeUser = userAnswer != null ? this.truncateAnswer(userAnswer) : '\u672a\u4f5c\u7b54';
                const safeCorrect = correctAnswer != null ? this.truncateAnswer(correctAnswer) : '\u65e0';

                return `
                    <tr class="answer-row ${resultClass}">
                        <td class="question-num">${this.escapeHtml(String(questionNumber))}</td>
                        <td class="correct-answer" title="${this.escapeHtml(correctAnswer == null ? '' : String(correctAnswer))}">
                            ${this.escapeHtml(safeCorrect)}
                        </td>
                        <td class="user-answer" title="${this.escapeHtml(userAnswer == null ? '' : String(userAnswer))}">
                            ${this.escapeHtml(safeUser)}
                        </td>
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

    generateLegacyTableFromComparison(answerComparison) {
        if (!answerComparison || Object.keys(answerComparison).length === 0) {
            return '<div class="no-answers-message"><p>\u6682\u65e0\u7b54\u9898\u6570\u636e</p></div>';
        }

        const cloneDeep = (data) => JSON.parse(JSON.stringify(data || {}));
        const normalized = (() => {
            const comp = cloneDeep(answerComparison);
            const letterKeys = Object.keys(comp).filter(key => /^q[a-z]$/i.test(key)).sort();
            const numericKeys = Object.keys(comp)
                .filter(key => /q\d+$/i.test(key))
                .sort((a, b) => {
                    const numA = parseInt(a.replace(/\D/g, ''), 10);
                    const numB = parseInt(b.replace(/\D/g, ''), 10);
                    return numA - numB;
                });

            if (letterKeys.length === 0 || numericKeys.length === 0) {
                return comp;
            }

            let windowStart = -1;
            for (let i = 0; i + letterKeys.length - 1 < numericKeys.length; i += 1) {
                const first = parseInt(numericKeys[i].replace(/\D/g, ''), 10);
                const last = parseInt(numericKeys[i + letterKeys.length - 1].replace(/\D/g, ''), 10);
                if (!Number.isNaN(first) && !Number.isNaN(last) && (last - first + 1) === letterKeys.length) {
                    windowStart = i;
                    break;
                }
            }
            if (windowStart === -1) {
                return comp;
            }

            for (let i = 0; i < letterKeys.length; i += 1) {
                const letterKey = letterKeys[i];
                const numericKey = numericKeys[windowStart + i];
                if (!numericKey) {
                    continue;
                }

                const letterEntry = comp[letterKey] || {};
                const numericEntry = comp[numericKey] || {};

                const mergedCorrect = (numericEntry.correctAnswer != null && String(numericEntry.correctAnswer).trim() !== '')
                    ? numericEntry.correctAnswer
                    : letterEntry.correctAnswer;
                const mergedUser = (numericEntry.userAnswer != null && String(numericEntry.userAnswer).trim() !== '')
                    ? numericEntry.userAnswer
                    : letterEntry.userAnswer;
                const mergedIsCorrect = typeof letterEntry.isCorrect === 'boolean'
                    ? letterEntry.isCorrect
                    : numericEntry.isCorrect;

                comp[numericKey] = {
                    correctAnswer: mergedCorrect || '',
                    userAnswer: mergedUser || '',
                    isCorrect: Boolean(mergedIsCorrect)
                };
                delete comp[letterKey];
            }

            return comp;
        })();

        const sortedKeys = Object.keys(normalized).sort((a, b) => {
            const numA = parseInt(a.replace(/\D/g, ''), 10);
            const numB = parseInt(b.replace(/\D/g, ''), 10);
            if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
                return numA - numB;
            }
            return a.localeCompare(b);
        });

        const rows = sortedKeys
            .map((key) => {
                const comparison = normalized[key] || {};
                const questionLabel = key.replace(/^q/i, '');
                const isCorrect = comparison.isCorrect === true;
                const resultClass = isCorrect ? 'correct' : 'incorrect';
                const resultIcon = isCorrect ? '&#10003;' : '&#10005;';

                const userDisplay = comparison.userAnswer != null
                    ? this.truncateAnswer(comparison.userAnswer)
                    : '\u672a\u4f5c\u7b54';
                const correctDisplay = comparison.correctAnswer != null
                    ? this.truncateAnswer(comparison.correctAnswer)
                    : '\u65e0';

                return `
                    <tr class="answer-row ${resultClass}">
                        <td class="question-num">${this.escapeHtml(questionLabel)}</td>
                        <td class="correct-answer" title="${this.escapeHtml(comparison.correctAnswer == null ? '' : String(comparison.correctAnswer))}">
                            ${this.escapeHtml(correctDisplay)}
                        </td>
                        <td class="user-answer" title="${this.escapeHtml(comparison.userAnswer == null ? '' : String(comparison.userAnswer))}">
                            ${this.escapeHtml(userDisplay)}
                        </td>
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

    mergeComparisonWithCorrections(record) {
        const comparison = JSON.parse(JSON.stringify(record.answerComparison || {}));
        const sources = [
            record.correctAnswers || {},
            record.realData && record.realData.correctAnswers,
            (record.realData && record.realData.scoreInfo && record.realData.scoreInfo.details)
                ? Object.fromEntries(Object.entries(record.realData.scoreInfo.details).map(([key, detail]) => [key, detail && detail.correctAnswer]))
                : null,
            (record.scoreInfo && record.scoreInfo.details)
                ? Object.fromEntries(Object.entries(record.scoreInfo.details).map(([key, detail]) => [key, detail && detail.correctAnswer]))
                : null
        ].filter(Boolean);

        const getFromSources = (key) => {
            for (const source of sources) {
                if (source && source[key] != null && String(source[key]).trim() !== '') {
                    return source[key];
                }
            }
            return null;
        };

        Object.keys(comparison).forEach((key) => {
            const item = comparison[key] || {};
            if (item.correctAnswer == null || String(item.correctAnswer).trim() === '') {
                const fixed = getFromSources(key);
                if (fixed != null) {
                    item.correctAnswer = fixed;
                }
            }
            if (item.userAnswer == null) {
                item.userAnswer = '';
            }
            if (item.correctAnswer == null) {
                item.correctAnswer = '';
            }
            comparison[key] = item;
        });

        const letterKeys = Object.keys(comparison).filter(key => /^q[a-z]$/i.test(key));
        if (letterKeys.length > 0) {
            let numericKeys = Object.keys(comparison).filter(key => /q\d+$/i.test(key));
            if (numericKeys.length === 0) {
                sources.forEach((source) => {
                    if (!source) {
                        return;
                    }
                    Object.keys(source).forEach((key) => {
                        if (/q\d+$/i.test(key)) {
                            numericKeys.push(key);
                        }
                    });
                });
                numericKeys = Array.from(new Set(numericKeys));
            }
            letterKeys.sort();
            numericKeys.sort((a, b) => (parseInt(a.replace(/\D/g, ''), 10) || 0) - (parseInt(b.replace(/\D/g, ''), 10) || 0));

            if (numericKeys.length >= letterKeys.length) {
                let windowStart = 0;
                let found = false;
                for (let i = 0; i + letterKeys.length - 1 < numericKeys.length; i += 1) {
                    const first = parseInt(numericKeys[i].replace(/\D/g, ''), 10);
                    const last = parseInt(numericKeys[i + letterKeys.length - 1].replace(/\D/g, ''), 10);
                    if (!Number.isNaN(first) && !Number.isNaN(last) && (last - first + 1) === letterKeys.length) {
                        windowStart = i;
                        found = true;
                        break;
                    }
                }
                const slice = numericKeys.slice(windowStart, windowStart + letterKeys.length);
                if (found && slice.length === letterKeys.length) {
                    for (let i = 0; i < letterKeys.length; i += 1) {
                        const letterKey = letterKeys[i];
                        const numericKey = slice[i];
                        if (!numericKey) {
                            continue;
                        }
                        const item = comparison[letterKey] || {};
                        if (!item.correctAnswer || String(item.correctAnswer).trim() === '') {
                            const numericItem = comparison[numericKey];
                            let value = numericItem && numericItem.correctAnswer;
                            if (!value) {
                                value = getFromSources(numericKey);
                            }
                            if (value != null) {
                                item.correctAnswer = value;
                            }
                        }
                        if (item.userAnswer == null) {
                            item.userAnswer = '';
                        }
                        if (item.correctAnswer == null) {
                            item.correctAnswer = '';
                        }
                        comparison[letterKey] = item;
                    }
                }
            }
        }

        return comparison;
    }

    getLegacyCorrectAnswers(record) {
        if (record.correctAnswers && Object.keys(record.correctAnswers).length > 0) {
            return record.correctAnswers;
        }

        if (record.realData && record.realData.correctAnswers && Object.keys(record.realData.correctAnswers).length > 0) {
            return record.realData.correctAnswers;
        }

        if (record.answerComparison) {
            const extracted = {};
            Object.keys(record.answerComparison).forEach((key) => {
                const comparison = record.answerComparison[key];
                if (comparison && comparison.correctAnswer) {
                    extracted[key] = comparison.correctAnswer;
                }
            });
            if (Object.keys(extracted).length > 0) {
                return extracted;
            }
        }

        const detailSources = [];
        if (record.realData && record.realData.scoreInfo && record.realData.scoreInfo.details) {
            detailSources.push(record.realData.scoreInfo.details);
        }
        if (record.scoreInfo && record.scoreInfo.details) {
            detailSources.push(record.scoreInfo.details);
        }
        for (const details of detailSources) {
            const extracted = {};
            Object.keys(details || {}).forEach((key) => {
                const detail = details[key];
                if (detail && detail.correctAnswer != null && String(detail.correctAnswer).trim() !== '') {
                    extracted[key] = detail.correctAnswer;
                }
            });
            if (Object.keys(extracted).length > 0) {
                return extracted;
            }
        }

        return {};
    }

    extractLegacyQuestionNumbers(userAnswers, correctAnswers) {
        const allQuestions = new Set();

        Object.keys(userAnswers || {}).forEach((key) => {
            const num = this.extractLegacyNumber(key);
            if (num != null) {
                allQuestions.add(num);
            }
        });

        Object.keys(correctAnswers || {}).forEach((key) => {
            const num = this.extractLegacyNumber(key);
            if (num != null) {
                allQuestions.add(num);
            }
        });

        return Array.from(allQuestions).sort((a, b) => a - b);
    }

    extractLegacyNumber(key) {
        const match = typeof key === 'string' ? key.match(/(\d+)/) : null;
        if (!match) {
            return null;
        }
        const parsed = parseInt(match[1], 10);
        return Number.isNaN(parsed) ? null : parsed;
    }

    getLegacyUserAnswer(answers, questionNumber) {
        const possibleKeys = [`q${questionNumber}`, `question${questionNumber}`, String(questionNumber)];
        for (const key of possibleKeys) {
            if (Object.prototype.hasOwnProperty.call(answers, key)) {
                const answer = answers[key];
                if (Array.isArray(answer) && answer.length > 0) {
                    const lastItem = answer[answer.length - 1];
                    if (lastItem && typeof lastItem === 'object' && lastItem.value != null) {
                        return lastItem.value;
                    }
                    return lastItem;
                }
                return answer;
            }
        }
        return null;
    }

    getLegacyCorrectAnswer(correctAnswers, questionNumber) {
        const possibleKeys = [`q${questionNumber}`, `question${questionNumber}`, String(questionNumber)];
        for (const key of possibleKeys) {
            if (Object.prototype.hasOwnProperty.call(correctAnswers, key)) {
                return correctAnswers[key];
            }
        }
        return null;
    }

    compareLegacyAnswers(userAnswer, correctAnswer) {
        if (userAnswer == null || correctAnswer == null) {
            return false;
        }
        const normalize = (value) => String(value).trim().toLowerCase();
        return normalize(userAnswer) === normalize(correctAnswer);
    }

    truncateAnswer(value, maxLength = 50) {
        if (value == null) {
            return '';
        }
        const str = String(value);
        if (str.length <= maxLength) {
            return str;
        }
        return `${str.substring(0, maxLength)}...`;
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
