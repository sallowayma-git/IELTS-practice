// Runtime fixes to smooth async storage + recovery under file://
(function () {
  'use strict';

  function summarizeRuntimeFixErrorForLog(error) {
    if (!error || typeof error !== 'object') {
      return { name: typeof error };
    }
    var status = Number(error.status);
    return {
      name: typeof error.name === 'string' && error.name ? error.name.slice(0, 80) : 'Error',
      status: Number.isFinite(status) ? status : undefined
    };
  }

  function ensureCompatPatch(global) {
    if (!global || (global.CompatPatch && typeof global.CompatPatch.register === 'function')) {
      return global && global.CompatPatch ? global.CompatPatch : null;
    }
    var patches = [];
    var register = function register(name, metadata) {
      if (!name) {
        return null;
      }
      var patch = Object.assign({
        name: String(name),
        owner: 'legacy',
        reason: '',
        removeAfter: ''
      }, metadata || {});
      patches.push(patch);
      return patch;
    };
    var list = function list() {
      return patches.slice();
    };
    global.CompatPatch = Object.assign({}, global.CompatPatch || {}, {
      register: register,
      list: list
    });
    return global.CompatPatch;
  }

  ensureCompatPatch(window);

  if (window.CompatPatch && typeof window.CompatPatch.register === 'function') {
    window.CompatPatch.register('practice-recorder-temp-recovery-async', {
      owner: 'practice',
      reason: 'file protocol compatible recovery for legacy temporary practice records',
      removeAfter: 'after PracticeRecorder recovery is canonical'
    });
  }

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
              const sanitized = (this && typeof this.sanitizeRecoveredRecord === 'function')
                ? this.sanitizeRecoveredRecord(cleanRecord)
                : cleanRecord;
              if (!sanitized || !sanitized.examId) {
                console.warn('[PracticeRecorder] 跳过无法修正的临时记录（缺少 examId 或字段无效）');
                continue;
              }
              if (this && typeof this.savePracticeRecord === 'function') {
                await this.savePracticeRecord(sanitized);
              }
              recoveredCount++;
              console.log('[PracticeRecorder] 恢复记录成功');
            } catch (e) {
              console.error('[PracticeRecorder] recovery failed:', summarizeRuntimeFixErrorForLog(e));
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
          console.error('[PracticeRecorder] recovery failed:', summarizeRuntimeFixErrorForLog(error));
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
