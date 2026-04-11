const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

function loadUpdateServiceHelpers() {
    const originalLoad = Module._load;

    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === 'electron-updater') {
            return {
                autoUpdater: {
                    autoDownload: false,
                    autoInstallOnAppQuit: false,
                    on() {},
                    checkForUpdates() {
                        return Promise.resolve(null);
                    },
                    downloadUpdate() {
                        return Promise.resolve();
                    },
                    quitAndInstall() {}
                }
            };
        }

        if (request === 'electron') {
            return {
                app: {
                    getAppPath() {
                        return path.resolve('.');
                    },
                    getVersion() {
                        return '0.6.0';
                    }
                }
            };
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        return require(path.resolve('electron/update/updateService.js'));
    } finally {
        Module._load = originalLoad;
    }
}

function testExtractShellAssetCandidates() {
    const { extractShellAssetCandidates } = loadUpdateServiceHelpers();

    const candidates = extractShellAssetCandidates({
        path: 'https://example.com/download/app-0.7.0.zip.blockmap',
        files: [
            { url: 'https://example.com/download/app-0.7.0.zip.blockmap' },
            { path: 'app-0.7.0.zip' },
            { url: 'https://example.com/download/app-0.7.0.zip' }
        ]
    });

    assert.deepEqual(candidates, ['app-0.7.0.zip'], '应跳过 blockmap 并去重 shell 资产候选');
}

function testResolveShellSupportSkipsBrokenFirstCandidate() {
    const { resolveShellSupport } = loadUpdateServiceHelpers();

    const shellSupport = resolveShellSupport({
        assets: [
            { name: 'app-0.7.0.exe' },
            { name: 'app-0.7.0.exe.blockmap' }
        ]
    }, {
        files: [
            { path: 'missing-installer.exe' },
            { path: 'app-0.7.0.exe.blockmap' },
            { path: 'app-0.7.0.exe' }
        ]
    });

    assert.equal(shellSupport.assetName, 'app-0.7.0.exe', '不应死绑第一个错误候选资产');
    assert.equal(shellSupport.available, true, '存在可用安装包时应标记 available');
    assert.equal(shellSupport.downloadAllowed, true, '存在对应 blockmap 时应允许下载');
    assert.equal(shellSupport.blockedReason, null, '可下载资产不应保留 blockedReason');
}

async function testDownloadedShellStateSurvivesRecheck() {
    const { UpdateService } = loadUpdateServiceHelpers();

    const service = new UpdateService({
        app: {
            getPath() {
                return path.resolve('.tmp/test-user-data');
            },
            getVersion() {
                return '0.6.0';
            },
            isPackaged: true
        }
    });

    service.releaseClient = {
        getLatestRelease() {
            return Promise.resolve({
                tagName: 'v0.7.0',
                body: '',
                htmlUrl: '',
                publishedAt: '2026-04-11T00:00:00.000Z',
                fromCache: false,
                assets: [
                    { name: 'app-0.7.0.exe' },
                    { name: 'app-0.7.0.exe.blockmap' }
                ]
            });
        },
        findAsset(release, assetName) {
            return release.assets.find((asset) => asset.name === assetName) || null;
        },
        fetchJson() {
            return Promise.resolve({
                resourceVersion: 'v0.7.0',
                compatibleShellRange: '>=0.6.0',
                requiresShellUpdate: false,
                managedPrefixes: ['index.html'],
                packages: {
                    delta: {
                        assetName: 'resources-delta.zip',
                        mode: 'delta',
                        files: [],
                        managedPrefixes: ['index.html'],
                        integrity: { sha256: 'hash', size: 1 }
                    }
                }
            });
        }
    };
    service.overlayManager = {
        getCurrentResourceVersion() {
            return 'v0.6.0';
        }
    };
    service.evaluateResourceRelease = async function evaluateResourceRelease() {
        return {
            available: false,
            version: null,
            strategy: null,
            selectedAssetName: null,
            downloadAllowed: false,
            downloaded: false,
            requiresShellUpdate: false,
            compatible: true,
            baseMismatch: false,
            error: null
        };
    };
    service.evaluateShellRelease = async function evaluateShellRelease() {
        return {
            supported: true,
            available: true,
            version: 'v0.7.0',
            downloadAllowed: true,
            downloaded: false,
            assetName: 'app-0.7.0.exe',
            error: null
        };
    };

    service.rememberDownloadedShellUpdate({
        version: '0.7.0',
        files: [{ path: 'app-0.7.0.exe' }]
    });
    service.setState({
        status: 'ready-to-restart',
        shell: service.buildPendingShellState({
            supported: true,
            available: true,
            version: 'v0.7.0',
            downloadAllowed: false,
            downloaded: true,
            assetName: 'app-0.7.0.exe',
            error: null
        })
    });

    await service.performCheck({ manual: true });

    assert.equal(service.state.status, 'ready-to-restart', '重新检查后不应丢失 ready-to-restart');
    assert.equal(service.state.shell.downloaded, true, '重新检查后应保留已下载壳层状态');
    assert.equal(service.state.shell.downloadAllowed, false, '已下载壳层更新后不应再次允许下载');
    assert.equal(service.state.shell.version, 'v0.7.0', '重新检查后应保留已下载壳层版本');
}

