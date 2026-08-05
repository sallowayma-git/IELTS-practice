/** Clear all browser-local IELTS Atlas data while preserving external JSON files. */
(function initSiteDataReset(global) {
    'use strict';

    if (global.SiteDataReset && global.SiteDataReset.__v2 === true) {
        global.clearCache = global.SiteDataReset.request;
        return;
    }

    const DATABASE_NAMES = Object.freeze([
        'IELTSAtlasDataV2',
        'ExamSystemDB',
        'IELTSAtlasExternalBackupV2'
    ]);
    let resetPromise = null;

    function notify(message, type = 'info') {
        if (typeof global.showMessage === 'function') global.showMessage(message, type);
        else if (global.console && typeof global.console.log === 'function') {
            global.console.log(`[SiteDataReset] ${message}`);
        }
    }

    function deleteDatabase(name) {
        return new Promise((resolve, reject) => {
            const indexedDB = global.indexedDB;
            if (!indexedDB || typeof indexedDB.deleteDatabase !== 'function') {
                resolve({ name, skipped: true });
                return;
            }

            let request;
            try { request = indexedDB.deleteDatabase(name); }
            catch (error) { reject(error); return; }

            request.onsuccess = () => resolve({ name, deleted: true });
            request.onerror = () => reject(request.error || new Error(`删除数据库失败：${name}`));
            request.onblocked = () => notify(
                `数据库 ${name} 正被其他 IELTS Atlas 标签页占用。请关闭其他标签页，清理会自动继续。`,
                'warning'
            );
        });
    }

    async function stopExternalBackup() {
        const service = global.ExternalBackupService;
        if (!service) return;
        if (typeof service.prepareForFullReset === 'function') {
            await service.prepareForFullReset();
        } else if (typeof service.unbindDirectory === 'function') {
            await service.unbindDirectory();
        }
    }

    function clearWebStorage() {
        const errors = [];
        for (const name of ['localStorage', 'sessionStorage']) {
            try {
                const storage = global[name];
                if (storage && typeof storage.clear === 'function') storage.clear();
            } catch (error) {
                errors.push({ stage: 'clear-web-storage', storage: name, error });
            }
        }
        return errors;
    }

    function reload(options) {
        if (options.reload === false) return false;
        if (!global.location || typeof global.location.reload !== 'function') return false;
        global.location.reload();
        return true;
    }

    async function perform(options = {}) {
        if (resetPromise) return resetPromise;
        resetPromise = (async () => {
            try {
                await stopExternalBackup();
            } catch (error) {
                notify('外部备份仍在写入，本次清理已取消。', 'error');
                return {
                    success: false,
                    reason: 'external_backup_busy',
                    terminal: false,
                    error,
                    databases: DATABASE_NAMES.slice(),
                    externalBackupFilesPreserved: true
                };
            }

            const results = await Promise.allSettled(DATABASE_NAMES.map(deleteDatabase));
            const errors = results.flatMap((result, index) => result.status === 'rejected'
                ? [{ stage: 'delete-database', database: DATABASE_NAMES[index], error: result.reason }]
                : []);
            errors.push(...clearWebStorage());
            if (errors.length) {
                notify('本地数据仅部分清除，请关闭其他标签页后重试。', 'error');
                return {
                    success: false,
                    reason: 'partial_reset',
                    terminal: false,
                    errors,
                    databases: DATABASE_NAMES.slice(),
                    externalBackupFilesPreserved: true
                };
            }

            return {
                success: true,
                terminal: reload(options),
                databases: DATABASE_NAMES.slice(),
                externalBackupFilesPreserved: true
            };
        })();

        try { return await resetPromise; }
        finally { resetPromise = null; }
    }

    async function request(options = {}) {
        let confirmed = options.confirmed === true;
        if (!confirmed) {
            try {
                confirmed = global.confirm(
                    '确定要清除全部浏览器本地数据并返回首次启动状态吗？\n\n'
                    + '练习记录、题库、词汇、设置、应用内备份和本地文件夹绑定都会清除；'
                    + '外部文件夹中的 JSON 备份不会删除。'
                );
            } catch (_) { confirmed = false; }
        }
        if (!confirmed) return { success: false, reason: 'cancelled', terminal: false };

        notify('正在清除全部本地数据...', 'info');
        try { return await perform(options); }
        catch (error) {
            if (global.console && typeof global.console.error === 'function') {
                global.console.error('[SiteDataReset] full reset failed:', error);
            }
            notify(`清除失败：${error && error.message ? error.message : '浏览器存储不可用'}`, 'error');
            return { success: false, reason: 'reset_failed', terminal: false, error };
        }
    }

    global.SiteDataReset = Object.freeze({ __v2: true, DATABASE_NAMES, perform, request });
    global.clearCache = request;
})(typeof window !== 'undefined' ? window : globalThis);
