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
  }

  hpCore.ready(()=> wire());
  try { console.log('[HP-Settings-Bridge] ready'); } catch(_){}
})();

