(function () {
  function ensureCompatPatch(global) {
    if (!global || (global.CompatPatch && typeof global.CompatPatch.register === 'function')) {
      return global && global.CompatPatch ? global.CompatPatch : null;
    }
    var patches = [];
    var register = function register(name, metadata) {
      if (!name) {
        return null;
      }
      var patch = Object.assign({
        name: String(name),
        owner: 'legacy',
        reason: '',
        removeAfter: ''
      }, metadata || {});
      patches.push(patch);
      return patch;
    };
    var list = function list() {
      return patches.slice();
    };
    global.CompatPatch = Object.assign({}, global.CompatPatch || {}, {
      register: register,
      list: list
    });
    return global.CompatPatch;
  }

  ensureCompatPatch(window);

  if (window.CompatPatch && typeof window.CompatPatch.register === 'function') {
    window.CompatPatch.register('boot-fallbacks', {
      owner: 'runtime',
      reason: 'legacy navigation and backup delegates for browser-only/file protocol startup',
      removeAfter: 'after navigation controller owns all callers'
    });
  }

  var storage = window.storage;
  // Fallback for navigation
  if (typeof window.showView !== 'function') {
    window.showView = function (viewName, resetCategory) {
      if (typeof document === 'undefined') {
        return;
      }
      var normalized = (typeof viewName === 'string' && viewName) ? viewName : 'overview';
      var target = document.getElementById(normalized + '-view');
      if (!target) {
        console.warn('[Fallback] 未找到视图节点:', normalized);
        return;
      }
      Array.prototype.forEach.call(document.querySelectorAll('.view.active'), function (v) {
        v.classList.remove('active');
      });
      target.classList.add('active');

      var controller = null;
      if (typeof window.ensureLegacyNavigationController === 'function') {
        try {
          controller = window.ensureLegacyNavigationController({
            containerSelector: '.main-nav',
            syncOnNavigate: false
          });
        } catch (err) {
          console.warn('[Fallback] 初始化导航控制器失败:', err);
        }
      }

      if (controller && typeof controller.syncActive === 'function') {
        controller.syncActive(normalized);
      } else {
        var navContainer = document.querySelector('.main-nav');
        if (navContainer) {
          Array.prototype.forEach.call(navContainer.querySelectorAll('.nav-btn'), function (btn) {
            btn.classList.remove('active');
          });
          var navButton = navContainer.querySelector('[data-view="' + normalized + '"]');
          if (navButton) {
            navButton.classList.add('active');
          }
        }
      }

      if (normalized === 'browse' && (resetCategory === undefined || resetCategory === true)) {
        window.currentCategory = 'all';
        window.currentExamType = 'all';
        if (typeof window.setBrowseTitle === 'function') { window.setBrowseTitle('题库浏览'); return; }
        var t = document.getElementById('browse-title'); if (t) t.textContent = '题库浏览';
      }
      if (normalized === 'browse' && typeof window.loadExamList === 'function') window.loadExamList();
      if (normalized === 'practice' && window.AppActions && typeof window.AppActions.ensurePracticeSuite === 'function') {
        window.AppActions.ensurePracticeSuite();
      }
      if (normalized === 'practice' && typeof window.startPracticeRecordsSyncInBackground === 'function') {
        window.startPracticeRecordsSyncInBackground('practice-view');
      }
      if (normalized === 'practice' && typeof window.ensurePracticeRecordsSync === 'function') {
        window.ensurePracticeRecordsSync('practice-view').catch(function () { });
      }
      if (normalized === 'practice' && typeof window.updatePracticeView === 'function') window.updatePracticeView();
    };
  }

  try {
    if (typeof window.ensureLegacyNavigationController === 'function') {
      window.ensureLegacyNavigationController({
        containerSelector: '.main-nav',
        syncOnNavigate: true,
        onNavigate: function onNavigate(viewName) {
          if (typeof window.showView === 'function') {
            window.showView(viewName);
          }
        }
      });
    } else {
      var navRoot = document.querySelector('.main-nav');
      if (navRoot && !navRoot._legacyNavHandler) {
        var handler = function (event) {
          var button = event.target && event.target.closest ? event.target.closest('.nav-btn[data-view]') : null;
          if (!button || !navRoot.contains(button)) {
            return;
          }
          event.preventDefault();
          var viewName = button.getAttribute('data-view');
          if (viewName && typeof window.showView === 'function') {
            window.showView(viewName);
          }
        };
        navRoot._legacyNavHandler = handler;
        navRoot.addEventListener('click', handler);
      }
    }
  } catch (error) {
    console.warn('[Fallback] 注册导航事件失败:', error);
  }

  var _fallbackBackupDelegatesConfigured = false;
  var _isLazyProxy = function (fn) {
    if (typeof fn !== 'function') return false;
    var src = Function.prototype.toString.call(fn);
    return fn.name === 'lazyProxy' || src.indexOf('ensureLazyGroup') !== -1 || src.indexOf('AppLazyLoader') !== -1;
  };

  function _ensureFallbackDataIntegrityManager() {
    if (!window.dataIntegrityManager && window.DataIntegrityManager) {
      try {
        window.dataIntegrityManager = new window.DataIntegrityManager();
      } catch (error) {
        console.warn('[Fallback] 初始化 DataIntegrityManager 失败:', error);
      }
    }
    return window.dataIntegrityManager || null;
  }

  var _fallbackDataIntegrityLoadPromise = null;

  function _ensureFallbackDataIntegrityManagerAsync() {
    var manager = _ensureFallbackDataIntegrityManager();
    if (manager) {
      return Promise.resolve(manager);
    }

    if (!_fallbackDataIntegrityLoadPromise) {
      if (window.AppLazyLoader && typeof window.AppLazyLoader.ensureGroup === 'function') {
        _fallbackDataIntegrityLoadPromise = window.AppLazyLoader.ensureGroup('settings-tools');
      } else if (typeof document !== 'undefined' && !window.DataIntegrityManager) {
        _fallbackDataIntegrityLoadPromise = new Promise(function (resolve, reject) {
          var script = document.createElement('script');
          script.src = 'js/components/DataIntegrityManager.js';
          script.onload = resolve;
          script.onerror = function (error) {
            reject(error || new Error('failed to load DataIntegrityManager'));
          };
          document.head.appendChild(script);
        });
      } else {
        _fallbackDataIntegrityLoadPromise = Promise.resolve();
      }
    }

    return _fallbackDataIntegrityLoadPromise.then(function () {
      var readyManager = _ensureFallbackDataIntegrityManager();
      if (!readyManager) {
        throw new Error('数据管理模块未初始化');
      }
      return readyManager;
    }).catch(function (error) {
      _fallbackDataIntegrityLoadPromise = null;
      throw error;
    });
  }

  function _fallbackCreateElement(tag, attributes, children) {
    if (typeof document === 'undefined') {
      return null;
    }

    var element = document.createElement(tag);
    var attrs = attributes || {};

    Object.keys(attrs).forEach(function (key) {
      var value = attrs[key];
      if (value == null || value === false) {
        return;
      }

      if (key === 'className') {
        element.className = value;
        return;
      }

      if (key === 'dataset' && typeof value === 'object') {
        Object.keys(value).forEach(function (dataKey) {
          var dataValue = value[dataKey];
          if (dataValue == null) {
            return;
          }
          element.dataset[dataKey] = String(dataValue);
        });
        return;
      }

      if (key === 'ariaHidden') {
        element.setAttribute('aria-hidden', value === true ? 'true' : String(value));
        return;
      }

      if (key === 'ariaLabel') {
        element.setAttribute('aria-label', String(value));
        return;
      }

      element.setAttribute(key, value === true ? '' : String(value));
    });

    var normalizedChildren = Array.isArray(children) ? children : [children];
    normalizedChildren.forEach(function (child) {
      if (child == null) {
        return;
      }
      if (typeof child === 'string') {
        element.appendChild(document.createTextNode(child));
      } else if (child instanceof Node) {
        element.appendChild(child);
      }
    });

    return element;
  }

  function _ensureFallbackBackupDelegates() {
    if (_fallbackBackupDelegatesConfigured || typeof document === 'undefined') {
      return;
    }

    document.addEventListener('click', function (event) {
      var target = event.target && event.target.closest ? event.target.closest('[data-backup-action]') : null;
      if (!target) {
        return;
      }

      var action = target.dataset.backupAction;
      if (action === 'restore') {
        event.preventDefault();
        var backupId = target.dataset.backupId;
        if (backupId) {
          _fallbackRestoreBackupById(backupId);
        }
        return;
      }

      if (action === 'close-modal') {
        event.preventDefault();
        var overlay = document.querySelector('.backup-modal-overlay');
        if (overlay) {
          overlay.remove();
        }
        return;
      }

      if (action === 'dismiss-inline') {
        event.preventDefault();
        var inline = document.querySelector('.backup-list-container');
        if (inline) {
          inline.remove();
        }
      }
    });

    _fallbackBackupDelegatesConfigured = true;
  }

  async function _fallbackRestoreBackupById(backupId) {
    if (!backupId) {
      window.showMessage && window.showMessage('无效的备份ID', 'error');
      return;
    }

    var manager = null;
    try {
      manager = await _ensureFallbackDataIntegrityManagerAsync();
    } catch (error) {
      window.showMessage && window.showMessage((error && error.message) || '数据管理模块未初始化', 'error');
      return;
    }

    if (!confirm('确定要恢复备份 ' + backupId + ' 吗？当前数据将被覆盖。')) {
      return;
    }

    try {
      window.showMessage && window.showMessage('正在恢复备份...', 'info');
      await manager.restoreBackup(backupId);
      window.showMessage && window.showMessage('备份恢复成功', 'success');
      setTimeout(function () {
        try {
          if (typeof window.showBackupList === 'function') {
            window.showBackupList();
          }
        } catch (error) {
          console.warn('[Fallback] 刷新备份列表失败:', error);
        }
      }, 1000);
    } catch (error) {
      console.error('[Fallback] 恢复备份失败:', error);
      window.showMessage && window.showMessage('备份恢复失败: ' + (error && error.message ? error.message : error), 'error');
    }
  }

  // Fallback for toast messages
  if (typeof window.showMessage !== 'function') {
    window.showMessage = function (message, type, duration) {
      try {
        var container = document.getElementById('message-container');
        if (!container) {
          container = document.createElement('div');
          container.id = 'message-container';
          container.className = 'message-container';
          document.body.appendChild(container);
        }

        var note = document.createElement('div');
        note.className = 'message ' + (type || 'info') + ' message-entering';
        note.setAttribute('role', type === 'error' ? 'alert' : 'status');
        note.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');

        var indicator = document.createElement('span');
        indicator.className = 'message-indicator';
        indicator.setAttribute('aria-hidden', 'true');

        var text = document.createElement('span');
        text.className = 'message-text';
        text.textContent = message || '';
        note.title = text.textContent;

        note.appendChild(indicator);
        note.appendChild(text);

        while (container.firstChild) {
          container.removeChild(container.firstChild);
        }

        container.appendChild(note);
        setTimeout(function () {
          if (note.parentNode && !note.classList.contains('message-leaving')) {
            note.classList.remove('message-entering');
            note.classList.add('message-visible');
          }
        }, 760);

        var timeout = typeof duration === 'number' && duration > 0 ? duration : 4000;
        if (window.__messageFallbackTimer) {
          clearTimeout(window.__messageFallbackTimer);
        }
        var hideTimer = setTimeout(function () {
          note.classList.add('message-leaving');
          note.classList.remove('message-entering', 'message-visible');
          setTimeout(function () {
            if (note.parentNode) {
              note.parentNode.removeChild(note);
            }
            if (window.__messageFallbackTimer === hideTimer) {
              window.__messageFallbackTimer = null;
            }
          }, 480);
        }, timeout);
        window.__messageFallbackTimer = hideTimer;
      } catch (_) { console.log('[Toast]', type || 'info', message); }
    };
  }

  var ensureDataBackupManager = (function () {
    let loading = null;
    return function ensureDataBackupManager() {
      if (window.DataBackupManager) {
        return Promise.resolve(new window.DataBackupManager());
      }
      if (loading) {
        return loading.then(() => new window.DataBackupManager());
      }
      if (window.AppLazyLoader && typeof window.AppLazyLoader.ensureGroup === 'function') {
        loading = window.AppLazyLoader.ensureGroup('settings-tools');
        return loading.then(() => new window.DataBackupManager());
      }
      loading = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'js/utils/dataBackupManager.js';
        script.onload = () => resolve();
        script.onerror = (err) => reject(err || new Error('failed to load dataBackupManager'));
        document.head.appendChild(script);
      });
      return loading.then(() => new window.DataBackupManager());
    };
  })();

  function showImportModeModal(onSelect) {
    const overlay = document.createElement('div');
    overlay.className = 'import-mode-overlay-lite';
    const modal = document.createElement('div');
    modal.className = 'import-mode-modal-lite';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'close-btn-lite';
    closeBtn.innerHTML = '&times;';
    closeBtn.ariaLabel = '关闭';
    closeBtn.addEventListener('click', () => document.body.removeChild(overlay));

    const title = document.createElement('h4');
    title.textContent = '选择导入模式';
    const desc = document.createElement('p');
    desc.textContent = '请选择适合当前场景的数据导入策略';

    const options = document.createElement('div');
    options.className = 'import-mode-options-lite';

    const defs = [
      { mode: 'merge', icon: '📥', title: '增量导入', text: '合并新数据，保留现有记录。适合日常更新。' },
      { mode: 'replace', icon: '⚠️', title: '覆盖导入', text: '清空并替换所有记录。慎用，数据不可恢复。' }
    ];

    defs.forEach((def) => {
      const card = document.createElement('div');
      card.className = 'import-mode-option-lite';
      card.role = 'button';
      card.tabIndex = 0;

      const icon = document.createElement('div');
      icon.className = 'mode-icon-lite';
      icon.textContent = def.icon;

      const head = document.createElement('strong');
      head.textContent = def.title;

      const text = document.createElement('p');
      text.textContent = def.text;

      card.append(icon, head, text);

      const selectAction = () => {
        document.body.removeChild(overlay);
        onSelect(def.mode);
      };

      card.addEventListener('click', selectAction);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectAction();
        }
      });

      options.appendChild(card);
    });

    modal.append(closeBtn, title, desc, options);
    overlay.appendChild(modal);

    // Close on backdrop click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        document.body.removeChild(overlay);
      }
    });

    if (!document.getElementById('import-mode-lite-style')) {
      const style = document.createElement('style');
      style.id = 'import-mode-lite-style';
      style.textContent = `
        @keyframes importFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes importScaleIn { from { opacity: 0; transform: scale(0.95) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        
        .import-mode-overlay-lite {
          position: fixed; inset: 0; z-index: 10000;
          background: rgba(0, 0, 0, 0.25);
          backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
          display: flex; align-items: center; justify-content: center;
          padding: 20px;
          animation: importFadeIn 0.3s ease-out;
        }
        .import-mode-modal-lite {
          position: relative; width: 440px; max-width: 90vw;
          /* White transparent gradient for substantial glass feel */
          background: linear-gradient(165deg, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0.85) 100%);
          backdrop-filter: blur(20px) saturate(180%); -webkit-backdrop-filter: blur(20px) saturate(180%);
          border-radius: 24px;
          /* Highlight border */
          border: 1px solid rgba(255, 255, 255, 0.8);
          /* Rich shadow + Top highlight for 3D glass effect */
          box-shadow: 
            0 25px 50px -12px rgba(0, 0, 0, 0.15), 
            inset 0 1px 0 rgba(255, 255, 255, 1),
            inset 0 0 0 1px rgba(255, 255, 255, 0.2);
          padding: 40px 32px;
          color: #1d1d1f;
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
          animation: importScaleIn 0.35s cubic-bezier(0.16, 1, 0.3, 1);
          display: flex; flex-direction: column; align-items: center;
        }
        .import-mode-modal-lite h4 {
          margin: 0 0 12px; font-size: 22px; font-weight: 600; letter-spacing: -0.01em; text-align: center;
          color: #1d1d1f;
        }
        .import-mode-modal-lite > p {
          margin: 0 0 32px; font-size: 15px; color: #86868b; text-align: center; line-height: 1.4;
        }
        .import-mode-options-lite {
          display: grid; grid-template-columns: 1fr 1fr; gap: 16px; width: 100%;
        }
        .import-mode-option-lite {
          display: flex; flex-direction: column; align-items: center; text-align: center;
          padding: 24px 16px;
          /* Glassy cards */
          background: linear-gradient(145deg, rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0.6));
          border: 1px solid rgba(255, 255, 255, 0.6);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03), inset 0 1px 0 rgba(255, 255, 255, 0.8);
          border-radius: 20px;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.25, 0.1, 0.25, 1);
          user-select: none;
        }
        .import-mode-option-lite:hover {
          background: linear-gradient(145deg, rgba(255, 255, 255, 1), rgba(255, 255, 255, 0.9));
          transform: translateY(-2px);
          box-shadow: 0 12px 24px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 1);
          border-color: rgba(255, 255, 255, 1);
        }
        .import-mode-option-lite:active {
          transform: scale(0.98);
          background: rgba(245, 245, 247, 0.9);
        }
        .mode-icon-lite {
          font-size: 36px; margin-bottom: 14px;
          filter: drop-shadow(0 4px 6px rgba(0,0,0,0.1));
          transition: transform 0.3s ease;
        }
        .import-mode-option-lite:hover .mode-icon-lite {
          transform: scale(1.1) rotate(-5deg);
        }
        .import-mode-option-lite strong {
          display: block; font-size: 16px; font-weight: 600; margin-bottom: 6px; color: #1d1d1f;
        }
        .import-mode-option-lite p {
          font-size: 13px; color: #86868b; line-height: 1.4; margin: 0;
        }
        .close-btn-lite {
          position: absolute; top: 16px; right: 16px;
          width: 28px; height: 28px;
          border-radius: 50%; border: none;
          background: rgba(0, 0, 0, 0.05);
          color: #86868b; font-size: 18px; line-height: 1;
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          transition: all 0.2s;
        }
        .close-btn-lite:hover {
          background: rgba(0, 0, 0, 0.1); color: #1d1d1f;
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(overlay);
  }

  function processImportPayload(file, mode) {
    const inputFile = file;
    if (!inputFile) {
      window.showMessage && window.showMessage('请选择要导入的文件', 'warning');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => window.showMessage && window.showMessage('文件读取失败', 'error');
    reader.onload = async () => {
      let data;
      try {
        data = JSON.parse(reader.result);
      } catch (error) {
        window.showMessage && window.showMessage('文件格式无效，需为 JSON', 'error');
        return;
      }
      try {
        const manager = await ensureDataBackupManager();
        const result = await manager.importPracticeData(data, {
          mergeMode: mode === 'replace' ? 'replace' : 'merge',
          createBackup: true,
          validateData: true
        });
        window.showMessage && window.showMessage(`导入成功：新增 ${result.importedCount || 0} 条，跳过 ${result.skippedCount || 0} 条。`, 'success');
      } catch (error) {
        console.error('[importData] failed', error);
        window.showMessage && window.showMessage('导入失败：' + (error && error.message ? error.message : error), 'error');
      }
    };
    reader.readAsText(inputFile, 'utf-8');
  }

  if (typeof window.exportAllData !== 'function') {
    window.exportAllData = async function () {
      var manager = null;
      try {
        manager = await _ensureFallbackDataIntegrityManagerAsync();
      } catch (error) {
        console.error('[Fallback] 数据导出模块加载失败:', error);
        window.showMessage && window.showMessage((error && error.message) || '数据管理模块未初始化', 'error');
        return;
      }

      try {
        await manager.exportData();
        window.showMessage && window.showMessage('数据导出成功', 'success');
      } catch (error) {
        console.error('[Fallback] 数据导出失败:', error);
        window.showMessage && window.showMessage('数据导出失败: ' + (error && error.message ? error.message : error), 'error');
      }
    };
  }

  if (typeof window.importData !== 'function') {
    window.importData = function () {
      showImportModeModal((mode) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = (event) => {
          const file = event.target.files && event.target.files[0];
          processImportPayload(file, mode);
        };
        input.click();
      });
    };
  }

  function _fallbackIsQuotaExceeded(error) {
    return !!(error && (
      error.name === 'QuotaExceededError' ||
      (typeof error.message === 'string' && error.message.indexOf('exceeded the quota') !== -1) ||
      error.code === 22 || error.code === 1014
    ));
  }

  // Fallbacks for backup operations used by Settings
  if (typeof window.createManualBackup !== 'function') {
    window.createManualBackup = async function () {
      var manager = null;
      try {
        manager = await _ensureFallbackDataIntegrityManagerAsync();
      } catch (error) {
        window.showMessage && window.showMessage((error && error.message) || '数据管理模块未初始化', 'error');
        return;
      }
      try {
        var backup = await manager.createBackup(null, 'manual');
        if (backup && backup.external) {
          window.showMessage && window.showMessage('本地存储不足，已将备份下载为文件', 'warning');
        } else {
          window.showMessage && window.showMessage('备份创建成功: ' + (backup && backup.id ? backup.id : ''), 'success');
        }
        try { if (typeof window.showBackupList === 'function') { window.showBackupList(); } } catch (_) { }
      } catch (error) {
        if (_fallbackIsQuotaExceeded(error)) {
          try {
            await manager.exportData();
            window.showMessage && window.showMessage('存储不足：已将数据导出为文件', 'warning');
          } catch (exportErr) {
            window.showMessage && window.showMessage('备份失败且导出失败: ' + (exportErr && exportErr.message ? exportErr.message : exportErr), 'error');
          }
        } else {
          window.showMessage && window.showMessage('备份创建失败: ' + (error && error.message ? error.message : error), 'error');
        }
      }
    };
  }

  if (typeof window.showBackupList !== 'function') {
    window.showBackupList = async function () {
      var manager = null;
      try {
        manager = await _ensureFallbackDataIntegrityManagerAsync();
      } catch (error) {
        window.showMessage && window.showMessage((error && error.message) || '数据管理模块未初始化', 'error');
        return;
      }

      _ensureFallbackBackupDelegates();
      var backups = [];
      try {
        backups = await manager.getBackupList();
      } catch (error) {
        console.warn('[Fallback] 获取备份列表失败:', error);
        window.showMessage && window.showMessage('无法获取备份列表', 'error');
        return;
      }

      var container = document.getElementById('settings-view');
      var create = _fallbackCreateElement;

      // 防止重复渲染多个列表/遮罩
      var existingInline = (container && container.querySelector('.backup-list-container')) || document.querySelector('.backup-list-container');
      if (existingInline) {
        existingInline.remove();
      }
      var existingOverlay = document.querySelector('.backup-modal-overlay');
      if (existingOverlay) {
        existingOverlay.remove();
      }

      var buildEntries = function () {
        if (!Array.isArray(backups) || backups.length === 0) {
          return [
            create('div', { className: 'backup-list-empty' }, [
              create('div', { className: 'backup-list-empty-icon', ariaHidden: 'true' }, '📂'),
              create('p', { className: 'backup-list-empty-text' }, '暂无备份记录。'),
              create('p', { className: 'backup-list-empty-hint' }, '创建手动备份后将显示在此列表中。')
            ])
          ];
        }

        return backups.map(function (backup) {
          return create('div', {
            className: 'backup-entry',
            dataset: { backupId: backup.id }
          }, [
            create('div', { className: 'backup-entry-info' }, [
              create('strong', { className: 'backup-entry-id' }, backup.id),
              create('div', { className: 'backup-entry-meta' }, new Date(backup.timestamp).toLocaleString()),
              create('div', { className: 'backup-entry-meta' }, '类型: ' + backup.type + ' | 版本: ' + backup.version)
            ]),
            create('div', { className: 'backup-entry-actions' }, [
              create('button', {
                type: 'button',
                className: 'btn btn-success backup-entry-restore',
                dataset: { backupAction: 'restore', backupId: backup.id }
              }, '恢复')
            ])
          ]);
        });
      };

      var existing = document.querySelector('.backup-modal-overlay');
      if (existing) existing.remove();

      var card = create('div', { className: 'backup-list-card' }, [
        create('div', { className: 'backup-list-header' }, [
          create('h3', { className: 'backup-list-title' }, [
            create('span', { className: 'backup-list-title-icon', ariaHidden: 'true' }, '📋'),
            create('span', { className: 'backup-list-title-text' }, '备份列表')
          ]),
          create('button', {
            type: 'button',
            className: 'btn btn-secondary backup-list-dismiss',
            dataset: { backupAction: 'dismiss-inline' }
          }, '收起')
        ]),
        create('div', { className: 'backup-list-scroll' }, buildEntries())
      ]);

      if (container) {
        var holder = create('div', { className: 'backup-list-container' }, card);
        var settingsGroup = container.querySelector('.hero-settings-group');
        if (settingsGroup && settingsGroup.parentElement === container) {
          settingsGroup.insertAdjacentElement('afterend', holder);
        } else {
          container.appendChild(holder);
        }
        if (!Array.isArray(backups) || backups.length === 0) {
          window.showMessage && window.showMessage('暂无备份记录', 'info');
        }
        return;
      }

      var overlay = create('div', { className: 'backup-modal-overlay' }, [
        create('div', { className: 'backup-modal' }, [
          create('div', { className: 'backup-modal-header' }, [
            create('h3', { className: 'backup-modal-title' }, [
              create('span', { className: 'backup-list-title-icon', ariaHidden: 'true' }, '📋'),
              create('span', { className: 'backup-list-title-text' }, '备份列表')
            ]),
            create('button', {
              type: 'button',
              className: 'btn btn-secondary backup-modal-close',
              dataset: { backupAction: 'close-modal' },
              ariaLabel: '关闭备份列表'
            }, '关闭')
          ]),
          create('div', { className: 'backup-modal-body' }, buildEntries()),
          create('div', { className: 'backup-modal-footer' }, [
            create('button', {
              type: 'button',
              className: 'btn btn-secondary backup-modal-close',
              dataset: { backupAction: 'close-modal' }
            }, '关闭')
          ])
        ])
      ]);

      document.body.appendChild(overlay);
      if (!Array.isArray(backups) || backups.length === 0) {
        window.showMessage && window.showMessage('暂无备份记录', 'info');
      }
    };

    if (typeof window.restoreBackup !== 'function') {
      window.restoreBackup = function (id) {
        _fallbackRestoreBackupById(id);
      };
    }
  }

  async function ensureDefaultConfig() {
    try {
      var configs = [];
      if (window.storage && storage.get) {
        var maybeConfigs = storage.get('exam_index_configurations', []);
        configs = (maybeConfigs && typeof maybeConfigs.then === 'function') ? await maybeConfigs : maybeConfigs;
      }
      if (!Array.isArray(configs)) configs = [];
      var hasDefault = configs.some(function (c) { return c && c.key === 'exam_index'; });
      if (!hasDefault) {
        var count = Array.isArray(window.examIndex) ? window.examIndex.length : 0;
        configs.push({ name: '默认题库', key: 'exam_index', examCount: count, timestamp: Date.now() });
        if (window.storage && storage.set) {
          try {
            var maybeSetConfigs = storage.set('exam_index_configurations', configs);
            if (maybeSetConfigs && typeof maybeSetConfigs.then === 'function') await maybeSetConfigs;
          } catch (err) {
            console.warn('[Fallback] 无法保存 exam_index_configurations:', err);
          }
        }
        if (window.storage && storage.get) {
          try {
            var currentActive = storage.get('active_exam_index_key');
            currentActive = (currentActive && typeof currentActive.then === 'function') ? await currentActive : currentActive;
            if (!currentActive && window.storage && storage.set) {
              var maybeSetActive = storage.set('active_exam_index_key', 'exam_index');
              if (maybeSetActive && typeof maybeSetActive.then === 'function') await maybeSetActive;
            }
          } catch (activeErr) {
            console.warn('[Fallback] 无法校正 active_exam_index_key:', activeErr);
          }
        }
      }
      return configs;
    } catch (e) {
      console.warn('[Fallback] ensureDefaultConfig 失败:', e);
      return [];
    }
  }

  // Fallback for library config list
  if (typeof window.showLibraryConfigListV2 !== 'function') {
    window.showLibraryConfigListV2 = async function () {
      var configs = [];
      try {
        configs = (window.storage && storage.get) ? await storage.get('exam_index_configurations', []) : [];
      } catch (e) {
        configs = [];
      }
      if (!Array.isArray(configs) || configs.length === 0) {
        configs = await ensureDefaultConfig();
      }
      if (!Array.isArray(configs) || configs.length === 0) {
        if (window.showMessage) showMessage('暂无题库配置记录', 'info');
        return;
      }

      var activeKey = 'exam_index';
      try {
        if (window.storage && storage.get) {
          activeKey = await storage.get('active_exam_index_key', 'exam_index');
        }
      } catch (e) { }

      if (typeof window.renderLibraryConfigList === 'function') {
        window.renderLibraryConfigList({ configs: configs, activeKey: activeKey, allowDelete: true });
        return;
      }

      var container = document.getElementById('settings-view');
      if (!container) { return; }

      if (typeof window.renderLibraryConfigFallback === 'function') {
        window.renderLibraryConfigFallback(container, configs, { activeKey: activeKey });
        return;
      }

      var hostClass = 'library-config-list';
      var host = container.querySelector('.' + hostClass);
      if (!host) { host = document.createElement('div'); host.className = hostClass; container.appendChild(host); }
      while (host.firstChild) { host.removeChild(host.firstChild); }

      var panel = document.createElement('div');
      panel.className = 'library-config-panel';

      var header = document.createElement('div');
      header.className = 'library-config-panel__header';
      var title = document.createElement('h3');
      title.className = 'library-config-panel__title';
      title.textContent = '📚 题库配置列表';
      header.appendChild(title);
      panel.appendChild(header);

      var list = document.createElement('div');
      list.className = 'library-config-panel__list';
      configs.forEach(function (cfg) {
        if (!cfg) return;
        var item = document.createElement('div');
        item.className = 'library-config-panel__item' + (cfg.key === activeKey ? ' library-config-panel__item--active' : '');

        var info = document.createElement('div');
        info.className = 'library-config-panel__info';
        var titleLine = document.createElement('div');
        titleLine.textContent = (cfg.key === 'exam_index' ? '默认题库' : (cfg.name || cfg.key));
        info.appendChild(titleLine);

        var meta = document.createElement('div');
        meta.className = 'library-config-panel__meta';
        try {
          meta.textContent = new Date(cfg.timestamp).toLocaleString() + ' · ' + (cfg.examCount || 0) + ' 个题目';
        } catch (err) {
          meta.textContent = (cfg.examCount || 0) + ' 个题目';
        }
        info.appendChild(meta);

        var actions = document.createElement('div');
        actions.className = 'library-config-panel__actions';
        var switchBtn = document.createElement('button');
        switchBtn.className = 'btn btn-secondary';
        switchBtn.type = 'button';
        switchBtn.dataset.configAction = 'switch';
        switchBtn.dataset.configKey = cfg.key;
        if (cfg.key === activeKey) switchBtn.disabled = true;
        switchBtn.textContent = '切换';
        actions.appendChild(switchBtn);

        if (cfg.key !== 'exam_index') {
          var deleteBtn = document.createElement('button');
          deleteBtn.className = 'btn btn-warning';
          deleteBtn.type = 'button';
          deleteBtn.dataset.configAction = 'delete';
          deleteBtn.dataset.configKey = cfg.key;
          if (cfg.key === activeKey) deleteBtn.disabled = true;
          deleteBtn.textContent = '删除';
          actions.appendChild(deleteBtn);
        }

        item.appendChild(info);
        item.appendChild(actions);
        list.appendChild(item);
      });

      panel.appendChild(list);

      var footer = document.createElement('div');
      footer.className = 'library-config-panel__footer';
      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'btn btn-secondary library-config-panel__close';
      closeBtn.dataset.configAction = 'close';
      closeBtn.textContent = '关闭';
      footer.appendChild(closeBtn);
      panel.appendChild(footer);

      host.appendChild(panel);
      host.onclick = function (event) {
        var target = event.target && event.target.closest('[data-config-action]');
        if (!target || !host.contains(target)) return;
        var action = target.dataset.configAction;
        if (action === 'close') { host.remove(); return; }
        if (action === 'switch' && typeof window.switchLibraryConfig === 'function') {
          window.switchLibraryConfig(target.dataset.configKey);
        }
        if (action === 'delete' && typeof window.deleteLibraryConfig === 'function') {
          window.deleteLibraryConfig(target.dataset.configKey);
        }
      };
    };
  }

  function _fallbackReasonLabel(reason) {
    var map = {
      'insufficient-listening-signals': '听力题源信号不足',
      'missing-answer-or-scoring-path': '缺少答案或评分链路',
      'missing-listening-page-signals': '缺少听力页面结构',
      'looks-like-reading': '疑似阅读题源',
      'looks-like-listening': '疑似听力题源',
      unknown: '未知原因'
    };
    return map[reason] || reason || map.unknown;
  }

  function _fallbackClearElement(element) {
    if (!element) return;
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  }

  function _fallbackAppendReportStat(parent, label, value) {
    if (!parent) return;
    var item = _fallbackCreateElement('div', { className: 'library-loader-report-stat' }, [
      _fallbackCreateElement('span', { className: 'library-loader-report-stat__label' }, label),
      _fallbackCreateElement('strong', { className: 'library-loader-report-stat__value' }, String(value == null ? 0 : value))
    ]);
    if (item) parent.appendChild(item);
  }

  function _fallbackRenderLibraryUploadReport(report, target) {
    if (typeof document === 'undefined') {
      return null;
    }
    var container = target || document.getElementById('library-loader-report');
    if (!container || !report) {
      return null;
    }

    _fallbackClearElement(container);
    container.hidden = false;
    container.className = 'library-loader-report library-loader-report--' + (report.status || 'info');

    var title = report.status === 'success'
      ? '导入完成'
      : (report.status === 'empty' ? '未识别到可用题源' : '导入报告');
    container.appendChild(_fallbackCreateElement('div', { className: 'library-loader-report__title' }, title));

    if (report.message) {
      container.appendChild(_fallbackCreateElement('p', { className: 'library-loader-report__message' }, report.message));
    }

    var stats = _fallbackCreateElement('div', { className: 'library-loader-report-stats' });
    _fallbackAppendReportStat(stats, '识别题目', report.accepted);
    _fallbackAppendReportStat(stats, '排除候选', report.rejected);
    _fallbackAppendReportStat(stats, '扫描 HTML', report.html);
    _fallbackAppendReportStat(stats, '音频文件', report.audio);
    if (report.merge) {
      _fallbackAppendReportStat(stats, '新增', report.merge.added);
      _fallbackAppendReportStat(stats, '更新', report.merge.updated);
    }
    container.appendChild(stats);

    if (report.runtime && report.runtime.html > 0) {
      container.appendChild(_fallbackCreateElement('p', { className: 'library-loader-report__note' },
        '外部文件夹题源已用当前会话 Blob URL 打开；刷新浏览器后如原路径不可访问，请重新加载该文件夹。'
      ));
    }

    var reasonCounts = report.reasonCounts || {};
    var reasons = Object.keys(reasonCounts).filter(function (key) { return reasonCounts[key] > 0; });
    if (reasons.length) {
      var reasonList = _fallbackCreateElement('ul', { className: 'library-loader-report-reasons' });
      reasons.slice(0, 5).forEach(function (reason) {
        reasonList.appendChild(_fallbackCreateElement('li', null, _fallbackReasonLabel(reason) + '：' + reasonCounts[reason]));
      });
      container.appendChild(reasonList);
    }

    var samples = Array.isArray(report.rejectedSamples) ? report.rejectedSamples.slice(0, 3) : [];
    if (samples.length) {
      var sampleList = _fallbackCreateElement('div', { className: 'library-loader-report-samples' });
      samples.forEach(function (sample) {
        sampleList.appendChild(_fallbackCreateElement('div', { className: 'library-loader-report-sample' },
          (sample.path || 'unknown.html') + ' · ' + _fallbackReasonLabel(sample.reason)
        ));
      });
      container.appendChild(sampleList);
    }
    return container;
  }

  if (typeof window.renderLibraryUploadReport !== 'function') {
    window.renderLibraryUploadReport = _fallbackRenderLibraryUploadReport;
  }

  // Fallback improved loader modal (only if missing or still lazy proxy)
  if (typeof window.showLibraryLoaderModal !== 'function' || _isLazyProxy(window.showLibraryLoaderModal)) {
    window.showLibraryLoaderModal = function () {
      if (typeof document === 'undefined') {
        return;
      }

      var existing = document.getElementById('library-loader-overlay');
      if (existing && typeof existing.remove === 'function') {
        existing.remove();
      }

      var create = _fallbackCreateElement;
      var ensureArray = function (value) {
        return Array.isArray(value) ? value : [value];
      };

      var createLoaderCard = function (type, title, description, hint) {
        var prefix = type === 'reading' ? 'reading' : 'listening';
        return create('div', {
          className: 'library-loader-card library-loader-card--' + type
        }, [
          create('div', { className: 'library-loader-card-kicker' }, type === 'reading' ? 'READING' : 'LISTENING'),
          create('h3', { className: 'library-loader-card-title' }, title),
          create('p', { className: 'library-loader-card-description' }, description),
          create('div', { className: 'library-loader-actions' }, [
            create('button', {
              type: 'button',
              className: 'btn library-loader-primary',
              id: prefix + '-full-btn',
              dataset: {
                libraryAction: 'trigger-input',
                libraryTarget: prefix + '-full-input'
              }
            }, '创建全量配置'),
            create('button', {
              type: 'button',
              className: 'btn btn-secondary library-loader-secondary',
              id: prefix + '-inc-btn',
              dataset: {
                libraryAction: 'trigger-input',
                libraryTarget: prefix + '-inc-input'
              }
            }, '创建增量配置')
          ]),
          create('input', {
            type: 'file',
            id: prefix + '-full-input',
            className: 'library-loader-input',
            multiple: true,
            webkitdirectory: true,
            dataset: {
              libraryType: type,
              libraryMode: 'full'
            }
          }),
          create('input', {
            type: 'file',
            id: prefix + '-inc-input',
            className: 'library-loader-input',
            multiple: true,
            webkitdirectory: true,
            dataset: {
              libraryType: type,
              libraryMode: 'incremental'
            }
          }),
          create('p', { className: 'library-loader-hint' }, hint)
        ]);
      };

      var overlay = create('div', {
        className: 'modal-overlay show library-loader-overlay',
        id: 'library-loader-overlay',
        role: 'dialog',
        ariaModal: 'true',
        ariaLabelledby: 'library-loader-title'
      });

      var modal = create('div', {
        className: 'modal library-loader-modal',
        role: 'document'
      });

      var header = create('div', { className: 'modal-header library-loader-header' }, [
        create('div', { className: 'library-loader-title-group' }, [
          create('div', { className: 'library-loader-eyebrow' }, 'LIBRARY IMPORT'),
          create('h2', { className: 'modal-title', id: 'library-loader-title' }, '加载题库')
        ]),
        create('button', {
          type: 'button',
          className: 'modal-close library-loader-close',
          ariaLabel: '关闭',
          dataset: { libraryAction: 'close' }
        }, '×')
      ]);

      var body = create('div', { className: 'modal-body library-loader-body' }, [
        create('div', { className: 'library-loader-grid' }, [
          createLoaderCard('reading', '阅读题库', '从所选文件夹递归识别 HTML/PDF 题源。', '全量只替换阅读索引；增量只追加或更新新阅读题。'),
          createLoaderCard('listening', '听力题库', '从任意层级识别带答案链路的听力 HTML 和音频。', '全量只替换听力索引；增量只追加或更新新听力题。')
        ]),
        create('div', { className: 'library-loader-instructions' }, [
          create('div', { className: 'library-loader-instructions-title' }, '配置隔离'),
          create('ul', { className: 'library-loader-instructions-list' }, [
            create('li', null, '每次导入都会创建新的题库配置，旧配置和练习记录保持不动。'),
            create('li', null, '阅读与听力索引独立更新，另一类型从当前配置继承。')
          ])
        ]),
        create('div', {
          className: 'library-loader-report',
          id: 'library-loader-report',
          hidden: true
        })
      ]);

      var footer = create('div', { className: 'modal-footer library-loader-footer' }, [
        create('button', {
          type: 'button',
          className: 'btn btn-secondary library-loader-close-btn',
          id: 'close-loader',
          dataset: { libraryAction: 'close' }
        }, '关闭')
      ]);

      ensureArray([header, body, footer]).forEach(function (section) {
        if (section) {
          modal.appendChild(section);
        }
      });

      overlay.appendChild(modal);
      if (document.body) {
        document.body.appendChild(overlay);
      }

      var clickHandler = function (event) {
        var target = event.target && event.target.closest ? event.target.closest('[data-library-action]') : null;
        if (!target || !overlay.contains(target)) {
          return;
        }

        var action = target.dataset.libraryAction;
        if (action === 'close') {
          event.preventDefault();
          cleanup();
          return;
        }

        if (action === 'trigger-input') {
          event.preventDefault();
          var targetId = target.dataset.libraryTarget;
          if (!targetId) {
            return;
          }
          var input = overlay.querySelector('#' + targetId);
          if (input) {
            input.click();
          }
        }
      };

      var changeHandler = function (event) {
        var input = event.target && event.target.closest ? event.target.closest('.library-loader-input') : null;
        if (!input || !overlay.contains(input)) {
          return;
        }

        var files = Array.prototype.slice.call(input.files || []);
        if (files.length === 0) {
          return;
        }

        var type = input.dataset.libraryType;
        var mode = input.dataset.libraryMode;
        if (!type || !mode) {
          cleanup();
          return;
        }

        if (typeof Promise === 'undefined') {
          cleanup();
          return;
        }

        var upload = null;
        try {
          if (typeof window.handleLibraryUpload === 'function') {
            upload = window.handleLibraryUpload({ type: type, mode: mode }, files);
          }
        } catch (error) {
          console.error('[Fallback] 处理题库上传失败:', error);
          upload = Promise.reject(error);
        }

        Promise.resolve(upload).then(function (result) {
          if (result && typeof window.renderLibraryUploadReport === 'function') {
            window.renderLibraryUploadReport(result, overlay.querySelector('#library-loader-report'));
            input.value = '';
            return;
          }
          cleanup();
        }).catch(function (error) {
          console.error('[Fallback] 题库上传流程出错:', error);
          if (typeof window.renderLibraryUploadReport === 'function') {
            window.renderLibraryUploadReport({
              status: 'error',
              accepted: 0,
              rejected: 0,
              html: 0,
              audio: 0,
              message: error && error.message ? error.message : '题库上传失败'
            }, overlay.querySelector('#library-loader-report'));
            input.value = '';
            return;
          }
          cleanup();
        });
      };

      function cleanup() {
        overlay.removeEventListener('click', clickHandler);
        overlay.removeEventListener('change', changeHandler);
        if (overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
      }

      overlay.addEventListener('click', clickHandler);
      overlay.addEventListener('change', changeHandler);
    };
  }

  if (typeof window.handleLibraryUpload !== 'function') {
    var _cachedDefaultReading = null;
    var _cachedDefaultListening = null;

    async function _fallbackGetActiveLibraryKey() {
      if (typeof window.getActiveLibraryConfigurationKey === 'function') {
        try { return await window.getActiveLibraryConfigurationKey(); } catch (_) { }
      }
      if (storage && storage.get) {
        try {
          var maybeKey = storage.get('active_exam_index_key', 'exam_index');
          var key = (maybeKey && typeof maybeKey.then === 'function') ? await maybeKey : maybeKey;
          return key || 'exam_index';
        } catch (_) { }
      }
      return 'exam_index';
    }

    async function _fallbackSetActiveLibraryKey(key) {
      if (!key) return;
      if (typeof window.setActiveLibraryConfiguration === 'function') {
        try { await window.setActiveLibraryConfiguration(key); return; } catch (_) { }
      }
      if (storage && storage.set) {
        try {
          var maybe = storage.set('active_exam_index_key', key);
          if (maybe && typeof maybe.then === 'function') await maybe;
        } catch (err) {
          console.warn('[Fallback] 无法写入 active_exam_index_key:', err);
        }
      }
    }

    async function _fallbackSaveLibraryConfiguration(name, key, count) {
      var entry = { name: name, key: key, examCount: count, timestamp: Date.now() };
      if (typeof window.saveLibraryConfiguration === 'function') {
        try { await window.saveLibraryConfiguration(name, key, count); return; } catch (_) { }
      }
      if (storage && storage.get && storage.set) {
        try {
          var existing = storage.get('exam_index_configurations', []);
          existing = (existing && typeof existing.then === 'function') ? await existing : existing;
          if (!Array.isArray(existing)) existing = [];
          var idx = existing.findIndex(function (c) { return c && c.key === key; });
          if (idx >= 0) { existing[idx] = entry; } else { existing.push(entry); }
          var maybeSave = storage.set('exam_index_configurations', existing);
          if (maybeSave && typeof maybeSave.then === 'function') await maybeSave;
        } catch (err) {
          console.warn('[Fallback] 保存题库配置失败:', err);
        }
      }
    }

    async function _fallbackSaveIndexForKey(key, list) {
      if (storage && storage.set) {
        var maybe = storage.set(key, list);
        if (maybe && typeof maybe.then === 'function') {
          await maybe;
        }
      } else {
        try { window[key] = list; } catch (_) { }
      }
    }

    async function _fallbackApplyLibraryConfig(key, dataset, options) {
      if (typeof window.applyLibraryConfiguration === 'function') {
        try { return await window.applyLibraryConfiguration(key, dataset, options || {}); } catch (_) { }
      }
      // fallback:直接刷新内存状态与UI
      if (typeof window.setExamIndexState === 'function') {
        try { window.setExamIndexState(dataset); } catch (_) { }
      } else {
        try { window.examIndex = Array.isArray(dataset) ? dataset.slice() : []; } catch (_) { }
      }
      if (options && options.setActive) {
        await _fallbackSetActiveLibraryKey(key);
      }
      try { if (typeof window.updateOverview === 'function') window.updateOverview(); } catch (_) { }
      try {
        if (typeof window.loadExamList === 'function') {
          window.loadExamList();
        }
      } catch (_) { }
      return true;
    }

    function _fallbackDefaultPathRoot(type) {
      if (type === 'reading') {
        return '睡着过项目组/2. 所有文章(11.20)[192篇]/';
      }
      return 'ListeningPractice/';
    }

    function _fallbackHasProtocol(value) {
      return /^(?:[a-z]+:)?\/\//i.test(String(value || '')) || /^[A-Za-z]:\\/.test(String(value || ''));
    }

    function _fallbackNormalizeSlashPath(value) {
      return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
    }

    function _fallbackAbsolutizeDefaultExamPath(exam) {
      if (!exam || typeof exam !== 'object') {
        return exam;
      }
      var next = Object.assign({}, exam);
      var type = next.type === 'reading' ? 'reading' : (next.type === 'listening' ? 'listening' : '');
      var path = _fallbackNormalizeSlashPath(next.path || '');
      if (!type || !path || _fallbackHasProtocol(path) || next.sourceKind === 'file-picker') {
        return next;
      }

      var root = _fallbackDefaultPathRoot(type);
      var normalizedRoot = _fallbackNormalizeSlashPath(root);
      if (normalizedRoot && !path.toLowerCase().startsWith(normalizedRoot.toLowerCase())) {
        if (type === 'listening' && /^P[1-4]\//i.test(path)) {
          next.path = normalizedRoot.replace(/\/+$/, '') + '/' + path;
        }
      }
      return next;
    }

    function _fallbackNormalizeIndexForCustomConfig(index) {
      return Array.isArray(index)
        ? index.map(_fallbackAbsolutizeDefaultExamPath)
        : [];
    }

    function _fallbackMergeLibraryEntries(currentIndex, additions, type, mode) {
      var discovery = window.LibraryDiscovery;
      if (discovery && typeof discovery.mergeExamIndexes === 'function') {
        return discovery.mergeExamIndexes(currentIndex, additions, { type: type, mode: mode });
      }

      var current = Array.isArray(currentIndex) ? currentIndex.slice() : [];
      var incoming = Array.isArray(additions) ? additions.slice() : [];
      var base = mode === 'full'
        ? current.filter(function (exam) { return !exam || exam.type !== type; })
        : current;
      var seen = new Set(base.map(function (exam) {
        return String((exam && (exam.importKey || ((exam.path || '') + '|' + (exam.filename || '') + '|' + (exam.title || '')))) || '').toLowerCase();
      }));
      var added = 0;
      incoming.forEach(function (exam) {
        var key = String((exam && (exam.importKey || ((exam.path || '') + '|' + (exam.filename || '') + '|' + (exam.title || '')))) || '').toLowerCase();
        if (key && seen.has(key)) {
          return;
        }
        if (key) {
          seen.add(key);
        }
        base.push(exam);
        added += 1;
      });
      return { index: base, added: added, updated: 0, skipped: incoming.length - added };
    }

    async function _fallbackDiscoverLibraryEntries(files, type, label) {
      if (!window.LibraryDiscovery || typeof window.LibraryDiscovery.discover !== 'function') {
        throw new Error('LibraryDiscovery 未加载，无法进行内容识别导入');
      }
      return window.LibraryDiscovery.discover(files, {
        type: type,
        label: label,
        registerRuntime: true
      });
    }

    function _fallbackBuildUploadReport(discoveryResult, overrides) {
      var base = discoveryResult && discoveryResult.report
        ? Object.assign({}, discoveryResult.report)
        : {
          accepted: 0,
          rejected: 0,
          files: 0,
          html: 0,
          pdf: 0,
          audio: 0,
          runtime: { registered: 0, html: 0, pdf: 0, audio: 0 },
          reasonCounts: {},
          rejectedSamples: [],
          warnings: []
        };
      var report = Object.assign(base, overrides || {});
      if (report.merge) {
        report.merge = {
          added: Number(report.merge.added) || 0,
          updated: Number(report.merge.updated) || 0,
          skipped: Number(report.merge.skipped) || 0
        };
      }
      return report;
    }

    async function _fallbackResolveDefault(type) {
      if (type === 'reading' && Array.isArray(_cachedDefaultReading)) {
        return _cachedDefaultReading;
      }
      if (type === 'listening' && Array.isArray(_cachedDefaultListening)) {
        return _cachedDefaultListening;
      }
      var data = [];
      if (type === 'reading' && typeof window.getReadingExamIndex === 'function') {
        data = window.getReadingExamIndex().map(function (e) { return Object.assign({}, e, { type: 'reading' }); });
        _cachedDefaultReading = data.slice();
      } else if (type === 'reading' && Array.isArray(window.__READING_EXAM_INDEX__)) {
        data = window.__READING_EXAM_INDEX__.map(function (e) { return Object.assign({}, e, { type: 'reading' }); });
        _cachedDefaultReading = data.slice();
      }
      if (type === 'listening' && Array.isArray(window.listeningExamIndex)) {
        data = window.listeningExamIndex.map(function (e) { return Object.assign({}, e, { type: 'listening' }); });
        _cachedDefaultListening = data.slice();
      }
      return data;
    }

    window.handleLibraryUpload = async function (options, files) {
      var type = options && options.type;
      var mode = options && options.mode === 'incremental' ? 'incremental' : 'full';
      if (type !== 'reading' && type !== 'listening') {
        window.showMessage && window.showMessage('未知的题库类型', 'error');
        return _fallbackBuildUploadReport(null, {
          status: 'error',
          message: '未知的题库类型'
        });
      }
      if (!Array.isArray(files) || files.length === 0) {
        window.showMessage && window.showMessage('请选择包含题目的文件夹', 'warning');
        return _fallbackBuildUploadReport(null, {
          status: 'empty',
          message: '请选择包含题目的文件夹'
        });
      }

      var label = mode === 'incremental' ? ('增量-' + new Date().toISOString().slice(0, 10)) : '';

      window.showMessage && window.showMessage('正在递归扫描文件并识别题源...', 'info');
      var discoveryResult;
      try {
        discoveryResult = await _fallbackDiscoverLibraryEntries(files, type, label);
      } catch (error) {
        console.error('[Fallback] 题库内容识别失败:', error);
        window.showMessage && window.showMessage('题库识别失败：' + (error && error.message ? error.message : '未知错误'), 'error');
        return _fallbackBuildUploadReport(null, {
          status: 'error',
          message: error && error.message ? error.message : '题库识别失败'
        });
      }

      var additions = discoveryResult && Array.isArray(discoveryResult.entries)
        ? discoveryResult.entries
        : [];
      if (!Array.isArray(additions) || additions.length === 0) {
        var rejectedCount = discoveryResult && discoveryResult.stats ? discoveryResult.stats.rejected : 0;
        var hint = type === 'listening'
          ? '未检测到有效听力HTML：需要同时包含听力页面结构和答案/评分/桥接链路。'
          : '从所选文件中未检测到任何阅读题目。';
        window.showMessage && window.showMessage(hint + (rejectedCount ? ' 已排除 ' + rejectedCount + ' 个候选文件。' : ''), 'warning');
        return _fallbackBuildUploadReport(discoveryResult, {
          status: 'empty',
          message: hint
        });
      }

      var manager = window.LibraryManager && typeof window.LibraryManager.getInstance === 'function'
        ? window.LibraryManager.getInstance()
        : null;
      if (manager && typeof manager.createImportedLibraryConfiguration === 'function') {
        try {
          var created = await manager.createImportedLibraryConfiguration({
            type: type,
            mode: mode,
            additions: additions,
            label: label,
            discoveryResult: discoveryResult,
            activate: true
          });
          window.showMessage && window.showMessage('新的题库配置已创建并激活：识别 ' + additions.length + ' 个题目', 'success');
          return _fallbackBuildUploadReport(discoveryResult, {
            status: 'success',
            mode: mode,
            configKey: created.key,
            configName: created.name,
            counts: created.counts,
            merge: created.merge,
            message: '新的题库配置已创建并激活'
          });
        } catch (managerError) {
          console.warn('[Fallback] LibraryManager 导入配置创建失败，使用旧降级路径:', managerError);
        }
      }

      var activeKey = await _fallbackGetActiveLibraryKey();
      var currentIndex = (typeof window.getExamIndexState === 'function')
        ? window.getExamIndexState()
        : (Array.isArray(window.examIndex) ? window.examIndex : []);
      if (storage && storage.get) {
        try {
          var maybeCurrent = storage.get(activeKey, currentIndex);
          currentIndex = (maybeCurrent && typeof maybeCurrent.then === 'function') ? await maybeCurrent : maybeCurrent;
        } catch (_) { }
      }
      if (!Array.isArray(currentIndex)) currentIndex = [];
      currentIndex = _fallbackNormalizeIndexForCustomConfig(currentIndex);

      var mergeResult;
      var newIndex;
      if (mode === 'full') {
        mergeResult = _fallbackMergeLibraryEntries(currentIndex, additions, type, 'full');
        newIndex = mergeResult.index;
        var otherType = type === 'reading' ? 'listening' : 'reading';
        if (!newIndex.some(function (e) { return e && e.type === otherType; })) {
          var fallbackOthers = await _fallbackResolveDefault(otherType);
          newIndex = newIndex.concat(_fallbackNormalizeIndexForCustomConfig(Array.isArray(fallbackOthers) ? fallbackOthers : []));
        }
      } else {
        mergeResult = _fallbackMergeLibraryEntries(currentIndex, additions, type, 'incremental');
        newIndex = mergeResult.index;
      }
      newIndex = _fallbackNormalizeIndexForCustomConfig(newIndex);
      if (typeof window.assignExamSequenceNumbers === 'function') {
        try { window.assignExamSequenceNumbers(newIndex); } catch (_) { }
      }

      var saveAndApply = async function (targetKey, configName, shouldApply) {
        await _fallbackSaveIndexForKey(targetKey, newIndex);
        var pathFallback = (typeof window.loadPathMapForConfiguration === 'function')
          ? await window.loadPathMapForConfiguration(targetKey)
          : null;
        var pathMap = (typeof window.derivePathMapFromIndex === 'function')
          ? window.derivePathMapFromIndex(newIndex, pathFallback)
          : pathFallback;
        if (typeof window.savePathMapForConfiguration === 'function') {
          await window.savePathMapForConfiguration(targetKey, newIndex, { overrideMap: pathMap, setActive: true });
        }
        await _fallbackSaveLibraryConfiguration(configName, targetKey, newIndex.length);
        await _fallbackSetActiveLibraryKey(targetKey);
        if (shouldApply !== false) {
          return _fallbackApplyLibraryConfig(targetKey, newIndex, { setActive: true, skipConfigRefresh: false });
        }
        return true;
      };

      if (mode === 'full') {
        var targetKey = 'exam_index_' + Date.now();
        var configName = (type === 'reading' ? '阅读' : '听力') + '全量-' + new Date().toLocaleString();
        try {
          await saveAndApply(targetKey, configName, true);
          window.showMessage && window.showMessage('新的题库配置已创建并激活：识别 ' + additions.length + ' 个题目', 'success');
          return _fallbackBuildUploadReport(discoveryResult, {
            status: 'success',
            mode: mode,
            configKey: targetKey,
            configName: configName,
            merge: mergeResult,
            message: '新的题库配置已创建并激活'
          });
        } catch (applyErr) {
          console.warn('[Fallback] 应用新题库失败，尝试刷新页面', applyErr);
          window.showMessage && window.showMessage('新的题库已保存，正在刷新界面...', 'warning');
          setTimeout(function () { try { location.reload(); } catch (_) { } }, 500);
          return _fallbackBuildUploadReport(discoveryResult, {
            status: 'warning',
            mode: mode,
            configKey: targetKey,
            configName: configName,
            merge: mergeResult,
            message: '新的题库已保存，界面刷新后生效'
          });
        }
      }

      var targetKeyInc = 'exam_index_' + Date.now();
      var configNameInc = (type === 'reading' ? '阅读' : '听力') + '增量-' + new Date().toLocaleString();
      await saveAndApply(targetKeyInc, configNameInc, false);
      await _fallbackApplyLibraryConfig(targetKeyInc, newIndex, { setActive: true, skipConfigRefresh: false });
      try { if (typeof window.updateOverview === 'function') window.updateOverview(); } catch (_) { }
      if (document.getElementById('browse-view') && document.getElementById('browse-view').classList.contains('active') && typeof window.loadExamList === 'function') {
        try { window.loadExamList(); } catch (_) { }
      }
      window.showMessage && window.showMessage('新的增量题库配置已创建并激活：新增/更新 ' + additions.length + ' 个题目', 'success');
      return _fallbackBuildUploadReport(discoveryResult, {
        status: 'success',
        mode: mode,
        configKey: targetKeyInc,
        configName: configNameInc,
        merge: mergeResult,
        message: '新的增量题库配置已创建并激活'
      });
    };
  }

  const VALID_INITIAL_VIEWS = ['overview', 'browse', 'practice', 'history', 'settings'];

  function readQueryView() {
    try {
      const search = window.location && window.location.search ? window.location.search : '';
      if (!search) return '';
      const params = new URLSearchParams(search);
      const value = (params.get('view') || '').trim().toLowerCase();
      return value;
    } catch (_) {
      return '';
    }
  }

  function resolveInitialView() {
    const hash = (window.location && window.location.hash) ? window.location.hash.replace(/^#/, '').trim().toLowerCase() : '';
    if (hash && VALID_INITIAL_VIEWS.indexOf(hash) !== -1) {
      return hash;
    }
    const queryView = readQueryView();
    if (queryView && VALID_INITIAL_VIEWS.indexOf(queryView) !== -1) {
      return queryView;
    }
    return 'overview';
  }

  function bootInitialView() {
    const targetView = resolveInitialView();
    if (typeof window.showView === 'function') {
      window.showView(targetView);
      return;
    }
    if (typeof window.app !== 'undefined' && typeof window.app.navigateToView === 'function') {
      window.app.navigateToView(targetView);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootInitialView);
  } else {
    bootInitialView();
  }
})();
