#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const libraryDiscoverySource = fs.readFileSync(path.join(repoRoot, 'js/services/libraryDiscovery.js'), 'utf8');

function loadScript(relativePath, context) {
    const fullPath = path.join(repoRoot, relativePath);
    const source = fs.readFileSync(fullPath, 'utf8');
    vm.runInContext(source, context, { filename: relativePath });
}

const results = [];

function recordResult(name, passed, detail) {
    results.push({ name, passed, detail, timestamp: new Date().toISOString() });
}

function makeFile(relativePath, content = '', options = {}) {
    const name = relativePath.split(/[\\/]/).pop();
    return {
        name,
        webkitRelativePath: relativePath,
        type: options.type || '',
        size: options.size,
        async text() {
            return content;
        }
    };
}

function createHarness() {
    const objectUrlPayloads = [];
    let objectUrlSeq = 0;

    class BlobStub {
        constructor(parts, options = {}) {
            this.parts = parts;
            this.type = options.type || '';
        }
    }

    const windowStub = {
        console: { log() {}, warn() {}, error() {}, info() {} },
        Blob: BlobStub,
        URL: {
            createObjectURL(value) {
                const url = `blob:library-discovery-test/${++objectUrlSeq}`;
                objectUrlPayloads.push({ url, value });
                return url;
            },
            revokeObjectURL() {}
        }
    };

    const sandbox = {
        window: windowStub,
        console: windowStub.console,
        Blob: BlobStub,
        URL: windowStub.URL,
        Map,
        Set,
        Promise,
        JSON,
        Math,
        Date,
        String,
        Number,
        Array,
        Object,
        RegExp
    };
    sandbox.globalThis = sandbox.window;
    const context = vm.createContext(sandbox);
    loadScript('js/services/libraryDiscovery.js', context);
    return { discovery: windowStub.LibraryDiscovery, objectUrlPayloads };
}

function listeningHtml(title = 'Deep Listening Drill') {
    return `<!doctype html>
<html>
<head><title>IELTS Listening Practice - ${title}</title></head>
<body>
  <div class="audio-player"><audio src="audio.mp3"></audio></div>
  <section>Questions 1-10</section>
  <script>
    const CONFIG_DATA = { answerKey: { text: { q1: 'accommodation' }, matching: { q2: 'B' } } };
    const App = { config: CONFIG_DATA, state: { timerSecs: 0 }, finishTest() { return CONFIG_DATA.answerKey; } };
  </script>
</body>
</html>`;
}

