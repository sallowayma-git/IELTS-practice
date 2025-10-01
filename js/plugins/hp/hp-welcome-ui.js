/**
 * HP Welcome UI (stable)
 * - Updates stats cards from real data
 * - Provides quick navigation helpers
 */
(function(){
  'use strict';

  if (typeof window.hpCore === 'undefined') { console.error('[HP Welcome UI] hpCore not found'); return; }

  const UI = {
    inited: false,
    stats: { totalExams: 0, completed: 0, avg: 0, days: 0 },

    init(){ if (this.inited) return; this.inited = true; this._bind(); this.refresh(); },

    _bind(){
      try {
        hpCore.on('dataUpdated', () => this.refresh());
        document.addEventListener('click', (e) => {
          const a = e.target && (e.target.closest('[data-nav]'));
          if (!a) return;
          e.preventDefault();
          const to = a.getAttribute('data-nav');
          if (to && typeof window.showView === 'function') window.showView(to);
        }, true);
      } catch (e) { console.warn('[HP Welcome UI] bind failed', e); }
    },

    refresh(){
      try {
        const exams = hpCore.getExamIndex();
        const recs = hpCore.getRecords();
        const totalExams = Array.isArray(exams) ? exams.length : 0;
        const completed = Array.isArray(recs) ? recs.length : 0;
        const avg = completed ? Math.round(recs.reduce((s,r)=> s + (r.score || r.percentage || 0), 0) / completed) : 0;
        const days = (function(){
          if (!recs || !recs.length) return 0;
          const set = new Set(recs.map(r => new Date(r.date || r.timestamp || Date.now()).toDateString()));
          return set.size;
        })();
        this.stats = { totalExams, completed, avg, days };
        this._paint();
      } catch (e) { console.warn('[HP Welcome UI] refresh failed', e); }
    },

    _paint(){
      const $ = (id) => document.getElementById(id);
      const set = (id, v) => { const el=$(id); if (el) el.textContent=v; };
      set('total-exams-count', this.stats.totalExams);
      set('completed-count', this.stats.completed);
      set('average-score', this.stats.avg + '%');
      set('study-days', this.stats.days);
    }
  };

  hpCore.ready(() => UI.init());
  try { console.log('[HP Welcome UI] ready'); } catch(_){}
})();

