/**
 * 练习记录详情弹窗组件
 * 用于显示单个练习记录的详细信息
 */
class PracticeRecordModal {
    constructor() {
        this.modalId = 'practice-record-modal';
        this.isVisible = false;

        // 全局引用，供事件委托使用
        window.practiceRecordModal = this;
    }

    /**
     * 显示练习记录详情
     */
    show(record) {
        try {
            // 使用数据一致性管理器确保数据完整性
            let processedRecord = record;
            if (window.DataConsistencyManager) {
                const manager = new DataConsistencyManager();
                processedRecord = manager.ensureConsistency(record);
                console.log('[PracticeRecordModal] 数据一致性检查完成');
            }
            
            // 创建弹窗HTML
            const modalHtml = this.createModalHtml(processedRecord);
            
            // 移除已存在的弹窗
            this.hide();
            
            // 添加到页面
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            
            // 设置事件监听器
            this.setupEventListeners();
            
            // 显示弹窗
            this.isVisible = true;
            
            // 添加显示动画
            setTimeout(() => {
                const modal = document.getElementById(this.modalId);
                if (modal) {
                    modal.classList.add('show');
                }
            }, 10);
            
        } catch (error) {
            console.error('显示练习记录详情失败:', error);
            if (window.showMessage) {
                window.showMessage('无法显示练习记录详情', 'error');
            }
        }
    }

    /**
     * 隐藏弹窗
     */
    hide() {
        const existingModal = document.getElementById(this.modalId);
        if (existingModal) {
            existingModal.remove();
        }
        this.isVisible = false;
    }