async function testDiscoversListeningHtmlAtAnyDepth() {
    const { discovery, objectUrlPayloads } = createHarness();
    const files = [
        makeFile('Teacher Pack/level/a/deep/custom-exam.html', listeningHtml('Custom Deep Exam')),
        makeFile('Teacher Pack/level/a/deep/audio.mp3', '', { type: 'audio/mpeg' }),
        makeFile('Teacher Pack/level/a/deep/notes.txt', 'ignore me')
    ];

    const result = await discovery.discover(files, { type: 'listening', registerRuntime: true });

    assert.strictEqual(result.entries.length, 1, '任意深层听力 HTML 应被识别');
    assert.strictEqual(result.stats.audio, 1, '应统计同目录音频');
    const entry = result.entries[0];
    assert.strictEqual(entry.type, 'listening');
    assert.strictEqual(entry.category, 'Custom', '没有 P1-P4 时应落入 Custom，而不是硬编码 P1');
    assert.strictEqual(entry.path, 'Teacher Pack/level/a/deep/');
    assert.strictEqual(entry.filename, 'custom-exam.html');
    assert.strictEqual(entry.audioFilename, 'audio.mp3');
    assert(entry.detectedBy.includes('config-answer-key'), '应记录答案配置识别信号');
    assert(entry.id.startsWith('custom-listening-'), '应生成稳定自定义听力 id');
    assert.strictEqual(entry.runtimeResourceMode, 'session-blob', '外部导入题源应标记当前会话资源模式');

    const runtimeUrl = discovery.resolveRuntimeResource(entry, 'html');
    assert(runtimeUrl.startsWith('blob:library-discovery-test/'), '当前会话应注册可打开的运行时 HTML URL');
    const htmlBlob = objectUrlPayloads.find((payload) => payload.url === runtimeUrl)?.value;
    assert(htmlBlob && Array.isArray(htmlBlob.parts), '运行时 HTML 应来自重写后的 Blob');
    const runtimeHtml = String(htmlBlob.parts[0]);
    assert(runtimeHtml.includes('blob:library-discovery-test/'), 'HTML 内相对音频引用应被重写为 Blob URL');
    assert(runtimeHtml.includes('id="imported-practice-frame"'), 'runtime HTML should wrap imported content in a sandbox iframe');
    assert(runtimeHtml.includes('sandbox="allow-scripts"'), 'runtime sandbox should grant only the script capability needed for imported exercises');
    assert(!runtimeHtml.includes('allow-same-origin'), 'imported HTML must not inherit the app origin');
    assert(!runtimeHtml.includes('allow-forms'), 'imported HTML must not submit forms from the app wrapper');
    assert(!runtimeHtml.includes('allow-downloads'), 'imported HTML must not trigger downloads from the app wrapper');
    assert(!runtimeHtml.includes('allow-modals'), 'imported HTML must not open modal dialogs from the app wrapper');
    assert(runtimeHtml.includes("connect-src 'none'"), 'runtime wrapper CSP should block imported page network requests');
    assert(runtimeHtml.includes("frame-src 'none'"), 'runtime wrapper CSP should block nested frames in imported content');
    assert(runtimeHtml.includes("worker-src 'none'"), 'runtime wrapper CSP should block imported content workers');
    assert(runtimeHtml.includes("navigate-to 'none'"), 'runtime wrapper CSP should block imported content navigation');
    assert(runtimeHtml.includes('&lt;script&gt;'), 'original imported scripts should be encoded into srcdoc instead of top-level HTML');
    assert(runtimeHtml.includes('function sameOriginParent(event)'), 'runtime bridge must validate parent message origin before forwarding into the sandbox');
    assert(runtimeHtml.includes('MAX_BRIDGE_MESSAGE_CHARS = 2 * 1024 * 1024'), 'runtime bridge must cap forwarded message payload size');
    assert(runtimeHtml.includes('function isSafeBridgeMessage(data)'), 'runtime bridge must validate forwarded message shape');
    assert(runtimeHtml.includes('JSON.stringify(data).length <= MAX_BRIDGE_MESSAGE_CHARS'), 'runtime bridge must reject oversized structured messages before forwarding');
    assert(runtimeHtml.includes('if (!isSafeBridgeMessage(event.data)) return;'), 'runtime bridge must apply message validation before forwarding both directions');
    assert(
        runtimeHtml.includes('sameOriginParent(event) && allowedFromParent[type] && frame && frame.contentWindow'),
        'runtime bridge must only forward allowlisted parent messages after the same-origin check'
    );
    assert(
        runtimeHtml.includes("frame.contentWindow.postMessage(event.data, '*');"),
        'wildcard postMessage should be limited to the opaque-origin sandbox iframe target'
    );
    for (const blockedType of [
        'VOCAB_HIGHLIGHT_SAVE',
        'SIMULATION_DRAFT_SYNC',
        'SIMULATION_NAVIGATE',
        'SIMULATION_SUBMIT',
        'SUITE_CLOSE_ATTEMPT',
        'ENDLESS_USER_EXIT'
    ]) {
        assert(!runtimeHtml.includes(`${blockedType}: true`), `runtime bridge must not forward imported ${blockedType} messages`);
    }
    assert.strictEqual(result.report.accepted, 1, '报告应包含识别题目数量');
    assert.strictEqual(result.report.runtime.html, 1, '报告应包含运行时 HTML 资源数量');
    assert(result.report.warnings.includes('file-picker-session-resources'), '报告应提示 file picker 会话资源边界');

    recordResult('任意深层听力 HTML 内容识别', true, {
        entry,
        runtimeUrl
    });
}

async function testRejectsUnrelatedHtml() {
    const { discovery } = createHarness();
    const result = await discovery.discover([
        makeFile('random/site/index.html', '<!doctype html><title>Marketing</title><h1>Hello</h1>')
    ], { type: 'listening', registerRuntime: false });

    assert.strictEqual(result.entries.length, 0, '普通 HTML 不应被误识别为听力题源');
    assert.strictEqual(result.rejected.length, 1, '拒绝原因应可审计');
    assert.strictEqual(result.rejected[0].reason, 'insufficient-listening-signals');

    recordResult('普通 HTML 不误收', true, result.stats);
}

