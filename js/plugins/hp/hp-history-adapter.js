/**
 * HP History UI Adapter
 *
 * Purpose
 * - Bridge the design-iteration Practice History page to the HP history
 *   plugins by ensuring required containers and adding light styling that
 *   matches the template cards.
 */
(function(){
  'use strict';

  function ensureAchievementsContainer(){
    var trendContainer = document.getElementById('practice-trend-container');
    var trendGrid = document.getElementById('practice-trend-grid');
    if (!trendContainer || !trendGrid) return;
    if (!document.getElementById('achievements-grid')){
      var ach = document.createElement('div');
      ach.id = 'achievements-grid';
      ach.className = 'flex flex-wrap gap-4 w-full';
      trendContainer.insertBefore(ach, trendGrid);
    }
  }

  function injectStyles(){
    if (document.getElementById('hp-history-style')) return;
    var style = document.createElement('style');
    style.id = 'hp-history-style';
    style.textContent = `
      #practice-trend-grid svg { background: rgba(255,255,255,0.03); border-radius: 12px; }
      #practice-trend-grid svg polyline { stroke-linecap: round; stroke-linejoin: round; stroke-width: 2.5; }
    `;
    document.head.appendChild(style);
  }

  function init(){
    try{
      ensureAchievementsContainer();
      injectStyles();
    } catch (e){ try{ console.warn('[HP History Adapter] init failed:', e); }catch(_){}}
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();