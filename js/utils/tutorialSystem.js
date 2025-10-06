/**
 * 交互式教程系统
 * 提供分步骤的用户引导和功能介绍
 */
class TutorialSystem {
    constructor() {
        this.isActive = false;
        this.currentStep = 0;
        this.currentTutorial = null;
        this.overlay = null;
        this.tutorials = this.initializeTutorials();
        
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        this.checkFirstVisit();
    }
    
    /**
     * 初始化教程内容
     */
    initializeTutorials() {
        return {
            firstVisit: {
                name: '首次使用指南',
                description: '欢迎使用考试总览系统！让我们快速了解主要功能。',
                steps: [
                    {
                        target: '.logo',
                        title: '欢迎使用考试总览系统',
                        content: '这是一个综合性的练题平台，帮助您更高效地进行考试准备。',
                        position: 'bottom'
                    },
                    {
                        target: '.main-nav',
                        title: '导航栏',
                        content: '使用导航栏在不同功能页面间切换。您也可以使用 Ctrl+数字键快速导航。',
                        position: 'bottom'
                    },
                    {
                        target: '.stats-overview',
                        title: '学习统计',
                        content: '这里显示您的整体学习进度，包括完成的题目数量、正确率等关键指标。',
                        position: 'bottom'
                    },
                    {
                        target: '.category-grid',
                        title: '题库分类',
                        content: '题目按 P1、P2、P3 分类组织。每个分类都有高频和次高频题目。',
                        position: 'top'
                    },
                    {
                        target: '[data-category="P1"] .btn-primary',
                        title: '开始练习',
                        content: '点击"开始练习"可以随机选择该分类的题目进行练习。',
                        position: 'top'
                    },
                    {
                        target: '.help-button',
                        title: '获取帮助',
                        content: '随时点击帮助按钮或按 Ctrl+H 获取详细的使用说明。',
                        position: 'left'
                    }
                ]
            },
            practiceFlow: {
                name: '练习流程指南',
                description: '了解如何进行练习和查看结果',
                steps: [
                    {
                        target: '.category-card',
                        title: '选择练习内容',
                        content: '您可以选择整个分类练习，或者点击"浏览题目"查看具体题目。',
                        position: 'bottom'
                    },
                    {
                        target: '.nav-btn[data-view="practice"]',
                        title: '练习记录',
                        content: '完成练习后，可以在这里查看详细的练习记录和成绩。',
                        position: 'bottom'
                    },
                    {
                        target: '.nav-btn[data-view="analysis"]',
                        title: '成绩分析',
                        content: '系统会自动分析您的表现，提供个性化的学习建议。',
                        position: 'bottom'
                    },
                    {
                        target: '.nav-btn[data-view="goals"]',
                        title: '学习目标',
                        content: '设置每日学习目标，系统会帮助您跟踪进度。',
                        position: 'bottom'
                    }
                ]
            },
            specializedPractice: {
                name: '专项练习指南',
                description: '学习如何使用专项练习功能',
                steps: [
                    {
                        target: '.nav-btn[data-view="specialized-practice"]',
                        title: '专项练习',
                        content: '专项练习让您可以针对性地训练特定类型的题目。',
                        position: 'bottom'
                    },
                    {
                        target: '.frequency-practice',
                        title: '按频率练习',
                        content: '可以专门练习高频题目或次高频题目，提高学习效率。',
                        position: 'bottom'
                    },
                    {
                        target: '.category-practice',
                        title: '按分类练习',
                        content: '针对 P1、P2、P3 中的任一分类进行集中练习。',
                        position: 'bottom'
                    }
                ]
            },
            accessibility: {
                name: '无障碍功能指南',
                description: '了解系统的无障碍访问功能',
                steps: [
                    {
                        target: 'body',
                        title: '键盘导航',
                        content: '您可以使用 Tab 键在页面元素间导航，使用回车键激活按钮。',
                        position: 'center'
                    },
                    {
                        target: 'body',
                        title: '主题切换',
                        content: '系统支持浅色、深色和高对比度主题。使用 Ctrl+Shift+T 快速切换。',
                        position: 'center'
                    },
                    {
                        target: 'body',
                        title: '字体调节',
                        content: '可以在设置中调整字体大小，支持小、正常、大、特大四种尺寸。',
                        position: 'center'
                    },
                    {
                        target: 'body',
                        title: '减少动画',
                        content: '如果您对动画敏感，可以在设置中启用"减少动画"选项。',
                        position: 'center'
                    }
                ]
            }
        };
    }
    
    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        // 键盘快捷键 - 必须使用原生 addEventListener
        document.addEventListener('keydown', (e) => {
            if (this.isActive) {
                switch (e.key) {
                    case 'Escape':
                        this.stop();
                        break;
                    case 'ArrowRight':
                    case 'ArrowDown':
                        e.preventDefault();
                        this.nextStep();
                        break;
                    case 'ArrowLeft':
                    case 'ArrowUp':
                        e.preventDefault();
                        this.previousStep();
                        break;
                }
            }
        });
    }
    
    /**
     * 检查是否首次访问
     */
    checkFirstVisit() {
        const hasVisited = window.storage?.get('has_visited', false);
        if (!hasVisited) {
            // 延迟显示首次访问教程
            setTimeout(() => {
                this.start('firstVisit');
            }, 2000);
            
            window.storage?.set('has_visited', true);
        }
    }
    
    /**
     * 开始教程
     */
    start(tutorialKey) {
        const tutorial = this.tutorials[tutorialKey];
        if (!tutorial) {
            console.warn(`Tutorial "${tutorialKey}" not found`);
            return;
        }
        
        if (this.isActive) {
            this.stop();
        }
        
        this.currentTutorial = tutorial;
        this.currentStep = 0;
        this.isActive = true;
        
        this.createOverlay();
        this.showStep(0);
        
        // 触发教程开始事件
        document.dispatchEvent(new CustomEvent('tutorialStarted', {
            detail: { tutorial: tutorialKey }
        }));
    }
    
    /**
     * 停止教程
     */
    stop() {
        if (!this.isActive) return;
        
        this.isActive = false;
        this.currentTutorial = null;
        this.currentStep = 0;
        
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
        
        // 移除所有高亮
        document.querySelectorAll('.tutorial-highlight').forEach(el => el.remove());
        
        // 触发教程结束事件
        document.dispatchEvent(new CustomEvent('tutorialEnded'));
    }
    
    /**
     * 下一步
     */
    nextStep() {
        if (!this.isActive || !this.currentTutorial) return;
        
        if (this.currentStep < this.currentTutorial.steps.length - 1) {
            this.currentStep++;
            this.showStep(this.currentStep);
        } else {
            this.completeTutorial();
        }
    }
    
    /**
     * 上一步
     */
    previousStep() {
        if (!this.isActive || !this.currentTutorial) return;
        
        if (this.currentStep > 0) {
            this.currentStep--;
            this.showStep(this.currentStep);
        }
    }
    
    /**
     * 跳转到指定步骤
     */
    goToStep(stepIndex) {
        if (!this.isActive || !this.currentTutorial) return;
        
        if (stepIndex >= 0 && stepIndex < this.currentTutorial.steps.length) {
            this.currentStep = stepIndex;
            this.showStep(stepIndex);
        }
    }
    
    /**
     * 显示指定步骤
     */
    showStep(stepIndex) {
        const step = this.currentTutorial.steps[stepIndex];
        if (!step) return;
        
        // 移除之前的高亮
        document.querySelectorAll('.tutorial-highlight').forEach(el => el.remove());
        
        // 创建新的高亮和提示
        this.highlightElement(step.target);
        this.showTooltip(step);
        this.updateProgress();
        
        // 滚动到目标元素
        this.scrollToTarget(step.target);
    }
    
    /**
     * 高亮目标元素
     */
    highlightElement(selector) {
        const element = document.querySelector(selector);
        if (!element) return;
        
        const rect = element.getBoundingClientRect();
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
        
        const highlight = document.createElement('div');
        highlight.className = 'tutorial-highlight';
        highlight.style.cssText = `
            top: ${rect.top + scrollTop - 4}px;
            left: ${rect.left + scrollLeft - 4}px;
            width: ${rect.width + 8}px;
            height: ${rect.height + 8}px;
        `;
        
        document.body.appendChild(highlight);
    }
    
    /**
     * 显示提示框
     */
    showTooltip(step) {
        // 移除之前的提示框
        const existingTooltip = document.querySelector('.tutorial-tooltip');
        if (existingTooltip) {
            existingTooltip.remove();
        }
        
        const tooltip = document.createElement('div');
        tooltip.className = `tutorial-tooltip ${step.position || 'bottom'}`;
        
        tooltip.innerHTML = `
            <div class="tutorial-content">
                <h4>${step.title}</h4>
                <p>${step.content}</p>
                <div class="tutorial-progress">
                    <span>${this.currentStep + 1} / ${this.currentTutorial.steps.length}</span>
                    <div class="tutorial-progress-bar">
                        <div class="tutorial-progress-fill" style="width: ${((this.currentStep + 1) / this.currentTutorial.steps.length) * 100}%"></div>
                    </div>
                </div>
                <div class="tutorial-actions">
                    ${this.currentStep > 0 ? '<button class="btn btn-outline tutorial-prev">上一步</button>' : ''}
                    ${this.currentStep < this.currentTutorial.steps.length - 1 ? 
                        '<button class="btn btn-primary tutorial-next">下一步</button>' : 
                        '<button class="btn btn-primary tutorial-complete">完成</button>'
                    }
                    <button class="btn btn-secondary tutorial-skip">跳过教程</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(tooltip);
        
        // 定位提示框
        this.positionTooltip(tooltip, step);
        
        // 设置事件监听器
        this.setupTooltipEvents(tooltip);
    }
    
    /**
     * 定位提示框
     */
    positionTooltip(tooltip, step) {
        const target = document.querySelector(step.target);
        if (!target) return;
        
        const targetRect = target.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
        
        let top, left;
        
        switch (step.position) {
            case 'top':
                top = targetRect.top + scrollTop - tooltipRect.height - 20;
                left = targetRect.left + scrollLeft + (targetRect.width - tooltipRect.width) / 2;
                break;
            case 'bottom':
                top = targetRect.bottom + scrollTop + 20;
                left = targetRect.left + scrollLeft + (targetRect.width - tooltipRect.width) / 2;
                break;
            case 'left':
                top = targetRect.top + scrollTop + (targetRect.height - tooltipRect.height) / 2;
                left = targetRect.left + scrollLeft - tooltipRect.width - 20;
                break;
            case 'right':
                top = targetRect.top + scrollTop + (targetRect.height - tooltipRect.height) / 2;
                left = targetRect.right + scrollLeft + 20;
                break;
            case 'center':
                top = window.innerHeight / 2 - tooltipRect.height / 2 + scrollTop;
                left = window.innerWidth / 2 - tooltipRect.width / 2 + scrollLeft;
                break;
            default:
                top = targetRect.bottom + scrollTop + 20;
                left = targetRect.left + scrollLeft + (targetRect.width - tooltipRect.width) / 2;
        }
        
        // 确保提示框在视窗内
        const margin = 20;
        left = Math.max(margin, Math.min(left, window.innerWidth - tooltipRect.width - margin));
        top = Math.max(margin, top);
        
        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${left}px`;
    }
    
    /**
     * 设置提示框事件监听器
     */
    setupTooltipEvents(tooltip) {
        // 教程控制按钮 - 可以使用事件委托优化
        if (typeof window.DOM !== 'undefined' && window.DOM.delegate) {
            window.DOM.delegate('click', '.tutorial-prev', (e) => {
                const btn = e.target.closest('.tutorial-prev');
                if (!btn) return;
                this.previousStep();
            });
            window.DOM.delegate('click', '.tutorial-next', (e) => {
                const btn = e.target.closest('.tutorial-next');
                if (!btn) return;
                this.nextStep();
            });
            window.DOM.delegate('click', '.tutorial-complete', (e) => {
                const btn = e.target.closest('.tutorial-complete');
                if (!btn) return;
                this.completeTutorial();
            });
            window.DOM.delegate('click', '.tutorial-skip', (e) => {
                const btn = e.target.closest('.tutorial-skip');
                if (!btn) return;
                this.stop();
            });
        } else {
            const prevBtn = tooltip.querySelector('.tutorial-prev');
            const nextBtn = tooltip.querySelector('.tutorial-next');
            const completeBtn = tooltip.querySelector('.tutorial-complete');
            const skipBtn = tooltip.querySelector('.tutorial-skip');

            if (prevBtn) {
                prevBtn.addEventListener('click', () => this.previousStep());
            }

            if (nextBtn) {
                nextBtn.addEventListener('click', () => this.nextStep());
            }

            if (completeBtn) {
                completeBtn.addEventListener('click', () => this.completeTutorial());
            }

            if (skipBtn) {
                skipBtn.addEventListener('click', () => this.stop());
            }
        }
    }
    
    /**
     * 滚动到目标元素
     */
    scrollToTarget(selector) {
        const element = document.querySelector(selector);
        if (!element) return;
        
        element.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'center'
        });
    }
    
    /**
     * 更新进度
     */
    updateProgress() {
        const progressFill = document.querySelector('.tutorial-progress-fill');
        if (progressFill) {
            const progress = ((this.currentStep + 1) / this.currentTutorial.steps.length) * 100;
            progressFill.style.width = `${progress}%`;
        }
    }
    
    /**
     * 创建覆盖层
     */
    createOverlay() {
        this.overlay = document.createElement('div');
        this.overlay.className = 'tutorial-overlay';
        document.body.appendChild(this.overlay);
    }
    
    /**
     * 完成教程
     */
    completeTutorial() {
        if (window.showMessage) {
            window.showMessage('教程完成！您现在可以开始使用系统了。', 'success');
        }
        
        // 记录教程完成状态
        const completedTutorials = window.storage?.get('completed_tutorials', []);
        if (this.currentTutorial && !completedTutorials.includes(this.currentTutorial.name)) {
            completedTutorials.push(this.currentTutorial.name);
            window.storage?.set('completed_tutorials', completedTutorials);
        }
        
        this.stop();
    }
    
    /**
     * 获取可用教程列表
     */
    getAvailableTutorials() {
        return Object.entries(this.tutorials).map(([key, tutorial]) => ({
            key,
            name: tutorial.name,
            description: tutorial.description,
            steps: tutorial.steps.length
        }));
    }
    
    /**
     * 检查教程是否已完成
     */
    isTutorialCompleted(tutorialKey) {
        const completedTutorials = window.storage?.get('completed_tutorials', []);
        const tutorial = this.tutorials[tutorialKey];
        return tutorial && completedTutorials.includes(tutorial.name);
    }
    
    /**
     * 重置教程状态
     */
    resetTutorialProgress() {
        window.storage?.set('completed_tutorials', []);
        window.storage?.set('has_visited', false);
        
        if (window.showMessage) {
            window.showMessage('教程进度已重置', 'info');
        }
    }
    
    /**
     * 添加自定义教程
     */
    addTutorial(key, tutorial) {
        this.tutorials[key] = tutorial;
    }
    
    /**
     * 显示教程选择器
     */
    showTutorialSelector() {
        const tutorials = this.getAvailableTutorials();
        
        const selectorContent = `
            <div class="tutorial-selector">
                <div class="modal-header">
                    <h3>选择教程</h3>
                    <button class="modal-close">×</button>
                </div>
                <div class="modal-body">
                    <p>选择您想要学习的教程：</p>
                    <div class="tutorial-list">
                        ${tutorials.map(tutorial => `
                            <div class="tutorial-item" data-tutorial="${tutorial.key}">
                                <h4>${tutorial.name}</h4>
                                <p>${tutorial.description}</p>
                                <div class="tutorial-meta">
                                    <span>${tutorial.steps} 个步骤</span>
                                    ${this.isTutorialCompleted(tutorial.key) ? 
                                        '<span class="tutorial-completed">已完成</span>' : 
                                        '<span class="tutorial-new">新教程</span>'
                                    }
                                </div>
                                <button class="btn btn-primary start-tutorial" data-tutorial="${tutorial.key}">
                                    开始教程
                                </button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
        
        this.showModal(selectorContent);
        
        // 设置事件监听器 - 可以使用事件委托优化
        setTimeout(() => {
            if (typeof window.DOM !== 'undefined' && window.DOM.delegate) {
                window.DOM.delegate('click', '.start-tutorial', (e) => {
                    const btn = e.target.closest('.start-tutorial');
                    if (!btn) return;
                    const tutorialKey = btn.dataset.tutorial;
                    document.querySelector('.modal-overlay').remove();
                    this.start(tutorialKey);
                });
            } else {
                const startButtons = document.querySelectorAll('.start-tutorial');
                startButtons.forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const tutorialKey = e.target.dataset.tutorial;
                        document.querySelector('.modal-overlay').remove();
                        this.start(tutorialKey);
                    });
                });
            }
        }, 100);
    }
    
    /**
     * 显示模态框
     */
    showModal(content) {
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'modal-overlay show';
        modalOverlay.innerHTML = `<div class="modal">${content}</div>`;
        
        document.body.appendChild(modalOverlay);
        
        // 点击背景关闭 - 动态创建，保持原生监听
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                modalOverlay.remove();
            }
        });

        // 关闭按钮 - 可以使用事件委托优化
        if (typeof window.DOM !== 'undefined' && window.DOM.delegate) {
            window.DOM.delegate('click', '.modal-close', (e) => {
                const btn = e.target.closest('.modal-close');
                if (!btn) return;
                const modal = document.querySelector('.modal-overlay');
                if (modal) modal.remove();
            });
        } else {
            const closeBtn = modalOverlay.querySelector('.modal-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    modalOverlay.remove();
                });
            }
        }
    }
}