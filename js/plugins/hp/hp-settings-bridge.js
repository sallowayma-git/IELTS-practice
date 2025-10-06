/**
 * HP Settings Bridge (stable minimal)
 * - Wires Settings page buttons (by group order) to system actions
 */
(function(){
  'use strict';
  if (typeof hpCore === 'undefined') { console.error('[HP-Settings-Bridge] hpCore missing'); return; }

  function qGroups(){
    // two button stacks in the template share the same class set
    return Array.from(document.querySelectorAll('.flex.flex-1.gap-3.max-w-[480px].flex-col.items-stretch.px-4.py-3'));
  }

  function clearCache(){ try { localStorage.clear(); sessionStorage.clear(); hpCore.showMessage('缓存已清理','success'); setTimeout(()=>location.reload(),600); } catch(e){ alert('清理失败: '+e); } }
  function loadLib(force){ try { if (typeof window.showLibraryLoaderModal==='function') return showLibraryLoaderModal(); if (typeof window.loadLibrary==='function') return loadLibrary(!!force); hpCore.showMessage('加载器未就绪','warning'); } catch(e){ console.warn(e); } }
  function showConfigs(){ try { if (typeof window.showLibraryConfigListV2==='function') return showLibraryConfigListV2(); hpCore.showMessage('没有可用的配置列表','info'); } catch(e){ console.warn(e); } }
  function forceRefresh(){ try { if (typeof window.loadLibrary==='function') { hpCore.showMessage('正在强制刷新题库...','info'); loadLibrary(true); } else { location.reload(); } } catch(e){ console.warn(e); } }
  function createBackup(){ try { if (typeof window.createManualBackup==='function') return createManualBackup(); hpCore.showMessage('备份模块未就绪','warning'); } catch(e){ console.warn(e); } }
  function backupList(){ try { if (typeof window.showBackupList==='function') return showBackupList(); hpCore.showMessage('暂无备份列表','info'); } catch(e){ console.warn(e); } }
  function exportData(){ try { if (typeof window.exportAllData==='function') return exportAllData(); hpCore.showMessage('导出不可用','warning'); } catch(e){ console.warn(e); } }
  function importData(){ try { if (typeof window.importData==='function') return window.importData(); hpCore.showMessage('导入不可用','warning'); } catch(e){ console.warn(e); } }

  function wire(){
    const groups = qGroups();
    if (groups[0]){
      const btns = groups[0].querySelectorAll('button');
      btns[0] && btns[0].addEventListener('click', (e)=>{ e.preventDefault(); clearCache(); });
      btns[1] && btns[1].addEventListener('click', (e)=>{ e.preventDefault(); loadLib(false); });
      btns[2] && btns[2].addEventListener('click', (e)=>{ e.preventDefault(); showConfigs(); });
      btns[3] && btns[3].addEventListener('click', (e)=>{ e.preventDefault(); forceRefresh(); });
    }
    if (groups[1]){
      const btns = groups[1].querySelectorAll('button');
      btns[0] && btns[0].addEventListener('click', (e)=>{ e.preventDefault(); createBackup(); });
      btns[1] && btns[1].addEventListener('click', (e)=>{ e.preventDefault(); backupList(); });
      btns[2] && btns[2].addEventListener('click', (e)=>{ e.preventDefault(); exportData(); });
      btns[3] && btns[3].addEventListener('click', (e)=>{ e.preventDefault(); importData(); });
    }

    // Text-based fallback binding for all buttons (no :contains, works on file://)
    try {
      // Use event delegation if DOM tools are available
    if (typeof window.DOM !== 'undefined' && window.DOM.delegate) {
      const handleSettingsClick = function(e) {
        const button = e.target.closest('button');
        if (!button) return;

        const text = (button.textContent || '').trim();

        // Only handle settings-related buttons, ignore all others
        if (!(/清.*缓存|加载.*题库|重新加载|配置|题库配置|强制.*刷新|创建.*备份|备份.*列表|导出|导入/.test(text))) {
          return; // Don't preventDefault for non-settings buttons
        }

        e.preventDefault();

        if (/清.*缓存/.test(text)) {
          clearCache();
        } else if (/加载.*题库|重新加载/.test(text)) {
          loadLib(false);
        } else if (/配置|题库配置/.test(text)) {
          showConfigs();
        } else if (/强制.*刷新/.test(text)) {
          forceRefresh();
        } else if (/创建.*备份/.test(text)) {
          createBackup();
        } else if (/备份.*列表/.test(text)) {
          backupList();
        } else if (/导出/.test(text)) {
          exportData();
        } else if (/导入/.test(text)) {
          importData();
        }
      };

      // Only delegate to buttons within relevant containers (escape special CSS characters)
      window.DOM.delegate('click', '.flex.flex-1.gap-3.max-w-\\[480px\\].flex-col.items-stretch.px-4.py-3 button', handleSettingsClick);
      console.log('[HP-Settings-Bridge] 使用事件委托设置按钮(限定范围)');
    } else {
      // Fallback to original text-based binding
      Array.from(document.querySelectorAll('button')).forEach(function(b){
        var t = (b.textContent||'').trim();
        if (/清.*缓存/.test(t)) b.addEventListener('click', function(e){ e.preventDefault(); clearCache(); });
        if (/加载.*题库|重新加载/.test(t)) b.addEventListener('click', function(e){ e.preventDefault(); loadLib(false); });
        if (/配置|题库配置/.test(t)) b.addEventListener('click', function(e){ e.preventDefault(); showConfigs(); });
        if (/强制.*刷新/.test(t)) b.addEventListener('click', function(e){ e.preventDefault(); forceRefresh(); });
        if (/创建.*备份/.test(t)) b.addEventListener('click', function(e){ e.preventDefault(); createBackup(); });
        if (/备份.*列表/.test(t)) b.addEventListener('click', function(e){ e.preventDefault(); backupList(); });
        if (/导出/.test(t)) b.addEventListener('click', function(e){ e.preventDefault(); exportData(); });
        if (/导入/.test(t)) b.addEventListener('click', function(e){ e.preventDefault(); importData(); });
      });
    }
    } catch(_){ }
  }

  function init(){ try { wire(); } catch(e){ try{ console.warn('[HP-Settings-Bridge] wire failed', e); }catch(_){ } } }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', function(){ hpCore.ready(init); }); }
  else { hpCore.ready(init); }
  try { console.log('[HP-Settings-Bridge] ready'); } catch(_){}
})();
