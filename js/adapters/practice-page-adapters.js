/**
 * 练习页面适配器系统
 * 用于适配不同类型和结构的练习页面
 */

/**
 * 基础适配器类
 */
class BasePracticeAdapter {
    constructor(document, window) {
        this.document = document;
        this.window = window;
        this.pageType = 'unknown';
        this.isSupported = false;
    }

    /**
     * 检测页面是否支持此适配器
     */
    detect() {
        return false;
    }

    /**
     * 获取答题元素
     */
    getAnswerElements() {
        return [];
    }

    /**
     * 提取用户答案
     */
    extractAnswers() {
        return {};
    }

    /**
     * 获取分数信息
     */
    getScoreInfo() {
        return null;
    }

    /**
     * 获取题目总数
     */
    getTotalQuestions() {
        return 0;
    }

    /**
     * 设置答题监听器
     */
    setupListeners(callback) {
        // 子类实现
    }
}

/**
 * IELTS阅读标准页面适配器
 */
class IELTSReadingStandardAdapter extends BasePracticeAdapter {
    constructor(document, window) {
        super(document, window);
        this.pageType = 'ielts-reading-standard';
    }

    detect() {
        const indicators = {
            hasTimer: !!this.document.getElementById('timer'),
            hasGradeButton: !!this.document.querySelector('button[onclick*="grade"]'),
            hasAnswerKey: !!this.window.answers,
            hasBlankInputs: this.document.querySelectorAll('input.blank').length > 0,
            hasRadioInputs: this.document.querySelectorAll('input[type="radio"]').length > 0,
            hasQuestionNav: !!this.document.querySelector('.practice-nav')
        };

        // 标准IELTS页面应该有这些特征
        this.isSupported = indicators.hasTimer && 
                          indicators.hasGradeButton && 
                          indicators.hasAnswerKey &&
                          (indicators.hasBlankInputs || indicators.hasRadioInputs);

        return this.isSupported;
    }

    getAnswerElements() {
        const elements = [];
        
        // 文本输入框
        const textInputs = this.document.querySelectorAll('input.blank, input[type="text"]');
        textInputs.forEach(input => {
            if (input.name) {
                elements.push({
                    element: input,
                    questionId: input.name,
                    type: 'text',
                    value: input.value
                });
            }
        });

        // 单选按钮
        const radioInputs = this.document.querySelectorAll('input[type="radio"]');
        radioInputs.forEach(input => {
            if (input.name) {
                elements.push({
                    element: input,
                    questionId: input.name,
                    type: 'radio',
                    value: input.checked ? input.value : null
                });
            }
        });

        return elements;
    }

    extractAnswers() {
        const answers = {};
        
        // 提取文本输入答案
        const textInputs = this.document.querySelectorAll('input.blank, input[type="text"]');
        textInputs.forEach(input => {
            if (input.name && input.value.trim()) {
                answers[input.name] = input.value.trim();
            }
        });

        // 提取单选答案
        const radioInputs = this.document.querySelectorAll('input[type="radio"]:checked');
        radioInputs.forEach(input => {
            if (input.name) {
                answers[input.name] = input.value;
            }
        });

        return answers;
    }

    getScoreInfo() {
        try {
            // 尝试从结果区域提取分数
            const resultsEl = this.document.getElementById('results');
            if (!resultsEl || !resultsEl.innerHTML.trim()) {
                return null;
            }

            const resultsText = resultsEl.textContent || resultsEl.innerText;

            // 提取分数 (格式: "Score: 8/13")
            const scoreMatch = resultsText.match(/Score:\s*(\d+)\/(\d+)/i);
            if (scoreMatch) {
                const correct = parseInt(scoreMatch[1]);
                const total = parseInt(scoreMatch[2]);
                return {
                    correct: correct,
                    total: total,
                    accuracy: total > 0 ? correct / total : 0,
                    percentage: total > 0 ? Math.round((correct / total) * 100) : 0,
                    source: 'page_extraction'
                };
            }

            // 提取准确率 (格式: "Accuracy 85%")
            const accuracyMatch = resultsText.match(/Accuracy\s*(\d+)%/i);
            if (accuracyMatch) {
                const percentage = parseInt(accuracyMatch[1]);
                return {
                    percentage: percentage,
                    accuracy: percentage / 100,
                    source: 'page_extraction'
                };
            }

        } catch (error) {
            console.error('[IELTSAdapter] 分数提取失败:', error);
        }

        return null;
    }

