// Runtime fixes to smooth async storage + recovery under file://
(function () {
  'use strict';

  try {
    // Patch PracticeRecorder.recoverTemporaryRecords to a robust async version
    const patchPracticeRecorder = () => {
      const PR = window.PracticeRecorder;
      if (!PR || !PR.prototype) return false;

      const original = PR.prototype.recoverTemporaryRecords;
      PR.prototype.recoverTemporaryRecords = async function () {
        try {
          const raw = (window.storage && storage.get)
            ? await storage.get('temp_practice_records', [])
            : [];
          const tempRecords = Array.isArray(raw) ? raw : [];

          if (tempRecords.length === 0) {
            console.log('[PracticeRecorder] 没有需要恢复的临时记录');
            return;
          }

          console.log(`[PracticeRecorder] 发现 ${tempRecords.length} 条临时记录，开始恢复...`);

          let recoveredCount = 0;
          const failed = [];

          for (const tempRecord of tempRecords) {
            try {
              const { tempSavedAt, needsRecovery, ...cleanRecord } = tempRecord || {};
              if (this && typeof this.savePracticeRecord === 'function') {
                await this.savePracticeRecord(cleanRecord);
              }
              recoveredCount++;
              console.log(`[PracticeRecorder] 恢复记录成功: ${cleanRecord && cleanRecord.id}`);
            } catch (e) {
              console.error(`[PracticeRecorder] 恢复记录失败: ${tempRecord && tempRecord.id}`, e);
              failed.push(tempRecord);
            }
          }

          if (failed.length === 0) {
            if (window.storage && storage.remove) await storage.remove('temp_practice_records');
            console.log(`[PracticeRecorder] 所有 ${recoveredCount} 条临时记录恢复成功`);
          } else {
            if (window.storage && storage.set) await storage.set('temp_practice_records', failed);
            console.log(`[PracticeRecorder] 恢复了 ${recoveredCount} 条记录，${failed.length} 条失败`);
          }
        } catch (error) {
          console.error('[PracticeRecorder] 恢复临时记录时出错:', error);
        }
      };

      console.log('[RuntimeFixes] PracticeRecorder.recoverTemporaryRecords 已替换为异步实现');
      return true;
    };

    const tryPatch = () => {
      if (!patchPracticeRecorder()) setTimeout(tryPatch, 100);
    };
    tryPatch();
  } catch (_) {}
})();

