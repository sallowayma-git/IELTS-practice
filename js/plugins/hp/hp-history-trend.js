/**
 * HP History Trend Plugin
 * Render 10-day accuracy trend chart grouped by type (Reading vs Listening)
 * without modifying core system files.
 */
(function(){
  'use strict';

  if (typeof window.hpCore === 'undefined') {
    console.warn('[HP-History-Trend] hpCore not found, delaying init');
  }

  function renderTrendChart() {
    try {
      var container = document.getElementById('practice-trend-grid');
      if (!container) return;

      var records = (hpCore && typeof hpCore.getRecords === 'function') ? hpCore.getRecords() : (window.practiceRecords || []);

      // Get last 10 days of data
      var tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

      var recentRecords = (records || []).filter(function(record) {
        var recordDate = new Date(record.date);
        return recordDate >= tenDaysAgo;
      });

      if (recentRecords.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:rgba(255,255,255,0.6);"><div style="font-size:3rem;margin-bottom:15px;">📈</div><p>暂无趋势数据</p><p style="font-size:0.9rem;margin-top:10px;">需要更多练习记录来生成趋势图表</p></div>';
        return;
      }

      // Group records by date and type
      var dailyData = {};
      recentRecords.forEach(function(record) {
        var date = new Date(record.date).toDateString();
        if (!dailyData[date]) {
          dailyData[date] = { reading: [], listening: [] };
        }
        if (record.type === 'reading') {
          dailyData[date].reading.push(record);
        } else if (record.type === 'listening') {
          dailyData[date].listening.push(record);
        }
      });

      // Calculate daily averages
      var chartData = [];
      Object.keys(dailyData).sort().forEach(function(date) {
        var dayData = dailyData[date];
        var readingAvg = dayData.reading.length > 0
          ? dayData.reading.reduce(function(sum, r) { return sum + (r.score || r.percentage || 0); }, 0) / dayData.reading.length
          : null;
        var listeningAvg = dayData.listening.length > 0
          ? dayData.listening.reduce(function(sum, r) { return sum + (r.score || r.percentage || 0); }, 0) / dayData.listening.length
          : null;

        chartData.push({
          date: date,
          reading: readingAvg,
          listening: listeningAvg
        });
      });

      // Create simple SVG chart
      var width = 600;
      var height = 300;
      var padding = 40;

      // Calculate scales
      var maxScore = 100;
      var minScore = 0;

      var readingPoints = chartData.map(function(d, i) {
        if (d.reading === null) return null;
        var x = padding + (i / (chartData.length - 1)) * (width - 2 * padding);
        var y = height - padding - ((d.reading - minScore) / (maxScore - minScore)) * (height - 2 * padding);
        return x + ',' + y;
      }).filter(function(p) { return p !== null; }).join(' ');

      var listeningPoints = chartData.map(function(d, i) {
        if (d.listening === null) return null;
        var x = padding + (i / (chartData.length - 1)) * (width - 2 * padding);
        var y = height - padding - ((d.listening - minScore) / (maxScore - minScore)) * (height - 2 * padding);
        return x + ',' + y;
      }).filter(function(p) { return p !== null; }).join(' ');

      var svg = [
        '<svg width="' + width + '" height="' + height + '" style="background:rgba(255,255,255,0.05);border-radius:12px;">',
        '  <defs>',
        '    <linearGradient id="readingGradient" x1="0%" y1="0%" x2="0%" y2="100%">',
        '      <stop offset="0%" style="stop-color:#4FC3F7;stop-opacity:0.8" />',
        '      <stop offset="100%" style="stop-color:#4FC3F7;stop-opacity:0.2" />',
        '    </linearGradient>',
        '    <linearGradient id="listeningGradient" x1="0%" y1="0%" x2="0%" y2="100%">',
        '      <stop offset="0%" style="stop-color:#81C784;stop-opacity:0.8" />',
        '      <stop offset="100%" style="stop-color:#81C784;stop-opacity:0.2" />',
        '    </linearGradient>',
        '  </defs>',
        '  <g>',
        '    <text x="' + (width/2) + '" y="20" text-anchor="middle" fill="rgba(255,255,255,0.9)" font-size="14" font-weight="bold">最近10天练习趋势</text>',
        '    <line x1="' + padding + '" y1="' + (height - padding) + '" x2="' + (width - padding) + '" y2="' + (height - padding) + '" stroke="rgba(255,255,255,0.3)" stroke-width="1" />',
        '    <line x1="' + padding + '" y1="' + padding + '" x2="' + padding + '" y2="' + (height - padding) + '" stroke="rgba(255,255,255,0.3)" stroke-width="1" />',
        '    <text x="' + (padding - 10) + '" y="' + (height - padding + 5) + '" text-anchor="end" fill="rgba(255,255,255,0.6)" font-size="10">0%</text>',
        '    <text x="' + (padding - 10) + '" y="' + (height/2 + 5) + '" text-anchor="end" fill="rgba(255,255,255,0.6)" font-size="10">50%</text>',
        '    <text x="' + (padding - 10) + '" y="' + (padding + 15) + '" text-anchor="end" fill="rgba(255,255,255,0.6)" font-size="10">100%</text>',
        '  </g>',
        '  <g>'
      ];

      // Add reading line if we have data
      if (readingPoints) {
        svg.push(
          '    <polyline points="' + readingPoints + '" fill="none" stroke="#4FC3F7" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />',
          '    <text x="' + (width - padding + 10) + '" y="' + (height - padding - 10) + '" fill="#4FC3F7" font-size="12" font-weight="bold">阅读</text>'
        );
      }

      // Add listening line if we have data
      if (listeningPoints) {
        svg.push(
          '    <polyline points="' + listeningPoints + '" fill="none" stroke="#81C784" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />',
          '    <text x="' + (width - padding + 10) + '" y="' + (height - padding + 15) + '" fill="#81C784" font-size="12" font-weight="bold">听力</text>'
        );
      }

      svg.push('  </g>');
      svg.push('</svg>');

      container.innerHTML = svg.join('');

      // Add legend
      var legend = document.createElement('div');
      legend.style.cssText = 'display:flex;gap:20px;justify-content:center;margin-top:20px;flex-wrap:wrap;';
      legend.innerHTML = [
        '<div style="display:flex;align-items:center;gap:8px;">',
        '  <div style="width:16px;height:3px;background:#4FC3F7;border-radius:2px;"></div>',
        '  <span style="color:rgba(255,255,255,0.8);font-size:12px;">阅读准确率</span>',
        '</div>',
        '<div style="display:flex;align-items:center;gap:8px;">',
        '  <div style="width:16px;height:3px;background:#81C784;border-radius:2px;"></div>',
        '  <span style="color:rgba(255,255,255,0.8);font-size:12px;">听力准确率</span>',
        '</div>'
      ].join('');

      container.appendChild(legend);

    } catch (e) {
      console.error('[HP-History-Trend] render error', e);
      container.innerHTML = '<div style="text-align:center;padding:40px;color:rgba(255,255,255,0.6);"><div style="font-size:3rem;margin-bottom:15px;">⚠️</div><p>图表渲染出错</p></div>';
    }
  }

  function init() {
    // Render once DOM ready and whenever data updates
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', renderTrendChart);
    } else {
      renderTrendChart();
    }
    if (typeof hpCore !== 'undefined' && typeof hpCore.onDataUpdated === 'function') {
      hpCore.onDataUpdated(function(){ renderTrendChart(); });
    } else {
      // Fallback: listen to storage changes
      window.addEventListener('storage', function(e) {
        if (e.key === 'practice_records') {
          renderTrendChart();
        }
      });
    }
  }

  if (typeof hpCore !== 'undefined' && typeof hpCore.ready === 'function') {
    hpCore.ready(init);
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  console.log('[HP-History-Trend] plugin loaded');
})();