function testSilentPrefetchAllowedWhenShellBlocked() {
    const { UpdateService } = loadUpdateServiceHelpers();

    const service = new UpdateService({
        app: {
            getPath() {
                return path.resolve('.tmp/test-user-data');
            },
            getVersion() {
                return '0.6.0';
            },
            getAppPath() {
                return path.resolve('.');
            },
            isPackaged: true
        }
    });

    const shouldPrefetchWhenShellBlocked = service.shouldSilentlyPrefetchResourceUpdate({
        manual: false,
        release: { fromCache: false },
        resourceState: {
            available: true,
            downloadAllowed: true,
            strategy: 'delta'
        },
        shellState: {
            available: true,
            downloadAllowed: false,
            downloaded: false
        }
    });

    const shouldBlockWhenShellDownloadable = service.shouldSilentlyPrefetchResourceUpdate({
        manual: false,
        release: { fromCache: false },
        resourceState: {
            available: true,
            downloadAllowed: true,
            strategy: 'delta'
        },
        shellState: {
            available: true,
            downloadAllowed: true,
            downloaded: false
        }
    });

    assert.equal(shouldPrefetchWhenShellBlocked, true, '壳层被策略阻断时，资源 delta 仍应允许静默预取');
    assert.equal(shouldBlockWhenShellDownloadable, false, '壳层可下载时不应静默预取资源更新');
}

async function testSilentResourcePrefetchPromotesReadyToReload() {
    const { UpdateService } = loadUpdateServiceHelpers();

    const service = new UpdateService({
        app: {
            getPath() {
                return path.resolve('.tmp/test-user-data');
            },
            getVersion() {
                return '0.6.0';
            },
            getAppPath() {
                return path.resolve('.');
            },
            isPackaged: true
        }
    });

    service.releaseClient = {
        downloadAsset() {
            return Promise.resolve('/tmp/resources-delta.zip');
        }
    };
    service.overlayManager = {
        createTemporaryArchivePath() {
            return Promise.resolve('/tmp/resources-delta.zip');
        },
        stageUpdate() {
            return Promise.resolve({
                stageRoot: '/tmp/stage-root',
                manifest: { resourceVersion: 'v0.7.0' },
                packageInfo: {
                    mode: 'delta',
                    assetName: 'resources-delta.zip'
                },
                metadataPath: '/tmp/stage-root/.overlay-manifest.json'
            });
        },
        getCurrentResourceVersion() {
            return 'v0.6.0';
        }
    };

    service.resourceReleaseContext = {
        manifest: { resourceVersion: 'v0.7.0' },
        packageInfo: {
            mode: 'delta',
            assetName: 'resources-delta.zip'
        },
        packageAsset: {
            name: 'resources-delta.zip',
            browserDownloadUrl: 'https://example.com/resources-delta.zip'
        }
    };
    service.setState({
        status: 'available',
        shell: {
            supported: true,
            available: false,
            version: null,
            downloadAllowed: false,
            downloaded: false,
            assetName: null,
            error: null
        },
        resource: {
            available: true,
            version: 'v0.7.0',
            strategy: 'delta',
            selectedAssetName: 'resources-delta.zip',
            downloadAllowed: true,
            downloaded: false,
            requiresShellUpdate: false,
            compatible: true,
            baseMismatch: false,
            error: null
        }
    });

    await service.downloadResourceUpdate({ silent: true });

    assert.equal(service.state.status, 'ready-to-reload', '静默预取完成后应直接进入 ready-to-reload');
    assert.equal(service.state.resource.downloaded, true, '静默预取完成后应保留 downloaded 标记');
    assert.equal(service.state.resource.downloadAllowed, false, '静默预取完成后不应继续允许下载');
}

