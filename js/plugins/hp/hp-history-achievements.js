/**
 * HP History Achievements Plugin
 * Render achievements card with streak tracking and milestone system
 * without modifying core system files.
 */
(function(){
  'use strict';

  if (typeof window.hpCore === 'undefined') {
    console.warn('[HP-History-Achievements] hpCore not found, delaying init');
  }

  function calculateStreak(records) {
    if (!records || records.length === 0) return 0;

    // Sort records by date (newest first)
    var sortedRecords = records.sort(function(a, b) {
      return new Date(b.date) - new Date(a.date);
    });

    var streak = 0;
    var currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);

    // Check if user practiced today or yesterday
    var today = new Date(currentDate);
    var yesterday = new Date(currentDate);
    yesterday.setDate(yesterday.getDate() - 1);

    var hasToday = sortedRecords.some(function(record) {
      var recordDate = new Date(record.date);
      recordDate.setHours(0, 0, 0, 0);
      return recordDate.getTime() === today.getTime();
    });

    var hasYesterday = sortedRecords.some(function(record) {
      var recordDate = new Date(record.date);
      recordDate.setHours(0, 0, 0, 0);
      return recordDate.getTime() === yesterday.getTime();
    });

    if (!hasToday && !hasYesterday) {
      return 0; // Streak broken
    }

    // Count consecutive days
    var checkDate = hasToday ? new Date(today) : new Date(yesterday);
    var recordIndex = 0;

    while (true) {
      var dayRecords = sortedRecords.filter(function(record) {
        var recordDate = new Date(record.date);
        recordDate.setHours(0, 0, 0, 0);
        return recordDate.getTime() === checkDate.getTime();
      });

      if (dayRecords.length === 0) {
        break; // No practice on this day
      }

      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    }

    return streak;
  }

  function calculateMilestones(records) {
    if (!records || records.length === 0) {
      return {
        currentScore: 0,
        nextMilestone: 60,
        milestonesAchieved: [],
        progressToNext: 0
      };
    }

    // Get the latest score
    var latestRecord = records.sort(function(a, b) {
      return new Date(b.date) - new Date(a.date);
    })[0];

    var currentScore = latestRecord.score || latestRecord.percentage || 0;

    // Define milestone ranges
    var milestones = [];

    // 60-70: every +5%
    for (var score = 60; score <= 70; score += 5) {
      milestones.push(score);
    }

    // 70-80: every +3%
    for (var score = 73; score <= 80; score += 3) {
      milestones.push(score);
    }

    // 80-90: every +3%
    for (var score = 83; score <= 90; score += 3) {
      milestones.push(score);
    }

    // 90-100: every +1%
    for (var score = 91; score <= 100; score += 1) {
      milestones.push(score);
    }

    // Find achieved milestones
    var achieved = milestones.filter(function(milestone) {
      return currentScore >= milestone;
    });

    // Find next milestone
    var nextMilestone = milestones.find(function(milestone) {
      return milestone > currentScore;
    }) || 100;

    // Calculate progress to next milestone
    var previousMilestone = achieved.length > 0 ? achieved[achieved.length - 1] : 0;
    var progressToNext = nextMilestone > previousMilestone
      ? ((currentScore - previousMilestone) / (nextMilestone - previousMilestone)) * 100
      : 100;

    return {
      currentScore: Math.round(currentScore),
      nextMilestone: nextMilestone,
      milestonesAchieved: achieved,
      progressToNext: Math.min(100, Math.max(0, Math.round(progressToNext)))
    };
  }

  function renderAchievementsCard() {
    try {
      var container = document.getElementById('achievements-grid');
      if (!container) return;

      var records = (hpCore && typeof hpCore.getRecords === 'function') ? hpCore.getRecords() : (window.practiceRecords || []);

      var streak = calculateStreak(records);
      var milestones = calculateMilestones(records);

      var cardStyle = 'background:rgba(255,255,255,0.08);border-radius:12px;padding:20px;border:1px solid rgba(255,255,255,0.1);min-width:200px;';
      var progressBarStyle = 'width:100%;height:8px;background:rgba(255,255,255,0.1);border-radius:4px;overflow:hidden;margin-top:8px;';
      var progressFillStyle = 'height:100%;background:linear-gradient(90deg, #4FC3F7, #81C784);border-radius:4px;transition:width 0.3s ease;';

      container.innerHTML = [
        '<div style="'+cardStyle+'">',
        '  <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">',
        '    <div style="font-size:24px;">🏆</div>',
        '    <div>',
        '      <div style="font-weight:700;font-size:16px;color:rgba(255,255,255,0.9);">成就</div>',
        '      <div style="font-size:12px;color:rgba(255,255,255,0.6);">练习进度</div>',
        '    </div>',
        '  </div>',
        '  <div style="margin-bottom:16px;">',
        '    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">',
        '      <span style="font-size:14px;color:rgba(255,255,255,0.8);">当前分数</span>',
        '      <span style="font-size:18px;font-weight:700;color:#4FC3F7;">'+milestones.currentScore+'%</span>',
        '    </div>',
        '    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">',
        '      <span style="font-size:14px;color:rgba(255,255,255,0.8);">下一个里程碑</span>',
        '      <span style="font-size:16px;font-weight:600;color:#81C784;">'+milestones.nextMilestone+'%</span>',
        '    </div>',
        '    <div style="'+progressBarStyle+'">',
        '      <div style="'+progressFillStyle+'width:'+milestones.progressToNext+'%;"></div>',
        '    </div>',
        '    <div style="text-align:center;margin-top:4px;">',
        '      <span style="font-size:11px;color:rgba(255,255,255,0.6);">'+milestones.progressToNext+'% 完成</span>',
        '    </div>',
        '  </div>',
        '  <div style="border-top:1px solid rgba(255,255,255,0.1);padding-top:16px;">',
        '    <div style="display:flex;justify-content:space-between;align-items:center;">',
        '      <div>',
        '        <div style="font-size:14px;color:rgba(255,255,255,0.8);">连续练习</div>',
        '        <div style="font-size:11px;color:rgba(255,255,255,0.6);">天数</div>',
        '      </div>',
        '      <div style="text-align:center;">',
        '        <div style="font-size:24px;font-weight:700;color:#FFB74D;">'+streak+'</div>',
        '        <div style="font-size:10px;color:rgba(255,255,255,0.6);">天</div>',
        '      </div>',
        '    </div>',
        '  </div>',
        '</div>'
      ].join('');

    } catch (e) {
      console.error('[HP-History-Achievements] render error', e);
      container.innerHTML = '<div style="text-align:center;padding:20px;color:rgba(255,255,255,0.6);"><div style="font-size:2rem;margin-bottom:10px;">⚠️</div><p>成就数据加载出错</p></div>';
    }
  }

  function init() {
    // Render once DOM ready and whenever data updates
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', renderAchievementsCard);
    } else {
      renderAchievementsCard();
    }
    if (typeof hpCore !== 'undefined' && typeof hpCore.onDataUpdated === 'function') {
      hpCore.onDataUpdated(function(){ renderAchievementsCard(); });
    } else {
      // Fallback: listen to storage changes
      window.addEventListener('storage', function(e) {
        if (e.key === 'myMelodyPracticeRecords' || e.key === 'exam_system_practice_records') {
          renderAchievementsCard();
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

  console.log('[HP-History-Achievements] plugin loaded');
})();
