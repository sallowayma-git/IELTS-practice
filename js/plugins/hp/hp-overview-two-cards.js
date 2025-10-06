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

      // Clear container
      while (container.firstChild) {
          container.removeChild(container.firstChild);
      }

      // Create reading card
      const readingCard = document.createElement('div');
      readingCard.className = 'category-card';
      readingCard.style.cssText = cardStyle;

      // Reading header
      const readingHeader = document.createElement('div');
      readingHeader.className = 'category-header';
      readingHeader.style.cssText = headerStyle;

      const readingIcon = document.createElement('div');
      readingIcon.className = 'category-icon';
      readingIcon.style.fontSize = '28px';
      readingIcon.textContent = '📖';

      const readingInfo = document.createElement('div');
      const readingTitle = document.createElement('div');
      readingTitle.className = 'category-title';
      readingTitle.style.fontWeight = '700';
      readingTitle.style.fontSize = '18px';
      readingTitle.textContent = '阅读';

      const readingMeta = document.createElement('div');
      readingMeta.className = 'category-meta';
      readingMeta.style.opacity = '0.8';
      readingMeta.textContent = readingCount + ' 项';

      const readingBreakdown = document.createElement('div');
      readingBreakdown.className = 'category-breakdown';
      readingBreakdown.style.cssText = breakdownStyle;
      readingBreakdown.textContent = 'P1: ' + readingP1 + ' | P2: ' + readingP2 + ' | P3: ' + readingP3;

      readingInfo.appendChild(readingTitle);
      readingInfo.appendChild(readingMeta);
      readingInfo.appendChild(readingBreakdown);
      readingHeader.appendChild(readingIcon);
      readingHeader.appendChild(readingInfo);

      // Reading actions
      const readingActions = document.createElement('div');
      readingActions.className = 'category-actions';
      readingActions.style.cssText = btnRow;

      const browseReadingBtn = document.createElement('button');
      browseReadingBtn.className = 'btn';
      browseReadingBtn.id = 'hp-ov-browse-reading';
      browseReadingBtn.textContent = '📚 浏览题库';

      const randomReadingBtn = document.createElement('button');
      randomReadingBtn.className = 'btn btn-secondary';
      randomReadingBtn.id = 'hp-ov-random-reading';
      randomReadingBtn.textContent = '🎲 随机练习';

      const readingP1Btn = document.createElement('button');
      readingP1Btn.className = 'category-btn hp-category-btn';
      readingP1Btn.id = 'hp-ov-random-reading-p1';
      readingP1Btn.style.cssText = categoryBtnStyle;
      readingP1Btn.textContent = '🎯 P1';

      const readingP2Btn = document.createElement('button');
      readingP2Btn.className = 'category-btn hp-category-btn';
      readingP2Btn.id = 'hp-ov-random-reading-p2';
      readingP2Btn.style.cssText = categoryBtnStyle;
      readingP2Btn.textContent = '🎯 P2';

      const readingP3Btn = document.createElement('button');
      readingP3Btn.className = 'category-btn hp-category-btn';
      readingP3Btn.id = 'hp-ov-random-reading-p3';
      readingP3Btn.style.cssText = categoryBtnStyle;
      readingP3Btn.textContent = '🎯 P3';

      readingActions.appendChild(browseReadingBtn);
      readingActions.appendChild(randomReadingBtn);
      readingActions.appendChild(readingP1Btn);
      readingActions.appendChild(readingP2Btn);
      readingActions.appendChild(readingP3Btn);

      readingCard.appendChild(readingHeader);
      readingCard.appendChild(readingActions);

      // Create listening card
      const listeningCard = document.createElement('div');
      listeningCard.className = 'category-card';
      listeningCard.style.cssText = cardStyle;

      // Listening header
      const listeningHeader = document.createElement('div');
      listeningHeader.className = 'category-header';
      listeningHeader.style.cssText = headerStyle;

      const listeningIcon = document.createElement('div');
      listeningIcon.className = 'category-icon';
      listeningIcon.style.fontSize = '28px';
      listeningIcon.textContent = '🎧';

      const listeningInfo = document.createElement('div');
      const listeningTitle = document.createElement('div');
      listeningTitle.className = 'category-title';
      listeningTitle.style.fontWeight = '700';
      listeningTitle.style.fontSize = '18px';
      listeningTitle.textContent = '听力';

      const listeningMeta = document.createElement('div');
      listeningMeta.className = 'category-meta';
      listeningMeta.style.opacity = '0.8';
      listeningMeta.textContent = listeningCount + ' 项';

      const listeningBreakdown = document.createElement('div');
      listeningBreakdown.className = 'category-breakdown';
      listeningBreakdown.style.cssText = breakdownStyle;
      listeningBreakdown.textContent = 'P3: ' + listeningP3 + ' | P4: ' + listeningP4;

      listeningInfo.appendChild(listeningTitle);
      listeningInfo.appendChild(listeningMeta);
      listeningInfo.appendChild(listeningBreakdown);
      listeningHeader.appendChild(listeningIcon);
      listeningHeader.appendChild(listeningInfo);

      // Listening actions
      const listeningActions = document.createElement('div');
      listeningActions.className = 'category-actions';
      listeningActions.style.cssText = btnRow;

      const browseListeningBtn = document.createElement('button');
      browseListeningBtn.className = 'btn';
      browseListeningBtn.id = 'hp-ov-browse-listening';
      browseListeningBtn.textContent = '📚 浏览题库';

      const randomListeningBtn = document.createElement('button');
      randomListeningBtn.className = 'btn btn-secondary';
      randomListeningBtn.id = 'hp-ov-random-listening';
      randomListeningBtn.textContent = '🎲 随机练习';

      const listeningP3Btn = document.createElement('button');
      listeningP3Btn.className = 'category-btn hp-category-btn';
      listeningP3Btn.id = 'hp-ov-random-listening-p3';
      listeningP3Btn.style.cssText = categoryBtnStyle;
      listeningP3Btn.textContent = '🎯 P3';

      const listeningP4Btn = document.createElement('button');
      listeningP4Btn.className = 'category-btn hp-category-btn';
      listeningP4Btn.id = 'hp-ov-random-p4';
      listeningP4Btn.style.cssText = categoryBtnStyle;
      listeningP4Btn.textContent = '🎯 P4';

      listeningActions.appendChild(browseListeningBtn);
      listeningActions.appendChild(randomListeningBtn);
      listeningActions.appendChild(listeningP3Btn);
      listeningActions.appendChild(listeningP4Btn);

      listeningCard.appendChild(listeningHeader);
      listeningCard.appendChild(listeningActions);

      container.appendChild(readingCard);
      container.appendChild(listeningCard);

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

      // Use event delegation instead of multiple addEventListener calls
      if (typeof window.DOM !== 'undefined' && window.DOM.delegate) {
          window.DOM.delegate('click', '#hp-ov-browse-reading', () => goBrowse('reading'));
          window.DOM.delegate('click', '#hp-ov-random-reading', () => randomByType('reading'));
          window.DOM.delegate('click', '#hp-ov-browse-listening', () => goBrowse('listening'));
          window.DOM.delegate('click', '#hp-ov-random-listening', () => randomByType('listening'));
          window.DOM.delegate('click', '#hp-ov-random-reading-p1', () => randomByCategory('reading', 'P1'));
          window.DOM.delegate('click', '#hp-ov-random-reading-p2', () => randomByCategory('reading', 'P2'));
          window.DOM.delegate('click', '#hp-ov-random-reading-p3', () => randomByCategory('reading', 'P3'));
          window.DOM.delegate('click', '#hp-ov-random-listening-p3', () => randomByCategory('listening', 'P3'));
          window.DOM.delegate('click', '#hp-ov-random-p4', () => randomByCategory('listening', 'P4'));

          // Add hover effects for category buttons
          window.DOM.delegate('mouseenter', '.hp-category-btn', function() {
              this.style.background = 'rgba(255,255,255,0.2)';
              this.style.borderColor = 'rgba(255,255,255,0.3)';
          });

          window.DOM.delegate('mouseleave', '.hp-category-btn', function() {
              this.style.background = 'rgba(255,255,255,0.1)';
              this.style.borderColor = 'rgba(255,255,255,0.2)';
          });
      } else {
          // Fallback to original event listeners
          var br = document.getElementById('hp-ov-browse-reading');
          if (br) br.addEventListener('click', function(){ goBrowse('reading'); });
          var rr = document.getElementById('hp-ov-random-reading');
          if (rr) rr.addEventListener('click', function(){ randomByType('reading'); });
          var bl = document.getElementById('hp-ov-browse-listening');
          if (bl) bl.addEventListener('click', function(){ goBrowse('listening'); });
          var rl = document.getElementById('hp-ov-random-listening');
          if (rl) rl.addEventListener('click', function(){ randomByType('listening'); });
          var rp1 = document.getElementById('hp-ov-random-reading-p1');
          if (rp1) rp1.addEventListener('click', function(){ randomByCategory('reading', 'P1'); });
          var rp2 = document.getElementById('hp-ov-random-reading-p2');
          if (rp2) rp2.addEventListener('click', function(){ randomByCategory('reading', 'P2'); });
          var rp3 = document.getElementById('hp-ov-random-reading-p3');
          if (rp3) rp3.addEventListener('click', function(){ randomByCategory('reading', 'P3'); });
          var lp3 = document.getElementById('hp-ov-random-listening-p3');
          if (lp3) lp3.addEventListener('click', function(){ randomByCategory('listening', 'P3'); });
          var lp4 = document.getElementById('hp-ov-random-p4');
          if (lp4) lp4.addEventListener('click', function(){ randomByCategory('listening', 'P4'); });
      }
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
