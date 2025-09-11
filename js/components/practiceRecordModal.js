/**
 * 练习记录详情弹窗组件
 * 用于显示单个练习记录的详细信息
 */
class PracticeRecordModal {
    constructor() {
        this.modalId = 'practice-record-modal';
        this.isVisible = false;
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
        const { title, category, frequency, score, totalQuestions, startTime, duration } = record;
        
        // 格式化时间
        const formattedDate = new Date(startTime || record.date).toLocaleString();
        const formattedDuration = this.formatDuration(duration);
        
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
                            <h4>${category}-${frequency}-${title}</h4>
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
                                    <span class="meta-value score-highlight">${score}/${totalQuestions}</span>
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
                    
                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="window.practiceRecordModal.exportSingle('${record.id}')">
                            <i class="fas fa-download"></i> 导出此记录
                        </button>
                        <button class="btn btn-primary" onclick="window.practiceRecordModal.hide()">
                            关闭
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 生成答题详情表格
     */
    generateAnswerTable(record) {
        // 优先使用answerComparison数据
        if (record.answerComparison && Object.keys(record.answerComparison).length > 0) {
            return this.generateTableFromComparison(record.answerComparison);
        }
        
        // 降级到原有逻辑
        if (!record.realData || !record.realData.answers) {
            if (!record.answers) {
                return '<p class="no-details">暂无详细答题数据</p>';
            }
        }

        const answers = record.answers || record.realData?.answers || {};
        const correctAnswers = this.getCorrectAnswers(record);
        
        // 获取所有题目编号并排序
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
            
            table += `
                <tr class="answer-row ${resultClass}">
                    <td class="question-num">${qNum}</td>
                    <td class="user-answer">${userAnswer || 'No Answer'}</td>
                    <td class="correct-answer">${correctAnswer || 'N/A'}</td>
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
        
        // 按问题编号排序
        const sortedKeys = Object.keys(answerComparison).sort((a, b) => {
            const numA = parseInt(a.replace(/\D/g, '')) || 0;
            const numB = parseInt(b.replace(/\D/g, '')) || 0;
            return numA - numB;
        });
        
        sortedKeys.forEach(key => {
            const comparison = answerComparison[key];
            const questionNum = key.replace(/\D/g, '');
            const result = comparison.isCorrect ? '✓' : '✗';
            const resultClass = comparison.isCorrect ? 'correct' : 'incorrect';
            
            table += `
                <tr class="answer-row ${resultClass}">
                    <td class="question-num">${questionNum}</td>
                    <td class="user-answer">${comparison.userAnswer || 'No Answer'}</td>
                    <td class="correct-answer">${comparison.correctAnswer || 'N/A'}</td>
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
        
        // 尝试从 scoreInfo 的 details 中获取
        if (record.realData && record.realData.scoreInfo && record.realData.scoreInfo.details) {
            const correctAnswers = {};
            Object.keys(record.realData.scoreInfo.details).forEach(key => {
                const detail = record.realData.scoreInfo.details[key];
                if (detail.correctAnswer) {
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

    /**
     * 导出单个记录
     */
    exportSingle(recordId) {
        try {
            const practiceRecords = window.storage.get('practice_records', []);
            const record = practiceRecords.find(r => r.id === recordId);
            
            if (!record) {
                throw new Error('记录不存在');
            }
            
            // 使用 MarkdownExporter 导出单个记录
            const exporter = new MarkdownExporter();
            const examIndex = window.storage.get('exam_index', []);
            
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

// 创建全局实例
window.practiceRecordModal = new PracticeRecordModal();