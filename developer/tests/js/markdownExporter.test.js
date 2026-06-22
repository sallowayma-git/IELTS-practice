#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function loadMarkdownExporter() {
    const quietConsole = {
        log() {},
        warn() {},
        error() {},
        info() {}
    };
    const sandbox = {
        window: {},
        console: quietConsole,
        Blob,
        URL: {
            createObjectURL() {
                return 'blob:test';
            },
            revokeObjectURL() {}
        },
        document: {
            body: {
                appendChild() {},
                removeChild() {}
            },
            createElement() {
                return {
                    click() {}
                };
            },
            getElementById() {
                return null;
            }
        },
        Date,
        setTimeout
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);
    const source = fs.readFileSync(path.join(repoRoot, 'js/utils/markdownExporter.js'), 'utf8');
    vm.runInContext(source, context, { filename: 'js/utils/markdownExporter.js' });
    return sandbox.window.MarkdownExporter;
}

function testRecordMarkdownEscapesUserControlledText() {
    const MarkdownExporter = loadMarkdownExporter();
    const exporter = new MarkdownExporter();
    const markdown = exporter.generateRecordMarkdown({
        id: 'r1',
        title: '![title](https://example.test/pixel)',
        duration: '<img src=x onerror=alert(1)>',
        metadata: {
            category: 'reading|broken',
            frequency: '[freq](javascript:alert(1))',
            examTitle: '<script>alert(1)</script>'
        },
        answers: {
            q1: 'A|B\n![answer](https://example.test/a)'
        },
        correctAnswers: {
            q1: '<b>safe</b>'
        }
    });

    assert(!markdown.includes('<script>'), 'raw HTML tags in titles must be escaped');
    assert(!markdown.includes('<img'), 'raw HTML tags in basic fields must be escaped');
    assert(!markdown.includes('![answer]('), 'markdown image syntax in table cells must be escaped');
    assert(!markdown.includes('[freq]('), 'markdown link syntax in headings must be escaped');
    assert(markdown.includes('reading\\|broken'), 'heading pipe characters must be escaped');
    assert(markdown.includes('A\\|B'), 'table pipe characters must be escaped');
    assert(markdown.includes('&lt;script&gt;alert\\(1\\)&lt;/script&gt;'));
    assert(markdown.includes('&lt;b&gt;safe&lt;/b&gt;'));
}

function testComparisonKeysAreEscaped() {
    const MarkdownExporter = loadMarkdownExporter();
    const exporter = new MarkdownExporter();
    const markdown = exporter.generateTableFromComparison({
        'qbad|key': {
            userAnswer: '[user](javascript:alert(1))',
            correctAnswer: 'ok',
            isCorrect: false
        }
    });

    assert(markdown.includes('bad\\|key'), 'non-numeric comparison keys must escape markdown table separators');
    assert(!markdown.includes('[user]('), 'comparison answers must escape markdown link syntax');
}

function testUnsafeComparisonKeysAreIgnored() {
    const MarkdownExporter = loadMarkdownExporter();
    const exporter = new MarkdownExporter();
    const pollutedComparison = JSON.parse('{"__proto__":{"userAnswer":"polluted","correctAnswer":"polluted"},"constructor":{"userAnswer":"ctor","correctAnswer":"ctor"},"q1":{"userAnswer":"A","correctAnswer":"B","isCorrect":false}}');
    const markdown = exporter.generateTableFromComparison(pollutedComparison);
    const correctAnswers = exporter.getCorrectAnswers({ answerComparison: pollutedComparison });

    assert(markdown.includes('| 1 | A | B |'), 'safe comparison entries should still export');
    assert(!markdown.includes('polluted'), 'unsafe __proto__ comparison key must be ignored');
    assert(!markdown.includes('ctor'), 'unsafe constructor comparison key must be ignored');
    assert.equal(Object.getPrototypeOf(correctAnswers), null, 'derived correct answer maps must use a null prototype');
    assert.deepEqual(Object.keys(correctAnswers), ['q1']);
    assert.equal({}.polluted, undefined, 'exporting unsafe keys must not pollute Object.prototype');
}