async function testApplyResourceUpdateKeepsReloadPendingUntilRendererReady() {
    const { UpdateService } = loadUpdateServiceHelpers();

    let currentVersion = 'v0.6.0';
    let knownGoodMarked = 0;
    const service = new UpdateService({
        app: {
            getPath() {
                return path.resolve('.tmp/test-user-data');
            },
            getVersion() {
                return '0.6.0';
            },
            getAppPath() {
                return path.resolve('.');
            },
            isPackaged: true
        }
    });

    service.overlayManager = {
        activateStagedUpdate(stageInfo) {
            currentVersion = stageInfo.manifest.resourceVersion;
            return Promise.resolve();
        },
        markCurrentAsKnownGood() {
            knownGoodMarked += 1;
            return Promise.resolve();
        },
        getCurrentResourceVersion() {
            return currentVersion;
        }
    };
    service.pendingResourceStage = {
        archivePath: '/tmp/resources-delta.zip',
        stageRoot: '/tmp/stage-root',
        manifest: { resourceVersion: 'v0.7.0' },
        packageInfo: {
            mode: 'delta',
            assetName: 'resources-delta.zip'
        },
        metadataPath: '/tmp/stage-root/.overlay-manifest.json'
    };
    service.setState({
        status: 'ready-to-reload',
        shell: {
            supported: true,
            available: false,
            version: null,
            downloadAllowed: false,
            downloaded: false,
            assetName: null,
            error: null
        },
        resource: {
            available: true,
            version: 'v0.7.0',
            strategy: 'delta',
            selectedAssetName: 'resources-delta.zip',
            downloadAllowed: false,
            downloaded: true,
            requiresShellUpdate: false,
            compatible: true,
            baseMismatch: false,
            error: null
        }
    });

    const result = await service.applyResourceUpdate();

    assert.equal(result.reloadRequired, true, '应用资源更新后应要求 reload');
    assert.equal(result.resourceVersion, 'v0.7.0', '应用资源更新后应切到新资源版本');
    assert.equal(service.state.status, 'ready-to-reload', 'apply 后仍应保持 ready-to-reload');
    assert.equal(service.state.resource.downloaded, false, '资源更新激活后不应再保留 downloaded 标记');
    assert.equal(service.state.resource.version, 'v0.7.0', 'apply 后应保留待 reload 的资源版本');
    assert.equal(service.state.resource.strategy, 'delta', 'apply 后应保留待 reload 的资源策略');
    assert.equal(service.pendingResourceStage, null, 'apply 成功后应清空 staged update');
    assert.deepEqual(service.pendingResourceActivation, {
        version: 'v0.7.0',
        strategy: 'delta'
    }, 'apply 后应记录待 reload 的激活事实');

    await service.markResourceBootSuccessful();

    assert.equal(knownGoodMarked, 1, 'renderer ready 后应标记当前 overlay 为 known good');
    assert.equal(service.pendingResourceActivation, null, 'renderer ready 后应清除待 reload 事实');
    assert.equal(service.state.status, 'up-to-date', 'renderer ready 后应退出 ready-to-reload');
    assert.equal(service.state.resource.available, false, 'renderer ready 后不应继续保留本地资源更新可用态');
    assert.equal(service.state.resource.version, null, 'renderer ready 后应清空待 reload 的资源版本');
}

