/**
 * Onboarding Tour - 首次引导流程组件
 * 用于引导新用户了解系统各项功能
 * 兼容 file:// 协议
 */
(function (global) {
  'use strict';

  // 存储键名
  const STORAGE_KEYS = {
    COMPLETED: 'onboardingCompleted',
    CURRENT_STEP: 'onboardingStep',
    LAST_SHOWN: 'onboardingLastShown'
  };

  // 默认步骤配置
  const DEFAULT_STEPS = [
    {
      id: 'welcome',
      target: null,
      title: '👋 欢迎使用考试总览系统',
      content: '这是一个专为雅思备考设计的练习系统，提供阅读、听力练习和词汇背诵等功能。让我们快速了解一下各项功能吧！',
      position: 'center',
      showSkip: false,
      showPrev: false,
      nextText: '开始探索',
      activateView: null
    },
    {
      id: 'navigation',
      target: '.main-nav',
      title: '📍 导航栏',
      content: '顶部导航栏包含 5 个主要功能区：总览、题库浏览、练习记录、更多工具和设置。点击即可切换不同功能。',
      position: 'bottom',
      showSkip: true,
      showPrev: true,
      nextText: '下一步',
      activateView: null
    },
    {
      id: 'overview',
      target: '#overview-view',
      title: '📊 学习总览',
      content: '这里显示您的学习数据统计，包括分类卡片、练习进度和成绩趋势。帮助您全面了解学习情况。',
      position: 'right',
      showSkip: true,
      showPrev: true,
      nextText: '下一步',
      activateView: 'overview'
    },
    {
      id: 'browse',
      target: '#browse-view',
      title: '📚 题库浏览',
      content: '浏览所有可用题目，支持搜索、筛选和排序功能。点击题目即可开始练习或查看解析。',
      position: 'right',
      showSkip: true,
      showPrev: true,
      nextText: '下一步',
      activateView: 'browse'
    },
    {
      id: 'practice',
      target: '#practice-view',
      title: '📝 练习记录',
      content: '查看您的练习历史、成绩统计和学习时长，追踪学习进度和成长轨迹。',
      position: 'right',
      showSkip: true,
      showPrev: true,
      nextText: '下一步',
      activateView: 'practice'
    },
    {
      id: 'review-mode',
      title: '📖 回顾模式',
      content: '接下来我们将学习如何使用回顾模式查看练习解析。',
      position: 'right',
      showSkip: true,
      showPrev: true,
      nextText: '下一步',
      activateView: 'practice',
      // 子步骤流程
      subSteps: [
        {
          id: 'inject-demo-record',
          action: 'injectDemoRecord',
          title: '📝 示例记录已添加',
          content: '我们已为您添加了一条示例练习记录，请点击“我知道了”继续。',
          target: '.history-item[data-record-id="demo-onboarding-record"]',
          position: 'right',
          nextText: '我知道了',
          lockScroll: true,     // 禁止用户滚动页面
          lockPointer: true     // 禁止用户点击非引导元素
        },
        {
          id: 'click-history-item',
          title: '👆 点击记录标题进入详情',
          content: '点击下方这条示例记录的标题，可以打开练习记录详情页。',
          target: '#history-list .history-record-item[data-record-id="demo-onboarding-record"] .practice-record-title',
          position: 'right',
          nextText: '下一步',
          lockScroll: true,
          waitForClick: true
        },
        {
          id: 'modal-opened',
          title: '📋 练习记录详情',
          content: '这里是练习记录详情弹窗，您可以看到本次练习的详细信息和成绩。',
          target: '#practice-record-modal .modal-container',
          position: 'right',
          nextText: '下一步',
          waitForElement: '#practice-record-modal'
        },
        {
          id: 'click-review-mode',
          title: '📖 进入回顾模式',
          content: '点击上方标题（回顾模式触发器），可以进入该记录的回放/回顾模式。',
          target: '#practice-record-modal .record-summary-replay-trigger',
          position: 'bottom',
          nextText: '下一步',
          waitForClick: true
        },
        {
          id: 'review-mode-active',
          title: '👋 小贴士',
          content: '该练习记录缺少数据哦，等待您的数据后即可使用回顾模式。',
          target: null,
          position: 'center',
          nextText: '我知道了'
        }
      ]
    },
    {
      id: 'more',
      target: '#more-view',
      title: '🛠️ 更多工具',
      content: '访问写作评分、全屏时钟、单词背诵和成就系统等辅助工具，全方位提升备考效率。',
      position: 'right',
      showSkip: true,
      showPrev: true,
      nextText: '下一步',
      activateView: 'more'
    },
    {
      id: 'settings',
      target: '#settings-view',
      title: '⚙️ 系统设置',
      content: '管理主题切换、数据备份导入导出、题库配置等系统选项。个性化您的学习体验！',
      position: 'right',
      showSkip: false,
      showPrev: true,
      nextText: '完成引导 🎉',
      activateView: 'settings'
    }
  ];

  // 状态管理器
  class TourStateManager {
    constructor() {
      this._storage = this._getStorage();
    }

    _getStorage() {
      try {
        localStorage.setItem('__test__', '1');
        localStorage.removeItem('__test__');
        return localStorage;
      } catch (e) {
        // 降级到内存存储
        const mem = {};
        return {
          getItem: (k) => mem[k] || null,
          setItem: (k, v) => { mem[k] = String(v); },
          removeItem: (k) => { delete mem[k]; }
        };
      }
    }

    isCompleted() {
      return this._storage.getItem(STORAGE_KEYS.COMPLETED) === 'true';
    }

    getCurrentStep() {
      const step = this._storage.getItem(STORAGE_KEYS.CURRENT_STEP);
      return step ? parseInt(step, 10) : 0;
    }

    setStep(step) {
      this._storage.setItem(STORAGE_KEYS.CURRENT_STEP, step);
      this._storage.setItem(STORAGE_KEYS.LAST_SHOWN, Date.now());
    }

    markCompleted() {
      this._storage.setItem(STORAGE_KEYS.COMPLETED, 'true');
      this._storage.removeItem(STORAGE_KEYS.CURRENT_STEP);
    }

    reset() {
      this._storage.removeItem(STORAGE_KEYS.COMPLETED);
      this._storage.removeItem(STORAGE_KEYS.CURRENT_STEP);
      this._storage.removeItem(STORAGE_KEYS.LAST_SHOWN);
    }
  }

  // 渲染器
  class TourRenderer {
    constructor() {
      this._overlay = null;
      this._tooltip = null;
      this._highlightEl = null;
      this._holeEl = null;  // 新增：洞元素
    }

    createOverlay() {
      if (this._overlay) return this._overlay;

      this._overlay = document.createElement('div');
      this._overlay.className = 'onboarding-overlay';
      // 关键：遮罩层不阻止点击事件，允许点击穿透
      this._overlay.style.pointerEvents = 'none';
      document.body.appendChild(this._overlay);

      // 创建洞元素
      this._holeEl = document.createElement('div');
      this._holeEl.className = 'onboarding-hole';
      document.body.appendChild(this._holeEl);

      requestAnimationFrame(() => {
        this._overlay.classList.add('is-active');
      });

      return this._overlay;
    }

    createTooltip() {
      if (this._tooltip) this._tooltip.remove();

      this._tooltip = document.createElement('div');
      this._tooltip.className = 'onboarding-tooltip';
      document.body.appendChild(this._tooltip);

      return this._tooltip;
    }

    highlightElement(el) {
      this.clearHighlight();
      if (!el) return;

      this._highlightEl = el;

      // 获取目标元素的位置和大小
      const rect = el.getBoundingClientRect();

      // 设置洞元素的位置和大小
      if (this._holeEl) {
        this._holeEl.style.display = 'block';
        this._holeEl.style.top = rect.top + 'px';
        this._holeEl.style.left = rect.left + 'px';
        this._holeEl.style.width = rect.width + 'px';
        this._holeEl.style.height = rect.height + 'px';
      }

      // 保存原始样式以便恢复
      const originalStyles = {
        position: el.style.position,
        zIndex: el.style.zIndex,
        pointerEvents: el.style.pointerEvents
      };
      el._originalOnboardingStyles = originalStyles;

      const modalContainer = el.closest('.modal-container') || el.closest('.modal-overlay');
      if (modalContainer) {
        el._originalModalZIndex = modalContainer.style.zIndex;
        el._originalModalPosition = modalContainer.style.position;
        modalContainer.style.zIndex = '100005';
        modalContainer.style.position = 'relative';
      }

      // 强制设置目标元素样式使其在遮罩层之上
      el.style.position = 'relative';
      el.style.zIndex = '100006';
      el.style.pointerEvents = 'auto';

      el.classList.add('onboarding-highlight');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    clearHighlight() {
      if (this._highlightEl) {
        const el = this._highlightEl;
        el.classList.remove('onboarding-highlight');

        // 恢复原始样式
        if (el._originalOnboardingStyles) {
          el.style.position = el._originalOnboardingStyles.position;
          el.style.zIndex = el._originalOnboardingStyles.zIndex;
          el.style.pointerEvents = el._originalOnboardingStyles.pointerEvents;
          delete el._originalOnboardingStyles;
        }

        const modalContainer = el.closest('.modal-container') || el.closest('.modal-overlay');
        if (modalContainer && el._originalModalZIndex !== undefined) {
          modalContainer.style.zIndex = el._originalModalZIndex;
          modalContainer.style.position = el._originalModalPosition;
          delete el._originalModalZIndex;
          delete el._originalModalPosition;
        }

        this._highlightEl = null;
      }

      // 隐藏洞元素
      if (this._holeEl) {
        this._holeEl.style.display = 'none';
      }
    }

    positionTooltip(target, position) {
      if (!this._tooltip) return;

      // 清除旧箭头
      const oldArrow = this._tooltip.querySelector('.onboarding-tooltip__arrow');
      if (oldArrow) oldArrow.remove();

      if (!target || position === 'center') {
        // 居中显示
        this._tooltip.style.position = 'fixed';
        this._tooltip.style.top = '50%';
        this._tooltip.style.left = '50%';
        this._tooltip.style.transform = 'translate(-50%, -50%)';
        return;
      }

      const rect = target.getBoundingClientRect();
      const tooltipRect = this._tooltip.getBoundingClientRect();

      let top, left;
      const gap = 12;

      switch (position) {
        case 'top':
          top = rect.top - tooltipRect.height - gap;
          left = rect.left + (rect.width - tooltipRect.width) / 2;
          this._addArrow('bottom');
          break;
        case 'bottom':
          top = rect.bottom + gap;
          left = rect.left + (rect.width - tooltipRect.width) / 2;
          this._addArrow('top');
          break;
        case 'left':
          top = rect.top + (rect.height - tooltipRect.height) / 2;
          left = rect.left - tooltipRect.width - gap;
          this._addArrow('right');
          break;
        case 'right':
        default:
          top = rect.top + (rect.height - tooltipRect.height) / 2;
          left = rect.right + gap;
          this._addArrow('left');
          break;
      }

      // 边界检查
      left = Math.max(10, Math.min(left, window.innerWidth - tooltipRect.width - 10));
      top = Math.max(10, Math.min(top, window.innerHeight - tooltipRect.height - 10));

      this._tooltip.style.position = 'fixed';
      this._tooltip.style.top = top + 'px';
      this._tooltip.style.left = left + 'px';
      this._tooltip.style.transform = 'none';
    }

    _addArrow(direction) {
      const arrow = document.createElement('div');
      arrow.className = `onboarding-tooltip__arrow onboarding-tooltip__arrow--${direction}`;
      this._tooltip.appendChild(arrow);
    }

    renderTooltipContent(step, current, total) {
      if (!this._tooltip) return;

      const progressPercent = ((current + 1) / total) * 100;

      this._tooltip.innerHTML = `
        <div class="onboarding-tooltip__progress">
          <div class="onboarding-tooltip__progress-bar">
            <div class="onboarding-tooltip__progress-fill" style="width: ${progressPercent}%"></div>
          </div>
          <span class="onboarding-tooltip__progress-text">${current + 1} / ${total}</span>
        </div>
        <h3 class="onboarding-tooltip__title">${step.title}</h3>
        <p class="onboarding-tooltip__content">${step.content}</p>
        <div class="onboarding-tooltip__actions">
          ${step.showPrev ? '<button class="onboarding-tooltip__btn onboarding-tooltip__btn--secondary" data-action="prev">上一步</button>' : '<div></div>'}
          <div>
            ${step.showSkip ? '<button class="onboarding-tooltip__btn onboarding-tooltip__btn--skip" data-action="skip">跳过</button>' : ''}
            <button class="onboarding-tooltip__btn onboarding-tooltip__btn--primary" data-action="next">${step.nextText}</button>
          </div>
        </div>
      `;

      requestAnimationFrame(() => {
        this._tooltip.classList.add('is-visible');
      });
    }

    showWelcome(step) {
      if (!this._tooltip) return;

      this._tooltip.innerHTML = `
        <div class="onboarding-welcome">
          <div class="onboarding-welcome__icon">🎓</div>
          <h3 class="onboarding-tooltip__title">${step.title}</h3>
          <p class="onboarding-tooltip__content">${step.content}</p>
          <button class="onboarding-tooltip__btn onboarding-tooltip__btn--primary" data-action="next" style="margin-top: 16px;">${step.nextText}</button>
        </div>
      `;

      requestAnimationFrame(() => {
        this._tooltip.classList.add('is-visible');
      });
    }

    destroy() {
      this.clearHighlight();
      if (this._overlay) {
        this._overlay.classList.remove('is-active');
        setTimeout(() => this._overlay?.remove(), 300);
        this._overlay = null;
      }
      if (this._holeEl) {
        this._holeEl.remove();
        this._holeEl = null;
      }
      if (this._tooltip) {
        this._tooltip.classList.remove('is-visible');
        setTimeout(() => this._tooltip?.remove(), 300);
        this._tooltip = null;
      }
    }
  }

  // 主类
  class OnboardingTour {
    constructor(config = {}) {
      this._stateManager = new TourStateManager();
      this._renderer = new TourRenderer();
      this._steps = config.steps || DEFAULT_STEPS;
      this._currentStep = 0;
      this._isActive = false;
      this._boundKeyHandler = null;
      // 子步骤状态
      this._currentSubStep = 0;
      this._inSubSteps = false;
    }

    init() {
      if (this._stateManager.isCompleted()) {
        return;
      }

      // 延迟触发，等待页面渲染
      setTimeout(() => {
        this.start();
      }, 1500);
    }

    start(fromBeginning = false) {
      if (this._isActive) return;

      this._currentStep = fromBeginning ? 0 : this._stateManager.getCurrentStep();
      this._isActive = true;

      this._renderer.createOverlay();
      this._renderer.createTooltip();

      // 绑定键盘事件
      this._boundKeyHandler = this._handleKeydown.bind(this);
      document.addEventListener('keydown', this._boundKeyHandler);

      // 绑定点击事件
      this._renderer._overlay.addEventListener('click', (e) => {
        // 阻止点击遮罩层关闭
        e.stopPropagation();
      });

      this._showCurrentStep();
    }

    stop() {
      this._isActive = false;
      this._unlockScroll();
      this._unlockPointer();
      this._renderer.destroy();

      if (this._boundKeyHandler) {
        document.removeEventListener('keydown', this._boundKeyHandler);
        this._boundKeyHandler = null;
      }
    }

    reset() {
      this.stop();
      this._stateManager.reset();
    }

    // ===== 滚动与指针锁定 =====
    _lockScroll() {
      if (!document.body.classList.contains('onboarding-scroll-locked')) {
        this._savedScrollTop = window.scrollY || document.documentElement.scrollTop;
        document.body.classList.add('onboarding-scroll-locked');
        document.body.style.overflow = 'hidden';
        document.body.style.position = 'fixed';
        document.body.style.top = `-${this._savedScrollTop}px`;
        document.body.style.width = '100%';
      }
    }

    _unlockScroll() {
      if (document.body.classList.contains('onboarding-scroll-locked')) {
        document.body.classList.remove('onboarding-scroll-locked');
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        const savedTop = this._savedScrollTop || 0;
        window.scrollTo(0, savedTop);
        this._savedScrollTop = 0;
      }
    }

    _lockPointer() {
      if (!document.getElementById('onboarding-pointer-intercept')) {
        const intercept = document.createElement('div');
        intercept.id = 'onboarding-pointer-intercept';
        intercept.style.cssText = [
          'position: fixed',
          'inset: 0',
          'z-index: 99998',   // 在遮罩层之下，在普通元素之上',
          'background: transparent',
          'pointer-events: all',
          'cursor: not-allowed'
        ].join(';');
        // 防止有意的引导点击被拦截
        intercept.addEventListener('click', e => e.stopPropagation());
        document.body.appendChild(intercept);
      }
    }

    _unlockPointer() {
      const intercept = document.getElementById('onboarding-pointer-intercept');
      if (intercept) intercept.remove();
    }

    getStatus() {
      return {
        completed: this._stateManager.isCompleted(),
        currentStep: this._currentStep,
        totalSteps: this._steps.length
      };
    }

    goToStep(step) {
      if (step < 0 || step >= this._steps.length) return;
      this._currentStep = step;
      this._stateManager.setStep(step);
      this._showCurrentStep();
    }

    registerSteps(steps) {
      this._steps = steps;
    }

    _activateView(viewId) {
      if (!viewId) return;

      // 方法 1: 尝试点击对应的导航按钮
      const navMap = {
        'overview': '[data-view="overview"]',
        'browse': '[data-view="browse"]',
        'practice': '[data-view="practice"]',
        'more': '[data-view="more"]',
        'settings': '[data-view="settings"]'
      };

      const selector = navMap[viewId];
      if (selector) {
        const navBtn = document.querySelector(selector);
        if (navBtn) {
          navBtn.click();
          return;
        }
      }

      // 方法 2: 直接显示目标视图（如果导航按钮不存在）
      const viewMap = {
        'overview': '#overview-view',
        'browse': '#browse-view',
        'practice': '#practice-view',
        'more': '#more-view',
        'settings': '#settings-view'
      };

      const viewSelector = viewMap[viewId];
      if (viewSelector) {
        const targetView = document.querySelector(viewSelector);
        if (targetView) {
          // 隐藏所有视图
          document.querySelectorAll('.view-container, [id$="-view"]').forEach(v => {
            v.style.display = 'none';
          });
          // 显示目标视图
          targetView.style.display = 'block';
        }
      }
    }

    _showCurrentStep() {
      const step = this._steps[this._currentStep];
      if (!step) {
        this._complete();
        return;
      }

      this._stateManager.setStep(this._currentStep);

      // 先激活对应视图
      this._activateView(step.activateView);

      // 检查是否有子步骤
      if (step.subSteps && !this._inSubSteps) {
        this._inSubSteps = true;
        this._currentSubStep = 0;
      }

      // 如果当前在子步骤中
      if (this._inSubSteps && step.subSteps) {
        this._showSubStep(step);
        return;
      }

      // 如果需要等待元素出现
      if (step.waitForElement && step.target) {
        // 先触发按钮打开模态框
        if (step.triggerElement) {
          const triggerEl = document.querySelector(step.triggerElement);
          if (triggerEl) {
            triggerEl.click();
          }
        }
        this._waitForElement(step.target, () => {
          this._showStepContent(step);
        });
        return;
      }

      this._showStepContent(step);
    }

    _showSubStep(parentStep) {
      const subStep = parentStep.subSteps[this._currentSubStep];
      if (!subStep) {
        this._inSubSteps = false;
        this._currentStep++;
        this._showCurrentStep();
        return;
      }

      // 执行子步骤动作
      if (subStep.action === 'injectDemoRecord') {
        this._injectDemoRecord();
      }

      // 等待元素出现
      if (subStep.waitForElement) {
        this._waitForElement(subStep.waitForElement, () => {
          this._showSubStepContent(subStep, parentStep);
        });
        return;
      }

      this._showSubStepContent(subStep, parentStep);
    }

    _showSubStepContent(subStep, parentStep) {
      // inject-demo-record 需要等待 DOM 刷新后再定位
      const delay = (subStep.action === 'injectDemoRecord') ? 800 : 100;
      setTimeout(() => {
        this._renderer._tooltip?.classList.remove('is-visible');

        // 应用滚动锁
        if (subStep.lockScroll) {
          this._lockScroll();
        } else {
          this._unlockScroll();
        }

        // 应用指针锁（不是 waitForClick 步骤才锁，防止误操作）
        if (subStep.lockPointer && !subStep.waitForClick) {
          this._lockPointer();
        } else {
          this._unlockPointer();
        }

        const targetEl = subStep.target ? document.querySelector(subStep.target) : null;
        this._renderer.highlightElement(targetEl);
        this._renderer.positionTooltip(targetEl, subStep.position);

        const totalSteps = parentStep.subSteps.length;
        this._renderer.renderTooltipContent(subStep, this._currentSubStep, totalSteps);

        // 绑定子步骤按钮事件
        this._bindSubStepButtonActions(parentStep);

        // 如果需要等待点击
        if (subStep.waitForClick && targetEl) {
          this._waitForElementClick(targetEl, () => {
            this._unlockScroll();
            this._unlockPointer();
            this._currentSubStep++;
            this._showSubStep(parentStep);
          });
        }
      }, delay);
    }

    _bindSubStepButtonActions(parentStep) {
      const tooltip = this._renderer._tooltip;
      if (!tooltip) return;

      tooltip.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const action = e.target.dataset.action;

          switch (action) {
            case 'next':
              this._currentSubStep++;
              if (this._currentSubStep >= parentStep.subSteps.length) {
                this._inSubSteps = false;
                this._currentStep++;
              }
              this._showCurrentStep();
              break;
            case 'prev':
              if (this._currentSubStep > 0) {
                this._currentSubStep--;
                this._showSubStep(parentStep);
              }
              break;
            case 'skip':
              this._inSubSteps = false;
              this._currentStep++;
              this._showCurrentStep();
              break;
          }
        });
      });
    }

    _waitForElementClick(element, callback) {
      if (!element) {
        callback();
        return;
      }

      const handler = (e) => {
        element.removeEventListener('click', handler);
        callback();
      };

      element.addEventListener('click', handler);
    }

    _injectDemoRecord() {
      const demoRecordObj = {
        id: 'demo-onboarding-record',
        type: 'reading',
        title: '示例练习 - 阅读 Passage 1',
        metadata: {
          examTitle: '示例练习 - 阅读 Passage 1',
          category: '官方真题'
        },
        score: 25,
        totalQuestions: 40,
        accuracy: 0.625,
        percentage: 62.5,
        correctAnswers: 25,
        duration: 1200,
        date: new Date().toISOString(),
        questions: []
      };

      // 注意：全局小写形式为 window.dataRepositories
      const repos = window.dataRepositories;
      if (repos && repos.practice) {
        repos.practice.upsert(demoRecordObj).then(() => {
          // 尝试触发界面刷新
          if (typeof window.syncPracticeRecords === 'function') {
            window.syncPracticeRecords({ forceRender: true });
          } else if (window.app && typeof window.app.renderPracticeHistory === 'function') {
            window.app.renderPracticeHistory();
          } else {
            // 广播事件，主应用处监听并重载
            window.dispatchEvent(new CustomEvent('practiceRecordsUpdated', { detail: { source: 'onboarding' } }));
          }
        }).catch(err => {
          console.error('[Onboarding] 注入示例记录失败:', err);
        });
      } else {
        console.warn('[Onboarding] window.dataRepositories.practice 不可用，无法注入示例记录');
      }
    }

    _cleanupDemoRecord() {
      const repos = window.dataRepositories;
      if (repos && repos.practice) {
        repos.practice.removeById('demo-onboarding-record').then(() => {
          if (typeof window.syncPracticeRecords === 'function') {
            window.syncPracticeRecords({ forceRender: true });
          } else if (window.app && typeof window.app.renderPracticeHistory === 'function') {
            window.app.renderPracticeHistory();
          } else {
            window.dispatchEvent(new CustomEvent('practiceRecordsUpdated', { detail: { source: 'onboarding-cleanup' } }));
          }
        }).catch(err => {
          console.warn('[Onboarding] 清理示例记录失败:', err);
        });
      }
    }

    _showStepContent(step) {
      // 等待视图切换完成后再显示提示
      setTimeout(() => {
        // 隐藏提示框以重新定位
        this._renderer._tooltip?.classList.remove('is-visible');

        // 高亮目标元素
        const targetEl = step.target ? document.querySelector(step.target) : null;
        this._renderer.highlightElement(targetEl);

        // 定位提示框
        this._renderer.positionTooltip(targetEl, step.position);

        // 渲染内容
        if (step.id === 'welcome') {
          this._renderer.showWelcome(step);
        } else {
          this._renderer.renderTooltipContent(step, this._currentStep, this._steps.length);
        }

        // 绑定按钮事件
        this._bindButtonActions();
      }, 100);
    }

    _waitForElement(selector, callback, maxWait = 5000) {
      const startTime = Date.now();

      const check = () => {
        const el = document.querySelector(selector);
        if (el) {
          callback();
          return;
        }

        if (Date.now() - startTime > maxWait) {
          // 超时后跳过该步骤
          console.warn(`[Onboarding] 等待元素超时: ${selector}`);
          if (this._inSubSteps) {
            this._currentSubStep++;
            const parentStep = this._steps[this._currentStep];
            if (parentStep && parentStep.subSteps) {
              if (this._currentSubStep >= parentStep.subSteps.length) {
                this._inSubSteps = false;
                this._currentStep++;
              }
            }
          } else {
            this._currentStep++;
          }
          this._showCurrentStep();
          return;
        }

        setTimeout(check, 200);
      };

      check();
    }

    _bindButtonActions() {
      const tooltip = this._renderer._tooltip;
      if (!tooltip) return;

      tooltip.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const action = e.target.dataset.action;

          switch (action) {
            case 'next':
              this._next();
              break;
            case 'prev':
              this._prev();
              break;
            case 'skip':
              this._skip();
              break;
          }
        });
      });
    }

    _next() {
      // 如果当前在子步骤中
      if (this._inSubSteps) {
        const parentStep = this._steps[this._currentStep];
        if (parentStep && parentStep.subSteps) {
          this._currentSubStep++;
          if (this._currentSubStep >= parentStep.subSteps.length) {
            this._inSubSteps = false;
            this._currentStep++;
          }
          this._showCurrentStep();
          return;
        }
      }

      if (this._currentStep >= this._steps.length - 1) {
        this._complete();
        return;
      }
      this._currentStep++;
      this._showCurrentStep();
    }

    _prev() {
      // 如果当前在子步骤中
      if (this._inSubSteps) {
        if (this._currentSubStep > 0) {
          this._currentSubStep--;
          const parentStep = this._steps[this._currentStep];
          if (parentStep && parentStep.subSteps) {
            this._showSubStep(parentStep);
          }
          return;
        }
        // 如果已经在第一个子步骤，返回到上一个主步骤
        this._inSubSteps = false;
      }

      if (this._currentStep <= 0) return;
      this._currentStep--;
      this._showCurrentStep();
    }

    _skip() {
      this._cleanupDemoRecord();
      this._complete();
    }

    _complete() {
      this._cleanupDemoRecord();
      this._stateManager.markCompleted();
      this.stop();
    }

    _handleKeydown(e) {
      switch (e.key) {
        case 'Escape':
          this._skip();
          break;
        case 'ArrowRight':
          this._next();
          break;
        case 'ArrowLeft':
          this._prev();
          break;
      }
    }
  }

  // 全局暴露
  const tour = new OnboardingTour();

  global.OnboardingTour = {
    init: () => tour.init(),
    start: (fromBeginning) => tour.start(fromBeginning),
    stop: () => tour.stop(),
    reset: () => tour.reset(),
    getStatus: () => tour.getStatus(),
    goToStep: (step) => tour.goToStep(step),
    registerSteps: (steps) => tour.registerSteps(steps)
  };

})(typeof window !== 'undefined' ? window : globalThis);
