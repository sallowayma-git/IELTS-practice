/**
 * HP History Table (stable)
 * - Renders practice history into '#practice-history-table' as cards
 * - Falls back to <tbody> rendering if a table exists
 */
(function(){
  'use strict';
  if (typeof hpCore === 'undefined') { console.error('[HP-History-Table] hpCore missing'); return; }

  function fmtDuration(sec){ sec=+sec||0; var m=Math.floor(sec/60), s=sec%60; return (m+':'+String(s).padStart(2,'0')); }
  function badge(score){ score=+score||0; var color = score>=90?'#10b981': score>=80?'#3b82f6': score>=70?'#f59e0b':'#ef4444'; return '<span style="padding:4px 10px;border-radius:16px;background:'+color+';color:#fff;font-weight:700">'+score+'%</span>'; }

  function renderCards(records, examIndex){
    var wrap = document.getElementById('practice-history-table');
    if (!wrap) return false;
    if (!records.length) { wrap.innerHTML = '<div style="text-align:center;padding:40px;opacity:.8"><div style="font-size:3rem;margin-bottom:10px">📝</div><div>暂无练习记录</div></div>'; return true; }
    wrap.innerHTML = records.map(function(r){
      var ex = (examIndex||[]).find(e=> e.id===r.examId) || {};
      var title = ex.title || r.title || r.examName || '未知题目';
      var date = new Date(r.date || r.timestamp || Date.now());
      var score = r.score || r.percentage || 0;
      var dur = r.duration || (r.realData && r.realData.duration) || 0;
      return [
        '<div class="record-card" style="border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:12px;background:rgba(255,255,255,0.04);display:flex;justify-content:space-between;gap:10px">',
        '  <div>',
        '    <div style="font-weight:700;margin-bottom:2px">'+title+'</div>',
        '    <div style="opacity:.75;font-size:12px">'+date.toLocaleString()+' · '+fmtDuration(dur)+'</div>',
        '  </div>',
        '  <div>'+badge(score)+'</div>',
        '</div>'
      ].join('');
    }).join('');
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

  function update(){
    var recs = hpCore.getRecords().slice().sort((a,b)=> (new Date(b.date||b.timestamp))-(new Date(a.date||a.timestamp)));
    var exams = hpCore.getExamIndex();
    if (!renderCards(recs, exams)) renderTable(recs, exams);
  }

  hpCore.ready(()=>{ update(); hpCore.on('dataUpdated', update); });
  try { console.log('[HP-History-Table] ready'); } catch(_){}
})();

