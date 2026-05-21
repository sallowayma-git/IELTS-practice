#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function loadScript(relativePath, context) {
    const fullPath = path.join(repoRoot, relativePath);
    const source = fs.readFileSync(fullPath, 'utf8');
    vm.runInContext(source, context, { filename: relativePath });
}

const results = [];

function recordResult(name, passed, detail) {
    results.push({ name, passed, detail, timestamp: new Date().toISOString() });
}

function createResourceCoreHarness() {
    const storageState = new Map();
    const localStorageState = new Map();

    const localStorage = {
        getItem(key) {
            return localStorageState.has(key) ? localStorageState.get(key) : null;
        },
        setItem(key, value) {
            localStorageState.set(key, String(value));
        },
        removeItem(key) {
            localStorageState.delete(key);
        }
    };

    const windowStub = {
        console,
        localStorage,
        storage: {
            async get(key, fallback = null) {
                return storageState.has(key) ? storageState.get(key) : fallback;
            },
            async set(key, value) {
                storageState.set(key, JSON.parse(JSON.stringify(value)));
                return true;
            },
            async remove(key) {
                storageState.delete(key);
                return true;
            }
        },
        location: {
            href: 'file:///Users/test/index.html'
        },
        LibraryDiscovery: null
    };

    const sandbox = {
        window: windowStub,
        console,
        localStorage,
        location: windowStub.location,
        fetch: async () => ({ ok: true, status: 200 }),
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Date,
        Math,
        JSON,
        Map,
        Set,
        Promise,
        encodeURIComponent,
        decodeURIComponent
    };
    sandbox.globalThis = sandbox.window;
    return vm.createContext(sandbox);
}

function testCustomLibraryRootPreserved(ResourceCore) {
    ResourceCore.setBasePrefix('./');
    ResourceCore.setActivePathMap({
        reading: { root: 'MyRead/', exceptions: {} },
        listening: { root: 'MyListen/', exceptions: {} }
    });

    const listeningExam = {
        type: 'listening',
        path: 'MyListen/set-1',
        filename: 'index.html'
    };
    const readingExam = {
        type: 'reading',
        path: 'MyRead/passages/p1',
        filename: 'passage.html'
    };

    assert.strictEqual(
        ResourceCore.resolveExamBasePath(listeningExam),
        'MyListen/set-1/',
        '自定义听力根目录不应被默认 ListeningPractice 根目录污染'
    );
    assert.strictEqual(
        ResourceCore.resolveExamBasePath(readingExam),
        'MyRead/passages/p1/',
        '自定义阅读根目录不应被默认阅读根目录污染'
    );
    assert.strictEqual(
        ResourceCore.buildResourcePath(listeningExam, 'html'),
        './MyListen/set-1/index.html',
        '构建资源路径时应保留自定义题库根目录'
    );

    recordResult('ResourceCore 保留自定义题库根目录', true, {
        listening: ResourceCore.buildResourcePath(listeningExam, 'html'),
        reading: ResourceCore.buildResourcePath(readingExam, 'html')
    });
}

function testMappedRootStillPrependsRelativePaths(ResourceCore) {
    ResourceCore.setBasePrefix('./');
    ResourceCore.setActivePathMap({
        reading: { root: 'ReadingCustom/', exceptions: {} },
        listening: { root: 'ListeningCustom/', exceptions: {} }
    });

    const exam = {
        type: 'listening',
        path: 'set-2',
        filename: 'sheet.html'
    };

    assert.strictEqual(
        ResourceCore.resolveExamBasePath(exam),
        'ListeningCustom/set-2/',
        '相对路径仍然应该拼接活动 path map 的根目录'
    );
    assert.strictEqual(
        ResourceCore.buildResourcePath(exam, 'html'),
        './ListeningCustom/set-2/sheet.html',
        '构建资源路径应继续支持 path map 根目录拼接'
    );

    recordResult('ResourceCore 相对路径仍走活动根目录', true, {
        path: ResourceCore.buildResourcePath(exam, 'html')
    });
}

