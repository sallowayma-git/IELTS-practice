(function(){
  // Fallback for navigation
  if (typeof window.showView !== 'function') {
    window.showView = function(viewName, resetCategory){
      document.querySelectorAll('.view').forEach(function(v){ v.classList.remove('active'); });
      var target = document.getElementById(viewName + '-view');
      if (target) target.classList.add('active');
      // set nav active by mapping index
      var navs = document.querySelectorAll('.nav-btn');
      navs.forEach(function(b){ b.classList.remove('active'); });
      var idx = { overview:0, browse:1, practice:2, settings:3 }[viewName];
      if (typeof idx === 'number' && navs[idx]) navs[idx].classList.add('active');
      if (viewName==='browse' && (resetCategory===undefined || resetCategory===true)){
        window.currentCategory = 'all';
        window.currentExamType = 'all';
        var t=document.getElementById('browse-title'); if (t) t.textContent='📚 题库浏览';
      }
      if (viewName==='browse' && typeof window.loadExamList==='function') window.loadExamList();
      if (viewName==='practice' && typeof window.updatePracticeView==='function') window.updatePracticeView();
    };
  }

  // Fallback for toast messages
  if (typeof window.showMessage !== 'function') {
    window.showMessage = function(message, type, duration){
      try{
        var container = document.getElementById('message-container');
        if(!container){ container=document.createElement('div'); container.id='message-container'; document.body.appendChild(container); }
        var div=document.createElement('div');
        div.className='message ' + (type||'info');
        var mark = (type==='error') ? '✖' : '✔';
        div.innerHTML = '<strong>'+mark+'</strong> ' + (message||'');
        container.appendChild(div);
        setTimeout(function(){ div.style.opacity='0'; setTimeout(function(){ div.remove(); },300); }, duration||4000);
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
      if (!window.dataIntegrityManager && window.DataIntegrityManager) {
        try{ window.dataIntegrityManager = new window.DataIntegrityManager(); } catch(_){}
      }
      if (!(window.dataIntegrityManager && typeof window.dataIntegrityManager.getBackupList==='function')){
        window.showMessage && window.showMessage('数据管理模块未初始化','error');
        return;
      }
      var backups = await window.dataIntegrityManager.getBackupList()||[];
      if (backups.length===0){ window.showMessage && window.showMessage('暂无备份记录','info'); return; }
      var container = document.getElementById('settings-view') || document.body;
      var existing = container.querySelector('.backup-list'); if (existing) existing.remove();
      var listDiv = document.createElement('div'); listDiv.className='backup-list';
      var html = ''+
        '<div style="background: rgba(255, 255, 255, 0.1); padding: 20px; border-radius: 10px; margin: 20px 0;">'+
        ' <h3>📋 备份列表</h3>'+
        ' <div style="max-height: 300px; overflow-y: auto; margin: 15px 0;">'+
        backups.map(function(b){
          var date = new Date(b.timestamp).toLocaleString();
          var sizeKB = Math.round((b.size||0)/1024);
          var typeIcon = (b.type==='auto')?'🔄':(b.type==='manual'?'👤':'⚠️');
          return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px;border-bottom:1px solid rgba(255,255,255,0.1);">'
               +   '<div><strong>'+typeIcon+' '+(b.id||'')+'</strong><br><small>'+date+' · '+sizeKB+' KB · v'+(b.version||'')+'</small></div>'
               +   '<button class="btn btn-secondary" onclick="restoreBackup(\''+(b.id||'')+'\')" style="margin-left:10px;">恢复</button>'
               + '</div>';
        }).join('')+
        ' </div>'+
        ' <button class="btn btn-secondary" onclick="this.parentElement.remove()">关闭</button>'+
        '</div>';
      listDiv.innerHTML = html; container.appendChild(listDiv);

      // 确保restoreBackup函数在fallback路径中可用
      if (typeof window.restoreBackup !== 'function') {
        window.restoreBackup = async function(backupId) {
          if (!backupId) {
            window.showMessage && window.showMessage('无效的备份ID', 'error');
            return;
          }

          if (!confirm('确定要恢复备份 ' + backupId + ' 吗？当前数据将被覆盖。')) {
            return;
          }

          try {
            window.showMessage && window.showMessage('正在恢复备份...', 'info');

            if (window.dataIntegrityManager && typeof window.dataIntegrityManager.restoreBackup === 'function') {
              await window.dataIntegrityManager.restoreBackup(backupId);
              window.showMessage && window.showMessage('备份恢复成功', 'success');
              // 移除备份列表并重新显示
              var backupList = document.querySelector('.backup-list');
              if (backupList) backupList.remove();
              setTimeout(() => window.showBackupList && window.showBackupList(), 1000);
            } else {
              // 降级恢复逻辑
              window.showMessage && window.showMessage('数据管理模块不可用，无法恢复备份', 'error');
            }
          } catch (error) {
            console.error('[Fallback] 恢复备份失败:', error);
            window.showMessage && window.showMessage('备份恢复失败: ' + (error.message || error), 'error');
          }
        };
      }
    };
  }
  function ensureDefaultConfig(){
    try{
      var configs = (window.storage && storage.get) ? storage.get('exam_index_configurations', []) : [];
      if (!Array.isArray(configs)) configs = [];
      var hasDefault = configs.some(function(c){ return c && c.key==='exam_index'; });
      if (!hasDefault){
        var count = Array.isArray(window.examIndex)? window.examIndex.length : 0;
        configs.push({ name:'默认题库', key:'exam_index', examCount: count, timestamp: Date.now() });
        if (window.storage && storage.set) storage.set('exam_index_configurations', configs);
        if (!storage.get('active_exam_index_key')) storage.set('active_exam_index_key','exam_index');
      }
      return configs;
    }catch(e){ return []; }
  }

  // Fallback for library config list
  if (typeof window.showLibraryConfigListV2 !== 'function') {
    window.showLibraryConfigListV2 = function(){
      var configs = (window.storage && storage.get) ? storage.get('exam_index_configurations', []) : [];
      if (!configs || configs.length===0) configs = ensureDefaultConfig();
      if (!configs || configs.length===0){ if (window.showMessage) showMessage('暂无题库配置记录','info'); return; }
      var html = ''+
      '<div style="background: rgba(17,24,39,0.94); padding: 20px; border-radius: 10px; margin: 20px 0; border:1px solid rgba(255,255,255,0.1); box-shadow: 0 10px 30px rgba(0,0,0,0.35); color:#e5e7eb;">'+
      '  <h3 style="margin:0 0 10px;">📚 题库配置列表</h3>'+
      '  <div style="max-height: 320px; overflow-y: auto; margin: 10px 0;">';
      configs.forEach(function(cfg){
        var date=new Date(cfg.timestamp).toLocaleString();
        var isActive = (window.storage && storage.get && storage.get('active_exam_index_key','exam_index')===cfg.key);
        var isDefault = cfg.key==='exam_index';
        var label = isDefault? '默认题库': (cfg.name||cfg.key);
        var act = isActive? '（当前）':'';
        html += ''+
        '<div style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid rgba(255,255,255,0.1);">'+
        ' <div style="line-height:1.3;"><strong>'+label+'</strong> '+act+'<br><small>'+date+' · '+(cfg.examCount||0)+' 个题目</small></div>'+
        ' <div>'+
        '   <button class="btn btn-secondary" onclick="switchLibraryConfig(\''+cfg.key+'\')" style="margin-left:10px;" '+(isActive?'disabled':'')+'>切换</button>'+
        (isDefault? '' : '   <button class="btn btn-warning" onclick="deleteLibraryConfig(\''+cfg.key+'\')" style="margin-left:10px;" '+(isActive?'disabled':'')+'>删除</button>')+
        ' </div>'+
        '</div>';
      });
      html += '  </div><button class="btn btn-secondary" onclick="this.parentElement.remove()">关闭</button></div>';
      var container = document.getElementById('settings-view');
      var existing = container && container.querySelector('.library-config-list'); if (existing) existing.remove();
      var wrap = document.createElement('div'); wrap.className='library-config-list'; wrap.innerHTML=html; if (container) container.appendChild(wrap);
    };
  }

  // Fallback improved loader modal (only if missing)
  if (typeof window.showLibraryLoaderModal !== 'function') {
    window.showLibraryLoaderModal = function(){
      var overlay=document.createElement('div');
      overlay.style.position='fixed'; overlay.style.inset='0'; overlay.style.background='rgba(0,0,0,0.65)'; overlay.style.backdropFilter='blur(1px)'; overlay.style.zIndex='1000'; overlay.style.display='flex'; overlay.style.alignItems='center'; overlay.style.justifyContent='center';
      var modal=document.createElement('div'); modal.style.maxWidth='900px'; modal.style.width='90%'; modal.style.background='rgba(17,24,39,0.98)'; modal.style.color='#e5e7eb'; modal.style.border='1px solid rgba(255,255,255,0.12)'; modal.style.borderRadius='12px'; modal.style.boxShadow='0 20px 50px rgba(0,0,0,0.5)';
      modal.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.1);padding:12px 16px;"><h2 style="margin:0;">加载题库</h2><button aria-label="关闭" style="background:transparent;border:0;color:#e5e7eb;font-size:20px;cursor:pointer;">×</button></div>'+
        '<div style="padding:16px;">'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">'
        +   '<div style="border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:16px;background:rgba(255,255,255,0.06);">'
        +     '<h3 style="margin:0 0 6px;">📖 阅读题库加载</h3>'
        +     '<p style="opacity:.9;margin:0 0 10px;">支持全量重载和增量更新。请上传包含题目HTML/PDF的根文件夹。</p>'
        +     '<div style="display:flex;gap:10px;flex-wrap:wrap;"><button class="btn" id="reading-full-btn">全量重载</button><button class="btn btn-secondary" id="reading-inc-btn">增量更新</button></div>'
        +     '<input type="file" id="reading-full-input" webkitdirectory multiple style="display:none;" />'
        +     '<input type="file" id="reading-inc-input" webkitdirectory multiple style="display:none;" />'
        +   '</div>'
        +   '<div style="border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:16px;background:rgba(255,255,255,0.06);">'
        +     '<h3 style="margin:0 0 6px;">🎧 听力题库加载</h3>'
        +     '<p style="opacity:.9;margin:0 0 10px;">支持全量重载和增量更新。请上传包含题目HTML/PDF/音频的根文件夹。</p>'
        +     '<div style="display:flex;gap:10px;flex-wrap:wrap;"><button class="btn" id="listening-full-btn">全量重载</button><button class="btn btn-secondary" id="listening-inc-btn">增量更新</button></div>'
        +     '<input type="file" id="listening-full-input" webkitdirectory multiple style="display:none;" />'
        +     '<input type="file" id="listening-inc-input" webkitdirectory multiple style="display:none;" />'
        +   '</div>'
        + '</div>'
        + '</div>'
        + '<div style="border-top:1px solid rgba(255,255,255,0.1);padding:12px 16px;text-align:right;"><button class="btn btn-secondary" id="close-loader">关闭</button></div>';
      overlay.appendChild(modal); document.body.appendChild(overlay);
      var close=function(){ overlay.remove(); };
      modal.querySelector('#close-loader').addEventListener('click', close);
      modal.querySelector('button[aria-label="关闭"]').addEventListener('click', close);
      var wire=function(btnId,inputId,type,mode){ var btn=modal.querySelector(btnId), input=modal.querySelector(inputId); btn.addEventListener('click', function(){ input.click(); }); input.addEventListener('change', async function(e){ var files=Array.from(e.target.files||[]); if(files.length===0) return; if (typeof window.handleLibraryUpload==='function'){ await window.handleLibraryUpload({type:type,mode:mode}, files); } close(); }); };
      wire('#reading-full-btn','#reading-full-input','reading','full');
      wire('#reading-inc-btn','#reading-inc-input','reading','incremental');
      wire('#listening-full-btn','#listening-full-input','listening','full');
      wire('#listening-inc-btn','#listening-inc-input','listening','incremental');
    };
  }

  // DOMContentLoaded handler to ensure showView('overview') is called after DOM is loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      // Try to call showView('overview') as the default view
      if (typeof window.showView === 'function') {
        window.showView('overview');
      } else if (typeof window.app !== 'undefined' && typeof window.app.navigateToView === 'function') {
        // Fallback to app.navigateToView if showView is not available
        window.app.navigateToView('overview');
      }
    });
  } else {
    // DOM is already loaded, call showView immediately
    if (typeof window.showView === 'function') {
      window.showView('overview');
    } else if (typeof window.app !== 'undefined' && typeof window.app.navigateToView === 'function') {
      // Fallback to app.navigateToView if showView is not available
      window.app.navigateToView('overview');
    }
  }
})();