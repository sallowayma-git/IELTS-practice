const assert = require('node:assert/strict');
const path = require('node:path');

const { GitHubReleaseClient } = require(path.resolve('electron/update/releaseClient.js'));

function createResponse({ ok = true, status = 200, statusText = 'OK', jsonBody = null, headers = {} } = {}) {
    return {
        ok,
        status,
        statusText,
        headers: {
            get(name) {
                return headers[String(name).toLowerCase()] || null;
            }
        },
        async json() {
            return jsonBody;
        }
    };
}

async function testPrefersStaticManifest() {
    const requests = [];
    const client = new GitHubReleaseClient({
        owner: 'demo',
        repo: 'app',
        cacheFilePath: null,
        fetchImpl: async (url) => {
            requests.push(url);
            if (String(url).includes('/releases/latest/download/resources-manifest.json')) {
                return createResponse({
                    jsonBody: {
                        tag: 'v0.7.0',
                        publishedAt: '2026-04-11T00:00:00.000Z',
                        releaseNotes: 'manifest-notes',
                        resourceVersion: 'v0.7.0',
                        packages: {
                            delta: {
                                assetName: 'resources-delta.zip'
                            },
                            full: {
                                assetName: 'resources-full.zip'
                            }
                        }
                    }
                });
            }
            throw new Error(`unexpected request: ${url}`);
        }
    });

    const release = await client.getLatestRelease({ forceNetwork: true });

    assert.equal(release.tagName, 'v0.7.0', '静态 manifest 应提供 release tag');
    assert.equal(release.body, 'manifest-notes', '静态 manifest 应提供 release notes');
    assert.equal(release.htmlUrl, 'https://github.com/demo/app/releases/tag/v0.7.0', '静态 manifest 应推导 release 页面地址');
    assert.equal(release.source, 'manifest', 'release source 应标记为 manifest');
    assert.equal(client.findAsset(release, 'resources-manifest.json').name, 'resources-manifest.json', '应包含 manifest 资产');
    assert.equal(client.findAsset(release, 'resources-delta.zip').name, 'resources-delta.zip', '应包含 delta 资产');
    assert.equal(client.findAsset(release, 'resources-full.zip').name, 'resources-full.zip', '应包含 full 资产');
    assert.equal(requests.length, 1, 'manifest 命中时不应再回退 GitHub API');
}

async function testFallsBackToApi() {
    const client = new GitHubReleaseClient({
        owner: 'demo',
        repo: 'app',
        cacheFilePath: null,
        fetchImpl: async (url) => {
            if (String(url).includes('/releases/latest/download/resources-manifest.json')) {
                return createResponse({
                    ok: false,
                    status: 404,
                    statusText: 'Not Found'
                });
            }
            if (String(url).includes('api.github.com/repos/demo/app/releases/latest')) {
                return createResponse({
                    jsonBody: {
                        tag_name: 'v0.6.0',
                        published_at: '2026-04-10T00:00:00.000Z',
                        body: 'api-notes',
                        html_url: 'https://github.com/demo/app/releases/tag/v0.6.0',
                        assets: []
                    },
                    headers: {
                        etag: '"etag-demo"'
                    }
                });
            }
            throw new Error(`unexpected request: ${url}`);
        }
    });

    const release = await client.getLatestRelease({ forceNetwork: true });

    assert.equal(release.tagName, 'v0.6.0', 'manifest 缺失时应回退 GitHub API');
    assert.equal(release.body, 'api-notes', 'API fallback 应保留 release notes');
    assert.equal(release.source, 'api', 'API fallback source 应标记为 api');
}

async function testNoPublishedReleaseDegradesGracefully() {
    const client = new GitHubReleaseClient({
        owner: 'demo',
        repo: 'app',
        cacheFilePath: null,
        fetchImpl: async (url) => {
            if (String(url).includes('/releases/latest/download/resources-manifest.json')) {
                return createResponse({
                    ok: false,
                    status: 404,
                    statusText: 'Not Found'
                });
            }
            if (String(url).includes('api.github.com/repos/demo/app/releases/latest')) {
                return createResponse({
                    ok: false,
                    status: 404,
                    statusText: 'Not Found'
                });
            }
            throw new Error(`unexpected request: ${url}`);
        }
    });

    const release = await client.getLatestRelease({ forceNetwork: true, allowCachedOnError: false });

    assert.equal(release.tagName, '', '没有已发布 Release 时不应伪造 tag');
    assert.equal(release.source, 'none', '没有已发布 Release 时应降级成 none source');
    assert.equal(release.htmlUrl, 'https://github.com/demo/app/releases', '没有 Release 时应回退到 releases 列表页');
    assert.deepEqual(release.assets, [], '没有 Release 时不应伪造资产列表');
}

(async function main() {
    await testPrefersStaticManifest();
    await testFallsBackToApi();
    await testNoPublishedReleaseDegradesGracefully();
    console.log('Release client smoke passed.');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