async function testRejectsAudioPageWithoutAnswerPath() {
    const { discovery } = createHarness();
    const result = await discovery.discover([
        makeFile('Teacher Pack/audio-only/ielts-listening-intro.html', `<!doctype html>
<html>
<head><title>IELTS Listening Practice - Audio Intro</title></head>
<body>
  <audio src="intro.mp3"></audio>
  <section>Questions 1-10</section>
</body>
</html>`),
        makeFile('Teacher Pack/audio-only/intro.mp3', '', { type: 'audio/mpeg' })
    ], { type: 'listening', registerRuntime: false });

    assert.strictEqual(result.entries.length, 0, '没有答案/评分链路的音频页不应进入听力题库');
    assert.strictEqual(result.rejected.length, 1, '伪听力页应进入拒绝报告');
    assert.strictEqual(result.rejected[0].reason, 'missing-answer-or-scoring-path');
    assert.strictEqual(result.report.reasonCounts['missing-answer-or-scoring-path'], 1);

    recordResult('伪听力 HTML 缺少答案链路时拒绝', true, result.report);
}

async function testReadingImportRejectsListeningHtml() {
    const { discovery } = createHarness();
    const result = await discovery.discover([
        makeFile('reading-drop/listening-like.html', listeningHtml('Not Reading')),
        makeFile('reading-drop/audio.mp3', '', { type: 'audio/mpeg' })
    ], { type: 'reading', registerRuntime: false });

    assert.strictEqual(result.entries.length, 0, '阅读导入不应吞掉听力 HTML');
    assert.strictEqual(result.rejected[0].reason, 'looks-like-listening');

    recordResult('阅读导入排除听力题源', true, { rejected: result.rejected.length });
}

async function testIncrementalMergeDedupesByImportKey() {
    const { discovery } = createHarness();
    const original = {
        id: 'custom-listening-old',
        type: 'listening',
        title: 'Old title',
        path: 'Teacher Pack/level/a/deep/',
        filename: 'custom-exam.html',
        importKey: 'listening:teacher pack/level/a/deep/custom-exam.html'
    };
    const replacement = {
        id: 'custom-listening-new',
        type: 'listening',
        title: 'New title',
        path: 'Teacher Pack/level/a/deep/',
        filename: 'custom-exam.html',
        importKey: 'listening:teacher pack/level/a/deep/custom-exam.html'
    };
    const reading = {
        id: 'reading-1',
        type: 'reading',
        title: 'Keep me',
        path: 'ReadingPractice/set/',
        filename: 'set.html'
    };

    const incremental = discovery.mergeExamIndexes([reading, original], [replacement], {
        type: 'listening',
        mode: 'incremental'
    });
    assert.strictEqual(incremental.index.length, 2, '增量导入同一 importKey 应更新而不是重复追加');
    assert.strictEqual(incremental.updated, 1);
    assert.strictEqual(incremental.index.find((item) => item.type === 'listening').title, 'New title');

    const full = discovery.mergeExamIndexes([reading, original], [replacement], {
        type: 'listening',
        mode: 'full'
    });
    assert.strictEqual(full.index.length, 2, '全量导入只替换目标类型，保留另一类型');
    assert(full.index.some((item) => item.id === 'reading-1'), '全量听力导入应保留阅读题库');
    assert(!full.index.some((item) => item.id === 'custom-listening-old'), '全量听力导入应移除旧听力题目');

    recordResult('全量/增量合并去重', true, {
        incremental,
        full
    });
}

async function testDoesNotPersistLocalFileSystemPaths() {
    const { discovery } = createHarness();
    const privateHtmlPath = 'D:\\Users\\Alice\\Secret IELTS\\private-listening.html';
    const privateAudioPath = 'D:\\Users\\Alice\\Secret IELTS\\audio.mp3';
    const files = [
        {
            name: 'private-listening.html',
            path: privateHtmlPath,
            size: 1000,
            async text() {
                return listeningHtml('Private Path Exam');
            }
        },
        {
            name: 'audio.mp3',
            path: privateAudioPath,
            type: 'audio/mpeg',
            size: 1000,
            async text() {
                return '';
            }
        }
    ];

    const result = await discovery.discover(files, { type: 'listening', registerRuntime: false });

    assert.strictEqual(result.entries.length, 1, 'file.path fallback should still allow same-selection resource matching by filename');
    const entry = result.entries[0];
    assert.strictEqual(entry.sourcePath, 'private-listening.html');
    assert.strictEqual(entry.filename, 'private-listening.html');
    assert.strictEqual(entry.audioFilename, 'audio.mp3');
    const serialized = JSON.stringify(result);
    assert(!serialized.includes('Users'), 'local directory names must not be persisted in imported metadata');
    assert(!serialized.includes('Alice'), 'local user names must not be persisted in imported metadata');
    assert(!serialized.includes('Secret IELTS'), 'local folder names must not be persisted in imported metadata');
    assert(!serialized.includes('D:'), 'drive letters must not be persisted in imported metadata');

    recordResult('file.path 本机路径不进入导入元数据', true, {
        sourcePath: entry.sourcePath,
        path: entry.path
    });
}

