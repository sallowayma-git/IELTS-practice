/**
 * HP History Table (stable)
 * - Renders practice history into '#practice-history-table' as cards
 * - Falls back to <tbody> rendering if a table exists
 */
(function(){
  'use strict';
  if (typeof hpCore === 'undefined') { console.error('[HP-History-Table] hpCore missing'); return; }

  var currentFilter = { type: 'all', category: 'all', startDate: null, endDate: null };

  function fmtDuration(sec){ sec=+sec||0; var m=Math.floor(sec/60), s=sec%60; return (m+':'+String(s).padStart(2,'0')); }
  function badge(score){ score=+score||0; var color = score>=90?'#10b981': score>=80?'#3b82f6': score>=70?'#f59e0b':'#ef4444'; return '<span style="padding:4px 10px;border-radius:16px;background:'+color+';color:#fff;font-weight:700">'+score+'%</span>'; }

  function renderCards(records, examIndex){
    var wrap = document.getElementById('practice-history-table');
    if (!wrap) return false;
    wrap.style.color = '#fff';
    // 3-column virtual scroll layout
    if (!records.length) {
      wrap.innerHTML = '<div style="text-align:center;padding:40px;opacity:.8;color:#fff"><div style="font-size:3rem;margin-bottom:10px">📝</div><div>暂无练习记录</div></div>';
      return true;
    }

    // Prepare columns and shared state (single scrollbar)
    // Build inner scroller container (single scrollbar)
    wrap.innerHTML = '';
    var scroller = document.createElement('div');
    scroller.className = 'hp-history-scroller';
    scroller.style.overflowY = 'auto';
    scroller.style.overflowX = 'hidden';
    scroller.style.display = 'grid';
    scroller.style.gridTemplateColumns = 'repeat(3, 1fr)';
    scroller.style.gap = '12px';
    scroller.style.alignItems = 'start';
    // dynamic height: fill viewport from table top
    try {
      var top = wrap.getBoundingClientRect().top + (window.scrollY||document.documentElement.scrollTop||0);
      var avail = Math.max(320, (window.innerHeight||800) - (wrap.getBoundingClientRect().top||0) - 40);
      scroller.style.maxHeight = avail + 'px';
      scroller.style.height = avail + 'px';
    } catch(_){ scroller.style.maxHeight = '600px'; scroller.style.height = '600px'; }
    wrap.appendChild(scroller);

    var state = { list: records, loaded: 0, pageSize: 60, colsEl: [], spacers: [], removedHeights: [0,0,0], head: [0,1,2], keepTotal: 180, scroller: scroller };
    function cardHTML(r){
      var ex = (examIndex||[]).find(function(e){ return e.id===r.examId; }) || {};
      var title = ex.title || r.title || r.examName || '未知题目';
      var date = new Date(r.date || r.timestamp || Date.now());
      var score = r.score || r.percentage || 0;
      var dur = r.duration || (r.realData && r.realData.duration) || 0;
      return [
        '<div class="record-card" style="border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:12px;background:rgba(255,255,255,0.04);display:flex;justify-content:space-between;gap:10px;color:#fff">',
        '  <div>',
        '    <div style="font-weight:700;margin-bottom:2px;color:#fff">'+title+'</div>',
        '    <div style="opacity:.9;font-size:12px;color:#fff">'+date.toLocaleString()+' · '+fmtDuration(dur)+'</div>',
        '  </div>',
        '  <div>'+badge(score)+'</div>',
        '</div>'
      ].join('');
    }

    function appendMore(){
      var start = state.loaded;
      if (start >= state.list.length) return;
      var end = Math.min(state.list.length, start + state.pageSize);
      for (var i=start;i<end;i++){
        var r = state.list[i];
        var ci = i % 3;
        var colEl = state.colsEl[ci];
        var div = document.createElement('div');
        div.innerHTML = cardHTML(r);
        while (div.firstChild) colEl.appendChild(div.firstChild);
      }
      state.loaded = end;
      trimIfNeeded();
    }

    function ensureSpacers(){
      for (var c=0;c<3;c++){
        if (!state.spacers[c]){
          var s = document.createElement('div');
          s.className = 'hp-history-spacer';
          s.style.width = '100%';
          s.style.height = '0px';
          state.colsEl[c].insertBefore(s, state.colsEl[c].firstChild || null);
          state.spacers[c] = s;
        }
      }
    }

    function trimIfNeeded(){
      var keepPerCol = Math.ceil((state.keepTotal || 180)/3);
      ensureSpacers();
      for (var c=0;c<3;c++){
        var col = state.colsEl[c];
        // children excluding spacer, only record-card
        var list = Array.prototype.filter.call(col.children, function(n){ return n !== state.spacers[c]; });
        if (list.length > keepPerCol){
          var removeCount = list.length - keepPerCol;
          var removedH = 0;
          for (var k=0;k<removeCount;k++){
            var node = list[k];
            try { removedH += (node.offsetHeight || 0) + 12; } catch(_){ }
            col.removeChild(node);
            state.head[c] += 3; // advance earliest global index in this column
          }
          state.removedHeights[c] += removedH;
          // increase spacer to preserve scroll offset
          state.spacers[c].style.height = state.removedHeights[c] + 'px';
        }
      }
    }

    function reAddIfNeeded(){
      if (!state.spacers.length) return;
      var nearTop = state.scroller.scrollTop <= 120;
      if (!nearTop) return;
      var keepPerCol = Math.ceil((state.keepTotal || 180)/3);
      for (var c=0;c<3;c++){
        // if we trimmed before, head[c] will be > c
        var canRestore = state.head[c] > c;
        if (!canRestore) continue;
        var toRestore = Math.min(state.pageSize, Math.floor(state.head[c]/3)*3 ? state.pageSize : state.pageSize); // restore in page chunks
        // restore items with global indices: from head[c]-3*count .. head[c]-3 step -3
        var addedH = 0, addedCount = 0;
        for (var gi = state.head[c]-3; gi >= 0 && addedCount < toRestore; gi -= 3){
          if ((gi % 3) !== c) break;
          var r = state.list[gi]; if (!r) break;
          var colEl = state.colsEl[c];
          var holder = document.createElement('div');
          holder.innerHTML = cardHTML(r);
          var first = state.spacers[c].nextSibling;
          // Measure approximate height after insertion
          var el;
          while (holder.firstChild){ el = holder.firstChild; colEl.insertBefore(el, first); }
          try { addedH += (el && el.offsetHeight ? el.offsetHeight : 0) + 12; } catch(_){ }
          state.head[c] -= 3;
          addedCount += 3;
          if (addedCount >= toRestore) break;
        }
        // decrease spacer height to move content down accordingly
        if (addedH > 0){
          state.removedHeights[c] = Math.max(0, state.removedHeights[c] - addedH);
          state.spacers[c].style.height = state.removedHeights[c] + 'px';
          // Optionally trim from bottom to keep memory bound
          var nodes = Array.prototype.filter.call(state.colsEl[c].children, function(n){ return n !== state.spacers[c]; });
          var over = nodes.length - keepPerCol;
          if (over > 0){
            for (var t=0; t<over; t++){
              var last = state.colsEl[c].lastElementChild;
              if (last && last !== state.spacers[c]) state.colsEl[c].removeChild(last);
            }
          }
        }
      }
    }

    for (var c=0;c<3;c++){
      var col = document.createElement('div');
      col.className = 'hp-history-col';
      col.style.display = 'flex';
      col.style.flexDirection = 'column';
      col.style.gap = '12px';
      scroller.appendChild(col);
      state.colsEl.push(col);
    }

    // Initial fill
    appendMore();

    // Rebind single scroll listener (page-level)
    if (wrap.__hpScrollHandler) {
      try { state.scroller.removeEventListener('scroll', wrap.__hpScrollHandler); } catch(_){ }
    }
    wrap.__hpScrollHandler = function(){
      try {
        var el = state.scroller;
        if (el.scrollTop + el.clientHeight + 200 >= el.scrollHeight) { appendMore(); }
        if (el.scrollTop <= 120) { reAddIfNeeded(); }
      } catch(_){ }
    };
    state.scroller.addEventListener('scroll', wrap.__hpScrollHandler, { passive:true });

    // Recompute height on resize
    if (wrap.__hpResizeHandler) { try { window.removeEventListener('resize', wrap.__hpResizeHandler); } catch(_){ } }
    wrap.__hpResizeHandler = function(){
      try {
        var avail = Math.max(320, (window.innerHeight||800) - (wrap.getBoundingClientRect().top||0) - 40);
        state.scroller.style.maxHeight = avail + 'px';
        state.scroller.style.height = avail + 'px';
      } catch(_){ }
    };
    window.addEventListener('resize', wrap.__hpResizeHandler);

    // keep state for potential future use
    wrap.__hpColState = state;
    return true;
  }

  function renderTable(records, examIndex){
    var tbody = document.querySelector('#practice-view tbody') || document.querySelector('tbody');
    if (!tbody) return false;
    tbody.innerHTML = '';
    if (!records.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;opacity:.8">暂无练习记录</td></tr>';
      return true;
    }
    records.forEach(function(r){
      var ex = (examIndex||[]).find(e=> e.id===r.examId) || {};
      var title = ex.title || r.title || r.examName || '未知题目';
      var date = new Date(r.date || r.timestamp || Date.now());
      var score = r.score || r.percentage || 0;
      var dur = r.duration || (r.realData && r.realData.duration) || 0;
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>'+title+'</td><td>'+badge(score)+'</td><td>'+fmtDuration(dur)+'</td><td>'+date.toLocaleDateString()+'</td><td>'+date.toLocaleTimeString()+'</td>';
      tbody.appendChild(tr);
    });
    return true;
  }

  function setupFilterControls(){
    var cont = document.getElementById('practice-history-container');
    if (!cont) return;
    var selects = cont.querySelectorAll('select');
    if (!selects || !selects.length) return;
    var sel = selects[0];
    // Fill select by scanning examIndex for unique type-category pairs
    try {
      var seen = new Set();
      var optsList = [{ v:'all', t:'全部' }];
      var idx = (typeof hpCore!=='undefined' && hpCore.getExamIndex) ? hpCore.getExamIndex() : (window.examIndex||[]);
      (idx||[]).forEach(function(ex){
        var type = (ex && ex.type || '').toLowerCase();
        var cat = (ex && (ex.category || ex.part) || '').toUpperCase();
        if (!type || !cat) return;
        var key = type+':'+cat;
        if (seen.has(key)) return; seen.add(key);
        var label = (type==='reading' ? '阅读 ' : '听力 ') + cat;
        optsList.push({ v:key, t:label });
      });
      if (optsList.length>1) {
        sel.innerHTML = '';
        optsList.forEach(function(o){ var opt=document.createElement('option'); opt.value=o.v; opt.textContent=o.t; sel.appendChild(opt); });
      }
    } catch(_) {}
    var btn = Array.from(cont.querySelectorAll('button')).find(function(b){ return (b.textContent||'').trim().toLowerCase()==='apply filters'; });
    if (btn && sel) {
      btn.addEventListener('click', function(){
        var val = sel.value || 'all';
        var next = { type:'all', category:'all', startDate:null, endDate:null };
        if (val!=='all') {
          var parts = val.split(':');
          next.type = parts[0];
          next.category = (parts[1]||'all').toUpperCase();
        }
        // read date range if provided
        try {
          var inputs = cont.querySelectorAll('input');
          if (inputs && inputs.length>=1) {
            var s = inputs[0].value && new Date(inputs[0].value);
            if (s && !isNaN(s)) { s.setHours(0,0,0,0); next.startDate = s; }
          }
          if (inputs && inputs.length>=2) {
            var e = inputs[1].value && new Date(inputs[1].value);
            if (e && !isNaN(e)) { e.setHours(23,59,59,999); next.endDate = e; }
          }
        } catch(_){}
        currentFilter = next;
        update();
      });
    }
  }

  function applyRecordFilter(records, examIndex){
    if (!records) return records;
    return records.filter(function(r){
      var pass = true;
      // type/category filter
      var type = (r.type || '').toLowerCase();
      var ex = (examIndex||[]).find(function(e){ return e.id===r.examId; });
      var cat = (r.category || r.part || (ex && (ex.category||ex.part)) || '').toUpperCase();
      if (currentFilter.type && currentFilter.type!=='all' && type !== currentFilter.type) pass = false;
      if (currentFilter.category && currentFilter.category!=='all' && cat !== currentFilter.category) pass = false;
      // date window filter
      var d = new Date(r.date || r.timestamp || Date.now());
      if (currentFilter.startDate && d < currentFilter.startDate) pass = false;
      if (currentFilter.endDate && d > currentFilter.endDate) pass = false;
      return pass;
    });
  }

  function update(){
    setupFilterControls();
    var exams = hpCore.getExamIndex();
    var recs = hpCore.getRecords().slice().sort((a,b)=> (new Date(b.date||b.timestamp))-(new Date(a.date||a.timestamp)));
    recs = applyRecordFilter(recs, exams);
    if (!renderCards(recs, exams)) renderTable(recs, exams);
  }

  hpCore.ready(()=>{ update(); hpCore.on('dataUpdated', update); });
  try { console.log('[HP-History-Table] ready'); } catch(_){}
})();
