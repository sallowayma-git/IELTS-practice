(function () {
  'use strict';

  if (typeof window.hpCore === 'undefined') {
    console.error('[hp-portal] hpCore missing');
    return;
  }

  const STORAGE_KEY = 'hp.portal.state';
  const VIEW_KEYS = ['overview', 'practice', 'history', 'settings'];
  const PRACTICE_VIRTUAL_THRESHOLD = 28;
  const BACKUP_STORAGE_KEY = 'hp.portal.backups';

  function consumePendingView() {
    try {
      const value = sessionStorage.getItem('hp.portal.pendingView');
      if (!value) return '';
      sessionStorage.removeItem('hp.portal.pendingView');
      return value.trim().toLowerCase();
    } catch (error) {
      console.warn('[hp-portal] 无法读取待激活视图', error);
      return '';
    }
  }

  function pickRandomItems(list, count) {
    const source = Array.isArray(list) ? list.filter(Boolean) : [];
    if (!source.length) return [];
    if (source.length <= count) return source.slice();
    const pool = source.slice();
    const result = [];
    const target = Math.max(0, Math.min(count, pool.length));
    for (let i = 0; i < target; i += 1) {
      const index = Math.floor(Math.random() * pool.length);
      const [item] = pool.splice(index, 1);
      result.push(item);
    }
    return result;
  }

  function formatDateTime(timestamp) {
    if (!timestamp) return '未知时间';
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }).format(new Date(timestamp));
    } catch (_) {
      return new Date(timestamp).toLocaleString();
    }
  }

  function formatFileTimestamp(date) {
    const pad = (value) => String(value).padStart(2, '0');
    const now = date instanceof Date ? date : new Date();
    const year = now.getFullYear();
    const month = pad(now.getMonth() + 1);
    const day = pad(now.getDate());
    const hour = pad(now.getHours());
    const minute = pad(now.getMinutes());
    const second = pad(now.getSeconds());
    return `${year}${month}${day}-${hour}${minute}${second}`;
  }

  function readState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {
      /* ignore quota errors */
    }
  }

  const Portal = {
    dom: {
      modal: null,
      modalTitle: null,
      modalBody: null,
      importInput: null
    },
    state: {
      activeView: 'overview',
      practiceFilter: { type: 'all', query: '' }
    },
    practiceVirtualizer: null,
    historySeries: null,
    storageKeys: {
      backups: BACKUP_STORAGE_KEY
    },

    init() {
      this.dom.root = document.getElementById('hp-portal-root');
      if (!this.dom.root) {
        console.warn('[hp-portal] portal root missing');
        return;
      }

      this.dom.navButtons = Array.from(document.querySelectorAll('[data-hp-view]'));
      this.dom.practiceList = this.dom.root.querySelector('#hp-practice-list');
      this.dom.practiceSearch = this.dom.root.querySelector('#hp-practice-search');
      this.dom.practiceTypeButtons = Array.from(this.dom.root.querySelectorAll('[data-practice-type]'));
      this.dom.practiceEmpty = document.getElementById('hp-practice-empty');
      this.dom.historyTable = this.dom.root.querySelector('#hp-history-table');
      this.dom.historyEmpty = this.dom.root.querySelector('#hp-history-empty');
      this.dom.historyChart = this.dom.root.querySelector('#hp-history-chart');
      this.dom.historyChartEmpty = this.dom.root.querySelector('#hp-history-chart-empty');
      this.dom.historyLevel = document.getElementById('hp-history-level');
      this.dom.historyProgressBar = document.getElementById('hp-history-progress');
      this.dom.historyProgressText = document.getElementById('hp-history-progress-text');
      this.dom.stats = {
        exams: document.getElementById('hp-stat-total-exams'),
        completed: document.getElementById('hp-stat-completed'),
        average: document.getElementById('hp-stat-average'),
        streak: document.getElementById('hp-stat-days'),
        updated: document.getElementById('hp-stat-updated')
      };
      this.dom.quickCards = document.getElementById('hp-quick-cards');
      this.dom.settingsButtons = Array.from(this.dom.root.querySelectorAll('[data-settings-action]'));
      this.dom.themeToggle = document.getElementById('hp-theme-toggle');
      this.dom.modal = document.getElementById('hp-settings-modal');
      this.dom.modalTitle = document.getElementById('hp-settings-modal-title');
      this.dom.modalBody = document.getElementById('hp-settings-modal-body');

      if (this.dom.modal) {
        this.dom.modal.addEventListener('click', (event) => {
          const dismissTarget = event.target.closest ? event.target.closest('[data-modal-dismiss]') : null;
          if (event.target === this.dom.modal || dismissTarget) {
            this.closeModal();
          }
        });
      }

      if (!this.dom.importInput) {
        this.dom.importInput = document.createElement('input');
        this.dom.importInput.type = 'file';
        this.dom.importInput.accept = 'application/json';
        this.dom.importInput.className = 'hidden';
        this.dom.importInput.addEventListener('change', (event) => this.handleImportChange(event));
        document.body.appendChild(this.dom.importInput);
      }

      this.restoreState();
      this.bindNav();
      this.bindPracticeFilters();
      this.bindSettings();
      this.bindThemeActions();
      this.bindThemeToggle();
      this.bindHash();

      this.activate(this.state.activeView || 'overview', false);
      this.renderAll();

      hpCore.on('dataUpdated', () => this.renderAll());
      window.showView = (viewName) => this.activate(viewName || 'overview');
      window.hpPortal = this;

      if (typeof window.createManualBackup !== 'function') {
        window.createManualBackup = () => this.createBackup();
      }
      if (typeof window.showBackupList !== 'function') {
        window.showBackupList = () => this.showBackupList();
      }
      if (typeof window.exportAllData !== 'function') {
        window.exportAllData = () => this.exportData();
      }
      if (typeof window.importData !== 'function') {
        window.importData = () => this.promptImport();
      }
      if (typeof window.showLibraryConfigListV2 !== 'function') {
        window.showLibraryConfigListV2 = () => this.showConfigList();
      }
      if (typeof window.loadLibrary !== 'function') {
        window.loadLibrary = (force) => this.reloadLibrary(!!force);
      }
    },

    restoreState() {
      const saved = readState();
      if (saved && typeof saved === 'object') {
        if (saved.activeView && VIEW_KEYS.includes(saved.activeView)) {
          this.state.activeView = saved.activeView;
        }
        if (saved.practiceFilter && typeof saved.practiceFilter === 'object') {
          this.state.practiceFilter = Object.assign({}, this.state.practiceFilter, saved.practiceFilter);
        }
      }

      const hashView = (window.location.hash || '').replace('#', '');
      if (hashView && VIEW_KEYS.includes(hashView)) {
        this.state.activeView = hashView;
        return;
      }

      const pendingView = consumePendingView();
      if (pendingView && VIEW_KEYS.includes(pendingView)) {
        this.state.activeView = pendingView;
        return;
      }

      try {
        const params = new URLSearchParams(window.location.search || '');
        const queryView = (params.get('view') || '').trim();
        if (queryView && VIEW_KEYS.includes(queryView)) {
          this.state.activeView = queryView;
        }
      } catch (error) {
        console.warn('[hp-portal] 解析视图参数失败', error);
      }
    },

    persistState() {
      writeState({
        activeView: this.state.activeView,
        practiceFilter: this.state.practiceFilter
      });
    },

    bindNav() {
      this.dom.navButtons.forEach((btn) => {
        btn.addEventListener('click', (event) => {
          event.preventDefault();
          const view = btn.getAttribute('data-hp-view');
          this.activate(view || 'overview');
        });
      });

      Array.from(document.querySelectorAll('[data-nav]')).forEach((el) => {
        el.addEventListener('click', (event) => {
          event.preventDefault();
          const target = (el.getAttribute('data-nav') || '').trim();
          this.activate(target || 'overview');
        });
      });
    },

    bindPracticeFilters() {
      if (this.dom.practiceSearch) {
        let timer = null;
        this.dom.practiceSearch.value = this.state.practiceFilter.query || '';
        this.dom.practiceSearch.addEventListener('input', (event) => {
          clearTimeout(timer);
          const value = (event.target.value || '').trim();
          timer = window.setTimeout(() => {
            this.state.practiceFilter.query = value;
            this.persistState();
            this.renderPractice();
          }, 150);
        });
      }

      this.dom.practiceTypeButtons.forEach((btn) => {
        const type = btn.getAttribute('data-practice-type');
        this.togglePracticeTab(btn, type === this.state.practiceFilter.type);
        btn.addEventListener('click', (event) => {
          event.preventDefault();
          this.state.practiceFilter.type = type;
          this.dom.practiceTypeButtons.forEach((item) => this.togglePracticeTab(item, item === btn));
          this.persistState();
          this.renderPractice();
        });
      });
    },

    togglePracticeTab(button, active) {
      if (!button) return;
      button.classList.toggle('text-white', !!active);
      button.classList.toggle('border-b-2', !!active);
      button.classList.toggle('border-white', !!active);
      button.classList.toggle('text-white/60', !active);
    },

    bindSettings() {
      this.dom.settingsButtons.forEach((btn) => {
        btn.addEventListener('click', (event) => {
          event.preventDefault();
          const action = btn.getAttribute('data-settings-action');
          this.invokeSetting(action);
        });
      });
    },

    bindThemeActions() {
      if (this._themeDelegated) return;
      this._themeDelegated = true;
      document.addEventListener('click', (event) => {
        const btn = event.target && event.target.closest ? event.target.closest('[data-theme-action]') : null;
        if (!btn) return;
        if (!document.body.contains(btn)) return;
        event.preventDefault();
        const handler = (btn.getAttribute('data-theme-action') || '').trim();
        if (!handler) return;
        switch (handler) {
          case 'portal': {
            const target = btn.getAttribute('data-theme-target');
            const label = btn.getAttribute('data-theme-label') || '';
            const normalized = (typeof window.normalizeThemePortalTarget === 'function')
              ? window.normalizeThemePortalTarget(target)
              : (target || '');
            if (normalized && typeof window.navigateToThemePortal === 'function') {
              window.navigateToThemePortal(normalized, { label, theme: label || undefined });
            } else if (normalized) {
              window.location.href = normalized;
            } else {
              hpCore.showMessage('缺少目标链接', 'warning');
            }
            break;
          }
          case 'bloom':
            if (typeof window.toggleBloomDarkMode === 'function') {
              window.toggleBloomDarkMode();
            } else {
              hpCore.showMessage('Bloom 主题切换组件未加载', 'warning');
            }
            break;
          case 'apply': {
            const themeId = btn.getAttribute('data-theme-arg');
            if (themeId && typeof window.applyTheme === 'function') {
              window.applyTheme(themeId);
              hpCore.showMessage('已切换主题：' + themeId, 'success');
            } else {
              hpCore.showMessage('主题切换组件未加载', 'warning');
            }
            break;
          }
          default:
            hpCore.showMessage('未识别的主题操作', 'warning');
        }
      });
    },

    bindThemeToggle() {
      if (!this.dom.themeToggle) return;
      const apply = (mode) => {
        if (mode === 'dark') {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      };

      const saved = localStorage.getItem('hp.theme');
      if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        apply('dark');
      }

      this.dom.themeToggle.addEventListener('click', () => {
        const isDark = document.documentElement.classList.toggle('dark');
        localStorage.setItem('hp.theme', isDark ? 'dark' : 'light');
      });
    },

    bindHash() {
      window.addEventListener('hashchange', () => {
        const hashView = (window.location.hash || '').replace('#', '');
        if (hashView && VIEW_KEYS.includes(hashView)) {
          this.activate(hashView);
        }
      });
    },

    activate(view, updateHash = true) {
      const next = VIEW_KEYS.includes(view) ? view : 'overview';
      this.state.activeView = next;
      this.persistState();

      if (updateHash) {
        try { window.history.replaceState(null, '', '#' + next); }
        catch (_) { window.location.hash = next; }
      }

      Array.from(this.dom.root.querySelectorAll('[data-view-section]')).forEach((section) => {
        const key = section.getAttribute('data-view-section');
        if (key === next) {
          section.classList.remove('hidden');
          section.classList.add('block');
        } else {
          section.classList.add('hidden');
          section.classList.remove('block');
        }
      });

      this.dom.navButtons.forEach((btn) => {
        const key = btn.getAttribute('data-hp-view');
        btn.classList.toggle('hp-nav-active', key === next);
      });

      this.renderForView(next);

      if (next === 'practice' && this.practiceVirtualizer && typeof this.practiceVirtualizer.recalculate === 'function') {
        window.requestAnimationFrame(() => {
          try { this.practiceVirtualizer.recalculate(); }
          catch (error) { console.warn('[hp-portal] practice recalc failed', error); }
        });
      }

      if (next === 'history') {
        window.requestAnimationFrame(() => {
          try { this.renderHistory(); }
          catch (error) { console.warn('[hp-portal] history rerender failed', error); }
        });
      }
    },

    renderAll() {
      this.renderOverview();
      this.renderPractice();
      this.renderHistory();
    },

    renderForView(view) {
      if (view === 'overview') this.renderOverview();
      if (view === 'practice') this.renderPractice();
      if (view === 'history') this.renderHistory();
      if (view === 'settings') this.updateSettingsMeta();
    },

    clearContainer(node) {
      if (!node) return;
      while (node.firstChild) {
        node.removeChild(node.firstChild);
      }
    },

    buildThemeModalContent() {
      const template = document.getElementById('hp-theme-modal-template');
      if (template && template.content) {
        return template.content.cloneNode(true);
      }
      const fallback = document.createElement('div');
      fallback.className = 'space-y-4 text-sm text-white/75';
      const tip = document.createElement('p');
      tip.textContent = '主题列表未配置，请稍后再试。';
      fallback.appendChild(tip);
      const closeBtn = document.createElement('button');
      closeBtn.className = 'hp-settings-button';
      closeBtn.textContent = '关闭';
      closeBtn.addEventListener('click', () => this.closeModal());
      fallback.appendChild(closeBtn);
      return fallback;
    },

    openModal(title, content) {
      if (!this.dom.modal || !this.dom.modalBody || !this.dom.modalTitle) return;
      this.dom.modalTitle.textContent = title || '设置';
      this.clearContainer(this.dom.modalBody);
      if (content) {
        this.dom.modalBody.appendChild(content);
      }
      this.dom.modal.classList.remove('hidden');
      this.dom.modal.setAttribute('aria-hidden', 'false');
    },

    closeModal() {
      if (!this.dom.modal) return;
      this.dom.modal.classList.add('hidden');
      this.dom.modal.setAttribute('aria-hidden', 'true');
    },

    readBackups() {
      try {
        const raw = localStorage.getItem(this.storageKeys.backups);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        return [];
      }
    },

    writeBackups(list) {
      try {
        localStorage.setItem(this.storageKeys.backups, JSON.stringify(list.slice(0, 20)));
      } catch (error) {
        console.warn('[hp-portal] write backups failed', error);
      }
    },

    createBackup() {
      const exams = hpCore.getExamIndex() || [];
      const records = hpCore.getRecords() || [];
      if (!exams.length && !records.length) {
        hpCore.showMessage('暂无数据可备份', 'info');
        return;
      }
      const backups = this.readBackups();
      const payload = {
        id: 'backup-' + Date.now(),
        createdAt: Date.now(),
        exams: JSON.parse(JSON.stringify(exams)),
        records: JSON.parse(JSON.stringify(records))
      };
      backups.unshift(payload);
      this.writeBackups(backups);
      hpCore.showMessage('备份已创建', 'success');
    },

    showBackupList() {
      const backups = this.readBackups();
      const wrapper = document.createElement('div');
      wrapper.className = 'space-y-4';
      if (!backups.length) {
        const empty = document.createElement('div');
        empty.className = 'hp-settings-modal__empty';
        empty.textContent = '暂无备份，先点击“创建备份”生成一个吧。';
        wrapper.appendChild(empty);
      } else {
        const list = document.createElement('div');
        list.className = 'hp-settings-modal__list';
        backups.forEach((backup) => {
          const item = document.createElement('div');
          item.className = 'hp-settings-modal__item';
          const title = document.createElement('h4');
          title.textContent = '备份 · ' + formatDateTime(backup.createdAt);
          item.appendChild(title);
          const meta = document.createElement('p');
          meta.className = 'text-white/60 text-xs';
          meta.textContent = '题库 ' + (backup.exams ? backup.exams.length : 0) + ' 条 · 练习记录 ' + (backup.records ? backup.records.length : 0) + ' 条';
          item.appendChild(meta);
          const actions = document.createElement('div');
          actions.className = 'hp-settings-modal__actions';
          const restoreBtn = document.createElement('button');
          restoreBtn.textContent = '恢复';
          restoreBtn.addEventListener('click', () => this.restoreBackup(backup.id));
          const deleteBtn = document.createElement('button');
          deleteBtn.textContent = '删除';
          deleteBtn.setAttribute('data-variant', 'ghost');
          deleteBtn.addEventListener('click', () => this.deleteBackup(backup.id));
          actions.appendChild(restoreBtn);
          actions.appendChild(deleteBtn);
          item.appendChild(actions);
          list.appendChild(item);
        });
        wrapper.appendChild(list);
      }
      this.openModal('备份列表', wrapper);
    },

    restoreBackup(backupId) {
      if (!backupId) return;
      const backups = this.readBackups();
      const target = backups.find((item) => item && item.id === backupId);
      if (!target) {
        hpCore.showMessage('未找到备份', 'warning');
        return;
      }
      hpCore.emit('dataUpdated', {
        examIndex: Array.isArray(target.exams) ? target.exams : [],
        practiceRecords: Array.isArray(target.records) ? target.records : [],
        __source: 'hp-portal-backup'
      });
      this.renderAll();
      this.updateSettingsMeta();
      hpCore.showMessage('备份已恢复', 'success');
      this.closeModal();
    },

    deleteBackup(backupId) {
      if (!backupId) return;
      const next = this.readBackups().filter((item) => item && item.id !== backupId);
      this.writeBackups(next);
      hpCore.showMessage('备份已删除', 'info');
      this.showBackupList();
    },

    showConfigList() {
      const exams = hpCore.getExamIndex() || [];
      const total = exams.length;
      const groups = exams.reduce((map, exam) => {
        const type = (exam && exam.type ? String(exam.type) : '未分类').toLowerCase();
        map[type] = (map[type] || 0) + 1;
        return map;
      }, {});
      const wrapper = document.createElement('div');
      wrapper.className = 'space-y-4 text-sm';
      const summary = document.createElement('p');
      summary.className = 'text-white/70';
      summary.textContent = '当前题库共 ' + total + ' 套，按类型分布如下：';
      wrapper.appendChild(summary);
      const list = document.createElement('div');
      list.className = 'hp-settings-modal__list';
      Object.keys(groups).sort().forEach((key) => {
        const item = document.createElement('div');
        item.className = 'hp-settings-modal__item';
        const title = document.createElement('h4');
        title.textContent = key.toUpperCase();
        item.appendChild(title);
        const meta = document.createElement('p');
        meta.className = 'text-white/60 text-xs';
        meta.textContent = '共 ' + groups[key] + ' 套题';
        item.appendChild(meta);
        list.appendChild(item);
      });
      if (!list.childNodes.length) {
        const empty = document.createElement('div');
        empty.className = 'hp-settings-modal__empty';
        empty.textContent = '尚未加载任何题库配置。';
        wrapper.appendChild(empty);
      } else {
        wrapper.appendChild(list);
      }
      const refresh = document.createElement('button');
      refresh.className = 'hp-settings-button';
      refresh.textContent = '重新扫描题库';
      refresh.addEventListener('click', () => {
        this.reloadLibrary(true);
        this.closeModal();
      });
      wrapper.appendChild(refresh);
      this.openModal('题库配置', wrapper);
    },

    exportData() {
      const payload = {
        exportedAt: new Date().toISOString(),
        exams: hpCore.getExamIndex() || [],
        records: hpCore.getRecords() || [],
        state: this.state
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'ielts-backup-' + formatFileTimestamp(new Date()) + '.json';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      hpCore.showMessage('备份文件已导出', 'success');
    },

    promptImport() {
      if (!this.dom.importInput) return;
      this.dom.importInput.value = '';
      this.dom.importInput.click();
    },

    handleImportChange(event) {
      const files = event && event.target && event.target.files;
      if (!files || !files.length) return;
      const file = files[0];
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result || '{}'));
          this.applyImportedData(parsed);
        } catch (error) {
          hpCore.showMessage('导入失败：' + error.message, 'error');
        } finally {
          this.dom.importInput.value = '';
        }
      };
      reader.onerror = () => {
        hpCore.showMessage('无法读取文件', 'error');
        this.dom.importInput.value = '';
      };
      reader.readAsText(file, 'utf-8');
    },

    applyImportedData(payload) {
      if (!payload || typeof payload !== 'object') {
        hpCore.showMessage('导入数据无效', 'error');
        return;
      }
      const exams = Array.isArray(payload.exams)
        ? payload.exams
        : (Array.isArray(payload.examIndex) ? payload.examIndex : []);
      const records = Array.isArray(payload.records)
        ? payload.records
        : (Array.isArray(payload.practiceRecords) ? payload.practiceRecords : []);
      hpCore.emit('dataUpdated', {
        examIndex: exams,
        practiceRecords: records,
        __source: 'hp-portal-import'
      });
      this.renderAll();
      this.updateSettingsMeta();
      hpCore.showMessage('数据已导入', 'success');
    },

    reloadLibrary(force) {
      if (!hpCore || typeof hpCore._loadExamIndex !== 'function') {
        hpCore.showMessage('题库加载器未就绪', 'warning');
        return;
      }
      const message = force ? '正在重新扫描题库…' : '正在加载题库…';
      hpCore.showMessage(message, 'info');
      Promise.resolve(hpCore._loadExamIndex()).then(() => {
        if (typeof hpCore._loadRecords === 'function') {
          try { hpCore._loadRecords(); } catch (error) { console.warn('[hp-portal] reload records failed', error); }
        }
        this.renderAll();
        this.updateSettingsMeta();
        hpCore.showMessage('题库索引已刷新', 'success');
      }).catch((error) => {
        console.warn('[hp-portal] reload library failed', error);
        hpCore.showMessage('题库加载失败：' + (error && error.message ? error.message : '未知错误'), 'error');
      });
    },

    renderOverview() {
      const exams = hpCore.getExamIndex() || [];
      const records = hpCore.getRecords() || [];
      const stats = this.calculateStats(exams, records);

      if (this.dom.stats.exams) this.dom.stats.exams.textContent = stats.totalExams;
      if (this.dom.stats.completed) this.dom.stats.completed.textContent = stats.completed;
      if (this.dom.stats.average) this.dom.stats.average.textContent = stats.average + '%';
      if (this.dom.stats.streak) this.dom.stats.streak.textContent = stats.days;
      if (this.dom.stats.updated) this.dom.stats.updated.textContent = stats.updated;

      if (!this.dom.quickCards) return;

      const featured = pickRandomItems(exams, 4);
      this.clearContainer(this.dom.quickCards);

      if (!featured.length) {
        const placeholder = document.createElement('div');
        placeholder.className = 'hp-empty-state';
        placeholder.textContent = '暂无可推荐的题目，先去题库探索吧。';
        this.dom.quickCards.appendChild(placeholder);
      } else {
        const fragment = document.createDocumentFragment();
        featured.forEach((exam) => fragment.appendChild(this.createQuickCardElement(exam)));
        this.dom.quickCards.appendChild(fragment);
      }

      this.ensureQuickCardBinding();
    },

    ensureQuickCardBinding() {
      if (!this.dom.quickCards || this.dom.quickCards.__bound) return;
      this.dom.quickCards.addEventListener('click', (event) => {
        const btn = event.target.closest('button[data-action]');
        if (!btn) return;
        const id = btn.getAttribute('data-id');
        const action = btn.getAttribute('data-action');
        if (action === 'start') hpCore.startExam(id);
        if (action === 'pdf') hpCore.viewExamPDF(id);
      });
      this.dom.quickCards.__bound = true;
    },

    createQuickCardElement(exam) {
      const article = document.createElement('article');
      article.className = 'hp-quick-card rounded-2xl border border-white/15 bg-gradient-to-br from-[#39282b]/75 via-[#24181a]/90 to-[#181112]/95 p-6 shadow-xl backdrop-blur';

      const header = document.createElement('div');
      header.className = 'flex items-start justify-between gap-3';
      const title = document.createElement('h3');
      const typeEmoji = (exam.type || '').toLowerCase() === 'listening' ? '🎧' : '📖';
      title.className = 'text-lg font-semibold text-white';
      title.textContent = typeEmoji + ' ' + (exam.title || '未命名试卷');
      header.appendChild(title);
      article.appendChild(header);

      const meta = document.createElement('p');
      meta.className = 'hp-card-meta';
      meta.textContent = exam.category || exam.part || '未分类';
      article.appendChild(meta);

      const footer = document.createElement('div');
      footer.className = 'hp-card-actions';
      const startBtn = document.createElement('button');
      startBtn.textContent = '开始练习';
      startBtn.setAttribute('data-action', 'start');
      startBtn.setAttribute('data-id', exam && exam.id ? exam.id : '');
      footer.appendChild(startBtn);

      if (exam && exam.pdfFilename) {
        const pdfBtn = document.createElement('button');
        pdfBtn.textContent = '查看 PDF';
        pdfBtn.setAttribute('data-action', 'pdf');
        pdfBtn.setAttribute('data-id', exam.id || '');
        footer.appendChild(pdfBtn);
      }

      article.appendChild(footer);
      return article;
    },

    renderPractice() {
      if (!this.dom.practiceList) return;
      const exams = hpCore.getExamIndex() || [];
      const filter = this.state.practiceFilter || { type: 'all', query: '' };

      const filtered = exams.filter((exam) => {
        if (!exam) return false;
        const type = (exam.type || '').toLowerCase();
        if (filter.type && filter.type !== 'all' && type !== filter.type) return false;
        if (filter.query) {
          const q = filter.query.toLowerCase();
          const title = (exam.title || '').toLowerCase();
          const category = (exam.category || exam.part || '').toLowerCase();
          return title.includes(q) || category.includes(q);
        }
        return true;
      });

      if (!filtered.length) {
        this.destroyPracticeVirtualizer();
        this.dom.practiceList.dataset.mode = 'empty';
        this.clearContainer(this.dom.practiceList);
        if (this.dom.practiceEmpty) {
          this.dom.practiceEmpty.classList.remove('hidden');
        }
        return;
      }

      if (this.dom.practiceEmpty) {
        this.dom.practiceEmpty.classList.add('hidden');
      }

      if (this.shouldVirtualizePractice(filtered.length)) {
        this.ensurePracticeVirtualizer(filtered);
        return;
      }

      const limited = filtered.slice(0, 120);
      this.destroyPracticeVirtualizer();
      this.dom.practiceList.dataset.mode = 'static';
      this.clearContainer(this.dom.practiceList);
      const fragment = document.createDocumentFragment();
      limited.forEach((exam) => {
        fragment.appendChild(this.createPracticeCardElement(exam));
      });
      this.dom.practiceList.appendChild(fragment);
      this.ensurePracticeBinding();
    },

    shouldVirtualizePractice(count) {
      if (!window.performanceOptimizer || typeof window.performanceOptimizer.createVirtualScroller !== 'function') {
        return false;
      }
      return count > PRACTICE_VIRTUAL_THRESHOLD;
    },

    ensurePracticeVirtualizer(items) {
      if (!this.dom.practiceList) return null;
      const dataset = Array.isArray(items) ? items.slice() : [];
      const layoutCalculator = ({ container, items: currentItems }) => this.calculatePracticeLayout(container, currentItems || dataset);
      const height = Math.max(420, Math.min(720, Math.round(window.innerHeight * 0.65) || 600));

      this.dom.practiceList.dataset.mode = 'virtual';
      this.dom.practiceList.style.padding = '12px';
      this.dom.practiceList.style.boxSizing = 'border-box';
      this.dom.practiceList.style.display = 'block';

      if (!this.practiceVirtualizer) {
        this.practiceVirtualizer = window.performanceOptimizer.createVirtualScroller(
          this.dom.practiceList,
          dataset,
          (exam) => this.createPracticeCardElement(exam),
          {
            containerHeight: height,
            bufferSize: 8,
            layoutCalculator
          }
        );
      } else {
        this.practiceVirtualizer.updateItems(dataset);
      }

      if (this.practiceVirtualizer && typeof this.practiceVirtualizer.recalculate === 'function') {
        this.practiceVirtualizer.recalculate();
      }

      this.ensurePracticeBinding();
      if (this.practiceVirtualizer) {
        this.practiceVirtualizer.itemCount = dataset.length;
      }
      return this.practiceVirtualizer;
    },

    destroyPracticeVirtualizer() {
      if (this.practiceVirtualizer && typeof this.practiceVirtualizer.destroy === 'function') {
        try { this.practiceVirtualizer.destroy(); }
        catch (error) { console.warn('[hp-portal] destroy virtualizer failed', error); }
      }
      this.practiceVirtualizer = null;
      if (this.dom.practiceList) {
        delete this.dom.practiceList.dataset.mode;
        this.dom.practiceList.style.removeProperty('padding');
        this.dom.practiceList.style.removeProperty('box-sizing');
        this.dom.practiceList.style.removeProperty('display');
        this.dom.practiceList.style.removeProperty('position');
        this.dom.practiceList.style.removeProperty('overflow');
        this.dom.practiceList.style.removeProperty('overflow-x');
        this.dom.practiceList.style.removeProperty('overflow-y');
        this.dom.practiceList.style.removeProperty('height');
      }
    },

    ensurePracticeBinding() {
      if (!this.dom.practiceList || this.dom.practiceList.__bound) return;
      this.dom.practiceList.addEventListener('click', (event) => {
        const btn = event.target.closest('button[data-action]');
        if (!btn) return;
        event.preventDefault();
        const id = btn.getAttribute('data-id');
        const action = btn.getAttribute('data-action');
        if (action === 'start') hpCore.startExam(id);
        if (action === 'pdf') hpCore.viewExamPDF(id);
      });
      this.dom.practiceList.__bound = true;
    },

    createPracticeCardElement(exam) {
      const article = document.createElement('article');
      article.className = 'hp-practice-card';

      const title = document.createElement('h4');
      title.textContent = exam && exam.title ? exam.title : '未命名试卷';
      article.appendChild(title);

      const meta = document.createElement('p');
      meta.className = 'text-sm text-white/70';
      const typeLabel = (exam && (exam.type || '').toLowerCase()) === 'listening' ? '🎧 听力' : '📖 阅读';
      const category = exam && (exam.category || exam.part) ? ' · ' + (exam.category || exam.part) : '';
      meta.textContent = typeLabel + category;
      article.appendChild(meta);

      const footer = document.createElement('footer');
      footer.className = 'flex flex-wrap gap-3';
      const startBtn = document.createElement('button');
      startBtn.className = 'rounded-full bg-[#ec1337]/85 px-4 py-2 font-semibold text-white shadow-lg shadow-[#ec1337]/30';
      startBtn.textContent = '开始练习';
      startBtn.setAttribute('data-action', 'start');
      startBtn.setAttribute('data-id', exam && exam.id ? exam.id : '');
      footer.appendChild(startBtn);

      if (exam && exam.pdfFilename) {
        const pdfBtn = document.createElement('button');
        pdfBtn.className = 'rounded-full border border-white/30 px-4 py-2 font-semibold text-white/85';
        pdfBtn.textContent = '查看 PDF';
        pdfBtn.setAttribute('data-action', 'pdf');
        pdfBtn.setAttribute('data-id', exam.id || '');
        footer.appendChild(pdfBtn);
      }

      article.appendChild(footer);
      return article;
    },

    calculatePracticeLayout(container, items) {
      const dataset = Array.isArray(items) ? items : [];
      const gap = 24;
      const baseWidth = 320;
      const padding = 12;
      const measuredWidth = this.measurePracticeWidth(container);
      const availableWidth = Math.max(260, measuredWidth - padding * 2);
      const columns = Math.max(1, Math.floor((availableWidth + gap) / (baseWidth + gap)));
      const columnWidth = Math.max(260, Math.floor((availableWidth - gap * (columns - 1)) / columns));
      const cardHeight = 220;
      const rowHeight = cardHeight + gap;
      const totalRows = Math.max(1, Math.ceil(dataset.length / columns));
      const totalHeight = Math.max(rowHeight * totalRows + padding * 2, rowHeight);

      return {
        rowHeight,
        itemsPerRow: columns,
        totalRows,
        totalHeight,
        positionFor(index) {
          const row = Math.floor(index / columns);
          const col = index % columns;
          return {
            top: padding + row * rowHeight,
            left: padding + col * (columnWidth + gap),
            width: columnWidth,
            height: cardHeight
          };
        }
      };
    },

    measurePracticeWidth(container) {
      if (!container) return 960;

      const rectWidth = container.getBoundingClientRect ? container.getBoundingClientRect().width : 0;
      const direct = Math.max(0, container.clientWidth, container.offsetWidth, rectWidth || 0);
      if (direct > 0) {
        return direct;
      }

      if (container.parentElement) {
        return this.measurePracticeWidth(container.parentElement);
      }

      return Math.max(480, window.innerWidth ? window.innerWidth - 160 : 960);
    },

    renderHistory() {
      if (!this.dom.historyTable || !this.dom.historyEmpty) return;
      const records = (hpCore.getRecords() || []).slice().sort((a, b) => {
        const da = new Date(a.date || a.timestamp || 0).getTime();
        const db = new Date(b.date || b.timestamp || 0).getTime();
        return db - da;
      });
      const exams = hpCore.getExamIndex() || [];

      if (!records.length) {
        const tbody = this.dom.historyTable.querySelector('tbody');
        if (tbody) this.clearContainer(tbody);
        this.dom.historyTable.classList.add('hidden');
        this.dom.historyEmpty.classList.remove('hidden');
        this.renderHistoryTrend([]);
        this.updateHistoryMeta([]);
        return;
      }

      this.dom.historyEmpty.classList.add('hidden');
      this.dom.historyTable.classList.remove('hidden');

      const examById = new Map();
      exams.forEach((exam) => { if (exam && exam.id) examById.set(exam.id, exam); });

      const tbody = this.dom.historyTable.querySelector('tbody');
      if (tbody) {
        this.clearContainer(tbody);
        const fragment = document.createDocumentFragment();
        records.slice(0, 150).forEach((record) => {
          const exam = examById.get(record.examId) || {};
          const title = exam.title || record.title || record.examName || '未知试卷';
          const score = this.getRecordScore(record);
          const duration = this.formatDuration(record.duration || (record.realData && record.realData.duration));
          const dateText = this.formatDate(record.date || record.timestamp);

          const tr = document.createElement('tr');
          const titleTd = document.createElement('td');
          titleTd.textContent = title;
          const typeTd = document.createElement('td');
          typeTd.textContent = exam.type || record.type || '阅读';
          const scoreTd = document.createElement('td');
          scoreTd.textContent = score + '%';
          const durationTd = document.createElement('td');
          durationTd.textContent = duration;
          const dateTd = document.createElement('td');
          dateTd.textContent = dateText;

          tr.appendChild(titleTd);
          tr.appendChild(typeTd);
          tr.appendChild(scoreTd);
          tr.appendChild(durationTd);
          tr.appendChild(dateTd);
          fragment.appendChild(tr);
        });
        tbody.appendChild(fragment);
      }

      this.renderHistoryTrend(records);
      this.updateHistoryMeta(records);
    },

    getRecordScore(record) {
      if (!record) return 0;
      if (typeof record.score === 'number' && Number.isFinite(record.score)) {
        return Math.round(record.score);
      }
      if (typeof record.percentage === 'number' && Number.isFinite(record.percentage)) {
        return Math.round(record.percentage);
      }
      if (record.realData && typeof record.realData.score === 'number') {
        return Math.round(record.realData.score);
      }
      return 0;
    },

    renderHistoryTrend(records) {
      if (!this.dom.historyChart) return;
      const canvas = this.dom.historyChart;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const series = this.buildHistorySeries(records || []);
      this.historySeries = series;

      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth || 640;
      const height = canvas.clientHeight || 260;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      if (!series.points.length) {
        this.toggleHistoryChartEmpty(true);
        canvas.dataset.rendered = '0';
        canvas.dataset.pointCount = '0';
        ctx.restore();
        return;
      }

      this.toggleHistoryChartEmpty(false);

      const padding = { top: 18, right: 28, bottom: 34, left: 54 };
      const areaWidth = Math.max(10, width - padding.left - padding.right);
      const areaHeight = Math.max(10, height - padding.top - padding.bottom);
      const scores = series.points.map((point) => point.score);
      const minScore = Math.max(0, Math.min.apply(null, scores.concat([60])));
      const maxScore = Math.min(100, Math.max.apply(null, scores.concat([85])));
      const range = Math.max(5, maxScore - minScore);
      const ticks = this.calculateScoreTicks(minScore, maxScore);

      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ticks.forEach((tick) => {
        const ratio = (tick - minScore) / range;
        const y = padding.top + (1 - ratio) * areaHeight;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(padding.left + areaWidth, y);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '12px "Helvetica Neue", Arial, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(Math.round(tick) + '%', padding.left - 8, y + 4);
      });

      ctx.strokeStyle = '#c084fc';
      ctx.lineWidth = 2;
      ctx.beginPath();

      series.points.forEach((point, index) => {
        const xRatio = series.points.length === 1 ? 0.5 : index / (series.points.length - 1);
        const scoreRatio = (point.score - minScore) / range;
        const x = padding.left + xRatio * areaWidth;
        const y = padding.top + (1 - scoreRatio) * areaHeight;
        point._plot = { x, y };
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });

      ctx.stroke();
      ctx.lineTo(padding.left + areaWidth, padding.top + areaHeight);
      ctx.lineTo(padding.left, padding.top + areaHeight);
      ctx.closePath();
      ctx.fillStyle = 'rgba(192,132,252,0.18)';
      ctx.fill();

      ctx.fillStyle = '#f8fafc';
      series.points.forEach((point) => {
        if (!point._plot) return;
        ctx.beginPath();
        ctx.arc(point._plot.x, point._plot.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.font = '12px "Helvetica Neue", Arial, sans-serif';
      ctx.textAlign = 'center';
      const labelStep = Math.max(1, Math.floor(series.points.length / 6));
      series.points.forEach((point, index) => {
        if (!point._plot) return;
        if (index % labelStep !== 0 && index !== series.points.length - 1) return;
        ctx.fillText(point.label, point._plot.x, height - padding.bottom + 20);
      });

      canvas.dataset.rendered = '1';
      canvas.dataset.pointCount = String(series.points.length);
      canvas.dataset.scoreMax = String(maxScore);
      canvas.dataset.scoreMin = String(minScore);
      ctx.restore();
    },

    buildHistorySeries(records) {
      const grouped = new Map();
      (records || []).forEach((record) => {
        const date = this.normalizeRecordDate(record);
        if (!date) return;
        const key = date.toISOString().slice(0, 10);
        const score = this.getRecordScore(record);
        const entry = grouped.get(key) || { sum: 0, count: 0, timestamp: date.getTime() };
        entry.sum += score;
        entry.count += 1;
        entry.timestamp = Math.max(entry.timestamp, date.getTime());
        grouped.set(key, entry);
      });

      const points = Array.from(grouped.entries()).map(([key, value]) => {
        const average = value.count ? value.sum / value.count : 0;
        return {
          dateKey: key,
          timestamp: value.timestamp,
          label: this.formatChartLabel(key),
          score: Math.round(Math.max(0, Math.min(100, average)))
        };
      }).sort((a, b) => a.timestamp - b.timestamp);

      const trimmed = points.slice(-30);
      return { points: trimmed };
    },

    normalizeRecordDate(record) {
      if (!record) return null;
      const raw = record.date || record.timestamp || record.completedAt || null;
      const date = raw ? new Date(raw) : new Date();
      if (isNaN(date.getTime())) return null;
      date.setHours(0, 0, 0, 0);
      return date;
    },

    formatChartLabel(dateKey) {
      try {
        const parts = dateKey.split('-');
        if (parts.length === 3) {
          return parts[1] + '/' + parts[2];
        }
        const d = new Date(dateKey);
        if (!isNaN(d.getTime())) {
          return (d.getMonth() + 1) + '/' + d.getDate();
        }
      } catch (_) {}
      return dateKey;
    },

    calculateScoreTicks(minScore, maxScore) {
      const lower = Math.max(0, Math.floor(minScore / 10) * 10);
      const upper = Math.min(100, Math.ceil(maxScore / 10) * 10);
      const diff = Math.max(10, upper - lower);
      const step = diff <= 30 ? 10 : Math.round(diff / 4 / 5) * 5 || 10;
      const ticks = [];
      for (let value = lower; value <= upper; value += step) {
        ticks.push(value);
      }
      if (!ticks.includes(upper)) ticks.push(upper);
      return ticks;
    },

    toggleHistoryChartEmpty(show) {
      if (!this.dom.historyChartEmpty) return;
      if (show) {
        this.dom.historyChartEmpty.classList.remove('hidden');
      } else {
        this.dom.historyChartEmpty.classList.add('hidden');
      }
    },

    updateHistoryMeta(records) {
      const total = Array.isArray(records) ? records.length : 0;
      const level = Math.max(1, Math.min(20, Math.floor(total / 8) + 1));
      const prevThreshold = (level - 1) * 8;
      const nextThreshold = level * 8;
      const progress = nextThreshold === prevThreshold
        ? 100
        : Math.max(0, Math.min(100, Math.round(((total - prevThreshold) / (nextThreshold - prevThreshold)) * 100)));

      if (this.dom.historyLevel) {
        this.dom.historyLevel.textContent = String(level);
      }
      if (this.dom.historyProgressBar) {
        this.dom.historyProgressBar.style.width = progress + '%';
      }
      if (this.dom.historyProgressText) {
        this.dom.historyProgressText.textContent = progress + '%';
      }
    },

    updateSettingsMeta() {
      const statusEl = document.getElementById('hp-settings-status');
      if (statusEl) {
        try {
          const status = hpCore.getStatus ? hpCore.getStatus() : null;
          if (status) {
            statusEl.textContent = '题库 ' + status.examCount + ' 套 · 练习记录 ' + status.recordCount + ' 条 · 最近更新 ' + this.formatRelative(status.lastUpdateTime);
          }
        } catch (e) {
          console.warn('[hp-portal] update settings status failed', e);
        }
      }

    },

    invokeSetting(action) {
      switch (action) {
        case 'clear-cache':
          try {
            localStorage.clear();
            sessionStorage.clear();
            hpCore.showMessage('缓存已清理，页面即将刷新', 'success');
            setTimeout(() => window.location.reload(), 400);
          } catch (e) {
            hpCore.showMessage('清理缓存失败: ' + e.message, 'error');
          }
          break;
        case 'load-library':
          this.reloadLibrary(false);
          break;
        case 'force-refresh':
          this.reloadLibrary(true);
          break;
        case 'config-list':
          this.showConfigList();
          break;
        case 'backup-create':
          this.createBackup();
          break;
        case 'backup-list':
          this.showBackupList();
          break;
        case 'export':
          this.exportData();
          break;
        case 'import':
          this.promptImport();
          break;
        case 'set-base-prefix': {
          const current = window.hpPath && typeof window.hpPath.getBasePrefix === 'function'
            ? window.hpPath.getBasePrefix()
            : '';
          const next = window.prompt('请输入题库根目录（相对于当前页面）', current || '');
          if (next === null) break;
          if (window.hpPath && typeof window.hpPath.setBasePrefix === 'function') {
            const applied = window.hpPath.setBasePrefix(next);
            if (applied) {
              hpCore.showMessage('题库路径已更新：' + applied, 'success');
              this.updateSettingsMeta();
            } else {
              hpCore.showMessage('题库路径无效，请检查输入', 'error');
            }
          } else {
            hpCore.showMessage('路径管理组件未加载', 'error');
          }
          break;
        }
        case 'theme-modal':
          this.openModal('主题切换', this.buildThemeModalContent());
          break;
        default:
          hpCore.showMessage('未识别的操作: ' + action, 'warning');
      }
    },

    calculateStats(exams, records) {
      const totalExams = Array.isArray(exams) ? exams.length : 0;
      const completed = Array.isArray(records) ? records.length : 0;
      let average = 0;
      if (completed) {
        const totalScore = records.reduce((sum, record) => {
          const val = typeof record.score === 'number' ? record.score : (record.percentage || 0);
          return sum + (Number.isFinite(val) ? val : 0);
        }, 0);
        average = Math.round(totalScore / completed);
      }

      const daySet = new Set();
      (records || []).forEach((record) => {
        const date = new Date(record.date || record.timestamp || Date.now());
        if (!isNaN(date.getTime())) {
          daySet.add(date.toDateString());
        }
      });

      const lastRecord = records && records[0] ? new Date(records[0].date || records[0].timestamp || Date.now()) : new Date();
      const updated = this.formatRelative(lastRecord.getTime());

      return {
        totalExams,
        completed,
        average: Math.max(0, Math.min(100, average || 0)),
        days: daySet.size,
        updated
      };
    },

    formatDuration(value) {
      const seconds = Number(value) || 0;
      const m = Math.floor(seconds / 60);
      const s = Math.abs(seconds % 60);
      return m + '分' + String(s).padStart(2, '0') + '秒';
    },

    formatDate(value) {
      if (!value) return '未知时间';
      const date = new Date(value);
      if (isNaN(date.getTime())) return '未知时间';
      return date.toLocaleString();
    },

    formatRelative(timestamp) {
      if (!timestamp) return '暂无记录';
      const delta = Date.now() - Number(timestamp || 0);
      if (!Number.isFinite(delta)) return '暂无记录';
      if (delta < 60 * 1000) return '刚刚';
      if (delta < 60 * 60 * 1000) return Math.round(delta / (60 * 1000)) + ' 分钟前';
      if (delta < 24 * 60 * 60 * 1000) return Math.round(delta / (60 * 60 * 1000)) + ' 小时前';
      return Math.round(delta / (24 * 60 * 60 * 1000)) + ' 天前';
    },

    escape(value) {
      return String(value || '').replace(/[&<>"']/g, function (match) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[match];
      });
    },

    escapeAttr(value) {
      return this.escape(value).replace(/"/g, '&quot;');
    }
  };

  const boot = () => Portal.init();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => hpCore.ready(boot));
  } else {
    hpCore.ready(boot);
  }
})();