    getTotalQuestions() {
        if (this.window.answers) {
            return Object.keys(this.window.answers).length;
        }

        // 从页面元素计算
        const inputs = this.document.querySelectorAll('input[name^="q"], input.blank');
        const uniqueNames = new Set();
        inputs.forEach(input => {
            if (input.name) {
                uniqueNames.add(input.name);
            }
        });

        return uniqueNames.size;
    }

    setupListeners(callback) {
        // 监听文本输入
        const textInputs = this.document.querySelectorAll('input.blank, input[type="text"]');
        textInputs.forEach(input => {
            input.addEventListener('input', callback);
            input.addEventListener('change', callback);
        });

        // 监听单选按钮
        const radioInputs = this.document.querySelectorAll('input[type="radio"]');
        radioInputs.forEach(input => {
            input.addEventListener('change', callback);
        });

        // 监听评分按钮
        const gradeButtons = this.document.querySelectorAll('button[onclick*="grade"], button.primary');
        gradeButtons.forEach(button => {
            const buttonText = button.textContent.toLowerCase();
            if (buttonText.includes('submit') || buttonText.includes('grade') || 
                buttonText.includes('提交') || buttonText.includes('评分')) {
                button.addEventListener('click', () => {
                    setTimeout(callback, 200); // 延迟以确保评分完成
                });
            }
        });
    }
}

/**
 * IELTS阅读基础页面适配器
 */
class IELTSReadingBasicAdapter extends BasePracticeAdapter {
    constructor(document, window) {
        super(document, window);
        this.pageType = 'ielts-reading-basic';
    }

    detect() {
        const hasInputs = this.document.querySelectorAll('input[type="text"], input[type="radio"], input.blank').length > 0;
        const hasQuestions = this.document.querySelectorAll('[id*="q"], [name*="q"]').length > 0;
        
        this.isSupported = hasInputs && hasQuestions;
        return this.isSupported;
    }

    getAnswerElements() {
        const elements = [];
        
        // 查找所有可能的输入元素
        const inputs = this.document.querySelectorAll('input[type="text"], input[type="radio"], input.blank, select, textarea');
        inputs.forEach(input => {
            const questionId = input.name || input.id || this.guessQuestionId(input);
            if (questionId) {
                elements.push({
                    element: input,
                    questionId: questionId,
                    type: input.type || input.tagName.toLowerCase(),
                    value: this.getElementValue(input)
                });
            }
        });

        return elements;
    }

    guessQuestionId(element) {
        // 尝试从周围的文本或标签推断题目ID
        const parent = element.parentElement;
        if (parent) {
            const text = parent.textContent || '';
            const match = text.match(/(\d+)[.\s]/);
            if (match) {
                return `q${match[1]}`;
            }
        }
        return null;
    }

    getElementValue(element) {
        if (element.type === 'radio' || element.type === 'checkbox') {
            return element.checked ? element.value : null;
        }
        return element.value;
    }

    extractAnswers() {
        const answers = {};
        const elements = this.getAnswerElements();
        
        elements.forEach(({ questionId, element }) => {
            const value = this.getElementValue(element);
            if (value !== null && value !== '') {
                answers[questionId] = value;
            }
        });

        return answers;
    }

    getScoreInfo() {
        // 基础页面通常没有自动评分，返回null
        return null;
    }

    getTotalQuestions() {
        return this.getAnswerElements().length;
    }

    setupListeners(callback) {
        const elements = this.getAnswerElements();
        elements.forEach(({ element }) => {
            element.addEventListener('change', callback);
            if (element.type === 'text' || element.tagName === 'TEXTAREA') {
                element.addEventListener('input', callback);
            }
        });
    }
}

/**
 * PDF页面适配器（手动输入模式）
 */
class PDFPracticeAdapter extends BasePracticeAdapter {
    constructor(document, window) {
        super(document, window);
        this.pageType = 'pdf-manual';
    }

    detect() {
        // 检测是否是PDF页面或包含PDF嵌入
        const hasPDFEmbed = !!this.document.querySelector('embed[type="application/pdf"], object[type="application/pdf"]');
        const hasPDFIframe = !!this.document.querySelector('iframe[src*=".pdf"]');
        const isPDFUrl = this.window.location.href.toLowerCase().includes('.pdf');
        
        this.isSupported = hasPDFEmbed || hasPDFIframe || isPDFUrl;
        return this.isSupported;
    }