function testAnswerMapsAreBounded() {
    const MarkdownExporter = loadMarkdownExporter();
    const exporter = new MarkdownExporter();
    const oversized = {};
    for (let index = 0; index < 1105; index += 1) {
        oversized[`q${index}`] = `A${index}`;
    }
    const normalized = exporter.normalizeAnswerMap(oversized);

    assert.equal(Object.getPrototypeOf(normalized), null);
    assert.equal(Object.keys(normalized).length, 1000);
    assert.equal(normalized.q999, 'A999');
    assert.equal(normalized.q1000, undefined);
}

async function testInvalidDatesDoNotBreakGrouping() {
    const MarkdownExporter = loadMarkdownExporter();
    const exporter = new MarkdownExporter();
    const grouped = await exporter.groupRecordsByDateAsync([
        {
            id: 'bad-date',
            examId: 'exam-1',
            title: 'Bad date',
            startTime: 'not-a-date',
            date: '',
            answers: {}
        }
    ], []);

    assert.equal(Object.keys(grouped)[0], 'unknown-date');
    const markdown = await exporter.generateMarkdownContentAsync(grouped);
    assert(markdown.includes('## unknown\\-date'), 'invalid record dates should export under a stable fallback heading');
}

async function testMalformedRecordsDoNotBreakExportGrouping() {
    const MarkdownExporter = loadMarkdownExporter();
    const exporter = new MarkdownExporter();
    const grouped = await exporter.groupRecordsByDateAsync([
        null,
        'not-a-record',
        {
            id: 'good-record',
            examId: 'exam-1',
            title: 'Good record',
            answers: {}
        }
    ], null);

    assert.equal(grouped['unknown-date'].length, 3);
    const asyncMarkdown = await exporter.generateMarkdownContentAsync(grouped);
    const syncMarkdown = exporter.generateMarkdownContent(exporter.groupRecordsByDate([null], null));
    const directMarkdown = exporter.generateRecordMarkdown(null);

    assert(asyncMarkdown.includes('Invalid practice record'), 'malformed async records should use a safe placeholder title');
    assert(syncMarkdown.includes('Invalid practice record'), 'malformed sync records should use a safe placeholder title');
    assert(directMarkdown.includes('Invalid practice record'), 'direct malformed records should not throw');
}

function testDateHeadingsAreEscaped() {
    const MarkdownExporter = loadMarkdownExporter();
    const exporter = new MarkdownExporter();
    const markdown = exporter.generateMarkdownContent({
        '2026-01-01\n<script>alert(1)</script>|x': [
            {
                id: 'r1',
                examId: 'exam-1',
                title: 'Safe title',
                answers: {}
            }
        ]
    });

    assert(!markdown.includes('<script>'), 'date headings must not render raw HTML');
    assert(markdown.includes('2026\\-01\\-01 &lt;script&gt;alert\\(1\\)&lt;/script&gt;\\|x'));
}

function testProgressIndicatorStyleIsCleanedUp() {
    const source = fs.readFileSync(path.join(repoRoot, 'js/utils/markdownExporter.js'), 'utf8');
    assert(source.includes('<style id="export-progress-style">'), 'progress indicator style must be addressable');
    assert(
        /const style = document\.getElementById\('export-progress-style'\);[\s\S]{0,120}style\.remove\(\);/.test(source),
        'progress indicator cleanup must remove its injected style node'
    );
}

testRecordMarkdownEscapesUserControlledText();
testComparisonKeysAreEscaped();
testUnsafeComparisonKeysAreIgnored();
testAnswerMapsAreBounded();
await testInvalidDatesDoNotBreakGrouping();
await testMalformedRecordsDoNotBreakExportGrouping();
testDateHeadingsAreEscaped();
testProgressIndicatorStyleIsCleanedUp();

console.log(JSON.stringify({
    status: 'pass',
    detail: 'markdown exporter escaping tests passed'
}, null, 2));
