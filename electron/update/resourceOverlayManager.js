const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AdmZip = require('adm-zip');

const DEFAULT_MANAGED_PREFIXES = [
    'index.html',
    'css/',
    'js/',
    'templates/',
    'assets/'
];

function normalizeRelativePath(relativePath) {
    if (!relativePath) {
        return null;
    }

    const normalized = path.posix.normalize(String(relativePath).replace(/^\/+/, ''));
    if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('\0')) {
        return null;
    }
    return normalized;
}

function normalizeManagedPrefixes(prefixes) {
    if (!Array.isArray(prefixes) || prefixes.length === 0) {
        return DEFAULT_MANAGED_PREFIXES.slice();
    }

    return prefixes
        .map((entry) => normalizeRelativePath(entry))
        .filter(Boolean);
}

function matchesManagedEntry(relativePath, managedEntry) {
    if (!managedEntry) {
        return false;
    }
    return managedEntry.endsWith('/')
        ? relativePath.startsWith(managedEntry)
        : relativePath === managedEntry;
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

function createEmptyDescriptor(overrides = {}) {
    return {
        version: null,
        mode: 'delta',
        deletedPaths: [],
        managedPrefixes: DEFAULT_MANAGED_PREFIXES.slice(),
        ...overrides
    };
}

function normalizeDescriptor(descriptor = {}) {
    return {
        version: descriptor.version ? String(descriptor.version) : null,
        mode: descriptor.mode === 'full' ? 'full' : 'delta',
        deletedPaths: Array.isArray(descriptor.deletedPaths)
            ? descriptor.deletedPaths.map((entry) => normalizeRelativePath(entry)).filter(Boolean)
            : [],
        managedPrefixes: normalizeManagedPrefixes(descriptor.managedPrefixes)
    };
}

function normalizeState(rawState = {}) {
    if (rawState.active || rawState.previous || rawState.knownGood) {
        return {
            active: normalizeDescriptor(rawState.active || createEmptyDescriptor()),
            previous: normalizeDescriptor(rawState.previous || createEmptyDescriptor()),
            knownGood: normalizeDescriptor(rawState.knownGood || createEmptyDescriptor())
        };
    }

    return {
        active: normalizeDescriptor({
            version: rawState.activeVersion,
            mode: rawState.activeMode,
            deletedPaths: rawState.deletedPaths,
            managedPrefixes: rawState.managedPrefixes
        }),
        previous: normalizeDescriptor({
            version: rawState.previousVersion,
            mode: rawState.previousMode,
            deletedPaths: rawState.previousDeletedPaths,
            managedPrefixes: rawState.previousManagedPrefixes || rawState.managedPrefixes
        }),
        knownGood: normalizeDescriptor({
            version: rawState.lastKnownGoodVersion,
            mode: rawState.lastKnownGoodMode,
            deletedPaths: rawState.lastKnownGoodDeletedPaths,
            managedPrefixes: rawState.lastKnownGoodManagedPrefixes || rawState.managedPrefixes
        })
    };
}

function isManagedResourcePath(relativePath, managedPrefixes = DEFAULT_MANAGED_PREFIXES) {
    return managedPrefixes.some((entry) => matchesManagedEntry(relativePath, entry));
}

async function computeSha256(filePath) {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    return new Promise((resolve, reject) => {
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}

class ResourceOverlayManager {
    constructor(options = {}) {
        this.app = options.app;
        this.defaultResourceVersion = options.defaultResourceVersion || null;
        this.defaultManagedPrefixes = normalizeManagedPrefixes(options.defaultManagedPrefixes);
        this.updateRoot = path.join(this.app.getPath('userData'), 'updates');
        this.overlaysRoot = path.join(this.updateRoot, 'overlays');
        this.stagingRoot = path.join(this.updateRoot, 'staging');
        this.stateFilePath = path.join(this.updateRoot, 'resource-state.json');
        this.state = normalizeState({});
    }

    async initialize() {
        await fs.promises.mkdir(this.overlaysRoot, { recursive: true });
        await fs.promises.mkdir(this.stagingRoot, { recursive: true });
        this.state = await this.loadState();
    }

    async loadState() {
        try {
            const raw = await fs.promises.readFile(this.stateFilePath, 'utf8');
            return normalizeState(JSON.parse(raw));
        } catch (_) {
            return normalizeState({});
        }
    }

    async saveState(nextState = this.state) {
        this.state = normalizeState(nextState);
        await fs.promises.mkdir(path.dirname(this.stateFilePath), { recursive: true });
        await fs.promises.writeFile(this.stateFilePath, JSON.stringify(this.state, null, 2), 'utf8');
    }

    getCurrentDescriptor() {
        return this.state.active && this.state.active.version
            ? this.state.active
            : normalizeDescriptor({
                version: this.defaultResourceVersion,
                mode: 'delta',
                managedPrefixes: this.defaultManagedPrefixes
            });
    }

    getCurrentResourceVersion() {
        return this.getCurrentDescriptor().version || this.defaultResourceVersion;
    }

    getOverlayRootForVersion(resourceVersion) {
        return resourceVersion ? path.join(this.overlaysRoot, resourceVersion) : null;
    }

    resolveFile(relativePath) {
        const normalized = normalizeRelativePath(relativePath);
        if (!normalized) {
            return { deleted: true, filePath: null };
        }

        const activeDescriptor = this.getCurrentDescriptor();
        const activeOverlayRoot = this.getOverlayRootForVersion(activeDescriptor.version);
        if (activeOverlayRoot) {
            const overlayPath = path.join(activeOverlayRoot, normalized);
            if (fs.existsSync(overlayPath)) {
                return { deleted: false, filePath: overlayPath };
            }

            if (activeDescriptor.mode === 'full' && isManagedResourcePath(normalized, activeDescriptor.managedPrefixes)) {
                return { deleted: true, filePath: null };
            }
        }

        if (activeDescriptor.mode === 'delta') {
            const deletedPathSet = new Set(activeDescriptor.deletedPaths.map((entry) => normalizeRelativePath(entry)).filter(Boolean));
            if (deletedPathSet.has(normalized)) {
                return { deleted: true, filePath: null };
            }
        }

        const bundledPath = path.join(this.app.getAppPath(), normalized);
        if (fs.existsSync(bundledPath)) {
            return { deleted: false, filePath: bundledPath };
        }

        return { deleted: true, filePath: null };
    }

    async listFilesRecursively(rootPath, relativePrefix = '') {
        const entries = await fs.promises.readdir(rootPath, { withFileTypes: true }).catch(() => []);
        const files = [];
        for (const entry of entries) {
            const nextRelative = path.posix.join(relativePrefix, entry.name);
            const normalized = normalizeRelativePath(nextRelative);
            if (!normalized) {
                continue;
            }
            const absolutePath = path.join(rootPath, entry.name);
            if (entry.isDirectory()) {
                const nestedFiles = await this.listFilesRecursively(absolutePath, normalized);
                files.push(...nestedFiles);
                continue;
            }
            if (entry.isFile()) {
                files.push(normalized);
            }
        }
        return files;
    }

    async listManagedFiles(rootPath, managedPrefixes) {
        const normalizedPrefixes = normalizeManagedPrefixes(managedPrefixes);
        const files = new Set();

        for (const prefix of normalizedPrefixes) {
            const absolutePath = path.join(rootPath, prefix);
            const stats = await fs.promises.stat(absolutePath).catch(() => null);
            if (!stats) {
                continue;
            }
            if (stats.isFile()) {
                files.add(prefix);
                continue;
            }
            if (stats.isDirectory()) {
                const nestedFiles = await this.listFilesRecursively(absolutePath, prefix);
                for (const nestedFile of nestedFiles) {
                    files.add(nestedFile);
                }
            }
        }

        return Array.from(files).sort((left, right) => left.localeCompare(right));
    }

    validateManifestEntries(packageInfo) {
        for (const entry of packageInfo.files) {
            const normalized = normalizeRelativePath(entry.path);
            if (!normalized) {
                throw new Error(`非法资源路径: ${entry.path}`);
            }
            if (!isManagedResourcePath(normalized, packageInfo.managedPrefixes)) {
                throw new Error(`资源路径不在白名单中: ${normalized}`);
            }
        }
    }

    async validateArchiveContents(stageRoot, packageInfo) {
        const stagedFiles = await this.listFilesRecursively(stageRoot);
        const actualFiles = [];
        for (const stagedFile of stagedFiles) {
            if (stagedFile === '.overlay-manifest.json') {
                continue;
            }
            actualFiles.push(stagedFile);
            if (!isManagedResourcePath(stagedFile, packageInfo.managedPrefixes)) {
                throw new Error(`更新包包含非法路径: ${stagedFile}`);
            }
        }

        const expectedFiles = new Set((packageInfo.files || [])
            .filter((entry) => entry && entry.action !== 'delete')
            .map((entry) => normalizeRelativePath(entry.path))
            .filter(Boolean));
        if (packageInfo.mode === 'full' && expectedFiles.size === 0) {
            throw new Error('full 资源包缺少 manifest 文件清单，已阻止更新');
        }
        if (actualFiles.length > 0 && expectedFiles.size === 0) {
            throw new Error('更新包存在未声明文件，已阻止更新');
        }
        if (expectedFiles.size > 0) {
            for (const stagedFile of actualFiles) {
                if (!expectedFiles.has(stagedFile)) {
                    throw new Error(`更新包包含未声明资源: ${stagedFile}`);
                }
            }
        }

        if (packageInfo.mode === 'full' && !stagedFiles.includes('index.html')) {
            throw new Error('full 资源包缺少 index.html，已阻止更新');
        }
    }

    async validateArchiveIntegrity(archivePath, packageInfo) {
        if (!archivePath || !packageInfo.integrity) {
            return;
        }

        const stats = await fs.promises.stat(archivePath).catch(() => null);
        if (!stats || !stats.isFile()) {
            throw new Error('资源更新包不存在，无法校验');
        }

        if (Number.isFinite(packageInfo.integrity.size) && packageInfo.integrity.size !== stats.size) {
            throw new Error('资源更新包大小校验失败');
        }

        if (packageInfo.integrity.sha256) {
            const actualHash = await computeSha256(archivePath);
            if (actualHash !== packageInfo.integrity.sha256) {
                throw new Error('资源更新包完整性校验失败');
            }
        }
    }

    async validateFileEntries(stageRoot, packageInfo) {
        for (const entry of packageInfo.files) {
            const normalized = normalizeRelativePath(entry.path);
            if (!normalized || entry.action === 'delete') {
                continue;
            }

            const targetPath = path.join(stageRoot, normalized);
            const stats = await fs.promises.stat(targetPath).catch(() => null);
            if (!stats || !stats.isFile()) {
                throw new Error(`增量资源缺失: ${normalized}`);
            }

            if (Number.isFinite(entry.size) && Number(entry.size) !== stats.size) {
                throw new Error(`资源大小校验失败: ${normalized}`);
            }

            if (entry.sha256) {
                const actualHash = await computeSha256(targetPath);
                if (actualHash !== entry.sha256) {
                    throw new Error(`资源哈希校验失败: ${normalized}`);
                }
            }
        }
    }

    async resolveDeletedPathsForActivation(stageRoot, packageInfo) {
        const manifestDeletes = (packageInfo.files || [])
            .filter((entry) => entry && entry.action === 'delete')
            .map((entry) => normalizeRelativePath(entry.path))
            .filter(Boolean);
        if (packageInfo.mode !== 'full') {
            return manifestDeletes;
        }

        const bundledManagedFiles = await this.listManagedFiles(this.app.getAppPath(), packageInfo.managedPrefixes);
        const stagedManagedFiles = await this.listManagedFiles(stageRoot, packageInfo.managedPrefixes);
        const stagedSet = new Set(stagedManagedFiles);
        const mergedDeletes = new Set(manifestDeletes);
        for (const bundledFile of bundledManagedFiles) {
            if (!stagedSet.has(bundledFile)) {
                mergedDeletes.add(bundledFile);
            }
        }
        return Array.from(mergedDeletes).sort((left, right) => left.localeCompare(right));
    }

    async cleanupStagingDirectories(keepStageRoot = null) {
        const entries = await fs.promises.readdir(this.stagingRoot, { withFileTypes: true }).catch(() => []);
        await Promise.all(entries.map(async (entry) => {
            if (!entry.isDirectory()) {
                return;
            }

            const absolutePath = path.join(this.stagingRoot, entry.name);
            if (keepStageRoot && absolutePath === keepStageRoot) {
                return;
            }

            await fs.promises.rm(absolutePath, { recursive: true, force: true }).catch(() => {});
        }));
    }

    normalizeRecoveredPackageInfo(manifest = {}, packageInfo = {}) {
        return {
            assetName: packageInfo.assetName || null,
            mode: packageInfo.mode === 'full' ? 'full' : 'delta',
            files: Array.isArray(packageInfo.files) ? packageInfo.files : Array.isArray(manifest.files) ? manifest.files : [],
            managedPrefixes: normalizeManagedPrefixes(packageInfo.managedPrefixes || manifest.managedPrefixes || this.defaultManagedPrefixes),
            baseResourceVersion: packageInfo.baseResourceVersion || manifest.baseResourceVersion || null,
            integrity: normalizePackageIntegrity(packageInfo.integrity)
        };
    }

    async validateRecoveredStage(stageRoot, packageInfo) {
        this.validateManifestEntries(packageInfo);
        await this.validateArchiveContents(stageRoot, packageInfo);
        await this.validateFileEntries(stageRoot, packageInfo);
    }

    async recoverStagedUpdate() {
        const entries = await fs.promises.readdir(this.stagingRoot, { withFileTypes: true }).catch(() => []);
        const candidateDirs = await Promise.all(entries
            .filter((entry) => entry.isDirectory())
            .map(async (entry) => {
                const stageRoot = path.join(this.stagingRoot, entry.name);
                const stats = await fs.promises.stat(stageRoot).catch(() => null);
                return stats ? { stageRoot, mtimeMs: stats.mtimeMs } : null;
            }));

        const sortedCandidates = candidateDirs
            .filter(Boolean)
            .sort((left, right) => right.mtimeMs - left.mtimeMs);

        for (const candidate of sortedCandidates) {
            const metadataPath = path.join(candidate.stageRoot, '.overlay-manifest.json');
            try {
                const rawMetadata = await fs.promises.readFile(metadataPath, 'utf8');
                const metadata = JSON.parse(rawMetadata);
                const manifest = metadata.manifest || {};
                const normalizedPackageInfo = this.normalizeRecoveredPackageInfo(manifest, metadata.packageInfo || {});
                if (!manifest.resourceVersion) {
                    throw new Error('staged manifest 缺少 resourceVersion');
                }
                await this.validateRecoveredStage(candidate.stageRoot, normalizedPackageInfo);
                await this.cleanupStagingDirectories(candidate.stageRoot);
                return {
                    archivePath: typeof metadata.archivePath === 'string' ? metadata.archivePath : null,
                    stageRoot: candidate.stageRoot,
                    manifest,
                    packageInfo: normalizedPackageInfo,
                    metadataPath
                };
            } catch (_) {
                await fs.promises.rm(candidate.stageRoot, { recursive: true, force: true }).catch(() => {});
            }
        }

        return null;
    }

    async stageUpdate(options = {}) {
        const manifest = options.manifest || {};
        const packageInfo = options.packageInfo || {};
        const archivePath = options.archivePath;
        const resourceVersion = manifest.resourceVersion;
        if (!resourceVersion) {
            throw new Error('资源清单缺少 resourceVersion');
        }

        const normalizedPackageInfo = this.normalizeRecoveredPackageInfo(manifest, packageInfo);

        this.validateManifestEntries(normalizedPackageInfo);

        const stageRoot = await fs.promises.mkdtemp(path.join(this.stagingRoot, `${resourceVersion}-`));
        try {
            await this.validateArchiveIntegrity(archivePath, normalizedPackageInfo);
            if (archivePath) {
                const zip = new AdmZip(archivePath);
                zip.extractAllTo(stageRoot, true);
            }

            await this.validateArchiveContents(stageRoot, normalizedPackageInfo);
            await this.validateFileEntries(stageRoot, normalizedPackageInfo);

            const metadataPath = path.join(stageRoot, '.overlay-manifest.json');
            await fs.promises.writeFile(metadataPath, JSON.stringify({
                archivePath: archivePath || null,
                manifest,
                packageInfo: normalizedPackageInfo
            }, null, 2), 'utf8');
            await this.cleanupStagingDirectories(stageRoot);

            return {
                stageRoot,
                manifest,
                packageInfo: normalizedPackageInfo,
                metadataPath
            };
        } catch (error) {
            await fs.promises.rm(stageRoot, { recursive: true, force: true }).catch(() => {});
            throw error;
        }
    }

    async activateStagedUpdate(stageInfo = {}) {
        const manifest = stageInfo.manifest || {};
        const packageInfo = stageInfo.packageInfo || {};
        const resourceVersion = manifest.resourceVersion;
        if (!resourceVersion || !stageInfo.stageRoot) {
            throw new Error('缺少可激活的暂存更新');
        }

        const targetRoot = this.getOverlayRootForVersion(resourceVersion);
        const deletedPaths = await this.resolveDeletedPathsForActivation(stageInfo.stageRoot, packageInfo);
        const descriptor = normalizeDescriptor({
            version: resourceVersion,
            mode: packageInfo.mode,
            deletedPaths,
            managedPrefixes: packageInfo.managedPrefixes || manifest.managedPrefixes || this.defaultManagedPrefixes
        });

        await fs.promises.rm(targetRoot, { recursive: true, force: true });
        await fs.promises.mkdir(path.dirname(targetRoot), { recursive: true });

        try {
            await fs.promises.rename(stageInfo.stageRoot, targetRoot);
        } catch (error) {
            if (error && error.code !== 'EXDEV') {
                throw error;
            }
            await fs.promises.cp(stageInfo.stageRoot, targetRoot, { recursive: true });
            await fs.promises.rm(stageInfo.stageRoot, { recursive: true, force: true });
        }

        await this.saveState({
            active: descriptor,
            previous: this.state.active || createEmptyDescriptor({ managedPrefixes: this.defaultManagedPrefixes }),
            knownGood: this.state.knownGood || createEmptyDescriptor({ managedPrefixes: this.defaultManagedPrefixes })
        });
        await this.cleanupOldOverlays();
        return this.state;
    }

    async markCurrentAsKnownGood() {
        await this.saveState({
            ...this.state,
            knownGood: this.state.active || createEmptyDescriptor({ managedPrefixes: this.defaultManagedPrefixes })
        });
    }

    async rollbackToKnownGood() {
        const nextDescriptor = this.state.knownGood && this.state.knownGood.version
            ? this.state.knownGood
            : this.state.previous;

        await this.saveState({
            ...this.state,
            active: nextDescriptor || createEmptyDescriptor({ managedPrefixes: this.defaultManagedPrefixes })
        });
        return this.state;
    }

    async cleanupOldOverlays() {
        const fallbackDescriptor = this.state.knownGood && this.state.knownGood.version
            ? this.state.knownGood
            : this.state.previous;
        const keepVersions = Array.from(new Set([
            this.state.active && this.state.active.version,
            fallbackDescriptor && fallbackDescriptor.version
        ].filter(Boolean)));

        const entries = await fs.promises.readdir(this.overlaysRoot, { withFileTypes: true }).catch(() => []);
        await Promise.all(entries.map(async (entry) => {
            if (!entry.isDirectory()) {
                return;
            }
            if (keepVersions.includes(entry.name)) {
                return;
            }
            await fs.promises.rm(path.join(this.overlaysRoot, entry.name), { recursive: true, force: true });
        }));
    }

    async createTemporaryArchivePath(resourceVersion, assetName = 'resource-update.zip') {
        const safeName = normalizeRelativePath(resourceVersion) || `resource-update-${Date.now()}`;
        const safeAssetName = path.basename(assetName);
        return path.join(os.tmpdir(), `${safeName.replace(/\//g, '-')}-${Date.now()}-${safeAssetName}`);
    }
}

module.exports = {
    DEFAULT_MANAGED_PREFIXES,
    ResourceOverlayManager,
    normalizeRelativePath,
    isManagedResourcePath
};
