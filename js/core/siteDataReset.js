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

    function getFullResetService() {
        let service;
        try { service = global.ExternalBackupService; }
        catch (error) { return { service: null, error }; }

        if (!service) {
            return {
                service: null,
                error: new Error('外部备份服务不可用，无法建立跨标签安全锁')
            };
        }

        for (const method of [
            'withFullResetLock',
            'prepareForFullReset',
            'commitFullResetPreparation',
            'rollbackFullResetPreparation'
        ]) {
            let implementation;
            try { implementation = service[method]; }
            catch (error) { return { service: null, error }; }
            if (typeof implementation !== 'function') {
                return {
                    service: null,
                    error: new Error(`外部备份服务缺少全量清理接口：${method}`)
                };
            }
        }

        return { service };
    }

    function isSuccessfulPreparation(result) {
        return result === true || !!(result && result.success === true);
    }

    function isExplicitFailure(result) {
        return result === false || !!(result && result.success === false);
    }

    function resultError(result, fallbackMessage) {
        return (result && result.error) || new Error(fallbackMessage);
    }

    function externalBackupFailure(error, message) {
        notify(message, 'error');
        return {
            success: false,
            reason: 'external_backup_busy',
            terminal: false,
            retryable: true,
            error,
            databases: DATABASE_NAMES.slice(),
            externalBackupFilesPreserved: true
        };
    }

    async function rollbackFullResetPreparation(service) {
        try {
            const result = await service.rollbackFullResetPreparation();
            if (isExplicitFailure(result)) {
                return [{
                    stage: 'rollback-full-reset-preparation',
                    error: resultError(result, '外部备份清理准备回滚失败')
                }];
            }
        } catch (error) {
            return [{ stage: 'rollback-full-reset-preparation', error }];
        }
        return [];
    }

    function clearWebStorage() {
        const errors = [];
        for (const name of ['localStorage', 'sessionStorage']) {
            try {
                const storage = global[name];
                if (!storage || typeof storage.clear !== 'function') {
                    errors.push({
                        stage: 'clear-web-storage',
                        storage: name,
                        error: new Error(`无法清理 ${name}：Storage 接口不可用`)
                    });
                    continue;
                }
                storage.clear();
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

    async function performLocked(service) {
        let preparation;
        try {
            preparation = await service.prepareForFullReset({ lockHeld: true });
        } catch (error) {
            const rollbackErrors = await rollbackFullResetPreparation(service);
            const result = externalBackupFailure(
                error,
                '外部备份未能安全落盘，本次清理已取消。'
            );
            if (rollbackErrors.length) result.errors = rollbackErrors;
            return result;
        }

        if (!isSuccessfulPreparation(preparation)) {
            const rollbackErrors = await rollbackFullResetPreparation(service);
            const result = externalBackupFailure(
                resultError(preparation, '外部备份未能在清理前完成写盘'),
                '外部备份未能安全落盘，本次清理已取消。'
            );
            if (rollbackErrors.length) result.errors = rollbackErrors;
            return result;
        }

        const errors = [];
        let deletionResults;
        try {
            deletionResults = await Promise.allSettled(DATABASE_NAMES.map(deleteDatabase));
        } catch (error) {
            errors.push({ stage: 'delete-database', error });
        }

        if (deletionResults) {
            deletionResults.forEach((result, index) => {
                if (result.status === 'rejected') {
                    errors.push({
                        stage: 'delete-database',
                        database: DATABASE_NAMES[index],
                        error: result.reason
                    });
                    return;
                }

                const deletion = result.value;
                if (deletion && deletion.skipped === true) {
                    errors.push({
                        stage: 'delete-database',
                        database: DATABASE_NAMES[index],
                        skipped: true,
                        error: deletion.error || new Error(
                            `IndexedDB 删除已跳过：${DATABASE_NAMES[index]}`
                        )
                    });
                    return;
                }
                if (!deletion || deletion.deleted !== true) {
                    errors.push({
                        stage: 'delete-database',
                        database: DATABASE_NAMES[index],
                        error: new Error(`IndexedDB 未确认删除：${DATABASE_NAMES[index]}`)
                    });
                }
            });
        }

        try { errors.push(...clearWebStorage()); }
        catch (error) {
            errors.push({ stage: 'clear-web-storage', error });
        }

        if (errors.length) {
            const rollbackErrors = await rollbackFullResetPreparation(service);
            notify(
                '本地数据仅部分清除（数据库删除失败或被跳过，或 web storage 清理失败），'
                + '请关闭其他标签页后重试。',
                'error'
            );
            return {
                success: false,
                reason: 'partial_reset',
                terminal: false,
                retryable: true,
                errors: errors.concat(rollbackErrors),
                databases: DATABASE_NAMES.slice(),
                externalBackupFilesPreserved: true
            };
        }

        try {
            const commitResult = await service.commitFullResetPreparation();
            if (isExplicitFailure(commitResult)) {
                throw resultError(commitResult, '外部备份清理准备提交失败');
            }
        } catch (error) {
            const rollbackErrors = await rollbackFullResetPreparation(service);
            notify('外部备份清理提交失败，本次清理需要重试。', 'error');
            return {
                success: false,
                reason: 'partial_reset',
                terminal: false,
                retryable: true,
                errors: [{ stage: 'commit-full-reset-preparation', error }].concat(rollbackErrors),
                databases: DATABASE_NAMES.slice(),
                externalBackupFilesPreserved: true
            };
        }

        return {
            success: true,
            terminal: false,
            databases: DATABASE_NAMES.slice(),
            externalBackupFilesPreserved: true
        };
    }

    function perform(options = {}) {
        if (resetPromise) return resetPromise;
        const run = (async () => {
            const serviceInfo = getFullResetService();
            if (!serviceInfo.service) {
                return externalBackupFailure(
                    serviceInfo.error,
                    '外部备份服务或跨标签安全锁不可用，本次清理已取消。'
                );
            }

            let callbackEntered = false;
            let result;
            try {
                result = await serviceInfo.service.withFullResetLock(async () => {
                    callbackEntered = true;
                    return performLocked(serviceInfo.service);
                });
            } catch (error) {
                return externalBackupFailure(
                    error,
                    '外部备份跨标签安全锁不可用，本次清理已取消。'
                );
            }

            if (!callbackEntered || typeof result === 'undefined') {
                return externalBackupFailure(
                    new Error('外部备份服务未能提供跨标签安全锁'),
                    '外部备份跨标签安全锁不可用，本次清理已取消。'
                );
            }

            if (result && result.success === true) result.terminal = reload(options);
            return result;
        })();
        resetPromise = run;
        const clearResetPromise = () => {
            if (resetPromise === run) resetPromise = null;
        };
        run.then(clearResetPromise, clearResetPromise);
        return run;
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