async function testInitializeRecoveredStageKeepsReadyToReload() {
    const { UpdateService } = loadUpdateServiceHelpers();

    let currentVersion = 'v0.6.0';
    const recoveredStage = {
        archivePath: '/tmp/resources-delta.zip',
        stageRoot: '/tmp/stage-root',
        manifest: {
            tag: 'v0.7.0',
            resourceVersion: 'v0.7.0'
        },
        packageInfo: {
            mode: 'delta',
            assetName: 'resources-delta.zip'
        },
        metadataPath: '/tmp/stage-root/.overlay-manifest.json'
    };
    const service = new UpdateService({
        app: {
            getPath() {
                return path.resolve('.tmp/test-user-data');
            },
            getVersion() {
                return '0.6.0';
            },
            getAppPath() {
                return path.resolve('.');
            },
            isPackaged: true
        }
    });

    service.overlayManager = {
        initialize() {
            return Promise.resolve();
        },
        recoverStagedUpdate() {
            return Promise.resolve(recoveredStage);
        },
        activateStagedUpdate(stageInfo) {
            currentVersion = stageInfo.manifest.resourceVersion;
            return Promise.resolve();
        },
        getCurrentResourceVersion() {
            return currentVersion;
        }
    };

    await service.initialize();

    assert.equal(service.pendingResourceStage, null, '启动自动激活后不应再保留 staged update');
    assert.deepEqual(service.pendingResourceActivation, {
        version: 'v0.7.0',
        strategy: 'delta'
    }, '启动恢复后应记录待 reload 的激活事实');
    assert.equal(service.state.status, 'ready-to-reload', '启动恢复已激活资源后应进入 ready-to-reload');
    assert.equal(service.state.latestReleaseTag, 'v0.7.0', '启动恢复后应保留这次资源更新的 release tag');
    assert.equal(service.state.resource.version, 'v0.7.0', '启动恢复后应暴露待 reload 的资源版本');
    assert.equal(service.state.resource.strategy, 'delta', '启动恢复后应暴露待 reload 的资源策略');
    assert.equal(service.state.resource.downloaded, false, '启动恢复已激活资源后不应误报为 downloaded');
}

async function testApplyResourceUpdatePreservesRestartPriority() {
    const { UpdateService } = loadUpdateServiceHelpers();

    let currentVersion = 'v0.6.0';
    const service = new UpdateService({
        app: {
            getPath() {
                return path.resolve('.tmp/test-user-data');
            },
            getVersion() {
                return '0.6.0';
            },
            getAppPath() {
                return path.resolve('.');
            },
            isPackaged: true
        }
    });

    service.overlayManager = {
        activateStagedUpdate(stageInfo) {
            currentVersion = stageInfo.manifest.resourceVersion;
            return Promise.resolve();
        },
        getCurrentResourceVersion() {
            return currentVersion;
        }
    };
    service.rememberDownloadedShellUpdate({
        version: '0.7.0',
        files: [{ path: 'app-0.7.0.exe' }]
    });
    service.pendingResourceStage = {
        archivePath: '/tmp/resources-delta.zip',
        stageRoot: '/tmp/stage-root',
        manifest: { resourceVersion: 'v0.7.0' },
        packageInfo: {
            mode: 'delta',
            assetName: 'resources-delta.zip'
        },
        metadataPath: '/tmp/stage-root/.overlay-manifest.json'
    };
    service.setState({
        status: 'ready-to-restart',
        shell: service.buildPendingShellState({
            supported: true,
            available: true,
            version: 'v0.7.0',
            downloadAllowed: false,
            downloaded: true,
            assetName: 'app-0.7.0.exe',
            error: null
        }),
        resource: {
            available: true,
            version: 'v0.7.0',
            strategy: 'delta',
            selectedAssetName: 'resources-delta.zip',
            downloadAllowed: false,
            downloaded: true,
            requiresShellUpdate: false,
            compatible: true,
            baseMismatch: false,
            error: null
        }
    });

    await service.applyResourceUpdate();

    assert.equal(service.state.status, 'ready-to-restart', '壳层已下载时，apply 资源更新后仍应优先保持 ready-to-restart');
    assert.equal(service.state.shell.downloaded, true, '壳层已下载状态不应被资源 apply 覆盖');
    assert.equal(service.state.resource.version, 'v0.7.0', '即使保持重启优先级，也应保留待 reload 的资源版本');
}

