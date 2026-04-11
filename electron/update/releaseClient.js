const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

class GitHubReleaseClient {
    constructor(options = {}) {
        this.owner = options.owner || '';
        this.repo = options.repo || '';
        this.fetchImpl = options.fetchImpl || global.fetch;
        this.apiBaseUrl = options.apiBaseUrl || 'https://api.github.com';
        this.webBaseUrl = options.webBaseUrl || 'https://github.com';
        this.userAgent = options.userAgent || 'IELTS-Practice-Updater';
        this.cacheFilePath = options.cacheFilePath || null;
        this.resourceManifestAssetName = options.resourceManifestAssetName || 'resources-manifest.json';
        this.resourceDeltaAssetName = options.resourceDeltaAssetName || 'resources-delta.zip';
        this.resourceFullAssetName = options.resourceFullAssetName || 'resources-full.zip';
        this.minRequestIntervalMs = Number.isFinite(options.minRequestIntervalMs)
            ? Math.max(0, Number(options.minRequestIntervalMs))
            : 30 * 1000;
        this.defaultAllowCachedOnError = options.allowCachedOnError !== false;
        this.memoryCache = null;
        this.inflightReleaseRequest = null;
    }

    assertRepositoryConfigured() {
        if (!this.owner || !this.repo) {
            throw new Error('GitHub 仓库信息缺失，无法检查更新');
        }
    }

    getDefaultHeaders(extraHeaders = {}) {
        return {
            Accept: 'application/vnd.github+json',
            'User-Agent': this.userAgent,
            ...extraHeaders
        };
    }

    getJsonHeaders(extraHeaders = {}) {
        return {
            Accept: 'application/json, text/plain, */*',
            'User-Agent': this.userAgent,
            ...extraHeaders
        };
    }

    getBinaryHeaders(extraHeaders = {}) {
        return {
            Accept: 'application/octet-stream, */*',
            'User-Agent': this.userAgent,
            ...extraHeaders
        };
    }

    getRepositoryBaseUrl() {
        return `${this.webBaseUrl}/${this.owner}/${this.repo}`;
    }

    buildReleasePageUrl(tagName) {
        if (!tagName) {
            return `${this.getRepositoryBaseUrl()}/releases/latest`;
        }
        return `${this.getRepositoryBaseUrl()}/releases/tag/${encodeURIComponent(tagName)}`;
    }

    buildLatestDownloadUrl(assetName) {
        if (!assetName) {
            throw new Error('assetName is required');
        }
        return `${this.getRepositoryBaseUrl()}/releases/latest/download/${encodeURIComponent(assetName)}`;
    }

    normalizeReleasePayload(payload = {}) {
        return {
            id: payload.id,
            tagName: payload.tagName || payload.tag_name || '',
            publishedAt: payload.publishedAt || payload.published_at || null,
            body: payload.body || '',
            htmlUrl: payload.htmlUrl || payload.html_url || '',
            source: payload.source || 'api',
            resourceManifest: payload.resourceManifest || payload.manifest || null,
            assets: Array.isArray(payload.assets) ? payload.assets.map((asset) => ({
                id: asset.id,
                name: asset.name,
                size: asset.size,
                browserDownloadUrl: asset.browserDownloadUrl || asset.browser_download_url,
                downloadUrl: asset.downloadUrl || asset.url
            })) : []
        };
    }

    async loadCache() {
        if (this.memoryCache) {
            return this.memoryCache;
        }

        if (!this.cacheFilePath) {
            this.memoryCache = null;
            return this.memoryCache;
        }

        try {
            const raw = await fs.promises.readFile(this.cacheFilePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.release) {
                this.memoryCache = null;
                return this.memoryCache;
            }
            this.memoryCache = {
                etag: parsed.etag || null,
                checkedAt: Number(parsed.checkedAt || Date.parse(parsed.cachedAt || 0) || 0),
                release: this.normalizeReleasePayload(parsed.release)
            };
            return this.memoryCache;
        } catch (_) {
            this.memoryCache = null;
            return this.memoryCache;
        }
    }

    async saveCache(cacheEntry) {
        this.memoryCache = {
            etag: cacheEntry.etag || null,
            checkedAt: Number(cacheEntry.checkedAt || Date.parse(cacheEntry.cachedAt || 0) || Date.now()),
            release: cacheEntry.release ? this.normalizeReleasePayload(cacheEntry.release) : null
        };

        if (!this.cacheFilePath) {
            return;
        }

        await fs.promises.mkdir(path.dirname(this.cacheFilePath), { recursive: true });
        await fs.promises.writeFile(this.cacheFilePath, JSON.stringify({
            etag: this.memoryCache.etag,
            checkedAt: this.memoryCache.checkedAt,
            cachedAt: new Date(this.memoryCache.checkedAt).toISOString(),
            release: this.memoryCache.release
        }, null, 2), 'utf8');
    }

    buildReleaseResult(release, metadata = {}) {
        return {
            ...this.normalizeReleasePayload(release || {}),
            fromCache: !!metadata.fromCache,
            cacheError: metadata.cacheError || null
        };
    }

    async getLatestRelease(options = {}) {
        this.assertRepositoryConfigured();
        const forceNetwork = !!options.forceNetwork;
        const allowCachedOnError = options.allowCachedOnError !== undefined
            ? !!options.allowCachedOnError
            : this.defaultAllowCachedOnError;
        const cacheEntry = await this.loadCache();

        const now = Date.now();
        const throttled = !forceNetwork
            && cacheEntry
            && cacheEntry.release
            && now - cacheEntry.checkedAt < this.minRequestIntervalMs;
        if (throttled) {
            return this.buildReleaseResult(cacheEntry.release, { fromCache: true });
        }

        if (this.inflightReleaseRequest) {
            return this.inflightReleaseRequest;
        }

        this.inflightReleaseRequest = this.fetchLatestRelease({
            cacheEntry,
            allowCachedOnError
        }).finally(() => {
            this.inflightReleaseRequest = null;
        });
        return this.inflightReleaseRequest;
    }

