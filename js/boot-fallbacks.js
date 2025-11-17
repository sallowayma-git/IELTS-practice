(function(){
  var storage = window.storage;
  // Fallback for navigation
  if (typeof window.showView !== 'function') {
    window.showView = function(viewName, resetCategory){
      if (typeof document === 'undefined') {
        return;
      }
      var normalized = (typeof viewName === 'string' && viewName) ? viewName : 'overview';
      var target = document.getElementById(normalized + '-view');
      if (!target) {
        console.warn('[Fallback] 未找到视图节点:', normalized);
        return;
      }
      Array.prototype.forEach.call(document.querySelectorAll('.view.active'), function(v){
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
          Array.prototype.forEach.call(navContainer.querySelectorAll('.nav-btn'), function(btn){
            btn.classList.remove('active');
          });
          var navButton = navContainer.querySelector('[data-view="' + normalized + '"]');
          if (navButton) {
            navButton.classList.add('active');
          }
        }
      }

      if (normalized==='browse' && (resetCategory===undefined || resetCategory===true)){
        window.currentCategory = 'all';
        window.currentExamType = 'all';
        if (typeof window.setBrowseTitle === 'function') { window.setBrowseTitle('题库浏览'); return; }
        var t=document.getElementById('browse-title'); if (t) t.textContent='题库浏览';
      }
      if (normalized==='browse' && typeof window.loadExamList==='function') window.loadExamList();
      if (normalized==='practice' && typeof window.updatePracticeView==='function') window.updatePracticeView();
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
        var handler = function(event) {
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

    Object.keys(attrs).forEach(function(key) {
      var value = attrs[key];
      if (value == null || value === false) {
        return;
      }

      if (key === 'className') {
        element.className = value;
        return;
      }

      if (key === 'dataset' && typeof value === 'object') {
        Object.keys(value).forEach(function(dataKey) {
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
    normalizedChildren.forEach(function(child) {
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

    document.addEventListener('click', function(event) {
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
      setTimeout(function() {
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
    window.showMessage = function(message, type, duration){
      try{
        var container = document.getElementById('message-container');
        if(!container){
          container=document.createElement('div');
          container.id='message-container';
          container.className='message-container';
          document.body.appendChild(container);
        }

        var note=document.createElement('div');
        note.className='message ' + (type||'info');
        var icon=document.createElement('strong');
        var marks = { error: '✖', success: '✔', warning: '⚠️', info: 'ℹ️' };
        icon.textContent = marks[type] || marks.info;
        note.appendChild(icon);
        note.appendChild(document.createTextNode(' ' + (message || '')));
        container.appendChild(note);

        while (container.children.length > 3) {
          container.removeChild(container.firstChild);
        }

        var timeout = typeof duration === 'number' && duration > 0 ? duration : 4000;
        setTimeout(function(){
          note.classList.add('message-leaving');
          setTimeout(function(){
            if (note.parentNode) {
              note.parentNode.removeChild(note);
            }
          }, 320);
        }, timeout);
      }catch(_){ console.log('[Toast]', type||'info', message); }
    };
  }

  // Fallbacks for data export/import buttons in Settings
  if (typeof window.exportAllData !== 'function') {
    window.exportAllData = function(){
      if (!window.dataIntegrityManager && window.DataIntegrityManager) {
        try{ window.dataIntegrityManager = new window.DataIntegrityManager(); } catch(_){}
      }
      if (window.dataIntegrityManager && typeof window.dataIntegrityManager.exportData==='function') {
        window.dataIntegrityManager.exportData();
        window.showMessage && window.showMessage('数据导出成功','success');
      } else {
        window.showMessage && window.showMessage('数据管理模块未初始化','error');
      }
    };
  }

  if (typeof window.importData !== 'function') {
    window.importData = function(){
      if (!window.dataIntegrityManager && window.DataIntegrityManager) {
        try{ window.dataIntegrityManager = new window.DataIntegrityManager(); } catch(_){}
      }
      if (!(window.dataIntegrityManager && typeof window.dataIntegrityManager.importData==='function')) {
        window.showMessage && window.showMessage('数据管理模块未初始化','error');
        return;
      }
      var input=document.createElement('input'); input.type='file'; input.accept='.json';
      input.onchange = function(e){ var f=e.target.files&&e.target.files[0]; if(!f) return; var ok=confirm('导入数据将覆盖当前数据，确定继续吗？'); if(!ok) return; (async function(){ try{ await window.dataIntegrityManager.importData(f); window.showMessage && window.showMessage('数据导入成功','success'); } catch(err){ window.showMessage && window.showMessage('数据导入失败: '+(err&&err.message||err),'error'); } })(); };
      input.click();
    };
  }

  // Fallbacks for backup operations used by Settings
  if (typeof window.createManualBackup !== 'function') {
    window.createManualBackup = function(){
      if (!window.dataIntegrityManager && window.DataIntegrityManager) {
        try{ window.dataIntegrityManager = new window.DataIntegrityManager(); } catch(_){}
      }
      if (!(window.dataIntegrityManager && typeof window.dataIntegrityManager.createBackup==='function')){
        window.showMessage && window.showMessage('数据管理模块未初始化','error');
        return;
      }
      (async function(){
        try{
          var b = await window.dataIntegrityManager.createBackup(null,'manual');
          if (b && b.external) {
            window.showMessage && window.showMessage('本地存储空间不足，已将备份下载为文件','warning');
          } else {
            window.showMessage && window.showMessage('备份创建成功: '+(b&&b.id||''),'success');
          }
        }catch(e){
          window.showMessage && window.showMessage('备份创建失败: '+(e&&e.message||e),'error');
        }
      })();
    };
  }

  if (typeof window.showBackupList !== 'function') {
    window.showBackupList = async function(){
      var manager = _ensureFallbackDataIntegrityManager();
      if (!(manager && typeof manager.getBackupList === 'function')) {
        window.showMessage && window.showMessage('数据管理模块未初始化','error');
        return;
      }

      _ensureFallbackBackupDelegates();

      var backups = [];
      try {
        var list = await manager.getBackupList();
        backups = Array.isArray(list) ? list : [];
      } catch (error) {
        console.error('[Fallback] 获取备份列表失败:', error);
        window.showMessage && window.showMessage('获取备份列表失败: ' + (error && error.message ? error.message : error),'error');
        return;
      }

      var domApi = (window.DOM && typeof window.DOM.create === 'function') ? window.DOM : null;
      var create = domApi ? function(){ return window.DOM.create.apply(window.DOM, arguments); } : _fallbackCreateElement;

      function buildEntries() {
        if (!backups.length) {
          return [
            create('div', { className: 'backup-list-empty' }, [
              create('div', { className: 'backup-list-empty-icon', ariaHidden: 'true' }, '📂'),
              create('p', { className: 'backup-list-empty-text' }, '暂无备份记录。'),
              create('p', { className: 'backup-list-empty-hint' }, '创建手动备份后将显示在此列表中。')
            ])
          ];
        }

        var nodes = backups.map(function(backup) {
          if (!backup || !backup.id) {
            return null;
          }

          var timestamp = backup.timestamp ? new Date(backup.timestamp).toLocaleString() : '未知时间';
          var type = backup.type || 'unknown';
          var version = backup.version || '—';

          return create('div', {
            className: 'backup-entry',
            dataset: { backupId: backup.id }
          }, [
            create('div', { className: 'backup-entry-info' }, [
              create('strong', { className: 'backup-entry-id' }, backup.id),
              create('div', { className: 'backup-entry-meta' }, timestamp),
              create('div', { className: 'backup-entry-meta' }, '类型: ' + type + ' | 版本: ' + version)
            ]),
            create('div', { className: 'backup-entry-actions' }, [
              create('button', {
                type: 'button',
                className: 'btn btn-success backup-entry-restore',
                dataset: { backupAction: 'restore', backupId: backup.id }
              }, '恢复')
            ])
          ]);
        }).filter(Boolean);

        if (!nodes.length) {
          return [
            create('div', { className: 'backup-list-empty' }, [
              create('div', { className: 'backup-list-empty-icon', ariaHidden: 'true' }, '📂'),
              create('p', { className: 'backup-list-empty-text' }, '暂无可恢复的备份记录。'),
              create('p', { className: 'backup-list-empty-hint' }, '创建手动备份后将显示在此列表中。')
            ])
          ];
        }

        return nodes;
      }

      var settingsView = document.getElementById('settings-view');
      if (settingsView) {
        var legacyList = settingsView.querySelector('.backup-list');
        if (legacyList) { legacyList.remove(); }
        var existingContainer = settingsView.querySelector('.backup-list-container');
        if (existingContainer) { existingContainer.remove(); }
      }

      var existingOverlay = document.querySelector('.backup-modal-overlay');
      if (existingOverlay) { existingOverlay.remove(); }

      var card = create('div', { className: 'backup-list-card' }, [
        create('div', { className: 'backup-list-header' }, [
          create('h3', { className: 'backup-list-title' }, [
            create('span', { className: 'backup-list-title-icon', ariaHidden: 'true' }, '📋'),
            create('span', { className: 'backup-list-title-text' }, '备份列表')
          ])
        ]),
        create('div', { className: 'backup-list-scroll' }, buildEntries())
      ]);

      if (settingsView) {
        var container = create('div', { className: 'backup-list-container' }, card);
        var mainCard = settingsView.querySelector(':scope > div');
        if (mainCard) {
          mainCard.appendChild(container);
        } else {
          settingsView.appendChild(container);
        }

        if (!backups.length) {
          window.showMessage && window.showMessage('暂无备份记录','info');
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

      if (!backups.length) {
        window.showMessage && window.showMessage('暂无备份记录','info');
      }
    };

    if (typeof window.restoreBackup !== 'function') {
      window.restoreBackup = function(backupId) {
        return _fallbackRestoreBackupById(backupId);
      };
    }
  }
  async function ensureDefaultConfig(){
    try{
      var configs = [];
      if (window.storage && storage.get) {
        var maybeConfigs = storage.get('exam_index_configurations', []);
        configs = (maybeConfigs && typeof maybeConfigs.then === 'function') ? await maybeConfigs : maybeConfigs;
      }
      if (!Array.isArray(configs)) configs = [];
      var hasDefault = configs.some(function(c){ return c && c.key==='exam_index'; });
      if (!hasDefault){
        var count = Array.isArray(window.examIndex)? window.examIndex.length : 0;
        configs.push({ name:'默认题库', key:'exam_index', examCount: count, timestamp: Date.now() });
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
              var maybeSetActive = storage.set('active_exam_index_key','exam_index');
              if (maybeSetActive && typeof maybeSetActive.then === 'function') await maybeSetActive;
            }
          } catch (activeErr) {
            console.warn('[Fallback] 无法校正 active_exam_index_key:', activeErr);
          }
        }
      }
      return configs;
    }catch(e){
      console.warn('[Fallback] ensureDefaultConfig 失败:', e);
      return [];
    }
  }

  // Fallback for library config list
  if (typeof window.showLibraryConfigListV2 !== 'function') {
    window.showLibraryConfigListV2 = async function(){
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
      } catch (e) {}

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
      configs.forEach(function(cfg){
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
      host.onclick = function(event){
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

  // Fallback improved loader modal (only if missing)
  if (typeof window.showLibraryLoaderModal !== 'function') {
    window.showLibraryLoaderModal = function(){
      if (typeof document === 'undefined') {
        return;
      }

      var existing = document.getElementById('library-loader-overlay');
      if (existing && typeof existing.remove === 'function') {
        existing.remove();
      }

      var create = _fallbackCreateElement;
      var ensureArray = function(value) {
        return Array.isArray(value) ? value : [value];
      };

      var createLoaderCard = function(type, title, description, hint) {
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

      ensureArray([header, body, footer]).forEach(function(section) {
        if (section) {
          modal.appendChild(section);
        }
      });

      overlay.appendChild(modal);
      if (document.body) {
        document.body.appendChild(overlay);
      }

      var clickHandler = function(event) {
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

      var changeHandler = function(event) {
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

        Promise.resolve(upload).then(function() {
          cleanup();
        }).catch(function(error) {
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