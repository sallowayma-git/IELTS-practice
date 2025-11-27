(function () {
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
      }
    });

    _fallbackBackupDelegatesConfigured = true;
  }

  async function _fallbackRestoreBackupById(backupId) {
    if (!backupId) {
      window.showMessage && window.showMessage('无效的备份ID', 'error');
      return;
    }

    var manager = _ensureFallbackDataIntegrityManager();
    if (!manager) {
      window.showMessage && window.showMessage('数据管理模块未初始化', 'error');
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
        note.className = 'message ' + (type || 'info');
        var icon = document.createElement('strong');
        var marks = { error: '✖', success: '✔', warning: '⚠️', info: 'ℹ️' };
        icon.textContent = marks[type] || marks.info;
        note.appendChild(icon);
        note.appendChild(document.createTextNode(' ' + (message || '')));
        container.appendChild(note);

        while (container.children.length > 3) {
          container.removeChild(container.firstChild);
        }

        var timeout = typeof duration === 'number' && duration > 0 ? duration : 4000;
        setTimeout(function () {
          note.classList.add('message-leaving');
          setTimeout(function () {
            if (note.parentNode) {
              note.parentNode.removeChild(note);
            }
          }, 320);
        }, timeout);
      } catch (_) { console.log('[Toast]', type || 'info', message); }
    };
  }

  // Fallbacks for data export/import buttons in Settings
  var disabledMessage = function (action) {
    window.showMessage && window.showMessage(action + '功能已移除', 'warning');
  };

  var ensureDataBackupManager = (function () {
    let loading = null;
    return function ensureDataBackupManager() {
      if (window.DataBackupManager) {
        return Promise.resolve(new window.DataBackupManager());
      }
      if (loading) {
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
    window.exportAllData = function () {
      disabledMessage('数据导出');
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

  function _fallbackAssignSequence(list) {
    if (typeof window.assignExamSequenceNumbers === 'function') {
      try { window.assignExamSequenceNumbers(list); return; } catch (_) { }
    }
    list.forEach(function (item, idx) {
      if (item && typeof item === 'object' && item.sequenceNumber == null) {
        item.sequenceNumber = idx + 1;
      }
    });
  }

  function _fallbackGetExamIndexState() {
    if (typeof window.getExamIndexState === 'function') {
      try { return window.getExamIndexState(); } catch (_) { }
    }
    return Array.isArray(window.examIndex) ? window.examIndex : [];
  }

  function _fallbackSetExamIndexState(list) {
    var cloned = Array.isArray(list) ? list.slice() : [];
    _fallbackAssignSequence(cloned);
    if (typeof window.setExamIndexState === 'function') {
      try { return window.setExamIndexState(cloned); } catch (_) { }
    }
    try { window.examIndex = cloned; } catch (_) { }
    return cloned;
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
      var manager = _ensureFallbackDataIntegrityManager();
      if (!manager) {
        window.showMessage && window.showMessage('数据管理模块未初始化', 'error');
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
            manager.exportData();
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
      var manager = _ensureFallbackDataIntegrityManager();
      if (!manager) {
        window.showMessage && window.showMessage('数据管理模块未初始化', 'error');
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
          ])
        ]),
        create('div', { className: 'backup-list-scroll' }, buildEntries())
      ]);

      if (container) {
        var holder = create('div', { className: 'backup-list-container' }, card);
        var mainCard = container.querySelector(':scope > div');
        if (mainCard) {
          mainCard.appendChild(holder);
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
            }, '全量重载'),
            create('button', {
              type: 'button',
              className: 'btn btn-secondary library-loader-secondary',
              id: prefix + '-inc-btn',
              dataset: {
                libraryAction: 'trigger-input',
                libraryTarget: prefix + '-inc-input'
              }
            }, '增量更新')
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
        create('h2', { className: 'modal-title', id: 'library-loader-title' }, '📚 加载题库'),
        create('button', {
          type: 'button',
          className: 'modal-close library-loader-close',
          ariaLabel: '关闭',
          dataset: { libraryAction: 'close' }
        }, '×')
      ]);

      var body = create('div', { className: 'modal-body library-loader-body' }, [
        create('div', { className: 'library-loader-grid' }, [
          createLoaderCard('reading', '📖 阅读题库加载', '支持全量重载与增量更新。请上传包含题目HTML/PDF的根文件夹。', '💡 建议路径：.../3. 所有文章(9.4)[134篇]/...'),
          createLoaderCard('listening', '🎧 听力题库加载', '支持全量重载与增量更新。请上传包含题目HTML/PDF/音频的根文件夹。', '💡 建议路径：ListeningPractice/P3 或 ListeningPractice/P4')
        ]),
        create('div', { className: 'library-loader-instructions' }, [
          create('div', { className: 'library-loader-instructions-title' }, '📋 操作说明'),
          create('ul', { className: 'library-loader-instructions-list' }, [
            create('li', null, '全量重载会替换当前配置中对应类型（阅读/听力）的全部索引，并保留另一类型原有数据。'),
            create('li', null, '增量更新会将新文件生成的新索引追加到当前配置。若当前为默认配置，则会自动复制为新配置后再追加，确保默认配置不被影响。')
          ])
        ])
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
        }

        Promise.resolve(upload).then(function () {
          cleanup();
        }).catch(function (error) {
          console.error('[Fallback] 题库上传流程出错:', error);
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

    function _fallbackDerivePathMap(exams, fallbackMap) {
      if (typeof window.derivePathMapFromIndex === 'function') {
        try { return window.derivePathMapFromIndex(exams, fallbackMap); } catch (_) { }
      }
      if (window.LibraryManager && typeof window.LibraryManager.derivePathMapFromIndex === 'function') {
        try { return window.LibraryManager.derivePathMapFromIndex(exams, fallbackMap); } catch (_) { }
      }
      return null;
    }

    async function _fallbackLoadPathMap(key) {
      if (typeof window.loadPathMapForConfiguration === 'function') {
        try { return await window.loadPathMapForConfiguration(key); } catch (_) { }
      }
      var manager = null;
      if (window.LibraryManager && typeof window.LibraryManager.getInstance === 'function') {
        manager = window.LibraryManager.getInstance();
      }
      if (manager && typeof manager.loadPathMapForConfiguration === 'function') {
        try { return await manager.loadPathMapForConfiguration(key); } catch (_) { }
      }
      return null;
    }

    async function _fallbackSavePathMap(key, exams, options) {
      if (typeof window.savePathMapForConfiguration === 'function') {
        try { return await window.savePathMapForConfiguration(key, exams, options || {}); } catch (_) { }
      }
      var manager = null;
      if (window.LibraryManager && typeof window.LibraryManager.getInstance === 'function') {
        manager = window.LibraryManager.getInstance();
      }
      if (manager && typeof manager.savePathMapForConfiguration === 'function') {
        try { return await manager.savePathMapForConfiguration(key, exams, options || {}); } catch (err) {
          console.warn('[Fallback] 保存路径映射失败:', err);
        }
      }
      return null;
    }

    async function _fallbackApplyLibraryConfig(key, dataset, options) {
      if (typeof window.applyLibraryConfiguration === 'function') {
        try { return await window.applyLibraryConfiguration(key, dataset, options || {}); } catch (_) { }
      }
      // fallback:直接刷新内存状态与UI
      _fallbackSetExamIndexState(dataset);
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

    function _fallbackDetectFolderPlacement(files, type) {
      var paths = files.map(function (f) { return f.webkitRelativePath || f.name; });
      if (type === 'reading') {
        return paths.some(function (p) { return /睡着过项目组\(9\.4\)\[134篇\]\/3\. 所有文章\(9\.4\)\[134篇\]\//.test(p); });
      }
      return paths.some(function (p) { return /^ListeningPractice\/(P3|P4)\//.test(p); });
    }

    async function _fallbackBuildIndexFromFiles(files, type, label) {
      var byDir = new Map();
      files.forEach(function (f) {
        var rel = f.webkitRelativePath || f.name;
        var parts = rel.split('/');
        if (parts.length < 2) return;
        var dir = parts.slice(0, parts.length - 1).join('/');
        if (!byDir.has(dir)) byDir.set(dir, []);
        byDir.get(dir).push(f);
      });

      var entries = [];
      var idx = 0;
      byDir.forEach(function (fs, dir) {
        var html = fs.find(function (x) { return x.name.toLowerCase().endsWith('.html'); });
        var pdf = fs.find(function (x) { return x.name.toLowerCase().endsWith('.pdf'); });
        if (!html && !pdf) return;
        var dirName = dir.split('/').pop();
        var title = dirName.replace(/^\d+\.\s*/, '');
        var category = 'P1';
        var m = dir.match(/\b(P1|P2|P3|P4)\b/);
        if (m) category = m[1];
        var basePath = dir + '/';
        if (type === 'listening') {
          basePath = basePath.replace(/^.*?(ListeningPractice\/)/, '$1');
        }
        var id = 'custom_' + type + '_' + Date.now() + '_' + (idx++);
        entries.push({
          id: id,
          title: label ? '[' + label + '] ' + title : title,
          category: category,
          type: type,
          path: basePath,
          filename: html ? html.name : undefined,
          pdfFilename: pdf ? pdf.name : undefined,
          hasHtml: !!html
        });
      });
      return entries;
    }

    async function _fallbackResolveDefault(type) {
      if (type === 'reading' && Array.isArray(_cachedDefaultReading)) {
        return _cachedDefaultReading;
      }
      if (type === 'listening' && Array.isArray(_cachedDefaultListening)) {
        return _cachedDefaultListening;
      }
      var data = [];
      if (type === 'reading' && Array.isArray(window.completeExamIndex)) {
        data = window.completeExamIndex.map(function (e) { return Object.assign({}, e, { type: 'reading' }); });
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
        return;
      }
      if (!Array.isArray(files) || files.length === 0) {
        window.showMessage && window.showMessage('请选择包含题目的文件夹', 'warning');
        return;
      }

      var label = '';
      if (mode === 'incremental') {
        try {
          label = prompt('为此次增量更新输入一个文件夹标签', '增量-' + new Date().toISOString().slice(0, 10)) || '';
        } catch (_) { }
        if (label) {
          window.showMessage && window.showMessage('使用标签: ' + label, 'info');
        }
        if (!_fallbackDetectFolderPlacement(files, type)) {
          var proceed = typeof confirm === 'function'
            ? confirm('检测到文件夹不在推荐的结构中。\n阅读: .../3. 所有文章(9.4)[134篇]/...\n听力: ListeningPractice/P3 或 P4\n是否继续?')
            : true;
          if (!proceed) return;
        }
      }

      window.showMessage && window.showMessage('正在解析文件并构建索引...', 'info');
      var additions = await _fallbackBuildIndexFromFiles(files, type, label);
      if (!Array.isArray(additions) || additions.length === 0) {
        window.showMessage && window.showMessage('从所选文件中未检测到任何题目', 'warning');
        return;
      }

      var activeKey = await _fallbackGetActiveLibraryKey();
      var currentIndex = _fallbackGetExamIndexState();
      if (storage && storage.get) {
        try {
          var maybeCurrent = storage.get(activeKey, currentIndex);
          currentIndex = (maybeCurrent && typeof maybeCurrent.then === 'function') ? await maybeCurrent : maybeCurrent;
        } catch (_) { }
      }
      if (!Array.isArray(currentIndex)) currentIndex = [];

      var newIndex;
      if (mode === 'full') {
        var others = currentIndex.filter(function (e) { return e && e.type !== type; });
        newIndex = others.concat(additions);
        var otherType = type === 'reading' ? 'listening' : 'reading';
        if (!newIndex.some(function (e) { return e && e.type === otherType; })) {
          var fallbackOthers = await _fallbackResolveDefault(otherType);
          newIndex = newIndex.concat(Array.isArray(fallbackOthers) ? fallbackOthers : []);
        }
      } else {
        var existingKeys = new Set(currentIndex.map(function (e) { return (e.path || '') + '|' + (e.filename || '') + '|' + e.title; }));
        var dedupAdd = additions.filter(function (e) { return !existingKeys.has((e.path || '') + '|' + (e.filename || '') + '|' + e.title); });
        newIndex = currentIndex.concat(dedupAdd);
      }
      _fallbackAssignSequence(newIndex);

      if (mode === 'full') {
        var targetKey = 'exam_index_' + Date.now();
        var configName = (type === 'reading' ? '阅读' : '听力') + '全量-' + new Date().toLocaleString();
        await _fallbackSaveIndexForKey(targetKey, newIndex);
        var fullPathFallback = await _fallbackLoadPathMap(targetKey);
        var fullDerivedMap = _fallbackDerivePathMap(newIndex, fullPathFallback);
        await _fallbackSavePathMap(targetKey, newIndex, { overrideMap: fullDerivedMap, setActive: true });
        await _fallbackSaveLibraryConfiguration(configName, targetKey, newIndex.length);
        await _fallbackSetActiveLibraryKey(targetKey);
        try {
          await _fallbackApplyLibraryConfig(targetKey, newIndex, { setActive: true, skipConfigRefresh: false });
          window.showMessage && window.showMessage('新的题库配置已创建并激活', 'success');
        } catch (applyErr) {
          console.warn('[Fallback] 应用新题库失败，尝试刷新页面', applyErr);
          window.showMessage && window.showMessage('新的题库已保存，正在刷新界面...', 'warning');
          setTimeout(function () { try { location.reload(); } catch (_) { } }, 500);
        }
        return;
      }

      var isDefault = activeKey === 'exam_index';
      var targetKeyInc = activeKey;
      var configNameInc = '';
      if (isDefault) {
        targetKeyInc = 'exam_index_' + Date.now();
        configNameInc = (type === 'reading' ? '阅读' : '听力') + '增量-' + new Date().toLocaleString();
        await _fallbackSaveIndexForKey(targetKeyInc, newIndex);
        var incFallback = await _fallbackLoadPathMap(targetKeyInc);
        var derivedMap = _fallbackDerivePathMap(newIndex, incFallback);
        await _fallbackSavePathMap(targetKeyInc, newIndex, { overrideMap: derivedMap, setActive: true });
        await _fallbackSaveLibraryConfiguration(configNameInc, targetKeyInc, newIndex.length);
        await _fallbackSetActiveLibraryKey(targetKeyInc);
        window.showMessage && window.showMessage('新的题库配置已创建并激活；正在重新加载...', 'success');
        setTimeout(function () { try { location.reload(); } catch (_) { } }, 800);
        return;
      }

      await _fallbackSaveIndexForKey(targetKeyInc, newIndex);
      var targetPathFallback = await _fallbackLoadPathMap(targetKeyInc);
      var incrementalMap = _fallbackDerivePathMap(newIndex, targetPathFallback);
      await _fallbackSavePathMap(targetKeyInc, newIndex, { overrideMap: incrementalMap, setActive: true });
      await _fallbackSaveLibraryConfiguration((type === 'reading' ? '阅读' : '听力') + '增量-' + new Date().toLocaleString(), targetKeyInc, newIndex.length);
      _fallbackSetExamIndexState(newIndex);
      try { if (typeof window.updateOverview === 'function') window.updateOverview(); } catch (_) { }
      if (document.getElementById('browse-view') && document.getElementById('browse-view').classList.contains('active') && typeof window.loadExamList === 'function') {
        try { window.loadExamList(); } catch (_) { }
      }
      window.showMessage && window.showMessage('索引已更新；正在刷新界面...', 'success');
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
