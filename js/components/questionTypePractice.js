/**
 * 题型分类练习组件
 * 处理按题型分组的练习模式，包括题型专项成绩跟踪和混合题型练习
 */
class QuestionTypePractice {
    constructor() {
        this.currentQuestionType = null;
        this.mixedModeEnabled = false;
        this.selectedQuestionTypes = new Set();
        this.questionTypeStats = new Map();
        this.initialize();
    }

    /**
     * 初始化题型练习组件
     */
    initialize() {
        console.log('QuestionTypePractice component initialized');
        this.loadQuestionTypeStats();
        this.setupEventListeners();
        this.createQuestionTypePracticeUI();
    }

    /**
     * 加载题型统计数据
     */
    loadQuestionTypeStats() {
        const savedStats = storage.get('question_type_stats', {});
        this.questionTypeStats = new Map(Object.entries(savedStats));
    }

    /**
     * 保存题型统计数据
     */
    saveQuestionTypeStats() {
        const statsObj = Object.fromEntries(this.questionTypeStats);
        storage.set('question_type_stats', statsObj);
    }

    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        document.addEventListener('click', (e) => {
            // 题型练习模式选择
            const questionTypeBtn = e.target.closest('[data-question-type]');
            if (questionTypeBtn) {
                const questionType = questionTypeBtn.dataset.questionType;
                this.startQuestionTypePractice(questionType);
            }

            // 混合练习模式
            const mixedPracticeBtn = e.target.closest('.start-mixed-practice');
            if (mixedPracticeBtn) {
                this.startMixedPractice();
            }

            // 题型选择（混合模式）
            const typeCheckbox = e.target.closest('.question-type-checkbox');
            if (typeCheckbox) {
                const checkbox = typeCheckbox.querySelector('input[type="checkbox"]');
                const questionType = checkbox.value;
                
                if (checkbox.checked) {
                    this.selectedQuestionTypes.add(questionType);
                } else {
                    this.selectedQuestionTypes.delete(questionType);
                }
                
                this.updateMixedPracticeButton();
            }

            // 题型详情查看
            const detailsBtn = e.target.closest('.view-question-type-details');
            if (detailsBtn) {
                const questionType = detailsBtn.dataset.questionType;
                this.showQuestionTypeDetails(questionType);
            }
        });