    buildManifestReleasePayload(manifest = {}) {
        const tagName = manifest.tag || manifest.resourceVersion || '';
        const assets = [
            {
                name: this.resourceManifestAssetName,
                browserDownloadUrl: this.buildLatestDownloadUrl(this.resourceManifestAssetName),
                downloadUrl: this.buildLatestDownloadUrl(this.resourceManifestAssetName)
            }
        ];

        const deltaAssetName = manifest.packages?.delta?.assetName || this.resourceDeltaAssetName;
        if (deltaAssetName) {
            assets.push({
                name: deltaAssetName,
                browserDownloadUrl: this.buildLatestDownloadUrl(deltaAssetName),
                downloadUrl: this.buildLatestDownloadUrl(deltaAssetName)
            });
        }

        const fullAssetName = manifest.packages?.full?.assetName || this.resourceFullAssetName;
        if (fullAssetName) {
            assets.push({
                name: fullAssetName,
                browserDownloadUrl: this.buildLatestDownloadUrl(fullAssetName),
                downloadUrl: this.buildLatestDownloadUrl(fullAssetName)
            });
        }

        return this.normalizeReleasePayload({
            tagName,
            publishedAt: manifest.publishedAt || null,
            body: manifest.releaseNotes || '',
            htmlUrl: this.buildReleasePageUrl(tagName),
            source: 'manifest',
            resourceManifest: manifest,
            assets
        });
    }

    async fetchLatestRelease(options = {}) {
        const cacheEntry = options.cacheEntry || null;
        const allowCachedOnError = !!options.allowCachedOnError;
        let lastError = null;

        try {
            const manifest = await this.fetchJson(this.buildLatestDownloadUrl(this.resourceManifestAssetName));
            const release = this.buildManifestReleasePayload(manifest);
            await this.saveCache({
                etag: null,
                checkedAt: Date.now(),
                release
            });
            return this.buildReleaseResult(release, { fromCache: false });
        } catch (error) {
            lastError = error;
        }

        try {
            return await this.fetchLatestReleaseFromApi({
                cacheEntry,
                allowCachedOnError
            });
        } catch (error) {
            if (allowCachedOnError && cacheEntry && cacheEntry.release) {
                return this.buildReleaseResult(cacheEntry.release, {
                    fromCache: true,
                    cacheError: lastError?.message || error?.message || String(error)
                });
            }
            throw lastError || error;
        }
    }

    async fetchLatestReleaseFromApi(options = {}) {
        const cacheEntry = options.cacheEntry || null;
        const requestHeaders = {};
        if (cacheEntry && cacheEntry.etag) {
            requestHeaders['If-None-Match'] = cacheEntry.etag;
        }

        try {
            const response = await this.fetchImpl(`${this.apiBaseUrl}/repos/${this.owner}/${this.repo}/releases/latest`, {
                headers: this.getDefaultHeaders(requestHeaders)
            });
            if (response.status === 304 && cacheEntry && cacheEntry.release) {
                await this.saveCache({
                    ...cacheEntry,
                    checkedAt: Date.now()
                });
                return this.buildReleaseResult(this.memoryCache.release, { fromCache: true });
            }
            if (!response.ok) {
                throw new Error(`获取最新 Release 失败: ${response.status} ${response.statusText}`);
            }

            const payload = await response.json();
            const normalizedRelease = this.normalizeReleasePayload(payload);
            await this.saveCache({
                etag: response.headers.get('etag') || (cacheEntry ? cacheEntry.etag : null),
                checkedAt: Date.now(),
                release: normalizedRelease
            });
            return this.buildReleaseResult(normalizedRelease, { fromCache: false });
        } catch (error) {
            throw error;
        }
    }

    findAsset(release, assetName) {
        if (!release || !Array.isArray(release.assets)) {
            return null;
        }
        return release.assets.find((asset) => asset && asset.name === assetName) || null;
    }

    async fetchJson(url) {
        const response = await this.fetchImpl(url, {
            headers: this.getJsonHeaders()
        });
        if (!response.ok) {
            throw new Error(`获取 JSON 失败: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }

    async checkLatestReleaseAsset(assetName) {
        if (!assetName) {
            return false;
        }

        const url = this.buildLatestDownloadUrl(assetName);
        try {
            const headResponse = await this.fetchImpl(url, {
                method: 'HEAD',
                headers: this.getBinaryHeaders()
            });
            if (headResponse.ok) {
                return true;
            }
            if (headResponse.status !== 405) {
                return false;
            }
        } catch (_) {
            // fall through to GET range probe
        }

        try {
            const probeResponse = await this.fetchImpl(url, {
                method: 'GET',
                headers: this.getBinaryHeaders({
                    Range: 'bytes=0-0'
                })
            });
            return probeResponse.ok;
        } catch (_) {
            return false;
        }
    }

    async downloadAsset(url, destinationPath) {
        const response = await this.fetchImpl(url, {
            headers: this.getBinaryHeaders()
        });
        if (!response.ok || !response.body) {
            throw new Error(`下载更新资源失败: ${response.status} ${response.statusText}`);
        }

        await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
        const bodyStream = typeof Readable.fromWeb === 'function'
            ? Readable.fromWeb(response.body)
            : response.body;

        await pipeline(bodyStream, fs.createWriteStream(destinationPath));
        return destinationPath;
    }
}

module.exports = {
    GitHubReleaseClient
};