async function testCapsImportedFileCountAndHtmlSize() {
    const oversized = createHarness();
    const oversizedResult = await oversized.discovery.discover([
        makeFile('oversized/listening.html', listeningHtml('Oversized'), { size: 6 * 1024 * 1024 }),
        makeFile('oversized/audio.mp3', '', { type: 'audio/mpeg' })
    ], { type: 'listening', registerRuntime: true });

    assert.strictEqual(oversizedResult.entries.length, 0, 'oversized imported HTML must not be accepted');
    assert.strictEqual(oversized.objectUrlPayloads.length, 0, 'oversized imported HTML must not create runtime blobs');

    const oversizedAudio = createHarness();
    const oversizedAudioResult = await oversizedAudio.discovery.discover([
        makeFile('oversized-audio/listening.html', listeningHtml('Oversized Audio'), { size: 1000 }),
        makeFile('oversized-audio/audio.mp3', '', { type: 'audio/mpeg', size: 101 * 1024 * 1024 })
    ], { type: 'listening', registerRuntime: true });

    assert.strictEqual(oversizedAudioResult.entries.length, 1, 'valid imported HTML can still be accepted when a companion asset is too large');
    assert.strictEqual(oversizedAudioResult.entries[0].hasAudio, false, 'oversized imported audio must not be attached to the entry');
    assert.strictEqual(oversizedAudioResult.report.audio, 0, 'oversized imported audio must not be counted as a usable resource');
    assert.strictEqual(oversizedAudioResult.report.runtime.audio, 0, 'oversized imported audio must not create runtime object URLs');

    const capped = createHarness();
    const manyFiles = Array.from({ length: 5000 }, function (_, index) {
        return makeFile(`bulk/ignore-${index}.txt`, 'ignore');
    });
    manyFiles.push(makeFile('bulk/valid-listening.html', listeningHtml('Dropped Valid Exam')));
    manyFiles.push(makeFile('bulk/audio.mp3', '', { type: 'audio/mpeg' }));
    const cappedResult = await capped.discovery.discover(manyFiles, { type: 'listening', registerRuntime: true });

    assert.strictEqual(cappedResult.stats.files, 5000, 'file picker imports must cap processed file count');
    assert.strictEqual(cappedResult.entries.length, 0, 'files after the cap must not be processed');
    assert.strictEqual(capped.objectUrlPayloads.length, 0, 'files after the cap must not create runtime blobs');

    recordResult('文件夹导入限制文件数量和 HTML 体积', true, {
        oversizedEntries: oversizedResult.entries.length,
        oversizedAudioRuntime: oversizedAudioResult.report.runtime.audio,
        cappedFiles: cappedResult.stats.files
    });
}

function testDiscoveryLogsDoNotExposeFilePaths() {
    assert(
        !/console\.warn\([^)]*(?:getFilePath|getBaseName\(file)/.test(libraryDiscoverySource) &&
        !libraryDiscoverySource.includes('HTML file skipped because it is too large:\'') &&
        !libraryDiscoverySource.includes('HTML content skipped because it is too large:\''),
        'LibraryDiscovery size warnings must not log imported file paths or filenames'
    );
    recordResult('LibraryDiscovery warning logs hide imported file paths', true);
}

async function main() {
    try {
        await testDiscoversListeningHtmlAtAnyDepth();
        await testRejectsUnrelatedHtml();
        await testRejectsAudioPageWithoutAnswerPath();
        await testReadingImportRejectsListeningHtml();
        await testIncrementalMergeDedupesByImportKey();
        await testDoesNotPersistLocalFileSystemPaths();
        await testCapsImportedFileCountAndHtmlSize();
        testDiscoveryLogsDoNotExposeFilePaths();

        console.log(JSON.stringify({
            status: 'pass',
            detail: `${results.length}/${results.length} 测试通过`,
            passed: results.length,
            total: results.length
        }, null, 2));
    } catch (error) {
        recordResult('LibraryDiscovery 测试执行失败', false, { error: error.message });
        console.log(JSON.stringify({
            status: 'fail',
            detail: error.message,
            results
        }, null, 2));
        process.exit(1);
    }
}

main();
