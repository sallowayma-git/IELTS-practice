const path = require('node:path');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const semver = require('semver');
const { autoUpdater } = require('electron-updater');
const { getAppConfig } = require('../appConfig');
const { GitHubReleaseClient } = require('./releaseClient');
const { DEFAULT_MANAGED_PREFIXES, ResourceOverlayManager } = require('./resourceOverlayManager');

function normalizeTagVersion(value) {
    if (!value) {
        return null;
    }
    const cleaned = semver.clean(String(value));
    return cleaned || null;
}

function toTaggedVersion(value) {
    const cleaned = normalizeTagVersion(value);
    return cleaned ? `v${cleaned}` : null;
}

function compareTaggedVersions(a, b) {
    const left = normalizeTagVersion(a);
    const right = normalizeTagVersion(b);
    if (!left || !right) {
        return 0;
    }
    return semver.compare(left, right);
}

function extractAssetNameFromUrl(rawUrl) {
    if (!rawUrl) {
        return null;
    }

    try {
        const parsed = new URL(rawUrl);
        return path.basename(decodeURIComponent(parsed.pathname));
    } catch (_) {
        return path.basename(String(rawUrl));
    }
}

function isBlockmapAssetName(assetName) {
    return !!(assetName && String(assetName).toLowerCase().endsWith('.blockmap'));
}

function appendShellAssetCandidate(rawValue, candidates, seen) {
    const assetName = extractAssetNameFromUrl(rawValue);
    if (!assetName || isBlockmapAssetName(assetName) || seen.has(assetName)) {
        return;
    }

    seen.add(assetName);
    candidates.push(assetName);
}

function extractShellAssetCandidates(updateInfo = {}) {
    const candidates = [];
    const seen = new Set();

    appendShellAssetCandidate(updateInfo.path, candidates, seen);
    appendShellAssetCandidate(updateInfo.url, candidates, seen);

    const updateFiles = Array.isArray(updateInfo.files) ? updateInfo.files : [];
    for (const fileEntry of updateFiles) {
        appendShellAssetCandidate(fileEntry?.url, candidates, seen);
        appendShellAssetCandidate(fileEntry?.path, candidates, seen);
    }

    return candidates;
}

