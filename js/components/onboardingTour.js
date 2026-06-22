/**
 * Onboarding Tour - 首次引导流程组件
 * 用于引导新用户了解系统各项功能
 * 兼容 file:// 协议
 */
(function (global) {
  'use strict';

  const MAX_ONBOARDING_STEPS = 100;
  const MAX_ONBOARDING_SUB_STEPS = 20;
  const MAX_ONBOARDING_ID_LENGTH = 80;
  const MAX_ONBOARDING_TEXT_LENGTH = 800;
  const MAX_ONBOARDING_BUTTON_TEXT_LENGTH = 80;
  const MAX_ONBOARDING_SELECTOR_LENGTH = 240;
  const ALLOWED_ONBOARDING_POSITIONS = new Set(['top', 'bottom', 'left', 'right', 'center']);
  const ALLOWED_ONBOARDING_VIEWS = new Set(['overview', 'browse', 'practice', 'more', 'settings']);

  function summarizeOnboardingErrorForLog(error) {
    if (!error || typeof error !== 'object') {
      return { name: typeof error };
    }
    const status = Number(error.status);
    return {
      name: typeof error.name === 'string' && error.name ? error.name.slice(0, 80) : 'Error',
      status: Number.isFinite(status) ? status : undefined
    };
  }

  // 存储键名
  const STORAGE_KEYS = {
    COMPLETED: 'onboardingCompleted',
    CURRENT_STEP: 'onboardingStep',
    LAST_SHOWN: 'onboardingLastShown'
  };

  function safeQuerySelector(selector) {
    if (!selector || typeof document === 'undefined') {
      return null;
    }
    const safeSelector = normalizeOnboardingSelector(selector);
    if (!safeSelector) {
      return null;
    }
    try {
      return document.querySelector(safeSelector);
    } catch (_) {
      return null;
    }
  }

  function truncateOnboardingText(value, maxLength, fallback = '') {
    const text = String(value ?? fallback)
      .replace(/[\u0000-\u001F\u007F]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length <= maxLength) {
      return text;
    }
    let truncated = text.slice(0, maxLength);
    if (/[\uD800-\uDBFF]$/.test(truncated)) {
      truncated = truncated.slice(0, -1);
    }
    return truncated;
  }

  function normalizeOnboardingSelector(value) {
    const selector = String(value ?? '')
      .replace(/[\u0000-\u001F\u007F]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!selector || selector.length > MAX_ONBOARDING_SELECTOR_LENGTH) {
      return null;
    }
    return selector;
  }

  function normalizeOnboardingPosition(value) {
    const position = truncateOnboardingText(value, 16).toLowerCase();
    return ALLOWED_ONBOARDING_POSITIONS.has(position) ? position : 'right';
  }

  function normalizeOnboardingView(value) {
    const view = truncateOnboardingText(value, 32).toLowerCase();
    return ALLOWED_ONBOARDING_VIEWS.has(view) ? view : null;
  }

  function normalizeOnboardingOffset(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return 0;
    }
    return Math.max(-200, Math.min(200, Math.trunc(number)));
  }

  function normalizeOnboardingStep(step, allowSubSteps = true) {
    if (!step || typeof step !== 'object') {
      return null;
    }
    const normalized = {
      id: truncateOnboardingText(step.id, MAX_ONBOARDING_ID_LENGTH, 'step'),
      target: normalizeOnboardingSelector(step.target),
      title: truncateOnboardingText(step.title, MAX_ONBOARDING_TEXT_LENGTH),
      content: truncateOnboardingText(step.content, MAX_ONBOARDING_TEXT_LENGTH),
      position: normalizeOnboardingPosition(step.position),
      showSkip: step.showSkip === true,
      showPrev: step.showPrev === true,
      nextText: truncateOnboardingText(step.nextText, MAX_ONBOARDING_BUTTON_TEXT_LENGTH),
      activateView: normalizeOnboardingView(step.activateView),
      action: truncateOnboardingText(step.action, MAX_ONBOARDING_ID_LENGTH),
      lockScroll: step.lockScroll === true,
      lockPointer: step.lockPointer === true,
      waitForClick: step.waitForClick === true,
      hideNext: step.hideNext === true,
      waitForElement: normalizeOnboardingSelector(step.waitForElement),
      triggerElement: normalizeOnboardingSelector(step.triggerElement),
      disableHighlightPointer: step.disableHighlightPointer === true,
      offsetY: normalizeOnboardingOffset(step.offsetY)
    };
    if (allowSubSteps && Array.isArray(step.subSteps)) {
      normalized.subSteps = step.subSteps
        .slice(0, MAX_ONBOARDING_SUB_STEPS)
        .map((subStep) => normalizeOnboardingStep(subStep, false))
        .filter(Boolean);
    }
    return normalized;
  }

  function normalizeOnboardingSteps(steps, fallbackSteps = DEFAULT_STEPS) {
    const source = Array.isArray(steps) && steps.length ? steps : fallbackSteps;
    return source
      .slice(0, MAX_ONBOARDING_STEPS)
      .map((step) => normalizeOnboardingStep(step))
      .filter(Boolean);
  }

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
          waitForClick: true,
          hideNext: true        // 隐藏下一步按钮，强制点击目标
        },
        {
          id: 'modal-opened',
          title: '📋 练习记录详情',
          content: '这里是练习记录详情弹窗，您可以看到本次练习的详细信息和成绩。',
          target: '#practice-record-modal .modal-container',
          position: 'right',
          nextText: '下一步',
          waitForElement: '#practice-record-modal',
          lockScroll: true,
          lockPointer: true     // 禁止点击详情内的入口
        },
        {
          id: 'click-review-mode',
          title: '📖 进入回顾模式',
          content: '点击上方标题（回顾模式触发器），可以进入该记录的回放/回顾模式。',
          target: '#practice-record-modal .record-summary-replay-trigger',
          position: 'bottom',
          nextText: '下一步',
          waitForClick: true,
          hideNext: true,       // 隐藏下一步按钮，强制点击触发器
          lockScroll: true
        },
        {
          id: 'review-mode-active',
          title: '👋 小贴士',
          content: '该练习记录缺少数据哦，等待您的数据后即可使用回顾模式。',
          target: null,
          position: 'center',
          nextText: '我知道了',
          lockScroll: true
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
      showSkip: true,
      showPrev: true,
      nextText: '下一步',
      activateView: 'settings'
    },
    {
      id: 'data-management',
      title: '💾 数据迁移与管理',
      content: '这里是数据安全的核心。当系统发布新版本时，您可以通过导出和导入功能轻松搬家。',
      position: 'right',
      showSkip: true,
      showPrev: true,
      nextText: '下一步',
      activateView: 'settings',
      subSteps: [
        {
          id: 'data-mgmt-intro',
          target: '.data-management-panel',
          title: '📂 数据管理面板',
          content: '集中管理您的练习资产。在转移到新版本前，请务必先备份或导出。',
          position: 'right',
          nextText: '下一步',
          lockScroll: true
        },
        {
          id: 'export-data',
          target: '#export-data-btn',
          title: '📤 导出数据',
          content: '点击“导出数据”，系统会生成包含所有练习历史的 JSON 文件。请妥善保存此文件，它是您迁移到新版本的通行证。',
          position: 'top',
          nextText: '下一步',
          lockScroll: true,
          disableHighlightPointer: true,
          offsetY: 10
        },
        {
          id: 'import-data',
          target: '#import-data-btn',
          title: '📥 导入数据',
          content: '在下载并运行新版本后，点击“导入数据”并选择之前导出的 JSON 文件，即可一键找回所有练习历史。',
          position: 'top',
          nextText: '下一步',
          lockScroll: true,
          disableHighlightPointer: true
        }
      ]
    },
    {
      id: 'theme-switcher-guide',
      target: '#theme-switcher-btn-entry',
      title: '🎨 主题切换',
      content: '当您使用动态背景遇到卡顿时可切换为静态主题',
      position: 'top',
      showSkip: true,
      showPrev: true,
      nextText: '下一步',
      activateView: 'settings',
      disableHighlightPointer: true
    },
    {
      id: 'completion',
      target: null,
      title: '🎉 恭喜完成！',
      content: '您已了解系统的所有核心功能。现在开始您的雅思备考之旅吧！祝您取得理想的成绩。',
      position: 'center',
      showSkip: false,
      showPrev: true,
      nextText: '开始练习',
      activateView: 'overview'
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

    highlightElement(el, options = {}) {
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
      el.style.pointerEvents = options.disablePointer ? 'none' : 'auto';

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

    positionTooltip(target, position, offsetY = 0) {
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
          top = rect.top - tooltipRect.height - gap - offsetY;
          left = rect.left + (rect.width - tooltipRect.width) / 2;
          this._addArrow('bottom');
          break;
        case 'bottom':
          top = rect.bottom + gap + offsetY;
          left = rect.left + (rect.width - tooltipRect.width) / 2;
          this._addArrow('top');
          break;
        case 'left':
          top = rect.top + (rect.height - tooltipRect.height) / 2;
          left = rect.left - tooltipRect.width - gap - offsetY;
          this._addArrow('right');
          break;
        case 'right':
        default:
          top = rect.top + (rect.height - tooltipRect.height) / 2;
          left = rect.right + gap + offsetY;
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

    _appendTextElement(parent, tagName, className, text) {
      const element = document.createElement(tagName);
      if (className) {
        element.className = className;
      }
      element.textContent = String(text || '');
      parent.appendChild(element);
      return element;
    }

    _createActionButton(action, text, modifierClass) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `onboarding-tooltip__btn ${modifierClass}`;
      button.dataset.action = action;
      button.textContent = String(text || '');
      return button;
    }

    _appendVisible() {
      requestAnimationFrame(() => {
        this._tooltip?.classList.add('is-visible');
      });
    }

    renderTooltipContent(step, current, total) {
      if (!this._tooltip) return;

      const safeTotal = Number.isFinite(Number(total)) && Number(total) > 0 ? Number(total) : 1;
      const safeCurrent = Math.min(Math.max(Number(current) || 0, 0), safeTotal - 1);
      const progressPercent = Math.min(Math.max(((safeCurrent + 1) / safeTotal) * 100, 0), 100);
      const nextText = step.nextText || '下一步';

      const progress = document.createElement('div');
      progress.className = 'onboarding-tooltip__progress';
      const progressBar = document.createElement('div');
      progressBar.className = 'onboarding-tooltip__progress-bar';
      const progressFill = document.createElement('div');
      progressFill.className = 'onboarding-tooltip__progress-fill';
      progressFill.style.width = `${progressPercent}%`;
      progressBar.appendChild(progressFill);
      progress.appendChild(progressBar);
      this._appendTextElement(progress, 'span', 'onboarding-tooltip__progress-text', `${safeCurrent + 1} / ${safeTotal}`);

      const title = document.createElement('h3');
      title.className = 'onboarding-tooltip__title';
      title.textContent = String(step.title || '');

      const content = document.createElement('p');
      content.className = 'onboarding-tooltip__content';
      content.textContent = String(step.content || '');

      const actions = document.createElement('div');
      actions.className = 'onboarding-tooltip__actions';
      if (step.showPrev) {
        actions.appendChild(this._createActionButton('prev', '上一步', 'onboarding-tooltip__btn--secondary'));
      } else {
        actions.appendChild(document.createElement('div'));
      }
      const rightActions = document.createElement('div');
      if (step.showSkip) {
        rightActions.appendChild(this._createActionButton('skip', '跳过', 'onboarding-tooltip__btn--skip'));
      }
      if (!step.hideNext) {
        rightActions.appendChild(this._createActionButton('next', nextText, 'onboarding-tooltip__btn--primary'));
      }
      actions.appendChild(rightActions);

      this._tooltip.replaceChildren(progress, title, content, actions);
      this._appendVisible();
    }

    showWelcome(step) {
      if (!this._tooltip) return;

      const welcome = document.createElement('div');
      welcome.className = 'onboarding-welcome';
      this._appendTextElement(welcome, 'div', 'onboarding-welcome__icon', '🎓');
      this._appendTextElement(welcome, 'h3', 'onboarding-tooltip__title', step.title);
      this._appendTextElement(welcome, 'p', 'onboarding-tooltip__content', step.content);
      const nextButton = this._createActionButton('next', step.nextText || '下一步', 'onboarding-tooltip__btn--primary');
      nextButton.style.marginTop = '16px';
      welcome.appendChild(nextButton);
      this._tooltip.replaceChildren(welcome);
      this._appendVisible();
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
      this._steps = normalizeOnboardingSteps(config.steps, DEFAULT_STEPS);
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
      this._steps = normalizeOnboardingSteps(steps, DEFAULT_STEPS);
      if (this._currentStep >= this._steps.length) {
        this._currentStep = Math.max(0, this._steps.length - 1);
      }
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
        const navBtn = safeQuerySelector(selector);
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
        const targetView = safeQuerySelector(viewSelector);
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
          const triggerEl = safeQuerySelector(step.triggerElement);
          if (triggerEl) {
            triggerEl.click();
          }
        }
        this._waitForElement(step.target, () => {
          this._showStepContent(step);
        });
        return;
      }

      // 应用滚动锁与指针锁
      if (step.lockScroll) {
        this._lockScroll();
      } else {
        this._unlockScroll();
      }

      if (step.lockPointer && !step.waitForClick) {
        this._lockPointer();
      } else {
        this._unlockPointer();
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
        if (subStep.lockPointer) {
          this._lockPointer();
        } else {
          this._unlockPointer();
        }

        const targetEl = subStep.target ? safeQuerySelector(subStep.target) : null;
        this._renderer.highlightElement(targetEl, { disablePointer: subStep.disableHighlightPointer });
        this._renderer.positionTooltip(targetEl, subStep.position, subStep.offsetY);

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
          console.error('[Onboarding] demo record operation failed:', summarizeOnboardingErrorForLog(err));
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
          console.warn('[Onboarding] demo record operation failed:', summarizeOnboardingErrorForLog(err));
        });
      }
    }

    _showStepContent(step) {
      // 等待视图切换完成后再显示提示
      setTimeout(() => {
        // 隐藏提示框以重新定位
        this._renderer._tooltip?.classList.remove('is-visible');

        // 高亮目标元素
        const targetEl = step.target ? safeQuerySelector(step.target) : null;
        this._renderer.highlightElement(targetEl, { disablePointer: step.disableHighlightPointer });

        // 定位提示框
        this._renderer.positionTooltip(targetEl, step.position, step.offsetY);

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
        const el = safeQuerySelector(selector);
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