async function testAutomaticCheckSkippedWhenLocalTransitionPending() {
    const { UpdateService } = loadUpdateServiceHelpers();

    let latestReleaseRequests = 0;
    const service = new UpdateService({
        app: {
            getPath() {
                return path.resolve('.tmp/test-user-data');
            },
            getVersion() {
                return '0.6.0';
            },
            getAppPath() {
                return path.resolve('.');
            },
            isPackaged: true
        }
    });

    service.releaseClient = {
        getLatestRelease() {
            latestReleaseRequests += 1;
            return Promise.resolve({
                tagName: 'v0.7.0',
                assets: []
            });
        }
    };
    service.overlayManager = {
        getCurrentResourceVersion() {
            return 'v0.7.0';
        }
    };
    service.pendingResourceActivation = {
        version: 'v0.7.0',
        strategy: 'delta'
    };
    service.setState({
        status: 'ready-to-reload',
        lastCheckAt: '2026-04-11T00:00:00.000Z',
        shell: {
            supported: true,
            available: false,
            version: null,
            downloadAllowed: false,
            downloaded: false,
            assetName: null,
            error: null
        },
        resource: {
            available: true,
            version: 'v0.7.0',
            strategy: 'delta',
            selectedAssetName: null,
            downloadAllowed: false,
            downloaded: false,
            requiresShellUpdate: false,
            compatible: true,
            baseMismatch: false,
            error: null
        }
    });

    const nextState = await service.checkForUpdates({ manual: false });

    assert.equal(latestReleaseRequests, 0, '存在本地待切换更新时，自动检查不应触发远端请求');
    assert.equal(nextState.status, 'ready-to-reload', '自动检查跳过后应保留当前待切换状态');
}

async function testAutomaticCheckFailureKeepsStableState() {
    const { UpdateService } = loadUpdateServiceHelpers();

    const service = new UpdateService({
        app: {
            getPath() {
                return path.resolve('.tmp/test-user-data');
            },
            getVersion() {
                return '0.6.0';
            },
            getAppPath() {
                return path.resolve('.');
            },
            isPackaged: true
        }
    });

    service.releaseClient = {
        getLatestRelease() {
            return Promise.reject(new Error('network down'));
        }
    };
    service.overlayManager = {
        getCurrentResourceVersion() {
            return 'v0.6.0';
        }
    };
    service.setState({
        status: 'available',
        lastCheckAt: '2026-04-10T00:00:00.000Z',
        error: null,
        shell: {
            supported: true,
            available: true,
            version: 'v0.7.0',
            downloadAllowed: true,
            downloaded: false,
            assetName: 'app-0.7.0.exe',
            error: null
        },
        resource: {
            available: false,
            version: null,
            strategy: null,
            selectedAssetName: null,
            downloadAllowed: false,
            downloaded: false,
            requiresShellUpdate: false,
            compatible: true,
            baseMismatch: false,
            error: null
        }
    });

    const previousLastCheckAt = service.state.lastCheckAt;
    const nextState = await service.checkForUpdates({ manual: false });

    assert.equal(nextState.status, 'available', '后台自动检查失败时应回到上一个稳定状态');
    assert.equal(nextState.error, null, '后台自动检查失败时不应把错误直接暴露到 UI');
    assert.equal(nextState.shell.available, true, '后台自动检查失败时不应清空已知壳层可用态');
    assert.equal(nextState.shell.downloadAllowed, true, '后台自动检查失败时不应清空已知壳层下载能力');
    assert.notEqual(nextState.lastCheckAt, previousLastCheckAt, '后台自动检查失败时仍应刷新最后检查时间用于节流');
}

function main() {
    testExtractShellAssetCandidates();
    testResolveShellSupportSkipsBrokenFirstCandidate();
    testSilentPrefetchAllowedWhenShellBlocked();
    return testDownloadedShellStateSurvivesRecheck().then(() => {
        return testSilentResourcePrefetchPromotesReadyToReload();
    }).then(() => {
        return testApplyResourceUpdateKeepsReloadPendingUntilRendererReady();
    }).then(() => {
        return testInitializeRecoveredStageKeepsReadyToReload();
    }).then(() => {
        return testApplyResourceUpdatePreservesRestartPriority();
    }).then(() => {
        return testAutomaticCheckSkippedWhenLocalTransitionPending();
    }).then(() => {
        return testAutomaticCheckFailureKeepsStableState();
    }).then(() => {
        console.log('Shell support smoke passed.');
    });
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