    getAnswerElements() {
        // PDF页面没有交互元素
        return [];
    }

    extractAnswers() {
        // PDF页面需要手动输入答案
        return {};
    }

    getScoreInfo() {
        // 需要手动输入分数
        return this.showManualScoreInput();
    }

    showManualScoreInput() {
        return new Promise((resolve) => {
            // 创建手动输入对话框
            const modal = this.createScoreInputModal(resolve);
            this.document.body.appendChild(modal);
        });
    }

    createScoreInputModal(callback) {
        const modal = this.document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
        `;

        modal.innerHTML = `
            <div style="background: white; padding: 20px; border-radius: 10px; max-width: 400px;">
                <h3>手动输入练习结果</h3>
                <p>请输入您的练习结果：</p>
                <div style="margin: 15px 0;">
                    <label>正确题数：</label>
                    <input type="number" id="correct-score" min="0" style="width: 80px; margin-left: 10px;">
                </div>
                <div style="margin: 15px 0;">
                    <label>总题数：</label>
                    <input type="number" id="total-questions" min="1" style="width: 80px; margin-left: 10px;">
                </div>
                <div style="margin: 15px 0;">
                    <label>练习时长（分钟）：</label>
                    <input type="number" id="duration-minutes" min="1" style="width: 80px; margin-left: 10px;">
                </div>
                <div style="text-align: right; margin-top: 20px;">
                    <button id="cancel-btn" style="margin-right: 10px;">取消</button>
                    <button id="submit-btn" style="background: #007cba; color: white; border: none; padding: 8px 16px; border-radius: 4px;">提交</button>
                </div>
            </div>
        `;

        // 事件处理
        modal.querySelector('#cancel-btn').addEventListener('click', () => {
            modal.remove();
            callback(null);
        });

        modal.querySelector('#submit-btn').addEventListener('click', () => {
            const correct = parseInt(modal.querySelector('#correct-score').value) || 0;
            const total = parseInt(modal.querySelector('#total-questions').value) || 1;
            const duration = parseInt(modal.querySelector('#duration-minutes').value) || 1;

            const scoreInfo = {
                correct: correct,
                total: total,
                accuracy: correct / total,
                percentage: Math.round((correct / total) * 100),
                duration: duration * 60, // 转换为秒
                source: 'manual_input'
            };

            modal.remove();
            callback(scoreInfo);
        });

        return modal;
    }

    getTotalQuestions() {
        return 0; // 需要手动输入
    }

    setupListeners(callback) {
        // PDF页面没有交互元素，不需要监听器
    }
}

/**
 * 适配器工厂类
 */
class PracticeAdapterFactory {
    constructor() {
        this.adapters = [
            IELTSReadingStandardAdapter,
            IELTSReadingBasicAdapter,
            PDFPracticeAdapter
        ];
    }

    /**
     * 创建适合当前页面的适配器
     */
    createAdapter(document, window) {
        for (const AdapterClass of this.adapters) {
            const adapter = new AdapterClass(document, window);
            if (adapter.detect()) {
                console.log(`[AdapterFactory] 使用适配器: ${adapter.pageType}`);
                return adapter;
            }
        }

        console.warn('[AdapterFactory] 未找到合适的适配器，使用基础适配器');
        return new BasePracticeAdapter(document, window);
    }

    /**
     * 获取所有支持的页面类型
     */
    getSupportedTypes() {
        return this.adapters.map(AdapterClass => {
            const adapter = new AdapterClass(null, null);
            return adapter.pageType;
        });
    }
}

// 导出到全局
if (typeof window !== 'undefined') {
    window.PracticeAdapterFactory = PracticeAdapterFactory;
    window.BasePracticeAdapter = BasePracticeAdapter;
    window.IELTSReadingStandardAdapter = IELTSReadingStandardAdapter;
    window.IELTSReadingBasicAdapter = IELTSReadingBasicAdapter;
    window.PDFPracticeAdapter = PDFPracticeAdapter;
}

// 如果是模块环境
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        PracticeAdapterFactory,
        BasePracticeAdapter,
        IELTSReadingStandardAdapter,
        IELTSReadingBasicAdapter,
        PDFPracticeAdapter
    };
}