    /**
     * 创建弹窗HTML
     */
    createModalHtml(record) {
        // 兼容：填充缺失的关键字段（不修改原对象）
        const safeTitle = record.title || record.metadata?.examTitle || '未知题目';
        const safeCategory = record.category || record.metadata?.category || 'Unknown';
        const safeFrequency = record.frequency || record.metadata?.frequency || 'unknown';
        const suiteEntries = this.getSuiteEntries(record);
        const displayFrequency = suiteEntries.length > 0
            ? '套题练习'
            : (this.formatFrequencyLabel(safeFrequency) || safeFrequency || '未知频率');
        const startTs = record.startTime || record.date;
        const durationSec = (typeof record.duration === 'number' ? record.duration
                            : (record.realData && typeof record.realData.duration === 'number' ? record.realData.duration
                               : (startTs && record.endTime ? Math.max(0, Math.floor((new Date(record.endTime) - new Date(startTs)) / 1000)) : 0)));
        const scoreNum = (typeof record.score === 'number') ? record.score
                        : (typeof record.correctAnswers === 'number') ? record.correctAnswers
                        : (record.scoreInfo && typeof record.scoreInfo.correct === 'number' ? record.scoreInfo.correct
                           : (record.realData && record.realData.scoreInfo && typeof record.realData.scoreInfo.correct === 'number' ? record.realData.scoreInfo.correct : 0));
        const totalQ = (typeof record.totalQuestions === 'number') ? record.totalQuestions
                       : (record.scoreInfo && typeof record.scoreInfo.total === 'number' ? record.scoreInfo.total
                          : (record.realData && record.realData.scoreInfo && typeof record.realData.scoreInfo.total === 'number' ? record.realData.scoreInfo.total
                             : (record.answers ? Object.keys(record.answers).length
                                : (record.realData && record.realData.answers ? Object.keys(record.realData.answers).length : 0))));

        // 格式化时间
        const formattedDate = new Date(startTs).toLocaleString();
        const formattedDuration = this.formatDuration(durationSec);
        
        // 生成答题详情表格
        const answerTable = this.generateAnswerTable(record);
        
        return `
            <div id="${this.modalId}" class="modal-overlay">
                <div class="modal-container">
                    <div class="modal-header">
                        <h3 class="modal-title">练习记录详情</h3>
                        <button class="modal-close" onclick="window.practiceRecordModal.hide()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    
                    <div class="modal-body">
                        <div class="record-summary">
                            <h4>${safeCategory}-${displayFrequency}-${safeTitle}</h4>
                            <div class="record-meta">
                                <div class="meta-item">
                                    <span class="meta-label">练习时间:</span>
                                    <span class="meta-value">${formattedDate}</span>
                                </div>
                                <div class="meta-item">
                                    <span class="meta-label">用时:</span>
                                    <span class="meta-value">${formattedDuration}</span>
                                </div>
                                <div class="meta-item">
                                    <span class="meta-label">分数:</span>
                                    <span class="meta-value score-highlight">${scoreNum}/${totalQ}</span>
                                </div>
                                <div class="meta-item">
                                    <span class="meta-label">准确率:</span>
                                    <span class="meta-value">${Math.round((record.accuracy || 0) * 100)}%</span>
                                </div>
                            </div>
                        </div>
                        
                        <div class="answer-details">
                            <h5>答题详情</h5>
                            ${answerTable}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 生成答题详情表格
     */
    generateAnswerTable(record) {
        const suiteEntries = this.getSuiteEntries(record);

        if (suiteEntries.length > 0) {
            const sections = suiteEntries.map((entry, index) => {
                const title = this.formatSuiteEntryTitle(entry, index);
                const table = this.generateAnswerTableForSingle(entry);
                return `
                    <section class="suite-entry">
                        <h5>${title}</h5>
                        ${table}
                    </section>
                `;
            }).join('');

            return sections || '<p class="no-details">暂无详细答题数据</p>';
        }

        return this.generateAnswerTableForSingle(record);
    }

    generateAnswerTableForSingle(record) {
        if (!record) {
            return '<p class="no-details">暂无详细答题数据</p>';
        }

        if (record.answerComparison && Object.keys(record.answerComparison).length > 0) {
            const merged = this.mergeComparisonWithCorrections(record);
            return this.generateTableFromComparison(merged);
        }

        if (!record.realData || !record.realData.answers) {
            if (!record.answers) {
                return '<p class="no-details">暂无详细答题数据</p>';
            }
        }

        const answers = record.answers || record.realData?.answers || {};
        const correctAnswers = this.getCorrectAnswers(record);
        const questionNumbers = this.extractQuestionNumbers(answers, correctAnswers);

        if (questionNumbers.length === 0) {
            return '<p class="no-details">暂无答题数据</p>';
        }

        let table = `
            <div class="answer-table-container">
                <table class="answer-table">
                    <thead>
                        <tr>
                            <th>Question</th>
                            <th>Your Answer</th>
                            <th>Correct Answer</th>
                            <th>Result</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        questionNumbers.forEach(qNum => {
            const userAnswer = this.getUserAnswer(answers, qNum);
            const correctAnswer = this.getCorrectAnswer(correctAnswers, qNum);
            const isCorrect = this.compareAnswers(userAnswer, correctAnswer);
            const result = isCorrect ? '✓' : '✗';
            const resultClass = isCorrect ? 'correct' : 'incorrect';

            const truncateAnswer = (answer, maxLength = 50) => {
                if (!answer) return 'No Answer';
                if (answer.length <= maxLength) return answer;
                return answer.substring(0, maxLength) + '...';
            };

            table += `
                <tr class="answer-row ${resultClass}">
                    <td class="question-num">${qNum}</td>
                    <td class="user-answer" title="${userAnswer || ''}">${truncateAnswer(userAnswer)}</td>
                    <td class="correct-answer" title="${correctAnswer || ''}">${truncateAnswer(correctAnswer)}</td>
                    <td class="result ${resultClass}">${result}</td>
                </tr>
            `;
        });

        table += `
                    </tbody>
                </table>
            </div>
        `;

        return table;
    }

