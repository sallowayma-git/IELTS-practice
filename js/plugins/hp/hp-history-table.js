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

    // Prepare columns and state
    var cols = [[],[],[]];
    for (var i=0;i<records.length;i++) cols[i%3].push(records[i]);
    wrap.innerHTML = '';
    wrap.style.display = 'grid';
    wrap.style.gridTemplateColumns = 'repeat(3, 1fr)';
    wrap.style.gap = '12px';

    var state = { cols: cols, loaded: [0,0,0], pageSize: 30 };
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

    function append(colEl, colIndex){
      var list = state.cols[colIndex];
      var start = state.loaded[colIndex];
      if (start >= list.length) return;
      var end = Math.min(list.length, start + state.pageSize);
      var frag = document.createDocumentFragment();
      for (var j=start;j<end;j++){
        var div = document.createElement('div');
        div.innerHTML = cardHTML(list[j]);
        // unwrap to avoid nested div layers
        while (div.firstChild) colEl.appendChild(div.firstChild);
      }
      state.loaded[colIndex] = end;
    }

    for (var c=0;c<3;c++){
      var col = document.createElement('div');
      col.className = 'hp-history-col';
      col.style.maxHeight = '600px';
      col.style.overflowY = 'auto';
      col.style.display = 'flex';
      col.style.flexDirection = 'column';
      col.style.gap = '12px';
      wrap.appendChild(col);
      append(col, c);
      (function(ci, el){
        el.addEventListener('scroll', function(){
          try {
            if (el.scrollTop + el.clientHeight + 40 >= el.scrollHeight) {
              append(el, ci);
            }
          } catch(_){ }
        }, { passive:true });
      })(c, col);
    }
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
