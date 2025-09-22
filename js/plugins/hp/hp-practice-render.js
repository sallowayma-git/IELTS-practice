/**
 * HP Practice Render (stable)
 * - Renders exam cards in #practice-exam-grid
 * - Binds search + type tabs (all/reading/listening)
 */
(function(){
  'use strict';
  if (typeof hpCore === 'undefined') { console.error('[HP Practice Render] hpCore missing'); return; }

  const UI = {
    inited: false,
    filter: { type: 'all', q: '' },
    exams: [],

    init(){ if (this.inited) return; this.inited=true; this._wire(); this._sync(); },

    _wire(){
      const self = this;
      hpCore.on('dataUpdated', () => self._sync());

      // bind tabs: pick the first three anchors inside the category strip
      try {
        const tabWrap = document.querySelector('.pb-3 .flex');
        if (tabWrap) {
          const tabs = tabWrap.querySelectorAll('a');
          const setActive = (idx) => {
            tabs.forEach((a,i)=>{ a.classList.toggle('border-b-white', i===idx); a.classList.toggle('text-white', i===idx); a.classList.toggle('text-[#b99da1]', i!==idx); });
          };
          tabs[0] && tabs[0].addEventListener('click', (e)=>{ e.preventDefault(); self.filter.type='all'; setActive(0); self._render(); });
          tabs[1] && tabs[1].addEventListener('click', (e)=>{ e.preventDefault(); self.filter.type='reading'; setActive(1); self._render(); });
          tabs[2] && tabs[2].addEventListener('click', (e)=>{ e.preventDefault(); self.filter.type='listening'; setActive(2); self._render(); });
        }
      } catch(e){ console.warn('[HP Practice Render] tabs bind failed', e); }

      // bind search: try specific selectors then fallback to first input
      try {
        const input = document.querySelector('input.form-input') || document.querySelector('input[placeholder]') || document.querySelector('.px-4 input') || document.querySelector('input');
        if (input) {
          let t; input.addEventListener('input', (e)=>{ clearTimeout(t); t=setTimeout(()=>{ self.filter.q=(e.target.value||'').trim(); self._render(); }, 200); });
        }
      } catch(e){ console.warn('[HP Practice Render] search bind failed', e); }
    },

    _sync(){ this.exams = hpCore.getExamIndex(); this._render(); },

    _match(ex){
      const t = (this.filter.type||'all'); if (t!=='all' && (ex.type||'').toLowerCase()!==t) return false;
      const q = (this.filter.q||'').toLowerCase(); if (!q) return true;
      const title = (ex.title||'').toLowerCase(); const cat=(ex.category||ex.part||'').toLowerCase();
      return title.includes(q) || cat.includes(q);
    },

    _render(){
      const grid = document.getElementById('practice-exam-grid') || document.querySelector('.exam-grid');
      if (!grid) return;
      const list = (this.exams||[]).filter(ex => this._match(ex));
      if (!list.length) { grid.innerHTML = '<div style="text-align:center;padding:40px;opacity:.8"><div style="font-size:3rem;margin-bottom:10px">📚</div><div>暂无题目</div></div>'; return; }
      grid.innerHTML = list.map(ex => this._card(ex)).join('');
      // bind per-card actions (delegated)
      grid.addEventListener('click', (e)=>{
        const btn = e.target && e.target.closest('[data-action]'); if (!btn) return;
        e.preventDefault(); e.stopPropagation();
        const id = btn.getAttribute('data-id'); const act = btn.getAttribute('data-action');
        if (act==='start') hpCore.startExam(id);
        if (act==='pdf') hpCore.viewExamPDF(id);
      });
    },

    _card(ex){
      const type = (ex.type==='listening')? '🎧 听力' : '📖 阅读';
      const cat = ex.category || ex.part || '';
      return [
        '<div class="exam-card" style="border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:14px;background:rgba(255,255,255,0.04);">',
        '  <div class="exam-title" style="font-weight:700;margin-bottom:6px">'+(ex.title||'未命名')+'</div>',
        '  <div class="exam-meta" style="opacity:.8;font-size:12px;margin-bottom:10px">', type, (cat? (' · '+cat): ''), '</div>',
        '  <div class="exam-actions" style="display:flex;gap:8px;flex-wrap:wrap">',
        '    <button data-action="start" data-id="'+(ex.id||'')+'" class="btn" style="padding:8px 12px;border-radius:8px;background:#39282b;color:#fff;border:0;cursor:pointer">开始练习</button>',
        (ex.pdfFilename? ('    <button data-action="pdf" data-id="'+(ex.id||'')+'" class="btn btn-secondary" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:transparent;color:#fff;cursor:pointer">PDF</button>') : ''),
        '  </div>',
        '</div>'
      ].join('');
    }
  };

  hpCore.ready(()=> UI.init());
  try { console.log('[HP Practice Render] ready'); } catch(_){}
})();

