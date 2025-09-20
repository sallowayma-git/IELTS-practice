/**
 * HP Browse Grouped View Plugin
 * Render grouped exam view by category (P1/P2/P3 for Reading, P3/P4 for Listening)
 * with optional fold/unfold functionality and search/filter integration
 * without modifying core system files.
 */
(function(){
  'use strict';

  if (typeof window.hpCore === 'undefined') {
    console.warn('[HP-Browse-Grouped] hpCore not found, delaying init');
  }

  var currentFilter = 'all';
  var searchTerm = '';
  var groupStates = {}; // Track which groups are folded/unfolded

  function groupExamsByCategory(exams) {
    var groups = {
      reading: {
        P1: [],
        P2: [],
        P3: []
      },
      listening: {
        P3: [],
        P4: []
      }
    };

    (exams || []).forEach(function(exam) {
      if (exam && exam.type && exam.category) {
        var type = exam.type.toLowerCase();
        var category = exam.category.toUpperCase();

        if (type === 'reading' && (category === 'P1' || category === 'P2' || category === 'P3')) {
          groups.reading[category].push(exam);
        } else if (type === 'listening' && (category === 'P3' || category === 'P4')) {
          groups.listening[category].push(exam);
        }
      }
    });

    return groups;
  }

  function filterExams(exams) {
    var filtered = exams;

    // Apply type filter
    if (currentFilter !== 'all') {
      filtered = filtered.filter(function(exam) {
        return exam.type === currentFilter;
      });
    }

    // Apply search filter
    if (searchTerm) {
      var term = searchTerm.toLowerCase();
      filtered = filtered.filter(function(exam) {
        return (exam.title && exam.title.toLowerCase().includes(term)) ||
               (exam.description && exam.description.toLowerCase().includes(term)) ||
               (exam.category && exam.category.toLowerCase().includes(term));
      });
    }

    return filtered;
  }

  function createGroupHeader(groupName, examCount, isFolded) {
    var headerStyle = [
      'display:flex;',
      'justify-content:space-between;',
      'align-items:center;',
      'padding:16px 20px;',
      'background:rgba(255,255,255,0.08);',
      'border:1px solid rgba(255,255,255,0.1);',
      'border-radius:12px;',
      'margin-bottom:12px;',
      'cursor:pointer;',
      'transition:all 0.3s ease;'
    ].join('');

    var headerHoverStyle = [
      'background:rgba(255,255,255,0.12);',
      'border-color:rgba(255,255,255,0.2);',
      'transform:translateY(-2px);',
      'box-shadow:0 4px 12px rgba(0,0,0,0.15);'
    ].join('');

    var icon = isFolded ? '▶️' : '🔽';
    var statusText = isFolded ? '展开' : '折叠';

    return [
      '<div class="group-header" style="' + headerStyle + '" onmouseover="this.style=\'' + headerStyle + headerHoverStyle + '\'" onmouseout="this.style=\'' + headerStyle + '\'">',
      '  <div style="display:flex;align-items:center;gap:12px;">',
      '    <div style="font-size:20px;">' + (groupName === 'P1' ? '📚' : groupName === 'P2' ? '📖' : groupName === 'P3' ? '📝' : '🎧') + '</div>',
      '    <div>',
      '      <div style="font-weight:700;font-size:16px;color:rgba(255,255,255,0.9);">' + groupName + ' 级别</div>',
      '      <div style="font-size:12px;color:rgba(255,255,255,0.6);">' + examCount + ' 个题目</div>',
      '    </div>',
      '  </div>',
      '  <div style="display:flex;align-items:center;gap:12px;">',
      '    <button class="group-random-btn" style="padding:6px 12px;font-size:11px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.1);color:white;cursor:pointer;transition:all 0.2s;" onmouseover="this.style.background=\'rgba(255,255,255,0.2)\'" onmouseout="this.style.background=\'rgba(255,255,255,0.1)\'">🎲 随机</button>',
      '    <button class="group-toggle-btn" style="padding:4px 8px;font-size:11px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.1);color:white;cursor:pointer;transition:all 0.2s;" onmouseover="this.style.background=\'rgba(255,255,255,0.2)\'" onmouseout="this.style.background=\'rgba(255,255,255,0.1)\'">' + icon + ' ' + statusText + '</button>',
      '  </div>',
      '</div>'
    ].join('');
  }

  function createExamCard(exam) {
    var cardStyle = [
      'background:rgba(255,255,255,0.06);',
      'border:1px solid rgba(255,255,255,0.1);',
      'border-radius:8px;',
      'padding:16px;',
      'margin-bottom:12px;',
      'transition:all 0.3s ease;',
      'cursor:pointer;'
    ].join('');

    var cardHoverStyle = [
      'background:rgba(255,255,255,0.1);',
      'border-color:rgba(255,255,255,0.2);',
      'transform:translateY(-2px);',
      'box-shadow:0 4px 12px rgba(0,0,0,0.15);'
    ].join('');

    var typeIcon = exam.type === 'reading' ? '📖' : '🎧';
    var typeName = exam.type === 'reading' ? '阅读' : '听力';

    // Check if exam has been completed
    var records = (hpCore && typeof hpCore.getRecords === 'function') ? hpCore.getRecords() : (window.practiceRecords || []);
    var examRecords = records.filter(function(record) {
      return record.examId === exam.id || record.title === exam.title;
    });
    var bestScore = examRecords.length > 0
      ? Math.max(...examRecords.map(function(r) { return r.score || r.percentage || 0; }))
      : 0;

    return [
      '<div class="exam-card" style="' + cardStyle + '" onmouseover="this.style=\'' + cardStyle + cardHoverStyle + '\'" onmouseout="this.style=\'' + cardStyle + '\'">',
      '  <div style="display:flex;justify-content:space-between;align-items:start;gap:16px;">',
      '    <div style="flex:1;">',
      '      <div style="font-weight:600;font-size:14px;color:rgba(255,255,255,0.9);margin-bottom:8px;">' + (exam.title || '无标题') + '</div>',
      '      <div style="display:flex;align-items:center;gap:12px;font-size:12px;color:rgba(255,255,255,0.7);margin-bottom:12px;">',
      '        <span>' + typeIcon + ' ' + typeName + '</span>',
      '        <span>•</span>',
      '        <span>' + (exam.category || 'P1') + '</span>',
      examRecords.length > 0 ? '<span>•</span><span style="color:#4FC3F7;">最佳: ' + bestScore + '%</span>' : '',
      '      </div>',
      '      <div style="font-size:11px;color:rgba(255,255,255,0.6);">' + (exam.description || '暂无描述') + '</div>',
      '    </div>',
      '    <div style="display:flex;gap:8px;">',
      '      <button class="exam-start-btn" style="padding:8px 16px;font-size:12px;border-radius:6px;border:1px solid #4FC3F7;background:#4FC3F7;color:white;cursor:pointer;transition:all 0.2s;" onmouseover="this.style.background=\'#29B6F6\'" onmouseout="this.style.background=\'#4FC3F7\'">开始练习</button>',
      '      <button class="exam-pdf-btn" style="padding:8px 12px;font-size:12px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.1);color:white;cursor:pointer;transition:all 0.2s;" onmouseover="this.style.background=\'rgba(255,255,255,0.2)\'" onmouseout="this.style.background=\'rgba(255,255,255,0.1)\'">📄 PDF</button>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('');
  }

  function renderGroupedView() {
    try {
      var container = document.getElementById('practice-exam-grid');
      if (!container) return;

      var exams = (hpCore && typeof hpCore.getExamIndex === 'function') ? hpCore.getExamIndex() : (window.examIndex || []);
      var filteredExams = filterExams(exams);
      var groups = groupExamsByCategory(filteredExams);

      var html = [];

      // Reading groups
      if (currentFilter === 'all' || currentFilter === 'reading') {
        ['P1', 'P2', 'P3'].forEach(function(category) {
          var groupExams = groups.reading[category];
          if (groupExams.length > 0) {
            var isFolded = groupStates['reading-' + category] || false;
            html.push(createGroupHeader(category, groupExams.length, isFolded));

            if (!isFolded) {
              html.push('<div class="group-content" style="padding:0 20px 20px 20px;">');
              groupExams.forEach(function(exam) {
                html.push(createExamCard(exam));
              });
              html.push('</div>');
            }
          }
        });
      }

      // Listening groups
      if (currentFilter === 'all' || currentFilter === 'listening') {
        ['P3', 'P4'].forEach(function(category) {
          var groupExams = groups.listening[category];
          if (groupExams.length > 0) {
            var isFolded = groupStates['listening-' + category] || false;
            html.push(createGroupHeader(category, groupExams.length, isFolded));

            if (!isFolded) {
              html.push('<div class="group-content" style="padding:0 20px 20px 20px;">');
              groupExams.forEach(function(exam) {
                html.push(createExamCard(exam));
              });
              html.push('</div>');
            }
          }
        });
      }

      container.innerHTML = html.join('');

      // Wire up event handlers
      wireEventHandlers();

    } catch (e) {
      console.error('[HP-Browse-Grouped] render error', e);
      container.innerHTML = '<div style="text-align:center;padding:40px;color:rgba(255,255,255,0.6);"><div style="font-size:3rem;margin-bottom:15px;">⚠️</div><p>分组视图渲染出错</p></div>';
    }
  }

  function wireEventHandlers() {
    // Group toggle buttons
    document.querySelectorAll('.group-toggle-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var header = btn.closest('.group-header');
        var groupName = header.querySelector('.group-header > div > div > div').textContent.trim().split(' ')[0];
        var type = groupName.startsWith('P1') || groupName.startsWith('P2') || groupName.startsWith('P3') ? 'reading' : 'listening';
        var key = type + '-' + groupName;

        groupStates[key] = !groupStates[key];
        renderGroupedView();
      });
    });

    // Group random buttons
    document.querySelectorAll('.group-random-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var header = btn.closest('.group-header');
        var groupName = header.querySelector('.group-header > div > div > div').textContent.trim().split(' ')[0];
        var type = groupName.startsWith('P1') || groupName.startsWith('P2') || groupName.startsWith('P3') ? 'reading' : 'listening';

        var exams = (hpCore && typeof hpCore.getExamIndex === 'function') ? hpCore.getExamIndex() : (window.examIndex || []);
        var pool = exams.filter(function(exam) {
          return exam.type === type && exam.category === groupName;
        });

        if (pool.length > 0) {
          var pick = pool[Math.floor(Math.random() * pool.length)];
          if (window.openExam) window.openExam(pick.id);
        }
      });
    });

    // Exam cards
    document.querySelectorAll('.exam-card').forEach(function(card) {
      card.addEventListener('click', function() {
        var title = card.querySelector('.exam-card > div > div > div').textContent.trim();
        var exams = (hpCore && typeof hpCore.getExamIndex === 'function') ? hpCore.getExamIndex() : (window.examIndex || []);
        var exam = exams.find(function(e) { return e.title === title; });
        if (exam && window.openExam) window.openExam(exam.id);
      });
    });

    // Exam start buttons
    document.querySelectorAll('.exam-start-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var card = btn.closest('.exam-card');
        var title = card.querySelector('.exam-card > div > div > div').textContent.trim();
        var exams = (hpCore && typeof hpCore.getExamIndex === 'function') ? hpCore.getExamIndex() : (window.examIndex || []);
        var exam = exams.find(function(e) { return e.title === title; });
        if (exam && window.openExam) window.openExam(exam.id);
      });
    });

    // Exam PDF buttons
    document.querySelectorAll('.exam-pdf-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var card = btn.closest('.exam-card');
        var title = card.querySelector('.exam-card > div > div > div').textContent.trim();
        var exams = (hpCore && typeof hpCore.getExamIndex === 'function') ? hpCore.getExamIndex() : (window.examIndex || []);
        var exam = exams.find(function(e) { return e.title === title; });
        if (exam && window.openExamPDF) window.openExamPDF(exam.id);
      });
    });
  }

  function updateFilter(type) {
    currentFilter = type;
    renderGroupedView();
  }

  function updateSearch(term) {
    searchTerm = term;
    renderGroupedView();
  }

  function init() {
    // Render once DOM ready and whenever data updates
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', renderGroupedView);
    } else {
      renderGroupedView();
    }

    if (typeof hpCore !== 'undefined' && typeof hpCore.onDataUpdated === 'function') {
      hpCore.onDataUpdated(function(){ renderGroupedView(); });
    } else {
      // Fallback: listen to storage changes
      window.addEventListener('storage', function(e) {
        if (e.key === 'myMelodyExamData' || e.key === 'exam_system_exam_index') {
          renderGroupedView();
        }
      });
    }

    // Listen for filter changes
    window.addEventListener('hp-browse-filter-changed', function(e) {
      if (e.detail && e.detail.type) {
        updateFilter(e.detail.type);
      }
    });

    // Listen for search changes
    window.addEventListener('hp-browse-search-changed', function(e) {
      if (e.detail && e.detail.term !== undefined) {
        updateSearch(e.detail.term);
      }
    });
  }

  if (typeof hpCore !== 'undefined' && typeof hpCore.ready === 'function') {
    hpCore.ready(init);
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose functions globally for integration
  window.hpBrowseGrouped = {
    render: renderGroupedView,
    updateFilter: updateFilter,
    updateSearch: updateSearch
  };

  console.log('[HP-Browse-Grouped] plugin loaded');
})();
