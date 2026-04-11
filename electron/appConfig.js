const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

let cachedConfig = null;

function readPackageMetadata() {
    const candidates = [
        path.join(app.getAppPath(), 'package.json'),
        path.join(__dirname, '..', 'package.json')
    ];

    for (const candidate of candidates) {
        try {
            const raw = fs.readFileSync(candidate, 'utf8');
            return JSON.parse(raw);
        } catch (_) {
            // continue
        }
    }

    return {};
}

function parseRepository(metadata = {}) {
    const buildPublish = Array.isArray(metadata.build?.publish) ? metadata.build.publish[0] : null;
    if (buildPublish && buildPublish.provider === 'github' && buildPublish.owner && buildPublish.repo) {
        return { owner: buildPublish.owner, repo: buildPublish.repo };
    }

    const repositoryUrl = metadata.repository?.url || metadata.repository;
    if (!repositoryUrl) {
        return { owner: '', repo: '' };
    }

    const normalized = String(repositoryUrl)
        .replace(/^git\+/, '')
        .replace(/\.git$/, '');
    const match = normalized.match(/github\.com[/:]([^/]+)\/([^/]+)$/i);
    if (!match) {
        return { owner: '', repo: '' };
    }

    return { owner: match[1], repo: match[2] };
}

function getAppConfig() {
    if (cachedConfig) {
        return cachedConfig;
    }

    const metadata = readPackageMetadata();
    const repository = parseRepository(metadata);

    cachedConfig = {
        packageMetadata: metadata,
        repository,
        appVersion: app.getVersion(),
        defaultResourceVersion: `v${app.getVersion()}`,
        resourceManifestAssetName: 'resources-manifest.json',
        resourceDeltaAssetName: 'resources-delta.zip',
        resourceFullAssetName: 'resources-full.zip'
    };

    return cachedConfig;
}

module.exports = {
    getAppConfig
};