    /**
     * 从answerComparison生成表格
     */
    generateTableFromComparison(answerComparison) {
        // 在渲染前进行一次“字母题段 → 数字题号”的合并，避免重复行且补全用户答案
        const normalized = (() => {
            const comp = JSON.parse(JSON.stringify(answerComparison || {}));
            const letterKeys = Object.keys(comp).filter(k => /^q[a-z]$/i.test(k)).sort();
            const numericKeys = Object.keys(comp).filter(k => /q\d+$/i.test(k)).sort((a,b)=> (parseInt(a.replace(/\D/g,''))||0) - (parseInt(b.replace(/\D/g,''))||0));
            if (letterKeys.length === 0 || numericKeys.length === 0) return comp;

            // 尝试在 numericKeys 中找出与 letterKeys 数量相同的连续窗口，用于对齐映射
            let windowStart = -1;
            for (let i=0; i+letterKeys.length-1 < numericKeys.length; i++) {
                const first = parseInt(numericKeys[i].replace(/\D/g,''));
                const last  = parseInt(numericKeys[i+letterKeys.length-1].replace(/\D/g,''));
                if (!isNaN(first) && !isNaN(last) && (last - first + 1) === letterKeys.length) {
                    windowStart = i; break;
                }
            }
            if (windowStart === -1) return comp; // 找不到合理窗口则保持原状

            // 把字母题段的用户答案灌入对应的数字题号，并删除字母键，避免表格重复
            for (let i=0; i<letterKeys.length; i++) {
                const lk = letterKeys[i];
                const nk = numericKeys[windowStart + i];
                if (!nk) continue;
                const lItem = comp[lk] || {};
                const nItem = comp[nk] || {};

                // 优先保留数字题号上的正确答案；若缺失再用字母题段的数据
                const correctAnswer = (nItem.correctAnswer != null && String(nItem.correctAnswer).trim() !== '')
                    ? nItem.correctAnswer
                    : lItem.correctAnswer;
                // 用户答案：若数字题号缺失，则取字母题段的答案（例如 Q1..Q8 显示 i/ii/…）
                const userAnswer = (nItem.userAnswer != null && String(nItem.userAnswer).trim() !== '')
                    ? nItem.userAnswer
                    : lItem.userAnswer;
                const isCorrect = (typeof lItem.isCorrect === 'boolean') ? lItem.isCorrect : nItem.isCorrect;

                comp[nk] = { userAnswer: userAnswer || '', correctAnswer: correctAnswer || '', isCorrect: !!isCorrect };
                delete comp[lk];
            }
            return comp;
        })();

        let table = `
            <div class="answer-table-container">
                <table class="answer-table">
                    <thead>
                        <tr>
                            <th>Question</th>
                            <th>Your Answer</th>
                            <th>Correct Answer</th>
                            <th>Result</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        // 按问题编号排序（若无数字则按字母序）
        const sortedKeys = Object.keys(normalized).sort((a, b) => {
            const na = parseInt(a.replace(/\D/g, ''));
            const nb = parseInt(b.replace(/\D/g, ''));
            if (!isNaN(na) && !isNaN(nb)) return na - nb;
            return a.localeCompare(b);
        });
        
        sortedKeys.forEach(key => {
            const comparison = normalized[key];
            let questionNum = key.replace(/\D/g, '');
            if (!questionNum) {
                questionNum = key.replace(/^q/i, '');
            }
            const result = comparison.isCorrect ? '✓' : '✗';
            const resultClass = comparison.isCorrect ? 'correct' : 'incorrect';
            
            // 截断过长的答案文本
            const truncateAnswer = (answer, maxLength = 50) => {
                if (!answer) return 'No Answer';
                if (answer.length <= maxLength) return answer;
                return answer.substring(0, maxLength) + '...';
            };

            table += `
                <tr class="answer-row ${resultClass}">
                    <td class="question-num">${questionNum}</td>
                    <td class="user-answer" title="${comparison.userAnswer || ''}">${truncateAnswer(comparison.userAnswer)}</td>
                    <td class="correct-answer" title="${comparison.correctAnswer || ''}">${truncateAnswer(comparison.correctAnswer)}</td>
                    <td class="result ${resultClass}">${result}</td>
                </tr>
            `;
        });
        
        table += `
                    </tbody>
                </table>
            </div>
        `;
        
        return table;
    }

    /**
     * 将 answerComparison 与其他来源的正确答案合并，补全缺失 correctAnswer
     */
    mergeComparisonWithCorrections(record) {
        // Deep clone to avoid mutating original
        const comparison = JSON.parse(JSON.stringify(record.answerComparison || {}));
        const sources = [
            record.correctAnswers || {},
            (record.realData && record.realData.correctAnswers) || {},
        ];
        // details sources
        if (record.realData && record.realData.scoreInfo && record.realData.scoreInfo.details) {
            sources.push(Object.fromEntries(Object.entries(record.realData.scoreInfo.details).map(([k,v]) => [k, v && v.correctAnswer])));
        }
        if (record.scoreInfo && record.scoreInfo.details) {
            sources.push(Object.fromEntries(Object.entries(record.scoreInfo.details).map(([k,v]) => [k, v && v.correctAnswer])));
        }

        const getFromSources = (key) => {
            for (const src of sources) {
                if (src && src[key] != null && String(src[key]).trim() !== '') return src[key];
            }
            return null;
        };

        // First pass: fill directly matching keys
        Object.keys(comparison).forEach(key => {
            const item = comparison[key] || {};
            if (item.correctAnswer == null || String(item.correctAnswer).trim() === '') {
                const fixed = getFromSources(key);
                if (fixed != null) item.correctAnswer = fixed;
            }
            if (item.userAnswer == null) item.userAnswer = '';
            if (item.correctAnswer == null) item.correctAnswer = '';
            comparison[key] = item;
        });

        // Second pass: map lettered keys (qa, qb, ...) to numeric groups (e.g., q14..q20)
        const letterKeys = Object.keys(comparison).filter(k => /^q[a-z]$/i.test(k));
        if (letterKeys.length > 0) {
            // Prefer numeric keys present in comparison; if none, gather from sources
            let numericKeys = Object.keys(comparison).filter(k => /q\d+$/i.test(k));
            if (numericKeys.length === 0) {
                for (const src of sources) {
                    if (!src) continue;
                    numericKeys.push(...Object.keys(src).filter(k => /q\d+$/i.test(k)));
                }
                numericKeys = Array.from(new Set(numericKeys));
            }
            // Sort
            letterKeys.sort();
            numericKeys.sort((a,b) => (parseInt(a.replace(/\D/g,''))||0) - (parseInt(b.replace(/\D/g,''))||0));

            // Optionally restrict numericKeys to same count as letterKeys and contiguous range by detecting the first block
            if (numericKeys.length >= letterKeys.length) {
                // Try to find a contiguous window with same length
                let windowStart = 0;
                let bestStart = 0;
                let found = false;
                for (let i=0; i+letterKeys.length-1 < numericKeys.length; i++) {
                    const first = parseInt(numericKeys[i].replace(/\D/g,''));
                    const last = parseInt(numericKeys[i+letterKeys.length-1].replace(/\D/g,''));
                    if (!isNaN(first) && !isNaN(last) && (last - first + 1) === letterKeys.length) {
                        bestStart = i; found = true; break;
                    }
                }
                windowStart = found ? bestStart : 0;
                const slice = numericKeys.slice(windowStart, windowStart + letterKeys.length);
                for (let i=0; i<letterKeys.length; i++) {
                    const lk = letterKeys[i];
                    const nk = slice[i];
                    if (!nk) continue;
                    const item = comparison[lk] || {};
                    if (!item.correctAnswer || String(item.correctAnswer).trim() === '') {
                        // Prefer comparison numeric correctAnswer first
                        const nkItem = comparison[nk];
                        let val = nkItem && nkItem.correctAnswer;
                        if (!val) val = getFromSources(nk);
                        if (val != null) item.correctAnswer = val;
                    }
                    if (item.userAnswer == null) item.userAnswer = '';
                    if (item.correctAnswer == null) item.correctAnswer = '';
                    comparison[lk] = item;
                }
            }
        }
        return comparison;
    }
    /**
     * 格式化持续时间
     */
    formatDuration(seconds) {
        if (!seconds) return '未知';
        
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        
        if (minutes > 0) {
            return `${minutes}分${remainingSeconds}秒`;
        } else {
            return `${seconds}秒`;
        }
    }

    /**
     * 获取正确答案
     */
    getCorrectAnswers(record) {
        // 优先使用顶级的correctAnswers
        if (record.correctAnswers && Object.keys(record.correctAnswers).length > 0) {
            return record.correctAnswers;
        }
        
        // 其次使用realData中的correctAnswers
        if (record.realData && record.realData.correctAnswers && Object.keys(record.realData.correctAnswers).length > 0) {
            return record.realData.correctAnswers;
        }
        
        // 尝试从answerComparison中提取
        if (record.answerComparison) {
            const correctAnswers = {};
            Object.keys(record.answerComparison).forEach(key => {
                const comparison = record.answerComparison[key];
                if (comparison.correctAnswer) {
                    correctAnswers[key] = comparison.correctAnswer;
                }
            });
            if (Object.keys(correctAnswers).length > 0) {
                return correctAnswers;
            }
        }
        
        // 尝试从 scoreInfo 的 details 中获取（优先 realData.scoreInfo，其次顶层 scoreInfo）
        const detailsSources = [];
        if (record.realData && record.realData.scoreInfo && record.realData.scoreInfo.details) {
            detailsSources.push(record.realData.scoreInfo.details);
        }
        if (record.scoreInfo && record.scoreInfo.details) {
            detailsSources.push(record.scoreInfo.details);
        }
        for (const details of detailsSources) {
            const correctAnswers = {};
            Object.keys(details).forEach(key => {
                const detail = details[key];
                if (detail && detail.correctAnswer != null && String(detail.correctAnswer).trim() !== '') {
                    correctAnswers[key] = detail.correctAnswer;
                }
            });
            if (Object.keys(correctAnswers).length > 0) {
                return correctAnswers;
            }
        }
        
        console.warn('[PracticeRecordModal] 未找到正确答案数据，记录ID:', record.id);
        return {};
    }

    /**
     * 提取题目编号
     */
    extractQuestionNumbers(userAnswers, correctAnswers) {
        const allQuestions = new Set();
        
        // 从用户答案中提取
        Object.keys(userAnswers).forEach(key => {
            const num = this.extractNumber(key);
            if (num) allQuestions.add(num);
        });
        
        // 从正确答案中提取
        Object.keys(correctAnswers).forEach(key => {
            const num = this.extractNumber(key);
            if (num) allQuestions.add(num);
        });
        
        return Array.from(allQuestions).sort((a, b) => a - b);
    }

    /**
     * 从键名中提取数字
     */
    extractNumber(key) {
        const match = key.match(/(\d+)/);
        return match ? parseInt(match[1]) : null;
    }

    /**
     * 获取用户答案
     */
    getUserAnswer(answers, questionNum) {
        const possibleKeys = [`q${questionNum}`, `question${questionNum}`, questionNum.toString()];
        
        for (const key of possibleKeys) {
            if (answers[key] !== undefined) {
                const answer = answers[key];
                if (Array.isArray(answer)) {
                    return answer[answer.length - 1]?.value || answer[answer.length - 1];
                }
                return answer;
            }
        }
        
        return null;
    }

    /**
     * 获取正确答案
     */
    getCorrectAnswer(correctAnswers, questionNum) {
        const possibleKeys = [`q${questionNum}`, `question${questionNum}`, questionNum.toString()];
        
        for (const key of possibleKeys) {
            if (correctAnswers[key] !== undefined) {
                return correctAnswers[key];
            }
        }
        
        return null;
    }

    /**
     * 比较答案
     */
    compareAnswers(userAnswer, correctAnswer) {
        if (!userAnswer || !correctAnswer) {
            return false;
        }

        const normalize = (str) => String(str).trim().toLowerCase();
        return normalize(userAnswer) === normalize(correctAnswer);
    }

    getSuiteEntries(record) {
        if (!record || !Array.isArray(record.suiteEntries)) {
            return [];
        }
        return record.suiteEntries.filter(entry => entry);
    }

    formatSuiteEntryTitle(entry, index) {
        if (!entry) {
            return `套题第${index + 1}篇`;
        }
        const metadata = entry.metadata || {};
        return metadata.examTitle
            || entry.title
            || entry.examTitle
            || `套题第${index + 1}篇`;
    }

    formatFrequencyLabel(frequency) {
        const normalized = typeof frequency === 'string'
            ? frequency.toLowerCase()
            : '';

        if (normalized === 'suite') {
            return '套题';
        }

        if (normalized === 'high') {
            return '高频';
        }

        return '次高频';
    }

    /**
      * 导出单个记录
      */
    async exportSingle(recordId) {
        try {
            const practiceRecords = await window.storage.get('practice_records', []);
            const record = practiceRecords.find(r => r.id === recordId);

            if (!record) {
                throw new Error('记录不存在');
            }

            // 使用 MarkdownExporter 导出单个记录
            const exporter = new MarkdownExporter();
            const examIndex = await window.storage.get('exam_index', []);

            // 增强记录信息
            const exam = examIndex.find(e => e.id === record.examId);
            const enhancedRecord = {
                ...record,
                examInfo: exam || {},
                title: exam?.title || record.title || '未知题目',
                category: exam?.category || record.category || 'Unknown',
                frequency: exam?.frequency || record.frequency || 'unknown'
            };
            
            // 生成单个记录的 Markdown
            const markdown = exporter.generateRecordMarkdown(enhancedRecord);
            
            // 下载文件
            const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            
            a.href = url;
            a.download = `practice_record_${recordId}_${new Date().toISOString().split('T')[0]}.md`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            window.showMessage('记录已导出', 'success');
            
        } catch (error) {
            console.error('导出单个记录失败:', error);
            window.showMessage('导出失败: ' + error.message, 'error');
        }
    }

    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        // 使用事件委托替换独立监听器
        if (typeof window.DOM !== 'undefined' && window.DOM.delegate) {
            // 模态框背景点击关闭
            window.DOM.delegate('click', `#${this.modalId}`, function(e) {
                if (e.target === this) {
                    window.practiceRecordModal.hide();
                }
            });

            // ESC键关闭弹窗
            window.DOM.delegate('keydown', document, function(e) {
                if (e.key === 'Escape' && window.practiceRecordModal.isVisible) {
                    window.practiceRecordModal.hide();
                }
            });

            console.log('[PracticeRecordModal] 使用事件委托设置监听器');
        } else {
            // 降级到传统监听器
            const modal = document.getElementById(this.modalId);
            if (!modal) return;

            // 点击背景关闭弹窗
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.hide();
                }
            });

            // ESC键关闭弹窗
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.isVisible) {
                    this.hide();
                }
            });
        }
    }
}

// 创建全局实例
window.practiceRecordModal = new PracticeRecordModal();

// 兼容方法：通过ID显示（用于主应用桥接和历史增强器）
if (!window.practiceRecordModal.showById) {
  window.practiceRecordModal.showById = async function(recordId) {
    try {
      const toIdStr = (v) => v == null ? '' : String(v);
      const targetIdStr = toIdStr(recordId);
      const records = (window.storage ? (await window.storage.get('practice_records', [])) : []) || [];
      let record = records.find(r => r.id === recordId || toIdStr(r.id) === targetIdStr) ||
                   records.find(r => toIdStr(r.sessionId) === targetIdStr);
      if (!record) throw new Error('记录不存在');
      this.show(record);
    } catch (e) {
      console.error('[PracticeRecordModal] showById 失败:', e);
      if (window.showMessage) window.showMessage('无法显示记录详情: ' + e.message, 'error');
    }
  };
}
