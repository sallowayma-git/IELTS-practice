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
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    vm.runInContext(source, context, { filename: relativePath });
}

function stripComments(source) {
    return String(source || '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
}

function isForwardOnlyFeatureSource(source) {
    const code = stripComments(source);
    const normalized = code.replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return true;
    }

    const reExportOnly = /^export\s+(\*\s+from|\{[^}]+\}\s+from)\s+['"][^'"]+['"]\s*;?\s*$/;
    if (reExportOnly.test(normalized)) {
        return true;
    }

    const commonJsProxy = /^module\.exports\s*=\s*require\(['"][^'"]+['"]\)\s*;?\s*$/;
    if (commonJsProxy.test(normalized)) {
        return true;
    }

    const functionCount = (code.match(/\bfunction\b/g) || []).length;
    const directAliasPattern = /(window|globalThis|global)\.[A-Za-z_$][\w$]*\s*=\s*(window|globalThis|global)\.[A-Za-z_$][\w$]*\s*;?/;
    const objectAssignAliasPattern = /(window|globalThis|global)\.[A-Za-z_$][\w$]*\s*=\s*Object\.assign\(\{\}\s*,\s*(window|globalThis|global)\.[A-Za-z_$][\w$]*\s*\|\|\s*\{\}\s*\)\s*;?/;

    return functionCount <= 1 && (directAliasPattern.test(code) || objectAssignAliasPattern.test(code));
}

async function testPracticeStore() {
    const records = [];
    const windowStub = {
        PracticeRecordAPI: {
            async list() { return records.slice(); },
            async replace(next) {
                records.splice(0, records.length, ...next);
                return true;
            },
            async saveRecord(record) {
                records.unshift(record);
                return record;
            }
        }
    };
    const context = vm.createContext({ window: windowStub, globalThis: windowStub, console });
    loadScript('js/core/practiceStore.js', context);

    assert.strictEqual(typeof windowStub.PracticeStore.list, 'function');
    await windowStub.PracticeStore.save({ id: 'r1' });
    assert.strictEqual((await windowStub.PracticeStore.list()).length, 1);
    await windowStub.PracticeStore.clear();
    assert.strictEqual((await windowStub.PracticeStore.list()).length, 0);
}

function testFeaturesNoForwardOnlyFiles() {
    const featureRoot = path.join(repoRoot, 'js', 'features');
    if (!fs.existsSync(featureRoot)) {
        return;
    }
    const queue = [featureRoot];
    const files = [];

    while (queue.length > 0) {
        const current = queue.shift();
        const entries = fs.readdirSync(current, { withFileTypes: true });
        entries.forEach((entry) => {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                queue.push(fullPath);
                return;
            }
            if (entry.isFile() && fullPath.endsWith('.js')) {
                files.push(fullPath);
            }
        });
    }

    const forwardOnlyFiles = files
        .filter((fullPath) => isForwardOnlyFeatureSource(fs.readFileSync(fullPath, 'utf8')))
        .map((fullPath) => path.relative(repoRoot, fullPath).replace(/\\/g, '/'))
        .sort();

    assert.strictEqual(
        forwardOnlyFiles.length,
        0,
        `js/features 禁止新增转发-only 文件: ${forwardOnlyFiles.join(', ')}`
    );
}

function testIndexCssConvergence() {
    const source = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
    const cssHrefs = [...source.matchAll(/<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)]
        .map((match) => match[1].trim());

    const allowedCss = new Set([
        'css/main.css',
        'css/heroui-bridge.css',
        'css/onboarding.css'
    ]);
    const unexpectedCss = cssHrefs.filter((href) => !allowedCss.has(href));

    assert(
        cssHrefs.includes('css/main.css'),
        'index.html 必须保留 css/main.css 作为主样式入口'
    );
    assert.strictEqual(
        unexpectedCss.length,
        0,
        `index.html 样式链接出现拆分迹象（新增小 CSS）: ${unexpectedCss.join(', ')}`
    );
}

function testBuildBundlesNoDeletedScriptRefs() {
    const removedScripts = [
        'js/features/session/examSessionService.js',
        'js/features/session/sessionFeature.js',
        'js/features/app/app-init.js',
        'js/features/practice/practice-sync.js',
        'js/features/overview/overview-runtime.js',
        'js/runtime/mainRuntime.js',
        'js/runtime/legacyPublicAPI.js'
    ];
    const buildSource = fs.readFileSync(path.join(repoRoot, 'scripts', 'build-bundles.mjs'), 'utf8');
    const staleRefs = removedScripts.filter((relativePath) => buildSource.includes(relativePath));

    assert.strictEqual(
        staleRefs.length,
        0,
        `build-bundles.mjs 仍引用已删除脚本: ${staleRefs.join(', ')}`
    );
}

