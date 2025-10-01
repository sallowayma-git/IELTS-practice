/**
 * HP Welcome CTA
 *
 * Purpose
 * - Wire Welcome template CTA buttons to system actions:
 *   - Start Reading Practice => random reading exam
 *   - Start Listening Practice => random listening exam
 * - Works with hpCore if available; falls back to window.completeExamIndex.
 */
(function(){
  'use strict';

  function pickRandomByType(type){
    try {
      var exams = (window.hpCore && hpCore.getExamIndex) ? hpCore.getExamIndex() : (window.completeExamIndex || []);
      if (!Array.isArray(exams) || exams.length === 0) return null;
      var pool = exams.filter(function(e){ return e && e.type === type; });
      if (!pool.length) return null;
      return pool[Math.floor(Math.random() * pool.length)];
    } catch (_) { return null; }
  }

  function onClickStart(type){
    var exam = pickRandomByType(type);
    if (exam && typeof window.openExam === 'function') {
      window.openExam(exam.id);
      return;
    }
    // Fallback to browse view if openExam unavailable
    try { if (window.showView) window.showView('browse'); } catch(_){ }
  }

  function init(){
    // Event delegation (bubble phase) to avoid double-handling with adapter
    document.addEventListener('click', function(e){
      var el = e.target;
      if (!el) return;
      // ascend if icon/span inside anchor/button
      if (el.matches && !el.matches('a,button')) { el = el.closest('a,button'); }
      if (!el) return;
      // If adapter already handled this event, skip
      if (e.defaultPrevented) return;
      // Only act on buttons in the welcome cards area
      var root = document.getElementById('practice-cards-container');
      if (root && !root.contains(el)) return;
      var cta = el.getAttribute && el.getAttribute('data-cta');
      if (cta === 'start-reading') { e.preventDefault(); onClickStart('reading'); return; }
      if (cta === 'start-listening') { e.preventDefault(); onClickStart('listening'); return; }
      // Fallback by text content
      var t = (el.textContent || '').trim();
      if (/^Start Reading Practice$/i.test(t)) { e.preventDefault(); onClickStart('reading'); return; }
      if (/^Start Listening Practice$/i.test(t)) { e.preventDefault(); onClickStart('listening'); return; }
    }, false);
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
