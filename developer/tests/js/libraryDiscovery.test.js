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

function makeFile(relativePath, content = '', options = {}) {
    const name = relativePath.split(/[\\/]/).pop();
    return {
        name,
        webkitRelativePath: relativePath,
        type: options.type || '',
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
    assert(String(htmlBlob.parts[0]).includes('blob:library-discovery-test/'), 'HTML 内相对音频引用应被重写为 Blob URL');
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

async function main() {
    try {
        await testDiscoversListeningHtmlAtAnyDepth();
        await testRejectsUnrelatedHtml();
        await testRejectsAudioPageWithoutAnswerPath();
        await testReadingImportRejectsListeningHtml();
        await testIncrementalMergeDedupesByImportKey();

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