function testDefaultRootStillWorks(ResourceCore) {
    ResourceCore.setBasePrefix('./');
    ResourceCore.setActivePathMap(ResourceCore.DEFAULT_PATH_MAP);

    const exam = {
        type: 'listening',
        path: 'ListeningPractice/mock-1',
        filename: 'paper.html'
    };

    assert.strictEqual(
        ResourceCore.resolveExamBasePath(exam),
        'ListeningPractice/mock-1/',
        '默认题库路径仍然应该保持原样'
    );
    assert.strictEqual(
        ResourceCore.buildResourcePath(exam, 'html'),
        './ListeningPractice/mock-1/paper.html',
        '默认题库路径构建不能被这次修复打坏'
    );

    recordResult('ResourceCore 默认根目录兼容', true, {
        path: ResourceCore.buildResourcePath(exam, 'html')
    });
}

function testExplicitEmptyRootDoesNotFallback(ResourceCore) {
    ResourceCore.setBasePrefix('./');
    ResourceCore.setActivePathMap({
        reading: { root: '', exceptions: {} },
        listening: { root: '', exceptions: {} }
    });

    const exam = {
        type: 'listening',
        path: 'Teacher Pack/deep/set-1',
        filename: 'custom.html'
    };

    assert.strictEqual(
        ResourceCore.resolveExamBasePath(exam),
        'Teacher Pack/deep/set-1/',
        '显式空 root 代表自定义路径已自带根目录，不能回退拼接 ListeningPractice'
    );
    assert.strictEqual(
        ResourceCore.buildResourcePath(exam, 'html'),
        './Teacher%20Pack/deep/set-1/custom.html',
        '显式空 root 应按题库索引路径直接构建资源'
    );

    recordResult('ResourceCore 显式空 root 不回退默认根', true, {
        path: ResourceCore.buildResourcePath(exam, 'html')
    });
}

function testRuntimeResourceTakesPrecedence(context, ResourceCore) {
    ResourceCore.setBasePrefix('./');
    ResourceCore.setActivePathMap(ResourceCore.DEFAULT_PATH_MAP);
    context.window.LibraryDiscovery = {
        resolveRuntimeResource(exam, kind) {
            if (exam && exam.importKey === 'listening:external/deep/custom.html' && kind === 'html') {
                return 'blob:test-runtime/custom-html';
            }
            return '';
        }
    };

    const exam = {
        id: 'custom-listening',
        importKey: 'listening:external/deep/custom.html',
        type: 'listening',
        path: 'External/deep/',
        filename: 'custom.html'
    };

    assert.strictEqual(
        ResourceCore.buildResourcePath(exam, 'html'),
        'blob:test-runtime/custom-html',
        '运行时 File/Blob URL 应优先于持久化相对路径'
    );
    assert.strictEqual(
        ResourceCore.getResourceAttempts(exam, 'html')[0].label,
        'runtime',
        '资源探测应优先尝试运行时 URL'
    );

    recordResult('ResourceCore 运行时 URL 优先', true, {
        path: ResourceCore.buildResourcePath(exam, 'html')
    });
}

async function testDeletePathMapForConfiguration(context, ResourceCore) {
    const key = ResourceCore.getPathMapStorageKey('custom_config');
    await context.window.storage.set(key, {
        reading: { root: 'ReadingCustom/', exceptions: {} },
        listening: { root: 'ListeningCustom/', exceptions: {} }
    });

    const deleted = await ResourceCore.deletePathMapForConfiguration('custom_config');

    assert.strictEqual(deleted, true, '删除 path map 应返回 true');
    assert.strictEqual(await context.window.storage.get(key, null), null, '删除配置时 path map 存储键必须被移除');

    recordResult('ResourceCore 删除指定配置 path map', true, { key });
}

async function main() {
    const context = createResourceCoreHarness();
    loadScript('js/core/resourceCore.js', context);
    const ResourceCore = context.window.ResourceCore;

    try {
        testCustomLibraryRootPreserved(ResourceCore);
        testMappedRootStillPrependsRelativePaths(ResourceCore);
        testDefaultRootStillWorks(ResourceCore);
        testExplicitEmptyRootDoesNotFallback(ResourceCore);
        testRuntimeResourceTakesPrecedence(context, ResourceCore);
        await testDeletePathMapForConfiguration(context, ResourceCore);

        console.log(JSON.stringify({
            status: 'pass',
            detail: `${results.length}/${results.length} 测试通过`,
            passed: results.length,
            total: results.length
        }, null, 2));
    } catch (error) {
        recordResult('ResourceCore 测试执行失败', false, { error: error.message });
        console.log(JSON.stringify({
            status: 'fail',
            detail: error.message,
            results
        }, null, 2));
        process.exit(1);
    }
}

main();
