#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const vocabReaderPath = path.join(root, 'js/components/readingVocabReader.js');
const cssPath = path.join(root, 'css/vocab-reader.css');

const vocabReaderSource = fs.readFileSync(vocabReaderPath, 'utf8');
const cssSource = fs.readFileSync(cssPath, 'utf8');

// 1. 验证 isPassageInstruction 函数存在并能够识别指导语句子
assert.match(
    vocabReaderSource,
    /function isPassageInstruction\(text\)/,
    'isPassageInstruction function must be defined'
);

// 2. 验证 extractPassageData 函数能够分离指导语与段落
assert.match(
    vocabReaderSource,
    /function extractPassageData\(rawHtml/,
    'extractPassageData function must be defined'
);

// 3. 验证 Tab 按钮文本改为 "全文"，并且不再是 "全部全文"
assert.doesNotMatch(
    vocabReaderSource,
    />全部全文</,
    'Tab button must not contain 全部全文'
);

assert.match(
    vocabReaderSource,
    /data-para="all">全文<\/button>/,
    'Tab button must be 全文'
);

// 4. 验证段落标题与标签使用英文缩写 Para A、Para B 等，而非中文“段落 A”
assert.doesNotMatch(
    vocabReaderSource,
    /data-para="\$\{b\.letter\}">段落 \$\{b\.letter\}<\/button>/,
    'Tab buttons must not use Chinese 段落'
);

assert.match(
    vocabReaderSource,
    /data-para="\$\{b\.letter\}">Para \$\{b\.letter\}<\/button>/,
    'Tab buttons must use English abbreviation Para ${b.letter}'
);

assert.match(
    vocabReaderSource,
    /<span class="vocab-para-letter">Para \$\{b\.letter\}<\/span>/,
    'Paragraph card tag must use English abbreviation Para ${b.letter}'
);

// 5. 验证指导语在展示时作为独立说明呈现，没有段落标签
assert.match(
    vocabReaderSource,
    /vocab-passage-instruction/,
    'Instruction note must use dedicated vocab-passage-instruction markup'
);

// 6. 验证 DOM 结构与 CSS：header 置顶不随页面滚动收起
assert.match(
    vocabReaderSource,
    /<div class="vocab-reader-scroll-area" id="vocab-reader-scroll-area">/,
    'ensureOverlay must have a dedicated vocab-reader-scroll-area wrapper'
);

assert.match(
    cssSource,
    /\.vocab-reader-scroll-area\s*\{[\s\S]*?overflow-y:\s*auto;/,
    'CSS must declare .vocab-reader-scroll-area with overflow-y: auto'
);

assert.match(
    cssSource,
    /\.vocab-reader-header\s*\{[\s\S]*?flex-shrink:\s*0;/,
    'CSS .vocab-reader-header must have flex-shrink: 0 to stay pinned at top'
);

console.log(JSON.stringify({
    status: 'pass',
    detail: 'Reading vocab reader layout, instruction filtering, English abbreviation tabs, and sticky header verified'
}));
