/**
 * Onboarding Tour - 首次引导流程组件
 * 用于引导新用户了解系统各项功能
 * 兼容 file:// 协议
 *
 * 数据层约定（0.6.2-fix 之后）：
 * - 示例记录必须经 AppData.practice.completeAttempt，且具备 canonical examId
 * - 回放依赖 realData.answers（object map）+ correctAnswerMap
 * - 引导状态键使用 exam_system_ 前缀，并兼容迁移旧键
 */
(function (global) {
  'use strict';

  const DEMO_RECORD_ID = 'demo-onboarding-record';
  const PREFERRED_DEMO_EXAM_ID = 'p1-high-01';

  // 与 p1-high-01.js answerKey 保持一致，供完整回放 demo 使用
  const P1_HIGH_01_ANSWER_KEY = Object.freeze({
    q1: 'viii',
    q2: 'iv',
    q3: 'ix',
    q4: 'vi',
    q5: 'v',
    q6: 'vii',
    q7: 'iii',
    q8: 'x',
    q9: 'D',
    q10: 'E',
    q11: 'B',
    q12: 'G',
    q13: 'A'
  });

  const P1_HIGH_01_META = Object.freeze({
    examId: PREFERRED_DEMO_EXAM_ID,
    examTitle: 'A Brief History of Tea 茶叶简史',
    category: 'P1',
    frequency: '高频',
    type: 'reading'
  });

  const HISTORY_ITEM_SELECTOR =
    `#history-list .history-item.history-record-item[data-record-id="${DEMO_RECORD_ID}"]`;
  const HISTORY_TITLE_SELECTOR =
    `#history-list .history-record-item[data-record-id="${DEMO_RECORD_ID}"] .practice-record-title`;
  const REPLAY_TRIGGER_SELECTOR =
    '#practice-record-modal .record-summary-replay-trigger';

  // 默认步骤配置
  const DEFAULT_STEPS = [
    {
      id: 'welcome',
      target: null,
      title: '👋 欢迎使用 IELTS Atlas',
      content: '这是一个专为雅思备考设计的练习系统，提供阅读练习、练习回顾、词汇背诵和数据备份等功能。让我们快速了解一下各项功能吧！',
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
      content: '接下来我们将用一条示例练习记录，演示如何打开详情并进入回顾回放。',
      position: 'right',
      showSkip: true,
      showPrev: true,
      nextText: '下一步',
      activateView: 'practice',
      subSteps: [
        {
          id: 'inject-demo-record',
          action: 'injectDemoRecord',
          title: '📝 示例记录已添加',
          content: '我们已为您添加了一条可回放的示例练习记录，请点击“我知道了”继续。',
          target: HISTORY_ITEM_SELECTOR,
          position: 'right',
          nextText: '我知道了',
          lockScroll: true,
          lockPointer: true
        },
        {
          id: 'click-history-item',
          title: '👆 点击记录标题进入详情',
          content: '点击下方这条示例记录的标题，可以打开练习记录详情页。',
          target: HISTORY_TITLE_SELECTOR,
          position: 'right',
          nextText: '下一步',
          lockScroll: true,
          waitForClick: true,
          hideNext: true
        },
        {
          id: 'modal-opened',
          title: '📋 练习记录详情',
          content: '这里是练习记录详情弹窗，您可以看到本次练习的成绩与元数据。',
          target: '#practice-record-modal .modal-container',
          position: 'right',
          nextText: '下一步',
          waitForElement: '#practice-record-modal',
          lockScroll: true,
          lockPointer: true
        },
        {
          id: 'click-review-mode',
          title: '📖 进入回顾模式',
          content: '点击标题上的回顾触发器，将打开该记录的回放窗口（需允许浏览器弹窗）。',
          target: REPLAY_TRIGGER_SELECTOR,
          position: 'bottom',
          nextText: '下一步',
          waitForClick: true,
          hideNext: true,
          lockScroll: true
        },
        {
          id: 'review-mode-active',
          title: '✅ 回顾模式已打开',
          content: '示例回放窗口应已打开。您可在回放中查看答案对错；关闭练习窗口后点“继续”完成引导。',
          target: null,
          position: 'center',
          nextText: '继续',
          lockScroll: true,
          lockPointer: false
        }
      ]
    },
    {
      id: 'more',
      target: '#more-view',
      title: '🛠️ 更多工具',
      content: '访问全屏时钟、单词背诵和成就系统等辅助工具，全方位提升备考效率。',
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
      content: '这里是数据安全的核心。可通过导出/导入 JSON，或使用本地磁盘备份在版本升级时搬家。',
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
          content: '集中管理您的练习资产。升级或更换设备前，请务必先备份或导出。',
          position: 'right',
          nextText: '下一步',
          lockScroll: true
        },
        {
          id: 'export-data',
          target: '#export-data-btn',
          title: '📤 导出数据',
          content: '点击“导出数据”，系统会生成包含练习历史的 JSON 文件。请妥善保存，它是迁移到新版本的通行证。',
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
          content: '在新版本中点击“导入数据”并选择之前导出的 JSON 文件，即可找回练习历史。',
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
      content: '动态背景卡顿时可切换为静态主题，减轻设备负担。',
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
      content: '您已了解系统的核心功能。现在开始您的雅思备考之旅吧！祝您取得理想的成绩。',
      position: 'center',
      showSkip: false,
      showPrev: true,
      nextText: '开始练习',
      activateView: 'overview'
    }
  ];

  function cloneMap(source) {
    return Object.assign({}, source || {});
  }

  function cloneArray(list) {
    return Array.isArray(list) ? list.slice() : [];
  }

  function cloneSteps(steps) {
    return (Array.isArray(steps) ? steps : []).map((step) => {
      const next = Object.assign({}, step);
      if (Array.isArray(step.subSteps)) {
        next.subSteps = step.subSteps.map((sub) => Object.assign({}, sub));
      }
      return next;
    });
  }

  // 状态管理器
  class TourStateManager {
    constructor() {
      this._state = { completed: false, currentStep: 0, lastShown: null };
      this.ready = this._load();
    }

    async _load() {
      if (!global.AppData || !global.AppData.preferences) return;
      await global.AppData.ready;
      const stored = await global.AppData.preferences.getOnboarding();
      this._state = {
        completed: stored.completed === true || stored.completed === 'true',
        currentStep: Number.isFinite(Number(stored.currentStep)) ? Number(stored.currentStep) : 0,
        lastShown: stored.lastShown || null
      };
    }

    _persist() {
      if (!global.AppData || !global.AppData.preferences) return;
      global.AppData.preferences.setOnboarding(this._state).catch((error) => {
        console.warn('[Onboarding] 保存引导状态失败:', error);
      });
    }

    isCompleted() {
      return this._state.completed === true;
    }

    getCurrentStep() {
      return this._state.currentStep || 0;
    }

    setStep(step) {
      this._state.currentStep = Number(step) || 0;
      this._state.lastShown = Date.now();
      this._persist();
    }

    markCompleted() {
      this._state.completed = true;
      this._state.currentStep = 0;
      this._persist();
    }

    reset() {
      this._state = { completed: false, currentStep: 0, lastShown: null };
      this._persist();
    }
  }

  // 渲染器
  class TourRenderer {
    constructor() {
      this._overlay = null;
      this._tooltip = null;
      this._highlightEl = null;
      this._holeEl = null;
    }

    createOverlay() {
      if (this._overlay) return this._overlay;

      this._overlay = document.createElement('div');
      this._overlay.className = 'onboarding-overlay';
      this._overlay.style.pointerEvents = 'none';
      document.body.appendChild(this._overlay);

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

      // 由 OnboardingTour 在锁滚前完成 scrollIntoView；此处仅测量与高亮
      if (!options.skipScroll) {
        el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
      }

      const rect = el.getBoundingClientRect();

      if (this._holeEl) {
        this._holeEl.style.display = 'block';
        this._holeEl.style.top = rect.top + 'px';
        this._holeEl.style.left = rect.left + 'px';
        this._holeEl.style.width = rect.width + 'px';
        this._holeEl.style.height = rect.height + 'px';
      }

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

      el.style.position = 'relative';
      el.style.zIndex = '100006';
      el.style.pointerEvents = options.disablePointer ? 'none' : 'auto';

      el.classList.add('onboarding-highlight');
    }

    clearHighlight() {
      if (this._highlightEl) {
        const el = this._highlightEl;
        el.classList.remove('onboarding-highlight');

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

      if (this._holeEl) {
        this._holeEl.style.display = 'none';
      }
    }

    positionTooltip(target, position, offsetY = 0) {
      if (!this._tooltip) return;

      const oldArrow = this._tooltip.querySelector('.onboarding-tooltip__arrow');
      if (oldArrow) oldArrow.remove();

      if (!target || position === 'center') {
        this._tooltip.style.position = 'fixed';
        this._tooltip.style.top = '50%';
        this._tooltip.style.left = '50%';
        this._tooltip.style.transform = 'translate(-50%, -50%)';
        return;
      }

      const rect = target.getBoundingClientRect();
      const tooltipRect = this._tooltip.getBoundingClientRect();

      let top;
      let left;
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
            ${step.hideNext ? '' : `<button class="onboarding-tooltip__btn onboarding-tooltip__btn--primary" data-action="next">${step.nextText || '下一步'}</button>`}
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
        const overlay = this._overlay;
        overlay.classList.remove('is-active');
        setTimeout(() => overlay.remove(), 300);
        this._overlay = null;
      }
      if (this._holeEl) {
        this._holeEl.remove();
        this._holeEl = null;
      }
      if (this._tooltip) {
        const tooltip = this._tooltip;
        tooltip.classList.remove('is-visible');
        setTimeout(() => tooltip.remove(), 300);
        this._tooltip = null;
      }
    }
  }

  // 主类
  class OnboardingTour {
    constructor(config = {}) {
      this._stateManager = new TourStateManager();
      this._renderer = new TourRenderer();
      this._baseSteps = config.steps || DEFAULT_STEPS;
      this._steps = cloneSteps(this._baseSteps);
      this._currentStep = 0;
      this._isActive = false;
      this._boundKeyHandler = null;
      this._currentSubStep = 0;
      this._inSubSteps = false;
      this._demoInjectTask = null;
      this._demoCleanupPromise = null;
      this._lifecycleToken = 0;
      this._startTimer = null;
      this._selectorWaiters = new Set();
      this._lastDemoInjectResult = null;
      this._clickWaitCleanup = null;
      this._scrollBlocked = false;
      this._boundWheelBlock = null;
      this._boundTouchBlock = null;
      this._boundKeyScrollBlock = null;
      this._savedScrollTop = 0;
    }

    async init() {
      await this._stateManager.ready;
      if (this._stateManager.isCompleted()) {
        return;
      }

      this._startTimer = setTimeout(() => {
        this._startTimer = null;
        this.start();
      }, 1500);
    }

    start(fromBeginning = false) {
      if (this._isActive) return;

      // 每次启动使用步骤副本，避免限级回放补丁污染默认配置
      this._steps = cloneSteps(this._baseSteps);
      this._currentStep = fromBeginning ? 0 : this._stateManager.getCurrentStep();
      this._lifecycleToken += 1;
      this._isActive = true;
      this._inSubSteps = false;
      this._currentSubStep = 0;
      this._lastDemoInjectResult = null;

      this._renderer.createOverlay();
      this._renderer.createTooltip();

      // 全程滚动锁：启动即锁，仅在 stop 时解除，避免用户滚动导致高亮错位
      this._lockScroll();

      this._boundKeyHandler = this._handleKeydown.bind(this);
      document.addEventListener('keydown', this._boundKeyHandler);

      this._renderer._overlay.addEventListener('click', (e) => {
        e.stopPropagation();
      });

      this._showCurrentStep();
    }

    stop() {
      this._isActive = false;
      this._lifecycleToken += 1;
      if (this._startTimer !== null) {
        clearTimeout(this._startTimer);
        this._startTimer = null;
      }
      this._cancelSelectorWaits();
      this._clearDemoRecordPreview();
      void this._cleanupDemoRecord();
      this._clearClickWait();
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

    _lockScroll() {
      if (!document.body.classList.contains('onboarding-scroll-locked')) {
        this._savedScrollTop = window.scrollY || document.documentElement.scrollTop || 0;
        document.body.classList.add('onboarding-scroll-locked');
        document.documentElement.classList.add('onboarding-scroll-locked');
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
        document.body.style.position = 'fixed';
        document.body.style.top = `-${this._savedScrollTop}px`;
        document.body.style.left = '0';
        document.body.style.right = '0';
        document.body.style.width = '100%';
      }
      this._attachScrollBlockers();
    }

    _unlockScroll() {
      this._detachScrollBlockers();
      if (document.body.classList.contains('onboarding-scroll-locked')) {
        document.body.classList.remove('onboarding-scroll-locked');
        document.documentElement.classList.remove('onboarding-scroll-locked');
        document.body.style.overflow = '';
        document.documentElement.style.overflow = '';
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.left = '';
        document.body.style.right = '';
        document.body.style.width = '';
        const savedTop = this._savedScrollTop || 0;
        window.scrollTo(0, savedTop);
        this._savedScrollTop = 0;
      }
    }

    /**
     * 短暂解除 body fixed，以便 scrollIntoView 能把目标滚入视口，
     * 随即按新滚动位置重新上锁。引导期间用户滚动仍被拦截。
     */
    _scrollTargetIntoView(el) {
      if (!el || typeof el.scrollIntoView !== 'function') return;

      const wasLocked = document.body.classList.contains('onboarding-scroll-locked');
      if (wasLocked) {
        this._detachScrollBlockers();
        document.body.classList.remove('onboarding-scroll-locked');
        document.documentElement.classList.remove('onboarding-scroll-locked');
        document.body.style.overflow = '';
        document.documentElement.style.overflow = '';
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.left = '';
        document.body.style.right = '';
        document.body.style.width = '';
        window.scrollTo(0, this._savedScrollTop || 0);
      }

      try {
        el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
      } catch (_) {
        try {
          el.scrollIntoView(true);
        } catch (__) {}
      }

      // 无论是否曾锁定，引导激活期间都重新上锁到当前视口
      if (this._isActive) {
        this._lockScroll();
      }
    }

    _highlightTarget(el, options = {}) {
      if (el) {
        this._scrollTargetIntoView(el);
      } else if (this._isActive) {
        this._lockScroll();
      }
      this._renderer.highlightElement(el, Object.assign({}, options, { skipScroll: true }));
    }

    _attachScrollBlockers() {
      if (this._scrollBlocked) return;
      this._scrollBlocked = true;

      this._boundWheelBlock = (e) => {
        if (!this._isActive) return;
        // 提示框内部也不允许带动页面/列表滚动
        e.preventDefault();
      };
      this._boundTouchBlock = (e) => {
        if (!this._isActive) return;
        e.preventDefault();
      };
      this._boundKeyScrollBlock = (e) => {
        if (!this._isActive) return;
        const key = e.key;
        const scrollKeys = new Set([
          'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar',
          'ArrowUp', 'ArrowDown'
        ]);
        if (!scrollKeys.has(key)) return;
        // 左右方向键留给引导翻步；上下/空格/Pg 禁止滚动
        e.preventDefault();
      };

      document.addEventListener('wheel', this._boundWheelBlock, { passive: false, capture: true });
      document.addEventListener('touchmove', this._boundTouchBlock, { passive: false, capture: true });
      document.addEventListener('keydown', this._boundKeyScrollBlock, { capture: true });
    }

    _detachScrollBlockers() {
      if (!this._scrollBlocked) return;
      this._scrollBlocked = false;
      if (this._boundWheelBlock) {
        document.removeEventListener('wheel', this._boundWheelBlock, { capture: true });
        this._boundWheelBlock = null;
      }
      if (this._boundTouchBlock) {
        document.removeEventListener('touchmove', this._boundTouchBlock, { capture: true });
        this._boundTouchBlock = null;
      }
      if (this._boundKeyScrollBlock) {
        document.removeEventListener('keydown', this._boundKeyScrollBlock, { capture: true });
        this._boundKeyScrollBlock = null;
      }
    }

    _lockPointer() {
      if (!document.getElementById('onboarding-pointer-intercept')) {
        const intercept = document.createElement('div');
        intercept.id = 'onboarding-pointer-intercept';
        intercept.style.cssText = [
          'position: fixed',
          'inset: 0',
          'z-index: 99998',
          'background: transparent',
          'pointer-events: all',
          'cursor: not-allowed'
        ].join(';');
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
        totalSteps: this._steps.length,
        demoInject: this._lastDemoInjectResult
      };
    }

    goToStep(step) {
      if (step < 0 || step >= this._steps.length) return;
      this._currentStep = step;
      this._inSubSteps = false;
      this._currentSubStep = 0;
      this._stateManager.setStep(step);
      this._showCurrentStep();
    }

    registerSteps(steps) {
      this._baseSteps = steps;
      this._steps = cloneSteps(steps);
    }

    _activateView(viewId) {
      if (!viewId) return;

      const navMap = {
        overview: '[data-view="overview"]',
        browse: '[data-view="browse"]',
        practice: '[data-view="practice"]',
        more: '[data-view="more"]',
        settings: '[data-view="settings"]'
      };

      const selector = navMap[viewId];
      if (selector) {
        const navBtn = document.querySelector(selector);
        if (navBtn) {
          navBtn.click();
          return;
        }
      }

      const viewMap = {
        overview: '#overview-view',
        browse: '#browse-view',
        practice: '#practice-view',
        more: '#more-view',
        settings: '#settings-view'
      };

      const viewSelector = viewMap[viewId];
      if (viewSelector) {
        const targetView = document.querySelector(viewSelector);
        if (targetView) {
          document.querySelectorAll('.view-container, [id$="-view"]').forEach(v => {
            v.style.display = 'none';
          });
          targetView.style.display = 'block';
        }
      }
    }

    _showCurrentStep() {
      if (!this._isActive) return;

      const step = this._steps[this._currentStep];
      if (!step) {
        this._complete();
        return;
      }

      this._stateManager.setStep(this._currentStep);
      this._clearClickWait();
      this._activateView(step.activateView);

      if (step.subSteps && !this._inSubSteps) {
        this._inSubSteps = true;
        this._currentSubStep = 0;
      }

      if (this._inSubSteps && step.subSteps) {
        this._showSubStep(step);
        return;
      }

      if (step.waitForElement && step.target) {
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

      // 全程保持滚动锁；仅按步骤控制指针锁
      this._lockScroll();

      if (step.lockPointer && !step.waitForClick) {
        this._lockPointer();
      } else {
        this._unlockPointer();
      }

      this._showStepContent(step);
    }

    _showSubStep(parentStep) {
      if (!this._isActive) return;

      const subStep = parentStep.subSteps[this._currentSubStep];
      if (!subStep) {
        this._inSubSteps = false;
        this._currentStep++;
        this._showCurrentStep();
        return;
      }

      this._clearClickWait();

      const proceed = () => {
        if (!this._isActive) return;

        if (subStep.waitForElement) {
          this._waitForElement(subStep.waitForElement, () => {
            this._showSubStepContent(subStep, parentStep);
          });
          return;
        }

        this._showSubStepContent(subStep, parentStep);
      };

      if (subStep.action === 'injectDemoRecord') {
        const lifecycleToken = this._lifecycleToken;
        Promise.resolve(this._injectDemoRecord())
          .then((result) => {
            if (!this._isDemoLifecycleCurrent(lifecycleToken)) return;
            this._lastDemoInjectResult = result;
            if (!result || !result.ok) {
              this._showInjectFailureSubStep(parentStep, result);
              return;
            }
            if (!result.replayable) {
              // 已写入历史，但 exam 不在题库中：保留点击详情，跳过强制回放
              this._patchReviewSubStepsForLimitedDemo(parentStep);
            }
            proceed();
          })
          .catch((err) => {
            if (!this._isDemoLifecycleCurrent(lifecycleToken)) return;
            console.error('[Onboarding] 注入示例记录失败:', err);
            this._lastDemoInjectResult = { ok: false, reason: 'exception', error: err };
            this._showInjectFailureSubStep(parentStep, this._lastDemoInjectResult);
          });
        return;
      }

      proceed();
    }

    _patchReviewSubStepsForLimitedDemo(parentStep) {
      if (!parentStep || !Array.isArray(parentStep.subSteps)) return;
      parentStep.subSteps = parentStep.subSteps.map((step) => {
        if (step.id === 'inject-demo-record') {
          return Object.assign({}, step, {
            content: '示例记录已写入练习历史。当前题库中未找到对应题目，详情可打开，完整回放需先加载阅读题库。'
          });
        }
        if (step.id === 'click-review-mode') {
          return Object.assign({}, step, {
            content: '可尝试点击回顾触发器。若提示题目不存在，请先在题库浏览中加载阅读题库后再体验完整回放。',
            waitForClick: false,
            hideNext: false,
            nextText: '跳过回放',
            lockPointer: true
          });
        }
        if (step.id === 'review-mode-active') {
          return Object.assign({}, step, {
            title: 'ℹ️ 回放需完整题库',
            content: '示例记录已保存。加载阅读题库后，可从练习记录详情再次进入回顾模式。',
            nextText: '继续'
          });
        }
        return step;
      });
    }

    _showInjectFailureSubStep(parentStep, result) {
      // 失败提示仍保持滚动锁，避免页面漂移
      this._lockScroll();
      this._unlockPointer();
      this._renderer.clearHighlight();
      this._renderer.positionTooltip(null, 'center');

      const reason = result && result.reason ? String(result.reason) : 'unknown';
      const failureStep = {
        id: 'inject-demo-failed',
        title: '示例记录未能写入',
        content: `练习数据层暂不可用（${reason}）。您可跳过回顾演示，继续了解其他功能。`,
        showSkip: true,
        showPrev: false,
        nextText: '跳过回顾',
        hideNext: false
      };

      this._renderer.renderTooltipContent(failureStep, this._currentSubStep, parentStep.subSteps.length);
      const tooltip = this._renderer._tooltip;
      if (!tooltip) {
        this._skipReviewMode(parentStep);
        return;
      }

      tooltip.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const action = e.target.dataset.action;
          if (action === 'skip' || action === 'next') {
            this._skipReviewMode(parentStep);
          }
        });
      });
    }

    _skipReviewMode(parentStep) {
      this._inSubSteps = false;
      this._currentSubStep = 0;
      this._currentStep++;
      this._cleanupDemoRecord();
      this._showCurrentStep();
    }

    _showSubStepContent(subStep, parentStep) {
      const delay = (subStep.action === 'injectDemoRecord') ? 120 : 100;
      setTimeout(() => {
        if (!this._isActive) return;

        this._renderer._tooltip?.classList.remove('is-visible');

        // 全程滚动锁；步骤切换时重新确认锁定
        this._lockScroll();

        if (subStep.lockPointer) {
          this._lockPointer();
        } else {
          this._unlockPointer();
        }

        const targetEl = subStep.target ? document.querySelector(subStep.target) : null;
        this._highlightTarget(targetEl, { disablePointer: subStep.disableHighlightPointer });
        this._renderer.positionTooltip(targetEl, subStep.position, subStep.offsetY);

        const totalSteps = parentStep.subSteps.length;
        this._renderer.renderTooltipContent(subStep, this._currentSubStep, totalSteps);
        this._bindSubStepButtonActions(parentStep);

        if (subStep.waitForClick) {
          if (!targetEl) {
            // 目标丢失时不卡死：显示下一步
            return;
          }
          this._waitForElementClick(targetEl, () => {
            // 点击后不解锁滚动，保持高亮坐标系稳定
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

    _clearClickWait() {
      if (typeof this._clickWaitCleanup === 'function') {
        try {
          this._clickWaitCleanup();
        } catch (_) {}
      }
      this._clickWaitCleanup = null;
    }

    _waitForElementClick(element, callback) {
      this._clearClickWait();
      if (!element) {
        callback();
        return;
      }

      const handler = () => {
        this._clearClickWait();
        callback();
      };

      element.addEventListener('click', handler);
      this._clickWaitCleanup = () => {
        element.removeEventListener('click', handler);
      };
    }

    async _resolveDemoExamContext() {
      const preferredId = PREFERRED_DEMO_EXAM_ID;
      let list = [];

      try {
        list = await global.resolveActiveLibraryIndex();
      } catch (_) { }

      if (!Array.isArray(list)) list = [];

      const preferred = list.find((exam) => exam && String(exam.id) === preferredId);
      if (preferred) {
        return {
          examId: preferredId,
          title: preferred.title || P1_HIGH_01_META.examTitle,
          category: preferred.category || P1_HIGH_01_META.category,
          frequency: preferred.frequency || P1_HIGH_01_META.frequency,
          type: preferred.type || 'reading',
          inIndex: true,
          useFullAnswerKey: true
        };
      }

      const reading = list.find((exam) => {
        if (!exam || !exam.id) return false;
        const type = String(exam.type || exam.examType || '').toLowerCase();
        const category = String(exam.category || '').toUpperCase();
        return type === 'reading' || category === 'P1' || category === 'P2' || category === 'P3';
      });

      if (reading) {
        return {
          examId: String(reading.id),
          title: reading.title || String(reading.id),
          category: reading.category || 'P1',
          frequency: reading.frequency || 'unknown',
          type: reading.type || 'reading',
          inIndex: true,
          useFullAnswerKey: String(reading.id) === preferredId
        };
      }

      // 题库未加载：仍写入 preferred examId，便于用户稍后加载题库后回放
      return {
        examId: preferredId,
        title: P1_HIGH_01_META.examTitle,
        category: P1_HIGH_01_META.category,
        frequency: P1_HIGH_01_META.frequency,
        type: 'reading',
        inIndex: false,
        useFullAnswerKey: true
      };
    }

    _buildDemoUserAnswers(correctMap) {
      const userAnswers = cloneMap(correctMap);
      // 故意答错若干题，便于回放中看到对错对比
      if (userAnswers.q3) userAnswers.q3 = 'ii';
      if (userAnswers.q7) userAnswers.q7 = 'i';
      if (userAnswers.q9) userAnswers.q9 = 'A';
      if (userAnswers.q12) userAnswers.q12 = 'C';
      if (userAnswers.q13) userAnswers.q13 = 'B';
      return userAnswers;
    }

    _countCorrect(userAnswers, correctMap) {
      const keys = Object.keys(correctMap || {});
      let correct = 0;
      keys.forEach((key) => {
        const user = String(userAnswers[key] == null ? '' : userAnswers[key]).trim().toLowerCase();
        const expected = String(correctMap[key] == null ? '' : correctMap[key]).trim().toLowerCase();
        if (user && expected && user === expected) {
          correct += 1;
        }
      });
      return correct;
    }

    _buildDemoRecord(examContext) {
      const end = new Date();
      const start = new Date(end.getTime() - 20 * 60 * 1000);
      const correctMap = examContext.useFullAnswerKey
        ? cloneMap(P1_HIGH_01_ANSWER_KEY)
        : {
            q1: 'A',
            q2: 'B',
            q3: 'C'
          };
      const userAnswers = this._buildDemoUserAnswers(correctMap);
      const totalQuestions = Object.keys(correctMap).length;
      const correctAnswers = this._countCorrect(userAnswers, correctMap);
      const accuracy = totalQuestions > 0 ? correctAnswers / totalQuestions : 0;
      const percentage = Math.round(accuracy * 100);
      const markedQuestions = ['q3', 'q9'].filter((key) => Object.prototype.hasOwnProperty.call(correctMap, key));
      const examId = examContext.examId;
      const title = `示例练习 - ${examContext.title || examId}`;
      const scoreInfo = {
        correct: correctAnswers,
        total: totalQuestions,
        accuracy,
        percentage,
        source: 'onboarding-demo'
      };

      const answerComparison = {};
      Object.keys(correctMap).forEach((key) => {
        const userAnswer = userAnswers[key] || '';
        const correctAnswer = correctMap[key] || '';
        answerComparison[key] = {
          userAnswer,
          correctAnswer,
          isCorrect: String(userAnswer).trim().toLowerCase() === String(correctAnswer).trim().toLowerCase()
        };
      });

      return {
        id: DEMO_RECORD_ID,
        examId,
        type: examContext.type || 'reading',
        title,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        date: end.toISOString(),
        duration: 1200,
        status: 'completed',
        score: correctAnswers,
        totalQuestions,
        correctAnswers,
        accuracy,
        metadata: {
          examId,
          examTitle: examContext.title || title,
          category: examContext.category || 'P1',
          frequency: examContext.frequency || '高频',
          type: examContext.type || 'reading',
          markedQuestions: cloneArray(markedQuestions),
          source: 'onboarding-demo'
        },
        frequency: examContext.frequency || '高频',
        // 顶层 map 会被 standardize 转为 answers[]；回放仍依赖 realData.answers
        answers: cloneMap(userAnswers),
        correctAnswerMap: cloneMap(correctMap),
        answerComparison,
        markedQuestions: cloneArray(markedQuestions),
        scoreInfo: Object.assign({}, scoreInfo),
        realData: {
          examId,
          answers: cloneMap(userAnswers),
          correctAnswerMap: cloneMap(correctMap),
          answerComparison,
          highlights: [],
          markedQuestions: cloneArray(markedQuestions),
          scrollY: 0,
          scoreInfo: Object.assign({}, scoreInfo),
          isRealData: true,
          source: 'onboarding-demo'
        },
        version: '0.6.2-fix'
      };
    }

    async _refreshPracticeHistory() {
      if (typeof global.syncPracticeRecords === 'function') {
        await Promise.resolve(global.syncPracticeRecords({ forceRender: true }));
        return;
      }
      if (global.app && typeof global.app.renderPracticeHistory === 'function') {
        await Promise.resolve(global.app.renderPracticeHistory());
        return;
      }
      global.dispatchEvent(new CustomEvent('practiceRecordsUpdated', {
        detail: { source: 'onboarding' }
      }));
    }

    _waitForSelector(selector, maxWait = 4000, lifecycleToken = this._lifecycleToken) {
      return new Promise((resolve) => {
        const startTime = Date.now();
        const waiter = { timer: null, settle: null };
        const settle = (value) => {
          if (!this._selectorWaiters.has(waiter)) return;
          if (waiter.timer !== null) clearTimeout(waiter.timer);
          this._selectorWaiters.delete(waiter);
          resolve(value);
        };
        const check = () => {
          waiter.timer = null;
          if (!this._isDemoLifecycleCurrent(lifecycleToken)) {
            settle(null);
            return;
          }
          const el = document.querySelector(selector);
          if (el) {
            settle(el);
            return;
          }
          if (Date.now() - startTime > maxWait) {
            settle(null);
            return;
          }
          waiter.timer = setTimeout(check, 120);
        };
        waiter.settle = settle;
        this._selectorWaiters.add(waiter);
        check();
      });
    }

    _cancelSelectorWaits() {
      for (const waiter of Array.from(this._selectorWaiters)) {
        waiter.settle(null);
      }
    }

    _isDemoLifecycleCurrent(token) {
      return this._isActive && token === this._lifecycleToken;
    }

    async _injectDemoRecord() {
      const lifecycleToken = this._lifecycleToken;
      if (this._demoInjectTask && this._demoInjectTask.token === lifecycleToken) {
        return this._demoInjectTask.promise;
      }

      const injectPromise = (async () => {
        const api = global.AppData && global.AppData.practice;
        if (!api || typeof api.completeAttempt !== 'function') {
          return { ok: false, reason: 'AppData.practice unavailable' };
        }

        const examContext = await this._resolveDemoExamContext();
        if (!this._isDemoLifecycleCurrent(lifecycleToken)) {
          return { ok: false, reason: 'cancelled' };
        }
        if (this._demoCleanupPromise) await this._demoCleanupPromise;
        if (!this._isDemoLifecycleCurrent(lifecycleToken)) {
          return { ok: false, reason: 'cancelled' };
        }
        const demoRecordObj = this._buildDemoRecord(examContext);

        // 演示记录带 metadata.source = 'onboarding-demo'，会被统一的来源判定
        // （js/data/practiceRecordSource.js）排除在练习记录列表、成绩统计与成就之外。
        // 引导需要用户看见这一行，所以显式为这一个 id 申请"视图层预览"许可：
        // 只放行渲染，投影器读不到该白名单，统计与成就仍然不会被演示数据污染。
        this._allowDemoRecordPreview();

        try {
          await api.completeAttempt({ record: demoRecordObj });
        } catch (err) {
          console.error('[Onboarding] 注入示例记录失败:', err);
          this._clearDemoRecordPreview();
          return {
            ok: false,
            reason: err && err.message ? err.message : 'saveRecord failed',
            error: err
          };
        }

        if (!this._isDemoLifecycleCurrent(lifecycleToken)) {
          if (this._demoCleanupPromise) await this._demoCleanupPromise;
          await this._cleanupDemoRecord({ refresh: false });
          return { ok: false, reason: 'cancelled' };
        }

        await this._refreshPracticeHistory();
        if (!this._isDemoLifecycleCurrent(lifecycleToken)) {
          if (this._demoCleanupPromise) await this._demoCleanupPromise;
          await this._cleanupDemoRecord({ refresh: false });
          return { ok: false, reason: 'cancelled' };
        }
        const row = await this._waitForSelector(HISTORY_ITEM_SELECTOR, 5000, lifecycleToken);
        if (!this._isDemoLifecycleCurrent(lifecycleToken)) {
          if (this._demoCleanupPromise) await this._demoCleanupPromise;
          await this._cleanupDemoRecord({ refresh: false });
          return { ok: false, reason: 'cancelled' };
        }
        if (!row) {
          return {
            ok: false,
            reason: 'history row not rendered',
            examId: examContext.examId,
            replayable: false
          };
        }

        return {
          ok: true,
          examId: examContext.examId,
          inIndex: Boolean(examContext.inIndex),
          replayable: Boolean(examContext.inIndex && examContext.useFullAnswerKey)
            || Boolean(examContext.inIndex),
          recordId: DEMO_RECORD_ID
        };
      })();
      this._demoInjectTask = { token: lifecycleToken, promise: injectPromise };

      try {
        return await injectPromise;
      } finally {
        if (this._demoInjectTask && this._demoInjectTask.promise === injectPromise) {
          this._demoInjectTask = null;
        }
      }
    }

    /**
     * 申请/撤销演示记录的"视图层预览"许可。
     * 见 js/data/practiceRecordSource.js 的引导预览白名单说明：许可只影响练习记录列表渲染，
     * practice.stats 与 achievements.progress 投影器永远按"演示数据"排除这条记录。
     */
    _allowDemoRecordPreview() {
      const classifier = global.PracticeRecordSource;
      if (classifier && typeof classifier.allowPreviewRecordId === 'function') {
        classifier.allowPreviewRecordId(DEMO_RECORD_ID);
      }
    }

    _clearDemoRecordPreview() {
      const classifier = global.PracticeRecordSource;
      if (classifier && typeof classifier.clearPreviewRecordId === 'function') {
        classifier.clearPreviewRecordId(DEMO_RECORD_ID);
      }
    }

    async _cleanupDemoRecord(options = {}) {
      // 先撤销预览许可再删除并重渲染：即使删除失败，这条演示记录也不会继续留在列表里。
      this._clearDemoRecordPreview();

      if (this._demoCleanupPromise) return this._demoCleanupPromise;

      const api = global.AppData && global.AppData.practice;
      if (!api || typeof api.delete !== 'function') {
        return;
      }

      const refresh = options.refresh !== false;
      const cleanupPromise = (async () => {
        try {
          await api.delete({ recordId: DEMO_RECORD_ID });
          if (!refresh) return;
          if (typeof global.syncPracticeRecords === 'function') {
            await Promise.resolve(global.syncPracticeRecords({ forceRender: true }));
          } else if (global.app && typeof global.app.renderPracticeHistory === 'function') {
            await Promise.resolve(global.app.renderPracticeHistory());
          } else {
            global.dispatchEvent(new CustomEvent('practiceRecordsUpdated', {
              detail: { source: 'onboarding-cleanup' }
            }));
          }
        } catch (err) {
          console.warn('[Onboarding] 清理示例记录失败:', err);
        }
      })();
      this._demoCleanupPromise = cleanupPromise;
      try {
        await cleanupPromise;
      } finally {
        if (this._demoCleanupPromise === cleanupPromise) this._demoCleanupPromise = null;
      }
    }

    _showStepContent(step) {
      setTimeout(() => {
        if (!this._isActive) return;

        this._renderer._tooltip?.classList.remove('is-visible');
        this._lockScroll();

        const targetEl = step.target ? document.querySelector(step.target) : null;
        this._highlightTarget(targetEl, { disablePointer: step.disableHighlightPointer });
        this._renderer.positionTooltip(targetEl, step.position, step.offsetY);

        if (step.id === 'welcome') {
          this._renderer.showWelcome(step);
        } else {
          this._renderer.renderTooltipContent(step, this._currentStep, this._steps.length);
        }

        this._bindButtonActions();
      }, 100);
    }

    _waitForElement(selector, callback, maxWait = 5000) {
      const startTime = Date.now();

      const check = () => {
        if (!this._isActive) return;

        const el = document.querySelector(selector);
        if (el) {
          callback();
          return;
        }

        if (Date.now() - startTime > maxWait) {
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
      if (this._inSubSteps) {
        if (this._currentSubStep > 0) {
          this._currentSubStep--;
          const parentStep = this._steps[this._currentStep];
          if (parentStep && parentStep.subSteps) {
            this._showSubStep(parentStep);
          }
          return;
        }
        this._inSubSteps = false;
      }

      if (this._currentStep <= 0) return;
      this._currentStep--;
      this._showCurrentStep();
    }

    _skip() {
      this._complete();
    }

    _complete() {
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
