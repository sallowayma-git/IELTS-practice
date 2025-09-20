/**
 * HP Overview Two-Cards Plugin
 * Render two cards (Reading / Listening) on the overview page
 * without modifying core system files.
 */
(function(){
  'use strict';

  if (typeof window.hpCore === 'undefined') {
    console.warn('[HP-Overview-2Cards] hpCore not found, delaying init');
  }

  function renderTwoCards() {
    try {
      var container = document.getElementById('category-overview');
      if (!container) return;

      var exams = (hpCore && typeof hpCore.getExamIndex === 'function') ? hpCore.getExamIndex() : (window.examIndex || []);

      // Calculate counts by type and category
      var readingCount = (exams || []).filter(function(e){ return (e && e.type) === 'reading'; }).length;
      var listeningCount = (exams || []).filter(function(e){ return (e && e.type) === 'listening'; }).length;

      // Reading breakdown by P-level
      var readingP1 = (exams || []).filter(function(e){ return e.type === 'reading' && e.category === 'P1'; }).length;
      var readingP2 = (exams || []).filter(function(e){ return e.type === 'reading' && e.category === 'P2'; }).length;
      var readingP3 = (exams || []).filter(function(e){ return e.type === 'reading' && e.category === 'P3'; }).length;

      // Listening breakdown by P-level
      var listeningP3 = (exams || []).filter(function(e){ return e.type === 'listening' && e.category === 'P3'; }).length;
      var listeningP4 = (exams || []).filter(function(e){ return e.type === 'listening' && e.category === 'P4'; }).length;

      var cardStyle = 'display:flex;flex-direction:column;gap:12px;padding:16px;border-radius:12px;border:1px solid rgba(0,0,0,0.08);box-shadow:0 4px 16px rgba(0,0,0,0.06);background:rgba(255,255,255,0.06)';
      var headerStyle = 'display:flex;align-items:center;gap:12px;';
      var btnRow = 'display:flex;gap:10px;flex-wrap:wrap;';
      var breakdownStyle = 'font-size:12px;opacity:0.7;margin-top:4px;';
      var categoryBtnStyle = 'padding:4px 8px;font-size:11px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.1);color:white;cursor:pointer;transition:all 0.2s;';
      var categoryBtnHoverStyle = 'background:rgba(255,255,255,0.2);border-color:rgba(255,255,255,0.3);';

      container.innerHTML = [
        '<div class="category-card" style="'+cardStyle+'">',
        '  <div class="category-header" style="'+headerStyle+'">',
        '    <div class="category-icon" style="font-size:28px">📖</div>',
        '    <div>',
        '      <div class="category-title" style="font-weight:700;font-size:18px;">阅读</div>',
        '      <div class="category-meta" style="opacity:.8">'+ readingCount +' 项</div>',
        '      <div class="category-breakdown" style="'+breakdownStyle+'">',
        '        P1: '+readingP1+' | P2: '+readingP2+' | P3: '+readingP3,
        '      </div>',
        '    </div>',
        '  </div>',
        '  <div class="category-actions" style="'+btnRow+'">',
        '    <button class="btn" id="hp-ov-browse-reading">📚 浏览题库</button>',
        '    <button class="btn btn-secondary" id="hp-ov-random-reading">🎲 随机练习</button>',
        '    <button class="category-btn" id="hp-ov-random-p1" style="'+categoryBtnStyle+'" onmouseover="this.style=\''+categoryBtnStyle+categoryBtnHoverStyle+'\'" onmouseout="this.style=\''+categoryBtnStyle+'\'">🎯 P1</button>',
        '    <button class="category-btn" id="hp-ov-random-p2" style="'+categoryBtnStyle+'" onmouseover="this.style=\''+categoryBtnStyle+categoryBtnHoverStyle+'\'" onmouseout="this.style=\''+categoryBtnStyle+'\'">🎯 P2</button>',
        '    <button class="category-btn" id="hp-ov-random-p3" style="'+categoryBtnStyle+'" onmouseover="this.style=\''+categoryBtnStyle+categoryBtnHoverStyle+'\'" onmouseout="this.style=\''+categoryBtnStyle+'\'">🎯 P3</button>',
        '  </div>',
        '</div>',
        '<div class="category-card" style="'+cardStyle+'">',
        '  <div class="category-header" style="'+headerStyle+'">',
        '    <div class="category-icon" style="font-size:28px">🎧</div>',
        '    <div>',
        '      <div class="category-title" style="font-weight:700;font-size:18px;">听力</div>',
        '      <div class="category-meta" style="opacity:.8">'+ listeningCount +' 项</div>',
        '      <div class="category-breakdown" style="'+breakdownStyle+'">',
        '        P3: '+listeningP3+' | P4: '+listeningP4,
        '      </div>',
        '    </div>',
        '  </div>',
        '  <div class="category-actions" style="'+btnRow+'">',
        '    <button class="btn" id="hp-ov-browse-listening">📚 浏览题库</button>',
        '    <button class="btn btn-secondary" id="hp-ov-random-listening">🎲 随机练习</button>',
        '    <button class="category-btn" id="hp-ov-random-p3" style="'+categoryBtnStyle+'" onmouseover="this.style=\''+categoryBtnStyle+categoryBtnHoverStyle+'\'" onmouseout="this.style=\''+categoryBtnStyle+'\'">🎯 P3</button>',
        '    <button class="category-btn" id="hp-ov-random-p4" style="'+categoryBtnStyle+'" onmouseover="this.style=\''+categoryBtnStyle+categoryBtnHoverStyle+'\'" onmouseout="this.style=\''+categoryBtnStyle+'\'">🎯 P4</button>',
        '  </div>',
        '</div>'
      ].join('');

      // Wire actions
      var goBrowse = function(type){
        try { if (window.showView) window.showView('browse'); } catch(_){}
        try { if (window.filterByType) window.filterByType(type); } catch(_){}
      };
      var randomByType = function(type){
        try {
          var pool = (exams || []).filter(function(e){ return e.type === type; });
          if (!pool.length) { window.showMessage && window.showMessage((type==='listening'?'听力':'阅读')+'题库为空','error'); return; }
          var pick = pool[Math.floor(Math.random()*pool.length)];
          if (window.openExam) window.openExam(pick.id);
        } catch (e) {
          console.error('[HP-Overview-2Cards] Random failed', e);
        }
      };
      var randomByCategory = function(type, category){
        try {
          var pool = (exams || []).filter(function(e){ return e.type === type && e.category === category; });
          if (!pool.length) {
            var typeName = type === 'reading' ? '阅读' : '听力';
            window.showMessage && window.showMessage(typeName + category + ' 题库为空','error');
            return;
          }
          var pick = pool[Math.floor(Math.random()*pool.length)];
          if (window.openExam) window.openExam(pick.id);
        } catch (e) {
          console.error('[HP-Overview-2Cards] Random by category failed', e);
        }
      };

      // Wire existing actions
      var br = document.getElementById('hp-ov-browse-reading');
      if (br) br.addEventListener('click', function(){ goBrowse('reading'); });
      var rr = document.getElementById('hp-ov-random-reading');
      if (rr) rr.addEventListener('click', function(){ randomByType('reading'); });
      var bl = document.getElementById('hp-ov-browse-listening');
      if (bl) bl.addEventListener('click', function(){ goBrowse('listening'); });
      var rl = document.getElementById('hp-ov-random-listening');
      if (rl) rl.addEventListener('click', function(){ randomByType('listening'); });

      // Wire new per-category random actions
      var rp1 = document.getElementById('hp-ov-random-p1');
      if (rp1) rp1.addEventListener('click', function(){ randomByCategory('reading', 'P1'); });
      var rp2 = document.getElementById('hp-ov-random-p2');
      if (rp2) rp2.addEventListener('click', function(){ randomByCategory('reading', 'P2'); });
      var rp3 = document.getElementById('hp-ov-random-p3');
      if (rp3) rp3.addEventListener('click', function(){ randomByCategory('reading', 'P3'); });
      var lp3 = document.getElementById('hp-ov-random-p3');
      if (lp3) lp3.addEventListener('click', function(){ randomByCategory('listening', 'P3'); });
      var lp4 = document.getElementById('hp-ov-random-p4');
      if (lp4) lp4.addEventListener('click', function(){ randomByCategory('listening', 'P4'); });
    } catch (e) {
      console.error('[HP-Overview-2Cards] render error', e);
    }
  }

  function init() {
    // Render once DOM ready and whenever data updates
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', renderTwoCards);
    } else {
      renderTwoCards();
    }
    if (typeof hpCore !== 'undefined' && typeof hpCore.onDataUpdated === 'function') {
      hpCore.onDataUpdated(function(){ renderTwoCards(); });
    } else {
      // as a fallback, listen to examIndexLoaded
      window.addEventListener('examIndexLoaded', renderTwoCards);
    }
  }

  if (typeof hpCore !== 'undefined' && typeof hpCore.ready === 'function') {
    hpCore.ready(init);
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  console.log('[HP-Overview-2Cards] plugin loaded');
})();