function testCompatPatchRegistry() {
    const windowStub = {};
    const context = vm.createContext({ window: windowStub, globalThis: windowStub, console });
    loadScript('js/patches/runtime-fixes.js', context);

    assert.strictEqual(typeof windowStub.CompatPatch.register, 'function');
    windowStub.CompatPatch.register('patch-a', {
        owner: 'runtime',
        reason: 'test patch',
        removeAfter: 'test'
    });
    const patches = windowStub.CompatPatch.list();
    assert.strictEqual(Array.isArray(patches), true);
    assert.strictEqual(patches.some((item) => item && item.name === 'patch-a'), true);
}

function testReadingLaunchHost() {
    const windowStub = {
        __READING_EXAM_MANIFEST__: {
            'p1-reading': { dataKey: 'p1-reading-data', script: 'dummy.js' }
        },
        buildResourcePath(exam, kind) {
            return `${kind}/${exam.pdfFilename || ''}`;
        }
    };
    const context = vm.createContext({ window: windowStub, globalThis: windowStub, console, URLSearchParams });
    loadScript('js/app/examSessionMixin.js', context);

    const mixin = windowStub.ExamSystemAppMixins && windowStub.ExamSystemAppMixins.examSession;
    assert(mixin && typeof mixin.resolveReadingLaunchDescriptor === 'function', 'examSessionMixin 应暴露 resolveReadingLaunchDescriptor');
    const host = {
        _ensureAbsoluteUrl(url) {
            return url;
        },
        _isReadingLibraryExam: mixin._isReadingLibraryExam,
        _getUnifiedReadingManifestEntry: mixin._getUnifiedReadingManifestEntry,
        _isUnifiedReadingExam: mixin._isUnifiedReadingExam,
        _buildUnifiedReadingUrl: mixin._buildUnifiedReadingUrl,
        _buildReadingPdfUrl: mixin._buildReadingPdfUrl,
        resolveReadingLaunchDescriptor: mixin.resolveReadingLaunchDescriptor
    };

    const unified = host.resolveReadingLaunchDescriptor({
        id: 'p1-reading',
        type: 'reading',
        pdfFilename: 'reading.pdf'
    });
    assert.strictEqual(unified.mode, 'unified_html');
    assert.strictEqual(unified.dataKey, 'p1-reading-data');
    assert(unified.url.includes('reading-practice-unified.html?'));

    const pdf = host.resolveReadingLaunchDescriptor({
        id: 'p2-reading',
        type: 'reading',
        pdfFilename: 'fallback.pdf'
    });
    assert.strictEqual(pdf.mode, 'pdf_manual');
    assert.strictEqual(pdf.pdfUrl, 'pdf/fallback.pdf');

    const listening = host.resolveReadingLaunchDescriptor({
        id: 'listening-p1',
        type: 'listening',
        pdfFilename: 'listening.pdf'
    });
    assert.strictEqual(listening, null);
}

function testMainOpenExamDoesNotFallbackToRawHtml() {
    const source = fs.readFileSync(path.join(repoRoot, 'js/main.js'), 'utf8').replace(/\r\n/g, '\n');
    const match = source.match(/function openExam\s*\([^)]*\)\s*\{([\s\S]*?)\n\}\n\nfunction viewPDF/);
    assert(match, 'main.js 应保留 openExam 函数，并位于 viewPDF 之前');

    const openExamBody = match[1];
    assert(openExamBody.includes('window.app.openExam'), 'openExam 必须只委托统一 App 练习入口');
    assert(openExamBody.includes('统一练习入口未就绪'), 'openExam 在统一入口不可用时必须提示明确错误点');
    assert(!openExamBody.includes("buildResourcePath(exam, 'html')"), 'openExam 禁止拼接原始 HTML 题源路径');
    assert(!openExamBody.includes('window.open('), 'openExam 禁止直接打开原始题源窗口');
    assert(!openExamBody.includes('startHandshakeFallback'), 'openExam 禁止启动旧 HTML 握手兜底');
    assert(!source.includes('function startHandshakeFallback('), 'main.js 禁止保留旧 HTML 握手兜底函数');
}

async function main() {
    await testPracticeStore();
    testFeaturesNoForwardOnlyFiles();
    testIndexCssConvergence();
    testBuildBundlesNoDeletedScriptRefs();
    testReadingLaunchHost();
    testMainOpenExamDoesNotFallbackToRawHtml();
    testCompatPatchRegistry();
    console.log(JSON.stringify({
        status: 'pass',
        detail: 'convergence facade guard tests passed'
    }, null, 2));
}

main().catch((error) => {
    console.log(JSON.stringify({
        status: 'fail',
        detail: error.message
    }, null, 2));
    process.exit(1);
});
