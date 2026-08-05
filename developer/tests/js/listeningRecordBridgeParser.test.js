import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import '../../../js/utils/safeObjectLiteralParser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const parser = globalThis.SafeObjectLiteralParser;

function assertRejected(source, pattern) {
    assert.throws(
        () => parser.parse(source),
        pattern || /SafeObjectLiteralParseError/,
        `应拒绝: ${source}`
    );
}

function testLegacyDataSyntax() {
    const value = parser.parse(`
        {
            answerKey: {
                text: { q1: 'accommodation', 2: "library", },
                matching: { q2: 'B' }
            },
            sections: [true, false, null, -1.5e2,],
            // 兼容题库行注释
            title: 'Listening \\\\ Practice',
            /* 兼容块注释 */
        }
    `);

    assert.strictEqual(Object.getPrototypeOf(value), null);
    assert.strictEqual(Object.getPrototypeOf(value.answerKey), null);
    assert.strictEqual(value.answerKey.text.q1, 'accommodation');
    assert.strictEqual(value.answerKey.text['2'], 'library');
    assert.deepStrictEqual(value.sections, [true, false, null, -150]);
    assert.strictEqual(value.title, 'Listening \\ Practice');
}

function testParseAtStopsAfterLiteral() {
    const source = "  /* config */ { answerKey: { text: { q31: 'accommodation' } } }; runLater()";
    const result = parser.parseAt(source, 0);
    assert.strictEqual(result.value.answerKey.text.q31, 'accommodation');
    assert.strictEqual(source.slice(result.endIndex).trim(), '; runLater()');
}

function testExecutableSyntaxIsRejected() {
    global.__listeningParserSentinel = 0;
    const attacks = [
        "{ value: (global.__listeningParserSentinel = 1) }",
        "{ value: global.__listeningParserSentinel }",
        "{ value: (() => 1)() }",
        "{ get value() { global.__listeningParserSentinel = 1; } }",
        "{ ...global.__payload }",
        "{ [global.__key]: 1 }",
        "{ value: `template` }",
        "{ value: /regex/ }",
        "{ value: undefined }",
        "{ value: NaN }",
        "{ value: Infinity }",
        "{ shorthand }"
    ];
    attacks.forEach((source) => assertRejected(source));
    assert.strictEqual(global.__listeningParserSentinel, 0, '恶意输入不得执行');
    delete global.__listeningParserSentinel;
}

function testPrototypePollutionKeysAreRejected() {
    assertRejected("{ __proto__: { polluted: true } }", /forbidden object key/);
    assertRejected("{ constructor: { prototype: { polluted: true } } }", /forbidden object key/);
    assertRejected("{ 'prototype': {} }", /forbidden object key/);
    assert.strictEqual({}.polluted, undefined);
}

function testLimitsAndMalformedInput() {
    assert.throws(
        () => parser.parse('{ a: { b: { c: 1 } } }', { maxDepth: 2 }),
        /maximum nesting depth/
    );
    assertRejected("{ value: 'unterminated }", /unterminated string/);
    assertRejected('{ value: 1 /* unterminated }', /unterminated block comment/);
    assert.throws(
        () => parser.parse('{ a: 1, b: 2 }', { maxProperties: 1 }),
        /maximum property count/
    );
}

function testBridgeHasNoDynamicCodeExecution() {
    const bridgePath = path.join(__dirname, '../../../js/listeningRecordBridge.js');
    const source = fs.readFileSync(bridgePath, 'utf8');
    assert.ok(!/\bnew\s+Function\s*\(/.test(source), 'bridge 不得使用 new Function');
    assert.ok(!/\beval\s*\(/.test(source), 'bridge 不得使用 eval');
    assert.ok(source.includes('SafeObjectLiteralParser.parseAt'), 'bridge 应使用纯数据解析器');
}

function run() {
    testLegacyDataSyntax();
    testParseAtStopsAfterLiteral();
    testExecutableSyntaxIsRejected();
    testPrototypePollutionKeysAreRejected();
    testLimitsAndMalformedInput();
    testBridgeHasNoDynamicCodeExecution();
    console.log(JSON.stringify({
        status: 'pass',
        detail: 'listening bridge safe object-literal parser regression checks passed'
    }));
}

try {
    run();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