function normalizePackageIntegrity(integrity = {}) {
    if (!integrity || typeof integrity !== 'object') {
        return null;
    }

    const normalized = {};
    if (integrity.sha256) {
        normalized.sha256 = String(integrity.sha256);
    }

    const size = Number(integrity.size);
    if (Number.isFinite(size) && size >= 0) {
        normalized.size = size;
    }

    return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizePackageDescriptor(candidate, fallback = {}) {
    if (!candidate || typeof candidate !== 'object') {
        return null;
    }

    const fallbackMode = fallback.mode === 'full' ? 'full' : 'delta';
    return {
        assetName: candidate.assetName || fallback.assetName || null,
        mode: candidate.mode === 'full' ? 'full' : (candidate.mode === 'delta' ? 'delta' : fallbackMode),
        baseResourceVersion: candidate.baseResourceVersion || fallback.baseResourceVersion || null,
        managedPrefixes: candidate.managedPrefixes || fallback.managedPrefixes || DEFAULT_MANAGED_PREFIXES,
        files: Array.isArray(candidate.files) ? candidate.files : (Array.isArray(fallback.files) ? fallback.files : []),
        integrity: normalizePackageIntegrity(candidate.integrity)
    };
}

function normalizeResourceManifest(manifest = {}, config = {}) {
    const managedPrefixes = Array.isArray(manifest.managedPrefixes) && manifest.managedPrefixes.length > 0
        ? manifest.managedPrefixes
        : DEFAULT_MANAGED_PREFIXES;

    const legacyDeltaFiles = Array.isArray(manifest.files) ? manifest.files : [];
    const legacyDeltaAssetName = config.resourceDeltaAssetName || 'resources-delta.zip';
    const fullAssetName = config.resourceFullAssetName || 'resources-full.zip';
    const fullPackageFromRoot = manifest.fullPackage && typeof manifest.fullPackage === 'object'
        ? manifest.fullPackage
        : null;
    const fullPackageSource = (manifest.packages && manifest.packages.full) || fullPackageFromRoot;

    return {
        ...manifest,
        managedPrefixes,
        packages: {
            delta: normalizePackageDescriptor((manifest.packages && manifest.packages.delta) || {}, {
                assetName: legacyDeltaAssetName,
                mode: 'delta',
                baseResourceVersion: manifest.baseResourceVersion || null,
                    managedPrefixes,
                    files: legacyDeltaFiles
                }),
            full: fullPackageSource
                ? normalizePackageDescriptor(fullPackageSource, {
                    assetName: fullAssetName,
                    mode: 'full',
                    baseResourceVersion: null,
                    managedPrefixes,
                    files: []
                })
                : null
        }
    };
}

function hasMatchingBlockmap(assetName, assetNameSet) {
    if (!assetName) {
        return false;
    }
    if (assetNameSet.has(`${assetName}.blockmap`)) {
        return true;
    }
    const basename = path.basename(assetName);
    return assetNameSet.has(`${basename}.blockmap`);
}

function analyzeShellAsset(release = {}, assetName) {
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const assetNames = assets
        .map((asset) => (asset && asset.name ? asset.name : null))
        .filter(Boolean);
    const assetNameSet = new Set(assetNames);

    if (!assetName) {
        return {
            assetName: null,
            available: false,
            downloadAllowed: false,
            blockedReason: 'update metadata 缺少壳层资产路径'
        };
    }

    const available = assetNameSet.has(assetName);
    const downloadAllowed = available && hasMatchingBlockmap(assetName, assetNameSet);

    return {
        assetName,
        available,
        downloadAllowed,
        blockedReason: available
            ? (downloadAllowed ? null : '缺少平台差分 blockmap 资产')
            : `Release 缺少 update metadata 指向的壳层资产: ${assetName}`
    };
}

function resolveShellSupport(release = {}, updateInfo = {}) {
    const candidates = extractShellAssetCandidates(updateInfo);
    if (candidates.length === 0) {
        return analyzeShellAsset(release, null);
    }

    let fallbackSupport = null;
    for (const assetName of candidates) {
        const shellSupport = analyzeShellAsset(release, assetName);
        if (!fallbackSupport) {
            fallbackSupport = shellSupport;
        }
        if (shellSupport.available) {
            return shellSupport;
        }
    }

    return fallbackSupport;
}

function normalizeDownloadedShellUpdate(updateInfo = {}, fallback = {}) {
    const version = toTaggedVersion(
        updateInfo?.version
        || fallback.version
        || null
    );
    const assetCandidates = extractShellAssetCandidates(updateInfo);
    const assetName = assetCandidates[0] || fallback.assetName || null;

    if (!version && !assetName) {
        return null;
    }

    return {
        version,
        assetName
    };
}

async function removeFileIfExists(filePath) {
    if (!filePath) {
        return;
    }
    await fs.promises.rm(filePath, { force: true }).catch(() => {});
}

class UpdateService extends EventEmitter {
    constructor(options = {}) {
        super();
        this.app = options.app;
        this.config = getAppConfig();
        const updateCacheRoot = path.join(this.app.getPath('userData'), 'updates');
        this.releaseClient = new GitHubReleaseClient({
            owner: this.config.repository.owner,
            repo: this.config.repository.repo,
            cacheFilePath: path.join(updateCacheRoot, 'latest-release-cache.json'),
            minRequestIntervalMs: 30 * 1000,
            allowCachedOnError: true,
            resourceManifestAssetName: this.config.resourceManifestAssetName,
            resourceDeltaAssetName: this.config.resourceDeltaAssetName,
            resourceFullAssetName: this.config.resourceFullAssetName
        });
        this.overlayManager = new ResourceOverlayManager({
            app: this.app,
            defaultResourceVersion: this.config.defaultResourceVersion,
            defaultManagedPrefixes: DEFAULT_MANAGED_PREFIXES
        });

        this.currentCheckPromise = null;
        this.currentResourceDownloadPromise = null;
        this.currentResourcePrefetchPromise = null;
        this.pendingResourceStage = null;
        this.pendingResourceActivation = null;
        this.downloadedShellUpdate = null;
        this.resourceReleaseContext = null;
        this.currentRelease = null;
        this.isShellUpdaterEnabled = this.app.isPackaged;

        this.state = {
            isElectron: true,
            status: 'idle',
            appVersion: this.config.appVersion,
            resourceVersion: this.config.defaultResourceVersion,
            latestReleaseTag: null,
            releaseNotes: '',
            releasePageUrl: '',
            publishedAt: null,
            lastCheckAt: null,
            usedCachedRelease: false,
            error: null,
            shell: {
                supported: this.isShellUpdaterEnabled,
                available: false,
                version: null,
                downloadAllowed: false,
                downloaded: false,
                assetName: null,
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
        };

        this.bindAutoUpdaterEvents();
    }

    bindAutoUpdaterEvents() {
        autoUpdater.autoDownload = false;
        autoUpdater.autoInstallOnAppQuit = false;
        autoUpdater.on('download-progress', () => {
            this.setState({ status: 'downloading' });
        });
        autoUpdater.on('update-downloaded', (event) => {
            this.rememberDownloadedShellUpdate(event, {
                version: this.state.shell.version || this.currentRelease?.tagName || null,
                assetName: this.state.shell.assetName || null
            });
            this.setState({
                status: 'ready-to-restart',
                shell: this.buildPendingShellState({
                    ...this.state.shell,
                    downloadAllowed: false,
                    downloaded: true
                })
            });
        });
    }

    buildPendingResourceState(resourcePatch = {}) {
        if (!this.pendingResourceStage) {
            if (!this.pendingResourceActivation) {
                return resourcePatch;
            }

            return {
                ...resourcePatch,
                available: true,
                version: this.pendingResourceActivation.version || resourcePatch.version || this.overlayManager.getCurrentResourceVersion() || null,
                strategy: this.pendingResourceActivation.strategy || resourcePatch.strategy || null,
                selectedAssetName: null,
                downloadAllowed: false,
                downloaded: false,
                requiresShellUpdate: false,
                compatible: true,
                baseMismatch: false,
                error: null
            };
        }

        return {
            ...resourcePatch,
            available: true,
            version: this.pendingResourceStage.manifest?.resourceVersion || resourcePatch.version || null,
            strategy: this.pendingResourceStage.packageInfo?.mode || resourcePatch.strategy || null,
            selectedAssetName: this.pendingResourceStage.packageInfo?.assetName || resourcePatch.selectedAssetName || null,
            downloadAllowed: false,
            downloaded: true,
            error: null
        };
    }

    rememberDownloadedShellUpdate(updateInfo = {}, fallback = {}) {
        this.downloadedShellUpdate = normalizeDownloadedShellUpdate(updateInfo, fallback);
        return this.downloadedShellUpdate;
    }

    buildPendingShellState(shellPatch = {}) {
        if (!this.downloadedShellUpdate) {
            return shellPatch;
        }

        return {
            ...shellPatch,
            available: true,
            version: this.downloadedShellUpdate.version || shellPatch.version || null,
            downloadAllowed: false,
            downloaded: true,
            assetName: this.downloadedShellUpdate.assetName || shellPatch.assetName || null,
            error: null
        };
    }

    getPendingResourceVersion() {
        return this.pendingResourceStage?.manifest?.resourceVersion || this.pendingResourceActivation?.version || null;
    }

    hasPendingLocalUpdateAction() {
        return !!(this.pendingResourceStage || this.pendingResourceActivation || this.downloadedShellUpdate);
    }

    rememberPendingResourceActivation(stageInfo = {}) {
        const resourceVersion = stageInfo.manifest?.resourceVersion || this.overlayManager.getCurrentResourceVersion() || null;
        if (!resourceVersion) {
            this.pendingResourceActivation = null;
            return null;
        }

        this.pendingResourceActivation = {
            version: resourceVersion,
            strategy: stageInfo.packageInfo?.mode === 'full' ? 'full' : 'delta'
        };
        return this.pendingResourceActivation;
    }

    async activateRecoveredResourceUpdate() {
        if (!this.pendingResourceStage) {
            return false;
        }

        const { archivePath, ...stageInfo } = this.pendingResourceStage;
        try {
            await this.overlayManager.activateStagedUpdate(stageInfo);
            this.rememberPendingResourceActivation(stageInfo);
            await removeFileIfExists(archivePath);
            this.pendingResourceStage = null;
            return true;
        } catch (error) {
            console.warn('[Updater] 启动时自动激活暂存资源更新失败:', error);
            this.pendingResourceStage = {
                archivePath,
                ...stageInfo
            };
            return false;
        }
    }

    shouldSilentlyPrefetchResourceUpdate({ manual, release, resourceState, shellState }) {
        if (manual || this.pendingResourceStage || this.pendingResourceActivation || this.currentResourcePrefetchPromise) {
            return false;
        }
        if (!release || release.fromCache) {
            return false;
        }
        if (shellState.downloadAllowed || shellState.downloaded || !resourceState.available || !resourceState.downloadAllowed) {
            return false;
        }
        return resourceState.strategy === 'delta';
    }

    async initialize() {
        await this.overlayManager.initialize();
        this.pendingResourceStage = await this.overlayManager.recoverStagedUpdate();
        const recoveredReleaseTag = this.pendingResourceStage?.manifest?.tag || this.pendingResourceStage?.manifest?.resourceVersion || null;
        await this.activateRecoveredResourceUpdate();
        this.setState({
            status: (this.pendingResourceStage || this.pendingResourceActivation) ? 'ready-to-reload' : this.state.status,
            appVersion: this.app.getVersion(),
            resourceVersion: this.overlayManager.getCurrentResourceVersion(),
            latestReleaseTag: recoveredReleaseTag || this.pendingResourceActivation?.version || null,
            shell: {
                ...this.state.shell,
                supported: this.isShellUpdaterEnabled
            },
            resource: this.buildPendingResourceState({
                ...this.state.resource,
                version: this.getPendingResourceVersion()
            })
        });
    }

    getState() {
        return JSON.parse(JSON.stringify(this.state));
    }

    setState(patch = {}) {
        this.state = {
            ...this.state,
            ...patch,
            appVersion: this.app.getVersion(),
            resourceVersion: this.overlayManager.getCurrentResourceVersion(),
            shell: {
                ...this.state.shell,
                ...(patch.shell || {})
            },
            resource: {
                ...this.state.resource,
                ...(patch.resource || {})
            }
        };
        this.emit('state-changed', this.getState());
    }

    async checkForUpdates(options = {}) {
        if (this.currentCheckPromise) {
            return this.currentCheckPromise;
        }

        const manual = !!options.manual;
        if (!manual && this.hasPendingLocalUpdateAction()) {
            return this.getState();
        }

        this.currentCheckPromise = this.performCheck({ manual }).finally(() => {
            this.currentCheckPromise = null;
        });
        return this.currentCheckPromise;
    }

    async performCheck({ manual }) {
        const stableState = this.getState();
        this.resourceReleaseContext = null;
        this.setState({
            status: 'checking',
            error: null,
            shell: {
                supported: this.isShellUpdaterEnabled,
                available: false,
                version: this.downloadedShellUpdate?.version || null,
                downloadAllowed: false,
                downloaded: !!this.downloadedShellUpdate,
                assetName: this.downloadedShellUpdate?.assetName || null,
                error: null
            },
            resource: {
                available: false,
                version: this.getPendingResourceVersion(),
                strategy: null,
                selectedAssetName: null,
                downloadAllowed: false,
                downloaded: !!this.pendingResourceStage,
                requiresShellUpdate: false,
                compatible: true,
                baseMismatch: false,
                error: null
            }
        });

        try {
            const release = await this.releaseClient.getLatestRelease({
                forceNetwork: manual,
                allowCachedOnError: true
            });
            this.currentRelease = release;

            let [resourceState, shellState] = await Promise.all([
                this.evaluateResourceRelease(release),
                this.evaluateShellRelease(release)
            ]);
            resourceState = this.buildPendingResourceState(resourceState);
            shellState = this.buildPendingShellState(shellState);

            const nextStatus = this.resolveIdleStatus(resourceState, shellState);
            this.setState({
                status: nextStatus,
                latestReleaseTag: release.tagName || null,
                releaseNotes: release.body || '',
                releasePageUrl: release.htmlUrl || '',
                publishedAt: release.publishedAt || null,
                lastCheckAt: new Date().toISOString(),
                usedCachedRelease: !!release.fromCache,
                error: null,
                shell: shellState,
                resource: resourceState
            });

            if (this.shouldSilentlyPrefetchResourceUpdate({ manual, release, resourceState, shellState })) {
                this.silentlyPrefetchResourceUpdate(resourceState, shellState);
            }

            return this.getState();
        } catch (error) {
            if (!manual) {
                this.setState({
                    status: stableState.status,
                    lastCheckAt: new Date().toISOString(),
                    error: null,
                    shell: stableState.shell,
                    resource: stableState.resource
                });
                return this.getState();
            }

            this.setState({
                status: 'error',
                lastCheckAt: new Date().toISOString(),
                error: error?.message || String(error)
            });
            throw error;
        }
    }

    resolveIdleStatus(resourceState, shellState) {
        if (shellState.downloaded) {
            return 'ready-to-restart';
        }
        if (this.pendingResourceStage || this.pendingResourceActivation) {
            return 'ready-to-reload';
        }
        if (shellState.available || resourceState.available) {
            return 'available';
        }
        return 'up-to-date';
    }

    buildFullFallbackPackage(manifest) {
        return manifest.packages && manifest.packages.full ? manifest.packages.full : null;
    }

    selectResourcePackage(manifest) {
        const currentResourceVersion = this.overlayManager.getCurrentResourceVersion();
        const deltaPackage = manifest.packages && manifest.packages.delta ? manifest.packages.delta : null;
        const fallbackFullPackage = this.buildFullFallbackPackage(manifest);
        const deltaBaseMismatch = !!(deltaPackage && deltaPackage.baseResourceVersion && deltaPackage.baseResourceVersion !== currentResourceVersion);

        if (deltaPackage && !deltaBaseMismatch) {
            return {
                packageInfo: deltaPackage,
                strategy: deltaPackage.mode || 'delta',
                baseMismatch: false
            };
        }

        if (fallbackFullPackage) {
            return {
                packageInfo: fallbackFullPackage,
                strategy: fallbackFullPackage.mode || 'full',
                baseMismatch: deltaBaseMismatch
            };
        }

        return {
            packageInfo: null,
            strategy: null,
            baseMismatch: deltaBaseMismatch
        };
    }

    resolveResourcePackageAsset(release, selectedResourcePackage) {
        if (!selectedResourcePackage || !selectedResourcePackage.packageInfo) {
            return null;
        }

        const selectedAssetName = selectedResourcePackage.packageInfo.assetName;
        if (!selectedAssetName) {
            return null;
        }
        return this.releaseClient.findAsset(release, selectedAssetName);
    }

    async evaluateResourceRelease(release) {
        const manifestAsset = this.releaseClient.findAsset(release, this.config.resourceManifestAssetName);
        if (!manifestAsset) {
            return {
                ...this.state.resource,
                available: false,
                version: null,
                strategy: null,
                selectedAssetName: null,
                downloadAllowed: false,
                error: null
            };
        }

        const manifest = normalizeResourceManifest(
            release.resourceManifest || await this.releaseClient.fetchJson(manifestAsset.browserDownloadUrl),
            this.config
        );
        const nextResourceVersion = manifest.resourceVersion || release.tagName || null;
        const compatible = manifest.compatibleShellRange
            ? semver.satisfies(normalizeTagVersion(this.app.getVersion()) || this.app.getVersion(), manifest.compatibleShellRange)
            : true;
        const requiresShellUpdate = !!manifest.requiresShellUpdate;
        const hasNewVersion = compareTaggedVersions(nextResourceVersion, this.overlayManager.getCurrentResourceVersion()) > 0;
        let selectedResourcePackage = this.selectResourcePackage(manifest);
        let packageAsset = this.resolveResourcePackageAsset(release, selectedResourcePackage);
        if (!packageAsset && selectedResourcePackage.strategy === 'delta') {
            const fullFallbackPackage = this.buildFullFallbackPackage(manifest);
            if (fullFallbackPackage) {
                const fallbackSelection = {
                    packageInfo: fullFallbackPackage,
                    strategy: 'full',
                    baseMismatch: selectedResourcePackage.baseMismatch
                };
                const fallbackAsset = this.resolveResourcePackageAsset(release, fallbackSelection);
                if (fallbackAsset) {
                    selectedResourcePackage = fallbackSelection;
                    packageAsset = fallbackAsset;
                }
            }
        }
        const baseMismatch = !!selectedResourcePackage.baseMismatch;
        const hasIntegrity = !!selectedResourcePackage.packageInfo?.integrity;
        const downloadAllowed = hasNewVersion && compatible && !requiresShellUpdate && hasIntegrity && !!selectedResourcePackage.packageInfo && !!packageAsset;
        let resourceError = null;
        if (hasNewVersion) {
            if (requiresShellUpdate) {
                resourceError = '资源包要求壳层升级';
            } else if (!compatible) {
                resourceError = '当前壳层版本不满足资源兼容范围';
            } else if (!selectedResourcePackage.packageInfo) {
                resourceError = 'Release 缺少可用的资源包描述';
            } else if (!hasIntegrity) {
                resourceError = '资源包缺少完整性校验元数据';
            } else if (!packageAsset) {
                resourceError = 'Release 缺少 manifest 指向的资源包资产';
            }
        }

        this.resourceReleaseContext = {
            release,
            manifest,
            manifestAsset,
            packageInfo: selectedResourcePackage.packageInfo,
            packageAsset
        };

        return {
            available: hasNewVersion,
            version: nextResourceVersion,
            strategy: selectedResourcePackage.strategy,
            selectedAssetName: packageAsset ? packageAsset.name : null,
            downloadAllowed,
            downloaded: false,
            requiresShellUpdate,
            compatible,
            baseMismatch,
            error: resourceError
        };
    }

    async buildShellSupport(release, updateInfo) {
        const shellSupport = resolveShellSupport(release, updateInfo);
        if (shellSupport.available || release?.source === 'api') {
            return shellSupport;
        }
        if (typeof this.releaseClient.checkLatestReleaseAsset !== 'function') {
            return shellSupport;
        }

        if (!shellSupport.assetName) {
            return shellSupport;
        }

        const assetExists = await this.releaseClient.checkLatestReleaseAsset(shellSupport.assetName);
        const blockmapExists = assetExists
            ? await this.releaseClient.checkLatestReleaseAsset(`${shellSupport.assetName}.blockmap`)
            : false;

        return {
            assetName: shellSupport.assetName,
            available: assetExists,
            downloadAllowed: assetExists && blockmapExists,
            blockedReason: assetExists
                ? (blockmapExists ? null : '缺少平台差分 blockmap 资产')
                : `latest release 缺少壳层资产: ${shellSupport.assetName}`
        };
    }

    silentlyPrefetchResourceUpdate(resourceState, shellState) {
        if (this.currentResourcePrefetchPromise) {
            return this.currentResourcePrefetchPromise;
        }

        const stableResourceState = JSON.parse(JSON.stringify(resourceState));
        const stableShellState = JSON.parse(JSON.stringify(shellState));
        this.currentResourcePrefetchPromise = this.downloadResourceUpdate({ silent: true }).catch((error) => {
            console.warn('[Updater] 静默预取资源更新失败:', error);
            if (!this.pendingResourceStage) {
                this.setState({
                    status: this.resolveIdleStatus(stableResourceState, stableShellState),
                    error: null,
                    shell: stableShellState,
                    resource: stableResourceState
                });
            }
            return this.getState();
        }).finally(() => {
            this.currentResourcePrefetchPromise = null;
        });
        return this.currentResourcePrefetchPromise;
    }

    async evaluateShellRelease(release) {
        if (!this.isShellUpdaterEnabled) {
            return {
                supported: false,
                available: false,
                version: null,
                downloadAllowed: false,
                downloaded: false,
                assetName: null,
                error: null
            };
        }

        const latestReleaseVersion = normalizeTagVersion(release.tagName);
        const currentVersion = normalizeTagVersion(this.app.getVersion());
        if (!latestReleaseVersion || !currentVersion || !semver.gt(latestReleaseVersion, currentVersion)) {
            return {
                supported: true,
                available: false,
                version: null,
                downloadAllowed: false,
                downloaded: false,
                assetName: null,
                error: null
            };
        }

        try {
            const updateResult = await autoUpdater.checkForUpdates();
            const updateInfo = updateResult && updateResult.updateInfo ? updateResult.updateInfo : null;
            const targetVersion = normalizeTagVersion(updateInfo?.version) || latestReleaseVersion;
            const hasUpdateInfo = !!(targetVersion && currentVersion && semver.gt(targetVersion, currentVersion));
            if (!hasUpdateInfo) {
                return {
                    supported: true,
                    available: false,
                    version: null,
                    downloadAllowed: false,
                    downloaded: false,
                    assetName: null,
                    error: null
                };
            }

            const shellSupport = await this.buildShellSupport(release, updateInfo);
            const effectiveError = shellSupport.available
                ? (shellSupport.downloadAllowed ? null : (shellSupport.blockedReason || '当前平台缺少差分更新资产'))
                : (shellSupport.blockedReason || '当前平台缺少壳层更新资产');

            return {
                supported: true,
                available: shellSupport.available,
                version: toTaggedVersion(targetVersion),
                downloadAllowed: shellSupport.downloadAllowed && !this.downloadedShellUpdate,
                downloaded: false,
                assetName: shellSupport.assetName,
                error: effectiveError
            };
        } catch (error) {
            return {
                supported: true,
                available: false,
                version: null,
                downloadAllowed: false,
                downloaded: false,
                assetName: null,
                error: error?.message || String(error)
            };
        }
    }

    async downloadResourceUpdate(options = {}) {
        const silent = !!options.silent;
        if (this.currentResourceDownloadPromise) {
            if (!silent && !this.pendingResourceStage) {
                this.setState({ status: 'downloading', error: null });
            }
            return this.currentResourceDownloadPromise;
        }

        if (!this.resourceReleaseContext || !this.resourceReleaseContext.packageInfo || !this.resourceReleaseContext.packageAsset || !this.state.resource.downloadAllowed) {
            throw new Error('当前没有可下载的资源更新包');
        }

        this.currentResourceDownloadPromise = (async () => {
            const archivePath = await this.overlayManager.createTemporaryArchivePath(
                this.resourceReleaseContext.manifest.resourceVersion,
                this.resourceReleaseContext.packageAsset.name
            );
            if (!silent) {
                this.setState({ status: 'downloading', error: null });
            }
            try {
                await this.releaseClient.downloadAsset(this.resourceReleaseContext.packageAsset.browserDownloadUrl, archivePath);
                const stage = await this.overlayManager.stageUpdate({
                    archivePath,
                    manifest: this.resourceReleaseContext.manifest,
                    packageInfo: this.resourceReleaseContext.packageInfo
                });
                this.pendingResourceStage = {
                    ...stage,
                    archivePath
                };

                const nextResourceState = this.buildPendingResourceState({
                    ...this.state.resource,
                    downloadAllowed: false,
                    downloaded: true,
                    error: null
                });
                const nextShellState = this.buildPendingShellState({
                    ...this.state.shell
                });

                this.setState({
                    status: this.resolveIdleStatus(nextResourceState, nextShellState),
                    shell: nextShellState,
                    resource: nextResourceState
                });
                return this.getState();
            } catch (error) {
                await removeFileIfExists(archivePath);
                this.pendingResourceStage = null;
                if (!silent) {
                    this.setState({
                        status: 'error',
                        error: error?.message || String(error),
                        resource: {
                            ...this.state.resource,
                            downloaded: false,
                            error: error?.message || String(error)
                        }
                    });
                }
                throw error;
            }
        })().finally(() => {
            this.currentResourceDownloadPromise = null;
        });

        return this.currentResourceDownloadPromise;
    }

    async applyResourceUpdate() {
        if (!this.pendingResourceStage) {
            throw new Error('没有可应用的资源更新');
        }

        const { archivePath, ...stageInfo } = this.pendingResourceStage;
        try {
            await this.overlayManager.activateStagedUpdate(stageInfo);
            this.rememberPendingResourceActivation(stageInfo);
            await removeFileIfExists(archivePath);
            this.pendingResourceStage = null;
            const nextResourceState = this.buildPendingResourceState({
                ...this.state.resource,
                downloaded: false,
                downloadAllowed: false,
                error: null
            });
            const nextShellState = this.buildPendingShellState({
                ...this.state.shell
            });
            this.setState({
                status: this.resolveIdleStatus(nextResourceState, nextShellState),
                shell: nextShellState,
                resource: nextResourceState
            });
            return {
                reloadRequired: true,
                resourceVersion: this.overlayManager.getCurrentResourceVersion()
            };
        } catch (error) {
            this.setState({
                status: 'error',
                error: error?.message || String(error),
                resource: {
                    ...this.state.resource,
                    error: error?.message || String(error)
                }
            });
            throw error;
        }
    }

    async downloadShellUpdate() {
        if (!this.state.shell.downloadAllowed) {
            throw new Error('当前壳层更新不允许下载，已按策略阻止全量回退');
        }

        this.setState({ status: 'downloading', error: null });
        try {
            await autoUpdater.downloadUpdate();
            this.rememberDownloadedShellUpdate({
                version: this.state.shell.version,
                files: this.state.shell.assetName ? [{ path: this.state.shell.assetName }] : []
            }, {
                version: this.state.shell.version || this.currentRelease?.tagName || null,
                assetName: this.state.shell.assetName || null
            });
            this.setState({
                status: 'ready-to-restart',
                shell: this.buildPendingShellState({
                    ...this.state.shell,
                    downloadAllowed: false,
                    downloaded: true
                })
            });
            return this.getState();
        } catch (error) {
            this.setState({
                status: 'error',
                error: error?.message || String(error),
                shell: {
                    ...this.state.shell,
                    downloaded: false,
                    error: error?.message || String(error)
                }
            });
            throw error;
        }
    }

    quitAndInstall() {
        autoUpdater.quitAndInstall(true, true);
    }

    async markResourceBootSuccessful() {
        await this.overlayManager.markCurrentAsKnownGood();
        if (!this.pendingResourceActivation) {
            return;
        }

        const currentResourceVersion = this.overlayManager.getCurrentResourceVersion();
        if (this.pendingResourceActivation.version && currentResourceVersion && this.pendingResourceActivation.version !== currentResourceVersion) {
            return;
        }

        this.pendingResourceActivation = null;
        const nextResourceState = this.buildPendingResourceState({
            ...this.state.resource,
            available: false,
            version: null,
            strategy: null,
            selectedAssetName: null,
            downloadAllowed: false,
            downloaded: !!this.pendingResourceStage,
            requiresShellUpdate: false,
            compatible: true,
            baseMismatch: false,
            error: null
        });
        const nextShellState = this.buildPendingShellState({
            ...this.state.shell
        });
        this.setState({
            status: this.resolveIdleStatus(nextResourceState, nextShellState),
            shell: nextShellState,
            resource: nextResourceState
        });
    }

    async rollbackResourceOverlay() {
        await this.overlayManager.rollbackToKnownGood();
        this.setState({
            resourceVersion: this.overlayManager.getCurrentResourceVersion()
        });
        return this.getState();
    }

    resolveBundledAsset(relativePath) {
        return this.overlayManager.resolveFile(relativePath);
    }
}

module.exports = {
    UpdateService,
    extractShellAssetCandidates,
    resolveShellSupport
};