        // 监听练习完成事件
        document.addEventListener('practiceSessionCompleted', (event) => {
            const { examId, practiceRecord } = event.detail;
            this.updateQuestionTypeStats(examId, practiceRecord);
        });
    }

    /**
     * 创建题型练习UI
     */
    createQuestionTypePracticeUI() {
        // 在专项练习页面添加题型练习区域
        this.addQuestionTypePracticeSection();
        
        // 创建题型练习页面
        this.createQuestionTypePracticePage();
    }

    /**
     * 在专项练习页面添加题型练习区域
     */
    addQuestionTypePracticeSection() {
        const specializedView = document.getElementById('specialized-practice-view');
        if (!specializedView) return;

        // 检查是否已存在
        if (specializedView.querySelector('.question-type-practice-section')) return;

        const questionTypeSection = document.createElement('div');
        questionTypeSection.className = 'question-type-practice-section';
        questionTypeSection.innerHTML = `
            <div class="section-header">
                <h3>题型专项练习</h3>
                <p>按题型分类练习，针对性提升</p>
            </div>
            <div class="question-types-overview">
                <div class="question-types-grid" id="question-types-grid">
                    <!-- 题型网格将在这里动态生成 -->
                </div>
            </div>
            <div class="mixed-practice-section">
                <h4>混合题型练习</h4>
                <p>选择多个题型进行综合练习</p>
                <div class="question-type-selector" id="question-type-selector">
                    <!-- 题型选择器将在这里动态生成 -->
                </div>
                <button class="btn btn-primary start-mixed-practice" disabled>
                    开始混合练习 (<span id="selected-types-count">0</span> 个题型)
                </button>
            </div>
        `;

        // 插入到专项练习内容中
        const practiceContent = specializedView.querySelector('.specialized-practice-content');
        if (practiceContent) {
            practiceContent.appendChild(questionTypeSection);
        }

        // 更新题型数据
        this.updateQuestionTypesDisplay();
    }

    /**
     * 创建题型练习页面
     */
    createQuestionTypePracticePage() {
        const mainContent = document.querySelector('.main-content .container');
        if (!mainContent) return;

        // 检查是否已存在
        if (document.getElementById('question-type-practice-view')) return;

        const questionTypeView = document.createElement('section');
        questionTypeView.id = 'question-type-practice-view';
        questionTypeView.className = 'view';
        questionTypeView.innerHTML = `
            <div class="question-type-practice-header">
                <button class="btn btn-back" id="back-to-specialized-practice">← 返回专项练习</button>
                <h2 id="question-type-practice-title">题型练习</h2>
                <div class="practice-mode-toggle">
                    <button class="mode-btn active" data-mode="single">单一题型</button>
                    <button class="mode-btn" data-mode="mixed">混合题型</button>
                </div>
            </div>
            
            <div class="question-type-practice-content">
                <div class="current-type-info" id="current-type-info">
                    <!-- 当前题型信息 -->
                </div>
                
                <div class="type-practice-stats">
                    <div class="stats-grid">
                        <div class="stat-card">
                            <h4>练习次数</h4>
                            <span class="stat-number" id="type-practice-count">0</span>
                        </div>
                        <div class="stat-card">
                            <h4>平均正确率</h4>
                            <span class="stat-number" id="type-average-accuracy">0%</span>
                        </div>
                        <div class="stat-card">
                            <h4>最佳成绩</h4>
                            <span class="stat-number" id="type-best-score">0%</span>
                        </div>
                        <div class="stat-card">
                            <h4>薄弱指数</h4>
                            <span class="stat-number" id="type-weakness-index">0</span>
                        </div>
                    </div>
                </div>
                
                <div class="type-practice-exams" id="type-practice-exams">
                    <!-- 题型相关题目列表 -->
                </div>
                
                <div class="type-practice-recommendations" id="type-practice-recommendations">
                    <!-- 练习建议 -->
                </div>
            </div>
        `;

        mainContent.appendChild(questionTypeView);

        // 设置返回按钮事件
        const backBtn = questionTypeView.querySelector('#back-to-specialized-practice');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                if (window.app && typeof window.app.navigateToView === 'function') {
                    window.app.navigateToView('specialized-practice');
                }
            });
        }

        // 设置模式切换事件
        const modeButtons = questionTypeView.querySelectorAll('.mode-btn');
        modeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                modeButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                const mode = btn.dataset.mode;
                this.mixedModeEnabled = mode === 'mixed';
                this.updateQuestionTypePracticeView();
            });
        });
    }

    /**
     * 更新题型显示
     */
    updateQuestionTypesDisplay() {
        const examIndex = storage.get('exam_index', []);
        const practiceRecords = storage.get('practice_records', []);
        
        // 收集所有题型
        const questionTypes = this.collectQuestionTypes(examIndex);
        
        // 更新题型网格
        this.updateQuestionTypesGrid(questionTypes, examIndex, practiceRecords);
        
        // 更新题型选择器
        this.updateQuestionTypeSelector(questionTypes);
    }

    /**
     * 收集所有题型
     */
    collectQuestionTypes(examIndex) {
        const questionTypesSet = new Set();
        
        examIndex.forEach(exam => {
            if (exam.questionTypes && Array.isArray(exam.questionTypes)) {
                exam.questionTypes.forEach(type => {
                    questionTypesSet.add(type);
                });
            }
        });
        
        return Array.from(questionTypesSet).sort();
    }

    /**
     * 更新题型网格
     */
    updateQuestionTypesGrid(questionTypes, examIndex, practiceRecords) {
        const gridContainer = document.getElementById('question-types-grid');
        if (!gridContainer) return;

        gridContainer.innerHTML = questionTypes.map(questionType => {
            const typeStats = this.calculateQuestionTypeStats(questionType, examIndex, practiceRecords);
            return this.createQuestionTypeCard(questionType, typeStats);
        }).join('');
    }

    /**
     * 计算题型统计
     */
    calculateQuestionTypeStats(questionType, examIndex, practiceRecords) {
        // 找到包含该题型的所有题目
        const typeExams = examIndex.filter(exam => 
            exam.questionTypes && exam.questionTypes.includes(questionType)
        );
        
        // 找到该题型的所有练习记录
        const typeRecords = practiceRecords.filter(record => {
            const exam = examIndex.find(e => e.id === record.examId);
            return exam && exam.questionTypes && exam.questionTypes.includes(questionType);
        });
        
        const totalExams = typeExams.length;
        const practiceCount = typeRecords.length;
        const completedExams = new Set(typeRecords.map(r => r.examId)).size;
        
        const averageAccuracy = typeRecords.length > 0 
            ? typeRecords.reduce((sum, r) => sum + (r.accuracy || 0), 0) / typeRecords.length
            : 0;
            
        const bestScore = typeRecords.length > 0 
            ? Math.max(...typeRecords.map(r => r.accuracy || 0))
            : 0;
            
        const completionRate = totalExams > 0 ? completedExams / totalExams : 0;
        
        // 计算薄弱指数（基于正确率和完成率）
        const weaknessIndex = this.calculateWeaknessIndex(averageAccuracy, completionRate, practiceCount);
        
        return {
            totalExams,
            practiceCount,
            completedExams,
            averageAccuracy,
            bestScore,
            completionRate,
            weaknessIndex
        };
    }

    /**
     * 计算薄弱指数
     */
    calculateWeaknessIndex(averageAccuracy, completionRate, practiceCount) {
        // 薄弱指数 = (1 - 平均正确率) * 0.6 + (1 - 完成率) * 0.3 + (练习不足惩罚) * 0.1
        const accuracyFactor = (1 - averageAccuracy) * 0.6;
        const completionFactor = (1 - completionRate) * 0.3;
        const practiceFactor = practiceCount < 3 ? 0.1 : 0; // 练习次数少于3次有额外惩罚
        
        return Math.round((accuracyFactor + completionFactor + practiceFactor) * 100);
    }

    /**
     * 创建题型卡片
     */
    createQuestionTypeCard(questionType, stats) {
        const typeName = this.formatQuestionTypeName(questionType);
        const difficultyLevel = this.getQuestionTypeDifficulty(stats.weaknessIndex);
        
        return `
            <div class="question-type-card ${difficultyLevel}" data-question-type="${questionType}">
                <div class="type-card-header">
                    <h4 class="type-name">${typeName}</h4>
                    <div class="type-difficulty-badge ${difficultyLevel}">
                        ${this.getDifficultyLabel(difficultyLevel)}
                    </div>
                </div>
                <div class="type-card-body">
                    <div class="type-stats-row">
                        <div class="type-stat">
                            <span class="stat-label">题目数</span>
                            <span class="stat-value">${stats.totalExams}</span>
                        </div>
                        <div class="type-stat">
                            <span class="stat-label">完成率</span>
                            <span class="stat-value">${Math.round(stats.completionRate * 100)}%</span>
                        </div>
                    </div>
                    <div class="type-stats-row">
                        <div class="type-stat">
                            <span class="stat-label">平均正确率</span>
                            <span class="stat-value">${Math.round(stats.averageAccuracy * 100)}%</span>
                        </div>
                        <div class="type-stat">
                            <span class="stat-label">练习次数</span>
                            <span class="stat-value">${stats.practiceCount}</span>
                        </div>
                    </div>
                    <div class="weakness-indicator">
                        <div class="weakness-bar">
                            <div class="weakness-fill" style="width: ${stats.weaknessIndex}%"></div>
                        </div>
                        <span class="weakness-text">薄弱指数: ${stats.weaknessIndex}</span>
                    </div>
                </div>
                <div class="type-card-actions">
                    <button class="btn btn-primary btn-sm" data-question-type="${questionType}">
                        开始练习
                    </button>
                    <button class="btn btn-outline btn-sm view-question-type-details" data-question-type="${questionType}">
                        查看详情
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * 格式化题型名称
     */
    formatQuestionTypeName(type) {
        const typeMap = {
            'heading-matching': '标题匹配',
            'true-false-not-given': '判断题',
            'yes-no-not-given': '是非题',
            'multiple-choice': '选择题',
            'matching-information': '信息匹配',
            'matching-people-ideas': '人物观点匹配',
            'summary-completion': '摘要填空',
            'sentence-completion': '句子填空',
            'short-answer': '简答题',
            'diagram-labelling': '图表标注',
            'flow-chart': '流程图',
            'table-completion': '表格填空'
        };
        return typeMap[type] || type;
    }

    /**
     * 获取题型难度等级
     */
    getQuestionTypeDifficulty(weaknessIndex) {
        if (weaknessIndex >= 70) return 'high-weakness';
        if (weaknessIndex >= 40) return 'medium-weakness';
        return 'low-weakness';
    }

    /**
     * 获取难度标签
     */
    getDifficultyLabel(difficultyLevel) {
        const labels = {
            'high-weakness': '需加强',
            'medium-weakness': '待提升',
            'low-weakness': '良好'
        };
        return labels[difficultyLevel] || '未知';
    }

    /**
     * 更新题型选择器
     */
    updateQuestionTypeSelector(questionTypes) {
        const selectorContainer = document.getElementById('question-type-selector');
        if (!selectorContainer) return;

        selectorContainer.innerHTML = `
            <div class="question-type-checkboxes">
                ${questionTypes.map(questionType => `
                    <label class="question-type-checkbox">
                        <input type="checkbox" value="${questionType}">
                        <span class="checkbox-label">${this.formatQuestionTypeName(questionType)}</span>
                    </label>
                `).join('')}
            </div>
            <div class="selector-actions">
                <button class="btn btn-outline btn-sm select-all-types">全选</button>
                <button class="btn btn-outline btn-sm clear-all-types">清空</button>
                <button class="btn btn-outline btn-sm select-weak-types">选择薄弱题型</button>
            </div>
        `;

        // 设置选择器事件
        const selectAllBtn = selectorContainer.querySelector('.select-all-types');
        const clearAllBtn = selectorContainer.querySelector('.clear-all-types');
        const selectWeakBtn = selectorContainer.querySelector('.select-weak-types');

        if (selectAllBtn) {
            selectAllBtn.addEventListener('click', () => {
                const checkboxes = selectorContainer.querySelectorAll('input[type="checkbox"]');
                checkboxes.forEach(cb => {
                    cb.checked = true;
                    this.selectedQuestionTypes.add(cb.value);
                });
                this.updateMixedPracticeButton();
            });
        }

        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', () => {
                const checkboxes = selectorContainer.querySelectorAll('input[type="checkbox"]');
                checkboxes.forEach(cb => {
                    cb.checked = false;
                });
                this.selectedQuestionTypes.clear();
                this.updateMixedPracticeButton();
            });
        }

        if (selectWeakBtn) {
            selectWeakBtn.addEventListener('click', () => {
                this.selectWeakQuestionTypes();
            });
        }
    }

    /**
     * 选择薄弱题型
     */
    selectWeakQuestionTypes() {
        const examIndex = storage.get('exam_index', []);
        const practiceRecords = storage.get('practice_records', []);
        const questionTypes = this.collectQuestionTypes(examIndex);
        
        // 清空当前选择
        this.selectedQuestionTypes.clear();
        
        // 找出薄弱题型（薄弱指数 >= 50）
        questionTypes.forEach(questionType => {
            const stats = this.calculateQuestionTypeStats(questionType, examIndex, practiceRecords);
            if (stats.weaknessIndex >= 50) {
                this.selectedQuestionTypes.add(questionType);
            }
        });
        
        // 更新复选框状态
        const checkboxes = document.querySelectorAll('#question-type-selector input[type="checkbox"]');
        checkboxes.forEach(cb => {
            cb.checked = this.selectedQuestionTypes.has(cb.value);
        });
        
        this.updateMixedPracticeButton();
    }

    /**
     * 更新混合练习按钮
     */
    updateMixedPracticeButton() {
        const button = document.querySelector('.start-mixed-practice');
        const countSpan = document.getElementById('selected-types-count');
        
        if (button && countSpan) {
            const count = this.selectedQuestionTypes.size;
            countSpan.textContent = count;
            button.disabled = count === 0;
            
            if (count > 0) {
                button.textContent = `开始混合练习 (${count} 个题型)`;
            } else {
                button.innerHTML = `开始混合练习 (<span id="selected-types-count">0</span> 个题型)`;
            }
        }
    }

    /**
     * 开始题型练习
     */
    startQuestionTypePractice(questionType) {
        this.currentQuestionType = questionType;
        this.mixedModeEnabled = false;
        
        // 导航到题型练习页面
        if (window.app && typeof window.app.navigateToView === 'function') {
            window.app.navigateToView('question-type-practice');
        }
        
        // 更新页面内容
        this.updateQuestionTypePracticeView();
    }

    /**
     * 开始混合练习
     */
    startMixedPractice() {
        if (this.selectedQuestionTypes.size === 0) {
            window.showMessage('请至少选择一个题型', 'warning');
            return;
        }
        
        this.mixedModeEnabled = true;
        
        // 导航到题型练习页面
        if (window.app && typeof window.app.navigateToView === 'function') {
            window.app.navigateToView('question-type-practice');
        }
        
        // 更新页面内容
        this.updateQuestionTypePracticeView();
    }

    /**
     * 更新题型练习视图
     */
    updateQuestionTypePracticeView() {
        const titleElement = document.getElementById('question-type-practice-title');
        if (titleElement) {
            if (this.mixedModeEnabled) {
                titleElement.textContent = `混合题型练习 (${this.selectedQuestionTypes.size} 个题型)`;
            } else {
                const typeName = this.formatQuestionTypeName(this.currentQuestionType);
                titleElement.textContent = `${typeName} 专项练习`;
            }
        }
        
        // 更新当前题型信息
        this.updateCurrentTypeInfo();
        
        // 更新统计数据
        this.updateTypePracticeStats();
        
        // 更新题目列表
        this.updateTypePracticeExams();
        
        // 更新练习建议
        this.updateTypePracticeRecommendations();
    }

    /**
     * 更新当前题型信息
     */
    updateCurrentTypeInfo() {
        const infoContainer = document.getElementById('current-type-info');
        if (!infoContainer) return;

        if (this.mixedModeEnabled) {
            const selectedTypes = Array.from(this.selectedQuestionTypes);
            infoContainer.innerHTML = `
                <div class="mixed-type-info">
                    <h3>混合题型练习</h3>
                    <div class="selected-types">
                        ${selectedTypes.map(type => `
                            <span class="selected-type-tag">${this.formatQuestionTypeName(type)}</span>
                        `).join('')}
                    </div>
                    <p>将从选定的题型中随机选择题目进行练习</p>
                </div>
            `;
        } else {
            const typeName = this.formatQuestionTypeName(this.currentQuestionType);
            const typeDescription = this.getQuestionTypeDescription(this.currentQuestionType);
            
            infoContainer.innerHTML = `
                <div class="single-type-info">
                    <h3>${typeName}</h3>
                    <p class="type-description">${typeDescription}</p>
                    <div class="type-tips">
                        <h4>解题技巧</h4>
                        <ul class="tips-list">
                            ${this.getQuestionTypeTips(this.currentQuestionType).map(tip => `
                                <li>${tip}</li>
                            `).join('')}
                        </ul>
                    </div>
                </div>
            `;
        }
    }

    /**
     * 获取题型描述
     */
    getQuestionTypeDescription(questionType) {
        const descriptions = {
            'heading-matching': '将段落与相应的标题进行匹配，考查对文章结构和主旨的理解',
            'true-false-not-given': '根据文章内容判断陈述的真假或是否提及',
            'yes-no-not-given': '根据作者观点判断陈述是否正确或是否提及',
            'multiple-choice': '从多个选项中选择正确答案，考查细节理解和推理能力',
            'matching-information': '将信息与相应的段落进行匹配',
            'matching-people-ideas': '将人物与其观点或理论进行匹配',
            'summary-completion': '完成文章摘要，填入合适的词汇',
            'sentence-completion': '完成句子，填入文章中的原词',
            'short-answer': '用简短的词汇或短语回答问题',
            'diagram-labelling': '为图表、图形标注相应的标签',
            'flow-chart': '完成流程图，填入相应的步骤或要素',
            'table-completion': '完成表格，填入相关信息'
        };
        return descriptions[questionType] || '该题型的详细描述暂未提供';
    }

    /**
     * 获取题型解题技巧
     */
    getQuestionTypeTips(questionType) {
        const tips = {
            'heading-matching': [
                '先读标题，理解每个标题的核心概念',
                '快速浏览段落，抓住主题句',
                '注意段落的逻辑结构和关键词',
                '排除法：先排除明显不符的选项'
            ],
            'true-false-not-given': [
                '仔细区分True/False和Not Given',
                'True：文章明确支持该陈述',
                'False：文章明确反对该陈述',
                'Not Given：文章未提及或信息不足'
            ],
            'multiple-choice': [
                '先读题目，明确要找的信息类型',
                '在文章中定位相关段落',
                '仔细比较选项间的细微差别',
                '注意同义词替换和改写'
            ],
            'summary-completion': [
                '先读摘要，理解整体结构',
                '注意空格前后的语法线索',
                '在原文中寻找对应信息',
                '答案通常是原文中的原词'
            ]
        };
        return tips[questionType] || ['认真阅读题目要求', '仔细分析文章内容', '注意关键词定位', '检查答案的合理性'];
    }

    /**
     * 更新题型练习统计
     */
    updateTypePracticeStats() {
        const examIndex = storage.get('exam_index', []);
        const practiceRecords = storage.get('practice_records', []);
        
        let relevantRecords = [];
        
        if (this.mixedModeEnabled) {
            // 混合模式：统计所有选定题型的记录
            relevantRecords = practiceRecords.filter(record => {
                const exam = examIndex.find(e => e.id === record.examId);
                return exam && exam.questionTypes && 
                       exam.questionTypes.some(type => this.selectedQuestionTypes.has(type));
            });
        } else {
            // 单一题型模式
            relevantRecords = practiceRecords.filter(record => {
                const exam = examIndex.find(e => e.id === record.examId);
                return exam && exam.questionTypes && exam.questionTypes.includes(this.currentQuestionType);
            });
        }
        
        const practiceCount = relevantRecords.length;
        const averageAccuracy = practiceCount > 0 
            ? relevantRecords.reduce((sum, r) => sum + (r.accuracy || 0), 0) / practiceCount
            : 0;
        const bestScore = practiceCount > 0 
            ? Math.max(...relevantRecords.map(r => r.accuracy || 0))
            : 0;
        
        // 计算薄弱指数
        const weaknessIndex = practiceCount > 0 
            ? Math.round((1 - averageAccuracy) * 100)
            : 100;
        
        // 更新UI
        document.getElementById('type-practice-count').textContent = practiceCount;
        document.getElementById('type-average-accuracy').textContent = `${Math.round(averageAccuracy * 100)}%`;
        document.getElementById('type-best-score').textContent = `${Math.round(bestScore * 100)}%`;
        document.getElementById('type-weakness-index').textContent = weaknessIndex;
    }

    /**
     * 更新题型练习题目列表
     */
    updateTypePracticeExams() {
        const examListContainer = document.getElementById('type-practice-exams');
        if (!examListContainer) return;

        const examIndex = storage.get('exam_index', []);
        const practiceRecords = storage.get('practice_records', []);
        
        let relevantExams = [];
        
        if (this.mixedModeEnabled) {
            // 混合模式：包含任一选定题型的题目
            relevantExams = examIndex.filter(exam => 
                exam.questionTypes && 
                exam.questionTypes.some(type => this.selectedQuestionTypes.has(type))
            );
        } else {
            // 单一题型模式
            relevantExams = examIndex.filter(exam => 
                exam.questionTypes && exam.questionTypes.includes(this.currentQuestionType)
            );
        }
        
        if (relevantExams.length === 0) {
            examListContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📝</div>
                    <div class="empty-state-title">暂无相关题目</div>
                    <div class="empty-state-description">当前题型下没有找到题目</div>
                </div>
            `;
            return;
        }
        
        // 按完成状态和薄弱程度排序
        const completedExamIds = new Set(practiceRecords.map(r => r.examId));
        const sortedExams = relevantExams.sort((a, b) => {
            const aCompleted = completedExamIds.has(a.id);
            const bCompleted = completedExamIds.has(b.id);
            
            // 未完成的在前，已完成的在后
            if (aCompleted !== bCompleted) {
                return aCompleted ? 1 : -1;
            }
            
            // 同样完成状态下，按标题排序
            return a.title.localeCompare(b.title);
        });
        
        examListContainer.innerHTML = `
            <h4>相关题目 (${relevantExams.length})</h4>
            <div class="type-exam-grid">
                ${sortedExams.map(exam => this.createTypeExamCard(exam, practiceRecords)).join('')}
            </div>
        `;
    }

    /**
     * 创建题型题目卡片
     */
    createTypeExamCard(exam, practiceRecords) {
        const examRecords = practiceRecords.filter(r => r.examId === exam.id);
        const isCompleted = examRecords.length > 0;
        const bestScore = isCompleted ? Math.max(...examRecords.map(r => r.accuracy || 0)) : 0;
        
        // 高亮匹配的题型
        const matchedTypes = this.mixedModeEnabled 
            ? exam.questionTypes.filter(type => this.selectedQuestionTypes.has(type))
            : exam.questionTypes.filter(type => type === this.currentQuestionType);
        
        return `
            <div class="type-exam-card ${isCompleted ? 'completed' : ''}" data-exam-id="${exam.id}">
                <div class="exam-card-header">
                    <h5 class="exam-title">${exam.title}</h5>
                    <div class="exam-meta">
                        <span class="exam-tag">${exam.category}</span>
                        <span class="exam-tag frequency-${exam.frequency}">
                            ${exam.frequency === 'high' ? '高频' : '次高频'}
                        </span>
                    </div>
                </div>
                <div class="exam-card-body">
                    <div class="matched-question-types">
                        <span class="matched-types-label">匹配题型:</span>
                        ${matchedTypes.map(type => `
                            <span class="matched-type-tag">${this.formatQuestionTypeName(type)}</span>
                        `).join('')}
                    </div>
                    <div class="exam-stats-mini">
                        <div class="stat-mini">
                            <span class="stat-label">练习次数</span>
                            <span class="stat-value">${examRecords.length}</span>
                        </div>
                        <div class="stat-mini">
                            <span class="stat-label">最佳成绩</span>
                            <span class="stat-value">${Math.round(bestScore * 100)}%</span>
                        </div>
                    </div>
                    <div class="exam-actions-mini">
                        <button class="btn btn-primary btn-sm" data-exam-action="practice" data-exam-id="${exam.id}">
                            ${isCompleted ? '再次练习' : '开始练习'}
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 更新练习建议
     */
    updateTypePracticeRecommendations() {
        const recommendationsContainer = document.getElementById('type-practice-recommendations');
        if (!recommendationsContainer) return;

        const examIndex = storage.get('exam_index', []);
        const practiceRecords = storage.get('practice_records', []);
        
        let recommendations = [];
        
        if (this.mixedModeEnabled) {
            recommendations = this.generateMixedPracticeRecommendations();
        } else {
            recommendations = this.generateSingleTypeRecommendations(this.currentQuestionType, examIndex, practiceRecords);
        }
        
        recommendationsContainer.innerHTML = `
            <h4>练习建议</h4>
            <div class="recommendations-list">
                ${recommendations.map(rec => `
                    <div class="recommendation-item ${rec.priority}">
                        <div class="recommendation-icon">${rec.icon}</div>
                        <div class="recommendation-content">
                            <div class="recommendation-title">${rec.title}</div>
                            <div class="recommendation-desc">${rec.description}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    /**
     * 生成单一题型练习建议
     */
    generateSingleTypeRecommendations(questionType, examIndex, practiceRecords) {
        const stats = this.calculateQuestionTypeStats(questionType, examIndex, practiceRecords);
        const recommendations = [];
        
        if (stats.practiceCount === 0) {
            recommendations.push({
                priority: 'high',
                icon: '🎯',
                title: '开始首次练习',
                description: '建议先完成2-3道题目，了解题型特点和解题方法'
            });
        } else if (stats.averageAccuracy < 0.6) {
            recommendations.push({
                priority: 'high',
                icon: '📚',
                title: '加强基础练习',
                description: '正确率偏低，建议重点练习基础题目，掌握解题技巧'
            });
        } else if (stats.averageAccuracy < 0.8) {
            recommendations.push({
                priority: 'medium',
                icon: '⚡',
                title: '提升练习强度',
                description: '基础较好，可以增加练习量，提高解题速度和准确率'
            });
        } else {
            recommendations.push({
                priority: 'low',
                icon: '🏆',
                title: '保持练习状态',
                description: '表现优秀，建议定期练习保持状态，可尝试更有挑战性的题目'
            });
        }
        
        if (stats.completionRate < 0.5) {
            recommendations.push({
                priority: 'medium',
                icon: '📈',
                title: '扩大练习范围',
                description: '建议尝试更多不同的题目，全面掌握该题型'
            });
        }
        
        return recommendations;
    }

    /**
     * 生成混合练习建议
     */
    generateMixedPracticeRecommendations() {
        return [
            {
                priority: 'high',
                icon: '🔄',
                title: '综合能力训练',
                description: '混合练习有助于提高题型转换能力和整体应试水平'
            },
            {
                priority: 'medium',
                icon: '⏱️',
                title: '时间管理练习',
                description: '注意控制每种题型的答题时间，提高时间分配效率'
            },
            {
                priority: 'low',
                icon: '🎯',
                title: '弱项重点关注',
                description: '在混合练习中特别关注薄弱题型的表现'
            }
        ];
    }

    /**
     * 更新题型统计数据
     */
    updateQuestionTypeStats(examId, practiceRecord) {
        const examIndex = storage.get('exam_index', []);
        const exam = examIndex.find(e => e.id === examId);
        
        if (!exam || !exam.questionTypes) return;
        
        // 更新每个题型的统计
        exam.questionTypes.forEach(questionType => {
            if (!this.questionTypeStats.has(questionType)) {
                this.questionTypeStats.set(questionType, {
                    practiceCount: 0,
                    totalAccuracy: 0,
                    bestScore: 0,
                    lastPractice: null
                });
            }
            
            const stats = this.questionTypeStats.get(questionType);
            stats.practiceCount++;
            stats.totalAccuracy += practiceRecord.accuracy || 0;
            stats.bestScore = Math.max(stats.bestScore, practiceRecord.accuracy || 0);
            stats.lastPractice = practiceRecord.startTime;
            
            this.questionTypeStats.set(questionType, stats);
        });
        
        this.saveQuestionTypeStats();
        
        // 更新UI显示
        this.updateQuestionTypesDisplay();
    }

    /**
     * 显示题型详情
     */
    showQuestionTypeDetails(questionType) {
        const examIndex = storage.get('exam_index', []);
        const practiceRecords = storage.get('practice_records', []);
        const stats = this.calculateQuestionTypeStats(questionType, examIndex, practiceRecords);
        const typeName = this.formatQuestionTypeName(questionType);
        
        const detailsContent = `
            <div class="question-type-details-modal">
                <div class="details-header">
                    <h3>${typeName} 详细统计</h3>
                    <button class="close-modal" onclick="this.closest('.modal-overlay').remove()">×</button>
                </div>
                <div class="details-body">
                    <div class="stats-overview">
                        <div class="stat-item-large">
                            <span class="stat-label">总题目数</span>
                            <span class="stat-value">${stats.totalExams}</span>
                        </div>
                        <div class="stat-item-large">
                            <span class="stat-label">已完成</span>
                            <span class="stat-value">${stats.completedExams}</span>
                        </div>
                        <div class="stat-item-large">
                            <span class="stat-label">练习次数</span>
                            <span class="stat-value">${stats.practiceCount}</span>
                        </div>
                        <div class="stat-item-large">
                            <span class="stat-label">平均正确率</span>
                            <span class="stat-value">${Math.round(stats.averageAccuracy * 100)}%</span>
                        </div>
                    </div>
                    <div class="progress-visualization">
                        <h4>完成进度</h4>
                        <div class="progress-bar-large">
                            <div class="progress-fill-large" style="width: ${stats.completionRate * 100}%"></div>
                        </div>
                        <span class="progress-text-large">${Math.round(stats.completionRate * 100)}% 完成</span>
                    </div>
                    <div class="weakness-analysis">
                        <h4>薄弱程度分析</h4>
                        <div class="weakness-meter">
                            <div class="weakness-scale">
                                <div class="weakness-indicator" style="left: ${stats.weaknessIndex}%"></div>
                            </div>
                            <div class="weakness-labels">
                                <span>优秀</span>
                                <span>良好</span>
                                <span>待提升</span>
                                <span>需加强</span>
                            </div>
                        </div>
                        <p class="weakness-description">
                            ${this.getWeaknessDescription(stats.weaknessIndex)}
                        </p>
                    </div>
                </div>
                <div class="details-footer">
                    <button class="btn btn-primary" onclick="window.app.components.questionTypePractice.startQuestionTypePractice('${questionType}')">
                        开始练习
                    </button>
                    <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">
                        关闭
                    </button>
                </div>
            </div>
        `;
        
        this.showModal(detailsContent);
    }

    /**
     * 获取薄弱程度描述
     */
    getWeaknessDescription(weaknessIndex) {
        if (weaknessIndex >= 70) {
            return '该题型是您的薄弱环节，建议加强基础练习，掌握解题方法。';
        } else if (weaknessIndex >= 40) {
            return '该题型有提升空间，建议增加练习量，提高熟练度。';
        } else if (weaknessIndex >= 20) {
            return '该题型掌握良好，建议保持练习频率，巩固技能。';
        } else {
            return '该题型表现优秀，可以作为优势项目，适当减少练习时间。';
        }
    }

    /**
     * 显示模态框
     */
    showModal(content) {
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'modal-overlay show';
        modalOverlay.innerHTML = `<div class="modal">${content}</div>`;
        
        document.body.appendChild(modalOverlay);
        
        // 点击背景关闭
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                modalOverlay.remove();
            }
        });
    }

    /**
     * 销毁组件
     */
    destroy() {
        // 清理事件监听器
        // 这里可以添加具体的清理逻辑
    }
}

// 确保组件在全局可用
window.QuestionTypePractice = QuestionTypePractice;